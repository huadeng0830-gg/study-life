// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import {
  TASK_CENTER_LOG_LIMIT,
  cancelTask,
  clearTaskResults,
  describePartial,
  formatTaskAge,
  formatTaskElapsed,
  hasRunningTask,
  markResultsSeen,
  normalizeTaskResult,
  progressTaskSource,
  recordTaskResult,
  registerTask,
  resetTaskCenter,
  runningTaskCount,
  runningTasks,
  taskCancelHint,
  taskCanCancel,
  taskCenterAttention,
  taskCenterResults,
  taskDetailOf,
  taskMessageOf,
  taskStartedAt,
  taskStatusOf,
  unseenResultCount,
  unregisterTask,
} from '../src/composables/taskCenter.js'

/**
 * 可控的假任务源。
 * 状态放在 reactive 对象上：任务中心靠 watch 观测 source 的读取函数，
 * 非响应式的闭包变量不会被追踪（这是真实 API 契约的一部分）。
 */
function fakeSource(initial = 'idle') {
  const state = reactive({ status: initial, message: '', detail: '', canCancel: false, startedAt: 0 })
  const cancel = vi.fn(() => { state.status = 'cancelled' })
  return {
    state,
    source: {
      status: () => state.status,
      message: () => state.message,
      detail: () => state.detail,
      canCancel: () => state.canCancel,
      startedAt: () => state.startedAt,
      cancel,
    },
    set(next, { text = '', extra = '', cancellable = false, started = 0 } = {}) {
      state.status = next
      state.message = text
      state.detail = extra
      state.canCancel = cancellable
      state.startedAt = started
    },
    cancel,
  }
}

beforeEach(() => { resetTaskCenter() })
afterEach(() => { resetTaskCenter() })

describe('任务中心注册表', () => {
  it('登记后按 source 的状态出现在进行中列表', () => {
    const fake = fakeSource('running')
    fake.set('running', { text: '正在拉取云端数据', started: 1000 })
    registerTask({ id: 'sync', title: '手动同步', source: fake.source })

    expect(runningTaskCount.value).toBe(1)
    expect(hasRunningTask.value).toBe(true)
    expect(taskCenterAttention.value).toBe(true)
    const task = runningTasks.value[0]
    expect(task.id).toBe('sync')
    expect(taskStatusOf(task)).toBe('running')
    expect(taskMessageOf(task)).toBe('正在拉取云端数据')
    expect(taskStartedAt(task)).toBe(1000)
  })

  it('空闲状态的任务不占进行中列表', () => {
    const fake = fakeSource('idle')
    registerTask({ id: 'auto-sync', title: '自动同步', source: fake.source })
    expect(runningTaskCount.value).toBe(0)
    expect(taskCenterAttention.value).toBe(false)
  })

  it('缺少 id 或 source.status 时直接报错，而不是静默登记一个不会更新的任务', () => {
    expect(() => registerTask({ title: '没有 id', source: fakeSource().source })).toThrow('必须有 id')
    expect(() => registerTask({ id: 'x', title: 'x' })).toThrow('缺少 source.status')
  })

  it('重复登记同一个 id 会替换旧登记', () => {
    const first = fakeSource('running')
    registerTask({ id: 'dup', title: '旧的', source: first.source })
    const second = fakeSource('running')
    registerTask({ id: 'dup', title: '新的', source: second.source })
    expect(runningTaskCount.value).toBe(1)
    expect(runningTasks.value[0].title).toBe('新的')
  })

  it('注销之后不再计入，也不再写结果', async () => {
    const fake = fakeSource('running')
    const unregister = registerTask({ id: 'job', title: '任务', source: fake.source })
    unregister()
    fake.set('completed')
    await nextTick()
    expect(runningTaskCount.value).toBe(0)
    expect(taskCenterResults.value).toEqual([])
    expect(unregisterTask('job')).toBe(false)
  })

  it('source 抛错不会拖垮整个任务中心', () => {
    registerTask({
      id: 'broken',
      title: '坏掉的任务',
      source: {
        status: () => { throw new Error('boom') },
        message: () => { throw new Error('boom') },
      },
    })
    expect(runningTaskCount.value).toBe(0)
    expect(taskMessageOf(runningTasks.value[0] || { source: {} })).toBe('')
  })
})

describe('任务结果日志', () => {
  it('任务落到终态时自动记一笔，运行中不记', async () => {
    const fake = fakeSource('running')
    registerTask({ id: 'sync', title: '手动同步', source: fake.source })

    fake.set('running', { text: '正在推送' })
    await nextTick()
    expect(taskCenterResults.value).toEqual([])

    fake.set('completed', { text: '云端已接收新版本' })
    await nextTick()
    expect(taskCenterResults.value.length).toBe(1)
    expect(taskCenterResults.value[0]).toMatchObject({
      id: 'sync',
      title: '手动同步',
      status: 'completed',
      message: '云端已接收新版本',
    })
    expect(unseenResultCount.value).toBe(1)
  })

  it('keepResult 为 false 的任务只展示、不进日志', async () => {
    const fake = fakeSource('running')
    registerTask({ id: 'quiet', title: '只看不记', source: fake.source, keepResult: false })
    fake.set('completed')
    await nextTick()
    expect(taskCenterResults.value).toEqual([])
  })

  it('失败与取消同样会留下结论', async () => {
    const failing = fakeSource('running')
    registerTask({ id: 'fail', title: '备份', source: failing.source })
    failing.set('failed', { text: '磁盘已满' })
    await nextTick()
    const cancelled = fakeSource('running')
    registerTask({ id: 'stop', title: '恢复', source: cancelled.source })
    cancelled.set('cancelled')
    await nextTick()
    expect(taskCenterResults.value.map((item) => item.status)).toEqual(['cancelled', 'failed'])
  })

  it('新结果排在前面，并且限制条数', () => {
    for (let index = 0; index < TASK_CENTER_LOG_LIMIT + 5; index += 1) {
      recordTaskResult({ id: `t${index}`, title: `任务 ${index}`, status: 'completed', at: 1000 + index })
    }
    expect(taskCenterResults.value.length).toBe(TASK_CENTER_LOG_LIMIT)
    // 最新的在最前
    expect(taskCenterResults.value[0].id).toBe(`t${TASK_CENTER_LOG_LIMIT + 4}`)
  })

  it('同一条结果重复记录不会翻倍', () => {
    recordTaskResult({ id: 'a', title: 'A', status: 'completed', at: 500 })
    recordTaskResult({ id: 'a', title: 'A', status: 'completed', at: 500 })
    expect(taskCenterResults.value.length).toBe(1)
  })

  it('未知状态归一为已完成，脏输入有兜底', () => {
    expect(normalizeTaskResult({ status: 'weird' }).status).toBe('completed')
    expect(normalizeTaskResult(null)).toMatchObject({ id: '', title: '后台任务', message: '' })
    expect(Number.isFinite(normalizeTaskResult({}).at)).toBe(true)
  })

  it('看过之后提示清零，清空会连日志一起清', () => {
    recordTaskResult({ id: 'a', title: 'A', status: 'completed' })
    expect(unseenResultCount.value).toBe(1)
    markResultsSeen()
    expect(unseenResultCount.value).toBe(0)
    // 只有日志没有进行中任务时，入口不再需要提示
    expect(taskCenterAttention.value).toBe(false)
    clearTaskResults()
    expect(taskCenterResults.value).toEqual([])
  })
})

describe('取消语义', () => {
  it('只有「在跑且允许取消」的任务才给取消按钮', () => {
    const fake = fakeSource('running')
    registerTask({ id: 'job', title: '任务', source: fake.source })
    const task = runningTasks.value[0]
    expect(taskCanCancel(task)).toBe(false)
    expect(taskCancelHint(task)).toBe('此任务由系统自动继续，不需要手动干预')

    fake.set('running', { cancellable: true })
    expect(taskCanCancel(task)).toBe(true)
    expect(taskCancelHint(task)).toBe('')
  })

  it('不可中断的任务用自己的说明解释原因', () => {
    registerTask({
      id: 'auto-sync',
      title: '自动同步',
      source: { status: () => 'running', canCancel: () => false, cancelHint: () => '会按退避策略自动重试' },
    })
    expect(taskCancelHint(runningTasks.value[0])).toBe('会按退避策略自动重试')
  })

  it('取消会真的调到任务的 cancel', async () => {
    const fake = fakeSource('running')
    fake.set('running', { cancellable: true })
    registerTask({ id: 'job', title: '任务', source: fake.source })
    expect(await cancelTask(runningTasks.value[0])).toBe(true)
    expect(fake.cancel).toHaveBeenCalledTimes(1)
  })

  it('没在跑或没提供 cancel 时不做无效取消', async () => {
    expect(await cancelTask(undefined)).toBe(false)
    registerTask({ id: 'plain', title: '任务', source: { status: () => 'running', canCancel: () => true } })
    expect(await cancelTask(runningTasks.value[0])).toBe(false)
  })
})

describe('展示工具', () => {
  it('把 partial 压成一行细节', () => {
    expect(describePartial({ 壁纸: '2/5', 课程: 12 })).toBe('壁纸 2/5 · 课程 12')
    expect(describePartial({ 空: '', 无: null })).toBe('')
    expect(describePartial(null)).toBe('')
  })

  it('时长文案随时间推进', () => {
    expect(formatTaskElapsed(0)).toBe('')
    expect(formatTaskElapsed(1000, 1000 + 12_000)).toBe('已用 12 秒')
    expect(formatTaskElapsed(1000, 1000 + 95_000)).toBe('已用 1 分 35 秒')
    expect(formatTaskElapsed(1000, 1000 + 3 * 3600_000 + 25 * 60_000)).toBe('已用 3 小时 25 分')
    // 时钟回拨不会出现负数
    expect(formatTaskElapsed(5000, 1000)).toBe('已用 0 秒')
  })

  it('结果相对时间文案', () => {
    const now = 1_000_000_000
    expect(formatTaskAge(now, now + 5_000)).toBe('刚刚')
    expect(formatTaskAge(now, now + 5 * 60_000)).toBe('5 分钟前')
    expect(formatTaskAge(now, now + 3 * 3600_000)).toBe('3 小时前')
    expect(formatTaskAge(now, now + 2 * 86400_000)).toBe('2 天前')
    expect(formatTaskAge(0, now)).toBe('')
  })

  it('progressTaskSource 接到 useTaskProgress 的形状上', () => {
    const progress = {
      state: {
        active: true,
        status: 'running',
        latestActivity: '已处理 3/8 张壁纸',
        partial: { 壁纸: '3/8' },
        canCancel: true,
        startedAt: 42,
      },
      cancel: vi.fn(),
    }
    const source = progressTaskSource(progress)
    expect(source.status()).toBe('running')
    expect(source.message()).toBe('已处理 3/8 张壁纸')
    expect(source.detail()).toBe('壁纸 3/8')
    expect(source.canCancel()).toBe(true)
    expect(source.startedAt()).toBe(42)
    source.cancel()
    expect(progress.cancel).toHaveBeenCalled()
    // 未开始时视为空闲，而不是永远停在 running
    expect(progressTaskSource({ state: { active: false, status: 'completed' } }).status()).toBe('idle')
    expect(progressTaskSource(null).status()).toBe('idle')
  })
})