# 06. 検証ツール評価 — レイヤ C (更新順 ground truth) のツール選定

対象: docs/research/04 §2.2-2.3 の 3 層検証ハーネスのうち **レイヤ C = サブティック内の neighbor update 順の ground truth 取得** に使うツールの選定。
批評 05 §3 (レイヤ C 中核ツールが実機未検証・ライセンス未確認・対抗馬未調査) と §5 (バニラ GameTest 未検討) の解消。

確度ラベル: **[確定]** = 一次資料 or 実機実測 / **[要検証]** = 単一源 or 未検証。全主張に出典 URL を付す。

---

## 1. レイヤ C に求める要件

I6 (更新 3 種 NC/PP/CU の分離と方向順実装) の受け入れ基準は「**microTiming ログと更新順が一致する locational fixture 1 件以上**」(04 §3)。この検証に必要なツール要件:

1. **サブティック内の更新順**が観測できる (どのブロックがどの順で block update を受けた/発したか)。tick 粒度の状態 diff (レイヤ A = scarpet) では取れない情報。
2. 更新の**種別**が区別できると尚良い (NC = neighbor update / PP = post-placement/shape / comparator update)。I6 はこの 3 種の分離が主眼のため。
3. **対象バージョン 1.21.1** で動く (典拠バージョン、mc-harness も 1.21.1。01 §15/§16, 04 §4.1)。
4. **mc-harness (docker Fabric + rcon-only, ポート非公開) への組み込みやすさ**。理想は scarpet と同じく「rcon 1 コマンド → 機械可読出力をホストが回収」の自動パイプライン。
5. ライセンスが実機利用・fixture 化に支障しないこと。

---

## 2. Carpet-TIS-Addition microTiming

出典: https://github.com/TISUnion/Carpet-TIS-Addition / https://carpet.tis.world/docs/loggers / https://modrinth.com/mod/carpet-tis-addition

### 2.1 対応バージョン・ライセンス
- **1.21.1 対応 [確定: Modrinth API]**。release 版 v1.74.3〜v1.81.0 が全て `game_versions=[1.21, 1.21.1]` / `loader=fabric` / `version_type=release`。最新 release は v1.81.0。`server_side=optional` でサーバ単体でも動作。出典: https://api.modrinth.com/v2/project/carpet-tis-addition/version?game_versions=[%221.21.1%22]
- **ライセンス = LGPL-3.0-only [確定]**。出典: Modrinth API の `license` フィールド (`{"id":"LGPL-3.0-only"}`) + GitHub リポジトリバッジ。外部 mod としての実行・挙動観測は自由。派生 mixin を配布する場合のみ LGPL 条件 (ソース開示・継承) に従う。観測された更新順という「事実」の fixture 化は著作権対象外 (03 の運用ルールと同じ)。

### 2.2 microTiming の実出力形式 [確定: ソース直読]
出典: https://github.com/TISUnion/Carpet-TIS-Addition/tree/master/src/main/java/carpettisaddition/logging/loggers/microtiming/events

イベントを**発生順に 1 イベント 1 行**のチャットメッセージ (Text component) として出力する。`events/` パッケージのイベントクラス実体:

| イベントクラス | 内容 |
|---|---|
| `DetectBlockUpdateEvent` | ブロックが block update を**検出**した (neighborChanged 等の受信) |
| `EmitBlockUpdateEvent` / `EmitBlockUpdateRedstoneDustEvent` | ブロックが block update を**発した**。update type (NC/PP 等) を `blockUpdateType.toText()` で表示。ダストは専用版 |
| `ScheduleBlockUpdateEvent` | block update の予約 |
| `ScheduleTileTickEvent` / `ExecuteTileTickEvent` | tile tick の予約 / 実行。`ExecuteTileTick` は priority を `"%d (%s)"` = `値 (列挙名)` 形式で表示 (例 `0 (NORMAL)`)、ACTION_END で結果を付す |
| `ScheduleBlockEventEvent` / `ExecuteBlockEventEvent` | block event (ピストン等) の予約 / 実行。結果 success/fail |
| `BlockStateChangeEvent` / `BlockReplaceEvent` | ブロック状態変化 / 置換 |
| `PistonComputePushStructureEvent` | ピストン押し構造の計算 |

各行の構成 = **アクション種別** (`emit` / `detect` / `execute` / `schedule`、`COLOR_ACTION`) + **対象種別** (block update type または `tiletick_event`、ホバーで priority 等の付加情報、`COLOR_TARGET`) + **座標** (クリック可) + ブロック名 + **結果** (`started`/`ended`/`success`/`detected`、`COLOR_RESULT`)。`EventType` 列挙 (`ACTION_START` / `ACTION_END` / `ACTION` / `EVENT`) で開始/終了/併合/単発の粒度を持つ。出典: `events/DetectBlockUpdateEvent.java`, `events/ExecuteTileTickEvent.java`, `microtiming/enums/EventType.java`。

関連ルール (実機で確認、下記 §5): `microTiming` (on/off) / `microTimingTarget` [labelled / in_range / all / marker_only] (追跡対象の絞り込み) / `microTimingDyeMarker` / `microTimingTickDivision` [world_timer / player_action] (tick 番号の基準)。

**→ レイヤ C の要件 1・2 を満たす唯一のツール**: neighbor update の発生/検出順と update type を tick 内順で出力できる (SubTick も RSMM も update type ラベルは持たない)。

### 2.3 実機確認結果 [確定 2026-07-02 実機]
mc-harness と同構成 (itzg/minecraft-server:java21, Fabric **1.21.1**) の使い捨てサーバに `MODRINTH_PROJECTS: carpet,carpet-tis-addition` を投入して実測:

- **ロード成功**: `fabric-carpet 1.4.147+v240613` + `carpet-tis-addition 1.81.0-mc1.21.1` が 1.21.1 で同居ロード。TISCM の yarn マッピング (1.21.1+build.3) DL 成功。
- **ルール存在**: `/carpet microTiming true` 成功 (「block updater が instant でないと microTiming ログが読みにくい、`instantBlockUpdaterReintroduced` で 1.19- の instant updater を有効化可」と警告)。`/carpet list microTiming` に microTiming / microTimingDyeMarker / microTimingTarget[labelled,in_range,all,marker_only] / microTimingTickDivision[world_timer,player_action] を確認。
- **⚠ headless 取得不可 [確定]**: carpet の logger は **subscribed player の chat にのみ**出力される。console から `/log` = 「players only」、`/log microTiming` = 「No player specified」。`/player Probe spawn` した fake player を対象に `/log microTiming Probe` しても「No player specified」で購読不可。`microTimingTarget all` + lever トグルで block update を発生させても **server console/log に microTiming 行は一切現れなかった**。→ **rcon-only の mc-harness では実ログ行を回収できない**。

（再現手順の要約のみ記録。ログ全文は非掲載。使い捨てサーバは `docker compose down -v` で撤去済み、Mojang 由来ファイルは非コミット。）

---

## 3. Redstone Multimeter (RSMM, Space Walker)

出典: https://github.com/SpaceWalkerRS/redstone-multimeter-fabric / https://modrinth.com/mod/redstone-multimeter

- **対応バージョン**: MC 1.17〜1.21.4 (最新 v1.17.x)。**1.21.1 対応 [確定: Modrinth]** (`[1.21]` ビルド mc1.21-1.16.0 が 1.21〜1.21.1、v1.17 系が 1.17〜1.21.4)。Fabric / Quilt / Ornithe。
- **ライセンス = MIT [確定: GitHub]**。microTiming (LGPL) より緩い。
- **動作**: クライアントのホットキーでブロックに「meter」を設置 → 各 tick の powered / activated / moved (piston) / ticked 等の状態遷移を**画面の HUD タイムライン**として可視化 (緑=powered / 赤=unpowered / 横線=移動)。meter 単位で追跡イベント種別・色を設定でき、**同 tick 内の発火順 (subtick 順) と tick phase 情報も表示**。**client+server 両方に導入必須**。出典: https://github.com/SpaceWalkerRS/redstone-multimeter-fabric/wiki
- **粒度**: 更新「順序」は見えるが、粒度は状態 (powered/active/moved) 中心で、**microTiming のような block update type (NC/PP/CU) や tile tick priority の明示ラベルは持たない**。I6 が主眼とする「更新 3 種の区別」の照合には情報が粗い。
- **ハーネス組み込み**: 出力は純粋にグラフィカル HUD。機械可読な text/JSON エクスポートは確認範囲で**未文書 (事実上なし)** [要検証: 未文書だが確認範囲でエクスポート機能なし]。**グラフィカルクライアントが必須**で、rcon-only の mc-harness には microTiming 以上に載せにくい。

**→ 「唯一の実機手段」ではない (05 §3 の記述を訂正) が、レイヤ C の主力にはならない**: 更新 type ラベルが無く出力が視覚 HUD のため。ライセンスが MIT な点のみ microTiming に勝る。

---

## 4. バニラ GameTest (/test, 1.21.5+)

出典: https://minecraft.wiki/w/GameTest / https://www.minecraft.net/en-us/article/minecraft-snapshot-25w03a

- **バニラ標準機構 [確定]**: 1.21.5 (25w03a) で刷新。`/test run|runmultiple|runclosest|locate` + `test_instance` データパックレジストリ + ヘッドレスエントリ `net.minecraft.gametest.Main` (`java -DbundlerMainClass="net.minecraft.gametest.Main" -jar server.jar` で全テスト実行→exit、**mod 不要**)。
- **mod なしでは function test を書けない [確定: wiki]**: コードアサーション (assertBlockState / succeedWhen / runAtTickTime 等 GameTestHelper API) を持つ function test は `test_function` レジストリ = **Java コード (Mojang / mod) からのみ登録可**。データパック単体では **block-based test** = structure + Test/Start/Log/Fail/Accept ブロックを **redstone で駆動する pass/fail 判定**に限られる。
  - 補足: mcfunction で function test を書ける `PackTest` (https://modrinth.com/mod/packtest) は**mod**であり「mod なし」条件を外れる。かつ mcfunction からでも tick 毎の全状態ダンプは不得手。
- **tick 単位の状態系列は取れない [確定]**: GameTest は「特定 tick で期待状態か」の**アサート/合否**モデルであり、tick 毎に全ブロック状態を系列ダンプする機構を持たない。block-based test は redstone 駆動の合否のみ。→ **レイヤ A (状態系列 diff) もレイヤ C (更新順 diff) も取得不可**。取れるのは合否 1 bit。
- **26.x 実機検証の選択肢としての評価**: GameTest は 26.x でも動く数少ない mod-less 手段だが、その正体は「回帰の pass/fail ゲート」であって **ground truth 系列生成器ではない**。scarpet (01 §6, レイヤ A) の代替にはならない。「26.x は実機検証 mod がほぼ皆無」(04 §4.1) という版選定の論拠は **GameTest では覆らない** — 系列 ground truth が取れないため (05 §5 への回答)。

**→ レイヤ C 用途では不適格**。ただし将来、fixture 化済みの期待挙動を 26.x バニラで CI 回帰させる「合否ゲート」としては mod 非依存で有用 (I10 の補助資産候補)。

---

## 5. 比較表

| 観点 | Carpet-TIS-Addition microTiming | RSMM (Redstone Multimeter) | バニラ GameTest |
|---|---|---|---|
| 1.21.1 対応 | ○ (release v1.74.3〜v1.81.0) [確定] | ○ (mc1.21-1.16.0 / v1.17 系) [確定] | ✕ (1.21.5+) [確定] |
| ライセンス | LGPL-3.0-only [確定] | MIT [確定] | EULA (公式機能) |
| サブティック更新**順** | ○ 出力の主目的 [確定] | ○ HUD で可視化 [確定] | ✕ 合否のみ [確定] |
| 更新**種別** (NC/PP/CU) ラベル | ○ block update type + priority [確定] | ✕ 状態(powered/active/moved)中心 | ✕ |
| tick 状態系列 | △ (レイヤ A は scarpet が担当) | △ (HUD) | ✕ [確定] |
| 出力形式 | text (chat, player 購読限定) | 視覚 HUD のみ | 合否 (Fail/Accept) |
| mod なし | ✕ | ✕ | ○ [確定] |
| rcon-only headless 自動化 | **✕ 実測で不可** [確定] | ✕ クライアント必須 | ○ (但し系列不可) |

---

## 6. 結論

### 6.1 レイヤ C の推奨ツール
**Carpet-TIS-Addition microTiming を推奨** (05 §3 の「唯一の実機手段」を、対抗馬 2 種を実評価した上で**選定として追認**)。根拠:
1. レイヤ C の中核要件「サブティック内更新順 **＋ 更新種別 (block update type / tile tick priority)**」を text で出せるのは microTiming のみ [確定: §2.2]。RSMM は更新 type ラベルを持たず視覚 HUD 出力、GameTest は更新順・系列いずれも取れない [確定: §3, §4]。
2. **1.21.1 (典拠かつ mc-harness の版) で release 版が現役** [確定: §2.1]。
3. ライセンス LGPL-3.0-only は**外部 mod 実行・観測に支障なし**、fixture 化 (事実の抽出) も自由 [確定]。

### 6.2 重要な訂正 — 自動パイプラインの前提が崩れる
01 §7 旧版・04 §2.3 は microTiming を scarpet と同列の「rcon 自動ダンプ」前提で扱っていたが、**これは誤り [確定 実機 §2.3]**: microTiming 出力は subscribed player の chat 限定で、rcon-only の mc-harness では**実ログ行を回収できない**。レイヤ A (scarpet, `write_file` でホストに JSON 受け渡し) と違い、レイヤ C は「rcon 1 発で機械可読出力」の自動化に**そのままでは載らない**。

### 6.3 I6 受け入れ基準の実現可能性評価
> I6 受け入れ基準: 「microTiming ログと更新順が一致する locational fixture 1 件以上」

- **達成可能。ただし半自動 [確定]**。以下いずれかの経路をとる:
  - **(A) 手動観察経路 (最小コスト・推奨初手)**: グラフィカルクライアントを 1 度接続して microTiming を購読し、対象 locational 回路の 1 fixture 分の**期待更新順を目視で確定** → その順序列を sim の更新順スナップショットとして固定しテスト化。実機との突合は「その 1 回」で済み、以後は sim 内スナップショット回帰。CI では実機不要。
  - **(B) 補助 mod 経路 (完全自動化・スコープ追加)**: `MicroTimingLoggerManager` にフックする補助 mixin/mod をハーネス側に実装し、microTiming イベント列を JSON でファイル出力 → レイヤ A と同じ回収パイプラインに載せる。LGPL 由来クラスにフックするため配布時は LGPL 条件に留意 (ソース開示)。実装コストは中。
- どちらでも「1 件以上」の基準は満たせるため **I6 の受け入れ基準自体は妥当 (実現可能)**。ただし **04 §2.2 パイプライン図の「レイヤ C も rcon 自動」という含意は (A)/(B) の追記で訂正が必要**。まず (A) で I6 を通し、更新順依存 fixture を増やす段になったら (B) を検討するのが妥当。

### 6.4 版選定への含意 (05 §5 への回答)
- バニラ GameTest では **tick 系列 ground truth が取れない**ため、「26.x は実機検証 mod がほぼ皆無」という論拠は覆らない。対象バージョン方針 (典拠 1.21.1 + 26.x 併読、04 §4.1) は**維持で妥当** [確定]。
- GameTest は将来、fixture 化済み挙動を 26.x バニラで CI 回帰させる**合否ゲート**として mod 非依存で使える余地がある (I10 補助資産の候補として 04 に将来追記可)。

---

## 7. 実機検証メモ (再現手順の要約)

環境: itzg/minecraft-server:java21 / Fabric 1.21.1 / `MODRINTH_PROJECTS: carpet,carpet-tis-addition` / rcon 経由操作 / 使い捨て compose (mc-harness の docker-compose.yml は不変更)。

1. `docker compose up -d` → `Done` まで待機 (image pull 込みで数十秒)。ログに `carpet-tis-addition 1.81.0-mc1.21.1` ロードを確認。
2. rcon: `carpet microTiming true` → 成功 (instant updater 警告)。`carpet list microTiming` → 4 ルール確認。
3. rcon: `log` → 「players only」/ `log microTiming` → 「No player specified」。
4. rcon: `player Probe spawn` → `log microTiming Probe` → 「No player specified」(fake player 購読不可)。`microTimingTarget all` + lever トグルでも server log に microTiming 行なし。
5. `docker compose down -v` で撤去 (Mojang 由来ファイル非同梱)。

結論: microTiming の 1.21.1 動作とルール存在は実測確認、実ログ行の headless 取得不可も実測確認。出力の**形式**はソース直読で確定 (§2.2)。
