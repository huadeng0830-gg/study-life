// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { autoSyncError, autoSyncState } from '../src/composables/autoSyncCoordinator.js'
import {
  AUTO_SYNC_TASK_ID,
  AUTO_SYNC_WORKING_STATES,
  autoSyncResultFor,
  autoSyncTaskSource,
  registerAutoSyncTask,
} from '../src/composables/autoSyncTask.js'
import {
  resetTaskCenter,
  runningTaskCount,
  runningTasks,
  taskCancelHint,
  taskCenterResults,
  taskMessageOf,
} from '../src/composables/taskCenter.js'

beforeEach(() => {
  resetTaskCenter()
  autoSyncState.value = 'idle'
  autoSyncError.value = ''
})

afterEach(() => {
  resetTaskCenter()
  autoSyncState.value = 'disabled'
  autoSyncError.value = ''
})

describe('自动同步的阶段划分', () => {
  it('只有真正在传输的状态算「进行中」', () => {
    expect([...AUTO_SYNC_WORKING_STATES].sort()).toEqual(['checking', 'merging', 'pulling', 'pushing'])
  })

  it('空闲、冲突、离线等静止状态都不算进行中', () => {
    for (const state of ['disabled', 'idle', 'dirty', 'conflict', 'synced', 'offline', 'error']) {
      autoSyncState.value = state
      expect(autoSyncTaskSource().status()).toBe('idle')
    }
  })
})

describe('autoSyncResultFor', () => {
  it('没跑过就不记账', () => {
    expect(autoSyncResultFor('idle', 'pulling')).toBeNull()
    expect(autoSyncResultFor('synced', 'pushing')).toBeNull()
  })

  it('还在传输阶段之间切换不记账', () => {
    expect(autoSyncResultFor('checking', 'pulling')).toBeNull()
    expect(autoSyncResultFor('pulling', 'merging')).toBeNull()
    expect(autoSyncResultFor('merging', 'pushing')).toBeNull()
  })

  it('跑完落到一致状态记成已完成', () => {
    for (const state of ['synced', 'idle', 'dirty']) {
      expect(autoSyncResultFor('pushing', state)).toMatchObject({ status: 'completed' })
    }
  })

  it('冲突、离线、重试记成需要留意的提示', () => {
    expect(autoSyncResultFor('merging', 'conflict')).toMatchObject({ status: 'warning' })
    expect(autoSyncResultFor('checking', 'offline')).toMatchObject({ status: 'warning' })
    expect(autoSyncResultFor('pulling', 'retrying')).toMatchObject({ status: 'warning' })
  })

  it('其它静止状态记成失败，并带上协调器给出的原因', () => {
    expect(autoSyncResultFor('pushing', 'error', '云端拒绝了这次写入'))
      .toEqual({ status: 'failed', message: '云端拒绝了这次写入' })
    expect(autoSyncResultFor('pushing', 'error')).toMatchObject({ status: 'failed', message: '云同步没有完成' })
    expect(autoSyncResultFor('pulling', 'credential-invalid')).toMatchObject({ status: 'failed' })
  })
})

describe('自动同步接入任务中心', () => {
  it('同步进行时出现在进行中列表，并说明为什么不能取消', () => {
    autoSyncState.value = 'pulling'
    registerAutoSyncTask()
    expect(runningTaskCount.value).toBe(1)
    const task = runningTasks.value[0]
    expect(task.id).toBe(AUTO_SYNC_TASK_ID)
    expect(task.title).toBe('自动同步')
    expect(taskMessageOf(task)).toBe('正在拉取云端数据')
    expect(taskCancelHint(task)).toContain('自动重试')
  })

  it('一次同步跑完只留一条结果，不会因为停在 synced 反复记账', async () => {
    registerAutoSyncTask()
    autoSyncState.value = 'pulling'
    await nextTick()
    expect(taskCenterResults.value).toEqual([])

    autoSyncState.value = 'merging'
    await nextTick()
    autoSyncState.value = 'synced'
    await nextTick()
    expect(taskCenterResults.value.length).toBe(1)
    expect(taskCenterResults.value[0]).toMatchObject({ id: AUTO_SYNC_TASK_ID, status: 'completed' })

    // 停在 synced 不再产生新记录
    await nextTick()
    expect(taskCenterResults.value.length).toBe(1)
  })

  it('同步失败会把原因写进结果', async () => {
    registerAutoSyncTask()
    autoSyncState.value = 'pushing'
    await nextTick()
    autoSyncError.value = '云端版本已被其它设备更新'
    autoSyncState.value = 'error'
    await nextTick()
    expect(taskCenterResults.value[0]).toMatchObject({
      status: 'failed',
      message: '云端版本已被其它设备更新',
    })
  })

  it('注销后不再计入进行中', () => {
    autoSyncState.value = 'checking'
    const unregister = registerAutoSyncTask()
    expect(runningTaskCount.value).toBe(1)
    unregister()
    expect(runningTaskCount.value).toBe(0)
  })
})