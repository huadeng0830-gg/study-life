// scripts/audit/first-visit.mjs
//
// 【这个脚本回答什么问题】
//   「一个全新用户（全新 profile、没有任何缓存和 Service Worker）第一次打开线上地址，
//    页面会不会自己反复刷新？首屏有没有控制台报错或未捕获异常？」
//   它用真 Chrome + CDP（--remote-debugging-port）精确统计「主框架导航次数」，
//   并收集 console error/warning、未捕获异常、以及 Log 域里的网络错误（例如 404）。
//
// 【为什么需要它】
//   手机端「打不开、一直在刷新首页」这个故障，在服务端日志里看起来只是一串 200/404，
//   真正能判定的只有客户端行为：全新 profile 首访应该只导航 1 次，出现 2 次说明发生了一次
//   自动恢复重载，超过 2 次说明已经进入「刷新循环」。这个数字是回归信号，必须能一键复现。
//   （最初用 netlog 数导航不可靠——浏览器被强杀时日志会被截断；CDP 事件不受影响。）
//
// 【怎么用】
//   node scripts/audit/first-visit.mjs [url] [seconds] [windowSize]
//   npm run audit:first-visit
//   node scripts/audit/first-visit.mjs https://study-life.pages.dev 20 390,844
//   node scripts/audit/first-visit.mjs http://127.0.0.1:4173 16 1280,900   # 查本地预览
//   seconds 默认 16，windowSize 默认 390,844（手机视口）。可用 CHROME_PATH 指定浏览器。
//
// 【退出码 / 结论】
//   0 = GREEN：应用已打开、导航 1–2 次，且无启动占位、失败界面或错误。
//   1 = RED  ：刷新循环、空白/未完成启动界面，或控制台、异常、资源错误。
//   2 = 环境问题：找不到 Chrome、或 DevTools 端口起不来。
//
// 【输出】stdout 为稳定 JSON；stderr 为中文进度。浏览器进程、临时 profile 一定会被清理。

import { spawn } from 'node:child_process'
import net from 'node:net'
import process from 'node:process'

import { findChromePath, killProcessTree, makeTempDir, removeQuietly, sleep } from './shared.mjs'
import { bootAuditFailures } from './boot-verdict.mjs'

const DEFAULT_URL = 'https://study-life.pages.dev'
const [rawUrl, rawSeconds, rawSize] = process.argv.slice(2)
const targetUrl = rawUrl && !rawUrl.startsWith('-') ? rawUrl : DEFAULT_URL
const seconds = Number(rawSeconds ?? 16)
const windowSize = rawSize || '390,844'

const log = (message) => process.stderr.write(`[audit:first-visit] ${message}\n`)

if (!Number.isFinite(seconds) || seconds <= 0) {
  process.stderr.write('[audit:first-visit] seconds 必须是正数，例如 16\n')
  process.exit(2)
}
if (!/^\d+,\d+$/.test(windowSize)) {
  process.stderr.write('[audit:first-visit] windowSize 形如 390,844\n')
  process.exit(2)
}

const chromePath = await findChromePath()
log(`使用 Chrome：${chromePath}`)

/** 取一个空闲端口给 CDP 用（不写死 9222/9223，避免和本机已开的调试端口或并行自检撞车）。 */
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

const workDir = await makeTempDir('sl-first-visit')
const profileDir = `${workDir}/profile`
const cdpPort = await freePort()
let chrome
let ws

const mainFrameNavigations = []
const consoleErrors = []
const consoleWarnings = []
const exceptions = []
const networkErrors = []
let loadEvents = 0

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
    `--window-size=${windowSize}`,
    'about:blank',
  ]
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    chromeArgs.unshift('--no-sandbox')
  }
  log(`启动全新 profile：${profileDir}`)
  chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' })

  // 等待 DevTools 端口就绪（Chrome 冷启动可能几百毫秒到几秒）。
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

  // 注意：这里先开 about:blank，连上 CDP 并 enable 各域之后再导航。
  // 旧写法是 /json/new?<url> 直接把 URL 交给浏览器，导致「连上之前」发生的事件全部丢失——
  // 恰恰是首访最开始那几次导航和最早的报错丢失，等于把要测的东西漏掉了。
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
    if (frame.parentId) return // 只要主框架
    if (!frame.url || frame.url === 'about:blank') return // 我们自己占位的那次空导航不算
    mainFrameNavigations.push({ at: Date.now(), url: frame.url })
  })
  session.on('Page.loadEventFired', () => { loadEvents += 1 })
  session.on('Runtime.consoleAPICalled', (params) => {
    const type = params.type
    if (type !== 'error' && type !== 'warning') return
    const text = (params.args || [])
      .map((arg) => String(arg.value ?? arg.description ?? arg.unserializableValue ?? ''))
      .join(' ')
      .slice(0, 300)
    if (!text) return
    if (type === 'error') consoleErrors.push(text)
    else consoleWarnings.push(text)
  })
  session.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {}
    const text = String(details.exception?.description || details.text || '').slice(0, 300)
    if (text) exceptions.push(text)
  })
  session.on('Log.entryAdded', (params) => {
    const entry = params.entry || {}
    if (entry.level !== 'error') return
    const text = String(entry.text || '').slice(0, 300)
    if (entry.source === 'network') networkErrors.push(`${text}${entry.url ? ` ← ${entry.url}` : ''}`)
    else exceptions.push(`[${entry.source || 'log'}] ${text}`)
  })

  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Log.enable')
  const [viewportWidth, viewportHeight] = windowSize.split(',').map(Number)
  if (!Number.isInteger(viewportWidth) || viewportWidth <= 0 || !Number.isInteger(viewportHeight) || viewportHeight <= 0) {
    throw new Error('windowSize 必须是两个正整数，例如 390,844')
  }
  // Headless Chrome 的窗口有最小宽度；必须显式覆盖布局视口才能测到 320/390px。
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 900,
  })

  log(`打开 ${targetUrl}（视口 ${windowSize}，观察 ${seconds} 秒）`)
  await session.send('Page.navigate', { url: targetUrl })
  await sleep(seconds * 1000)
  // 多等一拍，让最后触发的 reload/报错有机会上报。
  await sleep(500)

  const evaluated = await session.send('Runtime.evaluate', {
    expression: `({appMounted: !!document.querySelector('#app[data-v-app] main'), placeholder: !!document.querySelector('[data-startup-placeholder]'), errorScreen: !!document.querySelector('main.startup-error'), viewport: {width: innerWidth, height: innerHeight}})`,
    returnByValue: true,
  })
  if (evaluated.exceptionDetails) throw new Error('无法读取启动界面')
  const probe = evaluated.result?.value || {}
  const unique = (list, limit = 8) => [...new Set(list)].slice(0, limit)
  const navCount = mainFrameNavigations.length
  const reasons = bootAuditFailures({ navigationCount: navCount, probe, consoleErrors, exceptions, networkErrors })
  const report = {
    tool: 'first-visit',
    url: targetUrl,
    seconds,
    windowSize,
    chrome: chromePath,
    mainFrameNavigations: navCount,
    reloads: Math.max(0, navCount - 1),
    loadEvents,
    navigationSequence: mainFrameNavigations.map((item) => item.url.replace(/^https?:\/\//, '').slice(0, 80)),
    consoleErrors: unique(consoleErrors),
    consoleWarnings: unique(consoleWarnings),
    exceptions: unique(exceptions),
    networkErrors: unique(networkErrors),
    probe,
    reasons,
    verdict: reasons.length ? 'RED' : 'GREEN',
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  log(`结论：${report.verdict}｜主框架导航 ${navCount} 次（额外重载 ${report.reloads}）｜console error ${unique(consoleErrors, 99).length}｜异常 ${unique(exceptions, 99).length}｜网络错误 ${unique(networkErrors, 99).length}`)
  if (navCount > 2) log('主框架导航超过 2 次：首访正在循环刷新，请检查分包是否 404 与启动恢复预算逻辑。')
  process.exitCode = reasons.length ? 1 : 0
} catch (error) {
  process.stderr.write(`${JSON.stringify({ tool: 'first-visit', url: targetUrl, verdict: 'ERROR', reason: String(error?.message || error) }, null, 2)}\n`)
  process.exitCode = 2
} finally {
  try { ws?.close() } catch { /* 已关闭 */ }
  await killProcessTree(chrome)
  await removeQuietly(workDir)
  log('已清理临时 profile 与 Chrome 进程')
}
