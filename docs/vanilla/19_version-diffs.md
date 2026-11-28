# 19. 版差 (1.21.1・26.2・26.3・26.4-pre-1) と既存 fixture の有効性

Rust (WASM) エンジンの典拠は 26.3 である。今の TS エンジンと実機ハーネスは 1.21.1 で動いている。
このメモは 4 版の違いのうち挙動に効くものを集め、1.21.1 で撮った fixture のどれが 26.3 の正解に使えるかを決める。
各分野の細部は 01〜18 の各メモの §6 にある。ここでは横断的な仕組み (書き込みのフック・フラグ・/setblock) を自分で読み直し、各メモの結論と突き合わせた。

確かさの表記:

- [26.3 読解] 26.3 のコードを読んで確かめた (典拠のクラス#メソッドを添える)
- [実機 1.21.1: fixture 名] 既存の実機 fixture が裏づける
- [要実機] 読んだだけでは結果が決まらない。実機で測る項目として残す
- [版差 1.21.1] [版差 26.2] [版差 26.4-pre-1] その版だけ 26.3 と違う点

---

## 1. 対象と範囲

### 1.1 比べた版

| 版 | 公開日 | 種別 | Java | net/minecraft の .java | 備考 |
|---|---|---|---|---|---|
| 1.21.1 | 2024-08-08 | release | 21 | 4,053 | 難読化 jar を公式 mappings で戻したもの。引数名が $$n になる |
| 26.2 | 2026-06-16 | release | 25 | 4,839 | 非難読化 jar |
| 26.3 | 2026-09-15 | release | 25 | 5,027 | **基準** |
| 26.4-pre-1 | 2026-11-24 | snapshot | 25 | 5,149 | プレリリース。正式な 26.4 で変わりうる |

- Java の版は各版の version.json による (ランチャー用の版の定義の javaVersion と、jar の中の version.json の java_version。どちらも同じ値)。26.3 の class ファイルの major は 69 (Java 25) である。
- 1.21.1 と 26.2 の間に release が 13 版ある (1.21.2〜1.21.11・26.1・26.1.1・26.1.2)。手元に無いので、**どの版で変わったかは書かない**。「1.21.1 → 26.2」は 13 版ぶんの差の合計である。

### 1.2 読んだもの

- 網羅表 (hooks-26.3.tsv) の 251 クラス (ブロックと BlockEntity) を 4 版で比べた。
- 中核のクラス: Level・LevelChunk・LevelWriter・LevelAccessor・ScheduledTickAccess・ServerLevel・NeighborUpdater・CollectingNeighborUpdater・InstantNeighborUpdater・Orientation・ExperimentalRedstoneUtils・RedstoneWireEvaluator 系 3 クラス・SignalGetter・LevelTicks・LevelChunkTicks・ScheduledTick・TickPriority・SavedTick・BlockEventData・Block・BlockBehaviour・Blocks・PushReaction・Direction・BlockStateProperties・FeatureFlags・Containers。
- コマンド: SetBlockCommand・BlockInput・FillCommand・CloneCommands・TickCommand・ServerTickRateManager・ItemCommands (26.3 は server/commands/item のパッケージ)。
- 流体とエンティティ: FlowingFluid・WaterFluid・LavaFluid・LiquidBlock・BubbleColumnBlock・Entity・AbstractMinecart・OldMinecartBehavior・PrimedTnt・FallingBlockEntity・ItemEntity・ServerExplosion。
- リポジトリ: tools/decompile の watched-classes.txt・fingerprints.json・spec-drift.sh・README.md、CONTRIBUTING.md、docs/research の 02・04・07・16・18、tools/mc-harness の README.md・runner/generate.ts・fixtures (定義 134 本)、packages/sim/test/fixtures (生成済み 150 本)、packages/sim/src/world.ts の該当箇所、.github/workflows/spec-drift.yml。

### 1.3 比べ方

1. 26.x の版どうしは diff -u のあと、機械的な差を落としてから残りを読んだ。落としたもの: import、ブロックの codec の定義、フラグ 3 の setBlock から setBlockAndUpdate への置き換え、予約の位置の複製、Guava の集合から標準の集合への置き換え、Mth#clamp から Math#clamp への置き換え、音量・音程の既定値の省略。
2. 1.21.1 は引数名が $$n なので、識別子を伏せた骨格 (呼び出し・定数・制御だけを残す) で比べ、違う所をメソッド単位で読んだ。
3. Blocks の登録は、定数ごとに pushReaction と isRedstoneConductor の指定を抜き出して突き合わせた。
4. 01〜18 の §6 の主張を、上の差分で一つずつ確かめた。食い違いは §9 に書く。

### 1.4 扱わない範囲

各分野の版差の細部は次のメモにある。ここでは結論と横断の部分だけを扱う。

| 分野 | 参照先 |
|---|---|
| tick ループの位相・時計・ランダム tick | → 01_tick-loop.md §6 |
| 予約 tick の仕組み・保存の並び・各ブロックの予約 | → 02_scheduled-ticks.md §6 |
| ブロックイベント | → 03_block-events.md §6 |
| 書き込みのフラグ・撤去フック・/setblock の細部 | → 04_set-block-and-updates.md §6 |
| 導体・押し反応・状態の表 | → 05_signals-and-block-properties.md §6 |
| ダスト | → 06_redstone-wire.md §6 |
| リピーター・コンパレーター | → 07_diodes.md §6 |
| トーチ・オブザーバー・レッドストーンブロック | → 08_torch-observer-redstone-block.md §6 |
| 手で操作する入力 | → 09_manual-inputs.md §6 |
| スカルク | → 10_sculk.md §6 |
| 出力 (ランプ・扉・TNT ほか) | → 11_outputs.md §6 |
| ディスペンサー・ドロッパー・クラフター | → 12_dispenser-dropper-crafter.md §6 |
| ピストン | → 13_pistons.md §6 |
| コンテナとアナログ値 | → 14_containers-hoppers-analog.md §6 |
| レール | → 15_rails.md §6 |
| 流体・泡柱・落下ブロック | → 16_fluids-falling-blocks.md §6 |
| エンティティ | → 17_entities-interplay.md §6 |
| 反復順・乱数・整数 | → 18_determinism-java-semantics.md §6 |
| 26.3 の正解の撮り方 (ハーネスの移行) | → docs/research/18_ground-truth-oracle.md |

---

## 2. 全体像

### 2.1 3 つの区間の要約

| 区間 | 大きさ | 挙動に効く主な違い | 変わらない所 |
|---|---|---|---|
| 1.21.1 → 26.2 | 大 | 撤去フックの条件 (onRemove → affectNeighborsAfterRemoval)、フラグ 128・256・512、/setblock の手順、トーチの 2 段送信の回数、ピストンが壊すセルの撤去の時点、エンティティのブロック作用の経路、泡柱の予約の持ち主、流水の書き込みのフラグ、トリップワイヤーと避雷針の予約、TNT のゲームルール | 既定のダストの計算、ダイオード、予約 tick とブロックイベントの仕組み、近隣更新の方向順と連鎖と上限 |
| 26.2 → 26.3 | 小 | トリップワイヤーの解除の遅延 (0 → 1)、流体が押し流すブロックの判定のタグ化、検知レールの再判定のガード、スライムで弾く対象とエンティティの跳ね返り、TNT のアドベンチャー制限 | 上記以外のレッドストーンの中核すべて。改名 (RedStoneWireBlock → RedstoneWireBlock、PushReaction の値名) と codec の削除が大半 |
| 26.3 → 26.4-pre-1 | 中 (流体) | 流体の作り替え (洗い流しが destroyBlock を通る・溶岩も落とし物を出す・青氷の横の水が brittle_ice)、ディスペンサーの振る舞いのデータ化、ジュークボックスのプレイリスト、Mth の sin と cos、TNT を火打石などで点けるときの主乱数、パケット処理の例外での切断 | ダスト・ダイオード・トーチ・オブザーバー・ピストン・予約・近隣更新は書き方の差だけ |

### 2.2 差の 4 分類

| 分類 | 意味 | 例 | fixture への効き |
|---|---|---|---|
| 規則の差 | 状態の結果が変わる | トリップワイヤーの遅延、避雷針の onPlace、泡柱の持ち主、26.4-pre-1 の洗い流し | 撮り直す |
| 順・回数の差 | tick の中の更新の順や件数が変わる。状態の結果は同じことが多い | トーチの 2 段送信の回数、ピストンが壊すセルの撤去の時点、/setblock の後始末の順 | 主題に当たるなら撮り直す。そうでなければ要確認 |
| 名前の差 | 識別子だけ変わる | RedstoneWireBlock、PushReaction の値名、DirectionProperty → EnumProperty | 無し (文字列の ID とプロパティ名は同じ) |
| 書き方の差 | 処理は同じ | codec の削除、setBlockAndUpdate、Guava → 標準の集合 | 無し |

### 2.3 件数 (網羅表の 251 クラス)

| 区間 | 文字が同じ | 機械的な差だけ | 中身の差が残る | 片方に無い |
|---|---|---|---|---|
| 1.21.1 → 26.3 | 1 | — (骨格で同じは 6) | 215 | 30 (新規か改名。RedstoneWireBlock だけは改名として比べた) |
| 26.2 → 26.3 | 10 | 179 | 60 | 2 (AbstractBedBlock・ShelfMushroomBlock は新規。RedstoneWireBlock・PathBlock は改名として比べた) |
| 26.3 → 26.4-pre-1 | 127 | 48 | 76 | 0 |

「中身の差が残る」の大半はレッドストーンに関係しない (植物・看板・音・経験値など)。挙動に効くものは §6.1〜§6.3 の表に全部挙げた。

---

## 3. 状態とデータ

### 3.1 クラスの改名・追加・削除 (レッドストーンに関わるもの)

| 区間 | 旧 | 新 | 中身と効き |
|---|---|---|---|
| 1.21.1 → 26.2 | (無し) | world/level/redstone の DefaultRedstoneWireEvaluator・ExperimentalRedstoneWireEvaluator・RedstoneWireEvaluator・Orientation・ExperimentalRedstoneUtils | ダストの計算を評価器へ分けた。実験の更新順は実験フラグ redstone_experiments 付き。既定の世界では同じ (→ 06) |
| 1.21.1 → 26.2 | (無し) | ScheduledTickAccess | scheduleTick の入口が LevelAccessor から分かれた。挙動は同じ (→ 02) |
| 1.21.1 → 26.2 | entity/vehicle の AbstractMinecart ほか 10 クラス | entity/vehicle/minecart と entity/vehicle/boat。MinecartBehavior・OldMinecartBehavior・NewMinecartBehavior が新しい | トロッコの動きを Old と New (実験フラグ minecart_improvements) に分けた。既定は Old (→ 15・17) |
| 1.21.1 → 26.2 | state/properties/DirectionProperty | (EnumProperty で向きを持つ) | 値と並びは同じ (→ 05) |
| 1.21.1 → 26.2 | entity/BedBlockEntity | (無し) | ベッドが BlockEntity を持たなくなった。押すと壊れるのは同じ (→ 05) |
| 1.21.1 → 26.2 | FarmBlock・WaterlilyBlock・SnowyDirtBlock・FungusBlock・RootsBlock・PinkPetalsBlock・DeadBushBlock ほか | FarmlandBlock・LilyPadBlock・SnowyBlock・NetherFungusBlock・NetherRootsBlock・FlowerBedBlock・DryVegetationBlock ほか | 改名 (中身の主要部が一致)。回路には効かない |
| 1.21.1 → 26.2 | (無し) | ShelfBlock・CopperGolemStatueBlock・CreakingHeartBlock・TestBlock・PotentSulfurBlock・CopperChestBlock・WeatheringLightningRodBlock ほか | レッドストーンのフック (NC・アナログ出力・予約・ブロックイベント) を持つ新しいブロック (→ 05・09・11・14) |
| 26.2 → 26.3 | RedStoneWireBlock | RedstoneWireBlock | 改名。中身の差は接続判定のフック化だけ (→ 06) |
| 26.2 → 26.3 | DirtPathBlock | PathBlock | 改名 |
| 26.2 → 26.3 | BlockTypes・FuelValues | (無し) | ブロックの codec の表と燃料の表が消えた。燃料はアイテムの部品になった (→ 14) |
| 26.2 → 26.3 | server/commands/ItemCommands | server/commands/item の ItemCommands・BlockItemAccessor・EntityItemAccessor ほか | /item の作り直し。ハーネスの item 入力が通る。最後に Container#setItem を呼ぶのは同じ (§9.8) |
| 26.2 → 26.3 | (無し) | AbstractBedBlock・StrawBedBlock・ShelfMushroomBlock・FallingParticlesLeavesBlock・BonemealSource・blockscan パッケージ・SolidDebugger | 新しいブロックと補助。回路の規則には効かない |
| 26.3 → 26.4-pre-1 | SoundType | sounds/BlockSoundSet ほか | 音の定義だけ |
| 26.3 → 26.4-pre-1 | (無し) | BrittleIceBlock・CrackingIceBlock・IceCrystalBlock・IcicleBlock・AbstractCrystalClusterBlock・DropExperienceEntityBlock | 新しい氷のブロックと経験値の共通化 (→ 05・16) |

### 3.2 フラグの値 (Block の定数)

| 値 | 名前 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|---|
| 1・2・4・8・16・32・64 | NEIGHBORS・CLIENTS・INVISIBLE・IMMEDIATE・KNOWN_SHAPE・SUPPRESS_DROPS・MOVE_BY_PISTON | 有る | 有る | 有る | 有る |
| 128 | SKIP_SHAPE_UPDATE_ON_WIRE | **無い** | 有る | 有る | 有る |
| 256 | SKIP_BLOCK_ENTITY_SIDEEFFECTS | **無い** | 有る | 有る | 有る |
| 512 | SKIP_ON_PLACE | **無い** | 有る | 有る | 有る |
| UPDATE_NONE | (組み合わせ) | 4 | 260 | 260 | 260 |
| UPDATE_SKIP_ALL_SIDEEFFECTS | (組み合わせ) | 無い | 816 | 816 | 816 |
| UPDATE_LIMIT | 形状更新の深さ | 512 | 512 | 512 | 512 |

[26.3 読解: Block の定数] 手元の 4 版では 128・256・512 は 26.2 で初めて現れる。
128 を見るのは NeighborUpdater#executeShapeUpdate (立っていると宛先のダストへの SU を飛ばす) だけで、立てるのは実験の評価器 ExperimentalRedstoneWireEvaluator の書き込みだけである。既定の世界では 128 は使われない [26.3 読解: NeighborUpdater#executeShapeUpdate・ExperimentalRedstoneWireEvaluator]。

フラグを直に書く主な書き込み:

| 書き込み | 1.21.1 | 26.2〜26.4-pre-1 | 典拠 |
|---|---|---|---|
| 伸長の完了で本体を伸びた状態にする | 67 | 67 | PistonBaseBlock#triggerEvent |
| 収縮で本体を moving_piston にする・収縮でヘッドを消す | 20 | 276 | PistonBaseBlock#triggerEvent・#moveBlocks |
| 押すブロックの行き先と伸長のヘッドの位置に moving_piston を置く | 68 | 324 | PistonBaseBlock#moveBlocks |
| 壊すセルを空気にする | 18 | 18 | PistonBaseBlock#moveBlocks |
| 空いたセルを空気にする | 82 | 82 | PistonBaseBlock#moveBlocks |
| 着地 (形を直した状態) | 67 | 67 | PistonMovingBlockEntity#tick |
| 着地 (直すと空気になる場合。置いてから壊す) | 84 | 340 | PistonMovingBlockEntity#tick |
| /setblock の書き込み | 2 | 258。strict は 818 | SetBlockCommand#setBlock |

値が変わった 4 つ (20・68・84・2) は、どれも 1.21.1 の値に 256 を足したものである (67・18・82 は同じ)。256 は「BlockEntity を外すときの副作用 (中身を落とす・moving_piston の finalTick) を省く」で、ピストン自身の経路では差が出ない (→ 13 §6.1)。

### 3.3 PushReaction の値

| 26.3 の名前 | 26.2 までの名前 | 意味 | 序数 (26.3 / 26.2) |
|---|---|---|---|
| PUSH_PULL | NORMAL | 押せて引ける | 0 / 0 |
| PUSH | PUSH_ONLY | 押せるが引けない (釉薬テラコッタ) | 1 / 4 |
| POPPED | DESTROY | 押すと壊れる | 2 / 1 |
| IMMOVEABLE | BLOCK | 動かない | 3 / 2 |
| IGNORE_ENTITY | IGNORE | エンティティ用 (押されない) | 4 / 3 |

[版差 26.2] 26.3 で名前と並びが変わった。序数は保存されないので挙動には効かない [26.3 読解: PushReaction]。

### 3.4 Blocks の登録の差

- **POPPED の数** (Blocks の中の出現数): 26.2 は 209、26.3 は 215、26.4-pre-1 は 202。
  - 26.2 → 26.3 の +6 は新しいブロック 6 種 (poplar_door・poplar_pressure_plate・poplar_sapling・red_shrub・shelf_mushroom・straw_bed) である。
  - 26.3 → 26.4-pre-1 の −13 は書き方の差である。26.4-pre-1 の Blocks#wallVariant は立っている方のブロックの性質を丸ごと写す (ofFullCopy)。壁付きの 16 種 (wall_torch・soul_wall_torch・redstone_wall_torch・copper_wall_torch・頭と頭蓋骨の壁付き 7 種・生きたサンゴの壁付きファン 5 種) は POPPED の明示をやめたが、写しで受け継ぐ。新しい brittle_ice・ice_crystal・icicle が 3 つ足す。−16 + 3 = −13 [26.3 読解: Blocks#wallVariant、26.4-pre-1 と比較]。
- **IMMOVEABLE**: 26.3 で obsidian・crying_obsidian・respawn_anchor・reinforced_deepslate に付いた。26.2 までは PistonBaseBlock#isPushable が名指しで弾いていた。ピストンの結果は同じ (→ 13)。
- **導体の明示** (isRedstoneConductor): 26.2 と 26.3 は同じ並び。26.4-pre-1 は brittle_ice・ice_crystal・icicle を非導体として足す。4 版に共通するブロックで値の差は無い (→ 05 §6 の状態ダンプ)。
- 26.4-pre-1 の写しで、壁付きの頭と頭蓋骨は立っている方の noOcclusion も受け継ぐ。当たり判定と信号には効かない。

### 3.5 監視クラスの指紋 (tools/decompile)

spec-drift.sh と同じ正規化 (改行コード・行末の空白・空行を落として sha256) で 4 版を計算した。fingerprints.json の基準 (26.2) は手元の 26.2 と全部一致した。

| watched-classes.txt の行 | 26.2 → 26.3 | 26.3 → 26.4-pre-1 | 26.2 → 26.3 の差の中身 |
|---|---|---|---|
| redstone/NeighborUpdater | 同じ | 変わる (クラッシュ報告の補助クラスの名前) | — |
| redstone/CollectingNeighborUpdater | 同じ | 同じ | — |
| block/RedStoneWireBlock | **ファイルが無い** (RedstoneWireBlock.java へ改名) | 無い | 改名と接続判定のフック化 |
| block/DiodeBlock | 変わる | 同じ | codec の削除とダストのクラス名だけ |
| block/RepeaterBlock | 変わる | 同じ | codec の削除・setBlockAndUpdate・接続判定のフック |
| block/ComparatorBlock | 変わる | 同じ | codec の削除だけ |
| block/RedstoneTorchBlock | 変わる | 変わる (リストの作り方) | codec の削除・setBlockAndUpdate |
| block/ButtonBlock | 変わる | 変わる (音の定義) | codec の削除・setBlockAndUpdate・予約の位置の複製 |
| block/LeverBlock | 変わる | 同じ | codec の削除・setBlockAndUpdate |
| block/ObserverBlock | 変わる | 同じ | codec の削除・接続判定のフック |
| ticks/LevelTicks | 同じ | 変わる (ログ用の補助クラスの名前) | — |
| ticks/LevelChunkTicks | 同じ | 同じ | — |

26.2 → 26.3 で変わった 8 本は、どれも挙動の差を含まない [26.3 読解: 各クラスを 26.2 と比較]。

---

## 4. 処理の詳細 (版で切り替わる所)

### 4.1 LevelChunk#setBlockState の撤去フックと設置フック

呼ばれる契機は Level#setBlock (フラグ付きの書き込み) である。

1.21.1 の手順 [版差 1.21.1]:

1. 状態を書き込む。同じ状態なら何もせず終わる。
2. サーバー側なら、**古い状態の onRemove を必ず呼ぶ**。引数に新しい状態と「ピストンで動いたか」(フラグ 64 の有無) を渡す。種類が変わったかは各ブロックが自分で見る。
3. その位置がまだ新しいブロックなら、サーバー側で新しい状態の onPlace を必ず呼ぶ。
4. BlockEntity を作り直す。古い BlockEntity の取り外しは onRemove の既定の中 (種類が変わったとき) で行う。

26.2〜26.4-pre-1 の手順 [26.3 読解: LevelChunk#setBlockState]:

1. 同じ。
2. 種類が変わり、古い状態が BlockEntity を持ち、新しい状態が引き継がないなら BlockEntity を外す。サーバー側でフラグ 256 が無ければ、先に BlockEntity#preRemoveSideEffects を呼ぶ (既定はコンテナなら中身を落とす。moving_piston は finalTick、ジュークボックスは円盤、本の載った書見台は本を出す。叫んでいるスカルクシュリーカーは応答する。シュルカーボックスは何もしない) [26.3 読解: BlockEntity#preRemoveSideEffects と各 BlockEntity の上書き]。
3. 「種類が変わった、または**新しいブロックがレール (BaseRailBlock)**」かつサーバー側かつ「フラグ 1 かフラグ 64」なら、古い状態の affectNeighborsAfterRemoval を呼ぶ。新しい状態は渡さない。
4. その位置がまだ新しいブロックで、サーバー側でフラグ 512 が無ければ onPlace を呼ぶ。
5. BlockEntity を作り直す。

撤去フックが走るか:

| 書き込み | 1.21.1 | 26.3 |
|---|---|---|
| 種類が変わる・フラグ 1 あり (フラグ 3 など) | 走る | 走る |
| 種類が変わる・フラグ 1 も 64 も無い (/setblock の書き込み・ピストンが壊すセルのフラグ 18) | 走る | 走らない (/setblock は後始末で、ピストンは手順の後半で別に呼ぶ) |
| 同じ種類で状態だけ変わる・フラグ 1 あり | 走る | レールだけ走る |
| 同じ種類・フラグ 1 も 64 も無い | 走る | 走らない |
| ピストンの移動 (フラグ 64) | 走る (動いた印つき) | 走る (動いた印つき) |

1.21.1 で onRemove を持つ 29 クラス (BlockBehaviour の既定を含む) のうち、**同じ種類でも更新を出すのは RedstoneTorchBlock と BaseRailBlock だけ**である。ほかは自分で「種類が変わったか」を見る [版差 1.21.1]。
このため、普通のプレイ (部品の自分の書き込みはフラグ 3) で差が出るのはトーチ (§4.4) だけで、レールは 26.3 の例外で 1.21.1 と同じになる (§4.5)。

### 4.2 Level#setBlock と近隣更新

- 手順は 4 版で同じ: チャンクへの書き込み → クライアントへの送信 (フラグ 2) → フラグ 1 なら 6 方向の NC (送り主は古いブロック) と、新しい状態がアナログ出力を持てば CU → フラグ 16 が無ければ SU。
- 1.21.1 は NC を ServerLevel#blockUpdated 経由で出す (デバッグワールドでは出さない)。26.x は updateNeighborsAt を直に呼ぶ。普通の世界では同じ。
- NC が運ぶもの: 1.21.1 は送り元の座標、26.x は Orientation。Orientation は実験フラグが無ければ null で、受け手は使わない (→ 04 §4.9・06)。
- 方向の並び (NC・SU・CU の 3 種)、CollectingNeighborUpdater の積み方、連鎖の上限 1,000,000 は 4 版で同じ (→ 04 §6.1・18 §6.1)。
- 26.4-pre-1 の Level#setBlock はデバッグワールドで書き込みを拒まなくなった。デバッグワールドは起動時に凍結する形に変わった。普通の世界には効かない (→ 01 §6.4)。

### 4.3 /setblock (SetBlockCommand#setBlock・BlockInput#place)

ハーネスの setblock 入力はこの経路を通るので、fixture の有効性に直接効く。

1.21.1 の手順 [版差 1.21.1]:

1. destroy の指定なら destroyBlock。そうでなければ、古い BlockEntity の中身を先に空にする (Clearable#tryClear)。
2. BlockInput#place: 周りに合わせて状態を直す (Block#updateFromNeighbourShapes。結果が空気なら指定のまま)。フラグ 2 で書く。書けなければ失敗。BlockEntity のデータを読み込む (setChanged は呼ばない)。
   - 書き込みの中で、古い状態の onRemove → 新しい状態の onPlace が走る (§4.1)。
   - フラグ 16 が無いので SU が出る。
3. 位置の 6 方向へ NC を出す (ServerLevel#blockUpdated。送り主はコマンドで指定したブロック)。CU は出さない。

26.3 の手順 [26.3 読解: SetBlockCommand#setBlock・BlockInput#place・ServerLevel#updateNeighboursOnBlockSet]:

1. destroy の指定なら destroyBlock。古い状態を覚える。
2. BlockInput#place: strict でなければ周りに合わせて直したあと、**明記したプロパティを上書きし直す** (BlockInput#overwriteWithDefinedProperties)。フラグ 258 (strict は 818) で書く。BlockEntity のデータを読み、中身が変われば setChanged を呼ぶ。書き込みか BlockEntity のどちらかが変われば成功。
   - 書き込みの中では撤去フックは走らない。onPlace は走る (strict は走らない)。BlockEntity の取り外しの副作用も無い (256)。
   - SU が出る (strict は 16 を含むので出ない)。
   - setChanged は BlockEntity#setChanged の既定どおり、その位置から CU を出す。アナログ出力の有無を見ず、strict でも出る。後始末の CU より前である。データの入った /setblock では CU が 2 回届きうる [26.3 読解: BlockInput#place・BlockEntity#setChanged]。
3. strict でなければ後始末 (ServerLevel#updateNeighboursOnBlockSet): 種類が変わっていれば古い状態の撤去フック → 6 方向へ NC (送り主は今のブロック) → 今の状態がアナログ出力を持てば CU。

| 点 | 1.21.1 | 26.3 | 効き |
|---|---|---|---|
| 撤去フックの位置 | 書き込みの中。onPlace と SU より前 | 後始末の中。onPlace と SU より後 | 撤去で更新を出す部品を消すと、SU と撤去の NC の順が入れ替わる |
| 同じ種類の上書き | onRemove が走る (トーチとレールは更新を出す) | 撤去フックは走らない。後始末は種類の変化しか見ず、§4.1 のレールの例外は無い | パワードレールの上書き (§4.5) |
| CU | 新しいブロックの分は出さない (データを読んでも setChanged を呼ばない)。コンテナを別のブロックに替えたときの撤去の CU は、書き込みの中の onRemove から出る | 後始末でアナログ出力のブロックなら出す。データで中身が変われば、その前に setChanged の CU も出る。コンテナの撤去の CU は後始末の撤去フックから出る | 導体越しのコンパレーター (§8 V-1)。fixture の setblock 入力にデータ付きのものは無い |
| 明記したプロパティ | 周りに合わせて直されうる | 明記したとおりに入る | ダストの接続を明記した入力 (→ 06 §4.14) |
| 古い BlockEntity の中身 | 先に空にする (コマンドが失敗しても空になる) | 消さない。256 で落とし物も出ない | 落とし物はどちらも出ない |
| strict | 無い | 有る (818。後始末なし) | vanilla だけで無更新の配置が作れる (→ docs/research/18 §1.2)。ただしデータ付きなら setChanged の CU だけは出る |
| 同じ状態を指定 | 失敗 | 失敗。ただし BlockEntity のデータが変われば成功し、後始末が走る | — |
| 後始末の NC の送り主 | コマンドで指定したブロック | 書いた後にその位置から読み直したブロック | 置いた直後に onPlace などで別のブロックに変わったときだけ違う。送り主を見る受け手 (通常のレールの RailBlock#updateState は送り主が信号源かを見る) に効きうる |

### 4.4 RedstoneTorchBlock の 2 段送信

- 2 段送信 = 自分の 6 隣それぞれを中心に、その 6 方向へ NC を出すこと。起点の順は Direction.values() の順 (下・上・北・南・西・東) で、4 版で同じ (→ 08 §6・docs/research/16 R-21)。
- 1.21.1: onPlace と onRemove の両方が 2 段送信を出す。onRemove は種類を見ない (ピストンで動いたときだけ何もしない)。LIT の切り替え (フラグ 3) では、書き込みの中で onRemove の 1 回目 → onPlace の 2 回目 → フラグ 1 の 6 方向の NC → SU の順になる。NC は 72 + 6 件 [版差 1.21.1]。
- 26.3: onPlace だけが 2 段送信を出す (RedstoneTorchBlock#notifyNeighbors)。撤去フックは種類が変わったときだけ。LIT の切り替えでは onPlace の 1 回 → 6 方向の NC → SU。NC は 36 + 6 件 [26.3 読解: RedstoneTorchBlock#onPlace・#affectNeighborsAfterRemoval]。
- 2 回目は 1 回目と同じ宛先・同じ順である。1 回目で落ち着いた状態は 2 回目で変わらないことが多い。予約は重複が捨てられ、ブロックイベントは同じ内容が 1 件にまとまる。
  状態の系列は同じ見込みだが、1 回目のあとに状態が変わったのに知らせを受けない部品 (BUD の配置) があると、2 回目で動いて差が出うる [要実機: §8 V-4]。

### 4.5 BaseRailBlock の撤去フック

- 中身は 4 版で同じ: ピストンで動いたのでなければ、まず坂なら真上の周り 6 方向へ NC。続けて直線のレール (パワードレール・アクティベーターレール・検知レール) なら、自分の周り 6 方向と真下の周り 6 方向へ NC。2 つの条件は別々に見るので、坂の直線のレールは 3 か所 (上・自分・下) の順に出す [26.3 読解: BaseRailBlock#affectNeighborsAfterRemoval]。
- 1.21.1 の onRemove も種類を見ない。26.3 は LevelChunk#setBlockState の例外 (新しいブロックがレールなら種類が同じでも呼ぶ) で、フラグ 1 の書き込みでは 1.21.1 と同じ位置・同じ順に出る。
- 違いはフラグ 1 も 64 も無い書き込みだけ。**同じ種類のパワードレールを /setblock で上書きした場合**:
  1. 1.21.1: 書き込みの中で onRemove が走る。真下の周りへの NC は真上の自分にも届く。自分が neighborChanged を受けて電力を決め直し、電源が無ければすぐ powered が偽に戻る [版差 1.21.1]。
  2. 26.3: 撤去フックも自分への NC も無い。指定した powered がそのまま残る (次に NC を受けるまで) [26.3 読解: LevelChunk#setBlockState・ServerLevel#updateNeighboursOnBlockSet] [要実機: §8 V-2]。
- TS の world.ts の setBlockCommand にある「実機 1.21.1 では同種上書きでも powered が再計算される。26.2 の読みと食い違う」の答えはこれである (§9.9)。

### 4.6 PistonBaseBlock#moveBlocks の壊すセル

- 1.21.1: 壊すセルをフラグ 18 で空気にした瞬間に onRemove が走る。moving_piston を置く前に、壊したダスト・トーチ・ダイオードの更新が出る [版差 1.21.1]。
- 26.3: フラグ 18 の書き込みでは撤去フックが走らない。moving_piston を全部置き、空いたセルへ SU を出したあと、更新のループの中で壊した状態ごとに affectNeighborsAfterRemoval を明示的に呼ぶ。1 セルの中の順は「撤去フック → 間接の形状更新 → そのセルの 6 方向の NC」である [26.3 読解: PistonBaseBlock#moveBlocks]。
- 1.21.1 の同じループは「間接の形状更新 → NC」だけで、撤去の更新はもう書き込みの時点で出し終えている [版差 1.21.1: PistonBaseBlock#moveBlocks]。
- 状態の結果は同じことが多いが、tick の中の順が違う。手順の全体は → 13 §4.8・§6.1。

### 4.7 エンティティのブロックへの作用

- 1.21.1: Entity#move の最後に checkInsideBlocks。今の当たり箱の全マスで entityInside を呼ぶ。
- 26.2 以降: 移動のあとの Entity#applyEffectsFromBlocks。記録した移動の経路を辿り、形で絞り、同じマスは 1 回。効果は InsideBlockEffectApplier に集めてから当てる。動かなかったときも「前の位置 → 今の位置」の移動を 1 本作るので、止まったエンティティにも entityInside は呼ばれる [26.3 読解: Entity#applyEffectsFromBlocks]。
- プレイヤーのブロック作用の位相も変わった (→ 17 §6.1)。感圧板・トリップワイヤー・検知レール・ホッパーの吸い込みに効く (→ 09・15・17)。

### 4.8 予約 tick を積む側の版差

予約の仕組み (LevelTicks の集め方・並び・上限・重複) は 4 版で同じ。違うのは積む側である (→ 02 §6.2)。

| ブロック | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| トリップワイヤーが踏まれなくなったとき | 予約しない | 遅延 0 | **遅延 1** | 遅延 1 |
| 避雷針の onPlace (powered で予約なし) | フラグ 18 で黙って powered を偽にする | 遅延 8 を予約 | 同じ | 同じ |
| 泡柱を作る 20 gt の予約 | ソウルサンドとマグマが自分に積む | 水源ブロックが自分に積む (LiquidBlock#onPlace・#neighborChanged・下からの SU) | 同じ | 同じ |
| 流水の水位が変わったときの書き込み | フラグ 2 で書き、SU → 予約 → 手で NC | フラグ 3 (NC → SU) | 同じ | 流体の種類が水・溶岩の 2 つになる (→ 16 §6.4) |
| リピーター・コンパレーター・トーチ・オブザーバー・ランプ・ディスペンサー・クラフター・ボタン・感圧板・ターゲット・書見台・検知レール・スカルクセンサー | 遅延・優先度・条件は 26.3 と同じ | 同じ | 基準 | 同じ |

[26.3 読解: TripWireBlock#checkPressed・LightningRodBlock#onPlace・LiquidBlock#tryScheduleBubbleBlockColumn]。
26.2 のトリップワイヤーの遅延 0 は期限切れ扱いで同じチャンクの先頭に出る。発火の tick はどちらも次の tick である (→ 02 §6.2)。

---

## 5. 端の場合と落とし穴

- **「26.2 で確認済み」は 26.3 でもほぼ通る**。読み直すのは §6.2 の表に挙げた所 (トリップワイヤー・洗い流し・検知レール・スライムと跳ね返り・TNT・押し反応の名前など) だけである。
- **指紋の差は挙動の差ではない**。26.2 → 26.3 はほぼ全ブロックの codec の削除で、監視 12 本のうち 8 本の指紋が変わった (欠落 1 を含む) が、挙動の差は 0 だった (§3.5)。
- 1.21.1 のデコンパイルは引数名が $$n で、ラムダの引数も別名になる。diff -u はほぼ全行が違って見える。メソッド単位で読む。
- フラグ 3 の setBlock と setBlockAndUpdate は同じである [26.3 読解: LevelWriter#setBlockAndUpdate]。26.3 の書き換えの大半はこれ。
- 26.3 で予約の位置の複製 (new BlockPos) が消えたが、ScheduledTick を作るときに位置を不変にするので同じである [26.3 読解: ScheduledTick の生成]。
- /setblock の後始末は「種類が変わったか」しか見ない。チャンクの書き込みにあるレールの例外 (§4.1) とは条件が違う。
- 26.3 の /setblock は BlockEntity のデータだけ変えても成功し、後始末の NC と CU が出る。1.21.1 は失敗するうえ、先に中身を空にしている。
- 26.3 の /setblock はデータで中身が変わると、後始末より前に setChanged の CU を出す。strict でも出るので、「strict は更新を一切出さない」とは言えない (§4.3)。
- 1.21.1 の /setblock で「本来ありえない状態」を作れるのは、周りに合わせて直した結果が空気なら指定のまま置くからである (支えの無いレバー)。26.3 も同じ。
- PushReaction の序数が 26.3 で並び替わった。Rust は序数に頼らない。
- 26.4-pre-1 の RedstoneWireBlock と WallBlock の PROPERTY_BY_DIRECTION は Map.of になり、反復順が決まらない (JVM ごとに変わりうる)。反復するのは当たりの形を作る所だけなので挙動は同じ [26.3 読解: 26.4-pre-1 と比較]。
- 26.4-pre-1 の Math#clamp は最小が最大を超えると例外を投げる。Mth#clamp は投げない (→ 18 §6.3)。
- 実験フラグ redstone_experiments と minecart_improvements は 26.2〜26.4-pre-1 のどれでも実験のままである [26.3 読解: FeatureFlags]。既定の世界では Orientation は null、トロッコは Old の動き。
- 26.x のサーバーは Java 25 が要る。今のハーネスの image (java21) では 26.3 は動かない (→ docs/research/18 §1.2)。
- 26.4-pre-1 はプレリリースである。§6.3 は「正式版で読み直す所」の一覧として使う。

---

## 6. 版差

### 6.1 1.21.1 → 26.2 (挙動に効くもの)

26.2 と 26.3 で同じものは「26.2 以降」と書く。

| 分野 | 点 | 1.21.1 | 26.2 以降 | 詳細 |
|---|---|---|---|---|
| 書き込み | 撤去フック | onRemove。サーバーで状態が変わるたびに必ず呼ぶ | affectNeighborsAfterRemoval。種類の変化 (かレール) とフラグ 1 か 64 が要る | §4.1・04 §6.2 |
| 書き込み | 設置フック | 必ず呼ぶ | フラグ 512 で止まる | §4.1 |
| 書き込み | BlockEntity の取り外し | onRemove の既定の中 | チャンクの書き込みの中。副作用はフラグ 256 で省ける | §4.1・14 §6 |
| 書き込み | フラグ 128・256・512 | 無い | 有る | §3.2 |
| 近隣更新 | NC が運ぶもの | 送り元の座標 | Orientation (既定は null) | §4.2 |
| コマンド | /setblock | フラグ 2 → 6 方向の NC。撤去は書き込みの中。CU なし。明記したプロパティも周りに合わせて直されうる | フラグ 258 → (データで中身が変われば setChanged の CU) → 撤去フック → NC → CU。明記したプロパティを上書きし直す。strict あり | §4.3 |
| トーチ | 2 段送信 | 切り替えのたびに 2 回 | 1 回 | §4.4・08 §6.2 |
| ダイオード | neighborChanged | 今のブロックを確かめない | 自分と同じ種類のときだけ処理 | 07 §6.1 |
| ダイオード | コンパレーターのモード切り替え | 書いたあと無条件で出力を更新 | まだコンパレーターのときだけ | 07 §6.1 |
| アナログ値 | 読み出し | 位置だけ | 位置と向き (使うのは棚だけ) | 07・14 |
| ピストン | 壊すセルの撤去 | 壊した瞬間 | moving_piston を置いた後のループ | §4.6・13 §6.1 |
| ピストン | ヘッドが消えたときの本体の破壊 | どのフラグでも走る | フラグ 1 か 64 が要る | 13 §6.1 |
| レール | 撤去フック | フラグに関係なく呼ぶ | フラグ 1 か 64 (レールは同じ種類でも) | §4.5・15 §6.2 |
| レール | 直線レールの 180° 回転 | north_south と east_west が入れ替わる | 保つ | 15 §6.3 (構造物の配置だけ) |
| 入力 | entityInside の経路 | 最終位置の箱の全マス | 移動の経路。形で絞る | §4.7・09・17 |
| 入力 | トリップワイヤー | 解除の予約なし。entityInside は予約の有無を見ず、形の箱にいるエンティティを集め直して判定する。フックの calculateState に「発信側が消えたか」「書き戻す位置がまだ紐か」の確認が無い | 解除の予約 (26.2 は 0)。entityInside は予約が無いときだけ、そのエンティティ 1 体で判定する。フックの確認が 2 つ増える | §4.8・09 §6 |
| 入力 | 避雷針の onPlace | フラグ 18 で黙って消す | 8 gt の予約 | §4.8・09 |
| 入力 | 日照センサー | ゲーム時刻の式 | 環境属性から読む。ジ・エンドでも動く | 09 §6 |
| 入力 | トラップチェストの数 | プレイヤーだけ | ContainerUser (銅ゴーレムを含む) | 09 §6 |
| 入力 | 書見台の「本がある」の判定 | アイテムの種類 (本と羽根ペン・記入済みの本) | 本の中身の部品 (書きかけ・記入済み) の有無 | LecternBlockEntity#hasBook・09 §6 |
| スカルク | 振動 | bounce が無い | bounce (周波数 2)。周波数 0 を拒む | 10 §6 |
| 出力 | TNT | 常に着火 | ゲームルール tnt_explodes | 11・17 |
| 出力 | 音符ブロック | 銅は harp | 銅の 4 種は trumpet | 11 §6 |
| ディスペンサー | 振る舞いの選び方 | 既定つきの表 | 表 + 部品・タグで既定を選ぶ。頭・火打石・スポーンエッグの結果が違う | 12 §6 |
| コンテナ | 撤去の CU | Container の BlockEntity があれば | フラグ 1 か 64 の撤去なら必ず | 14 §6 |
| 流体 | 泡柱の 20 gt の持ち主 | ソウルサンド・マグマ | 水源ブロック | §4.8・16 §6.1 |
| 流体 | 流水の書き込み | フラグ 2 (SU が先) | フラグ 3 (NC が先) | 16 §6.2 |
| 流体 | 横へ広がるときの確かめ直し | 行き先ごとに、その時点の状態で canSpreadTo を見直してから書く | 見直さない。getSpread で決めた行き先へそのまま spreadTo する。前の行き先への書き込みの更新で次の行き先が変わっても書く | FlowingFluid#spreadToSides・16 §6 |
| エンティティ | 作用の時機・跳ね返り・抵抗・矢・爆発 | — | 細部が変わった | 17 §6.1 |
| tick ループ | プレイヤーのパケットの位相・昼夜の時計・ランダム tick の対象と順・落雷 | — | 変わった | 01 §6.2 |
| 予約 | 保存時の並び | 内部のヒープの順 | 予約順 | 02 §6.1 |
| 決定性 | Mth の sin と cos | 単精度の乗数・int へ切り捨て | 倍精度・long へ切り捨て | 18 §6.2 |

### 6.2 26.2 → 26.3 (挙動に効くもの)

| 点 | 26.2 | 26.3 | 典拠 | 効き |
|---|---|---|---|---|
| トリップワイヤーの解除 | 遅延 0 の予約 | 遅延 1 の予約 | TripWireBlock#checkPressed | 発火の tick は同じ。期限切れ扱いが消える (→ 02) |
| 流体が押し流すブロック | 動きを止めないブロック (ドア・看板・はしご・サトウキビ・泡柱・ポータル類・structure_void を除く) | タグ washed_away_by_fluids の列挙 | FlowingFluid#canHoldAnyFluid | 26.2 にもあるブロックでは結果が一致すると読める (ケーキ・カメの卵は止める側、エンドロッド・雪の層は流される側で両版同じ)。違うのは新しい straw_bed だけ (16 §6.3。全件の照合は 16 §8 P-5 で要実機)。レッドストーンの部品はどちらも流される |
| 流れの向きを止める・窒息 | blocksMotion | タグ blocks_fluid_flow・causes_suffocation | FlowingFluid#getFlow・BlockBehaviour の isSuffocating | 回路には効かない |
| 検知レールの再判定 | 生存できるかだけ | その位置がまだ検知レールかも見る | DetectorRailBlock#checkPressed | 置き換わった直後の書き戻しが無くなる (→ 15 §6.4) |
| スライムで弾く対象 | サーバーのプレイヤー以外 | 動きをシミュレートできるエンティティ | PistonMovingBlockEntity の押し出し | → 17 |
| TNT の着火 | アドベンチャーの確認なし | 道具がその TNT を壊せるかを見る | TntBlock#prime | → 11・17 |
| エンティティの跳ね返り・段差 | 落下の速さが重力以上で跳ねる | 重力より大きいときだけ。段差の分だけ当たりを広げる | 17 §6.2 の読み | スライムとベッドの上で止まったものが毎 tick 跳ねなくなった (→ 17) |
| 押し反応 | 名前 NORMAL ほか。黒曜石 4 種は名指し | 名前 PUSH_PULL ほか。黒曜石 4 種は IMMOVEABLE | PistonBaseBlock#isPushable・Blocks | ピストンの結果は同じ (§3.3・§3.4) |
| ダストの接続判定 | ダストのクラスがリピーター・オブザーバーを名指し | 各ブロックのフック shouldRedstoneWireConnectTo (上書きはダスト・リピーター・オブザーバーだけ。既定は「信号源で向きがある」) | RedstoneWireBlock#shouldConnectTo・BlockBehaviour | 結果は同じ (→ 06) |
| 塀の固体扱い | resin_brick_wall だけ forceSolidOn が無い | 全部の塀に有る | Blocks | → 05 |
| 氷と雪の層が溶ける | ゲームイベントなし | block_destroy を出す | IceBlock#melt・SnowLayerBlock | → 10 |
| コンポスターの乱数 | 確率の表 | 部品の段数。引き方が違う | ComposterBlock | → 14・18 |
| tick step (凍結していない) | 失敗の報告 | コマンドのエラー | TickCommand | ハーネスの応答の読み方だけ |

### 6.3 26.3 → 26.4-pre-1 [版差 26.4-pre-1]

| 点 | 26.3 | 26.4-pre-1 | 典拠 | 効き |
|---|---|---|---|---|
| 流体が部品を壊す | 落とし物を出してから流体を 1 回書く (溶岩は落とし物なし) | destroyBlock (空気・落とし物・壊す演出・BLOCK_DESTROY) のあと流体を書く。書き込みが 2 回 | FlowingFluid#spreadTo | 溶岩でも落とし物。NC と SU が 2 回ずつ。スカルクセンサーが反応する (→ 16 §6.4・10) |
| 流体の種類 | 水源と流水が別 (5 種) | water・lava・empty の 3 種。SOURCE と LEVEL を持つ | FlowingFluid | 予約の種類が変わる (→ 16 §6.4) |
| 水と青氷 | 何も起きない | 水平の隣に青氷があると水が brittle_ice になる | LiquidBlock | → 16 |
| 氷が溶ける | BLOCK_DESTROY は水に替えた後。蒸発するときは出さない | 先に出す。蒸発でも出す | IceBlock#melt | → 10 |
| ジュークボックス | — | プレイリスト。PLAYLIST_MODE を NC (フラグ 2 で書く) と SU で見直す。円盤が無くても ticker | JukeboxBlock・JukeboxBlockEntity | → 09・14 |
| ディスペンサー・ドロッパー | 振る舞いの表 | アイテムの部品 DISPENSE_BEHAVIOR の列。ドロッパーの空打ちが BLOCK_ACTIVATE を出す。火打石の失敗 | DispenserBlock#dispenseFrom | → 12 §6.1 |
| 書見台のページ | 0 ページで −1 になりうる | 0 に収める | LecternBlockEntity | 出力は変わらない (→ 09・14) |
| Mth の sin と cos | 切り捨て | 0.5 を足す。負の角度を対称に扱う | Mth | 日照センサーの境目 [要実機] (→ 18 §6.3)。置く向きの候補の順 (ちょうどの角度。レバー・トーチ・ピストン・オブザーバー・ディスペンサー。→ 09 §4.1) |
| パケット処理中の例外 | ログを出して続ける (切断しない)。原因がメモリ不足のときだけサーバーが止まる | ログと記録のあと、プレイヤーを切断して続ける。ServerPacketListener は無くなった | ServerCommonPacketListenerImpl#onPacketError・PacketProcessor | → 18 §6.5 |
| 火打石・ファイヤーチャージで TNT を点ける | 着火の音だけ | アイテムの使用音も鳴らす。音程に主乱数を使う (火打石は nextFloat を 1 回、ファイヤーチャージは 2 回) | TntBlock#useItemOn・FlintAndSteelItem#playSound・FireChargeItem#playSound | 主乱数の列がずれる (→ 11・18) |
| デバッグワールド | 各所で分岐 | 起動時に凍結。分岐が消えた | Level・ServerLevel・LevelChunk・SetBlockCommand | 普通の世界には効かない |
| tick の後半 | — | entityTracking の区間が増えた | ServerLevel#tick | 送信だけ (→ 01 §6.4) |
| 近い向きの計算 | 内積の初期値が最小の正の数 | 負の無限大 | Direction#getApproximateNearest | ゼロのベクトルで、26.3 は北、26.4-pre-1 は下を返す。ほかは同じ |
| 壁付きの変種 | 性質を個別に書く | 立っている方を丸ごと写す | Blocks#wallVariant | 押し反応は同じ (§3.4) |

ダスト・ダイオード・トーチ・オブザーバー・ピストン・レール・ホッパー・予約・近隣更新は、集合の作り方 (Guava → 標準。型と大きさは同じ)、クラッシュ報告とログの補助クラスの名前、Map.of (§5) だけが違う [26.3 読解: 各クラスを 26.4-pre-1 と比較]。

### 6.4 名前と書き方だけの差 (件数)

| 区間 | 件数 (網羅表の 251 クラス) | 主な中身 |
|---|---|---|
| 1.21.1 → 26.2 | ほぼ全部 | updateShape の引数 (8 個に)、neighborChanged の Orientation、entityInside の引数、getAnalogOutputSignal の向き、ownSignal の切り出し、InteractionResult の整理、形の定義の書き換え、DirectionProperty → EnumProperty、ResourceLocation → Identifier |
| 26.2 → 26.3 | 179 クラスが機械的な差だけ | ブロックの codec の削除 (ほぼ全ブロック)、setBlockAndUpdate、予約の位置の複製の削除、骨粉の引数 |
| 26.3 → 26.4-pre-1 | 48 クラスが機械的な差だけ。76 クラスも大半は同類 | Guava → 標準、Mth#clamp → Math#clamp、音の既定値、水浸しの判定の書き方 (水源の専用の判定)、getValueOrElse、経験値の共通化 |

### 6.5 監視クラス (watched-classes.txt) の欠落

- **26.3 で RedStoneWireBlock.java が無い** (RedstoneWireBlock.java へ改名)。26.4-pre-1 でも無い。ほかの 11 本は 4 版とも有る。
- spec-drift.sh の --check を 26.3 に向けると、DRIFT は 8 行になる (欠落 1 + 指紋の変化 7)。26.4-pre-1 に向けると 10 行 (欠落 1 + 9)。
- CI (spec-drift.yml) の既定の対象 latest は、Mojang の版の一覧の latest.release である。手元に取ってある一覧 (26.4-pre-1 の公開後のもの) では 26.3 (snapshot は 26.4-pre-1) なので、週次の --check は 26.3 との比較になり、上の 8 行で issue を起票する (同じ題の issue があれば飛ばす)。
- **--update 26.3 はこのままでは失敗する**。spec-drift.sh は監視クラスが見つからないとエラーで止まる。先に watched-classes.txt の行を RedstoneWireBlock.java に直す。
- fingerprints.json の基準は 26.2 のままである。典拠を 26.3 にするなら、改名を直してから 26.3 で取り直す。
- 版差の大半は監視 12 本の外にある (LevelChunk・Level・ServerLevel・SetBlockCommand・BlockInput・PistonBaseBlock・PistonMovingBlockEntity・DefaultRedstoneWireEvaluator・BaseRailBlock・TripWireBlock・LightningRodBlock・LiquidBlock・BubbleColumnBlock・FlowingFluid)。足す候補として §9.7 に書く。

### 6.6 既存 fixture の有効性 (26.3 の正解とみなせるか)

対象は生成済みの 150 本 (packages/sim/test/fixtures)。そのうち 134 本は定義 (tools/mc-harness/fixtures) がある。定義の無い 16 本は、キャプチャと最小化の出力 15 本と expect の無い 1 本である。全部 1.21.1 で撮った。

判定の決め方:

1. **そのまま使える**: fixture が通る部品と入力の経路に、挙動に効く版差が無い。あっても、その fixture の配置では更新の並びが変わらないと読める。
2. **要確認**: tick の中の更新の順か回数だけが違う。状態の系列は同じ見込みだが確かめていない。26.3 で撮って比べるまでは状態の系列だけを比べ、tick の中の順の根拠には使わない。
3. **撮り直しが要る**: 版で変わった規則 (§2.2) に当たるか、版で変わった経路そのものが fixture の主題である。状態が同じ見込みでも 26.3 の正解の根拠にしない。今の 150 本で規則の差に当たるものは無い。

| 群 | fixture | 部品と入力 | 当たる版差 | 判定 |
|---|---|---|---|---|
| A1 | attenuation-15-16, comparator-compare, comparator-nc-own-tick, comparator-side-redstone-block, comparator-side-reject, comparator-side-retime, comparator-subtract, dust-block-repeater, dust-cross-powering, dust-line-powering, dust-weak-source-mix, instant-wire, lamp-off-delay, lever-wire-lamp, pulse-2gt-repeater-d2, pulse-gen, redstone-block-static, repeater-chain-off, repeater-delay-1〜4, repeater-lock, repeater-lock-memory, repeater-nc-own-tick, repeater-pulse-train-101, short-pulse-repeater, stone-button, torch-chain-2 (29 本) | ダスト・ダイオード・ランプ・レバー・ボタン。use 入力。トーチがあるものも切り替わらない | 無し (既定の評価器・ダイオード・レバーとボタンの順は 4 版で同じ。06・07・09) | そのまま使える |
| A2 | comparator-compare-front-nc, comparator-through-conductor-replace, crafter-trigger, door-desync, door-redstone, dust-reshape-stale-target, hopper-mixed-transfer, nonconductor-glass-slab, repeater-self-off-priority, strong-charge-through-conductors, trapdoor-redstone, wire-cut-conductor, wire-cut-conductor-power, barrel-chest-conductor, shulker-box-conductor, lever-support-break (skip), observer-4tick-clock, observer-mutual-clock-setblock, wall-post-cascade, qc-noteblock-strong, piston-order-dust-locational, piston-order-dust-trigger, observer-carried-pulse-widths, observer-dropper-conductor, observer-pull-pulse, pane-shape-observer, bubble-column-cut (27 本) | setblock 入力 | /setblock の手順 (§4.3)。ただし置き換え前が空気・石・ガラス・レッドストーンブロック・泡柱 (撤去フックが無い) か、同じ種類のレバー (1.21.1 でも種類を見て何もしない)。後始末の CU が増えるのはアナログ出力のブロック (チェスト・ホッパー・ドロッパーなど) を置くときだけで、その fixture (wire-cut-conductor) にはコンパレーターが無い。オブザーバーを消す 2 本は最後の tick の後片付けで、消した後の状態はどちらの版も空気だけ。レバーの上書きのあとにハーネスが出す支えの周りの更新 (scarpet の update) は 26.3 の carpet でも同じかを移行で確かめる (→ docs/research/18 §2.2) | そのまま使える |
| A3 | piston-basic, piston-limit-12, piston-push-glazed, piston-push-obsidian, piston-transit-nc, qc-bud, sticky-pull, sticky-observer-pulse, observer-piston, observer-piston-pulse, observer-pushed, observer-pulled, rblock-piston-chain, two-piston-locational, slime-beside-glazed, slime-beside-obsidian, slime-pull-sticky, slime-push-branch, flying-machine, flying-machine-honey-bud, flying-machine-honey-flat, dynamic-connect-push, dynamic-step-cut, door-5x5-kurigohan, door-5x5-kurigohan-open, lever-nc-before-shape-race, button-nc-before-shape-race (27 本) | ピストン (壊すセルなし)。エンティティなし。最後の 2 本はレバーとボタンの更新の順で取り合いを決める | フラグ値の 256 (ピストン自身の経路では差が出ない)・黒曜石の IMMOVEABLE (結果は同じ)・HashMap と HashSet の順 (4 版で同じ。18 §6.7) | そのまま使える |
| A4 | observer-chain, observer-comparator-swallow, observer-detects-dust, copper-bulb-output, copper-bulb-toggle, elevator-observer-min, trapdoor-desync (7 本) | オブザーバー・銅の電球・トラップドア | 無し (08・11) | そのまま使える |
| A5 | hopper-clock, hopper-2clock, hopper-lock, hopper-mixed-stacks, dropper-insert, dispenser-no-insert, barrel-comparator-input (7 本) | ホッパー・ドロッパー・ディスペンサー。item 入力 | 無し (転送と信号の式は同じ。12・14) | そのまま使える |
| A6 | activator-rail-chain, activator-rail-mixed-chain, powered-rail-chain, powered-rail-observer, powered-rail-priority, powered-rail-slope, powered-rail-slope-update, powered-rail-bud, powered-rail-step, powered-rail-step-place, rail-curve-no-slope, rail-curve-priority, rail-junction-gate, rail-junction-nonsignal, rail-junction-place, rail-junction-toggle, rail-mixed-neighbor-shape, rail-shape-update, rail-piston-push, rail-piston-push-connect, rail-piston-push-powered, rail-support-break (skip), rail-slope-support-break (skip), powered-rail-flat-step-build, powered-rail-flat-step-live, rail-shape-chain-join (26 本) | レール。use と setblock 入力 | 撤去フック (フラグ 3 では §4.5 の例外で同じ)。最後の 3 本は /setblock でレールを消すので撤去の位置が SU の後へ移るが、周りはレール・石・レバーだけで SU に反応しないため、NC の並びは 2 版で同じになる | そのまま使える |
| A7 | detector-rail-cart-pulse, detector-rail-comparator, detector-rail-cart-stay (skip), wire-connect-detector-rail-lectern (4 本) | 召喚したトロッコ | entityInside の経路 (§4.7)。止まったトロッコは両版で次の step に検知する (17 §6.4)。書見台の後始末の CU は届く先のコンパレーターが無い | そのまま使える |
| A8 | bubble-column-refill, bubble-column-refill-fast (2 本) | 泡柱と流れる水。setblock で水源を抜き差し | 読み直すと、版差の経路を通らない。(1) 流水の水位が変わる書き込み (FlowingFluid#tick の書き直し) は起きない。落ちてくる水は真上の水源から毎回量 8 に決まるので、§4.8 のフラグの差は出ない。(2) ソウルサンドの真上は終始泡柱のままで、20 gt の予約はどちらの版でも積まれない (1.21.1 はソウルサンドの上が水になったとき、26.3 は水源の真下がソウルサンドのときに積む)。(3) 柱を戻す 5 gt の経路 (BubbleColumnBlock#updateShape・#tick) と泡柱の撤去 (フックなし) は 4 版で同じ。横の広がりは周りがガラスで起きない [26.3 読解。1.21.1 と比較] | そのまま使える |
| B1 (高) | door-2wide-open-to-close, dropper-into-hopper-cooldown, observer-carried-powered-landing, piston-land-front-land, piston-land-front-observer-away, piston-land-front-observer-facing-mover, piston-land-front-stone (7 本) | トーチの切り替えとピストン・オブザーバー | トーチの 2 段送信の回数 (§4.4)。距離 2 にピストンなど NC に反応する部品がある | 要確認 (先に撮る) |
| B1 (低) | torch-burnout, torch-burnout-recovery, torch-clock, torch-nc-own-tick, torch-not-floor, rs-torch-latch, repeater-clock, target-conduct (8 本) | トーチ・ダスト・ランプ・リピーター | 同上。距離 2 にいるのは、NC で予約を積む部品 (トーチ・リピーター・コンパレーター。重複は捨てられる) と、NC ですぐ書き換わる部品 (ダスト・ランプの点灯) だけで、ピストンのように更新の回数で動きが変わる部品が無い | 要確認 |
| B2 | pressure-plate-stone, pressure-plate-wood (2 本) | fake player の step 入力 (stone はトーチも) | entityInside の経路とプレイヤーの作用の位相 (§4.7・17 §6.4) | 要確認 |
| B3 | wire-step-nonconductor-down (1 本) | setblock でダストを消す | ダストの撤去 (36 件の NC・電力・隣のダスト) が 1.21.1 は SU の前、26.3 は SU の後。SU でダストの形が変わるので、順が状態に出る余地がある (06 §6) | 要確認 |
| C | destroy-push-dust, destroy-push-torch (2 本) | ピストンがダストとトーチを壊す | 壊すセルの撤去の時点 (§4.6) が主題そのもの | 撮り直しが要る |
| — | network-piston-be-order | expect の無い placeholder | — | 対象外 |

集計: そのまま使える 129 本、要確認 18 本、撮り直しが要る 2 本、対象外 1 本。
泡柱の 2 本 (A8) は、初めの判定では「流水の書き込みのフラグ」を理由に要確認としていた。この 2 本の中でその書き込みが起きないことを確かめたので、そのまま使える側へ移した。

- **明記したプロパティ**: setblock 入力 177 件のうち 81 件が状態を明記している (レバー・レール・オブザーバー・水・コンテナ・音符ブロックなど)。どれも周りに合わせて直しても同じ状態になるので、§4.3 の上書きの差は結果に出ない。
  音符ブロックは wire-cut-conductor の 1 件で、上が空気・下がダストなので、直した楽器も明記と同じ harp になる。
- **BlockEntity のデータ**: setblock 入力にデータ (中身) を付けたものは 1 件も無い。26.3 の BlockInput#place の setChanged の CU (§4.3) はどの fixture でも出ない。
- **予約の並び**: キャプチャの fixture のうち scheduled を持つのは 2 本で、どちらも 1 件だけである。1.21.1 の保存の並び (ヒープの順。02 §6.1) で同点の順が入れ替わる心配は無い。
- **ID とプロパティ名**: fixture に出る 66 種の ID とレッドストーン系のプロパティ名は 26.3 でも同じである (→ 05 §6・docs/research/18 §1.2)。
- **26.4-pre-1 で**: 判定は 26.3 と同じ。ただし A8 と bubble-column-cut は流体の作り替え (§6.3) に当たるので、26.4 を典拠にするときは撮り直す。
- **撮り直しの順**: C → B1 (高) → B3・B2 → B1 (低)。08 §6.3 はトーチの fixture 全体を優先とする。ここでは、距離 2 に NC で動く部品があって差の出る余地が大きい 7 本を先にした。あわせて A 群から数本を対照に撮り、26.3 の採取系そのものを確かめる (§8 V-10)。手順は → docs/research/18 §8。

---

## 7. Rust で実装するときの要点

1. **既定は 26.3**。フラグは数値のまま持つ (1〜512、組み合わせの 260・276・324・340・816・818)。撤去フックは「種類の変化かレール」×「フラグ 1 か 64」、設置フックは 512 で止める (§4.1)。
2. **版の切り替え点を 1 か所の表にまとめる**。版ごとに分岐が要るのは次の所だけである。中身は各メモが持つ。

   | 切り替え点 | 1.21.1 | 26.3 | 担当 |
   |---|---|---|---|
   | 撤去フックの条件と BlockEntity の副作用 | 必ず呼ぶ | 条件つき | 04 |
   | 設置フックのフラグ 512 | 無い | 有る | 04 |
   | /setblock の手順 | §4.3 の 1.21.1 | §4.3 の 26.3 | 04 |
   | トーチの撤去フック | 種類を見ない | 種類が変わったときだけ | 08 |
   | ピストンが壊すセルの撤去 | 書き込みの中 | 手順の後半 | 13 |
   | トリップワイヤー・避雷針の予約 | §4.8 | §4.8 | 09 |
   | 泡柱の持ち主・流水のフラグ・横の広がりの確かめ直し・洗い流しの判定 | §4.8・§6.1・§6.2 | §4.8・§6.1・§6.2 | 16 |
   | entityInside の経路 | 最終位置 | 経路 | 17 |
   | ブロックの性質表 (導体・押し反応・ブロックの有無) | 1.21.1 の表 | 26.3 の表 | 05 |

   1.21.1 を実装する必要は無い。分岐の表を持つのは、1.21.1 の fixture がどこで 26.3 と違うかを機械的に説明するためである。
3. **/setblock をエンジンの API として持つ**。fixture の setblock 入力を再生するのに要る。手順は §4.3 の 26.3 (置く → SU → データで中身が変われば setChanged の CU → 撤去フック → NC → CU)。strict も持つ (strict でもデータの setChanged の CU は出る)。
4. **fixture は版で分ける**。mcVersion を見て期待値を選ぶ。26.3 の採取ができるまで、Rust の適合テストは §6.6 の「そのまま使える」群を使ってよい。「要確認」群は状態の系列だけを比べ、tick の中の順は比べない。「撮り直しが要る」群は外す。
5. **ブロックの性質表は版ごとに生成する** (→ 05)。押し反応は 26.3 の名前で持ち、序数に頼らない。
6. **反復の順は固定する**。26.4-pre-1 の Map.of のように順が決まらない所は、Rust では向きの順を決めて持つ。HashSet と HashMap の順を写す所は → 18。
7. **26.4 は追わない**。§6.3 を「次の版で読み直す所」として残す。正式版が出たら、この表の行だけを読み直せば足りる。
8. 典拠の版を変えるときは、指紋 (§6.5) の更新と同じ変更に入れる。

---

## 8. 検証用のプローブ回路案

版差を確かめる回路だけを挙げる。どれも 1.21.1 と 26.3 の両方で撮り、差を見る。

| 名前 | 目的 | 配置と入力 | 観測と期待 |
|---|---|---|---|
| V-1 setblock-cu-through-conductor | /setblock の後始末の CU (§4.3) | コンパレーターの入力側に石、その向こう (コンパレーターから 2 マス) に空気の位置 X。コンパレーターの出力先にランプ。t2 に X へ中身入りのチェストを /setblock (BlockEntity のデータで中身を指定)。対照: 石の位置に直接チェストを置く列 | 26.3: t2 にコンパレーターが CU を 2 回受ける (BlockInput#place の setChanged と後始末)。予約は 1 本にまとまり、2 gt 後に点く。1.21.1: 点かない (NC は X の 6 隣にしか届かず、CU も setChanged も無い)。対照はどちらも点く。26.3 だけの追加の列: 同じ配置へ strict で置く。後始末は無いが setChanged の CU で点く見込み [要実機] |
| V-2 setblock-same-powered-rail | 同じ種類の上書き (§4.5) | 石の上に電源の無いパワードレール。t2 に powered=true を明記して /setblock。t6 に隣へ石を置く | 1.21.1: t2 の dump で powered=false。26.3: t2〜t5 は powered=true のまま、t6 の NC で偽になる (15 §8 P4 と同じ) |
| V-3 setblock-removal-order | /setblock の撤去の位置 | → 04 §8 P8・07 §6.1・08 §8 P-9 | 撤去の NC が SU の前 (1.21.1) か後 (26.3) か |
| V-4 torch-toggle-nc-count | 2 段送信の回数 (§4.4) | → 04 §8 P4・08 §8 P-2。状態では区別しにくいので、更新の列を撮れる採取系で数える | 距離 2 の位置への NC が切り替え 1 回につき 1 回 (26.3)・2 回 (1.21.1) |
| V-5 piston-destroy-hook-timing | 壊すセルの撤去の時点 (§4.6) | → 13 §8 P1 | 26.3 は moving_piston を置いた後に撤去の更新が出る |
| V-6 tripwire-release | 解除の遅延 | → 02 §8 P12・09 §8 tripwire-release-cooldown・17 §8 P4 | 26.3 は解除の次の tick。1.21.1 は予約が無い |
| V-7 lightning-rod-setblock | 避雷針の onPlace | → 09 §8 lightning-rod-setblock-pulse | 1.21.1: 置いた tick に powered=false (黙って消える)。26.3: 8 gt 後に消え、そのとき周りへ NC |
| V-8 bubble-column-owner | 泡柱の 20 gt の持ち主と流水の順 | → 16 §8 P-7・P-12 | ソウルサンドをマグマへ替えた後の柱の向きと tick |
| V-9 fluid-washing-26.4 | 26.4-pre-1 の洗い流し | → 16 §8 P-14 | 26.4-pre-1: 溶岩でも落とし物、センサーが反応 |
| V-10 harness-control | 26.3 の採取系そのものの確認 | A 群から lever-wire-lamp・repeater-delay-1・comparator-compare・piston-basic・observer-chain・hopper-clock を 26.3 で撮る。repeater-nc-own-tick・comparator-nc-own-tick・observer-4tick-clock も足して 02 §8 P2・P3 の確認を兼ねる | 1.21.1 の expect と全 tick で一致する。一致しなければ採取系か、まだ知らない版差を疑う |

---

## 9. 既存資料との食い違い

コードと資料は変えない。判断と根拠だけを書く。

### 9.1 CONTRIBUTING.md「対象バージョン方針」

- 「1.21.2+ のワイヤ更新順刷新は experimental flag 付きで、既定挙動は 26.2 現在も 1.21.1 と同一 … よって 1.21.1 準拠の実装は最新版の既定挙動とも互換」とある。
- 前半 (ダストの既定の評価器) は 26.3 でも正しい (→ 06)。**後半の一般化は誤り**である。§6.1 のとおり、撤去フック・/setblock・トーチ・ピストン・エンティティ・泡柱・流水・トリップワイヤー・避雷針・TNT で既定の挙動が違う (docs/research/16 §3.4 も同じ指摘)。
- 「仕様の典拠は 1.21.1」は TS エンジンについては今も事実である。Rust エンジンの典拠は 26.3 になるので、版の方針を 2 本立てに書き分ける必要がある。
- 「実機検証ハーネスは 1.21.x 系で」も、26.3 の採取を始めたら書き換える (→ docs/research/18)。

### 9.2 docs/research/02_behavior-spec.md

- 冒頭の凡例 (02:5・02:10) は「断りがなければ 1.21.1 と 26.2 の両方で一致確認済み」とする。次の行は 1.21.1 にしか当てはまらない。
  - 02:168「サーバ側は state 変化のたびに旧 state onRemove / 新 state onPlace が呼ばれる」。26.2 以降は §4.1 の条件つきで、名前も affectNeighborsAfterRemoval。
  - 02:180 のトーチ「LIT 変化ごとに両方呼ばれる」。26.2 以降は onPlace だけ (§4.4)。docs/research/16 §3.4 の指摘のとおり。
  - 02:509 のオブザーバー「除去時は前方へ消灯通知 (onRemove)」。中身は同じだが、フックの名前と呼ばれる条件が 26.x では違う。
- 判断: 26.3 の読みが正しい。02 の該当行に [版差 1.21.1] を付けるのが妥当である。

### 9.3 docs/research/04_gap-and-plan.md

- 04:91 は 26.x を「実機検証 mod がほぼ皆無」とする。26.3 用の fabric-carpet と carpet-tis-addition がある (→ docs/research/18 §2.1)。もう当てはまらない。
- 同じ行の「既定挙動は 26.2 現在も 1.21.1 と同一」は §9.1 と同じ一般化の誤り。

### 9.4 docs/research/07_mojira-fixtures.md

- 07:34・07:154・07:160 は MC-231071 (重複した更新) を「02 §4.2 の 2 段送信として 26.2 デコンパイルで確認済」「26.2 で健在」とする。
- 26.2 以降、**トーチの重複は無くなった** (撤去フックが種類の変化だけになったため。§4.4)。**レールの重複は残る** (撤去フックがレールでは同じ種類でも走り、さらに自分の NC と PoweredRailBlock#updateState の NC が重なる。§4.5)。
- レバー・ボタン・コンパレーターの撤去フックは 1.21.1 でも種類を見るので、撤去フック由来の重複はもともと無い。レバーとボタンの「書き込みの NC と updateNeighbours が自分の 6 隣へ 2 回届く」重複は 4 版とも同じに残る (→ 09)。
- 判断: 「26.2 で確認済」はトーチについては誤り。レールについては正しい。

### 9.5 docs/research/16_nucleation-comparison.md §3.4

- §3.4 の箇条は 5 つある。レッドストーンに関わる 4 つ (トーチ・ピストンが壊すブロック・フラグ 512 と 256・鎖の ID) は、26.3 でも 26.2 と同じに成り立つ [26.3 読解]。鎖の ID は 26.3・26.4-pre-1 とも iron_chain である。
- 残る 1 つ (エンティティの Motion の読み込み) は範囲外である。26.3 の Entity#load の Motion の読み方は 26.2 と同じ (Vec3 の codec で読み、成分の絶対値が 10 を超えれば 0 にする) で、この点の 26.2 → 26.3 の差は無い [26.3 読解: Entity#load・Vec3 の codec を 26.2 と比較]。
- 一点だけ補う。「26.2 の LevelChunk#setBlockState は、ブロックの種類が変わったときしか撤去処理を呼ばない」は正確には「種類が変わった、または新しいブロックがレール」かつ「フラグ 1 か 64」である (§4.1)。トーチの結論は変わらない。

### 9.6 docs/research/18_ground-truth-oracle.md §8

- 版差の表 (/setblock の後始末・トーチ・ピストンが壊すブロック・フラグ 1 の無い書き込み・鎖) は、このメモの §4 と一致する。後始末の CU (アナログ出力があれば) も 18 §8 の表に既にある。
- 足すもの: データ付きの /setblock で BlockInput#place の setChanged が出す CU (strict でも出る。§4.3)、明記したプロパティの上書き (§4.3)、同じ種類の上書きでレールの撤去フックが走らないこと (§4.5)。fixture ごとの判定は §6.6 を使う。
- 18 §8 の「影響しうる fixture」は「setblock 入力 177 件のうち、部品を消す・置き換えるもの」とする。§6.6 で 1 本ずつ見ると、撤去フックが SU の前後どちらでも結果が同じと読めないのは wire-step-nonconductor-down (B3) だけである。

### 9.7 tools/decompile (watched-classes.txt・fingerprints.json・README.md・spec-drift.yml)

- watched-classes.txt の RedStoneWireBlock.java は 26.3 で無い (§6.5)。RedstoneWireBlock.java に直さない限り、--update 26.3 は止まる。
- README.md の「主な読解対象クラス」も RedStoneWireBlock と書く。26.3 の名前を併記するのが妥当である。
- 監視を足す候補: Level・LevelChunk・ServerLevel・SetBlockCommand・BlockInput・PistonBaseBlock・PistonMovingBlockEntity・DefaultRedstoneWireEvaluator・BaseRailBlock・TripWireBlock・LightningRodBlock・LiquidBlock・BubbleColumnBlock・FlowingFluid。今回の挙動の差は、ほとんどがこの中で起きた。
- 指紋は文字の差を拾うので、26.2 → 26.3 の codec の削除のような機械的な差でも DRIFT になる。差の判定には、§1.3 の正規化で残りを見る手順を足すとよい。
- CI (spec-drift.yml) は Java 21 で 26.x の jar をデコンパイルする。手元は Java 25 で作った。同じ版の自己照合が通るかで環境差を確かめる設計なので、26.3 へ基準を移すときも自己照合を見る。

### 9.8 tools/mc-harness の README.md と runner/generate.ts

- README の入力の表と generate.ts の setblock の注釈は「/setblock は flag 2|256 で置く … 近隣更新は updateNeighboursOnBlockSet の 6 方向のみ」とし、典拠を 26.2 とする。
- ハーネスが動くのは 1.21.1 である。1.21.1 の /setblock はフラグ 2 で、後始末は blockUpdated の 6 方向だけ。**ただし書き込みの中で古い状態の onRemove が必ず走る**ので、ダスト・トーチ・レール・ダイオードなどを消すと 6 方向より多く届く (§4.3)。26.3 でも後始末で撤去フックと CU が出るので、「6 方向のみ」はどちらの版でも一般には成り立たない。
- generate.ts の「同じブロック種の上書きなら onPlace の再評価も走らない」も一般には誤り。1.21.1 の onPlace は毎回呼ばれ、種類を見るかはブロックしだいである (レールは見る。トーチは見ない)。
- 判断: 注釈を版ごとに書き分けるのが妥当。「本来ありえない状態を作れる」という結論 (BUD の検証用) は両版で正しい。
- generate.ts の item 入力の注釈は、典拠を「26.2 ItemCommands.setBlockItem」とする。26.3 では /item が server/commands/item のパッケージへ作り直され、setBlockItem は無い。26.3 の /item replace block は BlockItemAccessor → SlotCollection → Container#getSlot の SlotAccess → Container#setItem と進むので、最後に Container#setItem を呼ぶのは 1.21.1・26.2 と同じである。setChanged (CU) が出るかは各コンテナの setItem しだいで、それも版で同じ (BaseContainerBlockEntity#setItem は呼ぶ。HopperBlockEntity#setItem は呼ばない) [26.3 読解: ItemCommands・BlockItemAccessor・Container#getSlot・BaseContainerBlockEntity#setItem・HopperBlockEntity#setItem]。直すのは注釈の典拠だけでよい。ハーネスが送る構文 (container.N の指定) が 26.3 でも通るかは採取の移行で確かめる [要実機]。

### 9.9 packages/sim/src/world.ts (TS エンジン)

TS の典拠は 1.21.1 なので、ここに挙げる所は 1.21.1 として正しい。26.3 の挙動とは違う、という記録である。

| 箇所 | TS (1.21.1 の形) | 26.3 | 備考 |
|---|---|---|---|
| トーチの更新 (world.ts の torch の分岐) | 2 段送信を 2 回。起点は西・東・下・上・北・南の順 | 1 回。起点は下・上・北・南・西・東 | 起点の順は 1.21.1 とも違う (docs/research/16 R-21) |
| setBlockCommand の注釈 | フラグ 2 と 256、updateNeighboursOnBlockSet (26.2 の手順) と書く | — | 実装は 1.21.1 の観測に合わせて「置いた位置を再評価」している |
| setBlockCommand の「要追調査」 | 同種上書きでも powered が再計算される (実測 1.21.1) | 再計算されない | §4.5 で説明がつく。1.21.1 のレールの onRemove が真下の周りへ NC を出し、それが自分に届く。リピーターとランプも落ちたという観測は、この経路では説明できない。1.21.1 の読みで見つかるのは遅れて落ちる経路だけである: リピーターは DiodeBlock#onPlace の前方更新や後始末の NC で動いた周りのダストなどの NC が自分へ返れば、遅延のあとに消える。ランプも返ってくる NC で 4 gt 後に消える。「すぐ落ちる」経路は読みでは無い [要実機] |
| setBlockCommand の CU | 出さない | アナログ出力のブロックなら出す (データ付きなら setChanged の CU も) | §4.3 |
| ピストンが壊すセル | → 13 §9 | — | — |
| 泡柱 | 1.21.1 の実機 fixture に合わせた 5 gt のモデル | 持ち主が水源 | → 16 §9 |

### 9.10 docs/vanilla の他のメモの小さな補い

- 07 §6.2 の最後の行 (ComparatorBlockEntity の種類の参照が BlockEntityType から BlockEntityTypes へ) は 26.2 → 26.3 の差ではない。26.2 で既に BlockEntityTypes であり、ComparatorBlockEntity は 26.2 と 26.3 で同一である。1.21.1 → 26.2 の差として読むのが正しい。
- 08 §6.1 の着地の「壊れる場合」のフラグ (340)・moving_piston を置くフラグ (324)・/setblock のフラグ (2 と 256。strict は 2 と 816 で 818) は、このメモの §3.2 と一致する。食い違いは無い。
- 13 §6.3 の POPPED の数 (202。壁付きの変種の丸写しと新しい 3 ブロック) は、このメモの §3.4 と一致する。
- 09 §6 の表の「PushReaction の名前」の行は、26.2 の欄を POPPED・IMMOVEABLE とする。26.2 の名前はまだ 1.21.1 と同じ NORMAL・DESTROY・BLOCK・IGNORE・PUSH_ONLY で、改名は 26.3 である (§3.3)。09 の誤り [26.3 読解: PushReaction を 26.2 と比較]。
- 02 §6 は「1.21.1 のハーネスでトリップワイヤー・避雷針・泡柱を測った結果は 26.3 にそのまま当てはめられない」とする。予約の持ち主が違うので一般論としては正しい。ただし今の泡柱の 3 本 (bubble-column-cut と A8 の 2 本) は、持ち主の差の経路も流水の書き込みの差の経路も通らないので、そのまま使える (§6.6)。トリップワイヤーと避雷針の fixture は無い。
- 15 §6.6 は /setblock でレールを消す 3 本 (powered-rail-flat-step-build・powered-rail-flat-step-live・rail-shape-chain-join) を「順が効く回路では撮り直す」とする。3 本とも周りはレール・石・レバーだけで、SU に反応するブロックが無い。撤去フックが SU の前でも後でも NC の並びは同じになるので、そのまま使えると判断した (§6.6 の A6)。

---

## 10. 典拠一覧

- 26.3 LevelChunk#setBlockState
- 26.3 Level#setBlock・#destroyBlock・#updateNeighbourForOutputSignal
- 26.3 LevelWriter#setBlockAndUpdate・#setBlock
- 26.3 ServerLevel#updateNeighboursOnBlockSet・#tick
- 26.3 SetBlockCommand#setBlock
- 26.3 BlockInput#place・#overwriteWithDefinedProperties
- 26.3 Block の更新フラグの定数
- 26.3 BlockBehaviour#shouldRedstoneWireConnectTo・Properties の isSuffocating
- 26.3 Blocks の登録・Blocks#wallVariant
- 26.3 PushReaction
- 26.3 FeatureFlags
- 26.3 NeighborUpdater#executeShapeUpdate・#executeUpdate
- 26.3 CollectingNeighborUpdater
- 26.3 ScheduledTick の生成・ScheduledTickAccess#scheduleTick・LevelAccessor#createTick
- 26.3 RedstoneTorchBlock#onPlace・#notifyNeighbors・#affectNeighborsAfterRemoval
- 26.3 RedstoneWireBlock#shouldConnectTo・#shouldRedstoneWireConnectTo
- 26.3 RepeaterBlock#shouldRedstoneWireConnectTo・ObserverBlock#shouldRedstoneWireConnectTo・#onPlace・#affectNeighborsAfterRemoval
- 26.3 DiodeBlock#neighborChanged・ComparatorBlock#useWithoutItem
- 26.3 BaseRailBlock#affectNeighborsAfterRemoval・#onPlace・#updateState・#updateShape
- 26.3 DetectorRailBlock#checkPressed
- 26.3 PistonBaseBlock#triggerEvent・#isPushable・#moveBlocks
- 26.3 PistonMovingBlockEntity#tick・#finalTick・#preRemoveSideEffects
- 26.3 PoweredRailBlock#updateState
- 26.3 TripWireBlock#checkPressed
- 26.3 LightningRodBlock#onPlace
- 26.3 TntBlock#prime
- 26.3 LiquidBlock#onPlace・#neighborChanged・#updateShape・#tryScheduleBubbleBlockColumn
- 26.3 BubbleColumnBlock#updateShape・#tick・#updateColumn
- 26.3 FlowingFluid#canHoldAnyFluid・#spreadTo
- 26.3 IceBlock#melt
- 26.3 Containers#updateNeighboursAfterDestroy・BlockEntity#preRemoveSideEffects (JukeboxBlockEntity・LecternBlockEntity・SculkShriekerBlockEntity・ShulkerBoxBlockEntity の上書きを含む)・BlockEntity#setChanged
- 26.3 NeighborUpdater#executeShapeUpdate・ExperimentalRedstoneWireEvaluator (フラグ 128)
- 26.3 FlowingFluid#tick・#spread・#spreadToSides・#getNewLiquid
- 26.3 LecternBlockEntity#hasBook
- 26.3 ItemCommands (server/commands/item)・BlockItemAccessor・SlotCollection・Container#getSlot・BaseContainerBlockEntity#setItem・HopperBlockEntity#setItem
- 26.3 PacketProcessor・ServerCommonPacketListenerImpl#onPacketError・ServerPacketListener#onPacketError
- 26.3 Entity#applyEffectsFromBlocks・#load、Vec3 の codec
- 26.3 TickCommand
- 1.21.1 LevelChunk#setBlockState・Level#setBlock・ServerLevel#blockUpdated・SetBlockCommand#setBlock・BlockInput#place
- 1.21.1 RedstoneTorchBlock#onPlace・#onRemove、BaseRailBlock#onRemove・#onPlace、ObserverBlock#onPlace・#onRemove、DiodeBlock#onPlace・#onRemove、LightningRodBlock#onPlace、TripWireBlock#checkPressed、BubbleColumnBlock#updateShape・#tick、SoulSandBlock、MagmaBlock、FlowingFluid#tick、Containers#dropContentsOnDestroy、BlockEntity#loadWithComponents
- 1.21.1 PistonBaseBlock#moveBlocks、FlowingFluid#spread・#spreadToSides・#getNewLiquid、LecternBlockEntity#hasBook、BlockEntity#loadWithComponents・#setChanged
- 1.21.1 の onRemove を持つ 29 クラス (BlockBehaviour の既定を含む。種類の確認の有無を全部確かめた)
- 26.2 の上記クラスと Blocks (26.3 との比較)、ItemCommands#setBlockItem
- 26.4-pre-1 の上記クラスと FlowingFluid#spreadTo・LiquidBlock・IceBlock#melt・JukeboxBlock・JukeboxBlockEntity・DispenserBlock・Blocks#wallVariant・Direction#getApproximateNearest・RedstoneWireBlock と WallBlock の PROPERTY_BY_DIRECTION・LeavesBlock・TntBlock#useItemOn・FlintAndSteelItem#playSound・FireChargeItem#playSound・ServerCommonPacketListenerImpl#onPacketError
- 各版の version.json (javaVersion)
