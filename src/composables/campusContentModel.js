export const campusContentLabels = {
  place: '校园地点', teacher: '教师资料', course: '课程资料', assignment: '授课安排', course_review: '课程评价',
  market_listing: '二手信息', help_task: '互助任务', help_dispute: '互助争议', shuttle_route: '校车线路',
  shuttle_exception: '特殊班次', shuttle_correction: '校车纠错', lost_found: '失物招领', event: '校园活动', guide: '校园指南', report: '用户举报',
}
export const campusReportReasons = { inaccurate: '信息不准确', privacy: '隐私风险', abuse: '辱骂或骚扰', prohibited: '违规内容', other: '其他问题' }
export const campusReportStatuses = { pending_review: '等待处理', resolved: '已处理', dismissed: '未成立' }
export function campusContentRoute(type) {
  return ({ place: '/campus', teacher: '/campus/courses', course: '/campus/courses', assignment: '/campus/courses', course_review: '/campus/courses', market_listing: '/campus/market', help_task: '/campus/help', lost_found: '/campus/lost-found', shuttle_route: '/campus/shuttle', event: '/campus/events', guide: '/campus/guides' })[type] || '/campus/mine'
}
export function campusContentTitle(item = {}) { return item.title || item.name || item.term || item.detail || item.note || '校园内容' }
export function campusNotificationRoute(item) {
  if (item.kind === 'campus_report_reviewed') return '/campus/reports'
  if (item.kind === 'campus_content_reviewed') return '/campus/mine'
  if (item.kind === 'campus_place_reviewed') return '/campus?section=mine'
  if (item.kind === 'place_preset') return '/campus?section=invites'
  if (item.kind === 'campus_market_interest') return '/campus/market'
  if (item.kind?.startsWith('campus_help')) return '/campus/help'
  if (item.kind === 'campus_lost_found_claim') return '/campus/lost-found'
  if (item.kind === 'campus_event_update') return '/campus/events'
  return ''
}
