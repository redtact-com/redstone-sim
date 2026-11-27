# 02 予約 tick (LevelTicks)・優先度・件数上限・保存形式・各ブロックの予約表

Java 版 26.3 の予約 tick (scheduled tick。tile tick とも呼ぶ) の仕組みを、Rust エンジンで同じ順序を再現できる粒度で書く。
コードの写しではなく、読んで確かめた事実を自分の言葉で書く (docs/ip-policy.md)。

確かさの表記:

- [26.3 読解] 26.3 のコードを読んで確かめた
- [実機 1.21.1: 名前] tools/mc-harness/fixtures/ の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.2] [版差 26.4-pre-1] 版で違う

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 役割 |
|---|---|
| LevelTicks | ワールド全体の予約 tick の管理。チャンクごとの入れ物から 1 tick 分を集めて実行する |
| LevelChunkTicks | チャンク 1 個分の入れ物。優先度付きキューと重複抑止の集合を持つ |
| ScheduledTick | 予約 1 件 (種類・位置・発火 tick・優先度・予約順)。並び順の比較器 2 つと重複判定の規則を持つ |
| SavedTick | 保存用の予約 1 件 (種類・位置・残り遅延・優先度)。保存形式の定義 |
| TickPriority | 優先度の 7 値 |
| ProtoChunkTicks | 生成途中のチャンク用の入れ物 (遅延を持たない) |
| WorldGenTickAccess | ワールド生成中の窓口。チャンクの入れ物へ直接渡す |
| BlackholeTickAccess | 何もしない窓口 (クライアント側など) |
| LevelTickAccess / TickAccess / TickContainerAccess / SerializableTickContainer | 上の各クラスの interface |
| ScheduledTickAccess | scheduleTick の 4 つの入口 (ブロック用 2・流体用 2) |
| LevelAccessor | 予約 1 件を作る createTick (発火 tick と予約順を決める) |
| Level | 予約順のカウンター (nextSubTickCount) |
| ServerLevel | tick の中で 2 つのキューを回す所、tickBlock、tickFluid、チャンクの tick 開始時の展開 |
| ServerChunkCache / ChunkMap | 「このチャンクは tick してよいか」の判定、tick 開始の契機 |
| LevelChunk / ProtoChunk / ChunkAccess | チャンクが持つ 2 つの入れ物と、その登録・解除・保存用の取り出し |
| SerializableChunkData | チャンク NBT の block_ticks / fluid_ticks の読み書き |
| UpgradeData | 古いチャンクの変換時に積む予約 |
| BlockBehaviour (BlockStateBase#tick) | 予約 tick をブロックへ配送する入口 |
| FluidState / Fluid / FlowingFluid / WaterFluid / LavaFluid / EmptyFluid | 流体側の配送の入口と遅延値 |
| world/level/block/ 配下で scheduleTick・hasScheduledTick・willTickThisTick を呼ぶ全クラス | §4.9 の予約表の元 |

world/ticks/ にある ContainerSingleItem は予約 tick と無関係 (アイテム 1 個のコンテナの interface) なので扱わない。

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| tick 全体のフェーズ順・/tick freeze・ランダム tick・BlockEntity 相 | → 01_tick-loop.md |
| ブロックイベント (ピストン・音符ブロックなど) | → 03_block-events.md |
| setBlock のフラグ・近隣更新・形状更新 | → 04_set-block-and-updates.md |
| 各ブロックが tick を受けて何をするか | → 06〜17 の各メモ (§4.9 の表に参照先を書いた) |
| HashMap の反復順・乱数・整数の意味論 | → 18_determinism-java-semantics.md |
| 版差の全体表・既存 fixture の有効性 | → 19_version-diffs.md |

---

## 2. 全体像

### 2.1 一言で

- 予約は「どのブロック種 (または流体種) を・どの位置で・何 tick 目に・どの優先度で」の 4 つと、予約順の通し番号を持つ。
- 予約は**チャンクごとの入れ物**に入る。入れ物は (発火 tick, 優先度, 予約順) の昇順の優先度付きキューである。
- 毎 tick、期限の来た予約を**先に全部集めてから**順に実行する。実行中に積まれた予約は、遅延 0 でも同じ tick には走らない。
- 集める順は、チャンクをまたいで (優先度, 予約順) の昇順になるように各チャンクのキューの先頭を併合する。
- 同じ (位置, 種類) の予約は、入れ物に 1 件しか入らない。後から来た方を捨てる (先勝ち)。
- 実行時、その位置のブロックが予約した種類と違えば何もしない。
- ブロック用のキューを全部実行し終えてから、流体用のキューを集めて実行する。

### 2.2 予約から発火までの流れ

1. ブロックのコードが scheduleTick を呼ぶ (位置・種類・遅延・省略可能な優先度)。
2. LevelAccessor#createTick が予約 1 件を作る。発火 tick は「今のゲーム時刻 + 遅延」。優先度は省略時 NORMAL (0)。予約順は Level#nextSubTickCount が返す通し番号 (呼ぶたびに 1 増える)。
3. LevelTicks#schedule が位置からチャンクを求め、そのチャンクの LevelChunkTicks へ渡す。チャンクの入れ物が登録されていなければ捨てる。
4. LevelChunkTicks#schedule が (位置, 種類) の集合へ追加を試みる。既にあれば捨てる。無ければキューへ入れる。
5. 入れた予約がそのチャンクのキューの先頭になったら、LevelTicks が「このチャンクの次の発火 tick」の表を更新する。
6. 以後の tick で、ServerLevel#tick の予約 tick 相が LevelTicks#tick を呼ぶ。発火 tick が今の時刻以下の予約が集められ、実行される (§2.3)。
7. 実行は ServerLevel#tickBlock (流体は ServerLevel#tickFluid)。位置のブロックが予約の種類と同じなら、BlockStateBase#tick 経由でブロックの tick を呼ぶ。

### 2.3 1 tick の中の順 (予約 tick 相)

ServerLevel#tick の中で、ゲーム時刻を 1 進めた**後**に次を行う (前後のフェーズは → 01_tick-loop.md)。

1. 今のゲーム時刻 T を読む。
2. ブロック用の LevelTicks#tick を、時刻 T・上限 65536・配送先 tickBlock で呼ぶ。
   1. collect: 期限の来た予約を上限まで集める (§4.3)。
   2. run: 集めた順に 1 件ずつ実行する (§4.4)。
   3. cleanup: 作業用の列と集合を空にする。
3. 流体用の LevelTicks#tick を、同じ時刻 T・上限 65536・配送先 tickFluid で呼ぶ (手順は同じ)。

この相は「デバッグワールドでない」かつ「tick が通常進行中 (TickRateManager#runsNormally が真)」のときだけ走る。
/tick freeze 中は走らず、ゲーム時刻も進まないので、凍結で予約が期限切れになることはない [26.3 読解: ServerLevel#tick]。

ゲーム時刻を進めるのは、ServerLevel の tickTime フラグが真のディメンションだけである [26.3 読解: ServerLevel#tickTime]。
フラグが偽のディメンションは、時刻を進めたディメンションと同じ値を読む (ディメンション間の tick の順は → 01_tick-loop.md)。
ServerLevel#tickTime は時刻を進めた直後に /schedule の関数を実行する。そこで積まれた予約は、同じ tick の collect より前なので、遅延 0 なら同じ tick に走る (§5.1。→ 01_tick-loop.md)。

### 2.4 並び順の鍵

| 場面 | 鍵 (昇順) | 典拠 |
|---|---|---|
| チャンクの入れ物の中 | 発火 tick → 優先度 → 予約順 | ScheduledTick の DRAIN_ORDER |
| チャンク間の併合 (どのチャンクの先頭を先に取るか) | 優先度 → 予約順 (**発火 tick は見ない**) | ScheduledTick の INTRA_TICK_DRAIN_ORDER、LevelTicks の CONTAINER_DRAIN_ORDER |
| 保存時の並び | 予約順 | LevelChunkTicks の SUB_TICK_ORDERING |

優先度の比較は enum の宣言順で行う。宣言順は値の昇順と同じなので「値が小さいほど先」と読んでよい。

期限ちょうどの予約しか無い通常の場合、全チャンクを通して (優先度, 予約順) の昇順で実行される。
期限を過ぎた予約 (発火 tick < T) が混ざると、**同じチャンクの中では**それが優先度に関係なく先に出る。違いが出る条件は §5.4。

---

## 3. 状態とデータ

### 3.1 ScheduledTick (予約 1 件)

| 項目 | 型 | 意味 |
|---|---|---|
| type | Block または Fluid | 予約したブロック種・流体種。blockstate ではなく**種類**。比較は同一性 (同じ登録物か) |
| pos | 位置 | 作成時に不変の位置へ写す |
| triggerTick | 64 bit 整数 | 発火するゲーム時刻。作成時の「ゲーム時刻 + 遅延」 |
| priority | TickPriority | 省略時 NORMAL |
| subTickOrder | 64 bit 整数 | 予約順。Level ごとの通し番号。読み込んだ予約は負の値 (§4.7) |

重複判定の規則 (UNIQUE_TICK_HASH): **type が同一で pos が等しければ同じ**とみなす。発火 tick・優先度・予約順は見ない。

「探す用」の予約 (ScheduledTick#probe) は、発火 tick 0・NORMAL・予約順 0 で作る。上の規則のおかげで、集合の検索に使える。

### 3.2 TickPriority の全値

| 名前 | 値 | 26.3 で使うブロック |
|---|---|---|
| EXTREMELY_HIGH | -3 | リピーター (出力先が別のダイオードの側面・背面のとき) |
| VERY_HIGH | -2 | リピーター (今 ON で OFF にしたいとき。tick の中の自己 OFF 予約も) |
| HIGH | -1 | リピーター (上のどれでもないとき)、コンパレーター (出力先が別のダイオードの側面・背面のとき) |
| NORMAL | 0 | 既定。上記以外の全ブロックと全流体 |
| LOW | 1 | 使われていない |
| VERY_LOW | 2 | 使われていない |
| EXTREMELY_LOW | 3 | 使われていない |

- 26.3 で TickPriority を名指しするブロックは DiodeBlock と ComparatorBlock の 2 クラスだけ [26.3 読解: grep で全数確認]。
- TickPriority#byValue は、値が一致する名前を返す。一致が無いとき、-3 より小さければ EXTREMELY_HIGH、それ以外は EXTREMELY_LOW を返す (保存データの p が範囲外のときの丸め)。

### 3.3 LevelChunkTicks (チャンク 1 個分)

| 項目 | 中身 |
|---|---|
| tickQueue | java.util.PriorityQueue。比較は DRAIN_ORDER (発火 tick → 優先度 → 予約順) |
| ticksPerPosition | (位置, 種類) の集合。重複抑止と hasScheduledTick に使う |
| pendingTicks | 読み込んだまま未展開の SavedTick の列。展開済みなら null |
| onTickAdded | 予約が入ったときに LevelTicks へ知らせるコールバック。LevelTicks に登録されている間だけ設定される |

ブロック用と流体用で**別々の入れ物**を 1 チャンクが 2 つ持つ (LevelChunk の blockTicks / fluidTicks)。

### 3.4 LevelTicks (ワールド 1 個分。ブロック用と流体用で 1 つずつ)

| 項目 | 中身 |
|---|---|
| tickCheck | チャンクの位置キーを受けて「今 tick してよいか」を返す述語。ServerLevel#isPositionTickingWithEntitiesLoaded |
| allContainers | チャンク位置キー → LevelChunkTicks |
| nextTickForContainer | チャンク位置キー → そのチャンクの先頭の発火 tick。キーが無いときの既定値は long の最大値 |
| containersToTick | 今 tick 分を持つチャンクの優先度付きキュー。比較は「各チャンクの先頭どうしを (優先度, 予約順) で比べる」 |
| toRunThisTick | 今 tick に実行する予約の列 (先入れ先出し) |
| alreadyRunThisTick | 今 tick に実行し終えた予約の列 |
| toRunThisTickSet | toRunThisTick の内容を (位置, 種類) で引ける集合。**必要になったときだけ作る** |

### 3.5 定数

| 定数 | 値 | 場所 |
|---|---|---|
| 1 tick に集める予約の上限 | 65536 (ブロック用・流体用で別々に数える) | ServerLevel の MAX_SCHEDULED_TICKS_PER_TICK |
| 水の流体 tick の遅延 | 5 | WaterFluid#getTickDelay |
| 溶岩の流体 tick の遅延 | 30。ネザーなど「速い溶岩」のディメンションでは 10 | LavaFluid#getTickDelay |
| 空の流体の遅延 | 0 | EmptyFluid#getTickDelay |

### 3.6 予約順のカウンター

- Level が 64 bit のカウンターを 1 つ持つ。Level#nextSubTickCount は今の値を返してから 1 増やす。
- **ディメンションごとに 1 つ**。ブロック用と流体用で共有する。
- 保存されない。サーバーを起動するたびに 0 から始まる。
- createTick が呼ばれるたびに進む。**重複で捨てられる予約でも番号は消費する** (番号を取ってから入れ物に渡すため)。相対順には影響しない。
- ワールド生成用の WorldGenRegion は別のカウンターを持つが、ProtoChunkTicks は予約順を保存しないので意味を持たない。

---

## 4. 処理の詳細

### 4.1 scheduleTick の入口 (ScheduledTickAccess・LevelAccessor)

- 入口は 4 つ。ブロック用と流体用のそれぞれに「優先度あり」「優先度なし」がある。
- どれも「createTick で予約を作る → 対応する窓口 (getBlockTicks または getFluidTicks) の schedule に渡す」だけ。
- LevelAccessor#createTick:
  1. 発火 tick = Level のゲーム時刻 + 遅延 (遅延は int。負でも 0 でも通る)。
  2. 予約順 = nextSubTickCount の戻り値。
  3. 優先度なしの入口は NORMAL を入れる。
- ゲーム時刻は ServerLevel#tickTime が tick の頭で 1 進める。予約 tick 相も、その後の相 (ブロックイベント・エンティティ・BlockEntity) も、tick の外のプレイヤー入力の処理も、同じ時刻 T を見る。
  したがって「tick T のどの相で積んでも、遅延 d の予約は tick T+d の予約 tick 相で走る」。

| 積んだ場所 | 遅延 d の予約が走る tick |
|---|---|
| tick T の予約 tick 相 (別の予約の実行中) | T+d。ただし d ≤ 0 なら T+1 (§5.1) |
| tick T のブロックイベント相・エンティティ相・BlockEntity 相 | T+d。d ≤ 0 なら T+1 |
| tick T の処理が終わった後のプレイヤー入力 (次の tick の頭で時刻が T+1 になる前) | T+d。d ≤ 0 なら T+1 |

窓口の種類:

| 場面 | 窓口 | 動き |
|---|---|---|
| サーバーのワールド | LevelTicks | 本メモの本体 |
| ワールド生成中 (WorldGenRegion) | WorldGenTickAccess | 位置のチャンクの入れ物へ直接渡す。willTickThisTick は常に偽 |
| 生成途中のチャンク | ProtoChunkTicks | 遅延を 0 に潰して列に足す。(位置, 種類) の重複は捨てる |
| クライアントなど | BlackholeTickAccess | 何もしない。問い合わせは常に偽 |

### 4.2 LevelTicks#schedule と LevelChunkTicks#schedule (重複抑止)

1. LevelTicks#schedule は、予約の位置からチャンク位置キーを作り、allContainers を引く。
2. 入れ物が無ければ (チャンクが未読み込み)、IDE 実行時だけログを出して**捨てる**。例外にはならない。
3. 入れ物があれば LevelChunkTicks#schedule に渡す。
4. LevelChunkTicks#schedule は ticksPerPosition へ追加を試みる。
   - 同じ (位置, 種類) が既にある → **何もしない** (新しい方を捨てる。既存の発火 tick・優先度は変わらない)。
   - 無い → tickQueue に入れ、onTickAdded を呼ぶ。
5. LevelTicks 側のコールバックは、入った予約が tickQueue の先頭と等しいときだけ、nextTickForContainer のそのチャンクの値を新しい発火 tick に書き換える。

重複抑止の要点:

- 同じなら積まない条件は「位置が等しい」かつ「種類が同一」。**遅延・優先度が違っても積まない**。
- 集合から外れるのは、collect で取り出された時 (LevelChunkTicks#poll) と、範囲消去 (LevelChunkTicks#removeIf) の時だけ。**実行が終わった時ではない**。
- したがって「今 tick 分として取り出されたが、まだ実行されていない予約」と同じ (位置, 種類) の予約は、**新しく積める** (§4.5、§5.2)。
- ブロック用と流体用は入れ物が別なので、同じ位置にブロックの予約と流体の予約が 1 件ずつ共存できる (水を含んだブロックなど)。
- 未展開の pendingTicks も集合に入っている (§4.7)。展開前でも同じ (位置, 種類) は積めない。

### 4.3 collect: 1 tick 分を集める (LevelTicks#collectTicks)

3 段からなる。

**段 1: 対象チャンクの抽出 (LevelTicks#sortContainersToTick)**

nextTickForContainer の全項目を反復し、値 (先頭の発火 tick) が T 以下の項目について次を行う。

1. allContainers に入れ物が無ければ、項目を消す。
2. 入れ物の先頭が無ければ (空)、項目を消す。
3. 先頭の発火 tick が T より後なら、項目の値をその発火 tick に直す (表が古かった場合の補正)。
4. それ以外で、tickCheck がこのチャンクを通せば、項目を消して入れ物を containersToTick に入れる。
5. tickCheck が通さなければ何もしない (項目は残り、次の tick にまた調べる)。

tickCheck (ServerLevel#isPositionTickingWithEntitiesLoaded) は「そのチャンクのエンティティが読み込み済み」かつ「ServerChunkCache#isPositionTicking が真」。
後者は「ブロック tick の範囲内 (ServerLevel#shouldTickBlocksAt)」かつ「チャンクの tick 準備が完了済み」。

反復は fastutil のハッシュ表の順だが、結果は containersToTick (優先度付きキュー) に入るので、順はキューの比較で決まる。
比較が同点のときだけ反復順が効く (§5.5)。

**段 2: 併合しながら取り出す (LevelTicks#drainContainers・LevelTicks#drainFromCurrentContainer)**

「まだ集められる」= toRunThisTick の件数が上限 65536 未満、とする。

1. まだ集められる間、containersToTick から最良のチャンク (先頭の (優先度, 予約順) が最小) を取り出す。無ければ終わり。
2. そのチャンクの先頭を取り出し (ここで ticksPerPosition からも外れる)、toRunThisTick の末尾に足す。
3. 同じチャンクから続けて取り出す。「次点のチャンクの先頭」をこの時点で 1 回だけ読んでおき、次を繰り返す。
   1. まだ集められなければ止める。
   2. このチャンクの先頭が無い、または先頭の発火 tick が T より後なら止める。
   3. 次点の先頭があり、このチャンクの先頭が (優先度, 予約順) の比較でそれより**大きい**なら止める (等しいときは続ける)。
   4. 先頭を取り出して toRunThisTick に足す。
4. このチャンクに先頭が残っていれば、
   - その発火 tick が T 以下で、まだ集められるなら、チャンクを containersToTick に戻す (新しい先頭で並び直される)。
   - そうでなければ、nextTickForContainer にその先頭の発火 tick を書く。
5. 1 に戻る。

結果は「各チャンクのキュー (発火 tick → 優先度 → 予約順) の列を、先頭どうしの (優先度, 予約順) で比べて併合した列」になる。

**段 3: 残ったチャンクの後始末 (LevelTicks#rescheduleLeftoverContainers)**

上限に達して containersToTick に残ったチャンクは、それぞれの先頭の発火 tick を nextTickForContainer に書き戻す。
発火 tick は過去のままなので、次の tick の段 1 でまた対象になる。

**持ち越したチャンクを次の tick に集める順** [26.3 読解: LevelTicks#rescheduleLeftoverContainers・#sortContainersToTick・#cleanupAfterTick, LevelTicks の CONTAINER_DRAIN_ORDER, ScheduledTick の INTRA_TICK_DRAIN_ORDER]

- 持ち越しのための別の列は無い。残ったチャンクは表 (nextTickForContainer) へ書き戻されるだけで、候補のキュー (containersToTick) は tick の終わりに空にされる。
  次の tick では、持ち越したチャンクも新しく期限が来たチャンクも、同じ段 1 で表から拾われ、同じキューへ入る。持ち越したチャンクを先に回す扱いは無い。
- キューから出る順は、チャンクの先頭どうしの (優先度, 予約順) の比較だけで決まる。比較に同点が無ければ、キューへ入れた順 (= 表の反復順) は出る順に効かない。
  だから**候補をチャンクの座標の順に入れても、同点が無い限り実機と同じ列になる**。
- 同点になるのは、2 つのチャンクの先頭が同じ優先度で同じ予約順を持つ時だけである。起動後に積んだ予約は予約順が世界で一意なので、
  同点は読み込んだ予約 (負の予約順) どうしでしか起きない (§5.5)。読み込んだ予約を持たない世界では、持ち越しの有無に関係なく同点は起きない。
- 同点の時に実機の順を決めるのは、表の反復順 (→ 18 §4.3) と、二分ヒープへの投入と取り出しの形の 2 つである。
  同点を報告して止める今の形 (LOADED_ORDER_TIE) で足りる。再現が要るのは、読み込んだ予約の口を足す時である (§5.5 の項目と P13 のまま)。
- 持ち越しで順に効くのは、同点ではなく**期限切れ**の方である。持ち越した予約は発火 tick が過去になるので、同じチャンクの中では優先度に関係なく先に出る。
  チャンク間は (優先度, 予約順) のままである (§5.4)。持ち越したチャンクの先頭が後ろの予約を塞ぐ形も §5.4 のとおりに起きる。
- 段 2 の手順 4 で上限に当たったチャンクは、キューへ戻らずにその場で表へ書かれる。段 3 で書き戻されるのは、キューに残っていたチャンクである。
  どちらも表の値が「先頭の発火 tick」になるだけで、次の tick の扱いは同じである。

**件数上限と溢れた分**

- 上限は toRunThisTick の件数で数える。ブロック用と流体用は別の LevelTicks なので、**それぞれ 65536 件**。
- 溢れた予約は捨てられない。チャンクのキューに残り、発火 tick も変わらない。次の tick に「期限切れ」として集められる。
- 残った予約は ticksPerPosition にも残るので、hasScheduledTick は真のまま、同じ (位置, 種類) の新しい予約は捨てられる。
- 次の tick では、同じチャンクの中で期限切れが先に出る (発火 tick が小さい)。チャンク間は (優先度, 予約順) だけで比べる (§5.4)。

### 4.4 run: 集めた予約を実行する (LevelTicks#runCollectedTicks)

toRunThisTick が空になるまで次を繰り返す。

1. 先頭を取り出す。
2. toRunThisTickSet が空でなければ、そこからこの予約を外す。
3. alreadyRunThisTick の末尾に足す。
4. 配送先 (tickBlock または tickFluid) を位置と種類で呼ぶ。

要点:

- **集めてから実行する**。実行中に scheduleTick された予約は、チャンクの入れ物に入るだけで、toRunThisTick には入らない。遅延 0 でも負でも今 tick には走らない。
- 取り出して集合から外すのが配送の**前**。実行中のその予約自身は、willTickThisTick でも hasScheduledTick でも「無い」と見える。
- alreadyRunThisTick を使うのは範囲の複製・消去 (§4.8) だけ。

cleanup (LevelTicks#cleanupAfterTick) は toRunThisTick・containersToTick・alreadyRunThisTick・toRunThisTickSet を空にする。

### 4.5 hasScheduledTick と willTickThisTick

| 問い合わせ | 見る場所 | 真になる期間 |
|---|---|---|
| hasScheduledTick | そのチャンクの ticksPerPosition | 予約が入れ物に入ってから、collect で取り出されるまで。未展開の pendingTicks も含む |
| willTickThisTick | toRunThisTick (を集合にしたもの) | collect で取り出されてから、実行のために列から取り出されるまで。予約 tick 相の run の間だけ意味を持つ |

- 2 つは**重ならない**。ある予約は「入れ物にある (hasScheduledTick)」→「今 tick 分に入った (willTickThisTick)」→「実行中・実行済み (どちらも偽)」と移る。
- willTickThisTick は、ブロック用の run の間以外は常に偽になる (toRunThisTick が空のため)。
  ブロックイベント相・エンティティ相・プレイヤー入力から来た近隣更新では、willTickThisTick の条件は素通しになり、重複は §4.2 の先勝ちだけで抑止される。
- willTickThisTick は LevelTicks#calculateTickSetIfNeeded を先に呼ぶ。集合が空で列が空でなければ、列の全件を集合に入れる。
  一度作った後は、run の手順 2 が 1 件ずつ外していくので、集合は「まだ実行していない分」と一致し続ける。
- 流体用の LevelTicks にも同じ 2 つの問い合わせがあるが、26.3 のブロックは流体側へは問い合わせない。

呼ぶブロック (26.3、grep で全数):

| 問い合わせ | クラス#メソッド | 使い方 |
|---|---|---|
| willTickThisTick | RedstoneTorchBlock#neighborChanged | 偽のときだけ遅延 2 を予約 |
| willTickThisTick | DiodeBlock#checkTickOnNeighbor (リピーター) | 偽のときだけ予約 |
| willTickThisTick | ComparatorBlock#checkTickOnNeighbor | 偽のときだけ出力を計算し直して予約 |
| willTickThisTick | TestBlockEntity#trigger | 呼ぶが結果を使わない (副作用は集合の作成だけ) |
| hasScheduledTick | ObserverBlock#startSignal (updateShape から) | 偽のときだけ遅延 2 を予約 |
| hasScheduledTick | ObserverBlock#onPlace | POWERED で予約が無ければ、POWERED を偽に戻す (フラグ 18) |
| hasScheduledTick | ObserverBlock#affectNeighborsAfterRemoval | POWERED で予約があれば、消灯した状態として前方へ近隣更新 |
| hasScheduledTick | TripWireBlock#entityInside | 未 POWERED で予約が無いときだけ踏み判定 |
| hasScheduledTick | LightningRodBlock#onPlace | POWERED で予約が無ければ遅延 8 を予約 |
| hasScheduledTick | SculkSensorBlock#onPlace | POWER > 0 で予約が無ければ POWER を 0 に戻す (フラグ 18) |
| hasScheduledTick | TargetBlock#updateRedstoneOutput (被弾時) | 予約が無いときだけ出力を立てて予約 |
| hasScheduledTick | TargetBlock#onPlace | OUTPUT_POWER > 0 で予約が無ければ 0 に戻す (フラグ 18) |
| hasScheduledTick | SpeleothemBlock#updateShape | 下向きの先端で予約があれば、形状更新を打ち切る |
| hasScheduledTick | DriedGhastBlock#randomTick | 予約が無いときだけ遅延 5000 を予約 |

トーチ・リピーター・コンパレーターの「近隣更新 → willTickThisTick を見て予約」は実機で裏づけがある
[実機 1.21.1: torch-nc-own-tick] [実機 1.21.1: repeater-nc-own-tick] [実機 1.21.1: comparator-nc-own-tick]。
オブザーバーが「取り出し済みの予約を数えずにもう 1 本積む」ことも裏づけがある [実機 1.21.1: observer-4tick-clock]。

### 4.6 配送: ServerLevel#tickBlock・ServerLevel#tickFluid・BlockStateBase#tick

**tickBlock**

1. 位置の今の blockstate を読む。
2. そのブロックが予約の種類と同じなら、BlockStateBase#tick を呼ぶ (引数は ワールド・位置・ワールドの乱数)。
3. 違えば何もしない。予約は消費済みで、再予約もされない。

BlockStateBase#tick は、ブロックの tick に「今の blockstate」を添えて渡すだけ。
BlockBehaviour#tick の既定は空。予約表 (§4.9) にあるブロックがそれぞれ上書きする。

**tickFluid**

1. 位置の今の blockstate を読み、そこから流体の状態を得る。
2. 流体の種類が予約の種類と同じなら、FluidState#tick を呼ぶ (引数は ワールド・位置・今の blockstate)。Fluid#tick へ流体の状態を添えて渡す。
3. 違えば何もしない。

**発火時にブロックが変わっていた場合**

- 照合は**種類だけ**。blockstate のプロパティが変わっていても、同じブロック種なら tick は走る。tick は「今の状態」を受け取り、今の世界から動作を決める。
- 別のブロックに変わっていれば空振りする。予約したときの状態や意図は予約に残っていない。
- 一度別のブロックになり、発火までに**同じ種類のブロックが置き直されていれば走る** (古い予約が新しいブロックに当たる)。
- ピストンで動いたブロックの予約は元の位置に残る。移動先には付いていかない。元の位置に同じ種類が来ていれば、そのブロックに当たる。
- 水の「流れる水」と「水源」は Fluid として別の種類 (流れる方と源の 2 つがある)。流体の照合の詳細は → 16_fluids-falling-blocks.md。

### 4.7 保存と読み込み

**保存形式 (チャンク NBT)**

チャンク NBT の直下に 2 つの列がある。

| キー | 中身 |
|---|---|
| block_ticks | ブロックの予約の列 |
| fluid_ticks | 流体の予約の列 |

列の 1 件は次の 6 項目の複合タグ (SavedTick#codec)。

| キー | 型 | 意味 |
|---|---|---|
| i | 文字列 | ブロック (または流体) の ID。例 minecraft:repeater |
| x | int | 絶対座標 |
| y | int | 絶対座標 |
| z | int | 絶対座標 |
| t | int | 残り遅延。保存時の「発火 tick − ゲーム時刻」を int に切り詰めた値。期限切れなら 0 以下になる |
| p | int | 優先度の値 (-3〜3) |

予約順 (subTickOrder) は保存されない。**列の中の並びが予約順の代わり**になる。

**書き出し (LevelChunkTicks#pack)**

1. 未展開の pendingTicks があれば、そのまま先に並べる (残り遅延は読み込んだ時の値のまま)。
2. tickQueue の全件を**予約順の昇順**に並べ、1 件ずつ「発火 tick − 今のゲーム時刻」を残り遅延にして足す。

発火 tick でも優先度でも並べない。予約順だけで並べる。

**読み込み (SerializableChunkData)**

1. block_ticks と fluid_ticks を読む。キーが無ければ空の列。
2. 位置がそのチャンクに入らない予約を捨てる (SavedTick#filterTickListForChunk)。
3. 完成済みのチャンクなら、列をそのまま pendingTicks として LevelChunkTicks を作る。このとき全件の (位置, 種類) を ticksPerPosition に入れる。
4. 生成途中のチャンクなら ProtoChunkTicks に入れる (重複は捨てる)。完成時に列ごと LevelChunkTicks の pendingTicks へ移る。

p が範囲外のときは §3.2 の丸めが掛かる。i が未知の ID のときの扱い (その 1 件だけ落ちるか、列ごと落ちるか) は読解だけでは決めきれない [要実機]。シミュレーターには影響しない。

**展開 (LevelChunkTicks#unpack)**

チャンクが tick 可能になった時に 1 回だけ呼ばれる (ChunkMap#prepareTickingChunk → ServerLevel#startTickingChunk → LevelChunk#unpackTicks)。

1. pendingTicks の件数を n とする。
2. 列の先頭から順に、発火 tick = 「展開時のゲーム時刻 + t」、予約順 = −n, −n+1, …, −1 を割り当てて tickQueue に入れる。
3. このとき重複検査は**しない** (集合には読み込み時に入れてある)。列の中に同じ (位置, 種類) が 2 件あれば、2 件ともキューに入る。
   その場合、1 件目が取り出された時点で集合から (位置, 種類) が外れるので、2 件目がキューに残っていても hasScheduledTick は偽になる。
   26.3 の保存は重複の無い入れ物から書くので、手で編集した保存データでだけ起きる。
4. pendingTicks を null にする。

読み込み後の順の決まり方:

- 読み込んだ予約の予約順は負。サーバー起動後に積まれた予約 (0 以上) より必ず前になる。
- 同じチャンクの中では、列の並びがそのまま予約順になる。26.3 では書き出しが予約順なので、**保存前の相対順が保たれる**。
- 残り遅延は「展開時」から数え直す。チャンクが読み込まれても tick 可能になるまでは遅延が進まない。
- 別々のチャンクの予約は、どちらも −n から始まるので番号がぶつかりうる (§5.5)。

**登録と解除**

| 契機 | 処理 |
|---|---|
| チャンクが完成状態になった | LevelChunk#registerTickContainerInLevel。2 つの LevelTicks の addContainer を呼ぶ。入れ物に先頭があれば nextTickForContainer に書く |
| チャンクが tick 可能になった | LevelChunk#unpackTicks。pendingTicks を展開する |
| チャンクが外れる | LevelChunk#unregisterTickContainerFromLevel。removeContainer が allContainers と nextTickForContainer から消し、コールバックを外す |

完成済みだが tick 可能でないチャンク (読み込み範囲の縁) にも予約は積める。集める段で tickCheck に落とされ、期限切れのまま待つ。

登録と展開の間の細部 [26.3 読解: LevelTicks#addContainer・LevelChunkTicks#unpack]:

- 登録の時点では、読み込んだ予約は pendingTicks にあり tickQueue は空である。先頭が無いので nextTickForContainer には何も書かれない。
- 展開が 1 件ずつキューへ入れるたびに onTickAdded が呼ばれ、入れた予約が先頭になった時だけ nextTickForContainer が書かれる。登録が展開より先なので、これで表が揃う。
- 展開されるまで (tick 可能になるまで) の読み込み予約は、hasScheduledTick は真だが、集める対象にも保存時の「発火 tick − 時刻」の計算にも入らない。保存すれば読んだ時の t のまま書き戻る。

### 4.8 範囲の消去と複製 (通常のプレイでは使わない)

| メソッド | 呼ぶ所 | 動き |
|---|---|---|
| LevelTicks#clearArea | GameTest の構造物の片付け (ブロック用だけ) | 範囲内の予約を各チャンクのキュー・toRunThisTick・alreadyRunThisTick から消す |
| LevelTicks#copyAreaFrom | /clone (ブロック用だけ) | 範囲内の予約 (実行済み・今 tick 分・キュー内) を集め、位置をずらして積み直す |

- /clone の複製は、発火 tick と優先度を保つ。予約順は「元の予約順 − 集めた中の最小 + 集めた中の最大 + 1」に付け直す (元の相対順を保ったまま、元の全件より後ろに置く)。
- 付け直した番号は Level のカウンターと無関係なので、後から積まれる予約の番号とぶつかりうる。
- 流体の予約は /clone で複製されない。
- 普通の予約を 1 件だけ取り消す手段は無い。
- LevelTicks#clearArea は toRunThisTick から消すが、toRunThisTickSet からは消さない。run の途中で呼ばれると willTickThisTick が消した予約を「ある」と答えうる。cleanup で消えるので次の tick には残らない。
- LevelTicks#clearArea は、チャンクの先頭が変わった時だけ nextTickForContainer を直す (空になれば項目を消す)。

### 4.9 26.3 で scheduleTick を呼ぶ全ブロックの表

world/level/block/ (entity と piston を含む) と world/level/material/ を grep して作った。
scheduleTick の呼び出しは 133 箇所、問い合わせ (hasScheduledTick・willTickThisTick) は 14 箇所で、133 箇所の全件を表 A〜D に収めた。
ブロック以外 (ワールド生成・UpgradeData・/clone・GameTest) は表 E。
「優先度」が空欄の行は NORMAL (0)。「ガード」は予約の直前に見る問い合わせ (無印は先勝ちの重複抑止だけ)。

**A. レッドストーン部品 (ブロックの予約)**

| ブロック (クラス#メソッド) | 遅延 | 優先度 | 条件 | ガード | 参照 |
|---|---|---|---|---|---|
| リピーター (DiodeBlock#checkTickOnNeighbor) | DELAY×2 (2・4・6・8) | 出力先が別のダイオードの側面・背面なら -3。そうでなく今 ON なら -2。それ以外 -1 | ロックされていない。POWERED と「点くべきか」が食い違う | willTickThisTick が偽 | → 07 |
| リピーター (DiodeBlock#tick) | DELAY×2 | -2 固定 | tick で OFF → ON にした直後、入力がもう無い (自己 OFF の予約) | 無し | → 07 |
| コンパレーター (ComparatorBlock#checkTickOnNeighbor) | 2 | 出力先が別のダイオードの側面・背面なら -1。それ以外 0 | 計算した出力が BlockEntity の値と違う、または POWERED と「点くべきか」が食い違う | willTickThisTick が偽 (出力の計算より先に見る) | → 07 |
| リピーター・コンパレーター (DiodeBlock#setPlacedBy) | 1 | | 設置時に「点くべき」 | 無し | → 07 |
| レッドストーントーチ・壁トーチ (RedstoneTorchBlock#neighborChanged) | 2 | | LIT と「土台が信号を受けているか」が等しい (= 反転すべき) | willTickThisTick が偽 | → 08 |
| レッドストーントーチ (RedstoneTorchBlock#tick) | 160 | | 消灯した直後、切り替えが多すぎる (焼き切れ)。種類は「今その位置にあるブロック」 | 無し | → 08 |
| オブザーバー (ObserverBlock#startSignal。updateShape から) | 2 | | 正面からの形状更新で、POWERED が偽。サーバー側 | hasScheduledTick が偽 | → 08 |
| オブザーバー (ObserverBlock#tick) | 2 | | tick で POWERED を真にした直後 (消灯の予約)。前方への近隣更新より先に積む | 無し | → 08 |
| レッドストーンランプ (RedstoneLampBlock#neighborChanged) | 4 | | 点灯中で、信号が無くなった。点灯は予約せず即時 | 無し | → 11 |
| ディスペンサー・ドロッパー (DispenserBlock#neighborChanged) | 4 | | 自分か真上の位置が信号を受け、TRIGGERED が偽。予約してから TRIGGERED を真にする | 無し | → 12 |
| クラフター (CrafterBlock#neighborChanged) | 4 | | 信号を受け、TRIGGERED が偽。予約してから TRIGGERED を真にする | 無し | → 12 |
| クラフター (CrafterBlock#setPlacedBy) | 4 | | 設置時に TRIGGERED が真 | 無し | → 12 |
| ボタン (ButtonBlock#press) | 石系 20・木系 30 | | 押した・爆発で押された | 無し | → 09 |
| ボタン (ButtonBlock#checkPressed) | 石系 20・木系 30 | | 矢が刺さっている間 (tick と entityInside から) | 無し | → 09 |
| 感圧板 (BasePressurePlateBlock#checkPressed) | 20。重量感圧板は 10 | | 判定の結果、押されている | 無し | → 09 |
| トリップワイヤー (TripWireBlock#checkPressed) | 10 | | 判定の結果、踏まれている | entityInside 側が hasScheduledTick を見る | → 09 |
| トリップワイヤー (TripWireBlock#checkPressed) | 1 | | 踏まれていないが、直前まで POWERED だった | 同上 | → 09 |
| トリップワイヤーフック (TripWireHookBlock#calculateState) | 10 | | 糸の列を調べる途中、「更新元の糸」の番で必ず積む | 無し | → 09 |
| 書見台 (LecternBlock#signalPageChange) | 2 | | ページをめくった (POWERED を真にした後) | 無し | → 09 |
| ターゲット (TargetBlock#setOutputPower) | 矢・トライデントなら 20、それ以外の投射物は 8 | | 被弾した | hasScheduledTick が偽 | → 09 |
| 避雷針 (LightningRodBlock#onLightningStrike) | 8 | | 落雷 | 無し | → 09 |
| 避雷針 (LightningRodBlock#onPlace) | 8 | | 別のブロックから置き換わり、POWERED が真 | hasScheduledTick が偽 | → 09 |
| ディテクターレール (DetectorRailBlock#checkPressed) | 20 | | 判定の結果、トロッコが乗っている | 無し | → 15 |
| スカルクセンサー (SculkSensorBlock#activate) | 30。調律型は 10 | | 振動を受けて ACTIVE にした | 無し | → 10 |
| スカルクセンサー (SculkSensorBlock#deactivate) | 10 | | ACTIVE の tick で COOLDOWN にした | 無し | → 10 |
| スカルクシュリーカー (SculkShriekerBlockEntity#shriek) | 90 | | 叫び始めた | 無し | → 10 |
| スカルクカタリスト (SculkCatalystBlockEntity の bloom) | 8 | | PULSE を真にした | 無し | → 10 |
| チェスト・トラップチェスト・樽・エンダーチェスト (ContainerOpenersCounter の再確認) | 5 | | 開けた人数が 0 から増えた時、および tick での再確認で 1 人以上いる時 | 無し | → 14 |
| コンポスター (ComposterBlock#onPlace・ComposterBlock#addLayer) | 20 | | LEVEL が 7 になった | 無し | → 14 |
| 大釜 (PointedDripstoneBlock の滴下。種類は大釜のブロック) | 50 + 落下距離 | | 鍾乳石の下に満たせる大釜がある (ランダム tick 起点)。**他の位置のブロックを予約する例** | 無し | → 16 |
| 大きなドリップリーフ (BigDripleafBlock#setTiltAndScheduleTick) | UNSTABLE と PARTIAL は 10、FULL は 100 | | 傾きを変えた。NONE は予約しない | 無し | → 11 |
| コマンドブロック (CommandBlock#neighborChanged・CommandBlock#tick・CommandBlockEntity) | 1 | | 信号を受けた、または常時実行・自動モード | 無し | → 11 §4.13 |

**B. 落下・流体まわり (ブロックの予約)**

| ブロック (クラス#メソッド) | 遅延 | 条件 | 参照 |
|---|---|---|---|
| 落下ブロック全般 (FallingBlock#onPlace・FallingBlock#updateShape)。砂・砂利・金床・コンクリートパウダーなど | 2。ドラゴンの卵は 5 | 置かれた時と、形状更新を受けるたびに無条件 | → 16 |
| 怪しい砂・怪しい砂利 (BrushableBlock#onPlace・BrushableBlock#updateShape・BrushableBlockEntity) | 2 | 置かれた時・形状更新・ブラシ中 | → 16 |
| 足場 (ScaffoldingBlock#onPlace・ScaffoldingBlock#updateShape) | 1 | 置かれた時と形状更新 (サーバー側) | → 16 |
| 泡柱 (BubbleColumnBlock#updateShape) | 5 | 存続できない、下からの更新、または上が泡柱でなく泡柱を置ける | → 16 |
| 水などの液体ブロック (LiquidBlock の泡柱の確認) | 20 | 泡柱を置ける水源で、真下が泡柱を作るブロック (タグ ENABLES_BUBBLE_COLUMN_DRAG_DOWN・ENABLES_BUBBLE_COLUMN_PUSH_UP) | → 16 |
| 鍾乳石・硫黄のとげ (SpeleothemBlock#updateShape) | 下向きの先端は 2、それ以外は 1 | 根元側からの更新で存続できない | → 16 |
| 氷霜 (FrostedIceBlock) | 置かれた時 60〜120、以後 20〜40 (乱数。どちらも両端を含む) | 溶ける進行。tick で自分が溶け進んだ時は、自分には積み直さず、隣の氷霜のうち FrostedIceBlock#slightlyMelt が偽を返した**隣の位置**へ 20〜40 を積む (他の位置を予約する例) | 範囲外 |
| 火 (FireBlock#onPlace・FireBlock#tick) | 30〜39 (乱数) | 常に | → 11 付録 F.14 |

**C. 植物ほか (ブロックの予約。存続の確認が主)**

| ブロック | 遅延 | 条件 |
|---|---|---|
| サボテン・サトウキビ・竹・コーラスプラント・コーラスフラワー | 1 | 形状更新で存続できない |
| 伸びる植物の先端と胴 (GrowingPlantHeadBlock・GrowingPlantBodyBlock)。昆布・つた類 | 1 | 根元側からの更新で存続できない |
| 大きなドリップリーフの茎 (BigDripleafStemBlock) | 1 | 上下からの更新で存続できない |
| 垂れ下がる苔 (HangingMossBlock) | 1 | 存続できない |
| 耕地・土の道 (FarmlandBlock・PathBlock) | 1 | 上からの更新で存続できない |
| 葉 (LeavesBlock#updateShape) | 1 | 隣から求めた距離が 1 でない、または今の DISTANCE と違う |
| クリーキングの心臓 (CreakingHeartBlock#updateShape) | 1 | 形状更新のたびに無条件 |
| サンゴ類 (CoralBlock・BaseCoralPlantTypeBlock ほか) | 60〜99 (乱数) | 周りに水が無い。CoralBlock は形状更新のほか、設置する状態を決める時 (CoralBlock#getStateForPlacement) にも積む |
| スニッファーの卵 (SnifferEggBlock) | 4000 または 8000 に 0〜299 を足した値 | 置かれた時 |
| カエルの卵 (FrogspawnBlock) | 3600 以上 12000 未満 (乱数) | 置かれた時 |
| 乾いたガスト (DriedGhastBlock#randomTick) | 5000 | 水を含むか水分段階 > 0。hasScheduledTick が偽 |
| アイブロッサム (EyeblossomBlock) | 距離×5〜距離×10 (乱数) | 開閉が周囲の同じ花へ伝わる。**他の位置を予約する例** |

**D. 流体の予約**

| 呼ぶ所 | 種類 | 遅延 | 条件 |
|---|---|---|---|
| LiquidBlock#onPlace・LiquidBlock#neighborChanged | その位置の流体 | 流体の遅延 (水 5・溶岩 30 または 10) | 溶岩と水の反応で固まらなかった |
| LiquidBlock#updateShape | その位置の流体 | 流体の遅延 | 自分が水源、または更新元が水源 |
| FlowingFluid#tick | 新しい流体の種類 | FlowingFluid#getSpreadDelay の値 | 水源でない流体の水位が変わった (空にならない場合) |
| 水を含むブロックの updateShape (下の一覧) | 水 | 5 | WATERLOGGED が真なら、形状更新のたびに無条件 |
| SimpleWaterloggedBlock#placeLiquid・CampfireBlock・CandleBlock・DriedGhastBlock の同名メソッド | 置いた流体 | 流体の遅延 | 水を入れた |
| TrapDoorBlock (開閉時・近隣更新での開閉時) | 水 | 5 | WATERLOGGED が真 |
| BubbleColumnBlock#updateShape | 水 | 5 | 形状更新のたびに無条件 |

水を含むブロックの updateShape で水を予約するクラス (26.3):
BarrierBlock・ScaffoldingBlock・SpeleothemBlock・LeavesBlock・BigDripleafBlock・BigDripleafStemBlock・SmallDripleafBlock・BaseCoralWallFanBlock・CoralWallFanBlock・CoralFanBlock・CoralPlantBlock・BaseCoralPlantTypeBlock・SeaPickleBlock・SeagrassBlock・GrowingPlantHeadBlock・GrowingPlantBodyBlock・LanternBlock・WallBlock・FenceBlock・IronBarsBlock・ChainBlock・AmethystClusterBlock・SculkShriekerBlock・SculkSensorBlock・HangingRootsBlock・MangroveRootsBlock・MangrovePropaguleBlock・LadderBlock・BaseRailBlock・LightningRodBlock・SlabBlock・StairBlock・SignBlock・CampfireBlock・CandleBlock・HeavyCoreBlock・DriedGhastBlock・LightBlock・DecoratedPotBlock・TrapDoorBlock・ShelfBlock・CopperGolemStatueBlock・WaterloggedTransparentBlock・MultifaceBlock・ChestBlock・EnderChestBlock・ConduitBlock。

レッドストーンに効くのは、水を含んだレール・避雷針・スカルクセンサー・トラップドア・チェスト・ハーフブロック・階段などが、形状更新のたびに水の予約を試みる点である。
既に予約があれば先勝ちで捨てられる。流体の動きそのものは → 16_fluids-falling-blocks.md。

**E. ブロック以外から積む所**

| 呼ぶ所 | 内容 |
|---|---|
| UpgradeData#upgrade | 古いチャンクの変換で、隣のチャンクに掛かる予約を保存時の遅延・優先度で積む。種類が空気 (流体なら空) なら、今その位置にあるものの種類に置き換える |
| ワールド生成の各 Feature・構造物 (SpringFeature・LakeFeature・GeodeFeature・SimpleBlockFeature・StructurePiece・NetherFortressPieces) | 遅延 0 または 1。生成途中のチャンクでは遅延が 0 に潰れる |
| /clone | §4.8 |

**F. tick を受けるが、自分では予約しないクラス**

| クラス | 誰が予約するか |
|---|---|
| ChestBlock・BarrelBlock・EnderChestBlock | ContainerOpenersCounter (表 A) |
| AbstractCauldronBlock | PointedDripstoneBlock (表 A) |
| SculkShriekerBlock・SculkCatalystBlock | それぞれの BlockEntity (表 A) |
| TripWireHookBlock | TripWireHookBlock#calculateState (static。糸からも呼ばれる) |
| TestBlock | 26.3 では予約する所が見当たらない |

**G. 予約 tick を使わない主なレッドストーン部品 (確認済み)**

次のクラスは scheduleTick を呼ばず、tick も上書きしない (水の予約だけのものを含む):
RedstoneWireBlock (1.21.1 でのクラス名は RedStoneWireBlock)・LeverBlock・PoweredBlock・NoteBlock・TntBlock・DoorBlock・TrapDoorBlock・FenceGateBlock・BellBlock・CopperBulbBlock・HopperBlock・DaylightDetectorBlock・JukeboxBlock・PoweredRailBlock・RailBlock・ChiseledBookShelfBlock・ShulkerBoxBlock・SpongeBlock・PotentSulfurBlock、および piston パッケージの全クラス。
これらは近隣更新での即時反応・ブロックイベント・BlockEntity の tick のどれかで動く (→ 03・11・13・14・15)。

---

## 5. 端の場合と落とし穴

### 5.1 遅延 0・負の遅延

- 発火 tick が今の時刻以下の予約も、積んだ tick には走らない (集め終わっているため)。次の tick に「期限切れ」として集められる。
- ただし**例外が 2 つある**。どちらも「時刻が T になった後、該当のキューの collect より前」に積む場合である。
  1. ブロック用の run の最中に**流体の**予約を遅延 0 以下で積むと、同じ tick の流体用の collect がそれを拾う (流体用はブロック用の後に集めるため)。
     26.3 のブロックの流体予約は水 5・溶岩 30/10 なので、通常は起きない。
  2. ServerLevel#tickTime が時刻を進めた直後に走る /schedule の関数から積んだ遅延 0 以下の予約 (ブロック用・流体用とも)。予約 tick 相の直前なので同じ tick に拾われる。
     26.3 のブロックに遅延 0 の予約は無いので、通常のブロック設置では起きない。関数の実行の詳細は → 01_tick-loop.md [要実機]。
- 期限切れの予約は、同じチャンクの中で優先度に関係なく先頭に来る。遅延 1 の予約と同じ tick に走るが、順が変わりうる。
- 26.3 のレッドストーン部品に遅延 0 の予約は無い。26.2 のトリップワイヤーにはあった (§6)。

### 5.2 「同じ位置・同じ種類の予約は常に 1 件」ではない

- 入れ物の中では 1 件。だが collect で取り出された予約は集合から外れるので、その実行前に同じ (位置, 種類) を**もう 1 件積める**。
- willTickThisTick を見るブロック (トーチ・リピーター・コンパレーター) はこれを自分で防ぐ。
- hasScheduledTick しか見ないブロック (オブザーバーなど)、何も見ないブロック (ランプ・ディスペンサーなど) は、取り出し済みの予約があっても積む。
  オブザーバーが 2 連続でパルスを出す・向かい合わせで回り続けるのはこのため [実機 1.21.1: observer-4tick-clock]。
- 実行済みの予約も数えない。tick の中で自分の次の予約を積めるのはこのため (リピーターの自己 OFF・オブザーバーの消灯・トーチクロック [実機 1.21.1: torch-clock])。

### 5.3 先勝ちなので「予約し直し」はできない

- 遅延の短い予約・優先度の高い予約を後から積んでも捨てられる。既存の予約の発火 tick と優先度が残る。
- リピーターの優先度は**最初に積んだ時の条件**で決まる。予約中に出力先が変わっても優先度は変わらない。
- 予約は「何をするか」を持たない。発火時の世界から決める。予約時は ON にするつもりでも、発火時に入力が切れていれば別の動きになる (リピーターの「必ず 1 回は点く」は tick 側の規則。→ 07)。
- 取り消しも無い。ブロックを壊しても予約は残り、発火時の種類の照合で空振りする。

### 5.4 期限切れが混ざったときの順

期限切れ (発火 tick < T) が生じる条件:

| 条件 | 例 |
|---|---|
| 遅延 0 以下の予約 | §5.1 |
| チャンクが tick 可能でない間に期限が来た | 読み込み範囲の縁のチャンク |
| 上限 65536 を超えて持ち越した | §4.3 |
| 保存データの t が 0 以下 | 上の状態で保存されたチャンク |

順の決まり方:

1. 同じチャンクの中では、発火 tick の小さい方が先。優先度 -3 の期限ちょうどの予約より、優先度 0 の期限切れが先に出る。
2. チャンク間は先頭どうしを (優先度, 予約順) だけで比べる。発火 tick は見ない。
3. したがって、あるチャンクの先頭が「期限切れだが優先度 0」のとき、そのチャンクの後ろにある優先度 -3 の予約は、他チャンクの優先度 -1・-2 の予約より**後**に回りうる (先頭が塞ぐため)。

単一チャンクで期限切れが無ければ、(優先度, 予約順) の全順序と一致する。

### 5.5 予約順がぶつかる場合

- 起動後に積んだ予約どうしは、予約順が一意なので同点は起きない。
- 読み込んだ予約は各チャンクで −n から振るので、**別チャンクの読み込み予約どうしは同点になりうる** (優先度も同じ場合)。
- 同点のとき、§4.3 段 2 の手順 3-3 は「大きいときだけ止める」なので、今のチャンクから取り続ける。
  どちらのチャンクが先に選ばれるかは、containersToTick (二分ヒープ) への投入順 = nextTickForContainer の反復順に依存する [要実機] (→ 18_determinism-java-semantics.md)。
- 件数の多いチャンクほど小さい番号から始まるので、同点でない部分は「末尾から数えた位置が遠い方が先」になる。

### 5.6 種類の照合の粒度

- 照合は Block の同一性。床置きのレッドストーントーチと壁トーチは別のブロック (redstone_torch と redstone_wall_torch) で、予約も別物として扱われる。
- 石のボタンと木のボタン、各色のベッドなども別のブロック。
- リピーターの DELAY や FACING を変えても同じブロックなので、古い予約がそのまま当たる。
- scheduleTick に渡す種類は多くが「自分のクラスのブロック」だが、「今の状態のブロック」や「今その位置にあるブロック」を渡す所もある (トーチの焼き切れ・書見台・スカルクセンサー・ターゲットなど)。同じ位置を見ている限り結果は同じ。

### 5.7 よくある誤解

| 誤解 | 実際 |
|---|---|
| 並び順は常に (優先度, 予約順) | チャンクの中は発火 tick が最優先。チャンク間だけ (優先度, 予約順) |
| 流体の予約に優先度は無い | 形は同じで優先度を持つ。26.3 のコードが NORMAL しか渡さないだけ (UpgradeData は保存値を渡す) |
| 上限 65536 は全体で 1 つ | ブロック用と流体用で別々 |
| willTickThisTick は hasScheduledTick を含む | 含まない。重ならない別の期間を指す |
| 重複で捨てられた予約は番号を使わない | 番号は先に取るので使う (順には影響しない) |
| ブロックを壊せば予約は消える | 残る。同じ種類を置き直せば当たる |
| 保存した予約は優先度順に並ぶ | 26.3 は予約順だけで並べる。1.21.1 は並べない (§6) |

---

## 6. 版差

world/ticks/ の全ファイルと、ServerLevel・LevelAccessor・LevelChunk の該当箇所、ブロック側の全呼び出しを比べた。

### 6.1 仕組み (LevelTicks ほか)

| 項目 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| LevelTicks の collect・run・cleanup | 同じ | 同じ | 基準 | 同じ (ログ用の呼び出し先の名前だけ違う) |
| ScheduledTick の 2 つの比較器と重複規則 | 同じ | 同じ | 基準 | 同じ |
| TickPriority の 7 値と丸め | 同じ | 同じ | 基準 | 同じ |
| 上限 65536 (ブロック・流体で別) | 同じ | 同じ | 基準 | 同じ |
| ブロック用 → 流体用の順 | 同じ | 同じ | 基準 | 同じ |
| 予約 tick 相の条件 | デバッグワールドでなく通常進行中 | 同じ | 基準 | 通常進行中だけ (デバッグワールドの条件が消えた) |
| scheduleTick の入口の置き場所 | LevelAccessor | ScheduledTickAccess (別 interface) | 基準 | 同じ |
| tickFluid が流体へ渡すもの | ワールド・位置 | ワールド・位置・blockstate | 基準 | 同じ |
| **保存時の並び** | **tickQueue の内部配列の順 (二分ヒープの順。先頭だけ最小で、残りは予約順とは限らない)** | 予約順の昇順 | 基準 | 同じ |
| 保存の実装 | NBT を手で組む (キーは同じ i・x・y・z・t・p) | Codec | 基準 | 同じ |
| 未知の ID の予約 | その 1 件を飛ばす | Codec 任せ [要実機] | 基準 | 同じ |

**効く違いは保存時の並びだけ**である [版差 1.21.1]。
1.21.1 の LevelChunkTicks#save は tickQueue をそのまま反復して書く (並べ替えない)。26.2 以降の LevelChunkTicks#pack は予約順で並べてから書く [diff で確認]。
読み込み後の予約順は列の並びで振り直されるので、1.21.1 では、同じ発火 tick・同じ優先度の予約どうしの相対順が、保存 → 読み込みで入れ替わりうる。
入れ替わりうる条件は「そのチャンクのキューに予約が 3 件以上ある」こと。同点の予約が 2 件だけでも、別の予約が二分ヒープの根にいれば、2 件が左右の子に逆順で並びうる。
キューが 2 件以下なら、内部配列の順は取り出し順と一致するので入れ替わらない。
実機ハーネスは 1.21.1 の保存データから予約を読むので、1.21.1 の fixture では「読んだ列の並び」を予約順として信用できない (§9)。

### 6.2 ブロック側の予約 (レッドストーンに効くもの)

| ブロック | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| トリップワイヤー (踏まれなくなった時) | 予約しない | **遅延 0** を予約 | **遅延 1** を予約 | 26.3 と同じ |
| トリップワイヤー#entityInside の hasScheduledTick の確認 | 無い | ある | ある | ある |
| 避雷針#onPlace (POWERED で予約なし) | POWERED を偽に戻す (フラグ 18) | 遅延 8 を予約 | 26.2 と同じ | 同じ |
| マグマブロック・ソウルサンド | 置かれた時と、上が水になった時に遅延 20 (自分の tick で泡柱を更新) | 予約しない。水のブロック側が遅延 20 で泡柱を確認する | 26.2 と同じ | 同じ |
| 鍾乳石 | PointedDripstoneBlock が直接予約 (2 または 1) | SpeleothemBlock に共通化 (値は同じ) | 26.2 と同じ | 同じ |
| 氷霜 | 表 B の通り | 同じ | 基準 | 遅延の計算がメソッドに括り出され、BrittleIceBlock・CrackingIceBlock が加わる |
| リピーター・コンパレーター・トーチ・オブザーバー・ランプ・ディスペンサー・クラフター・ボタン・感圧板・ターゲット・書見台・ディテクターレール・スカルクセンサー | 遅延・優先度・ガードとも 26.3 と同じ | 同じ | 基準 | 同じ |

- 26.2 → 26.3 の差はトリップワイヤーの遅延 0 → 1 だけ [版差 26.2]。発火する tick は同じ (どちらも次の tick)。違うのは、26.2 では期限切れ扱いになり同じチャンクの中で先頭に出る点 (§5.4)。
- 1.21.1 のハーネスでトリップワイヤー・避雷針・泡柱を測った結果は、26.3 にそのまま当てはめられない [版差 1.21.1]。
- 各ブロックの tick の中身の版差は、それぞれのメモと → 19_version-diffs.md。

---

## 7. Rust で実装するときの要点

### 7.1 データ構造

予約 1 件:

| 項目 | 型の目安 | 備考 |
|---|---|---|
| kind | ブロック種の ID (u16 など) | blockstate ではなく種類。流体は別の ID 空間 |
| pos | 位置 | |
| trigger | i64 | |
| priority | i8 (-3〜3) | |
| sub | i64 | 読み込み分は負 |

入れ物は実機と同じ 2 層にするのが安全である。

- チャンクごと: (trigger, priority, sub) の昇順で先頭を取れる構造 (BinaryHeap に逆順の鍵、または BTreeSet) と、(pos, kind) の HashSet。
- ワールド: チャンク → 入れ物の表、今 tick 分の VecDeque、未実行分の (pos, kind) の HashSet。
- ブロック用と流体用で、この一式を 2 つ持つ。予約順のカウンターは 2 つで共有する。

チャンク間の併合に使うヒープの鍵は「各チャンクの先頭の (priority, sub)」。実機では、ヒープに入っている間のチャンクの先頭は変わらない (collect の間に予約は積まれず、先頭が変わるのはヒープから取り出したチャンクだけ)。
Rust でも、取り出したチャンクを戻す時に鍵を取り直せば足りる。

単一の全体キューに畳む場合は、鍵を (priority, sub) だけにしてはいけない。期限切れを正しく扱うには §4.3 の併合が要る。
畳んでよいのは「期限切れが絶対に生じない」と保証できるとき (単一チャンク扱い・遅延 0 以下なし・上限なし・seed の t が 1 以上) だけ。
実装量は小さいので、最初から併合を書く方がよい。

### 7.2 守る順序 (これを外すと実機とずれる)

1. 集合 (pos, kind) から外すのは**取り出し時**。実行後ではない。
2. 集め終えてから実行する。実行中の予約は今 tick 分に足さない。
3. 未実行分の集合から外すのは、配送の**直前**。
4. 配送時に種類を照合する。照合は blockstate ではなく種類。
5. ブロック用を全部実行してから、流体用を集める (流体用の collect はブロック用の run の後)。
6. 同じチャンクから連続して取る条件は「次点の先頭より大きくない」。同点は続ける。
7. 上限に達したら、残りは入れ物に置いたままにする (集合にも残す)。
8. 予約順のカウンターは、重複で捨てる場合も進める (観測できないが、状態の比較を楽にする)。

### 7.3 状態の持ち方

- 保存・復元 (スナップショット) には、予約ごとの sub か「sub 順に並べた列」と、カウンターの値を含める。26.3 の保存形式に合わせるなら、sub 順の列で足りる。
- 読み込みは「列の順に −n から振る」を再現する。実機 fixture の seed も同じ形にすると、実機の再読み込みと同じ順になる。
- 時刻は i64。保存時の残り遅延は i32 に切り詰める (実用上あふれない)。
- 乱数: tickBlock はワールドの乱数を渡す。予約表の乱数つき遅延 (火・氷霜・サンゴなど) を実装するなら乱数の消費順が効く (→ 18)。
- 「チャンクが tick 可能か」は、シミュレーターでは常に真でよい。縁のチャンクを再現するなら述語にする。

### 7.4 他のメモとの境界

| 相手 | 境界 |
|---|---|
| 01 | 予約 tick 相をいつ呼ぶか・時刻をいつ進めるか・凍結。本メモは相の中身だけ |
| 03 | ブロックイベントは別のキュー (重複規則も取り出し方も違う)。混ぜない |
| 04 | 予約を積むきっかけになる近隣更新・形状更新の順。本メモは積まれた後だけ |
| 06〜17 | tick を受けたブロックが何をするか。本メモの表 A〜D は「いつ・どの優先度で積むか」まで |
| 16 | 流体の種類の照合・水位・遅延の詳細 |
| 18 | 同点時の反復順・乱数 |

API の形の目安:

- 予約: 位置・種類・遅延・優先度を受ける。戻り値は不要 (実機も返さない)。
- 問い合わせ 2 つ: 入れ物にあるか・今 tick の未実行分にあるか。**別の関数にする** (合成しない)。
- tick: 時刻と上限と配送の関数を受ける。配送の関数は &mut World を取るので、今 tick 分の列は World から切り離して回す (借用の都合)。
  未実行分の集合は配送中に World から引けなければならないので、World 側に残す。

---

## 8. 検証用のプローブ回路案

実機 (26.3) で正解を撮るための小さな回路。既存 fixture で足りるものは名前を書いた。

| # | 目的 | 配置 | 観測 | 期待の要点 |
|---|---|---|---|---|
| P1 | 同じ優先度は予約順 | オブザーバーの出力をコンパレーターの背面で読む (既存) | ランプが点くか | 点かない (オブザーバーの消灯が先に走る) [実機 1.21.1: comparator-compare-front-nc] |
| P2 | willTickThisTick による抑止 | 既存の 3 本 | 素子の切り替わる tick | [実機 1.21.1: torch-nc-own-tick] [実機 1.21.1: repeater-nc-own-tick] [実機 1.21.1: comparator-nc-own-tick]。26.3 で撮り直す |
| P3 | 取り出し済みは hasScheduledTick に数えない | 向かい合うオブザーバー (既存) | 周期 | 4 tick 周期で回り続ける [実機 1.21.1: observer-4tick-clock]。26.3 で撮り直す |
| P4 | 先勝ち (遅延の短い予約は捨てられる) | 遅延 4 のリピーターに入力を入れ、1 tick 後に /setblock で DELAY を 1 に書き換える | 点く tick | 最初の予約 (入力から 8 tick 後) のまま。DELAY を変えても予約の発火 tick は動かない |
| P5 | 古い予約が置き直したブロックに当たる | リピーターに入力を入れて予約させ、発火前に /setblock で空気 → 同じ向きのリピーター (入力なしの状態) に置き直す | 置き直したリピーターが点く tick | 置き直しから数えた遅延ではなく、古い予約の tick に点く (置き直し後の予約は先勝ちで捨てられる) |
| P6 | 種類が違えば空振り | P5 と同じ手順で、置き直しをコンパレーターにする | コンパレーターの状態 | 何も起きない |
| P7 | 上限 65536 と持ち越し | 空中に砂を 70000 個以上、同じ tick に /fill で置く (1 回の /fill の上限はゲームルール。複数回に分けて function で同じ tick に流す) | 2 tick 後と 3 tick 後の falling_block の数、残った砂の数 | 2 tick 後に 65536 個だけ落ち始め、残りは 3 tick 後。残りの分は消えない |
| P8 | ブロック用 → 流体用の順 | 水源の横を砂で塞ぐ。砂の落下 tick と水の流体 tick が同じ tick に来るように、砂を置く 3 tick 前に水を置く | 水が流れ込む tick | 砂が落ち始めた同じ tick に流れ込む (ブロック用が先に空気にするため)。逆順なら 5 tick 遅れる |
| P9 | 保存時の並び = 予約順 | 同じチャンクに、同じ遅延・同じ優先度になる部品を 4 個以上、順を決めて起動する (例: 4 個のランプを 1 個ずつ別のレバーで同じ tick に消す。レバーは function で順に倒す) | /save-all flush 後の block_ticks の並び | 26.3 は起動順。1.21.1 は先頭以外が入れ替わることがある [版差 1.21.1] |
| P10 | チャンク間でも (優先度, 予約順) | チャンク境界をまたいで、順に依存する 2 素子 (P1 の形) を別チャンクに置く | P1 と同じ | 単一チャンクのときと同じ結果 |
| P11 | 期限切れは同じチャンクで先頭に出る | P7 の持ち越し中に、同じチャンクでリピーター (優先度 -3) を持ち越し分と同じ tick に発火させ、砂とリピーターの順に依存する配置にする | 順 | 持ち越しの砂 (優先度 0) がリピーターより先 [要実機] |
| P12 | トリップワイヤーの遅延 | 糸を踏ませて離す | 糸の POWERED が消える tick と、block_ticks の t | 26.3 は離れた判定の次の tick。1.21.1 と値が違うはず [版差 1.21.1] |
| P13 | 読み込み予約の同点 (別チャンク) | 2 つのチャンクに同数の同じ優先度の予約を残して保存 → 再起動 | 実行順 | どちらのチャンクが先か [要実機] (§5.5) |

P7 の「何 tick 後か」は、/fill を実行する場所 (function・コマンドブロック・プレイヤー入力) がゲーム時刻を進める前か後かで 1 ずれる (→ 01_tick-loop.md)。観測は「落ち始めた最初の tick」からの相対で読む。

P4〜P6 は /setblock を使うので、ハーネスの「途中で 1 ブロックだけ書き換える」操作で足りる。
P7・P11 は負荷が大きい。P7 だけ先に撮り、P11 は順序の議論が必要になった時でよい。

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §2

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §2.1 「priority 昇順 → 同 priority 内は予約順 (DRAIN_ORDER)」 | 鍵は (優先度, 予約順) | DRAIN_ORDER は (発火 tick, 優先度, 予約順) でチャンクの中の順。チャンク間の併合が (優先度, 予約順) | 26.3 が正。通常の場合は結果が同じ。期限切れの扱いを追記すべき (§2.4・§5.4) |
| §2.1 「液体ティックは priority なし・予約順のみ」 | 優先度が無い | 流体の予約も同じ形で優先度を持つ。26.3 のブロック側が NORMAL しか渡さないだけ | 結果は同じ。構造の説明としては 26.3 が正 |
| §2.1 「同 pos+block に予約は常に 1 件」 | 常に 1 件 | 入れ物の中は 1 件。取り出し済み・未実行の予約と、新しく積んだ予約の 2 件が同時に存在しうる (§5.2) | 26.3 が正。オブザーバーの二重パルスの説明と矛盾しない形に直すべき [実機 1.21.1: observer-4tick-clock] |
| §2.1 「実行中に新規スケジュールされた tick は (delay 0 でも) 同 tick では走らず」 | 例外なし | ブロック用の実行中に積んだ**流体**の遅延 0 の予約は同じ tick に走る。時刻を進めた直後の /schedule の関数から積んだ遅延 0 も同じ (§5.1) | 26.3 が正。実害は無い (26.3 にそういう予約は無い) |
| §2.1 「キャンセル API はなし」 | 無い | 範囲の消去は GameTest 用にだけある。/clone は複製する (§4.8) | 通常のプレイでは既存の記述で正しい |
| §2.2 の優先度表 | リピーター -3・-2・-1、コンパレーター -1・0、自己 OFF は -2 | 同じ。ほかに DiodeBlock#setPlacedBy の遅延 1・優先度 0 がある | 一致。設置時の予約を表に足すとよい |
| §2.3 件数上限 | ブロック・流体それぞれ 65536、超過分は持ち越し | 同じ。持ち越し分は hasScheduledTick が真のまま、という点が未記載 | 一致 |
| §2.3 「次 tick 以降に持ち越し (優先順は維持)」 | 持ち越しても順は変わらない | 持ち越した予約は期限切れになり、次の tick では同じチャンクの中で優先度に関係なく先に出る (§5.4)。チャンク間は (優先度, 予約順) のまま | 「維持」は不正確。26.3 が正 [要実機: P11] |
| §2.1 の版の表記 (1.21.11 で確認) | — | LevelTicks・ScheduledTick・TickPriority は 1.21.1・26.2・26.3・26.4-pre-1 で挙動の差が無い (§6.1) | 26.3 にもそのまま当てはまる |
| §2.4 パルスの飲み込み | 予約順でオブザーバーの消灯が先 | 同じ | 一致 |

### 9.2 docs/research/16_nucleation-comparison.md §2.1

| 行 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| 同じ tick の予約の並べ方 | Nucleation は (発火 tick, 優先度, 予約順)、redstone-sim は (優先度, 予約順)。「近い方」は Nucleation | チャンクの中は Nucleation の鍵、チャンク間は redstone-sim の鍵。どちらも片方だけ | 単一チャンクなら Nucleation が正。複数チャンクではどちらも不完全。併合を実装すれば両方満たす |
| 流体 tick | 別キュー・別フェーズが実機 | 同じ | 一致 |
| 予約の重複抑止キー・発火時の照合・willTickThisTick から外すタイミング | redstone-sim が実機と同じ | 同じ | 一致 |
| 1 tick の予約上限 | どちらも無し | 実機は 65536 | 一致 (どちらも未実装という記述として正しい) |
| 保存済みの予約 tick | redstone-sim は block_ticks から読む | fluid_ticks は読んでいない。列の順も保っていない (§9.4) | 追記すべき |

### 9.3 今の TS 実装 (packages/sim/src/world.ts)

| 箇所 | TS の動き | 26.3 の読み | 影響 |
|---|---|---|---|
| tick の並べ替え | 期限の来た予約を (優先度, 予約順) で並べる。発火 tick を見ない | チャンクの中は発火 tick が先 | 期限切れが混ざる時だけ違う。今は seed の遅延 0 と通常の遅延 1 が同じ tick に来る場合に限られる |
| チャンク | 概念が無い (全体で 1 列) | チャンクごとの列を併合 | 期限切れが無ければ同じ結果 |
| 流体の予約 | 水・泡柱の予約をブロックと同じ列に入れる | 流体は別のキューで、ブロック用の実行が全部終わってから集める | 同じ tick にブロックの予約と水の予約が重なると順が違う。水の予約より予約順が後のブロックの予約が、実機では先に走る |
| 流体の重複抑止 | ブロックと同じ集合 (種類 water など) | 入れ物が別。水を含むブロックは、ブロックの予約と水の予約を同時に持てる | 水を含む部品を扱う時に効く |
| seedScheduledTick の種類 | 今その位置にあるブロックの種類を使う (保存データの i を見ない) | 予約は i の種類を持ち、発火時に照合する | 位置のブロックと i が違う seed (古い予約が残った状態) を、TS は実行してしまう |
| seedScheduledTick の遅延 | 負の値を 0 に丸める | 負のまま発火 tick になり、同じチャンクの中で先に出る | 期限切れが 2 件以上ある seed で順が変わりうる |
| seedScheduledTick の予約順 | 呼ばれた順にカウンターを振る (0 以上) | 列の順に −n から振る | seed 後に積む予約より前、という関係は同じ。順は呼ぶ側の列の順に依存する (§9.4) |
| schedule の種類 | 常に「今その位置にあるブロック」 | 呼ぶ側が種類を渡す。大釜・アイブロッサムは別の位置の種類を渡す | 今の対象部品では同じ |
| willTickThisTick | 「今 tick の未実行分」または「入れ物にある」 | 「今 tick の未実行分」だけ | 予約のガードとして使う限り等価 (入れ物にあれば、どのみち先勝ちで捨てられる)。コメントの説明通り |
| hasScheduledTick のコメント | 「この tick に走る分も数える」と書いてある | 数えない | **コードは数えておらず実機と同じ**。コメントの冒頭だけが古い (同じファイルの willTickThisTick の説明と矛盾する) |
| 上限 65536 | 無い | ある | 通常の回路では届かない |
| runningThisTick の説明コメント | 「hasScheduledTick が見る」と書いてある | 見るのは willTickThisTick だけ | コードは willTickThisTick だけが見ており実機と同じ。コメントが古い |
| seedScheduledTick の重複 | 検査せずに積む | 展開 (LevelChunkTicks#unpack) も検査しない | 一致 |
| 予約順のカウンター | 重複で捨てた時は進めない | 進める | 観測できない |

### 9.4 tools/mc-harness/runner/scheduled-ticks.ts

| 箇所 | 今の動き | 26.3 の読み | 判断 |
|---|---|---|---|
| 並べ替え | 読んだ予約を (遅延, 優先度, x, y, z) で並べ直す | 26.3 の保存は予約順。列の順を保てば実機の再読み込みと同じ順になる | 26.3 に移る時は**列の順を保つ**べき (チャンクごとに、列の順のまま)。座標順は実機の順と関係が無い |
| 1.21.1 での並び | 同上 | 1.21.1 の保存は内部配列の順で、予約順ではない (§6.1) | 1.21.1 では正しい順を保存データから復元できない。今の座標順は「決定的だが実機と同じとは限らない」順。同じ遅延・同じ優先度の seed が複数ある fixture は、順に依存していないか確かめる価値がある [版差 1.21.1] |
| fluid_ticks | 読まない | 流体の予約は別の列にある | 水を扱う fixture では読む必要がある |
| コメント「0 は次の tick で発火」 | t = 0 の説明 | t = 1 も次の tick で発火する (読み込み後の最初の tick で時刻が 1 進むため)。t ≤ 0 は期限切れで、同じチャンクの中で先に出る | 説明を足すべき。値の扱い自体は正しい |
| 冒頭のコメント (SavedTick の 4 項目) | 種類・位置・遅延・優先度 | 同じ (キーは i・x・y・z・t・p) | 一致 |

### 9.5 まとめ

- 既存資料の骨子 (集めてから実行・先勝ち・種類の照合・優先度表・上限) は 26.3 と一致する。
- 足りないのは 4 点: チャンクの中の鍵に発火 tick が入ること、チャンク間の併合、流体用が別キューで後に回ること、保存時の並びの版差。
- TS 実装で実機と結果が変わりうるのは、流体の予約をブロックの列に混ぜている点と、seed の順・種類の扱い。

---

## 10. 典拠一覧

- 26.3 LevelTicks#addContainer
- 26.3 LevelTicks#removeContainer
- 26.3 LevelTicks#schedule
- 26.3 LevelTicks#tick
- 26.3 LevelTicks#collectTicks
- 26.3 LevelTicks#sortContainersToTick
- 26.3 LevelTicks#drainContainers
- 26.3 LevelTicks#drainFromCurrentContainer
- 26.3 LevelTicks#rescheduleLeftoverContainers
- 26.3 LevelTicks#updateContainerScheduling
- 26.3 LevelTicks#runCollectedTicks
- 26.3 LevelTicks#cleanupAfterTick
- 26.3 LevelTicks#hasScheduledTick
- 26.3 LevelTicks#willTickThisTick
- 26.3 LevelTicks#calculateTickSetIfNeeded
- 26.3 LevelTicks#clearArea
- 26.3 LevelTicks#copyAreaFrom
- 26.3 LevelChunkTicks#schedule
- 26.3 LevelChunkTicks#poll
- 26.3 LevelChunkTicks#peek
- 26.3 LevelChunkTicks#hasScheduledTick
- 26.3 LevelChunkTicks#removeIf
- 26.3 LevelChunkTicks#pack
- 26.3 LevelChunkTicks#unpack
- 26.3 LevelChunkTicks#count
- 26.3 LevelChunkTicks#scheduleUnchecked
- 26.3 CoralBlock#getStateForPlacement
- 26.3 ChunkStatusTasks (LevelChunk#registerTickContainerInLevel の呼び出し)
- 26.3 GameTestInfo (LevelTicks#clearArea の呼び出し)
- 26.3 ScheduledTick (DRAIN_ORDER・INTRA_TICK_DRAIN_ORDER・UNIQUE_TICK_HASH)
- 26.3 ScheduledTick#probe
- 26.3 ScheduledTick#toSavedTick
- 26.3 SavedTick#codec
- 26.3 SavedTick#unpack
- 26.3 SavedTick#filterTickListForChunk
- 26.3 TickPriority#byValue
- 26.3 ProtoChunkTicks#schedule
- 26.3 ProtoChunkTicks#load
- 26.3 WorldGenTickAccess#schedule
- 26.3 WorldGenTickAccess#willTickThisTick
- 26.3 BlackholeTickAccess#emptyLevelList
- 26.3 ScheduledTickAccess#scheduleTick
- 26.3 LevelAccessor#createTick
- 26.3 Level#nextSubTickCount
- 26.3 ServerLevel#tick
- 26.3 ServerLevel#tickTime
- 26.3 ServerLevel#tickBlock
- 26.3 ServerLevel#tickFluid
- 26.3 ServerLevel#startTickingChunk
- 26.3 ServerLevel#isPositionTickingWithEntitiesLoaded
- 26.3 ServerLevel#shouldTickBlocksAt
- 26.3 ServerChunkCache#isPositionTicking
- 26.3 ChunkMap#prepareTickingChunk
- 26.3 LevelChunk#unpackTicks
- 26.3 LevelChunk#registerTickContainerInLevel
- 26.3 LevelChunk#unregisterTickContainerFromLevel
- 26.3 LevelChunk#getTicksForSerialization
- 26.3 ProtoChunk#unpackBlockTicks
- 26.3 SerializableChunkData (block_ticks・fluid_ticks の読み書き)
- 26.3 UpgradeData#upgrade
- 26.3 CloneCommands (LevelTicks#copyAreaFrom の呼び出し)
- 26.3 BlockBehaviour#tick
- 26.3 BlockBehaviour.BlockStateBase#tick
- 26.3 FluidState#tick
- 26.3 Fluid#tick
- 26.3 FlowingFluid#tick
- 26.3 WaterFluid#getTickDelay
- 26.3 LavaFluid#getTickDelay
- 26.3 EmptyFluid#getTickDelay
- 26.3 DiodeBlock#checkTickOnNeighbor
- 26.3 DiodeBlock#tick
- 26.3 DiodeBlock#setPlacedBy
- 26.3 DiodeBlock#shouldPrioritize
- 26.3 RepeaterBlock#getDelay
- 26.3 ComparatorBlock#checkTickOnNeighbor
- 26.3 ComparatorBlock#getDelay
- 26.3 RedstoneTorchBlock#neighborChanged
- 26.3 RedstoneTorchBlock#tick
- 26.3 ObserverBlock#startSignal
- 26.3 ObserverBlock#tick
- 26.3 ObserverBlock#onPlace
- 26.3 ObserverBlock#affectNeighborsAfterRemoval
- 26.3 RedstoneLampBlock#neighborChanged
- 26.3 DispenserBlock#neighborChanged
- 26.3 CrafterBlock#neighborChanged
- 26.3 CrafterBlock#setPlacedBy
- 26.3 ButtonBlock#press
- 26.3 ButtonBlock#checkPressed
- 26.3 Blocks (各ボタンの押下時間 20・30)
- 26.3 BasePressurePlateBlock#checkPressed
- 26.3 BasePressurePlateBlock#getPressedTime
- 26.3 WeightedPressurePlateBlock#getPressedTime
- 26.3 TripWireBlock#checkPressed
- 26.3 TripWireBlock#entityInside
- 26.3 TripWireHookBlock#calculateState
- 26.3 LecternBlock#signalPageChange
- 26.3 TargetBlock#updateRedstoneOutput
- 26.3 TargetBlock#setOutputPower
- 26.3 TargetBlock#onPlace
- 26.3 LightningRodBlock#onLightningStrike
- 26.3 LightningRodBlock#onPlace
- 26.3 DetectorRailBlock#checkPressed
- 26.3 SculkSensorBlock#activate
- 26.3 SculkSensorBlock#deactivate
- 26.3 SculkSensorBlock#onPlace
- 26.3 SculkSensorBlock#getActiveTicks
- 26.3 CalibratedSculkSensorBlock#getActiveTicks
- 26.3 SculkShriekerBlockEntity#shriek
- 26.3 SculkCatalystBlockEntity (bloom)
- 26.3 ContainerOpenersCounter#incrementOpeners
- 26.3 ContainerOpenersCounter#recheckOpeners
- 26.3 ComposterBlock#onPlace
- 26.3 ComposterBlock#addLayer
- 26.3 PointedDripstoneBlock (大釜への滴下)
- 26.3 AbstractCauldronBlock#tick
- 26.3 BigDripleafBlock#setTiltAndScheduleTick
- 26.3 CommandBlock#neighborChanged
- 26.3 CommandBlock#tick
- 26.3 CommandBlockEntity#setAutomatic
- 26.3 CommandBlockEntity#onModeSwitch
- 26.3 TestBlockEntity#trigger
- 26.3 FallingBlock#onPlace
- 26.3 FallingBlock#updateShape
- 26.3 FallingBlock#getDelayAfterPlace
- 26.3 DragonEggBlock#getDelayAfterPlace
- 26.3 BrushableBlock#onPlace
- 26.3 BrushableBlock#updateShape
- 26.3 ScaffoldingBlock#onPlace
- 26.3 ScaffoldingBlock#updateShape
- 26.3 BubbleColumnBlock#updateShape
- 26.3 LiquidBlock#onPlace
- 26.3 LiquidBlock#updateShape
- 26.3 LiquidBlock#neighborChanged
- 26.3 LiquidBlock#tryScheduleBubbleBlockColumn
- 26.3 SpeleothemBlock#updateShape
- 26.3 FrostedIceBlock#onPlace
- 26.3 FrostedIceBlock#tick
- 26.3 FireBlock#onPlace
- 26.3 FireBlock#tick
- 26.3 SimpleWaterloggedBlock#placeLiquid
- 26.3 TrapDoorBlock (開閉時の水の予約)
- 26.3 LeavesBlock#updateShape
- 26.3 DriedGhastBlock#randomTick
- 26.3 EyeblossomBlock (周囲の花への伝播)
- 26.3 SnifferEggBlock#onPlace
- 26.3 FrogspawnBlock#onPlace
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の LevelTicks・LevelChunkTicks・ScheduledTick・SavedTick・TickPriority・ServerLevel・LevelAccessor・TripWireBlock・LightningRodBlock・MagmaBlock・SoulSandBlock・LiquidBlock・FrostedIceBlock
