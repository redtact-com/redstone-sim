/**
 * 3D 盤面のピッキング (#397)。押した点から光線を出し、盤面の格子を手前から 1 マスずつ辿る。
 *
 * **WebGL を使わない計算だけで組む** (vitest で確かめられるようにするため)。
 * 色で塗って readPixels で読む方式 (deepslate の drawColoredStructure) は採らない。
 * 色が blockPos/256 なので 8bit で読むと 128 付近の 2 つの座標が同じ色になり、
 * 当たりが描いた画素だけになるので数 px のレバーを指で押せない。
 *
 * 座標は**構造ローカル** (snapshot の bounds の min が原点、1 ブロック = 1)。
 * 画面の座標は canvas の左上を原点にした CSS px。canvas は devicePixelRatio を
 * 掛けていない (canvas.width = clientWidth) ので、CSS px のまま計算してよい。
 */

import { mat4, vec4 } from 'gl-matrix'
import { isTriggerableType } from '@redstone/sim'
import type { BlockState, BlockType } from '@redstone/sim'
import { VIEWER_FOV_DEG, VIEWER_NEAR, VIEWER_FAR } from '../camera.js'

export type Size3 = readonly [number, number, number]
export type Cell3 = [number, number, number]

/** ビュー行列に効くカメラの値 (useCamera の Camera と同じ形) */
export interface CameraPose {
  rotX: number
  rotY: number
  distance: number
  panX: number
  panZ: number
}

/**
 * IsometricView の描画と同じビュー行列。
 *
 * **描画とピックの両方がこの関数を使う**。片方だけ書き換えると、押した所と
 * 違うマスが切り替わる (しかも画面上は何も間違って見えない) ので、式を 1 か所に置く。
 */
export function viewMatrixOf(cam: CameraPose, size: Size3): mat4 {
  const vm = mat4.create()
  mat4.translate(vm, vm, [0, 0, -cam.distance])
  mat4.rotateX(vm, vm, (cam.rotX * Math.PI) / 180)
  mat4.rotateY(vm, vm, (cam.rotY * Math.PI) / 180)
  mat4.translate(vm, vm, [-size[0] / 2 - cam.panX, -size[1] / 2, -size[2] / 2 - cam.panZ])
  return vm
}

/**
 * deepslate の Renderer.getPerspective と同じ射影 (縦の視野角 70°・near 0.1・far 500)。
 * 画面比は deepslate と同じく canvas の clientWidth / clientHeight を渡す。
 */
export function projMatrixOf(aspect: number): mat4 {
  const pm = mat4.create()
  mat4.perspective(pm, (VIEWER_FOV_DEG * Math.PI) / 180, aspect, VIEWER_NEAR, VIEWER_FAR)
  return pm
}

export interface Ray {
  origin: [number, number, number]
  /** 長さ 1 */
  dir: [number, number, number]
}

/**
 * canvas 上の点を光線にする。描画と同じ行列 (射影 × ビュー) を逆にたどり、
 * near 面と far 面の 2 点を結ぶ。行列が逆にできなければ null。
 */
export function canvasRay(px: number, py: number, w: number, h: number, vm: mat4, pm: mat4): Ray | null {
  if (w <= 0 || h <= 0) return null
  const inv = mat4.multiply(mat4.create(), pm, vm)
  if (!mat4.invert(inv, inv)) return null
  const ndcX = (2 * px) / w - 1
  const ndcY = 1 - (2 * py) / h
  const a = vec4.transformMat4(vec4.create(), vec4.fromValues(ndcX, ndcY, -1, 1), inv)
  const b = vec4.transformMat4(vec4.create(), vec4.fromValues(ndcX, ndcY, 1, 1), inv)
  const o: [number, number, number] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]
  const d = [b[0] / b[3] - o[0], b[1] / b[3] - o[1], b[2] / b[3] - o[2]]
  const len = Math.hypot(d[0], d[1], d[2])
  if (!(len > 0)) return null
  return { origin: o, dir: [d[0] / len, d[1] / len, d[2] / len] }
}

/** 構造ローカルの点を canvas 上の点 (CSS px) にする。カメラの後ろなら null */
export function pointToCanvas(
  p: readonly number[], w: number, h: number, vm: mat4, pm: mat4,
): { x: number; y: number } | null {
  const m = mat4.multiply(mat4.create(), pm, vm)
  const c = vec4.transformMat4(vec4.create(), vec4.fromValues(p[0], p[1], p[2], 1), m)
  if (c[3] <= 0) return null
  return { x: ((c[0] / c[3] + 1) / 2) * w, y: ((1 - c[1] / c[3]) / 2) * h }
}

/**
 * マスの扱い。
 *  - target: 押せる素子。**1 マス全体を当たりにする** (絵が数 px のレバーも押せるように)
 *  - pass:   素通り。細い・透けるので奥の素子を隠さない。それ自体は押せない
 *  - block:  遮る。奥の素子は押せない (見えない物は押せない)
 *  - null:   空
 */
export type PickRole = 'target' | 'pass' | 'block'

/**
 * 素通りさせる型。**一覧に無い型は「遮る」として扱う** (安全側)。
 * ガラス・ガラス板・水も素通りにする (奥に見えている素子を押せるように。
 * マイクラ本体ではガラス越しには押せないが、盤面を見て操作する道具なのでこちらを採る)。
 */
export const PICK_PASS_THROUGH: ReadonlySet<BlockType> = new Set<BlockType>([
  'wire', 'torch', 'wall_torch', 'repeater', 'comparator',
  'rail', 'powered_rail', 'activator_rail',
  'glass', 'pane', 'water', 'bubble_column',
])

/**
 * ブロックのマスの扱い。押せるかどうかは `isTriggerableType` で決める。
 * これはトリガ欄の TRIGGER_META と一致することを app/src/blockDrift.test.ts が
 * 確かめているので、盤面とトリガ欄で押せる物がずれない。
 */
export function pickRoleOf(block: BlockState | undefined): PickRole | null {
  if (!block || block.type === 'air') return null
  if (isTriggerableType(block.type)) return 'target'
  return PICK_PASS_THROUGH.has(block.type) ? 'pass' : 'block'
}

/**
 * 光線に沿って格子を手前から辿り (Amanatides & Woo の DDA)、最初の target のマスを返す。
 * 先に block に当たった・盤面の箱を抜けた・箱に入らなかったときは null。
 *
 * まず箱 [0, size) と光線が交わる区間を求め、箱の中だけを歩く。
 * 歩数は多くても sx+sy+sz なので、256³ の盤面でも 800 歩以内に収まる。
 */
export function pickCell(
  ray: Ray,
  size: Size3,
  roleAt: (x: number, y: number, z: number) => PickRole | null,
): Cell3 | null {
  const o = ray.origin, d = ray.dir

  // 1. 箱と交わる区間 [t0, t1] (slab 法)。軸に平行な成分は割らずに範囲だけ見る
  let t0 = 0, t1 = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < 0 || o[i] >= size[i]) return null
      continue
    }
    let ta = -o[i] / d[i]
    let tb = (size[i] - o[i]) / d[i]
    if (ta > tb) [ta, tb] = [tb, ta]
    if (ta > t0) t0 = ta
    if (tb < t1) t1 = tb
    if (t0 > t1) return null
  }

  // 2. 箱に入った点のマスから歩き始める。境界ちょうどで迷わないよう少しだけ内側に寄せる
  const ts = t0 + 1e-6
  const cell: Cell3 = [0, 0, 0]
  const step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    cell[i] = Math.min(size[i] - 1, Math.max(0, Math.floor(o[i] + d[i] * ts)))
    if (Math.abs(d[i]) < 1e-12) {
      step[i] = 0
      tMax[i] = Infinity
      tDelta[i] = Infinity
    } else {
      step[i] = d[i] > 0 ? 1 : -1
      tMax[i] = ((d[i] > 0 ? cell[i] + 1 : cell[i]) - o[i]) / d[i]
      tDelta[i] = Math.abs(1 / d[i])
    }
  }

  const limit = size[0] + size[1] + size[2] + 3
  for (let n = 0; n < limit; n++) {
    const role = roleAt(cell[0], cell[1], cell[2])
    if (role === 'target') return [cell[0], cell[1], cell[2]]
    if (role === 'block') return null
    // いちばん近い境界を越えて隣のマスへ
    let a = 0
    if (tMax[1] < tMax[a]) a = 1
    if (tMax[2] < tMax[a]) a = 2
    if (tMax[a] > t1) return null
    cell[a] += step[a]
    if (cell[a] < 0 || cell[a] >= size[a]) return null
    tMax[a] += tDelta[a]
  }
  return null
}

/** タッチの外れ補正で、押した点の周りを探す円の半径 (CSS px) */
export const TOUCH_PICK_RADII: readonly number[] = [6, 12]

/**
 * 押した点で外れたら、周りの円周上 (radii の各半径 × dirs 方向) も試す。
 * 当たったもののうち、**画面上の中心が押した点に一番近い**ものを選ぶ。
 * 押した点で当たればそれを返す (周りは見ない)。radii が空なら押した点だけを見る。
 *
 * 指は 1 マス (スマホ幅の既定の寄りで約 7〜11px) より太いので、
 * 中心が少し外れただけで押せないのを補う。
 */
export function pickNearest<P>(
  x: number,
  y: number,
  pickAt: (x: number, y: number) => P | null,
  centerOf: (hit: P) => { x: number; y: number } | null,
  radii: readonly number[] = [],
  dirs = 8,
): P | null {
  const center = pickAt(x, y)
  if (center !== null || radii.length === 0) return center
  let best: P | null = null
  let bestD = Infinity
  for (const r of radii) {
    for (let k = 0; k < dirs; k++) {
      const a = (2 * Math.PI * k) / dirs
      const hit = pickAt(x + r * Math.cos(a), y + r * Math.sin(a))
      if (hit === null) continue
      const c = centerOf(hit)
      const dist = c ? Math.hypot(c.x - x, c.y - y) : Infinity
      if (best === null || dist < bestD) {
        best = hit
        bestD = dist
      }
    }
  }
  return best
}
