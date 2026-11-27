# 11. 出力素子 — ランプ・音符ブロック・ドア類・ベル・TNT・銅の電球・大きなドリップリーフ・硫黄ほか

基準は Java 版 26.3。デコンパイルしたコードを読み、挙動を自分の言葉で書いた。コードの写しは無い (docs/ip-policy.md)。

確かさの表記:

| 表記 | 意味 |
|---|---|
| [26.3 読解] | 26.3 のコードを読んで確かめた (典拠のクラス#メソッドを添える) |
| [実機 1.21.1: 名前] | tools/mc-harness/fixtures/ の実機 fixture が裏づける |
| [要実機] | 読むだけでは結果が決まらない、または解釈が割れる。§8 で測る |
| [版差 1.21.1] [版差 26.4-pre-1] | 版で違う点 |

用語: NC = 近隣更新 (neighborChanged)、PP = 形状更新 (updateShape)、CU = コンパレーター更新 (updateNeighbourForOutputSignal)、BE = ブロックイベント (blockEvent)、ST = 予約 tick。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3、net/minecraft/ からの相対)

| クラス | このメモでの扱い |
|---|---|
| world/level/block/RedstoneLampBlock | §4.1 |
| world/level/block/NoteBlock、state/properties/NoteBlockInstrument | §4.2 |
| world/level/block/DoorBlock、WeatheringCopperDoorBlock、world/item/DoubleHighBlockItem | §4.3 |
| world/level/block/TrapDoorBlock、WeatheringCopperTrapDoorBlock | §4.4 |
| world/level/block/FenceGateBlock | §4.5 |
| world/level/block/state/properties/BlockSetType | §3.3 (ドア類の種別表) |
| world/level/block/BellBlock、block/entity/BellBlockEntity | §4.6 |
| world/level/block/TntBlock (+ world/entity/item/PrimedTnt の生成部分だけ) | §4.7 |
| world/level/block/CopperBulbBlock、WeatheringCopperBulbBlock、ChangeOverTimeBlock#changeOverTime | §4.8 |
| world/level/block/BigDripleafBlock、state/properties/Tilt (BigDripleafStemBlock は信号を読まない) | §4.9 |
| world/level/block/PotentSulfurBlock、block/entity/PotentSulfurBlockEntity、state/properties/PotentSulfurState | §4.10 |
| world/level/block/AbstractSkullBlock | §4.11 |
| world/level/block/ShelfBlock、SideChainPartBlock、state/properties/SideChainPart | §4.12 (信号に反応する部分だけ) |
| world/level/block/CommandBlock、StructureBlock、TestBlock | §4.13 (範囲の注記だけ) |
| world/entity/monster/cubemob/SulfurCube | §4.13 (注記だけ) |

呼び出し先として読んだ所 (詳細は各メモ): Level#setBlock、LevelChunk#setBlockState、Block#updateOrDestroy、Level#updateNeighbourForOutputSignal、ServerLevel#updateNeighboursOnBlockSet、SetBlockCommand#setBlock、BlockInput#place、BlockItem#place、SignalGetter#hasNeighborSignal、LevelChunkTicks#schedule、ServerLevel#blockEvent と #runBlockEvents と #doBlockEvent、Level#playSound、VibrationSystem の周波数表、PistonMovingBlockEntity#tick と #finalTick、PistonBaseBlock#isPushable、DoublePlantBlock#preventDropFromBottomPart、データのタグ (causes_continuous_geyser_eruptions ほか)。

### 1.2 扱わない隣接範囲

| 内容 | 参照先 |
|---|---|
| hasNeighborSignal の中身 (導体・強/弱・getSignal の向き) | → 05_signals-and-block-properties.md |
| setBlock のフラグ全体・NC/PP の順と入れ子・CU の配り方 | → 04_set-block-and-updates.md |
| 予約 tick の重複排除・実行順・優先度 | → 02_scheduled-ticks.md |
| ブロックイベントのキューの規則 | → 03_block-events.md |
| GameEvent の配送・振動・スカルク | → 10_sculk.md |
| PrimedTnt の飛び方・爆発・誘爆 | → 17_entities-interplay.md |
| ディスペンサーが撒く TNT・火打石 | → 12_dispenser-dropper-crafter.md |
| ピストンに押されたときの扱い (PushReaction) | → 13_pistons.md |
| シェルフ・銅のゴーレム像などのコンパレーター出力 | → 14_containers-hoppers-analog.md |
| waterlogged の水 tick・SulfurSpikeBlock (SpeleothemBlock) | → 16_fluids-falling-blocks.md |
| 主乱数の消費順・ランダム tick (酸化) の抽選 | → 18_determinism-java-semantics.md / 01_tick-loop.md |
| 入力素子 (レバー・ボタン・避雷針ほか)・レッドストーン鉱石 | → 09_manual-inputs.md (鉱石は付録 A) / 17 |
| ディスペンサー・クラフター・ホッパー・レール | → 12 / 14 / 15 |

---

## 2. 全体像

この範囲の素子はすべて「信号を受けて自分の状態を変える側」で、レッドストーン信号を出さない (テストブロックの START だけ例外。§4.13)。

### 2.1 一覧 (信号に反応する経路)

| 素子 | 読み方 | 立ち上がり | 立ち下がり | 書き込み flag | 予約 tick | BE | GameEvent |
|---|---|---|---|---|---|---|---|
| ランプ | hasNeighborSignal | 即 LIT=true | 4gt 後に再判定して消灯 | 2 | 4gt (NORMAL) | なし | なし |
| 音符ブロック | hasNeighborSignal | 発音 + POWERED | POWERED だけ | 3 | なし | 種別 0 / 値 0 | NOTE_BLOCK_PLAY |
| ドア | 自分の位置と相方の位置の hasNeighborSignal の OR | OPEN=POWERED=true | OPEN=POWERED=false | 2 | なし | なし | BLOCK_OPEN / BLOCK_CLOSE |
| トラップドア | hasNeighborSignal | 同上 | 同上 | 2 | 水 tick 5gt (waterlogged 時) | なし | 同上 |
| フェンスゲート | hasNeighborSignal | 同上 | 同上 | 2 | なし | なし | 同上 |
| ベル | hasNeighborSignal | 鳴らす + POWERED | POWERED だけ | 3 | なし | 種別 1 / 値 向き | BLOCK_CHANGE |
| TNT | hasNeighborSignal (状態なし) | 着火してブロックを消す | — | 3 (消去) | なし | なし | PRIME_FUSE |
| 銅の電球 | hasNeighborSignal | LIT 反転 + POWERED | POWERED だけ | 3 | なし | なし | なし |
| 大きなドリップリーフ | hasNeighborSignal | 傾きを NONE に戻す | 何もしない | 2 | 10 / 10 / 100gt (傾き遷移) | なし | BLOCK_CHANGE |
| 頭 (skull) | hasNeighborSignal | POWERED | POWERED | 2 | なし | なし | なし |
| シェルフ | hasNeighborSignal | POWERED + 連結 | POWERED + 連結解除 | 3 | なし | なし | BLOCK_ACTIVATE / BLOCK_DEACTIVATE |
| 強い硫黄 (potent_sulfur) | 信号を読まない | — | — | 3 (BE の周期) | なし | 種別 0 / 値 0 | BLOCK_ACTIVATE / BLOCK_DEACTIVATE |

[26.3 読解: 各クラスの neighborChanged / tick / onPlace]

### 2.2 1 回の反応の流れ (共通の型)

1. 誰かの setBlock や updateNeighborsAt が、この素子へ NC を配る (→ 04)。
2. 素子の neighborChanged が走る。ほぼ全部が hasNeighborSignal (6 方向のどれかから 1 以上が来ているか) を問い、保持している POWERED (ランプは LIT) と比べる。**信号の強さは見ない** (1 でも 15 でも同じ)。**同じなら何もしない** (TNT・ドリップリーフだけは比べる状態を持たない)。最強値の API (SignalGetter#getBestOwnOrNeighbourSignal) を使うのは範囲外の硫黄キューブだけで、それも 0 かどうかしか見ない。
3. 違えば、立ち上がり側の副作用 (発音・ベル・LIT 反転・音と GameEvent) を先に起こし、そのあと setBlock で状態を書く。順は素子ごとに違う (§4 の各節と §5.6)。
4. setBlock のフラグで、周りに何が伝わるかが決まる (§3.1)。
5. 信号の処理で予約 tick を使うのはランプの消灯とドリップリーフだけ (トラップドアの水 tick と範囲外のコマンドブロックを除く)。他は NC の処理中に同期で確定する (遅延 0gt)。

### 2.3 オブザーバーから見える変化

オブザーバーは前方の PP で起動する (→ 08)。素子自身の書き込みはどれも flag 16 を立てないので、**blockstate が変われば必ず PP が飛び、オブザーバーに見える** (16 を立てるのはドア設置の前段の 27 と strict の /setblock の 818 だけ。PP の入れ子が深さの上限に達したときも飛ばない → 04)。逆に BE の中だけで変わる値 (ベルの揺れ、コマンドブロックの powered、ストラクチャーブロックの powered、強い硫黄のカウントダウン) は見えない。

| 素子 | 見える変化 (プロパティ) | 起きる契機 |
|---|---|---|
| ランプ | lit | NC (点灯)・ST (消灯) |
| 音符ブロック | powered・note・instrument | NC・素手・**上下のブロックの PP** |
| ドア | open・powered (相方にも PP で伝わる) | NC・素手・風の爆発 |
| トラップドア / フェンスゲート | open・powered / in_wall | NC・素手・風の爆発 / 横の塀の PP |
| ベル | powered・attachment・facing | NC / 支えの PP |
| TNT | ブロックが空気になる | NC・onPlace |
| 銅の電球 | lit・powered (立ち下がりでも powered が変わる) | NC・onPlace |
| ドリップリーフ | tilt | NC・ST・エンティティ・投射物 |
| 頭 | powered | NC |
| シェルフ | powered・side_chain | NC・隣のシェルフの onPlace |
| 強い硫黄 | potent_sulfur_state | PP (水・下のブロック)・BE の周期 |

[実機 1.21.1: copper-bulb-toggle] 立ち下がり (powered だけ変わる) でも真上のオブザーバーが発火する。
[実機 1.21.1: trapdoor-redstone] トラップドアの開閉で真上のオブザーバーが発火し、隣の BUD ピストンは伸びない。

---

## 3. 状態とデータ

### 3.1 書き込みフラグ (この範囲で使う値だけ。全体は → 04)

| flag | 中身 | NC (1) | PP | CU | 使う所 |
|---|---|---|---|---|---|
| 2 | UPDATE_CLIENTS | 出ない | 出る | 出ない | ランプ・ドア/トラップドア/フェンスゲートの受電・トラップドアの素手・ドリップリーフ・頭 |
| 3 | 1 + 2 | 出る | 出る | 新しい状態が analog 出力を持てば出る | 音符ブロック (受電・素手)・ベル・銅の電球・TNT の消去・シェルフ・強い硫黄・ドア上半分の設置・フェンスゲートの風の爆発・銅の酸化 (ChangeOverTimeBlock#changeOverTime) |
| 10 | 2 + 8 | 出ない | 出る | 出ない | ドアの素手と setOpen・フェンスゲートの素手 |
| 11 | 1 + 2 + 8 | 出る | 出る | 同上 | BlockItem#place の設置・TNT を火打石で着火した後の消去 |
| 27 | 1 + 2 + 8 + 16 | 出る | 出ない | 同上 | DoubleHighBlockItem#placeBlock がドア上半分の位置を先に空ける |
| 67 | 1 + 2 + 64 | 出る | 出る | 同上 | ピストンで運ばれたブロックの着地。続けて**着地した位置そのものへ NC を 1 回**送る (送信元は着地したブロック。PistonMovingBlockEntity#tick。→ 13) |
| 258 | 2 + 256 | 出ない | 出る | 出ない | /setblock (strict なし)。書いた後で ServerLevel#updateNeighboursOnBlockSet が、ブロックが変わっていれば撤去フック (affectNeighborsAfterRemoval) を呼び、周り 6 マスへ NC (送信元は書いた後のブロック) を、analog 出力があれば CU を別に出す |
| 818 | 2 + 16 + 32 + 256 + 512 | 出ない | 出ない | 出ない | /setblock strict。置く前の形の合わせ・onPlace・後始末のどれも無い |

要点 [26.3 読解: Level#setBlock・LevelChunk#setBlockState・Block#updateOrDestroy]:

1. NC の送信元ブロック (neighborChanged の第 4 引数) は、Level#setBlock 経由なら**書き換え前のブロック**。/setblock の後始末 (ServerLevel#updateNeighboursOnBlockSet) は**書き換え後のブロック**。レバーなどが自分で配る updateNeighborsAt は配った本人。ドアの判定 (§4.3) がこれを見る。
2. PP で起きた書き込みは、元のフラグから 1 と 32 を落として書く。したがって**形状更新が原因の書き込みは NC を出さない**。ただし updateShape が空気を返したときは destroyBlock になり、flag 3 で NC を出す。
3. onPlace は LevelChunk#setBlockState の中で、**状態が変わるたびに**呼ばれる (flag 512 のときだけ飛ばす)。ブロック種の変化に限らない。各素子は自分で「前の状態が別ブロックか」を見ている。
4. onPlace の中で同じ位置をさらに書き換えると (TNT の消去・銅の電球の点灯・シェルフの連結)、外側の setBlock は「置いた状態と今の状態が違う」ので**外側の NC・CU・PP を丸ごと飛ばす**。周りに伝わるのは内側の書き込みの分だけになる。

### 3.2 blockstate のプロパティと値域

| ブロック | プロパティ (値域) | 既定 |
|---|---|---|
| redstone_lamp | lit (false/true) | false |
| note_block | instrument (§3.4 の 27 種)・note (0〜24)・powered | harp / 0 / false |
| *_door | facing (水平 4)・half (lower/upper)・hinge (left/right)・open・powered | north / lower / left / false / false |
| *_trapdoor | facing (水平 4)・half (top/bottom)・open・powered・waterlogged | north / bottom / false / false / false |
| *_fence_gate | facing (水平 4)・open・powered・in_wall | north (宣言は無く、プロパティの先頭の値) / false / false / false |
| bell | facing (水平 4)・attachment (floor/ceiling/single_wall/double_wall)・powered | north / floor / false |
| tnt | unstable (false/true) | false |
| *copper_bulb (8 種) | lit・powered | false / false |
| big_dripleaf | facing (水平 4)・tilt (none/unstable/partial/full)・waterlogged | north / none / false |
| 頭 (skull 系) | powered (+ rotation か facing) | false |
| *_shelf | facing (水平 4)・powered・side_chain (unconnected/right/center/left)・waterlogged | north / false / unconnected / false |
| potent_sulfur | potent_sulfur_state (dry/wet/dormant/erupting/continuous) | dry |
| command_block 3 種 | facing (6 方向)・conditional | north / false |

### 3.3 ドア類の種別 (BlockSetType) [26.3 読解: BlockSetType]

| 種別 | 素手で開く | 風の爆発で開く | 使うブロック |
|---|---|---|---|
| 木 13 種 (oak・spruce・birch・jungle・acacia・cherry・dark_oak・pale_oak・mangrove・poplar・bamboo・crimson・warped) | する | する | 各ドア・トラップドア |
| copper | する | する | 銅のドア・トラップドア (酸化 4 段 × 蝋引き有無 = 各 8 種) |
| iron | しない | しない | iron_door・iron_trapdoor |

フェンスゲートは WoodType を持ち、すべて素手で開く (BlockSetType を見ない)。押し反応はドアが POPPED (ピストンで壊れる)、トラップドア・フェンスゲートは既定の PUSH_PULL (→ 13)。

### 3.4 音符ブロックの音色表の作り方 [26.3 読解: NoteBlockInstrument・Blocks の登録]

1. 各ブロックは BlockBehaviour.Properties#instrument に音色を持つ。宣言が無ければ harp。
2. ofLegacyCopy・ofFullCopy で作ったブロックは元の音色を引き継ぐ。registerSlab・registerStair・registerLegacyStair・registerWall も元ブロックの性質をコピーするので、階段・ハーフ・塀は元と同じ音色になる。
3. 色付きのまとめ登録 (羊毛・コンクリートパウダー・色付きガラスほか) は 1 か所の宣言が全色に効く。

| 音色 | 型 | 主なブロック (宣言の数) |
|---|---|---|
| harp | 台 | 宣言の無いブロック全部 (空気・ランプ・ピストン・ホッパー・レッドストーンブロックなども) |
| bass | 台 | 木材系・音符ブロック自身など (194 か所) |
| basedrum | 台 | 石系・鉱石・硫黄など (122 か所) |
| snare | 台 | 砂・赤い砂・砂利・怪しげな砂/砂利・コンクリートパウダー・heavy_core (7 か所) |
| hat | 台 | ガラス・色付きガラス・板ガラス・色付き板ガラス・ビーコン・シーランタン・コンジット (7 か所) |
| guitar / flute / bell / chime / xylophone / iron_xylophone / cow_bell / didgeridoo / bit / banjo / pling | 台 | 羊毛 / 粘土 / 金ブロック / 氷塊 / 骨ブロック / 鉄ブロック / ソウルサンド / カボチャ / エメラルドブロック / 干し草 / グロウストーン |
| trumpet / trumpet_exposed / trumpet_weathered / trumpet_oxidized | 台 | 銅ブロックの酸化段階ごと (コピーで切り込み銅なども) [版差 1.21.1: 無い。銅は harp] |
| zombie / skeleton / creeper / dragon / wither_skeleton / piglin | 頭 | 各頭 (上に置いたときだけ効く) |
| custom_head | 頭 (特別) | プレイヤーの頭。音は頭の BE が持つ音 ID |

「型」は NoteBlockInstrument の 3 分類 (BASE_BLOCK / MOB_HEAD / CUSTOM)。台は音程を変えられ (isTunable)、頭と特別は上に置いたときに効く (worksAboveNoteBlock)。

### 3.5 BlockEntity に持つ値と定数

| 対象 | 値・定数 |
|---|---|
| BellBlockEntity | ticks・shaking・clickDirection・resonating・resonationTicks。揺れ 50 tick、襲撃者の発光 60 tick、探索間隔 60 tick、共鳴まで 5 tick、共鳴 40 tick、探索半径 48、鐘を聞く半径 32 |
| PotentSulfurBlockEntity | waitingCountdown (保存キー countdown、既定 -1)・eruptionTick (保存しない。BE が世界に入った時刻で初めを埋め、BE の実行で今の時刻に書き直す。クライアントの演出の位相だけに効く)。吐き気は 10 tick ごとに 80 tick 付与、半径 3 (水平 ±2.5)、カウントダウンは 20 tick ごと、上の水は最大 4 マス |
| PrimedTnt | 導火線 80 tick (既定)、誘爆時は 80 の 1/4 未満の乱数 + 1/8 = 10〜29 tick |
| CommandBlockEntity | powered・auto・conditionMet・成功数 (コンパレーター出力) |

---

## 4. 処理の詳細

### 4.1 レッドストーンランプ (RedstoneLampBlock)

信号源ではない。フルブロックなので**導体**である (強充電されると隣を動かす。→ 05)。

**設置**: RedstoneLampBlock#getStateForPlacement は lit を hasNeighborSignal で決める。onPlace は持たない。[26.3 読解]

**NC (RedstoneLampBlock#neighborChanged)** — サーバー側だけ:

1. lit と hasNeighborSignal を比べる。同じなら終わり。
2. 消えているのに受電している → その場で lit=true を **flag 2** で書く。NC も CU も出ない。PP は出る。
3. 点いているのに受電していない → **4gt の予約 tick (優先度 NORMAL = 0)** を積むだけ。その場では消さない。

**ST (RedstoneLampBlock#tick)**: lit が true で、かつ**その時点で**受電していなければ lit=false を flag 2 で書く。受電していれば何もしない (予約は積み直さない)。

**予約の重複**: LevelChunkTicks#schedule は同じ位置・同じブロック種の予約が既にあれば新しい方を捨てる [26.3 読解]。したがって消灯の 4gt は「**予約が無い状態で、点灯中かつ無受電の NC を受けた最初の時刻**」から数える。窓の中で入力が戻ってまた切れても延びない (§5.1)。[要実機] P1

[実機 1.21.1: lamp-off-delay] t10 に入力を切ると t14 に消灯する。点灯は入力と同じ tick。

### 4.2 音符ブロック (NoteBlock)

信号源ではない。フルブロックの**導体**。[実機 1.21.1: qc-noteblock-strong] 上の床レバーで強充電された音符ブロックは導体として信号を渡すので、ピストンの 1 つ上のマスの隣に置くと疑似接続を満たす (NC を送ると伸びる)。

**音色 (NoteBlock#setInstrument)** — 設置時 (getStateForPlacement) と、**上下の向きから PP を受けるたび** (updateShape) に取り直す:

1. 上のブロックの音色が頭の型 (worksAboveNoteBlock) なら、それにする。
2. そうでなければ下のブロックの音色にする。ただし下が頭の型なら harp。
3. 水平方向の PP では何もしない。

音色が変わると blockstate が変わるので、その書き込みがさらに PP を周りへ出す (NC は出ない。§3.1 の 2)。オブザーバーには見える。

**設置**: getStateForPlacement は音色だけを決め、**powered は false のまま**。onPlace は無い。受電した位置に置いても、次に NC が来るまで powered=false で残る。そのとき初めて立ち上がりとして鳴る。[26.3 読解] [要実機] P2

**NC (NoteBlock#neighborChanged)**:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. 受電した (立ち上がり) なら playNote を呼ぶ (下の 1〜2)。
3. powered を信号に合わせて **flag 3** で書く。周りへ NC と PP が出る。音符ブロックは信号を出さないが、**この NC で隣のピストンなどが目を覚ます**。

**playNote (NoteBlock#playNote)** — 鳴らす条件は「音色が頭の型」または「真上が空気」。満たすときだけ:

1. BE を積む: 種別 0・値 0 (ブロックは note_block)。
2. GameEvent NOTE_BLOCK_PLAY を出す (送信元エンティティは NC なら無し、素手ならプレイヤー)。

条件を満たさなくても powered は更新する。BE は ServerLevel の重複排除つきキューに入る。同じもの (位置・ブロック・値) がキューに残っている間は重ねて積まれない。(→ 03)

**BE の実行 (NoteBlock#triggerEvent)** — ブロックイベントの相で、**実行時点の**状態を読む:

1. 音色が台の型なら note から音程 2 の ((note − 12) ÷ 12) 乗を求める。そうでなければ音程 1。
2. 特別 (custom_head) は上の頭の BE から音 ID を引く。無ければ false を返して終わる (クライアントへ送らない)。
3. 音量 3 で音を出す。**音の種に主乱数 (level の random) の nextLong を 1 回使う** (§5.6)。true を返す。

**素手 (NoteBlock#useWithoutItem)**: note を 1 進め (24 の次は 0)、flag 3 で書き、**そのあとで** playNote を呼ぶ (受電の NC とは順が逆)。左クリック (NoteBlock#attack) は playNote だけで状態は変えない。頭のアイテム (アイテムタグ noteblock_top_instruments) を持って上面を押したときは音程を変えない (NoteBlock#useItemOn が PASS を返し、頭の設置に回す)。

### 4.3 ドア (DoorBlock)

信号源でも導体でもない。上下 2 マスで 1 枚。ピストン型の準接続は無いが、下半分は 1 つ上 (= 上半分の位置) の受電も見る (下の 1)。上半分の無い下半分だけのドア (/setblock で作れる) でも 1 つ上を見る。

**受電の判定 (DoorBlock#neighborChanged)**:

1. signal = 自分の位置の hasNeighborSignal、または**相方の半分の位置**の hasNeighborSignal。下半分なら 1 つ上、上半分なら 1 つ下を見る。したがって上半分のさらに上のブロックや、下半分の土台からの信号でも開く。
2. **NC の送信元ブロックが、このドアと同じブロック種なら何もしない**。比べるのはブロックの完全一致 (oak_door と spruce_door、copper_door と exposed_copper_door は別物)。
3. signal が powered と同じなら終わり。
4. signal が open と違うときだけ、開閉の音 (主乱数で音程) と GameEvent BLOCK_OPEN / BLOCK_CLOSE (送信元無し) を出す。
5. powered=open=signal を **flag 2** で書く。

手順 2 の送信元は §3.1 の 1 に従う。同種のドアから NC が届くのは次の場合だけである:

| 場面 | 送信元 | 同種のドアは無視するか |
|---|---|---|
| 隣の同種ドアが壊れる (setBlock で空気に。上半分をクリエイティブで壊すと下半分も flag 35 で消える。DoublePlantBlock#preventDropFromBottomPart) | 旧ブロック = そのドア | 無視する |
| 相方の半分が PP で空気になり destroyBlock される | 旧ブロック = ドア | 無視する |
| 隣に /setblock で同種のドアを置く | 新ブロック = ドア (後始末の NC) | 無視する |
| 隣の同種ドアの上半分が設置される (setPlacedBy の flag 3) | 旧ブロック = 空気 | 無視しない |
| 銅のドアの下半分が酸化する (ChangeOverTimeBlock#changeOverTime の flag 3) | 旧ブロック = 酸化前のドア | 酸化前と同じブロックのドアだけ無視する。相方の上半分もこの NC は無視し、続く PP で新しい段階へ写る |

[要実機] P5

**上下の同期 (DoorBlock#updateShape)**: 相方の向き (下半分なら上、上半分なら下) から PP を受けると、相方がドアで half が違えば「**相方の状態をそのまま写し、half だけ自分のものにした状態**」を返す。相方がドアでなければ空気を返す (壊れる)。

1. 片方の半分が flag 2 で書かれる → その PP が相方へ届く → 相方は写しを flag 2 で書く。同じ更新の連鎖の中で (同じ tick・遅延 0) 両方がそろう。
2. 写すのはブロック種も含む。酸化で下半分だけ次の段階の銅のドアになると、上半分も同じブロックへ変わる (酸化は下半分だけが抽選する。WeatheringCopperDoorBlock#randomTick)。
3. 相方にも NC が直接届いた場合、相方は同じ OR を計算するが、既に同期しているので何もしない。

**素手 (DoorBlock#useWithoutItem)**: 素手で開く種別 (§3.3) だけ。open だけ反転して **flag 10** で書く。powered は触らない。音 (主乱数) と GameEvent (プレイヤー) を出す。鉄のドアは PASS で何もしない。

**DoorBlock#setOpen** (村人・風の爆発): open が違うときだけ flag 10 で書き、音と GameEvent。風の爆発 (DoorBlock#onExplosionHit) は「爆発が canTriggerBlocks・下半分・風で開く種別・powered でない」ときに open を反転する。(→ 17)

**設置 (DoorBlock#getStateForPlacement → DoubleHighBlockItem#placeBlock → DoorBlock#setPlacedBy)**:

1. 上のマスが置き換え可能で、高さの上限より下のときだけ置ける。
2. powered=open = 自分の位置または 1 つ上の hasNeighborSignal。
3. アイテムは先に上のマスを空気 (水があれば水) にする (flag 27)。続けて下半分を flag 11 で置く。
4. setPlacedBy が上半分を flag 3 で置く。

**支え (DoorBlock#canSurvive)**: 下半分は下のブロックの上面が sturdy であること。上半分は下が同じブロックであること。下半分は下からの PP で支えを失うと空気になる。

[実機 1.21.1: door-redstone] 下半分だけにレバー・上半分だけにレッドストーンブロックのどちらでも、両方の半分が同じ tick に開閉する。
[実機 1.21.1: door-desync] 木のドアを素手で開けると open だけ動き、後から給電すると powered だけ追随する。鉄のドアは素手で開かない。

### 4.4 トラップドア (TrapDoorBlock)

**NC (TrapDoorBlock#neighborChanged)** — サーバー側だけ:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. open が信号と違えば open を合わせ、playSound を呼ぶ。playSound は音 (主乱数で音程) と GameEvent BLOCK_OPEN / BLOCK_CLOSE を**両方**出す。
3. powered を合わせて **flag 2** で書く。
4. waterlogged なら水の予約 tick (5gt) を積む。

**素手 (TrapDoorBlock#useWithoutItem → #toggle)**: 素手で開く種別だけ。open を反転して **flag 2** (ドアと違い 10 ではない) で書き、水 tick と playSound。風の爆発も、風で開く種別で powered でないときに同じ toggle。

**設置**: 受電していれば open=powered=true で置く。

[実機 1.21.1: trapdoor-desync] 素手で開けたあと給電すると powered だけ追随し、レバー OFF で初めて閉じる。

### 4.5 フェンスゲート (FenceGateBlock)

**NC (FenceGateBlock#neighborChanged)** — サーバー側だけ:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. powered=open=信号を **flag 2** で書く。
3. **書いた後で**、書く前の open が信号と違っていたら音 (主乱数) と GameEvent を出す。ドア・トラップドアと順が逆である。

**素手 (FenceGateBlock#useWithoutItem)**: 開いていれば閉じる。閉じていれば開け、ゲートがプレイヤーの向きの反対を向いていたら facing をプレイヤーの向きへ回す。どちらも flag 10。powered は触らない。

**風の爆発 (FenceGateBlock#onExplosionHit)**: powered でなければ open を反転し、**flag 3** で書く (ドア・トラップドアと違い NC が出る)。GameEvent には書く前の状態を添える。

**in_wall**: facing の時計回りの軸 (= ゲートの左右) から PP を受けたとき、その向きか反対側に塀 (BlockTags.WALLS) があれば true、無ければ false に書き直す。

**設置 (FenceGateBlock#getStateForPlacement)**: 受電していれば open=powered=true で置く。in_wall も置くときに左右の塀から決める。

### 4.6 ベル (BellBlock・BellBlockEntity)

信号源でも導体でもない。BE を持つ。押し反応は POPPED。

**NC (BellBlock#neighborChanged)**:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. 立ち上がりなら attemptToRing を向き無しで呼ぶ (下の 1〜4)。
3. powered を **flag 3** で書く。周りへ NC と PP。

**鳴らす (BellBlock#attemptToRing)** — サーバー側で BE があるときだけ。無ければ false で何もしない:

1. 向きが無ければ、そのベルの facing を向きにする。
2. BellBlockEntity#onHit: 揺れていれば ticks を 0 に戻し、揺れていなければ揺れ始める。BE を積む: 種別 1・値 = 向きの 3D 番号 (下 0・上 1・北 2・南 3・西 4・東 5。レッドストーンでは facing なので 2〜5)。
3. 音 (音量 2・音程 1。主乱数は使わない)。
4. GameEvent BLOCK_CHANGE (送信元は鳴らしたエンティティ。NC では無し)。

**BE の実行 (BellBlockEntity#triggerEvent、種別 1)**: 前回の探索から 60 tick を超えていれば (まだ探していなければ) 半径 48 の生き物を探し直す。32 以内の生き物の記憶に「鐘を聞いた時刻」を書く。揺れ・向き・ticks=0・共鳴カウンタ=0 にする。

**BE の毎 tick (BellBlockEntity#tick)**: 揺れている間 ticks を進め、50 で止める。ticks が 5 以上で共鳴カウンタが 0 のまま、32 以内に襲撃者がいれば共鳴を始め、40 tick 後に 48 以内の襲撃者を 60 tick 光らせる。レッドストーンには効かない。

**設置**: getStateForPlacement は powered を決めない。**受電した位置に置いても powered=false で残り、次の NC で鳴る**。[26.3 読解] [要実機] P2

**素手・投射物 (BellBlock#onHit)**: 当たった面が正しいときだけ鳴らす (上下の面は不可、当たった高さが 0.8124 より上も不可、床置きは facing の軸の面、壁付きは facing と別の軸の面、天井は横ならどこでも)。powered は変えない。風の爆発は向き無しで鳴らす (powered を見ない)。村人の行動 (RingBell) も attemptToRing を呼ぶ (→ 03)。

### 4.7 TNT (TntBlock)

**非導体** (isRedstoneConductor が常に偽)。状態を比べずに、受電していれば毎回着火を試みる。

**着火 (TntBlock#prime)** — 成功したら true:

1. サーバーで、ゲームルール tnt_explodes (既定 true) が真でなければ失敗。[版差 1.21.1: このルールは無く常に着火]
2. 着火したのがアドベンチャーモードのプレイヤーで、持ち物がそのブロックを壊せなければ失敗 (26.3 で追加。レッドストーンでは無関係)。
3. PrimedTnt を (x+0.5, y, z+0.5) に作る。作るときに**主乱数の nextDouble を 1 回**使って水平の向きを決め、初速は水平 0.02・上向き 0.2、導火線 80。(→ 17)
4. エンティティを世界へ足し、着火音を出し、GameEvent PRIME_FUSE を出す。

**NC (TntBlock#neighborChanged)**: hasNeighborSignal が真で着火に成功したら removeBlock (flag 3) で消す。消去の NC の送信元は TNT。ルールが偽なら何も起きず、TNT は残る (次の NC でまた試す)。

**設置時に通電していた場合 (TntBlock#onPlace)**: 前の状態が TNT でなければ、受電していれば着火して消す。TNT を TNT で上書きしたとき (unstable だけ書き換えたときを含む) は何もしない。

1. プレイヤーの設置・/setblock (flag 258)・ピストンの着地 (flag 67) のどれでも onPlace が走るので着火する。flag 512 (/setblock strict = 818) では onPlace が飛ぶので着火しない。
2. 消去は onPlace の中で起きるので、**設置そのものの NC・PP は出ない** (§3.1 の 4)。書き込み自体が周りへ届けるのは「TNT が消えた」書き込みの NC (送信元は TNT)・PP だけ。
3. プレイヤーの設置では BlockItem#place の後半が「置いたブロックがもう TNT でない」ので setPlacedBy を呼ばない。設置の GameEvent BLOCK_PLACE は PRIME_FUSE の**後**に出る。
4. /setblock では、そのあとでコマンドの後始末 (ServerLevel#updateNeighboursOnBlockSet) が周り 6 マスへ**もう 1 回** NC を配る。送信元はその時点のブロック = 空気である。周りの素子は 1 回の設置で 2 回 NC を受ける。
5. ピストンの着地では、着地のあとの「自分への NC」(§3.1 の flag 67) は、もう空気になった位置へ届くだけで何も起きない。

**その他の着火**: 火打石・ファイヤーチャージ (TntBlock#useItemOn。着火後に flag 11 で空気)、燃えている投射物 (TntBlock#onProjectileHit。受電を見ない)、unstable=true をクリエイティブ以外で壊す (TntBlock#playerWillDestroy)、爆発に巻き込まれる (TntBlock#wasExploded。ルールが真なら導火線 10〜29 の PrimedTnt。主乱数は向きの nextDouble と導火線の nextInt の 2 回)。爆発でアイテムは落とさない。

### 4.8 銅の電球 (CopperBulbBlock)

**非導体**で信号源でもない。コンパレーターは読める。

**判定と切り替え (CopperBulbBlock#checkAndFlip)** — NC (サーバー側) と onPlace から呼ばれる:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. **前の powered が false (= 立ち上がり) のときだけ** lit を反転し、点灯音か消灯音を出す (主乱数は使わない)。
3. powered を信号に合わせて **flag 3** で書く。周りへ NC と PP。新しい状態が analog 出力を持つので **CU も毎回出る** (立ち下がりで lit が変わらなくても出る)。
4. GameEvent は出さない。予約 tick も使わない (遅延 0gt)。

**onPlace (CopperBulbBlock#onPlace)**: 前の状態が別ブロックのときだけ checkAndFlip を呼ぶ。ブロックが変わる場面はすべて含む:

1. 設置 (プレイヤー・/setblock・ピストンの着地)。受電した位置に置くと、その場で立ち上がりとして置いた状態の lit を反転する (既定の lit=false なら true になる)。押された電球は押される前の lit・powered を持ったまま着地するので、無受電の位置から受電した位置へ押し込むと lit が反転し、受電した位置から押し出すと powered だけ落ちる。
2. 酸化 (WeatheringCopperBulbBlock#randomTick → ChangeOverTimeBlock#changeOverTime が flag 3 で次の段階へ書く)・蝋引き (HoneycombItem の flag 11)・斧での削り。lit と powered は引き継ぐので、普通は何も起きない。ただし powered が実際の受電とずれていれば (strict の /setblock で置いた等)、この書き込みでずれが解消され、立ち上がりなら lit が反転する。
3. 同じ電球の上書き (/setblock で lit だけ変えるなど) では checkAndFlip を呼ばない。

**コンパレーター出力 (CopperBulbBlock#getAnalogOutputSignal)**: その位置の今の状態の lit が真なら 15、偽なら 0。powered は見ない。

**明るさ**: 点灯時の光の強さは酸化段階で 15 / 12 / 8 / 4。信号には効かない。

[実機 1.21.1: copper-bulb-toggle] ON→OFF→ON→OFF で lit は立ち上がりだけ反転し、レバーと同じ tick に確定する。
[実機 1.21.1: copper-bulb-output] コンパレーターは lit を読み、南隣のダストへは信号が抜けない (非導体)。

### 4.9 大きなドリップリーフ (BigDripleafBlock)

葉の部分 (big_dripleaf) だけが信号を読む。茎 (big_dripleaf_stem) は読まない。押し反応は POPPED。葉の上に葉が置かれると、下の葉は上からの PP で茎に変わる (BigDripleafBlock#updateShape。facing・waterlogged を引き継ぐ)。その位置はそこで信号を読まなくなる。

**傾きの遷移** [26.3 読解: BigDripleafBlock#tick・#setTiltAndScheduleTick]:

| 今の tilt | 契機 | 次の tilt | 音 | 予約 | GameEvent |
|---|---|---|---|---|---|
| none | エンティティが乗る (無受電のとき) | unstable | なし | 10gt | なし (unstable は振動しない) |
| unstable | ST (無受電) | partial | 傾く音 | 10gt | BLOCK_CHANGE |
| partial | ST (無受電) | full | 傾く音 | 100gt | BLOCK_CHANGE |
| full | ST (無受電) | none | 戻る音 | なし | BLOCK_CHANGE |
| どれでも | ST で受電中 | none | none 以外からなら戻る音 | なし | none 以外からなら BLOCK_CHANGE |
| どれでも | NC で受電中 | none | 同上 | なし | 同上 |
| どれでも | 投射物が当たる (**受電中でも**。信号を見ない) | full | 傾く音 | 100gt | full 以外からなら BLOCK_CHANGE |

1. 書き込みはすべて **flag 2** (BigDripleafBlock#setTilt)。NC は出さない。
2. GameEvent は「新しい tilt が振動するもの (none・partial・full) で、かつ前と違う」ときだけ。書き込みの後に出す。
3. 音の音程に**主乱数の nextFloat を 1 回**使う (BigDripleafBlock#playTiltSound)。
4. NC は受電中しか何もしない。**信号が切れても何も起きない** (エッジではなくレベルで効く)。
5. 戻しても予約 tick は取り消さない。予約が来たとき none で無受電なら何もしない。
6. エンティティの条件 (BigDripleafBlock#canEntityTilt): 地面に立っていて、足の高さが葉のブロックの y + 0.6875 より上。加えて tilt が none で、その時点で無受電であること (BigDripleafBlock#entityInside。サーバー側だけ)。(→ 17)
7. 受電中に投射物で full にされた葉は、次に届く NC か 100gt 後の ST の早いほうで受電を見て none に戻る (100gt の予約が既にあれば、その古い時刻の ST)。

**予約の重複に注意**: 受電で none に戻した直後に信号が切れ、すぐエンティティが乗ると、unstable の 10gt 予約は「前の予約が残っていれば捨てられる」(§4.1 と同じ規則)。古い予約の時刻で partial へ進むので、10gt より早く傾くことがある。[26.3 読解: LevelChunkTicks#schedule] [要実機] P7

### 4.10 強い硫黄 (PotentSulfurBlock・PotentSulfurBlockEntity) — 26.x の新ブロック

**何をするか**: 水の底に置く間欠泉。レッドストーン信号は**読まないし出さない**。コンパレーター出力も無い。ただし状態の周期的な切り替えを flag 3 で書くので、NC と PP を出す「天然の遅いクロック」になる。フルブロックなので導体。BE を持つのでピストンでは動かない (→ 13)。

**状態の決め方 (PotentSulfurBlock#validBlockState)** — 設置時と、**どの向きの PP でも**取り直す:

1. 真上の流体が水源でなければ dry (水が入った waterlogged のブロックも水源に数える)。
2. 下がブロックタグ causes_continuous_geyser_eruptions (26.3 の中身は lava だけ) で、流体を持つなら源であれば continuous。流れている溶岩では continuous にならない。
3. 下がブロックタグ causes_periodic_geyser_eruptions (26.3 の中身は magma_block だけ) なら (流体を持つなら源に限る)、今が erupting か dormant ならそのまま。そうでなければ BE のカウントダウンを -1 に戻し、dormant にする。
4. どれでもなければ wet。

**onPlace (PotentSulfurBlock#onPlace)**: 書き込みのたびに呼ばれ、新しい状態が erupting か continuous なら BE (種別 0・値 0) を積み、開始音を出し、GameEvent BLOCK_ACTIVATE (状態を添える) を出す。BE の実行 (PotentSulfurBlock#triggerEvent) は BE の eruptionTick を今のゲーム時刻にするだけ (クライアントの噴煙の位相用) で、常に true。

**BE の tick (状態ごとに PotentSulfurBlock#getTicker が組み替える)**:

| 状態 | サーバーの処理 |
|---|---|
| dry | なし |
| wet | 吐き気 |
| dormant | カウントダウン → 吐き気 |
| erupting | 打ち上げ → カウントダウン |
| continuous | 打ち上げ |

1. 気体の出口 (findNoxiousGasSourceBlock): 1 つ上から y+5 まで上へ見る。「水源の流体があり、かつ水ブロックか当たり判定の無いブロック (昆布など)」のマスは水として数えて進む。そうでない最初のマスが空気・流れている水・当たり判定の無いブロックなら出口、それ以外 (固いブロック・当たり判定のある waterlogged ブロック) なら出口無し。y+5 まで水が続いても出口無し。間の水のマス数を W (1〜4) とする。
2. 吐き気: ゲーム時刻が 10 の倍数のとき、出口のマスを水平に ±2.5 広げた箱 (縦は広げない) に触れる生き物のうち、目の位置が塞がれておらず、出口の中心から 3 以内で、目の 1 つ下が水源で、出口の 1 つ下から目の下まで見通せるものに吐き気 80 tick。
3. 打ち上げ: 毎 tick、1 つ上から高さ min(6W, 塞がれていないマス数) の柱の中のエンティティで、上向きの速さが 0.3 + 0.1W 未満のものに上向き 0.2 を足す。除くのは観戦者・死んだもの・動きを計算しないもの (canSimulateMovement が偽)・飛行中のプレイヤー・何かに乗っているもの・エンティティタグ not_affected_by_geysers (26.3 の中身は ender_dragon だけ)。(→ 17)
4. カウントダウン: ゲーム時刻が 20 の倍数で、出口があるときだけ進む。0 以下なら新しい値を入れ、続けて正なら 1 減らし、0 になった時点で dormant と erupting を入れ替えて flag 3 で書く。値を入れた tick にも 1 減らすので、切り替えから次の切り替えまでは「値 × 20 tick」になる (出口が途中で消えなければ)。dormant から erupting へは onPlace が BE・開始音・BLOCK_ACTIVATE を出し、erupting から dormant へは BE の tick が BLOCK_DEACTIVATE (書く前の状態を添える) を出す。
5. 新しい値 (単位は 20 tick): dormant は 10 × (W − 1) + 15〜30、erupting は W − 1 + 1〜2。乱数は「ワールドの種 xor 固定の塩」から位置ごとに毎回作り直すので、**同じ位置では毎回同じ値**になる。主乱数は使わない。

### 4.11 頭 (AbstractSkullBlock)

すべての頭 (床置き・壁付き) が powered を持つ。設置時に hasNeighborSignal で決め、NC (サーバー側だけ) で変われば **flag 2** で書く。予約・BE・GameEvent は無い。押し反応は POPPED (ピストンで壊れる)。powered はドラゴンとピグリンの頭の口の動き (クライアントの BE の動き) にだけ効く。頭は音符ブロックの上に置くと音色を決める (§4.2)。

### 4.12 シェルフ (ShelfBlock) の信号に反応する部分

コンパレーター出力 (3 スロットの埋まり具合のビット) は → 14。

**NC (ShelfBlock#neighborChanged)** — サーバー側だけ:

1. hasNeighborSignal を powered と比べる。同じなら終わり。
2. 新しい状態は powered=信号。信号が切れたときは side_chain も unconnected にする。
3. **flag 3** で書く。この書き込みの中で onPlace が走り、連結を組み直す (下)。
4. 起動音か停止音、GameEvent BLOCK_ACTIVATE / BLOCK_DEACTIVATE (新しい状態を添える)。

**連結 (ShelfBlock#onPlace → SideChainPartBlock)** — onPlace は状態が変わるたびに呼ばれる:

1. 連結できるのは「木のシェルフ (BlockTags.WOODEN_SHELVES) で powered が真」で、同じ facing のものだけ。最長 3 枚。
2. powered なら updateSelfAndNeighborsOnPoweringUp。ただし新しい状態の side_chain が既に連結済みか、前の状態が「連結できる (木で powered) かつ連結済み」だったなら何もしない (隣から書かれたときの再入を止める)。
3. 左 (facing の時計回り) の既存の鎖の長さと合わせて 3 枚以内なら左とつなぎ、続いて右 (反時計回り) も同じ条件でつなぐ。隣の side_chain を先に書き、最後に自分を書く。書き込みはどれも flag 3 で、値が変わるときだけ。
4. powered でなければ updateNeighborsAfterPoweringDown: 左の隣を右側から、右の隣を左側から切り離す。
5. 壊れたとき (ShelfBlock#affectNeighborsAfterRemoval) も CU と切り離しをする。これが呼ばれるのは、消す書き込みに flag 1 があるかピストンのときと、/setblock の後始末の中だけである (LevelChunk#setBlockState・ServerLevel#updateNeighboursOnBlockSet)。strict の /setblock で消すと隣の side_chain は残る。

side_chain の値の変わり方 (SideChainPart): 右とつなぐと unconnected/left → left、right/center → center。左とつなぐと unconnected/right → right、center/left → center。切り離しはその逆。

給電中のシェルフを素手で使うと、鎖全体の 3×N スロットとホットバーを入れ替える (信号の経路ではない)。

### 4.13 範囲の注記だけ: コマンドブロック・ストラクチャーブロック・テストブロック・硫黄キューブ

| 対象 | 信号の読み方と反応 |
|---|---|
| CommandBlock | hasNeighborSignal を BE の powered と比べ、変われば BE に書く (blockstate は変えないのでオブザーバーに見えない)。インパルスと「要レッドストーン」のリピートは立ち上がりで 1gt 予約し、tick で実行して前方のチェーンを同じ tick に順に実行する (上限はルール max_command_sequence_length = 65536)。リピートは powered か auto の間、毎回 1gt を積み直す。チェーンは予約しない。コンパレーターは成功数を読み、tick の最後に CU を出す |
| StructureBlock | 立ち上がりで BE の powered を立て、モードに応じて保存・読み込み・コーナーの解除をする。立ち下がりは powered を下ろすだけ |
| TestBlock | START 以外のモードは立ち上がりで BE を trigger する。START モードは BE が powered の間、ownSignal として 15 を返す (isSignalSource は偽のまま)。ゲームテスト用で、このメモでは扱わない |
| SulfurCube (エンティティ) | 爆発するものを抱えていると、毎 tick「6 隣から受ける信号の最大」と「自分の位置のブロックが信号源ならその ownSignal」の大きい方 (SignalGetter#getBestOwnOrNeighbourSignal) が 0 でなければ導火線に火をつける (ルール tnt_explodes が必要)。→ 17 |

---

## 5. 端の場合と落とし穴

### 5.1 ランプの「4gt」は最後の立ち下がりから数えない

予約の重複排除 (§4.1) のため、入力が「t0 で切れる → t1 で戻る → t3 でまた切れる」と、t3 の予約は捨てられ、t0 の予約が t4 に走る。t4 の時点で無受電なので消える。最後の立ち下がりから 1gt で消える。逆に t4 の時点で受電していれば消えず、次の立ち下がりから改めて 4gt になる。[26.3 読解] [要実機] P1

### 5.2 /setblock で置いた素子は自分で状態を直さない

/setblock は置いた位置の周り 6 マスにだけ NC を配り、自分には配らない (ServerLevel#updateNeighboursOnBlockSet)。onPlace で受電を見ない素子は、書いた値のまま次の NC を待つ (シェルフの onPlace は連結を組み直すだけで受電は見ない)。strict でない /setblock は、置く前に Block#updateFromNeighbourShapes で周りの形に合わせる (BlockInput#place)。音符ブロックの音色・フェンスゲートの in_wall・ベルの付き方はそこで決まるが、受電 (powered・lit・open) は形の更新では決まらない。

| 素子 | /setblock で受電した位置に置くと |
|---|---|
| ランプ・音符ブロック・ドア類・ベル・頭・シェルフ | 書いた状態のまま (読解) |
| 銅の電球・TNT | onPlace でその場で反応する (前が別ブロックのときだけ。同じブロックの上書きでは反応しない) |

ピストンの着地は /setblock と違う。着地した位置そのものへ NC を 1 回送るので (§3.1 の flag 67)、動かされて受電した位置に来たランプ・音符ブロック・トラップドア・フェンスゲートは着地の tick に自分の状態を直す。音符ブロックはそこで鳴る。押す向きでは、あとから着地する腕の NC も隣から届くので、どちらでも直る。粘着ピストンの引き戻しでは本体が先に着地するので、効くのは自分への NC だけである。ドア・ベル・頭・ドリップリーフは POPPED で壊れ、シェルフ・強い硫黄は BE があるので押せない (→ 13)。[26.3 読解: PistonMovingBlockEntity#tick] [要実機] P11

ただし TS 実装 (packages/sim/src/world.ts の setBlockCommand) のコメントは「実機 1.21.1 では置いた位置自身も再評価され、ランプの lit も落ちた」と記録しており、読解と食い違う。[要実機] P3

### 5.3 「信号を出さない」と「NC を出さない」は別

音符ブロック・ベル・銅の電球・シェルフ・強い硫黄は信号を出さないが flag 3 で書くので NC を出す。隣の BUD 状態のピストンはこの NC で動く。ランプ・ドア類・ドリップリーフ・頭は flag 2 なので NC を出さない (PP は出す。フェンスゲートの風の爆発だけは flag 3)。

### 5.4 ドアの「同種のドアは無視」は送信元で決まる

送信元が書き換え前のブロックになる経路 (壊す) と、書き換え後になる経路 (/setblock) で結果が変わる (§4.3 の表)。樹種が違うドア、酸化段階が違う銅のドアは同種ではない。

### 5.5 立ち上がりの判定は保持している powered に対して行う

保持している powered が実際の受電とずれていると (素手での開閉、/setblock、BUD)、次の NC で「ずれの解消」が立ち上がりや立ち下がりとして処理される。銅の電球は「powered=false のまま受電している」状態からの最初の NC で lit を反転する。音符ブロック・ベルはそこで鳴る。

### 5.6 副作用の順と主乱数の消費

GameEvent はその場で配られ (→ 10)、主乱数 (level の random) の消費は TNT の向きなど他の素子の結果を変える (→ 18)。どちらも呼ばれた位置で再現する必要がある。

| 素子 | NC 1 回の中の順 | 主乱数 |
|---|---|---|
| 音符ブロック | BE を積む → NOTE_BLOCK_PLAY → setBlock (flag 3) | BE の実行時に nextLong 1 回 |
| ドア | 音 → BLOCK_OPEN/CLOSE → setBlock (flag 2) | open が変わるとき nextFloat 1 回 |
| トラップドア | 音 → BLOCK_OPEN/CLOSE → setBlock (flag 2) → 水 tick | 同上 |
| フェンスゲート | setBlock (flag 2) → 音 → BLOCK_OPEN/CLOSE | 同上 |
| ベル | BE を積む → 音 → BLOCK_CHANGE → setBlock (flag 3) | 使わない |
| TNT | エンティティ生成 → 音 → PRIME_FUSE → 消去 (flag 3) | 生成時に nextDouble 1 回 |
| 銅の電球 | 音 → setBlock (flag 3) | 使わない |
| ドリップリーフ | setBlock (flag 2) → BLOCK_CHANGE → 音 | 音を出すとき nextFloat 1 回 |
| シェルフ | setBlock (flag 3、中で連結) → 音 → BLOCK_ACTIVATE/DEACTIVATE | 使わない |

音そのものの種は別の乱数 (Level の soundSeedGenerator) から取るので主乱数を減らさない。主乱数を使うのは上の表の明示の呼び出しだけである。[26.3 読解: Level#playSound]

NC 以外の経路でも引く。ドア・トラップドア・フェンスゲートの素手・setOpen・風の爆発は音程に nextFloat を 1 回、TNT の誘爆 (TntBlock#wasExploded) は nextDouble と nextInt を 1 回ずつ使う。音符ブロックの BE は、custom_head で音 ID が無いときは引かずに終わる。

### 5.7 その他

1. 音符ブロックの真上が空気でなく、音色が台の型なら、立ち上がりでも BE も GameEvent も出ない。powered は更新する。
2. 音符ブロックの BE は実行時の状態を読む。積んでから実行までに音色や note が変われば、変わった後の音が鳴る。「真上が空気」の条件は積むときにしか見ないので、実行までに真上が塞がっても鳴る。ブロックが音符ブロックでなくなっていれば捨てられる。
3. ドアは上半分の 6 隣 (真上を含む) からも受電するので、下半分から見て 2 マス上の電源でも開く。
4. フェンスゲートだけ、風の爆発の開閉が NC を出す (flag 3)。
5. TNT はレベルで効く。tnt_explodes が偽の間は、受電した TNT が残り続ける。
6. 銅の電球の CU は立ち下がりでも出る。コンパレーターの値は変わらないが、コンパレーターは neighborChanged を受けて再判定する。
7. 頭の powered は見た目だけで、他のブロックに何も伝えない (PP は出る)。
8. 押せる出力素子 (ランプ・音符ブロック・トラップドア・フェンスゲート・銅の電球・TNT) は、着地の tick に自分の受電を見直す (§5.2)。/setblock で置いたときとは結果が違う。

---

## 6. 版差

担当クラスを 1.21.1・26.2・26.4-pre-1 と diff -u した。1.21.1 は変数名が違うので、メソッド単位で読み比べた。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| ランプ・ドア・トラップドア・フェンスゲート・ベル・銅の電球・ドリップリーフ・頭の受電処理 | 同じ | 同じ | 基準 | 同じ |
| setBlock の書き方 | flag 3 の直書き | flag 3 の直書き | setBlockAndUpdate (= flag 3) | 同じ |
| TNT の tnt_explodes | ルール無し・常に着火 | 有り | 有り | 有り |
| TNT のアドベンチャー制限 | 無し | 無し | 有り | 有り |
| 音色 trumpet 4 種 (銅ブロック) | 無し (銅は harp) | 有り | 有り | 有り |
| BlockSetType の pale_oak / poplar | どちらも無し | pale_oak のみ | 両方 | 樹種ごとの定数と名前の欄が消え、固有の音を持たない木は DEFAULT_WOOD 1 つにまとまった (cherry・crimson・warped・bamboo は別のまま)。pale_oak_door・poplar_door は残る。開閉の真偽値は同じで、ドアの「同種」はブロックで比べるので影響しない |
| シェルフ・強い硫黄・テストブロック・硫黄キューブ | 無し | 有り | 有り | 有り |
| PushReaction の名前 | NORMAL / DESTROY / BLOCK / IGNORE / PUSH_ONLY | 1.21.1 と同じ | PUSH_PULL / POPPED / IMMOVEABLE / IGNORE_ENTITY / PUSH に改名 (→ 13) | 26.3 と同じ |
| onPlace を飛ばす flag 512 | 無し (onPlace は常に走る) | 有り | 有り | 有り |
| /setblock | flag 2 → 新ブロックを送信元に NC (CU は無し) | flag 2 + 256 → updateNeighboursOnBlockSet (NC と CU) | 同 | 同 |
| トラップドア・シェルフの設置時の waterlogged | 水源のときだけ (流体の種類が水の源か。シェルフは無し) | 同 | 同 | 水源のときだけ (書き方を isSourceOfType に変えただけ) |
| TNT・ベルの共鳴・強い硫黄の開始音の引数 | 音量・音程を明示 (強い硫黄は無し) | 同 | 同 | 既定値 (1・1) を使う。挙動は同じ |
| 火打石・ファイヤーチャージでの TNT の着火 (TntBlock#useItemOn) | 着火音だけ | 同 | 同 | アイテムの使用音も鳴らす。音程に主乱数を、火打石は nextFloat 1 回、ファイヤーチャージは 2 回使う (FlintAndSteelItem#playSound・FireChargeItem#playSound) |

受電の処理そのものは 4 版とも同じである。挙動に効く版差は、TNT のルール (と 26.3 のアドベンチャー制限)・trumpet・新ブロック・/setblock の後始末と flag 512・26.4-pre-1 の火打石とファイヤーチャージの使用音 (主乱数) である。1.21.1 の実機 fixture (copper-bulb-*、door-redstone・door-desync、trapdoor-*、lamp-off-delay、qc-noteblock-strong) は 26.3 でも有効と読める (受電処理のコードが同じため)。ただし入力に /setblock を使う fixture は、後始末の中身 (撤去フックの位置・CU) が版で違う (→ 04・19)。

---

## 7. Rust で実装するときの要点

1. **ブロック ID は完全一致で持つ**。ドアの「同種は無視」は oak_door と spruce_door、銅のドアの酸化段階を区別する。樹種を落とした粗い型にしない。
2. **set_block は onPlace をチャンク書き込みの中で呼ぶ**。onPlace が同じ位置を書き換えたら、外側の NC・CU・PP を出さない (§3.1 の 4)。TNT・銅の電球・シェルフがこれに乗る。
3. **NC には送信元ブロックを持たせる**。setBlock 由来は旧ブロック、/setblock の後始末は新ブロック、ピストンの着地の「自分への NC」は着地したブロック (→ 13)。/setblock は自分に NC を送らず、着地は送る。この差を落とすと、粘着ピストンで受電した位置へ引き戻した音符ブロック・ランプの反応が消える (押す向きでは後から着地する腕の NC が埋めるので気づきにくい)。
4. **PP 由来の書き込みは flag から 1 と 32 を落とす**。ドアの上下の同期・音符ブロックの音色・ベルの付き方はこれで書く。空気になる場合だけ destroyBlock (flag 3)。
5. **予約 tick は (位置, ブロック種) で先勝ちの重複排除**をする (→ 02)。ランプとドリップリーフの時刻がこれで決まる。
6. **BE は (位置, ブロック, 値 2 つ) の重複排除つきの順序付き集合**に積み、実行時にブロックが一致するときだけ動かす (→ 03)。音符ブロックは実行時の状態を読む。
7. **GameEvent はフックとして呼ばれた位置で発行**し、振動側 (→ 10) に渡す。周波数は BLOCK_CLOSE・BLOCK_DEACTIVATE が 9、BLOCK_OPEN・BLOCK_ACTIVATE・PRIME_FUSE・NOTE_BLOCK_PLAY が 10、BLOCK_CHANGE が 11 [26.3 読解: VibrationSystem]。
8. **音は鳴らさなくてよいが、主乱数の消費は再現する** (§5.6)。Java 互換の乱数 (→ 18) を共有し、ドア類・ドリップリーフ・音符ブロック・TNT で同じ回数だけ引く。強い硫黄の周期は主乱数ではなく、ワールドの種と位置から作る乱数 (Xoroshiro の位置分岐) なので、種を入力に持つ。
9. **音色はブロックごとの表**にする。性質のコピーを辿る必要があるので、ソースを正規表現で拾うより、実機 (Fabric の環境) でレジストリ全体の既定状態の音色を書き出して生成するのが確実である。
10. 状態の持ち方: ランプ・ドア類・電球・頭は blockstate だけで足りる。ベルは BE に「揺れ」を持つが信号に効かないので、BE を積む処理だけあればよい。強い硫黄はカウントダウンとワールドの種が要る。コマンドブロック類は範囲外として扱う。
11. 他のメモとの境界: hasNeighborSignal (05)、NC/PP の順と入れ子 (04)、予約 tick (02)、BE キュー (03)、GameEvent (10)、PrimedTnt (17)、乱数 (18)。この素子群はそれらの API を呼ぶだけで、独自の順序規則を持たない。

---

## 8. 検証用のプローブ回路案

26.3 の実機で撮る。入力は fixture の inputs (use / setblock) で与える。

| ID | 目的 | 配置 | 観測する tick と期待の要点 |
|---|---|---|---|
| P1 | ランプの消灯時刻が最初の立ち下がりで決まるか | ランプの隣にレッドストーンブロックを setblock で出し入れする | t0 置く (点灯)、t2 外す、t3 置く、t5 外す。期待: t6 に消灯 (t9 ではない) |
| P2 | 音符ブロック・ベルが設置時に powered を決めないか | 点いたレバーの横に音符ブロックとベルを setblock。後で音符ブロック・ベルの別の隣に石を setblock して NC を送る | 設置直後 powered=false、NC の tick に powered=true。ベルの横にスカルクセンサーを置くと BLOCK_CHANGE で反応する |
| P3 | /setblock で置いたランプが自分で直るか | 無受電の位置に redstone_lamp[lit=true] を setblock、受電した位置に lit=false を setblock | 読解どおりなら次の NC まで書いた値のまま。TS のコメントどおりなら即座に直る |
| P4 | 音符ブロックとランプの NC の差 | BUD 状態のピストンの隣に音符ブロック (またはランプ) を置き、別の面からレバーで給電 | 音符ブロックならピストンが伸び、ランプなら伸びない |
| P5 | ドアの同種無視 | ドア A の上半分の隣に、別のドア B の下半分を置く。A は無受電のまま隣に電源がある状態 (26.3 の setblock strict で作る) にする。B の上半分を setblock air で消す | B が A と同種なら A は閉じたまま、別樹種なら A が開く |
| P6 | TNT の設置時着火と NC の出方 | レッドストーンブロックの横に TNT を fake player で置く (BlockItem#place)。反対側に BUD 状態のピストン。対照に /setblock でも置く | 同じ tick に TNT が消えてエンティティが出る。ピストンが伸びる (消去の NC)。t+80 に爆発。/setblock では後始末の NC (送信元は空気) も届くので、伸びるだけでは消去の NC と区別できない |
| P7 | ドリップリーフの予約の重複 | fake player を葉に乗せたまま、t2 に葉の隣へレッドストーンブロックを setblock、t3 に外す | t0 に unstable (t10 を予約)、t2 に none、t3 以降に再び unstable。期待: t13 ではなく古い予約の t10 に partial |
| P8 (低) | 銅の電球の CU が立ち下がりでも出るか | 電球 → 導体 → コンパレーターの列。コンパレーターが古い値を持つ状態を strict の setblock で作る | 立ち下がりの tick にコンパレーターが再判定されるか |
| P9 | シェルフの連結 | 同じ向きのシェルフを 4 枚並べ、左から順・右から順・中央からの 3 通りで給電 | side_chain の最終値 (3 枚までしか連結しない) と各 tick の書き込み順 |
| P10 | 強い硫黄の周期 | マグマブロックの上に強い硫黄、その上に水 1〜4 マス、横にオブザーバー | dormant と erupting の長さが 20 tick の倍数で、同じ位置では毎回同じになるか |
| P11 | 着地した素子の自己更新 | 粘着ピストンで押し出した音符ブロック (powered=false) とランプの、引き戻し先 (腕の位置) の隣にレッドストーンブロックを置き、ピストンを戻す。押す向きでは後から着地する腕の NC が届いて区別できないので、引き戻しで撮る。対照に同じ位置へ /setblock で置く | 着地の tick に音符ブロックは powered=true (発音)、ランプは lit=true。/setblock の対照は書いた値のまま (§5.2)。今の TS はどちらも直さない (§9) |

---

## 9. 既存資料との食い違い

| 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|
| docs/research/02 §6 lamp | 消灯は 4gt 予約と tick 時の再評価。「4 gt 未満の入力断では消灯しない」 | 骨子は同じ。ただし予約は先勝ちで捨てられるので、窓の中の 2 回目の立ち下がりからは 4gt 未満で消えうる (§5.1)。書き込みは flag 2 で NC を出さない | 02 の骨子は正しい。「4gt 未満の入力断」の言い方を「最初に予約した時刻から 4gt」に直すとよい。P1 で確定させる |
| docs/research/10 C9 | 02 §6 と同じ文言 | 同上 | 同上 |
| docs/research/10 C5 | instrument (音色) は保持しない。楽器・音程・発音は wiki 由来で要検証 | TS は #231 で音色を持つようになった。音色の規則・音程の式・鳴る条件はコードで確かめた (§4.2) | 10 C5 の記述が古い。仕様は [26.3 読解] に格上げできる |
| docs/research/10 C5 | Java では use・被電・音程変化がブロック更新を出し、オブザーバーで検知できる | use (note を 1 進める) と被電は flag 3 で NC と PP を出す。音程の変化は use の書き込みそのもの。別に、音色 (instrument) の変化は上下の PP から書かれ、PP だけ出す (NC は出ない) | 10 C5 の記述は正しい。足りないのは音色の変化で、これもオブザーバーに見えるが BUD のピストンは動かさない |
| docs/research/16 §2.4 | Nucleation は音色を更新なしで書くのでオブザーバーに見えない | 音色は PP の連鎖で flag 2 で書かれ、PP を出すので見える | 16 の判断 (redstone-sim が正しい) と一致 |
| tools/mc-harness/README.md (観測の落とし穴) | without_updates で置いても onPlace で自己補正する素子 (ランプ・ピストン等) | ランプは onPlace を持たない。補正されるのは settle の update で NC が届くから | README の例示が不正確。ランプは「NC で補正される素子」 |
| packages/sim/src/world.ts の lamp のコメント (default 分岐) | lamp は vanilla では NC を発する | flag 2 なので NC は出ない | コメントが誤り (16 でも指摘済み)。挙動 (出さない) は正しい |
| packages/sim/src/world.ts のドアの NC | 送信元の型が自分の型 (door_wood / door_iron) と同じなら無視 | 比べるのはブロックの完全一致。樹種・酸化段階が違えば無視しない | TS は鉄以外のドアをすべて door_wood に潰すので、異なる樹種のドア同士・銅と木のドアを同種として扱う。食い違う。状態には元の名前 (name) があるが、NC の送信元 (origin) は粗い型しか運ばない。P5 |
| packages/sim/src/world.ts の NC の送信元の既定 | 更新を出した座標の今のブロック | setBlock 由来は書き換え前のブロック | ドアを壊した NC の送信元が TS では空気になりうる (→ 04 と合わせて要確認) |
| packages/sim/src/world.ts の setBlockCommand | 実機 1.21.1 では置いた位置自身も再評価される | /setblock は自分に NC を配らない (1.21.1 も 26.3 も)。この範囲の置き方で、置いた位置そのものへ NC を送るのはピストンの着地だけ (§5.2) | 実測と読解が食い違う。P3 で確定させる。実機の観測が正しければ、ハーネスか Carpet 側の追加の更新を疑う |
| packages/sim/src/world.ts の銅の電球 | lit が変わったときだけ CU を出す | flag 3 の書き込みのたびに CU が出る | 立ち下がりの CU が抜けている。影響は小さい (P8) |
| packages/sim/src/world.ts の銅の電球 (更新の順) | PP (emitShapeUpdate) を先に出し、NC (submitMultiNC)・CU (emitComparatorUpdate) を後に呼ぶ。更新の連鎖の中では NC は後回しの列に積まれ、CU はその場で走るので、実際の順は PP → CU → NC になる | Level#setBlock は NC → CU → PP の順に更新を積む (→ 04) | 同じ gt・同じ優先度の予約 (真上のオブザーバーと、電球を読むコンパレーターなど) の実行順がずれうる。TS のほかの素子も同じ作りで、04 の食い違いと同根 |
| packages/sim/src/world.ts の finalizeMovingPiston | 着地した位置そのものの再判定 (neighborChanged) はレールとピストンにだけ掛ける | 着地のあとで、着地した位置そのものへ NC を必ず 1 回送る (どのブロックでも。PistonMovingBlockEntity#tick)。銅の電球・TNT は onPlace でも反応する | 食い違う。押した場合は後から着地する腕の NC が隣から届くので結果は同じになる。粘着ピストンで引いた場合は本体が先に着地し、後から隣に着地するものが無いので、TS では古い状態のまま残る。TS の SimWorld で試した: 粘着ピストンで受電した位置へ引き戻したランプは lit=false、音符ブロックは powered=false のまま (押す向きでは着地の tick に直る)。P11 |
| packages/sim/src/world.ts の refreshNoteInstrument・playNote | 音色は常に下のブロックで決める。鳴る条件は「真上が空気」だけ (sim に頭が無いため) | 上が頭なら頭の音色、下が頭なら harp。音色が頭の型なら真上が塞がっていても鳴る (§4.2) | 頭を足すときに直す。今は頭が無いので回路の結果は変わらない。TS の音色の型 (NoteInstrument) にも trumpet 4 種・頭 7 種が無い |
| tests/circuits/copper-bulb-toggle.rstest・copper-bulb-output.rstest | 26.2 CopperBulbBlock の読みで期待値を書いた (立ち上がりで lit 反転・コンパレーターは lit を読む・非導体) | 26.3 も同じ (26.2→26.3 の差は setBlockAndUpdate への書き換えだけ) | 一致。立ち下がりの CU はコンパレーターの値を変えないので期待値には出ない (t6 の後も 15 のまま) |
| tools/mc-harness/fixtures の door-redstone・door-desync・trapdoor-redstone・trapdoor-desync (説明文の典拠) | 26.2 の DoorBlock・TrapDoorBlock・FenceGateBlock を典拠に、OR の受電・updateShape の写し・素手で powered を触らない・flag 2 | 26.3 も同じ | 一致。典拠の版を 26.3 に読み替えてよい |
| packages/sim/src/blocks/noteInstrument.generated.ts と tools/gen-note-instruments.mjs | Blocks の instrument の直書きだけを拾い、色付きは 4 系統だけ展開 | 性質のコピー (ofLegacyCopy・ofFullCopy・階段・ハーフ・塀) で音色を引き継ぐ。コンクリートパウダーも全色 snare。銅は trumpet (26.2 以降) | 表に抜けがある (例: oak_stairs は bass、tuff_bricks・cobbled_deepslate・stone_brick_stairs は basedrum、white_concrete_powder は snare なのに表に無く harp になる)。1.21.1 では銅は harp なので fixture とは食い違わない |
| packages/sim/src の対応範囲 | ベル・TNT・ドリップリーフ・頭・シェルフ・強い硫黄の型が無い | — | 未実装。実装するときは §4 と §7 に従う |

---

## 10. 典拠一覧 (26.3)

- RedstoneLampBlock#getStateForPlacement / #neighborChanged / #tick
- NoteBlock#setInstrument / #getStateForPlacement / #updateShape / #neighborChanged / #playNote / #useWithoutItem / #useItemOn / #attack / #triggerEvent / #getPitchFromNote / #getCustomSoundId
- NoteBlockInstrument#isTunable / #hasCustomSound / #worksAboveNoteBlock
- Blocks の各登録 (instrument・isRedstoneConductor・pushReaction)、BlockBehaviour.Properties#ofLegacyCopy / #ofFullCopy、Blocks#registerSlab / #registerStair / #registerLegacyStair / #registerWall
- DoorBlock#neighborChanged / #updateShape / #getStateForPlacement / #setPlacedBy / #useWithoutItem / #setOpen / #onExplosionHit / #canSurvive / #playSound / #playerWillDestroy、DoublePlantBlock#preventDropFromBottomPart
- DoubleHighBlockItem#placeBlock、BlockItem#place
- WeatheringCopperDoorBlock#randomTick、ChangeOverTimeBlock#changeOverTime、HoneycombItem (蝋引きの flag 11)
- TrapDoorBlock#neighborChanged / #useWithoutItem / #toggle / #playSound / #onExplosionHit / #getStateForPlacement / #updateShape
- FenceGateBlock#neighborChanged / #useWithoutItem / #onExplosionHit / #getStateForPlacement / #updateShape
- BlockSetType (各定数。26.4-pre-1 は DEFAULT_WOOD への統合を diff で確認)
- BellBlock#neighborChanged / #attemptToRing / #onHit / #isProperHit / #onExplosionHit / #updateShape / #getStateForPlacement / #getTicker、RingBell (村人の行動)
- BellBlockEntity#onHit / #triggerEvent / #tick / #updateEntities
- TntBlock#onPlace / #neighborChanged / #prime / #useItemOn / #onProjectileHit / #playerWillDestroy / #wasExploded
- PrimedTnt のコンストラクタ / #getRandomShortFuse
- CopperBulbBlock#onPlace / #neighborChanged / #checkAndFlip / #getAnalogOutputSignal、WeatheringCopperBulbBlock#randomTick
- BigDripleafBlock#neighborChanged / #tick / #entityInside / #onProjectileHit / #setTiltAndScheduleTick / #resetTilt / #setTilt / #playTiltSound / #canEntityTilt、Tilt#causesVibration
- PotentSulfurBlock#validBlockState / #isSourceIfFluid / #updateShape / #getStateForPlacement / #onPlace / #triggerEvent / #getTicker
- PotentSulfurBlockEntity の各 ticker / #geyserPositional / #findNoxiousGasSourceBlock / #getUnobstructedBlockCount / #canBeReachedByNoxiousGas / #getNearbyLivingEntities / #resetCountdown / #saveAdditional / #setLevel
- データのタグ: ブロックタグ causes_continuous_geyser_eruptions・causes_periodic_geyser_eruptions・wooden_shelves・walls、エンティティタグ not_affected_by_geysers、アイテムタグ noteblock_top_instruments
- AbstractSkullBlock#getStateForPlacement / #neighborChanged
- ShelfBlock#neighborChanged / #onPlace / #affectNeighborsAfterRemoval / #isConnectable、SideChainPartBlock#updateSelfAndNeighborsOnPoweringUp / #updateNeighborsAfterPoweringDown / #getAllBlocksConnectedTo、SideChainPart
- CommandBlock#neighborChanged / #setPoweredAndUpdate / #tick / #executeChain / #getAnalogOutputSignal、CommandBlockEntity#setAutomatic / #markConditionMet
- StructureBlock#neighborChanged / #trigger、TestBlock#neighborChanged / #ownSignal、TestBlockEntity#trigger
- SulfurCube#tick / #primeWhenOnPoweredPosition / #primeTime、SignalGetter#getBestOwnOrNeighbourSignal
- Level#setBlock / #removeBlock / #destroyBlock / #updateNeighbourForOutputSignal / #playSound、LevelChunk#setBlockState、Block#updateOrDestroy
- ServerLevel#updateNeighboursOnBlockSet / #blockEvent / #runBlockEvents / #doBlockEvent、SetBlockCommand#setBlock、BlockInput#place
- SignalGetter#hasNeighborSignal、LevelChunkTicks#schedule、LevelAccessor#createTick・ScheduledTick (既定の優先度 NORMAL)、FluidState#isSourceOfType・TypedInstance#is (水源の判定)
- PistonMovingBlockEntity#tick / #finalTick (着地の flag 67 と、着地した位置そのものへの NC)、PistonBaseBlock#isPushable (BE を持つブロックは押せない)
- VibrationSystem (GameEvent の周波数表)、GameRules の tnt_explodes / max_command_sequence_length
- 版差の確認 (26.4-pre-1): TntBlock#useItemOn・FlintAndSteelItem#playSound・FireChargeItem#playSound、TrapDoorBlock#getStateForPlacement、ShelfBlock#getStateForPlacement

---

## 付録: 網羅チェックで足したもの

00_coverage.md の網羅チェックで、このメモに書くべきなのに抜けていた 2 つを足す。本文 (§1〜§10) は変えていない。

| 抜け | 中身 | 足した節 |
|---|---|---|
| G-F2 (39 クラス) | 成長・時間・骨粉で状態が変わるブロック。自動収穫機のオブザーバーの入力になる成長と、骨粉の結果 (performBonemeal) | F.0〜F.13 |
| G-2 | FireBlock の延焼と、火が TNT を点ける経路 | F.14 |

01 §4.5 の表の「作物の成長 → 08」と、12 §4.9 の「performBonemeal → 11・16」の行き先は、この付録である。表記と略語は本文と同じ。加えて RT = ランダム tick (randomTick) と書く。

### F.0 共通の決まり

**読んだクラス (26.3、world/level/block/ からの相対)**

| クラス | 節 |
|---|---|
| CropBlock・CarrotBlock・PotatoBlock・BeetrootBlock・TorchflowerCropBlock・PitcherCropBlock | F.1 |
| StemBlock・AttachedStemBlock | F.2 |
| SugarCaneBlock・CactusBlock・CactusFlowerBlock | F.3 |
| BambooSaplingBlock・BambooStalkBlock・state/properties/BambooLeaves | F.4 |
| GrowingPlantBlock・GrowingPlantHeadBlock・GrowingPlantBodyBlock・KelpBlock・KelpPlantBlock・TwistingVinesBlock・WeepingVinesBlock・NetherVines・CaveVinesBlock・CaveVinesPlantBlock・CaveVines | F.5 |
| SweetBerryBushBlock・NetherWartBlock・CocoaBlock | F.6 |
| SaplingBlock・MangrovePropaguleBlock・AzaleaBlock・grower/TreeGrower | F.7 |
| BuddingAmethystBlock | F.8 |
| ChorusFlowerBlock | F.9 |
| SpreadingSnowyBlock・GrassBlock・MyceliumBlock・NyliumBlock・MushroomBlock・VineBlock・LeavesBlock | F.10 |
| FlowerPotBlock (鉢のアイブロッサム) | F.11 |
| BonemealableBlock・BonemealSource・BonemealableFeaturePlacerBlock・NetherFungusBlock・NetherrackBlock ほか BonemealableBlock の全実装 | F.12 |
| FarmlandBlock・SpeleothemBlock・PointedDripstoneBlock・SulfurSpikeBlock・TurtleEggBlock・SeagrassBlock (成長の側だけ) | F.13 |
| FireBlock・BaseFireBlock・SoulFireBlock | F.14 |

呼び出し先として読んだ所: ServerLevel#tickChunk・#canSpreadFireAround、ChunkMap#anyPlayerCloseEnoughTo・#playerIsCloseEnoughTo、BlockAndLightGetter#getRawBrightness、LevelReader#getMaxLocalRawBrightness・#isEmptyBlock、Level#setBlock・#neighborChanged、LevelChunk#setBlockState、NeighborUpdater#executeShapeUpdate・#executeUpdate、world/item/BoneMealItem#useOn・#growCrop、Bee の受粉の目標 (tick)、TreeFeature#place、StructureTemplate#updateShapeAtEdge、WeightedList#getRandom、Util#getRandom・#shuffle、Mth#nextInt、Direction の並び、GameTestHelper#randomTick、util/datafix/fixes/GameRuleRegistryFix、TntBlock#prime、データのタグ (supports_crops・grows_crops・supports_*_stem_fruit・bee_growables・infiniburn_*・maintains_farmland ほか)。

**扱わない隣接範囲**

| 内容 | 参照先 |
|---|---|
| RT の抽選 (どの位置がいつ選ばれるか) | → 01 §4.5 |
| 存続の 1 gt 予約 (サボテン・サトウキビ・竹・伸びる植物・コーラス) | → 02 §4.9 表 C |
| 支え (F3) と形の決め直し (F1。葉の DISTANCE・つたの面・コーラスプラントのつながり・胴と先端の規則の全体) | → 05 付録 B (F1)・付録 C (F3) |
| 骨粉を撒く側 (プレイヤー・ディスペンサー) | → 12 §4.9 |
| 木・巨大キノコ・巨大菌・草花・苔の形 (地物の配置) | 範囲外 (00_coverage §7) |
| ミツバチの受粉・ラヴェジャーの踏み荒らし・耕地の踏みつけ・PrimedTnt | → 17 |
| 昆布の水・鍾乳石の落下と滴下 | → 16 |
| 乱数の型と消費の順 | → 18 |

**共通の事実** [26.3 読解: ServerLevel#tickChunk・BlockAndLightGetter#getRawBrightness・LevelReader#getMaxLocalRawBrightness・Level#setBlock]

1. RT に渡る乱数は ServerLevel の主乱数である。成長の処理の中で level の getRandom から取る乱数も同じ物である。だから、どの成長も主乱数を消費する (→ 18)。
2. 明るさの読み方は 2 通りある。

   | 読み方 | 中身 | 使うブロック |
   |---|---|---|
   | getRawBrightness (暗さ 0) | ブロック光と空の光の大きい方。時刻・天気で下がらない | 作物・茎・竹・筍・甘い実の茂み・ピッチャー・キノコ |
   | getMaxLocalRawBrightness | 今の空の暗さ (時刻・天気) を引いた値。夜は下がる | 苗木・草と菌糸 |

3. 書き込みのフラグと、周りからの見え方 (→ 04 §3.1)。

   | flag | NC (BUD のピストンが起きる) | PP (オブザーバーが起きる) | この付録で使う所 |
   |---|---|---|---|
   | 2 | 出ない | 出る | 作物とピッチャーの下半分の段・茎の段・甘い実・ネザーウォート・カカオ・洞窟のつたの実 (骨粉)・吊りのマングローブの芽・コーラス・キノコとつたの広がり・耕地の湿り気ほか |
   | 3 | 出る | 出る | 新しく置くブロック (実・サトウキビ・サボテン・竹・伸びる植物の先端・アメジストの芽・草の広がり・火の延焼)・ピッチャーの上半分・竹の葉の書き換え・鉢のアイブロッサム・葉の消滅 |
   | 260 | 出ない | 出る | サトウキビとサボテンの age・苗木の stage・木の失敗の書き戻し・火の age |
   | 818 | 出ない | 出ない (onPlace も無い) | TreeGrower が苗木を消す |
   | 19 | 出る | 出ない | 木の地物が幹と葉を置く (最後に外周へまとめて形の確認。F.7) |

   同じ状態を書くと何も起きない (04 §5.1)。骨粉で段が上がらなかったビートルートがこれに当たる。
4. 成長の書き込みはふつう GameEvent を出さない。setBlock 自体は GameEvent を出さないからである。出すのは甘い実の茂みの成長と収穫 (BLOCK_CHANGE)・洞窟のつたの実の収穫 (BLOCK_CHANGE)・耕地が土に戻るとき (BLOCK_CHANGE)・カメの卵 (F.13)・地面のアイブロッサム (→ 02・10) だけである。存続できずに destroyBlock で壊れるときは BLOCK_DESTROY が出る (04 §4.10)。**スカルクセンサーは作物やサトウキビの成長に反応しない**。
5. 骨粉の結果の入口 (BoneMealItem#growCrop。撒く側は → 12 §4.9):
   1. ブロックが BonemealableBlock で isValidBonemealTarget が真でなければ失敗。骨粉は減らない。
   2. サーバーで isBonemealSuccess を主乱数で判定する。真なら performBonemeal (主乱数)。
   3. 判定の成否によらず骨粉を 1 個減らし、成功を返す。
   4. 26.3 で引数に BonemealSource (INTERACTION / MOB) が足された。骨粉は INTERACTION、MOB を渡すのはミツバチだけである。26.3 で値によって結果を変えるブロックは無い。
6. ミツバチの受粉の成長は別の経路である [26.3 読解: Bee の受粉の目標]。下 1〜2 マスの bee_growables (作物・茎・甘い実の茂み・洞窟のつた) を 1 段進め、**flag 3** で書く (RT の成長は flag 2)。ピッチャーは bee_growables に入るが、どの分岐にも当たらないので育たない。洞窟のつたは有効の判定のあと performBonemeal (実を付ける、flag 2) を呼ぶ。エンティティの側は → 17。

### F.1 作物 (CropBlock・CarrotBlock・PotatoBlock・BeetrootBlock・TorchflowerCropBlock・PitcherCropBlock)

**状態**

| ブロック | プロパティ | 満期 | RT を受ける条件 |
|---|---|---|---|
| wheat・carrots・potatoes | age 0〜7 | 7 | age < 7 |
| beetroots | age 0〜3 | 3 | age < 3 |
| torchflower_crop | age 0〜1 | 満期の判定は 2 以上。age 1 から育つと torchflower (花) に変わる | 常に |
| pitcher_crop | age 0〜4・half (lower / upper) | 4 | 下半分で age < 4 |

支えは supports_crops (= farmland)。存続には明るさ 8 以上も要る (F3)。

**成長の速さ (CropBlock#getGrowthSpeed)** — 作物 1 本ごとに求める:

1. 値 s = 1 から始める。
2. 真下と、その周り 8 マスを見る。grows_crops (= farmland) なら 1、その MOISTURE が 1 以上なら 3。周り 8 マスの分は 4 で割る。足し合わせる。
3. 同じブロック (同じ作物) が東西のどちらかにあり、かつ南北のどちらかにもあれば、s を半分にする。そうでなければ、斜め 4 マスのどれかに同じ作物があれば半分にする。
4. RT 1 回で育つ確率は 1 ÷ (floor(25 ÷ s) + 1)。

| 条件 (光 9 以上) | s | 確率 |
|---|---|---|
| 9 マスとも湿った耕地、周りに同じ作物が無い | 10 | 1/3 |
| 9 マスとも湿った耕地、一面が同じ作物 | 5 | 1/6 |
| 9 マスとも乾いた耕地、周りに同じ作物が無い | 4 | 1/7 |
| 9 マスとも乾いた耕地、一面が同じ作物 | 2 | 1/13 |
| 9 マスとも湿った耕地で列植え (南北に同じ作物、東西と斜めは別の作物) | 10 | 1/3 |

**RT (CropBlock#randomTick)**

1. その位置の明るさ (getRawBrightness) が 9 未満なら終わる。乱数は引かない。
2. 主乱数で nextInt(floor(25 ÷ s) + 1) を引き、0 なら age+1 を flag 2 で書く。
3. ビートルートとトーチフラワーは、先に nextInt(3) を引き、0 なら何もしない (2/3 で手順 1 へ進む)。
4. トーチフラワーは age 1 から育つと torchflower になる。書き込みは同じ flag 2。

**ピッチャー (PitcherCropBlock#randomTick・#grow)**

1. 明るさを先に見ない。s を求め、nextInt(floor(25 ÷ s) + 1) を必ず引く。0 でなければ終わる。
2. 新しい age = min(age + 1, 4)。育てられる条件 (満期でない・明るさ 8 以上・上が世界の内・新しい age が 3 以上なら上が空気かピッチャー) を満たすときだけ書く。
3. 下半分を flag 2 で書き、新しい age が 3 以上なら上半分 (同じ age、half = upper) を **flag 3** で書く。

**骨粉**: 作物は満期でなければ有効で、成功判定は常に真。増分は Mth#nextInt (主乱数で 2〜5 の一様) で、flag 2。ビートルートはその 3 で割った切り捨て (2 なら 0、3〜5 なら 1。1/4 で何も変わらない)。トーチフラワーとピッチャーは +1 (ピッチャーの書き方は RT と同じ)。

**更新と予約**: 段の書き込みは flag 2 なので、オブザーバーには見え、BUD のピストンは起きない。予約 tick は使わない。

**版差**: [版差 1.21.1] 支えと耕地の判定がコードの直書き (farmland) で、中身は同じ。26.2 → 26.4-pre-1 は引数 (BonemealSource) と書き方の整理だけ。

**プローブ**: G1・G11 (F.16)。

### F.2 茎と実 (StemBlock・AttachedStemBlock)

**状態**: pumpkin_stem・melon_stem は age 0〜7。attached_pumpkin_stem・attached_melon_stem は facing (水平 4)。茎の支えは supports_*_stem (= 耕地)。実を置く場所の下は supports_*_stem_fruit (= supports_vegetation。土・泥・苔・草のブロック類と耕地)。茎は age 7 でも RT を受け続ける。

**RT (StemBlock#randomTick)**

1. 明るさ (getRawBrightness) が 9 未満なら終わる。
2. 茎自身の種類で s を求め (作物と同じ式)、nextInt(floor(25 ÷ s) + 1) が 0 でなければ終わる。
3. age < 7 なら age+1 を flag 2 で書く。
4. age 7 なら、水平 4 方向 (北・東・南・西の並び) から nextInt(4) で 1 つ選ぶ。その隣が空気で、その下が実の支えなら、
   1. 隣に実 (pumpkin / melon の既定の状態) を flag 3 で置く。
   2. 自分を attached_*_stem (facing = 選んだ向き) に flag 3 で書く。

   選んだ向きが塞がっていれば何もしない。別の向きは試さない。

**実が消えたとき (AttachedStemBlock#updateShape)**: facing の向きからの PP で、その隣が実でなければ age 7 の茎に戻る。PP の書き込みなので NC は出ない (本文 §3.1 の 2)。形の規則の全体は → 05 (F1)。

**骨粉**: age 7 でなければ有効で、成功判定は常に真。age += 2〜5 (上限 7、flag 2)。**ちょうど 7 になったら、その場で RT を 1 回呼ぶ** (上の手順 1〜4 をそのまま通る。明るさと確率の判定もある)。

**更新と予約**: 実の設置と茎の付け替えはどちらも flag 3 なので、実の位置の 6 隣と茎の 6 隣へ NC が出る。オブザーバー式の収穫機は実の位置を見る。

**版差**: [版差 1.21.1] 実の支えは「耕地か dirt タグ」(1.21.1 の dirt タグは草・菌糸・ポドゾル・苔・泥を含む)。26.x のタグとほぼ同じ集合である。

**プローブ**: G4・G11。

### F.3 サトウキビとサボテン (SugarCaneBlock・CactusBlock・CactusFlowerBlock)

**状態**: sugar_cane・cactus は age 0〜15。cactus_flower はプロパティなし。2 つとも常に RT を受け、光は見ない。

**RT (SugarCaneBlock#randomTick)**

1. 真上が空気でなければ終わる。
2. 自分から下へ続くサトウキビの本数 h を数える (自分を含む)。h が 3 以上なら終わる。
3. age が 15 なら、真上に新しいサトウキビ (age 0) を **flag 3** で置き、自分を age 0 に flag 260 で書く。
4. そうでなければ age+1 を flag 260 で書く。

乱数は使わない。16 回の RT で 1 段伸びる。

**RT (CactusBlock#randomTick)**

1. 真上が空気でなければ終わる。
2. 下へ続くサボテンを数える (h)。数えている途中で h が 3 に達し、かつ age が 15 なら、そこで終わる (何も書かない)。
3. age が 8 で、真上にサボテンが存続できる (真上の横 4 マスが固体でも溶岩でもなく、2 つ上が液体でない) なら、主乱数の nextDouble を引く。h ≥ 3 なら 0.25 以下、そうでなければ 0.1 以下で、真上に cactus_flower を flag 3 で置く。
4. そうでなく、age が 15 で h < 3 なら、
   1. 真上に新しいサボテンを flag 3 で置く。
   2. 自分を age 0 に flag 260 で書く。
   3. 真上へ NC を 1 件積む。積む状態はサボテンで、サボテンは neighborChanged を持たないので何も起きない (04 §5.6)。
5. age < 15 なら age+1 を flag 260 で書く (手順 3 の花の判定のあとでも書く)。

- 花が載ると真上が空気でなくなり、そのサボテンは伸びも age も止まる。花の支えは cactus か farmland か、上面の中央が頑丈なブロック (CactusFlowerBlock#mayPlaceOn)。
- 新しい段の存続は、手順 4.2 の flag 260 の PP が新しい段に届いて確かめられる。横に固体があれば 1 gt の予約 (→ 02 §4.9 表 C) のあとで壊れて落ちる。サボテン農場はこれを使う。成長先の横に固体があると手順 3 の判定も偽になるので、農場の形では花は咲かない。

**更新と予約**: age の書き込み (260) は PP だけを出す。サトウキビでもサボテンでも、伸びる段 (真上が空気の最上段) を見るオブザーバーは、1 段伸びるまでに 16 回発火する。新しい段は flag 3 なので、その 6 隣へ NC が出る。

**版差**: [版差 1.21.1] サボテンは h < 3 のときだけ age を進め、花も無かった。3 段のサボテンの最上段は age が進まないので、それを見るオブザーバーは発火しない。26.2 以降は 3 段目も age が 15 まで進む (書き込みのたびに PP)。サトウキビは同じ (フラグが 4 から 260 に変わったが、サーバーでの効きは同じ)。

**プローブ**: G2・G3。

### F.4 竹 (BambooSaplingBlock・BambooStalkBlock・BambooLeaves)

**状態**: bamboo_sapling (筍) はプロパティなし。bamboo は age 0〜1 (0 = 細い、1 = 太い)・leaves (none / small / large)・stage 0〜1 (1 = 伸び終わり)。既定は 0・none・0。RT を受けるのは筍と、stage 0 の竹だけ。高さの上限は 16。

**筍の RT (BambooSaplingBlock#randomTick)**: nextInt(3) が 0 で、真上が空気、真上の明るさ (getRawBrightness) が 9 以上なら、真上に竹 (leaves = small) を flag 3 で置く。筍は真上からの PP で竹の既定の状態に変わる (PP の書き込み)。

**竹の RT (BambooStalkBlock#randomTick)**

1. stage 0 で、nextInt(3) が 0、真上が空気、真上の明るさが 9 以上のときだけ進む。
2. h = 下へ続く竹の本数 (16 まで) + 1。h が 16 以上なら終わる。
3. 伸ばす (BambooStalkBlock#growBamboo)。1 つ下を B1、2 つ下を B2 とする。
   1. B1 が竹で leaves が none でなければ、新しい段の leaves は large。そのうえ B2 も竹なら、B1 を small に、B2 を none に、この順に **flag 3** で書く。B1 が竹でないか none なら、新しい段は small。
   2. 新しい段の age は、自分が太い (1) か B2 が竹なら 1、それ以外は 0。
   3. 新しい段の stage は、h が 15 なら 1。h が 11 以上なら nextFloat < 0.25 で 1。それ以外は 0。nextFloat は h が 11 以上のときだけ引く。
   4. 真上に新しい段を flag 3 で置く。
4. 下の段の age は、真上からの PP で真上より細ければ太くなる (F1。→ 05)。

**骨粉**: 竹は「上下の竹の合計 + 1 が 16 未満・最上段が stage 0・最上段の上が世界の内で空気」なら有効。nextInt(2) + 1 段 (1 か 2) を最上段から上へ順に伸ばす (手順 3 と同じ。止まる条件を毎回見る)。筍は真上が空気で世界の内なら有効で、竹を 1 段置く。成功判定はどちらも常に真。

**更新と予約**: 葉の書き換えと新しい段がどれも flag 3 なので、成長のたびに上 3 段の周りへ NC が出る。BUD のピストンでも検知できる。存続の 1 gt 予約は → 02。

**版差**: 1.21.1 から 26.4-pre-1 まで同じ (書き方の整理だけ)。

**プローブ**: G5。

### F.5 伸びる植物 (GrowingPlantBlock・GrowingPlantHeadBlock・GrowingPlantBodyBlock・KelpBlock・KelpPlantBlock・TwistingVinesBlock・WeepingVinesBlock・NetherVines・CaveVinesBlock・CaveVinesPlantBlock・CaveVines)

**状態**

| 先端 (Head) | 胴 (Body) | 伸びる向き | RT 1 回で伸びる確率 | 伸びられる先 |
|---|---|---|---|---|
| kelp (age 0〜25) | kelp_plant | 上 | 0.14 | 水のブロック (水源でも流水でも) |
| twisting_vines (age) | twisting_vines_plant | 上 | 0.1 | 空気 |
| weeping_vines (age) | weeping_vines_plant | 下 | 0.1 | 空気 |
| cave_vines (age・berries) | cave_vines_plant (berries) | 下 | 0.1 | 空気 |

先端は age < 25 の間だけ RT を受ける。胴は RT を受けない。

**先端の RT (GrowingPlantHeadBlock#randomTick)**

1. age < 25 で、主乱数の nextDouble が確率未満のときだけ進む。
2. 伸びる先の 1 マスが伸びられる先なら、そこに「自分の age+1」の先端を flag 3 で置く。洞窟のつたは、このとき nextFloat < 0.11 で berries を真にする (CaveVinesBlock#getGrowIntoState)。
3. 元の先端は、新しい先端からの PP で胴に変わる (GrowingPlantHeadBlock#updateShape。洞窟のつたは berries を引き継ぐ)。

**先端を失ったとき (GrowingPlantBodyBlock#updateShape)**: 伸びる向きの隣が胴でも先端でもなくなった胴は、PP で**新しい先端**になる。その age は主乱数の nextInt(25) (0〜24) で決まる (updateShape に渡る乱数は主乱数。NeighborUpdater#executeShapeUpdate)。だから昆布の収穫機では、刈るたびに残りの伸び代が 25 − age 段に引き直される。手で置いた先端も、伸びる向きの隣に同じ植物が無ければ age を nextInt(25) で決める (GrowingPlantBlock#getStateForPlacement)。

**骨粉 (GrowingPlantHeadBlock#performBonemeal)**: 伸びる先が伸びられる先で世界の内なら有効。成功判定は常に真。伸びる段数 n を決め、伸びる先へ順に「age を 1 ずつ増やした先端」を flag 3 で置く (age は 25 で止まる。塞がれば途中で止まる)。

| 植物 | n |
|---|---|
| 昆布 | 1 |
| ねじれ・しだれツタ | NetherVines#getBlocksToGrowWhenBonemealed。p = 1 から始め、nextDouble < p の間だけ数え、そのたびに p を 0.826 倍する。n ≥ k の確率は 0.826 の k(k−1)/2 乗 (n は 1 以上、平均は約 2.9) |
| 洞窟のつた | 伸びない。berries が偽の段 (先端でも胴でも) を berries 真に flag 2 で書く (CaveVinesBlock#performBonemeal・CaveVinesPlantBlock#performBonemeal) |

胴に撒くと、つながった先端を探し、その先端に撒いたのと同じに扱う (GrowingPlantBodyBlock#performBonemeal)。

**実の収穫 (CaveVines#use)**: berries が真なら落とし物を出し、主乱数で音程を 1 回引き、berries 偽を flag 2 で書き、GameEvent BLOCK_CHANGE を出す。

**更新と予約**: 新しい先端は flag 3。元の先端が胴に変わる書き込みは PP 由来なので NC を出さない。存続の 1 gt 予約と昆布の水の予約は → 02・16。

**版差**: 1.21.1 から 26.4-pre-1 まで同じ (26.4-pre-1 は落下の記録の種類を足しただけ)。

**プローブ**: G6。

### F.6 段だけ進む植物 (SweetBerryBushBlock・NetherWartBlock・CocoaBlock)

| ブロック | プロパティ | RT の条件と確率 | 書き込み | 骨粉 | 収穫 |
|---|---|---|---|---|---|
| sweet_berry_bush | age 0〜3 | age < 3、nextInt(5) が 0、真上の明るさ 9 以上 | age+1 を flag 2。**GameEvent BLOCK_CHANGE** | age < 3 で有効、+1 (flag 2。GameEvent なし) | age ≥ 2 を素手で使うと age 1 を flag 2、BLOCK_CHANGE。主乱数で音程を 1 回 |
| nether_wart | age 0〜3 | age < 3、nextInt(10) が 0。光は見ない | age+1 を flag 2 | 骨粉の対象ではない | — |
| cocoa | facing (水平 4、丸太の向き)・age 0〜2 | age < 2、nextInt(5) が 0。光は見ない | age+1 を flag 2 | age < 2 で有効、+1 (flag 2) | — |

- 甘い実の茂みは、条件を「age → nextInt(5) → 明るさ」の順に見る。暗くても乱数を引く。
- カカオは facing の向きの隣 (supports_cocoa = jungle_logs) で支えられる (F3)。

**版差**: 1.21.1 から同じ。

**プローブ**: G10 (甘い実の茂みの GameEvent)。

### F.7 苗木と木 (SaplingBlock・MangrovePropaguleBlock・AzaleaBlock・TreeGrower)

**状態**: 苗木 (oak ほか) は stage 0〜1。mangrove_propagule は stage・age 0〜4・waterlogged・hanging。azalea・flowering_azalea はプロパティなしで、RT も受けない。

**苗木の RT (SaplingBlock#randomTick → #advanceTree)**

1. 真上の明るさ (getMaxLocalRawBrightness。夜は下がる) が 9 以上で、nextInt(7) が 0 のときだけ進む。明るさが足りなければ乱数を引かない。
2. stage 0 なら stage 1 を flag 260 で書く (PP だけ。オブザーバーに見える)。
3. stage 1 なら TreeGrower#growTree で木を試す。

**木を試す (TreeGrower#growTree)**

1. 大木の表が空でなければ主乱数で 1 つ選ぶ (WeightedList#getRandom。要素が 1 つでも nextInt を 1 回引く。空なら引かない)。選べたら、自分を含む 2×2 の同じ苗木を探す。探す順は、自分が北西の角 → 南西の角 → 北東の角 → 南東の角の 2×2 である。見つかれば 4 本を flag 818 で消し (水を含んでいれば水にする)、2×2 の北西の角を起点に大木の地物を置く。置けなければ 4 本を元の状態で flag 260 で書き戻し、終わる。2×2 が見つからなければ 2 へ進む。
2. そうでなければ、周り (x・z ±2、y ±1) に flowers タグのブロックがあり花付きの表が空でなければ花付きの表、それ以外はふつうの表から主乱数で選ぶ。選べなければ何もせず終わる。自分を flag 818 で消し、地物を置く。置けなければ flag 260 で書き戻す。
3. 818 は PP も onPlace も出さない。木の地物 (TreeFeature#place) は根・幹・葉・飾りを flag 19 (NC あり、PP なし) で置き、最後に木の形の外周の全ての面で、内側と外側の両方の updateShape を呼ぶ (StructureTemplate#updateShapeAtEdge。変わったら flag 2 で書く)。苗木の位置を見ていたオブザーバーは、この外周の確認で起きると読める [要実機]。

| 樹種 | ふつうの表 (重み) | 大木の表 | 花付きの表 |
|---|---|---|---|
| oak | oak 9・fancy_oak 1 | なし | 蜂の巣付きの 2 種 (9・1) |
| spruce | spruce | mega_spruce 1・mega_pine 1 | なし |
| birch・cherry | 各 1 種 | なし | 蜂の巣付き |
| jungle | jungle_tree_no_vine | mega_jungle_tree | なし |
| acacia・azalea | 各 1 種 | なし | なし |
| poplar | 赤・橙・黄が 1 ずつ | なし | なし |
| mangrove | mangrove 15・tall_mangrove 85 | なし | なし |
| dark_oak・pale_oak | なし | 各 1 種 | なし (2×2 でしか育たない) |

**骨粉**: 有効の判定で TreeGrower#canGrow が**主乱数を最大 2 回引く** (ふつうか花付きの表と、大木の表。空の表は引かない)。ふつうの表から選べず大木の表があるのに 2×2 が無ければ無効 (骨粉は減らない)。さらに、一番低い木の幹の高さが世界に収まることが要る。成功判定は主乱数の nextFloat < 0.45。結果は RT の手順 2・3 と同じ (stage 0 なら stage 1、stage 1 なら木)。

**マングローブの芽 (MangrovePropaguleBlock)**: 吊りでない芽は、RT で nextInt(7) が 0 なら advanceTree (**明るさを見ない**)。吊りの芽は RT のたびに age+1 (4 まで、flag 2。乱数なし)。骨粉は、吊りで age < 4 なら age+1 (flag 2。成功判定は常に真)、吊りでなければ苗木と同じ。手で置くと age 4・吊りでない。吊りの芽は mangrove_leaves に骨粉を撒くと真下に age 0 で置かれる (F.12)。

**ツツジ (AzaleaBlock)**: RT を受けず、骨粉だけで木になる。有効の判定は「ツツジの木の幹の最低の高さ + 2 が世界に収まり、真上に流体が無い」。成功判定は主乱数の nextFloat < 0.45。結果は TreeGrower の azalea で木を試す (stage は無い)。

**版差**

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| 苗木の骨粉の有効判定 | 常に真 | 一番低い木が世界に収まる | + TreeGrower#canGrow (主乱数を引く) | 26.3 と同じ |
| 表の選び方 | 主と副を nextFloat < 副の確率で選ぶ (oak 0.1・spruce の大木 0.5・mangrove 0.85 ほか) | 同 | 重みの表から nextInt (確率は同じ。乱数の引き方と回数が違う) | 同 |
| 苗木を消す書き込み | flag 4 (PP あり) | 260 (PP あり) | 818 (PP なし) | 818 |
| stage と書き戻しの書き込み | flag 4 | 260 | 260 | 260 |

**プローブ**: G8。

### F.8 芽吹いたアメジスト (BuddingAmethystBlock)

**状態**: budding_amethyst はプロパティなし。芽 (small / medium / large_amethyst_bud・amethyst_cluster) は facing (6 方向)・waterlogged。押し反応は POPPED (→ 05 §4.6・13)。

**RT (BuddingAmethystBlock#randomTick)**

1. nextInt(5) が 0 のときだけ進む。
2. 向き D を 6 方向 (下・上・北・南・西・東の並び) から nextInt(6) で選ぶ。
3. 隣 T を見る。空気か満杯の水のブロックなら small、facing = D の small なら medium、facing = D の medium なら large、facing = D の large なら cluster にする。facing が違う芽やそれ以外のブロックなら何もしない。
4. 書くときは facing = D、waterlogged = 「T の流体が水源の水か」で、**flag 3**。

1 回の RT で 1 段だけ進む。1 つの面が cluster まで育つには、その面が 4 回選ばれる必要がある。

**更新と予約**: flag 3 なので、芽の位置の 6 隣へ NC と PP が出る。芽を見るオブザーバーは段が進むたびに発火する。

**版差**: 1.21.1 から同じ。26.4-pre-1 は水の判定の書き方だけを変えた (結果は同じ)。

**プローブ**: G7。

### F.9 コーラスフラワー (ChorusFlowerBlock)

**状態**: chorus_flower は age 0〜5 (5 = 枯れ)。age < 5 の間だけ RT を受ける。支えは真下の supports_chorus_flower (= end_stone) かコーラスプラント。真下が空気なら、水平 4 隣のちょうど 1 つがプラントで残りが空気のときだけ残れる (F3)。

**RT (ChorusFlowerBlock#randomTick)** — 真上が空気で、真上が世界の最上段以下のときだけ進む:

1. 下を見て「上へ伸びるか」を決める。
   1. 下が end_stone なら伸びる。
   2. 下がコーラスプラントなら、下へ続くプラントの本数 h (最大 5) を数え、その下が end_stone なら「土台付き」とする。h < 2 なら伸びる。そうでなければ nextInt(土台付きなら 5、でなければ 4) を引き、h がその値以下なら伸びる。
   3. 下が空気なら伸びる。
2. 伸びるとき、真上の水平 4 隣が空気で 2 つ上も空気なら、自分をコーラスプラント (つながりを求めた状態) に flag 2 で書き、真上に同じ age の花を flag 2 で置く (レベルイベント 1033)。
3. 2 をしなかったとき、age < 4 なら枝分かれを試す。回数は nextInt(4) (土台付きなら +1)。1 回ごとに水平の向きを nextInt(4) で選び、その隣と隣の下が空気で、隣の周り (戻る向きを除く 3 方向) が空気なら、隣に age+1 の花を flag 2 で置く。1 つでも置けたら自分をプラントに flag 2 で書く。1 つも置けなければ自分を枯れ (age 5) に flag 2 で書く (レベルイベント 1034)。
4. 2 も 3 もしないとき (age 4) は枯れる。

書き込みはすべて flag 2 なので NC は出ない。存続の予約は → 02、投射物で壊れるのは → 17。

**版差**: 1.21.1 から同じ (世界の上限の書き方だけが違う)。

### F.10 広がる・戻るブロック (SpreadingSnowyBlock・GrassBlock・MyceliumBlock・NyliumBlock・MushroomBlock・VineBlock・LeavesBlock)

| ブロック | RT の処理 | 書き込み |
|---|---|---|
| grass_block・mycelium (SpreadingSnowyBlock#randomTick) | 1. 生きられないなら土 (dirt) にする。真上が雪 1 層なら生きられる。真上の流体が満杯なら生きられない。それ以外は、真上が上面へ通す光の遮り (LightEngine#getLightDampeningInto) が 15 なら生きられない。2. 生きられて、真上の明るさ (getMaxLocalRawBrightness) が 9 以上なら、4 回、周り (x・z は −1〜1、y は −3〜1) の 1 マスを主乱数で選び (x・y・z の順に nextInt)、そこが dirt で、広げられる (生きられて、真上に水が無い) なら自分の種類にする。snowy は真上が snow タグかで決める | どちらも flag 3 |
| crimson_nylium・warped_nylium (NyliumBlock#randomTick) | 真上が上面の光を遮る (15) ならネザーラックにする。自分では広がらない (ネザーラックへの骨粉で広がる。F.12) | flag 3 |
| brown_mushroom・red_mushroom (MushroomBlock#randomTick) | 1. nextInt(25) が 0 のときだけ進む。2. 9×3×9 (x・z ±4、y ±1) に同じキノコが 5 本以上あれば終わる。3. 1 マスずらした候補を作る (x は nextInt(3) − 1、y は nextInt(2) − nextInt(2)、z は nextInt(3) − 1)。4 回、「候補が空気で存続できるならそこへ移る」をしてから候補を作り直す。4. 最後の候補が空気で存続できれば、そこに自分を置く。存続の条件は、下が overrides_mushroom_light_requirement (菌糸・ポドゾル・ナイリウム) なら常に可、それ以外は明るさ 13 未満かつ下が不透明のフルブロック (isSolidRender) | flag 2 |
| vine (VineBlock#randomTick) | 1. ゲームルール spread_vines が真で nextInt(4) が 0 のときだけ。2. 向き D を 6 方向から nextInt(6) で選ぶ。3. D が水平でその面がまだ無いとき: 9×3×9 に同じつたが 4 本以下なら、D の隣が空気のとき、左右の面の有無と取り付け可否から 1 面のつたを隣か角の先に置く。どれも駄目なら nextFloat < 0.05 で隣に上面のつたを置く。隣が空気でなく取り付けられるなら、自分の D 面を立てる。4. それ以外: D が上なら、上に取り付けられれば自分の上面を立てて終わる。上が空気なら (数の条件を満たすとき) 水平 4 面を nextBoolean で半分ずつ残した状態を上に置いて終わる。D が下か、上で何もできなかったときは、下が空気かつたなら、自分の水平の面を nextBoolean で半分ずつ写して下に書く | flag 2 |
| 葉 (LeavesBlock#randomTick) | distance が 7 で persistent が偽の葉だけが RT を受ける。受けたら落とし物を出して消える (removeBlock) | flag 3 |

- 草・菌糸・ナイリウムの戻りと広がり、葉の消滅は flag 3 なので NC を出す。キノコとつたは flag 2。
- 葉の DISTANCE の決め直し (予約 1 gt) と、つたの面を消す規則は F1 (→ 05・02)。

**版差**: [版差 1.21.1] 草と菌糸のクラス名は SpreadingSnowyDirtBlock で、中身は同じ (snowy の判定は snow のブロック)。つたのゲームルールは doVinesSpread。[版差 26.4-pre-1] キノコの存続が「下の上面の中央で支えられるか」だけになり (明るさを見ない)、明るさ 13 未満の条件は広がる先の判定 (MushroomBlock#canSpreadTo) に移った。葉の予約の条件の変更は → 02・05。

### F.11 鉢のアイブロッサム (FlowerPotBlock)

potted_open_eyeblossom・potted_closed_eyeblossom だけが RT を受ける (FlowerPotBlock#isRandomlyTicking)。

1. 環境属性 EYEBLOSSOM_OPEN をその位置で読む。時刻のタイムラインで決まり、決まっていなければ今の状態のままとみなす。
2. 今の開閉と違えば、反対の鉢に **flag 3** で書く。続けてパーティクルのために主乱数の nextDouble を 4 回引き、音を出す。
3. 地面のアイブロッサムと違い、GameEvent も周りの花への予約 (→ 02 §4.9) も出さない。確率の抽選も無いので、属性が変わったあとの最初の RT で必ず切り替わる。

flag 3 なので、BUD のピストンも起きる。

**版差**: [版差 1.21.1] アイブロッサムが無い。26.2 は flag 3 の直書きで、26.3 と同じ。

**プローブ**: G10。

### F.12 骨粉の結果の全表

BonemealableBlock を実装する 35 クラスと、結果を上書きする 3 クラス (CaveVinesBlock・CaveVinesPlantBlock・MangrovePropaguleBlock) の結果である。乱数はすべて主乱数。「常に」は判定が常に真の意味。

| クラス (主なブロック) | 有効の条件 | 成功の判定 | 結果と flag |
|---|---|---|---|
| CropBlock とその子 (F.1) | 満期でない | 常に | age += 2〜5 (ビートルート 0〜1、トーチフラワー 1)。flag 2 |
| PitcherCropBlock | 下半分を探し、育てられる | 常に | +1。下は flag 2、age 3 以上なら上を flag 3 |
| StemBlock (F.2) | age 7 でない | 常に | age += 2〜5 (flag 2)。7 になったら続けて RT 1 回 |
| SweetBerryBushBlock | age < 3 | 常に | +1、flag 2 |
| CocoaBlock | age < 2 | 常に | +1、flag 2 |
| BambooSaplingBlock | 真上が空気で世界の内 | 常に | 竹を 1 段、flag 3 |
| BambooStalkBlock (F.4) | 合計 16 未満ほか | 常に | 1〜2 段、flag 3 |
| GrowingPlantHeadBlock・GrowingPlantBodyBlock (F.5) | 伸びる先が空いている | 常に | 先端を n 段、flag 3 |
| CaveVinesBlock・CaveVinesPlantBlock | berries が偽 | 常に | berries 真、flag 2 |
| SaplingBlock (F.7) | canGrow と高さ | nextFloat < 0.45 | stage 1 (260) か木 |
| MangrovePropaguleBlock | 吊りなら age < 4 | 吊りなら常に、でなければ nextFloat < 0.45 | 吊りは age+1 (flag 2)、それ以外は苗木と同じ |
| AzaleaBlock | 高さと、真上に流体が無い | nextFloat < 0.45 | 木 |
| MangroveLeavesBlock | 真下が空気 | 常に | 真下に吊りの芽 (age 0)、flag 2 |
| MushroomBlock | 巨大キノコの高さが世界に収まる | nextFloat < 0.4 | 自分を removeBlock (flag 3) してから巨大キノコの地物。置けなければ自分を flag 3 で戻す |
| NetherFungusBlock (crimson_fungus・warped_fungus) | 下が対応するナイリウムで、上が世界の内 | nextFloat < 0.4 | 巨大菌の地物 |
| GrassBlock | 真上が空気で世界の内 | 常に | 128 回試す。i 回目は真上から i ÷ 16 歩だけ乱歩し (下が草のブロックでなく、またはその位置がフルブロックなら、その回はやめる)、短い草に当たれば nextFloat < 0.1 でその草に骨粉、空気なら nextFloat < 0.125 でバイオームの花の地物、それ以外は草の地物 |
| NyliumBlock | 真上が空気で世界の内 | 常に | 真上にナイリウムの植生の地物 |
| NetherrackBlock | 真上が空の光を通し、3×3×3 にナイリウムがある | 常に | 周りにある方のナイリウム (両方あれば nextBoolean)、flag 3 |
| BonemealableFeaturePlacerBlock (moss_block・pale_moss_block) | 真上が空気 | 常に | 真上に苔の地物 |
| RootedDirtBlock | 真下が空気で世界の内 | 常に | 真下に hanging_roots、flag 3 |
| TallGrassBlock (short_grass・fern) | 2 段の草が存続でき、真上が空気 | 常に | tall_grass / large_fern の下と上を flag 2 (この順) |
| TallFlowerBlock (sunflower・lilac・rose_bush・peony) | 常に | 常に | 自分のアイテムを 1 個落とす。ブロックは変わらない |
| FlowerBedBlock (pink_petals・wildflowers) | 常に | 常に | 枚数 < 4 なら +1 (flag 2)、4 ならアイテムを落とす |
| BushBlock (bush・red_shrub)・FireflyBushBlock | 水平の隣に置ける空気がある | 常に | 水平 4 方向をシャッフルし (nextInt を 3 回)、最初に置ける隣に自分を flag 3 |
| ShortDryGrassBlock | 常に | 常に | tall_dry_grass に flag 3 |
| TallDryGrassBlock | 水平の隣に short_dry_grass を置ける | 常に | 同じシャッフルで short_dry_grass を flag 3 |
| GlowLichenBlock | どこかの面から広がれる | 常に | 面をシャッフルし、最初に広がれた 1 か所に flag 2 |
| HangingMossBlock (pale_hanging_moss) | 下端の下が空気 | 常に | 下端の下に先端を flag 3 |
| MossyCarpetBlock (pale_moss_carpet) | 土台で、上に載せる形が作れる | 常に | 真上に上段を flag 3 |
| SeaPickleBlock | 死んでおらず、下がサンゴブロック | 常に | 周りの菱形 (13 列 × 2 段) の自分以外の各マスで nextInt(6) を引き、0 で、そこが水で下がサンゴブロックなら 1〜4 個 (nextInt(4) + 1) のシーピクルスを flag 3。最後に自分を 4 個に flag 2 |
| SeagrassBlock | 真上が水のブロック | 常に | 自分を tall_seagrass の下、真上を上に flag 2 (この順) |
| SmallDripleafBlock | 常に | 常に | 上半分を流体のブロックに flag 18 で消し、高さ 2〜5 (Mth#nextInt) の大きなドリップリーフを下から flag 3 で積む |
| BigDripleafBlock | 真上が空気・水・小さなドリップリーフで、世界の内 | 常に | 自分を茎に、真上に新しい葉 (tilt none) を、どちらも flag 3 |
| BigDripleafStemBlock | つながった葉の真上に置ける | 常に | 葉の位置を茎に、その真上に新しい葉を flag 3 |
| ShelfMushroomBlock (26.3 で新設) | age < 1 | 常に | age 1 に flag 2 |

- 大きなドリップリーフ (本文 §4.9) に骨粉を撒くと、葉は 1 段上に tilt none の新しい状態で置き直される。元の位置は茎になるので、傾きの途中の予約 tick は発火のときに種類が違って捨てられる (→ 02) [要実機] G12。
- 地物を置く結果 (木・キノコ・菌・草花・苔・ナイリウムの植生) の形と書き込みは範囲外。
- 有効の判定は、骨粉を減らすかどうかを決める (12 §4.9)。苗木の canGrow のように、有効の判定の中で主乱数を引くものがある。

### F.13 本文が別のメモにあるクラスの成長の側

| クラス | 成長・時間の処理 | 書き込み | 本文 |
|---|---|---|---|
| FarmlandBlock | RT: x・z ±4、y 0〜+1 に水の流体が無く、真上に雨が当たっていなければ、MOISTURE が 1 以上なら 1 減らす。0 なら、真上が maintains_farmland (作物・茎・動くピストン・フェンスゲートほか) でなければ土に戻す (エンティティを押し上げ、BLOCK_CHANGE)。水があるか雨が当たっていれば 7 にする (7 未満のとき)。湿り気は作物の成長の速さ (F.1) に効く | MOISTURE は flag 2、土に戻すのは flag 3 | → 17 (踏みつけ) |
| PointedDripstoneBlock・SulfurSpikeBlock (SpeleothemBlock#randomTick) | 鍾乳石は滴下の抽選 (→ 16 §4.18) のあとで、sulfur_spike は滴下なしで、主乱数の nextFloat < 0.011377778 かつ自分が下向きの根元なら成長を試す。根元の真上が土台 (dripstone_block / sulfur) で、鍾乳石は 2 つ上の流体が水源の水のときだけ。先端を根元から下へ探し (鍾乳石は 6 マス先まで、sulfur_spike は 1 マス先まで)、ぶら下がった先端の下が空気か向かい合う先端なら、nextBoolean で「先端を 1 段伸ばす」か「下 10 マス以内の床に石筍を作るか伸ばす」を選ぶ。届く最長は [要実機] | flag 3 | → 16 §4.17・§4.18 |
| TurtleEggBlock | RT: 環境属性 TURTLE_EGG_HATCH_CHANCE の値 c が 0 より大きく、主乱数の nextFloat < c で (下が砂でなくても先に引く)、下が砂のタグなら、hatch 0〜1 は +1 (flag 2、BLOCK_CHANGE)、hatch 2 なら消えて (removeBlock、BLOCK_DESTROY) 卵の数だけ子ガメを出す | 左のとおり | → 17 §4.20 |
| SeagrassBlock | 骨粉で背の高い海草になる (F.12) | flag 2 | → 16 §4.11 |

[版差 1.21.1] 鍾乳石の成長は「2 つ上が水のブロックの水源」に限られ、水を含んだブロックでは伸びなかった。26.2 以降は流体で判定する。[版差 26.4-pre-1] 伸びる向きの抽選が nextBoolean から nextInt(2) に変わった (確率は同じ、引き方が違う)。

### F.14 火の延焼と TNT (FireBlock・BaseFireBlock・SoulFireBlock)

**状態**: fire は age 0〜15 と north・east・south・west・up (燃える隣に張り付く面)。既定は age 0・面は全部偽。soul_fire はプロパティなしで、延焼も予約も持たない (下が soul_fire_base_blocks の間だけ残る)。どちらも RT を受けない。

**燃えやすさの表 (FireBlock#bootStrap)**: ブロックごとに着火の値 (igniteOdds) と燃焼の値 (burnOdds) を持つ (setFlammable の呼び出し 194 か所。羊毛などはまとめて登録)。水を含んだ状態では両方 0 になる。回路に関わる例を挙げる。

| ブロック | 着火 | 燃焼 |
|---|---|---|
| tnt | 15 | 100 |
| target | 15 | 20 |
| lectern | 30 | 20 |
| 木のフェンスゲート・柵・ハーフ・階段・板材 | 5 | 20 |
| 木のシェルフ (*_shelf) | 30 | 20 |
| composter・beehive | 5 | 20 |
| big_dripleaf (茎も)・small_dripleaf | 60 | 100 |
| 羊毛 | 30 | 60 |
| 丸太 | 5 | 5 |

木のドア・トラップドア・ボタン・感圧板・音符ブロック・チェスト・樽は表に無いので燃えない。

**予約**: 火は置かれたとき (FireBlock#onPlace) と自分の tick の最初に、30 + nextInt(10) gt (30〜39) の予約を積む (優先度 NORMAL。→ 02 §4.9 表 B)。毎回積み直すので、火がある限り 30〜39 gt ごとに tick が走る。

**tick (FireBlock#tick)** — 番号の順に主乱数を引く:

1. 次の予約を積む (nextInt(10))。
2. ServerLevel#canSpreadFireAround が偽なら終わる。ゲームルール fire_spread_radius_around_player (既定 128) が −1 なら常に真。それ以外は、観戦者でないプレイヤーのどれかの位置からこのマスの角までの距離が、値**未満**のときだけ真 (ChunkMap#playerIsCloseEnoughTo)。値が 0 なら必ず偽になる。
3. 存続できなければ (下の上面が頑丈でなく、6 隣に燃えるブロックも無い) removeBlock で消す。**消しても先へ進む**。
4. 下が次元の infiniburn タグ (netherrack・magma_block。ジ・エンドでは bedrock も) なら「燃え続ける」とする。
5. 燃え続けるでなく、雨が降っていて、自分か水平 4 隣に雨が当たり、nextFloat < 0.2 + age × 0.03 なら removeBlock で消えて終わる。
6. 新しい age = min(15, age + nextInt(3) ÷ 2) (1/3 で +1)。変われば flag 260 で書く。
7. 燃え続けるでなければ、次を見る (ここの age は手順 6 の前の値)。
   1. 6 隣に燃えるブロックが無いとき: 下の上面が頑丈でないか age > 3 なら消す。どちらでも終わる (延焼しない)。
   2. age が 15 で nextInt(4) が 0、かつ下が燃えないなら消えて終わる。
8. 環境属性 INCREASED_FIRE_BURNOUT が真の位置なら、補正 −50 を使う。
9. 6 隣を燃やす (下の checkBurnOut)。順は東・西・下・上・北・南。分母は水平 300、上下 250 (補正込み)。燃えないブロックでも 1 回ずつ nextInt を引く。
10. 周りへ飛び火する。x −1〜1 (外側)、z −1〜1、y −1〜4 (内側) の順に、自分以外の 53 マスを見る。
    1. そのマスが空気でなければ飛ばない。空気なら、その 6 隣の着火の値の最大を a とする。a が 0 なら飛ばない。
    2. 分母 r = 100。y が 2 以上なら 100 × (y − 1) を足す (y = 2 で 200、y = 4 で 400)。
    3. 見込み o = (a + 40 + 難易度の番号 × 7) ÷ (age + 30) (整数の割り算。難易度の番号はピースフル 0〜ハード 3)。補正の位置なら o をさらに半分にする。
    4. o > 0 で nextInt(r) ≤ o、かつ「雨が降っていて、そのマスか水平 4 隣に雨が当たる」でなければ、そのマスに火 (age = min(15, age + nextInt(5) ÷ 4)) を **flag 3** で置く。下が魂の火の土台なら魂の火になる (BaseFireBlock#getState)。

**6 隣を燃やす (FireBlock#checkBurnOut)** — 入力は隣の位置・分母 c・自分の age:

1. その隣の燃焼の値 b を読む。nextInt(c) < b でなければ終わる。
2. nextInt(age + 10) < 5 で、その隣に雨が当たっていなければ、そこを火 (age = min(age + nextInt(5) ÷ 4, 15)) に **flag 3** で書く。そうでなければ removeBlock (flag 3) で空気にする。
3. **元のブロックが TNT なら、そのあとで TntBlock#prime を呼ぶ** (点けたエンティティは無し)。ゲームルール tnt_explodes が真なら、TNT の位置に PrimedTnt (導火線 80、向きに nextDouble 1 回) を出し、音と PRIME_FUSE を出す (本文 §4.7)。偽なら何も出ず、**TNT は燃えて消えたまま**になる。

火の横の TNT が 1 回の tick で燃える確率は 100/300 = 1/3、上下なら 100/250 = 2/5 である (燃え尽きやすい位置では 2/5・1/2)。燃えたマスが火になる確率は 5/(age + 10) (age 0 で 1/2)。これは本文 §4.7 の「その他の着火」に加わる経路である。

**形の更新 (FireBlock#updateShape)**: どの向きの PP でも、存続できれば今の age のまま面を取り直す (下が魂の火の土台になれば魂の火に変わる)。存続できなければ空気になる (destroyBlock、flag 3)。オブザーバーは火の面の変化も見る。

**置かれたとき (BaseFireBlock#onPlace)**: 前が同じ火でなければ、オーバーワールドかネザーでポータルの枠の中ならポータルを作って終わる。存続できなければ removeBlock で消す。そのあと FireBlock#onPlace が予約を積む。

**火が出る経路 (参照)**: 火打石と打ち金・ファイヤーチャージ (→ 12 §4.9、本文 §4.7)、溶岩の RT (→ 16)、雷 (→ 17 §4.18)、この節の延焼。

**版差**

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| tick が働く条件 | doFireTick (真偽、既定 真)。プレイヤーとの距離は見ない | fire_spread_radius_around_player | 同 | 同 |
| 燃えた TNT | TntBlock#explode (ルール無しで必ず点火) | TntBlock#prime (tnt_explodes を見る) | 同 | 同 |
| 燃え尽きやすい位置 | バイオームのタグ increased_fire_burnout | 環境属性 INCREASED_FIRE_BURNOUT | 同 | 同 |
| age の書き込み | flag 4 | 260 | 260 | 260 |
| 燃えやすさの表 | 新しいブロックが少ない | poplar が無い | poplar の板材・ハーフ・柵・フェンスゲートほかを追加 | 同 |

1.21.1 の doFireTick 偽は、26.x では値 0 に移される (GameRuleRegistryFix)。

**プローブ**: G9。

### F.15 Rust で実装するときの要点 (付録の範囲)

1. **RT の受け口**: 01 §4.5 の抽選で選ばれた位置に、ブロック種ごとの random_tick を呼ぶ。「RT を受けるか」は状態の関数にする (作物の満期・竹の stage・先端の age 25・葉の distance と persistent・鉢の中身)。セクションの「RT を受けるものを含むか」の判定にも同じ関数を使う。
2. **光・時刻・天気・環境属性を入力に持つ**: 作物・茎・竹・甘い実・ピッチャー・キノコは getRawBrightness、苗木と草は空の暗さを引いた値を読む。光の計算を持たない段階では、位置ごとの「ブロック光と空の光」・時刻 (空の暗さ)・雨を外から与える口を用意し、既定を 15・昼・晴れにする。環境属性 (アイブロッサム・カメの卵・火の燃え尽き) も同じ口から引く。
3. **乱数は主乱数 1 本**: 引く順と回数を各節の手順どおりに再現する (→ 18)。引かない短絡 (暗い作物・h < 11 の竹の nextFloat・o が 0 の飛び火) と、必ず引く所 (ピッチャー・甘い実・火の 6 隣の nextInt) を取り違えない。胴が先端に戻るときの nextInt(25) のように、updateShape の中でも主乱数を引く。
4. **状態は blockstate だけ**: この付録のブロックは BlockEntity を持たない。外の状態はゲームルール (random_tick_speed・spread_vines・fire_spread_radius_around_player・tnt_explodes)・難易度・時刻・天気・プレイヤーの位置 (火) だけである。
5. **地物は境界で切る**: 木・巨大キノコ・菌・草花・苔は、形を持たない「地物の口」にする。呼ぶ契機と前後の書き込み (苗木を 818 で消す・置けなければ 260 で戻す・キノコを消して戻す) だけを再現し、形は空 (= 置けない) を既定にする。
6. **表は生成する**: 燃えやすさの表・支えのタグ・bee_growables・maintains_farmland はコードを写さず、実機のレジストリとタグから書き出して生成する (本文 §7 の 9 と同じ方法)。
7. **フラグは数値のまま**: 2・3・260・818・19 の違い (NC と PP の有無) が、オブザーバー式と BUD 式の収穫機の結果を分ける (→ 04)。サボテンの NC は積んだ状態の neighborChanged を呼ぶが (04 §5.6)、何もしないので更新の件数に数えるだけでよい。
8. **他のメモとの境界**: 書き込みと更新 (04)・存続の予約 (02)・F1 と F3 (05)・骨粉を撒く側 (12)・PrimedTnt とミツバチ (17)・流体と鍾乳石 (16)・乱数 (18)。

### F.16 検証用のプローブ回路案 (付録の範囲)

成長は乱数で決まるので、1 回の結果ではなく分布で照合する。RT の抽選 (01 §4.5) を外すため、random_tick_speed を 0 にし、GameTest の GameTestHelper#randomTick で決めた位置の RT を直接呼ぶ (docs/research/18_ground-truth-oracle.md §3.2 の「tick を手で起こす」)。この補助は isRandomlyTicking を見ずに呼ぶが、各ブロックの randomTick は自分で条件を見る。オブザーバーの発火を数える回路は、RT を 4 gt 以上あけて呼ぶ (パルスが重ならないように)。火は予約 tick なので、fire_spread_radius_around_player を −1 にしてそのまま回す。判定は試行回数 N の二項分布の 95% 区間で行う。

| ID | 目的 | 配置 | 観測と期待の要点 |
|---|---|---|---|
| G1 | 作物の成長の式 | 9×9 の耕地の中央に小麦。条件 (a) 全部湿った・周りに作物なし、(b) 全部湿った・一面小麦、(c) 全部乾いた・周りに作物なし。光 15 | 中央に RT を 3000 回 (age 7 になったら 0 に戻す)。age が上がった割合が (a) 1/3、(b) 1/6、(c) 1/7 |
| G2 | サトウキビの書き込みのフラグ | 砂の上のサトウキビ 1 段と横の水。土台を見るオブザーバー O1、2 段目の位置を見る O2。2 段目の位置の横に BUD のピストン P2、土台の横に P1 | 土台に RT を 16 回。1〜15 回目は O1 だけが発火する (260 は PP だけ)。16 回目に 2 段目が現れて O1・O2 が発火し、P2 だけが伸びる (新しい段の NC)。P1 は最後まで伸びない |
| G3 | サボテンの 26.3 の変化 | 3 段のサボテン (上と横は空気) と、最上段を見るオブザーバー。対照に 1 段のサボテン | 最上段に RT を 16 回、N = 400。花が咲かなければ age が 15 まで進み (発火 15 回)、age 8 の回に花が咲けば age 9 で止まる (発火 9 回)。咲く割合は 3 段で 0.25、1 段で 0.1。1.21.1 では 3 段の最上段は age が進まない (発火 0 回) |
| G4 | 茎の実の向きと NC | age 7 のカボチャの茎。4 方向が空気で下は土。茎の横に BUD のピストン | RT を 1000 回 (実ができたら実を消す。茎は PP で age 7 に戻る)。実の向きが北・東・南・西に 1/4 ずつ。実ができた回にピストンが伸びる (flag 3) |
| G5 | 竹の葉の書き換え | 3 段の竹を下から leaves small・large・large、stage 0 で置く。下 2 段の横に BUD のピストン | 最上段に RT を成功するまで (成功率 1/3)。成功の回に 2 段目が small、1 段目が none になり、両方のピストンが伸びる。4 段目は large |
| G6 | 昆布の刈り取り後の age | 水中に 10 段の昆布。下から 4 段目の上を壊す (ピストンでも /setblock でもよい) | 新しい先端の age を読む。N = 500 で 0〜24 の一様。そのあと RT を与え続けると、25 − age 段 (水面まで) で止まる |
| G7 | 芽吹いたアメジストの向き | 6 面とも空気の budding_amethyst。各面の先を見るオブザーバー | RT を 3000 回。芽が置かれる (か進む) のは全体の 1/5 で、面は 1/6 ずつ。1 回で 1 段だけ進み、そのたびにその面のオブザーバーが発火する |
| G8 | 苗木の段と木の通知 | オークの苗木と、それを見るオブザーバー | RT を成功するまで。stage 0 → 1 で発火 (260)。木になった回の発火が外周の形の確認だけで起きるか [要実機]。26.2 では苗木を消す書き込み (260) でも発火する |
| G9 | 火による TNT の点火 | netherrack の上の火と、その横の TNT。難易度 normal・雨なし | 火の tick ごとに TNT と PrimedTnt を読む。N = 300。1 回の tick で燃える割合 1/3 (上下に置けば 2/5)。燃えた位置が火になる割合は age 0 で 1/2。tnt_explodes を偽にすると TNT は消えるがエンティティは出ない。fire_spread_radius_around_player 0 では何も起きない |
| G10 | 通知の有無 | 鉢のアイブロッサムの横に BUD のピストン。甘い実の茂みの横にスカルクセンサー。対照に小麦の横のセンサー | 時刻を夜にし、鉢に RT を 1 回呼ぶと切り替わり、ピストンが伸びる (flag 3)。茂みの成長でセンサーが周波数 11 で動き、小麦の成長では動かない |
| G11 | 骨粉の増分 | ディスペンサーの前に age 0 の小麦・age 0 のビートルート・age 3 の茎 | 1 回ずつ発射、N = 400。小麦は +2〜+5 が 1/4 ずつ。ビートルートは +0 が 1/4、+1 が 3/4。茎は 7 に達した回だけ、同じ tick に実の判定が走る |
| G12 | 傾いた葉への骨粉 | tilt partial の大きなドリップリーフ (傾きの予約が残っている状態) | 骨粉 1 回。葉が 1 段上に tilt none で置き直され、元の位置は茎になる。残っていた予約の tick に何も起きない |

### F.17 既存資料との食い違い (付録の範囲)

| 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|
| docs/vanilla/01 §4.5 の表 | CactusBlock・SugarCaneBlock・BambooStalkBlock・CropBlock ほかの成長は「→ 08 のオブザーバー」 | 08 にあるのはオブザーバー側 (PP を受けて予約を積む) だけ。成長の規則とフラグはこの付録の F.1〜F.4 | 参照先を「→ 11 付録 F」に直した (仕上げ。00_coverage の O-2) |
| docs/vanilla/12 §4.9 の 4 | 成長が置くブロックとフラグは performBonemeal による (→ 11・16) | 16 に骨粉の結果は無い。全表は F.12 | 参照先を「→ 11 付録 F.12」に直した (仕上げ) |
| docs/vanilla/02 §4.9 表 B | 火: 30〜39 (乱数)・常に・範囲外 | 一致。tick の最初で積み直すので、ゲームルールで止まっていても積み続ける (F.14 の 1・2) | 正しい |
| docs/vanilla/04 §3.1 | 260 は成長 (サトウキビ・サボテン・苗木)・火、818 は苗木の成長 | 一致。818 は苗木を消す書き込みで、置けなかったときの書き戻しは 260 | 正しい |
| docs/vanilla/00_coverage.md の G-2 | 30〜39 gt の予約で 6 隣を燃やし、燃えたマスは火 (flag 3) か空気、TNT なら prime。age は 260 | 一致。加えて、周りの空気 53 マスへの飛び火も flag 3 | 正しい |
| docs/research/18_ground-truth-oracle.md §2.2 の表 | doFireTick false は fire_spread_radius_around_player 0 に写る | GameRuleRegistryFix は doFireTick 偽を 0 に移す。0 では距離「未満」が成り立たず、延焼・燃え尽き・雨で消えることのどれも起きない。予約は積み続け、PP で存続できない火は消える | 正しい。ハーネスの random_tick_speed 0 では成長が一切起きないので、F.16 のプローブは RT を直接呼ぶ |
| packages/sim/src (TS) | 成長・RT・火・TNT の型が無い | — | 未実装。実装するときは F.15 に従う。blockNames.ts の IMMOVABLE_SOLID が budding_amethyst を不動とするのは誤り (POPPED)。05 §9 の 7 で指摘済み |

### F.18 典拠一覧 (付録の範囲、26.3)

- CropBlock#randomTick / #getGrowthSpeed / #growCrops / #getBonemealAgeIncrease / #isRandomlyTicking / #canSurvive / #hasSufficientLight / #isValidBonemealTarget / #performBonemeal、CarrotBlock、PotatoBlock、BeetrootBlock#randomTick / #getBonemealAgeIncrease、TorchflowerCropBlock#getMaxAge / #getStateForAge / #randomTick / #getBonemealAgeIncrease
- PitcherCropBlock#randomTick / #grow / #canGrow / #isRandomlyTicking / #isValidBonemealTarget / #performBonemeal
- StemBlock#randomTick / #isValidBonemealTarget / #performBonemeal、AttachedStemBlock#updateShape
- SugarCaneBlock#randomTick / #canSurvive、CactusBlock#randomTick / #canSurvive、CactusFlowerBlock#mayPlaceOn
- BambooSaplingBlock#randomTick / #updateShape / #growBamboo / #performBonemeal、BambooStalkBlock#randomTick / #growBamboo / #updateShape / #isValidBonemealTarget / #performBonemeal / #getHeightAboveUpToMax / #getHeightBelowUpToMax、BambooLeaves
- GrowingPlantBlock#getStateForPlacement / #canSurvive、GrowingPlantHeadBlock#getStateForPlacement / #randomTick / #getGrowIntoState / #updateShape / #performBonemeal、GrowingPlantBodyBlock#updateShape / #performBonemeal、KelpBlock・KelpPlantBlock・TwistingVinesBlock・WeepingVinesBlock の各定数と #canGrowInto、NetherVines#getBlocksToGrowWhenBonemealed、CaveVinesBlock#getGrowIntoState / #performBonemeal、CaveVinesPlantBlock#performBonemeal、CaveVines#use
- SweetBerryBushBlock#randomTick / #useWithoutItem / #performBonemeal、NetherWartBlock#randomTick、CocoaBlock#randomTick / #canSurvive / #performBonemeal
- SaplingBlock#randomTick / #advanceTree / #isValidBonemealTarget / #isBonemealSuccess、TreeGrower の各定数 / #growTree / #canGrow / #getMinimumHeight / #removeSapling / #resetSaplings / #findTwoByTwoSaplingPos / #hasFlowers、MangrovePropaguleBlock#randomTick / #isValidBonemealTarget / #isBonemealSuccess / #performBonemeal / #getStateForPlacement、AzaleaBlock#isValidBonemealTarget / #isBonemealSuccess / #performBonemeal、levelgen/feature/TreeFeature#place、StructureTemplate#updateShapeAtEdge、WeightedList#getRandom
- BuddingAmethystBlock#randomTick / #canClusterGrowAtState
- ChorusFlowerBlock#randomTick / #placeGrownFlower / #placeDeadFlower / #allNeighborsEmpty / #canSurvive
- SpreadingSnowyBlock#randomTick / #canStayAlive / #canPropagate、SnowyBlock#isSnowySetting、GrassBlock#performBonemeal / #placeBonemealEffect / #stopBonemealSpread、MyceliumBlock、NyliumBlock#randomTick / #performBonemeal、NetherrackBlock#isValidBonemealTarget / #performBonemeal、MushroomBlock#randomTick / #canSpread / #canSurvive / #growMushroom / #isValidBonemealTarget / #isBonemealSuccess、NetherFungusBlock#isValidBonemealTarget / #isBonemealSuccess / #performBonemeal、VineBlock#randomTick / #canSpread / #copyRandomFaces、LeavesBlock#isRandomlyTicking / #randomTick
- FlowerPotBlock#isRandomlyTicking / #randomTick / #opposite、EyeblossomBlock の Type#spawnTransformParticle
- BonemealableBlock (#hasSpreadableNeighbourPos / #findSpreadableNeighbourPos)、BonemealSource、BonemealableFeaturePlacerBlock、F.12 の表の各クラスの #isValidBonemealTarget / #isBonemealSuccess / #performBonemeal、BigDripleafBlock#placeWithRandomHeight / #place、BigDripleafStemBlock#place、DoublePlantBlock#placeAt
- world/item/BoneMealItem#useOn / #growCrop、Bee の受粉の目標 (tick)
- FarmlandBlock#randomTick / #turnToBaseBlock、SpeleothemBlock#randomTick / #growStalactiteOrStalagmiteIfPossible / #findTip / #findBlockVertical / #canTipGrow / #growStalagmiteBelow、PointedDripstoneBlock#randomTick / #canGrow、SulfurSpikeBlock#getMaxGrowthLength、TurtleEggBlock#randomTick / #shouldUpdateHatchLevel、SeagrassBlock#performBonemeal
- FireBlock#tick / #checkBurnOut / #getIgniteOdds / #getBurnOdds / #isValidFireLocation / #canSurvive / #updateShape / #onPlace / #getFireTickDelay / #getStateForPlacement / #bootStrap、BaseFireBlock#getState / #onPlace、SoulFireBlock#updateShape / #canSurviveOnBlock、TntBlock#prime
- ServerLevel#tickChunk / #canSpreadFireAround、ChunkMap#anyPlayerCloseEnoughTo / #playerIsCloseEnoughTo、BlockAndLightGetter#getRawBrightness、LevelReader#getMaxLocalRawBrightness / #isEmptyBlock、Level#setBlock / #neighborChanged、LevelChunk#setBlockState、NeighborUpdater#executeShapeUpdate / #executeUpdate、Mth#nextInt、Util#getRandom / #shuffle、Direction の並び、GameTestHelper#randomTick、GameRules の random_tick_speed / spread_vines / fire_spread_radius_around_player / tnt_explodes、util/datafix/fixes/GameRuleRegistryFix
- データのタグ: supports_crops・grows_crops・supports_stem_crops・supports_stem_fruit・supports_vegetation・substrate_overworld・supports_cocoa・supports_chorus_flower・support_override_cactus_flower・bee_growables・crops・maintains_farmland・overrides_mushroom_light_requirement・flowers・saplings・infiniburn_overworld / nether / end・soul_fire_base_blocks・snow
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の上記クラスと TreeGrower・FireBlock・TntBlock・MushroomBlock・LeavesBlock・SpeleothemBlock・PointedDripstoneBlock を diff -u とメソッド単位で比較
