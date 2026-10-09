// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const mocks = vi.hoisted(() => ({
  getCheckpoint: vi.fn(), saveCheckpoint: vi.fn(), clearCheckpoint: vi.fn(),
  restoreValues: vi.fn(), wallpapers: vi.fn(), wallpaperUndo: vi.fn(), restoreWallpaperUndo: vi.fn(),
  importWallpapers: vi.fn(), listWallpapers: vi.fn(), restoreWallpapers: vi.fn(), discardUndo: vi.fn(),
}))
vi.mock('../src/composables/store', async () => {
  const { ref } = await import('vue')
  return { useStoredRef: (_key, initial) => ref(initial), flushStoredWrites: vi.fn(), restoreStoredValues: mocks.restoreValues }
})
vi.mock('../src/composables/timeContext.js', () => ({ getAppToday: () => '2026-10-09', getAppTime: () => '12:30' }))
vi.mock('../src/composables/settingsPolicy.js', async () => {
  const { ref } = await import('vue')
  return { settingsPolicy: ref({ timezone: 'Asia/Shanghai' }), cachedDateFormatter: (timezone, options) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, ...options }) }
})
vi.mock('../src/composables/dataVault.js', () => ({ getRestoreCheckpoint: mocks.getCheckpoint, saveRestoreCheckpoint: mocks.saveCheckpoint, clearRestoreCheckpoint: mocks.clearCheckpoint }))
vi.mock('../src/composables/wallpaperStorage.js', () => ({
  exportWallpapersForTransfer: mocks.wallpapers, backupWallpapersForUndo: mocks.wallpaperUndo,
  discardWallpaperUndo: mocks.discardUndo, importWallpapersFromTransfer: mocks.importWallpapers,
  listWallpapers: mocks.listWallpapers, restoreWallpaperUndo: mocks.restoreWallpaperUndo, restoreWallpapersSnapshot: mocks.restoreWallpapers,
}))

let manager
let feedback
let scope
let savedCheckpoint
let downloads
function fileEvent(file) { return { target: { files: [file], value: 'selected' } } }
function backupFile(name, data = {}) {
  return { name, size: 100, text: async () => JSON.stringify({ app: 'study-life', version: 1, data: { courses: [], countdowns: [], ...data } }) }
}
function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  savedCheckpoint = null
  downloads = []
  mocks.getCheckpoint.mockImplementation(async () => savedCheckpoint)
  mocks.saveCheckpoint.mockImplementation(async (value) => { savedCheckpoint = value })
  mocks.clearCheckpoint.mockImplementation(async () => { savedCheckpoint = null })
  mocks.restoreValues.mockImplementation(async (values) => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)) })
  mocks.wallpapers.mockResolvedValue({})
  mocks.listWallpapers.mockResolvedValue({})
  mocks.wallpaperUndo.mockResolvedValue(undefined)
  mocks.restoreWallpaperUndo.mockResolvedValue(undefined)
  mocks.importWallpapers.mockResolvedValue(undefined)
  mocks.restoreWallpapers.mockResolvedValue(undefined)
  mocks.discardUndo.mockResolvedValue(undefined)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional-backup')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download) })
  const { useDataManagerBackup } = await import('../src/composables/dataManagerBackup.js')
  feedback = await import('../src/composables/dataManagerFeedback.js')
  scope = effectScope()
  manager = scope.run(useDataManagerBackup)
})
afterEach(() => {
  manager.abortBackup()
  manager.backupProgress.dispose()
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('备份文件读取与导出', () => {
  it('快速换文件后只接受最后选择的结果，并显示正在检查状态', async () => {
    const oldRead = deferred()
    const old = manager.selectFile(fileEvent({ ...backupFile('old.json'), text: () => oldRead.promise }))
    expect(manager.fileChecking.value).toBe(true)
    await manager.selectFile(fileEvent(backupFile('new.json', { tasks: [{ id: 'fiction-new' }] })))
    oldRead.resolve(JSON.stringify({ app: 'study-life', version: 1, data: { courses: [{ id: 'fiction-old' }], countdowns: [] } }))
    await old
    expect(manager.selectedName.value).toBe('new.json')
    expect(manager.selectedBackup.value.data.tasks[0].id).toBe('fiction-new')
    expect(manager.fileChecking.value).toBe(false)
  })

  it('取消选择会丢弃尚未完成的检查；旧文件失败也不会污染新文件', async () => {
    const read = deferred()
    const pending = manager.selectFile(fileEvent({ ...backupFile('pending.json'), text: () => read.promise }))
    manager.clearSelectedBackup()
    read.reject(new Error('old read failed'))
    await pending
    expect(manager.summary.value).toBeNull()
    expect(feedback.restoreError.value).toBe('')
    expect(manager.fileChecking.value).toBe(false)
  })

  it('损坏 JSON 和超大文件提供中文提示，超大文件不读入内存', async () => {
    await manager.selectFile(fileEvent({ ...backupFile('invalid.json'), text: async () => '{invalid' }))
    expect(feedback.restoreError.value).toContain('不是有效的 JSON')
    const text = vi.fn()
    await manager.selectFile(fileEvent({ name: 'oversized.json', size: 101 * 1024 * 1024, text }))
    expect(text).not.toHaveBeenCalled()
    expect(feedback.restoreError.value).toContain('超过 100 MB')
  })

  it('连点导出只生成一个文件，壁纸失败仍提供文字备份并明确提示', async () => {
    const wallpaperRead = deferred()
    mocks.wallpapers.mockReturnValue(wallpaperRead.promise)
    manager.includeWallpapers.value = true
    const pending = manager.exportBackup()
    await manager.exportBackup()
    expect(manager.backupBusy.value).toBe(true)
    expect(mocks.wallpapers).toHaveBeenCalledTimes(1)
    wallpaperRead.reject(new Error('fiction-image-failure'))
    await pending
    expect(downloads).toHaveLength(1)
    expect(feedback.backupError.value).toBe('')
    expect(feedback.backupWarning.value).toContain('仅包含文字数据与设置')
    expect(manager.backupBusy.value).toBe(false)
  })

  it('文件生成失败会释放忙碌状态，允许再次导出', async () => {
    URL.createObjectURL.mockImplementationOnce(() => { throw new Error('download unavailable') })
    await manager.exportBackup()
    expect(feedback.backupError.value).toContain('download unavailable')
    expect(manager.backupBusy.value).toBe(false)
    expect(downloads).toHaveLength(0)
    await manager.exportBackup()
    expect(downloads).toHaveLength(1)
    expect(feedback.backupError.value).toBe('')
  })

  it('取消导出后即使壁纸晚到也不下载，进度不会宣称有可用结果', async () => {
    const wallpaperRead = deferred()
    mocks.wallpapers.mockReturnValue(wallpaperRead.promise)
    manager.includeWallpapers.value = true
    const pending = manager.exportBackup()
    await manager.cancelBackup()
    wallpaperRead.resolve({})
    await pending
    expect(downloads).toHaveLength(0)
    expect(manager.backupProgress.state.status).toBe('cancelled')
    expect(manager.backupProgress.state.retainedResult).toBe(false)
  })
})

describe('本机恢复点与恢复保护', () => {
  it('读取恢复点失败与没有恢复点分开反馈，可重试恢复', async () => {
    mocks.getCheckpoint.mockRejectedValueOnce(new Error('vault denied'))
    await manager.refreshRestoreCheckpoint()
    expect(manager.restoreCheckpointError.value).toContain('暂时无法读取')
    expect(manager.restoreCheckpointLoading.value).toBe(false)
    await manager.refreshRestoreCheckpoint()
    expect(manager.restoreCheckpointError.value).toBe('')
    expect(manager.restoreCheckpoint.value).toBeNull()
  })

  it('保存恢复点失败时不会覆盖数据，也不会重复启动恢复', async () => {
    const saving = deferred()
    mocks.saveCheckpoint.mockReturnValue(saving.promise)
    await manager.selectFile(fileEvent(backupFile('selected.json', { tasks: [{ id: 'fiction-task' }] })))
    manager.restoreSelection.value = ['tasks']
    manager.restoreBackup()
    const pending = manager.applyRestoreBackup()
    await vi.waitFor(() => expect(mocks.saveCheckpoint).toHaveBeenCalledTimes(1))
    await manager.applyRestoreCheckpoint()
    await manager.exportBackup()
    saving.reject(new Error('checkpoint unavailable'))
    await pending
    expect(mocks.restoreValues).not.toHaveBeenCalled()
    expect(manager.restoring.value).toBe(false)
    expect(feedback.restoreError.value).toContain('当前数据未被替换')
  })

  it('首次导入后撤回可恢复原先为空的记录和配置，未覆盖的字段保持原样', async () => {
    localStorage.setItem('sl_events', '[{"id":"fiction-local-event"}]')
    await manager.selectFile(fileEvent(backupFile('selected.json', { tasks: [{ id: 'fiction-task' }], ledgerBudget: { monthly: 123 } })))
    manager.restoreSelection.value = ['tasks', 'ledger']
    manager.restoreBackup()
    await manager.applyRestoreBackup()
    expect(savedCheckpoint.storedValues).toEqual({ sl_tasks: [], sl_ledger_budget: null })
    expect(savedCheckpoint.backup.providedFields).toEqual(['tasks', 'ledgerBudget'])
    // 模拟重新载入后重新打开数据管理。
    manager.restoring.value = false
    await manager.applyRestoreCheckpoint()
    expect(JSON.parse(localStorage.getItem('sl_tasks'))).toEqual([])
    expect(localStorage.getItem('sl_ledger_budget')).toBe('null')
    expect(JSON.parse(localStorage.getItem('sl_events'))).toEqual([{ id: 'fiction-local-event' }])
    expect(savedCheckpoint.storedValues.sl_tasks).toEqual([{ id: 'fiction-task' }])
  })

  it('自动回滚失败时保留恢复前副本，给出可操作的恢复点提示', async () => {
    mocks.restoreValues.mockRejectedValueOnce(Object.assign(new Error('fiction-write-failure'), { rollbackFailed: true }))
    localStorage.setItem('sl_tasks', '[{"id":"fiction-original"}]')
    await manager.selectFile(fileEvent(backupFile('selected.json', { tasks: [] })))
    manager.restoreSelection.value = ['tasks']
    manager.restoreBackup()
    await manager.applyRestoreBackup()
    expect(savedCheckpoint.storedValues.sl_tasks).toEqual([{ id: 'fiction-original' }])
    expect(mocks.clearCheckpoint).not.toHaveBeenCalled()
    expect(feedback.restoreError.value).toContain('自动回滚未完成')
    expect(manager.restoring.value).toBe(false)
  })
})
