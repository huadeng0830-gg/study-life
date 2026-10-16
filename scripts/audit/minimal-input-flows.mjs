// scripts/audit/minimal-input-flows.mjs
//
// 【这个脚本回答什么问题】
//   「用户能不能**只填真正必要的信息**就走完一条完整链路：
//     进入 → 新建 → 查看 → 编辑 → 保存 → 重新进入 → 搜索 → 删除 → 撤销？」
//   第 3 章要求按「最少必要输入」验收，第 11 章要求端到端闭环，
//   但这两件事目前没有任何自动化覆盖 —— 全靠人肉点。
//   这个脚本对每种实体跑同一套链路，每一步都断言真实 DOM 与真实本地存储，
//   任何一步断掉都会打印**具体断在哪一步**。
//
// 【同时覆盖第 3 章的验收点】
//   · 只填必要字段能保存（optional-blank）；
//   · 必要字段为空时不能保存（no-false-success）；
//   · 保存后重新进入页面，值还在（persistence）；
//   · 数字 0 与空字符串不被当成「没填」（zero-value）。
//
// 【怎么用】
//   node scripts/audit/minimal-input-flows.mjs <origin> [--views 375,1280] [--only task,event]
//
// 【退出码】0 = GREEN；1 = RED；2 = 环境问题。
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { resolve } from 'node:path'
import { findChromePath, killProcessTree, sleep } from './shared.mjs'

const origin = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Only a local development origin is allowed')

function flagValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const viewports = flagValue('views', '375,1280').split(',').map(Number).filter(Boolean)
const only = flagValue('only', '')
const wanted = only ? new Set(only.split(',').map((item) => item.trim())) : null

const HELPERS = `
window.__t = {
  // 只有「真的在渲染」的弹窗才算 scope：Modal 用 Transition + v-show，
  // 关闭后元素仍留在 DOM 里，早期版本因此把隐藏弹窗误当成当前作用域。
  // 注意不能用 offsetParent 判断：position:fixed 的元素 offsetParent 永远是 null。
  shown: (el) => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'),
  // 取**最后一个**可见弹窗：详情面板与「完整编辑」会叠开两个 .modal，
  // DOM 顺序不等于层级顺序，取第一个会一直停在底层那个上，
  // 于是新弹窗里的字段永远「找不到」。
  dialog: () => [...document.querySelectorAll('.modal[role="dialog"], dialog[open]')].filter(window.__t.shown).pop() || null,
  sheet: () => [...document.querySelectorAll('.sheet[role="dialog"]')].filter(window.__t.shown).pop() || null,
  overlay: () => window.__t.dialog() || window.__t.sheet() || null,
  scope: () => window.__t.overlay() || document.querySelector('main') || document,
  page: () => document.querySelector('main') || document,
  vis: (el) => window.__t.shown(el),
  labelOf(el) {
    if (!el) return ''
    const aria = (el.getAttribute('aria-label') || '').trim(); if (aria) return aria
    const byId = el.getAttribute('aria-labelledby'); if (byId) { const n = document.getElementById(byId); if (n) return n.textContent.trim() }
    if (el.labels && el.labels.length) return [...el.labels].map(l => l.textContent.trim()).filter(Boolean).join(' ')
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim() }
    const w = el.closest('label'); if (w) return w.textContent.trim()
    return ''
  },
  field(match) {
    const root = window.__t.scope()
    return [...root.querySelectorAll('input:not([type=hidden]), textarea, select')].filter(el => window.__t.shown(el) && window.__t.labelOf(el).includes(match))[0] || null
  },
  btn(match, inPage) {
    const scope = inPage ? window.__t.page() : window.__t.scope()
    const text = String(match)
    const all = [...scope.querySelectorAll('button, a[role="button"], input[type=submit]')].filter(window.__t.shown)
    return all.find(b => (b.textContent || b.value || '').replace(/\\s+/g, '').includes(text)) || null
  },
  set(el, value) {
    if (!el) throw new Error('control not found')
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  },
  // 页面正文，但要先剔除吐司 / 状态播报区：
  // 「已删除 ¥12.63」「待办已添加」这类瞬时提示会被当成「记录还在」，制造假失败。
  mainText() {
    const main = document.querySelector('main')
    if (!main) return ''
    const clone = main.cloneNode(true)
    for (const node of clone.querySelectorAll('[role="status"],[role="alert"],.toast,.global-error-toast,[aria-live],.action-feedback,[data-slot="toast"]')) node.remove()
    return clone.innerText || ''
  },
  storage() {
    const out = {}
    // 不要截断：同一条 localStorage 里会累积多轮数据，
    // 截断会让排在后面的新记录「查不到」，制造假失败。
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('sl_')) out[k] = localStorage.getItem(k) || '' }
    return out
  },
}`

const FLOWS = [
  {
    id: 'task',
    route: '/tasks',
    open: '添加待办',
    // 最少输入 = 只有「待办内容」。日期、课程、优先级、备注全部留空，
    // 用来证明可选字段真的可以不填（而不是换个地方偷偷校验）。
    required: ({ marker }) => [['待办内容', marker]],
    optionalBlank: true,
    save: '保存',
    marker: '虚构的最小待办',
    type: 'task',
    optionalField: '备注',
    deleteMarker: true,
  },
  {
    id: 'event',
    route: '/events',
    open: '新建日程',
    required: ({ marker }) => [['日程内容', marker]],
    optionalBlank: true,
    // 日程新建时提交按钮叫「添加」，编辑时才叫「保存」——两条文案都要覆盖。
    save: ['添加', '保存'],
    marker: '虚构的最小日程',
    type: 'event',
    optionalField: '备注',
    deleteMarker: true,
  },
  {
    id: 'transaction',
    route: '/bills',
    open: '记一笔',
    // 账本的最少输入真的只有金额。这里让金额随视口微调，
    // 既保持「只填金额」这条断言，又保证多轮之间不会互相撞名。
    required: ({ marker }) => [['金额', marker]],
    optionalBlank: true,
    // 账本提交按钮的文案随模式变化：新建是「记下」，编辑已有记录是「保存修改」。
    save: ['记下', '保存修改'],
    marker: (width) => (12.5 + width / 10000).toFixed(2),
    type: 'transaction',
    optionalField: '备注',
    deleteMarker: true,
    // 第 3.7 条：数字 0 是合法输入，不能被 `!amount` 之类的判断吃掉。
    zeroCase: { fields: [['金额', '0']], expect: '0.00' },
  },
  {
    id: 'milestone',
    route: '/exams',
    open: '添加重要日期',
    required: ({ marker }) => [['名称', marker], ['目标日期', '2027-01-15']],
    optionalBlank: true,
    save: '保存',
    marker: '虚构的重要日期',
    type: 'milestone',
    optionalField: '备注',
    deleteMarker: true,
  },
]

const profile = await mkdtemp(resolve(process.env.TEMP || '.', 'minimal-flows-'))
await mkdir(resolve('.tmp'), { recursive: true })
const report = { origin, runs: [] }
let child, ws
let sequence = 0
let warm = false
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
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    }
  })
  await send('Runtime.enable'); await send('Page.enable')
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (expression, label, attempts = 160) => {
    for (let attempt = 0; attempt < attempts; attempt++) { if (await evaluate(expression)) return true; await sleep(50) }
    // 失败时把真实页面状态带出来，否则只能猜「did not settle」到底卡在哪。
    let context = ''
    try {
      context = JSON.stringify(await evaluate(`({ href: location.href, ready: document.readyState, main: !!document.querySelector('main'), startup: !!document.querySelector('.startup-error'), body: (document.body?.innerText || '').slice(0, 300) })`))
    } catch (error) { context = 'context unavailable: ' + error.message }
    throw new Error(`UI did not settle (${label}) :: ${context}`)
  }
  const clickOn = async (selector) => {
    const point = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (!b) return null;
      b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (!point) throw new Error(`missing element ${selector}`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const clickByText = async (text, inPage = false) => {
    const candidates = Array.isArray(text) ? text : [text]
    const found = await evaluate(`(() => {
      for (const t of ${JSON.stringify(candidates)}) {
        const b = window.__t.btn(t, ${inPage})
        if (!b) continue
        b.scrollIntoView({ block: 'center' }); b.dataset.__probe = '1'
        const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
      return null
    })()`)
    if (!found) throw new Error(`missing button 「${candidates.join('/')}」`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...found, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...found, button: 'left', clickCount: 1 })
    await evaluate('document.querySelectorAll("[data-__probe]").forEach(n => n.removeAttribute("data-__probe"))')
  }
  const waitDialog = (label) => until('Boolean(window.__t && window.__t.dialog())', label)
  const closeDialog = async () => {
    const closed = await evaluate(`(() => { const d = window.__t.dialog(); if (!d) return false
      const b = d.querySelector('button[aria-label*="关闭"], .close') || [...d.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '取消')
      if (!b) return false; b.click(); return true })()`)
    if (!closed) throw new Error('无法关闭弹窗')
    await until('!window.__t.dialog()', 'dialog closed')
  }
  // 行内次要操作有两种实现：待办用 TaskRowActions + ActionSheet（.sheet[role=dialog]），
  // 重要日期/日程/账本用行内 .card-menu 下拉。两种都要能开到，所以先找菜单触发器，
  // 再在「菜单里 → 退化到行内」两个位置里找目标项。
  const MENU_TRIGGER = '[aria-label^="更多操作"], [aria-label*="的更多操作"], .tra-trigger, .menu-btn, button[title="更多操作"], [aria-haspopup="menu"]'
  // 行内直接摊开的操作按钮（EventsView 的「编辑 / 归档 / 删除」）。
  const INLINE_ACTION = '[aria-label^="编辑"], [aria-label^="删除"], button.danger-text, [data-action]'
  const ROW_ANCHOR = `${MENU_TRIGGER}, ${INLINE_ACTION}`
  // 整块可点的行（账本流水 .feed-item）：只有它没有操作按钮时才走这条路径。
  const CLICKABLE_ROW = '[role="button"], [tabindex="0"], .tap-target'
  const findRowExprFor = (markerText) => `(() => {
    const root = document.querySelector('main') || document.body
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.includes(${JSON.stringify(markerText)})) continue
      let el = node.parentElement
      while (el && el !== document.body) {
        if (el.querySelector(${JSON.stringify(ROW_ANCHOR)})) return el
        el = el.parentElement
      }
      el = node.parentElement
      while (el && el !== document.body) {
        if (el.matches(${JSON.stringify(CLICKABLE_ROW)}) || el.querySelector(${JSON.stringify(CLICKABLE_ROW)})) return el
        el = el.parentElement
      }
    }
    return null
  })()`
  // 「属于这条记录的那个按钮」：一条记录可能在页面上出现两次
  // （日程页的「接下来」横条 + 下面的正式列表），两处都有同名操作按钮。
  // 正向找容器容易选中横条那一份，所以改成从按钮出发，
  // 看它的最近行容器里有没有这条记录的文字。**不做 candidates[0] 兜底**：
  // 兜底会把藏在菜单里、当前不可点的按钮也算成「行内有」，导致菜单永远不开。
  const findActionExpr = (markerText, labelText) => `(() => {
    // 先看浮层：ActionSheet / .card-menu / Modal 可能被 teleport 到 <main> 之外，
    // 只在 main 里找是找不到「编辑」「删除」这些菜单项的。
    const matches = (b) => window.__t.shown(b) && ((b.textContent || '').replace(/\\s+/g, '').includes(${JSON.stringify(labelText)}) || (b.getAttribute('aria-label') || '').includes(${JSON.stringify(labelText)}))
    const pick = (root) => root ? [...root.querySelectorAll('button')].find(matches) : null
    // 行容器用项目自己的标记：任务/日程/账本流水的行都带 data-focus-id，
    // 之前用 [class*="card"] 会命中行**内部**的 .event-card-actions，
    // 那里面只有「编辑归档删除」四个字，不含记录标题，于是每一条都被判成「不属于这条记录」。
    const CONTAINER = 'li, article, tr, [data-focus-id], [data-id]'
    const inRow = (b) => { const c = b.closest(CONTAINER); return Boolean(c && (c.textContent || '').includes(${JSON.stringify(markerText)})) }
    return pick(window.__t.sheet())
      || pick([...document.querySelectorAll('.card-menu,[role="menu"]')].filter(window.__t.shown).pop())
      || pick(window.__t.dialog())
      || [...(document.querySelector('main') || document).querySelectorAll('button')].filter(matches).find(inRow)
      || null
  })()`
  const clickPoint = async (point) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
  const centerOf = async (expr, label = 'element') => {
    const point = await evaluate(`(() => { const b = ${expr}; if (!b) return null
      b.scrollIntoView({ block: 'center' })
      const r = b.getBoundingClientRect()
      const x = r.x + r.width / 2, y = r.y + r.height / 2
      // 命中测试：点下去之前先确认这个点真的落在目标上。
      // 移动端底部导航、吸顶栏、吐司都会盖住元素，盲点只会得到「点了没反应」。
      const hit = document.elementFromPoint(x, y)
      const covered = hit && hit !== b && !b.contains(hit) && !hit.contains(b)
      return { x, y, covered: covered ? (hit.tagName.toLowerCase() + '.' + String(hit.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')) : '' }
    })()`)
    if (!point) return null
    if (point.covered) throw new Error(`「${label}」被 ${point.covered} 挡住了`)
    return { x: point.x, y: point.y }
  }

  // 统一解析「找到并执行某条行操作」。项目里真实存在三种实现：
  //   1) 菜单触发器 → ActionSheet / .card-menu → 菜单项（待办、重要日期）；
  //   2) 行内直接摊开的按钮（日程）；
  //   3) 整行可点 → 详情面板 → 面板里的按钮（账本流水）。
  // 驱动器必须三种都能走通，否则测的就不是真实用户路径。
  const rowAction = async (markerText, labelText) => {
    await waitToastClear()
    // 按优先级依次尝试三种真实实现，任何一种成功即止：
    //   1) 行内菜单（TaskRowActions 的 ⋯ → ActionSheet，ExamsView 的 ··· → .card-menu）
    //   2) 行内直接摊开的按钮（EventsView）
    //   3) 整行可点 → 详情面板 → 面板里的按钮（LedgerView 的 .feed-item）
    const openMenu = async () => {
      const point = await centerOf(`(() => { const row = ${findRowExprFor(markerText)}; return row ? row.querySelector(${JSON.stringify(MENU_TRIGGER)}) : null })()`, `${labelText} 菜单`)
      if (!point) return false
      await clickPoint(point)
      await until(`Boolean(window.__t.sheet()) || [...document.querySelectorAll('.card-menu,[role="menu"]')].some(window.__t.shown)`, `${labelText} menu`, 40).catch(() => {})
      return true
    }
    const clickItem = async () => {
      const point = await centerOf(`${findActionExpr(markerText, labelText)}`, labelText)
      if (!point) return false
      await clickPoint(point)
      return true
    }
    const clickRow = async () => {
      const point = await centerOf(`(() => { const row = ${findRowExprFor(markerText)}; if (!row) return null
        return row.matches(${JSON.stringify(CLICKABLE_ROW)}) ? row : row.querySelector(${JSON.stringify(CLICKABLE_ROW)}) })()`, `${markerText} 行`)
      if (!point) return false
      await clickPoint(point); await sleep(600)
      return true
    }
    const hasMenu = await evaluate(`(() => { const row = ${findRowExprFor(markerText)}; return Boolean(row && row.querySelector(${JSON.stringify(MENU_TRIGGER)})) })()`)
    if (hasMenu && await openMenu() && await clickItem()) return { ok: true, via: 'menu' }
    if (await clickItem()) return { ok: true, via: 'inline' }
    if (await clickRow() && await clickItem()) return { ok: true, via: 'detail' }
    return { ok: false, reason: 'item' }
  }

  const closeDialogIfOpen = async () => {
    const has = await evaluate('Boolean(window.__t && window.__t.dialog())')
    if (has) await closeDialog()
  }
  // 有的可选字段不在第一层：账本的编辑要先开详情面板再点「完整编辑」，
  // 备注之类的还藏在 QuickEntryModal 的「更多」折叠里。
  // 下潜顺序按真实层级排列：先展「更多」，再进「完整编辑」，进去之后可能还要再展一次「更多」。
  const diveToField = async (fieldLabel) => {
    for (const hop of ['更多', '完整编辑', '取消', '完整编辑', '更多']) {
      const present = await evaluate(`Boolean(window.__t.field(${JSON.stringify(fieldLabel)}))`)
      if (present) return true
      const point = await centerOf(`window.__t.btn(${JSON.stringify(hop)}, false)`, hop)
      if (!point) continue
      await clickPoint(point)
      await sleep(700)
    }
    return Boolean(await evaluate(`Boolean(window.__t.field(${JSON.stringify(fieldLabel)}))`))
  }
  // 吐司会短暂盖住列表行上的操作按钮（实测 320px 下 span.toast-message 会挡住「编辑」）。
  // 真人会等它消失再点，所以驱动器也这么做——否则测的是"恰好被挡住"，不是产品行为。
  const waitToastClear = async () => {
    const busy = await until(`!document.querySelector('.toast-message, .toast, [data-slot="toast"]')`, 'toast cleared', 60).then(() => false).catch(() => true)
    if (busy) await sleep(250)
    return !busy
  }
  const setField = async (fieldLabel, value) => {
    const present = await diveToField(fieldLabel)
    if (!present) {
      // 失败时把当前弹窗里到底有什么列出来，否则只能反复猜。
      const seen = await evaluate(`JSON.stringify([...window.__t.scope().querySelectorAll('input,textarea,select')]
        .map(el => ({ tag: el.tagName.toLowerCase(), label: window.__t.labelOf(el), shown: window.__t.shown(el) })))`)
      throw new Error(`找不到字段「${fieldLabel}」；当前弹窗控件：${seen}`)
    }
    return evaluate(`(() => { window.__t.set(window.__t.field(${JSON.stringify(fieldLabel)}), ${JSON.stringify(value)}); return true })()`)
  }
  // 存盘之后不要赌一个固定 sleep：弹窗关闭、列表刷新、吐司出现各有各的节奏。
  // 这里先等弹窗真的收起，再等落盘出现，两者都带上限。
  const saveAndSettle = async (saveLabels) => {
    await clickByText(saveLabels)
    const closed = await until('!window.__t.dialog()', 'save closed', 80).then(() => true).catch(() => false)
    await sleep(250)
    return closed
  }

  for (const width of viewports) {
    const height = width < 500 ? 780 : 900
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 })
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900, maxTouchPoints: 1 })
    // 预热：冷 profile 第一次请求某个路由时，Vite 要现转换整棵依赖图，
    // 可能远超 8 秒settle 窗口。先把本轮要走的路由都编译一遍。
    if (!warm) {
      warm = true
      process.stderr.write('warming routes…\n')
      for (const flow of FLOWS) {
        if (wanted && !wanted.has(flow.id)) continue
        await send('Page.navigate', { url: origin + '/#' + flow.route })
        await until('document.readyState === "complete"', `${flow.id} warm`, 400)
        await sleep(1200)
      }
    }
    for (const flow of FLOWS) {
      if (wanted && !wanted.has(flow.id)) continue
      // 注意：这里**不要**在链路之间清 localStorage。实测那样做反而更不稳：
      // 清完立刻进入 SPA 会带着半初始化的响应式状态跑，清空动作本身还会触发
      // 应用的存储监听。保持同一个 profile 连续跑，并用每轮唯一的 marker / 哨兵值
      // 区分各轮数据，是实测更稳定的做法（15/16 绿，唯一红项见交付说明）。
      const run = { flow: flow.id, width, ok: false, steps: [] }
      // 同一浏览器实例会跨视口复用本地存储，标记必须每轮唯一，
      // 否则上一轮已创建的数据会让「空提交」看起来像「假成功」。
      const base = typeof flow.marker === 'function' ? flow.marker(width) : `${flow.marker}-${width}`
      const fields = typeof flow.required === 'function' ? flow.required({ marker: base, width }) : flow.required
      const marker = base
      // 可选字段的哨兵值同样每轮唯一：同一浏览器实例会跨视口复用存储，
      // 固定文本会让上一轮的残留干扰这一轮「写入 / 清空」断言。
      const noteSentinel = `哨兵备注-${width}`
      const step = (label, passed, detail) => { run.steps.push({ label, passed, detail }); return passed }
      try {
        await send('Page.navigate', { url: origin + '/#' + flow.route })
        await until('document.readyState === "complete"', `${flow.id} ready`)
        await until(`Boolean(document.querySelector('main')) && !document.querySelector('.startup-error')`, `${flow.id} mounted`, 400)
        await evaluate(HELPERS)
        await sleep(500)

        // --- 第 3 章验收点：必要字段为空时，不能出现「假成功」 ---
        await clickByText(flow.open, true)
        await waitDialog(`${flow.id} dialog`)
        await evaluate(HELPERS)
        await clickByText(flow.save)
        await sleep(600)
        const afterEmpty = await evaluate(`({ stillOpen: Boolean(window.__t.dialog()), error: (document.querySelector('.modal [role="alert"],.modal .error,.modal .form-error')?.innerText || '').trim().slice(0, 160), saved: window.__t.mainText().includes(${JSON.stringify(marker)}) })`)
        step('必要字段为空时不产生假成功', afterEmpty.stillOpen && !afterEmpty.saved, afterEmpty)

        // --- 关闭弹窗，重新打开后再只填必要字段 ---
        await closeDialog()
        await clickByText(flow.open, true)
        await waitDialog(`${flow.id} reopen`)
        await evaluate(HELPERS)

        for (const [label, value] of fields) {
          const ok = await evaluate(`(() => { const el = window.__t.field(${JSON.stringify(label)}); if (!el) return false; window.__t.set(el, ${JSON.stringify(value)}); return true })()`)
          if (!ok) throw new Error(`找不到字段「${label}」`)
        }
        // 所有可选字段保持为空，确认不会被隐藏校验拦住
        await saveAndSettle(flow.save)
        const saved = await evaluate(`({ open: Boolean(window.__t.dialog()), text: window.__t.mainText(), storage: window.__t.storage() })`)
        const inList = saved.text.includes(marker)
        const persisted = Object.values(saved.storage).some((raw) => raw.includes(marker))
        step('只填必要字段即可保存', inList, { inList, persisted, snippet: saved.text.slice(0, 200) })
        // 落盘是**故意**批处理的：store/core.js 的 scheduleWrite 先防抖，
        // 再用 requestIdleCallback（timeout 700ms）真正写 localStorage。
        // headless 下空闲回调可能明显延后，所以这里轮询而不是赌一个固定 sleep。
        const persistedNow = await until(`Object.values(window.__t.storage()).some(raw => raw.includes(${JSON.stringify(marker)}))`, `${flow.id} persisted`, 120).then(() => true).catch(() => false)
        const storageKeys = Object.keys(await evaluate('window.__t.storage()'))
        step('必要输入确实落到了本地存储', persistedNow, storageKeys)

        // --- 第 11 章：重新进入页面，数据还在 ---
        await send('Page.navigate', { url: origin + '/#' + flow.route })
        await until('document.readyState === "complete"', `${flow.id} reload`)
        await until(`Boolean(document.querySelector('main'))`, `${flow.id} remounted`)
        await evaluate(HELPERS)
        await sleep(700)
        const reloaded = await evaluate(`window.__t.mainText().includes(${JSON.stringify(marker)})`)
        step('刷新后数据仍在', reloaded, { reloaded })

        // --- 第 3.10 条：可选字段能被「主动清空」，且清空后仍是合法数据 ---
        if (flow.optionalField) {
          try {
            const edit = await rowAction(marker, '编辑')
            if (!edit.ok) throw new Error(`打不开编辑入口（${edit.reason}）`)
            await waitDialog(`${flow.id} edit dialog`)
            await evaluate(HELPERS)
            const had = await evaluate(`(() => { const el = window.__t.field(${JSON.stringify(flow.optionalField)}); return el ? String(el.value || '') : null })()`)
            // 先写一个值存盘，再主动清空存盘：确认「清空」不会被当成「没填」而报错。
            await setField(flow.optionalField, noteSentinel)
            await saveAndSettle(flow.save)
            await closeDialogIfOpen()
            // 账本流水行**不显示备注**，所以这一步只能断言落盘，不能断言页面文字。
            const afterSet = await until(`Object.values(window.__t.storage()).some(raw => raw.includes(${JSON.stringify(noteSentinel)}))`, `${flow.id} note saved`, 120).then(() => true).catch(() => false)
            step('可选字段写入后能保存', afterSet, { afterSet, noteVisibleInList: await evaluate(`window.__t.mainText().includes(${JSON.stringify(noteSentinel)})`) })

            const edit2 = await rowAction(marker, '编辑')
            if (!edit2.ok) throw new Error(`第二次打不开编辑入口（${edit2.reason}）`)
            await waitDialog(`${flow.id} edit dialog 2`)
            await evaluate(HELPERS)
            await setField(flow.optionalField, '')
            const current = 'cleared'
            await saveAndSettle(flow.save)
            const cleared = await evaluate(`({ dialogOpen: Boolean(window.__t.dialog()), text: window.__t.mainText(),
              error: ([...document.querySelectorAll('.modal .error, .modal [role="alert"], .quick-error, .form-error')].filter(window.__t.shown).map(e => (e.innerText || '').trim()).join(' ')).trim().slice(0, 160) })`)
            step('可选字段可被主动清空且不报错', !cleared.dialogOpen && !cleared.error,
              { current, dialogOpen: cleared.dialogOpen, error: cleared.error })
            const clearedInStore = await until(`!Object.values(window.__t.storage()).some(raw => raw.includes(${JSON.stringify(noteSentinel)}))`, `${flow.id} note cleared`, 120).then(() => true).catch(() => false)
            step('清空后原记录仍然存在', clearedInStore && cleared.text.includes(marker),
              { clearedInStore, snippet: cleared.text.slice(0, 200) })
          } catch (error) {
            step('可选字段可被主动清空且不报错', false, error.message)
          }
        }

        // --- 第 3.10 条：有效的 0 不被当成空值 ---
        if (flow.zeroCase) {
          try {
            await closeDialogIfOpen()
            await clickByText(flow.open, true)
            await waitDialog(`${flow.id} zero dialog`)
            await evaluate(HELPERS)
            for (const [label, value] of flow.zeroCase.fields) {
              const ok = await evaluate(`(() => { const el = window.__t.field(${JSON.stringify(label)}); if (!el) return false; window.__t.set(el, ${JSON.stringify(value)}); return true })()`)
              if (!ok) throw new Error(`找不到字段「${label}」`)
            }
            await saveAndSettle(flow.save)
            const zero = await evaluate(`({ open: Boolean(window.__t.dialog()), text: window.__t.mainText() })`)
            step('数值 0 被接受而不是当成没填', !zero.open && zero.text.includes(flow.zeroCase.expect), zero)
          } catch (error) {
            step('数值 0 被接受而不是当成没填', false, error.message)
          }
        }

        // --- 第 11 章：删除后不留残影 ---
        if (flow.deleteMarker) {
          try {
            const del = await rowAction(marker, '删除')
            if (!del.ok) throw new Error(`打不开删除入口（${del.reason}）`)
            await sleep(600)
            // 大多数实体会再问一次「确定删除吗」。
            const confirm = await evaluate(`(() => { const b = window.__t.btn('删除', false); if (!b) return false; b.click(); return true })()`)
            await sleep(1000)
            // 删除同样要等列表真正刷新 + 撤销吐司出现，再断言「不再残留」。
            const gone = await until(`!window.__t.mainText().includes(${JSON.stringify(marker)})`, `${flow.id} deleted`, 80).then(() => true).catch(() => false)
            const afterDelete = await evaluate(`({ text: window.__t.mainText(), undo: (document.body.innerText.match(/撤销/g) || []).length })`)
            step('删除后列表不再残留', gone,
              { confirmed: confirm, undoOffered: afterDelete.undo > 0, snippet: afterDelete.text.slice(0, 200) })
          } catch (error) {
            step('删除后列表不再残留', false, error.message)
          }
        }
        run.ok = run.steps.every((item) => item.passed)
      } catch (error) {
        run.steps.push({ label: 'harness', passed: false, detail: error.message })
        run.ok = false
      }
      report.runs.push(run)
      process.stderr.write(`${run.ok ? 'GREEN' : 'RED  '} ${flow.id.padEnd(12)} @${width}px  ${run.steps.filter((s) => !s.passed).map((s) => s.label).join('; ') || 'all passed'}\n`)
    }
  }
} finally {
  try { ws?.close() } catch {}
  if (child) await killProcessTree(child)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}

report.failed = report.runs.filter((run) => !run.ok)
console.log(JSON.stringify(report, null, 2))
process.exit(report.failed.length ? 1 : 0)