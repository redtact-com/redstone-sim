/**
 * パレットアイコン用の Minecraft アセット参照先。
 *
 * 3D ビューア (@redstone/viewer) はパッケージ内部で独自にテクスチャ解決を行う
 * (ローカル resourcepack → mcmeta → PrismarineJS の順)。一方このアプリの素材パレットは
 * 小さなアイコン画像を直接 mcmeta CDN から引くだけなので、ベース URL だけが要る。
 *
 * **ここに定数を再定義しない** (#276)。以前ここだけ動くブランチ (`assets`) を指したままで、
 * ビューア側をタグ固定しても**パレットのアイコンだけ別バージョンを引く**状態になっていた。
 * ビューアの 1 か所を正として re-export する。
 */
export { MCMETA_BASE } from '@redstone/viewer'
