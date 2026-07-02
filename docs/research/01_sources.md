# 01. 情報源カタログ

redstone-sim (Java Edition 準拠レッドストーンシミュレータ) の仕様調査・実装・検証で参照する情報源の一覧。
確度ラベル: **[確定]** = 複数源一致 or 一次資料 / **[要検証]** = 単一源 or 検証未了。

参照フェーズの区分:
- **P1 仕様確定** (挙動仕様の一次典拠)
- **P2 実装参考** (コード構造・アルゴリズムの参考)
- **P3 検証** (ground truth 取得・テスト)
- **P4 法務** (公開・ライセンス判断)
- **P5 監視** (将来の情報源として更新をウォッチ)

---

## 1. Mojang 公式配布物 (server.jar + 公式 mappings) — 最上位の一次資料

| 項目 | 内容 |
|---|---|
| URL | https://piston-data.mojang.com/ (バージョン JSON 経由で server.jar / client.txt / server.txt を取得) |
| カバー範囲 | ゲーム挙動の全て。ServerLevel.tick のフェーズ順、LevelTicks/LevelChunkTicks (tile tick)、ChainRestrictedNeighborUpdater (隣接更新)、各ブロッククラス |
| 由来 | Mojang 公式配信。一次資料そのもの |
| 信頼度 | 最高 [確定]。本調査の verdicts でも 1.21.1 / 1.21.11 / 26.2 の実 jar デコンパイルにより複数クレームを直接検証済み |
| ライセンス | Minecraft EULA + Microsoft サービス規約 (詳細は 03_legal-decompile.md)。mappings ヘッダは「開発目的での複製・使用可、完全無改変の再配布不可」。**デコンパイル産物・jar・mappings のリポジトリ同梱は不可** |
| 使い方 | P1 の最終典拠。2025-10 以降のバージョン (26.x) は難読化廃止済みで、`net/minecraft/world/level/redstone/CollectingNeighborUpdater` 等が可読名のまま公式配布される (https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition) [確定]。ローカルで Vineflower 等によりデコンパイルして参照し、成果は自然言語仕様+テストケースに変換してからコミットする。手順は `tools/decompile/fetch-and-decompile.sh` で自動化済み (CONTRIBUTING.md 参照) |

## 2. Minecraft Wiki (ja/en, minecraft.wiki)

| 項目 | 内容 |
|---|---|
| URL | https://ja.minecraft.wiki/w/ティック, https://ja.minecraft.wiki/w/ブロック更新, https://minecraft.wiki/w/Tick, https://minecraft.wiki/w/Quasi-connectivity ほか |
| カバー範囲 | tick フェーズ順序、tile tick priority (-3〜0)、ブロックイベント、ブロック更新 3 分類 (PP/NC/コンパレーター) と方向順、信号強度、強/弱動力 |
| 由来 | コミュニティ Wiki。技術記事は実コードメソッド名 (Blockstate.onRemove() 等) を引用しておりデコンパイル由来 |
| 信頼度 | 高。「ティック」のフェーズ順・priority 値は techmcdocs およびデコンパイル実確認と一致 [確定]。ただし対象バージョン非明記のページが多く、更新順の細部 (素子別例外) は単一源 [要検証] |
| ライセンス | **CC BY-NC-SA 3.0** (https://ja.minecraft.wiki/w/Minecraft_Wiki:著作権)。帰属表示必須・非営利・継承。文章/表の転載時は要遵守。数値・事実そのものの利用は著作権対象外。Weird Gloop ホストで Mojang 非公式 |
| 使い方 | P1 の第一次調査 + デコンパイル結果の突合先。NC/PP/CU の方向順など wiki のみが明文化している項目はデコンパイルで裏取りしてから採用 |

## 3. Technical Minecraft Wiki (techmcdocs)

| 項目 | 内容 |
|---|---|
| URL | https://techmcdocs.github.io/pages/GameTick/ ほか |
| カバー範囲 | ServerWorld.tick 順序、processSyncedBlockEvents のキュー挙動 (ObjectLinkedOpenHashSet)、コンパレーター信号式 |
| 由来 | デコンパイル由来の英語圏テクニカル勢文書 |
| 信頼度 | 高 (デコンパイル実確認と一致 [確定])。ただし ©2017–2023 で対象バージョン未記載、1.21 系差分に注意 |
| ライセンス | 明記なし → **転載不可前提**で扱う (事実の参照のみ) |
| 使い方 | P1 の裏取り用独立ソース。wiki と食い違ったらデコンパイルで裁定 |

## 4. 赤石基礎論 ArcFrout (enokilovin)

| 項目 | 内容 |
|---|---|
| URL | https://enokilovin.github.io/ArcFrout/ / https://github.com/enokilovin/ArcFrout |
| カバー範囲 | 構想上は赤石仕様全域 7 章。**現時点で公開済みはトップ+notes+invitation の 3 ページのみで記事本体は全て 404** [確定 2026-07-02]。削除済み旧草稿 (chap1/chap2) から強/弱動力・BUD・QC・BU/SU/CU 分類・斜めダスト切断規則等を復元取得済み |
| 由来 | ゲーム内実験 (BU 連鎖の再現性検証) 主体 + 将来デコンパイル解析を計画。対象バージョン非明記 |
| 信頼度 | 概念体系としては中〜高、数値・順序の一次典拠としては**現状使えない** (未公開・草稿・査読なし)。草稿の内容は wiki 既知知識と整合。なお草稿の「BEC は tick 最終盤」はデコンパイルと不整合が確認された (02 の棄却済み欄参照) |
| ライセンス | **不明 (LICENSE なし)** → 著作権保留として転載不可。用語・概念の参照のみ |
| 使い方 | P5 監視 (II-PrOrd / II-UpOrd / II-Locat / VII-Bug 公開時に日本語圏最有力になる見込み) + 概念語彙 (PLC/STC/BEC、BU/SU/CU、powered/activated 分離) とエッジケースチェックリストの供給源 |

## 5. enokilovin note 記事群 (全 3 本)

| 項目 | 内容 |
|---|---|
| URL | https://note.com/enokilovin/n/n6a8033e8d0e7 (全体構想案)、https://note.com/enokilovin/n/nc2952f9d228c (II-07 赤石記述法)、HOME |
| カバー範囲 | 7 章構成の目次 (対象 Java 1.12〜1.20)、BU/SU/CU/SF 分類、RSC 記法、オブザーバー→コンパレーターのパルス飲み込み例、MC 番号付き既知バグ 7 件 (MC-2340/3703/11193/54711/81098/189954/231071) |
| 由来 | 実験 + DecompilerMC 使用を明言。II-07 自体は経験則ベースで著者自身が「実験的」と留保 |
| 信頼度 | 現象の指摘・用語としては中〜高。パルス飲み込み例はデコンパイル (ObserverBlock/ComparatorBlock/ScheduledTick.DRAIN_ORDER) で**裏付け済み** [確定] |
| ライセンス | 不明 (note 規約、著者帰属) → 転載不可、事実参照のみ |
| 使い方 | P1 テストケース供給 (パルス飲み込み、MC 番号バグ) + P2 トレースログ書式 (RSC 記法) の参考 |

## 6. fabric-carpet (gnembon) + バニラ /tick

| 項目 | 内容 |
|---|---|
| URL | https://github.com/gnembon/fabric-carpet / https://modrinth.com/mod/carpet / https://minecraft.wiki/w/Commands/tick |
| カバー範囲 | /tick freeze・step・warp、/player (fake player)、fillUpdates、scarpet API (block_state/block_data/scan/set/without_updates/write_file/__on_tick)。ルール群がバニラ仕様の逆引きチェックリストになる (QC 対象 3 ブロック、ダスト locational 挙動、update suppression 等) |
| 由来 | Mojang 社員 gnembon による Mixin 実装 = 実質デコンパイル由来の一次情報 |
| 信頼度 | 非常に高 [確定]。バニラ /tick freeze/step (1.20.3+) の仕様は公式 23w43a チェンジログ + デコンパイル (TickRateManager) で検証済み |
| ライセンス | **MIT** (Copyright (c) 2020 gnembon) → ハーネス・スクリプトへの組込・再配布可 |
| 使い方 | **P3 の中核**。freeze→step→scarpet ダンプの ground truth パイプライン。ただし挙動変更ルール (fastRedstoneDust 等) は全て既定 false のまま使うこと (有効化すると正解データ汚染) |

## 7. Carpet-TIS-Addition (microTiming ロガー)

| 項目 | 内容 |
|---|---|
| URL | https://carpet.tis.world/docs/loggers |
| カバー範囲 | tick 内の detected/emitted block update・block_state_changed・executed_tile_tick・executed_block_event 等を順序付きで出力 |
| 由来 | 拡張作者 Fallen_Breath の Mixin 実装、公式 docs |
| 信頼度 | 高 [要検証: 本調査では文書確認のみ、実機未検証] |
| ライセンス | 要確認 (本調査未取得) |
| 使い方 | P3。**update「順序」の ground truth 取得の本命** (carpet 本体・SubTick では取れない neighbor update 順が取れる)。次段の調査対象 |

## 8. SubTick (chiraagChakravarthy 版 / lntricate1 版)

| 項目 | 内容 |
|---|---|
| URL | https://github.com/chiraagChakravarthy/SubTick (MC 1.17〜1.18.2, MIT) / https://github.com/lntricate1/subtick (MC 1.17.1〜1.20.1, LGPL-3.0) |
| カバー範囲 | tick phase 単位の freeze/step、tile tick・block event の 1 件ずつステップ実行、キュー可視化。11 phase 分割 (worldBorder〜entityManagement)。**neighbor update の再帰順序は両版とも対象外** |
| 由来 | Mixin ソース直読 (一次資料)。キュー消化規則 (collect-then-execute / block event 枯渇ループ) はデコンパイル 2 系統で裏付け済み [確定] |
| 信頼度 | tick phase モデル・キュー仕様は高。chiraag 版の次元順ハードコード (OW→End→Nether) のみ低〜中 [要検証] |
| ライセンス | chiraag 版 MIT / lntricate 版 LGPL-3.0 |
| 使い方 | P3 (サブティック粒度の実機ステップ実行は lntricate 版を推奨、ただし **1.20.1 まで**) + P2 (TickProgress の state machine はシミュレータのステップ実行 UI の実装パターンとして流用可) |

## 9. MCHPRS (Rust 製レッドストーン特化サーバ)

| 項目 | 内容 |
|---|---|
| URL | https://github.com/MCHPR/MCHPRS (MC 1.20.4 対応, MIT, ★2243) |
| カバー範囲 | weak/strong power モデル、コンパレーター、リピーター遅延、redpiler (グラフコンパイラ)、tick 精度テスト (tests/components.rs 9 件 + timings.rs 3 件) |
| 由来 | バニラ内部構造の知識に基づく再実装 (デコンパイル参照の明示なし) |
| 信頼度 | コード自体は一次資料で高。ただし**ワイヤ更新は theosib RedstoneWireTurbo 移植であり、バニラの更新順序を意図的に変更している (locational 挙動を除去) — 「バニラ完全再現」ではない** [確定: verdicts で refuted、02 の棄却済み欄参照]。ピストン・オブザーバ・QC は未実装 [確定] |
| ライセンス | **MIT** → テスト・コードの流用可 (帰属表示) |
| 使い方 | P2 (weak/strong モデル、TickPriority 4 段) + P3 (テスト 12 件の移植、test_all_backends! 差分テスト方式の採用)。**ワイヤ更新順の典拠には使わない** |

## 10. Pumpkin (Rust 製バニラ準拠サーバ)

| 項目 | 内容 |
|---|---|
| URL | https://github.com/Pumpkin-MC/Pumpkin (GPL-3.0, ★7885, 活発) |
| カバー範囲 | 最新 Java Edition パリティ方針 (issue #1402)。wire/comparator/repeater/observer/target/copper_bulb 等実装済み、ピストンは broken |
| 信頼度 | 高 (一次ソース確認) [確定] |
| ライセンス | **GPL-3.0** → **コード翻訳・コピー不可 (コピーレフト感染)**。読解と数値仕様 (事実) の抽出のみ |
| 使い方 | P2 読解専用 (特にオブザーバー・最新コンポーネント)。参照方法の線引きは 03 の運用ルール参照 |

## 11. rubix_mod / HLPtool (RubixTheSlime)

| 項目 | 内容 |
|---|---|
| URL | https://github.com/RubixTheSlime/rubix_mod (MIT, MC 1.21.5) / https://github.com/RubixTheSlime/HLPtool (GPL-3.0) |
| カバー範囲 | rubix_mod: 1.21.5 の更新機構クラス構造 (NeighborUpdater 2 実装、WireOrientation、OrderedTick、BlockEvent) が mixin 対象一覧として判明。redfile プロファイラ、サプレッションブロック。HLPtool: コンパレーター厳密式 + max 合成 (Hex Layer Problem ソルバ) |
| 由来 | 作者ソース直読 (一次資料)。コンパレーター式は wiki + techmcdocs で裏付け済み [確定] |
| 信頼度 | 高。ただし更新順序の「規則」自体は非文書化 (クラス名/シグネチャからの間接情報) |
| ライセンス | rubix_mod MIT (参照自由) / HLPtool **GPL-3.0 (コード流用不可、式・アルゴリズムの再実装は可)** |
| 使い方 | P1 (1.21.5 再現必須コンポーネント一覧) + P3 (HLPtool 出力レイヤ列を sim 上に自動構築する hex 回路プロパティテスト) + P2 (サプレッションブロック的デバッグ機能のアイデア) |

## 12. WorldEditCUI

| 項目 | 内容 |
|---|---|
| URL | https://github.com/EngineHub/WorldEditCUI (EPL-2.0) |
| カバー範囲 | レッドストーン仕様の情報は**ゼロ**。3D 選択範囲可視化 (depth test 反転の 2 パス描画等) の UI 参考のみ [確定] |
| 使い方 | P2 (エディタ UI のみ)。仕様調査からは除外 |

## 13. MC-ticker / Mordritch JS Redstone Simulator (参考・流用不可)

- MC-ticker (https://github.com/Breina/MC-ticker): 本物の minecraft.jar をリフレクションでロードして simulate する「実 jar オラクル」方式。ライセンス表記なし → コード流用不可だが、**発想は P3 の ground truth 生成に応用可** [確定]。
- Mordritch (https://github.com/JonathanLydall/JavaScript-Redstone-Simulator): バニラのデコンパイルクラス構造をそのまま JS 化した疑いが強く無ライセンス。**参照回避推奨** (歴史的価値のみ) [確定]。

## 14. 法務系一次資料 (03 で詳述)

Minecraft EULA (https://www.minecraft.net/en-us/eula, /ja-jp/eula)、Microsoft サービス規約 (https://www.microsoft.com/en-us/servicesagreement)、Mojang mappings ヘッダ実物、公式記事「Removing obfuscation in Java Edition」、github/dmca 通知原文、e-Gov 著作権法条文。いずれも一次資料直接取得で信頼度最高 [確定]。使い方: P4。

## 15. 1.21.2 Redstone Experiments 公式チェンジログ (24w33a/24w34a)

| 項目 | 内容 |
|---|---|
| URL | https://www.minecraft.net/en-us/article/minecraft-snapshot-24w33a、https://www.minecraft.net/en-us/article/minecraft-snapshot-24w34a、https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-2、https://minecraft.wiki/w/Redstone_Experiments |
| カバー範囲 | 1.21.2 で導入されたワイヤ更新順刷新 (WireOrientation、公式クラス名は `Orientation`) の公式説明。「接続ワイヤ全体の新強度を先に確定してから block update」「電力を受けうるブロックのみ更新」「更新順は受信方向基準で back→front→left→right→down→up」「24w34a で left-first 化されランダム性をほぼ除去 (残る random は上下給電など文脈不足時のみ)」 |
| 由来 | Mojang 公式チェンジログ (一次資料) |
| 信頼度 | 最高 [確定]。**26.2 デコンパイルで実装を裏取り済み**: 刷新は `FeatureFlags.REDSTONE_EXPERIMENTS` (experimental datapack) を有効にした世界のみ適用され、**既定は `DefaultRedstoneWireEvaluator` = 1.21.1 と同一アルゴリズム** (02 §6 wire)。差分規模 = 新規クラス `Orientation` (48 状態) / `RedstoneWireEvaluator` 2 実装 / `ExperimentalRedstoneUtils` + NeighborUpdater 系シグネチャへの `@Nullable Orientation` 追加 + setBlock flag 128 (ワイヤ PP 抑止) |
| ライセンス | 公式記事の転載不可、事実参照のみ |
| 使い方 | P1 (1.21.2+ 差分の一次典拠) + P5 (experimental が既定化されたら対象バージョン方針の再判断トリガー) |

## 16. Alternate Current (Space Walker / SpaceWalkerRS)

| 項目 | 内容 |
|---|---|
| URL | https://github.com/SpaceWalkerRS/alternate-current |
| カバー範囲 | ワイヤ更新の高速化 mod (最新リリース 1.9, 2024-08)。ワイヤネットワークを一括構築し電力源から決定的に伝播させる方式で、locational 挙動を除去。README/docs にバニラワイヤ更新の非効率性 (locational・冗長更新) の分析あり |
| 由来 | Space Walker のソース直読 (一次資料)。1.21.2 の Experimental 実装 (turnOff/turnOn の 2 deque + 強度先確定 + 受信方向基準の更新順) は本 mod と同系のアプローチであり、公式チェンジログの内容と整合 [確定: 系譜の公式言及は未発見のため設計類似の指摘に留める] |
| 信頼度 | 高。バニラ更新順の「規則」文書としては RedstoneWireTurbo 原典 (01 §9 参照) と並ぶ参考資料だが、mod 自体はバニラ挙動を意図的に変更するため**バニラ更新順の典拠には使わない** (MCHPRS と同じ扱い) |
| ライセンス | **MIT** → コード・文書の参照/流用可 (帰属表示) |
| 使い方 | P2 (1.21.2+ experimental 相当を将来実装する際のアルゴリズム参考) + P1 補助 (バニラワイヤ更新の問題点の整理) |

---

## 情報源運用の要点

1. **仕様の最終典拠は常に公式 jar のローカルデコンパイル** (26.x なら非難読化 jar 直読)。Wiki/techmcdocs は入口と突合用。
2. **転載可否**: MIT (carpet, MCHPRS, rubix_mod, chiraag-SubTick) のみコード/テキスト流用可。CC BY-NC-SA (wiki) は条件付き。GPL (Pumpkin, HLPtool, lntricate-subtick) は読解のみ。無ライセンス (ArcFrout, note, techmcdocs, MC-ticker, Mordritch) は事実参照のみ。
3. **バージョン軸**: 検証 mod は 1.20.1 (lntricate-subtick) / 1.20.4 (MCHPRS) まで、ワイヤ更新順刷新 (Orientation) は 1.21.2+ だが **experimental flag 付きで既定挙動は 26.2 現在も 1.21.1 と同一** (#15)、非難読化 jar は 26.x〜。対象バージョンは**典拠 1.21.1 + 26.x 併読**で確定 (CONTRIBUTING.md / 04 §4.1)。
