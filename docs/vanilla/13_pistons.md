# 13 ピストン (ピストン・粘着ピストン・moving_piston・押し構造)

基準は Java 版 26.3。確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] `tools/mc-harness/fixtures/` の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

この文書の記号: P = ピストン本体の座標、d = 本体の facing、A = P+d (腕のセル。ヘッドが入る)、B = P+2d (ヘッドの 1 つ先)。T = ブロックイベントが実行された tick。

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| PistonBaseBlock | 全メソッド (setPlacedBy・neighborChanged・onPlace・checkIfExtend・getNeighborSignal・triggerEvent・isPushable・moveBlocks・getShape) |
| PistonStructureResolver | 全メソッド (resolve・addBlockLine・reorderListAtCollision・addBranchingBlocks・isSticky・canStickToEachOther) |
| PistonMovingBlockEntity | 全メソッド (tick・finalTick・preRemoveSideEffects・moveCollidedEntities・moveStuckEntities・getCollisionShape・保存と読み込み) |
| MovingPistonBlock | 全メソッド (newBlockEntity・getTicker・destroy・useWithoutItem・getCollisionShape) |
| PistonHeadBlock | 全メソッド (canSurvive・updateShape・neighborChanged・affectNeighborsAfterRemoval・playerWillDestroy・isFittingBase) |
| PistonMath | getMovementArea |
| PushReaction | 5 つの値 |
| SlimeBlock・HoneyBlock | ピストンに関わるフックが無いことの確認 (くっつく規則は PistonStructureResolver の中にある) |
| Blocks | piston・sticky_piston・piston_head・moving_piston の登録と、pushReaction の指定の一覧 |
| BlockBehaviour.BlockStateBase | getPistonPushReaction・updateNeighbourShapes・updateIndirectNeighbourShapes・shouldChangedStateKeepBlockEntity |
| Block | UPDATE_ で始まる定数・updateFromNeighbourShapes・updateOrDestroy |
| Level・LevelChunk | setBlock・removeBlock・destroyBlock・setBlockEntity・removeBlockEntity・tickBlockEntities・LevelChunk#setBlockState (フラグ 1・64・256・512 の効き方) |
| ServerLevel | tick (handlingTick の区間)・blockEvent・doBlockEvent・updateNeighborsAt |
| SignalGetter | hasSignal・getSignal・getDirectSignalTo |
| ExperimentalRedstoneUtils | initialOrientation |
| Vec3i | hashCode (HashMap の反復順のため) |

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick のフェーズ順・BlockEntity 相の中の順・プレイヤー入力の位相 | → 01_tick-loop.md |
| ブロックイベントのキュー (重複排除・同 tick 内の連鎖・範囲外の退避) | → 03_block-events.md |
| setBlock のフラグの一般則・近隣更新の配り方・形状更新・Orientation | → 04_set-block-and-updates.md |
| hasSignal の中身 (強/弱・導体)・押し反応の全ブロック表 | → 05_signals-and-block-properties.md |
| ダストが形状更新や近隣更新を受けたときの動き | → 06_redstone-wire.md |
| オブザーバーが押されたとき・着地したときの発火 | → 08_torch-observer-redstone-block.md |
| レールが押されたとき | → 15_rails.md |
| エンティティを押す処理の細部・壊したブロックのアイテム化 | → 17_entities-interplay.md |
| HashMap の反復順の一般則 | → 18_determinism-java-semantics.md |
| 版ごとの fixture の有効性 | → 19_version-diffs.md |

---

## 2. 全体像

### 2.1 一言で

ピストンは「近隣更新で信号を調べ、状態と食い違えばブロックイベントを積む。ブロックイベント相で実際に動かす。動いたブロックは moving_piston と BlockEntity になり、BlockEntity 相で 2 回進んで 3 回目に着地する」。[26.3 読解]

### 2.2 伸長の時系列

| いつ | 相 | 何が起きるか |
|---|---|---|
| 任意 | 近隣更新を受けた時点 | PistonBaseBlock#checkIfExtend。信号あり・未伸長・押し構造が解決できる → 種別 0 のブロックイベントを積む |
| T | ブロックイベント相 | PistonBaseBlock#triggerEvent。信号を見直す → moveBlocks (A と押し先を moving_piston にする) → 本体を extended=true にする |
| T | BlockEntity 相 | 作られたばかりの BlockEntity も同じ tick に進む。progress 0 → 0.5 |
| T+1 | BlockEntity 相 | progress 0.5 → 1.0 |
| T+2 | BlockEntity 相 | 着地。A は piston_head、押し先は元のブロックになる。近隣更新と形状更新が出る |

- 積んだ相がブロックイベント相より前 (予約 tick 相など) なら、同じ tick に実行される。後 (エンティティ相・BlockEntity 相・プレイヤー入力) なら次の tick になる。[26.3 読解] ServerLevel#tick
- レバー入力 t2 → 実行 t3 → 着地 t5。[実機 1.21.1: piston-basic]
- 着地は BlockEntity 相なので、着地したブロックが次のピストンを起動すると、その実行は次の tick になる (連鎖は 3 tick 間隔)。[実機 1.21.1: rblock-piston-chain]

### 2.3 収縮の時系列

| いつ | 相 | 何が起きるか |
|---|---|---|
| 任意 | 近隣更新を受けた時点 | checkIfExtend。信号なし・伸長済み → 種別 1 または 2 を積む (押し構造は調べない) |
| T | ブロックイベント相 | triggerEvent。信号が戻っていれば取り消し。そうでなければ本体を moving_piston にし、ヘッドを消す。粘着なら B を引く |
| T, T+1 | BlockEntity 相 | progress が 0.5 ずつ進む |
| T+2 | BlockEntity 相 | 本体が piston (extended=false) に戻る。引いたブロックが A に着地する |

- 本体が moving_piston の間 (T〜T+2 の着地まで)、本体は近隣更新を受けない。着地のときに onPlace が走り、そこで信号を調べ直す。[26.3 読解] PistonBaseBlock#onPlace

### 2.4 ブロックの移り変わり

| セル | 伸長 (T の実行後) | 伸長 (T+2 着地後) | 収縮 (T の実行後) | 収縮 (T+2 着地後) |
|---|---|---|---|---|
| P | piston extended=true | 同じ | moving_piston (中身 = piston extended=false) | piston extended=false |
| A | moving_piston (中身 = piston_head) | piston_head | 空気、または moving_piston (引いたブロック) | 空気、または引いたブロック |
| 押し先 | moving_piston (中身 = 元のブロック) | 元のブロック | — | — |

---

## 3. 状態とデータ

### 3.1 blockstate

| ブロック | プロパティ | 値域 | 備考 |
|---|---|---|---|
| piston / sticky_piston | facing | down・up・north・south・west・east | 設置時は「見ている向きの逆」 |
| | extended | true / false | 既定 false |
| piston_head | facing | 6 方向 | 本体と同じ向き |
| | type | normal / sticky | |
| | short | true / false | 既定 false。サーバの論理では書かれない (当たり判定の形だけ) |
| moving_piston | facing | 6 方向 | **常にピストンの facing**。収縮で逆向きに動くブロックでも同じ |
| | type | normal / sticky | 腕と本体のときだけ意味がある。押されるブロックは normal |

### 3.2 登録時の性質 [26.3 読解] Blocks

| ブロック | 硬さ | 導体 | 押し反応 | そのほか |
|---|---|---|---|---|
| piston / sticky_piston | 1.5 | 常に非導体 | IMMOVEABLE (ただし isPushable が特別扱いし、extended=false なら押せる) | 窒息は extended=false のときだけ |
| piston_head | 1.5 | 既定 (形で決まる。→ 05) | IMMOVEABLE | ルートテーブルなし |
| moving_piston | -1 | 常に非導体 | IMMOVEABLE | 形が動的・遮蔽なし・ルートテーブルなし。空気ではない |

- moving_piston は信号を出さない・導体でもない。運ばれている間のレッドストーンブロックは給電しない。[26.3 読解] [実機 1.21.1: piston-transit-nc] (レッドストーンブロックの隣の音符ブロックが、動かした tick に powered=false になる)

### 3.3 PistonMovingBlockEntity の持つ値

| 値 | 型 | 初期値 | 意味 | 保存キー |
|---|---|---|---|---|
| movedState | blockstate | 空気 | 着地したら置くブロック | blockState |
| direction | 方向 | — | ピストンの facing (動く向きではない) | facing (旧式の番号) |
| extending | 真偽 | false | 伸長で作られたか | extending |
| isSourcePiston | 真偽 | false | 腕 (伸長) または本体 (収縮) か | source |
| progress | 小数 | 0.0 | 今の進み | — |
| progressO | 小数 | 0.0 | 1 つ前の tick の進み | progress (**保存するのは progressO**) |
| lastTicked | 整数 | 0 | 最後に tick したゲーム時刻 | 保存しない |
| deathTicks | 整数 | 0 | クライアント専用 | 保存しない |

- 動く向き = extending なら direction、そうでなければ direction の逆。getMovementDirection と getPushDirection は同じ値を返す。
- 読み込みでは progress と progressO の両方に保存値が入る。1 回進んだ直後 (progressO=0・progress=0.5) に保存して読み直すと 0 からやり直しになる。[26.3 読解] [要実機] 保存をまたぐ着地の遅れ

### 3.4 定数

| 定数 | 値 | 所在 |
|---|---|---|
| 押せる個数の上限 | 12 | PistonStructureResolver |
| ブロックイベントの種別 | 0 = 伸長、1 = 収縮、2 = 収縮 (ブロックを置いていく) | PistonBaseBlock |
| ブロックイベントの引数 | facing の番号 (down 0・up 1・north 2・south 3・west 4・east 5) | PistonBaseBlock#checkIfExtend |
| progress の刻み | 0.5 / tick | PistonMovingBlockEntity#tick |
| エンティティを押す余白 | 0.01 | PistonMovingBlockEntity |

### 3.5 使われる setBlock のフラグ値

ビットの意味: 1 近隣更新、2 クライアント送信、4 再描画しない、16 形状更新をしない、32 ドロップ抑止、64 ピストンによる移動、256 BlockEntity の除去時の副作用を省く、512 onPlace を省く。一般則は → 04。

| 値 | 内訳 | 使う所 | 近隣更新 | 形状更新 | 旧ブロックの除去フック | onPlace |
|---|---|---|---|---|---|---|
| 2 | 2 | 収縮の取り消しで extended=true を書き直す | 無 | 有 (状態が変わるときだけ。普通は同じ状態なので書き込み自体が起きない。変わる場合は §5.3) | 無 (同じブロック種) | 無 (同じブロック種なので checkIfExtend に入らない) |
| 3 | 1+2 | removeBlock (ヘッドの撤去)・finalTick の確定・着地で生存できないときの破壊 | 有 | 有 | 有 (movedByPiston=false) | 有 (false) |
| 18 | 2+16 | 壊すセルを空気にする | 無 | 無 | **無** (後でまとめて呼ぶ) | — |
| 67 | 1+2+64 | 本体を extended=true にする・通常の着地 | 有 | 有 (配るときのフラグは 66) | 有 (true) | 有 (true) |
| 82 | 2+16+64 | 空いた出発セルを空気にする | 無 | 無 (後でまとめて配る) | 有 (true) | — |
| 276 | 4+16+256 | 収縮で本体を moving_piston にする・引く前にヘッドを消す | 無 | 無 | 無 | 有 (false。moving_piston は何もしない) |
| 324 | 4+64+256 | 押し先と腕に moving_piston を置く | 無 | **有** (配るときのフラグも 324) | 有 (true) | 有 (true。何もしない) |
| 340 | 4+16+64+256 | 着地で生存できないブロックをいったん置く | 無 | 無 | 有 (true。moving_piston は何もしない) | 有 (true) |

- 除去フック = 旧ブロックの affectNeighborsAfterRemoval。LevelChunk#setBlockState は「ブロック種が変わり、かつフラグ 1 か 64 がある」ときだけ呼ぶ。[26.3 読解]
- 形状更新 = Level#setBlock がフラグ 16 の無いときに、旧状態の間接形状更新 → 新状態の 6 隣への形状更新 (西・東・北・南・下・上) → 新状態の間接形状更新、の順で配るもの。配るフラグは元の値から 1 と 32 を落とした値。[26.3 読解]

---

## 4. 処理の詳細

### 4.1 信号の確認: PistonBaseBlock#getNeighborSignal [26.3 読解]

次の順に調べ、1 つでも信号があれば真を返す。

1. Direction の定義順 (下・上・北・南・西・東) で、facing を除く 5 方向について、隣のセル P+方向 が「その方向へ出す信号」を持つか (SignalGetter#hasSignal。隣が導体なら、その導体に入る強い信号も数える。→ 05)。
2. P 自身を、方向 = 下で調べる。ピストンは信号源でも導体でもないので、**常に偽**。効果の無い検査である。
3. 1 つ上のセル U = P の上について、下を除く 5 方向 (上・北・南・西・東) の隣 U+方向 を同じ方法で調べる。これが準接続 (QC)。

| 見る位置 | 個数 | 備考 |
|---|---|---|
| P の隣 (facing 側を除く) | 5 | facing 側 (A) は見ない |
| P の 2 つ上 | 1 | QC |
| P の上のセルの水平 4 隣 | 4 | QC |

- QC の 5 箇所は facing に関係なく同じ。上向きのピストンでも、ヘッドの先 (P の 2 つ上) を見る。
- U そのものが下へ出す信号は手順 1 の「上」で見ている。
- 信号を調べるのは、近隣更新を受けたとき・設置されたとき・ブロックイベントを実行するとき、だけである。QC の位置が変わっても近隣更新が届かなければ気づかない (BUD)。[実機 1.21.1: qc-bud]

### 4.2 ブロックイベントを積む: PistonBaseBlock#checkIfExtend [26.3 読解]

呼ばれる契機 (どれもサーバ側だけ):

| 契機 | 条件 |
|---|---|
| neighborChanged | 無条件 |
| setPlacedBy | プレイヤーなどが置いたとき |
| onPlace | 置き換え前が別のブロック種で、かつ P に BlockEntity が無いとき (moving_piston からの着地はこれに当たる) |

形状更新では呼ばれない (PistonBaseBlock は updateShape を持たない)。

判定:

1. facing を読み、getNeighborSignal で信号の有無を得る。
2. 信号あり かつ extended=false: 押し構造を「伸長」で解決する (§4.7)。成功したときだけ、種別 0・引数 = facing の番号 のブロックイベントを積む。失敗なら何もしない。
3. 信号なし かつ extended=true: 種別を決めて、必ず積む (押し構造は調べない)。種別は既定で 1。次をすべて満たすと 2 になる。
   - B が moving_piston で、その facing が d と同じ
   - B の BlockEntity が PistonMovingBlockEntity で、extending が真
   - 次のどれか: その progressO が 0.5 未満 / 今のゲーム時刻がその lastTicked と等しい / ServerLevel#isHandlingTick が真
4. それ以外 (信号と状態が合っている) は何もしない。

補足:

- isHandlingTick が真なのは、ServerLevel#tick の先頭からブロックイベント相の終わりまで (予約 tick・流体 tick・襲撃・チャンクのランダム tick・ブロックイベント)。エンティティ相と BlockEntity 相では偽。[26.3 読解]
- 種別 2 の 3 条件の意味: 「このイベントが実行される時点で、B のブロックがまだ着地していない」ことの近似である。progressO が 0.5 以上・lastTicked が今と違う・isHandlingTick が偽、がそろうのは、着地する tick (T+2) のエンティティ相か、BlockEntity 相でその BlockEntity の番が来る前だけ。そのとき積んだイベントは次の tick に実行され、B は着地済みなので種別 1 でよい。[26.3 読解 からの導出]
- キューは重複を除く集合なので、同じ (座標・ブロック・種別・引数) を何度積んでも 1 件である (→ 03)。種別 1 と 2 は別物として両方入りうる (例: 予約 tick 相で B が伸長中のうちに種別 2 が入り、同じ tick のブロックイベント相で別のピストンのイベントが B を確定させ、その近隣更新で種別 1 が入る。逆に、B が普通のブロックのうちに種別 1 が入り、実行までの間に別のピストンが同じ向きでブロックを B へ押し込むと種別 2 が入る)。両方入ったときは**先に入った方だけが効く**。先の実行が収縮まで進めば P は moving_piston になり、後のイベントは ServerLevel#doBlockEvent のブロック種の照合で捨てられる。先の実行が信号で取り消されたなら、後も同じ信号で取り消される。[26.3 読解 からの導出] [要実機] P4 で確認
- プレイヤーの右クリック (レバーなど) は、tick と tick の境界で処理される。26.3 では次の周回の先頭 (区間 A。MinecraftServer#processPacketsAndTick が tickServer の前にパケットのキューを処理する) で、全ディメンションの tick の後・次の tick のゲーム時刻の加算より前にあたる (→ 01 §4.1)。ゲーム時刻は ServerLevel#tick の先頭 (isHandlingTick が真の区間の中) で進むので、入力の時点のゲーム時刻は直前の BlockEntity 相と同じである。その tick に進んだ B は「lastTicked = 今」を満たし、種別 2 になる。その tick に着地した B はもう moving_piston でないので種別 1 になる。[26.3 読解] MinecraftServer#processPacketsAndTick・ServerLevel#tickTime (位相の全体は → 01)
- 伸長の予約時に解決した押し構造は捨てる。実行時にもう一度解決する。

### 4.3 受付の検証: PistonBaseBlock#triggerEvent の冒頭 [26.3 読解]

ServerLevel#doBlockEvent は「その座標の今のブロックが、積んだときと同じブロック種か」だけを見る。種が同じなら triggerEvent を呼ぶ。triggerEvent は次を行う。

1. **今の blockstate から** facing を読む (引数の向きではない)。
2. getNeighborSignal で信号を見直す。
3. 信号あり かつ 種別が 1 か 2: フラグ 2 で extended=true を書き (普通は同じ状態なので何も起きない)、偽を返す。収縮の取り消し。
4. 信号なし かつ 種別が 0: 偽を返す。伸長の取り消し。
5. それ以外は種別ごとの処理へ進む (§4.4・§4.5)。

検証しないもの:

| 検証しないこと | 帰結 |
|---|---|
| extended の値 | 種別 0 が伸長済みに届くと moveBlocks が A のヘッドで失敗し、何も起きない。種別 1・2 が未伸長に届くと、**収縮の処理がそのまま走る** (§5.3) |
| 引数の向きと今の facing の一致 | 向きは今の状態から取る。引数は「収縮後に戻す本体の向き」にだけ使う (§5.3) |
| sticky かどうか | ブロック種の照合は piston と sticky_piston を区別する |

偽を返したイベントはクライアントへ送られない。真を返すと半径 64 のプレイヤーへ送られる (→ 03)。

### 4.4 伸長: 種別 0 [26.3 読解]

1. moveBlocks を「伸長」で呼ぶ (§4.8)。失敗 (押し構造が解決できない) なら偽を返して終わる。本体は extended=false のまま。
2. 本体を extended=true に、フラグ 67 で書く。ここで P から近隣更新 (西・東・下・上・北・南) と形状更新が出る。
3. 音を鳴らし、GameEvent の block_activate を出す (→ 10)。
4. 真を返す。

**本体の書き換えは moveBlocks の後**。moveBlocks の中の更新で再判定される周りのブロックからは、本体はまだ extended=false に見える。moveBlocks の中の近隣更新は P にも届くが、そのときの checkIfExtend は A が moving_piston なので解決に失敗し、何も積まない。

### 4.5 収縮: 種別 1・2 [26.3 読解]

1. A の BlockEntity が PistonMovingBlockEntity なら、finalTick を呼ぶ (§4.10)。伸長中の腕は isSourcePiston が真なので、**A は空気になる** (フラグ 3。近隣更新と形状更新が出る)。
2. P を moving_piston (facing = d、type = 粘着なら sticky) に、フラグ 276 で書く。更新は何も出ない。
3. P に BlockEntity を置く。中身 = この種のピストンの既定状態で **facing = 引数の下位 3 ビットの向き**、direction = d、extending = 偽、isSourcePiston = 真。
4. P から近隣更新を配る (発信元ブロック = moving_piston)。
5. P の 6 隣へ形状更新を配る (フラグ 2)。A のヘッドは「base が同じ向きの moving_piston」なので生き残る (§4.12)。
6. 粘着でない場合: A を removeBlock で消す (フラグ 3)。手順 1 で既に空気なら何も起きない。
7. 粘着の場合:
   1. B の状態を読む。B が moving_piston で、その BlockEntity の direction が d と同じ、かつ extending が真なら、その BlockEntity の finalTick を呼ぶ。B のブロックは**その場で着地**する。引かない。A にも触らない。
   2. そうでなく、次のどれかなら、A を removeBlock で消すだけ (引かない)。
      - 種別が 1 でない (= 2)
      - B が空気
      - B が「d の逆へ動かす・壊すのは不可・接続の向き = d」で押せない (§4.6)
      - B の押し反応が PUSH_PULL でなく、かつ B がピストンでも粘着ピストンでもない
   3. どれでもなければ moveBlocks を「収縮」で呼ぶ (§4.8)。戻り値は見ない。
8. 音を鳴らし、GameEvent の block_deactivate を出す。真を返す。

短いパルスでブロックを置いていく仕組み (粘着):

| パルス | 収縮イベントの実行 | B の状態 | 結果 |
|---|---|---|---|
| T に伸長、T+1 か T+2 のブロックイベント相で収縮 | 腕も B もまだ moving_piston | 伸長中 | 手順 1 で腕が空気に、手順 7.1 で B がその場に着地。**引かない** [実機 1.21.1: sticky-observer-pulse] |
| T に伸長、T+3 以降に収縮 | B は T+2 に着地済み | 普通のブロック | 手順 7.3 で引く [実機 1.21.1: sticky-pull] |
| 同じ tick のブロックイベント相の中で伸長 → 収縮 (0 tick) | progress 0 の moving_piston | 伸長中 | B がその tick のうちに 1 マス先で確定する。[26.3 読解] [要実機] |

手順 1 の副作用: 腕を空気にする書き込み (フラグ 3) の近隣更新は P にも届く。P はまだ extended=true のピストンで信号も無いので、checkIfExtend が**収縮イベントをもう 1 件積む** (実行中のイベントはキューから取り出し済みなので、重複排除に掛からない)。この追加の 1 件は、同じブロックイベント相の後ろで取り出されるが、そのとき P は moving_piston なのでブロック種の照合で捨てられる。効果は無いが、キューの件数と順には現れる。[26.3 読解 からの導出]

粘着でないピストンの短いパルス: 手順 1 で腕が空気になり、押されたブロックは自分の BlockEntity で普通に T+2 に着地する。[実機 1.21.1: observer-piston-pulse]

### 4.6 押せるかの判定: PistonBaseBlock#isPushable [26.3 読解]

引数は「対象の状態・座標・動かす向き・壊れるものを許すか・接続の向き」。次の順に判定する。

1. Y が世界の下限より下・上限より上・ワールドボーダーの外 → 不可。
2. 空気 → 可。
3. 下へ動かすのに Y が下限 → 不可。上へ動かすのに Y が上限 → 不可。
4. 対象が piston / sticky_piston の場合: extended=true → 不可。false は手順 6 へ。
5. それ以外の場合:
   1. 硬さが -1 → 不可 (岩盤・moving_piston など)。
   2. 押し反応が IMMOVEABLE → 不可。
   3. POPPED → 「壊れるものを許すか」をそのまま返す (BlockEntity の有無は見ない)。
   4. PUSH → 「動かす向き = 接続の向き」のときだけ可 (BlockEntity の有無は見ない)。
   5. PUSH_PULL は手順 6 へ。
6. BlockEntity を持たなければ可、持てば不可。

| 押し反応 | 押す (列の前方) | 粘着ブロックの横・後ろから連れていく | 粘着ピストンが引く | 26.3 での主なブロック |
|---|---|---|---|---|
| PUSH_PULL (既定) | 可 (BlockEntity 持ちは不可) | 可 | 可 | 石・レッドストーンブロック・オブザーバー・レール・ランプ・音符ブロック・スライム・ハチミツ ほか |
| PUSH | 可 | 不可 (無視) | 不可 | 彩釉テラコッタ |
| POPPED | 壊す | 不可 (無視) | 不可 | ダスト・トーチ・リピーター・コンパレーター・レバー・ボタン・感圧板・扉・水・溶岩 ほか |
| IMMOVEABLE | 不可 | 不可 (無視) | 不可 | 黒曜石・泣く黒曜石・リスポーンアンカー・強化された深層岩・ロードストーン・金床・砥石・バリア・ポータル類・piston_head・moving_piston |
| IGNORE_ENTITY | — | — | — | ブロックには使わない (エンティティ用。→ 17) |

全ブロックの表は → 05。[実機 1.21.1: piston-push-obsidian・piston-push-glazed・slime-beside-glazed・slime-beside-obsidian・destroy-push-dust・destroy-push-torch]

### 4.7 押し構造の解決: PistonStructureResolver [26.3 読解]

#### 4.7.1 入力と結果

| 項目 | 伸長 | 収縮 |
|---|---|---|
| 動かす向き (pushDirection) | d | d の逆 |
| 起点 (startPos) | A | B |
| 結果 | toPush (動かす座標の列。順序あり)・toDestroy (壊す座標の列)・成否 | 同じ |

#### 4.7.2 resolve

1. 2 つの列を空にする。起点の状態を読む。
2. 起点が「動かす向き・壊すのは不可・接続の向き = **d**」で押せない場合:
   - 伸長で、起点の押し反応が POPPED → toDestroy に起点だけを入れて成功。
   - それ以外 → 失敗。
3. 押せる場合 (空気も含む): 起点から addBlockLine を「向き = 動かす向き」で呼ぶ。偽なら失敗。
4. toPush を添字 0 から順に見る (途中で伸びた分も見る)。その座標がスライムかハチミツなら addBranchingBlocks を呼ぶ。偽なら失敗。
5. 成功。

収縮では接続の向きが d、動かす向きが d の逆なので、起点が PUSH (彩釉テラコッタ) だと手順 2 で失敗する。

#### 4.7.3 addBlockLine (起点 start・たどってきた向き)

1. start が空気 → 真 (何も足さない)。
2. start が「動かす向き・壊すのは不可・接続の向き = たどってきた向き」で押せない → 真 (**障害物にはならない。無視するだけ**)。
3. start が P → 真。
4. start が既に toPush にある → 真。
5. 個数 = 1。個数 + toPush の長さ が 12 を超える → 偽。
6. 後ろへの連なり: 「いま見ているブロック」(最初は start) がスライムかハチミツである間、繰り返す。
   1. 次の座標 = start から動かす向きの逆へ 個数 マス。
   2. そこが空気 / 直前のブロックとくっつかない / 「動かす向き・壊すのは不可・接続の向き = 動かす向きの逆」で押せない / P である、のどれかなら抜ける。
   3. 個数を 1 増やす。個数 + toPush の長さ が 12 を超える → 偽。「いま見ているブロック」をそのブロックに替える。
7. toPush に、後ろの端から start へ向かう順で 個数 個を足す (start が最後)。「今回足した数」= 個数。
8. 前への連なり: i = 1 から、座標 = start から動かす向きへ i マス。
   1. その座標が toPush に既にある (位置 c) → 並べ替え (§4.7.4) をし、toPush の 0 番から c + 今回足した数 番までについて、スライムかハチミツなら addBranchingBlocks を呼ぶ (偽なら偽)。真を返す。
   2. 空気 → 真。
   3. 「動かす向き・壊すのを**許す**・接続の向き = 動かす向き」で押せない、または P である → **偽 (全体が失敗)**。
   4. 押し反応が POPPED → toDestroy に足して真。
   5. toPush の長さが 12 以上 → 偽。
   6. toPush に足す。今回足した数を 1 増やす。i を 1 増やして続ける。

要点:

- 上限 12 は toPush だけを数える。toDestroy は数えない。12 個は押せ、13 個目で失敗する。[実機 1.21.1: piston-limit-12]
- 「押せないブロック」の扱いは場所で違う。列の前方にあれば全体が失敗 (手順 8.3)。横や後ろからの入口にあれば無視 (手順 2・6.2)。
- 後ろへの連なりは、**前のブロックが粘着ブロックのときだけ**次へ進む。石は後ろのブロックを連れていかない。
- 伸長の時点で本体はまだ extended=false なので、本体は押し反応の上では押せてしまう。P との一致を 3 箇所 (手順 3・6.2・8.3) で別に調べているのはそのためである。

#### 4.7.4 reorderListAtCollision (今回足した数 n・衝突位置 c)

toPush を 3 つに分け、並べ直す。

| 部分 | 範囲 | 並べ直し後の位置 |
|---|---|---|
| 頭 | 0 〜 c-1 | 先頭 |
| 今回の列 | 末尾の n 個 | 2 番目 |
| 衝突から今回の列の手前まで | c 〜 末尾-n-1 | 最後 |

意味: 今回の列の前方に、既に登録済みのブロックがあった。前方のものほど列の後ろに来るよう、今回の列を衝突位置の手前に差し込む。

#### 4.7.5 addBranchingBlocks (粘着ブロックの座標)

1. その座標の状態を読む。
2. Direction の定義順 (下・上・北・南・西・東) のうち、動かす向きと**軸が違う** 4 方向について:
   1. 隣の状態を読む。隣とこのブロックがくっつくなら、隣から addBlockLine を「向き = その方向」で呼ぶ。偽なら偽。
3. 真。

| 動かす軸 | 枝を見る順 |
|---|---|
| X (東西) | 下・上・北・南 |
| Y (上下) | 北・南・西・東 |
| Z (南北) | 下・上・西・東 |

探索は深さ優先である。枝で呼んだ addBlockLine が衝突を起こすと、その中でさらに枝をたどる。resolve の手順 4 の走査と合わせて、同じ粘着ブロックの枝を 2 回以上調べることがあるが、addBlockLine の手順 4 が重複を弾く。

#### 4.7.6 くっつく規則: canStickToEachOther

| 組 | くっつくか |
|---|---|
| スライム と ハチミツ (どちらの順でも) | くっつかない |
| 少なくとも片方がスライムかハチミツ (上の組を除く) | くっつく |
| どちらも粘着ブロックでない | くっつかない |

空気や押せないブロックも「くっつく」と判定されるが、その先の addBlockLine の手順 1・2 で落ちる。SlimeBlock と HoneyBlock 自身はピストン用のフックを持たない。

#### 4.7.7 例 (東へ押す)

P = (0,0,0) 東向き。スライム (1,0,0)、その上に石 (1,1,0)、スライムの東に石 (2,0,0)。

1. addBlockLine((1,0,0)): スライムなので後ろ (0,0,0) を見るが P なので抜ける。toPush = [(1,0,0)]。前へ: (2,0,0) の石を足す。(3,0,0) は空気。toPush = [(1,0,0), (2,0,0)]。
2. resolve の走査 0 番 (スライム): 枝は下・上・北・南。上の (1,1,0) の石から addBlockLine。toPush = [(1,0,0), (2,0,0), (1,1,0)]。
3. moveBlocks は末尾から処理する: (1,1,0)→(2,1,0)、(2,0,0)→(3,0,0)、(1,0,0)→(2,0,0)、最後に腕を (1,0,0) へ。
4. 空くセルは (1,1,0) だけ。

### 4.8 動かす: PistonBaseBlock#moveBlocks [26.3 読解]

引数は「P・d・伸長か」。手順を順に全部書く。

1. **(収縮のみ) ヘッドを消す**: A が piston_head なら、空気にフラグ 276 で書く。更新もフックも出ない。
2. **押し構造を解決する** (§4.7)。失敗なら偽を返す。**手順 1 で消したヘッドは戻らない** (§5.5)。
3. **元の状態を控える**: toPush の各座標の状態を、(a) 列 (toPush と同じ順)、(b) 座標 → 状態 の HashMap (以下「空くセルの表」)、の 2 つに入れる。
4. **壊す**: toDestroy を**末尾から先頭へ**。各座標で:
   1. 状態と BlockEntity を読み、ドロップを出す (→ 17)。
   2. 空気にフラグ 18 で書く。近隣更新・形状更新・除去フックは出ない。BlockEntity の除去時の副作用 (中身をこぼすなど) は走る。
   3. GameEvent の block_destroy を出す。
   4. その状態を「更新用の配列」に入れる。
5. **moving_piston を置く**: toPush を**末尾から先頭へ**。各座標 q で:
   1. q の**今の**状態を読む (更新用の配列に入れるため)。
   2. 行き先 = q から動かす向きへ 1 マス。「空くセルの表」から行き先を除く。
   3. 行き先を moving_piston (facing = d、type = normal) に、フラグ 324 で書く。このとき行き先の旧ブロックの除去フックが movedByPiston=true で走り、行き先の 6 隣へ形状更新が出る (§3.5)。
   4. 行き先に BlockEntity を置く。中身 = 手順 3 で控えた元の状態、direction = d、extending = 伸長か、isSourcePiston = 偽。
   5. 手順 5.1 の状態を「更新用の配列」に入れる。
6. **(伸長のみ) 腕を置く**: 「空くセルの表」から A を除く。A を moving_piston (facing = d、type = 粘着なら sticky) にフラグ 324 で書く。BlockEntity の中身 = piston_head (facing = d、type 同じ、short = false)、extending = 真、isSourcePiston = 真。
7. **空くセルを空気にする**: 「空くセルの表」に残った座標を、**HashMap の反復順** (§4.8.1) で、空気にフラグ 82 で書く。旧ブロックの除去フックが movedByPiston=true で走る。近隣更新と形状更新は出ない。
8. **空くセルから形状更新を配る**: 同じ反復順で、各座標について (フラグ 2):
   1. 元の状態の間接形状更新 (ダストだけが実装を持つ。→ 06)
   2. 空気としての 6 隣への形状更新 (西・東・北・南・下・上)
   3. 空気としての間接形状更新 (何もしない)
9. **向きの情報を作る**: ExperimentalRedstoneUtils#initialOrientation に動かす向きを渡す。実験機能が無効なら無し (→ 04)。
10. **壊したセルの後始末**: toDestroy を末尾から先頭へ。各座標で:
    1. 控えた状態の除去フックを movedByPiston=false で呼ぶ (サーバのみ)。
    2. 控えた状態の間接形状更新 (フラグ 2)。
    3. その座標から近隣更新 (発信元 = 壊したブロック)。
11. **動かしたセルから近隣更新**: toPush を末尾から先頭へ。各座標 (**出発セル**) から近隣更新を配る (発信元 = 手順 5.1 で読んだ状態のブロック)。
12. **(伸長のみ)** A から近隣更新を配る (発信元 = piston_head)。押すものが無くても必ず出る。
13. 真を返す。

置く順・更新の順のまとめ (伸長):

| 順 | 何を | どこから | 種類 |
|---|---|---|---|
| 1 | 壊すセル → 空気 | — | 更新なし |
| 2 | 押し先 ← moving_piston (遠い方から) | 各行き先 | 形状更新 (置くたびに) |
| 3 | 腕 ← moving_piston | A | 形状更新 |
| 4 | 空くセル → 空気 | — | 除去フックのみ |
| 5 | 空くセルの形状更新 | 各空くセル (HashMap 順) | 形状更新 |
| 6 | 壊したセルの除去フック・近隣更新 | 各壊したセル | 近隣更新 |
| 7 | 出発セルの近隣更新 (列の末尾から) | 各出発セル | 近隣更新 |
| 8 | A の近隣更新 | A | 近隣更新 |
| 9 | (triggerEvent に戻って) 本体 extended=true | P | 近隣更新 → 形状更新 |

読み取れる事実:

- **出発セルからの近隣更新は、動かした tick に出る**。[実機 1.21.1: piston-transit-nc]
- **行き先だけのセル (列の先端の空いていたセル) からは、動かす時点では近隣更新が出ない**。形状更新だけが出る。近隣更新は着地のときに出る。[26.3 読解] [要実機] 行き先だけに隣接する受け手での確認
- 行き先に moving_piston を置くたびに形状更新が出る。まだ動かしていない後続のブロック (出発セルに居る) も、その形状更新を受ける。前を向いたオブザーバーは、ここで自分の出発セルに tick を予約する (→ 08)。
- この形状更新で隣のブロックが形を変えると、その書き込みはフラグ 324 で行われる (近隣更新なし・movedByPiston 扱い)。生存できなくなった隣 (壁のトーチなど) は destroyBlock で壊れ、そちらはフラグ 3 になる。[26.3 読解] Block#updateOrDestroy [要実機] 形状更新で形を変えたダストから近隣更新が出ないこと
- 直線の伸長では、どの出発セルも次のブロックの行き先か腕になる。空くセルが出るのは粘着ブロックの枝と、収縮の後端だけである。
- triggerEvent はブロックイベント相の最上位から呼ばれるので、moveBlocks の中の各更新は、その呼び出しの中で連鎖が尽きるまで処理されてから次の手順へ進む (→ 04)。
- 手順 5.1 で読むのは今の状態である。並べ替えの結果、先に別のブロックの行き先になっていたセルは moving_piston と読まれる。近隣更新の発信元ブロックにしか使わないので、影響は発信元を見る受け手に限られる (→ 04)。

#### 4.8.1 空くセルの反復順

「空くセルの表」は既定の HashMap (バケット 16・負荷率 0.75) である。キーは最大 12 個なので拡張は起きない (13 個目で起きる)。

1. 座標のハッシュ h = (y + z × 31) × 31 + x (32 ビットの折り返し)。[26.3 読解] Vec3i#hashCode
2. バケット番号 = (h と、h を符号なしで 16 ビット右へずらした値、の排他的論理和) の下位 4 ビット。
3. 反復はバケット番号の小さい順。同じバケットの中は**入れた順** (= toPush の順)。途中で除いても残りの相対順は変わらない。
4. 手順 7 と 8 は同じ順で回る。

1 つのバケットに 9 個目が入ると表が 32 に広がるが、12 個以下の押し構造では起きないとみてよい (→ 18)。h が小さい正の数なら、バケット番号は (x - y + z) を 16 で割った余りに等しい。

### 4.9 進行と着地: PistonMovingBlockEntity#tick [26.3 読解]

BlockEntity 相で、登録順に呼ばれる (→ 01)。サーバ側の手順:

1. lastTicked に今のゲーム時刻を入れる。progressO に progress を写す。
2. progressO が 1.0 未満なら「進む」:
   1. 新しい進み = progress + 0.5。
   2. 当たったエンティティを押す → くっついたエンティティを運ぶ (§4.11)。
   3. progress = 新しい進み (1.0 を上限に切る)。
3. progressO が 1.0 以上なら「着地」:
   1. BlockEntity を外し、無効にする。
   2. その座標が moving_piston でなければ、ここで終わる。
   3. 中身の状態を、6 隣 (西・東・北・南・下・上) の今の状態で形状更新にかける (Block#updateFromNeighbourShapes)。このとき隣がまだ moving_piston なら、それを隣として扱う。予約 tick を要求するブロック (オブザーバーなど) は本当に予約する。
   4. 結果が空気でない場合: waterlogged=true なら false に直す。フラグ 67 で書く。続けて、**自分の座標へ**近隣更新を 1 回送る (発信元 = 置いたブロック)。
   5. 結果が空気の場合 (その場で生存できない): 中身の状態をフラグ 340 で置き、すぐ Block#updateOrDestroy をフラグ 3 で呼ぶ。ドロップ付きで壊れ、空気がフラグ 3 で書かれる。

| tick | 相 | progressO | progress | 状態 |
|---|---|---|---|---|
| T | ブロックイベント相で生成 | 0 | 0 | moving_piston |
| T | BlockEntity 相 | 0 | 0.5 | moving_piston |
| T+1 | BlockEntity 相 | 0.5 | 1.0 | moving_piston |
| T+2 | BlockEntity 相 | 1.0 | 1.0 | 着地 |

着地のフラグ 67 の書き込みで起きること (順に):

1. 置かれたブロックの onPlace が movedByPiston=true で走る (ピストンなら checkIfExtend。そのほかは各メモ)。
2. 着地セルから近隣更新 (発信元 = moving_piston)。西・東・下・上・北・南。
3. 置かれたブロックがコンパレーター用の出力を持つなら、コンパレーター更新 (→ 04・14)。
4. 形状更新 (フラグ 66)。
5. 自分の座標への近隣更新 1 回。

着地の順:

- 同じ tick に着地する BlockEntity は、作られた順に着地する。1 本のピストンの中では、伸長は「toPush の末尾から先頭 → 腕」、収縮は「本体 → toPush の末尾から先頭」。ピストン同士はブロックイベントの実行順。[26.3 読解] Level#tickBlockEntities・LevelChunk#updateBlockEntityTicker
- 収縮では本体が先に着地する。そのとき A はまだ moving_piston (引いたブロック) なので、本体の onPlace の checkIfExtend は押し構造の解決に失敗する。直後に A が着地し、その近隣更新で本体がもう一度調べる。
- ホッパーなど他の BlockEntity との前後は → 01。

腕の着地: 中身は piston_head。着地の最後の「自分への近隣更新」は PistonHeadBlock#neighborChanged が本体へ回すので、本体の checkIfExtend が T+2 の BlockEntity 相で 1 回走る。

本体の着地 (収縮): 中身は piston (extended=false、facing = イベントの引数の向き)。onPlace で信号があれば種別 0 を積む。実行は次の tick。**収縮の実行から再伸長の実行まで最短 3 tick**。[26.3 読解]

### 4.10 早い確定: PistonMovingBlockEntity#finalTick [26.3 読解]

呼ばれる契機:

| 契機 | 呼ぶ側 |
|---|---|
| 収縮イベントで A に BlockEntity がある | PistonBaseBlock#triggerEvent (§4.5 手順 1) |
| 粘着の収縮イベントで B が同じ向きで伸長中 | PistonBaseBlock#triggerEvent (§4.5 手順 7.1) |
| moving_piston が、フラグ 256 の無い書き込みで別のブロックに置き換えられた | PistonMovingBlockEntity#preRemoveSideEffects (LevelChunk#setBlockState から)。**この時点でセルは既に新しいブロック**なので、下の手順 2 で終わる。BlockEntity が外れるだけで、中身のブロックはどこにも置かれず消える |

手順 (サーバ側は progressO が 1.0 未満のときだけ):

1. progress と progressO を 1.0 にする。BlockEntity を外し、無効にする。
2. その座標が moving_piston でなければ終わる。
3. 置く状態を決める。isSourcePiston が真なら**空気**。偽なら中身を 6 隣で形状更新にかけた結果。
4. フラグ 3 で書く。
5. 自分の座標へ近隣更新を 1 回送る。

通常の着地との違い:

| 点 | tick の着地 | finalTick |
|---|---|---|
| 腕・本体 (isSourcePiston) | 中身 (piston_head / piston) を置く | **空気を置く** |
| フラグ | 67 (movedByPiston=true) | 3 (movedByPiston=false) |
| waterlogged | false に直す | **直さない** |
| 生存できないとき | 置いてから壊す (ドロップあり) | 空気を書くだけ (ドロップなし) |
| 相 | BlockEntity 相 | 呼んだ側の相 (普通はブロックイベント相) |

- 伸長中の腕を finalTick すると A は空気になる。収縮の途中なので辻褄は合う。
- 収縮中の本体 (isSourcePiston が真) を finalTick すると、**本体が空気になって消える**。収縮中の本体を、別のピストンの収縮イベントの「A の BlockEntity」として踏む配置で起こりうる。[26.3 読解] [要実機]
- コマンドや爆発で moving_piston を置き換えた場合は別の経路である (上の表の 3 行目)。セルは置き換えた側のブロックになり、中身は isSourcePiston の真偽に関係なく失われる。moving_piston は硬さ -1 だが爆発耐性も 0 として登録されるので、爆発で消える (Blocks の登録は硬さだけを指定し、耐性は同じ値を下限 0 で受ける)。[26.3 読解] LevelChunk#setBlockState・BlockBehaviour.Properties#strength
- onPlace が movedByPiston=false で走るので、movedByPiston を見るブロック (レール・ダイオード類など) は、0 tick で確定したときと普通に着地したときで動きが違いうる。[要実機]

### 4.11 エンティティを押す (要点のみ。細部は → 17) [26.3 読解]

| 処理 | 対象 | 動かす量 |
|---|---|---|
| PistonMovingBlockEntity#moveCollidedEntities | 動く当たり判定に重なるエンティティ (押し反応が IGNORE_ENTITY のものを除く) | 重なりの深さ (その tick の移動量 0.5 が上限) + 0.01 |
| 同上 (中身がスライムブロック) | 動きをシミュレートできるエンティティ | 動く軸の速度を、動く向きの ±1.0 に置き換える |
| PistonMovingBlockEntity#moveStuckEntities | 中身がハチミツブロックで、水平に動くとき。上に乗って接地している PUSH_PULL のエンティティ | その tick の移動量 0.5 |
| fixEntityWithinPistonBase | 収縮中の本体にめり込んだエンティティ | 本体の外へ押し戻す |

当たり判定の形: 収縮中の本体は「伸びた本体の形 + ずれたヘッド」。腕は progress に応じて短い形と長い形を切り替える (しきい値 0.25)。

### 4.12 ヘッドの生存確認と撤去: PistonHeadBlock [26.3 読解]

| メソッド | 契機 | 動き |
|---|---|---|
| isFittingBase | — | 相手が、type に合う種 (normal → piston、sticky → sticky_piston) で、extended=true、facing が同じ、なら真 |
| canSurvive | — | facing の逆隣が isFittingBase を満たす、または、同じ facing の moving_piston なら真 |
| updateShape | 形状更新 | **本体側の隣からの更新で**、かつ canSurvive が偽 → 空気になる。それ以外は変わらない |
| neighborChanged | 近隣更新 | canSurvive が真なら、本体の座標へ近隣更新を回す (発信元ブロックはそのまま)。偽なら**何もしない** (自分を壊さない) |
| affectNeighborsAfterRemoval | ヘッドがフラグ 1 か 64 付きで別ブロックに置き換えられた | 本体が isFittingBase を満たすなら、本体をドロップ付きで壊す |
| playerWillDestroy | ドロップを出さないプレイヤー (クリエイティブ) が壊す | 本体が合うなら、本体をドロップなしで壊す |

- 本体を壊す・置き換える → 本体のセルから形状更新 → ヘッドの updateShape → 空気。本体の書き込みがフラグ 16 付きだと形状更新が出ず、ヘッドだけが残る。
- ヘッドへの近隣更新は本体へ回る。ヘッドの横で信号が変わると、本体が再判定する (QC とは別の経路)。
- PistonBaseBlock には除去フックが無い。本体側からヘッドを消す経路は形状更新だけである。
- MovingPistonBlock#destroy (プレイヤーが moving_piston を壊したとき): facing の逆隣が extended=true のピストンなら、それを removeBlock で消す。

### 4.13 moving_piston: MovingPistonBlock [26.3 読解]

| 点 | 内容 |
|---|---|
| BlockEntity の生成 | newBlockEntity は何も返さない。BlockEntity は PistonBaseBlock が自分で作って置く。コマンドで置いた moving_piston は BlockEntity を持たない |
| ticker | サーバ・クライアントとも PistonMovingBlockEntity#tick |
| 近隣更新・形状更新 | フックなし。何も反応しない |
| 当たり判定 | BlockEntity があればその形、無ければ空 |
| 素手で使う | BlockEntity が無い moving_piston は、使うと消える (removeBlock) |
| ドロップ | BlockEntity があれば中身のブロックのドロップ |
| 押し反応 | IMMOVEABLE・硬さ -1。動いている最中のブロックは他のピストンから押せない・引けない・壊せない |

BlockEntity の ticker は、その座標のブロックが BlockEntity の型に合わなくなると動かない (→ 01)。

### 4.14 クライアントとの関係

サーバの論理はここまでで完結する。クライアントは同じブロックイベントを受けて triggerEvent を自分でも実行する (信号の見直しは省く)。フラグ 4 の書き込みはクライアントへ個別に送らない。Rust 実装では見た目の補間に progress と progressO を使うだけでよい。

---

## 5. 端の場合と落とし穴

### 5.1 よくある誤解

| 誤解 | 実際 |
|---|---|
| ピストンは信号が変わると動く | 近隣更新を受けたときだけ調べる。形状更新では調べない |
| facing 側からの信号でも伸びる | A の位置は調べない。ただし QC の 5 箇所は facing に関係なく調べる |
| 伸長は 2 tick で終わる | 実行した tick を含めて BlockEntity が 3 回 tick する。着地は T+2 の BlockEntity 相 |
| BlockEntity 持ちは押せない | 押し反応が POPPED のもの (コンパレーター・シュルカーボックス・ベル・頭・飾り壺など) は BlockEntity を見る前に「壊す」と決まる |
| 押せないブロックがあれば失敗する | 列の前方にあるときだけ。粘着ブロックの横・後ろにあるなら無視される |
| 粘着ピストンは 1 個しか引けない | 引くのも押し構造の解決を通る。スライムの塊ごと 12 個まで引く [実機 1.21.1: slime-pull-sticky] |
| 動かす時点で行き先の周りに近隣更新が出る | 出ない。形状更新だけ。近隣更新は出発セルから出る |
| 種別 2 が「置いていく」を決める | 実際に決めるのは実行時の B の状態 (§4.5 手順 7.1)。種別 2 は「B が動いていなくても引かない」を足すだけ |

### 5.2 一見同じで違う経路

| 場面 | 経路 A | 経路 B |
|---|---|---|
| ヘッドが消える | 収縮: removeBlock (フラグ 3。更新あり) | 引く収縮: フラグ 276 (更新なし)。その後 A に moving_piston が入れば形状更新だけ出る |
| ブロックが確定する | tick の着地 (フラグ 67・BlockEntity 相) | finalTick (フラグ 3・呼んだ相) |
| 壊れる | 押し構造で壊す (フラグ 18 → 後で除去フックと近隣更新) | 着地で生存できない (フラグ 340 → destroyBlock) / 形状更新で生存できない (destroyBlock) |
| 空気になる | 空くセル (フラグ 82 → 後で形状更新のみ。近隣更新は出発セルとして出る) | 壊したセル (近隣更新のみ。形状更新は、そこへ入る moving_piston から出る) |

### 5.3 向きの違うピストンへのイベント (岩盤を壊す技の根)

triggerEvent は向きを今の状態から取り、extended も調べない (§4.3)。したがって:

1. 伸びたピストン X (向き d1) に収縮イベントが積まれる。
2. 実行までの間に、同じ座標のブロックが、同じ種で向き d2 のピストン (extended=false) に替わる。
3. doBlockEvent の照合はブロック種だけなので通る。信号が無ければ収縮の処理が走る。
4. P+d2 のセルに removeBlock が掛かる (粘着でない場合。粘着でも引けない相手なら同じ)。**removeBlock は相手の硬さも押し反応も見ない**。岩盤でも BlockEntity 持ちでも消える。
5. 本体は moving_piston になり、着地すると「引数の向き = d1」のピストンに戻る。

補足:

- 手順 4 の removeBlock は「そのセルの流体のブロック」をフラグ 3 で書く。相手が waterlogged なら水が残り、そうでなければ空気になる。[26.3 読解] Level#removeBlock
- 手順 3 で**信号がある**場合は、収縮の取り消し (§4.3 手順 3) に入る。入れ替わったピストンは extended=false なので、フラグ 2 の書き込みで **extended=true に変わる**。ヘッドは作られない。近隣更新は出ず、形状更新 (フラグ 2) だけが出る。これもヘッドレスを作る経路である。[26.3 読解 からの導出] [要実機] P7 の変形で確認

extended=true でヘッドの無いピストン (ヘッドレス) に収縮イベントが届いても同じことが起きる。A にあるブロックが removeBlock で消える。粘着で B が引ける場合は moveBlocks に入り、A のブロックが「P へ押し込まれる」形になって解決が失敗するので、A は消えない (A が POPPED なら壊れる)。[26.3 読解] [要実機]

### 5.4 ヘッドレスが生まれる条件

本体が extended=true のまま、A のヘッドが「フラグ 1 も 64 も無い書き込み」で消えると、PistonHeadBlock#affectNeighborsAfterRemoval が呼ばれず、本体が残る。ヘッドからの形状更新が出ても、本体は updateShape を持たないので変わらない。26.3 のピストンのコードの中では §5.5 の経路がこれに当たる。もう 1 つ、ヘッドを消すのでなく「未伸長の本体が、収縮の取り消しで extended=true に書かれる」経路がある (§5.3 の補足)。[26.3 読解] [版差 1.21.1] 1.21.1 は除去フックがフラグに関係なく走る (§6)

### 5.5 引く収縮の失敗

§4.5 手順 7.3 で moveBlocks に入ると、まずヘッドがフラグ 276 で消える。その後の解決が失敗しても (塊が 13 個以上・塊の進路に不動ブロックがある、など)、ヘッドは消えたまま、**A からは近隣更新も形状更新も出ない**。本体は手順 2〜5 で既に moving_piston になっているので、ピストン自体は普通に縮む。A の隣のダストやオブザーバーは「ヘッドが消えた」ことを知らされない。[26.3 読解] [要実機]

### 5.6 B が別のピストンの塊の一部だったとき

§4.5 手順 7.1 の条件は「B が moving_piston・direction が d と同じ・伸長中」だけである。自分が押したブロックかどうかは見ない。隣の列のピストンがスライムで同じ向きに運んでいるブロックが B を通過中でも、finalTick で B に確定させてしまう。このとき A のヘッドには触らないので、ヘッドは本体が着地する T+2 まで残り、本体の着地の形状更新で消える。[26.3 読解] [要実機]

### 5.7 そのほか

- 水・溶岩は POPPED。押し先にあれば「壊す」扱いで空気になる。押されたブロックの waterlogged は着地で false になる (finalTick では残る)。空くセルは流体でなく空気になる。
- 押されている最中のブロックは moving_piston なので、ダストはつながらず、信号も通らない。着地の形状更新でつながり直す。[実機 1.21.1: dynamic-connect-push]
- 着地したオブザーバーは 1 回発火する (→ 08)。[実機 1.21.1: observer-pushed・observer-pulled]
- 引数の向きは下位 3 ビットを方向の番号として読む。6・7 の扱いは Direction 側の決まり (→ 18)。正規の経路では 0〜5 しか入らない。
- 押し構造の解決は、予約時 (checkIfExtend) と実行時 (moveBlocks) の 2 回。予約時に押せても実行時に押せなければ、伸びずに終わる (本体は extended=false のまま、次の近隣更新を待つ)。
- 伸長イベントの実行時に信号が切れていれば取り消し。予約と実行の間 (同じ tick の中でも) に信号が往復すると、何も起きないことがある。
- 収縮中 (本体が moving_piston) のピストンは、他のピストンから押せない。着地した瞬間から押せる。

---

## 6. 版差

### 6.1 1.21.1 → 26.2 [版差 1.21.1]

| 点 | 1.21.1 | 26.2 以降 | 挙動への効き |
|---|---|---|---|
| 除去フックの仕組み | 旧ブロックの onRemove を、サーバでは**フラグに関係なく**呼ぶ | affectNeighborsAfterRemoval を、フラグ 1 か 64 のときだけ呼ぶ。BlockEntity の副作用は preRemoveSideEffects (フラグ 256 で省ける) | 下の 3 行 |
| 壊すセルの除去フックの時機 | 空気を書く時点 (moveBlocks の手順 4。まだ何も動いていない) | 全部を置き終えた後 (手順 10) | **壊されるトーチ・ダスト・リピーターなどが周りへ出す更新の順が変わる**。destroy-push-dust・destroy-push-torch の最終状態は同じでも、tick 内の順は 26.x で測り直す [要実機] |
| ヘッドが消えたときの本体の破壊 | どのフラグの書き込みでも走る | フラグ 1 か 64 が要る | ヘッドレスの作り方が変わりうる (§5.4) [要実機] |
| moving_piston が置き換えられたときの finalTick | MovingPistonBlock の onRemove が、どのフラグでも呼ぶ | フラグ 256 の無い書き込みだけ | ピストン自身の経路では差が出ない (先に BlockEntity を外すか、相手が BlockEntity を持たない) |
| フラグ値 | 本体の moving_piston 化とヘッド消し 20・moving_piston を置く 68・生存できない着地 84 | 276・324・340 (256 が足された) | 上の仕組みの置き換え。更新の出方は同じ |
| 近隣更新の引数 | 発信元の座標 | Orientation (実験機能が無効なら無し) | 既定の設定では差なし (→ 04) |
| finalTick の書き込み | フラグ 3 の setBlock | 同じ意味の別名の呼び出し | 差なし |
| 本体の当たり判定 | 向きごとの定数 | 回転で作った表 | 差なし |

getNeighborSignal・checkIfExtend・triggerEvent の流れ・PistonStructureResolver・progress の刻みは 1.21.1 と同じである。既存の 1.21.1 fixture のうち、壊すセルを含まないものはそのまま有効とみてよい (→ 19)。

### 6.2 26.2 → 26.3

| 点 | 26.2 | 26.3 | 挙動への効き |
|---|---|---|---|
| PushReaction の名前 | NORMAL・DESTROY・BLOCK・PUSH_ONLY・IGNORE | PUSH_PULL・POPPED・IMMOVEABLE・PUSH・IGNORE_ENTITY | 名前だけ |
| 黒曜石・泣く黒曜石・リスポーンアンカー・強化された深層岩 | isPushable の中でブロックを名指しして不可 | Blocks の登録で IMMOVEABLE | ピストンに関しては同じ。押し反応を読む他の処理には効きうる (→ 05) |
| スライムで弾く対象 | サーバのプレイヤー以外 | 動きをシミュレートできるエンティティ | → 17 |
| POPPED の指定の数 | 209 箇所 | 215 箇所 | 増えた 6 は新しいブロック (poplar_door・poplar_pressure_plate・poplar_sapling・red_shrub・shelf_mushroom・straw_bed) の指定。既存ブロックの押し反応は変わらない。個別は → 05・19 |
| コーデックの定義 | あり | 無し | 差なし |

### 6.3 26.3 → 26.4-pre-1 [版差 26.4-pre-1]

| 点 | 内容 | 挙動への効き |
|---|---|---|
| 列・表の作り方 | 補助ライブラリ経由から標準の ArrayList・HashMap の直接生成へ | 差なし (HashMap の既定値は同じ) |
| waterlogged の読み方 | 「プロパティがあり、かつ真」から「無ければ偽として読む」へ | 差なし |
| PistonHeadBlock・MovingPistonBlock・PistonMath・PushReaction | 差分なし | — |
| IMMOVEABLE・PUSH の指定 | 26.3 と同じ集合 | — |
| POPPED の指定の数 | 202 箇所 (26.3 は 215) | 登録のまとめ方の差である。壁付きの 16 種 (サンゴの壁付きファン 5・壁のトーチ 4・壁の頭 7) が、立ち置きのブロックの性質を丸ごと写す補助関数経由になり、明示の指定が消えた。写しは押し反応も含むので POPPED のまま。別に新しいブロック 3 種 (brittle_ice・ice_crystal・icicle) が POPPED で増えた (215 − 16 + 3 = 202)。既存ブロックの押し反応は変わらない。→ 05・19 |

ピストンの 6 クラスに、26.3 と 26.4-pre-1 の挙動差は無い。

---

## 7. Rust で実装するときの要点

### 7.1 データ構造

| もの | 持ち方 | 理由 |
|---|---|---|
| moving_piston の BlockEntity | 中身の状態・direction・extending・is_source・progress (0/1/2 の整数で足りる)・progress_o・last_ticked | 種別 2 の判定に progress_o と last_ticked が要る。0.5 刻みなので半分単位の整数でよい |
| BlockEntity の tick 順 | 登録順を保つ列。削除は「無効の印 → 次の走査で除く」 | 着地の順 = 登録順 (→ 01) |
| toPush・toDestroy | 順序つきの可変長列。座標の検索は線形でよい (最大 12) | 並べ替えと位置検索が要る |
| 空くセルの表 | Java の HashMap と同じ反復順を出せる専用の小さな構造 (16 バケット・入れた順の鎖) | 手順 7・8 の順が、オブザーバーの予約順などに効く |
| ブロックイベント | 挿入順 + 重複排除 (→ 03) | 種別 1 と 2 は別のキー |

### 7.2 順序を保つために守ること

1. moveBlocks の 13 手順を、この順のまま 1 つの関数にする。「先に全部書いてから、まとめて更新」に直さない。手順 5 の形状更新は、置くたびに出す。
2. 手順 5 で置く moving_piston は、中身を手順 3 の控えから取る (その時点の世界から読まない)。
3. 伸長では本体の extended=true を moveBlocks の後に書く。
4. 収縮では「A の finalTick → 本体の moving_piston 化 → P の近隣更新 → P の形状更新 → ヘッドの処理」の順。
5. 着地は BlockEntity 相。ブロックイベント相や予約 tick 相に寄せない。
6. 着地の書き込みは「onPlace (movedByPiston=true) → 近隣更新 → コンパレーター更新 → 形状更新 → 自分への近隣更新」。
7. finalTick と着地を同じ関数にしない (§4.10 の 5 つの違い)。
8. handling_tick の真偽を世界に持たせ、相の切り替えで更新する。

### 7.3 フックの持たせ方

- setBlock にフラグをそのまま渡せるようにし、チャンク層で「除去フック (1 か 64)・BlockEntity の副作用 (256 なし)・onPlace (512 なし)」を判定する (→ 04)。ピストン専用の近道を作ると、324 の形状更新や 82 の除去フックを落としやすい。
- 除去フックと onPlace には movedByPiston を渡す。これを条件に使うブロックは 26.3 で少なくとも 9 クラスある (感圧板・トーチ・ボタン・ダイオード・トリップワイヤーフック・レバー・レール・ダスト・トリップワイヤー)。押せるのはそのうちレールだけだが、形状更新で形が変わる隣 (ダストなど) の書き込みがフラグ 324 を引き継ぐので、ダストの onPlace にも真が渡りうる。

### 7.4 ほかのメモとの境界

| 境界 | こちら (13) | 相手 |
|---|---|---|
| ブロックイベント | 積む条件・受付・効果 | キューの実装 → 03 |
| 信号 | どの位置を調べるか | hasSignal の中身 → 05 |
| 押し反応 | 判定の順と使い方 | ブロックごとの値 → 05 |
| 更新 | どこから・どのフラグで・どの順に | 配り方と連鎖の処理 → 04 |
| BlockEntity 相 | ピストン同士の着地順 | 他の BlockEntity との順 → 01 |
| エンティティ | 呼ぶ時機と移動量 | 当たり判定と移動の細部 → 17 |

---

## 8. 検証用のプローブ回路案

どれも実機 (26.3) で tick ごとの状態を撮る。順序を見るものは、同じ tick に 2 つの受け手 (ピストンやオブザーバー) を置き、どちらが先に動いたかを後段の状態差で読む。

| # | 目的 | 配置 | 観測と期待の要点 |
|---|---|---|---|
| P1 | 壊すセルの除去フックの時機 (§6.1) | ピストンの A にレッドストーントーチ (床置き)。トーチの隣にダスト、その先に BUD になりうる第 2 のピストン。対照として A に石を置いたもの | 26.3 ではトーチの「消えた」更新が、腕の moving_piston を置いた後に出る。第 2 のピストンのイベントの順と、1.21.1 との差を撮る |
| P2 | 空くセルの反復順 (§4.8.1) | スライムの塊で、枝の石を 2 つ (上と北) 連れていく。それぞれの元位置を別のオブザーバーが見る。2 本のオブザーバーの出力を 1 つのコンパレーター減算へ | オブザーバーの予約順 = HashMap の順。原点をずらした 2 配置 (バケット順が入れ替わる座標) で、先に発火する側が入れ替わること |
| P3 | 枝の方向順と並べ替え (§4.7.4・§4.7.5) | 東へ押す。スライム 2×2 (上と北に枝) と、枝の列が主列の前方に合流する L 字 | 着地の順 (= BlockEntity の登録順) を、着地で給電されるランプ 2 つの点灯順ではなく、着地が起動する 2 本のピストンのイベント順で読む。toPush の順が §4.7 の手順どおりか |
| P4 | 種別 1 と 2 の境 (§4.2) | 粘着ピストン + 石。信号を切る契機を 3 通り: (a) T+2 の予約 tick 相 (リピーター)、(b) T+2 の BlockEntity 相 (別のピストンの着地でレッドストーンブロックを離す)、(c) T+1 の BlockEntity 相 | (a) 石を置いていく。(b) 着地順しだいで種別 1 → 次の tick に引く。(c) 種別 2 → T+2 に置いていく。3 通りの石の最終位置と tick |
| P5 | 引く収縮の失敗でヘッドが無音で消える (§5.5) | 粘着ピストンの B からスライムを 13 個以上つなぐ。A の横にオブザーバー (A を見る) と、A の上にダスト | 収縮でオブザーバーが発火しない・ダストの形が変わらないこと。対照 (12 個) では moving_piston の形状更新で発火する |
| P6 | finalTick と着地の差 (§4.10) | 0 tick で 1 マス送る回路。送るブロックを (a) waterlogged の階段、(b) レール、(c) オブザーバー、にする | (a) 水が残るか。(b) 着地後の形と給電の再計算が普通の着地と違うか。(c) 発火の tick |
| P7 | 向きの違うピストンへのイベント (§5.3) | 伸びたピストンを、収縮イベントが積まれた同じ tick に、コマンドで別の向きの同種ピストンへ置き換える。新しい向きの先に黒曜石 | 黒曜石が消える。2 tick 後に本体が元の向きで戻る |
| P8 | 着地順と本体の再伸長 (§4.9) | 粘着ピストンでレッドストーンブロックを引き、そのブロックが A に来ると本体が給電される配置 | 本体の着地 → A の着地 → 次の tick に伸長イベント。発振の周期が 6 tick (伸長 3 + 収縮 3) になるか |
| P9 | B が別の塊の一部 (§5.6) | 並んだ 2 本の粘着ピストン。片方がスライムで B を横切るブロックを運び、もう片方をその最中に収縮させる | B のブロックがその場で確定し、ヘッドが 2 tick 残ること |
| P10 | 収縮中の本体の finalTick (§4.10) | 収縮中のピストン本体を A に持つ、もう 1 本のヘッドレスのピストンへ収縮イベントを送る (コマンドで組む) | 収縮中の本体が空気になること |
| P11 | 形状更新で形を変えた隣の書き込み (§4.8) | 押されるブロックの横にダスト (ブロックへ向けてつながっている)。ダストの先に BUD ピストン | 動かす時点でダストの形は変わるが、そこからの近隣更新が出ないこと |
| P12 | 保存をまたぐ着地 (§3.3) | 伸長の T の直後に保存して読み直す | 着地が 1 tick 遅れるか |

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §6 piston

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| 起動判定は「facing 面を除く 6 方向」 | facing を除く 5 方向 + QC の 5 箇所 (§4.1) | 言い回しの問題。中身は合っている |
| 「自身 down 面」も調べる | 調べるが、ピストンは信号源でも導体でもないので常に偽 (§4.1 手順 2) | 26.3 の読みが正確。実装では省いてよい |
| block entity は押せない | 押し反応が PUSH_PULL のものに限る。POPPED は BlockEntity 持ちでも壊す (§4.6) | 26.3 の読みが正しい (16 の R-10 と同じ結論) |
| 短パルスの収縮は「head の finalTick で伸長を即完了させてから収縮」 | 腕の finalTick は A を piston_head にせず、**空気**にする (§4.10)。押されたブロックは粘着なら手順 7.1 でその場に確定、非粘着なら自分の BlockEntity で普通に着地 | 最終状態は同じ。途中の書き込みと更新の出方が違う。26.3 の読みが正しい |
| 伸長の表で「moveBlocks が … base を EXTENDED 化」 | 本体の書き換えは moveBlocks の後 (§4.4) | 16 の R-14 と同じ。26.3 の読みが正しい |
| 着地は BlockEntity 相・実行 +2 tick | 同じ (§4.9) | 一致 [実機 1.21.1: piston-basic・rblock-piston-chain] |

### 9.2 docs/research/16_nucleation-comparison.md §2.5 と R-9〜R-14

| 項目 | 26.3 の読み | 判断 |
|---|---|---|
| R-9・R-10 (押し反応の分類) | 判定順は §4.6 のとおり。26.3 では黒曜石の類も登録側の指定になった | 16 の修正方針 (isPushable の順で判定) は 26.3 でも正しい。表は 26.3 の Blocks から作り直す (→ 05) |
| R-11 (何も押さない伸長でも A から近隣更新) | 手順 12。無条件 | 16 が正しい |
| R-12 (空くセルの形状更新) | 手順 7・8。加えて、順は HashMap の反復順 | 16 が正しい。**順の指定が 16 に無い**ので足す |
| R-13 (枝の方向順) | Direction の定義順から押す軸を除いた 4 方向 (§4.7.5) | 16 が正しい |
| R-14 (本体を先に extended にしている) | 本体は最後 (§4.4) | 16 が正しい |
| §2.5「収縮イベントの 2 種を区別しない」 | 区別が効くのは「種別 2 なのに実行時に B が伸長中でない」ときだけ (§5.1) | 実害は狭い。ただし種別はキューの重複排除のキーなので、区別して持つ |
| §2.5「何も引かない粘着ピストンのヘッド: sim は近隣更新と形状更新を出す」 | removeBlock (フラグ 3) なので両方出る (§4.5 手順 7.2) | sim が正しい。「引けたとき」は 16 の記述どおり無音 (フラグ 276) |
| R-20 | ダスト網の中の更新順の話。ピストン側は「checkIfExtend が呼ばれた順にイベントが並ぶ」だけ | → 06・18 |
| R-23 | docs/research に該当の番号が見当たらない (R-1〜R-22 まで) | 突き合わせ不能。番号の出どころを確認する |
| fixture piston-transit-nc の説明文 | 説明文は「音符ブロックは着地するまで消えないはず」と書くが、記録された実機の系列は動かした tick (t3) に powered=false。出発セルからの近隣更新 (手順 11) で説明がつく | 記録された系列と 26.3 の読みが一致。説明文のほうが誤り |

16 に無く、26.3 の読みで新しく分かったこと: 壊すセルの除去フックの時機 (§6.1)・引く収縮の失敗時の無音のヘッド消し (§5.5)・finalTick と着地の 5 つの違い (§4.10)・行き先に置くたびの形状更新とそのフラグ (§4.8)。

### 9.3 docs/research/09_snapshots

| 資料 | 26.3 の読みとの関係 |
|---|---|
| two-piston-locational.md | 「同じ tick に 2 件のイベントを先入れ先出しで実行」「着地は TileEntity 相・+2 tick」は §2.2・§4.9 と一致。西が先か東が先かはダストの更新順の問題 (→ 06・18) |
| network-piston-order.md | 同上。イベントの順 = checkIfExtend の呼ばれた順 |

### 9.4 今の TS 実装 (packages/sim/src/world.ts)

コードは変えない。違いだけを挙げる。

| 箇所 | 今の実装 | 26.3 |
|---|---|---|
| 動かした後の更新 (afterPistonMove) | 全部を書き終えてから、形状更新をまとめて配り、次に近隣更新をまとめて配る | 行き先に置くたびに形状更新。その後に空くセルの形状更新、壊したセル、出発セルの近隣更新、A、本体 (§4.8 の表) |
| 空くセルの順 | 列の順 | HashMap の反復順 (§4.8.1) |
| 収縮で伸長中の腕に当たったとき | 腕を piston_head に確定してから消す | finalTick で直接空気にする (フラグ 3 の更新が 1 回) |
| finalTick 相当 (finalizeMovingPiston の流用) | 通常の着地と同じ関数 | 5 つの違いがある (§4.10) |
| 収縮イベントの種別 | 1 種 | 1 と 2。キューのキーが違う |
| moving_piston の進み | 着地の tick (finalizeDue) だけを持つ | progress・progressO・lastTicked。種別 2 の判定に使う |
| 着地の順 | seq (作った順) | 同じ (BlockEntity の登録順)。ただし他の BlockEntity と同じ列に入る (→ 01) |
| 向きの違うピストンへのイベント | イベントを種類名で持ち、向きは今の状態から取る | 同じ。ただし「収縮後の向き = 引数」は持っていない (§5.3) |
| 未伸長への収縮イベント | extended=false なら何もしない | 収縮の処理が走る (§4.3・§5.3) |
| 引く収縮の失敗 | 引くものが無い扱いで、A から更新を出す | ヘッドは無音で消え、A から何も出ない (§5.5) |
| 引く塊の moving_piston を作る順 | toPush の**先頭から末尾へ** | 末尾から先頭へ (§4.8 手順 5)。着地順 (seq) が塊の中で逆になる |
| 何も押さない伸長の A からの近隣更新 | 近隣更新の起点は「本体・出発セル・壊したセル」。A は入っていない (16 の R-11 が未修正のまま) | 手順 12 で必ず出る |
| 伸長イベントが伸長済みに届いたとき | extended=true なら何もしない | moveBlocks まで進む。A にヘッドがあれば解決に失敗して同じ結果。ヘッドレスなら実際に押す (§4.3) |
| 収縮の取り消しの書き込み | 何も書かない | フラグ 2 で extended=true を書く。未伸長へ届いた場合だけ差が出る (§5.3 の補足) |
| 収縮の手順 1 が積む余分なイベント | 無い | 1 件積まれて、後で捨てられる (§4.5)。キューの順に現れる |
| 着地で生存できないブロック | 扱いなし | 置いてから壊す (§4.9 手順 3.5) |
| 準接続・押し構造の解決・12 個の上限・並べ替え・PUSH の扱い | §4.1・§4.7 と同じ | 一致 [実機 1.21.1: qc-bud・piston-limit-12・slime-push-branch・piston-push-glazed] |
| 予約時に押し構造を解決し、収縮は無条件に積む | 同じ | 一致 |
| 実行時の信号の見直し (伸長・収縮とも) | 同じ | 一致 |
| 収縮で本体の moving_piston を引く塊より先に作る | 同じ | 一致 (§4.9 の着地順) |

---

## 10. 典拠一覧

- 26.3 PistonBaseBlock#setPlacedBy・neighborChanged・onPlace — checkIfExtend を呼ぶ 3 つの契機
- 26.3 PistonBaseBlock#checkIfExtend — 積む条件・種別 1 と 2 の分かれ目・引数
- 26.3 PistonBaseBlock#getNeighborSignal — 調べる位置と順 (5 方向・自分の下向き・上のセルの 5 方向)
- 26.3 PistonBaseBlock#triggerEvent — 信号の見直し・伸長・収縮・粘着の引き・フラグ 2・67・276
- 26.3 PistonBaseBlock#isPushable — 判定の順 (範囲・空気・上下端・ピストン・硬さ・押し反応・BlockEntity)
- 26.3 PistonBaseBlock#moveBlocks — 13 手順・フラグ 18・82・276・324・更新の順
- 26.3 PistonBaseBlock#getShape — 伸長時の本体の形
- 26.3 PistonStructureResolver のコンストラクタ — 動かす向きと起点
- 26.3 PistonStructureResolver#resolve・addBlockLine・reorderListAtCollision・addBranchingBlocks
- 26.3 PistonStructureResolver#isSticky・canStickToEachOther — スライムとハチミツ
- 26.3 PistonStructureResolver の上限の定数 (12)
- 26.3 PistonMovingBlockEntity#tick — 0.5 刻み・着地・フラグ 67・340
- 26.3 PistonMovingBlockEntity#finalTick・preRemoveSideEffects — 早い確定
- 26.3 PistonMovingBlockEntity#getProgress・getLastTicked・isExtending・getDirection・getMovementDirection・getPushDirection
- 26.3 PistonMovingBlockEntity#moveCollidedEntities・moveStuckEntities・moveEntityByPiston・fixEntityWithinPistonBase・getCollisionShape
- 26.3 PistonMovingBlockEntity#loadAdditional・saveAdditional・setLevel — 保存キーと progressO の保存
- 26.3 MovingPistonBlock#newBlockEntity・newMovingBlockEntity・getTicker・destroy・useWithoutItem・getCollisionShape・getDrops
- 26.3 PistonHeadBlock#isFittingBase・canSurvive・updateShape・neighborChanged・affectNeighborsAfterRemoval・playerWillDestroy
- 26.3 PistonMath#getMovementArea
- 26.3 PushReaction — 5 つの値
- 26.3 Blocks — piston・sticky_piston (共通の性質の補助関数)・piston_head・moving_piston の登録、pushReaction の指定の一覧
- 26.3 SlimeBlock・HoneyBlock — ピストン用のフックが無いこと
- 26.3 BlockBehaviour.BlockStateBase#getPistonPushReaction・updateNeighbourShapes・updateIndirectNeighbourShapes
- 26.3 BlockBehaviour の形状更新の方向順の定数 (西・東・北・南・下・上)
- 26.3 Block の UPDATE_ で始まる定数・Block#updateFromNeighbourShapes・Block#updateOrDestroy
- 26.3 Level#setBlock・removeBlock・destroyBlock・setBlockEntity・removeBlockEntity・tickBlockEntities
- 26.3 LevelWriter#setBlockAndUpdate — フラグ 3
- 26.3 LevelChunk#setBlockState — 除去フック (フラグ 1 か 64)・BlockEntity の副作用 (フラグ 256)・onPlace (フラグ 512)
- 26.3 LevelChunk#setBlockEntity・removeBlockEntity・updateBlockEntityTicker — ticker の登録順
- 26.3 ServerLevel#tick・isHandlingTick・tickTime — handlingTick の区間・ゲーム時刻が進む位置
- 26.3 MinecraftServer#tickChildren — 全ディメンションの tick の後に接続 (プレイヤー入力) を処理する
- 26.3 BlockBehaviour.Properties#strength・ofFullCopy (26.4-pre-1 の壁付きブロックの押し反応の引き継ぎ)
- 26.3 ServerLevel#blockEvent・doBlockEvent — ブロック種の照合
- 26.3 ServerLevel#updateNeighborsAt・neighborChanged
- 26.3 NeighborUpdater の近隣更新の方向順の定数 (西・東・下・上・北・南)
- 26.3 SignalGetter#hasSignal・getSignal・getDirectSignalTo
- 26.3 ExperimentalRedstoneUtils#initialOrientation・withFront
- 26.3 Vec3i#hashCode
- 26.3 Entity#getPistonPushReaction — 既定は PUSH_PULL
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の PistonBaseBlock・PistonStructureResolver・PistonMovingBlockEntity・MovingPistonBlock・PistonHeadBlock・PistonMath・PushReaction・Blocks (pushReaction の指定)・LevelChunk#setBlockState を diff -u
