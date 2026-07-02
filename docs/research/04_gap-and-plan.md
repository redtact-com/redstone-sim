# 04. 現実装ギャップ一覧と検証ハーネス構想・実装計画

対象: packages/sim (world.ts 687 行 + blocks/ + types.ts、実装コンポーネント 11 種)。
現実装の挙動クレームは実行検証済 (tsx スクリプト 10 ケース) [確定]、「vanilla ではこうなる」側は一部記憶ベース [要検証] のため、修正時に 02 の仕様 (デコンパイル裏取り) と突き合わせて確定させること。

---

## 1. ギャップ一覧 (非互換リスク順)

| # | リスク | ギャップ | 現実装の挙動 | Java Edition の挙動 | 該当箇所 | 影響 |
|---|---|---|---|---|---|---|
| G1 | 致命 | **tile tick 意味論: action を schedule 時に固定** | executeScheduledTick が実行時に入力を再評価しない。遅延より短いパルスでリピーターが**永久 ON にラッチ** (実行検証: delay=4 に 2gt パルス → 以後 ON 固定)。dedupe は pos+action 単位で turn_on/turn_off が並存、コンパレーターは予約をキャンセル | 同 pos+block に予約 1 件のみ・キャンセル不可・**実行時に世界状態から動作決定** [確定: 1.21.11 デコンパイル]。DiodeBlock は tick 時に再評価し最小パルス幅=遅延を保証 [要検証] | world.ts:69-77, 293-298, 497-515 | パルス回路全般が破綻。**非互換の根本原因** |
| G2 | 致命 | **弱充電 (weak powering) の欠落** | SolidState.powered は強充電のみ。dust→solid→repeater が動かない (検証済)。torch 用のみ ad hoc 近似 (isBasePowered) | 弱/強 2 段の充電モデル。弱充電ブロックも隣接機構を作動させる [確定] | types.ts:105-110 | ブロック貫通配線の基本パターン全滅 |
| G3 | 高 | **床置きトーチが水平給電しない** | facing=up トーチの横のワイヤー/ランプが power=0 (検証済) | トーチは取り付け面以外の全隣接に弱 15、直上のみ強充電 [要検証: 裏取り要] | wire.ts:95-101, world.ts:597-606 | NOT ゲート横取り出しが全滅 |
| G4 | 高 | **強充電 solid の通知先が torch のみ** | lever→solid→repeater/comparator/lamp が全て不動作 (検証済)。判定関数は正しいが再評価が呼ばれない | 充電状態変化は NC 更新として隣接機構全てに伝播 [確定] | world.ts:464-481 | 通知グラフの構造欠陥 |
| G5 | 高 | **ワイヤーが足元ブロックを弱充電しない** | 通電ワイヤー直下のランプ不点灯 (検証済) | dust は足元ブロック + connections 先を弱充電 [要検証] | world.ts:607-614 | 下方向配線が動かない |
| G6 | 中高 | **tile tick priority が固定値** | torch=1, repeater=-3, comparator=-3, button=0 固定 | 文脈依存: repeater -3/-2/-1、comparator -1/0、torch/他 0 [確定: 02 §2.2] | world.ts:490-516 | リピーター連鎖・パルス切り詰め・オブザーバー→コンパレーター飲み込みが再現不能 |
| G7 | 中高 | **隣接更新の方向順が非準拠** | [north,south,east,west]+up/down 固定順、ワイヤーは独自 2 フェーズ BFS | NC: 西→東→下→上→北→南 DFS、素子別例外あり [要検証: 02 §4.2]。最終電力値は一致するはずだが locational 回路が再現不能 | world.ts:372-452, types.ts:28-29 | 回路勢向け精度の分水嶺 |
| G8 | 中 | **コンパレーター入力仕様の誤り** | 側面に lever/button/torch を受理 (vanilla は dust/repeater/comparator/RS ブロックのみ)。背面の充電ブロック・コンテナを読めない (検証済: 出力 0、vanilla 15) | 02 §6 comparator 参照 | world.ts:659-678 | 計測回路全般が非互換 (数式自体は正しい [確定]) |
| G9 | 中 | **リピーターロック未実装** | locked フィールド定義のみ、常に false (検証済) | 側面のリピーター/コンパレーター出力で状態固定 | repeater.ts:19-31 | ラッチ・メモリ回路が動かない |
| G10 | 中 | **PP/NC/CU の更新 3 種が未分離** | 更新は 1 種類のみ。オブザーバー導入の前提を欠く | NC/PP/CU + 各方向順 [確定: 分類、要検証: 順序] | 全体 | オブザーバー実装の前提 |
| G11 | 中 | **未実装コンポーネント** | piston/observer/QC/redstone block/target/pressure plate/コンテナ/note block/burnout/dot 形状が不在。「BUD・QC は実装しない」と方針コメントあり (repeater.ts:22) | テクニカル勢の最低ラインは QC+observer+piston [確定: 要求水準として] | types.ts:116-126 | 目標ユーザ層 (回路勢) の主要用途を外す |
| G12 | 低中 | **ボタン持続時間** | 石 5gt/木 10gt | 石 20gt/木 30gt [要検証] | world.ts:222-225 | 数値 1 行だが vanilla の 1/4 |
| G13 | 低中 | **レバー/ボタンの強充電が全隣接に効く** | facing 無視で全隣接 solid を強充電 → ブロック越しワイヤーが誤 15 | 強充電は取り付けブロックのみ [要検証] | world.ts:590-595 | 信号の「漏れ」方向非互換 |
| G14 | 低 | isBasePowered の過剰近似 | solid の 6 隣接いずれかの通電 wire で消灯 (下・非接続方向も) | dust の弱充電は足元+接続先のみ [要検証] | torch.ts:61-72 | G2 解決で吸収 |
| G15 | 低 | getPowerLevel(lamp)=15 の独自仕様 | lamp は電力源でないのに 15 を返す (外部 API のみ) | — | world.ts:247 | UI/テストの誤解リスク |
| T1 | — | **失敗テスト 6 件** | 5 件は「tick()=gt なのにテストが rt 前提 (delay N→N tick)」で**実装側が正しい**。1 件は initialize() が意図的に flush しない事後条件未定義 | — | test/world.test.ts:171-214 ほか | テストを gt 基準に書き直し + initialize 事後条件の仕様化 |

正しくできている点 (維持): 座標系 (y=up, north=-z, east=+x) [確定]、コンパレーター数式 [確定]、repeater delay*2gt / torch 2gt の gt 基準実装、同 priority 内の安定ソート決定性、ワイヤー最終電力の 2 フェーズ収束。

---

## 2. 精度検証ハーネス構想 (実機 ground truth → fixture 化)

### 2.1 方針
「目視のそれっぽさ」→「実機との tick 単位機械 diff」への格上げ。3 層で構成する。

```
レイヤ A: 状態系列 diff (tick 粒度)      … carpet + scarpet    ← まずここ
レイヤ B: キュー/フェーズ粒度 diff       … SubTick (lntricate) ← ~1.20.1 限定
レイヤ C: 更新順序 diff (サブティック内) … Carpet-TIS-Addition microTiming
```

### 2.2 レイヤ A: carpet + scarpet 状態ダンプパイプライン [確定: 全 API 文書確認済]

1. **環境**: Fabric サーバ + fabric-carpet (MIT) をヘッドレス起動。挙動変更ルールは**全て既定 (false) のまま** (fastRedstoneDust 等を有効にすると ground truth 汚染)。
2. **フィクスチャ設置**: 回路を JSON 定義 → scarpet の `set(pos, block, props..., data)` を `without_updates()` で包んで無更新設置 (または fillUpdates=false)。redstone-sim 側は同じ JSON から World を構築。
3. **入力**: `/player` の fake player でレバー/ボタン操作 (PI フェーズ起因イベントの再現)。
4. **ステップ実行**: `/tick freeze` → `run('tick step 1')` ループ。バニラ 1.20.3+ なら /tick はバニラで可 [確定: 23w43a + TickRateManager デコンパイル]。
5. **ダンプ**: 各 tick で `scan()` + `block_state()` + `block_data()` の全走査結果を `write_file(resource, 'shared_json', ...)` で JSON 出力。`tick_time()` で tick 番号を添える。
6. **diff**: ホスト側スクリプトが redstone-sim に同フィクスチャ+同入力列を食わせ、tick 系列 JSON を機械 diff。差分 = バグ or 仕様未解明点。
7. **fixture 化**: 通過した (フィクスチャ, 入力列, 期待 tick 系列) を `packages/sim/test/fixtures/*.json` としてコミットし、以後は実機なしで回帰テスト。CI 化。
8. **要実験確認** [要検証]: freeze/step 中に scarpet `__on_tick` が発火するか (発火しないなら run('tick step') 駆動に統一)。

最初の fixture 候補 (02 の確定仕様から): 短パルス応答 (トーチ/コンパレーターの 1gt パルス無反応)、オブザーバー→コンパレーター飲み込み、リピーター遅延 1-4 全数、信号減衰境界 (15/16 マス)、リピーターロック、dust→block→機構の弱充電系、QC (piston BUD)、note の MC 番号バグ 7 件 (MC-2340/3703/11193/54711/81098/189954/231071)。

### 2.3 レイヤ B/C: 順序粒度の ground truth
- **SubTick (lntricate1 版, LGPL-3.0, MC 1.17.1〜1.20.1)**: `/tick freeze [phase]` + queueStep で tile tick を priority 単位・block event を depth (BED) 単位に 1 件ずつステップし、HUD でキュー内容を確認。**1.20.2+ 非対応**なので対象バージョン判断に直結。
- **Carpet-TIS-Addition microTiming**: detected/emitted block update・executed_tile_tick・executed_block_event を tick 内順序付きでログ出力。**neighbor update 順の ground truth はこれが唯一の実機手段** (SubTick は対象外)。`/carpet microTiming true`。
- 補助: MC-ticker の「実 jar オラクル」発想 — 挙動という事実の抽出は著作権対象外なので合法的に応用可 [確定: 03 参照]。

### 2.4 補助テスト資産
- **MCHPRS tests (MIT)**: components.rs 9 件 + timings.rs 3 件 (0-tick パルス、遅延全数、減衰境界、torch 下方向回帰) を TS へ移植可。ただし**ワイヤ更新順の典拠には使用禁止** (RedstoneWireTurbo は意図的変更、02 棄却済み欄)。
- **test_all_backends! 方式**: 同一シナリオを素実装と将来の高速化パスの両方に流す差分テスト構造を最初から採用。
- **HLPtool (GPL-3.0, 式のみ参照)**: ソルバ出力のコンパレーターレイヤ列を sim 上に自動構築し 16 入力全数で目標関数と照合するプロパティテスト。

---

## 3. 実装タスク分解案 (issue 化粒度)

依存関係: I1 → I2 → I3 → (I4, I5) / I6 → I7 → I8 / I9, I10 は独立。

| # | タイトル (案) | 内容 | 受け入れ基準 | 対応ギャップ |
|---|---|---|---|---|
| I1 | 対象バージョン確定と仕様調査ワークフロー整備 | 対象 MC バージョンの意思決定 (下記 §4-1)。ローカルデコンパイル手順 (03 §7) を CONTRIBUTING に文書化し、02 の [要検証] 項目 (NC/PP/CU 方向順、DiodeBlock 再評価、burnout/ボタン持続/コンパレーター遅延・コンテナ式) をデコンパイルで確定して 02 を v1 に更新 | 未解明表 10 項目中、順序系 4 項目が [確定] 化 | 全体の前提 |
| I2 | 電力系再設計: weak/strong 2 段モデル | powered を {none, weak, strong} + 強度に再設計。solid 変化の全機構への NC 通知 (G4)、トーチ全方向給電 (G3)、ワイヤー足元弱充電 (G5)、レバー/ボタン取り付け面限定強充電 (G13)、isBasePowered 撤廃 (G14) | dust→block→repeater/comparator/lamp、床置きトーチ横取り出し、下方向配線の 3 系統が fixture で通過 | G2-G5, G13, G14 |
| I3 | tile tick 意味論の vanilla 準拠化 | 予約を pos+block 単位 1 件に (dedupe/キャンセル廃止)、action は実行時再評価、priority を文脈依存 (02 §2.2 表) に、collect-then-execute 化 | 短パルスラッチ (G1) 解消、最小パルス幅=遅延、オブザーバー→コンパレーター飲み込み fixture 通過 | G1, G6 |
| I4 | テスト基盤修正 | 失敗 5 件を gt 基準に書き直し、initialize() の事後条件 (安定化 or tick=0 停止) を仕様化して 1 件解消。ボタン持続を確定値に修正 | テストグリーン + 事後条件が docs に明記 | T1, G12 |
| I5 | コンパレーター完全化 + リピーターロック | 側面入力の受理範囲修正、背面充電ブロック読み、コンテナ充填率読み (I1 で式確定後)、ロック実装 | 計測回路・ラッチ fixture 通過 | G8, G9 |
| I6 | 更新 3 種 (NC/PP/CU) の分離と方向順実装 | 更新イベント型を neighborUpdate/shapeUpdate/comparatorUpdate に分割、I1 で確定した方向順 (通常 + 素子別例外 + ダスト多段) を DFS プッシュ型で実装 | microTiming ログと更新順が一致する locational fixture 1 件以上 | G7, G10 |
| I7 | ブロックイベントキュー + ピストン (QC 込み) | BE キュー (挿入順 FIFO + 重複排除、同 tick 枯渇まで処理、実行時型検証) を tick ループに追加し、piston/sticky piston を BEC として実装。QC (piston/dropper/dispenser の pos.above() チェック) と BUD 状態 (powered/activated 分離) | 基本伸縮・押し 12 制限・QC BUD fixture 通過 | G11 (piston/QC) |
| I8 | オブザーバー実装 | PP/SU 受信で起動、パルス tile tick (priority 0)、オン時に自身のオフを先行登録する順序 | 飲み込み fixture + オブザーバーチェーン fixture 通過 | G11 (observer) |
| I9 | 実機 ground truth ハーネス構築 | §2.2 のパイプライン (docker 化した Fabric+carpet、scarpet ダンプスクリプト、diff ランナー、fixture フォーマット定義) を tools/ に実装し CI 接続 | 手元コマンド 1 発で fixture 生成→diff が回る。初期 fixture 10 本 | 検証基盤 |
| I10 | MCHPRS テスト移植 + トレースログ形式 | MCHPRS 12 テストの TS 移植 (MIT 帰属表示)、RSC 記法風トレース出力 (`Tgt[Ph]: Block(action...)`) の実装で日本語回路勢と照合可能に | 移植テスト通過 + トレース出力のスナップショットテスト | 検証補強 |

---

## 4. 最重要の意思決定ポイント

1. **対象バージョンの確定 (I1 でまず決める)** — トレードオフ: (a) **1.20.4**: lntricate-SubTick / MCHPRS が使え検証ツールが最も厚いが、mappings+remap 工程が必要で 1.21.2+ のワイヤ更新順刷新 (WireOrientation) 前の仕様になる。(b) **1.21.1**: 本調査のデコンパイル検証が最も厚い版。(c) **26.x**: 非難読化 jar で解析が最易だが実機検証 mod がほぼ皆無。推奨: **仕様典拠は 1.21.1 (+26.x jar を可読参照に併用)、ハーネスのレイヤ B のみ 1.20.1 で補助**とし、WireOrientation 差分は将来バージョンフラグで吸収。
2. **tile tick 意味論 (G1) と電力系 (G2) の刷新を機能追加より先に行うか** — 両方とも「後から直すと全コンポーネントに波及する」基盤で、現アーキテクチャ (schedule 時 action 固定・強充電のみ) の上に piston/observer を積むと二度手間になる。推奨: I2→I3 を最優先し、その間の新コンポーネント追加は凍結。
3. **locational (座標依存) 挙動の再現をスコープに入れるか** — 更新方向順 (G7/I6) と update suppression の再現は「回路勢が挙動検証に使える」の分水嶺だが、実装・検証コスト (microTiming 突合) が最大。入れないなら「定常状態+タイミングは正確、更新順依存装置は対象外」と明示する必要がある。推奨: I6 までは実施、suppression (深度制限溢れ) は v2 判断。
