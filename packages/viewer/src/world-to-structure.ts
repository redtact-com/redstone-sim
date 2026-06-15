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
      const e = block.connections.east  ? 'side' : 'none'
      const n = block.connections.north ? 'side' : 'none'
      const s = block.connections.south ? 'side' : 'none'
      const w = block.connections.west  ? 'side' : 'none'
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
  'minecraft:redstone_lamp',
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
