import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { docsHref } from '@redstone/docs-kit'
import { usePage } from './PageView'
import type { DocsModel } from './model'

/** README の §1 (このメモ群の目的) を最初の画面に出す */
const INTRO_PAGE = 'v-readme/1'

/** 最初の画面: README の §1 + 全体の進み + メモの一覧 */
export function Home({ model, progress, docStat }: {
  model: DocsModel
  /** 全体の進みと「続きから読む」 */
  progress?: ReactNode
  /** メモの行の右に出す集計 */
  docStat?: (docKey: string) => ReactNode
}) {
  const { data } = usePage(INTRO_PAGE)
  useEffect(() => { document.title = 'docs — redstone-sim の読解メモ' }, [])
  const { counts } = model.manifest
  return (
    <div className="home">
      <h1>Java 版 26.3 のレッドストーン読解メモ</h1>
      <p className="home-lead">
        docs/vanilla と docs/research 17〜19 を、項目ごとのページで読む。メモ {counts.docs} 本・{counts.pages} ページ・節 {counts.sections}。
      </p>
      {progress}
      {data && <article className="doc-body home-intro" dangerouslySetInnerHTML={{ __html: data.html }} />}
      <h2>メモ</h2>
      <ul className="home-docs">
        {model.manifest.docs.map(d => (
          <li key={d.key}>
            <a href={docsHref(d.groups[0].pages[0])}>
              <span className="toc-label">{d.label}</span>
              <span className="home-doc-title">{d.title}</span>
            </a>
            <span className="home-doc-stat">{docStat ? docStat(d.key) : `${d.groups.reduce((n, g) => n + g.pages.length, 0)} ページ`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
