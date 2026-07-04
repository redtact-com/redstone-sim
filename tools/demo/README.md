# tools/demo — fixture 再生デモ & PR GIF 自動化 (issue #70)

実機 Minecraft で検証済みの fixture (`packages/sim/test/fixtures/*.json`) を **そのまま
デモ回路として再生**し、コマンド一発で PR 品質の動作 GIF を出すための基盤。

fixture は「初期ブロック配置 + 入力 (tick,pos,action) + tick 数 + 期待状態系列」を持つ。
CI 回帰 (`fixtures.test.ts`) が実機一致を保証しているので、その同じ fixture をデモに
流せば **正しさが担保された動作 GIF** が得られる — これがこの仕組みの設計意図。

## 全体像

```
packages/sim/test/fixtures/*.json
        │  (import.meta.glob でビルド時同梱)
        ▼
app  ?demo=<name>  ──► DemoPage + IsometricView + HUD
        │  window.__demo (load / step / getStateAt / fitCamera / ready)
        ▼
tools/demo/demo-gif.mjs
   build → vite preview → Playwright で tick 送り screenshot → gifenc で GIF 合成
        ▼
.github/pr-assets/<branch>/<fixture>.gif
```

tick 意味論はテスト側 (`packages/sim/test/fixture-runner.ts`) と **完全一致**する。
どちらも `@redstone/sim` の共通ドライバ (`fixture-driver.ts` の `FixtureRunner` /
`runFixtureOnSim`) を使うため、`state[t] = tick t の ScheduledTick 完了後 + inputs[t]
適用直後` が bit-identical に再現される。

## デモページ (手元で見る)

```bash
npm run dev -w app
# ブラウザで  http://localhost:5173/?demo=dynamic-connect-push
```

`?demo=<fixture名>` を付けると専用のデモモードで起動する (通常の editor UI には影響しない)。
`window.__demo` で操作できる:

| API | 説明 |
| --- | --- |
| `ready: Promise` | ビューア初回描画完了で resolve |
| `load(nameOrJson)` | 別 fixture (名前 or fixture JSON) を読み込む |
| `step(): {tick}` | 1 tick 進めてその tick の入力を適用 |
| `getTick()` / `getMaxTicks()` / `isDone()` | 進行状況 |
| `getStateAt(x,y,z)` | 正規化 blockstate 文字列 (`'air'` 含む) |
| `fitCamera()` | region bounds から距離/回転を自動計算して回路を画面に収める |
| `getFixtureName()` | 読み込み中の fixture 名 |

## GIF キャプチャ CLI

```bash
npm run demo-gif -- <fixture名> [options]
```

前提: 一度だけ `npx playwright install chromium` を実行してブラウザを取得しておく。

| option | 既定 | 説明 |
| --- | --- | --- |
| `--out <path>` | `.github/pr-assets/<branch>/<fixture>.gif` | 出力先 |
| `--every <N>` | `1` | N tick ごとに 1 フレーム撮る (長い fixture の間引き) |
| `--frame-ms <ms>` | `400` | 各フレームの表示時間 |
| `--hold-ms <ms>` | `1200` | 最初と最後のフレームの表示時間 (見せ場で止める) |
| `--port <n>` | `4319` | vite preview のポート |
| `--no-build` | (off) | 既存の `app/dist` を使い build をスキップ (反復撮影用) |
| `--width/--height` | `800/620` | ビューポート |

例:

```bash
# 既定の出力先へ (現在のブランチ名フォルダに <fixture>.gif)
npm run demo-gif -- dynamic-connect-push

# 長い fixture を間引いて撮る
npm run demo-gif -- torch-burnout --every 4 --out /tmp/torch.gif
```

CLI は内部で `npm run build -w app` → `vite preview` を自動起動/終了する。
**必ず本番ビルド (preview) に対して撮る**のがポイント: dev サーバの React StrictMode
二重発火や HMR の揺れを避けるため。GIF 合成は `gifenc` + `pngjs` の pure JS で完結し、
ImageMagick / Python などの外部依存を持ち込まない。各フレームには HUD の TICK
カウンタが焼き込まれる (canvas ではなくデモ領域コンテナ `data-testid="demo-canvas"`
を screenshot するため)。

### pr-assets への出力規約

出力先の既定は `.github/pr-assets/<現在のブランチ名>/<fixture名>.gif`。
既存の PR GIF (`feedback_pr_demo_gif.md` の運用) と同じ場所・命名に揃えてあるので、
生成した GIF をそのまま PR 本文に貼れる。GIF 生成は CI に入れず**ローカル専用**
(重い + ブラウザ DL が要るため)。CI は E2E スモークのみを回す。

## E2E スモーク

```bash
npm run e2e            # 本番ビルド → vite preview → Playwright
```

`e2e/` に 3 本:

1. `editor-smoke` — パレット (data-testid) から wire+lever+lamp を配置 → START → +1 →
   レバートグルでランプ点灯を検証
2. `demo-smoke` — `?demo=` のロードと `window.__demo.step()` の系列 (押し込みで
   中央ダストが T 字化 15 給電) を検証
3. `nbt-roundtrip` — ⋯ メニューの NBT 保存で download を捕捉 → クリア → 再インポートで
   復元を検証

主要ボタン (`btn-start` / `btn-tick` / `btn-run` / `btn-edit` / `trigger-x-y-z` /
`palette-<type>` / `btn-menu` / `menu-nbt-save` / `nbt-file-input`) と、デモ領域
(`demo-canvas`) には `data-testid` を付与し、テキスト一致や DOM 構造依存を排除している。
グリッド配置と sim 状態読み取りだけは `window.__editorTest` 経由 (canvas ピクセル
校正が脆弱なため)。
