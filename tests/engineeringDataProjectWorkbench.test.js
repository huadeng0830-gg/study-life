import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useProjectTaskWorkbench } from '../src/composables/projects/useProjectTaskWorkbench.js'

describe('项目进度保存的账号与页面隔离', () => {
  it('请求响应前切换账号，不会用新账号重新加载旧项目或显示旧保存结果', async () => {
    let release
    const owner = ref({ id: 'fictional-owner-a' })
    const project = ref({ id: 'fictional-project-a', status: 'active' })
    const task = { id: 'fictional-task-a', status: 'todo', assigneeId: owner.value.id, assignmentStatus: 'accepted' }
    const loadProject = vi.fn()
    const notify = vi.fn()
    const workbench = useProjectTaskWorkbench({
      project, tasks: ref([task]), isManager: ref(false), accountUser: owner,
      actionBusy: ref(''), checkpointError: ref(''),
      projectRequest: () => new Promise((resolve) => { release = resolve }),
      loadProject, changeTaskStatus: vi.fn(), notify, describeError: (error) => error.message,
    })
    workbench.open(task)
    const pending = workbench.dialogProps.value.onSave()
    workbench.close()
    owner.value = { id: 'fictional-owner-b' }
    project.value = { id: 'fictional-project-b', status: 'active' }
    release({})
    await pending
    expect(loadProject).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(workbench.task.value).toBeNull()
  })

  it('切换任务后，旧保存错误不会进入新任务对话框', async () => {
    let reject
    const owner = ref({ id: 'fictional-owner' })
    const project = ref({ id: 'fictional-project', status: 'active' })
    const task = { id: 'fictional-task-a', status: 'todo', assigneeId: owner.value.id, assignmentStatus: 'accepted' }
    const workbench = useProjectTaskWorkbench({
      project, tasks: ref([task]), isManager: ref(true), accountUser: owner,
      actionBusy: ref(''), checkpointError: ref(''),
      projectRequest: () => new Promise((resolve, fail) => { reject = fail }),
      loadProject: vi.fn(), changeTaskStatus: vi.fn(), notify: vi.fn(), describeError: (error) => error.message,
    })
    workbench.open(task)
    const pending = workbench.dialogProps.value.onSave()
    workbench.open({ ...task, id: 'fictional-task-b' })
    reject(new Error('旧任务的错误'))
    await pending
    expect(workbench.error.value).toBe('')
    expect(workbench.task.value.id).toBe('fictional-task-b')
  })

  it('关闭后重新打开同一任务，旧保存响应不会清空新输入的草稿', async () => {
    let release
    const task = { id: 'fictional-task-a', status: 'todo', assigneeId: 'fictional-owner', assignmentStatus: 'accepted' }
    const loadProject = vi.fn()
    const workbench = useProjectTaskWorkbench({
      project: ref({ id: 'fictional-project', status: 'active' }), tasks: ref([task]),
      isManager: ref(true), accountUser: ref({ id: 'fictional-owner' }),
      actionBusy: ref(''), checkpointError: ref(''),
      projectRequest: () => new Promise((resolve) => { release = resolve }),
      loadProject, changeTaskStatus: vi.fn(), notify: vi.fn(), describeError: (error) => error.message,
    })
    workbench.open(task)
    workbench.dialogProps.value['onUpdate:field']('checkpointNextStep', '虚构已提交步骤')
    const pending = workbench.dialogProps.value.onSave()
    workbench.close()
    workbench.open(task)
    workbench.dialogProps.value['onUpdate:field']('checkpointNextStep', '重新打开后输入的虚构步骤')
    release({})
    await pending
    expect(workbench.dialogProps.value.form.checkpointNextStep).toBe('重新打开后输入的虚构步骤')
    expect(loadProject).not.toHaveBeenCalled()
  })

  it('开始执行旧任务的响应不会关闭随后打开的新任务', async () => {
    let release
    const task = { id: 'fictional-task-a', status: 'todo', assigneeId: 'fictional-owner', assignmentStatus: 'accepted' }
    const nextTask = { ...task, id: 'fictional-task-b' }
    const workbench = useProjectTaskWorkbench({
      project: ref({ id: 'fictional-project', status: 'active' }), tasks: ref([task, nextTask]),
      isManager: ref(true), accountUser: ref({ id: 'fictional-owner' }),
      actionBusy: ref(''), checkpointError: ref(''), projectRequest: vi.fn(),
      loadProject: vi.fn(), changeTaskStatus: () => new Promise((resolve) => { release = resolve }),
      notify: vi.fn(), describeError: (error) => error.message,
    })
    workbench.open(task)
    const pending = workbench.dialogProps.value.onStart()
    workbench.close()
    workbench.open(nextTask)
    workbench.dialogProps.value['onUpdate:field']('checkpointNextStep', '新任务的虚构草稿')
    release(true)
    await pending
    expect(workbench.task.value.id).toBe(nextTask.id)
    expect(workbench.dialogProps.value.form.checkpointNextStep).toBe('新任务的虚构草稿')
  })
})
