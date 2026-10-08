// @vitest-environment happy-dom
/**
 * 「恢复默认作息时间」的两条守卫（缺陷：破坏性操作没有二次确认，且执行后屏幕上毫无变化）。
 *
 * 【被守住的需求】点工具条的「↺ 恢复默认」或草稿条的「恢复默认时间」时：
 *   1. 必须先弹应用内确认框（`resetTimesToDefault()` 重建的是**所有作息季 × 所有校区**的
 *      正式 `times`，没有撤销入口）；
 *   2. 确认框文案要说清"这是全部方案"以及"与当前草稿不是一件事"；
 *   3. 确认之后屏幕上必须立刻看得见结果，并给出一条能被读屏播报的成功提示。
 *
 * 【为什么第 3 条要断言输入框而不是只看数据】编辑器渲染的是 **draft**（`planSections` 逐行
 * 读 `draft.value[i]`），而 `resetTimesToDefault()` 只改写 `timeConfig.times`。缺陷的现场正是
 * "数据变了、屏幕没变"——所以守卫必须同时看数据与屏幕，只看数据的话旧实现也能过。
 *
 * 【为什么要先造一个非默认值】默认配置天然就是默认值，不做手脚的话"恢复前后"完全一样，
 * 断言就成了同义反复（本项目历史上吃过这种"没判别力"的亏）。所以先把当前方案改成 09:59，
 * 并断言它与默认值确实不同。
 *
 * 【判别力自证】把 `onResetTimes` 退回"直接调用 resetTimesToDefault()"（即缺陷原状），
 * 第一条用例立刻在 `expect(dialog).toBeTruthy()` 处变红：点下去没有确认框，
 * 正式数据已经在用户没同意的情况下被改写。恢复后即绿。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import TimeSettingsModal from '../src/components/schedule/TimeSettingsModal.vue'
import { defaultTimeConfig, timeConfig } from '../src/composables/store/timeConfig.js'
import { draftDirty, loadPlanDraft, planCampusId, planSeasonId } from '../src/composables/timePlanDraft.js'
import { timeSettingsTab } from '../src/composables/modalSections.js'
import { settingsToast, stopSettingsToast } from '../src/composables/timeSettingsShared.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

let mounted = null

beforeEach(() => {
  // timeConfig / 分区 / toast 都是模块级单例，用例之间必须归位（否则上一条的改动会漏到下一条）。
  timeConfig.value = defaultTimeConfig()
  timeSettingsTab.value = 'plans'
  settingsToast.value = ''
})

afterEach(() => {
  stopSettingsToast()
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
  document.body.innerHTML = ''
  // 滚动锁写在 body.dataset 上，用例之间必须清干净（否则后一个用例会继承前一个的锁状态）
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

function mountModal() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({
    render: () => h(TimeSettingsModal, { show: true, courseCountByPeriodId: () => 0 }),
  })
  app.mount(host)
  mounted = { app, host }
  return host
}

/** 挂载后当前正在编辑的「作息季 × 校区」（初始化 watcher 已经选好）。 */
function currentPlan() {
  const season = planSeasonId.value
  const campus = planCampusId.value
  expect(season, '挂载后应当已经选中一个作息季').toBeTruthy()
  expect(campus, '挂载后应当已经选中一个校区').toBeTruthy()
  return { season, campus }
}

/** Modal / ConfirmDialog 都 Teleport 到 body，所以从 document 里找，并取最后一个浮层。 */
function topOverlay() {
  const overlays = [...document.querySelectorAll('.overlay')]
  return overlays[overlays.length - 1] ?? null
}

/** 只点**文本完全相等**的按钮，避免「恢复默认」被「恢复默认时间」误抓。 */
function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

function timeInputs() {
  return [...document.querySelectorAll('.plan-row-times input[type="time"]')]
}

function timeInputValue(index) {
  return timeInputs()[index]?.value
}

/** 模拟用户改时间：v-model 在 text/time 输入上监听 input 事件。 */
function setTimeInput(index, value) {
  const input = timeInputs()[index]
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('「恢复默认」必须先确认，且执行后看得见', () => {
  it('点「↺ 恢复默认」先弹确认框：文案说清范围，取消后数据与界面都不动', async () => {
    mountModal()
    await nextTick()
    const { season, campus } = currentPlan()

    // 先造一个非默认值，否则"恢复默认"前后无差别，这条守卫等于没查
    const defaultStart = defaultTimeConfig().times[season][campus][0].start
    expect(defaultStart, '默认值必须与下面造的值不同').not.toBe('09:59')
    timeConfig.value.times[season][campus][0] = { start: '09:59', end: '10:44' }
    loadPlanDraft(season, campus)
    await nextTick()
    expect(timeInputValue(0)).toBe('09:59')

    buttonByText(document, '↺ 恢复默认').click()
    await nextTick()

    const dialog = topOverlay()
    expect(dialog, '破坏性操作必须先弹应用内确认框（原生 confirm 已全仓清零）').toBeTruthy()
    expect(dialog.textContent, '要说清作用在全部校区上').toContain('所有校区')
    expect(dialog.textContent, '要说清作用在全部作息季上').toContain('所有作息季')
    expect(dialog.textContent, '要说清与"当前正在编辑的草稿"不是一件事').toContain('草稿')
    expect(dialog.textContent, '要说明不可撤销').toContain('无法撤销')

    buttonByText(dialog, '取消').click()
    await nextTick()
    expect(timeConfig.value.times[season][campus][0].start, '取消不该改正式数据').toBe('09:59')
    expect(timeInputValue(0), '取消后界面也不该变').toBe('09:59')
    expect(document.querySelector('.settings-toast'), '取消不该冒出成功提示').toBeNull()
  })

  it('确认后：所有校区 × 作息季都恢复默认，编辑器立刻显示默认值并给出可播报的成功提示', async () => {
    mountModal()
    await nextTick()
    const { season, campus } = currentPlan()
    const otherCampus = timeConfig.value.campuses.find((item) => item.id !== campus).id
    const otherSeason = timeConfig.value.seasons.find((item) => item.id !== season).id
    const defaults = defaultTimeConfig().times

    timeConfig.value.times[season][campus][0] = { start: '09:59', end: '10:44' }
    timeConfig.value.times[season][otherCampus][1] = { start: '11:11', end: '11:55' }
    timeConfig.value.times[otherSeason][campus][2] = { start: '12:12', end: '12:55' }
    loadPlanDraft(season, campus)
    await nextTick()
    expect(timeInputValue(0)).toBe('09:59')

    buttonByText(document, '↺ 恢复默认').click()
    await nextTick()
    buttonByText(topOverlay(), '恢复默认').click()
    await nextTick()

    expect(timeConfig.value.times[season][campus][0].start).toBe(defaults[season][campus][0].start)
    expect(timeConfig.value.times[season][otherCampus][1].start, '别的校区也要恢复').toBe(defaults[season][otherCampus][1].start)
    expect(timeConfig.value.times[otherSeason][campus][2].start, '别的作息季也要恢复').toBe(defaults[otherSeason][campus][2].start)
    // 缺陷本体：屏幕上必须立刻看得见结果（旧实现在这里仍然是 '09:59'）
    expect(timeInputValue(0), '编辑器读的是草稿，恢复后必须重新加载草稿').toBe(defaults[season][campus][0].start)

    const toast = document.querySelector('.settings-toast')
    expect(toast?.textContent, '执行后必须有可见反馈').toContain('默认')
    expect(toast?.getAttribute('role'), '成功提示要能被读屏播报').toBe('status')
  })

  it('草稿有未保存修改时：取消保留草稿，确认后草稿随默认值一起刷新', async () => {
    mountModal()
    await nextTick()
    const { season, campus } = currentPlan()
    const defaults = defaultTimeConfig().times
    timeConfig.value.times[season][campus][3] = { start: '13:33', end: '14:22' }
    loadPlanDraft(season, campus)
    await nextTick()

    setTimeInput(0, '10:10')
    await nextTick()
    expect(draftDirty.value, '改草稿应当标记为有未保存修改').toBe(true)
    expect(timeConfig.value.times[season][campus][0].start, '改草稿不该动正式数据').toBe(defaults[season][campus][0].start)

    buttonByText(document, '↺ 恢复默认').click()
    await nextTick()
    buttonByText(topOverlay(), '取消').click()
    await nextTick()
    expect(draftDirty.value, '取消后未保存的草稿必须原样保留').toBe(true)
    expect(timeInputValue(0)).toBe('10:10')

    buttonByText(document, '↺ 恢复默认').click()
    await nextTick()
    buttonByText(topOverlay(), '恢复默认').click()
    await nextTick()
    expect(draftDirty.value, '恢复默认后草稿与正式数据一致，不该再显示"有未保存修改"').toBe(false)
    expect(timeInputValue(0)).toBe(defaults[season][campus][0].start)
    expect(timeConfig.value.times[season][campus][3].start).toBe(defaults[season][campus][3].start)
  })
})