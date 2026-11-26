# docs-web — 読解メモを読む用の Web (#434)

docs/vanilla (26.3 の読解メモ 21 本) と docs/research 17〜19 を、項目ごとのページで読む。
ページごとに「読んだ」と理解度 (0〜100) を残せて、節の単位で検索できる。

- 編集用の `app` とは HTML もビルドも別。`npm run build` と `deploy.yml` はここに触れないので、
  本番 (rdsim.com) と develop には出ない。出るのは **手元** と **PR のプレビューの `/docs/`** だけ
- md は書き換えない。`tools/docs-index` がビルド時に md を節とページに割って `public/data/` へ出す
  (生成物は追跡しない)
- 本文の `[実機 1.21.1: 名前]` の下に fixture の札が出て、「表示」を押すと 3D/2D で再生できる

## 起動

```bash
npm run dev:docs        # http://localhost:4330/ (ポートは固定)
```

md を直すと生成器が回り直して、開いているページに出る。
ポートを固定しているのは、既読と理解度の置き場 (localStorage) がオリジンごとに分かれるため。

## ビルド

```bash
npm run build:docs      # 生成器 → tsc -b → vite build --base /docs/ → docs-web/dist
npm run stage:docs      # docs-web/dist を app/dist/docs へ写す (先に npm run build が要る)
```

- `stage:docs` を使うのは PR のプレビュー (`pr-preview.yml`) と e2e (`playwright.config.ts`) だけ。
  手元で試した後は `rm -rf app/dist/docs` で戻す
- e2e (`npm run test:e2e`) は app の preview (4320) の `/docs/` で回す。手元では動いている 4320 を使い回すので、
  docs の無い preview が残っていると `e2e/docs-web.spec.ts` だけ落ちる。先に `lsof -ti:4320 | xargs -r kill` で止める。
  e2e の後も `app/dist/docs` が残るので、同じく `rm -rf app/dist/docs` で戻す
- ビルドした物を単体で見る時は `cd docs-web && npx vite preview --base /docs/ --port 4331`
  (`--base` を付けないと `/docs/data` が取れない)
- `VITE_DOCS_PREVIEW=1 npm run build:docs` で、PR のプレビュー用の注意の 1 行
  (「この記録は PR を閉じると消えます」) が入る

## 画面と URL

| URL | 中身 |
|---|---|
| `#/` | 最初の画面 (README の §1・全体の進み・続きから読む) |
| `#/v07/4.3` | ページ。ID は「メモの番号 + 見出しの番号」(docs/vanilla/07 の §4.3)。research は `r19/3.4` |
| `#/v07/2?s=2.3` | ページの中の節へ飛ぶ |
| `#/_search?q=…&doc=v07&f=need,fx` | 検索の結果 (メモ・要実機あり・版差あり・fixture あり・未読だけ で絞れる) |

`##` が 150 行を超えるメモだけ `###` でページを割る (564 ページ・節は 1,383)。
ページでない ID (`#/v07`・`#/v07/4`・ページの中の節) は、入っているページへ寄せる。

## fixture の札と 3D/2D のビューア

本文の `[実機 1.21.1: 名前]` は小さなチップになり、タグのある段落・箇条書きの直後に 1 行の札
(名前・ブロック数・tick 数・「表示」) が出る。表の中のタグの札は、表の後ろの 1 つの折りたたみにまとまる。
md には何も書かない (生成器がタグを拾う)。

- 「表示」を押すと、その場でビューアが開く。ビューアのチャンクと fixture の JSON はその時に初めて取る
- 操作は 再生 / 止める・1 tick 進む・最初へ。3D と 2D を切り替えられ、2D は層を ± で上下する
  (その層より上のブロックを外して真上から見る)
- 置いただけではページのスクロールを奪わない。枠をクリックするとドラッグ・wheel・ピンチで動かせ、
  Esc か外のクリックで戻る
- 同時に開けるのは 2 個まで。3 個目を開くと一番古い物が札に戻る。ページを移ると全部閉じる
- **再生するのはこのエンジンの計算**で、実機の記録ではない (実機の記録は fixture の `expect`)。
  skip つきの fixture は「今のエンジンは実機と違う」と理由を出して再生する。
  summon・item・kill を含む fixture は「エンティティは描かない」と出す
- 200 ブロックを超える fixture は「大きいので埋め込まない」と出し、開けない
  (上限は `tools/docs-index/fixtures.ts` の `FIXTURE_EMBED_MAX_BLOCKS`)

## 既読と理解度 (書き出しと読み込み)

- 置き場はブラウザの localStorage のキー `rdsim:docs:status:v1` の 1 個。サーバには送らない
- オリジンごとに別になる (手元の 4330・PR ごとのプレビュー)。**主な置き場は手元**と決めている。
  PR のプレビューの記録は PR を閉じると消える
- ほかへ持って行く時は、上の帯 (狭い幅では目次の引き出しの頭) の **書き出す** で
  `rdsim-docs-status-YYYYMMDD.json` を保存し、行き先で **読み込む** からそのファイルを選ぶ
- 読み込みは上書きではなく併合: ページごとに時刻の新しい方を残す。今の目次に無い ID も消さない
  (集計には数えない)
- 保存できないブラウザ (プライベートブラウズなど) では、画面を閉じるまでメモリで動き、1 行で知らせる
- 理解度を動かすと自動で「読んだ」になる。平均は理解度を付けたページだけで取る

形は `{ "v": 1, "pages": { "v07/4.3": { "r": 1, "u": 60, "t": "…" } }, "last": { "id": "v07/4.3", "t": "…" } }`
(`packages/docs-kit/src/status.ts`)。

## 検索・CLI・AI 向けの索引

Web の検索は、自前の 2-gram の索引 + BM25 (`packages/docs-kit/src/search.ts`)。
索引 (`data/search-index.json`) は検索の欄に初めて入った時に取る。

同じ索引を端末から引ける。md からその場で作るので、ビルドは要らない (約 1 秒)。

```bash
npm run docs:search -- リピーター ロック        # 語で探す (節の ID・見出し・file:line・抜粋)
npm run docs:search -- --id v07/4.3            # 節の本文 (下の節も含む)
npm run docs:search -- --id v07 --full         # メモの全文 (v07/0 は前置きだけ)
npm run docs:search -- --block repeater        # ブロック ID・和名 → クラス → 節
npm run docs:search -- --class RepeaterBlock   # クラス → 節 (00 の網羅表の担当欄)
npm run docs:search -- --fixture piston-basic  # fixture → 節
npm run docs:search -- --mark need ピストン     # 印で絞る (--doc v13 でメモで絞る・--limit で件数)
npm run --silent docs:search -- --json --block repeater   # JSON で受ける
```

- `--block` の表 (`tools/docs-index/blocks.json`) はレッドストーン部品だけ。表に無いブロックは
  「表に無い」と返る (メモに記述が無いという意味ではない。その時は語で探す)
- 無い ID は終了コード 1、使い方の誤りは 2

`npm run docs:index` (`build:docs` と `dev:docs` が先に回す) は、Web のデータと一緒に
AI 向けの索引を `docs-web/public/data/ai/` へ出す。PR のプレビューでは `/docs/data/ai/` から取れる。

| ファイル | 中身 |
|---|---|
| `sections.jsonl` | 節 1 件 = 1 行 (1,383 行)。`id`・`page`・`file`・`line`・`title`・`path`・`text` (md のまま)・`classes`・`fixtures`・`skipFixtures` (skip つき = 今のエンジンは実機と違う)・`marks` (凡例の印は数えない)・`refs`・`blocks` ほか |
| `by-class.json` | クラス → 節 (00 の網羅表の担当欄が主。本文の一致は補助の欄) |
| `by-fixture.json` | fixture → 節 (skip つきの物には印) |
| `by-block.json` | ブロック ID・和名 → クラス → 節 |
| `README.md` | 欄の説明と引き方 |

## 作り

| 場所 | 中身 |
|---|---|
| `docs-web/src/` | 殻 (ルータ・目次・ページ・状態の画面・検索の画面・fixture の札を動かす `Fixtures.tsx`) と素の CSS 1 本 |
| `packages/docs-kit/` | `@redstone/docs-kit`。生成物の型・ID・状態の保存・検索・fixture の札の HTML (のちの解説サイトと共用)。`@redstone/docs-kit/viewer` は `FixtureViewer` (deepslate と sim を含むので別の入口) |
| `tools/docs-index/` | 生成器 (分割・ID・参照の解決・印・HTML 化・索引・埋め込む fixture の `data/fixtures/*.json`) と CLI。`section-ids.txt` と `blocks.json` は追跡する |
| `e2e/docs-web.spec.ts` | 既読と理解度・検索・狭い幅 |
| `e2e/docs-fixture-viewer.spec.ts` | fixture の札とビューア。押すまでチャンクを取らない・再生と 2D・同時 2 個・開け閉め 20 回で文脈の警告が出ない・置いただけでは wheel でページが流れる・止まっている間は rAF が回らない |
| `tools/demo/docs-gif.mjs` | PR 用の GIF (目次 → ページ → 理解度 → 検索) |

節を足す・見出しの番号を変えると ID が変わる (その ID の既読の記録は外れる)。
`tools/docs-index` のテストが落ちたら `npm run docs:index -- --ids` で一覧を作り直す。
