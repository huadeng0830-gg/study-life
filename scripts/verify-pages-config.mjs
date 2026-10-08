import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const wranglerPath = path.join(ROOT, 'wrangler.jsonc')
const headersPath = path.join(ROOT, 'public', '_headers')
const htmlPath = path.join(ROOT, 'index.html')

const wrangler = JSON.parse(readFileSync(wranglerPath, 'utf8'))
if (wrangler.pages_build_output_dir !== './dist') {
  throw new Error('wrangler.jsonc 必须显式将 Pages 输出目录绑定到 ./dist。')
}
if (!existsSync(headersPath)) throw new Error('Cloudflare Pages 安全头文件 public/_headers 缺失。')
const headers = readFileSync(headersPath, 'utf8')
for (const header of ['Content-Security-Policy:', 'Strict-Transport-Security:', 'X-Content-Type-Options: nosniff']) {
  if (!headers.includes(header)) throw new Error(`public/_headers 缺少 ${header}`)
}
const scriptSource = /(?:^|;)\s*script-src\b([^;]*)/i.exec(headers)?.[1] || ''
if (/(?:^|\s)'unsafe-(?:inline|eval)'(?:\s|$)/i.test(scriptSource)) {
  throw new Error('Content-Security-Policy 的 script-src 不得放行 unsafe-inline 或 unsafe-eval。')
}
const declaredHashes = new Set([...headers.matchAll(/'sha256-([^']+)'/g)].map((match) => match[1]))
const html = readFileSync(htmlPath, 'utf8')
const inlineScripts = [...html.matchAll(/<script\b((?:(?!\bsrc\s*=)[^>])*)>([\s\S]*?)<\/script\s*>/gi)]
for (const [, attributes, source] of inlineScripts) {
  if (/\btype\s*=\s*["']?module\b/i.test(attributes)) continue
  const hash = createHash('sha256').update(source).digest('base64')
  if (!declaredHashes.has(hash)) throw new Error('index.html 的内联启动脚本 SHA-256 与 CSP 不匹配。')
}
console.log('✓ Cloudflare Pages 输出目录与安全头配置已核验')
