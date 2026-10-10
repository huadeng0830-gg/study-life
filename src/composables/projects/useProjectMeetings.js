import { ref } from 'vue'
import { socialRequest } from '../../services/social.js'
import { newProjectId } from '../../services/projects.js'
import { dateInZone, wallTimeToEpoch, zonedParts } from '../zonedTime.js'
import { formatDateTime } from '../intlFormatters.js'
import { createProjectEditorScope } from './projectEditorScope.js'

function blankMeeting() { return { id: '', title: '', note: '', startsLocal: '', endsLocal: '' } }

export function useProjectMeetings({ project, activeMembers, accountUser, isManager, scheduleTimezone, projectContext, actionBusy, projectRequest, loadProject, loadInbox, notify, describeError }) {
  const showMeetingForm = projectContext.state(false)
  const meetingDraft = projectContext.state(blankMeeting)
  const meetingProposalTarget = projectContext.state(null)
  const scheduleAvailability = projectContext.state(null)
  const scheduleDays = ref(7)
  const scheduleBusy = projectContext.state(false)
  const scheduleError = projectContext.state('')
  const meetingEditor = createProjectEditorScope(projectContext, showMeetingForm)

  function localInputForEpoch(epoch) {
    const zone = scheduleTimezone.value
    const parts = zonedParts(epoch, zone)
    return dateInZone(epoch, zone) + 'T' + String(parts.hour).padStart(2, '0') + ':' + String(parts.minute).padStart(2, '0')
  }

  function epochForLocalInput(value, edge) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value || '')
    return match ? wallTimeToEpoch(match[1], match[2], scheduleTimezone.value, edge) : null
  }

  function formatProjectTime(value) {
    if (!scheduleTimezone.value) return '时区暂未读取'
    return formatDateTime(value, { timeZone: scheduleTimezone.value, month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  }

  async function queryGroupAvailability(days = scheduleDays.value) {
    if (!project.value || activeMembers.value.length < 2 || scheduleBusy.value) return
    const projectId = project.value.id
    scheduleDays.value = days
    scheduleError.value = ''
    scheduleAvailability.value = null
    return projectContext.run(async (isCurrent) => {
      const [result, profileResult] = await Promise.all([
        projectRequest('time_availability', { projectId, days }), socialRequest('profile_get'),
      ])
      if (!isCurrent()) return
      scheduleTimezone.value = profileResult.profile?.timezone || 'Asia/Shanghai'
      scheduleAvailability.value = result
    }, { busy: scheduleBusy, current: projectContext.capture('availability'),
      onError: (error) => { scheduleError.value = describeError(error, '暂时无法计算共同时间，请检查课表同步后重试。') } })
  }

  function openMeetingForm(slot = null) {
    if (project.value?.status !== 'active' || activeMembers.value.length < 2) return
    if (!scheduleTimezone.value) { notify('error', '暂时无法读取你的时区，请刷新后再安排讨论。'); return }
    meetingProposalTarget.value = null
    meetingDraft.value = { ...blankMeeting(), id: newProjectId() }
    if (slot) {
      const start = Date.parse(slot.startsAt)
      const end = Math.min(Date.parse(slot.endsAt), start + (scheduleAvailability.value?.minimumMinutes || 90) * 60_000)
      meetingDraft.value.startsLocal = localInputForEpoch(start)
      meetingDraft.value.endsLocal = localInputForEpoch(end)
    }
    showMeetingForm.value = true
  }

  function openMeetingProposal(meeting) {
    if (!scheduleTimezone.value) { notify('error', '暂时无法读取你的时区，请刷新后再安排讨论。'); return }
    meetingProposalTarget.value = meeting
    meetingDraft.value = {
      ...blankMeeting(), title: meeting.title, note: meeting.note || '',
      startsLocal: localInputForEpoch(Date.parse(meeting.startsAt)), endsLocal: localInputForEpoch(Date.parse(meeting.endsAt)),
    }
    showMeetingForm.value = true
  }

  async function respondMeeting(meeting, response, proposedStartsAt = '', proposedEndsAt = '') {
    if (actionBusy.value) return
    const projectId = project.value.id
    return projectContext.run(async (isCurrent) => {
      await projectRequest('meeting_respond', { projectId, meetingId: meeting.id, response, proposedStartsAt, proposedEndsAt })
      if (!isCurrent()) return
      notify('success', response === 'accept' ? '已接受讨论时间。' : response === 'decline' ? '已拒绝讨论邀请。' : '改期建议已发送，等待组织者回应。')
      await loadProject(projectId)
      if (isCurrent()) await loadInbox()
      if (isCurrent()) { showMeetingForm.value = false; meetingProposalTarget.value = null }
    }, { busy: actionBusy, busyValue: 'meeting:' + meeting.id, current: meetingEditor.capture(), onError: (error) => notify('error', describeError(error)) })
  }

  async function saveMeetingForm() {
    if (actionBusy.value) return
    if (!scheduleTimezone.value) { notify('error', '暂时无法读取你的时区，请刷新后再安排讨论。'); return }
    const draft = meetingDraft.value
    const start = epochForLocalInput(draft.startsLocal, 'start')
    const end = epochForLocalInput(draft.endsLocal, 'end')
    if (start === null || end === null || start <= Date.now() || end <= start || end - start > 8 * 60 * 60_000) {
      notify('error', '请选择有效的未来时间，讨论时长不能超过 8 小时；时区切换附近不存在的本地时间不能使用。')
      return
    }
    if (meetingProposalTarget.value) return respondMeeting(meetingProposalTarget.value, 'propose', new Date(start).toISOString(), new Date(end).toISOString())
    if (!draft.title.trim()) { notify('error', '请填写讨论主题。'); return }
    const projectId = project.value.id
    return projectContext.run(async (isCurrent) => {
      await projectRequest('meeting_create', { id: draft.id || newProjectId(), projectId, title: draft.title.trim(), note: draft.note.trim(), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() })
      if (!isCurrent()) return
      notify('success', '讨论邀请已发送，成员确认后可以加入个人日程。')
      await loadProject(projectId)
      if (isCurrent()) await loadInbox()
      if (isCurrent()) showMeetingForm.value = false
    }, { busy: actionBusy, busyValue: 'meeting-create', current: meetingEditor.capture(), onError: (error) => notify('error', describeError(error)) })
  }

  function meetingCanConfirm(meeting) {
    return (meeting.createdBy === accountUser.value?.id || isManager.value) && meeting.status === 'open'
      && meeting.participants?.length > 0 && meeting.participants.every((item) => item.status === 'accepted')
  }
  function meetingStatusLabel(status) { return ({ open: '等待回应', confirmed: '已确认', cancelled: '已取消' })[status] || '等待回应' }
  function meetingParticipantStatus(status) { return ({ invited: '待回应', accepted: '已接受', declined: '已拒绝', proposed: '建议改期' })[status] || '待回应' }

  return {
    showMeetingForm, meetingDraft, meetingProposalTarget, scheduleAvailability, scheduleDays, scheduleBusy, scheduleError,
    formatProjectTime, queryGroupAvailability, openMeetingForm, openMeetingProposal, saveMeetingForm, respondMeeting,
    meetingCanConfirm, meetingStatusLabel, meetingParticipantStatus,
  }
}
