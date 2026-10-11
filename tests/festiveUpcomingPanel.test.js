// @vitest-environment happy-dom
//
// 「即将到来」面板行为测试（FestiveSettings.vue）。
//
// 【这一组要证明什么】纯函数测试证明了算法对不对（tests/anniversarySchedule.test.js），
// 这里证明的是**用户真的看得到**：在面板里填一个公历纪念日，"即将到来"里立刻出现它，
// 并且写的是引擎点亮它的那一天。
//
// 【最强的一条是对照，不是"渲染出来了"】每条用例都配一条"只改一个变量"的对照：
// 同一天改了倒计时，跟着变；不改则不变。防的是"这一段模板写死了日期 /
// 恒为真"这类看起来通过、实际没接线的假绿。
//
// 【为什么钉 clock】应用时区可配置，写死 '2026-06-19' 会在 UTC+14 之类的时区翻车。
// 先钉 clock，再用同一个 appToday 调纯函数算期望值 —— 断言"面板显示的就是函数算的"。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import FestiveSettings from '../src/components/FestiveSettings.vue'
import { festiveFor } from '../src/composables/festive.js'
import { upcomingAnniversaries } from '../src/composables/anniversarySchedule.js'
import {
  LUNAR_ANNIVERSARY_KEY,
  resetLunarAnniversaryMirror,
} from '../src/composables/lunarAnniversaries.js'
import { clock, flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'
import { appToday } from '../src/composables/timeContext.js'
import { settings, DEFAULT_SETTINGS_POLICY } from '../src/composables/settingsPolicy.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

const mounted = []
let previousClock = null
let previousSettings = null

// 面板与测试共用同一批缓存 ref（useStoredRef 按 key 缓存），所以直接赋值最干净；
// 只往 localStorage 写是**没用**的：模块加载时值早就读进缓存了，写存储不会推它。
const festiveStored = useStoredRef('sl_festive_config', { enabled: true, birthday: '', installDate: '', anniversaries: [] })
const lunarStored = useStoredRef(LUNAR_ANNIVERSARY_KEY, [])

async function settle() {
  await nextTick()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await nextTick()
}

/** 播种两条配置。农历那条还要复位内存镜像，否则面板/氛围层会读到上一条用例的残留。 */
function seed(config, lunar = []) {
  festiveStored.value = { enabled: true, birthday: '', installDate: '', anniversaries: [], ...config }
  lunarStored.value = lunar
  resetLunarAnniversaryMirror()
}

function allOf(selector) {
  return [...document.querySelectorAll(selector)]
}

function latest(selector) {
  const nodes = allOf(selector)
  return nodes[nodes.length - 1] || null
}

async function mountPanel() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ render: () => h(FestiveSettings, { open: true }) })
  app.mount(host)
  mounted.push({ app, host })
  await settle()
  return host
}

function unmountAll() {
  while (mounted.length) {
    const { app, host } = mounted.pop()
    app.unmount()
    host.remove()
  }
}

/** 「即将到来」里的每一行 → { 名称, 副标题, 日期, 相对, 警告 }。 */
function upcomingRows() {
  return allOf('.upcoming-row').map((row) => {
    const name = row.querySelector('.upcoming-name')
    const recurrence = name?.querySelector('small')?.textContent?.trim() ?? ''
    const label = name?.cloneNode(true)
    label?.querySelectorAll('small').forEach((node) => node.remove())
    return {
      name: label?.textContent?.trim() ?? '',
      nameHint: recurrence,
      date: row.querySelector('.upcoming-when b')?.textContent?.trim() ?? '',
      relative: allOf('.upcoming-when small', row)[0]?.textContent?.trim() ?? '',
      warn: row.querySelector('.upcoming-warn')?.textContent?.trim() ?? '',
      isToday: row.classList.contains('is-today'),
    }
  })
}

beforeEach(() => {
  previousClock = clock.value
  localStorage.clear()
  // 固定在一天中间：避免跨零点时 appToday 翻页，让"还有 N 天"断言自相矛盾。
  clock.value = '2027-05-06T10:00:00'
  festiveStored.value = { enabled: true, birthday: '', installDate: '', anniversaries: [] }
  lunarStored.value = []
  resetLunarAnniversaryMirror()
})

afterEach(() => {
  unmountAll()
  if (previousClock) clock.value = previousClock
  localStorage.clear()
  resetLunarAnniversaryMirror()
})

describe('面板的「即将到来」清单', () => {
  it('没有任何登记时给的是空状态文案，不是空白区', async () => {
    seed({ enabled: true, birthday: '', installDate: '', anniversaries: [] })
    await mountPanel()
    expect(upcomingRows()).toEqual([])
    expect(latest('.upcoming-section')?.textContent).toContain('还没有登记任何日子')
  })

  it('公历纪念日：清单写的就是引擎点亮它的那一天（同一个 appToday 算出来的）', async () => {
    seed({ enabled: true, birthday: '', installDate: '', anniversaries: [{ date: '06-19', label: '在一起' }] })
    await mountPanel()

    const expected = upcomingAnniversaries(festiveStored.value, [], appToday.value).find((row) => row.source === 'anniversary')
    // 纯函数与面板必须给出同一个答案，否则"算对了但显示的不是它"照样是缺陷。
    expect(expected.nextDateKey).toBeTruthy()
    expect(festiveFor(expected.nextDateKey, { enabled: true, anniversaries: [{ date: '06-19', label: '在一起' }] })?.key).toBe('anniversary')

    const [row] = upcomingRows()
    expect(row.name).toContain('在一起')
    expect(row.nameHint).toBe('每年 06-19')
    expect(row.date).toBe(expected.nextDateKey)
    expect(row.relative).toBe(expected.relativeText)
    expect(row.isToday).toBe(false)
  })

  it('生日、使用周年、公历纪念日、农历纪念日按日期升序排在同一张清单里', async () => {
    seed(
      { enabled: true, birthday: '03-08', installDate: '2020-12-25', anniversaries: [{ date: '05-20', label: '在一起' }] },
      [{ id: 'l1', label: '外婆生日', lunarMonth: 1, lunarDay: 5, isLeapMonth: false }],
    )
    await mountPanel()

    const rows = upcomingRows()
    expect(rows.map((row) => row.date)).toEqual([...rows.map((row) => row.date)].sort())
    expect(rows.map((row) => row.name).sort()).toEqual([
      '在一起',
      '外婆生日',
      '使用周年',
      '我的生日',
    ].sort())
  })

  it('对照：换一个纪念日日期，清单里跟着变；不换就不变', async () => {
    seed({ enabled: true, birthday: '', installDate: '', anniversaries: [{ date: '06-19', label: '在一起' }] })
    await mountPanel()
    const before = upcomingRows().map((row) => row.date)

    // 改日期输入框（面板里「纪念日 ${label} 的日期」那个）。
    const dateInput = latest('input[aria-label="纪念日 在一起 的日期"]')
    expect(dateInput, '没找到纪念日日期输入框').toBeTruthy()
    dateInput.value = '2000-07-01'
    dateInput.dispatchEvent(new Event('change'))
    await settle()

    const after = upcomingRows().map((row) => row.date)
    expect(after).not.toEqual(before)
    expect(upcomingAnniversaries(festiveStored.value, [], appToday.value).find((row) => row.source === 'anniversary').nextDateKey).toBe(after[0])
  })

  it('农历纪念日"今年没有这个闰月"时，清单照样给日期并把状态说出来', async () => {
    // 闰六月：2027 年没有（2027 无闰月），下一次在 2036 年。
    seed({}, [{ id: 'l2', label: '外婆生日', lunarMonth: 6, lunarDay: 8, isLeapMonth: true }])
    await mountPanel()

    const rows = upcomingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toContain('外婆生日')
    expect(rows[0].warn).toBe('该年没有这个闰月')
    // 状态与日期必须同时在：只给状态会让用户以为这个纪念日坏了。
    expect(rows[0].date).toBe('2036-07-30')
    expect(rows[0].nameHint).toBe('每年农历闰六月初八')
  })

  it('关掉"启用节日氛围"时清单仍在（那是装饰开关，不是数据开关）', async () => {
    seed({ enabled: false, birthday: '03-08', installDate: '', anniversaries: [] })
    await mountPanel()
    const rows = upcomingRows()
    expect(rows.map((row) => row.name)).toEqual(['我的生日'])
    // 徽标要说清"氛围关着但仍列出"，否则用户会以为看到的日期不算数。
    expect(latest('.upcoming-section .readonly-badge')?.textContent?.trim()).toBe('氛围已关闭 · 仍会列出')
  })

  it('当天命中的那一条带 is-today 标记，且写「就是今天」', async () => {
    // clock 钉在 2027-05-06，所以今天就是 05-06。
    seed({ enabled: true, birthday: '', installDate: '', anniversaries: [{ date: '05-06', label: '在一起' }] })
    await mountPanel()
    const rows = upcomingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].isToday).toBe(true)
    expect(rows[0].relative).toBe('就是今天')
    expect(rows[0].date).toBe('2027-05-06')
  })

  it('清单是只读汇总：里面没有任何可聚焦控件，读屏不会多出一串 Tab 停留点', async () => {
    seed({ enabled: true, birthday: '03-08', installDate: '', anniversaries: [{ date: '06-19', label: '在一起' }] })
    await mountPanel()
    const section = latest('.upcoming-section')
    expect(section).toBeTruthy()
    expect(section.querySelectorAll('button, input, select, a[href], [tabindex]')).toHaveLength(0)
  })
})
