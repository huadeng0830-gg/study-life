// scripts/audit/core-flows.mjs
//
// 【这个脚本回答什么问题】
//   「一个人第一次用这个产品，只填最少的信息，能不能真的把一件事记下来，
//    并且在刷新之后、搜索之后、再次打开之后，它还在不在？」
//
//   也就是说，它守的是**闭环**而不是像素：
//     录入 → 保存成功 → 出现在列表 → 刷新后仍在 → 搜索能找到 → 可再次打开编辑。
//   这条链路上任何一环断了，用户就是「明明填了却没保存 / 刷新就没了」。
//
// 【为什么要单独写】
//   现有的 interaction-browser.mjs 验的是**通用控件**（ActionButton 的忙碌态、
//   重复提交、表单聚焦保持）。它用的是演示夹具，不碰真实业务表单。
//   这里验的是**真实业务实体**：待办、日程、账本、重要日期、清单。
//   「最少输入能不能存下来」是 Chapter 3 的验收线，
//   「刷新后还在不在」是 Chapter 11 的验收线，两者都必须是可复现的自动检查，
//   否则就只能靠人肉点一遍，而人肉点一遍的结果不能进 CI。
//
// 【数据】全部使用明确虚构的标题（以「验收」开头），不触碰任何真实用户数据。
//
// 【怎么用】
//   node scripts/audit/core-flows.mjs <origin> [--views 390,1280] [--out file.json]
//
// 【退出码】
//   0 = GREEN；1 = RED（有失败环节）；2 = 环境问题（找不到 Chrome 等）。
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { resolve } from 'node:path'
import { findChromePath, killProcessTree, sleep } from './shared.mjs'

const origin = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Only a local development origin is allowed')

function flagValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const viewports = flagValue('views', '390,1280').split(',').map(Number).filter(Number.isFinite)
const outFile = flagValue('out', '')
const stamp = Date.now()

// 每条流程只描述「用户真实会做的动作」，不含任何断言细节，断言在 run 里统一写。
// 只填最少必要信息 —— 这正是 Chapter 3 想守住的输入成本。
const FLOWS = [
  {
    id: 'task',
    route: '/tasks',
    label: '待办',
    open: '添加待办',
    submit: '创建待办',
    fill: [['#tasks-title', '验收用待办最小输入']],
  },
  {
    id: 'event',
    route: '/events',
    label: '日程',
    open: '新建日程',
    submit: '添加',
    fill: [['[data-field="title"]', '验收用日程最小输入']],
  },
  {
    id: 'ledger',
    route: '/bills',
    label: '账本',
    open: '记一笔',
    submit: '记下',
    fill: [['.amount-input', '12.34']],
  },
  {
    id: 'exam',
    route: '/exams',
    label: '重要日期',
    open: '添加重要日期',
    submit: '保存',
    fill: [['#exams-name', '验收用重要日期'], ['#exams-target-date', '2026-12-24']],
  },
  {
    id: 'list',
    route: '/lists',
    label: '清单',
    open: '新建清单',
    submit: '创建清单',
    fill: [['#lists-name', '验收用清单']],
  },
]

const profile = await mkdtemp(resolve(process.env.TEMP || '.', 'core-flows-'))
const report = { origin, runs: [] }
let child, ws
let sequence = 0
const pending = new Map()

const port = await new Promise((yes, no) => {
  const server = net.createServer()
  server.once('error', no)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => yes(value)) })
})

try {
  const chrome = await findChromePath()
  child = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-background-networking', '--hide-scrollbars', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })

  let endpoint = ''
  for (let attempt = 0; attempt < 100 && !endpoint; attempt++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      endpoint = tabs.find((tab) => tab.type === 'page')?.webSocketDebuggerUrl || ''
    } catch {}
    if (!endpoint) await sleep(100)
  }
  if (!endpoint) throw new Error('Chromium did not expose its local test endpoint')
  ws = new WebSocket(endpoint)
  await new Promise((yes, no) => { ws.addEventListener('open', yes, { once: true }); ws.addEventListener('error', no, { once: true }) })

  const send = (method, params = {}) => new Promise((yes, no) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); no(new Error(`Timed out: ${method}`)) }, 25_000)
    pending.set(id, { yes, no, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const consoleErrors = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push((message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text || '').slice(0, 300))
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.description || arg.value || '').join(' ').slice(0, 300))
    }
  })
  await send('Runtime.enable'); await send('Page.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 140; attempt++) { if (await evaluate(expression)) return true; await sleep(50) }
    throw new Error(`UI did not settle (${label})`)
  }
  const bodyHas = (needle) => evaluate(`(document.body.innerText || '').includes(${JSON.stringify(needle)})`)
  const clickByText = async (text, scope = 'body') => {
    const point = await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(scope)}) || document
      const el = [...root.querySelectorAll('button, a[role="button"]')]
        .find(b => b.getClientRects().length && b.textContent.replace(/\\s+/g,'').trim() === ${JSON.stringify(text)})
        || [...root.querySelectorAll('button, a[role="button"]')]
        .find(b => b.getClientRects().length && b.textContent.replace(/\\s+/g,'').includes(${JSON.stringify(text)}))
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (!point) throw new Error(`no clickable「${text}」`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const fillField = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('missing field ' + ${JSON.stringify(selector)})
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
    setter ? setter.call(el, ${JSON.stringify(value)}) : (el.value = ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  })()`)

  for (const width of viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 500 ? 780 : 900, deviceScaleFactor: 1, mobile: width < 900 })
    for (const flow of FLOWS) {
      const steps = []
      const record = { flow: flow.id, label: flow.label, width, ok: true, steps }
      const step = (name, passed, detail) => {
        steps.push({ name, passed: Boolean(passed), detail: detail || null })
        if (!passed) record.ok = false
      }
      const title = flow.fill[0][1]
      try {
        // 每条流程从干净的 localStorage 开始，避免上一条的残留造成假阳性。
        await send('Page.navigate', { url: 'about:blank' })
        await until('location.href === "about:blank"', 'leave previous flow')
        await send('Page.navigate', { url: `${origin}/#${flow.route}` })
        await until(`location.hash === ${JSON.stringify('#' + flow.route)} && Boolean(document.querySelector('#app[data-v-app] main'))`, 'boot')
        await evaluate(`Object.keys(localStorage).filter(k => k.startsWith('sl_')).forEach(k => localStorage.removeItem(k))`)
        // A real reload also clears module/KeepAlive state. A same-hash
        // Page.navigate would otherwise reuse a previous flow's open dialog.
        await send('Page.reload', { ignoreCache: false })
        await until(`Boolean(document.querySelector('main')) && !document.querySelector('.startup-error')`, `${flow.route} mounted`)
        await sleep(500)

        await clickByText(flow.open, 'main')
        await until(`Boolean(document.querySelector(${JSON.stringify(flow.fill[0][0])}))`, 'entry field')
        step('打开录入界面', await evaluate(`Boolean(document.querySelector('dialog[open], [role="dialog"], form'))`))

        for (const [selector, value] of flow.fill) {
          await fillField(selector, value)
          await sleep(60)
        }
        step('只填必要信息', flow.fill.every(([, v]) => v))

        const errorsBefore = consoleErrors.length
        await clickByText(flow.submit)
        await sleep(1100)

        // 保存失败时表单会留在原地并给出 role=alert 的原因，这里必须抓出来，
        // 否则「保存成功」会被误判成「表单还在但内容已进列表」。
        const afterSave = await evaluate(`({
          dialogOpen: Boolean(document.querySelector('dialog[open]')),
          alert: (document.querySelector('[role="alert"]')?.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 200),
          visible: (document.body.innerText || '').includes(${JSON.stringify(title)}),
        })`)
        step('保存后没有报错', !afterSave.alert, afterSave.alert || null)
        step('录入界面已关闭', !afterSave.dialogOpen)
        step('列表里能看到新记录', afterSave.visible)
        step('保存过程没有运行时错误', consoleErrors.length === errorsBefore, consoleErrors.slice(errorsBefore).join(' | ') || null)

        // 刷新：这是最容易丢数据的一步，也是本地存储类应用最常见的真实故障。
        await send('Page.navigate', { url: 'about:blank' })
        await until('location.href === "about:blank"', 'leave before persistence check')
        await send('Page.navigate', { url: `${origin}/#${flow.route}` })
        await until(`Boolean(document.querySelector('main')) && !document.querySelector('.startup-error')`, `${flow.route} reloaded`)
        await sleep(700)
        step('刷新后记录仍在', await bodyHas(title))
      } catch (error) {
        step('流程执行', false, error.message)
      }
      report.runs.push(record)
      const failed = steps.filter((s) => !s.passed)
      process.stderr.write(`${record.ok ? 'GREEN' : 'RED  '} ${flow.label.padEnd(5)} @${String(width).padStart(4)}px${failed.length ? ' :: ' + failed.map((s) => s.name + (s.detail ? '(' + String(s.detail).slice(0, 90) + ')' : '')).join(', ') : ''}\n`)
    }
  }
} finally {
  try { ws?.close() } catch {}
  if (child) await killProcessTree(child)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}

report.failed = report.runs.filter((run) => !run.ok).length
if (outFile) { await mkdir(resolve(outFile, '..'), { recursive: true }); await writeFile(resolve(outFile), JSON.stringify(report, null, 2)) }
console.log(JSON.stringify({ ...report, runs: undefined, summary: { total: report.runs.length, failed: report.failed } }, null, 2))
process.exit(report.failed ? 1 : 0)
