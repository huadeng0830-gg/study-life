import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useProjectTaskWorkbench } from '../src/composables/projects/useProjectTaskWorkbench.js'

function setup(task = {}) {
  const initial = { id: 'fictional-task', status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'accepted', ...task }
  const tasks = ref([initial])
  const changeTaskStatus = vi.fn(async () => true)
  const projectRequest = vi.fn(async () => ({}))
  const workbench = useProjectTaskWorkbench({
    project: ref({ id: 'fictional-project', status: 'active' }), tasks, isManager: ref(false),
    accountUser: ref({ id: 'fictional-user' }), actionBusy: ref(''), checkpointError: ref(''),
    projectRequest, loadProject: vi.fn(), changeTaskStatus, notify: vi.fn(), describeError: (error) => error.message,
  })
  workbench.open(initial)
  return { workbench, tasks, changeTaskStatus, projectRequest }
}

describe('project workbench interactions', () => {
  it('keeps dependency-blocked tasks readable and writable without allowing execution', async () => {
    const { workbench, changeTaskStatus } = setup({ dependsOnTaskId: 'fictional-prerequisite', dependencyStatus: 'todo' })
    expect(workbench.dialogProps.value.canStart).toBe(false)
    expect(workbench.dialogProps.value.canSave).toBe(true)
    await workbench.dialogProps.value.onStart()
    expect(changeTaskStatus).not.toHaveBeenCalled()
  })

  it('does not close a newly opened task after an earlier start resolves', async () => {
    const { workbench, changeTaskStatus } = setup()
    let finish
    changeTaskStatus.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const pending = workbench.dialogProps.value.onStart()
    workbench.open({ id: 'fictional-new-task', status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'accepted' })
    finish(true); await pending
    expect(workbench.task.value.id).toBe('fictional-new-task')
  })

  it('does not clear the busy state of a replacement save', async () => {
    const { workbench, projectRequest } = setup()
    const responses = []
    projectRequest.mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
    const first = workbench.dialogProps.value.onSave()
    workbench.close()
    workbench.open({ id: 'fictional-new-task', status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'accepted' })
    const second = workbench.dialogProps.value.onSave()
    responses[0]({}); await first
    expect(workbench.busy.value).toBe(true)
    responses[1]({}); await second
    expect(workbench.busy.value).toBe(false)
  })

  it('uses fresh assignment permissions after a project refresh', () => {
    const { workbench, tasks } = setup()
    tasks.value = [{ ...tasks.value[0], assigneeId: 'fictional-other' }]
    expect(workbench.dialogProps.value.canSave).toBe(false)
    expect(workbench.dialogProps.value.canStart).toBe(false)
  })

  it('locks progress inputs while saving so a returned snapshot cannot discard new typing', async () => {
    const { workbench, projectRequest } = setup()
    let finish
    projectRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    workbench.dialogProps.value['onUpdate:field']('checkpointLastStep', '虚构已记录进度')
    const pending = workbench.dialogProps.value.onSave()
    expect(workbench.dialogProps.value.readonly).toBe(true)
    workbench.dialogProps.value['onUpdate:field']('checkpointLastStep', '保存中不应改变输入')
    expect(workbench.dialogProps.value.form.checkpointLastStep).toBe('虚构已记录进度')
    finish({}); await pending
    expect(workbench.dialogProps.value.readonly).toBe(false)
  })
})
