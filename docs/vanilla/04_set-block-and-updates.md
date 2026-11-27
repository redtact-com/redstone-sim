# 04. setBlock とフラグ・近隣更新・形状更新・コンパレーター更新・Orientation

Java 版 26.3 のブロック書き込み (setBlock) と、そこから出る 3 種の更新の順序をまとめる。
Rust エンジンの「更新の配り方」の土台になる資料である。

確かさの表記は次のとおり。

- [26.3 読解] 26.3 のコードを読んで確かめた
- [実機 1.21.1: 名前] tools/mc-harness/fixtures/ の fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

用語は次のとおり。

| 略 | 意味 | 受け手のフック |
|---|---|---|
| NC | 近隣更新 (neighbor update) | Block の neighborChanged |
| SU | 形状更新 (shape update)。既存資料の PP と同じ | Block の updateShape |
| CU | コンパレーター更新 | コンパレーターの neighborChanged |

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| Level | setBlock・removeBlock・destroyBlock・neighborShapeChanged・updateNeighbourForOutputSignal・setBlockEntity・removeBlockEntity |
| LevelWriter | setBlock の 3 引数版・setBlockAndUpdate・destroyBlock の既定引数 |
| LevelAccessor | updateNeighborsAt の既定・neighborShapeChanged の既定 |
| ServerLevel | updateNeighborsAt・updateNeighborsAtExceptFromFacing・neighborChanged (2 種)・updateNeighboursOnBlockSet・sendBlockUpdated・updatePOIOnBlockStateChange・コンストラクタ (上限値の渡し方) |
| MinecraftServer / DedicatedServerProperties | getMaxChainedNeighborUpdates・max-chained-neighbor-updates |
| LevelChunk | setBlockState・removeBlockEntity |
| Block | UPDATE_ 系の定数・UPDATE_LIMIT・updateFromNeighbourShapes・updateOrDestroy |
| BlockBehaviour | UPDATE_SHAPE_ORDER・既定の updateShape / neighborChanged / onPlace / affectNeighborsAfterRemoval / updateIndirectNeighbourShapes / shouldChangedStateKeepBlockEntity |
| BlockBehaviour.BlockStateBase | handleNeighborChanged・updateNeighbourShapes・updateIndirectNeighbourShapes・onPlace・affectNeighborsAfterRemoval |
| NeighborUpdater | UPDATE_ORDER・executeUpdate・executeShapeUpdate・updateNeighborsAtExceptFromFacing の既定 |
| CollectingNeighborUpdater | 全部 (addAndRun・runUpdates・4 種の更新) |
| InstantNeighborUpdater | 全部 |
| Orientation / ExperimentalRedstoneUtils | 全部 |
| BlockEntity | setChanged・preRemoveSideEffects の既定 |
| Containers | updateNeighboursAfterDestroy |
| BlockInput / SetBlockCommand | place と /setblock の更新の出し方 (実機ハーネスに効く所だけ) |
| RedstoneWireBlock / PistonBaseBlock | updateIndirectNeighbourShapes の上書きと呼び出し (参照だけ) |

タスクの指示にあった Level の markAndNotifyBlock と blockUpdated は 26.3 に無い。
markAndNotifyBlock は別の配布物 (Forge 系) の名前である。blockUpdated は 1.21.1 にだけある (§6)。

### 1.2 扱わない範囲

| 範囲 | 参照先 |
|---|---|
| tick のフェーズと、setBlock がどのフェーズから呼ばれるか | → 01_tick-loop.md |
| 予約 tick | → 02_scheduled-ticks.md |
| ブロックイベント | → 03_block-events.md |
| 信号の読み方・導体の定義 | → 05_signals-and-block-properties.md |
| ダストの電力計算・updateShape の中身・実験の評価器 | → 06_redstone-wire.md |
| 各ブロックの onPlace / affectNeighborsAfterRemoval / neighborChanged の中身 | → 06〜17 の各メモ |
| ピストンが使うフラグの組と moving_piston | → 13_pistons.md |
| コンテナのアナログ値と setChanged を呼ぶ契機 | → 14_containers-hoppers-analog.md |
| HashSet の反復順・乱数 | → 18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 1 回の書き込みで起きること (サーバー側)

Level#setBlock は「座標・新しい状態・フラグ・形状更新の残り回数」を受ける。
3 引数版は残り回数に 512 を入れる。setBlockAndUpdate はフラグ 3 を入れる [26.3 読解: LevelWriter]。

1. 範囲外なら false で戻る。
2. デバッグワールドなら false で戻る。
3. チャンクへ書く (LevelChunk#setBlockState)。この中で次が起きる。
   1. 同じ状態なら何もせず「変化なし」を返す。
   2. 高さマップと光を更新する。
   3. 古い BlockEntity を外す (ブロックの種類が変わったとき)。
   4. 古い状態の撤去フック affectNeighborsAfterRemoval を呼ぶ (条件つき)。
   5. 新しい状態の設置フック onPlace を呼ぶ (条件つき)。
   6. 新しい BlockEntity を作る。
4. チャンクが「変化なし」を返したら false で戻る。ここより下は何も起きない。
5. 書いた座標を読み直す。頼んだ状態と違えば、何も通知せず true で戻る。
6. フラグ 2 があればクライアントへの通知を積む。
7. フラグ 1 があれば NC を出す。続けて、新しい状態がアナログ出力を持てば CU を出す。
8. フラグ 16 が無く、残り回数が 1 以上なら SU を出す。
   1. 古い状態の間接形状更新
   2. 新しい状態の 6 方向の SU
   3. 新しい状態の間接形状更新
9. POI を更新する。
10. true で戻る。

要点は 3 つある。

- **撤去フック → 設置フック → NC → CU → SU** の順である。フックはチャンクの書き込みの中で走る。
- NC はフラグ 1 が要る。SU はフラグ 16 が無ければいつも出る。フラグ 2 だけの書き込みでも SU は出る。
- 3 種の更新は全部 CollectingNeighborUpdater の 1 本のスタックを通る (§2.2)。

### 2.2 更新の配り方 (CollectingNeighborUpdater)

NC・SU・CU は、出した瞬間に受け手へ届くとは限らない。

| 出した場面 | 動き |
|---|---|
| 更新の実行中でない (最外) | スタックに積み、その場で空になるまで回す。呼び出しが戻った時点で連鎖は全部終わっている |
| 更新の実行中 (入れ子) | 「この層で追加された分」のリストの末尾に足すだけで戻る。受け手はまだ動かない |

入れ子で積まれた分は、今走っている 1 件の受け手が戻った直後に、**積んだ順**で走る。
そのあとで、親の残り (6 方向のうちの残りの方向) に戻る。
つまり「深さ優先。同じ層の中は先入れ先出し」である。

### 2.3 方向の並び (用途ごとに 5 本ある)

| 用途 | 定数 | 並び |
|---|---|---|
| Direction の宣言順 (values) | Direction | 下・上・北・南・西・東 |
| NC の 6 方向 | NeighborUpdater の UPDATE_ORDER | 西・東・下・上・北・南 |
| SU の 6 方向 | BlockBehaviour の UPDATE_SHAPE_ORDER | 西・東・北・南・下・上 |
| CU の 4 方向 | Direction.Plane.HORIZONTAL | 北・東・南・西 |
| 垂直の 2 方向 | Direction.Plane.VERTICAL | 上・下 |

座標で書くと次のとおり。

| 方向 | 差分 (x, y, z) |
|---|---|
| 下 DOWN | (0, -1, 0) |
| 上 UP | (0, +1, 0) |
| 北 NORTH | (0, 0, -1) |
| 南 SOUTH | (0, 0, +1) |
| 西 WEST | (-1, 0, 0) |
| 東 EAST | (+1, 0, 0) |

[26.3 読解: Direction・NeighborUpdater・BlockBehaviour]

---

## 3. 状態とデータ

### 3.1 フラグの全ビット

Block に定数がある。フラグは int のビット和である [26.3 読解: Block]。

| 値 | 定数名 | サーバー側での効き方 | 読む場所 |
|---|---|---|---|
| 1 | UPDATE_NEIGHBORS | NC を 6 方向へ出す。新しい状態がアナログ出力を持てば CU も出す。撤去フックを呼ぶ条件の片方 | Level#setBlock・LevelChunk#setBlockState |
| 2 | UPDATE_CLIENTS | クライアントへ変更を送る。経路探索の再計算も起こす。回路の挙動には効かない | Level#setBlock → ServerLevel#sendBlockUpdated |
| 4 | UPDATE_INVISIBLE | クライアント側で再描画の通知を止める。サーバーでは何も変えない | Level#setBlock (クライアント側の条件だけ) |
| 8 | UPDATE_IMMEDIATE | サーバー側のコードでは読まれない (クライアントの描画の優先) | 読んだ範囲に参照なし |
| 16 | UPDATE_KNOWN_SHAPE | SU を一切出さない (古い状態の間接・6 方向・新しい状態の間接の 3 つとも) | Level#setBlock・BlockInput#place |
| 32 | UPDATE_SUPPRESS_DROPS | SU の結果で壊れるとき、ドロップを出さない | Block#updateOrDestroy |
| 64 | UPDATE_MOVE_BY_PISTON | 撤去フックと設置フックへ「ピストンで動いた」を真で渡す。撤去フックを呼ぶ条件の片方 | LevelChunk#setBlockState |
| 128 | UPDATE_SKIP_SHAPE_UPDATE_ON_WIRE | SU の受け手がダストなら、その SU を捨てる | NeighborUpdater#executeShapeUpdate |
| 256 | UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS | 古い BlockEntity を外す前の副作用 (中身を落とすなど) を呼ばない | LevelChunk#setBlockState |
| 512 | UPDATE_SKIP_ON_PLACE | 設置フック onPlace を呼ばない | LevelChunk#setBlockState |

組み合わせの定数は次のとおり。

| 値 | 定数名 | 内訳 |
|---|---|---|
| 3 | UPDATE_ALL | 1 + 2 |
| 11 | UPDATE_ALL_IMMEDIATE | 1 + 2 + 8 |
| 260 | UPDATE_NONE | 4 + 256 |
| 816 | UPDATE_SKIP_ALL_SIDEEFFECTS | 16 + 32 + 256 + 512 |

UPDATE_NONE は名前に反して SU を出す。16 が入っていないからである。onPlace も走る。
サトウキビやサボテンの成長 (フラグ 260) をオブザーバーが検知できるのはこのためである [26.3 読解: Level#setBlock・SugarCaneBlock]。

world/level/block 以下で実際に使われている値の例を挙げる (26.3 の出現数)。

| 値 | 内訳 | 出現 | 例 |
|---|---|---|---|
| 3 | 1+2 | setBlockAndUpdate が約 140 か所 | レバー・ボタン・トーチ・ダストの設置・音符ブロック・レール |
| 2 | 2 | 91 | ダストの電力・リピーター・コンパレーター・ランプ・オブザーバー・ドア・ホッパー |
| 260 | 4+256 | 10 | 成長 (サトウキビ・サボテン・苗木)・火・トリップワイヤーの解除 |
| 11 | 1+2+8 | 7 | TNT の着火・ろうそく・焚き火 |
| 18 | 2+16 | 5 | 点いた状態で置かれたオブザーバー・ターゲット・スカルクセンサーを設置フックが消す書き込み・ピストンが押し潰すブロックの撤去・小さなドリップリーフ |
| 10 | 2+8 | 4 | ドア・フェンスゲート |
| 67 | 1+2+64 | 2 | ピストン本体の伸び状態・着地 |
| 35 | 1+2+32 | 2 | ベッドの片割れなど |
| 276 | 4+16+256 | 2 | ピストン (moving_piston を置く・腕を消す) |
| 324 | 4+64+256 | 2 | ピストン (押すブロックを moving_piston にする) |
| 82 | 2+16+64 | 1 | ピストン |
| 340 | 4+16+64+256 | 1 | moving_piston の着地の前段 |
| 818 | 2+16+32+256+512 | 1 | 苗木の成長 (TreeGrower)。ほかにテスト用の構造物の配置 |
| 258 | 2+256 | /setblock・/fill (strict でないとき) | BlockInput#place へ渡る値 |

個々のブロックがどの値を使うかは各メモに書く。ピストンの組は → 13_pistons.md。

### 3.2 定数

| 名前 | 値 | 意味 | 典拠 |
|---|---|---|---|
| Block の UPDATE_LIMIT | 512 | 形状更新の残り回数の初期値 | Block・LevelWriter |
| 連鎖の上限 | 1,000,000 | 1 回の最外の呼び出しで受け付ける更新の件数 | MinecraftServer#getMaxChainedNeighborUpdates |
| max-chained-neighbor-updates | 既定 1,000,000 | 専用サーバーの server.properties で変えられる。負の値は無制限 | DedicatedServerProperties・CollectingNeighborUpdater#addAndRun |
| Orientation の総数 | 48 | 上 6 通り × 前 4 通り × 横の寄せ 2 通り | Orientation |

### 3.3 CollectingNeighborUpdater が持つ状態

| 名前 | 型のイメージ | 中身 |
|---|---|---|
| stack | 両端キュー (先頭が上) | 実行待ちの更新 |
| addedThisLayer | 配列 | 今走っている 1 件の中で追加された更新 (追加順) |
| count | 整数 | 最外の呼び出しが始まってから受け取った更新の件数 (捨てた分も数える) |
| maxChainedNeighborUpdates | 整数 | 上限 |

Level ごとに 1 個である。ディメンションをまたいで共有しない [26.3 読解: Level のコンストラクタ]。

### 3.4 更新の 4 種類

| 種類 | 持つ値 | 1 回の実行でやること | 続きがあるか |
|---|---|---|---|
| SimpleNeighborUpdate | 受け手の座標・送り元のブロック・Orientation | 実行の時点で受け手の状態を読み、その neighborChanged を呼ぶ | 無い |
| FullNeighborUpdate | 受け手の状態 (積んだ時点のもの)・座標・送り元のブロック・Orientation・ピストンで動いたか | 持っている状態の neighborChanged を呼ぶ。読み直さない | 無い |
| MultiNeighborUpdate | 中心の座標・送り元のブロック・Orientation・除外方向・次の添字 | UPDATE_ORDER の次の 1 方向の受け手を読み、neighborChanged を呼ぶ | 方向が残っていれば有る |
| ShapeUpdate | 方向・相手の状態 (積んだ時点のもの)・受け手の座標・相手の座標・フラグ・残り回数 | 受け手の今の状態を読み、updateShape を呼び、結果を書く | 無い |

[26.3 読解: CollectingNeighborUpdater の 4 つの内部クラス]

---

## 4. 処理の詳細

### 4.1 Level#setBlock

契機: あらゆるブロックの書き込み。サーバーでは ServerLevel が上書きしていないので Level の実装がそのまま動く。

手順 [26.3 読解: Level#setBlock]:

1. 座標が建築可能な高さと水平の範囲に入っていなければ false。
2. サーバー側で、デバッグワールドなら false。
3. チャンクを取り、LevelChunk#setBlockState へ「座標・新しい状態・フラグ」を渡す (§4.2)。
4. 戻りが「無し」なら false。**通知は 1 つも出ない**。
5. 座標の状態を読み直す。頼んだ状態と同一でなければ、6〜10 を飛ばして true。
   フックの中で同じ座標が書き換えられた場合がこれに当たる。
6. 古い状態と新しい状態が違えば再描画の印を付ける (サーバーでは何もしない)。
7. フラグ 2 があり、チャンクが BLOCK_TICKING 以上なら ServerLevel#sendBlockUpdated を呼ぶ。
   中身は「クライアントへ送る印」と「当たり判定の形が変わったときの経路の再計算」だけである。
8. フラグ 1 があれば次の順で出す。
   1. updateNeighborsAt を「座標・**古い状態のブロック**」で呼ぶ。6 方向の NC が 1 件の MultiNeighborUpdate になる (§4.5)。
   2. サーバー側で、**新しい状態**がアナログ出力を持つなら updateNeighbourForOutputSignal を「座標・新しいブロック」で呼ぶ (§4.8)。
9. フラグ 16 が無く、残り回数が 1 以上なら次の順で出す。渡すフラグは元のフラグから 1 と 32 を落としたもの。渡す残り回数は 1 減らしたもの。
   1. 古い状態の updateIndirectNeighbourShapes
   2. 新しい状態の updateNeighbourShapes (6 方向。§4.6)
   3. 新しい状態の updateIndirectNeighbourShapes
10. ServerLevel#updatePOIOnBlockStateChange を呼ぶ (村人の職業ブロックなど。回路には効かない)。
11. true。

落とし穴になる点を先に書く。

- 手順 8 の NC の「送り元のブロック」は**古い**ブロックである。CU の送り元は**新しい**ブロックである。
- 手順 9 で 1 を落とすので、**SU の結果で起きた書き込みは NC を出さない** (§5.3)。
- 手順 9 で 32 も落とす。32 が Block#updateOrDestroy まで届くのは、updateNeighbourShapes などを 32 付きで直接呼ぶ経路だけである。
- 手順 8 の CU は、新しい状態がアナログ出力を持つときだけ出る。アナログ出力を持つブロックを**消した**ときの CU は、撤去フックが出す (§4.2 の手順 7)。

**手順 1 の範囲の値** [26.3 読解: Level#isInValidBounds, LevelHeightAccessor#isInsideBuildHeight・#getMaxY, ChunkPos#isValid, ChunkPyramid の定数, DimensionType, data の dimension_type]

手順 1 の判定は Level#isInValidBounds で、「高さ」と「水平」の両方を満たすことである。読む側 (Level#getBlockState・#getFluidState・#getBlockEntity) も同じ判定を使う (→ 05 §2.3・§4.7.6)。

| 軸 | 条件 | overworld の値 |
|---|---|---|
| 高さ | 最小 Y 以上、最大 Y 以下。最大 Y = 最小 Y + 高さ − 1 | **−64 以上 319 以下** (最小 Y −64・高さ 384。セクションは −4〜19 の 24 個) |
| 水平 | 座標を 16 で割ったチャンク座標の x と z が、どちらも絶対値 2,097,061 以下 | ブロック座標で **−33,552,976 以上 33,552,991 以下** (x と z のそれぞれ) |

- 高さは次元の種類 (dimension_type) が決める。the_nether と the_end は最小 Y 0・高さ 256 で、0 以上 255 以下である。
  次元の種類が取れる値は、最小 Y が −2032〜2031、高さが 16〜4064 で、どちらも 16 の倍数、最小 Y + 高さ は 2032 以下である。
- 水平の上限 2,097,061 は定数の式から計算した値である (ゲームを動かして読んだ値ではない)。
  位置の 64 ビットの詰め方 (→ 18 §3.1) は水平に 26 ビットを使い、表せる最大の座標は 33,554,431 である。そのチャンク座標 2,097,151 から、安全のための余白 90 チャンクを引く。
  余白は (32 + 12 + 1) × 2 で、12 はチャンク生成の最終段までに積み上がる依存の半径の段数である。
- 水平の条件はチャンク座標で見るので、境界はチャンクの端に揃う。x と z で同じ値である。
- 範囲の外への書き込みは false を返すだけで、通知は 1 つも出ない (手順 4 と同じ結果)。例外も出ない。
- 似た名前の判定が別にある。Level#isInWorldBounds は、同じ高さの条件と「x と z が −30,000,000 以上 30,000,000 未満」である。
  setBlock はこれを使わない。使うのはコマンドの座標の引数で、/setblock と /fill は、座標が読み込み済みで、かつこの範囲の内であることを先に確かめる (範囲の外はコマンドのエラーになる)。
  ほかの使い手は足場と粉雪のバケツの設置・ロードストーンのコンパス・爆発である。
- ピストンの押せるかの判定は、高さのほかにワールドボーダーを見る (→ 05 §4.6.2)。ワールドボーダーの値はここでは読んでいない。
- エンジンの枠 (1 辺 4096 マス) は水平の上限よりずっと狭いので、水平の判定は枠の判定に吸われる。高さだけを見る今の形で、overworld の結果は同じになる。

### 4.2 LevelChunk#setBlockState

契機: Level#setBlock の手順 3。

手順 [26.3 読解: LevelChunk#setBlockState]:

1. セクションが空気だけで、新しい状態も空気なら「無し」を返す。
2. セクションへ新しい状態を書き、古い状態を受け取る。
3. 古い状態と新しい状態が同一なら「無し」を返す。
4. 4 種の高さマップを更新する。セクションの空/非空が変われば光のエンジンへ知らせる。光の性質が違えば光の再計算を積む。
5. 「ブロックが変わったか」を決める。古い状態が新しいブロックの状態でなければ真。同じブロックでプロパティだけ違うなら偽。
6. ブロックが変わり、古い状態が BlockEntity を持ち、新しい状態が「BlockEntity を引き継ぐ」と答えないとき:
   1. サーバー側でフラグ 256 が無ければ、古い BlockEntity の preRemoveSideEffects を呼ぶ。既定は「コンテナなら中身を落とす」。
   2. BlockEntity をチャンクから外す (ゲームイベントの受け手の登録解除・removed の印・ticker の解除)。
7. 「ブロックが変わった、または新しいブロックがレール系」かつ「サーバー」かつ「フラグ 1 か 64 がある」とき、
   古い状態の affectNeighborsAfterRemoval を呼ぶ。引数の「ピストンで動いた」はフラグ 64 の有無。
8. セクションの座標を読み直す。新しいブロックでなくなっていたら「無し」を返す。
9. サーバー側でフラグ 512 が無ければ、新しい状態の onPlace を呼ぶ。引数は古い状態と「ピストンで動いた」。
   **ブロックが同じでプロパティだけ変わったときも呼ばれる**。
10. 新しい状態が BlockEntity を持ち、セクションの座標がまだ新しいブロックなら:
    1. 既存の BlockEntity を探す。あっても新しい状態に合わなければ警告を出して外す。
    2. 無ければ新しく作って登録する。
    3. あれば、持っている状態を新しい状態に差し替え、ticker を付け直す。
11. 未保存の印を付け、古い状態を返す。

順序の要点:

- 手順 6 → 7 → 9 → 10 の順である。つまり **古い BlockEntity を外す → 撤去フック → 設置フック → 新しい BlockEntity を作る**。
- 撤去フックが走る時点で、セクションにはもう新しい状態が入っている。撤去フックから周りへ届く NC の受け手は、新しい状態を読む。
- 設置フックが走る時点では、ブロックが変わった場合の新しい BlockEntity はまだ無い。
- 引き継ぎ (shouldChangedStateKeepBlockEntity) を真にするのは CopperChestBlock と CopperGolemStatueBlock だけである (酸化で別ブロックになっても中身を保つ)。

フックが呼ばれる条件を表にする。

| 書き込み | 撤去フック | 設置フック |
|---|---|---|
| 別のブロックへ、フラグ 3 | 呼ぶ | 呼ぶ |
| 別のブロックへ、フラグ 2 | **呼ばない** | 呼ぶ |
| 別のブロックへ、フラグ 67 (1+2+64) | 呼ぶ (動いた=真) | 呼ぶ (動いた=真) |
| 別のブロックへ、フラグ 324 (4+64+256) | 呼ぶ (動いた=真) | 呼ぶ (動いた=真) |
| 別のブロックへ、フラグ 276 (4+16+256) | 呼ばない | 呼ぶ |
| 同じブロックでプロパティだけ、フラグ 3 | **呼ばない** (新しいブロックがレール系なら呼ぶ) | 呼ぶ |
| 同じブロックでプロパティだけ、フラグ 2 | 呼ばない | 呼ぶ |
| どれでも、フラグ 512 付き | 上と同じ | 呼ばない |

撤去フックの既定は何もしない。設置フックの既定も何もしない [26.3 読解: BlockBehaviour]。
上書きしているクラスは網羅表の元データにある (撤去フックは 28 クラス。ダスト・トーチ・ダイオード・オブザーバー・レバー・ボタン・感圧板・レール・コンテナ類・ピストンの頭など)。
中身は各メモに書く。

### 4.3 CollectingNeighborUpdater#addAndRun

契機: NC・SU・CU を出すすべての呼び出し。

手順 [26.3 読解: CollectingNeighborUpdater#addAndRun]:

1. 「実行中か」を count が 1 以上かで決める。
2. 「多すぎるか」を、上限が 0 以上で、count が上限以上かで決める。
3. count を 1 増やす。
4. 多すぎなければ積む。実行中なら addedThisLayer の末尾へ。実行中でなければ stack の先頭へ。
5. 多すぎるときは積まない。増やした後の count から 1 引いた値が上限とちょうど同じときだけ、エラーログを 1 行出す (最初に捨てた座標つき)。
6. 実行中でなければ runUpdates を回す。

上限の数え方:

| 項目 | 内容 |
|---|---|
| 数える単位 | addAndRun を通った回数。MultiNeighborUpdate は 6 方向で 1 件 |
| 数える種類 | NC・SU・CU を区別せず 1 つのカウンタ |
| 受け付ける件数 | 最外の 1 件を含めて 1,000,000 件。1,000,001 件目から捨てる |
| 捨てた後 | 積んである分は最後まで走る。その中から新しく出た更新は全部捨てる |
| 戻し | しない。書き込み済みのブロックはそのまま残る |
| リセット | 最外の runUpdates が終わるとき (例外で抜けるときも) に count を 0 にし、stack と addedThisLayer を空にする |
| 上限 0 | 最外の 1 件目から捨てる。更新は 1 つも走らない |
| 上限が負 | 無制限 |

### 4.4 CollectingNeighborUpdater#runUpdates

手順 [26.3 読解: CollectingNeighborUpdater#runUpdates]:

1. stack か addedThisLayer に何かある間、2〜5 を繰り返す。
2. addedThisLayer を**末尾から順に** stack の先頭へ積む。こうすると、最初に追加された 1 件が一番上に来る。addedThisLayer を空にする。
3. stack の一番上を見る (まだ外さない)。
4. その更新を 1 回実行する。
   - 「続きは無い」と返したら stack から外し、1 へ戻る。
   - 「続きがある」と返し、実行中に何も追加されなかったら、同じ更新をもう 1 回実行する (4 を繰り返す)。
   - 「続きがある」と返し、実行中に何か追加されたら、外さずに 1 へ戻る。追加された分が上に積まれ、先に走る。
5. 最後に (例外のときも) stack と addedThisLayer を空にし、count を 0 にする。

例で確かめる。最外で「座標 P の 6 方向の NC」を出す。西の受け手 W が、自分の neighborChanged の中でフラグ 3 の書き込みをするとする。

| 順 | 起きること | stack (左が上) |
|---|---|---|
| 1 | Multi(P) を積んで回し始める | Multi(P) |
| 2 | Multi(P) が西の W を呼ぶ。W は自分を書き換える。チャンクへの書き込みはこの場で終わる | Multi(P) |
| 3 | W の書き込みが Multi(W) と SU 6 件を出す。実行中なので addedThisLayer に入る | Multi(P) |
| 4 | W の neighborChanged が戻る。Multi(P) は「続きがある」と返す。追加があるので中断 | Multi(P) |
| 5 | 追加分を積む | Multi(W)・SU 西・SU 東・SU 北・SU 南・SU 下・SU 上・Multi(P) |
| 6 | Multi(W) が西・東・下・上・北・南の順に受け手を呼ぶ。受け手が更新を出せば、その分が先に走る | (同上から順に消える) |
| 7 | W の SU 6 件が順に走る | SU…・Multi(P) |
| 8 | Multi(P) が東へ進む | Multi(P) |

W の neighborChanged が戻るまで、W の周りは何も動かない。これが 1.19 より前の「その場で再帰する」方式との違いである。

### 4.5 NC を出す入口と MultiNeighborUpdate

ServerLevel の入口は 5 つある [26.3 読解: ServerLevel]。

| 入口 | 引数 | 積まれる更新 |
|---|---|---|
| updateNeighborsAt (2 引数) | 中心の座標・送り元のブロック | Orientation を作って 3 引数版へ |
| updateNeighborsAt (3 引数) | 中心の座標・送り元のブロック・Orientation | MultiNeighborUpdate (除外方向なし) |
| updateNeighborsAtExceptFromFacing | 中心の座標・送り元のブロック・除外方向・Orientation | MultiNeighborUpdate (除外方向あり) |
| neighborChanged (3 引数) | 受け手の座標・送り元のブロック・Orientation | SimpleNeighborUpdate |
| neighborChanged (5 引数) | 受け手の状態・受け手の座標・送り元のブロック・Orientation・ピストンで動いたか | FullNeighborUpdate |

Level 自身のこれらのメソッドは空である。クライアント側では NC は出ない。

MultiNeighborUpdate の動き [26.3 読解: CollectingNeighborUpdater の MultiNeighborUpdate]:

1. 作るとき、添字 0 の方向 (西) が除外方向なら添字を 1 進める。
2. 1 回の実行で、添字の方向の隣の座標を求め、**その時点**の状態を読む。添字を 1 進める。
3. 実験の機能が有効なら Orientation を用意する (§4.9)。無効なら Orientation は「無し」。
4. 受け手の neighborChanged を「送り元のブロック・Orientation・ピストンで動いた=偽」で呼ぶ。
   受け手へ届くまでに addAndRun は通らない。だからカウンタは方向ごとには進まない (§4.3)。
5. 次の添字の方向が除外方向なら、添字をもう 1 進める。
6. 添字が 6 未満なら「続きがある」と返す。

方向の並びは西・東・下・上・北・南で、除外方向だけを飛ばす。

| 除外方向 | 実際に届く順 |
|---|---|
| なし | 西・東・下・上・北・南 |
| 西 | 東・下・上・北・南 |
| 東 | 西・下・上・北・南 |
| 下 | 西・東・上・北・南 |
| 上 | 西・東・下・北・南 |
| 北 | 西・東・下・上・南 |
| 南 | 西・東・下・上・北 |

除外方向を使うのは 3 か所である [26.3 読解]。

| 呼び出し元 | 除外する方向 |
|---|---|
| DiodeBlock (リピーター・コンパレーター) の前方更新 | 出力先から見た自分の方向 |
| ObserverBlock の前方更新 | 同上 |
| RedstoneWireBlock (ダストが隣の導体越しに配る更新) | 導体から見たダストの方向 |

NC の受け手は、空気でも水でも必ず呼ばれる。既定の neighborChanged は何もしない。
受け手を「レッドストーン部品だけ」に絞る条件はコードに無い [26.3 読解: NeighborUpdater#executeUpdate・BlockBehaviour]。

NC が運ぶ情報は「送り元のブロック (種類だけ)」「Orientation」「ピストンで動いたか」である。**送り元の座標は運ばない** [版差 1.21.1 は座標を運ぶ]。

### 4.6 SU を出す入口と ShapeUpdate

SU の入口は BlockStateBase#updateNeighbourShapes である [26.3 読解: BlockBehaviour.BlockStateBase]。

1. 西・東・北・南・下・上の順に 2 を繰り返す。
2. その方向の隣の座標を受け手として、Level#neighborShapeChanged を呼ぶ。渡すのは
   「受け手から見た相手の方向 (今の方向の逆)」「受け手の座標」「相手 (自分) の座標」「自分の状態」「フラグ」「残り回数」。
3. Level#neighborShapeChanged は CollectingNeighborUpdater へ ShapeUpdate として 1 件ずつ積む。

SU は 6 方向が 1 件にまとまらない。1 方向が 1 件である。上限のカウンタも 6 件ぶん進む。

ShapeUpdate の実行 [26.3 読解: NeighborUpdater#executeShapeUpdate]:

1. 受け手の座標の**今の**状態を読む。
2. フラグに 128 があり、受け手がダスト (redstone_wire) なら何もしない。
3. 受け手の updateShape を呼ぶ。渡すのは「相手の方向・相手の座標・相手の状態 (積んだ時点のもの)・乱数」など。新しい状態が返る。
4. Block#updateOrDestroy へ「今の状態・返った状態・フラグ・残り回数」を渡す。

Block#updateOrDestroy [26.3 読解]:

1. 返った状態が今の状態と同一なら何もしない。
2. 返った状態が空気なら、サーバー側で Level#destroyBlock を呼ぶ。ドロップはフラグ 32 が無いときだけ出す。残り回数はそのまま渡す。
3. それ以外は Level#setBlock を「返った状態・フラグから 32 を落としたもの・残り回数」で呼ぶ。

- 手順 2 の「空気なら」は、**状態が持つ空気の印** (BlockStateBase#isAir) で見る。ブロックの名指しではない。
  印を持つのは air・cave_air・void_air の 3 種だけである (→ 05 §4.7.6)。だから cave_air や void_air が返っても壊す側へ進む。
- Level#destroyBlock の手順 1 (§4.10) も同じ印で見る。今の状態が 3 種のどれでも false を返す。
- 26.3 の updateShape が「消える」として返すのは、どれも air の既定の状態である (cave_air・void_air を返す updateShape は見つからない)。
  返った状態は壊すかどうかの判定にだけ使われ、書かれるのは流体のブロックである (§4.10 の手順 4)。
- 手順 1 の「同一」は参照の同一である。状態は 1 つずつしか作られないので、状態 ID の一致と同じ意味になる。

既定の updateShape は状態をそのまま返す。つまり何も起きない。
updateShape の中で予約 tick を積むブロックがある (オブザーバー・流体・落下ブロックなど)。予約は ScheduledTickAccess 経由で、状態を返すこととは別に行う。

間接形状更新 updateIndirectNeighbourShapes を上書きしているのは RedstoneWireBlock だけである。
斜め上下のダストへ SU を送る。中身は → 06_redstone-wire.md。
PistonBaseBlock は押した後にこれを手で呼ぶ (フラグ 2・残り回数 512)。→ 13_pistons.md。

### 4.7 形状更新の深さの上限 (残り回数)

残り回数の減り方 [26.3 読解: Level#setBlock・CollectingNeighborUpdater#shapeUpdate・Block#updateOrDestroy]:

| 場所 | 残り回数の扱い |
|---|---|
| Level#setBlock が SU を出すとき | 1 減らして渡す。0 以下なら SU を出さない |
| CollectingNeighborUpdater が ShapeUpdate を積む・実行する | そのまま |
| Block#updateOrDestroy が setBlock / destroyBlock を呼ぶ | そのまま |
| updateNeighbourShapes を残り回数なしで呼ぶ (ピストンなど) | 512 から始める |
| setBlock を 3 引数で呼ぶ (ほとんどのブロック) | 512 から始める |

つまり 1 世代 (書き込み → SU → 受け手の書き込み) で 1 減る。

| 世代 | setBlock に入る残り回数 | SU を出すか |
|---|---|---|
| 1 (最初の書き込み) | 512 | 出す (511 で渡す) |
| 2 | 511 | 出す (510 で渡す) |
| … | … | … |
| 512 | 1 | 出す (0 で渡す) |
| 513 | 0 | **出さない**。書き込み (とフック) は起きる。NC・CU はフラグ 1 があるときだけ出る。SU 由来の書き込みはフラグ 1 が落ちているので出ない (空気になる場合を除く。下の箇条書き) |

- 上限は「SU だけでつながる連鎖」にしか効かない。途中で neighborChanged や予約 tick から 3 引数の setBlock を呼べば 512 に戻る。
- 上限は深さであって総数ではない。総数は §4.3 のカウンタが別に数える。
- 513 世代目の書き込みはフラグ 1 を持たない (§4.1 の手順 9 で落ちている) ので、NC も出ない。空気になる場合だけ destroyBlock がフラグ 3 で書くので NC が出る。
- 512 段を超える縦の連鎖 (塀の柱・足場・点滴石など) は、513 段目で形の更新が止まる [要実機: 柱の高さがワールドの高さ 384 を超えないので縦では届かない。横につながる形で 513 段を作れるかは未確認]。

### 4.8 CU: Level#updateNeighbourForOutputSignal

契機 [26.3 読解: 呼び出し元の検索]:

| 呼び出し元 | 場面 |
|---|---|
| Level#setBlock | フラグ 1 の書き込みで、新しい状態がアナログ出力を持つとき |
| BlockEntity#setChanged | BlockEntity の中身が変わったとき (状態が空気でなければ)。→ 14 |
| Containers#updateNeighboursAfterDestroy | コンテナ類の撤去フックから。→ 14 |
| ServerLevel#updateNeighboursOnBlockSet | /setblock・/fill・/clone の後始末 (§4.11) |
| DetectorRailBlock・CommandBlock・CopperGolemStatueBlock・CreakingHeartBlockEntity・EnderEyeItem・ItemFrame | それぞれの出力が変わったとき |

手順 [26.3 読解: Level#updateNeighbourForOutputSignal]:

1. 北・東・南・西の順に 2〜4 を繰り返す。
2. その方向の隣の座標のチャンクが読み込まれていなければ飛ばす。
3. 隣がコンパレーター (ブロック ID comparator) なら、その状態を持たせた FullNeighborUpdate を積む。
4. そうでなく、隣が導体 (isRedstoneConductor が真) なら、同じ方向へもう 1 マス進む。そこがコンパレーターなら同じように積む。

届け先の要点:

- 届くのは水平の 4 方向だけ。上下へは届かない。
- 届く相手は comparator だけ。リピーターやダストには届かない。
- 導体越しは 1 マスだけ。2 マス越しは届かない。
- コンパレーターの向きは見ない。横向きや背中向きのコンパレーターにも届く (読むかどうかは受け手が決める。→ 07)。
- FullNeighborUpdate なので、**積んだ時点**の状態で neighborChanged が呼ばれる。実行までにそのコンパレーターが壊されていても呼ばれる (§5.6)。
- 運ぶ Orientation は「無し」、ピストンで動いたかは偽。
- CU は NC と同じスタックを通る。入れ子なら積まれるだけである。
- 上下のホッパーなどへ CU は届かない。

[実機 1.21.1: barrel-comparator-input] が「樽の中身の変化を隣のコンパレーターが読み、隣のオブザーバーは鳴らない」を裏づける (CU は SU を出さない)。
[実機 1.21.1: comparator-through-conductor-replace] が導体 1 個越しの読みを裏づける。

### 4.9 Orientation

Orientation は、NC に付いて回る「向きの文脈」である [26.3 読解: Orientation]。

| 項目 | 内容 |
|---|---|
| 表すもの | 上 (up)・前 (front)・横の寄せ (LEFT / RIGHT) の 3 つ。上と前は別の軸でなければならない |
| 個数 | 48 個を起動時に全部作り、番号で引く |
| 番号 | 上の宣言順 × 8 + 前のキー × 2 + 横の寄せ (LEFT=0・RIGHT=1)。前のキーは「軸のキー × 2 + 正負 (正=0・負=1)」。軸のキーは、上が Y 軸なら前が X 軸のとき 1・Z 軸のとき 0、上が Y 軸でなければ前が Y 軸のとき 1・それ以外 0 |
| 横 (side) | 前と上の外積が右。RIGHT ならそれ、LEFT ならその逆 |
| 方向の並び getDirections | 前の逆・前・横・横の逆・上の逆・上 |
| 水平の並び | 上の並びから、上の軸でないものだけ (4 つ) |
| 垂直の並び | 上の並びから、上の軸のものだけ (2 つ) |
| withFront | 前を差し替える。新しい前が今の上なら、上は「今の前の逆」になる。新しい前が今の上の逆なら、上は「今の前」になる |
| withUp | 上を差し替える。新しい上が今の前なら、前は「今の上の逆」になる。新しい上が今の前の逆なら、前は「今の上」になる |
| withFrontPreserveUp | 新しい前が上の軸なら何も変えない |
| withFrontAdjustSideBias | 前を差し替えたあと、元の前が新しい横と同じなら横の寄せを反転する |

**作られる場所**は ExperimentalRedstoneUtils#initialOrientation である [26.3 読解]。

1. 実験の機能 (FeatureFlags の REDSTONE_EXPERIMENTS) が無効なら「無し」を返す。**乱数も引かない**。
2. 有効なら、ワールドの乱数で 48 個から 1 つ選び、横の寄せを LEFT にする。
3. 上の指定があれば withUp、前の指定があれば withFront をこの順で当てる。

**使う側**は ExperimentalRedstoneWireEvaluator だけである (ダストの実験の評価器)。→ 06_redstone-wire.md。

結論として、**既定の設定 (実験なし) では Orientation は常に「無し」で、挙動に一切効かない**。乱数の消費も無い。
Rust の第 1 版は Orientation を持たなくてよい。型の席だけ空けておく (§7)。

乱数の引き方は「48 未満の整数を 1 回」である (Orientation#random)。ワールドの乱数を使うので、実験が有効なときは NC の回数が乱数列を進める。→ 18_determinism-java-semantics.md。

MultiNeighborUpdate は、実験が有効なとき、1 方向ごとに「持っている Orientation の前をその方向に差し替えたもの (withFront)」を受け手へ渡す。
持っている Orientation 自体は書き換えない。無しで渡されたときは最初の実行で 1 回だけ作り、残りの方向で使い回す (乱数は 1 件につき 1 回)。

実験が有効なときに Orientation を作って渡す呼び出し元 (参考):
ServerLevel#updateNeighborsAt (2 引数。呼ばれた時点で作るので、積まれるだけの入れ子でも乱数はその場で引く)・MultiNeighborUpdate (無しで渡されたとき、最初の実行で作る。前は除外方向の逆。除外方向が無ければ前の指定なし)・
ダスト・トーチ・ダイオード・オブザーバー・レバー・ボタン・書見台・トリップワイヤーフック・避雷針・トラップチェスト・ピストン・moving_piston・ピストンの頭。

### 4.10 removeBlock と destroyBlock

Level#removeBlock [26.3 読解]:

1. 座標の流体の状態を読む。
2. 流体のブロック (水源なら水、無ければ空気) を、フラグ 3 で書く。「ピストンで動いた」が真なら 64 を足して 67。

Level#destroyBlock [26.3 読解]:

1. 今の状態が空気なら false。
2. 破壊のパーティクルと音のイベント (レベルイベント 2001) を出す。
3. ドロップを出す指定なら、BlockEntity を取ってドロップを出す。
4. 流体のブロックをフラグ 3・渡された残り回数で書く。
5. 書けたらゲームイベント BLOCK_DESTROY を出す (スカルクセンサーに届く。→ 10)。

SU の結果で壊れるブロック (支えを失ったトーチ・レバー・ダスト・レールなど) はこの経路を通る。
だからフラグ 1 が付き、撤去フックも NC も出る。
[実機 1.21.1: lever-support-break] [実機 1.21.1: rail-support-break] が「更新が届いた時点で壊れる」を裏づける。

**「流体のブロック」の決まり方** [26.3 読解: Level#getFluidState, LevelChunk#getFluidState, BlockBehaviour#getFluidState, FluidState#createLegacyBlock, EmptyFluid・WaterFluid・LavaFluid の createLegacyBlock, FlowingFluid#getLegacyLevel]

水を含むブロックが入っても、destroyBlock の手順 4 と removeBlock の手順 2 はそのまま使える。足すのは「流体の状態 → 書くブロック」の対応だけである。

1. 座標の流体の状態を読む。流体の状態は、その座標の**ブロックの状態から決まる** (世界に別の層は無い)。既定は「空」である。
   範囲の外 (§4.1) と、空気だけのセクションも「空」である。
2. 流体の状態から書くブロックを決める。

| 流体の状態 | 書くブロック |
|---|---|
| 空 | air の既定の状態 |
| 水の源 (waterlogged が真のブロック・水源のブロック・常に水中のブロックが持つ) | water の level 0 |
| 流れる水 (water のブロックの level 1 以上が持つ) | water の level = 8 − 量 (最大 8)。落下中なら 8 を足す |
| 溶岩 | lava。level の決め方は水と同じ |

- 読む時点が 2 つで違う。removeBlock は最初に読む。destroyBlock は、パーティクルとドロップ (手順 2・3) の**後**、書く直前に読む。
  手順 3 のドロップが同じ座標を書き換えなければ、手順 1 で読んだ状態から決めた値と同じである。
- 書き込みはどちらもフラグ 3 である (removeBlock は「ピストンで動いた」で 67)。だから水没したブロックが壊れると、
  その座標に水源が置かれ、撤去フック・水の設置フック・NC・SU が普通の書き込みと同じ順で出る (§4.1・§4.2)。水の設置フックは流体の予約 tick を積む (→ 16)。
- destroyBlock の手順 5 のゲームイベントは、手順 4 の書き込みが true を返したときだけ出る。
- 流体そのもののブロック (water・lava) を destroyBlock へ渡すと、書くブロックが今の状態と同じになり、書き込みは false で何も起きない。
  level が 9〜15 の時だけ level 8 へ書き換わる。
- 縦切りの 5 種は、どれも流体の状態が「空」である。書くブロックは常に air なので、空気に固定した今の形と結果は同じである。

### 4.11 /setblock の経路 (実機ハーネスに効く)

実機の fixture は /setblock で入力を入れる。この経路は普通の setBlock と順が違う [26.3 読解: SetBlockCommand・BlockInput#place・ServerLevel#updateNeighboursOnBlockSet]。

1. 置く状態を決める。フラグに 16 が無ければ Block#updateFromNeighbourShapes で周りに合わせる (西・東・北・南・下・上の順に updateShape を当てる)。空気になったら元の状態に戻す。そのあと、コマンドで明示したプロパティを上書きし直す。
2. フラグ 258 (2 + 256) で setBlock する。strict 指定なら 818。
   - フラグ 1 も 64 も無いので、チャンクの中で撤去フックは呼ばれない。
   - 設置フックは呼ばれる。
   - SU は出る。NC は出ない。
   - 256 があるので、古いコンテナの中身は落ちない。
3. strict でなければ ServerLevel#updateNeighboursOnBlockSet を呼ぶ。
   1. 古い状態と今のブロックが違えば、古い状態の撤去フックを「動いた=偽」で呼ぶ。
   2. 6 方向の NC を出す。送り元は**新しい**ブロック。
   3. 今の状態がアナログ出力を持てば CU を出す。

普通のフラグ 3 の setBlock と比べる。

| 段 | フラグ 3 の setBlock | /setblock (26.3) |
|---|---|---|
| 1 | 撤去フック | 設置フック |
| 2 | 設置フック | SU |
| 3 | NC (送り元は古いブロック) | 撤去フック |
| 4 | CU | NC (送り元は新しいブロック) |
| 5 | SU | CU |

destroy 指定のときは、手順 1 の前に Level#destroyBlock (ドロップあり・フラグ 3) を呼ぶ。この書き込みは普通の順 (撤去フック → 設置フック → NC → CU → SU) で動く。
後始末へ渡す「古い状態」は destroyBlock の**後**に読むので空気になる。置くブロックも今の状態も空気なら手順 2 を飛ばし、後始末だけが走る。
/fill と /clone も同じ後始末 (ServerLevel#updateNeighboursOnBlockSet) を使う。ただし全部の座標を書き終えてから、座標ごとに後始末を回す [26.3 読解: FillCommand・CloneCommands]。

後始末の撤去フックの条件は「古い状態と今のブロックが違う」だけである。チャンクの書き込みの中にある「新しいブロックがレール系なら」の例外 (§5.7) は無い。

同じ状態を /setblock すると、手順 2 が偽を返し、コマンドは失敗で終わる。手順 3 は走らず、NC も出ない (BlockEntity のデータを指定して中身が変わった場合は成功扱いになる)。
/setblock は最外から呼ばれるので、各段の連鎖はその段の中で終わる。

[版差 1.21.1] は §6.3 に書く。今の fixture は 1.21.1 で撮っているので、/setblock を入力に使う fixture を 26.3 の正解として使うときは、この順の違いに注意する。→ 19_version-diffs.md。

### 4.12 InstantNeighborUpdater

NeighborUpdater のもう 1 つの実装である。積まずに、呼ばれたその場で受け手を実行する。
SU は残り回数を 1 減らして実行する [26.3 読解: InstantNeighborUpdater]。

**26.3 ではどこからも生成されない**。Level はいつも CollectingNeighborUpdater を作る。
1.21.1・26.2・26.4-pre-1 でも生成している所は無い [26.3 読解: 4 版を検索]。
使われていないので、Rust に写す必要は無い。

似た動きをするのが LevelAccessor#neighborShapeChanged の既定で、Level でない LevelAccessor (ワールド生成用の WorldGenRegion など) で SU をその場で実行する。
回路のシミュレーションには関係しない。

---

## 5. 端の場合と落とし穴

### 5.1 同じ状態を書くと何も起きない

LevelChunk#setBlockState は、古い状態と新しい状態が同一なら「無し」を返す。Level#setBlock は false を返す。
フラグ 3 でも NC も SU も出ない。フックも呼ばれない [26.3 読解]。

「状態を変えずに周りを起こしたい」ブロックは updateNeighborsAt を手で呼ぶ (コンパレーターの比較モードで出力が変わらない tick など。→ 07)。
BlockEntity の値だけが変わる場合 (コンパレーターの出力値・コンテナの中身) は setBlock を通らない。SU は出ない。オブザーバーは気づかない。

状態の比較は同一性である。BlockState はプロパティの組ごとに 1 個しか無いので、プロパティが全部同じなら同一になる。

### 5.2 フラグ 2 だけの書き込みがオブザーバーに見える理由

オブザーバーは neighborChanged を上書きしていない。updateShape で起動する。
SU は Level#setBlock の手順 9 で出る。条件は「フラグ 16 が無い」と「残り回数が 1 以上」だけで、フラグ 1 も 2 も見ない。
だからフラグ 2 だけの書き込み (ダストの電力・リピーター・ランプなど) でも、隣のオブザーバーの updateShape が呼ばれる。

オブザーバーの updateShape は、相手の方向が自分の FACING と同じで、POWERED が偽のとき、予約が無ければ 2 gt 後の tick を積む (→ 08)。

- フラグ 260 (UPDATE_NONE) でも SU は出る。
- フラグ 18・276・340・816・818 は 16 を含むので SU を出さない。オブザーバーに見えない。
- SU は相手の状態の「何が変わったか」を見ない。同じブロックのどのプロパティが変わっても届く。

[実機 1.21.1: observer-detects-dust] がダストの電力変化 (フラグ 2) の検知を裏づける。

### 5.3 SU の結果の書き込みは NC を出さない

Level#setBlock は SU へ渡すフラグから 1 を落とす。SU の受け手が updateShape で別の状態を返すと、Block#updateOrDestroy がそのフラグで setBlock する。

- フラグ 1 が無いので NC は出ない。CU も出ない。
- 別のブロックに変わっても、フラグ 1 も 64 も無ければ撤去フックは呼ばれない (元のフラグに 64 があれば 64 は残るので呼ばれる)。
- 設置フックは呼ばれる。
- SU は続く (16 が無ければ)。

例外は「空気を返した」場合で、destroyBlock がフラグ 3 で書く。NC も撤去フックも出る。

この差は「SU でダストの形が変わる」場面に出る。ダストは updateShape で形を変えるだけで、電力は変えない。
形が変わった書き込みは NC を出さないので、周りの部品は起きない。
ダストの設置フックは「古い状態が同じブロックなら何もしない」なので、ここでも何も出ない (→ 06)。

### 5.4 NC の送り元ブロックは古いブロック

Level#setBlock のフラグ 1 の NC は、古い状態のブロックを送り元にする。
石をレバーに置き換えると、周りへ届く NC の送り元は石である。
/setblock の後始末の NC は新しいブロックを送り元にする (§4.11)。

送り元を見る受け手は少ない。26.3 で送り元のブロックを条件に使うクラスは各メモで扱う (ドア・レールなど)。
Rust でも送り元の種類を運ぶ。

### 5.5 入れ子の中では、書き込みと通知の時点がずれる

neighborChanged の中で setBlock すると、状態はその場で変わる。撤去フックと設置フックもその場で走る。
しかし、フックや setBlock が出した NC・SU・CU は積まれるだけで、今の neighborChanged が戻るまで走らない。

- 1 つの neighborChanged の中で 2 回書き込むと、受け手が動くのは 2 回目の書き込みの後である。受け手は最後の状態だけを見る。
- ShapeUpdate は「相手の状態」を積んだ時点の値で持つ。受け手の updateShape へ渡る相手の状態は、実行の時点では古いことがある。
  受け手自身の状態は実行の時点で読む。
- 最外 (予約 tick・ブロックイベント・プレイヤーの操作・BlockEntity の tick) から呼ばれた setBlock では、
  フックの中の updateNeighborsAt がその場で連鎖を回し切る。setBlock の手順 5 の「読み直し」で別の状態になっていることがある。

最外かどうかで、同じコードの実行順が変わる。Rust でも「実行中か」を 1 個のカウンタで持つ必要がある。

設置フックが自分の座標を書き換える例がある。powered=true のオブザーバーを置くと、設置フックがフラグ 18 で powered=false に書き直す (予約が無いとき)。
外側の setBlock は手順 5 で「頼んだ状態と違う」と判定し、NC も SU も出さない。内側はフラグ 18 なので SU も NC も出さない。
結果として、この設置は周りへ SU を 1 つも出さない [26.3 読解: ObserverBlock#onPlace・Level#setBlock] [要実機: §8 の P1]。
NC は出る。設置フックが書き直しの直後に前方更新 (出力先の 1 マスへの NC と、そこを中心にした除外方向つきの 6 方向) を手で呼ぶからである。中身は → 08。
外側の setBlock は true を返す。呼び出し側は「置けた」と扱う。

### 5.6 FullNeighborUpdate は状態を読み直さない

SimpleNeighborUpdate と MultiNeighborUpdate は、実行の時点で受け手の状態を読む。
FullNeighborUpdate は、積んだ時点の状態の neighborChanged を呼ぶ。

FullNeighborUpdate を使うのは次の所である [26.3 読解]。

| 呼び出し元 | 内容 |
|---|---|
| Level#updateNeighbourForOutputSignal | CU。受け手はコンパレーター |
| BaseRailBlock | レールの設置・形の更新で自分自身へ。「動いた」を運ぶ |
| DetectorRailBlock | つながったレールへ |
| CactusBlock | 上に伸びた分へ |
| ExperimentalRedstoneWireEvaluator | 実験の評価器がダストの周りへ配る更新 (実験が有効なときだけ)。→ 06 |

入れ子で CU が積まれ、実行までにコンパレーターが別の状態になっていた場合、古い状態で neighborChanged が走る。
古い状態の向きやモードで入力を計算し、今の座標に予約 tick を積む可能性がある [要実機: コンパレーターが CU の実行前に壊される・向きが変わる回路で、予約が残るかを測る]。

### 5.7 撤去フックの「レール系なら」の条件

LevelChunk#setBlockState の手順 7 は「ブロックが変わった」だけでなく「新しいブロックがレール系 (BaseRailBlock)」でも撤去フックを呼ぶ。
レールが形やパワーの状態だけ変えたときも、古い状態の撤去フックが走る。→ 15_rails.md。

見るのは**新しい**ブロックである。レールを石に置き換えるのは「ブロックが変わった」に当たる。

### 5.8 フラグ 2 での置き換えは撤去フックを呼ばない

26.3 では、別のブロックへの置き換えでも、フラグ 1 か 64 が無ければ撤去フックは呼ばれない。
点いているトーチやレバーをフラグ 2 だけで空気にすると、トーチやレバーが自分で配るはずの NC が出ない。
SU は出るので、隣のダストの形は変わるが、電力は再計算されない。
[版差 1.21.1] では撤去のフックがいつも呼ばれていた (§6.2)。

### 5.9 SU はカウンタを 6 件進める

NC は 6 方向で 1 件、SU は 1 方向で 1 件である。フラグ 3 の書き込み 1 回で、カウンタは少なくとも 7 進む。
アナログ出力を持てば CU の分 (0〜4 件) が加わる。

### 5.10 上限を超えたとき

- 例外は投げない。その tick の残りは普通に進む。
- 捨てられるのは「上限に達した後に出た更新」だけである。積み済みの更新は走る。
- 書き込みは止まらない。積み済みの NC の受け手が setBlock すれば状態は変わる。ただし、そこから出る NC・SU は捨てられる。
- この結果「状態は変わったのに周りが気づいていない」ブロックが残る。これが更新抑制である。

---

## 6. 版差

### 6.1 まとめ

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| フラグ 128・256・512 | 無い | 有る | 有る | 有る |
| UPDATE_NONE の値 | 4 | 260 | 260 | 260 |
| チャンクの書き込みへ渡すもの | 「ピストンで動いたか」の真偽だけ | フラグ全体 | フラグ全体 | フラグ全体 |
| 撤去のフック | onRemove。状態が変わるたびに必ず呼ぶ | affectNeighborsAfterRemoval。条件つき | 同左 | 同左 |
| 設置フック | 必ず呼ぶ | フラグ 512 で止まる | 同左 | 同左 |
| 古い BlockEntity を外す所 | onRemove の既定の中 | チャンクの書き込みの中 | 同左 | 同左 |
| NC が運ぶもの | 送り元のブロック・**送り元の座標** | 送り元のブロック・Orientation | 同左 | 同左 |
| SU のダスト除外 (128) | 無い | 有る | 有る | 有る |
| NC・SU・CU の方向の並び | 同じ | 同じ | 同じ | 同じ |
| CollectingNeighborUpdater の動き | 同じ | 同じ | 同じ | 同じ |
| 連鎖の上限 | 1,000,000 | 同じ | 同じ | 同じ |
| setBlock のフラグ 1 の NC | blockUpdated 経由 (デバッグワールドでは出さない) | updateNeighborsAt を直接 | 同左 | 同左 |
| setBlock のデバッグワールドの拒否 | 有る | 有る | 有る | **無い** |
| setBlock の範囲の判定 | 高さだけ | 高さ + 水平の範囲 | 同左 | 同左 |
| /setblock の後始末の NC の送り元 | コマンドで頼んだブロック | 書いた後に座標から読み直したブロック | 同左 | 同左 |
| setBlockAndUpdate の置き場 | Level | Level | LevelWriter | LevelWriter |
| /setblock のフラグと後始末 | 2 + blockUpdated | 258 + updateNeighboursOnBlockSet | 同左 | 同左 |
| destroyBlock のパーティクル | 火系以外はレベルイベント 2001 | 同じ | ブロックの spawnDestroyParticles 経由 | 同左 |

26.2 → 26.3 → 26.4-pre-1 の間で、この分野の挙動に効く差は見つからない。
NeighborUpdater・CollectingNeighborUpdater・InstantNeighborUpdater・Orientation・ExperimentalRedstoneUtils は、26.2 と 26.3 で差分なし、26.4-pre-1 とはクラッシュレポートの補助クラスの名前だけが違う。
26.4-pre-1 の setBlock はデバッグワールドの拒否が消えているが、通常のワールドには効かない。

### 6.2 [版差 1.21.1] 撤去のフック

1.21.1 の LevelChunk#setBlockState は、サーバー側で**状態が変わるたびに**古い状態の onRemove を呼ぶ。
フラグ 1 の有無も、ブロックが変わったかも見ない。新しい状態を引数で渡すので、各ブロックが「同じブロックなら何もしない」を自分で判定する。
判定しないブロックは、プロパティだけの変化でも撤去の処理を走らせる。

代表はトーチである。

| 版 | トーチの LIT が変わるフラグ 3 の書き込みで出る NC |
|---|---|
| 1.21.1 | 撤去のフック (6 隣を中心に各 6 方向) → 設置フック (同じ) → 自分の 6 方向 |
| 26.3 | 設置フック (6 隣を中心に各 6 方向) → 自分の 6 方向 |

26.3 は 1 巡少ない。受け手が同じ状態を 2 回読むだけなら結果は同じだが、
1 巡目の途中で予約 tick を積む部品があると、積む順が変わる可能性がある [要実機: 26.3 で撮り直す。→ 08・19]。

ほかの影響:

- 1.21.1 では、フラグ 2 だけで別のブロックへ置き換えても onRemove が走る。26.3 では走らない (§5.8)。
- 1.21.1 では、SU の結果の書き込み (フラグ 1 なし) でも onRemove が走る。26.3 では走らない (§5.3)。
- 1.21.1 の onRemove は新しい状態を受け取る。26.3 の撤去フックは受け取らない。

### 6.3 [版差 1.21.1] /setblock

| 段 | 1.21.1 | 26.3 |
|---|---|---|
| 置く前 | destroy 以外は古い BlockEntity の中身を消す | しない (フラグ 256 で落とさない) |
| 状態の決め方 | updateFromNeighbourShapes の結果をそのまま置く。明示したプロパティも上書きされうる | 同じ計算のあと、明示したプロパティを上書きし直す |
| 書き込み | フラグ 2。チャンクの中で onRemove → onPlace。そのあと SU | フラグ 258。チャンクの中で onPlace だけ。そのあと SU |
| 後始末 | blockUpdated で 6 方向の NC (送り元は新しいブロック)。CU は出さない | 撤去フック → NC → CU (アナログ出力があれば) |
| 同じ状態を置いたとき | 失敗で終わる。NC は出ない | 同じ |

26.3 の /setblock は、撤去フックが設置フックと SU の**後**に来る。1.21.1 は撤去が先である。
/setblock で部品を消す・置き換える fixture は、26.3 で順が変わりうる [要実機]。

### 6.4 [版差 1.21.1] NC の送り元の座標

1.21.1 の neighborChanged は送り元の座標を受け取る。26.x は Orientation に置き換わり、座標は来ない。
1.21.1 で送り元の座標を使っていた受け手が 26.3 でどう判定しているかは、各メモで確かめる。
この分野では、MultiNeighborUpdate が 1.21.1 では中心の座標を、26.3 では Orientation (既定は無し) を渡す、という差だけである。

---

## 7. Rust で実装するときの要点

### 7.1 データ構造

| 部品 | 持ち方 |
|---|---|
| 更新の種類 | 4 つの列挙。Simple (座標・送り元)・Full (状態・座標・送り元・動いたか)・Multi (中心・送り元・除外方向・添字)・Shape (方向・相手の状態・座標・相手の座標・フラグ・残り回数) |
| stack | Vec を末尾 = 上として使う |
| added_this_layer | Vec。追加順 |
| count | u32。上限は i32 相当 (負 = 無制限) で持つか、Option にする |
| フラグ | u16 のビット集合。1・2・4・8・16・32・64・128・256・512 を全部定義する |
| 方向の表 | 定数の配列を 4 本 (values・NC・SU・水平)。添字で引けるようにする |

Multi は「続きがある」間 stack に残る。添字を書き換えるので、stack の一番上を可変で借りる形になる。
受け手の処理が同じ更新器を再入するので、Rust では「一番上を取り出して 1 回実行し、続きがあれば戻す」より、
「添字だけ先に進めてから受け手を呼ぶ」形にすると借用がぶつからない。順序は変わらない。

### 7.2 守る順序 (テストで固定する)

1. setBlock の中: BlockEntity の撤去 → 撤去フック → 設置フック → BlockEntity の作成 → NC → CU → 古い状態の間接 SU → 6 方向の SU → 新しい状態の間接 SU。
2. NC の 6 方向: 西・東・下・上・北・南。除外方向は飛ばす。
3. SU の 6 方向: 西・東・北・南・下・上。1 方向 1 件。
4. CU の 4 方向: 北・東・南・西。直接のコンパレーター、または導体 1 個越し。
5. 入れ子の更新: 追加順に、親の残りより先に。
6. カウンタ: addAndRun ごとに 1。上限に達したら新規だけ捨てる。最外が終わったら 0。

### 7.3 状態の持ち方

- 「同じ状態なら何もしない」を最初に判定する。状態を番号 (状態表の添字) で持てば整数の比較で済む。→ 05。
- フックは「ブロックの種類ごとの関数」として引く。撤去フックと設置フックの呼び出し条件 (§4.2 の表) は書き込みの共通処理に置き、各ブロックに持たせない。
- setBlock の手順 5 の「読み直して違えば通知しない」を落とさない。最外でフックが連鎖を回し切る場合に効く。
- ShapeUpdate と FullNeighborUpdate は状態の写しを持つ。状態が番号なら写しは軽い。
- クライアント向けの処理 (フラグ 2・4・8、再描画、POI、経路探索、高さマップ) は第 1 版では省いてよい。ただしフラグの値は受け取って捨てる。光は日照センサーが読むので、→ 09 で要否を決める。
- Orientation は第 1 版では「無し」固定でよい。NC の引数に席だけ空ける。実験の評価器を入れるときに 48 個の表を足す。

### 7.4 他のメモとの境界

| 境界 | こちら (04) | あちら |
|---|---|---|
| 予約 tick | 更新の中から積まれる、という事実だけ | 02 が持つ |
| ブロックイベント | 同上 | 03 が持つ |
| ダスト | SU の 128 の除外・間接 SU を呼ぶ位置 | 06 が中身を持つ |
| 各ブロックのフック | 呼ぶ条件と順 | 各メモが中身を持つ |
| コンパレーター | CU の届け先 | 07 が受け手を持つ。14 が出す契機を持つ |
| ピストン | フラグの意味 | 13 がフラグの組と手で呼ぶ SU を持つ |

### 7.5 最外の入口

更新器は「実行中でないときに呼ばれたら、その場で回し切る」。Rust でも同じにする。
tick のフェーズごとにまとめて回す形にしない。1 つの予約 tick の処理の中で、setBlock が戻った時点で連鎖が終わっていることを、後続のコードが前提にしている
(例: リピーターの tick が書き込みのあと、入力を読み直して次の予約を積む)。

---

## 8. 検証用のプローブ回路案

26.3 の実機で撮る。名前は案である。

### P1. set-flag2-observer (フラグ 2 と 16 の SU)

| 項目 | 内容 |
|---|---|
| 目的 | フラグ 2 の書き込みは SU を出し、フラグ 18 の書き込みは出さないことを確かめる |
| 配置 | レーン A: ランプを見るオブザーバー。ランプへレバーで給電。レーン B: オブザーバー X が見るマスへ、powered=true のオブザーバー Y を /setblock で置く。Y の設置フックは予約が無いのでフラグ 18 で自分を消す |
| 観測 | A: レバーの tick から 2 gt 後にオブザーバーが点く。B: X は一度も点かない想定 [要実機]。Y の設置フックが同じ座標を書き換えるので、外側の書き込みは §4.1 の手順 5 で通知を全部飛ばす。内側の書き込みはフラグ 18 で SU を出さない。対照として powered=false の Y を置くと X が 2 gt 後に点くこと |

### P2. nested-fifo-order (入れ子の順)

| 項目 | 内容 |
|---|---|
| 目的 | 1 つの NC の中から出た更新が、追加順に、親の残りより先に走ることを確かめる |
| 配置 | レバーの西に「NC で即座に書き込む部品」(ダスト)、その先に優先度が同じ予約を積む部品を 2 個 (コンパレーターとオブザーバー)。レバーの東にも同じ形を鏡に置く |
| 観測 | 同じ gt・同じ優先度で予約された部品の実行順 (ブロックイベントの順で読む)。西側の 2 個が東側より先、西側の中では NC の受け手が SU の受け手より先 |

[実機 1.21.1: lever-nc-before-shape-race] [実機 1.21.1: button-nc-before-shape-race] が 1.21.1 での「NC が SU より先」を押さえている。26.3 で撮り直す。

### P3. removal-hook-flag2 (撤去フックの条件)

| 項目 | 内容 |
|---|---|
| 目的 | 26.3 で、フラグ 1 の無い置き換えが撤去フックを呼ばないことを確かめる |
| 配置 | 点いたトーチの上に導体、その横にランプ。トーチを消す経路を 2 つ用意する。(a) /setblock で空気にする (撤去フックは後始末で走る)。(b) ピストンで押して壊す (destroyBlock。フラグ 3) |
| 観測 | (a)(b) ともランプが消える tick。加えて /setblock ... strict (後始末なし) でランプが点いたまま残ること |

### P4. torch-toggle-nc-count (トーチの版差)

| 項目 | 内容 |
|---|---|
| 目的 | LIT の切り替えで撤去のフックが走らなくなったことが、結果に出るかを確かめる |
| 配置 | トーチの周り 6 マスの隣に、NC で予約を積む部品 (リピーター・コンパレーター・ピストン) を並べる。同じ gt に同じ優先度の予約が複数積まれる形にする |
| 観測 | 予約の実行順。1.21.1 と 26.3 で同じ回路を撮り、ブロックイベントの順とピストンの取り合いの勝者を比べる |

### P5. cu-through-conductor (CU の届け先)

| 項目 | 内容 |
|---|---|
| 目的 | CU が水平 4 方向・導体 1 個越しまで・コンパレーターだけに届くことを確かめる |
| 配置 | 樽を中心に、北・東・南・西へ「直接のコンパレーター」「石越しのコンパレーター」「石 2 個越しのコンパレーター」「ガラス越しのコンパレーター」。上下にもコンパレーター付きのブロックを置く。各コンパレーターの出力にダスト |
| 観測 | 樽へアイテムを入れた gt から 2 gt 後に、直接と石越しだけが変わる。石 2 個越し・ガラス越しは変わらない |

[実機 1.21.1: comparator-through-conductor-replace] [実機 1.21.1: barrel-comparator-input] が一部を押さえている。

### P6. cu-stale-state (FullNeighborUpdate の古い状態)

| 項目 | 内容 |
|---|---|
| 目的 | CU が積まれてから実行されるまでにコンパレーターが変わったとき、何が起きるかを測る (§5.6) |
| 配置 | 1 つの NC の中で「検知レールの出力変化 (CU を積む)」と「コンパレーターを押すピストンの始動」が同じ層に入る形 |
| 観測 | コンパレーターのあった座標に予約 tick が残るか。ブロックイベントの順 |

### P7. shape-chain-limit (残り回数)

| 項目 | 内容 |
|---|---|
| 目的 | SU だけの連鎖が 512 世代で止まることを確かめる |
| 配置 | 塀や足場のように、隣の形で自分の形が決まり、1 マスずつ伝わるブロックを 520 個つなぐ。端を変える |
| 観測 | 何個目まで形が変わるか。513 個目で止まる想定。止まった先の端にオブザーバーを置き、点かないこと |

[実機 1.21.1: wall-post-cascade] が 7 段の同 tick の連鎖を押さえている。

### P8. setblock-order (/setblock の順)

| 項目 | 内容 |
|---|---|
| 目的 | 26.3 の /setblock が「設置フック → SU → 撤去フック → NC → CU」の順で動くことを確かめる |
| 配置 | レバーを /setblock でトーチに置き換える。隣に、NC で予約を積むコンパレーターと、SU で予約を積むオブザーバー |
| 観測 | 同じ gt・同じ優先度の 2 つの予約の実行順。26.3 ではオブザーバーが先、フラグ 3 の書き込み (レバーを手で倒す) ではコンパレーターが先 |

[実機 1.21.1: observer-mutual-clock-setblock] が 1.21.1 の /setblock の設置更新を押さえている。

### P9. update-suppression-count (上限)

| 項目 | 内容 |
|---|---|
| 目的 | 上限を超えたとき、積み済みは走り、新規だけ捨てられることを確かめる |
| 配置 | 専用サーバーで max-chained-neighbor-updates を小さい値 (例 20) にし、ダストの線をレバーで点ける |
| 観測 | どのダストまで電力が変わるか。ログの「最初に捨てた座標」。カウントが「Multi は 1 件・SU は 1 方向 1 件」で合うか |

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §4

| 該当箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §4.2「サーバ側は state 変化のたびに旧 state onRemove / 新 state onPlace が呼ばれる」 | 両方がいつも呼ばれる | 設置フックはいつも (512 が無ければ)。撤去フックは「ブロックが変わった、または新しいブロックがレール系」かつ「フラグ 1 か 64」のときだけ | 1.21.1 の記述としては正しい。26.3 では違う。26.3 を基準にするなら書き直す |
| §4.2 トーチ「onRemove/onPlace (LIT 変化ごとに両方呼ばれる)」 | 2 段送信が 2 回 | 26.3 は設置フックの 1 回だけ | 同上。16 §2.4 には版の違いとして書いてある |
| §4.2「flag 1: NC (自身の隣接 6 へ blockUpdated)」 | blockUpdated 経由 | 26.3 に blockUpdated は無い。updateNeighborsAt を直接呼ぶ | 名前だけの差。挙動は同じ |
| §4.2「flag 2: クライアント送信のみ」 | そのとおり | 同じ。SU は別の行に書いてある | 一致 |
| §4.2 フラグの説明 | 1・2・16 だけ | 32・64・128・256・512 も挙動に効く。SU へ渡すとき 1 と 32 を落とす | 既存は不足。誤りではない |
| §4.2 NC の送り元 | 記述なし | フラグ 1 の NC の送り元は古いブロック | 既存は不足 |
| §4.1 NC に「反応するもの: 赤石素子」 | 受け手を素子に限るように読める | NC は空気を含む全ブロックの neighborChanged を呼ぶ。反応するかは各ブロックの上書きしだい (ドア・レール・流体・スポンジ・TNT なども上書きしている) | 既存は「回路で意味のある受け手」の説明としては正しい。Rust の配り方は受け手を絞らない |
| §4.2「flag 16 が無い限り PP は every setBlock で発火」 | 条件は 16 だけ | 残り回数が 1 以上という条件もある。SU へ渡すフラグは 1 と 32 を落とす | 既存は不足。SU 由来の書き込みが NC を出さないこと (§5.3) が既存に無い |
| §4.2 補足「26.2 の実装は CollectingNeighborUpdater / InstantNeighborUpdater の 2 種」 | 2 種ある | クラスは 2 つあるが、InstantNeighborUpdater は生成されない | 既存は誤解を招く。使うのは 1 種 |
| §4.2「updateShape の深度上限 512 … sim は PP 再帰カスケードを持たないため対象外」 | 対象外 | 塀・板などの連鎖は今の sim にもある (16 §2.2 の R-22) | Rust では残り回数を実装する |
| §4.2 方向の並び (NC・SU・CU) | 3 本とも記載 | 一致 | 一致 |
| §4.2 CollectingNeighborUpdater の DFS・上限 100 万 | 記載 | 一致 | 一致 |

### 9.2 docs/research/11_dust-shape-powering.md

ダストの形と給電の資料で、この分野と重なるのは「形は updateShape で張り替わる」という前提だけである。
26.3 の読みと食い違う記述は見つからない。
補うべき点は、SU でダストの形が変わる書き込みはフラグ 1 を持たず NC を出さないこと (§5.3) と、
実験の評価器がフラグ 128 でダストへの SU を止めること (§3.1) である。中身は → 06。

### 9.3 docs/research/12_update-suppression.md

| 該当箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §1.2 打ち切りの手順 | 記載 | 一致 | 一致 |
| §1.3 カウントの単位 | Multi は 1 件・SU は 1 件・CU は呼んだ本数 | 一致 | 一致 |
| §1.4「shape 更新のたびに updateLimit - 1 して伝播 (Level・LevelAccessor#neighborShapeChanged・InstantNeighborUpdater)」 | 3 か所で減ると読める | 実際のワールドで減らすのは Level#setBlock だけ。LevelAccessor の既定と InstantNeighborUpdater は Level の経路で使われない | 結論 (1 世代で 1 減る) は合う。典拠の挙げ方が広すぎる |
| §1.4「512 段の updateShape 連鎖は手組みでは非現実的」「sim は PP の再帰カスケードを持たないので対象外で問題ない」 | 対象外 | 残り回数は SU だけの連鎖にしか効かない点は合う。ただし今の sim には塀・板の連鎖がある (16 §2.2 の R-22)。Rust は SU を全ブロックへ配るので連鎖は普通に起きる | 02 §4.2 の同じ記述と同じ判断。Rust では残り回数を実装する。512 段に届く回路が組めるかは [要実機: P7] |
| §2c「上限到達時に updateStack / addedThisLayer を空にして打ち切り…骨格は正しい」 | sim の打ち切りを正しいとする | 26.3 は積み済みを最後まで走らせ、新規だけ捨てる。空にするのは最外が終わるとき | 既存の §1.2 自身とも合わない。**26.3 の読みが正しい**。sim は積み済みまで捨てている |

### 9.4 docs/research/16_nucleation-comparison.md §2.2

| 該当箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| SU の経路「NC と同じスタック」 | Nucleation が vanilla に近い | 一致 (3 種とも同じスタック) | 一致 |
| setBlock (フラグ 3) の中の順「NC → 形状更新」 | 26.2 と同じ | 26.3 も同じ。正確には 撤去フック → 設置フック → NC → CU → SU | 一致。フックと CU の位置を足す |
| CU の宛先「コンパレーターだけ」 | redstone-sim が正しい | 一致 | 一致 |
| 形状更新の深さ上限 512 | どちらも無い | 26.3 には有る | 一致 (Rust で入れる) |

### 9.5 今の TS 実装 (packages/sim/src) との違い

コードは変えない。Rust へ移すときの注意として書く。

| 場所 | 今の TS | 26.3 | 影響 |
|---|---|---|---|
| updates.ts の方向の定数 (NC・SU・CU・values) | 4 本 | 一致 | なし |
| world.ts の propagateChange | 形の張り替えと SU を先にし、素子の NC を出し、ダストの最終値を BFS で確定してから SU と NC を出す | 書き込み 1 回ごとに フック → NC → CU → SU。ダストは 1 本ずつ書く | 途中の値が出ない。同 gt・同優先度の予約の順がずれうる (16 §2.2・§2.3 の既知の差) |
| world.ts の emitShapeUpdate | スタックの外でその場で実行。受け手はオブザーバー・塀・板・音符ブロックだけ | SU も同じスタックに積む。受け手は全ブロック | 入れ子のとき、SU の受け手が動く時点が早い |
| world.ts の emitComparatorUpdate | コンパレーターの neighborChanged を直接呼ぶ | FullNeighborUpdate として積む | 入れ子のとき、CU の受け手が動く時点が早い |
| world.ts の submitUpdate のカウント | 実行した neighborChanged の数。Multi は方向ごと。SU・CU は数えない | 提出の数。Multi は 1 件。SU・CU も数える | 上限付近だけ (12 §2b の既知の差) |
| world.ts の submitUpdate の打ち切り | 上限でスタックと追加分を空にする | 積み済みは走らせ、新規だけ捨てる | 上限付近だけ。更新抑制の再現に効く |
| world.ts の submitMultiNC の送り元 | 既定は「中心の座標に今あるブロック」 | フラグ 1 の NC は古いブロック。フックや手で呼ぶ NC は呼び出し側が渡すブロック | 送り元を見る受け手 (ドア・レール) で差が出うる |
| トーチの NC | 2 段送信を 2 回 (1.21.1 の形)。起点の順は西・東・下・上・北・南 | 26.3 は 1 回。起点の順は Direction の宣言順 (下・上・北・南・西・東) | 16 §2.4 の R-21 と同じ。26.3 を基準にするなら 1 回 |
| 撤去フック・設置フックの条件 | フックという形が無い。素子ごとに propagateChange の中で配る | §4.2 の表 | Rust では共通処理に置く |
| フラグ | 持たない | 10 ビット | Rust では持つ。特に 16・64・128・512 |
| 「同じ状態なら何もしない」 | 呼び出し側が個別に判定 | setBlock の入口で一律 | Rust では入口に置く |
| 形状更新の残り回数 | 無い | 512 | Rust では持つ |

---

## 10. 典拠一覧

- 26.3 Level#setBlock
- 26.3 Level#removeBlock
- 26.3 Level#destroyBlock
- 26.3 Level#neighborShapeChanged
- 26.3 Level#updateNeighbourForOutputSignal
- 26.3 Level#updatePOIOnBlockStateChange
- 26.3 Level のコンストラクタ (CollectingNeighborUpdater の生成)
- 26.3 LevelWriter#setBlock (3 引数)・LevelWriter#setBlockAndUpdate・LevelWriter#destroyBlock
- 26.3 LevelAccessor#updateNeighborsAt・LevelAccessor#neighborShapeChanged
- 26.3 ServerLevel#updateNeighborsAt (2 引数・3 引数)
- 26.3 ServerLevel#updateNeighborsAtExceptFromFacing
- 26.3 ServerLevel#neighborChanged (3 引数・5 引数)
- 26.3 ServerLevel#updateNeighboursOnBlockSet
- 26.3 ServerLevel#sendBlockUpdated
- 26.3 ServerLevel#updatePOIOnBlockStateChange
- 26.3 MinecraftServer#getMaxChainedNeighborUpdates
- 26.3 DedicatedServerProperties (max-chained-neighbor-updates)
- 26.3 LevelChunk#setBlockState
- 26.3 LevelChunk#removeBlockEntity
- 26.3 Block (UPDATE_ 系の定数・UPDATE_LIMIT)
- 26.3 Block#updateFromNeighbourShapes
- 26.3 Block#updateOrDestroy
- 26.3 BlockBehaviour (UPDATE_SHAPE_ORDER)
- 26.3 BlockBehaviour#updateShape・#neighborChanged・#onPlace・#affectNeighborsAfterRemoval・#updateIndirectNeighbourShapes・#shouldChangedStateKeepBlockEntity
- 26.3 BlockBehaviour.BlockStateBase#handleNeighborChanged・#updateNeighbourShapes・#updateIndirectNeighbourShapes
- 26.3 NeighborUpdater (UPDATE_ORDER)
- 26.3 NeighborUpdater#executeUpdate
- 26.3 NeighborUpdater#executeShapeUpdate
- 26.3 NeighborUpdater#updateNeighborsAtExceptFromFacing
- 26.3 CollectingNeighborUpdater#addAndRun
- 26.3 CollectingNeighborUpdater#runUpdates
- 26.3 CollectingNeighborUpdater の SimpleNeighborUpdate・FullNeighborUpdate・MultiNeighborUpdate・ShapeUpdate
- 26.3 InstantNeighborUpdater#shapeUpdate・#neighborChanged
- 26.3 Orientation#of・#withFront・#withUp・#withFrontPreserveUp・#withFrontAdjustSideBias・#withSideBias・#getDirections・#getHorizontalDirections・#getVerticalDirections・#generateIndex・#random
- 26.3 ExperimentalRedstoneUtils#initialOrientation・#withFront
- 26.3 Direction (宣言順)・Direction.Plane (HORIZONTAL・VERTICAL)
- 26.3 BlockEntity#setChanged・BlockEntity#preRemoveSideEffects
- 26.3 Containers#updateNeighboursAfterDestroy
- 26.3 BlockInput#place
- 26.3 SetBlockCommand (setBlock の本体)
- 26.3 RedstoneWireBlock#updateIndirectNeighbourShapes (上書きの有無だけ)
- 26.3 PistonBaseBlock (updateIndirectNeighbourShapes を手で呼ぶ所だけ)
- 26.3 ObserverBlock#updateShape (SU の受け手の例)
- 26.3 RedstoneTorchBlock#onPlace・#affectNeighborsAfterRemoval (版差の例)
- 26.3 CopperChestBlock#shouldChangedStateKeepBlockEntity・CopperGolemStatueBlock#shouldChangedStateKeepBlockEntity
- 1.21.1 Level#setBlock・LevelChunk#setBlockState・BlockBehaviour#onRemove・ServerLevel#blockUpdated・NeighborUpdater・CollectingNeighborUpdater・SetBlockCommand・BlockInput#place (版差の確認)
- 26.2・26.4-pre-1 の同名クラス (差分の確認)
