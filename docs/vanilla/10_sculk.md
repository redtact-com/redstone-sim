# 10. スカルクセンサー・調律型スカルクセンサー・振動 (GameEvent)

基準は Java 版 26.3。デコンパイルを読んで、自分の言葉で書いた。コードの写しは無い。
確かさの印は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] `tools/mc-harness/fixtures/` の実機 fixture が裏づける (この分野の fixture はまだ 1 本も無い。§8 で撮る)
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 …] 版で違う

相の名前は 01_tick-loop.md §2.3 の L 番号を使う (L5 時刻・L6 予約 tick・L10 ブロックイベント・L12 エンティティ・L13 BlockEntity)。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス (net/minecraft/ から) | 読んだ所 | 役割 |
|---|---|---|
| world/level/block/SculkSensorBlock | 全体 | 段階・出力・作動・共鳴・予約 tick |
| world/level/block/CalibratedSculkSensorBlock | 全体 | 向き・背面へ出さない弱い信号・作動 10 tick |
| world/level/block/entity/SculkSensorBlockEntity | 全体 (内側の VibrationUser) | 受け付けの条件・出力の強さ・最後の周波数・保存 |
| world/level/block/entity/CalibratedSculkSensorBlockEntity | 全体 (内側の VibrationUser) | 半径 16・背面の入力で周波数を絞る |
| world/level/block/state/properties/SculkSensorPhase | 全体 | 3 段階の名前 |
| world/level/gameevent/GameEvent | 全体 (Context・ListenerInfo) | GameEvent の一覧と通知半径 |
| world/level/gameevent/GameEventDispatcher | 全体 | 配る範囲と順 |
| world/level/gameevent/EuclideanGameEventListenerRegistry | 全体 | セクションごとのリスナー一覧・届く範囲 |
| world/level/gameevent/GameEventListener・GameEventListenerRegistry・BlockPositionSource・DynamicGameEventListener | 全体 | 配り方の種類・リスナーの位置 |
| world/level/gameevent/vibrations/VibrationSystem | 全体 (Data・Listener・Ticker・User) | 周波数の表・受け付け・遮蔽・移動・到着 |
| world/level/gameevent/vibrations/VibrationSelector・VibrationInfo | 全体 | 候補の選び方・保存形式 |
| world/level/LevelAccessor・server/level/ServerLevel | gameEvent の各形 | 出す位置の決まり方・その場で配ること |
| world/level/chunk/LevelChunk | getListenerRegistry・addAndRegisterBlockEntity・addGameEventListener・removeGameEventListener・setBlockState | リスナーの登録と外し方 |
| world/level/BlockGetter | isBlockInLine・traverseBlocks | 遮蔽の線分の歩き方 |
| world/level/Level | setBlock・destroyBlock・updateNeighbourForOutputSignal・tickBlockEntities | 作動の書き込み・コンパレーター更新・BlockEntity 相 |
| world/level/block/entity/BlockEntity | setChanged | BlockEntity の変化がコンパレーター更新になること |
| data/minecraft/tags の game_event/vibrations・ignore_vibrations_sneaking、block/occludes_vibration_signals・dampens_vibrations・vibration_resonators、item/dampens_vibrations | 全体 | 振動の対象・羊毛・アメジスト |

GameEvent を出す側は world/level/block 配下を grep で全件拾い、回路に効くものを読んだ。
PistonBaseBlock・NoteBlock・LeverBlock・ButtonBlock・BasePressurePlateBlock・TripWireHookBlock・TripWireBlock・DoorBlock・TrapDoorBlock・FenceGateBlock・BellBlock・TntBlock・BigDripleafBlock・ShelfBlock・PotentSulfurBlock・PathBlock・DispenserBlock・DropperBlock・DaylightDetectorBlock・LecternBlock・JukeboxBlockEntity・ContainerOpenersCounter・ComposterBlock・ChiseledBookShelfBlockEntity・BlockItem#place・BucketItem・Block#playerWillDestroy・Block#updateOrDestroy・Level#destroyBlock・SetBlockCommand・FillCommand・ServerExplosion・core/dispenser の振る舞い・Entity の GameEvent である。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick のフェーズ順・入力の位相・/tick freeze・BlockEntity 相の列 | → 01_tick-loop.md |
| 予約 tick の照合・重複の除去・優先度 | → 02_scheduled-ticks.md |
| ピストン・音符ブロック・ベルのブロックイベントの待ち行列 | → 03_block-events.md |
| setBlock のフラグ・近隣更新の順・形状更新・コンパレーター更新・destroyBlock | → 04_set-block-and-updates.md |
| 弱い信号・強い信号・導体の判定 | → 05_signals-and-block-properties.md |
| コンパレーターがアナログ値を読む規則 | → 07_diodes.md |
| レバー・ボタン・感圧板・トリップワイヤー・書見台・日照センサーの内部 | → 09_manual-inputs.md |
| 扉・トラップドア・フェンスゲート・音符ブロック・ベル・TNT・大きなドリップリーフ・棚の内部 | → 11_outputs.md |
| ディスペンサーの振る舞いの中身 | → 12_dispenser-dropper-crafter.md |
| 押す構造・押しつぶし・moving_piston | → 13_pistons.md |
| チェストの開閉・コンポスター・模様入りの本棚・ジュークボックス | → 14_containers-hoppers-analog.md |
| 水浸しの水の予約・バケツ | → 16_fluids-falling-blocks.md |
| 歩行・着地・泳ぎ・投射物などエンティティの GameEvent、ウォーデン・アレイ | → 17_entities-interplay.md (アレイは付録 A.2。ウォーデンはどのメモも扱わない) |
| BlockEntity の順・乱数・浮動小数の意味論 | → 18_determinism-java-semantics.md |
| 版差のまとめ・fixture の有効性 | → 19_version-diffs.md |

スカルクシュリーカー・スカルクカタリスト・ウォーデン・アレイも同じ振動の仕組みを使う。レッドストーンの信号を出さないので、ここでは扱わない。

---

## 2. 全体像

### 2.1 流れ

[26.3 読解: GameEventDispatcher#post, VibrationSystem.Listener#handleGameEvent, VibrationSystem.Ticker#tick, SculkSensorBlock#activate]

1. ブロックやエンティティが GameEvent を出す。出す所はクラスごとに決まっている。setBlock そのものは何も出さない。位置はブロックなら中心、エンティティなら足元である。
2. GameEventDispatcher#post がその場で配る。待ち行列は無い。届くかは、センサーの半径 (普通 8・調律型 16) と整数ブロックの距離で決まる。
3. センサーは受け付けの条件 (§4.4) を見る。通ったら選択器に候補として入れる。この時点ではブロックも出力も変わらない。
4. 次の tick 以降の L13 で、センサーが候補を 1 件選んで「移動中」にする。移動には floor(距離) tick かかる。最低でも 1 tick である。
5. 届いた L13 で ACTIVE になる。power を距離から決め、30 tick (調律型 10) 後の予約 tick を入れ、自分と真下に近隣更新を出す。隣のアメジストからは共鳴の GameEvent が出る。
6. その予約 tick (L6) で COOLDOWN・power 0 になる。さらに 10 tick 後の L6 で INACTIVE に戻る。
7. 受け付けるのは、INACTIVE で、しかも移動中の振動が無いときだけである。聞けなかった GameEvent は捨てられ、後から拾われない。

### 2.2 時間の流れ

GameEvent が gameTime N のときに出たとする。tick N の中で出ても、tick N と N+1 の間 (プレイヤーの操作・コマンド) で出ても N である (→ 01 §2.4)。距離を d、k = floor(d) とする。

| tick | 相 | 起きること |
|---|---|---|
| N | 出た場 | 候補に入る (時刻 N) |
| N+1 | L13 | 候補が選ばれ移動中になる。残り k。すぐ 1 減らし、0 以下なら届く |
| A = N + max(1, k) | L13 | 届く。ACTIVE・power=p。予約 tick を入れる |
| A+30 (調律型 A+10) | L6 | COOLDOWN・power 0 |
| A+40 (調律型 A+20) | L6 | INACTIVE。これより後に出た GameEvent を受け付ける |

### 2.3 段階

| 段階 | power | GameEvent を受け付けるか | コンパレーター | 次の段階へ |
|---|---|---|---|---|
| inactive | 0 | 受け付ける (移動中の振動が無いとき) | 0 | 振動が届いた L13 で active |
| active | 1〜15 | 受け付けない | 最後の周波数 (1〜15) | 30 tick (調律型 10) 後の L6 で cooldown |
| cooldown | 0 | 受け付けない | 0 | 10 tick 後の L6 で inactive |

---

## 3. 状態とデータ

### 3.1 blockstate

| プロパティ | 値 | 既定 | メモ |
|---|---|---|---|
| sculk_sensor_phase | inactive / active / cooldown | inactive | SculkSensorPhase |
| power | 0〜15 | 0 | 出力の強さ。active の間だけ 0 でない |
| waterlogged | true / false | false | 置いた位置が水源なら真 (SculkSensorBlock#getStateForPlacement)。真なら音を鳴らさない。乱数も引かない |
| facing (調律型だけ) | north / south / west / east | north | 置いた人の向き。入力は facing の反対側の隣 |

### 3.2 BlockEntity に持つ値

[26.3 読解: SculkSensorBlockEntity#loadAdditional・#saveAdditional, VibrationSystem.Data・VibrationSelector・VibrationInfo の CODEC]

| NBT のキー | 型 | 意味 |
|---|---|---|
| last_vibration_frequency | int (既定 0) | 最後に作動したときの周波数。cooldown・inactive でも消えない |
| listener.event | VibrationInfo (無いことがある) | 移動中の振動 |
| listener.event_delay | int (0 以上) | 移動の残り tick |
| listener.selector.event | VibrationInfo (無いことがある) | 選ばれ待ちの候補 |
| listener.selector.tick | long | 候補が入った gameTime。空なら -1 |

VibrationInfo は game_event (ID)・distance (float、0 以上)・pos (double 3 つ)・source (UUID)・projectile_owner (UUID) を持つ。後ろ 2 つは無いことがある。エンティティそのものへの参照は保存しない。読み込んだ後は UUID で引き直す。

読み込み直後はパーティクルを送り直す印が立つ。見た目だけで、挙動には効かない。

### 3.3 定数

| 名前 | 値 | 典拠 |
|---|---|---|
| 作動の長さ | 30 tick。調律型は 10 tick | SculkSensorBlock#getActiveTicks, CalibratedSculkSensorBlock#getActiveTicks |
| 休止の長さ | 10 tick (両方) | SculkSensorBlock#deactivate |
| リスナー半径 | 8。調律型は 16 | SculkSensorBlockEntity.VibrationUser#getListenerRadius ほか |
| 通知半径 | 16。jukebox_play・jukebox_stop_play は 10、shriek は 32 | GameEvent の登録 |
| 予約 tick の優先度 | NORMAL (0) | 遅延だけを渡す scheduleTick |
| 出力の強さ | max(1, 15 − floor((15 ÷ 半径) × 距離)) | VibrationSystem#getRedstoneStrengthForDistance |
| 移動の tick | floor(距離) | VibrationSystem.User#calculateTravelTimeInTicks (センサーは既定のまま) |
| 遮蔽の線分 | 6 本。始点を各方向へ 1.0E-5 (float) ずらす | VibrationSystem.Listener#isOccluded |
| 共鳴する隣 | amethyst_block だけ | vibration_resonators タグ |

### 3.4 ブロックの性質

[26.3 読解: SculkSensorBlock, Blocks の SCULK_SENSOR・CALIBRATED_SCULK_SENSOR, PistonBaseBlock#isPushable]

| 性質 | 値 |
|---|---|
| isSignalSource | 真。ダストは横から繋がる (調律型の背面にも繋がる) |
| 導体 | 偽。高さ 8/16 の形で、全面ブロックでない |
| hasAnalogOutputSignal | 真 |
| ピストン | 押せない・引けない (BlockEntity を持つ) |
| 明るさ | 1 (段階によらない) |
| 調律型 | ofLegacyCopy で普通と同じ性質を写す |

### 3.5 周波数

[26.3 読解: VibrationSystem の VIBRATION_FREQUENCY_FOR_EVENT, GameEvent の登録]

| 周波数 | GameEvent |
|---|---|
| 1 | step・swim・flap |
| 2 | projectile_land・hit_ground・splash・bounce |
| 3 | item_interact_finish・projectile_shoot・instrument_play |
| 4 | entity_action・elytra_glide・unequip |
| 5 | entity_dismount・equip |
| 6 | entity_interact・shear・entity_mount |
| 7 | entity_damage |
| 8 | drink・eat |
| 9 | container_close・block_close・block_deactivate・block_detach |
| 10 | container_open・block_open・block_activate・block_attach・prime_fuse・note_block_play |
| 11 | block_change |
| 12 | block_destroy・fluid_pickup |
| 13 | block_place・fluid_place |
| 14 | entity_place・lightning_strike・teleport |
| 15 | entity_die・explode |
| n | resonate_n (n = 1〜15) |
| 0 (振動でない) | item_interact_start・jukebox_play・jukebox_stop_play・sculk_sensor_tendrils_clicking・shriek |

26.3 の GameEvent は 61 件ある。vibrations タグの 56 件はすべて周波数を持ち、周波数を持つものはすべてタグに入る。タグに入らないのは周波数 0 の 5 件だけである (タグと表を突き合わせた)。

### 3.6 タグ

| タグ | 中身 (26.3) | 使い道 |
|---|---|---|
| game_event/vibrations | §3.5 の 1〜15 の全件 | センサーが聞く GameEvent |
| game_event/ignore_vibrations_sneaking | hit_ground・projectile_shoot・step・swim・item_interact_start・item_interact_finish | 発生元がスニーク中なら聞かない |
| block/occludes_vibration_signals | #wool (羊毛 16 色) | 線分を遮る |
| block/dampens_vibrations | #wool・#wool_carpets・#wool_slabs・#wool_stairs | 影響を受けた状態がこれなら聞かない |
| block/vibration_resonators | amethyst_block | 作動したセンサーの隣で共鳴する |
| item/dampens_vibrations | ブロックのタグと同じ 4 つ | このアイテムのアイテムエンティティが発生元なら聞かない |

---

## 4. 処理の詳細

### 4.1 GameEvent を出す

[26.3 読解: LevelAccessor#gameEvent, Entity#gameEvent, ServerLevel#gameEvent, GameEventDispatcher#post・#handleGameEventMessagesInQueue]

1. ブロック位置を渡す形は、ブロックの中心 (各座標 + 0.5) に直してから出す。ブロックの発生源はほぼこの形である。
2. Entity#gameEvent はエンティティの position (足元) を位置にする。発生元は渡したエンティティで、省けばそのエンティティ自身である。
3. キーで渡す形は、レジストリから引いてから出す。共鳴がこの形である。
4. ServerLevel#gameEvent は GameEventDispatcher#post をその場で呼ぶ。出した相のまま、呼んだ順に配られる。
5. post は位置を整数ブロックにし、通知半径 r で各軸 (座標 − r) >> 4 〜 (座標 + r) >> 4 のセクションを選ぶ。
6. 走査はチャンク x の昇順 → チャンク z の昇順 → セクション y の昇順である。読み込まれていないチャンクは飛ばす。
7. 各セクションのリスナー一覧を登録順に見て、届くもの (§4.3) に配る。配り方が BY_DISTANCE のものだけは貯めておき、走査が終わってから距離の 2 乗で安定に並べて配る。
8. BY_DISTANCE はスカルクカタリストだけである。センサーは UNSPECIFIED で、見つけた順にその場で配られる。
9. センサーは自分の選択器しか触らない。だから配る順はセンサーの結果に効かない。

### 4.2 リスナーの登録

[26.3 読解: LevelChunk#addAndRegisterBlockEntity・#addGameEventListener・#removeGameEventListener・#getListenerRegistry, EntityBlock#getListener, EuclideanGameEventListenerRegistry#register・#unregister・#visitInRangeListeners]

1. センサーの BlockEntity がチャンクに入ると (設置・チャンクの読み込み)、ブロックのある y のセクションの一覧の末尾に足される。BlockEntity の ticker も同時に登録される (→ 01 §4.7)。
2. BlockEntity が外れると (破壊・別のブロックへの置き換え)、一覧から外れる。移動中の振動と候補も一緒に消える。
3. 配っている最中に足したものは、その一覧を配り終えてから末尾に入る。外したものは、まだ順番が来ていなければその回から飛ばされ、配り終えてから一覧から消える。センサーの handleGameEvent は世界を書き換えないので、センサーだけならこの差は出ない。
4. 同じブロックのままの状態の変化 (段階・power) では BlockEntity は残り、一覧もそのままである。
5. センサーの位置は BlockPositionSource で、常にブロックの中心である。

### 4.3 届く範囲

[26.3 読解: EuclideanGameEventListenerRegistry#getPostableListenerPosition]

1. センサーの位置と発生位置を、それぞれ整数ブロックにする。
2. 差の 2 乗和が半径の 2 乗 (普通 64・調律型 256) 以下なら届く。超えたら届かない。
3. 範囲は球で、立方体ではない。差 (7, 4, 0) は 65 なので普通のセンサーに届かない。差 (8, 0, 0) は 64 で届く。
4. 通知半径は走査するセクションを決めるだけである。センサーの半径は 16 以下なので、取りこぼしは無い。

### 4.4 受け付けの判定

[26.3 読解: VibrationSystem.Listener#handleGameEvent]

上から順に見る。外れたら、その GameEvent はこのセンサーにとって捨てられる。

1. 移動中の振動がある → 捨てる。
2. isValidVibration が偽 → 捨てる (§4.4.1)。
3. canReceiveVibration が偽 → 捨てる (§4.4.2)。発生位置は整数ブロックにして渡す。
4. 遮られている → 捨てる (§4.4.3)。
5. 通ったら候補を作り、選択器に渡す (§4.5)。候補の距離は、発生位置 (Vec3) とセンサーの中心の距離を double で求めて float にしたもの。時刻はその時の gameTime である。

#### 4.4.1 発生元と影響の判定 (VibrationSystem.User#isValidVibration)

1. GameEvent が vibrations タグに無い → 偽。
2. 発生元のエンティティがあるとき:
   1. 観戦者 → 偽。
   2. スニーク中 (Entity#isSteppingCarefully) で、GameEvent が ignore_vibrations_sneaking タグにある → 偽。センサーはこのとき実績 avoid_vibration の判定を出す。
   3. Entity#dampensVibrations が真 → 偽。真になるのはウォーデンと、アイテムが item の dampens_vibrations タグのアイテムエンティティである。
3. 影響を受けた状態 (GameEvent.Context の affectedState) が block の dampens_vibrations タグにある → 偽。
4. ほかは真。

レッドストーン部品が出す GameEvent は、発生元がプレイヤーか無しで、影響を受けた状態もピストン・ディスペンサー程度である。だから回路では 3 の羊毛の判定はほぼ効かない。効くのは §4.4.3 の遮蔽である。例外は羊毛やカーペットそのものが壊れたり置かれたりする場合である。

#### 4.4.2 センサーの判定 (VibrationUser#canReceiveVibration)

普通のセンサー [26.3 読解: SculkSensorBlockEntity.VibrationUser#canReceiveVibration]

1. 発生位置が自分の位置と同じで、GameEvent が block_destroy か block_place なら偽。自分が置かれたこと・壊されることは聞かない。
2. GameEvent の周波数が 0 なら偽。
3. 段階が inactive なら真、ほかは偽。

調律型 [26.3 読解: CalibratedSculkSensorBlockEntity.VibrationUser#canReceiveVibration・#getBackSignal]

1. 背面の入力 c を読む。背面は facing の反対側の隣である。その隣がセンサーの向きへ出す信号を SignalGetter#getSignal で読む。隣が導体なら、その導体へ向かう強い信号の最大 (getDirectSignalTo) も含む (→ 05)。ダストの計算の外なので、ダストの getDirectSignal も値を返す。ダストで弱充電された導体も入力になる (ランプと同じ読み方。§5 の 13)。
2. c が 0 でなく、GameEvent の周波数が c と違えば偽。
3. ほかは普通のセンサーと同じ判定をする。

この判定は GameEvent が出た瞬間に 1 回だけ行う。届いたときにはもう見ない (§5 の 12)。

#### 4.4.3 遮蔽 (VibrationSystem.Listener#isOccluded)

[26.3 読解: VibrationSystem.Listener#isOccluded, BlockGetter#isBlockInLine・#traverseBlocks]

1. 発生位置とセンサーの位置を整数ブロックにし、両方のブロックの中心を結ぶ。
2. 始点だけを 6 方向 (DOWN・UP・NORTH・SOUTH・WEST・EAST) へ 1.0E-5 ずつずらし、6 本の線分を作る。
3. 1 本ずつ、線分が通るブロックを始点のブロックから終点のブロックまで順に調べる。occludes_vibration_signals タグ (羊毛) の状態があれば、その線分は当たりである。形は見ない。
4. 当たらない線分が 1 本でもあれば、遮られていない。6 本とも当たったときだけ遮られている。
5. 歩き方は 3 次元の DDA である。両端を長さの 1e-7 倍だけ外へ延ばす。2 つ以上の境界を同時にまたぐときは z → y → x の順に進む。
6. 始点のブロックと終点のブロックも調べる対象に入る。

例。発生位置を (0,0,0) とし、y はすべて同じ。

| センサー | 羊毛 | 結果 | 理由 |
|---|---|---|---|
| (4,0,0) | (2,0,0) | 遮る | 6 本ともまっすぐ羊毛を通る |
| (2,0,2) | (1,0,1) | 遮る | 斜めの線は (1,0,1) の中を通る |
| (2,0,2) | (1,0,0) と (0,0,1) | 遮る | 線は 4 ブロックが接する辺を通る。どの線分もどちらかの羊毛へ入る |
| (2,0,2) | (1,0,0) だけ | 遮らない | (0,0,1) 側へ抜ける線分がある |
| (3,0,0) | カーペット (1,0,0) | 遮らない | カーペットは遮るタグに無い |

斜め 45 度のように、中心同士の線がブロックの辺や角をちょうど通る配置では、ずらした 6 本が辺の両側に分かれる。だから辺の片側だけの羊毛では塞げない。

### 4.5 候補の選び方

[26.3 読解: VibrationSelector#addCandidate・#shouldReplaceVibration・#chosenCandidate・#startOver]

選択器は (候補, 入った gameTime) を 1 組だけ持つ。

1. 空なら入れる。
2. 入っている候補と gameTime が違えば、新しい方を捨てる。先に入った tick が勝つ。
3. gameTime が同じなら距離 (float) を比べる。新しい方が短ければ入れ替え、長ければ捨てる。
4. 距離がまったく同じなら、新しい方の周波数が大きいときだけ入れ替える。同じなら先の方を残す。
5. 選ぶ (chosenCandidate) のは「入った gameTime < 今の gameTime」のときだけである。だから入った tick のうちには選ばれない。
6. 選んだら空にする (startOver)。

まとめると「一番早い tick → その tick の中で一番近い → 同じ距離なら周波数の大きい方 → それも同じなら先に来た方」である。

### 4.6 BlockEntity 相の処理

[26.3 読解: SculkSensorBlock#getTicker, CalibratedSculkSensorBlock#getTicker, VibrationSystem.Ticker#tick・#trySelectAndScheduleVibration・#receiveVibration・#areAdjacentChunksTicking]

センサーの ticker はサーバでだけ動く。毎 tick の L13 で、BlockEntity の登録順に呼ばれる (→ 01 §4.7)。1 回の呼び出しで次を行う。

1. 移動中の振動が無ければ、選択器から選ぶ (§4.5 の 5)。選べたら移動中にし、残りを floor(距離) にする。パーティクルを送り、onDataChanged を呼び、選択器を空にする。
2. 続けて、移動中の振動があれば (1 で選んだ直後も含む。else ではない):
   1. 「残り > 0」を変化の印として覚える。
   2. 残りを 1 減らす (0 より下げない)。
   3. 残りが 0 以下なら届ける (receiveVibration)。変化の印はその戻り値で上書きする。
   4. 変化の印が真なら onDataChanged を呼ぶ。

receiveVibration は次の順に進む。

1. 発生位置とセンサーの位置を、それぞれ整数ブロックにする。
2. センサーのチャンクを中心とする 3×3 のチャンクが、すべて読み込み済みでブロック tick 中かを見る。違えば何もせず偽を返す。振動は残り、次の tick にまた試す。
3. VibrationUser#onReceiveVibration を呼ぶ (§4.7)。渡す距離は、2 つの整数位置の距離を float にしたものである。
4. 移動中の振動を消し、真を返す。

onDataChanged は BlockEntity#setChanged である。これが Level#updateNeighbourForOutputSignal を呼ぶ。水平 4 方向の隣のコンパレーターと、導体 1 枚越しのコンパレーターに neighborChanged が届く (→ 04)。

| その tick に起きたこと | setChanged の回数 |
|---|---|
| 選んだが届かない | 2 |
| 選んだ tick に届いた | 2 |
| 移動中 (届かない) | 1 |
| 届いた (選んだ tick とは別) | 1 |
| 残り 0 だが届けられない (チャンクの条件) | 0 |

### 4.7 作動

[26.3 読解: SculkSensorBlockEntity.VibrationUser#onReceiveVibration, SculkSensorBlock#activate・#updateNeighbours, VibrationSystem#getRedstoneStrengthForDistance]

onReceiveVibration は次の順に進む。

1. 段階が inactive でなければ何もしない。振動は消える。
2. 周波数を last_vibration_frequency に書く。
3. 出力 p = max(1, 15 − floor((15.0 ÷ 半径) × 距離)) を求める。半径は普通 8・調律型 16。距離は §4.6 の整数位置の距離である。
4. SculkSensorBlock#activate を呼ぶ。

activate の書く順が要点である。

1. フラグ 3 で phase=active・power=p を書く。自分の 6 方向への近隣更新 (元のブロックを発生源に)、コンパレーター更新、形状更新が出る (→ 04)。
2. 自分の位置に予約 tick を入れる。遅延は普通 30・調律型 10、優先度は NORMAL である。
3. 自分の位置で近隣更新を出し、続けて真下の位置で近隣更新を出す (SculkSensorBlock#updateNeighbours)。Orientation は無い。実験の評価器では乱数の Orientation になる (→ 04)。
4. 隣のアメジストに共鳴を出す (§4.8)。
5. 自分の位置に sculk_sensor_tendrils_clicking を出す。振動ではないので、ほかのセンサーは聞かない。
6. 水浸しでなければ音を鳴らす。音程のためにワールド乱数の float を 1 個引く。

Ticker に戻ると、移動中の振動を消し、もう一度コンパレーター更新を出す (§4.6)。

出力の強さの表。d² は整数位置の差の 2 乗和である。

| p | 普通 (半径 8) の d² | 調律型 (半径 16) の d² |
|---|---|---|
| 15 | 0 | 0〜1 |
| 14 | 1 | 2〜4 |
| 13 | 2 | 5〜10 |
| 12 | 3〜4 | 11〜18 |
| 11 | 5〜6 | 19〜27 |
| 10 | 8〜10 | 29〜40 |
| 9 | 11〜13 | 41〜54 |
| 8 | 14〜18 | 56〜72 |
| 7 | 19〜22 | 73〜91 |
| 6 | 24〜27 | 93〜113 |
| 5 | 29〜34 | 114〜137 |
| 4 | 35〜40 | 138〜163 |
| 3 | 41〜48 | 164〜192 |
| 2 | 49〜54 | 193〜222 |
| 1 | 56〜64 | 224〜256 |

3 つの平方数の和にならない d² (7・15・23・28 …) は表に現れない。境界はどれも float の丸めに当たらない (平方根が境界にちょうど乗るのは d² = 64 と 256 だけで、どちらも正確に表せる)。
軸の上なら、普通は d 離れで 16 − 2d (d = 1〜7)、8 離れで 1 である。調律型は 16 − d (d = 1〜15)、16 離れで 1 である。

### 4.8 アメジストの共鳴

[26.3 読解: SculkSensorBlock#tryResonateVibration, VibrationSystem#getResonanceEventByFrequency]

1. 6 方向の隣を DOWN・UP・NORTH・SOUTH・WEST・EAST の順に見る。
2. vibration_resonators タグ (amethyst_block だけ) なら、その隣の位置に resonate_f を出す。f は受けた周波数である。文脈は (元の発生元のエンティティ, アメジストの状態) である。音も鳴らすが、音程は周波数の表で決まり、乱数は引かない。
3. resonate_f の周波数は f である。だから共鳴を聞いたセンサーのコンパレーターも f を出す。周波数がそのまま中継される。
4. 共鳴は ACTIVE を書いた後に出る。出した本人は聞かない。
5. 範囲・距離・遮蔽はアメジストの中心から測る。
6. 共鳴は L13 で出る。聞いたセンサーは次の tick に選ぶので、中継 1 段の遅れは max(1, floor(アメジストからの距離)) tick である。

budding_amethyst・アメジストの芽は共鳴しない。

### 4.9 作動の終わりと休止

[26.3 読解: SculkSensorBlock#tick・#deactivate]

予約 tick (L6) で段階を見る。

1. active: phase=cooldown・power=0 をフラグ 3 で書く。予約 tick 10 (NORMAL) を入れる。自分と真下に近隣更新を出す。
2. cooldown: phase=inactive をフラグ 3 で書く。水浸しでなければ音を鳴らし、乱数の float を 1 個引く。自分と真下への追加の近隣更新は出さない。フラグ 3 の近隣更新だけである。
3. inactive: 何もしない。

### 4.10 出力

[26.3 読解: SculkSensorBlock#isSignalSource・#ownSignal・#getDirectSignal・#getAnalogOutputSignal, CalibratedSculkSensorBlock#getSignal, BlockBehaviour#getSignal]

「問いの向き」は、問う側からセンサーへ向かう向きである (→ 05)。

| 問い | 普通 | 調律型 |
|---|---|---|
| 弱い信号 (getSignal) | 6 方向とも power | 問いの向きが facing と同じなら 0。ほかは power |
| 強い信号 (getDirectSignal) | 問いの向きが UP なら power、ほかは 0 | 同じ |
| コンパレーター (getAnalogOutputSignal) | active なら last_vibration_frequency、ほかは 0 | 同じ |

1. 強い信号を受けるのは真下の相手だけである。真下が導体なら強く充電され、その隣のダストやリピーターにも届く。
2. 調律型が弱い信号を出さないのは、facing の反対側の隣 (背面の入力の側) だけである。
3. コンパレーターは信号の強さでなく周波数を読む。読めるのは active の間だけで、cooldown では 0 になる。
4. 26.x の getAnalogOutputSignal は向きを受け取るが、センサーは向きを見ない。

### 4.11 設置・除去・踏まれたとき

[26.3 読解: SculkSensorBlock#onPlace・#affectNeighborsAfterRemoval・#updateShape・#stepOn, VibrationSystem.Listener#forceScheduleVibration, LevelChunk#setBlockState, ServerLevel#updateNeighboursOnBlockSet, Entity#applyEffectsFromBlocks・#getOnPos]

1. onPlace: 別のブロックから置き換わったとき、power > 0 で自分の予約 tick が無ければ、power=0 をフラグ 18 (2+16) で書く。近隣更新も形状更新も出さない。段階は変えない。フラグ 512 を含む書き込み (strict の /setblock など) では onPlace そのものが呼ばれない (LevelChunk#setBlockState)。
2. affectNeighborsAfterRemoval: 消えるときに active なら、自分と真下に近隣更新を出す。26.x で呼ばれるのは、ブロックが変わる書き込みのうち、フラグ 1 を含むもの・ピストンによるもの (LevelChunk#setBlockState) と、strict でない /setblock・/fill・/clone (ServerLevel#updateNeighboursOnBlockSet) である (→ 04)。
3. updateShape: 水浸しなら水の予約 tick を入れる (→ 16)。振動には関係しない。
4. stepOn: 地面に乗っているエンティティが、自分の tick の中で毎 tick 呼ぶ (普通のエンティティは L12。プレイヤーの位相は → 01・17)。センサーが inactive・相手がウォーデンでない・step での canReceiveVibration が真、のとき候補を直接入れる (forceScheduleVibration)。
   - isValidVibration を通らない。スニークでも反応し、羊毛の判定も無い。
   - 遮蔽も、移動中の振動があるかも見ない。
   - 距離はエンティティの位置からセンサーの中心までである。中心がセンサーの真上なら整数位置は同じで power 15 になる。
   - 乗っているブロックは Entity#getOnPosLegacy で決まり、支えのブロック (mainSupportingBlockPos) の列を使う。縁に乗って中心が隣の列にあると整数位置が 1 ずれ、普通のセンサーは 14、調律型は 15 になる [要実機] (→ 17)。
   - 詳しくは → 17_entities-interplay.md。
5. ピストンでは動かない (BlockEntity を持つ → 13)。

### 4.12 どのブロックが何を出すか

[26.3 読解: 各クラス (§10)。world/level/block 配下の gameEvent 呼び出しを全件 grep した]

回路で効くものを並べる。「相」は普段の回路で出る所である。「出た場」は、その部品の neighborChanged が走った相 (L6・L10・L13・入力のどれでもありうる) を指す。

| 発生源 | 契機 | GameEvent (周波数) | 位置 | 文脈 | 相 | 担当 |
|---|---|---|---|---|---|---|
| ピストン・粘着ピストン | 伸長に成功した (押せないと出ない) | block_activate (10) | 本体 | 影響=伸びた本体 | L10 | 13 |
| 同 | 収縮した (収縮のイベントが来た時にまた受電していて、伸びたままに戻したときは出ない) | block_deactivate (9) | 本体 | 影響=moving_piston | L10 | 13 |
| 同 | 動かす塊の行く手の DESTROY のブロックを壊した (伸長でも、粘着ピストンが引くときでも) | block_destroy (12) | 壊れた位置 | 影響=壊れた状態 | L10 | 13 |
| 音符ブロック | 受電の立ち上がり。真上が空気か頭のときだけ | note_block_play (10) | 本体 | 無し | 出た場 (ブロックイベントを積んだ直後、POWERED を書く前) | 11 |
| 同 | プレイヤーが音程を変える・叩く | note_block_play (10) | 本体 | 発生元=プレイヤー | 入力 | 11 |
| 扉 | 受電の変化で OPEN が変わる | block_open (10) / block_close (9) | 更新を先に受けた半分 | 無し | 出た場 | 11 |
| 同 | 手で開け閉めする / ウィンドチャージ (受電していない扉の下の半分だけが反応する) | 同 | クリックした半分 / 下の半分 | プレイヤー / 無し | 入力 / L12 | 11 |
| トラップドア・フェンスゲート | 受電の変化で OPEN が変わる・手・ウィンドチャージ | 同 | 本体 | 無し / プレイヤー | 出た場 | 11 |
| ベル | 受電の立ち上がり・手・投射物 | block_change (11) | 本体 | 無し / 鳴らした者 | 出た場 | 11 |
| TNT | 着火 (受電・受電中への設置・火打石ほか) | prime_fuse (10) | 本体 | 着火した者 | 出た場 | 11 |
| 大きなドリップリーフ | 傾きが変わる (unstable へ変わるときを除く)。受電で none に戻るときも | block_change (11) | 本体 | 無し | L6 / 出た場 | 11 |
| 棚 (shelf) | 受電が変わる | block_activate (10) / block_deactivate (9) | 本体 | 影響=新しい状態 | 出た場 | 11 |
| レバー | 切り替え (手・ウィンドチャージ) | 入れば block_activate (10)、切れれば block_deactivate (9) | 本体 | 無し (手で倒しても LeverBlock#useWithoutItem は発生元を渡さない。1.21.1 も同じ) | 入力 | 09 |
| ボタン | 押す (手・ウィンドチャージ・矢) / 戻る | block_activate (10) / block_deactivate (9) | 本体 | プレイヤー・矢 (ウィンドチャージは無し) / 無し | 入力・L12 / L6 | 09 |
| トリップワイヤー (糸) | ハサミで切る | shear (6) を出してから block_destroy (12) | 本体 | プレイヤー | 入力 | 09 |
| 感圧板 | 0 → 正、正 → 0 の変化だけ (重量式の途中の値では出ない) | block_activate (10) / block_deactivate (9) | 本体 | 乗った者 / 無し | L12 / L6 | 09 |
| トリップワイヤーフック | 受電が変わる。受電が同じで接続が変わる | activate・deactivate (10・9)、attach・detach (10・9) | 本体 | 無し | 状態を計算した場 | 09 |
| 日照センサー | プレイヤーが反転する | block_change (11) | 本体 | プレイヤー | 入力 | 09 |
| 書見台 | 本を置く・取る (ページ送りでは出ない) | block_change (11) | 本体 | 置いた者 / 取るときは無し | 入力 | 09 |
| ディスペンサー | 空で発射しようとした | block_activate (10) | 本体 | 影響=ディスペンサー | L6 | 12 |
| 同 | 中身の振る舞い。TNT は entity_place (14)、水・溶岩のバケツは fluid_place (13)、空のバケツは fluid_pickup (12)、シュルカーボックスは block_place (13)、ハサミは shear (6) など。ウィザースケルトンの頭とくり抜いたカボチャは、ウィザー・ゴーレムが組み上がるときだけ置いて block_place を出す | 左のとおり | 対象 (ガラス瓶の fluid_pickup とスポーンエッグの entity_place はディスペンサー自身) | 無し | L6 | 12 |
| チェスト・トラップチェスト・樽・シュルカーボックス | 開いている人数が 0 → 正、正 → 0 | container_open (10) / container_close (9) | 本体 | 開け閉めした者。見回り (ContainerOpenersCounter#recheckOpeners) で数え直したときは無し | 入力 / L6 | 14 |
| コンポスター | 層が増える・空になる (ホッパー経由も) | block_change (11) | 本体 | 入れた者 / 無し | 入力 / L13 | 14 |
| 模様入りの本棚・ジュークボックス | 中身が変わる (ホッパー経由も) | block_change (11) | 本体 | 影響=新しい状態 | 入力 / L13 | 14 |
| プレイヤーの設置 | BlockItem#place で置いた後 (置いたブロックの近隣更新・onPlace より後) | block_place (13) | 置いた位置 | (プレイヤー, 置いた直後の状態。TNT のようにすぐ消えたら空気) | 入力 | 04 §4.13 |
| プレイヤーの破壊 | Block#playerWillDestroy (撤去の前) | block_destroy (12) | 壊した位置 | (プレイヤー, 元の状態) | 入力 | 04 §4.14 |
| 支えを失った・壊れた | Level#destroyBlock で撤去できた後。Block#updateOrDestroy (形状更新で空気になった) から来る | block_destroy (12) | その位置 | (壊した者か無し, 元の状態) | 形状更新の場 | 04 |
| スカルクセンサー | 作動した | sculk_sensor_tendrils_clicking (振動でない)。隣のアメジストに resonate_f | 本体 / アメジスト | 元の発生元 | L13 | 10 |

出さないもの [26.3 読解: 該当クラスに gameEvent の呼び出しが無い]

- ダスト・トーチ・リピーター・コンパレーター・オブザーバー・ランプ・レッドストーンブロック・ターゲット・銅の電球・レール 4 種・避雷針・ホッパー・ドロッパー (空でも音だけ)・クラフター。
- moving_piston の着地 (PistonMovingBlockEntity)・ピストンヘッドの撤去。
- プレイヤーによるリピーターの遅延の変更・コンパレーターのモード切替・ダストの形の切替。
- /setblock・/fill の replace などの既定のモード。ただし destroy モードは Level#destroyBlock を通るので block_destroy (12) を出す (SetBlockCommand・FillCommand)。
- 流体の流れ・爆発で直接壊れるブロック (BlockBehaviour#onExplosionHit は空気を書くだけ。爆発そのものは中心で explode (15) を 1 回、壊す前に出す)。爆発で支えを失った部品は形状更新から Level#destroyBlock を通るので block_destroy を出す。
- Level#removeBlock による撤去 (着火した TNT が消えるときなど)。

ほかの発生源 (回路の外で出るもの。担当は 11・14・16・17): 大釜 (雨・鍾乳石の滴りで満ちる)、eyeblossom、dried_ghast、強い硫黄 (onPlace で噴き始めると block_activate、BlockEntity の数え下げで休むと block_deactivate)、銅のゴーレムの像 (手で姿勢を変える)、リスポーンアンカー、耕地の踏み荒らし、土の道 (上に固体が来ると 1 tick 後の L6 で土に戻る。ピストンで上へ押し込んでも起きる)。どれも block_change (11) か block_activate・block_deactivate である。

エンティティ側 (歩く step・着地 hit_ground・跳ねる bounce・泳ぐ swim・投射物・トロッコ・落雷・爆発ほか) は → 17_entities-interplay.md。

### 4.13 時刻の早見表

[26.3 読解: §2.2 の組み立て。相の順は 01 §2.3]

| GameEvent が出る所 | 記録される gameTime | センサーが作動する tick |
|---|---|---|
| tick N の L6 (リピーター・トーチ・オブザーバーの出力で動いた部品、ボタンの戻り、ディスペンサー) | N | N + max(1, k) |
| tick N の L10 (ピストンの伸縮、ピストンが押しつぶしたブロック、ピストンが外した支え) | N | N + max(1, k) |
| tick N の L12 (エンティティ) | N | N + max(1, k) |
| tick N の L13 (ホッパー、moving_piston の着地で動いた部品、センサーの出力で動いた部品、共鳴) | N | N + max(1, k) |
| tick N と N+1 の間 (プレイヤーの操作・コマンド・ハーネスの入力) | N | N + max(1, k) |
| 上の入力でピストンを動かした | N+1 (ブロックイベントは次の tick の L10) | N + 1 + max(1, k) |

k は候補の距離 (float) の floor である。ブロックが出す GameEvent なら、中心同士の距離なので整数位置の距離の floor と同じになる。

ハーネスの記法 (state[t] は tick t を進めて入力を入れた直後) で書く。入力 t で出た GameEvent では、センサーは state[t + max(1, k)] で active、state[t + max(1, k) + 30] で cooldown、state[t + max(1, k) + 40] で inactive になる。調律型は +10・+20 である。
センサーが出す信号でランプは同じ state で点き、消えるのは cooldown の 4 tick 後である。コンパレーターは active の 2 tick 後に出す (→ 07)。

### 4.14 決定性

[26.3 読解: §4.1〜§4.9]

1. 振動の処理 (届く範囲・受け付け・遮蔽・選び方・遅れ・強さ) に乱数は無い。
2. 既定の評価器で乱数を引くのは音だけである。作動と休止の終わりで、水浸しでなければワールド乱数の float を 1 個ずつ引く。ワールド乱数を進めるので、同じ列を使うほかの処理 (ディスペンサーのスロット選びなど) に効く (→ 18)。実験の評価器 (redstone_experiments) では、向きを渡さない近隣更新 (フラグ 3 の書き込みと updateNeighbours) のたびに、ExperimentalRedstoneUtils#initialOrientation がワールド乱数で Orientation を作る (→ 04)。
3. 同じ tick の中の順に効くのは 2 つである。1 つは GameEvent を出した順で、同じ距離・同じ周波数の決着に効く。これは近隣更新の順やブロックイベントの順で決まる (→ 04・03)。もう 1 つはセンサーの BlockEntity の順で、作動の前後に効く。
4. BlockEntity の順は ticker の登録順で、設置したならその順である。チャンクを読み込んだ直後は、チャンクが持つ BlockEntity の表 (ハッシュ表) の反復順になる [要実機] (→ 18)。
5. 配る順 (チャンク・セクション・登録順) はセンサーの結果に効かない。HashSet が出てくるのは配っている最中に外す印だけで、反復の順には効かない。
6. 浮動小数は §7.2 の 7 に合わせる。

---

## 5. 端の場合と落とし穴

1. **setBlock は振動を出さない**。状態が変わっても、§4.12 の出す所を通らなければセンサーは聞かない。ダストやリピーターの点滅は聞こえない。
2. **聞けない GameEvent は捨てられる**。移動中・active・cooldown の間に来たものは、後から拾われない。待ち行列を作ってはいけない。
3. **先に来た tick が勝つ**。候補が入った後、まだ選ばれていない次の tick の L6・L10・L12 で来た GameEvent は、近くても捨てられる。入力で音符ブロックとピストンを同時に動かすと、ピストンの GameEvent は 1 tick 後になる。だから音符ブロックがどれだけ遠くても音符ブロックが選ばれる。
4. **音符ブロックは積む時点で出す**。note_block_play は neighborChanged の中で出る。音のブロックイベントは次の L10 まで待つが、GameEvent は待たない (→ 03)。ピストンは処理の中 (L10) で出すので、同じ入力でも 1 tick 遅い。
5. **ピストンが出すのは本体の位置だけ**。押されたブロックの着地は何も出さない。押しつぶしたブロックは 1 個ずつ block_destroy を出し、それは本体の block_activate より先に出る。
6. **扉は 1 回だけ、先に更新を受けた半分から出す**。片方が開くと形状更新でもう片方も開く。もう片方の neighborChanged では POWERED がもう揃っているので出ない。どちらの半分かで距離が 1 違う (→ 11)。
7. **扉・トラップドア・フェンスゲートは OPEN が変わったときだけ出す**。手で開けた扉に信号を入れても出ない。
8. **音符ブロックは真上が空気でないと出さない** (頭は例外)。
9. **感圧板は押された・離れたの 2 回だけ**。重量式の値が 3 から 5 に変わっても出ない。
10. **ボタンは押すと戻るの 2 回出す**。普通のセンサーが押しで作動すると、戻り (石 20 tick・木 30 tick 後) は active か cooldown の間に来るので聞かない。調律型 (計 20 tick) は違う。押しから作動までが 10 tick 未満 (max(1, k) < 10) なら、木のボタンの戻り (block_deactivate、9) の前に inactive へ戻る。背面の入力が 0 なら押しと戻りの両方で作動する。ちょうど 10 なら同じ L6 の予約 tick の順で決まる (→ 02)。
11. **自分の出力ですぐには発振しない**。センサーが動かした部品の GameEvent は、active か cooldown の間に来れば聞かない。聞くのは作動 A から A+40 (調律型 A+20) の L6 で inactive に戻った後である。立ち上がり (A) から返す経路なら 40 tick (調律型 20 tick) 以上、立ち下がり (A+30、調律型 A+10) から返す経路なら 10 tick 以上の遅れがあると聞いて、発振しうる。返ってくる GameEvent がちょうど A+40 (調律型 A+20) の L6 で出るときは、センサーの予約 tick との順で決まる (→ 02)。
12. **調律型の判定は受け付けの瞬間だけ**。移動中に背面の入力を変えても、届けば作動する。背面の入力を変える設置 (背面にレッドストーンブロックを置く) は、書き込みが先で GameEvent が後なので、変わった後の値で判定される。プレイヤーの破壊は GameEvent が先で撤去が後なので、壊す前の値で判定される。
13. **調律型の背面は SignalGetter#getSignal だけで読む**。導体からは、その導体へ向かう強い信号の最大を読む (→ 05)。ダストの getDirectSignal はダストの計算の外では値を返すので、ダストで弱充電された導体も入力になる (ランプと同じ)。入力にならないのは、強い信号が 1 本も向かっていない導体 (普通のセンサーの横の導体・レバーが付いていない面の導体など) である。リピーター (DiodeBlock#getInputSignal) と違い、背面のダストの power を直接は読まない。ダストが背面へ向いていないと 0 である。ただしセンサーは信号源なので、隣のダストは普通センサーへ繋がる。
14. **コンパレーターは cooldown で 0 に落ちる**。last_vibration_frequency は残るが、読めるのは active の間だけである。
15. **移動中は毎 tick コンパレーター更新が出る** (§4.6)。値は変わらないので普段は何も起きない。更新で目を覚ますコンパレーターや、更新を数える装置には効く。
16. **強い信号は真下だけ**。センサーの上や横の導体は充電されない (弱い信号は導体を通らない。→ 05)。その導体の先のダスト・ランプ・リピーターは動かない。センサーに直に接するランプ・リピーター・ダストは弱い信号で動く。
17. **強さは整数位置、遅れは Vec3 の距離**。ブロックが出す GameEvent なら同じになる。エンティティなら足元の小数の位置で遅れが決まり、強さは整数位置で決まる。
18. **最低 1 tick**。距離が 1 未満 (同じブロック) でも、選ぶのが次の tick なので 1 tick かかる。
19. **ON は L13、OFF は L6**。立ち上がりは tick の終わり近く、立ち下がりは初めである。同じ tick の中でのほかの部品との前後がこれで決まる。センサーが直接動かすピストンは、次の tick の L10 で動き出す (→ 03)。
20. **センサー同士は直接は反応し合わない**。sculk_sensor_tendrils_clicking は振動でない。繋がるのはアメジストの共鳴か、出力で動かした部品の GameEvent だけである。
21. **自分の設置と破壊は聞かないが、自分の水浸しは聞く**。バケツで水を入れると fluid_place (13) が自分の位置に出て、距離 0 で power 15 になる。除外されるのは block_place と block_destroy だけである。
22. **段階を直接書いたセンサーは止まることがある**。/setblock などで active か cooldown のセンサーを置くと、予約 tick が無い。onPlace は power を 0 にするだけで段階を戻さないので、ずっと聞かないセンサーになる。strict の /setblock なら onPlace も呼ばれず、power も残る (§4.11 の 1)。fixture の blocks には inactive・power 0 を書く。
23. **予約 tick の重複は除かれる** (→ 02)。同じ種類の予約が残っているセンサーに作動の予約を入れても入らない。残っていた予約で早く切れる。置き換えた直後に起きうる。
24. **チャンクの端**。センサーのチャンクの周り 3×3 がブロック tick 中でないと届かず、待ち続ける。
25. **スニークで消えるのはエンティティの動きだけ**。step・hit_ground などは消えるが、レバー・扉・設置・破壊の GameEvent は消えない。
26. **羊毛の効き方は 2 通り**。遮るのは羊毛ブロックだけである。カーペット・羊毛のハーフ・羊毛の階段は遮らず、それ自体が壊れた・置かれた・踏まれたときの GameEvent を消すだけである。
27. **1 回の操作で同じ位置から 2 つ出ることがある**。同じ tick・同じ距離なので、周波数の大きい方が残る (§4.5)。受電している所へプレイヤーが TNT を置くと、onPlace の prime_fuse (10) の後に BlockItem#place の block_place (13) が出て、block_place が残る。糸をハサミで切ると shear (6) の後に block_destroy (12) が出て、block_destroy が残る。

---

## 6. 版差

担当クラス (SculkSensorBlock・CalibratedSculkSensorBlock・2 つの BlockEntity・GameEvent・GameEventDispatcher・EuclideanGameEventListenerRegistry・VibrationSystem・VibrationSelector・VibrationInfo) を版ごとに diff -u した。1.21.1 はデコンパイラの変数名が違うので、処理を並べて比べた。タグは JSON を集合として比べた。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 | 効き |
|---|---|---|---|---|---|
| bounce (周波数 2) | 無い (GameEvent・表・タグのどれにも無い) | 有る | 有る | 有る | [版差 1.21.1] スライム・ベッドで跳ねるエンティティ (→ 17) |
| 周波数 0 の GameEvent を canReceiveVibration で拒む | 無い | 有る | 有る | 有る | [版差 1.21.1] 既定のタグでは差が出ない |
| 除去のフック | onRemove。ブロックが変われば必ず呼ぶ | affectNeighborsAfterRemoval。フラグ 1・ピストン・strict でない /setblock・/fill・/clone のときだけ | 同じ | 同じ | [版差 1.21.1] それ以外の書き込み (フラグ 1 なし) で active のセンサーを消したときだけ、1.21.1 は近隣更新が出る (→ 04) |
| 作動・休止の書き込み | フラグ 3 | フラグ 3 | setBlockAndUpdate (= フラグ 3) | 同じ | 無し |
| dampens_vibrations (ブロック・アイテム) | wool・wool_carpets | 同じ | wool_slabs・wool_stairs を追加 (26.3 の新ブロック) | 同じ | 新しいブロックの分だけ。遮蔽はしない |
| occludes_vibration_signals | wool | 同じ | 同じ | 同じ | 無し |
| 氷・雪の層が明るさで溶ける | 出さない | 出さない | block_destroy (12) を出す | 同じ | ランダム tick の振動源が増えた |
| TNT の着火 | 常に着火して prime_fuse | ゲームルール tnt_explodes が偽なら着火もしない | 同じ | 同じ | [版差 1.21.1] (→ 11) |
| 棚・銅のゴーレムの像・強い硫黄など | 無い | 有る | 有る | 有る | [版差 1.21.1] 新しい発生源 |
| getAnalogOutputSignal | 向きを受け取らない | 受け取る | 同じ | 同じ | センサーは向きを見ない |
| 信号の API | getSignal が power を返す | ownSignal に分けた | 同じ | 同じ | 結果は同じ |
| 経験値 | spawnAfterBreak で 5 | 同じ | 同じ | DropExperienceEntityBlock が持つ (5) | [版差 26.4-pre-1] 挙動に効かない |
| 割れる氷 | — | — | — | block_change を出す新ブロック | [版差 26.4-pre-1] 回路に効かない |
| 振動の処理 (配る・登録簿・受け付け・選び方・移動・到着) | 同じ | 同じ | 基準 | 同じ (コレクションの書き方だけ) | 無し |
| 作動 30/10・休止 10・半径 8/16・強さと移動の式・遮蔽 | 同じ | 同じ | 基準 | 同じ | 無し |
| ピストン・音符ブロック・レバー・ボタン・扉・トラップドア・フェンスゲート・ベル・ディスペンサー・感圧板・フックの出し方 | 同じ | 同じ | 基準 | 同じ | 無し |

既存の実機 fixture にセンサーを使うものは無い。版差で無効になる fixture は無い。
§8 のプローブは、bounce と羊毛のハーフ・階段を使わない限り、1.21.1 で撮っても 26.3 の正解に使える。

---

## 7. Rust で実装するときの要点

### 7.1 データ

| 置き場 | 持つもの | Rust の型の例 |
|---|---|---|
| blockstate | phase (3 値)・power (0〜15)・waterlogged・facing (調律型) | 列挙型と u8 |
| センサーの BlockEntity | 最後の周波数 | u8 |
| 同 | 移動中の振動 | `Option<Vibration>` |
| 同 | 残り tick | i32 |
| 同 | 候補と入った gameTime | `Option<(Vibration, i64)>` |
| Vibration | event・distance・pos・発生元 | GameEventId・f32・[f64; 3]・`Option<EntityRef>` |
| GameEventId | 周波数・vibrations タグか・スニークで消えるか・通知半径 | 定数の表 (match) |
| リスナーの索引 | セクションごとに登録順の列 | ハッシュ表 (セクション → Vec) |
| BlockEntity の ticker | 全種類を 1 本の登録順の列 | Vec。L13 の途中で足したものは保留の列に入れ、次の L13 の頭で末尾へ移す |

### 7.2 順を保つための決まり

1. GameEvent はその場で配る関数にする。setBlock のフックにしない。発生源の部品 (13・11・09・12・14・04) が、§4.12 の位置と順で呼ぶ。
2. 配る順は §4.1 の 6・7 に合わせておく。センサーだけなら効かないが、BY_DISTANCE のリスナーを足すときに要る。
3. BlockEntity 相は全種類を 1 本の列で回す。センサー・ホッパー・moving_piston を種類ごとに分けて回すと、同じ tick の作動の前後が実機とずれる。
4. 作動は §4.7 の 1〜6 の順を崩さない。「書き込み → 予約 tick → 自分と真下の近隣更新 → 共鳴 → 乱数 → 移動中を消す → コンパレーター更新」である。予約 tick の通し番号 (subtick) は、書き込みの近隣更新で生まれた予約より後になる (→ 02)。
5. 選択器は「先の tick が勝つ」を守る。tick の終わりにまとめて選ぶ作りにすると、§5 の 3 がずれる。
6. 遮蔽は BlockGetter#traverseBlocks を同じ形で移す。端の延長 1e-7・同時にまたいだときの z → y → x・ずらしは 1.0E-5 の float を double に広げた値・始点と終点のブロックも調べること。
7. 浮動小数。候補の距離は f64 で sqrt して f32 にし、比べるのも f32 のまま行う。移動の tick は f32 の floor である。強さは (15.0 ÷ 半径) を f64 で求め、距離の f32 を f64 に広げて掛けて floor する。
8. 乱数。作動と休止の終わりで、水浸しでなければワールド乱数の float を 1 個引く (→ 18)。実験の評価器では近隣更新ごとの Orientation の分も引く (§4.14 の 2)。乱数の列を合わせないなら、これらの所に「引く」口だけ残す。
9. 保存。候補・移動中・残り・最後の周波数を保存する。途中で保存して読み込んでも続きから動く。

### 7.3 エンティティの境界

1. sim はエンティティを持たない (docs/research/13_scope-policy.md §2)。ブロックが出す GameEvent は全部エンティティ無しで閉じる。
2. エンティティ由来 (歩く・着地・投射物) は、「位置・GameEvent・発生元の性質 (スニークか・羊毛のアイテムか)」を受け取る手動トリガの口で入れる。
3. stepOn は §4.11 の別経路 (遮蔽・羊毛・スニーク・移動中を見ない) なので、口を分ける。
4. 発生元のエンティティが要るのは、isValidVibration の 3 つの判定と、共鳴の文脈だけである。

### 7.4 他のメモとの境界

| 境界 | こちら (10) | あちら |
|---|---|---|
| 発生源 | GameEvent の表・配る関数・受け付け | 出す位置と順は各部品 (09・11・12・13・14・04) |
| 作動の書き込み | 何を書くか・順 | フラグ 3 の中身と近隣更新の順は 04 |
| 予約 tick | 30/10/10・NORMAL | 照合と重複の除去は 02 |
| 出力 | センサーの信号の値 | 読む側の規則は 05・07 |
| tick の相 | L13 で選ぶ・届く、L6 で切れる | 相の順と入力の位相は 01 |

---

## 8. 検証用のプローブ回路案

入力はなるべく `setblock` (replace モード) を使う。/setblock の replace は GameEvent を出さず、プレイヤーの位置も関係しない。destroy モードは block_destroy を出すので使わない。座標は相対で、y=0 は石の床、部品は y=1 に置く。出力は blockstate (phase・power) と、コンパレーター → ダスト 1 個 (ダストの power = 周波数) で読む。fake player は全センサーから 17 ブロック以上離すか、スニークさせて動かさない。fake player の出現・移動・tp が何を出すかは [要実機] である。期待は §4.13 の式から出した。

| 名前 (案) | 目的 | 配置 | 入力 | 期待 (state[t]) |
|---|---|---|---|---|
| sculk-distance-power | 遅れと強さの式 | 音符ブロック N (0,1,0)。普通のセンサーを (d,1,0) に d=1〜9。斜めに (2,1,2)・(2,2,1)・(4,1,4) | t=2 で N の下の床 (0,0,0) を redstone_block に | 軸: d=1〜8 は state[2+d] で active、power 16−2d (d=8 は 1)。d=9 は動かない。斜め: (2,1,2) は state[4] で 10、(2,2,1) は state[4] で 11、(4,1,4) は state[7] で 5。それぞれ +30 で cooldown、+40 で inactive |
| sculk-calibrated-distance | 調律型の半径 16 | 同じ形で調律型を d=1〜17 (背面は空気) | 同上 | d=1〜15 は state[2+d] で power 16−d。d=16 は state[18] で 1。d=17 は動かない。active 10 tick・cooldown 10 tick |
| sculk-select-same-tick | 同じ tick・同じ距離なら周波数の大きい方 | 入力 R (0,1,0)、床付きのベル B (−1,1,0)、音符 N (1,1,0)、センサー S (0,1,3)、S を背にしたコンパレーター (0,1,4) とダスト (0,1,5) | t=2 で R を redstone_block に | S は state[5] で active・power 10。ダストは state[7] で 11。B と N を入れ替えても 11 |
| sculk-select-closer | 同じ tick なら近い方 | 上の B を (−2,1,0) に動かし、(−1,1,0) のダストで B に給電する | 同上 | ダストは 10 (N の周波数)。S は state[5] で power 10 |
| sculk-select-earlier-tick | 先の tick が勝つ | S (0,1,0)、上向きのピストン P (1,1,0)、R (1,1,1)、R から東へダスト 3 個、その先に音符 N1 (5,1,1) (S から √26) | t=2 で R を redstone_block に | S は state[7] で power 6 (N1 の勝ち)。P が勝てば state[4] で power 14 になるので区別できる |
| sculk-piston-phase | ピストンは 1 tick 遅く聞こえる | fixture を 2 本に分ける。(a) 音符ブロックと 2 離れたセンサー。(b) 上向きのピストンと 2 離れたセンサー | t=2 で給電、t=50 で給電を外す | (a) は state[4]。(b) は state[5] で active・周波数 10。収縮は state[53] で active・周波数 9 |
| sculk-door-half | 扉は更新を受けた半分から出す | 扉の下 (0,1,0)・上 (0,2,0)。センサー S (0,4,2)。入力を下の横 (1,1,0) か上の横 (1,2,0) に | t=2 で入力を redstone_block に | 下から出れば state[5] で power 9 (d²=13)。上から出れば state[4] で power 10 (d²=8)。下の横なら下、上の横なら上のはず |
| sculk-wool-occlusion | 羊毛の遮蔽と 6 本の線分 | 音符 N (0,1,0)。羊毛 (1,1,0)・(0,1,1)。センサー A (2,1,2)・B (2,1,−2)・C (3,1,0)。カーペットを (−1,1,0)・(−2,1,0) に敷き、センサー E (−3,1,0) | t=2 で (0,0,0) を redstone_block に | B は state[4] で power 10、E は state[5] で power 10。A と C は動かない |
| sculk-calibrated-filter | 調律型の絞り込みと背面に出さないこと | 調律型 CS (0,1,0) facing=north。背面 (0,1,1) から南へダスト 6 個と redstone_block (背面のダストは 10)。床付きのベル B (1,1,−1)・音符 N (0,1,−2) を入力 R (1,1,−2) で動かす。CS の西にコンパレーター → ダスト | t=2 で R を redstone_block に | CS は state[4] で active・power 14。ダストは state[6] で 10。背面のダストは 10 のまま。背面の列を外した版では state[3] で power 14・周波数 11 |
| sculk-calibrated-latch | 判定は受け付けの瞬間だけ | 上で N を CS から 12 離す | t=2 で R、t=5 で背面の列の先のダストを redstone_block にして入力を 11 にする | CS は state[14] で active・power 4。入力を変えても止まらない |
| sculk-amethyst-relay | 共鳴の中継と周波数 | S1 (0,1,0)、アメジスト (1,1,0)、ベル (−2,1,0)、S2 (8,1,0) とそのコンパレーター → ダスト | t=2 でベルの下の床を redstone_block に | S1 は state[4] で power 12。S2 は state[11] で power 2。S2 のダストは state[13] で 11。S2 はベルを直接は聞かない (距離 10) |
| sculk-phase-timeline | 段階の長さと聞かない期間 | センサー S と 2 離れた音符 N。N の下の床を入力にする | t=2 on・3 off・20 on・21 off・40 on・41 off・44 on | S は state[4]〜[33] で active、[34]〜[43] で cooldown、[44] で inactive。20 と 40 の立ち上がりは聞かない。44 の立ち上がりで state[46] に active |
| sculk-output-faces | 出力の向き | 石 (0,1,0) の上にセンサー (0,2,0)。4 方向の横と上にランプ。(1,1,0) にダスト (石の横)。音符 (0,2,−2) の下を入力にする | t=2 で入力 | state[4] でランプ 5 個が点き、ダストは 12 (石の強い充電)。state[34] でダストが 0、state[38] でランプが消える。調律型にすると facing の反対側のランプだけ点かない |
| sculk-support-pop | 支えの喪失は block_destroy | 東向きに伸びた粘着ピストン (0,1,0)、ヘッド (1,1,0)、石 (2,1,0) の上にダスト (2,2,0)。給電は (0,1,−1) の redstone_block。センサー S (2,2,3) とそのコンパレーター → ダスト | t=2 で (0,1,−1) を空気に | ダスト (2,2,0) は state[3] で消える。S は state[6] で active・power 10。コンパレーターのダストは 12 (本体の block_deactivate は √14 で遠い) |

1. どれも 1.21.1 と 26.3 で同じ結果になるはずである (§6)。
2. sculk-support-pop でダストが消える時点は読みで決まる。PistonBaseBlock#moveBlocks は、空いた位置をフラグ 82 で空気にした後、その位置から形状更新を配る。ダストの updateShape が空気を返し、Block#updateOrDestroy から Level#destroyBlock に入って block_destroy を出す。これは本体の block_deactivate より前である [26.3 読解]。プローブはこの読みを実機で確かめる。
3. sculk-door-half は読みでは、入力に隣り合う半分の neighborChanged が先に走り、そこから出る (DoorBlock#neighborChanged。もう片方は形状更新で POWERED が揃うので出さない)。両方の半分が同じ更新の波で受ける配置では、近隣更新の順で決まる [要実機]。
4. 「同じ距離・同じ周波数なら先の方」は出力では区別できない。確かめるならエンティティ由来の小数の位置で作る [要実機]。

---

## 9. 既存資料との食い違い

センサーを扱う既存の資料は無い。docs/research・docs/vanilla の他のメモ・packages/sim/src を sculk・振動・GameEvent で検索して、関係する所だけ挙げる。コードと他のメモは変えていない。

| 箇所 | 既存の記述 | 26.3 の読み | 判断と根拠 |
|---|---|---|---|
| docs/research/10_component-scope.md §5 (C5 音符ブロック) | 「回路勢重要度: 低 (回路論理への影響ほぼ皆無)」「レッドストーン信号を出力しない」 | 信号は出さない。だが立ち上がりで note_block_play (10) を出し、センサーがそれを聞いて信号にする (NoteBlock#playNote) | 信号を出さないのは正しい。「論理への影響ほぼ皆無」はセンサーを入れると成り立たない。音符ブロックは振動の送り手として回路に使われる。センサーを入れるときに見直す |
| 同 §5 の「⚠ start delay」 | player 入力起点の発音 BE は、ピストン同様に翌 tick の BE フェーズで鳴る | 音 (ブロックイベント) は翌 tick の L10。GameEvent は積む時点 (neighborChanged の中) で出る | 音の時点としては正しい。振動の起点にはならない。packages/sim/src/world.ts の onNotePlay は executeBlockEvent (L10) から呼ばれるので、これを振動の発生源にすると遅れる。積む所で出すこと |
| docs/research/13_scope-policy.md §3 | スカルクセンサーの行が無い | ブロックが出す GameEvent はエンティティ無しで閉じる | 境界原則と両立する。足すなら「ブロック由来は本体、エンティティ由来は手動トリガ」の行を足す。採否はユーザ判断 |
| packages/sim/src/power.ts の isSignalSourceType | sculk 系が無い (コメントで未実装と明記) | isSignalSource は真。ダストが繋がる | 未実装なので食い違いではない。足すときはここに入れ、強い信号は真下だけ・調律型は背面に出さない |
| packages/sim/src/world.ts の tickBlockEntities | BlockEntity 相を moving_piston の確定 → ホッパーの 2 パスで回す | vanilla は全種類を 1 本の登録順の列で回す (Level#tickBlockEntities) | センサーを足すなら 1 本の列にする。2 パスのままだと、同じ tick に動くセンサーとホッパー・moving_piston の前後が実機とずれる |
| docs/research/13_scope-policy.md §3 (支持ブロック要件の行) | sim は支えを失って落ちる挙動を持たない | 支えを失った部品は Level#destroyBlock で block_destroy (12) を出す | sim では再現できない振動源になる。既知の乖離に足す |
| 同 §3 (ピストンによる破壊 PUSH_DESTROY の行) と packages/sim/src/world.ts の toDestroy | 押し先の PUSH_DESTROY をアイテム化せず消す | PistonBaseBlock#moveBlocks は toDestroy の後ろから 1 個ずつ、空気をフラグ 18 で書いてから block_destroy (12) を出す (位置はその場所、影響は壊れた状態)。本体の block_activate より前である | 消すこと自体は正しい。センサーを足すなら、消す所で block_destroy をこの順に出す |
| docs/vanilla/09_manual-inputs.md の LeverBlock#pull | GameEvent は「操作した人が出所」 | LeverBlock#useWithoutItem も #onExplosionHit も、pull に発生元として null を渡す。GameEvent の発生元は無い | 26.3 の読みが正しい。発生元が要るのはスニーク・観戦者・羊毛のアイテムの判定と共鳴の文脈だけで、block_activate はどれにも当たらない。だから結果は変わらない。09 を直すときの材料にする |
| docs/research/17_circuit-corpus.md §2.3 (redstonepedia) | 3×3 ドアの 1,690 設計のうち sculk が 653 | — | 食い違いではない。センサーを入れないと、26.3 の公開データのドアの 4 割近くが動かない。センサーの優先度の根拠になる |
| docs/research/02_behavior-spec.md のブロックイベントの「使用ブロック」 | ピストン・音符ブロック・チェスト・ベルほか | GameEvent とは別の仕組みである | 食い違いではない。ただし「ブロックイベントの処理の時点 = 振動の時点」と読まない。処理の中で出すのはピストンだけである |
| 実機 fixture | センサー・アメジスト・羊毛の遮蔽を使う fixture は 0 本 (tools/mc-harness/fixtures/ を検索) | — | §8 で新しく撮る |

---

## 10. 典拠一覧

すべて 26.3。

- SculkSensorBlock#tick・#stepOn・#onPlace・#affectNeighborsAfterRemoval・#updateShape・#updateNeighbours・#getTicker・#isSignalSource・#ownSignal・#getDirectSignal・#getPhase・#canActivate・#deactivate・#getActiveTicks・#activate・#tryResonateVibration・#hasAnalogOutputSignal・#getAnalogOutputSignal・#getStateForPlacement
- CalibratedSculkSensorBlock#getTicker・#getStateForPlacement・#getSignal・#rotate・#mirror・#getActiveTicks
- SculkSensorBlockEntity#loadAdditional・#saveAdditional・#getLastVibrationFrequency・#setLastVibrationFrequency・#getListener
- SculkSensorBlockEntity.VibrationUser#getListenerRadius・#canTriggerAvoidVibration・#canReceiveVibration・#onReceiveVibration・#onDataChanged・#requiresAdjacentChunksToBeTicking
- CalibratedSculkSensorBlockEntity.VibrationUser#getListenerRadius・#canReceiveVibration・#getBackSignal
- SculkSensorPhase (inactive・active・cooldown)
- VibrationSystem の VIBRATION_FREQUENCY_FOR_EVENT・RESONANCE_EVENTS、VibrationSystem#getGameEventFrequency・#getResonanceEventByFrequency・#getRedstoneStrengthForDistance
- VibrationSystem.Data (CODEC・#decrementTravelTime)
- VibrationSystem.Listener#handleGameEvent・#forceScheduleVibration・#scheduleVibration・#distanceBetweenInBlocks・#isOccluded
- VibrationSystem.Ticker#tick・#trySelectAndScheduleVibration・#tryReloadVibrationParticle・#receiveVibration・#areAdjacentChunksTicking
- VibrationSystem.User#getListenableEvents・#calculateTravelTimeInTicks・#isValidVibration
- VibrationSelector#addCandidate・#shouldReplaceVibration・#chosenCandidate・#startOver
- VibrationInfo (CODEC・#getEntity・#getProjectileOwner)
- GameEvent の登録 (通知半径)・GameEvent.Context・GameEvent.ListenerInfo#compareTo
- GameEventDispatcher#post・#handleGameEventMessagesInQueue
- GameEventListener#getDeliveryMode
- EuclideanGameEventListenerRegistry#register・#unregister・#visitInRangeListeners・#getPostableListenerPosition
- BlockPositionSource#getPosition
- LevelAccessor#gameEvent・ServerLevel#gameEvent・Entity#gameEvent
- LevelChunk#getListenerRegistry・#addAndRegisterBlockEntity・#addGameEventListener・#removeGameEventListener・#removeBlockEntity・#setBlockState・#updateBlockEntityTicker
- EntityBlock#getListener
- BlockGetter#isBlockInLine・#traverseBlocks
- Level#setBlock・#destroyBlock・#updateNeighbourForOutputSignal・#tickBlockEntities・#addBlockEntityTicker
- BlockEntity#setChanged
- BlockBehaviour#getSignal・#ownSignal・#getDirectSignal・#onExplosionHit
- SignalGetter#getSignal・#getDirectSignalTo、RedstoneWireBlock#getDirectSignal・#getSignal、DiodeBlock#getInputSignal、ComparatorBlock#getInputSignal
- ServerLevel#updateNeighboursOnBlockSet、SetBlockCommand (destroy モード)、FillCommand.Mode、ServerExplosion#explode
- ServerLevel#tick・#tickTime・#updateNeighborsAt
- ExperimentalRedstoneUtils#initialOrientation
- 発生源 (ピストン・音符ブロック): PistonBaseBlock#triggerEvent・#moveBlocks・#isPushable、NoteBlock#neighborChanged・#playNote・#useWithoutItem・#attack
- 発生源 (手で動かす入力): LeverBlock#useWithoutItem・#onExplosionHit・#pull、ButtonBlock#press・#checkPressed・#onExplosionHit、Blocks の STONE_BUTTON (20)・OAK_BUTTON (30)、BasePressurePlateBlock#checkPressed・#entityInside・#tick、TripWireHookBlock#emitState、TripWireBlock#playerWillDestroy、DaylightDetectorBlock#useWithoutItem、LecternBlock#resetBookState・#placeBook、LecternBlockEntity#onBookItemRemove (本を取る)
- 発生源 (出力): DoorBlock#useWithoutItem・#setOpen・#neighborChanged・#updateShape、TrapDoorBlock#toggle・#playSound・#neighborChanged・#onExplosionHit、FenceGateBlock#useWithoutItem・#onExplosionHit・#neighborChanged、BellBlock#neighborChanged・#attemptToRing、TntBlock#onPlace・#neighborChanged・#prime、BigDripleafBlock#neighborChanged・#setTilt、Tilt#causesVibration、ShelfBlock#neighborChanged
- 発生源 (ディスペンサー・コンテナ): DispenserBlock#dispenseFrom、DropperBlock#dispenseFrom、DispenseItemBehavior の各振る舞い (BUCKET・TNT・WITHER_SKELETON_SKULL・CARVED_PUMPKIN・GLASS_BOTTLE)、SpawnEggItemBehavior、ShulkerBoxDispenseBehavior、ShearsDispenseItemBehavior、JukeboxBlockEntity#notifyItemChangedInJukebox、ContainerOpenersCounter#incrementOpeners・#decrementOpeners・#recheckOpeners、ComposterBlock#addLayer・#empty、ChiseledBookShelfBlockEntity#updateState
- 発生源 (設置・破壊): BlockItem#place、Block#playerWillDestroy、Block#updateOrDestroy、Level#removeBlock、BucketItem#emptyContents・#playEmptySound、TntBlock#onPlace・#prime、IceBlock#melt・SnowLayerBlock#randomTick (26.3 で増えた)
- 発生源 (回路の外): CauldronBlock・LayeredCauldronBlock、EyeblossomBlock、DriedGhastBlock、PotentSulfurBlock#onPlace・PotentSulfurBlockEntity、CopperGolemStatueBlock#updatePose、RespawnAnchorBlock#charge、FarmlandBlock#turnToBaseBlock、PathBlock#updateShape・#canSurvive・#tick・#turnToBaseBlock
- 発生元の判定: Warden#dampensVibrations、ItemEntity#dampensVibrations、Entity#isSteppingCarefully・#applyEffectsFromBlocks・#getOnPosLegacy・#getOnPos
- タグ: game_event/vibrations・ignore_vibrations_sneaking・shrieker_can_listen、block/occludes_vibration_signals・dampens_vibrations・vibration_resonators・wool・wool_carpets・wool_slabs・wool_stairs、item/dampens_vibrations
