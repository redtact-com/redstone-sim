/**
 * WorldSnapshot（@redstone/sim）を deepslate の Structure に変換する。
 */

import { Structure, BlockState as DSBlockState } from 'deepslate/render'
import type { WorldSnapshot, BlockState } from '@redstone/sim'

// ── deepslate Structure の内部型（structureMutator.ts と同じハック） ──
interface StructureInternal {
  size: [number, number, number]
  blocks: Array<{ pos: [number, number, number]; state: number }>
  blocksMap: Record<number, { pos: [number, number, number]; state: number }>
  palette: DSBlockState[]
}

// ── 全方向反転 ────────────────────────────────────────────────────────────────
// deepslate の top-down レンダリングでは north↔south かつ east↔west の両方が
// 内部座標と逆になる（カメラが 180° 回転した状態に相当）。
// 方向性ブロックの facing を 180° 反転させて表示とシムの向きを一致させる。

function flipDir(dir: string): string {
  if (dir === 'north') return 'south'
  if (dir === 'south') return 'north'
  if (dir === 'east')  return 'west'
  if (dir === 'west')  return 'east'
  return dir
}

// ── @redstone/sim の BlockState → Minecraft ブロック文字列 ──────────────

export function blockStateToMinecraftStr(block: BlockState): string {
  switch (block.type) {
    case 'wire': {
      // 'up'=上りステップ。接続方向は構造座標基準（隣接ブロックの相対位置と
      // 同じ座標系で描画されるため flipDir は適用しない）
      const val = (v: boolean | 'up') => v === 'up' ? 'up' : v ? 'side' : 'none'
      const e = val(block.connections.east)
      const n = val(block.connections.north)
      const s = val(block.connections.south)
      const w = val(block.connections.west)
      return `minecraft:redstone_wire[east=${e},north=${n},power=${block.power},south=${s},west=${w}]`
    }
    case 'torch':
      return `minecraft:redstone_torch[lit=${block.lit}]`
    case 'wall_torch':
      return `minecraft:redstone_wall_torch[facing=${flipDir(block.facing)},lit=${block.lit}]`
    case 'repeater':
      return `minecraft:repeater[delay=${block.delay},facing=${flipDir(block.facing)},locked=${block.locked},powered=${block.powered}]`
    case 'comparator':
      return `minecraft:comparator[facing=${flipDir(block.facing)},mode=${block.mode},powered=${block.powered}]`
    case 'lever': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:lever[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'button_stone': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:stone_button[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'button_wood': {
      const face = block.facing === 'up' ? 'floor' : block.facing === 'down' ? 'ceiling' : 'wall'
      const facing = (block.facing === 'up' || block.facing === 'down') ? 'north' : block.facing
      return `minecraft:oak_button[face=${face},facing=${facing},powered=${block.powered}]`
    }
    case 'lamp':
      return `minecraft:redstone_lamp[lit=${block.lit}]`
    case 'note_block':
      // instrument は sim で保持しないため harp 固定 (見た目に差は出ない)
      return `minecraft:note_block[instrument=harp,note=${block.note},powered=${block.powered}]`
    case 'pressure_plate_wood':
      return `minecraft:oak_pressure_plate[powered=${block.powered}]`
    case 'pressure_plate_stone':
      return `minecraft:stone_pressure_plate[powered=${block.powered}]`
    case 'weighted_pressure_plate_light':
      return `minecraft:light_weighted_pressure_plate[power=${block.powered ? block.pressedPower : 0}]`
    case 'weighted_pressure_plate_heavy':
      return `minecraft:heavy_weighted_pressure_plate[power=${block.powered ? block.pressedPower : 0}]`
    case 'redstone_block':
      return 'minecraft:redstone_block'
    case 'target':
      return `minecraft:target[power=${block.outputPower}]`
    case 'observer':
      // facing は反転しない (piston と同じ規則: 観測面/背面の相手は構造座標基準で
      // 描画されるため。sim.facing = vanilla FACING = 観測方向)
      return `minecraft:observer[facing=${block.facing},powered=${block.powered}]`
    case 'container':
      // コンテナは barrel として描画する (signal 値は表示に影響しない)。
      // barrel の blockstate は facing+open キーのバリアント形式のため、
      // プロパティ無しではどのバリアントにもマッチせず描画されない (#58)。
      // facing=up (蓋が上) をコンテナの見た目として採用する
      return 'minecraft:barrel[facing=up,open=false]'
    case 'piston':
    case 'sticky_piston':
      // facing は反転しない: head の出現位置 (構造座標) は非反転のため、
      // base モデルだけ flipDir すると逆向きに見える (wire 接続腕と同じ規則。
      // 実機と逆向きになるユーザ報告 2026-07-03 で確定)
      return `minecraft:${block.type}[extended=${block.extended},facing=${block.facing}]`
    case 'moving_piston': {
      // 途中伸び状態の近似表示 (vanilla は BE レンダラで補間するが、
      // グリッド描画では中間 1 コマを静的に表す):
      // - 伸長中の head セル → short ヘッド (vanilla の中間状態用モデル)
      // - 収縮中の base セル → extended base (アーム収納中の見え方)
      // - 押される payload → 中身をそのまま
      const into = block.into
      if (into.type === 'piston_head') {
        return `minecraft:piston_head[facing=${into.facing},short=true,type=${into.sticky ? 'sticky' : 'normal'}]`
      }
      if (into.type === 'piston' || into.type === 'sticky_piston') {
        return `minecraft:${into.type}[extended=true,facing=${into.facing}]`
      }
      return blockStateToMinecraftStr(into)
    }
    case 'piston_head':
      return `minecraft:piston_head[facing=${block.facing},short=false,type=${block.sticky ? 'sticky' : 'normal'}]`
    case 'solid':
      return 'minecraft:stone'
    case 'air':
      return 'minecraft:air'
  }
}

// ── ブロック文字列 → name + props ──────────────────────────────────────

function parseBlockStr(blockStr: string): { name: string; props: Record<string, string> } {
  const bracketIdx = blockStr.indexOf('[')
  if (bracketIdx === -1) return { name: blockStr, props: {} }
  const name = blockStr.slice(0, bracketIdx)
  const props: Record<string, string> = {}
  const propsStr = blockStr.slice(bracketIdx + 1, -1)
  for (const kv of propsStr.split(',')) {
    const eq = kv.indexOf('=')
    if (eq !== -1) props[kv.slice(0, eq)] = kv.slice(eq + 1)
  }
  return { name, props }
}

// ── 既知ブロック名一覧（buildResources のプリロード用） ──────────────

export const VIEWER_PRELOAD_BLOCKS: string[] = [
  'minecraft:redstone_wire',
  'minecraft:redstone_torch',
  'minecraft:redstone_wall_torch',
  'minecraft:repeater',
  'minecraft:comparator',
  'minecraft:lever',
  'minecraft:stone_button',
  'minecraft:oak_button',
  'minecraft:oak_pressure_plate',
  'minecraft:stone_pressure_plate',
  'minecraft:light_weighted_pressure_plate',
  'minecraft:heavy_weighted_pressure_plate',
  'minecraft:redstone_lamp',
  'minecraft:note_block',
  'minecraft:piston',
  'minecraft:sticky_piston',
  'minecraft:piston_head',
  'minecraft:redstone_block',
  'minecraft:observer',
  'minecraft:barrel',
  'minecraft:stone',
  'minecraft:cobblestone',
  'minecraft:glass',
  'minecraft:smooth_stone',
  'minecraft:target',
]

// ── WorldSnapshot → Structure ────────────────────────────────────────

export interface SnapshotBounds {
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
}

export function worldSnapshotToStructure(snapshot: WorldSnapshot): {
  structure: Structure
  bounds: SnapshotBounds
} {
  if (snapshot.blocks.size === 0) {
    // 空スナップショット: snapshot.bounds のサイズで空の Structure を生成
    const { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } = snapshot.bounds
    const sX = maxX - minX + 1
    const sY = maxY - minY + 1
    const sZ = maxZ - minZ + 1
    const structure = new Structure([sX, sY, sZ]) as unknown as StructureInternal
    structure.blocks = []
    structure.blocksMap = {}
    structure.palette = []
    return {
      structure: structure as unknown as Structure,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    }
  }

  const { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] } = snapshot.bounds
  const sizeX = maxX - minX + 1
  const sizeY = maxY - minY + 1
  const sizeZ = maxZ - minZ + 1

  // deepslate Structure を空で生成してから内部を操作
  const structure = new Structure([sizeX, sizeY, sizeZ]) as unknown as StructureInternal
  structure.blocks = []
  structure.blocksMap = {}
  structure.palette = []

  for (const [key, block] of snapshot.blocks) {
    if (block.type === 'air') continue
    const [x, y, z] = (key as string).split(',').map(Number)
    const px = x - minX
    const py = y - minY
    const pz = z - minZ

    const blockStr = blockStateToMinecraftStr(block)
    if (blockStr === 'minecraft:air') continue

    const { name, props } = parseBlockStr(blockStr)
    const dsBlock = new DSBlockState(name, props)

    let stateIdx = structure.palette.findIndex(b => b.equals(dsBlock))
    if (stateIdx === -1) {
      stateIdx = structure.palette.length
      structure.palette.push(dsBlock)
    }

    const flatIdx = px * sizeY * sizeZ + py * sizeZ + pz
    const entry = { pos: [px, py, pz] as [number, number, number], state: stateIdx }
    structure.blocks.push(entry)
    structure.blocksMap[flatIdx] = entry
  }

  return {
    structure: structure as unknown as Structure,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  }
}

/**
 * スナップショットの差分だけ Structure を更新する。
 * シミュレーションの tick 後など、変化が少ない場合に効率的。
 */
export function patchStructureFromSnapshot(
  structure: Structure,
  oldSnapshot: WorldSnapshot,
  newSnapshot: WorldSnapshot,
  bounds: SnapshotBounds,
): void {
  const s = structure as unknown as StructureInternal
  const [, sY, sZ] = s.size
  const { minX, minY, minZ } = bounds

  const allKeys = new Set([...oldSnapshot.blocks.keys(), ...newSnapshot.blocks.keys()])

  for (const key of allKeys) {
    const oldBlock = oldSnapshot.blocks.get(key as `${number},${number},${number}`)
    const newBlock = newSnapshot.blocks.get(key as `${number},${number},${number}`)

    // 変化なし
    if (JSON.stringify(oldBlock) === JSON.stringify(newBlock)) continue

    const [x, y, z] = (key as string).split(',').map(Number)
    const px = x - minX
    const py = y - minY
    const pz = z - minZ

    const flatIdx = px * sY * sZ + py * sZ + pz

    if (!newBlock || newBlock.type === 'air') {
      // 削除
      delete s.blocksMap[flatIdx]
      s.blocks = s.blocks.filter(b => b.pos[0] !== px || b.pos[1] !== py || b.pos[2] !== pz)
    } else {
      const blockStr = blockStateToMinecraftStr(newBlock)
      const { name, props } = parseBlockStr(blockStr)
      const dsBlock = new DSBlockState(name, props)

      let stateIdx = s.palette.findIndex(b => b.equals(dsBlock))
      if (stateIdx === -1) {
        stateIdx = s.palette.length
        s.palette.push(dsBlock)
      }

      if (s.blocksMap[flatIdx]) {
        s.blocksMap[flatIdx].state = stateIdx
        const arr = s.blocks.find(b => b.pos[0] === px && b.pos[1] === py && b.pos[2] === pz)
        if (arr) arr.state = stateIdx
      } else {
        const entry = { pos: [px, py, pz] as [number, number, number], state: stateIdx }
        s.blocksMap[flatIdx] = entry
        s.blocks.push(entry)
      }
    }
  }
}
