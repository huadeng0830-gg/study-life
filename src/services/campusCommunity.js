import { campusCommunityRequest } from './social.js'
import { getPublicApiUrl } from './cloudConfig.js'
import { createReadCache } from './readCache.js'
import { measureApiRequest } from './apiMetrics.js'

const publicReads = createReadCache({ ttl: 60000, maxEntries: 30 })
let cooldown = null

export async function campusFeedbackPublicList(filters = {}, { forceRefresh = false, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Read cancelled', 'AbortError')
  const origin = getPublicApiUrl()
  if (!origin) return signal ? campusCommunityRequest('public_list', filters, { signal }) : campusCommunityRequest('public_list', filters)
  if (navigator.onLine === false) throw new Error('当前离线，请联网后查看公开建议。')
  const url = new URL('/v1/feedback', origin)
  for (const key of ['status', 'limit', 'offset', 'category', 'q', 'sort', 'view', 'id']) {
    if (filters[key] !== undefined && filters[key] !== '') url.searchParams.set(key, String(filters[key]))
  }
  if (forceRefresh) publicReads.clear()
  return publicReads.read(url.href, upstreamSignal => {
    if (cooldown?.origin === url.origin && cooldown.until > Date.now()) {
      const error = new Error('公开建议读取暂不可用，请稍后重试。')
      Object.assign(error, { status: cooldown.status, retryAfter: Math.ceil((cooldown.until - Date.now()) / 1000) })
      throw error
    }
    return fetchPublicFeedback(url, upstreamSignal)
  }, { signal })
}

async function fetchPublicFeedback(url, signal) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  try {
    const response = await measureApiRequest('public-feedback', () => fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal }))
    if (!response.ok) {
      const error = new Error(response.status === 429 ? '公开建议读取过于频繁，请稍后重试。' : '公开建议暂时无法读取，请稍后重试。')
      Object.assign(error, { status: response.status, retryAfter: response.headers.get('Retry-After') })
      if (response.status === 429 || response.status >= 500) {
        const value = response.headers.get('Retry-After') || ''
        const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000)
        cooldown = { origin: url.origin, status: response.status, until: Date.now() + (Number.isFinite(seconds) ? Math.max(1, Math.min(300, seconds)) : 2) * 1000 }
      }
      throw error
    }
    const body = await response.json()
    if (!Array.isArray(body?.data?.items) || !Number.isSafeInteger(body.data.total)) throw new Error('服务没有返回有效结果，请稍后重试。')
    return body.data
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
function publicFeedbackMutation(action, payload) {
  publicReads.clear()
  return campusCommunityRequest(action, payload).finally(() => publicReads.clear())
}
export const submitCampusFeedback = (payload) => publicFeedbackMutation('submit', payload)
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
export const manageCampusFeedback = (payload) => publicFeedbackMutation('feedback_manage', payload)
export const campusFeedbackMessages = (suggestionId, body) => campusCommunityRequest('message_thread', { suggestionId, ...(body ? { body } : {}) })

export const campusFeedbackVotes = (feedbackIds) => campusCommunityRequest('feedback_votes', { feedbackIds })
export const setCampusFeedbackVote = (feedbackId, liked) => publicFeedbackMutation('feedback_vote', { feedbackId, liked })
