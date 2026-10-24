/**
 * n 以上の最小の 2 のべき乗を返す。
 * deepslate の upperPowerOfTwo はビット演算で float を truncate するため、
 * sqrt(N) が整数でない場合に atlas サイズが小さくなるバグを回避するために使う。
 */
export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/**
 * 32×32 スロットのカスタム TextureAtlas を構築する。
 *
 * deepslate の TextureAtlas.fromBlobs は drawImage の source rect を
 * 固定で 16×16 ピクセルにしているため、32×32 テクスチャは下半分が欠落する。
 * この関数はスロットサイズを 32×32 にし、全テクスチャを等倍で描画することで
 * 高解像度テクスチャを正しくアトラスに収める。
 *
 * UV 座標は deepslate 標準（スロット列/行インデックス ÷ 幅）と同一なので
 * StructureRenderer との互換性を保つ。
 *
 * `solids` は「色で塗るスロット」(#395)。テクスチャが届かなかった面や簡易表示の立方体に使う。
 * Blob を作らず fillRect で塗る。画像のスロットの後ろに並べるので、空なら今までと同じアトラスになる。
 * 同じ id が `textures` にあれば画像を優先する。
 */
export async function buildAtlas32<T>(
  textures: Record<string, Blob>,
  AtlasClass: new (img: ImageData, idMap: Record<string, [number, number, number, number]>) => T,
  solids: Record<string, string> = {},
): Promise<T> {
  const TEX = 32
  const keys = Object.keys(textures)
  const solidKeys = Object.keys(solids).filter(id => !(id in textures))
  const width = nextPow2(Math.ceil(Math.sqrt(keys.length + solidKeys.length + 1)))
  const pixelWidth = width * TEX
  const part = 1 / width

  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelWidth
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false  // ピクセルアート: ニアレストネイバー

  // slot 0: invalid texture（黒＋マゼンタ市松）
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, TEX, TEX)
  ctx.fillStyle = 'magenta'
  ctx.fillRect(0, 0, TEX / 2, TEX / 2)
  ctx.fillRect(TEX / 2, TEX / 2, TEX / 2, TEX / 2)

  const idMap: Record<string, [number, number, number, number]> = {}
  let index = 1

  // 色で塗るスロットは画像の後ろ (1 + keys.length 番目から)
  solidKeys.forEach((id, i) => {
    const slot = 1 + keys.length + i
    const u = slot % width
    const v = Math.floor(slot / width)
    idMap[id] = [part * u, part * v, part * u + part, part * v + part]
    ctx.fillStyle = solids[id]
    ctx.fillRect(TEX * u, TEX * v, TEX, TEX)
  })

  await Promise.all(keys.map(async (id) => {
    const u = index % width
    const v = Math.floor(index / width)
    index++
    idMap[id] = [part * u, part * v, part * u + part, part * v + part]
    const bmp = await createImageBitmap(textures[id])
    // ソース全体を 32×32 スロットにスケーリング
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, TEX * u, TEX * v, TEX, TEX)
  }))

  return new AtlasClass(ctx.getImageData(0, 0, pixelWidth, pixelWidth), idMap)
}
