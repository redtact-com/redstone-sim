/**
 * 著作権まわりの衛生 (docs/ip-policy.md) で見るパターン。
 *
 * 追跡しているファイルの検査 (tools/ip-hygiene.test.ts) と、読む用の Web の生成物の検査
 * (tools/docs-index/build.test.ts。#434) が同じ物を使う。**パターンを 2 か所に置かない**。
 * このファイルはパターンそのものを持つので、検査の対象から外してある。
 */

/** Java の**文そのもの**に見えるパターン (説明文には出ない形) */
export const VERBATIM: { name: string; re: RegExp }[] = [
  { name: 'java コードフェンス', re: /```java/ },
  // `level.setBlock(...);` のような呼び出し文 (末尾セミコロン付き)
  { name: 'Java の呼び出し文', re: /\b(level|state|this|world)\.[A-Za-z]\w*\([^)]*\)\s*;/ },
  // クラス名・メソッド名そのものは**事実**なので許す (典拠として必要)。
  // 落とすのは「文の写し」だけにする
  // メソッドシグネチャの写し
  { name: 'Java のメソッドシグネチャ', re: /\b(public|protected|private)\s+(static\s+)?[\w<>[\]]+\s+\w+\s*\([^)]*\)\s*\{/ },
  // record 宣言の写し。修飾子も `{` も付けずに貼ると上のパターンをすり抜ける (#386)
  { name: 'Java の record 宣言', re: /\brecord\s+[A-Z]\w*(<[^>]*>)?\s*\(/ },
  // 「型 名前」の並ぶ引数リストの写し (修飾子を落とした宣言も拾う)。TypeScript は
  // `name: Type` の順なので、`(BlockPos pos, int delay)` の形は Java の字面にしか出ない
  { name: 'Java の型付き引数リスト', re: /\w\s*\(\s*(final\s+)?([A-Z]\w*(<[^>()]*>)?|int|long|boolean|double|float|byte|short|char)(\[\])?\s+[a-z]\w*\s*[,)]/ },
]

/**
 * 手元の絶対パス (#322)。公開リポなので、Windows / Linux のユーザ名がそのまま読める状態を作らない
 */
export const ABSOLUTE: { name: string; re: RegExp }[] = [
  // #358: テストが手元にしか無いファイルを絶対パスで参照して CI だけ落ちた。
  // 「絶対パスをコミットしない」規則で同時に防げる
  { name: 'エージェントの一時ディレクトリ', re: /\/tmp\/claude-\d+\// },
  { name: 'WSL 経由の Windows パス', re: /\/mnt\/[a-z]\/Users\// },
  { name: 'Windows パス', re: /[A-Za-z]:\\Users\\/ },
  { name: 'ホームディレクトリ', re: /\/(home|Users)\/[A-Za-z0-9._-]+\// },
]
