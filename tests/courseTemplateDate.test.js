// @vitest-environment happy-dom
/**
 * 课表模板的「保存日期」必须按**应用时区策略**换算（第二十二轮）。
 *
 * 起因：`CourseManagerModal.templateDate` 原本是
 * `new Date(value).toLocaleDateString('zh-CN')`——它按**设备**时区渲染，
 * 而全应用其它日期（`appToday` / `formatAppDate` / `policyDateKey`）都按用户在设置里
 * 选的时区算。用户把时区配成非设备时区时，这个**纯日期**标签会与全应用差一天，
 * 出现"模板保存于明天"这种自相矛盾的显示。
 * 仓库为此专门写了 `createdDateKey`（`settingsPolicy.js:118`），注释里
 * （L113-116）描述的就是这个坑，只是这里漏用了。
 * 旧写法还有第二个毛病：`createdAt` 非法时会渲染出 "Invalid Date"。
 *
 * 【为什么要两个时区都断言】可选策略只有三个
 * （`local` / `Asia/Shanghai` / `UTC`，见 TIMEZONE_OPTIONS），`local` 与设备相同、
 * 没有区分力，所以对另外两个各断言一次。这样两类变异都跑不掉：
 *   - 只有"策略 ≠ 设备"的那次能抓住"按设备时区渲染"的变异；
 *   - "Asia/Shanghai ≠ UTC"这条保证能抓住"偷懒取 UTC 日期"的变异。
 * 只断言其中一个是不够的：本机设备时区是 UTC+8，若只断言 `UTC` 那次，
 * 把实现改成 `new Date(v).toISOString().slice(0,10)` 恰好给出同样结果，测不出来。
 */
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CourseManagerModal from '../src/components/schedule/CourseManagerModal.vue'
import { settings, TIMEZONE_OPTIONS } from '../src/composables/settingsPolicy.js'

/** 与 formatAppDate 相同的格式（zh-CN 数字日期，不带星期）。 */
const renderIn = (instant, timeZone) => new Intl.DateTimeFormat('zh-CN', {
  timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
}).format(new Date(instant))

/** 旧写法（设备时区）的渲染结果——回归检查就是"不能再等于它"。 */
const renderDevice = (instant) => new Date(instant).toLocaleDateString('zh-CN')

const INSTANT = '2026-09-20T16:30:00.000Z'
/** 除 `local` 外的可选策略时区（`local` 与设备同义，没有区分力）。 */
const NON_LOCAL_ZONES = TIMEZONE_OPTIONS.map((item) => item.value).filter((value) => value !== 'local')

let app = null
let host = null
let savedSettings = null

function cleanupMount() {
  app?.unmount()
  app = null
  document.body.querySelectorAll('.overlay').forEach((el) => el.remove())
  host?.remove()
  host = null
}

afterEach(() => {
  cleanupMount()
  if (savedSettings !== null) settings.value = savedSettings
  savedSettings = null
})

function mountModal(templates) {
  cleanupMount()
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(CourseManagerModal, {
      open: true,
      courses: [],
      templates,
      selectedIds: [],
      templateName: '',
    }),
  })
  app.mount(host)
}

/** Modal 把内容 Teleport 到 body，所以要从 body 里找，而不是挂载点。 */
const modalRoot = () => document.body.querySelector('.overlay')

const template = (overrides = {}) => ({
  id: 'tpl-1',
  name: '2026 秋季学期',
  courses: [{ id: 'c1', name: '高等数学', start: 1, end: 2, week: 1, day: 1 }],
  createdAt: INSTANT,
  ...overrides,
})

describe('课表模板的保存日期走应用时区策略', () => {
  it('每个可选策略时区下显示的都是该时区的日期', async () => {
    savedSettings = settings.value
    const rendered = {}
    const deviceDate = renderDevice(INSTANT)

    for (const zone of NON_LOCAL_ZONES) {
      settings.value = { ...savedSettings, timezone: zone }
      mountModal([template()])
      await nextTick()

      const item = modalRoot()?.querySelector('.template-item')
      expect(item, '没渲染出模板条目，判据已与实现脱节').toBeTruthy()
      const expected = renderIn(INSTANT, zone)
      expect(item.textContent, `策略时区 ${zone} 下应显示 ${expected}`).toContain(expected)
      // 格式不变：仍然是不带星期的数字日期
      expect(item.textContent).not.toContain('周')
      rendered[zone] = expected
    }

    // ── 区分力自检（防止断言退化成恒真）──
    // 这两条合起来保证两类变异都跑不掉：
    //   · 有"策略 ≠ 设备"的一次 → "按设备时区渲染"的变异会在那次断言上失败；
    //   · Asia/Shanghai ≠ UTC   → "偷懒取 UTC 日期"的变异会在 Shanghai 那次失败。
    expect(Object.keys(rendered).length, '可选非 local 时区少于两个，断言覆盖不足').toBeGreaterThanOrEqual(2)
    expect(
      Object.values(rendered).some((date) => date !== deviceDate),
      '两个可选策略时区都与设备时区给出同一天，这条测试失去区分力',
    ).toBe(true)
    expect(rendered['Asia/Shanghai'], 'Asia/Shanghai 与 UTC 必须给出不同日期，否则"偷懒取 UTC"的变异测不出来')
      .not.toBe(rendered['UTC'])
  })

  it('createdAt 缺失或非法时显示空，不抛错也不显示 "Invalid Date"', async () => {
    savedSettings = settings.value
    settings.value = { ...savedSettings, timezone: 'UTC' }

    mountModal([
      template({ id: 'tpl-bad', name: '没有时间的模板', createdAt: '' }),
      template({ id: 'tpl-bad2', name: '坏时间的模板', createdAt: 'not-a-date' }),
    ])
    await nextTick()

    const text = modalRoot()?.textContent ?? ''
    expect(text).not.toContain('Invalid Date')
    expect(text).not.toContain('NaN')
    // 名称仍然渲染（说明只是日期那一段为空）
    expect(text).toContain('没有时间的模板')
    expect(text).toContain('坏时间的模板')
  })
})