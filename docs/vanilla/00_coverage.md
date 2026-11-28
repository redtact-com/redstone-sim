# 00. 網羅表 — 26.3 のクラスと担当メモ

docs/vanilla の 01〜19 が、Java 版 26.3 のレッドストーンに関わるクラスを取りこぼしていないかを調べた表である。
クラスごとに「どのメモに書いてあるか」か「なぜ対象外か」を示す。
初めの照合で見つけた抜けは、05・09・11・17 の付録で埋めた (§3)。状態欄は、その補充の後の値である。

**件数のまとめ (補充の後)**: 数えたクラスは 582 (hooks-26.3.tsv 251・エンジン側 161・TSV に無いブロック側 170)。記述済 511・抜け 0・対象外 71 (§2)。
初めの照合では 579 クラスで、記述済 387・抜け 114・対象外 78 だった。抜けは形状更新の族 F1・支えの族 F3・成長の族 F2 と、単独の 4 件 (G-1〜G-4) で、どれも付録に入った (§3)。

確かさの表記は 01〜19 と同じである。初めの照合の判定は、すべて 26.3 のコードを読んで確かめた ([26.3 読解])。
補充の後の状態は、担当欄に書いた付録の節がそのクラスを扱っていることを、1 クラスずつ読んで確かめて決めた。
典拠は §8 に挙げる。デコンパイルの写しは無い (docs/ip-policy.md)。

---

## 1. 対象と数え方

### 1.1 数えたクラス

| 出どころ | クラス数 | 中身 |
|---|---|---|
| A. hooks-26.3.tsv | 251 | world/level/block/ 配下で、レッドストーンに関わる 34 個のフックのどれかを宣言するクラス。直下 228・entity/ 18・piston/ 4・state/ 1 |
| B. エンジン側 | 161 | Level・ServerLevel・LevelChunk・NeighborUpdater 系・world/ticks・piston の残り・gameevent・コンテナ・core/dispenser・流体・乱数・エンティティ・コマンドのうち、判定に要ったもの |
| C. hooks-26.3.tsv に無いブロック側のクラス | 170 | 34 個のフックの外でレッドストーンに効くもの (DropperBlock の dispenseFrom、レールの updateState など)、族の子クラス、BlockEntity、プロパティ、対象外と決めた補助。初めの照合は 167 で、補充で 3 クラスを足した (§2) |
| 合計 | 582 | 初めの照合は 579 |

hooks-26.3.tsv は、26.3 のデコンパイルの world/level/block/ を走査し、次の 34 個のフック名のどれかを宣言するクラスを、親クラスと宣言したフックと一緒に書き出した表である。
neighborChanged・updateShape・getSignal・getDirectSignal・isSignalSource・hasAnalogOutputSignal・getAnalogOutputSignal・tick・randomTick・onPlace・affectNeighborsAfterRemoval・onRemove・triggerEvent・entityInside・stepOn・useWithoutItem・useItemOn・attack・onProjectileHit・getStateForPlacement・canSurvive・isRandomlyTicking・getTicker・onExplosionHit・fallOn・setPlacedBy・playerWillDestroy・destroy・spawnAfterBreak・updateIndirectNeighbourShapes・isPathfindable・getPistonPushReaction・canBeReplaced・onBlockStateChange。
名前だけで拾うので、この 34 個の外で効くクラス (例: DropperBlock・PoweredRailBlock・RailBlock・BlockEntity の多く) は入らない。それを C で補った。
初めの走査は、戻り値の型の前に注釈が付く宣言を拾えなかった。拾うと、34 個のどれかを宣言するのは 258 クラスになる。差の 7 クラスは C に置いたままである (§4.3)。

### 1.2 判定の手順

1. 各クラスの単純名を、語の境界つきで 01〜19 から探す (例: ChestBlock は TrappedChestBlock に当たらない)。
2. 当たった行を読み、挙動 (条件・順序・フラグ・遅延) の説明か、典拠や一覧に名前があるだけかを見分ける。日本語の名前やブロック ID だけで書かれた所も読んだ。
3. 当たらないクラスと名前だけのクラスは、26.3 のコードを読んで次の 7 つの観点で効くかを決めた: 信号を出す・読む / 予約 tick / ブロックイベント / オブザーバーに見える状態の変化 / アナログ出力 / ピストンでの扱い / 回路で使うエンティティ連携。
4. 同じ仕組みで動くクラスは族 (§1.4) にまとめ、族ごとに書いてあるかを決めた。
5. 導体かどうかと押し反応は、05 §4.4.2・§4.6.3 が状態ダンプで全ブロックを照合済みである。だから「性質だけが効くクラス」は、自前のフックが回路に効くかで決めた。
6. 補充の後: 05・09・11・17 の付録が扱うクラスを付録の節ごとに読み、規則が書かれている節を担当欄に書いた。抜けの行と、付録が規則を書いた対象外の行は記述済にした。付録が扱うのに表に無かったクラスは行を足した。

### 1.3 状態の意味

| 状態 | 意味 |
|---|---|
| 記述済 | そのクラスの回路に効く挙動が、担当メモに説明されている (名前だけの列挙は含めない) |
| 抜け | 回路に効く挙動があるのに、どのメモにも説明が無い。半分だけ書かれていても、効く側が無ければ抜けにした |
| 対象外 | 自前のフックが回路に効かない。理由を書いた。導体・押し反応は 05 の全表にある |

- 補充の後の表に「抜け」の行は無い。「抜け」の意味は、§3 の記録のために残す。
- 補充で状態や判定を変えた行は、備考にそう書いた。対象外から記述済へ移した 7 行 (§2)、F3 から外した GrindstoneBlock、補充で足した 3 行 (「補充で足した行」) である。
- 担当欄の「F1」〜「F6」は §1.4 の族の名前である。補充の後は、付録の節の後ろの括弧に族を書いた (例: 「05 付録 C.1 (F3: …)」)。

### 1.4 族

| 族 | 何が起きるか | どこに書いてあるか | 状態 | 主なメモ |
|---|---|---|---|---|
| F1 形状更新で接続・形が変わる | 形状更新 (SU) を受けて、隣に合わせて自分の blockstate を書き換える。書き換えは SU の結果なので、正面のオブザーバーが拾う。柱・板の列は 1 マスずつ連鎖する | SU の配り方と 512 段の上限は 04 §4.6・§4.7、オブザーバーが拾うことは 08 §4.2。各ブロックの接続と形の規則は 05 付録 B (補充) | 記述済 | 05 付録 A・B |
| F2 成長・時間・骨粉で状態が変わる | ランダム tick・予約 tick・骨粉で段が進み、ブロックを置く。自動収穫機のオブザーバーの入力になる | ランダム tick の抽選は 01 §4.5、骨粉を撒く側は 12 §4.9。各ブロックの成長の規則と骨粉の結果は 11 付録 F.0〜F.13 (補充) | 記述済 | 11 付録 F |
| F3 支えを失うと消える | SU のとき canSurvive が偽なら空気を返し、Block#updateOrDestroy が壊す。消えた書き込みが NC・SU を出す | 壊す仕組みは 04 §4.6、レッドストーン部品の支えは 05 §4.7.4。装飾・植物の存続の規則は 05 付録 C (補充)。支えを失っても消えないもの (壁掛けの吊り看板・植木鉢・砥石・ろうそく) は 05 付録 C.3 | 記述済 | 05 付録 A・C |
| F4 水を含むだけ | 自前のフックは「WATERLOGGED なら SU のたびに水を 5 gt で予約する」だけ | 02 §4.9 表 D にクラスの一覧、16 §4.11 に水の動き | 記述済 | 02・16 |
| F5 銅の酸化 | ランダム tick で次の段のブロックへ書き換える (ChangeOverTimeBlock#changeOverTime、フラグ 3) | 抽選の確率と近くの銅との比べ方は 14 §4.12、電球・ドアの引き継ぎは 11 §4.3・§4.8 | 記述済 | 11・14 |
| F6 画面・見た目・データだけ | 画面を開く・経験値を落とす・ゲームテスト用など。信号・予約・状態の書き込みが無い | — | 対象外 | — |

族の内訳 (担当欄にその族を書いた行の数。1 行が 2 つ以上の族に入ることがある):

| 族 | 補充の後の行数 | 記述済 | 抜け | 対象外 | 初めの照合 (行数 / 抜け) |
|---|---|---|---|---|---|
| F1 | 42 | 42 | 0 | 0 | 30 / 30 |
| F2 | 60 | 60 | 0 | 0 | 39 / 39 |
| F3 | 66 | 66 | 0 | 0 | 50 / 50 |
| F4 | 25 | 25 | 0 | 0 | 25 / 14 |
| F5 | 13 | 13 | 0 | 0 | 13 / 3 |
| F6 | 12 | 0 | 0 | 12 | 12 / 0 |

補充で行数が増えたのは、付録が 2 つ目の族 (例: 作物の支えの F3、骨粉の F2) と親子のクラスまで書いたので、担当欄にもそれを書いたためである。

---

## 2. 件数のまとめ

| 出どころ | 合計 | 記述済 | 抜け | 対象外 | 初めの照合 (合計 / 記述済 / 抜け / 対象外) |
|---|---|---|---|---|---|
| A. hooks-26.3.tsv | 251 | 220 | 0 | 31 | 251 / 144 / 75 / 32 |
| B. エンジン側 | 161 | 156 | 0 | 5 | 161 / 154 / 2 / 5 |
| C. TSV に無いブロック側 | 170 | 135 | 0 | 35 | 167 / 89 / 37 / 41 |
| 合計 | 582 | 511 | 0 | 71 | 579 / 387 / 114 / 78 |

補充で変わったもの:

1. 抜けの 114 行は、すべて記述済になった。入った先は 05 付録 (F1・F3)・11 付録 (F2・G-2)・09 付録 (G-1)・17 付録 (G-3・G-4) で、多くの行は 2 つの付録にまたがる。
2. 対象外の 7 行を記述済へ移した。付録がそのクラスの規則を書いたからである。A の WitherRoseBlock (支え。05 付録 C.1) と、C の SculkVeinBlock・MultifaceSpreadeableBlock・MyceliumBlock・NetherrackBlock・RootedDirtBlock・BonemealSource である。C の 6 行は、§6 の「対象外の補助・見た目・データ」の表から「形状更新・成長・支えの族の子」の表へ移した。
3. C に 3 行を足した。BaseCoralPlantBlock・BaseCoralFanBlock (死んだサンゴと扇。05 付録 C.1) と grower/TreeGrower (11 付録 F.7) である。どれも 34 個のフックを宣言しないので hooks-26.3.tsv に無く、初めの照合で数えていなかった。
4. 判定を 1 つ直した。GrindstoneBlock は F3 ではない (canSurvive が常に真。05 付録 C.3・付録 G の G-1)。

初めの照合から変わらないこと:

- hooks-26.3.tsv で信号のフックを持つ 19 クラス (05 §4.3。BlockBehaviour を足すと 20)・アナログ出力のフックを持つ 29 クラス (14 §4.10)・neighborChanged を持つ 26 クラス・triggerEvent を持つ 13 クラスは、すべて記述済である。
- scheduleTick を呼ぶ 89 クラスの遅延と条件は、すべて 02 §4.9 にある。族 F1・F2・F3 の抜けは、予約以外の側 (接続・成長・支えの規則) だった。
- 初めの照合の抜けは F1・F2・F3 の族と、単独の 4 件 (§3.1 の G-1〜G-4) に集まっていた。エンジン側の抜けはアレイ (G-4) だけだった。

---

## 3. 抜けと補充の結果

初めの照合で見つけた抜けと、それを埋めた付録の節である。補充した各付録の冒頭にも、どの抜けを埋めたかが書いてある。
「初めの照合で読んだ事実」の列は、照合の時点の記録として残す。入れる先は、既存のメモの参照の向き (どのメモが「→ NN」と書いていたか) と、そのメモの範囲に合わせて選んだ。

### 3.1 クラスの抜け (すべて補充済み)

| ID | 対象 | 初めの照合で読んだ事実 (何が無かったか) | 補充した所 | 補充で分かった訂正・残り |
|---|---|---|---|---|
| G-F1 | 形状更新で接続・形が変わる族 (F1): WallBlock・IronBarsBlock (板ガラス・鉄格子・銅の格子)・FenceBlock・StairBlock・ChorusPlantBlock・HugeMushroomBlock・MossyCarpetBlock・VineBlock・MultifaceBlock・SnowyBlock・AttachedStemBlock・CampfireBlock・LeavesBlock・GrowingPlantHeadBlock / BodyBlock・BambooStalkBlock | 塀は 4 辺 (none / low / tall) と柱 up を隣で決め直す。柱の判定は「真上が柱の立った塀なら必ず立つ」を最初に見る (WallBlock#shouldRaisePost)。だから上端の柱が変わると、下の塀が順に SU を受けて決め直し、柱の列が同じ連鎖の中で書き換わる。柵は同じ族の柵 (木製どうし・それ以外どうし)・向きの合うフェンスゲート・面が頑丈なブロックへつながり、板ガラスと鉄格子は同じ族・塀・面が頑丈なブロックへつながる。面が頑丈でもつながらない例外は葉・バリア・かぼちゃ・くり抜いたかぼちゃ・ジャック・オ・ランタン・スイカ・シュルカーボックスである (Block#isExceptionForConnection)。階段は前後の階段から shape を決める。葉は SU で 1 gt の予約を積み、tick で DISTANCE を書き直す。焚き火は真下が干し草の俵なら SIGNAL_FIRE。今の TS 実装は塀と板ガラスを 26.2 の読みで実装している (packages/sim/src/types.ts の StoneWallState・PaneState) が、26.3 のメモが無い | 05 付録 A (共通の流れとピストン)・付録 B.1〜B.17。連鎖の上限は 04 §4.7 | 規則は 1.21.1 から 26.4-pre-1 まで同じ (05 付録 D)。TS の典拠の 26.2 の読みはそのまま使える (O-4)。TS の塀・板の接続の食い違いは 05 付録 G の G-2〜G-6 |
| G-F3 | 支えを失うと消える族 (F3): VegetationBlock の子 (草花・作物・苗木)・CarpetBlock・BannerBlock・WallBannerBlock・StandingSignBlock・WallSignBlock・CeilingHangingSignBlock・LadderBlock・LanternBlock・SporeBlossomBlock・HangingRootsBlock・HangingMossBlock・SeaPickleBlock・DoublePlantBlock・SmallDripleafBlock・AmethystClusterBlock・サンゴの扇と植物・GrindstoneBlock・SoulFireBlock・ShelfMushroomBlock・LeafLitterBlock ほか | 各クラスの canSurvive が偽になると、SU の結果が空気になり壊れる。真下が空気になると消えるカーペット、取り付け先を見るはしご・旗・看板、吊りなら上・置きなら下を見るランタンなど、判定がクラスごとに違う。ピストンで支えを動かした時にどれが消えるかが決まらない。例外として、壁掛けの吊り看板 (WallHangingSignBlock) と植木鉢 (FlowerPotBlock) は canSurvive を上書きしないので、取り付け先や下が消えても残る。docs/research/13 は今の TS 実装で支えの要件を持たないと決めているので、Rust 版で持つかは別に決める | 05 付録 A・C.1〜C.4 (05 §4.7.4 の面の支えを全ブロックへ広げた) | GrindstoneBlock は消えない (canSurvive が常に真。05 付録 C.3・付録 G の G-1)。ろうそく (CandleBlock) も消えない。支えを失っても残るのは C.3 の 4 クラスになった。Rust 版で支えを持つかの材料は 05 付録 E.2 |
| G-F2 | 成長・時間・骨粉で状態が変わる族 (F2): CropBlock とその子・StemBlock・SugarCaneBlock・CactusBlock・BambooStalkBlock・BambooSaplingBlock・GrowingPlantHeadBlock の子 (昆布・ねじれ/しだれツタ・洞窟のつた)・SweetBerryBushBlock・NetherWartBlock・CocoaBlock・SaplingBlock・BuddingAmethystBlock・ChorusFlowerBlock・VineBlock・SpreadingSnowyBlock・NyliumBlock・MushroomBlock・FlowerPotBlock (アイブロッサム)・LeavesBlock (自然の落葉)・BonemealableBlock (骨粉の結果) ほか | ランダム tick で段が進む確率、上限の高さ (サトウキビ・サボテンの 3 段など)、実や芽を置く位置、骨粉の結果 (performBonemeal) が無い。01 §4.5 の表は作物を「→ 08 のオブザーバー」とし、12 §4.9 は骨粉の結果を「→ 11・16」とするが、どれにも無い。成長はランダム tick の乱数で決まるので、正解は分布として撮る | 11 付録 F.0〜F.13 (骨粉の結果の全表は F.12)。01 §1.2・§4.5 と 12 §4.9 の参照も直した (O-2) | 正解は分布で撮る (11 付録 F.16)。木・キノコ・菌の形 (地物) は §7 のとおり扱わない |
| G-1 | RedStoneOreBlock | 叩く (attack)・踏む (stepOn。静かに歩いていれば光らない)・右クリック (useItemOn) で、消えていれば LIT を真にしてフラグ 3 で書く。光っている間だけランダム tick を受け、LIT を偽に戻す (フラグ 3)。導体のまま光るだけで信号は出さない。オブザーバーでプレイヤーやモブを検知する回路に使う。01 §1.2 は「→ 11」、11 §1.2 は「→ 09 / 17」とし、17 §4.20 に踏むと光る 1 行があるだけ | 09 付録 A | 18 §4.6.4 の乱数の表に、鉱石が光るときの乱数の行が無い (09 付録 A.11) |
| G-2 | FireBlock (と BaseFireBlock の延焼側) | tick (30〜39 gt ごとの予約) で 6 隣を燃やす判定をする。燃えたマスは火 (フラグ 3) か空気になり、元のブロックが TNT なら、そのあとで TntBlock#prime が PrimedTnt を作る (FireBlock#checkBurnOut)。年齢の書き込みはフラグ 260、雨で消えるときは removeBlock。11 §4.7 の「その他の着火」に火の延焼が無い。02 §4.9 表 B は遅延だけを「範囲外」として載せる | 11 付録 F.14 (02 §4.9 表 B の参照も直した) | 周りの空気への飛び火もフラグ 3 で書く (11 付録 F.17) |
| G-3 | CarvedPumpkinBlock・WitherSkullBlock・WitherWallSkullBlock | 設置フック (かぼちゃ) と setPlacedBy (ウィザーの頭) が形を照合し、合えば形のブロックを全部フラグ 2 で空気にし、エンティティを出してから、各位置で近隣更新 (送り元は空気) を配る (CarvedPumpkinBlock#clearPatternBlocks・#updatePatternBlocks)。雪だるま・アイアンゴーレム・銅のゴーレム・ウィザーの 4 種で、銅のゴーレムはそのあと銅ブロックの位置に銅のチェストをフラグ 2 で置く。12 §4.6 はディスペンサーで置く条件だけを書く | 17 付録 A.1 | 置くかどうかは土台の形で決まる。12 §4.6 の書き方に補足が要る (17 付録 A.1.9) |
| G-4 | Allay・AllayAi | アレイは振動の聞き手で、NOTE_BLOCK_PLAY を受けるとその音符ブロックを覚え、600 gt の間その近くへアイテムを運ぶ。音符ブロックをレッドストーンで鳴らすアイテム仕分けに使う。10 §1.2 は「ウォーデン・アレイ → 17」とするが、17 に無い | 17 付録 A.2 | ウォーデンはどのメモも扱わない (17 付録 A.2.1)。10 §1.2 の参照にもそう書いた |

### 3.2 クラスにまたがる抜け・食い違い

| ID | 内容 | 状態 | 入れるメモ・直した所 |
|---|---|---|---|
| O-1 | かまど 3 種の BE の tick は、燃えているかが変わると LIT をフラグ 3 で書き、そのあと setChanged する (AbstractFurnaceBlockEntity#serverTick)。醸造台の BE の tick は、瓶の有無が変わると HAS_BOTTLE の 3 つをフラグ 2 で書く (BrewingStandBlockEntity#serverTick)。どちらもオブザーバーに見えるが、14 はアナログ値と CU しか書いていない | 未解決 (14 は補充していない) | 14 §4.10 |
| O-2 | 参照の行き止まり: 01 §4.5 の表 (作物の成長 → 08)、01 §1.2 と 11 §1.2 (redstone_ore → 11 → 09 / 17)、12 §4.9 (performBonemeal → 11・16)、10 §1.2 (アレイ → 17) の先に本文が無い。09 §1.2 (TestBlock → 00_coverage) と 01 §4.10 (コマンドブロック → 00_coverage) は 11 §4.13 で足りる | 解消 (仕上げ) | 直した参照: 01 §1.2 と §4.5 の表 (成長 → 11 付録 F、redstone_ore → 09 付録 A)、01 §4.10 (→ 11 §4.13)、02 §4.9 表 A・B (コマンドブロック → 11 §4.13、火 → 11 付録 F.14)、09 §1.2 (→ 11 §4.13)、10 §1.2 (アレイ → 17 付録 A.2)、11 §1.2 (鉱石 → 09 付録 A)、12 §4.9 (→ 11 付録 F.12)、17 §4.20 (鉱石 → 09 付録 A)、18 §4.6.4 の表 (作物・火 → 11 付録 F)、05 付録 C.4・E.3 と 11 付録 F.0 (付録どうしの参照)。あわせて、09 §2.2 の「02 §1.4」(docs/research/02 の節) を docs/research/02_behavior-spec.md §1.4 と書き直した |
| O-3 | hooks-26.3.tsv は 34 個のフック名だけで拾うので、updateState (レール)・dispenseFrom と getDispenseMethod (DropperBlock)・performBonemeal・BlockEntity の serverTick が入らない。網羅を機械で見直すときは、world/level/block 配下で scheduleTick・blockEvent・updateNeighbourForOutputSignal・setBlock を呼ぶクラスも数える (この表の C はそれで補った)。走査し直すときは、注釈 (@Nullable) つきの宣言も拾う。拾うと増える 7 クラスは、もう C にある (§4.3) | 方法の注意 | — (この表を作り直すとき。各メモの §6 は TSV の外のクラスも個別に比べている: 12 §6 の DropperBlock、14 §6 の醸造台とかまどの燃料、09 §6 の書見台など) |
| O-4 | 今の TS 実装の塀・板ガラス・泡柱の型の注記は 26.2 の読みを典拠にしている (packages/sim/src/types.ts)。26.3 のメモ (G-F1) を足すときに、26.2 → 26.3 の版差も確かめる | 解消 | 塀と板ガラスは、26.2 の読みが 26.3 でもそのまま使える (05 付録 D・付録 G の G-7)。泡柱は 26.2 と 26.3 で規則が同じだが、TS のテストが典拠にする「26.2」の持ち主 (ソウルサンドの予約) は 26.2 にも当たらない (16 §6・§9.2) |

---

## 4. 網羅表 A: hooks-26.3.tsv

クラスは world/level/block/ からの相対、表の並びは hooks-26.3.tsv と同じ (名前順)。
「フック」は宣言しているフックの略号である。

| 略号 | フック |
|---|---|
| SIG | getSignal・getDirectSignal・isSignalSource |
| AN | hasAnalogOutputSignal・getAnalogOutputSignal |
| NC | neighborChanged |
| SU | updateShape |
| IND | updateIndirectNeighbourShapes |
| T | tick |
| RT | randomTick・isRandomlyTicking |
| TK | getTicker |
| EV | triggerEvent |
| PL | onPlace・getStateForPlacement・setPlacedBy |
| RM | affectNeighborsAfterRemoval・onRemove・playerWillDestroy・destroy |
| SV | canSurvive |
| RP | canBeReplaced |
| ENT | entityInside・stepOn・fallOn |
| USE | useWithoutItem・useItemOn・attack |
| PRJ | onProjectileHit |
| EXP | onExplosionHit |
| DROP | spawnAfterBreak |
| PATH | isPathfindable |
| PUSH | getPistonPushReaction |

PL と TK の欄は、2026-11-28 に数え直して直した (§4.3)。

### 4.1 world/level/block/ 直下

| クラス | フック | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|---|
| AbstractBedBlock | SU PL RM USE PATH | 対象外: ベッドは回路の部品でない。片割れが消えると残りも消える形状更新と、ネザーでの爆発だけ。押し反応は 05 §4.6.3 | 対象外 | 26.3 で新設の親 (19) |
| AbstractCandleBlock | PRJ EXP | 12 §4.9 (火打石で点ける)・17 §4.8 (燃えた投射物)・17 §4.14 (風の爆発で消す) | 記述済 | 信号は出さない。LIT の変化はオブザーバーが拾う |
| AbstractCauldronBlock | AN T USE PATH | 14 §4.10・16 §4.18 | 記述済 | アナログ値と滴下の受け取り |
| AbstractFurnaceBlock | AN PL RM USE | 14 §4.10・§4.1・§4.9 | 記述済 | BE の tick での LIT の書き込みは未記載 (§3 の O-1) |
| AbstractSkullBlock | NC TK PL PATH | 11 §4.11 | 記述済 |  |
| AmethystBlock | PRJ | 17 §4.8 | 記述済 | 投射物の命中は音だけで Level の乱数を 1 回引く。振動の共鳴は 10 §4.8 (スカルクセンサーの側) |
| AmethystClusterBlock | SU PL SV | 05 付録 C.1 (F3: 取り付け面を失うと消える)・F4 | 記述済 | 芽の成長は BuddingAmethystBlock の側 (11 付録 F.8) |
| AnvilBlock | PL USE PATH | 16 §4.17 | 記述済 |  |
| AttachedStemBlock | SU | 05 付録 B.13 (F1: 向いた先の実が消えると AGE 7 の茎へ戻る)・05 付録 C.1 (F3)・11 付録 F.2 (F2) | 記述済 |  |
| AzaleaBlock | PATH | 11 付録 F.7 (F2: 骨粉で木になる)・05 付録 C.1 (F3) | 記述済 | 自前のフックは経路探索だけ。木の形は地物 (§7) |
| BambooSaplingBlock | SU RT SV | 11 付録 F.4 (F2: 育つと竹になる)・05 付録 C.1 (F3) | 記述済 |  |
| BambooStalkBlock | SU T RT PL SV PATH | 11 付録 F.4 (F2: 成長)・05 付録 B.17 (F1: 上の竹の AGE に合わせる) | 記述済 | 存続の予約 1 gt は 02 §4.9 表 C |
| BannerBlock | SU PL SV | 05 付録 C.1 (F3: 真下が legacy solid) | 記述済 |  |
| BarrelBlock | AN T PL RM USE | 14 §4.10・02 §4.9 表 A・03 §4.8 | 記述済 | OPEN と開閉の見直し 5 gt |
| BarrierBlock | SU PL | F4 | 記述済 | 動かせない (05 §4.6.3) |
| BaseCoralPlantTypeBlock | SU PL SV | 02 §4.9 表 C (枯れる予約)・05 付録 C.1 (F3)・F4 | 記述済 |  |
| BaseCoralWallFanBlock | SU PL SV | 02 §4.9 表 C・05 付録 C.1 (F3: 取り付け先の面)・F4 | 記述済 |  |
| BaseEntityBlock | EV | 03 §1.1・§2 (triggerEvent を BE へ回す) | 記述済 |  |
| BaseFireBlock | PL RM ENT | 12 §4.9 (置けるかの判定) | 記述済 | 延焼と TNT への着火は 11 付録 F.14 |
| BasePressurePlateBlock | SIG SU T RM SV ENT | 09 §4.3・17 §4.4 | 記述済 |  |
| BaseRailBlock | NC SU PL RM SV | 15 | 記述済 |  |
| BaseTorchBlock | SU SV | 08 §4.1 | 記述済 | 普通のトーチの支えもここ |
| BeaconBlock | TK USE | 対象外: 画面を開くだけ。BE は 80 gt ごとに台座を数えて効果を配る。信号・状態の書き込みは無い | 対象外 |  |
| BeehiveBlock | AN SU TK PL RM USE EXP | 14 §4.10・12 §4.9 | 記述済 | 蜜の段のアナログ値・ハサミと瓶 |
| BeetrootBlock | RT | 11 付録 F.1 (F2)・05 付録 C.1 (F3) | 記述済 |  |
| BellBlock | NC SU TK PL SV USE PRJ EXP PATH | 11 §4.6・03 §4.7 | 記述済 |  |
| BigDripleafBlock | NC SU T PL SV ENT PRJ | 11 §4.9・11 付録 F.12 (骨粉)・17 | 記述済 |  |
| BigDripleafStemBlock | SU T SV | 02 §4.9 表 C・11 §4.9・11 付録 F.12 (骨粉) | 記述済 | 信号を読まない |
| Block | PL RM ENT | 04・05 | 記述済 | UPDATE_ 定数・updateOrDestroy・isShapeFullBlock |
| BrewingStandBlock | AN TK RM USE PATH | 14 §4.10・§4.1 | 記述済 | HAS_BOTTLE の書き込みは未記載 (§3 の O-1) |
| BrushableBlock | SU T PL | 16 §4.17・02 §4.9 表 B | 記述済 |  |
| BubbleColumnBlock | SU T SV ENT | 16 §4.13・17 §4.21 | 記述済 |  |
| BuddingAmethystBlock | RT | 11 付録 F.8 (F2: 隣に芽を置き、段を進める) | 記述済 | アメジストの自動収穫の入力 |
| ButtonBlock | SIG T RM ENT USE EXP | 09 §4.2・17 §4.6 | 記述済 |  |
| CactusBlock | SU T RT SV ENT PATH | 11 付録 F.3 (F2: 成長)・05 付録 C.1 (F3: 1 gt の予約で壊れる) | 記述済 | 存続の予約は 02 §4.9 表 C、横の legacy solid で壊れる規則は 05 §4.7.2、成長のフラグ 260 は 04 §3.1 |
| CakeBlock | AN SU SV USE PATH | 14 §4.10 | 記述済 |  |
| CalibratedSculkSensorBlock | SIG TK PL | 10 | 記述済 |  |
| CampfireBlock | SU TK PL ENT USE PRJ PATH | 05 付録 B.14 (F1: 真下が干し草なら SIGNAL_FIRE)・12 §4.9・17 §4.8 | 記述済 | 点火は 12・17、形状更新の側は 05 付録 B.14 |
| CandleBlock | SU PL SV RP USE | 12 §4.9・17 §4.8・05 付録 C.3・F4 | 記述済 | 親 AbstractCandleBlock と同じ。canSurvive を形状更新から呼ばないので、支えを失っても消えない |
| CandleCakeBlock | AN SU SV USE PATH | 14 §4.10 | 記述済 |  |
| CarpetBlock | SU SV | 05 付録 C.1 (F3: 真下が空気なら消える) | 記述済 | 押し反応は既定 (押せる)。押す列の上では残る (05 付録 A.1) |
| CartographyTableBlock | USE | F6 | 対象外 |  |
| CarvedPumpkinBlock | PL | 17 付録 A.1 (ゴーレムの組み立て) | 記述済 | 設置フックで形を照合し、形のブロックをフラグ 2 で消してから周りへ NC |
| CaveVinesBlock | USE | 11 付録 F.5 (F2: 実の成長と収穫)・05 付録 B.16 (F1) | 記述済 |  |
| CaveVinesPlantBlock | USE | 11 付録 F.5 (F2)・05 付録 B.16 (F1) | 記述済 |  |
| CeilingHangingSignBlock | SU TK PL SV USE | 05 付録 C.1 (F3: 真上の下面が CENTER で頑丈) | 記述済 |  |
| ChainBlock | SU PL PATH | F4 | 記述済 |  |
| ChestBlock | AN SU T TK PL RM USE PATH | 09 §4.5・14 §4.11 | 記述済 | 結合 (type) の形状更新も 14 §4.11 |
| ChiseledBookShelfBlock | AN PL RM USE | 14 §4.10 | 記述済 |  |
| ChorusFlowerBlock | SU T RT SV PRJ | 11 付録 F.9 (F2: 成長)・05 付録 C.2 (F3: 1 gt の予約で壊れる)・17 §4.8 (投射物で壊れる) | 記述済 |  |
| ChorusPlantBlock | SU T PL SV PATH | 05 付録 B.7 (F1: 6 方向の接続)・02 §4.9 表 C | 記述済 |  |
| CocoaBlock | SU RT PL SV PATH | 11 付録 F.6 (F2)・05 付録 C.1 (F3: 幹の側) | 記述済 |  |
| CommandBlock | AN NC T PL USE | 11 §4.13・02 §4.9 表 A・14 §4.10 | 記述済 | 信号の受け方・1 gt の予約・成功数の読み取りまで。コマンドの中身は対象外。01 §4.10 と 02 §4.9 表 A の参照は仕上げで 11 §4.13 へ直した |
| ComparatorBlock | SU T EV USE | 07 | 記述済 |  |
| ComposterBlock | AN T PL USE PATH | 14 §4.13・§4.10 | 記述済 |  |
| ConcretePowderBlock | SU PL | 16 §4.17 | 記述済 |  |
| ConduitBlock | SU TK PL PATH | F4 | 記述済 | BE は信号に関わらない |
| CopperBulbBlock | AN NC PL | 11 §4.8 | 記述済 |  |
| CopperChestBlock | SU PL | 14 §4.12 | 記述済 |  |
| CopperGolemStatueBlock | AN SU PL RM USE PATH | 14 §4.10 | 記述済 |  |
| CoralBlock | SU T PL | 02 §4.9 表 C | 記述済 | 枯れると別ブロック |
| CoralFanBlock | SU T PL | 02 §4.9 表 C・05 付録 C.1 (F3)・F4 | 記述済 |  |
| CoralPlantBlock | SU T PL | 02 §4.9 表 C・05 付録 C.1 (F3)・F4 | 記述済 |  |
| CoralWallFanBlock | SU T PL | 02 §4.9 表 C・05 付録 C.1 (F3: 取り付け先の面)・F4 | 記述済 |  |
| CrafterBlock | AN NC T TK PL RM USE | 12 §4.13〜§4.16 | 記述済 |  |
| CraftingTableBlock | USE | F6 | 対象外 |  |
| CreakingHeartBlock | AN SU T TK PL RM EXP | 14 §4.10・02 §4.9 表 C | 記述済 |  |
| CropBlock | RT SV ENT | 11 付録 F.1 (F2: 成長・骨粉)・05 付録 C.1 (F3: 耕地と明るさ) | 記述済 | 耕地の踏み荒らしは FarmlandBlock (17) |
| CrossCollisionBlock | PATH | 05 付録 B.1・B.4 (F1: 柵と板ガラスの親。形を作るだけ) | 記述済 |  |
| DaylightDetectorBlock | SIG TK USE | 09 §4.9・01 §4.4 | 記述済 |  |
| DecoratedPotBlock | AN SU PL RM USE PRJ PATH | 14 §4.10・03 | 記述済 |  |
| DetectorRailBlock | SIG AN T PL ENT | 15 §4.10・17 §4.7 | 記述済 |  |
| DiodeBlock | SIG NC T PL RM SV | 07 | 記述済 |  |
| DispenserBlock | AN NC T PL RM USE | 12 | 記述済 |  |
| DoorBlock | NC SU PL RM SV USE EXP PATH | 11 §4.3 | 記述済 |  |
| DoublePlantBlock | SU PL RM SV | 05 付録 C.1・C.2 (F3: 片割れが消えると残りも消える) | 記述済 | 11 §4.3 はドアの下半分を消す所だけ引く |
| DragonEggBlock | USE PATH | 16 §4.17 | 記述済 |  |
| DriedGhastBlock | SU T RT PL PATH | 02 §4.9 表 C | 記述済 |  |
| DropExperienceBlock | DROP | F6 (壊したときの経験値) | 対象外 |  |
| EnchantingTableBlock | TK USE PATH | F6 | 対象外 |  |
| EndGatewayBlock | TK RP ENT | 対象外: エンティティの移送。BE のブロックイベントは 03 §4.10 | 対象外 |  |
| EndPortalBlock | RP ENT | 対象外: エンティティの移送。動かせない (05 §4.6.3) | 対象外 |  |
| EndPortalFrameBlock | AN PL PATH | 14 §4.10 | 記述済 |  |
| EndRodBlock | PL | 対象外: 置く向きを決めるだけ。非導体・押せる (05) | 対象外 |  |
| EnderChestBlock | SU T TK PL USE PATH | 03 §4.8・02 §4.9 表 A | 記述済 | アナログ値は無い |
| EyeblossomBlock | T RT ENT | 02 §4.9 表 C・10・05 付録 C.1 (支え) | 記述済 |  |
| FaceAttachedHorizontalDirectionalBlock | SU PL SV | 09 §4.1 | 記述済 | 置いた時の状態 (face・facing。powered は偽) は 09 §4.1 |
| FallingBlock | SU T PL | 16 §4.15 | 記述済 |  |
| FarmlandBlock | SU T RT PL SV ENT PATH | 17・02 §4.9 表 C | 記述済 | 踏み荒らし・上が固体で土へ。水分のランダム tick は 11 付録 F.13 |
| FenceBlock | SU PL USE PATH | 05 付録 B.4・B.5 (F1: 4 方向の接続) | 記述済 |  |
| FenceGateBlock | NC SU PL USE EXP PATH | 11 §4.5・05 付録 B.4・B.5 (塀と柵からつながる向き) | 記述済 |  |
| FireBlock | SU T PL SV | 11 付録 F.14 (延焼と TNT の着火) | 記述済 | 予約 30〜39 は 02 §4.9 表 B |
| FlowerBedBlock | PL RP | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| FlowerPotBlock | SU RT USE PATH | 11 付録 F.11 (F2: 鉢のアイブロッサムがランダム tick で開閉する)・05 付録 C.3 | 記述済 | canSurvive を上書きしないので、下が消えても残る |
| FrogspawnBlock | SU T PL SV ENT | 02 §4.9 表 C | 記述済 |  |
| FrostedIceBlock | NC T PL | 02 §4.9 表 B・16 | 記述済 |  |
| GlazedTerracottaBlock | PL | 05 §4.6.3・13 §4.6 (PUSH) | 記述済 | クラスは向きを決めるだけ |
| GrindstoneBlock | SV USE PATH | 05 付録 C.3 (支えを失っても消えない) | 記述済 | 初めの照合の「F3 (取り付け面を失うと消える)」は誤り。canSurvive が常に真 (05 付録 G の G-1)。押し反応は IMMOVEABLE |
| GrowingPlantBlock | T PL SV | 11 付録 F.5 (F2: 先端の成長)・05 付録 B.16 (F1)・02 §4.9 表 C | 記述済 | 昆布・つた類の親 |
| GrowingPlantBodyBlock | SU RP | 05 付録 B.16 (F1: 先端と胴の入れ替え)・11 付録 F.12 (F2: 骨粉)・02 §4.9 表 C | 記述済 |  |
| GrowingPlantHeadBlock | SU RT PL | 05 付録 B.16 (F1)・11 付録 F.5 (F2)・02 §4.9 表 C | 記述済 | 昆布の自動収穫の入力 |
| HangingMossBlock | SU T SV | 02 §4.9 表 C・05 付録 C.2 (F3: 1 gt の予約で壊れる)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| HangingRootsBlock | SU PL SV | 05 付録 C.1 (F3)・F4 | 記述済 |  |
| HayBlock | ENT | 対象外: 落下の衝撃を減らすだけ | 対象外 | 焚き火の SIGNAL_FIRE の元としての扱いは CampfireBlock の行 |
| HeavyCoreBlock | SU PL PATH | F4 | 記述済 |  |
| HoneyBlock | ENT | 13 §4.7・17 | 記述済 |  |
| HopperBlock | AN NC TK PL RM ENT USE PATH | 14 | 記述済 |  |
| HugeMushroomBlock | SU PL | 05 付録 B.8 (F1: 同じブロックと接する面を消す) | 記述済 |  |
| IceBlock | RT | 16・19 | 記述済 |  |
| InfestedBlock | DROP | F6 (壊すとシルバーフィッシュ) | 対象外 |  |
| InfestedRotatedPillarBlock | PL | F6 | 対象外 |  |
| IronBarsBlock | SU PL | 05 付録 B.3・B.5 (F1: 板ガラス・鉄格子の接続) | 記述済 | 今の TS 実装が使う (pane)。TS との違いは 05 付録 G |
| JigsawBlock | PL USE | F6 (構造物の部品) | 対象外 |  |
| JukeboxBlock | SIG AN TK PL RM USE | 09 §4.10・14 §4.10 | 記述済 |  |
| LadderBlock | SU PL SV | 05 付録 C.1 (F3)・F4 | 記述済 |  |
| LanternBlock | SU PL SV PATH | 05 付録 C.1 (F3: 吊りは上、置きは下が要る)・F4 | 記述済 |  |
| LavaCauldronBlock | AN ENT | 14 §4.10 | 記述済 |  |
| LayeredCauldronBlock | AN ENT | 14 §4.10・16・17 | 記述済 |  |
| LeafLitterBlock | PL SV RP | 05 付録 C.1 (F3) | 記述済 |  |
| LeavesBlock | SU T RT PL | 05 付録 B.15 (F1: DISTANCE の決め直し)・11 付録 F.10 (F2: 自然の落葉) | 記述済 | 予約の条件は 02 §4.9 表 C、支えにならないことは 05 §4.7.4 |
| LecternBlock | SIG AN T PL RM USE PATH | 09 §4.6・14 §4.10 | 記述済 |  |
| LeverBlock | SIG RM USE EXP | 09 §4.1 | 記述済 |  |
| LightBlock | SU USE | F4 | 記述済 | 明るさの段は回路に効かない |
| LightningRodBlock | SIG SU T PL RM | 09 §4.8 | 記述済 |  |
| LilyPadBlock | ENT | 05 付録 C.1 (F3: 水の上) | 記述済 | ボートで壊れる経路 (entityInside) はどのメモにも無い |
| LiquidBlock | NC SU T RT PL PATH | 16 | 記述済 |  |
| LoomBlock | PL USE | F6 | 対象外 |  |
| MagmaBlock | ENT | 16 | 記述済 |  |
| MangrovePropaguleBlock | SU RT PL SV | 11 付録 F.7 (F2)・05 付録 C.1 (F3)・F4 | 記述済 |  |
| MangroveRootsBlock | SU PL | F4 | 記述済 |  |
| MossyCarpetBlock | SU PL SV | 05 付録 B.9 (F1: 横の高さを隣で決める)・05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| MudBlock | PATH | 対象外: 経路探索のフックだけ。導体・押し反応は 05 | 対象外 |  |
| MultifaceBlock | SU PL SV RP | 05 付録 B.11 (F1: 支えの無い面を消す)・F4 | 記述済 |  |
| MushroomBlock | RT SV | 11 付録 F.10・F.12 (F2: 広がりと骨粉)・05 付録 C.1 (F3) | 記述済 | 26.4-pre-1 で存続の条件が変わる (05 付録 D) |
| NetherPortalBlock | SU RT ENT | 対象外: 枠が欠けると消え、エンティティを移す。01 §4.5 の表で回路外 | 対象外 |  |
| NetherWartBlock | RT | 11 付録 F.6 (F2)・05 付録 C.1 (F3) | 記述済 |  |
| NoteBlock | NC SU EV PL USE | 11 §4.2・03 §4.6 | 記述済 |  |
| NyliumBlock | RT | 11 付録 F.10・F.12 (F2: 覆われるとネザーラックへ戻る・骨粉) | 記述済 |  |
| ObserverBlock | SIG SU T PL RM | 08 §4.2 | 記述済 |  |
| PathBlock | SU T PL SV PATH | 02 §4.9 表 C・05・10 | 記述済 |  |
| PitcherCropBlock | SU RT PL SV RP ENT | 11 付録 F.1 (F2)・05 付録 C.1 (F3) | 記述済 |  |
| PointedDripstoneBlock | RT ENT | 16 §4.18・§4.17 | 記述済 | 先端の成長 (ランダム tick) は 11 付録 F.13 |
| PotentSulfurBlock | SU TK EV PL | 11 §4.10・03 | 記述済 |  |
| PowderSnowBlock | ENT PATH | 12 §4.7 (汲む)・05 | 記述済 | エンティティの凍結は対象外 |
| PoweredBlock | SIG | 08 §4.3 | 記述済 |  |
| PumpkinBlock | USE | F6 (ハサミでくり抜く。ディスペンサーのハサミは扱わない) | 対象外 |  |
| RedStoneOreBlock | RT ENT USE DROP | 09 付録 A (点灯と消灯) | 記述済 | 17 §4.20 の「踏むと光る」の詳しい条件も 09 付録 A |
| RedstoneLampBlock | NC T PL | 11 §4.1 | 記述済 |  |
| RedstoneTorchBlock | SIG NC T PL RM | 08 §4.1 | 記述済 |  |
| RedstoneWallTorchBlock | SIG SU PL SV | 08 §4.1 | 記述済 |  |
| RedstoneWireBlock | SIG NC SU IND PL RM SV USE | 06 | 記述済 |  |
| RepeaterBlock | SU PL USE | 07 | 記述済 |  |
| RespawnAnchorBlock | AN USE PATH | 14 §4.10・12 §4.6 | 記述済 |  |
| RodBlock | PATH | 09 §4.8 | 記述済 | 避雷針と end_rod の親 |
| RotatedPillarBlock | PL | 対象外: 軸を決めるだけ | 対象外 |  |
| SaplingBlock | RT | 11 付録 F.7 (F2: 段を進めて木になる)・05 付録 C.1 (F3) | 記述済 | 木の形は地物の配置 (乱数。§7) |
| ScaffoldingBlock | SU T PL SV RP | 16 §4.17・02 §4.9 表 B | 記述済 |  |
| SculkCatalystBlock | T TK DROP | 対象外: 信号を出さない (10 §1.2)。PULSE の予約 8 gt だけ 02 §4.9 表 A | 対象外 |  |
| SculkSensorBlock | SIG AN SU T TK PL RM ENT DROP PATH | 10 | 記述済 |  |
| SculkShriekerBlock | SU T TK PL ENT DROP | 対象外: 信号を出さない (10 §1.2)。叫びの予約 90 gt は 02 §4.9 表 A | 対象外 |  |
| SeaPickleBlock | SU PL SV RP PATH | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉)・F4 | 記述済 |  |
| SeagrassBlock | SU PL | 16 §4.11・12 | 記述済 | 骨粉で背の高い海草になるのは 11 付録 F.12 |
| SegmentableBlock | PL RP | 対象外: 花びら・落ち葉の枚数の数え方だけ | 対象外 |  |
| ShelfBlock | AN NC SU PL RM USE PATH | 11 §4.12・14 §4.10 | 記述済 |  |
| ShelfMushroomBlock | SU PL SV PATH | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 | 26.3 で新設 (19) |
| ShulkerBoxBlock | AN TK PL RM USE | 14・05・03 §4.9 | 記述済 |  |
| SignBlock | SU TK PL USE | F4 | 記述済 | 支えは子クラス (05 付録 C.1) |
| SkullBlock | PL | 11 §4.11 (親の AbstractSkullBlock) | 記述済 | 自前は置く向きだけ |
| SlabBlock | SU PL RP PATH | 05 §4.4・F4 | 記述済 | 上付き・下付きで導体と面が変わる |
| SlimeBlock | ENT | 13 §4.7・17 | 記述済 |  |
| SmallDripleafBlock | SU PL SV | 05 付録 C.1 (F3: 2 マスの片割れ)・11 付録 F.12 (F2: 骨粉)・F4 | 記述済 |  |
| SmithingTableBlock | USE | F6 | 対象外 |  |
| SnifferEggBlock | T PL PATH | 02 §4.9 表 C | 記述済 |  |
| SnowLayerBlock | SU RT PL SV RP PATH | 16・05 付録 C.1 (支え) | 記述済 |  |
| SnowyBlock | SU PL | 05 付録 B.12 (F1: 真上が雪なら SNOWY) | 記述済 | 草ブロックなど |
| SoulFireBlock | SU SV | 05 付録 C.1 (F3: ソウルソイル系の上でだけ残る)・11 付録 F.14 | 記述済 |  |
| SoulSandBlock | PATH | 16 §4.13 | 記述済 |  |
| SpawnerBlock | TK DROP | 対象外: 壊したときの経験値だけ。BE のブロックイベントは 03 §4.10 | 対象外 |  |
| SpeleothemBlock | SU T RT PL SV PRJ PATH | 16・02 §4.9 表 B・11 付録 F.13 (成長) | 記述済 |  |
| SpongeBlock | NC PL | 16 §4.14 | 記述済 |  |
| SporeBlossomBlock | SU SV | 05 付録 C.1 (F3) | 記述済 |  |
| SpreadingSnowyBlock | RT | 11 付録 F.10 (F2: 草・菌糸の広がりと土への戻り)・05 付録 B.12 (F1) | 記述済 |  |
| StairBlock | SU PL PATH | 05 付録 B.6 (F1: 形 shape の決め直し)・F4 | 記述済 |  |
| StandingSignBlock | SU PL SV | 05 付録 C.1 (F3: 真下が legacy solid) | 記述済 |  |
| StemBlock | RT | 11 付録 F.2 (F2: 実を置いて AttachedStemBlock になる)・05 付録 C.1 (F3) | 記述済 | カボチャ・スイカの自動収穫の入力 |
| StonecutterBlock | PL USE PATH | F6 | 対象外 |  |
| StructureBlock | NC PL USE | 11 §4.13 | 記述済 | 保存・読み込みの中身は対象外 |
| SugarCaneBlock | SU T RT SV | 11 付録 F.3 (F2: 成長)・05 付録 C.1 (F3: 1 gt の予約で壊れる) | 記述済 | 存続の予約は 02 §4.9 表 C、成長のフラグ 260 は 04 §3.1 |
| SweetBerryBushBlock | RT ENT USE | 11 付録 F.6 (F2)・05 付録 C.1 (F3) | 記述済 |  |
| TallSeagrassBlock | PL SV | 16 §4.11・12 | 記述済 |  |
| TargetBlock | SIG T PL PRJ | 09 §4.7・17 §4.8 | 記述済 |  |
| TestBlock | NC T PL USE | 11 §4.13 | 記述済 | ゲームテスト用。START の間だけ ownSignal 15。09 §1.2 の参照は仕上げで 11 §4.13 へ直した |
| TestInstanceBlock | USE | F6 (ゲームテスト) | 対象外 |  |
| TntBlock | NC PL RM USE PRJ | 11 §4.7・17 §4.13・12 | 記述済 | 火の延焼で着火する経路は 11 付録 F.14 |
| TorchflowerCropBlock | RT | 11 付録 F.1 (F2)・05 付録 C.1 (F3) | 記述済 |  |
| TrapDoorBlock | NC SU PL USE EXP PATH | 11 §4.4 | 記述済 |  |
| TrappedChestBlock | SIG | 09 §4.5 | 記述済 |  |
| TripWireBlock | SU T PL RM ENT | 09 §4.4.1・17 §4.5 | 記述済 |  |
| TripWireHookBlock | SIG SU T PL RM SV | 09 §4.4.2 | 記述済 |  |
| TurtleEggBlock | RT PL RP ENT | 17 §4.20 | 記述済 | 踏むと割れる。孵化のランダム tick は 11 付録 F.13 |
| VaultBlock | TK PL USE | 対象外: 試練の間の報酬箱。近くのプレイヤーで状態が変わるだけ | 対象外 |  |
| VegetationBlock | SU SV PATH | 05 付録 C.1 (F3: 草花の親) | 記述済 |  |
| VineBlock | SU RT PL SV RP | 05 付録 B.10 (F1: 支えの無い面を消す)・11 付録 F.10 (F2: 広がり) | 記述済 |  |
| WallBannerBlock | SU PL SV | 05 付録 C.1 (F3: 取り付け先が legacy solid) | 記述済 |  |
| WallBlock | SU PL PATH | 05 付録 B.2・B.5 (F1: 4 辺の高さと柱 up) | 記述済 | 今の TS 実装が柱の無遅延伝播に使う (shouldRaisePost)。TS との違いは 05 付録 G |
| WallHangingSignBlock | SU TK PL USE PATH | F4 | 記述済 | canSurvive を上書きしないので、取り付け先が消えても残る (05 付録 C.3。天井吊りは 05 付録 C.1) |
| WallSignBlock | SU PL SV | 05 付録 C.1 (F3: 取り付け先が legacy solid) | 記述済 |  |
| WallSkullBlock | PL | 11 §4.11 (親の AbstractSkullBlock) | 記述済 |  |
| WallTorchBlock | SU PL SV | 08 §4.1 | 記述済 | 壁付きの支えの判定を壁トーチが借りる |
| WaterloggedTransparentBlock | SU PL | F4 | 記述済 | 銅の格子の親 |
| WeatheringCopperBarsBlock | RT | F5・05 付録 B.3 (F1: 鉄格子と同じ接続) | 記述済 | 酸化は 14 §4.12・11 §4.8 の仕組み |
| WeatheringCopperBulbBlock | RT | 11 §4.8・F5 | 記述済 |  |
| WeatheringCopperChainBlock | RT | F5 | 記述済 |  |
| WeatheringCopperChestBlock | RT | 14 §4.12 | 記述済 |  |
| WeatheringCopperDoorBlock | RT | 11 §4.3・F5 | 記述済 |  |
| WeatheringCopperFullBlock | RT | F5 | 記述済 |  |
| WeatheringCopperGolemStatueBlock | RT USE | 14・F5 | 記述済 |  |
| WeatheringCopperGrateBlock | RT | F5 | 記述済 |  |
| WeatheringCopperSlabBlock | RT | F5 | 記述済 |  |
| WeatheringCopperStairBlock | RT | F5・05 付録 B.6 (F1: 階段と同じ形) | 記述済 | 酸化は 14 §4.12・11 §4.8 の仕組み |
| WeatheringCopperTrapDoorBlock | RT | 11 §4.4・F5 | 記述済 |  |
| WeatheringLanternBlock | RT | F5・05 付録 C.1 (F3: ランタンと同じ支え) | 記述済 | 酸化は 14 §4.12・11 §4.8 の仕組み |
| WeatheringLightningRodBlock | RT | 09 §4.8・F5 | 記述済 |  |
| WebBlock | ENT | 対象外: エンティティを遅くするだけ | 対象外 |  |
| WetSpongeBlock | PL | 16 §4.14 | 記述済 |  |
| WitherRoseBlock | ENT | 05 付録 C.1 (F3: 真下が supports_wither_rose) | 記述済 | 初めの照合では対象外 (触れた生き物への効果だけを見た)。支えの規則で消える |
| WitherSkullBlock | PL | 17 付録 A.1 (ウィザーの組み立て) | 記述済 | ディスペンサーで置く条件は 12 §4.6 |
| WitherWallSkullBlock | PL | 17 付録 A.1 (ウィザーの組み立て) | 記述済 |  |

### 4.2 entity/・piston/・state/

| クラス | フック | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|---|
| entity/BeaconBlockEntity | T | 対象外: 台座の数え直しと効果の配布 | 対象外 |  |
| entity/BeehiveBlockEntity | T | 14 §4.10 | 記述済 |  |
| entity/BellBlockEntity | T EV | 11 §4.6・03 §4.7 | 記述済 |  |
| entity/BlockEntity | EV | 01 §4.7・04・14 | 記述済 | setChanged が CU の入口 |
| entity/BlockEntityTicker | T | 01 §4.7 | 記述済 | ticker の登録と実行の仕組み |
| entity/ChestBlockEntity | EV | 03 §4.8・09 §4.5・14 | 記述済 |  |
| entity/ConduitBlockEntity | SU | 対象外: 枠の数え直しと効果 | 対象外 |  |
| entity/CreakingHeartBlockEntity | AN | 14 §4.10 | 記述済 |  |
| entity/DecoratedPotBlockEntity | EV | 03・14 | 記述済 |  |
| entity/EnderChestBlockEntity | EV | 03 §4.8 | 記述済 |  |
| entity/HopperBlockEntity | ENT | 14・12 §4.12・17 §4.9 | 記述済 |  |
| entity/JukeboxBlockEntity | T | 09 §4.10・14 | 記述済 |  |
| entity/ShulkerBoxBlockEntity | T EV | 03 §4.9・05・14 | 記述済 |  |
| entity/SignBlockEntity | T | 対象外: 文字と編集者の管理 | 対象外 |  |
| entity/SpawnerBlockEntity | EV | 03 §4.10 | 記述済 | 湧きそのものは対象外 |
| entity/TheEndGatewayBlockEntity | EV | 03 §4.10 | 記述済 |  |
| entity/TickingBlockEntity | T | 01 §4.7 | 記述済 |  |
| entity/vault/VaultBlockEntity | T | 対象外: VaultBlock と同じ | 対象外 |  |
| piston/MovingPistonBlock | TK RM USE PATH | 13 §4.13 | 記述済 |  |
| piston/PistonBaseBlock | NC EV PL PATH | 13・03 §4.5 | 記述済 |  |
| piston/PistonHeadBlock | NC SU RM SV PATH | 13 §4.12 | 記述済 |  |
| piston/PistonMovingBlockEntity | T | 13 §4.9・§4.10 | 記述済 |  |
| state/BlockBehaviour | SIG AN NC SU IND T RT TK EV PL RM SV RP ENT USE PRJ EXP DROP PATH PUSH | 04・05 | 記述済 | フックの既定・Properties・BlockStateBase |

### 4.3 フックの欄の数え直し (PL と TK)

初めの hooks-26.3.tsv は、戻り値の型の前に注釈 (@Nullable) が付く宣言を拾えていなかった。
34 個のフックのうち、これに当たるのは getStateForPlacement と getTicker の 2 つだけである。26.3 の world/level/block を走査し直して、欄を直した [26.3 読解: 各クラスの宣言]。

| フック | 宣言するクラス | うち注釈つきを持つ | 表の直し |
|---|---|---|---|
| getStateForPlacement | 117 | 48 | 取りこぼしは 47 クラスである (GrowingPlantBlock は、注釈の無い別の getStateForPlacement (乱数を受ける版) も宣言するので、初めから拾えていた)。**PL を 34 行に足した**。残りの 14 のうち 11 行は onPlace か setPlacedBy で、GrowingPlantBlock はその別の宣言で、もう PL が付いていた。2 クラス (KelpBlock・MultifaceSpreader) は、34 個のフックをこれしか宣言しないので表 A に無い |
| getTicker | 34 | 34 (全部。取りこぼしも 34) | **TK を 29 行に足した** (直す前は TK の行が 0 だった)。5 クラス (EntityBlock・FurnaceBlock・BlastFurnaceBlock・SmokerBlock・TrialSpawnerBlock) は、これしか宣言しないので表 A に無い |

- PL の行は 104 から **138** になった。PL を足した 34 行: AmethystClusterBlock・BambooStalkBlock・BarrierBlock・BaseCoralPlantTypeBlock・BaseCoralWallFanBlock・BellBlock・CalibratedSculkSensorBlock・CampfireBlock・CocoaBlock・ConduitBlock・CoralBlock・CreakingHeartBlock・**FaceAttachedHorizontalDirectionalBlock**・HangingRootsBlock・LadderBlock・LanternBlock・MangrovePropaguleBlock・MangroveRootsBlock・MultifaceBlock・**RedstoneLampBlock**・RedstoneWallTorchBlock・SculkShriekerBlock・SeaPickleBlock・SeagrassBlock・ShelfMushroomBlock・SlabBlock・SnowLayerBlock・SpeleothemBlock・TallSeagrassBlock・VineBlock・WallHangingSignBlock・WallSignBlock・WallTorchBlock・WaterloggedTransparentBlock。
- 本文と表が食い違っていた 2 つは、**本文が正しい**。RedstoneLampBlock#getStateForPlacement (lit を受電で決める。11 §4.1) と FaceAttachedHorizontalDirectionalBlock#getStateForPlacement (レバーとボタンの face・facing。09 §4.1) は、どちらも 26.3 にある。
- 表 A に無い 7 クラスは、どれも表 C (§6) に行がある。だから §1・§2 の件数 (A 251・C 170・合計 582) と、各行の状態は変えていない。直したのはフックの欄と、FaceAttachedHorizontalDirectionalBlock の行の担当 (09 から 09 §4.1 へ、節まで絞った) と備考である。
- **ほかの欄は信じてよい**。注釈つきの戻り値を持つのは上の 2 つのフックだけで、残りの 32 個 (戻り値が真偽・整数・状態・InteractionResult・PushReaction・無し) は、数え直しても表と 1 行も違わなかった。
  このうち onRemove と onBlockStateChange は、26.3 の world/level/block に宣言が 1 つも無い。この 2 つは、宣言が無いことが一致しただけである。
  SV (canSurvive。戻り値は真偽) を宣言するのは 64 クラスで、表の SV の 64 行と一致する。
- PL は 3 つのフック (onPlace・getStateForPlacement・setPlacedBy) をまとめた欄である。どれを持つかは欄からは分からない。setPlacedBy を持つ 17 クラスの一覧は 04 §4.13、playerWillDestroy を持つ 11 クラスの一覧は 04 §4.14 にある。
- 欄は「そのクラスが自分で宣言するか」を示す。親が宣言したフックは、親の行にだけ出る。
  例: LeverBlock の行に PL と SV は無いが、親の FaceAttachedHorizontalDirectionalBlock の行にある。あるブロックがフックを持つかは、親の行までたどって決める。
- **RedstoneLampBlock と、プロパティを持たない石などのブロック (クラスは Block) は、canSurvive を上書きしない**。RedstoneLampBlock の親は Block で、Block も上書きしない。
  使われるのは BlockBehaviour の既定で、常に真を返す (state/BlockBehaviour の行の SV は、この既定の宣言である)。どこに置いても支えを求めず、周りが変わっても消えない (→ 11 §4.1・05 付録 C.3)。

---

## 5. 網羅表 B: エンジン側

クラスは net/minecraft/ からの相対。hooks-26.3.tsv にある piston/ の 4 クラス・entity/HopperBlockEntity・Block・state/BlockBehaviour は §4 に入れたので、ここには載せない。

### tick ループ・チャンク・入力の位相

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| server/MinecraftServer | 01 §4.1・§4.2・18 §4.9 | 記述済 | 連鎖上限の値の出どころ |
| world/TickRateManager | 01 §4.8 | 記述済 |  |
| server/ServerTickRateManager | 01 §4.8・§4.9 | 記述済 |  |
| server/level/ServerLevel | 01・02・03・04 | 記述済 | tick の相・予約・ブロックイベント・更新 |
| server/level/ServerChunkCache | 01 §4.5・18 §4.11 | 記述済 |  |
| server/level/ChunkMap | 01 §4.11 | 記述済 |  |
| server/level/DistanceManager | 01 §4.11・03 §4.4 | 記述済 |  |
| world/level/TicketStorage | 01 §4.11 | 記述済 |  |
| server/level/ServerPlayerGameMode | 01 §4.10・09・15 | 記述済 |  |
| server/level/ServerPlayer | 01 §4.10・17 | 記述済 |  |
| server/network/ServerGamePacketListenerImpl | 01 §4.10 | 記述済 |  |
| world/level/chunk/LevelChunkSection | 01 §4.5 | 記述済 | ランダム tick の数え上げ |
| world/level/entity/EntityTickList | 01 §4.6・17・18 | 記述済 |  |
| world/level/entity/PersistentEntitySectionManager | 17・01 | 記述済 |  |
| world/level/entity/EntitySectionStorage | 17 §4.1・18 | 記述済 |  |

### 書き込み・更新・信号

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/Level | 04 §4.1・01 §4.7・18 | 記述済 |  |
| world/level/LevelAccessor | 02 §4.1・04 | 記述済 |  |
| world/level/LevelWriter | 04 | 記述済 |  |
| world/level/LevelReader | 05 | 記述済 |  |
| world/level/SignalGetter | 05 §4.1 | 記述済 |  |
| world/level/BlockGetter | 10 §4.4・17 | 記述済 | 遮蔽の線分の歩き方 |
| world/level/CollisionGetter | 17 §4.2 | 記述済 | クラス名は出ない。エンティティの移動の当たり判定として |
| world/level/LevelSimulatedReader | 対象外: ワールド生成の地物が使う読み取り | 対象外 |  |
| world/level/chunk/LevelChunk | 04 §4.2・01 | 記述済 |  |
| world/level/chunk/ChunkAccess | 18・02 | 記述済 |  |
| world/level/chunk/ProtoChunk | 02 | 記述済 |  |
| world/level/chunk/UpgradeData | 02 §4.9 表 E | 記述済 |  |
| world/level/chunk/storage/SerializableChunkData | 02 §4.7・18 | 記述済 |  |
| world/level/redstone/NeighborUpdater | 04 | 記述済 |  |
| world/level/redstone/CollectingNeighborUpdater | 04 §4.3・§4.4・18 §4.9 | 記述済 |  |
| world/level/redstone/InstantNeighborUpdater | 04 §4.12 | 記述済 |  |
| world/level/redstone/Orientation | 04 §4.9・06 | 記述済 |  |
| world/level/redstone/ExperimentalRedstoneUtils | 04 §4.9・06 | 記述済 |  |
| world/level/redstone/RedstoneWireEvaluator | 06 §4.9・§4.10 | 記述済 |  |
| world/level/redstone/DefaultRedstoneWireEvaluator | 06 §4.12・18 | 記述済 |  |
| world/level/redstone/ExperimentalRedstoneWireEvaluator | 06 §4.13・18 | 記述済 |  |
| world/level/redstone/Redstone | 05 | 記述済 | 信号の定数 |
| world/level/block/state/BlockState | 05 | 記述済 |  |
| world/level/block/state/StateDefinition | 05 §3.3 | 記述済 |  |
| world/level/block/state/StateHolder | 05 §3.3 | 記述済 |  |
| world/level/block/Blocks | 05 §4.4.2・§4.6.3 | 記述済 | 全登録と性質 |
| world/level/block/SupportType | 05 §4.7.4・15 | 記述済 |  |
| world/level/material/PushReaction | 05 §4.6・13 §4.6 | 記述済 |  |
| core/Direction | 05・04 | 記述済 | 方向の並び |
| core/BlockPos | 18 | 記述済 |  |
| core/Vec3i | 18 §4.2・13 | 記述済 | hashCode と反復順 |

### 予約 tick (world/ticks)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/ScheduledTickAccess | 02 §4.1 | 記述済 |  |
| world/ticks/LevelTicks | 02 §3.4・§4.3・§4.4 | 記述済 |  |
| world/ticks/LevelChunkTicks | 02 §3.3・§4.2 | 記述済 |  |
| world/ticks/ScheduledTick | 02 §3.1 | 記述済 |  |
| world/ticks/SavedTick | 02 §4.7 | 記述済 |  |
| world/ticks/TickPriority | 02 §3.2 | 記述済 |  |
| world/ticks/ProtoChunkTicks | 02 | 記述済 |  |
| world/ticks/WorldGenTickAccess | 02 | 記述済 |  |
| world/ticks/BlackholeTickAccess | 02 | 記述済 |  |
| world/ticks/LevelTickAccess | 02 §1.1 | 記述済 | interface |
| world/ticks/TickAccess | 02 §1.1 | 記述済 | interface |
| world/ticks/TickContainerAccess | 02 §1.1 | 記述済 | interface |
| world/ticks/SerializableTickContainer | 02 §1.1 | 記述済 | interface |
| world/ticks/ContainerSingleItem | 14 (アイテム 1 個のコンテナ) | 記述済 | 予約 tick とは無関係 (02 §1.1) |

### ブロックイベント

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/BlockEventData | 03 | 記述済 |  |

### ピストン (piston のうち hooks-26.3.tsv に無いもの)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/piston/PistonStructureResolver | 13 §4.7 | 記述済 |  |
| world/level/block/piston/PistonMath | 13 | 記述済 |  |

### GameEvent・振動 (gameevent)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/gameevent/GameEvent | 10 | 記述済 |  |
| world/level/gameevent/GameEventDispatcher | 10 §4.3・18 | 記述済 |  |
| world/level/gameevent/EuclideanGameEventListenerRegistry | 10 §4.3・18 | 記述済 |  |
| world/level/gameevent/GameEventListener | 10 §4.2 | 記述済 |  |
| world/level/gameevent/GameEventListenerRegistry | 10 §4.2 | 記述済 |  |
| world/level/gameevent/DynamicGameEventListener | 10 §4.2 | 記述済 |  |
| world/level/gameevent/BlockPositionSource | 10 §4.2 | 記述済 |  |
| world/level/gameevent/PositionSource | 対象外: 聞き手の位置の型。ブロックの聞き手は BlockPositionSource として 10 にある | 対象外 |  |
| world/level/gameevent/PositionSourceType | 対象外: 位置の型の登録 | 対象外 |  |
| world/level/gameevent/EntityPositionSource | 対象外: エンティティが聞き手のとき (ウォーデン・アレイ) | 対象外 | アレイは 17 付録 A.2 |
| world/level/gameevent/vibrations/VibrationSystem | 10 §4.4〜§4.7 | 記述済 |  |
| world/level/gameevent/vibrations/VibrationSelector | 10 §4.5 | 記述済 |  |
| world/level/gameevent/vibrations/VibrationInfo | 10 | 記述済 |  |

### コンテナ・ホッパー

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/entity/Hopper | 14 | 記述済 |  |
| world/inventory/AbstractContainerMenu | 14 §4.1・15 | 記述済 | 充填率の式 |
| world/Container | 14・12 | 記述済 |  |
| world/Containers | 14・04 | 記述済 |  |
| world/CompoundContainer | 14 §4.11・09 | 記述済 |  |
| world/SimpleContainer | 14 | 記述済 |  |
| world/ContainerHelper | 14 | 記述済 |  |
| world/WorldlyContainer | 14 §4.1・12 | 記述済 | 面ごとのスロット |

### ディスペンサーの振る舞い (core/dispenser)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| core/dispenser/DispenseItemBehavior | 12 §4.5・§4.6 | 記述済 |  |
| core/dispenser/DefaultDispenseItemBehavior | 12・17・18 | 記述済 |  |
| core/dispenser/OptionalDispenseItemBehavior | 12 §4.5 | 記述済 |  |
| core/dispenser/BlockSource | 12 | 記述済 |  |
| core/dispenser/ProjectileDispenseBehavior | 12 §4.10・17 | 記述済 |  |
| core/dispenser/EquipmentDispenseItemBehavior | 12 §4.10 | 記述済 |  |
| core/dispenser/ShulkerBoxDispenseBehavior | 12 §4.8 | 記述済 |  |
| core/dispenser/ShearsDispenseItemBehavior | 12 §4.9 | 記述済 |  |
| core/dispenser/FlintAndSteelDispenseItemBehavior | 12 §4.9 | 記述済 |  |
| core/dispenser/MinecartDispenseItemBehavior | 12 §4.10 | 記述済 |  |
| core/dispenser/BoatDispenseItemBehavior | 12 §4.6 | 記述済 |  |
| core/dispenser/SpawnEggItemBehavior | 12 | 記述済 |  |
| core/dispenser/SulfurCubeBlockDispenseItemBehavior | 12 | 記述済 |  |

### 流体 (world/level/material)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/material/Fluid | 16・02 | 記述済 |  |
| world/level/material/FlowingFluid | 16 §4.3〜§4.8 | 記述済 |  |
| world/level/material/WaterFluid | 16 | 記述済 |  |
| world/level/material/LavaFluid | 16 §4.10 | 記述済 |  |
| world/level/material/EmptyFluid | 16 | 記述済 |  |
| world/level/material/FluidState | 16・02 | 記述済 |  |
| world/level/material/Fluids | 16 | 記述済 |  |

### 決定性 (乱数・整数)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| util/Mth | 18 §4.8 | 記述済 |  |
| util/RandomSource | 18 §4.6 | 記述済 |  |
| world/level/levelgen/LegacyRandomSource | 18 §4.6 | 記述済 |  |
| world/level/levelgen/SingleThreadedRandomSource | 18 §4.6 | 記述済 |  |
| world/level/levelgen/BitRandomSource | 18 §4.6 | 記述済 |  |
| world/level/levelgen/XoroshiroRandomSource | 18 §4.6 | 記述済 |  |

### エンティティ

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/entity/Entity | 17 | 記述済 |  |
| world/entity/LivingEntity | 17 | 記述済 |  |
| world/entity/EntitySelector | 09・15・17 | 記述済 |  |
| world/entity/InsideBlockEffectApplier | 17 §4.3 | 記述済 |  |
| world/level/EntityGetter | 17 §4.1 | 記述済 |  |
| world/entity/item/ItemEntity | 17 §4.12 | 記述済 |  |
| world/entity/item/PrimedTnt | 17 §4.13・11 §4.7 | 記述済 |  |
| world/entity/item/FallingBlockEntity | 16 §4.16・17 §4.15 | 記述済 |  |
| world/entity/ExperienceOrb | 17 | 記述済 |  |
| world/entity/LightningBolt | 09 §4.8・17 §4.18 | 記述済 |  |
| world/entity/decoration/ItemFrame | 07・17 §4.10 | 記述済 |  |
| world/entity/decoration/BlockAttachedEntity | 17 §4.10 | 記述済 |  |
| world/entity/decoration/ArmorStand | 05 §4.6.5・17 | 記述済 | マーカーはピストンに押されない |
| world/entity/projectile/Projectile | 17 §4.17 | 記述済 |  |
| world/entity/projectile/arrow/AbstractArrow | 17・09 §4.2 | 記述済 |  |
| world/entity/projectile/arrow/ThrownTrident | 17 | 記述済 |  |
| world/entity/projectile/hurtingprojectile/windcharge/WindCharge | 17 §4.14 | 記述済 |  |
| world/entity/monster/cubemob/SulfurCube | 11 §4.13・17 | 記述済 |  |
| world/entity/animal/golem/CopperGolem | 09 §4.5 | 記述済 | チェストを開ける距離 |
| world/entity/animal/golem/CopperGolemAi | 09 §4.5 | 記述済 | 開け閉めの段 |
| world/entity/animal/allay/Allay | 17 付録 A.2 (音符ブロックを覚える) | 記述済 |  |
| world/entity/animal/allay/AllayAi | 17 付録 A.2 (覚えた音符ブロックと 600 gt) | 記述済 |  |
| world/entity/vehicle/minecart/AbstractMinecart | 15・17 §4.16 | 記述済 |  |
| world/entity/vehicle/minecart/OldMinecartBehavior | 17 §4.16 | 記述済 |  |
| world/entity/vehicle/minecart/NewMinecartBehavior | 15・17 | 記述済 | 概要だけ |
| world/entity/vehicle/minecart/Minecart | 17・15 | 記述済 |  |
| world/entity/vehicle/minecart/MinecartHopper | 17・15・14 | 記述済 |  |
| world/entity/vehicle/minecart/MinecartTNT | 17・15 | 記述済 |  |
| world/entity/vehicle/minecart/MinecartCommandBlock | 15・17 | 記述済 |  |
| world/entity/vehicle/minecart/MinecartChest | 15 §4.10 | 記述済 | 検知レールが読む中身 |
| world/entity/vehicle/minecart/MinecartFurnace | 15 | 記述済 | 検知レールでは 0・アクティベーターレールでは何もしない |
| world/entity/vehicle/minecart/MinecartSpawner | 15 | 記述済 | 同上 |
| world/entity/vehicle/minecart/AbstractMinecartContainer | 14・15 | 記述済 |  |
| world/level/Explosion | 17 §4.14 | 記述済 |  |
| world/level/ServerExplosion | 17 §4.14・18・09 | 記述済 | canTriggerBlocks |
| world/level/ExplosionDamageCalculator | 17 | 記述済 |  |
| world/level/EntityBasedExplosionDamageCalculator | 17 | 記述済 |  |

### コマンド・配置・アイテム

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| server/commands/SetBlockCommand | 04 §4.11 | 記述済 |  |
| server/commands/FillCommand | 04・19 | 記述済 |  |
| server/commands/CloneCommands | 02 §4.8 | 記述済 |  |
| server/commands/TickCommand | 01 §4.8 | 記述済 |  |
| commands/arguments/blocks/BlockInput | 04 §4.11・08 | 記述済 |  |
| world/level/levelgen/structure/templatesystem/StructureTemplate | 08 §4.2 | 記述済 | ストラクチャの配置での形の決め直し |
| world/item/BlockItem | 07・08・11・12 | 記述済 |  |
| world/item/BucketItem | 16 §4.19・12 §4.7 | 記述済 |  |
| world/item/BoneMealItem | 12 §4.9 | 記述済 | 成長の結果 (performBonemeal) は 11 付録 F.0・F.12 |
| world/item/DoubleHighBlockItem | 11 §4.3 | 記述済 |  |
| world/item/EnderEyeItem | 14 §4.10 | 記述済 |  |

### その他

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/BaseCommandBlock | 対象外: コマンドの実行の中身。信号の受け方は CommandBlock として 11 §4.13 | 対象外 |  |
| world/level/BaseSpawner | 03 §4.10 | 記述済 | 湧きそのものは対象外 |
| world/level/NaturalSpawner | 05 §2.1 | 記述済 | 信号源のマスの中には湧かない |

---

## 6. 網羅表 C: hooks-26.3.tsv に無いブロック側のクラス

クラスは net/minecraft/ からの相対。

### レッドストーン部品 (フックの一覧の外で上書きするもの)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/DropperBlock | 12 §4.11 | 記述済 | dispenseFrom と getDispenseMethod の上書き |
| world/level/block/PoweredRailBlock | 15 §4.8 | 記述済 | updateState の上書き |
| world/level/block/RailBlock | 15 §4.7 | 記述済 | updateState の上書き |
| world/level/block/RailState | 15 §4.3〜§4.5 | 記述済 |  |
| world/level/block/PressurePlateBlock | 09 §4.3 | 記述済 |  |
| world/level/block/WeightedPressurePlateBlock | 09 §4.3 | 記述済 |  |
| world/level/block/DoubleBlockCombiner | 14 §4.11・09 §4.5 | 記述済 |  |
| world/level/block/TorchBlock | 08 §4.1 (支えは BaseTorchBlock) | 記述済 | 信号を出さない |
| world/level/block/AirBlock | 05 | 記述済 | 置き換えできる・非導体 |

### コンテナ・アナログ値

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/AbstractChestBlock | 14 §4.11 | 記述済 |  |
| world/level/block/CauldronBlock | 14 §4.10・16 §4.18 | 記述済 |  |
| world/level/block/FurnaceBlock | 14 | 記述済 |  |
| world/level/block/SmokerBlock | 14 | 記述済 |  |
| world/level/block/BlastFurnaceBlock | 14 | 記述済 |  |
| world/level/block/SelectableSlotContainer | 14 | 記述済 |  |
| world/level/block/SideChainPartBlock | 11 §4.12 | 記述済 |  |

### 流体・落下

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/SimpleWaterloggedBlock | 16 §4.11・02 §4.9 表 D | 記述済 |  |
| world/level/block/LiquidBlockContainer | 16 | 記述済 |  |
| world/level/block/BucketPickup | 16・12 §4.7 | 記述済 |  |
| world/level/block/Fallable | 16 §4.15 | 記述済 |  |
| world/level/block/ColoredFallingBlock | 16 | 記述済 |  |
| world/level/block/SandBlock | 16 | 記述済 |  |
| world/level/block/SulfurSpikeBlock | 16・11 付録 F.13 (成長) | 記述済 |  |
| world/level/block/KelpBlock | 16 §4.11 (水)・11 付録 F.5 (F2: 成長)・05 付録 B.16 (F1) | 記述済 | 昆布の自動収穫の入力 |
| world/level/block/KelpPlantBlock | 16 §4.11・05 付録 B.16 (F1: 先端と胴) | 記述済 |  |

### 酸化・色の登録

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/ChangeOverTimeBlock | 14 §4.12・11 §4.8 | 記述済 |  |
| world/level/block/WeatheringCopper | F5 | 記述済 | 段の対応の interface |
| world/level/block/WeatheringCopperCollection | 05 | 記述済 |  |
| world/level/block/ColorCollection | 05 | 記述済 |  |

### 形状更新・成長・支えの族の子 (hooks-26.3.tsv に無い)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/PipeBlock | 05 付録 B.7 (F1: ChorusPlantBlock の親) | 記述済 |  |
| world/level/block/StainedGlassPaneBlock | 05 付録 B.3 (F1: IronBarsBlock の子) | 記述済 |  |
| world/level/block/MangroveLeavesBlock | 05 付録 B.15 (F1: LeavesBlock の子)・11 付録 F.12 (F2: 骨粉で吊りの芽) | 記述済 |  |
| world/level/block/TintedParticleLeavesBlock | 05 付録 B.15 (F1: LeavesBlock の子) | 記述済 |  |
| world/level/block/UntintedParticleLeavesBlock | 05 付録 B.15 (F1: LeavesBlock の子) | 記述済 |  |
| world/level/block/FallingParticlesLeavesBlock | 05 付録 B.15 (F1: LeavesBlock の子) | 記述済 | 26.3 で新設 (19) |
| world/level/block/CarrotBlock | 11 付録 F.1 (F2: CropBlock の子)・05 付録 C.1 (F3) | 記述済 |  |
| world/level/block/PotatoBlock | 11 付録 F.1 (F2: CropBlock の子)・05 付録 C.1 (F3) | 記述済 |  |
| world/level/block/CaveVines | 11 付録 F.5 (F2: 実の有無) | 記述済 |  |
| world/level/block/TwistingVinesBlock | 11 付録 F.5 (F2: GrowingPlantHeadBlock の子)・05 付録 B.16 (F1) | 記述済 |  |
| world/level/block/TwistingVinesPlantBlock | 05 付録 B.16 (F1: GrowingPlantBodyBlock の子) | 記述済 |  |
| world/level/block/WeepingVinesBlock | 11 付録 F.5 (F2: GrowingPlantHeadBlock の子)・05 付録 B.16 (F1) | 記述済 |  |
| world/level/block/WeepingVinesPlantBlock | 05 付録 B.16 (F1: GrowingPlantBodyBlock の子) | 記述済 |  |
| world/level/block/NetherVines | 11 付録 F.5 (F2: 伸びる長さの乱数) | 記述済 |  |
| world/level/block/GrassBlock | 11 付録 F.10・F.12 (F2: 広がりと骨粉で草花)・05 付録 B.12 (F1: snowy) | 記述済 | 広がりは親の SpreadingSnowyBlock |
| world/level/block/BonemealableBlock | 11 付録 F.0・F.12 (F2: 骨粉の結果 performBonemeal) | 記述済 | 撒く側は 12 §4.9 |
| world/level/block/BonemealableFeaturePlacerBlock | 11 付録 F.12 (F2: 骨粉で地物を置く: 苔ほか) | 記述済 | 地物の形は §7 |
| world/level/block/GlowLichenBlock | 05 付録 B.11 (F1・F3: 支えの無い面を消す。MultifaceBlock の子)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/WoolCarpetBlock | 05 付録 C.1 (F3: CarpetBlock の子) | 記述済 |  |
| world/level/block/CactusFlowerBlock | 05 付録 C.1 (F3: サボテンの上)・11 付録 F.3 | 記述済 |  |
| world/level/block/FlowerBlock | 05 付録 C.1 (F3: VegetationBlock の子) | 記述済 |  |
| world/level/block/TallFlowerBlock | 05 付録 C.1 (F3: DoublePlantBlock の子)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/TallGrassBlock | 05 付録 C.1 (F3: VegetationBlock の子)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/BushBlock | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/DryVegetationBlock | 05 付録 C.1 (F3) | 記述済 |  |
| world/level/block/ShortDryGrassBlock | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/TallDryGrassBlock | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/FireflyBushBlock | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉) | 記述済 |  |
| world/level/block/NetherFungusBlock | 05 付録 C.1 (F3)・11 付録 F.12 (F2: 骨粉で巨大菌) | 記述済 |  |
| world/level/block/NetherRootsBlock | 05 付録 C.1 (F3) | 記述済 |  |
| world/level/block/NetherSproutsBlock | 05 付録 C.1 (F3) | 記述済 |  |
| world/level/block/AbstractBannerBlock | 05 付録 C.1 (F3: 旗の親。色と BE を持つだけ) | 記述済 |  |
| world/level/block/SculkVeinBlock | 05 付録 B.11 (F1・F3: 支えの無い面を消す。MultifaceBlock の子) | 記述済 | 初めの照合では対象外。カタリストの広がりは対象外のまま (10 §1.2) |
| world/level/block/MultifaceSpreadeableBlock | 05 付録 B.11 (F1: 光る地衣類とスカルクの脈の親。面の規則は MultifaceBlock のまま)・11 付録 F.12 (F2: 光る地衣類の骨粉) | 記述済 | 初めの照合では対象外 |
| world/level/block/MyceliumBlock | 05 付録 B.12 (F1: snowy)・11 付録 F.10 (F2: 広がりと土への戻り) | 記述済 | 初めの照合では対象外 (見た目の粒だけ)。規則は親の SpreadingSnowyBlock |
| world/level/block/NetherrackBlock | 11 付録 F.12 (F2: 骨粉で周りと同じナイリウムに変わる) | 記述済 | 初めの照合では対象外 |
| world/level/block/RootedDirtBlock | 11 付録 F.12 (F2: 骨粉で真下に hanging_roots) | 記述済 | 初めの照合では対象外 |
| world/level/block/BonemealSource | 11 付録 F.0 (骨粉の出どころ。26.3 で新設) | 記述済 | 初めの照合では対象外。26.3 で値によって結果を変えるブロックは無い |
| world/level/block/BaseCoralPlantBlock | 05 付録 C.1 (F3: 死んだサンゴ。存続の判定は親の BaseCoralPlantTypeBlock) | 記述済 | 補充で足した行 |
| world/level/block/BaseCoralFanBlock | 05 付録 C.1 (F3: 死んだサンゴの扇) | 記述済 | 補充で足した行 |
| world/level/block/grower/TreeGrower | 11 付録 F.7 (F2: 苗木が木になる手順と書き込みのフラグ) | 記述済 | 補充で足した行。木の形は §7 |

### BlockEntity (hooks-26.3.tsv に無い)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/entity/ComparatorBlockEntity | 07 | 記述済 |  |
| world/level/block/entity/DaylightDetectorBlockEntity | 09 §4.9 | 記述済 |  |
| world/level/block/entity/DispenserBlockEntity | 12 §4.3 | 記述済 |  |
| world/level/block/entity/DropperBlockEntity | 12 §4.3 | 記述済 |  |
| world/level/block/entity/CrafterBlockEntity | 12 §4.15・§4.16 | 記述済 |  |
| world/level/block/entity/LecternBlockEntity | 09 §4.6 | 記述済 |  |
| world/level/block/entity/SculkSensorBlockEntity | 10 | 記述済 |  |
| world/level/block/entity/CalibratedSculkSensorBlockEntity | 10 | 記述済 |  |
| world/level/block/entity/TrappedChestBlockEntity | 09 §4.5 | 記述済 |  |
| world/level/block/entity/ContainerOpenersCounter | 03 §4.8・09 §4.5・14 | 記述済 |  |
| world/level/block/entity/ChiseledBookShelfBlockEntity | 14 §4.10 | 記述済 |  |
| world/level/block/entity/ShelfBlockEntity | 11 §4.12・14 | 記述済 |  |
| world/level/block/entity/BarrelBlockEntity | 14 | 記述済 |  |
| world/level/block/entity/BrewingStandBlockEntity | 14 §4.1 | 記述済 | HAS_BOTTLE の書き込みは未記載 (§3 の O-1) |
| world/level/block/entity/AbstractFurnaceBlockEntity | 14 §4.1・§4.10 | 記述済 | LIT の書き込みは未記載 (§3 の O-1) |
| world/level/block/entity/FurnaceBlockEntity | 14 (親の式) | 記述済 |  |
| world/level/block/entity/SmokerBlockEntity | 14 (親の式) | 記述済 |  |
| world/level/block/entity/BlastFurnaceBlockEntity | 14 (親の式) | 記述済 |  |
| world/level/block/entity/BaseContainerBlockEntity | 14 | 記述済 |  |
| world/level/block/entity/RandomizableContainerBlockEntity | 14 | 記述済 |  |
| world/level/block/entity/ListBackedContainer | 14 | 記述済 |  |
| world/level/block/entity/CommandBlockEntity | 11 §4.13・14 | 記述済 |  |
| world/level/block/entity/StructureBlockEntity | 11 §4.13 | 記述済 | 中身は対象外 |
| world/level/block/entity/TestBlockEntity | 11 §4.13 | 記述済 |  |
| world/level/block/entity/PotentSulfurBlockEntity | 11 §4.10・03 | 記述済 |  |
| world/level/block/entity/BrushableBlockEntity | 16・02 §4.9 表 B | 記述済 |  |
| world/level/block/entity/BlockEntityType | 01 §4.7 | 記述済 | その状態に対して有効な種類か |
| world/level/block/entity/BlockEntityTypes | 14・07 | 記述済 |  |
| world/level/block/entity/SculkCatalystBlockEntity | 対象外: 信号を出さない。予約 8 gt は 02 §4.9 表 A | 対象外 |  |
| world/level/block/entity/SculkShriekerBlockEntity | 対象外: 信号を出さない。予約 90 gt は 02 §4.9 表 A | 対象外 |  |
| world/level/block/entity/CopperGolemStatueBlockEntity | 対象外: 値は blockstate の POSE から出る (14 §4.10)。BE は見た目だけ | 対象外 |  |

### 状態のプロパティ (state/properties)

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/state/properties/BlockStateProperties | 05 §3.1 | 記述済 |  |
| world/level/block/state/properties/Property | 05 §3.2 | 記述済 |  |
| world/level/block/state/properties/BooleanProperty | 05 §3.2 | 記述済 |  |
| world/level/block/state/properties/IntegerProperty | 05 §3.2 | 記述済 |  |
| world/level/block/state/properties/EnumProperty | 05 §3.2 | 記述済 |  |
| world/level/block/state/properties/ComparatorMode | 07 | 記述済 |  |
| world/level/block/state/properties/RedstoneSide | 06 | 記述済 |  |
| world/level/block/state/properties/PistonType | 13 | 記述済 | normal / sticky |
| world/level/block/state/properties/RailShape | 15 | 記述済 |  |
| world/level/block/state/properties/SculkSensorPhase | 10 | 記述済 |  |
| world/level/block/state/properties/BlockSetType | 09・11 §3.3 | 記述済 | 矢で押せるか・手で開くか・感圧板の感知の種類 |
| world/level/block/state/properties/AttachFace | 09 | 記述済 | face |
| world/level/block/state/properties/BellAttachType | 11 §4.6 | 記述済 | attachment |
| world/level/block/state/properties/Tilt | 11 §4.9 | 記述済 |  |
| world/level/block/state/properties/ChestType | 14 §4.11 | 記述済 |  |
| world/level/block/state/properties/DoorHingeSide | 11 §4.3 | 記述済 |  |
| world/level/block/state/properties/DoubleBlockHalf | 11 §4.3 | 記述済 |  |
| world/level/block/state/properties/Half | 11 §4.4・05 | 記述済 |  |
| world/level/block/state/properties/SlabType | 05 §4.4 | 記述済 |  |
| world/level/block/state/properties/NoteBlockInstrument | 11 §4.2 | 記述済 |  |
| world/level/block/state/properties/PotentSulfurState | 11 §4.10 | 記述済 |  |
| world/level/block/state/properties/SideChainPart | 11 §4.12 | 記述済 |  |
| world/level/block/state/properties/SpeleothemThickness | 16 | 記述済 |  |
| world/level/block/state/properties/CreakingHeartState | 14 §4.10 | 記述済 |  |
| world/level/block/state/properties/StructureMode | 11 §4.13 | 記述済 |  |
| world/level/block/state/properties/TestBlockMode | 11 §4.13 | 記述済 |  |
| world/level/block/state/properties/StairsShape | 05 付録 B.1・B.6 (F1: 階段の形) | 記述済 |  |
| world/level/block/state/properties/WallSide | 05 付録 B.1・B.2 (F1: 塀の辺) | 記述済 |  |
| world/level/block/state/properties/BambooLeaves | 11 付録 F.4 (F2: 竹の葉) | 記述済 |  |
| world/level/block/state/properties/BedPart | 対象外: ベッドの半分 | 対象外 |  |
| world/level/block/state/properties/RotationSegment | 対象外: 看板・旗・頭の 16 方位 | 対象外 |  |
| world/level/block/state/properties/WoodType | 対象外: 木の種類の登録 (BlockSetType と音の組) | 対象外 |  |

### 対象外の補助・見た目・データ

| クラス | 担当 / 対象外の理由 | 状態 | 備考 |
|---|---|---|---|
| world/level/block/BedBlock | 対象外: AbstractBedBlock と同じ | 対象外 |  |
| world/level/block/StrawBedBlock | 対象外: 26.3 で新設のベッド (19) | 対象外 |  |
| world/level/block/TrialSpawnerBlock | 対象外: 試練の間の湧き。プレイヤーと湧いたモブで状態が変わるだけ | 対象外 |  |
| world/level/block/SculkBlock | 対象外: カタリストの広がり (信号を出さない) | 対象外 |  |
| world/level/block/SculkSpreader | 対象外: 同上 | 対象外 |  |
| world/level/block/SculkBehaviour | 対象外: 同上 | 対象外 |  |
| world/level/block/MultifaceSpreader | 対象外: 骨粉・カタリストでの面の広がり | 対象外 | 光る地衣類の骨粉の結果は 11 付録 F.12 |
| world/level/block/CryingObsidianBlock | 対象外: 見た目の粒 | 対象外 |  |
| world/level/block/StructureVoidBlock | 対象外: 構造物の道具 | 対象外 |  |
| world/level/block/BeaconBeamBlock | 対象外: ビーコンの光の色 | 対象外 |  |
| world/level/block/TransparentBlock | 05 §4.4.2 (非導体のフルブロック) | 記述済 | クラスはフックを持たない |
| world/level/block/HalfTransparentBlock | 05 §4.4.2 | 記述済 |  |
| world/level/block/StainedGlassBlock | 05 §4.4.2 | 記述済 |  |
| world/level/block/TintedGlassBlock | 05 §4.4.2 | 記述済 |  |
| world/level/block/PlayerHeadBlock | 11 §4.11 (親の AbstractSkullBlock) | 記述済 |  |
| world/level/block/PlayerWallHeadBlock | 11 §4.11 | 記述済 |  |
| world/level/block/PiglinWallSkullBlock | 11 §4.11 | 記述済 |  |
| world/level/block/EntityBlock | 01 §4.7 | 記述済 | BE と ticker の作り方 |
| world/level/block/DirectionalBlock | 対象外: FACING を持つだけの親 | 対象外 |  |
| world/level/block/HorizontalDirectionalBlock | 対象外: 同上 | 対象外 |  |
| world/level/block/GameMasterBlock | 対象外: 管理者だけが置ける印 | 対象外 |  |
| world/level/block/Portal | 対象外: ポータルの interface | 対象外 |  |
| world/level/block/LevelEvent | 対象外: クライアントの音と粒の番号 | 対象外 |  |
| world/level/block/SoundType | 対象外: 音 | 対象外 |  |
| world/level/block/RenderShape | 対象外: 描き方 | 対象外 |  |
| world/level/block/Mirror | 対象外: 構造物の配置での鏡映 | 対象外 |  |
| world/level/block/Rotation | 対象外: 構造物の配置での回転 | 対象外 |  |
| world/level/block/SuspiciousEffectHolder | 対象外: 怪しいシチューの効果 | 対象外 |  |
| world/level/block/state/SolidDebugger | 対象外: 開発用 (19) | 対象外 |  |
| world/level/block/state/pattern/BlockPattern | 対象外: 形の照合の道具。照合の手順は 17 付録 A.1 | 対象外 |  |
| world/level/block/state/pattern/BlockPatternBuilder | 対象外: 同上 | 対象外 |  |
| world/level/block/state/pattern/BlockInWorld | 対象外: 同上 | 対象外 |  |
| world/level/block/entity/ChestLidController | 対象外: 蓋の動きの見た目 | 対象外 |  |
| world/level/block/entity/LidBlockEntity | 対象外: 同上 | 対象外 |  |
| world/level/block/entity/CampfireBlockEntity | 対象外: 焼くアイテムの時間 | 対象外 |  |
| world/level/block/entity/SkullBlockEntity | 対象外: 頭の持ち主と口の動き | 対象外 |  |
| world/level/block/entity/TrialSpawnerBlockEntity | 対象外: TrialSpawnerBlock と同じ | 対象外 |  |

---

## 7. クラス単位で数えない対象外の範囲

| 範囲 | 理由 |
|---|---|
| モブがブロックを書き換える行動 (羊が草を食べる・村人の農作業とコンポスター・エンダーマン・ウサギ・キツネ・ハチの受粉・雪だるまの雪・ラヴェジャー) | オブザーバーで拾えるが、行動は AI と乱数で決まる。回路の部品ではない。村人がドアを開ける所とベルを鳴らす所は 11 §4.3・§4.6、ハチの受粉で作物が育つときの書き込み (フラグ 3) は 11 付録 F.0 にある |
| 木・巨大キノコ・巨大菌の形 (地物の配置) | 骨粉や成長の契機と、前後の書き込みは 11 付録 F.7・F.12 にある。置かれる形は地物の乱数で決まる |
| 描画・音・粒・クライアントの予測 | サーバーの状態に効かない。ブロックイベントのうち見た目だけのものは 03 §4.10 |
| setblock・fill・clone・tick 以外のコマンド | 回路の外。4 つのコマンドの経路は 01・02・04 |
| 26.4-pre-1 で増えたクラス (BrittleIceBlock・CrackingIceBlock・IceCrystalBlock・IcicleBlock・AbstractCrystalClusterBlock・DropExperienceEntityBlock ほか) | 基準の 26.3 に無い。→ 19_version-diffs.md |

---

## 8. 典拠

この表の判定のために読んだ所 (各メモの典拠に無いもの):

- 26.3 world/level/block 配下の全クラスの、34 個のフックの宣言 (注釈つきの戻り値を含めて数え直した。§4.3) — PL・TK の欄
- 26.3 RedstoneLampBlock・Block・BlockBehaviour#canSurvive — ランプと石が支えを求めないこと
- 26.3 WallBlock#updateShape・#connectsTo・#shouldRaisePost・#makeWallState — 塀の辺と柱
- 26.3 FenceBlock#connectsTo・#isSameFence・#updateShape — 柵の接続
- 26.3 IronBarsBlock#attachsTo・#updateShape — 板ガラス・鉄格子の接続
- 26.3 Block#isExceptionForConnection — 面が頑丈でもつながらない例外
- 26.3 StairBlock#updateShape、ChorusPlantBlock#updateShape、HugeMushroomBlock#updateShape、MossyCarpetBlock#updateShape、VineBlock#updateShape、MultifaceBlock#updateShape、SnowyBlock#updateShape — F1
- 26.3 AttachedStemBlock#updateShape — 実が消えると AGE 7 の茎へ
- 26.3 GrowingPlantHeadBlock#updateShape・GrowingPlantBodyBlock#updateShape — 先端と胴の入れ替えと 1 gt の予約
- 26.3 BambooStalkBlock#updateShape — 上の竹の AGE に合わせる
- 26.3 CampfireBlock#updateShape・#isSmokeSource — 干し草の俵で SIGNAL_FIRE
- 26.3 LeavesBlock#updateShape — DISTANCE の予約
- 26.3 BeehiveBlock#updateShape — 隣が火なら蜂を出すだけ
- 26.3 CopperChestBlock#updateShape — 酸化段階の違う相方へ合わせる
- 26.3 各クラスの canSurvive (F2・F3 の 61 クラスで、自分か親が上書きするかを確かめた)、FlowerPotBlock#updateShape、WallHangingSignBlock#updateShape — 上書きの無い 2 例
- 26.3 FlowerPotBlock#isRandomlyTicking・#randomTick — 鉢のアイブロッサム
- 26.3 RedStoneOreBlock#attack・#stepOn・#useItemOn・#interact・#randomTick — G-1
- 26.3 FireBlock#tick・#checkBurnOut — G-2
- 26.3 CarvedPumpkinBlock#onPlace・#trySpawnGolem・#clearPatternBlocks・#updatePatternBlocks、WitherSkullBlock#setPlacedBy・#checkSpawn — G-3
- 26.3 Allay (振動の聞き手の受け付け)・AllayAi (覚えた音符ブロックと 600 gt) — G-4
- 26.3 AbstractFurnaceBlockEntity#serverTick・BrewingStandBlockEntity#serverTick — O-1
- 26.3 VaultBlockEntity (サーバー側の tick)・BeaconBlockEntity の tick・ShearsDispenseItemBehavior (かぼちゃを扱わないこと) — 対象外の確認
- 26.3 world/level/block 配下で scheduleTick・blockEvent・updateNeighbourForOutputSignal・hasNeighborSignal・getSignal を呼ぶクラスの一覧 — C の補い
- 26.3 BaseCoralPlantBlock・BaseCoralFanBlock (34 個のフックを宣言しない。Blocks で死んだサンゴ 5 種と扇 5 種の登録に使う)・grower/TreeGrower — 補充で足した 3 行
- 26.3 MultifaceSpreadeableBlock (GlowLichenBlock と SculkVeinBlock の親)・MyceliumBlock (SpreadingSnowyBlock の子) — 対象外から移した行
- 補充の後の状態の典拠は各付録の典拠一覧である: 05 付録 H、09 付録 A.12、11 付録 F.18、17 付録 A.3
