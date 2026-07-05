# network-piston-order — #52 連結ダスト網内 BE 順の microTiming 突合 (2026-07-05)

連結した 1 本のダスト網**内部**の within-tick 更新順を 3 ピストンの BE 発火順で観測。
中心 cross ダスト → N/E/S 3 アーム (各 1 ダスト) → 各端 (中心+2) に外向きピストン、
レバー 1 点駆動。NBT/litematic はユーザ環境の `microtiming-network-order`。

## 観測環境

Fabric 1.21.1 + carpet 1.4.147 + carpet-tis-addition 1.81.0 サーバ (harness の
docker-compose.override.yml で一時構築・port 25565 公開) に 1.21.1 クライアントで接続。
`/carpet microTiming true` + `microTimingTarget in_range` + `/log microTiming all`。
`/tick freeze` → レバー ON → `/tick step 1` で tick 送り。

配置 (実機): 中心ダスト **(17,3,10)**、N piston (17,3,8)、S piston (17,3,12)、
E piston (19,3,10)、レバー (16,3,10)。

## 観測タイムライン

| フェーズ | イベント |
|---|---|
| PI (PlayerAction) | `[Lever] State Change` → `[Redstone Wire] State Change: power=14/…` → `[Piston] Computed push structure` + `Scheduled BlockEvent` ×3 (ダスト網伝播内で 3 BE を予約) → `[Lever] State Change finished` |
| BlockEvent (GameTime 53946) | `Execute Push @ BlockEvent.0` ×3 を FIFO 連続実行。各実行内で `Computed push structure: Push` → `Air→Moving Piston` + `Stone→Moving Piston` |
| **TileEntity (+2gt)** | `[Moving Piston] Block Replace: Moving Piston→Piston Head` ×3。実行から +2gt で head 確定 (sim #80 の BlockEntity 相と一致) |

## BE 実行順 (locational の核心) — ✅ sim と一致

各 `Execute Push @ BlockEvent.0` の `$` ホバーで座標を確認:

| Order | Position | ピストン |
|---|---|---|
| 0 | [17, 3, 8] | **N** (北・z 最小) |
| 1 | [17, 3, 12] | **S** (南・z 最大) |
| 2 | [19, 3, 10] | **E** (東・x 最大) |

**実機 = N → S → E**。

## sim との突合 — ✅ 一致 (座標忠実)

BE 順は locational (絶対座標依存) のため、sim を **実機と同一絶対座標** (中心 17,3,10) で
実行して比較する必要がある (原点 0,1,0 に置くと sim/実機とも S→E→N になり別座標との
単純比較は無意味):

| 配置 | sim BE 順 | 実機 |
|---|---|---|
| 中心 (17,3,10) | N → S → E | **N → S → E** ✅ |
| 中心 (0,1,0) | S → E → N | (未観測。#77 と整合) |

sim の dust HashSet 順エミュ (MC-11193, `updates.ts` dustUpdateOrigins) は**座標忠実**で、
連結網内の within-tick BE 順を実機どおり再現する。#46 (独立網間・NC 順・平行移動不変) とは
別メカニズムだが、こちらも sim=実機。

回帰 pin: `packages/sim/test/world.test.ts` の describe「連結ダスト網内の BE 投入順
locational (#52)」で N→S→E (実機座標) と S→E→N (原点) の両方を固定。demo/形状は
`tests/circuits/locational/network-piston-be-order.rstest` と fixture `network-piston-be-order`。

## 結論

連結ワイヤ網内部の within-tick 更新順は sim = vanilla 実機 (座標忠実)。#52 の未検証項
(PR#47 レビューポイント) は決着。修正不要。
