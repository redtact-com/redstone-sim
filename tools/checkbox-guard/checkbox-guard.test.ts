import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  LABEL, MARKER, MAX_LISTED, findUnchecked, decide, renderWarning, renderResolved, run, createApi,
} from './checkbox-guard.mjs'

/**
 * checkbox-guard (.github/workflows/checkbox-guard.yml) の数え方と、
 * GitHub に対して何をするかを確かめる。API は偽物を渡して呼ばれた順を見る。
 */

const body = (...lines: string[]) => lines.join('\n')

describe('findUnchecked: 数える範囲', () => {
  it('「## やること」節の未チェックだけを本文の行のまま返す', () => {
    const b = body(
      '## 背景・目的',
      '- [ ] 背景に書いたチェックボックス',
      '## やること',
      '- [x] 済んだ項目',
      '- [ ] 残った項目',
      '## 完了条件',
      '- [ ] 完了条件のチェックボックス',
      '## 参考',
      '- [ ] (追加) 参考に書いたもの',
    )
    expect(findUnchecked(b)).toEqual(['- [ ] 残った項目'])
  })

  it('節の中の ### は節の一部として読む', () => {
    const b = body('## やること', '### 前半', '- [ ] a', '### 後半', '- [ ] b', '## 完了条件', '- [ ] c')
    expect(findUnchecked(b)).toEqual(['- [ ] a', '- [ ] b'])
  })

  it('「## やること」が 2 つあれば両方を見る', () => {
    const b = body('## やること', '- [ ] a', '## 参考', 'x', '## やること (マージ後)', '- [ ] b')
    expect(findUnchecked(b)).toEqual(['- [ ] a', '- [ ] b'])
  })

  it('節が無い本文 (spec-drift の自動起票など) では何も返さない', () => {
    expect(findUnchecked(body('## 対応手順', '1. 読む', '- [ ] 何か'))).toEqual([])
    expect(findUnchecked('')).toEqual([])
    expect(findUnchecked(null)).toEqual([])
  })

  it('# の見出しでも節が終わる。### やること は節にしない', () => {
    expect(findUnchecked(body('## やること', '- [ ] a', '# 別', '- [ ] b'))).toEqual(['- [ ] a'])
    expect(findUnchecked(body('### やること', '- [ ] a'))).toEqual([])
  })

  it('CRLF の本文も読める', () => {
    expect(findUnchecked('## やること\r\n- [ ] a\r\n- [x] b\r\n')).toEqual(['- [ ] a'])
  })
})

describe('findUnchecked: 項目の形', () => {
  it('入れ子・* / + / 番号付きの項目も数える。[x] と [X] は済み', () => {
    const b = body(
      '## やること',
      '- [x] 親',
      '  - [ ] 子',
      '* [ ] star',
      '+ [ ] plus',
      '1. [ ] 番号',
      '2) [ ] 番号 2',
      '- [X] 大文字の X',
    )
    expect(findUnchecked(b)).toEqual(['  - [ ] 子', '* [ ] star', '+ [ ] plus', '1. [ ] 番号', '2) [ ] 番号 2'])
  })

  it('チェックボックスに見えない行は数えない', () => {
    const b = body('## やること', '- [] 空白なし', '- [ ]x 空白なしで文', '[ ] 箇条書きでない', '> - [ ] 引用')
    expect(findUnchecked(b)).toEqual([])
  })

  it('コードブロック (``` と ~~~) の中は数えない', () => {
    const b = body(
      '## やること',
      '```md',
      '- [ ] コードの中',
      '```',
      '~~~~',
      '- [ ] チルダの中',
      '```',
      '- [ ] ``` では閉じない',
      '~~~~',
      '  ```',
      '  - [ ] 入れ子のコード',
      '  ```',
      '- [ ] 外',
    )
    expect(findUnchecked(b)).toEqual(['- [ ] 外'])
  })

  it('言語名の付いた行ではコードブロックを閉じない。行の中で閉じる ``` は囲みにしない', () => {
    const b = body(
      '## やること',
      '```ts',
      '```md',
      '- [ ] まだコードの中',
      '```',
      '```inline``` の説明',
      '- [ ] 外',
    )
    expect(findUnchecked(b)).toEqual(['- [ ] 外'])
  })

  it('HTML コメントの中は数えない', () => {
    const b = body('## やること', '<!--', '- [ ] テンプレの例', '-->', '- [ ] 本物 <!-- 注 -->')
    expect(findUnchecked(b)).toEqual(['- [ ] 本物'])
  })

  it('文が ~~ で始まる項目はやめた項目として数えず、その下の入れ子も数えない', () => {
    const b = body(
      '## やること',
      '- [ ] ~~消える場合、条件を記録する~~ (消えなかった)',
      '  - [ ] バージョン',
      '    続きの行',
      '  - [ ] 形状',
      '- [ ] 兄弟は数える',
      '- [ ] 途中に ~~取り消し~~ があっても数える',
    )
    expect(findUnchecked(b)).toEqual(['- [ ] 兄弟は数える', '- [ ] 途中に ~~取り消し~~ があっても数える'])
  })
})

describe('decide', () => {
  const closed = (extra: object = {}) => ({
    state: 'closed', state_reason: 'completed', labels: [], body: body('## やること', '- [ ] a'), ...extra,
  })

  it('completed で閉じて未チェックが残れば warn', () => {
    expect(decide({ action: 'closed', issue: closed() })).toEqual({ kind: 'warn', items: ['- [ ] a'] })
  })

  it('state_reason が無い (古い close) ときは completed として扱う', () => {
    expect(decide({ action: 'closed', issue: closed({ state_reason: null }) }).kind).toBe('warn')
  })

  it('not_planned / duplicate で閉じたものは clear (警告済みならラベルを外す)', () => {
    expect(decide({ action: 'closed', issue: closed({ state_reason: 'not_planned' }) }).kind).toBe('clear')
    expect(decide({ action: 'closed', issue: closed({ state_reason: 'duplicate' }) }).kind).toBe('clear')
  })

  it('全部済みなら clear', () => {
    expect(decide({ action: 'closed', issue: closed({ body: body('## やること', '- [x] a') }) }).kind).toBe('clear')
  })

  it('開いている issue は skip (取り直したら開き直されていた場合)', () => {
    expect(decide({ action: 'closed', issue: closed({ state: 'open' }) }).kind).toBe('skip')
  })

  it('閉じたあとの編集は、警告済み (ラベル付き) のものだけ見直す', () => {
    expect(decide({ action: 'edited', issue: closed() }).kind).toBe('skip')
    const labeled = { labels: [{ name: LABEL }] }
    expect(decide({ action: 'edited', issue: closed(labeled) }).kind).toBe('warn')
    expect(decide({ action: 'edited', issue: closed({ ...labeled, body: '## やること\n- [x] a' }) }).kind).toBe('clear')
    // event の写しではラベルが文字列のこともある
    expect(decide({ action: 'edited', issue: closed({ labels: [LABEL] }) }).kind).toBe('warn')
  })
})

describe('コメントの本文', () => {
  it('印で始まり、項目をコードブロックに入れる (中のバッククォートより長い囲み)', () => {
    const text = renderWarning(['- [ ] `a` と ```b```', '- [ ] @someone に聞く'])
    const lines = text.split('\n')
    expect(lines[0]).toBe(MARKER)
    expect(text).toContain('未チェックの項目が 2 件')
    expect(lines).toContain('````')
    expect(lines.filter(l => l === '````')).toHaveLength(2)
  })

  it(`${MAX_LISTED} 件を超えた分は件数だけ書く`, () => {
    const items = Array.from({ length: MAX_LISTED + 5 }, (_, i) => `- [ ] ${i}`)
    const text = renderWarning(items)
    expect(text).toContain(`未チェックの項目が ${MAX_LISTED + 5} 件`)
    expect(text).toContain('ほか 5 件')
    expect(text).not.toContain(`- [ ] ${MAX_LISTED}\n`)
  })

  it('片付いたときの本文も印で始まり、外した理由を書く', () => {
    expect(renderResolved().startsWith(MARKER)).toBe(true)
    expect(renderResolved()).toContain('未チェック項目が片付いたので')
    expect(renderResolved('not_planned')).toContain('not_planned で閉じ直したので')
  })
})

describe('run: GitHub に対してすること', () => {
  type Comment = { id: number, body: string, user: { type: string } }
  function fakeApi(issue: object, comments: Comment[] = []) {
    const calls: string[] = []
    const api = {
      getIssue: async () => issue,
      listComments: async () => comments,
      createComment: async (_n: number, b: string) => { calls.push('createComment'); comments.push({ id: 99, body: b, user: { type: 'Bot' } }) },
      updateComment: async (id: number, b: string) => { calls.push(`updateComment:${id}`); const c = comments.find(x => x.id === id); if (c) c.body = b },
      ensureLabel: async () => { calls.push('ensureLabel') },
      addLabel: async () => { calls.push('addLabel') },
      removeLabel: async () => { calls.push('removeLabel') },
    }
    return { api, calls, comments }
  }
  const warnIssue = { state: 'closed', state_reason: 'completed', labels: [], body: '## やること\n- [ ] a' }

  it('初めての警告はラベルを用意して付け、コメントを 1 件書く', async () => {
    const { api, calls } = fakeApi(warnIssue)
    await run({ action: 'closed', number: 1, api })
    expect(calls).toEqual(['ensureLabel', 'addLabel', 'createComment'])
  })

  it('開き直して同じ内容で閉じ直しても、コメントは増やさない', async () => {
    const { api, calls } = fakeApi(warnIssue, [{ id: 7, body: renderWarning(['- [ ] a']), user: { type: 'Bot' } }])
    await run({ action: 'closed', number: 1, api })
    expect(calls).toEqual(['ensureLabel', 'addLabel'])
  })

  it('項目が変わっていれば前のコメントを書き換える。人のコメントは触らない', async () => {
    const { api, calls } = fakeApi(warnIssue, [
      { id: 5, body: `${MARKER}\n人が貼った`, user: { type: 'User' } },
      { id: 7, body: renderWarning(['- [ ] a', '- [ ] b']), user: { type: 'Bot' } },
    ])
    await run({ action: 'closed', number: 1, api })
    expect(calls).toEqual(['ensureLabel', 'addLabel', 'updateComment:7'])
  })

  it('直して片付いたらラベルを外し、コメントを片付いたに書き換える', async () => {
    const issue = { state: 'closed', state_reason: 'completed', labels: [{ name: LABEL }], body: '## やること\n- [x] a' }
    const { api, calls, comments } = fakeApi(issue, [{ id: 7, body: renderWarning(['- [ ] a']), user: { type: 'Bot' } }])
    await run({ action: 'edited', number: 1, api })
    expect(calls).toEqual(['removeLabel', 'updateComment:7'])
    expect(comments[0].body).toBe(renderResolved())
  })

  it('警告のあと not_planned で閉じ直したら、ラベルを外して理由を書く', async () => {
    const issue = { state: 'closed', state_reason: 'not_planned', labels: [{ name: LABEL }], body: '## やること\n- [ ] a' }
    const { api, calls, comments } = fakeApi(issue, [{ id: 7, body: renderWarning(['- [ ] a']), user: { type: 'Bot' } }])
    await run({ action: 'closed', number: 1, api })
    expect(calls).toEqual(['removeLabel', 'updateComment:7'])
    expect(comments[0].body).toBe(renderResolved('not_planned'))
  })

  it('待っているあいだに閉じ直されていたら、閉じ直した方の run に任せて何もしない', async () => {
    const issue = { ...warnIssue, closed_at: '2026-10-25T10:40:00Z' }
    const { api, calls } = fakeApi(issue)
    const r = await run({ action: 'closed', number: 1, api, closedAt: '2026-10-25T10:00:00Z' })
    expect(r).toEqual({ kind: 'skip', reason: '閉じ直されたので後の run に任せる' })
    expect(calls).toEqual([])
    // 同じ close の run なら警告する
    expect((await run({ action: 'closed', number: 1, api, closedAt: '2026-10-25T10:40:00Z' })).kind).toBe('warn')
  })

  it('警告した跡が無い issue で片付いていれば何もしない', async () => {
    const issue = { state: 'closed', state_reason: 'completed', labels: [], body: '## やること\n- [x] a' }
    const { api, calls } = fakeApi(issue)
    expect((await run({ action: 'closed', number: 1, api })).kind).toBe('clear')
    expect(calls).toEqual([])
  })
})

describe('createApi: GitHub の REST API の呼び方', () => {
  type Call = { method: string, url: string, body: unknown }
  function stubFetch(reply: (c: Call) => { status: number, json?: unknown }) {
    const calls: Call[] = []
    vi.stubGlobal('fetch', async (url: string, init: { method: string, body?: string }) => {
      const c = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined }
      calls.push(c)
      const r = reply(c)
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.json,
        text: async () => JSON.stringify(r.json ?? ''),
      }
    })
    return calls
  }
  afterEach(() => { vi.unstubAllGlobals() })
  const api = () => createApi({ token: 't', repo: 'o/r', apiUrl: 'https://api.test' })

  it('コメントが 100 件を超えると次のページまで読む', async () => {
    const page = (n: number, len: number) => Array.from({ length: len }, (_, i) => ({ id: n * 1000 + i }))
    const calls = stubFetch(c => ({ status: 200, json: c.url.endsWith('page=1') ? page(1, 100) : page(2, 3) }))
    const got = await api().listComments(5)
    expect(got).toHaveLength(103)
    expect(calls.map(c => c.url)).toEqual([
      'https://api.test/repos/o/r/issues/5/comments?per_page=100&page=1',
      'https://api.test/repos/o/r/issues/5/comments?per_page=100&page=2',
    ])
  })

  it('ラベルが既にある (422)・付いていない (404) は成功として扱う', async () => {
    const calls = stubFetch(c => ({ status: c.method === 'POST' ? 422 : 404, json: { message: 'x' } }))
    await expect(api().ensureLabel()).resolves.toBeNull()
    await expect(api().removeLabel(5)).resolves.toBeNull()
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.test/repos/o/r/labels', body: { name: LABEL } })
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: `https://api.test/repos/o/r/issues/5/labels/${LABEL}` })
  })

  it('それ以外の失敗は例外にする (job を赤くする)', async () => {
    stubFetch(() => ({ status: 403, json: { message: 'Resource not accessible by integration' } }))
    await expect(api().addLabel(5)).rejects.toThrow('POST /issues/5/labels が 403 で失敗')
  })

  it('コメントの作成と書き換えは issue 番号とコメント id で別の URL を叩く', async () => {
    const calls = stubFetch(() => ({ status: 201, json: {} }))
    await api().createComment(5, 'a')
    await api().updateComment(77, 'b')
    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.test/repos/o/r/issues/5/comments',
      'PATCH https://api.test/repos/o/r/issues/comments/77',
    ])
    expect(calls.map(c => c.body)).toEqual([{ body: 'a' }, { body: 'b' }])
  })
})
