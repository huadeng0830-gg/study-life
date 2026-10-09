import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  isArchived: (task) => task?.status === 'archived',
  taskStatus: (task) => task?.status || 'pending',
}))
vi.mock('../src/composables/domain/state.js', () => state)

import { useTaskWorkSession } from '../src/composables/tasks/useTaskWorkSession.js'

function createSession() {
  const domain = { updateTask: vi.fn() }
  const openProjectTask = vi.fn()
  const notify = vi.fn()
  return { session: useTaskWorkSession({ domain, openProjectTask, notify }), domain, openProjectTask, notify }
}

describe('个人待办续接流程', () => {
  it('loads prior work, saves to the existing task, and closes after a successful save', () => {
    const { session, domain, notify } = createSession()
    const task = { id: 'task-1', title: '写报告', status: 'pending', workCheckpoint: { lastStep: '整理数据', nextStep: '导出图表', resources: ['https://example.com'] } }
    session.open(task)
    expect(session.draft.value).toMatchObject({ checkpointLastStep: '整理数据', checkpointNextStep: '导出图表', checkpointResources: 'https://example.com' })

    session.updateField('checkpointNextStep', '检查图表')
    session.save()

    expect(domain.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      workCheckpoint: expect.objectContaining({ lastStep: '整理数据', nextStep: '检查图表', resources: ['https://example.com/'] }),
    }))
    expect(session.task.value).toBeNull()
    expect(notify).toHaveBeenCalledWith('进度已保存，下次打开任务可以继续。', { type: 'success' })
  })

  it('marks a task in progress and routes project tasks into Qixing', () => {
    const { session, domain, openProjectTask } = createSession()
    const task = { id: 'task-2', status: 'pending' }
    session.open(task)
    session.start()
    expect(domain.updateTask).toHaveBeenCalledWith('task-2', { status: 'in_progress', done: false, completedAt: null })
    expect(session.task.value).toBeNull()

    const projectTask = { id: 'team-task', sourceType: 'project-task', relationId: 'project-1' }
    session.open(projectTask)
    expect(openProjectTask).toHaveBeenCalledWith(projectTask)
    expect(session.task.value).toBeNull()
  })

  it('keeps the workbench open and preserves prior progress when a resource link is invalid', () => {
    const { session, domain } = createSession()
    const task = { id: 'task-3', workCheckpoint: { lastStep: '先前记录' } }
    session.open(task)
    session.updateField('checkpointResources', 'javascript:alert(1)')
    session.save()
    expect(session.task.value).toMatchObject({ id: 'task-3', workCheckpoint: { lastStep: '先前记录' } })
    expect(session.error.value).toContain('公开的 HTTP 或 HTTPS')
    expect(domain.updateTask).not.toHaveBeenCalled()
  })
})
