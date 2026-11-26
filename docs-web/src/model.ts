import type { Manifest, ManifestDoc, ManifestGroup, ManifestPage } from '@redstone/docs-kit'

/** 目次から引くための表 (ページ・メモ・`##` を ID で引く)。manifest 1 個につき 1 回作る */
export interface DocsModel {
  manifest: Manifest
  pages: Map<string, { page: ManifestPage; index: number }>
  docs: Map<string, ManifestDoc>
  groups: Map<string, ManifestGroup>
}

export function buildModel(manifest: Manifest): DocsModel {
  const pages = new Map<string, { page: ManifestPage; index: number }>()
  manifest.pages.forEach((page, index) => pages.set(page.id, { page, index }))
  const docs = new Map<string, ManifestDoc>()
  const groups = new Map<string, ManifestGroup>()
  for (const d of manifest.docs) {
    docs.set(d.key, d)
    for (const g of d.groups) groups.set(g.id, g)
  }
  return { manifest, pages, docs, groups }
}

/** 目次の 2 段目の呼び名。先頭 (メモの `#` と前置き) は題がメモと同じなので「前置き」と出す */
export function groupLabel(doc: ManifestDoc, group: ManifestGroup): string {
  return group === doc.groups[0] ? '前置き' : group.title
}

/** 10 行未満のページ。目次の集計と「読んだにして次へ」で進める */
export const SHORT_PAGE_LINES = 10
