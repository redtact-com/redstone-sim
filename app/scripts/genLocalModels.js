// ローカルリソースパックのモデル・ブロックステートを bundle JSON に変換するスクリプト
// 実行: node scripts/genLocalModels.js
// 出力: public/resourcepack/bundle.json

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resourcepackDir = path.join(__dirname, '../public/resourcepack/assets/minecraft')

function loadJsonFiles(dir, prefix) {
  const result = {}
  if (!fs.existsSync(dir)) return result

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      Object.assign(result, loadJsonFiles(fullPath, `${prefix}/${entry.name}`))
    } else if (entry.name.endsWith('.json')) {
      const key = `${prefix}/${entry.name.replace('.json', '')}`
      try {
        result[key] = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
      } catch (e) {
        console.warn(`Failed to parse ${fullPath}: ${e.message}`)
      }
    }
  }
  return result
}

const models = loadJsonFiles(path.join(resourcepackDir, 'models/block'), 'block')
const blockstates = loadJsonFiles(path.join(resourcepackDir, 'blockstates'), '')

// blockstates のキーは先頭スラッシュを除去
const normalizedBlockstates = {}
for (const [k, v] of Object.entries(blockstates)) {
  normalizedBlockstates[k.replace(/^\//, '')] = v
}

// パック内のテクスチャのパス一覧 (拡張子なし・並べ替え済み)。#395
// viewer はこの一覧にあるテクスチャだけをパックへ取りに行く。一覧に無いものを取りに行くと
// Cloudflare Pages が 200 + index.html を返すだけだった (本番の初回ロードで 60 本)。
// 入れるのはパスだけで、Mojang のアセットは入れない (docs/ip-policy.md §2)
function listTextures(dir, prefix) {
  const result = []
  if (!fs.existsSync(dir)) return result
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      result.push(...listTextures(path.join(dir, entry.name), rel))
    } else if (entry.name.endsWith('.png')) {
      result.push(rel.slice(0, -'.png'.length))
    }
  }
  return result
}
const textures = listTextures(path.join(resourcepackDir, 'textures'), '').sort()

const bundle = { models, blockstates: normalizedBlockstates, textures }
const outPath = path.join(__dirname, '../public/resourcepack/bundle.json')
fs.writeFileSync(outPath, JSON.stringify(bundle))
console.log(`Generated bundle.json: ${Object.keys(models).length} models, ${Object.keys(normalizedBlockstates).length} blockstates, ${textures.length} textures`)
