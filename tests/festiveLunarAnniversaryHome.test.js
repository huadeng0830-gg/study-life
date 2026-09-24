// @vitest-environment happy-dom
/**
 * 农历纪念日的**端到端**验证：挂载真实应用，首页真的把它当成"今天"的氛围。
 *
 * 【为什么还需要这一条】纯函数测试证明 `festiveFor` 会返回纪念日；面板测试证明用户能配置。
 * 但需求原话是"农历纪念日要和既有纪念日一样出现在'今天'里"。这句话的最后一环在
 * `App.vue`：它按 `festiveToday.key` 决定金色粒子与光环（`ANNIVERSARY_KEYS`），
 * 按 `decor` 决定装饰层。链路断在哪一环，前面的测试都不会红，所以这里直接看页面。
 *
 * 【为什么是"播种存储键"而不是"调发布函数"】生产路径就是这个键：
 * 面板写 `sl_festive_lunar` → 首页的氛围判断读它（经 lunarAnniversaries.js 的内存镜像补水）。
 * 播种键才是走真实路径；调 publish 只是绕过它。
 *
 * 【为什么先 vi.resetModules() 再动态 import】store 模块在静态 import 时就会初始化并缓存
 * 默认值，播种进 localStorage 的值永远读不到 —— 那会变成一条"假绿"（参见
 * tests/anniversaryAnimation.test.js 里同一条注意事项）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

// 固定时钟 + 固定时区，让"今天"确定是 2026-06-19（农历五月初五，端午当天）
const FIXED_INSTANT = '2026-06-19T12:00:00Z'
const FIXED_DATE = '2026-06-19'

let mounted = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  localStorage.clear()
})

/**
 * 按给定农历纪念日列表挂载真实应用（比"今天"就是农历五月初五）。
 * @param {Array|null} lunarList 为 null 时表示"没配置农历纪念日"的对照
 */
async function bootHome(lunarList) {
  localStorage.clear()
  localStorage.setItem('sl_festive_config', JSON.stringify({ enabled: true }))
  // happy-dom 的 hardwareConcurrency 可能 ≤4，会让"自动"模式判定成需要降级，
  // 于是装饰层根本不渲染（性能模块的**正确**行为）。显式选"完整效果"，收掉这个变量。
  localStorage.setItem('sl_performance_mode', JSON.stringify('off'))
  // 时区固定 UTC，时钟固定正午，appToday 才能确定地等于 2026-06-19
  localStorage.setItem('sl_quick_record_settings', JSON.stringify({ timezone: 'UTC' }))
  if (lunarList) localStorage.setItem('sl_festive_lunar', JSON.stringify(lunarList))

  vi.resetModules()
  const { clock } = await import('../src/composables/store/index.js')
  clock.value = new Date(FIXED_INSTANT)
  const { appToday } = await import('../src/composables/timeContext.js')
  const { festiveFor } = await import('../src/composables/festive.js')
  const { festiveConfig } = await import('../src/composables/atmosphereStore.js')
  const { readLunarAnniversaries } = await import('../src/composables/lunarAnniversaries.js')

  const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
  const { routes } = await import('../src/router/routes.js')
  mounted = await mountApp({ routes })
  await gotoRoute(mounted, '/')
  await settle()

  return { today: appToday.value, festiveFor, festiveConfig, readLunarAnniversaries }
}

describe('首页：农历纪念日当天真的出现在氛围里', () => {
  it('命中当天：装饰层打上纪念日标记、有光环、首页显示用户自己的名称与祝福', async () => {
    const { today, festiveFor, festiveConfig, readLunarAnniversaries } = await bootHome([
      { label: '外婆生日', lunarMonth: 5, lunarDay: 5, isLeapMonth: false },
    ])

    // 前置自检：不写这几条，日期/时区一偏，后面所有断言都会在没有氛围层的页面上"通过"
    expect(today, '固定时钟没有生效').toBe(FIXED_DATE)
    expect(readLunarAnniversaries(), '内存镜像没从 sl_festive_lunar 补水').toHaveLength(1)

    const overlay = festiveFor(today, festiveConfig.value)
    expect(overlay?.key, '夹具没命中纪念日，后面的断言无意义').toBe('anniversary')
    expect(overlay?.name).toBe('外婆生日')

    const layer = document.querySelector('.atmo-layer')
    expect(layer, '农历纪念日当天应渲染氛围层').toBeTruthy()
    expect(layer.getAttribute('data-festive')).toBe('anniversary')
    expect(document.querySelector('.atmo-halo'), '应与公历纪念日一样有光环').toBeTruthy()

    // 首页正文里出现用户自己填的名称（不是内置节日的名字）
    expect(document.body.textContent).toContain('外婆生日')
  })

  it('对照：没配置农历纪念日时，首页不会出现这条祝福与纪念日标记', async () => {
    const { today, festiveFor, festiveConfig } = await bootHome(null)

    expect(today).toBe(FIXED_DATE)
    // 2026-06-19 是端午节（内置节日），但**不是**任何个人纪念日
    expect(festiveFor(today, festiveConfig.value)?.key).not.toBe('anniversary')
    expect(document.body.textContent).not.toContain('外婆生日')
    const layer = document.querySelector('.atmo-layer')
    if (layer) expect(layer.getAttribute('data-festive')).not.toBe('anniversary')
    expect(document.querySelector('.atmo-halo')).toBeNull()
  })

  it('闰月纪念日不会在平月那天点亮首页（端到端判别力）', async () => {
    // 2026 年没有闰四月：平四月初一 = 2026-05-17，闰四月初一不存在
    const { today, festiveFor, festiveConfig } = await bootHome([
      { label: '闰四月纪念', lunarMonth: 4, lunarDay: 1, isLeapMonth: true },
    ])

    expect(today).toBe(FIXED_DATE)
    expect(festiveFor(today, festiveConfig.value)?.name).not.toBe('闰四月纪念')
    expect(document.body.textContent).not.toContain('闰四月纪念')
  })
})