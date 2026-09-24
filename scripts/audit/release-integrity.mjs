// scripts/audit/release-integrity.mjs
//
// 【这个脚本回答什么问题】
//   「刚刚发布（或即将发布）的这个站点，资源图是完整的吗？」
//   它检查三类资源是否都能返回 200：
//     1. index.html 直接引用的资源（入口 JS/CSS、图标、manifest 等）；
//     2. 所有 JS 内部出现的 assets/xxx-hash.js|css —— 懒加载分包的名字只写在 JS 里
//        （Vite/rolldown 的 __vite__mapDeps 与 import("./X-hash.js")），index.html 里看不到，
//        这是最容易漏的一环。这里沿静态引用做传递闭包扫描，直到没有新文件为止；
//     3. sw.js 里 workbox precacheAndRoute 的预缓存清单条目。
//
// 【为什么需要它】
//   手机端「打不开、一直在刷新首页」的根因就是某个分包 404：SW 拿着旧入口、CDN 只剩新资源，
//   应用清缓存 → 注销 SW → 重载 → 再次 404 的死循环。发布前跑一次这个脚本，几秒钟就能发现
//   「入口图里少了一个文件」，而不是等用户在手机上撞见白屏。分包 404 属于必现故障，
//   所以任一资源非 200 都判 RED 并以非零退出。
//
// 【怎么用】
//   node scripts/audit/release-integrity.mjs <baseUrl>
//   npm run audit:release                 # 默认线上 https://study-life.pages.dev
//   node scripts/audit/release-integrity.mjs http://127.0.0.1:4173   # 发布前查本地预览
//
// 【退出码 / 结论】
//   0 = GREEN：所有检查项都是 200，且 sw.js 预缓存清单被成功解析（条数 > 0）。
//   1 = RED  ：出现 4xx/5xx 缺失项，或 sw.js 清单解析为 0 条（说明检查本身瞎了），或入口不可用。
//   2 = 网络/参数问题：完全连不上 baseUrl（这不是「发布内容坏了」，而是环境问题）。
//
// 【输出】
//   stdout 是稳定可解析的 JSON（含版本号、各项检查条数、缺失明细），
//   stderr 是给人看的进度与结论摘要。管道里只拿 stdout 即可。

import process from 'node:process'

const DEFAULT_BASE = 'https://study-life.pages.dev'
const MAX_CONCURRENCY = 6

const base = (process.argv[2] || DEFAULT_BASE).replace(/\/+$/, '')
const log = (message) => process.stderr.write(`[audit:release] ${message}\n`)

const failures = []
const missing = []
const sources = new Map() // path -> Set(source)

function mark(path, source) {
  if (!sources.has(path)) sources.set(path, new Set())
  sources.get(path).add(source)
}

function absolute(target) {
  if (/^https?:\/\//i.test(target)) return target
  return `${base}${target.startsWith('/') ? '' : '/'}${target}`
}

function toPath(target) {
  try {
    const url = new URL(absolute(target))
    return url.pathname
  } catch {
    return target
  }
}

function isSameOrigin(target) {
  try {
    return new URL(absolute(target)).origin === new URL(base).origin
  } catch {
    return false
  }
}

/** 带一次重试的 GET 文本请求。 */
async function fetchText(target, { attempts = 2 } = {}) {
  const url = absolute(target)
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow', cache: 'no-store' })
      const body = res.status === 200 ? await res.text() : ''
      if (res.status !== 200) await res.body?.cancel().catch(() => {})
      return { url, status: res.status, body, finalUrl: res.url }
    } catch (error) {
      lastError = error
    }
  }
  return { url, status: 0, body: '', error: String(lastError?.message || lastError) }
}

/**
 * 探测资源状态码。默认 HEAD（便宜），但有些 CDN/静态服务器对 HEAD 返回 405/403/501，
 * 此时回退成 GET —— 原临时脚本只用 HEAD，遇到这类服务器会把健康资源误判成 RED。
 */
async function probeStatus(target, { attempts = 2 } = {}) {
  const url = absolute(target)
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      let res = await fetch(url, { method: 'HEAD', redirect: 'follow', cache: 'no-store' })
      await res.body?.cancel().catch(() => {})
      if ([403, 405, 501].includes(res.status)) {
        res = await fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' })
        await res.body?.cancel().catch(() => {})
      }
      return { status: res.status, finalUrl: res.url }
    } catch (error) {
      lastError = error
    }
  }
  return { status: 0, error: String(lastError?.message || lastError) }
}

/** 固定并发的工作池，避免把站点打爆。 */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

// ---------------------------------------------------------------------------
// 1. 入口 HTML
// ---------------------------------------------------------------------------
log(`检查入口 ${base}/index.html`)
const html = await fetchText('/index.html')
if (html.status === 0) {
  process.stderr.write(`${JSON.stringify({ tool: 'release-integrity', base, verdict: 'ERROR', reason: `无法连接 ${base}：${html.error}` }, null, 2)}\n`)
  process.exit(2)
}
if (html.status !== 200) {
  failures.push({ kind: 'index-not-200', detail: `index.html 返回 ${html.status}` })
}

const versionRes = await fetchText('/version.txt')
const version = versionRes.status === 200 ? versionRes.body.trim() : null
if (versionRes.status !== 200) failures.push({ kind: 'version-not-200', detail: `version.txt 返回 ${versionRes.status}` })
log(`站点版本：${version ?? '(读不到 version.txt)'}`)

// 1a) index.html 直接引用的资源：src/href 属性 + 内联脚本里出现的 assets/*
const indexReferenced = new Set()
let externalSkipped = 0
const collectIndexRefs = (target) => {
  const pathname = toPath(target)
  if (!isSameOrigin(target)) {
    externalSkipped += 1
    return
  }
  if (pathname === '/') return
  indexReferenced.add(pathname)
  mark(pathname, 'index.html')
}
for (const match of html.body.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/gi)) {
  const value = match[1].trim()
  if (!value || value.startsWith('data:') || value.startsWith('#') || value.startsWith('mailto:')) continue
  if (!/\.(?:js|css|mjs|png|svg|webp|jpg|jpeg|gif|ico|webmanifest|json|txt|woff2?|ttf)$/i.test(value)) continue
  collectIndexRefs(value)
}
for (const match of html.body.matchAll(/["'(](\/?assets\/[A-Za-z0-9_.-]+\.(?:js|css))["')]/g)) {
  collectIndexRefs(`/${match[1].replace(/^\//, '')}`)
}

// ---------------------------------------------------------------------------
// 2. sw.js 预缓存清单
// ---------------------------------------------------------------------------
// 修正点：旧脚本用 /"url":"([^"]+)"/ 解析，在真实产物上匹配 0 条且不报错，等于白检查。
// 实际产物是压缩过的 `{url:"assets/x.js",revision:null}`（属性名无引号），
// 这里改成「先定位 precacheAndRoute([...]) 的数组，再在数组内部提取 url: 字段」，
// 并显式断言解析条数 > 0，避免再次出现「正则失配但表面通过」。
function extractPrecacheUrls(text) {
  const marker = text.indexOf('precacheAndRoute(')
  if (marker === -1) return { entries: [], found: false, reason: 'no-call' }
  let cursor = marker + 'precacheAndRoute('.length
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
  // 只接受「清单被内联成字面量数组」这一种形态（vite-plugin-pwa generateSW 的产物）。
  // 如果这里是 self.__WB_MANIFEST 之类的变量，说明清单没有内联，静态检查拿不到条目，
  // 必须显式报出来，而不是顺手去后面找一个不相干的 [ 然后假装解析成功。
  if (text[cursor] !== '[') return { entries: [], found: false, reason: 'not-inlined' }
  const open = cursor
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') i += 2
        else if (text[i] === quote) break
        else i += 1
      }
      continue
    }
    if (char === '[' || char === '{' || char === '(') depth += 1
    else if (char === ']' || char === '}' || char === ')') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const arrayText = end === -1 ? text.slice(open) : text.slice(open, end + 1)
  const entries = [...arrayText.matchAll(/url\s*:\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => m[1] ?? m[2])
  if (entries.length === 0) return { entries, found: false, reason: 'empty-array' }
  return { entries, found: true }
}

log('解析 sw.js 预缓存清单')
const sw = await fetchText('/sw.js')
let precacheEntries = []
let precacheParse = 'ok'
if (sw.status !== 200) {
  failures.push({ kind: 'sw-not-200', detail: `sw.js 返回 ${sw.status}` })
  precacheParse = 'sw-unavailable'
} else {
  const parsed = extractPrecacheUrls(sw.body)
  precacheEntries = parsed.entries
  if (!parsed.found) {
    precacheParse = parsed.reason === 'not-inlined'
      ? 'manifest-not-inlined'
      : parsed.reason === 'empty-array'
        ? 'empty'
        : 'no-precache-and-route'
    failures.push({
      kind: `precache-manifest-${precacheParse}`,
      detail: parsed.reason === 'empty-array'
        ? 'precacheAndRoute 解析出 0 条预缓存条目（解析方式与实际产物不匹配？）'
        : parsed.reason === 'not-inlined'
          ? 'sw.js 的 precacheAndRoute 参数不是内联数组（例如 self.__WB_MANIFEST），无法静态核对预缓存清单'
          : 'sw.js 里找不到 precacheAndRoute([...]) 调用',
    })
  }
}
log(`预缓存清单：${precacheEntries.length} 条（parse=${precacheParse}）`)

const precachePaths = new Set()
for (const raw of precacheEntries) {
  const pathname = toPath(raw)
  precachePaths.add(pathname)
  mark(pathname, 'sw.js:precache')
}

// ---------------------------------------------------------------------------
// 3. JS 传递闭包扫描
// ---------------------------------------------------------------------------
const ASSET_BOUNDARY = '(?=["\'`)\\]}\\s,;?]|$)'
const ASSET_IN_JS = [
  // "assets/x.js" 形态：rolldown 把 __vite__mapDeps 写成 "assets/xxx.js"。
  new RegExp(`["'\`(](?:\\.{0,2}\\/)?assets\\/([A-Za-z0-9_.-]+\\.(?:js|css))${ASSET_BOUNDARY}`, 'g'),
  // `./x.js` 形态：动态 import 相对当前模块（/assets/）解析，补上这一条才不会漏掉
  // 只通过相对路径引用的分包。加边界断言是为了不把 "assets/x.js.map" 误判成 x.js。
  new RegExp(`["'\`(]\\.\\/([A-Za-z0-9_.-]+\\.(?:js|css))${ASSET_BOUNDARY}`, 'g'),
]

const jsScanned = new Set()
const closureAssets = new Set()
const queue = []
for (const pathname of [...indexReferenced, ...precachePaths]) {
  if (pathname.endsWith('.js')) queue.push(pathname)
}

log(`扫描 JS 传递闭包（起点 ${queue.length} 个）`)
while (queue.length) {
  const pathname = queue.shift()
  if (jsScanned.has(pathname)) continue
  jsScanned.add(pathname)
  const file = await fetchText(pathname)
  if (file.status !== 200) {
    // 闭包里的 JS 自己就拉不到：这就是分包 404 的那种故障，直接记缺失。
    missing.push({ path: pathname, status: file.status, referencedBy: [...(sources.get(pathname) || [])] })
    continue
  }
  for (const pattern of ASSET_IN_JS) {
    for (const match of file.body.matchAll(pattern)) {
      const assetPath = `/assets/${match[1]}`
      mark(assetPath, `js:${pathname}`)
      closureAssets.add(assetPath)
      if (match[1].endsWith('.js') && !jsScanned.has(assetPath)) queue.push(assetPath)
    }
  }
}
log(`扫描了 ${jsScanned.size} 个 JS，闭包内分包 ${closureAssets.size} 个`)

// ---------------------------------------------------------------------------
// 4. 逐条探测
// ---------------------------------------------------------------------------
const allTargets = [...new Set([...indexReferenced, ...precachePaths, ...closureAssets])]
  .filter((pathname) => pathname !== '/index.html') // 入口在第一步已经查过
  .sort()

log(`逐条探测 ${allTargets.length} 个资源（HEAD，必要时回退 GET）`)
const probed = await mapPool(allTargets, MAX_CONCURRENCY, async (pathname) => {
  const result = await probeStatus(pathname)
  return { path: pathname, ...result }
})

for (const item of probed) {
  if (item.status !== 200) {
    missing.push({
      path: item.path,
      status: item.status,
      error: item.error,
      referencedBy: [...(sources.get(item.path) || [])].slice(0, 6),
    })
  }
}

const missingDeduped = [...new Map(missing.map((item) => [item.path, item])).values()]
  .sort((a, b) => a.path.localeCompare(b.path))

const verdict = failures.length === 0 && missingDeduped.length === 0 ? 'GREEN' : 'RED'
const report = {
  tool: 'release-integrity',
  base,
  version,
  counts: {
    indexReferenced: indexReferenced.size,
    precacheEntries: precacheEntries.length,
    jsScanned: jsScanned.size,
    closureAssets: closureAssets.size,
    assetsChecked: allTargets.length,
    externalSkipped,
  },
  precacheParse,
  missing: missingDeduped,
  failures,
  verdict,
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
log(`结论：${verdict}｜入口引用 ${indexReferenced.size}｜预缓存 ${precacheEntries.length}｜扫描 JS ${jsScanned.size}｜探测 ${allTargets.length}｜缺失 ${missingDeduped.length}｜失败项 ${failures.length}`)
if (verdict === 'RED') {
  for (const item of failures) log(`  失败项 ${item.kind}: ${item.detail}`)
  for (const item of missingDeduped.slice(0, 20)) log(`  缺失 ${item.path} → status=${item.status}（被 ${item.referencedBy.join(', ') || '未知来源'} 引用）`)
}
process.exit(verdict === 'RED' ? 1 : 0)