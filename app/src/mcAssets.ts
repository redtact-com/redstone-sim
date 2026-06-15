/**
 * パレットアイコン用の Minecraft アセット参照先。
 *
 * 3D ビューア（@redstone/viewer）はパッケージ内部で独自にテクスチャ解決を
 * 行う（ローカル resourcepack → mcmeta → PrismarineJS の順）。一方このアプリ
 * の素材パレットは小さなアイコン画像を直接 mcmeta CDN から引くだけなので、
 * ここではベース URL の定数のみを公開する。
 */

// テクスチャは misode/mcmeta（Java Edition モデルの参照パスと完全一致）
export const MCMETA_BASE = 'https://raw.githubusercontent.com/misode/mcmeta/assets/assets/minecraft'
