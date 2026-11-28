# 07. リピーター・コンパレーター (ダイオード)

Java 版 26.3 のデコンパイルを読んで書いた、実装用のメモ。写経ではなく、条件・順序・数値を自分の言葉でまとめる (docs/ip-policy.md)。

確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] tools/mc-harness/fixtures/ の fixture が裏づける
- [要実機] 読んだだけでは決めきれない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

---

## 1. 対象と範囲

### 1.1 読んだクラス

| クラス | 役割 |
|---|---|
| 26.3 の DiodeBlock | リピーターとコンパレーターの共通の親。入力の計算・予約・tick・前方更新・信号の出し方 |
| 26.3 の RepeaterBlock | 遅延・ロック・ダストとの接続 |
| 26.3 の ComparatorBlock | 比較と減算・アナログ値の読み取り・BlockEntity の更新 |
| 26.3 の ComparatorBlockEntity | 出力値 (OutputSignal) の保持 |
| 26.3 の ComparatorMode | compare / subtract の 2 値 |
| 26.3 の SignalGetter | getSignal・getDirectSignal・getDirectSignalTo・getControlInputSignal (入力の読み方の実体) |
| 26.3 の Level / ServerLevel | setBlock・updateNeighbourForOutputSignal・tickBlock (呼ばれ方を確かめる範囲) |
| 26.3 の LevelChunk | setBlockState の中で onPlace と affectNeighborsAfterRemoval が呼ばれる条件 |
| 26.3 の CollectingNeighborUpdater / NeighborUpdater | 前方更新が走る順 (確かめる範囲) |
| 26.3 の LevelTicks / LevelChunkTicks / ScheduledTick | willTickThisTick と重複排除 (確かめる範囲) |
| 26.3 の ItemFrame | getAnalogOutput と、コンパレーターへの通知 |
| 26.3 の PistonBaseBlock | ピストンがダイオードを壊したときの撤去処理の時点 (確かめる範囲) |

DiodeBlock を継ぐのは RepeaterBlock と ComparatorBlock の 2 つだけである (hooks-26.3.tsv で確認)。
DiodeBlock#isDiode は「ブロックが DiodeBlock の派生か」だけを見る。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick のフェーズ順・予約 tick が走る位置 | → 01_tick-loop.md |
| 予約 tick の並び・重複排除・件数上限の全体 | → 02_scheduled-ticks.md |
| ブロックイベント (ダイオードは使わない) | → 03_block-events.md |
| setBlock のフラグ・近隣更新の積み方・形状更新・コンパレーター更新の配り方 | → 04_set-block-and-updates.md |
| 導体・強/弱の信号モデル・SupportType | → 05_signals-and-block-properties.md |
| ダストの POWER の決まり方・接続形状 | → 06_redstone-wire.md |
| オブザーバー (コンパレーターとの競争の相手) | → 08_torch-observer-redstone-block.md |
| 各ブロックのアナログ値 (getAnalogOutputSignal の中身) | → 14_containers-hoppers-analog.md |
| ピストンがダイオードを壊す手順 | → 13_pistons.md |
| 額縁 (エンティティ) の扱い | → 17_entities-interplay.md |

---

## 2. 全体像

### 2.1 向きの約束 (最初に読む)

**blockstate の FACING は「入力側 (後ろ) の向き」を指す**。出力は FACING の逆側に出る。
設置時は、プレイヤーの水平の向きの逆が FACING になる [26.3 読解: DiodeBlock#getStateForPlacement]。

このメモでは、ダイオードの位置を P として次の名前を使う。

| 名前 | 位置 | 意味 |
|---|---|---|
| B (後ろ) | P から FACING へ 1 マス | 入力を読む相手 |
| B2 (奥) | P から FACING へ 2 マス | コンパレーターが導体越しに読む相手 |
| F (前) | P から FACING の逆へ 1 マス | 出力を受ける相手 |
| S1・S2 (側面) | P から FACING を時計回りに 90° 回した向きへ 1 マス、反時計回りへ 1 マス | 側面入力・ロック |

時計回りは 北 → 東 → 南 → 西 の順である。

> 今の TS 実装 (packages/sim/src) の facing は「出力の向き」で、vanilla の FACING と逆である (§9.3)。

### 2.2 ダイオードの動きの骨格

リピーターもコンパレーターも、同じ 3 段で動く。

1. **近隣更新を受ける** (DiodeBlock#neighborChanged)。足場が無ければ壊れる。あれば checkTickOnNeighbor で「今の状態と入力が食い違うか」を見て、食い違えば予約 tick を積む。
2. **予約 tick が走る** (tick)。その時点の入力で状態を決め直し、blockstate を flag 2 で書く。
3. **書き込みが前方更新を出す**。flag 2 は自分の周りへ近隣更新を出さない。代わりに LevelChunk#setBlockState が新しい状態の onPlace を呼び、DiodeBlock#onPlace が updateNeighborsInFront を呼ぶ。

状態が変わっても、自分の 6 近傍へ近隣更新は出ない。出るのは F と、F の 5 近傍 (自分を除く) だけである。

### 2.3 リピーターとコンパレーターの違い (早見表)

| 項目 | リピーター | コンパレーター |
|---|---|---|
| 遅延 | DELAY × 2 gt (2・4・6・8) | 2 gt 固定 |
| 出力の強さ | 15 固定 | BlockEntity の OutputSignal |
| 入力 | B の通常の信号 (+ B がダストなら POWER) | 同左。ただし B (または導体越しの B2) のアナログ値で置き換える |
| 側面 | ロックだけ。ダイオードの強い信号だけを数える | 比較・減算の相手。ダスト・レッドストーンブロック・信号源の強い信号を数える |
| ロック | あり (isLocked を実行時に読む) | なし |
| 近隣更新からの予約の優先度 | -3 / -2 / -1 | -1 / 0 |
| 予約の条件 | POWERED と入力の有無が食い違う | 出力値が保持値と違う、または POWERED と点灯条件が食い違う |
| tick の中での再予約 | あり (OFF から ON にした時点で入力が無ければ、遅延後・優先度 -2) | なし |
| tick でやること | ON/OFF の切り替え | 出力値を決め直して保持し、必要なら POWERED を切り替える |
| 右クリック | DELAY を 1 → 2 → 3 → 4 → 1 と回す (flag 3) | MODE を切り替え (flag 2)、その場で出力を決め直す |
| BlockEntity | なし | あり (OutputSignal) |
| ダストの接続 | FACING の軸の 2 面だけ | 4 面とも (信号源の既定) |

### 2.4 1 回の反転で起きることの順 (予約 tick から)

リピーターが OFF → ON になる tick を例にする (呼び出しは予約 tick 相の最上位なので、近隣更新のスタックは空)。

1. ServerLevel#tickBlock が、その位置のブロックが予約した種類と同じか確かめ、同じなら tick を呼ぶ。
2. DiodeBlock#tick が isLocked を読む。ロック中なら終わり。
3. shouldTurnOn (入力の有無) を読む。
4. POWERED を true にして flag 2 で書く。この書き込みの中で次が順に起きる。
   1. LevelChunk#setBlockState が状態を差し替える (ブロックの種類は同じなので撤去処理は呼ばれない)。
   2. 新しい状態の onPlace → updateNeighborsInFront。
      - F へ近隣更新を 1 件。**その連鎖が全部終わるまで走り切る**。
      - 次に F の近傍へ「西・東・下・上・北・南」の順で、P の向き (FACING) を飛ばして 5 件。これも連鎖ごと走り切る。
   3. Level#setBlock に戻る。flag 1 が無いので自分の周りへの近隣更新とコンパレーター更新は出ない。
   4. flag 16 が無いので形状更新を出す。P の 6 近傍へ「西・東・北・南・下・上」の順 (→ 04_set-block-and-updates.md)。隣のリピーターの LOCKED はここで変わる。
5. 手順 3 で入力が無かった場合だけ、遅延後・優先度 -2 の予約を積む (最短パルスの保証)。

手順 5 は手順 4 の連鎖の**後**に来る。連鎖の中でこのリピーター自身が近隣更新を受けて先に予約を積んでいることがある (§5.3)。

---

## 3. 状態とデータ

### 3.1 blockstate

| ブロック | プロパティ | 値域 | 既定 | 備考 |
|---|---|---|---|---|
| repeater | facing | north・south・west・east | north | 入力側の向き (§2.1) |
| repeater | delay | 1〜4 | 1 | 遅延は delay × 2 gt |
| repeater | locked | true・false | false | **表示と形状更新のための値**。tick と予約の判定には使わない (§5.1) |
| repeater | powered | true・false | false | 出力中か |
| comparator | facing | north・south・west・east | north | 入力側の向き |
| comparator | mode | compare・subtract | compare | この順で並ぶ。cycle は compare → subtract → compare |
| comparator | powered | true・false | false | 点灯。出力値そのものは持たない |

プロパティの登録順は、repeater が facing・delay・locked・powered、comparator が facing・mode・powered である [26.3 読解: RepeaterBlock#createBlockStateDefinition, ComparatorBlock#createBlockStateDefinition]。状態 ID の採番に効く (→ 05_signals-and-block-properties.md)。

### 3.2 BlockEntity (コンパレーターだけ)

| 項目 | 値 |
|---|---|
| 種類 | ComparatorBlockEntity |
| 持つ値 | 整数 1 個 (出力値)。既定 0 |
| 保存キー | OutputSignal (整数)。読み込みで欠けていれば 0 |
| 値の範囲の検査 | **しない**。保存された値をそのまま返す |
| ticker | なし (BlockEntity 相では何もしない) |
| 作られる時点 | ブロックが置かれたとき (LevelChunk#setBlockState の末尾)。onPlace より後 |
| 消える時点 | ブロックの種類が変わったとき。同じ種類の状態変更 (POWERED・MODE・FACING) では残り、中の値も保たれる |

[26.3 読解: ComparatorBlockEntity#saveAdditional, #loadAdditional, #getOutputSignal, #setOutputSignal; LevelChunk#setBlockState]

BlockEntity が無い位置では、出力値は 0 として読まれる [26.3 読解: ComparatorBlock#getOutputSignal, #checkTickOnNeighbor, #refreshOutputState]。

### 3.3 定数

| 名前 | 値 | 典拠 |
|---|---|---|
| リピーターの遅延 | delay × 2 gt | RepeaterBlock#getDelay |
| コンパレーターの遅延 | 2 gt | ComparatorBlock#getDelay。checkTickOnNeighbor も 2 を直に使う |
| リピーターの出力 | 15 | DiodeBlock#getOutputSignal |
| TickPriority | EXTREMELY_HIGH = -3、VERY_HIGH = -2、HIGH = -1、NORMAL = 0 | TickPriority |
| 設置時の予約 | 遅延 1 gt・優先度 0 | DiodeBlock#setPlacedBy |
| 押し反応 | POPPED (ピストンで壊れる。動かせない) | Blocks の REPEATER・COMPARATOR の登録 |
| 当たり判定の形 | 16 × 2 × 16 の板 | DiodeBlock#getShape (挙動には効かない) |
| 足場の条件 | 真下のブロックの上面が SupportType.RIGID で sturdy | DiodeBlock#canSurviveOn |
| 額縁のアナログ値 | 中身が無ければ 0。あれば (回転 mod 8) + 1 = 1〜8 | ItemFrame#getAnalogOutput |

---

## 4. 処理の詳細

### 4.1 信号の出し方: getSignal・getDirectSignal・isSignalSource

[26.3 読解: DiodeBlock#getSignal, #getDirectSignal, #ownSignal, #isSignalSource]

- isSignalSource は常に true (POWERED に関係なく)。
- ownSignal は、POWERED が true なら出力値 (リピーター 15・コンパレーターは BlockEntity の値)、false なら 0。
- getSignal は、問われた向きが FACING と同じときだけ ownSignal を返す。他の向きは 0。
- getDirectSignal は getSignal と同じ値を返す。つまり**出力は強い信号**で、F が導体なら F を強く充電する。

「問われた向きが FACING」とは、問う側が F にいるということである (SignalGetter は「相手の位置」と「自分から相手への向き」を渡す。F から見た P の向きは FACING)。

| 問う側の位置 | 返る値 |
|---|---|
| F | POWERED なら出力値、そうでなければ 0 |
| B・S1・S2・上・下 | 常に 0 |

コンパレーターは POWERED が true でも、BlockEntity の値が 0 なら 0 を返す。逆に POWERED が false なら BlockEntity の値が正でも 0 を返す。2 つは別々に持たれ、食い違いうる (§5.6)。

ownSignal は 26.2 で入った切り出しで、SignalGetter#getBestOwnOrNeighbourSignal からも読まれる (使い手は硫黄キューブ。→ 17_entities-interplay.md)。こちらは向きを見ないので、POWERED のダイオードは向きに関係なく出力値を返す。

### 4.2 入力の計算 (共通): DiodeBlock#getInputSignal

[26.3 読解: DiodeBlock#getInputSignal, SignalGetter#getSignal, #getDirectSignalTo]

1. B について、SignalGetter#getSignal を「B の位置・向き FACING」で読む。中身は次のとおり。
   1. B のブロック自身の getSignal (向き FACING) を読む。
   2. B が導体 (isRedstoneConductor) なら、B に入る強い信号 (getDirectSignalTo) との大きい方を取る。
      getDirectSignalTo は B の 6 近傍を「下・上・北・南・西・東」の順に getDirectSignal で読み、15 以上になった時点で打ち切る。
2. 値が 15 以上なら、そのまま返す。
3. そうでなければ、**B が redstone_wire なら、その POWER と大きい方**を返す。ダスト以外なら手順 1 の値を返す。

手順 3 が「ダストの power の読み方」の要点である。

- ダスト自身の getSignal は、ダストの形 (その向きへ伸びているか) と、再計算中かどうかのフラグに左右される (→ 06_redstone-wire.md)。
- ダイオードは**それを迂回して POWER を直に読む**。ダストの形や向きを条件にしない。
- ただし、ダストはリピーターの前後とコンパレーターの 4 面へ必ず接続する (§4.16)。だから B のダストは普通ダイオードの方へ伸びていて、getSignal でも同じ値が返る。直読が結果を変えるのは、ダストの getSignal が 0 を返す例外 (再計算中のフラグ、保存された形が古いまま置かれたダストなど。→ 06_redstone-wire.md) だけである。実装では「B がダストなら POWER」と書けば足りる。
- 読むのは B の 1 マスだけ。B の上や下のダスト、B が導体でその上に乗ったダストは、通常の経路 (導体の弱充電) でしか入らない。

B が導体のとき、手順 1-2 で数えるのは**強い信号だけではない**点に注意する。手順 1-1 が B 自身の getSignal を読むが、普通の導体 (石など) は 0 を返す。B が「導体かつ信号源」(レッドストーンブロックは導体でないので当たらない。ターゲット・ジュークボックスなどは → 05_signals-and-block-properties.md) のときだけ 1-1 が効く。ダストが導体を弱く充電する分は、ダストの getDirectSignal が返すので 1-2 に入る (→ 06_redstone-wire.md)。

### 4.3 リピーターの点灯条件とロック

[26.3 読解: DiodeBlock#shouldTurnOn, RepeaterBlock#isLocked, #sideInputDiodesOnly, DiodeBlock#getAlternateSignal, SignalGetter#getControlInputSignal]

- shouldTurnOn は「入力 (§4.2) が 0 より大きい」。強さは捨てる。
- isLocked は「側面の値 (getAlternateSignal) が 0 より大きい」。
- 側面の値は、S1 と S2 のそれぞれを getControlInputSignal で読んだ大きい方。リピーターは「ダイオードだけ」の指定で読む。

「ダイオードだけ」のときの getControlInputSignal は次のとおり。

1. その位置のブロックが DiodeBlock の派生でなければ 0。
2. 派生なら、その位置の getDirectSignal を「P からその位置への向き」で読む。

結果として、ロックが掛かるのは次のときだけである。

| 側面のブロック | 条件 | 値 |
|---|---|---|
| repeater | POWERED で、出力が P を向く (その FACING が「P から側面への向き」と同じ) | 15 |
| comparator | 同じ向きで POWERED、かつ BlockEntity の値が正 | BlockEntity の値 |
| それ以外 (ダスト・レッドストーンブロック・オブザーバー・トーチ・充電された導体など) | — | 0 (ロックしない) |

コンパレーターが POWERED でも保持値が 0 なら、ロックは掛からない (§5.6)。

### 4.4 コンパレーターの入力: ComparatorBlock#getInputSignal

[26.3 読解: ComparatorBlock#getInputSignal, #getItemFrame]

1. §4.2 の共通の入力 n を求める。
2. B が hasAnalogOutputSignal を持つなら、**n を B のアナログ値で置き換える** (n が 15 でも置き換える)。ここで終わり。
3. そうでなく、**n が 15 未満**で、かつ **B が導体**なら、B2 を見る。
   1. B2 の位置の 1 × 1 × 1 の箱の中にある額縁 (ItemFrame とその派生) のうち、額縁の向きが FACING と同じものを集める。**ちょうど 1 個**ならそれを採る。0 個や 2 個以上なら「額縁なし」とする。
   2. 額縁の値 (あれば ItemFrame#getAnalogOutput、無ければ「無し」) と、B2 のブロックの値 (hasAnalogOutputSignal なら getAnalogOutputSignal、そうでなければ「無し」) の**大きい方**を取る。
   3. 両方「無し」なら n のまま。どちらかがあれば、**n をその値で置き換える** (n より小さくても置き換える)。
4. n を返す。

アナログ値の読み出しには、B (または B2) の位置と、「読まれる側から見たコンパレーターの向き」(FACING の逆) が渡される [版差 1.21.1: 向きの引数が無い]。向きを使うブロックがあるかは → 14_containers-hoppers-analog.md。

要点を表にする。

| B | B2 | 共通の入力 n | 結果 |
|---|---|---|---|
| アナログ源 (樽など) | 何でも | 何でも | B のアナログ値 (n は捨てる) |
| 導体 | アナログ源 | 15 未満 | B2 のアナログ値 (0 でも置き換える) |
| 導体 | アナログ源 | 15 | 15 (B2 を読まない) |
| 導体 | アナログ源でない・額縁なし | 何でも | n |
| 導体 | 額縁 1 個 (向きが FACING)・中身なし | 15 未満 | 0 (額縁の値 0 で置き換える) |
| 導体 | 額縁 1 個・中身あり・回転 r | 15 未満 | (r mod 8) + 1 |
| 導体 | 額縁 + アナログ源の両方 | 15 未満 | 2 つの大きい方 |
| 導体でもアナログ源でもない (空気・ガラス・ダストなど) | 何でも | 何でも | n (B2 を読まない) |

- 「置き換え」は fixture で確かめてある [実機 1.21.1: comparator-through-conductor-replace] [実機 1.21.1: barrel-comparator-input]。
- B のアナログ値が通常の 15 にも勝つことは、検知レールで確かめてある [実機 1.21.1: detector-rail-comparator]。
- 額縁の向きは「額縁が向いている側」である。B2 の位置にあって FACING を向く額縁は、B の裏面 (コンパレーターと反対の面) に貼られた額縁に当たる。B2 に別のブロックが無くても読める。
- 空の額縁で 0 に置き換わる点は読解だけである [要実機] (§8 P-6)。
- 「額縁 + アナログ源の両方」は、額縁が B2 のブロックと同じマスに居る形である。額縁は当たり判定のあるブロックと重なると外れるので、フルブロックの容器とは普通は両立しない (当たり判定の無い・小さいアナログ源や、コマンドで作った状態に限る)。Fixed の額縁は外れない。両立できる組み合わせは [要実機] (§8 P-6 の f) [26.3 読解: ItemFrame#survives]。
- 額縁の取り付け先は、固体のブロックのほかに**ダイオード (水平の面)** も認められる [26.3 読解: ItemFrame#survives]。ダイオードの挙動は変わらない (→ 17_entities-interplay.md)。

### 4.5 コンパレーターの側面・出力値・点灯条件

[26.3 読解: DiodeBlock#getAlternateSignal, SignalGetter#getControlInputSignal, ComparatorBlock#calculateOutputSignal, #shouldTurnOn]

#### 側面の値

S1・S2 のそれぞれを、「ダイオードだけ」でない指定の getControlInputSignal で読み、大きい方を取る。判定はこの順である。

1. redstone_block なら 15。
2. redstone_wire なら、その POWER (形に関係なく直読)。
3. isSignalSource が true のブロックなら、その getDirectSignal を「P から側面への向き」で読む。
4. それ以外は 0。**導体の充電は数えない** (側面が強く充電された石でも 0)。

手順 3 で正の値を返しうるブロックを、26.3 で getDirectSignal を実装しているクラスから拾うと次のとおり。

| 側面のブロック | 正になる条件 | 実際に起きるか |
|---|---|---|
| repeater・comparator | POWERED で出力が P を向く | 起きる |
| observer | POWERED で、出力面 (観察面の逆) が P を向く | 起きる |
| lightning_rod | POWERED で、FACING が「P から側面への向き」(先端が P と反対を向く) | 起きる (支えが要らないブロックなので置ける) |
| lever・button (壁付き) | POWERED で、取り付け先が P の位置になる向き | 通常は置けない (ダイオードは取り付け先にならない)。更新なしの設置でだけ起きうる [要実機] |
| tripwire_hook | POWERED で、取り付け先が P の位置になる向き | 同上 |
| redstone_torch・redstone_wall_torch | 強い信号は真上にだけ出す | 起きない |
| 感圧板・検知レール・書見台・トラップチェスト・スカルクセンサー | 強い信号は真下 (問う側が下) にだけ出す | 起きない |
| target・日照センサーなど getDirectSignal を持たない信号源 | 既定の 0 | 起きない |

側面のトーチとレバーが効かないこと、レッドストーンブロックが 15 になることは fixture がある [実機 1.21.1: comparator-side-reject] [実機 1.21.1: comparator-side-redstone-block]。

#### 出力値 (calculateOutputSignal)

入力を i、側面を s とする。

| 条件 | compare | subtract |
|---|---|---|
| i = 0 | 0 | 0 |
| s > i | 0 | 0 |
| s ≤ i (i > 0) | i | i − s |

#### 点灯条件 (shouldTurnOn)

| 条件 | compare | subtract |
|---|---|---|
| i = 0 | 消灯 | 消灯 |
| i > s | 点灯 | 点灯 |
| i = s (i > 0) | 点灯 | 消灯 |
| i < s | 消灯 | 消灯 |

どの場合も「点灯 ⇔ 出力値 > 0」になる。2 つの関数は別々に入力を読み直す (1 回の判定で入力を 2〜3 回読む) が、間に書き込みが無いので同じ値になる。

### 4.6 近隣更新を受けたとき: DiodeBlock#neighborChanged

[26.3 読解: DiodeBlock#neighborChanged]

1. **その位置の今のブロックが自分と同じ種類でなければ、何もしない** [版差 1.21.1: この確認が無い]。
2. 足場がある (canSurvive) なら、checkTickOnNeighbor を呼ぶ (§4.7・§4.8)。
3. 足場が無ければ次の順で壊れる。
   1. アイテムを落とす (コンパレーターは BlockEntity を渡す)。
   2. Level#removeBlock を「ピストンでない」で呼ぶ。flag 3 の書き込みで、その位置の流体の既定ブロック (普通は空気) になる。この中で撤去処理 (§4.13) が走る。
   3. P の 6 近傍「下・上・北・南・西・東」(Direction の定義順) のそれぞれを中心に、Level#updateNeighborsAt を呼ぶ。つまり 6 × 6 件の近隣更新を積む。

足場を失う普通の経路は形状更新である。真下からの形状更新で canSurviveOn が偽なら、RepeaterBlock#updateShape・ComparatorBlock#updateShape が空気を返し、Block#updateOrDestroy が Level#destroyBlock (flag 3) で壊す。手順 3 は、形状更新が届かなかったときの控えである。

受け取った状態 (引数の state) は、普通の近隣更新なら「実行時にその位置から読み直した状態」である。コンパレーター更新 (§4.11) だけは「積んだ時点の状態」が渡る (→ 04_set-block-and-updates.md)。

- 手順 1 の「同じ種類か」だけは、実行時にその位置から読み直す。
- 手順 2・3 の足場判定と、checkTickOnNeighbor が読む POWERED・MODE・FACING は、**渡された状態**から取る。入力・側面・BlockEntity の値・willTickThisTick は実行時のワールドから読む。
- だからコンパレーター更新が連鎖の途中で積まれ、走るまでの間にそのコンパレーターの POWERED や MODE が書き換わると、古い POWERED と今の入力を比べることになる [26.3 読解: CollectingNeighborUpdater の状態つき更新, DiodeBlock#neighborChanged]。スタックが空のとき (BlockEntity 相のホッパーなどから直に呼ばれたとき) は積んですぐ走るので、ずれは無い。

### 4.7 リピーターの予約: DiodeBlock#checkTickOnNeighbor

[26.3 読解: DiodeBlock#checkTickOnNeighbor, #shouldPrioritize]

判定はこの順である。

1. isLocked (実行時に側面を読む) なら、何もしない。
2. on = POWERED、want = shouldTurnOn を取る。
3. on と want が同じなら、何もしない。
4. **その位置・その種類の予約が「この gt にこれから走る」なら、何もしない** (willTickThisTick。§4.9)。
5. 優先度を決めて、遅延 delay × 2 gt で予約する。

優先度の選び方:

| 順 | 条件 | 優先度 |
|---|---|---|
| 1 | shouldPrioritize が真 | -3 (EXTREMELY_HIGH) |
| 2 | そうでなく、今 ON (OFF にしたい) | -2 (VERY_HIGH) |
| 3 | そうでなく、今 OFF (ON にしたい) | -1 (HIGH) |

shouldPrioritize は「**F がダイオードで、その FACING が『P から F への向き』と違う**」である。

| F のダイオードの向き | 意味 | shouldPrioritize |
|---|---|---|
| FACING が自分と同じ | 直列の次段 (自分は相手の後ろに入る) | 真 |
| FACING が自分と直角 | 自分は相手の側面に入る (ロック・側面入力) | 真 |
| FACING が自分と逆 (相手の出力が自分を向く) | 向かい合わせ | 偽 |
| F がダイオードでない | — | 偽 |

- 見るのは F の 1 マスだけ。F が導体で、その先にダイオードがあっても偽。
- 相手の POWERED・LOCKED・種類 (リピーターかコンパレーターか) は見ない。
- 遅延と優先度は、予約した時点の状態で決まる。予約のあとで DELAY を変えても、積んだ予約の時刻は変わらない。

### 4.8 コンパレーターの予約: ComparatorBlock#checkTickOnNeighbor

[26.3 読解: ComparatorBlock#checkTickOnNeighbor]

判定はこの順である。**リピーターと順が違う** (willTickThisTick が最初)。

1. willTickThisTick が真なら、何もしない。
2. 出力値 (calculateOutputSignal) と、BlockEntity の保持値 (無ければ 0) を取る。
3. 「出力値 ≠ 保持値」または「POWERED ≠ shouldTurnOn」なら、遅延 2 gt で予約する。
4. 優先度は、shouldPrioritize が真なら -1 (HIGH)、偽なら 0 (NORMAL)。

- ロックの確認は無い (DiodeBlock#isLocked の既定は偽で、コンパレーターは上書きしない)。
- shouldPrioritize はリピーターと同じ関数 (§4.7 の表)。
- 入力の強さだけが変わったとき (5 → 7 など。POWERED は true のまま) も予約する。

[実機 1.21.1: comparator-nc-own-tick] [実機 1.21.1: repeater-nc-own-tick] が、willTickThisTick の有無で 1 gt の差が出ることを押さえている。

### 4.9 willTickThisTick と重複排除 (予約の 2 つの関門)

[26.3 読解: LevelTicks#willTickThisTick, #runCollectedTicks, LevelChunkTicks#schedule, #poll, ScheduledTick の重複判定]

予約には関門が 2 つある。全体は → 02_scheduled-ticks.md。ダイオードに効く事実だけ書く。

| 関門 | 見ているもの | 真になる期間 |
|---|---|---|
| 重複排除 (LevelChunkTicks#schedule) | 「位置 + ブロックの種類」が同じ予約が、チャンクの待ち行列にあるか | 予約してから、その予約が「この gt に走る分」として取り出されるまで |
| willTickThisTick | 「位置 + ブロックの種類」が同じ予約が、この gt の実行待ちの列にあるか | 予約 tick 相の頭で取り出されてから、その予約が実行される直前まで |

- 重複排除に掛かった予約は**黙って捨てられる**。先に積んだ方の時刻と優先度が残る。
- この gt に走る分は、相の頭でまとめて取り出され、チャンクの待ち行列から外れる。だから相の途中では重複排除が効かない。その穴を塞ぐのが willTickThisTick である。
- 実行される予約は、**実行の直前に**実行待ちの列から外れる。自分の tick の中から見ると、自分の予約は willTickThisTick に当たらない。
- 予約 tick 相の外 (ブロックイベント相・エンティティ相・プレイヤー操作) では、実行待ちの列は空なので、willTickThisTick は常に偽。
- どちらの関門も遅延と優先度を見ない。DELAY が違う状態で積んだ予約も「同じ予約」である。
- 同じ gt・同じ優先度の中の順 (subTickOrder) は、**予約を積む呼び出しの時点**でワールドの通し番号から取る。重複排除で捨てられる予約も番号を 1 つ使う (順にしか効かないので、相対順だけ合えばよい) [26.3 読解: LevelAccessor#createTick, Level#nextSubTickCount]。
- 実行時刻は「積んだ時点の gameTime + 遅延」である。

時系列でまとめる。ある位置に、時刻 T に走る予約 X があるとする。

| 近隣更新が来る時点 | 重複排除 | willTickThisTick | 新しい予約 |
|---|---|---|---|
| T より前の gt | 当たる | 偽 | 捨てられる (X が残る) |
| T の予約 tick 相で、X の実行より前 | 当たらない | 真 | 積まない |
| T の予約 tick 相で、X の実行中・実行後 | 当たらない | 偽 | 積める (T + 遅延) |
| T のブロックイベント相以降 | 当たらない | 偽 | 積める |

### 4.10 tick の処理

#### リピーター: DiodeBlock#tick

[26.3 読解: DiodeBlock#tick, ServerLevel#tickBlock]

前提: tickBlock は、その位置のブロックが予約した種類と同じときだけ tick を呼ぶ。状態は実行時に読み直す。

1. isLocked (実行時に側面を読む) なら、**何もしない**。再予約もしない。
2. on = POWERED、want = shouldTurnOn を取る。
3. 分岐する。

| on | want | すること |
|---|---|---|
| true | false | POWERED を false にして flag 2 で書く |
| false | true | POWERED を true にして flag 2 で書く |
| false | false | **POWERED を true にして flag 2 で書く**。そのあと、遅延 delay × 2 gt・**優先度 -2 固定**で予約する |
| true | true | 何もしない |

- 「OFF で入力なし」でも一度 ON にするのが、最短パルス幅 = 遅延の根拠である [実機 1.21.1: short-pulse-repeater] [実機 1.21.1: pulse-2gt-repeater-d2]。
- tick の中の予約は shouldPrioritize を見ない。常に -2 [実機 1.21.1: repeater-self-off-priority]。
- 「ON で入力あり」は何もしない。ON の間に入力が一瞬切れて戻った場合がこれに当たり、**遅延より短い OFF パルスは消える**。
- 書き込みは §2.4 の順で前方更新と形状更新を出す。

遅延中に入力が変わったときの帰結:

| 予約した理由 | 予約が走る時点の入力 | 結果 |
|---|---|---|
| ON にしたい (今 OFF) | ある | ON になる |
| ON にしたい (今 OFF) | 無い (短い ON パルス) | ON になり、遅延後に OFF の予約 (-2)。出力のパルス幅は遅延と同じ |
| OFF にしたい (今 ON) | 無い | OFF になる |
| OFF にしたい (今 ON) | ある (短い OFF パルス) | 何もしない。出力は切れない |
| どちらでも | ロック中 | 何もしない。ロックが外れても自動では再評価しない (次の近隣更新を待つ) |

遅延中に来た近隣更新は、重複排除で捨てられる (§4.9)。予約の時刻も優先度も最初のものが残る。

ロックが外れるときは、側面のダイオードが OFF になって前方更新を出し、その F がこのリピーターなので近隣更新が届く。そこで checkTickOnNeighbor が改めて判定する [実機 1.21.1: repeater-lock]。

#### コンパレーター: ComparatorBlock#tick → refreshOutputState

[26.3 読解: ComparatorBlock#tick, #refreshOutputState]

1. 出力値 v を calculateOutputSignal で求める。
2. BlockEntity があれば、古い保持値 old を読み、**すぐ v を書く**。BlockEntity が無ければ old = 0 で、書き込みはしない。
3. 「old ≠ v」または「mode が compare」なら、手順 4〜6 へ。どちらでもなければ終わり (**subtract で値が同じなら、POWERED が食い違っていても何もしない**)。
4. want = shouldTurnOn、on = POWERED を取る。
5. on で want でなければ POWERED を false に、on でなく want なら POWERED を true にして、flag 2 で書く。同じなら書かない。
6. updateNeighborsInFront を呼ぶ (書いても書かなくても)。

手順 5 で書いた場合、書き込みの中の onPlace が updateNeighborsInFront を 1 回呼び、手順 6 でもう 1 回呼ぶ。**前方更新は 2 回**出る。順は次のとおり。

1. BlockEntity に v を書く。
2. flag 2 の書き込み: 状態の差し替え → onPlace の前方更新 (1 回目。F へ 1 件 → F の周り 5 件。連鎖を走り切る) → 形状更新 (P の 6 近傍)。
3. 前方更新 (2 回目)。

1 回目の前方更新の時点で、BlockEntity の値はすでに新しい。F から読む出力値は新しい値になる。

POWERED が変わらない場合 (強さだけ変わる・compare の空振り) は、書き込みが無いので**前方更新は 1 回、形状更新は 0 回**である。出力の強さだけが変わっても blockstate は変わらないので、コンパレーターを見ているオブザーバーは反応しない。

| mode | old と v | POWERED の変化 | BlockEntity | 書き込み | 前方更新 | 形状更新 |
|---|---|---|---|---|---|---|
| どちらでも | 違う | 変わる | 更新 | あり | 2 回 | あり |
| どちらでも | 違う | 変わらない | 更新 | なし | 1 回 | なし |
| compare | 同じ | 変わらない | 同じ値を書く | なし | 1 回 | なし |
| compare | 同じ | 変わる (食い違っていた) | 同じ値を書く | あり | 2 回 | あり |
| subtract | 同じ | — | 同じ値を書く | なし | 0 回 | なし |

compare の空振りで前方更新が出ることは fixture がある [実機 1.21.1: comparator-compare-front-nc]。
コンパレーターは tick の中で再予約しない。次の予約は、次の近隣更新かコンパレーター更新が来たときに積まれる。

### 4.11 コンパレーター更新を受ける経路

[26.3 読解: Level#updateNeighbourForOutputSignal]

アナログ源の中身が変わると、Level#updateNeighbourForOutputSignal がコンパレーターへ直接 neighborChanged を届ける。配り方の全体は → 04_set-block-and-updates.md。受ける側から見た事実だけ書く。

1. 変わった位置 X の水平 4 方向を、Direction.Plane.HORIZONTAL の順 (北・東・南・西) に見る。
2. 隣が comparator なら、そこへ neighborChanged を届ける。
3. 隣が導体なら、さらに同じ向きへ 1 マス先を見て、comparator なら届ける。
4. 向きは見ない。**そのコンパレーターが X を向いているかどうかに関係なく届く**。届いた先で checkTickOnNeighbor が入力を計算し、変化が無ければ何も起きない。
5. 上下は見ない。

§4.4 の読み取り (B と、導体越しの B2) とちょうど対になる。額縁の中身や回転が変わったときも、額縁の位置を X として同じ関数が呼ばれる [26.3 読解: ItemFrame の setItem と setRotation]。額縁は B2 の位置にいるので、手順 3 の「導体越し」でコンパレーターに届く。

### 4.12 前方の更新: DiodeBlock#updateNeighborsInFront

[26.3 読解: DiodeBlock#updateNeighborsInFront, #onPlace, #affectNeighborsAfterRemoval, CollectingNeighborUpdater の単発更新と複数更新]

手順:

1. F の位置を求める。
2. (実験フラグ REDSTONE_EXPERIMENTS が有効なら、前 = FACING の逆・上 = UP の Orientation を作る。無効なら Orientation は無し。→ 04_set-block-and-updates.md)
3. **F へ近隣更新を 1 件**送る。送り元のブロックは自分。
4. **F を中心に、FACING の向き (= F から P への向き) を除く 5 方向**へ近隣更新を送る。順は「西・東・下・上・北・南」から 1 つ抜いたもの。

FACING ごとの手順 4 の順:

| FACING (入力側) | F は P の | 飛ばす向き | F の周りを回る順 |
|---|---|---|---|
| north | 南 | 北 | 西・東・下・上・南 |
| south | 北 | 南 | 西・東・下・上・北 |
| west | 東 | 西 | 東・下・上・北・南 |
| east | 西 | 東 | 西・下・上・北・南 |

走り方 (→ 04_set-block-and-updates.md):

- 近隣更新のスタックが空のとき (予約 tick・プレイヤー操作から直に呼ばれたとき) は、手順 3 が連鎖ごと走り切ってから、手順 4 が始まる。
- すでに連鎖の中にいるとき (形状更新で LOCKED が変わったときなど) は、手順 3 と 4 は「この層で足した分」として積まれ、今の更新が戻ったあと、積んだ順に走る。
- 手順 4 の 5 件は 1 個の「複数更新」として積まれ、1 件ずつ取り出される。途中の 1 件が新しい更新を積むと、そちらが先に走る (深さ優先)。

updateNeighborsInFront が呼ばれる契機の一覧:

| 契機 | 経路 | 回数 |
|---|---|---|
| ダイオードが置かれた | onPlace | 1 |
| 同じ種類のまま blockstate が変わった (POWERED・LOCKED・DELAY・MODE・FACING) | onPlace (LevelChunk#setBlockState は、flag 512 が無ければ状態が変わるたびに onPlace を呼ぶ。古い状態を見ない) | 1 |
| コンパレーターの refreshOutputState が手順 6 に達した | 直接 | 1 (書き込みがあれば合計 2) |
| ダイオードが別のブロックに変わった | affectNeighborsAfterRemoval (§4.13) | 1 (条件つき) |

**LOCKED だけが変わったときも前方更新が出る**。DELAY を回したときも出る。出力は変わらないので普通は何も起きないが、F が BUD 状態のブロック (準接続のピストンなど) なら動く [要実機] (§8 P-3)。

### 4.13 設置・撤去

#### 設置

[26.3 読解: DiodeBlock#getStateForPlacement, RepeaterBlock#getStateForPlacement, DiodeBlock#onPlace, #setPlacedBy, LevelChunk#setBlockState]

プレイヤーがアイテムで置く場合の順 (BlockItem の流れの全体は → 04_set-block-and-updates.md §4.13):

1. 置く状態を決める。FACING はプレイヤーの水平の向きの逆。リピーターは、その場で isLocked を読んで LOCKED を決める。POWERED は false。足場が無い (canSurvive が偽) なら置けない [26.3 読解: BlockItem#canPlace]。
2. flag 11 (1 + 2 + 8) で書く [26.3 読解: BlockItem#placeBlock]。
   1. onPlace → 前方更新 (§4.12)。この時点でコンパレーターの BlockEntity はまだ無い。
   2. コンパレーターなら BlockEntity を作る (値 0)。
   3. flag 1 の分: P の 6 近傍へ近隣更新 (送り元は古いブロック)。
   4. 形状更新。
3. setPlacedBy: **shouldTurnOn が真なら、遅延 1 gt・優先度 0 で予約する**。ロックは見ない。
4. 1 gt 後の tick で、リピーターは ON になる (ロック中なら何もしない)。コンパレーターは refreshOutputState で出力を決める。

- 手順 3 は「アイテムで置いたとき」(BlockItem#place が書き込みのあとに呼ぶ) だけ通る。/setblock・/fill・構造物の読み込み・ピストンは通らない。
- 手順 3 の予約も重複排除 (§4.9) の対象である。手順 2 の連鎖の中でこのダイオードが近隣更新を受けて先に予約を積んでいれば (遅延は delay × 2 gt)、1 gt の予約は捨てられる。普通の配置では手順 2 の間に自分へ近隣更新は返らないので、1 gt の予約が残る。
- /setblock (strict でないとき) の経路は → 04_set-block-and-updates.md §4.11。ダイオードに効く事実だけ書く [26.3 読解: SetBlockCommand, BlockInput#place, ServerLevel#updateNeighboursOnBlockSet]。
  1. 置く状態を周りの形状に合わせる。リピーターは、ここで LOCKED が側面から決まる (コマンドで locked を明示すればそちらが勝つ)。真下が足場でなく空気になった場合は、元の状態に戻して置く (足場なしでも置ける)。
  2. flag 258 (2 + 256) で書く。onPlace → 前方更新 → 形状更新。
  3. 後始末で、古いブロックが別の種類ならその撤去処理 → P の 6 近傍へ近隣更新 (送り元は新しいブロック)。
- /setblock で置いたダイオードは、自分では入力を見に行かない。手順 3 の近隣更新は自分には届かないからである。周りの何かが近隣更新を出すまで、置かれた状態のまま残る。足場なしで置いたダイオードも、近隣更新か真下からの形状更新が来るまで残る。
- POWERED が true の状態で置けば、置いた瞬間から出力する。コンパレーターは BlockEntity の値が 0 なので、POWERED が true でも出力は 0 である (BlockEntity のデータを付けて置いた場合を除く)。

#### 撤去

[26.3 読解: DiodeBlock#affectNeighborsAfterRemoval, LevelChunk#setBlockState]

LevelChunk#setBlockState は、次の条件がそろったとき、古い状態の affectNeighborsAfterRemoval を呼ぶ。

- ブロックの種類が変わった (または新しいブロックがレール)。
- サーバー側である。
- flag 1 がある、またはピストンによる移動 (flag 64) である。

DiodeBlock の撤去処理は、「ピストンによる移動でなければ」updateNeighborsInFront を古い状態 (古い FACING) で呼ぶ。

撤去の書き込みの中の順 (flag 3 のとき):

1. 状態を差し替える。
2. コンパレーターなら BlockEntity を消す。
3. 撤去処理 → 古い F へ前方更新。この時点で P はもう新しいブロックなので、F から読む信号は 0。
4. 新しいブロックの onPlace。
5. Level#setBlock に戻り、P の 6 近傍へ近隣更新 → 形状更新。

| 撤去の経路 | flag | 撤去処理 (前方更新) |
|---|---|---|
| プレイヤーが壊す・Level#destroyBlock・足場を失う (形状更新)・/setblock の destroy 指定 | 3 | 出る |
| neighborChanged の控えの経路 (§4.6) | 3 | 出る。そのあと 6 × 6 件の近隣更新 |
| /setblock・/fill で別のブロックに置き換える (strict でない) | 258 | 書き込みの中では**出ない**。書き込み (新しいブロックの onPlace と形状更新まで) が終わったあと、後始末 (ServerLevel#updateNeighboursOnBlockSet) が撤去処理を呼ぶので**出る**。そのあと P の 6 近傍へ近隣更新 [版差 1.21.1: 書き込みの中で、新しいブロックの onPlace より前に出る] |
| /setblock・/fill の strict 指定 | 818 | **出ない** (後始末も無い)。新しいブロックの onPlace も呼ばれない [版差 1.21.1: strict が無い] |
| flag 1 も 64 も無い、その他の書き込み (構造物の配置など。flag は呼び出し側による) | 2 など | **出ない** [版差 1.21.1: 出る] |
| ピストンが壊す | 18 で空気にする。あとで PistonBaseBlock が明示的に呼ぶ | 出る。ただし時点が遅い (→ 13_pistons.md) [版差 1.21.1: 書き込みの時点で出る] |

### 4.14 プレイヤー操作

#### リピーター: 遅延の切り替え

[26.3 読解: RepeaterBlock#useWithoutItem]

1. プレイヤーに建築の権限 (mayBuild) が無ければ、何もせず素通し。
2. DELAY を 1 つ進めた状態 (4 の次は 1) を、flag 3 で書く。

出る更新 (順):

1. onPlace → 前方更新 (F へ 1 件・F の周り 5 件)。
2. P の 6 近傍へ近隣更新 (西・東・下・上・北・南)。
3. 形状更新 (P の 6 近傍)。

- 自分には近隣更新が来ないので、予約の積み直しは起きない。**積んである予約の時刻は古い DELAY のまま**である。
- tick の中で積む OFF の予約 (§4.10) は、tick の時点の DELAY を使う。
- POWERED・LOCKED は変えない。
- 操作が tick のどこで当たるかは → 01_tick-loop.md。

#### コンパレーター: モードの切り替え

[26.3 読解: ComparatorBlock#useWithoutItem]

1. mayBuild が無ければ素通し。
2. MODE を切り替えた状態を作る。音を鳴らす (subtract へは高さ 0.55、compare へは 0.5。挙動には効かない)。
3. その状態を **flag 2** で書く。onPlace → 前方更新 → 形状更新。
4. その位置がまだ comparator なら [版差 1.21.1: この確認が無い]、**その場で refreshOutputState** を新しい MODE の状態で呼ぶ (§4.10 の手順 1〜6)。

- モードの切り替えは**遅延なし**で出力に反映される。予約 tick を使わない。
- 手順 3 の前方更新の時点では、BlockEntity の値は古いまま。F は古い出力値を読む。手順 4 で値が変われば、改めて前方更新が出る。
- 手順 4 が compare への切り替えなら、値が同じでも前方更新が出る。subtract への切り替えで値が同じなら、手順 3 の 1 回だけ。
- 前方更新の回数は、最少 1 回 (subtract へ・値が同じ)、最多 3 回 (値が変わり POWERED も変わる: 手順 3 + onPlace + 直接)。

### 4.15 形状更新を受けたとき

[26.3 読解: RepeaterBlock#updateShape, ComparatorBlock#updateShape, DiodeBlock#canSurviveOn]

| ブロック | 来た向き | 条件 | 結果 |
|---|---|---|---|
| 両方 | 下 | 真下が足場にならない | 空気になる (Block#updateOrDestroy が Level#destroyBlock で壊す。アイテムを落とす) |
| repeater | 下・上・FACING と直角の水平 2 方向 (= FACING の軸でない向き) | サーバー側 | LOCKED を isLocked の今の値にする。変われば、形状更新の flag のまま書かれる |
| repeater | FACING の軸の 2 方向 | — | 変えない |
| comparator | 下以外 | — | 変えない |

- LOCKED の再計算は、上下からの形状更新でも走る。側面からだけではない。
- LOCKED が変わると、書き込みの中で onPlace → 前方更新が出る (§4.12)。形状更新の flag は元の書き込みの flag から 1 と 32 を落としたものなので、自分の周りへの近隣更新は出ない。形状更新は続く (→ 04_set-block-and-updates.md)。
- 側面のダイオードは、POWERED を flag 2 で書くときに形状更新を出す。それがこのリピーターに届いて LOCKED が変わる。**LOCKED の表示が変わるのは、側面のダイオードが反転した書き込みの中**である。

### 4.16 ダストとの接続

[26.3 読解: RepeaterBlock#shouldRedstoneWireConnectTo, BlockBehaviour#shouldRedstoneWireConnectTo]

| ブロック | ダストが接続する向き |
|---|---|
| repeater | 問われた向きが FACING か、その逆のとき。つまり前後の 2 面だけ |
| comparator | 既定 (信号源で、向きが与えられている) → 水平 4 面とも |

向きの意味と、段差越しの接続は → 06_redstone-wire.md。
26.2 までは同じ判定が RedStoneWireBlock の中にあった。26.3 でブロック側のメソッドへ移っただけで、結果は同じである [版差 1.21.1]。

### 4.17 ブロックイベント

ComparatorBlock#triggerEvent は BlockEntity へ渡すだけで、ComparatorBlockEntity は受けない。ダイオードはブロックイベントを出さない (→ 03_block-events.md)。

---

## 5. 端の場合と落とし穴

### 5.1 LOCKED プロパティは判定に使われない

tick も checkTickOnNeighbor も、isLocked を呼んで**その場で側面を読む**。LOCKED プロパティは読まない。
LOCKED は形状更新で追従するだけなので、形状更新が届かない書き込み (flag 16 つき) のあとは、表示と実際が食い違いうる。挙動は実際の側面で決まる。

### 5.2 ロック中に来た予約は「空振り」で消える

ロック中の tick は何もせず、再予約もしない。ロックが外れた瞬間に自動で追いつく仕組みは無い。
追いつくのは、ロックを外した側面のダイオードの前方更新がこのリピーターに届くからである。
側面のダイオードの F がこのリピーターでない配置 (ありえない。側面で出力がこちらを向くなら F はここ) は考えなくてよい。
ただし、ロックした側が**壊された**場合は、撤去処理の前方更新 (flag 1 があるとき) か、P の周りへの近隣更新で届く。

### 5.3 tick の中の OFF 予約より先に、連鎖が予約を積むことがある

リピーターが「OFF・入力なし」で tick に入ると、ON を書いたあとで OFF を予約する (§4.10)。
ところが ON の書き込みの前方更新の連鎖が、このリピーター自身に近隣更新を返すことがある (F がダストで、ダストの再計算が周りへ近隣更新を配る場合など)。

そのとき checkTickOnNeighbor は「ON だが入力なし」を見て、先に予約を積む。優先度は §4.7 の表どおり (-3 か -2)。
tick の末尾の予約 (-2) は重複排除で捨てられる。

- 時刻は同じ (どちらも今 + 遅延)。
- 優先度は、F がダイオードでなければ同じ -2。F がこちらを向かないダイオードなら連鎖側は -3 になりうるが、ダイオードは近隣更新を受けても連鎖を返さないので、普通は起きない。
- **違うのは同じ優先度の中の順 (subTickOrder)** である。連鎖の中で積んだ予約は、連鎖の後半で他のブロックが積む予約より前の番号になる。「連鎖を全部終えてから積む」と作ると、順が入れ替わる。

[実機 1.21.1: repeater-self-off-priority] は優先度 -2 を押さえているが、この順までは押さえていない [要実機] (§8 P-2)。

### 5.4 「入力あり」は強さを見ない / コンパレーターは見る

リピーターは入力が 1 でも 15 でも同じ。コンパレーターは強さが変わるだけで予約する。
コンパレーターの前のダストは、出力値が変わるたびに再計算される (前方更新 1 回。blockstate は変わらない)。

### 5.5 コンパレーターの入力はアナログ値が「置き換える」

§4.4 のとおり、大きい方ではなく置き換えである。

- B がアナログ源なら、B に入る強い信号や、B 自身の通常の信号は読まれない。たとえば B が中身のあるジュークボックスなら、読むのはアナログ値である (→ 14_containers-hoppers-analog.md)。
- B が導体で B2 が空の容器なら、導体が弱く充電されていても入力は 0。
- 導体が 15 で充電されているときだけ、B2 は読まれない。14 以下なら置き換わる。

### 5.6 POWERED と OutputSignal は別物

| 状態 | 起きる場面 | 出力 |
|---|---|---|
| POWERED=true・保持値 0 | POWERED=true で /setblock した直後。BlockEntity の無い位置 | 0 |
| POWERED=false・保持値 > 0 | 構造物や /data で作った状態 | 0 |
| POWERED=true・保持値 > 0 | 通常 | 保持値 |

食い違った状態は、次に予約が走れば直る。ただし subtract で「計算値 = 保持値」のまま POWERED だけ食い違うと、tick が走っても直らない (§4.10 手順 3)。checkTickOnNeighbor は予約を積むので、**近隣更新のたびに 2 gt 後の空振りが続く**。vanilla は読み込み時にこの食い違いを正規化しない。構造物を読み込む実装でも、POWERED と保持値を別々にそのまま持つのが vanilla どおりである。

### 5.7 コンパレーターの比較は「側面の最大」とだけ行う

S1 と S2 は大きい方だけを使う。和ではない。
側面のダストは形を見ない。コンパレーターの横を素通りするダストも側面入力になる。

### 5.8 オブザーバーのパルスをコンパレーターが飲み込む

オブザーバーの 2 gt パルスの終わり (優先度 0 の予約) と、コンパレーターの ON の予約 (優先度 0) が同じ gt に並ぶ。オブザーバーの予約が先に積まれているので先に走り、コンパレーターの tick の時点で入力は 0 に戻っている (→ 08_torch-observer-redstone-block.md)。
コンパレーターの F がこちらを向かないダイオードなら、優先度が -1 になって先に走り、パルスが通る。
[実機 1.21.1: observer-comparator-swallow] [実機 1.21.1: comparator-compare-front-nc]

### 5.9 自分の周りへ近隣更新を出さない

POWERED を書くのは flag 2 なので、P の 6 近傍への近隣更新は出ない。届くのは F と F の 5 近傍、そして形状更新 (P の 6 近傍) である。

- P の真上・真下・側面・後ろのブロックは、形状更新でしか変化を知らない。オブザーバーは気づくが、近隣更新で動くブロック (ピストン・ランプなど) は気づかない。
- F の 5 近傍には P の斜め (F の上・下・両側面) と、P から 2 マス先が入る。P 自身は入らない。

### 5.10 足場と上下

ダイオードは真下の上面が RIGID で sturdy なら立つ (→ 05_signals-and-block-properties.md)。真下が導体かどうかは関係ない。
ダイオードは上下へ信号を出さず、上下から入力も読まない。上下で効くのは「足場」と「LOCKED の再計算の契機 (形状更新)」だけである。

### 5.11 willTickThisTick を見る場所の違い

| | 見る順 | ロック |
|---|---|---|
| リピーター | ロック → 食い違い → willTickThisTick | 見る |
| コンパレーター | willTickThisTick → 出力値の計算 → 食い違い | 見ない |

結果は同じ (どれかで止まれば予約しない) だが、コンパレーターは willTickThisTick が真なら入力を読まない。入力の読み取りに副作用は無いので、観測できる差は無い。

### 5.12 書き込みの途中で自分が書き換わったとき

[26.3 読解: Level#setBlock, LevelChunk#setBlockState]

ダイオードの書き込みは、onPlace の前方更新を「書き込みの途中」で走らせる。その連鎖が P 自身を書き換えると、外側の書き込みの残りが省かれる。

| 時点 | 条件 | 省かれるもの |
|---|---|---|
| 撤去処理 (前方更新) の連鎖のあと | P のブロックの種類が、書こうとした種類でなくなっている | 新しいブロックの onPlace・BlockEntity の作成・外側の近隣更新と形状更新のすべて (書き込みは失敗扱い) |
| onPlace (前方更新) の連鎖のあと | P のブロックの種類が変わっている | BlockEntity の作成 |
| チャンクの書き込みから戻ったあと | P の状態が、書いた状態と**同一でない** (LOCKED だけの違いでも) | flag 1 の近隣更新・コンパレーター更新・形状更新 |

- 普通の回路では、前方更新の連鎖が同じ gt の中で P を書き換えることはまず無い (ダイオードもピストンも遅延や別の相を挟む)。起きうるのは、連鎖の中で P の足場が即時に消える場合や、P の側面・上下から形状更新が返って LOCKED が変わる場合である。
- 省かれるのは「外側の書き込みの分」だけで、内側の書き込み (P を書き換えた方) は自分の更新を出す。
- Rust でも、書き込みの関数は「onPlace のあとで状態を読み直し、同じなら残りを出す」形にする (→ 04_set-block-and-updates.md)。

### 5.13 コンパレーターの tick と操作は、渡された状態で POWERED を書く

refreshOutputState は、呼び出し側が渡した状態 (tick なら実行直前に読んだ状態、操作なら MODE を切り替えた状態) の POWERED だけを差し替えて書く。BlockEntity への書き込みから blockstate の書き込みまでの間に連鎖は挟まらないので、tick の経路では渡された状態と実際の状態は一致する。
最後の前方更新 (2 回目) は、渡された状態の FACING で F を決める。FACING は書き込みで変わらないので差は無い。

### 5.14 Orientation と実験フラグ

updateNeighborsInFront が作る Orientation は、REDSTONE_EXPERIMENTS が有効なときだけ存在し、乱数を 1 回使う。既定 (無効) では null で、乱数も使わない。このメモの順はすべて既定の場合である (→ 04_set-block-and-updates.md / 06_redstone-wire.md)。

---

## 6. 版差

担当 5 クラスを diff した結果。改名と書き方だけの差は省く。

### 6.1 1.21.1 → 26.2

| 箇所 | 1.21.1 | 26.2 以降 | 挙動への影響 |
|---|---|---|---|
| DiodeBlock#neighborChanged の冒頭 | 確認なし | その位置の今のブロックが自分と同じ種類のときだけ処理する | 連鎖の途中で壊れた・置き換わったダイオードへ、古い状態つきの更新 (コンパレーター更新) が届いた場合に、1.21.1 は予約を積んだり足場判定で壊そうとしたりしうる。普通の回路では差が出ない |
| 撤去時の前方更新 | onRemove。「ピストンでない」かつ「ブロックの種類が変わった」とき。LevelChunk#setBlockState は flag に関係なく呼ぶ | affectNeighborsAfterRemoval。LevelChunk#setBlockState は flag 1 があるかピストン移動のときだけ呼ぶ | flag 1 の無い書き込みでダイオードを消したとき、1.21.1 は前方更新が書き込みの中で出る。26.x は書き込みの中では出ない |
| /setblock でダイオードを別のブロックにする | flag 2 の書き込みの中で onRemove → 前方更新 → 新しいブロックの onPlace → 形状更新。そのあと P の 6 近傍へ近隣更新 | flag 258 の書き込み (新しいブロックの onPlace → 形状更新) のあと、後始末が撤去処理 → 前方更新 → P の 6 近傍へ近隣更新。strict 指定なら撤去処理も後始末も無い | 前方更新は両方で出るが、**形状更新との前後が逆**になる。/setblock でダイオードを消す fixture は、26.3 の正解として使う前に順を確かめる (→ 04_set-block-and-updates.md §4.11, 19_version-diffs.md) |
| ピストンがダイオードを壊す | flag 18 の書き込みの時点で onRemove → 前方更新 | 書き込みの時点では出ない。押し終えたあとの更新のループで PistonBaseBlock が明示的に呼ぶ | 前方更新の時点が違う (→ 13_pistons.md) |
| 近隣更新の引数 | 送り元の位置 | Orientation (既定は null) | 既定では差なし |
| 前方更新の Orientation | なし | 実験フラグのときだけ作る | 既定では差なし |
| アナログ値の読み出し | 位置だけ | 位置 + 向き (FACING の逆) | 向きを使うブロックがあれば差 (→ 14_containers-hoppers-analog.md) |
| ComparatorBlock#useWithoutItem | 書いたあと無条件で refreshOutputState | 書いたあと、その位置がまだ comparator のときだけ | 普通は差なし |
| 額縁の絞り込み | null の確認つき | 向きの一致だけ | 差なし |
| ownSignal | 無い (getSignal の中に直書き) | 切り出された | getSignal の結果は同じ |
| 形の定義 | box | column | 差なし |

入力の計算・側面・ロック・予約の条件・優先度・遅延・tick・refreshOutputState・前方更新の順は、1.21.1 と 26.3 で同じである。
**既存の実機 fixture (1.21.1) は、この範囲では 26.3 にもそのまま通用する**と読める (→ 19_version-diffs.md)。

### 6.2 26.2 → 26.3

| 箇所 | 26.2 | 26.3 | 影響 |
|---|---|---|---|
| codec まわり | あり | 無くなった | なし |
| RepeaterBlock#useWithoutItem | flag 3 を直に指定 | setBlockAndUpdate (flag 3) | なし |
| ダストとの接続 | RedStoneWireBlock の中でリピーターを特別扱い | RepeaterBlock#shouldRedstoneWireConnectTo へ移動 | 結果は同じ |
| クラス名 | RedStoneWireBlock | RedstoneWireBlock | なし |
| 押し反応の名前 | DESTROY | POPPED | 名前だけ (→ 13_pistons.md) |
| ComparatorBlockEntity の種類の参照 | BlockEntityType | BlockEntityTypes | なし |

### 6.3 26.3 → 26.4-pre-1

担当 5 クラスは**差分なし** (diff が空)。

---

## 7. Rust で実装するときの要点

### 7.1 状態の持ち方

- repeater: facing (2 bit)・delay (1〜4)・locked・powered。64 状態。
- comparator: facing・mode・powered。16 状態。出力値は blockstate に入れず、位置ごとの BlockEntity 相当 (整数) に持つ。
- FACING は vanilla と同じ「入力側」で持つと、fixture・構造物の読み込み・このメモと食い違わない。今の TS は逆向きなので、移植のときに取り違えやすい。
- BlockEntity の値は 0〜15 に丸めない (vanilla は丸めない)。読み込んだ値をそのまま持つ。通常の動作では 0〜15 に収まる。
- LOCKED は「表示用の blockstate」として形状更新でだけ更新する。判定は毎回側面を読む関数にする。**LOCKED を判定の入力にしない**。

### 7.2 関数の切り方

vanilla と同じ単位で切ると、差分を追いやすい。

| 関数 | 入力 | 備考 |
|---|---|---|
| diode_input | P・FACING | §4.2。B の通常の信号 + ダストの POWER 直読 |
| comparator_input | P・FACING | §4.4。額縁を持たないなら B2 のブロックだけ |
| control_input | 側面の位置・向き・diodes_only | §4.3 / §4.5 |
| alternate_signal | P・FACING・diodes_only | 2 側面の大きい方 |
| should_prioritize | P・FACING | F の 1 マスだけ |
| check_tick_on_neighbor | 種類で分岐 | 見る順を §5.11 どおりに |
| diode_tick / refresh_output_state | | §4.10 |
| update_neighbors_in_front | P・FACING | §4.12。onPlace から必ず通す |

### 7.3 順序を保つために

1. **書き込みの中で onPlace を呼ぶ**。前方更新は「書き込みのあとに呼び出し側が出す」のではなく、「書き込みの関数の中で、形状更新より前に」出る。コンパレーターの 2 回目だけが呼び出し側から出る。
2. 前方更新は「単発 1 件」と「複数 5 件」の 2 個として更新器に渡す。スタックが空なら 1 個目が連鎖ごと走り切ってから 2 個目が始まる (→ 04_set-block-and-updates.md)。
3. リピーターの tick の OFF 予約は、**ON の書き込みが連鎖ごと終わったあと**に積む。先に連鎖が同じ位置へ積んでいれば、重複排除で捨てる (§5.3)。
4. 予約には 2 つの関門 (§4.9) を別々に実装する。
   - 重複排除: 「位置 + 種類」の集合。予約が「この gt の実行待ち」へ取り出された時点で外す。
   - willTickThisTick: 「この gt の実行待ち」の集合。実行の直前に外す。
5. コンパレーターの refreshOutputState は、BlockEntity の書き込み → blockstate の書き込み → 前方更新の順。逆にすると、1 回目の前方更新で F が古い値を読む。
6. コンパレーター更新 (§4.11) は、積んだ時点の状態を持って届く。冒頭の「今も同じ種類か」の確認を省かない。
7. DELAY・優先度は予約の時点で確定させ、予約に持たせる。tick の時点で読み直すのは、tick の中で積む OFF の遅延だけ。

### 7.4 他のメモとの境界

| このメモが決める | 他のメモが決める |
|---|---|
| ダイオードがいつ予約を積むか・優先度・遅延 | 予約の並びと実行 (→ 02) |
| 前方更新の対象と順 | 連鎖の積み方・深さの上限 (→ 04・18) |
| B のダストの POWER を直読すること | POWER の値そのもの (→ 06) |
| アナログ値で置き換える規則 | 各ブロックのアナログ値 (→ 14) |
| 側面で数えるブロックの条件 | 各信号源の getDirectSignal (→ 08・09・10) |
| 足場を失ったら壊れること | sturdy の表 (→ 05) |

### 7.5 省いてよいもの・省けないもの

| 項目 | 判断 |
|---|---|
| 粒子 (RepeaterBlock#animateTick)・音 | 省いてよい。クライアント側の乱数しか使わない |
| Orientation (実験フラグ) | 既定の挙動だけなら省いてよい |
| 額縁 | エンティティを持たないなら省く。ただし「B2 に額縁がある回路」は表せない (→ 17) |
| LOCKED 変化・DELAY 変化の前方更新 | **省けない**。BUD に効く |
| compare の空振りの前方更新 | 省けない [実機 1.21.1: comparator-compare-front-nc] |
| 反転時の 2 回の前方更新 | 省けない可能性が高い。2 回目は多くの場合空振りだが、1 回目の連鎖で F の周りが変わっていれば効く [要実機] (§8 P-4) |

---

## 8. 検証用のプローブ回路案

どれも 1.21.1 の実機ハーネスで撮れる (§6.1 のとおり、この範囲の規則は 26.3 と同じ)。観測は blockstate と、必要なら予約 tick の一覧。

### P-1 ダストの POWER 直読 (横へ流れるダストも入力になる)

- 目的: B のダストが左右へ流れる線の途中でも入力になること (§4.2 手順 3)。回帰用。
- 配置: リピーターの後ろ B にダスト 1 個。そのダストの両隣にもダストを置き、片端にレバー。対照として、B を空気にして B の隣にダストを置いた列。コンパレーター版も並べる。
- 観測: レバー ON から 2 gt 後にリピーターが ON。対照は ON にならない。B のダストの形 (リピーター側へ伸びているか) も記録する。
- 期待の要点: 入力になる。コンパレーターの出力値は B のダストの POWER と同じ。B のダストは 3 方向 (左右 + ダイオード側) へ伸びる。

### P-2 tick の中の OFF 予約と連鎖の順 (§5.3)

- 目的: リピーターの OFF 予約の subTickOrder が「連鎖の中」で決まるか。
- 配置: リピーター R (delay 1) の F にダスト。そのダストの隣に、同じ gt に同じ優先度 -2 で OFF を予約する別のリピーター R2 (入力はそのダスト)。R へは 1 gt のパルスを入れる。R と R2 の OFF が同じ gt・同じ優先度で並ぶようにし、2 つの出力が 1 つのマスを取り合うピストンで順を可視化する。
- 観測: R が ON になった gt の予約 tick の一覧 (位置・優先度・順)。
- 期待の要点: R の OFF 予約が、R2 の予約より前の番号で積まれる (読解どおりなら)。逆なら §5.3 の読みが違う。

### P-3 LOCKED の変化で前方更新が出るか (§4.12)

- 目的: 出力が変わらない LOCKED の反転でも、F へ近隣更新が届くこと。
- 配置: リピーター M (OFF・入力なし) の F に、準接続で BUD 状態にしたピストン (近隣更新が来れば伸びる)。M の側面にリピーター L。L を ON にして M をロックする。
- 観測: L が ON になった gt に、M の locked が true になり、ピストンが動き始めるか。
- 期待の要点: 動く。動かなければ、onPlace の読みか BUD の作りが違う。DELAY を回す操作でも同じ配置で測る (P-3b)。

### P-4 コンパレーターの反転時の前方更新 2 回

- 目的: 2 回目の前方更新が観測できる差を生むか。
- 配置: コンパレーターの F に導体、その上に BUD ピストン A、F の横に BUD ピストン B。1 回目の更新で A が伸びて F の周りの給電が変わり、2 回目の更新でだけ B が動く配置を作る。対照として、強さだけが変わる (POWERED が変わらない) 入力。
- 観測: コンパレーターが反転した gt に動くピストンの数と順。
- 期待の要点: 反転時は 2 回、強さだけの変化は 1 回。

### P-5 導体が 15 のときは B2 を読まない (§4.4)

- 目的: 「15 未満」の境界。
- 配置: 4 レーン。B は石、B2 は中身 3 の樽。石への給電を (a) なし、(b) ダストで弱く 14、(c) ダストで弱く 15、(d) リピーターで強く 15 にする。
- 観測: コンパレーターの出力値 (F のダストの POWER)。
- 期待の要点: (a) 3、(b) 3、(c) 15、(d) 15。[実機 1.21.1: comparator-through-conductor-replace] は 13 の場合だけなので、境界を足す。

### P-6 空の額縁で 0 に置き換わるか (§4.4)

- 目的: 額縁の値 0 が「無し」と区別されること。
- 配置: B は弱充電 10 の石。B の裏面に額縁。(a) 額縁なし、(b) 空の額縁、(c) アイテム入り・回転 0、(d) アイテム入り・回転 3、(e) 同じ面でなく B2 の別の面に貼った額縁、(f) (c) に加えて B2 に中身 9 の樽。
- 観測: コンパレーターの出力値。
- 期待の要点: (a) 10、(b) 0、(c) 1、(d) 4、(e) 10、(f) 9。額縁を扱わない間は、(a) と (e) だけが再現の対象。
- 注意: (f) は額縁と樽が同じマスに居る。普通には置けないので /summon で作る。外れるなら Fixed を付けるか、(f) を省く。

### P-7 側面入力の範囲

- 目的: §4.5 の表。
- 配置: subtract のコンパレーター (入力 15) の側面に、(a) 強く充電した石、(b) 出力がこちらを向くオブザーバー (パルス中)、(c) 先端が反対を向く帯電した避雷針、(d) 素通りするダスト (POWER 7)。
- 観測: 出力値。
- 期待の要点: (a) 15 (側面 0)、(b) パルス中 0、(c) 帯電中 0、(d) 8。避雷針は雷が要るので、/setblock で powered=true を置いて代える。

### P-8 ロックとコンパレーターの保持値 (§4.3)

- 目的: 側面のコンパレーターによるロックが「保持値 > 0」で決まること。
- 配置: リピーター M の側面にコンパレーター C (出力が M を向く)。(a) 通常の ON。(b) /setblock で powered=true・BlockEntity なしの C を置く。
- 観測: M の locked と、M の入力を切り替えたときの反応。
- 期待の要点: (a) ロックする。(b) ロックしない (保持値 0)。

### P-9 設置時の 1 gt 予約 (§4.13)

- 目的: プレイヤーの設置だけが 1 gt の予約を積むこと。
- 配置: 入力がすでに ON の位置へ、(a) 偽プレイヤーがリピーター (delay 4) を置く、(b) /setblock で置く。
- 観測: POWERED が true になる gt。
- 期待の要点: (a) 設置の 1 gt 後 (delay に関係なく)。(b) 近隣更新が来るまで OFF のまま。来たら delay × 2 gt 後。

### P-10 遅延中の DELAY 切り替え (§4.14)

- 目的: 積んだ予約の時刻が変わらないこと。
- 配置: delay 4 のリピーターに入力を入れ、2 gt 後に右クリックで delay 1 にする。
- 観測: ON になる gt。
- 期待の要点: 入力から 8 gt 後 (古い DELAY)。次の OFF は新しい DELAY に従う (2 gt)。

### P-11 撤去時の前方更新の有無と時点 [版差 1.21.1]

- 目的: §4.13 の撤去の表と §6.1 の差。26.x の実機が要る。
- 注意: 普通の /setblock は、26.3 でも後始末で撤去処理を呼ぶ。さらに P の 6 近傍へ近隣更新を出すので、F に置いた BUD は版に関係なく動く。**観測点は F ではなく F の隣 (P に接しない位置。F の上や F の先)** に置く。
- 配置 1 (有無): ON のリピーターの F は空気。F の上に BUD ピストン A (前方更新でしか届かない)。
- 配置 2 (時点): ON のリピーター P の F に、P を入力にするコンパレーター C (その F はダイオードでない → 予約は 2 gt・優先度 0)。P 自身を見るオブザーバー O (形状更新で 2 gt・優先度 0 の予約)。C と O の出力が、同じ gt に 1 つのマスを取り合う 2 本のピストンを動かすようにする ([実機 1.21.1: lever-nc-before-shape-race] と同じ見せ方)。
- 操作: (a) /setblock で P を空気に置き換える。(b) 26.x だけ: strict 指定で空気に置き換える。(c) /setblock の destroy 指定。
- 観測: 配置 1 は A が動くか。配置 2 は C と O の予約の順 (取り合うマスの勝者)。
- 期待の要点:
  - (a) 配置 1 は 1.21.1 も 26.3 も A が動く。配置 2 は、1.21.1 が C → O (前方更新が形状更新より先)、26.3 が O → C (形状更新が先、後始末の撤去処理が後)。
  - (b) A も C も O も動かない (strict は撤去処理も形状更新も後始末も出さない)。
  - (c) 両方の版で C → O (flag 3 の書き込みの中で、撤去処理が形状更新より先)。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §6

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| repeater の予約規則・tick・ロック・出力 15 | 本メモ §4.3・§4.7・§4.10 と同じ | 同じ | 既存が正しい |
| repeater「出力先が別ダイオードの背面/側面」で -3 | 同じ内容 | F がダイオードで、その FACING が「P から F への向き」と違う | 正しい。向かい合わせだけが外れる |
| repeater「LOCKED の更新は側面軸からの shape 更新時」 | 側面からだけ | 上下からの形状更新でも再計算する (FACING の軸でない向きすべて) | **26.3 が正**。真下が足場のままなら、下からでも再計算する。結果の値は同じなので、差が出るのは「契機」だけ |
| repeater の LOCKED 変化 | 前方更新に触れていない | LOCKED が変わる書き込みでも onPlace → 前方更新が出る | **追記が要る** [要実機] (P-3) |
| comparator の演算式・遅延・予約・側面の判定順 | 本メモ §4.5・§4.8 と同じ | 同じ | 既存が正しい |
| comparator 側面「リピーター/コンパレーター/オブザーバー」 | 3 種 | 避雷針 (横向き) も条件を満たす。レバー・ボタン・トリップワイヤーフックは向き次第で条件を満たすが、通常は置けない | 追記が要る (避雷針)。[要実機] (P-7) |
| comparator 背面「信号 < 15 かつ背面が導体なら 1 マス先のコンテナ/額縁」 | 置き換え | 同じ。額縁は「向きが FACING のものがちょうど 1 個」。額縁とブロックの両方があれば大きい方。空の額縁は 0 で置き換える | 既存は正しいが粗い。条件を追記する |
| comparator tick「POWERED を更新して前方更新」 | 回数に触れていない | POWERED が変わる tick は前方更新が 2 回。変わらなければ 1 回 | 追記が要る (16 §2.4 の表には「vanilla は 2 回」とある) |
| comparator「willTickThisTick を最外の条件として持つ (リピーターと同じ形)」 | 2 つは同じ形 | コンパレーターは最外。リピーターは ロック → 食い違い → willTickThisTick の順で、最外ではない (§5.11) | 結果は同じ (読み取りに副作用が無い)。「同じ形」は言い過ぎ |
| comparator の BlockEntity が無いとき | 記述なし | 保持値 0 として読み、tick でも値を保存しない (§3.2・§5.6) | 追記が要る |
| comparator のモード切り替え | 記述なし | 遅延なしでその場で決め直す | 追記が要る |
| 撤去・/setblock で出る前方更新 | 記述なし | §4.13 の表。/setblock は後始末で撤去処理を呼ぶ | 追記が要る (実機ハーネスの入力経路に効く) |
| 設置時の 1 gt 予約 | 記述なし | setPlacedBy が遅延 1・優先度 0 で積む | 追記が要る |

### 9.2 docs/research/16_nucleation-comparison.md §2.4・§3.1・§3.4

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| R-3 (検知レールのアナログ値で置き換え) | 26.2 の読みと実機で確定 | 26.3 も同じ (B のアナログ値は 15 にも勝つ) | 正しい |
| R-4 (導体越しは置き換え) | 同上 | 同じ | 正しい |
| R-5 (compare の空振りで前方更新) | 同上 | 同じ | 正しい |
| R-6 (tick の中の OFF は -2 固定) | 同上 | 同じ。ただし連鎖が先に予約を積む場合がある (§5.3) | 正しい。順の件は未検証 [要実機] (P-2) |
| R-7 (レバー/ボタンの更新順) | — | 担当外 (→ 09_manual-inputs.md)。レバーを直接読むコンパレーターの予約は §4.8 どおり優先度 0 | — |
| R-8 (ダストの接続) | RedStoneWireBlock#shouldConnectTo | 26.3 ではブロック側の shouldRedstoneWireConnectTo。リピーターは前後 2 面、コンパレーターは既定 | 典拠の名前が 26.3 で変わった。結果は同じ |
| §2.4「コンパレーター反転時の前方更新 1 回 (vanilla は 2 回)」 | sim は 1 回少ない | 26.3 も 2 回 (onPlace + 直接) | 記述は正しい。sim が未対応 (§9.3) |
| §3.4「26.2 の LevelChunk#setBlockState は、種類が変わったときしか撤去処理を呼ばない」 | — | 26.3 も同じ。加えて flag 1 かピストン移動が条件 | 正しい。条件を 1 つ足せる |
| §3.4「1.21.1 は state が変わるたびに onRemove と onPlace の両方」 | — | ダイオードの onRemove は「種類が変わったとき」だけ前方更新を出すので、ダイオードには 2 重送信は無い (トーチとは違う) | 正しい (ダイオードには当てはまらないことを明記するとよい) |

### 9.3 今の TS 実装 (packages/sim/src) との差

コードは変えない。Rust 版で直す候補として残す。

| # | TS の今の動き (world.ts) | 26.3 の読み | 影響 |
|---|---|---|---|
| D-1 | facing は「出力の向き」(blocks/repeater.ts) | FACING は「入力側の向き」 | 内部表現の違い。変換で吸収しているなら挙動は同じ。Rust では vanilla に合わせる |
| D-2 | LOCKED は近隣更新の中で再評価し、変われば形状更新だけ出す (「周囲へ再伝播しない」とコメント) | LOCKED は形状更新で再評価し、変われば onPlace の前方更新 (F へ 1 件 + 周り 5 件) も出る | F が BUD 状態のとき差が出る。LOCKED が変わる時点も違う (vanilla は側面のダイオードの書き込みの形状更新の中。TS は近隣更新が届いたとき) [要実機] (P-3) |
| D-3 | コンパレーターの反転で前方更新 1 回 | 2 回 (onPlace + 直接) | 16 §2.4 に既出。多くは空振り [要実機] (P-4) |
| D-4 | コンパレーターの tick: 「POWERED か出力値が違えば適用、そうでなく compare なら前方更新」 | 「出力値が違う、または compare」のときだけ POWERED を見る。subtract で値が同じなら、POWERED が食い違っていても何もしない | 構造物で食い違った状態を読み込んだときだけ差 (§5.6) |
| D-5 | コンパレーターの出力値の変化だけ (POWERED は同じ) のとき、形状更新は出さない (observableChanged が powered だけを見る)。前方更新は 1 回 | 同じ。blockstate は変わらないので形状更新は出ない。前方更新 1 回 | 差なし (確認済みとして残す) |
| D-6 | 額縁を読まない (readComparatorBack のコメントに「額縁は sim 未対応」) | B2 の額縁を読む | 範囲外として明記済み |
| D-7 | 側面入力は redstone_block → wire → getDirectSignal の順 | 同じ。getDirectSignal の前に isSignalSource の確認がある | TS の getDirectSignal が信号源以外に 0 を返すなら同じ。避雷針 (横向き) は TS に無い |
| D-8 | リピーターの入力は isFacePowered (導体の充電、またはその向きの信号)。ダストは「その向きへ接続していれば」POWER を返す (power.ts)。直読はしない。コンパレーター側 (readComparatorBack) は直読する | getSignal + ダストの POWER 直読 | ダストはリピーターの前後へ必ず接続するので、普通は同じ結果になる。接続の導出が vanilla とずれた場合にだけ差が出る (P-1 で押さえる) |
| D-9 | 設置時の 1 gt 予約 (setPlacedBy) が見当たらない | エンティティが置いたときだけ積む | エディタで置く操作を「プレイヤーの設置」とみなすなら要る (P-9) |
| D-10 | DELAY の切り替え・MODE の切り替えで出る更新 | DELAY は flag 3 (前方更新 + 自分の周り + 形状更新)。MODE は flag 2 + その場で refreshOutputState | TS の操作の経路は未確認。Rust では §4.14 どおりに |
| D-11 | tick の中の OFF 予約を、ON の適用のあとに積む | 同じ順。ただし適用の連鎖が先に同じ位置へ積んでいれば、そちらが残る | TS の schedule が重複を捨てるなら同じ。連鎖が apply の中で走り切るかどうかに依る (§5.3) |
| D-12 | 撤去時の前方更新 (TS の経路は未確認) | 書き込みの中で出るのは flag 1 があるときだけ。/setblock は書き込みのあとの後始末で出る。1.21.1 は常に書き込みの中 | 版で時点が分かれる。実機ハーネス (1.21.1) に合わせるか 26.3 に合わせるかを決める (→ 19_version-diffs.md) |
| D-13 | 出力値を blockstate 相当のフィールド (outputPower) に持ち、tick では powered と一緒に 1 回で書く | 出力値は BlockEntity。BlockEntity を先に書き、次に POWERED を書く。BlockEntity が無ければ出力は 0 | 通常は同じ。BlockEntity なしの状態 (§5.6) は TS では表せない |
| D-14 | コンパレーター更新を受けたとき、その場の状態で判定する | 連鎖の途中で積まれた更新は、積んだ時点の状態 (POWERED・MODE) で判定する (§4.6) | 連鎖の中でコンパレーターの状態が変わる配置でだけ差。まれ |

---

## 10. 典拠一覧

- 26.3 DiodeBlock#getStateForPlacement — FACING はプレイヤーの水平の向きの逆
- 26.3 DiodeBlock#canSurvive / #canSurviveOn — 真下の上面が RIGID で sturdy
- 26.3 DiodeBlock#tick — ロック中は何もしない。ON で入力なし → OFF。OFF → 必ず ON、入力なしなら遅延後・優先度 -2 の予約。書き込みは flag 2
- 26.3 DiodeBlock#neighborChanged — 同じ種類の確認、足場があれば checkTickOnNeighbor、無ければドロップ + 撤去 (flag 3) + 6 近傍を中心にした近隣更新
- 26.3 DiodeBlock#checkTickOnNeighbor — ロック → 食い違い → willTickThisTick の順。優先度 -3 / -2 / -1
- 26.3 DiodeBlock#shouldPrioritize — F がダイオードで、その FACING が「P から F への向き」と違う
- 26.3 DiodeBlock#isLocked — 既定は偽
- 26.3 DiodeBlock#shouldTurnOn — 入力 > 0
- 26.3 DiodeBlock#getInputSignal — B の getSignal。15 未満で B がダストなら POWER との大きい方
- 26.3 DiodeBlock#getAlternateSignal — 時計回り・反時計回りの側面の getControlInputSignal の大きい方
- 26.3 DiodeBlock#isSignalSource — 常に真
- 26.3 DiodeBlock#ownSignal / #getSignal / #getDirectSignal — POWERED かつ問われた向きが FACING のとき出力値。強い信号も同じ
- 26.3 DiodeBlock#getOutputSignal — 既定 15
- 26.3 DiodeBlock#setPlacedBy — shouldTurnOn なら遅延 1・優先度 0 の予約
- 26.3 DiodeBlock#onPlace — 無条件で updateNeighborsInFront
- 26.3 DiodeBlock#affectNeighborsAfterRemoval — ピストン移動でなければ updateNeighborsInFront
- 26.3 DiodeBlock#updateNeighborsInFront — F へ 1 件、F の周りへ FACING を除く 5 件
- 26.3 DiodeBlock#sideInputDiodesOnly — 既定は偽
- 26.3 DiodeBlock#isDiode — DiodeBlock の派生か
- 26.3 RepeaterBlock#useWithoutItem — mayBuild の確認、DELAY を回して flag 3
- 26.3 RepeaterBlock#getDelay — DELAY × 2
- 26.3 RepeaterBlock#getStateForPlacement — 設置時に LOCKED を計算
- 26.3 RepeaterBlock#updateShape — 下で足場なし → 空気。FACING の軸でない向きなら LOCKED を再計算
- 26.3 RepeaterBlock#shouldRedstoneWireConnectTo — FACING かその逆
- 26.3 RepeaterBlock#isLocked — 側面の値 > 0
- 26.3 RepeaterBlock#sideInputDiodesOnly — 真
- 26.3 RepeaterBlock#createBlockStateDefinition — facing・delay・locked・powered
- 26.3 ComparatorBlock#getDelay — 2
- 26.3 ComparatorBlock#updateShape — 下で足場なし → 空気
- 26.3 ComparatorBlock#getOutputSignal — BlockEntity の値。無ければ 0
- 26.3 ComparatorBlock#calculateOutputSignal — 入力 0 → 0、側面 > 入力 → 0、subtract は差、compare は入力
- 26.3 ComparatorBlock#shouldTurnOn — 入力 > 側面、または等しくて compare
- 26.3 ComparatorBlock#getInputSignal — B のアナログ値で置き換え。15 未満で B が導体なら B2 の額縁とブロックの大きい方で置き換え
- 26.3 ComparatorBlock#getItemFrame — B2 の箱の中で向きが FACING の額縁がちょうど 1 個のとき
- 26.3 ComparatorBlock#useWithoutItem — MODE を切り替えて flag 2、同じ種類なら refreshOutputState
- 26.3 ComparatorBlock#checkTickOnNeighbor — willTickThisTick → 出力値と保持値の差、または POWERED と点灯条件の差 → 遅延 2、優先度 -1 / 0
- 26.3 ComparatorBlock#refreshOutputState — 保持値を更新。値が違うか compare なら POWERED を合わせ (flag 2)、前方更新
- 26.3 ComparatorBlock#tick — refreshOutputState を呼ぶだけ
- 26.3 ComparatorBlock#triggerEvent — BlockEntity へ渡す
- 26.3 ComparatorBlock#createBlockStateDefinition — facing・mode・powered
- 26.3 ComparatorBlockEntity#saveAdditional / #loadAdditional — キー OutputSignal、欠けたら 0
- 26.3 ComparatorBlockEntity#getOutputSignal / #setOutputSignal — 検査なしの読み書き
- 26.3 ComparatorMode — compare・subtract の順
- 26.3 SignalGetter#getSignal — ブロック自身の値。導体なら getDirectSignalTo との大きい方
- 26.3 SignalGetter#getDirectSignalTo — 下・上・北・南・西・東の順、15 で打ち切り
- 26.3 SignalGetter#getControlInputSignal — ダイオードだけ / レッドストーンブロック 15 → ダストの POWER → 信号源の強い信号
- 26.3 SignalGetter#getBestOwnOrNeighbourSignal — ownSignal を向きなしで読む
- 26.3 Level#setBlock — flag 1 で近隣更新とコンパレーター更新、flag 16 が無ければ形状更新
- 26.3 Level#removeBlock — flag 3 (ピストンなら + 64)
- 26.3 Level#destroyBlock — flag 3
- 26.3 Level#updateNeighbourForOutputSignal — 水平 4 方向、隣か導体越しの comparator へ直接届ける
- 26.3 LevelChunk#setBlockState — BlockEntity の撤去 → 撤去処理 (種類が変わり、flag 1 かピストン移動) → onPlace (flag 512 が無ければ毎回) → BlockEntity の作成
- 26.3 ServerLevel#tickBlock — 予約した種類と同じブロックのときだけ tick
- 26.3 LevelTicks#willTickThisTick / #runCollectedTicks — 実行待ちの集合。実行の直前に外す
- 26.3 LevelChunkTicks#schedule / #poll — 位置 + 種類で重複排除。取り出しで外す
- 26.3 NeighborUpdater の UPDATE_ORDER — 西・東・下・上・北・南
- 26.3 CollectingNeighborUpdater#neighborChanged / #updateNeighborsAtExceptFromFacing — 単発更新と複数更新
- 26.3 ItemFrame#getAnalogOutput — 空なら 0、あれば (回転 mod 8) + 1
- 26.3 ItemFrame の setItem・setRotation — 額縁の位置を起点にコンパレーター更新
- 26.3 ItemFrame#survives — ブロックと重なると外れる (Fixed は除く)。取り付け先は固体か、水平の向きならダイオード
- 26.3 Blocks の REPEATER・COMPARATOR — 押し反応 POPPED
- 26.3 PistonBaseBlock#moveBlocks — 壊すブロックを flag 18 で空気にし、あとで撤去処理を明示的に呼ぶ
- 26.3 BlockItem#canPlace / #placeBlock / #place — 足場の確認、flag 11 の書き込み、そのあと setPlacedBy
- 26.3 SetBlockCommand / BlockInput#place — 形状に合わせた状態を flag 258 (strict は 818) で書く
- 26.3 ServerLevel#updateNeighboursOnBlockSet — 種類が変わっていれば古い状態の撤去処理、次に 6 近傍へ近隣更新
- 26.3 LevelAccessor#createTick / Level#nextSubTickCount — 予約を積む時点で通し番号を取る
- 26.3 CollectingNeighborUpdater の状態つき更新 — コンパレーター更新は積んだ時点の状態を運ぶ
- 26.3 Block#updateOrDestroy — 形状更新の結果が空気なら Level#destroyBlock、そうでなければ flag から 32 を落として書く
- 26.3 ObserverBlock#tick — 書き込み → 2 gt の予約 → 前方更新の順 (§5.8 の前提)
- 1.21.1 DiodeBlock#onRemove / LevelChunk#setBlockState — 撤去時の前方更新が flag に依らない (版差)
