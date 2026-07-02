# 07. Mojira 原票カタログ — fixture 候補バグ 7 件

04 §2.2 / §3 の fixture 候補に挙がった MC 番号バグ 7 件 (MC-2340 / MC-3703 / MC-11193 /
MC-54711 / MC-81098 / MC-189954 / MC-231071) の Mojira 原票調査。典拠は note 記事 (01 #5) 経由の
又聞きだったため、現象・再現手順・影響バージョン・修正状況・fixture 化可否を一次資料 (Mojira) で洗い直す。
対象バージョンは **1.21.1 (+26.x 併読)** (04 §4.1 / CONTRIBUTING.md)。「1.21.1 で再現するか」を各件で判定する。

確度ラベル: **[確定]** = 複数源一致 or 一次資料 (原票) / **[要検証]** = 単一源 or 検証未了。

## 原票アクセスに関する注意 [確定]

bugs.mojang.com (Mojira) は 2024 年に新プラットフォームへ移行済みの **JS レンダリング SPA** で、
WebFetch では本文が取れず「Mojira Public Bug Tracker」の外枠しか返らない。旧 `bugs-legacy.mojang.com`
は本調査時 ECONNREFUSED。本カタログの原票本文は **リーダプロキシ `https://r.jina.ai/<原票URL>`** で
JS レンダリング後の本文を取得した。ただしリーダは詳細サイドバー (Affected versions / Labels) を取りこぼす
ことがあり、その項目は検索スニペットで補完 or [要検証] とした。原票 URL は新形式
`https://bugs.mojang.com/browse/MC/issues/MC-XXXXX` (旧形式 `.../browse/MC-XXXXX` もリダイレクトで有効)。

skipUntil の値は 04 §3 の実装 issue ID (I1〜I10)。fixture ランナーは `packages/sim/test/fixtures.test.ts`
が `skipUntil` 付き fixture を `it.skip` する運用 (該当 issue 実装時に外す)。

---

## カタログ表

| MC 番号 | 表題 (原題要旨) | 現象 (1 行) | 影響版 (原票) | 修正状況 | 1.21.1 再現 | fixture 化 | skipUntil 想定 |
|---|---|---|---|---|---|---|---|
| MC-2340 | Redstone torches schedule updates when they don't need to | 更新と(非)給電が同 tick に来ると RS トーチの 2gt パルスが 1gt に縮む | 1.4.2〜(〜17w50a) | **Fixed** (1.13 開発中, Resolved 2018-06-30) | **✕** | 可 (修正後の正挙動の回帰ガード) | I3 |
| MC-3703 | Redstone changing orientation doesn't update previously powered blocks correctly | ダストが向きを変え対象を指さなくなると、その対象ブロックが更新されないことがある (shape 変化 BUD) | 1.4.4〜(計 ~89 版) | **Open** (Confirmed) | **○** | 可 (PP/shape update 前提) | I6 |
| MC-11193 | 沿線の被給電ブロックの給電/消電順が未定義で非決定的 (locational) | ダスト沿いの給電順が HashSet=座標依存で、同一回路が場所で挙動を変える | 13w10b/1.5〜(計 ~123 版) | **Open** (Priority Low)。**label `experimental_redstone_fixed`** = 1.21.2 experimental で修正 | **○** (既定) / ✕ (experimental) | 可 (座標固定必須・価値は locational スコープ次第) | I6 |
| MC-54711 | Quick pulses get lost in some repeater/comparator setups | 連続短パルス (1rt の 101) がリピーター列末段で 1 本の 3rt パルス (111) に化ける | 14w17a/1.8〜(計 ~102 版) | **Open** | **○** | 可 | I3 |
| MC-81098 | Redstone dust causes immense amounts of lag | ダスト 15 段消電が段ごとに 23+ BU を出し 15 連で ~2500 BU → ラグ | 1.8.7〜1.21 (Reopened, Important) | **Open / Reopened** | **○** | △ (状態 diff 不可・**性能/BU 数**バグ。BU 計数トレースなら可) | I6 / I10 |
| MC-189954 | Observers react to updates if they already have a scheduled tick... | 未 tick だが同 world time に予約済みの observer が更新で追加 tick を予約 (hasScheduledTick 使用) | 原票詳細未取得 (番号から ~2020/1.16 系以降と推定) [要検証] | **Open** (「修正すると 4tick observer clock が壊れる」と留保 → 仕様寄り) | **○** | 可 (observer 実装前提) | I8 |
| MC-231071 | Some redstone components send duplicated block updates | rail/RS トーチ/コンパレーター/レバー/ボタンが onRemove 起因で重複 BU を送る | 1.17.1 RC1 / 1.19.1 RC2 / 1.19.2 | **Resolved 2024-08-21 / Resolution=Awaiting Response** (最終確認 1.19.2、最新版再現待ちの行政的クローズ) | **○** (現象は 02 §4.2 の 2 段送信として 26.2 デコンパイル確認済) | △ (状態 diff 不可・BU 重複=順序/計数。トレースなら可) | I6 / I10 |

**まとめ**: 純粋な状態系列 fixture (レイヤ A) に向くのは **MC-3703 / MC-54711 / MC-189954**、および
「修正後の正挙動ガード」としての **MC-2340**。**MC-11193** は locational なので座標固定 fixture が必要
(スコープ判断は 04 §4-3)。**MC-81098 / MC-231071** は状態 diff に現れない **BU 数/更新順** のバグで、
レイヤ C (microTiming / トレース, I10) が要る。1.21.1 で再現しないのは **MC-2340 のみ** (修正済)。

---

## 各バグ詳細

### MC-2340 — RS トーチが不要な更新をスケジュールし 2gt パルスが 1gt に縮む

- **現象** [確定]: RS トーチが「隣接ブロック更新 (NC)」と「(非)給電」を同一 tick に受けると、本来 2gt のはずの
  出力パルスが 1gt に短縮される。結果、2gt リピーターを消せず、他の RS トーチを (非)給電できない。原票は
  「Updating with other torches / with redstone / with a repeater」の 3 系統で再現するとする。
- **再現手順 (回路構成)** [要検証]: リピーターで 2gt パルスを RS トーチへ入力しつつ、同 tick にそのトーチへ
  NC を発生させる構成 (隣接トーチのトグル等)。厳密な最小回路は原票添付画像 (`old-fixed.png` ほか) に依存し、
  SPA 画像は本調査で取得できず → 回路詳細は [要検証]。修正後 (1.13+) の期待挙動は「2gt を維持」。
- **影響版 / 修正状況** [確定]: Affected に 1.4.2/1.4.3/1.4.7, 13w01b, 13w02b ほか (〜17w50a)。**Resolution=Fixed**、
  Resolved=2018-06-30 (1.13 開発サイクル)。コミュニティ検証では **18w01a で修正** とされる [要検証: Fix version
  フィールドは空欄、動画タイトル引用]。→ **1.21.1 では再現しない (修正済)**。
- **fixture 化 / skipUntil**: 可。ただし「バグ再現」ではなく **修正後の正挙動 (2gt 保持) の回帰ガード**。
  現 sim は G1 (schedule 時 action 固定) で短パルスがラッチするため失敗する → **skipUntil=I3** (tile tick 意味論の
  vanilla 準拠化で解消)。
- **出典**: 原票 https://bugs.mojang.com/browse/MC/issues/MC-2340 (リーダ https://r.jina.ai/https://bugs.mojang.com/browse/MC/issues/MC-2340)。
  補助: https://www.youtube.com/watch?v=CW0wWkJihVI (「MC-2340 fixed in 18w01a」)、minecraft.wiki/w/Redstone_Torch。

### MC-3703 — ダストの向き変化で以前給電していたブロックが更新されない

- **現象** [確定]: ダストが更新されて対象ブロックを「指さなく」なったとき、その対象ブロックが更新されない
  ことがある。すなわちダストの接続形状 (向き) 変化に伴う PP/shape update が対象に届かない BUD 系バグ。
- **再現手順 (回路構成)** [確定: 原票記述]: (a) ダストに接続するブロックを設置する、(b) それまで遮られていた
  ダストが接続する、(c) グロウストーンやハーフブロック等の透過ブロック越しに下方向へダストが接続する、
  といった状況で「ダストが指すのをやめた側のブロック」が更新を受け取らない。→ 形状変化検出 (BUD) 回路が最小構成。
- **影響版 / 修正状況** [確定]: Affected に 1.4.4/1.4.6/1.4.7, 13w01b, 13w09a ほか (計 ~89 版)。**Resolution=None
  (Open/Unresolved)**、Confirmed。Labels=blockupdate, redstone (**experimental_redstone_fixed ラベルは無し** →
  1.21.2 experimental でも未修正)。→ **1.21.1 で再現する**。
- **fixture 化 / skipUntil**: 可。ただし PP / shape update (updateShape) と NC の分離が前提 (現 sim は更新 1 種のみ,
  G10)。**skipUntil=I6** (更新 3 種の分離と方向順)。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-3703 (リーダ経由取得)。関連: MC-211392 が本件の重複として
  リンク。

### MC-11193 — 沿線ブロックの給電/消電順が座標依存 (locational)

- **現象** [確定]: ダスト沿いの被給電ブロック (ピストン等) が給電/消電される順序が「論理的な信号の流れ」ではなく
  **ワールド座標に依存** する。実装が `HashSet<BlockPos>` のイテレーション順 (=ハッシュ=座標依存) を使うため、
  同一回路を別の場所に建てると挙動が変わる (非決定的に見える)。02 §4.2 の locational コード根拠と一致。
- **再現手順 (回路構成)** [確定]: ダスト分岐の両端に等距離でピストン等の被給電ブロックを置き、ダストを消電した
  ときにどちらが先に更新されるかを観測。**座標をずらすと順序が反転** する。fixture 化には **原点座標の固定** が必須。
- **影響版 / 修正状況** [確定]: Affected に 13w10b/1.5/13w11a/1.5.1/13w16a ほか (計 ~123 版)。**Open**、Priority=Low、
  Confirmed。重複チケット 74+。**Labels に `experimental_redstone_fixed`** = 1.21.2 の experimental redstone
  (Orientation/決定的ワイヤ順, 01 #15) で修正済み。→ **既定 1.21.1 では再現する / experimental datapack 有効時は消える**。
- **fixture 化 / skipUntil**: 可だが (1) 座標固定が必須、(2) 現 sim は固定順 [N,S,E,W]+up/down で HashSet-locational
  を再現しないため、再現には座標ハッシュ順の実装が要る。**skipUntil=I6**。**価値は locational をスコープに入れるか
  次第** (04 §4-3 決定: I6 まで実施、suppression は v2)。
- **spec-drift 注意**: 本件は **experimental redstone が既定化される将来版で挙動が変わる (locational→決定的)** 代表例。
  02 §6 wire の通り 26.2 現在は experimental flag 付き・既定は 1.21.1 と同一。フラグ既定化が対象バージョン方針の
  再判断トリガー (01 #15, P5)。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-11193 (リーダ経由)。関連: 01 #16 Alternate Current
  (非 locational 実装), theosib RedstoneWireTurbo (02 棄却済み欄), openredstone forum thread-14591。

### MC-54711 — 連続短パルスがリピーター/コンパレーター列で失われる

- **現象** [確定]: リピーター列 (背中合わせ 2 個以上) に短いパルスを高速連続で入れると、末段で失われる。
  具体的には 1rt (=2gt) の 101 パターン (on/off/on を各 1rt) を送ると、末端リピーターが 1 本の 3rt パルス (111)
  に引き伸ばす。原因はリピーター/コンパレーターの tile tick 優先度が後続素子の有無で変わること (原票の根本原因
  分析が `BlockRedstoneDiode` / `BlockRedstoneComparator` の priority 差に言及)。
- **再現手順 (回路構成)** [確定]: 背中合わせリピーター ≥2 段の入力側にコンパレータークロック or レバー操作で
  1rt 間隔の 101 パルス列を与え、末段出力が 111 (3rt) になることを確認。ピストン伸長器でも顕在化。
- **影響版 / 修正状況** [確定]: Affected に 14w17a/14w18b/14w28b/1.8-pre2/1.8-pre3 ほか (計 ~102 版)。**Open/Unresolved**、
  Priority=Normal。重複 27 件。→ **1.21.1 で再現する**。
- **fixture 化 / skipUntil**: 可。リピーターの **文脈依存優先度 (-3/-2/-1, 02 §2.2)** と collect-then-execute が前提。
  現 sim は priority 固定 (G6) + schedule 時 action 固定 (G1) で再現不能。**skipUntil=I3**。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-54711 (リーダ経由)。関連: MC-69483 (同種)、
  minecraftforum thread 2361348、PaperMC/Paper#3419。

### MC-81098 — ダストの更新が大量のラグを起こす

- **現象** [確定]: ダストの信号強度 15 段が 1 段ずつ失われ、各段が 23+ の BU を発生。1gt 内で ~345 BU、15 連ダストで
  合計 ~2500 BU に達し、サーバ (シングルの内部サーバ含む) がラグる。Alpha 1.0.1 以来の構造的問題と報告。
- **再現手順 (回路構成)** [確定]: 長いダスト線 (例 15 マス) を給電/消電するだけ。BU 数を計測して初めて可視化される。
- **影響版 / 修正状況** [確定]: Affected 1.8.7〜1.21、**Reopened (Open)**、Mojang Priority=**Important**。→ **1.21.1 で再現する**
  (vanilla は theosib RedstoneWireTurbo を未採用。turbo は carpet fastRedstoneDust 側, 02 棄却済み欄)。
- **fixture 化 / skipUntil**: **△**。最終状態は正しいままなので **レイヤ A の状態系列 diff には現れない**。
  BU 数/更新回数のトレース (レイヤ C microTiming, 01 #7 / #11) を取る fixture でのみ検証可能。**skipUntil=I6/I10**
  (更新機構の実装 + トレース出力後)。回路互換の観点では優先度低 (性能特性であり誤動作ではない)。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-81098 (リーダ経由)。関連: MC-231071 (重複 BU の具体化)、
  openredstone forum thread-14591 (theosib fix)。

### MC-189954 — 予約済み tile tick を持つ observer が更新で追加 tick を予約する

- **現象** [確定: リーダ取得原票本文]: unpowered な observer は更新を受けると 2 tick 先に tile tick を予約する。
  ところが「同 world time に予約済みだがまだ実行されていない」状態で更新を受けると、observer は
  `willTickThisTick()` ではなく `hasScheduledTick()` を見るため、無視せず **追加の tick を予約** してしまう
  (リピーター/RS トーチ等は willTickThisTick で二重予約を避ける)。原票は「これを直すと 4tick observer clock が
  壊れる」ので修正すべきでない or 影響を避けて直すべきと主張 → **仕様寄りに留まる公算**。
- **再現手順 (回路構成)** [確定: 原票]: リピーター + observer 群 + ピストンの回路。observer に予約済み tick がある
  状態で、同 tick 内・実行前に更新を与えて二重予約させる (4tick observer clock がまさにこの挙動に依存)。
- **影響版 / 修正状況** [要検証]: **Open**。Affected versions はリーダで取得できず (詳細サイドバー欠落)。チケット番号
  189954 から作成は概ね 2020 年 (1.16 系) と推定。→ **1.21.1 で再現する** (observer の hasScheduledTick ベースの
  予約は現行仕様、02 §4.1 の observer 記述と整合)。
- **fixture 化 / skipUntil**: 可。observer 実装が前提。二重予約の有無は状態系列 (observer 出力パルス回数) に現れる
  ため、レイヤ A で検証可能。**skipUntil=I8** (オブザーバー実装)。「修正されない可能性が高い=仕様として実装対象」。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-189954 (リーダ経由)。関連: note 記事 (01 #5, 「タイルティック・
  プレスケジュール」)。**Affected versions が原票未確認**。

### MC-231071 — 一部の RS 素子が重複した block update を送る

- **現象** [確定: リーダ取得原票本文]: rail / RS トーチ / コンパレーター / レバー / ボタンが、更新順を担う
  `onRemove` メソッドの後に **setBlock 後の余分な (順序に無関係な) BU を追加送信** する。結果、同じ隣接に
  重複した BU が飛ぶ。02 §4.2 の「トーチは onRemove/onPlace で 2 段送信」と同一現象 (26.2 デコンパイルで確認済)。
- **再現手順 (回路構成)** [確定: 原票]: 点滅する rail (or トーチ) を多数並べ (原票は 320 個の点滅 rail)、BU 数/mspt を
  計測。modded fix で 17→10.5 mspt に改善したと報告。単体では「トーチ 1 個の LIT 変化で隣接に BU が 2 回飛ぶ」を
  トレースで確認するのが最小。
- **影響版 / 修正状況** [確定]: Affected=1.17.1 RC1 / 1.19.1 RC2 / 1.19.2。**Status=Resolved (2024-08-21) /
  Resolution=Awaiting Response** (=最新版での再現報告待ちで行政的にクローズされた状態。Fixed ではない)。
  Labels=Performance, Redstone。→ **現象自体は 1.21.1 でも残存** (02 §4.2 の 2 段送信は 26.2 で健在)。チケットが
  閉じているのは「最終確認が 1.19.2 のまま再現報告が途切れた」ため。
- **fixture 化 / skipUntil**: **△**。MC-81098 同様、最終状態は不変なので状態 diff には現れない。**更新順/BU 数の
  トレース** (レイヤ C) が要る。**skipUntil=I6/I10**。02 §4.2 の 2 段送信を再現する更新機構を作れば、トレース
  fixture の期待値として使える。
- **spec-drift 注意**: チケットが「Awaiting Response」で閉じている =**将来 Mojang が最適化して重複送信を廃止する
  可能性** がある (性能ラベル + Important 系の関連)。その場合 02 §4.2 の 2 段送信仕様がドリフトするので、更新順
  fixture は対象バージョンを 1.21.1 に固定し、26.x での再確認をウォッチ対象 (P5) とする。
- **出典**: https://bugs.mojang.com/browse/MC/issues/MC-231071 (リーダ経由)。関連: MC-81098 (親問題)、02 §4.2。

---

## spec-drift 運用への注意 (まとめ) [確定]

将来バージョンで挙動が変わりうる 3 件を、fixture の `mcVersion` 固定 + P5 ウォッチで扱う。

1. **MC-11193 (locational)** — `experimental_redstone_fixed` ラベル付き。1.21.2 の experimental redstone
   (FeatureFlags.REDSTONE_EXPERIMENTS) を有効化した世界では **locational 挙動が消え決定的順序に変わる**。
   26.2 現在は experimental flag 付き・既定は 1.21.1 と同一 (01 #15, 02 §6 wire)。**experimental が既定化された版が
   出たら対象バージョン方針の再判断トリガー**。locational fixture は必ず `mcVersion:"1.21.1"` + 座標固定で撮る。
2. **MC-2340 (torch)** — 既に **Fixed (1.13+)**。1.21.1 の正挙動 (2gt 保持) を fixture 化するので、旧版の 1gt 挙動を
   期待値にしないこと。「バグ再現」ではなく回帰ガードと明示する。
3. **MC-231071 (重複 BU)** — 「Awaiting Response」で閉鎖。**性能最適化で将来 Mojang が重複送信を廃止しうる**。
   02 §4.2 の 2 段送信仕様に依存する更新順トレース fixture はドリフトに注意し、26.x で再確認 (P5)。

MC-3703 / MC-54711 / MC-81098 / MC-189954 は 26.2 現在まで未修正・仕様変更の兆候なし (MC-3703/54711 は
experimental ラベルも無し) で、対象 1.21.1 で安定して再現する。

---

## 検証メモ

- 本カタログの全主張に原票 URL (or 代替ソース) を付記済み。原票本文は SPA のため `r.jina.ai` リーダで取得し、
  詳細サイドバー欠落分 (MC-189954 の Affected versions 等) は [要検証] と明示。
- 01_sources.md に Mojira を情報源 #17 (P1/P5) として追加済み。
- 本 issue はドキュメントのみの変更 (packages/ 配下のコード・fixture JSON は未変更)。skipUntil の割当は
  04 §3 の I1〜I10 に対応させただけの提案であり、実 fixture 生成は I9 ハーネス構築後 (別 issue)。
