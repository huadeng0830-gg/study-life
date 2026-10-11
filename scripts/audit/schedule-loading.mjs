// Local production-build probe. Fresh profile, no cloud requests, cache/SW bypassed.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { createStaticServer, findChromePath, killProcessTree, sleep } from './shared.mjs'

const dist = resolve(process.argv[2])
const output = resolve(process.argv[3])
const profile = await mkdtemp(resolve(output, '../chrome-'))
const server = await createStaticServer({ root: dist })
const origin = server.origin
const chrome = spawn(await findChromePath(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
let ws
const report = { errors: [], checks: [] }
let holdEditor = false
let heldEditorRequest = ''
try {
  let port
  for (let n = 0; n < 100; n++) {
    try { port = Number((await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await sleep(50) }
  }
  if (!port) throw new Error('Chromium debugging port unavailable')
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((yes, no) => { ws.onopen = yes; ws.onerror = no })
  let sequence = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((yes, no) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); no(new Error(`Timeout: ${method}`)) }, 15000)
    pending.set(id, { yes, no, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  ws.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      if (holdEditor && /\/CourseEditorModal-[^/]+\.js$/.test(request.url)) {
        heldEditorRequest = requestId
        return
      }
      const allowed = request.url.startsWith(origin + '/') || /^(data|blob):/.test(request.url)
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
    }
  }
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async expression => {
    for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await sleep(50) }
    throw new Error(`UI did not settle: ${expression}`)
  }
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  report.browser = await send('Browser.getVersion')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Network.setBypassServiceWorker', { bypass: true })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  const version = (await readFile(resolve(dist, 'version.txt'), 'utf8')).trim()
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'}});localStorage.setItem('study_life_seen_release',${JSON.stringify(version)});localStorage.setItem('sl_last_backup_at',JSON.stringify(new Date().toISOString()));` })
  await send('Page.navigate', { url: origin + '/#/schedule' })
  await until(`Boolean(document.querySelector('.schedule-toolbar'))`)
  await sleep(1800)
  report.cold = await evaluate(`({resources:performance.getEntriesByType('resource').filter(x=>/\\/assets\\/.*\\.(js|css)(\\?|$)/.test(x.name)).map(x=>({file:x.name.split('/').pop(),decodedBytes:x.decodedBodySize,transferBytes:x.transferSize})),dialogs:document.querySelectorAll('[role="dialog"]').length})`)
  report.cold.jsFiles = report.cold.resources.filter(item => item.file.endsWith('.js')).length
  report.cold.jsDecodedBytes = report.cold.resources.filter(item => item.file.endsWith('.js')).reduce((sum, item) => sum + item.decodedBytes, 0)
  const clickText = async text => {
    await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!b)throw Error('Missing button');b.click()})()`)
  }
  await clickText('添加课程')
  await until(`Boolean(document.querySelector('#course-name'))`)
  await evaluate(`(()=>{const x=document.querySelector('#course-name');x.value='合成测试课程';x.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await clickText('保存')
  await until(`!document.querySelector('#course-name')`)
  await until(`JSON.parse(localStorage.getItem('sl_courses')||'[]').some(x=>x.name==='合成测试课程')`)
  report.checks.push({ name: 'course-save', passed: await evaluate(`JSON.parse(localStorage.getItem('sl_courses')||'[]').some(x=>x.name==='合成测试课程')`) })
  await clickText('添加课程'); await until(`Boolean(document.querySelector('#course-name'))`)
  report.checks.push({ name: 'editor-reopen-reset', passed: await evaluate(`document.querySelector('#course-name').value===''`) })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await until(`!document.querySelector('#course-name')`)
  await clickText('课表设置'); await until(`Boolean(document.querySelector('#schedule-settings'))`)
  await clickText('批量管理'); await until(`Boolean(document.querySelector('[role="dialog"]'))`)
  report.checks.push({ name: 'manager-open', passed: await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('合成测试课程')`) })
  const closeDialog = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await until(`!document.querySelector('[role="dialog"]')`)
  }
  await closeDialog()
  await clickText('学期起始日'); await until(`Boolean(document.querySelector('#semester-start'))`)
  report.checks.push({ name: 'semester-first-open-initialized', passed: await evaluate(`Boolean(document.querySelector('#semester-start').value)`) })
  await closeDialog()
  await clickText('作息与节次'); await until(`Boolean(document.querySelector('[role="tablist"][aria-label="设置分区"]'))`)
  report.checks.push({ name: 'time-settings-first-open', passed: true })
  await closeDialog()
  await clickText('导入课程表'); await until(`Boolean(document.querySelector('[aria-label="批量录入课程文本"]'))`)
  report.checks.push({ name: 'batch-first-open', passed: true })
  await closeDialog()
  if (process.argv.includes('--lifetime')) {
    holdEditor = true
    await send('Page.navigate', { url: origin + '/?lifetime=1#/schedule' })
    await until(`Boolean(document.querySelector('.schedule-toolbar'))`)
    await clickText('添加课程')
    for (let n = 0; !heldEditorRequest && n < 100; n++) await sleep(30)
    if (!heldEditorRequest) throw new Error('Editor chunk interception did not fire')
    await evaluate(`location.hash='/tasks'`)
    await until(`Boolean(document.querySelector('.task-toolbar')) || document.querySelector('main h1')?.textContent.includes('待办')`)
    holdEditor = false
    await send('Fetch.continueRequest', { requestId: heldEditorRequest })
    await sleep(600)
    report.checks.push({ name: 'late-editor-stays-off-other-route', passed: await evaluate(`!document.querySelector('[role="dialog"]') && document.body.style.overflow!=='hidden'`) })
    await evaluate(`location.hash='/schedule'`)
    await until(`Boolean(document.querySelector('#course-name'))`)
    report.checks.push({ name: 'late-editor-opens-on-return', passed: true })
    await closeDialog()
  }
  report.afterOpenFiles = await evaluate(`performance.getEntriesByType('resource').filter(x=>/\\/assets\\/.*\\.js$/.test(x.name)).map(x=>x.name.split('/').pop())`)
  const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'))
  report.dialogChunks = Object.entries(manifest).filter(([key]) => /components\/schedule\/.*Modal\.vue$/.test(key)).map(([key, item]) => ({ component: basename(key), file: basename(item.file), coldLoaded: report.cold.resources.some(resource => resource.file === basename(item.file)) }))
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ jsFiles: report.cold.jsFiles, jsDecodedBytes: report.cold.jsDecodedBytes, coldDialogs: report.dialogChunks.filter(item => item.coldLoaded).length, checks: report.checks, errors: report.errors }))
  if (report.errors.length || report.checks.some(check => !check.passed)) process.exitCode = 1
} catch (error) {
  report.failure = error.stack
  await writeFile(output, JSON.stringify(report, null, 2))
  console.error(error); process.exitCode = 1
} finally {
  ws?.close()
  await killProcessTree(chrome)
  await server.close()
}
