# 05 信号モデルとブロックの性質表 (Java 版 26.3)

対象は Java 版 26.3。確かさは [26.3 読解] / [実機 1.21.1: fixture 名] / [要実機] / [版差 1.21.1] [版差 26.4-pre-1] で書く。

表の件数 (ブロック数・状態数・一覧の件数) は、26.3 の Blocks を読んで作ったうえで、§3.7 の手順で server.jar から書き出した
全状態の表 (以下「状態ダンプ」) と全件照合した。状態ダンプは手元で実行して測ったデータで、デコンパイルの写しではない。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| 区分 | クラス (net/minecraft からの相対) | 見たところ |
|---|---|---|
| 信号の読み方 | SignalGetter (world/level) | 全メソッド |
| | Level・LevelReader (world/level) | LevelReader が SignalGetter を継承する。Level#getBlockState の範囲外、Level#updateNeighbourForOutputSignal の導体判定 |
| 性質の定義 | BlockBehaviour (world/level/block/state) | 信号フックの既定、Properties、BlockStateBase、Cache、calculateSolid |
| | Blocks (world/level/block) | 全登録、ヘルパー (leavesProperties・pistonProperties・shulkerBoxProperties ほか)、static 初期化 |
| | ColorCollection・WeatheringCopperCollection (world/level/block) | 色・酸化段階つきの登録の順 |
| | Block (world/level/block) | 既定の状態、状態 ID、isShapeFullBlock |
| 状態 | StateDefinition・StateHolder (world/level/block/state) | 状態の並び、cycle |
| | BooleanProperty・IntegerProperty・EnumProperty・BlockStateProperties と各 enum (world/level/block/state/properties) | 値の並び |
| 定数 | Redstone (world/level/redstone)、PushReaction (world/level/material) | |
| 押し反応の解釈 | PistonBaseBlock#isPushable (world/level/block/piston) | 判定の順だけ。構造解決は 13 |
| 信号源 | 信号フックを持つ 20 クラス (§4.3) | 出力の向きと値 |
| 動く形 | ShulkerBoxBlock・ShulkerBoxBlockEntity・Shulker#getProgressAabb、MovingPistonBlock・PistonMovingBlockEntity#getCollisionShape | 当たり判定が BE で変わる所 (導体の判定に効く) |
| 性質の使い手 | RailBlock#updateState・NaturalSpawner (isSignalSource)、FlowingFluid#getNewLiquid・BucketItem#emptyContents・FallingBlock#isFree (solid・replaceable) | 効く所だけ |
| 支え | SupportType と各素子の canSurvive、LeavesBlock#getBlockSupportShape | 支えの種類だけ |
| 順序 | Direction・IdMapper・MappedRegistry (core) | 方向の順、ID の振り方 |
| 状態表 | Main・DataProvider (data)、BlockListReport (data/info) | reports の中身 |

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| setBlock・近隣更新・形状更新・コンパレーター更新 | → 04_set-block-and-updates.md |
| ダスト / リピーター・コンパレーター / トーチ・オブザーバー・レッドストーンブロックの動作 | → 06_redstone-wire.md / 07_diodes.md / 08_torch-observer-redstone-block.md |
| 手動入力 / スカルク / 出力素子 / ディスペンサー・ドロッパー・クラフター | → 09_manual-inputs.md / 10_sculk.md / 11_outputs.md / 12_dispenser-dropper-crafter.md |
| ピストンの構造解決と移動 / アナログ値の全表 / レール | → 13_pistons.md / 14_containers-hoppers-analog.md / 15_rails.md |
| 流体 (流されるかの詳細) / エンティティの押し反応と検知 | → 16_fluids-falling-blocks.md / 17_entities-interplay.md |
| 反復順・整数の意味論 / 版差の総まとめ | → 18_determinism-java-semantics.md / 19_version-diffs.md |

---

## 2. 全体像

### 2.1 信号の 2 系統

- 信号は 0〜15 の整数である。Redstone の定数は最小 0・最大 15・なし 0。26.2 からは 4 ビット・マスク 15 の定数も持つ。
- ブロックが隣へ出す信号は 2 系統ある。

| 系統 | フック | 届く先 |
|---|---|---|
| 弱い信号 | BlockBehaviour#getSignal (既定は ownSignal を返す。ownSignal の既定は 0) | 隣の読み手 (素子・ダスト)。導体はこれで充電されない |
| 強い信号 | BlockBehaviour#getDirectSignal (既定 0) | 隣の導体。導体はこれを自分の信号として周りの読み手に見せる |

- 導体 (isRedstoneConductor が真) は、自分の弱い信号と、周り 6 マスの強い信号の最大の大きい方を見せる。自分の弱い信号はほとんどの導体で 0 である
  (例外は target・jukebox・test_block。§5 の 4)。getDirectSignal を持つ 13 クラスはどれも導体でない (状態ダンプ) ので、中継は 1 段だけである。
- 信号源 (isSignalSource が真) は「ダストが繋がるか」「ダイオードの側面入力になるか」を決める印である。getSignal は信号源かどうかを見ない (§5)。
  ほかの使い手は 3 つ: 通常レールの向きの決め直し (RailBlock#updateState: 更新を送ってきたブロックの既定の状態が信号源で、つながり候補が 3 つのとき)、
  SignalGetter#getBestOwnOrNeighbourSignal、湧きの判定 (NaturalSpawner#isValidEmptySpawnBlock: 信号源の中には湧かない)。[26.3 読解]
- ダストの isSignalSource は shouldSignal をそのまま返す (RedstoneWireBlock#isSignalSource)。ダストの評価中 (getBlockSignal の中) だけ偽になる (§4.3・§5 の 7)。

### 2.2 向きの約束

- 信号のフックに渡す向きは「読み手から源へ向かう向き」である。源から見ると、読み手は渡された向きの反対側にいる。
  - 例: 床置きトーチの getSignal は、向きが上 (= 読み手がトーチの下の土台) のときだけ 0 を返す。
- 方向の順は Direction.values() = 下・上・北・南・西・東。水平の順は Direction.Plane.HORIZONTAL = 北・東・南・西。[26.3 読解: Direction]

### 2.3 Level が隣から信号を読む手順 (SignalGetter#getSignal)

引数は「源の位置」と「読み手から源への向き」である。

1. 源の位置の状態を取る。範囲外 (高さの外と、チャンク座標の上限の外) は void_air になる。[26.3 読解: Level#getBlockState・#isInValidBounds]
2. その状態の getSignal に位置と向きを渡し、弱い信号 s を得る。
3. その状態が導体 (isRedstoneConductor にその位置を渡して真) なら、getDirectSignalTo (源の位置) と s の大きい方を返す。
4. 導体でなければ s を返す。

getDirectSignalTo (位置 p) は次のとおり。[26.3 読解: SignalGetter#getDirectSignalTo]

1. r = 0 とする。
2. 下・上・北・南・西・東の順に、p の隣 q と向き d (p から q への向き) について、q の状態の getDirectSignal (q, d) を求め、r との大きい方を r にする。
3. r が 15 以上になったら、その場で r を返す。
4. 6 方向を見終えたら r を返す。

- 6 マスには、問い合わせてきた読み手自身も入る (§5)。
- 減衰はない。強さ 12 を受けた導体は 12 を見せる。[実機 1.21.1: target-conduct] (4 本目のダスト 12 が指す target を、隣のコンパレーターが 12 のまま読む)。
  材質ごとの導通は [実機 1.21.1: strong-charge-through-conductors] (リピーターの 15 なので減衰の裏づけにはならない)。
- 問い合わせは純関数である。どの素子の getSignal も世界を書き換えない。順序は早期終了の位置にしか効かない。
- この手順は SignalGetter の既定のメソッドそのもので、Level もサーバーの世界も上書きしない (26.3 で SignalGetter を参照するのは LevelReader・PistonBaseBlock・DiodeBlock だけ)。[26.3 読解]

### 2.4 読み方 7 種と使う素子

| メソッド (SignalGetter) | 返すもの | 主な利用者 (26.3) |
|---|---|---|
| hasNeighborSignal (位置) | 6 方向の getSignal のどれかが 0 より大きいか | ランプ・音符ブロック・TNT・ドア・トラップドア・フェンスゲート・ベル・大きなドリップリーフ・銅の電球・クラフター・ディスペンサー/ドロッパー・ホッパー・レールの向き決め・パワードレール・コマンドブロック・ストラクチャーブロック・テストブロック・棚・頭 |
| hasSignal (位置, 向き) | getSignal (位置, 向き) > 0 | トーチ (土台)、壁トーチ (取り付け先)、ピストン (§4.5) |
| getSignal (位置, 向き) | §2.3 | DiodeBlock#getInputSignal (背面)、CalibratedSculkSensorBlockEntity (背面) |
| getBestNeighborSignal (位置) | 6 方向の getSignal の最大 (15 で打ち切り) | RedstoneWireBlock#getBlockSignal (→ 06) |
| getControlInputSignal (位置, 向き, ダイオードだけか) | ダイオードの側面入力 (§4.1) | DiodeBlock#getAlternateSignal (→ 07) |
| getDirectSignalTo (位置) | 6 方向の getDirectSignal の最大 | getSignal の導体分岐だけ |
| getBestOwnOrNeighbourSignal (位置) | 自分の信号 (信号源のとき) と getBestNeighborSignal の大きい方 | SulfurCube (エンティティ。→ 17) |

---

## 3. 状態とデータ

### 3.1 信号に効く blockstate のプロパティ (BlockStateProperties)

値はこの順に並ぶ (この順が状態の並びと cycle の順になる)。

| 定数名 | 名前 | 値 (この順) | 主な持ち主 |
|---|---|---|---|
| POWER | power | 0〜15 | redstone_wire, target, daylight_detector, sculk_sensor, calibrated_sculk_sensor, 重量感圧板 2 種 |
| POWERED | powered | true, false | repeater, comparator, observer, lever, ボタン, 感圧板 (重量以外), detector/powered/activator_rail, tripwire, tripwire_hook, lectern, lightning_rod, note_block, ドア, トラップドア, フェンスゲート, copper_bulb, bell |
| LIT | lit | true, false | redstone_torch, redstone_wall_torch, redstone_lamp, copper_bulb |
| DELAY / LOCKED | delay / locked | 1〜4 / true, false | repeater |
| MODE_COMPARATOR | mode | compare, subtract | comparator |
| EXTENDED / SHORT | extended / short | true, false | piston・sticky_piston / piston_head |
| PISTON_TYPE | type | normal, sticky | piston_head, moving_piston |
| TRIGGERED / CRAFTING | triggered / crafting | true, false | dispenser, dropper, crafter / crafter |
| ENABLED | enabled | true, false | hopper |
| INVERTED | inverted | true, false | daylight_detector |
| ATTACHED / DISARMED | attached / disarmed | true, false | tripwire_hook・tripwire / tripwire |
| NORTH_REDSTONE ほか 4 つ | north, east, south, west | up, side, none | redstone_wire |
| SCULK_SENSOR_PHASE | sculk_sensor_phase | inactive, active, cooldown | スカルクセンサー 2 種 |
| NOTE / NOTEBLOCK_INSTRUMENT | note / instrument | 0〜24 / harp … custom_head の 27 値 | note_block |
| HAS_BOOK / HAS_RECORD | has_book / has_record | true, false | lectern / jukebox |
| ATTACH_FACE | face | floor, wall, ceiling | lever, ボタン |
| RAIL_SHAPE / RAIL_SHAPE_STRAIGHT | shape | 10 値 / 曲がりを除く 6 値 | rail / 他のレール 3 種 |
| ORIENTATION | orientation | 12 値 | crafter |
| OPEN / TILT / UNSTABLE | open / tilt / unstable | true, false / none, unstable, partial, full / true, false | ドア類・樽 / big_dripleaf / tnt |

### 3.2 値の並びの規則

| 種類 | 並び | 典拠 [26.3 読解] |
|---|---|---|
| BooleanProperty | true, false (添字 0 が true) | BooleanProperty#getPossibleValues |
| IntegerProperty | 最小〜最大の昇順 (添字 = 値 − 最小) | IntegerProperty の生成 |
| EnumProperty (指定なし・述語つき) | enum の宣言順から述語で絞ったもの | EnumProperty#create |
| EnumProperty (値の列を指定) | 指定した順 | 同上 |
| FACING | north, east, south, west, up, down (列で指定) | BlockStateProperties |
| HORIZONTAL_FACING | **north, south, west, east** (Direction の宣言順を Plane.HORIZONTAL で絞る) | 同上。Plane は述語でもある |
| FACING_HOPPER | down, north, south, west, east (上を除く) | 同上 |
| VERTICAL_DIRECTION | up, down | 同上 |
| AXIS / HORIZONTAL_AXIS | x, y, z / x, z | 同上 |

- 水平の向きの値の並び (北・南・西・東) は、Direction.Plane.HORIZONTAL の反復の順 (北・東・南・西) と違う。混同しやすい。
- StateHolder#cycle は「値の並びで次の値、末尾なら先頭」へ進める。レバー (POWERED: true → false → true)、リピーター (DELAY: 1→2→3→4→1)、
  コンパレーター (MODE)、日照センサー (INVERTED)、音符ブロック (NOTE: 0→…→24→0)、ランプと銅の電球 (LIT)、ドアとトラップドア (OPEN) が使う。
  [26.3 読解: StateHolder#cycle・#findNextInCollection と各ブロックの呼び出し]

### 3.3 状態の並び・既定・状態 ID

[26.3 読解: StateDefinition のコンストラクタ, Block のコンストラクタ, Blocks の static 初期化, IdMapper#add]

1. ブロックのプロパティを**名前の辞書順**に並べる (ImmutableSortedMap)。比べ方は Java の文字列の自然順 (UTF-16 の符号単位の順) で、
   数字 < 下線 < 小文字になる (例: has_bottle_0 < has_bottle_1、face < facing)。名前は ASCII だけなので、Rust の str の順と同じになる。
2. 状態の並びは、値の直積 (Guava の cartesianProduct) の順である。**名前が最後のプロパティが一番速く回る**。
3. ブロック内の状態の添字は混合基数で求まる。名前順に p1…pn、各値の添字 v1…vn、値の個数 c1…cn とすると、添字は
   v1 を最上位桁とする混合基数 ((v1 × c2 + v2) × c3 + v3 …) になる。
4. 既定の状態は、ブロックのコンストラクタが registerDefaultState で決めたものである。決めなければ最初の状態 (全プロパティが最初の値) になる。
   26.3 では 1286 ブロック中 746 で既定が最初の状態ではない。
5. 状態 ID は、Blocks の static 初期化で振られる。登録順 (BuiltInRegistries.BLOCK の並び = 登録した順) にブロックを回し、
   各ブロックの状態をその並びで IdMapper に足す。ID は air の 0 から連番で、ブロック内では連続する。
   引けない ID は Block#stateById が air の既定の状態にし、登録に無い状態は Block#getId が 0 にする。
6. 色つきの登録 (ColorCollection) は white, orange, magenta, light_blue, yellow, lime, pink, gray, light_gray, cyan, purple, blue,
   brown, green, red, black の順。銅の登録 (WeatheringCopperCollection) は無印・exposed・weathered・oxidized の 4 段、続いて waxed の 4 段の順。

例: 26.3 の redstone_wire はプロパティ east, north, power, south, west (3・3・16・3・3 値)、1296 状態、最初の ID は 5567。
既定 (四方 none・power 0) の添字は 2×432 + 2×144 + 0×9 + 2×3 + 2 = 1160 で、ID は 6727 になる。

この式は reports の blocks.json の全状態 (1.21.1・26.2・26.3・26.4-pre-1 の 4 版すべて) と一致した。

### 3.4 主な素子の状態 (26.3。reports から)

| ブロック | 状態数 | プロパティ (名前順) | 既定 |
|---|---|---|---|
| redstone_wire | 1296 | east, north, south, west (up/side/none)・power 0〜15 | 四方 none・power 0 |
| repeater | 64 | delay 1〜4・facing (北南西東)・locked・powered | delay 1・north・false・false |
| comparator | 16 | facing・mode・powered | north・compare・false |
| redstone_torch / redstone_wall_torch | 2 / 8 | lit / facing・lit | lit=true / north・true |
| observer | 12 | facing (6 方向)・powered | **south**・false |
| lever / stone_button | 24 / 24 | face・facing・powered | wall・north・false |
| stone_pressure_plate / light_weighted_pressure_plate | 2 / 16 | powered / power | false / 0 |
| tripwire_hook / tripwire | 16 / 128 | attached・facing・powered / attached・disarmed・east・north・powered・south・west | 全部 false (向きは north) |
| detector_rail・powered_rail・activator_rail / rail | 24 / 20 | powered・shape (6 値)・waterlogged / shape (10 値)・waterlogged | false・north_south・false |
| daylight_detector / target | 32 / 16 | inverted・power / power | false・0 / 0 |
| lectern / trapped_chest | 16 / 24 | facing・has_book・powered / facing・type・waterlogged | north・false・false / north・single・false |
| lightning_rod | 24 | facing (6 方向)・powered・waterlogged | **up**・false・false |
| sculk_sensor / calibrated_sculk_sensor | 96 / 384 | power・sculk_sensor_phase・waterlogged / facing も | 0・inactive・false (向きは north) |
| jukebox / redstone_lamp / copper_bulb | 2 / 2 / 4 | has_record / lit / lit・powered | false / false / false・false |
| note_block | 1350 | instrument (27 値)・note 0〜24・powered | harp・0・false |
| piston・sticky_piston / piston_head / moving_piston | 12 / 24 / 12 | extended・facing / facing・short・type / facing・type | false・north / north・false・normal / north・normal |
| dispenser・dropper / crafter / hopper | 12 / 48 / 10 | facing・triggered / crafting・orientation・triggered / enabled・facing | north・false / false・north_up・false / true・down |

### 3.5 BE が持つ信号の値

| BE | 持つ値 | 信号での使われ方 | 参照 |
|---|---|---|---|
| ComparatorBlockEntity | 出力値 (整数) | ComparatorBlock#getOutputSignal。出力は POWERED のときだけ見える | → 07 |
| JukeboxBlockEntity | 再生中か | JukeboxBlock#ownSignal が再生中 15 | → 09 |
| ChestBlockEntity (トラップチェスト) | 開いている人数 | TrappedChestBlock#ownSignal が 0〜15 に丸めて出す | → 09 |
| ShulkerBoxBlockEntity | 開き具合 | 当たり判定が変わり、導体かどうかが変わる (§4.4) | 本書 |
| TestBlockEntity | powered | TestBlock#ownSignal (START モードのとき) | (開発用) |
| その他 (コンテナ・書見台・クラフターなど) | 中身 | アナログ出力だけ | → 14 |

### 3.6 Properties に持つ性質と既定値

[26.3 読解: BlockBehaviour.Properties の各メソッド, BlockStateBase のコンストラクタ]

| Properties のメソッド | 既定 | 効くところ |
|---|---|---|
| isRedstoneConductor (述語) | 当たり判定がちょうど 1 ブロック (BlockStateBase#isCollisionShapeFullBlock) | 導体 (§4.4) |
| pushReaction (値) | PUSH_PULL | ピストン (§4.6)。状態によらずブロックに 1 つ |
| strength / destroyTime | 0 | 硬さ −1 はピストンで動かない |
| replaceable () | 偽 | 置き換えられるか (§4.7) |
| forceSolidOn () / forceSolidOff () | 偽 | legacy solid の強制 (§4.7) |
| noCollision () | 当たり判定あり | 当たり判定と遮蔽を消す。導体にならない。legacy solid も forceSolidOn が無ければ偽 (感圧板は noCollision と forceSolidOn の両方を持ち、solid は真) |
| dynamicShape () | 偽 | 形のキャッシュを持たない。導体を毎回その位置で計算する |
| air () / liquid () | 偽 | 空気 (ピストンは素通り) / 流体扱い |
| randomTicks () | 偽 | ランダム tick (→ 01) |
| instrument (値) | HARP | 上の音符ブロックの音色 (→ 11) |

- Properties#ofFullCopy は導体の述語も写す。Properties#ofLegacyCopy は導体の述語を**写さない** (既定に戻る)。押し反応・replaceable・forceSolid はどちらも写す。
- 26.3 で ofFullCopy の元になるのは、羊毛・コンクリート・sulfur・cinnabar の系統 (階段の registerStair と potent_sulfur)、
  copper_block と cut_copper (切り込み・模様入り・切り込みの階段とスラブ) だけで、どれも述語は既定である。
  他のスラブ・塀・古い階段 (registerSlab・registerWall・registerLegacyStair) は ofLegacyCopy なので、述語は必ず既定である。

### 3.7 状態表の作り方

**A. 状態の一覧 (名前・プロパティ・値の並び・既定・ID) は reports で作れる。** [26.3 読解: data の Main#main, BlockListReport#run, DataProvider#saveStable]

1. 26.x は JDK 25、1.21.1 は JDK 21 以上を用意する (server.jar の中の version.json の java_version が 1.21.1 は 21、26.2〜26.4-pre-1 は 25)。
2. 空の作業フォルダで、server.jar を、システムプロパティ bundlerMainClass に net.minecraft.data.Main を指定して起動する。
   引数は --reports と --output 出力先。作業フォルダには bundler が展開する libraries/・versions/ と、ログの logs/ ができる
   (bundler の Main がこのプロパティ名を読むことは jar 内の文字列で確かめた)。
3. 出力先の reports/blocks.json ができる。26.3 は 1286 ブロック・35,723 状態で、生成器の処理は 2 秒かからない。
   1.21.1・26.2・26.4-pre-1 も同じ手順で作れた。
4. blocks.json の形: キーは登録名。properties は名前 → 値の配列 (値の並び §3.2)。states は §3.3 の並びの配列で、
   各要素に id (Block#getId)・properties・既定なら default=true が付く。

blocks.json の注意:

- 書き出しで JSON のキーが並べ替えられる (DataProvider の KEY_COMPARATOR: type → parent → 残りを名前順)。
  ブロックは名前順に並び、登録順ではない。登録順が要るなら各ブロックの最初の id で並べ直す。
- プロパティ名 type も先頭に来る (moving_piston・piston_head・スラブ・チェスト類)。添字の計算は名前順に並べ直してから行う。
- 26.2 までは各ブロックに definition (ブロックの型の名前と Properties の一部) もあった。26.3 で無くなった。[版差 26.2→26.3]

**B. 性質の表 (導体・信号源・押し反応など) は reports に無い。** 次の手順で書き出した。

1. 同じ jar と libraries をクラスパスに置いた自作の小さな Java プログラムで、SharedConstants#tryDetectVersion と Bootstrap#bootStrap を呼ぶ。
2. BuiltInRegistries.BLOCK を順に回し、各状態について isRedstoneConductor・isSignalSource・getPistonPushReaction・getDestroySpeed・
   hasBlockEntity・canBeReplaced・isSolid・isCollisionShapeFullBlock・isFaceSturdy (上・下)・hasAnalogOutputSignal を問い、TSV に書く。
   取得器は空のブロック取得器 (EmptyBlockGetter)、位置は原点にする。
3. 1.21.1 は難読化されているので、tools/decompile が公式 mappings で作った再マップ済み jar を先に置く。
4. 動的形状のブロックは「BE なし」の答えになる。シュルカーボックスは閉じた状態の答え (導体) になるので、開いた状態の扱いは別に持つ (§4.4)。
   moving_piston は当たり判定が空の答えになるが、上書きで常に非導体なので表の値はそのまま使える (§4.4.2)。
   ダストの信号源の列は shouldSignal が真のときの値 (真) である (§2.1)。
5. 書き出した値 (自前のデータ) だけを使い、jar とデコンパイル結果は持ち出さない (docs/ip-policy.md)。

---

## 4. 処理の詳細

### 4.1 SignalGetter のメソッド

[26.3 読解: SignalGetter の各メソッド]

| メソッド | 引数 | 定義 |
|---|---|---|
| getDirectSignal | 位置 q, 向き d | q の状態の getDirectSignal (q, d) |
| getDirectSignalTo | 位置 p | §2.3 の手順 (下・上・北・南・西・東、15 で打ち切り) |
| getSignal | 位置 q, 向き d | §2.3 の手順 (導体なら getDirectSignalTo と大きい方) |
| hasSignal | 位置 q, 向き d | getSignal (q, d) > 0 |
| hasNeighborSignal | 位置 p | 下・上・北・南・西・東の順に、隣 q と向き d で getSignal (q, d) > 0 を調べ、最初に真になった所で真 |
| getBestNeighborSignal | 位置 p | Direction.values() の順に getSignal (隣, 向き) を求め、15 以上が出たらその場で 15、でなければ最大 |
| getControlInputSignal | 位置 q, 向き d, ダイオードだけか | 下の手順 |
| getBestOwnOrNeighbourSignal | 位置 p | getBestNeighborSignal (p) と、p の状態が信号源なら BlockStateBase#getOwnSignal の大きい方 |

getControlInputSignal の手順 (q はダイオードの左右の隣、d はダイオードから q への向き):

1. ダイオードだけ (リピーターが渡す) なら、q がダイオード (DiodeBlock#isDiode: リピーターかコンパレーター) のとき getDirectSignal (q, d)、それ以外は 0。
2. そうでない (コンパレーターが渡す) とき、q が redstone_block なら 15。[実機 1.21.1: comparator-side-redstone-block]
3. q が redstone_wire なら、その POWER をそのまま返す。ダストの形も接続の向きも見ない。
4. q が信号源なら getDirectSignal (q, d)、でなければ 0。導体は信号源でないので 0 である。

- 4 は強い信号しか見ない。レバー・ボタン・トーチ・感圧板・ターゲット・日照センサーを横に置いても側面入力にならない
  (強い信号の向きが合わない、または強い信号を出さない)。[26.3 読解] (トーチとレバーは [実機 1.21.1: comparator-side-reject])
- 側面のダイオードは、前 (出力) がこちらを向いているときだけ効く。オブザーバーは背面がこちらを向いていれば 15 が効く。
- 避雷針は支えが要らないので、根元をコンパレーターの側面に向けて置ける。その向きなら、雷で POWERED の間は側面入力 15 になる
  (LightningRodBlock#getDirectSignal は根元の側にだけ 15)。[26.3 読解]

### 4.2 BlockBehaviour の信号フックの既定

[26.3 読解: BlockBehaviour と BlockStateBase の同名メソッド]

| フック | 既定 | 備考 |
|---|---|---|
| isSignalSource | 偽 | |
| getSignal | ownSignal を返す (向きを見ない) | 26.2 から。1.21.1 は既定 0 で、各ブロックが getSignal を上書きしていた (結果は同じ) |
| ownSignal | 0 | BlockStateBase#getOwnSignal から呼ばれる |
| getDirectSignal | 0 | |
| shouldRedstoneWireConnectTo | 信号源で、かつ向きが与えられている | 26.3 から。上書きは RedstoneWireBlock (常に真)・RepeaterBlock (前後の軸)・ObserverBlock (背面だけ)。ダストの上下の問い合わせは向きなしなので、ダスト以外は繋がらない → 06 |
| hasAnalogOutputSignal / getAnalogOutputSignal | 偽 / 0 | → 14 |
| isRedstoneConductor | Properties の述語 (§4.4) | |
| getPistonPushReaction | Properties の値をそのまま返す | ブロック側の上書き口は無い (§4.6) |

### 4.3 信号源の全表 (26.3)

[26.3 読解: 各クラスの getSignal・ownSignal・getDirectSignal・isSignalSource・shouldRedstoneWireConnectTo]
26.3 で isSignalSource が真のブロックは 57 種 (状態ダンプ)。「取り付け先」は素子が付いている支えのブロックを指す。

| クラス (26.3) | ブロック | 弱い信号 (getSignal) | 強い信号 (getDirectSignal) | ダストの接続 |
|---|---|---|---|---|
| RedstoneWireBlock | redstone_wire | POWER。読み手が真上なら 0。真下 (足元) には POWER。水平は、その場で計算し直した接続形状がその読み手を向くときだけ POWER。shouldSignal が偽の間は 0 | getSignal と同じ (shouldSignal が偽の間は 0) | 常に繋がる。isSignalSource も shouldSignal を返す (評価中は偽) |
| RedstoneTorchBlock | redstone_torch | LIT なら 15。読み手が土台 (真下) のときだけ 0 | 真上の読み手にだけ 15 (LIT のとき) | 既定 |
| RedstoneWallTorchBlock | redstone_wall_torch | LIT なら 15。読み手が取り付け先のときだけ 0 | 継承。真上の読み手にだけ 15 | 既定 |
| DiodeBlock (RepeaterBlock・ComparatorBlock) | repeater, comparator | 前の読み手にだけ ownSignal (POWERED のとき getOutputSignal: リピーター 15、コンパレーターは BE の値) | getSignal と同じ | repeater は前後の軸だけ、comparator は既定 |
| ObserverBlock | observer | 背面の読み手にだけ、POWERED なら 15 | getSignal と同じ | 背面だけ |
| PoweredBlock | redstone_block | 15 (全方向) | 0 | 既定 |
| LeverBlock・ButtonBlock | lever, ボタン 15 種 | POWERED なら 15 (全方向) | 取り付け先にだけ 15 | 既定 |
| BasePressurePlateBlock | 感圧板 17 種 | 板の値を全方向 (PressurePlateBlock は POWERED なら 15、WeightedPressurePlateBlock は POWER) | 真下にだけ同じ値 | 既定 |
| TripWireHookBlock | tripwire_hook | POWERED なら 15 (全方向) | 取り付け先 (FACING の反対側) にだけ 15 | 既定 |
| LightningRodBlock (+ WeatheringLightningRodBlock) | lightning_rod ほか銅の 8 種 | POWERED なら 15 (全方向) | 根元 (FACING の反対側) にだけ 15 | 既定 |
| DetectorRailBlock | detector_rail | POWERED なら 15 (全方向) | 真下にだけ 15 | 既定 |
| LecternBlock | lectern | POWERED なら 15 (全方向) | 真下にだけ 15 | 既定 |
| TrappedChestBlock | trapped_chest | 開いている人数 (0〜15) を全方向 | 真下にだけ同じ値 | 既定 |
| SculkSensorBlock | sculk_sensor | POWER (全方向) | 真下にだけ同じ値 | 既定 |
| CalibratedSculkSensorBlock | calibrated_sculk_sensor | POWER。入力を読む背面の読み手だけ 0 | 継承。真下にだけ | 既定 |
| TargetBlock | target | POWER (全方向) | 0 | 既定 |
| DaylightDetectorBlock | daylight_detector | POWER (全方向) | 0 | 既定 |
| JukeboxBlock | jukebox | 再生中なら 15 (全方向。BE を読む) | 0 | 既定 |
| TestBlock (信号源ではない) | test_block | START モードで BE が powered なら 15 (全方向) | 0 | 繋がらない |

- 強い信号の列の値は、弱い信号が出ているとき (POWERED・LIT が真のとき) だけ出る。

裏づけ: レバーは取り付け先を強充電し [実機 1.21.1: qc-noteblock-strong]、横へは強い信号を出さない [実機 1.21.1: comparator-side-reject]。感圧板は真下だけ [実機 1.21.1: pressure-plate-stone]、
検知レールは全方向の弱 15 と真下の強 15 [実機 1.21.1: detector-rail-cart-pulse]、ダストは真上に出さない [実機 1.21.1: dust-cross-powering]、
直線ダストは延長端に出し垂直には出さない [実機 1.21.1: dust-line-powering]、トーチは土台の弱充電で消える [実機 1.21.1: torch-not-floor]。

### 4.4 導体の判定

#### 4.4.1 既定 [26.3 読解: Properties の isRedstoneConductor の既定値, BlockStateBase#isCollisionShapeFullBlock, BlockStateBase の Cache, Block#isShapeFullBlock]

1. 既定の述語は BlockStateBase#isCollisionShapeFullBlock である。
2. 動的形状でないブロックは、状態ごとの Cache の値を返す。Cache は初期化時に、空のブロック取得器と原点で当たり判定を計算し
   (衝突の文脈なし)、それが単位立方体と一致するか (差が空か) を覚える。
3. 動的形状のブロックは Cache を持たず、問い合わせのたびに実際の取得器と位置で当たり判定を計算する。
   26.3 で動的形状なのは moving_piston・bamboo・scaffolding・powder_snow・pointed_dripstone・sulfur_spike とシュルカーボックス 17 種。
4. 見た目の形・遮光・名前は関係ない。**当たり判定だけで決まる**。
5. bamboo と SpeleothemBlock (pointed_dripstone・sulfur_spike) は、isCollisionShapeFullBlock 自体も偽に上書きしている。

#### 4.4.2 Blocks での上書き (26.3 の全一覧) [26.3 読解: Blocks の各登録 / 状態ダンプで全件照合]

常に偽 (非導体にする) は 65 ブロック。

| 区分 | ブロック | 数 | 指定の場所 |
|---|---|---|---|
| 葉 | oak, spruce, birch, jungle, acacia, dark_oak, mangrove, red_poplar, orange_poplar, yellow_poplar, azalea, flowering_azalea の _leaves | 12 | leavesProperties |
| 葉 | cherry_leaves, pale_oak_leaves | 2 | 個別 |
| ガラス | glass, tinted_glass, 色付きガラス 16 色 (_stained_glass) | 18 | 個別 / ColorCollection |
| ピストン | piston, sticky_piston | 2 | pistonProperties |
| ピストン | moving_piston | 1 | 個別 |
| 氷 | ice, frosted_ice | 2 | 個別 (packed_ice・blue_ice は既定 = 導体) |
| 光るブロック | glowstone, sea_lantern, beacon | 3 | 個別 |
| 信号系 | redstone_block, observer | 2 | 個別 |
| 銅 | copper_grate と copper_bulb (それぞれ無印・exposed・weathered・oxidized と waxed の 4 段) | 16 | WeatheringCopperCollection |
| その他 | tnt, chorus_flower | 2 | 個別 |
| 形がもともと非フル (結果は変わらない) | bamboo, scaffolding, powder_snow, pointed_dripstone, sulfur_spike | 5 | 個別 |

常に真 (導体にする) は 2 ブロック: soul_sand, mud。どちらも当たり判定は高さ 14/16 で、既定なら非導体になる。

- 状態ダンプ (空の取得器) で既定と結果が違うのは 61 ブロック (上の 65 から、空の取得器では差の出ない 6 を除き、soul_sand・mud を足す)。
- 6 のうち moving_piston だけは、実際の世界では上書きが効く。moving_piston の当たり判定は BE が運ぶブロックの形をずらしたもので
  (PistonMovingBlockEntity#getCollisionShape)、ずれが 0 なら石のフルの形になる。上書きが無ければ導体になりうるが、常に非導体である。
  残りの 5 は上書きが無くても非導体である。bamboo・pointed_dripstone・sulfur_spike は isCollisionShapeFullBlock 自体が偽、
  scaffolding・powder_snow は導体の判定が使う文脈なしの当たり判定が空 (ScaffoldingBlock#getCollisionShape・PowderSnowBlock#getCollisionShape)。[26.3 読解]
- 裏づけ: ガラス・グロウストーン・シーランタン・氷は非導体、packed_ice は導体 [実機 1.21.1: nonconductor-glass-slab]。
  スライム・ロードストーン・ソウルサンド・音符ブロックは導体、蜂蜜は非導体 [実機 1.21.1: strong-charge-through-conductors]。
  銅の電球は非導体 [実機 1.21.1: copper-bulb-output]。ターゲットは導体 [実機 1.21.1: target-conduct]。

#### 4.4.3 状態で割れるもの・動的に変わるもの

| ブロック | 規則 | 確かさ |
|---|---|---|
| スラブ 101 種 | type=double の 2 状態だけ導体 (当たり判定がフル)。上付き・下付きは非導体 | [26.3 読解] [実機 1.21.1: nonconductor-glass-slab] |
| piston, sticky_piston | 縮んでいても伸びていても非導体 (述語が常に偽) | [26.3 読解: Blocks の pistonProperties] |
| シュルカーボックス 17 種 | 閉じていれば導体。開き具合が 0 でない間は、当たり判定が蓋の向きへ開き具合 × 0.5 だけ伸びてフルでなくなり、非導体になる | [26.3 読解: ShulkerBoxBlock#getShape, ShulkerBoxBlockEntity#getBoundingBox] [要実機] (閉じた状態は [実機 1.21.1: shulker-box-conductor]) |
| moving_piston | 運ぶブロックによらず常に非導体 (§4.4.2) | [26.3 読解] |

- 26.3 で導体の状態を持つブロックは 498 種 (1286 種中)。
- シュルカーの開き具合は BE の tick で 0.1 ずつ動く (ShulkerBoxBlockEntity#updateAnimation。開閉はブロックイベント 1 で始まる → 03)。
  開き始め (0 → 0.1 の tick)・開き終わり (1.0)・閉じ始め (1.0 → 0.9)・閉じ終わり (0) の 4 回、自分の位置から形状更新 (フラグ 3) と近隣更新を出す
  (ShulkerBoxBlockEntity#doNeighborUpdates)。導体かどうかが変わるのは開き始めと閉じ終わりで、どちらにも更新が付く。
  よって隣のダストは、開き始めの tick に非導体として、閉じ終わりの tick に導体として読み直す。[26.3 読解] [要実機]
- 開いている間は、蓋の反対 (底) の面しか支えにならない (ShulkerBoxBlock#getBlockSupportShape)。蓋の側や横の面に付けたレバー・ボタン・トーチは、
  開き始めの形状更新で落ちる。[26.3 読解]

#### 4.4.4 見た目と食い違う早見

| 見た目 | 実際 | 例 |
|---|---|---|
| フルに見えるが非導体 | 述語の上書き | 葉・ガラス・氷・グロウストーン・シーランタン・ビーコン・TNT・オブザーバー・レッドストーンブロック・コーラスフラワー・銅の格子と電球 |
| フルに見えるが非導体 | 当たり判定が 1 未満 | 8 段の雪 (当たり判定は 7 段分)・耕地・土の道 (15/16)・蜂蜜ブロック・チェスト類 |
| フルに見えないが導体 | 述語の上書き | soul_sand・mud |
| 見えないが導体 | 当たり判定はフル | barrier |
| 名前が似て割れる | | ice と frosted_ice は非導体、packed_ice と blue_ice は導体 |

#### 4.4.5 isRedstoneConductor を使う所 (信号以外も)

| 所 (26.3) | 何に使うか | 参照 |
|---|---|---|
| SignalGetter#getSignal | 導体の中継 | 本書 |
| RedstoneWireBlock (接続形状・角の更新)・RedstoneWireEvaluator・ExperimentalRedstoneWireEvaluator | 斜めの接続と斜めの読み | → 06 |
| ComparatorBlock#getInputSignal | 導体の 1 つ奥のアナログ値で置き換える | → 07 / 14 |
| Level#updateNeighbourForOutputSignal | 導体の 1 つ奥のコンパレーターにも近隣更新を送る | → 04 |
| ChestBlock・EnderChestBlock | 真上が導体だと開けない | → 14 |
| AbstractMinecart・OldMinecartBehavior | 止まったカートがパワードレールで発進する向き (壁の側) | → 15 / 17 |
| NaturalSpawner・SpawnPlacementTypes・Bat | スポーン条件 | (範囲外) |

### 4.5 準接続 (1 つ上のマスも見る素子)

[26.3 読解: PistonBaseBlock#getNeighborSignal, DispenserBlock#neighborChanged, DoorBlock#neighborChanged・#getStateForPlacement, CrafterBlock#neighborChanged]

| 素子 | 読み方 |
|---|---|
| piston, sticky_piston | 1. 前 (FACING) を除く 5 方向を Direction.values() の順に hasSignal。2. 自分の位置を下向きで hasSignal (ピストン自身は信号も導体も持たないので常に偽)。3. 1 つ上のマスの周り (下を除く 5 方向) を hasSignal。どれかが真なら受電 |
| dispenser, dropper | hasNeighborSignal (自分) か hasNeighborSignal (1 つ上)。DropperBlock は neighborChanged を継承する |
| (似て非なる) ドア | 自分ともう片方の半分の hasNeighborSignal。置くときは自分と 1 つ上 (上半分になる位置)。2 マスの自分を読むだけで準接続ではない → 11 |
| (しない) crafter | hasNeighborSignal (自分) だけ [実機 1.21.1: crafter-trigger] |

- 26.3 の block パッケージ全体で、1 つ上のマスの受電を読むのは piston・sticky_piston・dispenser・dropper の 4 ブロックだけである
  (読む処理を持つのは PistonBaseBlock と DispenserBlock の 2 クラス)。パワードレールが線路の先のレールの受電を読むのは別の仕組みである (→ 15)。
- 準接続は受電を「読む」だけで、1 つ上のマスの周りが変わっても、その変化が素子自身に近隣更新を出すとは限らない。
  redstone_block を斜め上に置くような、周り 6 マスにしか更新を出さない変化では届かず、近隣更新が来たときに初めて動く (BUD)。
  [実機 1.21.1: qc-bud, qc-noteblock-strong] 一方、ダスト (周り 6 マスそれぞれの周り) やレバー・ボタン (取り付け先の周り) のように、
  自分の周りより先へ更新を出す源なら、その更新が素子に届いて動くことがある (→ 04・13)。
- ピストンの 1 では、上を向いたピストンの真上のブロック自体は見ない (前なので除く)。3 は真上のマスの「周り」を見る。

### 4.6 押し反応

#### 4.6.1 PushReaction の 5 値 [26.3 読解: PushReaction, PistonBaseBlock#isPushable, PistonStructureResolver#resolve・#addBlockLine]

| 26.3 の名前 | 26.2 以前の名前 | 意味 | 例 |
|---|---|---|---|
| PUSH_PULL | NORMAL | 既定。BE を持たなければ押せて引ける | 石 |
| PUSH | PUSH_ONLY | 動く向きが「つながりの向き」と同じときだけ動く。粘着ピストンで引けない。スライムに横から連れられない | 釉薬テラコッタ |
| POPPED | DESTROY | 押す列に入ると壊れる。粘着ピストンに直接は引かれない (動かずに残る)。引き戻しで動く塊の進む先にあれば壊れる (PistonStructureResolver#addBlockLine → 13) | ダスト |
| IMMOVEABLE | BLOCK | 動かない | 黒曜石 |
| IGNORE_ENTITY | IGNORE | ブロックでは使わない。エンティティ用で、ピストンに押されない | マーカー |

- 26.3 の宣言順 (ordinal) は PUSH_PULL・PUSH・POPPED・IMMOVEABLE・IGNORE_ENTITY。26.2 以前は NORMAL・DESTROY・BLOCK・IGNORE・PUSH_ONLY。
- PUSH は押しても引いても実機どおり。[実機 1.21.1: piston-push-glazed, slime-beside-glazed]

#### 4.6.2 isPushable の判定順 (26.3)

引数は「状態・位置・動く向き・壊してよいか・つながりの向き」。

1. 位置が高さの範囲外 (最小 Y 未満・最大 Y 超) か、ワールドボーダーの外なら偽。
2. 空気 (isAir) なら真。
3. 動く向きが下で位置が最小 Y、または上で最大 Y なら偽。
4. ピストン・粘着ピストン以外なら:
   1. 硬さが −1 なら偽。
   2. IMMOVEABLE なら偽。POPPED なら「壊してよいか」をそのまま返す。PUSH なら「動く向き = つながりの向き」を返す。PUSH_PULL と IGNORE_ENTITY は次へ。
5. ピストン・粘着ピストンなら、EXTENDED が真なら偽。押し反応 (IMMOVEABLE) は見ない。
6. BE を持たなければ真、持てば偽。

- 26.2 以前は 2 の直後に「黒曜石・泣く黒曜石・リスポーンアンカー・強化深層岩なら偽」の名指しがあった。26.3 では 4 種とも
  Properties の押し反応が IMMOVEABLE になり、名指しが消えた。結果は同じ。[版差 26.2→26.3]
- POPPED は手順 4 の 2 で返るので、BE を持っていても壊れる (シュルカー・頭・ベルなど)。

#### 4.6.3 押し反応の全一覧 (26.3) [26.3 読解: Blocks の各登録 / 状態ダンプで全件照合]

内訳は PUSH_PULL 886・POPPED 367・IMMOVEABLE 17・PUSH 16・IGNORE_ENTITY 0 (計 1286)。

**IMMOVEABLE (17)**: piston, sticky_piston (pistonProperties), piston_head, moving_piston, obsidian, crying_obsidian, respawn_anchor,
reinforced_deepslate, lodestone, nether_portal, end_portal, end_gateway, barrier, anvil, chipped_anvil, damaged_anvil, grindstone。

**PUSH (16)**: 釉薬テラコッタ 16 色 (_glazed_terracotta)。

**POPPED (367)**:

| まとまり | 数 | 中身 |
|---|---|---|
| 苗木 | 10 | _sapling 9 種 (oak, spruce, birch, jungle, acacia, cherry, dark_oak, pale_oak, poplar) と mangrove_propagule |
| 葉 | 14 | _leaves 全種 |
| ベッド | 17 | 色つき 16 と straw_bed |
| 感圧板 | 17 | _pressure_plate 全種 (石・磨かれたブラックストーン・重量 2・木 13) |
| ボタン | 15 | _button 全種 |
| ドア | 22 | 木 13・iron_door・銅 8 (トラップドアは含まない) |
| ろうそく / ろうそく付きケーキ | 17 / 17 | candle と色つき 16 / candle_cake と色つき 16 |
| シュルカーボックス | 17 | shulker_box と色つき 16 |
| 頭 | 14 | _skull・_wall_skull・_head・_wall_head 全種 (piston_head は別) |
| 植木鉢 | 40 | flower_pot と potted_ 全種 |
| 生きたサンゴ | 15 | 5 色の _coral・_coral_fan・_coral_wall_fan (dead_ とサンゴブロックは含まない) |
| 松明 | 8 | torch, wall_torch, redstone_torch, redstone_wall_torch, soul_torch, soul_wall_torch, copper_torch, copper_wall_torch |
| ランタン | 10 | lantern, soul_lantern, 銅のランタン 8 |
| 銅像 | 8 | copper_golem_statue の 8 段 |
| アメジスト | 5 | budding_amethyst, amethyst_cluster, large/medium/small_amethyst_bud |
| レッドストーン部品 | 6 | redstone_wire, repeater, comparator, lever, tripwire_hook, tripwire |
| 流体・火・泡 | 5 | water, lava, fire, soul_fire, bubble_column |
| 置き物 | 14 | ladder, cake, dragon_egg, bell, decorated_pot, scaffolding, structure_void, cobweb, snow, sea_pickle, turtle_egg, frogspawn, suspicious_sand, suspicious_gravel |
| カボチャ類 | 8 | pumpkin, carved_pumpkin, jack_o_lantern, melon, pumpkin_stem, melon_stem, attached_pumpkin_stem, attached_melon_stem |
| 苔・ドリップリーフ | 12 | moss_block, moss_carpet, pale_moss_block, pale_moss_carpet, pale_hanging_moss, big_dripleaf, big_dripleaf_stem, small_dripleaf, azalea, flowering_azalea, spore_blossom, hanging_roots |
| 草花 | 36 | short_grass, fern, dead_bush, bush, red_shrub, short_dry_grass, tall_dry_grass, tall_grass, large_fern, sunflower, lilac, rose_bush, peony, dandelion, golden_dandelion, torchflower, poppy, blue_orchid, allium, azure_bluet, red/orange/white/pink_tulip, oxeye_daisy, cornflower, wither_rose, lily_of_the_valley, pink_petals, wildflowers, leaf_litter, open_eyeblossom, closed_eyeblossom, firefly_bush, cactus_flower, pitcher_plant |
| 作物・つる・水草 | 38 | wheat, carrots, potatoes, beetroots, torchflower_crop, pitcher_crop, nether_wart, cocoa, sweet_berry_bush, sugar_cane, cactus, vine, glow_lichen, resin_clump, sculk_vein, cave_vines, cave_vines_plant, weeping_vines, weeping_vines_plant, twisting_vines, twisting_vines_plant, kelp, kelp_plant, seagrass, tall_seagrass, lily_pad, chorus_plant, chorus_flower, bamboo, bamboo_sapling, shelf_mushroom, brown_mushroom, red_mushroom, warped_fungus, crimson_fungus, warped_roots, crimson_roots, nether_sprouts |
| 鍾乳石の類 | 2 | pointed_dripstone, sulfur_spike |

**PUSH_PULL (886)**: 上に無いもの全部。

#### 4.6.4 isPushable を通した実効の分類 (26.3)

| 分類 | 数 | ブロック |
|---|---|---|
| 空気 (素通り) | 3 | air, cave_air, void_air |
| 硬さ −1 で不動 | 15 | bedrock, moving_piston, nether_portal, end_portal, end_portal_frame, command_block, repeating_command_block, chain_command_block, barrier, light, end_gateway, structure_block, jigsaw, test_block, test_instance_block |
| IMMOVEABLE で不動 | 10 | piston_head, obsidian, crying_obsidian, respawn_anchor, reinforced_deepslate, lodestone, anvil 3 種, grindstone |
| BE を持つので不動 | 137 | 看板 52 (_sign・_wall_sign・_hanging_sign・_wall_hanging_sign)、旗 32、棚 14 (chiseled_bookshelf と _shelf 13)、銅のチェスト 8、ほか 31 (dispenser, dropper, crafter, hopper, chest, trapped_chest, barrel, ender_chest, furnace, smoker, blast_furnace, brewing_stand, jukebox, daylight_detector, lectern, sculk_sensor, calibrated_sculk_sensor, sculk_catalyst, sculk_shrieker, spawner, trial_spawner, vault, creaking_heart, enchanting_table, beacon, conduit, campfire, soul_campfire, bee_nest, beehive, potent_sulfur) |
| 壊れる | 367 | POPPED 全部。うち BE を持つのに壊れるもの 44: シュルカー 17、頭 14、銅像 8、comparator, bell, decorated_pot, suspicious_sand, suspicious_gravel |
| 押すだけ | 16 | 釉薬テラコッタ |
| ピストン | 2 | 縮んでいれば動く (BE なし)、伸びていれば不動 |
| 押せて引ける | 736 | 残り全部 (レール 4 種・オブザーバー・トラップドア・塀・ガラス板・銅の電球・ランプ・音符ブロック・レッドストーンブロック・ターゲットを含む) |

- 裏づけ: 黒曜石は不動 [実機 1.21.1: piston-push-obsidian, slime-beside-obsidian]、オブザーバーは押せる [実機 1.21.1: observer-pushed]、
  レールは押せる [実機 1.21.1: rail-piston-push]、ダストとトーチは壊れる [実機 1.21.1: destroy-push-dust, destroy-push-torch]。

#### 4.6.5 getPistonPushReaction の上書き

- ブロック側には上書き口が無い。BlockStateBase#getPistonPushReaction は Properties の値を返すだけである。[26.3 読解]
- エンティティ側は Entity#getPistonPushReaction (既定 PUSH_PULL) を、AreaEffectCloud・Marker・Display・Interaction・OminousItemSpawner が
  IGNORE_ENTITY に上書きする。ArmorStand はマーカーのときだけ IGNORE_ENTITY。動くピストンは IGNORE_ENTITY 以外のエンティティを押す。
  蜂蜜ブロックが横に動くときは、上に乗った PUSH_PULL のエンティティだけを一緒に運ぶ (PistonMovingBlockEntity#moveStuckEntities・#matchesStickyCritera)。→ 17

### 4.7 その他のレッドストーンに効く性質

#### 4.7.1 replaceable [26.3 読解: Properties#replaceable, BlockStateBase#canBeReplaced]

- 26.3 で replaceable な 30 種: air, cave_air, void_air, water, lava, bubble_column, fire, soul_fire, light, structure_void, snow,
  short_grass, tall_grass, fern, large_fern, dead_bush, bush, red_shrub, short_dry_grass, tall_dry_grass, seagrass, tall_seagrass,
  vine, glow_lichen, resin_clump, warped_roots, crimson_roots, nether_sprouts, hanging_roots, leaf_litter。
- 効くところ: プレイヤーやディスペンサーの設置 (BlockBehaviour#canBeReplaced の設置版)、落下ブロックが通り抜けられるか (FallingBlock#isFree: 空気・火・流体・replaceable)、
  バケツで流体を置けるか (BucketItem#emptyContents が呼ぶ流体版: replaceable か legacy solid でなければ置ける)。
- 26.3 の流れる流体は replaceable を見ない。入れるかはタグで決まる (§4.7.3)。
- 押し反応とは無関係である。replaceable な light も硬さ −1 なのでピストンを止める (§5)。

#### 4.7.2 legacy solid (isSolid) [26.3 読解: BlockStateBase#calculateSolid]

1. forceSolidOn なら真。
2. forceSolidOff なら偽。
3. 形のキャッシュが無い (動的形状) なら偽。
4. 当たり判定が空なら偽。
5. 当たり判定の外接箱の 3 辺の平均が 0.7291666… (= 35/48) 以上なら真。底面がフルなら、高さ 3/16 以上で真になる。
6. 外接箱の高さが 1 以上なら真。
7. それ以外は偽。

- 26.3 で forceSolidOn を指定するのは感圧板・看板・旗・フェンスゲート・ランタン・鎖・避雷針・塀 (registerWall) などで、forceSolidOff は 8 種 (ladder, snow, end_rod, chorus_plant, chorus_flower, azalea, flowering_azalea, big_dripleaf) だけ。
- 効くところ (26.3):
  - 無限水源: 横に同じ流体の源が 2 つ以上あり、真下が legacy solid か同じ流体の源なら、そのマスは源になる (FlowingFluid#getNewLiquid)。→ 16
  - バケツで流体を置けるか (BlockBehaviour#canBeReplaced の流体版: replaceable か legacy solid でない。呼ぶのは BucketItem#emptyContents)。
  - 支え: 看板・旗・ケーキ・ろうそく付きケーキは下 (壁付けは取り付け先) が legacy solid でないと残れない。
  - 耕地と土の道は、真上が legacy solid になると土に戻る (FarmlandBlock#canSurvive・PathBlock。耕地はタグ maintains_farmland のもの、土の道はフェンスゲートなら戻らない)。
    サボテンは横が legacy solid だと壊れる (CactusBlock)。
- 26.2 までは流れる流体が入れるかの判定 (blocksMotion) にも legacy solid が効いた。26.3 では効かない (§4.7.3)。[版差 26.2→26.3]
- 主な部品の値: ダスト・リピーター・コンパレーター・トーチ・レバー・ボタン・レール・トリップワイヤーは偽。感圧板・日照センサー・書見台・避雷針は真。

#### 4.7.3 流体に流されるか

- 26.3 では、流体が入れるのは LiquidBlockContainer (水没できるブロック。壊さずに中へ入る) か、タグ washed_away_by_fluids (解決後 254 種。壊して入る) のブロックだけになった。[26.3 読解: FlowingFluid#canHoldAnyFluid]
- 26.2 以前は「blocksMotion (legacy solid で、クモの巣と竹の芽を除く) でなく、ドア・看板・はしご・サトウキビ・泡柱・ポータル類・ストラクチャーヴォイドでない」が条件だった。[版差 26.2→26.3]
- レッドストーン部品の結果は変わらない (両版で照合): ダスト・リピーター・コンパレーター・トーチ・レバー・ボタン・トリップワイヤー・フックは流される。
  感圧板・日照センサー・書見台・オブザーバー・ホッパー・ターゲット・ピストンヘッドは流されない。レール・避雷針・スカルクセンサー・トラップチェストは水没できる。→ 16

#### 4.7.4 面の支え [26.3 読解: SupportType, 各素子の canSurvive]

| SupportType | 条件 | 求める素子 |
|---|---|---|
| FULL | 面がすべて覆われる | ダストの足元 (上面。ホッパーは例外で可)、レバー・ボタン・壁トーチ・トリップワイヤーフックの取り付け面、ドアの下 |
| CENTER | 面の中央 2×2 ピクセルが覆われる | 床置きトーチの足元 |
| RIGID | 面の外周 2 ピクセル幅が覆われる | リピーター・コンパレーター・レールの足元 |
| RIGID か CENTER | どちらか | 感圧板の足元 |

- 支えと導体は別の性質である。足場 (scaffolding) と 8 段の雪は上面で支えるが非導体である。上付きトラップドアはダストを載せられる (→ 06)。
- 葉は支えの形が空なので、どの面も支えにならない (LeavesBlock#getBlockSupportShape)。葉の上にダスト・トーチ・リピーターは置けず、横にレバーも付かない。
  ガラスは非導体だが支えにはなる。
- 開いたシュルカーは底の面だけが支えになる (§4.4.3)。
- この表は支えを「求める側」である。支えを「出す側」(どの状態のどの面が支えるか) は §4.7.5 にある。

#### 4.7.5 面の支えを出す側 [26.3 読解: BlockStateBase#isFaceSturdy, BlockStateBase の Cache, BlockBehaviour#getBlockSupportShape・#getCollisionShape・#getShape, SupportType, Block#isFaceFull, VoxelShape#getFaceShape]

支えの答えは「状態・面の方向・SupportType」で決まる真偽である。求め方は次のとおり。

1. **支えの形**を取る (getBlockSupportShape)。既定は当たり判定の形である。
   当たり判定の形の既定は、noCollision のブロックなら空、そうでなければ輪郭の形 (getShape) である。輪郭の形の既定は 1 ブロックの立方体である。
2. 支えの形から、問われた方向の**面の形**を取る。面の形は、支えの形がその方向のブロックの境界に接している部分の断面である。
   空の形の面は空で、立方体の面は全面である。
3. SupportType ごとに面の形を見る。
   - FULL: 面の形が全面 (16×16 ピクセル) に等しい。
   - CENTER: 面の形が、中央の 2×2 ピクセル (7〜9) を全部含む。
   - RIGID: 面の形が、外周の 2 ピクセル幅の枠 (全面から中央の 12×12 を抜いた形) を全部含む。
4. SupportType を渡さない問い合わせは FULL である。

- 値は 1 状態につき 6 方向 × 3 種 = **18 個**である。動的形状でないブロックは、状態のキャッシュを作る時に「空のブロック取得器・原点」で 18 個を計算して持つ。
  だから位置にも周りのブロックにも依らない。状態表の列にできる。
- 動的形状のブロック (キャッシュを持たない) は、問われるたびにその位置で計算する。支えに効くのはシュルカーボックスである (§4.4.3)。
- 全面が FULL の面は、CENTER と RIGID も真である。空の面は 3 種とも偽である。3 種が割れるのは、面を一部だけ覆う形 (塀・柵・板ガラスなど) だけである。

**縦切りの 5 種の値** (26.3)。5 種とも getBlockSupportShape を上書きせず、動的形状でもない。

| ブロック | 登録の性質 | 支えの形 | 6 面 × 3 種の値 |
|---|---|---|---|
| air (cave_air・void_air も同じ) | noCollision | 空 | 18 個とも偽 |
| stone | 当たり判定あり。輪郭は既定 (立方体) | 立方体 | 18 個とも真 |
| lever (24 状態すべて) | noCollision | 空 | 18 個とも偽 |
| redstone_wire (1296 状態すべて) | noCollision | 空 | 18 個とも偽 |
| redstone_lamp (lit の真偽とも) | 当たり判定あり。輪郭は既定 (立方体) | 立方体 | 18 個とも真 |

- つまり「石とランプは 6 面とも FULL、レバーとダストはどの面も支えない」でよい。石とランプは CENTER と RIGID も 6 面とも真である。
- レバーとダストは輪郭の形 (選択の枠) を持つが、noCollision なので当たり判定が空になり、支えの形も空になる。輪郭の形は支えに効かない。
- ランプの支えは lit で変わらない。導体かどうか (§4.4) とも独立である (この 5 種ではたまたま一致する)。

**縦切りで支えを求める所** (求める側の式は → 06・09)。

| 求める側 | 見る相手 | 見る面 | 種類 | 支え以外の例外 |
|---|---|---|---|---|
| ダストの存続 (RedstoneWireBlock#canSurvive) | 真下 | 上面 | FULL | 真下が hopper なら支えを見ずに可 |
| ダストの上り接続 (RedstoneWireBlock#getConnectingSide) | 横の隣 | 上面 (載せられるか) と、ダストに向いた側面 (up か side か) | FULL | 横の隣がトラップドアか hopper なら、上面を見ずに「載せられる」とする。側面の支えは例外なく見る |
| レバーの存続 (FaceAttachedHorizontalDirectionalBlock#canAttach) | 取り付け先 (床付けは真下・天井付けは真上・壁付けは facing の逆の隣) | レバーに向いた面 | FULL | なし |

- 5 種だけの世界では、ダストは石かランプの上にだけ残り、レバーは石かランプにだけ付く。ダストの上にもレバーの上にも何も載らない。

**支えの形を上書きするクラス** (26.3 の全部。5 種の外。状態表を広げる時に効く)。

| クラス | 支えの形 |
|---|---|
| LeavesBlock | 常に空 (どの面も支えない。§4.7.4) |
| SoulSandBlock・MudBlock | 常に立方体 (当たり判定は 1 ブロックより低いが、6 面とも支える) |
| SnowLayerBlock | 段数どおりの高さの形 (当たり判定は 1 段低い。上面が全面になるのは 8 段だけ) |
| FenceGateBlock | 開いていれば空。閉じていれば支え専用の形 (当たり判定とは別の形) |
| ShulkerBoxBlock | BE があって閉じていなければ、開いた時の支え専用の形。それ以外は立方体 (動的形状。§4.4.3) |
| ChorusFlowerBlock | 支え専用の形 |
| CeilingHangingSignBlock・WallHangingSignBlock | 輪郭の形 (当たり判定とは別) |

- 5 種の外の値は、状態ダンプ (§3.7 B) で取る。今のダンプの列は「上面と下面の FULL」だけなので、状態表の列にする時は 6 方向 × 3 種の 18 個に広げる。
- 床置きの CENTER には、支えとは別の門番が 1 つある。Block#canSupportCenter は、下向きの面を問われた相手がタグ unstable_bottom_center
  (木のフェンスゲート 13 種) なら、支えを見ずに偽を返す (付録 C.1 のランタンの行)。RIGID の入口 (Block#canSupportRigidBlock) は真下の上面だけを問う。

---

## 5. 端の場合と落とし穴

1. **向きの約束**。フックの向きは「読み手 → 源」。床置きトーチの土台読みは「真下のマスを下向きで読む」。TS の power.ts は「源 → 読み手」で持ち、反転して呼んでいる (§9)。
2. **中継は 1 段**。導体の getDirectSignal は 0 なので、強充電された導体が隣の導体を充電することはない。
3. **getDirectSignalTo は読み手自身も見る**。読み手が自分の側へ強い信号を出す素子なら、自分の出力が導体越しに戻る形になる。
   背面の導体を読むリピーター・コンパレーター、土台を読むトーチ・壁トーチは、その配置では向きが合わず 0 になる。
   ダストは評価中 shouldSignal が偽なので、自分の出力は戻らない。
4. **自分でも信号を出す導体** (信号源の target・jukebox と、信号源でない test_block) は、自分の弱い信号と導体の中継の大きい方を見せる。
   target は弱充電 (ダスト) を受けても、その中継はダストの強度計算には入らない。[実機 1.21.1: target-conduct]
5. **redstone_block は非導体**で、ダストの上下の接続を切らない。
6. **getSignal は信号源の印を見ない**。test_block は信号源でないのに、START モードで弱い信号を出す。逆に jukebox は止まっていても信号源で、ダストが繋がる。
7. **ダストの shouldSignal は全ダスト共通の 1 つの値**。RedstoneWireBlock のインスタンスは 1 つ (Blocks.REDSTONE_WIRE) なので、フィールドは世界中のダストで共有される。
   偽にするのは RedstoneWireBlock#getBlockSignal の中だけで、その間は純粋な読み出ししか起きない。→ 06
8. **側面入力にダストの形は効かない**。getControlInputSignal はダストの POWER を直読する。導体は側面入力にならない。
9. **ダストの真上の導体判定にはダスト自身の位置が渡る**。RedstoneWireBlock#getMissingConnections と #getConnectingSide は、
   真上の状態の isRedstoneConductor に、真上でなくダストの位置を渡す (1.21.1 から 26.4-pre-1 まで同じ)。
   位置を見ない述語では差が出ない。動的形状の開いたシュルカーが真上にあるときだけ、閉じた扱い (導体) になる [要実機]。評価器 (RedstoneWireEvaluator) は正しい位置を渡す。
   そのため開いたシュルカーの下では、形 (上り接続) は切れたままなのに、強度は斜め上のダストから受け取る、という食い違いが起きうる。
   ダストの位置には BE が無いので、ShulkerBoxBlock#getShape が閉じた形を返すのが原因である。[26.3 読解] [要実機]
10. **見えない light はピストンを止める**。空気でなく、硬さ −1 なので、押す列に入ると伸びない [26.3 読解: isPushable] [要実機]。structure_void は POPPED で壊れる。
11. **BE を持つのに壊れる**: シュルカー・頭・ベル・飾り壺・銅像・コンパレーター・怪しい砂/砂利。**BE で動かない**: 看板・旗・チェスト類・書見台・日照センサー・
    スカルクセンサー・ジュークボックス・ホッパー・ディスペンサー・ドロッパー・クラフター・棚。
12. **ピストンは IMMOVEABLE を持つが、isPushable は見ない**。縮んだピストンは動く。粘着ピストンが引くかどうかの判定では、ピストンだけ PUSH_PULL 扱いになる (→ 13)。
13. **水平の向きの値の並びは north, south, west, east**。HORIZONTAL_FACING の添字を北・東・南・西の順で作ると状態 ID がずれる。
14. **blocks.json のキーの並びは状態の並びではない**。type が先頭に来る。
15. **状態 ID は版ごとに変わる** (§6)。26.4-pre-1 は途中にブロックが入り、repeater 以降の ID がずれた。ファイルは名前とプロパティで読む。
16. **chain は iron_chain に改名**された (1.21.1 には chain、26.2 には iron_chain がある。手元の 4 版で見える範囲)。古いファイルの chain は読み替える。
17. **範囲外は void_air**。高さの外を読むと信号 0・非導体になる。
18. **動いている途中のブロックは何もしない**。押されている間のブロックは moving_piston で、非導体・信号 0・非信号源である。
    運ばれている石は導体として働かず、運ばれている redstone_block は信号を出さない。着地して元のブロックに戻ってから働く (→ 13)。
19. **シュルカーの開閉は自分で更新を出す**。開き始めと閉じ終わりに導体かどうかが変わり、同じ tick に形状更新と近隣更新が出る (§4.4.3)。
    別の更新を起こさなくても、隣のダストやランプは読み直す。

---

## 6. 版差

担当クラスを diff -u し、状態ダンプと reports を 4 版で比べた。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| SignalGetter | getBestOwnOrNeighbourSignal なし | 追加 (SulfurCube 用) | 同じ (RedStoneWireBlock → RedstoneWireBlock の改名だけ) | 差なし |
| 信号フックの構造 | 各ブロックが getSignal を上書き | ownSignal 導入 (結果は同じ) | shouldRedstoneWireConnectTo 導入 (ダストの接続判定の名指しをフックへ。結果は同じ) | 差なし |
| PushReaction | NORMAL・DESTROY・BLOCK・IGNORE・PUSH_ONLY | 同左 | PUSH_PULL・PUSH・POPPED・IMMOVEABLE・IGNORE_ENTITY (改名と並べ替え) | 26.3 と同じ |
| 黒曜石 4 種の不動 | isPushable の名指し | 同左 | Properties の IMMOVEABLE | 同じ |
| 流体が入れるか | blocksMotion ほか | 同左 | タグ washed_away_by_fluids | 同じ |
| legacy solid (塀) | (resin_brick_wall なし) | resin_brick_wall だけ registerWall を通らず forceSolidOn が無い (2 状態が偽) | 全部の塀が registerWall の forceSolidOn (全状態が真) | 同じ |
| blocks.json の definition | あり | あり | なし (BlockTypes の削除) | なし |
| ブロック数 / 状態数 | 1060 / 26,684 | 1196 / 32,366 | 1286 / 35,723 | 1311 / 37,840 |
| redstone_wire の既定の ID | 4138 | 5171 | 6727 | 6727 |
| repeater の最初の ID | 5881 | 7034 | 8704 | 9117 |
| note_block の状態数 | 1150 (楽器 23) | 1350 (trumpet 4 種が pling の後に入る) | 1350 | 1350 |
| BlockStateProperties | DirectionProperty | EnumProperty (値と並びは同じ) | 26.2 と同じ | FALLING を削除、PLAYLIST_MODE・SOURCE を追加 |
| 登録の書き方 | 1 ブロック 1 フィールド | ColorCollection・WeatheringCopperCollection (登録順が変わる) | 同左 | 同左 |

- **導体の値**: 4 版に共通するブロックで差は無い (状態ダンプ)。1.21.1 で測った導体の表 (TS の isConductor) は、共通ブロックについては 26.3 でもそのまま使える。
- **押し反応の値**: 名前を読み替えると、共通ブロックで変わったのは黒曜石 4 種 (PUSH_PULL → IMMOVEABLE) だけ。isPushable の結果は 4 版で同じ。
- **信号源**: 共通ブロックで差は無い。数は 46 (1.21.1) → 55 (26.2) → 57 (26.3・26.4-pre-1)。増えたのは銅の避雷針 7 種と、ポプラ・ペールオークのボタンと感圧板。
- **ベッド**: 26.2 で BE が無くなった。POPPED のままなので、押すと壊れるのは同じ。
- **26.4-pre-1 の新ブロック 25 種** (snow_bricks・packed_ice_bricks・calcite 系・brittle_ice・ice_crystal・icicle ほか): brittle_ice を除くフルブロックは導体・PUSH_PULL。brittle_ice・ice_crystal・icicle は非導体・POPPED。
  Blocks の導体の上書きは 26 か所から 29 か所に増えた (brittle_ice・ice_crystal・icicle の常に偽)。brittle_ice は当たり判定がフルなので、上書きで結果が変わる 62 個目になる。
- **26.4-pre-1 の jukebox**: プロパティ playlist_mode (true, false) が増え、2 状態から 4 状態になった (既定は has_record=false・playlist_mode=false)。
  真上がタグ jukebox_containers の入れ物 (チェストは単体だけ) かで値が決まり (JukeboxBlockEntity#isInPlaylistMode)、
  JukeboxBlock に neighborChanged (変わればフラグ 2 で書く) と updateShape が新しく付いた。信号のフック (ownSignal・isSignalSource) は変わらない。
  既存ブロックで状態の組が変わったのはこれだけである (reports で照合)。[版差 26.4-pre-1]
- **26.4-pre-1 の状態 ID のずれ**: redstone_wire と repeater の間に snow_brick 系 4 ブロック (411 状態) が入り、jukebox が 2 状態増えたので、repeater 以降は 413 ずれた。

---

## 7. Rust で実装するときの要点

### 7.1 状態表は生成物にする

- ビルド時に、版ごとの blocks.json (§3.7 A) と状態ダンプ (§3.7 B) を読み、静的な配列を Rust のソースとして吐く。手で書かない。
- 状態 ID は 26.3 で 35,723、26.4-pre-1 で 37,840 なので u16 に収まる。ただし版ごとに変わるので、内部用に留める。
  litematic・schem・structure NBT はパレットが名前とプロパティなので、読み込みは名前とプロパティから引く。
- ブロックごとに「名前順のプロパティの列」と「値の個数」を持ち、状態の添字を混合基数で計算する。プロパティの書き換えは添字の桁の差し替えで済む
  (StateHolder の隣接表と同じことを算術でやる)。
- 状態ごとのフラグは、導体・信号源・当たり判定フル・BE あり・硬さ −1・replaceable・legacy solid・アナログ出力・面の支え (方向 × 種類) を持つ。押し反応は 5 値の生の値を持つ。

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Dir { Down, Up, North, South, West, East } // vanilla の Direction.values() と同じ順

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PushReaction { PushPull, Push, Popped, Immoveable, IgnoreEntity } // 26.3 の名前と順

pub struct StateInfo {
    pub block: u16,
    pub flags: u16,          // CONDUCTOR, SIGNAL_SOURCE, FULL_COLLISION, HAS_BE, UNBREAKABLE, ...
    pub push: PushReaction,
    pub signal: SignalKind,  // §4.3 の行 (出力の規則) を表す列挙
}
```

### 7.2 信号の問い合わせ

- getSignal・getDirectSignal・getDirectSignalTo・hasNeighborSignal・getBestNeighborSignal・getControlInputSignal を、引数の意味 (読み手 → 源の向き) まで vanilla に合わせた純関数にする。
- 素子の出力は SignalKind で分岐し、プロパティの値を読む。BE が要る素子 (コンパレーター・ジュークボックス・トラップチェスト・テストブロック) は BE の値を引く。
- ループはすべて Dir の宣言順で回す。結果は順によらないが、早期終了の位置を揃えておくと、計測やトレースが vanilla と比べやすい。
- ダストの shouldSignal はワールドの文脈に 1 つのフラグとして持つ。偽にするのはダストの評価器 (→ 06) だけにする。並列化するなら、このフラグがあるうちは評価を直列にする。
- 導体は状態の表で引く。シュルカーボックスだけは BE の開き具合を見る関数を通す。moving_piston は運ぶブロックによらず表のとおり非導体にする。
  ダストの真上の判定では、vanilla どおりダスト自身の位置を渡す (§5 の 9)。
- 信号源の印も状態の表で引くが、ダストだけは shouldSignal で動く (評価中は偽)。表の値をそのまま使わず、ダストの分岐を 1 つ持つ。

### 7.3 押し反応

- 判定は isPushable の順 (§4.6.2) で 1 つの関数にし、13 の構造解決から呼ぶ。生の押し反応・硬さ −1・BE の有無は別々のフラグで持つ (どれが効いたかを記録できる)。
- 26.2 以前の表を読むときは、黒曜石 4 種を IMMOVEABLE に読み替えれば同じ関数で済む。

### 7.4 他のメモとの境界

| 境界 | 本書が渡すもの | 相手 |
|---|---|---|
| ダストの評価 | getBestNeighborSignal (shouldSignal を倒して呼ぶ)、導体の判定 | → 06 |
| ダイオードの入力 | getSignal、getControlInputSignal、「背面がダストなら POWER も」 | → 07 |
| コンパレーター更新 | 導体の判定 | → 04 |
| ピストン | isPushable、PushReaction | → 13 |
| アナログ値 | hasAnalogOutputSignal の表 | → 14 |

---

## 8. 検証用のプローブ回路案

今の実機ハーネスは 1.21.1 なので、まず 1.21.1 で撮り、26.3 の実機を用意できたら同じ fixture を取り直す。

| # | 目的 | 配置 | 観測 | 期待 (26.3 読解) |
|---|---|---|---|---|
| P-1 | 導体の全数確認 (新ブロック) | レーンごとに redstone_block → repeater → 被検ブロック → 接続の無い点のダスト。被検は poplar_planks・sulfur 系・cinnabar 系・potent_sulfur・creaking_heart・resin_bricks・pale_moss_block・copper_grate・copper_bulb・葉 (対照) | settle 後のダストの power | 導体 15・非導体 0。§4.4.2 の表どおり |
| P-2 | 強い信号の向き | 信号源 S の 6 面 (置けるところ) に石、その石の外側に点のダストを置く。S は lever (床・壁・天井)・トーチ・感圧板・検知レール・書見台・トリップワイヤーフック・避雷針・スカルクセンサー・日照センサー・ターゲット | S が切り替わってから 1〜2 gt 後のダスト | §4.3 の「強い信号」の向きの石の先だけ 15 (または値)。日照センサーとターゲットは全部 0 |
| P-3 | 側面入力 | 背面に redstone_block を置いた subtract のコンパレーター。側面を 1 レーンずつ替える: 床のレバー (ON)・床置きトーチ・壁トーチ・源からの距離で power 7 にしたダスト・側面へ出力するリピーター・背面を向けたオブザーバー・redstone_block・根元を向けた避雷針 (雷が要る。撮れなければ省く) | 出力ダストの power | 15 − 側面。レバー・トーチ・壁トーチは側面 0 (出力 15)、ダストは 7 (出力 8)、リピーター・redstone_block は 15 (出力 0)、オブザーバーは発火中の 2 gt だけ 15、避雷針は POWERED の間 15 |
| P-4 | 準接続の素子 | 斜め上に redstone_block を置いた piston・dispenser・dropper・crafter・ドア (上半分の横)・ランプを並べ、t10 に各隣へ setblock して近隣更新を起こす | 各素子の状態 | piston・dispenser・dropper は動く。crafter とランプは動かない。ドアは上半分の受電で開く (準接続ではない) |
| P-5 | 26.3 の押し反応 | ピストンの前に 1 個ずつ: obsidian・crying_obsidian・respawn_anchor・reinforced_deepslate・light (石の前)・structure_void・シュルカー・旗・comparator・detector_rail・crafter・trapdoor・copper_bulb | 伸びたか、前のマスの中身 | 黒曜石 4 種・light・旗・crafter は伸びない。structure_void・シュルカー・comparator は壊れる。検知レール・トラップドア・銅の電球は動く |
| P-6 | 開いたシュルカーの導体性 | 東向き (蓋が東) のシュルカー。西に、redstone_block で点けた東へ出力するリピーター (強充電)。北に点のダスト。東のマスは空ける (蓋が開ける)。プレイヤーが開けて、閉じる | 開けた後の BE tick ごとと、閉じ終わりの tick のダストの power | 閉: 15。開き始めの tick から 0。閉じ終わりの tick に 15 へ戻る [要実機] |
| P-7 | 中継は 1 段 | 4 レーン: (a) repeater → 石 A → 石 B → 点のダスト、(b) 15 のダスト → 石 → 点のダスト、(c) 15 のダスト → 石 → ランプ、(d) repeater → 石 → 点のダスト | settle 後のダストの power とランプ | (a) 0、(b) 0 (弱充電はダストに見えない)、(c) 点く、(d) 15 |

- P-1・P-2・P-3 は既存の nonconductor-glass-slab・detector-rail-cart-pulse・comparator-side-reject の型を流用できる。
- P-1 の被検は copper_grate・copper_bulb・葉を除き 1.21.1 に無い (poplar は 26.3、sulfur・cinnabar・creaking_heart・resin・pale_moss は 26.2 で確認)。26.3 の実機で撮る。
- P-6 では別の更新を起こさない。シュルカーが開き始めと閉じ終わりに自分で形状更新と近隣更新を出す (§4.4.3)。更新を足すと、どの更新で読み直したかが分からなくなる。
  レバーをシュルカーに付けると、開いたときに落ちる (支えが底の面だけになる) ので、強充電はリピーターで行う。開閉にはプレイヤー (または偽プレイヤー) が要る。
- ターゲットの値は setblock では作れない。power が正の状態を置くと、予約が無ければ TargetBlock#onPlace が 0 に戻す (→ 09)。
  onPlace が走る置き方では、ダストの power も RedstoneWireBlock#onPlace が計算し直す。どちらも本物の源から作る。導体かつ信号源の確認は target-conduct の型で行う。

---

## 9. 既存資料との食い違い

コードは変えていない。判断と根拠だけを書く。

| # | 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|---|
| 1 | docs/research/02 §5.2 | 強動力の源は「リピーター/コンパレーター/トーチ (直上)/レバー等 (取り付け面)」 | getDirectSignal を定義するのは 13 クラス (継承で壁トーチ・調律型スカルクセンサーも)。オブザーバー・感圧板・検知レール・書見台・トラップチェスト・フック・避雷針・スカルク・ダストを含む | 記述は正しいが不足。§4.3 の表で補う |
| 2 | 02 §5.3 | 準接続は PistonBaseBlock・DispenserBlock・DropperBlock の 3 つだけ。根拠は「1 個上のマスに対する hasNeighborSignal」 | 26.3 でも素子は同じ。ただし読む処理を持つのは PistonBaseBlock と DispenserBlock の 2 クラスで、DropperBlock は DispenserBlock#neighborChanged の継承。ピストンは hasNeighborSignal を使わず、PistonBaseBlock#getNeighborSignal が向きごとの hasSignal を 5+1+5 回呼ぶ (§4.5)。ドアの 2 マス読みは準接続ではない | 結論は一致。ピストンの読み方の説明だけ不正確 |
| 3 | 02 §5.1 | アナログ値を保持するのはダストとコンパレーターのみ | 伝える素子に限れば正しい。0〜15 を出す源は target・日照センサー・スカルク 2 種・重量感圧板・トラップチェストもある | 文脈の補足でよい |
| 4 | power.ts の isConductor の説明 | 「sim では solid / target の 2 種が導体」 | 実装は 10 型と樽・シュルカーを導体にしている。中身は対応している型の範囲で 26.3 の状態ダンプと一致する。例外は 2 つ: solid に big_dripleaf_stem が混ざる (#6)、開いたシュルカーを区別しない (#16) | 説明が古い (16 §3.5 の power.ts:28 と同じ指摘)。判定は 2 つの例外を除いて正しい |
| 5 | power.ts の getEmittedSignal・getEmittedDirectSignal | レバー・ボタン・トーチの向きに「要検証」 | レバー・ボタンは弱 15 を 6 方向・強は取り付け先だけ。トーチは弱 15 を土台以外の 5 方向・強は真上だけ (壁トーチも真上) | 実装は正しい。要検証を外してよい |
| 6 | blocks/blockNames.ts の SOLID_SUFFIXES の _stem | _stem で終わる名前を導体の solid にする | big_dripleaf_stem は非導体・POPPED (1.21.1 から同じ) | **TS の誤り (新規)**。NOT_SOLID_EXACT に足すべき。茎は POPPED なので可動の solid にするのも誤り |
| 7 | blockNames.ts の IMMOVABLE_SOLID の説明 | 「いずれも pushReaction(BLOCK)」 | 26.3 では黒曜石 4 種が IMMOVEABLE になり、この 4 つは正しくなった。岩盤・コマンドブロック 3 種・ストラクチャー・ジグソー・エンドポータルの枠は硬さ −1、バリアは両方、スポナー・トライアルスポナー・金庫は BE、budding_amethyst は POPPED | 26.2 での誤りは 16 §3.5 の指摘どおり。26.3 に合わせるなら理由を 3 つに分けて書く。なお 16 名のうち効いているのは isSolidBlockName を通る obsidian・crying_obsidian・bedrock・reinforced_deepslate の 4 名だけで、残り 12 名は届かない (16 §3.5)。いま挙動は変わらないが、取り込むときは budding_amethyst を不動ではなく壊れるにする |
| 8 | world.ts の isMovable・isPushDestroy | — | §4.6.4 の実効の分類 | R-9・R-10 (16 §3.1) が未修正のまま。26.3 でも結論は同じ: sim は検知レールとクラフターを壊す (vanilla は可動・不動)。トラップドア・塀・ガラス板・銅の電球・ドアを動かさない (vanilla は可動・可動・可動・可動・壊れる)。カボチャ類・苔・chiseled_bookshelf を押す (vanilla は壊れる・壊れる・不動)。シュルカーを動かさない (vanilla は壊れる)。R-10 の残り: 水・泡柱を障害物にする (vanilla は壊れる)。decor の植木鉢・はしご・頭・苔のカーペットを押す (vanilla は壊れる)、看板・旗を押す (vanilla は BE で不動)。**R-9・R-10 に無い新規**: フェンスゲートを動かさない (vanilla は PUSH_PULL・BE なしで可動) |
| 9 | world.ts・types.ts のコメントの押し反応名 | NORMAL・DESTROY・BLOCK・PUSH_ONLY・STICKY | 26.3 は PUSH_PULL・POPPED・IMMOVEABLE・PUSH。STICKY はどの版にも無い | §4.6.1 の対応表で読み替える。STICKY は誤り (16 §3.5) |
| 10 | power.ts の isSignalSourceType | 17 型 | lightning_rod (銅の 8 種とも) は信号源。sim は decor に入れている。トラップチェストは container に潰していて信号源にならない。日照センサー・スカルク 2 種・フック・ジュークボックスは sim に型が無い | lightning_rod とトラップチェストは R-8 の残り (16 §2.3)。他は未実装の範囲 |
| 11 | power.ts の向きの約束 | getEmittedSignal (源, 源から読み手への向き) | vanilla は「読み手から源への向き」 | OPPOSITE で揃えていて等価。Rust では vanilla の向きに合わせる |
| 12 | power.ts の getWireWeakCharge | ダストの弱充電を強充電と別に数える | vanilla は分けない。ダストの getDirectSignal が shouldSignal の間だけ getSignal と同じになる | 結果は同じ |
| 13 | blockNames.ts の GLASS_EXACT | ガラス系・glowstone・sea_lantern・ice | 非導体フルブロックは他に葉 14・frosted_ice・beacon・chorus_flower・tnt・銅の格子 8 がある | sim は取り込めない (未対応の警告) だけで、誤分類ではない。glass 型 (押せる) に足してよいのは frosted_ice と銅の格子だけ。葉と chorus_flower は POPPED、beacon は BE で不動、tnt は点火の挙動を持つので別に扱う |
| 14 | blockNames.ts の DECOR_EXACT の chain | chain | 26.2 では iron_chain (1.21.1 は chain)。銅の鎖 8 種も同じ性質 (非導体・PUSH_PULL) | 16 §3.4 の指摘どおり |
| 15 | blocks/wire.ts の isWireCutBlock | 「isConductor そのもの」。1.21.1 の実測で導体表を確かめた | vanilla もダストの上下の切断 (RedstoneWireBlock#getMissingConnections・#getConnectingSide) と斜めの読み (RedstoneWireEvaluator#getIncomingWireSignal) に同じ isRedstoneConductor を使う | 一致。差は §5 の 9 の位置の癖だけで、効くのは開いたシュルカーが真上にあるときだけ (sim はシュルカーの開閉を持たないので今は出ない) |
| 16 | blockNames.ts の isContainerFullCube とその説明 | シュルカーボックスは色・向きによらず導体 (実機 1.21.1 の閉じた状態で測った) | 閉じている間は導体。開き具合が 0 でない間は非導体 (§4.4.3) | 閉じた状態については正しい。sim は開閉を持たないので、開いたシュルカーを導体として扱う。開閉を入れるなら導体の判定も BE の開き具合で割る [要実機] |
| 17 | blockNames.ts の SOLID_EXACT | moss_block・pumpkin・carved_pumpkin・jack_o_lantern・melon・chiseled_bookshelf を solid (押せる導体) にする | 6 つとも導体なのは正しい。押し反応は前の 5 つが POPPED、chiseled_bookshelf は BE で不動 | 導体の表としては正しい。押し反応だけ #8 のとおり違う (solid 型に押し反応を持たせるか、型を分ける) |

---

## 10. 典拠一覧

- 26.3 SignalGetter#getDirectSignal / #getDirectSignalTo / #getControlInputSignal / #hasSignal / #getSignal / #getBestOwnOrNeighbourSignal / #hasNeighborSignal / #getBestNeighborSignal
- 26.3 Level#getBlockState / #isInValidBounds / #updateNeighbourForOutputSignal
- 26.3 BlockBehaviour#isSignalSource / #shouldRedstoneWireConnectTo / #getSignal / #ownSignal / #getDirectSignal / #isCollisionShapeFullBlock / #canBeReplaced
- 26.3 BlockBehaviour.BlockStateBase のコンストラクタ / #calculateSolid / #initCache / #isRedstoneConductor / #isSignalSource / #getOwnSignal / #getSignal / #getDirectSignal / #getPistonPushReaction / #isFaceSturdy / #isCollisionShapeFullBlock
- 26.3 BlockBehaviour.BlockStateBase.Cache のコンストラクタ
- 26.3 BlockBehaviour.Properties#ofFullCopy / #ofLegacyCopy / #isRedstoneConductor / #pushReaction / #replaceable / #forceSolidOn / #forceSolidOff / #dynamicShape / #noCollision
- 26.3 Blocks の各登録、#leavesProperties / #pistonProperties / #shulkerBoxProperties / #buttonProperties / #registerStair / #registerLegacyStair / #registerSlab / #registerWall と static 初期化
- 26.3 ColorCollection#registerBlocks、WeatheringCopperCollection#registerBlocks
- 26.3 Block のコンストラクタ / #getId / #stateById / #registerDefaultState / #isShapeFullBlock
- 26.3 StateDefinition のコンストラクタ / #getPossibleStates / #any、StateHolder#cycle / #setValue
- 26.3 BooleanProperty#getPossibleValues、IntegerProperty の生成、EnumProperty#create、BlockStateProperties
- 26.3 Redstone、PushReaction
- 26.3 PistonBaseBlock#isPushable / #getNeighborSignal、PistonStructureResolver#resolve / #addBlockLine、PistonMovingBlockEntity の押しと粘着判定
- 26.3 RedstoneWireBlock#getSignal / #getDirectSignal / #isSignalSource / #shouldRedstoneWireConnectTo / #getBlockSignal / #getMissingConnections / #getConnectingSide
- 26.3 RedstoneTorchBlock#getSignal / #getDirectSignal / #ownSignal / #hasNeighborSignal、RedstoneWallTorchBlock#getSignal / #hasNeighborSignal
- 26.3 DiodeBlock#getSignal / #getDirectSignal / #ownSignal / #getInputSignal / #getAlternateSignal / #isDiode / #getOutputSignal、RepeaterBlock#shouldRedstoneWireConnectTo、ComparatorBlock#getOutputSignal
- 26.3 ObserverBlock / PoweredBlock / LeverBlock / ButtonBlock / FaceAttachedHorizontalDirectionalBlock#getConnectedDirection / BasePressurePlateBlock / PressurePlateBlock / WeightedPressurePlateBlock / TripWireHookBlock / LightningRodBlock / DetectorRailBlock / LecternBlock / TrappedChestBlock / SculkSensorBlock / CalibratedSculkSensorBlock / TargetBlock / DaylightDetectorBlock / JukeboxBlock / TestBlock の信号フック
- 26.3 CalibratedSculkSensorBlockEntity の背面の読み
- 26.3 DispenserBlock#neighborChanged、DoorBlock#neighborChanged / #getStateForPlacement、CrafterBlock#neighborChanged、RailBlock の向き決めの門番
- 26.3 ShulkerBoxBlock#getShape / #getBlockSupportShape、ShulkerBoxBlockEntity#getBoundingBox / #updateAnimation / #doNeighborUpdates / #triggerEvent、Shulker#getProgressAabb、SpeleothemBlock#isCollisionShapeFullBlock、BambooStalkBlock#isCollisionShapeFullBlock
- 26.3 MovingPistonBlock#getCollisionShape、PistonMovingBlockEntity#getCollisionShape / #moveStuckEntities / #matchesStickyCritera、ScaffoldingBlock#getCollisionShape、PowderSnowBlock#getCollisionShape
- 26.3 RailBlock#updateState、NaturalSpawner#isValidEmptySpawnBlock、LightningRodBlock#getStateForPlacement、LeavesBlock#getBlockSupportShape
- 26.3 FlowingFluid#getNewLiquid、BucketItem#emptyContents、FarmlandBlock#canSurvive、PathBlock、CactusBlock、StandingSignBlock・WallSignBlock・BannerBlock・WallBannerBlock・CakeBlock・CandleCakeBlock の canSurvive
- 26.3 TargetBlock#onPlace、RedstoneWireBlock#onPlace、StateHolder#findNextInCollection、Block#stateById / #getId
- 26.4-pre-1 JukeboxBlock (PLAYLIST_MODE・#neighborChanged・#updateShape)、JukeboxBlockEntity#isInPlaylistMode、Blocks の BRITTLE_ICE・ICE_CRYSTAL・ICICLE
- 26.3 Entity / AreaEffectCloud / Marker / Display / Interaction / OminousItemSpawner / ArmorStand の getPistonPushReaction
- 26.3 SupportType、DiodeBlock / BaseTorchBlock / WallTorchBlock / BasePressurePlateBlock / BaseRailBlock / RedstoneWireBlock / TripWireHookBlock / DoorBlock の canSurvive
- 26.3 FlowingFluid#canHoldAnyFluid、FallingBlock#isFree
- 26.3 Direction、IdMapper#add、MappedRegistry の反復
- 26.3 data の Main#main、DataProvider#saveStable、BlockListReport#run
- 版差: 1.21.1・26.2・26.4-pre-1 の SignalGetter・BlockBehaviour・PushReaction・PistonBaseBlock#isPushable・BlockStateProperties・BlockListReport・FlowingFluid#canHoldAnyFluid と、各版の状態ダンプ・reports。
  26.2 RedStoneWireBlock#shouldConnectTo、1.21.1 と 26.4-pre-1 の RedStoneWireBlock / RedstoneWireBlock の真上の導体判定、26.4-pre-1 JukeboxBlock

---

## 付録: 網羅チェックで足したもの

00_coverage.md §3.1 の網羅チェックで、本書に入るべき 2 つの族が抜けていた。G-F1 (形状更新で接続・形が変わる族) と G-F3 (支えを失うと消える族) である。本文 (§1〜§10) は変えず、ここに足す。

- 略号は 04 に合わせる。SU は形状更新、NC は近隣更新である。
- 「相手の向き」は、SU の受け手から見た、変わったブロックの向きである (04 §4.6)。
- ブロックの数と状態の数は、本文と同じ状態ダンプ (26.3) で数えた。タグの中身は 26.3 の data から展開した。
- 読んだクラスは付録 H にまとめた。扱わない隣接範囲は付録 E.3 にある。

### 付録 A. 共通の流れ (F1・F3)

[26.3 読解: NeighborUpdater#executeShapeUpdate・Block#updateOrDestroy・Level#destroyBlock] 仕組みそのものは 04 §4.6・§4.10・§5.3 にある。ここには族に効く所だけを書く。

1. あるブロックの書き込み (フラグ 16 なし) が、6 隣へ SU を西・東・北・南・下・上の順に積む。SU には積んだ時点の相手の状態が入る。
2. 受け手の updateShape が、今の自分の状態・相手の向き・相手の状態から、新しい状態を返す。予約 tick もここで積む。
3. 返った状態が今と同じなら何もしない。
4. 別の状態なら setBlock する。フラグは SU のフラグ (元の書き込みから 1 と 32 を落とした値) で、普通は 2 になる。NC は出ない。SU は深さを 1 減らして続く (04 §4.7)。
5. 空気が返ったら destroyBlock する。フラグ 3 で書くので、NC・SU・撤去フック・ゲームイベント BLOCK_DESTROY (→ 10) が出る。ドロップも出る (→ 17)。
6. 存続を予約で見直す族 (付録 B・C で「1 gt」と書いたもの) は、存続できないと分かっても updateShape では空気を返さず、自分を 1 gt で予約する。予約 tick の相で存続を見直し、駄目なら destroyBlock (ドロップあり・フラグ 3) する。

| 反応 | 書き込み | NC | 正面のオブザーバー | 例 |
|---|---|---|---|---|
| 形を変える (F1) | SU のフラグ (普通 2) | 出ない | 拾う (→ 08 §4.2.1) | 塀・板ガラス・柵・階段 |
| その場で消える (F3) | destroyBlock (フラグ 3) | 出る | 拾う | カーペット・草花・看板 |
| 1 gt 予約してから消える | 予約 tick で destroyBlock (フラグ 3) | 出る | 拾う | 竹・コーラス・昆布・垂れる苔 |
| 1 gt 予約してから書き直す | 予約 tick でフラグ 3 | 出る | 拾う | 葉の distance |

- updateShape が何を読むかはクラスで違う。「渡された相手の状態」を使うものと、世界を読み直すものがある (付録 B.1 の「読む所」の列)。入れ子の更新で、積んだ後に相手がまた変わると、両者で結果が割れる (04 §5.5)。
- canSurvive は常に世界を読み直す。渡された相手の状態は使わない。
- 保存された形が周りと合っていなくても、SU が届くまではそのままである。読み込んだ回路の形を勝手に直さない。
- ピストンで運ばれたブロックは、着地のときに 6 隣 (西・東・北・南・下・上) で updateShape にかけ直される (Block#updateFromNeighbourShapes)。空気になれば、いったん置いてからドロップ付きで壊れる (13 §4.9)。
- 族の中で押して運べるのは、F1 の塀・柵・板ガラス・鉄格子・銅の格子・階段・巨大キノコ・草ブロック類と、F3 の羊毛のカーペットと死んだサンゴだけである。ほかは POPPED (押すと壊れる)・BE 持ち (看板・旗・焚き火は動かない)・IMMOVEABLE (砥石) のどれかである (状態ダンプ。§4.6)。

#### A.1 ピストンで支えが動くとき

[26.3 読解: PistonBaseBlock#moveBlocks・MovingPistonBlock#getCollisionShape・PistonMovingBlockEntity#getCollisionShape、Blocks の moving_piston の登録]

支えのセルは 13 §4.8 の手順で 2 通りに変わる。結果は、支えの判定が何を見るかで割れる。

| 支えのセルの変わり方 | そのときの SU | 空気でないか | legacy solid | 面の頑丈さ・当たり判定の面 | タグ |
|---|---|---|---|---|---|
| 行き先・腕になる (moving_piston) | moving_piston を置いた瞬間 (フラグ 324)。この時点で BE はまだ無い | 真 | 真 (登録で forceSolidOn) | 空 (BE が無いので形が空) | どのタグにも入らない |
| 空く (空気になる) | 13 §4.8 手順 8 (フラグ 2) | 偽 | 偽 | 空 | — |
| 着地する | フラグ 67 の書き込み | 着地したブロックの値 | 同左 | 同左 | 同左 |

- まっすぐ押す列では、どのセルも行き先か腕になり、空気のセルは出ない。列の上のカーペット (空気でなければよい) と旗・看板 (legacy solid を見る) は残る。花 (タグを見る)・ランタン (CENTER を見る)・はしご (FULL を見る) は、moving_piston を置いた瞬間に消える [26.3 読解] [要実機]。
- 粘着ピストンで引いて空いたセルの上は、どれも消える。
- 運ぶ途中で BE が付いた後の moving_piston の形は、中身の形を進み具合だけずらしたものになる。そのあいだに別の SU が届くと、面の判定は進み具合で変わる [要実機]。

### 付録 B. F1: 形状更新で接続・形が変わる族

#### B.1 一覧

| クラス (26.3) | ブロック (数) | 状態 (値の並び・既定) | SU で変えるもの | 見る向き | 読む所 | 予約 |
|---|---|---|---|---|---|---|
| WallBlock | 塀 32 (タグ walls) | up (既定 true)・north/east/south/west (none・low・tall。既定 none)・waterlogged。324 状態 | 4 辺と up | 上と横 (下は見ない) | 横の辺は渡された相手。真上は、上からの SU なら渡された相手、横からの SU なら世界 | 水 (水を含むとき 5 gt) |
| IronBarsBlock・StainedGlassPaneBlock・WeatheringCopperBarsBlock | 板ガラス 17・iron_bars・銅の格子 8 | north/east/south/west・waterlogged。32 状態。既定すべて偽 | 相手の向きの真偽 | 横だけ | 渡された相手 | 水 |
| FenceBlock (CrossCollisionBlock の子) | 柵 14 | 同上 | 相手の向きの真偽 | 横だけ | 渡された相手 | 水 |
| StairBlock・WeatheringCopperStairBlock | 階段 97 | facing (north・south・west・east)・half (top・bottom)・shape (下の値)・waterlogged。80 状態。既定 north・bottom・straight・偽 | shape | 横だけ | 世界 | 水 |
| ChorusPlantBlock (PipeBlock の子) | chorus_plant | north/east/south/west/up/down。64 状態。既定すべて偽 | 相手の向きの真偽 | 全方向 | 渡された相手 (存続は世界) | 存続できなければ自分を 1 gt |
| HugeMushroomBlock | brown_mushroom_block・red_mushroom_block・mushroom_stem | 6 方向の真偽。64 状態。既定すべて真 | 相手の向きを偽にするだけ | 全方向 | 渡された相手 | なし |
| MossyCarpetBlock | pale_moss_carpet | bottom (既定真)・north/east/south/west (none・low・tall)。162 状態 | 4 辺・存続 | 全方向 | 世界 | なし |
| VineBlock | vine | up・north・east・south・west (下の面は無い)。32 状態。既定すべて偽 | すべての面・存続 | 下以外 | 世界 | なし |
| MultifaceBlock・GlowLichenBlock・SculkVeinBlock | resin_clump・glow_lichen・sculk_vein | 6 面・waterlogged。128 状態。既定すべて偽 | 相手の向きの面 | 全方向 | 渡された相手 | 水 |
| SnowyBlock・SpreadingSnowyBlock の子 (GrassBlock・MyceliumBlock) | podzol・grass_block・mycelium | snowy (既定偽)。2 状態 | snowy | 上だけ | 渡された相手 | なし |
| AttachedStemBlock | attached_pumpkin_stem・attached_melon_stem | facing (既定 north)。4 状態 | 茎へ戻る・存続 | facing (戻る)・全方向 (存続) | 渡された相手 (存続は世界) | なし |
| CampfireBlock | campfire・soul_campfire | lit (既定真)・signal_fire・waterlogged・facing。32 状態 | signal_fire | 下だけ | 渡された相手 | 水 |
| LeavesBlock とその子 | 葉 14 | distance (1〜7。既定 7)・persistent (既定偽)・waterlogged。28 状態 | 変えない (予約するだけ) | 全方向 | 予約の条件は渡された相手。tick は世界 | 自分を 1 gt。水 |
| GrowingPlantHeadBlock・GrowingPlantBodyBlock とその子 | kelp・kelp_plant・twisting_vines・twisting_vines_plant・weeping_vines・weeping_vines_plant・cave_vines・cave_vines_plant | 先端は age (0〜25)。洞窟のつたは先端・胴とも berries を持つ | 先端と胴の入れ替え | 根元側と伸びる側 | 両方 (B.16) | 存続できなければ自分を 1 gt。昆布は水 |
| BambooStalkBlock | bamboo | age (0〜1)・leaves (none・small・large)・stage (0〜1)。12 状態 | age | 上 (age)・全方向 (存続) | 渡された相手 (存続は世界) | 存続できなければ自分を 1 gt |

- 値の並び: StairsShape は straight・inner_left・inner_right・outer_left・outer_right。WallSide は none・low・tall。
- 子クラスで足すものは小さい。StainedGlassPaneBlock は色だけ、WeatheringCopperBarsBlock・WeatheringCopperStairBlock は酸化 (F5。14 §4.12) だけ、葉の子 (MangroveLeavesBlock・TintedParticleLeavesBlock・UntintedParticleLeavesBlock・FallingParticlesLeavesBlock) は粒子・音・骨粉だけ、KelpPlantBlock・TwistingVinesPlantBlock・WeepingVinesPlantBlock は伸びる向きと相方を決めるだけである。PipeBlock と CrossCollisionBlock は形を作る親で、自分の updateShape を持たない。
- 予約の遅延と条件の全表は 02 §4.9 (表 C・表 D) にある。

#### B.2 塀 (WallBlock)

[26.3 読解: WallBlock#updateShape・#topUpdate・#sideUpdate・#shouldRaisePost・#updateSides・#makeWallState・#connectsTo]

SU を受けたとき:

1. waterlogged なら、水を 5 gt で予約する。
2. 相手の向きが下なら何もしない。
3. 相手の向きが上なら、4 辺の「つながっているか (none でないか)」は今のまま使う。真上の状態には、渡された相手の状態を使う。
4. 相手の向きが横なら、その辺だけ、渡された相手の状態でつながるかを決め直す (B.5)。ほかの 3 辺は今のつながりのまま。真上の状態は世界から読む。
5. 真上のブロックの当たり判定 (真上の座標で求めたもの) の、下向きの面を取る (以下「底面」)。
6. つながる辺は、底面がその辺の帯を覆えば tall、覆わなければ low。つながらない辺は none。帯は幅 2 ピクセル (x 7〜9) で、その辺の端から中心を 1 ピクセル越えた所まで (北なら z 0〜9) である。
7. up を決める (WallBlock#shouldRaisePost)。上から順に見る。
   1. 真上が塀で、その up が真なら真。ほかは見ない。
   2. 形が「北南だけの直線」「東西だけの直線」「4 辺すべての十字」のどれでもないなら真。4 辺すべて none (単独の柱) もここで真になる。
   3. 北と南が両方 tall、または東と西が両方 tall なら偽。
   4. 真上がタグ wall_post_override なら真。26.3 で 81 種: トーチ 4 (torch・soul_torch・redstone_torch・copper_torch)・tripwire・看板 13 と壁の看板 13・旗 16 と壁の旗 16・感圧板 17・cactus_flower。
   5. 底面が中心の 2×2 ピクセル (x 7〜9・z 7〜9) を覆えば真。それ以外は偽。

真上のブロックと、北南の直線の塀の結果 (手順 6・7 の当てはめ):

| 真上 | 底面 | 北の帯 | 中心 | 結果 (north・south・up) |
|---|---|---|---|---|
| 空気・上付きハーフ | 空 | 覆わない | 覆わない | low・low・偽 |
| 石・下付きハーフ・下付きの階段・カーペット・閉じた下付きのトラップドア | 満ちる | 覆う | 覆う | tall・tall・偽 (7.3) |
| 単独の柵 (柱は x 6〜10) | 中央の 4×4 | 覆わない | 覆う | low・low・真 (7.5) |
| 単独の板ガラス (柱は x 7〜9) | 中央の 2×2 | 覆わない | 覆う | low・low・真 |
| 北南につながった板ガラス | 柱と腕で z 0〜16 | 覆う | 覆う | tall・tall・偽 |
| トーチ・看板・旗・感圧板・tripwire | 空 | 覆わない | 覆わない | low・low・真 (7.4) |
| up が真の塀 | — | 上の塀の辺しだい | — | 真 (7.1) |

- 上の塀の底面は、柱 (x 4〜12) と、つながった辺 (幅 x 5〜11) でできる。下の塀の辺が tall になるのは、上の塀の同じ辺がつながっているときだけである。柱だけでは帯を覆わない。
- 更新: 形が変わると SU のフラグ (普通 2) で書く。NC は出ない。その書き込みの SU が、下の塀には「上からの SU」として届く。手順 3 と 7.1 で、下の塀の up が上の塀に合わせて決め直される。だから柱の変化は列を下へ、同じ連鎖の中で全段に伝わる [実機 1.21.1: wall-post-cascade] (7 段の柱が同じ tick に反転し、下端のオブザーバーが 2 gt 後に点く)。
- 逆向き (up が真から偽) も同じ連鎖で伝わる。上の塀が up を失うと、下の塀は手順 7.2 以降で決め直す。直線の柱では、上の塀の辺で底面が覆われるので、7.3 で偽になる。
- 上へは伝わらない (下からの SU は無視する)。横の塀にも「横からの SU」が届くが、塀どうしは常につながり、横の塀の真上も変わっていないので、横の塀の形は変わらない。横の塀が変わるのは、つながる相手の種類が変わったとき (塀が別のブロックになったときなど) である。
- 深さの上限 (04 §4.7) は、縦の列では届かない (高さ 384 が 512 より小さい)。

#### B.3 板ガラス・鉄格子・銅の格子 (IronBarsBlock とその子)

[26.3 読解: IronBarsBlock#updateShape・#attachsTo、CrossCollisionBlock]

1. waterlogged なら水を予約する。
2. 相手の向きが上下なら何もしない。
3. 横なら、その向きの真偽を、渡された相手の状態で決め直す。相手の面の頑丈さ (FULL) は相手の座標で求める。

- つながる相手は B.5。板どうしはクラスで判定するので、板ガラス・色つきの板・鉄格子・銅の格子は互いにつながる。
- 板の書き換えは、隣の板のつながりを変えない (隣の板が見るのは種類だけ)。だから連鎖は 1 段で止まる。
- 板の接続の変化を、真下や横のオブザーバーが拾う [実機 1.21.1: pane-shape-observer] (packages/sim/test/fixtures/ にある。伸びたピストンの側面とは切れ、着地したヘッドの板の面とはつながる)。

#### B.4 柵 (FenceBlock)

[26.3 読解: FenceBlock#updateShape・#connectsTo・#isSameFence、FenceGateBlock#connectsToDirection]

- 板と同じく横からの SU だけを見て、渡された相手の状態でその向きの真偽を決め直す。
- 同じ系統の柵: タグ fences に入り、かつ wooden_fences に入るかどうかが自分と同じもの。木の柵 13 種は互いにつながり、nether_brick_fence は自分どうしだけにつながる。
- フェンスゲートとは、ゲートの左右 (扉の板が並ぶ向き) の隣にいるときだけつながる。判定は「ゲートの facing の軸が、ゲートから見た自分の向きを時計回りに回した向きの軸と同じ」かどうかである。ゲートの前後の隣とはつながらない。塀も同じ判定を使う。
- ゲートの in_wall (横の塀で下がる) は → 11。

#### B.5 接続の早見表

[26.3 読解: WallBlock#connectsTo・IronBarsBlock#attachsTo・FenceBlock#connectsTo・Block#isExceptionForConnection]

| 相手 | 塀から | 板・格子から | 柵から |
|---|---|---|---|
| 塀 (タグ walls) | つながる | つながる | つながらない |
| 板ガラス・鉄格子・銅の格子 (IronBarsBlock) | つながる | つながる | つながらない |
| 同じ系統の柵 | つながらない | つながらない | つながる |
| フェンスゲート | 左右の隣だけ | つながらない | 左右の隣だけ |
| 向き合う面が FULL で頑丈なブロック | つながる | つながる | つながる |
| そのうちの例外 | つながらない | つながらない | つながらない |
| 頑丈でない面 (ハーフの横・階段の段の側・柵や塀の横など) | つながらない | つながらない | つながらない |

- 例外 (Block#isExceptionForConnection) は 7 系統: LeavesBlock の全部 (葉 14)・barrier・carved_pumpkin・jack_o_lantern・melon・pumpkin・タグ shulker_boxes (17)。どれも面は頑丈でも、つながらない。
- 導体かどうかは関係ない。ガラスは非導体だがつながる。閉じたシュルカーボックスは導体だがつながらない。
- 面の頑丈さは状態の表で引く (§4.7.4)。動的な形 (moving_piston・シュルカーボックス) だけ実行時に求める。

#### B.6 階段 (StairBlock)

[26.3 読解: StairBlock#updateShape・#getStairsShape・#canTakeShape]

- 横からの SU で shape を決め直す。上下からは水の予約だけ。
- 決め方は世界を読む (渡された相手の状態は使わない)。facing の向きの隣を「後ろ」(段の高い側)、facing の逆の隣を「前」(低い側) とよぶ。
  1. 後ろが階段で half が同じ、かつ後ろの facing の軸が自分と違う。さらに、自分から見て「後ろの facing の逆」の向きの隣が、facing も half も自分と同じ階段ではない。このとき、後ろの facing が自分の facing を反時計回りに回した向きなら outer_left、そうでなければ outer_right。
  2. 1 に当たらず、前が階段で half が同じ、かつ前の facing の軸が自分と違う。さらに、自分から見て「前の facing」の向きの隣が、facing も half も自分と同じ階段ではない。このとき、前の facing が自分の facing の反時計回りなら inner_left、そうでなければ inner_right。
  3. どちらでもなければ straight。
- 更新: shape が変わると SU のフラグで書き、正面のオブザーバーが拾う。shape は隣の階段の shape を見ない (見るのは facing と half だけ) ので、連鎖は 1 段で止まる。

#### B.7 コーラスプラント (ChorusPlantBlock・PipeBlock)

[26.3 読解: ChorusPlantBlock#updateShape・#canSurvive・#tick・#getStateWithConnections]

SU を受けたとき:

1. 存続できなければ、自分を 1 gt で予約する。状態は変えない。
2. 存続できれば、相手の向きの真偽を書き換える。真になるのは、渡された相手が chorus_plant か chorus_flower のとき。下向きなら、タグ supports_chorus_plant (end_stone) でも真。

存続 (canSurvive):

1. 「真上と真下がどちらも空気でない」を A とする。
2. 北・東・南・西の順に、隣がコーラスプラントなら: A なら偽で終わる。その隣の真下がコーラスプラントか end_stone なら真で終わる。
3. 最後に、真下がコーラスプラントか end_stone なら真。そうでなければ偽。

- 予約 tick で、まだ存続できなければ destroyBlock (ドロップあり)。根元を外すと、1 gt に 1 本ずつ上へ壊れていく [26.3 読解] [要実機]。

#### B.8 巨大キノコ (HugeMushroomBlock)

[26.3 読解: HugeMushroomBlock#updateShape・#getStateForPlacement]

- 6 方向の真偽は「その面が外側の模様か」である。
- SU: 渡された相手が自分と同じブロックなら、その向きを偽にする。茶・赤・柄は別のブロックとして扱う。それ以外は何もしない。
- 一方通行である。SU で真に戻ることは無い。真になるのは置くときだけで、隣が同じブロックでない面が真になる。ピストンで離しても、着地の updateShape でも、偽の面は戻らない。

#### B.9 青白い苔のカーペット (MossyCarpetBlock)

[26.3 読解: MossyCarpetBlock#updateShape・#canSurvive・#getUpdatedState・#canSupportAtFace・#hasFaces]

- 状態: bottom (真は床のカーペット、偽は上に伸びた部分)、4 辺の none/low/tall。
- 存続: bottom が真なら、真下が空気でないこと。偽なら、真下が bottom 真の pale_moss_carpet であること。

SU を受けたとき (向きによらない。世界を読む):

1. 存続できなければ空気 (その場で壊れる)。
2. 北・東・南・西の順に各辺を決める。横の隣に「付けられる面」が無ければ none。付けられる面とは、隣の向き合う面が、支えの形か当たり判定のどちらかで満ちていること (MultifaceBlock#canAttachTo)。付けられるなら、bottom が真のとき low、偽のとき今の値のまま。
3. その辺が low のときだけ、次の 2 つを見る。真上が「その辺が none でなく、bottom が偽の pale_moss_carpet」なら tall にする。bottom が偽で、真下の pale_moss_carpet のその辺が none なら none にする。
4. bottom が偽で、辺がすべて none になったら空気。

- bottom が真のものは、横に壁が来るたびに low の辺を生やす。偽のものは辺を増やせない。
- 置いたときと骨粉で上に伸ばす部分 (乱数) は F2 → 11。

#### B.10 つた (VineBlock)

[26.3 読解: VineBlock#updateShape・#getUpdatedState・#canSupportAtFace・#isAcceptableNeighbour・#canSurvive・#getStateForPlacement]

SU を受けたとき (下からなら何もしない。それ以外は世界を読んで全部の面を決め直す):

1. up が真なら、真上のブロックで決め直す (下の注意を見よ)。
2. 北・東・南・西の順に、真の面ごとに: その向きの隣の向き合う面が満ちているか、真上が同じ面を持つつたなら真のまま。どちらでもなければ偽。
3. 面が 1 つも無くなれば空気 (その場で壊れる)。

- 存続 (canSurvive) は「決め直した後に面が残るか」である。
- 垂れ下がりの連鎖: 横の面は、真上のつたの同じ面で支えられる。壁を外すと、上のつたから順に SU で面を失い、同じ連鎖の中で下の端まで消える。
- 注意 [26.3 読解] [要実機]: 設置の判定 (canSupportAtFace) は、up に真上のブロックの下の面を見る。SU での決め直し (getUpdatedState) は、向きを下として渡すので、真上のブロックの上の面を見る。フルブロックなら同じだが、真上を下付きハーフに替えると up を失い (ほかの面が無ければ消える)、上付きハーフに替えると up が残る読みになる。置くときは canSurvive も通すので、下付きハーフの下には初めから置けない。1.21.1 から同じ。
- 広がり (ランダム tick) は F2 → 11。

#### B.11 光る地衣類・スカルクの脈・樹脂の塊 (MultifaceBlock とその子)

[26.3 読解: MultifaceBlock#updateShape・#canAttachTo・#canSurvive・#removeFace・#hasAnyFace]

1. waterlogged なら水を予約する。
2. 面が 1 つも無ければ空気。
3. 相手の向きの面を持っていて、渡された相手の状態でその面が付けられないなら、その面を消す。付けられるとは、相手の向き合う面が、支えの形か当たり判定のどちらかで満ちていること。面が無くなれば空気。
4. ほかの面は見直さない。

- canSurvive (すべての面が付けられ、1 面以上ある) は置くときだけ使う。SU では使わない。
- 当たり判定でも付けられるので、支えの形が空の葉 (§4.7.4) にも付く。
- 子の GlowLichenBlock・SculkVeinBlock は広がり (F2・10) を足すだけで、updateShape は親のまま。

#### B.12 雪をかぶる土 (SnowyBlock とその子)

[26.3 読解: SnowyBlock#updateShape・#isSnowySetting]

- 上からの SU で、渡された真上の状態がタグ snow (snow・snow_block・powder_snow) なら snowy を真、それ以外は偽にする。
- 上に雪を置く・消すと snowy が変わり、正面のオブザーバーが拾う。
- 草・菌糸の広がりと土への戻り (SpreadingSnowyBlock のランダム tick) は F2 → 11。

#### B.13 実のついた茎 (AttachedStemBlock)

[26.3 読解: AttachedStemBlock#updateShape・#mayPlaceOn、VegetationBlock#updateShape]

1. 相手の向きが facing (実のある向き) で、渡された相手が実 (pumpkin・melon) でなければ、茎 (pumpkin_stem・melon_stem) の既定の状態を age 7 にして返す。
2. それ以外は VegetationBlock#updateShape と同じ。真下がタグ supports_pumpkin_stem / supports_melon_stem (どちらも farmland) でなければ空気。

- くり抜いたかぼちゃ (carved_pumpkin) は実ではない。実を壊すか、くり抜くと茎に戻る。
- 自動収穫機では、茎の戻りを茎の正面のオブザーバーが拾う。茎が次の実を置くのは F2 → 11。

#### B.14 焚き火 (CampfireBlock)

[26.3 読解: CampfireBlock#updateShape・#isSmokeSource]

- 下からの SU で、渡された真下が hay_block なら signal_fire を真、それ以外は偽にする。ほかの向きでは水の予約だけ。
- 点火・消火・水を入れたときは → 11・12 §4.9・17 §4.8。

#### B.15 葉 (LeavesBlock とその子)

[26.3 読解: LeavesBlock#updateShape・#tick・#updateDistance・#getOptionalDistanceAt・#randomTick・#isRandomlyTicking・#getStateForPlacement]

- 「隣の距離」: タグ prevents_nearby_leaf_decay (中身は #logs。原木と木 48 種) なら 0。distance を持つブロック (葉) ならその値。それ以外は 7。

SU を受けたとき:

1. waterlogged なら水を予約する。
2. d = 渡された相手の距離 + 1 とする。d が 1 でない、または自分の distance が d でないなら、自分を 1 gt で予約する。状態は変えない。

予約 tick:

1. 下・上・北・南・西・東の順に、隣の距離 + 1 の最小を求める。初めは 7 で、1 になったら打ち切る。
2. その値を distance にして、フラグ 3 で書く。同じ状態なら何も起きない (04 §5.1)。

- 書き込みはフラグ 3 なので、NC と SU が出る。隣の葉は SU で予約し、次の gt に決め直す。だから距離の変化は 1 gt に 1 マスずつ伝わる。例: distance 7 の葉を一直線に並べ、端に原木を置くと、k 番目の葉は k gt 後に distance k になる [26.3 読解] [要実機]。
- persistent は距離の計算に効かない。置いた葉も distance を書き直すので、オブザーバーにも NC を見る部品にも見える。
- 自然の落葉 (ランダム tick。persistent が偽で distance 7 のときだけ受ける) は F2 → 11。消えるときは removeBlock (フラグ 3)。
- 支えの形が空なので、どの面も支えにならない (§4.7.4)。

#### B.16 伸びる植物 (GrowingPlantBlock・GrowingPlantHeadBlock・GrowingPlantBodyBlock とその子)

[26.3 読解: GrowingPlantHeadBlock#updateShape・GrowingPlantBodyBlock#updateShape・GrowingPlantBlock#canSurvive・#tick・#canAttachTo、KelpBlock#canAttachTo、CaveVinesBlock・CaveVinesPlantBlock の berries の引き継ぎ]

| 種類 | 伸びる向き | 根元側 | 水の予約 | 付けられない相手 |
|---|---|---|---|---|
| 昆布 (kelp・kelp_plant) | 上 | 下 | する | magma_block (タグ cannot_support_kelp) |
| ねじれツタ (twisting_vines・_plant) | 上 | 下 | しない | — |
| しだれツタ (weeping_vines・_plant) | 下 | 上 | しない | — |
| 洞窟のつた (cave_vines・_plant) | 下 | 上 | しない | — |

存続 (canSurvive): 根元側の隣が「付けられない相手」でなく、かつ同じ植物の先端か胴であるか、伸びる向きの面が FULL で頑丈であること。

先端 (head) の SU:

1. 根元側から: 存続できなければ自分を 1 gt で予約する。存続できて、伸びる向きの隣 (世界を読む) が先端か胴なら、胴に変わる。
2. 伸びる向きから: 渡された相手が先端か胴なら、胴に変わる。
3. それ以外: 昆布なら水を予約し、変えない。

胴 (body) の SU:

1. 根元側から: 存続できなければ自分を 1 gt で予約する。
2. 伸びる向きから: 渡された相手が胴でも先端でもなければ、先端に変わる。先端の age は 0〜24 の乱数で、updateShape に渡された乱数 (Level の乱数) を引く (→ 18 §4.6.4)。
3. それ以外: 昆布なら水を予約する。

- 予約 tick で、まだ存続できなければ destroyBlock (ドロップあり)。根元を外すと 1 gt に 1 段ずつ壊れる。
- 洞窟のつたは、先端と胴が入れ替わるときに berries を引き継ぐ。
- 昆布の自動収穫機: 胴を壊すと、下の胴が先端に変わる。その書き込みを正面のオブザーバーが拾う。

#### B.17 竹 (BambooStalkBlock)

[26.3 読解: BambooStalkBlock#updateShape・#canSurvive・#tick]

1. 存続できなければ、自分を 1 gt で予約する。
2. 上からの SU で、渡された相手が竹で、その age が自分より大きければ、age を 1 進める (0 から 1)。

- 存続: 真下がタグ supports_bamboo (17 種: 竹・竹の芽・砂 3・土の仲間 10・砂利 2)。
- 予約 tick で、まだ存続できなければ destroyBlock。1 gt に 1 段ずつ壊れる。
- 竹の芽 (BambooSaplingBlock) は付録 C.1。上に竹が来ると竹に変わる。

### 付録 C. F3: 支えを失うと消える族

§4.7.4 はレッドストーン部品の支えだけを書いた。ここで残りのブロックを全部書く。

#### C.1 存続の条件の表

[26.3 読解: 各クラスの canSurvive・mayPlaceOn・updateShape]

- 「見る SU の向き」以外の向きから SU が来ても、存続は見直さない。支えが SU なしで変わった場合 (フラグ 16 の書き込みなど) も残る。
- 「その場」は updateShape が空気を返して、その SU の中で壊れる。「1 gt」は予約してから壊れる。
- 面の頑丈さ (FULL・CENTER) と legacy solid の意味は §4.7.4・§4.7.2。

**真下を見るもの (VegetationBlock の系統)**

VegetationBlock#updateShape は、向きによらず SU のたびに存続を見る。存続は「真下が mayPlaceOn を満たす」で、mayPlaceOn をクラスごとに上書きする。

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| 存続の判定を上書きしない VegetationBlock の子: FlowerBlock・TallGrassBlock・BushBlock・FireflyBushBlock・FlowerBedBlock・SaplingBlock・SweetBerryBushBlock・EyeblossomBlock | 花 14・short_grass・fern・bush・red_shrub・firefly_bush・pink_petals・wildflowers・苗木 9・sweet_berry_bush・目の花 2 | 真下がタグ supports_vegetation (11: dirt・coarse_dirt・rooted_dirt・mud・muddy_mangrove_roots・moss_block・pale_moss_block・grass_block・podzol・mycelium・farmland) | 全方向 | その場 |
| WitherRoseBlock | wither_rose | supports_wither_rose (14 = 上の 11 + netherrack・soul_sand・soul_soil) | 全方向 | その場 |
| NetherSproutsBlock・NetherRootsBlock・NetherFungusBlock | nether_sprouts・warped_roots・crimson_roots・warped_fungus・crimson_fungus | それぞれのタグ (どれも 14 = 上の 11 + crimson_nylium・warped_nylium・soul_soil) | 全方向 | その場 |
| DryVegetationBlock とその子 ShortDryGrassBlock・TallDryGrassBlock | dead_bush・short_dry_grass・tall_dry_grass | supports_dry_vegetation (31 = sand・red_sand・suspicious_sand + テラコッタ 17 + supports_vegetation の 11) | 全方向 | その場 |
| AzaleaBlock | azalea・flowering_azalea | supports_azalea (12 = supports_vegetation + clay) | 全方向 | その場 |
| CropBlock とその子 (CarrotBlock・PotatoBlock・BeetrootBlock・TorchflowerCropBlock) | wheat・carrots・potatoes・beetroots・torchflower_crop | 真下が supports_crops (farmland) で、かつ自分の位置の明るさ (空の暗さを 0 とした生の値) が 8 以上 | 全方向 | その場 |
| StemBlock | pumpkin_stem・melon_stem | supports_pumpkin_stem・supports_melon_stem (どちらも farmland) | 全方向 | その場 |
| AttachedStemBlock | attached_pumpkin_stem・attached_melon_stem | 茎と同じ (F1 の戻りは B.13) | 全方向 | その場 |
| NetherWartBlock | nether_wart | supports_nether_wart (soul_sand) | 全方向 | その場 |
| MushroomBlock | brown_mushroom・red_mushroom | 真下がタグ overrides_mushroom_light_requirement (mycelium・podzol・crimson_nylium・warped_nylium) なら真。それ以外は、明るさが 13 未満で、かつ真下が isSolidRender (光を通さない、形の満ちたブロック) | 全方向 | その場 |
| LilyPadBlock | lily_pad | 真下の流体が流体タグ supports_lily_pad (水源だけ) か、真下がタグ supports_lily_pad (ice・frosted_ice)。かつ自分の位置に流体が無い | 全方向 | その場 |
| CactusFlowerBlock | cactus_flower | 真下がタグ support_override_cactus_flower (cactus・farmland) か、真下の上面が CENTER で頑丈 | 全方向 | その場 |
| LeafLitterBlock | leaf_litter | 真下の上面が FULL で頑丈 | 全方向 | その場 |
| SeaPickleBlock | sea_pickle | 真下の当たり判定の上面が空でないか、上面が FULL で頑丈 | 全方向 | その場 |
| MangrovePropaguleBlock | mangrove_propagule | hanging なら、真上がタグ supports_hanging_mangrove_propagule (mangrove_leaves)。そうでなければ、真下が supports_mangrove_propagule (12 = supports_vegetation + clay) | 全方向 (上からは自前、ほかは親) | その場 |
| BambooSaplingBlock (VegetationBlock の外) | bamboo_sapling | 真下が supports_bamboo (17) | 全方向 | その場 |

**二重の植物 (DoublePlantBlock の系統)**

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| DoublePlantBlock・TallFlowerBlock | tall_grass・large_fern・pitcher_plant・sunflower・lilac・rose_bush・peony | 下半分: 真下が supports_vegetation。上半分: 真下が同じブロックの下半分 | 全方向 (親)。加えて C.2 の相方の確認 | その場 |
| SmallDripleafBlock | small_dripleaf | 下半分: 真下がタグ supports_small_dripleaf (clay・moss_block)、または「自分の位置が水源で、真下が supports_vegetation」。上半分: 同じブロックの下半分 | 同上 | その場 |
| TallSeagrassBlock | tall_seagrass | 下半分: 真下の上面が FULL で頑丈、真下がタグ cannot_support_seagrass (magma_block) でない、自分の位置が満ちた水。上半分: 下半分 | 同上 | その場 (→ 16 §4.11) |
| PitcherCropBlock | pitcher_crop | age 0〜2 は 1 マスで、SU のたびに存続を見る。age 3〜4 は 2 マスで、DoublePlantBlock と同じ。下半分は明るさ 8 以上も要る。真下は supports_crops (farmland) | 全方向 | その場 |

**床に置くもの**

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| CarpetBlock・WoolCarpetBlock | moss_carpet・カーペット 16 色 | 真下が空気 (air・cave_air・void_air) でない | 全方向 | その場 |
| MossyCarpetBlock | pale_moss_carpet | B.9 | 全方向 | その場 |
| SoulFireBlock | soul_fire | 真下がタグ soul_fire_base_blocks (soul_sand・soul_soil)。存続できるときは既定の状態を返す | 全方向 | その場 |
| SnowLayerBlock (網羅表では 16・05 の記述済に入る。規則はここで補う) | snow | 真下がタグ cannot_support_snow_layer (ice・packed_ice・barrier) なら偽。support_override_snow_layer (honey_block・soul_sand・mud) なら真。それ以外は、真下の当たり判定の上面が満ちているか、真下が 8 層の雪 | 全方向 | その場 |
| BannerBlock (親の AbstractBannerBlock は色と BE を持つだけ) | 旗 16 | 真下が legacy solid | 下だけ | その場 |
| StandingSignBlock (親の SignBlock は水の予約だけ) | 看板 13 | 真下が legacy solid | 下だけ | その場 |
| BaseCoralPlantTypeBlock の子 (CoralPlantBlock・CoralFanBlock・BaseCoralPlantBlock・BaseCoralFanBlock) | サンゴ 5・サンゴの扇 5 (生と死で 20) | 真下の上面が FULL で頑丈 | 下だけ | その場。生きたサンゴは水が無いと 60〜99 gt で死ぬ (02 §4.9 表 C) |

**横に取り付けるもの** (取り付け先は facing の逆の隣)

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| WallBannerBlock | 壁の旗 16 | 取り付け先が legacy solid | 取り付け先だけ | その場 |
| WallSignBlock | 壁の看板 13 | 取り付け先が legacy solid | 取り付け先だけ | その場 |
| LadderBlock | ladder | 取り付け先の、facing 向きの面が FULL で頑丈 | 取り付け先だけ | その場 |
| AmethystClusterBlock | amethyst_cluster・large/medium/small_amethyst_bud | 同上 (facing は 6 方向) | 取り付け先だけ | その場 |
| ShelfMushroomBlock (26.3 で新設) | shelf_mushroom | 同上 | 取り付け先だけ | その場 |
| BaseCoralWallFanBlock・CoralWallFanBlock | 壁のサンゴの扇 (生と死で 10) | 同上 | 取り付け先だけ | その場 |
| CocoaBlock | cocoa | facing の向き (幹の側) の隣がタグ supports_cocoa (jungle_log・jungle_wood・stripped の 2) | facing だけ | その場 |

**吊るすもの**

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| CeilingHangingSignBlock | 吊り看板 13 | 真上の下面が CENTER で頑丈 | 上だけ | その場 |
| LanternBlock・WeatheringLanternBlock | lantern・soul_lantern・銅のランタン 8 | hanging が真: 真上の下面が CENTER で頑丈で、かつ真上がタグ unstable_bottom_center (木のフェンスゲート 13) でない。偽: 真下の上面が CENTER で頑丈 | 吊りは上だけ。置きは下だけ | その場 |
| SporeBlossomBlock | spore_blossom | 真上の下面が CENTER で頑丈 (木のフェンスゲートを除く) で、かつ自分の位置が水でない | 上だけ | その場 |
| HangingRootsBlock | hanging_roots | 真上の下面が FULL で頑丈 | 上だけ | その場 |
| HangingMossBlock | pale_hanging_moss | 真上の下面が満ちる (支えの形か当たり判定) か、真上が pale_hanging_moss | 全方向 | 1 gt |

**予約してから消えるもの** (B のコーラスプラント・竹・伸びる植物を除く)

| クラス | ブロック | 存続の条件 | 見る SU の向き | 消え方 |
|---|---|---|---|---|
| ChorusFlowerBlock | chorus_flower | C.2 | 上以外 | 1 gt |
| CactusBlock (成長は F2) | cactus | 横 4 方向に legacy solid も溶岩も無く、真下がサボテンか supports_cactus (sand・red_sand・suspicious_sand)、かつ真上が液体でない | 全方向 | 1 gt |
| SugarCaneBlock (成長は F2) | sugar_cane | 真下がサトウキビなら真。真下が supports_sugar_cane (13) なら、真下の横 4 方向のどれかが水 (流体タグ supports_sugar_cane_adjacently は #water なので流水も) か frosted_ice | 全方向 | 1 gt |

#### C.2 手順が込み入るもの

[26.3 読解: DoublePlantBlock#updateShape・#canSurvive、ChorusFlowerBlock#updateShape・#canSurvive・#tick、HangingMossBlock#updateShape・#canStayAtPosition・#tick]

二重の植物の SU:

1. 相手の向きが「相方の向き」(下半分なら上、上半分なら下) で、渡された相手が「同じブロックで half が違うもの」でなければ、空気。
2. そうでなければ、下半分で下からの SU のとき、存続できなければ空気。
3. 残りは VegetationBlock#updateShape (向きによらず存続を見る)。

- だから片方を壊すと、もう片方は同じ連鎖の中で消える。下半分の支えを外すと、下半分が消え、その SU で上半分も消える。

コーラスフラワーの存続:

1. 真下がコーラスプラントか、タグ supports_chorus_flower (end_stone) なら真。
2. 真下が空気でなければ偽。
3. 真下が空気なら、横 4 方向を北・東・南・西の順に見る。コーラスプラントがちょうど 1 つで、残りがすべて空気なら真。それ以外は偽。

- SU は上以外の向きのときだけ存続を見て、駄目なら 1 gt で予約する。予約 tick でまだ駄目なら destroyBlock。
- 投射物で壊れる経路は → 17。

垂れる苔 (pale_hanging_moss) の SU:

1. 存続できなければ、自分を 1 gt で予約する。
2. 向きによらず、tip を「真下 (世界を読む) が pale_hanging_moss でない」に書き直して返す。

- 予約 tick でまだ存続できなければ destroyBlock (ドロップあり)。下へ伸びた列は、根元を外すと 1 gt に 1 段ずつ消える。

#### C.3 支えを失っても消えないもの

| クラス | 理由 [26.3 読解] |
|---|---|
| WallHangingSignBlock (壁掛けの吊り看板 13) | canSurvive を上書きしない (既定で常に真)。updateShape は左右の軸からの SU で存続を見るが、空気にならない。左右の支えは、置くとき (WallHangingSignBlock#canPlace) だけ見る |
| FlowerPotBlock (植木鉢 40) | canSurvive を上書きしない。下からの SU で存続を見るが、常に真 |
| GrindstoneBlock (砥石) | canSurvive を常に真に上書きする。親の FaceAttachedHorizontalDirectionalBlock#updateShape は取り付け先からの SU で存続を見るが、空気にならない。押し反応は IMMOVEABLE |
| CandleBlock (ろうそく 17) | canSurvive (真下の上面が CENTER で頑丈) はあるが、updateShape から呼ばない。置くときだけ効く。1.21.1 から 26.4-pre-1 まで同じ |

#### C.4 ほかのメモにある支え

| 対象 | 参照先 |
|---|---|
| ダスト・リピーター・コンパレーター・トーチ・レバー・ボタン・感圧板・トリップワイヤーフック・レール・ドア | §4.7.4、06・07・08・09・11・15 |
| ケーキ・ろうそく付きケーキ (下からの SU で、真下が legacy solid)、耕地・土の道、サボテンの横 | §4.7.2 |
| ベル・大きなドリップリーフと茎 | 11 §4.6・§4.9 |
| 足場・鍾乳石・硫黄のとげ・泡柱・海草 | 16 |
| ピストンヘッド | 13 §4.12 |
| 火 (FireBlock) | 11 付録 F.14 |
| カエルの卵 | 02 §4.9 表 C |

### 付録 D. 版差

担当クラスを 1.21.1・26.2・26.3・26.4-pre-1 で比べた。26.2 → 26.3 と 26.3 → 26.4-pre-1 は diff -u で、1.21.1 は名前の付いていない引数なので、updateShape・canSurvive・mayPlaceOn と接続の判定の中身を並べて比べた。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| 塀・板・柵・階段の接続と形、Block#isExceptionForConnection | 規則は同じ (updateShape の引数の並びだけ違う) | 同じ | 同じ (codec の削除だけ) | 同じ (水を含むかの書き方だけ) |
| updateShape の書き方 | 世界へ直接書ける。竹と竹の芽は updateShape の中でフラグ 2 で直接書く | 世界に書けない形になった。竹と竹の芽は返す状態で書く (SU のフラグ) | 同じ | 同じ |
| 伸びる植物の先端 | 根元側からの SU で「伸びる向きの隣が植物なら胴になる」規則が無い | ある | ある | ある |
| 葉 | 距離 0 の判定はタグ logs | タグ prevents_nearby_leaf_decay (中身は #logs) | 同じ | SU で予約するのは「自分の distance が d と違う」ときだけ。予約 tick は変わるときだけ書く |
| 支えの判定のタグ | dirt と farmland、bamboo_plantable_on・jungle_logs・mushroom_grow_block・small_dripleaf_placeable などと名指し | supports_* のタグに移した | 同じ | 同じ |
| 枯れ草の仲間の支え | dead_bush は dead_bush_may_place_on (farmland を含まない) | supports_dry_vegetation (farmland を含む) | 同じ | 同じ |
| キノコの存続 | 明るさ 13 未満と isSolidRender | 同じ | 同じ | 明るさを見ず、真下の上面が CENTER で頑丈かだけを見る。wall_post_override に brown_mushroom・red_mushroom が入る |
| アメジストの芽 | AmethystClusterBlock | 同じ | 同じ | AbstractCrystalClusterBlock へ移した。規則は同じ |
| クラス名 | BushBlock・SnowyDirtBlock・WaterlilyBlock・PinkPetalsBlock | VegetationBlock・SnowyBlock・LilyPadBlock・FlowerBedBlock | 同じ | 同じ |

- タグの中身は、新しいブロックの分だけ版ごとに増える。共通のブロックで結果が変わったのは、表の枯れ草の farmland だけである。例: walls は 25 (1.21.1)・32 (26.2・26.3)・37 (26.4-pre-1)。wall_post_override は 73・78・81・83。
- 26.2 → 26.3 で、上の族の規則は変わっていない。違いは codec の削除 (§6 の BlockTypes の削除と同じ件)・骨粉の引数・フラグ 3 の書き方の言い換えだけである。今の TS 実装が典拠にする「26.2 WallBlock・IronBarsBlock」の読みは、26.3 でもそのまま使える (00 の O-4 の確認)。
- 26.4-pre-1 の葉の変更は、周りと distance が合っている限り、書かれる状態を変えない。26.3 で積んでいた「何もしない予約」が減るだけである。差が出うるのは、予約の件数の上限 (02) に近い回路と、周りと食い違った distance のまま読み込んだ葉 (直る時期が遅れうる) である [版差 26.4-pre-1] [要実機]。
- 1.21.1 に無いブロック: pale_moss_carpet・pale_hanging_moss・leaf_litter・cactus_flower・firefly_bush・bush・枯れ草 2・銅の格子・銅のランタン・resin_clump・wildflowers ほか。26.3 で増えたもの: red_shrub・shelf_mushroom・ポプラの仲間・羊毛とコンクリートの階段。今の実機ハーネス (1.21.1) では撮れない。

### 付録 E. Rust で実装するときの要点

#### E.1 データ (生成物にする)

- 状態ごとの面の表 (§7.1 の延長): 6 面 × FULL・CENTER・RIGID の頑丈さ、legacy solid、塀の帯 5 本 (中心・北・東・南・西) を当たり判定の底面が覆うかの 5 ビット、当たり判定の上面が空でないか、6 面それぞれが「支えの形か当たり判定で満ちる」か (MultifaceBlock#canAttachTo 用)。
- 動的な形 (moving_piston・シュルカーボックス) だけ実行時に求める。moving_piston は BE が付く前の SU では空の形として扱う (付録 A.1)。
- タグは版ごとの data から生成し、ブロックの集合 (ビット集合) で持つ。walls・wall_post_override・fences・wooden_fences・shulker_boxes・snow・prevents_nearby_leaf_decay・supports_* など。
- 接続の例外 (Block#isExceptionForConnection) は、クラス (LeavesBlock の全部) と名指しとタグの合成なので、生成のときに 1 つの集合へ畳む。

#### E.2 updateShape の口

- 1 つの関数にする。受け取るのは「今の状態・相手の向き・相手の状態 (積んだ時点)・世界の読み取り・予約の口・乱数」。返すのは新しい状態 (空気を含む)。書き込みとフラグは 04 の共通部 (Block#updateOrDestroy 相当) に任せる。
- 「渡された相手の状態」と「世界を読む」の区別を、付録 B.1 の表どおりに守る。SU のレコードに、積んだ時点の相手の状態を持たせる (04 §7.1)。
- 支えは表で持つ。何を見るか (真下のタグ・真下の面・取り付け先の面・legacy solid・空気でない・個別の関数)、どの向きの SU で見るか (全方向・下だけ・上だけ・取り付け先だけ)、その場で消えるか 1 gt の予約か、の 3 つである。込み入るもの (コーラス・二重の植物・苔のカーペット・つた・Multiface) だけ個別の関数にする。

```rust
#[derive(Clone, Copy)]
pub enum SupportCheck {
    BelowTag(TagId),               // VegetationBlock の系統
    BelowFace(SupportKind),        // 真下の上面 (FULL / CENTER)
    BelowLegacySolid,              // 旗・看板
    BelowNotAir,                   // カーペット
    AttachFace(SupportKind),       // facing の逆の隣の面 (はしご・アメジスト・サンゴの扇)
    AttachLegacySolid,             // 壁の旗・壁の看板
    AboveFace(SupportKind, bool),  // 吊り (bool: 木のフェンスゲートを除くか)
    Custom(CustomSupport),         // コーラス・二重の植物ほか
    Never,                         // 壁掛けの吊り看板・植木鉢・砥石・ろうそく
}

#[derive(Clone, Copy)]
pub enum SupportTrigger { AnyDir, Only(Dir), Attach, AllButUp }

#[derive(Clone, Copy)]
pub enum SupportTiming { Immediate, Scheduled1gt }
```

- 支えの要件を入れるなら、全部まとめて入れる (docs/research/13 §3 が挙げる「レバーは浮くのにレールは落ちる」不整合を避ける)。付録 B と C で全クラスを覆える。
- 明るさで決まる存続 (作物・ピッチャー・26.3 のキノコ) は、光の計算が要る。光を持たないなら、明るさを外から与える値にする (既定 15)。15 なら作物は残る。26.3 のキノコは、タグ overrides_mushroom_light_requirement のブロックの上でなければ、SU を受けた時点で消える。
- 胴から先端への age は Level の乱数を引く。乱数の列を合わせるなら、SU を処理する順に引く (→ 18 §4.6.4)。
- SU の連鎖は深さを引き継ぐ (04 §4.7)。塀の連鎖を再帰で書くときも、残り回数を引数で渡す (docs/research/16 の R-22)。
- 葉は 1 gt の予約を大量に積む。予約は (位置・種類) で重複を捨てる (02)。

#### E.3 ほかのメモとの境界

| 境界 | この付録が渡すもの | 相手 |
|---|---|---|
| SU の配り方・フラグ・深さ | updateShape の規則 | → 04 |
| 正面のオブザーバー | 形が変わる・消えるという事実 | → 08 |
| ピストンの移動・着地 | 運べるか、着地で生き残るか | → 13 |
| 予約の遅延・優先度 | 1 gt・5 gt の予約を積む条件 | → 02 |
| ドロップ・投射物・踏みつけ | 壊れたという事実 | → 17 |
| 成長・広がり・骨粉 | 状態の意味 | → 11 付録 F |
| 水を含む・流される | waterlogged の扱い | → 16 |
| 乱数 | 伸びる植物の age | → 18 |

### 付録 F. 検証用のプローブ回路案

今の実機ハーネスは 1.21.1 なので、1.21.1 に無いブロック (付録 D) を使う案は 26.3 の実機で撮る。docs/research/17 §2.2 にある Nucleation の 1.21.11 の実機ケース (塀 4 件) も照合の候補になる。

| # | 目的 | 配置 | 観測 | 期待 (26.3 読解) |
|---|---|---|---|---|
| F1-P1 | 塀の tall と柱の決め方 | レーンごとに、南北をガラスで挟んだ塀 1 つ。t10 に真上へ被検を置く: 石・下付きハーフ・上付きハーフ・カーペット・単独の柵・単独の板ガラス・南北につながった板ガラス・トーチ・石の感圧板・旗 | t10 の塀の north・south・up | B.2 の表どおり。石・下付きハーフ・カーペット・南北の板は tall・tall・偽。上付きハーフは low・low・偽。単独の柵と板は low・low・真。トーチ・感圧板・旗は low・low・真 |
| F1-P2 | 接続の相手 | 中央に被検 (塀・板ガラス・オークの柵) を 1 つ。東隣に相手を置く: 塀・板ガラス・iron_bars・オークの柵・nether_brick_fence・オークのフェンスゲート 2 向き (facing 北と facing 東)・pumpkin・carved_pumpkin・melon・shulker_box・barrier・persistent の葉・ガラス・石・樽・チェスト・下付きハーフ | 被検の east | B.5 の表どおり。ゲートは facing 北 (被検がゲートの左右にいる) のときだけ、塀と柵がつながる。カボチャ類・スイカ・シュルカー・バリア・葉には、どれもつながらない |
| F1-P3 | 柱の連鎖は下へだけ | wall-post-cascade の柱で、最下段の北のガラスを t10 に壊す。最上段の真上に下向きのオブザーバー | 各段の up、オブザーバー | 最下段だけ up が真になる。上の段は変わらず、オブザーバーは点かない |
| F1-P4 | 階段の shape とオブザーバー | facing 北の階段 S。S の南に、S を向く北向きのオブザーバー。t10 に S の北へ facing 東の階段を置く | S の shape、オブザーバー | t10 に S が outer_right。オブザーバーは t12 に点く |
| F1-P5 | 葉の距離の速さ | persistent・distance 7 の葉を東西に 6 個並べる。t10 に西端の隣へ oak_log を置く。東端の葉を東から見るオブザーバー | 各葉の distance を毎 gt | k 番目の葉が t10+k に distance k。オブザーバーは t18 に点く |
| F1-P6 | 昆布の胴が先端に戻る | 水中の昆布 3 段 (kelp_plant・kelp_plant・kelp)。中段を見るオブザーバー。t10 に最上段を空気にする | 中段のブロック | t10 に中段が kelp になる (age は乱数なので見ない)。オブザーバーは t12 |
| F1-P7 | 巨大キノコの面は戻らない | brown_mushroom_block A の東に B を置く (A の east が偽になる)。A を見るオブザーバー。t10 に B を空気にする | A の east、オブザーバー | A の east は偽のまま。オブザーバーは点かない |
| F1-P8 | 実のついた茎が戻る | 耕地の attached_pumpkin_stem (facing 東) と東のかぼちゃ。茎を見るオブザーバー。t10 にかぼちゃを空気にする | 茎、オブザーバー | t10 に pumpkin_stem (age 7)。オブザーバーは t12 |
| F1-P9 | 焚き火の signal_fire | 焚き火の真下の干し草を、横のピストンで押し出す。焚き火を見るオブザーバー | 焚き火の signal_fire | 伸長のブロックイベント相で、真下が moving_piston になって偽。オブザーバーはその 2 gt 後 |
| F3-P1 | 支えを外したときに消えるもの | レーンごとに石の土台。被検: 上に short_grass (土台は dirt)・poppy (dirt)・白のカーペット・旗・看板・置いたランタン・ろうそく・植木鉢・床の砥石・海のピクルス・死んだサンゴ・アメジストの芽。横に壁の看板・はしご・壁掛けの吊り看板・つた。下に吊りランタン・天井の吊り看板。t10 に土台を空気にする | t10 の各被検 | ろうそく・植木鉢・砥石・壁掛けの吊り看板は残る。ほかはすべて t10 に空気 (その SU の中) |
| F3-P2 | 1 gt ずつ壊れる柱 | 4 段の柱: 竹 (dirt の上)・サボテン (sand)・サトウキビ (dirt と隣の水)・コーラスプラント (end_stone)・ねじれツタ (地面から上)・しだれツタ (天井から下)・pale_hanging_moss (天井から下)。t10 に土台を空気にする | 毎 gt の各段 | t10 には何も壊れない。根元の段が t11、次が t12、と 1 gt に 1 段ずつ壊れる |
| F3-P3 | moving_piston の上 | 横向きのピストンの前に石 2 つ (セル x1・x2)。x1・x2 の上に、白のカーペット・旗・poppy (土台を dirt に)・置いたランタンをレーン違いで置く。t10 にピストンを伸ばす | 伸長の tick の各被検 | カーペットと旗は残る。poppy とランタンは moving_piston を置いた瞬間に消える [要実機] |
| F3-P4 | 引いて空いたセル | 伸びた粘着ピストンの前の石の上にカーペット・旗。t10 に引く | 各被検 | 空いたセルの上なので、どちらも t10 のブロックイベント相で消える |
| F3-P5 | 二重の植物 | dirt の上の tall_grass (2 マス)。上半分を見るオブザーバー。t10 に dirt を空気にする | 両半分 | t10 に下半分が消え、同じ連鎖で上半分も消える。オブザーバーは t12 |
| F3-P6 | 明るさと存続 [版差 26.4-pre-1] | 空も塞いだ暗い箱の中の耕地の小麦。明るい所の石の上の brown_mushroom (/setblock で置く)。t10 に隣へブロックを置いて SU を起こす | 小麦とキノコ | 26.3: 明るさ 8 未満の小麦は消える。明るさ 13 以上の石の上のキノコも消える。26.4-pre-1: キノコは残る |
| F3-P7 | つたの上の面 | 石の下に up だけのつた (/setblock)。2 レーンで、t10 に石を下付きハーフ・上付きハーフに替える | つた | 下付きハーフの下では up を失って消え、上付きハーフの下では残る [要実機] |

- F1-P1・F1-P2 は置いた後の状態を読むだけでよい (nonconductor-glass-slab の型)。オブザーバーは要らない。
- F3-P1 の土台は /setblock で空気にする (04 §4.11 の経路)。ピストンで動かすと付録 A.1 の差が混ざる。
- F3-P6 は明るさを決める配置が要る。光の計算を持たない sim と比べるときは、明るさを固定した結果として読む。

### 付録 G. 既存資料・今の TS 実装との食い違い

コードは変えていない。判断と根拠だけを書く。

| # | 箇所 | 既存の記述・実装 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|---|
| G-1 | 00_coverage.md の GrindstoneBlock の行 | 「F3 (取り付け面を失うと消える)」 | GrindstoneBlock#canSurvive は常に真 (1.21.1 から 26.4-pre-1 まで)。支えを失っても消えない (C.3) | 00 の記述の誤り。00 の行は仕上げで直した |
| G-2 | packages/sim/src/world.ts の connectsToWall のフェンスゲート | 「向きによらず繋がる (実機で確認)」 | WallBlock#connectsTo はゲートの向きを見る。ゲートの左右の隣だけ (B.4・B.5)。1.21.1 も同じ | TS の誤りの疑い [要実機]。確かめた配置が左右の隣だけだった可能性がある。fixture は無い。F1-P2 で撮る |
| G-3 | world.ts の connectsToWall | 塀・ゲート・ドア・フルキューブにつながる。板は入っていない | 塀は IronBarsBlock (板ガラス・鉄格子・銅の格子) にもつながる | TS の誤り (新規)。板から塀へは connectsToPane でつながるので、片側だけつながる不整合になる |
| G-4 | world.ts の isFullCube を使う connectsToWall・connectsToPane | solid (pumpkin・carved_pumpkin・jack_o_lantern・melon・barrier を含む) と container の fullCube (シュルカーボックスを含む) につながる | Block#isExceptionForConnection の 7 系統にはつながらない | TS の誤り (新規)。docs/research/02 の hopper / dropper / container の節にある「導通が違うと…塀や板が接続するか…が変わる」も、シュルカーボックスには当たらない (導体だが例外) |
| G-5 | world.ts の refreshWall の tallOn と up | tall は「上がフルキューブか、同じ辺がつながった塀」。up の最後は「上がフルキューブか」 | tall は上の当たり判定の底面が帯を覆うか。up の最後はタグ wall_post_override か、底面が中心 2×2 を覆うか (B.2) | TS は下付きハーフ・下付きの階段・カーペット・閉じた下付きのトラップドア・柵・板の上で tall/up が違う。トーチ・看板・旗・感圧板・tripwire・cactus_flower の上では up が違う (TS は偽、vanilla は真) |
| G-6 | world.ts の refreshWall の再帰 | 4 辺を毎回すべて計算し直し、下、北・南・東・西の順に深さ優先で再帰する | SU を受けた辺だけを決め直し、ほかの辺はつながりを保つ。順は SU の西・東・北・南・下・上で、CollectingNeighborUpdater の順 (04 §2.2) | 周りが一貫していれば最後の形は同じ。順が違うので、連鎖を見る複数のオブザーバーの予約の順が変わりうる [要実機]。深さの扱いは docs/research/16 の R-22 |
| G-7 | packages/sim/src/types.ts・world.ts の典拠「26.2 WallBlock・IronBarsBlock」 | 26.2 の読み | 26.3 も同じ規則 (付録 D)。1.21.1 も同じ | 典拠はそのまま使える |
| G-8 | packages/sim/src/blocks/blockNames.ts の DECOR_SUFFIXES の _stairs | 階段は decor で、形を持たない | 階段は横からの SU で shape を決め直し、正面のオブザーバーが拾う (B.6) | 未対応 (新規)。階段の形でオブザーバーを起こす回路は再現できない |
| G-9 | blockNames.ts の pane 型 | 名前が _pane で終わるものと iron_bars | 銅の格子 8 種も IronBarsBlock | 未対応 (取り込めない)。足すなら pane 型でよい |
| G-10 | docs/research/13 §3 の「支持ブロック要件」 | 非実装 (横断的判断)。入れるなら全部まとめて | 付録 C の表で、支えの規則が全クラス揃う | 判断はそのまま。Rust 版で入れるかを決める材料に使う (E.2) |

### 付録 H. 典拠一覧

- 26.3 NeighborUpdater#executeShapeUpdate、Block#updateOrDestroy・#updateFromNeighbourShapes・#isExceptionForConnection・#canSupportCenter・#isFaceFull、Level#destroyBlock、LevelReader#isEmptyBlock
- 26.3 BlockBehaviour#updateShape・#canSurvive・#getBlockSupportShape の既定、BlockBehaviour.BlockStateBase#isFaceSturdy・Cache、SupportType
- 26.3 WallBlock#updateShape・#topUpdate・#sideUpdate・#shouldRaisePost・#updateSides・#makeWallState・#connectsTo・#getStateForPlacement・#makeShapes
- 26.3 IronBarsBlock#updateShape・#attachsTo・#getStateForPlacement、StainedGlassPaneBlock、WeatheringCopperBarsBlock、CrossCollisionBlock#makeShapes
- 26.3 FenceBlock#updateShape・#connectsTo・#isSameFence、FenceGateBlock#connectsToDirection・#updateShape・#getBlockSupportShape・#getCollisionShape
- 26.3 StairBlock#updateShape・#getStairsShape・#canTakeShape、WeatheringCopperStairBlock、StairsShape、WallSide
- 26.3 PipeBlock、ChorusPlantBlock#updateShape・#canSurvive・#tick・#getStateWithConnections、ChorusFlowerBlock#updateShape・#canSurvive・#tick
- 26.3 HugeMushroomBlock#updateShape・#getStateForPlacement
- 26.3 MossyCarpetBlock#updateShape・#canSurvive・#getUpdatedState・#canSupportAtFace・#hasFaces
- 26.3 VineBlock#updateShape・#getUpdatedState・#canSupportAtFace・#isAcceptableNeighbour・#canSurvive・#getStateForPlacement
- 26.3 MultifaceBlock#updateShape・#canAttachTo・#canSurvive・#removeFace・#hasAnyFace、GlowLichenBlock、SculkVeinBlock、MultifaceSpreadeableBlock
- 26.3 SnowyBlock#updateShape・#isSnowySetting、SpreadingSnowyBlock、GrassBlock、MyceliumBlock
- 26.3 AttachedStemBlock#updateShape・#mayPlaceOn、StemBlock#mayPlaceOn
- 26.3 CampfireBlock#updateShape・#isSmokeSource
- 26.3 LeavesBlock#updateShape・#tick・#updateDistance・#getOptionalDistanceAt・#randomTick・#isRandomlyTicking・#getBlockSupportShape・#getStateForPlacement、MangroveLeavesBlock・TintedParticleLeavesBlock・UntintedParticleLeavesBlock・FallingParticlesLeavesBlock
- 26.3 GrowingPlantBlock#canSurvive・#tick・#canAttachTo、GrowingPlantHeadBlock#updateShape、GrowingPlantBodyBlock#updateShape、KelpBlock・KelpPlantBlock・TwistingVinesBlock・TwistingVinesPlantBlock・WeepingVinesBlock・WeepingVinesPlantBlock・CaveVinesBlock・CaveVinesPlantBlock
- 26.3 BambooStalkBlock#updateShape・#canSurvive・#tick、BambooSaplingBlock#updateShape・#canSurvive
- 26.3 VegetationBlock#updateShape・#canSurvive・#mayPlaceOn と、FlowerBlock・TallGrassBlock・BushBlock・FireflyBushBlock・FlowerBedBlock・SaplingBlock・SweetBerryBushBlock・EyeblossomBlock・WitherRoseBlock・NetherSproutsBlock・NetherRootsBlock・NetherFungusBlock・DryVegetationBlock・ShortDryGrassBlock・TallDryGrassBlock・AzaleaBlock・CropBlock#canSurvive・#hasSufficientLight・StemBlock・NetherWartBlock・MushroomBlock#canSurvive・#mayPlaceOn・LilyPadBlock#mayPlaceOn・CactusFlowerBlock#mayPlaceOn・LeafLitterBlock#canSurvive・SeaPickleBlock#mayPlaceOn・MangrovePropaguleBlock#canSurvive・#mayPlaceOn・#updateShape
- 26.3 DoublePlantBlock#updateShape・#canSurvive、TallFlowerBlock、SmallDripleafBlock#mayPlaceOn・#canSurvive、TallSeagrassBlock#mayPlaceOn・#canSurvive、PitcherCropBlock#updateShape・#canSurvive・#isDouble
- 26.3 CarpetBlock#updateShape・#canSurvive、WoolCarpetBlock、SoulFireBlock#updateShape・#canSurvive、SnowLayerBlock#canSurvive・#getCollisionShape
- 26.3 AbstractBannerBlock、BannerBlock・WallBannerBlock・StandingSignBlock・WallSignBlock・CeilingHangingSignBlock の canSurvive と updateShape、SignBlock#updateShape、WallHangingSignBlock#canPlace・#canAttachTo・#updateShape、FlowerPotBlock#updateShape
- 26.3 LadderBlock・LanternBlock・WeatheringLanternBlock・SporeBlossomBlock・HangingRootsBlock・AmethystClusterBlock・ShelfMushroomBlock・CocoaBlock の canSurvive と updateShape、HangingMossBlock#updateShape・#canStayAtPosition・#tick
- 26.3 BaseCoralPlantTypeBlock・BaseCoralPlantBlock・BaseCoralFanBlock・BaseCoralWallFanBlock・CoralPlantBlock・CoralFanBlock・CoralWallFanBlock の canSurvive と updateShape
- 26.3 GrindstoneBlock#canSurvive、FaceAttachedHorizontalDirectionalBlock#updateShape・#canSurvive、CandleBlock#updateShape・#canSurvive、CakeBlock・CandleCakeBlock の canSurvive と updateShape
- 26.3 CactusBlock#updateShape・#canSurvive・#tick、SugarCaneBlock#updateShape・#canSurvive・#tick
- 26.3 PistonBaseBlock#moveBlocks、MovingPistonBlock#getCollisionShape、PistonMovingBlockEntity#getCollisionShape、Blocks の MOVING_PISTON の登録
- 26.3 の data のタグ: walls・wall_post_override・fences・wooden_fences・bars・shulker_boxes・snow・prevents_nearby_leaf_decay・logs・unstable_bottom_center・cannot_support_kelp・cannot_support_seagrass・cannot_support_snow_layer・support_override_snow_layer・soul_fire_base_blocks・overrides_mushroom_light_requirement・support_override_cactus_flower と supports_* の各タグ、流体タグ supports_lily_pad・supports_sugar_cane_adjacently・water
- 版差: 1.21.1 の WallBlock・IronBarsBlock・FenceBlock・StairBlock・LeavesBlock・VineBlock・MultifaceBlock・GlowLichenBlock・GrowingPlantHeadBlock・BambooStalkBlock・BambooSaplingBlock・BushBlock・SnowyDirtBlock・WaterlilyBlock・DeadBushBlock・CropBlock・StemBlock・SugarCaneBlock・CactusBlock・MushroomBlock・GrindstoneBlock・CandleBlock と各タグ。26.2 の同じクラスと VegetationBlock。26.4-pre-1 の LeavesBlock・MushroomBlock・AbstractCrystalClusterBlock・AmethystClusterBlock・CandleBlock と各タグ
- 実機: tools/mc-harness/fixtures/wall-post-cascade.json、packages/sim/test/fixtures/pane-shape-observer.json (どちらも 1.21.1)
