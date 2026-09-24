// @vitest-environment happy-dom
//
// 自动同步任务「注册幂等性」的守卫。
//
// 起因是一次偶发失败：autoSyncTask.test.js 里「一次同步跑完只留一条结果」偶尔报
// 「expected 2 to be 1」。根因是 registerAutoSyncTask 每次都新建一个 watch，而 watch
// 不在任务注册表里（registerTask 只按 id 覆盖表项），于是用例反复注册就叠出多个监听器，
// 一次状态跃迁被记多条。结果去重是按「id + 毫秒时间戳」做的（taskCenter 的
// recordTaskResult），只有落在同一毫秒才碰巧合并，跨毫秒就是两条 —— 所以表现成依赖
// 机器负载的偶发，全量并行跑才容易撞上。
//
// 为什么单独一个文件：这里要 spy 记录函数的**调用次数**，而次数是与时间戳无关的确定性
// 证据（断言「结果条数」会在跨毫秒时漏检，实测撤掉修复后仍然通过）。放在
// autoSyncTask.test.js 里会牵扯那个文件另外 11 条用例，所以隔离出来。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../src/composables/taskCenter.js', async (importOriginal) => {
  const actual = await importOriginal()
  // 用真实现包一层：行为不变，只是多了一个可数的调用记录。
  return { ...actual, recordTaskResult: vi.fn(actual.recordTaskResult) }
})

import { autoSyncError, autoSyncState } from '../src/composables/autoSyncCoordinator.js'
import { AUTO_SYNC_TASK_ID, registerAutoSyncTask } from '../src/composables/autoSyncTask.js'
import { recordTaskResult, resetTaskCenter, taskCenterResults } from '../src/composables/taskCenter.js'

beforeEach(() => {
  resetTaskCenter()
  autoSyncState.value = 'idle'
  autoSyncError.value = ''
  // 最后清 spy：上面几行本身可能触发上一个用例残留的监听器，
  // 那些调用属于环境噪声，不该计入本用例的断言。
  recordTaskResult.mockClear()
})

/** 走一遍「开始拉取 → 合并 → 完成」的状态跃迁。只有最后一步该记账。 */
async function runOneSync() {
  autoSyncState.value = 'pulling'
  await nextTick()
  autoSyncState.value = 'merging'
  await nextTick()
  autoSyncState.value = 'synced'
  await nextTick()
}

describe('自动同步任务的注册幂等性', () => {
  it('重复注册不会叠加监听器：一次同步只记一条结果', async () => {
    registerAutoSyncTask()
    registerAutoSyncTask()
    registerAutoSyncTask()

    await runOneSync()

    // 关键断言：调用次数。三个监听器会调三次，一个只调一次；
    // 无论这几次调用落在同一毫秒还是跨毫秒，次数都如实反映监听器数量。
    expect(recordTaskResult).toHaveBeenCalledTimes(1)
    expect(recordTaskResult.mock.calls[0][0]).toMatchObject({
      id: AUTO_SYNC_TASK_ID,
      status: 'completed',
    })
    expect(taskCenterResults.value.length).toBe(1)
  })

  it('返回的注销函数真的停掉了监听器', async () => {
    const unregister = registerAutoSyncTask()
    autoSyncState.value = 'pulling'
    await nextTick()
    unregister()
    recordTaskResult.mockClear()

    autoSyncState.value = 'synced'
    await nextTick()

    expect(recordTaskResult).not.toHaveBeenCalled()
    expect(taskCenterResults.value).toEqual([])
  })

  it('注销后再注册仍然只记一条（停止器句柄不会错位）', async () => {
    const first = registerAutoSyncTask()
    first()
    registerAutoSyncTask()

    await runOneSync()

    expect(recordTaskResult).toHaveBeenCalledTimes(1)
  })

  it('判定力自证：手工叠一个监听器就会多记，说明这条断言不是恒真', async () => {
    // 用 watch 直接模拟「泄漏的监听器」，证明上面的次数断言确实抓得住叠加。
    // 刻意和真实监听器写成同构（同样先算结果、只在有结果时记账），
    // 这样它多记的那一条就是纯粹的「泄漏」增量：一次同步 → 2 条而不是 1 条。
    // 如果哪天断言被改成只看结果条数（会被同毫秒去重掩盖），这条会先失败。
    const { watch } = await import('vue')
    const { autoSyncResultFor } = await import('../src/composables/autoSyncTask.js')
    registerAutoSyncTask()
    const stopLeaked = watch(autoSyncState, (state, previous) => {
      const result = autoSyncResultFor(previous, state, autoSyncError.value)
      if (!result) return
      recordTaskResult({ id: AUTO_SYNC_TASK_ID, title: '自动同步', ...result })
    })

    await runOneSync()

    expect(recordTaskResult).toHaveBeenCalledTimes(2)
    stopLeaked()
  })
})