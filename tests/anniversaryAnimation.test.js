// @vitest-environment happy-dom
/**
 * 个人周年的专属氛围动画（第五十四轮）。
 *
 * 【要解决的问题】氛围引擎（`composables/festive.js`）给"纪念日 / 使用周年"回的装饰
 * 与情人节、儿童节**完全一样**（都是彩带 `confetti`）——也就是说这些重要的个人节点
 * 在视觉上没有任何区别。这一轮给它们做专属动画。
 *
 * 【分叉为什么不能靠装饰名】一圈看下去，"给周年做一个新装饰值"是最直觉的做法，但它
 * 会同时改掉情人节/儿童节/国庆节（它们共用彩带），而且装饰值住在氛围模块里。所以这里
 * 用**数据里的 key** 额外打一个 `data-festive` 属性来分叉：装饰逻辑一行不动，周年自己
 * 走一条动画（金色星芒向上、带一次性光环）。
 *
 * 【这条测试的两层判据】
 *   ① 行为层：真挂载 → 周年当天渲染出 `data-festive="anniversary"` + 光环 + 金色粒子
 *      + 更短的内联时长；**对照**：纪念日不在今天时，这些一个都不出现。
 *   ② 源码层：CSS 里周年用的是**另一个**动画名（否则"专属"只是换了个颜色），
 *      光环走既有 `--dur-reveal`（不新增动效令牌）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { festiveFor as pureFestiveFor } from '../src/composables/festive.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ANNIVERSARY_COLORS = ['#fbbf24', '#fcd34d', '#fde68a', '#eab308', '#f59e0b', '#f97316']
const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']

const isRealFullDate = (value) => {
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}
const shiftDays = (iso, days) => {
  const next = new Date(`${iso}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

let mounted = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  localStorage.clear()
})

/**
 * 按给定配置挂载真实应用。
 * 关键点：**必须先 `vi.resetModules()` 再动态 import**，否则 store 模块在测试文件
 * import 时就初始化并把默认值缓存住了，播种进 localStorage 的值永远不会被读到
 * （这就是第五十二轮那条"假绿"探针的根因）。
 */
async function bootWithFestive(buildConfig) {
  vi.resetModules()
  const { appToday } = await import('../src/composables/timeContext.js')
  const { festiveFor } = await import('../src/composables/festive.js')
  const today = appToday.value
  const config = buildConfig(today)
  localStorage.setItem('sl_festive_config', JSON.stringify(config))
  // happy-dom 的 hardwareConcurrency 可能 ≤4，会让"自动"模式判定成需要降级，
  // 于是氛围层根本不渲染。那是性能模块的**正确**行为，但会让这条测试变成假红，
  // 所以显式选"完整效果"，把这个变量收掉。
  localStorage.setItem('sl_performance_mode', JSON.stringify('off'))

  const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
  const { routes } = await import('../src/router/routes.js')
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/')
  await settle()
  return { today, festiveFor, config }
}

const layer = () => document.querySelector('.atmo-layer')
const particles = () => [...document.querySelectorAll('.atmo-layer i')]

describe('周年当天：专属动画真的出现', () => {
  it('纪念日（anniversary）渲染专属标记、光环与金色粒子', async () => {
    const { today, festiveFor, config } = await bootWithFestive((iso) => ({
      enabled: true,
      anniversaries: [{ date: iso.slice(5), label: '在一起' }],
    }))

    // 前置自检：夹具本身必须真的命中周年。不写这条的话，一旦日期算错，
    // 后面所有断言都会在没有氛围层的页面上"通过"——那才是最难发现的假绿。
    expect(festiveFor(today, config)?.key, '夹具没命中纪念日，后面的断言无意义').toBe('anniversary')

    expect(layer(), '周年当天应渲染氛围层').toBeTruthy()
    expect(layer().getAttribute('data-festive')).toBe('anniversary')
    expect(document.querySelector('.atmo-halo'), '周年应有一枚一次性光环').toBeTruthy()

    const colors = particles().map((node) => node.style.background)
    expect(colors.length).toBe(18)
    expect(colors.every((color) => ANNIVERSARY_COLORS.includes(color)), `粒子配色应全为周年金色，实际 ${colors.join(',')}`).toBe(true)
    // 判别力：周年配色里必须有**彩带配色里没有的**颜色，否则"专属配色"只是巧合。
    expect(colors.some((color) => !CONFETTI_COLORS.includes(color))).toBe(true)

    const durations = particles().map((node) => node.style.animationDuration)
    expect(durations.every((value) => value === '4.2s'), `周年粒子应走自己的时长，实际 ${durations.join(',')}`).toBe(true)
  })

  it('使用周年（anniversary-start）走同一条专属动画', async () => {
    const { today, festiveFor, config } = await bootWithFestive((iso) => ({
      enabled: true,
      installDate: `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`,
    }))

    expect(festiveFor(today, config)?.key, '夹具没命中使用周年').toBe('anniversary-start')
    expect(layer().getAttribute('data-festive'), '标记里放的是真实 key').toBe('anniversary-start')
    // 这里同时守着那个真缺陷：CSS 用属性**精确匹配**，所以 "使用周年" 必须有
    // 自己的选择器，否则它拿不到专属动画（今日纪念日那条会绿，这条会红）。
    expect(document.querySelector('.atmo-halo'), '使用周年也该有光环').toBeTruthy()
    const durations = particles().map((node) => node.style.animationDuration)
    expect(durations.every((value) => value === '4.2s')).toBe(true)
  })
})

describe('对照：不是周年时不该出现', () => {
  it('纪念日不在今天时没有专属标记、没有光环、也没有金色专属时长', async () => {
    const { festiveFor, config, today } = await bootWithFestive((iso) => ({
      enabled: true,
      anniversaries: [{ date: shiftDays(iso, 3).slice(5), label: '三天后' }],
    }))

    expect(festiveFor(today, config)?.key, '对照夹具不该命中周年').not.toBe('anniversary')
    expect(layer()?.getAttribute('data-festive') ?? 'none').not.toBe('anniversary')
    expect(document.querySelector('.atmo-halo'), '非周年不该有光环').toBeNull()
    expect(particles().every((node) => node.style.animationDuration !== '4.2s')).toBe(true)
  })

  it('节日当天（情人节那类共用彩带的节点）不会被周年逻辑误伤', () => {
    // 02-14 是共用彩带的固定节日。它必须保持彩带配色，而不是金色。
    // 这条是纯函数判据（不挂载、不依赖"今天"）：分叉是按 key 打的，不是按装饰名，
    // 所以共用彩带的节日天然不受影响 —— 这里把这个前提钉住。
    const valentine = pureFestiveFor('2026-02-14', { enabled: true, anniversaries: [] })
    expect(valentine?.key).toBe('valentine')
    expect(valentine?.decor).toBe('confetti')
    // 纪念日优先级高于固定节日：同一天里个人节点应当赢（这是既有语义，别被这一轮改掉）。
    const both = pureFestiveFor('2026-02-14', { enabled: true, anniversaries: [{ date: '02-14', label: '在一起' }] })
    expect(both?.key).toBe('anniversary')
  })
})

describe('源码层：动画确实是分叉的，且没有新增动效令牌', () => {
  const css = readFileSync(resolve(root, 'src/style.css'), 'utf8')
  const appSource = readFileSync(resolve(root, 'src/App.vue'), 'utf8')
  const body = (regex) => (regex.exec(css)?.[1] ?? '').trim()

  /** JS 侧认定的周年 key（从 App.vue 源码里解析，不另抄一份清单）。 */
  const anniversaryKeys = [...(/const ANNIVERSARY_KEYS = \[([^\]]*)\]/.exec(appSource)?.[1] ?? '')
    .matchAll(/'([^']+)'/g)].map((match) => match[1])

  /** 两边清单对账：返回 CSS 里没有专属规则的周年 key。 */
  const missingAnniversaryRules = (cssText, keys) => keys.filter((key) => !cssText.includes(`[data-festive='${key}']`))

  it('JS 认定的每一个周年 key，CSS 都有一条能真正命中的规则', () => {
    // 这条是跨文件契约：属性选择器精确匹配，两边清单一旦不一致，那种周年就会
    // **静默**退回彩带（页面不报错、测试不红、只是"看起来做了"）。
    expect(anniversaryKeys.length, '没能从 App.vue 解析出 ANNIVERSARY_KEYS').toBeGreaterThan(1)
    expect(missingAnniversaryRules(css, anniversaryKeys), '这些周年 key 没有专属动画规则，会静默退回彩带').toEqual([])
  })

  it('判别力自证：清单里少一个 key 时，上面那条判据真的会红', () => {
    // 这条对照用的就是上面同一个判据函数。它在真实文件上必须是空的，
    // 而在这份"只给 anniversary 写了规则"的夹具上必须报出 anniversary-start。
    const onlyFirst = ".atmo-layer[data-festive='anniversary'] i { animation-name: atmo-anniversary; }"
    expect(missingAnniversaryRules(onlyFirst, anniversaryKeys)).toEqual(['anniversary-start'])
    expect(missingAnniversaryRules(css, anniversaryKeys)).toEqual([])
  })

  it('周年用的是另一个动画名，不是复用彩带那条', () => {
    const anniversary = body(/[^{}]*\[data-festive='anniversary'\][^{}]*\{([^}]*)\}/)
    const confetti = body(/\[data-decor='confetti'\] i\s*\{([^}]*)\}/)
    expect(anniversary, 'style.css 里没有周年规则').not.toBe('')
    expect(anniversary).toContain('animation-name: atmo-anniversary')
    expect(anniversary, '周年不该继续用彩带那条动画').not.toContain('atmo-confetti')
    expect(confetti).toContain('animation-name: atmo-confetti')
    expect(css).toContain('@keyframes atmo-anniversary')
  })

  it('光环只播一次，且时长走既有令牌（不新增 --dur-*）', () => {
    const halo = body(/\.atmo-halo\s*\{([^}]*)\}/)
    expect(halo, 'style.css 里没有光环规则').not.toBe('')
    expect(halo).toMatch(/animation:\s*atmo-halo var\(--dur-reveal\) var\(--ease-out\) 1;/)
    expect(css).toContain('@keyframes atmo-halo')
  })

  it('外壳按 key 打标记，而不是改动装饰名', () => {
    expect(appSource).toContain(':data-festive="festiveToday.key"')
    expect(appSource).toContain('ANNIVERSARY_KEYS')
  })
})