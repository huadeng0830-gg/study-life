// scripts/audit/iphone-boot.mjs
//
// 【这个脚本回答什么问题】
//   「在**缺少 requestIdleCallback 的浏览器**（iPhone/iPad 上的 Safari）里，首屏还能不能打开？
//    会不会弹『页面没有完整加载』那张致命错误页？」
//
// 【为什么需要它】2026-09-20 的真实故障：手机版打开就是「页面没有完整加载」，而电脑版完全正常。
//   根因是启动路径里存在**没有守卫的 requestIdleCallback 调用**（`src/main.js` 的时段预加载）：
//   Chrome 有这个 API，Safari 没有，于是 main.js 在 `bootstrap()` 里抛 ReferenceError →
//   `bootstrap().catch()` 把它当成启动失败 → 清 Service Worker 与缓存后重载 →
//   重新加载仍然抛（时段没变）→ 用光自动恢复预算 → 弹出致命错误页；用户点「重新加载」
//   也只是再来一遍，所以「点了还是这张错误页」。
//
//   这个检查装置**不依赖当天的钟点**：它把页面里的 `Date.prototype.getHours` 钉在 20 点，
//   让「晚上预加载」那条分支每次都必然走到（否则这个检查会随一天中的时间时红时绿）。
//
// 【怎么用】
//   node scripts/audit/iphone-boot.mjs [url] [seconds]
//   npm run audit:iphone-boot
//   node scripts/audit/iphone-boot.mjs https://study-life.pages.dev 14
//   可用 CHROME_PATH 指定浏览器；seconds 默认 14。
//
// 【退出码 / 结论】
//   0 = GREEN：首屏挂上来了（#app 已挂载、静态占位已消失）且没有出现致命错误页。
//   1 = RED  ：出现 `main.startup-error`（致命错误页）或首屏始终没挂上来。
//   2 = 环境问题：找不到 Chrome、DevTools 端口起不来。
//
// 【输出】stdout 为稳定 JSON；stderr 为中文进度。浏览器进程与临时 profile 一定会被清理。

import { spawn } from 'node:child_process'
import net from 'node:net'
import process from 'node:process'

import { findChromePath, killProcessTree, makeTempDir, removeQuietly, sleep } from './shared.mjs'
import { bootAuditFailures } from './boot-verdict.mjs'

const DEFAULT_URL = 'https://study-life.pages.dev'
const rawArgs = process.argv.slice(2)
const flagValue = (name) => {
  const hit = rawArgs.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const positionals = rawArgs.filter((arg) => !arg.startsWith('-'))
const targetUrl = positionals[0] || DEFAULT_URL
const seconds = Number(positionals[1] ?? 14)
// 差分实验用的开关：把钟点钉到别的时段、或保留 requestIdleCallback。
// 两个开关都是为了「一次只改一个变量」地验证根因，默认值就是故障现场。
const pinnedHour = Number(flagValue('hour') ?? process.env.AUDIT_PIN_HOUR ?? 20)
const keepIdleCallback = rawArgs.includes('--keep-idle-callback')

const log = (message) => process.stderr.write(`[audit:iphone-boot] ${message}\n`)

if (!Number.isFinite(seconds) || seconds <= 0) {
  process.stderr.write('[audit:iphone-boot] seconds 必须是正数，例如 14\n')
  process.exit(2)
}

// 注入到每个新文档**执行之前**：模拟 iPhone Safari 缺失的 API，并钉住钟点。
// 只用 delete 与原型覆盖，不引入任何框架，保证和产品代码零耦合。
const SAFARI_SIMULATION = `
  try {
${keepIdleCallback ? '' : '    delete window.requestIdleCallback\n    delete window.cancelIdleCallback\n'}  } catch {}
  // 钉住「小时」：让 src/main.js 里按时段触发的预加载分支每天都必然走到。
  try {
    const pinned = ${Number.isFinite(pinnedHour) ? pinnedHour : 20}
    Object.defineProperty(Date.prototype, 'getHours', { value: function getHours() { return pinned }, configurable: true, writable: true })
  } catch {}
`

const chromePath = await findChromePath()
log(`使用 Chrome：${chromePath}`)

/** 取一个空闲端口给 CDP 用（不写死 9222，避免和本机已开的调试端口或并行自检撞车）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/** 极简 CDP 客户端：发命令、收事件，够本脚本用。 */
class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.message || 'CDP error'}`))
        else resolve(message.result || {})
        return
      }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) || []) handler(message.params || {})
      }
    })
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(handler)
  }

  send(method, params = {}) {
    this.nextId += 1
    const id = this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 命令超时：${method}`))
        }
      }, 15000)
    })
  }
}

const workDir = await makeTempDir('sl-iphone-boot')
const profileDir = `${workDir}/profile`
const cdpPort = await freePort()
let chrome
let ws

const mainFrameNavigations = []
const exceptions = []
const consoleErrors = []

try {
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache',
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    // iPhone 视口：手机版的问题必须在手机的版面上量。
    '--window-size=390,844',
    'about:blank',
  ]
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    chromeArgs.unshift('--no-sandbox')
  }
  log(`启动全新 profile：${profileDir}`)
  chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' })

  let ready = false
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (chrome.exitCode !== null) throw new Error(`Chrome 提前退出（exit ${chrome.exitCode}）`)
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
      if (res.ok) { ready = true; break }
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  if (!ready) throw new Error(`DevTools 端口 ${cdpPort} 在 20 秒内未就绪`)

  const created = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })
  if (!created.ok) throw new Error(`无法创建调试目标：HTTP ${created.status}`)
  const target = await created.json()

  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true })
  })
  const session = new CdpSession(ws)

  session.on('Page.frameNavigated', (params) => {
    const frame = params.frame || {}
    if (frame.parentId) return
    if (!frame.url || frame.url === 'about:blank') return
    mainFrameNavigations.push({ at: Date.now(), url: frame.url })
  })
  session.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {}
    const text = String(details.exception?.description || details.text || '').slice(0, 300)
    if (text) exceptions.push(text)
  })
  session.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return
    const text = (params.args || []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 300)
    if (text) consoleErrors.push(text)
  })

  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
  })
  // 必须在导航之前注入，才能作用于本次加载的第一个文档。
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: SAFARI_SIMULATION })

  const simulationLabel = `${keepIdleCallback ? '保留 requestIdleCallback' : '模拟 Safari 缺失 requestIdleCallback'}，钟点钉在 ${Number.isFinite(pinnedHour) ? pinnedHour : 20} 点`
log(`打开 ${targetUrl}（iPhone 视口，${simulationLabel}，观察 ${seconds} 秒）`)
  await session.send('Page.navigate', { url: targetUrl })
  await sleep(seconds * 1000)
  await sleep(500)

  // 用真实 DOM 判定用户的症状，而不是只看有没有报错。
  const probeRaw = await session.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      errorScreen: !!document.querySelector('main.startup-error'),
      errorTitle: (document.querySelector('main.startup-error h1') || {}).textContent || '',
      appMounted: !!document.querySelector('#app[data-v-app] main'),
      placeholder: !!document.querySelector('[data-startup-placeholder]'),
      bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
      idleCallbackMissing: typeof window.requestIdleCallback === 'undefined',
      viewport: {width: innerWidth, height: innerHeight}
    })`,
    returnByValue: true,
  })
  const probe = JSON.parse(probeRaw.result?.value || '{}')

  const unique = (list, limit = 8) => [...new Set(list)].slice(0, limit)
  const reasons = bootAuditFailures({ navigationCount: mainFrameNavigations.length, probe, consoleErrors, exceptions })
  const bootFailure = reasons.length > 0
  const report = {
    tool: 'iphone-boot',
    url: targetUrl,
    seconds,
    probe: { requestIdleCallbackMissing: probe.idleCallbackMissing, pinnedHour: Number.isFinite(pinnedHour) ? pinnedHour : 20 },
    mainFrameNavigations: mainFrameNavigations.length,
    navigationSequence: mainFrameNavigations.map((item) => item.url.replace(/^https?:\/\//, '').slice(0, 80)),
    appMounted: probe.appMounted,
    viewport: probe.viewport,
    placeholderVisible: probe.placeholder,
    errorScreen: probe.errorScreen,
    errorTitle: probe.errorTitle,
    bodyText: probe.bodyText,
    exceptions: unique(exceptions),
    consoleErrors: unique(consoleErrors),
    reasons,
    verdict: bootFailure ? 'RED' : 'GREEN',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  log(`结论：${report.verdict}｜已挂载 ${probe.appMounted}｜致命错误页 ${probe.errorScreen}${probe.errorTitle ? `（${probe.errorTitle}）` : ''}｜主框架导航 ${mainFrameNavigations.length} 次｜异常 ${unique(exceptions, 99).length}`)
  if (bootFailure) log('缺少 requestIdleCallback 的浏览器下首屏没有打开：检查启动路径里有没有未守卫的 Web API 调用。')
  process.exitCode = bootFailure ? 1 : 0
} catch (error) {
  process.stderr.write(`${JSON.stringify({ tool: 'iphone-boot', url: targetUrl, verdict: 'ERROR', reason: String(error?.message || error) }, null, 2)}\n`)
  process.exitCode = 2
} finally {
  try { ws?.close() } catch { /* 已关闭 */ }
  await killProcessTree(chrome)
  await removeQuietly(workDir)
  log('已清理临时 profile 与 Chrome 进程')
}
