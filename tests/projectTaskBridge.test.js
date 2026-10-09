import { shallowRef, triggerRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const projectRequest = vi.hoisted(() => vi.fn())
const accountUser = vi.hoisted(() => ({ value: null }))
const useDomainCommands = vi.hoisted(() => vi.fn())
vi.mock('../src/composables/accountAuth.js', () => ({ accountUser }))
vi.mock('../src/composables/domain/commands.js', () => ({ useDomainCommands }))
vi.mock('../src/services/projects.js', () => ({ projectRequest }))

import {
  detachProjectTaskTodos, ensureProjectTaskTodo, startProjectTaskBridge, stopProjectTaskBridge,
} from '../src/composables/projectTaskBridge.js'

function createDomain(initialTasks = []) {
  const domain = { tasks: shallowRef(initialTasks), createTask: vi.fn(), updateTask: vi.fn() }
  domain.createTask.mockImplementation((data) => {
    const task = { id: `local-${domain.tasks.value.length + 1}`, done: false, status: 'pending', ...data }
    domain.tasks.value.push(task)
    triggerRef(domain.tasks)
    return task
  })
  domain.updateTask.mockImplementation((id, data) => {
    const task = domain.tasks.value.find((item) => item.id === id)
    if (!task) return null
    Object.assign(task, data)
    triggerRef(domain.tasks)
    return task
  })
  return domain
}

describe('齐行与个人待办联动', () => {
  beforeEach(() => {
    stopProjectTaskBridge()
    accountUser.value = null
    useDomainCommands.mockReset()
    projectRequest.mockReset()
  })

  it('成员接受任务后只创建一条带项目关系的个人待办', () => {
    const domain = createDomain()
    const todo = ensureProjectTaskTodo({ id: 'team-1', title: '整理资料', dueOn: '2026-10-20', priority: 'urgent', description: '整理并归档' }, { id: 'project-1' }, domain)

    expect(domain.createTask).toHaveBeenCalledOnce()
    expect(todo).toMatchObject({
      title: '整理资料', dueDate: '2026-10-20', priority: 'high', note: '整理并归档',
      sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1',
    })
    expect(ensureProjectTaskTodo({ id: 'team-1', title: '整理资料' }, { id: 'project-1' }, domain).id).toBe(todo.id)
    expect(domain.createTask).toHaveBeenCalledOnce()
  })

  it('不在每次刷新时重写相同待办，变更时只更新共享字段', () => {
    const domain = createDomain([{ id: 'local-1', title: '整理资料', dueDate: '2026-10-20', priority: 'high', note: '整理并归档', done: false, status: 'pending', completedAt: null, sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1' }])
    ensureProjectTaskTodo({ id: 'team-1', title: '整理资料', dueOn: '2026-10-20', priority: 'urgent', description: '整理并归档' }, { id: 'project-1' }, domain)
    expect(domain.updateTask).not.toHaveBeenCalled()

    ensureProjectTaskTodo({ id: 'team-1', title: '整理资料并提交', dueOn: '2026-10-22', priority: 'urgent', description: '更新后的要求' }, { id: 'project-1' }, domain)
    expect(domain.updateTask).toHaveBeenCalledWith('local-1', expect.objectContaining({
      title: '整理资料并提交', dueDate: '2026-10-22', note: '更新后的要求', priority: 'high',
    }))
  })

  it('把齐行保存的断点同步到唯一个人待办，并保留结构相同的进度', () => {
    const checkpoint = {
      lastStep: '完成数据整理', blocker: '', nextStep: '导出图表',
      resources: ['https://example.com/report'], updatedAt: '2026-10-09T02:00:00.000Z',
    }
    const domain = createDomain([{ id: 'local-1', title: '写报告', done: false, status: 'pending', sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1' }])
    const serverTask = { id: 'team-1', title: '写报告', status: 'in_progress', assignmentStatus: 'accepted', assigneeId: 'user-1', workCheckpoint: checkpoint }

    ensureProjectTaskTodo(serverTask, { id: 'project-1' }, domain)
    expect(domain.tasks.value[0].workCheckpoint).toEqual(checkpoint)
    expect(domain.updateTask).toHaveBeenCalledOnce()

    ensureProjectTaskTodo({ ...serverTask, workCheckpoint: structuredClone(checkpoint) }, { id: 'project-1' }, domain)
    expect(domain.updateTask).toHaveBeenCalledOnce()
  })

  it('在服务端还没有断点记录时不覆盖已有的本机进度', () => {
    const localCheckpoint = { lastStep: '本机旧进度', nextStep: '继续本机记录', resources: [] }
    const domain = createDomain([{ id: 'local-1', title: '写报告', workCheckpoint: localCheckpoint, done: false, status: 'pending', sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1' }])
    ensureProjectTaskTodo({ id: 'team-1', title: '写报告', status: 'todo', assignmentStatus: 'accepted', assigneeId: 'user-1' }, { id: 'project-1' }, domain)

    expect(domain.tasks.value[0].workCheckpoint).toEqual(localCheckpoint)
    expect(domain.updateTask.mock.calls[0]?.[1]).not.toHaveProperty('workCheckpoint')
  })

  it('成员退出或分工转交后保留个人记录并解除团队关联', () => {
    const domain = createDomain([{ id: 'local-1', title: '写报告', note: '成员自己的补充', done: true, sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1' }])
    expect(detachProjectTaskTodos('project-1', [], domain)).toBe(1)
    expect(domain.tasks.value[0]).toMatchObject({ title: '写报告', note: '成员自己的补充', done: true, sourceType: '', sourceId: '', relationId: '' })
    expect(detachProjectTaskTodos('project-1', [], domain)).toBe(0)
  })

  it('服务端拒绝不符合依赖条件的个人待办变更后恢复团队任务状态', async () => {
    const localTask = {
      id: 'local-1', title: '完成前置工作', done: false, status: 'pending',
      sourceType: 'project-task', sourceId: 'team-1', relationId: 'project-1',
    }
    const domain = createDomain([localTask])
    useDomainCommands.mockReturnValue(domain)
    accountUser.value = { id: 'user-1' }
    projectRequest.mockImplementation(async (action) => {
      if (action === 'task_personal_sync') throw Object.assign(new Error('dependency blocked'), { status: 409 })
      if (action === 'detail') return {
        project: { id: 'project-1' },
        tasks: [{ id: 'team-1', title: '完成前置工作', status: 'todo', assignmentStatus: 'accepted', assigneeId: 'user-1' }],
      }
      return {}
    })

    startProjectTaskBridge()
    try {
      domain.updateTask('local-1', { done: true, status: 'completed' })
      await vi.waitFor(() => expect(projectRequest).toHaveBeenCalledWith('detail', { projectId: 'project-1' }))
      expect(localTask).toMatchObject({ done: false, status: 'pending' })
    } finally {
      stopProjectTaskBridge()
      accountUser.value = null
    }
  })
})
