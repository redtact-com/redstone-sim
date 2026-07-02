# two-piston-locational — #15 microTiming 突合の記録 (2026-07-03)

対称 2 ピストン回路 (`piston W | dust | lever | dust | piston E`)。NBT は
ユーザ環境の `microtiming-2piston.nbt` と同一構成。

## 状態系列 (レイヤ A) — ✅ 実機一致

fixture `two-piston-locational` を Fabric 1.21.1 + carpet で生成し、
sim と **15 tick 分完全一致** (extend/retract の moving_piston 遷移含む)。

## sim の BE 順予測 (レイヤ C 相当・within-tick 順)

レバー ON の同 tick の BE キュー投入順 (= ダスト多段送信 HashSet 順由来):

```
1. (5,1,0) piston extend   ← 東 (レバーとの相対位置は対称なのに先)
2. (1,1,0) piston extend   ← 西
```

トレース (08 記法):
```
0gt[PI]: Le{n.0}
0gt[BE]: Pi(p.s) ×2      # 同 tick に両ピストンの BE 予約
1gt[BE]: Pi{p.0} ×2      # BE フェーズで両方伸長 (moving 化)
1gt[ST]: Ph(c.2) ×2
3gt[ST]: Ph{c.2} ×2      # +2gt で head 確定
```

## 実機の within-tick 順 (microTiming) — ⏳ 未観測

microTiming の出力は player chat 限定 (06 §6.2) のため、確認には
Minecraft クライアント + carpet-tis-addition の接続観察が必要 (09 手順)。
ユーザ撮影のスクリーンショット (2026-07-03) は **sim 側の tick 系列**の記録で、
NBT インポートと伸縮動作の目視確認として有効。実機の順序観察は未実施。

代替案: R2 (06 §6.3) の補助 mixin による JSON 自動出力 (スコープ追加)。
