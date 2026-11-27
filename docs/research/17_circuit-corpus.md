# 17. 実回路コーパスの入手先と集め方 — 26.3 の Rust エンジンを確かめる回路をどこから集めるか

redstone-sim は今後、Java 版 26.3 と同じ挙動の Rust (WASM) エンジンを作る。
その正しさを確かめる回路が、手元にほとんど無い。リポにコミットされた .litematic・.schem・.nbt は 0 本である。
あるのは手書きの実機 fixture と、tests/circuits の rstest だけだ。
本書は、回路と正解データを**どこから・どんな条件で・どれだけ**集められるかを整理する。
そのうえで、置き場所の分け方と集める順番を提案する。

- 調査日: 2026-11-26。作業ツリーは develop と同じ (d57d70b)。
- 今回は入手先と計画の整理だけである。**回路ファイル本体はダウンロードしていない**。
  - 見たのは README・ライセンス・説明文書・ファイル一覧・件数・目録 (メタデータの JSON・TSV) だけ。GitHub は gh api のツリーと文書、redtact は MCP の get_catalog_overview・search_circuits・get_circuit を使った。
  - redtact の get_circuit_file_url と get_circuit_structure は呼んでいない。
  - 例外として、手元に既にある 4 ファイルだけはサイズ・SHA-256・DataVersion・外形を読んだ (§1.3)。
- 確かさの表記: **[確定]** = 一次資料 (API の返り値・リポの実物・規約の原文) で確かめた。**[要確認]** = 推定か、原文を取れなかった。
- 法律の助言ではない。判断に迷うものは入れない (docs/ip-policy.md の原則)。
- 関連資料:
  - 01 (情報源)、03 (法務。著作権法 30 条の 4 の整理)、06 (検証ツール)、07 (Mojira の原票)
  - 13 (範囲。エンティティは扱わない)、14 (redtact 連携)、15 §2.2 (LICENSE が無い)、16 (Nucleation との比較)
  - docs/vanilla (26.3 の挙動のメモ。入口は docs/vanilla/README.md)。各メモの §8 が「検証用のプローブ回路案」、版差の一覧は docs/vanilla/19_version-diffs.md

---

## 0. 結論

1. **主軸は、自作のプローブ回路を実機で撮ること**。
   - docs/vanilla の各メモ §8 の回路を fixture 定義に起こし、実機ハーネスで tick ごとに撮る。
   - 自作の回路と自前の観測なので、公開リポにそのまま置ける。
   - 実回路は、素子が組み合わさったときの結合テストに回す。
2. **26.3 で撮るハーネスがまだ無い**。
   - 今のハーネスは Fabric 1.21.1 + carpet (tools/mc-harness/docker-compose.yml)。
   - 26.3 は Java 25 で動き、DataVersion は 5023 [確定: Mojang の版 JSON とサーバ jar の version.json]。
   - carpet・Carpet-TIS-Addition・Litematica・Redstone Multimeter には 26.3 版が出ている [確定: Modrinth API]。
3. **版がぴったり合う公開データは redstonepedia だけ**。
   - vjeux/redstonepedia (MIT、2026-10-18 開始) は、26.3 のサーバのクラスを headless で動かす。
   - 自前の設計を大量に持つ。3×3 ドア 1,690・クロック 815 種 (+ 変種 826)・装置 534。
   - 26.3 の実機の記録も持つ。回路寄りは 79 件 (§2.3)。
4. **Nucleation の正解は 26.2 (103 本) と 1.21.11 (14 件) で、26.3 は無い**。
   - 自作の構造物 (.snbt、MIT) を入力として借り、自前の 26.3 ハーネスで撮り直す。
5. **redtact の Java 回路は 28 本**。
   - 13 本はプロジェクト所有者自身の投稿。残り 15 本は他者の作品である。
   - 規約は、投稿を「本サービス上での表示・共有のために利用」と定める。公開リポに入れるには作者の了解が要る。
   - AI のファイル読み取りを許可した回路は 15/28。他者の作品に限ると 2/15。
6. **既存の fixture と PR の添付には、実回路に由来するものがある** (§1.4)。
   - 出どころと作者の了解を最初に確かめる (§6 の段階 0)。対象の一覧と確認の状況は公開資料に書かず、非公開の管理 (Project #1 の draft) で扱う。
7. Mojira の添付・コミュニティサイト・ライセンスの無い GitHub アーカイブは**手元だけ (b)** にする。
   - コミットするのは一覧・ハッシュ・入手元の URL・キャプチャ定義だけ。
8. redstone-sim には**まだ LICENSE が無い** (15 §2.2 の指摘のまま)。第三者のデータ (MIT・LGPL) を入れる前に決める。

---

## 1. 今あるもの (自前)

### 1.1 数

| 資産 | 置き場 | 数 | 版 | 正解の出どころ |
|---|---|---|---|---|
| fixture 定義 | tools/mc-harness/fixtures/ | 134 本 | 1.21.1 | 手書き (一部は実回路を最小化したもの) |
| 生成済み fixture | packages/sim/test/fixtures/ | 150 本 (定義の無いもの 16 本を含む) | 150 本とも mcVersion 1.21.1 | 149 本は実機ハーネスで撮った expect を持つ。1 本 (network-piston-be-order) は expect の無い placeholder で、手作業の観測は 09_snapshots にある |
| 同上の内訳 | | 手書き 136 本・実回路から得たもの 14 本 (description の語で数えた目安) | | |
| 同上の長さ | | tick 合計 4,286、中央値 16、最長 400 | | skipUntil 付きは 5 本 |
| rstest | tests/circuits/ | 131 本 (18 フォルダ) | — | **期待値は sim に流した値の書き写し** (tests/circuits/README.md)。fixture を土台にしたもの 70 本、単独 61 本 |
| トレース | packages/sim/test/traces/ | 4 本 | — | 08 の記法による sim の出力 |
| MCHPRS 移植 | packages/sim/test/mchprs-ported.test.ts | 12 本 | — | MCHPRS のテスト (MIT) の書き起こし (§2.4) |
| キャプチャ定義 | tools/mc-harness/captures/*.def.json | 18 本 | — | 手元の回路ファイル 4 本を参照する (§1.3) |

[確定: 2026-11-26 に作業ツリーで数えた]

### 1.2 実機の正解の範囲

- 150 本はすべて 1.21.1 で撮った。26.3 で同じ結果になるかは、docs/vanilla/19_version-diffs.md で確かめる。
  - 例: docs/vanilla/07_diodes.md §6 は、ダイオードの範囲なら既存の fixture が 26.3 にもそのまま通用すると読む。
- rstest は sim の回帰テストであり、実機の正解ではない。
  - fixture を土台にした 70 本は、土台の部分だけ実機の裏付けがある。
- 26.3 の Rust エンジンの正解には、少なくとも次の 2 つが要る。
  1. 26.3 で撮り直した fixture
  2. 26.3 で新しく撮るプローブ回路

### 1.3 手元の回路ファイル (キャプチャ定義が参照する 4 本)

置き場は tools/mc-harness/circuits/ (gitignore 済み。MC_CIRCUITS_DIR で変えられる。#322)。
この 4 本は、本調査で中身の先頭を読んだ。読んだのはサイズ・SHA-256・DataVersion・外形だけである。

| ファイル | バイト | SHA-256 | DataVersion | 外形 (x, y, z) | 参照する定義 | 出どころ |
|---|---|---|---|---|---|---|
| Runa.S_opened.nbt | 4,313 | 91fac057a67745aa6e2ec8a47ba95d78e2bc6550a71a79ddc2813e202db97b19 | 4790 | 11, 12, 4 | runa-open 系 5 本 | 他者の作品 (照合は非公開の管理表) |
| Runa.S_closed (1).nbt | 4,915 | 70f4aaf2034ae4edfd1876418be1e2b28b3f9d07d65a76c230667df854e17556 | 4790 | 6, 12, 14 | runa-closed 系 4 本 | 他者の作品 (照合は非公開の管理表) |
| circuit (1).nbt | 2,042 | 89ac6a1006679adda59b85702618f2180ae01275670364672d43ad0bb88e282e | 無し | 16, 12, 16 | circuit1・c1-cycle | 他者の作品にユーザがレバーを足し、rdsim.com から書き出したもの (#231。照合は非公開の管理表) |
| TAKU128_DoubleSidedGlassElevatorMultipleFloors.litematic | 8,281 | 2cfc113b40ff134acf13812ca81452372621757a86f12c842d810c2be2f121e0 | 4435 (Litematica 形式 7) | 7, 147, 17 | elev 系・elevator 系 7 本 | プロジェクト所有者自身の投稿「外の景色が見える！エレベーターの作り方」(17 x 7 x 147)。ファイル名も一致 [確定: get_circuit] |

読み取った事実と、そこから言えること:

- DataVersion の目安: 1.21.1 = 3955、1.21.11 = 4671、26.2 = 4903、26.3 = 5023。
  - 4790 は 1.21.11 と 26.2 の間 (26.1 系) に当たる。4435 は 1.21.1 より新しく、1.21.11 より古い。
  - どれも 26.3 より古いので、26.3 では DataFixer で読める。
- どの投稿に当たるか、キャプチャ定義の名付け (開いた状態と閉じた状態の組) が正しいかの照合は、非公開の管理表で行う [要確認]。
- circuit (1).nbt には DataVersion が無い。rdsim の書き出しが付けないためと考える。外形 (16, 12, 16) は rdsim の盤面に合わせた余白込みで、元の外形は redtact の表記で 11 x 6 x 12。
- 以前は手元にあり、今は無いファイルもある (#213 ほか)。出どころの照合は同じく非公開の管理表で行う。
- 所有者自身の作品 1 本を除き、ほかは他者の作品である。

### 1.4 実回路に由来する既存の fixture

- 既存の fixture の一部は実回路をもとにしている。description に出どころを書いてある。
- 実回路を最小化した小さな断片 (13〜33 ブロック。例: observer-dropper-conductor・piston-land-front-land・observer-carried-powered-landing・dropper-into-hopper-cooldown・observer-pull-pulse) は、機構の一部だけで作品の形はほぼ残らない。出どころを書いたまま (a) でよいと考える (法的判断ではない)。
- 回路の大部分をそのまま持つ fixture と、PR に添付した動作 GIF は、作者の了解の有無を確かめる。対象と確認の状況は公開資料に書かず、Project #1 の非公開の draft で管理する。扱いの選択肢 (了解を取る・手元だけ (b) に移す・最小化した断片に置き換える) は §6 の段階 0。

---

## 2. 入手先ごとの調査

### 2.1 redtact (プロジェクト所有者の回路共有サイト)

#### 2.1.1 全体 [確定: get_catalog_overview・search_circuits、2026-11-26]

| 項目 | 値 |
|---|---|
| 公開回路 | 42 本 |
| 版 | Java 26 本・統合版 14 本・申告なし 2 本。申告なしの 2 本はどちらも .litematic なので、本書では Java と見なす (計 28 本) |
| 形式 (全 42 本で、その形式のファイルを持つ回路の数) | litematic 21・nbt 11・schem/schematic 6・mcstructure/mcworld 14 |
| Java 28 本のファイル | 38 個 (litematic 24・nbt 8・schem 6) |
| 申告された版 (Java、範囲で申告するので重複して数える) | 26.1.x 9・1.21.x 23・1.20.x 16・1.19.x 12・1.18.x 6・1.17.x 6・1.16.x 5・1.11〜1.15 各 1。**26.2・26.3 を申告した回路は無い**。範囲が 1.21.1 を含むものは 21 本 |
| AI のファイル読み取り (ai_file_access) | Java 28 本のうち 15 本が許可。所有者自身の 13 本はすべて許可、他者の 15 本では 2 本 |
| タグ | 全 42 本のうち 9 本はタグ無し。扉・エレベーター・論理回路はタグが細かい |

- 申告された版は投稿者の自己申告で、範囲で書かれる (例: 「java 1.11-1.21.11 (52 versions)」)。実際に保存した版はファイルの DataVersion で決まる。
- 統合版の 14 本は対象外にする (Java 版の挙動を確かめる正解にならない)。

#### 2.1.2 Java 28 本の内訳

他者の作品 15 本は、作者名と個々の回路を公開資料に載せない (一覧は redtact の MCP の search_circuits でいつでも取れる)。分類ごとの数は 扉 6・論理 7・装置 1・不明 1 で、AI のファイル読み取りを許可しているのは 2 本 (扉)。

所有者自身の 13 本は次のとおり。「AI」は ai_file_access、「申告版」は投稿時の申告。外形は redtact の表記で、横の長い辺 x 短い辺 x 高さ。

| 分類 | 回路 | ファイル | 申告版 | AI | 外形 |
|---|---|---|---|---|---|
| エレベーター | [[Teaser] The Best Elevator ? (JE)](https://redtact.com/circuits/bx7rFqjI18eX) | litematic 2 | 1.21〜26.1.2 | 可 | 20 x 7 x 93 / 20 x 7 x 193 |
| エレベーター | [5bps Slime Elevator【JE】](https://redtact.com/circuits/RIifMbzmdrkD) | litematic 2 | 1.21〜26.1.2 | 可 | 19 x 7 x 128 / 19 x 7 x 268 |
| エレベーター | [高速で動く！本格的なエレベーター](https://redtact.com/circuits/a9sXRCPq948H) | litematic 1 | 1.19〜26.1.2 | 可 | 10 x 9 x 124 |
| エレベーター | [外の景色が見える！エレベーターの作り方【Java 1.19】](https://redtact.com/circuits/cbNPAyXT0jxA) | litematic 1 | 1.21〜26.1.2 | 可 | 17 x 7 x 147 |
| エレベーター | [幅３エレベーター](https://redtact.com/circuits/PiiSOMn0SRED) | litematic 1 | 1.19〜1.21.11 | 可 | 15 x 6 x 40 |
| エレベーター | [製作途中のエレベーター](https://redtact.com/circuits/MDaXHIYUgueF) | litematic 1 | 1.19〜1.21.11 | 可 | 37 x 23 x 163 |
| 論理 | [Ripple Carry Adder](https://redtact.com/circuits/U0PWGqMdMq0H) | litematic 1 | 1.16〜1.21.11 | 可 | 156 x 16 x 5 |
| 論理 | [Time Transceiver](https://redtact.com/circuits/j62puRwcoEVI) | litematic 1 | 1.19〜1.21.11 | 可 | 16 x 4 x 2 |
| 論理 | [じゃんけん回路](https://redtact.com/circuits/0VQ9YICZ6snP) | litematic 1 | 1.17〜1.21.11 | 可 | 15 x 7 x 6 |
| 装置 | [オブレス隠し作業台](https://redtact.com/circuits/A4XSkUmMJO2D) | litematic 1 | 1.11〜1.21.11 | 可 | 5 x 4 x 5 |
| 装置 | [tree_farm](https://redtact.com/circuits/F1YcGzSB25pA) | litematic 1 | 1.19〜1.21.11 | 可 | 9 x 9 x 23 |
| 装置 | [ポーション製造機](https://redtact.com/circuits/VuzVKECZxy53) | litematic 1 | 1.19〜1.21.11 | 可 | 34 x 5 x 12 |
| 建築 | [japanese_castle](https://redtact.com/circuits/dCziICjmJBwD) | litematic 1 | 1.16〜1.21.11 | 可 | 64 x 48 x 78 (回路ではない) |

- 扉の投稿 (他者の作品) には、開いた状態と閉じた状態のファイルを両方持つものがある。「状態 A から入力で状態 B になる」答え合わせに向く。
- 論理回路は「無遅延」(0 tick 系) を含み、ダスト・トーチ・コンパレーターの密な結合を試せる。
- 所有者自身の作品をコーパスに入れるか (区分) は所有者が決める。

#### 2.1.3 規約と AI 読み取りの意味

- 利用規約 §2「投稿コンテンツ」(最終更新 2026-10-11) [確定: https://redtact.com/terms]:
  - 責任は投稿者に帰属する。
  - 投稿コンテンツは「本サービス上での表示・共有のために利用されます」。
- AI のファイル読み取りの許可は、AI アプリがファイルを保存したり中身を読んで説明したりすることへの許可である [確定: https://redtact.com/ai]。**再配布の許諾ではない**。
- 結論: 他者の投稿を公開リポに入れるには、作者ごとの了解が要る。
  - 了解を取るまでは、所有者が手で落として手元だけ (b) で使う。
  - 手元での実行・計測は、03 と同じく著作権法 30 条の 4 (享受を目的としない利用。第 1 号は技術の開発・実用化のための試験) の整理に入ると考える。公開 (公衆送信) はこの整理に入らない (法的判断ではない)。

#### 2.1.4 正解データにする手順

1. 所有者が redtact のページからファイルを落とす (AI には落とさせない。今回の方針)。
2. tools/mc-harness/circuits/ に置き、manifest (§5.3) に SHA-256・URL・作者・区分を書く。
3. captures/<名前>.def.json を書く。入力はレバー・ボタン・書見台・感圧板など、ページの説明に沿う。
4. 実機で撮る (npm run capture) → sim と突き合わせる (npm run gt-compare)。
5. 食い違いを自動で縮め (minimize)、小さな fixture として書き出す。断片は (a) にできる。
6. 扉の投稿は、開いた状態・閉じた状態の両方のファイルを初期状態にして、両方向の遷移を撮る。

- 落とす前の見積もりには、MCP の get_circuit_structure が使える。AI 読み取りが許可された回路なら、ブロックの種類と数をサーバ側で一覧できる。未対応のブロックがあるかを先に見られる (今回は使っていない)。

### 2.2 Nucleation (Schem-at/Nucleation、MIT)

16 の調査時点 (51de345、2026-09-28) から増えた。本書の数は aefd962 (2026-11-23) のもの [確定: gh api のツリー]。star は 30。

| 資産 | 置き場 | 数 | 版 | 中身 |
|---|---|---|---|---|
| ゴールデン (tick ごとの変化) | crates/mc-tick/tests/traces/*.json | 105 本 | 26.2 が 103 本、1.21.11 が 2 本 (flag2_observer・hipster_door) | 構造物 + 余白の全ブロックの、tick 終わりの変化 |
| 同上の内訳 (名前で分けた目安) | | 回路・ピストン系 47・扉 21・エンティティ系 35・水 2 | | エンティティ系 (トロッコ・アイテム・火の玉など) は 13 の範囲外 |
| 実機へ渡す構造物 | tools/gametest/pack/data/nucleation/structure/ | .snbt 130 本 | 主に 26.2 | エンジン側の写しは crates/mc-tick/tests/corpus/structures/ の 101 本。両者が同じファイルを読む設計 |
| 1.21.11 の実機ケース | crates/mc-tick/tests/corpus/ の *12111 フォルダ | 12 件 (JSON) | 1.21.11 (DataVersion 4671) | 塀 4・足場 3・ハチミツのピストン 1・コンパレーターの吸い出しとピストン QC 4。手書きの構造物と実機の撮影結果 |
| 終状態だけ見るシナリオ | crates/mc-tick/tests/cases/*.test.json | 11 件 | 26.2 | 指定 tick の状態だけ見る。順序は見ない |
| .litematic 埋め込みシナリオ | tests/scenarios/ | 1 本 (55 ブロック 3x3 ドア) | — | 世界記録の扉。作者の許諾は書かれていない |
| コミュニティ製の扉 | crates/mc-tick/tests/corpus/litematics/ | 7 本 | — | 3x3 flush・4x4 sliding・6x6・4x4 vault 3 種・TGM 4x4。許諾の記載が無い |
| Lithium の移植 | tests/corpus/lithium-litematic/ ほか | 20 本 + 対象外 11 本 | Lithium の固定コミット | LGPL-3.0。NOTICE.md が「MIT の範囲外」と明記する |
| コミュニティ回路の目録 | docs/performance/schematic-candidates/ | 2,373 パス・2,321 種 (15 グループ) | 主に 1.21.11 で検証 | **バイナリは再配布せず、目録とハッシュだけ持つ**。出どころごとにライセンスの状態を記録する |

使い方の判断:

- 自作の構造物 (.snbt) と記述子は MIT である。帰属を付ければ (a) に入れられる。
  - 正解は 26.2 なので、そのままでは 26.3 の正解にならない。**入力として借り、自前の 26.3 ハーネスで撮り直す**。
  - Nucleation のゴールデンは、撮り直した結果との横並びの比較に使う。26.2 と 26.3 で結果が違えば、版差の手がかりになる。
- コミュニティ製の扉 (corpus/litematics の 7 本、hipster_door、55_3x3) は (b) にする。
  - 例: hipster_door の元は「Fastest 3x3 Hipster — SpaceWalker and SoulBanished」の利用者提供の .litematic で、ライセンスは書かれていない。
- Lithium の移植は LGPL-3.0 のまま。扱いは §2.5 と同じ。
- **コードは移植しない** (16 §0 の 6 と同じ)。
- 目録の運用は手本になる。(b) の manifest (§5.3) と同じ考え方である。
  - 自分たちの「WorldRecordPlot」も、ライセンス不明として Git に入れず、ハッシュだけ残している。

### 2.3 redstonepedia (vjeux/redstonepedia、MIT) — 今回の新規

[確定: README・docs/internals.md・各 CATALOG・recorded.tsv、最新コミット 3896530 (2026-11-17)]

| 項目 | 内容 |
|---|---|
| 何か | 26.3 の公式サーバのクラスを、headless で 1 tick ずつ動かす基盤 (bridge)。その上に Rust の道具 (mctas) と、26.3 を名乗る Rust のモデル (crates/redsim) がある |
| 実機との照合 | bridge は MinecraftServer の派生を Mod 無しで動かす。別に、改造しないサーバ jar を RCON と /tick step で動かし、region ファイルを読み戻してセルごとに比べる (door vanilla-check ほか)。redsim は bridge との差分ファジングで確かめる |
| 3×3 ドア | 1,690 設計 (solid 1,005・gravity 30・sculk 653・entity 2。ほかに無効 4 を記録用に残す)。32 か所 × 開閉 3 回で検証する |
| クロック | 815 種 (周期 183・系統 145) + 変種 826。実機で撮った写真付き |
| 装置 | 27 分野で 534 設計。パルス 188・記憶 69・ピストン延長 65・パルス倍増/分周 46・飛行機械 22・作物畑 22・BUD 12・論理ゲート 11 など。4 か所 × 4 回転で検証する |
| 実機の記録 | designs/redsim/recorded。回路寄りは 79 件 (装置 38・ドア 22・クロック 16・リフト 3)。ほかにアイテム系 14 件、モブ AI 216 件。一覧 (recorded.tsv) で確かめた分は、版がすべて 26.3 |
| redsim のテスト | crates/redsim/tests/fixtures の 18 本 (.fixture) と 2 本 (.txt)。例: slime-is-a-conductor・shape-update-no-neighbor-updates・copper-bulb-unwaxed-toggle |
| 形式 | 設計は独自のテキスト (.txt)。mctas litematic export で .litematic (DataVersion 5023) に書き出せる |
| ライセンス | MIT (Copyright (c) 2026 Christopher Chedeau)。設計はリポ内のエージェントと道具が作ったもので、出し手自身の作品と読める [要確認: 外部の設計が混ざっていないか] |

使い方の判断:

- **26.3 と版がぴったり合う唯一の公開データ**。帰属 (NOTICE) を付ければ (a) に入れられる。
- 偏りがある。ピストンドアとクロックに寄る。0 tick・スライム・sculk・重力ブロックなど、際どい仕組みが多い。
  - 結合テストと「際どい場合」の網羅に向く。素子単体の網羅は、自作のプローブで補う。
- redsim は 26.3 の Rust のモデルで、作るものと目的が重なる。Nucleation と同じく、**データと検証の手法だけを借り、コードは移植しない**。
- 記録は bridge で撮ったもの。自前の 26.3 ハーネスでも同じ設計を撮り、両者が一致することを確かめてから正とする。

### 2.4 MCHPRS (MCHPR/MCHPRS、MIT)

- 1.20.4 用の創造モードのサーバ。テストは Rust のコードに書いた回路配置である [確定: README・tests/]。
  - test_all_backends! で定義したテストが 14 本ある。内訳は tests/components.rs が 11 本、tests/timings.rs が 3 本。
  - redstone-sim は 12 本を移植済み。未移植は pending_repeater_pulses_without_input と wire_on_wire の 2 本。
  - 回路ファイルは無い。
- MCHPRS はワイヤの更新順の典拠に使わない (04 §2.4。移植テストの冒頭にも書いてある)。期待値は vanilla の正解ではない。
- 使い方: 配置だけ借りて fixture 定義に起こし、実機で撮って正解を得る。(a) (MIT の帰属は移植テストの冒頭に書いてある)。優先度は低い。

### 2.5 Lithium の gametest (CaffeineMC/lithium、LGPL-3.0)

- develop は 26.3 向け (build.gradle.kts のコンパイル版が 26.3) [確定]。
- 構造物は common/src/gametest/resources/data/lithium-gametest/ に 33 本 (.snbt) と、test_instance の JSON 33 本 [確定]。
  - 回路寄りは 11 本: ホッパー 7・コンパレーターの更新 1・トロッコの信号強度 1・仕分け機 1・動くブロックの当たり 1。
  - 残りは TNT・モブ AI・流体・アイテムの拾い方など。
- どれも block_based。test_block の accept が動力を受ければ合格で、tick ごとの正解は持たない。
- 使い方:
  - 入力の構造物として使い、自前の 26.3 ハーネスで tick ごとに撮る。
  - LGPL-3.0 の条件 (ライセンス本文・帰属・元の入手先) があるので、既定は (b)。固定コミットから取るスクリプトと、ハッシュだけをコミットする。
  - Nucleation のように NOTICE を付けて (a) にする手もある。リポの LICENSE を決めてから判断する。

### 2.6 fabric-carpet と Carpet-TIS-Addition

- どちらも回路のテスト資産を持たない [確定: gh api のツリー]。
  - fabric-carpet (MIT) の tests は scarpet 言語のテストだけ。
  - Carpet-TIS-Addition (LGPL-3.0) の src/test は 2 本で、回路と関係が無い。
- 役割は道具 (01 §6・06)。
  - carpet の /tick freeze・step と scarpet のダンプで、レイヤ A (tick ごとの状態) を撮る。
  - TIS の microTiming で、レイヤ C (tick 内の順序) を撮る。
- 26.3 版がある [確定: Modrinth API]。
  - carpet 26.3 (release、2026-09-18)
  - Carpet-TIS-Addition v1.84.0-mc26.3 (2026-11-24)
  - Litematica 0.29.1 (26.3、2026-09-27)
  - Redstone Multimeter mc26.3-1.17.0 (2026-10-18)
  - fabric-carpet の master は既に 26.4-pre-1 に進んでいる。

### 2.7 Mojira の添付

- 添付は bugs.mojang.com の API で配られる。例: MC-11193 には画像 18 個と zip 1 個 (MC-11193.zip) がある [確定: mojira.dev のミラー表示]。zip の中身 (ワールドか) は開いていない [要確認]。
- 添付の権利:
  - Minecraft の EULA は「あなたのコンテンツはあなたのもの」とする (Microsoft サービス規約に従う) [確定: https://www.minecraft.net/en-us/eula の CONTENT]。
  - Microsoft サービス規約 §2「Your Content」:
    - a. 共有された相手は、共有した目的のために使える。
    - b. Microsoft はサービスの提供に必要な範囲でライセンスを得る。
  - **第三者に再配布を認める規定は無い**。Mojira が同規約の対象サービスかは確かめていない [要確認]。
- 使い方: 手元で開いて再現条件を読み、**自分で最小の回路を組み直す**。組み直した回路は (a) にできる (07 で 4 件を実機 fixture にした手順と同じ)。
  - 添付そのものはコミットしない。原票の URL だけ書く。
- 件数は数えていない。回路の票の大半は画像だけで、ワールドを添付する票は一部である [要確認]。

### 2.8 GitHub の公開アーカイブ

GitHub のコード検索はバイナリを索引しない。そこで、リポジトリ検索とツリーの走査で数えた [確定: gh search repos・gh api、2026-11-26]。
多くは Nucleation の目録 (§2.2) にも載っている。

| リポ | ライセンス | 回路ファイル | 中身 | 区分の案 |
|---|---|---|---|---|
| [mattbatwings/Logical-Redstone-Archive](https://github.com/mattbatwings/Logical-Redstone-Archive) | 無し | schem 193・mcstructure 14・litematic 7・zip 4 | 論理回路 (加算器・ALU・デコーダ・ラッチ・カウンタ・表示器など 40 分類) | (b)。ダスト・トーチ・コンパレーターの結合テストに最も向く。作者に許諾を頼む価値が高い |
| [Storage-Catalog/Archive](https://github.com/Storage-Catalog/Archive) | 無し (README は「使うなら作者をクレジットし、このリポへリンクを」) | litematic 334・zip 25 | ストレージ (ホッパー・コンパレーター) | (b) |
| [Soontech-Annals/Archive](https://github.com/Soontech-Annals/Archive) | Unlicense | litematic 51・schematic 1・zip 6 | エンコード式ストレージ | (a) の候補。収録作が出し手自身の作品か確かめてから |
| [Soontech-Annals/SoonNowArchive](https://github.com/Soontech-Annals/SoonNowArchive) | 無し | litematic 59・schematic 1・zip 7 | 同上の現行版 | (b) |
| [X-com/slimestone-AI](https://github.com/X-com/slimestone-AI) | MIT | schematic 63 | 機械学習で生成した飛行機械 | (a) の候補。版は未確認 [要確認] |
| [Gudu-Z/SlimestoneMilitaryArmamentsArchives](https://github.com/Gudu-Z/SlimestoneMilitaryArmamentsArchives) | MIT | litematic 46 | スライム式の航行機械。README は「オープンソースの機械の投影を置く」と書く | (a) の候補。収録作の作者を確かめてから |
| [XPBot1/Autocrafting-Archive](https://github.com/XPBot1/Autocrafting-Archive) | 無し | litematic 41 | 自動クラフト (クラフター) | (b) |
| [DuskScorpio/wither-archive](https://github.com/DuskScorpio/wither-archive) | 無し | litematic 63・zip 24 | ウィザー装置 (エンティティ寄り) | (b)。優先度は低い |
| [CasualMinecraft/casual-builds](https://github.com/CasualMinecraft/casual-builds) | 無し | litematic 4・schem 4 | サバイバル装置 | (b) |
| [IfNullThenVoid/minecraft-litematica-schematics](https://github.com/IfNullThenVoid/minecraft-litematica-schematics) | 無し | litematic 78・schematic 2 | 雑多 | (b) |
| [OpenBagTwo/Schematics](https://github.com/OpenBagTwo/Schematics) | AGPL-3.0 | litematic 4 | 個人の設計 | 使わない |
| [dalebert/MinecraftSchematics](https://github.com/dalebert/MinecraftSchematics) | GPL-3.0 | litematic 2 | 個人の設計 | 使わない |

- リポのライセンスが MIT・Unlicense でも、収録作が他人の設計なら、そのライセンスは収録作を覆わない。1 件ずつ出どころを見る。
- Nucleation の目録 (archive-sources.json) も同じ立場を取る。
  - MIT の slimestone-AI・SMAA を含む多くの出どころに、「出どころと作品ごとのライセンスを保ち、一括の再配布は主張しない」と記録している。
  - Logical-Redstone-Archive は「アーカイブ全体のライセンスは無い。手元の研究用の写しで、再配布は推定しない」。
  - Soontech の Archive は「ルートは Unlicense。出どころと帰属を残す」。

### 2.9 コミュニティの配布サイト

| サイト | 規約の要点 | 区分 |
|---|---|---|
| [Planet Minecraft](https://www.planetminecraft.com/) | フッターに「All creations copyright of the creators」[確定]。利用規約の本文 (https://www.planetminecraft.com/terms_of_use/) は Cloudflare の確認画面で取得できなかった [要確認]。利用者の問い合わせ (https://www.planetminecraft.com/tickets/21051/) は「サイトが提供するものの再配布を禁じる」条項を引く | 作品ごとに作者の了解。了解前は (b) |
| [minecraft-schematics.com](https://www.minecraft-schematics.com/) | 規約のページが 403 で取得できなかった [要確認] | (b)。使うなら作者の了解 |
| [Open Redstone Engineers](https://openredstone.org/) | 規則 (https://github.com/OpenRedstoneEngineers/Rules) は作品の利用許諾を定めない。「他人の作品の手柄を取る」ことを禁じる [確定] | 作者ごとの了解 |
| [r/redstone](https://www.reddit.com/r/redstone/) | Reddit の利用規約 §5: 所有権は投稿者に残る。許諾の相手は Reddit (再許諾を含む) で、ほかの利用者ではない。§7: 同意なしのスクレイピングを禁じる (2026-07-01 施行) [確定: https://redditinc.com/policies/user-agreement] | 投稿から辿った先の作者に了解を取る |
| Technical Minecraft Catalogue (Discord) | Discord 上の目録。管理用の bot ([EmdyMC/Archiver-Bot](https://github.com/EmdyMC/Archiver-Bot)) はライセンス無し。記録を扱う bot の [Redstone Squid](https://github.com/redstone-squid/Redstone-Squid) は MIT だが、記録のデータは別物 [要確認] | 作者ごとの了解 |

- どのサイトも、投稿物の再配布を第三者に認める一括の許諾を持たない。
- 使うなら、作者に直接了解を取る。了解が「公開しないなら可」なら (c)。

### 2.10 対象外にしたもの

- Hugging Face のデータセット: 「minecraft schematic」で 3 件あるが、構造物一般の集まりで、回路に絞ったものは無い (「minecraft redstone」で 0 件)。出どころも追いにくい (例: [Hack337/Minecraft-Schematics](https://huggingface.co/datasets/Hack337/Minecraft-Schematics))。
- redtact の統合版の 14 本: Java 版の正解にならない。
- 自動化された大量の取得 (スクレイピング): 規約で禁じるサイトがあり (Reddit §7 など)、作者の了解とも両立しない。

---

## 3. 総覧

優先度: **A** = すぐ着手、**B** = A の次、**C** = 余力で、**D** = 道具・参考だけ。

| 入手先 | 形式 | 版 | 件数の目安 | ライセンス・規約 | 公開リポにコミット | 正解データにする手順 | 優先度 |
|---|---|---|---|---|---|---|---|
| 自作のプローブ回路 (docs/vanilla 各メモ §8) | fixture 定義 (JSON) | 撮る版 (26.3) | 07 だけで 11 本 (2026-11-26 時点)。20 本のメモで 100〜200 本の見込み [要確認] | 自作 | ○ (a) | §4.1 | **A** |
| 既存の fixture | fixture 定義 + expect | 1.21.1 | 150 本 | 自作 (一部は実回路由来。§1.4) | ○ (a) | 26.3 で撮り直す (§4.1) | **A** |
| 自動生成した回路 (ファジング) | fixture 定義 | 26.3 | 制限なし | 自作 | ○ (a) | ランダムに組み、実機と Rust エンジンの両方で回して食い違いを縮める | B |
| redstonepedia | 独自テキスト (.litematic に書き出せる)・記録 | 26.3 | ドア 1,690・クロック 815 種・装置 534・回路寄りの記録 79 | MIT | ○ (a) + NOTICE | 書き出し → 自前の 26.3 ハーネスで撮る → 先方の記録と突き合わせる (§4.3) | **A〜B** |
| Nucleation の自作構造物 | .snbt・JSON | 26.2 (103)・1.21.11 (14) | 構造物 130・回路寄りのゴールデン 47 (名前で分けた目安) | MIT | ○ (a) + NOTICE | .snbt を 26.3 で撮り直す。先方の 26.2 の結果は版差の手がかりに使う | B |
| Nucleation のコミュニティ製の扉 | .litematic・.snbt | 26.2・1.21.11 | 9 本 | 記載なし | ✕ (b) | 手元で撮る | C |
| redtact の所有者自身の投稿 | litematic | 申告 1.11〜26.1.2 | Java 13 本 (ファイル 15) | 所有者の作品 | 所有者が決めれば ○ | §2.1.4 | B |
| redtact の他者の投稿 | litematic・nbt・schem | 申告 1.16〜26.1.2 | Java 15 本 (ファイル 23) | 規約は「サービス上での表示・共有」。AI 読み取り許可は 2 本 | ✕ (b)。了解を得れば (a) か (c) | §2.1.4 | B (扉) / C |
| Lithium の gametest | .snbt | 26.3 (develop) | 33 本 (回路寄り 11) | LGPL-3.0 | 既定は ✕ (b) | 固定コミットから取得 → 26.3 で撮る | C |
| MCHPRS のテスト | Rust のコード | 1.20.4 | 14 本 (12 本移植済み) | MIT | ○ (a) | 配置を fixture 定義に起こして実機で撮る | C |
| fabric-carpet・Carpet-TIS-Addition | — | 26.3 版あり | 回路資産なし | MIT・LGPL-3.0 | — | 撮る道具として使う | D |
| Mojira の添付 | ワールド zip・画像 | 票ごと | 未計数 | 第三者への許諾なし | ✕ | 読んで最小の回路を自分で組み直す (§2.7) | B (既知のバグ) |
| GitHub の寛容なライセンスのアーカイブ | litematic・schematic | 未確認 | slimestone-AI 63・SMAA 46・Soontech 51 | MIT・Unlicense | 出どころを確かめてから ○ | 手元で撮る → 断片を (a) | C |
| GitHub のライセンス無しのアーカイブ | schem・litematic | 未確認 | LRA 214・Storage-Catalog 334 ほか | 無し | ✕ (b) | 手元で撮る → 断片を (a) | B (LRA) / C |
| コミュニティサイト | 各種 | 各種 | 不明 (大量) | 作者の権利。一括の許諾なし | ✕ | 作者の了解が取れたものだけ | D |

---

## 4. 正解データにする手順

### 4.1 自作のプローブ回路 (主軸)

1. docs/vanilla の各メモ §8 から 1 本選ぶ。目的・配置・観測・期待の要点が書いてある (例: docs/vanilla/07_diodes.md の P-1〜P-11)。
2. tools/mc-harness/fixtures/<名前>.json に定義を書く。
   - 形式は tools/mc-harness/README.md の「fixture フォーマット」。
   - 名前にメモの番号を入れると辿りやすい (例: diodes-p1-dust-direct-read)。
3. 実機で撮る (npm run ground-truth -- <名前>)。
   - settle 照合で落ちたら、実機が教える安定状態に blocks を直す。
4. 期待の要点と expect を見比べる。
   - 合わなければ、メモの読み違いかハーネスの誤りかを切り分ける。結果はメモの §9 (食い違い) に返す。
5. tick 内の順序が要る回路 (locational・同じ tick の競合) は、レイヤ C (microTiming) の手作業の観測を足す (06 §6.3)。
6. 生成済みの fixture をコミットする。TS エンジンと Rust エンジンの両方が、同じ JSON を読んで回す。

### 4.2 実回路 (結合テスト)

1. 区分を決めて置く (§5)。手元だけなら tools/mc-harness/circuits/ に置き、manifest に書く。
2. キャプチャ定義を書く。
   - 入力は、作者の説明どおりの操作にする。
   - 長い装置は、warmup と preInputs で動き出しをそろえる (README の Runa の扉の節)。
3. 実機で撮り、sim と突き合わせる (npm run capture → npm run gt-compare)。
4. 食い違ったら、自動で最小化して fixture に書き出す (runner/minimize.ts)。断片は (a) にできる。
5. 撮影結果のフル記録 (tick ごとの全ブロック) は、元の回路をほぼ再現できる。**元の回路と同じ区分にする**。

### 4.3 他のエンジンの正解の扱い

- Nucleation のゴールデン (26.2・1.21.11) と redstonepedia の記録 (26.3) は、**比較用**とする。正は、自前のハーネスで 26.3 を撮った結果にする。
- 自前の撮影と先方の記録が食い違ったら、次の順で疑う。
  1. 置き方 (更新ありで置いたか、settle の有無)
  2. 原点と座標 (locational な回路は、絶対座標で結果が変わる。Nucleation の Lithium 移植の注意と同じ)
  3. DataVersion の読み違い
  4. 版差

### 4.4 26.3 のハーネスの前提

| 項目 | 今 (1.21.1) | 26.3 で要るもの |
|---|---|---|
| Java | 21 (itzg/minecraft-server の java21) | 25 [確定: 版 JSON の javaVersion] |
| サーバ | TYPE FABRIC・VERSION 1.21.1 | VERSION 26.3 |
| Mod | carpet (Modrinth) | carpet 26.3。scarpet のダンプ (scripts/dump.sc) がそのまま動くか確かめる [要確認] |
| DataVersion | 3955 | 5023。これより新しい版で保存したファイルは読めない。古いものは DataFixer で上がる |
| fixture | mcVersion 1.21.1 | mcVersion 26.3 の版を別に持つ。1.21.1 版は TS エンジンの回帰用に残す |

- 別の撮り方もある。
  - Nucleation は、GameTestServer をプロセス内で回す。
  - redstonepedia は、MinecraftServer の派生を headless で回す。
  - どちらも Mod が要らず速い。サーバ jar をリポに入れないこと、EULA の扱いは今のハーネスと同じに保つ。

---

## 5. 置き場所の分け方 (方針案)

### 5.1 3 つの区分

| 区分 | 何を入れるか | どこに置くか | コミットするもの |
|---|---|---|---|
| **(a) リポにコミットしてよい** | 自作 (プローブ・手書き fixture・自動生成・自前の撮影結果)。実回路を最小化した小さな断片。所有者自身の作品 (所有者が決めたもの)。作者の了解を書面で得たもの。寛容なライセンス (MIT・Unlicense・CC0・CC BY など) で、出し手自身の作品と確かめたもの | 公開リポ (tools/mc-harness/fixtures/・packages/sim/test/fixtures/、新設するならコーパス用のフォルダ) | 回路・撮影結果そのもの。第三者のものは NOTICE (帰属・元の URL・コミット・ライセンス本文) を添える |
| **(b) 手元だけ** | ライセンスの無いアーカイブ。規約で再配布できないサイトの配布物。了解前の redtact の他者の投稿。Mojira の添付。LGPL の Lithium の構造物 (既定)。Nucleation のコミュニティ製の扉 | 各自の手元 (tools/mc-harness/circuits/。gitignore 済み) | 一覧 (manifest)・SHA-256・入手元の URL・キャプチャ定義・取得スクリプト・撮影結果の要約 (一致と不一致の数)・最小化した断片 |
| **(c) 非公開の置き場** | 了解は得たが「公開しないなら可」のもの。手元以外でも回したい大量の (b) | 非公開のリポか、非公開のオブジェクトストレージ (例: 所有者の組織の private リポ) | 公開リポには (b) と同じものだけ。公開リポの CI からは読まない |

- 公開リポの CI は (a) だけで完結させる。
  - (b)・(c) の回路を使うテストは、ファイルが無ければ skip する。
  - ハッシュが違えば失敗させる (版や中身が黙って変わるのを防ぐ)。
- (c) を回すのは、手元か非公開側の CI にする。公開リポの CI に秘密を渡さない。

### 5.2 振り分けの手順

1. 自作か。自作なら (a)。
2. 所有者自身の作品か。そうなら所有者が (a) か (c) を決める。
3. 寛容なライセンスが明示されているか。さらに、収録作が出し手自身の作品か。両方そうなら (a) + NOTICE。
4. 作者の了解が書面 (issue・メール・redtact 上のやり取りなど) であるか。あれば了解の範囲に従って (a) か (c)。範囲は credit に書く (docs/ip-policy.md §2 のリソースパックと同じ扱い)。
5. それ以外は (b)。ライセンス無し・規約で再配布不可・作者不明・GPL 系・LGPL (既定) がここに入る。量が多く手元以外でも回したいなら (c)。
6. どの区分でも、最小化した断片と自前の観測の要約は (a) にできる。出どころを description に書く。

### 5.3 manifest の項目案

置き場の案は tools/mc-harness/corpus.manifest.json (追跡する)。回路の実体は tools/mc-harness/circuits/ (追跡しない) のまま。

| 項目 | 例 (§1.3 の 1 本) |
|---|---|
| file | TAKU128_DoubleSidedGlassElevatorMultipleFloors.litematic |
| sha256 | 2cfc113b40ff134acf13812ca81452372621757a86f12c842d810c2be2f121e0 |
| bytes | 8281 |
| format・data_version | litematic・4435 |
| source_url | https://redtact.com/circuits/cbNPAyXT0jxA |
| author | 所有者 |
| license | owner (所有者が決める) |
| class | a / b / c |
| permission | 了解の記録の場所 (issue 番号など)。無ければ空 |
| fetched_at | 取得日 |
| used_by | elev-call1・elev-floor3 ほか (キャプチャ定義の名前) |
| notes | 「出どころの照合待ち」など |

### 5.4 帰属表示

- 第三者の (a) は、NOTICE にまとめる。書くのは名前・作者・元の URL・コミット・ライセンス・改変の有無。
- MIT・Unlicense はライセンス本文 (または全文への参照) を添える。
- 帰属は許諾の代わりにならない (docs/ip-policy.md §2)。ライセンスの無いものに帰属を書いても (a) にはならない。

---

## 6. 計画

| 段階 | やること | 区分 | 規模の目安 |
|---|---|---|---|
| 0 | 前提をそろえる。① リポの LICENSE を決める (15 §2.2)。② §1.4 の実回路に由来する fixture と PR 添付の扱いを決める (作者に了解を取る・(b) に移す・最小化した断片に置き換える。対象は非公開の draft で扱う)。③ manifest の形を決める | — | 小 |
| 1 | 26.3 のハーネスを作る (§4.4)。既存の fixture を数本流し、1.21.1 と同じ形で撮れることを確かめる | — | 中 |
| 2 (主軸) | docs/vanilla 各メモ §8 のプローブを fixture 定義に起こし、26.3 で撮る。結果をメモの §9 に返す | (a) | 100〜200 本の見込み |
| 3 | 既存の 150 本を 26.3 で撮り直す。差が出たら docs/vanilla/19_version-diffs.md の予想と照らす | (a) | 150 本 |
| 4 | 自動生成の回路で差分ファジングをする。Rust エンジンと実機の食い違いを最小化し、fixture にする (redstonepedia の vanilla-fuzz・redsim-fuzz が先例) | (a) | 継続 |
| 5 | 寛容なライセンスの公開データを使う。redstonepedia の設計を書き出して 26.3 で撮り、先方の記録と突き合わせる。Nucleation の自作 .snbt を 26.3 で撮り直す | (a) + NOTICE | 数百〜千本台 (選んで使う) |
| 6 | 実回路の結合テスト。① 所有者自身の redtact 13 本 ② 了解を得た他者の回路 (扉を先に) ③ 手元だけのアーカイブ (LRA の論理回路を先に)。食い違いは最小化して (a) に返す | (a)〜(c) | 数十本 |

- 段階 2〜4 で、素子ごとの規則を固める。段階 5〜6 は、規則の組み合わせが崩れないかを見る。
- 段階 6 の長い回路は時間がかかる。エレベーターは 120〜240 tick、5×5 ドアは 400 tick を撮っている。CI の既定には入れず、手元か夜間に回す。

---

## 7. 未確定・要確認

1. 実回路に由来する既存の fixture・PR の添付・手元の回路ファイルの出どころと作者の了解 (非公開の draft で扱う)。
2. redstone-sim のライセンス (コードと、第三者のデータを入れたときの NOTICE の形)。
3. redstonepedia の設計に、外部の設計 (コミュニティの記録の写しなど) が混ざっていないか。
4. 26.3 の carpet で、scripts/dump.sc がそのまま動くか。
5. docs/vanilla §8 のプローブの総数 (作成中)。
6. Planet Minecraft と minecraft-schematics.com の利用規約の本文 (取得できなかった)。
7. Mojira が Microsoft サービス規約の対象か。回路の票のうち、ワールドを添付した票の数。
8. slimestone-AI・SMAA・Soontech Archive の収録作の版と作者。

---

## 8. 出典

redtact (2026-11-26 に MCP で取得)

- 一覧: https://redtact.com/circuits
- 利用規約 (最終更新 2026-10-11): https://redtact.com/terms
- AI 連携 (ファイル読み取りの意味): https://redtact.com/ai
- 所有者自身の回路のページは §2.1.2 の表に載せた

Nucleation

- リポ: https://github.com/Schem-at/Nucleation (aefd962、2026-11-23)
- Lithium の移植の NOTICE: https://github.com/Schem-at/Nucleation/blob/master/tests/corpus/lithium-litematic/NOTICE.md
- コミュニティ回路の目録: https://github.com/Schem-at/Nucleation/blob/master/docs/performance/schematic-candidates/README.md
- 1.21.11 の記録の由来: https://github.com/Schem-at/Nucleation/blob/master/crates/mc-tick/tests/traces/hipster_door_1_21_11.md・https://github.com/Schem-at/Nucleation/blob/master/crates/mc-tick/tests/traces/flag2_observer_1_21_11.md
- 実機オラクル: https://github.com/Schem-at/Nucleation/blob/master/tools/gametest/README.md

redstonepedia

- リポ: https://github.com/vjeux/redstonepedia (3896530、2026-11-17)
- 仕組み・照合: https://github.com/vjeux/redstonepedia/blob/main/docs/internals.md
- .litematic の書き出し: https://github.com/vjeux/redstonepedia/blob/main/docs/litematic.md
- ドアの一覧: https://github.com/vjeux/redstonepedia/blob/main/designs/piston-door-3x3/archive/README.md
- クロックの一覧: https://github.com/vjeux/redstonepedia/blob/main/designs/clocks/CATALOG.md
- 装置の一覧: https://github.com/vjeux/redstonepedia/blob/main/designs/circuits/CATALOG.md
- 記録: https://github.com/vjeux/redstonepedia/tree/main/designs/redsim/recorded

ほかのエンジンと Mod

- MCHPRS: https://github.com/MCHPR/MCHPRS (tests/components.rs・tests/timings.rs)
- Lithium: https://github.com/CaffeineMC/lithium (develop の build.gradle.kts、common/src/gametest/resources/data/lithium-gametest/)
- fabric-carpet: https://github.com/gnembon/fabric-carpet・https://modrinth.com/mod/carpet
- Carpet-TIS-Addition: https://github.com/TISUnion/Carpet-TIS-Addition・https://modrinth.com/mod/carpet-tis-addition
- Litematica: https://modrinth.com/mod/litematica
- Redstone Multimeter: https://modrinth.com/mod/redstone-multimeter
- Modrinth API (26.3 版の確認): https://api.modrinth.com/v2/project/carpet/version

Mojang・Microsoft・Mojira

- 版の一覧 (26.3 は 2026-09-15): https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
- Minecraft EULA (CONTENT): https://www.minecraft.net/en-us/eula
- Microsoft サービス規約 (Your Content): https://www.microsoft.com/en-us/servicesagreement
- Mojira: https://bugs.mojang.com/ ・ミラー表示の例: https://mojira.dev/MC-11193
- バグ報告の案内: https://www.minecraft.net/article/bug-us-about-bugs

GitHub のアーカイブ (§2.8 の表のリンク)

- https://github.com/mattbatwings/Logical-Redstone-Archive
- https://github.com/Storage-Catalog/Archive
- https://github.com/Soontech-Annals/Archive
- https://github.com/Soontech-Annals/SoonNowArchive
- https://github.com/X-com/slimestone-AI
- https://github.com/Gudu-Z/SlimestoneMilitaryArmamentsArchives
- https://github.com/XPBot1/Autocrafting-Archive
- https://github.com/DuskScorpio/wither-archive
- https://github.com/CasualMinecraft/casual-builds
- https://github.com/IfNullThenVoid/minecraft-litematica-schematics
- https://github.com/OpenBagTwo/Schematics
- https://github.com/dalebert/MinecraftSchematics

コミュニティ

- Planet Minecraft: https://www.planetminecraft.com/terms_of_use/ (取得不可)・https://www.planetminecraft.com/tickets/21051/
- minecraft-schematics.com: https://www.minecraft-schematics.com/ (取得不可)
- Open Redstone Engineers の規則: https://github.com/OpenRedstoneEngineers/Rules
- Reddit の利用規約: https://redditinc.com/policies/user-agreement
- Technical Minecraft Catalogue の bot: https://github.com/EmdyMC/Archiver-Bot
- Redstone Squid: https://github.com/redstone-squid/Redstone-Squid
- Hugging Face の例: https://huggingface.co/datasets/Hack337/Minecraft-Schematics
