# 03. ゲーム本体解析の規約調査 (法務整理)

redstone-sim (TypeScript による Java Edition 挙動再実装、OSS 公開予定) がゲーム本体解析をどこまで行ってよいかの整理。
一次資料 (EULA/MSA/mappings 実物/公式記事/DMCA 通知原文/e-Gov 条文) を直接確認した調査に基づく。
**注意: 本文書は法的助言ではない。**

---

## 1. 規約の構造 [確定]

### 1.1 EULA 本体に逆コンパイル禁止条項は存在しない
- 現行 Minecraft EULA (英/日全文取得・全文検索済) に reverse engineer / decompile / 逆コンパイル / リバースエンジニアリング の語は **0 件**。
- EULA の禁止の柱は**頒布**:
  > "you must not distribute anything we've made … give copies of our game software or content to anyone else; make commercial use …"
- ツール開発は明示的に許容:
  > "You may develop tools, plug-ins and services as long as they do not seem official or approved by us"
- Mod の線引き:
  > "By 'Mods,' we mean something original that you or someone else created that doesn't contain a substantial part of our copyrightable code or content." / "Basically, Mods are okay to distribute; hacked versions or Modded Versions of the game client or server software are not okay to distribute."
- 出典: https://www.minecraft.net/en-us/eula, https://www.minecraft.net/ja-jp/eula (2026-07-02 全文取得)

### 1.2 逆コンパイル禁止は Microsoft サービス規約 (MSA) 8.b.ii 由来
- EULA は MSA を組み込む ("This Minecraft EULA and the Microsoft Services Agreement, together, apply to all Minecraft services.")。
- MSA 8.b.ii 原文:
  > "This license does not give you any right to, and you may not: … ii. disassemble, decompile, decrypt, hack, emulate, exploit, or reverse engineer any software or other aspect of the Services …, **except and only to the extent that the applicable copyright law expressly permits doing so**;"
- 末尾の**法定許容の除外**が重要: 適用法が明示的に許容する範囲では契約禁止が後退しうる構造。
- 出典: https://www.microsoft.com/en-us/servicesagreement (Section 8.b.ii)

### 1.3 日本法の位置づけ [確定 (条文) / 一部解釈問題]
- **著作権法 10 条 3 項** (e-Gov 原文): プログラム著作物の保護は「プログラム言語、規約及び**解法**」に及ばない。「解法 = プログラムにおける電子計算機に対する指令の組合せの方法」。→ **レッドストーン挙動のロジックの別実装は条文レベルで保護外**。
- **著作権法 30 条の 4** (平成 30 年改正): 思想感情の享受を目的としない利用 (情報解析等) は「その必要と認められる限度において、いずれの方法によるかを問わず」適法。→ 解析目的のデコンパイル過程の複製は適法化されるという整理 (内田・鮫島法律事務所解説 https://www.it-houmu.com/archives/1747)。
- ただし書の「著作権者の利益を不当に害する場合」の例は「全く同じ機能のプログラムを廉価販売」であり、ゲーム本体の代替品でない検証用シミュレータは該当しにくい。
- 出典: https://laws.e-gov.go.jp/law/345AC0000000048
- **[要検証/解釈問題として残る点]**: 30 条の 4 が MSA の「適用される著作権法が明示的に許容」に当たるかは確立していない。経産省準則・公取委見解 (競争阻害的 RE 禁止条項は無効となりうる) は**二次資料のみで一次 PDF 未取得**。
- 米国法参考 [確定]: 17 U.S.C. §102(b) (アイデア・手順・方法は保護外)、Sega v. Accolade (9th Cir. 1992) — 機能要素へのアクセス目的の逆アセンブルはフェアユース。

---

## 2. Mojang mappings ライセンスの正確な引用 [確定]

client.txt / server.txt 冒頭ヘッダ (1.14.4〜1.21.11 で同一文言を実ファイル確認):

> \# (c) 2020 Microsoft Corporation. These mappings are provided "as-is" and you bear the risk of using them. **You may copy and use the mappings for development purposes, but you may not redistribute the mappings complete and unmodified.** Microsoft makes no warranties, express or implied, with respect to the mappings provided here. Use and modification of this document or the source code (in any form) of Minecraft: Java Edition is governed by the Minecraft End User License Agreement available at https://account.mojang.com/documents/minecraft_eula.

要点:
- **開発目的でのコピー・使用は明示許可** / **完全・無改変での再配布は禁止**。
- 「本書または Minecraft: Java Edition のソースコード (いかなる形式でも)」の使用・改変は EULA (= 頒布禁止) の傘下 → デコンパイル産物も同様。
- 出典: https://piston-data.mojang.com/v1/objects/c604a623b416a88a844979a6c55862c8a97510a9/server.txt (1.14.4) + 1.21.11 client.txt (実取得)

## 3. 2025-10 の難読化廃止 (重大な状況変化) [確定]

- Mojang 公式記事 (2025-10-29): "we're removing obfuscation altogether! … we will no longer obfuscate Minecraft: Java Edition." 理由は "Modding is at the heart of Java Edition – and obfuscation makes modding harder."
- 同記事: "No changes to EULA." — 解析は容易化されたが**頒布禁止は不変**。
- 実物検証: 26.2 server.jar は可読クラス名 (net/minecraft/world/level/redstone/CollectingNeighborUpdater 等) で公式配布され、jar 内 META-INF/LICENSE は EULA と MSA への参照のみ (242 bytes)。version JSON から mappings キーは消滅。
- 出典: https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition、26.2 jar 実取得 (piston-data.mojang.com)
- 影響: **26.x 以降は mappings もデコンパイラの remap 工程も不要**。ローカルで jar を展開/デコンパイルして読むだけでよい。Fabric も Yarn 新規版終了・公式名移行を発表 (https://fabricmc.net/2025/10/31/obfuscation.html)。

## 4. enforcement (DMCA) の実態 [確定 + 一部要検証]

github/dmca リポジトリ全通知 (~21,500 件) の grep + 代表通知原文の確認結果:

| 事例 | 内容 | 帰結 |
|---|---|---|
| Eaglercraft (2023-02) | デコンパイル産物 (MC 1.3 の 100% コード再利用) の丸ごと公開 | **DMCA で 92〜2,381 リポジトリ削除**。同作者が「各自デコンパイルする手順とツールのみ」配布に改めた EaglercraftX は存続 |
| RenderDragon ソース公開 (2022-07) | デコンパイル済ソースのリポジトリ公開 | DMCA 削除。Mojang の主張は「デコンパイルした事実」でなく「**コードの再配布**」 |
| betasharp (2026-06) | デコンパイル由来コードの **C# 移植** | DMCA 削除 ("While the programming language has changed... unauthorized derivative work") — **言語を変えても逐語的移植は derivative** |
| MCHPRS (Rust/MIT/6年) / Cuberite (C++/13年) / Glowstone | Mojang コードを含まない挙動再実装 | **通知 0 件**、現在も公開継続 |
| prismarine-web-client (2023-04) | **フルスクラッチ JS 再実装のプレイ可能クライアント** | Eaglercraft 一斉通知に巻き込まれ一時削除 ("Exact source code … do not need to be in the repo to constitute copyright infringement")。counter-notice 後に**復旧・現存** |

- 「Mojang コード非含有の別言語再実装は安全」という一般化には prismarine の一時削除という**反例が 1 件**あり [要検証扱い: verdicts で uncertain]。ただし対象は「プレイ可能なクライアント型クローン (アセット/UX 込み)」であり、**非クライアントの挙動シミュレータ (MCHPRS 同型) への takedown は 0 件**。redstone-sim は後者に属する。
- enforcement の線は一貫して「**Mojang コード実体 (またはその逐語的移植)・アセットの有無**」で引かれている。

## 5. コミュニティ慣行 (15 年来の共通原則) [確定]

- **「デコンパイルは各自のマシンで行い、産物は配布しない」**: MCP README ("Do not use this to release complete packages of minecraft jar, class or java files")、Forge (差分パッチのみ配布、LGPL-2.1)、DecompilerMC (ツールのみ配布、非難読化 jar 登場でアーカイブ済)、Vineflower (Apache-2.0 汎用デコンパイラ)、Parchment (CC0 補完データ)。
- Yarn (CC0) は Mojang mappings からの「名前の借用」すら禁じるクリーンルーム方針だが、これは mappings という名前 DB の汚染対策であり、**挙動の理解・再実装を禁じる趣旨ではない**。
- Mod 開発者がデコンパイル結果を直接読んで再実装するのが標準慣行で、Mojang 自身が「modding を容易にするため」難読化を廃止してこれを追認した。

---

## 6. 結論: してよいこと / グレー / してはいけないこと

### してよいこと [確定]
1. **非難読化 jar (26.x) または mappings 適用済みデコンパイル結果を自分のマシンで読み、挙動 (更新順序・遅延・強弱電源・QC 等) を理解する** — mappings ヘッダの development purposes 許諾 + 日本法 30 条の 4 + 公式の難読化廃止の三重の裏付け。
2. **理解した挙動・定数・アルゴリズムを TypeScript で自分のコードとして再実装し OSS 公開する** — 10 条 3 項 / 17 USC 102(b) でアルゴリズムは保護外。MCHPRS (6 年)・Cuberite (13 年) の無事故先例。
3. 挙動の出典として `net.minecraft.world.level.redstone.CollectingNeighborUpdater` 等の**クラス名・メソッド名を docs/コメントで事実として言及**する。
4. carpet (MIT)・MCHPRS (MIT) のコード/テストの流用 (帰属表示付き)。
5. 「非公式・Mojang 非承認」の明記。

### グレー (運用ルールで回避する)
1. デコンパイル済 Java ソースの**断片**を PR/issue/コメントに貼ること — Mojang コードの複製にあたる。**リポジトリ・PR には残さない**。
2. クラス構成・変数名・制御フローまで丸写しした**機械的 Java→TS 翻訳** — betasharp の DMCA が示す通り derivative とされるリスク。機能上必然の範囲に留める。
3. mappings ファイル・version JSON のリポジトリ同梱。
4. MSA の RE 禁止と 30 条の 4 の関係 (解釈問題として残存) — ただし解析は非公開のローカル行為であり実務リスクは低い。
5. Pumpkin (GPL-3.0) の読解 — 数値仕様 (事実) の抽出は可だが、コード構造の翻訳は GPL 感染 + derivative の二重リスク。**読んだ場合は自然言語仕様に落としてから実装**する。

### してはいけないこと [確定]
1. **デコンパイル済ソース・jar・class ファイルのリポジトリ公開/再配布** (Eaglercraft/RenderDragon/betasharp で DMCA 実績)。
2. ゲームの**テクスチャ・音・アセットの同梱**。
3. 公式/Mojang 承認と誤認させる表示・ロゴ使用。
4. 無ライセンス実装 (Mordritch JS Simulator = デコンパイル構造の JS 化疑い、MC-ticker) からのコード流用。

---

## 7. 推奨ワークフロー

```
[ローカル、非コミット領域]
  1. 対象バージョンの server.jar を piston-data.mojang.com から取得
     - 26.x: そのまま Vineflower / IDE で読む (非難読化)
     - 1.21.x 以前: server_mappings を取得 → Reconstruct 等で remap → Vineflower でデコンパイル
       (DecompilerMC は同工程の自動化ツールだったがアーカイブ済)
  2. レッドストーン関連クラスを読解
     (world/level/redstone/*, world/ticks/*, block/{RedStoneWireBlock,DiodeBlock,RepeaterBlock,
      ComparatorBlock,RedstoneTorchBlock,ObserverBlock,piston/*}, server/level/ServerLevel)

[リポジトリにコミットするもの = Mojang 由来物ゼロ]
  3. 読解結果を「自然言語の挙動仕様 (02_behavior-spec.md 系) + 期待値付きテストケース」に変換
     - Java コード片は書かない。クラス名/メソッド名の言及と数値・順序という事実のみ
  4. その仕様を根拠に TypeScript 実装 (構造は TS として自然に設計、Java の写経をしない)
  5. 実機 ground truth (carpet ハーネス、04 参照) で仕様の裏取り → fixture 化

[配布物]
  6. LICENSE (自プロジェクトのもの) + NOTICE に「Mojang/Microsoft 非公式。Minecraft は
     Mojang AB の商標。本プロジェクトは Mojang のコード・アセットを含まない」を明記
  7. wiki 文章を転載する場合のみ CC BY-NC-SA 3.0 の帰属・条件を満たす
```

根拠の対応: 手順 1-2 = mappings 許諾 + 30 条の 4 + 難読化廃止 / 手順 3-4 = 10 条 3 項・102(b) (挙動=事実の実装) + betasharp 教訓 (写経回避) / 手順 6 = EULA のブランド条項。
