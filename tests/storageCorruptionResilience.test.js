// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

/**
 * 存储损坏韧性矩阵（§3.1；第五十二轮开题，第五十三轮补齐）
 *
 * 目标：给 `sl_*` 键逐个塞入损坏值，验证应用不崩、不弹全局错误、不进安全模式、主内容照常渲染。
 *
 * 关键实现细节（避免假绿）：
 * - store 模块在 import 时初始化并缓存默认值
 * - 必须每个用例 vi.resetModules()，播种损坏值后动态 import
 * - 使用真实路由挂载（TodayView、TasksView）
 *
 * 判据（同时满足即通过）：
 * 1. 控制台无 [GlobalError:...] 错误
 * 2. DOM 中无 .global-error-toast、.global-safe-mode-alert
 * 3. #main-content 存在且 textContent.trim() 非空
 *
 * 【第五十三轮：为什么加了第三种变体】原来只有「非 JSON」与「数组键存成字符串」两种变体，
 * 而这两种都被 `normalizeStoredValue` 的**顶层**校验兜住了——于是矩阵全绿，却恰好绕开了
 * 交接文档 §3.1 点名的唯一可疑面：**嵌套形状损坏**（`normalizeStoredValue` 只做顶层合并，
 * 嵌套值是什么就用什么）。实测：`sl_timecfg = {"periods":"oops"}` 会让
 * `normalizeTimes(timeConfig.value)` 在**模块求值期**抛 `cfg.periods.map is not a function`——
 * 那一行在 `useStoredRef` 的读 try/catch **之外**，任何应用级错误边界都接不住，
 * 表现为启动即白屏。**这个用例在修好之前是红的**，它就是这条守卫判别力的证明。
 */

// 全部使用 useStoredRef 的 sl_* 键（41 个）
const SL_KEYS = [
  { key: 'sl_courses', default: [] },
  { key: 'sl_course_templates', default: [] },
  { key: 'sl_timecfg', default: {} },
  { key: 'sl_semester', default: { start: '' } },
  { key: 'sl_schedule_exceptions', default: [] },
  { key: 'sl_schedule_note', default: '' },
  { key: 'sl_ocr_vocabulary', default: { courses: [], teachers: [], rooms: [], campuses: [] } },
  { key: 'sl_course_checkins', default: [] },
  { key: 'sl_tasks', default: [] },
  { key: 'sl_events', default: [] },
  { key: 'sl_quick_record_settings', default: { clipboardHint: true, recentTypes: [] } },
  { key: 'sl_capture_enabled', default: true },
  { key: 'sl_focus_sessions', default: [] },
  { key: 'sl_focus_settings', default: { quickTimes: [15, 25, 45, 60], lastUsedMinutes: 25, recentTemporaries: [], soundEnabled: true, vibrationEnabled: true, systemNotificationEnabled: true } },
  { key: 'sl_exams', default: [] },
  { key: 'sl_countdown_show_past', default: false },
  { key: 'sl_checklists', default: [] },
  { key: 'sl_bills', default: [] },
  { key: 'sl_expenses', default: [] },
  { key: 'sl_ledger_categories', default: 'LEDGER_CATEGORIES' },
  { key: 'sl_ledger_freq', default: { pinned: [], hidden: [], categoryOverrides: [] } },
  { key: 'sl_ledger_fx', default: { base: 'CNY', rates: {}, updatedAt: '' } },
  { key: 'sl_ledger_budget', default: { monthly: null, updatedAt: '' } },
  { key: 'sl_ledger_templates', default: [] },
  { key: 'sl_theme', default: 'blue' },
  { key: 'sl_custom_theme_color', default: '#456fe8' },
  { key: 'sl_auto_wallpaper_color', default: false },
  { key: 'sl_wallpaper_accent', default: '#456fe8' },
  { key: 'sl_appearance', default: {} },
  { key: 'sl_wallpaper_config', default: {} },
  { key: 'sl_performance_mode', default: 'auto' },
  { key: 'sl_festive_config', default: { enabled: true, birthday: '', installDate: '', anniversaries: [] } },
  { key: 'sl_festive_birthday_full', default: '' },
  { key: 'sl_festive_lunar', default: [] },
  { key: 'sl_ui_language', default: 'zh' },
  { key: 'sl_mood_log', default: {} },
  { key: 'sl_high_contrast', default: false },
  { key: 'sl_last_backup_at', default: '' },
  { key: 'sl_retro_year_notice', default: '' },
  { key: 'sl_domain_schema', default: 0 },
]

// 变体一、二：顶层损坏（都被 normalizeStoredValue 的顶层校验兜住）
const TOP_LEVEL_VARIANTS = [
  { name: 'not-json', value: 'not valid json' },
  { name: 'string-instead-of-array', value: '"just a string"' },
]

// 变体三：嵌套形状损坏——类型对、内部形状不对。这正是顶层合并放行的那一类。
// 只列"默认值是对象且内部有数组/对象字段"的键；数组键的嵌套变体由下面统一生成。
const NESTED_VARIANTS = [
  { key: 'sl_timecfg', raw: '{"periods":"oops"}', why: 'periods 应为数组' },
  { key: 'sl_timecfg', raw: '{"seasons":"oops"}', why: 'seasons 应为数组' },
  { key: 'sl_timecfg', raw: '{"campuses":"oops"}', why: 'campuses 应为数组' },
  { key: 'sl_appearance', raw: '{"quotes":"oops"}', why: 'quotes 应为数组' },
  { key: 'sl_appearance', raw: '{"homeModules":"oops"}', why: 'homeModules 应为数组' },
  { key: 'sl_appearance', raw: '{"swipeActions":"oops"}', why: 'swipeActions 应为对象' },
  { key: 'sl_ocr_vocabulary', raw: '{"courses":"oops"}', why: 'courses 应为数组' },
  { key: 'sl_focus_settings', raw: '{"quickTimes":"oops"}', why: 'quickTimes 应为数组' },
  { key: 'sl_quick_record_settings', raw: '{"recentTypes":"oops"}', why: 'recentTypes 应为数组' },
  { key: 'sl_festive_config', raw: '{"anniversaries":"oops"}', why: 'anniversaries 应为数组' },
  { key: 'sl_ledger_fx', raw: '{"rates":"oops"}', why: 'rates 应为对象' },
  { key: 'sl_ledger_budget', raw: '{"monthly":"oops"}', why: 'monthly 应为数字或 null' },
  { key: 'sl_ledger_freq', raw: '{"pinned":"oops"}', why: 'pinned 应为数组' },
  { key: 'sl_wallpaper_config', raw: '{"targets":"oops"}', why: 'targets 应为对象' },
  { key: 'sl_mood_log', raw: '{"2026-01-01":"oops"}', why: 'mood 记录应为对象' },
  { key: 'sl_semester', raw: '{"start":12345}', why: 'start 应为字符串' },
]

// 2 条代表路由（首页 + 待办页，覆盖主要数据域）。模块求值期的崩溃与路由无关，
// 所以这里不必按消费方逐键挑路由。
const REPRESENTATIVE_ROUTES = [
  { path: '/', name: 'home' },
  { path: '/tasks', name: 'tasks' },
]

// 全部 41 个键都跑。实测单用例约 0.04s（整文件 ~8s），所以"缩矩阵"没必要——
// 第五十二轮放弃跑完是因为当时把 45 键 × 4 变体 × 10 路由 混在一起跑成了 10 分钟。
const CORE_KEYS = SL_KEYS

let originalConsoleError
const globalErrors = []

function captureConsoleError() {
  originalConsoleError = console.error
  console.error = (...args) => {
    const msg = args.join(' ')
    if (msg.includes('[GlobalError:')) globalErrors.push(msg)
    originalConsoleError.apply(console, args)
  }
}

function restoreConsoleError() {
  console.error = originalConsoleError
  globalErrors.length = 0
}

function hasGlobalErrorToast(doc) {
  return !!doc.querySelector('.global-error-toast')
}

function hasSafeModeAlert(doc) {
  return !!doc.querySelector('.global-safe-mode-alert')
}

function mainContentRenders(doc) {
  const main = doc.querySelector('#main-content')
  return Boolean(main) && main.textContent.trim().length > 0
}

/**
 * 播种一个损坏值并真实挂载。
 * 模块求值期的抛出（嵌套形状损坏就是这一类）必须被**当成失败上报**，而不是让整个文件崩掉——
 * 实测 `await import('./helpers/mountApp.js')` 会 reject 出 `cfg.periods.map is not a function`。
 */
async function runCorruptionTest(key, raw, route) {
  vi.resetModules()
  localStorage.clear()
  if (raw !== null) localStorage.setItem(key, raw)

  try {
    const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
    const { routes } = await import('../src/router/routes.js')

    const { router, unmount: doUnmount } = await mountApp({ routes, hash: route.path })
    try {
      if (route.path !== '/') {
        await gotoRoute({ router }, route.path)
      }
      await settle()

      const errors = {
        globalError: globalErrors.length > 0,
        globalErrorToast: hasGlobalErrorToast(document),
        safeModeAlert: hasSafeModeAlert(document),
        mainContentEmpty: !mainContentRenders(document),
      }
      const hit = Object.entries(errors).filter(([, value]) => value).map(([name]) => name)
      return { passed: hit.length === 0, errors, hit }
    } finally {
      doUnmount()
    }
  } catch (error) {
    // 启动/模块求值期的异常：比任何 DOM 判据都更严重，直接判失败并把原文带出来。
    return { passed: false, errors: { bootThrow: String((error && error.message) || error) }, hit: ['bootThrow'] }
  } finally {
    document.querySelectorAll('.test-app-host').forEach((node) => node.remove())
  }
}

describe('存储损坏韧性矩阵（§3.1）', () => {
  beforeEach(() => {
    captureConsoleError()
    localStorage.clear()
    // 使用真实计时器，waitForView 依赖 setTimeout
  })

  afterEach(() => {
    restoreConsoleError()
    vi.clearAllTimers()
    document.querySelectorAll('.test-app-host').forEach((node) => node.remove())
  })

  // sl_appearance 特殊保护：foodRetirement 迁移后的 signature 字段保持原样
  // 放在最前面运行，避免前序测试导致 appearance 模块初始化写入默认值（空 signature）污染 localStorage
  it('sl_appearance：foodRetirement 迁移后的 signature 字段保持原样', async () => {
    vi.resetModules()
    localStorage.setItem('sl_appearance', JSON.stringify({ signature: 'keep me' }))

    const { mountApp, settle } = await import('./helpers/mountApp.js')
    const { routes } = await import('../src/router/routes.js')

    const { unmount: doUnmount } = await mountApp({ routes, hash: '/' })
    await settle()

    const appearance = JSON.parse(localStorage.getItem('sl_appearance'))
    // foodRetirement 只保证 signature 字段保留，默认值会填充其它字段
    expect(appearance.signature).toBe('keep me')

    doUnmount()
  }, 60000)

  // 基线：无损坏值时两条代表路由均可渲染
  it('基线：无损坏值时两条代表路由均可渲染', async () => {
    vi.resetModules()

    for (const route of REPRESENTATIVE_ROUTES) {
      const result = await runCorruptionTest('sl_courses', null, route)
      expect(result.hit, `${route.name} 基线不应有任何损坏判据命中`).toEqual([])
    }
  }, 60000)

  for (const { key } of CORE_KEYS) {
    for (const variant of TOP_LEVEL_VARIANTS) {
      for (const route of REPRESENTATIVE_ROUTES) {
        it(`${key} × ${variant.name} × ${route.name}：应用不崩、不报错、内容正常渲染`, async () => {
          const result = await runCorruptionTest(key, variant.value, route)
          expect(result.hit, `${key} ${variant.name} ${route.name}: ${JSON.stringify(result.errors)}`).toEqual([])
        }, 90000)
      }
    }
  }

  for (const { key, raw, why } of NESTED_VARIANTS) {
    for (const route of REPRESENTATIVE_ROUTES) {
      it(`${key} × 嵌套形状损坏(${why}) × ${route.name}：应用不崩、不报错、内容正常渲染`, async () => {
        const result = await runCorruptionTest(key, raw, route)
        expect(result.hit, `${key} 嵌套 ${raw} ${route.name}: ${JSON.stringify(result.errors)}`).toEqual([])
      }, 90000)
    }
  }
})
