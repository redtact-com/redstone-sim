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
- `GT_DEBUG=1 npm run ground-truth -- <name>` で rcon 応答を全て表示できる。
  ただし `player use once` は**当たらなくてもエラーを返さない**ので、
  「コマンドは通ったのに状態が変わらない」ときは狙点を疑う

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
