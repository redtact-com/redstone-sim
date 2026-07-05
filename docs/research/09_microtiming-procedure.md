# 09. microTiming スナップショット採取手順 (I6 受け入れ検証用)

I6 の受け入れ基準「microTiming ログと更新順が一致する locational fixture 1 件以上」のための
実機観察手順。microTiming の出力は **player chat 限定** (06 §6.2 実測 [確定]) のため、
headless ハーネスでは採取できず**クライアント接続による手動観察**が必要。

## 現状と持ち越し

- I6 実装済みの範囲: NC/PP/CU 分離・方向順・ダスト HashSet 順 (単体テストで Java 挙動と照合済み)。
  既存 fixture 18 本の実機 tick 系列一致は維持 (= 状態レベルの回帰なし)
- **更新順そのもの**が観測可能な状態差になるのはブロックイベント系 (ピストン) 導入後のため、
  microTiming 突合の実施は **I7 (#15) のピストン fixture とセットで行う** (この手順書はその準備)

## 手順 (所要 ~15 分)

1. `tools/mc-harness/` の compose に TIS-Addition を追加して起動:
   `MODRINTH_PROJECTS: carpet,carpet-tis-addition` に変更 → `DOCKER_API_VERSION=1.44 docker compose up -d`
   ポートを一時公開する場合は compose に `ports: ["25565:25565"]` を追加 (採取後は戻す)
2. 手元の Minecraft 1.21.1 クライアント (Fabric + fabric-carpet + carpet-tis-addition) で
   `localhost:25565` に接続 (ONLINE_MODE=FALSE のためオフラインアカウント可)
3. ゲーム内チャットで: `/carpet microTiming true` → `/log microTiming`
4. 対象 fixture の回路を実機に設置 (fixture JSON の blocks を手動再現 or scarpet fx_setup)
5. `/tick freeze` → レバー操作 → `/tick step 1` を繰り返し、チャットに出る
   microTiming 行 (Emit/Detect BlockUpdate・ExecuteTileTick 等) を **tick ごとにスクリーンショット**
6. スクショの内容を `docs/research/09_snapshots/<fixture名>.md` に転記
   (1 行 1 イベント。08 記法の updateFormula に翻訳して併記すると sim トレースと直接照合できる)
7. sim 側: `npx tsx tools/mc-harness/runner/run.ts <fixture>` の順序トレース (I10 実装後) と突合

## 照合観点

- 同 tick 内の NC 発行順 (特にダスト多段の 7 起点順) が sim の `dustUpdateOrigins` 順と一致するか
- ExecuteTileTick の priority 表示 (`-3 (EXTREMELY_HIGH)` 等) が sim の diodeTickPriority と一致するか

## 落とし穴 (2026-07-05 #52 実測)

- **ログが 1 行も出ない**: `microTimingTarget` の既定は `labelled` (名札マーカー付きブロックのみ記録)。
  回路にマーカーが無いと全イベントが抑制される → `/carpet microTimingTarget in_range`
  (プレイヤー 32m 以内を記録) に変更する。`/log microTiming all` の "all" は log オプションで
  あって target ではない (両方要る)。
- **locational 順の突合は sim と実機を必ず同一絶対座標で比較する**: BE 順/NC 順は MC-11193 の
  dust HashSet 順由来で**絶対座標に依存**する (同一形状でも平行移動で順序が変わりうる。#77 参照)。
  実機を座標 P で観測したら sim も座標 P で走らせて比較する。異なる座標の順を突き合わせると
  一致していても不一致に見え、誤って divergence 判定する (#52 の N→S→E vs 原点 S→E→N)。
- **`instantBlockUpdaterReintroduced` を on にしない**: carpet-tis-addition が「ログが読みやすく
  なる」と案内するが、1.19 以前の即時ブロックアップデータ挙動になり **1.21 の更新順が変わる**
  (ground-truth 汚染)。読みにくくても off のまま観測する。
- op 権限: `/carpet` `/tick freeze` は op level 2+ が要る。offline サーバは rcon `op <name>` で付与。
