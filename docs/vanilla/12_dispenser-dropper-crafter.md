# 12 ディスペンサー・ドロッパー・クラフター

基準は Java 版 26.3。確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] 実機 fixture が裏づける。定義は `tools/mc-harness/fixtures/`、撮った結果は `packages/sim/test/fixtures/` にある。observer-dropper-conductor・dropper-into-hopper-cooldown・wire-cut-conductor は定義が無く、結果だけがある
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

相の記号は 03 と同じ (b = ブロックの予約 tick = 01 の L6、d = ランダム tick を含む chunkSource = L9、e = ブロックイベント = L10、g = BlockEntity = L13)。正は → 01_tick-loop.md。dispenser が出したエンティティは同じ tick の L12 で動き始める (→ 01・17)。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| DispenserBlock | FACING・TRIGGERED・neighborChanged・tick・dispenseFrom・getDispenseMethod と既定の選び方 (getDefaultDispenseMethod)・getStateForPlacement・affectNeighborsAfterRemoval・getDispensePosition・getAnalogOutputSignal・TRIGGER_DURATION |
| DropperBlock | getDispenseMethod・dispenseFrom (上書き) |
| CrafterBlock | CRAFTING・TRIGGERED・ORIENTATION・neighborChanged・tick・dispenseFrom・dispenseItem・getPotentialResults・getStateForPlacement・setPlacedBy・newBlockEntity・getTicker・getAnalogOutputSignal・定数 |
| DispenserBlockEntity / DropperBlockEntity | getRandomSlot・insertItem・保存と読み込み |
| CrafterBlockEntity | containerData (無効スロットと triggered)・canPlaceItem・smallerStackExist・setItem・setSlotState・slotCanBeDisabled・serverTick・getRedstoneSignal・保存と読み込み |
| core/dispenser の全クラス | DispenseItemBehavior (NOOP と bootStrap)・DefaultDispenseItemBehavior・OptionalDispenseItemBehavior・BlockSource・ProjectileDispenseBehavior・EquipmentDispenseItemBehavior・ShulkerBoxDispenseBehavior・ShearsDispenseItemBehavior・FlintAndSteelDispenseItemBehavior・MinecartDispenseItemBehavior・BoatDispenseItemBehavior・SpawnEggItemBehavior・SulfurCubeBlockDispenseItemBehavior |
| HopperBlockEntity (搬入の部分) | getContainerAt・getBlockContainer・getEntityContainer・addItem・tryMoveInItem・canPlaceItemInContainer・canMergeItems・getSlots・isOnCustomCooldown |
| 呼び出し先 (挙動に効く所だけ) | BucketItem#emptyContents・SolidBucketItem#emptyContents・LiquidBlock / SimpleWaterloggedBlock / BubbleColumnBlock / PowderSnowBlock の pickupBlock・SimpleWaterloggedBlock#placeLiquid・BlockItem#place・DirectionalPlaceContext・ShulkerBoxBlock#getStateForPlacement・BoneMealItem#growCrop・growWaterPlant・TntBlock#prime・BaseFireBlock#canBePlacedAt・RespawnAnchorBlock#charge・BeehiveBlock#resetHoneyLevel・LivingEntity#canEquipWithDispenser・ProjectileItem.DispenseConfig と各アイテムの createDispenseConfig・Projectile#spawnProjectileUsingShoot・BaseContainerBlockEntity#setItem・BlockEntity#setChanged・Level#setBlock・Level#updateNeighbourForOutputSignal・LevelChunk#setBlockState・SignalGetter#hasNeighborSignal・LevelChunkTicks#schedule・ScheduledTick の既定の優先度・BitRandomSource#nextInt・Level の random・RecipeCache・CraftingContainer#asCraftInput・Containers#updateNeighboursAfterDestroy・PistonBaseBlock#isPushable・LevelChunk の BoundTickingBlockEntity#tick・LevelChunk#setBlockState (撤去の順)・Level#destroyBlock・Level#removeBlock・BlockBehaviour#canBeReplaced (流体版) と calculateSolid・SeagrassBlock / TallSeagrassBlock / KelpBlock の placeLiquid・Armadillo#brushOffScute・Entity#shearOffAllLeashConnections・SulfurCube#primeTime・CompoundContainer#setItem・setChanged・Container#canTakeItem |

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick のフェーズ順・BlockEntity 相の中の順 | → 01_tick-loop.md |
| 予約 tick の重複排除・優先度・subTick の順・遅延の数え方 | → 02_scheduled-ticks.md |
| setBlock のフラグの意味・近隣更新と形状更新の配る順・コンパレーター更新の方向の順 | → 04_set-block-and-updates.md |
| hasNeighborSignal と getSignal の中身・導体の判定 | → 05_signals-and-block-properties.md |
| コンパレーターの読み方・充填率の式 | → 07_diodes.md・14_containers-hoppers-analog.md |
| ホッパー自身の tick・各コンテナの面と受け入れの規則 | → 14_containers-hoppers-analog.md |
| 置いた水・溶岩・泡柱・粉雪のその後 | → 16_fluids-falling-blocks.md |
| 落としたアイテム・投射物・トロッコ・TNT・装備したモブの動き | → 17_entities-interplay.md |
| 出した GameEvent (振動) の受け手 | → 10_sculk.md |
| 置いた・点けた・蝋付けしたブロックのその後 (TNT・銅の電球など) | → 11_outputs.md |
| ピストンで押せるか | → 13_pistons.md |
| 乱数の消費順・エンティティの一覧の順 | → 18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 3 つのブロックの関係 [26.3 読解]

| | dispenser | dropper | crafter |
|---|---|---|---|
| ブロックのクラス | DispenserBlock (BaseEntityBlock の子) | DropperBlock (DispenserBlock の子) | CrafterBlock (BaseEntityBlock の子) |
| BlockEntity | DispenserBlockEntity (9 スロット) | DropperBlockEntity (DispenserBlockEntity の子。種類だけ違う) | CrafterBlockEntity (9 スロット・無効スロット・残り時間) |
| 起動の判定 | 自分の位置 または 1 つ上の位置が受電 (準接続あり) | dispenser と同じ (neighborChanged を継承) | 自分の位置の受電だけ (準接続なし) |
| 予約 | 立ち上がりで 4 tick・優先度 NORMAL (0) | 同じ | 同じ。受電の位置へ置いたときも予約する |
| 予約 tick でやること | 乱数で 1 スロット選び、アイテムごとの振る舞いで処理 | 乱数で 1 スロット選び、前のコンテナへ 1 個入れる。無ければ 1 個落とす | 9 マスでレシピを探し、結果を前へ出す |
| BlockEntity の tick | 無い | 無い | 有る (CRAFTING を戻す秒読み) |
| コンパレーター | 充填率 (→ 14) | 同じ | 「空でない または 無効」のスロット数 0〜9 |

### 2.2 dispenser と dropper の一生 [26.3 読解]

1. 近隣更新が届く (DispenserBlock#neighborChanged)。形状更新・設置・自分の予約 tick では判定しない。
2. 受電を調べる。自分の位置で SignalGetter#hasNeighborSignal、偽なら 1 つ上の位置でも同じ判定をする。
3. 受電していて TRIGGERED が偽なら、4 tick 後・NORMAL の予約を積み、続けて TRIGGERED=真 をフラグ 2 で書く。
4. 受電が無く TRIGGERED が真なら、TRIGGERED=偽 をフラグ 2 で書く。積んだ予約は消さない。
5. 4 tick 後の相 b で予約が回る。位置のブロックが同じ種類なら tick を呼ぶ。**受電も TRIGGERED も見直さない**。
6. 9 スロットから世界の乱数で 1 つ選ぶ。全部空なら失敗の音で終わる (dispenser だけ GameEvent も出す)。
7. dispenser はアイテムごとの振る舞い (§4.6)、dropper は搬入か落とす (§4.11) を行う。戻りの中身をスロットへ書く。
8. スロットへの書き込みで、自分の周りへコンパレーター更新が出る。中身が変わらなくても出る。

[実機 1.21.1: dropper-insert] t2 にレバー → t2 に triggered=true → t8 にホッパーを読むコンパレーターが ON。ホッパーの中身は記録に出ないが、t6 の搬入からコンパレーターの 2 tick と読むと合う。

### 2.3 crafter の一生 [26.3 読解]

1. 近隣更新が届く (CrafterBlock#neighborChanged)。自分の位置の受電だけを調べる。
2. 立ち上がり: 4 tick・NORMAL の予約 → TRIGGERED=真 (フラグ 2) → BlockEntity の triggered=1。
3. 立ち下がり: TRIGGERED=偽 と CRAFTING=偽 を 1 回で書く (フラグ 2) → BlockEntity の triggered=0。
4. 相 b の予約 tick で dispenseFrom。9 マスからレシピを探す。無ければ失敗の音だけで、何も書かない。
5. 有れば: 残り時間を 6 → CRAFTING=真 (フラグ 2) → 結果を前へ → 残りもの (空のバケツなど) を前へ → 空でない全スロットを 1 ずつ減らす → コンパレーター更新。
6. 相 g で毎 tick、残り時間を 1 減らす。0 になった tick に CRAFTING=偽 をフラグ 3 で書く。

### 2.4 フェーズ上の位置 [26.3 読解]

| 時点 | dispenser・dropper | crafter |
|---|---|---|
| 近隣更新を受けた所 (どの相でも) | TRIGGERED を書き、予約を積む | 同じ。立ち下がりで CRAFTING も偽 |
| 相 b (予約 tick) | 発火 | クラフト |
| 相 g (BlockEntity) | 何もしない (ticker が無い) | 秒読み。0 で CRAFTING=偽 |
| プレイヤーが置く (BlockItem#place) | 何もしない。受電していても TRIGGERED=偽 で置かれる | 受電していれば TRIGGERED=真 で置かれ、予約を積む |

### 2.5 出す更新の早見表 [26.3 読解]

| 契機 | 書く物 | フラグ | 近隣更新 | 形状更新 | コンパレーター更新 |
|---|---|---|---|---|---|
| 立ち上がり・立ち下がり (3 種とも) | TRIGGERED (crafter の立ち下がりは CRAFTING も) | 2 | なし | あり (オブザーバーが見る) | なし |
| 発火後のスロットの書き直し (dispenser・dropper) | BlockEntity のスロット | — | なし | なし | 自分の周り。中身が同じでも出る |
| dropper の搬入 | 相手の BlockEntity | — | なし | なし | 相手の周り (入ったときだけ) → 続けて自分の周り |
| 振る舞いが前のブロックを書き換える | 前のブロック | 振る舞いごと (§4.6) | フラグ次第 | フラグ次第 | 置いた物がアナログ出力を持てばあり |
| crafter が作る | CRAFTING=真 | 2 | なし | あり | なし |
| crafter が前へ入れる | 相手の BlockEntity | — | なし | なし | 相手の周り |
| crafter が材料を減らす | 自分の BlockEntity (setChanged 1 回) | — | なし | なし | 自分の周り |
| crafter の秒読みが 0 | CRAFTING=偽 | 3 | あり (6 方向) | あり | あり (アナログ出力を持つため) |
| 空打ち (全スロット空・レシピ無し) | 何も書かない | — | なし | なし | なし |
| 壊す・置き換える | — | (04) | (04) | (04) | affectNeighborsAfterRemoval で自分の周り。書き込みのフラグに 1 があるか、ピストンで動いたときだけ (§4.16) |

フラグ 3 の書き込みは、近隣更新 → (アナログ出力を持てば) コンパレーター更新 → 形状更新 の順に配る (Level#setBlock)。中身は → 04。

---

## 3. 状態とデータ

### 3.1 blockstate [26.3 読解]

| ブロック | プロパティ | 値 | 既定 | 意味 |
|---|---|---|---|---|
| dispenser / dropper | facing | down・up・north・south・west・east | north | 出す向き。置くと見ている向きの反対 |
| | triggered | false・true | false | 立ち上がりの記憶。発火の条件ではない |
| crafter | orientation | 12 値: down_east・down_north・down_south・down_west・up_east・up_north・up_south・up_west・west_up・east_up・north_up・south_up | north_up | 前半が front (出す向き)。後半の top は見た目だけ |
| | triggered | false・true | false | 同上 |
| | crafting | false・true | false | 作った tick から 5 tick (T〜T+4) だけ真。その前に立ち下がりが来れば、そこで偽に戻る。見た目と更新だけで、判定には使わない |

状態数は dispenser・dropper が 12、crafter が 48。

### 3.2 BlockEntity [26.3 読解]

| BlockEntity | 値 | 範囲 | 保存のキー | 意味 |
|---|---|---|---|---|
| DispenserBlockEntity・DropperBlockEntity | 中身 | 9 スロット | Items (各要素に Slot) | |
| | ルートテーブル | — | LootTable・LootTableSeed | 構造物用。初めてスロットを読むときに展開する |
| | 名前・鍵 | — | CustomName・lock | 挙動には効かない |
| CrafterBlockEntity | 中身 | 9 スロット | Items | |
| | 無効スロット | 9 個の 0/1 | disabled_slots (int 配列) | 空のスロットだけ無効にできる |
| | triggered | 0/1 | triggered | GUI の表示用。blockstate の TRIGGERED と同じ値を入れる |
| | craftingTicksRemaining | 0〜6 | crafting_ticks_remaining | CRAFTING を戻すまでの残り |

### 3.3 定数 [26.3 読解]

| 名前 | 値 | 使い道 |
|---|---|---|
| DispenserBlock の TRIGGER_DURATION | 4 | 予約の遅延 (dispenser・dropper) |
| CrafterBlock の CRAFTING_TICK_DELAY | 4 | 予約の遅延 (crafter) |
| CrafterBlock の MAX_CRAFTING_TICKS | 6 | 残り時間の初期値 |
| CrafterBlock の RECIPE_CACHE | 10 件 | 全クラフターで共有するレシピの覚え (結果は変えない) |
| CrafterBlock の CRAFTER_ADVANCEMENT_DIAMETER | 17 | 進捗を配る範囲。挙動には効かない |
| DispenserBlockEntity の CONTAINER_SIZE | 9 | |
| DefaultDispenseItemBehavior の DEFAULT_ACCURACY | 6 | 落とすアイテムの速さのばらつき (0.0172275 × 6) |
| 落とす位置 | 中心 + 向き × 0.7 | 縦向きは y を 0.125、横向きは 0.15625 下げる |
| Container の既定の上限 | 99 | アイテム側の上限との小さい方が実際の上限 |

### 3.4 ブロックの性質 [26.3 読解]

| 性質 | dispenser・dropper | crafter | 典拠 |
|---|---|---|---|
| 導体 | 導体 | 導体 | 既定の isRedstoneConductor (フルキューブ)。[実機 1.21.1: wire-cut-conductor] [実機 1.21.1: observer-dropper-conductor] |
| 信号源 | ではない | ではない | getSignal を持たない |
| ピストン | 押せない | 押せない | PistonBaseBlock#isPushable。押し反応は既定で、最後の「BlockEntity を持たない」で偽 |
| アナログ出力 | 有る | 有る | hasAnalogOutputSignal が真 |
| 硬さ | 3.5 | 1.5 (爆発耐性 3.5) | Blocks の登録 |

---

## 4. 処理の詳細

### 4.1 DispenserBlock#neighborChanged (dispenser・dropper) [26.3 読解]

- 契機: 近隣更新だけ。向きの引数 (Orientation) と更新元のブロックは使わない。
- 判定: 自分の位置の hasNeighborSignal、または 1 つ上の位置の hasNeighborSignal。6 面すべてを数え、前 (facing) の面からの信号も数える。ピストンと違って除く面は無い。
- 書き込み:
  1. 受電・TRIGGERED 偽 → 予約 (4・NORMAL) を先に積む → TRIGGERED=真 をフラグ 2。
  2. 非受電・TRIGGERED 真 → TRIGGERED=偽 をフラグ 2。
  3. それ以外は何もしない。
- 予約は (位置, ブロック種) で重複排除される (→ 02)。予約が残っている間の 2 回目の立ち上がりは、予約を足さない。
- 準接続は「近隣更新が届いた時点で 1 つ上も見る」だけである。1 つ上が受電しても、dispenser へ近隣更新が届かなければ起動しない (BUD)。[実機 1.21.1: crafter-trigger] (z=6 の dispenser は t6 の setblock では動かず、t10 に隣へ石を置いた更新で triggered=true)

### 4.2 DispenserBlock#tick → dispenseFrom (dispenser) [26.3 読解]

1. 位置の BlockEntity を DISPENSER 型で取る。無ければ警告を出して終わる。
2. BlockSource (level・位置・この tick の state・BlockEntity) を作る。
3. getRandomSlot (§4.3)。
4. 全部空 (-1) → levelEvent 1001 と GameEvent BLOCK_ACTIVATE (自分の位置、自分の state を添える)。スロットは書かない。
5. それ以外 → getDispenseMethod (§4.4) → 振る舞いの dispense → 戻りの ItemStack をそのスロットへ setItem。setItem は BaseContainerBlockEntity#setItem で、スタックの上限で切り詰めてから setChanged を呼ぶ。setChanged は Level#updateNeighbourForOutputSignal を呼ぶ (→ 04)。
6. 振る舞いが NOOP なら書かない分岐があるが、26.3 の表にも既定の選び方にも NOOP は出てこない。常に書く。

順序: 振る舞いの中の世界への書き込み (前のブロックの近隣更新・形状更新) が先に走り切り、最後に dispenser 自身のコンパレーター更新が出る。例外は consumeWithRemainder の残りもの (§4.5) で、空きスロットへ入れるときはその setItem が先にコンパレーター更新を 1 回出す。合流するときは出さない。

### 4.3 DispenserBlockEntity#getRandomSlot (どのスロットを選ぶか) [26.3 読解]

1. ルートテーブルが残っていれば先に展開する (unpackLootTable、プレイヤーなし)。
2. 候補を -1、数えを 1 にする。
3. スロット 0〜8 を順に見る。空でないスロットごとに、乱数の nextInt に今の数えを渡す (渡した後で数えを 1 増やす)。0 が出たらそのスロットを候補にする。
4. 最後の候補を返す。

| 論点 | 中身 |
|---|---|
| 分布 | 空でないスロットの中から等確率。スタックの個数・アイテムの種類によらない |
| 引く回数 | 空でないスロットの数だけ。nextInt は上限が 1・2・4・8 なら 31 bit を 1 回。3・5・6・7・9 も 1 回で、2^31 回に 2〜3 回だけやり直しでもう 1 回 (BitRandomSource#nextInt) |
| 乱数の出どころ | Level の random フィールド (ServerLevel ごとに 1 つ)。LegacyRandomSource = 48 bit の線形合同法 (乗数 25214903917・加数 11)。種は起動のたびの一意な値 (RandomSupport#generateUniqueSeed) で、ワールドのシードとは関係ない |
| 同じ乱数を使う者 | ランダム tick (相 d)、予約 tick に渡る random 引数 (ServerLevel#tickBlock が渡す)、落とすアイテムの初速 (dispenser・dropper・crafter)、TNT の初速、骨粉、dropper と crafter の前のエンティティのコンテナ選び (候補が 1 つでも nextInt を 1 回引く)、火の玉・ウィンドチャージの向きのぶれ、水のポーションの泥化の演出 (nextDouble 10 回)、水の蒸発する環境での水バケツの音 (nextFloat 2 回) |
| 使わない所 | アイテムのエンティティの向きと、生成時に入る仮の初速はエンティティ自身の乱数 (ItemEntity の生成)。投射物のぶれもエンティティ自身の乱数 (Projectile#getMovementToShoot)。どちらも世界の乱数の並びには効かない |
| 決定性 | 同じワールドを 2 回動かしても一致しない。1 スロットだけ、または全スロットが同じ種類なら、選ばれたスロットによらず結果 (出る物・充填率) は同じ |

### 4.4 DispenserBlock#getDispenseMethod (振る舞いの選び方) [26.3 読解]

上から順に最初に当たったものを使う。

1. アイテムがこのワールドで無効 (feature flag) → 既定 (落とす)。
2. 登録表 (DISPENSER_REGISTRY。アイテムの同一性で引く) にある → それ。
3. EQUIPPABLE 部品を持つ → EquipmentDispenseItemBehavior (装備)。
4. タグ sulfur_cube_swallowable に入る → SulfurCubeBlockDispenseItemBehavior (sulfur_cube に食べさせる。無理なら落とす)。
5. スポーンエッグで ENTITY_DATA 部品を持つ → SpawnEggItemBehavior。
6. それ以外 → 既定 (落とす)。

dropper は DropperBlock#getDispenseMethod で常に既定を返すが、dispenseFrom を上書きしているので実際にはこの選び方を通らない (§4.11)。

### 4.5 振る舞いの枠組み [26.3 読解]

| 系統 | dispense の流れ | 失敗したとき |
|---|---|---|
| Default 系 (DefaultDispenseItemBehavior の子) | execute → 音 (levelEvent 1000、種類により別の番号) → 演出 (2000、向きの番号) | 子ごとに「既定で落とす」へ落ちるか、何もせず返す |
| Optional 系 (OptionalDispenseItemBehavior の子) | 同じ。音だけ成否で 1000 / 1001 に分かれる | 多くは中身をそのまま返す = **アイテムが残る** |

- 既定の execute: 1 個を分けて、アイテムのエンティティとして出す。位置は §3.3。初速は「0.2 + 乱数 × 0.1」を向きの x・z に掛け、y は 0.2 を中心にする。3 成分とも triangle で 0.103365 のばらつき (世界の乱数で nextDouble を 7 回)。下向きでも y の初速は 0.2 が中心である。
- Optional 系の成否の旗は振る舞いの実体に 1 つだけあり、全ディスペンサーで共有する。呼ぶたびに戻さない子がある。チェストとハニカムは偽にしないので常に真。ブラシは失敗で偽にするが、成功で真に戻さない。TNT はルールが偽のとき偽にし、sulfur_cube に食べさせた回は前の値のまま。効くのは音 (1000 / 1001) だけで、中身や世界の書き込みには効かない。
- 失敗して内側の既定の振る舞いへ落ちる子 (水・溶岩などのバケツ・水のポーション・トロッコ・ボート) は、内側と外側の両方が音と演出を出す。levelEvent 1000 と 2000 が 2 回ずつになる。
- consumeWithRemainder (バケツ・瓶): 1 個減らす。空になったら残りもの (空バケツなど) がそのスロットに入る。空にならなければ残りものを DispenserBlockEntity#insertItem で自分に入れる (0 番から、空か同じアイテムのスロットへ上限まで)。空きへ入れるときは setItem を通るのでコンパレーター更新が出る。合流は数を足すだけで出さない。入りきらない分はアイテムとして落とし、音 1000 と演出 2000 をもう 1 回出す。
- スポーンエッグの振る舞いでスポーンが例外を出すと、中身は空 (EMPTY) になる。

### 4.6 登録表 (アイテム → 動作) [26.3 読解]

「中身」は成功時のスロットの変化。「失敗」は条件を満たさないとき。GameEvent の位置は「前」= 向きの先の 1 マス、「自分」= dispenser の位置。

| アイテム | 動作と世界への書き込み | 中身 | 失敗 | GameEvent |
|---|---|---|---|---|
| arrow・tipped_arrow・spectral_arrow・egg・blue_egg・brown_egg・snowball・experience_bottle・splash_potion・lingering_potion・firework_rocket・fire_charge・wind_charge | 投射物を撃つ (§4.10) | 1 減 | 無い | 撃つ時点では無い (PROJECTILE_SHOOT はエンティティの最初の tick → 17) |
| lava_bucket・water_bucket・powder_snow_bucket・魚 4 種・axolotl・tadpole・sulfur_cube のバケツ | 前に中身を置く (§4.7) | 空のバケツ | バケツを落とす | FLUID_PLACE (前) |
| bucket | 前の流体を汲む (§4.7) | 汲んだバケツ | バケツを落とす | FLUID_PICKUP (前) |
| shulker_box (全色) | 前に置く (§4.8) | 1 減 | **残る** | BLOCK_PLACE (前) |
| bone_meal | 前を成長させる (§4.9) | 1 減 | **残る** | 無い |
| shears | 蜂の巣を刈る・リードを切る・モブを刈る (§4.9) | 耐久 1 減 | **残る** | SHEAR (蜂の巣とモブは前。リードはエンティティ自身) |
| flint_and_steel | 火・点火 (§4.9) | 耐久 1 減 | TNT でルールが偽のときだけ (**残る**) | BLOCK_PLACE・BLOCK_CHANGE (前)。TNT の PRIME_FUSE は TntBlock#prime が前で出す。sulfur_cube の PRIME_FUSE はエンティティ自身 |
| tnt | ゲームルール tnt_explodes が真なら、前の sulfur_cube に食べさせる。無理なら前のマスの (x+0.5, y, z+0.5) に PrimedTnt (fuse 80。初速の向きに世界の乱数を 1 回) | 1 減 | ルールが偽なら**残る** | ENTITY_PLACE (前) |
| minecart 6 種 | レールへトロッコを出す (§4.10) | 1 減 | 置き場が無ければ落とす | 無い |
| oak_boat ほか全ボート・チェスト付きボート・竹のいかだ (26.3 は poplar を含む) | 前の流体が水、または前が空気で下の流体が水ならボートを出す。位置は中心から横へ「0.5625 + 幅の半分」、縦へ「向きの y × 1.125」。前が水なら更に +1.0 | 1 減 (作れなければ残る) | 落とす | 無い |
| armor_stand | 前の位置に防具立てを出す (向きは facing) | 出せたら 1 減 | 出せなければ残る | 無い |
| chest | 前のマスの、飼い慣らされてチェストの無いロバ・ラバ・ラマにチェストを付ける | 1 減 | 落とす | 無い |
| carved_pumpkin | 前が空気でゴーレムの形 → 置く (フラグ 3)。違えば装備 (§4.10) | 1 減 | **残る** | BLOCK_PLACE (前) |
| wither_skeleton_skull | 前が空気でウィザーの形 → 頭を置き (フラグ 3。ROTATION は向きから)、召喚判定。違えば装備 | 1 減 | **残る** | BLOCK_PLACE (前) |
| glass_bottle | 前が蜂の巣で HONEY_LEVEL 5 → HONEY_LEVEL=0 (フラグ 3) → 蜂を出す、ハチミツ瓶。前の流体が水 (流水・水浸しのブロックも) → 水入り瓶 (水は消えない) | 1 減。満たした瓶は consumeWithRemainder (§4.5) | 瓶を落とす (音は失敗) | FLUID_PICKUP (自分) |
| glowstone | 前がリスポーンアンカーで CHARGE が 4 未満 → +1 (フラグ 3) | 1 減 | CHARGE 4 なら**残る**。アンカー以外は落とす | BLOCK_CHANGE (前) |
| honeycomb | 前が蝋付けできるブロック (銅系。銅の電球を含む) → 蝋付けした状態 (フラグ 3) | 1 減 | 落とす | 無い |
| potion | 水のポーションで、前が convertible_to_mud (土の類) → 演出に世界の乱数を 10 回 → FLUID_PLACE → 泥 (フラグ 3) の順 | ガラス瓶 (consumeWithRemainder) | 落とす (水以外のポーションも落とす) | FLUID_PLACE (自分)。泥の書き込みより先 |
| brush | 前のマスのアルマジロ (観戦者以外) から鱗甲を取る。子どもは取れない | 耐久 16 減 | **残る** | ENTITY_INTERACT (アルマジロ自身。Armadillo#brushOffScute) |
| EQUIPPABLE を持つ物 (防具・エリトラ・頭・鞍・馬鎧・ラマのカーペットなど) | 前のマスの生き物に装備させる (§4.10) | 1 減 | 落とす | 無い (装備側の EQUIP → 17) |
| sulfur_cube_swallowable タグ | 前のマスの sulfur_cube に食べさせる | 1 減 | 落とす | 無い |
| スポーンエッグ | 前の位置へスポーン (上向き以外は足場に合わせて高さを補正) | 1 減 | 出せなければ残る | ENTITY_PLACE (自分) |
| それ以外 | 1 個を落とす | 1 減 | 無い | 無い |

「残る」と「落とす」の違いは中身の数に出る。コンパレーターで dispenser を読む回路では効く。

### 4.7 バケツ [26.3 読解]

水・溶岩などのバケツ (BucketItem#emptyContents。dispenser からはプレイヤーなし・当たり判定なし)

1. 前の位置 P の状態 S を読む。
2. 置けるのは、S が空気、S が「この流体で置き換えられる」(BlockBehaviour#canBeReplaced の流体版。既定は replaceable か、固体でない)、S が水を受けられる LiquidBlockContainer (水だけ) のどれか。どれでもなければ失敗 → バケツを 1 個落とす。
3. 水で、P が水の蒸発する環境 (ネザー。環境属性 water_evaporates) → 何も置かずに成功。GameEvent も出さない。音のピッチに世界の乱数を 2 回 (nextFloat) 使う。
4. 水で、S が LiquidBlockContainer → placeLiquid を呼んで成功。水浸しにできるブロックなら WATERLOGGED=真 (フラグ 3) → 水の予約 (水の遅延 5) の順。既に水浸しでも「置ける」と判定され (SimpleWaterloggedBlock#canPlaceLiquid は水かどうかしか見ない)、何も書かずに成功する。海草・背の高い海草・昆布も LiquidBlockContainer で、placeLiquid は何もしないが成功になる (置き換え可能または固体でないので 2 を通る)。
5. それ以外: S が置き換えられて液体でなければ、先に Level#destroyBlock で壊す。落とし物を出し、元の流体の状態 (ふつうは空気) をフラグ 3・更新の深さ 512 で書き、BLOCK_DESTROY (P) を出す。続けて流体の源をフラグ 11 で書く。書き込みが変化なしでも、元が源なら成功とする。
6. 成功なら FLUID_PLACE (P)。3 の蒸発の枝だけは出さない。魚などのバケツはここで中身のモブを出す (checkExtraContent)。consumeWithRemainder で空のバケツにする。

- 水源へ水バケツ: 書き込みは変化なし (LevelChunk#setBlockState が null) なので**ブロックの更新は出ない**。それでもバケツは空になり、FLUID_PLACE は出る (スカルクセンサーは反応する)。
- 泡柱へ水バケツ: 泡柱は replaceable で液体扱い。壊さずに水源で上書き (フラグ 11)。泡柱はその後に作り直される (→ 16)。
- 前に回路の部品があると壊す。当たり判定の無いダスト・トーチ・レバー・ボタン・トリップワイヤーと、薄いリピーター・コンパレーターは「固体でない」(BlockBehaviour#calculateSolid。当たり判定の箱の平均の辺が 0.7291666666666666 未満で、高さも 1 未満) ので 5 の destroyBlock を通る。
- レール 4 種は水浸しにできる (BaseRailBlock) ので、水では壊れず 4 の WATERLOGGED=真 になる。感圧板は全 17 種 (石・木・重量・磨かれたブラックストーン) が Blocks の登録で forceSolidOn を持ち「固体」なので、水も溶岩も置けずに失敗する (バケツを落とす)。固体かどうかの規則と状態表は → 05 (§4.7.2)・16。
- 溶岩バケツも同じ流れで、3 と 4 は無い。LiquidBlockContainer にも水浸しのブロックにも入らず、固体でなければ壊して置く (レールも壊す)。
- 粉雪のバケツ (SolidBucketItem#emptyContents): P が空気 (と世界の高さの内) のときだけ粉雪をフラグ 3 で置き、FLUID_PLACE。

空のバケツ

1. 前の位置 P のブロックが BucketPickup なら pickupBlock を呼ぶ。
   - 流体ブロック: LEVEL 0 (源) なら空気をフラグ 11 で書き、その流体のバケツ。源でなければ空。
   - 水浸しのブロック: WATERLOGGED=偽 (フラグ 3)。支えを失えば壊す。水バケツ。水浸しでなければ空。
   - 泡柱: 空気をフラグ 11。水バケツ。
   - 粉雪: 空気をフラグ 11。粉雪のバケツ。
2. 取れたら FLUID_PICKUP (P)。consumeWithRemainder で取れたバケツにする。
3. 取れない・BucketPickup でない → 空のバケツを 1 個落とす。

1 個のバケツは「水を置く ↔ 汲む」を同じスロットで交互に繰り返す。空バケツを重ねて入れると、汲んだバケツが別のスロットへ入り、次からどちらを使うかが乱数になる。

### 4.8 シュルカーボックスの設置 [26.3 読解]

1. 前の位置 P を決める。P の真下が空気なら clickedFace = 向き、そうでなければ UP。
2. DirectionalPlaceContext (位置 P・向き・clickedFace) で BlockItem#place を呼ぶ。
3. 置ける条件: アイテムが有効、P が置き換え可能 (空気・水・草など)、置く状態の当たり判定にエンティティがいない。
4. 置く: setBlock をフラグ 11 (1+2+8)。近隣更新・コンパレーター更新・形状更新が出る。
5. その後でアイテムの部品 (中身など) を BlockEntity へ写し、setChanged → もう一度コンパレーター更新。
6. BLOCK_PLACE (P)。アイテムを 1 減らす。
7. 失敗なら中身はそのまま。音は 1001。

置かれたシュルカーボックスの FACING は clickedFace と同じ (ShulkerBoxBlock#getStateForPlacement)。下に足場があると上向き、宙に置くと dispenser の向きになる。

### 4.9 骨粉・ハサミ・火打石と打ち金 [26.3 読解]

骨粉 (BoneMealItem#growCrop → growWaterPlant)

1. 前のブロックが骨粉の対象として有効なら、成功判定 (世界の乱数) が真のときだけ成長させる (世界の乱数)。判定の成否によらず 1 個減らして成功。
2. 1 が偽で、前が満杯の水ブロックなら、海草・サンゴを最大 128 回試して置く (フラグ 3)。1 個減らして成功。
3. どちらも偽なら失敗。アイテムは残る。
4. 成長が置くブロックとそのフラグは各ブロックの performBonemeal による (→ 11 付録 F.12)。

ハサミ

1. 前が蜂の巣・ミツバチの巣で HONEY_LEVEL 5 以上 → 音 → ハチの巣のかけらを落とす → HONEY_LEVEL=0 (フラグ 3。BeehiveBlock#resetHoneyLevel) → 蜂を出す → SHEAR (前) の順。成功。
2. でなければ前のマスのエンティティ (観戦者以外) を一覧の順に見る。そのエンティティのリードのつながりを外せたら成功 (SHEAR はエンティティ自身が出す。Entity#shearOffAllLeashConnections)。生きていて刈れる状態 (Shearable の readyForShearing) なら刈って SHEAR (前)、成功。どちらも最初に当たった 1 体で終わる。
3. 成功なら耐久 1 減。失敗なら何もしない (アイテムは残る)。
4. トリップワイヤーは切らない。カボチャも彫らない。

火打石と打ち金 (FlintAndSteelDispenseItemBehavior)

1. 成否の旗を真にする。
2. 前のマスに爆発できる sulfur_cube (SulfurCube#canExplode。ゲームルールは見ない) がいれば、一覧の先頭に点火して終わる。点火 (SulfurCube#primeTime) はルール tnt_explodes が偽だと何もしないが、26.3 はその戻りを見ないので成功のまま進む。
3. いなければ順に試す。
   a. 前が空気で火が置ける (BaseFireBlock#canBePlacedAt: 空気で火が生き残れる、またはポータルの枠) → 火をフラグ 3。BLOCK_PLACE。
   b. 焚き火・ろうそく・ろうそく付きケーキで点けられる → LIT=真 をフラグ 3。BLOCK_CHANGE。
   c. TNT のブロック → TntBlock#prime (ゲームルール tnt_explodes が真なら PrimedTnt を出して PRIME_FUSE) が真なら removeBlock (空気をフラグ 3)。偽なら失敗。
   d. どれでもない → 何もしない。**旗は真のまま**。
4. 旗が真なら耐久 1 減。尽きたら消える。

26.3 では「前が石」のように何もできないときも成功扱いで、耐久が減り、音も成功になる。分岐の最後に旗を偽にする枝が無いからで、読みは一つに決まる [26.3 読解: FlintAndSteelDispenseItemBehavior#execute]。26.2 も同じ (26.2 → 26.3 の差は TntBlock#prime の引数だけ)。[版差 1.21.1] [版差 26.4-pre-1] どちらも失敗 (耐久は減らない)。版で揺れる所なので、P11 で 26.3 の実機を撮っておく。

### 4.10 トロッコ・装備・投射物 [26.3 読解]

トロッコ (MinecartDispenseItemBehavior)

| 前のマス F | 高さの補正 |
|---|---|
| レール (rails タグ) | 平ら +0.1、坂 +0.6 |
| 空気で、その下がレール | 平らまたは下向き -0.9、坂で下向き以外 -0.4 |
| それ以外 | 出さずにトロッコのアイテムを落とす |

- 出す位置: 横は中心から向きへ 1.125、縦は「中心の y の切り捨て + 向きの y 成分 + 補正」。
- 出せたら 1 減。作れなければ (null) 残る。GameEvent は出さない。

装備 (EquipmentDispenseItemBehavior#dispenseEquipment)

1. 前のマス (1×1×1) の LivingEntity のうち、LivingEntity#canEquipWithDispenser が真のものを集める。条件は、生きていて観戦者でない、アイテムに EQUIPPABLE があり dispensable が真、そのスロットを使えて種類が許され、そのスロットが空、モブごとの追加条件 (既定は真)。
2. 一覧の先頭に 1 個を分けて装備させる。Mob なら確実に落とす設定と、消えない設定を付ける。
3. いなければ既定 (落とす)。防具立ても LivingEntity なので装備させられる。
4. くり抜いたカボチャとウィザースケルトンの頭は登録表が先で、装備は 2 番目の手段。どちらも装備できなければ**残る**。

投射物 (ProjectileDispenseBehavior と各アイテムの createDispenseConfig)

| アイテム | 出る位置 | power | uncertainty | 音の levelEvent |
|---|---|---|---|---|
| arrow・tipped_arrow・spectral_arrow・egg・blue_egg・brown_egg・snowball | 中心 + 向き × 0.7 + 上へ 0.1 | 1.1 | 6.0 | 1002 |
| experience_bottle・splash_potion・lingering_potion | 同上 | 1.375 | 3.0 | 1002 |
| firework_rocket | 中心 + 向き × 0.50001 (面のすぐ外) | 0.5 | 1.0 | 1004 |
| fire_charge | 中心 + 向き × 1.0 | 1.0 | 6.6666665 | 1018 |
| wind_charge | 同上 | 1.0 | 6.6666665 | 1051 |

- エンティティを作り (矢は拾える設定)、Projectile#spawnProjectileUsingShoot で向きへ撃ってから世界に足す。ぶれはエンティティ自身の乱数を使う。fire_charge と wind_charge は作る段で世界の乱数を 6 回使う。
- 常に 1 減。弾道と当たりは → 17。

### 4.11 DropperBlock#dispenseFrom (dropper) [26.3 読解]

1. 位置の BlockEntity を DROPPER 型で取る。無ければ警告を出して終わる。
2. getRandomSlot (§4.3)。
3. 全部空 → levelEvent 1001 だけ。**GameEvent は出さない** (dispenser との違い)。[版差 26.4-pre-1] BLOCK_ACTIVATE を出す (§6.1)。
4. 選んだスタックが空でなければ:
   a. 向きは今の blockstate から読み直す。
   b. 前のコンテナを HopperBlockEntity#getContainerAt で探す (§4.12)。
   c. 無い → 既定の振る舞いで 1 個落とす。アイテムの種類によらない (水バケツも落とす)。
   d. 有る → 1 個だけの複製を HopperBlockEntity#addItem で入れる (面は向きの反対)。入れば元から 1 減らした複製、入らなければ元のままの複製を用意する。音と演出は出さない。
5. 用意したスタックをスロットへ setItem → 自分の周りにコンパレーター更新 (入らなかったときも出る)。

[実機 1.21.1: dispenser-no-insert] 同じ配置で dropper だけが前のバレルへ入れ、dispenser は入れない。

### 4.12 搬入 (HopperBlockEntity の該当部分) [26.3 読解]

getContainerAt (前の位置)

1. ブロックが WorldlyContainerHolder (コンポスター) なら、その getContainer。
2. BlockEntity を持ち Container なら、それ。チェストは ChestBlock#getContainer で大きいチェスト全体にする (上がふさがっていても入る)。
3. どちらでもなければ、そのマス (中心 ±0.5) の生きているコンテナのエンティティ (チェスト付き・ホッパー付きトロッコ、チェスト付きボートなど) から、世界の乱数で 1 つ選ぶ。候補が 1 つでも nextInt を 1 回引く。候補が 0 なら引かない。

addItem (元・先・アイテム・面)

1. 先が WorldlyContainer で面があれば、その面のスロット一覧の順。そうでなければ 0 番から順。
2. 各スロットで tryMoveInItem を呼び、アイテムが空になったら終わる。

tryMoveInItem

1. 先の canPlaceItem と、WorldlyContainer なら canPlaceItemThroughFace が両方真のときだけ試す。
2. スロットが空なら丸ごと置く。同じアイテム・同じ部品で上限未満なら、空きの分だけ合流する。
3. 1 個以上動いたとき: 入れる前に先が空で、先がホッパーで、そのクールダウンが 8 を超えていなければ、クールダウンを 8 にする。元がホッパーのときだけ条件つきで 7 (→ 14)。dropper と crafter は元がホッパーではないので常に 8。
4. 動いたら先の setChanged。空のスロットへ置いたとき、先の setItem が setChanged を呼ぶ種類 (BaseContainerBlockEntity の既定。チェスト・樽・dispenser・dropper・crafter など) ではコンパレーター更新が 2 回になる。ホッパーの setItem は呼ばないので 1 回。大きいチェストは CompoundContainer#setChanged が両半分の setChanged を呼ぶので、空きへ入れると 3 回、合流で 2 回になる (→ 14)。

3 のクールダウンは [実機 1.21.1: dropper-into-hopper-cooldown] が裏づける (dropper が入れた空のホッパーが、すぐには押し戻さない)。

「入る先」は 0 番から順に見て、最初の「空」または「合流できる」スロットである。部分スタックより前に空きスロットがあれば、空きの方へ入る。合流の空きはアイテムの上限で数え、容器の上限 (99 など) は見ない。こちらは実機 fixture がまだ無い。

### 4.13 CrafterBlock#neighborChanged・設置 [26.3 読解]

neighborChanged

1. 受電 = 自分の位置の hasNeighborSignal だけ。準接続は無い。[実機 1.21.1: crafter-trigger] (z=4 の crafter は 1 つ上の隣のレッドストーンブロックと t8 の更新でも起動しない)
2. BlockEntity を先に取っておく。
3. 受電・TRIGGERED 偽 → 予約 (4・NORMAL) → TRIGGERED=真 (フラグ 2) → BlockEntity の triggered=1。
4. 非受電・TRIGGERED 真 → TRIGGERED=偽 と CRAFTING=偽 をフラグ 2 で 1 回に書く → BlockEntity の triggered=0。

設置

1. getStateForPlacement: front は見ている向きの反対。top は、front が下なら水平の向きの反対、上なら水平の向き、横なら上。TRIGGERED は置く前のワールドで、置く位置の hasNeighborSignal。
2. newBlockEntity: BlockEntity の triggered を blockstate の TRIGGERED に合わせる。
3. setPlacedBy: TRIGGERED が真なら 4 tick の予約を積む。BlockItem#place の経路だけで呼ばれる。構造物やコマンドの書き込みでは呼ばれない。

### 4.14 CrafterBlock#tick → dispenseFrom・dispenseItem [26.3 読解]

dispenseFrom (相 b)

1. BlockEntity が CrafterBlockEntity でなければ何もしない。
2. CraftingContainer#asCraftInput: 3×3 から、空でないマスを囲む最小の長方形を切り出す。無効スロットは空のマスとして扱う。
3. getPotentialResults で探す。RecipeCache は全クラフター共有の 10 件で、入力のアイテムの種類と部品で引き、「レシピ無し」も覚える。結果は変えない。
4. レシピ無し、または assemble の結果が空 → levelEvent 1050。何も書かない。
5. 有り:
   a. 残り時間を 6 にする。
   b. この tick の state から CRAFTING=真 をフラグ 2 で書く。
   c. 結果に onCraftedBySystem。
   d. 結果を dispenseItem。
   e. レシピの残りもの (空でないものだけ、マスの順) をそれぞれ dispenseItem。
   f. 空でない全スロットを 1 ずつ減らす (setItem を通さない)。
   g. setChanged を 1 回 → 自分の周りにコンパレーター更新。

作る順は「CRAFTING=真 → 結果 → 残りもの → 材料を減らす → 自分のコンパレーター更新」で固定である。前のコンテナのコンパレーター更新は、自分のより先に出る。同じ tick に複数の crafter が作るときの順は予約 tick の順 (→ 02) で、共有の RecipeCache は順に影響しない。

dispenseItem

1. 向きは ORIENTATION の front。前のコンテナを getContainerAt で探す。
2. 有り、かつ「先がクラフター」または「結果の個数が先の上限 (先の容量の上限 (既定 99) とアイテムの上限の小さい方) を超える」→ 1 個ずつ addItem。1 個でも入らなければやめる。
3. 有り、それ以外 → 残り全部を addItem。個数が減らなくなるまで繰り返す。
4. 残りがあれば、中心 + front × 0.7 から、残り全部を 1 つのアイテムとして出す (§4.5 と同じ初速の式・世界の乱数)。前にコンテナが有っても、満杯で入らなかった分はここで落ちる (dropper は落とさない)。17 四方のプレイヤーに進捗。levelEvent 1049 と 2010。
5. 全部入ったときは音も演出も出さない。

### 4.15 CrafterBlockEntity#serverTick (CRAFTING の時間) [26.3 読解]

1. 相 g で毎 tick 呼ばれる (ticker は向きや状態によらず常にある)。渡る state はその時点の位置の state。
2. 残り時間 - 1 が 0 以上なら、残り時間をその値にする。
3. それが 0 なら、CRAFTING=偽 をフラグ 3 で書く (setBlockAndUpdate)。既に偽なら変化なしで、更新は出ない。

| tick | 相 b | 相 g の後の残り時間 | CRAFTING |
|---|---|---|---|
| T | 作る。6 にして CRAFTING=真 (フラグ 2) | 5 | 真 |
| T+1〜T+4 | — | 4・3・2・1 | 真 |
| T+5 | — | 0 → CRAFTING=偽 (フラグ 3) | 偽 |

CRAFTING=真 が見えるのは T〜T+4 の 5 tick。T+5 の書き込みは近隣更新・コンパレーター更新・形状更新を出す。T のフラグ 2 は形状更新だけ。[要実機]

### 4.16 無効スロットと canPlaceItem・コンパレーター出力・撤去 [26.3 読解]

無効スロット (CrafterBlockEntity)

- 無効にできるのは空のスロットだけ (slotCanBeDisabled)。切り替えはプレイヤーの GUI のパケット (ServerGamePacketListenerImpl → setSlotState) で、setChanged を呼ぶ。
- setItem で無効のスロットへ物が入ると、自動で有効に戻る。ホッパーなどは canPlaceItem で弾かれるので入れられない。
- 読み込み時も、空のスロットだけ無効にする。

canPlaceItem (ホッパー・dropper・crafter からの搬入で使う)

1. 無効 → 不可。
2. 満杯 → 不可。
3. 空 → 可。
4. 空でなければ、番号の大きいスロットに「有効で、空」または「有効で、同じアイテム・同じ部品で個数が少ない」ものが 1 つでもあれば不可。無ければ可。

0 番から順に試す搬入と組み合わさり、有効な空きスロットを先に埋め、その後は個数をならす。満杯の判定はアイテムの上限で、容器の上限 99 は見ない。

取り出しには制限が無い。CrafterBlockEntity は canTakeItem を上書きしないので (Container#canTakeItem の既定は真)、下のホッパーはどのスロットからも抜ける (順は → 14)。

コンパレーター出力

- dispenser・dropper: AbstractContainerMenu#getRedstoneSignalFromBlockEntity (充填率 → 14)。
- crafter: CrafterBlockEntity#getRedstoneSignal。「空でない」または「無効」のスロットの数 (0〜9)。個数と上限は見ない。
- 26.x で getAnalogOutputSignal に向きの引数が増えたが、3 つとも使わない。

撤去

- LevelChunk#setBlockState の中の順は次のとおり (3 つとも同じ)。
  1. 別のブロックになり BlockEntity が残らないなら、BlockEntity#preRemoveSideEffects が中身を全部落とす (フラグ 256 が無いとき)。
  2. BlockEntity を消す。
  3. 書き込みのフラグに 1 があるか、ピストンで動いたときだけ、affectNeighborsAfterRemoval → Containers#updateNeighboursAfterDestroy → 自分の周りへコンパレーター更新。
- フラグ 2 だけの書き込みで消すと、中身は落ちるがコンパレーター更新は出ない。[版差 1.21.1] onRemove (Containers#dropContentsOnDestroy) がフラグによらずコンパレーター更新を出していた (§6)。
- そのあとの近隣更新・形状更新は Level#setBlock の側 (→ 04)。

---

## 5. 端の場合と落とし穴

- **発火は予約 tick の時点で受電を見ない**。0 tick のパルスでも、近隣更新が受電中に届けば 4 tick 後に必ず発火する。
- 受電したまま近隣更新が来ても再発火しない。もう 1 回撃つには、非受電で更新を受けて TRIGGERED を落とす必要がある。
- 4 tick の間に「立ち下がり → 立ち上がり」があっても予約は増えない (重複排除)。2 回目の立ち上がりは失われる。
- dispenser は前の面からの信号でも起動する。ピストンは前を除く。混同しやすい。
- 置いただけの dispenser は、受電していても起動しない (TRIGGERED=偽 で置かれ、自分への近隣更新が無い)。crafter は置いた時点で判定して予約する。
- TRIGGERED=真 のまま受電を失った dispenser は、次の近隣更新で静かに偽へ戻る (発火しない)。
- 準接続の判定は近隣更新の時点だけ。1 つ上の位置の受電の変化では起動しない (BUD)。
- dispenser は前がコンテナでも入れない (chest をロバ系へ付ける・装備を除く)。dropper は前がコンテナなら、満杯でも落とさない。
- dropper はアイテムの種類を見ない。水バケツ・シュルカーボックス・火打石も、ただのアイテムとして入れる・落とす。
- 空打ちの GameEvent は dispenser だけが出す (BLOCK_ACTIVATE、周波数 10)。dropper は出さない。
- 中身が変わらない発火 (満杯の相手・失敗して残る振る舞い) でも、スロットの書き直しでコンパレーター更新が出る。
- 失敗すると残る振る舞い (シュルカーボックス・骨粉・ハサミ・ブラシ・TNT のルール偽・くり抜いたカボチャ・ウィザースケルトンの頭・満充電のアンカーへの発光石・出せなかった防具立てとスポーンエッグ・ルール偽の TNT への火打石と打ち金) と、落とす振る舞いを分ける。中身の数が変わる。
- 26.3 の火打石と打ち金は、何も点けられなくても耐久が減る (§4.9)。
- スロットの選び方は「スロットごとに等確率」。64 個のスタックと 1 個のスタックは同じ確率で選ばれる。
- 水源へ水バケツを撃ってもブロックの更新は出ない (FLUID_PLACE は出る)。泡柱へ撃つと、泡柱が水源へ置き換わる (更新が出る)。
- 水・溶岩のバケツの前にダスト・トーチ・リピーター・コンパレーター・レバー・ボタンがあると、落とし物つきで壊してから流体を置く (§4.7)。感圧板の前では失敗してバケツを落とす。レールは水なら水浸し、溶岩なら壊す。
- バケツの残りものは同じスロットへ戻るとは限らない。重ねた空バケツは汲んだ物を別のスロットへ入れ、入らなければ落とす。
- dropper の前にブロックのコンテナが無いときだけ、エンティティのコンテナ (ホッパー付きトロッコなど) を見る。候補が 1 つでも世界の乱数を 1 回引き、複数いればその値で選ぶ。
- dropper が空のホッパーへ入れると、ホッパーのクールダウンは 8 (同じ tick の相 g で 7 に減る)。
- crafter のレシピが無いときは音だけ。blockstate もコンパレーターも変わらず、オブザーバーも気づかない。
- crafter は空でない**全**スロットを 1 ずつ減らす。結果と残りものを出した後で減らす。
- crafter の出力は、前のコンテナに入りきらない分をまとめて 1 つのアイテムとして出す (dispenser の「1 個ずつ」と違う)。前が満杯のコンテナでも落とす。dropper は満杯の相手の前では落とさないので、ここが逆になる。
- crafter の CRAFTING の終わり (T+5) はフラグ 3 の書き込みで、BUD 状態のピストンなどを起こす。始まり (T) は形状更新だけ。
- crafter のコンパレーターは無効スロットも数える。中身が空でも 0 とは限らない。
- 3 つともピストンで押せない (BlockEntity を持つ)。

---

## 6. 版差

担当クラスを 1.21.1・26.2・26.3・26.4-pre-1 で diff -u した。挙動に効く違いだけを挙げる。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| neighborChanged の判定・予約 (4・NORMAL)・書き込みの順 | 同じ (引数は更新元の位置) | 同じ (引数が Orientation) | 同じ | 同じ |
| getRandomSlot・世界の乱数 | 同じ | 同じ | 同じ | 同じ |
| 振る舞いの表の作り | 既定値つきのハッシュ表。防具・盾・エリトラ・トロッコはアイテム側が登録、スポーンエッグは全部を並べて登録 | 同一性の表 + 部品・タグでの既定の選び方 (§4.4) | 26.2 と同じ | データ駆動。アイテムの部品 DISPENSE_BEHAVIOR が振る舞いの列を持つ (§6.1) |
| 頭 (creeper_head など) で相手がいない | 失敗で**残る** | 装備できなければ**落とす** (EQUIPPABLE の既定) | 26.2 と同じ | 落とす |
| TNT | 常に PrimedTnt | ゲームルール tnt_explodes と sulfur_cube の経路が入る | 同じ | 同じ |
| 火打石と打ち金で何もできない | 失敗 (耐久は減らない) | 成功扱い (耐久が減る) | 26.2 と同じ (読みは一意。実機は P11) | 失敗 |
| 火打石と打ち金で TNT | TntBlock#explode で必ず点火 | TntBlock#prime (ルール偽なら失敗) | 同じ (使ったアイテムも渡す) | 同じ |
| スポーンエッグで出せなかった | それでも 1 減 | 残る | 同じ | 残る |
| fire_charge・wind_charge の撃ち方 | アイテム側の shoot (何もしない) を通る | エンティティの shoot を通る (ぶれが乗る) | 同じ [要実機] | 同じ |
| dropper の空打ち | GameEvent なし | なし | なし | **BLOCK_ACTIVATE を出す** (dispenser と共通の dispenseFrom になった) |
| 撤去 | onRemove で中身を落とし、コンパレーター更新。書き込みのフラグによらず出る | affectNeighborsAfterRemoval と BlockEntity#preRemoveSideEffects に分かれる。コンパレーター更新はフラグに 1 があるか、ピストンのときだけ (§4.16) | 同じ | 同じ |
| ボートの種類 | — | — | poplar のボートが増える | 同じ |
| 水のポーションで泥にするタグ | convertable_to_mud | 同じ | **convertible_to_mud** に名前が変わる (BlockTags)。中身はデータなので未確認 | convertible_to_mud |
| crafter | 同じ流れ | 同じ | CRAFTING の終わりを setBlockAndUpdate で書く (中身はフラグ 3 のまま) | 同じ |
| HopperBlockEntity の搬入の部分 | 同じ | 同じ | 同じ | 同じ |

26.2 → 26.3 の差は、表の crafter・ボート・泥のタグ・TntBlock#prime の引数のほかは、codec の削除・フラグ 3 の setBlock を setBlockAndUpdate に書き換えただけ (中身は同じ)・ハニカムの蝋付けで音を鳴らすようになった、の 3 つで、挙動には効かない。DispenserBlockEntity・HopperBlockEntity・DefaultDispenseItemBehavior と、残りの core/dispenser のクラスは 26.2 と同じ。

既存の実機 fixture (1.21.1) の dropper-insert・dispenser-no-insert・crafter-trigger・dropper-into-hopper-cooldown・observer-dropper-conductor・wire-cut-conductor は、上の差に触れないので 26.3 でも有効である。

### 6.1 26.4-pre-1 の作り替え [版差 26.4-pre-1]

1. 振る舞いは DispenseBehavior の**列**になる。DispenseBehavior#dispense が先頭から試す。成功 → そこで止めて残りを返す。止める失敗 → 元のまま返す。続ける失敗 → 次を試す。最後まで失敗なら失敗の音と演出で元のまま返す。
2. 列はアイテムの部品 DISPENSE_BEHAVIOR に入る。全アイテムの既定は default = [sulfur_cube の装備, 落とす]。データパックで変えられる。
3. 主な列: filled_bucket = [中身を出す, 落とす]、empty_bucket = [汲む, 落とす]、shulker_box = [置く]、shears = [刈る]、flint_and_steel = [点ける]、tnt = [sulfur_cube の装備, TNT を出す]、equipment = [装備, 落とす]、dropper = [前のコンテナへ入れる, 落とす]。
4. dropper の「前のコンテナへ入れる」は、コンテナ無し → 続ける失敗 (落とすへ)、入らない → 止める失敗 (落とさない)。26.3 と同じ結果になる。
5. dispenser は列が空でもスロットを書き直す。
6. エンティティの無い回路で 26.3 と違うのは、dropper の空打ちの GameEvent と、火打石と打ち金の失敗の 2 点。ほかに音と、sulfur_cube へ食べさせる段の位置 (TNT はルールの判定より前、発光石・くり抜いたカボチャにも入る) が違う。

---

## 7. Rust で実装するときの要点

### 7.1 状態の持ち方

- blockstate は dispenser・dropper が (facing 6, triggered)、crafter が (front, top, triggered, crafting)。オブザーバーが見るので、全プロパティを状態に持つ。
- BlockEntity は位置をキーにした別の表に置く。9 スロット (アイテム ID・部品・個数・上限)、crafter は無効スロットの 9 bit・triggered・残り時間 (i8 で足りる)。
- 予約の重複排除 (位置, ブロック種) は 02 の共通部品に任せる。TRIGGERED と重複排除の 2 段で「立ち上がりの検出」になる。片方だけ真似ると、短い間隔のパルスで回数がずれる。
- neighborChanged の中の順は「予約 → TRIGGERED の書き込み」を守る。dispenser の予約の subTick を、書き込みの形状更新で積まれる予約 (オブザーバーなど) より前にするため。

### 7.2 乱数

- 世界の乱数を 1 本の LegacyRandomSource として持つ。48 bit の線形合同法、next(bits)・nextInt (2 の冪は掛け算と右シフト、それ以外はやり直しの輪)・nextDouble (26 bit と 27 bit) を Java と同じ式で書く。
- getRandomSlot は「空でないスロットごとに 1 回引く」を守る。引く回数がずれると、同じ tick の後ろの消費者 (ランダム tick など) の結果がずれる。
- 実機の種は再現できないので、スロット選びは差し替えられるようにする: (a) 種つきの Java 乱数、(b) 先頭の空でないスロット (今の TS と同じ)、(c) 台本 (選ぶスロットの列を与える)。fixture の比べ合わせは (c) か、「1 スロットだけ」の回路に限る。

### 7.3 振る舞いの表

- 26.4-pre-1 の「列を先頭から試す・成功 / 止める失敗 / 続ける失敗」の形で持つと、26.3 の振る舞いも同じ形で書ける (例: 26.3 の honeycomb は [蝋付け, 落とす]、shulker_box は [置く])。版ごとに表を差し替える。
- 各段は「中身の新しい値」「世界への書き込み (位置・状態・フラグ)」「出す GameEvent」「出すエンティティ」を返す。世界への書き込みは 04 の setBlock を通す (フラグ 11 と 3 を区別する)。
- 26.3 の癖を表に書き込む: 火打石と打ち金は何もできなくても成功、glass_bottle の失敗は落とす、頭は落とす、スポーンエッグが出せなければ残る。
- バケツは「壊してから置く」を 2 回の書き込み (destroyBlock のフラグ 3 → 流体のフラグ 11) として出す。1 回にまとめると、間に積まれる近隣更新と BLOCK_DESTROY が消える。置き換えの判定 (流体版の canBeReplaced・calculateSolid・LiquidBlockContainer) は 05・16 の表を引く。
- Optional 系の成否の旗は振る舞いごとの共有状態で、効くのは音だけ (§4.5)。音を出さない間は持たなくてよい。
- エンティティを持たない段階では、落とす・撃つ・出すは「出したエンティティの記録」に積むだけにする。中身の数の変化は必ず再現する (コンパレーターが読む)。落とすのに世界の乱数を 7 回引くことも、乱数を持つなら真似る (§4.3)。
- 振る舞いの後で、必ずスロットを書き直して自分の周りへコンパレーター更新を出す。

### 7.4 dropper の搬入

- 14 のコンテナの部品 (getContainerAt・addItem・各コンテナの canPlaceItem と面の規則・ホッパーのクールダウン) をそのまま呼ぶ。dropper 側は「1 個の複製を渡す」「入ったら 1 減らす」「入らなくても書き直す」だけを持つ。
- エンティティのコンテナは 17 の範囲。無い間は「ブロックのコンテナが無ければ落とす」でよい。

### 7.5 crafter

- レシピはデータ (ゲームのデータパックのレシピ) から読み込む部品にする。切り出した 3×3 の入力から 1 つ返す口だけを決め、未対応のレシピは「無し」として扱う。RecipeCache は結果を変えないので真似なくてよい。
- 秒読みは相 g の BlockEntity の tick に載せる (01 の順)。CRAFTING=偽 はフラグ 3。
- 設置の入口 (プレイヤー・アイテムで置く) と、構造物の読み込み (setPlacedBy を呼ばない) を分ける。
- クラフターは 14 のコンテナの一つとして受け先にもなる。canPlaceItem の均しの規則 (§4.16) と、無効スロットの 9 bit を 14 の搬入の部品から引けるようにする。レシピを持たない段階でも、材料を送り込む回路のコンパレーターはこれで合う。

### 7.6 他のメモとの境界

| 境界 | 持ち主 |
|---|---|
| 受電の判定 hasNeighborSignal | 05 |
| 予約の積み方・重複排除・優先度 | 02 |
| setBlock・近隣更新・形状更新・コンパレーター更新の配り方 | 04 |
| コンテナの部品・充填率・ホッパー | 14 |
| 流体・泡柱の後始末 | 16 |
| エンティティ (アイテム・投射物・トロッコ・TNT・装備) | 17 |
| GameEvent の受け手 | 10 |
| 乱数の共有と消費の順 | 18 |

---

## 8. 検証用のプローブ回路案

harness の items は既定で丸石を 0 番に入れる。種類を変えるときは仕様の配列で与える。非スタック品 (ハサミなど) を使うと、9 スロットのコンテナで 1 個 = 2、2 個 = 4 とコンパレーターで数を読み分けられる。

### P1 発火の遅延と 0 tick パルス

- 目的: 予約 tick の時点で受電を見ないことを確かめる。
- 配置: dropper A (ハサミ 2 本) → 前に空の dropper B → B を読むコンパレーター。A の隣へ、同じ tick に redstone_block を置いて消す (inputs を同じ tick に 2 つ)。
- 観測: A の triggered と、B のコンパレーター。
- 期待: triggered は t の中で立って落ちるので、t の終わりの記録には残らない。それでも t+4 に B へ 1 本入り、t+6 にコンパレーターが 2。

### P2 重複排除

- 目的: 4 tick の間の 2 回目の立ち上がりが失われることを確かめる。
- 配置: P1 と同じ。t2 に置く、t3 に消す、t4 に置く。
- 観測: B のコンパレーター (t6〜t12)。
- 期待: t8 に 2 になり、その後 4 にならない。4 になれば 2 回目が生きている。

### P3 準接続と BUD・置いただけの dispenser

- 目的: 1 つ上の受電は近隣更新の時点でしか見ないこと、置いただけでは起動しないことを確かめる。
- 配置: 既存の crafter-trigger の z=6 の組。加えて、レッドストーンブロックの隣へ dispenser (triggered=false) を setblock で置く組。ダストなど、置いた形状更新に反応して更新を返す物は隣に置かない。
- 期待: setblock だけでは triggered=false のまま。隣へ石を置いた tick に triggered=true、4 tick 後に発火。

### P4 スロットの選び方 (統計)

- 目的: スロットごとに等確率であることを確かめる。
- 配置: dropper A の 0 番にハサミ 1 本、1 番に丸石 64 個 → 前に空の dropper B → B のコンパレーター。1 回だけ発火させ、これを 100 回やり直す。
- 期待: B が 2 (ハサミ) と 1 (丸石) がおよそ半々。個数に比例しない。

### P5 失敗すると残る・落とす

- 目的: 振る舞いごとに中身が減るかを確かめる。
- 配置: dispenser をいくつか並べ、前は空気。中身はそれぞれ 1 個だけ入れる: ハサミ・骨粉・シュルカーボックス (前の位置を石でふさぐ)・発光石・丸石。各 dispenser をコンパレーターで読む。64 個のスタックでは 1 減ってもコンパレーターが同じ値のまま (64 個も 63 個も 2) なので、1 個にして 1 → 0 を見る。
- 期待: ハサミ (2)・骨粉 (1)・ふさがれたシュルカーボックス (2) は変わらない。発光石と丸石は 1 → 0 になる。

### P6 シュルカーボックスの向き

- 目的: 置いたシュルカーボックスの FACING の規則を確かめる。
- 配置: 東向きの dispenser 2 台。片方は前の位置の真下を空気、もう片方は石にする。
- 期待: 前者は facing=east、後者は facing=up で置かれる。

### P7 水バケツと水源・泡柱

- 目的: 水源への水バケツは更新を出さず、泡柱へは置き換えが起きることを確かめる。
- 配置: (a) 前が水源、その水源を見るオブザーバー。(b) 前が泡柱の途中、その泡柱を見るオブザーバー。
- 期待: (a) オブザーバーは動かない。バケツは空になる。(b) 泡柱が water に変わり、のちに泡柱へ戻る。オブザーバーは変化のたびに動く。戻る tick は 16 と合わせる。

### P8 crafter の CRAFTING の時間

- 目的: §4.15 の表を確かめる。
- 配置: 0 番に原木 1 個の crafter (板材のレシピ)。前は空のバレル。crafter を見るオブザーバー。隣に BUD 状態のピストン。
- 期待: レバーの tick を t とすると、t+4 に crafting=true (オブザーバーは t+6 に powered)、t+9 に crafting=false (オブザーバーは t+11)。ピストンは t+9 の近隣更新で起き、t+10 に moving_piston (相 g で積まれたイベントは次の tick の相 e)。t+4 では起きない。

### P9 crafter のコンパレーターと無効スロット

- 目的: 「空でない または 無効」の数を読むことを確かめる。
- 配置: 5 つのスロットに 1 個ずつ入れた crafter、別に空で 3 スロットを無効 (disabled_slots) にした crafter。それぞれをコンパレーターで読む。
- 期待: 5 と 3。充填率の式なら両方 1 以下になるので区別できる (既存の crafter-trigger は 1 スロットなので区別にならない)。

### P10 空打ちの GameEvent

- 目的: dispenser だけが空打ちで振動を出すことと、26.4-pre-1 で dropper も出すことを確かめる。
- 配置: 空の dispenser と空の dropper を別々に、8 マス以内のスカルクセンサーと組む。
- 期待: 26.3 は dispenser の組だけセンサーが動く。26.4-pre-1 は両方動く。

### P11 火打石と打ち金の耐久 (26.3)

- 目的: 何もできないときに耐久が減るかを確かめる。
- 配置: 前が石の dispenser に火打石と打ち金 1 個。コンパレーターで読む。8 tick ごとに 70 回撃つ。
- 期待: 26.3 は途中で壊れてコンパレーターが 0 になる。1.21.1 は 0 にならない。

### P12 水バケツの前の部品 (壊す・水浸し・失敗)

- 目的: §4.7 の置き換えの判定と、壊す書き込みと水の書き込みが 2 回に分かれることを確かめる。
- 配置: 水バケツ 1 個入りの dispenser を 4 台並べ、前にそれぞれ (a) ダスト (b) リピーター (c) レール (d) 石の感圧板を置く。流れた水が混ざらないよう、レーンの間は石で仕切る。(a) のダストの位置を見るオブザーバーを置く。各 dispenser をコンパレーターで読む。
- 観測: 前のブロック、dispenser のコンパレーター (水バケツ 1 個 = 2、空バケツ 1 個 = 1)、(a) のオブザーバー。
- 期待: (a)(b) は発火の tick に部品が消えて水源になる。コンパレーターは 2 → 1。(a) のオブザーバーは 2 回の書き込みのどちらでも形状更新を受けるが、予約の重複排除で 1 回だけ光る (発火の 2 tick 後)。(c) はレールが waterlogged=true になり、コンパレーターは 2 → 1。(d) は感圧板のまま、バケツを落としてコンパレーターは 2 → 0。

### P13 満杯の空バケツで汲む

- 目的: 汲んだバケツの入れ先が無いとき、1 減らして落とすことを確かめる (§9.4 の TS との差)。
- 配置: 全 9 スロットに空バケツ 16 個ずつの dispenser。前は水源。dispenser をコンパレーターで読む。
- 期待: 発火で水源が空気になり、コンパレーターは 15 → 14 (143 個)。中身に水バケツは入らない。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/10_component-scope.md §6 (C6・C6')

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| C6' で「ドロッパーの前方が非コンテナなら 1 個消費して何も出さない」 | 1 個をアイテムとして落とす。中身が 1 減るのは同じ | 中身の数は正しい。落としたアイテムを持たないのは境界の方針どおり |
| C6' で「ディスペンサーの射出は非実装」 | — | 古い。今の TS はバケツを持つ |
| 判断ポイント 2 の「ドロッパー/ディスペンサーは QC 源 + BEC としてだけ扱い」 | dispenser は準接続の**受け手**であって源ではない。発火はブロックイベントではなく予約 tick (4・NORMAL) | 用語の誤り。「準接続の受け手 + 予約 tick の部品」が正しい |
| C6 の充填率の式 | 14 | このメモの範囲外 |

### 9.2 docs/research/16_nucleation-comparison.md §2.6 (と §2.7)

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| ディスペンサーの特殊な挙動: Nucleation はシュルカーボックス・防具立て・バケツ、redstone-sim はバケツだけ | §4.6 の 20 種ほど | 正しい。加えて redstone-sim は「失敗すると残る」振る舞いの物も 1 個消す (§9.4) |
| クラフターの読み: 一部 | 空でないスロット + 無効スロットの数 | 正しい。redstone-sim は数を手で与え、中身から数えない |
| §2.7 ディスペンサーのバケツ: 同等 | 泡柱への水バケツで泡柱を置き換える。水源への水バケツは更新を出さない | 同等ではない (§9.4) |
| §2.7 乱数: redstone-sim は先頭の非空スロットで決定化 | 世界の乱数で、空でないスロットから等確率 | 方針の差。1 スロットなら一致 |
| §2.4 の表: flag 2 の書き込みはディスペンサーでも redstone-sim では見える | 形状更新が出る | 正しい |

### 9.3 docs/research/02_behavior-spec.md (§6 の hopper / dropper / container)

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| ディスペンサーは射出/設置がエンティティ・ワールド作用のため非実装 | — | 古い (16 §3.5 も指摘) |
| 前方が満杯コンテナは no-op | 中身は変わらないが、スロットを書き直すのでコンパレーター更新が出る | 中身は正しい。更新の有無が違う |
| QC を持つのは PistonBaseBlock・DispenserBlock・DropperBlock の 3 クラス | DropperBlock は neighborChanged を持たず継承するだけ | 数え方の差。挙動は同じ |
| ドロッパーの発火は 4gt の tile tick | 4・NORMAL | 正しい |

### 9.4 今の TS 実装 (packages/sim/src・packages/sim/test)

| 項目 | TS の今 | 26.3 | 影響 |
|---|---|---|---|
| スロットの選び方 | 先頭の空でないスロット (container.ts の takeOne) | 世界の乱数で等確率 | 1 スロット・同じ種類なら同じ。複数種では出る物と充填率の推移が違う |
| ディスペンサーの振る舞い | water_bucket と bucket だけ。他は 1 個消して何も出さない | §4.6 | ハサミ・骨粉・ブラシ・ふさがれたシュルカーボックス・TNT (ルール偽)・くり抜いたカボチャ・ウィザースケルトンの頭・満充電アンカーへの発光石・出せなかった防具立ては 26.3 では残る。火打石と打ち金は耐久が減るだけで、壊れるまで数は減らない。TS は消すのでコンパレーターがずれる。シュルカーボックスは置かれない |
| 水バケツ → 水源 | 水源を書き直し、近隣更新と形状更新を出す (world.ts の dispenseBucket) | 書き込みは変化なしで更新を出さない | TS だけ隣のオブザーバーが動く |
| 水バケツ → 泡柱 | バケツを空にするだけ | 水源で上書き (フラグ 11)。後で泡柱に戻る | 泡柱の隣のオブザーバー・BUD の反応が違う [要実機] |
| 水バケツ → 空気・水・泡柱以外 | 失敗とし、1 個消して何も出さない | 固体でない物 (ダスト・トーチ・リピーター・コンパレーター・レバー・ボタン) は destroyBlock で壊して水源。水浸しにできる物 (レール・スラブ・階段・トラップドアなど) は WATERLOGGED=真。感圧板などの固体は失敗してバケツを落とす | ダストやトーチの前のディスペンサーで、26.3 だけ部品が壊れる。壊す・水浸しの前では、26.3 は水バケツ 1 個が空バケツ 1 個になる (コンパレーター 2 → 1)。TS は消すので 0 になる |
| 空バケツ → 水浸しのブロック・溶岩源・粉雪 | 汲めない (水源と泡柱だけ)。1 個消す | 汲める (§4.7)。WATERLOGGED=偽 はフラグ 3、溶岩と粉雪は空気をフラグ 11 | 26.3 はバケツが入れ替わるだけで数は減らない。1 個の空バケツなら上限が 16 → 1 になり、コンパレーターが 1 → 2 に上がる |
| 全スロットが満杯の空バケツのスタック | 汲んだのにディスペンサーを書き直さない (putOne が入れ先を見つけられず、何もしなかった扱い)。世界は汲んだまま | 1 減らし、汲んだバケツは入れ先が無いので落とす | 9 × 16 個から始めると、26.3 は 143 個になりコンパレーターが 15 → 14。TS は 15 のまま |
| 入れ替えたバケツのスロット | takeOne で空いたスロットも含め、putOne の規則 (同じアイテムの部分スタック → 先頭の空き) で入れ直す | 1 個のスタックなら同じスロットに残りものが入る。重ねたスタックなら insertItem (0 番から空か同じアイテム) | 位置だけ違う。充填率はアイテムごとの比で数えるので同じ。書き出す NBT のスロット番号がずれる |
| バケツの更新の順 | 形状更新 → 近隣更新 | 近隣更新 → 形状更新 (Level#setBlock) | 同じ tick・同じ遅延・同じ優先度の予約が並ぶと subTick の順が入れ替わりうる |
| neighborChanged の順 | TRIGGERED を書いてから予約 | 予約してから書く | 形状更新で積まれる予約はオブザーバーの 2 tick などで、dispenser の 4 tick と同じ時刻に並ばないので、ふつうは観測できない。Rust では 26.3 に合わせる |
| dropper → 満杯の相手 | 何もしない | スロットを書き直してコンパレーター更新 | ほぼ無害 |
| dropper の入る先 | putOne: 同じアイテムの部分スタックを先に探し、無ければ最初の空き | 0 番から順に「空」または「合流できる」最初のスロット | 空きが部分スタックより前にあると入る位置が違う。充填率は同じだが、後で取り出す順が変わる (→ 14) |
| 空打ち | 何もしない | dispenser は BLOCK_ACTIVATE | スカルクを持つまでは差が出ない (→ 10) |
| クラフター | レシピ無し。予約 tick で何もしない。occupiedSlots を手で与える | §4.14・§4.15 | 作る回路・CRAFTING の更新は再現できない。fixture-driver は harness の丸石 (レシピ無し) に合わせて 1 にしている |
| dropper・ホッパー → クラフター | クラフターはコンテナの種類に入らない (container.ts の isContainerType)。dropper は「前が非コンテナ」として 1 個消す | クラフターは Container。canPlaceItem の規則 (§4.16) で入り、コンパレーターの数が増える | クラフターへ材料を送る回路で、TS は dropper の中身が消え、クラフターの読みも変わらない |
| クラフターとピストン | 押されると壊れる (world.ts の isPushDestroy に crafter) | 押せない | 16 の R-9 と同じ。押す回路で差が出る |
| クラフターの書き出し | 前が上下のとき orientation に front + "_up" を書く (mcstate.ts の simToMc) | 上下のときは up_east などの 4 通りだけ | sim で新しく置いた縦向きのクラフターだけ、無い値を書き出す |
| dispenser.test.ts | 共通のレッドストーン側・dropper だけ入れる・空なら何も起きない・準接続 | 同じ | 正しい |
| crafter.test.ts | 準接続なし・4gt 後も何も起きない・占有スロット数を読む | 準接続なしは正しい。「何も起きない」はレシピが無いときだけ。読みは無効スロットも数える | テストの前提 (レシピ無し) の下では正しい |

判断: 起動・予約・準接続・dropper の搬入とクールダウンは TS が正しい。直す順の候補は (1) 失敗すると残る振る舞いを消さない、(2) 水源への水バケツで更新を出さない、(3) 泡柱への水バケツを置き換えにする、(4) クラフターを押せなくする、(5) 満杯のバケツのスタックで、汲んだら 1 減らす (落とす)、(6) 水バケツの前の固体でない部品を壊す、(7) putOne の入る先を 0 番から順にする、(8) クラフターをコンテナとして受けられるようにする。コードは本メモでは変えない。

---

## 10. 典拠一覧

- 26.3 DispenserBlock#neighborChanged — 自分と 1 つ上の hasNeighborSignal、予約 → TRIGGERED (フラグ 2)
- 26.3 DispenserBlock#tick・dispenseFrom — 空打ちの levelEvent 1001 と BLOCK_ACTIVATE、振る舞い → setItem
- 26.3 DispenserBlock#getDispenseMethod・getDefaultDispenseMethod — feature flag → 登録表 → EQUIPPABLE → sulfur_cube_swallowable → スポーンエッグ → 既定
- 26.3 DispenserBlock#getStateForPlacement・affectNeighborsAfterRemoval・getDispensePosition・getAnalogOutputSignal・TRIGGER_DURATION
- 26.3 DropperBlock#getDispenseMethod・dispenseFrom — 搬入か落とす。空打ちは levelEvent だけ
- 26.3 DispenserBlockEntity#getRandomSlot・insertItem、DropperBlockEntity
- 26.3 CrafterBlock#neighborChanged・tick・dispenseFrom・dispenseItem・getPotentialResults・getStateForPlacement・setPlacedBy・newBlockEntity・getTicker・getAnalogOutputSignal・MAX_CRAFTING_TICKS・CRAFTING_TICK_DELAY・RECIPE_CACHE
- 26.3 CrafterBlockEntity#serverTick・setCraftingTicksRemaining・getRedstoneSignal・canPlaceItem・smallerStackExist・setItem・setSlotState・isSlotDisabled・slotCanBeDisabled・loadAdditional・saveAdditional
- 26.3 ServerGamePacketListenerImpl#handleContainerSlotStateChanged — 無効スロットの切り替え
- 26.3 DispenseItemBehavior#bootStrap・NOOP
- 26.3 DefaultDispenseItemBehavior#dispense・execute・spawnItem・consumeWithRemainder、OptionalDispenseItemBehavior#playSound
- 26.3 ProjectileDispenseBehavior#execute・playSound、ProjectileItem.DispenseConfig、ExperienceBottleItem・ThrowablePotionItem・FireworkRocketItem・FireChargeItem・WindChargeItem・ArrowItem の createDispenseConfig と asProjectile、Projectile#spawnProjectileUsingShoot・shoot・getMovementToShoot
- 26.3 EquipmentDispenseItemBehavior#dispenseEquipment、LivingEntity#canEquipWithDispenser
- 26.3 ShulkerBoxDispenseBehavior#execute、DirectionalPlaceContext、BlockItem#place・placeBlock・canPlace、ShulkerBoxBlock#getStateForPlacement
- 26.3 ShearsDispenseItemBehavior#execute・tryShearBeehive・tryShearEntity、BeehiveBlock#releaseBeesAndResetHoneyLevel・resetHoneyLevel
- 26.3 FlintAndSteelDispenseItemBehavior#execute・tryIgniteExplosiveEntities、BaseFireBlock#canBePlacedAt、TntBlock#prime
- 26.3 MinecartDispenseItemBehavior#execute、BoatDispenseItemBehavior#execute、SpawnEggItemBehavior#execute、SulfurCubeBlockDispenseItemBehavior#execute・dispenseBlock
- 26.3 BucketItem#emptyContents、SolidBucketItem#emptyContents、LiquidBlock#pickupBlock、SimpleWaterloggedBlock#pickupBlock・placeLiquid、BubbleColumnBlock#pickupBlock、PowderSnowBlock#pickupBlock
- 26.3 BoneMealItem#growCrop・growWaterPlant、RespawnAnchorBlock#charge、PrimedTnt (初速と fuse)
- 26.3 HopperBlockEntity#getContainerAt・getBlockContainer・getEntityContainer・addItem・tryMoveInItem・canPlaceItemInContainer・canMergeItems・getSlots・isOnCustomCooldown
- 26.3 BaseContainerBlockEntity#setItem、RandomizableContainerBlockEntity#setItem・getItem、BlockEntity#setChanged・preRemoveSideEffects、Containers#updateNeighboursAfterDestroy
- 26.3 Level#setBlock・updateNeighbourForOutputSignal・getRandom、LevelChunk#setBlockState、LevelWriter#setBlockAndUpdate
- 26.3 SignalGetter#hasNeighborSignal
- 26.3 ScheduledTickAccess#scheduleTick・LevelAccessor#createTick・ScheduledTick (既定は NORMAL)・LevelChunkTicks#schedule (重複排除)
- 26.3 ServerLevel#tickBlock — 予約 tick に世界の乱数を渡す
- 26.3 RandomSource#create・triangle、BitRandomSource#nextInt・nextDouble、LegacyRandomSource
- 26.3 RecipeCache#get、CraftingContainer#asCraftInput、Container#getMaxStackSize
- 26.3 LevelChunk の BoundTickingBlockEntity#tick — BlockEntity の tick に今の state を渡す
- 26.3 PistonBaseBlock#isPushable、Blocks の DISPENSER・DROPPER・CRAFTER の登録
- 26.3 VibrationSystem の周波数の表 (BLOCK_ACTIVATE 10 など。受け手は 10)
- 26.3 LevelChunk#setBlockState — preRemoveSideEffects → removeBlockEntity → affectNeighborsAfterRemoval (フラグ 1 かピストンのときだけ) の順
- 26.3 Level#destroyBlock (落とし物 → フラグ 3・深さ 512 → BLOCK_DESTROY)・Level#removeBlock (フラグ 3)、LevelWriter#destroyBlock (深さ 512 の既定)
- 26.3 BlockBehaviour#canBeReplaced (流体版。replaceable か固体でない)・BlockStateBase#calculateSolid (0.7291666666666666 と高さ 1)、Blocks の感圧板の forceSolidOn、BaseRailBlock (水浸し)
- 26.3 SeagrassBlock・TallSeagrassBlock・KelpBlock の canPlaceLiquid・placeLiquid (どちらも何もしない)
- 26.3 Armadillo#brushOffScute (ENTITY_INTERACT)、Entity#shearOffAllLeashConnections・dropAllLeashConnections (SHEAR)、SulfurCube#canExplode・primeTime (ルールを見るのは primeTime だけ)・equipItem
- 26.3 ItemEntity の生成 (向きと仮の初速はエンティティ自身の乱数)、EntityType#spawn (GameEvent を出さない)
- 26.3 CompoundContainer#setItem・setChanged、Container#canTakeItem・canPlaceItem の既定
- 26.3 BlockTags#CONVERTIBLE_TO_MUD (26.2 の CONVERTABLE_TO_MUD から改名)
- 版差: 1.21.1・26.2・26.4-pre-1 の同名クラスを diff -u。1.21.1 は DispenseItemBehavior の内側の匿名クラス (火打石と打ち金・頭・スポーンエッグ・TNT)・LevelChunk#setBlockState の onRemove・Containers#dropContentsOnDestroy・ProjectileDispenseBehavior を比べた。26.4-pre-1 は DispenseBehavior・DispenseBehaviors・DispenseBehaviorIds・InsertIntoContainerDispenseBehavior・DropItemDispenseBehavior・IgniteDispenseBehavior・ChargeRespawnAnchorDispenseBehavior・SpawnTNTDispenseBehavior・PlaceBlockDispenseBehavior・EmptyBucketDispenseBehavior ほかを読んだ
