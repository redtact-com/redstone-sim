# 02. 挙動仕様整理 v1 (Java Edition)

redstone-sim が準拠すべき Java Edition の挙動仕様。現時点で確度付きで言える範囲の整理 + 未解明点の明示。
確度ラベル: **[確定]** = 複数源一致 or デコンパイル一次確認 / **[要検証]** = 単一源・未検証。
対象バージョン: **典拠は 1.21.1** (公式 mappings 適用デコンパイル) とし、**26.2** (非難読化 jar) を併読して差分を注記する
(方針の根拠は CONTRIBUTING.md / 04 §4.1)。1.21.2+ のワイヤ刷新 (Orientation) は experimental flag 付きで既定挙動は不変 (§6 wire)。

v1 更新 (2026-07-02): tools/decompile/fetch-and-decompile.sh による 1.21.1 + 26.2 の実デコンパイル読解で、
§4.2 送信方向順 / §6 の DiodeBlock 再評価・burnout・ボタン持続・コンパレーター遅延・コンテナ式 / §1.4 入力位相を [確定] 化。
本文中の「デコンパイル」の典拠バージョンは断りがなければ **1.21.1 と 26.2 の両方で一致確認済み** を意味する。

---

## 1. ゲームティック構造

### 1.1 基本単位 [確定]
- 1 game tick (gt) = 0.05 秒 (20 TPS)。
- レッドストーンティック (rt) = 2 gt の**便宜単位**。ゲーム内部に rt 専用の処理は存在しない。遅延部品 (リピーター等) が偶数 gt で動くことから生まれた表示用単位。
  - 出典: https://ja.minecraft.wiki/w/ティック、ArcFrout chap2 草稿
  - **設計指針: シミュレータ内部単位は gt。rt は UI 表示のみ。**

### 1.2 1 tick 内フェーズ順序 (ディメンション内) [確定]

1.21.1 公式 server.jar デコンパイル (ServerLevel.tick) + Minecraft Wiki + techmcdocs + SubTick mixin の 4 系統一致:

```
(サーバ全体: load/tick 関数 → 各ディメンション処理 → パケット送受信 → オートセーブ → 次tick待機)

ディメンション内:
 1. ワールド境界 (worldBorder)
 2. 天候 (weather)
 3. 時刻 (time) ※睡眠処理含む
 4. スケジュールティック: ブロック (blockTicks)     ← リピーター/コンパレーター/トーチ/オブザーバー
 5. スケジュールティック: 液体 (fluidTicks)
 6. 襲撃 (raids)
 7. チャンク処理 (chunkSource)                       ← ランダムティック・スポーン等
 8. ブロックイベント (runBlockEvents)                ← ピストン・音符ブロック
 9. エンティティ (entities)
10. ブロックエンティティ (blockEntities)             ← ホッパー・コンパレーター用コンテナ
11. エンティティ管理 (entityManagement)
```

- 出典: 1.21.1 server.jar + Mojang mappings デコンパイル (blockTicks→fluidTicks→raid→chunkSource→runBlockEvents→entities→tickBlockEntities→entityManagement を直接確認)、https://minecraft.wiki/w/Tick、https://techmcdocs.github.io/pages/GameTick/、https://github.com/jacobo-mc/mc_1.18.1_src (1.18.1)、Renekovski/26.2-mcp (26.2)
- 1.18.1〜26.2 でこのフェーズ順は不変 [確定]。
- ScheduledTasks (プレイヤーアクション等) は tickServer 後の nextTickWait で消化される [確定: 1.21.1 デコンパイル]。
- ディメンション処理順 (OW→ネザー→エンド、と wiki 記載 / chiraag-SubTick は OW→End→Nether とハードコード) は **[要検証]**。単一次元 sim には影響なし。

### 1.3 素子のフェーズ 3 分類 (ArcFrout 用語、概念設計に有用)
- **PLC** (Phaseless): 遅延なし即時伝播 — RS ダスト
- **STC** (Scheduled Tick): tile tick で駆動 — リピーター/コンパレーター/トーチ/オブザーバー
- **BEC** (Block Event): ブロックイベントで駆動 — ピストン
- 出典: ArcFrout chap2 草稿 (git 履歴復元) [要検証: 分類自体は実装対応が確認できるが素子割当の網羅は未執筆]

### 1.4 プレイヤー入力の適用位相 [確定] (1.21.1 デコンパイル、批評#9 解消)

- パケット由来のプレイヤー操作 (レバー/ボタン操作・ブロック設置等) は Netty スレッドで受信後、
  `PacketUtils.ensureRunningOnSameThread` がメインスレッドのタスクキュー (`BlockableEventLoop.executeIfPossible`) に転送する。
- メインスレッドは `MinecraftServer.runServer` で `tickServer` (§1.2 の全フェーズ + 全ディメンション + connection/players) を
  完了した**後**、`nextTickWait` 区間 (`waitUntilNextTick` → `managedBlock` → `pollTask`) でこのキューを消化する。
  つまり**プレイヤー入力は tick と tick の境界で適用され、tick 内のどのフェーズにも割り込まない**。
- 補足: `MinecraftServer.shouldRun(TickTask)` は「タスク登録 tick + 3 < 現在 tick、または時間余裕 (haveTime)」を条件とするため、
  サーバ過負荷時は入力適用が最大 3 tick 遅延しうる (通常運転では次 tick 境界で適用)。
- 出典: MinecraftServer.runServer / tickServer / waitUntilNextTick / shouldRun、PacketUtils.ensureRunningOnSameThread (1.21.1)。
- **設計指針: シミュレータの入力は「tick N の全フェーズ終了後〜tick N+1 の blockTicks 開始前」の境界で適用する。**
  実機ハーネス (04 §2.2) との diff では、freeze 中に fake player 操作 → `tick step 1` の順で入力を境界に固定すると位相が一致する。

---

## 2. スケジュールティック (tile tick)

### 2.1 実行規則 [確定] (1.21.11 公式デコンパイルで直接確認)
- **ブロックティック → 液体ティック** の 2 段。別キュー別フェーズ。
- ブロックティックは **priority 昇順 → 同 priority 内は予約順 (subTickOrder)** で実行 (ScheduledTick.DRAIN_ORDER)。液体ティックは priority なし・予約順のみ。
- **collect-then-execute**: 期限が来た tick を先に収集してから実行する。実行中に新規スケジュールされた tick は (delay 0 でも) **同 tick では走らず次 tick 送り**。
  - 出典: 1.21.11 デコンパイル LevelTicks.tick (collectTicks→runCollectedTicks)、SubTick WorldTickSchedulerMixin、https://minecraft.wiki/w/Tick
- **重複予約の扱い** [確定]: LevelChunkTicks.schedule は (位置, ブロック種) キーで既存予約があると新規予約を**無視**。さらに willTickThisTick が当該 tick 実行バッチ中の再予約を防ぐ。→ **同 pos+block に予約は常に 1 件、キャンセル API はなし、action は実行時に世界状態から決定**。
- 実行時検証 [確定]: tile tick 実行時にその座標のブロックがスケジュール時の型と一致しなければ no-op (SubTick verifyBlock/verifyFluid で確認)。

### 2.2 TickPriority [確定] (1.21.11 デコンパイル全ブロック grep で確認、1.21.1/26.2 でも同一を確認済み)

| 部品 | 条件 | priority |
|---|---|---|
| リピーター | 出力先が別のダイオードの側面/背面 | -3 (EXTREMELY_HIGH) |
| リピーター | 信号が切れる (オフ化) とき | -2 (VERY_HIGH) |
| リピーター | その他 | -1 (HIGH) |
| コンパレーター | 出力先が別のダイオードの側面/背面 | -1 (HIGH) |
| コンパレーター | その他 | 0 (NORMAL) |
| その他全ブロック (トーチ・オブザーバー含む) | — | 0 (NORMAL) |

- 出典: DiodeBlock.checkTickOnNeighbor / ComparatorBlock (1.21.11 デコンパイル)、https://ja.minecraft.wiki/w/ティック

### 2.3 件数上限 [確定] (1.21.1/26.2 デコンパイルで確定)
- 1 tick あたり最大 65,536 件 (`ServerLevel.MAX_SCHEDULED_TICKS_PER_TICK`)。`blockTicks.tick(gt, 65536, ...)` と
  `fluidTicks.tick(gt, 65536, ...)` に別々に渡されるため **ブロック・液体それぞれ 65,536** (ja wiki の表現が正)。
- 超過時: `LevelTicks.collectTicks` は上限まで収集した後、残りを `rescheduleLeftoverContainers` でキューに戻す →
  **超過分は破棄されず次 tick 以降に持ち越し** (優先順は維持)。

### 2.4 サブティック順序の具体例: オブザーバー→コンパレーターのパルス飲み込み [確定]
- ObserverBlock.tick はオン時に自身のオフ tick (NORMAL) を近傍更新より先に登録し、コンパレーターも通常 NORMAL で登録するため、同 tick・同 priority では挿入順 (subTickOrder) によりオブザーバーのオフが先に実行される → **コンパレーターはオブザーバー単体のパルスを通せない**。
- 例外: コンパレーターが別ダイオードに向く場合は priority -1 になりパルスが通る。
- 出典: note II-07 (https://note.com/enokilovin/n/nc2952f9d228c) + デコンパイル (ObserverBlock/ComparatorBlock/ScheduledTick.DRAIN_ORDER) + https://minecraft.wiki/w/Redstone_circuits/Pulse で三重裏付け。
- **→ 回帰テストの最重要ケース。**

---

## 3. ブロックイベント (ピストン等)

- キューは **ObjectLinkedOpenHashSet** = 挿入順 FIFO + 重複排除 (同一 (pos, block, type, data) は重複登録されない) [確定]。
- runBlockEvents は**キューが空になるまで** removeFirst で回す。**処理中に追加されたイベントも同一 tick 内で処理される** (ピストン連鎖の根拠)。tile tick の collect-then-execute と対照的 [確定]。
- 非 ticking チャンクのイベントは退避して次 tick へ再スケジュール [確定]。
- 実行時検証: getBlockState(pos).isOf(event.block) が不一致なら no-op [確定]。
- **BED (block event delay)**: フェーズ開始時 (または前レイヤー処理後) のキュー内容を 1 層とする BFS 的レイヤー概念。現行実装は単一 FIFO だが観測順序は層状と等価 (1.12 以前は文字通り 2 リストスワップ) [確定]。
- 使用ブロック: ピストン (伸縮)、音符ブロック、チェスト/シュルカーボックス (蓋)、鐘、エンドゲートウェイ、スポナー [要検証: techmcdocs 単一源]。
- 出典: 1.21.1/1.18 デコンパイル (ServerLevel.runBlockEvents)、SubTick BlockEventWorldMixin、https://techmcdocs.github.io/pages/GameTick/

---

## 4. ブロック更新の種類と伝播順

### 4.1 3 分類 (+自己更新) [確定]

| 種別 | Java 実装対応 | 反応するもの | 役割 |
|---|---|---|---|
| **NC** (neighborChanged / BU) | neighborChanged | ダスト・リピーター・コンパレーター・トーチ等の赤石素子 (オブザーバーは反応**しない**) | 回路動作の主役 |
| **PP** (updateShape / SU) | updateShape (replaceWithStateForNeighborUpdate) | 形状変化・アイテム化・**オブザーバー起動** | 接続形状。ダストは強度再計算せず結線形状確認のみ |
| **CU** (コンパレーター更新) | updateNeighbourForOutputSignal | コンパレーターのみ | コンテナ越し読み取りの根拠 |
| SF (自己更新) | scheduled self-update | — | [要検証: note 単一源の分類] |

- 出典: https://ja.minecraft.wiki/w/ブロック更新 + ArcFrout chap1 草稿 (I-Upd-01) + note II-07 の 3 源一致。
- 「オブザーバーは PP/SU で起動し NC/BU では起動しない」は**デコンパイルで確定** (批評#7 解消):
  ObserverBlock は `neighborChanged` を一切 override せず (BlockBehaviour 既定 = no-op)、
  `updateShape` (PP 受信) でのみ `startSignal` → tile tick 予約を行う (1.21.1/26.2 で一致) [確定]。

### 4.2 送信方向順 [確定 — 1.21.1/26.2 デコンパイルで確定 (未解明 #1)]

| 更新種 | 通常の送信順 | 典拠クラス (1.21.1/26.2 で同一) |
|---|---|---|
| NC | 隣接 6 マスへ **西→東→下→上→北→南**、連鎖は DFS (下記) | `NeighborUpdater.UPDATE_ORDER` = {WEST, EAST, DOWN, UP, NORTH, SOUTH} |
| PP | 隣接 6 マスへ **西→東→北→南→下→上** (NC と異なる) | `BlockBehaviour.UPDATE_SHAPE_ORDER` = {WEST, EAST, NORTH, SOUTH, DOWN, UP} |
| CU | 水平隣接へ **北→東→南→西** (各方向: コンパレーター直 or 導体 1 個越しのコンパレーター) | `Level.updateNeighbourForOutputSignal` + `Direction.Plane.HORIZONTAL` = {NORTH, EAST, SOUTH, WEST} |

**NC 連鎖の DFS 構造** [確定: CollectingNeighborUpdater]:
- 実行中 (count>0) に発生した更新は `addedThisLayer` に積まれ、逆順で stack に push → **挿入順に、現在の更新より先に実行** (プッシュ型 DFS)。
- 6 方向一括更新 (`MultiNeighborUpdate`) は **1 方向実行するたびに中断判定**され、その方向で発生した派生更新が先に処理されてから次の方向へ進む。
- 深度ではなく**総数**制限: `maxChainedNeighborUpdates` = **1,000,000** (`MinecraftServer.getMaxChainedNeighborUpdates`、専用サーバは server.properties `max-chained-neighbor-updates`)。超過分は **skip されエラーログのみ** (rollback なし) → update suppression の実体 (未解明 #8 解消)。

**setBlock フラグと更新種の対応** [確定: Level.setBlock]:
- flag 1: NC (自身の隣接 6 へ `blockUpdated`) + 新 state が `hasAnalogOutputSignal` なら CU。
- flag 2: クライアント送信のみ (NC を送らない)。
- flag 16 が無い限り **PP は every setBlock で発火**: 旧 state の `updateIndirectNeighbourShapes` → 新 state の `updateNeighbourShapes` (UPDATE_SHAPE_ORDER 順) → 新 state の `updateIndirectNeighbourShapes`。
- サーバ側は state 変化のたびに旧 state `onRemove` / 新 state `onPlace` が呼ばれる (`LevelChunk.setBlockState`)。素子の「素子別例外」の大半はこの onPlace/onRemove 内の手動更新で実装されている。

素子別例外 [確定: 各ブロッククラスのデコンパイル]:
- **レバー/ボタン**: `updateNeighbours` = 自身の隣接 6 (UPDATE_ORDER 順) + **取り付けブロックの隣接 6**。状態変化は flag 3 (NC+PP 両方)。
- **リピーター/コンパレーター/オブザーバー**: 状態変化は flag 2 (NC なし) + onPlace/tick からの `updateNeighborsInFront` =
  **出力先 1 マスに NC → 出力先の隣接 5 マス (自身方向を除く UPDATE_ORDER 順) に NC**。
- **トーチ**: 点滅は flag 3 → 自身の隣接 6 に NC。さらに `onRemove`/`onPlace` (LIT 変化ごとに両方呼ばれる) で
  **各隣接 6 マスを基点にその隣接 6 マスへ NC** (直上の強充電ブロック経由の伝播を担保する 2 段送信)。
- **ダスト** (`RedStoneWireBlock.updatePowerStrength`, 26.x では `DefaultRedstoneWireEvaluator` に切り出し・アルゴリズム同一):
  強度変化時に flag 2 で setBlock (NC なし) した後、**`HashSet<BlockPos>` に {自身 + 隣接 6} を入れ、HashSet のイテレーション順で
  各 pos から `updateNeighborsAt` (UPDATE_ORDER の 6 方向)** を送る。計 7 起点 × 6 方向。
  - **locational (MC-11193) の直接のコード根拠は、この HashSet イテレーション順が BlockPos のハッシュ値 = 座標に依存すること** [確定]。
  - wiki の「隣接 6 マス (下→上→北→南→西→東) を基準に…」という記述は集合**構築**順 (Direction.values() 順) であり、
    **送信順は HashSet 順で座標依存** — wiki 記述はここが不正確 (訂正)。
  - 接続形状変化時は `updateNeighborsOfNeighboringWires`/`checkCornerChangeAt` により水平隣接と斜め上下のワイヤにも同型の多段送信を行う。

補足事実:
- 更新機構は 1.19+ で NeighborUpdater 化。26.2 の実装は `CollectingNeighborUpdater` / `InstantNeighborUpdater` の 2 種で、
  NC 系メソッドは `@Nullable Orientation` (1.21.2 のワイヤ更新順刷新で導入、旧称 WireOrientation) を運ぶ。
  **orientation は experimental evaluator 専用の文脈情報で、null なら従来挙動** [確定: 26.2 デコンパイル]。
  (注: 旧記述の「ChainRestrictedNeighborUpdater / SimpleNeighborUpdater」は Yarn マッピング名。公式名は上記。)
- **update suppression**: 上記 1,000,000 総数制限の溢れ。skip 発生後も残りの tick 処理は継続する。再現要否は要判断。
- ダスト更新は**決定的だが locational (座標依存)**。上記の通りコード根拠まで確定。carpet fastRedstoneDust / TIS-Addition
  redstoneDustRandomUpdateOrder の存在とも整合。

### 4.3 動力源化と活性化の分離 (BUD の原理) [要検証: ArcFrout 草稿単一源だが実装上重要]
- 「動力源化 (powered)」に隣接更新は不要、「活性化 (状態変化)」は隣接更新を受けて初めて再評価される。→ powered なのに activated でない BUD 状態が生じる。
- **設計指針: powered フラグ更新と neighbor update 受信時の状態再評価を別レイヤに分ける。**

---

## 5. 信号モデル

### 5.1 信号強度 [確定]
- 0〜15 の 16 段階。動力部品は基本 15 を供給、ダストは 1 ブロックごとに 1 減衰 (最大 15 マス)。
- 複数信号源の合流は **max 合成** [確定: HLPtool 実装 + techmcdocs]。
- アナログ値を保持するのはダストとコンパレーターのみ。リピーターは 15 にリセット [要検証: ArcFrout 草稿]。
- 出典: https://ja.minecraft.wiki/w/レッドストーン回路、ArcFrout chap1

### 5.2 強/弱動力 (strong/hard・weak/soft powering) [確定]
- リピーター/コンパレーター/トーチ (直上)/レバー等 (取り付け面) から直接給電された導体 = **強動力源化** → 起動素子にもダストにも伝える。
- ダストから給電された導体 = **弱動力源化** → 起動素子には伝えるが**別のダストには伝えない**。
- 動力源化した導体が他の導体をさらに動力源化することはない。信号強度は動力源化を経ても維持 [要検証: 強度維持は ArcFrout 単一源]。
- 出典: https://ja.minecraft.wiki/w/レッドストーン回路 + ArcFrout chap1 の 2 源一致。

### 5.3 準接続 (QC) [確定 — デコンパイル悉皆確認済み]
- QC (1 ブロック上の位置の被動力チェック) を持つのは **PistonBaseBlock (通常/スティッキー共通)・DispenserBlock・DropperBlock の 3 クラスのみ**。26.2 jar の block パッケージ全 468 クラス grep で他に該当なし (Crafter は非対象)。
- 出典: 26.2 server.jar デコンパイル (hasNeighborSignal(pos.above()))、https://minecraft.wiki/w/Quasi-connectivity、carpet quasiConnectivity ルール。
- 注: ArcFrout の「間接続 4 種 (ダスト斜め含む)」はダスト斜め接続 (別機構) を含む独自上位概念。コード上の QC は上記 3 種。

### 5.4 ダストの給電対象と斜め接続 [確定: 26.2 RedStoneWireBlock デコンパイル]
- **給電対象** (`RedStoneWireBlock.getSignal`): 足元ブロック (下方向 query = 給電あり) + 接続方向の水平隣接のみ。
  **真上のブロックには給電しない** (query 方向 DOWN で常に 0)。水平は `getConnectionState` の接続判定を通った方向のみ。
- **形状の自動拡張と「延長端への給電」** [確定: 26.2 — `getConnectionState` / `getMissingConnections`]:
  `getSignal` は保持中の blockstate ではなく **`getConnectionState` を毎回再計算** して接続を判定する。
  この再計算は物理接続が **0 本なら cross (4 方向 SIDE)**、**1 本なら反対側も SIDE = 直線** に拡張する
  (2 本以上の bend/T/cross は拡張なし)。よって **直線ダストは物理接続の無い「延長端」にも給電する** が、
  接続していない**垂直方向 (直線に対し 90°) には給電しない**。#44 で疑われた「単一接続=直線ダストの隣接ピストン
  給電」はこの規則で、直線の延長端に当たるピストンは給電され、垂直に当たるピストンは給電されない (両者とも実機と一致)。
  形状×方向の給電マトリクスは **docs/research/11_dust-shape-powering.md** に集約。sim は接続を静的に持つが、
  拡張は接続導出層 (`mcstate.mcToSim` は vanilla 拡張済み blockstate をそのまま取り込み、
  `editor.computeWireConnections` は 0→cross / 1→直線 を適用) で吸収し、`power.ts` は `connections` を素直に読む
  → **power.ts に vanilla とのずれは無い** (#44 で `packages/sim/test/wire-shape-power.test.ts` により全形状確認)。
- **弱充電の実装機構** [確定]: dust には weak/strong の別チャネルはなく、`shouldSignal` フラグで実現される。
  ダスト自身の強度計算 (`calculateTargetStrength`) 中のみ `shouldSignal=false` になり、その間ワイヤの
  `getDirectSignal`/`isSignalSource` が 0/false を返す → **ダスト給電された導体は機構には信号を伝えるが、
  他のダストの強度計算には寄与しない** (= 弱充電)。`getDirectSignal` は通常時 `getSignal` と同値。
- **強度計算** (`calculateTargetStrength`): `max(getBestNeighborSignal(pos), 隣接ワイヤ最大値 − 1)`。
  斜め読み: 水平隣接が導体かつ自分の直上が非導体 → 斜め上のワイヤを読む / 水平隣接が非導体 → 斜め下のワイヤを読む。
  → ArcFrout の切断規則 (上の遮蔽が導体なら斜め上からの受信が切断) はこのコードと一致 [確定]。

---

## 6. コンポーネント別仕様

### wire (レッドストーンダスト)
- 即時伝播 (PLC)。強度減衰 1/ブロック、max 合成 [確定]。
- 接続形状 (dot/side/up) は PP 更新で維持 (`updateShape` は結線プロパティのみ更新し強度再計算しない。強度は NC 経由) [確定]。
- 更新順は locational・多段送信 (4.2 で確定)。
- **1.21.2+ の刷新 (Orientation, 未解明 #2 解消)** [確定: 26.2 デコンパイル + 24w33a/24w34a 公式チェンジログ]:
  - `RedstoneWireEvaluator` が 2 実装に分離: `DefaultRedstoneWireEvaluator` (**1.21.1 と同一アルゴリズム**) と
    `ExperimentalRedstoneWireEvaluator`。後者は **FeatureFlags.REDSTONE_EXPERIMENTS (experimental datapack) を
    有効にした世界のみ** (`RedStoneWireBlock.useExperimentalEvaluator`)。**既定挙動は 26.2 現在も 1.21.1 と同一** →
    「1.21.1 準拠 sim は 26.x 既定とも互換」。
  - experimental 側: 2 本の deque (turnOff/turnOn) による BFS で**全ワイヤの新強度を先に確定** (setBlock flag 2|128,
    flag 128 = ワイヤへの PP 抑止) → その後 `Orientation` (up/front/sideBias の 48 通り) の
    **back→front→左→右→下→上** 順で、電力を受けうるブロックだけに NC を送る。文脈が無い起点では
    `Orientation.random` (24w34a で left-first 化され、残る random は上下からの給電等の文脈不足時のみ)。
    詳細アルゴリズムの完全読解は experimental 対応を判断する時点で行う (01 §15-16 参照)。

### torch (レッドストーントーチ)
- NOT ゲート。状態変化は 2 gt 遅延の tile tick (`TOGGLE_DELAY = 2`)、priority 0 [確定: RedstoneTorchBlock]。
- 入力: 取り付けブロックのみを読む (床置き = 直下 `hasSignal(pos.below(), DOWN)`、壁付け = FACING の逆) [確定]。
- 給電: **取り付け面以外の全隣接 (床置きなら水平 4 + 上) に弱 15、直上ブロックのみ強充電**
  [確定: getSignal は取り付けブロックからの問い合わせのみ 0 (他 5 方向 15)、getDirectSignal は直上ブロックからの問い合わせのみ 15]。
- NC 受信時: 「LIT == 入力あり」という**不整合状態のときだけ** 2 gt 後の tick を予約 (willTickThisTick ガード付き) [確定]。
- **burnout** [確定: 未解明 #4 解消]: 定数 `RECENT_TOGGLE_TIMER=60` / `MAX_RECENT_TOGGLES=8` / `RESTART_DELAY=160`。
  tick 時に 60 gt より古いトグル記録を破棄 → 消灯のたびに記録を追加し、**同一 pos の記録が 8 件に達すると焼き切れ**
  (煙エフェクト levelEvent 1502) → **160 gt 後の tick で再点灯を試みる** (その時点でも 8 件あれば再点灯しない)。
  記録はワールド単位の WeakHashMap (`RECENT_TOGGLES`)。
- 1 gt パルスに反応しない [確定: NC は不整合時のみ予約 + tick 実行時に入力を再評価するため、
  2 gt 未満で入力が元に戻ると tick 時点で不整合が消えており状態変化しない]。

### repeater (リピーター)
- 遅延 `DELAY * 2` gt (1〜4 rt = 2〜8 gt)。priority -3/-2/-1 (2.2 表) [確定]。
- **tick 時再評価** [確定: DiodeBlock.tick、未解明 #3 解消]:
  1. ロック中なら何もしない。
  2. `shouldTurnOn` (入力再評価) を取り、ON かつ入力なし → OFF 化 (flag 2)。
  3. **OFF なら入力の有無にかかわらず ON 化** (flag 2)。このとき入力が既に消えていれば
     `scheduleTick(delay, VERY_HIGH=-2)` で OFF を追加予約 → **最小パルス幅 = 遅延を保証**。
  4. ON かつ入力あり → 変化なし。
- **NC 時の予約規則** [確定: DiodeBlock.checkTickOnNeighbor]: ロック中は無視。`POWERED != shouldTurnOn` かつ
  `!willTickThisTick(pos, this)` のときのみ予約。priority は 出力先が別ダイオードの背面/側面 (`shouldPrioritize`:
  出力先がダイオードかつその FACING が出力方向と不一致) → -3、ON→OFF → -2、その他 → -1。
  同 pos の既予約は LevelChunkTicks の重複無視 (2.1) に従う (キャンセルなし)。
- 入力読み (`getInputSignal`): 背面 `getSignal` に加え、**背面がワイヤなら接続形状に関係なく POWER を直読** [確定]。
- ロック [確定: RepeaterBlock.isLocked + SignalGetter.getControlInputSignal(diodesOnly=true)]:
  側面のダイオード (リピーター/コンパレーター) の direct signal > 0 で固定。ワイヤ・レッドストーンブロック・
  オブザーバーではロックされない。**LOCKED プロパティの更新は PP (updateShape) 経由** (側面軸からの shape 更新時に再計算)。
- 出力は常に 15 (`DiodeBlock.getOutputSignal` 既定) — 信号強度を保持しない [確定]。getDirectSignal = getSignal (前方へ強充電)。

### comparator (コンパレーター)
- 演算式 [確定: ComparatorBlock.calculateOutputSignal のデコンパイルで最終確定 (従来 3 源とも一致)]:
  - `back == 0 → 0` / `side > back → 0` / compare: `back` / subtract: `back − side` (side = `max(side_L, side_R)`)
- 遅延 **2 gt 固定** (`getDelay` が定数 2) [確定: 未解明 #4 解消]。priority -1/0 (2.2 表) [確定]。
- **NC 時の予約規則** [確定: ComparatorBlock.checkTickOnNeighbor]: `willTickThisTick` でなく、
  「計算出力 != BlockEntity 保持値 or POWERED != shouldTurnOn」のとき `scheduleTick(2, shouldPrioritize ? -1 : 0)`。
  tick で `refreshOutputState`: 出力値を ComparatorBlockEntity に保存し、POWERED を更新して前方更新。
- 側面入力 [確定: SignalGetter.getControlInputSignal(diodesOnly=false)]: ワイヤ (POWER 直読)・レッドストーンブロック (15)・
  その他は **direct signal (強出力) がその方向を向くもの** = リピーター/コンパレーター/**オブザーバー**。
  レバー/ボタン/トーチは水平方向へ direct signal を出さないため無効 (従来記述にオブザーバーを追加)。
  - 判定順序も確定 [1.21.1 SignalGetter.getControlInputSignal / DiodeBlock.getAlternateSignal]:
    ① `is(REDSTONE_BLOCK)` → **定数 15** (getDirectSignal は 0 なのに特例で 15。**compare / subtract 両モードで効く**。
    Java Edition 限定、15w47a 追加) → ② `is(REDSTONE_WIRE)` → POWER → ③ `isSignalSource()` のものだけ getDirectSignal。
    **target は isSignalSource=true だが getDirectSignal 非 override → 側面入力にならない** (発火中でも 0)。
    出典: https://minecraft.wiki/w/Redstone_Comparator (「Side inputs are accepted only from redstone dust,
    block of redstone [Java Edition only], redstone repeaters, other comparators, and observers」) + 上記デコンパイル。
    → #35 実機バグ報告 1 の根拠。sim は readComparatorSide で実装済み。
- 背面入力 (`getInputSignal` override) [確定]: 背面ブロックが `hasAnalogOutputSignal` なら**その値で上書き** (通常信号より優先)。
  そうでなく信号 <15 かつ背面が導体なら、さらに 1 マス先のコンテナ/額縁 (ItemFrame.getAnalogOutput) を読む (固体 1 個越し)。
- **コンテナ充填率→強度の変換式** [確定: AbstractContainerMenu.getRedstoneSignalFromContainer、未解明 #5 解消]:
  `f = (Σ 各スロットの count / maxStackSize) / スロット数` として `Mth.lerpDiscrete(f, 0, 15)` =
  `floor(f * 14) + (f > 0 ? 1 : 0)` — 通説の「floor(1+14*fill)」と同値 (空 = 0、非空は最低 1)。
- 1 gt パルスに必ずしも反応しない (2.4) [確定]。

### lever / button
- 即時 (tick 境界のプレイヤー入力 §1.4 で状態変化。ボタンの戻りのみ tile tick)。
- 給電 [確定: LeverBlock/ButtonBlock]: ON 中は全 query 方向に弱 15 (`getSignal`)、
  **取り付けブロックのみ強充電** (`getDirectSignal` は取り付け方向のみ 15)。
- 更新先 [確定]: 自身の隣接 6 + 取り付けブロックの隣接 6 (4.2 素子別例外)。
- ボタン持続 [確定: Blocks.java 登録値 `ticksToStayPressed`、未解明 #4 解消]: **石系 20 gt / 木系 30 gt**
  (現実装の 5/10 gt は誤り、04 G12)。矢が刺さっている間は tick 毎に再延長 (木のみ)。priority は NORMAL。

### lamp (レッドストーンランプ)
- 電力源ではない (信号を出力しない) [確定]。
- 点灯: NC 受信時に即時 setBlock (遅延なし)。消灯: NC 受信時に **4 gt の tile tick を予約し、tick 時に入力を再評価**して
  まだ無入力なら消灯 → 4 gt 未満の入力断では消灯しない [確定: RedstoneLampBlock、未解明 #4 解消]。

### redstone block (レッドストーンブロック) — I11 (#35) 実装済み

- 定数の弱動力源 [確定: 1.21.1 Blocks.REDSTONE_BLOCK = `PoweredBlock`]: `getSignal`=**15** (全方向)・
  `isSignalSource`=true・`getDirectSignal` 非 override (=**0** → 固体を強充電しない = weak のみ)。状態も tile tick も持たない。
- `.isRedstoneConductor(Blocks::never)` = **非導体** [確定]: 自身は被充電されず、ダストの上下斜め接続も**切らない**
  (石・ランプ・target とは対照的)。
- ダストは 4 面すべてで接続 [確定: RedStoneWireBlock.shouldConnectTo が `isSignalSource()` を受理]。

### target (ターゲットブロック) — I11 (#35) 折衷モデルで実装済み

- 投射物命中で発火する信号源 [確定: 1.21.1 TargetBlock]。本 sim は投射物 (エンティティ) 系を持たないため
  「手動トリガ + 持続 gt + 全方向 weak」の折衷モデルで扱う (10 §6)。
- 給電 [確定]: `getSignal`=`OUTPUT_POWER` (=`BlockStateProperties.POWER`, 0-15、全方向 weak)・
  `isSignalSource`=true・`getDirectSignal` 非 override (=0 → 強充電しない)。既定フルキューブのため
  `isRedstoneConductor`=true (被充電され得る・ダストの斜め接続を切る)。ダストは 4 面接続。
- 発火 (`onProjectileHit`→`updateRedstoneOutput`) [確定]: 命中強度 = 中心からの距離で **1..15** (`getRedstoneStrength`)、
  持続 = 矢/トライデント (`AbstractArrow`) **20 gt** (`ACTIVATION_TICKS_ARROWS`) / その他 **8 gt** (`ACTIVATION_TICKS_OTHER`)。
  `setOutputPower` が POWER を setBlock (flag 3) し `scheduleTick(pos, block, 持続)` を予約 (priority NORMAL=0)。
  `hasScheduledTick` が真の間は**再発火を無視** (持続の延長なし)。
- `tick` [確定]: OUTPUT_POWER != 0 なら 0 に戻す (消灯)。
- `onPlace` [確定]: OUTPUT_POWER>0 かつ pending tick 無しで設置されたら **0 に戻す** (flag 18)。
  → setblock / scarpet の直接 blockstate 変更では発火不可 (onPlace が即 0 化する。実機で確認済み)。
- sim 折衷モデル (I11): activateBlock で中心命中を模し **outputPower=15 + 矢の 20 gt 持続** を採用。
  発火に投射物エンティティが必須で実機 fixture が作れないため、消灯系列は手書き単体テストで検証する。
- **導体としての伝導** [確定: #35 実機バグ報告 2 → 1.21.1 デコンパイルで確定。実機 fixture target-conduct]:
  target は信号源かつ **導体** (前項のとおり isRedstoneConductor=true) なので、solid と同じ規則で充電される。
  ダストが指す/上に乗る target の充電の実体は `RedStoneWireBlock.getDirectSignal` = `shouldSignal ? getSignal : 0` —
  つまり**ダストは自分が給電する対象 (足元 + 接続方向) に direct signal も出す**。導体はこれを
  `SignalGetter.getSignal` の `isRedstoneConductor` 分岐 (`max(自身の getSignal, getDirectSignalTo)`) で拾うため、
  ダストが指す target は隣接機構 (lamp)・直上トーチの土台判定・ダイオードの背面読み (`DiodeBlock.getInputSignal` →
  `Level.getSignal`) すべてに充電値をアナログのまま伝える。
  一方、**他のダストの強度計算には見えない** (`calculateTargetStrength` が `shouldSignal=false` にしてから
  `getBestNeighborSignal` を呼ぶため、ワイヤ由来の direct signal が消える) — これは solid と同一で、
  「dust が指す target は特別に強く給電され隣接 dust にも伝わる」という俗説は**コード上の根拠なし** (棄却)。
  現行 wiki の記述も「As targets are also conductive, this property can be used to compact redstone circuits」
  (伝導) と「Unlike most other conductive blocks, it also redirects adjacent redstone dust toward it」(接続形状) のみで、
  強給電の特例は記載されていない。
  出典: https://minecraft.wiki/w/Target + https://minecraft.wiki/w/Conductivity (「Target blocks and jukeboxes are
  unique in that they connect to adjacent redstone dust」) + https://minecraft.wiki/w/Redstone_Dust (「Powered redstone
  wire on top of, or pointing at, a conductive block provides weak power to the block」)。
  典拠クラス: TargetBlock / Blocks.java (TARGET 登録) / RedStoneWireBlock (getDirectSignal, calculateTargetStrength,
  shouldSignal) / SignalGetter (getSignal, getDirectSignalTo) / ComparatorBlock.getInputSignal (導体 1 個越しの
  コンテナ読みも isRedstoneConductor 判定のため target 越しに可)。
  → sim は power.ts の導体判定 (isConductor = solid | target) / computeWirePower / readComparatorBack に実装済み。

### piston (I7 実装済み)
- BEC: 動力判定 (NC 受信時) → block event を予約 → ブロックイベントフェーズで実移動。0-tick 系はこのフェーズ差が前提 [確定]。
- 起動判定 `getNeighborSignal` (PistonBaseBlock, デコンパイル): **facing 面を除く 6 方向の hasSignal** ∪ **自身 down 面** ∪ **1 個上のマスの down 面を除く hasSignal** で true。QC (5.3) はこの「1 個上」判定に由来 [確定]。→ sim `shouldExtend` と一致。
- QC 対象 (5.3) [確定]。push limit 12 [**確定**: carpet `pushLimit` ルール既定 12 (options 10/12/14/100) = カスタマイズ可能な上限。バニラ値は 12]。block entity は押せない [確定: carpet `movableTileEntities` ルール既定 false の逆読み]。
- moving BE の progress は 0 → 0.5 → 1.0 の **2 ステップ = 2 gt** で完了 [確定: PistonMovingBlockEntity.tick の `progress += 0.5F` + G4mespeed `gs_numberOfSteps = 2.0f`]。

#### ピストン伸長タイムライン [確定: 1.21.1 デコンパイル + 実機 fixture piston-basic]

レバー ON → ピストン伸長を、実機 fixture `piston-basic` (piston@[2,1,0] facing=east, 石@[3,1,0]、レバー入力 t2) の実測系列に対応づける。tick 表記は fixture 規約 (state[t] = tick t の ST フェーズ完了 + inputs[t] 適用直後)。

| gt | フェーズ (§1.2) | vanilla の出来事 (デコンパイル) | ブロック状態 | sim の対応 |
|---|---|---|---|---|
| **t2 境界** | プレイヤー入力適用 (§1.4) | レバー ON → NC → wire=15。piston.`neighborChanged`→`checkIfExtend`→`getNeighborSignal`=true→`PistonStructureResolver.resolve()` OK → `level.blockEvent(pos, EXTEND=0, facing)` を**キュー** (runBlockEvents は当 tick で既に通過済み) | piston `extended=false` のまま。moving なし | `activateBlock`→NC→`scheduleBlockEvent('extend')` をキュー |
| **t3 phase8** (runBlockEvents) | `triggerEvent(type=0)`: 電源再確認 → `moveBlocks` が MOVING_PISTON + `PistonMovingBlockEntity(progress=0)` を head セル [3,1,0]・押出先 [4,1,0] に生成、base を EXTENDED 化 | piston `extended=true`、[3,1,0]/[4,1,0] = `moving_piston` | BE フェーズ: `executeBlockEvent`→`moving_piston` 化 + `schedule(pos, 2gt)` |
| **t3 phase10** (tickBlockEntities) | 生成直後の BE も**同 tick に tick する** (作成は phase8 = `tickingBlockEntities`=false なので `blockEntityTickers` に直接追加 → phase10 で走る)。progressO=0<1 → progress 0.5 | `moving_piston` のまま | (tile tick 抽象。個別 progress は保持しない) |
| **t4 phase10** | progressO=0.5<1 → progress 1.0 (clamp) | `moving_piston` のまま | 変化なし (dueTick=5 未到達) |
| **t5 phase10** | progressO=1.0≥1 → finalize: `removeBlockEntity` + `setBlock` 最終形 (head セル→`piston_head`、押出先→`石`) + `neighborChanged` | [3,1,0]=`piston_head`, [4,1,0]=`石` | **ST フェーズ**: `executeScheduledTick(dueTick=5)`→`moving_piston`→`into` (最終形) |

- **典拠クラス** (out/1.21.1): `PistonBaseBlock.neighborChanged/checkIfExtend/getNeighborSignal/triggerEvent/moveBlocks`、`PistonMovingBlockEntity.tick/finalTick` (`progressO=progress; progressO>=1.0F なら finalize、さもなくば progress+=0.5F`)、`Level.tickBlockEntities/addBlockEntityTicker` (`tickingBlockEntities` フラグで pending 振り分け → 当 tick 生成 BE は同 tick 実行)。
- **mod 出典**:
  - carpet: `pushLimit` (既定 12)、`quasiConnectivity` (既定 true = 「上のマスが受電で反応」)、`movableTileEntities` (既定 false)、`pistonClippingFix` (progress 0/20/40/100% で当たり判定補正) — https://gist.github.com/skyrising/cea2495437afea0cc3af2bb11d6a1856 / https://github.com/gnembon/fabric-carpet
  - G4mespeed: `GSPistonMovingBlockEntityMixin` (client, 1.21.x) が `progress`/`progressO` を @Shadow し `gs_numberOfSteps = 2.0f` で補間 (`val = (progress*2 + tickDelta)/2`) → **伸長 = 2 ステップ = 2 gt** を裏付け。common mixin は `gs_ticked` フラグで「BE が最低 1 回 tick 済みか」を追跡 — https://github.com/G4me4u/g4mespeed/blob/1.21.x/src/main/java/com/g4mesoft/mixin/client/GSPistonMovingBlockEntityMixin.java
  - minecraft.wiki: 「extension takes 2 game ticks」「start delay = **0 tick (scheduled/random tick・block event 由来)** / **1 tick (player action・entity・block entity phase 由来)**」「redstone block を押し合うピストン連鎖は 3 tick 間隔」— https://minecraft.wiki/w/Piston

- **「3 gt (= 1.5 rt)」の数え方** [確定]:
  - **start delay 1 gt** (t2→t3): レバー = player action 由来。入力は tick 境界 (§1.4) で適用され、当 tick の runBlockEvents (phase8) は通過済みのため BE は**翌 tick**の phase8 で発火。⇔ 電源が scheduled tick / block event 由来なら phase4/8 が phase8 より前 or 同フェーズで、start delay は **0 gt** になる (wiki 準拠)。
  - **extension 2 gt** (t3→t5): moving BE の progress が 0→0.5→1.0 と 2 ステップ進み 3 回目の tick (progressO≥1.0) で最終ブロックが確定。moving_piston ブロックは t3・t4 の 2 tick 在位。
  - **トリガ→完了 = t2→t5 = 3 gt = 1.5 rt** ← ユーザ指摘の「3 gt かけて伸びる」はこの区間 (player-action 起動時)。BE 発火 (t3) からの計数だと 2 gt (extension のみ)。両者は同一系列の別区間で、食い違いではない。
  - sim は上記の各 tick を dump 粒度で一致再現 (fixture `piston-basic` t3 moving / t5 確定 が green)。**start delay** はアーキテクチャで自然成立: 入力は tick 境界適用 → 翌 tick の BE フェーズで発火 (1 gt)、scheduled tick 起動なら同 tick の BE フェーズで発火 (0 gt)。

- **既知の抽象化 (v1 制限) [確定: microTiming 実機観測 2026-07-03]**: sim は moving_piston の確定を **ST フェーズ**の tile tick (`schedule(pos,2gt)`) で行うが、vanilla は **block entity フェーズ** (phase10) の `PistonMovingBlockEntity.tick` で行う (microTiming で `Moving Piston→Piston Head` が **@ TileEntity**、実行 +2gt で発火するのを観測。retract 側 `Moving Piston→Piston` も同相。docs/research/09_snapshots/two-piston-locational.md)。ST (phase4) は runBlockEvents (phase8) の**前**、block entity (phase10) は**後**なので、確定したブロックが下流のピストンを起動する連鎖 (redstone block を押し合う等) では、下流 BE が sim では同 tick・vanilla では翌 tick に発火し **2 tick 間隔 vs 3 tick 間隔**の差が出る。**#51 で redstone_block / target / note_block を可動化** (vanilla PushReaction NORMAL 準拠、0-tick 系の前提) したため、この経路は到達可能になった。差が出るのは「rblock 等の確定ブロックが下流ピストンを**直接**起動する連鎖」のみで、既存 fixture にこの構成は無い (dust 給電経由の dynamic-connect-push 等は dump 粒度で一致)。該当連鎖の忠実化 (BlockEntity 相の tile tick 化) は必要になった時点で別 issue とする。

### observer (実装済み: I8 / issue #16)
- PP/SU 更新で起動、NC では起動しない [確定: 4.1、ObserverBlock は neighborChanged 非 override]。
  起動条件: `updateShape` で **観測面 (FACING) 方向からの shape 更新** かつ非 POWERED のとき
  `startSignal` → `hasScheduledTick` (キュー全体) を確認して 2 gt の tile tick (priority 0) を予約 [確定]。
- tick [確定: ObserverBlock.tick]: OFF なら ON 化 + **自身の OFF tick (2 gt) を先に予約**してから前方更新
  (`updateNeighborsInFront`)。ON なら OFF 化して前方更新 → パルス幅 2 gt。
- 給電: 出力は観測面の反対側 (背面) の 1 ブロックのみ。`getSignal`/`getDirectSignal` とも query 方向 == FACING
  (= 背面側の隣接ブロックからの問い合わせ) で 15 → 背面ブロックを強充電できる [確定]。
- 設置時に POWERED だった場合は無更新で消灯 (onPlace, flag 18)、除去時は前方へ消灯通知 (onRemove) [確定]。
- **facing 意味論の確定 (I8)**: blockstate `facing` = **観測方向 (顔のある面が向く先)**、出力は `OPPOSITE[facing]` の背面
  1 マス。sim の `ObserverState.facing` は vanilla FACING と同一で **反転しない** (mcstate/viewer/nbtIO とも piston と
  同じ非反転規則。repeater/comparator/wall_torch の flip とは異なる)。ObserverBlock.updateShape の
  `state.getValue(FACING) == direction` (direction = pos→変化した neighbor) と minecraft.wiki (「facing は観測方向」)
  の両方で確定。実機 fixture `observer[facing=west]` がレバー (西) を観測しコンパレーター (東=背面) に出力する構成で一致検証済み。
- **実装 (packages/sim)**: PP は「シミュレーション中に観測可能な blockstate が変化した座標」から隣接 6 (PP_UPDATE_ORDER
  西東北南下上) へ発行 (`SimWorld.emitShapeUpdate`)。受信者はオブザーバーのみ (`observableChanged` が solid.powered /
  comparator.outputPower / container.signal など blockstate でない派生値を除外)。オブザーバー tick は apply を経由せず
  「powered 反転 → PP → (ON なら) OFF tick 予約 → 背面 NC」の順で実行し、§2.4 の飲み込み順序を保証する。
- **実機 fixture (I8)**: observer-detects-dust / observer-piston / observer-comparator-swallow (§2.4 最重要回帰) /
  observer-chain の 4 本を Fabric 1.21.1 + carpet で生成し tick 単位一致を確認済み。

---

## 7. 未解明事項 (次調査の TODO)

2026-07-02 の 1.21.1 + 26.2 デコンパイル (I1, tools/decompile/) で #1〜#6, #8, #10 を解消。

| # | 項目 | 状態 |
|---|---|---|
| 1 | NC/PP/CU の送信方向順のデコンパイル裏取り | **解消 [確定]** → §4.2 (NeighborUpdater.UPDATE_ORDER / BlockBehaviour.UPDATE_SHAPE_ORDER / Level.updateNeighbourForOutputSignal) |
| 2 | ダスト多段送信順の全貌 + WireOrientation (1.21.2+) の刷新内容 | **解消 [確定]** → §4.2 (HashSet 順 = locational の根拠) + §6 wire (Orientation は experimental のみ・既定不変)。experimental アルゴリズムの完全読解のみ将来課題 |
| 3 | DiodeBlock.tick の再評価・再スケジュール規則の正確な形 | **解消 [確定]** → §6 repeater |
| 4 | トーチ burnout 閾値、ボタン/レバー持続 gt、ランプ消灯遅延、コンパレーター遅延 gt | **解消 [確定]** → §6 (burnout 8 回/60gt+160gt 復帰、ボタン石 20/木 30 gt、ランプ消灯 4 gt、コンパレーター 2 gt) |
| 5 | コンパレーターのコンテナ充填率→強度変換式 | **解消 [確定]** → §6 comparator (lerpDiscrete 式) |
| 6 | tile tick 65536 件超過時の挙動 | **解消 [確定]** → §2.3 (ブロック/液体各 65,536、超過分は持ち越し) |
| 7 | チャンクティック内サブ処理の厳密順序、ディメンション処理順 | 未解明 [要検証] — デコンパイル (優先度低) |
| 8 | update suppression (制限溢れ) の再現要否と正確な値 | **値は解消 [確定]** → §4.2 (総数 1,000,000、超過分 skip)。再現要否の判断のみ残 (04 §4-3) |
| 9 | /tick freeze 中の scarpet __on_tick 発火有無 | 未解明 [要検証] — 実機実験 (ハーネス構築時、I9) |
| 10 | 対象バージョンの確定 | **解消** → 典拠 1.21.1 + 26.x 併読 (冒頭 + CONTRIBUTING.md 参照) |

---

## 8. 棄却済みクレーム (verdicts で refuted)

| クレーム | 棄却理由 | 出典 |
|---|---|---|
| 「MCHPRS の素の redstone 実装はバニラ 1.20.4 のワイヤ更新順序・ティック優先度を完全再現している」 | **refuted**。MCHPRS はワイヤ電力変化時に無条件で theosib RedstoneWireTurbo を使用しており、theosib 本人の原典文書が「更新順序は完全に再編成」「locational 挙動は意図的に除去 (MC-11193 の修正)」「instant dropper line 回路が 1 件壊れた」と明記。バニラ更新順の再現ではなく意図的変更 | https://raw.githubusercontent.com/gnembon/fabric-carpet/master/src/main/java/carpet/helpers/RedstoneWireTurbo.java (theosib 本人コメント)、https://github.com/MCHPR/MCHPRS crates/redstone/src/wire/mod.rs |
| (参考: 不整合として棄却) ArcFrout chap2 の「BEC は tick **最終盤**の Block Events フェーズ」 | デコンパイル (1.21.1) と wiki の双方で Block Events は Entity/BlockEntity より**前の中盤**フェーズ。草稿 notes の順序リスト自体は正しい | 1.21.1 server.jar デコンパイル、https://minecraft.wiki/w/Tick |

→ **ワイヤ更新順の実装典拠に MCHPRS/RedstoneWireTurbo を使ってはならない。** locational 挙動込みのバニラ順はデコンパイル + microTiming で確定させる。
