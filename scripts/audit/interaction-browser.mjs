// A local, isolated Chromium integration test. Uses only fictional data and
// blocks external requests; no personal browser profile or cloud write is used.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import net from 'node:net'
import { basename, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findChromePath, killProcessTree, sleep } from './shared.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const origin = (process.argv[2] || 'http://127.0.0.1:5176').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Only a local development origin is allowed')
const tempRoot = resolve(root, '.vitest-tmp')
await mkdir(tempRoot, { recursive: true })
// Keep Chromium's locked files outside Vite's watched source directory.
const profileRoot = resolve(root, '../.tmp')
await mkdir(profileRoot, { recursive: true })
const profile = await mkdtemp(resolve(profileRoot, 'interaction-browser-'))
const fixtureName = `interaction-fixture-${basename(profile)}.html`
const fixturePath = resolve(tempRoot, fixtureName)
const output = resolve(root, process.argv[3] || '../.tmp/interaction-browser-results.json')
const flowsOnly = process.argv.includes('--flows-only')

await writeFile(fixturePath, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>本地交互测试</title><div id="app"></div>
<style>body{margin:0;padding:16px}.test-row{display:flex;gap:8px;margin-bottom:16px}.test-row>button:first-child{flex:1}.fixture{max-width:640px;margin:auto}input{width:100%;margin-bottom:12px}.result{min-height:24px}</style>
<script type="module">
import { createApp, h, ref, nextTick } from 'vue';
import ActionButton from '/src/components/ActionButton.vue';
import '/src/style.css';
import { performanceMode } from '/src/composables/performanceMode.js';
performanceMode.value='off';
const calls={important:0,frequent:0,error:0,form:0};let resolveImportant,resolveForm;const formBusy=ref(false),importantButton=ref(null),fail=ref(true),saved=ref('');
const actionImportant=({signal})=>{calls.important++;return new Promise(resolve=>{resolveImportant=()=>{if(signal.aborted)return resolve(false);localStorage.setItem('ux-test-record','fictional');saved.value='正式保存已完成';resolve(true)}})};
const app=createApp({setup(){return()=>h('main',{class:'fixture'},[
h('h1','交互验收'),h('input',{id:'draft',value:'虚构草稿', 'aria-label':'测试输入'}),
h('div',{class:'test-row'},[h(ActionButton,{id:'important',ref:importantButton,kind:'important',action:actionImportant,successLabel:'已保存'},()=> '正式保存'),h('button',{id:'neighbor',class:'btn'},'取消')]),
h('div',{class:'result',id:'saved'},saved.value),
h(ActionButton,{id:'frequent',action:()=>{calls.frequent++;return true},successLabel:'已保存'},()=> '保存进度'),
h('div',{style:'height:16px'}),h(ActionButton,{id:'error',kind:'important',action:()=>{calls.error++;if(fail.value)throw new Error('测试连接失败，请检查连接后重试');return true}},()=> '失败重试'),
h('form',{id:'form',onSubmit:e=>{e.preventDefault();if(formBusy.value)return;calls.form++;formBusy.value=true;new Promise(resolve=>{resolveForm=resolve}).then(()=>{formBusy.value=false;saved.value='表单已完成'})}},[
h('label',{for:'form-title'},'名称'),h('input',{id:'form-title',required:true}),h(ActionButton,{id:'form-submit',type:'submit',feedback:'external',busy:formBusy.value},()=> formBusy.value?'保存中…':'提交表单')]),
h('div',{id:'live',class:'sr-only',role:'status'},saved.value)
])}});app.mount('#app');
window.audit={calls,resolveImportant:()=>resolveImportant?.(),resolveForm:()=>resolveForm?.(),retryWorks:()=>{fail.value=false},cancel:()=>importantButton.value.cancel(),nextTick,unmount:()=>app.unmount()};
</script></html>`)

const port = await new Promise((yes, no) => {
  const server = net.createServer(); server.once('error', no)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => yes(port)) })
})
const chrome = await findChromePath()
const child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
const report = { cases: [], errors: [], routes: [], screenshots: [] }
let ws
let readFailureContext
try {
  let endpoint
  for (let attempt = 0; attempt < 80; attempt++) {
    try { const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); endpoint = tabs.find(tab => tab.type === 'page')?.webSocketDebuggerUrl; if (endpoint) break } catch {}
    await sleep(100)
  }
  if (!endpoint) throw new Error('Chromium did not expose its local test endpoint')
  ws = new WebSocket(endpoint)
  await new Promise((yes, no) => { ws.addEventListener('open', yes, { once: true }); ws.addEventListener('error', no, { once: true }) })
  let sequence = 0
  const pending = new Map()
  const send = (method, params = {}) => new Promise((yes, no) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); no(new Error(`Timed out: ${method}`)) }, 20_000)
    pending.set(id, { yes, no, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') report.errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''))
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.errors.push(message.params.args.map(arg => arg.description || arg.value || '').join(' ').slice(0, 2400))
    else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params
      const allowed = request.url.startsWith(origin + '/') || /^(data|blob):/.test(request.url)
      void send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
    }
  })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  readFailureContext = () => evaluate(`({url:location.href,body:document.body?.innerText.slice(0,1500)})`)
  const until = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await sleep(50) }
    throw new Error(`UI did not settle: ${expression}`)
  }
  const assert = (condition, label, details = null) => { report.cases.push({ label, passed: Boolean(condition), details }); if (!condition) throw new Error(label + ': ' + JSON.stringify(details)) }
  const pageTitles = { '/': '今天', '/schedule': '课程表', '/course': '课程进度', '/tasks': '待办', '/exams': '重要日期', '/events': '日程', '/lists': '清单', '/bills': '账本', '/review': '本周回顾', '/together': '一起约', '/projects': '齐行' }
  let visit = 0
  const navigate = async path => {
    const url = origin + path + (path.startsWith('/.vitest-tmp/interaction-fixture-') ? `?visit=${++visit}` : '')
    await send('Page.navigate', { url })
    await until(`location.href === ${JSON.stringify(url)} && document.readyState === "complete"`)
    await sleep(100)
    const route = path.split('#')[1]?.split('?')[0]
    if (route && pageTitles[route]) await until(`document.querySelector('main h1,.page h1')?.textContent.includes(${JSON.stringify(pageTitles[route])})`)
  }
  const click = async selector => {
    const point = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing '+${JSON.stringify(selector)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(hit!==b&&!b.contains(hit))throw Error('Button is covered: '+${JSON.stringify(selector)}+' by '+hit?.outerHTML.slice(0,200));return {x,y}})()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve(true)))')
  }
  const clickText = async (text, scope = 'body') => {
    await evaluate(`(()=>{const scope=document.querySelector(${JSON.stringify(scope)});const b=[...scope.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing visible button: '+${JSON.stringify(text)});document.querySelectorAll('[data-qa-target]').forEach(n=>n.removeAttribute('data-qa-target'));b.dataset.qaTarget='true'})()`)
    await click('[data-qa-target]')
  }
  const fill = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const screenshot = async name => {
    const data = await send('Page.captureScreenshot', { format: 'png' })
    const file = resolve(tempRoot, name + '.png'); await writeFile(file, Buffer.from(data.data, 'base64')); report.screenshots.push(file)
  }
  const fixture = '/.vitest-tmp/' + fixtureName
  for (const width of flowsOnly ? [] : [320, 375, 390, 430, 844, 768, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 844 ? 390 : 844, deviceScaleFactor: 1, mobile: width < 900 })
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900, maxTouchPoints: 1 })
    await navigate(fixture); await until('Boolean(window.audit)')
    const before = await evaluate(`(()=>{const b=document.querySelector('#important'),n=document.querySelector('#neighbor');const a=b.getBoundingClientRect(),c=n.getBoundingClientRect();return {width:a.width,height:a.height,center:a.x+a.width/2,neighbor:c.x}})()`)
    await click('#important'); await click('#important')
    await sleep(500)
    const loading = await evaluate(`(()=>{const b=document.querySelector('#important'),n=document.querySelector('#neighbor');const a=b.getBoundingClientRect(),c=n.getBoundingClientRect(),s=b.querySelector('.action-surface').getBoundingClientRect();return {phase:b.dataset.actionPhase,width:a.width,height:a.height,center:a.x+a.width/2,neighbor:c.x,surfaceWidth:s.width,calls:audit.calls.important,focused:document.activeElement===b,saved:localStorage.getItem('ux-test-record')}})()`)
    assert(loading.calls === 1 && loading.phase === 'loading' && loading.saved === null, `${width}px:真实完成前保持处理中、双击只执行一次`, loading)
    assert(Math.abs(loading.width - before.width) < 1 && Math.abs(loading.neighbor - before.neighbor) < 1 && Math.abs(loading.center - before.center) < 1 && Math.abs(loading.surfaceWidth - loading.height) < 1, `${width}px:正圆且占位、中心、邻居不移动`, { before, loading })
    assert(loading.focused && loading.height >= (width < 900 ? 44 : 42), `${width}px:焦点保持与触摸区域`, loading)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    assert(await evaluate('audit.calls.important===1'), `${width}px:键盘重复激活不会再次提交`)
    const accessibility = await send('Accessibility.getFullAXTree')
    assert(accessibility.nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === '正式保存' && node.properties?.some(property => property.name === 'disabled' && property.value.value === true)), `${width}px:可访问性树保留名称及忙碌禁用语义`)
    await sleep(800)
    assert(await evaluate(`document.querySelector('#important').dataset.actionPhase === 'loading'`), `${width}px:动画计时不会伪造成功`)
    await evaluate('audit.resolveImportant()'); await until(`document.querySelector('#important').dataset.actionPhase === 'success'`)
    if (width === 390) { await sleep(350); await screenshot('interaction-success-mobile') }
    assert(await evaluate(`localStorage.getItem('ux-test-record')==='fictional'`), `${width}px:成功与真实写入一致`)
    await sleep(1350)
    assert(await evaluate(`document.querySelector('#important').dataset.actionPhase==='idle'`), `${width}px:成功后恢复原状`)
    await evaluate(`localStorage.removeItem('ux-test-record')`)
    if (width === 390) {
      await click('#frequent'); await until(`document.querySelector('#frequent').dataset.actionPhase==='success'`)
      assert(await evaluate(`audit.calls.frequent===1`), '快速保存立即成功，不增加 1.2 秒等待')
      await click('#error'); await until(`document.querySelector('.action-feedback-error')?.textContent.includes('测试连接失败')`)
      assert(await evaluate(`document.querySelector('#error').dataset.actionPhase==='error'&&!document.querySelector('#error .action-check')`), '失败显示真实原因，不显示对勾')
      await sleep(350); await screenshot('interaction-error-mobile')
      await evaluate('audit.retryWorks()'); await click('.action-feedback-error button')
      await until(`document.querySelector('#error').dataset.actionPhase==='success'`)
      assert(await evaluate(`audit.calls.error===2`), '明确重试入口只发起一次新请求')
      await click('#form-submit')
      assert(await evaluate('audit.calls.form===0'), '原生表单必填校验保留')
      await evaluate(`document.querySelector('#form-title').value='虚构表单';document.querySelector('#form-title').dispatchEvent(new Event('input',{bubbles:true}))`)
      const formBefore = await evaluate(`document.querySelector('#form-submit').getBoundingClientRect().width`)
      await click('#form-submit'); await click('#form-submit')
      const form = await evaluate(`({calls:audit.calls.form,busy:document.querySelector('#form-submit').getAttribute('aria-busy'),width:document.querySelector('#form-submit').getBoundingClientRect().width,focused:document.activeElement.id==='form-submit',draft:document.querySelector('#form-title').value})`)
      assert(form.calls === 1 && form.busy === 'true' && form.focused && Math.abs(form.width - formBefore) < 1 && form.draft === '虚构表单', '表单提交保留输入、焦点和宽度，禁止重复提交', form)
      await evaluate('audit.resolveForm()')
    }
  }
  if (!flowsOnly) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await navigate(fixture); await until('Boolean(window.audit)'); await click('#important'); await sleep(50)
  assert(await evaluate(`!document.querySelector('#important').classList.contains('action-morph')&&getComputedStyle(document.querySelector('#important')).transform==='none'`), '减少动态效果不收缩、不缩放、不强制等待')
  await evaluate('audit.resolveImportant()'); await until(`document.querySelector('#important').dataset.actionPhase==='success'`)
  await evaluate(`audit.unmount()`); await sleep(50)
  assert(await evaluate(`document.querySelector('#app').children.length===0`), '卸载完成后不回填状态')
  await send('Emulation.setEmulatedMedia', { features: [] })
  }

  // Run the actual application pages as well as the shared state fixture.
  const config = await readFile(resolve(root, 'release.config.js'), 'utf8')
  const release = config.match(/version: '([^']+)'/)?.[1] || ''
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('study_life_seen_release',${JSON.stringify(release)});localStorage.setItem('study_life_seen_releases_v1',JSON.stringify([${JSON.stringify(release)}]));localStorage.setItem('sl_performance_mode','"off"')` })
  for (const width of flowsOnly ? [390] : [320, 390, 430, 844, 768, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width === 844 ? 390 : 844, deviceScaleFactor: 1, mobile: width < 900 })
    for (const route of ['/', '/schedule', '/course', '/tasks', '/exams', '/events', '/lists', '/bills', '/review', '/together', '/projects']) {
      await navigate('/#' + route)
      await until(`document.querySelector('main h1,.page h1')?.textContent.includes(${JSON.stringify(pageTitles[route])})`)
      const layout = await evaluate(`({route:location.hash,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,title:document.querySelector('main h1,.page h1')?.textContent,buttons:document.querySelectorAll('button').length})`)
      report.routes.push(layout)
      assert(!layout.overflow, `${width}px ${route}:页面无横向溢出`, layout)
    }
  }
  // Exercise application business flows using the profile's fictional records.
  for (const width of [390, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 900 })
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900, maxTouchPoints: 1 })
    await navigate('/#/tasks')
    await clickText('＋ 添加待办')
    await until(`Boolean(document.querySelector('#tasks-title'))`)
    await fill('#tasks-title', `虚构交互验收 ${width}`)
    await clickText('保存', '[role="dialog"]')
    const hasTask = `JSON.parse(localStorage.getItem('sl_tasks')||'[]').some(t=>t.title===${JSON.stringify(`虚构交互验收 ${width}`)})`
    await until(hasTask)
    const taskId = await evaluate(`JSON.parse(localStorage.getItem('sl_tasks')).find(t=>t.title===${JSON.stringify(`虚构交互验收 ${width}`)}).id`)
    const deleteSelector = `[data-focus-id="${taskId}"] [aria-label="删除待办"]`
    assert(await evaluate(`!document.querySelector('#tasks-title')`), `${width}px:真实页面保存完成即关闭，不等待动画`)
    await click(deleteSelector)
    await until(`Boolean([...document.querySelectorAll('[role="dialog"]')].find(n=>n.textContent.includes('确定删除待办')))`)
    assert(await evaluate(hasTask), `${width}px:删除确认前保留记录`)
    await clickText('取消', '[role="dialog"]')
    assert(await evaluate(hasTask), `${width}px:取消删除保留记录`)
    await click(deleteSelector)
    await clickText('删除', '[role="dialog"]')
    await until(`!(${hasTask})`)
    await click('.toast-undo')
    await until(hasTask)
    assert(await evaluate(hasTask), `${width}px:删除后的撤销恢复实际记录`)
    // A slow file read must not refill a closed or newly opened import dialog.
    if (!await evaluate(`document.querySelector('.task-tools').open`)) await click('.task-tools summary')
    await clickText('⇧ 导入 CSV')
    await until(`Boolean(document.querySelector('.csv-file-picker input'))`)
    await evaluate(`(()=>{const f=new File(['title\\n虚构旧预览'], 'fictional.csv',{type:'text/csv'});f.arrayBuffer=()=>new Promise(resolve=>{window.qaReadCsvResolve=()=>resolve(new TextEncoder().encode('title\\n虚构旧预览').buffer)});const d=new DataTransfer();d.items.add(f);const input=document.querySelector('.csv-file-picker input');input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await until(`document.querySelector('.csv-import-body')?.getAttribute('aria-busy')==='true'`)
    await clickText('取消', '[role="dialog"]')
    await clickText('⇧ 导入 CSV')
    await until(`Boolean(document.querySelector('.csv-file-picker input'))`)
    await evaluate('qaReadCsvResolve()'); await sleep(100)
    assert(await evaluate(`!document.querySelector('.csv-preview')&&!document.querySelector('.csv-import-body')?.getAttribute('aria-busy')`), `${width}px:关闭后过期文件结果不会回填新会话`)
    await clickText('取消', '[role="dialog"]')
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 844, deviceScaleFactor: 1, mobile: false })
  await navigate('/#/tasks')
  await click('[aria-label="编辑导航"]')
  await until('Boolean(document.querySelector(".navigation-settings"))')
  await click('.navigation-mode-tabs button:first-child')
  await click('[aria-label="移除今天"]')
  await click('.nav-save')
  await until(`document.querySelector('.nav-save')?.dataset.actionPhase==='success'`)
  assert(await evaluate(`document.querySelector('.navigation-footer')?.textContent.includes('已保存')&&!document.querySelector('.mobile-nav [href="#/"]')`), '真实导航保存：持久化成功与显示布局一致')
  assert(await evaluate(`!JSON.parse(localStorage.getItem('sl_navigation_mobile')||'[]').includes('today')`), '导航成功反馈对应实际持久化内容')
  await sleep(350)
  await screenshot('interaction-navigation-desktop')
  if (report.errors.length) throw new Error('Browser exceptions: ' + report.errors.join('\n'))
} catch (error) {
  report.failure = error.message
  try { report.failureContext = await readFailureContext?.() } catch {}
  process.exitCode = 1
} finally {
  ws?.close(); await killProcessTree(child)
  // Only the unique profile created by this run may be recursively removed.
  const target = resolve(profile)
  if (target.startsWith(profileRoot + sep) && target !== profileRoot) await rm(target, { recursive: true, force: true, maxRetries: 3 })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.cases.filter(item => item.passed).length, failed: report.cases.filter(item => !item.passed).length, routes: report.routes.length, exceptions: report.errors.length, failure: report.failure, output, screenshots: report.screenshots }))
}
