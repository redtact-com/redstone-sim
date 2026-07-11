# 14. redtact (回路共有サイト) 連携 — 埋め込みの要件整理 (#66)

13 §4.3 の構想「共有回路 (NBT) の URL 受け取り表示・解説記事への埋め込み・記事側からの
tick 制御」を、実装 issue に分解できる粒度の要件へ落とす。10 の前例に倣い、本書は
**推奨案 + 根拠 (出典付き) + ユーザ判断ポイント**の提示に徹し、決定はしない。
ユーザ方針の原文は issue #62 (07:20 発言)・#66 に記録。

- 調査日: 2026-07-11。redstone-sim / redtact 両リポの 4 方面並列調査
  (sim 埋め込み面・redtact frontend・redtact backend・ホスティング/CSP) に基づく。
- 対応するサイト側リポ: `redtact-com/redtact` (frontend = Cloudflare Workers RR7 SSR、
  backend = Go + Caddy on VPS、ファイル = Cloudflare R2 private バケット)。

---

## 1. ゴールと非ゴール

**ゴール** (13 §1 の価値 1・2 の実装要件化):

1. redtact の回路詳細ページ・説明文・ヘルプ記事から、共有回路をブラウザ内で
   「動かして」確認できる (PC/ゲーム本体不要)
2. 記事側から tick 送り・再生/停止を制御できる埋め込みコンポーネント
3. 閲覧専用 (誤操作なし) を既定に、レバー等の入力トリガは選択的に許可

**非ゴール**:

- private/draft 回路の**外部埋め込み** (公開状態 published/unlisted のみ対象。
  owner 本人のプレビューは §4 案 B なら親ページの権限で自然に扱える)
- .mcworld 対応 (redtact 側でも事前変換前提)、エンティティ系 (13 §2 の境界原則)
- redtact ページを rdsim 側に埋め込む逆方向 (redtact は X-Frame-Options: DENY /
  frame-ancestors 'none' を明示しており方針として拒否)
- 汎用ブログ等、redtact 以外のサイト向けの公式サポート (動作は妨げないが保証しない)

## 2. 現状ファクト

### 2.1 redstone-sim (rdsim.com) の埋め込み面

| 項目 | 現状 | 出典 |
|------|------|------|
| エントリ | ルーター無し。`?demo=<fixture名>` の有無で DemoPage / EditorPage を分岐 | app/src/App.tsx:14-19 |
| 外部から回路を渡す手段 | **無し**。?demo= は同梱 fixture 名のみ、他はファイルピッカーの NBT import のみ | app/src/demo/fixtures.ts:12-47, EditorPage.tsx:591-603 |
| NBT import | deepslate でバニラ構造 NBT のみ双方向対応。accept に .litematic/.schem を含むがパーサ不在 (不一致) | app/src/nbtIO.ts:36,118-120 |
| 盤面制約 | 16×16 グリッド × 8 レイヤー (Y=0..7) 固定 | app/src/EditorPage.tsx:56-59, nbtIO.ts:112-113 |
| 再生制御 API | window.__demo / __editorTest (same-origin の page.evaluate 前提)。postMessage リスナーは 0 件 | app/src/DemoPage.tsx:33-43 |
| 閲覧専用モード | 無し。DemoPage が事実上 view 専用だがページ上に再生ボタン無し | app/src/DemoPage.tsx:166-201 |
| トレース | packages/sim に Tracer 実装済みだが app に UI 無し | packages/sim/src/trace.ts |
| 被埋め込み制御 | _headers 等一切無し = Pages 既定 (フレーム制限なし、現状どこからでも iframe 可) | app/public/, wrangler.toml |
| 実行時外部依存 | Google Fonts (VT323)・mcmeta CDN (テクスチャ fallback) | app/index.html:8-9, packages/viewer/src/renderer/mcAssets.ts:4-10 |
| 配信 | main→rdsim.com / develop→develop.redstone-sim.pages.dev / PR→pr-N | .github/workflows/deploy.yml |

### 2.2 redtact 側

| 項目 | 現状 | 出典 (redtact リポ) |
|------|------|------|
| ファイル取得 API | GET /api/v1/circuits/{id}/files/{fileId}/download (optionalAuth、published/unlisted は未ログイン可) → **presigned GET URL (R2, 有効 5 分)** を JSON で返す | backend/internal/handler/circuit_file.go:109-147, usecase/upload.go:28-35 |
| Bedrock 正規化 | StructureNormalize (issue#29/PR#31、**未マージ**) が .mcstructure / Bedrock-LE .nbt → **Java 構造 NBT (gzip)** の `@structure.nbt` variant を生成、DL レスポンスに normalized_url 併返。litematic/schem は対象外 | backend/internal/usecase/structurenormalize.go |
| 説明文レンダラ | 独自トークナイザ (React ノードのみ、HTML/iframe 注入不可)。`<preview>` 独自タグ→3D カードが既存拡張パターン。iframe 前例は YouTube 埋め込み 1 箇所 | frontend/app/components/elevator/circuits/DescriptionRenderer.tsx, circuit-detail.tsx:589-596 |
| 同時 WebGL 上限 | 説明文内ライブ 3D カードは MAX_LIVE_PREVIEWS=10 (FIFO) | DescriptionRenderer.tsx:47-68 |
| CSP | Report-Only 運用中 (enforce 昇格計画あり)。frame-src に rdsim.com **無し** | frontend/app/entry.server.tsx:12-24 |
| API CORS | exact-match allowlist (prod=redtact.com のみ) + Allow-Credentials 固定。rdsim.com からの fetch は preflight 403 | backend/internal/middleware/cors/cors.go:47-107 |
| R2 CORS | 全バケット一律で frontend origin のみ許可。presigned URL でも rdsim.com オリジンのブラウザ fetch は不可 | terraform/modules/cloudflare/main.tf:116-134 |
| 認証 cookie | SameSite=Lax → cross-site iframe 内から cookie 認証は不可 | backend/internal/handler/session.go:9-16 |
| 匿名レート制限 | 60 req/min/IP | backend/internal/config/config.go:48 |
| 記事機能 | 動的記事は無し。ヘルプは静的 TSX (iframe 直書き可) = パイロットに最適 | frontend/app/components/elevator/help/helpContent.tsx |
| dev ペア | dev.redtact.com + dev-api.redtact.com ↔ develop.redstone-sim.pages.dev が対称 | 両リポ deploy workflow |

### 2.3 ブロック要因の本質 (3 点)

1. **CSP enforce 昇格時の frame-src** — 現状 Report-Only なので iframe は動くが、
   昇格前に `https://rdsim.com` (dev は develop.redstone-sim.pages.dev) の追記が必須
2. **CORS (API + R2)** — rdsim.com オリジンから redtact のデータを直接 fetch する
   構成を選ぶ場合のみ、backend allowlist と R2 cors_rules の両方に追加が必要
3. **presigned URL の 5 分期限** — URL をそのまま iframe に渡す設計はリロードで壊れ、
   秘匿 URL (unlisted はアクセストークン相当) を外部オリジンへ渡すことになる

「redtact ページに rdsim.com を iframe 表示するだけ」なら現状ブロック要因ゼロ。

## 3. 埋め込み形態の比較

| | (a) iframe + postMessage | (b) Web Component 配布 | (c) 外部リンクのみ |
|---|---|---|---|
| redtact 側の実装 | `<rdsim>` 説明文タグ + iframe カード (既存 `<preview>` パターン踏襲) | rdsim のバンドルを script 読み込み | ExternalLink (確認ダイアログ既存) |
| 分離・安全性 | ◎ オリジン分離。sanitizer 不要 | △ script-src 許可・依存/バージョン結合 | ◎ |
| WebGL 上限 | ◎ iframe 側のコンテキスト (lazy 化で制御) | △ 親ページの上限 10 を共食い | — |
| 記事側からの制御 | ◎ postMessage で可能 | ◎ props 直接 | ✕ |
| リリース独立性 | ◎ 両サイト独立デプロイのまま | ✕ redtact のビルドに rdsim が入る | ◎ |
| 実装量 | 中 | 大 | 小 (連携価値ほぼ無し) |

**推奨: (a) iframe + postMessage。** (b) は CSP/依存結合と WebGL 上限共有が重く、
(c) は「記事内で動かす」というゴール自体を満たさない。(c) の「シミュレータで開く」
外部リンクは (a) の補完としてほぼ無コストで併設できる。

## 4. 回路データの受け渡し — 3 案

| | 案 A: presigned URL を iframe src に直接渡す | 案 B: 親が fetch → postMessage でバイト転送 | 案 C: 自己完結 embed URL (?circuit=&file=) |
|---|---|---|---|
| 仕組み | `rdsim.com/embed?src=<R2署名URL>` | redtact ページが download API→R2 を fetch (自オリジンで CORS 許可済み) し、ArrayBuffer を iframe へ postMessage | iframe 自身が redtact API を叩き presigned URL→R2 を fetch |
| インフラ変更 | 不要 | **不要** | API CORS + R2 CORS へ rdsim.com 追加 (terraform) |
| リロード耐性 | ✕ 5 分で壊れる | ◎ 親が再取得 | ◎ 恒久 ID |
| 秘匿性 | ✕ 署名 URL が外部オリジン URL・Referer・履歴に漏れる | ◎ URL を外に出さない | ◎ 公開 API のみ |
| owner の非公開プレビュー | ✕ | ◎ 親の認証で取得したバイトを渡すだけ | ✕ (匿名アクセスのため公開回路のみ) |
| embed 単体での共有・直リンク | ✕ | ✕ (親が必須) | ◎ |

**推奨: Phase 1 = 案 B、Phase 2 = 案 C を追加。** 案 A は不採用
(「URL に秘匿情報を載せない」原則にも反する)。案 B は両リポの**フロントのみ**で完結し
インフラ変更ゼロで出せる。案 C は「埋め込みカードから rdsim を直接シェアする」「redtact
以外からも参照できる」価値が出た時点で、CORS 2 箇所 + GET 専用の長め expiry を検討する。

**データ形式は「バニラ構造 NBT (Java)」に一本化する** (推奨):

- rdsim の import 実装 (nbtIO.importFromNbtBytes) がそのまま使える
- redtact 側の StructureNormalize (PR#31) の出力形式と一致 — mcstructure/Bedrock NBT は
  normalized_url で解決。litematic/schem は正規化の対象拡張 (redtact 側 issue) 待ちとし、
  Phase 1 では「.nbt (Java 構造) + normalized_url があるファイル」のみ埋め込み可とする
- 代替案 (rdsim に litematic/schem パーサを移植) は変換ロジックの二重管理になるため非推奨

**ロード時の検証 (rdsim 側で必須)**:

- サイズ: 16×16×8 グリッドに収まらない構造は「大きすぎます」表示で graceful に拒否
  (将来のグリッド拡張とは独立の判定にする)
- スコープ外ブロック: 13 §3 マトリクスで非対応のブロックは **strip + 警告リスト表示**
  (「n 種のブロックは簡略化/無視されました」)。黙って消さない
- 上限 50MiB (redtact 側制限) はあるが、embed では実質グリッド制約が先に効く

## 5. 閲覧専用モードと postMessage プロトコル v1 (案)

### 5.1 embed エントリとモード

`/?embed=1` (または `/embed` パス) で埋め込み専用 UI を出す。既存 DemoPage とは別に、
**ページ上に再生コントロールを持つ**簡素なプレイヤーにする:

- **view (既定)**: 盤面 + 再生/一時停止/1 tick/リセット + tick カウンタ。編集不可
- **interact**: view + レバー・ボタン等の入力トリガのみタップ可 (activateBlock)。編集は不可
- **edit への導線**: 埋め込み内では編集させず、「rdsim で開く」リンクで本体 EditorPage へ
  (回路データは案 C 実装後は URL で、それまでは NBT ダウンロード経由)

### 5.2 プロトコル (親 = redtact ページ、子 = rdsim iframe)

メッセージは `{v: 1, type: 'rdsim:...', ...}`。子は `event.origin` を allowlist
(redtact.com / dev.redtact.com、?parentOrigin= で明示) と照合し、親も
`iframe.contentWindow.postMessage(msg, 'https://rdsim.com')` と target origin を固定する。

| 方向 | type | payload | 意味 |
|------|------|---------|------|
| 親→子 | rdsim:load | {format:'structure-nbt', bytes: ArrayBuffer (transfer)} | 回路ロード (案 B) |
| 親→子 | rdsim:step | {n?: number} | n tick 送り (既定 1) |
| 親→子 | rdsim:run / rdsim:pause / rdsim:reset | — | 再生/停止/初期状態へ |
| 親→子 | rdsim:trigger | {x,y,z} | 入力ブロック作動 (interact 相当を記事側から) |
| 親→子 | rdsim:setMode | {mode:'view'\|'interact'} | モード切替 |
| 子→親 | rdsim:ready | {v} | リスナー準備完了 (load はこれを待つ) |
| 子→親 | rdsim:loaded | {size:{x,y,z}, warnings: string[]} | ロード完了 + strip 警告 |
| 子→親 | rdsim:tick | {tick} | tick 進行通知 (記事側の表示同期用) |
| 子→親 | rdsim:error | {code, message} | too-large / parse-error 等 |

- window.__demo (E2E/GIF 用) は現状のまま温存し、embed は postMessage 層を正とする
- **トレース表示は Phase 3**: sim には Tracer があるが app 側 UI が未実装のため、
  プロトコルに rdsim:setTrace を予約するに留め、UI issue を別立てする

### 5.3 redtact 側の埋め込みカード

- 説明文: `<preview>` と同パターンの新タグ (例 `<rdsim file=...>`) → RdsimEmbedCard が
  iframe を lazy 生成し、download API (purpose=view) → R2 fetch → rdsim:load を実行
- 同時アクティブ数は `<preview>` の MAX_LIVE_PREVIEWS と同様の上限/FIFO を適用
- 挿入 UI は DescriptionEditor のタグビルダーに追加
- ヘルプ (静的 TSX) は直書き iframe で先行パイロットできる

## 6. セキュリティ・運用要件

1. presigned URL を iframe src・クエリに載せない (§4 案 A 不採用の理由。unlisted の
   URL はアクセストークン相当)
2. postMessage は両方向とも origin 固定 (§5.2)。`'*'` 禁止
3. 埋め込み対象は published/unlisted のみ。owner プレビュー (draft 等) は案 B の
   親認証経由に限る
4. redtact CSP: enforce 昇格前に frame-src へ本番/dev の rdsim origin を追加
   (entry.server.tsx は環境非依存の固定文字列のため環境別化の小改修を含む)
5. rdsim の frame-ancestors: **判断ポイント** (§8)。全開放継続 (学習ツールとして
   どこからでも埋め込み可) か、redtact + self 限定 (_headers 新設) か
6. dev 検証ペア: dev.redtact.com ↔ develop.redstone-sim.pages.dev。PR preview
   (pr-N.pages.dev) を親にする検証は CSP/origin allowlist に入れない (公開 URL のため)
7. rdsim の外部依存 (Google Fonts / mcmeta CDN) は iframe 内では自 CSP の管轄なので
   redtact 側変更は不要だが、オフライン/遮断環境での劣化表示は既知事項とする
8. openapi.yml の downloadCircuitFile が BearerAuth 宣言のまま (実装は optionalAuth) —
   外部連携の前提になる API なので redtact 側で仕様修正しておく

## 7. 実装 issue 分解案

**Phase 1 — 親経由埋め込み (インフラ変更ゼロ)**

| リポ | issue 案 | 内容 | 依存 |
|------|---------|------|------|
| redstone-sim | S1: embed エントリ + view/interact UI | ?embed=1、再生コントロール付きプレイヤー、編集無効化 | — |
| redstone-sim | S2: postMessage プロトコル v1 | §5.2 の load/制御/イベント + origin 検証。E2E は iframe 親を模す | S1 |
| redstone-sim | S3: 構造 NBT ロードの検証強化 | サイズ超過 graceful 拒否 / スコープ外ブロック strip + 警告リスト (nbtIO 拡張) | — |
| redtact | R1: `<rdsim>` 説明文タグ + RdsimEmbedCard | download API→R2 fetch→rdsim:load。lazy + 上限。DescriptionEditor 挿入 UI | S1,S2 |
| redtact | R2: CSP frame-src に rdsim origin 追加 | enforce 昇格タスクの前提。環境別 frame-src 化を含む | — |
| redtact | R3: ヘルプ記事パイロット | 静的 TSX に iframe 直書きで 1 記事分。R1 より先に出して UX 検証も可 | S1,S2 |

**Phase 2 — 自己完結 embed URL (案 C)**

| リポ | issue 案 | 内容 | 依存 |
|------|---------|------|------|
| redstone-sim | S4: ?circuit=&file= の直接ロード | redtact API を匿名で叩き presigned→fetch。エラー UI (非公開/期限切れ) | S1-S3 |
| redtact | R4: CORS 追加 (terraform) | API allowlist + R2 cors_rules へ rdsim origin (GET 限定ルールの分離を検討)。GET 専用 expiry 延長の要否も判断 | — |
| redtact | R5: 回路詳細に「シミュレータで動かす」 | 詳細ページから embed 起動 or rdsim へのリンク | S4,R4 |

**Phase 3 — 拡張**

| リポ | issue 案 | 内容 | 依存 |
|------|---------|------|------|
| redstone-sim | S5: トレース表示 UI | Tracer 出力のオーバーレイ + rdsim:setTrace 実装 | S2 |
| redtact | R6: StructureNormalize の litematic/schem 拡張 | `@structure.nbt` variant の対象形式追加 → 埋め込み可能ファイルが広がる | PR#31 マージ |

補足: Phase 1 の redtact 側は **normalized_url の存在 = PR#31 マージが実質前提**
(.nbt 生アップロードのみなら不要だが対象回路が限られる)。

## 8. 決定事項 (2026-07-11 ユーザ承認)

判断ポイント 1-4 を推奨どおり確定。以下を Phase 1 の実装前提とする。

1. **rdsim の被埋め込み方針** — **frame-ancestors 全開放を継続** (_headers を新設しない)。
   学習ツールとして個人ブログ等からの埋め込みも歓迎する方針 (13 §1 の価値 3 と整合)。
   redtact 側の CSP frame-src には rdsim origin を追加する (R2、redtact の被埋め込み拒否は
   従来どおり)
2. **Phase 2 (案 C) をやるか** — **Phase 1 完了後に判断** (現時点では着手しない)。
   まず案 B (親経由 postMessage) でインフラ変更ゼロの Phase 1 を出す
3. **interact モードの範囲** — **Phase 1 から interact を含める** (view + レバー/ボタンの
   手動トリガ)。13 §2 の折衷モデルと同じ思想
4. **embed の URL 形態** — **?embed=1 クエリ** (App.tsx の分岐追加で最小、現行 ?demo= と同型)
