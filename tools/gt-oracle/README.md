# gt-oracle: 26.3 の実機オラクル (#439)

Java 版 26.3 の GameTestServer をプロセス内で立て、fixture の定義を置いて tick ごとの正解を撮る道具。
docs/research/18 (以下 R18) の案 (c) の土台 (§6.2 の O1) である。

- ゲームのコードを書き換えない。Mod・Mixin・Java agent・ローダーは使わない。
  自前の起動コードが、公開の入口 (TestFunctionLoader.registerLoader・GameTestMainUtil.runGameTestServer) を呼ぶだけである (R18 §4.1)。
- 今の 1.21.1 のハーネス (tools/mc-harness) とは別物で、置き換えない。1.21.1 の fixture はそのまま残る (R18 §6.1)。
- CI では動かさない。手元で、EULA に同意した人が回す。

## 使い方

```bash
# Minecraft の EULA (https://aka.ms/MinecraftEULA) に同意したうえで
GT_ORACLE_ACCEPT_EULA=true tools/gt-oracle/run.sh            # 縦切りの 2 本を撮る
GT_ORACLE_ACCEPT_EULA=true tools/gt-oracle/run.sh --twice    # 2 回撮って、結果が一致するかも見る
GT_ORACLE_ACCEPT_EULA=true tools/gt-oracle/run.sh lamp-off-delay   # 名前を指定して撮る
```

- 要る物: Docker・Node (npm ci 済み)・unzip・ネットワーク (jar の取得だけ)。Java はシステムに要らない。
- `GT_ORACLE_ACCEPT_EULA=true` が無いと、run.sh も起動コードも何もせずに止まる (終了コード 2)。
- 定義の名前は `tools/gt-oracle/definitions/` → `tools/mc-harness/fixtures/` の順に探す。O1 で写していない入力を持つ定義は、起動する前に止まる (下の「撮れるもの」)。

| 環境変数 | 既定 | 中身 |
|---|---|---|
| `GT_ORACLE_ACCEPT_EULA` | (なし) | `true` で EULA に同意したことを示す。必須 |
| `GT_ORACLE_MC_VERSION` | `26.3` | 撮る版。jar から読んだ版がこれと違えば起動コードが止まる |
| `GT_ORACLE_IMAGE` | `eclipse-temurin:25-jdk` | Java 25 の公開イメージ |
| `GT_ORACLE_SERVER_JAR` | (なし) | 手元のサーバ jar。sha1 が合えば落とさずに写す |

WSL の docker は credsStore のせいで公開イメージの pull に失敗することがある。run.sh はイメージが無いとき、空の `DOCKER_CONFIG` で取る。

## 流れ

| 段 | ファイル | 中身 |
|---|---|---|
| 1. jar | `fetch-jar.ts` | version manifest から 26.3 のサーバ jar を取り、sha1 を確かめる。bundler の本体 jar と 39 個のライブラリを、一覧の sha256 と照らして展開する |
| 2. データパック | `gen-datapack.ts` | pack.mcmeta (版は jar の pack_version)・test_environment (ゲームルール)・test_instance (Java のテスト関数を 1 本呼ぶ) と、撮る定義の計画 (plan.json) を作る |
| 3. ビルド | `run.sh` | Docker の中で `javac --release 25` する。クラスパスは本体 jar とライブラリ |
| 4. 撮る | `java/gtoracle/` | `OracleMain`: 版の検出 → ローダーの登録 (Bootstrap より前) → GameTestServer の起動。`Driver`: 毎 tick 1 回呼ばれる状態機械。`Inputs`: 入力 |
| 5. 写す | `to-fixture.ts` | 結果の JSON を今の fixture の形式に写す。settle 照合と expect の作り方は generate.ts の関数をそのまま使う |
| 6. 比べる | `compare.ts` | 1.21.1 の生成済み (packages/sim/test/fixtures) の expect と比べ、差を「tick・座標・期待・実際」で出す。`--same` で 2 回の結果を比べる |

1 本の fixture の中の流れ (`Driver`。1 行が 1 回の呼び出し):

1. 掃除: 範囲と余白 (横 8・縦 6) を無更新で空気にし、その範囲の予約 tick とブロックイベントを消し、エンティティを消す。範囲のチャンクを強制読み込みにする
2. チャンクが tick される状態になるまで待つ
3. 置く: /setblock の strict と同じフラグで置く (形状更新・設置フック・近隣更新なし)。全ブロックに、自分自身を送り元とする近隣更新を 1 回ずつ配る (今のハーネスの `fx_settle`)。コンテナの中身を入れたら、もう一度配る
4. 8 tick 待つ
5. tick -1 を撮る (settle 照合に使う) → tick 0 の入力 → tick 0 を撮る
6. tick t の入力 → tick t を撮る (t = 1 から ticks まで)
7. 結果を書き出して、もう一度掃除する。1 本の中で例外が出たら、記録して次の 1 本へ進む

## 1 tick の中で撮る位置

GameTest の tick は、全ディメンションの tick と接続の tick の後に回る (R18 §3.1・§4.2)。
入力はテスト関数の毎 tick の呼び出しの中で入れ、同じ呼び出しの中で範囲を読む。
よって fixture の規約「state[t] は tick t の全相の後、tick t の入力の直後」(tools/mc-harness/README.md「tick 規約」) と同じ位置で撮れ、expect をそのまま比べられる。

## 撮れるもの (O1 の範囲)

| 種類 | 扱い |
|---|---|
| ブロック状態 | 範囲を毎 tick 読む。空気は持たない |
| `use` | 偽の ServerPlayer (GameTestHelper.makeMockServerPlayer。世界には入れない) から、ServerPlayerGameMode.useItemOn を呼ぶ。当たりはブロックの中心・上の面、手は空 (R18 §4.4)。何も起きなければ失敗にする |
| `setblock`・`summon`・`kill`・`item` | 今のハーネスと同じコマンドの文字列を、Commands.performPrefixedCommand で実行する。失敗したら失敗にする |
| コンテナの中身 (`items`) | /item replace で入れる (今と同じ) |
| まだ写していない (起動前に止める) | `step`・`container`・`tp`・`lectern`、書見台の本、レバーとボタンの `setblock` (今のハーネスは支えブロックの隣にも更新を足している #290。写し方は O2)、`trustAuthored` と見えない状態の注入 (O4) |

## 出力 (どれも `tools/gt-oracle/work/` の下。コミットしない)

```
work/jars/26.3/          server.jar・本体 jar・libs/ (39 個)・version.json・fetched.json
work/classes/26.3/       起動コードの class
work/runs/<日時>-a/
  plan.json              撮った定義と時間の上限
  packs/gt_oracle/       データパック
  server.log             サーバのログ全部
  results/<名前>.json    1 本の結果 (tick ごとのブロック・入力の効き方・gameTime・所要時間・失敗)
  results/_run.json      1 回の結果 (版・起動と撮るのにかかった時間・効いている機能フラグ・ゲームルール)
  fixtures/<名前>.json   今の fixture の形式 (mcVersion・generated.oracle・startGameTime つき)
  compare.md             1.21.1 の expect との差
```

26.3 の fixture は手元に出すだけで、コミットしない。置き場は O3 で決める (R18 §7.4)。
fixture に足した欄は次のとおり。今の runner は知らない欄を無視する。

- `mcVersion`・`generated.mc`: jar から読んだ版
- `generated.carpet`: `none`
- `generated.oracle`: 採取系の名前・起動コードのコミット (java/ に未コミットの変更があれば `-dirty`)・DataVersion
- `startGameTime`: tick -1 を撮った時点の gameTime (R18 §7.2)

## 落とし穴と対処

R18 §4.5 の表のうち O1 に要る物と、動かして見つけた物。

| 落とし穴 | 対処 |
|---|---|
| ローダーの登録が遅いと、テスト関数が無い | `OracleMain` の先頭で登録する。ResourceKey もローダーが呼ばれてから作り、Bootstrap より前にゲームのクラスの初期化を起こさない |
| 同じ tick の処理の順が決まらない (runAtTickTime の登録表は順を持たない) | 毎 tick の処理を 1 つにまとめ、GameTestSequence.thenExecuteFor の毎 tick の呼び出しに載せる |
| fixture の場所が tick されない | 範囲のチャンクを強制読み込みにし、tick される状態になってから置く |
| テストの位置が乱数 (±14,999,992) | 回路はテストの構造物に置かず、fixture の絶対座標に置く (ダストの更新先の集合の順は絶対座標で決まる。docs/research/09) |
| 既定のゲームルール | テスト環境で advance_time・advance_weather・spawn_mobs・spawn_monsters を false、random_tick_speed と fire_spread_radius_around_player を 0 にする。効いた値を `_run.json` に書く |
| gameTime の位相 | tick -1 を撮った時点の gameTime を `startGameTime` に書く |
| EULA | `GT_ORACLE_ACCEPT_EULA=true` が無いと、run.sh も起動コードも止まる |
| 版ごとの API の揺れ | jar から読んだ版が `GT_ORACLE_MC_VERSION` と違えば止まる。版を上げるときは縦切りの 2 本で確かめる |
| redstone_experiments が入るとダストの更新順が変わる | GameTestServer は全部のデータパックを有効にして起動するので、効いている機能フラグを最初の tick で読む。redstone_experiments があれば止まる。実測では `trade_rebalance` と `vanilla` だけだった |
| 入力が空振りしても進むと、「何も起きない」系列を正解として書く | use が何も起こさなかったら、コマンドが失敗したら、その 1 本を失敗にする |
| **[実測] tick が全速で回るので、チャンクの待ちを tick の数で測れない** | GameTestServer は tick の間を待たない。チャンクの生成は別スレッドで壁時計で進むので、待ちの間に約 3,000 tick 進んだ。待ちの上限は時間 (60 秒) で決め、tick の予算は大きくとる |
| **[実測] bind mount の上のワールドは、終了時のチャンクの保存に 10 秒かかる** | ワールドはコンテナの tmpfs に作って捨てる。全体が 17 秒から 7 秒になった |
| **[実測] ネットワークなしのコンテナでは、自分のホスト名を引けずに起動ログへ例外が出る** | `--hostname localhost` で起動する |

## 実測 (2026-11-27・WSL2・`run.sh --twice`)

| 項目 | 値 |
|---|---|
| javac | 1.6 秒 |
| 起動 (main の先頭からテスト関数の最初の呼び出しまで) | 6.3〜6.6 秒 |
| 撮る (2 本) | 0.5 秒。うち最初のチャンクの待ちが約 0.5 秒、2 本目 (18 tick) は 19 ms |
| コンテナ全体 (起動から終了まで) | 7.6〜7.8 秒 |
| run.sh --twice の全体 | 21.8 秒 |
| 1.21.1 の expect との差 | lever-wire-lamp・lamp-off-delay とも無い |
| 2 回の一致 | 一致 (tick ごとのブロックと入力の効き方) |

## IP の決まり

- 起動コードは自前で、公開の入口を呼ぶだけにする。GameTestServer や TestCommand の手順を写さない (R18 §4.1)。
- コメントは自分の言葉で書き、典拠は R18 と docs/vanilla の節、クラスとメソッドは「Class.method」で書く。
  tools/ip-hygiene.test.ts は .java のコメント行も見る。
- Nucleation の tools/gametest は同じ発想だが、読まない・写さない (R18 §4.1・docs/research/16 §5)。
- jar・展開した物・class・ワールド・撮った結果は `work/` に置き、コミットしない。

## 残した物 (R18 §6.2)

- O2: 入力の残り (step・container・tp・lectern)、レバーとボタンの setblock の後始末、定義 134 本を最後まで走らせる
- O3: 26.3 の fixture の置き場と、1.21.1 との差の仕分け
- O4: 予約のキュー (優先度・予約順)・コンパレーターの出力・クールダウンの記録と注入
- O5: tick 内の順 (ブロックイベント・近隣更新)
- Fixture 型 (packages/sim) に `generated.oracle` と `startGameTime` を任意の欄として足すこと。今は to-fixture.ts の型だけに書いている
