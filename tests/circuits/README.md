# 回路テスト DSL (`.rstest`)

レッドストーン回路の挙動を宣言的に書く小さな DSL。1 ファイル = 1 テストケースで、
`packages/sim/test/circuits.test.ts` が **このフォルダ以下の `**/*.rstest` を再帰探索**して
`it(meta.name)` として実行する。**ファイルを追加するだけで CI が拾う**。

- 実行: `npm test`（vitest）／ 個別: `npx vitest run packages/sim/test/circuits.test.ts`
- トレース記法の正: [`docs/research/08_trace-notation.md`](../../docs/research/08_trace-notation.md)
- パーサ実装: `packages/sim/test/rstest/parse.ts` ／ ランナー: `packages/sim/test/rstest/runner.ts`

## 運用 (Bruno 風: フォルダ = コレクション)

- サブフォルダで素子・テーマ別に分類する（`repeater/` `comparator/` `piston/` `observer/` `hopper/` …）。
- 1 ファイル 1 挙動。ファイル名は挙動を表す（`delay-1.rstest` `observer-swallow.rstest`）。
- 期待トレース／状態は **実際に sim へ流して得た値を書き写す**（捏造しない）。
  値が分からないときは `npx tsx tools/mc-harness/runner/run.ts <fixture> --trace [--verbose]` や
  一時スクリプトで `traceFixtureOnSim` / `runFixtureOnSim` を叩いて確認する。

## 文法

行指向。コメントは **行頭または空白後の `#`** から行末まで。空行は無視。
**ブロックはヘッダ行が `{` で終わり、単独行の `}` で閉じる**（複数行必須。トレース行が
`{}` を含むため、閉じ判定は「その行が `}` だけ」で行う）。

```
# コメント
meta {
  name: <必須。it のタイトルになる>
  ref:  <任意キー。02 §… などの出典メモ>
}

fixture <名前>              # 任意。packages/sim/test/fixtures/<名前>.json の
                            #       blocks / inputs / ticks を土台に取込む

circuit {                   # fixture と併用時は position で追加/上書き
  (x,y,z) <blockstate>            # 単点配置
  (x0,y0,z0)..(x1,y1,z1) <blockstate>   # 範囲 fill (直方体)
  (x,y,z) hopper[...] items=3     # コンテナ初期個数 (blockstate に出ない BE 内容)
}

inputs {                    # fixture inputs に追記される
  t2  use  (x,y,z)          # 右クリック相当 (レバー/ボタン/ターゲット)
  t10 step (x,y,z)          # 感圧板を踏む相当 (手動モデルでは use と同一)
}

ticks 20                    # 任意。省略時 = fixture の ticks、無ければ max(入力 t)+8

trace {                     # 部分一致: 記載行が実トレースに順序どおり現れる (部分列)
  2gt[PI]: Le{n.0}          # verbose 行 (bu 内訳) も書ける
  2gt[ST]: Re(n.2) p-1
}
# または
trace strict {              # 完全一致: verbose=false の全行を列挙。trace と排他
  ...
}

state {                     # state[t] の blockstate 断言
  t4 (2,1,0) redstone_lamp[lit=true]
  t8 (3,1,0) air
}
```

### 各ブロック

| ブロック | 必須 | 意味 |
|---|---|---|
| `meta` | ○ | `name` 必須（テスト名）。他キーは自由メモ |
| `fixture <名前>` | | 既存 fixture の blocks/inputs/ticks を土台にする |
| `circuit` | △ | ブロック配置。fixture 無しなら必須。範囲 fill・`items=N` 可 |
| `inputs` | | プレイヤ入力。`use` / `step` |
| `ticks <N>` | | シミュレート tick 数 |
| `trace` / `trace strict` | | トレース断言（排他） |
| `state` | | tick 断面の blockstate 断言 |

- blockstate は `mcstate.parseMcState / canonicalize` で構文検証する。`sim` が扱えない
  ブロック名はパース時にエラーになる。座標は整数、負値可。
- **tick 規約**: `state[t]` = 「tick t の ScheduledTick 完了 + `inputs[t]` 適用後」
  （`fixture-runner` と同一。`tools/mc-harness/README.md` の tick 規約に一致）。

### トレース断言の使い分け

- `trace {}` … **部分一致（順序保存部分列）**。`verbose=true` で流すので、process 行
  （`<gt>gt[Phase]: ...`）も updateFormula 行（`Body; {bu(...)}`）も書ける。要点だけ抜粋したいときに。
- `trace strict {}` … **完全一致**。`verbose=false` の全 process 行を列挙する。
  「余計なイベントが起きない」ことまで固定したいとき（例: コンパレーター飲み込みで
  `Co` 行が一切出ない）に使う。
- **gt はオフセットに注意**: `traceFixtureOnSim` は初期 settle（`flush`）後を起点に採録するため、
  回路が settle 中に数 tick 動く場合、`inputs` の tick 番号と trace の gt がずれる
  （例: `hopper/clock-8gt` は 2gt オフセット）。**実出力の gt をそのまま書く**こと。

## fixture 参照 vs インライン circuit

- **インライン circuit のみ**: 新規・独立な小回路（`repeater/delay-1`）。回路を全部書く。
- **fixture 参照**: 実機 ground truth と同じ配置で挙動を追加検証したいとき
  （`piston/two-piston-be-order` は `two-piston-locational` の BE 順、
  `hopper/clock-8gt` は `hopper-clock` のクールダウン）。`circuit` を足せば position 上書きも可。

## 失敗時の表示

- state 不一致: `state[tN] (x,y,z)` の expected / actual blockstate。
- trace 部分一致ミス: 期待行・検索再開位置・その gt の実トレース行。
- trace strict ミス: 期待↔実の行単位 diff（`✗` 付き）。

## 収録ケース

| ファイル | 参照 | 検証 |
|---|---|---|
| `repeater/delay-1.rstest` | インライン | delay=1 の 2gt 遅延（trace 部分一致 + state） |
| `comparator/observer-swallow.rstest` | `observer-comparator-swallow` | 02 §2.4 飲み込み（trace strict で Co 不在） |
| `piston/two-piston-be-order.rstest` | `two-piston-locational` | within-tick BE 順（trace strict + state） |
| `observer/pulse-2gt.rstest` | `observer-detects-dust` | オブザーバー 2gt パルス（trace + state） |
| `hopper/clock-8gt.rstest` | `hopper-clock` | 8gt クールダウン（trace + state） |
