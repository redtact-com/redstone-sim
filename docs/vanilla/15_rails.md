# 15. レール・パワードレール・アクティベーターレール・ディテクターレール

Java 版 26.3 のデコンパイルを読んで書いた、実装用のメモ。写経ではなく、条件・順序・数値を自分の言葉でまとめる (docs/ip-policy.md)。

確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた (典拠のクラス#メソッドを添える)
- [実機 1.21.1: 名前] tools/mc-harness/fixtures/ の fixture が裏づける
- [要実機] 読んだだけでは決めきれない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

このメモだけの記号:

| 記号 | 意味 |
|---|---|
| P | 注目しているレールの座標 |
| P↑ / P↓ | P の真上 / 真下 |
| NC6(X) | X を中心に 6 方向 (西・東・下・上・北・南) へ配る NC。MultiNeighborUpdate |
| NC1→X | X だけへ届く NC。積んだ時点の状態で走る FullNeighborUpdate |
| SU6(X) | X から 6 方向 (西・東・北・南・下・上) への形状更新 |
| CU(X) | X からのコンパレーター更新 (北・東・南・西。導体 1 個越しも) |
| 撤去フック | 古い状態の affectNeighborsAfterRemoval |
| C1・C2 | 形が決める接続先の 1 番目・2 番目の座標 (§3.2) |
| updateState (設置用) | BaseRailBlock の updateState のうち、最後の引数が「ピストンで動いたか」の版。決めた状態を返す。onPlace から呼ぶ |
| updateState (近隣更新用) | 最後の引数が送り元のブロックの版。何も返さない。neighborChanged から呼ぶ。RailBlock と PoweredRailBlock が上書きする |

NC・SU・CU の積み方と入れ子の順は → 04_set-block-and-updates.md。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 役割 |
|---|---|
| BaseRailBlock | 4 種の親。置く向き・支え・設置フック・近隣更新・撤去フック・回転 |
| RailBlock | 通常レール。曲線を取る。分岐の向きの切り替え |
| PoweredRailBlock | パワードレールとアクティベーターレール (同じクラスの別インスタンス)。電力の探索 |
| DetectorRailBlock | ディテクターレール (検知レール)。トロッコの検出・信号・アナログ出力 |
| RailState | 形の自動接続 (place・connectTo) |
| RailShape・BlockStateProperties | 形の 10 値と、直線用の 6 値の部分集合 |
| Blocks・data の tags/block/rails.json | 登録 (性質) とタグ rails |
| LevelChunk#setBlockState | 「新しいブロックがレールなら同じブロックでも撤去フックを呼ぶ」条件 |
| Level#setBlock・removeBlock・updateNeighbourForOutputSignal | 書き込みと更新の出し方 (確かめる範囲) |
| CollectingNeighborUpdater | FullNeighborUpdate が状態を固定すること (確かめる範囲) |
| SignalGetter#hasNeighborSignal | 「受電しているか」の実体 |
| Block#canSupportRigidBlock・SupportType | 支えの判定 |
| PistonMovingBlockEntity | 押されたレールの着地 (確かめる範囲) |
| SetBlockCommand・ServerLevel#updateNeighboursOnBlockSet | /setblock の経路 (版差の確認) |
| AbstractMinecart・OldMinecartBehavior・NewMinecartBehavior | アクティベーターレールの効果を呼ぶ所・検出の契機 |
| Minecart・MinecartHopper・MinecartTNT・MinecartCommandBlock | activateMinecart の中身 |
| EntitySelector・AbstractContainerMenu#getRedstoneSignalFromContainer・EntityTypes | 検知レールのアナログ値・トロッコの大きさ |

回転・鏡映 (rotate・mirror。構造物の配置だけで効く) と状態の定義を除くと、BaseRailBlock の系統でフックを上書きするのは次の 2 クラスだけである [26.3 読解]。

- BaseRailBlock: neighborChanged・updateShape・onPlace・affectNeighborsAfterRemoval・getStateForPlacement・canSurvive・getShape・getFluidState
- DetectorRailBlock: isSignalSource・ownSignal・getDirectSignal・hasAnalogOutputSignal・getAnalogOutputSignal・tick・onPlace・entityInside

RailBlock と PoweredRailBlock は、BaseRailBlock の内部の updateState (近隣更新用) を上書きするだけである。
updateState は 2 つとも引数が 4 つで (1.21.1 も同じ)、最後の 1 つ (動いたか・送り元のブロック) で区別する。「3 引数版」は無い。
ActivatorRailBlock というクラスは無い。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick の相の順 (検知は L12、予約 tick は L6、着地は L13) | → 01_tick-loop.md |
| 予約 tick の並び・重複排除 | → 02_scheduled-ticks.md |
| NC・SU・CU の積み方、setBlock のフラグ、/setblock の経路 | → 04_set-block-and-updates.md |
| hasNeighborSignal の中身 (強/弱・導体)・SupportType・信号源の一覧 | → 05_signals-and-block-properties.md |
| ダストが検知レールへ繋がること | → 06_redstone-wire.md |
| コンパレーターがアナログ値で置き換える読み方 | → 07_diodes.md |
| ピストンの押し構造・moving_piston | → 13_pistons.md |
| 容器の充填率の式 | → 14_containers-hoppers-analog.md |
| 水を含んだレールの水流 | → 16_fluids-falling-blocks.md |
| トロッコの移動・加速・検出の位相・爆発・getEntitiesOfClass の順 | → 17_entities-interplay.md・18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 4 種と 2 つの機構

レールは「形 (shape)」と「電力 (powered)」を別々に持つ。

| ブロック | クラス | isStraight | 形 | powered | 信号源 | アナログ出力 |
|---|---|---|---|---|---|---|
| rail | RailBlock | 偽 | 10 値 (曲線あり) | 持たない | いいえ | いいえ |
| powered_rail | PoweredRailBlock | 真 | 直線 6 値 | 探索で決まる | いいえ | いいえ |
| activator_rail | PoweredRailBlock (別インスタンス) | 真 | 直線 6 値 | 探索で決まる | いいえ | いいえ |
| detector_rail | DetectorRailBlock | 真 | 直線 6 値 | トロッコで決まる | はい | はい |

- 形の接続はタグ rails で判定するので、種類をまたいで繋がる [実機 1.21.1: rail-mixed-neighbor-shape]。
- 電力の探索は「自分と同じブロック」しか辿らない。パワードとアクティベーターは混ざらない [実機 1.21.1: activator-rail-mixed-chain]。
- 4 種とも当たり判定なし・硬さ 0.7・押し反応は既定 (押せる)・BlockEntity なし [26.3 読解: Blocks]。当たり判定が空なので導体ではない。

### 2.2 何がいつ走るか

| 契機 | 入口 | 形 | 電力 (パワード系) | 検知レール |
|---|---|---|---|---|
| 別のブロックから置き換わる (設置・着地) | onPlace | place (first=真) で決め、相手を connectTo | 自分への NC1 で探索 | 続けて checkPressed |
| 近隣更新 | neighborChanged | 支えが無ければ壊れる。通常レールは分岐の門番を通れば place (first=偽) | 探索し直す | 支えの判定だけ |
| 形状更新 | updateShape | 変えない (水を含めば水の予約だけ) | — | — |
| エンティティが中にいる (L12) | entityInside | — | — | powered が偽なら checkPressed |
| 予約 tick (L6) | tick | — | — | powered が真なら checkPressed |

形が変わるのは「自分が置かれた」「繋がる相手が置かれた」「通常レールの分岐が信号源の更新を受けた」の 3 つだけである。隣が壊れても形は戻らない。
例外は分岐の門番を通る場合だけである。壊れたブロックが信号源 (検知レールを含む) で、壊れた後の潜在接続がちょうど 3 の通常レールは、その NC で決め直す (§4.7・§5.5)。

### 2.3 1 回の書き込みで出る更新 (レール特有)

LevelChunk#setBlockState は、ブロックの種類が同じでも**新しいブロックがレールなら**、フラグ 1 か 64 があるとき古い状態の撤去フックを呼ぶ [26.3 読解: LevelChunk#setBlockState]。
BaseRailBlock#affectNeighborsAfterRemoval は、ピストンで動いたのでなければ「古い形が坂なら NC6(P↑)、直線レールなら NC6(P) → NC6(P↓)」を出す。
だからレールが自分を書き換えるたびに、撤去フックの NC が先頭に付く。docs/research/07 の MC-231071 (重複した更新) の実体の 1 つである。

(A) パワード系の電力の反転 (PoweredRailBlock の updateState)

| 順 | 出所 | 平らな形 | 坂 |
|---|---|---|---|
| 1 | 撤去フック | NC6(P) → NC6(P↓) | NC6(P↑) → NC6(P) → NC6(P↓) |
| 2 | 設置フック | 何もしない (同じブロック) | 同左 |
| 3 | setBlock のフラグ 1 | NC6(P) | NC6(P) |
| 4 | setBlock の SU | SU6(P) | SU6(P) |
| 5 | updateState の続き | NC6(P↓) | NC6(P↓) → NC6(P↑) |

件数 (上限の数え方 → 04 §4.3) は平らで 10、坂で 12 である。

(B) 検知レールの反転 (DetectorRailBlock#checkPressed)

| 順 | 出所 | 更新 |
|---|---|---|
| 1 | 撤去フック | (坂なら NC6(P↑)) → NC6(P) → NC6(P↓) |
| 2 | フラグ 1 | NC6(P) → CU(P) |
| 3 | SU | SU6(P) |
| 4 | updatePowerToConnected | NC1→C1 → NC1→C2 |
| 5 | 続き | NC6(P) → NC6(P↓) |
| 6 | 予約 | トロッコがいれば 20 gt 後 (優先度 0) |
| 7 | 続き | CU(P) |

反転しない checkPressed は、トロッコが居続けるなら 6 と 7、トロッコ以外のエンティティだけが入ったなら 7 だけである (6 はトロッコがいるときだけ積む)。

(C) 形の書き換え (place・connectTo・分岐の切り替え)

| ブロック | 撤去フック | フラグ 1 | SU |
|---|---|---|---|
| 通常レール | 古い形が坂なら NC6(P↑) | NC6(P) | SU6(P) |
| パワード系 | (古い形が坂なら NC6(P↑)) → NC6(P) → NC6(P↓) | NC6(P) | SU6(P) |
| 検知レール | 同上 | NC6(P) → CU(P) | SU6(P) |

**形が変わらない書き込みは何も出さない**。同じ状態の setBlock は空振りする (→ 04 §5.1)。

(D) 撤去 (removeBlock・destroyBlock。フラグ 3、動いていない)

撤去フック (坂なら NC6(P↑)、直線なら NC6(P) → NC6(P↓)) → フラグ 1 の NC6(P) (送り元はレール) → SU6(P)。
新しい状態 (空気・水) はアナログ出力を持たないので CU は出ない。

入れ子かどうかで走る時点が変わる (→ 04 §2.2)。

- (A) は neighborChanged の中で起きるので、いつも入れ子である。1〜5 は積まれるだけで、updateState が戻った後に**積んだ順に**走る。各更新から出た連鎖は、その場で深さ優先に走り切る。
- (B) は entityInside (ふつうは L12。ピストンに押されたトロッコなら L13。§5.12)・予約 tick (L6)・onPlace から呼ばれ、ふつうは最外である。1〜7 はそれぞれ、その場で連鎖ごと走り切る。

---

## 3. 状態とデータ

### 3.1 blockstate

| ブロック | プロパティ | 値域 | 既定 | 状態の数 |
|---|---|---|---|---|
| rail | shape | 10 値 | north_south | 20 |
| | waterlogged | 真/偽 | 偽 | |
| powered_rail・activator_rail | shape | 直線 6 値 | north_south | 24 |
| | powered | 真/偽 | 偽 | |
| | waterlogged | 真/偽 | 偽 | |
| detector_rail | shape・powered・waterlogged | 同上 | 同上 | 24 |

直線 6 値は north_south・east_west・ascending_east・ascending_west・ascending_north・ascending_south である。曲線 4 値 (south_east・south_west・north_west・north_east) を除いた部分集合になっている [26.3 読解: BlockStateProperties の RAIL_SHAPE_STRAIGHT]。
BlockEntity は持たない。検知レールのアナログ値は、読むたびにエンティティを数えて作る (保持しない)。

### 3.2 形と接続先

RailState が形から作る接続先 (updateConnections)。並びはこの表のとおりで、place の後の connectTo もこの順に回る [26.3 読解]。

| 形 | C1 | C2 | 軸 | 高い側 |
|---|---|---|---|---|
| north_south | 北 | 南 | 南北 | |
| east_west | 西 | 東 | 東西 | |
| ascending_east | 西 | 東の 1 段上 | 東西 | 東 |
| ascending_west | 西の 1 段上 | 東 | 東西 | 西 |
| ascending_north | 北の 1 段上 | 南 | 南北 | 北 |
| ascending_south | 北 | 南の 1 段上 | 南北 | 南 |
| south_east | 東 | 南 | — | |
| south_west | 西 | 南 | — | |
| north_west | 西 | 北 | — | |
| north_east | 東 | 北 | — | |

外形 (outline) は、平らなら高さ 2/16、坂なら 8/16 の板である。当たり判定は無い。

### 3.3 定数

| 名前 | 値 | 典拠 |
|---|---|---|
| 電力の探索の深さ | 深さ 8 で打ち切る。受電したレールから 8 本先まで届く | PoweredRailBlock#findPoweredRailSignal |
| 検知の確認の周期 | 20 gt (優先度 0) | DetectorRailBlock の PRESSED_CHECK_PERIOD |
| 検知の箱 | x+0.2〜x+0.8・y〜y+0.8・z+0.2〜z+0.8 | DetectorRailBlock#getSearchBB |
| 検知レールの信号 | 弱い信号 15 を 6 方向へ、強い信号 15 を真下だけへ | ownSignal・getDirectSignal |
| トロッコの大きさ | 幅 0.98・高さ 0.7 (全種) | EntityTypes |
| コマンドブロック付きトロッコの再実行 | 前回から 4 tick 以上 | MinecartCommandBlock#activateMinecart |
| TNT 付きトロッコの導火線 | 80 tick | MinecartTNT#primeFuse |

---

## 4. 処理の詳細

### 4.1 置く向きと支え

BaseRailBlock#getStateForPlacement [26.3 読解]:

1. 置く座標の流体が水源なら waterlogged を真にする。流れる水では偽。
2. プレイヤーの水平の向きが東か西なら east_west、それ以外は north_south にする。この形が place の defaultShape になる。

BaseRailBlock#canSurvive: 真下が canSupportRigidBlock (上面が SupportType の RIGID を満たす) なら置ける。
RIGID は「面の外周 2/16 の輪を覆う」判定なので、ホッパーの上面 (外周の輪) は通り、下付きハーフブロックは通らない [26.3 読解: SupportType・HopperBlock] (→ 05)。

shouldBeRemoved (neighborChanged から) [26.3 読解: BaseRailBlock]:

1. 真下が RIGID の支えでなければ壊れる。
2. 坂なら、高い側の水平の隣 (ascending_east なら東) も RIGID の支えでなければ壊れる。見るのはその隣のブロックの**上面**である。canSupportRigidBlock は、渡された座標のブロックの上面をいつも問う。レールに向いた側面は見ない [26.3 読解: Block#canSupportRigidBlock]。

[実機 1.21.1: rail-support-break] [実機 1.21.1: rail-slope-support-break]

- 支えを確かめるのは NC を受けたときだけである。updateShape (SU) では確かめない。
- canSurvive (真下だけ) は、プレイヤーが置くときの判定と、検知レールの checkPressed の入口でだけ使う。checkPressed は坂の高い側の支えを見ない。

### 4.2 設置フック (onPlace) と updateDir

契機は LevelChunk#setBlockState。古い状態が同じブロックなら何もしない [26.3 読解: BaseRailBlock#onPlace]。

手順 [26.3 読解: BaseRailBlock の updateState (設置用)・updateDir]:

1. updateDir (first=真): P の hasNeighborSignal を読み、今の状態で RailState を作り、place (hasSignal・first=真・defaultShape=今の形) を呼ぶ。決まった状態を受け取る。
2. 直線レール (パワード系・検知) なら NC1→P を出す。積む状態は 1 の結果、送り元は自分のブロック、「動いた」は設置フックの引数のまま。
3. 決まった状態を返す。検知レールの onPlace は、その状態で続けて checkPressed を呼ぶ (§4.10)。

通常レールには 2 が無い。置いた通常レールは自分の分岐の門番を通らない (形は place の hasSignal で決まる)。

最外 (プレイヤーの設置・/setblock・着地) では、1 の中の書き込みも 2 の NC1 も、その場で連鎖ごと走り切る。
その結果 P の状態が「置こうとした状態」から変わると、外側の Level#setBlock は読み直しで違いを見つけ、自分の NC と SU を出さない (→ 04 §5.5)。
/setblock の後始末 (updateNeighboursOnBlockSet) はこれと別に走るので、NC6(P) (送り元は新しいブロック) はそちらから出る。検知レールはアナログ出力を持つので、CU(P) も続く [26.3 読解: ServerLevel#updateNeighboursOnBlockSet]。

### 4.3 RailState の部品

| 部品 | 動き |
|---|---|
| isRail | タグ rails に入り、BaseRailBlock の派生であること |
| getRail(X) | X → X の 1 段上 → X の 1 段下 の順に見て、最初のレールの RailState を作る。接続先はその時点の形から作る。無ければ無し |
| hasRail(X) | 同じ 3 マスのどれかがレールか |
| hasConnection(Y) | 接続の一覧に、Y と x・z が同じ座標があるか。**高さは見ない** |
| connectsTo(R) | hasConnection(R の座標) |
| removeSoftConnections | 一覧を先頭から見る。各座標で getRail が見つかり、その相手が自分の x・z を接続に持てば、座標を相手の本当の座標に置き換える。そうでなければ一覧から外す。残るのは相互の接続だけ |
| canConnectTo(R) | connectsTo(R) が真、または一覧の長さが 2 でない |
| hasNeighborRail(X) | getRail(X) が無ければ偽。あれば相手を removeSoftConnections してから canConnectTo(自分) |
| countPotentialConnections | 北・東・南・西のうち hasRail が真の方向の数 |

どれも世界を読むだけで書かない。書くのは place と connectTo の中だけである [26.3 読解: RailState]。

### 4.4 RailState#place

引数は hasSignal・first・defaultShape [26.3 読解: RailState#place]。

1. 北・南・西・東の順に hasNeighborRail を求め、n・s・w・e とする。
2. 片軸だけ: 南北 (n か s) だけなら north_south、東西 (w か e) だけなら east_west。
3. 通常レールだけ: 直交のちょうど 2 方向なら曲線。s と e だけ → south_east、s と w だけ → south_west、n と w だけ → north_west、n と e だけ → north_east。
4. まだ決まらない (両軸にいる、またはどこにもいない) とき:
   1. 両軸にいれば defaultShape にする。
   2. 通常レールなら曲線を選び直す。hasSignal が真なら SE・SW・NE・NW の順、偽なら NW・NE・SW・SE の順に、「その 2 方向がそろっていれば上書き」する。最後に上書きしたものが残る。
5. 坂への昇格: 形が north_south なら、北の 1 段上にレールがあれば ascending_north、南の 1 段上にあれば ascending_south (後勝ちで南)。east_west なら、東の 1 段上 → ascending_east、西の 1 段上 → ascending_west (後勝ちで西)。曲線と、defaultShape から来た坂には効かない。
6. まだ無ければ defaultShape にする。
7. 接続の一覧を、決めた形の C1・C2 にする。
8. first が真か、世界の今の状態と違うときだけ:
   1. P を setBlockAndUpdate (フラグ 3) で書く。同じ状態なら空振りする。
   2. C1・C2 の順に getRail を探す。相手がいれば相手を removeSoftConnections し、canConnectTo(自分) が真なら相手の connectTo(自分) を呼ぶ。

4 の 1 の後に続く「片軸だけ」の 2 分岐は、2 で必ず決まっているので到達しない。

分岐 (3 方向・4 方向) の結果 [26.3 読解] [実機 1.21.1: rail-junction-place]:

| 相手のいる方向 | hasSignal 偽 | hasSignal 真 |
|---|---|---|
| 北・南・東 | south_east | north_east |
| 北・南・西 | south_west | north_west |
| 西・東・南 | south_east | south_west |
| 西・東・北 | north_east | north_west |
| 4 方向 | south_east | north_west |

- 直線レールで両軸に相手がいる (角・十字) ときは defaultShape (置いた向き) のまま [実機 1.21.1: powered-rail-priority]。
- 曲線は坂にならない [実機 1.21.1: rail-curve-no-slope]。直交 2 方向の曲線は 4 種とも実機で確かめてある [実機 1.21.1: rail-curve-priority]。
- 1 段下の相手 (n などが「1 段下のレール」で真になった場合) では、自分は平らのまま、相手が connectTo で坂になる。
- 坂への昇格 (手順 5) は、1 段上のマスに**レールがあるか**だけを見る。そのレールが受け付けるか (canConnectTo) も種類も見ない。両端の埋まったレールの横でも坂になる [26.3 読解: RailState#place・connectTo]。
- 手順 8 の getRail は「C → C の 1 段上 → C の 1 段下」の順に探す。坂の高い側の C は 1 段上の座標なので、その 1 段下 (P と同じ高さのマス) のレールも相手になりうる。

### 4.5 RailState#connectTo

相手 N の側で、置かれたレール P に向けて呼ばれる [26.3 読解: RailState#connectTo]。

1. N の接続の一覧 (removeSoftConnections 済み) に P の座標を足す。
2. 一覧に N の北・南・西・東と x・z が同じものがあるかで、n・s・w・e を作る。
3. n か s なら north_south。w か e なら east_west で上書きする (両軸なら east_west)。
4. 通常レールだけ、place の 3 と同じ 4 条件で曲線にする。
5. place の 5 と同じ規則で坂へ昇格する。
6. まだ無ければ north_south。
7. N を setBlockAndUpdate (フラグ 3) で書く。同じ状態なら空振りする。

place との違いは、排他の条件が無い・hasSignal を見ない・defaultShape を使わない、の 3 つである。
直線レールで北と東に相手がいると east_west になる。
connectTo の中から、さらに先の相手へは広がらない [実機 1.21.1: rail-shape-chain-join] [実機 1.21.1: rail-shape-update]。

### 4.6 BaseRailBlock#neighborChanged

受け取る状態 S は、MultiNeighborUpdate と SimpleNeighborUpdate なら実行の時点の状態、NC1 なら積んだ時点の状態である (→ 04 §5.6)。

1. クライアント側、または P のブロックがもう同じ種類でなければ何もしない。
2. S の形で shouldBeRemoved を見る。真ならドロップを出し、removeBlock (動いた=受けた値) で消す。水を含んでいれば水源が残る。
3. 偽なら近隣更新用の updateState に S と送り元のブロックを渡す。中身は種類ごとに違う。
   - 通常レール: §4.7
   - パワード系: §4.8
   - 検知レール: 何もしない (既定)

### 4.7 通常レールの分岐の切り替え

RailBlock の updateState は、次の 2 つがそろったときだけ updateDir (first=偽) を呼ぶ [26.3 読解]。

1. NC の送り元ブロックの既定の状態が信号源である。
2. countPotentialConnections がちょうど 3 である。

- 見るのは送り元の「種類」で、信号を出しているかは見ない。信号源はレバー・ボタン・感圧板・トーチ・リピーター・コンパレーター・オブザーバー・レッドストーンブロック・ダスト・検知レール・日照センサー・書見台・ターゲット・トラップチェスト・避雷針・スカルクセンサー・トリップワイヤーフック・ジュークボックスである [26.3 読解: isSignalSource の上書き] (→ 05)。
- first=偽なので、形が変わったときだけ書いて connectTo を回す。
- 4 方向の分岐は動かない [実機 1.21.1: rail-junction-gate]。
- 電源のレッドストーンブロックを /setblock で石に戻すと、送り元は石 (信号源でない) で、レッドストーンブロックは撤去フックも持たないので、向きが固まる [実機 1.21.1: rail-junction-nonsignal]。電源が点いたレバーなら撤去フックの NC が届くので固まらない (§5.5)。書見台は信号源なので動かす [実機 1.21.1: wire-connect-detector-rail-lectern]。
- レバーの操作で行き来する [実機 1.21.1: rail-junction-toggle]。
- 送り元の決まり方は §5.5。パワード系の反転が出す NC の送り元はパワード系なので、分岐は動かない。
- 検知レールは信号源なので、潜在接続がちょうど 3 の通常レールの隣で点滅するたびに、その分岐を決め直させる。撤去フック・フラグ 1・checkPressed の続きの NC6 の送り元が、どれも検知レールだからである。connectTo で検知レールの形が張り替わっただけでも同じことが起きる [26.3 読解: DetectorRailBlock#checkPressed・Level#setBlock]。updatePowerToConnected の NC1 は送り元が受け手自身なので、これでは動かない。
- ダストの isSignalSource は、自分の強さを計算している間だけ偽になる値を返す。NC を出す時点では真なので、ダストも門番を通す。

### 4.8 パワード系の電力

PoweredRailBlock の updateState (近隣更新用) [26.3 読解]:

1. 今の powered を S から読む。
2. あるべき値は「P の hasNeighborSignal」「前方向の探索 (深さ 0)」「後ろ方向の探索 (深さ 0)」のどれかが真なら真。
3. 違えば、S の powered を差し替えた状態を setBlockAndUpdate で書き、NC6(P↓) を出し、S の形が坂なら NC6(P↑) も出す。全体の順は §2.3 (A)。
4. 同じなら何もしない (更新を出さない)。

findPoweredRailSignal (座標・状態・向き・深さ) [26.3 読解]:

1. 深さが 8 以上なら偽。
2. 形から「次の座標」「1 段下も見るか」「軸」を決める (下表)。
3. 次の座標で isSameRailWithPower を見る。偽で、1 段下も見るなら、その 1 段下でも見る。

| 形 | 前方向 (真) の次 | 1 段下 | 後ろ方向 (偽) の次 | 1 段下 | 軸 |
|---|---|---|---|---|---|
| north_south | 南 (z+1) | 見る | 北 (z-1) | 見る | 南北 |
| east_west | 西 (x-1) | 見る | 東 (x+1) | 見る | 東西 |
| ascending_east | 西 | 見る | 東の 1 段上 | 見ない | 東西 |
| ascending_west | 西の 1 段上 | 見ない | 東 | 見る | 東西 |
| ascending_north | 南 | 見る | 北の 1 段上 | 見ない | 南北 |
| ascending_south | 南の 1 段上 | 見ない | 北 | 見る | 南北 |

isSameRailWithPower (座標・向き・深さ・軸) [26.3 読解]:

1. そこが自分と同じブロックでなければ偽。
2. 軸が東西で相手が南北系 (north_south・ascending_north・ascending_south) なら偽。軸が南北で相手が東西系なら偽。
3. 相手の powered が偽なら偽。
4. 相手の hasNeighborSignal が真なら真。
5. そうでなければ、相手の座標と状態で、同じ向きの findPoweredRailSignal (深さ+1)。

要点:

- 前方向は、南北の軸なら常に南、東西の軸なら常に西である。探索は一直線に進み、戻らない。
- 受電したレールから 8 本先まで真になる。レバーを端に置けば 9 本が点く [実機 1.21.1: powered-rail-chain] [実機 1.21.1: activator-rail-chain]。減衰は無い。
- 辿るのは**保存された powered** である。途中に古い偽が残ると、届く範囲でも点かない。源が消えても NC が来なければ真のまま残る (BUD) [実機 1.21.1: powered-rail-bud]。
- **形の繋がりは見ない**。見るのは「同じブロック・同じ軸・高さが同じか 1 段下 (坂の高い側だけは 1 段上の 1 マスだけ)」だけである。
- 同じ高さのマスが偽 (別のブロック・軸違い・powered が偽) でも、1 段下を見る。同じ高さに消灯したレールがあっても、その下の列が点いていれば飛び越えて辿る。
- 探索の起点の形は、受け取った状態 S の形である。NC1 で来たなら積んだ時点の形になる。
- 平らな 2 本の段差では、上のレールは下のレールを根にできるが、下は上を見つけられない [実機 1.21.1: powered-rail-step]。
- 1 段下の相手へは NC6(P↓) の横の方向で、坂の上の相手へは NC6(P↑) の横の方向で NC が届く。平らなレールの斜め上の相手には NC が届かないので、相手が別の契機で探索するまで点かない [実機 1.21.1: powered-rail-slope-update] [実機 1.21.1: powered-rail-step]。
- 動力が入っている所へ後から置けば、置いた本人は設置フックの NC1 で探索する [実機 1.21.1: powered-rail-step-place] [実機 1.21.1: powered-rail-flat-step-live]。

### 4.9 反転が列を伝わる順

例: 東西に並ぶ平らなパワードレール R1・R2・R3 の西端にレバー L がある。プレイヤーがレバーを入れる (最外)。

1. レバーの書き込みが NC6(L) を出し、東の R1 に届く。
2. R1 が真になる。§2.3 (A) の 5 件が積まれる。
3. R1 の 1 件目 NC6(R1) が西 (L)・東 (R2) の順に配る。R2 が真になり、R2 の 5 件が積まれて先に走る。
4. R2 の NC6(R2) が東の R3 を真にし、R3 の 5 件が先に走り切る。
5. R2 の残り (NC6(R2) の残りの方向・NC6(R2↓)・NC6(R2)・SU6(R2)・NC6(R2↓)) → R1 の残り、の順に戻る。

だから **SU は R3 → R2 → R1 の順**に出る。列の上のオブザーバーは、遠い方が先に予約を積む [要実機: §8 P3]。
消すときも同じ形で、手前から順に偽になる。各レールは手前がもう偽なので、前方向の探索が切れる。

### 4.10 検知レール (DetectorRailBlock)

信号 [26.3 読解]:

- isSignalSource は常に真。ダストは 4 方向から繋がる (→ 06) [実機 1.21.1: wire-connect-detector-rail-lectern]。
- ownSignal (getSignal の既定) は powered なら 15。向きを問わない。
- getDirectSignal は、powered で問う向きが上 (問う側がレールの真下) のときだけ 15。真下の支えのブロックだけを強く充電する。横の支えは充電しない [実機 1.21.1: detector-rail-cart-pulse]。

入口:

| 入口 | 条件 | 動き |
|---|---|---|
| entityInside | サーバー側で powered が偽 | checkPressed |
| tick (予約 tick) | powered が真 | checkPressed |
| onPlace | 別のブロックから置き換わった | §4.2 の結果の状態で checkPressed |

entityInside は、エンティティの箱が検知レールの升に重なれば種類を問わず呼ばれる (細かい条件は → 17)。トロッコでなくても checkPressed は走る。
従来の挙動のトロッコは、自分の tick の最後だけでなく、AbstractMinecart#move のたびにも applyEffectsFromBlocks を呼ぶ [26.3 読解: AbstractMinecart#move・applyEffectsFromBlocks]。だから L12 以外でも点きうる (§5.12)。

checkPressed (状態 S) [26.3 読解]:

1. 真下の支えが無い、または P がもう検知レールでなければ何もしない。
2. 検知の箱 (§3.3) に重なる AbstractMinecart を探す。種類は問わない。1 台でもいれば「押されている」。
3. 押されていて S の powered が偽なら、powered=真 を setBlockAndUpdate で書き、updatePowerToConnected → NC6(P) → NC6(P↓)。
4. 押されておらず S の powered が真なら、同じ手順で偽を書く。
5. 押されていれば 20 gt 後の予約 tick を積む (優先度 0)。
6. 最後に必ず CU(P) を出す。

updatePowerToConnected: 書いた状態の形の C1・C2 (removeSoftConnections しない生の座標) へ、順に NC1 を出す。積む状態はその座標の今の状態、**送り元はその座標のブロック自身**、動いた=偽。
届け先がレールでなくても、その座標のブロック (ダスト・ピストン・ランプ・空気など) がそのまま neighborChanged を受ける。平らな検知レールの C は NC6(P) の届け先と重なるので、同じ相手が 2 回受ける。
坂の検知レールでは、C の一方が斜め上になる。そこへ届く NC はこれと撤去フックの NC6(P↑) である。

時間の流れ [実機 1.21.1: detector-rail-cart-pulse] [実機 1.21.1: detector-rail-cart-stay]:

1. t2 に召喚したトロッコは、t3 の L12 で初めて tick され、そこで点く (→ 01 §4.6)。
2. 点いた後は、20 gt ごとの予約 tick (L6) だけが確かめる。t23 にいなければ消え、いれば t43 まで延びる。
3. 消える時点は「去った時点」ではなく「点いた時点 + 20 の倍数」である。
4. 点いている間に入ったトロッコは数えない (entityInside は powered の間は何もしない)。

アナログ出力 [26.3 読解: DetectorRailBlock#getAnalogOutputSignal]:

1. powered が偽なら 0。
2. 箱の中に MinecartCommandBlock がいれば、その先頭のコマンドブロックの成功回数。
3. いなければ、容器を持つ生きたトロッコ (チェスト付き・ホッパー付き) の先頭の充填率の信号 (→ 14)。
4. どちらもいなければ 0。普通のトロッコ・かまど付き・TNT 付き・スポナー付きは 0。

hasAnalogOutputSignal が常に真なので、後ろのコンパレーターは通常の信号 15 をこの値で置き換える (→ 07) [実機 1.21.1: detector-rail-comparator]。
値は読む時点のエンティティから作る。コンパレーターが読み直すのは NC か CU を受けたときだけで、トロッコが居座る間は 20 gt ごとの CU(P) だけが契機になる [要実機: §8 P6]。

### 4.11 撤去フック

BaseRailBlock#affectNeighborsAfterRemoval (古い状態で呼ばれる) [26.3 読解]:

1. ピストンで動いたのなら何もしない。
2. 古い形が坂なら NC6(P↑)。
3. 直線レールなら NC6(P) → NC6(P↓)。

呼ばれる条件 (LevelChunk#setBlockState) は「ブロックが変わった、または新しいブロックがレール」かつ「サーバー」かつ「フラグ 1 か 64 がある」である。
レールのプロパティだけの変化でも呼ばれるのはこのためである (→ 04 §5.7)。
/setblock (フラグ 258) では、チャンクの中では呼ばれない。後始末の updateNeighboursOnBlockSet が「ブロックが変わったときだけ」SU の後に呼ぶ (→ 04 §4.11)。

### 4.12 ピストンで押されたレール

- 押し反応は既定なので押せる。動いている間は形を保つ [実機 1.21.1: rail-piston-push]。検知レールも押せる (→ 13)。
- 移動元は moving_piston (フラグ 324) か空気 (フラグ 82) で上書きされる。どちらも 64 を含むので、撤去フックは呼ばれても何もしない。代わりに PistonBaseBlock#moveBlocks の最後で、ピストンが各移動元を中心に NC6 を出す (送り元は動いたレール。ブロックイベントの中で、着地より前。→ 13) [26.3 読解: PistonBaseBlock#moveBlocks]。
- 検知レールの予約 tick は元の座標に残り、付いていかない。実行時にそこが検知レールでなければ空振りする。別の検知レールが着地していれば、その検知レールの tick として走る (→ 02 §4.6)。
- 着地 (PistonMovingBlockEntity の tick、L13) の順 [26.3 読解: PistonMovingBlockEntity#tick]:
  1. 運んだ状態を周りの形で整える。レールの updateShape は形を変えない (水を含んでいれば水の予約だけ積む)。
  2. 水を含んでいれば waterlogged を偽にする。
  3. フラグ 67 (1+2+64) で書く。チャンクの中で設置フックが動いた=真で走る。古いブロックが moving_piston なので §4.2 を最後まで通る。place (first=真) で繋ぎ直し、直線レールは NC1→P (動いた=真) で電力を決め直す [実機 1.21.1: rail-piston-push-connect] [実機 1.21.1: rail-piston-push-powered]。検知レールは続けて checkPressed を通る。L13 は最外なので、どれもその場で走り切る。
  4. 3 の間に P の状態が変わらなければ、外側の書き込みが NC6(P) (送り元は古いブロックの moving_piston)・CU(P) (検知レールのとき)・SU6(P) を出す。変わっていれば出さない (§4.2)。
  5. 最後に P へ単発の NC (SimpleNeighborUpdate。送り元はレール自身、動いた=偽) を出す。
- 着地した所に支えが無い場合 [26.3 読解: BaseRailBlock#neighborChanged・Level#removeBlock・LevelChunk#setBlockState]:
  - 直線レールは、3 の NC1 (動いた=真) の中の shouldBeRemoved で壊れる。removeBlock に動いた=真が渡り、フラグ 67 で消す。撤去フックは何もしないが、フラグ 1 の NC6(P) (送り元はレール) と SU6(P) は出る。5 の単発の NC は空気が受けるので何も起きない。
  - 通常レールには 3 の NC1 が無い。ふつうは 5 の単発の NC (動いた=偽) で壊れるので、撤去フックが走る (坂なら NC6(P↑))。
- 引き戻しの途中で確定する経路 (finalTick) は、フラグ 3 で書いてから単発の NC を出す。64 が無いので、設置フックも NC1 も動いた=偽で走る。支えが無くて壊れるときは撤去フックも走る。水も抜かない [26.3 読解: PistonMovingBlockEntity#finalTick] (→ 13)。

### 4.13 トロッコの側 (17 との境界)

[26.3 読解: OldMinecartBehavior#tick・AbstractMinecart#getCurrentBlockPosOrRailBelow・各クラスの activateMinecart]

1. 従来の挙動のトロッコは、毎 tick (L12) 自分の足元の座標を求める。真下のブロックがタグ rails なら 1 段下を使う。
2. そこがレールなら線路に沿って動く。**動く前に読んだ状態**がアクティベーターレールなら、その powered を activateMinecart に渡す。
3. その後、自分の箱に重なるブロックの entityInside を呼ぶ (検知レールの検出)。2 の中の move のたびにも呼ぶ (§4.10)。

| トロッコ | activateMinecart |
|---|---|
| 普通 (乗れる) | powered が真なら、乗っているものを降ろし、揺れの演出をする。この呼び出しでは壊れない |
| ホッパー付き | powered の逆を enabled にする。真で吸い込みを止め、偽で戻す |
| TNT 付き | powered が真で未点火なら導火線を点ける (80 tick)。ゲームルール tnt_explodes が偽なら点けない |
| コマンドブロック付き | powered が真で、前回から 4 tick 以上たっていれば実行する |
| チェスト・かまど・スポナー付き | 何もしない |

- パワードレールの加速と停止は、トロッコがその tick に powered を読む。ブロックの側は何もしない (→ 17)。
- どれも保存された powered を読むので、BUD で残った値もそのまま効く。
- 実験の新しい挙動 (NewMinecartBehavior) は、moveAlongTrack の中でレールに沿う反復の 1 回ごとに、その反復の足元がアクティベーターレールなら activateMinecart を呼ぶ。進んだ反復 (と最初の反復) では applyEffectsFromBlocks も呼ぶ [26.3 読解: NewMinecartBehavior#moveAlongTrack]。1 tick に複数マス進むので、1 tick の中で複数のレールの作動と検知が起きうる。回数と順の細部は → 17 [要実機]。

---

## 5. 端の場合と落とし穴

### 5.1 同じ形の書き込みは何も出さない

place の first=真でも connectTo でも、決まった形が今と同じなら setBlockAndUpdate は空振りする。NC も SU も出ず、隣のオブザーバーは反応しない [26.3 読解: LevelChunk#setBlockState・Level#setBlock] [要実機: §8 P1]。
first=真が強制するのは「connectTo を回すこと」だけである。

### 5.2 両端が埋まっていても受け付ける場合

canConnectTo は、相互の接続が 2 本ある相手でも、すでに自分の x・z を指していれば真を返す。
「両端が埋まったレールは 3 本目を拒む」のは、自分を指していない場合に限る。
相互かどうかは removeSoftConnections で決まり、相手の相手の形まで読む。

### 5.3 繋がりと電力は別

- 形は種類をまたいで繋がるが、電力は同じブロックしか辿らない。
- 電力の探索は形の繋がりを見ない。坂が向こう向きでも、軸と高さが合えば辿る。
- 直交して隣り合うだけのレールは辿らない。張り替えで軸がそろえば合流する [実機 1.21.1: rail-shape-chain-join]。

### 5.4 NC1 の古い状態

BaseRailBlock の自分への NC1 と updatePowerToConnected の NC1 は、積んだ時点の状態で走る。
入れ子で積まれ、走るまでに形や powered が変わると、パワード系の updateState は古い状態の powered だけを差し替えて書く。古い形を書き戻すこともありうる [要実機]。
updateState の NC6(P↓)・NC6(P↑) は、setBlock が空振りしても出る。

### 5.5 送り元

| 更新 | 送り元 |
|---|---|
| setBlock のフラグ 1 の NC6 | 古いブロック (空気に置けば空気、壊せば壊したブロック) |
| /setblock の後始末の NC6 | 新しいブロック |
| 撤去フック・updateState の明示の NC6 | レール自身 |
| 検知レールの updatePowerToConnected の NC1 | 受け手の座標のブロック自身 |
| 着地の最後の単発の NC (§4.12) | 着地したブロック自身 |
| ほかのブロックの撤去フック (点いたレバー・ボタンなど) | 撤去されたブロック自身 |

分岐の門番が見るのはこの送り元である [26.3 読解: Level#setBlock・BlockItem#placeBlock・ServerPlayerGameMode#destroyBlock・LeverBlock#affectNeighborsAfterRemoval]。

- プレイヤーが信号源を手で置いても (フラグ 11)、フラグ 1 の NC の送り元は空気なので分岐は動かない。レバー・レッドストーンブロックは設置フックで NC を配らない。トーチの設置フックの NC6 は「自分の 6 近傍のそれぞれ」を中心に配るので、届くのは 2 マス先と自分だけで、隣の分岐には届かない [26.3 読解: RedstoneTorchBlock#onPlace]。設置フックで前方へ自分を送り元にした NC を出すリピーター・コンパレーターは、前にある分岐を動かす [26.3 読解: DiodeBlock#onPlace]。直感に反するので撮って確かめる価値がある [要実機: ハーネスにプレイヤーの設置の操作が要る。→ 04 §8 の「プレイヤーの設置と破壊を撮る手段」]。
- 手で壊すと (removeBlock、フラグ 3) 送り元は壊したブロックになる。信号源を壊せば分岐は決め直される。
- /setblock で信号源を石に置き換えると、後始末の NC6 の送り元は石になる。ただし点いたレバー・ボタンのように撤去フックで自分を送り元にして配るものは、後始末の撤去フックから信号源として届くので分岐が動く。

### 5.6 検知レールが点いたまま固まる

- powered=真の検知レールを、同じ検知レールの上に /setblock で置くと、設置フックは「同じブロック」で何もしない。予約 tick も無いので点いたまま固まる。entityInside は powered の間は何もしないので、トロッコを通しても戻らない [26.3 読解: DetectorRailBlock#onPlace・entityInside] [要実機: §8 P5]。
- 空気の上に置けば、onPlace の checkPressed でその場で消える。
- onPlace を止める置き方 (フラグ 512) でも固まる。

### 5.7 トロッコ以外のエンティティ

プレイヤー・アイテム・モブが消灯中の検知レールに重なると、毎 tick checkPressed が走り、CU(P) だけを出す。状態は変わらない。
後ろのコンパレーターは読み直すが値は 0 のままである。更新の件数には数えられる。

### 5.8 水を含んだレール

- 置く場所が水源なら waterlogged になる。流れる水では含まない。
- 形状更新のたびに水の予約 tick を積む (→ 02・16)。
- 支えを失って消えると水源が残る。ピストンで運ぶと水は抜ける。

### 5.9 坂の形

- 坂になるのは直線に決まったときだけである。
- 両側の 1 段上にレールがあると、南北なら南、東西なら西が勝つ。
- place で defaultShape がそのまま残るのは、両軸に受け付ける相手がいる直線レールと、受け付ける相手がどこにもいないときだけである。通常レールは両軸に相手がいれば必ず曲線になる。残る defaultShape が坂なら、坂のまま平らに戻らない (例: 相手のいない所に /setblock で坂を置く)。
- 坂の上のレールが壊れても、坂のレールは坂のまま残る (形は戻らない。高い側の支えが残れば壊れない)。

### 5.10 1 本の検知レールに 2 台

アナログ値は「先頭」の 1 台だけを読む。先頭の決まり方はエンティティの区画の並びによる (→ 17・18) [要実機]。

### 5.11 予約の重複排除で確認が早まる

予約は (座標・ブロックの種類) が同じなら新しい方を捨てる (→ 02 §4.2)。検知レールの座標に古い予約が残っていると、点いたときの 20 gt の予約は捨てられ、古い予約の時点で確認が来る [26.3 読解: LevelChunkTicks#schedule・ServerLevel#tickBlock]。

- 例 1: 点いた検知レールに、同じ種類の powered=false を /setblock で上書きする。設置フックは走らず、予約は残る。その後トロッコで点けると、確認は最初の予約の時点に来る。
- 例 2: 予約のある検知レールを壊して置き直す。予約は元の座標に残り、新しい検知レールに当たる。
- 確認の時点でトロッコがいれば、そこから 20 gt の予約を積み直すので、その後の周期は「確認の時点 + 20 の倍数」になる。

### 5.12 検知が L12 以外で起きる経路

- 従来の挙動のトロッコは AbstractMinecart#move のたびに applyEffectsFromBlocks を呼ぶ。ピストンがトロッコを押すと (L13 の PistonMovingBlockEntity#tick → moveEntityByPiston → move)、その場で entityInside が走り、検知レールが L13 で点く [26.3 読解: AbstractMinecart#move・PistonMovingBlockEntity#moveEntityByPiston] (→ 17)。
- 設置フックの checkPressed は、置いた時点で箱にトロッコがいれば点ける。トロッコのいる所に検知レールを置く・押して着地させる場合である。着地なら L13、/setblock ならコマンドの時点になる。

---

## 6. 版差

### 6.1 まとめ

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| 撤去フック | onRemove。サーバーで状態が変わるたびに必ず呼ぶ。レールは「同じブロックか」を見ない | affectNeighborsAfterRemoval。「ブロックが変わった、または新しいブロックがレール」かつフラグ 1 か 64 | 同左 | 同左 |
| 同じ種類のレールを /setblock で上書き | 撤去フックが走る。NC6(P↓) の上の方向で P 自身にも NC が届く | 撤去フックも自分への NC も無い | 同左 | 同左 |
| レールを /setblock で別のブロックに | 撤去フックは設置フックと SU の前 | SU の後 (後始末の中) | 同左 | 同左 |
| /setblock の後始末の CU | 無し (後始末は NC6 だけ) | 新しいブロックがアナログ出力を持てば CU (検知レールが当たる) | 同左 | 同左 |
| 直線レールの 180° 回転 (構造物の回転) | north_south と east_west が入れ替わる | 保つ | 同左 | 同左 |
| checkPressed の「まだ自分か」 | 無し | 無し | 有り | 有り |
| 自分の書き込み | setBlock (フラグ 3) | 同左 | setBlockAndUpdate (= フラグ 3) | 同左 |
| NC が運ぶもの | 送り元の座標 (自分への NC1 は自分の座標) | Orientation (レールは使わない) | 同左 | 同左 |
| 検知レールの信号の上書き | getSignal (powered なら 15) | ownSignal (同じ値) | 同左 | 同左 |
| getAnalogOutputSignal の向きの引数 | 無し | 有り (検知レールは使わない) | 同左 | 同左 |
| 置く場所の水の判定 | 流体の種類が水 (水源) | 同じ意味 | 同じ意味 | 水源の専用の判定 (同じ意味) |
| トロッコのクラス | entity.vehicle | entity.vehicle.minecart。挙動が Old と New に分かれる | 同左 | 同左 |

形・電力の探索・分岐の門番・検知の規則そのものは 4 版で同じである [26.3 読解: 4 版の diff]。

### 6.2 [版差 1.21.1] 撤去フック

1.21.1 の LevelChunk#setBlockState は、サーバー側で毎回 onRemove を呼ぶ。BaseRailBlock#onRemove は新しい状態を見ず、動いていなければ「坂なら上、直線なら自分と下」へ NC6 を出す。
レールの自分の書き込み (フラグ 3) では、26.3 と同じ位置・同じ順に出る。違いが出るのはフラグ 1 の無い書き込みだけである。

- /setblock (1.21.1 はフラグ 2) で同じ種類を上書きしても撤去フックが走る。直線レールの NC6(P↓) は真上の P にも届くので、P 自身が neighborChanged を受ける。パワード系は電力を決め直し、電源が無ければ偽に戻る。26.3 ではこの NC が無いので powered はそのまま残る [要実機: §8 P4]。
- フラグ 2 だけの書き込み (構造物の配置など) でも、1.21.1 は撤去フックの NC を出す。

### 6.3 [版差 1.21.1] 直線レールの 180° 回転

1.21.1 の PoweredRailBlock#rotate・DetectorRailBlock#rotate は、180° の分岐に north_south と east_west が無く、次の 90° の分岐へ落ちる。180° 回すと north_south と east_west が入れ替わる。RailBlock は正しい。
26.2 から BaseRailBlock の共通の回転になり、直線は保たれる。効くのは構造物ブロックなど回転を伴う配置だけで、回路の実行には効かない。

### 6.4 [版差 26.2] checkPressed のガード

26.2 の checkPressed は「P がまだ検知レールか」を見ない。onPlace の中で shouldBeRemoved がレールを消した後でも、checkPressed は続けて走る。
入口の canSurvive は真下しか見ないので、坂の高い側の支えが無くて消えた場合はそこを通ってしまう。そのとき「トロッコがいて powered が偽」か「powered=真で置いてトロッコがいない」なら、検知レールを書き戻す (ドロップと設置が両方残る)。
真下の支えが無くて消えた場合は canSurvive で止まる。26.3 で塞がれた [26.3 読解: 26.2 との差分]。通常の回路には効かない。

### 6.5 26.3 → 26.4-pre-1

BaseRailBlock の水の判定の書き方と、RailState の一覧の作り方が変わっただけである。RailBlock・PoweredRailBlock・DetectorRailBlock は同一。LevelChunk のレールの条件も同じ。挙動の差は無い。

### 6.6 既存 fixture の有効性

レール系の fixture (rail-*・powered-rail-*・activator-rail-*・detector-rail-*・wire-connect-detector-rail-lectern) は 1.21.1 で撮っている。
形・探索・門番・検知の周期は 26.3 と同じなので、状態の正解はそのまま使える。
/setblock でレールを消す手順 (powered-rail-flat-step-build・powered-rail-flat-step-live・rail-shape-chain-join) は撤去フックの位置が変わる。状態の結果は変わらない見込みだが、順が効く回路では撮り直す [要実機] (→ 19_version-diffs.md)。
同じ種類のレールを /setblock で上書きする手順 (§6.2 の版差が効く手順) を使う fixture は無い。tools/mc-harness/fixtures/ の inputs を走査して確かめた。レールへの /setblock は、どれも空気の上に置くか空気に戻すかである。

---

## 7. Rust で実装するときの要点

### 7.1 状態の持ち方

- 形は 10 値の列挙型 1 つで持ち、直線レールは 6 値だけを使う。ブロックの種類・powered・waterlogged を blockstate に持つ。
- 電力・形のどちらも保存された値を正とする。読むたびに計算し直さない (BUD を再現するため)。
- 「同じ状態か」は全プロパティで比べる。同じなら書き込みは空振りさせる。
- 検知レールのアナログ値は持たない。読む時点の「トロッコの入力」から作る。

### 7.2 RailState の写し方

- RailState は使い捨ての作業構造にする。座標・ブロックの種類・形・直線か・接続の一覧 (最大 3 件。固定長の配列で足りる)。
- getRail は呼ぶたびに世界を読み直す。キャッシュしない。
- 書き込みは即時に行い、その更新を 04 の更新キューへ出す。最外ならその場で回す。計算をまとめて後から一括で書くと、更新の時点がずれるだけでなく、形の結果もずれうる。最外では P の書き込みの更新が走り切ってから相手を探すので、その間に相手の形が変わることがある (送り元が検知レールのときの分岐の決め直しなど。§4.7)。
- place の 8 の巡回は C1 → C2 の順を守る。

### 7.3 更新の出し方

- 世界の書き込み関数に「新しいブロックがレールなら、同じブロックでも撤去フックを呼ぶ」条件を入れる。レール側に特別扱いを散らさない。
- NC1 (FullNeighborUpdate) は状態の値を積む。レールの自分への NC1・検知レールの NC1・CU が使う。
- NC に送り元のブロックの種類を載せる。分岐の門番が使う。
- パワード系の反転の後の NC6(P↓)・NC6(P↑) は、setBlock の成否に関係なく出す。

### 7.4 エンティティ無しで持つ最小限

| 持つもの | 中身 |
|---|---|
| トロッコの在否の入力 | 検知レールの座標ごとに「箱に重なるトロッコがいるか」。L12 (トロッコの tick) で偽 → 真の検出に使う。L6 の確認は、その時点の位置 (前の tick の L12・L13 の後) で数える |
| トロッコの種類と中身 | アナログ値用。普通は 0、容器付きは充填率の信号 (空なら 0)、コマンドブロック付きは成功回数 |
| 検知の位相 | 点くのは L12 (ピストンに押されたトロッコなら L13。§5.12)、消えるのは L6。L12・L13 の NC から積まれたブロックイベントは次の tick の L10 で走る |
| 予約の重複排除 | 検知レールの 20 gt の予約も 02 の重複排除を通す。古い予約が残る所では確認が早まる (§5.11) |
| エンティティの入るだけの通知 | 検知レールに重なるトロッコ以外のエンティティは CU(P) だけを出す。省いても状態は変わらない |

省いてよいもの: トロッコの移動・加速・脱線、activateMinecart の効果、getEntitiesOfClass の並び (1 台の前提なら)。
アクティベーターレールとパワードレールの効果が要るときは、「powered の値」を読めば足りる。

### 7.5 他のメモとの境界

- 更新キューと setBlock は 04 の実装を使う。このメモの側は「いつ・どこへ・どの順で出すか」だけを決める。
- hasNeighborSignal と SupportType は 05 の関数を呼ぶ。
- ピストンは 13 が着地の書き込みまでを担い、その先の設置フックはこのメモの手順が担う。
- トロッコを入れるなら 17 の側でエンティティを持ち、entityInside と activateMinecart をここへ呼ぶ。

---

## 8. 検証用のプローブ回路案

座標は x が東・y が上・z が南。レールの下には必ず石を置く (書かない)。

### P1. rail-connect-noop-su (同じ形の書き込みは SU を出さない)

- 目的: connectTo で形が変わらない相手は SU を出さないこと (§5.1)。
- 配置: 通常レール M (2,1,1) north_south・N (2,1,2) north_south。N を見るオブザーバー O を (1,1,2) に東向きで置き、O の出力の先 (0,1,2) にランプ。
- 入力: t2 に (2,1,3) へ rail[shape=north_south] を /setblock。
- 観測: N は north_south のまま。期待は「O が t4 に点かない」。今の TS は点く。O は (2,1,3) の 6 近傍に入れない。

### P2. rail-slope-hook-nc (通常レールの撤去フックが真上へ配る)

- 目的: 坂だった通常レールが形を変えると、撤去フックの NC6(P↑) が出ること (§2.3 (C))。
- 配置: P (2,1,3) ascending_east (authored)、W (1,1,3) east_west、(3,1,3) に石。P の 2 段上 (2,3,3) に北向きのピストン。
- 入力: t2 に (3,4,3) へ redstone_block を /setblock (ピストンの準接続の位置の隣。ピストンには NC が届かず BUD になる)。t4 に (2,1,2) へ rail[shape=north_south] を /setblock。
- 観測: t4 に P が north_west になる。期待は「NC6(P↑) の上の方向でピストンが起き、rail-shape-update と同じ位相 (t5) で伸びる」。1.21.1 も同じ。今の TS は伸びない。

### P3. powered-rail-su-order (列の SU は遠い方から)

- 目的: §4.9 の順を確かめる。
- 配置: レバー (1,1,3)、平らなパワードレール R1 (2,1,3)・R2 (3,1,3)・R3 (4,1,3)。R1 と R3 の真上に下向きのオブザーバー O1 (2,2,3)・O3 (4,2,3)。O1 の上に東向きのピストン A (2,3,3)、O3 の上に西向きのピストン B (4,3,3)。A と B は同じ (3,3,3) へ押す。
- 入力: t2 にレバーを入れる。
- 観測: t4 に先に予約を積んだオブザーバーが先に走り、そのピストンのブロックイベントが先に動く。期待は「O3 が先 → B が伸び、A は前が moving_piston で伸びられない」。今の TS は O1 が先で A が伸びる。

### P4. setblock-same-powered-rail (版差の確認)

- 目的: §6.2。同じ種類の上書きで自分に NC が来るか。
- 配置: 電源の無い powered_rail (2,1,3) east_west。
- 入力: t2 に (2,1,3) へ powered_rail[shape=east_west,powered=true] を /setblock。t6 に (2,1,4) へ stone を /setblock。
- 観測: 1.21.1 は t2 に偽へ戻る。期待 (26.3) は「t2〜t5 は真のまま、t6 に偽」。

### P5. detector-rail-stuck-on (点いたまま固まる)

- 目的: §5.6。
- 配置: 検知レール D (2,1,3) north_south (消灯)、ランプ (3,1,3)。対照に (2,1,6) は空気 (石の上)。
- 入力: t2 に D へ detector_rail[shape=north_south,powered=true] を /setblock、同じ t2 に (2,1,6) へも同じものを /setblock。t6 に D へトロッコを召喚、t10 に消す。
- 観測: 期待は「D は t2 から最後まで真、ランプも点いたまま。(2,1,6) は t2 のうちに偽」。1.21.1 も同じ。今の TS は設置フックの checkPressed を持たないので、(2,1,6) も点いたまま残るはず (§9.3)。

### P6. detector-rail-comparator-cadence (アナログ値は 20 gt ごとにしか読まれない)

- 目的: §4.10 の最後。居座るトロッコの中身の変化が、20 gt の確認まで届かないこと。
- 配置: 検知レール (2,1,3)、西を読むコンパレーター (3,1,3) → ダスト (4,1,3)。レールの真上に下向きのホッパー (2,2,3)。ホッパーにはスタックできない道具 (1 枠に 1 個) を 10 個入れておく。
- 入力: t2 に空のチェスト付きトロッコを (2,1,3) へ召喚。
- 観測: ホッパーは 8 gt ごとに 1 個入れる。点灯の t3 (L12) にもコンパレーターは NC と CU で読み直すが、ホッパーが最初に入れるのは同じ t3 の L13 なので、そこでは 0 のままのはず。期待は「ダストの強さが変わるのは t25・t45 … (点灯 t3 + 20 の倍数 + コンパレーターの 2 gt) だけ」。

### P7. detector-rail-piston-phase (検知の位相)

- 目的: 検知が L12 で起きることを、ブロックイベントの時点で確かめる。
- 配置: 検知レール (2,1,3)、東隣に東向きのピストン (3,1,3) (レールの弱い信号で動く)。
- 入力: t2 にトロッコを召喚。
- 観測: 期待は「t3 の L12 でレールが点き、ピストンのブロックイベントは t4 の L10 で走る。ピストンの extended は t4」。今の TS は入力の境界で点けるので t3 になる可能性がある。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §6 rail

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| 「更新の配り先」の powered 変化の行: 自身の 6 方向 + 真下 (坂なら真上) | 撤去フックの NC6(P)・NC6(P↓) (坂は NC6(P↑) が先頭) が前に付き、フラグ 1 の NC6(P) と SU6(P) の後に明示の NC6(P↓)・NC6(P↑)。§2.3 (A) | 26.3 が正しい。LevelChunk#setBlockState のレールの条件による。1.21.1 も onRemove が毎回走るので同じで、MC-231071 と合う |
| 検知レールの行: 自身 6 → 繋がる 2 マス → 自身 → 真下 → コンパレーター | 撤去フック・フラグ 1 の CU・SU の位置が抜けている。§2.3 (B)。繋がる 2 マスへの単発通知の送り元が「受け手自身」であることも書かれていない | 26.3 が正しい。送り元は分岐の門番に効く (§4.7) |
| 撤去の行 (affectNeighborsAfterRemoval) を撤去のときだけと読める | 同じブロックの形・powered の変化でも走る | 26.3 が正しい |
| 「形状を書いた各レール (place / connectTo の flag 3) が更新源」 | 形が変わったときだけ。同じ状態は空振り | 26.3 が正しい。fixture rail-shape-update は形が変わる場合だけを見ている |
| 「両端が埋まっているレールは 3 本目を受け付けない」 | 自分をすでに指していれば受け付ける。埋まっているかは相互の接続で数える | 補足 (§5.2) |
| 「探索は同高さと 1 段下を見るが、坂の登り側では 1 段下を見ない」 | 1 段下を見ないのは正しい。ただし登り側で見るのは 1 段上の 1 マスだけで、同じ高さは見ない。加えて形の繋がりは見ない | 補足 (§4.8・§5.3) |
| 「動力は繋がった同種レールを最大 8 個たどって伝わる」 | 「繋がった」は形の繋がりではない。同じブロック・同じ軸・高さの条件だけで辿る | 26.3 が正しい (§4.8) |
| 「OFF のタイミングは ON からの 20gt」 | 点灯 + 20 の倍数 (トロッコのいない最初の確認) | 補足 (cart-stay と合う)。古い予約が残る所では早まる (§5.11) |
| 「給電源を石に差し替えると…再計算そのものが走らない」 | /setblock でレッドストーンブロックを石にする手順では正しい (撤去フックを持たない)。手で壊すと送り元は壊したブロック (信号源) なので決め直す。点いたレバーなら /setblock でも撤去フックの NC が信号源として届く | 補足 (§5.5) |
| 撤去の行「通常レールの撤去は自身の更新を出さない」 | 撤去フックが自身の NC6 を出さないだけ。撤去の書き込み (フラグ 1) の NC6(P) は出る (送り元は通常レール) | 補足 (§2.3 (D)) |
| 「レール自身は信号を出さず導体でもない (detector_rail を除く)」 | 4 種とも当たり判定が空なので導体ではない。検知レールが例外なのは信号を出す点だけ | 補足。「検知レールは導体」と読まないこと (§2.1) |
| 冒頭の「形状は設置・撤去・給電で書き換わり」 | 書き換わるのは自分の設置・相手の設置 (connectTo)・分岐の門番だけ。隣の撤去では、門番を通るとき以外は変わらない | 26.3 が正しい (§2.2) |
| place の死コード・hasSignal の優先順位・坂の後勝ち・ピストンの着地・検知の信号 | 同じ | 正しい |

同じ資料の §4.2 の「サーバ側は state 変化のたびに旧 state onRemove / 新 state onPlace が呼ばれる」は 1.21.1 の動きである。26.3 は条件つき (→ 04 §6.2)。レールの自分の書き込みでは、レールの条件のおかげで結果が同じになる。

### 9.2 docs/research/16_nucleation-comparison.md

- R-3 (普通のトロッコなら 0): 26.3 も同じ。powered が偽なら必ず 0。容器付きは中身の充填率、コマンドブロック付きは成功回数で決まる。空の容器付き・成功 0 回なら 0 である (§4.10)。行 60 の「15 と読む」は修正前の sim の話で、解消済み。
- R-8 (ダストが検知レールへ繋がる): 26.3 も同じ。
- R-9 (検知レールは押せる): 26.3 も既定の押し反応で押せる。今の TS はまだ壊す (§9.3)。

### 9.3 今の TS 実装 (packages/sim/src)

| 点 | 今の TS | 26.3 | 判断 |
|---|---|---|---|
| 形の書き込みの更新 | rail.ts の planRailPlacement が place・connectTo の書き込みを全部返し、world.ts の applyRailPlacement が 1 件ごとに SU → NC6 を出す。形が変わらない相手にも出す | 変わったものだけ。順は撤去フック → NC6 → SU6 | TS が違う。オブザーバーが余計に反応する (P1)。坂から変わる通常レールの NC6(P↑) も無い (P2) |
| パワード系の反転 | world.ts の neighborChanged の powered_rail で SU6 → NC6(P) → NC6(P↓) (坂は → NC6(P↑)) | §2.3 (A) | TS が違う。列の SU の順が逆になる (P3)。撤去フックの NC が無い |
| 検知レールの反転 | world.ts の emitOutputShape: NC6(P) → 単発 NC (送り元 detector_rail) → NC6(P) → NC6(P↓) → CU。SU は先に出す。CU は 1 回で、20 gt の予約はその後に積む (activateBlock) | §2.3 (B)。単発 NC の送り元は受け手のブロック。CU はフラグ 1 の直後と最後の 2 回。予約は最後の CU の前 | TS が違う。接続先が分岐のとき、TS だけ単発 NC の時点で向きが変わる。コンパレーターの読み直しの回数も違う |
| 形の計算と書き込みの順 | planRailPlacement が形を全部決めてから、applyRailPlacement が 1 件ずつ書いて更新を出す | P の書き込みの更新が (最外なら) 走り切ってから相手を探す | TS が違う。間の更新で相手が変わる配置では形の結果もずれる (§7.2) |
| 分岐の門番の信号源 | power.ts の isSignalSourceType。日照センサー・トラップチェスト・避雷針・スカルクセンサー・トリップワイヤーフック・ジュークボックスが無い | isSignalSource を上書きする 18 クラス (§4.7) | TS が狭い。sim が持たないブロックは影響しない。別の型に潰したもの (トラップチェストは container、避雷針は decor) の隣の分岐だけが違う |
| 検知の位相 | fixture-driver が召喚の次の tick の入力境界で点ける | L12 | 状態は一致する (detector-rail-cart-pulse)。ブロックイベントの時点がずれうる (P7) |
| /setblock の自分の再評価 | setBlockCommand は置いた位置自身にも neighborChanged を出す (1.21.1 の観測に合わせたもの) | 同じ種類の上書きでは自分に NC が来ない | レールについては「1.21.1 では撤去フックの NC6(P↓) が自分に届く」がコメントの「要追調査」の答え。26.3 に合わせるなら外す (P4) |
| /setblock での撤去 | 撤去フックの NC6(P↓)・NC6(P↑) が無い | 後始末で撤去フックが走る | TS が違う。斜め下のパワード系が探索し直さない |
| /setblock で別の種類のレールに置き換える | setBlockCommand は「古いブロックがレールでない」ときだけ形を決め直す | 設置フックは「古いブロックが同じ種類でない」なら走る。rail → powered_rail のような置き換えでも place (first=真) と NC1 が走る | TS が違う。種類をまたぐ置き換えで形が決め直されない (電力は自分の再評価で決まる) |
| /setblock で検知レールを置く | 設置フックの checkPressed に当たる処理が無い。powered=真で置くと、空気の上でも点いたまま残る | 別のブロックの上なら onPlace の checkPressed でその場で消える。固まるのは同じ種類の上だけ (§5.6) | TS が違う (§8 P5 の対照の (2,1,6)) |
| NC の送り元の既定 | 発行した座標の今のブロック (新しいブロック) | setBlock のフラグ 1 は古いブロック | /setblock では一致。プレイヤーの設置に当たる経路では分岐の門番の結果が変わりうる |
| 読み込み時の powered | initialize (trustAuthored でない既定) がパワード系と検知レールを偽に落とし、パワード系だけ収束させ直す。trustAuthored なら読み込んだ値のまま | 読み込んだ値のまま。onPlace が走らない置き方なら検知レールも真のまま | 方針の差。BUD のまま保存した回路で違う。ハーネスの authored 設置で onPlace が走るかは [要実機] |
| 支え | 持たない | 持つ | 既知 (docs/research/13) |
| 押されると | detector_rail は isPushDestroy で壊れる | 押せる | TS が違う (R-9) |
| 居続けるトロッコ | 20 gt で必ず消える | 居る間は延びる | 既知 (detector-rail-cart-stay) |
| アナログ値 | 常に 0 | 中身による | 普通のトロッコなら一致 |
| 形と探索の計算 | rail.ts の RailConnector・findPoweredRailSignal・countPotentialConnections | 同じ | 一致。place の死コードを落としても結果は同じ |

---

## 10. 典拠一覧

- 26.3 BaseRailBlock#isRail・getShape・canSurvive・onPlace・updateState (設置用と近隣更新用)・neighborChanged・shouldBeRemoved・updateDir・affectNeighborsAfterRemoval・getStateForPlacement・rotate・mirror・updateShape・getFluidState
- 26.3 RailBlock#updateState・getShapeProperty
- 26.3 PoweredRailBlock#findPoweredRailSignal・isSameRailWithPower・updateState
- 26.3 DetectorRailBlock#isSignalSource・ownSignal・getDirectSignal・entityInside・tick・checkPressed・updatePowerToConnected・onPlace・hasAnalogOutputSignal・getAnalogOutputSignal・getSearchBB
- 26.3 RailState#updateConnections・removeSoftConnections・hasRail・getRail・connectsTo・hasConnection・countPotentialConnections・canConnectTo・connectTo・hasNeighborRail・place
- 26.3 RailShape#isSlope、BlockStateProperties の RAIL_SHAPE・RAIL_SHAPE_STRAIGHT
- 26.3 Blocks (RAIL・POWERED_RAIL・DETECTOR_RAIL・ACTIVATOR_RAIL の登録)、data の tags/block/rails.json
- 26.3 LevelChunk#setBlockState
- 26.3 Level#setBlock・removeBlock・destroyBlock・updateNeighbourForOutputSignal、LevelWriter#setBlockAndUpdate
- 26.3 ServerLevel#updateNeighborsAt・neighborChanged・updateNeighboursOnBlockSet、SetBlockCommand
- 26.3 CollectingNeighborUpdater#addAndRun・runUpdates と FullNeighborUpdate、NeighborUpdater#executeUpdate
- 26.3 SignalGetter#hasNeighborSignal・getSignal・getDirectSignalTo
- 26.3 Block#canSupportRigidBlock、SupportType (RIGID)、HopperBlock の形
- 26.3 BlockBehaviour#getSignal・ownSignal・isSignalSource・shouldRedstoneWireConnectTo (既定)
- 26.3 PistonMovingBlockEntity#tick・finalTick・moveCollidedEntities・moveEntityByPiston、PistonBaseBlock#isPushable・getNeighborSignal・moveBlocks
- 26.3 AbstractMinecart#getCurrentBlockPosOrRailBelow・activateMinecart・move・applyEffectsFromBlocks・getRedstoneDirection
- 26.3 OldMinecartBehavior#tick・moveAlongTrack、NewMinecartBehavior#tick・moveAlongTrack
- 26.3 Minecart#activateMinecart、MinecartHopper#activateMinecart・tryConsumeItems、MinecartTNT#activateMinecart・primeFuse、MinecartCommandBlock#activateMinecart、GameRules の TNT_EXPLODES
- 26.3 送り元の確認: BlockItem#placeBlock、ServerPlayerGameMode#destroyBlock、LeverBlock#affectNeighborsAfterRemoval、RedstoneTorchBlock#onPlace・notifyNeighbors、DiodeBlock#onPlace、PoweredBlock、RedstoneWireBlock#isSignalSource
- 26.3 LevelChunkTicks#schedule、ScheduledTick の UNIQUE_TICK_HASH、ServerLevel#tickBlock (予約の重複排除と照合)
- 26.3 EntitySelector の CONTAINER_ENTITY_SELECTOR、AbstractContainerMenu#getRedstoneSignalFromContainer、EntityTypes (トロッコの大きさ)
- 26.3 Entity#applyEffectsFromBlocks・checkInsideBlocks (entityInside の契機)
- 版差: 1.21.1・26.2・26.4-pre-1 の BaseRailBlock・RailBlock・PoweredRailBlock・DetectorRailBlock・RailState・LevelChunk#setBlockState・SetBlockCommand・BlockInput#place・AbstractMinecart#tick と 26.3 の diff
