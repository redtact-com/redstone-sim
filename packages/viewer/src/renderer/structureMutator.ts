import { Structure, StructureRenderer, BlockState } from 'deepslate/render'

/** deepslate の Structure 内部型（addBlock は配列に追加するため直接操作する） */
export interface StructureInternal {
  size: [number, number, number]
  blocks: Array<{ pos: [number, number, number]; state: number; nbt?: unknown }>
  blocksMap: Record<number, { pos: [number, number, number]; state: number; nbt?: unknown }>
  palette: BlockState[]
}

/**
 * 指定座標のブロックのプロパティを部分更新する。
 * 存在しない座標は無視する。
 */
export function updateBlockProps(
  structure: Structure,
  renderer: StructureRenderer,
  pos: [number, number, number],
  patchProps: Record<string, string>,
): void {
  const s = structure as unknown as StructureInternal
  const [, sy, sz] = s.size
  const idx = pos[0] * sy * sz + pos[1] * sz + pos[2]
  const existing = s.blocksMap[idx]
  if (!existing) return

  const oldState = s.palette[existing.state]
  const name = oldState.getName().toString()
  const currentProps = oldState.getProperties() as Record<string, string>
  const newProps = { ...currentProps, ...patchProps }

  const newBlockState = new BlockState(name, newProps)
  let newStateIdx = s.palette.findIndex(b => b.equals(newBlockState))
  if (newStateIdx === -1) {
    newStateIdx = s.palette.length
    s.palette.push(newBlockState)
  }

  existing.state = newStateIdx
  const arrEntry = s.blocks.find(
    b => b.pos[0] === pos[0] && b.pos[1] === pos[1] && b.pos[2] === pos[2]
  )
  if (arrEntry) arrEntry.state = newStateIdx

  renderer.updateStructureBuffers()
}

/**
 * 指定座標のブロックを blockStr で上書きする（視覚のみ更新）。
 * "minecraft:air" を渡すとブロックを削除する。
 * @param blockStr 例: "minecraft:stone" / "minecraft:redstone_wire[power=0,east=none,...]"
 */
export function setBlock(
  structure: Structure,
  renderer: StructureRenderer,
  pos: [number, number, number],
  blockStr: string,
): void {
  const s = structure as unknown as StructureInternal
  const [, sy, sz] = s.size
  const [bx, by, bz] = pos
  const idx = bx * sy * sz + by * sz + bz

  if (blockStr === 'minecraft:air') {
    delete s.blocksMap[idx]
    s.blocks = s.blocks.filter(
      b => !(b.pos[0] === bx && b.pos[1] === by && b.pos[2] === bz)
    )
    renderer.updateStructureBuffers()
    return
  }

  // blockStr をパース: "namespace:name[key=val,...]"
  const bracketIdx = blockStr.indexOf('[')
  const name = bracketIdx === -1 ? blockStr : blockStr.slice(0, bracketIdx)
  const props: Record<string, string> = {}
  if (bracketIdx !== -1) {
    const propsStr = blockStr.slice(bracketIdx + 1, -1)
    for (const kv of propsStr.split(',')) {
      const eqIdx = kv.indexOf('=')
      if (eqIdx !== -1) props[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1)
    }
  }

  const newBlockState = new BlockState(name, props)
  let stateIdx = s.palette.findIndex(b => b.equals(newBlockState))
  if (stateIdx === -1) {
    stateIdx = s.palette.length
    s.palette.push(newBlockState)
  }

  if (s.blocksMap[idx]) {
    s.blocksMap[idx].state = stateIdx
    const arrEntry = s.blocks.find(
      b => b.pos[0] === bx && b.pos[1] === by && b.pos[2] === bz
    )
    if (arrEntry) arrEntry.state = stateIdx
  } else {
    const entry = { pos: [bx, by, bz] as [number, number, number], state: stateIdx }
    s.blocksMap[idx] = entry
    s.blocks.push(entry)
  }

  renderer.updateStructureBuffers()
}
