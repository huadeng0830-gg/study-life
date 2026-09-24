/**
 * 把「自动同步」接入任务中心。
 *
 * 自动同步本来就是后台跑的（不依赖任何面板是否打开），但此前只有打开
 * 数据管理面板才看得见。接进任务中心之后，用户在任何页面都知道它还在跑，
 * 跑完也能在结果日志里看到结论。
 */
import { watch } from 'vue'
import {
  autoSyncError,
  autoSyncPendingCount,
  autoSyncState,
} from './autoSyncCoordinator.js'
import { recordTaskResult, registerTask } from './taskCenter.js'

export const AUTO_SYNC_TASK_ID = 'auto-sync'

/** 自动同步里真正「在跑」的阶段。 */
export const AUTO_SYNC_WORKING_STATES = Object.freeze(['checking', 'pulling', 'merging', 'pushing'])

const WORKING_MESSAGES = Object.freeze({
  checking: '正在检查云端版本',
  pulling: '正在拉取云端数据',
  merging: '正在合并两边改动',
  pushing: '正在推送本机改动',
})

/**
 * 自动同步从「在跑」落到某个静止状态时该记一笔什么结果。
 * 不需要记账（仍在跑，或没跑过）返回 null。
 */
export function autoSyncResultFor(previous, state, error = '') {
  if (!AUTO_SYNC_WORKING_STATES.includes(previous)) return null
  if (AUTO_SYNC_WORKING_STATES.includes(state)) return null
  if (state === 'synced' || state === 'idle' || state === 'dirty') {
    return { status: 'completed', message: '云端与本机已经一致' }
  }
  if (state === 'conflict') {
    return { status: 'warning', message: '存在冲突，需要你选择保留哪一边' }
  }
  if (state === 'offline' || state === 'retrying') {
    return { status: 'warning', message: '当前离线，恢复联网后会自动重试' }
  }
  return { status: 'failed', message: error || '云同步没有完成' }
}

export function autoSyncTaskSource() {
  return {
    status: () => (AUTO_SYNC_WORKING_STATES.includes(autoSyncState.value) ? 'running' : 'idle'),
    message: () => WORKING_MESSAGES[autoSyncState.value] || '正在自动同步',
    detail: () => {
      const pending = autoSyncPendingCount.value
      return pending ? `本机有 ${pending} 处待同步改动` : ''
    },
    // 自动同步由协调器自己管理重试与退避，不在这里提供取消
    canCancel: () => false,
    cancelHint: () => '自动同步由后台协调器管理，会按退避策略自动重试',
    cancel: () => {},
  }
}

// 上一次注册留下的 watch 停止器。
//
// 为什么需要它：registerTask 会按 id 覆盖注册表里的任务项，但下面这个 watch 不在
// 注册表里——重复调用本函数会叠出多个监听器，于是**一次**同步的状态跃迁会被记成
// 多条结果。结果去重是按「id + 毫秒时间戳」做的（taskCenter 的 recordTaskResult），
// 只有落在同一毫秒才碰巧合并，跨毫秒就是两条，表现为偶发、依赖机器负载。
//
// 应用里只在启动时注册一次，所以正常路径踩不到；但这是很容易踩的坑，
// 索性做成幂等：重复注册不会叠加监听器。
let stopPreviousWatch = null

/** 注册自动同步任务；返回注销函数。重复注册是幂等的，不会叠加监听器。 */
export function registerAutoSyncTask() {
  stopPreviousWatch?.()
  const unregisterTask = registerTask({
    id: AUTO_SYNC_TASK_ID,
    title: '自动同步',
    description: '在后台进行，可以放心离开这个页面，完成后会记在结果里。',
    source: autoSyncTaskSource(),
    // 结果由下面的状态跃迁显式记录：自动同步的静止状态是 synced/error，
    // 直接交给通用监听会把「一直停在 synced」误记成反复完成。
    keepResult: false,
  })
  const stopWatch = watch(autoSyncState, (state, previous) => {
    const result = autoSyncResultFor(previous, state, autoSyncError.value)
    if (!result) return
    recordTaskResult({ id: AUTO_SYNC_TASK_ID, title: '自动同步', ...result })
  })
  stopPreviousWatch = stopWatch
  return () => {
    stopWatch()
    if (stopPreviousWatch === stopWatch) stopPreviousWatch = null
    unregisterTask()
  }
}