import { campusCommunityRequest } from './social.js'
import { getPublicApiUrl } from './cloudConfig.js'

export async function campusFeedbackPublicList(filters = {}) {
  const origin = getPublicApiUrl()
  if (!origin) return campusCommunityRequest('public_list', filters)
  if (navigator.onLine === false) throw new Error('当前离线，请联网后查看公开建议。')
  const url = new URL('/v1/feedback', origin)
  for (const key of ['status', 'limit', 'offset', 'category', 'q', 'sort', 'view', 'id']) {
    if (filters[key] !== undefined && filters[key] !== '') url.searchParams.set(key, String(filters[key]))
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal })
    if (!response.ok) throw new Error('公开建议暂时无法读取，请稍后重试。')
    const body = await response.json()
    if (!Array.isArray(body?.data?.items) || !Number.isSafeInteger(body.data.total)) throw new Error('服务没有返回有效结果，请稍后重试。')
    return body.data
  } finally { window.clearTimeout(timeout) }
}
export const submitCampusFeedback = (payload) => campusCommunityRequest('submit', payload)
export const myCampusFeedback = (filters) => filters ? campusCommunityRequest('mine', filters) : campusCommunityRequest('mine')
export const applyCampusReviewer = (reason) => campusCommunityRequest('reviewer_apply', { reason })
export const myCampusReviewerApplication = () => campusCommunityRequest('reviewer_application_mine')
export const replyToCampusReviewerApplication = (applicationId, response) =>
  campusCommunityRequest('reviewer_application_reply', { applicationId, response })
export const campusBeanWallet = () => campusCommunityRequest('wallet')
export const campusReviewerApplications = () => campusCommunityRequest('reviewer_applications')
export const decideCampusReviewerApplication = (applicationId, decision, reason, school, campus) =>
  campusCommunityRequest('reviewer_application_decide', { applicationId, decision, reason, school, campus })
export const sampleCampusReviewerAudits = (month) => campusCommunityRequest('audit_sample', { month })
export const campusReviewerAudits = (filters = {}) => campusCommunityRequest('audit_list', filters)
export const resolveCampusReviewerAudit = (auditId, correct, reason, reopen = false) =>
  campusCommunityRequest('audit_resolve', { auditId, correct, reason, reopen })
export const campusFeedbackAdminList = (filters = {}) => campusCommunityRequest('feedback_admin_list', filters)
export const manageCampusFeedback = (payload) => campusCommunityRequest('feedback_manage', payload)
export const campusFeedbackMessages = (suggestionId, body) => campusCommunityRequest('message_thread', { suggestionId, ...(body ? { body } : {}) })
