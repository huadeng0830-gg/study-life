export const NOTICE_STATUSES = Object.freeze(['new', 'handled', 'archived'])

export function normalizeNoticeRecord(value = {}) {
  const status = NOTICE_STATUSES.includes(value.status) ? value.status : 'new'
  const legacyLink = value.linkedEntityType && value.linkedEntityId
    ? [{ type: String(value.linkedEntityType), id: String(value.linkedEntityId) }]
    : []
  const linkedEntities = Array.isArray(value.linkedEntities) ? value.linkedEntities
    .filter((item) => item && typeof item === 'object' && item.type && item.id)
    .map((item) => ({ type: String(item.type), id: String(item.id) }))
    : legacyLink
  return {
    ...value,
    id: String(value.id || ''),
    raw: String(value.raw || ''),
    source: String(value.source || '').trim(),
    title: String(value.title || '').trim(),
    publishedAt: String(value.publishedAt || ''),
    topic: String(value.topic || '通知').trim(),
    status,
    createdAt: String(value.createdAt || ''),
    linkedEntityType: String(value.linkedEntityType || ''),
    linkedEntityId: value.linkedEntityId == null ? '' : String(value.linkedEntityId),
    linkedEntities,
    scheduleProposalId: String(value.scheduleProposalId || ''),
    needsAction: Boolean(value.needsAction),
  }
}

export function activeNoticeReminders(notices = [], sources = []) {
  const muted = new Set(sources.filter((source) => source?.muted).map((source) => String(source.source || '').trim()).filter(Boolean))
  return notices.filter((notice) => {
    const source = String(notice?.source || '').trim() || '未注明来源'
    return notice?.status === 'new' && !muted.has(source)
  })
}

export function summarizeNoticeSources(notices = [], sources = [], monthKey = '') {
  const summary = new Map()
  for (const source of sources) {
    const name = String(source?.source || '').trim()
    if (name) summary.set(name, { source: name, muted: Boolean(source.muted), monthCount: 0, actionCount: 0 })
  }
  for (const notice of notices) {
    const name = String(notice?.source || '').trim() || '未注明来源'
    const row = summary.get(name) || { source: name, muted: false, monthCount: 0, actionCount: 0 }
    if (monthKey && String(notice?.createdAt || '').startsWith(monthKey)) {
      row.monthCount += 1
      if (notice.status === 'new' || notice.needsAction || notice.linkedEntityType) row.actionCount += 1
    }
    summary.set(name, row)
  }
  return [...summary.values()].sort((left, right) => left.source.localeCompare(right.source, 'zh-CN'))
}

export function visibleNoticeRecords(notices = [], { status = 'active', source = '', topic = '' } = {}) {
  return notices
    .filter((notice) => status === 'all' || (status === 'active' ? notice?.status !== 'archived' : notice?.status === status))
    .filter((notice) => !source || String(notice?.source || '') === source)
    .filter((notice) => !topic || String(notice?.topic || '') === topic)
    .slice()
    .sort((left, right) => String(right?.createdAt || '').localeCompare(String(left?.createdAt || '')))
}
