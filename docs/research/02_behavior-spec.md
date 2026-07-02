# 02. 挙動仕様整理 v0 (Java Edition)

redstone-sim が準拠すべき Java Edition の挙動仕様。現時点で確度付きで言える範囲の整理 + 未解明点の明示。
確度ラベル: **[確定]** = 複数源一致 or デコンパイル一次確認 / **[要検証]** = 単一源・未検証。
対象バージョンの目安: 1.18〜1.21.1 で検証済みの範囲を基準とし、1.21.2+ の差分 (WireOrientation) は個別注記。

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

---

## 2. スケジュールティック (tile tick)

### 2.1 実行規則 [確定] (1.21.11 公式デコンパイルで直接確認)
- **ブロックティック → 液体ティック** の 2 段。別キュー別フェーズ。
- ブロックティックは **priority 昇順 → 同 priority 内は予約順 (subTickOrder)** で実行 (ScheduledTick.DRAIN_ORDER)。液体ティックは priority なし・予約順のみ。
- **collect-then-execute**: 期限が来た tick を先に収集してから実行する。実行中に新規スケジュールされた tick は (delay 0 でも) **同 tick では走らず次 tick 送り**。
  - 出典: 1.21.11 デコンパイル LevelTicks.tick (collectTicks→runCollectedTicks)、SubTick WorldTickSchedulerMixin、https://minecraft.wiki/w/Tick
- **重複予約の扱い** [確定]: LevelChunkTicks.schedule は (位置, ブロック種) キーで既存予約があると新規予約を**無視**。さらに willTickThisTick が当該 tick 実行バッチ中の再予約を防ぐ。→ **同 pos+block に予約は常に 1 件、キャンセル API はなし、action は実行時に世界状態から決定**。
- 実行時検証 [確定]: tile tick 実行時にその座標のブロックがスケジュール時の型と一致しなければ no-op (SubTick verifyBlock/verifyFluid で確認)。

### 2.2 TickPriority [確定] (1.21.11 デコンパイル全ブロック grep で確認)

| 部品 | 条件 | priority |
|---|---|---|
| リピーター | 出力先が別のダイオードの側面/背面 | -3 (EXTREMELY_HIGH) |
| リピーター | 信号が切れる (オフ化) とき | -2 (VERY_HIGH) |
| リピーター | その他 | -1 (HIGH) |
| コンパレーター | 出力先が別のダイオードの側面/背面 | -1 (HIGH) |
| コンパレーター | その他 | 0 (NORMAL) |
| その他全ブロック (トーチ・オブザーバー含む) | — | 0 (NORMAL) |

- 出典: DiodeBlock.checkTickOnNeighbor / ComparatorBlock (1.21.11 デコンパイル)、https://ja.minecraft.wiki/w/ティック

### 2.3 件数上限
- 1 tick あたり最大 65,536 件 [確定: en/ja wiki 一致。ただし「ブロック・液体それぞれ」(ja) vs「総数」(en) の表現差あり]。
- **超過時の持ち越し挙動は未解明** [要検証]。

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
- 「オブザーバーは PP/SU で起動し NC/BU では起動しない」は wiki + ArcFrout の 2 源一致 [確定]。

### 4.2 送信方向順 [要検証 — 最優先のデコンパイル検証項目]

| 更新種 | 通常の送信順 | 出典 |
|---|---|---|
| NC | 隣接 6 マスへ **西→東→下→上→北→南**、連鎖は DFS (プッシュ型) | https://ja.minecraft.wiki/w/ブロック更新 (単一源) |
| PP | 隣接 6 マスへ **西→東→北→南→下→上** (NC と異なる) | 同上 (単一源) |
| CU | 水平隣接 (固体 1 個越し含む) へ **北→東→南→西** | 同上 (単一源) |

素子別例外 [要検証: 同 wiki 単一源]:
- レバー/ボタン/感圧板/トリップワイヤーフック: 自身の隣接 6 + 接着先マス基準で再送。
- リピーター/コンパレーター: 出力先 1 マス → その隣接 5 マス (自身除く)。
- ダスト: 隣接 6 マス (下→上→北→南→西→東) を基準に、さらにその隣接 6 マス (西→東→下→上→北→南) へ送る多段送信。水平連結・斜め連結時に追加段あり。

補足事実:
- 更新機構は 1.19+ で NeighborUpdater 化。1.21.5 では ChainRestrictedNeighborUpdater (深度制限付きキュー) / SimpleNeighborUpdater の 2 実装で、シグネチャに **WireOrientation** (1.21.2 のワイヤ更新順刷新で導入) を持つ [確定: rubix_mod mixin 対象 + 26.2 jar の CollectingNeighborUpdater クラス実在]。
- **update suppression**: 隣接更新に処理スタック/深度制限があり溢れさせる技術が存在する [確定: carpet updateSuppressionBlock ルール + ChainRestrictedNeighborUpdater の maxUpdateDepth]。再現要否は要判断。
- ダスト更新は**決定的だが locational (座標依存)**。MC-11193 が既知バグとして仕様化 [確定: carpet fastRedstoneDust ルール記述 + TIS-Addition redstoneDustRandomUpdateOrder の存在]。座標依存の一因は HashSet 系イテレーション順 [要検証: ArcFrout 構想のみ]。

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

### 5.4 ダストの給電対象と斜め接続 [要検証]
- ダストが弱充電するのは「足元ブロック + connections が指す先」のみ。上方向・非接続方向には充電しない (current 調査の記憶ベース知見、要デコンパイル裏取り)。
- 斜め上下のダスト接続の切断規則 (ArcFrout chap1 単一源): ダストの上の遮蔽が**導体**なら斜め上→中心の受信が完全切断 (双方向送信は可)、**不導体** (ガラス等) なら斜め上からの受信が部分切断 (中心→斜め上への一方向送信のみ)。

---

## 6. コンポーネント別仕様

### wire (レッドストーンダスト)
- 即時伝播 (PLC)。強度減衰 1/ブロック、max 合成 [確定]。
- 接続形状 (dot/side/up) は PP 更新で維持。SU では強度再計算しない [要検証]。
- 更新順は locational・多段送信 (4.2)。**1.21.2+ は WireOrientation 導入で更新順序が刷新されており、1.21.1 以前と非互換** [要検証: 刷新の中身は未調査]。

### torch (レッドストーントーチ)
- NOT ゲート。状態変化は 2 gt 遅延の tile tick、priority 0 [確定: priority はデコンパイル、遅延は wiki/ArcFrout]。
- 給電: 取り付け面以外の全隣接 (水平 4 方向 + 上) に弱 15、直上ブロックのみ強充電 [要検証: current 調査の記憶ベース、要裏取り]。
- **burnout**: 短時間に規定回数トグルで焼き切れ。RedstoneTorchBlock.isBurnedOut(World, pos, addNew) が存在 [確定: rubix_mod mixin]。**閾値 (通称 8 回/60gt) は未裏取り** [要検証]。
- 1 gt パルスに反応しない [要検証: ja wiki]。

### repeater (リピーター)
- 遅延 1〜4 rt = 2〜8 gt。priority -3/-2/-1 (2.2 表) [確定]。
- **tick 実行時に入力を再評価** (DiodeBlock)。オン化時に入力が既に消えていればオフを再スケジュール → **最小パルス幅 = 遅延を保証** [要検証: current 調査の記憶ベース。DiodeBlock.tick の正確な再スケジュール規則はデコンパイル確定が必要]。
- ロック: 側面からの別リピーター/コンパレーター出力で状態固定 [確定: 一般知識レベルだが数値なし]。
- 信号強度を保持せず 15 にリセット [要検証]。

### comparator (コンパレーター)
- 演算式 [確定: HLPtool 実装 + minecraft.wiki + techmcdocs の 3 源一致]:
  - compare: `side > back ? 0 : back`
  - subtract: `max(back − max(side_L, side_R), 0)`
  - (一般形: `out = max(0, in − max(left, right))`、側面 2 つは max)
- priority -1/0 (2.2 表) [確定]。
- 側面入力として有効なのは ダスト・リピーター・コンパレーター・レッドストーンブロック のみ (レバー/ボタン/トーチは無効) [要検証: current 調査の記憶ベース]。
- 背面から 弱/強充電ブロックの信号・コンテナ充填率 (固体 1 個越し含む) を読める [確定: CU の存在 + wiki。**充填率→強度の変換式は未調査** [要検証]]。
- 1 gt パルスに必ずしも反応しない (2.4) [確定]。
- 遅延値 (1 rt?) の正確な gt 数は本調査データに明示なし [要検証]。

### lever / button
- 即時 (PI フェーズ相当のプレイヤー入力で状態変化)。取り付けブロックのみ強充電、他隣接は弱 15 [要検証: current 調査の記憶ベース]。
- ボタン持続: 石 20 gt / 木 30 gt [要検証: current 調査の記憶ベース。現実装の 5/10 gt は誤りの可能性大]。

### lamp (レッドストーンランプ)
- 電力源ではない (信号を出力しない) [確定]。点灯は即時、消灯遅延 (通説 4 gt) は**本調査データに典拠なし** [要検証]。

### piston (未実装・仕様のみ)
- BEC: 動力判定 (NC 受信時) → block event を予約 → ブロックイベントフェーズで実移動。0-tick 系はこのフェーズ差が前提 [確定]。
- QC 対象 (5.3) [確定]。push limit 12 [要検証: carpet ルールの逆読み、数値は未確認]。block entity は押せない [確定: carpet movableBlockEntities ルールの逆読み]。格納 1 rt = 2 gt [要検証: ArcFrout chap2]。

### observer (未実装・仕様のみ)
- PP/SU 更新で起動 (NC では起動しない) [確定: 4.1]。起動するとパルス用 tile tick (priority 0) を作成し、オン→2 gt 後オフ [要検証: パルス幅の典拠はデコンパイル verdicts の間接確認のみ]。
- オン時に自身のオフ tick を近傍更新より先に登録する (2.4) [確定]。

---

## 7. 未解明事項 (次調査の TODO)

| # | 項目 | 現状 | 取得手段 |
|---|---|---|---|
| 1 | NC/PP/CU の送信方向順のデコンパイル裏取り | wiki 単一源 | 26.x jar の CollectingNeighborUpdater / Block.updateNeighborsAt 直読 |
| 2 | ダスト多段送信順の全貌 + WireOrientation (1.21.2+) の刷新内容 | 未調査 | RedStoneWireBlock / ExperimentalRedstoneWireEvaluator デコンパイル + TIS-Addition microTiming |
| 3 | DiodeBlock.tick の再評価・再スケジュール規則の正確な形 | 記憶ベース | デコンパイル |
| 4 | トーチ burnout 閾値、ボタン/レバー持続 gt、ランプ消灯遅延、コンパレーター遅延 gt | 記憶ベース or 無典拠 | デコンパイル + 実機 |
| 5 | コンパレーターのコンテナ充填率→強度変換式 | 未調査 | デコンパイル |
| 6 | tile tick 65536 件超過時の挙動 | 記述なし | デコンパイル |
| 7 | チャンクティック内サブ処理の厳密順序、ディメンション処理順 | 表現差/矛盾あり | デコンパイル (優先度低) |
| 8 | update suppression (深度制限溢れ) の再現要否と正確な深度値 | 存在のみ確定 | ChainRestrictedNeighborUpdater デコンパイル |
| 9 | /tick freeze 中の scarpet __on_tick 発火有無 | 独立ソースなし | 実機実験 (ハーネス構築時) |
| 10 | 対象バージョンの確定 (1.20.4 / 1.21.1 / 1.21.2+ / 26.x) | 未決定 | 意思決定 (04 参照) |

---

## 8. 棄却済みクレーム (verdicts で refuted)

| クレーム | 棄却理由 | 出典 |
|---|---|---|
| 「MCHPRS の素の redstone 実装はバニラ 1.20.4 のワイヤ更新順序・ティック優先度を完全再現している」 | **refuted**。MCHPRS はワイヤ電力変化時に無条件で theosib RedstoneWireTurbo を使用しており、theosib 本人の原典文書が「更新順序は完全に再編成」「locational 挙動は意図的に除去 (MC-11193 の修正)」「instant dropper line 回路が 1 件壊れた」と明記。バニラ更新順の再現ではなく意図的変更 | https://raw.githubusercontent.com/gnembon/fabric-carpet/master/src/main/java/carpet/helpers/RedstoneWireTurbo.java (theosib 本人コメント)、https://github.com/MCHPR/MCHPRS crates/redstone/src/wire/mod.rs |
| (参考: 不整合として棄却) ArcFrout chap2 の「BEC は tick **最終盤**の Block Events フェーズ」 | デコンパイル (1.21.1) と wiki の双方で Block Events は Entity/BlockEntity より**前の中盤**フェーズ。草稿 notes の順序リスト自体は正しい | 1.21.1 server.jar デコンパイル、https://minecraft.wiki/w/Tick |

→ **ワイヤ更新順の実装典拠に MCHPRS/RedstoneWireTurbo を使ってはならない。** locational 挙動込みのバニラ順はデコンパイル + microTiming で確定させる。
