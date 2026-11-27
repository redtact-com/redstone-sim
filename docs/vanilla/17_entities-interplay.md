# 17. エンティティとの境界 (検知・TNT・アイテム・トロッコ・投射物)

Java 版 26.3 で、レッドストーンの部品がエンティティに何を問い合わせるか、エンティティがいつ・どの順でブロックに作用するかをまとめる。
Rust エンジンに「エンティティをどこまで持ち込むか」を段階的に決めるための資料である。

確かさの表記は次のとおり。

- [26.3 読解] コードを読んで確かめた
- [実機 1.21.1: fixture 名] 既存の実機 fixture が裏づける
- [要実機] 読んだだけでは決まらない。実機で測る
- [版差 1.21.1] [版差 26.2] [版差 26.4-pre-1] 版で違う

---

## 1. 対象と範囲

### 1.1 読んだクラス (26.3)

メソッドは §10 に挙げる。

| 分野 | クラス |
|---|---|
| エンティティ相と表 | ServerLevel・EntityTickList・PersistentEntitySectionManager・TickRateManager |
| 範囲の問い合わせ | Level・EntityGetter・EntitySectionStorage・EntitySection・ClassInstanceMultiMap・LevelEntityGetterAdapter・SectionPos・EntitySelector・AABB |
| 移動とブロックへの作用 | Entity・EntityDimensions・LivingEntity (aiStep の末尾)・BlockGetter・BlockPos・Direction・InsideBlockEffectApplier・InsideBlockEffectType |
| 流体と泡柱 | Entity (updateFluidInteraction・泡柱の 2 つの処理)・EntityFluidInteraction・BubbleColumnBlock#entityInside |
| プレイヤー | ServerGamePacketListenerImpl・ServerPlayer |
| アイテム | ItemEntity・ExperienceOrb・Block (popResource・dropResources)・DefaultDispenseItemBehavior・LootTable と LootContext (ドロップの乱数の源) |
| TNT と爆発 | PrimedTnt・TntBlock・ServerExplosion・Explosion (BlockInteraction)・ExplosionDamageCalculator・EntityBasedExplosionDamageCalculator・BlockBehaviour (既定の onExplosionHit)・WindCharge・GameRules |
| 落下ブロック | FallingBlockEntity・FallingBlock |
| トロッコ | AbstractMinecart・OldMinecartBehavior・MinecartTNT・MinecartHopper・MinecartCommandBlock・Minecart (NewMinecartBehavior は概要だけ) |
| 投射物 | Projectile・ThrowableProjectile・AbstractArrow・ThrownTrident・ProjectileDispenseBehavior・ProjectileItem |
| 検知するブロック (エンティティ側だけ) | BasePressurePlateBlock・PressurePlateBlock・WeightedPressurePlateBlock・BlockSetType・TripWireBlock・ButtonBlock・DetectorRailBlock・TargetBlock |
| コンテナ | HopperBlock・HopperBlockEntity・Hopper・DropperBlock・ContainerOpenersCounter |
| 額縁 | ComparatorBlock (getItemFrame)・ItemFrame・BlockAttachedEntity |
| その他 | LightningBolt・PistonMovingBlockEntity (エンティティを動かす所)・SulfurCube・SignalGetter・SlimeBlock・LayeredCauldronBlock・RedStoneOreBlock・SculkSensorBlock・BigDripleafBlock・FarmlandBlock・TurtleEggBlock・AmethystBlock |

### 1.2 扱わない隣接範囲

| 範囲 | 参照先 |
|---|---|
| 相の並び・凍結・エンティティが tick されるチャンクの条件 | → 01_tick-loop.md |
| 予約 tick の並べ方・遅延 0 の扱い | → 02_scheduled-ticks.md |
| setBlock のフラグ・近隣更新・コンパレーター更新の配り方 | → 04_set-block-and-updates.md |
| 額縁を読むコンパレーターの比較 | → 07_diodes.md |
| 感圧板・トリップワイヤー・ボタン・ターゲット・避雷針・トラップチェストの出力と更新先 | → 09_manual-inputs.md |
| 振動 (GameEvent) の伝わり方 | → 10_sculk.md |
| 大きなドリップリーフ・ベル・ろうそく・硫黄のブロック側 (噴出の出口と柱の高さを含む) | → 11_outputs.md |
| ディスペンサー・ドロッパーの射出の決め方 | → 12_dispenser-dropper-crafter.md |
| ピストンの押し構造と、エンティティを押す時機 | → 13_pistons.md |
| ホッパーの転送規則・クールダウン・アナログ値 | → 14_containers-hoppers-analog.md |
| レールの形と動力 | → 15_rails.md |
| 流体・泡柱・落下ブロックのブロック側 | → 16_fluids-falling-blocks.md |
| 乱数源の実装・HashSet の反復順 | → 18_determinism-java-semantics.md |
| 版差の総まとめ | → 19_version-diffs.md |

---

## 2. 全体像

### 2.1 エンティティに依存するレッドストーンの仕組み

箱はブロックの位置からの相対座標 (1 マス = 1.0)。[26.3 読解]

| # | 仕組み | 見るエンティティ | 問い合わせの箱 | 問い合わせる契機 | 結果 |
|---|---|---|---|---|---|
| E1 | 木の感圧板 (木材・竹・桜・真紅・歪み・ポプラ) | Entity 全般 | 横 1/16〜15/16、高さ 0〜4/16 | 出力 0 で entityInside を受けた時・予約 tick (20) | 0 か 15 |
| E2 | 石・磨かれたブラックストーンの感圧板 | LivingEntity | 同上 | 同上 | 0 か 15 |
| E3 | 重量感圧板 (金は上限 15・鉄は上限 150) | Entity 全般の**体数** | 同上 | 出力 0 で entityInside・予約 tick (10) | 体数から 1〜15 |
| E4 | トリップワイヤー | entityInside は入った本人。再判定は Entity 全般 | 糸の形の外接箱。ATTACHED なら高さ 1/16〜2.5/16、でなければ 0〜8/16。横は全面 | 未 POWERED かつ予約なしで entityInside・予約 tick (10) | POWERED |
| E5 | 木のボタン (矢フラグが真の型) | AbstractArrow (矢・光の矢・トライデント) の先頭 1 体 | ボタンの今の形の外接箱 | 未押下で entityInside・予約 tick (30) | POWERED |
| E6 | ディテクターレール | AbstractMinecart | 横 0.2〜0.8、高さ 0〜0.8 | 未 POWERED で entityInside (**誰が入っても起動**)・予約 tick (20)・onPlace | POWERED と、毎回のコンパレーター更新 |
| E7 | ディテクターレールのアナログ値 | コマンドブロック付きトロッコ、無ければコンテナを持つトロッコの先頭 | E6 と同じ | コンパレーターが読む時 (POWERED のときだけ) | 成功回数 / 中身の値 / 0 |
| E8 | ターゲット | 当たった投射物 | 命中点 | 投射物の tick の中の命中 | 1〜15。AbstractArrow なら 20 tick、他は 8 tick |
| E9 | ホッパーの吸い込み | 生きている ItemEntity | 横は全面、高さ 11/16〜2 | BlockEntity 相の吸い込み・アイテムの entityInside | 中身 |
| E10 | ホッパー・ドロッパー・ホッパー付きトロッコの転送相手 | Container を持つ生きたエンティティ | 相手マスの中心 ±0.5 (ホッパー付きトロッコの上の相手は、自分の位置 + 1.5 を中心に ±0.5) | 相手マスにブロックのコンテナが無い時 | **Level の乱数で 1 体選ぶ** |
| E11 | 導体越しのコンパレーターと額縁 | 向きが FACING と同じ ItemFrame | 2 マス先の 1×1×1 | コンパレーターが入力を計算する時 | ちょうど 1 体なら 0〜8 |
| E12 | トラップチェストほかの開閉人数 | ContainerUser (プレイヤー・銅ゴーレム) | 自マスを (操作距離の最大 + 4) 膨らませた箱 | 開閉の直後・予約 tick (5) | 人数 |
| E13 | 避雷針 | LightningBolt | 雷の足元のマス | 雷の最初の tick | 通電 (→ 09) |
| E14 | アクティベーターレール | 上のトロッコ | トロッコのマス | トロッコの tick ごと | TNT 点火・ホッパー停止・コマンド実行・乗員を降ろす |
| E15 | 硫黄キューブ (26.x の生き物) | 自分が信号を読む | 自分のブロック座標 | 自分の tick の最初 | 点火 (導火線 120) |
| E16 | stepOn・fallOn を持つブロック | 乗った・落ちたエンティティ | 足元のマス | エンティティの移動 | レッドストーン鉱石の点灯・耕地の踏みつけなど。オブザーバーが拾う |
| E17 | 水入り大釜 | 燃えているエンティティ | 水面の形 | entityInside | 水位 −1 (コンパレーター値が変わる) |
| E18 | スカルクセンサー | エンティティが出す GameEvent | → 10 | 移動・着地・命中・点火ほか | 振動 |
| E19 | 大きなドリップリーフ (葉) | 入ってきた本人。接地していて、足の高さが葉のマスの y + 0.6875F より上 | 葉のマス (既定の 1 マス全体) | 傾きが none で、その時点で無受電のとき entityInside | 傾きを unstable にし 10 tick 後を予約 (→ 11)。投射物の命中は受電を見ずにいきなり full (100 tick) |

共通の除外: 観戦者と、isIgnoringBlockTriggers が真のエンティティ (マーカーの防具立て・コウモリ・Marker・Display・Interaction・OminousItemSpawner) は E1〜E4 に数えない。
この除外は感圧板とトリップワイヤーだけが使う。ボタン・レール・ホッパー・額縁は使わない。[26.3 読解: BasePressurePlateBlock#getEntityCount, TripWireBlock#checkPressed]

### 2.2 エンティティ相の 1 周

[26.3 読解: ServerLevel#tick, EntityTickList#forEach, ServerLevel#tickNonPassenger, #tickPassenger]

1. L12 の入口で EntityTickList を走査する。順は**表に入った順**である。表に入るのは、entity ticking のチャンクで世界に加わった時か、チャンクが entity ticking になった時 (onTickingStart)。
2. 1 体ごとに次を行う。
   1. 除去済みなら飛ばす。
   2. 凍結中なら飛ばす (プレイヤーと、プレイヤーを乗せたものは除く)。
   3. checkDespawn。
   4. プレイヤーか、entity ticking のチャンクにいるときだけ先へ進む (→ 01)。
   5. 乗り物に乗っていれば飛ばす (乗り物の側で tick される)。
   6. tickNonPassenger。
3. tickNonPassenger は commonTick (無敵時間 −1・古い位置と向きの保存・tickCount +1) → 種類ごとの tick → 乗員を乗った順に tickPassenger (commonTick → rideTick → その乗員) の順。プレイヤーの乗員は、先頭がプレイヤーでなければ先頭に入る。[26.3 読解: Entity#addPassenger]
4. 走査中に加わったエンティティは表の複製に入る。**その tick には tick されない**。走査中に除去されたものは、順番が来た時に除去済みとして飛ばされる。
5. 表の中の順が変わるのは、除去して入れ直した時だけである。entity ticking のチャンクから外れて戻ると末尾へ回る。entity ticking のチャンク同士を移っても順は変わらない。[26.3 読解: PersistentEntitySectionManager の Callback#updateStatus]

### 2.3 エンティティ由来の作用が入る位相

| 位相 (→ 01) | エンティティが関わること |
|---|---|
| 区間 A (パケット) | 投射物を作る (弓・雪玉)・火打石で TNT を点ける・額縁に入れる・回す。プレイヤーの移動は記録され、**fallOn と HIT_GROUND (doCheckFallDamage) と STEP の GameEvent はここで起きる**。entityInside・stepOn は B5 まで待つ |
| L6 予約 tick | エンティティを作る (ディスペンサー・ドロッパーの射出、落下ブロック、信号で点いた TNT)。感圧板・トリップワイヤー・ボタン・ディテクターレール・開閉人数の再判定 (範囲の問い合わせ) |
| L9 チャンク | 雷を作る |
| L10 ブロックイベント | ピストンが壊したブロックのドロップ (ItemEntity) を作る |
| L12 エンティティ相 | 移動 → stepOn・entityInside・fallOn。投射物の命中 (ターゲット・TNT・ベル・大きなドリップリーフ)。TNT の爆発。落下ブロックの着地。雷の通電。アクティベーターレール。アイテムの合体。硫黄キューブの信号読み |
| L13 BlockEntity 相 | ホッパーの吸い込み・エンティティのコンテナとの転送。moving_piston がエンティティを押す (押した先で entityInside が走る)。噴出中の硫黄 (PotentSulfurBlock の BE) が柱の中のエンティティに上向き 0.2 を足す (条件は → 11 §4.10) |
| B5 接続 | プレイヤーのブロックへの作用 (doTick → aiStep → applyEffectsFromBlocks)。感圧板・トリップワイヤーを踏む・stepOn。fallOn はここではない (区間 A) |
| 区間 C | /summon・/kill・/tp |

区間 A〜L10 で作られたエンティティは、その tick の L12 で最初の tick を受ける。
L12 の中・L13・B5・区間 C で作られたものは、次の tick の L12 が最初になる。[26.3 読解]

### 2.4 遅延の数え方の例

| 出来事 | 起点 | 最初の tick | 結果 | 確かさ |
|---|---|---|---|---|
| tick N の区間 A〜L10 で TNT を点ける (L6 のリピーター・オブザーバーなど) | tick N | N の L12 (導火線 80 → 79) | N+79 の L12 で爆発 | [26.3 読解] [要実機] |
| tick N の L12 より後 (L13 の着地・B5・区間 C) で点ける | tick N | N+1 | N+80 で爆発 | [26.3 読解] [要実機] |
| ハーネスの入力 t (凍結境界) で点ける | t の後の境界 | t+1 の L12 | t+80 で爆発 | [26.3 読解] [要実機] |
| 爆発に巻き込まれた TNT ブロック | 爆発 (L12、tick N) | N+1 | 導火線 f は 10〜29 (Level の乱数)。N+f の L12 で爆発 | [26.3 読解] |
| 落下ブロック | 形状更新か設置で遅延 2 を予約 (その時の gameTime を G) | G+2 の L6 でエンティティになり、同じ tick の L12 で落ち始める | 着地の tick は落下の式で決まる | [26.3 読解] |
| トロッコがディテクターレールに入る | 凍結境界で召喚 (t2) | t3 の L12 | t3 で POWERED、t23 の再判定で OFF | [実機 1.21.1: detector-rail-cart-pulse] |
| ディスペンサーの矢 | 遅延 4 の予約が L6 で発火した tick M に射出 | M の L12 | 1 マス空けた的なら M に命中。ターゲットは M+20 の L6 で消える。的がディスペンサーに接していると命中しない (§5 の 23) | [26.3 読解] [要実機] |
| ドロッパーがワールドへ出したアイテム | L6 (tick N) | N の L12 | 箱に入っていれば N の L13 でホッパーが吸う | [26.3 読解] |
| プレイヤー (fake player) が感圧板へ tp | 凍結境界 (t2) | 凍結中もプレイヤーは毎周 tick される | t2 で POWERED、t22 で OFF | [実機 1.21.1: pressure-plate-wood] |

---

## 3. 状態とデータ

### 3.1 全エンティティが持つ値

| 値 | 中身 | レッドストーンへの効き |
|---|---|---|
| id | ServerLevel の静的な通し番号。使用中の番号は飛ばす。全ディメンションで共有 | 静止したアイテムが動く tick の位相 (§4.12)。実行ごとに変わる |
| 位置・古い位置・deltaMovement | double。保存データ (Motion) を読むときは、絶対値が 10 を超える成分を 0 にする | 全部 |
| 当たり箱 | 幅 w・高さ h。横は位置 ±(w/2)、縦は位置から位置 + h。w/2 は float で計算してから double に広げる | 検知のすべて |
| onGround・衝突のフラグ・mainSupportingBlockPos | move で決まる | stepOn の対象・摩擦・跳ね返り |
| fallDistance | 26.x は double | fallOn |
| tickCount | commonTick で +1 | アイテムの合体の周期・静止中の移動の位相 |
| movementThisTick | その tick の移動の記録。最大 100 件。超えたら先頭 2 件を 1 件にまとめる | checkInsideBlocks が辿る経路 |
| finalMovementsThisTick | 直前の applyEffectsFromBlocks が使った経路 | 静止したアイテムが作用を繰り返すとき |
| pistonDeltas (3 軸)・pistonDeltasGameTime | ピストンで動いた量。game tick が変わると 0 に戻る | 1 tick 0.51 の上限 |
| random | エンティティごとの乱数。RandomSource#create で時刻から種を作る | §7.4 |
| 火・流体の状態 | 燃焼の残り tick・水と溶岩の深さ | アイテムの焼失・水流での移動 |

### 3.2 種類ごとの値

| 種類 | 値 |
|---|---|
| ItemEntity | ItemStack・age (0 から +1。6000 で消える。−32768 なら無期限)・pickupDelay (ブロックのドロップは 10、32767 は拾えない)・health 5・投げた人・持ち主 |
| PrimedTnt | fuse (初期 80。同期される)・explosionPower (既定 4。読み込みで 0〜128 に収める)・usedPortal・owner・表示用の blockState |
| FallingBlockEntity | blockState・time (0 から +1)・dropItem (既定 true)・cancelDrop・hurtEntities・落下ダメージの係数 (既定 0)・上限 (既定 40)・blockData・開始位置 |
| AbstractMinecart | onRails・flipped・behavior (既定 OldMinecartBehavior)・揺れの時間とダメージ |
| MinecartTNT | fuse (−1 = 未点火)・explosionPowerBase 4・explosionSpeedFactor 1 |
| MinecartHopper | enabled (既定 true)・consumedItemThisFrame |
| MinecartCommandBlock | lastActivated・成功回数 |
| AbstractArrow | inGround (同期)・lastState (刺さったブロック)・life・inGroundTime |
| ItemFrame | 中身・rotation (0〜7)・fixed・向き・いるマス・ticksSinceLastCheck (保存しない) |
| LightningBolt | life (初期 2)・flashes (1〜3)・visualOnly |
| SulfurCube | fuse・explosionData (爆発する種類は威力 3・火なし・導火線 120) |

### 3.3 寸法と運動の定数

[26.3 読解: EntityTypes の登録, 各 getDefaultGravity, getAirDrag, EntityDimensions#makeBoundingBox, ItemFrame#createBoundingBox, ExperienceOrb#tick]

| 種類 | 幅 × 高さ | 重力 | 毎 tick 掛ける抵抗 | 接地時 |
|---|---|---|---|---|
| ItemEntity | 0.25 × 0.25 | 0.04 | 0.98F。接地中は横だけ足元の摩擦も掛ける | 下向きの速度を −0.5 倍 |
| PrimedTnt | 0.98 × 0.98 | 0.04 | 0.98F | (0.7, −0.5, 0.7) 倍 |
| FallingBlockEntity | 0.98 × 0.98 | 0.04 | 0.98F | (0.7, −0.5, 0.7) 倍のあと着地の判定 |
| トロッコ (全種) | 0.98 × 0.7 | 0.04 (水中 0.005) | レール外の空中で 0.95F | レール外で接地なら 0.5 倍 |
| 矢・トライデント | 0.5 × 0.5 | 0.05 | 空中 0.99F。水中は矢 0.6F・トライデント 0.99F | 刺さる |
| 雪玉ほかの投げ物 | 雪玉は 0.25 × 0.25 | 0.03 (ポーション 0.05・経験値瓶 0.07) | 空中 0.99F・水中 0.8F | 当たると消える |
| 経験値オーブ | 0.5 × 0.5 | 0.03 | 0.98F。接地中は足元の摩擦も掛ける。**3 軸とも**同じ係数 | 下にぶつかり、移動前の縦の速さが重力を超えていれば、縦を (移動前の縦速度 × −0.4) にする |
| 額縁 | 登録は 0.5 × 0.5 だが、実際の当たり箱は 0.75 × 0.75 (地図入りは 1 × 1)。取り付け面の向きは厚さ 1/16。いるマスの中心から壁側へ 0.46875 寄せる | なし | — | — |
| 雷 | 0 × 0 | なし | — | — |

足元の摩擦は既定 0.6F・スライム 0.8F・氷と氷塊と薄氷 0.98F・青氷 0.989F。[26.3 読解: Blocks の登録]

### 3.4 その他の定数

| 定数 | 値 | 典拠 |
|---|---|---|
| 1 件の移動で辿るマスの段数の上限 | 16。超えたら終点の箱だけ追加で調べる | Entity#checkInsideBlocks |
| 経路の箱の縮め | 1.0E-5F | Entity#checkInsideBlocks |
| 止まっているとみなす移動 | 長さ 1.0E-5F 未満 | BlockGetter#forEachBlockIntersectedBetween |
| アイテムの合体 | マスが変わった tick は 2 tick ごと、変わらなければ 40 tick ごと。相手は自分の箱を横に 0.5 膨らませた範囲 | ItemEntity#tick, #mergeWithNeighbours |
| TNT | 導火線 80。巻き込まれたものは 10〜29。威力 4。中心は足元から高さ × 0.0625 上 (0.98F × 0.0625) | PrimedTnt, TntBlock#wasExploded |
| 爆発の光線 | 16 × 16 × 16 の立方体の表面 1352 本。1 歩 0.3F。1 歩ごとに威力 −0.22500001F。ブロックで (耐性 + 0.3F) × 0.3F を引く。初期威力は半径 × (0.7〜1.3) | ServerExplosion#calculateExplodedPositions |
| 爆発のドロップ | 同じものを 1 束 16 個までまとめる | ServerExplosion |
| 矢 | 刺さってから 1200 tick で消える | AbstractArrow#tickDespawn |
| 額縁の生存確認 | 101 tick ごと | BlockAttachedEntity#tick |
| ピストンで動く量 | 1 game tick・1 軸あたり合計 ±0.51 | Entity#limitPistonMovement |
| トロッコ (既定) | 最高速 0.4 (水中 0.2)・パワードレールの加速 0.06・未通電のパワードレールは速さ 0.03 未満で停止、それ以外 0.5 倍 | OldMinecartBehavior |
| ディスペンサーの投射物 | 威力 1.1・不確かさ 6 | ProjectileItem の既定 |

---

## 4. 処理の詳細

### 4.1 範囲の問い合わせ (Level#getEntities 系)

[26.3 読解: Level#getEntities, EntitySectionStorage#forEachAccessibleNonEmptySection, EntitySection#getEntities, ClassInstanceMultiMap, AABB#intersects]

1. エンティティは足元のブロック座標で 16 × 16 × 16 のセクションに入っている。
2. 問い合わせの箱を x と z は ±2、y は下へ 4 だけ広げて (上へは広げない)、かかるセクションを選ぶ。足元で登録しているので、背の高いものを拾うためである。
3. セクションの順は、x を小さい方から 1 列ずつ。同じ x の中はセクションの鍵 (上位から x 22 bit・z 22 bit・y 20 bit を詰めた long) の昇順になる。つまり z が外側、y が内側である。z と y は符号なしの並びなので、**0 以上が先で負が後**である (z = −1 のセクションは z = 5 の後に来る)。
4. accessible で空でないセクションだけを見る。entity ticking でなくても accessible なら拾う。
5. セクションの中は、そのセクションに入った順。型で絞る問い合わせも同じ順を保つ。
6. 当たりは AABB#intersects で、各軸とも**厳密な不等号**。面が接しているだけでは当たらない。
7. 除去されたエンティティはその場でセクションから抜けるので、拾われない。

E5 の「先頭の矢」・E7 の「先頭のトロッコ」・E9 の吸う順・E10 の乱数選択は、この順に依存する。

### 4.2 Entity#move

[26.3 読解: Entity#move, #collide, #restituteMovementAfterCollisions, #checkFallDamage]

1. noPhysics なら位置を足すだけで終わる。
2. MoverType が PISTON なら §4.19 の上限で削る。0 になれば終わる。
3. stuckSpeedMultiplier (クモの巣など) があれば掛け (ピストン以外)、速度を 0 にする。
4. ブロックの当たり判定・ワールド境界・他のエンティティで移動量を削る。段差の自動登りもここである。
5. 削った後の移動量の 2 乗が 1.0E-7 を超えるか、当たり判定でほとんど削られなかった (元の移動量の 2 乗との差が 1.0E-7 未満。移動量 0 も含む) なら、記録 (始点・終点・元の移動量) を movementThisTick に足して位置を書く。壁に当たってほぼ動けなかったときだけ記録しない。fallDistance が 0 でなく 1 以上動くときは、進む向きに最大 8 マスの光線で fall_damage_resetting のブロックや水を探し、当たれば落下距離を 0 にする。
6. 衝突のフラグを決める。onGround を更新し、支えのブロックを探し直す (サーバが動かすエンティティは毎回。クライアントが操るものは縦に動いたときだけ)。
7. 足元のブロック (Entity#getOnPosLegacy。下の表) で checkFallDamage を呼ぶ。落下中は fallDistance を積む (水中では積まない。y の移動量を float にしてから引く)。接地したら fallOn と HIT_GROUND を出してから 0 に戻す。fallOn でエンティティが消えたら、ここで終わる。プレイヤー (クライアントが操る) はここでは呼ばず、区間 A のパケット処理の doCheckFallDamage で呼ぶ。
8. 衝突していれば跳ね返る (下の表)。
9. 移動の音と STEP の GameEvent を出す (§4.20)。
10. 足元の速度係数 (ソウルサンドなど) を横に掛ける。

**move は entityInside を呼ばない**。ブロックへの作用は、その tick の移動が済んだ後の applyEffectsFromBlocks でまとめて起きる (§4.3)。[版差 1.21.1]

| 跳ね返り | 26.3 の決まり |
|---|---|
| 横の衝突 | エンティティの弾み係数で反転する。生き物以外は 0 |
| 下向きの衝突 | 落下の速さが重力より大きく、静かに歩いておらず、足元が suppresses_bounce タグでなければ、ブロックの係数 (スライム 1.0・ベッド 0.75・棚キノコ 0.75。生き物以外は 0.8 倍) と自分の係数の大きい方。係数が 0 なら縦の速度は 0 になる |
| 縦の新しい速度 | 実際に動けた割合で重力を補い、反転して係数を掛ける。抵抗も同じ割合で補間する |
| 跳ねた時 | 足元のブロックの bounceOn を呼び、BOUNCE の GameEvent を出す |

足元のマス (stepOn・fallOn・跳ね返り・摩擦の基準) の決め方 [26.3 読解: Entity#getOnPos, #getOnPosLegacy]:

| 支えのブロック (mainSupportingBlockPos) | getOnPosLegacy (ずらし 0.2) |
|---|---|
| ある | その x・z と、floor(位置の y − 0.2)。ただし支えが柵・塀・フェンスゲートなら、支えのマスそのもの (柵はずらしが 0.5 以下のときだけ。0.2 は当てはまる) |
| 無い | floor(x)・floor(y − 0.2)・floor(z) |

縁に乗ると、支えのブロックは中心の真下ではなく実際に乗っている列になる。スカルクセンサーの stepOn が拾う位置もこれで決まる (→ 10)。

### 4.3 applyEffectsFromBlocks と checkInsideBlocks

[26.3 読解: Entity#applyEffectsFromBlocks, #checkInsideBlocks, BlockGetter#forEachBlockIntersectedBetween, #addCollisionsAlongTravel, BlockPos#betweenCornersInDirection, AABB#collidedAlongVector, InsideBlockEffectApplier]

1. 記録を finalMovementsThisTick に移し、記録を空にする。記録が無ければ「古い位置 → 今の位置」を 1 件入れる。最後の記録の終点が今の位置とずれていれば、その差も 1 件足す。
2. 除去済みか noPhysics なら何もしない。
3. 接地していれば、足元のブロックの stepOn を 1 回呼ぶ。
4. checkInsideBlocks で記録を 1 件ずつ辿る。
   1. 元の移動量があり長さが正なら、軸ごとに分けて辿る。順は Y が先、次に横の大きい方 (|x| < |z| なら Z → X、そうでなければ X → Z)。
   2. 区間ごとに、終点の当たり箱を 1.0E-5 縮めた箱を作る。通るマスを「始点の箱のマス → 前縁の角が通るマス (ボクセル走査) → 終点の箱のマス」の順に並べる。どの段も移動の向きに沿い、Y が最も外側の軸になる。止まっている区間は終点の箱のマスだけを、x が最も速く z が最も遅い順で並べる。
   3. 空気は飛ばす。それ以外は getEntityInsideCollisionShape (既定は 1 マス全体。トリップワイヤーは糸の形、水入り大釜は水面の形) と移動経路が重なるかを見る。経路は「当たり箱の中心の線分」と「形を箱の半分だけ膨らませたもの」の交わりで判定する。
   4. 重なり、かつこの呼び出しでまだ訪れていないマスなら entityInside を呼ぶ。流体に入っていれば流体の entityInside も呼ぶ。entityInside には「精密」の真偽 (isPrecise) を渡す。終点の縮めた箱がそのマスと重なるか、その区間で約 1 マス以上動いたときに真である。泡柱はこれが真のときだけ効く (§4.21)。
   5. 1 件で 16 段を超えたら打ち切り、終点の箱だけ調べ直す。軸ごとに分けたときは、3 軸の区間で 16 段を分け合う。
   6. エンティティが途中で死んだら (ホッパーに吸われて消えた等) そこで止める。
5. entityInside が頼んだ効果は、経路の段ごとに種類の順 (凍結・凍結解除・着火・溶岩・消火) で並べ、辿り終えてからまとめて当てる。水入り大釜の水位を下げる処理は、消火の直前に走る。
6. 雨に当たっていれば火を消す。訪れたマスの集合を空にする。

| 呼ぶ所 | 時機 |
|---|---|
| ItemEntity | 自分の tick の move の直後。静止中は前の経路をもう一度 (§4.12) |
| PrimedTnt・FallingBlockEntity | move の直後 |
| 生き物 | aiStep の移動の後 |
| トロッコ (既定) | move のたびと tick の最後。**経路を辿らず、今の位置の箱だけ**を見る |
| 矢 | 飛ぶ区間ごと。刺さっている間は毎 tick |
| 投げ物 | 移動の後 |
| ピストンに押されたとき | 押した直後に、押された区間だけ (§4.19) |
| プレイヤー | B5 の doTick → aiStep。区間 A のパケットで記録した移動を辿る。/tp のように記録が無ければ、今の位置の箱だけ |

### 4.4 感圧板 (エンティティ側)

[26.3 読解: BasePressurePlateBlock#entityInside, #checkPressed, #tick, PressurePlateBlock#getSignalStrength, WeightedPressurePlateBlock#getSignalStrength]

1. entityInside は、板の出力が 0 のときだけ checkPressed へ進む。出力があれば何もしない。
2. checkPressed は**入ってきたエンティティを数えない**。TOUCH_AABB (横 1/16〜15/16・高さ 0〜4/16) を問い合わせて数え直す。
   - 木: Entity 全般が 1 体でもいれば 15。
   - 石: LivingEntity が 1 体でもいれば 15。
   - 重量: 体数 n。n = 0 なら 0。そうでなければ min(n, 上限) ÷ 上限を float で求め、15 倍を切り上げる。金 (上限 15) は min(n, 15)、鉄 (上限 150) は n ÷ 10 の切り上げ (15 で頭打ち)。
3. 値が変われば書き込む (書き込みと更新先は → 09)。値が正なら予約 tick (木・石 20、重量 10) を積む。
4. 予約 tick では、出力が正なら同じ数え直しをする。0 になれば解除、正なら再予約。

### 4.5 トリップワイヤー (エンティティ側)

[26.3 読解: TripWireBlock#getEntityInsideCollisionShape, #entityInside, #tick, #checkPressed]

1. 当たりの形は糸の形である。この形と移動経路が重ならないと entityInside は呼ばれない。
2. entityInside は、POWERED でなく、**その位置に予約 tick が無い**ときだけ動く。数え直さず、入ってきた 1 体だけで判定する (isIgnoringBlockTriggers なら押されない)。
3. 予約 tick (POWERED のとき) は、形の外接箱を問い合わせ、全エンティティで判定する。
4. 押されていれば 10 tick 後に再予約する。外れたら遅延 1 の予約を積む。それが残る間は entityInside が無視されるので、**外れた次の tick までは再び押されない** (→ 02・09)。

### 4.6 木のボタンと矢

[26.3 読解: ButtonBlock#entityInside, #checkPressed, #onExplosionHit, BlockSetType]

1. 矢で押せるのは、BlockSetType の矢フラグが真の型だけ。既定の木材 (オーク〜ポプラ)・竹・桜・真紅・歪みが真。石・磨かれたブラックストーン (ボタンは石の型) は偽。
2. entityInside は未押下のときだけ checkPressed を呼ぶ。
3. checkPressed は、ボタンの**今の**形の外接箱で AbstractArrow を問い合わせ、先頭の 1 体を採る。押下中の形は薄い。
4. 矢がいれば押下のまま 30 tick 後に再予約、いなければ解除する。
5. 押すのは AbstractArrow の派生 (矢・光の矢・トライデント)。雪玉などは押さない。

刺さった矢は毎 tick applyEffectsFromBlocks を呼ぶ (§4.17)。押下中は entityInside が無視されるので、矢が消えてから解除までは 1〜30 tick である。
ウィンドチャージの爆発 (TRIGGER_BLOCK) は、矢フラグに関係なく全ボタンを押す (§4.14)。

### 4.7 ディテクターレール (エンティティ側)

[26.3 読解: DetectorRailBlock#entityInside, #tick, #checkPressed, #getAnalogOutputSignal, #getSearchBB]

1. entityInside は、未 POWERED なら**どのエンティティでも** checkPressed を呼ぶ。数えるのはトロッコだけなので、トロッコ以外では状態は変わらない。
2. checkPressed は、生存できて、その位置がまだディテクターレールのときだけ進む。検索箱 (横 0.2〜0.8・高さ 0〜0.8) で AbstractMinecart を問い合わせる。
3. 状態が変われば書き込む (→ 15)。押されていれば 20 tick 後に再予約する。
4. 最後に**毎回**コンパレーター更新を出す。状態が変わらなくても出る。
5. アナログ値は POWERED のときだけ。箱の中のコマンドブロック付きトロッコの先頭があればその成功回数。無ければコンテナを持つトロッコの先頭の中身の値 (→ 14)。どちらも無ければ 0。

### 4.8 ターゲットと投射物の命中

[26.3 読解: TargetBlock#onProjectileHit, #getRedstoneStrength, Projectile#onHit, #onHitBlock]

1. 投射物がブロックに当たると、Projectile#onHit が onProjectileHit を呼び、PROJECTILE_LAND の GameEvent を出す。投射物の tick の中 (普通は L12) で起きる。
2. ターゲットの強さ: 命中面に沿う 2 軸で、命中点の小数部と 0.5 の差の大きい方を d とする。15 × (1 − 2d) を切り上げ、1〜15 に収める。面の中心なら 15、縁なら 1。
3. 持続は、投射物が AbstractArrow なら 20 tick、それ以外は 8 tick。
4. 予約 tick が残っている間の命中は無視する (延長しない)。

| ブロック | 投射物が当たった時 |
|---|---|
| TNT | 投射物が燃えていれば点火してブロックを消す |
| ろうそく・焚き火 | 燃えていれば火を点ける |
| ベル | 鳴らす |
| 大きなドリップリーフ | 受電を見ずに、いきなり full に傾く。100 tick 後の予約で戻る。音の高さに Level の乱数を 1 回引く (→ 11) |
| 飾り壺・コーラスフラワー | 壊れる |
| 鍾乳石 | 速さ 0.6 超のトライデントで壊れる |
| アメジストのブロック | 音だけ。Level の乱数を 1 回引く |

### 4.9 ホッパーとエンティティ

[26.3 読解: HopperBlock#entityInside, HopperBlockEntity#entityInside, #tryMoveItems, #suckInItems, #getItemsAtAndAbove, #addItem, #getEntityContainer, MinecartHopper#tick, #makeStepAlongTrack, #suckInItems, #getLevelY]

1. 吸い込み (BlockEntity 相。クールダウン明けで有効なとき。→ 14): 上のマスにブロックのコンテナがあれば、そこから取る。無ければ、上のマスが「当たりの形が 1 マス全体で、does_not_block_hoppers タグに無い」ブロックでない限り、SUCK_AABB のアイテムを問い合わせて先頭から入れてみる。**1 体を丸ごと入れられた時点で止める**。一部しか入らなければ残りをそのアイテムに戻し、次のアイテムへ進む。
2. entityInside: アイテムがホッパーのマスに入り、その箱が SUCK_AABB と重なれば、その場 (L12) で tryMoveItems を通す。**中身があれば先に押し出しも走り**、その後でそのアイテムを入れてみる。クールダウン中か無効なら何もしない。どちらかが成功すると待ち 8 が付く (同じ tick の L13 で 7 に減る。→ 14)。
3. 転送の相手 (上・前・ドロッパーの前) にブロックのコンテナが無ければ、相手マスの中心 ±0.5 の箱で Container を持つエンティティを問い合わせ、**Level の乱数で 1 体を選ぶ**。1 体しかいなくても乱数を 1 回引く。
4. ホッパー付きトロッコは 1 tick に 1 回まで吸う。上のコンテナ (自分の位置 + 1.5 のマス) → SUCK_AABB のアイテム (自分の位置を基準にずらす。上がフルブロックでも塞がれない) → 自分の箱を横に 0.25 膨らませた範囲のアイテム、の順に試す。既定の OldMinecartBehavior では tick の最後に 1 回だけ試す。レールの 1 歩ごとにも試すのは、実験的な NewMinecartBehavior のときだけである。クールダウンは無い。通電したアクティベーターレールの上で無効になる。

### 4.10 額縁とコンパレーター

[26.3 読解: ComparatorBlock#getItemFrame, ItemFrame#setItem, #setRotation, #getAnalogOutput, #survives, BlockAttachedEntity#tick, #move, #push, #hurtServer]

1. コンパレーターが導体越しに読むとき、2 マス先の 1×1×1 で額縁を数える。向きが FACING と同じものが**ちょうど 1 体**のときだけ採る (比較は → 07)。
2. 値は、中身が無ければ 0、あれば 回転 (0〜7) + 1。
3. 中身や回転が変わると、額縁のいるマスを起点にコンパレーター更新を出す (→ 04)。プレイヤーの操作なら区間 A。
4. 額縁は自分では動かない。101 tick ごとに取り付け先を確かめ、固体でなければ (横向きならダイオードでもよい) 外れてアイテムになる。外れの箱にブロックの当たりが入ったときも外れる。fixed の額縁は外れない。**取り付け先を壊してもすぐには落ちない**。
5. ピストンや爆発で少しでも動かされると (fixed でなければ)、その場で外れてアイテムになる。水中の爆発元の爆発と、ブロック状のエンティティに効かない爆発 (§4.14) は無視する。

### 4.11 開閉人数 (トラップチェストほか)

[26.3 読解: ContainerOpenersCounter#incrementOpeners, #decrementOpeners, #recheckOpeners, #getEntitiesWithContainerOpen, ChestBlockEntity#signalOpenCount, TrappedChestBlockEntity#signalOpenCount]

1. 開く・閉じるは ContainerUser (プレイヤーと銅ゴーレム) が呼ぶ。増減のたびに openerCountChanged を呼ぶ。トラップチェストはここで、人数が変わったときだけ近隣更新を出す (→ 09)。
2. 0 → 1 のとき、5 tick の再確認を予約する。
3. 再確認は、(操作距離の最大 + 4) 膨らませた箱で、このコンテナを開いている ContainerUser を問い合わせて数え直す。観戦者は数えない。**人数が変わらなくても openerCountChanged を呼ぶ**。チェストはそのたびにブロックイベント (種別 1・値は人数) を積む (→ 03)。トラップチェストの近隣更新は人数が変わったときだけである。人数が正なら再予約する。
4. 開閉が起きる位相は、プレイヤーなら区間 A (離れすぎて閉じるときは L12 の ServerPlayer#tick か B5 の doTick)、銅ゴーレムなら L12 (AI)。

### 4.12 ItemEntity#tick

[26.3 読解: ItemEntity#tick, #setFluidMovement, #mergeWithNeighbours, #isMergable, #tryToMerge, Entity#baseTick, #moveTowardsClosestSpace]

1. 中身が空なら消える。
2. Entity#baseTick。流体の状態を更新し、水流で押す (1 回目)。燃焼の残り tick を進める。
3. pickupDelay を 1 減らす (32767 なら減らさない)。
4. 速度の入力。水の深さが 0.1 超なら横 × 0.99 で、縦の速度が 0.06F 未満なら 5.0E-4F を足す。溶岩なら横 × 0.95 で同じ浮力。どちらでもなければ重力 −0.04。
5. 当たり箱 (1.0E-7 縮めたもの) がブロックにめり込んでいれば noPhysics にし、近い空きへ押し出す。候補は北・南・西・東・上の 5 面 (下は無い) で、その向きの隣がフルブロックでないもののうち、箱の中心から面までが最も近い向き。速さは 0.1〜0.3 (エンティティの乱数)、他の 2 軸は 0.75 倍。noPhysics の間はブロックへの作用 (entityInside) が起きない。
6. **接地していて、横の速さの 2 乗が 1.0E-5F 以下で、(tickCount + id) が 4 の倍数でなければ、動かない**。前の経路でブロックへの作用だけを繰り返す (stepOn も含む)。
7. そうでなければ move → applyEffectsFromBlocks → 抵抗 (横は 0.98F × 足元の摩擦 (接地時)、縦は 0.98F) → 接地していて下向きなら縦 × −0.5。
8. マスが変わったなら 2 tick ごと、変わらなければ 40 tick ごと (tickCount で数える) に合体を試す。
9. age +1。流体の状態を更新し、水流で押す (2 回目)。
10. age が 6000 になれば消える。

合体: 相手は自分の箱を横に 0.5 膨らませた範囲の、合体できるアイテム (§4.1 の順)。持ち主が同じで、同じ種類・同じ部品で、合わせて上限以下なら、少ない方を多い方へ移す。数が同じなら、合体を試した側 (自分) が相手へ移る。移した側が空になれば消える。残った側が pickupDelay の大きい方・age の小さい方を受け継ぐ。自分が消えたら残りの相手は見ない。

### 4.13 TntBlock と PrimedTnt

[26.3 読解: TntBlock#onPlace, #neighborChanged, #prime, #wasExploded, #onProjectileHit, PrimedTnt の生成, #tick, #explode, #getRandomShortFuse]

TNT ブロック:

1. 設置 (別のブロックからの置き換え。ピストンで運ばれて着地したときも含む) と近隣更新で hasNeighborSignal を見る。形状更新では見ない。真で、ゲームルール tnt_explodes が真なら点火する。偽なら何もせず、ブロックは残る。
2. 点火は、PrimedTnt を (x + 0.5, y, z + 0.5) に作って世界に加え、音と PRIME_FUSE の GameEvent を出す。**その後で**ブロックを removeBlock (流体の状態のブロックをフラグ 3 で書く) で消す。火打石・ファイヤーチャージで点けたときは、空気をフラグ 11 で書く。
3. 爆発に巻き込まれたら (wasExploded。tnt_explodes が真のときだけ)、同じ位置に PrimedTnt を作り、導火線を 10〜29 にする。Level の乱数は、生成の角度 → 導火線の順に引く。
4. 燃えている投射物が当たったら点火して消す。爆発ではドロップしない。

PrimedTnt:

1. 生成時、Level の乱数の nextDouble に float の 2π (6.2831855F を広げた値) を掛けて角度 θ とし、速度を (−sin θ × 0.02, 0.2F, −cos θ × 0.02) にする。導火線は 80。
2. tick は次の順。**baseTick を呼ばない**。
   1. ポータルの処理。
   2. 重力 −0.04。
   3. move → applyEffectsFromBlocks。
   4. 速度 × 0.98F。接地していれば (0.7, −0.5, 0.7) 倍。
   5. 導火線を 1 減らす。0 以下なら消えてから爆発する (§4.14。tnt_explodes が偽なら消えるだけ)。中心は (x, y + 0.98F × 0.0625, z)。それ以外は水流で押す (§4.21。1 tick に 1 回)。

### 4.14 爆発 (ServerExplosion#explode)

[26.3 読解: ServerExplosion#explode, #calculateExplodedPositions, #hurtEntities, #interactWithBlocks, #createFire, #getSeenPercent, ExplosionDamageCalculator, BlockBehaviour#onExplosionHit, ServerLevel#explode]

1. EXPLODE の GameEvent を出す。
2. 壊すマスを集める。立方体の表面の 1352 本の光線を、格子の x を外側・z を内側にした順に撃つ。各光線の最初に Level の乱数を 1 回引く。**ブロックを壊さない爆発 (KEEP・TRIGGER_BLOCK) でもこの 1352 回は引く**。マスは HashSet に入れ、その反復順 (BlockPos のハッシュ順。→ 18) で配列にする。
3. **エンティティに当てる (ブロックを壊す前)**。中心 ±(2r + 1) を整数に丸めた箱で問い合わせる (爆発の元は除く)。各エンティティについて:
   1. 爆発を無視するなら飛ばす。距離 ÷ 2r が 1 を超えたら飛ばす。
   2. 向きは中心からエンティティへ。TNT は足元、他は目の高さを使う。
   3. 露出は、当たり箱の格子点から中心への光線のうち、ブロックに遮られない割合。ダメージも押しも無いなら計算しない。
   4. ダメージは p = (1 − 距離比) × 露出 として、(p² + p) ÷ 2 × 7 × 2r + 1。
   5. 押しは 向き × (1 − 距離比) × 露出 × 係数 × (1 − 爆発ノックバック耐性)。速度に足す。
   6. 最後に onExplosionHit を呼ぶ。
   7. ダメージを受けるアイテムは health 5 から (int) で引き、0 以下で消える。爆発の近くにもともとあったアイテムはここで消えうる。点火済み TNT はダメージを受けない。
4. ブロックに作用する (KEEP 以外)。配列を Level の乱数でシャッフルする (Fisher–Yates。n − 1 回)。その順に onExplosionHit を呼ぶ。既定は、ドロップを集める → 空気をフラグ 3 で書く → wasExploded。ドロップは同じものを 16 個までまとめ (束の位置はその束を最初に作ったマス)、全部壊した後に popResource で出す。**壊れたブロックのドロップはエンティティへの作用の後に生まれるので、その爆発では傷つかない**。
5. fire が真なら、シャッフル後の順で各マス 1/3 の確率 (Level の乱数) で、空気かつ下が不透明なら火を置く。TNT は fire が偽。

| 爆発の種類 | ブロックへの作用 |
|---|---|
| TNT・TNT 付きトロッコ | tnt_explosion_drop_decay が偽 (既定) なら DESTROY、真なら DESTROY_WITH_DECAY |
| ブロック由来 (ベッドなど) | block_explosion_drop_decay (既定 真) で決まる |
| 生き物 | mob_griefing が真なら mob_explosion_drop_decay で決まる。偽なら KEEP |
| 硫黄キューブ (威力 3) | mob_griefing が真なら TNT と同じ扱い (tnt_explosion_drop_decay)、偽なら KEEP。中心は足元から「その個体の高さ (0.49F × 大きさ)」× 0.0625 上 |
| ウィンドチャージ (半径 1.2) | TRIGGER_BLOCK。壊さない。ボタンを押す・レバーを切り替える・ベルを鳴らす・ろうそくを消す。給電中でなければ、ウィンドチャージで開く型 (鉄以外) のドア・トラップドアと、フェンスゲートを開閉する |

アイテム・防具立て・額縁は、ブロック状のエンティティに効かない爆発を無視する。効かないのは、ウィンドチャージ (ブリーズのものを含む) の爆発と、mob_griefing が偽のときの KEEP・TRIGGER_BLOCK の爆発である。透明な防具立ては全ての爆発を無視する。点火済み TNT は傷つかず、押されるだけである。[26.3 読解: ServerExplosion#shouldAffectBlocklikeEntities, ItemEntity#ignoreExplosion, ArmorStand#ignoreExplosion, BlockAttachedEntity#ignoreExplosion, ItemEntity#hurtServer]

### 4.15 FallingBlockEntity

[26.3 読解: FallingBlock#onPlace, #updateShape, #tick, #isFree, FallingBlockEntity#fall, #tick]

1. ブロック側: 設置と形状更新のたびに遅延 2 の予約を積む。予約 tick で、下が空き (空気・火・液体・置き換え可能) で、y が世界の下限以上なら落ちる (→ 16)。
2. fall: エンティティを (x + 0.5, y, z + 0.5) に速度 0 で作る。元のマスを流体の状態のブロックにフラグ 3 で書いてから、エンティティを世界に加える。
3. tick は次の順。**baseTick を呼ばない**。
   1. blockState が空気なら消える。
   2. time +1。重力 −0.04。move → applyEffectsFromBlocks → ポータル。
   3. 接地しておらず水にも止められていなければ、time が 100 超で建築範囲の外か、600 超なら、アイテムになって消える。
   4. 接地したら速度を (0.7, −0.5, 0.7) 倍し、今いるマスを見る。**moving_piston なら何もしない** (エンティティは残る)。
   5. 置き換え可能で、置いて生存でき、下が空きでなければ、フラグ 3 で置いて消え、onLand を呼ぶ。置けなければアイテムになる。
   6. 速度 × 0.98F。

落下ブロックは baseTick も updateFluidInteraction も呼ばないので、**水流に押されない** (§4.21)。

### 4.16 トロッコ (既定の OldMinecartBehavior の概要)

[26.3 読解: AbstractMinecart#tick, #move, #applyEffectsFromBlocks, #getCurrentBlockPosOrRailBelow, OldMinecartBehavior#tick, #moveAlongTrack]

1. 揺れとダメージを減らす → 世界の下の確認 → ポータル → behavior の tick → 流体 → 溶岩。
2. behavior の tick:
   1. 重力。
   2. 自分のマスか 1 つ下がレールなら onRails。
   3. レールの上なら moveAlongTrack (→ 15)。乗っているのがアクティベーターレールなら、その POWERED を渡して activateMinecart を**毎 tick** 呼ぶ。
   4. レール外なら最高速で切り、接地なら 0.5 倍して動く。
   5. applyEffectsFromBlocks をもう一度呼ぶ (今の位置の箱だけ)。
   6. 向きを直し、周りのエンティティを押す・乗せる。
3. move を呼ぶたびに applyEffectsFromBlocks が走る。ディテクターレールの entityInside は 1 tick に 2 回起こりうる (2 回目は無視される)。

| 種類 | 通電したアクティベーターレールの上 | 未通電の上 |
|---|---|---|
| 普通のトロッコ | 乗員を降ろす。揺れが 0 なら揺らす (揺れ 10・ダメージ 50) | 何もしない |
| TNT 付き | 未点火なら点火 (導火線 80) | 何もしない |
| ホッパー付き | 無効にする | 有効に戻す |
| コマンドブロック付き | 前回の実行から 4 tick 以上たっていれば実行 | 何もしない |

TNT 付きトロッコは、点火の tick に導火線を 1 減らし、0 になった次の tick に爆発する。点火から 80 tick 後である。
威力は 4 + エンティティの乱数 × 1.5 × 横の速さ (5 で頭打ち)。速さ² 0.01 以上で横にぶつかる・3 以上落ちる・燃えた矢が当たる、でも爆発する。
点火済みの間は、レールとレールの下のマスを壊さない。[26.3 読解: MinecartTNT]

実験的機能 minecart_improvements を有効にしたワールドだけ NewMinecartBehavior を使う。1 tick に複数マス進み、最高速はゲームルール max_minecart_speed (既定 8 ブロック毎秒) で決まる。レールに沿う反復の 1 回ごとに activateMinecart と applyEffectsFromBlocks が走りうる (回数と順の細部は → 15 [要実機])。既定のワールドでは使わない。

### 4.17 投射物の移動

[26.3 読解: Projectile#tick, #getMovementToShoot, #onHit, ThrowableProjectile#tick, AbstractArrow#tick, #stepMoveAndHit, #onHitBlock, #shouldFall, #startFalling, #tickDespawn, ThrownTrident#tick, #tickDespawn, DispenserBlock#getDispensePosition, ProjectileItem の DispenseConfig]

- PROJECTILE_SHOOT の GameEvent は、最初に Projectile#tick を通ったときに 1 回出す。投げ物は命中の判定の前に通る。**矢は飛行中の tick の最後に通る**ので、最初の tick で当たった矢は PROJECTILE_LAND を PROJECTILE_SHOOT より先に出す。刺さったまま生まれた矢は Projectile#tick を通らず、PROJECTILE_SHOOT を出さない。
- 射出の誤差は、エンティティの乱数の三角分布 (幅 0.0172275 × 不確かさ) を各軸に足す。ディスペンサーは不確かさ 6・威力 1.1。生まれる位置はディスペンサーの中心から向きへ 0.7、上へ 0.1。
- 投げ物: 最初の tick だけ箱の中の泡柱に触れる → 重力 → 抵抗 → 移動の線分上の最初の命中 → 位置を書く → applyEffectsFromBlocks → Projectile#tick (PROJECTILE_SHOOT・baseTick) → 命中なら onHit。
- 矢: tick の最初に、自分の位置のブロックの当たりの形が位置を含めば、速度 0 で inGround にする (命中の処理は走らない)。
- 矢 (飛行中): 水中なら先に水の抵抗 (矢 0.6F・トライデント 0.99F) → 光線でブロックの命中を求める → 途中のエンティティを近い順に調べる → 区間ごとに位置を書いて applyEffectsFromBlocks → 命中なら onHit → 水中でなければ抵抗 0.99F → 刺さっていなければ重力 0.05 → Projectile#tick (PROJECTILE_SHOOT・baseTick)。
- 矢がブロックに当たると、刺さったブロックを lastState に覚える → onProjectileHit → 速度の各軸の符号 × 0.05F だけ戻す → 速度 0 → inGround。
- 刺さっている間: 自分の位置のブロックが lastState と違い (面の手前に刺さる普通の場合は常に違う)、かつ周り ±0.06 に当たりが無ければ落ち始める (エンティティの乱数で速度を縮める)。実質は「周りの当たりが消えたら落ちる」。そうでなければ寿命 +1 (1200 で消える)。**毎 tick applyEffectsFromBlocks を呼ぶ**。
- 忠誠のトライデントは、刺さって 5 tick 目から持ち主へ戻り始める (持ち主がいるとき)。持ち主がおらず拾える設定なら、消えずに残る。

### 4.18 雷と避雷針

[26.3 読解: LightningBolt#tick, #powerLightningRod]

1. 雷は L9 の落雷で作られ、同じ tick の L12 で最初の tick を受ける。
2. 最初の tick (life 2) に、火を置き (難易度 normal・hard)、足元 (位置の 1.0E-6 下) が避雷針なら onLightningStrike を呼ぶ (→ 09)。銅の錆を落とし (Level の乱数)、LIGHTNING_STRIKE を出す。
3. life ≥ 0 の間、±3 (上は +9) の箱のエンティティに当たる。閃光は 1〜3 回で、回数と延長はエンティティの乱数で決まる。

### 4.19 ピストンが押すエンティティ

[26.3 読解: PistonMovingBlockEntity#moveCollidedEntities, #moveEntityByPiston, #moveStuckEntities, #fixEntityWithinPistonBase, Entity#limitPistonMovement, AbstractMinecart#move] 押す時機は → 13 §4.11。

1. 動く当たり判定を、その tick の進み (0.5) だけ動かした範囲で問い合わせる。
2. 押し反応が IGNORE_ENTITY のもの (マーカーの防具立て) は除く。既定は PUSH_PULL で、アイテム・TNT・トロッコも押される。
3. 中身がスライムブロックなら、動きをシミュレートできるエンティティの、動く軸の速度を ±1 に置き換える。
4. 重なりの深さ (その tick の進みが上限) + 0.01 だけ、MoverType PISTON で動かす。1 game tick・1 軸あたり合計 ±0.51 に削られる。
5. 動かした直後に、押された区間だけで applyEffectsFromBlocks を呼び、その記録を消す。**押された先の entityInside は BlockEntity 相で走る**。
6. 引っ込むピストン自身 (isSourcePiston) の動きで押したエンティティが、ピストン本体のマスに食い込んでいれば、反対向きへ押し戻す (fixEntityWithinPistonBase)。
7. 中身がハチミツブロックで横に動くとき、上に乗って接地している PUSH_PULL のエンティティを同じだけ運ぶ。
8. 額縁は動かされると外れる。刺さった矢は動かされて周りが空になると落ち始める。従来の挙動のトロッコは move の中でも今の位置の箱でブロックに作用するので、押されたトロッコはその場 (L13) でディテクターレールを点けうる (→ 15)。

### 4.20 その他のエンティティ依存

- 硫黄キューブ [26.3 読解: SulfurCube#tick, #tickFuse, #primeWhenOnPoweredPosition, #primeTime, SignalGetter#getBestOwnOrNeighbourSignal]: tick の最初に導火線を進める (正なら 1 減らし、0 なら爆発して消える)。爆発できる (爆発する種類の中身を持ち、生きていて未点火) なら、自分の位置のブロック座標で「6 方向の隣から届く信号の最大」と「そのマスが信号源なら自身の信号」の大きい方を読む。0 でなければ点火する (導火線 120。ルール tnt_explodes が要る)。その後で生き物の tick に入る。点火した tick の次から数えて 120 tick 目の tick の最初に爆発する。
- 銅ゴーレム: コンテナを開け閉めする。トラップチェストの人数に入る (§4.11)。
- stepOn を持つブロック: レッドストーン鉱石 (静かに歩いていなければ点灯。→ 09 付録 A)・スカルクセンサー (振動を直接予約)・スカルクシュリーカー・カメの卵 (Level の乱数)・スライム (横の減速)・マグマブロック。
- fallOn を持つブロック: 耕地 (踏みつけで土)・カメの卵・スライム・ハチミツ・干し草・粉雪・鍾乳石。耕地は、落ちたのが生き物でなくても (アイテム・TNT も) Level の乱数の nextFloat を 1 回引く。生き物かどうかはその後で見る [26.3 読解: FarmlandBlock#fallOn]。
- 大きなドリップリーフ: E19。入ってきた本人で判定する (感圧板のような数え直しは無い)。傾く途中の予約 tick では乗っているかを見ない (→ 11)。
- Block#pushEntitiesUp: 当たりの形が大きくなる置き換え (耕地から土など) で、重なったエンティティを上へ移す。

エンティティが出す GameEvent (伝わり方は → 10):

| GameEvent | 出る時 | 出さないもの |
|---|---|---|
| STEP | 移動の距離が次の歩数に達した時 (move の中) | アイテム・TNT・落下ブロック・矢・経験値オーブ。トロッコはレールの上で出す |
| HIT_GROUND | 接地した時に fallDistance が正 (move の中。プレイヤーは区間 A の doCheckFallDamage) | — (アイテムも出す) |
| BOUNCE | 跳ね返った時 | — |
| SWIM・SPLASH・FLAP | 水中・着水・羽ばたき | — |
| PROJECTILE_SHOOT・PROJECTILE_LAND | 投射物の最初の tick・命中 | — |
| PRIME_FUSE・EXPLODE | TNT の点火・爆発 | — |
| BLOCK_ACTIVATE・BLOCK_DEACTIVATE | 感圧板・ボタンの切り替わり (原因のエンティティ付き) | — |
| CONTAINER_OPEN・CONTAINER_CLOSE | 開閉人数の 0 ↔ 正 | — |
| BLOCK_CHANGE | 額縁に入れる・回す。大釜の水位が下がる | — |
| LIGHTNING_STRIKE・ENTITY_DAMAGE | 雷・ダメージ (アイテムも、爆発などで傷つくと出す) | — |
| EQUIP・UNEQUIP | 生き物 (防具立てを含む) の装備が変わった時。ディスペンサーで装備させた時も (LivingEntity#onEquipItem) | 最初の tick・観戦者 |

羊毛など dampens_vibrations タグのアイテムは振動を弱める (→ 10)。

### 4.21 水流と泡柱 (エンティティ側)

[26.3 読解: Entity#updateFluidInteraction, #handleOnAboveBubbleColumn, #handleOnInsideBubbleColumn, #sendBubbleColumnParticles, #getFluidInteractionBox, EntityFluidInteraction#update, #applyCurrentTo, BubbleColumnBlock#entityInside, Projectile#onAboveBubbleColumn, #onInsideBubbleColumn] 流体と泡柱のブロック側は → 16。

水流 (Entity#updateFluidInteraction):

1. 当たり箱を 0.001 縮めた箱が重なる流体のマスを、x → y → z の三重の順に見る。流体の上面が箱の下より下のマスは数えない。
2. 種類ごとに「箱の下から流体の上面までの最大」を深さとし、流れの向き (FluidState#getFlow) を足し合わせる。深さが 0.4 未満の間に足す流れは、その深さを掛けて弱める。
3. 水に入っていれば落下距離を 0 にする。押される種類 (isPushedByFluid) なら、足し合わせた流れを水は 0.014、溶岩は 0.0023333333333333335 (速い溶岩のディメンションでは 0.007) で速度に足す。
4. プレイヤー以外は、足し合わせた流れを**正規化**してから掛ける (流れの強さは効かず、向きだけが効く)。横の速さが両軸とも 0.003 未満で押しが 0.0045 未満なら、押しを長さ 0.0045 に揃える。
5. 呼ぶ回数は種類で違う。アイテムは 1 tick に 2 回 (baseTick と tick の最後。押しも 2 回)。点火済み TNT は 1 回 (爆発しない tick の最後)。トロッコは behavior の tick の後に 1 回。**落下ブロックは呼ばない**。

泡柱 (BubbleColumnBlock#entityInside): 精密 (§4.3) なときだけ働く。上のマスに当たりの形も流体も無ければ「柱の上」、あれば「柱の中」の処理をする。

| 処理 | 上向きの柱 (soul_sand) | 下向きの柱 (magma_block) | ほか |
|---|---|---|---|
| 柱の上 (普通のエンティティ) | 縦速度を min(1.8, 縦 + 0.1) | 縦速度を max(−0.9, 縦 − 0.03) | **Level の乱数の nextDouble を 8 回**引いて粒子を送る |
| 柱の中 (普通のエンティティ) | min(0.7, 縦 + 0.06) | max(−0.3, 縦 − 0.03) | 落下距離を 0 にする |
| 投射物 | 上 + 0.1・中 + 0.06 (上限なし) | 上・中とも − 0.03 | 柱の上では同じく 8 回引く |

- 泡柱の速度の書き換えは、その tick の移動の後 (applyEffectsFromBlocks の中) に入る。効くのは次の tick の移動である。
- 動きを計算しないもの (canSimulateMovement が偽。サーバではプレイヤーなど) の速度は変えない。
- 柱の上にいるアイテムは毎 tick Level の乱数を 8 回引く。アイテムエレベーターは Level の乱数の列を大きくずらす (§7.4)。

### 4.22 ブロックが出すドロップ (Block#dropResources・popResource)

[26.3 読解: Block#dropResources, #popResource, #popResourceFromFace, ItemEntity の生成, #setDefaultPickUpDelay, LootTable#getRandomItems, LootContext の Builder#create]

ピストンが壊すブロック (L10。→ 13)・爆発 (§4.14)・支えを失ったブロックなどが、ブロックをアイテムにするときの共通の手順である。

1. ルートテーブルで中身を決める。乱数は、テーブルに random_sequence があれば**サーバの乱数列** (ワールドの種・塩・列の名前から作り、ワールドに保存される) を使い、無ければ Level の乱数を使う。26.3 のブロックのテーブルは random_sequence を持つ (例: blocks/redstone_wire)。爆発の減衰 (survives_explosion) はこの乱数を引く。減衰の無い既定の TNT の爆発では引かない [26.3 読解: MinecraftServer#getRandomSequence, RandomSequences#get]。
2. 束ごとに popResource で出す。位置は、マスの中心から各軸 ±0.25 (Level の乱数の nextDouble を x → y → z の 3 回)。縦はさらにアイテムの高さの半分 0.125 を下げる。**位置の 3 回はゲームルール block_drops の判定より前に引く**ので、ドロップが出ない設定でも Level の乱数は進む。面から出す popResourceFromFace は、面の法線が 0 の軸だけ位置と初速を引く (→ 18)。
3. ItemEntity を作る。エンティティの乱数で UUID (2 回)・揺れの位相・向き・初速 (横 ±0.1 を 2 回。縦は 0.2) を引く。拾える待ち (pickupDelay) は 10。
4. addFreshEntity で世界に加える。作られた相の規則で最初の tick が決まる (§2.3)。

ディスペンサー・ドロッパーのワールドへの射出 (DefaultDispenseItemBehavior#spawnItem) は popResource を通らない。位置は射出口 (縦は 0.125 か 0.15625 下げる) で、初速は Level の乱数で決め、pickupDelay は 0 のまま (→ 12)。

---

## 5. 端の場合と落とし穴

1. 感圧板とディテクターレールは、入ってきたエンティティを数えない。移動後の位置で範囲を数え直す。トリップワイヤーは本人だけで決める。1 tick で通り抜けた速いエンティティは、感圧板を押さず、糸は押す。
2. ディテクターレールの entityInside は誰でも起こす。アイテムが未通電のレールの上を流れるだけで、コンパレーター更新が毎 tick 出る。
3. L12 の中で作られたエンティティは次の tick から動く。連鎖する TNT の短い導火線 (10〜29) は次の tick から数える。
4. 同じ tick に爆発する TNT の順は EntityTickList の順である。押されたエンティティが表で後ろなら、同じ tick のうちに新しい速度で動く。前ならもう動いた後なので次の tick に動く。TNT 砲の届く距離はこの順で変わる。
5. 爆発は、エンティティを押してからブロックを壊す。露出は壊される前のブロックで遮られる。
6. 爆発で壊れるマスの順は Level の乱数でシャッフルされる。壊れたダストやトーチの近隣更新の順は実行ごとに変わる。
7. ホッパーの相手がエンティティのコンテナなら、選ぶ 1 体は乱数である。1 体しかいなくても Level の乱数を引き、他の乱数の列をずらす。
8. 接地して止まったアイテムは 4 tick に 1 回しか動かない。位相は (tickCount + id) で決まり、id は実行ごとに違う。
9. 重量感圧板は体数で数える。64 個のアイテムの山も 1 体である。同じ種類のアイテムが合体すると体数が減り、次の再判定で出力が下がる。
10. 板は退いてから 1〜20 tick (重量は 1〜10 tick) で解除される。直前の判定からの経過で決まる。「踏んでから 20 tick で消える」のは、踏んですぐ退いたときだけである。
11. 木のボタンは、刺さった矢かトライデントがある間は押しっぱなしになる。矢は刺さって 1200 tick で消える。忠誠のトライデントは持ち主がいれば刺さって 5 tick 目から戻り始め、持ち主がいなければ消えずに残る (§4.17)。
12. 石の感圧板は LivingEntity を数える。マーカーでない防具立てで押せる。コウモリは押さない。
13. 額縁は取り付け先を壊しても最大 101 tick 残り、その間コンパレーターは値を読み続ける。
14. 落下ブロックが moving_piston のマスに着地しようとすると、何もせず残る。
15. 落下ブロックの着地点に置き換えられないブロック (感圧板・トーチなど) があると、アイテムになる。
16. TNT ブロックは、エンティティを作ってからブロックを消す。消す書き込み (フラグ 3) の近隣更新は、エンティティがもう世界にいる状態で配られる。
17. 接続を持つ普通のプレイヤーが板を踏むのは B5 である。同じ tick に L12 で他のエンティティが踏むのとは位相が違う。凍結中もプレイヤーは毎周 tick されるので踏める。ハーネスの fake player はパケットで動かないので、この規則がそのまま当てはまるとは限らない (§9.4)。
18. ピストンに押されたエンティティの entityInside は BlockEntity 相で走る。押されたアイテムが感圧板に乗るのは L13 である。
19. TNT の爆発の中心は、エンティティの位置から 0.98F × 0.0625 上にある。
20. 矢の命中は投射物の tick の中 (L12) で起きる。ディスペンサーの射出 (L6) と同じ tick に当たりうる。
21. ウィンドチャージは鉄のドア・鉄のトラップドアを開けない。レバーとボタンは種類を問わない。
22. 静止したアイテムは、最後に動いた経路で作用を繰り返す。経路の途中のマスにも entityInside が届く (トリップワイヤーは本人で判定するので押されうる)。次に動く tick (最大 3 tick 後) まで続く。[26.3 読解] [要実機]
23. ディスペンサーに**接した**フルブロックの的 (ターゲット・TNT など) に矢を撃つと、矢は的のマスの中 (中心から 0.7 先) に生まれる。最初の tick の冒頭で「当たりの形の中にいる」と判定されて刺さった扱いになり、onProjectileHit が呼ばれない。投げ物 (雪玉など) は最初の tick の線分の判定で当たる [26.3 読解: AbstractArrow#tick, ThrowableProjectile#tick] [要実機]。
24. ホッパーの entityInside (L12) は tryMoveItems を通るので、アイテムが入ってきた瞬間にホッパーの押し出しも走る。L13 の ticker を待たない。
25. 泡柱の上端にいるエンティティは、1 体ごとに毎 tick Level の乱数を 8 回引く (§4.21)。泡柱のある回路では、ほかの Level の乱数 (爆発・ホッパーの相手選び・ディスペンサーのスロット選び) の結果が変わる。
26. 落下ブロックは水流に押されない。アイテムと点火済み TNT は押される (アイテムは 1 tick に 2 回)。
27. 爆発はエンティティへの作用の後でブロックを壊すので、もともと近くにあったアイテムは消えうるが、壊れたブロックのドロップは無傷で出る (§4.14)。

---

## 6. 版差

担当クラスを diff -u で比べ、挙動に効く違いだけを挙げる。

### 6.1 1.21.1 → 26.2

| 点 | 1.21.1 | 26.2 | 効き |
|---|---|---|---|
| ブロックへの作用の時機 | move の最後に checkInsideBlocks。今の当たり箱の全マスを x が外側・z が内側の順に回り、空気にも entityInside を呼ぶ | 移動の後の applyEffectsFromBlocks。経路を辿り、空気を飛ばし、当たりの形で絞る。同じマスは 1 回 | 速いエンティティが途中のマスに触れる。トリップワイヤーは糸の形でしか当たらない |
| stepOn | move の中 | applyEffectsFromBlocks の最初 | tick の中の順 |
| 跳ね返り | 縦の衝突で updateEntityAfterFallOn。スライムは下向きの速度を反転、ベッドは反転して 0.66F 倍 (どちらも生き物以外はさらに 0.8 倍)。横の衝突はその軸の速度を 0 にする | 汎用の弾み係数 (スライム 1.0・ベッド 0.75。重力の補正あり)・BOUNCE | スライムとベッドの上のアイテム・TNT の軌道 |
| 静止したアイテム | ブロックへの作用なし | 前の経路で作用を繰り返す | 止まったアイテムの下に後から置いた板が押される時機 |
| 空気の抵抗 | TNT・落下ブロックは 3 軸とも double の 0.98。アイテムは縦だけ double の 0.98 (横は 0.98F) | 3 軸とも float の 0.98F を広げた値 | 位置が 1.0E-9 ほどずれる |
| プレイヤーのブロック作用 (entityInside・stepOn) | 区間 A のパケット処理の move の中 | B5 の doTick → aiStep | 接続を持つプレイヤーの、踏んだ tick の中の位相 (fake player は §9.4)。fallOn はどちらの版も区間 A の doCheckFallDamage |
| 刺さった矢 | ブロックに作用しない | 毎 tick 作用する | 矢の下に後から置いた板・糸 |
| トリップワイヤーの entityInside | 位置を問い合わせて判定 | 入った本人で判定。予約があれば無視。外れたら遅延 0 の予約 | 高速通過・再押下の間隔 |
| 爆発 | explode と finalizeExplosion の 2 段。中心とちょうど同じ位置のエンティティは飛ばす。火の乱数は爆発ごとの乱数 | 1 段。順は同じ。火は Level の乱数 | 結果は同じ。乱数の消費が違う |
| TNT | 威力 4 固定。tnt_explodes なし | explosion_power と tnt_explodes | 既定では同じ |
| ゲームルール名 | キャメルケース | スネークケース | 名前だけ |

### 6.2 26.2 → 26.3

| 点 | 26.2 | 26.3 | 効き |
|---|---|---|---|
| tick の前処理 | tickNonPassenger が位置の保存と tickCount を直接進める | commonTick にまとめた (無敵時間 −1 も) | 無し |
| 跳ね返りのしきい値 | 落下の速さが重力以上で跳ねる | 重力より大きいときだけ | 止まったものがスライム・ベッドの上で毎 tick 跳ねなくなった |
| bounceOn | 無し | 跳ねたブロックの bounceOn を呼ぶ | 使うのは棚キノコだけ |
| 移動の当たり判定 | 移動の範囲のエンティティ | 段差の高さぶん上にも広げる | 段差登り |
| 爆発 | チームを見ない・push | 元のチームが許すときだけダメージ・pushFromExplosion | レッドストーンには無し |
| ディテクターレールの checkPressed | 生存できるかだけ | その位置がまだディテクターレールかも見る | 置き換わった直後の再判定 |
| トリップワイヤーの解除 | 遅延 0 の予約 | 遅延 1 の予約 | 発火 tick は同じ (→ 02) |
| スライムのピストンが弾く相手 | サーバのプレイヤー以外 | 動きを計算できるもの (canSimulateMovement。プレイヤーとプレイヤーが操る乗り物を除く) | プレイヤー以外ではほぼ同じ |

### 6.3 26.3 → 26.4-pre-1 [版差 26.4-pre-1]

| 点 | 26.3 | 26.4-pre-1 | 効き |
|---|---|---|---|
| fallOn の位相 | move の中 | applyEffectsFromBlocks の中。stepOn → entityInside → fallOn の順。落下距離は記録した移動の y を合計し、流体の係数を掛ける | 耕地・カメの卵と entityInside の順 |
| 落下距離のリセット | move の中で 8 マス先まで光線 | 当たりの形の中心が fall_damage_resetting のブロックを通った時 | 落下距離 |
| 爆発の押し | 全エンティティ | 乗員でないものだけ (isPushedByExplosions)。プレイヤーには別のパケット | 乗員の扱い |
| 落下ブロックの水没の判定 | Fluids.WATER (水源の流体) と同じ種類か | 水の水源か (isSourceOfType) | **無し**。26.3 も水源でしか waterlogged にならない。書き換えだけ |
| トロッコ (従来の挙動) | 落下距離と fallOn は Entity#move の中 | Entity#move から外れたぶんを、AbstractMinecart#move の後で補う (落下距離を更新して fallOn を判定) | TNT 付きトロッコの落下爆発は残る。entityInside の後に判定する |
| 硫黄キューブ | 子供のときだけ中身を入れ替えない (SulfurCube#equipItem) | 点火済みのときも入れ替えない。種類ごとの「場所で効く効果」(EnchantmentLocationBasedEffect) を足した | 信号で点ける処理 (primeWhenOnPoweredPosition) は同じ |
| EntityTickList・範囲の問い合わせ・ホッパー・感圧板・ボタン・ディテクターレール・ターゲット | — | 実質同じ | 無し |

### 6.4 既存 fixture への影響

| fixture | エンティティ | 26.3 での有効性 |
|---|---|---|
| detector-rail-cart-pulse・detector-rail-comparator | 召喚したトロッコ | 有効とみてよい。どちらの版も今の位置の箱でレールに入り、検知は次の step の L12 |
| detector-rail-cart-stay | 乗り続けるトロッコ | 実機の正解としては有効。sim の既知の乖離 (skipUntil) |
| pressure-plate-wood・pressure-plate-stone | fake player | 板の側は同じ。踏む処理は凍結中の周で起きるので、t2 で点いて t22 で消える列は位相の差を受けにくい。ただし fake player を動かす位相は carpet しだいなので、26.3 で撮り直して確かめたい (§9.4) [要実機] |
| dispenser-no-insert | 射出されたアイテム | 有効。アイテムを観測していない |

---

## 7. Rust で実装するときの要点

### 7.1 段階的に範囲を広げる案

| 段階 | 入れるもの | 再現できるようになるもの | 主な仕事 |
|---|---|---|---|
| S0 (今の TS 相当) | エンティティ無し。エンティティ由来の入力は「手動トリガ + 決め打ちの持続」 | 感圧板・ターゲット・ディテクターレールの単発 | — |
| S1 在席表 | 物理を持たない「箱・種類・期間」の仮想エンティティ。L12 に entityInside 相当を出し、予約 tick の再判定は在席表を問い合わせる | 乗り続けるトロッコ・置かれたアイテム・刺さった矢・重量板の体数・額縁・中身のあるトロッコの読み | §4.1 の順の空間索引。種類の判定 (Entity・Living・AbstractArrow・Minecart・Item・Container) |
| S2 静的エンティティ | 位置が固定のエンティティ | ホッパーとエンティティのコンテナの転送 | Level の乱数 (E10)・ホッパーの entityInside |
| S3 運動 | Entity#move・applyEffectsFromBlocks・ItemEntity・PrimedTnt・FallingBlockEntity の tick・合体・水流・泡柱・ドロップの生成 (§4.22) | アイテムの水路とエレベーター・ホッパーへの落下・TNT の点火から爆発までの tick・砂の落下 | ブロックの当たり判定の形の表・経路のマス列挙・数値の型・泡柱の Level の乱数 |
| S4 爆発 | ServerExplosion (光線・露出・押し・破壊・ドロップ) | TNT による破壊と、それに続く近隣更新 | 乱数のモード (§7.4) |
| S5 トロッコ | OldMinecartBehavior | ディテクターレール・アクティベーターレールを使う回路 | 15 との境界 |
| S6 投射物 | 矢と投げ物 (ディスペンサーから) | ターゲット・木のボタン | 射出の誤差の乱数 |
| 範囲外 | 生き物の AI・プレイヤーの物理 | — | プレイヤーは入力の位相 (区間 A・B5) だけ持つ |

S1 だけで、今の TS の既知の乖離 (乗り続けるトロッコなど) は消える。物理を入れなくても、検知の意味論 (数え直し・再予約・除外) は保てる。
S3 以降はワールドにエンティティを持つことになり、今の方針 (docs/research/13 §2・§3 の「非実装 (恒久)」) と食い違う。入れるなら方針の見直しが先に要る (§9.1)。

### 7.2 データ構造

- エンティティの表: id は Java の int と同じ i32 の通し番号 (1 から。使用中を飛ばす。全ディメンションで共有)。tick の順は「挿入順の配列 + 除去の印」で持つ。L12 の入口で配列の長さを覚え、そこまでだけ回す。途中で足したものは末尾に付き、その tick には回らない。除去は印だけ付け、L12 の後に詰める。entity ticking から外れて戻ったものは末尾へ移す。
- 空間索引: セクションの鍵を Java と同じ詰め方 (上位から x 22 bit・z 22 bit・y 20 bit) の符号付き 64 bit にし、順序付きの木で持つ。問い合わせは x を小さい方から回し、各 x の範囲を鍵の順に取る (同じ x の中は z → y の順で、どちらも符号なしの並び)。セクションの中は挿入順の配列。セクションをまたぐと、古い配列から抜いて新しい配列の末尾に入る。
- 型で絞る問い合わせは、挿入順の配列を順に見て型で残すだけでよい (順が保たれる)。
- 移動の記録: 上限 100 件の両端キュー。超えたら先頭 2 件をまとめる。訪れたマスの集合は呼び出しごとに空にする。
- ブロックの当たり判定: S3 で必要になる。最初は「1 マス全体・空・感圧板 (当たり無し)・ホッパーの器・ハーフブロック」から始め、使うブロックごとに足す。entityInside の形 (トリップワイヤーの糸・大釜の水面) も同じ表に持つ。
- 予約 tick との境界: entityInside から積む予約は、その時点の gameTime で積む (→ 02)。L12 から積んだ遅延 d の予約は N+d の L6 で発火する。

### 7.3 数値

- 位置と速度は f64。Java で float の定数 (0.98F・0.2F・1.0E-5F・0.0625 の乗数に使う高さ 0.98F など) は f32 で作ってから f64 に広げる。当たり箱の半幅も f32 で割ってから広げる。
- 爆発の光線の威力は f32 で引き算する。1 歩の幅 0.3F は f64 の向きに掛ける前に広げる。
- 重量板の割合は f32 で割り、15 倍を切り上げる。
- TNT の初速の角度は、nextDouble に f32 の 2π (6.2831855) を広げた値を掛けて作る。sin と cos は Math.sin と Math.cos を使う (Mth の表引きではない)。最後のビットまで合わせるなら、Java と同じ fdlibm 系の実装を使う [要実機]。
- アイテムの health は int。ダメージ (f32) を引いた f32 を、0 の向きに切り捨てて int に戻す (Java のキャスト)。
- floor と ceil は Java の Mth と同じ (負の側へ切り捨て・正の側へ切り上げ) にする。

### 7.4 乱数 (決定性を壊す所)

Level の乱数もエンティティの乱数も、時刻から種を作る (RandomSupport#generateUniqueSeed)。実機の実行ごとに列が変わる。ルートテーブルのサーバの乱数列だけは、ワールドの種と保存された状態から決まる。sim はまず「どこで何回引くか」を合わせる (→ 18)。
エンティティの乱数は 1 体ごとに別の種なので、引く回数は他へ波及しない。波及するのは Level の乱数で、ランダム tick や予約 tick に渡る乱数と同じ列をずらす。

| 源 | 引く所 | 用途 | 回数 |
|---|---|---|---|
| Level の乱数 | ServerExplosion | 光線ごとの初期威力 (壊さない爆発でも引く) | 1352 回 / 爆発 |
| Level の乱数 | ServerExplosion | 壊すマスのシャッフル | 壊すマスの数 − 1 回 |
| Level の乱数 | ServerExplosion | 火 (fire のとき) | 壊すマスの数 |
| Level の乱数 | PrimedTnt の生成 | 初速の向き | 1 回 |
| Level の乱数 | TntBlock#wasExploded | 短い導火線 | 1 回 (生成の角度の後) |
| Level の乱数 | Block#popResource | ドロップの位置 | 1 束ごとに 3 回 (block_drops が偽でも引く) |
| Level の乱数 | DefaultDispenseItemBehavior#spawnItem | 射出の速さと 3 軸の誤差 | 1 回 + 三角分布 3 つ (各 2 回) |
| Level の乱数 | HopperBlockEntity#getEntityContainer | 相手のエンティティの選択 | 見つかったとき 1 回 |
| Level の乱数 | Entity#sendBubbleColumnParticles (泡柱の上端) | 粒子の位置 | 1 体・1 tick ごとに 8 回 |
| Level の乱数 | FarmlandBlock#fallOn | 踏みつけの判定 | 落ちるたびに 1 回 (生き物でなくても) |
| Level の乱数 | 投射物で傾いた大きなドリップリーフ | 音の高さ | 1 回 (→ 11) |
| Level の乱数 | アメジストの命中・フェンスゲートの爆発・雷の銅・カメの卵 | 音の高さ・銅の浄化・卵の割れ | 各 1 回以上 |
| サーバの乱数列 (random_sequence) | ブロックのルートテーブル | ドロップの量・爆発の減衰 | テーブルによる。Level の乱数とは別の列 (Xoroshiro。テーブルごとに 1 本) で、ワールドに保存される |
| エンティティの乱数 | Entity の生成 | UUID | 2 回 |
| エンティティの乱数 | ItemEntity の生成 | 向き・揺れの位相 (位置だけの生成なら初速の 2 回も) | 2〜4 回 |
| エンティティの乱数 | Projectile#getMovementToShoot | 射出の誤差 | 三角分布 3 つ (各 2 回) |
| エンティティの乱数 | AbstractArrow#onHitBlock・#startFalling | 刺さる音の高さ・落ちる時の速度 | 1 回・3 回 |
| エンティティの乱数 | Entity#moveTowardsClosestSpace | 押し出しの速さ | 1 回 |
| エンティティの乱数 | MinecartTNT | 爆発の威力・壊れた時の導火線 | 1 回・2 回 |
| エンティティの乱数 | 金床の落下・雷 | 欠けるか・閃光の回数と延長・火を置く位置 | 各 1 回以上 |

sim のモードの案:

1. 再現モード: Java の 48 bit の線形合同法 (LegacyRandomSource) を Level と各エンティティに 1 本ずつ持ち、種を与える。ルートテーブルの列は Xoroshiro で別に持つ。実機と数値を合わせたいときは、実機で撮った初速などを種の代わりに注入する。
2. 固定種モード: 既定の種で 1 を回す。sim の中では毎回同じになる。実機とは列が一致しない前提で使う。
3. 不確定の表示: 乱数で分かれる結果 (爆発の縁のマス・ホッパーの相手の選択) を、分かれうる所として UI に出す。

### 7.5 他のメモとの境界

| 境界 | こちら (17) | 相手 |
|---|---|---|
| 感圧板・トリップワイヤー・ボタン・ターゲット・避雷針・トラップチェスト | 数え方と時機 | 出力と更新先 → 09 |
| ホッパー | エンティティの問い合わせと乱数選択 | 転送の規則 → 14 |
| レール | トロッコの動きの概要 | 形と動力 → 15 |
| ピストン | 押されたエンティティの移動と作用 | 押し構造と呼ぶ時機 → 13 |
| 落下ブロック | エンティティの落下と着地 | 予約 tick と isFree → 16 |
| 振動 | エンティティが出す GameEvent と位相 | 伝わり方 → 10 |
| 乱数・反復順 | どこで引くか | 源の実装・HashSet の順 → 18 |
| 相 | エンティティ相の中身 | 相の並び・凍結 → 01 |

---

## 8. 検証用のプローブ回路案

どれも 26.3 の実機で tick ごとに撮る。エンティティの位置が要るものは、ハーネスにエンティティの位置と速度の dump を足す必要がある。

| # | 目的 | 配置 | 観測 | 期待 |
|---|---|---|---|---|
| P1 | TNT の点火の位相 | (a) ハーネスのレバー → TNT、(b) レバー → リピーター → TNT、(c) ピストンで運んだレッドストーンブロック → TNT。TNT の横に目印の羊毛 | 羊毛が空気になる tick | 点火の tick を N として、(b) の L6 なら N+79、(c) の L13 なら N+80。(a) は入力 t から t+80 [要実機] |
| P2 | 感圧板の居続けと解除 | 木の感圧板 → ダスト → ランプ。t2 にアイテムを板の上へ召喚、t30 に kill | 板の powered の列 | t3 で ON、t23 の再判定で維持、kill の後の t43 で OFF。石の板では ON にならない |
| P3 | 重量板の体数 | 金と鉄の重量板に、種類の違うアイテムを n 体 (合体しない) | POWER | 金 = n、鉄 = n ÷ 10 の切り上げ。同じ種類なら 40 tick 以内の合体の後に下がる |
| P4 | トリップワイヤーの再押下 | フック 2 個と糸。糸の上にアイテムを置き、kill する | 糸とフックの powered | 再判定は 10 tick ごと。解除の次の tick までは再び押されない |
| P5 | ディテクターレールの居続け | 既存の detector-rail-cart-stay を 26.3 で撮る | 20 tick ごとの再判定 | OFF にならない |
| P6 | ディテクターレールのアナログ値 | 中身のあるチェスト付きトロッコ・コマンドブロック付きトロッコ | 背面のコンパレーター | 中身の値・成功回数。2 台なら §4.1 の順の先頭 |
| P7 | ホッパーの吸い込みの順 | (a) ホッパーの上 1.2 にアイテムを召喚、(b) 種類の違う 2 体を順に召喚し、ホッパーの空きを 1 枠にする | ホッパーのコンパレーターと中身 | (a) 召喚の次の tick (L13) に吸う。(b) 先に召喚した方 (同じセクションなら入った順) を吸う |
| P8 | 額縁の読み | 導体越しのコンパレーターの 2 マス先に額縁。中身と回転を data で変える | コンパレーター | 回転 r で r + 1。同じ向きの額縁が 2 枚なら額縁は無視 |
| P9 | 落下ブロック | 下に h マスの空気がある位置へ砂を setblock | 砂の位置の列 | t+2 で空気、着地の tick は重力 0.04 と抵抗 0.98F の式どおり |
| P10 | 矢とボタン | ディスペンサー → 1 マス先の木のボタン | ボタンの powered | 射出の tick に ON。30 tick ごとの再判定で維持 |
| P11 | 矢とターゲット | ディスペンサー → 2 マス先のターゲット → ダスト | ダストの強さ | 1〜15 (誤差で変わる)。持続 20 |
| P12 | TNT 付きトロッコ | 通電したアクティベーターレールの上に TNT 付きトロッコ | 爆発の tick | 点火の tick + 80 |
| P13 | エンティティの順 | 2 体の TNT を順に召喚し、片方を少しずらす | 爆発後の位置 (エンティティの dump) | 表の順で結果が変わる |
| P14 | 接した的と矢 | (a) ディスペンサーの前に接してターゲット、(b) 1 マス空けてターゲット、(c) (a) と同じ配置で雪玉 | ターゲットの power | (a) 点かない (矢は的の中で刺さる)、(b) 1〜15 が 20 tick、(c) 点いて 8 tick [要実機] |
| P15 | ホッパーの entityInside の押し出し | 中身のあるホッパー (下にチェスト) の上にアイテムを召喚し、ホッパーの待ちが 0 の tick に落とす | チェストのコンパレーターとホッパーの中身 | アイテムが入る tick の L12 で押し出しも起きる (L13 を待たない) |
| P16 | 泡柱のアイテム | ソウルサンドの上に水 3 段の泡柱を作り、柱の上は空気にする。柱の底にアイテムを召喚する | アイテムの縦の速さと位置 (dump) | 柱の中は縦 + 0.06 (上限 0.7)、上端のマス (上が空気) では + 0.1 (上限 1.8)。速度の変化は次の tick の移動に効く |

---

## 9. 既存資料との食い違い

### 9.1 docs/research/13_scope-policy.md

| 該当 | 既存資料 | 26.3 の読み | 判断 |
|---|---|---|---|
| §3 感圧板・ターゲット・detector_rail | 手動トリガ + 一定 gt で自動 OFF | 実機は予約 tick で数え直し、居れば再予約する (§4.4・§4.7)。解除は退いてから 1〜20 tick | 方針としては正しい。乖離は「居続ける」場合に限る。S1 (在席表) で解消できる |
| §3 detector_rail のコンパレーター | 常に 0 (普通のトロッコなら実機も 0) | 普通のトロッコは 0 で一致。コマンドブロック付きは成功回数、コンテナ付きは中身の値 | 既存資料は正しい。範囲の注記だけ足すとよい |
| §3・§4.1 ピストンによる破壊 | アイテム化せず消滅 | 実機は Block#dropResources で ItemEntity を作る。中身はルートテーブルの乱数列、位置は Level の乱数で決まる (§4.22) | 方針として妥当。下に木の感圧板やホッパーがあると結果が変わる |
| §4.2 ドロッパーの前方が非コンテナ | 1 個消費して何も出さない | 実機は ItemEntity を射出する。木の感圧板・トリップワイヤー・ホッパーに届く | 方針として妥当。乖離が出る配置を README に足すとよい |
| §2 「エンティティを存在させない」 | 原則 | 物理を持たない在席表 (S1) は、ワールドにエンティティを出さずに検知の意味論だけを再現できる | 「手動トリガ + 折衷モデル」の延長として両立しうる。採否は 13 §5 の運用 (境界原則 → マトリクス) で決める |
| §3 エンティティ (モブ・プレイヤー・投射物・アイテムドロップ・トロッコ) | 非実装 (恒久) | 実機と全く同じ挙動を目指す Rust エンジンでは、S3〜S6 (§7.1) でアイテム・TNT・落下ブロック・トロッコ・投射物を持つことになる | **食い違う**。§7.1 の S3 以降は今の方針の外にある。入れるなら 13 の改訂が先。資料としては残す |

### 9.2 docs/research/16_nucleation-comparison.md §2.7・§2.1

| 該当 | 既存資料 | 26.3 の読み | 判断 |
|---|---|---|---|
| §2.1 エンティティ相 | Nucleation は種別ごとの固定順 (簡略化) | 実機は種類によらず EntityTickList の挿入順 1 本 | 26.3 が正。異なる種類が同じ tick に作用し合う回路 (TNT とアイテムなど) で Nucleation と実機が分かれうる |
| §2.7 ピストンによるエンティティの変位 | Nucleation はトロッコと凍結ボディだけ | 実機は IGNORE_ENTITY 以外すべて (アイテム・TNT を含む)。1 tick 1 軸 0.51 の上限 | 26.3 が正 |
| §2.7 乱数 | Nucleation は java.util.Random をビット単位で再現 | 実機の Level の乱数とエンティティの乱数は時刻から種を作るので、実行ごとに列が違う | ビット単位の再現は「どこで何回引くか」が合ってこそ意味を持つ。実機との一致は種を撮らない限り得られない |

### 9.3 docs/research/10_component-scope.md・02_behavior-spec.md

| 該当 | 既存資料 | 26.3 の読み | 判断 |
|---|---|---|---|
| 10 §3 判定対象の差 | 木はアイテム含む全エンティティ、石は Mob・プレイヤーのみ | 木は経験値オーブ・矢・TNT・落下ブロック・トロッコも数える。石は LivingEntity で、マーカーでない防具立ても押す。共通の除外は観戦者と isIgnoringBlockTriggers (コウモリなど) | 26.3 が正。石の側は言い換えが要る |
| 10 §3 消灯遅延 | エンティティ退去後の消灯遅延は 20gt | 直前の判定から 20 tick ごとの再判定。退いてから 1〜20 tick | 26.3 が正 |
| 10 §4 重量板 | 個数を上限で頭打ちにし切り上げ | 数えるのはエンティティの体数。スタックは 1 体。合体で減る | 式は正しい。「個数」は「体数」と書くべき |
| 02 §lever/button | 矢が刺さっている間は tick 毎に再延長 (木のみ) | 押下中の entityInside は無視される。30 tick ごとの再判定で矢がいれば再予約。押せるのは矢フラグが真の型 (竹・桜・真紅・歪み・ポプラを含む) | 26.3 が正。「tick 毎」は誤り |
| 02 §target | 持続は矢/トライデント 20、他 8 | 一致 (AbstractArrow かどうか) | 一致 |
| 02 §comparator (導体越し) | 1 マス先のコンテナ/額縁 (ItemFrame.getAnalogOutput) を読む | 額縁は、その 1×1×1 のマスにいて向きがコンパレーターの FACING と同じものが**ちょうど 1 体**のときだけ読む。2 体以上なら額縁は無いものとする。値はそのマスのブロックのアナログ値との大きい方 (§4.10・→ 07) | 26.3 が正。02 に条件を足すとよい |
### 9.4 tools/mc-harness/README.md

| 該当 | 既存資料 | 26.3 の読み | 判断 |
|---|---|---|---|
| summon の検出 | freeze 中は entityInside が走らないため、検出は召喚の次の tick step で起きる | 凍結中はプレイヤー以外のエンティティが tick されない。次の step の L12 でトロッコの最初の tick が作用する | 結論は同じ。理由をこの形に言い換えるとよい |
| step の板 | fake player を tp して entityInside を発火 | 凍結中もプレイヤーは凍結の対象外で、毎周 tick される。tp はパケットでも move でもないので、板への作用は次にそのプレイヤーの移動とブロック作用が回る所で起きる。接続を持つ普通のプレイヤーなら 1.21.1 はパケット処理の move の中、26.3 は B5 の doTick である。fake player は移動のパケットを送らないので、doTick をどの位相で回すかは carpet の実装しだいである (carpet のコードは読んでいない) | 1.21.1 の fixture は有効 (どちらにしても凍結中の周で踏み、t2 → t22 の列になる)。26.3 では撮り直して、どの位相で踏むかを確かめる [要実機] |

### 9.5 今の TS 実装 (packages/sim/src)

| 該当 | 今の実装 | 26.3 | 判断 |
|---|---|---|---|
| world.ts の感圧板・ディテクターレールの予約 tick | 予約 tick で必ず OFF にし、再予約しない | 数え直して、居れば再予約 | 既知の乖離 (detector-rail-cart-stay)。S1 で直る |
| world.ts のターゲット | 強さ 15・持続 20 固定 | 命中点で 1〜15、AbstractArrow 以外は 8 | 投射物を持たない前提の折衷。強さを UI で選べるとよい |
| world.ts の重量板 | 設定値 pressedPower を出す | 体数から計算 | 既知 (10 §4) |
| world.ts のトリガの位相 | activateBlock を tick の外 (入力と同じ境界) で適用。fixture-driver.ts は召喚を 1 tick 遅らせる | エンティティ由来の作用は L12 (L10 の後、L13 の前)。プレイヤーは B5 | dump の粒度では一致する。L13 と同じ tick に競る配置 (ピストンの着地・ホッパー) では違いうる [要実機] |
| 木のボタンと矢・トリップワイヤー | 無い | §4.5・§4.6 | 範囲外。入れるなら S1 |
| ドロッパーの前方が非コンテナ | 1 個減らして何も出さない | ItemEntity を射出 | 方針 (13 §4.2)。§9.1 |
| 砂・砂利 | 重力の無い固体 | 落下ブロック (§4.15) | 方針。→ 16 |
| TNT | 取り込み (mcToSim) で拒否する (docs/research/16 §2.6) | 信号で点き、PrimedTnt になって 80 tick 後に爆発する (§4.13・§4.14) | 方針。S3・S4 を入れるまで拒否のままでよい |
| ホッパーの entityInside の経路 | 無い (アイテムエンティティが無い) | L12 でアイテムが入ると、押し出しと吸い込みが L13 を待たずに走る (§4.9) | 方針。S3 で入れる |
| ディテクターレールのコンパレーター更新 | 状態が変わった時だけ出す | checkPressed のたびに出す | 手動モデルには数え直しが無いので実害なし |

---

## 10. 典拠一覧

- エンティティ相と表: 26.3 ServerLevel#tick (エンティティ相)・#tickNonPassenger・#tickPassenger・#getNextEntityId・内部クラス EntityCallbacks#onTickingStart・#onTickingEnd、TickRateManager#isEntityFrozen、EntityTickList#add・#remove・#forEach・#ensureActiveIsNotIterated、PersistentEntitySectionManager#addEntity・#updateChunkStatus・内部クラス Callback#onMove・#updateStatus・#onRemove、Entity#addPassenger
- 範囲の問い合わせ: 26.3 Level#getEntities・#hasEntities・#removeBlock、EntityGetter#getEntities・#getEntitiesOfClass、EntitySectionStorage#forEachAccessibleNonEmptySection・#getEntities、EntitySection#getEntities、ClassInstanceMultiMap#add・#find、LevelEntityGetterAdapter#get、SectionPos#asLong、EntitySelector (NO_SPECTATORS・ENTITY_STILL_ALIVE・CONTAINER_ENTITY_SELECTOR)、AABB#intersects・#collidedAlongVector
- 移動とブロック作用: 26.3 Entity#commonTick・#tick・#baseTick・#move・#collide・#restituteMovementAfterCollisions・#getBlockBounciness・#checkFallDamage・#applyEffectsFromBlocks・#applyEffectsFromBlocksForLastMovements・#addMovementThisTick・#checkInsideBlocks・#collidedWithShapeMovingFrom・#getOnPos・#getOnPosLegacy・#limitPistonMovement・#moveTowardsClosestSpace・#updateFluidInteraction・#isIgnoringBlockTriggers・#isLocalInstanceAuthoritative・#canSimulateMovement・#getPistonPushReaction・#ignoreExplosion、EntityDimensions#makeBoundingBox、LivingEntity#getEntityBounciness、BlockGetter#forEachBlockIntersectedBetween・#addCollisionsAlongTravel、BlockPos#betweenClosed・#betweenCornersInDirection、Direction#axisStepOrder、InsideBlockEffectApplier の StepBasedCollector#advanceStep・#applyAndClear・#flushStep、InsideBlockEffectType、BlockBehaviour#getEntityInsideCollisionShape
- 流体と泡柱: 26.3 Entity#updateFluidInteraction・#getFluidInteractionBox・#handleOnAboveBubbleColumn・#handleOnInsideBubbleColumn・#sendBubbleColumnParticles、EntityFluidInteraction#update・#applyCurrentTo、BubbleColumnBlock#entityInside、Projectile#onAboveBubbleColumn・#onInsideBubbleColumn
- プレイヤー: 26.3 ServerGamePacketListenerImpl#handleMovePlayer・#tickPlayer、ServerPlayer#tick・#doTick、LivingEntity#aiStep・#onEquipItem
- アイテム: 26.3 ItemEntity#tick・#setFluidMovement・#mergeWithNeighbours・#isMergable・#tryToMerge・#hurtServer・#ignoreExplosion・#setDefaultPickUpDelay、ExperienceOrb#tick、Block#popResource・#popResourceFromFace・#dropResources、DefaultDispenseItemBehavior#spawnItem、LootTable#getRandomItems、LootContext の Builder#create、MinecraftServer#getRandomSequence、RandomSequences#get、RandomSupport#generateUniqueSeed
- TNT と爆発: 26.3 PrimedTnt の生成・#tick・#explode・#getRandomShortFuse、TntBlock#onPlace・#neighborChanged・#prime・#wasExploded・#onProjectileHit・#dropFromExplosion、ServerLevel#explode、ServerExplosion#explode・#calculateExplodedPositions・#hurtEntities・#interactWithBlocks・#createFire・#getSeenPercent・#canTriggerBlocks・#shouldAffectBlocklikeEntities、ExplosionDamageCalculator#getEntityDamageAmount、EntityBasedExplosionDamageCalculator、Explosion の BlockInteraction、BlockBehaviour#onExplosionHit、DoorBlock#onExplosionHit、TrapDoorBlock#onExplosionHit、FenceGateBlock#onExplosionHit、LeverBlock#onExplosionHit、BellBlock#onExplosionHit、AbstractCandleBlock#onExplosionHit、ArmorStand#ignoreExplosion、Util#shuffle、WindCharge#explode、GameRules (tnt_explodes・tnt_explosion_drop_decay・block_explosion_drop_decay・mob_explosion_drop_decay・mob_griefing)
- 落下ブロック: 26.3 FallingBlock#onPlace・#updateShape・#tick・#isFree、FallingBlockEntity#fall・#tick・#causeFallDamage
- トロッコ: 26.3 AbstractMinecart#tick・#move・#applyEffectsFromBlocks・#getCurrentBlockPosOrRailBelow・#comeOffTrack・#getDefaultGravity、OldMinecartBehavior#tick・#moveAlongTrack・#getMaxSpeed、MinecartTNT#tick・#explode・#activateMinecart・#primeFuse・#destroy・#causeFallDamage、MinecartHopper#tick・#makeStepAlongTrack・#activateMinecart・#suckInItems、MinecartCommandBlock#activateMinecart、Minecart#activateMinecart、NewMinecartBehavior#getMaxSpeed・#moveAlongTrack
- 投射物: 26.3 Projectile#tick・#onHit・#onHitBlock・#getMovementToShoot・#spawnProjectileUsingShoot、ThrowableProjectile#tick、AbstractArrow#tick・#stepMoveAndHit・#onHitBlock・#shouldFall・#startFalling・#tickDespawn・#getWaterInertia、ThrownTrident#tick・#getWaterInertia・#tickDespawn、ProjectileDispenseBehavior#execute、ProjectileItem の DispenseConfig、ArrowItem#asProjectile、DispenserBlock#getDispensePosition、AmethystBlock#onProjectileHit
- 検知するブロック: 26.3 BasePressurePlateBlock#entityInside・#checkPressed・#tick・#getEntityCount、PressurePlateBlock#getSignalStrength、WeightedPressurePlateBlock#getSignalStrength・#getPressedTime、BlockSetType、TripWireBlock#getEntityInsideCollisionShape・#entityInside・#tick・#checkPressed、ButtonBlock#entityInside・#checkPressed・#onExplosionHit・#press、DetectorRailBlock#entityInside・#tick・#checkPressed・#getAnalogOutputSignal・#getSearchBB、TargetBlock#onProjectileHit・#getRedstoneStrength
- コンテナ: 26.3 HopperBlock#entityInside、HopperBlockEntity#entityInside・#tryMoveItems・#suckInItems・#getItemsAtAndAbove・#addItem・#getEntityContainer、Hopper の SUCK_AABB、DropperBlock#dispenseFrom、ContainerOpenersCounter#incrementOpeners・#decrementOpeners・#recheckOpeners・#getEntitiesWithContainerOpen、ChestBlockEntity#signalOpenCount、TrappedChestBlockEntity#signalOpenCount、ContainerUser
- 額縁: 26.3 ComparatorBlock#getInputSignal・#getItemFrame、ItemFrame#setItem・#setRotation・#getAnalogOutput・#survives・#createBoundingBox・#move・#push・#interact、BlockAttachedEntity#tick・#move・#push・#hurtServer・#ignoreExplosion
- その他: 26.3 LightningBolt#tick・#powerLightningRod・#getStrikePosition・#spawnFire・#clearCopperOnLightningStrike、PistonMovingBlockEntity#tick・#moveCollidedEntities・#moveEntityByPiston・#moveStuckEntities・#fixEntityWithinPistonBase、SulfurCube#tick・#tickFuse・#primeWhenOnPoweredPosition・#primeTime・#equipItem、SulfurCubeArchetypes、SignalGetter#getBestOwnOrNeighbourSignal、Block#pushEntitiesUp・#stepOn・#fallOn・#bounceOn、SlimeBlock#fallOn・#stepOn、FarmlandBlock#fallOn、TurtleEggBlock#stepOn・#destroyEgg、LayeredCauldronBlock#entityInside・#getEntityInsideCollisionShape、RedStoneOreBlock#stepOn、SculkSensorBlock#stepOn、BigDripleafBlock#entityInside・#onProjectileHit・#canEntityTilt・#setTiltAndScheduleTick
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の Entity・ServerLevel・EntityTickList・ItemEntity・PrimedTnt・TntBlock・FallingBlockEntity・Explosion (1.21.1)・ServerExplosion・AbstractArrow・TripWireBlock・BasePressurePlateBlock・ButtonBlock・TargetBlock・DetectorRailBlock・HopperBlockEntity・PistonMovingBlockEntity・SlimeBlock・AbstractMinecart・OldMinecartBehavior・MinecartTNT・ItemFrame・SulfurCube・FluidState・GameRules (diff -u)

---

## 付録: 網羅チェックで足したもの

網羅チェック (00_coverage.md の G-3・G-4) で、このメモにあるべきなのに抜けていたクラスをここに足す。
§1〜§10 の本文は変えていない。本文と重なる所は本文の節を参照する。確かさの表記は本文と同じである。

### A.1 ゴーレムとウィザーの組み立て (CarvedPumpkinBlock・WitherSkullBlock・WitherWallSkullBlock)

#### A.1.1 対象と範囲

| 分野 | 読んだクラス (26.3) |
|---|---|
| 組み立て | CarvedPumpkinBlock・WitherSkullBlock・WitherWallSkullBlock |
| 形の照合 | BlockPattern (内部クラス BlockPatternMatch)・BlockPatternBuilder・BlockInWorld・BlockPos#betweenClosed・Direction・Vec3i#cross |
| 呼び出し元 | BlockItem#place・#placeBlock、DispenseItemBehavior (carved_pumpkin と wither_skeleton_skull の登録)、PumpkinBlock#useItemOn、Enderman の内部クラス EndermanLeaveBlockGoal#tick、Level#setBlock、ServerLevel#updateNeighborsAt・#updateNeighboursOnBlockSet |
| 銅のチェスト | CopperChestBlock#getFromCopperBlock・#getLeastOxidizedChestOfConnectedBlocks・#chestCanConnectTo・#updateShape、ChestBlock#getChestType・#updateShape、WeatheringCopperCollection#zipApply |
| 出るエンティティ | SnowGolem#aiStep、CopperGolem#spawn、WitherBoss#makeInvulnerable・#customServerAiStep、EntityTypes の登録 (寸法) |

| 扱わない範囲 | 参照先 |
|---|---|
| ディスペンサーが置く・装備する・中身を残す条件 | → 12 §4.6・§9 |
| フラグ 2 と 3、SU と NC の配り方、/setblock の後始末 | → 04 §2.1・§4.2・§4.5・§4.11 |
| 出たエンティティの爆発・コンテナの開閉・感圧板 | → 本文 §4.14・§4.11・§4.4 |
| オブザーバーとランプの遅れ | → 08・11 §4.1 |
| 頭の POWERED | → 11 §4.11 |

#### A.1.2 状態とデータ

| ブロック | blockstate | BlockEntity | 押し反応 |
|---|---|---|---|
| carved_pumpkin・jack_o_lantern (どちらも CarvedPumpkinBlock) | FACING (水平 4 方向。既定は north。手で置くと置いた人の向きの逆) | 無し | POPPED (ピストンで壊れる。運べない) |
| wither_skeleton_skull (WitherSkullBlock) | ROTATION 0〜15・POWERED | SkullBlockEntity | POPPED |
| wither_skeleton_wall_skull (WitherWallSkullBlock) | FACING・POWERED | SkullBlockEntity | POPPED |

3 クラスとも信号を出さず、予約 tick もブロックイベントも積まない。頭の BlockEntity はサーバーでは ticker も持たない (動くのはクライアントの竜とピグリンの頭だけ) [26.3 読解: Blocks の登録, CarvedPumpkinBlock#getStateForPlacement, AbstractSkullBlock#getTicker]。

形の定義。行は上から、列は左から並べる。記号は「頭」「体」「空」の 3 つである [26.3 読解: CarvedPumpkinBlock の getOrCreate 系 6 つ, WitherSkullBlock#getOrCreateWitherFull・#getOrCreateWitherBase]。

| 形 | 幅 × 高さ | 行 | 頭 | 体 | 出る位置 (右・下) |
|---|---|---|---|---|---|
| 雪だるま | 1 × 3 | 頭 / 体 / 体 | carved_pumpkin か jack_o_lantern | snow_block | 右 0・下 2 (一番下の体) |
| アイアンゴーレム | 3 × 3 | 空 頭 空 / 体 体 体 / 空 体 空 | 同上 | iron_block | 右 1・下 2 (下段の中央) |
| 銅のゴーレム | 1 × 2 | 頭 / 体 | 同上 | ブロックタグ copper (copper_block・exposed_copper・weathered_copper・oxidized_copper と、その蝋引き 4 種) | 右 0・下 0 (**頭のマス**) |
| ウィザー | 3 × 3 | 頭 頭 頭 / 体 体 体 / 空 体 空 | wither_skeleton_skull か wither_skeleton_wall_skull | ブロックタグ wither_summon_base_blocks (soul_sand・soul_soil) | 右 1・下 2 (下段の中央) |

- 「空」は isAir (air・cave_air・void_air) である。奥行きはどれも 1 である。
- 出る座標は、出る位置のマスの (x + 0.5, y + 0.05, z + 0.5) である。ウィザーだけ y + 0.55。ゴーレムの向きは 0。ウィザーは、照合で決まった「前」の軸が X なら 0、そうでなければ 90。
- ディスペンサーが置く前に見る「土台の形」は、頭のマスを「何でもよい」に替えた形である。アイアンゴーレムの上段の両端は空のまま要る [26.3 読解: CarvedPumpkinBlock#canSpawnGolem, WitherSkullBlock#canSpawnMob]。

| 定数 | 値 | 典拠 |
|---|---|---|
| ウィザーの無敵 | 220 tick。体力は最大の 1/3 で出る | WitherBoss#makeInvulnerable |
| ウィザーの出現の爆発 | 無敵の数え下げが 0 になった tick。目の高さで威力 7・火なし・ExplosionInteraction は MOB | WitherBoss#customServerAiStep |
| 実績の判定 | ゴーレムは当たり箱を 5、ウィザーは 50 膨らませた範囲のプレイヤー。回路には効かない | CarvedPumpkinBlock#spawnGolemInWorld, WitherSkullBlock#checkSpawn |
| 寸法 (幅 × 高さ) | アイアンゴーレム 1.4 × 2.7・雪だるま 0.7 × 1.9・銅のゴーレム 0.49 × 0.98・ウィザー 0.9 × 3.5 | EntityTypes の登録 |

#### A.1.3 処理の詳細

契機 [26.3 読解]:

| 契機 | 入口 | 置く書き込み | 照合する形 |
|---|---|---|---|
| かぼちゃ類が置かれた。古い状態が同じブロックなら試さない (FACING だけ変える書き込みは対象外) | CarvedPumpkinBlock#onPlace → #trySpawnGolem | フラグ 512 を含まない全部。プレイヤー (BlockItem#placeBlock のフラグ 11)・ハサミで彫る (PumpkinBlock#useItemOn、11)・ディスペンサー (3)・エンダーマン (3)・/setblock と /fill (258) | 雪だるま → アイアンゴーレム → 銅のゴーレム。最初に合った 1 つだけ |
| プレイヤーがウィザーの頭 (床・壁) を置いた | BlockItem#place → setPlacedBy → WitherSkullBlock#checkSpawn | 先にフラグ 11 の書き込みが終わっている | ウィザー |
| ディスペンサーがウィザーの頭を置いた | DispenseItemBehavior → WitherSkullBlock#checkSpawn | 先にフラグ 3 の書き込みが終わっている | ウィザー |
| /setblock strict (818) などフラグ 512 付きの書き込み | onPlace が呼ばれない | — | 照合しない |
| /setblock・/fill でウィザーの頭を置いた | setPlacedBy が呼ばれない | — | 照合しない。**ウィザーは出ない** |

照合 (BlockPattern#find) の手順 [26.3 読解: BlockPattern#find・#matches・#translateAndRotate, BlockPos#betweenClosed]:

1. 起点 (置いたマス) から各軸 +0〜+(d − 1) の立方体を、形の「前・上・左の角」の候補にする。d は幅・高さ・奥行きの最大で、銅のゴーレムは 2、ほかは 3。候補の順は x が最も速く、次に y、最後に z。
2. 1 つの候補で「前」を Direction の宣言順 (下・上・北・南・西・東) に回し、その内側で「上」も同じ順に回す。上が前と同じ軸の組は飛ばす。1 候補につき 24 通りある。
3. 形のマス (右へ r・下へ k・奥へ f) の位置は「角 − 上 × k + 右 × r + 前 × f」である。右は外積「前 × 上」。前が南で上が上なら、右は西になる。
4. マスは r を外側に、k、f の順で調べる。1 つでも外れたらその組を捨てる。最初に全部合った組を返す。
5. 読んだ状態は、その照合の間キャッシュに残る。消した後の粒子と、銅のチェストの向き・酸化の段階は、このキャッシュ (消す前の状態) から読む。

この手順から次が言える。

- 向きの制限が無い。上下逆・横倒しの形も合う [26.3 読解] [要実機 PG1]。
- 起点が形に入っている必要は無い。立方体の中に角がある完成した形なら合う (§A.1.5 の 3)。
- 左右対称の形は、鏡写しの 2 組のうち先に回った方で見つかる。見つかった組で消す順が決まる。列の中は上の行から下の行へ進む。

| 形 (直立) | 腕の向き | 見つかる組 | 消す列の順 |
|---|---|---|---|
| アイアンゴーレム | x 軸に沿う | 角は頭の東の空。前 = 南・右 = 西 | 東 → 中央 → 西 |
| アイアンゴーレム | z 軸に沿う | 角は頭の南の空。前 = 西・右 = 北 | 南 → 中央 → 北 |
| ウィザー | x 軸に沿う | 最後の頭が西端なら、角はその頭で前 = 北・右 = 東。ほかは角が東端の頭で前 = 南・右 = 西 | 西端が最後なら西 → 中央 → 東。ほかは東 → 中央 → 西 |
| ウィザー | z 軸に沿う | 最後の頭が北端なら、角はその頭で前 = 東・右 = 南。ほかは角が南端の頭で前 = 西・右 = 北 | 北端が最後なら北 → 中央 → 南。ほかは南 → 中央 → 北 |

ゴーレムの組み立て [26.3 読解: CarvedPumpkinBlock#trySpawnGolem・#spawnGolemInWorld・#clearPatternBlocks・#updatePatternBlocks・#replaceCopperBlockWithChest・#getWeatherStateFromPattern]:

1. 雪だるまの形を照合する。合ってエンティティを作れたら、4〜7 を出る位置「右 0・下 2」で行って終わる。
2. アイアンゴーレムの形を照合する。合えば「プレイヤーが作った」印を付け、「右 1・下 2」で 4〜7 を行って終わる。
3. 銅のゴーレムの形を照合する。合えば「右 0・下 0」で 4〜7 を行い、続けて 8 と 9 を行う。
4. 形の全マスを空気にする。列 r = 0 → 幅 − 1、その中で行 k = 0 → 高さ − 1 の順である。1 マスごとに空気をフラグ 2 で書き、levelEvent 2001 (壊れる粒子と音。ID はキャッシュの状態のもの) を送る。空のマスも回る。
5. エンティティを出る座標に置き、世界に加える (addFreshEntity)。
6. 実績を判定する (範囲の問い合わせだけ)。
7. 4 と同じ順で、各マスについて ServerLevel#updateNeighborsAt (2 引数) を送り元 AIR で呼ぶ。
8. (銅のゴーレム) 銅のマスに銅のチェストをフラグ 2 で置く。種類は、銅のマス (キャッシュ) と同じ酸化段階の銅のチェストで、蝋引きなら蝋引きである。向きは頭の FACING (キャッシュ)。向きの左右の隣に、同じ向きで単独の銅のチェストがあれば LEFT か RIGHT にし、種類を酸化の弱い方に揃える。相方は、この書き込みの SU で TYPE と種類を合わせる (ChestBlock#updateShape・CopperChestBlock#updateShape)。
9. (銅のゴーレム) CopperGolem#spawn が酸化の段階を入れて音を鳴らす。段階は銅のマスの段階で、蝋引きは蝋を取った段階を使う。
10. どの形も合わなければ何もしない。頭のブロックは残る。

ウィザーの組み立て [26.3 読解: WitherSkullBlock#checkSpawn]:

1. 置いたマスの BlockEntity が SkullBlockEntity で、その状態がウィザーの頭 (床か壁) で、y が世界の下限以上で、難易度が peaceful でないときだけ進む。
2. ウィザーの形を照合する。合ってエンティティを作れたら次へ進む。
3. 形を消す。ゴーレムの手順 4 と同じ処理 (CarvedPumpkinBlock#clearPatternBlocks) を使う。
4. 出る座標に置き、向きを決め、無敵 220・体力 1/3 にする。
5. 実績の判定 → 世界に加える → 各マスの NC (ゴーレムの手順 7 と同じ)。

ディスペンサーの事前判定 (WitherSkullBlock#canSpawnMob) は、これに加えて y が下限 + 2 以上であることを要る (→ 12 §4.6)。

#### A.1.4 更新・予約・GameEvent

| 段 | 書き込み・通知 | フラグ | 出るもの | 出ないもの |
|---|---|---|---|---|
| 形のマスを空気に | Level#setBlock | 2 | 6 方向の SU (西・東・北・南・下・上)。オブザーバーが拾う。隣のダストは形だけ直す | NC・CU・撤去フック (→ 04 §5.8)。もとから air の空のマスは「変化なし」で何も出ない |
| 粒子 | Level#levelEvent 2001 | — | クライアントの粒子と音 | GameEvent |
| エンティティを加える | ServerLevel#addFreshEntity | — | — | ENTITY_PLACE などの GameEvent |
| 各マスの NC | ServerLevel#updateNeighborsAt (2 引数) | — | 6 方向の NC (西・東・下・上・北・南)。送り元は AIR。空のマスからも出る | CU・SU |
| 銅のチェスト | Level#setBlock | 2 | SU | NC・CU |

NC の数は、雪だるま 18 (3 マス × 6)・アイアンゴーレムとウィザー 54・銅のゴーレム 12 である。

外側の書き込みとの順 [26.3 読解: Level#setBlock, BlockItem#place, DispenseItemBehavior, ServerLevel#updateNeighboursOnBlockSet]:

| 経路 | 順 |
|---|---|
| カボチャ (フラグ 11・3) | チャンクへカボチャを書く → onPlace の中で照合・消去・生成・NC → 外側の setBlock は自分のマスを読み直し、空気なのでカボチャの NC・CU・SU を**出さない** (→ 04 §2.1 の 5)。プレイヤー・ディスペンサー・エンダーマンは最後に BLOCK_PLACE を、ハサミは SHEAR を出す (そのマスはもう空気) |
| カボチャ (/setblock・/fill、258) | 上と同じ。そのあと後始末 (ServerLevel#updateNeighboursOnBlockSet) が、置いたマスから送り元「今のブロック = 空気」の NC を 6 方向へもう 1 回出す。BLOCK_PLACE は出ない |
| 頭 (プレイヤー、11) | 頭を書く (頭の NC・SU が出る) → setPlacedBy で照合・消去・生成・NC → BLOCK_PLACE |
| 頭 (ディスペンサー、3) | 頭を書く (頭の NC・SU が出る) → BLOCK_PLACE → 照合・消去・生成・NC |

- 予約 tick とブロックイベント: 3 クラスとも積まない。予約が起きるのは、SU や NC を受けた隣 (オブザーバーの 2 tick・ランプの 4 tick など) である。
- 入れ子: 呼び出し元 (区間 A・L6・L12・区間 C) はどれも近隣更新の連鎖の外にいる。だから各マスの SU と NC の連鎖は、次のマスへ進む前に終わる (→ 04 §2.2)。
- 位相: 出たエンティティの最初の tick は本文 §2.3 の規則で決まる。プレイヤー・ハサミ (区間 A) とディスペンサー (L6) はその tick の L12 から動く。/setblock (区間 C) とエンダーマン (L12) は次の tick から動く。
- 乱数: 照合と消去は乱数を引かない。実験の機能 (REDSTONE_EXPERIMENTS) が有効なときだけ、手順 7 の 1 マスごとに Orientation を作るので Level の乱数を 1 回引く (→ 04 §4.9)。

出たエンティティが回路に触れる所:

| エンティティ | 作用 |
|---|---|
| 4 種とも | LivingEntity なので、感圧板 (石も)・トリップワイヤーを押す (本文 §4.4・§4.5) |
| 雪だるま | mob_griefing が真なら毎 tick、足元の高さで x・z を ±0.25 ずらした 4 点のマスを見る。空気で雪が置けるなら、snow をフラグ 3 で置いて BLOCK_PLACE を出す (SnowGolem#aiStep) |
| 銅のゴーレム | コンテナを開け閉めし、トラップチェストの数に入る (本文 §4.11・§4.20) |
| ウィザー | 出てから 220 回目の tick に爆発する (本文 §4.14)。傷を受けると 20 tick 後に周りのブロックを壊す (mob_griefing が真で、ブロックタグ wither_immune 以外。Level#destroyBlock なのでドロップが出る) |

#### A.1.5 端の場合と落とし穴

1. ゴーレムの判定はカボチャを置いたときだけ走る。体を後から足しても (ピストンで押し込んでも) 組み上がらない。カボチャはピストンで運べない (POPPED) ので、組み立て装置はカボチャをディスペンサーで最後に置く。
2. ウィザーの判定は「プレイヤーが置く」と「ディスペンサーが置く」の 2 つだけである。/setblock で 3 つ目の頭を置いても出ない。カボチャは /setblock でも組み上がる。実機ハーネスで撮るときに効く。
3. 照合は「起点を含む形」を探すのではない。起点から + 方向の立方体に角がある形なら合う。カボチャを先に置いて後から体を足した形 (完成しているが組み上がっていない) があると、その角が新しいカボチャの立方体 (各軸 0〜2) に入る位置へ別のカボチャを置いたとき、古い方が組み上がり、新しいカボチャは残りうる [26.3 読解] [要実機 PG6]。
4. 雪だるまの照合が先である。カボチャの下に雪が 2 段あり、別の向きにアイアンゴーレムの形もあるときは雪だるまになる。
5. 空は isAir なので、cave_air・void_air でもよい。そのマスは手順 4 で air に書き換わるので、そこからも SU が出る。
6. 消去はフラグ 2 なので撤去フックは走らない。ただし形のブロックに付いた部品 (レバー・ボタン・トーチ・はしごなど) は、消去の SU で生存できなくなって壊れる (→ 04 §4.6 の updateOrDestroy)。その壊れる書き込みと部品自身の NC は消去の途中 (エンティティを加える前) に起きる。手順 7 の NC はその後である。
7. 銅のチェストはフラグ 2 で置くので、CU も NC も出ない。隣のコンパレーターは次の更新まで古い値を持つ。銅のブロックも空のチェストも 0 なので、普通は差が出ない。
8. ディスペンサーの事前判定は、土台の形を同じ立方体の探し方で探すだけである。前のマスが形の頭の位置でなくても、土台の形の角が前のマスから + 方向の立方体 (各軸 0〜d − 1) に入っていれば置いてしまう。置いた後の照合で合わなければ、カボチャや頭はそこに残り、ディスペンサーの中身は 1 減る [26.3 読解] [要実機 PG5]。
9. ゴーレムは難易度を見ない。ウィザーは peaceful では出ない。そのときディスペンサーは頭を置かず、装備を試す (→ 12 §4.6)。実機ハーネスは peaceful で動く (tools/mc-harness/docker-compose.yml の DIFFICULTY)。
10. ウィザーの消す順は、どの頭を最後に置いたかで変わる (§A.1.3 の表)。形の周りに順に敏感な部品 (ダストの網・BUD のピストン) があると、結果が変わりうる。
11. ディスペンサーが置くカボチャは既定の状態 (FACING=north) である。銅のゴーレムを組むと、チェストも北を向く。jack_o_lantern にはディスペンサーの振る舞いの登録が無い (→ 12 §4.6)。

#### A.1.6 版差

担当クラスを diff -u で比べた。

| 点 | 1.21.1 | 26.2 | 26.3 → 26.4-pre-1 |
|---|---|---|---|
| 銅のゴーレム | 無い。銅のブロックの上のカボチャは何も起こさない。ディスペンサーも銅の土台ではカボチャを置かない [版差 1.21.1] | 有る (26.3 と同じ) | 同じ |
| 各マスの NC | Level#blockUpdated を呼ぶ。中身は同じ 6 方向の NC だが、NC が送り元の座標を運ぶ (→ 04 §6.4) [版差 1.21.1] | updateNeighborsAt | 同じ |
| フラグ 2 の消去と撤去フック | 撤去のフックはフラグを問わず呼ばれた (→ 04 §6.2)。形のブロックの撤去処理は BlockEntity を外すだけで NC を出さないので、差は出ない | 呼ばない | 同じ |
| 照合・組み立ての手順・定数 | 実質同じ (名前の変更など。形が合ったのにエンティティを作れなかったときの分岐だけ違うが、実際には起きない) | 同じ (codec の削除だけ) | 26.4-pre-1 は 3 クラスとも差分なし。BlockPatternBuilder は集合の作り方だけ |

#### A.1.7 Rust で実装するときの要点

- 照合は「状態を読む関数」と起点を受ける純粋な関数にする。返すのは (角・前・上) と、読んだ状態の写しである。回す順は Java と同じにする (候補の立方体は x → y → z、前と上は Direction の宣言順、マスは r → k → f)。右は「前 × 上」。
- 状態の写しは消去の後も使う。粒子・銅のチェストの向きと種類・ゴーレムの酸化はそこから読む。
- 設置フックはチャンクへの書き込みの中で呼び、フックの中で同じマスを書き換えてよいようにする (setBlock を再入可能にする)。外側の setBlock は書いた後に読み直し、頼んだ状態でなければ NC・CU・SU を出さずに戻る (→ 04 §7)。
- ウィザーの照合は設置フックではなく「プレイヤーかディスペンサーの設置の後」に置く。入口を分けて持ち、/setblock の入力では呼ばない。
- エンティティの物理を持たない段階 (本文 §7.1 の S0〜S2) でも、ブロック側 (フラグ 2 の消去・各マスの NC・銅のチェスト) は再現できる。エンティティは「種類・座標・tick」の出来事として記録するだけでよい。ウィザーの爆発は S4 が要る。
- 世界の設定として、難易度 (peaceful かどうか) と mob_griefing を持つ。

#### A.1.8 検証用のプローブ回路案

どれも 26.3 の実機で tick ごとに撮る。エンティティは本文 §8 の dump が要る。入力の tick を t とする。

| # | 目的 | 配置 | 観測 | 期待 |
|---|---|---|---|---|
| PG1 | 向きの制限が無いこと | 雪だるまの形を 3 組。(a) 直立、(b) 横倒し (頭の東に雪 2 個)、(c) 逆さ (頭の上に雪 2 個)。t にそれぞれの頭を /setblock | 形のマス・エンティティ | 3 組とも t に形が空気になり、頭から一番遠い雪のマス + (0.5, 0.05, 0.5) に雪だるまが出る |
| PG2 | フラグ 2 の SU と手順 7 の NC を分けて見る | 直立のアイアンゴーレム (腕は x 軸)。東の腕 E の東に、E へ出力するリピーター (E を強く充電する)。E の北にランプ (点いている)。E の南に E を見るオブザーバー、その出力にランプ。t に頭を /setblock | 2 つのランプ | t に E が空気になる。オブザーバーは SU を拾い、t+2 から 2 tick 光る。北のランプは手順 7 の NC で受電を失い、t+4 に消える。NC が無ければ点いたまま |
| PG3 | 銅のゴーレムとチェスト | (a) waxed_weathered_copper の上へ、t に carved_pumpkin (facing=east) を /setblock。(b) (a) の銅のマスの南隣に waxed_copper_chest (facing=east・単独) を置いておく | ブロック・エンティティ | (a) 頭のマスに銅のゴーレム (weathered)。銅のマスは waxed_weathered_copper_chest (facing=east)。(b) 二重チェストになり、新しいチェストも waxed_copper_chest に揃う |
| PG4 | ウィザーの 2 つの経路 | 先に /difficulty easy にする。ソウルサンドの T と頭 2 個を置き、3 つ目のマスの上に下向きのディスペンサー (頭入り)。(a) t にディスペンサーへ入力、(b) 3 つ目を /setblock | ブロック・エンティティ・爆発 | (a) t+4 の L6 で頭が置かれ、同じ tick に形が空気になってウィザーが出る。出てから 220 回目の tick (t+4 を 1 回目として t+223) に爆発する。(b) 何も起きない |
| PG5 | 事前判定の空振り | ディスペンサーの前のマス T を空気にし、T の東の真下に雪を 2 段 (T + (1, −1, 0) と T + (1, −2, 0))。カボチャ入りで発射する | T・ディスペンサーの中身 | T にカボチャが置かれ、雪だるまは出ず、中身は 1 減る |
| PG6 | 古い形が組み上がる | 雪 1 個の上に頭 X を置き、そのあと X の 2 つ下に雪を足す (完成しているが組み上がっていない形)。t に X の西隣へ頭 Y を /setblock | エンティティ・ブロック | X の形が組み上がり、Y は残る |

#### A.1.9 既存資料・今の実装との食い違い

| 該当 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| 12 §4.6 の carved_pumpkin・wither_skeleton_skull の行 | 前が空気でゴーレム (ウィザー) の形なら置く | 「形」は土台の形である。前のマスが頭の位置でなくても、土台の角が前のマスから + 方向の立方体に入っていれば置く (§A.1.5 の 8) | 12 の記述は正しい。この補足が要る [要実機 PG5] |
| 10 §4.12 の表 (ディスペンサーの GameEvent の行) | 頭とカボチャは、ウィザー・ゴーレムが組み上がるときだけ置いて block_place を出す | 置くのは土台が見つかったときである。ウィザーの 1 つ目と 2 つ目の頭は組み上がらずに残る。BLOCK_PLACE は、カボチャなら組み上がった後、頭なら組み上がる前に出る | 26.3 の読みが正。10 の言い回しは「土台があるときだけ置く」が正確 |
| docs/research/17_circuit-corpus.md §2.8 | wither-archive は「エンティティ寄り・優先度は低い」 | ウィザーを組む装置は、ディスペンサーの頭の経路 (§A.1.3) を通る | 優先度が低いのは同意。取り込むなら §A.1 の照合と消去が要る |
| 今の TS (packages/sim/src) | 照合もエンティティも無い。carved_pumpkin・jack_o_lantern・snow_block・iron_block・soul_sand は固体 (blocks/blockNames.ts)。ディスペンサーはカボチャ・頭を 1 個消して何もしない | 形があれば置いて組み上げ、形のブロックを消して NC を配る。土台が無ければ置かずに中身を残す | 方針 (13 §3) の範囲外。ディスペンサーが消す件は 12 §9 に既にある。コードは変えない |

### A.2 アレイ (Allay・AllayAi)

#### A.2.1 対象と範囲

| 分野 | 読んだクラス (26.3) |
|---|---|
| 本体 | Allay (内部クラス VibrationUser・JukeboxListener を含む)・AllayAi |
| 脳の行動 | GoAndGiveItemsToTarget・CountDownCooldownTicks・StayCloseToTarget・GoToWantedItem・Behavior・Brain#tick・ActivityData#createPriorityPairs・DoNothing・MoveToTargetSink・SetEntityLookTargetSometimes |
| 拾う・投げる | Mob#aiStep (拾う処理)・InventoryCarrier#pickUpItem・NearestItemSensor・BehaviorUtils#throwItem・BlockPosTracker |
| 振動 | VibrationSystem (内部の Listener・Ticker・User の既定)・GlobalPos#isCloseEnough・MemoryModuleType と GameEvent の登録・GameEvent タグ allay_can_listen・アイテムタグ duplicates_allays |

| 扱わない範囲 | 参照先 |
|---|---|
| 振動の届く範囲・遮蔽・候補の選び方・移動 | → 10 §4.3〜§4.6 |
| 音符ブロックが NOTE_BLOCK_PLAY を出す条件 | → 11 §4.2 |
| 投げたアイテムのその後 (落下・吸い込み) | → 本文 §4.12・§4.9 |
| 乱数の源と波及 | → 18 |
| ウォーデン | 網羅チェック (G-4) の対象外。消音の扱いは 10 §4.4.1 |

#### A.2.2 全体像

1. プレイヤーが物を渡すと、それが手の見本になり、渡した人が liked_player になる。
2. アレイは見本と同じ ItemEntity を探して拾い、持ち物 (1 枠) に入れる。
3. 16 以内で音符ブロックが鳴ると、振動として聞く。floor(距離) tick 後に、その音符ブロックを 600 tick 覚える。
4. 持ち物があれば、覚えた音符ブロックの 1 つ上のマスへ飛び、3.0 以内に入ったら 1 個ずつ投げる。
5. 600 tick の間に同じ音符ブロックが鳴らなければ忘れ、渡したプレイヤーへ運ぶ。

#### A.2.3 状態とデータ

| 値 | 中身 |
|---|---|
| 手の物 (MAINHAND) | 運ぶ物の見本。空なら何も拾わない |
| 持ち物 | 1 枠の SimpleContainer。見本と同じ物を 1 スタックまで |
| 記憶 liked_player | 物を渡したプレイヤーの UUID |
| 記憶 liked_noteblock | 覚えた音符ブロック (ディメンションと座標) |
| 記憶 liked_noteblock_cooldown_ticks | 覚えている残り。聞くたびに 600 |
| 記憶 item_pickup_cooldown_ticks | 投げた後に拾わない残り。投げるたびに 60 |
| 振動のデータ | 選択器と移動中の振動 (保存のキーは listener) |
| 踊り・複製の待ち | ジュークボックスで踊る印と、複製の待ち (6000) |

記憶は Brain.memories に保存されるので、/data get entity で読める [26.3 読解: LivingEntity の保存, MemoryModuleType の登録 (4 つとも codec を持つ)]。

| 定数 | 値 | 典拠 |
|---|---|---|
| 聞く半径 | 16。リスナーの位置は足元 + 目の高さ 0.36 | Allay の VibrationUser#getListenerRadius と位置の源 |
| 聞く GameEvent | タグ allay_can_listen (中身は note_block_play だけ) | VibrationUser#getListenableEvents |
| 振動の移動 | floor(距離) tick。3×3 チャンクの条件は無い | VibrationSystem.User の既定 |
| 覚えている時間 | 600 | AllayAi#hearNoteblock |
| 覚えた音符ブロックの有効距離 | 同じディメンションで、チェス盤距離 1024 以内 | GlobalPos#isCloseEnough |
| 欲しい物を探す | 当たり箱を横 32・縦 16 膨らませた箱。距離 32 未満で見通しが要る。近い順 | NearestItemSensor#doTick |
| 拾う範囲 | 当たり箱を各軸 1 膨らませた箱 | Allay#getPickupReach, Mob#aiStep |
| 速さ | 欲しい物へ 1.75 倍、配達先へ 2.25 倍 | AllayAi |
| 投げる距離 | 目から目標まで 3.0 未満 | GoAndGiveItemsToTarget#tick |
| 投げる初速 | 「目標 + 上へ 1」へ向く単位ベクトル × (0.2, 0.3, 0.2)。出る高さは目 − 0.2 | AllayAi#throwItem, BehaviorUtils#throwItem |
| 投げた後に拾わない | 60 | AllayAi |
| 渡しの行動の長さ | 20 | GoAndGiveItemsToTarget, Behavior#tryStart |
| 寸法 | 0.35 × 0.6 | EntityTypes の登録 |

#### A.2.4 処理の詳細

聞く [26.3 読解: VibrationSystem の Listener#handleGameEvent・Ticker#tick, Allay の VibrationUser, Allay#tick, AllayAi#hearNoteblock]:

1. 音符ブロックが鳴ると、そのマスの中心で NOTE_BLOCK_PLAY が出て、範囲内のリスナーへその場で配られる (→ 10 §4.1・11 §4.2)。アレイのリスナー (振動とジュークボックスの 2 つ) は、追跡が始まった時と、アレイのいるセクションが変わった時に、目の位置のセクションへ登録し直される [26.3 読解: ServerLevel の内部クラス EntityCallbacks#onTrackingStart・#onSectionChange, DynamicGameEventListener#move]。
2. 受け付けは 10 §4.4 と同じ順である。移動中の振動がある → isValidVibration (タグ・観戦者・スニーク・消音) → canReceiveVibration → 遮蔽 (羊毛) → 選択器へ。
3. canReceiveVibration は、NoAI なら偽。覚えた音符ブロックが無ければ真。あれば、同じディメンションでチェス盤距離 1024 以内、かつ発生位置 (整数ブロック) がその音符ブロックのときだけ真。**覚えている間は、ほかの音符ブロックを聞かない**。
4. 候補を選んで進めるのは VibrationSystem.Ticker#tick で、アレイの tick の最後 (L12。移動と脳の処理の後) に走る。選択器の決まりは 10 §4.5 と同じである。GameEvent が gameTime N に出て、距離 (発生位置とアレイの目の距離) が d なら、届くのは N + max(1, floor(d)) のアレイの tick である。
5. 届くと AllayAi#hearNoteblock を呼ぶ。覚えていなければ位置と 600 を入れる。同じ音符ブロックなら 600 に戻す。違えば何もしない。
6. onDataChanged は何もしない。コンパレーター更新は出ない。

覚えている間 [26.3 読解: CountDownCooldownTicks#canStillUse・#tick・#stop, AllayAi#getItemDepositPosition・#shouldDepositItemsAtLikedNoteblock, StayCloseToTarget#create, Brain#tick]:

1. 聞いた tick を A とする。A+1 から脳の処理で毎 tick 1 減り、A+600 に 0 になる。A+601 の脳の処理の後段 (動いている行動を回す段) で、数え下げの記憶が消える。
2. 配達先は、記憶が有効なら音符ブロックの 1 つ上のマスの中心である。有効とは「同じディメンションでチェス盤距離 1024 以内」「その位置がまだ note_block」「数え下げの記憶がある」の 3 つを満たすこと。
3. 無効と分かった問い合わせで音符ブロックの記憶も消し、渡したプレイヤー (サバイバルかクリエイティブで、距離 64 未満) へ戻る。問い合わせは毎 tick の脳の処理で StayCloseToTarget などが行う。数え下げが切れた場合は、A+602 の脳の処理の前段 (止まっている行動を始める段) に消える [要実機 PA2]。音符ブロックを壊すか別のブロックにすると、次の問い合わせで消える。

行動。優先度は小さい方が先に回る [26.3 読解: AllayAi#initCoreActivity・#initIdleActivity, ActivityData#createPriorityPairs]。

| 活動・優先度 | 行動 | 中身 |
|---|---|---|
| 核 0〜3 | 泳ぐ・逃げる・見る・動く | — |
| 核 4・5 | 数え下げ 2 つ | liked_noteblock_cooldown_ticks と item_pickup_cooldown_ticks |
| 待機 0 | GoToWantedItem | 見えた欲しい物へ 1.75 倍で飛ぶ |
| 待機 1 | GoAndGiveItemsToTarget | 持ち物があり配達先があれば 2.25 倍で向かう。目から目標まで 3.0 未満なら 1 個投げ、拾わない残りを 60 にする |
| 待機 2 | StayCloseToTarget | 欲しい物が見えず、配達先から 16 以上離れていれば近づく (4 まで) |
| 待機 3・4 | 見回す・うろつく | — |

拾う [26.3 読解: Mob#aiStep, Allay#canPickUpLoot・#wantsToPickUp, InventoryCarrier#pickUpItem]:

1. 拾うのは、拾わない残りが無く、手に物があり、ゲームルール mob_griefing が真のときだけである。
2. 当たり箱を各軸 1 膨らませた箱の ItemEntity を、本文 §4.1 の順に見る。消えておらず、空でなく、pickupDelay が 0 で、見本と同じ物 (ポーションは中身も同じ) で、持ち物に入るものを拾う。
3. 入った数だけ ItemEntity を減らす。全部入れば ItemEntity を消す。

投げる [26.3 読解: GoAndGiveItemsToTarget#start・#tick, AllayAi#throwItem, BehaviorUtils#throwItem, Behavior#tryStart・#tickOrStop・#timedOut]:

1. 持ち物から 1 個取り、目 − 0.2 の高さ (x・z は自分) に ItemEntity を作る。初速は定数の表のとおり。pickupDelay は 10。作るのは L12 の中なので、そのアイテムの最初の tick は次の tick である (本文 §2.3)。
2. gameTime が 7 の倍数の tick だけ、音を出すかを Level の乱数で決める。nextDouble を 1 回引き、0.9 未満なら音の高さにもう 1 回 (nextInt) 引く。
3. 渡しの行動が動いている間は、毎 tick 1 個投げる。行動は始めた tick を T として T+20 まで動き、T+21 に止まり、T+22 にまた始まる。届く範囲にい続ければ、22 tick に 21 個のペースになる [要実機 PA5]。

#### A.2.5 更新・予約

- アレイはブロックを書かない。予約 tick・ブロックイベント・コンパレーター更新も出さない。
- 回路との接点は 3 つである。(1) 音符ブロックの NOTE_BLOCK_PLAY を聞く (入力)。(2) ItemEntity を拾って消す・投げて作る (出力。ホッパー・感圧板・トリップワイヤーに届く。本文 §4.4・§4.5・§4.9)。(3) Level の乱数を引く。
- Level の乱数を引く所 [26.3 読解: Behavior#tryStart, DoNothing, MoveToTargetSink, SetEntityLookTargetSometimes, AllayAi#throwItem]:
  1. Behavior を継承する行動は、始まるたびに長さを決める nextInt を 1 回引く。長さが固定の行動 (数え下げ・渡しの行動) でも引く。
  2. DoNothing・MoveToTargetSink・SetEntityLookTargetSometimes も、それぞれの所で引く。
  3. 投げる音は「投げる」の 2 のとおり。
  4. アレイのいる回路では、ホッパーの相手選び・爆発・ディスペンサーのスロット選びなど、ほかの Level の乱数の結果がずれる (本文 §7.4・→ 18)。
- 踊り (JukeboxListener): 半径 10 で JUKEBOX_PLAY を受けると踊り、JUKEBOX_STOP_PLAY で止める。踊っている間に、プレイヤーがアイテムタグ duplicates_allays (amethyst_shard) の物を渡すと 1 体増える (待ち 6000)。レッドストーンでジュークボックスを鳴らせても、増やすのはプレイヤーの操作だけである。

#### A.2.6 端の場合と落とし穴

1. 覚える音符ブロックは 1 つだけである。覚えている間は、近くでほかの音符ブロックが鳴っても聞かない。仕分けの列が、隣の列の音に引きずられない理由である。
2. 振動を 1 つ運んでいる間 (最大 16 tick) は、新しい音を捨てる。
3. 音符ブロックは真上が空気 (か頭) のときしか鳴らず、NOTE_BLOCK_PLAY も出ない (→ 11 §4.2)。真上にホッパーを置くと聞こえない。
4. 羊毛で遮れる (→ 10 §4.4.3)。6 本の線分がすべて羊毛に当たる配置が要る。
5. mob_griefing が偽だと、拾わず、欲しい物も探さない。
6. ホッパーの吸い込みは pickupDelay を見ない (HopperBlockEntity#getItemsAtAndAbove)。投げた直後の物もすぐ吸われる。
7. 600 の数え下げはアレイの tick で進む。凍結中 (/tick freeze) と、entity ticking でないチャンクでは止まる (→ 01)。
8. NoAI のアレイは聞かない。
9. 1 スタック (64 個) を渡し終えるには、届く範囲に着いてから約 67 tick かかる (22 tick に 21 個) [要実機 PA5]。

#### A.2.7 版差

担当クラスを diff -u で比べた。

| 点 | 1.21.1 | 26.2 | 26.3 | 26.4-pre-1 |
|---|---|---|---|---|
| 覚えた音符ブロックの有効距離 (聞くとき・運ぶとき) | 同じディメンションなら距離を問わない [版差 1.21.1] | チェス盤距離 1024 以内 | 同じ | 同じ |
| 投げる処理の置き場所 | GoAndGiveItemsToTarget の中 | 同じ | AllayAi#throwItem に移った | 同じ |
| 複製に使う物 | amethyst_shard 固定 | アイテムタグ duplicates_allays (中身は amethyst_shard) | 同じ | 同じ |
| 10 tick ごとの回復 | heal | heal | heal | healNaturally に変わった (回路には効かない) |

聞く半径 16・覚える 600・拾わない 60・投げる距離 3.0・初速の掛け率 (0.2, 0.3, 0.2)・7 の倍数の tick の音の乱数は、4 版とも同じである。

#### A.2.8 Rust で実装するときの要点

- アレイは脳と、飛ぶ経路探索を持つ。本文 §7.1 の「範囲外 (生き物の AI)」に入れ、エンジンでは動かさない。
- 境界として守ること:
  1. 音符ブロックの NOTE_BLOCK_PLAY を、スカルクセンサーと同じ位相・位置で出す (→ 10・11)。アレイを入れるかどうかに関係なく要る。
  2. アレイを含む回路には、決定性が崩れる注記を出す。アレイの脳はほぼ毎 tick Level の乱数を引く (§A.2.5)。
  3. どうしても扱うなら、本文 §7.1 の S1 の在席表に「覚えた音符ブロック・数え下げ・移動中の振動」だけを持つ仮想の聞き手を足す。配達は物理と経路探索が要るので、S3 より後である。

#### A.2.9 検証用のプローブ回路案

入力の gameTime を N とする (10 §2.2 と同じ数え方)。

| # | 目的 | 配置 | 観測 | 期待 |
|---|---|---|---|---|
| PA1 | 聞いて覚える tick | アレイを 1 マスのガラスの部屋に閉じ込める。距離 d (例 6) に音符ブロック (真上は空気) とレバー。N にレバーを入れる | /data get entity で Brain.memories の liked_noteblock と数え下げ | N + max(1, floor(d)) の tick に liked_noteblock が入り、数え下げは 600 |
| PA2 | 600 の数え下げ | PA1 の後、鳴らさずに待つ。別の回では途中でもう一度鳴らす | 数え下げの値と記憶の有無 | 聞いた tick A から 600 → 0。A+601 に数え下げ、A+602 に liked_noteblock が消える。途中で鳴らせば 600 に戻る |
| PA3 | 1 つしか聞かない | 16 以内に音符ブロック N1・N2。N1 を鳴らし、数 tick 後に N2 | liked_noteblock | N1 のまま。忘れた後なら N2 |
| PA4 | 羊毛の遮蔽 | PA1 の部屋と音符ブロックの間を羊毛の壁 (3 × 3) で塞ぐ | 記憶 | 覚えない |
| PA5 | 投げる間隔 | 石を持たせたアレイを自由にし、石の ItemEntity (64 個・1 体) を置く。音符ブロックを鳴らし続け、周りの床をホッパーにする | 投げた ItemEntity の数と tick (dump)・ホッパーの中身 | 範囲に着いてから 22 tick に 21 個。mob_griefing が偽なら拾わない |

#### A.2.10 既存資料・今の実装との食い違い

| 該当 | 既存の記述 | 26.3 の読み | 判断 |
|---|---|---|---|
| 10 §1.2 | 「ウォーデン・アレイ → 17」とするが、17 の本文に無かった | §A.2 に書いた | 解消。ウォーデンは網羅チェック (G-4) の対象外なので、ここでも扱わない |
| 今の TS (packages/sim/src) | エンティティも GameEvent も無い (スカルクセンサーも未実装) | — | 方針 (13 §3) の範囲外。比べる対象が無い |

### A.3 典拠一覧 (付録)

- 組み立て: 26.3 CarvedPumpkinBlock#onPlace・#canSpawnGolem・#trySpawnGolem・#spawnGolemInWorld・#clearPatternBlocks・#updatePatternBlocks・#getWeatherStateFromPattern・#replaceCopperBlockWithChest・#getStateForPlacement・#getOrCreateSnowGolemBase・#getOrCreateSnowGolemFull・#getOrCreateIronGolemBase・#getOrCreateIronGolemFull・#getOrCreateCopperGolemBase・#getOrCreateCopperGolemFull、WitherSkullBlock#setPlacedBy・#checkSpawn・#canSpawnMob・#getOrCreateWitherFull・#getOrCreateWitherBase、WitherWallSkullBlock#setPlacedBy
- 照合: 26.3 BlockPattern#find・#matches・#translateAndRotate・#createLevelCache、BlockPattern の内部クラス BlockPatternMatch#getBlock・#getForwards、BlockPatternBuilder#aisle・#where・#createPattern (空白は何でもよい)、BlockInWorld#getState・#hasState、BlockPos#betweenClosed、Vec3i#cross、Direction (宣言順)
- 呼び出し元と書き込み: 26.3 BlockItem#place・#placeBlock、PumpkinBlock#useItemOn、Enderman の内部クラス EndermanLeaveBlockGoal#tick、DispenseItemBehavior (carved_pumpkin・wither_skeleton_skull の登録)、Level#setBlock・#levelEvent、ServerLevel#updateNeighborsAt・#updateNeighboursOnBlockSet、Blocks の登録 (押し反応)、AbstractSkullBlock#getTicker、ブロックタグ copper・wither_summon_base_blocks
- 銅のチェスト: 26.3 CopperChestBlock#getFromCopperBlock・#getLeastOxidizedChestOfConnectedBlocks・#chestCanConnectTo・#updateShape、ChestBlock#getChestType・#updateShape、WeatheringCopperCollection#zipApply、CopperGolem#spawn
- 出るエンティティ: 26.3 SnowGolem#aiStep、WitherBoss#makeInvulnerable・#customServerAiStep・#canDestroy・#hurtServer、EntityTypes の登録 (IRON_GOLEM・SNOW_GOLEM・COPPER_GOLEM・WITHER・ALLAY)
- アレイ: 26.3 Allay#tick・#aiStep・#customServerAiStep・#canPickUpLoot・#wantsToPickUp・#pickUpItem・#getPickupReach・#setJukeboxPlaying・#mobInteract・#updateDynamicGameEventListener・#addAdditionalSaveData、Allay の内部クラス VibrationUser#getListenerRadius・#canReceiveVibration・#onReceiveVibration・#getListenableEvents と JukeboxListener#handleGameEvent、AllayAi#initCoreActivity・#initIdleActivity・#updateActivity・#hearNoteblock・#getItemDepositPosition・#shouldDepositItemsAtLikedNoteblock・#getLikedPlayer・#throwItem・#hasItemToThrow
- 脳: 26.3 Brain#tick・#startEachNonRunningBehavior・#tickEachRunningBehavior、ActivityData#createPriorityPairs、Behavior#tryStart・#tickOrStop・#timedOut、CountDownCooldownTicks#canStillUse・#tick・#stop、GoAndGiveItemsToTarget#checkExtraStartConditions・#start・#tick・#canThrowItemToTarget、StayCloseToTarget#create、GoToWantedItem#create、DoNothing、MoveToTargetSink、SetEntityLookTargetSometimes、BehaviorUtils#throwItem、BlockPosTracker#currentPosition、NearestItemSensor#doTick、Mob#aiStep、InventoryCarrier#pickUpItem、HopperBlockEntity#getItemsAtAndAbove、LivingEntity の保存 (Brain)
- 振動: 26.3 VibrationSystem の内部 Listener#handleGameEvent・Ticker#tick・#receiveVibration・User#isValidVibration・#calculateTravelTimeInTicks・#requiresAdjacentChunksToBeTicking・#onDataChanged、ServerLevel の内部クラス EntityCallbacks#onTrackingStart・#onSectionChange、DynamicGameEventListener#move、GlobalPos#isCloseEnough、MemoryModuleType の登録 (liked_player・liked_noteblock・liked_noteblock_cooldown_ticks・item_pickup_cooldown_ticks)、GameEvent の登録 (NOTE_BLOCK_PLAY・JUKEBOX_PLAY・JUKEBOX_STOP_PLAY)、GameEvent タグ allay_can_listen、アイテムタグ duplicates_allays
- 版差の確認: 1.21.1・26.2・26.4-pre-1 の CarvedPumpkinBlock・WitherSkullBlock・WitherWallSkullBlock・BlockPattern・BlockPatternBuilder・BlockInWorld・Allay・AllayAi・GoAndGiveItemsToTarget・Behavior・CountDownCooldownTicks・BehaviorUtils・CopperChestBlock・CopperGolem・PumpkinBlock・SnowGolem (diff -u)
