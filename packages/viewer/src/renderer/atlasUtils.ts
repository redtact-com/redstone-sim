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
 */
export async function buildAtlas32<T>(
  textures: Record<string, Blob>,
  AtlasClass: new (img: ImageData, idMap: Record<string, [number, number, number, number]>) => T,
): Promise<T> {
  const TEX = 32
  const keys = Object.keys(textures)
  const width = nextPow2(Math.ceil(Math.sqrt(keys.length + 1)))
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

/**
 * TextureAtlas.fromBlobs を呼ぶ前に textureBlobs を padding して
 * deepslate の upperPowerOfTwo バグを回避する。
 *
 * deepslate の fromBlobs は atlas 幅を upperPowerOfTwo(sqrt(N+1)) で決めるが、
 * upperPowerOfTwo がビット演算で float を truncate するため、
 * N+1 が完全平方数でないと atlas が小さすぎてテクスチャがはみ出す。
 * 例: N=20 → sqrt(21)≈4.58 → upperPOT(4.58)=4 → 4×4=16 スロット不足
 *
 * 対策: テクスチャ数を「次の正しい幅の二乗 - 1」個になるよう、
 * 既存の Blob を使い回してダミーエントリで埋める。
 */
export function padTextureBlobs(textureBlobs: Record<string, Blob>): void {
  const actualN = Object.keys(textureBlobs).length
  const neededW = nextPow2(Math.ceil(Math.sqrt(actualN + 1)))
  const neededSlots = neededW * neededW - 1 // index 0 は invalid texture 用

  if (actualN >= neededSlots) return

  const firstKey = Object.keys(textureBlobs)[0]
  if (!firstKey) return

  const dummyBlob = textureBlobs[firstKey]
  let p = 0
  while (Object.keys(textureBlobs).length < neededSlots) {
    textureBlobs[`__pad__${p++}`] = dummyBlob
  }
  console.log(`[atlasUtils] atlas padding: ${actualN} → ${neededSlots} (width=${neededW})`)
}
