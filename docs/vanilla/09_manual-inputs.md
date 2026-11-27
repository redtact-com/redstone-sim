# 09. 手動入力 — レバー・ボタン・感圧板・トリップワイヤー・トラップチェスト・書見台・ターゲット・避雷針・日照センサー・ジュークボックス

Java 版 26.3 のデコンパイルを読んで、人やエンティティが回路へ信号を入れる素子の挙動を、
Rust (WASM) で同じ挙動を組める粒度で書き起こしたメモである。写経ではない。
逐語引用はしない (docs/ip-policy.md)。メソッドは「ClassName#methodName」と名前だけで書き、
条件・定数・フラグ値・遅延・方向の並びは数値のまま書く。

| 表記 | 意味 |
|---|---|
| [26.3 読解: X#y] | 26.3 のコードを読んで確かめた |
| [実機 1.21.1: name] | tools/mc-harness/fixtures/name.json が裏づける |
| [要実機] | 読んだだけでは実行時の結果が決まらない・解釈が割れる |
| [版差 1.21.1] [版差 26.2] [版差 26.4-pre-1] | その版で違う |

方向の約束: getSignal / getDirectSignal に渡る向きは「問い合わせる側 → 信号源」である
(SignalGetter の約束。→ 05_signals-and-block-properties.md)。本書の「支えへ強 15」は
「取り付け先のブロックが強充電される」を意味する。
NC = 近隣更新 (neighborChanged)、PP = 形状更新 (updateShape)、CU = コンパレーター更新
(Level#updateNeighbourForOutputSignal)。「自分 6」は自分の位置から NeighborUpdater の順
(西・東・下・上・北・南) で 6 方向へ配る NC を指す (→ 04_set-block-and-updates.md)。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| 区分 | クラス | 主に見た所 |
|---|---|---|
| 貼り付き素子 | LeverBlock / ButtonBlock / FaceAttachedHorizontalDirectionalBlock | 操作・信号・updateNeighbours・取り付け面 |
| 感圧板 | BasePressurePlateBlock / PressurePlateBlock / WeightedPressurePlateBlock | entityInside・tick・checkPressed・数え方 |
| 紐 | TripWireBlock / TripWireHookBlock | entityInside・tick・updateSource・calculateState |
| チェスト | TrappedChestBlock / ChestBlock / TrappedChestBlockEntity / ChestBlockEntity / ContainerOpenersCounter / CompoundContainer / DoubleBlockCombiner | 開いている数・数え直し・半分ごとの順 |
| 書見台 | LecternBlock / LecternBlockEntity / LecternMenu | ページ送りのパルス・アナログ値 |
| 投射物・雷 | TargetBlock / LightningRodBlock / WeatheringLightningRodBlock / RodBlock / LightningBolt | 命中強度・持続・落雷点 |
| 時間・音楽 | DaylightDetectorBlock / DaylightDetectorBlockEntity / JukeboxBlock / JukeboxBlockEntity / JukeboxSongPlayer / JukeboxSong / JukeboxPlayable | 更新周期・演奏中の信号・円盤の値 |
| 性質 | BlockSetType / Blocks (登録値) / PushReaction | 持続 gt・矢・感知の種類 |
| 呼び出し元 | Entity#checkInsideBlocks / EntitySelector / AbstractArrow / CopperGolemAi / ServerExplosion#canTriggerBlocks / ServerLevel#findLightningRod / SetBlockCommand / LevelChunk#setBlockState | いつ・何を問い合わせるか |
| データ | data の jukebox_song / timeline の day / dimension_type | 円盤の値と長さ・空の明るさ |

### 1.2 扱わない隣接範囲

| 内容 | 参照先 |
|---|---|
| setBlock のフラグ、NC・PP・CU の送り方と連鎖 (DFS) の順 | → 04_set-block-and-updates.md |
| 予約 tick の重複排除・実行順・優先度 | → 02_scheduled-ticks.md |
| 1 tick の相の順・プレイヤー入力の境界・BlockEntity 相の順 | → 01_tick-loop.md |
| ブロックイベントの列 (チェストの蓋) | → 03_block-events.md |
| 強/弱・導体の一般則と全ブロックの表 | → 05_signals-and-block-properties.md |
| ダストの接続と強度 | → 06_redstone-wire.md |
| コンパレーターの読み方 | → 07_diodes.md、アナログ値の全表は → 14_containers-hoppers-analog.md |
| オブザーバー | → 08_torch-observer-redstone-block.md |
| スカルクセンサーと GameEvent の伝わり方 | → 10_sculk.md |
| ドア・ベル・音符ブロックなどの出力 | → 11_outputs.md |
| ピストンの押し反応・壊し方 | → 13_pistons.md |
| 検知レール | → 15_rails.md |
| entityInside が呼ばれる条件・矢・投射物・雷・爆発・銅ゴーレムの動き | → 17_entities-interplay.md |
| 乱数・float・整数の意味論 | → 18_determinism-java-semantics.md |
| 版差の全体表・fixture の有効性 | → 19_version-diffs.md |
| ゲームテスト用の TestBlock、銅のゴーレム像・模様入りの本棚などコンパレーター越しの手動入力 | → 11_outputs.md §4.13 (TestBlock) / 14_containers-hoppers-analog.md |

---

## 2. 全体像

### 2.1 素子の一覧

| 素子 | 入る契機 (相) | 出力 (弱 / 強) | 持続・確認の間隔 | 予約 tick | 自前の追加更新 |
|---|---|---|---|---|---|
| レバー | 右クリック (入力境界)・風チャージ等の起動型爆発 | 15 全方向 / 支えへ強 15 | トグル | なし | 自分 6 → 支え 6 |
| ボタン | 右クリック・起動型爆発・矢 (木系のみ。エンティティ相) | 15 / 支えへ強 15 | 石系 20 gt・木系 30 gt。矢がある間は延長 | 20 / 30、優先度 0 | 自分 6 → 支え 6 |
| 感圧板 (木・石) | entityInside (エンティティ相) | 15 / 下へ強 15 | 押下中は 20 gt ごとに数え直し | 20、優先度 0 | 自分 6 → 下 6 |
| 重量感圧板 | entityInside | 個数から 1〜15 / 下へ強 同値 | 押下中は 10 gt ごと | 10、優先度 0 | 自分 6 → 下 6 |
| トリップワイヤー (紐) | entityInside (紐の形に当たったとき) | 出さない | 押下中は 10 gt ごと、解除後 1 gt は再感知しない | 10 / 1、優先度 0 | フックの再計算 (updateSource) |
| トリップワイヤーフック | 紐の変化・設置・自分の予約 tick | 15 / 支えへ強 15 | 紐の変化から 10 gt 後に再計算 | 10、優先度 0 | 相手フック (自分 6 → 支え 6) → 自分 (同) |
| トラップチェスト | 開く・閉じる (入力境界・銅ゴーレム)・数え直し | 開いている数 (上限 15) / 下へ強 同値 | 開いている間は 5 gt ごと | 5、優先度 0 | ブロックイベント → 自分 6 → 下 6 (PP なし) |
| 書見台 | ページ送り (GUI 操作。入力境界) | パルス中 15 / 下へ強 15。アナログはページ | 2 gt のパルス | 2、優先度 0 | CU → (flag 3) → 下 6 |
| ターゲット | 投射物の命中 (エンティティ相) | 1〜15 全方向 / 強なし | 矢系 20 gt、他 8 gt | 20 / 8、優先度 0 | なし (flag 3 だけ) |
| 避雷針 | 落雷 (雷エンティティの最初の tick) | 15 / 支えへ強 15 | 8 gt | 8、優先度 0 | 支え 6 |
| 日照センサー | BlockEntity 相 (ゲーム時刻が 20 の倍数)・右クリックで反転 | 0〜15 全方向 / 強なし | 20 gt ごと | なし | なし (値が変わったときの flag 3 だけ) |
| ジュークボックス | 円盤の出し入れ (入力境界。ホッパーは BlockEntity 相)・曲の終わり (BlockEntity 相) | 演奏中 15 全方向 / 強なし。アナログは円盤ごと | 入れた tick から L + 21 gt で 0 (L = 曲の長さ。終わりの閾値は L + 20。§4.10) | なし | 自分 6 → CU |

[26.3 読解: 各クラス。詳細は §4]

### 2.2 入力が入る相

1. **入力境界** (tick N の全相の後、tick N+1 の前): プレイヤーの右クリック・GUI 操作。レバー・ボタン・チェストを開く/閉じる・書見台のページ・ジュークボックスの円盤・日照センサーの反転 (→ 01_tick-loop.md。docs/research/02_behavior-spec.md §1.4 と同じ)。
2. **ブロック予約 tick 相**: ボタンの解除、感圧板・紐の数え直し、フックの再計算、チェストの数え直し、書見台のパルスの終わり、ターゲット・避雷針の消灯。
3. **エンティティ相**: entityInside (感圧板・紐・木系ボタン)、投射物の命中 (ターゲット)、雷 (避雷針)、起動型爆発 (レバー・ボタン)、銅ゴーレムのチェスト操作、プレイヤーが離れて GUI が閉じる。
4. **BlockEntity 相**: 日照センサーの更新、ジュークボックスの曲の終わり、ホッパーによる円盤の出し入れ。

[26.3 読解: ServerLevel#tick の相の順は 予約 tick → 流体 → 襲撃 → チャンク (ランダム tick・落雷) → ブロックイベント → エンティティ → BlockEntity]

**右クリックの経路** [26.3 読解: ServerPlayerGameMode#useItemOn]
1. 観戦者はメニューを開くだけ (チェストの数には入らない。§4.5)。
2. しゃがんでいて、どちらかの手に何か持っていれば、ブロックを使わない。
3. それ以外は BlockState#useItemOn (持ち物つき) を呼ぶ。行動を消費したらそこで終わる。
4. ブロックが「素手で試せ」を返し、かつ利き手 (main hand) の処理なら useWithoutItem へ進む。既定の useItemOn は
   「素手で試せ」を返すので、レバー・ボタン・日照センサーは何を持っていても利き手で操作できる。
5. 書見台の本の設置とジュークボックスの円盤の挿入は useItemOn、ジュークボックスの取り出しは useWithoutItem。

注意: 実プレイヤーの移動と entityInside は、全ディメンションの tick の後の接続処理 (ServerPlayer#doTick から
LivingEntity#aiStep) で起きる。モブ・アイテム・矢はエンティティ相。ハーネスの fake player がどちらで動くかは
[要実機] (→ 01・17)。GUI の自動クローズ (離れすぎ) は ServerPlayer#tick (エンティティ相) と #doTick の両方で確かめる。

### 2.3 更新の型 (A・B・B'・C)

| 型 | 流れ | 該当 |
|---|---|---|
| A | flag 3 の書き込み (自分 6 の NC → アナログ持ちなら CU → 自分 6 の PP) → 自前の NC | レバー・ボタン・紐・フック・書見台・ターゲット・避雷針・日照センサー |
| B | flag 2 の書き込み (自分 6 の PP だけ) → 自前の NC | 感圧板 2 種 (自前の NC は 自分 6 → 真下 6) |
| B' | flag 2 の書き込み (PP だけ) → 続きの処理しだい | 日照センサーの反転 (自前の NC は無い。値が変われば続けて型 A の flag 3)、ジュークボックスの has_record (曲が変われば続けて型 C の 自分 6 → CU) |
| C | blockstate を変えない。BlockEntity が直接 NC を出す (PP なし) | トラップチェスト、ジュークボックスの演奏開始・終了 |

型 A はレバーで「自分 6」が 2 回届く (flag 3 で 1 回 + updateNeighbours で 1 回)。
型 B は PP が NC より先に出る。型 C はオブザーバーに見えない。
[26.3 読解: Level#setBlock / LevelWriter#setBlockAndUpdate = flag 3]
[実機 1.21.1: lever-nc-before-shape-race / button-nc-before-shape-race]

---

## 3. 状態とデータ

### 3.1 blockstate

| ブロック | プロパティ (値域) | 既定 |
|---|---|---|
| lever / *_button | face (floor・wall・ceiling)、facing (水平 4)、powered | wall・north・false |
| 木・石・竹・ネザー木・磨かれたブラックストーンの感圧板 | powered | false |
| light/heavy_weighted_pressure_plate | power (0〜15) | 0 |
| tripwire | powered・attached・disarmed・north・east・south・west (各真偽) | 全 false |
| tripwire_hook | facing (水平 4)・powered・attached | north・false・false |
| trapped_chest | facing・type (single・left・right)・waterlogged。**開閉は blockstate に出ない** | — |
| lectern | facing・powered・has_book | north・false・false |
| target | power (0〜15) | 0 |
| lightning_rod 8 種 | facing (6 方向)・powered・waterlogged | up・false・false |
| daylight_detector | power (0〜15)・inverted | 0・false |
| jukebox | has_record | false |

取り付け方向: FaceAttachedHorizontalDirectionalBlock#getConnectedDirection は
床 → 上、天井 → 下、壁 → facing を返す。支えはその逆向きの隣。
床置きの facing は置いた人の向き、壁は facing の逆側に支えがある。
[26.3 読解: FaceAttachedHorizontalDirectionalBlock#getConnectedDirection / #getStateForPlacement]

### 3.2 BlockEntity に持つ値

| BlockEntity | 値 | 保存 |
|---|---|---|
| TrappedChestBlockEntity (ChestBlockEntity) | ContainerOpenersCounter の openCount と maxInteractionRange、27 スロット | openCount は**保存しない** (読み込み直後は 0) |
| LecternBlockEntity | book (アイテム)、page、pageCount (本の中身から計算) | Book と Page |
| JukeboxBlockEntity | item (円盤)、JukeboxSongPlayer の song と ticksSinceSongStarted | RecordItem と ticks_since_song_started |
| DaylightDetectorBlockEntity | 何も持たない (ticker を付けるためだけにある) | — |

### 3.3 定数

| 値 | 意味 | 典拠 (26.3) |
|---|---|---|
| 20 / 30 | ボタンの ticksToStayPressed (石系 / 木系) | Blocks の登録 |
| 20 | 感圧板の押下確認の間隔 | BasePressurePlateBlock#getPressedTime |
| 10 | 重量感圧板の押下確認の間隔 | WeightedPressurePlateBlock#getPressedTime |
| 15 / 150 | 重量感圧板の上限 (light = 金 / heavy = 鉄) | Blocks の登録 |
| 10 | 紐の押下確認の間隔 (RECHECK_PERIOD) | TripWireBlock#checkPressed |
| 1 | 紐の解除後の再感知止め | TripWireBlock#checkPressed |
| 10 | フックの再計算の遅延 | TripWireHookBlock#calculateState |
| 1〜41 | フックが紐を走査する距離 (WIRE_DIST_MAX = 42 の手前まで) | TripWireHookBlock / TripWireBlock#updateSource |
| 5 | チェストの開いている数の数え直し (CHECK_TICK_DELAY) | ContainerOpenersCounter |
| 4.0 | 数え直しの探索半径への上乗せ | ContainerOpenersCounter#getEntitiesWithContainerOpen |
| 2 | 書見台のパルス (PAGE_CHANGE_IMPULSE_TICKS) | LecternBlock#signalPageChange |
| 20 / 8 | ターゲットの持続 (AbstractArrow / それ以外) | TargetBlock#updateRedstoneOutput |
| 8 | 避雷針の持続 (ACTIVATION_TICKS) | LightningRodBlock |
| 128 | 雷が避雷針を探す範囲 | LightningRodBlock.RANGE / ServerLevel#findLightningRod |
| 20 | 日照センサーの更新周期 | DaylightDetectorBlock#tickEntity |
| 65536 | 日照センサーの cos が引く正弦表の区分数 (Mth#cos は表引きの近似) | Mth#cos |
| 20 | ジュークボックスの曲の後の余白 (SONG_END_PADDING_TICKS) と演奏イベントの間隔 | JukeboxSong / JukeboxSongPlayer |
| 1200 | 刺さった矢が消えるまで (地面に刺さってからの gt) | AbstractArrow#tickDespawn |
| 1 / 60 | 銅ゴーレムが目標に着いてから startOpen する段 / stopOpen する段 | CopperGolemAi#onReachedTargetInteraction |
| 3.0 | 銅ゴーレムの操作距離 (数え直しの箱の大きさに効く) | CopperGolem#getContainerInteractionRange |

予約 tick はすべて優先度を指定しない形で出すので **NORMAL (0)** になる
[26.3 読解: LevelAccessor#createTick / ScheduledTick]。

### 3.4 BlockSetType と登録

| BlockSetType | 矢でボタンが押せる | 感圧板が感知する種類 | 使う素子 |
|---|---|---|---|
| oak・spruce・birch・acacia・jungle・dark_oak・pale_oak・poplar・mangrove (既定の木) | する | すべてのエンティティ | 木のボタン (30 gt)・木の感圧板 |
| cherry・bamboo・crimson・warped | する | すべてのエンティティ | 同上 (音だけ違う) |
| stone | しない | LivingEntity | 石のボタン・**磨かれたブラックストーンのボタン** (20 gt)、石の感圧板 |
| polished_blackstone | しない | LivingEntity | 磨かれたブラックストーンの感圧板 |
| gold / iron | しない | (使わない) | 重量感圧板 (音だけ。数え方は別) |

磨かれたブラックストーンのボタンは BlockSetType が stone で 20 gt である。
重量感圧板は感知の種類を見ず、常にすべてのエンティティを数える。
[26.3 読解: BlockSetType / Blocks / PressurePlateBlock#getSignalStrength / WeightedPressurePlateBlock#getSignalStrength]

### 3.5 判定に使う箱

| 素子 | 箱 (ブロック内の px。1 px = 1/16) | 使う所 |
|---|---|---|
| ボタン (未押下) | 6 × 4 の面、支えから厚さ 2 px (壁 north 向きなら x 5〜11・y 6〜10・z 14〜16) | 矢を探す (entityInside から) |
| ボタン (押下中) | 同じ面で厚さ 1 px (z 15〜16) | 矢を探す (予約 tick から) |
| 感圧板 (全種) | TOUCH_AABB: x・z 1〜15、y 0〜4 (押下の見た目に関係なく同じ) | エンティティを数える |
| 紐 (attached) | 全面、y 1〜2.5 | entityInside の当たりと tick の探索 |
| 紐 (未 attached) | 全面、y 0〜8 | 同上 |
| トラップチェスト | ブロックの箱を (最大の操作距離 + 4) だけ広げた箱 | 開いている者を数え直す |

[26.3 読解: ButtonBlock#makeShapes / BasePressurePlateBlock.TOUCH_AABB / TripWireBlock#getShape / ContainerOpenersCounter#getEntitiesWithContainerOpen]

### 3.6 導体・押し反応・ダストの接続

| ブロック | 導体か | ピストン | ダストが接続 |
|---|---|---|---|
| レバー・ボタン・感圧板・紐・フック | しない (当たり判定なし) | 壊れる (POPPED) | する (紐を除く。紐は信号源でない) |
| トラップチェスト | しない (フルブロックでない) | 動かない (BlockEntity) | する |
| 書見台 | しない | 動かない (BlockEntity) | する |
| ターゲット | する (フルブロック) | 動く | する |
| 避雷針 | しない | 動く | する |
| 日照センサー | しない | 動かない (BlockEntity) | する |
| ジュークボックス | する (フルブロック) | 動かない (BlockEntity) | する |

ダストの接続は「isSignalSource が真」で決まり、上の信号源はどれも状態によらず常に真を返す。
[26.3 読解: BlockBehaviour#shouldRedstoneWireConnectTo / 各 #isSignalSource / PistonBaseBlock#isPushable]
(→ 05・06・13)

### 3.7 ジュークボックスの円盤 (26.3)

L は「曲の長さ (秒 × 20 を float で掛けて切り上げ)」、L+20 は曲の終わりの閾値 (JukeboxSong#hasFinished) である。
BlockEntity の tick は入れた次の tick から回り、経過が閾値に達した次の回で止まる。
だから信号 15 は、入れた tick から数えて L+21 gt 目の BlockEntity 相で 0 になる (§4.10)。

| 円盤 | コンパレーター | 秒 | L (gt) | 閾値 L+20 |
|---|---|---|---|---|
| 13 | 1 | 178 | 3560 | 3580 |
| cat | 2 | 185 | 3700 | 3720 |
| blocks | 3 | 345 | 6900 | 6920 |
| chirp | 4 | 185 | 3700 | 3720 |
| far | 5 | 174 | 3480 | 3500 |
| mall | 6 | 197 | 3940 | 3960 |
| mellohi | 7 | 96 | 1920 | 1940 |
| bounce | 8 | 234 | 4680 | 4700 |
| stal | 8 | 150 | 3000 | 3020 |
| lava_chicken | 9 | 134 | 2680 | 2700 |
| strad | 9 | 188 | 3760 | 3780 |
| tears | 10 | 175 | 3500 | 3520 |
| ward | 10 | 251 | 5020 | 5040 |
| 11 | 11 | 71 | 1420 | 1440 |
| creator_music_box | 11 | 73 | 1460 | 1480 |
| creator | 12 | 176 | 3520 | 3540 |
| wait | 12 | 238 | 4760 | 4780 |
| pigstep | 13 | 149 | 2980 | 3000 |
| precipice | 13 | 299 | 5980 | 6000 |
| otherside | 14 | 195 | 3900 | 3920 |
| relic | 14 | 218 | 4360 | 4380 |
| 5 | 15 | 178 | 3560 | 3580 |

[26.3 読解: data の jukebox_song / JukeboxSong#lengthInTicks / #hasFinished]
[版差 1.21.1] bounce・lava_chicken・tears が無い (ほかの 19 枚は同値)。[版差 26.4-pre-1] flurry (7・154 秒) が増える。

---

## 4. 処理の詳細

### 4.1 レバー

**信号** [26.3 読解: LeverBlock#ownSignal / #getDirectSignal / #isSignalSource]
- ownSignal: powered なら 15。BlockBehaviour#getSignal の既定がこれを返すので、弱 15 は向きによらない。
- getDirectSignal: powered かつ問われた向きが取り付け方向のとき 15 (= 支えだけを強充電)。

**LeverBlock#useWithoutItem** (右クリック。サーバー側) → LeverBlock#pull を呼ぶ。条件は無い (常にトグル)。

**LeverBlock#pull**
1. powered を反転した状態を flag 3 で書く (自分 6 の NC → 自分 6 の PP)。
2. updateNeighbours: 自分 6 の NC → 支え 6 の NC。
3. 音 (乱数を使わない)、GameEvent は ON で block_activate・OFF で block_deactivate。
   **出所は無し**である。LeverBlock#useWithoutItem は操作した人を pull に渡さない (1.21.1 も同じ)。
   ボタンの press は押した人を渡すので、ここが違う (振動の出所の扱い → 10_sculk.md)。

予約 tick は無い。updateNeighbours が渡す Orientation は、実験的レッドストーンが有効なときだけ
乱数で作る (前 = 支えの向き、上 = 壁なら上・床/天井なら facing)。無効なら null で乱数も使わない
[26.3 読解: LeverBlock#updateNeighbours / ExperimentalRedstoneUtils#initialOrientation] (→ 06・18)。

**LeverBlock#onExplosionHit**: 爆発が「起動型」(ServerExplosion#canTriggerBlocks。爆発の種類が
TRIGGER_BLOCK で、出所がブリーズの風チャージならモブの破壊のゲームルールが真) なら pull。
そのあと既定処理 (起動型なら壊さない、それ以外は壊す) へ進む。

**LeverBlock#affectNeighborsAfterRemoval**: ピストン移動でなく、powered だった場合に updateNeighbours。
除去の書き込み自体の自分 6 と合わせて、壊したときも自分 6 が 2 回届く (docs/research/07 の MC-231071 の重複更新)。
順は **除去フックが先**である。除去フックは LevelChunk#setBlockState の中で呼ばれ、書き込み自体の NC・PP はその後に
Level#setBlock が出す [26.3 読解: LevelChunk#setBlockState / Level#setBlock] (→ 04 §4.2)。壊したときの並び:
1. 除去フックの updateNeighbours (自分 6 → 支え 6)。この時点で自分の位置はもう空気である。
2. 書き込み自体の 自分 6 の NC。
3. 自分 6 の PP。
ピストンに壊されたときは、押し終わりにまとめてこのフックが呼ばれる (引数の「ピストン移動」は偽で渡るので updateNeighbours が走る。
[26.3 読解: PistonBaseBlock#moveBlocks] → 13)。

**取り付け**: FaceAttachedHorizontalDirectionalBlock#canSurvive は支えの面が sturdy か。
#updateShape は支えの向きからの PP で生存を確かめ、だめなら空気にする
(壊れて落ちる。→ 04 の updateOrDestroy)。[実機 1.21.1: lever-support-break]
- **レバーは NC に反応しない**。LeverBlock も、親の FaceAttachedHorizontalDirectionalBlock・HorizontalDirectionalBlock・Block も
  neighborChanged を上書きしない。既定の BlockBehaviour#neighborChanged は何もしない。だから NC では、取り付けの確認も powered の変更も起きない。
  取り付けを確かめるのは PP だけである [26.3 読解: LeverBlock・FaceAttachedHorizontalDirectionalBlock・BlockBehaviour#neighborChanged]。
- 支えがフラグ 16 つきの書き込み (PP を出さない) で消えると、周りへ NC が届いてもレバーは残る。次に支えの向きから PP が届いた時に壊れる。
- PP の確認は、**支えの向きから届いた PP だけ**で行う。ほかの 5 方向からの PP では何もしない (今の状態のまま)。
- 判定に使うのは**世界の今の支え**である。#updateShape は #canSurvive を呼び、#canAttach が取り付け先の座標の状態を世界から読み直す。
  PP が運んできた「相手の状態」は使わない。ダストの下からの PP は逆で、運ばれた状態で判定する (→ 06 §4.6)。
- 1.21.1・26.2・26.4-pre-1 も同じである (どの版のレバーも neighborChanged を持たない)。ボタンも同じ親を使い、neighborChanged を持たない (§4.2)。

### 4.2 ボタン

**信号**: レバーと同じ (powered で弱 15・支えへ強 15)。[26.3 読解: ButtonBlock#ownSignal / #getDirectSignal]

**ButtonBlock#useWithoutItem**: 押下中なら何もしない (延長しない)。そうでなければ ButtonBlock#press。

**ButtonBlock#press**
1. powered = true を flag 3 で書く (自分 6 の NC → 自分 6 の PP)。
2. updateNeighbours: 自分 6 → 支え 6 (レバーと同じ)。
3. 自分に ticksToStayPressed (20 / 30) gt の予約 tick (優先度 0)。**予約は更新を配った後**に出す。
4. 押した音、GameEvent block_activate (出所は押した人。起動型の爆発で押されたときは無し)。

**ButtonBlock#tick** (予約 tick 相): powered なら ButtonBlock#checkPressed。

**ButtonBlock#entityInside** (エンティティ相): サーバー側で、BlockSetType が矢で押せる種類で、
未押下のときだけ ButtonBlock#checkPressed。どのエンティティが入っても呼ばれるが、数えるのは矢だけ。
呼ばれる条件は「そのエンティティの移動の経路がボタンのマスを通った」である (ボタンは getEntityInsideCollisionShape を
上書きしないので、マス全体を当たりとみなす)。刺さって止まった矢も、AbstractArrow#tick が毎 tick
applyEffectsFromBlocks を呼ぶので、そのたびに entityInside が来る [26.3 読解: Entity#checkInsideBlocks / AbstractArrow#tick] (→ 17)。

**ButtonBlock#checkPressed**
1. 矢で押せる種類なら、**今の状態の形**の外接箱 (§3.5。押下中は厚さ 1 px) にいる AbstractArrow
   (矢・光の矢・トライデント。観戦者を除く既定の条件) を 1 本探す。石系は探さない。
2. 押されているべきか = 矢がいるか。今の powered と違えば:
   1. powered を flag 3 で書く。
   2. updateNeighbours (自分 6 → 支え 6)。
   3. 音、GameEvent (出所は見つけた矢、解除なら無し)。
3. 押されているべきなら ticksToStayPressed の予約 tick を出し直す (矢がいる限り続く)。

押下も解除も型 A で、解除の順も押下と同じ [実機 1.21.1: button-nc-before-shape-race]。
石のボタン: t2 に押すと t22 に解除 [実機 1.21.1: stone-button]。

**ButtonBlock#onExplosionHit**: 起動型の爆発で未押下なら press。**石系も押される** (種類を見ない)。

**ButtonBlock#affectNeighborsAfterRemoval**: レバーと同じ。

### 4.3 感圧板 (木・石・重量)

**信号** [26.3 読解: BasePressurePlateBlock#ownSignal / #getDirectSignal]
- ownSignal: 状態の信号 (木・石は powered で 15、重量は power)。向きによらない。
- getDirectSignal: 問われた向きが上 (= 真下のブロックから問われた) のときだけ状態の信号。

**BasePressurePlateBlock#entityInside** (エンティティ相): サーバー側で、状態の信号が 0 のときだけ
BasePressurePlateBlock#checkPressed (出所 = そのエンティティ)。**押下中は何もしない**。
entityInside は移動の経路が板のマス (マス全体を当たりとみなす) を通れば呼ばれる。ただし数えるのは TOUCH_AABB
(高さ 4 px まで) に掛かるものだけなので、マスの上の方を通り抜けるだけでは 0 を数えて何も起きない。

**BasePressurePlateBlock#tick** (予約 tick 相): 状態の信号が 0 より大きいときだけ checkPressed (出所なし)。

**BasePressurePlateBlock#checkPressed**
1. 新しい信号 = getSignalStrength (下の数え方)。
2. 古い信号と違えば:
   1. 新しい状態を **flag 2** で書く (NC は出ない。自分 6 の PP だけ)。
   2. updateNeighbours: 自分 6 の NC → 真下 6 の NC。Orientation は 2 か所それぞれで別に作る
      (どちらも「向きの指定なし」の updateNeighborsAt。実験的レッドストーンが有効なら乱数を 2 回使う。無効なら null)
      [26.3 読解: BasePressurePlateBlock#updateNeighbours / ServerLevel#updateNeighborsAt]。
3. 押下 → 解除なら解除音と GameEvent block_deactivate、解除 → 押下なら押下音と block_activate。
   重量板で 3 → 5 のように押下のまま値が変わったときは音も GameEvent も無い。
4. 新しい信号が 0 より大きければ、getPressedTime (20 / 10) の予約 tick を出す。

**数え方** (BasePressurePlateBlock#getEntityCount): TOUCH_AABB を板の位置へ動かした箱で、
観戦者でなく isIgnoringBlockTriggers が偽のエンティティを数える。
isIgnoringBlockTriggers が真なのはマーカー・表示エンティティ・Interaction・コウモリ・
不吉なアイテムの出現器・マーカーの防具立て [26.3 読解: 各エンティティ #isIgnoringBlockTriggers]。

| 板 | 数える型 | 出力 |
|---|---|---|
| 木系 (BlockSetType が「すべて」) | Entity (アイテム・経験値オーブ・トロッコ・矢・落下中のブロックも) | 1 体以上で 15 |
| 石・磨かれたブラックストーン | LivingEntity (プレイヤー・モブ・**防具立て**) | 1 体以上で 15 |
| 軽量 (上限 15) | Entity | n 体で min(n, 15) |
| 重量 (上限 150) | Entity | n 体で ceil(min(n, 150) / 10)。1〜10 体 → 1、141 体以上 → 15 |

重量板の式は「min(n, 上限) / 上限 を float で求め、15 を掛けて切り上げ」である。
float32 で 1〜150 を全数計算すると、整数の ceil(15 × min(n, 上限) / 上限) と一致した (境界の丸め誤差は無い)。
[26.3 読解: PressurePlateBlock#getSignalStrength / WeightedPressurePlateBlock#getSignalStrength]

**時間の流れ** (木の板): t2 に乗って離れると、t2 に押下、t22 の予約 tick で 0 を数えて解除
[実機 1.21.1: pressure-plate-wood]。石の板で真下の支えが強充電され、壁トーチが t4 に消え t24 に戻る
[実機 1.21.1: pressure-plate-stone]。

**生存**: 真下が上面で頑丈に支えられる (rigid) か、中心で支えられるか
[26.3 読解: BasePressurePlateBlock#canSurvive]。真下からの PP で確かめ、だめなら空気になる。

**BasePressurePlateBlock#affectNeighborsAfterRemoval**: ピストン移動でなく信号が 0 より大きければ updateNeighbours。

### 4.4 トリップワイヤー (紐とフック)

#### 4.4.1 紐 (TripWireBlock)

紐は信号源ではない。紐の変化をフックへ知らせるだけである。
紐の entityInside は形の箱 (§3.5) に当たったときだけ呼ばれる
(TripWireBlock#getEntityInsideCollisionShape が形を返す。他の素子は既定のフルブロック) (→ 17)。

**TripWireBlock#entityInside** (エンティティ相): サーバー側で、powered でなく、
**自分に予約 tick が入っていない**ときだけ、そのエンティティ 1 体だけを並べて checkPressed。

**TripWireBlock#tick** (予約 tick 相): 今のワールドの紐が powered なら、紐の形の外接箱にいる
エンティティ (観戦者を除く) を集めて checkPressed。

**TripWireBlock#checkPressed** (エンティティの並びを受ける版)
1. 並びに isIgnoringBlockTriggers が偽のものが 1 体でもいれば押されているべき。
2. 今の powered と違えば、powered を flag 3 で書き、TripWireBlock#updateSource。
3. 押されているべきなら 10 gt、そうでなくて元が押下だったなら **1 gt** の予約 tick を出す。
   1 gt の予約は解除直後に entityInside を止めるためだけにある (tick が来ても powered でないので何もしない)。

**TripWireBlock#updateSource** (紐の位置と、フックに渡す紐の状態を受ける)
1. 南、次に西の順で、1〜41 マス先を見る。
2. フックに当たったら、その facing が走査の逆向き (こちらを向いている) のとき
   TripWireHookBlock#calculateState (配る = 真、紐の番号 = 距離、その番号の紐の状態 = 渡された状態)。どちらにせよ止める。
3. 紐でないものに当たったら止める。

**TripWireBlock#onPlace**: 別のブロックから紐になったとき updateSource。
**TripWireBlock#affectNeighborsAfterRemoval**: ピストン移動でなければ、**powered = true にした状態で** updateSource。
ピストンに壊されたとき (POPPED) も、押し終わりに「ピストン移動 = 偽」で呼ばれるので、鋏なしで壊したのと同じになる
[26.3 読解: PistonBaseBlock#moveBlocks]。/setblock で消したときは ServerLevel#updateNeighboursOnBlockSet から呼ばれる。
**TripWireBlock#playerWillDestroy**: サーバー側でプレイヤーの利き手が鋏なら、disarmed = true を
フラグ 260 (4 + 256。NC もクライアント送信も無いが、16 を含まないので **PP は出る**) で書き、GameEvent shear。
そのあと普通に壊れる。隣のオブザーバーは disarm の PP で反応する [26.3 読解: Level#setBlock]。
**TripWireBlock#updateShape**: 水平の隣が紐か、こちらを向くフックかで north/east/south/west を決め直す (PP の受け手)。

#### 4.4.2 フック (TripWireHookBlock)

**信号** [26.3 読解: TripWireHookBlock#ownSignal / #getDirectSignal]: powered で弱 15 全方向、
facing と同じ向きで問われたとき (= 背後の支えから) 強 15。

**生存**: facing の逆隣 (背後) の面が sturdy か。背後からの PP で確かめる。

**TripWireHookBlock#calculateState** (位置・状態・壊れる途中か・自分の周りへ配るか・紐の番号 (無ければ −1)・その番号で使う紐の状態)
1. 状態に facing が無ければ何もしない。
2. 向き d = facing。旧値 wasAttached・wasPowered を状態から読む。attached の初期値は「壊れる途中でない」、
   powered は偽、相手の距離 r = 0。長さ 42 の控えを用意する。
3. i = 1〜41 について、フックから d へ i マス先を見る。
   1. フックなら、その facing が d の逆のとき r = i。どちらにせよ走査を終える。
   2. 紐でもなく指定番号でもなければ、控えを空にして attached = 偽 (走査は**続ける**)。
   3. 紐か指定番号なら、指定番号のときは渡された紐の状態を使う。
      armed = disarmed でない。powered に「armed かつ紐が powered」を足す。控えに入れる。
      指定番号のときはさらに、**このフックに 10 gt の予約 tick** を出し、attached を armed と掛け合わせる。
4. attached に「r > 1」を掛ける (隣接したフック同士は張れない)。powered に attached を掛ける。
5. 新状態 = フックの**既定状態**に attached と powered を入れたもの。
6. r > 0 (向かい合うフックがいる) なら:
   1. 相手のマスへ 新状態 + facing = d の逆 を flag 3 で書く。
   2. 相手の notifyNeighbors: 相手のマス 6 → 相手の背後 (支え) 6。
   3. この時点で自分のマスがフックでなくなっていれば、新状態で onRemoved を呼んで**ここで終わる**
      (手順 6-4 以降の emitState・自分の書き込み・紐の書き戻しはどれも走らない)。
   4. 相手のマスで emitState。
7. 自分のマスで emitState。
8. 壊れる途中でなければ、自分のマスへ 新状態 + facing = d を flag 3 で書き、
   「配る」なら自分の notifyNeighbors (自分 6 → 背後 6)。
9. wasAttached と attached が違えば、i = 1〜r−1 の控えた紐を、**今そのマスが紐かフックのときだけ**、
   控えの状態に attached を入れて flag 3 で書く (自分に近い方から)。r = 0 なら何もしない。

emitState は旧値と新値を比べ、powered の立ち上がり → click_on と block_activate、立ち下がり → click_off と
block_deactivate、それ以外で attached の立ち上がり → attach と block_attach、立ち下がり → detach と
block_detach を、この優先順で 1 つだけ出す。**detach の音程だけ主乱数を 1 回使う** (→ 18)。GameEvent の出所はどれも無し。
比べる旧値は**発信フックの**旧値である。相手フックの位置で鳴る音も、相手自身の旧状態ではなく発信側の旧状態との差で決まる。
両端で外れると emitState が 2 回 detach を出すので、主乱数を 2 回使う。

**呼ばれる場面**

| 契機 | 呼び方 |
|---|---|
| 紐の状態が変わった・紐が置かれた・壊れた | 紐の updateSource から (配る = 真、番号あり) |
| フックの予約 tick | TripWireHookBlock#tick → 番号なし (−1)・配る = 真 |
| プレイヤーがフックを置いた | TripWireHookBlock#setPlacedBy → 番号なし・**配る = 偽** (アイテムで置いたときだけ。/setblock では走らない) |
| フックが壊れた (ピストン移動でない) | onRemoved: attached か powered なら calculateState (壊れる途中 = 真・配る = 偽)。powered だったなら自分の notifyNeighbors |

**フックの順** [26.3 読解: TripWireBlock#updateSource + #calculateState]: 紐の変化では、南・西の走査で
見つかったフック (南北の線なら**南端**、東西の線なら**西端**) が発信側になる。発信側は相手を先に書き換えて
周りへ配るので、**北端 / 東端のフックの下流が先に動く**。紐の attached の書き換えはその後で、発信側に近い紐から順。

**典型の時系列** (両端にフック、紐はすべて張ってある線。エンティティが紐 k に入る)

| 時 | 起きること |
|---|---|
| tick T のエンティティ相 (プレイヤーなら接続処理。§2.2) | 紐 k が powered (flag 3。紐の 自分 6 の NC と PP が先に終わる) → 発信フックの走査の途中で発信フックに 10 gt の予約 → 相手フック powered (flag 3 + 配る) → 発信フック powered (flag 3 + 配る) → 紐 k に 10 gt の予約 |
| T+10 の予約 tick 相 | 予約の順 (発信フックの方が先に予約された) で、まず発信フックが calculateState を番号なしで再計算 (紐 k はまだ powered なので状態は同じ。それでも notifyNeighbors を相手・自分とも出す)。次に紐 k: 箱にまだいれば何も書かず 10 gt を出し直す |
| 離れた後の予約 tick (T+10m) | 紐 k が powered = false → フック再計算 (powered 偽。click_off) → 発信フックに 10 gt、紐 k に 1 gt。同じ tick の残りの相では、紐 k に予約があるので entityInside は踏まれても何もしない |
| その 1 gt 後 | 紐 k の tick は何もしない。予約 tick 相で取り出された時点で予約は無くなるので、この tick のエンティティ相から再び踏める |
| 解除から 10 gt 後 | 発信フックの予約 tick が番号なしで再計算する (状態は同じでも notifyNeighbors を相手・自分とも出す) |

**紐を壊したとき**
- 鋏なし: 除去で powered = true の紐として updateSource が走るので、線はまだ張ったまま (その位置を紐とみなす) で
  **両フックが powered になる**。発信フックに 10 gt の予約が出て、10 gt 後の再計算でその位置が空気なので
  attached が偽になり、両フックとも外れて powered も落ちる。紐は attached = false に書き換わる。
- 鋏あり: disarmed = true の紐として計算されるので、powered にならず、**その場で外れる**
  (両端の emitState が detach を出し、紐は attached = false に書き換わる。取り除いた位置は空気なので書き戻さない)。
  発信フックへの 10 gt の予約は鋏ありでも出るが、再計算でも外れたままである。

**フックを壊したとき** (26.3。ピストン移動でない。張った線 = 向かい合う相手フックがいる場合) [26.3 読解: TripWireHookBlock#onRemoved / #calculateState]
1. 除去フックの onRemoved が、壊れる途中 = 真で calculateState を呼ぶ (attached か powered のときだけ)。
2. 相手フックに attached = 偽・powered = 偽を flag 3 で書き、相手の notifyNeighbors (相手 6 → 相手の支え 6)。
3. 自分のマスはもう空気なので手順 6-3 で終わる。後始末の onRemoved は新状態 (attached・powered とも偽) を見るので何もしない。
4. **emitState が走らない**ので、どちらのフックでも detach の音も block_detach も出ない。**紐の attached も真のまま残る**。
5. 壊したフックが powered だったなら、外側の onRemoved が自分の notifyNeighbors (自分 6 → 背後 6) を出す。

残った紐は attached = 真のまま、形も低い (§3.5) ままである。後で踏んでも、残ったフックの再計算は
「旧 attached = 偽、新 attached = 偽」で差が無いので、紐を書き換えない。新しくフックを張り直すまでこのまま残る。
1.21.1 はこの早期終了が無く、紐を外していた (§6)。実機の確認は [要実機] として §8 に残す。

### 4.5 トラップチェスト

**信号** [26.3 読解: TrappedChestBlock#ownSignal / #getDirectSignal]
- ownSignal: その半分の BlockEntity の開いている数を 0〜15 に切り詰めた値。向きによらない。
- getDirectSignal: 上向きで問われた (= 真下から) ときだけ同じ値。真下だけ強充電する。

**開く** (プレイヤー: 入力境界): ChestBlock#useWithoutItem → メニュー → チェストのメニューの生成で
各コンテナの startOpen。大きなチェストは **type = right の半分が先**、left の半分が後
(北向きなら東の半分が先) [26.3 読解: ChestBlock#getBlockType / DoubleBlockCombiner#combineWithNeigbour / CompoundContainer#startOpen]。
開けない条件: 真上が導体、または真上の箱に座った猫がいる (大きなチェストはどちらかの半分でも) [26.3 読解: ChestBlock#isChestBlockedAt]。
観戦者は数えない [26.3 読解: ChestBlockEntity#startOpen]。

**ContainerOpenersCounter#incrementOpeners**
1. 数を 1 増やす。前が 0 なら、開く音 (left の半分は鳴らさない。鳴らすとき主乱数を 1 回使う)、
   GameEvent container_open、5 gt の予約 tick (ChestBlock の tick)。
2. openerCountChanged → ChestBlockEntity#signalOpenCount:
   1. ブロックイベント (種類 1、引数 = 新しい数) を積む (蓋の動き。→ 03)。
   2. トラップチェストだけ: 前と数が違えば 自分 6 → 真下 6 の NC
      (Orientation は前 = facing の逆・上 = 上) [26.3 読解: TrappedChestBlockEntity#signalOpenCount]。
3. 最大の操作距離を覚える (プレイヤーは block_interaction_range、既定 4.5)。

**ContainerOpenersCounter#decrementOpeners** (GUI を閉じる・離れて GUI が閉じる): 1 減らし、0 になったら閉じる音・
GameEvent container_close・距離を 0 に。そのあと openerCountChanged (上と同じ)。

**ContainerOpenersCounter#recheckOpeners** (ChestBlock#tick。予約 tick 相)
1. ブロックの箱を (覚えた最大距離 + 4) 広げた箱で、そのチェストを開いている ContainerUser を集める
   (プレイヤーは開いているメニューにこの BlockEntity が含まれるか、銅ゴーレムは開いた位置がここか相方か。観戦者は除く)。
2. 数が違えば置き換える。0 をまたぐときだけ開閉の音と GameEvent (出所なし) を出す。
3. **数が同じでも** openerCountChanged を呼ぶ (ブロックイベントは毎回積まれる。NC は数が違うときだけ)。
4. 数が 0 より大きければ 5 gt の予約 tick を出し直す。

**銅ゴーレム**: トラップチェストは運び先に入っている (運び先は chest と trapped_chest。運び元は銅のチェスト)。
目標に着いた次の段 (着いてから 1 段目) で startOpen し、そのあと開いた位置を覚える。60 段目で、まだ開いている者に
含まれていれば stopOpen して位置を忘れる。段は行動 (TransportItemsBetweenContainers) が回るたびに 1 増える
[26.3 読解: CopperGolemAi#onReachedTargetInteraction / TransportItemsBetweenContainers#onReachedTarget] (→ 17)。
途中で目標から 2 ブロックより離れると、stopOpen を呼ばずに位置だけ忘れる。数は次の数え直し (5 gt 以内) で減る。
ゴーレムの操作距離は 3.0 で、プレイヤーの 4.5 より短い。

**除去**: ChestBlock#affectNeighborsAfterRemoval は CU だけ。トラップチェストは上書きしない (§5)。

blockstate は変わらないので PP は出ず、オブザーバーは開閉を見ない。コンパレーターは背後のチェストの
**充填率**を読み、開いている数は読まない (アナログ出力を持つブロックはそちらが優先。→ 07)。
充填率は開けない条件と同じ判定を通すので、真上が導体のチェストや猫が座ったチェストは、中身があってもコンパレーターに 0 を返す。
大きなチェストは両方の半分を合わせた中身で計算する [26.3 読解: ChestBlock#getAnalogOutputSignal / ChestBlock#getContainer] (→ 14)。

### 4.6 書見台

**信号** [26.3 読解: LecternBlock#ownSignal / #getDirectSignal]: powered で弱 15 全方向、真下から問われたとき強 15。

**アナログ** [26.3 読解: LecternBlock#getAnalogOutputSignal / LecternBlockEntity#getRedstoneSignal]
1. has_book が偽なら 0。
2. 進み = ページ数が 2 以上なら「今のページ ÷ (ページ数 − 1)」、それ以外は 1.0 (float)。
3. 出力 = 進み × 14 の切り捨て + (本の実体があれば 1)。本の実体 = 本と羽根ペンか記入済みの本の中身を持つアイテム。

float32 でページ数 2〜200 の全ページを計算すると、整数の floor(14 × page / (ページ数 − 1)) + 1 と一致した。
空の本と羽根ペン (0 ページでも中身の部品を持つ) は 1.0 × 14 + 1 = 15、本の実体が無い has_book = true は 14。

**ページ送り** (入力境界。GUI のボタン 1 = 前、2 = 次、100 以上 = 100 を引いたページへ) → LecternBlockEntity#setPage。
ボタンの操作は観戦者からは受け付けず、メニューがまだ有効 (近くにいて、本の実体がある) なときだけ通る
[26.3 読解: LecternMenu#clickMenuButton / ServerGamePacketListenerImpl#handleContainerButtonClick]。
1. 新ページ = ページを 0〜(ページ数 − 1) に切り詰めた値 (ページ数 0 のときの癖は §5)。
2. 今と同じなら何もしない (最終ページで「次」を押してもパルスは出ない)。
3. ページを置き換え、setChanged (**CU**)。
4. LecternBlock#signalPageChange:
   1. powered = true を flag 3 で書く (自分 6 の NC → CU → 自分 6 の PP)。
   2. updateBelow: 真下 6 の NC。
   3. 2 gt の予約 tick。
   4. めくる音 (level event 1043)。

**LecternBlock#tick** (2 gt 後): **条件なしで** powered = false を flag 3 で書き、真下 6 の NC。

**本を置く・取る** (LecternBlock#resetBookState): powered = false と has_book を flag 3 で書き、GameEvent block_change、
真下 6 の NC。置くときは先に本を入れて setChanged (CU)、取るときは後で setChanged (CU)。パルスは出ない。
取るのは GUI のボタン 3 で、建築できるプレイヤーだけ [26.3 読解: LecternMenu#clickMenuButton]。
書見台の BlockEntity はコンテナではないので、ホッパーは出し入れできない。

**LecternBlock#affectNeighborsAfterRemoval**: powered なら真下 6 の NC (ピストン移動かを見ないが、BlockEntity 持ちで動かないので問題にならない)。

### 4.7 ターゲット

**信号** [26.3 読解: TargetBlock#ownSignal]: power を全方向に弱で出す。getDirectSignal は無い (強充電しない)。
フルブロックなので導体でもある [実機 1.21.1: target-conduct]。

**TargetBlock#onProjectileHit** (投射物の命中。エンティティ相) → updateRedstoneOutput
1. 強さ = 命中点の、当たった面の中心からの距離で決める (下の式)。
2. 持続 = 投射物が AbstractArrow (矢・光の矢・トライデント) なら 20、それ以外 (雪玉・卵・ポーションなど) は 8。
3. **自分に予約 tick が入っていなければ**、power を flag 3 で書いて持続 gt の予約 tick を出す。入っていれば何もしない
   (強い命中でも上書きも延長もしない)。

**強さの式**: 当たった面の 2 軸について、命中点の小数部と 0.5 の差の絶対値の大きい方を d (ブロック単位) とし、
強さ = max(1, ceil(15 × clamp((0.5 − d) / 0.5, 0, 1)))。つまり d < 1/30 で 15、
(15 − k)/30 ≤ d < (16 − k)/30 で k (k = 2〜14)、d ≥ 14/30 で 1。1 段の幅は 1/30 ブロック (約 0.53 px)。

**TargetBlock#tick**: power が 0 でなければ 0 を flag 3 で書く。

**TargetBlock#onPlace**: サーバー側で、別のブロックから置かれ、power > 0 で自分の予約 tick が無ければ、
power = 0 を **フラグ 18 (NC も PP も無し)** で書く。外側の書き込みも置いた状態と一致しなくなるので更新を配らない。
ピストンで運ばれた発光中のターゲットは、何も知らせずに 0 になる (§5)。/setblock の power 指定も 0 になる
(/setblock は後で自分 6 の NC を別に出すが、そのときはもう 0)。予約 tick の有無は位置ごとに見るので、元の位置の予約は
新しい位置の判定に効かない。

### 4.8 避雷針

**信号** [26.3 読解: LightningRodBlock#ownSignal / #getDirectSignal]: powered で弱 15 全方向、
facing と同じ向きで問われたとき (= 背後の支えから) 強 15。facing は置いた面 (支えから離れる向き)。

**落雷点**: 雷 (LightningBolt) は最初の tick (life = 2) に、自分の位置から 1e−6 だけ下の点を含むブロックが
LightningRodBlock なら onLightningStrike を呼ぶ。自然の雷は、半径 128 にある避雷針 (POI) から
「そのマスがその列の地表 (WORLD_SURFACE − 1)」のものを選び、探索の中心 (乱数で選んだ位置の MOTION_BLOCKING の高さ) に
最も近い 1 本の 1 つ上に落ちる。落ちる位置が雨の降る位置 (isRainingAt) でなければ雷は生まれない
[26.3 読解: LightningBolt#powerLightningRod / ServerLevel#findLightningRod / #findLightningTargetAround / #tickThunder] (→ 17)。
生成から通電まで: 天候の雷はチャンク相で生まれ、同じ tick のエンティティ相で最初の tick を迎えて通電する。
/summon の雷は入力境界で生まれ、次の tick のエンティティ相で通電する [26.3 読解: ServerLevel#tick の相の順] [要実機] (→ 01 P13)。
見た目だけの雷 (visualOnly) でも通電と銅戻しは行う (止まるのは着火と被害だけ)。スケルトンホースの罠は真下が避雷針で
ないときだけ起きるので、罠の雷が避雷針に落ちることは無い [26.3 読解: LightningBolt#tick / ServerLevel#tickThunder]。

**LightningRodBlock#onLightningStrike**
1. powered = true を flag 3 で書く (自分 6 の NC → 自分 6 の PP)。
2. updateNeighbours: **背後の支え 6 だけ**の NC (前 = facing の逆。上は指定なし)。
3. 8 gt の予約 tick。
4. 火花の level event 3002。
同じ雷の tick の続きで、打たれたブロックが酸化する銅なら最初の段階へ戻す書き込みが入り、
その周りの銅も主乱数で選んで削る (§5) [26.3 読解: LightningBolt#clearCopperOnLightningStrike]。

**LightningRodBlock#tick**: **条件なしで** powered = false を flag 3 で書き、支え 6 の NC。
**LightningRodBlock#onPlace**: 別のブロックから置かれ、powered で、自分の予約 tick が無ければ **8 gt の予約 tick を出す** (消さない)。
**LightningRodBlock#affectNeighborsAfterRemoval**: powered なら支え 6 の NC (ピストン移動でも出す)。
**WeatheringLightningRodBlock#randomTick**: 酸化 (別のブロックへの置き換え)。

### 4.9 日照センサー

**信号** [26.3 読解: DaylightDetectorBlock#ownSignal]: power を全方向に弱で出す。強充電しない。

**更新の契機**: BlockEntity の ticker で、ゲーム時刻が 20 の倍数の tick だけ updateSignalStrength。
ticker はサーバー側で、ディメンションに空の光があるときだけ付く (オーバーワールドとジ・エンド。ネザーは付かない)
[26.3 読解: DaylightDetectorBlock#getTicker / #tickEntity / data の dimension_type]。

**DaylightDetectorBlock#updateSignalStrength**
1. s = その位置の空の光 − 空の暗さ (skyDarken)。0 未満は 0 (LevelReader#getEffectiveSkyBrightness)。
2. 太陽角 a = 環境属性 sun_angle (度) × π / 180 (float)。
3. 反転なら s = 15 − s。反転でなく s > 0 なら、a が π 未満なら目標 0、それ以外は 2π として、
   a を目標との差の 0.2 倍だけ寄せ (a + (目標 − a) × 0.2)、s = round(s × cos a)。
   cos は Java の Math.cos ではなく **Mth#cos の表引き**である。表は 65536 区分の正弦 (値は float) で、添字は
   「a × 10430.378350470453 + 16384」を long に切り捨てて 65535 と AND した値。s × cos a は float で求め、
   丸めは float の Math.round (0.5 は切り上げ) [26.3 読解: Mth#cos / Mth#sin の表]。
4. s を 0〜15 に切り詰め、power と違うときだけ flag 3 で書く。

空の暗さは Level#updateSkyBrightness が tick の頭で「15 − 環境属性 sky_light_level」の整数部にする。
26.3 の昼夜は data の timeline (day) が sun_angle と sky_light_level の鍵を持ち、雨と雷は WeatherAttributes が
sky_light_level を 4 へ寄せる (雨 0.3125・雷 0.52734375 の割合)。時刻と出力の対応表はデータとライティング次第なので [要実機]。

**DaylightDetectorBlock#useWithoutItem**: 建築できるプレイヤーなら、inverted を反転して **flag 2** で書き (PP だけ)、
GameEvent block_change、続けて updateSignalStrength (値が変われば flag 3)。周期を待たずにその場で更新される。

### 4.10 ジュークボックス

**信号** [26.3 読解: JukeboxBlock#ownSignal]: BlockEntity の再生器が「曲を持つ」(演奏中) なら弱 15 全方向。
強充電しない。円盤が入っていても曲が終われば 0。フルブロックなので導体でもある。

**アナログ** [26.3 読解: JukeboxBlock#getAnalogOutputSignal / JukeboxBlockEntity#getComparatorOutput]:
入っている円盤の comparator_output (§3.7)。演奏中かどうかによらない。

**円盤を入れる** (入力境界。JukeboxPlayable#tryInsertIntoJukebox、またはホッパー) → JukeboxBlockEntity#setTheItem
1. アイテムを置き換える。
2. has_record = 真 を **flag 2** で書き (PP だけ)、GameEvent block_change。
   ticker は has_record が真の間だけ付く (→ 01 の BlockEntity 相)。
3. 曲があれば JukeboxSongPlayer#play: 曲を持ち、経過 0、level event 1010、onSongChanged。
4. onSongChanged: 自分 6 の NC → setChanged (CU)。

**JukeboxSongPlayer#tick** (BlockEntity 相)
1. 経過が L + 20 以上なら stop: 曲を捨て、GameEvent jukebox_stop_play、level event 1011、onSongChanged (自分 6 → CU)。
2. そうでなければ、経過が 20 の倍数のとき GameEvent jukebox_play と音符の粒子 (主乱数を 1 回使う)、経過 + 1。

**長さの数え方** [26.3 読解: LevelChunk#updateBlockEntityTicker / Level#addBlockEntityTicker / #tickBlockEntities]
1. has_record が偽の間は ticker が無い。has_record を真にした書き込みの中で ticker が新しく作られ、BlockEntity の ticker の列の**末尾**に付く。
2. 入力境界で入れたときは、そのまま列に入り、次の tick の BlockEntity 相から回る。ホッパーが BlockEntity 相の中で入れたときは
   保留の列に入り、次の tick の BlockEntity 相の頭で本の列へ移ってから回る。どちらも「入れた tick を N として N+1 から」である。
3. k 回目の tick は経過 k − 1 を見るので、経過が L + 20 に達するのは L + 21 回目で、そこで止まる。
   つまり N+L+21 の BlockEntity 相で 0 になり、15 は L + 21 gt 続く (円盤 11 なら 1441 gt) [要実機]。
4. 円盤を抜くと ticker は外れる。入れ直すたびに列の末尾へ付き直すので、同じ tick の他の BlockEntity との順が変わる (→ 01)。

**取り出す** (右クリック) → JukeboxBlockEntity#popOutTheItem: アイテムを空にする (setTheItem: has_record = 偽を flag 2、
演奏中なら stop で自分 6 → CU) → アイテムを上へ出す (位置のずらしに主乱数を 2 回使う) → もう一度 onSongChanged (自分 6 → CU)。
ホッパーは空きスロットがあるときだけ抜ける (JukeboxBlockEntity#canTakeItem)。

**除去**: 円盤を出し (上と同じ更新。ただしワールドはもう空気なので has_record は書かない)、CU (Containers#updateNeighboursAfterDestroy)。
壊したときの順 [26.3 読解: LevelChunk#setBlockState / JukeboxBlockEntity#preRemoveSideEffects / #setRemoved]:
1. preRemoveSideEffects が円盤を出す (演奏中なら stop の 自分 6 → CU、出した後の onSongChanged の 自分 6 → CU)。
2. BlockEntity を外す。JukeboxBlockEntity#setRemoved は演奏の有無によらず jukebox_stop_play と level event 1011 を出す。
3. 除去フックの CU。
4. 書き込み自体の 自分 6 の NC と PP。

/setblock (フラグ 256 付き) で置き換えたときは preRemoveSideEffects が走らないので、円盤は出ずに消える。

---

## 5. 端の場合と落とし穴

**共通**
- 弱信号はどれも向きを持たない (ownSignal)。強充電はレバー・ボタン・フック・避雷針 (支え)、感圧板・トラップチェスト・
  書見台 (真下) だけで、ターゲット・日照センサー・ジュークボックスは強充電しない [26.3 読解]。
- **/setblock で powered = true のまま置いた** ボタン・感圧板・紐・フック・書見台は、予約 tick が無く entityInside も
  「未押下のときだけ」なので、外から何か起きるまで押されたまま残る (ボタンは手で押しても押下中なので何もしない)。
  紐だけは onPlace の updateSource でフックを再計算するので、張った線ならフックも powered になって残る。
  ターゲットは onPlace で黙って 0、避雷針は 8 gt 後に消える [26.3 読解: 各 #onPlace の有無]。
- /setblock は 26.3 で「フラグ 2|256 で置く (この中で onPlace と自分 6 の PP) → 置き換えたなら古い状態の除去フック →
  自分 6 の NC → 新しい状態がアナログ持ちなら CU」の順になる (SetBlockCommand#setBlock / ServerLevel#updateNeighboursOnBlockSet)。
  プレイヤーの破壊 (flag 3) とは除去フックと PP の前後が違う (→ 04)。strict を付けるとフラグ 2|816 で置き、
  onPlace も PP も除去フックも後の NC・CU も出さない。どちらもフラグ 256 が入るので、置き換えたコンテナ・ジュークボックス・書見台の中身は落ちない。
- 型 B (感圧板) は PP が NC より先、型 A は NC が先。同じ gt・同じ優先度でコンパレーター (NC で予約) と
  オブザーバー (PP で予約) が競うと、素子の型で勝者が変わる。

**レバー・ボタン**
- ボタンを押下中にもう一度押しても延長しない (useWithoutItem が何もしない)。
- 木のボタンを押し続けるのは**刺さった矢**だけ。確認は 30 gt ごとの予約 tick で、そのとき**押下中の形 (厚さ 1 px)** に
  矢の箱が掛かっていれば 30 gt 出し直す。矢が消えると、最後に確認した tick から 30 gt 後に戻る (消えてから 1〜30 gt 後)。
  刺さった矢は刺さってから 1200 gt で消える。刺さった先のブロックが変わって周りに当たりが無くなると落ち始める
  [26.3 読解: AbstractArrow#tickDespawn / #tick] (→ 17)。石系は矢を見ない [26.3 読解: ButtonBlock#checkPressed]。
  ボタンには当たり判定が無いので、矢はボタンを通り抜けて支えに刺さる。刺さった矢の箱と押下中のボタンの箱 (厚さ 1 px) が
  重なる幾何条件は [要実機]。
- 矢で押されたとき、GameEvent の出所は矢、押下の音は出所なしで鳴る。
- 風チャージ (起動型の爆発) はレバーを**反転**させ、石を含むすべてのボタンを押す。感圧板には何もしない。
  普通の爆発はどれも壊す (除去フックで更新が出る)。

**感圧板**
- **押下中は数えない**。entityInside は信号 0 のときだけ checkPressed するので、押下中に乗る数が変わっても
  重量板の出力は次の確認 (10 gt ごと) まで据え置き。解除も確認の tick でしか起きない (最大 20 / 10 gt 遅れる)。
- 石の板は防具立て (マーカーでないもの) で押される。アイテムでは押されない。木の板は矢やトロッコでも押される。
- 観戦者・マーカー・表示エンティティ・Interaction・コウモリは数えない。

**トリップワイヤー**
- 解除の後 1 gt は踏み直せない。1.21.1 は同じ tick に踏み直せた (§6)。
- フックの予約 tick (紐の変化から 10 gt) は、状態が変わらなくても相手・自分の notifyNeighbors を出す。
  フックの周りや支えの隣に BUD を置くと、紐の変化の 10 gt 後に揺すられる [26.3 読解: TripWireHookBlock#calculateState]。
- 北端 / 東端のフックの下流が先に動く (§4.4.2)。
- 26.3 では**フックを壊しても紐の attached が真のまま残り、detach の音と GameEvent も出ない** (手順 6-3 の早期終了で、
  emitState と手順 9 の紐の書き換えに届かない。§4.4.2「フックを壊したとき」)。読みでは確定だが、実機の見た目は
  [要実機]。1.21.1 は紐を外していた [26.3 読解: TripWireHookBlock#calculateState / #onRemoved]。
- 壊れる途中でない呼び出し (紐の変化・予約 tick) で、相手フックへの書き込みの連鎖が発信フックを消すと、
  後始末の onRemoved は新状態を受け取る。新状態は既定状態から作るので **facing が既定の north のまま**である。
  attached か powered が真なら north 向きとして再計算し、powered なら north 向きの notifyNeighbors (自分 6 → 南隣 6) も出す。
  向きのずれた更新が出うる [26.3 読解: TripWireHookBlock#calculateState] [要実機]。壊れる途中の呼び出しでは
  新状態が attached・powered とも偽なので、この後始末は何もしない。
- /setblock でフックを置いても calculateState は走らない (フックに onPlace が無い。プレイヤーの設置の setPlacedBy だけ)。
- 線の長さは紐 40 本まで (相手は 41 マス先まで)。隣接したフック同士は張れない。
- disarmed の紐 (コマンドでしか作れない) を踏むと、その番号の attached が偽になるので線が外れ、10 gt 後の再計算で戻る。

**トラップチェスト**
- 半分ごとに数える。プレイヤー 1 人で大きなチェストを開くと、両方の半分がそれぞれ 1 を出す。
- コンパレーターは充填率を読む (開いている数ではない)。リピーター・ダストは開いている数を読む。
- 開いたまま壊すと、真下の周りへの NC が無い (TrappedChestBlock に除去フックが無い)。真下のブロック越しに
  強充電されていた素子が取り残されうる [26.3 読解] [要実機]。
- 読み込み直後は数が 0 (保存しない)。数え直しの予約 tick は残るので、開いている者がいれば 5 gt 以内に戻る。
- ホッパーの出し入れは数に入らない。銅ゴーレムは 1 人として、1 段目の startOpen から 60 段目の stopOpen まで
  59 段数える [26.3 読解: CopperGolemAi#onReachedTargetInteraction]。段が毎 gt 進むか (= 59 gt か) は [要実機]。

**書見台**
- 2 gt 以内に 2 回めくっても、2 回目の予約は重複で捨てられ、パルスは延びない (POWERED は最初の書き込みのまま)。
- コンパレーターはパルス中もページのアナログ値を読む (信号 15 ではない)。真下のブロックの強充電は 15。
- **26.3 の癖**: ページ数 0 (空の本と羽根ペン) では、切り詰めが min(max(ページ, 0), −1) = −1 になる。
  本を置いた直後 (ページ 0) に「前」「次」「100 以上」のどれを押しても、ページが −1 になってパルスが 1 回出る。
  以後はどのボタンでも −1 のままなのでパルスは出ない。アナログは 15 のまま。
  読み込み (LecternBlockEntity#loadAdditional) も同じ切り詰めを通るので、読み込み直後のページは −1 で、最初の 1 回のパルスも出ない。
  26.4-pre-1 で直る [26.3 読解: LecternBlockEntity#setPage / #loadAdditional]。

**ターゲット** (§4.7 のほか)
- 発光中にピストンで押すと、着地の書き込み (フラグ 67) の中の onPlace がフラグ 18 で 0 にする。外側の書き込みは
  置いた状態と一致しなくなるので、着地点の周りへ NC も PP も出さない (続く PistonMovingBlockEntity の neighborChanged は自分にだけ届く)
  [26.3 読解: PistonMovingBlockEntity#tick / TargetBlock#onPlace / Level#setBlock]。
  着地点の周りは、それまで moving_piston (信号源でない) を見ていたので、15 のまま取り残される素子は無い。
  ただし「導体が来た」ことも知らせないので、着地点が別の信号源で強充電されていても、隣のランプなどは次の更新まで変わらない [要実機]。
  元の位置の周りは、ピストンの押し終わりの updateNeighborsAt で知らされる (→ 13)。

**避雷針**
- 2 回目の落雷は延長しない (予約が重複で捨てられる。書き込みも同じ状態なので更新なし。ただし支え 6 の NC は出る)。
- 自分の周り 6 へは flag 3 の NC だけで、自前の updateNeighbours は支え 6 だけ。
- 26.3 の onPlace は「消さずに 8 gt 予約」なので、/setblock lightning_rod[powered=true] は 8 gt のパルス源になる。
  ピストンで運んだ発光中の避雷針も着地から 8 gt 光る。1.21.1 は onPlace が黙って消していた (§6)。
- 通電中に**別のブロックへ置き換わる**と、古いブロックの予約 tick は走らず (ServerLevel#tickBlock がブロックの一致を見る)、
  新しいブロックの onPlace が 8 gt を出し直す (予約の有無はブロックの種類ごとに見るので、新しいブロックには予約が無い)。
  1. 酸化 (ランダム tick。チャンク相) で置き換わったとき: その tick から 8 gt を数え直すので、パルスが延びる。
  2. 酸化した避雷針に落雷して銅戻しで置き換わったとき: 通電と同じ tick に出し直すので、長さは 8 gt のまま変わらない。
     古いブロックの除去フックの 支え 6 と、置き換えの書き込みの 自分 6 の NC・PP が余分に出るだけである。
  [26.3 読解: LightningRodBlock#onPlace / LightningBolt#clearCopperOnLightningStrike / ServerLevel#tickBlock]。
  蝋引きの避雷針は酸化も銅戻しもしない (LightningRodBlock のまま)。
- 落雷の銅戻しは周りの銅 (銅の電球など) も変えうる。主乱数を使う (→ 11・18)。

**日照センサー**
- 値はゲーム時刻が 20 の倍数の tick の BlockEntity 相でしか変わらない (反転操作の直後を除く)。
  onPlace は無いので、置いた直後は power 0 (/setblock なら指定の値) のまま、次の 20 の倍数の tick まで変わらない。
  同じ tick に更新される複数のセンサーの順は、BlockEntity の ticker の列の順 (ticker を付けた順。置いた順や読み込みの順) である (→ 01)。
- ネザーでは ticker が無いので、反転したときの 1 回 (空の光が 0 で 15) から変わらない [要実機]。
  ジ・エンドは 26.x で空の光を持つので更新される。ジ・エンドの timeline は day を含まないので、太陽角は既定の 0 度・
  sky_light_level は既定の 15 になり、空が見えれば非反転で空の光そのものを出すと読める (§6) [要実機]。

**ジュークボックス**
- 15 を出すのは「演奏中」で、円盤が入っていても曲が終われば 0。コンパレーターは円盤の値を読み続ける。
- 演奏中のジュークボックスの背後のコンパレーターは、15 ではなく円盤の値を読む (アナログ優先)。
- 導体なので強充電されうるし、自分も 15 を出す (ターゲットと同じく「導体かつ信号源」)。

---

## 6. 版差

担当クラスを 1.21.1・26.2・26.4-pre-1 と diff -u した。挙動に効くものだけ挙げる。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| entityInside の呼ばれ方 (→ 17) | 最終位置の箱 (1e−7 縮め) が重なる全マスで呼ぶ。形を見ない | 移動の経路に沿って呼ぶ。紐は形に当たったときだけ | 26.2 と同じ | 同じ (中身の引数が少し増えるだけ) |
| 紐の entityInside | 押下でなければ、形の箱にいるエンティティを全部集めて判定。予約の有無を見ない | 押下でなく予約も無いとき、そのエンティティ 1 体で判定 | 同じ | 同じ |
| 紐の解除後の予約 | 無し (同じ tick に踏み直せる) | **0 gt** の予約 (予約 tick 相の途中で積むので次の tick に走る。踏み直せるのは 26.3 と同じく次の tick から。違うのは同じ tick の予約の中の並びだけ) | **1 gt** の予約 | 1 gt |
| フックの calculateState | 発信側が消えたかの確認が無い (フックを壊すと紐の attached も外れ、detach も鳴る)。紐の書き戻しで今そのマスが紐かを見ない。読みでは、鋏で切ると取り除いた位置へ控えの紐 (disarmed・powered) が書き戻され、除去の書き込みが失敗扱いになって紐の落とし物も出ない [要実機] | 両方の確認がある (フックを壊しても紐の attached が残る。§4.4.2) | 同じ | 同じ |
| 除去フック (→ 04) | onRemove。書き込みのフラグによらず、別ブロックに替わるとき呼ぶ | affectNeighborsAfterRemoval。フラグ 1 かピストン移動のときだけ | 同じ | 同じ |
| トラップチェストの数 | プレイヤーだけ数える。開くときの +1 は観戦者を除くが、数え直しの探索 (getPlayersWithContainerOpen) は観戦者を除かない | ContainerUser (プレイヤー・銅ゴーレム)、開くときも数え直しも観戦者を除く | 同じ | ジュークボックスの上の (1 マスの) チェストは JukeboxMenu を開く。ChestMenu の派生なので startOpen は同じで、数え方は変わらない |
| 避雷針の onPlace | powered で予約が無ければ**フラグ 18 で黙って消す** | 8 gt の予約を出す | 同じ | 同じ (水浸しは水源のときだけ) |
| 避雷針の種類 | 1 種 | 酸化 4 段 × 蝋引き = 8 種。落雷で銅戻し | 同じ | 同じ |
| 日照センサーの入力 | 太陽角と空の暗さをゲーム時刻の式で計算 | 環境属性 (timeline) から読む | 同じ | 同じ |
| ジ・エンドの空の光 | 無い (日照センサーの ticker が付かない) | ある | ある | ある |
| 書見台の「本の実体」 | アイテムの種類 (本と羽根ペン・記入済みの本) で判定 | 本の中身の部品の有無 | 同じ | 同じ |
| 書見台のページの切り詰め | 0〜(ページ数 − 1)。0 ページで −1 | 同じ | 同じ | **0〜max(ページ数 − 1, 0)** (癖が直る) |
| ジュークボックス | 19 枚 | — | 22 枚 (§3.7) | flurry が増える。**プレイリスト**: playlist_mode プロパティ、neighborChanged と updateShape で上のコンテナを見て書き換え (flag 2)、円盤なしでも ticker |
| BlockSetType | poplar 無し | poplar 無し | poplar あり | 木はまとめて DEFAULT_WOOD (性質は同じ) |
| PushReaction の名前 | DESTROY・BLOCK など | POPPED・IMMOVEABLE など | 同じ | 同じ |

26.2 → 26.3 のそのほかの差 (書き込みを setBlockAndUpdate に、ブロックのコーデック削除、予約の位置の複製削除) は
挙動を変えない。位置の複製は ScheduledTick 側が不変化するので要らない [26.3 読解: ScheduledTick]。
26.3 → 26.4-pre-1 の Mth.clamp → Math.clamp (範囲が正しい限り同じ) と音の指定の書き換えも挙動を変えない。

**既存 fixture の有効性** (どれも 1.21.1 で撮影): lever-nc-before-shape-race・button-nc-before-shape-race・stone-button・
pressure-plate-wood・pressure-plate-stone・target-conduct・lever-wire-lamp は、ブロック側の処理が 26.3 と同じなので
26.3 でも有効と読める。entityInside の呼ばれ方は違うが、fake player を板の中心へ置く入力では結果が変わらない [要実機]。
トリップワイヤー・トラップチェスト・書見台のパルス・避雷針・日照センサー・ジュークボックスの fixture は無い (§8)。
(→ 19_version-diffs.md)

---

## 7. Rust で実装するときの要点

**状態の持ち方**
- blockstate は §3.1 のプロパティをそのまま持つ (オブザーバーと PP の判定に要る)。
- 位置をキーにした BlockEntity の副表を持つ: トラップチェストの半分ごとの開いている数と最大距離、書見台の
  page・pageCount・本の実体の有無 (pageCount = 0 と「本なし」を区別する)、ジュークボックスの円盤 ID・経過・演奏中。
- 円盤の値と長さ (§3.7) は版ごとの表にする (データ由来)。

**更新を出す部品**
- 原始操作を 3 つに分ける: nc6 (位置)、pp6 (位置)、cu (位置)。setBlock の型 A / B を「nc6 → cu? → pp6」「pp6」の
  組で実装し、素子ごとの追加更新を表で持つ (§2.1)。順序を手書きの分岐に埋めない。
- それぞれの操作は 04 の DFS (CollectingNeighborUpdater) に積む。素子のメソッドは「書き込み → その連鎖が全部終わる →
  次の書き込み」の順で進むので、途中でワールドを読み直す所 (フックの手順 6-3 と 9) は**事前計算せず順に実行する**。
- 予約 tick は 02 の重複排除に乗る。has_scheduled_tick を見る分岐 (紐の entityInside・ターゲット・避雷針の onPlace) は、
  実行のために取り出された予約を「無い」と答える意味論に合わせる (→ 02)。

**エンティティに依存する部分の境界** (13 §2 の原則のまま、正確に撮れる形)
- エンジンはエンティティを持たず、「占有のオラクル」を外から受ける: 箱と種類の絞り込み (Entity / LivingEntity / 矢 /
  ContainerUser) を渡すと数を返す。問い合わせの時刻は vanilla と同じにする。
  1. 感圧板・紐・木のボタン: エンティティ相で「未押下なら」entityInside 相当を呼び、予約 tick 相で数え直す。
  2. トラップチェスト: 開閉は入力境界の +1 / −1、数え直しは 5 gt ごとの予約 tick でオラクルに聞く。
  3. ターゲット: 「命中 (位置・面・矢系か)」の事件を受け、強さは f64 で §4.7 の式をそのまま計算する (Java の double と同じ演算順)。
  4. 避雷針: 「落雷 (位置)」の事件をエンティティ相に入れる。
- 手動モデル (今の TS と同じ折衷) は、このオラクルが「押した tick だけ 1、以後 0」を返す特別な場合として表せる。

**数値**
- 重量感圧板と書見台は整数式で書いてよい (§4.3・§4.6 で float32 と全数一致を確かめた)。
- 日照センサーは「空の明るさ」を外から与える入力にし (13 §3 で光量・時刻は非実装)、更新はゲーム時刻 % 20 == 0 の
  BlockEntity 相で ticker の順に行う。round は Java の float の丸め (0.5 は切り上げ) に合わせる (→ 18)。
  cos は f32 の正弦表 (65536 区分) を作って §4.9 の添字で引く。f64 の cos を使うと境界の時刻で 1 ずれうる。
- ジュークボックスの長さは「経過のカウンタを BlockEntity 相で進め、L + 20 に達した次の回で止める」をそのまま持つ (§4.10)。
  ticker の列の順は、円盤を入れるたびに末尾へ付き直す。

**主乱数を使う所** (→ 18。実験的レッドストーンや他の乱数の消費順に効く)

| 場所 | 回数 |
|---|---|
| フックの detach の音 | emitState が detach を出すたびに 1 回 (nextFloat)。両端で外れると 2 回 |
| チェストの開閉の音 (left の半分以外) | 1 回 (nextFloat) |
| ジュークボックスの粒子 | 演奏中 20 段ごとに 1 回 (nextInt) |
| ジュークボックスが円盤を出すとき | 位置のずらしに 2 回 (nextFloat。Vec3#offsetRandomXZ) |
| 落雷の銅戻し | 回数は乱数しだい |
| 実験的レッドストーンの Orientation (有効なときだけ) | Orientation を作るたびに 1 回 (nextInt)。作るのは 1. フラグ 1 の書き込みごとに 1 回、2. レバー・ボタン・フック・トラップチェスト・書見台・避雷針の更新の部品を呼ぶごとに 1 回 (2 か所へ配っても 1 回)、3. 感圧板の updateNeighbours は 2 回、4. ジュークボックスの onSongChanged は 1 回 |

主乱数を使わないもの: 音の seed は別の乱数器 (soundSeedGenerator) から取る [26.3 読解: Level#playSound]。
アイテム実体の初速と向きは、そのエンティティ自身の乱数器から取る (書見台が本を落とすときは主乱数を使わない)
[26.3 読解: ItemEntity の生成 / Entity の random / LecternBlockEntity#preRemoveSideEffects]。CU は Orientation を作らない。

**他のメモとの境界**: 書き込みと更新の部品 = 04、予約 = 02、相の順 = 01、コンパレーターの読み = 07・14、
ピストンの POPPED と BlockEntity 不動 = 13、オラクルの中身 (エンティティの当たり) = 17。

---

## 8. 検証用のプローブ回路案

いずれも実機ハーネス (tools/mc-harness) の fixture にする想定。入力の種類が今のハーネスに無いものは「拡張」と書く。

| 名前 | 目的 | 配置と入力 | 観測と期待 |
|---|---|---|---|
| wood-button-arrow-hold | 矢で押し続け、矢が消えて 30 gt 以内に戻る | 石壁に木のボタン、横にダスト。t2 に矢を召喚して壁へ撃つ (拡張: 矢の召喚に向きと速度)、t50 に矢を kill | 矢が入った tick のエンティティ相で powered。以後 30 gt ごとに状態は変わらない。kill 後、直前の確認から 30 gt で解除 |
| stone-button-arrow-ignored | 石系は矢を見ない | 上と同じで石のボタン | 矢では押されない。風チャージ (拡張) では押される |
| weighted-plate-latch | 押下中は数え直しまで値が据え置き | 重い板の上に t2 で防具立て 12 体 (拡張: 召喚。アイテムは合体して数が減るので使わない)、t5 に 10 体足す | t2 に power 2。t5 は 2 のまま。t12 の確認で 3 (22 体)。軽い板なら 12 → 15 |
| stone-plate-filter | 石の板が数える型 | 石の板 3 枚: アイテム / 防具立て / マーカーの防具立てを召喚 | 防具立てだけ押下 |
| tripwire-hook-order | どちらのフックの下流が先か | 南北の線と東西の線。各フックの支えにコンパレーター → ピストンを付け、lever-nc-before-shape-race と同じ取り合い。fake player を中央の紐へ tp | 南北の線は北端側、東西の線は東端側のピストンが勝つ |
| tripwire-release-cooldown | 解除後 1 gt の不感 | 紐に fake player を乗せ続け、t20 付近で離し、解除の tick に乗せ直す | 26.3: 解除の次の tick に再押下。1.21.1: 解除と同じ tick に再押下 (版差の確認) |
| tripwire-hook-tick-bud | フックの再計算が出す空の更新 | フックの支えの隣に BUD のピストン。紐を踏んで離れる | 紐の変化から 10 gt 後の予約 tick でピストンが動く |
| tripwire-cut-pulse | 紐を壊したときのパルス | 張った線の 1 本を /setblock で空気に (updateNeighboursOnBlockSet から除去フックが走る) | 両フックが powered、10 gt 後に外れて 0。紐は attached = false |
| tripwire-hook-break | フックを壊したときの紐 | 張った線の片方のフックを /setblock で空気に。残る紐の blockstate と、相手フックを見る | 26.3: 相手フックは attached = false、紐は attached = true のまま (detach の音も無い)。1.21.1: 紐も attached = false (版差の確認) [要実機] |
| trapped-chest-count | 開いている数と強充電 | トラップチェストの横にダスト、真下の石の下にランプ、背後にコンパレーター。fake player が use で開き、t30 に遠くへ tp | ダスト 1、ランプ点灯、コンパレーターは充填率。tp 後、GUI が閉じた tick か次の数え直しで 0 |
| lectern-page-pulse | ページ送りのパルス | 書見台の真下の石の横にランプ、書見台の横にダストとコンパレーター。ページ送りは GUI 操作が要る (拡張か手で撮る) | パルス 2 gt (ランプは消灯の 4 gt 遅延が乗る)、コンパレーターはページの値 |
| lectern-zero-page | 0 ページの本の癖 | 空の本と羽根ペンを置き、横にダスト。GUI のボタン 2 を 2 回押す (拡張) | 26.3: 1 回目だけ 2 gt のパルス、2 回目は何も出ない。コンパレーターは 15 のまま。26.4-pre-1: どちらも出ない (版差の確認) |
| lightning-rod-setblock-pulse | 26.3 の onPlace | /setblock lightning_rod[powered=true]。避雷針のすぐ横 (/setblock の NC が届く位置) にランプ。支えの横のランプは置いた時点では NC が届かないので対照にする | 避雷針の状態そのものを見る。26.3: 8 gt powered で、横のランプが点いて消える。1.21.1: 置いた時点で powered = false (版差の確認) |
| target-hit-strength | 命中強度と持続 | ターゲットへ矢と雪玉を中心・縁に撃つ (拡張) | 中心 15・縁 1。矢 20 gt・雪玉 8 gt。持続中の再命中は無視 |
| daylight-period | 更新の周期 | /time set で時刻を変え、t を 20 の倍数の前後で観測 | 値はゲーム時刻 % 20 == 0 の tick でだけ変わる。時刻と値の表は [要実機] |
| jukebox-length | 演奏中の 15 の長さ | 円盤 11 を item 入力 (/item replace で container.0。setTheItem を通る) で入れる。横にダスト、背後にコンパレーター | 読みでは、入れた tick から 1441 gt 目 (L + 21) にダストが 0 になり、コンパレーターは 11 のまま [要実機] |

---

## 9. 既存資料との食い違い

| 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|
| docs/research/02 §6 lever / button | 「矢が刺さっている間は tick 毎に再延長 (木のみ)」 | 30 gt ごとの予約 tick で、押下中の形の箱に矢がいるか確かめ、いれば 30 gt を出し直す。押下中の entityInside は何もしないので、毎 gt の延長は無い | 表現の差では済まない。毎 gt の延長なら「矢が消えてからちょうど 30 gt で戻る」が、26.3 は「矢が消えた後の最初の確認 (消えてから 1〜30 gt 後) で戻る」。02 の記述は誤りで、26.3 の読みが正 [26.3 読解: ButtonBlock#tick / #entityInside / #checkPressed] |
| docs/research/02 §4.2 | 「サーバ側は state 変化のたびに旧 state onRemove / 新 state onPlace が呼ばれる」 | 26.3 の除去フック (affectNeighborsAfterRemoval) は、別のブロックに替わり、かつフラグ 1 かピストン移動のときだけ呼ぶ。呼ぶ場所は LevelChunk#setBlockState の中で、onPlace と書き込み自体の NC・PP より前 | 1.21.1 の模型のまま。26.3 では、壊したレバー・ボタン・感圧板・フックの除去フックの NC が書き込みの NC より先に出る (§4.1)。プロパティだけの変化 (レバーの切り替えなど) では呼ばれない。26.3 が正 [26.3 読解: LevelChunk#setBlockState] (→ 04 §4.2) |
| docs/research/02 §6 lever / button | 「ON 中は全 query 方向に弱 15 (getSignal)」 | 26.x は向きを持たない ownSignal を、getSignal の既定が返す形 | 挙動は同じ。名前だけ古い |
| docs/research/10 C3 | 「木 = アイテム含む全エンティティ / 石 = Mob・プレイヤーのみ [要検証]」 | 石 = LivingEntity (防具立てを含む)。どちらも観戦者と isIgnoringBlockTriggers のものを除く | 26.3 が正 [26.3 読解: PressurePlateBlock#getSignalStrength / BasePressurePlateBlock#getEntityCount] |
| docs/research/10 C3 | 「エンティティ退去後の消灯遅延は 20gt [要検証]」 | 押下中は 20 gt ごとの予約 tick でだけ数え直す。消灯は退去の後の最初の確認 (退去から 1〜20 gt 後) で起きる | 「退去から 20 gt」ではない。乗った tick から 20 gt で消えるのは、最初の確認 (20 gt 後) までに降りたときである (fixture pressure-plate-wood はこの形)。26.3 が正 [26.3 読解: BasePressurePlateBlock#tick / #checkPressed] |
| docs/research/10 C4 | 「アナログ式 [要検証: 版により定数が変動]」 | 1.21.1・26.2・26.3 で同じ式と定数。float の丸め誤差なし | 確定に上げてよい。押下中は 10 gt ごとにしか数え直さない点が未記載 |
| docs/research/11 §1、16 §2 (R-8) | 「trapped_chest と lightning_rod も vanilla では信号源」 | ほかに tripwire_hook・daylight_detector・jukebox も常に信号源で、ダストが 4 面で接続する | 列挙が足りない。26.3 が正 [26.3 読解: 各 #isSignalSource] |
| docs/research/10 C2 / 02 §6 target | 「発火の実機 fixture は不可」 | onPlace が予約の無い power > 0 を黙って 0 にするのは 26.3 も同じ。ただし矢の召喚なら撮れる | ハーネスの拡張で可能 (§8 target-hit-strength) |
| docs/research/13 §3 | 「光量・時刻は非実装」 | 日照センサーは光量と時刻がそのまま入力 | 矛盾ではない。入れるなら「空の明るさを外から与える」形 (§7) |
| packages/sim/src/world.ts の activateBlock (target) と予約 tick の消灯 | 形状更新 → NC の順 | TargetBlock#setOutputPower / #tick は flag 3 なので NC → 形状更新 (R-15 の一例) | 26.3 が正。同じ gt・同じ優先度のコンパレーター対オブザーバーで勝者が逆になりうる。矢の召喚で fixture を撮ってから直す |
| packages/sim/src/world.ts の activateBlock (lectern) | ページを進め CU だけを出す。最終ページの次は 0 に戻す | CU → powered = true の flag 3 → 真下 6 → 2 gt 後に戻す。最終ページで止まる | パルス (全方向弱 15・真下強 15) が丸ごと無い (16 §2.6 にもある)。0 に戻すのは UI の折衷 |
| packages/sim/src/world.ts の lecternSignal | pages = 0 を「本の実体なし」として +1 しない | 空の本と羽根ペンは 0 ページでも本の実体があり 15 | pages = 0 が「本なし」と「空の本」を区別できない。取り込み側に区別が要る |
| packages/sim/src/world.ts の initialize (感圧板) | powered の板を OFF から始める | 予約の無い powered の板は押されたまま残る (onPlace が無い) | 決定論のための意図的な差。vanilla 忠実を謳う所では注記が要る |
| packages/sim/src (trapped_chest・lightning_rod・tripwire・daylight_detector・jukebox) | trapped_chest は container に潰す、lightning_rod は装飾、残りは型が無い | どれも信号源 (§2.1) | 未実装。Rust 版で入れるなら §7 のオラクル境界で扱う |

---

## 10. 典拠一覧

- 26.3 LeverBlock#useWithoutItem / #pull / #onExplosionHit / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal / #isSignalSource / #updateNeighbours
- 26.3 ButtonBlock#useWithoutItem / #press / #tick / #entityInside / #checkPressed / #onExplosionHit / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal / #updateNeighbours / #makeShapes
- 26.3 FaceAttachedHorizontalDirectionalBlock#canSurvive / #canAttach / #getStateForPlacement / #updateShape / #getConnectedDirection
- 26.3 BasePressurePlateBlock#entityInside / #tick / #checkPressed / #updateNeighbours / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal / #getEntityCount / #canSurvive / #getPressedTime
- 26.3 PressurePlateBlock#getSignalStrength / #getSignalForState / #setSignalForState
- 26.3 WeightedPressurePlateBlock#getSignalStrength / #getPressedTime
- 26.3 BlockSetType (各定数) / Blocks (ボタン・感圧板・紐・フック・避雷針などの登録)
- 26.3 TripWireBlock#entityInside / #tick / #checkPressed / #updateSource / #onPlace / #affectNeighborsAfterRemoval / #playerWillDestroy / #updateShape / #getShape / #getEntityInsideCollisionShape / #shouldConnectTo
- 26.3 TripWireHookBlock#calculateState / #tick / #setPlacedBy / #emitState / #notifyNeighbors / #onRemoved / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal / #canSurvive / #updateShape
- 26.3 TrappedChestBlock#ownSignal / #getDirectSignal / #isSignalSource、TrappedChestBlockEntity#signalOpenCount
- 26.3 ChestBlock#useWithoutItem / #tick / #affectNeighborsAfterRemoval / #isChestBlockedAt / #getBlockType / #getConnectedDirection / #getAnalogOutputSignal
- 26.3 ChestBlockEntity#startOpen / #stopOpen / #recheckOpen / #getOpenCount / #signalOpenCount / #playSound
- 26.3 ContainerOpenersCounter#incrementOpeners / #decrementOpeners / #recheckOpeners / #getEntitiesWithContainerOpen
- 26.3 DoubleBlockCombiner#combineWithNeigbour、CompoundContainer#startOpen
- 26.3 CopperGolemAi#onReachedTargetInteraction、CopperGolem#hasContainerOpen、Player#hasContainerOpen / #getContainerInteractionRange
- 26.3 LecternBlock#signalPageChange / #changePowered / #updateBelow / #tick / #resetBookState / #tryPlaceBook / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal / #getAnalogOutputSignal / #useItemOn / #useWithoutItem
- 26.3 LecternBlockEntity#setPage / #getRedstoneSignal / #hasBook / #onBookItemRemove / #preRemoveSideEffects、LecternMenu#clickMenuButton
- 26.3 TargetBlock#onProjectileHit / #updateRedstoneOutput / #getRedstoneStrength / #setOutputPower / #tick / #onPlace / #ownSignal
- 26.3 LightningRodBlock#onLightningStrike / #updateNeighbours / #tick / #onPlace / #affectNeighborsAfterRemoval / #ownSignal / #getDirectSignal、WeatheringLightningRodBlock#randomTick
- 26.3 LightningBolt#tick / #powerLightningRod / #getStrikePosition / #clearCopperOnLightningStrike、ServerLevel#findLightningRod
- 26.3 DaylightDetectorBlock#updateSignalStrength / #useWithoutItem / #getTicker / #tickEntity / #ownSignal、LevelReader#getEffectiveSkyBrightness、Level#updateSkyBrightness、EnvironmentAttributes (SUN_ANGLE・SKY_LIGHT_LEVEL)、WeatherAttributes
- 26.3 JukeboxBlock#ownSignal / #getAnalogOutputSignal / #useWithoutItem / #useItemOn / #affectNeighborsAfterRemoval / #getTicker
- 26.3 JukeboxBlockEntity#setTheItem / #popOutTheItem / #onSongChanged / #notifyItemChangedInJukebox / #getComparatorOutput / #canPlaceItem / #canTakeItem / #preRemoveSideEffects
- 26.3 JukeboxSongPlayer#play / #stop / #tick、JukeboxSong#lengthInTicks / #hasFinished、JukeboxPlayable#tryInsertIntoJukebox
- 26.3 ExperimentalRedstoneUtils#initialOrientation、Orientation#random
- 26.3 Level#setBlock / #updateNeighbourForOutputSignal / #playSound、LevelWriter#setBlockAndUpdate、LevelChunk#setBlockState、ServerLevel#updateNeighborsAt / #updateNeighboursOnBlockSet / #tickBlock / #tick、SetBlockCommand#setBlock
- 26.3 Entity#checkInsideBlocks / #applyEffectsFromBlocks / #isIgnoringBlockTriggers / #isAffectedByBlocks、EntitySelector.NO_SPECTATORS、AbstractArrow#tick、ServerExplosion#canTriggerBlocks、BlockBehaviour#onExplosionHit
- 26.3 ScheduledTick、LevelAccessor#createTick、LevelTicks#hasScheduledTick
- 26.3 PistonBaseBlock#isPushable / #moveBlocks (POPPED の除去フック)
- 26.3 ComparatorBlock#getInputSignal (アナログ優先の確認)
- 26.3 AbstractArrow#tick / #tickDespawn / #shouldFall (刺さった矢の効果と消える時刻)
- 26.3 Mth#cos / Mth#sin (正弦表)、Level#updateSkyBrightness、ServerLevel#tickThunder / #findLightningTargetAround
- 26.3 LevelChunk#updateBlockEntityTicker / #removeBlockEntityTicker、Level#addBlockEntityTicker / #tickBlockEntities、JukeboxBlockEntity#setRemoved
- 26.3 TransportItemsBetweenContainers#onReachedTarget、CopperGolem#hasContainerOpen / #getContainerInteractionRange、CopperGolemAi (運び元・運び先の判定)
- 26.3 ServerGamePacketListenerImpl#handleContainerButtonClick、LecternMenu#stillValid、Container#stillValidBlockEntity、LecternBlockEntity#loadAdditional
- 26.3 PistonMovingBlockEntity#tick / #finalTick (着地の書き込み)、ItemEntity の生成、Vec3#offsetRandomXZ、Entity の random
- 26.3 ServerPlayerGameMode#useItemOn、Container#getSlot、ContainerSingleItem#setItem (/item replace の経路)
- 1.21.1 / 26.2 / 26.4-pre-1 の同名クラス (版差の diff: TripWireBlock・TripWireHookBlock・LightningRodBlock・LecternBlockEntity・ContainerOpenersCounter・DaylightDetectorBlock・JukeboxBlock・BlockSetType)
- 26.3 data: jukebox_song、timeline の day、dimension_type

---

## 付録: 網羅チェックで足したもの

網羅表 (00_coverage.md の G-1) で、本書に入るべきなのに抜けていたクラスを足す。表記は本文と同じである
(NC・PP・CU・「自分 6」は冒頭の約束、相の名前 区間 A・L9・L12・B5 は → 01・17 §2.3)。
01 §1.2・§4.5 の表 (redstone_ore → 11) と 11 §1.2 (→ 09 / 17) が指す本文は、この付録 A である。

### A. レッドストーン鉱石 (RedStoneOreBlock)

#### A.1 対象と範囲

読んだのは 26.3 の RedStoneOreBlock (全メソッド)、登録 (Blocks・BlockBehaviour.Properties)、点灯の呼び出し元
(ServerPlayerGameMode・Player・BlockPlaceContext・Entity・Cat・Ocelot・ServerGamePacketListenerImpl と各エンティティの tick)、
消灯の呼び出し元 (ServerLevel#tickChunk・LevelChunkSection)、書き込みと乱数 (Level・LevelWriter)、受け手のオブザーバー (ObserverBlock) である。
扱わない: エンティティの移動と足元の決め方 (→ 17 §4.2・§4.3)、ランダム tick の位置の選び方 (→ 01 §4.5)、
オブザーバーの予約とパルス (→ 08 §4.2)、NC・PP の配り方と順 (→ 04)、主乱数の列の全体 (→ 18 §4.6)。

#### A.2 状態とデータ

| 項目 | 26.3 | 典拠 (26.3) |
|---|---|---|
| ブロック | redstone_ore・deepslate_redstone_ore。同じクラスで、違うのは硬さ (3.0 / 4.5)・音・地図の色だけ | Blocks |
| blockstate | lit (真偽)。RedstoneTorchBlock の LIT と同じプロパティ。既定は偽 | RedStoneOreBlock の構築 |
| 光 | lit なら 9、そうでなければ 0。回路には効かない | Blocks の litBlockEmission |
| ランダム tick | lit の状態だけが受ける。登録の randomTicks はクラスの上書きで状態ごとに決め直され、状態に覚えられる | RedStoneOreBlock#isRandomlyTicking、BlockStateBase の初期化 |
| 信号 | 出さない (isSignalSource は既定の偽)。アナログ出力も無い | BlockBehaviour の既定 |
| 導体 | する (当たりがフルブロック)。lit は効かない | Properties の既定 |
| ピストン | 押せて引ける (既定の PUSH_PULL)。lit のまま運ばれる (onPlace を上書きしない) | Properties の既定 |
| 上の音符ブロックの音色 | basedrum。deepslate も ofLegacyCopy で引き継ぐ | Blocks、BlockBehaviour.Properties#ofLegacyCopy |
| BlockEntity・予約 tick・ブロックイベント | どれも無い | — |
| 壊したときの経験値 | 1〜5 (UniformInt。主乱数で抽選する。回路の外) | RedStoneOreBlock#spawnAfterBreak、Block#tryDropExperience |

#### A.3 点灯の契機

3 つとも RedStoneOreBlock#interact (§A.4) に入る。

| 契機 | 入口 | 相 | 呼ばれる条件 | その後 |
|---|---|---|---|---|
| 叩く | ServerPlayerGameMode#handleBlockBreakAction の掘り始め (START_DESTROY_BLOCK) → RedStoneOreBlock#attack | 区間 A (入力境界) | 操作距離 + 1.0 以内、高さの上限以下、スポーン保護と mayInteract を通る。**クリエイティブ (instabuild) は attack を呼ばずに壊す**。blockActionRestricted が真 (観戦者、壊せる道具を持たないアドベンチャー) でも呼ばない | 掘る進みが 1.0 以上なら、点灯の書き込みの直後にその場で壊れる |
| 踏む | Entity#applyEffectsFromBlocks の先頭 → RedStoneOreBlock#stepOn | 生き物・アイテム・TNT・落下ブロック・経験値オーブは L12、プレイヤーは B5 (→ 17 §4.3) | isAffectedByBlocks (除去済みでなく noPhysics でない。観戦者は Player#tick で noPhysics)、接地 (onGround)、足元 (getOnPosLegacy) がこの鉱石、isSteppingCarefully が偽 | 条件を満たす間は、呼ばれるたびに interact (§A.7) |
| 右クリック | ServerPlayerGameMode#useItemOn → RedStoneOreBlock#useItemOn | 区間 A | 観戦者は呼ばない (観戦者の分岐は鉱石を素通りする)。しゃがみ (isSecondaryUseActive) で、どちらかの手に何か持っていれば呼ばない (§2.2 の 2) | 持ち物が BlockItem で BlockPlaceContext#canPlace (面の先のマスが置き換え可能) が真なら PASS: 続けて持ち物の useOn が走り、ブロックが置かれる。それ以外 (素手・道具・置けないブロック) は SUCCESS で終わり、持ち物は使われない |

isSteppingCarefully [26.3 読解: Entity#isSteppingCarefully / Cat#isSteppingCarefully / Ocelot#isSteppingCarefully]

| エンティティ | 真になるとき |
|---|---|
| 既定 | isShiftKeyDown (共有フラグ 1) が真 |
| プレイヤー | しゃがみ入力 (ServerGamePacketListenerImpl#handlePlayerInput の shift。エンティティを使う操作のパケット #handleInteract でも書き換わる) |
| ネコ・ヤマネコ | 上に加え、姿勢が CROUCHING の間 (移動の速さの係数が 0.6 のとき。#customServerAiStep) |
| ほかのモブ・アイテム・TNT など | 常に偽。必ず光らせる |

アドベンチャーでも、右クリックと踏むのは効く。叩くのだけが道具の can_break に縛られる [26.3 読解: Player#blockActionRestricted]。

#### A.4 処理と更新

**RedStoneOreBlock#interact** (サーバー側)
1. spawnParticles: Direction.values() の順 (下・上・北・南・西・東) に隣を読む。isSolidRender が偽の隣
   (不透明なフルブロックでないもの。空気・ガラス・ダスト・ハーフブロックなど) ごとに、主乱数 (Level#getRandom) の
   nextFloat を 2 回引く (その面の軸でない 2 成分)。サーバーの Level#addParticle は空なので、残る効果は乱数の消費だけである。
   **光っていても毎回引く**。
2. 渡された状態の lit が偽なら、lit = 真を flag 3 で書く (LevelWriter#setBlockAndUpdate)。真なら書かない。

側で分かれるのは useItemOn だけで、クライアント側では粒子を出すだけで interact を呼ばない。attack と stepOn は側を見ずに
interact を呼ぶ (クライアントで呼ばれれば lit を先に書いて見せる。手元のデコンパイルはサーバーだけなので、クライアントの呼び出し元は読んでいない)。
エンジンはサーバー側だけを持てばよい。

**点灯・消灯の書き込みが出す更新** (型 A の書き込みの部分だけ。自前の NC は無い) [26.3 読解: Level#setBlock]
1. 自分 6 の NC (西・東・下・上・北・南)。実験的レッドストーンが有効なら、Orientation を作るのに主乱数を 1 回引く
   (interact では粒子の分の後。→ 04 §4.9・18 §4.6.4)。
2. アナログ出力が無いので CU は出ない。
3. 自分 6 の PP (順は → 04 §2.3)。オブザーバーはこれを見る (§A.6)。
4. 同じブロックの中のプロパティ替えなので、除去フックは走らない。onPlace も上書きしていない。
5. GameEvent は出さない。スカルクセンサーが聞くのは、踏んだエンティティの STEP などである (→ 10・17 §4.20)。
6. 予約 tick もブロックイベントも出さない。光の変化は回路に効かない (日照センサーが読むのは空の光だけ。§4.9)。

**RedStoneOreBlock#randomTick** (L9)
1. lit なら lit = 偽を flag 3 で書く。更新は上と同じ (自分 6 の NC → 自分 6 の PP)。
2. 渡された乱数は使わない。消えた鉱石はランダム tick を受けない。

#### A.5 消えるまでの時間

消灯は予約 tick ではなく、ランダム tick だけで起きる (02 の予約表に載らないのが正しい)。
[26.3 読解: ServerLevel#tickChunk / LevelChunkSection#setBlockState] (→ 01 §4.5)
1. 光るとセクションの「ランダム tick を受けるブロック」の数に入る。そのセクションは毎 tick の L9 で S 回
   (S = random_tick_speed) 位置を引く。
2. 1 回の L9 で選ばれて消える確率は p = 1 − (4095/4096)^S である。点灯の後 k 回目の L9 で消える確率は p(1 − p)^(k−1) (幾何分布)。
3. 叩く・右クリック (区間 A) で光らせたときは、同じ tick の L9 が 1 回目になる。L12・B5 で光らせたときは、次の tick の L9 が 1 回目である。

| S | p | 平均 (L9 の回数) | 中央値 | 99% 点 |
|---|---|---|---|---|
| 0 | 0 | 消えない | — | — |
| 1 | 2.44e−4 | 4096 | 2839 | 18861 |
| 3 (既定) | 7.32e−4 | 1365.7 (約 68.3 秒) | 947 | 6287 |
| 100 | 0.0241 | 41.5 | 29 | 189 |
| 40960 | 1 − 4.5e−5 | 1.00 | 1 | 1 |

4. 位置を引く線形合同法 (randValue) は起動ごとの乱数で始まり、Level に 1 本しかない。消える tick は再現できない。
   光った鉱石のセクションは毎 tick S 回ずつ randValue を進めるので、ほかのセクションのランダム tick の位置もずれる (→ 01・18)。
5. ランダム tick はエンティティ tick の範囲のチャンクでしか起きない。26.3 はプレイヤーとの距離を見ない (→ 01 §4.5・§6.2)。

#### A.6 オブザーバーで検知する回路

1. 顔を鉱石へ向けたオブザーバーは、点灯と消灯のどちらの PP でも 2 gt の予約を入れ、2 gt のパルスを出す (→ 08 §4.2)。
2. NC は 6 方向へ届くので、鉱石の隣の BUD 状態のピストンなども動く。
3. **エンティティが乗り続けている間**は interact が毎 tick 来る。L9 で消えても、同じ tick の L12 (プレイヤーは B5) で光り直す。
   オブザーバーは同じ tick に PP を 2 回受けるが、2 回目は予約が入っているので捨てられる (ObserverBlock#startSignal)。
   乗っている間は、鉱石が消えるたび (S = 3 で平均 1366 tick に 1 回) に 2 gt のパルスが 1 回出る [26.3 読解] [要実機]。
4. 降りても何も起きない。消えるのはランダム tick だけなので、「乗った」は拾えるが「降りた」は拾えない。
   消えるまでに次のエンティティが来ても、もう光っているのでパルスは出ない。

#### A.7 端の場合と落とし穴

- しゃがんだプレイヤーは、踏んでも光らせない。叩けば光る。右クリックは「しゃがみ + 何か持っている」ときだけ光らない (しゃがみ + 素手は光る)。
- 右クリックでブロックを置くと (面の先に置けるとき)、まず鉱石が光り (NC・PP)、その後でブロックが置かれる。
  鉱石の面にブロックを足していく操作そのものが、隣のオブザーバーを動かす。
- ブロックでない物 (道具など) を持って右クリックすると SUCCESS で止まり、持ち物の useOn は呼ばれない。
- 足元は getOnPosLegacy (足の位置から 0.2 下。→ 17 §4.2) で決まる。鉱石の上に、当たりの上面が 0.2 未満のもの (カーペットは 1/16)
  や当たりの無いもの (レール・ダスト・感圧板) を置いても、その上に立てば鉱石の stepOn が来る [26.3 読解: Entity#getOnPos] [要実機]。
- 光っている鉱石を踏み続けても書き込みは起きない。毎回の interact は主乱数を進めるだけである (隣が全部空いていれば 1 回に 12 歩)。
- アイテム・TNT・落下ブロック・経験値オーブも光らせる。止まったアイテムは 26.3 では毎 tick applyEffectsFromBlocks を呼ぶ (→ 17 §4.12) ので、
  消えても同じ tick に光り直す。アイテムが消える 6000 gt まで、実質光り続ける。
- 落下ブロックは着地の tick に、move の後の applyEffectsFromBlocks で鉱石を光らせ、その後で自分を置く [26.3 読解: FallingBlockEntity#tick]。
- 矢は Entity#move を通らずに位置を進め、接地を立てない (AbstractArrow#tick) ので、刺さっても光らせないと読める [要実機]。
- レールの上のトロッコは、レールに沿う move の縦が 0 で、普通は接地にならない (OldMinecartBehavior#moveAlongTrack)。
  鉱石の上のレールを走っても光らないと読める [要実機]。
- 投射物の命中・爆発・ピストンでは光らない (onProjectileHit などを上書きしていない)。ピストンで運んでも lit はそのまま。
- /setblock の redstone_ore[lit=true] はそのまま光る。ハーネスは random_tick_speed 0 なので、置いた鉱石は消えない
  (tools/mc-harness/runner/world-setup.ts)。

#### A.8 版差

担当クラスを 1.21.1・26.2・26.4-pre-1 と diff -u した。挙動に効くものだけ挙げる。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| RedStoneOreBlock の本体 | 同じ。useItemOn は ItemInteractionResult を返す (置けるときは SKIP_DEFAULT_BLOCK_INTERACTION で持ち物の処理へ、それ以外は SUCCESS) が、意味は同じ。書き込みは setBlock のフラグ 3 | 同じ (コーデックがあるだけ) | 基準 | DropExperienceBlock の派生になり、経験値 1〜5 を登録で渡す。挙動は同じ |
| stepOn を呼ぶ所 (→ 17 §6.1) | Entity#move の中 (衝突の後、接地していれば) | applyEffectsFromBlocks の先頭 | 同じ | 同じ (足元を読む所が接地の判定の前へ移っただけ) |
| 止まったアイテム | move を「tickCount と id の和が 4 の倍数」の tick にしか呼ばない。光り直すのは 4 tick に 1 回で、消えてから最大 3 tick 暗い [版差 1.21.1: ItemEntity#tick] | 毎 tick 光り直す | 同じ | 同じ |
| プレイヤーの踏み | 移動パケットの処理の move の中 (1.21.1 のパケットは区間 C。→ 01 §6.2)。パケットが来ない tick は踏み直さない [要実機] | B5 の doTick → aiStep で毎 tick | 同じ | 同じ |
| ランダム tick の対象チャンク (→ 01 §6.2) | プレイヤーから 128 ブロック以内に限る | 距離を見ない | 同じ | 同じ |
| しゃがみ・ネコの CROUCHING・叩く/右クリックの条件 | 同じ | 同じ | 基準 | 同じ (掘る進みの数え方の書き換えは attack に効かない) |

実機の fixture は無い。右クリックの経路と書き込みは 1.21.1 と 26.3 で同じなので、1.21.1 で撮った §A.10 の 1 本目と 2 本目は、
そのまま 26.3 の正解に使えると読める。踏む経路は位相が違うので、撮り直しが要る。

#### A.9 Rust で実装するときの要点

- 型は lit の 1 ビットを持つ「導体・非信号源・押せる」フルブロックにする。deepslate は名前だけ違う同じ型。
  状態表 (→ 05) に「ランダム tick を受けるのは lit のときだけ」を持たせる。
- 入口は interact(位置) の 1 本にし、呼ぶ相を 3 つ用意する。
  1. 入力境界: 叩く・右クリック。持ち物としゃがみの条件は入力側で解き、「点けるか」と「続けてブロックを置くか」を渡す。
  2. L12: 本文 §7 の占有のオラクルに「接地していて静かに歩いていないエンティティで、足元がこのマスのもの」を問い、1 体ごとに interact。
  3. B5: プレイヤーの分を同じ形で。
- interact は「主乱数を 2 × (固体描画でない隣の数) 歩進める → 消えていれば flag 3 で書く」。主乱数を持たない構成なら書き込みだけでよい。
  書き込みは 04 の flag 3 そのもので、追加の部品は無い。
- 消灯は L9 の相に置く。vanilla の randValue は再現できないので、方式を 3 つ持つ。
  1. 既定は「消えない」(ハーネスの random_tick_speed 0 と同じ)。
  2. 外から「この tick の L9 で消す」事件を入れる (fixture の比較用。S を大きくした実機と対応する)。
  3. 統計を見るときだけ、種つきの乱数で p = 1 − (4095/4096)^S を模す。セクションごとの「ランダム tick を受けるブロック」の数は、この方式でだけ要る。
- オブザーバー・BUD との境界は 08・04 のまま。鉱石は予約 tick を持たないので、02 の重複排除には関わらない。

#### A.10 検証用のプローブ回路案

| 名前 | 目的 | 配置と入力 | 観測と期待 |
|---|---|---|---|
| redstone-ore-use-bud | 右クリックの点灯が NC と PP の両方を出す | qc-bud と同じ BUD を作り、t8 に使うレバー (3,1,1) を redstone_ore に替える。鉱石を見る facing = west のオブザーバー (4,1,1) と、その出力先のランプ (5,1,1) を足す (床も広げる)。fake player は素手で t8 に鉱石を use し、t14 にもう一度 use | ピストンは qc-bud と同じ tick に伸びる (NC)。オブザーバーは t10 に ON・t12 に OFF の見込み (PP)。random_tick_speed 0 なので鉱石は光ったまま。t14 の use は何も書かない |
| redstone-ore-hold-block | PASS の経路 (拡張: 持ち物) | 上の配置で fake player に石を持たせ、鉱石の上面を use | 鉱石が光り (オブザーバーは 1 回)、その後で上に石が置かれる。持ち物が道具なら光るだけ |
| redstone-ore-sneak-step | 静かに歩くと光らない (拡張: sneak) | 鉱石の上へ fake player を sneak のまま tp し、t10 に sneak を解く | sneak の間は lit = 偽のまま。解いた後に光る。光る相は fake player の動かし方しだい [要実機] |
| redstone-ore-random-off | ランダム tick で消える (拡張: gamerule の入力) | redstone-ore-use-bud の続きで、t20 の境界で random_tick_speed を 40960 にし、t21 の境界で 0 に戻す | t21 の L9 で lit = 偽 (外れる確率 4.5e−5)。オブザーバーがもう 1 回パルスを出す (t23 ON・t25 OFF の見込み)。ランダム tick を受けるブロックがほかに無い世界で撮る |
| redstone-ore-item-relight | 止まったアイテムが光り直す間隔 (版差の確認) | 鉱石の上にアイテムを 1 個 summon (拡張)。fake player は拾わない距離に置き、random_tick_speed 40960 のまま 16 tick 進める | 26.3: 毎 tick L9 で消えて L12 で光り直すので、境界の dump は毎回 lit = 真。1.21.1: 光り直すのは 4 tick に 1 回なので、lit = 真の境界は 4 回に 1 回。オブザーバーはどちらの版も 2 gt ON・2 gt OFF の 4 gt 周期と読める [要実機] |

#### A.11 既存資料・TS 実装との食い違い

| 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|
| 01 §1.2・§4.5 の表、11 §1.2 | redstone_ore を「→ 11」「→ 09 / 17」へ回し、本文が無い (00_coverage.md の O-2) | 本文はこの付録 A | 参照の行き止まりだった。各メモの参照は「→ 09 付録 A」が正しい (01・11・17 の参照は仕上げで直した) |
| 17 §4.20 | 「静かに歩いていなければ点灯」の 1 行 | 合っている。接地・isAffectedByBlocks・足元の決め方・ネコの CROUCHING の条件と、毎 tick 呼ばれる点を §A.3・§A.7 に足した | 補足だけ |
| 18 §4.6.4 | 回路が主乱数を引く箇所の表に鉱石が無い | interact のたびに nextFloat を「2 × 固体描画でない隣の数」回 (0〜12 回)。踏まれている間は毎 tick | 表の抜け。26.3 の読みが正 [26.3 読解: RedStoneOreBlock#spawnParticles / Level#addParticle] |
| 17 §6.1 の「プレイヤーのブロック作用」の行 | 1.21.1 を「区間 A のパケット処理の move の中」とする | 01 §6.2 では、1.21.1 のパケットは区間 C (tick の後の待ち) で実行される | 位相の呼び名の食い違い。どちらも tick の境界の中で、鉱石の結果は変わらない。区分は 01 に合わせるのが正 |
| packages/sim/src/blocks/blockNames.ts の SOLID_SUFFIXES ('_ore') | 両方の鉱石を導体フルブロック (solid) に潰す。見た目に残すプロパティ (APPEARANCE_PROPS の solid) は axis・facing・snowy だけで、lit を捨てる | lit を持ち、3 つの契機で光り、ランダム tick で消える | 導体と押せる点は正しい。点灯が無いので、鉱石を見るオブザーバーは sim では動かない。比較用の正規形 (packages/sim/src/mcstate.ts の canonicalize) も stone に寄せるので、実機の lit の変化は fixture の比較に出ない。Rust 版では lit を持つ型にし、比較でも lit を残す |
| packages/sim/src/blocks/noteInstrument.generated.ts | redstone_ore は basedrum。deepslate_redstone_ore は表に無く harp になる | deepslate_redstone_ore も ofLegacyCopy で basedrum | 11 §9 の「性質のコピーを拾わない」抜けの一例。26.3 の読みが正 |
| docs/research | 鉱石の記述は無い | — | 食い違いは無い |

#### A.12 典拠

- 26.3 RedStoneOreBlock#attack / #stepOn / #useItemOn / #interact / #isRandomlyTicking / #randomTick / #spawnParticles / #spawnAfterBreak / #animateTick / #createBlockStateDefinition
- 26.3 Blocks (REDSTONE_ORE・DEEPSLATE_REDSTONE_ORE の登録)、BlockBehaviour.Properties#ofLegacyCopy と既定値 (PUSH_PULL・isRedstoneConductor)、Block#tryDropExperience
- 26.3 ServerPlayerGameMode#handleBlockBreakAction / #useItemOn、Player#isSecondaryUseActive / #blockActionRestricted / #tick、BlockPlaceContext#canPlace
- 26.3 Entity#applyEffectsFromBlocks / #isAffectedByBlocks / #getOnPos / #getOnPosLegacy / #isSteppingCarefully / #isShiftKeyDown / #move、Cat#isSteppingCarefully / #customServerAiStep、Ocelot#isSteppingCarefully / #customServerAiStep、ServerGamePacketListenerImpl#handlePlayerInput / #handleInteract
- 26.3 LivingEntity#aiStep、ItemEntity#tick、FallingBlockEntity#tick、PrimedTnt#tick、ExperienceOrb#tick、AbstractArrow#tick、OldMinecartBehavior#moveAlongTrack
- 26.3 ServerLevel#tickChunk / #updateNeighborsAt、Level#getBlockRandomPos、LevelChunkSection#setBlockState / #isRandomlyTicking、BlockBehaviour.BlockStateBase#isRandomlyTicking / #isSolidRender
- 26.3 Level#setBlock / #addParticle / #getRandom、LevelWriter#setBlockAndUpdate、ObserverBlock#updateShape / #startSignal
- 1.21.1 / 26.2 / 26.4-pre-1 の RedStoneOreBlock・Entity#move と #applyEffectsFromBlocks・ItemEntity#tick・ServerPlayerGameMode・Cat・Ocelot・Blocks (版差の diff)
