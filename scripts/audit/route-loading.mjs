// Reproduce an import completing while its KeepAlive route is leaving the page.
// Uses an isolated browser profile and the actual compiled app. No account login.
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createStaticServer, findChromePath, killProcessTree, makeTempDir, removeQuietly, sleep } from './shared.mjs'

const target = process.argv[2] || 'dist'
const output = process.argv[3]
const remote = /^https?:\/\//.test(target)
// The discovery helper can exit when Chrome is missing. Do it before allocating
// a server/profile, so that path does not skip their cleanup.
const chromePath = await findChromePath()
let releaseModule
const heldModule = new Promise((resolve) => { releaseModule = resolve })
let heldRequests = 0
const server = remote ? null : await createStaticServer({
  root: path.resolve(target),
  async onRequest(_request, _response, url) {
    if (/\/CourseArchiveView-[^/]+\.js$/.test(url.pathname)) {
      heldRequests++
      await heldModule
    }
    return false
  },
})
const origin = remote ? target.replace(/\/$/, '') : server.origin
const workDir = await makeTempDir('sl-route-loading-')
const port = await new Promise((resolve, reject) => {
  const listener = net.createServer()
  listener.once('error', reject)
  listener.listen(0, '127.0.0.1', () => { const value = listener.address().port; listener.close(() => resolve(value)) })
})
const report = { target, origin, at: new Date().toISOString(), cases: [], errors: [], badResponses: [], persistentRemoteWrites: 0 }
let chrome, ws, send, evaluate, currentCase = 'startup'
const pending = new Map()
const intercepted = []
const loaded = `Boolean(document.querySelector('#app[data-v-app] main h1'))&&!document.querySelector('.route-fallback,[data-startup-placeholder],main.startup-error')`

try {
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', `--user-data-dir=${workDir}/profile`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let endpoint
  for (let attempt = 0; attempt < 100; attempt++) {
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((tab) => tab.type === 'page')?.webSocketDebuggerUrl } catch { /* Chrome is starting. */ }
    if (endpoint) break
    await sleep(100)
  }
  if (!endpoint) throw new Error('Chrome CDP unavailable')
  ws = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout ${method}`)) }, 15000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      clearTimeout(request.timer)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result || {})
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.errors.push({ case: currentCase, text: message.params.args.map((argument) => argument.value || argument.description || '').join(' ') })
    if (message.method === 'Runtime.exceptionThrown') report.errors.push({ case: currentCase, text: message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text })
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) report.badResponses.push({ case: currentCase, url: message.params.response.url, status: message.params.response.status })
    if (message.method === 'Fetch.requestPaused') {
      heldRequests++
      intercepted.push(message.params.requestId)
    }
  })
  ws.addEventListener('close', () => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Chrome session closed')) } pending.clear() })
  evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  const until = async (expression, timeout = 15000) => {
    const start = Date.now()
    while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await sleep(20) }
    throw new Error(`UI timeout: ${expression}`)
  }
  const assert = (condition, label) => { report.cases.push({ label, passed: Boolean(condition) }); if (!condition) throw new Error(label) }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setBypassServiceWorker', { bypass: true })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('sl_performance_mode','"off"')` })
  if (remote) await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/assets/CourseArchiveView-*.js`, requestStage: 'Request' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  report.browser = await send('Browser.getVersion')
  await send('Page.navigate', { url: origin + '/#/' })
  await until(loaded)
  await until(`!document.querySelector('[class*=page-enter],[class*=page-leave]')`)
  await evaluate(`(() => {
    window.qaCourseLoadTrace=[];
    const seen=new WeakSet();
    new MutationObserver(() => {
      for(const heading of document.querySelectorAll('main h1')) {
        if(heading.textContent==='课程进度'&&!seen.has(heading)) {
          seen.add(heading);
          window.qaCourseLoadTrace.push({duringLeave:Boolean(heading.closest('.page-leave-active'))});
        }
      }
    }).observe(document.querySelector('main'),{childList:true,subtree:true});
  })()`)

  currentCase = 'navigate to loading course'
  await evaluate(`location.hash='/course'`)
  await until(`Boolean(document.querySelector('main .route-fallback'))&&!document.querySelector('[class*=page-leave]')`)
  for (let attempt = 0; attempt < 100 && !heldRequests; attempt++) await sleep(20)
  assert(heldRequests > 0, 'Course module remains pending while its real route is visible')
  await until(`!document.querySelector('[class*=page-enter],[class*=page-leave]')`)
  currentCase = 'resolve course import during its leave transition'
  await evaluate(`location.hash='/tasks'`)
  await until(`Boolean(document.querySelector('main .route-fallback.page-leave-active,main .page-leave-active .route-fallback'))`)
  releaseModule()
  for (const requestId of intercepted.splice(0)) await send('Fetch.continueRequest', { requestId })
  if (remote) await send('Fetch.disable')
  await until(`${loaded}&&document.querySelector('main h1')?.textContent==='待办'`)
  await until(`!document.querySelector('[class*=page-enter],[class*=page-leave]')`)
  await sleep(700)
  assert(report.errors.length === 0, 'A route import completing during its leave does not produce rendering errors')
  report.loadTrace = await evaluate('window.qaCourseLoadTrace')
  assert(report.loadTrace.some((observation) => observation.duringLeave), 'The loaded course actually renders before its leave transition ends')
  assert(await evaluate(`document.querySelector('main h1')?.textContent==='待办'`), 'The active page remains Tasks')
  currentCase = 'return to cached course'
  await evaluate(`location.hash='/course'`)
  await until(`${loaded}&&document.querySelector('main h1')?.textContent==='课程进度'`)
  await sleep(300)
  assert(report.errors.length === 0, 'Returning to the cached course succeeds without errors')
  assert(report.badResponses.length === 0, 'All actual application resource responses succeed')
} catch (error) {
  report.failure = String(error.stack || error)
  process.exitCode = 1
} finally {
  releaseModule()
  try { if (send && ws?.readyState === 1) await send('Browser.close') } catch { /* Browser may already be closed. */ }
  try { ws?.close() } catch { /* Already closed. */ }
  await killProcessTree(chrome)
  await server?.close()
  const resolved = path.resolve(workDir)
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('sl-route-loading-')) throw new Error('Unsafe browser profile cleanup path')
  await removeQuietly(resolved)
  if (output) await writeFile(path.resolve(output), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
