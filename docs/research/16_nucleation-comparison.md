# 16. Nucleation (mc-tick) との比較 — 実装範囲・実装方式・両者の食い違い (#384)

[Schem-at/Nucleation](https://github.com/Schem-at/Nucleation) の tick エンジン `mc-tick` は、
「vanilla の 10 フェーズの順・座標依存のダスト更新順・ピストン・流体・エンティティを headless で再現し、
実機のキャプチャと tick 単位で照合している」と主張する
([docs/features/tick-simulation.md](https://github.com/Schem-at/Nucleation/blob/master/docs/features/tick-simulation.md))。
15 §4.2 で「最重要の要調査」とした相手を、redstone-sim と同じ観点で突き合わせた。

- 調査日: 2026-09-28。対象は Nucleation `51de345` (2026-09-07、MIT、star 24) と redstone-sim `e05b872` (develop)。
- 方法: エージェントの並列調査を 3 段で行った。読解 9 本 (Nucleation 5・redstone-sim 4)、観点別の突き合わせ 3 本、
  反証チェック 6 本。反証チェックでは 26.2 のデコンパイル (tools/decompile、ローカルのみ) を読み、両エンジンを実際に動かした。
  一部は実機ハーネス (Fabric 1.21.1 + carpet) で測った。
- 表記: `N:` で始まるパスは Nucleation `51de345` のリポジトリ相対。それ以外は redstone-sim のリポジトリ相対。
  vanilla の挙動は docs/ip-policy.md に従い「26.2 クラス名#メソッド名 + 自分の言葉」で書く。
- 確かさの表記:
  - **[実機]**: 1.21.1 の実機ハーネスで測った
  - **[逆コンパイル+実行]**: 26.2 を読み、エンジンを動かして確かめた
  - **[逆コンパイル]**: 26.2 とコードを読んだだけ

---

## 0. 結論

1. **作り方は redstone-sim と同じ種類**。vanilla の処理を読んで手で書き、実機で撮った正解と tick ごとに突き合わせて直す。違いは 2 点ある。
   - **写し方**: Nucleation は 26.2 のサーバ jar が難読化されていないことを使い、バイトコードを読んで**処理の構造ごと書き写している**
     (ダストのファイルは自らを "transcribed" と書く)。redstone-sim は挙動を合わせる方針で、ダストのように独自のアルゴリズムで結果を合わせている箇所がある。
   - **正解データ**: Nucleation は Mojang 純正の GameTestServer を Mod なしでプロセス内に起動し、リフレクションで 1 tick ずつ回して撮る (26.2)。
     redstone-sim は Fabric 1.21.1 + carpet を rcon で操作して撮る。
2. **対応範囲は Nucleation が広い**。10 フェーズの tick ループ、水の水平流、アイテム・トロッコ・点火済み TNT・爆発・NaN 速度、
   java.util.Random の再現、構造物配置 (StructureTemplate#placeInWorld) の再現がある。
   redstone-sim はレッドストーン・ピストン・縦方向の水に絞り、エンティティは方針 (13) で扱わない。
3. **精度はどちらが上とも言えない**。突き合わせた論点 184 行の目安は、Nucleation が vanilla に近い 54 行、redstone-sim が近い 37 行、
   同等 56 行、方針の違い 35 行、判定不能 2 行 (行の粒度しだいで変わる数字)。
   - Nucleation が近い点:
     - ダストの逐次評価。途中の値まで出る
     - 近隣更新・形状更新・コンパレーター更新を 1 本のスタックに載せる構造と、setBlock の中の順序
     - 流体の独立フェーズと BlockEntity 相の順
     - ピストン伸長の末尾処理
     - コンパレーターの 3 点
   - redstone-sim が近い点:
     - 予約 tick の意味論。重複抑止のキーが位置とブロック種の組で、予約を実行前に外す
     - ブロックイベントの重複排除
     - ダイオードの優先度判定とコンパレーターの側面入力
     - 導体表
     - flag 2 の書き込みがオブザーバーに見えること
     - PUSH_ONLY と、何も引かない粘着ピストン
   - Nucleation には**よく使う回路が壊れる食い違いが 2 つある** (§3.2)。
     - 自分に信号が戻るトーチクロックが 1 回で止まる
     - ランプ・扉・トラップドア・ホッパー・ディスペンサー・リピーターのロックの変化を、オブザーバーが検知しない
4. **照合の本数と最長は redstone-sim が上**。
   - Nucleation の自動照合はゴールデン 78 本、tick 合計 2,741、最長 200。GitHub Actions (dev-tiers.yml の pre-land) で push・PR・夜間に回る。
   - redstone-sim は CI で 130 本、tick 合計 4,009、最長 400 を照合する。1 本あたりの中央値は同程度 (18.5 と 16)。
   - **tick 内の順序や予約キューを実機と比べる手段は Nucleation が上** (キューの記録、押し構造の直接ダンプ)。
     ただし予約キューの比較 (step_vanilla) と実機での撮り直しは手作業で、CI には無い。
   - 最大級の一致主張 (Nucleation の世界記録ドア、redstone-sim のガラスエレベーター) は、どちらも再現資産がコミットされていない。
5. **redstone-sim の食い違いが 22 件見つかった** (§3.1)。うち 4 件は実機 1.21.1 で確定した。
   - ガラス・上付きハーフ・グロウストーンの段で、ダストが下へ流れる
   - 何も押さない伸長で、BUD が 3 gt 遅れる
   - 押し反応の分類 8 種
   - 普通のトロッコが乗ったディテクターレールを、コンパレーターが 15 と読む

   直し方の多くは小さい (§4)。
   - 2026-10-25 追記: R-1〜R-8 は B2 で、実機 1.21.1 の fixture を撮ってから直した
     (回帰ガード 6 本は #402 / PR#403、R-1・R-2 は #404 / PR#405、R-3・R-4・R-5・R-8 は #406 / PR#407、R-6・R-7 は #408 / PR#409)。
     上の 3 の数と「近い点」は 2026-09-28 の調査時点のもので、コンパレーターの 3 点は今は直っている。
   - 2026-10-25 追記: R-11・R-12・R-14 は B3 で、実機 1.21.1 の fixture 4 本を撮ってから直した (#410 / PR#411)。上の 3 の「ピストン伸長の末尾処理」も今は直っている。
6. **コードは移植しない**。Nucleation 自身が 26.2 から書き写したと言うコードを TS に移すと、03 が避けている「Java→TS の翻訳」と同じことになる。
   挙動の事実・テストケース・キャプチャ手法だけを借りる (§5)。

---

## 1. Nucleation の実装方式

### 1.1 構成

- Rust の workspace。tick エンジンは `N:crates/mc-tick` で、規模は次のとおり。
  - src は約 30,000 行 (単体テストを含む)、tests は約 6,900 行
  - 依存は blake3・smallvec・thiserror の 3 つだけ
  - `forbid(unsafe_code)` で、単一スレッド
- 構造物を実行できる形に組み立てる配線は、`N:crates/mc-test/src/eval.rs` と `N:src/bridge/mc_tick.rs` の 2 か所に重複している。
  後者が Python / JS (WASM) / PHP / C / Kotlin 向けのバインディング (`TickSimulation`) になる。
- 別系統に、MCHPRS redpiler で論理を高速に評価する機能がある (docs/features/redstone-simulation.md)。
  こちらは tick 内の順序・ピストン・エンティティを扱わず、mc-tick の正解の根拠にも使っていない。
- 比較: redstone-sim の sim は TypeScript 約 8,700 行で、runtime 依存は無い。

### 1.2 典拠と検証の流れ

1. **読む**: 26.2 のサーバ jar は実名のまま配布されている。
   - PROJECT.md は、そのバイトコードを読んで定数・遅延・優先度・フェーズ順を拾い、コードは写さないと定める
     (`N:crates/mc-tick/docs/history/PROJECT.md:50`、`:58-60`)。`lib.rs` も「クリーンルーム」と書く。
   - 一方で実装側のコメントは、ダストの評価器や OldMinecartBehavior#moveAlongTrack を "transcribed" と書く
     (`N:crates/mc-tick/src/wire.rs:1-2`、`N:crates/mc-tick/src/minecart.rs:455`)。実態はメソッド単位の書き写しに近い (§5)。
2. **撮る**: 実機オラクルは `N:tools/gametest/`。
   - run.sh が 26.2 の jar を取得・展開してクラスパスを作る (run.sh 自身が javac するのは、合否判定用の RunGameTests と Snbt2Nbt)。
     トレースを撮る capture.sh が、そのクラスパスで TraceCapture.java を javac する
   - GameTestServer をプロセス内で作り、保護されたメソッド (initServer / tickServer) をリフレクションで呼んで 1 tick ずつ進める。Fabric・Mixin・Yarn は使わない
   - ブロックイベントのキューはリフレクションで記録用のサブクラスに差し替え、近隣更新も記録できる
   - `--probe-push` を付けると、押し構造の解決結果 (動かすブロックの一覧) を実機から直接ダンプできる
3. **正解にする**: 各 tick の合間に「構造物 + 余白 4 ブロック」の全座標をスナップショットし、差分をゴールデン JSON にする。
   ゴールデンは `N:crates/mc-tick/tests/traces/*.json` の 103 本で、すべて 26.2。
   NaN の速度は JSON で表せないので、別のテキストログ (`N:tools/gametest/captures/*.entities.log`) に残す。
4. **比べる**: `N:crates/mc-tick/tests/conformance.rs` が同じ .snbt をエンジンで動かし、同じ形のトレースを出して比べる。
   - 同じ tick 内の変化は正味にまとめ、両側を座標順に並べ直してから比較する
   - ブロックとスロットは完全一致、エンティティは位置と速度を成分ごとに 1e-6 まで許す
   - **tick 内の順序と予約キューは自動では比べない**。比べるのは手動ツールの `N:crates/mc-tick/examples/step_vanilla.rs` だけ
5. **指定 tick のシナリオ**: 別系統に、指定した tick の状態を検査する記述子 (`N:crates/mc-test`) がある。
   - 使い道は 3 つ: .snbt の横の `*.test.json`、.litematic に埋め込んだ記述子、Lithium の gametest の移植
   - 既定では tick ごとの変化の列も順序も見ない。必要なケースだけ `events` で変化の発生を要求でき、Lithium の移植はこれを使う
   - 途中経過を既定で見ないのは、MCHPRS のような速いバックエンドでも同じテストを通せるようにするため (`N:crates/mc-test/src/lib.rs:3-8`)

### 1.3 エンジンの作り

| 部品 | Nucleation | redstone-sim |
|---|---|---|
| tick ループ | Phase enum の宣言順で 10 フェーズを毎 tick 回す (26.2 ServerLevel#tick の 9 相 + tick の外で処理するプレイヤー入力)。WorldBorder・Weather・Raids は位置だけを占める no-op (`N:crates/mc-tick/src/phase.rs:57-111`) | tick() に ST → BE → BlockEntity 相の 3 相を直書き (world.ts:524-578) |
| 予約 tick | ブロック用と流体用の 2 本の TickQueue。(発火 tick, 優先度, 予約順) で並べる | 配列 1 本。(優先度, 予約順) で並べ、流体もここに混ぜる |
| ブロックイベント | バッチで取り出して空になるまで繰り返す。独自の 1024 バッチ上限 | 1 件ずつ取り出す FIFO。独自の 65,536 件上限 |
| 近隣更新 | CollectingNeighborUpdater を再帰なしで再現した UpdateEntry スタック。近隣更新・形状更新・コンパレーター更新が同じスタックに乗る (`N:crates/mc-tick/src/behaviour.rs:426-512`) | 同じ形のスタック (world.ts:2640-2680)。ただし形状更新とコンパレーター更新はスタックの外で同期的に呼ぶ |
| ブロック状態 | 状態文字列を u16 の StateId に intern し、状態ごとの挙動インスタンスを表に登録する。遷移先の状態は登録時に解決しておく | 判別共用体 (type 52 種) の不変オブジェクトを `Map<"x,y,z">` に持つ |
| 挙動の分岐 | 状態 ID で引く表 (VanillaRules) と、BlockBehaviour trait のインスタンス | world.ts の switch に直書き |
| 書き込み | set (flag 3 相当) / set_shape_only (flag 2 相当) / set_quiet (更新なし) の 3 種 | apply() が形状更新と近隣更新をまとめて出す |
| ピストン移動 | moving_piston を置いて PendingMove を積み、2 tick 後の BlockEntities 相で挿入順に 1 件ずつ着地させる | moving_piston の blockstate に中身と確定 tick を載せ、BlockEntity 相で seq 順に確定する |
| BE 相当の値 | コンパレーター出力・インベントリ・ホッパーの状態を World の外の表に持つ | BlockState のフィールドに同居させる |
| 未対応ブロック | 挙動の無い状態を記録しておき、配線層が名前の一覧を付けて読み込みを拒否する | mcToSim が最初の 1 件で例外を投げる |
| エンティティ | アイテム・トロッコ (旧物理)・点火済み TNT・爆発・凍結ボディ (火の玉・ブレイズ・村人・ボート・防具立て)。vanilla の float リテラルを f32 から広げて書き、NaN の比較も Java に合わせる | 方針で扱わない |
| 観測 | 全ブロック変化 (tick 付き)、配送単位の更新ログ (tick 内連番・種別・フェーズ)、座標で絞れる環境変数トレース、平行移動に不変な指紋による周期検出、checkpoint/restore | 08 記法のトレース、実機とのライブ 3 パネル比較、MCP |

### 1.4 検証資産の実測

| 項目 | Nucleation | redstone-sim |
|---|---|---|
| 典拠の版 | 26.2 (読むのも照合するのも) | 26.2 のデコンパイルを読み、1.21.1 の実機で照合する |
| 実機の正解データ | ゴールデン 103 本。conformance.rs が参照するのは 80 本で、既定の `cargo test` で比べるのは 78 本 (2 本は ignore のテストからしか使われない)。どのテストからも読まれないものが 23 本 (4x4 / 6x6 / TGM ドアの主要ゴールデンを含む) | fixture 135 本。CI で照合するのは 130 本 (skipUntil 5 本) |
| 長さ | 既定で走る 78 本で、実行 tick 数の中央値 18.5、合計 2,741、最長 200 | CI の 130 本で、tick 合計 4,009、中央値 16、最長 400 (5×5 ドア) |
| 比べる量 | 変化イベント 12,992 件 (既定の 78 本。ignore の 2 本を含む参照 80 本では 16,013) | 比較セル 1,296,851 (CI の 130 本。region 体積 × (tick 数 + 1))。空気でない期待セル × tick は 364,257 |
| 比べる中身 | ブロック状態、コンテナのスロット、エンティティの位置と速度 (成分ごとに 1e-6 まで) | ブロック状態 (材質は代表名に寄せる)。コンテナとコンパレーター出力は、下流のブロック変化で間接的に見る |
| tick 内の順序 | キューと近隣更新を記録できる (自動比較はしない) | microTiming の手動スナップショット 2 例 |
| テストの実行結果 | mc-tick は 385 合格・7 ignore (conformance は 79 合格・2 ignore) | packages/sim は 777 合格・6 skip |
| CI | GitHub Actions の dev-tiers.yml が、master への push・PR・夜間に `tools/dev.sh pre-land` を回す。その中の `cargo test --workspace` で mc-tick の conformance・cases・corpus が走り、ルートの `cargo test` で .litematic 埋め込みシナリオ (55 ブロック 3x3 ドア) が走る。実機オラクルでの撮り直しと step_vanilla は CI に無い | vitest (fixture 130 本・rstest 131 本・MCHPRS 移植 11 本 (ほかに skip 1 本)) と e2e。週次でデコンパイル指紋を監視する |
| 撮り直し | 手作業 (UPDATE_GOLDEN は未実装) | 手書き定義 119 本から再生成できる。実回路は capture → compare → 自動最小化 |

---

## 2. 観点別の比較

「近い方」は vanilla 26.2 (redstone-sim の照合版 1.21.1 と挙動が同じ範囲) にどちらが近いか。
方針の違いで比べられないものは「方針」と書く。

### 2.1 tick ループ・予約 tick・ブロックイベント

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| フェーズ構成 | 26.2 ServerLevel#tick の 9 相に、tick の外で処理するプレイヤー入力を 10 番目として加えた宣言データを持ち、順序を単体テストで固定 | ST → BE → BlockEntity の 3 相のみ | Nucleation |
| 流体 tick | 別キュー・別フェーズ (ブロック予約の直後) | ブロック予約の列に混ぜる | Nucleation |
| BlockEntity 相の順 | 既存の ticker (ホッパー等) → 着地。26.2 では新しい moving_piston の BE がリストの末尾に付くので、結果が一致する | 着地 → ホッパー (逆) | Nucleation |
| ブロックイベントの取り出し | バッチで取り出すので、処理中のバッチに残った同じイベントとの重複排除が抜ける | 1 件ずつ取り出し、常に重複排除が効く (26.2 ServerLevel#runBlockEvents と同じ形) | redstone-sim |
| 予約の重複抑止キー | 位置だけ | 位置 + ブロック種 (26.2 LevelChunkTicks#schedule と同じ) | redstone-sim |
| 発火時のブロック種照合 | 無し | 有り (26.2 ServerLevel#tickBlock と同じ) | redstone-sim |
| willTickThisTick から外すタイミング | 実行と伝播が終わった後。**自分に信号が戻るトーチクロックが 1 回で止まる** | 実行の直前 (26.2 LevelTicks#runCollectedTicks と同じ)。外さないと torch-clock fixture が落ちることを記録済み | redstone-sim |
| 同じ tick の予約の並べ方 | (発火 tick, 優先度, 予約順) | (優先度, 予約順)。差が出るのは期限の過ぎた seed 予約が混ざるときだけ | Nucleation |
| 入力の位相 | 入力で予約した tick は 1 tick 早く発火する | 同じ | 同等 |
| 1 tick の予約上限 (65,536) | 無し | 無し | 同等 |
| イベント連鎖の安全弁 | 1024 バッチで停止理由を返す | 65,536 件で console.warn | 同等 (どちらも vanilla には無い) |
| ランダム tick | 頻度だけ一致する近似 | 無し | Nucleation |
| 保存済みの予約 tick | 読まない | Anvil NBT の block_ticks から読む | redstone-sim |
| エンティティ相 | 種別ごとの固定順 (簡略化) | 対象外 | 方針 |

### 2.2 近隣更新・形状更新

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| 近隣更新 (NC) の DFS | CollectingNeighborUpdater 相当 | 同じ | 同等 |
| 形状更新 (PP) の経路 | NC と同じスタック | スタック外で同期的に呼ぶ。受け手はオブザーバー・塀・板・音符ブロックの 4 種 | Nucleation |
| setBlock (flag 3) の中の順 | NC → 形状更新 (26.2 Level#setBlock と同じ) | 形状更新 → NC (逆) (レバー/ボタンの操作とボタンの解除は #408 で NC が先。ほかは R-15) | Nucleation |
| トップレベルでの即時実行 | set_shape_only などはハンドラが戻るまで保留する | その場で回し切る | redstone-sim |
| コンパレーター更新 (CU) の宛先 | 実行時の経路は、隣を種類を問わず全部起こす | コンパレーターだけ (26.2 Level#updateNeighbourForOutputSignal と同じ) | redstone-sim |
| 送り元ブロックの受け渡し | 方向だけ | 送り元の型 (ドアの同種ガードなどに使う) | redstone-sim |
| 形状更新の深さ上限 512 | 無し | 塀に打ち切りはあるが、呼び直すたびに 0 から数え直すので効かない (R-22) | 同等 (どちらも無い) |
| NC の総数上限 | 100 万。数え方も打ち切り方も vanilla と違う | 同じ | 同等 |
| locational (Java HashSet の反復順) | 再現している。ワールド原点を API の引数で受け、実 Java の出力 10 ケースで固定 | 再現している。実機と同じ絶対座標で走らせ、microTiming の 2 例で固定。app の取り込みは原点に寄せるので、元の順は失われる | 同等 (原点の扱いは Nucleation) |

### 2.3 ダスト

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| 評価アルゴリズム | 26.2 DefaultRedstoneWireEvaluator の書き写し。1 本ずつ計算し直して flag 2 で書き、途中の値まで出る | 2 段 BFS で最終値を先に確定させ、HashSet 順で NC を出す。途中の値は出ない | Nucleation |
| 段差の伝播 | 規則の形は 26.2 と同じ (横のブロックが導体のときだけ 1 段上のダストを読む)。ただし導体表の誤りで、グロウストーンの段では下りにも流れ、soul_sand / packed_ice の段では下りに流れない | 横のブロックが導体のときだけ 1 段上のダストを読む (電力の入力用の近傍 getWireInputNeighbors を、連結成分用の近傍と分けた。#404 / PR#405 で修正。それまでは非導体の段でも下りに流れていた) **[実機 fixture wire-step-nonconductor-down: 上から給電するとガラス・グロウストーン・上付きハーフの段は中段・下段とも 0、石の段は 14 / 13]** | redstone-sim (#404 以降。グロウストーンの段は Nucleation だけが誤り) |
| 上り接続を切るブロック | 導体表と同じ表を引く。ただし表の誤りをそのまま受け、グロウストーンと銅の電球で切り、soul_sand / packed_ice / blue_ice では切らない | 導体表 (isConductor) に委ねる (#404 / PR#405 で修正。それまでは別のリストで slime_block / lodestone / soul_sand が抜けていた) **[実機 fixture wire-cut-conductor-power: 3 型で蓋をすると上段は 0 で十字になり、石と同じ]** | redstone-sim (#404 以降。Nucleation は表の誤りが残る) |
| 導体表の正確さ | packed_ice / blue_ice / soul_sand を非導体、グロウストーン・銅の電球・ケーキを導体と取り違える | 実機で 1 個ずつ測った表 | redstone-sim |
| 接続対象 (shouldConnectTo) | 検知レール・トラップチェスト・避雷針にも接続する。書見台は信号源に入っておらず、接続しない | detector_rail と lectern に接続する **[実機]** (R-8。#406 / PR#407 で直した。fixture wire-connect-detector-rail-lectern。以前はどちらにも接続しなかった)。トラップチェスト (container に潰す) と避雷針 (decor) はまだ信号源として扱わない | Nucleation (トラップチェストと避雷針。書見台は redstone-sim) |
| 接続形状の UP / SIDE | 横のブロックがフルブロックかで区別する (26.2 RedStoneWireBlock#getConnectingSide は、横のブロックのダスト側の面が頑丈かを見る) | 常に up (見た目だけの差) | Nucleation |
| 除去時の追加更新 | 近傍更新だけで、再計算が欠ける | フックは無い。ダストの電力の再計算の起点に、段越しに読むダスト (隣の隣) と置いたダスト自身を含める (#404 / PR#405。それまでは非導体の段の下段を消しても中段・上段が古い値のまま残り、ガラスの上に dot で置いたダストが 0 のままだった) **[実機 fixture wire-step-nonconductor-down: 下段を消すと中段・上段は 0、置いた dot は真上の redstone_block で 15]**。ダスト以外の素子へ届く近隣更新は出ない | 同等 (redstone-sim はダストの再計算だけ、Nucleation は近傍更新だけ) |
| 支え (canSurvive) | 無し (下からの形状更新を意図的に無視) | 無し | 同等 |

### 2.4 ダイオード・オブザーバー

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| shouldPrioritize (-3) の判定 | 入力側を見て、しかも条件が逆 | 出力側のダイオードがこちらを向いていないとき (26.2 DiodeBlock#shouldPrioritize と同じ) | redstone-sim |
| tick 中の自己 OFF 予約の優先度 | -2 固定 (26.2 DiodeBlock#tick と同じ) | -3 になりうる → **[実機]** fixture repeater-self-off-priority で確定し、#408 / PR#409 で -2 固定にした | Nucleation → 同等 |
| コンパレーターの側面入力 | 通常の信号で読むので、横のトーチで出力が 0 になる | 26.2 DiodeBlock#getAlternateSignal (SignalGetter#getControlInputSignal) 相当 | redstone-sim |
| 背面の導体越し読み | 置き換え (26.2 と同じ) | 置き換え **[実機]** (R-4。#406 / PR#407 で直した。fixture comparator-through-conductor-replace。以前は max で合成していた) | 同等 |
| compare モードで出力が変わらない tick | 前方へ更新を出す (26.2 と同じ) | 前方へ更新を出す **[実機]** (R-5。#406 / PR#407 で直した。fixture comparator-compare-front-nc。以前は出さなかった) | 同等 |
| 出力の BE 保持 | 有り | 有り | 同等 |
| トーチ burnout | 160 gt 後の再判定が無い。窓の境界も違う | 再判定あり (fixture torch-burnout-recovery) | redstone-sim |
| トーチの NC 回数と順 | 26.2 の形 (2 段送信 1 回。起点は Direction.values() の順) | 回数は 1.21.1 の形 (2 段送信 2 回)。ただし起点の 6 隣を西・東・下・上・北・南の順で回し、vanilla の Direction.values() の順 (下・上・北・南・西・東) と違う (R-21) | 回数は版の違い (§3.4)。起点の順は Nucleation |
| コンパレーター反転時の前方更新 | 1 回 (vanilla は 2 回) | 1 回 | 同等 (どちらも 1 回少ない) |
| オブザーバー本体 | 形状更新でだけ起動、2 gt | 同じ | 同等 |
| flag 2 の書き込みの可視性 | ランプ・扉・トラップドア・フェンスゲート・ホッパー・ディスペンサー・リピーターのロック・音色を更新なしで書くので、オブザーバーに見えない | 見える | redstone-sim |
| 同じ tick に facing 先も着地するオブザーバー (#292 holdNC) | 専用の規則は無い。着地を 1 件ずつ処理する順で対処 | 実測から入れた経験則 | 不明 |

### 2.5 ピストン

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| 起動 (checkIfExtend と同じく予約前に押し構造を解決) | 有り | 有り | 同等 |
| 押し構造の探索 (addBlockLine・12 個上限) | 26.2 PistonStructureResolver の移植 | 同じ | 同等 |
| 枝の方向順 | Direction.values() の順 | 北・南・東・西・上・下 | Nucleation |
| PUSH_ONLY (釉薬テラコッタ) | 後ろ向きの粘着連鎖と、引きの開始で見落とす | 全経路で判定する **[実機で redstone-sim の正しさを確認]** | redstone-sim |
| 押し反応の分類 | 手書きのリスト。シュルカーボックスを二重登録、水を運ぶ、BE 持ちの看板などを押す、ベル・飾り壺・頭を壊さずに運ぶ | 手書きのリスト。検知レールとクラフターを壊し、ドア・銅の電球・トラップドア・塀・板を押せない **[実機]**。水も押せない ([逆コンパイル+実行]、実機は未測定) | Nucleation (ただし水は両方とも誤り) |
| 一般則 (硬さ -1・BE 持ちは不動) | 無し | 無し | 同等 |
| 着地 (2 tick 後・挿入順) | 有り | 有り | 同等 |
| 伸長の最後のヘッド位置からの近隣更新 | 必ず出す | 必ず出す。修正前は押すものが無いと出なかった **[実機: 3 gt 遅れ]**。#410 / PR#411 で修正 | 同等 |
| 空いた出発セルの形状更新 | 出す | 出す。ダストの再計算の起点にも入れる。修正前は伸長で空いた枝の出発セルからは出さなかった (収縮では出す) **[実機]**。#410 / PR#411 で修正 | 同等 |
| 伸長時の更新順 | vanilla の順 | vanilla の順。本体は最後に extended=true にする。修正前は本体を先に書いていた **[実機]**。#410 / PR#411 で修正 | 同等 |
| 何も引かない粘着ピストンのヘッド | 無音で消すので、オブザーバーが発火しない | 近隣更新と形状更新を出す | redstone-sim |
| 引けたときのヘッド位置・移動先からの近隣更新 | 出さない。ヘッドは更新なしで消し、そこへ置く moving_piston からは形状更新だけが出る (26.2 と同じ) | 形状更新に加えて近隣更新も出す (余分) | Nucleation |
| 収縮イベントの 2 種 (短パルスでブロックを落とす判定) | 区別する (条件は簡略化) | 区別しない | Nucleation |
| 0-tick・短パルスのブロック落とし | 有り | 有り | 同等 |
| 複合機構の一致 | 飛行機械とコミュニティ製ドア 5 件が一致。slime_extender は tick 5 で不一致 (ignore) | 飛行機械 3 本と 5×5 ドア (400 tick) が一致 | 同等 |

### 2.6 その他の部品・コンテナ

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| レバー/ボタンの NC | 3 回 (flag 3 の書き込みで 1 回 + updateNeighbours で 2 回) | 2 回。形状更新より前の 1 回が欠ける → **[実機]** fixture lever-nc-before-shape-race / button-nc-before-shape-race で確定し、#408 / PR#409 で 3 回にした (ボタンの解除も同じ順) | Nucleation → 同等 |
| エンティティで動く部品 (感圧板・検知レール) | 実エンティティで判定する | 手動トリガと一定 gt 後の自動 OFF | 方針 |
| 扉・トラップドアを素手で操作 | 無し | 有り | redstone-sim |
| 音符ブロックの音色 | harp と basedrum の 2 種だけ | 26.2 の Blocks から生成した表 | redstone-sim |
| 銅の電球 | コンパレーターで読めず、導体として扱う。着地時の反転判定はある | コンパレーター読みと CU がある。着地時の再判定は無い | 分かれる |
| 書見台 | 本入りを読み込みで拒否する | コンパレーター読みあり (ページ送りのパルスは無い) | redstone-sim |
| 通常レールの形状・T 字路の切り替え | 無し | 有り | redstone-sim |
| 支えを失ったレール | 壊れる | 浮いたまま残る | Nucleation |
| 塀・板の形状更新 | 無し | 有り | redstone-sim |
| TNT・ケーキ・ベル・砂・避雷針 | 黙って不活性 (ケーキは導体扱い) | TNT・ケーキ・ベルは取り込み時に拒否する。砂・砂利は重力の無い solid として、避雷針は装飾として黙って通す | redstone-sim (TNT・ケーキ・ベルのみ。砂と避雷針はどちらも黙って通す) |
| スタック上限の表 | 部分的な表。経路によっては 64 固定 | 1.21.1 の全 1333 アイテムから生成 | redstone-sim |
| ラージチェスト (54 スロット) | 有り | 無し | Nucleation |
| 蓋がふさがったチェスト (コンパレーター 0) | 有り (判定は full cube で近似) | 無し | Nucleation |
| 検知レールのコンパレーター読み | 載っているトロッコの中身 | 常に 0 **[実機]** (R-3。#406 / PR#407 で直した。fixture detector-rail-comparator: 普通のトロッコが乗っても実機は 0。以前はレールが ON なら 15 だった)。トロッコを持たないので、中身を持つトロッコは表せない (13 §2) | 同等 (普通のトロッコの範囲)。中身を持つトロッコは Nucleation |
| ホッパーの基本の移送 | 有り | 有り | 同等 |
| 取り出しに失敗したときの CU | 有り | 無し | Nucleation |
| ディスペンサーの特殊な挙動 | シュルカーボックス・防具立て・バケツ | バケツだけ | Nucleation |
| 大釜・コンポスター・クラフターの読み | 全種類 | 一部 | Nucleation |

### 2.7 流体・エンティティ・乱数

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| 水の水平流 | 有り (5 gt・下が優先・深さ 4 の斜面探索。実機ゴールデン water_spread / water_hole で固定) | 縦だけ | Nucleation |
| 泡柱ブロックの生成・維持 | 無し (不活性として登録) | 有り (実機 fixture で固定) | redstone-sim |
| 溶岩 | 読み込みを拒否 | 読み込みを拒否 | 同等 |
| ディスペンサーのバケツ | 有り | 有り | 同等 |
| エンティティ | アイテム・トロッコ・TNT・爆発・凍結ボディ。未対応の種類は名前を挙げて拒否 | 対象外 | 方針 |
| ピストンによるエンティティの変位 | トロッコと凍結ボディだけ | 対象外 | 方針 |
| 乱数 | java.util.Random をビット単位で再現。実サーバと draw 単位で一致させることは契約外 | 乱数を使わず、先頭の非空スロットで決定化 | 方針 |

### 2.8 読み込み・観測・構造

| 論点 | Nucleation | redstone-sim | 近い方 |
|---|---|---|---|
| 構造物配置 (placeInWorld) の再現 | 有り (3 群のソート・1 個ずつ onPlace・updateShapeAtEdge) | 無し (定常状態を計算し直す) | Nucleation |
| 保存状態を信頼するモード | 有り (InWorld) | 有り (trustAuthored) | 同等 |
| 隠れ状態の復元 | OutputSignal とインベントリは読む。予約とクールダウンは読まない | 予約・OutputSignal・クールダウンを Anvil NBT から読む | redstone-sim |
| moving_piston を含む状態 | 黙って読み込み、着地しないまま固まる | 明示的に拒否する | redstone-sim |
| 未知のブロック | 名前の一覧でまとめて拒否する | 最初の 1 件で例外 | Nucleation (使い勝手) |
| チェックポイント | ランダム tick 用の乱数と ticker を含まない | core の clone は完全。app の保存は blocks だけ | 方針 |
| ベンチマーク | criterion で計測 | 無し | — |

---

## 3. 反証チェックで確定した食い違い

### 3.1 redstone-sim 側

| # | 食い違い | vanilla (26.2 / 1.21.1) | 確かさ・結果 | 効く回路 |
|---|---|---|---|---|
| R-1 | ガラス・上付きハーフ・グロウストーンの段で、ダストが下へ流れる | RedstoneWireEvaluator#getIncomingWireSignal: 1 段上のダストを読むのは、横のブロックが導体のときだけ。非導体の段は上り専用 | **[実機]** 上から給電すると、実機は中段・下段とも 0、sim は 14 / 13。下から給電と石の段は一致。**#404 / PR#405 で修正** (fixture wire-step-nonconductor-down: ガラス・グロウストーン・上付きハーフの段で全 tick 一致) | ガラス段やハーフ段をダイオードとして使う縦配線 |
| R-2 | 上り接続を切る判定に slime_block / lodestone / soul_sand が無い (blocks/wire.ts:11-22) | RedStoneWireBlock#getConnectingSide: 真上が導体なら切る。3 種はどれも導体 | **[実機]** 3 種で蓋をすると、実機は上段が 0 で十字になり stone と同じ。sim は 14 のまま形も変わらない。**#404 / PR#405 で修正** (fixture wire-cut-conductor-power。isWireCutBlock を isConductor に委ねた) | スライムやソウルサンドの脇にダストを這わせる機構 (ガラスエレベーター等) |
| R-3 | 普通のトロッコが乗ったディテクターレールを、コンパレーターが 15 と読む (world.ts:100-117) | DetectorRailBlock#getAnalogOutputSignal: コンテナ付きかコマンドブロック付きのトロッコ以外は 0。コンパレーターは通常の信号をこの値で置き換える | **[実機]** 実機 0 / sim 15 (トロッコが無ければ一致)。fixture detector-rail-comparator: レールが点いたあとも (t3〜t8) コンパレーターは点かない。修正前の sim と 12 セル食い違う。**#406 / PR#407 で修正済み** | トロッコの通過をコンパレーターで検出する回路 |
| R-4 | コンパレーターの導体越し読みを max で合成する (world.ts:3204-3207) | ComparatorBlock#getInputSignal: 置き換え | **[実機]** 弱充電 13 の石の奥が空の樽なら 0、中身 3 の樽なら 3、無しなら 13、カートの無い検知レールなら 0 (修正前の sim は 4 本とも 13)。fixture comparator-through-conductor-replace: 修正前の sim と 15 セル食い違う。**#406 / PR#407 で修正済み** | ブロック越しの空検知・残量表示 |
| R-5 | compare モードで出力が変わらない tick に、前方へ更新を出さない (world.ts:1583-1590) | ComparatorBlock#refreshOutputState: compare モードなら値が同じでも前方を更新する | **[実機]** 2 gt パルスを飲み込んだ tick (t6) に、compare の前方の BUD ピストンだけが伸びる。subtract のピストンは t8 の近隣更新 (対照) まで伸びず、コンパレーターは 2 本とも一度も点かない。fixture comparator-compare-front-nc: 修正前の sim と 12 セル食い違う。**#406 / PR#407 で修正済み** | コンパレーターを BUD のトリガやパルス検出に使う回路 |
| R-6 | リピーターが tick 中に自分の OFF を予約するとき、優先度が -3 になりうる (world.ts:1579) | DiodeBlock#tick: 常に -2。-3 を選ぶのは近隣更新から予約するときだけ | **[実機]** fixture repeater-self-off-priority: 側面ロックの相手 (遅延 2) の自己 OFF と被ロック側 (遅延 3) の自己 OFF が同じ gt に重なると、実機は被ロック側が先に走って何もせず、ロックが外れてから OFF を積み直す (OFF は t24)。修正前の sim は -3 の相手が先に走って t18 に OFF。#408 / PR#409 で -2 固定にして直した | 直列のリピーターと側面ロックの組み合わせ |
| R-7 | レバー/ボタンの近隣更新が 1 回少なく、しかも形状更新が先に出る (world.ts:1231-1239) | LeverBlock#pull: flag 3 の書き込みで自分の周り → 形状更新 → updateNeighbours。ButtonBlock#press と解除の ButtonBlock#tick → checkPressed も同じ順 | **[実機]** fixture lever-nc-before-shape-race / button-nc-before-shape-race: レバーを直接読むコンパレーターとレバーを見るオブザーバーが同じ gt・優先度 0 で予約されるとき、実機はコンパレーター側のピストンが先に動く (t6 に取り合うマスへ石。修正前の sim はガラス)。ボタンの解除でも同じ順 (t26 に石が戻る)。#408 / PR#409 で押下・解除とも直した | 予約の順で勝敗が決まる競争 |
| R-8 | ダストが detector_rail と lectern に接続しない (wire-shape.ts:42-71) | RedStoneWireBlock#shouldConnectTo: 信号源なら接続する | **[実機]** 検知レールと書見台の隣のダストは直線のまま (修正前の sim は十字になり、横のランプまで点く)。書見台は通常レールの向きの門番でも信号源 (setblock で置くと 3 方向ジャンクションが向きを決め直す)。fixture wire-connect-detector-rail-lectern: 修正前の sim と 27 セル食い違う。**#406 / PR#407 で修正済み** | トロッコ検出の信号をダストで横へ引き出す配置 |
| R-9 | 押し反応の分類が 8 種で違う (world.ts:1763-1819) | PistonBaseBlock#isPushable と Blocks の登録。検知レール・銅の電球・トラップドア・塀・ガラス板は押せる。クラフターは BE を持つので不動。budding_amethyst と扉は壊れる | **[実機]** 8 種すべて実機と違う。sim は検知レールとクラフターを壊し、残りは押せない。budding_amethyst は取り込めない | 検知レールや塀・板を押す扉、クラフターや扉の前のピストン |
| R-10 | 水・泡柱・シュルカーボックス・カボチャ類・苔・植木鉢・はしご・頭の押し反応。看板・旗・彫刻された本棚を押してしまう | 水・泡柱・シュルカー・カボチャ類・苔・植木鉢・はしご・頭は DESTROY。看板・旗・彫刻された本棚は BE を持つので不動 | [逆コンパイル+実行] (実機では未測定) | 水路のゲート、カボチャ・スイカの収穫ピストン |
| R-11 | 何も押さない伸長で、ヘッド位置から近隣更新が出ない (SimWorld.executeBlockEvent の伸長の分岐) | PistonBaseBlock.moveBlocks: 伸長の最後に、必ずヘッド位置から出す | **[実機]** ヘッド位置の隣の BUD ピストンが、実機は t5、sim は t8 (3 gt 遅れ)。石を押す対照は一致。fixture piston-empty-extend-bud: ヘッド位置の隣の BUD ピストンも、石を押す側の対照も t3 に伸び始めて t5 に着地する。修正前の sim は前者だけ t6 に伸び始める (8 セル食い違う)。**#410 / PR#411 で修正済み** | 空打ちのヘッドで BUD を叩く回路 |
| R-12 | 枝の空いた出発セルから形状更新が出ない。ダストの再計算も漏れる (SimWorld.executeBlockEvent の伸長の分岐。ダストの再計算は SimWorld.afterPistonMove に渡す形状更新の列から作る) | PistonBaseBlock.moveBlocks: 空いたセルを空気にして、そこから形状更新を出す | **[実機]** fixture piston-branch-vacate: スライムで redstone_block を横へ引き離すと、元位置の横のダストは t3 に 0 になって十字に変わり、その先のランプは t7 に消える。元位置を見るオブザーバーは t5 に ON、t7 に off。修正前の sim はダストが 15 のまま、ランプも点いたまま、オブザーバーも発火しない (10 セル食い違う)。正面から押す対照は一致。**#410 / PR#411 で修正済み** | スライムで引き離したブロックの元位置を見るオブザーバーと、その横のダスト |
| R-13 | addBranchingBlocks の方向順が vanilla と違う (world.ts:1918-1929) | Direction.values() の順 (下・上・北・南・西・東) | [逆コンパイル+実行] 上と北に枝があり、2 本のピストンが同じセルを取り合う形で勝者が逆になる (実機では未測定) | 多方向に枝がある粘着塊 |
| R-14 | 伸長で本体を先に extended=true にしてから更新を出す (SimWorld.executeBlockEvent の伸長の分岐) | PistonBaseBlock.triggerEvent: moveBlocks が戻ってから本体を伸びた状態で書く (近隣更新 → 形状更新) | **[実機]** 途中で再判定されるピストンから、本体はまだ縮んで見える。fixture piston-push-away-power: 押した塊で自分の QC の電源 (redstone_block) を運び去ったピストンは、t3 に伸びたまま残り、t5 のヘッドの着地の近隣更新で再判定して t6 に縮み始め、t8 に着地する。修正前の sim は出発セルの近隣更新で収縮を予約し、t3 のうちに縮み始める (0-tick。8 セル食い違う)。fixture piston-base-nc-last-race: 出発セルの上の BUD ピストンが、本体の横の BUD ピストンより先に予約され、取り合うマスを t3 に取る (修正前の sim は逆。23 セル食い違う)。**#410 / PR#411 で修正済み** | 隣り合うピストンの連鎖。押した塊で自分の電源を運び去るピストン (修正前の sim は 0-tick で縮んだ) |
| R-15 | setBlock の中の順が「形状更新 → NC」(vanilla は逆)。形状更新とコンパレーター更新がスタックの外 (world.ts:1498-1509, 2573-2602, 803-813) | Level#setBlock は NC → CU → 形状更新。形状更新も CollectingNeighborUpdater を通る | [逆コンパイル+実行] トーチが消えたとき、オブザーバーと壁トーチの予約順が逆になる | 同じ gt・同じ優先度の予約の競争 |
| R-16 | 流体 tick をブロック予約の列に混ぜる (world.ts:2820-2839) | ServerLevel#tick はブロック予約をすべて回してから流体予約を回す | [逆コンパイル+実行] ディスペンサーの汲み上げと重なると、5 tick のあいだ穴が開いたまま | 条件がそろった泡柱エレベーター |
| R-17 | BlockEntity 相で、着地がホッパーより先 (world.ts:597-628) | Level#tickBlockEntities: 新しい ticker は末尾に付くので、既存のホッパーが先 | [逆コンパイル+実行] ホッパーが 1 個少なく運ぶ | ピストンで動力源を運んでホッパーを止める仕分け機 |
| R-18 | 泡柱のブロック tick と流体 tick を 1 つのキーにまとめている。形状更新で再予約しない | BubbleColumnBlock#updateShape: 形状更新のたびに流体 tick を予約し、ブロック tick は条件付きで別に予約する | [逆コンパイル] | 泡柱の書き換えが続く機構 |
| R-19 | 着地のたびに、どのブロックでもコンパレーター更新を出す (world.ts:791) | Level#setBlock が CU を出すのは、新しい状態がアナログ出力を持つときだけ | [逆コンパイル] | (多くは空振りで無害) |
| R-20 | 分岐したダスト網の中の更新順 (network-piston) | 26.2 のコードを追うと、原点配置では E → N → S になり、Nucleation と一致する。world.test.ts:713-724 は S → E → N を固定しているが、この配置は実機で未観測 (09_snapshots/network-piston-order.md) | [逆コンパイル+実行] 中心座標 513 点のうち 76 点で、両エンジンの順序が食い違う | ダスト網で複数のピストンを起動する回路。**未確定** (§6) |
| R-21 | トーチの状態が変わったときの 2 段送信で、起点の 6 隣を西・東・下・上・北・南の順に回す (world.ts:2517-2526) | RedstoneTorchBlock#onPlace (1.21.1 は #onRemove も) は Direction.values() の順 (下・上・北・南・西・東) で回す。1.21.1 と 26.2 で同じ | [逆コンパイル] | 距離 2 の素子に届く近隣更新の順が変わる。予約やブロックイベントの積まれる順に効きうる |
| R-22 | 塀の形状更新の連鎖に上限が無い (world.ts:2317-2318 の深さ 512 の打ち切りが効かない) | Level#setBlock の updateLimit (既定 512) で、形状更新の連鎖は 512 段で止まる | [逆コンパイル+実行] emitShapeUpdate から呼び直すたびに深さを 0 から数え直すので、塀を 700 段積んで最上段を変えると全段が書き換わる | 512 段を超える塀の柱 (実用上はまれ) |

補足:

- R-1・R-3・R-9・R-11 は、実機ハーネスで同じ回路を走らせ、実機と sim の状態系列を比べて確定した。§4 の修正では、まず fixture にしてから直す。
- R-3・R-4・R-5・R-8 は #406 / PR#407 で、fixture 4 本 (detector-rail-comparator / comparator-through-conductor-replace / comparator-compare-front-nc / wire-connect-detector-rail-lectern) を実機 1.21.1 で撮ってから直した (2026-10-25)。4 本とも修正後の sim と全 tick で一致した。
- R-6・R-7 は #408 / PR#409 で、fixture 3 本 (repeater-self-off-priority / lever-nc-before-shape-race / button-nc-before-shape-race) を実機 1.21.1 で撮ってから直した (2026-10-25)。3 本とも修正後の sim と全 tick で一致した。
- R-11・R-12・R-14 は #410 / PR#411 で、fixture 4 本 (piston-empty-extend-bud / piston-branch-vacate / piston-push-away-power / piston-base-nc-last-race) を実機 1.21.1 で撮ってから直した (2026-10-25)。4 本とも修正後の sim と全 tick で一致した。
  R-14 ははじめ、実機で差を示しにくいとみて fixture を作らずに直す案だった。自分の電源を運び去るピストンで目に見える差 (0-tick) が出るとわかったので、撮ってから直すことにした。
  1.21.1 の PistonBaseBlock は読んでいない。伸長の順 (行き先 → ヘッド位置 → 空いたセル → 近隣更新 → 本体) が 1.21.1 でも同じことは、4 本の一致で確かめた。
- 1.21.1 と 26.2 で規則が同じことは、R-1〜R-8 について確かめた。1.21.1 の server jar を公式 mappings でデコンパイルし、
  9 クラス (LevelChunk / Level / RedstoneTorchBlock / LeverBlock / ButtonBlock / DiodeBlock / ComparatorBlock / RedStoneWireBlock / DetectorRailBlock) に加えて、
  Blocks (R-2 の導体: ソウルサンドは常に導体、スライムとロードストーンは既定のフルブロック判定で導体) と LecternBlock (R-8: 常に信号源) を読んだ。
- 逆に、実機で redstone-sim の方が正しいと確認できたものもある。
  - 釉薬テラコッタは引いても付いてこず、スライムの背後からも連れて行かれない
  - カートの無いディテクターレールをコンパレーターが読むと 0 になる
  - ランプの点灯・消灯をオブザーバーが検知する

### 3.2 Nucleation 側 (参考)

上流に報告するかどうかは別判断。ここでは、redstone-sim の設計で同じ穴を避けるための材料として記録する。

| # | 食い違い | 確かさ |
|---|---|---|
| N-1 | 予約を willTickThisTick の集合から外すのが実行の後 (`N:crates/mc-tick/src/sim.rs:3517-3578`、`schedule.rs:114-146`)。自分に信号が戻るトーチクロックが 1 回で止まる | [逆コンパイル+実行] |
| N-2 | flag 2 の書き込みを、更新なしの set_quiet で書く (`N:crates/mc-tick/src/components.rs:1788` のランプほか)。対象はランプ・扉・トラップドア・フェンスゲート・ホッパー・ディスペンサー/ドロッパー・リピーターのロック・音色で、オブザーバーが検知しない | [実機] (ランプは実機で検知されると確認) + [逆コンパイル+実行] (音色以外の 7 種は Nucleation で不発。音色は `components.rs:2556` のコード読みのみ) |
| N-3 | 予約の重複抑止と発火時の照合が位置だけ。ピストンで動かしたあとに取り残された予約が、別の種類のブロックで発火する | [逆コンパイル+実行] 3 例を再現 |
| N-4 | shouldPrioritize の判定が、入力側を見るうえに条件が逆 | [逆コンパイル] |
| N-5 | コンパレーターの側面入力を通常の信号で読む。横のトーチで出力が 0 になる | [逆コンパイル+実行] |
| N-6 | 導体表の誤り。packed_ice / blue_ice / soul_sand を非導体、グロウストーン・銅の電球・ケーキを導体として扱う。グロウストーンの段では信号が下へ流れる (R-1 と同じ症状) | [逆コンパイル+実行] |
| N-7 | 押し反応の誤り。シュルカーボックスが押し出し列の 2 個目以降にあると、押し出し全体が失敗する。釉薬テラコッタが後ろ向きの粘着連鎖と引きで動く。水を運ぶ。BE 持ちや硬さ -1 のブロックを押す。ベル・飾り壺・頭を壊さずに運ぶ。金床・砥石・ロードストーンを押す | [実機] (釉薬テラコッタの vanilla 側) + [逆コンパイル+実行] |
| N-8 | 何も引かない粘着ピストンがヘッドを無音で消す。オブザーバーも BUD も反応しない | [逆コンパイル+実行] |
| N-9 | ブロックイベントをバッチで取り出すため、重複排除が抜ける (プローブでは実害なし) | [逆コンパイル+実行] |
| N-10 | コンテナが変化したときのコンパレーター更新を、種類を問わず隣に送る | [逆コンパイル] |
| N-11 | ダストの角の更新 (RedStoneWireBlock#checkCornerChangeAt 相当) で、updateNeighborsAt を角の位置に 1 回しか出さない (vanilla は角の位置と 6 近傍の計 7 回)。除去時の再計算と、周りのダストへの更新も欠ける | [逆コンパイル] |
| N-12 | トーチ burnout 後の 160 gt の再判定が無い | [逆コンパイル] |
| N-13 | TNT・砂・砂利・ケーキ・ベル・避雷針・トリップワイヤーフックが、黙って不活性として通る (「未対応は拒否」の例外) | [逆コンパイル+実行] |
| N-14 | moving_piston を含む保存状態を黙って読み込み、着地しないまま固まる | [実行] |
| N-15 | 保存された予約 tick を読まないので、遅延の途中の状態を InWorld で再現できない | [読解] |

### 3.3 Nucleation の文書と実態のずれ

| 文書の主張 | 実態 |
|---|---|
| 世界記録の 55 ブロック 3x3 ドアが、実機と 1 周期ゼロ食い違いで一致する | ブロックトレースは gitignore された作業ディレクトリにあり、コミットされていない。自動テストは .litematic 埋め込みの 3 シナリオで、判定はすべて tick 400 の 1 時点 (初期状態との一致・累積変化数・充填数など)。1 周期を tick ごとに実機と照合するテストは無い |
| シードを入れると、vanilla と draw 単位で bit 一致する | コードは draw 単位の一致を契約外と明記している。アイテム用とランダム tick 用に、独立した乱数を 2 本作る |
| 静止している区間は早送りされる | 時間を飛ばす実装は無い。100 万 tick 先に予約が 1 件だけある世界で 702 ms かかり、tick 数に比例する |
| モデル化できないものは名前を挙げて拒否する | TNT・砂・ケーキなどは黙って不活性になる (N-13) |
| everything stacks to 64 | 1 / 16 / 64 の部分表があるが、経路によっては 64 固定 |
| 332 tests / 6 ignored | 実測は 385 合格・7 ignore |
| `cargo test --test litematic_cases` で埋め込みケースが動く | 実際のファイルは tests/embedded_cases.rs |
| クリーンルーム実装 (lib.rs) | wire.rs・minecart.rs は "transcribed" と自称している |
| ROADMAP: 拒否されたイベントを再予約するのが vanilla の仕様 | 26.2 が再予約するのは、ticking 対象外の位置のイベントだけ。コードの方が正しい |
| 6x6 ドアの ignore 理由 (tick 1 で食い違う) | 実行すると通る |

### 3.4 版の違い (1.21.1 と 26.2)

- **トーチの LIT 切り替え**:
  - 26.2 の LevelChunk#setBlockState は、ブロックの種類が変わったときしか撤去処理 (affectNeighborsAfterRemoval) を呼ばない。そのため 2 段送信は 1 回になる。
  - 1.21.1 は state が変わるたびに onRemove と onPlace の両方を呼ぶので、2 回になる。
  - redstone-sim は送信の回数が 1.21.1 の形 (2 段送信 2 回) で、実機ハーネスとは一致する。
    ただし 6 つの起点を回る順は西・東・下・上・北・南で、1.21.1 の RedstoneTorchBlock#onRemove / #onPlace とも 26.2 の #notifyNeighbors (どちらも Direction.values() の順) とも違う (R-21)。
  - **02_behavior-spec.md:162,168 (「LIT 変化ごとに onRemove / onPlace の両方」。02:10 の凡例で 1.21.1 と 26.2 の両方で確認済みの扱い) と、
    07_mojira-fixtures.md:34,145 の「26.2 デコンパイルで確認済」は、26.2 には当てはまらない**。訂正が要る。
  - CONTRIBUTING.md の「26.2 の既定挙動は 1.21.1 と同一」は、ワイヤの更新順については正しいが、一般化はできない。
- **ピストンが壊すブロックの撤去処理**:
  - 26.2 の PistonBaseBlock#moveBlocks は、壊すセルを flag 18 (近隣更新なし) で空気にするので、書き込みの時点では撤去処理が走らない。
    moving_piston を置き、空いたセルに形状更新を出したあと、壊したセルに近隣更新を出すループの中で明示的に呼ぶ。
  - 1.21.1 は同じ flag 18 の書き込みでも LevelChunk#setBlockState が onRemove を必ず呼ぶので、壊した瞬間 (moving_piston を置く前) に走る
    (1.21.1 の PistonBaseBlock と LevelChunk のデコンパイルで確認)。
- **フラグ**: 26.2 には、onPlace や BE 撤去の副作用を飛ばすフラグ (512 / 256) がある。1.21.1 には無い。
- **エンティティの Motion の読み込み**: 1.21.3〜1.21.10 は NaN を保ち (±Inf と絶対値 10 超は 0 にする)、1.21.11 以降は非有限値を捨てる。
  Nucleation が 1.21.3〜26.2 の各リリースの mapping を調べ、境界の 2 版を javap で確かめた (`N:tools/gametest/NAN-MOTION-VERSIONS.md`)。
  1.21.2 以前は調べていない。redstone-sim の範囲外。
- **鎖の ID**: 26.2 では鎖の ID が iron_chain になっている。DECOR_EXACT には chain しか無いので、26.2 のキャプチャでは未対応になる。

### 3.5 redstone-sim の文書・コメントの誤り

- **ip-policy 違反 (#386 / PR#387 で修正済み)**: tools/mc-harness/runner/scheduled-ticks.ts に、デコンパイル由来の record 宣言と式の断片がそのまま入っていた。
  当時の tools/ip-hygiene.test.ts の正規表現は、アクセス修飾子も波括弧も無いこの形を検出できなかった。PR#387 で典拠を自分の言葉に直し、record 宣言と型付き引数リストの検出パターンを足した。
- **02_behavior-spec.md**:
  - §6 のピストンのタイムラインは「moving_piston は ST 相で確定」と書くが、#80 以降は BlockEntity 相
  - 02:187 (と 12:98) は「PP の再帰カスケードは無い」と書くが、実際には塀が形状更新のたびに下と横の塀へ再帰する (world.ts:2359-2363)。
    深さ 512 の打ち切りは効いていない (R-22)
  - 02:431 はディスペンサーを非実装と書くが、実装済み
  - §6 hopper は座標順の走査と書くが、実際は挿入順で、-1 の補正もある
- **15_project-review.md の数値が古い**: 対応 26 型・テスト 428・fixture 54 と書くが、実測は 52 型・783・135。
- **コード中の古いコメント**:
  - world.ts:527 の「ST フェーズのみ」
  - world.ts:1753 の isMovable の説明
  - world.ts:1775 と types.ts:361 の「PushReaction STICKY」。26.2 の enum にこの値は無い
  - world.ts:2554 の「lamp は NC を発する」。26.2 は flag 2 で書くので NC は無く、挙動の方が正しい
  - blockNames.ts:133 の「いずれも pushReaction(BLOCK)」。26.2 PistonBaseBlock#isPushable で見ると、押せない理由は次の 3 つに分かれ、BLOCK が決め手のものは無い:
    名指しの判定 (黒曜石・泣く黒曜石・リスポーンアンカー・強化深層岩)、硬さ -1 (岩盤・コマンドブロック 3 種・ストラクチャーブロック・ジグソー・バリア・エンドポータルの枠)、BE 持ち (スポナー・トライアルスポナー・金庫)。
    budding_amethyst は DESTROY で壊れる
  - power.ts:28、types.ts:54、types.ts:654
- **使われていない定義**: IMMOVABLE_SOLID の 16 名のうち、効いているのは obsidian・crying_obsidian・bedrock・reinforced_deepslate の 4 名だけ。
  残りの 12 名 (respawn_anchor・spawner・trial_spawner・vault・budding_amethyst・command_block 系 3 種・structure_block・jigsaw・barrier・end_portal_frame) は isSolidBlockName を通らない。
  そのため取り込めない (mcstate は例外、app の nbtIO は警告を出して省略)。
- **mc-harness の記述が古い**: README の skip 表と、compare.ts:314 のコメント。

---

## 4. redstone-sim に取り込める設計・検証手法

コストは S (数行〜1 ファイル) / M (数ファイル・fixture 追加) / L (基盤の追加)。

### 4.1 正しさの修正 (§3.1 の対応)

| 内容 | 対象 | コスト |
|---|---|---|
| ダストの上り判定を「横が導体のときだけ上段を読む」にし、isWireCutBlock を isConductor に一本化する。再計算の起点に段越しの読み手と置いたダスト自身を足す (#404 / PR#405 で済み。実機 fixture wire-step-nonconductor-down・wire-cut-conductor-power) | R-1, R-2 | S |
| トーチの 2 段送信の起点を Direction.values() の順にする。塀の形状更新の連鎖に、呼び直しでも引き継ぐ深さを持たせる | R-21, R-22 | S |
| コンパレーターの 3 点を直す: 導体越しは置き換え、compare モードでは空振りでも前方更新、detector_rail をアナログ出力と接続対象に加える (lectern も接続対象に) (#406 / PR#407 で済み。fixture 4 本を実機で撮ってから直した) | R-3, R-4, R-5, R-8 | S |
| リピーターの自己 OFF を -2 固定にする。レバー/ボタンは、形状更新より前に自分の周りへ NC を 1 回出し (flag 3 の書き込みの分)、形状更新 → updateNeighbours の NC の順にする (activateBlock は apply とは別の経路なので、R-15 の修正では直らない) (#408 / PR#409 で済み。ボタンの解除も同じ順にした) | R-6, R-7 | S |
| 押し反応の表を 26.2 の Blocks に合わせる。判定は PistonBaseBlock#isPushable の順にする: 硬さ -1 は不動、次に押し反応 (BLOCK は不動、DESTROY は壊す、PUSH_ONLY は向きしだい) で決め、NORMAL のものに限って BE 持ちを不動にする (シュルカー・ベル・飾り壺・頭は BE を持つが壊れる) | R-9, R-10 | M |
| 伸長の末尾処理を moveBlocks の順にする。ヘッド位置から NC を出し、空いたセルに形状更新を出し、本体の更新を最後にする (#410 / PR#411 で済み。fixture 4 本を実機で撮ってから直した) | R-11, R-12, R-14 | S〜M |
| addBranchingBlocks を Direction.values() の順にする (updates.ts にある既存の定数を使う) | R-13 | S |
| ip-policy 違反を直し、ip-hygiene に record 宣言のパターンを足す (#386 / PR#387 で済み) | §3.5 | S |

実機で確定した 4 件 (R-1・R-3・R-9・R-11) は、先に fixture にしてから直す。
それ以外の件も、直すときに実機で 1 回測ってから fixture にする (実機と照合していない指摘だけで挙動を変えない)。

### 4.2 構造の改善

| 内容 | 理由 | コスト |
|---|---|---|
| フェーズ順を宣言データにし、未実装の相を no-op として本来の位置に置く | 流体の分離や BE 相の順の修正で、周りを配線し直さずに済む。食い違ったとき、どの相かが構造から分かる | S |
| 流体の予約を別キューにし、ブロック予約の直後の相で回す | R-16 | S |
| BlockEntity 相を「登録順の ticker 1 本」にし、新しい moving_piston を末尾に足す | R-17 | M |
| setBlock の中を NC → CU → 形状更新の順にし、形状更新と CU を NC と同じスタックに載せる。Nucleation の UpdateKind (Neighbor / Shape) の分け方が、再帰なしで書く手本になる | R-15 | M |
| 予約のソートキーに発火 tick を足す | 期限の過ぎた seed 予約が混ざっても、1 チャンク内なら vanilla と同じ順になる。26.2 LevelTicks は、チャンクをまたぐ合流では優先度と予約順しか比べないので、そこまで合わせるにはチャンク単位のキューが要る | S |
| 収縮イベントを 2 種 (通常と、短パルスでブロックを落とすもの) に分け、判定を NC の時点で行う | 26.2 PistonBaseBlock#checkIfExtend と同じ形にする | S |

### 4.3 検証・観測の強化

| 内容 | 理由 | コスト |
|---|---|---|
| **Nucleation を第 2 の参照実装にした差分スクリーニング**。1.21.1 と 26.2 で挙動が同じ部品に限り、同じ回路を両エンジンで走らせ、差が出た箇所だけ実機で決着させる | 今回は両エンジンの読解を突き合わせ、食い違った箇所を 26.2 のデコンパイルと sim の実行で確かめるだけで、redstone-sim の食い違いが 22 件見つかった (§3.1)。両エンジンを同じ回路で走らせたのは R-20 の掃引だけなので、ここを自動化すれば、実機で fixture を作る前の安いふるいになる。ただし検知レール (R-3) のように、差の中身は実機で測って初めて定まるものもある | M |
| コンテナのスロットを、tick ごとの比較対象に加える | ホッパーの移送のように、ブロック状態に出ない変化を直接検出できる | M |
| 配送単位の更新ログ (tick 内の連番・NC / 形状更新 / CU の種別) と、座標で絞れる診断トレース | 現在の trace には形状更新と CU が出ない | S〜M |
| 実機の予約キューとブロックイベントキューを tick ごとに比べる (step_vanilla 相当) | 「世界は一致しているのに予約だけ違う」という発散を、1 tick 早く見つけられる | L |
| 26.2 の GameTestServer を第 2 の実機オラクルにする (Mod なし、キューの記録、押し構造のダンプ) | 手作業の microTiming を置き換え、26.2 の実機照合が無いという制約も埋まる | L |
| 版の境界を二分探索する (リリースごとの mapping と javap) | 1.21.1 と 26.2 の差 (§3.4) を体系的に確かめられる | M |
| 状態の指紋で周期を検出する (平行移動に不変な版で、飛行機械のずれも検出する) | クロックの周期や、ドアのサイクル復帰を自動で判定できる | M |
| 未知のブロックを一覧にまとめて返す | 取り込めない理由が一度で全部分かる | S |
| 実 Java で出した HashSet の反復順の表でテストを補強する | microTiming 2 例に加えて、安く裏付けを増やせる | S |
| skip 中の fixture を定期的に回し、通るようになったものを報告する | Nucleation の 6x6 ドアのように、skip の理由が古くなるのを検出できる | S |

### 4.4 範囲を広げるもの (判断が要る)

| 内容 | 判断のきっかけ | コスト |
|---|---|---|
| ダストの逐次評価 (途中の値まで出す) | R-20 が実機で Nucleation 側と確定したら優先度を上げる | L |
| .nbt 取り込みの初期化モードとして placeInWorld を再現する | 構造ブロックで置いた直後の挙動 (全オブザーバーのパルス) を再現したくなったら | M |
| 水の水平流 | 13 のスコープ判断が要る | M |
| 取り込み時に元のワールド座標 (ハッシュ用の原点) を保持する | 実回路の locational な順を保ちたい場合 | S |
| ラージチェスト・蓋のふさがったチェスト・銅の電球の着地時の再判定・取り出し失敗時の CU | コンテナを使う回路の対応を広げるとき | S〜M |

### 4.5 逆に Nucleation が redstone-sim から学べる点

- 予約の意味論 (§2.1 の redstone-sim 側) と、flag 2 の書き込みで形状更新を出すこと
- 実機のセーブから予約 tick と TransferCooldown を持ち込み、動いている機械の途中から始めること (OutputSignal は Nucleation も読む)
- 実回路の食い違いを delta debugging で最小 fixture に落とす工程
- 手書き定義からの fixture の再生成
- デコンパイル指紋のドリフト監視と ip-hygiene
- 区画全体を最長 400 tick 比べる、長い照合

---

## 5. 取り込みの方針 (著作権)

- **Nucleation のコードは移植しない**。
  - Nucleation は MIT だが、`wire.rs`・`minecart.rs` などは 26.2 から "transcribed" と自称している。関数の構成も vanilla のメソッドにほぼ 1 対 1 で対応する。
  - これを TS に移すと、03 が避けている「Java→TS の機械的な翻訳」を 1 段挟んで行うのと同じになる。
  - MIT は Mojang の表現に対する権利を与えないので、帰属表示を付けても解消しない。
- **挙動の事実** (順序・条件・遅延・フラグ) は Nucleation を手がかりにしてよい。
  ただし典拠は自分で 26.2 のデコンパイルを読み直し、ip-policy の書き方 (クラス名#メソッド名 + 自分の言葉 + 実測) で書く。
- **テストケース** (回路の配置と期待値) は、mchprs-ported.test.ts と同じく帰属を付けて移せる。
  ただしゴールデンは 26.2 の値なので、1.21.1 の典拠にするなら自前のハーネスで撮り直すか、版を明記して分ける。
- **キャプチャ手法** (GameTestServer の駆動、キューの記録、原点の記録、余白付きの観測窓、正味の変化への正規化) は、アイデアとして自前で実装する。
  TraceCapture.java はコピーしない。
- Lithium 由来 (LGPL-3.0) の構造物や、許諾の分からないコミュニティ製のドアは取り込まない。
- **依存として採用するか**: 15 §4.2 のとおり単一メンテナの規模 (star 24) で、§3.2 の食い違いもある。
  sim のエンジンを置き換える理由は無い。差分スクリーニング (§4.3) の道具として手元で使うに留める。

---

## 6. 未確定・次の一手

- **R-20 (ダスト網の中の更新順)**: 原点配置で 1.21.1 実機の microTiming を取り、world.test.ts:713-724 の固定と 26.2 のコード読みのどちらが正しいか決める。
  実機が E → N → S なら、ダストの逐次評価 (§4.4) の優先度が上がる。
- **R-13 (枝の方向順) と R-15 (予約順の逆転)**: 競争になる回路を実機で測り、fixture にする。
- **1.21.1 のデコンパイル**: 1.21.1 の server jar を公式 mappings でデコンパイルし、26.2 との差 (§3.4) を体系的に洗う。今回は反証チェックで 9 クラスだけ行った。
- **起票 (済み)**: §3.1 の R-1〜R-22 は Project #1 に draft として起票した (タイトル末尾が (R-n))。着手するときに issue にする。
- **上流への報告**: Nucleation に §3.2 を報告するか (ユーザ判断)。

---

## 付録 A. 調査の手順

- **共通の観点**: 読解エージェントには、次の 18 観点を渡して同じ分類で書かせた。
  tick ループ / 予約 tick / 近隣更新 / ダスト / ダイオード / オブザーバー / ピストン / QC・BUD / その他の部品 / コンテナ /
  流体 / エンティティ / 乱数 / 読み込み / 検証 / 構造 / 観測 / 制約
- **突き合わせ**: 観点グループごとに両側の主張を対応付けた。重要な行は実際のコードを開いて確かめ、読解の誤り 20 件を訂正した。
- **文書のレビュー**: 本書の初稿を節ごとに 5 本のエージェントで反証レビューし、39 件の指摘を反映した
  (Nucleation の CI の扱いの誤り、グロウストーンの導体扱いの漏れ、R-21・R-22 の追加など)。
- **反証チェック**:
  - 主張ごとに、26.2 のデコンパイルとエンジンの実行で白黒をつけた
  - プローブのスクリプトはリポジトリの外 (セッションの一時領域) に置き、コミットしていない
  - Nucleation のビルドは、.cargo/config.toml が sccache を要求するので `RUSTC_WRAPPER=` で回避した
- **実機ハーネス**:
  - generate.ts は fixture をリポジトリ内に書き出すので使わず、rcon を直接叩いて操作した
  - 使った領域は空気に戻し、他の領域・tick の状態が開始時と同じことを確かめた
