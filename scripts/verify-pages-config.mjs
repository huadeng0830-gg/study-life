import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
const declaredHashes = new Set([...scriptSource.matchAll(/'sha256-([^']+)'/g)].map((match) => match[1]))
function publicHtmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? publicHtmlFiles(file) : entry.isFile() && /\.html$/i.test(entry.name) ? [file] : []
  })
}
const htmlFiles = [htmlPath, ...publicHtmlFiles(path.join(ROOT, 'public'))]
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8')
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  for (const [, attributes, source] of scripts) {
    if (/(?:^|\s)src\s*=/i.test(attributes)) continue
    // HTML input preprocessing normalizes CRLF and CR to LF before the browser
    // evaluates any inline classic or module script, including static pages.
    const hash = createHash('sha256').update(source.replace(/\r\n?/g, '\n')).digest('base64')
    const relativeFile = path.relative(ROOT, file).split(path.sep).join('/')
    if (!declaredHashes.has(hash)) throw new Error(`${relativeFile} 的内联脚本 SHA-256 与 CSP script-src 不匹配。`)
  }
}
console.log(`✓ Cloudflare Pages 输出目录与安全头配置已核验（${htmlFiles.length} 个自有 HTML 文件）`)
