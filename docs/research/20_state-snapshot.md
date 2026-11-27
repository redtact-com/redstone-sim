# 20. 止めた回路の状態の書き出しと読み込み・Web でのビューアとシミュレーションの連携

## この文書の位置づけ

- 要望は #437 (止めた回路の状態をファイルや DB に書き出し、すぐ再開できるようにする。Web でのビューアとシミュレーションの連携を含む)。要望の原文は issue にある。
- これは **設計案** である。3 つの案 (正確さ優先 A・実機とのつながり優先 B・Web の連携優先 C) を採点し、1 本にまとめた (§10)。§9 のうち 4 つは決まった (下の表)。残りは、その段の issue の前に決める。
- 19 (Rust/WASM エンジンの設計案) との関係: 19 §3.9 (snapshot に入れる物)・§2.5〜§2.7 (JS との境界・窓口・Worker)・§10.3 (M2-7 snapshot・restore・clone) の続きに当たる。19 の §3.9 と §10.3 には、この文書の要点を書き足した (§7.3)。
- 「サイズより正確さと実装量を優先」はユーザの決定として扱う。サイズの数字は参考値として残すが、削るために正確さや機能を落とさない。

決まったこと (2026-11-26・ユーザの選択):

| §9 | 決めたこと | 選択 | この文書への効き方 |
|---|---|---|---|
| 1 | 保存の意味 | 止めずに回した時と同じ続き (実機の freeze → step と同じ) | 「正確」「同じ続き」は、いつもこの意味を指す (§6.3) |
| 3 | core の形 | エンジンの状態そのまま + 共通の入れ物。持ち運べる形は任意の節 | §2.2 |
| 4 | 版が違うファイル | sim の版だけ違えば読んで印を出す。エンジン・規則の版・状態表が違えば「続き」としては読まない | §2.6・§4.4 |
| 11 | TS で先に作るか | **作らない。Rust の M2-7 を待つ** | TS のエンジン (SimWorld) には書き出しも読み込みも足さない。最初の実装は Rust の M2-7 で、画面に入れるのは Rust のエンジンがアプリで動いてから (§7)。今のエディタの 💾 Init / ↩ Reset のずれは、それまで残る |

- TS のエンジンについて書いた節 (§1.2 の状態の全表・§6.1 の台本の結果) は、作る物の説明ではない。Rust の §3.9 の中身と往復の性質を決めた根拠として残す。
- 印: [コード] = コードを読んで確かめた。[調査] = 調査の台本の実測と読み (回し直していない)。[確かめ] = 見直しの台本を新しく書いて、全部の境目で回した (台本はリポジトリに入れていない)。[推測] = 確かめていない。
- 参照の置き場: V01〜V19 は docs/vanilla の 01〜19、R17・R18 と「19」は docs/research の 17〜19、「14」は docs/research/14。行番号は 2026-11-26 の物。packages/sim・packages/editor・app/src・tools/mc-harness は develop の行、読む用の Web (docs-web・packages/docs-kit) と packages/viewer/src/IsometricView.tsx・playwright.config.ts は PR #436 のブランチの行である。
- 往復の性質の番号は RT0〜RT13 とする。19 の P0〜P4 (エンジンの切り替えの段) とは別物である。

言葉:
- **状態** = 止めた所から同じ続きを出すのに要る物の全部。
- **写し** = 描画用の盤面 (`WorldSnapshot`)。状態ではない。19 は §2.5 の `rse_snapshot` (状態) と §2.6 の `snapshot()` (写し) で同じ語を使っている。この文書では新しい口を save / load と呼び、snapshot と呼ばない。
- **境目** = tick と tick の間 (`tick()` を呼んでいない間)。
- **BE** = BlockEntity (ブロックに付く追加のデータ)。**ブロックイベント** = ピストンの伸び縮みなどを同じ tick の後ろの相で回す列。**予約 tick** = 「何 tick 後に動くか」の予約。
- **再生器** = tick を回す・止める・入力を入れる・状態を出し入れする、を 1 つにまとめた部品 (§5)。

---

## 0. 結論

1. 止めて保存できる場所は **tick の境目だけ** (入力の直後を含む)。実機の /tick freeze と step と同じ意味である (V01 §4.2・§4.8)。保存の意味は「止めずに回した時と同じ続きが出る」の 1 つに決める。
2. 形式は 1 つの入れ物 `rdsim-state`。中心は **エンジンの完全な状態 (core)** で、Rust では 19 §2.5 の不透明なバイト列 (`rse_snapshot` の出力) である。中身は 19 §3.9 の全部で、絶対 tick・予約順・挿入順・座標を直さずに持つ。設計図・再生の位置・見え方は別の節に入れる。別のエンジンや実機へ持って行く形 (portable) は任意の節で、正確さを約束しない。
3. 読み込みは専用の入口 (Rust の `rse_restore`、Engine の `loadState`) だけにする。19 §4.2 の読み込みの型・seed・settle を **通さない**。欄が欠けたら推測で埋めず、断る。
4. 正確さは往復の性質 RT1 (N tick = k tick → 書き出し → 読み込み → N−k tick) で守る。その時点で Rust のエンジンが通る fixture の **全部の境目** で内部の全状態まで比べ、CI に入れる。欄を壊すと落ちることも確かめる。TS のエンジンで同じ形を台本で回したら、150 本の全部の境目 8,872 か所でずれ 0 だった [確かめ] (§6.1)。
5. Web は再生器 `SimPlayer` を 1 つ置き、Editor・Embed・Demo・読む用の Web が同じ命令と通知を使う。保存先は `StateStore` の後ろにファイル・IndexedDB・親のページ (redtact の DB) を並べる。Worker は早送りだけで、受け渡しは状態そのもの。
6. 段階: 最初は Rust の M2-7 (snapshot・restore・clone と往復の性質)。入れ物・画面・保存先・埋め込み v2 は、19 §10.3 に足した M3-9〜M3-13 で、Rust のエンジンがアプリで動いてから作る (§7)。TS のエンジンには足さない。

---

## 1. 「止めた時の状態」の定義

### 1.1 止められる場所

| 記号 | 場所 | 保存 | 理由 |
|---|---|---|---|
| S0 | tick の境目 (`tick()` の直後) | **できる** (M2-7) | 一時の欄がすべて空 [確かめ: 全部の境目]。実機で止まる所と同じ (凍結は次の tick の頭から効き、tick の途中では止まらない: V01 §4.2・§4.8) |
| S0' | 境目で入力を入れた直後 | **できる** (同じ) | 実機も凍結中に操作でき、近隣更新はその場で走り、予約とブロックイベントは溜まる (V01 §4.8・V03 §4.2)。fixture の規約 state[t] もここ (R18 §1.1) |
| S1 | 相の境目 (予約 tick の相の後・ブロックイベントの相の後・着地の後) | 版 1 ではできない。後の段でカーソル方式 (§1.4) | `tick()` は 3 相を一気に回し、途中の口が無い (world.ts:541-589 [コード])。実機にも無い止め方 |
| S2 | 相の中の 1 件ごと | S1 と同じ | 同上 |
| S3 | 1 件の処理の中 (近隣更新の連鎖・ピストンの移動) | **作らない** | 戻り先が JS の呼び出しの積みにある [調査]。trace (19 §4.4) で見る |

決まり:
- S0 と S0' は同じ「境目」。違いは、ブロックイベントの列が空でないことが S0' に多いだけ。150 本の境目 (tick 0 を含めて 4,436 × 2) のうち、列が残っていたのは tick の直後に 16、入力の後に 75。列を落として戻すと、その 91 か所すべてで内部の状態がずれた [確かめ]。だから core はブロックイベントの列を必ず持つ。
- 発音のフック (`noteHook`) はブロックイベントの相の途中で呼ばれる (world.ts:2018 [コード])。ここで `clone()` すると相の位置が写らず 1 tick ずれる [調査]。sim に「tick の中」の印 (`inTick`) を足し、印が立っている間の書き出しは例外にする。
- 実機の凍結中は「BE を tick しない tick」が回り、BE の pending の合流だけは進む (V01 §4.8)。sim の一時停止は tick を回さない。差が出る例は見つかっていない [調査]。§8 に残す。

### 1.2 状態の全表 (TS のエンジンで確かめた物・S0)

TS のエンジンには書き出しを足さない (決定 11)。それでもこの表を残すのは、Rust の §3.9 の中身と往復の性質を、動くエンジンで確かめた根拠になるからである。Rust の世界の持ち方は TS と 1 対 1 でない (§7.3) ので、Rust の欄の表は M2-7 で作る。

**書き出す物は 6 つ**。この 6 つだけを JSON にして戻し、150 本の **全部の境目 8,872 か所** (tick の直後 4,436 + 入力の直後 4,436) から続きを回した。毎 tick、seq と絶対 tick もそのまま比べて、ずれ 0 だった [確かめ]。調査の 1,556 か所 (選んだ止め所・seq を外した比較) [調査] より広い。ただし確かめたのは fixture が通る経路だけである (§8.2)。

| # | 欄 | 意味 | TS の今の持ち場所 | 19 §3.9 の行 | 欠けた時にずれること |
|---|---|---|---|---|---|
| 1 | blocks の中身 | 全ブロックの `BlockState`。blockstate の文字列に出ない値を含む (下の表) | world.ts:266 [コード] | 全セクションと BE | 何も戻らない。計算し直すと BUD などが消える。盤面だけ置いて initialize する戻し方は 549〜552 / 1,556 でずれた [調査] |
| 2 | blocks の **並び** | Map の挿入順 = 設置順 | world.ts:633-640 (ホッパーの走査) [コード]・1053-1066 (initialize の Step 4) [調査] | ticker の列の順と pending | ホッパーの BE の相の順が変わる。座標順に並べ直すと hopper-mixed-transfer がずれた [調査]。全部の境目では 6 か所で、落ちるのはこの 1 本だけ [確かめ] |
| 3 | 予約 tick の列 | pos・**blockType**・dueTick (絶対)・priority・seq | world.ts:267・442-455 [コード]・types.ts:1036-1049 | 予約 tick・予約順 | 予約が消える。種類を今のブロックから取り直すと、古い予約 (境目に延べ 50 件 [調査]・[確かめ]) が別物になる。実行時は種類が違えば空振りする (world.ts:1515-1517 [コード]) |
| 4 | ブロックイベントの列 | pos・blockType・param。**列の順が実行順** | world.ts:287・513-524 [コード] | ブロックイベントの列 | 残っていた 91 か所すべてでずれた [確かめ]。実機は保存しない (V03 §3.1) |
| 5 | currentTick | 時計。絶対 tick の欄の基準 | world.ts:273 [コード] | game_time | 着地 103 tick・待ち 209 tick のようなずれ [調査]。0 に戻すと、全部の境目のうち 3,390 か所 (108 本) で盤面がずれた [確かめ] |
| 6 | seqCounter | 予約と moving_piston が共有する番号 | world.ts:274・451・2043 [コード] | 予約順のカウンター | 0 に戻すと、全部の境目では 18 か所 (5 本: copper-bulb-toggle・observer-4tick-clock・repeater-pulse-train-101・repeater-self-off-priority・rs-torch-latch) でずれた [確かめ] |

blocks の中にあって、blockstate の文字列にすると落ちる値 (BlockState を丸ごと書けば付いてくる):

| 値 | 場所 | 19 §3.9 との対応 | 欠けた時 |
|---|---|---|---|
| コンパレーターの `outputPower` | types.ts:103 | BE | 周回して減る機械が止まる |
| ホッパーの `slots`・`cooldownUntil` (絶対 tick) | types.ts:290-297 | BE。26.3 は待ちと「最後に動いた tick」を別に持つ (V14 §3.1) | 8 tick 待つはずが 1 tick で送る [調査] |
| ドロッパー・ディスペンサー・コンテナの `slots`、コンテナの手動の `signal`・`fullCube`・`name` | types.ts:227-240・328 | BE | 読みと物流がずれる。slots の有無で物流か手動かが分かれる |
| クラフターの `occupiedSlots`・書見台の `page`/`pages`・重量感圧板の `pressedPower`・音符ブロックの `instrument` | types.ts:792・905-909・195・154 | BE・在席の表 (板) | 出力の強さ・発火がずれる |
| moving_piston の `into`・`extending`・`finalizeDue` (絶対 tick)・`seq` | types.ts:532-547・world.ts:2041-2044 [コード] | BE (26.3 は進みで持つ: V13 §3.3) | 着地の中身・時刻・順が失われる。fixture の欄では 114 か所で表せない [調査] |
| トーチの `recentToggles` (絶対 tick)・`burnedOut` | types.ts:71-76・85-87 | 焼き切れの列 (26.3 は次元に 1 本: V08 §3.3) | 焼き切れの判定がずれる |
| 近隣更新でだけ変わる値 (ダストの power と connections・リピーターの locked・ランプの lit・扉の open ほか) | types.ts の各型 | 全セクション | 「入力と食い違ったままの状態」が消えて別の機械になる |

**書き出さない物**:

| 種類 | 欄 | 根拠 |
|---|---|---|
| 一時 | runningThisTick・updateStack・addedThisLayer・updating・updateCount・suppressPP・traceBuf・traceSrc・`tick()` のローカル | world.ts:272・280-283・299-300・404 [コード]。全部の境目 8,872 か所で空・false・0・null [確かめ]。**書かない代わりに、書き出しの時に空であることを検査し、空でなければ例外にする** |
| 外 | noteHook・tracer・`TickResult.changedPositions`・写しの bounds | 続きに効かない。戻した後に付け直す。`clone()` も noteHook を写さない (world.ts:292-293 [コード]) |

**SimWorld の欄は 15 個で、全部を上の 3 つに分けた**: 書く 5 (blocks・scheduledTicks・blockEvents・currentTick・seqCounter)・一時 8・外 2 [コード: world.ts:266-300・404 の欄の宣言を数えた]。上の「書き出す物は 6 つ」は、この 5 個の blocks を中身と並びの 2 つに数えた物である。Rust の M2-7 では、同じ分け方を世界の struct に当てたテストを置く (RT0: §6.1)。欄が増えたらテストが落ちるので、新しい欄を書く・一時・外のどれにするかを決めないまま入れられない。エンジンは BlockState をその場で書き換えず、毎回新しいオブジェクトに置き換える [コード: packages/sim/src を grep。書き換えに見えたのは rail.ts の作業用の RailConnector と wire-shape.ts の作りたての接続だけ]。モジュールの最上位にある Map・配列は、方向の順などの定数の表だけだった [コード: grep]。

`clone()` は runningThisTick (この tick に取り出した予約の集合) も写す (world.ts:1500 [コード])。`tick()` は取り出した予約を 1 件走らせるたびに集合から外す (world.ts:556-562 [コード]) ので、境目では空になる。全部の境目 8,872 か所で、上の一時の欄はすべて空だった [確かめ]。形式には入れない。

**調べて、TS のエンジンに無いと確かめた物** (だから表に無い):

| 物 | 確かめ |
|---|---|
| 乱数 | packages/sim/src に Math.random も時刻の読み取りも無い [確かめ: grep]。ドロッパーのスロット選びは先頭の空でないスロットで代用している (world.ts:1686-1688 [コード]) |
| エンティティ | 無い。カートと踏む人は「トリガの時に予約を積む」形で代用し (fixture-driver.ts:227-234・254-257 [コード])、値は blocks と予約に入る |
| ブロック以外の世界の値 (天候・時刻・ゲームルール) | 無い。時計は currentTick だけ |
| モジュールに置いた書き換わる値 | 無い (`let` で始まる最上位の変数が無い [確かめ: grep])。状態は SimWorld の中だけ |
| 鍵の順への依存 | 無い。BlockState を Object.keys で回す所が無い [確かめ: grep]。鍵の順を書き出しでそろえても動きは変わらない |
| 予約の配列の順への依存 | 無い。配列を逆順にして戻しても、全部の境目でずれ 0 [確かめ: schedReversed] |

**派生物は正に置かない**。入れ物の頭の `tick`・`blockCount`・`digest` は core の写しである (§2.1)。ダストの power や connections は「計算すれば出る」ように見えるが、近隣更新が来た時にしか直らないので派生物ではない (「近隣更新でだけ変わる値」の行)。

### 1.3 エンジンの外にある状態 (入れ物の別の節)

続きの正しさには要らないが、画面が同じ続きを出すには要る物。

| 欄 | 意味 | 持ち場所 | 欠けた時 |
|---|---|---|---|
| 設計図 | 編集モードの回路・盤面の大きさ・取り込み由来の印 | app/src/circuitStorage.ts:33-42・packages/editor/src/editor.ts:90-115 [コード] | 「編集に戻る」で出す物が決まらない。sim の盤面には編集で置けない物 (moving_piston・piston_head) がある (packages/editor/src/editor.ts:245-247 [コード]) |
| 再生の位置 | fixture の名前・何 tick 目まで入力を入れたか・`authored` | fixture-driver.ts:314-318 [コード] | 残りの入力が 1 tick ずれる。world の時計は settle の分だけ先のことがある (150 本のうち 6 本で +2、残りは 0 [確かめ]) ので、fixture の tick を world の時計で代用できない。差は「core の時計 − fixture の tick」で出るので、書かない |
| 見え方 | カメラ・3D/2D・層・埋め込みの mode | IsometricView.tsx:216-222 [調査] | 見え方だけ戻らない |

### 1.4 相の途中で止める時 (後の段。カーソル方式)

版 1 では作らない。作る時は次の形にする (案 A から)。
- 相の途中の状態は書かない。**「その tick の頭の境目の状態」+「カーソル (相と、済んだ件数)」** を書く。読み込みは境目の状態を戻し、同じ tick をカーソルまで回し直す。
- 正しい理由: エンジンは乱数も時刻も使わない (world.ts:1686-1688 [調査])。境目から先は入力が無ければ 1 通りに決まる。相の途中では入力を受けない。
- 利点: `tick()` のローカル (取り出し済みの予約の列・着地中の座標の集合・ホッパーの何番目か) を形式に入れずに済む。
- 代価: `tick()` を「始める・1 歩進める・終える」に割る。割った後も結果が変わらないことを全 fixture で確かめる。
- 形式には版 1 から席だけ空ける (`cursor: {phase: 'boundary'}`)。後で足しても入れ物の版を上げずに済む。

### 1.5 19 §3.9 に足した物

§3.9 の 8 行は挙動メモの典拠と合う [調査]。この文書と同じ PR で、19 §3.9 に次の行と注記を足した:

| 足す物 | 理由 |
|---|---|
| 「BE」は実機の保存キーの範囲でなく **メモリ上の全項目** と明記 | 動いている途中のピストンは、今の進みと「最後に動いた tick」を保存しない (保存するのは 1 つ前の tick の進みだけ: V13 §3.3)。ホッパーの「最後に動いた tick」も保存しない (V14 §3.1)。保存キーだけだと往復の性質が崩れる |
| 予約は絶対の発火 tick と予約順のまま。残り遅延を 0 に丸めない。「−n から振る」は実機のデータを読む時だけ | 19 §4.2 と同じ。§3.9 の表に注記が無い (V02 §5.4・§7.3) |
| 動きを変える設定 (連鎖上限・random_tick_speed・実験機能の旗・スロット選び・乱数のモード) | 既定と違う値で回した時、続きが変わる (V18 §7.4・19 §5.4) |
| 条件つき: ワールドの種・時計と空の明るさ・エンティティ | その素子を入れる時だけ (19 §3.7・V01 §4.4・V17) |
| 再生の位置 (エンジンの外) | ビューアで途中から続けるのに要る (R18 §1.1) |
| ticker の列の「除去済みの印」 | 除去は印だけ付け、次に BE の相がその包みに届いた時に列から消える (V01 §4.7)。だから境目に印つきの包みが残りうる。順には効かないが、「全状態で一致」を比べる時に、詰めてから比べるかそのまま入れるかを決める |

境目では決まった値になるので **入れない物** (書き出しの時に、その値であることを検査する):

| 物 | 境目での値 | 典拠 |
|---|---|---|
| 「tick の処理中」の印 (handling_tick) | 偽。tick の頭で真、ブロックイベントの相の直後に偽 | V03 §3.1・§7.3 |
| この tick に取り出した予約の列・実行済みの列 | 空。tick の後始末で空にする | V02 §4.4 |
| ブロックイベントの退避の列 | 空。全域を tick するエンジンでは作らない | V03 §3.1・§7.3 |
| BE の pending | 空。BE の相の最中の追加だけが入り、次の相の頭で移る。入力は相の外なので列の末尾に直接入る | V01 §4.7 |
| 近隣更新のスタック | 空。入力は呼ばれたその場で連鎖を回し切る | 19 §3.6・§4.1 |

19 §3.9 の「ticker の列の順と pending」の pending は、相の途中で止める段 (§1.4) にだけ要る [推測: V01 §4.7 の読み]。

---

## 2. 形式

### 2.1 入れ物 (どのエンジンでも同じ)

名前は `rdsim-state`。拡張子は `.rdstate.json` (gzip した物は `.rdstate`)。読む時は拡張子でなく中身で見分ける (今の取り込みと同じ: nbtIO.ts:342-366 [調査])。

```ts
interface SimStateFile {
  format: 'rdsim-state'
  v: 1                                   // 入れ物の版
  savedAt: string                        // ISO 8601
  title?: string
  engine: {
    kind: 'ts' | 'rust'
    rulesVersion: '1.21.1' | '26.3'      // 19 §2.6 と同じ値。MC の版を兼ねる
    shape: number                        // 状態の形の版 (BlockState・予約・イベントの欄の形)。TS は 1 から
    build?: string                       // sim の版 (package の version + commit)
    tableHash?: string                   // Rust だけ。状態表のハッシュ (19 §3.1)
    options?: Record<string, number | boolean | string>  // 既定と違う設定だけ
  }
  tick: number                           // core の時計の写し (一覧用。正は core の中。読み込みでは使わない)
  blockCount: number                     // 同上
  digest: string                         // core の要約値 (§2.4)
  core: TsCore | RustCore                // エンジンの完全な状態 (§2.2)
  cursor: { phase: 'boundary' }          // §1.4。版 1 はこれだけ
  player?: PlayerState                   // 再生の位置 (§2.3)
  design?: DesignState                   // 設計図 (§2.3)
  view?: ViewState                       // 見え方 (§2.3)
  proof?: { ticks: number; digest: string }  // 続きの指紋 (§2.6)。後の段
  portable?: PortableState               // 持ち運べる形 (§2.5)。後の段
}
```

- 頭の `tick`・`blockCount`・`digest` は core から出る写しである。正は core。読み込みは core だけを使い、写しが core と合わなければ断る (§4.2)。
- 読み手は、知らない欄があっても断らず、無視する。後の PR が節を足しても、入れ物の版を上げずに済む。最初の読み手 (M3-9) は `player`・`design`・`view`・`proof`・`portable` の中身を見ない。

### 2.2 core

```ts
// Rust のエンジン (26.3)。中身は 19 §2.5 の不透明なバイト列 (rse_snapshot の出力)。19 §3.9 の全部を含む
interface RustCore {
  bytes: string | ArrayBuffer            // ファイルでは base64。postMessage と IndexedDB では ArrayBuffer
}
// 参考: TS のエンジン (1.21.1) で書くならこの形になる。作らない (決定 11)。§6.1 の台本はこの形で回した
interface TsCore {
  tick: number                           // currentTick そのまま。0 へずらさない
  seq: number                            // seqCounter そのまま
  blocks: [x: number, y: number, z: number, state: BlockState][]  // Map の挿入順のまま。並べ替え禁止
  scheduled: { pos: Pos3D; type: BlockType; due: number; pri: number; seq: number }[]  // due は絶対 tick
  events: { pos: Pos3D; type: BlockType; param: 'extend' | 'retract' | 'play' }[]      // 列の順が実行順。並べ替え禁止
}
```

core の決まり。理由は TS のエンジンで確かめた事実だが、決まり自体はどのエンジンにも当てる。Rust の `rse_snapshot` も、この決まりを満たすバイト列を出す (3 案で分かれた所は理由を付ける):

| 点 | 決まり | 理由 |
|---|---|---|
| 絶対 tick | そのまま書く。相対に直さない | 案 B は相対を勧めた。全部を同じだけずらしても結果は同じ [調査] だが、直す欄が 4 種あり (予約の dueTick・moving_piston の finalizeDue・ホッパーの cooldownUntil・トーチの recentToggles。時計を足して作る所は world.ts:449・703・1117・1140・1546・2043 ほか [コード])、1 つ忘れると 103 tick ずれる種類の誤りになる。直さなければ起きない。画面の tick は world の時計から出す |
| seq | そのまま書く。振り直さない | 振り直してもずれ 0 [調査] だが、そのままなら「内部の全状態が同じ」を素直に比べられる。予約の seq と moving_piston の seq は別々に並べ替えるので (world.ts:550・619-621 [コード])、互いの前後は結果に効かない。これは読みで、動かして確かめてはいない |
| 並び | blocks の全体の順を保つ | 今 tick の中で効くのはホッパーだけ (world.ts:633-640 [コード]) だが、BE の ticker が増えても形式を変えずに済む |
| 座標 | 絶対のまま。原点へ寄せない | ダストの起点の順は絶対座標で決まる (updates.ts:28-50 [調査])。取り込みの経路は原点へ寄せる (EditorPage.tsx:799-800 [調査]) ので、状態は取り込みの経路に通さない |
| `scheduled` の書く順 | seq の昇順に正規化 | 配列の順は実行に効かない (world.ts:548-550 [コード]。逆順にして戻してもずれ 0 [確かめ])。seq は重ならない (全部の境目で重複 0 [確かめ]) ので順は 1 通りに決まる。正規化するとバイトで比べられる |
| 予約の重複 | (pos, type) の重複はそのまま通す | `schedule()` は重複を積まない (world.ts:445 [コード]) が、`seedScheduledTick` は調べずに積む (world.ts:1111-1122 [コード])。seed を使う fixture では重複がありうるので、正しい状態として受ける。今の 150 本では、境目に重複は 1 件も無かった [確かめ] |
| BlockState | sim の型のまま入れる | 落ちる値が無い。**ここが TS に縛られる所** (§8)。形を変えたら `shape` を上げて移行を書く (先例: circuitStorage.ts:111-137 の count → slots [調査]) |
| 写しの深さ | 書き出した物は深い写し | `clone()` と `snapshot()` は BlockState を共有する (world.ts:1482・1498 [コード])。外で書き換えても world が壊れないようにする |

JSON にする時の決まり (検査で守らせる)。入れ物の JSON と、portable (§2.5) と、参考の TsCore に当てる。Rust の core はバイト列のまま入る:
- 数はすべて安全な整数 (BlockState の中も)。JSON は NaN と Infinity を null にし、`cooldownUntil: null` は 0 扱いになって動きが変わる [調査]。書き出しで検査し、あれば例外。
- 無い欄は書かない。null にしない。空のスロットは null (null でないと putOne が使わない: container.ts:148 [調査])。配列の中の undefined は例外。
- `slots` が空の列なのと欄が無いのとは意味が違う (物流か手動か: container.ts:105-112 [調査])。区別を保つ。
- 鍵の順は決まった順で書く。BlockState の中は鍵の名前の昇順にする (型の定義の順は実行時に残らないので使わない)。エンジンは鍵の順に依らない (§1.2) ので、そろえても動きは変わらない。「書き出し → 読み込み → 書き出し」がバイトで一致する。

符号化の使い分け:

| 場面 | 符号化 |
|---|---|
| ファイル | JSON (UTF-8)。1 MB を超えたら `CompressionStream('gzip')` |
| IndexedDB | 素のオブジェクトのまま 1 行 (structured clone) |
| postMessage (埋め込み・Worker) | 素のオブジェクト。Rust の bytes は transferable で移す (19 §2.7) |
| NBT | 使わない。実機の形式に見えると「実機で読める」と誤解される。実機向けは別の操作 (§3.4) |
| 二進 (自前) | 版 1 では作らない。Rust の core が 19 §2.5 のバイト列で入るだけ |

### 2.3 エンジンの外の節

```ts
interface PlayerState {
  source:
    | { kind: 'design' }                                   // エディタの回路から始めた
    | { kind: 'fixture'; name: string; fixtureDigest: string
        ; fixtureTick: number }                             // fixture の tick k。「tick k を回し、tick k の入力まで入れた」所
    | { kind: 'state' }                                    // 状態のファイルから始めた
    | { kind: 'live' }
  authored?: [x: number, y: number, z: number, block: string][]  // fixture の時だけ。setblock で変わる (fixture-driver.ts:243)
  inputLog?: { tick: number; input: PlayerInput }[]       // 始めてから入れた入力の記録 (任意)
}
interface DesignState { blocks: Record<string, BlockState>; board?: BoardSize; imported?: boolean }  // circuitStorage と同じ形
interface ViewState { topDown?: boolean; layer?: number; camera?: CameraInput; embedMode?: 'view' | 'interact' }
```

- どれも無くても core は読める。
- `fixtureTick` の意味は 1 つに決める: 再生器は「1 tick 回す → その tick の入力を入れる」を 1 歩として扱い、歩の途中では止まらない (今の FixtureRunner.step と同じ: fixture-driver.ts:336-342 [コード])。world の時計との差 (settle の分) は `core.tick − fixtureTick` で出るので、書かない。
- fixture の入力には「1 tick 遅れて効く物」がある (カートの召喚は次の tick に効く: fixture-driver.ts:227-234 [コード])。これは fixture と `fixtureTick` から決まるので、状態には入れない。
- fixture の本文は入れない。名前と要約値で引く。合わなければ player を捨て、world だけ続ける (「入力は続かない」と出す)。

### 2.4 要約値 (digest)

- core を正規の形 (§2.2 の鍵の順・`scheduled` は seq 順・blocks と events の順はそのまま) の文字列にし、ハッシュを取る。
- 使い道: 往復のテストで「内部の全状態が同じ」を 1 つの値で比べる。読み込みで壊れたファイルを見つける。保存先に書いた直後の読み直しの検査。Worker から戻った時の突き合わせ。
- 同期で使える小さいハッシュ (64 bit 相当・非暗号) を使う。改ざんを防ぐ物ではない。速さは M2-7 と M3-9 で測る (分かっていない)。毎 tick の digest は重いかもしれないので、通知の digest は任意にする。

### 2.5 持ち運べる形 (portable。任意の節・後の段)

別のエンジン・別の版・実機へ持って行く時の形。**正確さを約束しない**。正は core である。案 B の中立な形を、ここに限って採る。

- 語彙は Minecraft の物。ブロックは blockstate の文字列。BE と予約の鍵は実機の保存キー (予約の i・x・y・z・t・p、OutputSignal、TransferCooldown、Page: R18 §1.2)。
- 時刻は **相対** で書く (予約は残り遅延、ホッパーは残りの待ち、焼き切れは何 tick 前か)。実機の保存と同じ持ち方 (V02 §4.7)。残り遅延は負でも丸めない (V02 §5.4)。
- 今の fixture の途中開始の欄 (trustAuthored・scheduled・comparators・cooldowns・items・lectern: fixture-driver.ts:72-137 [調査]) を部分集合にし、足りない物を足す: ブロックイベントの列・動いている途中のピストン (運ぶ状態・向き・伸長か・残り tick)・焼き切れの記録・予約の種類 (今は読まれない: fixture-driver.ts:203-205 [調査])・sim の代用品の値 (手動のコンテナの強さなど)。今の欄だけでは 270 / 1,556 か所が表せない [調査]。
- blocks は core と同じ並び (設置順) で書く。BE の相の順になるので、並べ替えない。実機の保存から作る時は設置順が分からないので、`missing` に「BE の順」と書く。
- `fidelity` と `missing` を必ず書く (案 B から)。

| fidelity | そろっている物 | 作る所 | 読んだ時の意味 |
|---|---|---|---|
| `oracle` | blockstate・BE・予約 (順つき) と、実機が保存しない値の一部 | 26.3 のオラクル (R18 の O4) | 続きに近い。`missing` の欄の分だけずれうる |
| `vanilla-save` | blockstate・BE の保存キー・予約 | ハーネスの今の採取 (保存データを読む) | 「実機で保存して開き直した時」に近い。欠けは実機の読み込みと同じ規則で埋める (ブロックイベントは空・焼き切れは空・予約順は列の順: V03 §3.1・V08 §3.3・V02 §4.7) |
| `structure` | blockstate と BE の一部 | 構造 NBT・litematic・schem | 止まった回路向け。今の trustAuthored の取り込みと同じ |

- sim が自分の core から portable を作る時、表せない物は `missing` に書く。黙って落とさない。
- 「止めずに回した時と同じ続き」を名乗れるのは core だけ。portable から読んだ world は、画面に「正確でない読み込み」と欠けている物の名前を出す。

### 2.6 版

| 版 | 置き場 | 違う時の扱い |
|---|---|---|
| 入れ物の版 `v` | 頭 | 欄を足すだけでは上げない。新しすぎる → 読まない (理由を出す)。古い → 移行 |
| 状態の形 `engine.shape` | engine | 古い → 移行の関数を順に当てる。新しい・移行が無い → 読まない。**黙って捨てない** (ユーザが書き出したファイルは自動保存と違い、捨ててよい物でない) |
| エンジンの種類と規則の版 | `engine.kind`・`rulesVersion` | 違う → core は「続き」としては読まない。portable があれば「正確でない読み込み」を選べる。無ければ design から最初からやり直せる |
| 状態表のハッシュ | `engine.tableHash` (Rust) | 違う → core は読めない (19 §2.5)。portable へ |
| sim の版 `engine.build` | engine | 違っても読む。「続きが保存した時と同じとは限らない」印を出す。後の段で proof (下) を足して、ファイルごとに見分ける |
| MC の版 | `rulesVersion` が兼ねる | — |

この表の扱いは §9 の 4 で決まった。sim の版だけ違えば読んで印を出し、エンジン・規則の版・状態表のハッシュが違えば「続き」としては読まない。

**続きの指紋 (proof)** (案 C から。後の段): 書き出す時に、状態の写しを入力なしで 20 tick 進め、その digest を書く。読んだ側が裏で同じことをして比べる。合わなければ「エンジンの挙動が変わったので続きが違う」と出す。合っても「20 tick までは同じ」としか言えない。台本で試していない案である。

### 2.7 大きさの目安 (実測は調査結果)

| 回路 | core の JSON | gzip |
|---|---|---|
| fixture の中央 (17 ブロック) | 約 1.3 KB | 約 0.3 KB |
| 最大の fixture (477 ブロック) | 約 33.6 KB | 約 2.3 KB |
| 合成 7,501 ブロック | 476 KiB | — |
| 合成 約 20 万ブロック (同じ物を並べた) | 15.5 MB (書く 46 ms・読んで組む 216 ms。1 回の計測) | 902 KB |

- design や portable を入れると 2〜3 倍になる [推測]。
- 大きさは削らない。パレット化 (1.62 MB まで縮む [調査]) は入れない。入れる時は `core.encoding` を足す。
- 検査・深い写し・digest の費用は測っていない。

---

## 3. 書き出し

### 3.1 エンジンの口

| 口 | 置き場 | 働き |
|---|---|---|
| `rse_snapshot(h)`・`rse_restore(bytes)` | Rust (19 §2.5) | 世界の全状態をバイト列に出す・バイト列から新しい世界を作る。境目でなければ状態コードで断る。一時の欄が決まった値かを検査する (§1.5 の「入れない物」)。M2-7 |
| `engine.saveState(): RustCore` | Engine 型 (19 §2.6) | `rse_snapshot` を包む。TS の SimWorld は持たない (決定 11)。再生器は Engine の能力を見て、TS の時は書き出しと読み込みを出さない |
| `loadState(kind, core): Engine` | `createEngine` の並び | 読み込みは世界を新しく作る口なので、Engine のメソッドにしない。Rust は `rse_restore` |
| `engine.stateDigest(): string` | Engine 型 | §2.4 |
| `get currentTick`・`get atBoundary` | Engine 型 | 時計と「tick の途中でないか」。画面が tick を別に数えるのをやめる |
| `encodeState(file)`・`parseSimState(text \| bytes \| object)` | packages/sim (TS。エンジンに依らない) | 入れ物の組み立てと検証 (§4.2)。gzip の判別を含む。M3-9 |

- TS の SimWorld で見つけた直し所 (`getScheduledTicks`・`getBlockEvents` が内部の配列をそのまま返す: world.ts:526-532 [コード]。`BlockEvent` 型を index.ts から出していない [調査]) は、書き出しを作らないので直さない。

### 3.2 どの画面から・何を・どこへ

どの画面も再生器の `save()` を呼ぶ (§5)。再生器ができるまで (M3-11 の前) は、エディタが Engine の口を直接呼ぶ。

| 画面 | 入口 | 入れる物 | 先 |
|---|---|---|---|
| EditorPage (sim) | 「💾 Init」の並び (EditorPage.tsx:1171-1188 [調査]) を「ここを覚える (メモリ)」「状態を保存」「状態を書き出す」にする | core + design + view | メモリ (`clone()`)・ブラウザ内・ファイル |
| EditorPage (自動) | 止めた時と pagehide | core + design | ブラウザ内の自動保存の枠 (1 件)。回路の自動保存 (localStorage) とは別 |
| EmbedPage | 親からの `rdsim:save` (§5.6)。iframe の中のボタンは出さない | core + design + view | 親のページ。親が自分の権限で redtact の DB に置く |
| 読む用の Web の FixtureViewer | バー (FixtureViewer.tsx:190-206 [調査]) に「エディタで開く」「書き出す」 | core + player + view | 受け渡しの枠 (ブラウザ内)・ファイル |
| DemoPage | `window.__demo.save()` | core + player | 戻り値 (道具・e2e) |
| LivePage (開発用) | 「sim 側を書き出す」。後回し | core + player(live) | ファイル |

### 3.3 保存先 (`StateStore`)

```ts
interface StateStore {
  readonly id: 'file' | 'browser' | 'parent' | 'handoff'
  put(file: SimStateFile, opts?: { slot?: string; title?: string }): Promise<{ ref: string }>
  get(ref: string): Promise<SimStateFile>
  list?(): Promise<{ ref: string; title?: string; savedAt: string; tick: number; blockCount: number; engine: string }[]>
  delete?(ref: string): Promise<void>
}
```

| 保存先 | 中身 | 決まり |
|---|---|---|
| メモリ | チェックポイント・1 tick 戻る | `clone()`。形式を通さない (477 ブロックで 0.024 ms [調査]) |
| ファイル | Blob + `a.download` で出す (先例: nbtIO.ts:1121-1130 [調査])。ファイル選択とドラッグで読む | ドラッグで読む処理は今は無い [調査] |
| ブラウザ内 | IndexedDB の `rdsim` DB・`states` の表。1 行 = 1 ファイル + 一覧用の列 | 新規 (今は IndexedDB を使っていない [調査])。localStorage は 5 MB 前後で、同じ鍵に入れると回路の自動保存まで失敗しうる (circuitStorage.ts:24 [調査]) |
| 受け渡し | 同じ DB の `handoff` の表。1 回読んだら消す | 同じ DB を読めるのは、読む用の Web がエディタと同じ origin にある時だけ。今そうなのは PR のプレビューと e2e (app の preview の /docs/ に写す: playwright.config.ts:34-37 [コード])。手元の dev は origin が別で、本番 (rdsim.com) には読む用の Web をまだ出していない (docs-web/vite.config.ts:9-11・50-51 [コード])。origin が別の時は「エディタで開く」を出さず、「書き出す」(ファイル) だけにする |
| 親のページ (サーバの DB) | 埋め込みの `rdsim:state` で親へ渡す | rdsim はサーバを持たない (app/wrangler.toml [調査])。iframe の中からは redtact の API を呼べない (14 §2.2 [調査])。保存は親が行う |
| URL | 運ぶのは受け渡しの ID だけ (`?state=<id>`) | 状態も自由な文も載せない |

- どの先でも、**書いた直後に読み直して digest を比べる**。
- **DB には入れ物を 1 つの塊 (gzip した JSON) で置く**。ブロックを行に分けない。主キーの順で並べ直すとホッパーの順が変わる。検索用の列 (format_v・engine_kind・rules_version・shape・build・tick・block_count・title) は頭から写す。
- redtact の側に要る物 (新しいファイルの種類・R1 のカード・読めない版の扱い) は redtact の issue にする。手元の redtact の main では埋め込みを使っている所が無く、3D 表示が扱うのは構造ファイルだけ [調査]。rdsim 側は「親へ渡す・親から受け取る」までで完成とする。

### 3.4 実機向けの書き出し (別の操作)

「実機へ持ち出す」と名付け、状態の保存と分ける。**落ちる物の一覧を必ず出す**。

- 今の書き出しは moving_piston を air にし (nbtIO.ts:745-746)、BE はコンテナと書見台だけ (nbtIO.ts:150) [調査]。
- 足す物 (後の段): コンパレーターの OutputSignal・ホッパーの TransferCooldown・DataVersion。どれも実機が知っている鍵 (R18 §1.2)。
- 足せない物: 予約 tick (構造物の保存は持たない: R18 §3.4)・ブロックイベント・焼き切れの記録。
- ピストンが動いている最中なら「着地するまで進めてから書き出す (あと n tick)」を勧める。動いている途中のピストンを構造 NBT で実機へ戻せるかは分からない (構造ブロックの保存と読み込みの中身は挙動メモの対象外: docs/vanilla/00_coverage.md:348 [コード])。

### 3.5 circuitStorage の決まりの書き換え

「シミュレーションの途中状態は派生物なので持たない」(circuitStorage.ts:12 [コード]) を次に変える。
- 設計図 (編集モードの回路) は今までどおり localStorage。この決まりは回路の自動保存だけの物と書き直す。
- 途中状態は派生物ではない (設計図と入力の列からは、同じ版のエンジンでしか作り直せない)。別の置き場に、版つきで持つ。

---

## 4. 読み込み

### 4.1 エンジンの入口 (`rse_restore`・`loadState`)

- 新しい世界を作り、バイト列の中身をそのまま置く。**19 §4.2 の読み込みの型・seed・settle を通さない**。組み直すと、予約・ブロックイベント・カウンターが消えるか振り直しになるからである。TS のエンジンで、この落とし穴をコードで確かめた:
  - `initialize()` は trustAuthored でも予約・runningThisTick・ブロックイベント・seq を消す (world.ts:925-928 [コード])。
  - `seedScheduledTick` は種類を今のブロックから取り、負の遅延を 0 に丸め、seq を新しく振る (world.ts:1111-1122 [コード])。
  - 盤面だけ置いて initialize する今のエディタの戻し方は、止め所の 549〜552 / 1,556 でずれた [調査]。
- 置く順は書き出した順のまま (挿入順・予約順・ブロックイベントの列の順)。
- 発音などの観測の窓 (19 §2.5 の「観測」) と trace は付いていない状態で返す。呼び出し側が付け直す。
- 入れた直後に `stateDigest()` を取り、入れ物の digest と比べる。違えば断る。
- 読み込んだ直後に 1 tick も回さない。回すのは利用者が再生か +1 を押した時。

### 4.2 検証 (他人が作った入力として扱う)

順に: 大きさの上限 → parse → `format`・`v` → 件数の上限 → 型 → 整合 → digest。

| 確かめる物 | 決まり | だめな時 |
|---|---|---|
| 大きさ | parse の前にバイト数を見る。既定 64 MB (親からは redtact の上限 50 MiB: 14 §4 [調査]) | too-large |
| ブロックの数 | 既定 200,000 (今の MAX_SAVED_BLOCKS と同じ [調査])。引数で上げられる。予約とイベントにも上限 | too-large |
| 頭 | `format`・`v`・`engine` の型。頭の `tick`・`blockCount` が core と合う | invalid |
| core (Rust) | 先頭の状態表のハッシュが今のビルドと同じ (違えば §2.6)。中身は `rse_restore` が検査する: 状態表の範囲・件数・予約順のカウンターより小さい番号・番号の重複 | invalid・state-version |
| core (参考の TsCore)・portable | 数は安全な整数 (null の数は不正)。座標の重複を断る。type ごとの形を確かめ、知らない type は断る。moving_piston の運んでいるブロックも同じ検証に通す。TS の world は air を持たない形 (world.ts:423-424 [コード]) なので、air は断る。予約と moving_piston の seq が `core.seq` より小さく、予約の seq に重複が無い (全部の境目でこの 2 つは成り立っていた [確かめ]) | invalid |
| digest | 合わなければ断る | invalid |

- **エンジンが自分では作らないが正しい状態は通す**: 種類が今のブロックと違う予約 (古い予約)・期限の過ぎた予約 (V02 §5.4)・(pos, type) の重複した予約。断るのは、エンジンが落ちるか固まる物だけ。
- 入れ物の検証は packages/sim (TS) に置く。画面と埋め込みが同じ関数を使う。core の中身の検査は Rust の `rse_restore` が受け持つ。
- 失敗は理由つきで返す。例外を外へ出さない。

### 4.3 すぐ再開する流れ (どの画面でも同じ)

```
バイト列 / オブジェクト
  ① 見分ける     format === 'rdsim-state' か (違えば今の取り込みへ)
  ② 検証         §4.2。だめなら理由つきで止める
  ③ 版を合わせる §2.6。移行 / 読めない / 正確でない読み込み
  ④ 組み立てる   loadState(kind, core) (Rust は rse_restore) — 読み込みの型も settle も通さない
  ⑤ 再生器に入れる 止まった状態。tick は世界の時計 (頭の tick と同じ)
  ⑥ 画面を合わせる design → エディタの回路、view → カメラ、player → 残りの入力
```

| 画面 | 入口 | 流れの注意 |
|---|---|---|
| EditorPage (ファイル) | ⋯ の「↑ 読込」(EditorPage.tsx:1336-1345 [調査])・ドラッグ・保存の一覧 | **取り込みの preview・原点寄せ・盤面外の切り捨てを通さない** (EditorPage.tsx:747-800 [調査]。通すと状態が壊れる)。盤面の大きさは design.board、無ければ blocks の範囲から決める |
| EditorPage (起動時) | 自動保存の枠 | 「止めた所から続ける (tick n)」の帯を出す。押すまでは今までどおり設計図を開く。黙って sim に入らない |
| EditorPage (URL) | `?state=<id>` | id は受け渡しの枠の鍵 |
| EmbedPage | `rdsim:load` の `format: 'rdsim-state'` | 16³ の固定の盤面 (EmbedPage.tsx:42-49 [調査]) で切らない。表示の範囲を状態に合わせる |
| FixtureViewer・DemoPage | 再生器の `load`・札に状態を書く | fixture の要約値が合えば残りの入力も続く |

「編集に戻る」: design があればそれを出す。無ければ「止めた盤面を回路として取り込む (動いている途中のピストンは戻せないと出す)」か「戻らない」を選ばせる。

`↩ Reset` の意味を 2 つに分ける: 「覚えた所 (💾) / 読み込んだ状態へ戻る」と「設計図の初めへ戻る」。

### 4.4 版が違う時・欄が足りない時

| 場合 | 扱い |
|---|---|
| core の必須の欄が無い・型が違う・digest が合わない | **断る**。推測で埋めない。initialize へ落とさない |
| `v`・`shape` が古い | 移行して読む。移行したことを warnings に出す |
| `v`・`shape` が新しい | 断る (「新しい版で保存された」と出す) |
| `build` だけ違う | 読む。「続きが保存した時と同じとは限らない」印 |
| `kind`・`rulesVersion`・`tableHash` が違う | 「続き」としては断る。portable があれば「正確でない読み込み」、design があれば「最初からやり直す」を選べる |
| player・design・view が無い・壊れている | core だけ読む。design が無ければ「編集に戻る」は選択つきになる |

### 4.5 settle の扱い

- 状態の読み込みでは **settle しない**。境目の状態は、そのまま続きの出発点である。
- settle が要るのは「静止した設計図から始める」時だけ。今までどおり `initialize()`。
- fixture の出発点 (buildFixtureWorld の `flush(64)`: fixture-driver.ts:212 [調査]) は変えない。その後を書き出す時は、world の時計 (settle の分だけ進んでいる) をそのまま書き、fixture の tick は player に書く。
- portable から読む時だけは、今の buildFixtureWorld の道 (trustAuthored + seed) を土台にする。別の関数 (`fromPortable`) にし、名前で分ける。今の `seedScheduledTick` は種類を今のブロックから取り、負の遅延を 0 に丸める (world.ts:1111-1122 [コード]) ので、そのままでは §2.5 の「種類を持つ・負でも丸めない」を満たせない。E7 で種の入れ方を広げる。seq は振り直しになるので、portable から読んだ world は core と digest が合わない (比べるのは盤面の系列だけ: RT12)。
- 「盤面だけ取り込んで組み直す」(今の Init → Reset の動き) は、取り込みの 1 つとして残す。

---

## 5. ビューアとシミュレーションの連携

### 5.1 今の形 (事実)

- ビューア (IsometricView) は tick を知らない。写しを描き、押された座標を返すだけ (packages/viewer/src/IsometricView.tsx:89-99 [コード])。
- 連続実行の setInterval 100 ms が 3 か所にある (EditorPage.tsx:1020-1036・EmbedPage.tsx:198-207・FixtureViewer.tsx:103-107 [調査])。Demo と Live は手で進める。
- tick の数え方が画面ごとに違う。エディタは `setTick(result.currentTick)` (EditorPage.tsx:1011 [コード])、埋め込みも別の state、fixture は `FixtureRunner._tick` (fixture-driver.ts:318 [コード])。world に時計を読む口が無い。
- 戻し方が 4 本あり、どれも完全でない。エディタは盤面だけ覚えて initialize し直す (EditorPage.tsx:905-909・944-963 [コード])。Reset の後は表示が checkpointTick になり、次の +1 で 1 に跳ぶ (EditorPage.tsx:960・1011 [コード]。動かしてはいない)。埋め込みは設計図の初めへ戻る (EmbedPage.tsx:173-185 [コード])。FixtureViewer は作り直す。
- world の組み方が 3 本ある (editor.buildSimWorld・buildFixtureWorld・SimSession [調査])。
- ビューアは写しを中身で比べる。比べ方は「範囲が同じ・数が同じ・マスごとの BlockState が同じ参照」である (IsometricView.tsx:42-52 [コード])。1 マスでも違えば構造を丸ごと作り直す (同 808-840 [調査])。差分用の `patchStructureFromSnapshot` は packages/viewer から出ているが、呼ぶ所が無い [確かめ: grep]。
- `TickResult.changedPositions` は漏れる。1 tick で変わった 5,935 マスのうち 1,390 が載らず、入力で変わった分は返す口が無い [調査]。
- 小さい回路では tick (0.020 ms) より写しと作り直し (0.104 + 0.681 ms) の方が重い [調査・Node での計測]。

### 5.2 3 つの層

```
┌ 画面 (Editor / Embed / Demo / docs / Live) ─ React。ボタンと配置だけ
│     useSimPlayer(player) … 通知を React の state に写す hook
├ 再生器 SimPlayer ─ packages/sim/src/player (React を知らない)
│     engine・時計・ループ・入力の列・チェックポイント・save/load・通知
├ エンジン Engine ─ 19 §2.6 の型に口を足す。Rust: RustWorld (状態の出し入れができる) / TS: SimWorld (できない)
└ ビューア IsometricView ─ 写しと変化の列を受け取るだけ。tick を知らない (今と同じ)
```

- 置き場は @redstone/sim の中。新しいパッケージを作らない (19 §2.6)。
- Engine 型に足す口: `currentTick`・`atBoundary`・`saveState()`・`takeChanges()`。読み込みは世界を新しく作る口なので、Engine のメソッドにせず、`createEngine` の並びに `loadState(kind, core)` を置く。Rust の中身は `rse_restore` である (この文書で `loadState` と書いた所はこの口を指す)。TS の SimWorld は `saveState` を持たず、`loadState("ts", …)` は unsupported を返す (決定 11)。再生器は能力を見て、書き出しと読み込みの操作を出し分ける。`snapshot()` (写し) の名前は変えない。

### 5.3 窓口: 再生器の命令と通知

**命令** (どの画面も同じ。埋め込みの message と 1 対 1)

| 命令 | 意味 | 今の対応 |
|---|---|---|
| `open(source)` | 出どころを開く。設計図 (initialize する)・fixture・状態・実機 (後) | 3 本の組み方をここへ寄せる |
| `play()`・`pause()`・`setRate(tickMs)` | 連続実行。止まるのは必ず境目 | 3 か所の setInterval |
| `step(n = 1)` | n tick。大きい n は分けて回し、進み具合を出す | Embed は 1 つのタスクで回し切る (EmbedPage.tsx:163-171 [コード]) |
| `input(i)` | 境目の入力 (トリガ・setblock・コンテナ・書見台)。記録して inputLog に残せる | 各画面が world を直接呼ぶ |
| `mark(name?)`・`restore(name?)` | 今の所を覚える・戻る (`clone()`)。**時計も予約も戻る** | 💾 Init・↩ Reset (今は盤面だけ) |
| `back(n = 1)`・`seek(tick)` | 一定間隔で取った `clone()` の輪から戻し、足りない分は入力の記録を当てて回し直す | 無い |
| `reset(to)` | `'opened'` = 開いた時の状態へ / `'design'` = 設計図から組み直す | Embed の reset・編集へ戻る |
| `save(opts)`・`load(file)` | 入れ物を返す・読んで止まった状態にする | 無い |
| `fastForward(n \| 'quiescent')` | Worker で進める (§5.5) | 無い |
| `stepPhase()`・`stepItem()` | 相・1 件で進める (§1.4。最後の段) | 無い |

**通知**

| 通知 | 中身 | 受け手 |
|---|---|---|
| `state` | `{ status: 'idle'\|'paused'\|'playing'\|'busy', tick, source, engine, canBack, atEnd }` | 画面の表示 |
| `tick` | `{ tick, changes, digest? }` | ビューア・埋め込みの `rdsim:tick` |
| `changes` | 入力や load で変わった分 (tick の外の変化) | ビューア |
| `note` | 発音 (noteHook の置き換え) | HUD・音 |
| `progress` | `{ done, total }` | 進み具合の表示 |
| `loaded` | `{ warnings, engine, tick, exact: boolean }` | 画面・埋め込みの `rdsim:loaded` |
| `error` | `{ code, message }` | 画面・埋め込みの `rdsim:error` |

決まり:
- **tick を回す主体は再生器だけ**。画面は setInterval を持たない。対話の間はメインスレッドで回す (19 §2.7)。
- **時計は 1 つ**。画面の tick は `engine.currentTick` から出す。fixture の時は `currentTick − clockOffset`。clockOffset (settle の分の差) は再生器が持つ値で、ファイルには書かない。読み込みの時に `core.tick − fixtureTick` で出す。
- 入力は必ず境目に入る。fixture の入力も、手の入力も、親からの `rdsim:trigger` も同じ列を通る。
- 裏のタブで timer が間引かれた時は、**追い付かない** (遅れるだけ)。案 C は「経過時間から tick 数を決め、20 tick まで追い付く」としたが、案 B の「追い付かない」を採る。理由: 単純で、決まった回数だけ進む。ブラウザでの実測は無い。
- `scanTriggers` の重複 (EditorPage.tsx:892-901・EmbedPage.tsx:113-121 [調査]) は再生器の `triggers()` に寄せる。

### 5.4 描画への渡し方

| 段 | 渡し方 |
|---|---|
| 今〜再生器の段 | 今までどおり写しを渡す。エンジンは BlockState を書き換えずに作り直すので、変わらないマスは同じ参照のまま。ビューアの参照比較が効く。`clone()` からの戻りでも効く。**ファイルから読んだ直後と Worker から戻った直後だけは、全部が新しいオブジェクトになり 1 回丸ごと作り直す**。これは受け入れる |
| 差分の段 | (1) 書き込みの 1 か所で変わった座標に印を付ける (19 §3.8)。tick でも入力でも読み込みでも同じ列に載る。`takeChanges()` で取る。(2) ビューアに `applyChanges(changes)` を足す (19 §8.2・M3-7)。未使用の `patchStructureFromSnapshot` を土台にする。(3) 安全網: 差分で直した構造と丸ごと作った構造を、開発時とテストで突き合わせる。合わなければ丸ごとへ落とす |
| 全画面 | 止まっている間は描かない (`frameLoop="demand"`。今は FixtureViewer だけ: FixtureViewer.tsx:178 [調査]) |

- 写しと `clone()` は BlockState を共有する。開発時とテストでは BlockState を `Object.freeze` して、外からの書き換えを例外にする。

### 5.5 Worker

| 場面 | 場所 |
|---|---|
| 対話 (1 tick・連続実行・入力・戻る) | メインスレッド (19 §2.7 と同じ。入力の直後に同期で読む使い方と e2e を保つ) |
| 早送り・静まるまで・大きい n の step・proof の確かめ・大きいファイルの parse と検証 | 専用の Worker |

- 流れ: `pause` → `saveState()` → Worker へ送る → Worker が `loadState` して回す (一定の tick ごとに `progress`。`cancel` はその境目で止める) → 状態を返す → メインが `loadState` → digest を確かめる → 写しを渡す。
- **状態の形式が、そのまま Worker との窓口になる**。これは §6 の往復の性質そのもの (RT3) で、CI が守る。別の形を作らない。SharedArrayBuffer は使わない (19 §11 の 14)。
- 早送りの間、入力は受けない (`busy`)。fixture の残りの入力は Worker の中の再生器が入れる。

### 5.6 埋め込みの窓口 (protocol v2)

今の v1 は、`v` が 1 でない物・知らない type・形の違う物を黙って捨てる (protocol.ts:85-118 [コード])。load が受けるのは `'structure-nbt'` だけ (protocol.ts:27 [コード])。`bad-message` と `not-loaded` は型にあるだけ (protocol.ts:43 [コード])。

決め方: **v1 の message はそのまま動かす。新しい物は `v: 2` で送り、`rdsim:ready` の `caps` で知らせる**。案 B は「v1 のまま type を足す」とした。v2 に分けるのは、「必ず返事をする」という約束を足すからである (v1 は黙って捨てる約束で、同じ版の中では変えられない)。redtact の側にはまだ使っている所が無い [調査] ので、どちらでも壊す物は無い。R1 のカードは最初から `caps` を見る形で作れる。

親 → 子:

| type | 引数 | 意味 |
|---|---|---|
| `rdsim:hello` | `{ id }` | 能力を聞く。返事は `rdsim:ready` |
| `rdsim:load` | `{ id, format: 'structure-nbt' \| 'rdsim-state', bytes \| state, autoplay? }` | 回路か状態を読む |
| `rdsim:save` | `{ id, include?: ('design'\|'view'\|'proof'\|'portable')[], encoding?: 'object' \| 'gzip' }` | 今の状態を返させる。再生中なら次の境目で取る |
| `rdsim:step` | `{ id, n }` | 上限つき。超える分は断らず、小分けで回して `rdsim:progress` を返す |
| `rdsim:cancel` | `{ id }` | 進行中の step・早送りを止める |
| `rdsim:seek`・`rdsim:back` | `{ id, tick }`・`{ id, n? }` | 再生器の同名の命令 |
| `rdsim:reset` | `{ id?, to: 'opened' \| 'design' }` | v1 の reset は今の動き (設計図の初めへ) のまま |
| `rdsim:input` | `{ id?, input }` | setblock・コンテナ・書見台 |
| `rdsim:exportStructure` | `{ id }` | 構造 NBT と落ちる物の一覧を返させる (§3.4) |
| `rdsim:run`・`pause`・`trigger`・`setMode` | v1 と同じ | — |

子 → 親:

| type | 中身 |
|---|---|
| `rdsim:ready` | `{ protocols: [1, 2], caps: ['state.save','state.load','seek','back','fastForward','export-structure', …], engine: { kind, rulesVersion, shape, build } }`。秘密を含まないので '*' へ送ってよい (今の方針: protocol.ts:8-12 [コード]) |
| `rdsim:loaded` | v1 の欄 + `id`・`tick`・`engine`・`exact: boolean` (同じ続きを約束できる読み込みか)・`missing` |
| `rdsim:state` | `{ id, state \| bytes, tick, engine, blockCount, digest }`。**固定の origin へだけ送る**。bytes は移す |
| `rdsim:structure` | `{ id, bytes, lost }` |
| `rdsim:tick`・`rdsim:status`・`rdsim:progress`・`rdsim:result` | 再生器の通知と、返事の要らない命令の完了 |
| `rdsim:error` | `{ id?, code, message }`。足す code: `unsupported`・`invalid-state`・`state-version`・`engine-mismatch`・`too-large`・`busy`・`cancelled`。`bad-message`・`not-loaded` も実際に送る |

- v2 は必ず返事をする。`id` で要求と返事を結ぶ。
- 子は受け取った状態を §4.2 の検証に通す。
- 埋め込みではブラウザ内の保存を使わない (iframe の中の IndexedDB は上のサイトごとに分けられうる。確かめていない)。

### 5.7 読む用の Web の FixtureViewer との共通化

- FixtureViewer は FixtureRunner を直接持つのをやめ、再生器を使う (`open({kind:'fixture', fixture})`)。「最初へ」は作り直し (FixtureViewer.tsx:89-99 [調査]) から `reset('opened')` に変わる。足す操作: 「1 tick 戻る」・tick のつまみ・「エディタで開く」・「書き出す」。
- FixtureRunner の役を「fixture の入力を再生器の列に変える物」と「blockstate の文字列で観測を返す物」に絞る。world を隠すのをやめる (今は private: fixture-driver.ts:316 [コード])。fixture のテストの動きは変えない。
- 「エディタで開く」: 状態を受け渡しの枠に置き、エディタを `?state=<id>` で開く。fixture の authored から design を作って一緒に入れる。
- 札に tick や状態を書けるようにする。docs の本文から「この瞬間」を出し、読者が続きを回せる。
- DemoPage も同じ再生器に載せる。`window.__demo` の口の名前は変えず、中だけ替える (道具 tools/demo/demo-gif.mjs を書き直さずに済む)。
- ビューアのチャンクがシミュレーションを含んで大きいのは、そのままでよい (ユーザの決定)。

---

## 6. 正確さの確かめ方

### 6.1 往復の性質 (CI で毎回)

`D(w)` = 内部の全状態の要約値 (§2.4)。止め所は **全部の境目**: 各 fixture の tick 0〜N について、tick の直後 (その tick の入力の前) と入力の直後。150 本の tick の合計は 4,286 [コード: fixture の ticks を足した]。tick 0 を入れて 4,436、2 種で 8,872 か所になる。入力の無い tick では 2 つは同じ状態なので 1 回でよい。

注: 調査の「1,556 か所」は全部ではない。1 本あたり最大 12 か所 + 入力のある tick を選んだ物で、止めたのは入力の直後だけ。内部の比較も seq を外し、時刻を相対に直して比べていた (調査の台本を読んで確かめた。台本はリポジトリに入れていない)。CI のテストは全部の境目で、seq と絶対 tick もそのまま比べる。

見直しで、この形の台本を TS のエンジンで先に回した [確かめ]。結果:

| 確かめた物 | 結果 |
|---|---|
| RT1 に当たる物 (6 欄を JSON にして戻す。全部の境目 8,872 か所。毎 tick、blocks の中身と並び・予約・イベント・時計・seq をそのまま比べる) | ずれ 0 |
| 一時の欄 (RT4 の後半) | 8,872 か所すべてで空 |
| 予約の seq の重複・seq がカウンター以上・期限の過ぎた予約・(pos, type) の重複した予約 | どれも 0 件 |
| 種類が今のブロックと違う予約 | 延べ 50 件 |
| ブロックイベントが残る境目 | tick の直後 16・入力の直後 75 |
| 歯: イベントを空にして戻す | 91 か所 (38 本) でずれる |
| 歯: 予約の種類を今のブロックに直して戻す | 13 か所 (3 本: observer-carried-powered-landing・piston-land-front-land・piston-land-front-observer-away) でずれる |
| 歯: blocks を座標順 (y → z → x) に並べ直して戻す | 6 か所 (1 本: hopper-mixed-transfer) でずれる。**落ちるのはこの 1 本だけ** なので、この fixture が消えると歯が無くなる |
| 歯: seq のカウンターを 0 にして戻す | 18 か所 (5 本) でずれる |
| 歯: 時計を 0 にして戻す | 3,390 か所 (108 本) で盤面がずれる |
| 予約の配列を逆順にして戻す | ずれ 0 (配列の順は効かない) |
| かかった時間 | 1 つの戻し方で約 50〜90 秒 (Node・1 本のプロセス・要約値は JSON の文字列のまま)。毎 tick に盤面の文字列 (expect と比べる形) まで作る形は、2 本並べて 9 分で終わらず、止めた |

歯の比べ方: イベント・予約の種類・逆順は内部の状態をそのまま比べた。座標順と seq は、並びと seq を外した内部の状態で比べた (壊した物そのものは数えない)。時計は盤面の文字列で比べた。

この台本は TS のエンジンの private の欄を直接読み書きした物で、作る物の実装ではない (TS には作らない: 決定 11)。検査・深い写し・鍵の順の正規化も通っていない。Rust の M2-7 で、同じ性質を Rust の口 (`rse_snapshot`・`rse_restore`) で回す。

`save` / `load` は、Rust では `rse_snapshot` / `rse_restore` (Engine では `saveState` / `loadState`) を指す。

| 記号 | 性質 | 範囲 |
|---|---|---|
| RT0 | 欄の棚卸し: 世界の struct を `..` なしで分解するテストを置き、欄を「書く・境目で決まった値 (§1.5)・外」に分ける。欄が増えるとコンパイルで落ちるので、どれにするかを決めないまま入れられない。TS の台本では、SimWorld の `Object.keys` で同じことを確かめた (書く 5・一時 8・外 2: §1.2) | 1 本 |
| RT1 | すべての境目 k で、`load(save(w_k))` から残りを回した系列が、止めない系列と **毎 tick で D が同じ**。入れ物を通す形 (ファイルの JSON と base64) でも同じ。盤面の文字列 (expect と比べる形) も同じ (こちらは重いので、続きの最後の tick と選んだ境目で比べる) | その時点で Rust のエンジンが通る fixture の全部の境目。素子が増えるたびに広がる。TS の台本は 150 本 |
| RT2 | 書き出しが安定: save → load → save で core のバイト列が一致する (入れ物の `savedAt` は比べない) | 同上 |
| RT3 | save → `structuredClone` (ArrayBuffer を移す) → load でも RT1 (postMessage・Worker・IndexedDB の道) | 同上 |
| RT4 | `clone` と `load(save())` の D が同じ。境目で決まった値の欄 (§1.5) は、全部の境目でその値 | 同上 |
| RT5 | **テストに歯があること**: 欄を 1 つ壊した読み込みは RT1 で落ちる。TS の台本で落ちた壊し方と fixture: blocks を座標順に (hopper-mixed-transfer)・seq を 0 に (copper-bulb-toggle ほか 4 本)・イベントを空に (38 本)・予約の種類を今のブロックに (piston-land-front-land ほか 2 本)・時計を 0 に (108 本) [確かめ]。Rust では欄の持ち方に合わせて同じ種類の壊し方 (BE の順・予約順のカウンター・ブロックイベント・予約の種類・時計) を選び、上の fixture を最初の候補にする | 壊し方ごとに 1 本以上が落ちること。座標順で落ちる fixture は TS では 1 本だけだったので、並びを確かめる単体テスト (下から置いたホッパーの縦の列) を別に足す |
| RT6 | 保存済みの見本が今のコードで読め、続きの D が記録と同じ。見本は fixtures のフォルダに置かない (下の注意) | 形式と移行の退行 |
| RT7 | 壊れた入力 (型違い・巨大な数・重複・途中で切れた JSON・壊れたバイト列) を `parseSimState` と `rse_restore` に入れても、例外を外へ出さず、固まらず、理由つきで断る | 手書きの例 + 乱数で作った例 |
| RT8 | 境目でない所 (発音などの観測の窓の中) の save は断る | 1 本 |
| RT9 | (再生器) `seek(t)` の後 = 最初から t tick 回した状態。`back(1)` × m も同じ。`mark` → 進める → `restore` → 同じ続き | 通る fixture |
| RT10 | (差分) `takeChanges()` = 前後の盤面の差 (漏れ 0)。差分で直した構造 = 丸ごと作った構造 | 通る fixture |
| RT11 | (Worker) `fastForward(n)` の後 = `step(n)` の後 | 代表の回路 |
| RT12 | (portable) 相対の時刻を、時計 0 の world と時計の大きい world のどちらへ戻しても、続きの盤面の文字列が同じ。sim → portable → sim で、`missing` が空の時は、続きの盤面の文字列 (expect と比べる形) が毎 tick 同じ。D は比べない (予約順の番号と絶対 tick が振り直しになる)。空でない時は `missing` に名前が出る | 通る fixture |
| RT13 | (カーソル) 相で進めた world と、境目 + カーソルから回し直した world の D が同じ。割った後の tick が割る前と全 fixture で同じ | 通る fixture |

RT0 と RT1 の分け持ち: RT0 と「境目で決まった値の欄はその値」の検査があれば、境目の world は書く欄だけで決まる。だから理屈の上では、RT1 は 1 tick 先の一致を見るだけでも足りる。それでも RT1 は続きを最後まで比べる形のまま残す。JSON を通すと、オブジェクトの参照の同一性のように欄の数では見えない依存が切れる。その依存を拾えるのは RT1 だけで、正確さを優先する決定にも合う。

置き場の注意: 見本の状態を `packages/sim/test/fixtures` に置かない。そのフォルダは CI・docs の索引・アプリの本番の JS の 3 か所が全部拾う [調査]。空の expect は「最後まで変わらない」と比べるので、動く機械は CI で落ちる。

### 6.2 画面をまたぐ確かめ (e2e)

どれも Rust のエンジンで回す (M3-10〜M3-13)。TS のエンジンの画面では、書き出しと読み込みの操作を出さない。

- エディタ: 💾 → 進める → ↩ で、同じ続きになる。Reset の後に tick の表示が跳ばない。💾 と ↩ には今 data-testid が無い [調査]。足す。
- 書き出し → 読み込み → 続きが、止めずに回した時と同じ盤面になる。
- 画面をまたぐ道: 読む用の Web で止める →「エディタで開く」→ エディタで続き。埋め込みで `rdsim:save` → 新しい iframe に `rdsim:load` → 続き。v1 だけを話す親が今までどおり動く。

### 6.3 実機との比べ方

2 つの意味を混ぜない。
- **意味 1 (続き)**: 保存 → 復元 → N tick が、止めずに N tick 回した時と同じ。実機では freeze → step に当たる (V01 §4.8)。この形式の core はこちら。
- **意味 2 (実機の保存)**: 実機で保存して開き直した時と同じ。実機の保存は次の物を変える。だから意味 1 と同じ続きにはならない。
  - ブロックイベントの列と焼き切れの記録は消える (V03 §3.1・V08 §3.3)。
  - BE の順は設置順でなくなる (V18 の R7・R8・V01 §4.7。[要実機])。
  - 予約は、同じチャンクの中の前後は保たれる。番号は負の値から振り直され、別のチャンクどうしは同点になりうる。残り遅延は、チャンクが tick できるようになった時から数え直す (V02 §4.7・§5.5)。
  - 動いている途中のピストンは 1 つ前の tick の進みに戻る (V13 §3.3。着地が遅れるかは [要実機])。
- この文書で「正確」「同じ続き」と書く時は、いつも意味 1 を指す。意味 2 は portable の `vanilla-save` と R4 だけが扱う。

| 確かめ | やり方 | 限界 |
|---|---|---|
| 止めても実機と同じ続きか | **新しい採取は要らない**。fixture は実機で「凍結 → 入力 → step」で採った物 (R18 §1.1)。「fixture が合う」+「RT1 が成り立つ」で出る。2 段で言う | sim がもともと合っていない fixture では区別できない |
| R1: 実機の途中 → sim | **区間 fixture** (案 B から)。実機を止めずに N tick 回した記録の、途中の tick k の状態 (ハーネスが保存データから読む) を portable (`vanilla-save`) にし、k+1〜N を expect にする。普通の fixture として fixtures のフォルダに置ける | 比べている相手は「止めずに回した実機」(意味 1) で、出発点は保存データ (保存しない値が無い)。だからずれうる。ずれた所を `missing` で説明できなければ、sim か形式の欠陥。今のハーネスは予約を「残り遅延 → 優先度 → 座標」の順に並べ直し (tools/mc-harness/runner/scheduled-ticks.ts:109-110 [コード])、moving_piston が残っていると止める (tools/mc-harness/runner/capture.ts:806-825 [コード])。直す必要がある |
| R2: 実機の途中 → sim (保存しない値つき) | オラクルの O4 で予約順・BE の値を撮る (R18 §4.3)。`oracle` の portable にする | オラクルができてから。R18 §4.3 にある物: 予約順・ブロックイベントの追加と取り出しの順 (公開でない欄の差し替えか、偽プレイヤーへ届くパケット)。境目に残った列をそこから出せるかは書かれていない [推測: 出せる]。BE は NBT に書き出して読むので、保存キーに無い値 (ピストンの今の進み・「最後に動いた tick」) は取れない見込み。焼き切れの記録は R18 に記述が無い (分からない) |
| R3: sim の途中 → 実機 | sim の状態を注入の台本で実機に入れ、続きを撮る (R18 §4.4・O7) | オラクルができてから。保存しない値は注入できない [推測] |
| R4: 実機で保存 → 開き直す → 続き | 意味 2 の正解。[要実機] の決着 (V13 P12・V02 P13・V01 P5) にもなる | 「実機で開き直したら」の変換を作る時だけ要る |

### 6.4 Rust で回す時の注意

- 19 の M2-7 の受け入れ基準を RT0〜RT8 にした (この文書と同じ PR で 19 §10.3 に書いた)。
- M2-7 の時点で Rust のエンジンが通す fixture は、M1〜M2 の素子の分だけである。RT1〜RT5 の範囲は狭い所から始まり、素子の issue (M3〜M6) が fixture を通すたびに広がる。CI は「Rust で通る fixture の一覧」から止め所を選び、手で間引かない。
- 往復のテストは native と wasm の両方で回す (19 §10.3 の M1-4 の実行器)。
- TS と Rust の続きを突き合わせることはしない (規則の版が違う)。

---

## 7. 段階

### 7.1 最初の実装 (Rust の M2-7)

TS のエンジンには足さない (決定 11)。最初の実装は 19 §10.3 の M2-7 (snapshot・restore・clone) で、M2-3 (ブロックイベント・ticker・入力の位相) の後に来る。詳しくは §11。

- 入れる物: `rse_snapshot`・`rse_restore` と `clone`。中身は 19 §3.9 の全部 (この文書の §1.5 で足した行を含む)。境目で決まった値の検査。往復の性質 RT0〜RT8。見本。
- 入れない物: 入れ物の TS 側 (M3-9)・画面 (M3-10〜)・IndexedDB・再生器・埋め込み v2・Worker (M3-8)・差分の描画 (M3-7)・portable・proof・カーソル。

検討の経緯: 設計の段階では、最初の PR を「TS の sim の口と往復のテストと、エディタの 💾 / ↩ の修正」とする案だった。ユーザは「Rust の M2-7 を待つ」を選んだ。TS のエンジンの新しい挙動を P1 で止める 19 §8.1 の方針とも合う。

### 7.2 後の issue (19 §10.3 に足した行)

| id | 題 | 中身 | 依存 |
|---|---|---|---|
| M2-7 | snapshot・restore・clone (既存の行を書き換えた) | §7.1。受け入れ基準は RT0〜RT8 | M2-3 |
| M3-7 | viewer の差分描画 (既存) | 変化の列は tick・入力・読み込みで同じ列に載る (§5.4)。RT10 | M1-4 |
| M3-8 | Worker の早送り (既存) | 受け渡しは状態そのもの (§5.5)。RT11 | M2-7 |
| M3-9 | 状態の入れ物と検証 (新) | `rdsim-state`・`encodeState`・`parseSimState`・digest・版の扱い (§2.6)・見本 (RT6)・壊れた入力 (RT7) | M2-7・M1-4 |
| M3-10 | エディタの状態のファイル (新) | 「状態を書き出す」「状態を読み込む」(取り込みの preview・原点寄せを通さない)。design と view。Reset を 2 つに分ける。ドラッグ。circuitStorage の決まりの書き換え。e2e | M3-9・M3-6 |
| M3-11 | 再生器 SimPlayer (新) | 4 画面を FixtureViewer → Demo → Embed → Editor の順に 1 画面ずつ載せ替える。mark・restore・back・seek (RT9)。frameLoop を demand に | M3-9 |
| M3-12 | 状態の保存先 (新) | `StateStore`。IndexedDB (一覧・自動保存の枠・受け渡し)。起動時の「止めた所から続ける」。読む用の Web の「エディタで開く」と札の tick。proof | M3-10 |
| M3-13 | 埋め込みの窓口 v2 (新) | protocol v2・caps・save / load・返事と error・step の上限と進み具合。redtact の issue を起こす。14 に追記 | M3-11 |
| V-6 | 区間 fixture とハーネスの直し (新) | 予約の並べ替えをやめる・種類を残す・tick k の状態を出す・hello にコンテナの中身と書見台を足す。R1 (§6.3) | V-1・E7 |
| E7 | 持ち運べる形と実機への持ち出し (新) | portable の書き出しと読み込み (`fromPortable`)。`fidelity` と `missing`。構造 NBT に OutputSignal・TransferCooldown・DataVersion と「落ちる物の一覧」。RT12 | M3-9 |
| E8 | 相と 1 件で進める (新) | カーソル方式 (§1.4)。tick を割る。RT13 | M2-7 |

- M3-10 と M3-11 は入れ替えられる。M3-13 は M3-11 の後。V-6 はオラクル (R18) の進みに左右される。
- LivePage と「実機で開き直したら」の変換 (§6.3 の意味 2) は、E4 (読み込み直しの順) の後に考える。19 には行を足していない。

### 7.3 TS と Rust の分担

| 物 | TS | Rust |
|---|---|---|
| 入れ物・検証の枠・再生器・保存先・埋め込みの窓口・画面 | TS で作る。エンジンに依らない (M3-9〜M3-13) | 使うだけ。JS 側で組むので、wasm に文字列の処理を入れない (19 §2.3) |
| core | 作らない (決定 11)。§2.2 の TsCore は参考 | 19 §2.5 の不透明なバイト列 (`rse_snapshot`・`rse_restore`)。入れ物の `core.bytes` に入る。M2-7 |
| Engine の口 | SimWorld は `saveState` を持たない。再生器は能力を見て出し分ける | RustWorld が `saveState`・`currentTick`・`atBoundary`・`takeChanges` を満たす。読み込みは `loadState` (§5.2) |
| 往復の性質 | — (台本で確かめた結果は §6.1) | RT0〜RT13 |
| 版 | — | 状態表のハッシュ + `build` |
| エンジンをまたぐ道 | — | 19 §4.2 の Settled の読み込みで portable を読む (E7) |

19 に足した物 (この文書と同じ PR):
- §3.9: §1.5 の表の行と、「境目では決まった値になるので入れない物」の表。TS のチェックポイントは直さないこと。
- §10.3: M2-7 の受け入れ基準を RT0〜RT8 に。M3-7・M3-8 に注記。M3-9〜M3-13・V-6・E7・E8 の行。§10.1 の流れの表。

まだ足していない物 (19 §11 の決定と一緒に入れる):
- §2.5・§2.6: 「snapshot」の名前を状態と写しで分ける。Engine に 4 つの口と、読み込みの口 `loadState` を足す (§5.2)。
- §4.1: 凍結の書き方を V01 §4.8 に合わせる (時計も止まる。BE の pending の合流は動く)。
- §4.2: 読み込みの型に portable の `fidelity` を足す。「−n から振る」は `vanilla-save` の時だけ。
- §6.2・§11 の 3: wasm の上限を合否から報告へ。ユーザの決定 (サイズより正確さと実装量) を wasm にも当てる読みなので、§9 の 12 で確かめてから入れる。

19 §11 の 6 (TS の作業を止める時期) との関係: 決定 11 は「この機能は TS に足さない」という決定で、§11 の 6 そのものの答えではない。

---

## 8. 危険と、分からないこと

### 8.1 危険

| 危険 | 備え |
|---|---|
| 読み込みがどこかで読み込みの型 (19 §4.2)・seed・settle・取り込みの preview を通り、黙ってずれる | 入口を `rse_restore` (`loadState`) 1 つにする。RT1 が毎 PR で見張る |
| 保存先や道具が blocks を並べ直す (DB の鍵の順・座標順の整列) | 入れ物を 1 つの塊で置く。digest で見つかる。RT5 |
| core がエンジンの持ち方に縛られる。Rust の状態表が変わると古いファイルの core が読めない (19 §2.5) | `tableHash` で見分け、黙って読まない。portable があれば「正確でない読み込み」、design があれば最初から。見本 (RT6) が落ちるので気づく |
| sim の版が変わると、同じ状態でも続きが変わりうる。どの変更が挙動を変えたかは機械的に分からない | `build` が違えば印。後の段で proof。直すことはできない |
| Rust のエンジンに替わるまで、エディタの 💾 Init / ↩ Reset のずれ (予約 tick・ブロックイベント・時計が戻らない) が残る | 決定 11 の代価として受け入れる。TS のエンジンには足さない。Rust のエンジンで M3-10 を作る時に、正確に戻るようにする |
| 意味 1 と意味 2 の取り違え。実機から撮った状態を「正確」と思い込む | 「同じ続き」を名乗れるのは core だけ。portable は `fidelity` と `missing` を必ず持ち、画面に出す |
| 外から来る状態は信用できない。大きい JSON の parse が iframe を止める | parse の前にバイト数を見る。件数の上限。RT7。大きい物は Worker で (M3-8 の後) |
| 埋め込みの状態を '*' へ送ってしまう | `rdsim:state` は固定の origin へだけ。テストで確かめる |
| 自動保存から黙って sim に入り、編集中の回路を見失う | 自動では入らない。帯を出して選ばせる |
| `clone()` と写しが BlockState を共有する。back の輪が多数の clone を持つ | 開発時は freeze。輪は個数でなくメモリの見積もりで切る (大きい回路では測っていない) |
| 再生器への載せ替えが大きい。e2e と道具 (`__demo`・`__embed`・`__editorTest`) が画面の中身に触っている | 1 画面ずつ。窓の口の名前は変えない。e2e を先に足す |
| 全部の境目の往復は tick の数の 2 乗に近い手間になる | 見直しの台本では、1 つの戻し方で約 50〜90 秒だった [確かめ]。RT1〜RT4 と歯 (RT5) を全部の境目で回すと数分になる見込み [推測]。M2-7 で測り、重ければ、間引かずに別の CI の job に分ける。歯 (RT5) は名指しした fixture だけで回してよい |
| カーソル方式は `tick()` の作り直しが要る。割り方を誤ると全体がずれる | 最後の段。RT13。それまで形式は `boundary` だけ受ける |
| 状態の見本を fixtures のフォルダに置いて CI が落ちる | 置き場を `packages/sim/test/states/` に分ける |

### 8.2 分からないこと

- fixture が通らない経路で、書く欄だけで足りるか。TS のエンジンでは全部の境目 8,872 か所でずれ 0 だった [確かめ] が、それは 150 本が通る経路の話である。fixture に無い素子の組み合わせ・seed で重複した予約・連鎖の上限に達した tick は通っていない。読みでは、一時の欄が空なら足りる (状態は SimWorld の欄にしか無い: §1.2)。Rust でも見張りは 2 つ置く。1 つは書き出しの時の「境目で決まった値の欄はその値か」の検査、もう 1 つは欄の棚卸し (RT0) である。
- 見直しの台本は TS のエンジンの private の欄を直接読み書きした。作る物 (Rust の `rse_snapshot`・`rse_restore`) を通した結果ではない。M2-7 のテストで決着する。
- 検査・深い写し・digest の費用。大きい回路 (数万ブロック) での back の輪のメモリと seek の時間。
- 再生器と検証で JS がどれだけ増えるか。
- IndexedDB が redtact の iframe の中で、rdsim.com 直の時と同じ置き場になるか (ブラウザの分け方による)。
- 読む用の Web を本番でどの origin に出すか (今は出していない)。エディタと別の origin に出すなら、受け渡しの枠 (IndexedDB) は使えず、別の渡し方が要る。
- 裏のタブで timer が間引かれた時の連続実行のふるまい (ブラウザで測っていない)。
- 差分の描画がどこまで速くなるか。deepslate が部分更新をどこまで受けるか。
- proof と portable の `missing` は、台本で試していない案である。
- sim が portable (blockstate の文字列) へ落とす時、エディタで組んだ world でどの値が落ちるか。文字列への変換が 2 本ある (mcstate.ts と nbtIO.ts: 19 §2.6)。
- 実機の側: gameTime と凍結の状態が保存に残るか。読み込んだ予約の展開が最初の tick のどの位相で起きるか。動いている途中のピストンを構造 NBT で運べるか。litematic が予約 tick を持つか。どれも挙動メモに無い。
- [要実機] のまま: 保存をまたぐ着地の遅れ (V13 P12)・別チャンクの読み込み予約の同点 (V02 P13)・読み直した後の BE の順 (V01 P5・V18 P4)。R18 §3.4 と V02 §4.7 の食い違い (保存の並びが予約順を表すか) も R4 まで決着しない。
- オラクルで、境目に残ったブロックイベントの列・ピストンの今の進み・焼き切れの記録を撮れるか。R18 §4.3 にあるのはブロックイベントの追加と取り出しの順までである。
- 凍結中に溜まったブロックイベントが積んだ順で、step 1 回で全部処理されるか ([要実機]: V03 §4.2・§8 の P6)。S0' を実機の凍結と同じと言う根拠の 1 つなので、残す。
- sim の一時停止と実機の凍結の細かい差 (BE の pending の合流) が、どの回路で見えるか。
- redtact の側で新しいファイルの種類を足す手間。

---

## 9. ユーザに決めてもらうこと

1・3・4・11 は 2026-11-26 に決まった (右の列)。ほかは、その段の issue の前に決める。
決定 11 で、TS のエディタの 💾 / ↩ は直さないことになった。6 (Reset の意味) は M3-10 の前に決める。形式には `cursor` の席を入れるが、2 がどちらに決まっても形式は変わらない。

| # | 決めること | 選択肢 | 推奨 | 理由 | 結果 |
|---|---|---|---|---|---|
| 1 | 保存の意味 | (a) 実機の freeze → step と同じ = 止めずに回した時と同じ続き (b) 実機でワールドを閉じて開いた時と同じ | **(a)** | (b) は実機の側が状態を落とすので、「止めた時の状態」にならない。(b) は portable の `vanilla-save` として後で足せる | **決まった: (a)** |
| 2 | 止める場所 | (a) tick の境目だけ (b) 境目を先に作り、相と 1 件ごとは最後の段でカーソル方式 (c) 相の途中は作らず trace だけ | **(b)** | 実装量を優先する決定に合う。形式には席だけ空けるので、(c) に変えても損は無い。相の途中は実機に無い止め方で、正解は撮れない | まだ |
| 3 | core の形 | (a) エンジンごとの完全な形 + 共通の入れ物。持ち運べる形は任意の節 (b) fixture の欄を広げた中立の形 1 つを正にする | **(a)** | 全部の境目で正確に戻ると確かめたのは (a) だけ [確かめ: 8,872 か所でずれ 0]。(b) は今の欄で 270 / 1,556 か所が表せず [調査]、文字列への変換で落ちる値が残る | **決まった: (a)** |
| 4 | 版が違うファイル | sim の版だけ違う: (a) 読んで印を出す (b) 断る。エンジンか規則の版が違う: (c) 続きとしては断り「正確でない読み込み」を選ばせる (d) 黙って近い形で読む | **(a) と (c)** | sim を直すたびに古い状態が読めなくなるのは不便。黙って読むのは正確さの決定に合わない | **決まった: (a) と (c)** |
| 5 | 設計図を状態に入れるか・「編集に戻る」先 | (a) 入れる。戻る先は設計図。無い時だけ「止めた盤面を取り込む」を選ばせる (b) 入れない。いつも止めた盤面を出す | **(a)** | 止めた盤面には編集で置けない物がある。大きさは増える | まだ |
| 6 | `↩ Reset` の意味 | (a) 「覚えた所・読み込んだ状態へ」と「設計図の初めへ」の 2 つに分ける (b) 今のまま 1 つ | **(a)** | 状態を読み込んだ時、どちらへ戻るかが 1 つでは決まらない | まだ |
| 7 | ブラウザ内の置き場と自動保存 | (a) IndexedDB を新しく入れ、止めた時と離れる時に 1 件持ち、起動時に「続ける」を出す (b) IndexedDB は入れるが明示の保存だけ (c) ファイルだけ | **(a)** | localStorage は大きい回路が入らず、回路の自動保存を巻き込む。黙って sim には入らない | まだ |
| 8 | サーバの DB | (a) rdsim は親へ渡すまで。redtact の新しいファイルの種類は redtact の issue で決める (b) redtact の側の設計まで今回入れる (c) 今回はやらない | **(a)** | rdsim は静的配信のまま。今は埋め込みを使っている所が無い | まだ |
| 9 | 埋め込みの窓口 | (a) v2 を足す (必ず返事・id・caps)。v1 はそのまま (b) v1 のまま type を足し caps だけで知らせる | **(a)** | 「黙って捨てる」を「必ず返す」に変えるのは約束の変更。親は caps を見れば足りるので、(b) でも進められる | まだ |
| 10 | 画面の載せ替え・戻る・シーク | (a) 再生器を作り 4 画面を 1 つずつ寄せる。1 tick 戻る・シークも入れる (b) Engine に口を足すだけで、ループは各画面に残す | **(a)** | どの画面でも同じ止め方・書き出し・読み込みになる。書き換えは大きい | まだ |
| 11 | TS で先に作るか | (a) TS で今作る (b) Rust の M2-7 を待つ | **(a)** | 入れ物・再生器・窓口はエンジンに依らない。待つと今のチェックポイントの誤りが残る。19 §11 の 6 に関わる | **決まった: (b)**。TS には作らない |
| 12 | 大きさの目標 (PR #435・#436・19 §6.2 の wasm の上限) | (a) 合否から外して報告にする (b) 上限を上げて合否に残す | **(a)** | 「サイズより正確さと実装量」の決定に合う。数字は毎回出す。PR #436 の JS の増え方については決定済み。読む用の Web の配信の目標と wasm の上限まで同じ扱いにしてよいかを、ここで確かめたい | まだ |
| 13 | 実機とのつながりの範囲 | (a) E7・V-6 までやる (portable・構造 NBT に 3 つの鍵・ハーネスの並べ替えをやめる・区間 fixture) (b) 構造 NBT の鍵だけ (c) やらない | **(a)** | 実機と同じ挙動を目指す目標に合う。ただし 26.3 のオラクルが無い間は R1 までしか測れない | まだ |
| 14 | 19 への反映 | §7.3 の追記を 19 に入れるか | 入れる | §11 の決定と一緒に | 一部を入れた (§7.3) |

---

## 10. 比べた案と採点の要約

### 10.1 3 つの案

| 案 | 重点 | 強み | 弱み |
|---|---|---|---|
| A 正確さ優先 | 1 つも失わない形式と、往復の性質 RT1〜RT11 | 保証がいちばん厚い。「空を検査する」「欠けたら断る」「テストに歯があることを確かめる」「digest」「深い写し」。相の途中をカーソルで表す案 | 画面の連携は薄い。最初の PR に見える変化が無い。エンジンをまたぐ形と実機とのつながりはほぼ未設計 |
| B 実機とのつながり優先 | Minecraft の語彙の中立な形 1 つ。`fidelity` と `missing` | 意味 1 と意味 2 を分ける枠。区間 fixture。実機へ戻す 3 つの道。ハーネスの直し所。fixture の欄との一体化 | 中立な欄だけでずれ 0 になるかは未確認。`exactTs` と二重になる。最初の PR が大きい。相対の時刻への変換が誤りの元になる。Web は命令の一覧まで |
| C Web の連携優先 | 再生器・保存先・埋め込み v2・読む用の Web との共通化 | 機能の広さと窓口の質がいちばん高い。core は A と同じ 6 欄。proof。Worker の窓口 = 状態 | 性質の一覧は A より薄い。再生器への載せ替えが大きい。portable と proof は未検証 |

### 10.2 点数 (各 0〜10)

| 案 | correctness | coverage | fit | web | feasibility | 合計 |
|---|---:|---:|---:|---:|---:|---:|
| A | 9 | 7 | 8 | 7 | 8 | 39 |
| B | 6 | 8 | 6 | 6 | 5 | 31 |
| C | 8 | 9 | 8 | 9 | 7 | **41** |

- **土台は C**。合計が最も高い。core の形は A と同じなので、正確さの中身は A の決まりをそのまま載せられる。
- A の correctness が最も高い。差は「保証の書き方」にあるので、丸ごと取り込んだ。
- B は correctness を 6 とした。正に置く中立な形が全部の境目で戻るかを誰も確かめていないため。枠 (`fidelity`・区間 fixture) は portable と §6.3 に取り込んだ。

### 10.3 取り込んだ物

| 出どころ | 取り込んだ物 |
|---|---|
| A | 往復の性質の一覧 (RT1〜RT8・RT13) と「テストに歯があること」・digest・一時の欄は書かずに空を検査・深い写し・欠けたら断る・書いた直後の読み直し・`cursor` の席とカーソル方式・`getScheduledTicks` などは写しを返す・1 画面ずつ載せ替える順 |
| B | 意味 1 と意味 2 の区別・portable の `fidelity` と `missing`・Minecraft の語彙と相対の時刻 (portable に限る)・区間 fixture と R1〜R4・ハーネスの直し所・構造 NBT に足す 3 つの鍵と「落ちる物の一覧」・`Fixture.start` と古い欄の写し・裏のタブでは追い付かない・`rdsim:exportStructure` |
| C (土台) | 入れ物の節の分け方・再生器と 3 つの層・`StateStore`・受け渡しの枠・埋め込み v2・Worker の窓口 = 状態・proof・DB の行の形 |

### 10.4 3 案で食い違った所の決着

| 点 | 決着 | 根拠 |
|---|---|---|
| 時刻は絶対か相対か | core は絶対。portable は相対 | §2.2。直す欄が 4 種ある |
| 正の形は core か中立な形か | core | 確かめてあるのは core だけ [調査] |
| 「全部の境目 1,556 か所」 | 全部ではない。選んだ止め所で、seq を外して比べている。見直しで全部の境目 8,872 か所を seq つきで回し、ずれ 0 を確かめた | 調査の台本を読んだ。tick の合計は 4,286。見直しの台本 [確かめ] |
| 予約の重複が sim で起きるか (案 C の「分からない」) | `schedule()` では起きない。`seedScheduledTick` では起きうる | world.ts:445・1111-1122 [コード] |
| 予約の seq と moving_piston の seq の前後が効くか (案 B の「推測」) | 別々に並べ替えるので効かない (読み) | world.ts:550・619-621 [コード]。動かしてはいない |
| `setBlock` に近隣更新の副作用があるか (案 A の書き方) | 無い。Map に入れるだけ | world.ts:421-428 [コード] |
| v1 の reset の意味 | 設計図から組み直して tick 0 へ | EmbedPage.tsx:173-185 [コード] |
| 埋め込みは v2 か v1 + caps か | v2 を足す。ただしユーザの決定に回す (§9 の 9) | protocol.ts:85-118 [コード] |
| 裏のタブで追い付くか | 追い付かない | 単純さ。実測は無い |
| 相の途中で止めるか | 最後の段でカーソル方式。ユーザの決定に回す (§9 の 2) | — |
| 最初の実装 | 設計の段階では「TS の sim の口 + エディタのチェックポイントの修正」とした。ユーザの決定 (§9 の 11) で Rust の M2-7 にした | §7.1 |

---

## 11. M2-7 の実装方針の下書き (Rust)

M2-7 の issue を作る時に、draft PR の方針コメントの元にする。M2-3 までの作りに合わせて直してよい。

### 目的

Rust のエンジンに、止めた世界を正確に書き出して読み込める口を作る。往復の性質で固め、以後の素子の issue が性質を壊さないようにする。

### 作る物

| 物 | 中身 |
|---|---|
| `rse_snapshot`・`rse_restore` (19 §2.5) | 19 §3.9 の全部をバイト列に出す・戻す。先頭に状態表のハッシュ。境目でなければ状態コードで断る。境目で決まった値の欄 (§1.5) がその値かを検査する |
| `clone` | 同じ世界の写し。チェックポイントと並走の差分に使う |
| 読み込みの入口 | 19 §4.2 の読み込みの型・seed・settle を通さない。置く順は書き出した順のまま (挿入順・予約順・ブロックイベントの列) |
| digest | 内部の全状態の要約値 (§2.4)。往復のテストと壊れの検出に使う |
| 欄の棚卸し (RT0) | 世界の struct を `..` なしで分解するテスト。欄を「書く・境目で決まった値・外」に分け、欄が増えるとコンパイルで落ちる |
| 見本 | 数本の状態のバイト列と、続きの digest。fixtures のフォルダには置かない |

### 確かめ方

| 項目 | 目標 |
|---|---|
| RT0 欄の棚卸し | 分解のテストがコンパイルを通り、3 つの分け方の表と合う |
| RT1 往復 | その時点で Rust のエンジンが通る fixture の全部の境目 (tick の直後と入力の直後) で、毎 tick の digest が止めない系列と一致。盤面の文字列は続きの最後の tick と選んだ境目で比べる。**ずれ 0**。native と wasm の両方 |
| RT2 書き出しの安定 | save → load → save でバイト列が一致 |
| RT3 移し | ArrayBuffer を移して (postMessage・Worker の道) も RT1 と同じ |
| RT4 clone と境目の値 | `clone` と `load(save())` の digest が同じ。境目で決まった値の欄は全部の境目でその値 |
| RT5 歯 | 5 種の壊し方 (BE の順・予約順のカウンター・ブロックイベント・予約の種類・時計) のそれぞれで 1 本以上が落ちる。TS の台本で落ちた fixture (§6.1) を最初の候補にし、並びの単体テストも足す |
| RT6 見本 | 見本が読め、続きの digest が記録と同じ |
| RT7 壊れた入力 | 壊れたバイト列で固まらず、状態コードで断る |
| RT8 境目でない所 | 観測の窓の中の save は断る |
| 報告する数字 (合否にしない) | 往復のテストの時間 (TS の台本では 1 つの戻し方で約 50〜90 秒)・snapshot と restore と digest の時間 (小さい回路と大きい合成)・wasm の増えた量 |

### 入れない物

入れ物の TS 側と検証 (M3-9)・画面 (M3-10〜)・IndexedDB・再生器・埋め込み v2・Worker (M3-8)・差分の描画 (M3-7)・portable・proof・カーソル。TS のエンジンとエディタの 💾 / ↩ は変えない (決定 11)。

### 先に決まっていること

§9 の 1 (保存の意味)・3 (core の形)・4 (版が違う時)・11 (TS に作らない)。
