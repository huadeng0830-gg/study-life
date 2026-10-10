// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stubs = vi.hoisted(() => ({ user: null, request: vi.fn(), meetingSync: vi.fn(), ensureTodo: vi.fn(), upload: vi.fn(), setTodoStatus: vi.fn(), detachTodos: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  stubs.user = ref(null)
  return { accountUser: stubs.user, accountOpen: ref(false) }
})
vi.mock('../src/services/social.js', () => ({ socialRequest: vi.fn(async () => ({ profile: { timezone: 'Asia/Shanghai' } })) }))
vi.mock('../src/services/projects.js', async (importOriginal) => ({ ...(await importOriginal()), projectRequest: stubs.request, uploadProjectDeliverableFile: stubs.upload }))
vi.mock('../src/composables/projectMeetingBridge.js', () => ({ syncProjectMeetingEvents: stubs.meetingSync, detachProjectMeetingEvents: vi.fn() }))
vi.mock('../src/composables/projectTaskBridge.js', async (importOriginal) => ({ ...(await importOriginal()), ensureProjectTaskTodo: stubs.ensureTodo, setProjectTaskTodoStatus: stubs.setTodoStatus, detachProjectTaskTodos: stubs.detachTodos }))
import ProjectsView from '../src/views/ProjectsView.vue'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'

let app, host
const EMPTY_INBOX = { invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [] }
const PROJECT = { id: 'fictional-project', name: '虚构旧账号项目', status: 'active', role: 'owner' }
const OTHER_PROJECT = { ...PROJECT, id: 'fictional-project-b', name: '虚构第二项目' }
async function flush() {
  for (let i = 0; i < 16; i++) { await Promise.resolve(); await nextTick() }
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function clickButton(label, root = host) {
  const button = [...root.querySelectorAll('button')].find((item) => (item.querySelector('.action-label')?.textContent || item.textContent).trim() === label)
  expect(button, label).toBeTruthy(); button.click()
}
async function selectOtherProject(item = OTHER_PROJECT) {
  const button = [...host.querySelectorAll('.project-list-item')].find((entry) => entry.textContent.includes(item.name))
  expect(button).toBeTruthy(); button.click(); await flush()
  await vi.waitFor(() => expect(host.querySelector('.project-title-line h2')?.textContent).toBe(item.name), { interval: 10 })
}
function twoProjectResponses(action, payload) {
  const item = payload?.projectId === OTHER_PROJECT.id ? OTHER_PROJECT : PROJECT
  if (action === 'list') return Promise.resolve({ projects: [PROJECT, OTHER_PROJECT] })
  if (action === 'inbox') return Promise.resolve({ ...EMPTY_INBOX })
  if (action === 'detail') return Promise.resolve({ project: item, members: [], tasks: [{ id: `${item.id}-task`, title: '虚构分工', status: 'todo', assigneeId: 'fictional-account-a', assignmentStatus: 'pending' }], milestones: [], deliveryChecks: [], activities: [] })
  return Promise.resolve({ requests: [], deliverables: [], meetings: [], items: [] })
}
function acceptedTaskResponse(action, payload) {
  return twoProjectResponses(action, payload).then((result) => {
    if (action === 'detail') result.tasks = result.tasks.map((task) => ({ ...task, assignmentStatus: 'accepted', assigneeId: 'fictional-member' }))
    return result
  })
}
function deliverableResponse(action, payload) {
  return twoProjectResponses(action, payload).then((result) => {
    if (action === 'deliverables') result.deliverables = [{ id: `${payload.projectId}-deliverable`, title: '虚构成果', required: true, reviewRequired: true }]
    return result
  })
}
async function openDeliverableEditor() {
  const tab = [...host.querySelectorAll('.project-tabs button')].find((entry) => entry.textContent.startsWith('成果'))
  expect(tab).toBeTruthy(); tab.click(); await flush()
  clickButton('提交成果'); await flush()
  return document.querySelector('.overlay input[type="file"]')
}
async function pickFile(input) {
  expect(input).toBeTruthy()
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fictional fixture'], 'fictional.txt', { type: 'text/plain' })] })
  input.dispatchEvent(new Event('change', { bubbles: true })); await flush()
}
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects', component: { template: '<div />' } }] })
  await router.push('/projects'); await router.isReady()
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(ProjectsView); app.use(router); app.mount(host); await flush()
}
beforeEach(() => {
  stubs.user.value = { id: 'fictional-account-a', email_confirmed_at: '2026-01-01' }
  stubs.meetingSync.mockClear(); stubs.ensureTodo.mockClear()
  stubs.upload.mockReset(); stubs.setTodoStatus.mockClear(); stubs.detachTodos.mockClear()
  stubs.request.mockReset().mockImplementation(async (action) => {
    if (action === 'list') return { projects: [] }
    if (action === 'inbox') return { ...EMPTY_INBOX }
    if (action === 'detail') return { project: PROJECT, members: [], tasks: [], milestones: [], deliveryChecks: [], activities: [] }
    return { requests: [], deliverables: [], meetings: [], items: [] }
  })
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('engineering audit: project account lifecycle', () => {
  it('starts a fresh list request for a replacement account and ignores the old list', async () => {
    let resolveOld
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => action === 'list' && stubs.user.value.id === 'fictional-account-a'
      ? new Promise((resolve) => { resolveOld = resolve }) : base(action, payload))
    await mount()
    expect(resolveOld).toBeTypeOf('function')
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }; await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'list')).toHaveLength(2)
    resolveOld({ projects: [PROJECT] }); await flush()
    expect(host.textContent).not.toContain(PROJECT.name)
  })

  it('never syncs a project detail that resolves after logout', async () => {
    let resolveDetail
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'list') return Promise.resolve({ projects: [PROJECT] })
      if (action === 'detail') return new Promise((resolve) => { resolveDetail = resolve })
      return base(action, payload)
    })
    await mount()
    expect(resolveDetail).toBeTypeOf('function')
    stubs.user.value = null; await flush()
    resolveDetail({ project: PROJECT, members: [], tasks: [], milestones: [], deliveryChecks: [] }); await flush()
    expect(stubs.meetingSync).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain(PROJECT.name)
  })

  it('closes a private project draft on account replacement', async () => {
    await mount()
    const create = [...host.querySelectorAll('button')].find((button) => button.textContent.trim() === '新建项目')
    expect(create).toBeTruthy(); create.click(); await flush()
    expect(document.querySelector('.overlay')).toBeTruthy()
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }; await flush()
    expect(document.querySelector('.overlay')).toBeNull()
  })

  it('never bridges a task acceptance that resolves for a replaced account', async () => {
    let resolveAcceptance
    const task = { id: 'fictional-task', title: '虚构私有分工', status: 'pending', assigneeId: 'fictional-account-a', assignmentStatus: 'pending' }
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'list') return Promise.resolve({ projects: stubs.user.value.id === 'fictional-account-a' ? [PROJECT] : [] })
      if (action === 'detail') return Promise.resolve({ project: PROJECT, members: [], tasks: [task], milestones: [], deliveryChecks: [], activities: [] })
      if (action === 'task_respond') return new Promise((resolve) => { resolveAcceptance = resolve })
      return base(action, payload)
    })
    await mount()
    const accept = [...host.querySelectorAll('button')].find((button) => button.textContent.trim() === '接受分工')
    expect(accept).toBeTruthy(); accept.click(); await flush()
    expect(resolveAcceptance).toBeTypeOf('function')
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }; await flush()
    resolveAcceptance({ assignmentStatus: 'accepted' }); await flush()
    expect(stubs.ensureTodo).not.toHaveBeenCalled()
  })

  it('discards private progress records fetched for a replaced account', async () => {
    let resolveEvents
    const task = { id: 'fictional-task', title: '虚构私有分工', status: 'pending', assignmentStatus: 'unassigned' }
    const base = stubs.request.getMockImplementation()
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'list') return Promise.resolve({ projects: stubs.user.value.id === 'fictional-account-a' ? [PROJECT] : [] })
      if (action === 'detail') return Promise.resolve({ project: PROJECT, members: [], tasks: [task], milestones: [], deliveryChecks: [], activities: [] })
      if (action === 'task_events') return new Promise((resolve) => { resolveEvents = resolve })
      return base(action, payload)
    })
    await mount()
    const progress = host.querySelector('[aria-label="查看“虚构私有分工”的进展记录"]')
    expect(progress).toBeTruthy(); progress.click(); await flush()
    stubs.user.value = { id: 'fictional-account-b', email_confirmed_at: '2026-01-01' }; await flush()
    resolveEvents({ events: [{ id: 'fictional-event', summary: '虚构旧账号私有记录', createdAt: '2026-01-01' }] }); await flush()
    expect(document.querySelector('.overlay')).toBeNull()
  })

  it('allows a B project confirmation after an A task acceptance resolves late', async () => {
    let resolveAcceptance
    stubs.request.mockImplementation((action, payload) => action === 'task_respond'
      ? new Promise((resolve) => { resolveAcceptance = resolve }) : twoProjectResponses(action, payload))
    await mount()
    clickButton('接受分工'); await flush()
    await selectOtherProject()
    resolveAcceptance({ assignmentStatus: 'accepted' }); await flush()
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request).toHaveBeenCalledWith('archive', { projectId: OTHER_PROJECT.id, archived: true })
    expect(stubs.ensureTodo).not.toHaveBeenCalled()
  })

  it('allows a B project confirmation after an A status change resolves late', async () => {
    let resolveStatus
    stubs.request.mockImplementation((action, payload) => action === 'task_status'
      ? new Promise((resolve) => { resolveStatus = resolve }) : acceptedTaskResponse(action, payload))
    await mount()
    clickButton('完成'); await flush()
    await selectOtherProject()
    resolveStatus({}); await flush()
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request).toHaveBeenCalledWith('archive', { projectId: OTHER_PROJECT.id, archived: true })
    expect(stubs.setTodoStatus).not.toHaveBeenCalled()
  })

  it('allows B uploads after closing an A upload and switching projects', async () => {
    let resolveUpload
    stubs.request.mockImplementation(deliverableResponse)
    stubs.upload.mockImplementation((projectId) => projectId === PROJECT.id
      ? new Promise((resolve) => { resolveUpload = resolve }) : Promise.resolve({ path: 'fictional/b', name: 'fictional.txt', size: 16 }))
    await mount()
    await pickFile(await openDeliverableEditor())
    expect(resolveUpload).toBeTypeOf('function')
    clickButton('关闭', document.querySelector('.overlay')); await flush()
    await selectOtherProject()
    resolveUpload({ path: 'fictional/a', name: 'fictional.txt', size: 16 }); await flush()
    const input = await openDeliverableEditor()
    expect(input.disabled).toBe(false)
    await pickFile(input)
    expect(stubs.upload).toHaveBeenCalledWith(OTHER_PROJECT.id, `${OTHER_PROJECT.id}-deliverable`, expect.any(File))
    expect(document.querySelector('.deliverable-editor').textContent).not.toContain('fictional/a')
  })

  it.each(['task_respond', 'task_status'])('keeps the new A operation busy when an old %s returns after A→B→A', async (actionName) => {
    const responses = []
    const base = actionName === 'task_respond' ? twoProjectResponses : acceptedTaskResponse
    stubs.request.mockImplementation((action, payload) => action === actionName
      ? new Promise((resolve) => { responses.push(resolve) }) : base(action, payload))
    await mount()
    clickButton(actionName === 'task_respond' ? '接受分工' : '完成'); await flush()
    await selectOtherProject(); await selectOtherProject(PROJECT)
    clickButton(actionName === 'task_respond' ? '接受分工' : '完成'); await flush()
    expect(responses).toHaveLength(2)
    responses[0]({ assignmentStatus: 'accepted' }); await flush()
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'archive')).toHaveLength(0)
    expect(stubs.ensureTodo).not.toHaveBeenCalled()
    expect(stubs.setTodoStatus).not.toHaveBeenCalled()
  })

  it.each([OTHER_PROJECT, PROJECT])('keeps the new $id upload busy when the old A upload resolves', async (destination) => {
    const responses = []
    stubs.request.mockImplementation(deliverableResponse)
    stubs.upload.mockImplementation(() => new Promise((resolve) => { responses.push(resolve) }))
    await mount()
    await pickFile(await openDeliverableEditor())
    clickButton('关闭', document.querySelector('.overlay')); await flush()
    await selectOtherProject()
    if (destination.id === PROJECT.id) await selectOtherProject(PROJECT)
    const newInput = await openDeliverableEditor(); await pickFile(newInput)
    expect(responses).toHaveLength(2)
    expect(newInput.disabled).toBe(true)
    responses[0]({ path: 'fictional/old', name: 'fictional-old.txt', size: 16 }); await flush()
    expect(newInput.disabled).toBe(true)
    expect(document.querySelector('.deliverable-editor').textContent).not.toContain('fictional-old.txt')
  })

  it('never detaches B tasks when an A leave confirmation resolves after navigation', async () => {
    let resolveLeave
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'member_leave') return new Promise((resolve) => { resolveLeave = resolve })
      return twoProjectResponses(action, payload).then((result) => {
        if (action === 'detail') result.project = { ...result.project, role: 'member' }
        return result
      })
    })
    await mount()
    const membersTab = [...host.querySelectorAll('.project-tabs button')].find((entry) => entry.textContent.startsWith('成员'))
    expect(membersTab).toBeTruthy(); membersTab.click(); await flush()
    clickButton('退出项目'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(resolveLeave).toBeTypeOf('function')
    clickButton('取消', document.querySelector('.overlay')); await flush()
    await selectOtherProject()
    stubs.detachTodos.mockClear()
    resolveLeave({}); await flush()
    expect(stubs.detachTodos.mock.calls.map(([id]) => id)).not.toContain(OTHER_PROJECT.id)
  })

  it('keeps B confirmation busy when an old A leave completes', async () => {
    let resolveLeave
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'member_leave') return new Promise((resolve) => { resolveLeave = resolve })
      if (action === 'archive') return new Promise(() => {})
      return twoProjectResponses(action, payload).then((result) => {
        if (action === 'detail' && payload.projectId === PROJECT.id) result.project = { ...result.project, role: 'member' }
        return result
      })
    })
    await mount()
    const membersTab = [...host.querySelectorAll('.project-tabs button')].find((entry) => entry.textContent.startsWith('成员'))
    membersTab.click(); await flush()
    clickButton('退出项目'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    clickButton('取消', document.querySelector('.overlay')); await flush()
    await selectOtherProject()
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'archive')).toHaveLength(1)
    resolveLeave({}); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'archive')).toHaveLength(1)
  })

  it('rejects duplicate task actions and keeps a second task busy after the first resolves', async () => {
    const responses = []
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'task_respond') return new Promise((resolve) => { responses.push(resolve) })
      return twoProjectResponses(action, payload).then((result) => {
        if (action === 'detail') result.tasks.push({ ...result.tasks[0], id: `${payload.projectId}-second-task`, title: '虚构第二分工' })
        return result
      })
    })
    await mount()
    const rows = host.querySelectorAll('.project-task')
    clickButton('接受分工', rows[0]); await flush()
    clickButton('接受分工', rows[0]); await flush()
    expect(responses).toHaveLength(1)
    clickButton('接受分工', rows[1]); await flush()
    expect(responses).toHaveLength(2)
    expect(stubs.request.mock.calls.filter(([action]) => action === 'task_respond').map(([, payload]) => payload.taskId))
      .toEqual([`${PROJECT.id}-task`, `${PROJECT.id}-second-task`])
    responses[0]({ assignmentStatus: 'accepted' }); await flush()
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'archive')).toHaveLength(0)
  })

  it.each(['task_respond', 'task_status'])('keeps a successful %s bridge when another task fails', async (actionName) => {
    const responses = []
    const base = actionName === 'task_respond' ? twoProjectResponses : acceptedTaskResponse
    stubs.request.mockImplementation((action, payload) => {
      if (action === actionName) return new Promise((resolve, reject) => { responses.push({ resolve, reject }) })
      return base(action, payload).then((result) => {
        if (action === 'detail') result.tasks.push({ ...result.tasks[0], id: `${payload.projectId}-second-task`, title: '虚构第二分工' })
        return result
      })
    })
    await mount()
    const rows = host.querySelectorAll('.project-task')
    const actionLabel = actionName === 'task_respond' ? '接受分工' : '完成'
    clickButton(actionLabel, rows[0]); await flush()
    clickButton(actionLabel, rows[1]); await flush()
    expect(responses).toHaveLength(2)
    responses[0].resolve({ assignmentStatus: 'accepted' }); await flush()
    responses[1].reject(new Error('虚构第二分工失败')); await flush()
    if (actionName === 'task_respond') {
      expect(stubs.ensureTodo).toHaveBeenCalledWith(
        expect.objectContaining({ id: `${PROJECT.id}-task`, assignmentStatus: 'accepted' }),
        expect.objectContaining({ id: PROJECT.id }), expect.anything(),
      )
    } else {
      expect(stubs.setTodoStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: `${PROJECT.id}-task` }),
        expect.objectContaining({ id: PROJECT.id }), 'completed', expect.anything(),
      )
    }
    expect(host.querySelector('.projects-notice.is-error')?.textContent).toContain('虚构第二分工失败')
  })

  it('reports an earlier task failure while keeping another task busy', async () => {
    const responses = []
    stubs.request.mockImplementation((action, payload) => {
      if (action === 'task_respond') return new Promise((resolve, reject) => { responses.push({ resolve, reject }) })
      return twoProjectResponses(action, payload).then((result) => {
        if (action === 'detail') result.tasks.push({ ...result.tasks[0], id: `${payload.projectId}-second-task`, title: '虚构第二分工' })
        return result
      })
    })
    await mount()
    const rows = host.querySelectorAll('.project-task')
    clickButton('接受分工', rows[0]); await flush()
    clickButton('接受分工', rows[1]); await flush()
    responses[0].reject(new Error('虚构第一分工失败')); await flush()
    expect(host.querySelector('.projects-notice.is-error')?.textContent).toContain('虚构第一分工失败')
    clickButton('归档'); await flush()
    clickButton('确认', document.querySelector('.overlay')); await flush()
    expect(stubs.request.mock.calls.filter(([action]) => action === 'archive')).toHaveLength(0)
  })

  it('returns an independent successful result without releasing another request busy state', async () => {
    const context = createCollaborationContext(() => ['fictional-account-a', PROJECT.id])
    const busy = context.state('')
    let resolveFirst, resolveSecond
    const first = context.run(() => new Promise((resolve) => { resolveFirst = resolve }), { busy, busyValue: 'first' })
    const second = context.run(() => new Promise((resolve) => { resolveSecond = resolve }), { busy, busyValue: 'second' })
    const successfulResult = { taskId: `${PROJECT.id}-task`, assignmentStatus: 'accepted' }
    resolveFirst(successfulResult)
    expect(await first).toEqual(successfulResult)
    expect(busy.value).toBe('second')
    resolveSecond('second-result')
    expect(await second).toBe('second-result')
    expect(busy.value).toBe('')
  })
})
