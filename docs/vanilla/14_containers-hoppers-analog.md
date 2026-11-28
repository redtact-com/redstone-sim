# 14. コンテナ・ホッパー・コンパレーターが読むアナログ値

Java 版 26.3 のデコンパイルを読んで書いた、実装用のメモ。写経ではなく、条件・順序・数値を自分の言葉でまとめる (docs/ip-policy.md)。

確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] tools/mc-harness/fixtures/ の fixture が裏づける (記録した期待値は packages/sim/test/fixtures/ の同名ファイル)
- [要実機] 読んだだけでは決めきれない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

略語は 04 に合わせる。NC は近隣更新、SU は形状更新、CU はコンパレーター更新 (Level#updateNeighbourForOutputSignal) である。相の名前 (L6・L12・L13) は 01 に合わせる。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| HopperBlock | blockstate・設置・ENABLED の更新・撤去・アナログ出力・entityInside |
| HopperBlockEntity・Hopper | 転送の本体 (待ち・押し出し・吸い込み・面・アイテムエンティティ)・保存 |
| AbstractContainerMenu・Mth | コンテナの信号の式 (getRedstoneSignalFromContainer・lerpDiscrete) |
| Container・BaseContainerBlockEntity・RandomizableContainerBlockEntity・ListBackedContainer・ContainerSingleItem・SimpleContainer・ContainerHelper | スタック上限・どの書き込みが CU を出すか・保存形式 |
| BlockEntity・Containers | setChanged (CU の入口)・preRemoveSideEffects・updateNeighboursAfterDestroy |
| Level・LevelChunk・ServerLevel | CU が出る条件 (確かめる範囲。中身は 04) |
| ChestBlock・ChestBlockEntity・TrappedChestBlock・DoubleBlockCombiner・CompoundContainer | 二重チェストの結合・塞がれ判定・スロット順 |
| CopperChestBlock・WeatheringCopperChestBlock・ChangeOverTimeBlock・BlockEntityTypes | 銅のチェストの結合と酸化 |
| BarrelBlock・BarrelBlockEntity・ContainerOpenersCounter | 樽の OPEN |
| ShulkerBoxBlock(+BE)・AbstractFurnaceBlock(+BE)・BrewingStandBlock(+BE) | 面ごとのスロット・CU の契機 |
| ComposterBlock (内部の InputContainer・OutputContainer・EmptyContainer)・ContextIntProviders | 段階とホッパーとの受け渡し |
| ChiseledBookShelfBlock(+BE)・ShelfBlock(+BE)・SelectableSlotContainer・DecoratedPotBlock(+BE) | 値の式・スロットの位置 |
| JukeboxBlock(+BE)・JukeboxSongs・LecternBlock(+BE)・CopperGolemStatueBlock・CreakingHeartBlock(+BE) | 値の式と CU の契機 |
| AbstractCauldronBlock・LayeredCauldronBlock・LavaCauldronBlock・CakeBlock・CandleCakeBlock・EndPortalFrameBlock・EnderEyeItem・RespawnAnchorBlock・BeehiveBlock(+BE)・CommandBlock | 値の式と CU の契機 |
| CrafterBlock・DispenserBlock・SculkSensorBlock・DetectorRailBlock・CopperBulbBlock・ItemFrame | 値の式だけ (中身は担当メモ) |
| ComparatorBlock#getInputSignal | アナログ出力へ渡す向き (確かめる範囲。中身は 07) |

hasAnalogOutputSignal を真にするクラスは 25 個と AbstractCauldronBlock (子は CauldronBlock・LayeredCauldronBlock・LavaCauldronBlock) である (grep と hooks-26.3.tsv で確認)。
子クラス (TrappedChestBlock・CopperChestBlock・WeatheringCopperChestBlock・DropperBlock・FurnaceBlock・SmokerBlock・BlastFurnaceBlock・CauldronBlock・CalibratedSculkSensorBlock・WeatheringCopperBulbBlock・WeatheringCopperGolemStatueBlock) で外すものは無い。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| L12・L13 の位置と BlockEntity の ticker の並び | → 01_tick-loop.md |
| コンポスター 20 gt・書見台 2 gt・開閉の見直し 5 gt の予約 | → 02_scheduled-ticks.md |
| チェストの蓋・シュルカーボックスの開閉イベント | → 03_block-events.md |
| setBlock のフラグ・NC/SU/CU の配り方 | → 04_set-block-and-updates.md |
| 樽・チェスト・シュルカーボックスが導体か | → 05_signals-and-block-properties.md |
| コンパレーターが背面・導体越し・額縁を読む規則と予約 | → 07_diodes.md |
| トラップチェスト・書見台・ジュークボックスの出す信号 | → 09_manual-inputs.md |
| スカルクセンサー | → 10_sculk.md |
| 銅の電球 | → 11_outputs.md |
| ディスペンサー・ドロッパー・クラフター (挿入と発射) | → 12_dispenser-dropper-crafter.md |
| BlockEntity を持つブロックはピストンで動かない | → 13_pistons.md |
| ディテクターレール | → 15_rails.md |
| アイテムエンティティの移動・トロッコ (ホッパー付き・チェスト付き)・額縁・銅のゴーレム | → 17_entities-interplay.md |
| エンティティの列挙順・乱数 | → 18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 アナログ値は「源・知らせ・読み手」の 3 段

1. 源が値を持つ。blockstate の値 (コンポスターの LEVEL など) か、BlockEntity の中身 (チェストのスロットなど) である。
2. 値を変える処理が、自分で CU を出す (§2.4)。
3. 受けたコンパレーターは、その場で値を読み直す。保持値と違えば 2 gt の予約を積む (→ 07)。

**コンパレーターは値を見回らない**。CU か NC が来ない限り、古い値を出し続ける。
源ごとに「どこで CU を出すか」を正しく写すことが、この分野の実装の要点である。

### 2.2 ホッパーの 1 回 (L13)

[26.3 読解: HopperBlockEntity#pushItemsTick・#tryMoveItems]

1. 待ち (cooldownTime) を 1 減らす。tickedGameTime に今の gameTime を書く。
2. 待ちが 1 以上なら終わる。
3. 待ちを 0 に書き直し、転送を試みる (4〜8)。
4. 今の blockstate の enabled が偽なら終わる。
5. 自分が空でなければ押し出す (§4.3)。
6. 自分が満杯 (5 スロットとも、その物の上限まで詰まっている) でなければ吸い込む (§4.4)。押し出しが成功しても試す。
7. どちらかが成功したら、待ちを 8 にし、自分の位置から CU を出す。
8. どちらも失敗なら待ちは 0 のまま。次の tick にまた試す。

### 2.3 ホッパーが動く入口は 2 つ (相は 3 通り)

| 入口 | 相 | 吸い込むもの | 押し出し |
|---|---|---|---|
| HopperBlockEntity#pushItemsTick (ticker) | L13 | 上の容器。無ければ上のアイテムエンティティ | する |
| HopperBlock#entityInside → HopperBlockEntity#entityInside | L12 (アイテムの tick の終わりの applyEffectsFromBlocks。止まっているアイテムも毎 tick 当たる) | 触れたアイテムエンティティ 1 体だけ | する |
| 同上 (ピストンに押されたアイテム) | L13 (moving_piston の ticker の中。PistonMovingBlockEntity が押したエンティティに applyEffectsFromBlocks を呼ぶ) | 同上 | する |

どちらも tryMoveItems を通る。待ちと enabled の判定は同じである [26.3 読解: HopperBlockEntity#tryMoveItems・Entity#applyEffectsFromBlocks・PistonMovingBlockEntity#moveEntityByPiston]。
entityInside の入口は tickedGameTime を書かず、待ちも減らさない。L12 の中での押し出しは k の判定がずれる (§5.10)。

### 2.4 CU が出る 5 つの経路

| 経路 | 条件 | 出す位置 | 典拠 |
|---|---|---|---|
| BlockEntity#setChanged | BlockEntity が覚えている状態が空気でない。プレイヤーがアイテムで BE を持つブロックを置いた時も、書き込みの後に 1 回呼ばれる (→ 04 §4.13 の手順 9) | その位置 | 26.3 BlockEntity#setChanged・BlockItem#updateBlockEntityComponents |
| Level#setBlock のフラグ 1 | **新しい**状態がアナログ出力を持つ | 書いた位置 | 26.3 Level#setBlock |
| 撤去フック (affectNeighborsAfterRemoval) | 種類が変わり、フラグ 1 かピストンの移動。Containers#updateNeighboursAfterDestroy などを呼ぶブロックだけ (§4.14) | 消えた位置 | 26.3 LevelChunk#setBlockState・Containers |
| コマンドの後処理 | strict でない /setblock・/fill・/clone。種類が変われば撤去フックも呼び、新しい状態がアナログ出力を持てば CU | 書いた位置 | 26.3 ServerLevel#updateNeighboursOnBlockSet (→ 04 §4.11) |
| 個別の呼び出し | コマンドブロック・ディテクターレール・銅のゴーレムの像 (撤去フックの中)・きしむ心臓・エンダーアイ・額縁・ハチの巣 (プレイヤーが壊したとき) | 各位置 | §4.10 |

CU の届け先 (北・東・南・西の順。直接か導体 1 個越しの comparator) は → 04 §4.8。

### 2.5 L13 のどこで動くか

[26.3 読解: HopperBlock#getTicker・LevelChunk#setBlockState・Level#tickBlockEntities]

1. ticker はサーバー側だけに付く (クライアントでは null)。ホッパー専用の列は無く、L13 の 1 本の ticker の列に、ほかの BlockEntity (moving_piston・日照センサー・かまどなど) と追加順で混ざる (→ 01 §4.7)。
2. 列の順は BlockEntity を足した順である。ホッパーの状態が変わっても (enabled・facing) 順は動かない。壊して置き直すと最後尾に付く (→ 01)。
3. ticker に渡る blockstate は、その瞬間のチャンクの状態である。だから同じ L13 の中で前の ticker が書いた enabled が、後のホッパーにすぐ効く。
4. チャンクが ticking でないとき、L13 自体が止まっているとき (emptyTime が 300 以上) は動かない (→ 01)。

---

## 3. 状態とデータ

### 3.1 ホッパー

| blockstate | 値域 | 既定 | 意味 |
|---|---|---|---|
| facing | down・north・south・west・east (up は無い) | down | 押し出し先 |
| enabled | true・false | true | 6 方向のどこからも受電していないなら true |

設置時の facing はクリックした面の逆である。上下の面なら down になる [26.3 読解: HopperBlock#getStateForPlacement]。

| BlockEntity の値 | 保存キー | 初期値 | 意味 |
|---|---|---|---|
| スロット 5 個 | Items (Slot つきの一覧。空のスロットは書かない) | 空 | 中身 |
| cooldownTime | TransferCooldown (int) | -1。キーが無いときも -1 | 転送の待ち |
| tickedGameTime | 保存しない | 0 | 最後に L13 で tick した gameTime |
| facing | 保存しない | blockstate から | blockstate の写し。BlockEntity#setBlockState で更新する |
| ルートテーブル | LootTable・LootTableSeed | 無し | 中身に初めて触れたときに生成する (乱数 → 18) |

| 定数 | 値 |
|---|---|
| MOVE_ITEM_SPEED (成功後の待ち) | 8 |
| HOPPER_CONTAINER_SIZE | 5 |
| 待ち無しの値 | -1 |
| 「カスタムの待ち」 | 8 を超える値 (HopperBlockEntity#isOnCustomCooldown) |
| 吸い込みの箱 Hopper の SUCK_AABB | ホッパーの位置から x 0〜1・y 11/16〜2・z 0〜1 |
| 上を塞がない例外のタグ | does_not_block_hoppers = #beehives (bee_nest・beehive) |

### 3.2 コンテナの大きさと面

| ブロック | スロット | 上限 | ホッパーから見た面ごとのスロット |
|---|---|---|---|
| hopper | 5 | 99 | 面の区別なし |
| chest・trapped_chest・銅のチェスト 8 種 | 27 (二重で 54) | 99 | 面の区別なし |
| barrel・シュルカーボックス 17 種 | 27 | 99 | シュルカーは全面 0〜26。シュルカーボックスは入らない |
| dispenser・dropper・crafter | 9 | 99 | 面の区別なし (crafter の入る条件は → 12) |
| furnace・smoker・blast_furnace | 3 (0 材料・1 燃料・2 完成品) | 99 | 上 [0]・下 [2, 1]・横 [1] |
| brewing_stand | 5 (0〜2 瓶・3 材料・4 燃料) | 99 | 上 [3]・下 [0, 1, 2, 3]・横 [0, 1, 2, 4] |
| decorated_pot | 1 | 99 | 面の区別なし |
| chiseled_bookshelf | 6 | 1 | 面の区別なし (本の類だけ・空きスロットだけ) |
| 木の棚 (*_shelf) | 3 | 99 | 面の区別なし |
| jukebox | 1 | 1 | 面の区別なし (円盤だけ・空のときだけ) |
| composter | 仮の 1 (§4.13) | 1 | 上 [0] (段が 7 未満)・下 [0] (段が 8) |

上限は Container の既定が 99。スロットの分母は「コンテナの上限とアイテムの上限の小さい方」である [26.3 読解: Container#getMaxStackSize]。
ender_chest・campfire・lectern は Container ではないので、ホッパーは触れない。

面の付帯条件 [26.3 読解: AbstractFurnaceBlockEntity・BrewingStandBlockEntity・ShulkerBoxBlockEntity]:

- かまどの燃料スロットに入るのは、燃料の部品を持つ物と bucket である。bucket は燃料スロットに bucket が無いときだけ入る。完成品スロットには何も入らない。
- かまどの下から燃料スロットを抜けるのは furnace_fuel_bottom_takeable (water_bucket・bucket) だけ。
- 醸造台の瓶スロット (0〜2) に入るのは、ポーションの入力になる物で、そのスロットが空のときだけ。材料スロット (3) に入るのは醸造の材料 (BREWING_REAGENTS) だけ。燃料スロット (4) に入るのは醸造燃料の部品を持つ物だけ。
- 醸造台の材料スロットを抜けるのは glass_bottle だけ。燃料スロットは下の面の表に無いので、下のホッパーは抜けない。下から抜く順は瓶 0・1・2 → 材料である。
- canPlaceItemThroughFace は面を見ず canPlaceItem を呼ぶだけ (かまど・醸造台)。面の違いはスロット表だけで決まる。

### 3.3 チェスト類の blockstate

| プロパティ | 値域 | 意味 |
|---|---|---|
| facing | 水平 4 方向 | 正面の向き |
| type | single・left・right | 二重のどちら側か |
| waterlogged | true・false | 水浸し |

二重の相手の向き: left は facing を時計回りに 90°、right は反時計回りに 90° [26.3 読解: ChestBlock#getConnectedDirection]。
right の半分は、正面を背にして立ったときの右手側である (facing が north なら東の半分)。正面から見ると左側になる。

---

## 4. 処理の詳細

### 4.1 コンテナの信号の式

[26.3 読解: AbstractContainerMenu#getRedstoneSignalFromContainer・Mth#lerpDiscrete]

1. 容器が無ければ 0。
2. 合計を 32 bit の float の 0 で始める。
3. スロット 0 から順に、空でないスロットについて「個数 ÷ そのスロットの分母 (§3.2)」を float で足す。
4. 合計を スロット数 で割る (float)。これを f とする。
5. 信号 = 「f × 14 の切り捨て」+「f が 0 より大きければ 1」。

getRedstoneSignalFromBlockEntity は、BlockEntity が Container ならこの式、そうでなければ 0 を返す。
チェストだけは BlockEntity ではなく結合した容器 (§4.11) を渡す。

64 個スタックのアイテムを詰めたとき、各信号になる最小の個数:

| 容器 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| かまど (3) | 1 | 14 | 28 | 42 | 55 | 69 | 83 | 96 | 110 | 124 | 138 | 151 | 165 | 179 | 192 |
| ホッパー (5) | 1 | 23 | 46 | 69 | 92 | 115 | 138 | 160 | 183 | 206 | 229 | 252 | 275 | 298 | 320 |
| ドロッパー (9) | 1 | 42 | 83 | 124 | 165 | 206 | 247 | 288 | 330 | 371 | 412 | 453 | 494 | 535 | 576 |
| チェスト (27) | 1 | 124 | 247 | 371 | 494 | 618 | 741 | 864 | 988 | 1111 | 1235 | 1358 | 1482 | 1605 | 1728 |
| 二重チェスト (54) | 1 | 247 | 494 | 741 | 988 | 1235 | 1482 | 1728 | 1975 | 2222 | 2469 | 2716 | 2963 | 3210 | 3456 |

(式を float で計算して求めた。スタック不可の 1 個はスロット 1 つ分を満たす。醸造台の瓶もこれに当たる。1 本で 3、2 本で 6、3 本で 9。)

[実機 1.21.1: hopper-mixed-stacks] が、スタック上限ごとに強度が割れることを裏づける。

float の注意: 上限が 1・16・64 だけなら、f × 14 がちょうど整数になるのは f が 0.5 か 1 のときだけで、丸めの影響は出ない。
上限を部品で 1〜99 の任意値にしたアイテムでは、倍精度で計算すると境界で 1 ずれる (例: かまど 3 スロット・上限 7 の物 15 個は、float で 10、倍精度で 11)。

### 4.2 待ち (cooldown) の規則

[26.3 読解: HopperBlockEntity#pushItemsTick・#tryMoveInItem]

1. 自分が転送に成功した tick に待ちは 8 になる。以後 L13 ごとに 1 減り、0 になった tick に再び動く。**同じホッパーの転送間隔は 8 gt** である。
2. 空だったホッパーへ 1 個入ると、受け手の待ちを「8 − k」にする。条件は、受け手がホッパーで、受け手の待ちが 8 以下であること。
3. k は、送り手がホッパーで、受け手の tickedGameTime が送り手の tickedGameTime 以上 (受け手がこの tick にもう L13 を済ませた) なら 1、それ以外は 0。
4. k が 0 なら、受け手はこの tick の自分の L13 で 1 減る。k が 1 なら、もう減らないので 7 から始まる。**どちらでも受け取りの 7 gt 後に動く**。
5. 送り手がドロッパー・クラフター・アイテムエンティティのときは k が 0 である。ドロッパーは L6 で動くので、受け手は同じ tick の L13 で 1 減る。やはり 7 gt 後に動く (→ 12)。
6. 吸い込みで自分が受け手になった場合も 2 が走るが、成功したので §2.2 の手順 7 で待ちは 8 に上書きされる。
7. 「空だった」は受け手の容器全体が空だったかで、スロットごとではない。待ちが 8 を超えている受け手 (カスタムの待ち) は書き換えない。
8. 例外: 送り手が L12 の entityInside の経路で押し出すと、どちらの tickedGameTime も前の tick の値なので k が 1 になりやすい。受け手は 6 gt 後に動く (§5.10) [要実機]。

[実機 1.21.1: hopper-clock] が 1 (送り手の 8 gt) を、[実機 1.21.1: hopper-2clock] が 4 (1 段 7 gt、往復 14 gt) を裏づける。
packages/sim/test/hopper.test.ts の縦チェーンの系列 (#91。1.21.1 を rcon で採取) も、L13 の並び (設置順) とこの規則で説明できる。

### 4.3 押し出し (HopperBlockEntity#ejectItems)

1. facing の先の容器を探す (§4.6)。無ければ失敗。
2. 相手の面は「facing の逆」(相手のうちホッパーに接する面)。
3. その面のスロットが全部「個数がそのアイテムの上限以上」なら、相手は満杯として失敗。
4. 自分のスロットを 0 から順に見る。空でないスロットごとに:
   1. 1 個だけ抜き取る (このとき自分の CU は出ない。ホッパーの removeItem は setChanged を呼ばない)。
   2. 相手へ入れる (§4.5)。入れば相手の setChanged をもう 1 度呼び、成功で終わる。
   3. 入らなければ個数を元に戻し、次のスロットへ進む (CU は出ない)。
5. 全スロットで入らなければ失敗。

### 4.4 吸い込み (HopperBlockEntity#suckInItems)

1. 真上の位置の容器を探す (§4.6)。
2. 容器があるとき:
   1. 相手の「下の面」のスロット表を順に見る (WorldlyContainer でなければ全スロットを番号順)。
   2. 空でなく、取り出し可 (相手の canTakeItem と、WorldlyContainer なら面の可否) のスロットから 1 個抜き取る。
   3. 自分へ入れる (§4.5。面の指定なし)。入れば相手の setChanged を呼び、成功で終わる。
   4. 入らなければ相手の個数を元に戻し (元が 1 個なら setItem で戻す)、次のスロットへ進む。
   5. 全部だめなら失敗。**アイテムエンティティは拾わない**。
3. 容器が無いとき:
   1. 真上のブロックの当たり判定がフルブロックで、does_not_block_hoppers でなければ塞がれている。失敗。
   2. 塞がれていなければ、吸い込みの箱と交わるアイテムエンティティを列挙し (§4.7)、順に丸ごと入れてみる。1 体が丸ごと入ったら成功で終わる。

### 4.5 1 個を入れる (HopperBlockEntity#addItem・#tryMoveInItem)

1. 相手が WorldlyContainer で面の指定があれば、その面のスロット表の順に試す。なければスロット 0 から順に試す。
2. スロットごとに:
   1. 相手の canPlaceItem と、WorldlyContainer なら面の可否を見る。だめなら次へ。
   2. スロットが空なら、そこに置く。
   3. 空でなく、同じアイテム・同じ部品で、そのスタックの個数が上限以下なら、上限 (入れる側のアイテムの上限) までの空きに足す。1 個以上入れば成功。
   4. 成功したとき、§4.2 の 2 を見てから、相手の setChanged を呼ぶ。
3. 入れる物が尽きた所で止まる。

**スロットは番号順に 1 つずつ「空か、足せるか」を見る**。空きスロットより後ろに同じ物の山があっても、先の空きに置く。

### 4.6 容器の見つけ方 (HopperBlockEntity#getContainerAt)

1. ブロックが WorldlyContainerHolder (コンポスター) なら、その容器を作って返す。
2. blockstate が BlockEntity を持ち、その BlockEntity が Container なら返す。チェストなら、塞がれを無視して結合した容器 (§4.11) に差し替える。
3. どちらでもなければ、その位置の中心を中心とする 1×1×1 の箱と交わる、生きている「Container であるエンティティ」(チェスト付きトロッコなど) を探す。候補が 1 体でも level の乱数の nextInt を 1 回引いて選ぶ。候補が 0 なら引かない (→ 17・18)。
4. 吸い込みの相手は「真上のマス」を同じ手順で探す。エンティティを探す箱の中心は、ホッパーの中心の 1 上である。

容器が見つかった時点で、その容器が空でも、取り出せる物が無くても、アイテムエンティティは見ない (§4.4)。

### 4.7 アイテムエンティティ

[26.3 読解: Hopper・HopperBlockEntity#getItemsAtAndAbove・#addItem・#entityInside]

| 項目 | 内容 |
|---|---|
| 範囲 | ホッパーの位置から x 0〜1・y 11/16〜2・z 0〜1 の箱と、境界を含まず交わる生きたアイテムエンティティ |
| 条件 | 上に容器が無く、上がフルブロックで塞がれていない (§4.4) |
| 拾い方 | エンティティのスタックを丸ごと入れてみる。全部入ればエンティティを消して成功 |
| 一部だけ入った | 残りをエンティティに戻し、**失敗扱い**で次のエンティティへ進む。入った分は残る |
| 拾う遅延 | 見ない (ドロップ直後でも拾う) |
| L12 の経路 | アイテムの tick の終わりの applyEffectsFromBlocks で、エンティティの箱がホッパーのマスと重なれば entityInside が呼ばれる。止まっているアイテムも毎 tick 呼ばれる。空でないアイテムで、その箱 (ホッパー基準) が吸い込みの箱と交われば tryMoveItems。先に押し出しも走る |

L12 の経路で成功すると、待ち 8 のまま同じ tick の L13 で 7 に減る。次の転送は 7 gt 後になる [26.3 読解]。
ピストンに押されたアイテムの経路 (L13) では、moving_piston の ticker がホッパーより先に並んでいれば同じ L13 で 7 に減り、後なら減らずに 8 のまま残る (→ 01・13)。
ロック中は entityInside も何もしないので、鉢の中のアイテムは残る。解除が L12 より前の相 (L6 の予約 tick など) で起きると、同じ tick の L12 で拾う。
上の例外タグがあるので、ハチの巣を切って巣の位置に出たハニカムも、下のホッパーが拾える。
一部だけ入った場合は待ちが付かないので、毎 tick 拾い続けうる。

### 4.8 ロック (enabled)

[26.3 読解: HopperBlock#onPlace・#neighborChanged・#checkPoweredState]

1. 新しく置かれたときと NC を受けたときに、6 方向の受電 (hasNeighborSignal。→ 05) を読む。
2. 「受電していない」と enabled が食い違えば、enabled を書き換える。フラグ 2 で書くので NC も CU も出ない。SU は出る (オブザーバーが見る)。
3. 形状更新では見直さない。

ロック中も待ちは毎 tick 減り、0 で止まる。解除された直後の L13 で、待ちが 0 なら動く。
ロック中に空の状態で物を受け取ると、§4.2 の 2 で待ちが 8 − k になる。解除の時点で残っている分だけ待つ。
ロックが止めるのは自分の転送だけである。上のホッパーからは入るし、下のホッパーには吸われる。L12 の経路も止まる。
[実機 1.21.1: hopper-lock] が enabled の切り替わりを裏づける。

### 4.9 1 回の転送で出る CU の順

容器ごとに、自分の setItem・removeItem が CU を出すかが違う [26.3 読解: BaseContainerBlockEntity#setItem・#removeItem・HopperBlockEntity#setItem・#removeItem・AbstractFurnaceBlockEntity#setItem・ContainerSingleItem・JukeboxBlockEntity#setTheItem・ChiseledBookShelfBlockEntity#setItem・#removeItem・ListBackedContainer・ShelfBlockEntity#setChanged・CompoundContainer]:

| 容器 | setItem | removeItem (1 個以上抜けたとき) |
|---|---|---|
| チェスト類・樽・シュルカーボックス・ディスペンサー・ドロッパー・クラフター・醸造台 | 出す | 出す |
| かまど 3 種 | 材料スロット (0) に別の物 (同じ物・同じ部品でない物) を置いたときだけ出す | 出す |
| ホッパー | 出さない | 出さない |
| 飾り壺 | 出さない (setTheItem は中身を置き換えるだけ) | 出さない |
| ジュークボックス | 円盤を入れると再生の開始の知らせで NC と CU | 再生中の円盤を抜くと停止の知らせで NC と CU。止まった円盤を抜くときは出ない |
| 本棚 | 状態を書く (フラグ 3。NC と CU) | 同左 |
| 棚 | 出す (BLOCK_ACTIVATE の振動つき。§5.11) | 同左 |
| 二重チェスト | 書いた半分の位置からだけ | 同左 |

BlockEntity の容器の setChanged は CU を出す (BlockEntity#setChanged)。二重チェストの setChanged は右 → 左の 2 か所から出す。
コンポスターの仮容器の setChanged は段の書き込みで、書いたときだけ NC と CU が出る (§4.13)。トロッコなどエンティティの容器の setChanged は何もしない (AbstractMinecartContainer#setChanged。→ 17)。

送り手 H が L13 で押し出し (相手 D) と吸い込み (源 S) を両方成功させたとき [26.3 読解: HopperBlockEntity#ejectItems・#tryTakeInItemFromSlot・#tryMoveInItem・#tryMoveItems]:

| 段 | D の setItem が出す種類 | D の setItem が出さない種類 (ホッパー・飾り壺など) |
|---|---|---|
| 押し出し | 空きスロットに置けば setItem で CU(D) → 入れ終わりの setChanged で CU(D) → ejectItems の最後の setChanged で CU(D) | 入れ終わりで CU(D) → 最後に CU(D) |

| 段 | S の removeItem が出す種類 | S の removeItem が出さない種類 (ホッパー・飾り壺) |
|---|---|---|
| 吸い込み | S の removeItem で CU(S) → H へ入れ終わりで CU(H) → 最後に CU(S) | H へ入れ終わりで CU(H) → 最後に CU(S) |
| 仕上げ | CU(H) | CU(H) |

D が二重チェストなら、空きに置いたとき CU は「書いた半分 → 右 → 左 → 右 → 左」の 5 回、山に足したとき 4 回になる。ドロッパーからの挿入は最後の setChanged が無いので 3 回と 2 回である (→ 12)。

コンパレーターは最初に値の変化を見た CU で予約を積む。予約の順は「D → S → H」(S の removeItem が CU を出す種類) か「D → H → S」(S がホッパー) になる。
同じ遅延・同じ優先度なら、この順に発火する (→ 02)。
押し出しだけで H の値が変わっても、H の CU は吸い込みの段か仕上げまで出ない。押し出しと吸い込みで H の値が元に戻れば、H の読み手は予約しない。

**取り出しの失敗でも CU は出る**。S の removeItem が CU を出す種類で、H がその物を受け取れないとき (5 スロットとも別の物で埋まり、満杯ではない) も、試したスロットごとに S の removeItem が CU を出す。
その瞬間の S は 1 個少ない。元が 1 個なら戻すときの setItem でもう 1 回出る。元が 2 個以上なら個数を直接戻すので CU は出ない。待ちが付かないので、これが毎 tick 起きる。
読み手のコンパレーターは 1 個少ない値を見て予約を積みうる。2 gt 後には戻った値を読むので出力は変わらないが、比較モードなら前方更新を出す (→ 07)。
押し出しの失敗は CU を出さない。ホッパーの removeItem も、戻すときの setItem も出さないからである。

### 4.10 アナログ源の全表

値の式は [26.3 読解: 各クラス#getAnalogOutputSignal]。「知らせ」は値が変わったときに CU を出す経路。「撤去」は撤去フックで CU を出すか。

| ブロック | 値 | 値域 | 知らせ | 撤去 | 担当 |
|---|---|---|---|---|---|
| hopper | §4.1 の式 (5) | 0〜15 | §4.9。プレイヤーの操作は setChanged | 出す | 14 |
| chest・trapped_chest・銅のチェスト | §4.1 の式 (結合した 27 か 54)。塞がれていれば 0 | 0〜15 | setItem・removeItem・二重なら両半分の setChanged | 出す | 14 (信号は 09) |
| barrel・シュルカーボックス | §4.1 の式 (27) | 0〜15 | setItem・removeItem。樽は OPEN の書き換え (フラグ 3) でも NC と CU | 出す | 14 |
| furnace・smoker・blast_furnace | §4.1 の式 (3) | 0〜15 | 燃料を使った・焼き上がった・LIT が変わった tick に setChanged。材料スロットへ別の物を置いた | 出す | 14 |
| brewing_stand | §4.1 の式 (5) | 0〜15 | 燃料値を補充した tick・醸造の開始と**醸造中の毎 tick** に setChanged | 出す | 14 |
| decorated_pot | §4.1 の式 (1) | 0〜15 | プレイヤーの投入 (DecoratedPotBlock#useItemOn) で setChanged。setItem・removeItem は出さないので、ホッパーとの受け渡しではホッパー側が呼ぶ setChanged だけが知らせになる | 出す | 14 |
| dispenser・dropper | §4.1 の式 (9) | 0〜15 | → 12 | 出す | 12 |
| crafter | 「空でないか使用禁止」のスロットの数 | 0〜9 | → 12 | 出す | 12 |
| chiseled_bookshelf | 最後に触れたスロット + 1 (未操作は 0)。正面から見て上段左から 1・2・3、下段 4・5・6 | 0〜6 | 本の出し入れで状態を書く (フラグ 3)。空になっても最後に触れたスロットの値が残る | 出す | 14 |
| 木の棚 (*_shelf) | 正面から見て左のスロット 1・中 2・右 4 の和。**背面から読んだときだけ**。他の向きは 0 | 0〜7 | プレイヤーの入れ替えと setItem・removeItem で setChanged (BLOCK_ACTIVATE などの振動つき) | 出す (+ 給電の解除) | 14 |
| jukebox | 円盤ごとの値 (下表)。空は 0。再生が終わっても円盤が入っていれば値は残る | 0〜15 | 円盤の出し入れ・再生の終了で NC と setChanged | 出す (円盤が入っていれば、その前に preRemoveSideEffects の中で NC と CU) | 09 |
| lectern | has_book が偽なら 0。真なら「進み × 14 の切り捨て」+「本の中身があれば 1」。進みはページ数が 2 以上なら 現在ページ ÷ (ページ数 − 1)、それ以外は 1 | 0〜15 | ページ送り・本の設置で setChanged と状態の書き込み | 出さない | 09 |
| composter | LEVEL | 0〜8 | 段が変わるたびに状態を書く (フラグ 3) | 出さない | 14 |
| cauldron (空) | 0 (アナログ出力は持つ。導体越しに読んでも 0 で置き換える) | 0 | 種類が変わる書き込み (どれも setBlockAndUpdate。フラグ 3) | 出さない | 14 |
| water_cauldron・powder_snow_cauldron | LEVEL | 1〜3 | 水位の増減と種類の書き換え (どれもフラグ 3。雨・雪・鍾乳石・瓶・バケツ・燃えたエンティティ) | 出さない | 14 |
| lava_cauldron | 3 | 3 | 種類の書き換え (フラグ 3) | 出さない | 14 |
| cake | (7 − BITES) × 2 | 14・12・10・8・6・4・2 | 一口ごとに状態を書く。最後の一口は撤去 (CU なし) | 出さない | 14 |
| candle_cake 17 種 | 14 | 14 | 設置 | 出さない | 14 |
| end_portal_frame | has_eye なら 15、それ以外 0 | 0・15 | エンダーアイがフラグ 2 で書いて CU を直接出す (NC は出ない) | 出さない | 14 |
| respawn_anchor | CHARGE ÷ 4 × 15 の切り捨て | 0・3・7・11・15 | 充填と消費で状態を書く (フラグ 3) | 出さない | 14 |
| beehive・bee_nest | HONEY_LEVEL | 0〜5 | 蜜の増減で状態を書く (フラグ 3)。蜜を運んだハチが入ると 1 段、1/100 で 2 段 (5 を超えない。乱数 → 18) | 撤去フックは無い。プレイヤーが silk_touch (タグ prevents_bee_spawns_when_mining) の無い道具で壊したときだけ、BeehiveBlock#playerDestroy が直接出す (中にハチがいなくても) | 14 |
| command_block 3 種 | 成功回数 | 0 以上 (15 を超えうる) | 予約 tick の最後に必ず CU (SEQUENCE の型でも)。チェーンは実行に成功したときだけ CU し、失敗で列を止める。条件つきで条件を満たさないチェーンは成功回数を 0 にするが CU を出さない。チェーンの CU は起点の CU より先に出る | 出さない | 14 |
| copper_golem_statue 8 種 | POSE の順番 + 1 (standing 1・sitting 2・running 3・star 4) | 1〜4 | ポーズ替えで状態を書く (フラグ 3) | 出す (自前) | 14 |
| creaking_heart | 根が抜けていれば 0。守り手がいれば 15 −「距離を 0〜32 に収めて ÷ 32 × 15 の切り捨て」、いなければ 0 | 0〜15 | BlockEntity の毎 tick に計算し、変わったら CU | 出す | 14 |
| sculk_sensor・calibrated_sculk_sensor | ACTIVE 中は最後の振動の周波数、それ以外 0 | 0〜15 | → 10 | 出さない | 10 |
| detector_rail | 点灯中、コマンドブロック付きトロッコの成功回数、無ければ中身を持つトロッコの式、それ以外 0 | 0 以上 (コマンドブロック付きは 15 を超えうる) | 判定のたびに CU | 出さない | 15 |
| copper_bulb 8 種 | lit なら 15、それ以外 0 | 0・15 | → 11 | 出さない | 11 |
| item_frame・glow_item_frame (エンティティ) | 物があれば 回転 % 8 + 1、無ければ 0 | 0〜8 | → 17 | → 17 | 17 |

ジュークボックスの円盤の値 [26.3 読解: JukeboxSongs]:

| 値 | 円盤 |
|---|---|
| 1〜15 | 13・cat・blocks・chirp・far・mall・mellohi・stal・strad・ward・11・wait・pigstep・otherside・5 の順に 1〜15 |
| 14・13・12・11 | relic・precipice・creator・creator_music_box |
| 10・9・8 | tears・lava_chicken・bounce |

細部:

- アナログ出力の向き引数を使うのは棚だけである。コンパレーターが渡すのは「源からコンパレーターへの向き」で、棚は「facing の逆」と一致するときだけ値を返す。導体越しでも同じ向きが渡る [26.3 読解: ComparatorBlock#getInputSignal・ShelfBlock#getAnalogOutputSignal]。
- 本棚と棚は、クライアント側では 0 を返す。エンジンはサーバー側の値だけを写せばよい。
- 本棚の値は「最後に触れたスロット」なので、入れても抜いても同じスロットなら同じ値である。
- 書見台の本の中身の判定は、書きかけの本か署名済みの本の部品を持つか。白紙の本と羽ペン (ページ 0) は 15 になる。has_book だけが真で中身の無い書見台は 14 になる。
- 銅の電球は、渡された状態ではなく世界の今の状態の lit を読む。
- コマンドブロックの 15 を超える値の扱いは読み手次第である (ダストは 15 に丸めて読む。→ 05・07)。

### 4.11 二重チェスト

[26.3 読解: ChestBlock#combine・#getContainer・#isChestBlockedAt・DoubleBlockCombiner#combineWithNeigbour・CompoundContainer]

結合した容器を作る手順:

1. この位置にチェストの BlockEntity が無ければ「無し」。
2. 塞がれ判定を使う場合、この位置が塞がれていれば「無し」。
3. type が single なら、この半分だけ (27)。
4. 相手の位置 (§3.3) が**同じブロック**で、type が single でなく自分と逆、facing が同じなら:
   1. 塞がれ判定を使う場合、相手が塞がれていれば「無し」。
   2. 相手に BlockEntity があれば、type=right の半分を前、type=left の半分を後ろにした容器 (54)。
5. 条件が合わなければ、この半分だけ (27)。

| 項目 | 内容 |
|---|---|
| スロット順 | 0〜26 が type=right の半分、27〜53 が type=left の半分。ホッパーは right の半分から埋め、どちらの下からでも right の半分から抜く |
| 塞がれ | 真上が導体 (isRedstoneConductor) か、真上の 1 マスの箱に座った猫がいる |
| コンパレーター | 塞がれ判定を**使う**。どちらかの半分が塞がれていれば両方 0 |
| ホッパー | 塞がれ判定を**使わない**。塞がれていても出し入れする |
| setChanged | 結合した容器の setChanged は right の半分、left の半分の順に呼ぶ。CU は両方の位置から出る |
| 結合の更新 | 隣にチェストが置かれた・消えたときの type の書き換えは SU の結果なので、NC も CU も出ない |
| 別種 | chest と trapped_chest は組まない。BlockEntity の種類も違う |

塞がれの判定は真上の導体を見るので、ガラス・ハーフブロック・階段では塞がれない。

### 4.12 銅のチェスト

[26.3 読解: CopperChestBlock・WeatheringCopperChestBlock#randomTick・ChangeOverTimeBlock#changeOverTime・BlockEntityTypes]

| 項目 | 内容 |
|---|---|
| 種類 | copper_chest・exposed・weathered・oxidized と、それぞれの waxed の 8 種。タグ copper_chests |
| BlockEntity | 普通のチェストと同じ chest 型 |
| 組む相手 | 形を決めるとき (設置・SU) は copper_chests のタグを持つチェスト同士 (酸化の段も蝋も問わない)。ただし容器として結合するのは同じブロック同士だけ (§4.11 の手順 4) |
| 設置 | 組むとき、置いた側を 2 つのうち酸化の浅い方のブロックにする (同じ段なら置いた側のまま)。蝋の有無が違えば、両方を蝋なしの版に直してから選ぶので、置いた側は蝋なしになる。相手は SU で置いた側と同じブロックに変わる (次の行) |
| 相手の追従 | 二重の相手が別の銅のチェストに変わると、SU で自分も相手と同じブロックに変わる。SU の書き込みなのでフラグ 1 が無く、NC・CU・撤去フックは出ない (→ 04 §5.3) |
| 酸化 | ランダム tick を受けるのは次の段がある 3 種 (蝋なしの copper・exposed・weathered) だけ。type=right の半分と、誰か (プレイヤーや銅のゴーレム) が開けている間は進まない。確率 0.05688889 の抽選、マンハッタン距離 4 の同種のブロックとの比較 (若いものがあれば止まる) のあと、フラグ 3 で書く |
| 中身 | 銅のチェスト同士の置き換えでは BlockEntity を保つ |
| アナログ値 | 普通のチェストと同じ |

酸化した半分の書き込みは、撤去フック (CU) → NC → CU → SU の順に走る。SU で相手が追いつく前は、2 つの半分が別のブロックなので結合しない (§5.6)。

### 4.13 コンポスター

[26.3 読解: ComposterBlock#getContainer・#addLayer・#tick・#onPlace・内部の 3 つの容器]

ホッパーが触れるたびに、段に応じた**仮の容器**を新しく作る。

| 段 | 容器 | 上から入れる | 下から抜く |
|---|---|---|---|
| 0〜6 | 入れる容器 (1 スロット・上限 1) | compostable の部品を持つ物。1 個入るとその場で段を足す処理を走らせ、物は消える | できない |
| 7 | 空の容器 (0 スロット) | できない (満杯扱い) | できない |
| 8 | 出す容器 (骨粉 1 個) | できない | 骨粉。抜くと段を 0 にする |

段を足す処理: 空 (0) のときは必ず 1 段。それ以外は物ごとの確率 30・50・65・85・100 % で 1 段。7 になったら 20 gt の予約 tick で 8 にする。どれもフラグ 3 で書くので、段が変わるたびに NC と CU が出る。確率に外れても物は消える。

容器があるとみなすので、コンポスターの下のホッパーは、段によらずアイテムエンティティを拾わない。
入れる容器のスロット表は上の面だけ、出す容器は下の面だけにある。横からコンポスターへ向いたホッパーは、面のスロット表が空なので「満杯」とみなされ、何もしない (CU も出ない)。
入れる容器は「1 回入れた」の印を持つので、1 回の挿入で段を足すのは 1 回だけである。入れた物は setItem の中の setChanged で段を足す処理に回り、そこで容器から消える。続く setChanged 2 回は空の容器を見るだけで何もしない。

### 4.14 撤去と設置

[26.3 読解: LevelChunk#setBlockState・Level#setBlock・Containers#updateNeighboursAfterDestroy・ServerLevel#updateNeighboursOnBlockSet・SetBlockCommand#setBlock]

1. ブロックの種類が変わり、古い状態が BlockEntity を持ち、新しい状態が「BlockEntity を保つ」と言わないとき (銅のチェスト同士は保つ。§4.12)、BlockEntity#preRemoveSideEffects を呼ぶ。コンテナ類は中身を落とす (シュルカーボックスは落とさない。ジュークボックスは円盤を出して NC と CU。書見台は本を落とす)。フラグ 256 (副作用なし) があれば呼ばない。そのあと BlockEntity を外す。
2. 種類が変わり、フラグ 1 かピストンの移動 (フラグ 64) なら、撤去フック (affectNeighborsAfterRemoval) を呼ぶ。コンテナ類はここで CU を出す。新しい状態はもう置かれているので、読み手は新しいブロックの値 (空気なら 0) を読む。
3. Level#setBlock がフラグ 1 で NC を出し、**新しい状態が**アナログ出力を持てば CU を出す。
4. strict でない /setblock は、フラグ 2 + 256 で置いてから ServerLevel#updateNeighboursOnBlockSet を呼ぶ。中身は落とさないが、種類が変われば撤去フックを呼び、NC を出し、新しい状態がアナログ出力を持てば CU を出す。読み手から見える知らせは手順 2・3 と同じである (→ 04 §4.11)。

撤去フックで CU を出さないアナログ源 (§4.10 の「出さない」) が消えると、隣接するコンパレーターには NC だけが届く。**導体越しに読んでいるコンパレーターには何も届かない** [26.3 読解] [要実機]。

---

## 5. 端の場合と落とし穴

### 5.1 「8 gt ごと」は送り手の話

受け手は受け取りの 7 gt 後に動く (§4.2)。2 個のホッパーで往復させると 1 周 14 gt である。16 gt ではない。

### 5.2 押し出しと吸い込みはスロットを順に試す

1 番目のスロットの物が入らなくても、2 番目以降の物を試す。吸い込みも同じで、源の 1 番目が入らなければ 2 番目を試す。
入れる側は「空か、足せるか」を番号順に見る。空きの後ろに同じ物があっても、空きに置く。

### 5.3 塞がれたチェストは 0

真上が導体か、猫が座っていると、コンパレーターは 0 を読む。ホッパーは平気で出し入れする。
塞いだ・どけた・猫が座ったことは CU を出さない。読み手は次の更新まで古い値のままである [要実機]。

### 5.4 二重チェストの結合・解除は読み手に知らせない

1 個のチェストの隣に 2 個目を置くと、2 個目の位置からは CU が出る。1 個目の type の書き換えは SU の結果なので CU が出ない。
1 個目だけを読むコンパレーター (2 個目の CU の届く範囲の外) は、27 スロットの値のまま残る [要実機]。
片方を壊したときも、残った半分を読むコンパレーターに届くのは、壊れた位置からの CU と NC だけである。

### 5.5 撤去で CU を出さない源

ケーキの最後の一口・コンポスター・大釜・リスポーンアンカー・書見台などが消えると、導体越しのコンパレーターは古い値を出し続ける (§4.14) [要実機]。
ピストンで押せるもの (コンポスターなど) が動くときも、元の位置で CU は出ない。着地の書き込み (フラグ 67 = 1 + 2 + 64。早めに着地する finalTick の経路はフラグ 3) で、着地先から CU が出る [26.3 読解: PistonMovingBlockEntity#tick・#finalTick] (→ 13)。

### 5.6 銅のチェストの酸化の瞬間

酸化した半分の CU と NC は、相手がまだ古いブロックのうちに走る。その瞬間の読み手は 27 スロットぶんの値を見て予約を積みうる。
2 gt 後の再計算では結合が戻っているので出力は変わらないが、比較モードなら前方更新を出す [26.3 読解] [要実機]。

### 5.7 コンポスターの骨粉が消える

段 8 のコンポスターの下のホッパーが骨粉を受け取れない (5 スロットとも別の物、満杯ではない) と、抜き取りの時点で段は 0 になり、骨粉は戻らない。
出す容器には取り出し前の確認が無いからである。本棚とジュークボックスは、受け手に空きがあるかを先に確かめるので消えない [26.3 読解] [要実機]。

### 5.8 樽を開けると NC が出る

樽の OPEN はフラグ 3 で書くので、6 方向に NC、周りのコンパレーターに CU が出る。チェストの開閉はブロックイベントだけで NC を出さない (トラップチェストは別。→ 09)。

### 5.9 その他

- ロック中のホッパーも容器である。上から入り、下から吸われる。
- 醸造中の醸造台は毎 tick CU を出す。値は変わらないので予約は積まれないが、更新の数は多い。
- チェストの中身は、ホッパーのどの半分からの操作でも結合した容器として扱う。
- 同じスロットの書き換えでも、ホッパーの setItem と removeItem は CU を出さない。チェスト類は出す (§4.9)。
- ルートテーブル付きの容器は、ホッパーが中身を見た時点で中身を作る。乱数を使う (→ 18)。
- エンダーチェストはアナログ出力を持たない。コンパレーターは通常の信号を読む。
- 銅のチェスト・樽・シュルカーボックスなど「導体かどうか」は種類で違う (→ 05)。チェストが真上を塞ぐ判定は導体で見るので、上にチェストを重ねても塞がれない。

### 5.10 L12 の押し出しは k が 1 になりやすい

[26.3 読解: HopperBlockEntity#entityInside・#tryMoveInItem] [要実機]

1. entityInside の経路は tickedGameTime を書かない。L12 の時点では、送り手 S も受け手 R も前の tick の L13 で書いた値 (前の tick の gameTime) を持つ。
2. S が L12 で R (空のホッパー) へ押し出すと、R の tickedGameTime は S の値以上なので k = 1、R の待ちは 7 になる。R が前の tick の L13 より後に置かれた (tickedGameTime が 0 のまま) なら k = 0 で、7 gt 後に戻る。
3. R は同じ tick の L13 で 1 減って 6 になる。R は受け取りの **6 gt 後**に動く (L13 の経路なら 7 gt 後)。
4. 起きる条件: S が L12 の時点で待ち 0・有効・空でなく、鉢の中か上にアイテムエンティティがある。例えば、L6 の予約 tick (リピーター・トーチ) で S のロックが外れた tick である。ロック中は L13 で押し出せず、アイテムも拾わないので、解除の tick の L12 が最初の転送になる。

### 5.11 棚は setChanged のたびに振動を出す

[26.3 読解: ShelfBlockEntity#setChanged] (→ 10)

1. 棚の BlockEntity の setChanged は、CU のほかに BLOCK_ACTIVATE のゲームイベントを出す (プレイヤーの入れ替えは ITEM_INTERACT_FINISH か ENTITY_INTERACT)。
2. ホッパーが棚の空きスロットへ 1 個入れると、setItem・入れ終わり・ejectItems の最後で setChanged が 3 回走る (山に足せば 2 回)。振動も同じ回数出る。棚から抜くときは removeItem と tryTakeInItemFromSlot の最後の 2 回である。
3. 近くのスカルクセンサーが反応しうる。ホッパーと棚の物流の横にスカルクセンサーがある回路では、この振動を写さないと合わない。
4. 本棚 (chiseled_bookshelf) は出し入れのたびに BLOCK_CHANGE のゲームイベントを出す。ジュークボックスは円盤の出し入れで BLOCK_CHANGE を出す。

---

## 6. 版差

担当クラスを 1.21.1・26.2・26.4-pre-1 と diff -u した。挙動に効く違いだけを書く。

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| ホッパーの転送 (HopperBlockEntity) | 同じ | 同じ | 基準 | 差分なし |
| TransferCooldown が無いときの読み込み | 0 | -1 | -1 | -1 |
| 吸い込みの箱 | 同じ箱 (書き方だけ違う) | 同じ | 同じ | 同じ |
| 信号の式・CU の届け先 | 同じ | 同じ | 同じ | 同じ |
| 撤去の CU | onRemove。BlockEntity が Container なら中身を落としてから CU | affectNeighborsAfterRemoval (フラグ 1 かピストンのときだけ) + preRemoveSideEffects | 同左 | 同左 |
| 撤去の CU が条件つきだった源 | 本棚は中身があるときだけ CU。ジュークボックスは再生中だけ (停止の知らせの中の setChanged) | どちらも撤去フックで必ず CU | 同左 | 同左 |
| 止まっているアイテムの entityInside | move を呼ぶ tick だけ (4 tick に 1 回)。move の中の checkInsideBlocks で呼ぶ | 毎 tick (移動のあとの applyEffectsFromBlocks) | 同左 | 同左 |
| アナログ出力の向き引数 | 無い | 有る (棚だけが使う) | 同左 | 同左 |
| きしむ心臓・棚・銅のチェスト・銅のゴーレムの像 | 無い | 有る | 同じ | 同じ |
| ジュークボックスの円盤 | 19 枚 (creator_music_box まで) | 22 枚 (tears・lava_chicken・bounce) | 22 枚 | 23 枚 (flurry 7)。プレイリスト (下) |
| コンポスターの確率 | 確率の表。空でなければ nextDouble を 1 回引く | 同左 | 部品 compostable の段数。空でなければ nextInt(100) の重み抽選。100 % の物は引かない | 同じ |
| コンポスターに入る物 | 表の 101 種 | 115 種 (1.21.1 より後の新しい物 14 種が加わる) | 122 種。既存の物の確率は同じで、26.3 で増えた物 (poplar の苗木と葉 3 色・red_shrub・shelf_mushroom・straw_bed) が加わる | 同じ |
| 醸造台の燃料と時間 | 燃料 20 回・400 gt 固定 | 同左 | 部品 brewing_fuel (既定は 20 回・速さ 1.0 で同じ) | 同じ |
| かまどの燃料 | 燃料の表 | 同左 | 部品 cooking_fuel (燃焼時間と速さの倍率) | 同じ |
| 書見台のページの範囲 | 0 ページの本で -1 になりうる | 同左 | 同左 | 0 に収める (出力は変わらない) |
| 水浸しの設置 | 水源のときだけ | 同左 | 同左 | 同左 (水の流体が 1 種類にまとまったので、判定の書き方が「水源か」に変わっただけ) |

[版差 1.21.1] 1.21.1 の撤去は状態が変わるたびに onRemove を呼び、コンテナの CU は「別のブロックになったときに BlockEntity が Container なら」出す。26.x はフラグ 1 が無い書き込み (ピストンの移動を除く) では撤去フックも CU も出ない (→ 04 §6.2)。差が出るのは、コンテナをフラグ 1 なしで別のブロックに置き換える経路だけである。26.x の銅のチェストの追従 (SU) はその経路だが、1.21.1 には銅のチェストが無い。/setblock は 1.21.1 では onRemove、26.x では updateNeighboursOnBlockSet で、どちらも CU を出す。ほかの経路は見ていない [要実機]。

[版差 1.21.1] 1.21.1 の本棚は、空なら撤去で CU を出さない。本棚の値は最後に触れたスロットなので、空でも 1〜6 を出していることがある。1.21.1 で空の本棚を壊すと、導体越しに読むコンパレーターは古い値のまま残る。26.x では CU が届く [1.21.1 ChiseledBookShelfBlock#onRemove・26.3 ChiseledBookShelfBlock#affectNeighborsAfterRemoval]。

[版差 1.21.1] 止まっているアイテムがホッパーの鉢の中にあるとき、1.21.1 では L12 の entityInside が 4 tick に 1 回しか走らない。残りの tick は L13 の吸い込みが拾う。拾った相で次の転送が 7 gt 後か 8 gt 後かが変わる (§4.7) [1.21.1 ItemEntity#tick・Entity#checkInsideBlocks] [要実機]。

[版差 26.3] コンポスターは、1.21.1・26.2 も 26.3 も「空なら乱数を引かずに 1 段」である。変わったのは空でないときの乱数の引き方だけである。1.21.1・26.2 は nextDouble を 1 回引いて確率未満なら 1 段 (確率 100 % の物も引く)。26.3 は重み (確率 : 100 − 確率) の nextInt(100) で、100 % の物は定数 1 で引かない。乱数の列がずれる (→ 18) [26.3 ContextIntProviders#compostable・ComposterBlock#addLayer・26.2 ComposterBlock#addItem]。

[版差 26.4-pre-1] ジュークボックスにプレイリストの仕組みが入った。真上に単独の chest・trapped_chest・銅のチェストがあると PLAYLIST_MODE が真になる。再生が終わったときと円盤が無いときに、上の容器の次の円盤と入れ替える (無ければ同じ円盤を再生し直す)。入れ替えで円盤の値が変わり、上の容器の中身も変わる。PLAYLIST_MODE は NC と SU で見直し、フラグ 2 で書く。中身は → 09・19。

既存 fixture の有効性: hopper-clock・hopper-2clock・hopper-lock・hopper-mixed-stacks・hopper-mixed-transfer・barrel-comparator-input は、ホッパーと信号の式が 1.21.1 と 26.3 で同じなので 26.3 でも有効と見てよい。撤去の CU に頼る fixture は無い。

---

## 7. Rust で実装するときの要点

### 7.1 状態の持ち方

| 物 | 持ち方 |
|---|---|
| アイテムの山 | アイテム ID (整数)・個数・上限・部品のハッシュ。上限は部品で 1〜99 になりうる |
| 容器 | スロットの配列。容器の上限 (既定 99) を持つ |
| ホッパーの BlockEntity | スロット 5・待ち (i32)・tickedGameTime (i64)・facing の写し |
| チェスト | 半分ごとに 27 スロット。**結合は持たない**。読むたびに §4.11 の手順で解く (結合も塞がれも知らせなしに変わるため) |
| アナログ源 | ブロックの種類ごとの関数「状態・BlockEntity・世界・位置・向き → i32」。15 を超えうるので i32 |

信号の式は f32 で、§4.1 と同じ順に計算する。上限が 2 の冪でない物を許すなら必須である。

### 7.2 CU を出す場所をフックで写す

- 「setItem・removeItem が setChanged を呼ぶか」は容器の種類で違う (§4.9 の表)。容器の trait に「書き込みのあとに何を出すか」を持たせる。ホッパーと飾り壺は出さない、チェスト類は出す、かまどの setItem は材料スロットの種類替えだけ、本棚は状態を書く、ジュークボックスは再生の開始と停止の知らせで NC と CU、棚は CU と振動を出す。
- setChanged そのものも trait にする。既定は CU だけ。二重チェストは右 → 左、棚は振動つき、コンポスターの仮容器は段の書き込みである。
- 取り出しの失敗でも、源が出す種類なら CU を出す。元に戻す処理も同じ規則で通す。
- CU は 04 の更新キューを通す (L13 の最上位では即時に走りきる)。

### 7.3 ホッパーの順序

- L13 の ticker の並び (01) を保つ。tickedGameTime は L13 で書く。
- L12 の entityInside 経路を、エンティティ側から呼べる入口として残す (17)。
- 押し出し・吸い込み・挿入のスロット探索は §4.3〜§4.5 の順で書く。最初に成功した所で止める。
- 受け手の待ちの「8 − k」は tickedGameTime の比較で決める。実効 7 gt という結果だけを写すと、カスタムの待ちの判定 (8 以下か) と、L12 の押し出しの 6 gt (§5.10) がずれる。
- entityInside の入口では tickedGameTime を書かず、待ちも減らさない。ticker (pushItemsTick) だけが両方を進める。

### 7.4 コンポスターと仮の容器

コンポスターの容器は、触れるたびに作る使い捨ての値にする。「もう 1 回入れた」の印は、その容器の中だけで持つ。

### 7.5 他のメモとの境界

| 呼ぶ相手 | 内容 |
|---|---|
| 04 | CU の配り方・setBlock のフラグ・撤去フックの条件 |
| 05 | hasNeighborSignal (ロック)・導体の判定 (塞がれ・CU の導体越し) |
| 07 | CU を受けたコンパレーターの判定と予約 |
| 12 | ドロッパーからホッパーへの挿入 (§4.5 を共有する) |
| 17 | アイテムエンティティの列挙順と移動・トロッコ・額縁 |
| 18 | エンティティ容器の抽選・ルートテーブル・コンポスターの乱数 |

---

## 8. 検証用のプローブ回路案

入力の位相 (ハーネスの tick 番号と L13 のずれ) は → 01 §2.4。期待は「何 gt 後か」で書く。
ハーネスの記録は tick の中の順を持たないので、順を見るときはピストンの押し合いに置き換える。

### P1. hopper-eject-slot-fallback (押し出しの次スロット)

- 目的: 1 番目のスロットが入らないとき 2 番目を試すか (§5.2)。
- 配置: ホッパー H (facing=east) の東にホッパー D。H = [石 1・雪玉 6]。D は 5 スロットとも別の物を 1 個ずつにし、うち 1 つを雪玉にする (石は入らず、雪玉は足せる)。D は facing=down で真下を石にし、H と D の上は空気にする (D は押し出す相手が無く、吸う物も無い)。H をコンパレーターで読む。H は北のレッドストーンブロックでロックして始め (D とは斜めなので D は受電しない)、t2 に撤去する。
- 期待: 26.3 の読みなら、解除後最初の L13 で雪玉が 1 個移る。H の値は 2 → 1 (f は 0.078 → 0.066) で、その 2 gt 後に出力が落ちる。1 番目だけを試す実装では何も起きない。

### P2. hopper-suck-slot-fallback (吸い込みの次スロット)

- 目的: 源の 1 番目が入らないとき 2 番目を吸うか。
- 配置: 樽 = [石 64・雪玉 15] の真下にホッパー (facing は石の方)。ホッパーは 5 スロットとも別の物を 1 個ずつにし、うち 1 つを雪玉にする。樽をコンパレーターで読む。ホッパーは横のレッドストーンブロックでロックして始め、t2 に撤去する。
- 期待: 雪玉が 1 個移り、樽の値が 2 → 1 になる。石を試して失敗したときの CU で、読み手は石 63 個の値 (1) を一瞬見る。最終の値も 1 なので、出力は 2 → 1 の 1 回だけ変わる。1 番目だけを試す実装では何も起きない。

### P3. hopper-insert-slot-order (挿入のスロット順)

- 目的: 空きスロットの後ろに同じ物の山があるとき、空きに置くか (§4.5)。
- 配置: H (石 1。facing=down) の真下に D (facing=east)、D の東に E (空。facing は石の方)。D = [空・鉄の斧 1・石 5] で、北のレバーでロックしておく。H は南のレッドストーンブロックでロックして始める (どちらも D・E とは斜め)。t2 に H のロックを外し、H が D へ石を入れたあと、t12 に D のレバーを切る。E をコンパレーターで読む。E を D の真下に置くと、ロック中の D から E が吸ってしまうので横に置く。
- 期待: 26.3 の読みでは D = [石 1・斧 1・石 5] になり、D が最初に出すのは石で E の値は 1。山に足す実装なら最初に斧が出て E の値は 3。

### P4. hopper-cu-order (同じ tick の CU の順)

- 目的: 源がホッパーのとき、受け手 H の読み手が源 S の読み手より先に予約を積むか (§4.9)。
- 配置: 縦に S (石 1。facing は石の方で押し出さない)・H (空)。S を読むコンパレーター C_S と、H を読む C_H。C_H は 0 → 1 で点き、C_S は 1 → 0 で消える。H は横のレッドストーンブロックでロックして始め、t2 に撤去する。両方の出力の変化をオブザーバーで拾い、2 台のピストンで 1 個のブロックを直交する 2 方向から押させる。後のピストンの前は moving_piston になるので、動くのは先のピストンの向きだけである。
- 観測: ブロックが動いた向き (先に起動したピストン)。
- 期待: 26.3 の読みでは C_H 側が先。S を樽に替えると C_S 側が先になる。

### P5. chest-blocked-stale (塞がれと知らせ)

- 目的: 塞がれたチェストが 0 を読ませるか。塞いだだけでは知らせないか (§5.3)。
- 配置: 石 1 個のチェストを読むコンパレーター → ダスト。t2 にチェストの上へ石を置く。t10 にコンパレーターの横へレバーを置いて NC を与える。対照に上へガラスを置くレーン。
- 期待: t2 では変わらず、t10 の 2 gt 後に 0 になる。ガラスのレーンは変わらない。

### P6. double-chest-link-stale (結合の知らせ)

- 目的: 2 個目を置いて二重になったとき、1 個目だけを読むコンパレーターが追従しないか (§5.4)。
- 配置: 満杯のチェスト A の正面にコンパレーター。A の横に空のチェスト B を置く (コンパレーターと B は斜めの位置)。
- 期待: 26.3 の読みでは 15 のまま残り、別の NC を与えると 8 に落ちる。

### P7. cake-through-conductor (撤去の CU)

- 目的: CU を出さない源の撤去 (§5.5)。
- 配置: bites=6 のケーキを直接読むレーンと、石越しに読むレーン。最後の一口を食べる。setblock で空気にするレーンと、setblock の strict で空気にするレーンも並べる (どれも直接と石越しの 2 本ずつ)。
- 期待: 食べたレーンは、直接が 0、石越しが 2 のまま。setblock (strict なし) も同じである (updateNeighboursOnBlockSet の NC だけで、空気はアナログ出力を持たない)。strict では何も届かないので、直接のレーンも 2 のまま。

### P8. hopper-entity-phase (L12 と L13 のどちらで拾うか)

- 目的: L12 の経路で拾うと次の転送が 7 gt 後、L13 で拾うと 8 gt 後になるか (§4.7)。
- 配置: 空のホッパー 2 台。片方は鉢の中 (ホッパーの底から 0.8) に、もう片方は上 (1.5) にアイテムを召喚する。各ホッパーの先に空のホッパーと、それを読むコンパレーター。
- 期待: 鉢の中のレーンは拾ってから 7 gt 後、上のレーンは 8 gt 後に最初の押し出しが起きる [要実機]。

### P9. shelf-back-only (棚の向き)

- 目的: 棚の値が背面からだけ読めるか。導体越しでも同じか (§4.10)。
- 配置: 3 スロットとも物を置いた棚を 2 つ。1 つ目は前・後・左・右の 4 方向にコンパレーター。2 つ目は背面に石を挟んでコンパレーター。
- 期待: 1 つ目は背面だけ 7、他は 0。2 つ目は 7。

### P10. hopper-l12-eject-k (L12 の押し出しの待ち)

- 目的: L12 の entityInside で押し出すと、受け手が 6 gt 後に動くか (§5.10)。
- 配置: 2 レーン。S (facing=east。石 1) → R (空。facing=east) → T (空。facing は石の方)。T をコンパレーターで読む。S はリピーター (遅延 1) で受電させてロックし、リピーターの入力のレバーを t2 に切る (S の解除は L6 で起きる)。レーン A だけ、S の鉢の中にアイテムを 1 個置いておく (ロック中は拾われない)。
- 期待: 26.3 の読みでは、レーン A は解除の tick の L12 で S が R へ押し出し、R は 6 gt 後に T へ押し出す。レーン B は L13 で押し出し、R は 7 gt 後に動く。T の読み手の点灯がレーン A で 1 gt 早い [要実機]。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §6 (hopper / dropper / container)

| 記述 | 26.3 の読み | 判断 |
|---|---|---|
| スタック種別・スロット配置は持たず、コンテナごとに 1 本の個数で表す / 容量 320・576・1728 | 今の TS はスロットを持つ (#194) | 02 が古い。中身の規則は §4.1・§4.5 が正 |
| 既知の抽象化: BE 順は座標順、受け手の -1 補正は一律 8 | 受け手は「8 − k」で、実効 7 gt (§4.2)。TS は #89・#91 で設置順と実効 7 gt に直した | 02 が古い (docs/research/15 §1.3・16 §3.5 でも指摘済み) |
| ロックは自分の能動転送のみを止め、下段が上段を吸うのは止めない | 一致 | 02 が正 |
| 内容が変わると CU で水平隣接 (北→東→南→西) へ | 一致。ただし 1 回の転送で複数回、順は §4.9 | 02 を補う |
| 1 回の転送で 1 個 / eject が先、続いて suck | 容器どうしは 1 個で一致。アイテムエンティティからは山を丸ごと入れる (§4.7)。順も一致 | 02 は容器どうしの話としては正しい |
| 転送の駆動は BlockEntity フェーズで毎 gt | L13 の ticker。ほかに L12 の entityInside と、ピストンに押されたアイテムの L13 の入口がある (§2.3) | 02 を補う (TS はアイテムエンティティを持たないので、L13 の ticker だけで足りる) |

### 9.2 docs/research/02 §6 comparator の「コンテナ充填率→強度の変換式」と docs/research/10 C6

式「f が 0 なら 0、それ以外は f × 14 の切り捨て + 1」は 26.3 と一致する。補うのは 3 点である。

1. 計算は 32 bit の float である (§4.1)。
2. チェストは結合した容器 (54) を読み、塞がれていれば 0 である。
3. 10 C6 の「ユーザが充填率を手で与える静的入力」は、今の TS ではスロットの物流モードと併存している。

### 9.3 docs/research/13_scope-policy.md §4.2

「容量抽象: hopper 320 / dropper 576 / 汎用 1728」「-1 補正と BE 順は単純化」は、どちらも今の TS と合わない (#194・#89・#91 で変わった)。13 が古い。26.3 の読みは §4.2 のとおりである。

### 9.4 fixture hopper-2clock の説明文

説明文は「16gt 周期でトグル」と書くが、記録した期待値は 7 gt ごとに反転し、1 周 14 gt である。26.3 の読み (§4.2) と記録が一致し、説明文が古い。

### 9.5 docs/research/16_nucleation-comparison.md §2.6

「取り出しに失敗したときの CU (redstone-sim は無し)」「蓋がふさがったチェストはコンパレーター 0」「ラージチェスト 54 スロット」は、いずれも 26.3 の読みと合う (§4.9・§4.11)。
ただし 16 は Nucleation の塞がれを「判定は full cube で近似」と書く。26.3 は真上が導体か (isRedstoneConductor) で判定する (§4.11)。導体の判定を上書きするブロックで結果が割れる (ガラス・氷は当たり判定が 1 マスでも非導体、soul_sand は 1 マスでなくても導体。26.3 Blocks の登録)。Rust で写すときは full cube ではなく 05 の導体の表を使う。
「大釜・コンポスター・クラフターの読み (redstone-sim は一部)」も 26.3 の読みと合う。TS が読めるのは水入り大釜だけで、空・溶岩・粉雪の大釜は取り込めない (§9.6)。

### 9.6 今の TS 実装 (packages/sim/src)

コードは変えない。違いを書くだけである。

| 箇所 | TS | 26.3 | 影響する場面 |
|---|---|---|---|
| blocks/container.ts の putOne | 同じ物の山へ足すのを先に探し、無ければ先頭の空き | 番号順に「空か足せるか」を見て、最初の所に置く (§4.5) | 空きの後ろに同じ物がある容器。P3 |
| world.ts の tickBlockEntities (押し出し・吸い込み) | 先頭の空でないスロットの物だけを試す | 入らなければ次のスロットを試す (§4.3・§4.4) | 混載の仕分け機。P1・P2 |
| 同上の CU | 押し出しで相手 1 回、吸い込みで源 1 回、最後に自分 1 回。順は D → S → H | 回数は §4.9。源がホッパーなら最初の知らせは D → H → S | 同じ tick に予約するコンパレーター同士の順。P4 |
| 同上 | 取り出しに失敗すると CU を出さない | 源がチェスト類なら CU を出す (§4.9) | 失敗が続くホッパーの源を読むコンパレーター |
| world.ts の analogOutputOf | コンテナ・クラフター・銅の電球・水入り大釜・コンポスター・書見台・ディテクターレールだけ。空・溶岩・粉雪の大釜は blockNames.ts が取り込まない | §4.10 の全表。空の大釜もアナログ出力 (0) を持ち、導体越しでも 0 で置き換える | 下の行。空の大釜を導体越しに読む回路 |
| blocks/blockNames.ts | chiseled_bookshelf を導体の solid として取り込む。respawn_anchor・end_portal_frame・command_block は押せない solid の表にあるが、solid の名前の表に無いので未対応として落ちる | chiseled_bookshelf はアナログ出力 (0〜6) を持つ。コンパレーターはその値を読み、奥を見ない | 本棚の裏にコンパレーターを置いた回路 |
| ContainerState (types.ts)・isContainerBlockName | チェスト 1 個 = 27 スロット。結合と塞がれは無い。銅のチェストは container に入らない | §4.11・§4.12 | ラージチェストと銅のチェストの計測 |
| containerSlotsOf | hopper・dropper・dispenser・container だけが物流に参加 | コンポスター・かまど・醸造台・シュルカー (面の制限つき) も参加 | コンポスター回路。シュルカーボックスへのシュルカーの挿入 (TS は通る) |
| lecternSignal | ページ数 0 を「本の中身なし」とみなし 14 | 白紙の本と羽ペンは中身ありで 15 (§4.10) | 白紙の本を置いた書見台 |
| fillSignal | 倍精度で計算し、f を 1 で頭打ち | float で計算、頭打ちなし | TS の上限は 1・16・64 だけなので結果は一致する |
| hopper.test.ts の「受信側は実効 7gt」「縦チェーンの系列」 | 一致 | §4.2。待ち・tickedGameTime・8 − k の規則を 3 段 (X 上・Y 中・Z 下、X に 5 個) に当てて計算し直すと、設置順 X→Y→Z と Z→Y→X の両方で、テストに書いた 1.21.1 の系列 (t0〜t10) がそのまま出る | — |
| 同上の受け手の待ち | 「受け手が空」なら一律 currentTick + 7 | 8 − k と、受け手のその tick の L13 の減算の組み合わせ。L13 の経路では結果が同じ | L12 の押し出し (§5.10) は TS に無い (アイテムエンティティを持たない。13 §2) |

---

## 10. 典拠一覧

- 26.3 HopperBlock#getStateForPlacement・#getTicker・#onPlace・#neighborChanged・#checkPoweredState・#affectNeighborsAfterRemoval・#hasAnalogOutputSignal・#getAnalogOutputSignal・#entityInside
- 26.3 HopperBlockEntity#loadAdditional・#saveAdditional・#removeItem・#setItem・#setBlockState・#pushItemsTick・#tryMoveItems・#inventoryFull・#ejectItems・#getSlots・#isFullContainer・#suckInItems・#tryTakeInItemFromSlot・#addItem・#canPlaceItemInContainer・#canTakeItemFromContainer・#tryMoveInItem・#getAttachedContainer・#getSourceContainer・#getItemsAtAndAbove・#getContainerAt・#getBlockContainer・#getEntityContainer・#canMergeItems・#isOnCooldown・#isOnCustomCooldown・#entityInside
- 26.3 Hopper#getSuckAabb (SUCK_AABB)
- 26.3 MinecartHopper#suckInItems (境界の確認)
- 26.3 AbstractContainerMenu#getRedstoneSignalFromBlockEntity・#getRedstoneSignalFromContainer
- 26.3 Mth#lerpDiscrete
- 26.3 Container#getMaxStackSize・#canPlaceItem・#canTakeItem
- 26.3 BaseContainerBlockEntity#removeItem・#setItem・#isEmpty
- 26.3 RandomizableContainerBlockEntity#getItem・#removeItem・#setItem
- 26.3 ListBackedContainer#canPlaceItem・#removeItem・#setItem
- 26.3 ContainerSingleItem#getItem・#removeItem・#setItem
- 26.3 SimpleContainer#setItem・#removeItem
- 26.3 ContainerHelper#removeItem・#saveAllItems・#loadAllItems
- 26.3 BlockEntity#setChanged・#preRemoveSideEffects
- 26.3 Containers#updateNeighboursAfterDestroy
- 26.3 Level#setBlock・#updateNeighbourForOutputSignal・#tickBlockEntities
- 26.3 LevelChunk#setBlockState・BoundTickingBlockEntity#tick (LevelChunk の内側のクラス)
- 26.3 SetBlockCommand#setBlock
- 26.3 PistonMovingBlockEntity#tick・#finalTick・#moveEntityByPiston
- 26.3 Entity#applyEffectsFromBlocks・#applyEffectsFromBlocksForLastMovements・ItemEntity#tick
- 26.3 ServerLevel#updateNeighboursOnBlockSet・#neighborChanged
- 26.3 ChestBlock#getBlockType・#updateShape・#chestCanConnectTo・#getConnectedDirection・#getStateForPlacement・#getChestType・#candidatePartnerFacing・#affectNeighborsAfterRemoval・#getContainer・#combine・#isChestBlockedAt・#hasAnalogOutputSignal・#getAnalogOutputSignal・#tick
- 26.3 DoubleBlockCombiner#combineWithNeigbour
- 26.3 CompoundContainer#getContainerSize・#getItem・#getMaxStackSize・#setChanged
- 26.3 ChestBlockEntity#signalOpenCount・#recheckOpen
- 26.3 TrappedChestBlock・TrappedChestBlockEntity#signalOpenCount
- 26.3 CopperChestBlock#chestCanConnectTo・#getStateForPlacement・#getLeastOxidizedChestOfConnectedBlocks・#unwaxBlock・#updateShape・#shouldChangedStateKeepBlockEntity
- 26.3 WeatheringCopperChestBlock#randomTick・#isRandomlyTicking
- 26.3 ChangeOverTimeBlock#changeOverTime・#getNextState
- 26.3 BlockEntityTypes (CHEST・TRAPPED_CHEST)
- 26.3 BarrelBlock#getAnalogOutputSignal・BarrelBlockEntity#updateBlockState
- 26.3 ContainerOpenersCounter#incrementOpeners・#decrementOpeners・#recheckOpeners
- 26.3 ShulkerBoxBlock#getAnalogOutputSignal・ShulkerBoxBlockEntity#getSlotsForFace・#canPlaceItemThroughFace・#preRemoveSideEffects
- 26.3 AbstractFurnaceBlock#getAnalogOutputSignal・AbstractFurnaceBlockEntity#getSlotsForFace・#canPlaceItem・#canTakeItemThroughFace・#serverTick・#setItem
- 26.3 BrewingStandBlock#getAnalogOutputSignal・BrewingStandBlockEntity#getSlotsForFace・#canPlaceItem・#canTakeItemThroughFace・#serverTick
- 26.3 ComposterBlock#onPlace・#addLayer・#tick・#getAnalogOutputSignal・#getContainer (InputContainer・OutputContainer・EmptyContainer)
- 26.3 ContextIntProviders#compostable (compostable の段数・醸造燃料の既定)・WeightedListValue・NumberDispatcher・LootContext.Builder#create
- 26.3 ChiseledBookShelfBlock#getAnalogOutputSignal・ChiseledBookShelfBlockEntity#updateState・#setItem・#removeItem・#canTakeItem・#getMaxStackSize
- 26.3 ShelfBlock#getAnalogOutputSignal・#neighborChanged・#affectNeighborsAfterRemoval・#useItemOn・#getRows・#getColumns・ShelfBlockEntity#setChanged
- 26.3 SelectableSlotContainer#getHitSlot
- 26.3 DecoratedPotBlock#getAnalogOutputSignal・#useItemOn・DecoratedPotBlockEntity#setTheItem・#splitTheItem・ContainerSingleItem#setItem・#removeItem
- 26.3 JukeboxBlock#getAnalogOutputSignal・#affectNeighborsAfterRemoval・JukeboxBlockEntity#getComparatorOutput・#setTheItem・#splitTheItem・#onSongChanged・#popOutTheItem・#preRemoveSideEffects・#canPlaceItem・#canTakeItem・JukeboxSongPlayer#play・#stop・JukeboxSongs
- 26.3 LecternBlock#getAnalogOutputSignal・#affectNeighborsAfterRemoval・#resetBookState・LecternBlockEntity#getRedstoneSignal・#hasBook・#setPage・#preRemoveSideEffects
- 26.3 CopperGolemStatueBlock#getAnalogOutputSignal・#updatePose・#affectNeighborsAfterRemoval
- 26.3 CreakingHeartBlock#getAnalogOutputSignal・CreakingHeartBlockEntity#serverTick・#computeAnalogOutputSignal
- 26.3 AbstractCauldronBlock#hasAnalogOutputSignal・LayeredCauldronBlock#getAnalogOutputSignal・LavaCauldronBlock#getAnalogOutputSignal
- 26.3 CakeBlock#getOutputSignal・CandleCakeBlock#getAnalogOutputSignal
- 26.3 EndPortalFrameBlock#getAnalogOutputSignal・EnderEyeItem#useOn
- 26.3 RespawnAnchorBlock#getScaledChargeLevel
- 26.3 BeehiveBlock#getAnalogOutputSignal・#playerDestroy・#resetHoneyLevel・BeehiveBlockEntity#releaseOccupant (蜜の段の増加)
- 26.3 CommandBlock#tick・#executeChain・#getAnalogOutputSignal
- 26.3 CrafterBlock#getAnalogOutputSignal・CrafterBlockEntity#getRedstoneSignal
- 26.3 DispenserBlock#getAnalogOutputSignal
- 26.3 SculkSensorBlock#getAnalogOutputSignal
- 26.3 DetectorRailBlock#getAnalogOutputSignal・#checkPressed
- 26.3 CopperBulbBlock#getAnalogOutputSignal
- 26.3 ItemFrame#getAnalogOutput・AbstractMinecartContainer#setChanged
- 26.3 ComparatorBlock#getInputSignal
- 26.3 AABB#intersects・EntitySelector (ENTITY_STILL_ALIVE・CONTAINER_ENTITY_SELECTOR)
- 26.3 BlockTags (does_not_block_hoppers・copper_chests)・VanillaBlockTagsProvider・タグ prevents_bee_spawns_when_mining
- 26.3 Blocks (GLASS・ICE・SOUL_SAND の導体の指定)
- 26.3 FluidState#isSourceOfType・TypedInstance#is・ChestBlock#getStateForPlacement (水浸し)
- 版差の典拠: 1.21.1 HopperBlockEntity・Containers#dropContentsOnDestroy・ChiseledBookShelfBlock#onRemove・JukeboxBlock#onRemove・JukeboxBlockEntity#popOutTheItem・ItemEntity#tick・Entity#checkInsideBlocks・ComposterBlock#addItem・ChestBlock#getStateForPlacement、26.2 ComposterBlock#addItem・Items、26.4-pre-1 Fluids・FlowingFluid#isSource・JukeboxBlockEntity#isInPlaylistMode・#tryToAdvancePlaylist・LecternBlockEntity#getPageInRange
