// @vitest-environment happy-dom
/**
 * 作息导入**执行失败**时，失败必须留在计划弹窗里，并给出一个明确的出口。
 *
 * 【缺陷现场】`applyImportItem` 抛错后，`timeImportPlan.js` 回滚了数据、把 `importRunning`
 * 置回 false，于是 `TimeImportPlanModal.vue` 按 `importRunning` 切回了**计划列表**；失败文案
 * 只写进 `importError`，而它唯一的渲染点在下层 `TimeSettingsModal`（被计划弹窗按浮层深度盖住）。
 * 用户看到的只是"点确认 → 闪一下 → 又回到计划列表"，无从判断成没成，很可能再点一次。
 *
 * 【这条守卫怎么复现旧行为】本文件只挂载**计划弹窗**这一层（下层根本不渲染，所以"错误只在
 * 下层"在 DOM 里就是"完全没有错误"），然后让真实的 `confirmImportPlan()` 走真实的失败分支：
 *   - 用例一：`applyImportItem` 抛错（catch 分支，缺陷原文描述的那条路）；
 *   - 用例二：拿不到快照（`snapshotTimeConfig` 返回 null，早退分支——同一条缺陷的第二个入口，
 *     它连 `importProgress.start()` 都没走到）。
 * 判据是"当前浮层里有没有失败原因与出口"，而旧实现在这里渲染的是计划列表（含「确认并导入」）。
 *
 * 【为什么只 mock `currentRecognitionApi`】识别 API 是懒加载的动态 import，测试里没有真实
 * 识别结果可用；用 `importOriginal` 摊开真实模块、只替换这一个函数，其余导出（含识别流程的
 * 其它函数）保持原样，避免把整条识别链一起换掉。
 *
 * 【判别力自证】删掉 catch 里的 `importFailed.value = true`（= 旧行为：失败即切回列表），
 * 用例一在"失败必须留在当前弹窗里"处变红；删掉弹窗里的失败分支同理。恢复后即绿。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import TimeImportPlanModal from '../src/components/schedule/TimeImportPlanModal.vue'
import TimeSettingsModal from '../src/components/schedule/TimeSettingsModal.vue'
import {
  confirmImportPlan, importFailed, importPlan, importPlanOpen, importRunning,
} from '../src/composables/timeImportPlan.js'
import { importError, settingsToast, stopSettingsToast } from '../src/composables/timeSettingsShared.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘（见 modalSections.test.js 的同名说明）。
registerMirrorTeardown()

/** 可控的识别 API：只替换 currentRecognitionApi，其余识别导出保持真实。 */
const apiState = vi.hoisted(() => ({
  snapshotAvailable: true,
  applyThrows: null,
  applyCalls: 0,
  restoreCalls: [],
}))

vi.mock('../src/composables/scheduleOcrFlow.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    currentRecognitionApi: () => ({
      snapshotTimeConfig: () => (apiState.snapshotAvailable ? { times: '快照' } : null),
      applyImportItem: () => {
        apiState.applyCalls += 1
        if (apiState.applyThrows) throw apiState.applyThrows
      },
      restoreTimeConfig: (cfg, snapshot) => { apiState.restoreCalls.push(snapshot) },
    }),
  }
})

let mounted = null

beforeEach(() => {
  apiState.snapshotAvailable = true
  apiState.applyThrows = null
  apiState.applyCalls = 0
  apiState.restoreCalls = []
  importPlan.value = null
  importPlanOpen.value = false
  importFailed.value = false
  importRunning.value = false
  importError.value = ''
  settingsToast.value = ''
})

afterEach(() => {
  stopSettingsToast()
  // 可能还有一次没跑完的执行（用例里的失败都是同步抛错，但保险起见复位运行标记）
  importRunning.value = false
  importPlanOpen.value = false
  importPlan.value = null
  mounted?.app.unmount()
  mounted?.host.remove()
  mounted = null
  document.body.innerHTML = ''
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

function mountModal() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ render: () => h(TimeImportPlanModal) })
  app.mount(host)
  mounted = { app, host }
}

/** 挂载**父**弹窗：它同时渲染底层的错误行与作为子节点的计划弹窗（两层都在 DOM 里）。 */
function mountParent() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({
    render: () => h(TimeSettingsModal, { show: true, courseCountByPeriodId: () => 0 }),
  })
  app.mount(host)
  mounted = { app, host }
}

function fakePlan() {
  return {
    executable: true,
    summary: { total: 1, replace: 0, create: 1, skip: 0, blocked: 0 },
    items: [{
      schemeId: 's1',
      label: '夏季时间 · 南校区',
      action: 'create',
      targetMode: 'create',
      blockers: [],
      warnings: [],
      diff: null,
    }],
  }
}

/** 打开计划弹窗（正常入口是 openImportPlan()，它依赖真实识别结果；这里直接摆好计划状态）。 */
function openPlan() {
  importPlan.value = fakePlan()
  importPlanOpen.value = true
}

function topOverlay() {
  const overlays = [...document.querySelectorAll('.overlay')]
  return overlays[overlays.length - 1] ?? null
}

function topModal() {
  return topOverlay()?.querySelector('.modal') ?? null
}

function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

describe('导入失败必须留在计划弹窗里', () => {
  it('执行中抛错：失败留在当前弹窗、给出重试与返回两个出口，并且已经回滚', async () => {
    mountModal()
    openPlan()
    await nextTick()
    expect(topModal().textContent, '对照组：先要看到计划列表').toContain('确认并导入')

    apiState.applyThrows = new Error('模拟写入失败')
    await confirmImportPlan()
    await nextTick()

    const modal = topModal()
    expect(importPlanOpen.value, '失败后计划弹窗不能自己消失').toBe(true)
    expect(modal.textContent, '失败原因必须留在当前弹窗里（旧实现在这里已切回计划列表）')
      .toContain('导入失败，已恢复原数据：模拟写入失败')
    expect(modal.textContent, '不能又回到计划列表').not.toContain('确认并导入')
    expect(apiState.applyCalls).toBe(1)
    expect(apiState.restoreCalls, '失败必须回滚到导入前的快照').toHaveLength(1)
    expect(modal.querySelector('[role="alert"]')?.textContent, '失败要能被读屏播报').toContain('导入失败')
    expect(buttonByText(modal, '重试导入'), '必须给出重试出口').toBeTruthy()
    expect(buttonByText(modal, '返回计划列表'), '必须给出返回出口').toBeTruthy()
  })

  it('识别引擎未就绪（拿不到快照）同样留在当前弹窗里说清原因', async () => {
    mountModal()
    openPlan()
    await nextTick()

    apiState.snapshotAvailable = false
    await confirmImportPlan()
    await nextTick()

    const modal = topModal()
    expect(importPlanOpen.value).toBe(true)
    expect(modal.textContent, '早退分支也要在当前弹窗里报错').toContain('识别引擎未就绪')
    expect(modal.textContent, '不能回到计划列表').not.toContain('确认并导入')
    expect(apiState.restoreCalls, '还没写过数据就不该回滚').toEqual([])
    expect(importRunning.value, '早退时不该停在运行中').toBe(false)
  })

  it('「返回计划列表」是明确的出口：关掉弹窗，并把失败原因交回下层', async () => {
    mountModal()
    openPlan()
    await nextTick()
    apiState.applyThrows = new Error('模拟写入失败')
    await confirmImportPlan()
    await nextTick()

    buttonByText(topModal(), '返回计划列表').click()
    await nextTick()

    expect(importPlanOpen.value, '返回后弹窗应当关闭').toBe(false)
    expect(importFailed.value, '下次打开不该还停在失败态').toBe(false)
    expect(importError.value, '失败文案要留给下层弹窗显示').toContain('导入失败')
  })

  it('「重试导入」会重新执行：清掉失败态，成功后才关闭弹窗', async () => {
    mountModal()
    openPlan()
    await nextTick()
    apiState.applyThrows = new Error('模拟写入失败')
    await confirmImportPlan()
    await nextTick()

    apiState.applyThrows = null
    buttonByText(topModal(), '重试导入').click()
    await nextTick()
    expect(importFailed.value, '重试一开始就该离开失败态').toBe(false)
    expect(importRunning.value, '重试要真的重新开始').toBe(true)

    await wait(900)
    expect(apiState.applyCalls, '重试要真的再执行一次').toBe(2)
    expect(importPlanOpen.value, '成功后弹窗关闭').toBe(false)
    expect(importError.value, '重试成功后不能再挂着上一次的失败文案').toBe('')
  })

  it('两层浮层不会同时渲染同一句失败（否则读屏会把同一句话播两遍）', async () => {
    // 挂载父弹窗：底层错误行与计划弹窗都在 DOM 里，正好检验"计划弹窗开着时不渲染下层那份"。
    mountParent()
    openPlan()
    await nextTick()

    apiState.applyThrows = new Error('模拟写入失败')
    await confirmImportPlan()
    await nextTick()

    const failedAlerts = [...document.querySelectorAll('[role="alert"]')]
      .filter((el) => el.textContent.includes('导入失败'))
    expect(failedAlerts, '同一句失败只能有一个播报点').toHaveLength(1)
    expect(failedAlerts[0].className, '报信的应当是计划弹窗里的那份').toContain('plan-fail')
    expect(failedAlerts[0].closest('.overlay'), '它必须属于最上层的计划弹窗').toBe(topOverlay())
  })
})