# 03 ブロックイベント (キューと全イベントの表)

基準は Java 版 26.3。確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: 名前] `tools/mc-harness/fixtures/` の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| ServerLevel | tick (フェーズ順のうちブロックイベントの前後)・blockEvent・runBlockEvents・doBlockEvent・clearBlockEvents・isHandlingTick・shouldTickBlocksAt |
| BlockEventData | 4 つの成分と等価の定義 |
| Level | blockEvent (サーバ以外の既定の実装)・shouldTickBlocksAt・tickBlockEntities |
| BlockBehaviour / BlockBehaviour.BlockStateBase | triggerEvent (既定は何もせず偽) |
| BaseEntityBlock | triggerEvent (BlockEntity へ回す) |
| BlockEntity | triggerEvent (既定は偽) |
| PistonBaseBlock | checkIfExtend (積む側)・triggerEvent (受付と検証。伸縮の本体は 13) |
| NoteBlock | neighborChanged・playNote・useWithoutItem・attack・triggerEvent |
| ComparatorBlock | triggerEvent (BlockEntity へ回すだけ。積む者がいない) |
| PotentSulfurBlock / PotentSulfurBlockEntity | onPlace・triggerEvent・eruptionTick |
| BellBlock / BellBlockEntity | neighborChanged・attemptToRing・onHit・triggerEvent |
| ChestBlockEntity / TrappedChestBlockEntity / EnderChestBlockEntity | signalOpenCount・triggerEvent |
| ContainerOpenersCounter | incrementOpeners・decrementOpeners・recheckOpeners |
| ShulkerBoxBlockEntity | startOpen・stopOpen・triggerEvent・updateAnimation |
| DecoratedPotBlock / DecoratedPotBlockEntity | wobble・triggerEvent |
| SpawnerBlockEntity / BaseSpawner | broadcastEvent・onEventTriggered |
| TheEndGatewayBlockEntity | triggerCooldown・triggerEvent |
| TickRateManager | runsNormally |
| DistanceManager / ChunkLevel | inBlockTickingRange・isBlockTicking |

triggerEvent を持つクラスと、blockEvent を呼ぶ箇所は grep で全部拾った。26.3 で blockEvent を呼ぶのは 12 箇所 (10 クラス) だけである (§2.4 の表)。内訳は PistonBaseBlock 2・ShulkerBoxBlockEntity 2・ほかの 8 クラスが 1 ずつ。1.21.1 は PotentSulfurBlock が無いので 11 箇所 (9 クラス)。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick 全体のフェーズ順・/tick の仕組み・BlockEntity 相の順 | → 01_tick-loop.md |
| 予約 tick (チェストの開閉の見直し 5 tick など) | → 02_scheduled-ticks.md |
| setBlock のフラグ・近隣更新・形状更新の配り方 | → 04_set-block-and-updates.md |
| ピストンの伸縮そのもの (moveBlocks・押し構造・moving_piston の確定) | → 13_pistons.md |
| 音符ブロック・ベル・硫黄系の信号面の挙動 | → 11_outputs.md |
| トラップチェストの信号とコンテナの開閉 | → 09_manual-inputs.md・14_containers-hoppers-analog.md |
| GameEvent (振動) | → 10_sculk.md |
| 乱数の消費順・HashSet の反復順 | → 18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 ブロックイベントとは

「ある位置のブロックに、整数 2 個の合図を後で届ける」仕組みである。用途は 2 つある。

1. **処理を tick の後ろのフェーズへ遅らせる**。ピストンは近隣更新を受けた時点では動かず、イベントを積む。動くのはブロックイベント相である。
2. **クライアントへ演出を伝える**。処理が真を返したイベントだけ、近くのプレイヤーへ同じ 4 成分がパケットで送られる。チェストの蓋・ベルの揺れなどはこれが主目的である。

レッドストーンの順序に効くのは 1 のほうで、実質ピストンだけである。音符ブロック・ベルは「鳴る時点」がこの相になる。

### 2.2 一生の流れ [26.3 読解]

1. どこかのコードが ServerLevel#blockEvent を呼ぶ。引数は位置・ブロック種・整数 A・整数 B。
2. 4 成分をまとめた BlockEventData を、挿入順つきの集合の**末尾**に足す。同じ 4 成分がすでに集合にあれば何も起きない (位置も順番も変わらない)。
3. ServerLevel#tick の「blockEvents」の区間で ServerLevel#runBlockEvents が走る。ただし /tick freeze で止まっているときは走らない (§4.2)。
4. 集合が空になるまで、**先頭から 1 件ずつ**取り出す。
5. 取り出した位置がブロック tick の範囲外のチャンクなら、退避リストへ移す。処理はしない。
6. 範囲内なら ServerLevel#doBlockEvent を呼ぶ。今その位置にあるブロックの種類が、積んだときのブロック種と同じかを見る。違えば捨てる (偽)。同じなら**今の blockstate** の triggerEvent を、整数 A・B を渡して呼ぶ。
7. triggerEvent が真を返したら、位置から半径 64 ブロック以内・同じディメンションの全プレイヤーへ、4 成分を載せたパケットを送る。偽なら送らない。
8. 処理の中で新しく積まれたイベントは集合の末尾に付くので、同じループの中で取り出される。**同じ tick に回る**。
9. 集合が空になったらループを抜け、退避リストの中身を集合へ戻す (次の tick でまた判定される)。

### 2.3 フェーズ上の位置 [26.3 読解: ServerLevel#tick]

01 と同じ並びのうち、関係する所だけを抜く。

| 順 | 区間 | ブロックイベントとの関係 |
|---|---|---|
| a | ワールド境界・天候・時刻 | 関係なし |
| b | ブロックの予約 tick | ここで積まれたイベントは**同じ tick の e** で処理される |
| c | 流体の予約 tick | 同上 |
| d | 襲撃・chunkSource (ランダム tick を含む) | 同上 |
| **e** | **ブロックイベント (runBlockEvents)** | ここで積まれたものも同じループで処理される |
| f | エンティティ | ここで積まれたイベントは**次の tick の e** まで待つ |
| g | BlockEntity (moving_piston の確定・ホッパーなど) | 同上 |
| (tick の外) | プレイヤーの操作・コマンド | 同上。次に来る tick の e で処理される |

- 「handlingTick」という真偽値が、tick の先頭から e の終わりまで真になる。f より後では偽である。ピストンの収縮の種別 (1 か 2 か) の判定がこれを読む (§4.5)。
- e は「一定時間プレイヤーもチケットも無い」ことによる休止 (emptyTime が 300 以上) の影響を受けない。休止で止まるのは f と g だけである。
- 「プレイヤー入力 → 次の tick の e」の 1 tick 待ちは [実機 1.21.1: piston-basic] が裏づける (レバーを t2 に入れると moving_piston は t3 に現れる)。

### 2.4 ブロックイベントの全表 [26.3 読解]

26.3 で ServerLevel#blockEvent を呼ぶ全箇所である。A・B は整数 A・整数 B。

| # | ブロック (ブロック種の成分) | A | B | 積む契機 (クラス#メソッド) | 処理の効果 (サーバ側) | 返り値 |
|---|---|---|---|---|---|---|
| 1 | piston / sticky_piston | 0 = 伸ばす | FACING の 3D 番号 (down=0, up=1, north=2, south=3, west=4, east=5) | PistonBaseBlock#checkIfExtend。受電していて EXTENDED が偽、かつ押し構造の解決が成功したとき | 受電を見直す。切れていれば何もしない。受電していれば moveBlocks を試し、成功したら本体を EXTENDED=真にする (フラグ 67)。詳細は §4.5 と 13 | 成功で真。それ以外は偽 |
| 2 | piston / sticky_piston | 1 = 縮む (粘着なら引く) | 同上 | PistonBaseBlock#checkIfExtend。受電が無く EXTENDED が真で、下の「2 の条件」に当たらないとき | 受電を見直す。受電していれば EXTENDED=真をフラグ 2 で書き直して終わり。そうでなければ本体を moving_piston に替え、粘着なら 2 つ先を引く | 収縮したら真。取り消しは偽 |
| 3 | piston / sticky_piston | 2 = 縮む (引かない) | 同上 | 同じく受電が無く EXTENDED が真で、2 つ先が「同じ向きの moving_piston・伸長中」で、(進みの前回値が 0.5 未満・その BlockEntity が今の tick にもう tick 済み・handlingTick が真) のどれかのとき | 2 と同じ。違いは粘着ピストンが 2 つ先を引かず、ヘッドの位置を消すだけになる点 | 同上 |
| 4 | note_block | 0 | 0 | NoteBlock#playNote。呼ぶのは neighborChanged (受電の立ち上がり)・useWithoutItem (右クリック)・attack (左クリック)。条件は「楽器が頭系 (BASE_BLOCK 以外)」または「真上が空気」 | 処理時点の INSTRUMENT と NOTE で音を鳴らす。パーティクルの呼び出しはサーバでは何も出ない。ワールド乱数から long を 1 個引く | 真。CUSTOM_HEAD で真上の頭に音の ID が無いときだけ偽 (乱数も引かない) |
| 5 | bell | 1 | 揺れる向きの 3D 番号 | BellBlockEntity#onHit。呼ぶのは BellBlock#attemptToRing (受電の立ち上がり・右クリック・投射物・爆発・村人の行動 RingBell) | 近くの生物のリストを更新し、ticks=0・resonationTicks=0・shaking=真・向きを記録 | 真 (A が 1 以外は偽) |
| 6 | chest / trapped_chest / 銅のチェスト各種 | 1 | 開けている人数 | ChestBlockEntity#signalOpenCount。ContainerOpenersCounter の人数が変わるたび (開く・閉じる・5 tick ごとの見直し) | 蓋の制御に「開くべきか (B が 1 以上)」を渡すだけ。サーバでは見た目以外の効果は無い | 真 |
| 7 | ender_chest | 1 | 開けている人数 | EnderChestBlockEntity の人数カウンタ (openerCountChanged) | 6 と同じ | 真 |
| 8 | shulker_box (全色) | 1 | 開けている人数 (openCount) | ShulkerBoxBlockEntity#startOpen・stopOpen | openCount を B にする。B が 0 なら animationStatus=CLOSING、1 なら OPENING。**以後の BlockEntity の tick が形状更新と近隣更新を出す** (§4.9) | 真 |
| 9 | decorated_pot | 1 | 揺れ方の番号 (0=POSITIVE, 1=NEGATIVE) | DecoratedPotBlockEntity#wobble。DecoratedPotBlock のアイテム投入の成功 (0) と失敗・素手 (1) | 揺れの開始 tick と揺れ方を記録 (見た目だけ) | B が 0〜1 なら真 |
| 10 | spawner | 1 | 0 | BaseSpawner#delay から SpawnerBlockEntity の broadcastEvent | サーバでは何も変えない (待ち時間の巻き戻しはクライアントだけ) | A が 1 なら真 |
| 11 | end_gateway | 1 | 0 | TheEndGatewayBlockEntity#triggerCooldown (サーバのみ。積む前に自分で teleportCooldown=40 にしている) | teleportCooldown=40 | 真 |
| 12 | potent_sulfur | 0 | 0 | PotentSulfurBlock#onPlace。置かれた・変わった後の STATE が ERUPTING か CONTINUOUS のとき。同じ場所で音と GameEvent の BLOCK_ACTIVATE も出す (積む時点) | BlockEntity の eruptionTick に今のゲーム時刻を入れる | 常に真 |

補足。

- 6 のブロック種は「人数が変わった時点の blockstate のブロック」である。7 と 10 だけは定数 (ender_chest・spawner) を渡す。
- トラップチェストは 6 を積んだ直後に、人数が変わっていれば自分と真下の位置から近隣更新を配る (TrappedChestBlockEntity#signalOpenCount)。**信号の変化はイベントの処理を待たない**。→ 09_manual-inputs.md
- 樽は人数カウンタを持つがブロックイベントは積まない (OPEN プロパティを書き換える)。
- ComparatorBlock は triggerEvent を上書きして BlockEntity へ回すが、ComparatorBlockEntity は triggerEvent を上書きしていない。コンパレーターへイベントを積む箇所も無い。**死んだ経路**である。
- moving_piston (MovingPistonBlock) は BaseEntityBlock なので受け口はあるが、積む者がいない。

---

## 3. 状態とデータ

### 3.1 キュー [26.3 読解: ServerLevel のフィールド]

| 名前 | 型 | 役割 |
|---|---|---|
| blockEvents | fastutil の ObjectLinkedOpenHashSet (要素は BlockEventData) | 本体。挿入順を保つハッシュ集合。ディメンションごとに 1 つ |
| blockEventsToReschedule | ArrayList (初期容量 64) | ブロック tick の範囲外だったイベントの退避先。runBlockEvents の先頭で空にする |
| handlingTick | 真偽値 | tick の先頭で真、ブロックイベント相の直後に偽 |

- 件数の上限は無い。予約 tick の 65,536 件のような打ち切りも無い。
- 保存されない。チャンクにもレベルにも書き出す箇所が無い。サーバを止めると未処理のイベント (退避中のものを含む) は消える。
- ほかに触るのは ServerLevel#clearBlockEvents (範囲内のイベントを消す) だけで、呼ぶのは GameTest の枠組み (StructureUtils・GameTestInfo) に限られる。通常のプレイでは呼ばれない。

### 3.2 BlockEventData の 4 成分と等価 [26.3 読解: BlockEventData]

| 成分 | 型 | 等価の比べ方 |
|---|---|---|
| pos | BlockPos | x・y・z が同じ |
| block | Block | 同じインスタンス (ブロック種が同じ) |
| paramA | int | 値が同じ |
| paramB | int | 値が同じ |

レコードなので、4 成分すべてが等しいときだけ「同じイベント」になる。blockstate のプロパティ・積んだ tick・積んだ者は等価に入らない。

重複排除の帰結。

- piston の (伸ばす, 向き) を同じ tick に何度積んでも 1 件である。
- piston と sticky_piston は別のブロック種なので別のイベントである (同じ位置で入れ替わった場合)。
- (縮む 1, 向き) と (縮む 2, 向き) は A が違うので**両方入る**。先に処理されたほうが本体を moving_piston に替えるので、後のほうは §4.3 の照合で捨てられる。
- 集合にあるものとだけ比べる。**取り出し済みのイベントは集合に無い**ので、処理の最中に自分と同じ 4 成分を積むと、新しい 1 件として末尾に入る。
- 重複のとき、既にある要素の位置は動かない (末尾へ移らない)。
- **退避リストにあるイベントも集合には無い**。範囲外で退避された後、同じ相 e の中や次の相 e までの間に同じ 4 成分が積まれると、集合に新しく入る。相 e の終わりの戻しは集合への追加なので、そこで 1 件に畳まれる (先に集合にあったほうの位置が残る)。

### 3.3 定数

| 値 | 意味 | 典拠 |
|---|---|---|
| 64.0 | パケットを送る半径 (ブロック) | ServerLevel#runBlockEvents |
| 32 | ブロック tick の範囲とみなすチャンクレベルの上限 (これ以下が範囲内) | ChunkLevel#isBlockTicking |
| 0 / 1 / 2 | ピストンの A (伸ばす / 縮む・引く / 縮む・引かない) | PistonBaseBlock#checkIfExtend |
| B と 7 の論理積 | ピストンが B から向きを取り出すときのマスク | PistonBaseBlock#triggerEvent |
| 67 | 伸長の成功後に本体へ書くフラグ (1 + 2 + 64) | 同上 |
| 2 | 収縮を取り消すときに本体へ書くフラグ | 同上 |
| 276 | 収縮で本体を moving_piston に替えるフラグ (4 + 16 + 256) | 同上 |

---

## 4. 処理の詳細

### 4.1 ServerLevel#blockEvent (積む)

- 契機: §2.4 の各ブロックのコード。フェーズは問わない (予約 tick の中・近隣更新の連鎖の中・エンティティ相・プレイヤー操作の処理中のどこからでも呼ばれる)。
- 判定: 無し。チャンクが範囲内か・位置にそのブロックがあるか・/tick freeze 中かは見ない。
- 書き込み: 集合の末尾へ追加。同じ 4 成分があれば無視。
- 予約 tick・近隣更新・形状更新: 出さない。
- 位置の成分は渡された BlockPos をそのまま持つ (写しを取らない)。26.3 の呼び出し元はどれも不変の位置を渡している [26.3 読解]。

サーバ以外 (Level#blockEvent の既定) は、積まずにその場で今の blockstate の triggerEvent を呼ぶ。クライアントが受け取ったパケットを処理する経路である。エンジンには関係ない。

### 4.2 ServerLevel#runBlockEvents (回す)

- 契機: ServerLevel#tick の chunkSource の区間の直後。TickRateManager#runsNormally が真のときだけ呼ばれる。
- 手順。
  1. 退避リストを空にする。
  2. 集合が空でない間、先頭を取り出す。
  3. その位置のチャンクがブロック tick の範囲内か (ServerLevel#shouldTickBlocksAt) を見る。
  4. 範囲内なら §4.3 を呼ぶ。真が返ればパケットを送る。
  5. 範囲外なら退避リストの末尾へ足す。
  6. ループが終わったら、退避リストを順に集合へ足し戻す。
- 取り出し順: 完全な FIFO。優先度は無い。位置による並べ替えも無い。
- 同じ tick に回るか: 回る。処理中に積まれたイベントは末尾に付き、ループは集合が空になるまで続く。
- 止まらない場合: 互いに積み合うイベントがあると、この 1 tick の中でループが終わらない。上限は無い。
- 「層」の見方: 相の開始時点の中身を第 1 層、その処理中に積まれたものを第 2 層…と数える言い方 (BED) がある。単一の FIFO でも、層の境をまたいで順序が入れ替わることは無いので、層で数えても結果は同じである。

/tick freeze との関係 [26.3 読解: ServerLevel#tick・TickRateManager#runsNormally]。

| 状況 | blockEvent (積む) | runBlockEvents (回す) |
|---|---|---|
| 通常 | 入る | 毎 tick 走る |
| /tick freeze 中 | **入る** (積む側は凍結を見ない) | 走らない。集合に溜まり続ける |
| /tick step で 1 tick 進める | 入る | その tick は走る。溜まっていた分をまとめて処理する |
| /tick sprint | 入る | 毎 tick 走る |

- 凍結中もプレイヤーの操作は通る。レバーを倒せば近隣更新が走り、ピストンは伸長のイベントを積む。解凍または step の最初の tick のブロックイベント相でまとめて処理される。
- 凍結中の tick でも handlingTick は tick の先頭から相の位置まで真になる。ただしその間に予約 tick もブロックイベントも走らないので、実際に読まれる場面は無い。
- 凍結中に溜まったイベントの処理順が積んだ順であること・step 1 回で全部が処理されることは [要実機] (§8 P6)。

### 4.3 ServerLevel#doBlockEvent (照合して届ける)

- 契機: §4.2 の手順 4。
- 判定: 位置の今の blockstate が、イベントのブロック種と同じブロックか。
  - 違う → 偽を返す。何もしない。イベントは捨てられる (再試行なし)。
  - 同じ → 今の blockstate の triggerEvent を、整数 A・B を渡して呼ぶ。その返り値を返す。
- 重要: 見るのは**ブロック種だけ**である。プロパティは見ない。積んでから処理されるまでに blockstate が変わっていても、ブロック種が同じなら届く。処理側は「今の」blockstate を読む。
  - 例: 音符ブロックは、積んだ後で NOTE が変わっていれば新しい音程で鳴る。
  - 例: ピストンは、積んだ後で FACING が変わっていれば新しい向きで動く (B の向きは別の用途にしか使わない。§4.5)。
- 位置のブロックが同じ種類の別物に置き換わっていても届く (壊して同じ種類を置き直した場合)。

### 4.4 イベントが捨てられる・延びる条件のまとめ

| 条件 | 結果 | 典拠 |
|---|---|---|
| 同じ 4 成分が集合にある | 積まれない | ObjectLinkedOpenHashSet の追加 |
| 処理時に位置のブロック種が違う | 捨てる。パケットも送らない | ServerLevel#doBlockEvent |
| 処理時に位置がブロック tick の範囲外 | 捨てない。次の tick へ持ち越す (毎 tick 判定し直す) | ServerLevel#runBlockEvents |
| /tick freeze 中 | 捨てない。相そのものが走らない | ServerLevel#tick |
| 処理側が自分で取り下げる (ピストンの受電の見直しなど) | 状態は変えず偽を返す | 各 triggerEvent |
| サーバ停止 | 消える (保存されない) | 保存の経路が無い |

持ち越しの順序。範囲外だったイベントは、相 e の終わりに元の相対順のまま集合へ戻る。その時点で集合は空なので、同じ tick の f・g や tick の外で後から積まれるイベントより**前**に並ぶ。次の tick の相 b〜d で積まれるものよりも前である。

### 4.5 PistonBaseBlock (積む側と受付)

伸縮の本体 (moveBlocks・押し構造・moving_piston) は 13 の範囲。ここは「いつ・どの種別を積むか」と「処理の入口の検証」だけを書く。

**積む側: PistonBaseBlock#checkIfExtend** [26.3 読解]

- 契機: neighborChanged (サーバのみ)・setPlacedBy (サーバのみ)・onPlace (別のブロックから替わり、サーバで、位置に BlockEntity が無いとき)。
- 手順。
  1. FACING を読む。受電しているか (getNeighborSignal。準接続を含む。→ 05・13) を調べる。
  2. 受電していて EXTENDED が偽: 押し構造の解決 (PistonStructureResolver を伸長の向きで作って resolve) を試す。成功したら (A=0, B=向き) を積む。失敗したら何も積まない。
  3. 受電が無く EXTENDED が真: A を決めて (A, B=向き) を積む。押し構造は調べない。
  4. それ以外 (状態と受電が合っている): 何もしない。
- A の決め方 (手順 3)。既定は 1。次のすべてが成り立つと 2 になる。
  1. 本体から FACING へ 2 つ先のブロックが moving_piston である。
  2. その moving_piston の FACING がピストンの FACING と同じである。
  3. その位置に PistonMovingBlockEntity があり、伸長中である。
  4. 次のどれかが成り立つ: 部分 tick 0 で読んだ進みが 0.5 未満 / その BlockEntity が最後に tick したゲーム時刻が今のゲーム時刻と同じ / ServerLevel#isHandlingTick が真。
- 帰結: tick の先頭からブロックイベント相の終わりまで (予約 tick・ランダム tick・ブロックイベントの連鎖) に受電が切れた場合、2 つ先が同じ向きで伸長中の moving_piston なら**進みに関係なく** A は 2 になる。

**受ける側: PistonBaseBlock#triggerEvent の入口** [26.3 読解]

1. 今の blockstate から FACING を読む。以後の向きはすべてこれである。
2. サーバなら受電を調べ直す (getNeighborSignal)。
3. 受電していて A が 1 または 2: 本体に「今の blockstate の EXTENDED を真にしたもの」をフラグ 2 で書く。偽を返す。収縮は取り消し。
   - ふつうは既に EXTENDED が真なので、書き込みは変化なしで終わる (近隣更新も形状更新も出ない)。
   - フラグ 2 なので、仮に変化があっても近隣更新は出ない。形状更新は出る (→ 04)。
4. 受電が無く A が 0: 偽を返す。伸長は取り消し。何も書かない。
5. A が 0: moveBlocks を伸長で呼ぶ。偽なら偽を返す (何も変わらない)。真なら本体を EXTENDED=真でフラグ 67 で書き、ワールド乱数から float を 1 個引いて伸長の音を出し、GameEvent の BLOCK_ACTIVATE を出す。
6. A が 1 または 2: 収縮の本体へ進む (→ 13)。入口で効く点だけ挙げる。
   - まずヘッドの位置 (1 つ先) に PistonMovingBlockEntity があればその場で確定させる (finalTick)。
   - 本体をフラグ 276 で moving_piston (FACING=今の向き、TYPE=粘着なら STICKY・そうでなければ DEFAULT) に替え、BlockEntity を作る (収縮・ピストン本体の扱い)。運ぶ blockstate は「このブロックの既定の状態に FACING を入れたもの」で、FACING は **B と 7 の論理積**から作る。B が使われるのはここだけである。
   - 本体の位置から近隣更新を配り、フラグ 2 で形状更新を配る。
   - 粘着で、2 つ先が「moving_piston・同じ向き・伸長中」なら、それをその場で確定させて引かない。ここの「同じ向き」は **BlockEntity が持つ移動の向き** (PistonMovingBlockEntity#getDirection) で比べる。積む側 (checkIfExtend) は moving_piston の **blockstate の FACING** で比べるので、見ている値が違う。伸長中の moving_piston では両者は同じ向きになるはずだが、一致しない場合があるかは 13 で確かめる [要実機]。そうでなく A が 1 で引ける相手なら moveBlocks を収縮で呼ぶ。A が 2・空気・引けない相手ならヘッドの位置を消すだけ。
   - 粘着でなければヘッドの位置を消す。
   - ワールド乱数から float を 1 個引いて収縮の音を出し、GameEvent の BLOCK_DEACTIVATE を出す。
7. A が 0・1・2 以外: 何もせず真を返す (通常は起きない)。

入口の検証の要点。

- **伸長は 2 回検証される**。積む時点で押し構造が解決できること、処理の時点で受電が続いていることと moveBlocks が通ること。
- **収縮は積む時点では検証されない**。処理の時点で受電が戻っていれば取り消す。
- A が 0 のとき、EXTENDED が既に真かどうかは調べない [26.3 読解]。伸びたピストンに伸長のイベントが届くと moveBlocks まで進む。積む条件が「EXTENDED が偽」なので通常は起きない。起こすには、伸長のイベントが集合にある間に別経路で EXTENDED を真にする必要がある [要実機]。
- A が 1・2 のときも、EXTENDED が真かどうかは調べない [26.3 読解]。縮んだピストンに収縮のイベントが届くと、受電していれば EXTENDED=真がフラグ 2 で書かれ (ヘッドの無い「伸びた」本体になる)、受電が無ければ収縮の本体がそのまま走る (1 つ先のブロックを消す・粘着なら 2 つ先を引く)。積む条件が「EXTENDED が真」なので通常は起きない。起こすには、収縮のイベントが集合や退避リストにある間に、同じ位置を同じブロック種の縮んだピストンに置き換える必要がある [要実機]。
- 処理の時点で、照合 (§4.3) を通るのは本体が piston か sticky_piston のままのときだけである。収縮の途中 (本体が moving_piston) に届いたイベントは捨てられる。

A の 1 と 2 が結果を分ける場面。

- 違いが出るのは「粘着」かつ「処理の時点で 2 つ先が『同じ向き・伸長中の moving_piston』ではない」ときだけである。そのとき 1 は引き、2 は引かない。
- 2 が付くのは積む時点で 2 つ先が伸長中の moving_piston だった場合なので、積んでから処理までの間にそれが確定している必要がある。確定は BlockEntity 相 (g) か、別のピストンの処理による finalTick で起きる。
- 同じ tick の b〜e で積んで e で処理する場合、間に g が無いので 2 つ先はまだ moving_piston である。このとき 1 でも 2 でも「その場で確定させて引かない」になり、結果は同じになる。
- したがって 1 と 2 の差が観測に出るのは、別のピストンのイベントが先に 2 つ先を確定させた場合や、持ち越し (範囲外・凍結) を挟んだ場合に限られると読める。実際に差が出る回路は [要実機] (§8 P5)。
- 短いパルスで粘着ピストンがブロックを置いていく現象そのものは [実機 1.21.1: sticky-observer-pulse] [実機 1.21.1: observer-piston-pulse] が裏づける。

### 4.6 NoteBlock

**積む側** [26.3 読解: NoteBlock#neighborChanged・playNote]

1. 近隣更新を受けたら、位置が受電しているか (hasNeighborSignal) を調べる。
2. POWERED と違えば: 受電しているなら playNote を呼ぶ。そのあと POWERED を書き換える (フラグ 3)。
3. playNote は「INSTRUMENT が頭系」または「真上が空気」のときだけ、(A=0, B=0) を積み、GameEvent の NOTE_BLOCK_PLAY を出す。
4. 積むのが先、POWERED の書き込みが後である。GameEvent は積んだ時点で出る (イベントの処理を待たない。→ 10)。

- 右クリックは NOTE を 1 進めてフラグ 3 で書いた後に playNote を呼ぶ。左クリックも playNote を呼ぶ。
- 同じ tick に何度立ち上がっても、集合にある間は 1 件である。1 回処理された後なら同じ tick にもう 1 回積める。

**受ける側** [26.3 読解: NoteBlock#triggerEvent]

1. 今の blockstate の INSTRUMENT を読む。
2. 音程を変えられる楽器 (BASE_BLOCK 系) なら NOTE を読み、ピッチを 2 の ((NOTE − 12) ÷ 12) 乗にする。それ以外はピッチ 1.0。
3. CUSTOM_HEAD なら真上の頭の BlockEntity から音の ID を取る。無ければ偽を返す。
4. ワールド乱数から long を 1 個引き、それを種にして音を出す (音量 3.0・RECORDS の区分)。真を返す。

blockstate は変えない。近隣更新も出さない。エンジンにとっては「音が鳴った時点」と「乱数を 1 個消費する」ことだけが効く。

[実機 1.21.1: qc-noteblock-strong] は音符ブロックの受電 (POWERED) を見ている。鳴る時点そのものは blockstate に出ないので fixture では測れない。

### 4.7 BellBlock / BellBlockEntity

1. BellBlock#neighborChanged: 受電の立ち上がりで attemptToRing を向き無しで呼ぶ。そのあと POWERED をフラグ 3 で書く。
2. BellBlock#attemptToRing (サーバで、位置に BellBlockEntity があるとき): 向きが無ければ FACING を使う。BellBlockEntity#onHit を呼び、音を出し、GameEvent の BLOCK_CHANGE を出す。
3. BellBlockEntity#onHit: 向きを記録する。既に揺れていれば ticks を 0 に、そうでなければ shaking を真にする。(A=1, B=向きの 3D 番号) を積む。
4. BellBlockEntity#triggerEvent (A が 1): 近くの生物のリストを更新 (最後に鳴ってから 60 tick を超えたとき・未取得のとき)。resonationTicks=0・向き=B・ticks=0・shaking=真。真を返す。

音と GameEvent は積む時点で出る。イベントが変えるのは BlockEntity の内部の値だけで、信号には関係しない。

### 4.8 チェスト類

- ChestBlockEntity・EnderChestBlockEntity は ContainerOpenersCounter を持つ。人数が変わる 3 つの入口 (incrementOpeners・decrementOpeners・recheckOpeners) の最後で必ず openerCountChanged が呼ばれ、(A=1, B=今の人数) が積まれる。
- recheckOpeners は人数が変わっていなくても積む。集合に同じ 4 成分があれば重複で消える。
- 処理は蓋の制御に真偽を渡すだけである。蓋のアニメーションの tick はクライアントにしか登録されない (ChestBlock・EnderChestBlock の getTicker)。
- ホッパー・ドロッパーの出し入れは人数カウンタを動かさない。**プレイヤー (とコンテナを開ける生物) がいなければ、このイベントは積まれない**。

### 4.9 ShulkerBoxBlockEntity

ブロックイベントが**サーバ側の状態機械の入力**になっている唯一のコンテナである。

1. startOpen: openCount が負なら 0 にし、1 増やして (A=1, B=openCount) を積む。1 になったら GameEvent と音。
2. stopOpen: 1 減らして (A=1, B=openCount) を積む。0 以下になったら GameEvent と音。
3. triggerEvent (A が 1): openCount を B にする。B が 0 なら CLOSING、B が 1 なら OPENING にする。それ以外の B では animationStatus を変えない。
4. BlockEntity の tick (サーバにも登録される) が updateAnimation を呼ぶ。
   - OPENING: 進みを 0.1 増やす。増やす前が 0.0 なら近隣への通知を出す。1.0 に達したら OPENED にして、もう一度出す。
   - CLOSING: 進みを 0.1 減らす。減らす前が 1.0 なら通知を出す。0.0 に達したら CLOSED にして、もう一度出す。
   - 通知の中身: フラグ 3 で形状更新を配り、続けて自分の位置から近隣更新を配る (ShulkerBoxBlockEntity の doNeighborUpdates)。
5. イベントは相 e、BlockEntity の tick は相 g なので、**同じ tick の中で** OPENING の最初の通知まで進む。

プレイヤーが開けない限り起きない。プレイヤー操作を扱わないエンジンでは省ける。開いているシュルカーボックスの形 (導体かどうか) は → 05。

### 4.10 見た目だけのイベント

| ブロック | サーバで変わる値 | エンジンでの扱い |
|---|---|---|
| decorated_pot | 揺れの開始 tick・揺れ方 | 不要 |
| spawner | 無し | 不要 |
| end_gateway | teleportCooldown=40 (積む側が先に同じ値を入れている) | 不要 |
| potent_sulfur | eruptionTick=今のゲーム時刻 | BlockEntity の tick が「噴出が始まってからの時間」を eruptionTick から数える。噴出の挙動を再現するなら必要 (→ 11) |

potent_sulfur の補足 [26.3 読解: PotentSulfurBlock#onPlace・triggerEvent]。

- onPlace は「置かれた後の STATE が ERUPTING か CONTINUOUS」のたびに積む。同じブロックの STATE だけが変わった場合も onPlace は呼ばれる (→ 04) ので、噴出の開始ごとに 1 件積まれる。
- 処理は BlockEntity があれば eruptionTick を書き、無くても真を返す。
- eruptionTick の初期値は −1 で、BlockEntity がレベルに結び付けられる時点 (PotentSulfurBlockEntity#setLevel) に −1 なら今のゲーム時刻で埋める。つまりイベントが届く前でも動く。イベントはそれを「噴出が始まった tick」で上書きする役である。

---

## 5. 端の場合と落とし穴

1. **「積んだ時の状態」は保存されない**。保存されるのはブロック種と整数 2 個だけ。処理は今の blockstate を読む。
2. **重複排除は集合にある間だけ**。処理済みのイベントは同じ tick でもまた積める。「1 tick に 1 回」ではない。
3. **返り値が偽でも副作用はある**。ピストンの収縮の取り消しは EXTENDED=真の書き直しを伴う。返り値が決めるのはパケットを送るかどうかだけである。
4. **予約 tick との違い**。予約 tick は期限の来たものを先に集めてから実行するので、実行中に積んだものは同じ tick には走らない (→ 02)。ブロックイベントは集めずに先頭から回すので、処理中に積んだものも走る。
5. **相 e より後で積むと 1 tick 遅れる**。moving_piston の確定は相 g なので、確定したブロックが出す近隣更新で積まれたピストンのイベントは次の tick の相 e になる。予約 tick (相 b) 由来なら同じ tick である。[実機 1.21.1: piston-basic] [実機 1.21.1: rblock-piston-chain]
6. **同じ tick の順序は積んだ順**。複数のピストンが同じ tick に動くとき、どれが先かは近隣更新が届いた順 (= 積んだ順) で決まる。位置の大小や優先度では決まらない。[実機 1.21.1: two-piston-locational]
7. **伸長は積む時点で押せなければ積まれない**。あとで押せるようになっても、もう一度近隣更新が来るまで動かない (BUD の一因)。
8. **伸長のイベントが処理されずに終わる短いパルス**。相 b で受電して積み、同じ相 b のうちに受電が切れると、相 e の入口の見直しで取り消される。収縮のイベントは積まれない (EXTENDED が偽のままなので)。
9. **(縮む 1) と (縮む 2) の同居**。両方が集合に入りうるが、先の 1 件が本体を moving_piston に替えるので後の 1 件は照合で落ちる。先に積まれたほうの A が効く。
10. **トラップチェストの信号はイベントを待たない**。人数が変わった時点で近隣更新が出る。イベントは蓋の見た目だけ。
11. **GameEvent はイベントを待たない**。音符ブロック・ベル・シュルカーボックス・チェスト類・potent_sulfur の GameEvent は積む時点で出る。ピストンの BLOCK_ACTIVATE・BLOCK_DEACTIVATE だけは処理の中で出る。
12. **乱数の消費**。音符ブロックの処理は long を 1 個、ピストンの成功した伸長・実行された収縮は float を 1 個、ワールド乱数から引く。取り消し・失敗では引かない。これらは**処理の時点**の消費である。ほかに**積む時点**でワールド乱数から float を 1 個引くものがある: シュルカーボックスの開く音 (openCount が 1 になったとき)・閉じる音 (0 以下になったとき)、チェスト類とエンダーチェストの開閉の音 (ShulkerBoxBlockEntity#startOpen・stopOpen、ChestBlockEntity と EnderChestBlockEntity の人数カウンタの onOpen・onClose)。どれもプレイヤーなどが開けたときだけ起きる。音の種 (playSound が内部で引く long) は別の専用の乱数なので、ワールド乱数には効かない (Level の soundSeedGenerator)。音符ブロックだけは種をワールド乱数から引く。ワールド乱数を他の挙動と共有するので、再現には消費の有無と順序が要る (→ 18)。
13. **ブロック tick の範囲外への持ち越し**。エンジンが全域を常に tick するなら、この分岐は不要である。
14. **コンパレーターにブロックイベントは無い**。受け口だけが残っている。

---

## 6. 版差

担当クラスを diff -u で比べた結果。挙動に効くものだけ挙げる。

### 6.1 キュー (ServerLevel の blockEvent・runBlockEvents・doBlockEvent・BlockEventData)

| 版 | 違い |
|---|---|
| 1.21.1 | 無し。集合の型・退避リスト・取り出し・照合・送信半径 64・runsNormally の条件・フェーズ上の位置 (chunkSource の後、エンティティの前) が同じ |
| 26.2 | 無し |
| 26.4-pre-1 | ブロックイベントの 3 メソッドと BlockEventData は無し。ServerLevel#tick では、予約 tick の区間の条件から「デバッグワールドでない」が消えた (26.3 までは runs かつデバッグワールドでないとき、26.4-pre-1 は runs だけ) [版差 26.4-pre-1]。通常のワールドには効かない。→ 01 |

キューの仕組みは 4 版で同一である。既存の実機 fixture (1.21.1) はこの点で 26.3 にもそのまま有効。

### 6.2 イベントの種類

| ブロック | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| piston / sticky_piston (0・1・2) | 有 | 有 | 有 | 有 |
| note_block (0) | 有 | 有 | 有 | 有 |
| bell・chest 類・ender_chest・shulker_box・decorated_pot・spawner・end_gateway (1) | 有 | 有 | 有 | 有 |
| potent_sulfur (0) | **ブロックが無い** [版差 1.21.1] | 有 | 有 | 有 |

### 6.3 各クラスの細部

| 対象 | 版差 | 効き方 |
|---|---|---|
| PistonBaseBlock#triggerEvent の収縮で本体を moving_piston に替えるフラグ | [版差 1.21.1] 20 (4 + 16)。26.2 以降は 276 (256 が加わる) | 256 は BlockEntity の取り外し時の副作用を省く指定。詳細は → 04・13 |
| 同じく本体の位置から近隣更新を配る呼び出し | [版差 1.21.1] メソッド名が違う (blockUpdated)。26.2 以降は updateNeighborsAt | 配り方の差は → 04 |
| PistonBaseBlock の「引ける相手」の押し反応の名前 | [版差 1.21.1] と 26.2 は NORMAL。26.3 は PUSH_PULL。PushReaction の 5 値がすべて改名され、宣言の並びも変わった (26.2: NORMAL・DESTROY・BLOCK・IGNORE・PUSH_ONLY → 26.3: PUSH_PULL・PUSH・POPPED・IMMOVEABLE・IGNORE_ENTITY)。isPushable の分岐の対応は BLOCK→IMMOVEABLE・DESTROY→POPPED・PUSH_ONLY→PUSH | 値の数は 5 のまま。各ブロックへの割り当てが変わったかは → 05・13 |
| PistonBaseBlock#isPushable の黒曜石などの直書きの判定 (obsidian・crying_obsidian・respawn_anchor・reinforced_deepslate を押せないとする) | 26.2 にはある。26.3 で消えた | 判定の移動先は → 13 |
| PistonBaseBlock#checkIfExtend の A の決め方 | 4 版で同じ | — |
| PistonBaseBlock#triggerEvent の入口の検証 (受電の見直し・フラグ 2・フラグ 67) | 4 版で同じ | — |
| NoteBlock#neighborChanged・useWithoutItem の書き込み | 26.2 まではフラグ 3 を直接指定。26.3 は同じ意味の別メソッド | 挙動は同じ |
| NoteBlock#playNote・triggerEvent | 4 版で同じ (1.21.1 は ID の型名が違うだけ) | — |
| TrappedChestBlockEntity#signalOpenCount の近隣更新 | [版差 1.21.1] 向きの情報 (Orientation) を渡さない。26.2 以降は渡す | → 04・09 |
| BellBlockEntity・ChestBlockEntity・DecoratedPotBlockEntity・SpawnerBlockEntity・TheEndGatewayBlockEntity | 26.3 → 26.4-pre-1 は音の引数の省略・数学関数の置き換え・メニューの分岐だけ | ブロックイベントには効かない |
| PistonBaseBlock (26.3 → 26.4-pre-1) | moveBlocks の中の集合の作り方の書き換えだけ (型は同じ HashMap・ArrayList) | 効かない |

---

## 7. Rust で実装するときの要点

### 7.1 データ構造

- キューは「挿入順を保つ集合」にする。候補は 2 つ。
  - IndexSet 相当 (挿入順つきハッシュ集合) で、先頭の取り出しに shift_remove を使う。取り出しが O(n) になるので件数が多いと遅い。
  - **VecDeque + HashSet の組**。積むときは HashSet に無ければ両方へ入れる。取り出すときは VecDeque の先頭を取り、HashSet から消す。これで 26.3 と同じ意味になる (重複の比較対象は「まだ取り出していないもの」だけ)。
- キーは (位置, ブロック種の ID, A, B) の 4 つ組。blockstate の ID ではなくブロック種の ID を使う。
- A・B は i32 のまま持つ。ピストンの向きの取り出しは B と 7 の論理積。列挙に畳むと (1) と (2) の区別や、想定外の値の素通りが再現できなくなる。

### 7.2 ループ

1. 相 e で、キューが空になるまで先頭を取り出す。
2. 位置の今のブロック種がキーのブロック種と違えば捨てる。
3. 同じなら、今の blockstate で処理関数を呼ぶ。処理関数は真偽を返す (トレース用。挙動には使わない)。
4. 処理関数の中からの近隣更新・setBlock が新しいイベントを積んでよい。キューを借用したまま処理関数を呼ばない設計にする (取り出してから呼ぶ)。
5. 上限は設けない。無限ループの検出は「安全弁」として別に持ち、発動したら**バニラと違う結果になった**ことを呼び出し元へ返す (黙って捨てない)。

### 7.3 状態の持ち方

- ワールドの状態として「handlingTick 相当」を持つ。相 a の先頭で真、相 e の直後に偽。ピストンの A の決定が読む。
- プレイヤー入力・エンティティ相・BlockEntity 相で積まれたイベントは、何もしなくても次の tick の相 e で処理される (キューを tick をまたいで持ち続けるだけでよい)。
- 保存・復元: バニラは保存しない。エンジンのスナップショットでは、順序つきのまま保存する (途中の tick で止めて再開できるように)。バニラのワールドを読み込むときは空で始める。
- /tick freeze・step を再現するなら、相 e を飛ばす条件を 01 の「runs」に合わせる。積む側は止めない。
- ブロック tick の範囲外への退避は、全域を tick するエンジンでは実装しない。

### 7.4 実装するイベント

| 優先 | イベント | 理由 |
|---|---|---|
| 必須 | piston / sticky_piston の 0・1・2 | 順序の中核 |
| 必須 | note_block の 0 | 鳴る時点と乱数の消費。blockstate は変えない |
| あれば | bell の 1 | 信号には無関係。鳴った事実は積む時点で出る |
| あれば | potent_sulfur の 0 | 噴出を扱うなら |
| プレイヤー操作を扱うなら | shulker_box の 1 | サーバの状態機械が形状更新・近隣更新を出す |
| 不要 | chest 類・ender_chest・decorated_pot・spawner・end_gateway | 見た目だけ |

### 7.5 他のメモとの境界

- 相の並びと handlingTick の区間 → 01
- ピストンの moveBlocks・finalTick・押し構造 → 13 (本メモは入口の検証まで)
- 処理関数の中の setBlock のフラグの意味 → 04
- ワールド乱数の消費の総覧 → 18

---

## 8. 検証用のプローブ回路案

どれも blockstate の時系列で測れる形にする。音は blockstate に出ないので、音符ブロックの発音時点は直接は測れない (GameEvent をスカルクセンサーで拾う案は積む時点を測ることになり、処理の時点は測れない)。

### P1 同じ tick の連鎖 (処理中に積んだイベントが同じ tick に回る)

- 目的: 相 e の中で積まれたイベントが同じ tick に処理されることを確かめる。
- 配置: ピストン A の隣にピストン B を置く。B への入力は、A の収縮で A の本体の位置から出る近隣更新でしか B に届かないようにする (B は準接続などで「受電しているのに更新を受けていない」状態にしておく)。押されて移動中のブロックは受電させないので、押した先で受電させる形は使えない (それは P7)。
- 観測: A の本体が moving_piston になる tick と、B が動く tick。
- 期待: 同じ tick。1 tick ずれたら読みが違う。

### P2 重複排除 (同じ tick に 2 回の立ち上がり)

- 目的: 集合にある間は 1 件に畳まれることを確かめる。
- 配置: ピストンに、同じ tick の相 b の中で「受電 → 切断 → 受電」が起きる入力を与える (優先度の違うリピーターとトーチを同じ tick に発火させる)。
- 観測: ピストンが伸びる tick と回数。
- 期待: 伸長は 1 回。押し構造の解決は立ち上がりごとに走るが、イベントは 1 件。

### P3 受電の見直しによる取り消し

- 目的: 相 b で積んだ伸長が、相 e の時点で受電が無ければ取り消されることを確かめる。
- 配置: ピストンへの入力を、同じ tick の相 b の中で ON → OFF にする (0 tick のパルス)。
- 観測: ピストンの EXTENDED と、前のブロック。
- 期待: 何も動かない。次の tick 以降も動かない。
- 対になる測定: 収縮側。伸びたピストンで OFF → ON を同じ tick の相 b に起こす。期待は「伸びたまま」。[実機 1.21.1: door-5x5-kurigohan] が間接に裏づける。

### P4 ブロック種の照合

- 目的: 積んだ後に位置のブロックが変わると捨てられることを確かめる。
- 配置: ピストン X に伸長のイベントを積ませ、同じ tick の相 e で先に処理される別のピストン Y が X を押して動かす (X は伸びていなければ押せる)。
- 観測: X が元の位置で伸びるか・移動先で伸びるか・伸びないか。
- 期待: X の位置は moving_piston になっているので、X のイベントは捨てられる。X は移動先に着いても伸びない (着地時の更新で改めて積まれるかは 13 の範囲)。

### P5 収縮の種別 1 と 2 の差

- 目的: A=2 で積まれ、処理の時点で 2 つ先が確定済みになっている場合に、粘着ピストンが引かないことを確かめる。
- 配置: 粘着ピストン S がブロックを押した直後 (同じ tick の相 e) に受電を切る。同じ tick の相 e で、S の収縮より**前**に処理される別のピストンの収縮が、S の 2 つ先の moving_piston を finalTick で確定させる配置を探す。
- 観測: S が縮んだ後、ブロックが引かれているか置かれているか。
- 期待: 置かれる (A=2 のため)。A=1 なら引かれるはずなので、差が出る。
- 備考: 配置が組めるかどうか自体が未確認。組めなければ「1 と 2 の差は通常の回路では出ない」と結論する。

### P6 /tick freeze 中の蓄積

- 目的: 凍結中に積んだイベントが、step の最初の tick にまとめて積んだ順で処理されることを確かめる。
- 配置: 独立したピストン 3 本とレバー 3 個。凍結してから順にレバーを倒し、/tick step 1 を実行する。
- 観測: step 後の 3 本の状態。順序は、互いに押し合う配置にして結果の違いで見る。
- 期待: 3 本とも step の 1 tick 目に伸長を始める。順序は倒した順。

### P7 相 g 由来の 1 tick 遅れ

- 目的: moving_piston の確定 (相 g) で積まれたイベントが次の tick の相 e になることを確かめる。
- 配置: ピストン A がレッドストーンブロックを押し、着地した先でピストン B に受電させる。
- 観測: レッドストーンブロックの着地の tick と、B の moving_piston が現れる tick。
- 期待: B は着地の次の tick。[実機 1.21.1: rblock-piston-chain] が既にこの形を測っている。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §3

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| キューは挿入順 FIFO + 重複排除。同じ (位置, ブロック, 種別, データ) は重複登録されない | 同じ | 正しい |
| 空になるまで先頭から回す。処理中に追加されたものも同じ tick | 同じ | 正しい |
| 非 ticking チャンクのイベントは退避して次 tick へ | 同じ | 正しい |
| 実行時に登録時のブロックと一致するかを見る | 同じ。比べるのはブロック種だけで、プロパティは見ない | 正しい。「処理は今の blockstate を読む」を補う |
| BED の層の説明 | 単一の FIFO と等価 | 正しい |
| 使用ブロックの列挙 (26.2) | 26.3 も同じ 10 クラス | 正しい |
| 「sim 実装分はピストンのみ」 | — | **古い**。今の TS は音符ブロックの発音も積む (packages/sim/src/world.ts の playNote) |
| (記述なし) /tick freeze で相が走らない・積む側は止まらない | §4.2 | 追記が要る |
| (記述なし) 保存されない・件数上限なし | §3.1 | 追記が要る |
| (記述なし) ピストンの種別が 0・1・2 の 3 つ、2 の条件に handlingTick が入る | §4.5 | 追記が要る |
| (記述なし) ComparatorBlock の受け口は死んだ経路 | §2.4 | 追記が要る |

§1.2 のフェーズ表 (8 番がブロックイベント、10 番が BlockEntity) は 26.3 と合っている。

### 9.2 docs/research/16_nucleation-comparison.md §2.1

| 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|
| redstone-sim は 1 件ずつ取り出し、常に重複排除が効く。26.2 の runBlockEvents と同じ形 | 同じ | 正しい |
| イベント連鎖の安全弁はどちらもバニラに無い | 上限は無い | 正しい |

食い違いは無い。

### 9.3 今の TS 実装 (packages/sim/src/world.ts・types.ts)

| 項目 | TS の今 | 26.3 | 影響 |
|---|---|---|---|
| イベントの種別 | 'extend'・'retract'・'play' の 3 値。B は持たない | A は 0・1・2、B は向き。等価は 4 成分 | **収縮の 1 と 2 を区別していない**。TS は処理の時点で「2 つ先が同じ向きの伸長中の moving_piston か」だけを見て、そうでなければ常に引こうとする。26.3 は A=2 なら引かない。差が出るのは §4.5 の末尾の狭い場面 (§8 P5 で要実機) |
| 重複排除のキー | (位置, ブロック種, 3 値の種別) | (位置, ブロック種, A, B) | 26.3 は (縮む 1) と (縮む 2) を別々に持てる。TS は 1 件に畳む。後の 1 件は 26.3 でも照合で落ちるので、結果の差は上の行と同じ場面に限られる |
| 重複の探し方 | 配列の線形探索 | ハッシュ集合 | 意味は同じ。件数が多いと遅い |
| 伸長の処理の入口 | 本体が既に extended なら何もしない | EXTENDED は調べない | 通常は届かない経路。差が出るかは [要実機] |
| 収縮の処理の入口 | 本体が extended でなければ何もしない | EXTENDED は調べない (§4.5) | 通常は届かない経路。差が出るかは [要実機] |
| 音符ブロックを積む条件 | 真上が空気のときだけ | 「INSTRUMENT が頭系」または「真上が空気」 | 頭を載せた音符ブロックは 26.3 では積まれる。TS は楽器を持たないので積まない。blockstate には出ない (発音と乱数だけ) |
| 収縮の取り消し | 受電していれば何も書かず失敗扱い | EXTENDED=真をフラグ 2 で書き直す | 既に真なら書き込みは変化なしなので同じ |
| 連鎖の上限 | 65,536 件を超えたら警告して残りを捨てる | 上限なし | バニラが無限ループする回路でだけ違う。捨てたことを呼び出し元へ返していない |
| 取り出しと照合 | 先頭から 1 件ずつ。ブロック種が違えば捨てる | 同じ | 一致 |
| 相の位置 | 予約 tick → ブロックイベント → BlockEntity | 同じ並び (間のランダム tick・エンティティは TS に無い) | 一致 |
| 積むときのブロック種 | 位置の今のブロックの種類を読む | 呼び出し元が渡す | 呼び出し元は自分自身を渡すので同じ |
| handlingTick | 持たない | 相 a〜e で真 | 上の「1 と 2」の判定に要る |
| 音符ブロックの処理 | 処理の時点の note を読み、コールバックへ流す。楽器は扱わない | 処理の時点の INSTRUMENT と NOTE を読む。乱数を 1 個引く | 時点は一致。乱数の消費は未実装 (→ 18) |
| ピストンの音の乱数 | 引かない | 成功した伸長・実行された収縮で float を 1 個 | 同上 |
| bell・potent_sulfur・shulker_box のイベント | 無い | 有る | 信号には効かない。シュルカーボックスの開閉による更新は未実装 |
| /tick freeze・範囲外の持ち越し | 無い | 有る | エンジンの対象外でよい |

判断: キューの骨格は TS が正しい。直すなら (1) 種別と B を整数のまま持つ、(2) handlingTick を持って A=2 を再現する、(3) 上限に当たったことを結果として返す、の 3 点である。(1)(2) は P5 の実機結果を見てから決めてよい。コードは本メモでは変えない。

---

## 10. 典拠一覧

- 26.3 ServerLevel#tick — フェーズ順。runsNormally のときだけブロックイベント相を呼ぶ。handlingTick の区間
- 26.3 ServerLevel#blockEvent — 4 成分を集合の末尾へ足す
- 26.3 ServerLevel#runBlockEvents — 先頭から取り出し・範囲外の退避・真のときの送信 (半径 64)・退避の戻し
- 26.3 ServerLevel#doBlockEvent — ブロック種の照合と triggerEvent の呼び出し
- 26.3 ServerLevel#clearBlockEvents — GameTest 専用の消去
- 26.3 ServerLevel#isHandlingTick・ServerLevel#shouldTickBlocksAt
- 26.3 BlockEventData — 4 成分 (pos・block・paramA・paramB) のレコード
- 26.3 Level#blockEvent — サーバ以外の即時実行
- 26.3 Level#tickBlockEntities — BlockEntity 相も runsNormally と範囲で絞る
- 26.3 TickRateManager#runsNormally
- 26.3 DistanceManager#inBlockTickingRange・ChunkLevel#isBlockTicking — レベル 32 以下
- 26.3 BlockBehaviour#triggerEvent・BlockBehaviour.BlockStateBase#triggerEvent — 既定は偽
- 26.3 BaseEntityBlock#triggerEvent・BlockEntity#triggerEvent
- 26.3 PistonBaseBlock#checkIfExtend・PistonBaseBlock#triggerEvent・PistonBaseBlock#getNeighborSignal
- 26.3 PistonMovingBlockEntity#getProgress・getLastTicked・isExtending・finalTick (名前のみ。中身は 13)
- 26.3 NoteBlock#neighborChanged・playNote・useWithoutItem・attack・triggerEvent・getPitchFromNote
- 26.3 NoteBlockInstrument#isTunable・hasCustomSound・worksAboveNoteBlock
- 26.3 ComparatorBlock#triggerEvent
- 26.3 PotentSulfurBlock#onPlace・triggerEvent、PotentSulfurBlockEntity の eruptionTick
- 26.3 BellBlock#neighborChanged・attemptToRing、BellBlockEntity#onHit・triggerEvent
- 26.3 ContainerOpenersCounter#incrementOpeners・decrementOpeners・recheckOpeners
- 26.3 ChestBlockEntity#signalOpenCount・triggerEvent、TrappedChestBlockEntity#signalOpenCount、EnderChestBlockEntity#triggerEvent
- 26.3 ChestBlock#getTicker・EnderChestBlock#getTicker — 蓋の tick はクライアントのみ
- 26.3 ShulkerBoxBlockEntity#startOpen・stopOpen・triggerEvent・updateAnimation、ShulkerBoxBlock#getTicker
- 26.3 DecoratedPotBlockEntity#wobble・triggerEvent、DecoratedPotBlock (wobble の呼び出し 2 箇所)
- 26.3 SpawnerBlockEntity (broadcastEvent の実装)・BaseSpawner#delay・onEventTriggered
- 26.3 TheEndGatewayBlockEntity#triggerCooldown・triggerEvent
- 26.3 Block の UPDATE_ で始まる定数 (1・2・4・16・64・256)
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の同名クラスを diff -u
