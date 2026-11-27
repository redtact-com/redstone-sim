# 18. 26.3 の正解データ (実機オラクル) の取り方

Java 版 26.3 で tick ごとの正解を撮る方法を 3 つ比べ、推奨と実装の手順を決める。
今の実機ハーネス (tools/mc-harness) は 1.21.1 で動く。Rust (WASM) エンジンの典拠を 26.3 に移すなら、正解も 26.3 で撮る必要がある。

- 調査日: 2026-11-26。サーバは起動していない。読んだのは次の 3 つである。
  - 26.3 のデコンパイル (版差の確認に 1.21.1・26.2・26.4-pre-1 も読んだ)
  - リポジトリの資料とコード
  - 配布元の API とリリース一覧
- vanilla の挙動は docs/ip-policy.md に従い「26.3 クラス名#メソッド名 + 自分の言葉」で書く。
- 確かさの表記:
  - **[26.3 読解]** デコンパイルを読んで確かめた
  - **[API 2026-11-26]** 配布元の API・リリース一覧で確かめた
  - **[実測 1.21.1]** 今のハーネスの記録 (README・既存資料) による
  - **[推定]** 見込み。最初の issue (§6.2 の O1) で実測に置き換える
  - **[要実機]** 起動して確かめる必要がある
- 関係する資料: 04 (検証の 3 層)、06 (レイヤ C の道具の評価)、09 (microTiming の手動採取)、16 (Nucleation の比較)、17 (実回路の集め方)、docs/vanilla/ の各メモ (26.3 の挙動。入口は docs/vanilla/README.md)。

---

## 0. 結論

1. **主オラクルは (c) にする**。自前の小さな起動コードで、26.3 の GameTestServer をプロセス内に立てる。テスト関数の毎 tick の呼び出しの中で、回路を置き・入力し・状態を撮る。
   - ゲームのコードを書き換えない。Mod・Mixin・ローダーは無い。入口は公開の TestFunctionLoader#registerLoader と GameTestMainUtil#runGameTestServer である
   - tick ごとの状態の系列と予約 tick のキュー (優先度と予約順まで) は、公開のメソッドだけで撮れる。tick 内の順の一部 (ブロックイベント・近隣更新) は、読むだけのリフレクションか、世界に入れた偽プレイヤーの接続を使う (§4.3)
   - 待ち時間が無い。sleep と docker exec が消え、134 本を 1 分程度で撮れる見込み [推定]
   - 右クリックを、パケット処理が呼ぶのと同じサーバ側の入口 (ServerPlayerGameMode#useItemOn) へ直接入れられる。狙点・落下・spawn の失敗の罠 (README「狙点」) が消える
2. **(a) は 26.3 へ上げられる**。fabric-carpet 26.3・carpet-tis-addition v1.84.0-mc26.3・Fabric loader 0.20.1 が出ている [API 2026-11-26]。
   主オラクルにはしない。(c) の照合相手と、人がクライアントで入って見る用途 (ライブ観測・microTiming の手動観察) に残す。
3. **(b) は単独では主オラクルにならない**。vanilla には偽プレイヤーが無く、右クリックを入れられない。tick 内の順も取れない。
   ただし strict の配置・/place template・構造物の保存は、(a) と (c) の部品として使える。
4. **fixture の形式は変えずに使える**。tick 規約 (state[t] = tick t の全フェーズの後、その tick の入力の直後) は、(c) でも同じ位置で撮れる (§4.2)。
   mcVersion と generated に版と採取系を書く。tick 内の観測は任意の欄で足す (§7)。
5. **撮り直すと expect が変わる fixture が出る**。原因は 1.21.1 と 26.3 の版差である (/setblock の後始末の順・トーチの撤去フック・ピストンが壊すブロックの撤去の時点)。
   1.21.1 の fixture は残し、26.3 の fixture は版別に置く (§7.4・§8)。

---

## 1. 前提

### 1.1 今のハーネス (1.21.1) [実測 1.21.1]

| 項目 | 中身 |
|---|---|
| サーバ | docker の itzg/minecraft-server:java21。TYPE FABRIC・VERSION 1.21.1・MODRINTH_PROJECTS carpet (fabric-carpet 1.21-1.4.147+v240613)。void superflat |
| 操作 | rcon。1 命令ごとに docker compose exec で rcon-cli を起こす (runner/rcon.ts)。遅さの主因はこのプロセス起動 |
| 駆動 | /tick freeze の後、ホスト側が「tick step 1 → 入力 → scarpet の fx_dump」を tick 数ぶん繰り返す。1 tick ごとに固定の待ち 120 ms |
| 設置 | scarpet の without_updates で置く → 全ブロックに update → 8 tick 進めて、定義の blocks と照合する (settle 照合) |
| 入力 | carpet の偽プレイヤー GT の use once と tp。ほかに /setblock・/summon・/kill・/item replace・/data modify |
| 見えない状態 | キャプチャとライブでは、/save-all flush の後に Anvil の block_ticks と block_entities を読む (runner/scheduled-ticks.ts) |
| 本数 | 定義 134 本 (tools/mc-harness/fixtures)。生成済み 150 本 (packages/sim/test/fixtures) |
| 生成済みの内訳 | carpet 1.4.147 で生成 134 本、キャプチャと最小化の出力 15 本 (carpet の版は unknown)、生成記録なし 1 本。定義の無いもの 16 本 |
| 入力の内訳 | 生成済み 150 本で use 185・setblock 177・item 15・summon 4・kill 3・step 2 |
| 規模 | 定義 134 本の tick の合計 3,499、入力 339 (うち use 184)。入力のある定義は 130 本 |

tick 規約 (README「tick 規約」): state[t] は「tick t を進め終えて止まっている所で、tick t の入力を入れた直後」の状態である。

### 1.2 26.3 で変わる前提 (3 案に共通)

| 項目 | 1.21.1 | 26.3 | 影響 |
|---|---|---|---|
| Java | 21 | 25。version.json の java_version 25、java-runtime-epsilon | docker の image を Java 25 にする。起動コードも Java 25 |
| 難読化 | mappings が要る | 実名の jar (03 §3)。Fabric の intermediary は 0.0.0 [API 2026-11-26] | 起動コードは jar の公開クラスを名前で呼べる |
| ゲームルールの名前 | doDaylightCycle などの camelCase | advance_time などの小文字の ID。旧名からの写しは 26.3 GameRuleRegistryFix にある | runner/world-setup.ts の列を書き換える (§2.2) |
| 無人時の停止 | 無い | 専用サーバは pause-when-empty-seconds が既定 60 (26.3 DedicatedServerProperties)。無人が続くと MinecraftServer#tickServer が先へ進まずに戻る | (a)(b) は 0 にする。しないと tick step が空振りし、**変化 0 件の expect を正解として書く** |
| /setblock | フラグ 2 の書き込み + blockUpdated | フラグ 258 (2 + 256) の書き込み + updateNeighboursOnBlockSet。strict を付けるとフラグ 818 で後始末なし (26.3 SetBlockCommand#setBlock) | setblock 入力の fixture は順が変わりうる (§8) |
| 無更新の配置 | carpet の without_updates に頼る | /place template と /fill にも strict がある。フラグ 818 で、形状更新も設置フックも飛ばす (26.3 PlaceCommand・FillCommand) | vanilla のコマンドだけで無更新の配置を作れる |
| GameTest | 旧方式 (開発環境のみ) | 1.21.5 で刷新された。/test は常に登録される (26.3 Commands)。ヘッドレスの入口 net.minecraft.gametest.Main がある | (b)(c) の土台 |
| データパックの版 | — | 121 (version.json の pack_version)。pack.mcmeta は min_format と max_format で書く (26.3 PackFormat) | (b)(c) で使うパック |
| DataVersion | 3955 (runner/state-to-nbt.ts に固定) | 5023 (version.json の world_version) | 構造 NBT を書く所を版に合わせる |
| fixture のブロック ID とプロパティ名 | — | 定義と生成済みに出る 66 種の ID は、全部 26.3 にある。レッドストーン系のプロパティ名も同じ (26.3 BlockItemIds・BlockStateProperties) | 文字列はそのまま使える |
| 保存データの鍵 | block_ticks の i・x・y・z・t・p、OutputSignal、TransferCooldown、Page | 同じ (26.3 SavedTick・ComparatorBlockEntity・HopperBlockEntity・LecternBlockEntity) | scheduled-ticks.ts はそのまま読める見込み |
| /tick freeze と step | — | TickRateManager と ServerTickRateManager は引数名しか違わない | 凍結の意味論は同じ |

---

## 2. 案 (a): 今のハーネスを 26.3 へ上げる

### 2.1 部品の対応状況 [API 2026-11-26]

| 部品 | 26.3 の版 | 公開日 | 備考 |
|---|---|---|---|
| fabric-carpet | 26.3 (fabric-carpet-26.3+v260915.jar) | GitHub の v26.3 が 2026-09-15、Modrinth が 2026-09-18 | release。MIT。依存の宣言が無い (Fabric API は不要)。server_side は required |
| carpet-tis-addition | v1.82.4-mc26.3 〜 v1.84.0-mc26.3 の 6 版 | 2026-09-16 〜 2026-11-24 | release。carpet を必須に宣言。microTiming を持つ (06 §2) |
| Fabric loader | 0.20.1 (stable) | — | meta.fabricmc.net は 26.3 を stable と返す。intermediary は 0.0.0 |
| Fabric API | 0.160.5+26.3 〜 0.166.2+26.3 (release) | 2026-09-14 〜 2026-11-11 | carpet は使わないので入れない |
| itzg/minecraft-server | java25 (latest と stable も Java 25) | — | java21 の image では 26.3 は動かない (Java 25 が要る) |
| 次の版 26.4 | carpet 26.4-beta-7 (26.4-snapshot-10 と pre-1)、TIS v1.84.0-mc26.4-snapshot-10、Fabric API 0.167.1+26.4 (beta) | 2026-11-19 〜 2026-11-24 | carpet は 26.2・26.3 とも、MC のリリースと同じ日に GitHub へ出た (MC 26.3 は 2026-09-15 11:23 UTC、carpet v26.3 は同日 20:44 UTC) |

1.21.1 用の carpet は 1.4.147 (2024-09-05) が最後である。1.21.1 のハーネスはこのまま凍結しても動く。

### 2.2 変える所

1. docker-compose.yml
   1. image を itzg/minecraft-server:java25 にする
   2. VERSION を 26.3 にする
   3. PAUSE_WHEN_EMPTY_SECONDS を "0" にする (§1.2)。itzg はこの環境変数を server.properties の pause-when-empty-seconds へ写す
   4. carpet の版を固定する。fixture の generated.carpet に書く版と食い違わないようにする
   5. LEVEL_TYPE と GENERATOR_SETTINGS は今のままでよい。26.3 の平坦の設定は layers・biome・lakes・features・structure_overrides を読む (26.3 FlatLevelGeneratorSettings)
2. runner/world-setup.ts のゲームルールを 26.3 の名前にする

   | 今 | 26.3 |
   |---|---|
   | doDaylightCycle false | advance_time false |
   | doWeatherCycle false | advance_weather false |
   | doMobSpawning false | spawn_mobs false |
   | doFireTick false | fire_spread_radius_around_player 0 (旧 doFireTick=false はこの値に写る) |
   | randomTickSpeed 0 | random_tick_speed 0 |
   | announceAdvancements false | show_advancement_messages false |
   | spawnChunkRadius 0 | 消す (26.3 にこのルールは無い) |

3. dump.sc を 26.3 で確かめる [要実機]
   1. 使っている関数は block・block_state・set・without_updates・update・inventory 系・read_file と write_file・run・player・query など。carpet 26.x のリリースノートに、これらの破壊的な変更の記載は無い
   2. **without_updates が 26.x の新しいフラグ (512 = 設置フックを飛ばす、256 = BlockEntity の副作用を飛ばす) とどう対応するかは未確認**。settle 照合が落ちたら、まずここを疑う
   3. carpet の update が「電力の再計算は起こすが、接続の形状は直さない」(README) のままか
4. generate.ts の setblock 入力 [要実機]
   1. 26.3 の /setblock は、後始末で撤去フック → NC → CU を出す (§1.2)。支えブロックへの更新 (emitAttachedSupportUpdate、#290) が 26.3 でも要るかを確かめる
5. state-to-nbt.ts の DataVersion を版から引く (3955 の固定をやめる)
6. 手元で入るクライアントを 26.3 にする (README「クライアントで入る」)

### 2.3 前提資料への影響

| 資料 | 今の前提 | 26.3 では |
|---|---|---|
| tools/mc-harness/README.md | Fabric 1.21.1 + carpet 1.4.147。凍結中もプレイヤーは tick される。scarpet の run() は遅延実行される | 凍結の仕組みは同じ (§1.2)。偽プレイヤーが凍らない罠もそのまま。無人停止の罠が増える。ゲームルールの名前が変わる |
| docs/research/04 §2.2・§4 の 1 | 「26.x は実機検証 mod がほぼ皆無」 | もう当てはまらない。carpet・TIS とも 26.3 版がある。加えて (c) がある |
| docs/research/04 §2.3 | レイヤ C は microTiming | TIS の 26.3 版で同じことができる。出力がプレイヤーのチャットに限られる点は変わらない見込み [要実機] |
| docs/research/06 §4・§6.4 | GameTest は合否 1 bit で、tick 系列は取れない | **データパックだけで使う場合に限った話**である。Java のテスト関数 (c) なら、tick ごとの系列も予約キューも取れる。06 の結論は (c) を除いた評価として読み替える |
| docs/research/09 | 1.21.1 のクライアント + Fabric + carpet + TIS で手動観察 | 26.3 のクライアント + carpet 26.3 + TIS v1.84.0-mc26.3 にする。microTimingTarget の既定が labelled な点と、instantBlockUpdaterReintroduced を off のままにする注意はそのまま |

### 2.4 評価

- 良い点
  - 作る手間が小さい (S)
  - 今の資産がそのまま動く。ライブ観測 (#366)・MCP (#369)・キャプチャ・最小化
  - 人がクライアントで入って見られる
- 悪い点
  - Mod が入る。ルールが既定でも、Fabric と carpet が注入したコードは動いている
  - sleep と docker exec で遅い
  - 偽プレイヤーの狙点・落下・spawn の失敗といった、採取の罠が残る
  - tick 内の順は手作業 (microTiming のチャット)

---

## 3. 案 (b): Mod なしの vanilla

### 3.1 26.3 の GameTest の枠組み [26.3 読解]

**入口**

- net.minecraft.gametest.Main が GameTestMainUtil#runGameTestServer を呼ぶ。サーバ jar の bundler から起動するときは、システムプロパティ bundlerMainClass にこのクラス名を渡す (wiki の GameTest の記事)。
- オプションは universe・packs・tests・report・verify・repeatCount・help の 7 つ。
  - universe はワールドの置き場。既定は gametestserver で、毎回消して作り直す
  - packs はデータパックのフォルダ。中身をワールドの datapacks へ写す
  - tests は名前空間つき ID の選択。ワイルドカードが使える
  - report は JUnit 風の XML を書く
- 終了コードは「必須テストの失敗数」。テストが始まる前の停止は -1、クラッシュは 1 (26.3 GameTestServer#onServerExit・#onServerCrash)。

**GameTestServer の世界** (26.3 GameTestServer#create・#initServer・#startTests)

| 項目 | 値 |
|---|---|
| 種類 | MinecraftServer の子。専用サーバ (DedicatedServer) ではない。TCP の待ち受けも rcon も開かない |
| ワールド | 平坦 (FLAT_ALL_DIMENSIONS)。種 0、構造物なし。ゲームモードは creative |
| 機能フラグ | 全部から redstone_experiments と minecart_improvements を除いたもの。26.3 のフラグは vanilla・trade_rebalance・redstone_experiments・minecart_improvements の 4 つなので、既定より増えるのは trade_rebalance (村人の取引) だけ |
| ゲームルール | 既定値。モブのスポーンも昼夜も動く。テスト環境で変える |
| 無人停止 | しない。pause-when-empty-seconds の既定は MinecraftServer 側で 0 |
| tick の待ち | waitUntilNextTick がタスクを回すだけで待たない。tick は全速で回る |
| テストの置き場 | x と z を ±14,999,992 の乱数で、y = 4 から格子に並べる。列の間隔 5、行の間隔 6、1 行 8 本 |
| eula.txt | 読まない。eula.txt を見るのは専用サーバの入口 (26.3 server.Main) だけ |

**テストの定義** (データパックの test_instance。26.3 TestData・FunctionGameTestInstance)

| 欄 | 既定 | 意味 |
|---|---|---|
| type | — | function (Java のテスト関数を呼ぶ) か block_based (テストブロックで判定する) |
| function | — | type が function のとき。test_function レジストリの ID |
| environment | — | test_environment の ID か、その場の定義 |
| structure | — | 置く構造物の ID |
| max_ticks | — | 正の整数。これを超えると時間切れで失敗 |
| setup_ticks | 0 | 構造物を置いてから関数を呼ぶまでの tick |
| required | true | 失敗を終了コードに数えるか |
| rotation | none | 構造物の回転 |
| manual_only | false | 一括の実行から外す |
| max_attempts と required_successes | 1 と 1 | 再試行 |
| sky_access | false | 天井の barrier を張らない |
| padding | 0 | 0〜128 |
| dimension | overworld | ディメンション |

テスト環境 (test_environment) の種類は 7 つある。all_of・clock_time・difficulty・function (準備と後片付けの関数)・game_rules (rules の表)・timeline_attributes・weather (26.3 TestEnvironmentDefinition#bootstrap)。

**1 本のテストの流れ** (26.3 GameTestRunner・GameTestInfo・TestInstanceBlockEntity・StructureUtils)

1. 同じ環境・同じディメンションのテストを、50 本ずつ 1 バッチにまとめる。バッチの中のテストは同時に走る
2. 構造物の範囲のチャンクを強制読み込みにする
3. 範囲を空にする。ブロックをフラグ 818 で置き換えて近隣更新を出し、範囲の予約 tick とブロックイベントを消し、プレイヤー以外のエンティティを消す (26.3 StructureUtils#clearSpaceForStructure)
4. 構造物をフラグ 818 で置く。形状更新も設置フックも走らない (26.3 TestInstanceBlockEntity#placeStructure)
5. 外周に barrier を置く (フラグ 3)。そのあと範囲の予約 tick とブロックイベントをもう一度消す (26.3 GameTestInfo#placeStructure)
6. 範囲のチャンクのエンティティが tick される状態になるまで待つ
7. テストの tick を -(setup_ticks + 遅延 + 1) から数え、0 になった tick でテスト関数を 1 回呼ぶ
8. 以後、毎 tick「指定した tick の処理」と sequence を回す。max_ticks を超えたら失敗
9. GameTest の tick は MinecraftServer#tickChildren の gameTests の区画で回る。全ディメンションの tick と接続の tick の**後**である。**凍結中は回らない** (runsNormally のときだけ)

**/test コマンド** (26.3 TestCommand。権限レベル 2)

| 下位コマンド | 内容 |
|---|---|
| run・runmultiple | 指定したテストを 1 回 / 複数回走らせる |
| runthese・runclosest・runthat・runfailed | 近く・最寄り・視線の先・失敗したもの |
| verify | 回転ごとに 100 回ずつ |
| locate | テストの位置を探す |
| resetclosest・resetthese・resetthat・clearthat・clearthese・clearall | 置き直す・消す |
| create | テスト用の空の構造物を作る。**範囲を空にする**ので、既にある回路の上では使えない |
| exportclosest・exportthese・exportthat | テストの範囲をワールドの generated へ構造物として保存し、続けて書き出しを試みる。開発用のフォルダが無い普通のサーバでは「書き出しは無効」と答えるが、保存は済んでいる (26.3 TestInstanceBlockEntity#exportTest) |
| export | 読み込み済みの構造物の書き出しだけを試みる。ワールドからは保存しない |
| stop・pos | 止める・相対座標を出す |

### 3.2 GameTestHelper でできること [26.3 読解]

| やりたいこと | GameTestHelper のメソッド | 中身 |
|---|---|---|
| 指定 tick の状態を確かめる | runAtTickTime・runAfterDelay・succeedOnTickWhen・assertBlockState・assertBlockProperty・assertRedstoneSignal・assertBlockEntityData | 相対座標で読む。外れたら例外で失敗 |
| 毎 tick 何かする | onEachTick、または startSequence の thenExecuteFor | onEachTick は今の tick から max_ticks まで、tick ごとに 1 件ずつ登録する。thenExecuteFor は指定した tick 数のあいだ、毎 tick 呼ぶ |
| 信号のパルス | pulseRedstone | redstone_block を置き、指定した tick 後に空気へ戻す。どちらもフラグ 3 |
| ブロックの使用 | useBlock | 偽プレイヤーで、BlockState#useItemOn → (空の手で試す扱いなら) BlockState#useWithoutItem → アイテムの useOn の順に試す。当たりの既定はブロックの中心・北の面 |
| レバー・ボタン | pullLever・pressButton | LeverBlock#pull・ButtonBlock#press を、プレイヤーなしで直接呼ぶ。pressButton は押されたままのボタンも押し直す (通常の使用は、押されていたら何もしない) |
| 偽プレイヤー | makeMockPlayer・makeMockServerPlayer・makeMockServerPlayerInLevel | 前の 2 つは世界に入らない。最後は埋め込みの接続でプレイヤー表に入れる (26.3 で削除予定の非推奨) |
| 置く・壊す | setBlock (フラグ 3)・placeBlock (アイテムの設置の経路)・destroyBlock | — |
| tick を手で起こす | tickBlock・randomTick | 予約とは無関係に、その場で呼ぶ |

### 3.3 データパックだけでできること・できないこと

- **関数テストはデータパックだけでは作れない**。test_function は組み込みのレジストリで、中身は Java のコードから TestFunctionLoader 経由でしか入らない (26.3 BuiltInRegistries の TEST_FUNCTION、BuiltinTestFunctions#bootstrap)。06 §4 の結論は、ここまでは正しい。
- ブロック方式のテストは、テストブロック (start・log・fail・accept) を回路に混ぜ、レッドストーンで合否を出す。
  - log モードは、受電の立ち上がりで「モード・座標・文」をログに出す (26.3 TestBlockEntity#log)。tick 番号は出ない
  - テストブロックを置くこと自体が回路を変える。観測のための部品が正解を汚す
- mcfunction で execute if block を毎 tick 判定し、say でログへ出すことはできる。決めた数点の真偽だけで、状態の系列にはならない。

### 3.4 /tick と /place と状態の取り出し (専用サーバを rcon で回す)

1. 配置: /place template に strict を付けるか、/setblock・/fill に strict を付ける。どれもフラグ 818 で後始末が無い。テンプレートはワールドの generated かデータパックから読む
2. 進め方: /tick freeze と /tick step 1。意味論は 1.21.1 と同じ。無人停止を 0 にする (§1.2)
3. 状態の取り出し (どれも tick の境界で撃つ)

   | 手段 | 取れるもの | 取れないもの | 備考 |
   |---|---|---|---|
   | /save-all flush + リージョンファイル | ブロック状態 (パレット)・BlockEntity・予約 tick (残り遅延と優先度) | 予約順。保存は予約の一覧を持つが、並びは順を保証しない | 今の scheduled-ticks.ts の延長。毎 tick、全チャンクを書く |
   | 構造物の保存 | ブロック状態・BlockEntity・エンティティ | 予約 tick | 構造ブロックの SAVE を給電するか、test_instance_block を置いて /test exportclosest を撃つ。generated の下に .nbt で出る (26.3 StructureBlockEntity#saveStructure)。構造ブロックと給電のブロックは回路の外に置く |
   | /data get block | BlockEntity の NBT | ブロック状態 | 1 座標ずつ |
   | /execute if block | 1 座標の真偽 | 系列 | 合否向け |

4. 入力: **vanilla には偽プレイヤーが無い**。右クリックを入れる手段は 2 つしかない。
   1. /setblock で代用する。レバーは支えブロックへの更新まで出せば一致した (README #382)。ただし今その更新は scarpet の update で出しており、vanilla のコマンドだけで同じ形に出す方法は見つかっていない。ボタンは 20 gt 後の解放を手で書く必要がある
   2. 外からプロトコルのボットで入る。mineflayer の対応は 26.1 まで [API 2026-11-26] で、26.3 には使えない。自作は重い
5. tick 内の順: 取れない。26.3 にはデバッグ購読 (近隣更新の座標など) があるが、op のクライアントが要り、中身も座標だけである (26.3 ServerDebugSubscribers・DebugSubscriptions)

### 3.5 評価

- 良い点: 一番きれいである。Mod が無く、自前のコードもゲームの中に入らない。設置と保存は vanilla のコマンドで足りる
- 悪い点: use の 184 件を再現できない。tick 内の順が取れない。毎 tick の保存で (a) より遅い
- 使い道: (c) の結果を専用サーバで裏取りする部品 (setblock だけで動く fixture に限る)

---

## 4. 案 (c): 自前の小さな起動コード

### 4.1 しくみ

Nucleation の tools/gametest と同じ発想で、GameTestServer をプロセス内で動かす (16 §1.2)。
Nucleation のコードは移植しない (16 §5)。Mojang の GameTestServer や TestCommand の手順も写さず、公開の入口を呼ぶだけにする。
Nucleation は保護されたメソッドをリフレクションで呼んで 1 tick ずつ進めるが、この設計はテスト関数の毎 tick の呼び出しを使うので、その必要が無い。

1. **jar の取得** (起動のたび)
   1. piston-meta の version manifest から 26.3 の version JSON を取り、サーバ jar の URL と sha1 を得る。tools/decompile/fetch-and-decompile.sh と同じ手順である
   2. jar は bundler 形式で、62,294,556 バイトある。META-INF/versions の中の本体 jar と、META-INF/libraries の 39 個のライブラリを作業フォルダへ展開し、クラスパスにする
   3. 作業フォルダは gitignore にする。CI のキャッシュと成果物にも残さない
2. **起動コード** (自前。Java 25。展開した jar に対して javac する)
   1. 最初に SharedConstants#tryDetectVersion を呼ぶ。呼ばないと版が決まらず失敗する (Nucleation の README も同じ注意を書く)
   2. 次に TestFunctionLoader#registerLoader で自前のローダーを登録する。**Bootstrap より前に**登録する。組み込みレジストリの初期化 (BuiltinTestFunctions#bootstrap) が、その時点で登録済みのローダーを 1 回だけ回すからである
   3. GameTestMainUtil#runGameTestServer を呼ぶ。universe は一時フォルダ、packs は自前のデータパック、tests は自前の名前空間だけを選ぶ
3. **自前のデータパック** (ビルドのときに生成する。中身は自分で書いたもの)
   1. pack.mcmeta。min_format と max_format は 121
   2. test_environment を 1 本。game_rules で advance_time・advance_weather・spawn_mobs・spawn_monsters を false、random_tick_speed と fire_spread_radius_around_player を 0 にする
   3. test_instance を 1 本。type は function、structure は minecraft:empty、max_ticks は全 fixture の合計より大きく、required は true
4. **駆動するテスト関数** (毎 tick 1 回だけ呼ばれる 1 つの処理で、fixture を順に回す状態機械)
   1. 掃除: fixture の範囲と余白を空気にし、その範囲の予約 tick とブロックイベントを消す (LevelTicks#clearArea・ServerLevel#clearBlockEvents)。エンティティも消す。今のハーネスの「数十 tick の空回し」(#240) が要らなくなる
   2. 範囲のチャンクを強制読み込みにする (ServerLevel#setChunkForced)
   3. 置く: /setblock の strict と同じフラグで置く。コンテナの中身と書見台の本を入れる
   4. settle: 全ブロックに近隣更新を配る (carpet の update に当たる) → 8 tick 進める → 定義の blocks と照合する。今と同じ手順である
   5. 記録: tick 0〜ticks の各 tick で、その tick の入力を入れ → 範囲を読み → 前の tick との差分を残す
   6. 1 本ごとに結果の JSON を書き出す。1 本の中で例外が出ても、記録して次へ進む。最後にテストを成功にしてサーバを止める
5. **TS 側**: 結果の JSON を今の fixture 形式へ写す。generate.ts の後半と同じ役である

### 4.2 1 tick の中での位置 (規約との一致) [26.3 読解]

| 時点 | 今のハーネス (凍結 + step) | (c) |
|---|---|---|
| tick t の全フェーズ (予約 tick・ブロックイベント・エンティティ・BlockEntity) | tick step 1 で回る | 通常の tick として回る |
| 入力 | 凍結中の tick t と t+1 の間。rcon のコマンドは区間 C のタスクとして動く (docs/vanilla/01_tick-loop.md) | gameTests の区画 (全ディメンションの tick の後) で、テスト関数の中 |
| 読む | 同じ境界で fx_dump | 同じ呼び出しの中で、入力の直後 |
| gameTime | 凍結中は進まない。入力で予約した遅延 d は tick t+d で発火する | tick t の値のまま。遅延 d は tick t+d で発火する |

- gameTests の区画から次の tick の予約 tick (L6) までに動くのは、次のものである。どれも回路には効かない。
  - 送信・タスク処理・次の tick のパケット処理
  - データパックの tick 関数 (置かない)
  - ワールド時計・天候 (止める)・gameTime の加算
- よって state[t] の定義はそのまま使える。expect は同じ形で比べられる。

### 4.3 撮れるもの

| 観測 | 取り方 | 公開 API だけか | 精度 |
|---|---|---|---|
| ブロック状態 | 範囲を読む | はい | 今と同じ。tick の境界の正味 |
| BlockEntity (コンテナの中身・コンパレーターの出力・ホッパーのクールダウン・書見台) | BlockEntity を NBT に書き出して読む | はい | 保存を経ないので、#248 の「時刻をそろえる」手間が無い |
| 予約 tick | チャンクの予約の入れ物 (LevelChunkTicks#getAll) | はい | 種類・座標・発火 tick・優先度・**予約順 (subTickOrder)** の 5 項目。次の tick の予約の実行順は (優先度, 予約順) で決まるので、**境界のキューから次の tick の実行順がわかる**。例外は期限を過ぎた予約と 65,536 件の上限 (→ docs/vanilla/02_scheduled-ticks.md) |
| ブロックイベントの順 | ServerLevel の private な待ち行列 (挿入順つきの集合) を、記録つきの同じ型に差し替える | いいえ (final の欄の書き換え) | 追加と取り出しの順 |
| 〃 (別の取り方) | 世界に入れた偽プレイヤーの埋め込みの接続を読む。実行に成功したブロックイベントのパケットが、実行の順に届く | はい | 成功したものだけ。偽プレイヤーを 64 ブロック以内に置く [要実機] |
| 近隣更新の座標 | 近隣更新器は Level の protected な欄にある。これをリフレクションで読み (書き換えない)、CollectingNeighborUpdater#setDebugListener に受け手を渡す。ServerLevel#tick の最後に、購読者がいなければ外されるので、毎 tick の呼び出しで付け直す | いいえ (読むだけのリフレクション) | 座標だけ。実行の直前に報告する。6 方向の更新は、覗かれるたびに残りでなく全方向を報告するので重複する |
| 〃 (別の取り方) | 世界に入れた偽プレイヤーを op にし、NEIGHBOR_UPDATES のデバッグ購読を頼む (ServerPlayer#requestDebugSubscriptions)。ServerLevel 自身が受け手を付け、そのチャンクを見ているプレイヤーの接続へ座標を送る | はい | 上と同じ中身。偽プレイヤーがそのチャンクを見ている必要がある [要実機] |
| 近隣更新の種別 | Level の近隣更新器の欄を、記録つきの子クラスに差し替える。CollectingNeighborUpdater は public で、final ではない | いいえ (final の欄の書き換え) | NC・SU・6 方向の別、座標、送り元、除いた方向。積んだ順 |
| ログ | 連鎖の上限を超えたときの「最初に捨てた座標」の行など | はい | 更新抑制 (12) の観測点 |
| エンティティ | 範囲のエンティティを読む | はい | トロッコなど |

- Java agent でメソッドを書き換えれば、任意の点で撮れる。だがそれは Mod と同じことなので採らない。
- 差し替えを使うときは、差し替えなしで撮った expect と完全に一致することを毎回確かめる。

### 4.4 入力の再現

| action | (c) での入口 | 今のハーネスとの違い |
|---|---|---|
| use | 偽の ServerPlayer を作り、当たりの位置と面を明示して ServerPlayerGameMode#useItemOn を呼ぶ。パケット処理 (ServerGamePacketListenerImpl#handleUseItemOn) が範囲の確認の後に呼ぶのと同じメソッドである | 視線の計算が無い。狙点・遮蔽・落下・spawn の失敗が消える。GameTestHelper#pressButton と #pullLever は通常の使用の確認を飛ばすので使わない |
| setblock・summon・kill・item・tp | vanilla のコマンド文字列を、プロセス内のコマンドの入口 (Commands#performPrefixedCommand) で実行する | rcon と同じコマンドの処理を通る。待ち時間が無い |
| lectern | 書見台の BlockEntity からメニューを作り、ページ指定のボタン (100 + ページ) を押す (LecternMenu#clickMenuButton) | 本物のページめくりの経路を通る (ページを変えて LecternBlock#signalPageChange)。今は /data modify + update の近似 |
| container | item に写す (/item replace と同じ) | 同じ |
| step (感圧板) | 板の上にエンティティを置き、次の tick のエンティティ相で踏ませる | 要設計。今の tp で踏む方式も generate.ts に [未検証] とある |
| 見えない状態の注入 (scheduled・comparators・cooldowns) | 予約は ScheduledTickAccess#scheduleTick (遅延と優先度を取る形)。出力とクールダウンは BlockEntity の NBT を読み込ませる | **今のハーネスは予約を実機へ入れられない**。定義の無い 16 本のうち予約を持つ 2 本 (elevator-observer-min・observer-dropper-conductor) も、自分の authored から撮り直せる |

### 4.5 落とし穴 [26.3 読解]

| 落とし穴 | 理由 | 対処 |
|---|---|---|
| ローダーの登録が遅いと、テスト関数が無い | 組み込みレジストリの初期化で 1 回だけ回る | main の先頭で登録する。Blocks などに触れて初期化を先に起こさない |
| 同じ tick の処理の順が毎回変わる | runAtTickTime の登録表は Runnable を鍵にするハッシュ表で、同じ tick の登録が複数あると回る順が決まらない | 毎 tick の処理は 1 つにまとめ、その中で順を決める |
| 長い実行で登録が膨らむ | onEachTick は max_ticks まで tick ごとに 1 件登録する | thenExecuteFor (毎 tick 試す形) を使う |
| fixture の場所が tick されない | 予約 tick はチャンクが tick される状態のときだけ実行される。ワールドにチケットが無いと emptyTime が増え、300 に達するとエンティティ相と BlockEntity 相も止まる (26.3 ServerLevel#tick) | fixture のチャンクを強制読み込みにし、tick される状態になってから置く |
| 偽プレイヤーを世界に入れると回路に触れる | 世界に入れた ServerPlayer は接続の tick で動き、落ち、感圧板やトリップワイヤーを踏みうる | 世界に入れるのは観測 (§4.3 の別の取り方) が要るときだけにし、回路の外の足場に置く |
| テストの位置が乱数 | GameTestServer#startTests が ±14,999,992 から選ぶ | 回路はテストの構造物に置かず、fixture の絶対座標に置く。ダストの HashSet 順は絶対座標に依存する (09) |
| 既定のゲームルール | GameTestServer は既定値で起動する | テスト環境で止める (§4.1) |
| gameTime の位相 | 日照センサーは gameTime が 20 の倍数の tick だけ更新する (26.3 DaylightDetectorBlock) | 開始時の gameTime を記録する。要るなら 20 の倍数にそろえる |
| 乱数 | ワールドの乱数は起動ごとに種が違う | 乱数を引く部品 (ディスペンサーのスロット選び) は、種を固定するか避ける |
| 版ごとの API の揺れ | 26.2 → 26.3 で TestFunctionLoader が抽象クラスからインターフェースに変わった。26.4-pre-1 では runLoaders の引数の型が変わる。GameTestServer の世界は 26.2 の FLAT から 26.3 の FLAT_ALL_DIMENSIONS に変わった | 起動コードは版ごとに小さく直す前提にする。版を上げるたびに基準の fixture 1 本で確かめる |
| final の欄の書き換え | Java 26 の JEP 500 で警告になり、将来は例外になる | 26.3 は Java 25 なので今は通る。差し替えは任意の機能にし、読むだけで済む所は読むだけにする |
| 人が入れない | GameTestServer は待ち受けを開かない | ライブ観測とクライアント接続は (a) に残す |
| EULA | GameTestServer の経路は eula.txt を読まないが、EULA 自体は適用される | 起動スクリプトは明示の同意 (環境変数) が無いと止まる作りにする。今の compose の EULA TRUE と同じ扱い |

### 4.6 評価

- 良い点
  - ゲームのコードを書き換えない
  - 待ちが無く速い
  - 予約の順まで撮れる
  - 入力がサーバ側の本物の入口に入る
  - 見えない状態を注入できる
  - 掃除が確実である。キューを直接消せるうえ、起動のたびに新しいワールドになる
- 悪い点
  - 作る手間がかかる。Java の起動コード・データパック・TS の写し
  - 版ごとに API が揺れる
  - 人が入って見られない
- 残る汚れ: 専用サーバとの違い (機能フラグ trade_rebalance・平坦の地形・プレイヤーがいない) と、自前の入力の写し方。回路には効かない見込み [推定] だが、(a) との照合 (§6) で確かめる

---

## 5. 比較

| 観点 | (a) carpet を 26.3 へ | (b) vanilla のみ | (c) 自前の起動コード |
|---|---|---|---|
| 正解の汚れにくさ | Fabric + carpet の Mixin が入る。ルールは既定 | 最も少ない。専用サーバそのまま | ゲームは無改変。GameTestServer と専用サーバの違いと、自前の入力の写しが残る |
| 速さ (134 本) | 今と同じ。sleep の合計だけで約 16 分。rcon は 1 命令ごとに docker exec を起こし、1 tick で 2 回撃つので、全体は 30 分を超える見込み [推定] | (a) より遅い。毎 tick 保存する [推定] | 起動に 10〜20 秒 + 全 fixture で 1 分以内 [推定] |
| 最小化の 1 回の試行 | 数秒〜25 秒 (README) | 同程度以上 | 常駐させれば 1 秒未満 [推定] |
| 自動化と CI | docker の image + jar + Mod を取る。EULA は compose の環境変数。sleep の揺れで不安定 | docker + jar。EULA は同じ | Java 25 と jar の取得だけ。spec-drift.yml が既に毎週 jar を取っている。eula.txt を見ないので、同意は起動スクリプトの環境変数で明示する |
| tick 内の順 | TIS の microTiming (26.3 版あり)。チャット限定で手作業 | 取れない | 予約キュー (予約順まで)・ブロックイベント・近隣更新 (§4.3) |
| 入力の再現 | carpet の偽プレイヤー。視線の計算・落下・spawn の失敗の罠がある | use が作れない | サーバ側の入口へ直接入れる。罠が無い。書見台も本物の経路 |
| 見えない状態 | 読める (保存データ)。注入はできない | 読める。注入はできない | 直接読める (予約順まで)。注入もできる |
| 134 本の撮り直し | 設定を直して --all。版差の仕分けが要る | use の 184 件を写せない | 起動コードを作ってから --all。定義の無い 16 本も撮れる |
| 作る手間 | S | M (それでも use は無い) | M〜L |
| リスク | carpet と TIS の追随 (26.3 では carpet が同日、TIS が翌日)。Mixin の汚れ | 入力の欠落 | 内部 API の揺れ・リフレクション・写経にしない注意 |
| 人が見る | クライアントで入れる | 入れる | 入れない |

---

## 6. 推奨と実装の手順

### 6.1 推奨

1. (c) を 26.3 の主オラクルにする。
2. (a) を 26.3 へ上げ、照合相手と人の観察に使う。
   - (c) と (a) で同じ fixture を撮り、一致を確かめる
   - **独立した 2 つの採取系が一致すれば、どちらかの採取の汚れを見落とす心配が減る**
3. 1.21.1 のハーネスと fixture は凍結して残す。TS の sim の回帰に使い続ける。
4. (c) の速さを使って、実回路の不足を補う。
   - docs/vanilla の各メモ §8 のプローブ回路を定義に起こし、(c) で撮る。tick 内の順が要る [要実機] の項目は、ここで決着させる
   - 小さな回路を機械的に作り、(c) と Rust エンジンの両方で回して、食い違いだけを残す (差分ファジング)
   - 回路の入手先と置き場所は 17_circuit-corpus.md に従う。出所の扱いは 16 §5 に従う

### 6.2 issue の粒度

| # | タイトル (案) | 内容 | 受け入れ基準 | 規模 | 依存 |
|---|---|---|---|---|---|
| O1 | 26.3 オラクルの土台 | jar の取得と展開、起動コードの雛形、データパックの生成、1 本の fixture の採取、EULA の同意の環境変数、gitignore。置き場は tools/gt-oracle/ (仮) | lever-wire-lamp を撮り、1.21.1 の expect と比べた結果が出る。Mojang 由来のファイルがコミットされない。所要を実測し、§5 の推定を置き換える | M | — |
| O2 | 入力・設置・settle の写し | §4.4 の action を全部写す。掃除・強制読み込み・settle 照合 | 定義 134 本が最後まで走る。settle 照合の失敗は座標つきで報告される | M | O1 |
| O3 | 26.3 の fixture 一式と仕分け | 134 本を撮って版別の置き場に置く。1.21.1 との差分を「版差・採取系・不明」に分ける (§8) | 変わった fixture ごとに理由 (docs/vanilla の版差の節か issue) が書いてある | M | O2 |
| O4 | 見えない状態の記録と注入 | 毎 tick の予約キュー (優先度・予約順)・コンパレーターの出力・クールダウン・コンテナ。trustAuthored 系の注入 | 定義の無い 16 本を、自分の authored から撮り直せる | S〜M | O2 |
| O5 | tick 内の順の記録 | ブロックイベントの実行順、近隣更新の座標列、連鎖上限のログ。08 記法の .trace に書く | 09_snapshots の 2 例 (network-piston-order・two-piston-locational) と同じ順が出る | M | O2 |
| O6 | (a) を 26.3 へ | §2.2 の変更。README・04・06・09 の前提を直す | 20 本程度で (a) と (c) の expect が一致する。食い違いは原因を記録する | S〜M | O2 と並行 |
| O7 | 常駐モード | テスト関数の中で次の指示を待つ形にし、capture・minimize・MCP の後ろに (c) を置く。待っている間はサーバのスレッドが止まるので、1 tick ずつの操作ができる | minimize の 1 回の試行が 1 秒未満 | M | O4 |
| O8 | CI | workflow_dispatch と週次。最新の 26.x で撮り、差分を報告する | fork の PR では動かない。jar をキャッシュしない。EULA の同意を workflow に明記する | S | O3 |
| O9 | 衛生と文書 | tools/ip-hygiene.test.ts の SCAN_EXT に .java を足す (コメント行だけを見る規則はそのまま)。CONTRIBUTING の典拠の版、04 §4 の 1、06 §4 を直す | CI の衛生テストが .java のコメントも見る | S | O1 と同時 |
| O10 | 差分ファジング | 小さな回路を生成し、(c) と Rust エンジンで比べる | 食い違いが自動で最小化され、fixture になる | M〜L | O7・Rust エンジン |
| O11 | プローブ回路の採取 | docs/vanilla の各メモ §8 の回路を定義に起こし、(c) で撮る | 各メモの [要実機] に、fixture 名つきの答えが書ける | M | O5 |

---

## 7. 既存の fixture 形式との互換

### 7.1 欄の対応 (packages/sim/src/fixture-driver.ts の Fixture)

| 欄 | 1.21.1 (今) | 26.3 (c) | 備考 |
|---|---|---|---|
| name・description・ticks・region・blocks・inputs | 定義から写す | 同じ定義から写す | 定義 (tools/mc-harness/fixtures) は両方で共有する |
| mcVersion | "1.21.1" | "26.3" | — |
| expect | 変化のあった tick の差分。書く形 (名前空間なし・プロパティキー昇順・材質を畳まない) | 同じ形 | 比べる形 (mcstate.ts の canonicalize) も同じ |
| generated | at・mc・carpet | at・mc・carpet ("none")・oracle (採取系の名前と起動コードのコミット) | Fixture 型に oracle を任意の欄で足す |
| trustAuthored・scheduled・comparators・cooldowns | 保存データから読む | 直接読む。scheduled に予約順を足せる | 足す欄は任意。今の runner は読まない |
| skipUntil・skipReason | 定義と生成済みで同じ | 版別に持つ | fixtures.test.ts の「定義と同じ」検査を版別に分ける |

- region は今、観測範囲であると同時に掃除の範囲である (README「掃除と残骸」)。(c) では掃除をキューごと確実に行うので、範囲の外の残骸の問題 (#157・#240) は起きない。

### 7.2 追加する任意の欄 (案)

| 欄 | 中身 | 使い道 |
|---|---|---|
| queue | tick ごとの予約の一覧 (座標・ブロック・残り遅延・優先度・予約順) | 「世界は一致しているのに予約だけ違う」を 1 tick 早く見つける (16 §4.3) |
| blockEvents | tick ごとの実行の列 (座標・ブロック・2 つの引数) | ピストンの取り合い |
| updates | tick ごとの近隣更新の座標の列 | locational な回路 |
| log | tick ごとのサーバログの行 | 連鎖の上限 (12) |
| startGameTime | 開始時の gameTime | 20 tick 周期の部品 |

今の runner は知らない欄を無視する。Rust エンジンの適合テストも、同じ JSON を読む形にする。

### 7.3 08 記法への写し方

| オラクルの観測 | 08 の要素 | 注意 |
|---|---|---|
| キューに新しく現れた予約 | 丸括弧の予約 (例: `Re(n.2)`) | 動作 (n・f・c) は、その座標の状態の変化から決める |
| 発火 tick に消えた予約 | `[ST]` 行の波括弧の実行 (例: `Re{n}`) | 発火時にブロックが替わっていて捨てられたものは、座標の種類で見分ける |
| ブロックイベントの実行 | `[BE]` 行 | 失敗は `-` |
| 近隣更新の座標 | verbose の `bu` | 種別は差し替え (§4.3) を使ったときだけわかる。そのとき SU を `su` に分けられる |
| 入力 | `[PI]` 行 | — |

### 7.4 置き場所と版

- 1.21.1 の生成済み (packages/sim/test/fixtures) はそのまま残す。TS の sim は今の典拠 1.21.1 で回帰を続ける。
- 26.3 の生成済みは、版名のフォルダに分けて置く。場所は O3 で決める。TS の sim と Rust エンジンの両方から読める所にする。
- 定義は 1 本を共有する。版で入力を変えたいもの (例: setblock の後始末の違いに合わせる) は、版別の上書きを持たせる。

---

## 8. 撮り直しで変わると予想される所

| 版差 | 1.21.1 | 26.3 | 影響しうる fixture | 典拠 |
|---|---|---|---|---|
| /setblock の後始末 | 撤去 (onRemove) → 設置 → 形状更新 → 6 方向の NC | 設置 → 形状更新 → 撤去フック → NC → CU (アナログ出力があれば) | setblock 入力 177 件のうち、部品を消す・置き換えるもの | docs/vanilla/04_set-block-and-updates.md §6.3 |
| トーチの LIT の切り替え | 撤去フックと設置フックで、2 段の送信を 2 回 | 1 回 | トーチを含む回路で、1 巡目に予約を積む部品があるもの | 16 §3.4、docs/vanilla/04_set-block-and-updates.md §6.2 |
| ピストンが壊すブロックの撤去 | 壊した瞬間 | moving_piston を置いた後、近隣更新のループの中 | destroy-push-dust・destroy-push-torch など | 16 §3.4 |
| フラグ 1 の無い書き込みでの撤去 | ダイオードは書き込みの中で前方へ更新を出す | 書き込みの中では出さない。/setblock は後始末で撤去フックを呼ぶが、strict は呼ばない | ダイオードを /setblock (strict を含む) で消す fixture | docs/vanilla/07_diodes.md §4.13・§6、docs/vanilla/04_set-block-and-updates.md §6.3 |
| 鎖の ID | chain | iron_chain | fixture には出ない | 16 §3.4 |

仕分けの手順 (O3):

1. 1.21.1 と 26.3 の expect の差分を、fixture ごとに出す
2. 上の表の版差で説明できるものは「版差」とし、典拠の節を書く
3. 説明できないものは、(a) の 26.3 版でも撮る
   - (a) と (c) が一致すれば、まだ知らない版差である
   - 食い違えば、どちらかの採取系の問題である
4. sim の版フラグで 26.3 の挙動に合わせるのは、その後にする

---

## 9. 未確定・要実機

- (c) の起動時間と 1 tick の所要。§5 の数字は推定である
- carpet 26.3 の without_updates と update の意味 (§2.2)
- itzg の TYPE FABRIC が 26.3 で "Done" まで起動するか
- TIS の microTiming の出力が、26.3 版でもチャット限定か (06 §2.3 は 1.21.1 の実測)
- 偽の ServerPlayer で ServerPlayerGameMode#useItemOn を呼んだとき、進捗 (criteria) の処理が落ちないか。落ちるなら GameTestHelper#useBlock と同じ範囲 (BlockState#useItemOn → useWithoutItem) に絞る
- 感圧板 (step) の入れ方
- パケットでブロックイベントの順を撮る方法で、同じ tick の全部を拾えるか (成功したものだけ・範囲 64 ブロック)
- GameTestServer と専用サーバの違いが回路に効かないこと。O6 の照合で確かめる

---

## 出典

### 読んだもの (26.3 のデコンパイル。版差の確認に 1.21.1・26.2・26.4-pre-1)

- gametest: Main・GameTestMainUtil・GameTestServer・GameTestRunner・GameTestTicker・GameTestInfo・GameTestHelper・GameTestSequence・GameTestBatchFactory・StructureGridSpawner・StructureUtils・TestCommand・TestData・GameTestInstance・FunctionGameTestInstance・BlockBasedTestInstance・TestEnvironmentDefinition・TestFunctionLoader・BuiltinTestFunctions・GameTestInstances・GameTestEnvironments
- ブロックと BlockEntity: TestBlock・TestBlockEntity・TestInstanceBlockEntity・StructureBlockEntity・LeverBlock・ButtonBlock・LecternBlock・LecternBlockEntity・DaylightDetectorBlock・Blocks・BlockItemIds・BlockStateProperties
- tick とキュー: MinecraftServer (runServer・tickServer・tickChildren・waitUntilNextTick・pauseWhenEmptySeconds・getMaxChainedNeighborUpdates)・ServerLevel (tick・runBlockEvents・clearBlockEvents・setChunkForced)・Level (tickBlockEntities)・TickRateManager・ServerTickRateManager・LevelTicks・LevelChunkTicks・ScheduledTick・ScheduledTickAccess・SavedTick・CollectingNeighborUpdater・NeighborUpdater・ServerDebugSubscribers・DebugSubscriptions
- コマンドとサーバ: Commands・SetBlockCommand・PlaceCommand・FillCommand・TickCommand・SwingCommand・ServerPlayerGameMode・LecternMenu・server.Main・DedicatedServer・DedicatedServerProperties・GameRules・GameRuleRegistryFix・FeatureFlags・FlatLevelGeneratorSettings・PackFormat・StructureTemplateManager
- 同梱のデータ: version.json (26.3・26.2・26.4-pre-1)、vanilla のデータパックの test_instance と test_environment

### リポジトリ

- tools/mc-harness/README.md・docker-compose.yml・runner/generate.ts・runner/world-setup.ts・runner/rcon.ts・runner/scheduled-ticks.ts・runner/state-to-nbt.ts・runner/capture.ts・scripts/dump.sc
- packages/sim/src/fixture-driver.ts・packages/sim/test/fixtures.test.ts・packages/sim/test/fixtures/*.json・tools/mc-harness/fixtures/*.json
- tools/ip-hygiene.test.ts・tools/decompile/fetch-and-decompile.sh・tools/decompile/spec-drift.sh・.github/workflows/spec-drift.yml・CONTRIBUTING.md
- docs/ip-policy.md・docs/research/03・04・06・08・09・16・17
- docs/vanilla/01_tick-loop.md・02_scheduled-ticks.md・04_set-block-and-updates.md・07_diodes.md

### URL (2026-11-26 参照)

- Modrinth API: https://api.modrinth.com/v2/project/carpet/version ・ https://api.modrinth.com/v2/project/carpet ・ https://api.modrinth.com/v2/project/carpet-tis-addition/version ・ https://api.modrinth.com/v2/project/fabric-api/version
- Fabric meta: https://meta.fabricmc.net/v2/versions/game ・ https://meta.fabricmc.net/v2/versions/loader/26.3
- fabric-carpet のリリース: https://github.com/gnembon/fabric-carpet/releases/tag/v26.3 ・ https://github.com/gnembon/fabric-carpet/releases
- scarpet の文書: https://github.com/gnembon/fabric-carpet/blob/master/docs/scarpet/api/BlocksAndWorldAccess.md
- Carpet TIS Addition の logger: https://carpet.tis.world/docs/loggers
- itzg の Java の image: https://docker-minecraft-server.readthedocs.io/en/latest/versions/java/
- itzg の server.properties の写し: https://docker-minecraft-server.readthedocs.io/en/latest/configuration/server-properties/
- GameTest (wiki): https://minecraft.wiki/w/GameTest
- mineflayer (対応版): https://github.com/PrismarineJS/mineflayer
- Nucleation の tools/gametest: https://github.com/Schem-at/Nucleation/tree/master/tools/gametest
- Mojang の version manifest: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
- 難読化の廃止: https://www.minecraft.net/en-us/article/removing-obfuscation-in-java-edition ・ https://fabricmc.net/2025/10/31/obfuscation.html
- Minecraft EULA: https://aka.ms/MinecraftEULA
- JEP 500: https://openjdk.org/jeps/500
