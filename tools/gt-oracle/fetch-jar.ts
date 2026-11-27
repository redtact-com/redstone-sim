// ============================================================
// 26.3 のサーバ jar を取り、起動に要る物を作業フォルダへ展開する (docs/research/18 §4.1 の 1)。
//
// 使い方: npx tsx tools/gt-oracle/fetch-jar.ts [--version 26.3]
//
// 1. piston-meta の version manifest から版の version JSON を取り、サーバ jar の URL と sha1 を得る
//    (tools/decompile/fetch-and-decompile.sh と同じ手順)
// 2. jar を落として sha1 を確かめる。GT_ORACLE_SERVER_JAR に手元の jar を渡せば、sha1 が合うときだけそれを写す
// 3. jar は bundler 形式なので、META-INF/versions の本体 jar と META-INF/libraries のライブラリを展開する。
//    どちらも bundler の一覧 (versions.list・libraries.list) の sha256 と照らす
// 4. 本体 jar の中の version.json (pack_version・world_version) を写す。gen-datapack.ts が読む
//
// 出力 (どれも tools/gt-oracle/work/ の下。gitignore 済みで、コミットしない):
//   work/jars/<版>/server.jar      … 落とした jar そのもの
//   work/jars/<版>/server-<版>.jar … 本体 (クラスパスの先頭)
//   work/jars/<版>/libs/*.jar      … ライブラリ (平らに並べる。名前が重なったら止まる)
//   work/jars/<版>/version.json    … 本体の version.json
//   work/jars/<版>/fetched.json    … 取った物の記録 (URL・sha1・ライブラリの数)
// ============================================================

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const gtDir = dirname(fileURLToPath(import.meta.url))
export const workDir = join(gtDir, 'work')
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

/** 版ごとの作業フォルダ */
export function jarDir(version: string): string {
  return join(workDir, 'jars', version)
}

/** bundler の一覧 (versions.list・libraries.list) の 1 行。区切りはタブで、sha256・ID・jar の中の相対パスの順 */
export interface BundleEntry { sha256: string; id: string; path: string }

export function parseBundleList(text: string): BundleEntry[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [sha256, id, path] = l.split('\t')
    if (!sha256 || !id || !path) throw new Error(`bundler の一覧の行を読めない: ${l}`)
    return { sha256, id, path }
  })
}

function sha(algo: 'sha1' | 'sha256', file: string): string {
  return createHash(algo).update(readFileSync(file)).digest('hex')
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} を取れない: ${res.status}`)
  return await res.json() as T
}

async function download(url: string, file: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} を取れない: ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

export interface FetchedJar {
  version: string
  serverJar: string
  innerJar: string
  libsDir: string
  versionJson: string
  libraries: number
}

export async function fetchJar(version: string): Promise<FetchedJar> {
  const dir = jarDir(version)
  const serverJar = join(dir, 'server.jar')
  const libsDir = join(dir, 'libs')
  const recordPath = join(dir, 'fetched.json')
  mkdirSync(dir, { recursive: true })

  const manifest = await fetchJson<{ versions: { id: string; url: string }[] }>(MANIFEST_URL)
  const entry = manifest.versions.find(v => v.id === version)
  if (!entry) throw new Error(`version manifest に ${version} が無い`)
  const vjson = await fetchJson<{ downloads: { server: { url: string; sha1: string; size: number } } }>(entry.url)
  const server = vjson.downloads.server

  // 1. jar
  if (!existsSync(serverJar) || sha('sha1', serverJar) !== server.sha1) {
    const local = process.env.GT_ORACLE_SERVER_JAR
    if (local && existsSync(local) && sha('sha1', local) === server.sha1) {
      console.log(`==> 手元の jar を写す (sha1 一致): ${basename(local)}`)
      copyFileSync(local, serverJar)
    } else {
      console.log(`==> サーバ jar を落とす (${server.size} バイト)`)
      await download(server.url, serverJar)
    }
  }
  if (sha('sha1', serverJar) !== server.sha1) throw new Error('server.jar の sha1 が合わない')
  console.log('==> server.jar の sha1 一致')

  // 既に展開済みで記録の sha1 が同じなら、展開を飛ばす
  if (existsSync(recordPath)) {
    const rec = JSON.parse(readFileSync(recordPath, 'utf-8')) as { sha1: string; innerJar: string; libraries: number }
    const innerJar = join(dir, rec.innerJar)
    if (rec.sha1 === server.sha1 && existsSync(innerJar) && existsSync(libsDir)
      && readdirSync(libsDir).filter(f => f.endsWith('.jar')).length === rec.libraries) {
      console.log(`==> 展開済み (ライブラリ ${rec.libraries} 個)`)
      return {
        version, serverJar, innerJar, libsDir, versionJson: join(dir, 'version.json'), libraries: rec.libraries,
      }
    }
  }

  // 2. bundler の展開
  const extractDir = join(dir, 'bundle')
  rmSync(extractDir, { recursive: true, force: true })
  rmSync(libsDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  mkdirSync(libsDir, { recursive: true })
  execFileSync('unzip', ['-q', '-o', serverJar, 'META-INF/versions.list', 'META-INF/libraries.list',
    'META-INF/versions/*', 'META-INF/libraries/*', '-d', extractDir])

  const versions = parseBundleList(readFileSync(join(extractDir, 'META-INF', 'versions.list'), 'utf-8'))
  if (versions.length !== 1) throw new Error(`versions.list の行が ${versions.length} 本ある (1 本のはず)`)
  const innerSrc = join(extractDir, 'META-INF', 'versions', versions[0].path)
  if (sha('sha256', innerSrc) !== versions[0].sha256) throw new Error('本体 jar の sha256 が合わない')
  const innerJar = join(dir, basename(versions[0].path))
  copyFileSync(innerSrc, innerJar)

  const libs = parseBundleList(readFileSync(join(extractDir, 'META-INF', 'libraries.list'), 'utf-8'))
  const seen = new Set<string>()
  for (const lib of libs) {
    const src = join(extractDir, 'META-INF', 'libraries', lib.path)
    if (sha('sha256', src) !== lib.sha256) throw new Error(`ライブラリの sha256 が合わない: ${lib.id}`)
    const name = basename(lib.path)
    if (seen.has(name)) throw new Error(`ライブラリの名前が重なった: ${name}`)
    seen.add(name)
    copyFileSync(src, join(libsDir, name))
  }
  rmSync(extractDir, { recursive: true, force: true })

  // 3. 本体の version.json
  const versionJson = join(dir, 'version.json')
  writeFileSync(versionJson, execFileSync('unzip', ['-p', innerJar, 'version.json']))

  writeFileSync(recordPath, JSON.stringify({
    version, url: server.url, sha1: server.sha1, innerJar: basename(innerJar), libraries: libs.length,
    at: new Date().toISOString(),
  }, null, 2) + '\n')
  console.log(`==> 展開した: 本体 ${basename(innerJar)}・ライブラリ ${libs.length} 個`)
  return { version, serverJar, innerJar, libsDir, versionJson, libraries: libs.length }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const i = args.indexOf('--version')
  const version = i >= 0 ? args[i + 1] : '26.3'
  if (!version) throw new Error('--version の値が無い')
  await fetchJar(version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
