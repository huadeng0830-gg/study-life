import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'
const social = vi.hoisted(() => vi.fn(async () => ({ profile: { timezone: 'Asia/Shanghai' } })))
vi.mock('../src/services/social.js', () => ({ socialRequest: social }))
import { useProjectMeetings } from '../src/composables/projects/useProjectMeetings.js'

function setup(timezone = 'Asia/Shanghai') {
  const project = ref({ id: 'fictional-project', status: 'active' })
  const accountUser = ref({ id: 'fictional-user' })
  const projectContext = createCollaborationContext(() => [accountUser.value.id, project.value.id])
  const actionBusy = ref('')
  const projectRequest = vi.fn(async () => ({}))
  const notify = vi.fn()
  const loadInbox = vi.fn()
  const meetings = useProjectMeetings({ project, accountUser, projectContext, actionBusy, projectRequest, notify,
    activeMembers: ref([{ userId: 'fictional-user' }, { userId: 'fictional-other' }]), isManager: ref(true),
    scheduleTimezone: ref(timezone), loadProject: vi.fn(), loadInbox, describeError: (error) => error.message })
  return { meetings, project, projectContext, projectRequest, notify, loadInbox }
}
afterEach(() => vi.restoreAllMocks())

describe('project meeting editor timezone and lifetime', () => {
  it('displays and submits wall-clock values in the account timezone', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-10T00:00:00Z'))
    const { meetings, projectRequest, loadInbox } = setup()
    meetings.openMeetingForm({ startsAt: '2026-10-11T02:00:00Z', endsAt: '2026-10-11T05:00:00Z' })
    expect(meetings.meetingDraft.value).toMatchObject({ startsLocal: '2026-10-11T10:00', endsLocal: '2026-10-11T11:30' })
    meetings.meetingDraft.value.title = '虚构讨论'
    await meetings.saveMeetingForm()
    expect(projectRequest).toHaveBeenCalledWith('meeting_create', expect.objectContaining({ startsAt: '2026-10-11T02:00:00.000Z', endsAt: '2026-10-11T03:30:00.000Z' }))
    expect(loadInbox).toHaveBeenCalledOnce()
  })

  it('rejects a nonexistent DST wall-clock time before sending', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00Z'))
    const { meetings, projectRequest, notify } = setup('America/New_York')
    meetings.openMeetingForm()
    Object.assign(meetings.meetingDraft.value, { title: '虚构讨论', startsLocal: '2026-03-08T02:30', endsLocal: '2026-03-08T04:00' })
    await meetings.saveMeetingForm()
    expect(projectRequest).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('不存在的本地时间'))
  })

  it('ignores old availability and does not release the new project request', async () => {
    const { meetings, project, projectContext, projectRequest } = setup()
    const responses = []
    projectRequest.mockImplementation(() => new Promise((resolve) => responses.push(resolve)))
    const first = meetings.queryGroupAvailability(7)
    projectContext.invalidate(); project.value = { id: 'fictional-project-b', status: 'active' }
    const second = meetings.queryGroupAvailability(14)
    responses[0]({ known: true, intervals: [{ startsAt: 'fictional-old' }] }); await first
    expect(meetings.scheduleAvailability.value).toBeNull()
    expect(meetings.scheduleBusy.value).toBe(true)
    responses[1]({ known: true, intervals: [] }); await second
    expect(meetings.scheduleBusy.value).toBe(false)
    expect(meetings.scheduleAvailability.value).toEqual({ known: true, intervals: [] })
  })

  it('blocks meeting edits until the current account timezone is known', () => {
    const { meetings, notify } = setup('')
    meetings.openMeetingForm()
    expect(meetings.showMeetingForm.value).toBe(false)
    expect(notify).toHaveBeenCalledWith('error', expect.stringContaining('时区'))
  })
})
