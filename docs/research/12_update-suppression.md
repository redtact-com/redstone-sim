# 12. 更新抑制 (update suppression) の設計調査 (#53)

#14 (I6) で「抑制系は v2」と据え置いた大物 (04 §4-3) について、実装着手前の意思決定材料を作る。
本メモは (1) 更新抑制の分類を一次資料で確定し、(2) sim モデル化の選択肢を工数・価値つきで提示し、
(3) 受け入れ基準の草案、(4) 実装 issue 分解案 までをまとめる。**コード変更は伴わない (調査のみ)。**

方針は既存規約どおり **典拠 1.21.1 + 26.x 併読**。デコンパイル典拠は `tools/decompile/out/26.2/`。
確度ラベルは 02/04 に準拠 ([確定] / [推定] / [要検証])。

参照: 02 §2.3 (件数上限) / §4.2 (更新伝播順)、04 §3 (I6) / §4-3 (locational 判断)、
`packages/sim/src/world.ts` (submitUpdate)。

---

## 0. 用語の整理 — 「更新抑制」は 2 系統ある

技術勢が「update suppression」と呼ぶものには、実装上まったく別系統の 2 つが含まれる。
本メモではこれを混同しないよう、以下のように呼び分ける。

| 呼称 | 実体 | 発火契機 | 決定性 | 単一チャンク sim での再現性 |
|---|---|---|---|---|
| **A. 総数上限打ち切り** (Update Skipping) | `CollectingNeighborUpdater` の `maxChainedNeighborUpdates` 到達で以降の更新を捨てる | 純粋に更新件数 | **完全に決定的** | **再現可能** (下記 §2a) |
| **B. 例外系抑制** (Update Suppression 本来義) | 更新カスケード中に例外を投げ、上位 try-catch が握り潰して残り更新を放棄 | `OutOfMemoryError` / `ClassCastException` 等 | JVM ヒープ量・チャンク境界依存で**非決定的** | **再現不可** (下記 §3) |

回路勢が「アップデートサプレッサー」と言うときはほぼ **B** を指すが、B は環境依存 (後述) で
単一チャンク・決定的 sim のスコープ外。sim が忠実再現を検討する余地があるのは **A** のみ。

---

## 1. A: 総数上限打ち切り (`maxChainedNeighborUpdates`)

### 1.1 上限値 = 1,000,000 [確定: 26.2 デコンパイル]

02 §4.2 が既に記載のとおり、上限は **深度ではなく総数**で、値は **1,000,000**。

- 統合サーバ (シングルプレイ): `MinecraftServer.getMaxChainedNeighborUpdates()` が `return 1000000;` を直返し
  (`net/minecraft/server/MinecraftServer.java:2047`)。
- 専用サーバ: `DedicatedServerProperties.maxChainedNeighborUpdates = this.get("max-chained-neighbor-updates", 1000000)`
  (同上 `:100`)。**既定 1,000,000、server.properties で変更可**。
- この値が `Level` コンストラクタ経由で `new CollectingNeighborUpdater(this, maxChainedNeighborUpdates)`
  に渡る (`Level.java:152`、`ServerLevel.java:238`)。

### 1.2 打ち切りの挙動 [確定: 26.2 `CollectingNeighborUpdater.addAndRun`]

```java
private void addAndRun(BlockPos pos, NeighborUpdates update) {
   boolean runningAlready = this.count > 0;
   boolean tooManyUpdates = this.maxChainedNeighborUpdates >= 0 && this.count >= this.maxChainedNeighborUpdates;
   this.count++;
   if (!tooManyUpdates) {
      if (runningAlready) this.addedThisLayer.add(update);
      else                this.stack.push(update);
   } else if (this.count - 1 == this.maxChainedNeighborUpdates) {
      LOGGER.error("Too many chained neighbor updates. Skipping the rest. First skipped position: {}", pos.toShortString());
   }
   if (!runningAlready) this.runUpdates();
}
```

確定できる仕様:
- **skip されエラーログのみ、rollback なし** (02 §4.2 の記述どおり)。上限到達後の更新は**キューに積まれず捨てられる**が、
  既にキュー内にある更新は最後まで処理される (`runUpdates` は例外を投げない)。
- **ログは 1 回だけ**: `count - 1 == max` の瞬間 (＝最初に捨てた 1 件) のみ `LOGGER.error(...)` を出す。
  以降の捨てられた更新は無言。ログには最初に捨てた座標 (`First skipped position`) が入る。
- `count` はカスケード全体で共有される走行カウンタで、最外の `runUpdates` の `finally` で 0 にリセットされる
  (＝ **1 回の外部トリガあたり 1,000,000 件の予算**)。tick をまたいでは持ち越さない。
- 技術 wiki の表現「blocks will still send their updates once the list reaches the cap, but will not propagate
  any further」は、**キュー内の残りは走るが、そこから新たに生えた更新は積まれない**というこの挙動の言い換え。

### 1.3 カウント対象 [確定: 26.2] — sim との突き合わせで重要

`addAndRun` を通るものすべてが 1 件としてカウントされる。すなわち:

| 更新種 | 呼び口 | カウント |
|---|---|---|
| **NC** (単発 `neighborChanged`) | `SimpleNeighborUpdate` / `FullNeighborUpdate` | 1 件 |
| **NC** (6 方向一括 `updateNeighborsAtExceptFromFacing`) | `MultiNeighborUpdate` | **提出 1 件** (＝ fan-out する 6 方向は**カウントされない**) |
| **PP** (`shapeUpdate`) | `ShapeUpdate` | 1 件 |
| **CU** (`updateNeighbourForOutputSignal`) | 内部で `neighborChanged` を呼ぶ | 呼んだ本数ぶん |

**キモ**: 6 方向一括更新 (`MultiNeighborUpdate`) は `addAndRun` を **1 回**しか通らない。
その `runNext` は各方向で `NeighborUpdater.executeUpdate` を**直接**呼ぶ (`addAndRun` を再入しない) ため、
fan-out の 6 方向はカウンタに乗らない (`CollectingNeighborUpdater.java:147-169`)。
つまり vanilla のカウンタは「更新**タスクの提出数**」であって「実行された neighborChanged 数」ではない。
NC/PP/CU の 3 種すべてが同一カウンタを共有する。

出典: `CollectingNeighborUpdater.java`、`NeighborUpdater.java`、`Level.java`
(`updateNeighbourForOutputSignal:1004`)、いずれも out/26.2。

### 1.4 参考: shape update には別系統の深度上限がある (`updateLimit` = 512) [確定: 26.2]

A とは別に、**PP (updateShape) のカスケード深度**を切る第 2 の上限が存在する。

- `Level.setBlock(pos, state, flags)` は 3 引数版で `updateLimit = 512` を既定にして 4 引数版へ委譲
  (`Level.java:217-218`)。
- shape 更新のたびに `updateLimit - 1` して伝播し (`Level.java:257-261`、`LevelAccessor.neighborShapeChanged:71`、
  `InstantNeighborUpdater:26`)、`updateLimit <= 0` で shape 伝播が止まる。
- これは総数ではなく**再帰深度**の上限で、A (総数 1,000,000) とは独立。落砂・ワイヤ結線形状の連鎖など
  updateShape 主体のカスケードにのみ効く。到達要件は「512 段の updateShape 連鎖」で、A よりは近いが依然
  手組み単一チャンクでは非現実的。

sim は現状 PP を `emitShapeUpdate`(オブザーバー起動のみ) に限定しており updateShape 再帰カスケード自体を
持たないため、この 512 上限は**モデル化対象外で問題ない** (§4 で scope-out 宣言)。

### 1.5 「skip 後も tick 継続」の帰結 [確定]

A の打ち切りは例外ではないので、**残りの tile tick 処理・block event 処理は普通に継続する** (02 §4.2 補足どおり)。
つまり A で得られる「suppression 的」効果は「1,000,000 件目以降の隣接更新が届かない」だけで、
tick ループ全体を止める B のような破壊力はない。回路勢が実用する抑制器はほぼ B。

---

## 2. sim 現実装との突き合わせ (world.ts submitUpdate)

`packages/sim/src/world.ts:1047-1083` の `submitUpdate` は A を模したプッシュ型 DFS を実装している。
突き合わせで **2 つのずれ**を確認した。

### 2a. 【要修正】上限値が 65,536 で、正値 1,000,000 と食い違う

```ts
// world.ts:1067-1073
if (++this.updateCount > 65_536) {
  // vanilla の maxChained 溢れ相当 (skip してエラーログのみ、02 §4.2)
  console.warn('[sim] NC 更新数が上限を超過。以降の更新を破棄します')
  this.updateStack.length = 0
  this.addedThisLayer.length = 0
  break
}
```

- sim の閾値 **65,536** は、**§2.3 の tile tick 件数上限 (`MAX_SCHEDULED_TICKS_PER_TICK` = 65,536)** と
  同一値。おそらく別系統の上限を取り違えてコピーしたもの。**neighbor update chain の正値は §4.2 の 1,000,000。**
- コメント「vanilla の maxChained 溢れ相当」も値としては**誤り** (16 分の 1 で早期に打ち切る)。
- ただし後述のとおり **65,536 でも 1,000,000 でも実挙動には差が出ない** (どちらも手組み回路では到達不能)。
  影響は「仕様書 §4.2 と実装コメントの整合が崩れている」という文書一貫性の問題が主。

### 2b. 【設計差】カウント意味論が vanilla と異なる

| | vanilla (§1.3) | sim 現実装 |
|---|---|---|
| カウント単位 | 更新**タスクの提出数** | **実行した neighborChanged 数** |
| 6 方向一括 (multi) | 提出 1 件 | 方向ごと (最大 6 件) — `world.ts:1065` の `top.idx++` ごとに `updateCount++` |
| PP (shapeUpdate) | 同一カウンタに計上 | **非計上** (`emitShapeUpdate` は別経路・カウンタ無し) |
| CU | 同一カウンタに計上 | **非計上** (sim はコンパレーター出力を直接計算) |

- 上限まで丁寧に一致させたいなら「提出時に +1」へ寄せ、multi は 1 件、PP/CU も同カウンタに合流させる必要がある。
- **実用上は無差別**: 単一チャンク手組み回路で 65,536 はおろか数千の連鎖すら稀。この差が観測に出るのは
  「意図的に上限へ突っ込む病的回路」だけで、それ自体が sim の主対象 (定常状態＋タイミング) の外。

### 2c. 一致している点

- 上限到達時に `updateStack`/`addedThisLayer` を空にして打ち切り、以降の tick 処理は継続する骨格 (§1.2/§1.5) は正しい。
- `updateCount` を最外 `submitUpdate` の末尾で 0 リセット (`world.ts:1082`) するのも vanilla の `finally` リセットと等価。
- ログ 1 回きり (vanilla) に対し sim は打ち切り時に 1 回 `console.warn` — 実質等価 (毎回吐かない)。

---

## 3. B: 例外系抑制 — 歴史と現行 1.21.1/26.2 での可否

### 3.1 StackOverflowError (〜1.18)【1.21.1/26.2 では消滅】

- 1.18 以前は隣接更新が**再帰**で実装され、2,000〜3,000 ブロック (`-Xss` 縮小でさらに少なく) の連鎖で
  Java スタックを溢れさせ `StackOverflowError` を投げて残り更新を握り潰す古典技だった。
- **22w11a (1.19 スナップショット) で再帰スタックがキュー (反復) に置換**され、この技は根絶。
  現行 `CollectingNeighborUpdater` は `ArrayDeque` + `ArrayList` の反復処理 (§1.2) なので
  **SO は原理的に不能** [確定: デコンパイルで反復実装を確認 + 技術 wiki 一致]。
- → **典拠版 (1.21.1/26.2) には存在しない。sim が SO 系を再現する意味はゼロ。**

### 3.2 ClassCastException (16w39a〜23w33a)【1.21.1/26.2 では修正済み】

- 「Shulker Class Cast Exception」: シュルカーボックスに非対応の block entity (書見台・ジュークボックス) を
  仕込み、コンパレーターが読むと `Container`/`Inventory` への不正キャストで `ClassCastException` を投げ、
  上位 try-catch が握り潰して抑制する技。
- **23w33a で修正**され現行版では不成立 [推定: mcdf wiki の可用バージョン表記に基づく。1.21.1/26.2 での不成立自体は
  未実測だが修正済みバージョンより後発]。
- → **典拠版に存在しないと見なしてよい。要 fixture 実測なら §3.4 の注記どおり。**

### 3.3 OutOfMemoryError (22w11a〜現行)【現存するが環境依存】

現行 1.21.1/26.2 で「現存する抑制テク」は実質これ 1 系統。技術 wiki (techmcdocs / mcdf) の記述:

- **仕組み**: 更新カスケードとは別のデータ構造 (`HashSet`/entity list 等) を、JVM ヒープを意図した閾値まで
  埋めた状態で**リサイズ (upsizing)** させ、その瞬間に `OutOfMemoryError` を誘発する。OOM が
  「握り潰される文脈 (プレイヤー起因の try-catch 内)」で投げられると、残り更新が放棄されて抑制成立。
- **代表 2 方式**: (a) Synced Block Event Queue — 境界チャンクにピストン/音符イベントを積んで RAM を埋め、
  浮遊コンパレーターで upsizing を誘発。(b) Server Entity Manager — 境界チャンクでエンティティをロードし、
  BUD 起動 TNT でエンティティリスト upsizing を誘発。
- **なぜ A (1,000,000 上限) で防げないか**: OOM 方式は**隣接更新リストそのものではなく別構造**を溢れさせる。
  A のカウンタは neighbor update の提出数しか見ないため、OOM の担い手 (block event queue / entity list) には効かない。

**sim にとっての含意**:
- OOM は **JVM ヒープ量 (`-Xmx`)・GC タイミング・チャンク境界**に依存し、値が決まらない。
  **決定的 sim では原理的に「いつ OOM か」を定義できない** → 再現不可・スコープ外が妥当。
- しかも 2 方式とも **境界チャンク (複数チャンク)** を要件にしており、単一チャンク sim の前提から外れる。

出典: [Update Suppression – Technical Minecraft Wiki](https://techmcdocs.github.io/pages/BugsAndExploits/UpdateSuppression/)、
[Java Edition:Update Suppression – Minecraft Discontinued Features Wiki](https://mcdf.wiki.gg/wiki/Java_Edition:Update_Suppression)、
[Block updates and update detectors – Technical Minecraft Wiki](https://techmcdocs.github.io/pages/GameMechanics/BlockUpdates/)。
いずれも二次資料 (技術コミュニティ wiki) のため確度は [推定]。反復化 (§3.1) のみデコンパイルで [確定]。

### 3.4 チャンク境界・unload 系の抑制 = スコープ外宣言 [方針]

- OOM 方式 (§3.3)、および「更新が非 ticking / unload チャンクへ渡ると退避・再スケジュールされ観測上抜ける」系
  (02 §3 の非 ticking チャンク退避、`MultiNeighborUpdate` 内の `level.hasChunkAt` ガード等) は、
  **すべて複数チャンク・チャンクロード状態を前提**とする。
- 本 sim は **単一チャンク・全ロード前提**であり、これらは**明示的にスコープ外**と宣言する。
  「単一チャンク sim はチャンク境界・unload 由来の抑制/更新欠落を対象外とする」を 10 (component-scope) に一文追記推奨。

---

## 4. sim モデル化の選択肢

タスク指定の (a)/(b)/(c) を、根拠・工数・回路勢価値つきで提示する。

### 選択肢 (a): A の忠実再現のみ (現実装の検証 + 実値修正)

- **内容**: §2a の 65,536→1,000,000 修正 + コメント訂正。任意で §2b のカウント意味論を vanilla の
  「提出数・multi=1・PP/CU 合流」へ寄せる。B は再現しない。
- **根拠**: A は §1 のとおり完全に決定的で 26.2 デコンパイルに一次典拠がある。sim の対象 (定常＋タイミング) と整合。
- **工数感**: **小 (半日〜1 日)**。値修正＋コメントは数行。カウント意味論の厳密一致まで欲張ると +0.5 日
  (PP/CU をカウンタに合流させる配線が必要)。
- **回路勢価値**: **低〜中**。1,000,000 に手組みで到達しないため観測差はほぼ出ない。ただし
  「仕様書 §4.2 と実装の値一致」「将来ストレステスト/自動生成回路での正しさ」という**基盤的正しさ**の価値はある。
- **推奨度**: 値修正 (§2a) は**低工数で仕様一貫性を回復するので単独でも実施価値あり**。意味論一致 (§2b) は任意。

### 選択肢 (b): B (例外系抑制) の再現

- **内容**: OOM / CCE / SO 由来の「カスケード中断＋残り更新放棄」を sim でエミュレート。
- **根拠の弱さ**: SO は典拠版で消滅 (§3.1)、CCE は修正済み (§3.2)、OOM は JVM ヒープ・チャンク境界依存で
  **決定的に定義不能**かつ**複数チャンク前提** (§3.3)。一次典拠 (デコンパイル) で「いつ抑制か」を確定できない。
- **工数感**: **特大〜不能**。「意図的に例外文脈を作り残り更新を捨てる」API を足すだけなら中規模だが、
  **どの回路でいつ発火するかを vanilla と一致させることが原理的に不可能** (ヒープ量非決定)。
  実機 fixture で ground truth を取ろうにも OOM は実行環境ごとに閾値が動く。
- **回路勢価値**: 概念上は最大 (抑制器＝回路勢の花形) だが、**忠実性を担保できないため「それらしく動くが実機と一致しない」
  リスクが高く**、sim の売り (実機一致) を毀損しかねない。
- **推奨度**: **非推奨**。やるなら「決定的に近似したトグル (例: 明示ブロック/コマンドで抑制を発火させる教育用モック)」に
  留め、「実機の OOM 抑制とは別物」と明示すること。

### 選択肢 (c): スコープ外宣言

- **内容**: B 全系統 (OOM/CCE/SO) と shape 深度上限 512 とチャンク境界抑制を「単一チャンク・決定的 sim の対象外」と
  10/02 に明文化。A は「値だけ正す (＝実質 a の §2a)」か「現状維持」を選ぶ。
- **根拠**: §3 のとおり B は決定性・チャンク前提・典拠のいずれでも sim と噛み合わない。
- **工数感**: **極小 (数時間)**。ドキュメント追記のみ。
- **回路勢価値**: 「何が対象外か」を明示することで**誤用・過信を防ぐ**価値。抑制器を組む勢には
  「本 sim では抑制は検証できない」と最初に伝わる。
- **推奨度**: **必須の下地**。(a) と排他ではなく、(c) を土台に (a) の §2a を乗せる形が最良。

### 総合推奨

**(c) を土台に (a) の §2a (値 65,536→1,000,000 の修正 + コメント訂正) を実施し、B は明示スコープ外**。
理由: B は忠実性を担保できず sim の価値 (実機一致) を毀損するリスクが上回る。A の値修正は低工数で
仕様一貫性を回復できる。§2b の意味論厳密一致は「病的回路の観測が課題化したとき」の将来対応で十分。

---

## 5. 受け入れ基準の草案 (検証可能な形)

選択肢別に、検証可能な受け入れ基準を示す。実機 fixture で取れるものは回路案を併記。

### (a)-§2a: 値修正の受け入れ基準

1. `world.ts` の打ち切り閾値が **1,000,000** になっている (専用サーバ差分は sim 対象外なので既定値のみ)。
2. 打ち切り時のコメント/警告文が「maxChainedNeighborUpdates = 1,000,000 到達」を指し、§2.3 の tile tick 上限 (65,536) と
   混同していない。
3. **回帰安全性 fixture**: 既存の全 fixture が変更後も緑 (＝閾値変更が通常回路の観測を一切変えないことの確認)。
   → 手組み回路は 1,000,000 に届かないので、値を上げても既存 261 テストが不変であることが「実害なし」の証明になる。

- **実機 fixture 化の可否**: 1,000,000 到達の実機再現は現実的でない (病的巨大回路が必要) ため、
  **上限到達そのものの実機 fixture は作らない**。「到達しないことの確認」を上記 3 で担保する。

### (a)-§2b: カウント意味論一致の受け入れ基準 (任意)

4. 単体テストで、6 方向一括更新 (multi) が **カウンタ +1** (提出数意味論)、単発 NC が +1、PP/CU も +1 で計上される。
   → 実機 ground truth ではなく**デコンパイル仕様 (§1.3) をオラクルにした単体テスト** (`CollectingNeighborUpdater` の
   カウント規則を移植した期待値)。閾値を意図的に小さくしたテスト専用 world を作り、既知の更新列でカウンタ推移を照合する。
5. 上限を跨ぐ瞬間に「最初に捨てた座標」相当の情報が 1 回だけ記録される (vanilla の `First skipped position` 相当)。

### (c): スコープ外宣言の受け入れ基準

6. `docs/research/10_component-scope.md` に「B (例外系抑制: OOM/CCE/SO)・shape 深度上限 512・チャンク境界/unload 由来の
   抑制は単一チャンク決定的 sim の対象外」の一節が追加され、根拠 (§3) へのリンクがある。
7. `docs/research/02_behavior-spec.md` §4.2 補足の「再現要否は要判断」が、本メモの結論 (B 非対応 / A 値修正) に更新される。

---

## 6. 実装 issue 分解案 (タイトル + やること骨子)

issue 作成はしない。粒度は 04 §3 の I シリーズに倣う。依存: S1 は独立、S2 は S1 後が望ましい。

| # | タイトル (案) | やること骨子 | 受け入れ基準 (§5 対応) | 工数 |
|---|---|---|---|---|
| **S1** | 更新抑制のスコープ確定と NC 上限値の是正 | (c)+(a §2a)。10 にスコープ外宣言 (B/512/チャンク境界) を追記、02 §4.2 補足を結論に更新。`world.ts` の 65,536→1,000,000 修正 + コメント訂正 | §5 の 1/2/3/6/7。既存 261 テスト不変 | 小 (0.5〜1 日) |
| **S2** | NC/PP/CU カウンタ意味論の vanilla 一致 (任意・後回し可) | (a §2b)。カウントを「提出数・multi=1・PP/CU 合流」に寄せ、`First skipped position` 相当を 1 回記録。デコンパイル仕様をオラクルにした単体テスト追加 | §5 の 4/5 | 中 (1〜1.5 日) |

- **S1 のみでも本タスクの目的 (意思決定材料化＋仕様一貫性回復) は達成**。B を追わないことの明文化が主眼。
- S2 は「病的回路の観測ずれ」が実問題化してから着手で十分 (現時点で回路勢の実害なし)。
- **B (選択肢 b) は issue 化しない**。やる場合でも「実機一致を諦めた教育用モック」として別トラック扱いにし、
  sim 本体の実機一致保証とは分離する旨を issue 本文に明記すること。

---

## 7. まとめ (意思決定の要点)

1. 「更新抑制」は **A: 総数上限打ち切り (決定的・再現可)** と **B: 例外系抑制 (非決定的・チャンク前提・再現不可)** の 2 系統。
   回路勢の実用抑制器はほぼ B。
2. **A の正値は 1,000,000** [確定: 26.2]。sim は 65,536 (§2.3 の tile tick 上限と取り違え) で**値がずれている**が、
   手組み回路では到達しないため**実害はなく、仕様一貫性のための低工数修正**。カウント意味論も vanilla と差がある (§2b)。
3. **B は典拠版で再現不可・非推奨**: SO は 22w11a で消滅 [確定]、CCE は 23w33a で修正 [推定]、OOM は JVM ヒープ/境界チャンク
   依存で決定的に定義できない [推定]。忠実性を担保できず sim の売り (実機一致) を毀損するリスクが上回る。
4. **推奨: (c) スコープ外宣言を土台に (a §2a) 値修正**。B は明示的に対象外。S1 (小工数) で完結、S2 (意味論一致) は任意後回し。
