// scripts/audit/form-inventory.mjs
//
// 【这个脚本回答什么问题】
//   「这个产品到底让用户填了多少东西？每一项是真的必要，还是历史包袱？」
//   它打开真实页面、点开真实的录入弹窗，把**每一个可见表单控件**连同
//   标签、类型、是否必填、占位符和当前默认值原样导出成 JSON。
//
// 【为什么需要它】
//   Chapter 3 的必填治理要求「逐字段重新分类」，但人读代码会漏、会漂。
//   这里把「用户真实看到的那张表单」变成可 diff 的数据：
//     · required / aria-required 只是原生和语义标记，业务必填仍须追踪保存逻辑；
//     · 有默认值 vs 空值的控件 = 系统已经替用户决定了多少；
//     · 同一字段在不同弹窗里的 required 是否一致 = 规则冲突的证据。
//   改完表单再跑一次，diff 就是「减负了多少」的可复现证据。
//
// 【怎么用】
//   node scripts/audit/form-inventory.mjs <origin> [--routes /tasks,/bills] [--click 添加待办] [--out file.json]
//
// 【退出码】0 = 采集成功；1 = 页面或入口采集失败。启动环境异常以非零退出。
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { resolve } from 'node:path'
import { findChromePath, killProcessTree, sleep } from './shared.mjs'
import { APP_VERSION } from '../../release.config.js'

const origin = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Only a local development origin is allowed')

function flagValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const routes = flagValue('routes', '/tasks,/events,/exams,/lists,/bills,/course').split(',').map((item) => item.trim()).filter(Boolean)
const clickText = flagValue('click', '')
const outFile = flagValue('out', '')
const width = Number(flagValue('width', '1280'))
// `--buttons` 只做一件事：把每页真实的按钮文案打出来，方便给 `--click` 选对触发词。
const listButtonsOnly = process.argv.includes('--buttons')

const profile = await mkdtemp(resolve(process.env.TEMP || '.', 'form-inventory-'))
const report = { origin, width, forms: [] }
let child, ws
let sequence = 0
const pending = new Map()

const port = await new Promise((yes, no) => {
  const server = net.createServer()
  server.once('error', no)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => yes(value)) })
})

const DUMP = `(() => {
  const visible = (el) => Boolean(el.getClientRects().length) && (!el.checkVisibility || el.checkVisibility())
  const scope = [...document.querySelectorAll('dialog[open], [role="dialog"], .modal, [data-sheet]')].filter(visible).at(-1) || document
  const labelOf = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim()
    if (aria) return aria
    const byId = el.getAttribute('aria-labelledby')
    if (byId) { const n = document.getElementById(byId); if (n) return n.textContent.trim() }
    if (el.labels && el.labels.length) return [...el.labels].map(l => l.textContent.trim()).filter(Boolean).join(' ')
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim() }
    const wrapper = el.closest('label')
    if (wrapper) return wrapper.textContent.trim()
    return ''
  }
  const controls = [...scope.querySelectorAll('input, select, textarea')]
    .filter(visible)
    .map(el => ({
      id: el.id || null,
      type: el.tagName.toLowerCase() === 'select' ? 'select' : (el.getAttribute('type') || el.tagName.toLowerCase()),
      label: labelOf(el).replace(/\\s+/g, ' ').trim().slice(0, 60),
      required: el.required === true,
      ariaRequired: (el.getAttribute('aria-required') === 'true'),
      hasAsterisk: labelOf(el).includes('*'),
      placeholder: (el.getAttribute('placeholder') || '').slice(0, 40),
      value: el.type === 'password' ? '' : String(el.value ?? '').slice(0, 40),
      checked: ['checkbox', 'radio'].includes(el.type) ? el.checked : undefined,
      empty: ['checkbox', 'radio'].includes(el.type) ? !el.checked : !String(el.value ?? '').trim(),
      disabled: el.disabled === true,
      options: el.tagName.toLowerCase() === 'select' ? [...el.options].map(o => o.value || '(空)').slice(0, 12) : undefined,
      inDetails: Boolean(el.closest('details')),
      detailsOpen: el.closest('details') ? el.closest('details').open : undefined,
      fieldId: el.getAttribute('data-field') || el.name || null,
    }))
  const dialogTitle = (scope === document ? '' : (scope.querySelector('h1,h2,h3,[data-dialog-title]')?.textContent || '').trim())
  return { dialogTitle, controls }
})()`

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
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    }
  })
  await send('Runtime.enable'); await send('Page.enable')
  // This disposable profile models a returning user so update notes cannot cover the form.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('study_life_seen_release', ${JSON.stringify(APP_VERSION)})` })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 160; attempt++) { if (await evaluate(expression)) return; await sleep(50) }
    throw new Error(`UI did not settle (${label})`)
  }

  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 900 })

  for (const route of routes) {
    try {
      await send('Page.navigate', { url: origin + '/#' + route })
      await until('document.readyState === "complete"', `${route} ready`)
      await until(`Boolean(document.querySelector('main .route-view > :not(.route-fallback), main .route-not-found, .startup-error, .route-fallback.error')) && !document.querySelector('main .page-leave-active')`, `${route} mounted`)
      if (await evaluate(`Boolean(document.querySelector('.startup-error, .route-fallback.error'))`)) throw new Error('页面加载失败')
      await sleep(500)
      if (listButtonsOnly) {
        const buttons = await evaluate(`JSON.stringify([...document.querySelectorAll('main button, main a[role="button"]')]
          .filter(b => b.getClientRects().length)
          .map(b => b.textContent.replace(/\\s+/g, ' ').trim())
          .filter(Boolean).slice(0, 30))`)
        report.forms.push({ route, buttons: JSON.parse(buttons) })
        process.stderr.write(`${route.padEnd(10)} :: ${JSON.parse(buttons).join(' | ')}\n`)
        continue
      }
      const before = await evaluate(DUMP)
      if (clickText) {
        const opened = await evaluate(`(() => {
          const b = [...document.querySelectorAll('main button, main a[role="button"]')]
            .find(b => b.getClientRects().length && b.textContent.replace(/\\s+/g,'').includes(${JSON.stringify(clickText)}))
          if (!b) return false
          b.scrollIntoView({ block: 'center' })
          const r = b.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })()`)
        if (opened && opened.x !== undefined) {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...opened, button: 'left', clickCount: 1 })
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...opened, button: 'left', clickCount: 1 })
          await sleep(700)
          await until(`Boolean([...document.querySelectorAll('dialog[open], [role="dialog"]')].find(el => el.getClientRects().length))`, `${route} dialog opened`)
        } else {
          report.forms.push({ route, clickText, error: `未找到可点击的「${clickText}」` })
          continue
        }
      }
      const after = await evaluate(DUMP)
      report.forms.push({ route, clickText: clickText || null, ...after, pageControls: before.controls.length, pageRequired: before.controls.filter((c) => c.required).length })
      const required = after.controls.filter((c) => c.required)
      process.stderr.write(`${route.padEnd(10)} 控件 ${String(after.controls.length).padStart(3)} · 必填 ${String(required.length).padStart(2)} · 预填 ${String(after.controls.filter((c) => !c.empty).length).padStart(2)} :: ${required.map((c) => c.label || c.id).join('、')}\n`)
    } catch (error) {
      report.forms.push({ route, error: error.message })
      process.stderr.write(`${route.padEnd(10)} 失败：${error.message}\n`)
    }
  }
} finally {
  try { ws?.close() } catch {}
  if (child) await killProcessTree(child)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}

if (outFile) {
  await mkdir(resolve(outFile, '..'), { recursive: true })
  await writeFile(resolve(outFile), JSON.stringify(report, null, 2))
}
console.log(JSON.stringify(report, null, 2))
process.exit(report.forms.some((form) => form.error) ? 1 : 0)
