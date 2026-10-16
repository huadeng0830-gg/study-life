// scripts/audit/page-sweep.mjs
//
// 【这个脚本回答什么问题】
//   「同一份源码在手机、平板、笔记本和大屏上，每一页是否都真的能正常打开？」
//   它对每个路由 × 每个视口打开一次真实页面，然后记录三类**可复现**的事实：
//     1. 启动与运行错误：未捕获异常、console error、页面加载失败；
//     2. 横向溢出：文档宽度超过视口宽度（手机上会直接导致左右晃动）；
//     3. 无障碍与语义底线：主标题是否存在、可聚焦控件是否有可读名称。
//   顺便把每一页截图落盘，方便人工复核视觉与信息层级。
//
// 【为什么需要它】
//   现有的 first-visit / reload-loop / iphone-boot 只守着「能不能打开」，
//   而且各自只看一个视口。产品级的横向溢出、缺失可读名称、窄屏塌陷，
//   只有在**同一批页面 × 多档视口**上跑一遍才会暴露。
//
// 【怎么用】
//   node scripts/audit/page-sweep.mjs <origin> [--out <dir>] [--routes a,b,c] [--views 390,1280] [--scheme light|dark]
//
// 【退出码】
//   0 = GREEN；1 = RED（有失败项）；2 = 环境问题（找不到 Chrome / 起不来）。
//   stdout 始终是一段稳定 JSON，进度与摘要走 stderr。
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { resolve } from 'node:path'
import { findChromePath, killProcessTree, sleep } from './shared.mjs'

const origin = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Only a local development origin is allowed')

function flagValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const outDir = resolve(flagValue('out', '.tmp/page-sweep'))
const viewports = flagValue('views', '320,375,768,1024,1440')
  .split(',').map(Number).filter((value) => Number.isFinite(value) && value >= 240)
const requestedRoutes = flagValue('routes', '')
const colorScheme = flagValue('scheme', 'light')
const sampleProfile = process.argv.includes('--sample')
const openSettings = process.argv.includes('--settings')
if (!['light', 'dark'].includes(colorScheme)) throw new Error('Scheme must be light or dark')
const routeSource = await readFile(new URL('../../src/router/routes.js', import.meta.url), 'utf8')
const DEFAULT_ROUTES = [...routeSource.matchAll(/\{ path: '([^']+)'/g)]
  .map((match) => match[1].includes(':pathMatch') ? '/__audit-not-found__' : match[1])
const routeTitles = new Map(routeSource.split(/\r?\n/).flatMap((line) => {
  const path = line.match(/\{ path: '([^']+)'/)?.[1]
  const title = line.match(/meta: \{ title: '([^']+)'/)?.[1]
  return path && title ? [[path, title]] : []
}))
const routeTargets = { '/today': '/', '/places': '/campus/places', '/notes': '/', '/campus/moderation': '/admin/campus' }
const routes = requestedRoutes ? requestedRoutes.split(',').map((item) => item.trim()).filter(Boolean) : DEFAULT_ROUTES

const profile = await mkdtemp(resolve(process.env.TEMP || '.', 'page-sweep-'))
await mkdir(outDir, { recursive: true })
const report = {
  origin, colorScheme, profile: sampleProfile ? 'synthetic-populated' : 'anonymous-empty', viewports,
  ...(sampleProfile ? { sampleCounts: { tasks: 64, courses: 8, events: 12, milestones: 13, transactions: 48, bills: 4, checklists: 3, checklistItems: 72, focusSessions: 18 } } : {}),
  pages: [], consoleErrors: [],
}
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
    pending.set(id, { yes, no, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)
      clearTimeout(request.timer); pending.delete(message.id)
      if (message.error) request.no(new Error(message.error.message)); else request.yes(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') {
      report.consoleErrors.push({ kind: 'exception', text: (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text || '').slice(0, 400) })
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      report.consoleErrors.push({ kind: 'console', text: message.params.args.map((arg) => arg.description || arg.value || '').join(' ').slice(0, 400) })
    }
  })

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
  // This audit measures page layout; release-note overlays have separate tests.
  // Seed only this isolated browser so screenshots expose the actual page.
  const auditedVersion = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    `localStorage.setItem('study_life_seen_release',${JSON.stringify(auditedVersion)});localStorage.setItem('study_life_seen_releases_v1',JSON.stringify([${JSON.stringify(auditedVersion)}]));` })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] })
  if (colorScheme === 'dark' || sampleProfile) {
    const packageInfo = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    const seed = sampleProfile ? `(() => {
      const date = (offset) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }
      const now = new Date().toISOString()
      const courseIds = Array.from({ length: 8 }, (_, i) => 'audit-course-' + String(i + 1).padStart(2, '0'))
      const tasks = Array.from({ length: 64 }, (_, i) => ({ id: 'audit-task-' + String(i + 1).padStart(3, '0'), title: '审计样本待办 ' + String(i + 1).padStart(3, '0'), done: false, status: 'pending', courseId: i < 8 ? courseIds[i] : '', course: i < 8 ? '审计样本课程 ' + String(i + 1).padStart(2, '0') : '', dueDate: date(i % 35), dueTime: '', priority: ['high', 'normal', 'low'][i % 3], note: '仅用于本地界面覆盖的合成数据', estimateMinutes: 25 + i % 4 * 15, repeat: 'none', createdAt: now, updatedAt: now }))
      const courses = courseIds.map((id, i) => ({ id, name: '审计样本课程 ' + String(i + 1).padStart(2, '0'), teacher: '示例教师', room: '样本教室 ' + (i + 1), campusId: 'south', color: ['#456fe8', '#10b981', '#f59e0b'][i % 3], day: i % 7, start: 'p' + (i % 4 + 1), end: 'p' + (i % 4 + 2), startWeek: 1, endWeek: 25, weekType: 'all', createdAt: now, updatedAt: now }))
      const events = Array.from({ length: 12 }, (_, i) => ({ id: 'audit-event-' + String(i + 1).padStart(2, '0'), title: '审计样本日程 ' + String(i + 1).padStart(2, '0'), date: date(i + 1), time: '09:00', endTime: '10:00', location: '示例地点', note: '合成浏览器数据', reminderEnabled: true, reminderMinutes: 45, createdAt: now, updatedAt: now }))
      const milestones = Array.from({ length: 12 }, (_, i) => ({ id: 'audit-date-' + String(i + 1).padStart(2, '0'), name: '审计样本日期 ' + String(i + 1).padStart(2, '0'), date: date(i + 2), category: i % 2 ? '生活' : '学习', kind: i % 2 ? 'countdown' : 'exam', repeat: 'none', pinned: i % 4 === 0, courseId: i < 8 ? courseIds[i] : '', reminderMinutes: 1440, createdAt: now, updatedAt: now }))
      milestones.push({ id: 'audit-external-exam', name: '审计样本校外考试', kind: 'externalExam', category: '校外考试', date: date(15), examDate: date(15), registerStart: date(2), registerDeadline: date(8), examTime: '09:00', time: '09:00', venue: '样本考点', location: '样本考点', requiredItems: [{ name: '准考证', quantity: 1, unit: '张', checked: false }], createdAt: now, updatedAt: now })
      const expenses = Array.from({ length: 48 }, (_, i) => ({ id: 'audit-transaction-' + String(i + 1).padStart(3, '0'), name: '审计样本交易 ' + String(i + 1).padStart(3, '0'), amount: 8 + i, cat: 'food', date: date(-i % 20), time: '12:10', account: '样本账户', direction: i % 9 === 0 ? 'income' : 'expense', currency: 'CNY', note: '仅用于本地覆盖测试', createdAt: now, updatedAt: now }))
      const bills = Array.from({ length: 4 }, (_, i) => ({ id: 'audit-bill-' + String(i + 1).padStart(2, '0'), name: '审计样本固定账单 ' + (i + 1), amount: 25 + i * 10, category: 'communication', cycle: 'monthly', nextDate: date(i + 3), remindDays: 3, active: true, autoRenew: true, currency: 'CNY', createdAt: now, updatedAt: now }))
      const checklists = Array.from({ length: 3 }, (_, i) => ({ id: 'audit-list-' + String(i + 1).padStart(2, '0'), name: ['审计样本出行清单', '审计样本采购清单', '审计样本整理清单'][i], type: ['travel', 'shopping', 'chores'][i], createdAt: now, updatedAt: now, items: Array.from({ length: 24 }, (_, j) => ({ id: 'audit-item-' + (i + 1) + '-' + String(j + 1).padStart(2, '0'), name: '样本事项 ' + String(j + 1).padStart(2, '0'), quantity: j % 4 + 1, unit: '件', category: '其他', price: j % 5 ? '' : 12.5, done: j % 7 === 0 })) }))
      const sessions = Array.from({ length: 18 }, (_, i) => ({ id: 'audit-focus-' + String(i + 1).padStart(2, '0'), startedAt: new Date(Date.now() - i * 3600000).toISOString(), durationSeconds: 1500 + i * 60, taskTitle: tasks[i].title, completed: true }))
      const entries = { sl_tasks: tasks, sl_courses: courses, sl_events: events, sl_exams: milestones, sl_expenses: expenses, sl_bills: bills, sl_checklists: checklists, sl_focus_sessions: sessions, sl_ledger_budget: { monthly: 1200, updatedAt: now }, sl_ledger_fx: { base: 'CNY', rates: {}, updatedAt: '' }, sl_theme: ${JSON.stringify(colorScheme === 'dark' ? 'system' : 'blue')}, study_life_seen_release: ${JSON.stringify(packageInfo.version)} }
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
      // StoredRef serializes strings as JSON; do not leave "system" as invalid raw JSON.
      localStorage.setItem('sl_theme', JSON.stringify(entries.sl_theme))
    })()` : `localStorage.setItem('sl_theme', JSON.stringify('system'))`
    await send('Page.addScriptToEvaluateOnNewDocument', { source: seed })
  }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async (expression, label) => {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (await evaluate(expression)) return true
      await sleep(50)
    }
    throw new Error(`UI did not settle (${label})`)
  }

  for (const width of viewports) {
    const height = width < 500 ? 780 : 900
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 })
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900, maxTouchPoints: 1 })
    for (const route of routes) {
      const before = report.consoleErrors.length
      const url = origin + '/#' + route
      const entry = { route, width, ok: false, issues: [] }
      try {
        await send('Page.navigate', { url })
        await until('document.readyState === "complete"', `${route} readyState`)
        // Wait for this route's own title and heading. A previous route's DOM or the
        // startup vault skeleton must never count as the destination page being ready.
        const routeTarget = routeTargets[route] || route
        const routePattern = [...routeTitles.keys()].find(pattern => pattern.includes(':') &&
          new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '/?$').test(routeTarget))
        const expectedTitle = routeTitles.get(routeTarget) || routeTitles.get(routePattern) || '页面不存在'
        const targetHash = `#${routeTarget}`
        const stableRoute = `document.title.includes(${JSON.stringify(expectedTitle)}) && location.hash.startsWith(${JSON.stringify(targetHash)}) && document.querySelector('main')?.getBoundingClientRect().height > 0 && [...document.querySelectorAll('main h1, main h2')].some((heading) => heading.textContent.includes(${JSON.stringify(expectedTitle)})) && !document.querySelector('main .page-leave-active')`
        await until(stableRoute, `${route} page content`)
        await sleep(450)
        // The shell can briefly reveal the previous route before local data bootstraps.
        // Recheck after the settling delay so a startup skeleton cannot become a green screenshot.
        await until(stableRoute, `${route} stable page content`)
        if (openSettings && route === '/') {
          if (width < 900) {
            await evaluate(`document.querySelector('.more-trigger')?.click()`)
            await until(`Boolean(document.querySelector('.mobile-more-sheet'))`, 'mobile more sheet')
          }
          const openedSettings = await evaluate(`(() => {
            const label = '记录与提醒设置'
            const button = [...document.querySelectorAll('button')].find((item) => item.getClientRects().length
              && (item.innerText || '').replace(/\\s+/g, '').includes(label))
            button?.click()
            return Boolean(button)
          })()`)
          if (!openedSettings) throw new Error('设置入口不可见')
          await until(`Boolean([...document.querySelectorAll('.modal[role="dialog"]')].find((dialog) => dialog.getClientRects().length && dialog.innerText.includes('记录与提醒设置')))` , 'global settings modal')
          if (width < 900) await until(`!document.querySelector('.mobile-more-sheet')`, 'mobile more sheet closed')
          await sleep(350)
          entry.settingsDialog = await evaluate(`(() => {
            const dialog = [...document.querySelectorAll('.modal[role="dialog"]')].find((item) => item.getClientRects().length && item.innerText.includes('记录与提醒设置'))
            return {
              title: dialog?.querySelector('.modal-head h2, .modal-head h3, h2, h3')?.textContent.trim() || '',
              groups: [...dialog?.querySelectorAll('.settings-group h3') || []].map((item) => item.textContent.trim()),
              controls: dialog?.querySelectorAll('input, select, textarea').length || 0,
              scrollWidth: dialog?.scrollWidth || 0,
              clientWidth: dialog?.clientWidth || 0,
            }
          })()`)
        }
        const metrics = await evaluate(`(() => {
          const doc = document.documentElement
          const main = document.querySelector('main')
          const headings = [...document.querySelectorAll('main h1, main h2')].map(h => h.textContent.trim()).filter(Boolean)
          const unnamed = [...document.querySelectorAll('button, a[href], input, select, textarea')]
            .filter(el => el.getClientRects().length && el.type !== 'hidden')
            .filter(el => {
              const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()
                || (el.labels && el.labels.length ? [...el.labels].map(l => l.textContent).join(' ').trim() : '')
                || (el.tagName === 'BUTTON' || el.tagName === 'A' ? el.textContent.trim() : '')
                || (el.getAttribute('aria-labelledby') ? 'byid' : '')
              return label === ''
            })
            .map(el => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''))
          // 找出真正撑破视口的元素，而不是只看 scrollWidth（滚动条会污染它）
          const overflowing = []
          for (const el of document.querySelectorAll('body *')) {
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) continue
            if (rect.right > doc.clientWidth + 1.5 || rect.left < -1.5) {
              const style = getComputedStyle(el)
              if (style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue
              let scrollContainer = null
              for (let parent = el.parentElement; parent && parent !== doc.documentElement; parent = parent.parentElement) {
                const parentStyle = getComputedStyle(parent)
                if (parent.scrollWidth > parent.clientWidth + 1.5 && ['auto', 'scroll'].includes(parentStyle.overflowX)) {
                  scrollContainer = {
                    tag: parent.tagName.toLowerCase(),
                    cls: String(parent.className || '').slice(0, 60),
                    scrollWidth: parent.scrollWidth,
                    clientWidth: parent.clientWidth,
                  }
                  break
                }
              }
              overflowing.push({
                tag: el.tagName.toLowerCase(),
                cls: String(el.className || '').slice(0, 60),
                label: String(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim().slice(0, 48),
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                scrollContainer,
              })
            }
            if (overflowing.length >= 5) break
          }
          return {
            scrollWidth: doc.scrollWidth,
            theme: doc.dataset.theme,
            clientWidth: doc.clientWidth,
            mainHeight: main ? Math.round(main.getBoundingClientRect().height) : 0,
            headings: headings.slice(0, 3),
            sampleContentVisible: (document.body.innerText || '').includes('审计样本'),
            unnamed: unnamed.slice(0, 8),
            unnamedCount: unnamed.length,
            overflowing: overflowing.slice(0, 5),
            textLength: (document.body.innerText || '').length,
            hasFatal: Boolean(document.querySelector('.startup-error, .route-fallback.error')),
          }
        })()`)
        entry.metrics = metrics
        if (colorScheme === 'dark' && metrics.theme !== 'dark') entry.issues.push({ kind: 'theme-mismatch', detail: `Expected dark, got ${metrics.theme}` })
        if (metrics.hasFatal) entry.issues.push({ kind: 'fatal', detail: '启动失败页' })
        if (metrics.scrollWidth > metrics.clientWidth + 1) {
          entry.issues.push({ kind: 'horizontal-overflow', detail: `scrollWidth ${metrics.scrollWidth} > ${metrics.clientWidth}`, elements: metrics.overflowing })
        }
        if (!metrics.headings.length) entry.issues.push({ kind: 'no-heading', detail: '主内容区没有 h1/h2' })
        if (metrics.unnamedCount) entry.issues.push({ kind: 'unnamed-control', detail: `${metrics.unnamedCount} 个可聚焦控件缺少可读名称`, elements: metrics.unnamed })
        const fresh = report.consoleErrors.slice(before)
        if (fresh.length) entry.issues.push({ kind: 'runtime-error', detail: fresh.map((item) => item.text).join(' | ').slice(0, 500) })
        const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        const file = resolve(outDir, `${route.replace(/[^\w-]/g, '_') || 'root'}-${width}.png`)
        await writeFile(file, Buffer.from(data.data, 'base64'))
        entry.screenshot = file
        entry.ok = entry.issues.length === 0
      } catch (error) {
        entry.issues.push({ kind: 'harness-error', detail: error.message })
      }
      report.pages.push(entry)
      process.stderr.write(`${entry.ok ? 'GREEN' : 'RED  '} ${route} @${width}px${entry.ok ? '' : ' :: ' + entry.issues.map((i) => i.kind).join(', ')}\n`)
    }
  }
} finally {
  try { ws?.close() } catch {}
  if (child) await killProcessTree(child)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}

report.failed = report.pages.filter((page) => !page.ok)
await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
process.exit(report.failed.length ? 1 : 0)
