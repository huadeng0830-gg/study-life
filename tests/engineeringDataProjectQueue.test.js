// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const projectRequest = vi.hoisted(() => vi.fn())
vi.mock('../src/services/projects.js', () => ({ projectRequest }))
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser: ref(null) }))
vi.mock('../src/composables/dataVault.js', () => ({
  mirrorLocalValue: vi.fn(), mirrorLocalValues: vi.fn(),
  clearDataVault: vi.fn(), setMirrorErrorHandler: vi.fn(), setMirrorTimingHandler: vi.fn(),
}))

let bridge
beforeEach(() => { vi.resetModules(); localStorage.clear(); projectRequest.mockReset() })
afterEach(() => { bridge?.stopProjectTaskBridge(); vi.unstubAllGlobals(); vi.clearAllTimers() })

describe('项目待办重试队列的并发变更', () => {
  it('旧请求在等待响应时，新离线待办不会被队列快照删除', async () => {
    const { accountUser } = await import('../src/composables/accountAuth.js')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    bridge = await import('../src/composables/projectTaskBridge.js')
    const domain = useDomainCommands()
    const task = bridge.ensureProjectTaskTodo({ id: 'fictional-team-new', title: '离线新增的虚构待办' }, { id: 'fictional-project' }, domain)
    const key = 'study-life-project-task-sync:fictional-user'
    localStorage.setItem(key, JSON.stringify([{ projectId: 'fictional-project', taskId: 'fictional-team-old', status: 'completed' }]))
    let release
    projectRequest.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    accountUser.value = { id: 'fictional-user' }
    bridge.startProjectTaskBridge()
    expect(projectRequest).toHaveBeenCalledOnce()
    vi.stubGlobal('navigator', { onLine: false })
    domain.updateTask(task.id, { done: true, status: 'completed' })
    await nextTick()
    expect(JSON.parse(localStorage.getItem(key))).toHaveLength(2)
    release({})
    await vi.waitFor(() => expect(bridge.useProjectTaskSyncState().value.syncing).toBe(false))
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      { projectId: 'fictional-project', taskId: 'fictional-team-new', status: 'completed' },
    ])
  })

  it('同一任务在旧完成请求等待时被重新打开，新的 todo 状态保留', async () => {
    const { accountUser } = await import('../src/composables/accountAuth.js')
    const { useDomainCommands } = await import('../src/composables/domain/commands.js')
    bridge = await import('../src/composables/projectTaskBridge.js')
    const domain = useDomainCommands()
    const task = bridge.ensureProjectTaskTodo({ id: 'fictional-team-same', title: '虚构任务', status: 'completed' }, { id: 'fictional-project' }, domain)
    const key = 'study-life-project-task-sync:fictional-user'
    localStorage.setItem(key, JSON.stringify([{ projectId: 'fictional-project', taskId: 'fictional-team-same', status: 'completed' }]))
    let release
    projectRequest.mockImplementation(() => new Promise((resolve) => { release = resolve }))
    accountUser.value = { id: 'fictional-user' }
    bridge.startProjectTaskBridge()
    vi.stubGlobal('navigator', { onLine: false })
    domain.updateTask(task.id, { done: false, status: 'pending' })
    await nextTick()
    release({})
    await vi.waitFor(() => expect(bridge.useProjectTaskSyncState().value.syncing).toBe(false))
    expect(JSON.parse(localStorage.getItem(key))).toEqual([
      { projectId: 'fictional-project', taskId: 'fictional-team-same', status: 'todo' },
    ])
  })
})
