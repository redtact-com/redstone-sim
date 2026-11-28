# 01. tick ループ・フェーズ順・/tick・ランダム tick・BlockEntity 相

Java 版 26.3 のサーバが 1 tick に何をどの順で回すかをまとめる。
Rust エンジンの最上位ループを組むための資料である。

確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: fixture 名] 既存の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.4-pre-1] 版で違う

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

| クラス | 読んだ所 |
|---|---|
| MinecraftServer | runServer・processPacketsAndTick・tickServer・tickChildren・waitUntilNextTick・pollTask・shouldRun・haveTime・createLevels 相当の初期化 |
| ServerLevel | tick・tickTime・tickChunk・tickThunder・tickPrecipitation・findLightningTargetAround・findLightningRod・advanceWeatherCycle・tickBlock・tickFluid・runBlockEvents・tickNonPassenger・tickPassenger・shouldTickBlocksAt・isPositionTickingWithEntitiesLoaded |
| Level | tickBlockEntities・addBlockEntityTicker・getBlockRandomPos・updateSkyBrightness・getOverworldClockTime・getDefaultClockTime・canHaveWeather |
| TickRateManager / ServerTickRateManager | tick・runsNormally・isEntityFrozen・stepGameIfPaused・requestGameToSprint・checkShouldSprintThisTick・finishTickSprint |
| ServerChunkCache | tick・tickChunks・tickSpawningChunk・broadcastChangedChunks・isPositionTicking・hasActiveTickets |
| ChunkMap / DistanceManager / ChunkLevel / TicketStorage / TicketType | forEachBlockTickingChunk・forEachEntityTickingChunk・inBlockTickingRange・inEntityTickingRange・collectSpawningChunks・shouldKeepDimensionActive |
| LevelChunk | setBlockState のうち BlockEntity に関わる所・addAndRegisterBlockEntity・updateBlockEntityTicker・removeBlockEntity・removeBlockEntityTicker・registerAllBlockEntitiesAfterLevelLoad・clearAllBlockEntities・内部クラス BoundTickingBlockEntity と RebindableTickingBlockEntityWrapper |
| LevelChunkSection | isRandomlyTicking と数え上げ |
| EntityTickList | add・remove・forEach |
| ServerGamePacketListenerImpl | tick・tickPlayer・handleUseItemOn・handlePlayerAction・handleChatCommand・tryHandleChat |
| PacketUtils / PacketProcessor | ensureRunningOnSameThread・scheduleIfPossible・processQueuedPackets |
| BlockableEventLoop | execute・pollTask・managedBlock・runAllTasks |
| ServerClockManager (内部クラス ServerClockInstance を含む) | tick・modifyClock |
| ServerFunctionManager / DedicatedServer / ServerPlayer / ServerPlayerGameMode | tick の入口だけ |
| DaylightDetectorBlock | tickEntity と updateSignalStrength (時刻の読み方だけ) |

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| 予約 tick の中身 (LevelTicks の収集・並べ方・上限・保存) | → 02_scheduled-ticks.md |
| ブロックイベントのキューと各イベント | → 03_block-events.md |
| setBlock のフラグ・近隣更新・形状更新 | → 04_set-block-and-updates.md |
| 日照センサーの出力の式・避雷針の通電 | → 09_manual-inputs.md |
| ランダム tick を受けた各ブロックの挙動 (作物などの成長・銅の酸化・redstone_ore ほか) | → 11_outputs.md 付録 F (成長)・11 §4.8 と 14_containers-hoppers-analog.md §4.12 (銅の酸化)・09_manual-inputs.md 付録 A (redstone_ore) |
| ホッパーなど個々の BlockEntity の tick の中身 | → 14_containers-hoppers-analog.md、07_diodes.md、13_pistons.md |
| エンティティの tick の中身 | → 17_entities-interplay.md |
| 乱数源・ハッシュ表の反復順 | → 18_determinism-java-semantics.md |

---

## 2. 全体像

### 2.1 サーバ 1 周の流れ

MinecraftServer#runServer のループ 1 周が 1 tick である。[26.3 読解]

| 順 | 区間 | 入口 | 何をするか |
|---|---|---|---|
| A | パケット処理 | MinecraftServer#processPacketsAndTick の冒頭 | PacketProcessor#processQueuedPackets。ネットワークスレッドが積んだプレイヤーのパケットを到着順に全部処理する。右クリック・設置・破壊はここで世界に入る |
| B | サーバ tick | MinecraftServer#tickServer | tickCount を 1 増やす。TickRateManager#tick で「この tick にゲーム要素を動かすか」を決める。続けて tickChildren |
| C | tick の合間 | MinecraftServer#waitUntilNextTick | サーバのタスクキューを消化して、次の tick の時刻まで待つ。チャットのコマンドと RCON のコマンドはここで実行される |

A → B → C を繰り返す。A と C はどちらも「ServerLevel#tick の外」である。
エンジンから見ると、tick N の全フェーズが終わってから tick N+1 が始まるまでの境界にあたる。

### 2.2 tickChildren の順 (区間 B の中身)

MinecraftServer#tickChildren は次の順で進む。[26.3 読解]

| 順 | 名前 (プロファイラの区画名) | 中身 | 凍結中 |
|---|---|---|---|
| B1 | commandFunctions | ServerFunctionManager#tick。データパックの load タグ (再読込の直後だけ) と tick タグの関数を実行 | 止まる |
| B2 | clocks | ServerClockManager#tick。ワールド時計 (昼夜) を進める | 止まる |
| B3 | timeSync | tickCount が 20 の倍数のとき、時刻の同期パケットを全員に送る | 動く |
| B4 | levels | 全ディメンションを順に ServerLevel#tick | 一部だけ動く (§2.4) |
| B5 | connection | 接続ごとの tick。ServerGamePacketListenerImpl#tick がプレイヤーの移動と物理を回す。専用サーバはこの直後にコンソール入力のコマンドを実行 | 動く |
| B6 | players | PlayerList#tick。600 tick ごとの遅延情報の送信だけ | 動く |
| B7 | debugSubscribers | デバッグ購読 | 動く |
| B8 | gameTests | GameTestTicker#tick | 止まる |
| B9 | server gui refresh | 登録済みの tickable | 動く |
| B10 | send chunks | プレイヤーへチャンクを送り、送信の保留を解く | 動く |

ディメンションの順は、サーバが持つ挿入順つきの表の順である。
最初に overworld を入れ、続けてディメンションのレジストリを走査して overworld 以外を入れる。
よって overworld が必ず最初になる。[26.3 読解: MinecraftServer の levels フィールドと初期化部]
バニラの定義では the_nether → the_end の順に並ぶはずだが、レジストリの走査順に依存する。[要実機]

### 2.3 ServerLevel#tick のフェーズ順 (B4 の中身。1 ディメンションぶん)

[26.3 読解: ServerLevel#tick]

| 相 | 名前 | 中身 | 凍結中 | レッドストーンへの関わり |
|---|---|---|---|---|
| L0 | (前処理) | handlingTick を真にする。環境属性の tick キャッシュを捨てる | 動く | handlingTick は PistonBaseBlock が読む (→ 13) |
| L1 | world border | WorldBorder#tick | 止まる | 無し |
| L2 | weather | ServerLevel#advanceWeatherCycle | 止まる | 雨・雷の状態。避雷針と雨検知に効く |
| L3 | (睡眠) | 寝ている人数が足りたら時計を朝へ動かし、全員を起こし、天候を晴れに戻す | 動く | 時計が飛ぶ |
| L4 | (空の明るさ) | Level#updateSkyBrightness。skyDarken を計算し直す | 動く | 日照センサーが読む |
| L5 | (ゲーム時刻) | ServerLevel#tickTime。gameTime を 1 増やし、/schedule の予約を実行 | 止まる | 予約 tick の基準時刻 |
| L6 | tickPending / blockTicks | ブロックの予約 tick。上限 65536 件 (→ 02) | 止まる | リピーター・トーチ・コンパレーター・オブザーバーほか |
| L7 | tickPending / fluidTicks | 流体の予約 tick。上限 65536 件 (→ 02、16) | 止まる | 水流・溶岩流 |
| L8 | raid | 襲撃 | 止まる | 無し |
| L9 | chunkSource | ServerChunkCache#tick。チケットの整理・スポーン・落雷・**ランダム tick**・変更の送信・チャンクの解放 | 一部 (§4.5) | ランダム tick・落雷 |
| L10 | blockEvents | ServerLevel#runBlockEvents (→ 03) | 止まる | ピストン・音符ブロックほか |
| L11 | (後処理) | handlingTick を偽にする。emptyTime の更新 | 動く | 無人のディメンションの停止判定 |
| L12 | entities | ドラゴン戦 → EntityTickList の全エンティティ | プレイヤーだけ動く | アイテム・トロッコ・TNT・落下ブロック (→ 17) |
| L13 | blockEntities | Level#tickBlockEntities | 掃除だけ動く | ホッパー・moving_piston・日照センサーほか |
| L14 | entityManagement | エンティティのセクション管理 (読み込みと解放) | 動く | 無し |
| L15 | debugSynchronizers | デバッグ用の同期 | 動く | 無し |

L12 と L13 は emptyTime が 300 未満のときだけ実行される (§4.6)。

エンジンが最低限持つべき相は L5・L6・L7・L9 のランダム tick・L10・L12・L13 である。
この順は 1.21.1・26.2・26.3・26.4-pre-1 で同じだった (§6)。

### 2.4 tick をまたぐ時系列 (入力の位相)

tick N と tick N+1 の間に起きることを時刻順に並べる。[26.3 読解]

1. tick N の B4 (全ディメンションの L0〜L15) が終わる。
2. tick N の B5。プレイヤーの移動と物理が進む。専用サーバのコンソール入力のコマンドが実行される。
3. tick N の区間 C。サーバのタスクキューを消化する。チャット欄のコマンドと RCON のコマンドはここで実行される。
4. tick N+1 の区間 A。プレイヤーのパケット (右クリック・設置・破壊) を到着順に処理する。
5. tick N+1 の B1。データパックの tick 関数。
6. tick N+1 の B2。時計が進む。
7. tick N+1 の B4。overworld の L5 で gameTime が N+1 になり、L6 以降が走る。

2〜5 で起きた setBlock は、近隣更新・形状更新をその場で最後まで配る (→ 04)。
そこで予約された tick は「その時点の gameTime (= N) + 遅延」で登録される。
gameTime は L5 で増えてから L6 で照合されるので、遅延 d の予約は tick N+d の L6 で発火する。
一方、tick N+1 の L6 の中で予約された遅延 d の予約は tick N+1+d で発火する。
つまり**入力由来の予約は、tick 内で生まれた予約より 1 tick 早く見える**。
既存資料の「入力で予約した tick は 1 tick 早く発火する」(docs/research/16 §2.1) はこの仕組みで説明できる。

**同じ境界の中の C と A の前後** [26.3 読解: MinecraftServer#runServer・#processPacketsAndTick・#waitUntilNextTick, PacketProcessor#processQueuedPackets・#scheduleIfPossible]

- tick N の B4 と tick N+1 の B4 の間 (1 つの境界) に入った入力は、上の 2〜5 の順で世界へ入る。**コマンド (区間 C) が先、プレイヤーの操作 (区間 A) が後**である。
- これは到着の順に依らない。プレイヤーのパケットは専用のキューに溜まるだけで、キューを空にするのは次の周の先頭 (区間 A) の 1 か所である。
  区間 C の待ちの間に届いた右クリックも、その待ちの中では処理されない。一方、タスクのコマンドは区間 C の待ちの間、届きしだい実行される (§4.1・§4.10)。
- 区間 C の中のコマンドどうしはタスクの登録順、区間 A の中の操作どうしはキューに入った順である。
- だから 26.3 の読みでは、同じ境界の入力を「C → A」の順に安定に並べる今の仮置きが正しい側である。
- 読みで決まらない物は 2 つ残る。どちらも既存の項目で、新しい項目は足さない。
  1. 実機での確認。RCON のコマンドと右クリックを同じ境界に入れる P14 (§8) と、チャットのコマンドの追い越しを見る P17 (§4.10 の末尾の項目) である。
  2. fixture の「同じ tick の入力」が、実機で同じ境界に入っていたか。これは採取の仕組みの側の事実で、ゲームのコードからは決まらない。
     1.21.1 で撮った fixture は、コマンドも操作もタスクで**到着順**だった (§6.2 の表)。1.21.1 の fixture に C → A の並べ替えを当てると、撮った時の順と変わりうる。
     同じ tick に別の区間の入力を持つ fixture は、26.3 で撮り直すまで inputs の並びのまま適用する方が、撮った時の順に近い。

---

## 3. 状態とデータ

### 3.1 サーバ全体が持つ値

| 値 | 持ち主 | 型・初期値 | 意味 |
|---|---|---|---|
| tickCount | MinecraftServer | int・0 | サーバ tick の通し番号。凍結中も増える。gameTime とは別物 |
| tickrate | TickRateManager | float・20.0。下限 1.0 | 1 秒あたりの tick 数。順序には効かない |
| nanosecondsPerTick | TickRateManager | long。1 秒 ÷ tickrate | 待ち時間の計算用 |
| isFrozen | TickRateManager | boolean・偽 | /tick freeze の状態 |
| frozenTicksToRun | TickRateManager | int・0 | /tick step の残り tick 数 |
| runGameElements | TickRateManager | boolean・真 | この tick にゲーム要素を動かすか。TickRateManager#tick が毎 tick 決める。runsNormally が返す値 |
| remainingSprintTicks | ServerTickRateManager | long・0 | /tick sprint の残り |
| scheduledCurrentSprintTicks | ServerTickRateManager | long・0 | sprint の依頼数。0 より大きい間が「sprint 中」 |
| previousIsFrozen | ServerTickRateManager | boolean | sprint 開始前の凍結状態。終了時に戻す |
| ワールド時計 | ServerClockManager | 時計ごとに totalTicks (long)・partialTick (float)・rate (float・1.0)・paused (boolean) | 昼夜。overworld と the_end の 2 つが登録されている |
| パケットのキュー | PacketProcessor | 並行キュー (FIFO) | ネットワークスレッド → サーバスレッドへの受け渡し |
| タスクキュー | BlockableEventLoop (MinecraftServer の親) | FIFO。各タスクに登録時の tickCount が付く | コマンド・チャンク処理ほか |

### 3.2 ディメンションごとに持つ値

| 値 | 持ち主 | 型 | 意味 |
|---|---|---|---|
| gameTime | レベルデータ (全ディメンション共有) | long | 予約 tick の基準時刻。overworld の L5 だけが増やす |
| tickTime フラグ | ServerLevel | boolean | overworld だけ真。偽のディメンションの ServerLevel#tickTime は何もしない |
| handlingTick | ServerLevel | boolean | L0 で真、L10 の後で偽 |
| emptyTime | ServerLevel | int | 有効なチケットが無い tick の連続数 |
| blockTicks / fluidTicks | ServerLevel | LevelTicks | 予約 tick (→ 02) |
| blockEvents | ServerLevel | 両端キュー | ブロックイベント (→ 03) |
| blockEntityTickers | Level | 配列リスト | BlockEntity の ticker。**追加順**に並ぶ |
| pendingBlockEntityTickers | Level | 配列リスト | L13 の実行中に追加された ticker の置き場 |
| tickingBlockEntities | Level | boolean | L13 の実行中だけ真 |
| entityTickList | ServerLevel | エンティティ ID → エンティティの挿入順つき表 | L12 の走査対象 |
| randValue | Level | int。起動時の乱数で初期化 | ランダム tick の位置を出す線形合同法の状態 |
| random | Level | 乱数源 (種は固定されない) | ランダム tick の中身・天候・落雷の抽選 (→ 18) |
| skyDarken | Level | int | 空の暗さ。L4 で更新 |
| rainLevel / thunderLevel と各 1 tick 前の値 | Level | float・0.0〜1.0 | 天候の強さ。L2 で毎 tick ±0.01 |
| 天候データ | WeatherData (**サーバ全体で 1 つ**。ServerLevel#getWeatherData はサーバのものを返す) | clearWeatherTime・rainTime・thunderTime (int)、raining・thundering (boolean) | 天候の残り時間と状態。天候を持てるディメンションが複数あると、各ディメンションの L2 が同じデータを 1 tick に 1 回ずつ進める。バニラの 3 ディメンションでは overworld だけが該当する |

### 3.3 チャンクごとに持つ値

| 値 | 持ち主 | 型 | 意味 |
|---|---|---|---|
| blockEntities | ChunkAccess | 位置 → BlockEntity のハッシュ表 | チャンク内の BlockEntity |
| tickersInLevel | LevelChunk | 位置 → ticker の包みのハッシュ表 | 位置ごとに 1 つの包み (RebindableTickingBlockEntityWrapper)。中身を差し替えられる |
| loaded | LevelChunk | boolean | 世界に組み込み済みか |
| tickingBlockCount / tickingFluidCount | LevelChunkSection | short | セクション内の「ランダム tick を受ける」ブロック数・流体数 |

### 3.4 定数

| 定数 | 値 | 所在 |
|---|---|---|
| 予約 tick の 1 tick あたり上限 | 65536 (ブロック・流体それぞれ) | ServerLevel#tick |
| random_tick_speed の既定値 | 3 (下限 0) | GameRules |
| 氷・雪の抽選 | 1 回の試行につき 48 分の 1 | ServerLevel#tickChunk |
| 落雷の抽選 | チャンクごと・tick ごとに 100000 分の 1 | ServerLevel#tickThunder |
| 避雷針の探索半径 | 128 | ServerLevel#findLightningRod |
| 落雷時の生物の探索 | 中心 (MOTION_BLOCKING の高さ) から最高高度 + 1 までの柱を、**全方向 (上下も) に 3** 広げた箱。空が見える生きた生物 | ServerLevel#findLightningTargetAround |
| スケルトントラップの確率 | 地域難易度 × 0.01 | ServerLevel#tickThunder |
| 雨の待ち時間 | 12000〜180000 tick の一様乱数 | ServerLevel の RAIN_DELAY |
| 雨の長さ | 12000〜24000 tick | ServerLevel の RAIN_DURATION |
| 雷の待ち時間 | 12000〜180000 tick | ServerLevel の THUNDER_DELAY |
| 雷の長さ | 3600〜15600 tick | ServerLevel の THUNDER_DURATION |
| 雨と判定する閾値 | rainLevel (float) が double の 0.2 を超える。天候を持てるディメンションであること | Level#isRaining・Level#getRainLevel |
| 雷と判定する閾値 | **thunderLevel × rainLevel** (float の積) が double の 0.9 を超える。thunderLevel 単独ではない | Level#isThundering・Level#getThunderLevel |
| 無人ディメンションの停止 | emptyTime が 300 以上 | ServerLevel#tick |
| 永続スポーンの周期 | gameTime が 400 の倍数 | ServerChunkCache#tickChunks |
| 時刻同期の周期 | tickCount が 20 の倍数 | MinecraftServer#tickChildren |
| 日照センサーの更新周期 | gameTime が 20 の倍数 | DaylightDetectorBlock#tickEntity |
| タスクの遅延上限 | 登録 tick + 3 が現在の tickCount より小さければ必ず実行 | MinecraftServer#shouldRun |
| チャンクレベル | 31 以下 = ENTITY_TICKING、32 = BLOCK_TICKING、33 = FULL | ChunkLevel |

---

## 4. 処理の詳細

### 4.1 MinecraftServer#runServer と区間 A・C

契機: サーバスレッドのメインループ。

1. sprint 中かを確かめる (§4.9)。sprint 中なら 1 tick の長さを 0 として扱う。
2. sprint 中でなければ遅れを調べ、遅れすぎなら警告を出して次回の時刻を進める。順序には効かない。
3. MinecraftServer#processPacketsAndTick を呼ぶ。
   1. PacketProcessor#processQueuedPackets。キューが空になるまで、先頭から 1 件ずつ処理する。処理中に届いたパケットも、空になるまで同じ回で処理される。[26.3 読解]
   2. MinecraftServer#tickServer。sprint 中は「時間の余裕なし」を固定で渡す。
4. MinecraftServer#waitUntilNextTick。
   1. タスクキューを、実行できるものが無くなるまで消化する。
   2. 次の tick の時刻になるまで、タスクを消化しながら待つ。

タスクが「実行できる」条件は MinecraftServer#shouldRun が決める。
登録時の tickCount + 3 が現在の tickCount より小さい、または時間の余裕がある、のどちらかである。
「時間の余裕」は MinecraftServer#haveTime で、現在時刻が次の tick の予定時刻より前であること。
余裕が無い周 (過負荷・sprint 中) では、タスクは「現在の tickCount が登録時の tickCount + 4 以上」になった周の区間 C まで待たされる。
区間 C で登録された RCON のコマンドなら最大 4 tick、区間 A の前に登録済みのチャットのコマンドなら最大 3 tick ぶん後ろへずれる。[26.3 読解]

**sprint 中のコマンド**: sprint の周は 1 tick の長さが 0 なので、常に「余裕なし」である。
/tick sprint の最中に送った RCON・チャットのコマンドは、sprint が終わるまで待つのではなく、登録から 4 tick 後の区間 C で実行される。
実機ハーネスで sprint の途中に setblock や data get を挟むと、狙った tick より後ろで適用される。
採取は「凍結 + step」で行い、sprint は空回しだけに使うこと。[26.3 読解: MinecraftServer#shouldRun・MinecraftServer#haveTime・MinecraftServer#runServer]

落とし穴: tick の途中でサーバスレッドが「待ち」に入ると、そこでタスクキューが回る。
BlockableEventLoop#managedBlock は待っている間じゅう全タスクを実行できる扱いにする。
同期のチャンク読み込みがその例である。
このとき、チャットや RCON のコマンドが tick の途中に割り込む余地がある。[要実機]
読み込み済みの範囲だけで動く回路では起きない。エンジンでは再現しなくてよい。

### 4.2 MinecraftServer#tickServer

契機: 区間 B。

1. 無人で一時停止する設定 (専用サーバの pause-when-empty-seconds) の判定。
   プレイヤーが 0 人で sprint 中でない tick を数え、閾値 (秒 × 20) に達したら、接続の tick だけ行って戻る。
   このとき tickCount は増えず、世界は一切進まない。[26.3 読解]
2. tickCount を 1 増やす。
3. TickRateManager#tick。
   1. runGameElements を「凍結していない、または frozenTicksToRun が 0 より大きい」にする。
   2. frozenTicksToRun が 0 より大きければ 1 減らす。
4. MinecraftServer#tickChildren (§2.2)。
5. 自動保存のカウントダウン。0 以下になったら保存する。順序には効かない。

以後、この tick の「凍結中かどうか」は runsNormally (= runGameElements) で一貫して判定される。
tick の途中で /tick freeze を実行しても、その tick の残りのフェーズは止まらない。
次の TickRateManager#tick で初めて反映される。[26.3 読解]

### 4.3 ServerLevel#tick の L0〜L5 (時刻と天候)

**L2 ServerLevel#advanceWeatherCycle** (凍結中は呼ばれない)

1. 天候を持てるディメンションかを確かめる。空の光があり、天井が無く、the_end でないこと (Level#canHaveWeather)。
2. ゲームルール advance_weather が真なら残り時間を進める。
   1. clearWeatherTime が 0 より大きい: 1 減らす。雷と雨を止める。thunderTime と rainTime は、止めた側を 0、止まっていた側を 1 にする。
   2. それ以外: thunderTime が 0 より大きければ 1 減らし、0 になったら雷の状態を反転する。0 以下なら、雷の最中は THUNDER_DURATION、そうでなければ THUNDER_DELAY から新しい値を引く。
   3. rainTime も同じ形で、RAIN_DURATION と RAIN_DELAY を使う。
3. thunderLevel を、雷なら +0.01、そうでなければ −0.01 して 0〜1 に丸める。rainLevel も同じ。
4. 変化があればパケットを送る。

雨と雷の判定には閾値がある (§3.4)。判定は次の形である。[26.3 読解: Level#isRaining・Level#isThundering・Level#getRainLevel・Level#getThunderLevel]

- 雨: rainLevel が 0.2 を超える。
- 雷: **thunderLevel と rainLevel の積**が 0.9 を超える。雨が弱い間は、thunderLevel が 1.0 でも雷にならない。
- どちらも float の値を double の定数と比べる。float の 0.2 は double の 0.2 よりわずかに大きく、float の 0.9 は double の 0.9 よりわずかに小さい。

float32 の加算を手元で再現して数えた結果 (L2 の実行回数。天候データが切り替わった後の最初の L2 を 1 回目とする):

| 場面 | 判定が変わる回 |
|---|---|
| 晴れ (両方 0.0) から雨が始まる | 雨が **20 回目**で真 |
| 雨が満ちた状態 (rainLevel 1.0) で雷が始まる | 雷が **91 回目**で真 |
| 晴れから雨と雷が同時に始まる (/weather thunder) | 雨が 20 回目、雷が **95 回目**で真 (0.95 × 0.95 が初めて 0.9 を超える) |
| 雷雨 (両方 1.0) から雨と雷が同時に止む | 雷が 6 回目で偽、雨が 81 回目で偽 |
| 雷雨から雷だけ止む | 雷が 11 回目で偽 |

計算は IEEE 754 の単精度で決まるので実機でも同じはずだが、/weather コマンドが天候データを書く位相 (区間 C) と最初の L2 の対応は実機で確かめる。[要実機]

天候データはサーバ全体で 1 つである (§3.2)。rainLevel と thunderLevel はディメンションごとに持つ。

乱数の消費: 残り時間が 0 以下の tick に、雷と雨でそれぞれ 1 回ずつ Level の random から引く。
この random はランダム tick と共有である (→ 18)。

**L3 睡眠** (凍結中も動く)

寝ている人数が条件を満たすと次を行う。

1. ゲームルール advance_time が真で、ディメンションに既定の時計があれば、その時計を「起床」の時刻標識へ動かす。
2. 全員を起こす。
3. advance_weather が真で雨なら、天候を晴れに戻す (rainTime・thunderTime を 0、状態を偽)。

**L4 Level#updateSkyBrightness** (凍結中も動く)

skyDarken を「15 − 環境属性 SKY_LIGHT_LEVEL のディメンション値」の整数部にする。
SKY_LIGHT_LEVEL は時計と天候から決まる。昼は 15、夜は 4 が基準値である (Timelines の定数)。

**L5 ServerLevel#tickTime** (凍結中は呼ばれない)

1. tickTime フラグが偽 (overworld 以外) なら何もしない。
2. gameTime を 1 増やす。
3. /schedule で予約された関数のうち、期限が来たものを実行する。

gameTime は全ディメンションで共有される。overworld が最初に tick されるので、
the_nether と the_end の L6 は、すでに 1 増えた gameTime を読む。[26.3 読解]

### 4.4 ゲーム時刻と日時

26.3 には時刻が 2 系統ある。[26.3 読解]

| 系統 | 進む場所 | 進む条件 | 用途 |
|---|---|---|---|
| gameTime | L5 (overworld の ServerLevel#tickTime) | 凍結していない | 予約 tick の期限・ピストンの lastTicked・日照センサーの 20 tick 周期・永続スポーンの周期 |
| ワールド時計の totalTicks | B2 (ServerClockManager#tick) | 凍結していない、かつゲームルール advance_time が真、かつその時計が paused でない | 昼夜。太陽の角度・空の明るさ |

ワールド時計の進み方 (ServerClockInstance#tick):

1. paused なら何もしない。
2. partialTick に rate を足す。
3. partialTick の整数部を totalTicks に足し、partialTick から引く。

rate の既定は 1.0 なので、通常は 1 tick に 1 進む。rate は /time で変えられる。

順序の要点:

- 時計は B2 で進む。gameTime は B4 の中の L5 で進む。**同じ tick の中で時計が先**である。
- /time set などの時計の書き換え (ServerClockManager#modifyClock) は、全ディメンションの環境属性の tick キャッシュをその場で捨てる。次に読む値は新しい時刻に基づく。

日照センサーが読む値 (式の詳細は → 09):

1. DaylightDetectorBlock#tickEntity は L13 で毎 tick 呼ばれ、gameTime が 20 の倍数の tick だけ出力を計算し直す。
2. 計算に使うのは「その位置の空の光 − skyDarken」(0 未満は 0) と、環境属性 SUN_ANGLE である。
3. skyDarken は同じ tick の L4 で更新済みである。L4 は L5 より前だが、時計は B2 で進んでいるので、時計の値は当 tick のものになる。
4. ticker は空の光があるディメンションでだけ登録される。

凍結中は gameTime も時計も止まるが、L4 は動く。
凍結中に /time set すると skyDarken は次の tick の L4 で変わる。
日照センサーの BlockEntity は tick されないので、出力は step するまで変わらない。[26.3 読解]

### 4.5 L9 ServerChunkCache#tick とランダム tick

**ServerChunkCache#tick の順**

1. 期限切れチケットの掃除。凍結中は行わない。
2. チケットの変更をチャンクのレベルへ反映する。
3. ServerChunkCache#tickChunks (下記)。
4. ChunkMap#tick。エンティティの追跡の更新。
5. チャンクの解放処理 (時間の余裕に応じる)。

**ServerChunkCache#tickChunks**

1. デバッグワールドなら何もしない。
2. 凍結していなければ、内側の tickChunks を呼ぶ (下記 3〜8)。
3. スポーンの集計を作る。ゲームルール spawn_mobs と random_tick_speed を読む。
4. 「スポーン候補チャンク」を集める (プレイヤーが近いチャンク)。それを Level の random でシャッフルする。
5. シャッフルした順に ServerChunkCache#tickSpawningChunk。
   1. 滞在時間を増やす。
   2. エンティティ tick の範囲内なら ServerLevel#tickThunder (落雷の抽選)。
   3. スポーンの対象があれば自然スポーン。
6. ChunkMap#forEachBlockTickingChunk で、各チャンクに ServerLevel#tickChunk (氷雪とランダム tick)。
7. spawn_mobs が真なら、カスタムスポーナー (ファントム・行商人ほか)。
8. 凍結の有無にかかわらず、変更のあったチャンクをプレイヤーへ送る。

6 の走査対象は、名前に反して**エンティティ tick の範囲 (レベル 31 以下)** のチャンクである。
ChunkMap#forEachBlockTickingChunk は DistanceManager#forEachEntityTickingChunk に委ねている。[26.3 読解]
走査順は、シミュレーション用のレベル表 (long → byte のオープンアドレス式ハッシュ表) の内部順である。
シャッフルはしない。挿入と削除の履歴で変わりうる (→ 18)。[26.3 読解]

**ServerLevel#tickChunk** (引数はチャンクと random_tick_speed の値。以下 S と書く)

1. 氷雪: S 回くり返す。毎回 random から 0〜47 を引き、0 ならチャンク内のランダムな柱で ServerLevel#tickPrecipitation。
2. S が 0 より大きければ、セクションを下から上へ (添字 0 から) 順に見る。
3. セクションが「ランダム tick を受けるブロックか流体を 1 つ以上含む」ときだけ、S 回くり返す。
   1. Level#getBlockRandomPos でセクション内の位置を 1 つ選ぶ。
   2. その位置のブロック状態を読む。
   3. そのブロックがランダム tick を受けるなら randomTick を呼ぶ。
   4. **手順 2 で読んだ状態から**流体の状態を取り、それがランダム tick を受けるなら流体の randomTick を呼ぶ。
      ブロックの randomTick が自分を書き換えていても、流体の判定は書き換え前の状態で行う。[26.3 読解]

S が 0 のとき、氷雪もランダム tick も一切起きない。乱数も消費しない。
ただし落雷の抽選 (tickThunder) は S に関係なく行われる。

**Level#getBlockRandomPos** (位置の選び方)

1. randValue を「randValue × 3 + 1013904223」に更新する。32 ビットの符号付き整数で、あふれは切り捨てる。
2. 更新後の randValue を算術右シフトで 2 ビットずらした値を v とする。
3. x の端数 = v の下位 4 ビット。
4. z の端数 = v を 8 ビット右へずらした下位 4 ビット。
5. y の端数 = v を 16 ビット右へずらした値と、引数のマスクとの AND。ランダム tick ではマスク 15、氷雪と落雷ではマスク 15 だが基準の y が 0 で、その後に高さマップで置き直される。

この線形合同法は Level の random とは**別の状態**である。
randValue の初期値は起動ごとに違う乱数である。再現はできない。[26.3 読解]
同じ位置が 1 tick に 2 回選ばれることもある (重複を除く処理は無い)。

確率の目安: 1 セクション 4096 マスから S 個を復元抽出する。
あるブロックが 1 tick に選ばれる確率は約 S ÷ 4096。既定の S = 3 で平均 68.27 秒に 1 回である。

**ランダム tick を受けるブロック (レッドストーンに関わるもの)**

網羅表の元データ (26.3 のフック一覧) で randomTick を実装するクラスのうち、回路に関わるのは次である。

| クラス | 影響 | 参照 |
|---|---|---|
| RedStoneOreBlock | 光っている鉱石が消える | → 09 付録 A |
| WeatheringCopperBulbBlock・WeatheringCopperDoorBlock・WeatheringCopperTrapDoorBlock・WeatheringLightningRodBlock・WeatheringCopperChestBlock ほか銅の系統 | 酸化の段階が進む (ブロック ID が変わる) | → 11、09、14 |
| LiquidBlock (流体側の randomTick) | 溶岩の着火 | → 16 |
| IceBlock・SnowLayerBlock | 融ける | → 16 |
| CactusBlock・SugarCaneBlock・BambooStalkBlock・CropBlock ほか作物 | 成長。オブザーバー式の収穫機の入力 | → 11 付録 F (成長の規則)・08 §4.2 (オブザーバー) |
| PointedDripstoneBlock | 大釜への滴下 | → 14 |
| FarmlandBlock・LeavesBlock・NetherPortalBlock ほか | 回路外 | 耕地の湿り気と葉の落葉は → 11 付録 F.13・F.10 |

**ServerLevel#tickThunder と避雷針**

1. 雨が降っていて、雷で、random の 0〜99999 が 0 のときだけ進む。
2. チャンク内のランダムな柱を Level#getBlockRandomPos で選ぶ。
3. ServerLevel#findLightningTargetAround で落下点を決める。
   1. 柱の最上部 (MOTION_BLOCKING の高さマップ) を中心にする。
   2. 半径 128 以内で最も近い避雷針を POI から探す。条件は「避雷針の y が、その柱の WORLD_SURFACE の高さ − 1 に等しい」(= 上に何も無い)。見つかればその 1 つ上を落下点にする。
   3. 無ければ、中心から最高高度 + 1 までの柱を全方向に 3 広げた箱の中で、空が見える生きた生物を集め、1 体以上いれば random で 1 体選ぶ (乱数を 1 回引く。0 体なら引かない)。その生物のいるブロック位置が落下点になる。
   4. どれも無ければ中心そのもの。ただし中心の y が「最低高度 − 1」(柱が空) のときは 2 上げる。
4. 落下点で雨が降っている判定 (Level#isRainingAt。雪や乾燥のバイオームでは偽) なら、次を行う。
   1. トラップの判定。「ゲームルール spawn_mobs が真」「random の小数が 地域難易度 × 0.01 未満」「落下点の真下が避雷針のタグでない」を左から順に見る。spawn_mobs が偽なら乱数は引かない。
   2. トラップならスケルトンホースを生成する。
   3. 雷のエンティティを生成する。トラップのときは見た目だけの雷 (着火も避雷針の通電もしない) になる。

雷エンティティが避雷針を通電させるのは、雷エンティティの tick の中である (→ 09、17)。
生成は L9 である。エンティティは、いるセクションが tick 可能なら追加の時点で EntityTickList へ入る (PersistentEntitySectionManager#addEntity → ServerLevel の EntityCallbacks#onTickingStart)。
L12 より前なので、最初の tick は同じ tick の L12 になる (§5 の 10)。[26.3 読解]
雷エンティティの何回目の tick で避雷針が通電するかは → 09。生成から通電までの tick 数は実機で確かめる。[要実機]

### 4.6 L11・L12 エンティティ相

**emptyTime**

1. L10 の後、ディメンションに「ディメンションを起こしておく種類のチケット」があれば emptyTime を 0 にする。
   該当するチケットの種類は player_simulation・forced・portal・ender_pearl である (TicketType のフラグ 8 を持つもの)。
2. 凍結していなければ emptyTime を 1 増やす。
3. emptyTime が 300 未満のときだけ L12 と L13 を実行する。

プレイヤーも強制読み込みも無いディメンションでは、300 tick 後にエンティティと BlockEntity が止まる。
予約 tick (L6) とブロックイベント (L10) はこの判定の外にある。[26.3 読解]

**エンティティの走査** (ServerLevel#tick の L12)

1. ドラゴン戦があり、凍結していなければ進める。
2. EntityTickList#forEach で全エンティティを順に見る。順は**エンティティ ID の挿入順** (世界に加わった順) である。
3. 各エンティティについて次を行う。
   1. 除去済みなら飛ばす。
   2. TickRateManager#isEntityFrozen が真なら飛ばす。真になるのは「凍結中で、プレイヤーでなく、プレイヤーを乗せてもいない」とき。
   3. デスポーンの判定。
   4. プレイヤーであるか、エンティティ tick の範囲内のチャンクにいるときだけ先へ進む。
   5. 乗り物に乗っている場合。乗り物が除去済みでなく、乗り物の側も自分を乗員として持っていれば、乗り物の側から tick されるので飛ばす。そうでなければ (乗り物が消えた・関係が壊れた) 降ろしてから先へ進む。
   6. ServerLevel#tickNonPassenger。共通の前処理 → 本体の tick → 乗員を再帰的に tick。

走査中に追加・削除されたエンティティは、EntityTickList が表の複製を作って受ける。
走査中の表は変わらないので、**その tick に追加されたエンティティは次の tick から tick される**。
走査中に除去されたエンティティは、順番が来たときに除去済みとして飛ばされる。[26.3 読解]

プレイヤーの扱い:

- ServerPlayer#tick は L12 で呼ばれる。採掘の進行 (ServerPlayerGameMode#tick) と、開いているコンテナの同期がここで起きる。
- プレイヤーの移動と物理 (ServerPlayer#doTick) は L12 ではなく B5 で呼ばれる。全ディメンションの tick が終わった後である。
- どちらも凍結中に動く。

### 4.7 L13 Level#tickBlockEntities

契機: L12 の直後。emptyTime が 300 未満のとき。

1. tickingBlockEntities を真にする。
2. pendingBlockEntityTickers が空でなければ、全部を blockEntityTickers の**末尾へ**足して、空にする。
3. 「凍結していないか」を 1 回だけ読む。
4. blockEntityTickers を先頭から順に見る。
   1. ticker が除去済みなら、リストから取り除く。
   2. そうでなく、凍結しておらず、その位置がブロック tick の範囲 (レベル 32 以下) なら tick する。
5. tickingBlockEntities を偽にする。

**ticker の tick の中身** (LevelChunk の内部クラス BoundTickingBlockEntity)

1. BlockEntity が除去済みでなく、レベルを持つこと。
2. LevelChunk#isTicking が真であること。条件は「位置がワールドボーダーの内側」「チャンクの状態が BLOCK_TICKING 以上」「そのチャンクのエンティティが読み込み済み」。
3. その位置の現在のブロック状態を読む。BlockEntity の種類がその状態に対して有効なら、ブロックごとの tick 関数を呼ぶ。渡すのは「いま読んだ状態」である。BlockEntity が覚えている状態ではない。
4. 有効でなければ警告を 1 回だけ出して何もしない。

**ticker の登録** (LevelChunk#updateBlockEntityTicker)

契機は 3 つある。

| 契機 | 入口 |
|---|---|
| BlockEntity を持つブロックを置いた | LevelChunk#setBlockState → LevelChunk#addAndRegisterBlockEntity |
| 同じブロックのまま状態だけ変わった | LevelChunk#setBlockState → BlockEntity の状態を更新 → LevelChunk#updateBlockEntityTicker |
| チャンクが世界に組み込まれた | LevelChunk#registerAllBlockEntitiesAfterLevelLoad |

手順:

1. BlockEntity が覚えている状態から、ブロックの getTicker で tick 関数を得る。
2. 得られなければ (null)、その位置の ticker を外す。
3. 得られたら、その位置の包みを tickersInLevel で引く。
   1. 包みが既にあれば、**中身だけを差し替える**。リスト上の位置は変わらない。
   2. 包みが無く、チャンクが世界に組み込み済みなら、新しい包みを作り Level#addBlockEntityTicker で登録する。
4. Level#addBlockEntityTicker は、L13 の実行中なら pendingBlockEntityTickers へ、そうでなければ blockEntityTickers の末尾へ足す。

**ticker の削除** (LevelChunk#removeBlockEntity → LevelChunk#removeBlockEntityTicker)

1. チャンクの表から BlockEntity を外し、除去済みの印を付ける。振動リスナーも外す。
2. tickersInLevel からその位置の包みを外し、中身を「何もしない・除去済み」の ticker に差し替える。
3. リストからの実際の除去は、次に L13 がその包みに到達したときに起きる。

**順序についての帰結** [26.3 読解]

| 場面 | 結果 |
|---|---|
| L13 より前の相 (L6・L10・L12、区間 A・C) で BlockEntity を置いた | リストの末尾に入り、**同じ tick の L13 で tick される** |
| L13 の実行中に BlockEntity を置いた | pending に入り、**次の tick の L13 の冒頭**で末尾に足される。その tick から tick される |
| 同じ位置で、同じブロックの状態だけが変わった | 包みは同じ。順番は変わらない。tick 関数は付け替わる (例: getTicker が状態で変わるブロック) |
| 同じ位置で、別のブロックへ置き換えた (両方 BlockEntity 持ち) | 古い包みは無効になり、新しい包みが末尾に入る。**順番は最後尾へ移る** |
| 別のブロックへ置き換えたが、新しいブロックが「BlockEntity を引き継ぐ」と答えた (BlockBehaviour#shouldChangedStateKeepBlockEntity が真。26.3 では CopperChestBlock と CopperGolemStatueBlock の酸化・錆止めだけ) | BlockEntity は除去されない。包みも同じで、**順番は変わらない** |
| 既に BlockEntity がある位置へ、Level#setBlockEntity で別の BlockEntity を上書きした (ブロックは同じ) | 古い BlockEntity に除去済みの印が付く。包みは位置で引くので同じものが使われ、中身だけ新しい BlockEntity へ差し替わる。**順番は変わらない** (LevelChunk#setBlockEntity → LevelChunk#updateBlockEntityTicker) |
| 置いた BlockEntity の種類が、その位置の状態に対して無効だった | 警告を出して除去し、作り直す。新しい包みが末尾に入る |
| L13 の実行中に、まだ順番が来ていない BlockEntity が除去された | 順番が来たとき除去済みと判定され、tick されずにリストから消える |
| L13 の実行中に、自分より前の BlockEntity が除去された | その包みは次の tick の L13 でリストから消える |
| チャンクを読み込んだ | そのチャンクの BlockEntity が**ハッシュ表の値の反復順**で登録される。位置のハッシュと表の大きさで決まり、設置順ではない (→ 18) |
| チャンクを解放した | 全 BlockEntity に除去済みの印を付け、全包みを無効にする |

「登録順 = 設置順」が成り立つのは、世界が動いている間に置かれた BlockEntity どうしだけである。
保存して読み直した世界では、チャンク内の順はハッシュ表の順に変わる。
チャンクどうしの順は、チャンクが FULL になった順である。[要実機]

**moving_piston の例**

ピストンが L10 のブロックイベントで伸びると、moving_piston の BlockEntity がその場で作られる。
moving_piston はブロックを置いただけでは BlockEntity を作らない。ピストンの側が続けて Level#setBlockEntity で登録する (→ 13)。登録の経路は LevelChunk#addAndRegisterBlockEntity で、他のブロックと同じである。
L10 は L13 より前なので、末尾に登録され、同じ tick の L13 で 1 回目の tick を受ける。
既存のホッパーなどは moving_piston より前に並んでいる。
よって同じ tick では「既存の BlockEntity → 新しい moving_piston」の順になる。[26.3 読解]
中身は → 13。

### 4.8 /tick freeze と step

**凍結の状態遷移**

| 操作 | 効果 (ServerTickRateManager) |
|---|---|
| /tick freeze | sprint 中なら先に止める。isFrozen を真にする。step 中だった場合は残りの step を捨てる (TickCommand) |
| /tick unfreeze | isFrozen を偽にする |
| /tick step N | 凍結中のときだけ受け付け、frozenTicksToRun を N にする。凍結していなければ失敗 |
| /tick step stop | frozenTicksToRun を 0 にする |

runGameElements は次の TickRateManager#tick で初めて変わる (§4.2)。
/tick step N のあと、**次の tick から数えてちょうど N tick** が通常どおり走る。[26.3 読解]

**凍結中の 1 tick に動くもの・止まるもの**

| 区分 | 動く | 止まる |
|---|---|---|
| サーバ | 区間 A のパケット処理・tickCount の加算・時刻同期・接続の tick・コンソール入力・区間 C のタスク | データパックの tick 関数・ワールド時計・GameTest |
| ディメンション | 環境属性キャッシュの破棄・睡眠の判定・skyDarken の更新・チケット反映・変更チャンクの送信・エンティティ追跡・チャンク解放・エンティティ管理 | world border・天候・gameTime・/schedule・予約 tick (ブロックと流体)・襲撃・期限切れチケットの掃除・スポーン・落雷・氷雪・ランダム tick・ブロックイベント・emptyTime の加算・ドラゴン戦 |
| エンティティ | プレイヤー、プレイヤーを乗せたエンティティ | それ以外の全エンティティ (アイテム・トロッコ・TNT・落下ブロック・投射物) |
| BlockEntity | pending の合流・除去済みの掃除 | 全 BlockEntity の tick |

**凍結中でもその場で起きること**

凍結はフェーズを止めるだけである。同期的な処理は止まらない。[26.3 読解]

- プレイヤーの右クリック・設置・破壊は区間 A で処理される。
- コマンドによる setblock・fill も実行される。
- それらの setBlock が出す近隣更新・形状更新・コンパレーター更新は、その場で最後まで配られる。
  ダストの信号強度・ランプの点灯判定の入口・ドアの開閉など、予約 tick を介さない変化は**凍結中に即座に起きる**。
- 予約 tick は「現在の gameTime + 遅延」で登録され、キューに溜まる。gameTime は進まない。
- ブロックイベントもキューに溜まる。ピストンは凍結中には動き出さない。
- プレイヤーが感圧板を踏む判定はプレイヤーの移動に伴うので、凍結中も起きうる。
  プレイヤー以外のエンティティによる検知は起きない (→ 17)。

実機ハーネスは「凍結 → 入力 → step」の順で採取している。
この手順だと入力は必ず tick の境界に入り、§2.4 の位相と一致する。

### 4.9 /tick sprint

1. ServerTickRateManager#requestGameToSprint。残り tick 数を設定し、開始前の凍結状態を覚えて、凍結を解く。
2. MinecraftServer#runServer は毎周 ServerTickRateManager#checkShouldSprintThisTick を呼ぶ。
   1. runGameElements が偽なら、sprint としては進めない (通常の長さの tick になる)。
   2. 残りが 0 より大きければ 1 減らし、この周を sprint (待ち時間 0) にする。
   3. 残りが 0 なら sprint を終える。結果を報告し、凍結状態を開始前に戻す。
3. sprint の tick は、フェーズ順も中身も通常の tick と同じである。違いは待ち時間と、チャンク解放に時間の余裕を与えないことだけ。

落とし穴: 凍結中に /tick sprint N を実行した場合を読むと、次のようになる。

1. 依頼の時点で runGameElements は偽である。
2. 次の周の checkShouldSprintThisTick は偽を返し、残りは減らない。
3. その周の TickRateManager#tick は、凍結が解かれているので runGameElements を真にする。この tick は通常どおり全フェーズが走る。
4. 以後 N 周が sprint として走る。

読みのとおりなら、凍結中からの sprint N は合計 N+1 tick 進む。[要実機]
実機で正解を撮る手順に sprint を使うなら、進んだ tick 数を gameTime で確かめること。

### 4.10 プレイヤーの操作が世界に入る位相

**パケットの受け渡し** (PacketUtils#ensureRunningOnSameThread)

1. ネットワークスレッドでハンドラが呼ばれる。
2. サーバスレッドでなければ、PacketProcessor#scheduleIfPossible でキューに積み、例外で処理を打ち切る。
3. 次の区間 A で、サーバスレッドが同じハンドラをもう一度呼ぶ。今度は本処理へ進む。

**操作ごとの位相** [26.3 読解]

| 操作 | 入口 | 位相 |
|---|---|---|
| ブロックへの右クリック (レバー・ボタン・リピーターの遅延変更・コンテナを開く・ブロックの設置) | ServerGamePacketListenerImpl#handleUseItemOn → ServerPlayerGameMode#useItemOn。設置の手順は → 04 §4.13 | 区間 A |
| 破壊の開始・中断・完了 (クリエイティブの即破壊を含む) | ServerGamePacketListenerImpl#handlePlayerAction → ServerPlayerGameMode#handleBlockBreakAction。破壊の手順は → 04 §4.14 | 区間 A |
| サバイバルで、完了のパケットが早すぎた破壊の後追い | ServerPlayerGameMode#tick (ServerPlayer#tick から) | L12 |
| コンテナ内のクリック (アイテムの出し入れ) | ServerGamePacketListenerImpl#handleContainerClick | 区間 A |
| チャット欄のコマンド | ServerGamePacketListenerImpl#handleChatCommand → tryHandleChat がサーバのタスクとして登録。**このハンドラは専用キューへ回さない**。ネットワークスレッドが到着の時点でタスクを積む | 到着後の最初の区間 C (tick の実行中に届けば、その tick の区間 C) |
| RCON のコマンド | DedicatedServer#runCommand がタスクとして登録し、完了を待つ | 区間 C |
| 専用サーバのコンソール入力 | DedicatedServer#handleConsoleInputs | B5 の直後 |
| データパックの tick 関数 | ServerFunctionManager#tick | B1 |
| /schedule の関数 | ServerLevel#tickTime | L5 |
| コマンドブロック | 予約 tick | L6 (→ 11 §4.13) |
| プレイヤーの移動・物理 (感圧板・トリップワイヤーを踏む) | ServerGamePacketListenerImpl#tickPlayer → ServerPlayer#doTick | B5 (→ 17) |

区間 A・C と B5 は、どれも「全ディメンションの L0〜L15 が終わった後、次の L5 より前」にある。
エンジンから見ると同じ境界に入る。境界の中での順は §2.4 のとおり。

**チャットのコマンドは、先に送った操作を追い越しうる**。[26.3 読解]
同じクライアントが tick N の実行中に「右クリック → チャットのコマンド」の順で送ったとする。
右クリックは専用キューに入り、tick N+1 の区間 A まで待つ。
コマンドはタスクとして積まれ、tick N の区間 C で実行される。
世界への適用順は「コマンド → 右クリック」になり、送った順と逆になる。
両方が区間 C の待ちの間に届いた場合も同じである (コマンドはその場、右クリックは次の区間 A)。
1.21.1 では両方がタスクで、到着順のままだった。実機での確認は P14。[要実機]

右クリックのハンドラは、処理の最後に対象位置と隣の位置のブロック更新パケットを送り返す。
世界への作用ではないので、エンジンでは無視してよい。

**範囲と拒否の条件** (ServerGamePacketListenerImpl#handleUseItemOn。エンジンでは通常不要)

- クライアントの読み込みが済んでいること。
- 手のアイテムが有効な機能のものであること。
- 対象がプレイヤーの操作範囲 + 1.0 以内であること。
- 当たった点が、対象ブロックの中心から各軸 1.0000001 未満であること。
- 対象の y が建築範囲の内であること。
- スポーン保護の範囲外であること。テレポートの確認待ちでないこと。

### 4.11 ブロックが tick されるチャンクの条件

「tick される」の条件は相ごとに違う。[26.3 読解]

| 相・処理 | 判定 | 必要なレベル | 追加の条件 |
|---|---|---|---|
| L6・L7 予約 tick | ServerLevel#isPositionTickingWithEntitiesLoaded | 32 以下 (ブロック tick) | チャンクが ticking の状態に昇格済み、かつエンティティが読み込み済み。満たさないチャンクの予約は持ち越し (→ 02) |
| L9 ランダム tick・氷雪 | ChunkMap#forEachBlockTickingChunk | **31 以下 (エンティティ tick)** | チャンクが ticking の状態に昇格済み |
| L9 落雷 | ServerChunkCache#tickSpawningChunk | 31 以下 | スポーン候補 (プレイヤーが近い) であること |
| L10 ブロックイベント | ServerLevel#shouldTickBlocksAt | 32 以下 | 満たさないイベントは次の tick へ持ち越し (→ 03) |
| L12 エンティティ | DistanceManager#inEntityTickingRange | 31 以下 | プレイヤーは無条件 |
| L13 BlockEntity | Level#tickBlockEntities と LevelChunk#isTicking | 32 以下 | ワールドボーダーの内側。エンティティが読み込み済み |
| 近隣更新・形状更新 | 判定なし | 読み込み済みなら届く | → 04 |

レベルはチケットから決まる。プレイヤーのシミュレーション用チケットは「31 − シミュレーション距離」(下限 0) で、
forceload のチケットは 31 である。チケットの位置から 1 チャンク離れるごとにレベルが 1 上がる。
よって forceload したチャンク自身はエンティティ tick (31)、その周囲 1 チャンクはブロック tick だけ (32) になる。

**レベル 32 の縁のチャンクで起きること**: 予約 tick・ブロックイベント・BlockEntity は動く。
ランダム tick とエンティティは動かない。
ホッパーは動くが、落ちているアイテムは動かない、という状態になる。
回路を forceload の範囲の縁に置くと実機の結果が変わる。プローブ回路は縁を避けること。

---

## 5. 端の場合と落とし穴

1. **tickCount と gameTime は別物**。tickCount は凍結中も増える。予約 tick の期限は gameTime である。
2. **gameTime は overworld の tick の中で増える**。overworld の L5 より前 (L2 の天候など) は古い gameTime、後は新しい gameTime を見る。他のディメンションは最初から新しい値を見る。
3. **時計は B2、gameTime は L5**。昼夜の値は tick 関数 (B1) の時点ではまだ前の tick のもの、ServerLevel#tick の中では当 tick のものである。
4. **ランダム tick の走査は「ブロック tick の範囲」ではない**。メソッド名は BlockTicking だが、実際はエンティティ tick の範囲を回る (§4.5)。
5. **ランダム tick にプレイヤーの距離の条件は無い** (26.3)。forceload だけのチャンクでも起きる。1.21.1 では条件があった (§6)。
6. **random_tick_speed が 0 でも落雷の抽選は行われる**。天候を止めるにはゲームルール advance_weather と /weather clear を使う。
7. **流体のランダム tick は、ブロックのランダム tick の前に読んだ状態で判定する** (§4.5)。
8. **BlockEntity の順は「設置順」とは限らない**。読み直した世界ではハッシュ表の順になる (§4.7)。置き換えると最後尾へ移る。
9. **L13 の中で置かれた BlockEntity は次の tick から**。L10 や L12 で置かれたものは同じ tick に tick される。
10. **エンティティは「追加された相」で扱いが変わる**。L12 より前 (L6 のディスペンサー、L9 の落雷、L10 のピストンなど) に追加されたエンティティは、走査の開始前に表へ入るので**同じ tick の L12 で tick される**。L12 の走査中に追加されたもの (エンティティが別のエンティティを生む場合) と、L13 で追加されたもの (moving_piston の着地で生まれた落下ブロックなど) は**次の tick から**である。[26.3 読解: EntityTickList#add と EntityTickList#forEach]
11. **凍結は同期処理を止めない**。凍結中の setBlock はダストを即座に更新する (§4.8)。
12. **プレイヤーの移動は B5**。プレイヤーが感圧板を踏んだ結果は、全ディメンションの tick の後に入る。他のエンティティは L12 である。
13. **無人ディメンションは 300 tick でエンティティと BlockEntity が止まる**が、予約 tick とブロックイベントは止まらない。
14. **サーバの一時停止** (専用サーバの無人停止) では tickServer の本体が走らない。凍結とは別の仕組みで、tickCount も増えない。接続の tick とコンソール入力だけは動く。シングルプレイのポーズは統合サーバ側のクラスにあり、手元のデコンパイル (サーバ jar) には含まれないので読んでいない。
15. **handlingTick は L0〜L10 の間だけ真**。区間 A・C の入力や L12・L13 の中では偽である。PistonBaseBlock がこの値を条件に使う (→ 13)。
16. **タスクは tick の途中に割り込みうる** (§4.1 の落とし穴)。パケットは 26.3 では割り込まない。
17. **雷の判定は thunderLevel 単独ではない**。rainLevel との積で決まる (§4.3)。/weather thunder の直後は 95 tick ほど雷にならない。
18. **チャットのコマンドは専用キューを通らない**。先に送った右クリックより先に適用されうる (§4.10)。
19. **sprint 中はコマンドがすぐには走らない**。登録から 4 tick 後になる (§4.1)。
20. **酸化する銅のチェストは BlockEntity の順を保つ**。ブロック ID が変わっても BlockEntity を引き継ぐため (§4.7)。他の「別ブロックへの置き換え」とは扱いが違う。
21. **天候データはサーバ全体で共有**。rainLevel・thunderLevel だけがディメンションごとである (§3.2)。

---

## 6. 版差

担当クラスを 1.21.1・26.2・26.3・26.4-pre-1 で比べた。挙動に効くものだけ挙げる。

### 6.1 フェーズ順

ServerLevel#tick の相の順 (L1〜L14) は 4 版とも同じである。
tickChildren の順は、26.2 以降で B2 (clocks) と B7 (debugSubscribers) が増えた。

### 6.2 1.21.1 → 26.2

| 項目 | 1.21.1 | 26.2 以降 | 影響 |
|---|---|---|---|
| プレイヤーのパケットの位相 [版差 1.21.1] | サーバのタスクキューに積まれ、区間 C (tick の後の待ち) で実行。待ちに入れば tick の途中でも実行されうる | 専用のキューに積まれ、区間 A (次の tick の冒頭) でまとめて実行 | どちらも tick の境界。境界の中での「コマンドとの前後」が変わる。1.21.1 は到着順、26.2 以降はコマンド (C) → パケット (A)。チャットのコマンドは 26.2 以降もタスクのままなので、先に送った操作を追い越しうる (§4.10) |
| 昼夜の時刻 [版差 1.21.1] | レベルデータの dayTime。ServerLevel#tickTime の中で、gameTime を増やし、/schedule の関数を実行した後に 1 増やす (ゲームルール doDaylightCycle が真のとき) | ワールド時計。B2 で進む。rate・paused を持つ | 日照センサーの読む時刻の更新位置が L5 から B2 へ移った。L4 (skyDarken の更新) との前後が変わる: 1.21.1 は L4 が先で時刻が後、26.2 以降は時刻が先 |
| 睡眠での時刻の飛ばし方 [版差 1.21.1] | dayTime を次の 24000 の倍数にする | 時計を「起床」の時刻標識へ動かす | 回路外 |
| ランダム tick の対象チャンク [版差 1.21.1] | ticking のチャンクのうち、「エンティティ tick の範囲」かつ「128 ブロック以内にプレイヤーがいる」かつ「ブロック tick の範囲」のもの | エンティティ tick の範囲のチャンク全部。プレイヤーの距離は見ない | forceload だけのチャンクで、1.21.1 はランダム tick が起きず、26.2 以降は起きる |
| ランダム tick のチャンク順 [版差 1.21.1] | ticking の全チャンクを Level の random でシャッフルした順。スポーン → 落雷 → 氷雪 → ランダム tick をチャンクごとに続けて行う | スポーンと落雷は「スポーン候補」をシャッフルした順で先に全部。氷雪とランダム tick はレベル表の内部順で後から全部 | 乱数の消費順が変わる。乱数に依存する結果は版をまたいで再現できない |
| 落雷の位置 [版差 1.21.1] | ServerLevel#tickChunk の冒頭 | ServerChunkCache#tickSpawningChunk (スポーン候補のチャンクだけ) | プレイヤーが近くにいないチャンクには落雷しない (1.21.1 も距離の条件があったので実質は近い) |
| emptyTime の条件 [版差 1.21.1] | 「プレイヤーがいる、または強制読み込みがある」なら 0 に戻す。そうでなければ毎 tick 増やす (凍結中も) | チケットの種類のフラグで判定。凍結中は増やさない | ポータルやエンダーパールのチケットでもディメンションが起きる |
| エンティティの除外 [版差 1.21.1] | 動物を出さない設定のとき動物を破棄する判定が L12 にある | 無い | 回路外 |
| 時刻同期の位置 [版差 1.21.1] | ディメンションのループの中 (各ディメンションの tick の直前) | ループの前に 1 回 | 回路外 |

位置の選び方 (Level#getBlockRandomPos)・Level#tickBlockEntities・LevelChunk の ticker の登録と削除・EntityTickList は、1.21.1 と 26.3 で同じ手順だった。
凍結と step の仕組み (TickRateManager) も同じである。

### 6.3 26.2 → 26.3

tick の順序に効く違いは無い。

- ServerChunkCache: 滞在時間の加算が「前回からの経過 tick」から「1」に変わった。回路外。
- ServerLevel#tickNonPassenger: エンティティの共通の前処理が 1 つのメソッドにまとまった。順は同じ。
- ServerClockManager: 時刻標識への移動の戻り値が 3 値になった。挙動は同じ。

### 6.4 26.3 → 26.4-pre-1

| 項目 | 26.3 | 26.4-pre-1 | 影響 |
|---|---|---|---|
| デバッグワールドの扱い [版差 26.4-pre-1] | ServerLevel#tick の L6・L7 と ServerChunkCache#tickChunks に「デバッグワールドなら飛ばす」の分岐がある | 分岐が消え、デバッグワールドは起動時に凍結される | 通常の世界では同じ |
| エンティティ変更の送信 [版差 26.4-pre-1] | ChunkMap#tick (L9 の中) | L14 の後に「entityTracking」の区画が増えた | 送信だけ。世界の状態には効かない |
| sprint 終了の報告先 [版差 26.4-pre-1] | サーバの発言として報告 | 止めたコマンドの発行元へ報告 | 回路外 |

### 6.5 既存 fixture への影響

実機ハーネスは 1.21.1 で、random_tick_speed 0・天候停止・昼夜停止・凍結 + step で採取している。
この条件では、§6.2 の違いのうちランダム tick・落雷・時計は表に出ない。
パケットの位相の違いも、凍結中に入力してから step する手順では出ない。
よって tick ループの版差が理由で無効になる既存 fixture は無い、と読める。
個別の確認は → 19_version-diffs.md。

---

## 7. Rust で実装するときの要点

### 7.1 最上位ループの形

1 tick を次の関数列に分ける。相の順は宣言データとして持ち、単体テストで固定する。

1. 境界の入力を適用する (区間 C のコマンド → 区間 A のプレイヤー操作 → B1 の関数、の順のキュー)。
2. 時計を進める (B2)。
3. ディメンションごとに次を行う (単一ディメンションなら 1 回)。
   1. 天候 (L2)。使わないなら no-op の枠だけ置く。
   2. skyDarken の更新 (L4)。
   3. gameTime を 1 増やす (L5)。
   4. ブロックの予約 tick (L6)。
   5. 流体の予約 tick (L7)。
   6. ランダム tick と落雷 (L9)。
   7. ブロックイベント (L10)。
   8. エンティティ (L12)。
   9. BlockEntity (L13)。
4. プレイヤーの移動に伴う検知 (B5)。扱うなら境界の入力として次の tick の手順 1 の前に置く。

凍結は「手順 2 と、手順 3 のうち L4 以外を飛ばす。BlockEntity のリストは掃除だけする」で表す。
エンジンの利用者に見せる step は、凍結を前提にした「N tick 進める」でよい。

### 7.2 データ構造

| 対象 | 持ち方 | 理由 |
|---|---|---|
| BlockEntity の ticker | 包みの配列 + 位置 → 添字の表。包みは「有効な中身」か「除去済み」を持つ | 同じ位置の状態変化で順番を保ち、置き換えで末尾へ移る挙動を再現する |
| pending の ticker | 別の配列。L13 の冒頭で本体の末尾へ足す | L13 の中の追加を次の tick に回す |
| ticker の除去 | 印だけ付け、L13 の走査が到達したときに詰める | 走査中の添字のずれを避け、バニラと同じ時機にする |
| エンティティの表 | 挿入順つきの表 + 走査中の変更を受ける複製 | 走査中の追加が次の tick に回る挙動を再現する |
| ランダム tick の位置 | i32 の状態 1 つ。乗算と加算は wrapping、右シフトは算術シフト | Java の int と同じ結果にする |
| 乱数源 | ディメンションごとに 1 つ。天候・落雷・ランダム tick の中身で共有 | 消費順が結果に効く (→ 18) |
| gameTime | i64。ディメンション共有 | 予約 tick の期限 |
| 時計 | 時計ごとに totalTicks (i64)・partialTick (f32)・rate (f32)・paused | 日照センサーを扱うなら必要 |
| セクションのランダム tick 対象数 | ブロックと流体の個数を setBlock のたびに増減 | 対象が無いセクションを飛ばす。位置の乱数の消費回数に効く |

### 7.3 決定性の扱い

- randValue と random の初期値は実機では毎回違う。エンジンでは種を外から渡す。
- 実機と比べる fixture は、ランダム tick を 0 にして採る。ランダム tick を含む挙動は「起きうる結果の集合」として検証する。
- チャンクの走査順 (ランダム tick) と、読み込み時の BlockEntity の登録順はハッシュ表の順である。
  実機と同じにするには表の実装まで合わせる必要がある (→ 18)。
  当面は「エンジン内で決定的」な順を選び、実機と違いうる点として文書に残す。

### 7.4 他のメモとの境界

- L6・L7 の「期限が来た予約を集めてから実行する」は 02 の範囲。本メモは呼び出す位置と gameTime の渡し方だけを決める。
- L10 のループは 03 の範囲。
- 境界で適用する入力の中身 (レバーを引く、ブロックを置く) は 09 と 04 の範囲。本メモは位相だけを決める。
- BlockEntity の tick 関数の中身は 07・13・14 の範囲。本メモはリストの順と追加・削除の時機だけを決める。

---

## 8. 検証用のプローブ回路案

| 番号 | 目的 | 配置 | 観測する tick と期待の要点 |
|---|---|---|---|
| P1 | 入力由来の予約が 1 tick 早いこと (§2.4) | レバー → リピーター (遅延 1) → ランプ。別に、オブザーバーで tick 内に駆動する同じ列を並べる | 凍結中にレバーを引き、step 1 ずつ進める。入力の列はリピーターが 2 回目の step で点く。tick 内で駆動した列は予約から 2 tick 後。差が 1 tick |
| P2 | BlockEntity の順: 既存 → 新規 (§4.7) | ホッパー A を先に置く。後からホッパー B を A の搬出先に置く。逆順の組も作る | アイテム 1 個を入れて step。A → B の順なら同じ tick に B まで進まない (B のクールダウン補正の有無で判別)。置いた順を逆にした組と結果が入れ替わる |
| P3 | 状態変化で順番が変わらないこと (§4.7) | ホッパー A・B を順に置いた後、A にレバーで信号を入れて切る (enabled が変わる) | P2 と同じ結果のまま |
| P4 | 置き換えで最後尾へ移ること (§4.7) | A・B を順に置いた後、A を壊して同じ位置にホッパーを置き直す | P2 の逆順の結果になる |
| P5 | 読み直した世界の BlockEntity の順 (§4.7) | P2 の配置を保存し、サーバを再起動して同じ操作 | 設置順と違う結果になる組があるかを見る。ハッシュ順の仮説の確認。[要実機] |
| P6 | L10 で生まれた moving_piston が同じ tick に tick されること | ピストン 1 本と、その頭の位置を読むオブザーバー | 伸び始めの tick と、2 回目・3 回目の tick で着地する tick を数える。伸長の開始から着地までの tick 数が、同じ tick の L13 を 1 回目と数えた値に合う (→ 13 と共同) |
| P7 | 凍結中の同期処理 (§4.8) | レバー → ダスト 5 マス → ランプ、レバー → リピーター → ランプ | 凍結中にレバーを引く。step の前に、ダストの power が変わっている。ランプは変わらない (予約 tick 待ち)。リピーターも変わらない |
| P8 | sprint の tick 数 (§4.9) | 何も無い世界 | 凍結中に /time query gametime を読む → /tick sprint 10 → 終了後にもう一度読む。差が 10 か 11 か |
| P9 | 縁のチャンク (§4.11) | forceload を 1 チャンクだけ行い、隣のチャンク (レベル 32) にホッパー + 上にアイテムを落とす。別に redstone_ore を光らせて置く | ホッパーは既にあるアイテムを運ぶ。落としたアイテムは落下しない。random_tick_speed を上げても鉱石は消えない。forceload したチャンクでは消える |
| P10 | ランダム tick の距離条件の版差 (§6.2) | プレイヤーを 200 ブロック以上離し、forceload したチャンクに光った redstone_ore を多数置く。random_tick_speed は 1000 | 1.21.1 では消えない。26.3 では消える |
| P11 | 日照センサーの更新 tick (§4.4) | 日照センサー → ダスト。advance_time を真にして凍結 | step 1 ずつ進め、出力が変わる tick の gameTime を読む。20 の倍数だけで変わる |
| P12 | 凍結中の /time set と日照センサー (§4.4) | P11 と同じ | 凍結中に /time set で昼夜を入れ替える。出力は変わらない。step を重ね、gameTime が 20 の倍数になった tick で変わる |
| P13 | 避雷針への落雷の位相 (§4.5) | 避雷針 → ダスト。/summon で雷を出す場合と、天候の雷を待つ場合 | 雷の生成 tick から避雷針の powered が真になるまでの tick 数。8 tick 後に偽へ戻ること (→ 09 と共同) |
| P14 | コマンドとパケットの前後 (§2.4) | レバーと、同じ位置を書き換える setblock | 凍結中に、RCON の setblock とプレイヤーのレバー操作を同じ境界に入れる。結果から適用順を読む。26.3 はコマンドが先のはず。[要実機] |
| P15 | 流体のランダム tick の判定 (§4.5 手順 4) | 優先度が低い。溶岩の着火は統計的にしか観測できない | 見送り可 |
| P16 | 雨・雷の判定が真になる tick (§4.3) | 避雷針は不要。execute if predicate で天候の述語 (raining・thundering) を読む関数を tick タグに置く | 凍結中に /weather thunder → step 1 ずつ。雨が 20 回目、雷が 95 回目の L2 で真になるか。/weather rain で満ちた後の /weather thunder では 91 回目か |
| P17 | チャットのコマンドが右クリックを追い越すこと (§4.10) | レバーと、同じ位置を別のブロックへ書き換える setblock | 凍結せずに、同じクライアントから「レバーの右クリック → /setblock」を 1 tick の内に続けて送る。結果が「setblock が先」になる場合があるか。P14 の RCON 版と比べる。[要実機] |
| P18 | sprint 中のコマンドの遅れ (§4.1) | 何も無い世界 | /tick sprint 1000 の直後に RCON で /time query gametime を 2 回続けて読む。2 回の差が 4 以上になるか (1 回ごとに少なくとも 4 tick 待たされる。通信の往復の間にも tick は進む) |
| P19 | 銅のチェストの酸化と BlockEntity の順 (§4.7) | ホッパー A の搬出先を銅のチェストにし、後から別のホッパー B を置く。チェストを斧で錆落とし、または蜜蝋を塗る | 操作の前後で P2 と同じ観測をして、順が変わらないこと。優先度は低い |

---

## 9. 既存資料との食い違い

### 9.1 docs/research/02_behavior-spec.md §1

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §1.2 のフェーズ表 | 1 境界 → 2 天候 → 3 時刻 (睡眠を含む) → 4 ブロック予約 → 5 流体予約 → 6 襲撃 → 7 チャンク → 8 ブロックイベント → 9 エンティティ → 10 BlockEntity → 11 エンティティ管理 | 順は同じ。細部として、睡眠 (L3) と skyDarken の更新 (L4) は gameTime の加算 (L5) より前にあり、凍結中も動く | 既存は正しい。本メモの表が細かい版 |
| §1.2「サーバ全体: 関数 → 各ディメンション → パケット送受信 → オートセーブ → 待機」 | 関数の次が各ディメンション | 26.3 は関数とディメンションの間に時計 (B2) がある。パケットの処理は tick の冒頭 (区間 A) にも増えた | 26.3 では本メモが正しい。1.21.1 の記述としては既存が正しい |
| §1.2「ScheduledTasks (プレイヤーアクション等) は tickServer 後の nextTickWait で消化される」 | プレイヤーの操作は tick の後の待ちで適用 | 26.3 では、プレイヤーのパケットは次の tick の冒頭の専用キューで処理される。待ちで消化されるのはコマンドなどのタスクだけ | 26.3 では本メモが正しい (§6.2)。境界に入る、という結論は変わらない |
| §1.2「ディメンション処理順は要検証」 | 未確定 | overworld が最初であることは読みで確定。残りはレジストリの順 | 一部確定。残りは [要実機] |
| §1.4「tick と tick の境界で適用され、どのフェーズにも割り込まない」 | 割り込まない | 26.3 のパケットは割り込まない。タスク (コマンド) は、サーバスレッドが tick の途中で待ちに入ると割り込みうる。1.21.1 ではパケットもタスクだったので同じ余地があった | 通常の回路では既存の結論でよい。厳密には例外がある (§4.1) |
| §1.4「過負荷時は入力適用が最大 3 tick 遅延しうる」 | shouldRun の条件から | 26.3 では、この条件はタスクにだけ効く。パケットは無条件に次の tick の冒頭で処理される。タスクの遅れは登録の位相により 3〜4 tick (§4.1) | 26.3 ではプレイヤー操作には当てはまらない。コマンド (RCON・チャット) には当てはまり、sprint 中は常に起きる |
| §1.4「パケット由来のプレイヤー操作は…タスクキューに転送する」 | 全パケットが同じ経路 | 26.3 では操作のパケットは専用キュー、チャットのコマンドはネットワークスレッドから直接タスクキュー。経路が 2 本に分かれた | 26.3 では本メモが正しい。コマンドが操作を追い越しうる点は既存に無い (§4.10) |
| §1.2「2. 天候」 | 天候の相があることだけ | 雷の判定は thunderLevel × rainLevel。天候データはサーバ全体で 1 つ | 既存に記述が無い。避雷針を扱うなら本メモ §4.3 を使う |
| §1.4 の設計指針「tick N の全フェーズ終了後〜tick N+1 の blockTicks 開始前に適用」 | — | 一致。より正確には「tick N+1 の gameTime 加算より前」 | 既存は正しい |
| §1.2「7. チャンク処理 ← ランダムティック・スポーン等」 | — | 一致。ただしランダム tick の対象チャンクの条件は 1.21.1 と 26.3 で違う (§6.2) | 既存に版差の注記が無い |

### 9.2 docs/research/16_nucleation-comparison.md §1.3・§2.1

| 箇所 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| §1.3「26.2 ServerLevel#tick の 9 相 + tick の外で処理するプレイヤー入力」 | 9 相 | 数え方の違いだけ。本メモは L1〜L14 に細分した。順は同じ | 食い違いなし |
| §2.1「BlockEntity 相の順: 既存の ticker → 着地。新しい moving_piston の BE がリストの末尾に付く」 | Nucleation が近い | 一致。L10 で作られた moving_piston は末尾に入り、同じ tick の L13 で、既存の BlockEntity の後に tick される (§4.7) | 既存は正しい |
| §2.1「入力の位相: 入力で予約した tick は 1 tick 早く発火する」 | 両者同じ | 一致。gameTime の加算が予約 tick の照合の直前にあるため (§2.4) | 既存は正しい。理由を本メモで補った |
| §2.1「ランダム tick: Nucleation は頻度だけ一致する近似、redstone-sim は無し」 | — | 位置の選び方は線形合同法で決まっている (§4.5)。初期値が起動ごとに違うので、頻度の一致以上は実機と比べられない | 「頻度だけ一致」で十分、という扱いは妥当 |
| §2.1「エンティティ相: 種別ごとの固定順 (簡略化)」 | Nucleation の簡略化 | バニラはエンティティ ID の挿入順 (§4.6) | Nucleation の順はバニラと違う。エンジンでは挿入順にする |

### 9.3 packages/sim/src/world.ts の tick()

| 点 | 今の TS 実装 | 26.3 の読み | 判断 |
|---|---|---|---|
| 相の構成 | currentTick を増やす → 予約 tick → ブロックイベント → BlockEntity の 3 相 | L5 → L6 → L7 → L9 → L10 → L12 → L13 | 順は合っている。流体の予約 tick が別の相でないこと、ランダム tick とエンティティが無いことが差 |
| 流体の予約 tick | ブロックの予約と同じ列に混ぜる | 別のキューで、ブロックの予約が全部終わった後 (L7) | TS は違う。同じ tick にブロックと流体の予約が重なると順が変わりうる (→ 02、16) |
| BlockEntity の順 | まず期限が来た moving_piston を全部 (seq 順) 確定し、その後でホッパーを設置順に回す | 1 本のリストを追加順に回す。moving_piston とホッパーは種類で分かれず、追加順で混ざる。伸長と同じ tick なら「既存のホッパー → 新しい moving_piston」 | TS は違う。docs/research/16 §2.1 が指摘済みの「着地 → ホッパー (逆)」と同じ点。ホッパーが着地先を読む回路で 1 tick ずれうる |
| moving_piston の確定の判定 | blockstate に載せた確定 tick が来たら確定 | moving_piston の BlockEntity が毎 tick 進み、進行度で確定する (→ 13) | 結果が同じになるかは 13 で確かめる |
| ホッパーの走査順 | ブロックの表の挿入順 (= 設置順) | ticker の追加順。置き換えると最後尾へ移る。状態変化では動かない | TS の表が「同じ位置の置き換え」で順を保つなら違う。P4 で確かめる |
| L13 の中で置かれた BlockEntity | 走査前にホッパーの一覧を作るので、走査中に増えた分は回らない | pending に入り次の tick から | 結果は同じ |
| tick のコメント「処理順: ST フェーズのみ」 | 古い記述が残っている | — | コメントが実装と合っていない (実装は 3 相) |
| 入力の位相 | activateBlock を tick の外で呼ぶ | 境界で適用 | 合っている |
| 凍結 | 概念が無い (tick を呼ばなければ止まる) | 凍結中も同期処理は動く | TS の「tick を呼ばない間に入力を適用する」は凍結中の入力と同じ意味になる。合っている |
| ブロックイベントの上限 65536 | 独自の安全弁 | バニラに上限は無い (→ 03) | 既知の差 |
| 予約 tick の 1 tick あたり上限 | 無い (期限が来たものを全部実行) | ブロック・流体それぞれ 65536 件。超えた分は次の tick へ (→ 02) | TS は違う。通常の回路では届かない |
| 期限が来た予約の並べ方 | 優先度 → 予約順 | L6 が受け取るのは gameTime だけで、並べ方は LevelTicks の側 (→ 02) | 02 で判断する。本メモの範囲では「L6 に渡す時刻は L5 で増やした後の gameTime」が合っていることだけ確かめた (TS は currentTick を先に増やす。合っている) |
| チャンクの条件 | 無い (全ブロックが常に tick される) | 相ごとにレベル 31・32 の条件がある (§4.11) | TS は「全域がエンティティ tick の範囲」の世界に相当する。実機の fixture を forceload の縁に置かない限り差は出ない |

---

## 10. 典拠一覧

すべて 26.3。

- MinecraftServer#runServer — ループ 1 周の構成。sprint の判定、パケット処理と tick、待ち
- MinecraftServer#processPacketsAndTick — パケットのキューを処理してから tickServer
- MinecraftServer#tickServer — 無人停止の判定、tickCount の加算、TickRateManager#tick、tickChildren、自動保存
- MinecraftServer#tickChildren — 関数 → 時計 → 時刻同期 → 全ディメンション → 接続 → プレイヤー一覧 → GameTest → 送信
- MinecraftServer#waitUntilNextTick・MinecraftServer#pollTask・MinecraftServer#shouldRun・MinecraftServer#haveTime — tick の合間のタスク消化と条件
- MinecraftServer の levels フィールドと初期化部 — ディメンションの順 (overworld が最初)
- BlockableEventLoop#execute・BlockableEventLoop#pollTask・BlockableEventLoop#managedBlock — タスクの登録と、待ちの間の消化
- PacketUtils#ensureRunningOnSameThread・PacketProcessor#scheduleIfPossible・PacketProcessor#processQueuedPackets — パケットの受け渡し
- TickRateManager#tick・TickRateManager#runsNormally・TickRateManager#isEntityFrozen — 凍結と step の判定
- ServerTickRateManager#stepGameIfPaused・ServerTickRateManager#requestGameToSprint・ServerTickRateManager#checkShouldSprintThisTick・ServerTickRateManager#finishTickSprint — step と sprint
- TickCommand — freeze・unfreeze・step・sprint の入口
- ServerFunctionManager#tick — tick 関数。凍結中は実行しない
- ServerClockManager#tick・ServerClockManager の ServerClockInstance#tick・ServerClockManager#modifyClock — ワールド時計
- ServerLevel#tick — ディメンション内のフェーズ順、emptyTime、エンティティの走査
- ServerLevel#tickTime — gameTime の加算と /schedule
- ServerLevel#advanceWeatherCycle・ServerLevel#resetWeatherCycle — 天候
- Level#canHaveWeather・Level#isRaining・Level#isThundering・Level#getRainLevel・Level#getThunderLevel・Level#isRainingAt — 天候の判定と閾値 (雷は雨との積)
- ServerLevel#getWeatherData — 天候データはサーバ全体で 1 つ
- Level#updateSkyBrightness — skyDarken
- Level#getOverworldClockTime・Level#getDefaultClockTime — 時計の読み出し
- ServerLevel#tickBlock・ServerLevel#tickFluid — 予約 tick の実行時にブロック種・流体種を照合する (詳細は 02)
- ServerLevel#runBlockEvents — L10 (詳細は 03)
- ServerLevel#tickChunk — 氷雪とランダム tick
- ServerLevel#tickPrecipitation — 氷と雪の生成
- ServerLevel#tickThunder・ServerLevel#findLightningTargetAround・ServerLevel#findLightningRod — 落雷と避雷針
- Level#getBlockRandomPos — ランダムな位置の線形合同法
- LevelChunkSection#isRandomlyTicking — セクションの対象数
- ServerLevel#tickNonPassenger・ServerLevel#tickPassenger — エンティティと乗員の tick
- ServerLevel#shouldTickBlocksAt・ServerLevel#isPositionTickingWithEntitiesLoaded・ServerLevel#isPositionEntityTicking — tick の範囲の判定
- ServerLevel#isHandlingTick — handlingTick の読み出し (PistonBaseBlock が使う)
- ServerChunkCache#tick・ServerChunkCache#tickChunks・ServerChunkCache#tickSpawningChunk・ServerChunkCache#isPositionTicking・ServerChunkCache#hasActiveTickets — チャンクの相
- ChunkMap#forEachBlockTickingChunk・ChunkMap#collectSpawningChunks — 走査対象のチャンク
- DistanceManager#forEachEntityTickingChunk・DistanceManager#inBlockTickingRange・DistanceManager#inEntityTickingRange — レベルの判定
- ChunkLevel#isBlockTicking・ChunkLevel#isEntityTicking — レベルの閾値 (32・31)
- TicketStorage#shouldKeepDimensionActive・TicketType — ディメンションを起こすチケット
- Level#tickBlockEntities・Level#addBlockEntityTicker — BlockEntity 相と pending
- LevelChunk#setBlockState — BlockEntity の生成・維持・除去の分岐
- LevelChunk#addAndRegisterBlockEntity・LevelChunk#setBlockEntity・LevelChunk#updateBlockEntityTicker・LevelChunk#removeBlockEntity・LevelChunk#removeBlockEntityTicker — ticker の登録・差し替え・削除
- BlockBehaviour#shouldChangedStateKeepBlockEntity・CopperChestBlock・CopperGolemStatueBlock — ブロックが変わっても BlockEntity を引き継ぐ例外
- LevelChunk#registerAllBlockEntitiesAfterLevelLoad・LevelChunk#clearAllBlockEntities — 読み込みと解放
- LevelChunk#isTicking と内部クラス BoundTickingBlockEntity#tick — ticker の実行条件
- ChunkStatusTasks (FULL への昇格の処理) — 読み込み後の登録の呼び出し元
- EntityTickList#add・EntityTickList#remove・EntityTickList#forEach — エンティティの走査と走査中の変更
- PersistentEntitySectionManager#addEntity と ServerLevel の EntityCallbacks#onTickingStart — 追加したエンティティが tick の表へ入る時機
- ServerGamePacketListenerImpl#tick・ServerGamePacketListenerImpl#tickPlayer — 接続の tick とプレイヤーの移動
- ServerGamePacketListenerImpl#handleUseItemOn・ServerGamePacketListenerImpl#handlePlayerAction・ServerGamePacketListenerImpl#handleContainerClick — 操作のパケット
- ServerGamePacketListenerImpl#handleChatCommand・ServerGamePacketListenerImpl#tryHandleChat — チャットのコマンドはタスクとして登録
- DedicatedServer#tickConnection・DedicatedServer#handleConsoleInputs・DedicatedServer#runCommand — コンソールと RCON
- ServerPlayer#tick・ServerPlayer#doTick・ServerPlayerGameMode#tick — プレイヤーの 2 つの tick
- DaylightDetectorBlock#tickEntity・DaylightDetectorBlock#updateSignalStrength・DaylightDetectorBlock#getTicker — 日照センサーの周期と読む値
- GameRules — random_tick_speed・advance_time・advance_weather・spawn_mobs
