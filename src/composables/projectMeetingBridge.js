import { dateInZone, zonedParts } from '../../supabase/functions/campus-social/availability.js'

function localDateTimeParts(value, timezone = 'Asia/Shanghai') {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const timestamp = date.getTime()
  const parts = zonedParts(timestamp, timezone)
  return {
    date: dateInZone(timestamp, timezone),
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}

function eventValues(meeting, project, timezone) {
  const start = localDateTimeParts(meeting.startsAt, timezone)
  const end = localDateTimeParts(meeting.endsAt, timezone)
  if (!start || !end) return null
  return {
    title: `小组讨论：${meeting.title}`,
    date: start.date,
    time: start.time,
    endTime: end.date === start.date ? end.time : '',
    location: '',
    note: [project?.name ? `项目：${project.name}` : '', meeting.note || ''].filter(Boolean).join('\n'),
    sourceType: 'project-meeting',
    sourceId: meeting.id,
    relationId: meeting.projectId,
    createdFrom: 'qixing-meeting',
  }
}

export function syncProjectMeetingEvents(projectId, meetings = [], project, domain, userId, timezone = 'Asia/Shanghai') {
  if (!projectId || !Array.isArray(domain?.events?.value)) return 0
  const byMeetingId = new Map(meetings.map((meeting) => [meeting.id, meeting]))
  const confirmed = new Map(meetings
    .filter((meeting) => meeting.status === 'confirmed' && meeting.participants?.some((person) => person.status === 'accepted' && person.userId === userId))
    .map((meeting) => [meeting.id, meeting]))
  const local = domain.events.value.filter((event) => event.sourceType === 'project-meeting' && event.relationId === projectId)
  const byMeeting = new Map(local.map((event) => [event.sourceId, event]))
  let changed = 0

  for (const event of local) {
    const meeting = confirmed.get(event.sourceId)
    if (!meeting) {
      const previous = byMeetingId.get(event.sourceId)
      const baseTitle = event.title.replace(/^(待确认：|已取消：|已退出：)+/, '')
      const participant = previous?.participants?.find((person) => person.userId === userId)
      const prefix = previous?.status === 'open' && participant?.status === 'declined'
        ? '已拒绝：' : previous?.status === 'open' ? '待确认：' : previous?.status === 'cancelled' ? '已取消：' : '已退出：'
      const title = `${prefix}${baseTitle}`
      if (event.title !== title) domain.updateEvent(event.id, { title })
      changed++
      continue
    }
    const values = eventValues(meeting, project, timezone)
    if (!values) continue
    const update = { ...values, title: values.title, note: event.note || values.note }
    if (Object.entries(update).some(([key, value]) => event[key] !== value)) {
      domain.updateEvent(event.id, update)
      changed++
    }
  }

  for (const meeting of confirmed.values()) {
    if (byMeeting.has(meeting.id)) continue
    const values = eventValues(meeting, project, timezone)
    if (!values) continue
    domain.createEvent({ id: `qixing-meeting-${meeting.id}`, ...values })
    changed++
  }
  return changed
}

export function detachProjectMeetingEvents(projectId, domain, userId, timezone = 'Asia/Shanghai') {
  return syncProjectMeetingEvents(projectId, [], null, domain, userId, timezone)
}
