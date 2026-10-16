/**
 * The campus domain vocabulary.
 *
 * Content type, label, status and route lookups were re-declared in whichever
 * view needed them first: two files carried a private copy of the
 * `type → route` map, the report reasons were hardcoded a third time inside a
 * `<select>`, and 我的校园投稿 carried its own 13-row domain table. When the
 * server renamed a status, some screens followed and some silently showed the
 * raw English key.
 *
 * Everything a campus screen is allowed to say about a content type now lives
 * here. Adding a type means adding it here once.
 */

/** 分页大小；此前审核工作台用 30、审核员列表用 25，同一文件里两个数字。 */
export const CAMPUS_PAGE_SIZE = 30

export const campusContentLabels = {
  place: '校园地点', teacher: '教师资料', course: '课程资料', assignment: '授课安排', course_review: '课程评价',
  market_listing: '二手信息', help_task: '互助任务', help_dispute: '互助争议', shuttle_route: '校车线路',
  shuttle_exception: '特殊班次', shuttle_correction: '校车纠错', lost_found: '失物招领', event: '校园活动', guide: '校园指南', report: '用户举报', report_appeal: '举报申诉',
  matter: '校园交流', matter_response: '交流回应', matter_clarification: '交流补充',
}

export const campusReportReasons = { inaccurate: '信息不准确', privacy: '隐私风险', abuse: '辱骂或骚扰', prohibited: '违规内容', other: '其他问题' }
export const campusReportStatuses = { pending_review: '等待处理', resolved: '已处理', dismissed: '未成立' }

/** 投稿与认领的状态文案。审核结果、认领结果和集市状态共用这一张表。 */
export const campusStatusLabels = {
  pending_review: '等待审核', pending: '等待处理', approved: '已通过', active: '公开中', open: '公开中',
  published: '已发布', reserved: '已预留', sold: '已成交', withdrawn: '已下架', rejected: '未通过',
  accepted: '已接受', resolved: '已处理', dismissed: '未成立', retired: '已归档', returned: '已归还',
  claim_pending: '认领处理中', closed: '已关闭', cancelled: '已取消', ended: '已结束', needs_review: '需要复核',
}

/** 用户仍可自行撤回的状态。服务端状态之外，还要看审核是否已给出结论。 */
export const CAMPUS_WITHDRAWABLE_STATUSES = ['pending', 'pending_review', 'approved', 'active', 'open']

/** 被退回、可以修改后重新提交的状态。 */
export const CAMPUS_RESUBMITTABLE_STATUSES = ['rejected', 'withdrawn']

const CONTENT_ROUTES = Object.freeze({
  place: '/campus/places',
  teacher: '/campus/courses',
  course: '/campus/courses',
  assignment: '/campus/courses',
  course_review: '/campus/courses',
  market_listing: '/campus/market',
  help_task: '/campus/help',
  lost_found: '/campus/lost-found',
  shuttle_route: '/campus/shuttle',
  shuttle_correction: '/campus/shuttle',
  shuttle_exception: '/campus/shuttle',
  event: '/campus/events',
  guide: '/campus/guides',
  matter: '/campus/matters',
  matter_response: '/campus/matters',
  matter_clarification: '/campus/matters',
  report_appeal: '/campus/reports',
})

/** 内容类型对应的模块页；未知类型回落到「我的校园投稿」，那里至少有上下文。 */
export function campusContentRoute(type) { return CONTENT_ROUTES[type] || '/campus/mine' }

/** 内容类型的展示名，未知类型回落到通用文案而不是显示原始键。 */
export function campusContentLabel(type) { return campusContentLabels[type] || '校园内容' }

/** 状态展示名；服务端若出现新状态，显示原值好过留空。 */
export function campusStatusLabel(status) { return campusStatusLabels[status] || status || '' }

export function campusContentTitle(item = {}) { return item.title || item.name || item.term || item.detail || item.content || item.note || '校园内容' }

/**
 * 「我的校园投稿」的领域表。
 *
 * `campusLifeMine` 把所有类型放进一个响应对象，页面需要知道每个键叫什么、
 * 标题取哪个字段、跳到哪个模块、用哪个类型调撤回接口。这是唯一一张表：
 * 我的投稿页渲染它，撤回和重新提交也从它取 targetType / resubmitType。
 */
const titleOfName = (item) => item.name
const titleOfTitle = (item) => item.title
const titleOfTerm = (item) => item.term
const titleOfNote = (item) => item.note || '课程体验'
const titleOfDetail = (item) => item.detail
const titleOfLostFound = (item) => item.title
const titleOfShuttleException = (item) => `${item.service_date} · ${item.exception_type}`

export const CAMPUS_SUBMISSION_DOMAINS = Object.freeze([
  { key: 'places', label: '校园地点', route: '/campus/places?section=mine', targetType: 'place', titleOf: titleOfName },
  { key: 'teachers', label: '教师资料', route: '/campus/courses', targetType: 'teacher', titleOf: titleOfName },
  { key: 'courses', label: '课程资料', route: '/campus/courses', targetType: 'course', titleOf: titleOfName },
  { key: 'assignments', label: '授课安排', route: '/campus/courses', targetType: 'assignment', titleOf: titleOfTerm },
  { key: 'courseReviews', label: '课程评价', route: '/campus/courses', targetType: 'course_review', titleOf: titleOfNote },
  { key: 'listings', label: '二手信息', route: '/campus/market', targetType: 'market_listing', resubmitType: 'market', titleOf: titleOfTitle },
  { key: 'helpTasks', label: '互助任务', route: '/campus/help', targetType: 'help_task', resubmitType: 'help', titleOf: titleOfTitle },
  { key: 'shuttleRoutes', label: '校车线路', route: '/campus/shuttle', targetType: 'shuttle_route', resubmitType: 'shuttle', titleOf: titleOfName },
  { key: 'shuttleCorrections', label: '线路纠错', route: '/campus/shuttle', targetType: 'shuttle_correction', resubmitType: 'shuttle_correction', titleOf: titleOfDetail },
  { key: 'shuttleExceptions', label: '特殊班次', route: '/campus/shuttle', targetType: 'shuttle_exception', resubmitType: 'shuttle_exception', titleOf: titleOfShuttleException },
  { key: 'lostFound', label: '失物信息', route: '/campus/lost-found', targetType: 'lost_found', resubmitType: 'lost', titleOf: titleOfLostFound },
  { key: 'events', label: '校园活动', route: '/campus/events', targetType: 'event', resubmitType: 'event', titleOf: titleOfTitle },
  { key: 'guides', label: '校园指南', route: '/campus/guides', targetType: 'guide', resubmitType: 'guide', titleOf: titleOfTitle },
])

/** 我的投稿响应键 → 统一发布页的可编辑类型；课程评价没有对应的再次提交入口。 */
export const CAMPUS_RESUBMIT_TYPE_BY_KEY = Object.freeze(Object.fromEntries(
  CAMPUS_SUBMISSION_DOMAINS.filter((domain) => domain.resubmitType).map((domain) => [domain.key, domain.resubmitType]),
))

/** 把 `campusLifeMine` 的响应摊平成统一投稿列表，最新的排在最前。 */
export function flattenCampusSubmissions(mine) {
  if (!mine || typeof mine !== 'object') return []
  return CAMPUS_SUBMISSION_DOMAINS.flatMap((domain) => {
    const rows = mine[domain.key]
    if (!Array.isArray(rows)) return []
    return rows.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({
      key: `${domain.key}:${item.id}`,
      domainKey: domain.key,
      label: domain.label,
      route: domain.route,
      resubmitType: CAMPUS_RESUBMIT_TYPE_BY_KEY[domain.key] || '',
      id: item.id,
      targetType: domain.targetType,
      revision: item.review_revision ?? item.revision,
      canWithdraw: CAMPUS_WITHDRAWABLE_STATUSES.includes(item.review_status || item.status),
      title: String(domain.titleOf(item) || '未命名内容'),
      status: item.review_reason === '作者主动撤回' ? 'withdrawn' : item.review_status || item.status || 'pending',
      reason: item.review_reason || item.resolution || '',
      date: item.updated_at || item.created_at || '',
    }))
  }).sort((left, right) => String(right.date).localeCompare(String(left.date)))
}

/** 贡献豆规则。此前这段文案在校园总览、反馈页、账号页各写了一遍，改价要改三处。 */
export const CAMPUS_BEAN_RULES = Object.freeze({
  summary: '申请获批后，每完成 1 条审核并写明依据得 3 豆，每日最多计入 20 条。',
  feedback: '总管理员确认“已解决”并设置奖励后，获得 0–20 豆；提交本身不保证获奖。',
  bounds: '单次奖励范围 0–20 个贡献豆。',
})

export function campusNotificationRoute(item) {
  if (['campus_matter_response','campus_matter_clarification','campus_matter_adopted','campus_matter_outcome','campus_matter_reviewed'].includes(item.kind)) return `/campus/matters/${item.resource_id}`
  if (item.kind === 'campus_report_reviewed') return '/campus/reports'
  if (item.kind === 'campus_content_reviewed') return '/campus/mine'
  if (item.kind === 'campus_place_reviewed') return '/campus/places?section=mine'
  if (item.kind === 'place_preset') return '/campus/places?section=invites'
  if (item.kind === 'campus_market_interest') return '/campus/market'
  if (item.kind?.startsWith('campus_help')) return '/campus/help'
  if (item.kind === 'campus_lost_found_claim') return '/campus/lost-found'
  if (item.kind === 'campus_event_update') return '/campus/events'
  return ''
}

/**
 * 统一的错误文案提取。
 *
 * 边缘函数抛出的错误带有可直接展示的中文 message；网络层抛出的没有。
 * 三处 campus 文件各自抄了一份判断，另外十处直接写 `cause?.message`，
 * 于是解析失败时会渲染出 `undefined`。
 */
export function campusErrorMessage(cause, fallback) {
  if (cause && typeof cause === 'object' && typeof cause.message === 'string' && cause.message.trim()) {
    if (/^(?:failed to fetch|networkerror when attempting to fetch resource|load failed|network request failed)\.?$/i.test(cause.message.trim())) return `${fallback || '暂时无法连接服务。'}请检查网络后重试。`
    return cause.message
  }
  return fallback
}
