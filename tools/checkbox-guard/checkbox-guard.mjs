#!/usr/bin/env node
// ============================================================
// issue を閉じたときに「## やること」の未チェック項目を知らせる (#25 の残り・#425)
//
// .github/workflows/checkbox-guard.yml から呼ぶ。npm ci なしで動くように
// 依存パッケージは使わない (Node 22 の fetch だけで GitHub API を叩く)。
//
// 数えるもの: 「## やること」節の中の `- [ ]` (入れ子・番号付きも含む)。
// 数えないもの:
//   - not_planned / duplicate で閉じた issue
//   - 「## やること」節の外 (背景・参考などに書いたチェックボックス)
//   - コードブロックと HTML コメントの中
//   - 文が ~~ で始まる項目 (やめた項目) と、その下に入れ子になった項目
//
// 未チェックが残っていれば needs-checklist ラベルを付け、コメントを 1 件書く。
// 閉じたあとに本文を直して片付くと、ラベルを外してコメントを書き換える
// (コメントは HTML コメントの印で探し、2 件目を作らない)。
// 閉じてから調べるまでの待ち時間は workflow 側で取る。
// ============================================================

import { readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const LABEL = 'needs-checklist'
export const LABEL_COLOR = 'e11d21'
export const LABEL_DESCRIPTION = '閉じた時点で「やること」に未チェックの項目がある'
export const MARKER = '<!-- checkbox-guard -->'
/** コメントに並べる項目の上限。超えた分は件数だけ書く */
export const MAX_LISTED = 30

const TODO_HEADING = /^ {0,3}##[ \t]+やること/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const FENCE = /^\s*(`{3,}|~{3,})/
const CHECKBOX = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[( |x|X)\](?:[ \t]+(.*))?$/

/**
 * 本文から「## やること」節の未チェック項目を、本文の行のまま取り出す。
 * 見出しの階層は ## で区切る (節の中の ### は節の一部として読む)。
 * @param {string | null | undefined} body
 * @returns {string[]}
 */
export function findUnchecked(body) {
  const text = (body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  const found = []
  let fence = null
  let inTodo = false
  let dropIndent = -1
  for (const line of text.split('\n')) {
    const f = line.match(FENCE)
    if (fence) {
      // 閉じる囲みは同じ文字で同じ長さ以上。後ろに言語名などが付いた行では閉じない
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null
      continue
    }
    // ```a``` のように、同じ行の後ろにバッククォートがあるものはインラインのコードで、囲みではない
    if (f && !(f[1][0] === '`' && line.trimStart().slice(f[1].length).includes('`'))) { fence = f[1]; continue }

    const h = line.match(HEADING)
    if (h && h[1].length <= 2) {
      inTodo = TODO_HEADING.test(line)
      dropIndent = -1
      continue
    }
    if (!inTodo || line.trim() === '') continue

    const indent = line.length - line.trimStart().length
    if (dropIndent >= 0) {
      if (indent > dropIndent) continue
      dropIndent = -1
    }
    const c = line.match(CHECKBOX)
    if (!c) continue
    const rest = (c[3] ?? '').trim()
    if (rest.startsWith('~~')) { dropIndent = c[1].length; continue }
    if (c[2] === ' ') found.push(line.trimEnd())
  }
  return found
}

/** REST の labels は { name } の配列、event の写しでは文字列のこともある */
function labelNames(issue) {
  return (issue.labels ?? []).map(l => (typeof l === 'string' ? l : l.name))
}

/**
 * issue の今の状態から、することを決める。
 * - warn: ラベルを付け、コメントを書く (あれば書き換える)
 * - clear: 付いているラベルを外し、前に書いたコメントを「片付いた」に書き換える
 * - skip: 何もしない
 * @param {{ action: string, issue: { state: string, state_reason?: string | null,
 *   body?: string | null, labels?: Array<{ name: string } | string> } }} input
 */
export function decide({ action, issue }) {
  if (issue.state !== 'closed') return { kind: 'skip', reason: 'issue が開いている' }
  const hasLabel = labelNames(issue).includes(LABEL)
  // 閉じたあとの編集は、前に警告したものだけを見直す (古い issue を掘り起こさない)
  if (action === 'edited' && !hasLabel) return { kind: 'skip', reason: '警告していない issue の編集' }
  const closedAs = issue.state_reason ?? 'completed'
  if (closedAs !== 'completed') return { kind: 'clear', reason: `${closedAs} で閉じた`, closedAs }
  const items = findUnchecked(issue.body)
  if (items.length === 0) return { kind: 'clear', reason: '未チェックの項目が無い' }
  return { kind: 'warn', items }
}

/** コードブロックの囲みを中身のバッククォートより長くする */
function fenceFor(lines) {
  let max = 2
  for (const l of lines) for (const m of l.matchAll(/`+/g)) max = Math.max(max, m[0].length)
  return '`'.repeat(max + 1)
}

/**
 * 警告コメントの本文。項目はコードブロックに入れる (コメントの中にチェックボックスを
 * 作らないため・本文の @ メンションで通知を出し直さないため)。
 * @param {string[]} items
 */
export function renderWarning(items) {
  const listed = items.slice(0, MAX_LISTED)
  const fence = fenceFor(listed)
  const more = items.length - listed.length
  return [
    MARKER,
    `「## やること」に未チェックの項目が ${items.length} 件残ったまま閉じられました。`,
    '',
    fence,
    ...listed,
    fence,
    ...(more > 0 ? [`ほか ${more} 件`, ''] : ['']),
    '済んだ項目はチェックを付けてください。やめた項目は文を `~~` で囲んで取り消し線にしてください。',
    `全部片付くと \`${LABEL}\` ラベルは自動で外れ、このコメントも書き換わります。`,
    'まだ残っている作業なら、issue を開き直すか、別の issue に移して文を `~~` で囲んでください。',
    '',
    '(.github/workflows/checkbox-guard.yml が自動で書いています)',
  ].join('\n')
}

/**
 * 片付いたあとのコメントの本文
 * @param {string} [closedAs] completed 以外で閉じ直したときの state_reason
 */
export function renderResolved(closedAs) {
  const what = closedAs
    ? `${closedAs} で閉じ直したので`
    : '「## やること」の未チェック項目が片付いたので'
  return [
    MARKER,
    `${what}、\`${LABEL}\` ラベルを外しました。`,
    '',
    '(.github/workflows/checkbox-guard.yml が自動で書いています)',
  ].join('\n')
}

/**
 * GitHub への読み書きをまとめる。テストでは同じ形の偽物を渡す。
 * @param {{ token: string, repo: string, apiUrl?: string }} opts
 */
export function createApi({ token, repo, apiUrl = 'https://api.github.com' }) {
  const call = async (method, path, body, okStatuses = []) => {
    const res = await fetch(`${apiUrl}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`${method} ${path} が ${res.status} で失敗: ${await res.text()}`)
    }
    return res.status === 204 || !res.ok ? null : res.json()
  }
  return {
    getIssue: (n) => call('GET', `/issues/${n}`),
    async listComments(n) {
      const all = []
      for (let page = 1; ; page++) {
        const got = await call('GET', `/issues/${n}/comments?per_page=100&page=${page}`)
        all.push(...got)
        if (got.length < 100) return all
      }
    },
    createComment: (n, body) => call('POST', `/issues/${n}/comments`, { body }),
    updateComment: (id, body) => call('PATCH', `/issues/comments/${id}`, { body }),
    // 既にあれば 422 が返るので、それは成功として扱う
    ensureLabel: () => call('POST', '/labels',
      { name: LABEL, color: LABEL_COLOR, description: LABEL_DESCRIPTION }, [422]),
    addLabel: (n) => call('POST', `/issues/${n}/labels`, { labels: [LABEL] }),
    // 付いていなければ 404 が返るので、それは成功として扱う
    removeLabel: (n) => call('DELETE', `/issues/${n}/labels/${encodeURIComponent(LABEL)}`, undefined, [404]),
  }
}

/** 前に書いたコメント (印のあるボットのコメント) を探す */
export function findOwnComment(comments) {
  return comments.find(c => c.user?.type === 'Bot' && (c.body ?? '').startsWith(MARKER)) ?? null
}

/**
 * 1 回分の処理。issue は event の写しを使わず取り直す (閉じる・直すが続いたときに
 * 古い本文で判断しないため)。
 * @param {{ action: string, number: number, api: ReturnType<typeof createApi> }} input
 */
export async function run({ action, number, api }) {
  const issue = await api.getIssue(number)
  const decision = decide({ action, issue })
  if (decision.kind === 'skip') return decision

  const own = findOwnComment(await api.listComments(number))
  if (decision.kind === 'warn') {
    const body = renderWarning(decision.items)
    await api.ensureLabel()
    await api.addLabel(number)
    if (!own) await api.createComment(number, body)
    else if (own.body !== body) await api.updateComment(own.id, body)
    return decision
  }

  // clear: 警告した跡が無ければ何もしない
  if (labelNames(issue).includes(LABEL)) await api.removeLabel(number)
  const resolved = renderResolved(decision.closedAs)
  if (own && own.body !== resolved) await api.updateComment(own.id, resolved)
  return decision
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf-8'))
  const number = event.issue.number
  const api = createApi({
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
    apiUrl: process.env.GITHUB_API_URL,
  })
  const result = await run({ action: event.action, number, api })
  const summary = result.kind === 'warn'
    ? `#${number}: 未チェック ${result.items.length} 件。${LABEL} を付けた`
    : `#${number}: ${result.kind} (${result.reason})`
  console.log(summary)
  if (result.kind === 'warn') console.log(`::warning::issue #${number} の「やること」に未チェックが ${result.items.length} 件ある`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
