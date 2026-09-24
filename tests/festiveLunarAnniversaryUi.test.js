// @vitest-environment happy-dom
//
// 农历纪念日的**面板行为**测试（FestiveSettings.vue）。
//
// 【为什么需要一个挂载测试】纯函数测试只能证明"算得对"；这条需求里有一半是"用户能看到"：
// 能新增一条农历纪念日、勾闰月、并且看到那一年解析出的公历日期或明确的不可用文案。
//
// 【为什么查 document 而不是挂载点】Modal.vue 把内容 Teleport 到 document.body，
// 表单不在 createApp 的容器里；这里统一从 document 取**最后一个**匹配节点，
// 避免上一次挂载的残留被误认成新的。
//
// 【为什么期望值由纯函数现算】应用时区可配置（settingsPolicy.timezone 默认 'local'），
// 写死 '2026-06-19' 会在 UTC+14 之类的时区翻车。这里先钉住 clock，再用同一个
// appToday 调 resolveLunarAnniversary 得到期望值，断言"面板显示的就是函数算的"。

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import FestiveSettings from '../src/components/FestiveSettings.vue'
import { DEFAULT_FESTIVE_CONFIG, festiveFor } from '../src/composables/festive.js'
import {
  LUNAR_ANNIVERSARY_KEY,
  readLunarAnniversaries,
  resetLunarAnniversaryMirror,
  resolveLunarAnniversary,
} from '../src/composables/lunarAnniversaries.js'
import { clock, flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'
import { appToday } from '../src/composables/timeContext.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

const mounted = []
let previousClock = null

// 面板与测试共用同一个缓存 ref（useStoredRef 按 key 缓存），所以这里能把它清干净，
// 让每条用例都从"空面板"开始，而不是被上一条用例存下的行污染。
const lunarStored = useStoredRef(LUNAR_ANNIVERSARY_KEY, [])

async function settle() {
  await nextTick()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  await nextTick()
}

/**
 * 存储层是**批处理落盘**（WRITE_DELAY = 300ms 后由 idle 回调写出），
 * 所以断言 localStorage 之前必须显式 flush，否则读到的是陈旧值或 null。
 */
function flushStorage() {
  flushStoredWrites()
}

/** 读新键（没写过就是 []）。 */
function readStoredLunar() {
  flushStorage()
  const raw = localStorage.getItem(LUNAR_ANNIVERSARY_KEY)
  return raw === null ? [] : JSON.parse(raw)
}

function latest(selector) {
  const nodes = [...document.querySelectorAll(selector)]
  return nodes[nodes.length - 1] || null
}

function allOf(selector) {
  return [...document.querySelectorAll(selector)]
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

/** 点「＋ 添加农历纪念日」。 */
async function clickAdd() {
  const button = allOf('button').find((node) => node.textContent.includes('添加农历纪念日'))
  expect(button, '没找到「添加农历纪念日」按钮').toBeTruthy()
  button.click()
  await settle()
}

/** 取最后一行农历纪念日的 DOM。 */
function lastRow() {
  const row = latest('.lunar-row')
  expect(row, '没有农历纪念日行').toBeTruthy()
  return row
}

async function setLabel(text) {
  const input = latest('input[aria-label="农历纪念日名称"]')
  expect(input, '没找到名称输入框').toBeTruthy()
  input.value = text
  input.dispatchEvent(new Event('input'))
  await settle()
}

async function pickMonth(month) {
  const select = latest('select[aria-label="农历月份"]')
  expect(select, '没找到农历月份选择框').toBeTruthy()
  select.value = String(month)
  select.dispatchEvent(new Event('change'))
  await settle()
}

async function pickDay(day) {
  const select = latest('select[aria-label="农历日期"]')
  expect(select, '没找到农历日期选择框').toBeTruthy()
  select.value = String(day)
  select.dispatchEvent(new Event('change'))
  await settle()
}

async function toggleLeap() {
  const box = latest('.lunar-leap input[type="checkbox"]')
  expect(box, '没找到闰月勾选框').toBeTruthy()
  box.checked = true
  box.dispatchEvent(new Event('change'))
  await settle()
}

beforeEach(async () => {
  lunarStored.value = []
  flushStoredWrites() // 立刻把 [] 落盘，避免残留的批处理写入在断言中途冒出
  localStorage.removeItem(LUNAR_ANNIVERSARY_KEY)
  resetLunarAnniversaryMirror()
  previousClock = clock.value
  // 正午 UTC：绝大多数时区仍是 2026-06-19，跨年/跨日风险最低（期望值仍由 appToday 现算）。
  clock.value = new Date('2026-06-19T12:00:00Z')
  await settle()
})

afterEach(async () => {
  unmountAll()
  // Modal 的 Teleport 节点若因异常残留，一并清掉，避免影响后续用例的 latest()
  allOf('.overlay').forEach((node) => node.remove())
  lunarStored.value = []
  flushStoredWrites()
  localStorage.removeItem(LUNAR_ANNIVERSARY_KEY)
  resetLunarAnniversaryMirror()
  clock.value = previousClock
  await settle()
})

describe('农历纪念日面板：新增并显示解析出的公历日期', () => {
  it('允许新增一条农历纪念日并显示本年公历日期，同时写入新键', async () => {
    await mountPanel()
    expect(latest('.lunar-row')).toBeNull()
    expect(document.body.textContent).toContain('还没有农历纪念日')

    await clickAdd()
    await setLabel('外婆生日')
    await pickMonth(5)
    await pickDay(5)

    const expected = resolveLunarAnniversary({ label: '外婆生日', lunarMonth: 5, lunarDay: 5 }, appToday.value)
    expect(expected.status).toBe('ok')

    const row = lastRow()
    // 名称在 <input> 的 value 里（textContent 拿不到 input 的值）
    expect(row.querySelector('input[aria-label="农历纪念日名称"]').value).toBe('外婆生日')
    // 面板显示的日期就是纯函数按"今年的 appToday"算出来的那个日期
    expect(row.textContent).toContain(expected.dateKey)
    // 命中的行不该出现任何不可用文案
    expect(row.textContent).not.toContain('超出农历支持范围')
    expect(row.textContent).not.toContain('没有三十')
    expect(row.textContent).not.toContain('没有这个闰月')

    // 新键真的写了（形状：数组，含 id/label/lunarMonth/lunarDay/isLeapMonth）
    const stored = readStoredLunar()
    expect(Array.isArray(stored)).toBe(true)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ label: '外婆生日', lunarMonth: 5, lunarDay: 5, isLeapMonth: false })
    expect(typeof stored[0].id).toBe('string')
  })

  it('关闭再打开面板后，已保存的农历纪念日仍在，且 id 稳定（同步/备份按 id 对账）', async () => {
    await mountPanel()
    await clickAdd()
    await setLabel('外婆生日')
    await pickMonth(5)
    await pickDay(5)
    const expected = resolveLunarAnniversary({ label: '外婆生日', lunarMonth: 5, lunarDay: 5 }, appToday.value)
    const idBefore = readStoredLunar()[0].id

    unmountAll()
    await mountPanel()

    const row = lastRow()
    expect(row.querySelector('input[aria-label="农历纪念日名称"]').value).toBe('外婆生日')
    expect(row.textContent).toContain(expected.dateKey)
    expect(row.textContent).toContain('五月初五')

    // 重新打开后再改一次：id 不许被重新生成
    await setLabel('外婆生日（农历）')
    const stored = readStoredLunar()
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe(idBefore)
    expect(stored[0].label).toBe('外婆生日（农历）')
  })

  it('删除按钮能把行删掉，并把新键清空', async () => {
    await mountPanel()
    await clickAdd()
    await setLabel('外婆生日')
    await pickMonth(5)
    await pickDay(5)
    expect(lastRow()).toBeTruthy()

    const del = allOf('.lunar-row .del-btn').pop()
    expect(del, '没找到删除按钮').toBeTruthy()
    del.click()
    await settle()

    expect(latest('.lunar-row')).toBeNull()
    expect(document.body.textContent).toContain('还没有农历纪念日')
    expect(readStoredLunar()).toEqual([])
  })
})

describe('农历纪念日面板：闰月与不可用状态如实显示', () => {
  it('勾了闰月而该年没有这个闰月 → 显示文案，且不显示平月日期', async () => {
    await mountPanel()
    await clickAdd()
    await setLabel('闰四月纪念')
    await pickMonth(4)
    await pickDay(1)
    await toggleLeap()

    const plain = resolveLunarAnniversary({ lunarMonth: 4, lunarDay: 1 }, appToday.value)
    expect(plain.status).toBe('ok') // 平四月初一本身是有落点的

    const row = lastRow()
    expect(row.textContent).toContain('该年没有这个闰月')
    expect(row.textContent).toContain('闰四月初一')
    // 静默回退成平月就会被这条抓住
    expect(row.textContent).not.toContain(plain.dateKey)

    const stored = readStoredLunar()
    expect(stored[0].isLeapMonth).toBe(true)
  })

  it('小月没有三十 → 显示「该农历年这个月是小月，没有三十」并给出下一次', async () => {
    await mountPanel()
    await clickAdd()
    await setLabel('大年三十')
    await pickMonth(12)
    await pickDay(30)

    const resolved = resolveLunarAnniversary({ lunarMonth: 12, lunarDay: 30 }, appToday.value)
    const row = lastRow()
    expect(resolved.status).toBe('no-such-day')
    expect(row.textContent).toContain('该农历年这个月是小月，没有三十')
    if (resolved.nextDateKey) expect(row.textContent).toContain(resolved.nextDateKey)
  })

  it('面板写明支持区间与闰月口径', async () => {
    await mountPanel()
    const hint = document.body.textContent
    // 支持区间与闰月/三十的口径必须写在面板上（不可用时用户要看得懂为什么）
    expect(hint).toContain('农历表覆盖 1900–2101')
    expect(hint).toContain('闰月')
    expect(hint).toContain('不会按平月计算')
    expect(hint).toContain('小月没有三十')
  })
})

describe('农历纪念日：内存镜像让首页氛围无需改动 App.vue 也能读到', () => {
  it('首次读取从 sl_festive_lunar 补水，festiveFor 当天就能命中', () => {
    localStorage.setItem(
      LUNAR_ANNIVERSARY_KEY,
      JSON.stringify([{ label: '外婆生日', lunarMonth: 5, lunarDay: 5, isLeapMonth: false }]),
    )
    resetLunarAnniversaryMirror()

    expect(readLunarAnniversaries()).toHaveLength(1)
    expect(readLunarAnniversaries()[0].label).toBe('外婆生日')

    const overlay = festiveFor('2026-06-19', DEFAULT_FESTIVE_CONFIG)
    expect(overlay?.key).toBe('anniversary')
    expect(overlay?.name).toBe('外婆生日')
    expect(overlay?.decor).toBe('confetti')
  })

  it('坏数据的键不会炸：补水时归一化掉，首页照旧走内置节日', () => {
    localStorage.setItem(LUNAR_ANNIVERSARY_KEY, '{ 这不是 JSON')
    resetLunarAnniversaryMirror()
    expect(readLunarAnniversaries()).toEqual([])
    expect(festiveFor('2026-06-19', DEFAULT_FESTIVE_CONFIG)?.key).toBe('dragon')

    localStorage.setItem(LUNAR_ANNIVERSARY_KEY, JSON.stringify([{ label: '越界', lunarMonth: 13, lunarDay: 1 }]))
    resetLunarAnniversaryMirror()
    expect(readLunarAnniversaries()).toEqual([])
  })
})