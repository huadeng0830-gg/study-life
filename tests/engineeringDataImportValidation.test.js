// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/composables/dataVault.js', () => ({
  clearDataVault: vi.fn(async () => true),
  mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true),
  setMirrorErrorHandler: vi.fn(),
  setMirrorTimingHandler: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

async function importFlow(entry = 'scheduleOcrFlow') {
  await import(`../src/composables/${entry}.js`)
  const flow = await import('../src/composables/scheduleOcrFlow.js')
  const schemes = await import('../src/composables/recognitionSchemes.js')
  const plan = await import('../src/composables/timeImportPlan.js')
  const draft = await import('../src/composables/timePlanDraft.js')
  const { timeConfig } = await import('../src/composables/store/timeConfig.js')
  timeConfig.value = {
    campuses: [{ id: 'fictional-campus', name: '虚构校区' }],
    seasons: [{ id: 'fictional-season', name: '虚构作息', startDate: '01-01' }],
    periods: [{ id: 'fictional-period', label: '第1节课' }],
    times: { 'fictional-season': { 'fictional-campus': [{ start: '07:00', end: '07:45' }] } },
  }
  const analysis = await flow.parseScheduleText('虚构作息 虚构校区\n第一节课 08:00-08:45')
  await schemes.startRecognition(analysis, 'fictional.txt')
  draft.loadPlanDraft('fictional-season', 'fictional-campus')
  return { flow, schemes, plan, draft, timeConfig }
}

describe('作息模块循环初始化与真实导入链', () => {
  it.each(['timePlanDraft', 'timePlanTools', 'scheduleOcrFlow', 'recognitionSchemes', 'timeImportPlan'])(
    '以 %s 为入口可完成文字识别、计划、导入、持久化及撤销', async (entry) => {
      const { schemes, plan, draft, timeConfig } = await importFlow(entry)
      expect(draft.planSections.value[0].rows[0].start).toBe('07:00')
      expect(schemes.activeSchemeValidation.value.hardRowCount).toBe(0)
      plan.openImportPlan()
      expect(plan.importPlan.value.executable).toBe(true)
      const saving = plan.confirmImportPlan()
      await vi.advanceTimersByTimeAsync(1000)
      await saving
      expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '08:00', end: '08:45' })
      const core = await import('../src/composables/store/core.js')
      core.flushStoredWrites()
      expect(JSON.parse(localStorage.getItem('sl_timecfg')).times['fictional-season']['fictional-campus'][0].start).toBe('08:00')
      plan.undoLastImport()
      expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '07:00', end: '07:45' })
    },
  )

  it.each([['25:00', '26:00'], ['08:99', '10:00']])('校对后的非法时间 %s–%s 不得进入可执行导入计划', async (start, end) => {
    const { schemes, plan, timeConfig } = await importFlow()
    Object.assign(schemes.activeScheme.value.rows[0], { start, end, confirmed: true })
    plan.openImportPlan()
    expect(plan.importPlan.value.executable).toBe(false)
    await plan.confirmImportPlan()
    expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '07:00', end: '07:45' })
  })

  it.each([['25:00', '26:00'], ['08:99', '10:00'], ['invalid', '09:00']])('手动作息草稿 %s–%s 被保存边界拒绝', async (start, end) => {
    const { draft, timeConfig } = await importFlow()
    draft.draft.value[0] = { start, end }
    draft.markDirty()
    expect(draft.saveDraft({ notify: false })).toBe(false)
    expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '07:00', end: '07:45' })
  })
})
