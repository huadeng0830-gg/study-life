// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

vi.mock('../src/composables/dataVault.js', () => ({
  clearDataVault: vi.fn(async () => true), mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true), setMirrorErrorHandler: vi.fn(), setMirrorTimingHandler: vi.fn(),
}))
const scopes = []
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.clearAllTimers()
  vi.useRealTimers()
})

function externalRestore(key, value) {
  const raw = JSON.stringify(value)
  localStorage.setItem(key, raw)
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw, storageArea: localStorage }))
}
function clone(value) { return JSON.parse(JSON.stringify(value)) }

async function courseReview() {
  const { useDomainCommands } = await import('../src/composables/domain/commands.js')
  const { useScheduleImportReview } = await import('../src/composables/scheduleImportReview.js')
  const domain = useDomainCommands()
  const original = domain.createCourse({ name: '虚构原课程', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16 })
  const incoming = { ...clone(original), id: 'fictional-imported-course', name: '虚构导入课程' }
  const input = { courses: domain.courses, domain, batchError: ref(''), message: ref(''), clearBatchInput: vi.fn(), showForm: ref(false), managerMessage: ref(''), replaceAllTarget: ref(null), showToast: vi.fn() }
  let api
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ setup() { api = useScheduleImportReview(input); return () => h('div') } })
  app.mount(host)
  scopes.push({ stop() { app.unmount(); host.remove() } })
  await api.beginCourseImport([incoming])
  expect(api.showImportConflict.value).toBe(true)
  api.setImportDecision(0, 'replace')
  return { api, input, domain, original, incoming }
}

async function timeReview() {
  const flow = await import('../src/composables/scheduleOcrFlow.js')
  const schemes = await import('../src/composables/recognitionSchemes.js')
  const plan = await import('../src/composables/timeImportPlan.js')
  const { timeConfig } = await import('../src/composables/store/timeConfig.js')
  timeConfig.value = {
    campuses: [{ id: 'fictional-campus', name: '虚构校区' }],
    seasons: [{ id: 'fictional-season', name: '虚构作息', startDate: '01-01' }],
    periods: [{ id: 'fictional-period', label: '第1节课' }],
    times: { 'fictional-season': { 'fictional-campus': [{ start: '07:00', end: '07:45' }] } },
  }
  await schemes.startRecognition(await flow.parseScheduleText('虚构作息 虚构校区\n第一节课 08:00-08:45'), 'fictional.txt')
  plan.openImportPlan()
  return { plan, timeConfig }
}

describe('课程与作息导入保留并发的新编辑', () => {
  it('课程冲突审阅期间跨标签恢复的新课程不能被旧计划覆盖', async () => {
    const { api, input, domain, original } = await courseReview()
    const latest = [clone(original), { ...clone(original), id: 'fictional-other-tab', name: '虚构另一页课程', day: 2 }]
    externalRestore('sl_courses', latest)
    await nextTick()
    await api.commitCourseImport()
    expect(domain.courses.value).toEqual(latest)
    expect(input.batchError.value).toContain('课表已变化')
  })

  it('课程撤销不会丢掉导入后新建的课程', async () => {
    const { api, input, domain } = await courseReview()
    await api.commitCourseImport()
    domain.createCourse({ name: '虚构后续课程', day: 4 })
    const latest = clone(domain.courses.value)
    api.undoLastCourseImport()
    expect(domain.courses.value).toEqual(latest)
    expect(input.message.value).toContain('新的编辑')
  })

  it('换号后不能把上一账号的课表快照撤销到当前账号', async () => {
    const { api, domain } = await courseReview()
    await api.commitCourseImport()
    const { accountDataOwner } = await import('../src/composables/accountSyncIdentity.js')
    accountDataOwner.value = 'fictional-next-owner'
    const latest = [{ id: 'fictional-owner-b-course', name: '虚构 B 课程', day: 1, start: 'p1', end: 'p1' }]
    externalRestore('sl_courses', latest)
    api.undoLastCourseImport()
    expect(domain.courses.value).toEqual(latest)
  })

  it('没有并发变化时课程导入与撤销保持原行为', async () => {
    const { api, domain, original, incoming } = await courseReview()
    await api.commitCourseImport()
    expect(domain.courses.value).toEqual([incoming])
    api.undoLastCourseImport()
    expect(domain.courses.value).toEqual([original])
  })

  it('课程提交等待期间切走账号再切回，旧会话的确认仍应失效', async () => {
    const { api, domain, original } = await courseReview()
    const { accountDataOwner } = await import('../src/composables/accountSyncIdentity.js')
    const owner = accountDataOwner.value
    const saving = api.commitCourseImport()
    accountDataOwner.value = 'fictional-other-owner'
    accountDataOwner.value = owner
    await saving
    expect(domain.courses.value).toEqual([original])
  })

  it('作息计划打开后跨标签恢复，确认旧计划不会覆盖新作息', async () => {
    const { plan, timeConfig } = await timeReview()
    const latest = clone(timeConfig.value)
    latest.times['fictional-season']['fictional-campus'][0] = { start: '09:00', end: '09:45' }
    externalRestore('sl_timecfg', latest)
    const saving = plan.confirmImportPlan()
    await vi.advanceTimersByTimeAsync(1000)
    await saving
    expect(timeConfig.value).toMatchObject(latest)
    expect(plan.lastImportResult.value).toBeNull()
  })

  it('作息执行到保存前的等待期间收到跨页恢复，不再宣称旧导入成功', async () => {
    const { plan, timeConfig } = await timeReview()
    const saving = plan.confirmImportPlan()
    await vi.advanceTimersByTimeAsync(440)
    const latest = clone(timeConfig.value)
    latest.times['fictional-season']['fictional-campus'][0] = { start: '09:00', end: '09:45' }
    externalRestore('sl_timecfg', latest)
    await vi.advanceTimersByTimeAsync(1000)
    await saving
    expect(timeConfig.value).toMatchObject(latest)
    expect(plan.lastImportResult.value).toBeNull()
    expect(plan.importFailed.value).toBe(true)
  })

  it('作息导入后手动更新的时间不能被整份撤销回滚', async () => {
    const { plan, timeConfig } = await timeReview()
    const saving = plan.confirmImportPlan()
    await vi.advanceTimersByTimeAsync(1000)
    await saving
    timeConfig.value.times['fictional-season']['fictional-campus'][0] = { start: '10:00', end: '10:45' }
    plan.undoLastImport()
    expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '10:00', end: '10:45' })
    expect(plan.lastImportResult.value).toBeNull()
  })

  it('作息等待期间切走账号再切回，旧会话不能恢复执行', async () => {
    const { plan, timeConfig } = await timeReview()
    const { accountDataOwner } = await import('../src/composables/accountSyncIdentity.js')
    const owner = accountDataOwner.value
    const saving = plan.confirmImportPlan()
    accountDataOwner.value = 'fictional-other-owner'
    accountDataOwner.value = owner
    await vi.advanceTimersByTimeAsync(1000)
    await saving
    expect(timeConfig.value.times['fictional-season']['fictional-campus'][0]).toEqual({ start: '07:00', end: '07:45' })
    expect(plan.lastImportResult.value).toBeNull()
  })
})
