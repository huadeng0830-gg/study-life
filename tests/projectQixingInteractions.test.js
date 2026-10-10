// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: null, request: vi.fn() }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  mocks.user = ref({ id: 'fictional-user' })
  return { accountUser: mocks.user, accountOpen: ref(false) }
})
vi.mock('../src/services/social.js', () => ({ socialRequest: vi.fn(async () => ({ profile: { timezone: 'Asia/Shanghai' } })) }))
vi.mock('../src/services/projects.js', async (original) => ({ ...(await original()), projectRequest: mocks.request }))
vi.mock('../src/composables/projectTaskBridge.js', () => ({
  useProjectTaskSyncState: () => ({ pending: 0 }), ensureProjectTaskTodo: vi.fn(), detachProjectTaskTodos: vi.fn(), setProjectTaskTodoStatus: vi.fn(),
}))
vi.mock('../src/composables/projectMeetingBridge.js', () => ({ syncProjectMeetingEvents: vi.fn(), detachProjectMeetingEvents: vi.fn() }))
import ProjectsView from '../src/views/ProjectsView.vue'

const project = { id: 'fictional-project', name: '虚构研究项目', type: 'research', status: 'active', role: 'owner' }
const other = { ...project, id: 'fictional-other-project', name: '虚构课程项目', type: 'course' }
const tasks = [
  { id: 'parent', title: '虚构主任务', status: 'completed', assignmentStatus: 'unassigned' },
  { id: 'child', parentTaskId: 'parent', title: '虚构子任务验证', status: 'in_progress', assigneeId: 'fictional-user', assignmentStatus: 'accepted' },
  { id: 'blocked', title: '虚构后续任务', status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'accepted', dependsOnTaskId: 'child', dependencyStatus: 'in_progress' },
  { id: 'review', title: '虚构待验收', status: 'review', assigneeId: 'fictional-other', assignmentStatus: 'accepted' },
  { id: 'unassigned', title: '虚构待分配', status: 'todo', assignmentStatus: 'unassigned' },
]
const inbox = { invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [] }
const deliverable = { id: 'fictional-deliverable', title: '虚构报告', draft: { revision: 2, content: { summary: '虚构旧报告', links: [], files: [] } }, versions: [] }
let app, host
async function flush() { for (let i = 0; i < 20; i++) { await Promise.resolve(); await nextTick() } }
async function mount(path = '/projects') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects', component: { template: '<div />' } }] })
  await router.push(path); await router.isReady()
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(ProjectsView); app.use(router); app.mount(host)
  await vi.waitFor(() => expect(host.querySelector('.project-title-line h2')?.textContent).toBe(project.name))
  await flush()
  return router
}
function click(label, root = host) {
  const button = [...root.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
  expect(button, label).toBeTruthy(); button.click()
}
function input(selector, value) {
  const element = host.querySelector(selector)
  expect(element).toBeTruthy(); element.value = value
  element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}
beforeEach(() => {
  mocks.user.value = { id: 'fictional-user' }
  mocks.request.mockReset().mockImplementation(async (action, payload) => {
    if (action === 'list') return { projects: [project, other] }
    if (action === 'inbox') return { ...inbox }
    if (action === 'detail') return { project: payload.projectId === other.id ? other : project,
      tasks: structuredClone(tasks), members: [{ userId: 'fictional-user', nickname: '虚构自己', status: 'active' }, { userId: 'fictional-other', nickname: '虚构队友', status: 'active' }], milestones: [], deliveryChecks: [], activities: [] }
    if (action === 'deliverables') return { deliverables: [structuredClone(deliverable)] }
    if (action === 'deliverable_draft_save') return { revision: 3 }
    if (action === 'deliverable_submit') return { version: 1 }
    return { items: [], meetings: [], requests: [] }
  })
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('Qixing project interactions', () => {
  it('keeps a completed parent visible for its unfinished child and combines quick filters', async () => {
    await mount()
    expect(host.querySelector('.project-task-filter-status')?.textContent).toContain('匹配 4 项')
    expect(host.querySelector('.project-subtask-row')?.textContent).toContain('虚构子任务验证')
    const mine = [...host.querySelectorAll('.project-summary-actions button')].find((item) => item.textContent.includes('我的任务'))
    mine.click(); await flush()
    expect(host.querySelector('[aria-label="按负责人筛选"]').value).toBe('mine')
    expect(host.querySelector('.project-task-filter-status')?.textContent).toContain('匹配 2 项')
    input('[aria-label="搜索任务"]', '子任务验证'); await flush()
    expect(host.querySelectorAll('.project-task')).toHaveLength(1)
    click('工作台', host.querySelector('.project-subtask-row')); await flush()
    expect(document.querySelector('.overlay')?.textContent).toContain('虚构子任务验证 · 工作进度')
  })

  it('shows an actionable empty filter state and clears filters', async () => {
    await mount()
    input('[aria-label="搜索任务"]', '不存在的虚构关键词'); await flush()
    expect(host.querySelectorAll('.project-task')).toHaveLength(0)
    expect(host.textContent).toContain('没有符合筛选条件的任务')
    click('查看全部任务'); await flush()
    expect(host.querySelectorAll('.project-task').length).toBeGreaterThan(0)
    expect(host.querySelector('[aria-label="搜索任务"]').value).toBe('')
  })

  it('opens task links when the same project is already loaded', async () => {
    const router = await mount()
    await router.replace({ path: '/projects', query: { project: project.id, task: 'blocked' } }); await flush()
    expect(document.querySelector('.overlay')?.textContent).toContain('虚构后续任务 · 工作进度')
    expect(document.querySelector('.task-work-actions')?.textContent).toContain('保存进度')
    expect(document.querySelector('.task-work-actions')?.textContent).not.toContain('开始执行')
    expect(router.currentRoute.value.query.task).toBeUndefined()
  })

  it('saves edited content before submitting from the editor form', async () => {
    await mount()
    const tab = [...host.querySelectorAll('.project-tabs button')].find((item) => item.textContent.startsWith('成果'))
    tab.click(); await flush(); click('继续编辑草稿'); await flush()
    const form = document.querySelector('.deliverable-editor')
    const summary = form.querySelector('textarea')
    summary.value = '虚构最新报告'; summary.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    const commands = mocks.request.mock.calls.filter(([action]) => action.startsWith('deliverable_'))
    expect(commands.map(([action]) => action)).toEqual(['deliverable_draft_save', 'deliverable_submit'])
    expect(commands[0][1]).toMatchObject({ expectedRevision: 2, content: { summary: '虚构最新报告' } })
    expect(document.querySelector('.deliverable-editor')).toBeNull()
  })

  it('loads projects even when inbox refresh fails', async () => {
    const base = mocks.request.getMockImplementation()
    mocks.request.mockImplementation((action, payload) => action === 'inbox' ? Promise.reject(new Error('模拟待处理事项失败')) : base(action, payload))
    await mount()
    expect(host.querySelector('.projects-error')).toBeNull()
    expect(host.textContent).toContain('暂时无法更新待处理事项')
  })

  it('keeps a replacement task form open after the previous save resolves', async () => {
    const base = mocks.request.getMockImplementation()
    let finish
    mocks.request.mockImplementation((action, payload) => action === 'task_update'
      ? new Promise((resolve) => { finish = resolve }) : base(action, payload))
    await mount()
    const rows = host.querySelectorAll('.project-task')
    click('编辑', rows[0]); await flush()
    const form = document.querySelector('.overlay form')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    expect(form.querySelector('fieldset').disabled).toBe(true)
    click('取消', document.querySelector('.overlay')); await flush()
    click('编辑', rows[1]); await flush()
    expect(document.querySelector('.overlay input[maxlength="160"]').value).toBe('虚构后续任务')
    finish({}); await flush()
    expect(document.querySelector('.overlay input[maxlength="160"]').value).toBe('虚构后续任务')
    expect(document.querySelector('.overlay fieldset').disabled).toBe(false)
  })

  it('does not let a late project creation close the newly opened project editor', async () => {
    const base = mocks.request.getMockImplementation()
    let finish
    mocks.request.mockImplementation((action, payload) => action === 'create'
      ? new Promise((resolve) => { finish = resolve }) : base(action, payload))
    await mount(); click('新建项目'); await flush()
    const form = document.querySelector('.overlay form')
    const name = form.querySelector('input[maxlength="120"]')
    name.value = '虚构新项目'; name.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush()
    click('取消', document.querySelector('.overlay')); await flush()
    const entry = [...host.querySelectorAll('.project-list-item')].find((item) => item.textContent.includes(other.name))
    entry.click(); await flush(); click('编辑', host.querySelector('.project-menu-actions')); await flush()
    finish({ projectId: 'fictional-created' }); await flush()
    expect(host.querySelector('.project-title-line h2').textContent).toBe(other.name)
    expect(document.querySelector('.overlay input[maxlength="120"]').value).toBe(other.name)
  })

  it('keeps evidence typed while the previous value is being saved', async () => {
    const base = mocks.request.getMockImplementation()
    let finish, savedEvidence = ''
    mocks.request.mockImplementation((action, payload) => {
      if (action === 'delivery_check_update') {
        savedEvidence = payload.evidence
        return new Promise((resolve) => { finish = resolve })
      }
      return base(action, payload).then((result) => {
        if (action === 'detail') result.deliveryChecks = [{ id: 'check', title: '虚构交付检查', evidence: savedEvidence, checked: false, revision: 1 }]
        return result
      })
    })
    await mount()
    const tab = [...host.querySelectorAll('.project-tabs button')].find((item) => item.textContent.startsWith('成果'))
    tab.click(); await flush()
    input('[aria-label="虚构交付检查的凭证或说明"]', '虚构已发送说明')
    click('保存说明'); await flush()
    expect(savedEvidence).toBe('虚构已发送说明')
    input('[aria-label="虚构交付检查的凭证或说明"]', '虚构后续未保存说明')
    finish({}); await flush()
    expect(host.querySelector('[aria-label="虚构交付检查的凭证或说明"]').value).toBe('虚构后续未保存说明')
  })

  it('blocks opposite responses to every pending task while allowing different tasks', async () => {
    const base = mocks.request.getMockImplementation()
    const responses = []
    mocks.request.mockImplementation((action, payload) => {
      if (action === 'task_respond') return new Promise((resolve) => { responses.push({ payload, resolve }) })
      return base(action, payload).then((result) => {
        if (action === 'detail') result.tasks = ['first', 'second'].map((id) => ({ id, title: `虚构分工${id}`, status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'pending' }))
        return result
      })
    })
    await mount()
    const rows = host.querySelectorAll('.project-task')
    click('接受分工', rows[0]); await flush()
    click('接受分工', rows[1]); await flush()
    expect(responses).toHaveLength(2)
    click('拒绝分工', rows[0]); await flush()
    expect(responses).toHaveLength(2)
    expect([...rows[0].querySelectorAll('button')].find((button) => button.textContent.trim() === '拒绝分工').disabled).toBe(true)
    responses[1].resolve({ assignmentStatus: 'accepted' }); await flush()
    click('拒绝分工', rows[0]); await flush()
    expect(responses).toHaveLength(2)
    responses[0].resolve({ assignmentStatus: 'accepted' }); await flush()
  })
})
