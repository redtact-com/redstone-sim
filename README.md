# redstone-sim

Minecraft のレッドストーン回路をブラウザ上で**シミュレーションする**スタンドアロン
プロジェクト。回路エディタ + Tick 駆動のシミュレーションエンジン + 3D ビューアを
組み合わせ、実際の Minecraft に近い挙動を目指して作り込んでいくための土台。

## 構成（npm workspaces モノレポ）

```
redstone-sim/
├── packages/
│   ├── sim/      @redstone/sim     — Tick 駆動のシミュレーションエンジン（外部依存なし）
│   ├── editor/   @redstone/editor  — 単一 Y 層の回路エディタ（配置/削除/undo/wire 接続）
│   └── viewer/   @redstone/viewer  — deepslate + WebGL の 3D/トップダウンビューア
└── app/          フロントエンド（Vite + React + Tailwind v4）
    ├── src/
    │   ├── EditorPage.tsx  編集 ⇄ シミュレーションの単一画面 UI
    │   ├── nbtIO.ts        バニラ構造 NBT の入出力（deepslate）
    │   ├── mcAssets.ts     パレットアイコン用 mcmeta ベース URL
    │   └── App.tsx / main.tsx / index.css
    ├── public/
    │   └── resourcepack/   Mk.2 カスタムテクスチャ（無い場合は mcmeta CDN にフォールバック）
    └── scripts/genLocalModels.js  resourcepack → bundle.json 生成
```

`app` は `packages/*` を Vite alias / tsconfig paths でソース直参照する（ビルド不要・HMR 有効）。

## 対応ブロック

ワイヤー / レバー / トーチ（床・壁）/ リピーター（遅延 1–4）/ コンパレーター（比較・差引）/
ランプ / 固体ブロック。

回路は編集モードで組み立て、▶ START でシミュレーションモードに切り替えて Tick を進める。
バニラ構造 NBT（`.nbt`）の読み込み・書き出しに対応。

## コマンド

```bash
npm install          # ルートで一度（全 workspace を解決）
npm run dev          # 開発サーバ（app）
npm run build        # 本番ビルド（tsc -b && vite build）
npm run lint         # ESLint（app）
npm test             # sim / editor のユニットテスト（vitest）
npm run typecheck    # packages の型チェック
```

## デプロイ / PR プレビュー

- 本番: Cloudflare Pages プロジェクト `redstone-sim`（https://redstone-sim.pages.dev 、本番ブランチ = `deploy`、`app` で `npm run deploy`）
- PR プレビュー: PR を作成/更新すると GitHub Actions（`.github/workflows/pr-preview.yml`）が
  `https://pr-<N>.redstone-sim.pages.dev` にデプロイして PR にコメントする。PR クローズで自動削除。
- 必要な secrets（未設定の間はスキップされる）: `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`
  （権限「アカウント / Cloudflare Pages / 編集」。発行手順は issue #4 参照）

## クレジット

`app/public/resourcepack/` のテクスチャは **MK.2 Redstone**（by Kyouju and Nisai）を
利用しています。詳細は `app/public/resourcepack/credit.md` を参照。リソースパックが
無い場合はバニラテクスチャ（[misode/mcmeta](https://github.com/misode/mcmeta)）に
自動フォールバックします。
