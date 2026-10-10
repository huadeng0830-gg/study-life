// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ profile: vi.fn(), ensureTodo: vi.fn(), domain: null }))
vi.mock('../src/composables/accountAuth.js', async () => {
  const { ref } = await import('vue')
  return { accountUser: ref({ id: 'fictional-user' }), accountOpen: ref(false) }
})
vi.mock('../src/composables/domain/commands.js', async () => {
  const { ref } = await import('vue')
  const events = ref([{ id: 'existing', title: '虚构个人日程', date: '2026-10-11' }])
  mocks.domain = { events, createEvent: (event) => events.value.push(event), updateEvent: (id, values) => Object.assign(events.value.find((event) => event.id === id), values) }
  return { useDomainCommands: () => mocks.domain }
})
vi.mock('../src/services/social.js', () => ({ socialRequest: mocks.profile }))
vi.mock('../src/services/projects.js', async (original) => ({
  ...(await original()),
  projectRequest: async (action) => {
    const project = { id: 'fictional-project', name: '虚构项目', status: 'active', role: 'owner' }
    if (action === 'list') return { projects: [project] }
    if (action === 'detail') return { project, tasks: [{ id: 'fictional-task', title: '虚构分工', status: 'todo', assigneeId: 'fictional-user', assignmentStatus: 'accepted' }] }
    if (action === 'meetings_list') return { meetings: [{ id: 'fictional-meeting', projectId: project.id, title: '虚构讨论', status: 'confirmed', startsAt: '2026-10-11T02:00:00Z', endsAt: '2026-10-11T03:00:00Z', participants: [{ userId: 'fictional-user', status: 'accepted' }] }] }
    return { invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [], requests: [], deliverables: [], items: [] }
  },
}))
vi.mock('../src/composables/projectTaskBridge.js', () => ({
  useProjectTaskSyncState: () => ({ pending: 0 }), ensureProjectTaskTodo: mocks.ensureTodo, detachProjectTaskTodos: vi.fn(), setProjectTaskTodoStatus: vi.fn(),
}))
import ProjectsView from '../src/views/ProjectsView.vue'

let app, host
afterEach(() => { app?.unmount(); host?.remove() })
async function flush() { for (let i = 0; i < 24; i++) { await Promise.resolve(); await nextTick() } }

it('keeps personal events and task syncing intact until the account timezone becomes available', async () => {
  mocks.profile.mockRejectedValue(new Error('fictional profile failure'))
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/projects', component: { template: '<div />' } }] })
  await router.push('/projects'); await router.isReady()
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(ProjectsView); app.use(router); app.mount(host)
  await vi.waitFor(() => expect(mocks.ensureTodo).toHaveBeenCalled())
  await flush()
  expect(host.querySelector('.projects-error')).toBeNull()
  expect(mocks.domain.events.value).toHaveLength(1)
  mocks.profile.mockResolvedValue({ profile: { timezone: 'Asia/Shanghai' } })
  const refresh = [...host.querySelectorAll('button')].find((button) => button.textContent.trim() === '刷新')
  refresh.click()
  await vi.waitFor(() => expect(mocks.domain.events.value).toHaveLength(2))
  expect(mocks.domain.events.value[1]).toMatchObject({ time: '10:00', endTime: '11:00', sourceId: 'fictional-meeting' })
})
