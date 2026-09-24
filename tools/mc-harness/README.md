# mc-harness — 実機 Minecraft ground truth ハーネス

redstone-sim の挙動を「目視のそれっぽさ」ではなく **実機 Minecraft (Fabric 1.21.1 + fabric-carpet) との tick 単位機械 diff** で検証するためのパイプライン (issue #17 / docs/research/04 §2.2 レイヤ A)。

```
fixtures/<name>.json ──┐ (回路定義: blocks + inputs)
                       │
                       ▼
   generate.ts ── rcon ──▶ 実機サーバ (docker) ── scarpet dump.sc
                       │     without_updates 設置 → tick freeze
                       │     → fake player 入力 → tick step → 領域走査
                       ▼
packages/sim/test/fixtures/<name>.json (expect = tick 毎差分 を追記)
                       │
                       ▼
   run.ts / fixtures.test.ts ──▶ @redstone/sim 実行結果と機械 diff
```

fixture 生成には実機サーバが必要だが、**生成済み fixture はコミットされるため CI・通常開発では実機不要** (`npm test` の `fixtures.test.ts` が回帰検証する)。

## EULA について

`docker compose up` すると itzg/minecraft-server イメージがサーバ jar をダウンロードして起動する。compose ファイルで `EULA: "TRUE"` を設定しているため、**起動により [Minecraft EULA](https://aka.ms/MinecraftEULA) に同意したことになる**。サーバ jar・mod・ワールドデータは `data/` に置かれ、`.gitignore` によりコミットされない (Mojang 由来ファイル非同梱の原則)。

## 使い方

```bash
# 1. サーバ起動 (初回は image pull + jar/mod DL で数分)
cd tools/mc-harness && docker compose up -d
docker compose logs -f mc   # "Done (x.xxxs)!" まで待つ

# 2. fixture 生成 + sim diff (リポジトリルートで)
npm run ground-truth -- <fixture名>   # 1本
npm run ground-truth -- --all         # 全定義
npm run ground-truth -- --diff-only <fixture名>  # 実機なしで diff のみ

# 2'. ビューアーで見ながら操作する (#366)
npm run live -- <fixture名>           # 実機を保持して待機
npm run dev                            # 別端末 → http://localhost:5173/?live=1

# 3. 終了
cd tools/mc-harness && docker compose down
```

- WSL2 + Docker 29 / compose v2.22 の組み合わせでは API バージョン不整合が出る。`generate.ts` は `DOCKER_API_VERSION=1.44` を自動で付与する。手で `docker compose` を叩くときは `DOCKER_API_VERSION=1.44 docker compose ...` とする。
- carpet の挙動変更ルールは全て既定 (false) のまま使う (`fastRedstoneDust` 等を有効にすると ground truth が汚染される)。
- gamerule (daylight/weather/mob/randomTick 停止)・forceload・`tick freeze` は `generate.ts` が毎回冪等に適用する。

## 駆動方式の確定 (要実験項目の結果)

docs/research/04 §2.2-8 の「freeze 中の `__on_tick` 発火有無」を実機で確認した (2026-07-02, MC 1.21.1 + carpet 1.4.147+v240613):

| 状況 | `__on_tick` | 実測 |
|---|---|---|
| `/tick freeze` 中 | **発火しない** [確定] | カウンタが 2 秒間 172 のまま不変 |
| `/tick step N` 中 | **step された tick ごとに発火する** [確定] | `tick step 5` でカウンタ 172→177 |

さらに scarpet の `run()` は「コマンド実行中に呼ばれた場合は遅延実行される」制約がある ([Auxiliary.md](https://github.com/gnembon/fabric-carpet/blob/master/docs/scarpet/api/Auxiliary.md))。rcon から `/script in dump run ...` で起動した scarpet 内で `run('tick step 1')` を呼んでもその場では tick が進まないため、**scarpet 内ループ駆動は不可能**。

→ **駆動方式: ホスト側 (generate.ts) が rcon で 1 コマンドずつ発行する方式に確定。** `tick step 1` → fake player 入力 → `fx_dump(t)` を tick 数ぶん繰り返す。`__on_tick` は使わない (入力を freeze 境界で適用する本方式のほうが tick 対応が明確なため)。

その他の実機確認事項:
- freeze 中もプレイヤー (fake player 含む) は tick され、`player <name> use once` は即時実行される [確定: 実測。vanilla TickRateManager はプレイヤーを freeze 対象外とする]
- freeze 中のブロック更新 (dust 伝播・ランプ点灯) は即時反映される [確定: 実測。block update は tick 駆動ではない]
- scarpet の共有ファイル API は **type 側に** `shared_` を付ける (`read_file('fixture', 'shared_json')` → `world/scripts/shared/fixture.json`)
- carpet の `update(pos)` は電力再計算 (neighborChanged) を起こすが**ワイヤー接続形状は再計算しない**。形状は power 変化で setBlock が走ったときに訂正される (comparator fixture の形状ズレ検出の経緯)

## fixture フォーマット

`fixtures/<name>.json` (定義) と `packages/sim/test/fixtures/<name>.json` (定義 + 生成された expect):

```jsonc
{
  "name": "repeater-delay-1",
  "description": "...",
  "mcVersion": "1.21.1",
  "skipUntil": "I2",            // 省略可: 既知ギャップで sim 不一致の fixture に付ける (issue ID)
  "skipReason": "...",          // 省略可: 理由
  "ticks": 18,                  // tick 0..N を記録
  "region": { "from": [0,0,0], "to": [4,1,1] },   // 実機で走査する領域
  "player": { "spawn": [0.5,1,1.5], "facing": [180,40], "lookAt": [0.5,1.35,0.5] },  // 定義のみ。fake player の立ち位置
  "blocks": [ { "pos": [0,1,0], "block": "lever[face=floor,facing=north,powered=false]" } ],
  "inputs": [ { "tick": 2, "pos": [0,1,0], "action": "use" } ],
  "expect": [ { "tick": 2, "changes": [ { "pos": [0,1,0], "block": "lever[...,powered=true]" } ] } ],
  "generated": { "at": "...", "mc": "1.21.1", "carpet": "1.21-1.4.147+v240613" }
}
```

- ブロック表現は **MC blockstate 文字列を正とする** (名前空間なし・プロパティキー昇順)。scarpet 側 `_canon()` と TS 側 `canonicalize()` が同一形式を生成する。
- `blocks` は**実機で安定な状態**を書く (ワイヤーの power・接続形状・トーチの lit まで正確に)。生成時に「without_updates 設置 → 全ブロック update → 8 tick settle」後の実機状態と照合され、ズレていると失敗する (= 実機が正しい安定状態を教えてくれる)。
- `expect` は変化のあった tick の差分のみ。消滅は `"block": "air"`。
- sim との対応付けは `packages/sim/src/mcstate.ts` (`mcToSim` / `simToMc`)。**facing の罠**: MC の repeater/comparator の `facing` は入力側 (sim は出力方向)、`redstone_wall_torch` の `facing` は壁から離れる方向 (sim は壁方向) で、いずれも OPPOSITE 変換する [確定: 1.21.1 DiodeBlock デコンパイル + 実機 dump で検証]。

### 入力アクション

| action | 実機での動作 | sim 側の写像 |
| --- | --- | --- |
| `use` | fake player が `pos` を右クリック (レバー/ボタン/ターゲット) | `activateBlock` |
| `step` | fake player を板の中心へ tp して `entityInside` を発火 | `activateBlock` |
| `setblock` | `/setblock` (flag 2\|256 → 近隣更新は `updateNeighboursOnBlockSet` の 6 方向のみ)。**運ばれるのは新しいブロック** [確定: 26.2 `ServerLevel.updateNeighboursOnBlockSet`] | `setBlockCommand` |
| `summon` | `/summon minecart` で `pos` にマインカートを出す (#146) | **次の tick** で `activateBlock` |
| `kill` | `/kill @e[type=minecart,...,distance=..2]` で近傍のカートを消す | no-op (auto-off が予約済み) |

`summon` / `kill` は detector_rail の ground truth を採るために追加した。**sim にエンティティは
持ち込まない** (13 §2 エンティティ境界原則) ので、ハーネス側だけの拡張という線引きになっている。

- freeze 中は `entityInside` が走らないため、**検出は召喚の次の tick step で起きる**
  (fixture `detector-rail-cart-pulse` で実測: t2 summon → t3 powered)。sim 側はこの 1 tick の
  遅れを `fixture-driver.ts` が再現する
- カートが動くと座標がズレるので、fixture は**平坦・無給電のレール**に限定する
- カートを乗せ続けるケースは折衷モデルでは再現できない (`detector-rail-cart-stay` に
  `skipUntil` 付きで記録)

### tick 規約

`state[t]` = 「tick t のブロックティック (ScheduledTick) フェーズ完了後、`inputs[tick==t]` を適用した直後」の状態。

- 実機側: freeze 境界 (tick t を step し終えた停止中) で fake player が入力 → dump。vanilla でプレイヤー入力がブロックティック後のパケット処理フェーズで反映されるのと同じ順序関係になる。
- sim 側: `world.tick()` → `activateBlock()` → snapshot (`packages/sim/test/fixture-runner.ts`)。
- 例: tick 2 でレバー ON → dust は tick 2 の dump に即時反映、delay=1 リピーターは tick 4 で ON (実機 fixture で検証済み)。

## 初期 fixture 11 本の一致状況 (2026-07-02 生成)

| fixture | 実機 vs sim | 備考 |
|---|---|---|
| lever-wire-lamp | ✔ 一致 | 既知一致ケース (受け入れ基準)。ランプ OFF は 4gt 遅延が sim 未実装のため ON のみ検証 |
| repeater-delay-1〜4 | ✔ 一致 (4本) | ON/OFF 遷移とも delay×2gt。sim の伝播順序バグ (下記) 修正後に一致 |
| attenuation-15-16 | ✔ 一致 | 15マス目 power=1 / 16マス目 power=0 の境界 |
| short-pulse-repeater | ✔ 一致 | 実機はリピーターが 1gt パルスを 2gt に整形 (tick4 ON→tick6 OFF)。伝播順序修正の副次効果で sim も一致し、当初想定の skipUntil I3 は不要になった |
| comparator-compare | ✔ 一致 | back=13 ≥ side=11 → 13 出力。コンパレーター→dust は減衰なし (dust=13) を実機で確認 |
| comparator-subtract | ✔ 一致 | 13 − 11 = 2 出力 |
| dust-block-repeater | △ skipUntil **I2** | 実機: dust が指す固体の弱充電をリピーターが読む (tick4 ON)。sim は弱充電を機構入力にできない (G2-G5) |
| torch-not-floor | △ skipUntil **I2** | 実機: 床置きトーチが水平隣接 dust へ給電。sim は G3 未実装で初期安定状態 (tick 0) から不一致 |

このハーネスで発見し修正した sim バグ:
- `propagateWireBFS` が Phase 2 の途中 (連結成分の一部がゼロ化されたままの過渡状態) で近傍機構を更新していたため、リピーターが「入力消失」と誤認して偽の turn_off を予約し 2gt 周期で発振していた (repeater-delay-1/2/3 の diff で検出)。近傍更新を全ワイヤー電力確定後の Phase 3 に遅延して修正。

## ディレクトリ

```
tools/mc-harness/
  docker-compose.yml       サーバ定義 (itzg/minecraft-server, Fabric 1.21.1 + carpet)
  fixtures/*.json          fixture 定義 (blocks + inputs。expect なし)
  scripts/dump.sc          scarpet ダンプアプリ (設置/settle/走査/保存)
  scripts/run-fixture.sh   npm run ground-truth の実体
  scripts/shared/          scarpet との受け渡し JSON (gitignore)
  runner/generate.ts       実機駆動 → expect 生成
  runner/run.ts            fixture vs sim の diff CLI
  runner/capture.ts        回路ファイルを実機に置いて N tick 撮る (npm run capture)
  runner/compare.ts        キャプチャ vs sim の突き合わせ (npm run gt-compare)
  runner/minimize.ts       食い違いを小さな再現まで自動で縮める → fixture 書き出し
  runner/delta-debug.ts    縮め方のループ (純関数。実機に触らない)
  captures/*.def.json      キャプチャ定義 (回路ファイル + 入力 + ticks)
  circuits/                回路ファイルの実体 (gitignore。source はここからの相対名)
  data/                    サーバ実体 (gitignore, Mojang 由来ファイル)
packages/sim/src/mcstate.ts           MC blockstate 文字列 ↔ sim BlockState 変換
packages/sim/test/fixture-runner.ts   sim 実行 + diff 共通ロジック
packages/sim/test/fixtures.test.ts    CI 回帰 (skipUntil は it.skip)
packages/sim/test/fixtures/*.json     生成済み fixture (コミット対象)
```

## 新しい fixture の追加手順

1. `fixtures/<name>.json` を書く (回路 + 入力 + region + player)
2. `npm run ground-truth -- <name>` — settle 照合に失敗したら実機の教える安定状態に `blocks` を直す
3. diff 一致 → そのままコミット / 不一致 → sim のバグか既知ギャップか判断し、後者なら `skipUntil` + `skipReason` を定義に付けて再生成
4. `npm test` が通ることを確認してコミット

## ライブ観測 (#366)

実機を保持したまま**ビューアーで見ながら操作する**モード。fixture を作る前の当たり付けや、
食い違いの原因座標を探すのに使う。

```bash
npm run harness:up
npm run live -- repeater-delay-1        # fixture 定義 (--port で番号を変えられる)
npm run live -- --def circuit1          # **実回路** (captures/<名前>.def.json) (#372)
npm run dev                             # 別の端末で
# → http://localhost:5173/?live=1
```

- **実機と sim を並べて描き、食い違った座標を 3 枚目の「差分ビュー」に目印ブロックで出す**。
  blockstate は下の表でも読める
- 左クリックでレバー等を押し、右クリックでその座標の状態を読む。HUD から `1 tick` / `8 tick` / `初期化`
- sim は**ブラウザ側で回す**。`buildFixtureWorld` / `applyFixtureInputsAt` /
  `snapshotFixtureRegion` は CI の fixture テストと同じ関数なので、ここで合えば CI でも同じ系列になる
- 接続時に `/save-all flush` して**予約 tick・コンパレーターの保持出力・ホッパーのクールダウン**を
  読み、`trustAuthored` で sim の出発点をそろえる (`--no-hidden` で切れる)

### クライアントで入る (#368)

ライブ観測で操作しながら、**自分のクライアントで世界を見る**こともできる。

```bash
npm run harness:up
# Minecraft 1.21.1 (バニラのクライアントでよい) で「マルチプレイ」→ サーバー追加
#   アドレス: localhost:25565
docker compose exec mc rcon-cli -- op <自分の名前>   # 必要なら
```

ゲームポートは **`127.0.0.1` 限定**で公開している (`docker-compose.yml` の `ports`)。
`ONLINE_MODE: "FALSE"` なので認証は無く、**ループバック限定であることが唯一の防壁**。
`- "25565:25565"` のように書き換えないこと。rcon (25575) は公開していない。

#### 入るときの注意

| 注意 | 理由 |
|---|---|
| **spawn (0, 4, 0) に立ち止まらない** | fake player (GT) の spawn が弾かれ、**`use` 入力が全部空振りする**。原因究明にいちばん時間を使った罠 (README「掃除と残骸」) |
| **名前に `GT` を使わない** | fake player と同名になり、ハーネスの `player GT kill` / `spawn` が自分を巻き込む |
| 世界は止まって見える | `/tick freeze` 中。`npm run live` の `1 tick` / `8 tick` を押すと動く |
| **region の外にブロックを置かない** | `fx_setup` の掃除は region + パディングの中だけ。外に残ると予約 tick が残り、同条件で撮り直しても結果がずれる (#240) |
| 落下に注意 | void superflat なので床の外は空。`MODE: survival` |

### 実回路を開く (#372)

`--def <名前>` で `captures/*.def.json` の実回路を開ける。設置は**キャプチャと同じ関数**
(`placeCircuit`) を通るので、掃除 → 空回し → 設置 → 中身 → 本 → settle → ピストン停止待ち
の順序がそのまま効く。

- `use` の狙点は**ブロック中心** (fixture は `player.lookAt` の小数部)。定義が持つ
  `players[0]` を使うので、`players` の無い定義では押せない (その旨を返す)
- **ピストンが動いている最中に繋ぐと sim だけ組めない**
  (`moving_piston は authored に使えません`)。実機の表示は続くので、
  「初期化」を押すか tick を進めて止まってから繋ぎ直す

#### 所要 (実測)

| 操作 | circuit1 (474 ブロック) | elev-ride (6391 ブロック / 高さ 147) |
|---|---|---|
| 開く (設置 + settle) | 6.6 秒 | 11.0 秒 |
| `step 1` | 0.3 秒 | — |
| `step 8` | 1.7 秒 | **2.1 秒** |
| `setblock` | 0.9 秒 | — |
| `scan` (読むだけ) | 2 ミリ秒 | **6 ミリ秒** |

**region の大きさはほとんど効かない** [実測 2026-09-24]。
6391 ブロックでも全走査は 6 ミリ秒で、1 命令の所要を決めているのは
**1 tick ごとの固定待ち (120ms)** のほう。
(当初「6393 ブロックは 1 桁重くなる」と書いていたが誤りだった。
`keep` で縮めるのは region を絞って差分を読みやすくしたいときの手段で、速度のためではない)

### 合図を送る (#374)

**ワールドに入って見ているときは、操作のたびにチャットと画面下に知らせる**。
`/tick freeze` 中は `step` を撃った瞬間しか世界が動かないので、知らせないと見逃す
(実際に見逃したのがこの機能の発端)。

| 出す先 | 特徴 |
|---|---|
| チャット (`tellraw`) | 履歴に残る。見逃しても後から追える |
| 画面下 (`title actionbar`) | 流れない。「いま何を待っているか」 |
| カウントダウン | 「3 … 2 … 1」で目を向けてもらう |

- 自動通知は**既定で入**。`harness_announce({on:false})` で黙らせられる
- 合図の文面は MCP の `harness_say({text, big, countdown})` でその場で送れる
- **人が居なければ黙る**。`/list` の結果を 10 秒だけ使い回す

#### 落とし穴

- **`/list` は fake player を小文字で返す** (`GT` で作っても `gt`)。除外は大小を無視して比べる。
  これを忘れるとハーネス自身を観客に数えて**永久に黙らない**
- **観客は床の上に立たせる**。region の外は void なので落下死し、`/list` から消える
  (テスト中に実際に踏んだ)
- `tellraw` / `title` は**複数行応答**。`rconBatch` に渡すときは `ignoreResponses: true`

#### schematic は settle しない (#376)

`.litematic` から置いた回路は **`settle` を `false` にする** (`captures/*.def.json`)。
エレベーターの `elev-ride` / `elev-dust` / `elevator-floor5` / `elevator-lectern` は
すでにそうしてある。

置く工程は元から `without_updates()` なので更新は飛ばない (Litematica のシングル貼りと同じ)。
問題はその後に region 全体へ `update()` を撒く `fx_settle()` の方で、
**伸びたまま保存されたピストンが「電源が無いのに伸びている」と判定されて縮み、
粘着で隣のブロックを引きずる**。

| 置き方 | 元ファイルとの差 (種類 / 状態) | 備考 |
|---|---|---|
| `fx_setup()` のみ | **0 / 0** | かごが動かない。160 tick 無変化 (静止した機械なので正しい) |
| `fx_setup()` + `fx_settle()` | 24 / 80 | かごが y=56→57 へ 1 ブロック上昇 |
| ピストンだけ `update` から外す | 24 / 58 | 隣のダスト経由で縮むので直らない |
| コンテナとその隣だけ `update` | 16 / 162 | コンテナの隣がピストンなので直らない。`moving_piston` も残る |
| 全ブロックを `/setblock` (更新あり) | 93 / — | 最悪。`moving_piston` が残る |

`settle: false` でも `fx_items()` と本の入れ直しの後は **`fx_settle_comparators()`** を撃つ。
中身は blockstate に出ないのでコンパレーターに読み直させる必要があり (#196)、
コンパレーターは受け身なのでファイルの出力が正しければ値が変わらず
下流のピストンへも波及しない (実測: ファイルとの差 0)。

**手書き fixture の既定は `settle: true` のまま**。通電状態を持たないので settle が要る。

`elev-ride` を取り直した結果 (compare):

| | settle あり | settle なし |
|---|---|---|
| `settleDrift` | 62 (構造 26 / 状態 36) | **0** |
| 静的の初期食い違い | 522 座標 | **155 座標** |
| 静的で除外された `moving_piston` | 215 座標 | **37 座標** |
| 動的 (`trustAuthored`) | ✔ 一致 | ✔ 一致 |

#### 元ファイルとのズレは構造と状態で分けて出す

`placeCircuit` は置いた直後に元ファイルと突き合わせ、**ブロックの種類が変わったズレ**を
警告する (ライブ観測ではチャットにも出す)。以前は合計を 1 行出すだけだったので、
かごが 1 ブロック動いていたのが「状態のみ」のズレに埋もれて気付かれなかった。

### ライブ観測の制約

- **真上から (topDown) で描く**。`IsometricView` は 3D のときクリックをカメラ回転に使うので
  `onBlockClick` が発火せず、クリック操作が成立しない。3D でのピッキングは別 issue
- **パネルは 1 枚ずつ順に mount する**。`IsometricView` はインスタンスごとにテクスチャを
  取り直す (共有キャッシュが無い) ので、3 枚を同時に出すとブラウザが
  `ERR_INSUFFICIENT_RESOURCES` を返して 2 枚目以降が真っ白になる。差分ビューは既定 OFF
- **1 命令ごとに region を全走査する**。fixture 規模なら十分速いが、
  6393 ブロックのような実回路では 1 命令が数秒かかる (キャプチャ側の差分機構は使っていない)
- **WebSocket は `127.0.0.1` にしか bind しない**。ライブページも開発ビルドにしか無い
  (本番 `rdsim.com` に実機操作の口は出ない)
- 既定ポートは **8791**。8787 は開発機で他のツールと衝突した

## MCP から触る (#369)

ハーネスの操作を MCP の道具として出している。**ロックの直列化**と
**コマンド長 1014 バイト**の制約が内側に閉じているので、呼ぶ側は座標とブロックだけ考えればよい。

登録はリポジトリ直下の `.mcp.json`。リポジトリを開けば使える (stdio)。

| 道具 | 内容 |
|---|---|
| `harness_status` | 実機が起きているか / ロックの持ち主 / 開いている回路 / tick |
| `harness_open` | fixture を置いて開く (掃除 → 設置 → settle)。**ロックを取る** |
| `harness_step` | n tick 進める (1〜64)。戻りは変化した座標 |
| `harness_use` | 座標を押す (レバー・ボタン) |
| `harness_setblock` | 座標に blockstate を置く (支えへの更新も配る) |
| `harness_scan` | region 全体 |
| `harness_inspect` | 1 座標 |
| `harness_reset` | 置き直して 0 tick へ |
| `harness_close` | 閉じて**ロックを返す** |

### ロックの約束

MCP サーバは常駐するので、取ったロックを握りっぱなしにすると
`ground-truth` や `capture` が**10 分間ブロックされる** (残骸とみなされて奪われるまでの時間)。
そこで:

- `harness_open` でロックを取り、以後 60 秒ごとにハートビートを打つ
- **無操作が 5 分続いたら自動で返す**。以後の道具は「先に `harness_open` を呼ぶこと」と答える
- `ground-truth` / `capture` / `live` を回す前は **`harness_close`** を呼ぶ
- 他プロセスが握っていたら**待たずに** pid と経過を返す

### 長時間走るものは道具にしていない

`capture` と `minimize` は 1 回で数十分かかるので MCP の 1 往復には載らない。
CLI (`npm run capture` / `npm run gt-minimize`) をそのまま使う。

## 食い違いの自動最小化 (minimize)

実回路のキャプチャは大きい (エレベーターで 6393 ブロック)。`gt-compare` が
「どこかで食い違う」と言っても、そのままでは原因も追えず fixture にもできない。
`minimize.ts` は **対象座標の食い違いを保ったまま回路を削り**、残ったものを
`packages/sim/test/fixtures/<name>.json` に書き出す。

### 回路ファイルの置き場所

定義ファイルの `source` は**ファイル名だけ**を書く。実体は `tools/mc-harness/circuits/`
(gitignore) に置く。別の場所を使いたいときは `MC_CIRCUITS_DIR` で差し替える。

```bash
mkdir -p tools/mc-harness/circuits
cp ~/Downloads/my-circuit.nbt tools/mc-harness/circuits/
# あるいは
MC_CIRCUITS_DIR=~/Downloads npm run capture -- tools/mc-harness/captures/<name>.def.json
```

**このリポジトリは公開なので、絶対パスをコミットしないこと** (ユーザ名が読める)。
回路ファイル自体は配布していないため、パスを持っていても他の人が撮り直せるわけでもない。
`npm test` の衛生テストが追跡ファイル内の絶対パスを見張っている (#322)。

```bash
# 1. まず全体を撮って突き合わせ、食い違う座標を知る
npm run capture -- tools/mc-harness/captures/<name>.def.json
npm run gt-compare -- tools/mc-harness/captures/<name>.json

# 2. その座標を残したまま縮める (fixture が書き出される)
npx tsx tools/mc-harness/runner/minimize.ts tools/mc-harness/captures/<name>.def.json \
  --pos 21,2,20 --out <fixture名>

# 3. 縮んだ fixture を照合する
npx tsx tools/mc-harness/runner/run.ts <fixture名>
```

- 署名は **「その座標がどこかの tick で差分に出ること」**。「どこかが不一致」に
  すると、削った拍子に生えた別の食い違いを追いかけて本命を取り落とす
- 候補は対象座標からの距離順に並べ、**遠い側から塊で落とす**。塊は半分ずつ縮み、
  オラクル (= 実機キャプチャ) 呼び出しは候補数に対しておよそ 2n 回
- **1 回のキャプチャは回路の大きさで数秒〜25 秒**。6393 ブロックをそのまま掛けない
  (定義に `keep` を書いて手で絞る / `--max-trials` で予算を切る)
- **対象座標と入力の当たり先は落とさない**。落とすと入力が空振りして「署名が消えた」
  と誤判定する
- 書き出す fixture には既定で `skipUntil` が付く。**縮めた結果は定義上まだ sim が
  再現できない回路**なので、付けないと CI が赤くなる。issue 番号に書き換えて使い、
  sim を直したら外す (そこから先は普通の回帰になる)
- 定義の `keep` (座標キー "x,y,z" の配列) は手でも使える。指定するとそのブロックだけを
  置き、region は keep の bbox + pad に縮む。**掃除だけは回路全体に掛かる**ので、
  region の外に前回のブロックが残ることはない

## fixture 作成の注意

「実機が正」なので、**fixture が意図と違うものを撮っていても気づきにくい**。
実際に踏んだ症状と対処を残す (症状 → 原因 → 対処)。

### 掃除と残骸

- **`region` は観測範囲であると同時に `fx_setup` の掃除範囲**。狭く取ると前の fixture の
  ブロックが region の外に残り、fake player のクリックを奪って `use` が**空振りする**。
  プレイヤーの立ち位置・視線・回路の周囲を含めて**広めに取る** (#157)
  - 症状: 1 回目の `use` だけ効かない / 何回撃っても効かない
  - 切り分け: region を広げて再生成し、直るかを見る
- **エンティティはブロックの掃除では消えない**ので、掃除フェーズで
  `kill @e[type=!player]` を毎回撃っている (#161)。マインカート (`summon`) や
  ディスペンサーの射出アイテムが次の fixture に持ち越されるのを防ぐため
- `player.spawn` の直下に**必ず床を敷く**。survival spawn なので床がないと void に
  落下死し、以後の入力が全て `Can only manipulate existing players` で空振りする
  (回路の床 z 列と player の立つ z 列は別なことに注意)

### 狙点 (`use` / `step` が当たらない)

`player.lookAt` の **Y 小数部が全入力で共有される**。generate.ts は入力ごとに
`input.pos + 0.5` へ再照準するが、高さのオフセットだけはこの値を流用する。

- **当たり判定の薄いブロックは Y を合わせる** (#157)
  - 床レバー .35 / 床ボタン .06 / **閉じたトラップドアは下端 3/16 しかないので .10**
  - フルブロック相当 (ドア・フェンスゲート) は .50 でよい
- **視線を遮るブロックに注意** (#159)
  - 症状: 狙ったブロックではなく**手前のブロックが反応する** (奥のレバーを狙って
    手前のドアを開けてしまった)
  - 対処: 給電源は回路より**手前**に置くか、`use` をやめて `setblock` にする
- **薄い板は正面から狙う** (#159)
  - ドアの当たり判定は `facing` 側の薄い板だけなので、斜めから狙うと**素通りする**
  - 対処: プレイヤーをそのブロックの正面 (軸に平行) に置く
- **壁付けのボタン/レバーも押せる** (#378 で解決。#376 までは「押せない」と書いていた)
  - 原因: 当たり判定が `facing` の**反対側**の面に寄っている (facing=north なら
    z が 0.875〜1.0) のに、狙点がセル中心 (z+0.5) だったので射線が入らなかった
  - 対処は `runner/aim.ts` に集約した。**まず従来の狙点** (セル中心 / 定義の `lookAt`)
    を試し、反応が無ければ形状から決めた点 (`facing` の反対へ +0.4) を狙い直す。
    それでも駄目なら `facing` 側のセル中心へ移動して押し直す (ライブ・MCP のみ)
  - **立ち位置はセル中心 (x.5, z.5) にする**。1.5 ブロック離すと当たり判定がセル境界に
    またがり、同じ狙点でも押せなくなる (実測: z=7.0 は失敗 / z=7.5 は 4 回中 4 回成功)
  - キャプチャは tick 精度のため**移動しない**。遠いときは `tp` 入力を書く
  - 手書き fixture の狙点は従来どおり定義の `lookAt` が正 (`generate.ts` は変えていない)
- **`/tick freeze` は fake player を止めない** (#382)
  - vanilla の仕様でプレイヤーだけ凍らない。**足場の無い所に置いた fake player は
    実時間で落ちていく** (tp してから別コマンドで押すと 600 ミリ秒で 1.8 ブロック落ちて外す)
  - 対処: **tp → 照準 → 使用を 1 つの rcon バッチで送る** (`aim.ts` の `pressBlock` が
    そうしている)。落ちる前に押し切れるので、Runa のドアのように壁レバーの前が空でも押せる
  - 押した後に落ちて死ぬのは構わない (プレイヤーは回路の一部ではない)。
    ただし**長いキャプチャで何度も押す定義は作れない** (2 回目までに死ぬ)
- `GT_DEBUG=1 npm run ground-truth -- <name>` で rcon 応答を全て表示できる。
  ただし `player use once` は**当たらなくてもエラーを返さない**。
  キャプチャとライブの `use` は押した後に対象の `powered` が変わったかを見て、
  空振りなら警告を出す (#378)。それが無い経路では「コマンドは通ったのに
  状態が変わらない」ときに狙点を疑うこと

### `setblock` でレバー/ボタンを代用するとき (#382)

壁付けが押せなかった頃 (#378 以前) の定義は `use` の代わりに
`setblock lever[...,powered=true]` を書いている。**等価だが条件がある**。
`Runa.S_opened` / `Runa.S_closed` で `use` 版と frames を突き合わせた結果:

| 素子 | 結果 |
|---|---|
| レバー | **完全に一致 (0 件)**。`setblock` + 支えブロックへの更新 (#290) で足りている |
| ボタン | **20gt 後の自動解放を手で書く必要がある**。書かないと 38 件食い違う |
| ボタン (解放を書いた) | 解放を **1 tick 早く**書くと下流が一致する。書いた tick にボタン自身の状態が出るので、ボタン自身の見え方だけ 1 tick ずれる (2 件) |

**入力は tick の各フェーズの後に適用される**ので、`setblock` で解放を書くと
下流の反応が 1 tick 遅れる。本物のボタンは押した tick + 20gt の
ScheduledTick フェーズで戻るため、`setblock` は 1 tick 早めて釣り合う。
`runa-closed.def.json` は解放を tick 24 (押したのが 4) に書いているので、
**下流が本物より 1 tick 遅い**。新しい定義は `use` を使うこと。

### Runa のドアを動かす

`captures/runa-open-use.def.json` / `runa-closed-use.def.json` が `use` 版の見本。

| 回路 | 操作点 | 立ち位置 |
|---|---|---|
| `Runa.S_opened` | `4,1,0` の `lever[face=wall,facing=north]` | `4.5, 0, -0.5` |
| `Runa.S_closed` | `0,4,10` の `stone_button[face=wall,facing=west]` | `-0.5, 3, 10.5` |

どちらも**立ち位置の下に床が無い**ので、`pressBlock` の「1 バッチで tp して押す」
が効いている (上の「狙点」参照)。押すと 30 tick のうち 25〜28 tick ピストンが動く。

### `settle: false` は「置いた形が保たれる」保証ではない

`Runa.S_closed` は **settle の有無に関わらず構造ズレが 8 か所出る**
(`piston_head→smooth_quartz` 4 / `smooth_quartz→air` 4)。
ファイル自身がピストン 4 本を電源なしで伸びた状態で保存しているので、
`update()` を撒かなくても**tick が進んだ時点で縮む**
(設置後に `waitForDrain` とピストン停止待ちで tick が進む)。

- settle が効くのは**ダストやコンパレーターの状態**の方 (エレベーターは
  かごが動く / これが #376)
- ファイル由来のズレは settle では直らない。**元ファイルを安定した状態で
  保存し直す**しかない

### 物流 (コンテナ)

- **受け先のコンテナにも `items` を書く** (#161)
  - 症状: ドロッパー/ホッパーが挿入しない
  - 原因: `items` が無いコンテナは sim が「手動信号モデル」(10 C6) として扱い、
    `count` を持たないので挿入を拒否する
  - 対処: 受け先に `"items": 0` を明示する

### 観測の落とし穴

- **条件を満たしていても近隣更新が届いていなければ起動しない** (#163)
  - `/setblock` が配る更新は**置いた位置の 6 方向だけ**。疑似接続の判定セル
    (1 段上) に隣接するブロックを置いても、対象自身には更新が届かず
    **BUD 状態**のまま何も起きない
  - 「素子が条件を持たない」のか「更新が来ていない」のかを分けるには、
    **更新を送るステップを別に用意する** (対象の隣に石を `setblock` する等)
- `player` の spawn/kill は freeze 中に完了しないため、generate.ts が一時 unfreeze
  区間で処理する。unfreeze 中に ~20tick 走るので **authored は必ず settled 安定状態**
  で書くこと (発振回路はこの方式では扱えない)
- **authored は `without_updates` で置かれる**ので、`onPlace` で自己補正する素子
  (ランプ・ピストン等) 以外は「実機に自然には存在しない状態」を作れてしまう。
  実プレイで到達できる状態かどうかは自分で担保すること
- **初期状態 (authored) と frames の基準時刻は必ず同じにする** (#248)。
  `fx_cap_start` が差分の基準 `global_cap_prev` と**同じ 1 回のスキャン**から
  `authored.json` を書き出すのはこのため。別々に撮ると、その間に進んだ tick の変化が
  どの frame にも現れず、sim 側は永久に追いつけない。
  しかも食い違いは**ずれた座標ではなく下流**に出るので「sim のバグ」に見える
  (実際 5 ブロック先のコンパレーターで 1 周誤診した)
- **初期状態に `moving_piston` が 1 つでもあれば、そのキャプチャは捨てる** (#248)。
  運んでいる中身が BlockEntity にあって blockstate に出ないため sim 側で復元できない。
  capture / compare のどちらもエラーで止まる (以前は黙って air に落としていた)
- **ブロック状態に出ない値は「記録開始と同じ瞬間」に実機から読む**。今のところ 3 つ:
  - 予約 tick — 保存データの `block_ticks` (`runner/scheduled-ticks.ts`、#240)
  - コンパレーターの保持出力 — 保存データの `block_entities` の `OutputSignal` (#249)
  - **コンテナの中身** — `fx_read_items()` (#252)。**元ファイルの中身を使ってはいけない**。
    settle 中に機械が動いて入れ替わることがある
    (ガラスエレベーターのディスペンサーは空バケツ ⇄ 水バケツで入れ替わり、
    元ファイルの空バケツで始めると水源を置けずに機械が止まる)
  保存データ由来のものは `/save-all flush` の後に読む。時刻を揃えないと #248 と同じ穴になる
- **コンパレーターの出力を「今の入力から計算し直す」でよいのは止まっている回路だけ** (#249)。
  信号が周回しながら 1 ずつ減る機械では、コンパレーターは
  「まだ書き換わっていない古い値」を保持していて、予約 tick の発火でようやく落ちる。
  計算し直すと最初から新しい値になり、発火しても何も変わらず**機械が止まる**
  (エレベーターで実測: 実機は 15→14→13 と減衰、sim は 15 のまま不動)
- **dump.sc を直したら `unload` → `load`**。読み込み済みのまま `script load` を撃つと
  carpet は「もう入っている」と答えるだけで**ファイルを読み直さない**。
  `reloadDumpApp()` (runner/rcon.ts) を使うこと
