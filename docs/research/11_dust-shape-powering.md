# 11. ダスト形状 × 隣接給電の vanilla 突き合わせ (#44)

I8 (#16) の observer-piston fixture 生成中に、単一接続 (直線形状) のダストが隣接ピストンへ
給電する挙動が sim と実機でずれる疑いが出た (PR#42。fixture はレバー直付けに回避)。
本メモは 26.2 デコンパイルでダストの給電規則を厳密に確定し、`packages/sim/src/power.ts` の
実装と形状×方向で突き合わせた結果をまとめる。

参照: 02 §5.4 / §6 wire、`RedStoneWireBlock.java` (out/26.2)、
実装検証テスト `packages/sim/test/wire-shape-power.test.ts`。

---

## 1. デコンパイル典拠 [確定: 26.2 net/minecraft/world/level/block/RedStoneWireBlock]

### 1.1 給電方向 (`getSignal` / `getDirectSignal`)

```java
protected int getSignal(state, level, pos, direction) {
   if (this.shouldSignal && direction != Direction.DOWN) {
      int power = this.ownSignal(state, level, pos);      // = POWER
      if (power == 0) return 0;
      return direction != Direction.UP
            && !this.getConnectionState(level, state, pos)
                 .getValue(PROPERTY_BY_DIRECTION.get(direction.getOpposite())).isConnected()
         ? 0 : power;
   }
   return 0;
}
protected int getDirectSignal(state, level, pos, direction) {
   return !this.shouldSignal ? 0 : state.getSignal(level, pos, direction);   // 通常時は getSignal と同値
}
```

`direction` は「被給電ブロックから見たダストの方向」= ダストは `direction.getOpposite()` 側の
ブロックへ給電する。整理すると:

| 被給電ブロックの位置 | `getSignal` の `direction` | 判定 | 結果 |
|---|---|---|---|
| ダストの**真下** (足元) | UP | `direction==UP` → 短絡で power | **給電 (power)** |
| ダストの**真上** | DOWN | 外側 `if` が false | **給電しない (0)** |
| ダストの**水平隣接** H | OPPOSITE[H] | `getConnectionState` の H 方向が接続なら power | **接続時のみ給電** |

- **強充電/弱充電**: `getDirectSignal` は `shouldSignal` 中は `getSignal` と同値。よって足元・接続方向の
  導体は **strong 充電される**が、別のダストの強度計算中は `shouldSignal=false` になり 0 を返すため、
  ダスト由来の充電は**他のダストの強度計算には寄与しない** (= 実質「弱充電」)。機構 (piston/lamp/torch/
  repeater 等) の入力判定は `shouldSignal=true` の文脈なので strong が効く (02 §5.4)。

### 1.2 形状の自動拡張 (`getConnectionState` → `getMissingConnections`) — #44 の核心

`getSignal` は**保持中の blockstate ではなく `getConnectionState` を毎 query 再計算**して接続を見る。
`getConnectionState` は物理接続 (`getMissingConnections`) に次の拡張を掛ける:

```java
boolean wasDot = isDot(state);
state = getMissingConnections(...);               // 物理接続を再導出
if (wasDot && isDot(state)) return state;         // 元も今も dot → 拡張しない
boolean nsEmpty = !north && !south, ewEmpty = !east && !west;
if (!west  && nsEmpty) state = SIDE(WEST);        // 接続 1 本 → 反対軸を SIDE = 直線化
if (!east  && nsEmpty) state = SIDE(EAST);
if (!north && ewEmpty) state = SIDE(NORTH);
if (!south && ewEmpty) state = SIDE(SOUTH);
```

- 物理接続 **0 本** → cross (4 方向 SIDE)。孤立ダストは cross であって dot ではない
  (dot は `useWithoutItem` の手動トグルでのみ生じ、周囲に接続対象が無い場合だけ保持される)。
- 物理接続 **1 本** → その反対側も SIDE = **直線**。∴ 直線ダストは
  **物理接続の無い「延長端」にも給電し**、接続していない**垂直方向 (90°) には給電しない**。
- 物理接続 **2 本以上** (bend / T / cross) → 拡張なし (`nsEmpty` / `ewEmpty` がいずれも false)。

`shouldConnectTo` (接続対象): redstone_wire / repeater (前後面) / observer (facing 面) /
`isSignalSource()` (lever・button・torch・redstone_block・target・comparator は 4 面) [確定]。
**ピストン・ランプ・素の固体は非接続** → これらだけに囲まれた孤立ダストは cross になる。

---

## 2. 形状×方向 給電マトリクス [確定: 26.2]

`power=15` のダスト (0,0,0) が各方向のブロックへ給電するか (○=給電 / −=しない)。
sim 実測は `wire-shape-power.test.ts` の `isBlockPowered` プローブ。**全 30 セルでデコンパイルと一致**。

| 形状 (connections) | east | west | north | south | up (真上) | down (足元) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| **cross** (N/S/E/W) | ○ | ○ | ○ | ○ | − | ○ |
| **直線 E-W** (E/W) | ○ | ○ | − | − | − | ○ |
| **直線 N-S** (N/S) | − | − | ○ | ○ | − | ○ |
| **bend N-E** (N/E) | ○ | − | ○ | − | − | ○ |
| **T N-E-S** (N/E/S) | ○ | − | ○ | ○ | − | ○ |
| **dot** (接続なし) | − | − | − | − | − | ○ |

読み手側の確認 (同テスト):

- **直線 E-W**: 延長端 (east) のランプ点灯・トーチ (east 固体上) 消灯・ピストン (east) 伸長。
  垂直 (north) のランプ消灯・トーチ点灯・ピストン非伸長。 ← **#44 の疑いの切り分け**。
- **cross**: 水平 4 方向のランプ全点灯、真上のランプ消灯。
- **dot**: 水平 4 方向すべて消灯、足元のランプのみ点灯。

---

## 3. sim 実装との突き合わせ結果 — **ずれ無し**

`power.ts` の `getEmittedSignal` (wire ケース):

```ts
case 'wire': {
  if (src.power === 0) return 0
  if (toDir === 'down') return src.power           // 足元へ給電
  if (toDir === 'up') return 0                     // 真上へは給電しない
  return src.connections[toDir as HDir] ? src.power : 0   // 接続方向のみ
}
```

これは §1.1 の `getSignal` と方向規則が完全一致する。唯一の差は、vanilla が `getConnectionState` を
**query 毎に再計算**して接続 (直線拡張含む) を求めるのに対し、sim は `WireState.connections` を
**静的に保持**する点。ただし静的接続は次の 2 経路で **vanilla の拡張済み形状**として与えられる:

- `mcstate.mcToSim`: fixture / NBT の blockstate 文字列を読む。vanilla は blockstate を拡張済みで
  保存する (単一接続ダストは既に `north=side,south=side` 等) ため、直線・cross がそのまま入る。
- `editor.computeWireConnections`: 接続 **0 本→cross / 1 本→直線** の拡張を実装済み
  (`packages/editor/src/wire-connect.ts` L86-98)。bend/T/cross は拡張なし。両者とも §1.2 と一致。

∴ `power.ts` に到達する時点で `connections` は vanilla の `getConnectionState` 出力と等価。
**給電規則そのもの (power.ts) に vanilla とのずれは無い**。#44 の「疑い」は実装バグではなく、
**「直線ダストは延長端にのみ給電し、垂直の隣接ブロックには給電しない」という vanilla 仕様**
(fixture 作成時の罠) だった。observer-piston fixture がレバー直付けに切り替えたのは正しい回避。

---

## 4. 既知の限界 (本 #44 の範囲外・回帰無し)

- **接続形状はシミュレーション中に更新しない** (配置時固定。02 §6 wire / `WireState` コメント)。
  vanilla は `updateShape` で近傍変化のたびに接続を張り替える。ピストン伸縮などで**信号源 (repeater/
  observer/wire)** がダストの隣に出現/消滅すると、vanilla は形状を更新するが sim は据え置くため、
  動的トポロジー変化を伴う回路では給電方向がずれ得る。observer-piston fixture がダストを避けたのは
  この動的更新も踏まえた回避 (静的な形状×給電マトリクス自体は本メモどおり一致)。今後 fixture で
  「移動する信号源の隣のダスト」を扱うなら別 issue で接続の動的再計算を検討する。

## 5. 実機網羅 fixture (後段で親が生成)

`tools/mc-harness/fixtures/` に authored 定義を追加 (docker 実行はしない):

- `dust-line-powering`: レバー→リピーター→**直線ダスト**→ランプ 3 台 (延長端 east / 垂直 north / 垂直 south)。
  延長端のみ点灯し垂直は消灯することを実機で確認する (#44 の核心)。
- `dust-cross-powering`: redstone_block 直下供給の **cross ダスト** (水平 4 ランプ点灯 + 真上ランプ消灯) と、
  ランプ上に載せたダストの **足元給電** ゲートを同梱。
