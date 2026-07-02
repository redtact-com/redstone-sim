# CONTRIBUTING

redstone-sim は Java Edition 準拠のレッドストーンシミュレータ (TypeScript)。
挙動仕様の調べ方・書き方と、その際の法務境界を定める。詳細な根拠は docs/research/ を参照。

## 対象バージョン方針

- **仕様の典拠は 1.21.1** (Mojang 公式 mappings を適用したローカルデコンパイル)。
- **26.x (最新版) を併読**する。2025-10 の難読化廃止以降は非難読化 jar が公式配布されており可読性が最も高い。
  1.21.1 との差分はその都度 docs/research/02_behavior-spec.md に注記する。
- 1.21.2+ のワイヤ更新順刷新 (Redstone Experiments / `Orientation`) は **experimental flag 付きで、
  既定挙動は 26.2 現在も 1.21.1 と同一** (02 §6 wire で確定済み)。よって 1.21.1 準拠の実装は
  最新版の既定挙動とも互換。experimental 側への対応は将来のバージョンフラグで吸収する (04 §4.1)。
- 実機検証ハーネス (04 §2) はレイヤ A/C を 1.21.x 系で、レイヤ B (SubTick) のみ 1.20.1 で補助する。

## 仕様調査ワークフロー (デコンパイル手順)

一次典拠は常に公式 server.jar のローカルデコンパイル。Wiki・技術文書は入口と突合に使う
(情報源の一覧と使い分けは docs/research/01_sources.md)。

```bash
# 1) デコンパイル (産物は tools/decompile/out/<version>/ に展開、全て git 管理外)
JAVA_HOME=~/bluemap/jdk25 tools/decompile/fetch-and-decompile.sh 1.21.1
JAVA_HOME=~/bluemap/jdk25 tools/decompile/fetch-and-decompile.sh 26.2

# 2) レッドストーン関連クラスを読解 (対象クラス一覧は tools/decompile/README.md)

# 3) 読解結果を docs/research/02_behavior-spec.md へ「自然言語仕様」として反映
#    - Java コード片は書かない。クラス名/メソッド名の言及と数値・順序という事実のみ
#    - 確度ラベルと典拠 (クラス名 + バージョン) を必ず付ける (下記の記法)

# 4) 仕様を根拠に TypeScript 実装 + テストケース化 (Java の構造を写経しない)
```

## docs/research/ の記法

- 確度ラベル: **[確定]** = 複数源一致 or デコンパイル一次確認 / **[要検証]** = 単一源・未検証。
- [確定] には典拠を付記する。デコンパイル由来なら `[確定: DiodeBlock.checkTickOnNeighbor (1.21.1)]` のように
  **クラス名 (+メソッド名) とバージョン**を書く。外部文書由来なら URL。
- 既存記述を覆した場合は棄却理由を残す (02 §8 棄却済みクレーム欄)。

## 法務境界 (docs/research/03_legal-decompile.md 準拠)

**原則: リポジトリにコミットするものに Mojang 由来物をゼロにする。**

してよいこと:
- server.jar を自分のマシンでデコンパイルして読み、挙動を理解する (mappings ヘッダの
  development purposes 許諾 + 著作権法 30 条の 4 + 公式の難読化廃止)。
- 理解した挙動・数値・アルゴリズムを TypeScript で自分のコードとして再実装し公開する。
- クラス名・メソッド名を docs やコメントで**事実として言及**する。

してはいけないこと:
- **jar / class / mappings (server.txt) / version JSON / デコンパイル済み Java ソースのコミット・再配布**。
  `tools/decompile/{jars,work,out}/` は .gitignore 済みだが、`git add` 前に `git status` で必ず確認する。
- デコンパイル済み Java コードの断片を **PR・issue・コメントに貼る**こと (複製にあたる)。
- クラス構成・変数名・制御フローまで丸写しした機械的 Java→TS 翻訳 (derivative work のリスク)。
- ゲームのテクスチャ・音・アセットの同梱。公式/Mojang 承認と誤認させる表示。

読解結果は必ず「自然言語の挙動仕様 (docs/research/02) + 期待値付きテストケース」に変換してからコミットする。

## タスク運用

- ブランチは issue 単位 (`<issue番号>-<slug>`)。main / develop への直接 push は禁止。
- コミットメッセージは日本語で、意味単位に分割する。
