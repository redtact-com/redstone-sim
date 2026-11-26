// docs-web のビルド結果を app/dist/docs へ写す (#434)。
//
// 使うのは PR のプレビュー (pr-preview.yml) と e2e (playwright.config.ts) だけ。
// 本番の deploy.yml はこれを呼ばないので、rdsim.com の app/dist に docs は入らない。
// 追跡しているファイルは書き換えない (app/dist も docs-web/dist も .gitignore の中)。
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const from = join(root, 'docs-web', 'dist')
const appDist = join(root, 'app', 'dist')
const to = join(appDist, 'docs')

if (!existsSync(join(from, 'index.html'))) {
  console.error('docs-web/dist が無い。先に npm run build:docs を回す')
  process.exit(1)
}
if (!existsSync(appDist)) {
  console.error('app/dist が無い。先に npm run build を回す')
  process.exit(1)
}
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log('docs-web/dist → app/dist/docs')
