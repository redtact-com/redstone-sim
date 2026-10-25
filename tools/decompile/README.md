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
| 各素子 | `net.minecraft.world.level.block.{RedStoneWireBlock,DiodeBlock,RepeaterBlock,ComparatorBlock,RedstoneTorchBlock,ObserverBlock,ButtonBlock,LeverBlock,piston/*}` (26.3 からワイヤーは `RedstoneWireBlock`) |
| ワイヤーの強度計算・実験版 | `net.minecraft.world.level.redstone.{RedstoneWireEvaluator,DefaultRedstoneWireEvaluator,ExperimentalRedstoneWireEvaluator}`, `net.minecraft.world.flag.FeatureFlags` |

監視している全クラスは `watched-classes.txt` にある (26.3 時点で 68 クラス)。

## ★ 絶対にコミットしないもの

`jars/` `work/` `out/` は .gitignore 済みだが、以下は**いかなる形でも**リポジトリ・PR・issue に載せない
(docs/research/03_legal-decompile.md §6 参照):

- server.jar / 抽出 jar / class ファイル
- mappings (server.txt) / version JSON
- デコンパイル済み Java ソース (断片の貼り付けも不可)

読解結果は「自然言語の挙動仕様 + クラス名/メソッド名の言及 + 数値・順序という事実」のみに変換して
docs/research/ へ書く。

## 仕様ドリフト検知 (spec-drift.sh)

02_behavior-spec と packages/sim のコメントが典拠に引くクラス (`watched-classes.txt`) の正規化ハッシュを
`fingerprints.json` に保存し、新バージョンとの差分を検知する。

```bash
./spec-drift.sh --check latest    # 最新 release と比較 (CI: 週次 spec-drift.yml)
./spec-drift.sh --check 26.3      # ベースライン自己照合 (デコンパイル決定性の確認)
./spec-drift.sh --update 26.4     # 確認完了後にベースラインを更新してコミット
```

コミットするのはハッシュ (事実の指紋) のみ。デコンパイル産物は従来どおり
git 管理外・artifact 化禁止 (03 §6)。

ベースラインは「差分を読み終えた最新の release」を指す (26.3 は #365 で読んだ)。
02_behavior-spec の典拠バージョン (1.21.1 と 26.2) とは別物で、クラスの改名などは
02 の冒頭の版の注記に残す。

監視クラスを足すときの手順 (差分を取りこぼさないため、順番を守る):

1. `watched-classes.txt` に足し、**今のベースライン版**で `--update` する
2. 最新 release で `--check` し、足したクラスの DRIFT 行を issue に記録して読む
3. 読み終えたら最新 release で `--update` してベースラインを進める

手元の別の場所にあるデコンパイル結果は `out/<version>` に symlink で置いてよい
(smoke のクラス数は symlink の先まで数える)。

CI を手で回すとき (workflow_dispatch) の target はベースラインと同じ版にする。
違う版を指定して drift になると、その版の名前で issue が自動起票される。

指紋に出ない変化 (新版を読むときに別に見る):

- ブロックタグなど jar のデータ。26.3 で、水が押し流すブロックの判定などがクラスからタグに移った
- Blocks の登録 (押し反応・音色)
- ダストの接続先の上書き (26.3 からの BlockBehaviour.shouldRedstoneWireConnectTo)。
  上書きしているクラスを全体から探し、ワイヤー・リピーター・オブザーバーの 3 つから増えていないか見る
