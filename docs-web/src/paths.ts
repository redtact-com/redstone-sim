/**
 * 取りに行く場所 (#434)。
 *
 * - 生成物 (`data/`) はこのアプリの配下にある。`--base /docs/` でビルドするので
 *   `import.meta.env.BASE_URL` を頭に付ける
 * - リソースパックは**ルート絶対**の `/resourcepack`。エディタと同じ物を使い、複製しない。
 *   base が `/docs/` でもここは動かない
 */
export const dataUrl = (rel: string): string => `${import.meta.env.BASE_URL}data/${rel}`

export const RESOURCEPACK_URL = '/resourcepack'
