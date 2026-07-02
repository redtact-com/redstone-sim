# 08. トレース記法 — descriptive logics 適応版 (I10 の出力仕様)

redstone-sim のトレースログ出力 (I10 #18) と fixture デバッグ表示の正式記法。
enokilovin 氏の **descriptive logics** (処理記述法) を採用・適応する。
日本語回路勢と同じ言語で挙動を照合できるようにすることが目的。

- 出典: https://note.com/enokilovin/n/nc2952f9d228c (descriptive logics II、2026 参照)
- 本書は同記法の**本プロジェクト向け適応版**であり、原典の要約 + sim 実装上の割当を加えたもの。原典の著作権は enokilovin 氏に帰属する
- 02 §2.2 (tile tick priority) との整合は確認済み [確定]: Repeater -3/-2/-1、Comparator -1/0、Torch 0、Observer 0

---

## 1. processFormula — tick 内の処理系列

```
<gt>gt[Phase]: Block(action.delay)
```

| 要素 | 値 | 意味 |
|---|---|---|
| `<gt>` | 整数 | game tick 番号 |
| `[Phase]` | `PI` / `CT` / `ST` / `BE` / `EN` / `TE` | PlayerInput / ChunkTick / ScheduledTick(TileTick) / BlockEvent / Entity / TileEntity(BlockEntity) |
| `Block` | 素子略号 (§4) | 対象ブロック |
| `action` | `n` / `f` / `p` / `r` / `c` | turn **o<u>n</u>** / turn o<u>f</u>f / <u>p</u>ush(伸長) / <u>r</u>etract(収縮) / <u>c</u>hange・calculate |
| `delay` | 整数 or `s` | 予約遅延 (gt)。`s` = BlockEvent の予約 (scheduling) |
| 括弧 | `( )` = 予約 / `{ }` = 実行 | `Co(f.2)` は「2gt 後の OFF を予約」、`Co{f}` は「OFF を実行」 |
| 修飾 | `*` = 異常系 / `-` = 失敗 | `Co{f*-}` = 実行側で OFF に失敗 |

例 (レバー ON → コンパレーター):

```
0gt[PI]: Le{n.0}
2gt[ST]: Co{c.2}
```

## 2. updateFormula — 更新の伝播記述

```
Block{action.0}; {update(notifier.direction), ...}
```

| 要素 | 値 | 意味 |
|---|---|---|
| `update` | `bu` / `su` / `cu` / `sf` | blockUpdate(NC) / stateUpdate(PP/shape) / comparatorUpdate(CU) / selfUpdate |
| `notifier` | `o` / `fr` / `±x ±y ±z` | origin (自身) / front (素子の前方位置) / 軸方向 |
| `direction` | 軸列挙 | **bu 順 = xyz** (`-x,+x,-y,+y,-z,+z`) / **su 順 = xzy** (`-x,+x,-z,+z,-y,+y`) |

例:

```
Le{n.0}; {bu(o), su(o), bu(fr.-x), bu(fr.+x), ..., bu(fr.+z)}
Ob{n.0}; {su(o), sf, Ob(f.2), bu(o.fr), bu(fr.-x), ...}   -- bu(fr.-y) を含まない
```

※ 02 §4.2 [確定] のとおり、実体の送信順は方向配列のイテレーション順で、
ダストの多段送信は HashSet 順 (locational)。sim のトレースは**実装が発行した順**を
そのまま出力する (方向順の再現性は I6 の受け入れ基準側で担保)。

## 3. piston depth 記法 (I7 で使用)

```
Pi{p.0}; {(A), (B, C), (D, Ph, Pb)}   -- 深い順の depth 括弧。Ph=piston head, Pb=piston base
Pi{r*2}; {(D)}                        -- "*2" = 異常系: block D の drop
```

## 4. 素子略号 (sim 対応表)

| 略号 | ブロック | sim BlockType |
|---|---|---|
| `Le` | レバー | lever |
| `Bu` | ボタン | button_stone / button_wood |
| `Rs` | ワイヤー (dust) | wire |
| `To` | トーチ (床/壁) | torch / wall_torch |
| `Re` | リピーター | repeater |
| `Co` | コンパレーター | comparator |
| `La` | ランプ | lamp |
| `Bl` | 固体 | solid |
| `Ob` | オブザーバー | (I8) |
| `Pi` / `Ph` / `Pb` | ピストン / head / base | (I7) |

複数同種は `P1`, `P2`, ... と番号を振る (原典 example(1) と同様)。

## 5. sim トレース実装への割当 (I10 実装時の仕様)

- 出力単位は 1 行 1 イベント。同 gt 内は Phase 順 (PI → ST → BE → EN → TE。02 §1 [確定])
- `TraceEvent` は sim の内部イベント (schedule / execute / update 発行) から生成し、
  processFormula 行と updateFormula 行 (verbose 時) の 2 レベルを持つ
- スナップショットテスト: fixture 実行のトレース出力を `.trace` ファイルとして
  コミットし、実装変更でトレースが変わったら diff で検出する
- microTiming (06) のイベント種別との対応: `DetectBlockUpdate`→受信側 bu、
  `EmitBlockUpdate`→発行側 bu、`ExecuteTileTick`→`[ST]` 行、`ExecuteBlockEvent`→`[BE]` 行

## 6. 未確定・原典との差分

- 原典の `CT`(ChunkTick)/`EN`/`TE` 相当は sim 未実装フェーズ (エンティティなし)。トレースでは予約語として確保のみ
- ダスト更新の全展開 (原典も "hard to describe" と注記) は verbose レベルでのみ出力し、既定は抑制する
- `something` (第 3 引数) の用法は原典で流動的なため、sim では delay の後に自由注記として扱う
