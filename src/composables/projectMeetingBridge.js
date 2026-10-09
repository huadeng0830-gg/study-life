import { dateInZone, zonedParts } from './zonedTime.js'

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

// 个人日程里用前缀表达"这场讨论现在是什么状态"。这些前缀是**叠加**上去的，所以下一次
// 同步必须能把上一次的前缀完整剥掉再重新加。
//
// 【为什么不能靠正则漏写一个前缀】原来这里写的是
// /^(待确认：|已取消：|已退出：)+/ —— 漏了 `已拒绝：`。而下方的前缀判定在
// 「有人拒绝 + 讨论仍是 open」时会产出 `已拒绝：`。后果是拒绝一次之后，每次
// syncProjectMeetingEvents 都会在旧标题上再叠一层：
//   已拒绝：小组讨论：X → 已拒绝：已拒绝：小组讨论：X → 已拒绝：已拒绝：已拒绝：…
// 这个函数在每次 loadProject 时都会跑（含 120 秒自动刷新、切换项目、手动刷新），
// 于是日程标题会无限膨胀。改为按**同一份前缀清单**做剥离，杜绝"加得出来、剥不掉"。
const MEETING_STATUS_PREFIXES = Object.freeze(['待确认：', '已取消：', '已退出：', '已拒绝：'])

function stripMeetingStatusPrefixes(title) {
  let text = String(title ?? '')
  // 前缀可叠加，逐层剥到不再变化。用 while 而不是单次 replace：
  // 单次 replace 只会去掉开头连续匹配的一段，`待确认：已拒绝：X` 这种多前缀会残留一层。
  let stripped = true
  while (stripped) {
    stripped = false
    for (const prefix of MEETING_STATUS_PREFIXES) {
      if (text.startsWith(prefix)) {
        text = text.slice(prefix.length)
        stripped = true
        break
      }
    }
  }
  return text
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
      const baseTitle = stripMeetingStatusPrefixes(event.title)
      const participant = previous?.participants?.find((person) => person.userId === userId)
      const prefix = previous?.status === 'open' && participant?.status === 'declined'
        ? '已拒绝：' : previous?.status === 'open' ? '待确认：' : previous?.status === 'cancelled' ? '已取消：' : '已退出：'
      const title = `${prefix}${baseTitle}`
      // changed 只在**真的写入**时自增：原来无条件自增，导致标题没有变化也报"改了一处"，
      // 调用方无法用它判断是否有实际变更。
      if (event.title !== title) {
        domain.updateEvent(event.id, { title })
        changed++
      }
      continue
    }
    const values = eventValues(meeting, project, timezone)
    if (!values) continue
    // note 优先保留本机已有的（用户可能自己补过备注），否则用服务端算出的「项目：X / 讨论说明」。
    const update = { ...values, note: event.note || values.note }
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
