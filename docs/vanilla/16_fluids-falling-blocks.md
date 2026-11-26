# 16. 流体・泡柱・落下ブロック・スポンジ

Java 版 26.3 のコードを読んで、自分の言葉でまとめた実装メモ。
コードの写しは含まない (docs/ip-policy.md)。典拠は「26.3 クラス名#メソッド名」で示す。

確かさの表記:

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: fixture 名] tools/mc-harness/fixtures/ の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.2] [版差 26.4-pre-1] 版で違う点

用語: NC = 近隣更新 (neighborChanged)。SU = 形状更新 (updateShape)。gt = ゲーム tick。
L6・L7 などの相の名前は 01_tick-loop.md §1.2 の表に従う (L6 ブロックの予約 tick、L7 流体の予約 tick、L9 ランダム tick、L10 ブロックイベント、L12 エンティティ、L13 BlockEntity)。

方向の並びは 4 種類が出てくる。混ぜると順序が狂うので、本文では名前で呼ぶ。

| 名前 | 並び | 使う所 |
|---|---|---|
| NC 順 | 西・東・下・上・北・南 | 1 点の周り 6 マスへ NC を配る順 (→ 04) |
| SU 順 | 西・東・北・南・下・上 | 形状更新を配る順 (→ 04) |
| enum 順 | 下・上・北・南・西・東 | Direction の宣言順。EnumMap の反復順。スポンジの探索順 |
| 水平順 | 北・東・南・西 | Direction.Plane.HORIZONTAL。流体の周りを調べる順 |

流体の種類 (Fluid) の名前は登録 ID で呼ぶ。water (水源)・flowing_water (流水)・lava (溶岩の源)・flowing_lava (溶岩の流れ)・empty (空)。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 役割 | ブロック / 流体 ID |
|---|---|---|
| Fluid | 流体の抽象。tick・randomTick・遅延・置き換えの可否の窓口 | (抽象) |
| FlowingFluid | 水と溶岩の共通処理。水位の決め直し・下へ・横へ・斜面の探索 | (抽象) |
| WaterFluid (Source / Flowing) | 水の定数と、壊したブロックのドロップ | water・flowing_water |
| LavaFluid (Source / Flowing) | 溶岩の定数・下の水を石にする・着火 (ランダム tick) | lava・flowing_lava |
| EmptyFluid | 空の流体 | empty |
| FluidState / Fluids | 流体の状態と 5 種の登録 | |
| LiquidBlock | 水と溶岩のブロック。LEVEL と流体の対応。溶岩と水の反応。泡柱の 20 gt の確認 | water・lava |
| BubbleColumnBlock | 泡柱。柱を上へ書き直す処理と 5 gt の予約 | bubble_column |
| SoulSandBlock / MagmaBlock | 26.3 では泡柱の処理を持たない (タグで参照されるだけ) | soul_sand・magma_block |
| SimpleWaterloggedBlock / LiquidBlockContainer / BucketPickup | 水を含むブロック・流体を受けるブロック・バケツで汲めるブロックの約束 | |
| KelpBlock・KelpPlantBlock・SeagrassBlock・TallSeagrassBlock | 流体を受けない LiquidBlockContainer (水を含むが水を足せない) | kelp ほか |
| SpongeBlock / WetSpongeBlock | 水の吸収と乾燥 | sponge・wet_sponge |
| FallingBlock / Fallable / ColoredFallingBlock / SandBlock | 落下ブロックの共通処理と着地のフック | sand・red_sand・gravel |
| ConcretePowderBlock / AnvilBlock / DragonEggBlock / BrushableBlock | 個別の落下ブロック | *_concrete_powder・anvil 3 種・dragon_egg・suspicious_sand・suspicious_gravel |
| ScaffoldingBlock | 足場。距離の計算と落下 | scaffolding |
| SpeleothemBlock / PointedDripstoneBlock / SulfurSpikeBlock | 落ちる鍾乳石 (両方)。大釜への滴下は PointedDripstoneBlock だけが持つ (SulfurSpikeBlock は滴下しない) | pointed_dripstone・sulfur_spike |
| FallingBlockEntity | 落下ブロックのエンティティ (概要だけ) | falling_block |

挙動を決めるために呼び出し先も読んだ。

| クラス | 読んだ所 |
|---|---|
| ServerLevel | #tick (ブロック予約 → 流体予約の順)、#tickFluid、#tickBlock |
| LevelChunkTicks | #schedule (先勝ち)、#poll (取り出した時点で重複の集合から消す) |
| ScheduledTickAccess | 流体用の scheduleTick の 2 つの入口 |
| LevelChunk | #setBlockState (onPlace がプロパティだけの変化でも呼ばれること) |
| BlockBehaviour | #isSolid の元の計算、#liquid、#canBeReplaced の 2 つの版 |
| Shapes | #mergedFaceOccludes (流体が面を通れるか) |
| BlockPos | #breadthFirstTraversal (スポンジ) |
| CollectingNeighborUpdater | #addAndRun (スポンジの入れ子) |
| BucketItem | #emptyContents (バケツ・ディスペンサーで流体を置く所) |
| DispenseItemBehavior | 中身入りのバケツの振る舞い (emptyContents の戻り値でバケツを空にするか決める) |
| SnowLayerBlock | #canBeReplaced (落下ブロックが雪に着地するとき) |
| Level | #destroyBlock (26.4-pre-1 の流体の壊し方との比較) |
| AbstractCauldronBlock / CauldronBlock / LayeredCauldronBlock | #tick と滴下の受け取り |
| PistonMovingBlockEntity | 着地で WATERLOGGED を外す所 |
| data/minecraft/tags | block の washed_away_by_fluids・enables_bubble_column_push_up・enables_bubble_column_drag_down・blocks_fluid_flow、fluid の water・lava・bubble_column_can_occupy |

### 1.2 扱わない範囲と参照先

| 範囲 | 参照先 |
|---|---|
| tick のフェーズ順・ランダム tick の回し方 | → 01_tick-loop.md |
| 予約 tick のキュー・先勝ち・件数上限・保存形式 | → 02_scheduled-ticks.md |
| setBlock のフラグ、NC・SU・CU の順と入れ子 | → 04_set-block-and-updates.md |
| 水は導体でない・透過の扱い | → 05_signals-and-block-properties.md |
| 流体の変化を見るオブザーバー | → 08_torch-observer-redstone-block.md |
| ディスペンサーのバケツの手順 | → 12_dispenser-dropper-crafter.md |
| 押し反応 (水・泡柱は POPPED)・押した水を含むブロックの扱い | → 13_pistons.md |
| 大釜・コンポスターのアナログ値 | → 14_containers-hoppers-analog.md |
| エンティティの水中の動き・泡柱で押される動き・水流のアイテム運搬 | → 17_entities-interplay.md |
| 乱数・反復順・浮動小数の意味論 | → 18_determinism-java-semantics.md |
| 版差の全体表 | → 19_version-diffs.md |
| 強い硫黄 (potent_sulfur) の間欠泉 (上の水源を見る) | → 11_outputs.md §4.10 |

次は読んだが、回路への効きが小さいので深追いしない。氷が溶けて水になる (IceBlock はランダム tick。FrostedIceBlock は置いた時に 60〜120 gt、以後 20〜40 gt の予約)、サンゴが水を失って枯れる (予約 60〜99 gt)、農地の湿り、雪。

---

## 2. 全体像

### 2.1 一言で

- 流体は流体の予約 tick でだけ動く。ランダム tick で動くのは溶岩の着火だけである。
- 流体の予約はブロックの予約と**別のキュー**に入る。同じ gt では、ブロックの予約を全部回してから流体の予約を回す (L6 → L7)。
- 流体の予約の優先度は 26.3 では全部 NORMAL (0)。遅延は水 5、溶岩 30 (速い溶岩のディメンションでは 10)。
- 予約の種類は「水源 (water)」と「流水 (flowing_water)」で別物である。実行時に種類が違えば何もしない。
- 流体 tick 1 回でやることは 2 つ。流水なら周りから水位を決め直して書き換える。そのあと広がる。下が先で、下へ行けなければ横へ行く。
- 横の広がりは「近い穴」(下へ落ちられるマス) へ向かう。探す経路の長さは水で 5、溶岩で 3 まで。
- 流れ込めるのは、タグ washed_away_by_fluids のブロックと、水を含めるブロックだけである。前者は壊れる。水なら落とし物を出し、溶岩なら出さない。
- 泡柱は、ソウルサンドかマグマの上の水源ブロックが自分に積む 20 gt のブロック予約で生まれる。崩れや向きの変化は泡柱自身の 5 gt のブロック予約で起き、柱全体が同じ gt に書き換わる。
- 落下ブロックは、置かれた時と SU のたびに 2 gt の予約を積む。その時に下が空いていれば落下エンティティになる。着地はエンティティ相 (L12) で起きる。
- スポンジは置かれた時と NC のたびに、水を幅優先で最大 64 マス消す。最外で置くと吸収が入れ子になり、合計は 64 を超えうる (最大 128。§5.5)。

### 2.2 1 gt の中の位置

| 相 | この範囲で起きること |
|---|---|
| L6 ブロックの予約 | 泡柱の書き直し (泡柱 5 gt・水源ブロック 20 gt)、落下の開始 (2 gt)、足場の再計算 (1 gt)、つららの落下 (2 gt)・石筍の破壊 (1 gt)、大釜の滴下 (50 + 落下距離) |
| L7 流体の予約 | 水と溶岩の水位の決め直しと広がり。泡柱や水を含むブロックの「水源としての」広がり |
| L9 ランダム tick | 溶岩の着火 (LavaFluid#randomTick)。大釜への滴下の抽選 (PointedDripstoneBlock#randomTick) |
| L10 ブロックイベント | ピストンが水を壊す・水を含むブロックを動かす (→ 13) |
| L12 エンティティ | 落下エンティティの移動と着地 |
| L13 BlockEntity | moving_piston の着地。着地したスポンジや砂の設置フック (→ 13) |

[26.3 読解: ServerLevel#tick]

### 2.3 流体 tick 1 回の流れ

1. ServerLevel#tickFluid が、その位置の今の blockstate から流体の状態を取る。予約の種類と同じ種類でなければ何もしない。
2. FlowingFluid#tick が呼ばれる。
3. 流水なら、周り 4 方向と上 (水源化の判定では真下も) から新しい状態を決める (FlowingFluid#getNewLiquid)。
   - 空になるなら空気にする (フラグ 3)。
   - 変わるなら新しい状態の流体ブロックを書く (フラグ 3) → 同じ位置に新しい種類の予約を積む。
   - 変わらないなら何もしない。予約もしない。
4. 新しい状態で広がる (FlowingFluid#spread)。
   1. 下へ行けるなら下へ書く。その時、横の水源が 3 個以上あれば横へも広がる。どちらにしても終わる。
   2. 下へ行けないとき、水源であるか、下が「穴」でなければ横へ広がる。
5. 書き込みはどれもフラグ 3 で、相手の設置フックが次の予約を積む。これで 5 gt (溶岩は 30 gt) ごとに 1 マスずつ進む。

### 2.4 泡柱の流れ

1. 水源ブロックの真下がソウルサンドかマグマになると、水源ブロックが自分に 20 gt のブロック予約を積む。契機は水源ブロックの onPlace・NC・下からの SU。
2. 20 gt 後、まだ水源なら、そこから上へ泡柱を書く。上向き (soul_sand) か下向き (magma_block) かは真下で決まる。
3. 泡柱の 1 マスが SU を受けると、次の 3 つのどれかなら、そのマスに 5 gt のブロック予約を積む。存続できない (真下が泡柱でもソウルサンドでもマグマでもない)、更新が下から来た、更新が上から来て上が「泡柱を置ける水源」になった。
4. 5 gt 後、そのマスから上へ、真下で決まる状態を書き続ける。書き込みはフラグ 2 (NC 無し・SU 有り)。柱全体が同じ gt に変わり、隣のオブザーバーは気づく。
5. 泡柱は SU のたびに水の流体予約 (5 gt) も積む。泡柱は水源として横へ広がる。

### 2.5 落下ブロックの流れ

1. 置かれた時 (onPlace) と、どの方向の SU でも、2 gt のブロック予約を積む (ドラゴンの卵は 5 gt)。
2. 予約の tick に、真下が「空き」(空気・火・液体・置き換えできるブロック) で、高さが世界の下限以上なら落下エンティティを作る。
3. 元のマスは、ブロックが含んでいた流体 (水を含んでいれば水源、でなければ空気) にフラグ 3 で書き換わる。
4. エンティティは同じ gt の L12 から動き始め、重力 0.04 と抵抗 0.98 で落ちる [要実機: 最初に動く gt]。
5. 着地した gt に、置けるならブロックとしてフラグ 3 で置く。置けなければアイテムになる。

### 2.6 スポンジの流れ

1. 置かれた時 (元が別のブロックのとき) と、どの NC でも、吸収を試みる。
2. スポンジから enum 順で幅優先に、水を含むマスだけをたどる。深さ 6、件数 65 (起点を含む) で止める。
3. 水源は汲み取り、流水は空気にし、水を含むブロックは水を抜き、昆布と海草は壊す。
4. 1 マスでも消えたら、スポンジを濡れたスポンジにフラグ 2 で書き換える。

### 2.7 流体の予約とブロックの予約の順

1. 同じ gt では、L6 でブロックの予約を (優先度, 予約順) で全部回す。そのあと L7 で流体の予約を集めて、予約順で回す (流体はどれも NORMAL)。どちらの列も、1 gt に集めるのは 65536 件までである (→ 02)。
2. 流体の予約は L6 が終わってから集めるので、L6 の中で遅延 0 の流体予約を積めば同じ gt の L7 で走る。26.3 のブロックが積む流体予約は 5 / 30 / 10 なので、ふつうは起きない (→ 02)。
3. L7 の中で積んだブロックの予約は、遅延 1 以上なので次の gt 以降の L6 で走る。
4. 同じマスにブロックの予約と流体の予約が 1 件ずつ共存できる。泡柱の 1 マス (泡柱 5 gt と水 5 gt)、水源ブロック (泡柱の確認 20 gt と水)、水を含んだ足場 (足場 1 gt と水) などである。同じ gt に来たら、ブロックの方が先に走る。
5. 例: 泡柱の 1 段を汲み取ると、穴の上の段は 5 gt 後の L6 で水源に戻り、同じ gt の L7 でその水が穴へ落ちる [実機 1.21.1: bubble-column-refill]。

---

## 3. 状態とデータ

### 3.1 流体の種類と状態 (26.3)

| 種類 | ID | 水源か | 量 (amount) | プロパティ |
|---|---|---|---|---|
| EmptyFluid | empty | 偽 | 0 | なし |
| WaterFluid.Source | water | 真 | 常に 8 | FALLING |
| WaterFluid.Flowing | flowing_water | 偽 | LEVEL の値 (1〜8) | FALLING・LEVEL |
| LavaFluid.Source | lava | 真 | 常に 8 | FALLING |
| LavaFluid.Flowing | flowing_lava | 偽 | LEVEL の値 (1〜8) | FALLING・LEVEL |

- 「同じ種類か」(isSame) は水どうし・溶岩どうしで真になる。予約の照合 (ServerLevel#tickFluid) は登録物の同一性で、水源と流水を区別する [26.3 読解: Fluid#isSame・TypedInstance#is]。
- 流体タグ water は water と flowing_water、lava は lava と flowing_lava。bubble_column_can_occupy は water (水源) だけ。
- 流体ブロック以外の流体: 水を含むブロック (WATERLOGGED が真)、泡柱、昆布・海草はどれも water の水源 (FALLING 偽) を返す [26.3 読解: 各 getFluidState]。

### 3.2 流体ブロックの LEVEL と流体の対応

LiquidBlock は LEVEL (0〜15) を持ち、流体の状態へ次のように写す [26.3 読解: LiquidBlock のコンストラクタ・#getFluidState]。

| LEVEL | 流体の状態 |
|---|---|
| 0 | 水源 (FALLING 偽) |
| 1〜7 | 流水。量は 8 − LEVEL (7〜1)。FALLING 偽 |
| 8〜15 | 流水。量 8。FALLING 真 (9〜15 は 8 と同じ状態に写る) |

逆向き (流体 → LEVEL) は FlowingFluid#getLegacyLevel。水源は 0、流水は「8 − 量」に、FALLING なら 8 を足す。
広がりが作る落下水は量 8 で FALLING 真なので LEVEL 8 になる。LEVEL 9〜15 は /setblock か古いワールドでしか現れない。
その状態の流体 tick は量 8 の落下水と同じ状態を返すので、書き換えが起きず LEVEL 9〜15 のまま残る [26.3 読解: FlowingFluid#tick の同一性の比較]。

流体の高さは「量 ÷ 9」(水源は 8/9)。真上が同じ種類の流体なら 1.0 [26.3 読解: FlowingFluid#getHeight・#getOwnHeight]。

### 3.3 定数

| 名前 | 値 | 典拠 |
|---|---|---|
| 水の遅延 | 5 gt | WaterFluid#getTickDelay |
| 溶岩の遅延 | 30 gt。速い溶岩 (環境属性 gameplay/fast_lava。ネザーで真) なら 10 gt | LavaFluid#getTickDelay |
| 溶岩の 4 倍遅延 | 水位が上がり、新旧とも落下でないとき、確率 3/4 で遅延 × 4。ただし実際には効かない (§5.2) | LavaFluid#getSpreadDelay |
| 斜面の探索の深さ | 水 4。溶岩 2 (速い溶岩 4) | WaterFluid / LavaFluid #getSlopeFindDistance |
| 1 マスで減る量 | 水 1。溶岩 2 (速い溶岩 1) | #getDropOff |
| 水が溶岩を置き換えられる高さ | 溶岩の高さ 4/9 以上 (量 4 以上か、真上が溶岩) | LavaFluid#canBeReplacedWith |
| 面の判定のキャッシュ | 直近 200 組 (動的な形のブロックは使わない) | FlowingFluid の OCCLUSION_CACHE |
| 泡柱の確認 (水源ブロック) | 20 gt | LiquidBlock の BUBBLE_COLUMN_CHECK_DELAY |
| 泡柱の作り直し | 5 gt | BubbleColumnBlock の CHECK_PERIOD |
| 落下の遅延 | 2 gt。ドラゴンの卵 5 gt。怪しげな砂・砂利 2 gt | FallingBlock#getDelayAfterPlace・BrushableBlock |
| 足場の再計算 | 1 gt | ScaffoldingBlock |
| 足場の最大距離 | 7 (7 で支えなし) | ScaffoldingBlock |
| 鍾乳石の予約 | 下向き (つらら) は 2 gt 後に落ちる。上向き (石筍) は 1 gt 後に壊れる (落とし物あり) | SpeleothemBlock#updateShape・#tick |
| スポンジの探索 | 1 回の探索で深さ 6、件数 65 (起点込み。消すのは最大 64)。最外で置くと探索が 2 回重なる (§5.5) | SpongeBlock#removeWaterBreadthFirstSearch・BlockPos#breadthFirstTraversal |
| 落下エンティティ | 重力 0.04/gt、抵抗 0.98 (float)、大きさ 0.98 × 0.98 | FallingBlockEntity・Entity#getAirDrag・EntityTypes |
| 落下エンティティの寿命 | 地面に着いていない間に、time が 100 を超えてマスの y が世界の下限以下か上限を超えたとき、または time が 600 を超えたときに消える (落とし物が許されればアイテム) | FallingBlockEntity#tick |
| 金床の落下ダメージ | 1 ブロックあたり 2、上限 40。劣化の確率 0.05 + 0.05 × (落下距離 − 1 の切り上げ) | AnvilBlock#falling・FallingBlockEntity#causeFallDamage |
| 大釜への滴下 | 抽選は水 0.17578125、溶岩 0.05859375。予約の遅延 50 + 落下距離 | PointedDripstoneBlock#maybeTransferFluid |

### 3.4 ゲームルールと環境属性

| 名前 | 既定 | 効き方 |
|---|---|---|
| water_source_conversion | 真 | 水の水源化 (2 水源の規則) を許す |
| lava_source_conversion | 偽 | 溶岩の水源化を許す |
| entity_drops | 真 | 落下エンティティがアイテムになるか |
| gameplay/fast_lava | 偽 (ネザーは真) | 溶岩の遅延・減り方・探索の深さ |
| gameplay/water_evaporates | 偽 (ネザーは真) | 濡れたスポンジがすぐ乾く。バケツで水を置けない |

### 3.5 タグ (26.3 のデータ)

| タグ | 中身 (レッドストーンに関わる所) | 使う所 |
|---|---|---|
| block washed_away_by_fluids | redstone_wire・redstone_torch・redstone_wall_torch・repeater・comparator・lever・#buttons・tripwire・tripwire_hook・#rails・#skulls と壁の頭・torch 類・#wool_carpets・#flower_pots・snow・cobweb・end_rod・scaffolding・heavy_core・big_dripleaf・#air・water・lava ほか植物類 (入れ子のタグを展開すると約 250) | FlowingFluid#canHoldAnyFluid だけ |
| block enables_bubble_column_push_up | soul_sand | 泡柱 (上向き) |
| block enables_bubble_column_drag_down | magma_block | 泡柱 (下向き) |
| block blocks_fluid_flow | #blocks_motion と #all_signs | 流れの向き (エンティティを押す向き) だけ (→ 17) |
| fluid bubble_column_can_occupy | water | 泡柱を置ける水 |

washed_away_by_fluids に入っていても、LiquidBlockContainer なら先にそちらの判定が効く。
レール・足場・heavy_core・big_dripleaf・ろうそく・サンゴなどは水を含むブロックなので、タグは実質効かない [26.3 読解: FlowingFluid#canHoldAnyFluid]。

### 3.6 保存されるもの

- 流体の予約はチャンク NBT の fluid_ticks に入る。i は流体の ID (minecraft:water・minecraft:flowing_water・minecraft:lava・minecraft:flowing_lava)。形式は → 02。
- 流体そのものはブロックの状態 (LEVEL・WATERLOGGED) だけで表す。BlockEntity は無い。
- 落下エンティティは BlockState・Time・DropItem・HurtEntities・FallHurtAmount・FallHurtMax・TileEntityData (任意)・CancelDrop を保存する [26.3 読解: FallingBlockEntity#addAdditionalSaveData]。

---

## 4. 処理の詳細

### 4.1 流体の予約を積む所

どれも優先度の引数を渡さない。だから NORMAL (0) である [26.3 読解: 全 scheduleTick の呼び出し]。

| 契機 | 典拠 | 種類 | 遅延 | 条件 |
|---|---|---|---|---|
| 流体ブロックが置かれた | LiquidBlock#onPlace | その位置の流体 | 水 5・溶岩 30/10 | 溶岩が水で固まらなかった (§4.10) |
| 流体ブロックへの NC | LiquidBlock#neighborChanged | 同じ | 同じ | 同じ |
| 流体ブロックへの SU | LiquidBlock#updateShape | 同じ | 同じ | 自分が水源か、更新元が水源 |
| 流水の水位が変わった | FlowingFluid#tick | 新しい流体 | FlowingFluid#getSpreadDelay | 空にならない。設置フックの予約と重なるので、実際は先勝ちで捨てられる |
| 水を入れた | SimpleWaterloggedBlock#placeLiquid ほか (焚き火・ろうそく・乾いたガスト) | 入れた流体 | 流体の遅延 | 水を含んでいなかった |
| 水を含むブロックへの SU | 各クラスの updateShape (→ 02 §4.9 の一覧) | water | 5 | WATERLOGGED が真 |
| トラップドアの開閉と、信号の変化 (POWERED が変わった NC。開閉しなくても) | TrapDoorBlock#toggle・#neighborChanged | water | 5 | WATERLOGGED が真 |
| 泡柱への SU | BubbleColumnBlock#updateShape | water | 5 | 無条件 |

この範囲のブロックの予約 (どれも NORMAL):

| ブロック | 遅延 | 契機 |
|---|---|---|
| 水源ブロック (LiquidBlock としてのブロック予約) | 20 | 泡柱を置ける水源で、真下がソウルサンドかマグマ (§4.13) |
| 泡柱 | 5 | §2.4 の 3 条件 |
| 落下ブロック | 2 (ドラゴンの卵 5) | 置かれた時と、全方向の SU |
| 怪しげな砂・砂利 | 2 | 同じ |
| 足場 | 1 | 置かれた時と、全方向の SU |
| 鍾乳石 | 2 / 1 | 支えの側からの SU で存続できない |
| 大釜 | 50 + 落下距離 | 鍾乳石の滴下の抽選に当たった |

### 4.2 ServerLevel#tickFluid

1. 位置の今の blockstate を読み、その流体の状態を得る。
2. 流体の種類が予約の種類と同一なら FluidState#tick を呼ぶ。引数はワールド・位置・今の blockstate。
3. 違えば何もしない。

流水の予約が残ったまま、そのマスが水源になった場合、流水の予約は空振りする。水源の予約は別に積まれる (§5.1)。

### 4.3 FlowingFluid#tick

契機: 流体の予約 tick。

1. 水源なら手順 2 を飛ばす。
2. 流水なら:
   1. 今の blockstate を読み直し、新しい状態を FlowingFluid#getNewLiquid で決める。
   2. 遅延を FlowingFluid#getSpreadDelay で決める (水は 5。溶岩は §5.2)。
   3. 新しい状態が空なら、空気をフラグ 3 で書く。手元の状態も空と空気にする。
   4. 新しい状態が今と違えば (状態の同一性で比べる)、その流体ブロックをフラグ 3 で書く。続けて、その位置に新しい種類で予約を積む。
   5. 同じなら何もしない。
3. 手元の状態で FlowingFluid#spread を呼ぶ。

要点:

- 手順 2.4 の書き込みの中で LiquidBlock#onPlace が走り、同じ (位置, 種類) の予約を先に積む。後の予約は先勝ちで捨てられる [26.3 読解: LevelChunk#setBlockState・LevelChunkTicks#schedule]。
- 書き込みの中の順は「設置フック → NC → SU」である (→ 04 §2.1)。水位の変化はまず NC で、次に SU で周りへ届く。
- 手順 3 の spread は書き込みの後の状態を手元の変数で使う。書き込みの連鎖でそのマスが別のものに変わっていても読み直さない。

### 4.4 FlowingFluid#getNewLiquid

引数は位置と、その位置の blockstate (流れ込む先として調べるときは相手のマスの状態)。

1. 水平順に 4 つの隣を見る。隣の流体が同じ種類で、隣との面を通れる (§4.7 の canPassThroughWall) なら数える。
   - 水源なら水源の数に 1 を足す。
   - 「隣の量の最大」を更新する (水源は 8)。
2. 水源が 2 個以上で、水源化がゲームルールで許されていれば、真下を見る。真下が固体 (isSolid) か、同じ種類の水源なら、水源 (FALLING 偽) を返す。
3. 真上の流体が同じ種類で、上との面を通れるなら、量 8 の落下水を返す。
4. 「隣の量の最大 − 減る量」が 0 以下なら空、そうでなければその量の流水 (FALLING 偽) を返す。

- 水源化 (手順 2) は落下水 (手順 3) より先に判定する。上に水があっても、2 水源と固体の床がそろえば水源になる。
- 「固体」は BlockBehaviour の元の判定である。forceSolidOn なら真、forceSolidOff なら偽。それ以外は当たり判定が空なら偽、当たり判定の外接箱の 3 辺の平均が 0.7291666… 以上なら真、高さが 1 以上なら真 [26.3 読解: BlockStateBase#calculateSolid]。下付きハーフ・感圧板・日照センサーの上では水源ができる。リピーター・カーペットの上ではできない。
- 隣の数え方には水を含むブロック・泡柱・昆布も水源として入る。

### 4.5 FlowingFluid#spread

1. 流体が空なら終わる。
2. 真下を見る。「下へ行けそうか」(canMaybePassThrough) を確かめる。真下が同じ種類の水源でない、真下が流体を受けられる (§4.7 の canHoldAnyFluid)、下の面を通れる、の 3 つである。
3. 行けそうなら、真下の新しい状態を getNewLiquid で決める。
   真下の今の流体が「上から新しい種類で置き換えられる」(canBeReplacedWith) かつ、真下がその種類を受けられる (canHoldSpecificFluid) なら:
   1. 真下へ書く (FlowingFluid#spreadTo)。
   2. 自分の水平の隣の、同じ種類の水源が 3 個以上なら、横へも広がる (spreadToSides)。この数え方 (sourceNeighborCount) は面の判定をしない。
   3. 終わる。
4. 下へ書けなかったとき、自分が水源か、真下が「穴」でなければ (§4.6 の isWaterHole)、横へ広がる。

- 空中に置いた水源は下へ落ちるだけで、横へは広がらない (横の水源が 3 個以上のときを除く)。
- 流水は、真下が同じ種類の流体 (流水でも水源でも) なら横へ広がらない。真下が同じ種類の流体なら穴とみなすからである。落下水の柱が途中で横へ漏れないのはこのためである。

### 4.6 横の広がり

**FlowingFluid#spreadToSides**

1. 「自分の量 − 減る量」を求める。落下水なら 7 とする。
2. 0 以下なら何もしない。
3. FlowingFluid#getSpread で行き先と新しい状態の組を得る。
4. 組を **enum 順 (北・南・西・東)** に回し、行き先の今の blockstate を読んで spreadTo を呼ぶ。行き先を書き込みの前に確かめ直さない。

組は EnumMap なので、反復順は方向の宣言順である。getSpread の調べる順 (水平順: 北・東・南・西) とは違う [26.3 読解: FlowingFluid#spreadToSides・#getSpread]。

**FlowingFluid#getSpread**

1. 最小距離を 1000、結果を空にする。
2. 水平順に 4 つの隣を見る。
   1. 「行けそうか」(canMaybePassThrough) が偽なら飛ばす。
   2. 隣の新しい状態を getNewLiquid で決める。隣がその種類を受けられなければ飛ばす。
   3. 隣が穴なら距離 0。そうでなければ getSlopeDistance で距離を求める (経路 1、来た向きはこの方向の反対)。
   4. 距離が最小より小さければ結果を空にする。
   5. 距離が最小以下なら、隣の今の流体が新しい種類で置き換えられるときだけ結果に入れる。置き換えられなくても最小距離は更新する。
3. 結果を返す。

置き換えられない隣 (既にある同じ種類の流水など) も最小距離の計算には入る。近くに穴がある流水が隣にあると、ほかの方向へ広がらない。

穴がどこにも見つからない方向の距離は 1000 である。全方向が 1000 なら同点なので、置き換えられる方向すべてへ広がる。平らな床の上で四方へ広がるのはこのためである [26.3 読解: FlowingFluid#getSpread]。

**FlowingFluid#getSlopeDistance** (位置・経路・来た向き・状態・探索の文脈)

1. 最小を 1000 とする。
2. 来た向きを除く水平順の 3 方向を見る。
   1. その先が「通れる」(canMaybePassThrough かつ、流水の種類を受けられる) でなければ飛ばす。
   2. その先が穴なら、すぐ今の経路の値を返す。
   3. 経路が探索の深さ未満なら、その先から経路 + 1 で再帰し、最小を更新する。
3. 最小を返す。

訪問済みの印は無い。経路は来た向きだけを除いて分かれる。穴の値は「穴までの経路長 − 1」になる。
水 (深さ 4) は経路長 5 まで、溶岩 (深さ 2) は経路長 3 までの穴を見つける。

**FlowingFluid#isWaterHole** (上のマスと下のマス)

1. 上から下の面を通れなければ偽。
2. 下の流体が同じ種類なら真。
3. そうでなければ、下が「流水の種類を受けられる」(canHoldAnyFluid かつ canHoldSpecificFluid) なら真。

水を含んでいない「水を含めるブロック」(レール・ハーフなど) は流水を受けないので、穴にならない。水を含んだものと昆布・海草は、同じ種類の流体として穴になる (面を通れる場合)。
ダストやトーチのような洗い流されるブロックの上のマスも穴である。流水はそのマスへ寄っていき、下へ落ちて部品を壊す。

**SpreadContext** (探索の文脈) は 1 回の getSpread の間だけ生きる。座標の (x, z) を「起点からの差 + 128」の下位 8 ビットずつ並べた 16 ビットで鍵にして、ブロックの状態と穴の判定を覚える。y は鍵に入らないが、探索は同じ高さだけを回るので衝突しない [26.3 読解: FlowingFluid.SpreadContext]。

### 4.7 通れるか・入れるかの判定

| 判定 | 中身 | 典拠 |
|---|---|---|
| canPassThroughWall | 相手の当たり判定がフルブロックなら偽。自分がフルブロックなら偽。両方とも空なら真。それ以外は、境目の面の両側の断面を合わせて面全体を覆うなら偽 (Shapes#mergedFaceOccludes) | FlowingFluid#canPassThroughWall |
| canHoldAnyFluid | LiquidBlockContainer なら真。それ以外はタグ washed_away_by_fluids に入っていれば真 | FlowingFluid#canHoldAnyFluid |
| canHoldSpecificFluid | LiquidBlockContainer ならその canPlaceLiquid に任せる。それ以外は真 | FlowingFluid#canHoldSpecificFluid |
| isSourceBlockOfThisType | 同じ種類の水源 | FlowingFluid#isSourceBlockOfThisType |
| canMaybePassThrough | 相手が同じ種類の水源でない、相手が canHoldAnyFluid、面を通れる、の 3 つ | FlowingFluid#canMaybePassThrough |
| canBeReplacedWith (水) | 下向きで、新しい流体が水でないときだけ真 | WaterFluid#canBeReplacedWith |
| canBeReplacedWith (溶岩) | 溶岩の高さが 4/9 以上で、新しい流体が水のときだけ真 | LavaFluid#canBeReplacedWith |
| canBeReplacedWith (空) | いつも真 | EmptyFluid#canBeReplacedWith |
| canPlaceLiquid (水を含むブロック) | 種類が water (水源) のときだけ真。flowing_water は偽 | SimpleWaterloggedBlock#canPlaceLiquid |
| canPlaceLiquid (昆布・海草) | いつも偽 | KelpBlock ほか |

- 当たり判定は「文脈なし」で取る。流体ブロックの当たり判定は空になる [26.3 読解: LiquidBlock#getCollisionShape]。
- 面の判定は、負の側のブロックが境目まで届いていなければその側を空とみなし、正の側も同じようにして、2 つの断面の和が面全体を覆うかで決める [26.3 読解: Shapes#mergedFaceOccludes]。上付きハーフは上の面を塞ぎ、下の面を塞がない。下付きハーフはその逆である。
- 水は既存の水へ流れ込まない。横は置き換え不可、下も新しい流体が水なので置き換え不可だからである。既存の流水は、NC か SU で積まれた自分の予約で水位を決め直す。

### 4.8 FlowingFluid#spreadTo (書き込みと壊し方)

1. 相手が LiquidBlockContainer なら、その placeLiquid に任せて終わる。
2. 相手が空気でなければ beforeDestroyingBlock を呼ぶ。
   - 水: 相手のブロックの落とし物を出す (BlockEntity があれば添える) [26.3 読解: WaterFluid#beforeDestroyingBlock]。
   - 溶岩: 煙と音のレベルイベント 1501 を出すだけ。落とし物は出ない [26.3 読解: LavaFluid#beforeDestroyingBlock]。
3. 流体ブロックをフラグ 3 で書く。

- 壊したブロックの撤去フックは、この書き込みの中で走る (ブロックが変わるので → 04 §4.2)。ダストやトーチが消えれば、その撤去フックが周りへ NC を出す。
- 洗い流しそのものはゲームイベント (BLOCK_DESTROY) を出さない。壊すパーティクルも出ない [26.3 読解]。落とし物のアイテムが起こす振動は別の話である (→ 10・17)。[版差 26.4-pre-1] では BLOCK_DESTROY が出る (§6)。
- 溶岩は下向きだけ LavaFluid#spreadTo で横取りする (§4.10)。

### 4.9 LiquidBlock

**onPlace** (状態が変わるたび。プロパティだけの変化でも呼ばれる)

1. 溶岩なら、水との反応を確かめる (§4.10)。固まったら手順 2 を飛ばす。
2. その位置の流体の種類で、流体の遅延の予約を積む。
3. 泡柱を置ける水源 (§4.13) なら、真下を見て 20 gt のブロック予約を積むか決める。

**neighborChanged**: onPlace と同じ 3 手順。送り元のブロックは見ない。

**updateShape**

1. 自分が水源か、更新元が水源なら、流体の遅延の予約を積む。
2. 更新が下から来て、自分が泡柱を置ける水源なら、更新元 (新しい真下) を見て 20 gt のブロック予約を積むか決める。
3. 状態は変えない。

**tick** (ブロックの予約。泡柱の確認だけ): 泡柱を置ける水源なら、ここを起点に泡柱を書く (BubbleColumnBlock#updateColumn)。

**pickupBlock** (バケツ・スポンジ): LEVEL 0 のときだけ空気をフラグ 11 で書き、バケツを返す。流水は汲めない。

その他: 落とし物は無い。当たり判定は流水なら空、水源でも生き物以外には空。押し反応は POPPED (→ 13)。

### 4.10 溶岩と水の反応

**LiquidBlock の溶岩の確認** (onPlace と NC で呼ばれる。予約ではなくその場で起きる)

1. 真下がソウルソイル (soul_soil) かを覚える。
2. 上・北・南・西・東の順に隣を見る (下・南・北・東・西の反対側)。真下は見ない。
   1. 隣の流体が水 (タグ water。水を含むブロックと泡柱も入る) なら、自分のマスを、自分が水源なら黒曜石、流れなら丸石にフラグ 3 で書く。レベルイベント 1501 を出す。終わる。
   2. 真下がソウルソイルで、隣が青氷なら、玄武岩にフラグ 3 で書く。イベント 1501。終わる。
3. どれも無ければ、予約を積んでよいと答える。

方向ごとに「水 → 青氷」の順で調べるので、先に見る方向の条件が勝つ。

**LavaFluid#spreadTo** (溶岩が下へ流れるとき)

1. 下向きで、下のマスの流体が水なら:
   1. 下のマスが流体ブロック (LiquidBlock) なら石にフラグ 3 で書く。
   2. イベント 1501 を出して終わる。溶岩は置かない。
2. それ以外は §4.8 の共通処理。

- 溶岩は横へは水に流れ込まない (水の canBeReplacedWith が下向きだけ真)。
- 溶岩は水を含めるブロックへ入らない (下へも横へも。canPlaceLiquid が偽)。真下が水を含んだブロックでも石にならない。泡柱へも流れ込まない (泡柱はタグにも LiquidBlockContainer にも入らない)。
- 水が溶岩のマスへ流れ込むのは、溶岩の高さが 4/9 以上のときに許される。ただし水が隣に来た時点で溶岩は NC を受けて固まるので、ふつうは先に黒曜石か丸石になる。
- 丸石・黒曜石・石・玄武岩は予約を通さず、NC の中や流体 tick の中で即座に書かれる。

### 4.11 水を含むブロック

**入れ方**

| 経路 | 結果 |
|---|---|
| バケツ・ディスペンサー | BucketItem#emptyContents が placeLiquid を呼ぶ (→ 12) |
| 水源化 | 隣に水源が 2 個以上・真下が固体か水源のとき、getSpread の新しい状態が water になり、placeLiquid が呼ばれる |
| 流水 | 入らない。canPlaceLiquid が flowing_water を断る |
| 落下エンティティの着地 | 着地マスの流体が water (水源) なら WATERLOGGED を真にして置く |
| プレイヤーが水の中に置く | 各ブロックの getStateForPlacement (→ 各メモ) |

SimpleWaterloggedBlock#placeLiquid: 水を含んでおらず、入れる流体が water なら、WATERLOGGED を真にしてフラグ 3 で書き、流体の遅延で予約を積む。

**抜き方**

| 経路 | 結果 |
|---|---|
| バケツ・スポンジ | SimpleWaterloggedBlock#pickupBlock。WATERLOGGED を偽にしてフラグ 3 で書く。存続できなくなれば壊す (落とし物あり) |
| ピストンで動かす | 着地で WATERLOGGED を偽にする [26.3 読解: PistonMovingBlockEntity]。→ 13 |
| 落下エンティティになる | エンティティ側の状態から WATERLOGGED を外し、元のマスには水源を残す |

**振る舞い**: 水源として広がる。広がりの予約は各ブロックの updateShape が SU のたびに積む。NC では積まない (トラップドアの開閉などの例外は → 02 §4.9)。

**水を含めるブロック (26.3)**: レール 4 種・避雷針・スカルクセンサー 2 種・スカルクシュリーカー・チェスト類 (トラップチェスト・銅のチェスト・エンダーチェストを含む)・トラップドア・ハーフ・階段・塀・フェンス・鉄格子と板ガラス・看板 (吊り看板を含む)・はしご・足場・鎖・ランタン・ろうそく・焚き火・コンジット・大きなドリップリーフ (茎を含む)・小さなドリップリーフ・飾り壺・棚 (shelf)・銅のゴーレム像・heavy_core・鍾乳石と sulfur_spike・アメジストの芽・光源ブロック・バリア・葉・銅の格子・サンゴ類・シーピクルス・根 (hanging_roots・mangrove_roots)・マングローブの芽 (mangrove_propagule)・乾いたガスト・MultifaceBlock 系 (glow_lichen・sculk_vein・resin_clump) [26.3 読解: SimpleWaterloggedBlock の実装クラス]。

### 4.12 レッドストーン部品と流体 (26.3)

| 部品 | 水が来たとき | 溶岩が来たとき | 水で壊れたときの落とし物 | 根拠 |
|---|---|---|---|---|
| redstone_wire | 壊れて流体になる | 壊れて流体になる | redstone 1 個 | タグ |
| redstone_torch・redstone_wall_torch | 同上 | 同上 | redstone_torch | タグ |
| repeater | 同上 | 同上 | repeater | タグ |
| comparator | 同上 | 同上 | comparator | タグ |
| lever | 同上 | 同上 | lever | タグ |
| ボタン (#buttons) | 同上 | 同上 | そのボタン | タグ |
| tripwire | 同上 | 同上 | string | タグ |
| tripwire_hook | 同上 | 同上 | tripwire_hook | タグ |
| 頭 (#skulls と壁の頭) | 同上 | 同上 | その頭 | タグ |
| レール 4 種 | 流水は入らない。水源化の条件がそろえば水を含む | 入らない | — | 水を含むブロック |
| lightning_rod・sculk_sensor・calibrated_sculk_sensor・sculk_shrieker | 同上 | 入らない | — | 水を含むブロック |
| chest・trapped_chest・銅のチェスト・ender_chest | 同上 | 入らない | — | 水を含むブロック |
| トラップドア (木・鉄・銅) | 同上 | 入らない | — | 水を含むブロック |
| big_dripleaf・small_dripleaf・decorated_pot・shelf・copper_golem_statue | 同上 | 入らない | — | 水を含むブロック |
| 感圧板 (全種) | 入らない (水を止める) | 入らない | — | タグ外・入れ物でない |
| daylight_detector・observer・piston・sticky_piston・piston_head・moving_piston | 入らない | 入らない | — | 同上 |
| dispenser・dropper・crafter・hopper・note_block・target・redstone_lamp・redstone_block・copper_bulb・tnt | 入らない | 入らない | — | 同上 |
| lectern・bell・jukebox・ドア・フェンスゲート (開いていても) | 入らない | 入らない | — | 同上 |
| cake・candle_cake | 入らない | 入らない | — | 同上 (26.2 までも forceSolidOn で止めていた) |

- 「壊れて流体になる」は §4.8 の経路である。壊したブロックの撤去フックがフラグ 3 の書き込みの中で走る。ダスト網の再計算やトーチの消灯は、各メモの撤去フックの通りに起きる (→ 06・08)。
- 溶岩が壊したときは落とし物が出ない。煙のイベントだけである。
- バケツ (ディスペンサー) で置く経路は判定が違う (§4.19・§5.6)。

### 4.13 泡柱

**泡柱を置ける水源** (LiquidBlock の判定): 流体が bubble_column_can_occupy (water) で、水源で、量 8。

**LiquidBlock の 20 gt の予約** (tryScheduleBubbleBlockColumn): 真下が enables_bubble_column_drag_down か enables_bubble_column_push_up なら、自分 (水源ブロック) に遅延 20 のブロック予約を積む。真下が泡柱のときは積まない。

**BubbleColumnBlock#updateShape**

1. 自分の位置に水の流体予約 (5 gt) を積む。無条件。
2. 次のどれかなら、自分に遅延 5 のブロック予約を積む。
   - 存続できない。真下が泡柱・ソウルサンド・マグマのどれでもない (BubbleColumnBlock#canSurvive)。
   - 更新が下から来た。
   - 更新が上から来て、上が泡柱でなく、泡柱を置けるマス (下の canOccupy) である。
3. 状態は変えない。

NC の受け口は無い。BubbleColumnBlock は neighborChanged を上書きしていない [26.3 読解]。

**BubbleColumnBlock#tick**: 自分を起点に、今の真下で updateColumn を呼ぶ。

**BubbleColumnBlock#updateColumn** (起点・起点の状態・真下の状態)

1. 起点が「置けるマス」でなければ何もしない。置けるマスは、泡柱か、泡柱を置ける水源の流体ブロック (LiquidBlock に限る。水を含むブロックは不可)。
2. 書く状態を決める。
   - 真下が泡柱なら、真下と同じ状態。
   - 真下が push_up (soul_sand) なら上向き (DRAG 偽)。
   - 真下が drag_down (magma_block) なら下向き (DRAG 真)。
   - それ以外は、起点が泡柱なら水源ブロック、起点が水なら起点のまま。
3. 起点にフラグ 2 で書く。書けたかどうかは見ない。
4. 1 マス上へ進む。そこが置けるマスである限り、フラグ 2 で書く。書き込みが「変化なし」を返したら終わる。上へ進む。

- 柱全体が 1 回の呼び出しで書き換わる。140 段でも同じ gt である。
- フラグ 2 なので NC は出ない。SU は出る。隣のオブザーバーは各段の変化に気づく。下の段から順に SU が出るので、オブザーバーの予約も下から順に積まれる。
- 書き換えた各段の SU は、すぐ上の段の updateShape (下からの更新) を呼ぶ。上の段には 5 gt のブロック予約と水の予約が積まれる。5 gt 後に走るが、状態がそろっているので何も変えない。
- 水源ブロックに戻った段は LiquidBlock#onPlace で水の予約を積む。5 gt 後に横へ広がる。

**典型の時間** (26.3 の読み。fixture 名を付けた行は 1.21.1 の実機も同じ時間になる。泡柱の内側の規則は 1.21.1 と 26.3 で同じ)

| 操作 (gt 0) | 起きること |
|---|---|
| ソウルサンドの上に水源を置く | 水源ブロックが 20 gt の予約。20 gt 後に柱ができる |
| 水の柱の真下にソウルサンドを置く | 一番下の水源が NC と SU (下から) で 20 gt の予約 (2 つ目は重複で捨てる)。20 gt 後に柱ができる |
| 柱の途中を石で塞ぐ | 石の上の段が SU (下から) で 5 gt。5 gt 後に石より上が全部水源に戻る [実機 1.21.1: bubble-column-cut] |
| 柱の 1 段を汲み取る (空気にする) | 穴の上の段が 5 gt の予約と水の予約。5 gt 後の L6 で穴より上が水源に戻り、同じ gt の L7 で水が穴へ落ちる (落下水) [実機 1.21.1: bubble-column-refill] |
| 穴へ水源を置き直す | 穴の下の段が SU (上から・置けるマス) で 5 gt。5 gt 後に柱が上まで戻る。落下水が来ただけでは戻らない (置けるマスでない) [実機 1.21.1: bubble-column-refill-fast] |
| ソウルサンドをマグマに替える | 一番下の段が SU (下から) で 5 gt。5 gt 後に柱全体が下向きになる |
| ソウルサンドを取り去る | 同じく 5 gt 後に柱全体が水源に戻る。同じ gt の L7 で一番下の水が下へ落ちる |

ピストンでソウルサンドとマグマを入れ替える場合、5 gt の予約の時点で真下が moving_piston だと柱は崩れる。押し終わりの時間は → 13。

### 4.14 スポンジ

**SpongeBlock#onPlace**: 古い状態がスポンジでなければ吸収を試みる。
**SpongeBlock#neighborChanged**: どの NC でも吸収を試みる。

**吸収** (SpongeBlock#tryAbsorbWater)

1. BlockPos#breadthFirstTraversal で、スポンジから幅優先にたどる。隣は enum 順。訪問済みは座標の集合で持ち、取り出した時に印を付ける。
2. 各マスの判定:
   - 起点 (スポンジ) は受け入れる。
   - 流体が水でなければ飛ばす (その先へは広げない)。
   - BucketPickup で、汲み取りが空でない結果を返せば受け入れる。水源ブロックはフラグ 11 で空気、泡柱もフラグ 11 で空気、水を含むブロックは水を抜く (フラグ 3)。
   - 汲めない流体ブロック (流水) は空気をフラグ 3 で書いて受け入れる。
   - 昆布・昆布の茎・海草・背の高い海草は、落とし物を出してから空気をフラグ 3 で書いて受け入れる。
   - それ以外 (水を含むが汲めないもの) は飛ばす。
3. 受け入れたマスの数が 65 に達したら止める。受け入れたマスの深さが 6 未満なら、その隣を深さ + 1 で列に足す。
4. 受け入れた数が 2 以上 (1 マスでも消えた) なら、スポンジを wet_sponge にフラグ 2 で書き、音を鳴らす。

**WetSpongeBlock#onPlace**: gameplay/water_evaporates が真のマス (ネザー) なら、sponge にフラグ 3 で書き戻す。この書き込みの中で sponge の onPlace が吸収を試みる。そのあとイベント 2009 と音を出す (音の高さにワールドの乱数を 1 回使う。→ 18)。

入れ子の注意 (§5.5): 最外から置かれたスポンジは、最初に消した隣の水の NC で自分の neighborChanged が走り、入れ子の吸収が始まる。

### 4.15 落下ブロック (FallingBlock)

**onPlace**: 自分に遅延 getDelayAfterPlace (2。ドラゴンの卵 5) のブロック予約を積む。条件は無い。ピストンで着地した時も、プロパティだけ変わった時も積む。
**updateShape**: どの方向の SU でも同じ予約を積む。状態は変えない。
**tick**: 真下が空き (isFree) で、y が世界の下限以上なら、FallingBlockEntity#fall で落下エンティティを作り、falling フックを呼ぶ (金床はダメージを設定)。

**FallingBlock#isFree** (真下の状態)

| 真になるもの | 例 |
|---|---|
| 空気 | air・cave_air・void_air |
| タグ fire | fire・soul_fire |
| liquid が真 | water・lava・bubble_column (水位を問わない) |
| replaceable が真 | short_grass・fern・seagrass・vine・snow (層の数を問わない)・light・structure_void ほか |

ダスト・トーチ・レール・ボタン・カーペットは空きでない。その上の砂は落ちない。

**FallingBlockEntity#fall**

1. エンティティを作る。位置はマスの中心 (x + 0.5, y, z + 0.5)。持つ状態は元の状態から WATERLOGGED を外したもの。
2. 元のマスを、元の状態が含んでいた流体のブロック (水源か空気) にフラグ 3 で書く。
3. エンティティをワールドに足す。

### 4.16 落下エンティティ (概要)

1 回の tick (FallingBlockEntity#tick) の流れ。物理の詳細は → 17。

1. 持つ状態が空気なら消える。
2. time を 1 増やす。重力 (0.04) を足す。動く。中にいるブロックの効果を受ける (泡柱の押し上げなど。条件は → 17)。ポータルを処理する。
3. サーバー側で:
   1. コンクリートパウダーなら、今のマスの流体が水かを見る。速さの 2 乗が 1 を超えていれば、前の位置から今の位置まで水源を探し、当たればそのマスで止まったことにする。
   2. 地面に着いておらず、水で止まってもいないなら、寿命 (time が 100 を超えてマスの y が世界の下限以下か上限を超えた、または time が 600 を超えた) で消える。落とし物が許されていればアイテムになる。
   3. 着いたなら、速度に (0.7, −0.5, 0.7) を掛け、着いたマスを見る。
      - moving_piston なら何もしない。次の tick にまた判定する。
      - CancelDrop なら消え、onBrokenAfterFall を呼ぶ。落とし物は無い。
      - 置き換えられる (下向きの設置の文脈で canBeReplaced) かつ、存続できる (canSurvive かつ、まだ落ち続けない) なら置く。WATERLOGGED を持ち、マスの流体の種類が water (水源。flowing_water は含まない) なら真にする。フラグ 3 で書く。成功したら消え、onLand を呼び、TileEntityData を BlockEntity に重ねる。書き込みが失敗し、落とし物が許されていれば、消えて onBrokenAfterFall を呼び、アイテムになる。
      - 置けないなら消える。落とし物が許されていれば onBrokenAfterFall を呼び、アイテムになる。
4. 速度に抵抗 0.98 を掛ける。

「落とし物が許される」は DropItem が真で、ゲームルール entity_drops が真のときである。

**落ちる時間の目安** (真下に n マスの空気があり、その下が固体)。重力と抵抗だけで計算した値。最初の tick を 1 と数える。

| n | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| 着地する tick | 7 | 10 | 13 | 15 | 17 | 18 | 20 | 21 | 23 | 24 |

最初の tick がエンティティを作った gt の L12 なら、着地は作った gt から「表の値 − 1」gt 後になる [26.3 読解: ServerLevel のエンティティ登録は L12 の前に済む] [要実機]。
float の抵抗 (0.98F) と double の 0.98 で、200 マスまで着地の tick は変わらない。

- トーチ・ダスト・ボタンのマスに落ちると、その下の固体で着地し、マスが置き換えられないのでアイテムになる。下付きハーフの上も同じで、ハーフのマスで止まりアイテムになる。
- 着地マスが moving_piston の間は待つ (§5.6)。
- 雪 (snow) は層の数を問わず「空き」なので、上の砂は落ちる。ところが着地で置き換えられるのは 1 層のときだけである (SnowLayerBlock#canBeReplaced は、手に雪が無い文脈では層 1 だけ真)。2 層以上なら雪のマスで止まり、アイテムになる [26.3 読解: FallingBlock#isFree・SnowLayerBlock#canBeReplaced]。
- 置く書き込みが失敗し、落とし物が許されていないときは、エンティティは消えずに残る。

### 4.17 個別の落下ブロック

| ブロック | 違い | 典拠 |
|---|---|---|
| コンクリートパウダー | 設置時・着地時・SU で水に触れていればコンクリートになる。SU のときは updateShape がコンクリートを返す (書き込みは SU の結果の経路。NC は出ない → 04 §5.3)。着地時は「置き換えたマスが水だった」も条件に入る | ConcretePowderBlock#getStateForPlacement・#onLand・#updateShape・#touchesLiquid |
| 金床 3 種 | 落下中にダメージを与える (1 マス 2、上限 40)。着地の音 1031、壊れた音 1029。着地のダメージ判定で、エンティティの乱数により 1 段劣化することがある。damaged_anvil がさらに劣化すると CancelDrop | AnvilBlock#falling・#onLand・#onBrokenAfterFall・#damage、FallingBlockEntity#causeFallDamage |
| ドラゴンの卵 | 遅延 5 | DragonEggBlock#getDelayAfterPlace |
| 怪しげな砂・砂利 | tick で BlockEntity の掃除を先にする。落ちると CancelDrop。着地すると置かれず、壊れるパーティクル (2001) と BLOCK_DESTROY のゲームイベントを出す | BrushableBlock#tick・#onBrokenAfterFall |
| 足場 | FallingBlock ではない。onPlace と全方向の SU で 1 gt の予約 (水を含めば水の予約も)。tick で距離を決め直す。新しい距離が 7 なら、元も 7 なら落下エンティティ、元が 7 未満なら壊す (落とし物あり)。7 未満で状態が変われば フラグ 3 で書く | ScaffoldingBlock#tick・#getDistance |
| 鍾乳石 (pointed_dripstone・sulfur_spike) | 下向きのつららは、上の支えが無くなる SU で 2 gt の予約 (予約済みなら何もせず、太さの計算もしない)。tick で、予約を受けたマスから先端まで 1 マスずつ落下エンティティにする。この tick は支えを確かめ直さないので、予約のあとで支えが戻っても落ちる。上向きの石筍は 1 gt の予約で、tick で存続を確かめ直し、存続できなければ壊す (落とし物あり) | SpeleothemBlock#updateShape・#tick・#spawnFallingStalactite |

コンクリートパウダーの水の判定 (touchesLiquid) には癖がある。真下の水は「自分のマスが水を含むとき」しか見ない。パウダー自身は水を含まないので、**真下だけが水のときは固まらない**。横と上の水は、その面が水側から見て頑丈でなければ (水を含んだ階段の背などでなければ) 固まる [26.3 読解: ConcretePowderBlock#touchesLiquid]。

### 4.18 鍾乳石から大釜への滴下

1. ランダム tick が下向きの鍾乳石の一番上の段 (根元) に当たったとき、根元の真上の流体を見る。泥 (mud) は水とみなす (ネザーを除く)。種類が water (水源) か lava (源) でなければ終わる。流水では起きない。
2. 抽選 (水 0.17578125、溶岩 0.05859375) に当たり、先端から下 11 マス以内に受け取れる大釜があれば、大釜のマスに「大釜の今のブロック」で遅延 50 + 落下距離のブロック予約を積む。落下距離は先端の y − 大釜の y。泥なら大釜を探さず、泥を粘土にフラグ 3 で書く (BLOCK_CHANGE のゲームイベントあり)。
   - 先端と大釜の間のマスは、空気か、液体を含まず中央の幅 4/16 の柱を塞がないブロックでなければならない (PointedDripstoneBlock#canDripThrough)。
   - 予約は先勝ちなので、待っている間に当たった 2 回目は捨てられる。
3. 大釜の tick (AbstractCauldronBlock#tick) は、その時点で上のつららと流体を探し直す。受け取れれば 1 段増やす (空の大釜は水か溶岩の大釜に替わる)。書き込みはフラグ 3 で、BLOCK_CHANGE のゲームイベントを出す。水の大釜は水だけを受け、溶岩の大釜と粉雪の大釜は受けない [26.3 読解: CauldronBlock#receiveStalactiteDrip・LayeredCauldronBlock#canReceiveStalactiteDrip・#receiveStalactiteDrip]。
4. 予約の種類は大釜のブロックなので、間に大釜の種類が変わる (空 → 水入り) と予約は空振りする。

大釜の段数のアナログ値は → 14。

### 4.19 バケツ・ディスペンサーで流体を置くとき (概要)

BucketItem#emptyContents の要点だけ書く。ディスペンサーの手順は → 12。

1. 置く先が「流体で置き換えられる」(canBeReplaced に流体を渡す版。既定は replaceable か、固体でない) か、水を受けられる LiquidBlockContainer か、空気なら置ける。
2. ネザーで水なら煙を出して成功扱い (何も置かない)。
3. LiquidBlockContainer で、中身が水なら placeLiquid を呼ぶ (水を含ませる)。placeLiquid の結果は見ずに成功扱いにする。既に水を含んだブロックや海草へ撃っても、何も変わらずバケツだけが空になる。ディスペンサーも emptyContents の戻り値でバケツを空にするので同じである (→ 12) [26.3 読解: BucketItem#emptyContents・DispenseItemBehavior]。
4. それ以外は、置き換え可能で液体でなければ、まず destroyBlock (落とし物あり) で壊す。続けて流体の水源ブロックをフラグ 11 で書く。書き込みが変化なしでも、元が水源なら成功扱い。
5. 手順 3・4 で成功したら FLUID_PLACE のゲームイベントを出す。手順 2 (ネザーで蒸発) では出さない。

置き換え可能の判定 (canBeReplaced に流体を渡す版) は「replaceable か、固体でない」である。感圧板・ケーキ (forceSolidOn) と日照センサー (固体) は置き換えられず、ディスペンサーはバケツを射出する。リピーター・コンパレーター・ダスト・レバー・ボタンは固体でないので壊される。

泡柱は replaceable で液体なので、壊さずに水源ブロックで上書きされる (§5.4)。

---

## 5. 端の場合と落とし穴

### 5.1 水源と流水は予約の種類が違う

- 予約の照合は種類の同一性で行う。流水のまま積まれた予約は、そのマスが水源になると空振りする。
- 水源になった書き込みの onPlace が water の予約を新しく積むので、止まることは無い。ただし時間は「水源になった gt + 5」から数え直しになる。
- 同じマスに water と flowing_water の予約が 1 件ずつ共存できる。[版差 26.4-pre-1] では種類が 1 つになるので共存しない (§6.4)。

### 5.2 溶岩の 4 倍遅延は効かない

LavaFluid#getSpreadDelay は、水位が上がり新旧とも落下でないとき、確率 3/4 で遅延を 4 倍にする。
しかし FlowingFluid#tick の書き込みの中で LiquidBlock#onPlace が通常の遅延で同じ (位置, 種類) の予約を先に積むので、4 倍の予約は先勝ちで捨てられる。
結果は常に通常の遅延 (30 / 10) である [26.3 読解: FlowingFluid#tick・LiquidBlock#onPlace・LevelChunkTicks#schedule] [要実機: §8 P-2]。
乱数 (ワールドの乱数) は条件がそろうと引かれる。この消費は他の乱数の並びに効く (→ 18)。

### 5.3 横の広がりは書き込みの前に確かめ直さない

getSpread が決めた行き先へ、enum 順に spreadTo を続けて呼ぶ。
行き先の今の blockstate は読み直すが、「置き換えられるか・面を通れるか・受けられるか」は確かめ直さない [26.3 読解: FlowingFluid#spreadToSides]。
[版差 1.21.1] では方向ごとに今の状態で確かめ直していた (FlowingFluid#canSpreadTo)。

- 同じ元から見た 2 つの行き先は、面で接しない (北と東の行き先は斜めの位置にある)。1 つ目の書き込みの NC・SU が、2 つ目の行き先へ直接届くことは無い。
- 差が出るのは、その場で走る連鎖 (最外の NC の中のスポンジの吸収、ダストの再計算など) が 2 つ目の行き先を別のものに変えたときだけである。ふつうの回路では差は見えない [要実機]。
- 溶岩は水と接した時点の NC で固まるので、水の横の行き先に溶岩が残っていることは無い (§4.10)。
- 広がる元のマスも確かめ直さない。これは 1.21.1 も同じである。たとえば、北と東の行き先の両方に接するマス (元の北東) にスポンジがあると、北への書き込みの NC でスポンジが北の水と元を吸う。それでも東の行き先には水が書かれ、元の無い流水が次の流体 tick (5 gt 後) まで残る [26.3 読解: FlowingFluid#spreadToSides・SpongeBlock#neighborChanged] [要実機]。

### 5.4 泡柱へ水のバケツを使うと、5 gt だけ水源ブロックになる

1. BucketItem#emptyContents は泡柱を「置き換え可能で液体」とみなし、水源ブロックをフラグ 11 で上書きする。その段は泡柱でなくなる。
2. SU は SU 順 (下が上より先) に出る。下の段は「上が置けるマスになった」で、上の段は「下から更新が来た」で、どちらも 5 gt の予約を積む。下の段の予約が先である。
3. 5 gt 後、下の段の tick が先に走り、上まで柱を書き戻す。上の段の tick は状態がそろっているので何も変えない。
4. 隣のオブザーバーは 2 回 (水源への変化と、柱への戻り) 反応する [26.3 読解] [要実機: §8 P-8]。

### 5.5 スポンジの入れ子

- 最外 (プレイヤーの設置・strict でない /setblock・予約 tick・BlockEntity の tick など) で置かれたスポンジでは、最初に消した水 (enum 順なので、真下が水なら真下) の NC がその場で走る (→ 04 §2.2)。
- その NC でスポンジの neighborChanged が走り、入れ子の吸収が始まる。入れ子はスポンジから探し直し、最大 64 マスを消して wet_sponge にする (フラグ 2)。入れ子の中で消した水の NC は積まれるだけで、さらに入れ子にはならない。
- 入れ子の探索は、外側が最初に消したマスを「水でない」として飛ばす。飛ばしたマスの先へは広げないので、そのマスの向こう側の水は残る。
- 外側の探索は自分の列の残りを続ける。入れ子が消したマスは飛ばし、最初に消したマスの向こう側の水を、自分の件数の上限 (最大 64) まで消す。最後に、既に wet_sponge のマスへ wet_sponge を書く (変化なし) が、音はもう一度鳴る。
- そのため、消える水は最大 64 + 64 = 128 マスになる。実際の数は水の形で決まる。2 つの探索を手順どおりに回した机上の計算では、次のようになる [26.3 読解: SpongeBlock#tryAbsorbWater・#removeWaterBreadthFirstSearch・BlockPos#breadthFirstTraversal・CollectingNeighborUpdater#addAndRun] [要実機: §8 P-9]。

| 水の形 (スポンジは中央) | 入れ子 | 外側 | 合計 | 音 |
|---|---|---|---|---|
| 9 × 9 × 9 の水 | 64 | 48 | 112 | 2 回 |
| 十分に大きな水 (13 × 13 × 13 以上) | 64 | 54 | 118 | 2 回 |
| スポンジより上が空気 (同じ高さと下だけが水) | 64 | 1 | 65 | 2 回 |
| ガラスの床の上下が水。床はスポンジの真下だけ穴 | 64 | 64 | 128 | 2 回 |
| スポンジの真下だけに水がつながる (周りと上は空気) | 0 | 64 | 64 | 1 回 |

- 最後の行は、入れ子が 1 マスも消せないので乾いたまま戻り、外側だけが吸う場合である。
- NC の中で吸収が始まる場合 (隣の変化で起きる場合) は、消した水の NC は積まれるだけで入れ子にならない。最大 64 マスである。

### 5.6 そのほかの落とし穴

| 落とし穴 | 要点 | 詳しく |
|---|---|---|
| 流水は水を含ませない | 水を含めるブロックは flowing_water を断る。レール・フェンス・板ガラスの列は流水の壁になる。水を含むのはバケツか、2 水源の規則のときだけ | §4.11 |
| 下に同じ種類の流体がある流水は横へ広がらない | 落下水の柱は途中で漏れない。柱の一番下で初めて量 7 で横へ広がる。水源は真下に水があっても横へ広がる | §4.5 |
| 置き換えられない隣も最小距離に数える | 既存の流水の向こうに近い穴があると、空いている別の方向へは広がらない | §4.6 |
| 泡柱の上の水源は自分では柱を作らない | 20 gt の予約は真下がソウルサンドかマグマのときだけ。柱が上へ伸びるのは一番上の段の 5 gt の予約による | §4.13 |
| バケツの置き換え判定は流れの判定と違う | 流れはタグか水を含めるブロックだけ。バケツは固体でないブロックを destroyBlock で壊して置く (BLOCK_DESTROY も出る)。溶岩のバケツはレールを壊す。流れる溶岩はレールに入らない | §4.19 |
| 溶岩は落とし物を出さない | 溶岩が洗い流した部品はアイテムにならない (26.3) | §4.8 |
| 洗い流しはゲームイベントを出さない | フラグ 3 の書き込みだけで、BLOCK_DESTROY が出ない (26.3)。26.4-pre-1 では出る | §4.8・§6.4 |
| 落下ブロックは moving_piston の上で待つ | 着地マスが moving_piston なら、次の tick にまた判定する。速度には毎回 (0.7, −0.5, 0.7) が掛かる。押し終わりの後にどこへ着地するかは [要実機] | §4.16 |
| 砂はダスト・トーチの上で止まる | それらは「空き」でない。落ちてきた砂はそのマスで止まりアイテムになる | §4.15・§4.16 |
| 水を含んだブロックはピストンで動かすと水を失う | 着地で WATERLOGGED を偽にする | §4.11・→ 13 |
| 泡柱の書き直しは NC を出さない | フラグ 2。BUD 状態のピストンは起きない。オブザーバーは起きる。流体ブロックの書き込みはほぼ全部フラグ 3 (汲み取りはフラグ 11) | §4.13 |
| 感圧板・ドア・看板・フェンスゲートは水を止める | 感圧板・ドア・フェンスゲートはタグ外で入れ物でもない。開いたフェンスゲートも止める。看板は水を含めるブロックなので流水を断る (2 水源の規則なら水を含む) | §4.12 |
| コンクリートパウダーは真下の水だけでは固まらない | touchesLiquid が真下を見るのは自分のマスが水を含むときだけ | §4.17 |
| 流体ブロックの LEVEL 9〜15 | 量 8 の落下水と同じ状態に写り、流体 tick でも書き換わらない | §3.2 |
| つららは予約のあとで支えが戻っても落ちる | 下向きの鍾乳石の tick は支えを確かめ直さない。石筍は確かめ直す | §4.17 |
| 砂は 2 層以上の雪の上でアイテムになる | 雪は層の数を問わず「空き」なので落ちるが、着地で置き換えられるのは 1 層の雪だけ | §4.16 |
| 水のバケツを水入りのブロックへ撃つとバケツだけ空になる | emptyContents は placeLiquid の結果を見ない | §4.19 |

---

## 6. 版差

担当クラスを diff -u で比べ、挙動に効く所だけを拾った。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| 泡柱を作る予約 | ソウルサンドとマグマが自分に 20 gt (onPlace と、上が水ブロックになった SU)。tick で上のマスから柱を書く | 水源ブロックが自分に 20 gt (onPlace・NC・下からの SU) | 26.2 と同じ | 同じ |
| 泡柱の 5 gt の作り直し・updateColumn | 同じ規則 (ブロックの照合を名前で直に) | タグで照合 (中身は同じ) | 基準 | 同じ |
| 流水の水位が変わった時の書き込み | フラグ 2 で書く → 予約 → NC を手で出す。周りへは SU → NC の順 | フラグ 3 で書く → 予約。NC → SU の順 | 26.2 と同じ | 同じ |
| 横の広がりの確かめ直し | 行き先ごとに、今の状態で「置き換え・面・受け入れ」を確かめ直す | しない | しない | しない |
| 流れ込めるブロック | 動きを止めない (blocksMotion が偽) ブロック。ただしドア・看板・はしご・サトウキビ・泡柱・ネザーポータル・エンドポータル・エンドゲートウェイ・structure_void を除く | 1.21.1 と同じ | タグ washed_away_by_fluids。旧い計算と結果は一致する (§6.3) | 同じタグ (中身も同じ) |
| 流体が壊したときの落とし物 | 水は出す、溶岩は出さない | 同じ | 同じ | destroyBlock を通すので水も溶岩も出す。壊すパーティクルと BLOCK_DESTROY のゲームイベントも出る。書き込みが 2 回 (空気 → 流体) |
| 流体の種類 | 水源と流水が別の種類 (5 種) | 同じ | 同じ | water・lava・empty の 3 種。SOURCE と LEVEL を持ち、落下は「水源でなく量 8」から導く |
| 水と青氷 | 何も起きない | 同じ | 同じ | 水ブロックの横 (水平 4 方向) に青氷があると、水が brittle_ice になる (onPlace と NC) |
| 流れの向きを止めるブロック (エンティティを押す向き) | blocksMotion | blocksMotion | タグ blocks_fluid_flow | 同じ |
| 溶岩の着火を止めるブロック | blocksMotion | blocksMotion | タグ blocks_lava_fire_spread | 同じ |
| 押し反応の名前 | DESTROY など | 同じ | POPPED などに改名 (中身は → 13) | 同じ |
| 落下エンティティ | 移動の中でブロックの効果を受ける。抵抗は double の 0.98 | applyEffectsFromBlocks を別に呼ぶ。抵抗は float の 0.98 | 同じ | 同じ |
| スポンジ | 探索の判定は真偽の 2 値 | 3 値 (ACCEPT・SKIP・STOP) になった。深さ 6・件数 65 と判定の中身は同じ | 基準 | 音の鳴らし方の引数だけ |
| 大釜への滴下の抽選の書き方 | (同じ値) | 同じ | 基準 | 先に 0.17578125 で絞る (定数名は MINIMUM_TRANSFER_PROBABILITY_PER_RANDOM_TICK だが、値は水の確率で大きい方)。流体ごとの確率は Fluid の性質へ移した。値は同じ |

### 6.1 [版差 1.21.1] 泡柱の起点

- 1.21.1 ではソウルサンド・マグマが予約の持ち主である。26.3 では上の水源ブロックが持ち主である。遅延はどちらも 20 gt。
- 持ち主が違うので、20 gt の間にソウルサンドをマグマへ替えたときの結果が違う。
  1.21.1 はソウルサンドの予約が種類違いで空振りし、マグマの onPlace から 20 gt を数え直す。
  26.3 は水源ブロックの予約が残り、最初の 20 gt の時点の真下 (マグマ) で柱を作る [26.3 読解] [要実機]。
- 1.21.1 のソウルサンド (とマグマ) が予約するのは、自分の onPlace と「上が Blocks.WATER のブロック (流水も含む) になった SU」のときだけである。NC では予約しない。26.3 の水源ブロックは onPlace・NC・下からの SU で予約する [版差 1.21.1: SoulSandBlock#onPlace・#updateShape・MagmaBlock#onPlace・#updateShape]。
- 26.2 も 26.3 と同じである (26.2 の LiquidBlock が 20 gt を持ち、26.2 の SoulSandBlock・MagmaBlock に予約は無い)。

### 6.2 [版差 1.21.1] 流水の書き込みの順

1.21.1 の FlowingFluid#tick は、フラグ 2 で書いて SU を先に出し、予約を積み、最後に updateNeighborsAt で NC を出す。
26.2 以降はフラグ 3 なので NC が先、SU が後である。
水位の変化を同じ gt に NC で受ける部品 (BUD 状態のピストンなど) と SU で受ける部品 (オブザーバー) があると、予約やブロックイベントの積まれる順が入れ替わる [要実機: §8 P-12]。

### 6.3 [版差 26.2] 洗い流しの判定の置き換え

26.2 までは「動きを止めない (blocksMotion が偽) ブロックから、ドアなど 9 種を除く」という計算だった。26.3 はタグ washed_away_by_fluids を引くだけになった。
26.3 では blocksMotion も同名のタグ blocks_motion に置き換わっている。そこで、26.3 の blocks_motion を旧い計算に当てはめて、washed_away_by_fluids と比べた。

- 26.2 にもあるブロックでは、両者は一致する。違うのは 26.3 で増えた straw_bed だけである (blocks_motion にもタグにも入り、タグが勝つので洗い流される)。
- 置き換えは挙動を保つためのものと読める。
- ただし、26.3 の blocks_motion が 26.2 の計算と全ブロックで一致するかは確かめていない。次は手で照合して一致した: repeater・comparator・redstone_wire・lever (動きを止めない)、daylight_detector・lectern・cake・turtle_egg・感圧板・bell・moving_piston・piston_head・hopper (止める)、end_rod・snow (forceSolidOff で止めない)、cobweb (例外として止めない)。

[要実機] は洗い流しの表 (§8 P-5) をそのまま 26.2 と 26.3 で撮ればよい。

### 6.4 [版差 26.4-pre-1] 流体の作り替え

- 予約の種類が水・溶岩の 2 つになる。流水のまま積んだ予約が水源化の後も生きる。新しい予約は先勝ちで捨てられるので、水源化した直後の広がりの時間が 26.3 と変わりうる [要実機]。
- 洗い流しは destroyBlock を通る。溶岩でも落とし物が出る。BLOCK_DESTROY が出るので、スカルクセンサーが洗い流しを振動として受ける (→ 10)。空気への書き込みと流体の書き込みで NC と SU が 2 回ずつ出る。
- 水を含むブロックの判定は「water の水源か」で書き直されたが、結果は 26.3 と同じ。
- 新しい brittle_ice は水の onPlace と NC の中でその場で書かれる。

---

## 7. Rust で実装するときの要点

### 7.1 状態の持ち方

- 流体の状態は blockstate から引く導出値にする。流体ブロックは LEVEL、水を含むブロックは WATERLOGGED、泡柱と昆布・海草は固定で水源。別の格子に持たない。
- 26.3 の流体の状態は (種類 5 値, 量 1〜8, 落下の真偽) で足りる。LEVEL 9〜15 は LEVEL 8 と同じ流体の状態に写す (書き換えも起きない)。
- 「固体」(isSolid)・「置き換え可能」(replaceable)・「液体」(liquid)・タグ washed_away_by_fluids の所属は、ブロック状態ごとの静的な表にする (→ 05 の状態表)。

### 7.2 予約キュー

- ブロック用と流体用で 2 本の LevelTicks を持つ (→ 02)。流体の鍵は (位置, 流体の種類)。水源と流水を同じ鍵にしない (26.3。26.4-pre-1 では 1 つになる)。
- 流体用は L7 で、ブロック用を回し終えてから集める。
- 先勝ちを守る。FlowingFluid#tick の後の予約は、設置フックの予約に負けるように書く順を守る (溶岩の 4 倍遅延を「効かない」ようにするのも、この順の結果である)。
- 溶岩の遅延の乱数はワールドの乱数から引く。引く条件も同じにする (→ 18)。

### 7.3 面の判定

- canPassThroughWall のために、ブロック状態ごとに「6 面の境目の断面」を持つ。断面は 1/16 単位の 16 × 16 のビット表でほとんどが表せる。1/16 に乗らない形があれば矩形の和で持つ。当たり判定は文脈なしの値を使う (足場・粉雪・流体のように文脈で変わる形も、文脈なしなら固定になる)。
- 「境目まで届いていない側は空とみなす」「2 つの断面の和が面全体を覆えば塞ぐ」を守る。フルブロックの早道と、両方空の早道は結果を変えない。
- キャッシュ (200 組) は結果に効かないので、持たなくてよい。

### 7.4 広がりの手順

- getSpread は水平順で調べ、結果は enum 順 (北・南・西・東) で書く。配列 4 個を固定の添字で持てば EnumMap の順を再現できる。
- getSlopeDistance は訪問済みを持たない深さ優先で書く。穴を見つけたらその場で返す。状態と穴の判定は 1 回の getSpread の間だけ覚える (鍵は起点からの差 + 128 の x・z の下位 8 ビットずつ)。
- 書き込みは 04 の setBlock の手順を通す。spreadTo の中で撤去フック → 設置フック → NC → SU が走る。

### 7.5 泡柱・スポンジ・落下ブロック

- updateColumn は「書けたか」を返す setBlock が要る。上へのループは「変化なし」で止める。
- 泡柱の 1 マスは、ブロックの予約 (泡柱 5 gt) と流体の予約 (水 5 gt) を別の鍵で持つ。水源ブロックはブロックの予約 (20 gt) と流体の予約を別に持つ。
- スポンジの探索は、両端キューと訪問済みの集合で書く。吸収の中から setBlock を呼び、その NC が最外ならその場で走る (再入できるようにする)。入れ子と外側は訪問済みの集合と件数を別に持ち、外側は入れ子が戻ったあとも自分の列を続ける (§5.5)。
- 落下エンティティは L12 で動かす。縦だけの近似で足りる場面 (真下へ落ちて固体の上に乗る) と、足りない場面 (ハーフ・泡柱・水流・横の速度) を分ける。後者は 17 の物理に任せる。

### 7.6 他のメモとの境界

| 境界 | 担当 |
|---|---|
| setBlock・NC・SU・入れ子 | 04 |
| 予約の並び・保存 | 02 |
| 撤去フックで部品が周りへ出す NC | 06・07・08・09 |
| ディスペンサーがバケツを使う手順 | 12 |
| ピストンが流体・水を含むブロック・砂を動かす | 13 |
| エンティティの物理 | 17 |

---

## 8. 検証用のプローブ回路案

実機 (26.3) で正解を撮る小さな回路。座標は水源か対象のブロックを原点とする。ガラスで囲み、流れを 1 方向に絞る。

| # | 目的 | 配置 | 観測と期待の要点 |
|---|---|---|---|
| P-1 | 横へ 1 マス進む時間と予約の種類 | 石の床に水源を 1 個置く。北だけ 7 マスの溝 | 置いた gt を 0 として、北へ 5 gt ごとに 1 マスずつ量 7, 6, 5 … と進む。fluid_ticks の i が flowing_water になる |
| P-2 | 溶岩の 4 倍遅延が効かないこと (§5.2) | オーバーワールドで、溶岩の流れが「量の上がる」形になる配置。溝の先を開けたり閉じたりして、流れの水位を上げる | 水位が上がる書き換えの間隔がいつも 30 gt。4 倍 (120 gt) が一度も出ない |
| P-3 | 斜面の探索の距離 | 水源の東 5 マス先に 1 マスの穴、西 6 マス先に穴。床は平ら | 水は東へだけ広がる。東を 6、西を 5 にすると西へだけ広がる |
| P-4 | 横の書き込みの順 (北・南・西・東) | 水源の 4 方向すべてに同じ距離の穴。各行き先の隣に、同じ遅延の予約を積む部品 (オブザーバー) を置く | オブザーバーの発火の予約順が北・南・西・東 (更新トレースで記録する) |
| P-5 | 洗い流しの表 (§4.12) | 水源の流路に部品を 1 個ずつ並べる。対照に溶岩 | 水: 部品が壊れ、表の落とし物が出る。溶岩: 落とし物が出ない。感圧板・日照センサー・ケーキの前で流れが止まる |
| P-6 | 水を含めるブロックは流水を止める | 水源 → 流路 → レール → 空いた溝。もう 1 本は水源 2 個でレールを挟み、下を石にする | 1 本目: 流水はレールの先へ行かない。2 本目: レールが水を含む |
| P-7 | 泡柱の 20 gt と持ち主 | (a) ソウルサンドの上に水源 (b) 水の柱の下にソウルサンドを押し込む (c) (b) のあと 10 gt でマグマに替える | (a)(b) 20 gt 後に柱。(c) 26.3 は最初の 20 gt の時点で下向きの柱。1.21.1 はマグマを置いた gt から 20 gt |
| P-8 | 泡柱へ水のバケツ (§5.4) | 6 段の柱の 3 段目の横に、水のバケツ入りディスペンサーと、3 段目を見るオブザーバー | 発射の gt に 3 段目が水源ブロックになり、5 gt 後に柱へ戻る。オブザーバーが 2 回光る |
| P-9 | スポンジの入れ子 (§5.5) | (a) 9 × 9 × 9 の水の中央に、プレイヤーとしてスポンジを置く。(b) ガラスの床の上下を水で満たし、床の 1 マスの穴の真上に置く。対照は NC で吸収させる (乾いた所に置いてから、隣へ水を流し込む) | 消える水の数と音の回数。机上の計算では (a) 112、(b) 128 で、音は 2 回。対照は 64 以下で、音は 1 回。(a) が 65 なら、外側の探索が入れ子のあとに続かない読みが正しい |
| P-10 | 落下の時間 (§4.16) | 高さ n = 1〜5 の空気の上に砂。下は石。砂の下の支えのブロックを gt 0 に空気にする | 予約で 2 gt 後に落下が始まり、表の値 − 1 gt 後に着地。着地の gt にオブザーバーが反応 |
| P-11 | 砂がダスト・トーチの上で止まること | 砂の真下にダスト、別の列にトーチ。もう 1 本はダストのマスへ上から砂を落とす | 上に置いた砂は落ちない。落ちてきた砂はアイテムになり、ダストは残る |
| P-12 | 流水の NC と SU の順 (§6.2) | 流水の横に BUD 状態のピストンと、同じマスを見るオブザーバー | 26.3: 水位が変わる gt に、NC 起点の反応が SU 起点の予約より先。1.21.1 で逆か |
| P-13 | コンクリートパウダーの真下の水 | パウダーの真下だけに水源。対照は横に水源 | 真下だけ: 固まらない。横: 置いた時点でコンクリート |
| P-14 | 26.4-pre-1 の洗い流し | ダストを溶岩で流す。近くにスカルクセンサー | 26.4-pre-1: 落とし物が出て、センサーが反応する。26.3: どちらも無し |

P-1・P-3・P-5 は流体の基本なので最初に撮る。P-2 は溶岩の遅延が長いので、ハーネスの tick を速めて撮る。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/16_nucleation-comparison.md §2.7・§3.1

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §2.7 水の水平流 | Nucleation は「5 gt・下が優先・深さ 4 の斜面探索」 | 定数 4 は合っている。意味は「穴の値が 4 まで」で、経路長 5 の穴まで見る。横の書き込みは enum 順 | 食い違いではない。深さの意味を本メモで補う |
| §2.7 泡柱の生成・維持 | redstone-sim は有り (実機 fixture で固定) | 維持 (5 gt) は合う。ただし TS は既にある泡柱の tick からしか柱を書かない。ソウルサンドの上の水源から柱を作る経路 (26.3 は水源ブロックの 20 gt) が無い。マグマ (下向き) の柱も作れない | 「維持」は正しい。「生成」は TS に無いので、表の記述を「維持のみ」に直す |
| §2.7 ディスペンサーのバケツ | Nucleation・redstone-sim とも「有り」で「同等」 | BucketItem#emptyContents は、固体でないブロックを destroyBlock で壊して置く・水を含めるブロックに水を含ませる・泡柱を水源ブロックで上書きする (§4.19・§5.4) | redstone-sim は空気と水の前にしか置けず、泡柱は柱のままにする (§9.3)。redstone-sim 側は一部だけなので「同等」は言い過ぎ。Nucleation 側は確かめていない |
| R-16 | 流体 tick をブロック予約の列に混ぜている | ServerLevel#tick はブロック予約を回し切ってから流体予約を回す | 既存の指摘が正しい [26.3 読解] |
| R-18 | 泡柱のブロック tick と流体 tick を 1 つの鍵にまとめている | BubbleColumnBlock#updateShape は SU のたびに水の予約、条件付きで泡柱の予約を別に積む | 既存の指摘が正しい [26.3 読解] |

### 9.2 packages/sim/test/bubble-column.test.ts

| 箇所 | テストの記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| 冒頭の説明 | ソウルサンドの上に水を置くと「ソウルサンドの 20gt 予約経由」で柱ができる | 26.3 は水源ブロック自身の 20 gt のブロック予約 (LiquidBlock#tick)。1.21.1 の説明としては正しい。テストは典拠を「26.2 BubbleColumnBlock」とするが、26.2 でも持ち主は水源ブロックである (26.2 の SoulSandBlock に予約は無い) | 時間は同じ。持ち主と典拠の版を直す (§6.1 の場面で結果が分かれる)。この経路はテストも TS も持たない |
| 冒頭の説明 | 乱されたときは updateShape が 5gt の tile tick を積む | 条件付き (存続できない・下から・上が置けるマスになった)。NC では積まない | 説明に条件を足す |
| 断ち切るテスト | 石で塞いで 5 gt 後に上がまとめて水に戻る | 同じ。[実機 1.21.1: bubble-column-cut] | 正しい |
| 140 段のテスト | 1 tick で全段 | 同じ | 正しい |
| オブザーバーのテスト | 柱の変化を検知する | 同じ (フラグ 2 の SU) | 正しい |

### 9.3 今の TS 実装 (packages/sim/src/world.ts) との違い

コードは変えない。差だけを書く。

| 場所 | 今の TS | 26.3 | 影響 |
|---|---|---|---|
| neighborChanged の bubble_column (2937 行付近) | NC を受けると無条件に 5 gt の泡柱の予約を積む | 泡柱は NC を受けない。予約は SU で、§2.4 の 3 条件のときだけ | 柱の隣の部品の NC で余計な再評価が入る。今は書き換えが同じになるので見えにくい |
| emitShapeUpdate (2665 行付近) の届け先 | SU はオブザーバー・塀・板ガラス・音符ブロックにしか届かない。泡柱と水の予約は NC でしか積まれない | 泡柱は SU でだけ予約する。水ブロックは NC と SU (水源が絡むとき) の両方で予約する。水を含むブロックは SU でだけ予約する | NC を伴わない変化 (フラグ 2 の書き込みや、ピストンが moving_piston を置く書き込み → 13) の下で、柱の崩れが遅れるか起きない [要実機] |
| 泡柱の生成 | 無い (既にある泡柱の tick からしか書かない) | 水源ブロックの 20 gt (§4.13) | ソウルサンドの上に水を置く・水の下にソウルサンドを押し込む機構が動かない |
| updateBubbleColumn (2209 行付近) | 真下がソウルサンドなら上向き、泡柱なら同じ、それ以外は水 | マグマなら下向き (DRAG 真) | マグマの上の柱を再評価すると水に戻ってしまう。マグマは素材ブロックとして取り込まれる |
| 泡柱の予約の鍵 | 泡柱の予約と水の予約を 'bubble_column' の 1 つの鍵で持つ (R-18) | 別のキュー・別の鍵 | 片方の予約がもう片方を消す |
| 流体の予約の置き場 | ブロックの予約と同じ列 (R-16) | 別のキュー。L6 の後の L7 | 同じ gt の順が変わる |
| waterNeedsFlowTick による予約の間引き | 要らないと判断したら予約しない | NC・SU のたびに積み、tick 側で何もしないこともある | 先勝ちのため、後から来た変化に反応する gt がずれる (実機は先に積んだ予約の gt で反応する) |
| updateWaterFlow の書き込み (2271 行付近) | 落下水を置く・消すとき SU だけ出す (NC を出さない) | フラグ 3 なので NC も出る。柱が戻らないのは、落下水が「置けるマス」でないからである | 落下水の隣の BUD 部品やランプが、実機では NC を受けるのに TS では受けない |
| 水の広がり | 縦だけ。量 1〜7 の流水・水源化・横の斜面探索が無い (WaterState は 0 と 8 だけ) | §4.3〜4.6 | 水路を使う回路は再現できない |
| 洗い流し | 無い | タグの部品は壊れて落とし物を出す | 水が部品を壊す回路は再現できない |
| dispenseBucket の water_bucket (2316 行付近) | 前が泡柱なら柱のまま、バケツだけ空にする | 泡柱を水源ブロックで上書きし、5 gt 後に柱が戻る (§5.4) | 泡柱へ水を撃つ機構で、5 gt の切れ目とオブザーバーの反応が違う [要実機] |
| dispenseBucket の置ける先 | 空気と水だけ | 固体でないブロックを壊して置く。水を含めるブロックには水を含ませる | ダスト・トーチの前のディスペンサーが違う |
| dispenseBucket の空のバケツ | 水源ブロックと泡柱だけを汲む | BucketPickup ならどれも汲む。水を含んだブロックは WATERLOGGED を偽にする (フラグ 3)。FLUID_PICKUP のゲームイベントを出す | 水を含んだレール・ハーフの前のディスペンサーが、TS ではバケツを射出する |
| 溶岩 | 取り込みを拒む | §4.10 | 範囲外のまま |
| 落下ブロック | 砂・砂利・コンクリートパウダーは素材ブロック (導体) で、落ちない | §4.15〜4.17 | 砂を使う回路 (ピストンで支えを抜く等) は再現できない |
| スポンジ | 素材ブロックで、吸わない | §4.14 | 範囲外 |
| 水を含むブロック | レール・ハーフ・トラップドアは WATERLOGGED を偽に固定して書き出す。塀と板ガラスは値を読み書きするだけで、水として振る舞わない (packages/sim/src/mcstate.ts) | §4.11 | 水を含んだレール・トラップドア・ハーフの水の広がりが無い |

### 9.4 その他

- docs/vanilla/02_scheduled-ticks.md §4.9 の「FlowingFluid#tick は FlowingFluid#getSpreadDelay の値で予約する」は、書き方としては正しい。ただし、その予約は設置フックの予約に負けて捨てられる (§5.2)。02 の表に注を足すとよい。
- docs/vanilla/17_entities-interplay.md §6.3 の「落下ブロックの水没: 26.3 は着地点が水なら waterlogged、26.4-pre-1 は水源のときだけ」は、26.3 の読みと合わない。26.3 の FallingBlockEntity#tick も、着地マスの流体の種類が water (水源) と同一かを見る (TypedInstance#is は登録物の同一性なので、flowing_water では偽)。1.21.1 も種類の同一性で比べる。26.4-pre-1 は流体の種類が 1 つになったので、同じ意味を「water の水源か」(isSourceOfType) で書き直しただけである。流れる水へ着地しても、どの版でも水を含まない。版差は無いと判断する (17 の担当で直す)。

---

## 10. 典拠一覧

- 26.3 ServerLevel#tick — ブロックの予約 → 流体の予約 → 襲撃 → チャンク → ブロックイベント → エンティティ → BlockEntity
- 26.3 ServerLevel#tickFluid・#tickBlock — 種類の照合 (TypedInstance#is は登録物の同一性)
- 26.3 LevelChunkTicks#schedule・#poll — 先勝ちと取り出し
- 26.3 ScheduledTickAccess — 流体用の 2 つの入口 (優先度ありとなし)
- 26.3 LevelChunk#setBlockState — onPlace がプロパティだけの変化でも呼ばれる
- 26.3 Fluid・FluidState・Fluids・EmptyFluid — 種類・量・高さ・置き換えの窓口
- 26.3 FlowingFluid#tick・#getNewLiquid・#spread・#spreadToSides・#getSpread・#getSlopeDistance・#isWaterHole・#canPassThroughWall・#canMaybePassThrough・#canPassThrough・#canHoldAnyFluid・#canHoldFluid・#canHoldSpecificFluid・#spreadTo・#sourceNeighborCount・#getLegacyLevel・#getHeight・#getOwnHeight・SpreadContext
- 26.3 WaterFluid#getTickDelay・#getSlopeFindDistance・#getDropOff・#canBeReplacedWith・#beforeDestroyingBlock・#canConvertToSource
- 26.3 LavaFluid#getTickDelay・#getSpreadDelay・#getSlopeFindDistance・#getDropOff・#canBeReplacedWith・#beforeDestroyingBlock・#spreadTo・#randomTick・#canConvertToSource
- 26.3 LiquidBlock#onPlace・#neighborChanged・#updateShape・#tick・#shouldSpreadLiquid・#tryScheduleBubbleBlockColumn・#shouldBubbleColumnOccupy・#getFluidState・#pickupBlock・#getCollisionShape
- 26.3 BubbleColumnBlock#updateShape・#tick・#updateColumn・#canOccupy・#getColumnState・#canSurvive・#getFluidState・#pickupBlock
- 26.3 SoulSandBlock・MagmaBlock — 泡柱の処理を持たない
- 26.3 SimpleWaterloggedBlock#canPlaceLiquid・#placeLiquid・#pickupBlock
- 26.3 LiquidBlockContainer・BucketPickup・KelpBlock・SeagrassBlock
- 26.3 SpongeBlock#onPlace・#neighborChanged・#tryAbsorbWater・#removeWaterBreadthFirstSearch
- 26.3 WetSpongeBlock#onPlace
- 26.3 BlockPos#breadthFirstTraversal
- 26.3 CollectingNeighborUpdater#addAndRun・#runUpdates
- 26.3 FallingBlock#onPlace・#updateShape・#tick・#isFree・#getDelayAfterPlace
- 26.3 Fallable#onLand・#onBrokenAfterFall
- 26.3 ConcretePowderBlock#getStateForPlacement・#onLand・#updateShape・#touchesLiquid・#canSolidify
- 26.3 AnvilBlock#falling・#onLand・#onBrokenAfterFall・#damage
- 26.3 DragonEggBlock#getDelayAfterPlace
- 26.3 BrushableBlock#onPlace・#updateShape・#tick・#onBrokenAfterFall
- 26.3 ScaffoldingBlock#onPlace・#updateShape・#tick・#getDistance・#canSurvive
- 26.3 SpeleothemBlock#updateShape・#tick・#spawnFallingStalactite
- 26.3 PointedDripstoneBlock#randomTick・#maybeTransferFluid・#findFillableCauldronBelowStalactiteTip・#canDripThrough・#getFluidAboveStalactite
- 26.3 AbstractCauldronBlock#tick・CauldronBlock#receiveStalactiteDrip・LayeredCauldronBlock#canReceiveStalactiteDrip・#receiveStalactiteDrip
- 26.3 SnowLayerBlock#canBeReplaced — 落下ブロックが置き換えられるのは 1 層の雪だけ
- 26.3 DispenseItemBehavior — 中身入りのバケツと空のバケツの振る舞い
- 26.3 TypedInstance#is — 流体の種類の照合は登録物の同一性
- 26.3 FallingBlockEntity#fall・#tick・#causeFallDamage・#addAdditionalSaveData
- 26.3 Entity#applyGravity・#getAirDrag、EntityTypes の FALLING_BLOCK
- 26.3 BlockBehaviour.BlockStateBase#calculateSolid・#isSolid・#liquid・#canBeReplaced
- 26.3 Shapes#mergedFaceOccludes
- 26.3 BucketItem#emptyContents
- 26.3 Level#destroyBlock — 26.4-pre-1 の洗い流しとの比較
- 26.3 VanillaBlockTagsProvider — washed_away_by_fluids・blocks_fluid_flow・blocks_lava_fire_spread の組み立て
- 26.3 PistonMovingBlockEntity — 着地で WATERLOGGED を外す
- 26.3 Blocks — 水・溶岩・泡柱の性質 (replaceable・liquid・POPPED)
- 26.3 GameRules — water_source_conversion (真)・lava_source_conversion (偽)
- 26.3 EnvironmentAttributes・DimensionTypes — fast_lava・water_evaporates (ネザーで真)
- 26.3 data/minecraft/tags/block/washed_away_by_fluids.json・enables_bubble_column_push_up.json・enables_bubble_column_drag_down.json・blocks_fluid_flow.json、tags/fluid/water.json・lava.json・bubble_column_can_occupy.json
- 26.3 data/minecraft/loot_table/blocks/ — 洗い流しの落とし物
- 版差: 1.21.1・26.2・26.4-pre-1 の FlowingFluid・WaterFluid・LavaFluid・LiquidBlock・BubbleColumnBlock・SoulSandBlock・MagmaBlock・SimpleWaterloggedBlock・SpongeBlock・BlockPos#breadthFirstTraversal・FallingBlockEntity・PointedDripstoneBlock・Fluids を diff -u で比較
