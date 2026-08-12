# 15. プロジェクト全体レビュー — 実装棚卸し・バックログ・外部参考 (#101)

v0.3.0 到達時点 (open issue 0 件) で一度立ち止まり、**何が実装済みか / 何が残っているか /
何を参考にできるか**を 1 箇所に集約する。本書はリポジトリ直属の GitHub Project
[redtact-com/projects/1](https://github.com/orgs/redtact-com/projects/1) の初期投入元であり、
Project の各 draft は本書 §3 の行に対応する。

- レビュー日: 2026-08-12。コード実測 + docs/research 01-14 + issue/PR 全履歴 + 下流リポ
  (redstone-maker) + 外部 Web 調査 の 6 方面を並列調査し、批評エージェントで重複統合と
  事実照合を行った結果。
- 本書は 10 / 14 と同じく **推奨案 + 根拠 (出典付き) + ユーザ判断ポイント** の提示に徹する。
  優先度は提案であり、決定は Project 上で行う。

---

## 1. 実装済みの棚卸し (2026-08-12 実測)

### 1.1 領域別

| 領域 | 実装されているもの |
|---|---|
| **sim / tick ループ** | フェーズ順 ST→BE→BlockEntity (PI は activateBlock で手動)、ST は collect-then-execute (priority 昇順→seq 昇順)、予約は pos+blockType で 1 件デデュープ・action を持たず実行時に世界から動作決定、文脈依存 TickPriority (repeater -3/-2/-1・comparator -1/0)、BE キューは挿入順 FIFO + 重複排除で枯渇まで反復、BlockEntity 相で moving_piston 確定 → ホッパー転送 |
| **sim / 更新モデル** | NC はプッシュ型 DFS (CollectingNeighborUpdater 相当・single/multi・上限 1,000,000)、PP は PP_UPDATE_ORDER で observer へ 2gt 予約、CU は水平 N→E→S→W + 導体 1 個越し、素子別 NC 送信形状 (emitOutputShape)、**ダスト多段送信の起点順を Java HashSet の反復順でエミュレート** (locational 再現) |
| **sim / 電力** | キャッシュ無しの純クエリ型 weak/strong 2 段モデル、getEmittedSignal / getEmittedDirectSignal、導体 = solid/target/note_block、ダスト弱充電、ワイヤ形状の導出を sim に一本化 (26.2 準拠の shouldConnectTo・自動拡張・dot 保持ガード)、トポロジー変化点での形状張り替え |
| **sim / 素子** | ダスト・レバー・ボタン 2 種・トーチ (床/壁)・リピーター・コンパレーター・ランプ・固体・redstone_block・target・note_block・感圧板 4 種・オブザーバー・ピストン 2 種 (+ head/moving)・ホッパー・ドロッパー・コンテナ。トーチ burnout、ピストン破壊 (PUSH_DESTROY)、物流 (8gt・-1 補正・BE 登録順) |
| **検証基盤** | 実機 ground truth ハーネス (docker + Fabric 1.21.1 + carpet、scarpet dump.sc、rcon 駆動)、トレース (08 記法) 実装、回路 DSL `.rstest` (パーサ + ランナー + trace/trace strict)、MCHPRS 移植テスト、fixture 再生ドライバ (CI とデモが bit-identical) |
| **アプリ** | エディタ (16×16×8・パレット 25・向き/遅延/信号の編集バー・レイヤーパネル・undo/redo・NBT 入出力)、シミュレーションモード (tick 送り・連続実行・チェックポイント・手動トリガ)、`?demo=<fixture>` 再生、`?embed=1` (view/interact + postMessage v1 + origin allowlist) |
| **CI / 運用** | test.yml (vitest / typecheck / build / e2e)、deploy.yml (main→rdsim.com・develop→pages)、pr-preview.yml (PR ごとの環境 + クローズで削除)、spec-drift.yml (週次デコンパイル指紋照合 → drift で自動起票)、PR 添付 GIF の自動生成 (tools/demo) |

### 1.2 実測値

| 指標 | 値 |
|---|---|
| 対応ブロック | **26 type** (エディタ配置可 23 / viewer プリロード 27) |
| ユニットテスト | **428 本** (426 passed / 2 skipped)・テストファイル 22・実行 1.6 秒 |
| 実機 fixture | **54 本** (定義側 53 + placeholder 1)・合計 1,342 tick・expect 変化 656 件 |
| 回路 DSL | `.rstest` **93 本** / 29 ディレクトリ / 4,150 行 (state 断言 432 行・trace 期待 369 行) |
| E2E | Playwright spec 5 / test 9 (本番ビルド + vite preview に対して実行) |
| LOC | sim 4,015 / editor 534 / viewer 1,687 / app 3,212 / e2e 344 / tools 991 |
| 調査文書 | docs/research 14 本 + 09_snapshots |
| リリース | v0.1.0 / v0.2.0 / **v0.3.0** (rdsim.com 稼働)。develop は main より 9 commits ahead |

### 1.3 棚卸しで判明した記述のずれ

- README の「対応ブロック」は **7 種のまま** (実装は 26 type)。viewer を「3D/トップダウン
  ビューア」と書くが `TopDownView` という独立コンポーネントは無い (IsometricView の
  `topDown` prop で分岐)。`?demo=` / `?embed=1` のエントリも未記載。
- `packages/viewer/src/index.ts:5` の「フェーズ2: TopDownView を追加予定」は機能自体は
  存在するので、コメントだけが古い。
- 02 §6 hopper の「既知の抽象化 (座標順走査・-1 補正なし)」は #89/#91 で解消済み。
  04 §1 の G1〜G15 も大半が解消済みだが表に反映されていない。

---

## 2. レビューで判明した要対応事項

### 2.1 [P0] ワイヤ 2 相 BFS の再昇圧漏れ — 定常値が誤る

`propagateWireBFS` (packages/sim/src/world.ts:1439-1531) の **Phase 2 シード走査**が、
`for (const key of connected)` の Set 反復順に power を書きながら同時に `visited` へ入れる。
増加 BFS は `visited.has(nKey) → continue` するため、**シード走査中に >0 になったセルは
以後どれだけ強い spread が届いても昇圧されない**。

再現 (SimWorld 直叩きで実測):

```
床 solid、lever(ON) → dust A(0,0,0) B(1,0,0) C(2,0,0)、C の隣 x=3 に重量感圧板 (pressedPower=7)

板を踏む前          A,B,C = 15, 14, 13   ← 正しい
板を踏んだ直後〜以降 A,B,C = 15,  6,  7   ← vanilla は 15,14,13 のまま
```

連結成分の探索起点 (= 変化したブロック側) から seed 順が決まるため、**同じ回路でも
どちら側から触ったかで結果が変わる** locational な誤りになる。板を踏んだ 1 tick の
過渡ではなく、離れるまで誤値が定常として続く。

428 本のテストをすり抜けた理由は、`wire-shape-power.test.ts` が形状×方向の 29 ケースしか
見ておらず、tests/circuits にも「**強さの違う直結源が同一連結成分に複数ある**」回路が
1 本も無いため。修正 PR の受け入れ基準には、直結源の強度 × 位置 × 走査順を網羅する
マトリクステストを含めること。

下流 redstone-maker はこの挙動を probe で突き止め「競合する直結源を置かない」という
ステージ設計上の回避を強いられている (src/domain/chapters.ts のコメント)。修正時は
その回避を外せることも確認する。

### 2.2 [P1] 公開リポジトリとしての空白

`gh repo view` 実測で **visibility=PUBLIC / license=null / topics=null /
description=「シミュレーションデモ」**。以下が揃っていない。

- **LICENSE / NOTICE が無い** — 03 §7 手順 6 が「Mojang/Microsoft 非公式・Minecraft は
  Mojang AB の商標・本プロジェクトは Mojang のコード/アセットを含まない」の明記を要求
  しているが未実施。
- **CONTRIBUTING の禁止事項と実態が矛盾** — 「ゲームのテクスチャ・音・アセットの同梱」を
  禁止と書きながら、第三者パック MK.2 Redstone v3.0 が **PNG 312 枚・3.1MB・655 ファイル**
  丸ごとコミットされ rdsim.com で再配布されている。credit.md は帰属表示のみで再配布許諾の
  記載が無い (パックの pack_format 15 = MC 1.20-1.20.1 で典拠 1.21.1/26.2 とも世代ずれ)。
- **npm audit 14 件** (critical 1 = vitest UI 経由の任意ファイル読取/実行、high 10、
  moderate 3)。vitest 2.1.9 (latest 4.x) の遅れにより **root に vite 5・app に vite 8 が
  同居**。dependabot.yml も renovate.json も無い。
- ISSUE_TEMPLATE / PULL_REQUEST_TEMPLATE / SECURITY.md が無い。

### 2.3 [P1] 下流 redstone-maker との重複

redstone-maker は redstone-sim を submodule (`libs/redstone-sim`) として取り込み、
vite alias で `packages/*/src` を **直参照**している (submodule の pin は v0.3.0 のマージ
コミット = develop より 9 commits 遅れ)。この関係で、本来 sim 側にあるべきものが
下流で再実装されている:

| 下流で自前実装しているもの | sim 側の欠落 |
|---|---|
| `settleWorld` / `runRow` / `SimSession` | `flush()` が BE 相だけで進む moving_piston を取りこぼす。`isQuiescent()` / `settle()` が無い |
| zod の `PlaceableSchema` / `PlaceOptsSchema` 手写し | `PLACEABLE_TYPES` の実行時リストとバリデータが export されていない |
| タップ回転 UI (効いていない) | `CircuitEditor` が lever/button の facing を捨てている (`PlaceOptions.facing` が HDir 型) |
| `BoardCanvas` 444 行 + `blockRegistry` 470 行 | viewer に 2D トップダウンの独立コンポーネントが無い |
| MK.2 テクスチャの vendoring + KEYS 手書き | パックが app/public にしか無く packages から参照できない |

### 2.4 バックログの所在

**open issue は 0 件**で、残タスクは docs/research の中と PR レビューコメントの中にしか
存在しなかった。本書 §3 と Project #1 がその置き場になる。

---

## 3. バックログ (61 件)

Project [redtact-com/projects/1](https://github.com/orgs/redtact-com/projects/1) に draft として
投入済み。各 draft の body に「なぜ・根拠 (ファイル:行 / docs §/ issue・PR)」を持たせてある。
着手時に `/issue-flow` で issue 化する運用。

- **優先度**: P0 = バグ/リリース阻害、P1 = 公開プロダクトとして先に直すべき、P2 = 通常、P3 = いつか
- **サイズ**: S = 1 PR で完結、M = 数コミット、L = 分割が要る
- `[redtact 側]` で始まる項目は **別リポ redtact-com/redtact** の作業 (連携の抜け漏れ防止のため併記)

| 優先度 | 分類 | サイズ | タスク | 出典 |
|---|---|---|---|---|
| P0 | sim精度 | M | ワイヤ 2 相 BFS の再昇圧漏れ — 強さの違う直結源が同一ダスト網にあると定常値を誤る | コード実測 |
| P0 | 基盤・CI | S | v0.4.0 リリース (develop → main) — embed モードとタップ置き換えが本番未反映 | issue・PR |
| P1 | エディタUX | M | 回路のブラウザ内永続化 (リロードで作業が消える) | コード実測 |
| P1 | エディタUX | S | CircuitEditor が lever / button の facing を無視する (Dir6 配置ができない) | 下流連携 |
| P1 | エディタUX | S | PLACEABLE_TYPES の実行時リストと PlaceOptions バリデータを @redstone/editor から export | 下流連携 |
| P1 | ドキュメント | S | LICENSE / NOTICE の追加 (Mojang 非公式・コード非含有の明記) | docs調査 |
| P1 | ドキュメント | M | MK.2 リソースパック同梱の許諾整理 (CONTRIBUTING の禁止事項と実態が矛盾) | コード実測 |
| P1 | ドキュメント | S | README のドリフト解消 + 下流 submodule 直参照の契約を明文化 | docs調査 |
| P1 | ドキュメント | S | PUBLIC リポジトリとしての体裁整備 (About / topics / issue・PR テンプレート / SECURITY.md) | コード実測 |
| P1 | 基盤・CI | M | 依存の major 遅れ解消 + npm audit 14 件 (critical 1) + 自動更新の導入 | コード実測 |
| P1 | 基盤・CI | M | ESLint の 59 errors 健全化と CI への lint 追加 | issue・PR |
| P1 | 基盤・CI | S | 本番パスの console.log 除去 (IsometricView は毎レンダー出力している) | コード実測 |
| P1 | 基盤・CI | M | settle / isQuiescent / SimSession を @redstone/sim に上流化する | 下流連携 |
| P1 | 連携 | M | [redtact 側] R1: `<rdsim>` 説明文タグ + RdsimEmbedCard の実装 | docs調査 |
| P1 | 連携 | S | [redtact 側] R2: CSP frame-src に rdsim origin を追加 + 環境別化 | docs調査 |
| P1 | 連携 | S | [redtact 側] R3: ヘルプ記事での iframe 直書きパイロット | docs調査 |
| P2 | sim精度 | M | MC-3703 fixture: ダストの向き変化で旧給電先が更新されない | docs調査 |
| P2 | sim精度 | M | MC-54711 fixture: 背中合わせリピーター列で 1rt の 101 パルス列が 111 に化ける | docs調査 |
| P2 | sim精度 | M | MC-189954 fixture: 予約済み tile tick を持つ observer の二重予約 (4tick observer clock) | docs調査 |
| P2 | sim精度 | S | MC-2340 回帰ガード fixture: NC 同時到達でもトーチ 2gt パルスが縮まないこと | docs調査 |
| P2 | sim精度 | M | BU 数・重複 BU をトレースで検証する fixture (MC-81098 / MC-231071) | docs調査 |
| P2 | sim精度 | M | observer の可動化 (PushReaction MOVE) と移動時パルス発火の意味論 | issue・PR |
| P2 | sim精度 | M | 更新抑制 S2: NC/PP/CU カウンタ意味論を vanilla 一致させる | issue・PR |
| P2 | sim精度 | M | 設置更新 (placement update) 経路のモデル化 — 相互 observer クロックの自己始動 | issue・PR |
| P2 | sim精度 | S | power.ts に残る [要検証] マーカーの解消 (トーチ strong 面 / レバー・ボタンの weak・strong 面) | コード実測 |
| P2 | sim精度 | S | spec-drift の監視クラス拡張 (piston / hopper / 感圧板 / NoteBlock / Dispenser) | コード実測 |
| P2 | エディタUX | M | タップ配置ポリシー (配置/置き換え/回転/dot トグル) を @redstone/editor に上流化 | 下流連携 |
| P2 | エディタUX | M | アクセシビリティとモバイル表示の最低ライン整備 | コード実測 |
| P2 | エディタUX | S | app の ErrorBoundary と embed の実行時エラー通知 | コード実測 |
| P2 | エディタUX | S | ファイル選択の accept (.litematic/.schem) とパーサ不在の不一致を解消 | docs調査 |
| P2 | ドキュメント | S | docs/research の現状同期 (04 ギャップ表 / 02 未解明・hopper / 05 §6 / tests README) | docs調査 |
| P2 | 基盤・CI | M | 構造 NBT 入出力 (nbtIO) を packages 側へ切り出す | 下流連携 |
| P2 | 基盤・CI | M | MK.2 テクスチャを packages から参照できる形に切り出す (app/public 依存と CDN 依存の解消) | 下流連携 |
| P2 | 基盤・CI | S | lint 対象を packages/* と e2e / tools へ拡大し、カバレッジ計測を CI に載せる | コード実測 |
| P2 | 基盤・CI | M | viewer の毎 tick 全再メッシュを差分更新に置き換え、デッドコードを削除する | コード実測 |
| P2 | 基盤・CI | S | 死んだビルド生成物・未使用アセット・他プロジェクト由来ファイルの掃除 | コード実測 |
| P2 | 基盤・CI | M | .rstest DSL の残課題 — 相対 gt 表記と inputs の上書き/除去 | issue・PR |
| P2 | 新機能 | L | S5: トレース表示 UI + postMessage の rdsim:setTrace | docs調査 |
| P2 | 新機能 | L | @redstone/viewer に 2D トップダウンビュー (TopDownView) を切り出す | 下流連携 |
| P2 | 連携 | M | S4: 自己完結 embed URL (?circuit=&file=) で redtact の公開回路を直接ロード | docs調査 |
| P2 | 連携 | S | Google Fonts の外部読み込みを self-host 化する (埋め込み時の CSP / オフライン耐性) | コード実測 |
| P2 | 連携 | S | [redtact 側] openapi.yml の downloadCircuitFile を optionalAuth 仕様へ修正 | docs調査 |
| P3 | sim精度 | S | 強充電導体のダスト逆読み (back-feed) 過渡値の実機突合 | issue・PR |
| P3 | sim精度 | S | 音符ブロックの実機 fixture 生成 + 被覆条件近似の解消 | docs調査 |
| P3 | sim精度 | S | 重量感圧板の実機 fixture 化 (pressedPower=1 で light/heavy を突合) | docs調査 |
| P3 | sim精度 | L | 1.21.2+ experimental redstone (WireOrientation) の完全読解とバージョンフラグ設計 | docs調査 |
| P3 | sim精度 | S | チャンクティック内サブ処理の厳密順序・ディメンション処理順のデコンパイル裏取り | docs調査 |
| P3 | エディタUX | S | nbtIO の重量感圧板 import で POWER を読み取る (pressedPower リセットの解消) | issue・PR |
| P3 | エディタUX | L | 盤面グリッド (16×16×8 固定) の拡張検討 | docs調査 |
| P3 | 基盤・CI | M | 1gt パルスを作れるハーネス入力機構 (現状は 2gt が最小) | docs調査 |
| P3 | 基盤・CI | L | microTiming イベントを JSON 出力する補助 mixin (レイヤ C の自動化) | docs調査 |
| P3 | 基盤・CI | M | バニラ GameTest (26.x) を mod 非依存の合否ゲートとして CI に載せる | docs調査 |
| P3 | 基盤・CI | M | レイヤ B (SubTick 1.20.1) によるキュー/フェーズ粒度 diff の実施可否判断 | docs調査 |
| P3 | 基盤・CI | S | 恒久 skip 2 件の整理 (mchprs pulse_gen_1t / network-piston-be-order の skipUntil) | issue・PR |
| P3 | 基盤・CI | S | checkbox-guard.yml (issue close 時の未チェック項目ガード) の実装 | issue・PR |
| P3 | 基盤・CI | S | demo-gif の既定軽量化方針の決定 (--every / ビューポート) | issue・PR |
| P3 | 基盤・CI | M | コンパレーターレイヤのプロパティテスト (HLPtool 方式・16 入力全数) | docs調査 |
| P3 | 基盤・CI | M | test_all_backends! 方式の差分テスト構造を用意する | docs調査 |
| P3 | 連携 | M | [redtact 側] R4: API / R2 CORS に rdsim origin を追加 (Phase2 前提) | docs調査 |
| P3 | 連携 | S | [redtact 側] R5: 回路詳細ページに「シミュレータで動かす」導線 | docs調査 |
| P3 | 連携 | M | [redtact 側] R6: StructureNormalize を litematic / schem に拡張 | docs調査 |

---

## 4. 参考になる外部プロジェクト・サイト・仕様 (新規調査)

01 / 06 が既に列挙している「使用中」の情報源 (Mojang 一次資料・carpet 系・MCHPRS・
deepslate 等) は本書では繰り返さない。以下は **今回新たに調べた、今後の設計判断に効く**もの。
すべて 2026-08-12 に生存確認済み。ライセンスは gh api での実測値。

### 4.1 競合・類似プロダクト (ポジショニングの基準)

| 名前 | 実装/形態 | redstone-sim にとっての意味 |
|---|---|---|
| [Redstone Companion](https://redstone.tools/) | クローズド Web | 最も直接的なベンチマーク。「tick-accurate」を掲げ、160+ プリセット・4 ビュー切替・**回路ごとの恒久パーマリンク・iframe 埋め込み**を実装済み。14 の埋め込み構想の先行実装として URL 設計と iframe API の粒度を比較できる。ただし **Bedrock 挙動** (instant piston 等) をモデル化 → 「Java 版で tick 精度」は空いている |
| [Redstone Studio](https://redstonestudio.org/) | クローズド Web | 短縮リンク共有 + 他人の回路を fork してエディタに取り込む共有モデル。対応部品 8 種で 10 の component scope と直接比較できる。精度の根拠は「wiki 準拠」止まり = **実機 fixture 検証を持つ本プロジェクトが優位を主張できる点** |
| [CraftMC Redstone Circuit Designer](https://www.craftmc.net/tools/minecraft-redstone-circuit-designer) | クローズド Web (2D) | Java 挙動を明示。tick 速度スライダー + 1 tick ステップ、**「短い回路のみ共有リンク・大きい回路は JSON」という保存戦略**が共有 URL 設計の現実的な落としどころの前例。本人が 2D の限界を明記している姿勢も参考 |
| [Redstone Architect](https://maxematical.github.io/redstone-simulator/) | TS + WebGL2 (OSS) | 小規模だが **X キーで dust の plus/dot を明示切替**する UI を持つ。11 (dust 形状と給電) を UI に露出させるときの操作系の先例 |
| [3D-Redstone-Simulator](https://github.com/GuilhermeRossato/3D-Redstone-Simulator) | three.js (OSS) | 名前に反して **redstone は未実装** (README の Objectives が未達)。「3D を歩き回れる redstone サンドボックス」が長年未達である事実自体が、13 §1 のスコープ設定 (歩行より tick 精度) の妥当性の裏付け |
| [schemat.io](https://schemat.io/) | プラットフォーム | .schem/.litematic/.mcs の相互変換 + WebGPU プレビュー + **ゲーム内コマンド/Litematica からの投稿導線**。回路ギャラリーを持つ場合の機能セット。実装を OSS ライブラリ (下記 Nucleation 等) として切り出す戦略も参考 |

### 4.2 ライブラリ・エンジン

| 名前 | ライセンス | 意味 |
|---|---|---|
| [Nucleation](https://github.com/Schem-at/Nucleation) | MIT (star 15) | **最重要の要調査**。Rust+WASM で .litematic/.schem/.nbt を横断パースし、README が「vanilla-accurate tick loop, verified against captures from the game」「MCHPRS redpiler, typed circuit executors」を明記。README の GIF は **ボタン押下後に engine の position-hash 順で update カーソルが dust 上を走る** = 08 のトレース記法とほぼ同じ問題を扱っている。tick 実装と検証手法の突き合わせ相手として価値が高い。ただし star 15 の単一メンテナ規模なので **依存として採用するかは別判断** |
| [MCHPRS Redpiler 設計doc](https://github.com/MCHPR/MCHPRS/blob/master/docs/Redpiler.md) | MIT | ワールド→有向重み付きグラフ化 (重み = dust の減衰距離) と **LLVM 風 pass 構成** (IdentifyNodes / InputSearch / ClampWeights / DedupLinks / ConstantFold / Coalesce / PruneOrphans)、4 段 priority のローテーティングキュー。「編集は素朴グリッド / 実行はコンパイル済みグラフ」の二段構えを取る場合、pass 名と分割粒度をそのまま設計語彙に借用できる |
| [Lodestone](https://github.com/mattzh72/lodestone) | MIT (star 21) | deepslate 由来を明記した three.js ネイティブ TS ライブラリ。chunked meshing + occlusion culling + 透過ソート + **emissive ブロック対応**。ランプ/トーチの発光表現や大規模回路で deepslate の限界に当たったときの移行先候補 |
| [EngineHub SchematicWebViewer](https://github.com/EngineHub/SchematicWebViewer) | MIT (star 77) | WorldEdit 本家の three.js ビューア。**client jar を CORS プロキシ (Cassette Deck) 経由で実行時取得**する設計は、ローカル同梱 (genLocalModels.js) 方式に対する代替案の実装例 |
| [schematic-renderer](https://github.com/Schem-at/schematic-renderer) | **AGPL-3.0** (star 30) | Web Worker マルチスレッド meshing、greedy meshing、リソースパック .zip の自動アトラス化、`onSimulationTicked` 等のコールバック API。**AGPL のため Cloudflare Pages 配信の SPA には依存不可**。設計の参照に留める |
| [litematic-viewer](https://github.com/EndingCredits/litematic-viewer) | ライセンス表記なし | deepslate 経路のブラウザビューアの実例。レイヤ範囲スライダー・資材集計 CSV・3 経路入力。README が既知の穴を正直に列挙しており **deepslate 経路の地雷リスト**として使える。ライセンス表記が無いのでコード流用は不可 |

### 4.3 トレース可視化 (S5 の前に見るべきもの)

| 名前 | ライセンス | 意味 |
|---|---|---|
| [Surfer](https://surfer-project.org/) | EUPL-1.2 | VCD/FST を読む波形ビューア。**WASM でブラウザ実行でき iframe 埋め込み可**。sim が各 tick の power / scheduled tick / priority を VCD で吐けば、08 のトレースを既存 EDA UI (カーソル・信号検索・時間軸ズーム) でそのままレビューできる |
| [WaveDrom](https://github.com/wavedrom/wavedrom) | MIT (3.5k star) | WaveJSON から SVG タイミングチャートを生成。(a) fixture の期待波形を docs に埋め込む (b) 実機 ground truth と sim 出力を並べて差分レビュー (c) **PR 添付図を GIF でなく決定的な SVG にする** に向く |
| [CircuitVerse](https://circuitverse.org/) | OSS | 教育向け Web 論理回路シミュレータの完成形。**testbench で期待動作を宣言し timing diagram で検証**する統合、iframe 埋め込み、subcircuit 再利用。共有/埋め込み/回路テストの 3 課題に対する既成解の集合 |
| [Digital](https://github.com/hneemann/Digital) | GPL-3.0 (5.9k star) | ほぼ全同梱例がテストケースを持つ運用が fixture 駆動と同型。**single gate mode (1 ゲートずつ評価して伝播を追う)** は「1 update ずつ進めるデバッグ UI」の直接の先例 |
| [Logisim-Evolution](https://github.com/logisim-evolution/logisim-evolution) | GPL-3.0 (7.4k star) | **chronogram を標準搭載**。回路編集と波形を同一アプリで往復する UI レイアウトの参照 |

### 4.4 仕様・コミュニティ

- [Sponge Schematic Specification v3](https://github.com/SpongePowered/Schematic-Specification/blob/master/versions/schematic-3.md) —
  .schem の NBT レイアウト (GZip・パレット方式・TileEntity シリアライズ) が版ごとに規定。
  R6 (litematic/schem 対応) の一次仕様。v1〜v3 が同リポに揃う。
- [Open Redstone Engineers](https://openredstone.org/) — 計算機系 redstone の中心コミュニティ
  (サーバ Java 1.21.8、schematic 管理 Schemati、GitHub org は 2026-08 まで更新)。
  **tick 精度を実務家に叩いてもらう / 実回路を fixture として借りる**導線。

### 4.5 既存参照の訂正 (01 / 06 への反映が必要)

| 項目 | 訂正 |
|---|---|
| Mojang 公式配布物の URL | `https://piston-data.mojang.com/` は **404**。実際の入口は `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` |
| 赤石基礎論 ArcFrout | 「記事本体は現時点で 404」と注記されているが **200 で生存**。P5 監視対象として再訪の価値あり |
| theosib RedstoneWireTurbo | URL が MCHPRS を指しており、名前が示す資料 (RedstoneWireTurbo / openredstone フォーラム thread-14591) のどちらでもない。MCHPRS の実質 3 重登録 |
| SubTick / DecompilerMC 等 | 1 エントリに複数実装・複数資料が混ざり URL が 1 本のみ。02 §1 の [要検証] は「chiraag 版 / lntricate1 版のどちらを読んだか」が典拠として効くので分離が必要 |
| 競合 3 サイト | Redstone Companion / Redstone Studio / CraftMC はいずれもクローズドソースで精度の根拠は自己申告。**ベンチマークには使うが 02 の挙動仕様の典拠には一切使わない** |

---

## 5. 運用

- バックログは Project [redtact-com/projects/1](https://github.com/orgs/redtact-com/projects/1) の
  draft として置き、着手時に `/issue-flow` で issue 化して Status を In Progress にする。
  横断 Project「Tasks」#9 からは redstone-sim 分をこちらへ移す。
- 本書は「2026-08-12 時点のスナップショット」であり、個々のタスクの一次資料は
  Project の draft body → 起票後は issue/PR 側が正になる。数値 (テスト本数・LOC 等) の
  追随は目的としない。
