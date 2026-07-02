# tools/decompile — 仕様調査用ローカルデコンパイル環境

Minecraft Java Edition server.jar をローカルでデコンパイルし、レッドストーン挙動の一次典拠
(docs/research/02_behavior-spec.md) を確定するためのツール。
法務境界は docs/research/03_legal-decompile.md、運用手順は CONTRIBUTING.md を参照。

## 使い方

```bash
# 難読化版 (〜1.21.x): mappings 適用 → 再マップ → デコンパイル
JAVA_HOME=~/bluemap/jdk25 ./fetch-and-decompile.sh 1.21.1

# 非難読化版 (26.x〜, 2025-10 の難読化廃止以降): そのままデコンパイル
JAVA_HOME=~/bluemap/jdk25 ./fetch-and-decompile.sh 26.2
```

結果は `out/<version>/net/minecraft/**/*.java` に展開される (参考: 1.21.1 で約 4,000 ファイル)。

## 処理フロー

```
piston-meta version_manifest_v2.json
  → version JSON → server.jar (+ server.txt = 公式 mappings、難読化版のみ)  [sha1 検証]
  → bundler 形式 (1.18+) なら META-INF/versions/ から本体 jar 抽出
  → (難読化版のみ) Reconstruct で Mojang 公式 mappings を適用して再マップ
  → Vineflower で net/minecraft/ + com/mojang/ をデコンパイル → out/<version>/
```

使用 OSS: [Reconstruct](https://github.com/LXGaming/Reconstruct) (Apache-2.0) /
[Vineflower](https://github.com/Vineflower/vineflower) (Apache-2.0)。
いずれも初回実行時に `work/` へ自動ダウンロードされる。

## 必要環境

- bash / curl / python3 / unzip / sha1sum
- Java 17+ (このリポジトリの開発環境では `JAVA_HOME=~/bluemap/jdk25` の Temurin 25)

## 主な読解対象クラス

| 対象 | クラス |
|---|---|
| tick フェーズ順 | `net.minecraft.server.level.ServerLevel`, `net.minecraft.server.MinecraftServer` |
| tile tick | `net.minecraft.world.ticks.{LevelTicks,LevelChunkTicks,ScheduledTick,TickPriority}` |
| 隣接更新 | `net.minecraft.world.level.redstone.{NeighborUpdater,CollectingNeighborUpdater}` (26.x は Orientation 系も) |
| 信号読み取り | `net.minecraft.world.level.SignalGetter`, `net.minecraft.world.level.Level` |
| 各素子 | `net.minecraft.world.level.block.{RedStoneWireBlock,DiodeBlock,RepeaterBlock,ComparatorBlock,RedstoneTorchBlock,ObserverBlock,ButtonBlock,LeverBlock,piston/*}` |

## ★ 絶対にコミットしないもの

`jars/` `work/` `out/` は .gitignore 済みだが、以下は**いかなる形でも**リポジトリ・PR・issue に載せない
(docs/research/03_legal-decompile.md §6 参照):

- server.jar / 抽出 jar / class ファイル
- mappings (server.txt) / version JSON
- デコンパイル済み Java ソース (断片の貼り付けも不可)

読解結果は「自然言語の挙動仕様 + クラス名/メソッド名の言及 + 数値・順序という事実」のみに変換して
docs/research/ へ書く。
