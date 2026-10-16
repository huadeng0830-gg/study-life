/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { containsPrivateCampusDetails } from './rules.js'
import { assertAccountAccess } from '../_shared/accountRestrictions.js'

const url = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const allowedOrigins = new Set([
  'https://study-life.pages.dev', 'https://codex-preview-1-4-0.study-life.pages.dev',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173', 'app://study-life',
  ...(Deno.env.get('CAMPUS_COMMUNITY_ALLOWED_ORIGINS') || '').split(',').map((value) => value.trim()).filter(Boolean),
])

class CommunityError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

function respond(request: Request, body: unknown, status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' })
  const origin = request.headers.get('origin') || ''
  if (allowedOrigins.has(origin)) headers.set('Access-Control-Allow-Origin', origin)
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-supabase-api-version')
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Max-Age', '7200')
    return new Response('ok', { headers })
  }
  return new Response(JSON.stringify(body), { status, headers })
}

function input(value: unknown, max: number, label: string, required = false) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (text.length > max || (required && !text)) throw new CommunityError('invalid_input', `${label}格式不正确。`)
  if (text && containsPrivateCampusDetails(text)) throw new CommunityError('private_contact_not_allowed', `${label}不能包含联系方式、取件码或宿舍房间号。`)
  return text
}

function uuid(value: unknown, label: string) {
  const result = String(value || '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new CommunityError('invalid_input', `${label}无效。`)
  return result
}

async function userFor(request: Request, required = true) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) {
    if (!required) return null
    throw new CommunityError('unauthorized', '请先登录账号。', 401)
  }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new CommunityError('unauthorized', '登录已失效，请重新登录。', 401)
  return data.user
}

async function requireVerified(request: Request, user: any = null) {
  user ||= await userFor(request)
  const email = String(user?.email || '').trim().toLowerCase()
  if (!user?.email_confirmed_at || !email || email.endsWith('@wechat.study-life.invalid')) {
    throw new CommunityError('email_verification_required', '请先完成邮箱验证。', 403)
  }
  return user
}

async function owner(userId: string) {
  const { data, error } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).eq('role', 'owner').maybeSingle()
  if (error) throw error
  if (!data) throw new CommunityError('forbidden', '只有总管理员可以执行此操作。', 403)
}

async function rateLimit(userId: string, action: string, limit: number, windowSeconds = 3600) {
  const { data, error } = await admin.rpc('campus_life_take_rate_limit', { p_user_id: userId, p_action: action, p_limit: limit, p_window_seconds: windowSeconds })
  if (error) throw error
  if (!data) throw new CommunityError('rate_limited', '操作过于频繁，请稍后重试。', 429)
}

function failure(error: unknown) {
  if (error instanceof CommunityError) return { status: error.status, body: { code: error.code, error: error.message } }
  const marker = String((error as any)?.message || '')
  if (/CAMPUS_FORBIDDEN/.test(marker)) return { status: 403, body: { code: 'forbidden', error: '当前账号没有执行此操作的权限。' } }
  if (/CAMPUS_REVISION_CHANGED/.test(marker)) return { status: 409, body: { code: 'state_changed', error: '记录状态已变化，请刷新后重试。' } }
  if (/CAMPUS_NOT_FOUND/.test(marker)) return { status: 404, body: { code: 'not_found', error: '记录已不可用。' } }
  if (/CAMPUS_INVALID_INPUT/.test(marker)) return { status: 400, body: { code: 'invalid_input', error: '请检查填写内容。' } }
  console.error('[campus-community] request failed', (error as any)?.code || 'unknown')
  return { status: 503, body: { code: 'service_unavailable', error: '校园社区服务暂时不可用，请稍后重试。' } }
}

function feedbackFilters(query: any, payload: any) {
  if (payload.category) {
    if (!['product','campus','accessibility','other'].includes(payload.category)) throw new CommunityError('invalid_input', '反馈分类无效。')
    query = query.eq('category', payload.category)
  }
  const search = input(payload.q, 100, '搜索关键词')
  if (search) { const literal = JSON.stringify('***=' + search); query = query.or('title.imatch.' + literal + ',body.imatch.' + literal) }
  return query
}

async function listPublic(payload: any) {
  const limit = Math.min(60, Math.max(1, Number.isSafeInteger(payload.limit) ? payload.limit : 30))
  const offset = Math.min(10000, Math.max(0, Number.isSafeInteger(payload.offset) ? payload.offset : 0))
  let query = admin.from('campus_feedback_suggestions')
    .select(payload.view === 'summary' ? 'id,category,title,status,public_author_name,like_count,created_at,updated_at' : 'id,category,title,body,status,public_author_name,public_history,public_reply,public_reason,reward_beans,reward_issued,like_count,created_at,updated_at', { count: 'exact' })
    .eq('visibility', 'public')
  if (['pending','needs_info','planned','processing','resolved','not_adopted','duplicate'].includes(payload.status)) query = query.eq('status', payload.status)
  if (payload.id) query = query.eq('id', uuid(payload.id, '反馈'))
  query = feedbackFilters(query, payload)
  if (payload.sort === 'supported') query = query.order('like_count', { ascending: false }).order('created_at', { ascending: true })
  else query = query.order(payload.sort === 'newest' ? 'created_at' : 'updated_at', { ascending: false })
  const { data, count, error } = await query.order('id', { ascending: true }).range(offset, offset + limit - 1)
  if (error) throw error
  return { items: data || [], total: count || 0, offset, limit }
}

async function submitSuggestion(user: any, payload: any) {
  await rateLimit(user.id, 'campus_feedback_submit', 5)
  if (payload.anonymous !== undefined && typeof payload.anonymous !== 'boolean') throw new CommunityError('invalid_input', '请选择匿名或署名提交。')
  const anonymous = payload.anonymous !== false
  let publicName = ''
  if (!anonymous) {
    const profile = await admin.from('social_profiles').select('nickname').eq('user_id', user.id).maybeSingle()
    if (profile.error) throw profile.error
    publicName = input(profile.data?.nickname, 32, '公开昵称', true)
  }
  const category = ['product', 'campus', 'accessibility', 'other'].includes(payload.category) ? payload.category : 'other'
  const { data, error } = await admin.from('campus_feedback_suggestions').insert({
    author_id: user.id,
    is_anonymous: anonymous,
    public_author_name: anonymous ? '匿名用户' : publicName,
    category,
    title: input(payload.title, 100, '标题', true),
    body: input(payload.body, 3000, '建议内容', true),
    visibility: 'pending_safety',
    status: 'pending',
  }).select('id,status,visibility,created_at').single()
  if (error) throw error
  return { item: data, message: '建议已提交，内容检查通过后会按所选署名方式公开。' }
}

async function listMine(userId: string, payload: any) {
  const limit = Math.min(60, Math.max(1, Number.isSafeInteger(payload.limit) ? payload.limit : 20))
  const offset = Math.min(10000, Math.max(0, Number.isSafeInteger(payload.offset) ? payload.offset : 0))
  const { data, count, error } = await admin.from('campus_feedback_suggestions')
    .select('id,category,title,body,status,visibility,is_anonymous,public_author_name,public_history,public_reply,public_reason,reward_beans,reward_issued,like_count,created_at,updated_at', { count: 'exact' })
    .eq('author_id', userId).order('created_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1)
  if (error) throw error
  return { items: data || [], total: count || 0, offset, limit }
}

async function applyReviewer(user: any, payload: any) {
  if (!user.email || user.email.endsWith('.study-life.invalid')) throw new CommunityError('email_verification_required', '申请审核员前，请先绑定并验证一个可接收邮件的邮箱账号。', 403)
  const grant = await admin.from('campus_reviewer_grants').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle()
  if (grant.error) throw grant.error
  if (grant.data) throw new CommunityError('already_reviewer', '当前账号已经拥有校园审核权限。', 409)
  await rateLimit(user.id, 'campus_review', 2)
  const profileResult = await admin.from('social_profiles').select('school,campus').eq('user_id', user.id).maybeSingle()
  if (profileResult.error) throw profileResult.error
  const school = input(profileResult.data?.school, 100, '学校', true)
  const campus = input(profileResult.data?.campus, 100, '校区')
  const reason = input(payload.reason, 1000, '申请理由', true)
  if (reason.length < 10) throw new CommunityError('invalid_input', '申请理由至少填写 10 个字。')
  const { data, error } = await admin.from('campus_reviewer_applications').insert({ user_id: user.id, school, campus, reason })
    .select('id,status,school,campus,created_at').single()
  if (error?.code === '23505') throw new CommunityError('duplicate', '你已有一份待审核申请。', 409)
  if (error) throw error
  return { application: data }
}

async function myReviewerApplication(userId: string) {
  const { data, error } = await admin.from('campus_reviewer_applications')
    .select('id,school,campus,reason,status,owner_note,applicant_response,scope_school,scope_campus,created_at,updated_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return { application: data || null }
}

async function replyToReviewerApplication(user: any, payload: any) {
  if (!user.email || user.email.endsWith('.study-life.invalid')) throw new CommunityError('email_verification_required', '请先绑定并验证一个可接收邮件的邮箱账号。', 403)
  await rateLimit(user.id, 'campus_reviewer_reply', 5)
  const applicationId = uuid(payload.applicationId, '申请')
  const response = input(payload.response, 1000, '补充材料', true)
  if (response.length < 3) throw new CommunityError('invalid_input', '补充内容至少填写 3 个字。')
  const { data, error } = await admin.from('campus_reviewer_applications')
    .update({ applicant_response: response, updated_at: new Date().toISOString() })
    .eq('id', applicationId).eq('user_id', user.id).eq('status', 'pending').neq('owner_note', '')
    .select('id,status,applicant_response,updated_at').maybeSingle()
  if (error) throw error
  if (!data) throw new CommunityError('state_changed', '当前申请已处理或不可用，请刷新后查看状态。', 409)
  return { application: data }
}

async function wallet(userId: string) {
  const result = await admin.rpc('campus_bean_wallet', { p_actor: userId })
  if (result.error) throw result.error
  const ledger = await admin.from('campus_bean_ledger')
    .select('id,bean_type,amount,debt_delta,balance_after,debt_after,entry_type,reason,created_at')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(60)
  if (ledger.error) throw ledger.error
  return { wallet: result.data, ledger: ledger.data || [] }
}

async function ownerApplications(actorId: string) {
  const { data, error } = await admin.from('campus_reviewer_applications')
    .select('id,user_id,school,campus,reason,status,owner_note,applicant_response,scope_school,scope_campus,created_at,updated_at')
    .order('created_at', { ascending: true }).limit(200)
  if (error) throw error
  const emails = await userEmails(actorId, (data || []).map(item => item.user_id))
  const applications = (data || []).map(item => ({ ...item, email: emails.get(item.user_id) || '' }))
  return { applications }
}

// Called only after owner() has authorized this request. The RPC is executable
// by service_role alone and returns no account metadata beyond these labels.
async function userEmails(actorId: string, userIds: string[]) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return new Map<string, string>()
  const { data, error } = await admin.rpc('platform_admin_user_emails', { p_actor: actorId, p_user_ids: ids })
  if (error) throw error
  return new Map<string, string>((data || []).map((row: { user_id: string; email: string }) => [row.user_id, row.email]))
}

async function listAudits(payload: any, actorId: string) {
  const month = /^\d{4}-\d{2}$/.test(String(payload.month || '')) ? `${payload.month}-01` : new Date().toISOString().slice(0, 7) + '-01'
  let query = admin.from('campus_review_audits')
    .select('id,moderation_event_id,reviewer_id,sample_month,outcome,owner_reason,reopened,audited_at,created_at')
    .eq('sample_month', month)
  if (['pending', 'correct', 'incorrect'].includes(payload.outcome)) query = query.eq('outcome', payload.outcome)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  const events = (data || []).length
    ? await admin.from('campus_moderation_events').select('id,actor_id,school,campus,target_type,target_id,from_status,to_status,reason,created_at').in('id', (data || []).map((row) => row.moderation_event_id))
    : { data: [], error: null }
  if (events.error) throw events.error
  const eventById = new Map((events.data || []).map((item: any) => [item.id, item]))
  const reviewerIds = [...new Set((data || []).map((row) => row.reviewer_id))]
  const emailById = await userEmails(actorId, reviewerIds)
  return { month: month.slice(0, 7), items: (data || []).map((row) => ({ ...row, event: eventById.get(row.moderation_event_id), reviewerEmail: emailById.get(row.reviewer_id) || '' })) }
}

async function ownerFeedback(payload: any) {
  const limit = Math.min(60, Math.max(1, Number.isSafeInteger(payload.limit) ? payload.limit : 40))
  const offset = Math.min(10000, Math.max(0, Number.isSafeInteger(payload.offset) ? payload.offset : 0))
  let query = admin.from('campus_feedback_suggestions')
    .select(payload.view === 'summary' ? 'id,category,title,status,visibility,public_author_name,like_count,created_at,updated_at' : 'id,author_id,category,title,body,status,visibility,is_anonymous,public_author_name,public_history,public_reply,public_reason,reward_beans,reward_issued,like_count,created_at,updated_at', { count: 'exact' })
  if (['pending','needs_info','planned','processing','resolved','not_adopted','duplicate'].includes(payload.status)) query = query.eq('status', payload.status)
  if (payload.status === 'active') query = query.in('status', ['pending','needs_info','planned','processing'])
  if (['pending_safety','public','hidden'].includes(payload.visibility)) query = query.eq('visibility', payload.visibility)
  if (payload.id) query = query.eq('id', uuid(payload.id, '反馈'))
  query = feedbackFilters(query, payload)
  if (payload.sort === 'supported') query = query.order('like_count', { ascending: false }).order('created_at', { ascending: true })
  else query = query.order(payload.sort === 'updated' ? 'updated_at' : 'created_at', { ascending: payload.sort !== 'updated' && payload.sort !== 'newest' })
  const { data, count, error } = await query.order('id', { ascending: true }).range(offset, offset + limit - 1)
  if (error) throw error
  return { items: data || [], total: count || 0, offset, limit }
}

async function ownFeedbackVotes(userId: string, payload: any) {
  if (!Array.isArray(payload.feedbackIds) || payload.feedbackIds.length > 60) throw new CommunityError('invalid_input', '最多查询 60 条反馈。')
  const ids = [...new Set(payload.feedbackIds.map((id: unknown) => uuid(id, '反馈')))]
  if (!ids.length) return { likedIds: [] }
  const [votes, counts] = await Promise.all([
    admin.from('feedback_support_votes').select('feedback_id').eq('user_id', userId).in('feedback_id', ids),
    admin.from('campus_feedback_suggestions').select('id,like_count').eq('visibility', 'public').in('id', ids),
  ])
  if (votes.error) throw votes.error
  if (counts.error) throw counts.error
  const visible = new Set((counts.data || []).map(row => row.id))
  return { likedIds: (votes.data || []).map(row => row.feedback_id).filter(id => visible.has(id)), counts: counts.data || [] }
}

async function voteFeedback(user: any, payload: any) {
  if (typeof payload.liked !== 'boolean') throw new CommunityError('invalid_input', '点赞状态无效。')
  const feedbackId = uuid(payload.feedbackId, '反馈')
  await rateLimit(user.id, 'feedback_vote', 60, 60)
  const { data, error } = await admin.rpc('feedback_set_support', { p_actor: user.id, p_feedback: feedbackId, p_liked: payload.liked })
  if (error) throw error
  return data
}

async function privateMessages(userId: string, payload: any) {
  const suggestionId = uuid(payload.suggestionId, '建议')
  const item = await admin.from('campus_feedback_suggestions').select('id,author_id').eq('id', suggestionId).maybeSingle()
  if (item.error) throw item.error
  if (!item.data) throw new CommunityError('not_found', '建议已不可用。', 404)
  const isOwner = await admin.from('platform_admins').select('user_id').eq('user_id', userId).eq('role', 'owner').maybeSingle()
  if (item.data.author_id !== userId && !isOwner.data) throw new CommunityError('forbidden', '不能查看这条私信。', 403)
  if (payload.body !== undefined) {
    const body = input(payload.body, 2000, '私信内容', true)
    const recipient = userId === item.data.author_id ? await admin.from('platform_admins').select('user_id').eq('role', 'owner').limit(1).maybeSingle() : { data: { user_id: item.data.author_id }, error: null }
    if (recipient.error) throw recipient.error
    if (!recipient.data?.user_id) throw new CommunityError('service_unavailable', '站内联系对象暂不可用。', 503)
    const inserted = await admin.from('campus_feedback_messages').insert({ suggestion_id: suggestionId, sender_id: userId, recipient_id: recipient.data.user_id, body })
    if (inserted.error) throw inserted.error
  }
  const messages = await admin.from('campus_feedback_messages').select('id,sender_id,recipient_id,body,created_at')
    .eq('suggestion_id', suggestionId).or(`sender_id.eq.${userId},recipient_id.eq.${userId}`).order('created_at').limit(100)
  if (messages.error) throw messages.error
  return { messages: messages.data || [] }
}

async function handle(request: Request, action: string, payload: any) {
  if (action === 'public_list') return listPublic(payload)
  const user = await userFor(request)
  await assertAccountAccess(admin, user.id, 'campus-community', action, payload, CommunityError)
  if (action === 'feedback_vote') return voteFeedback(await requireVerified(request, user), payload)
  if (action === 'feedback_votes') return ownFeedbackVotes(user.id, payload)
  if (action === 'submit') return submitSuggestion(user, payload)
  if (action === 'mine') return listMine(user.id, payload)
  if (action === 'wallet') return wallet(user.id)
  if (action === 'reviewer_apply') return applyReviewer(await requireVerified(request, user), payload)
  if (action === 'reviewer_application_mine') return myReviewerApplication(user.id)
  if (action === 'reviewer_application_reply') return replyToReviewerApplication(await requireVerified(request, user), payload)
  if (action === 'message_thread') return privateMessages(user.id, payload)
  await requireVerified(request, user)
  await owner(user.id)
  if (action === 'reviewer_applications') return ownerApplications(user.id)
  if (action === 'reviewer_application_decide') {
    const result = await admin.rpc('campus_review_reviewer_application', {
      p_actor: user.id, p_application: uuid(payload.applicationId, '申请'),
      p_decision: ['approve', 'decline', 'request_proof'].includes(payload.decision) ? payload.decision : 'decline',
      p_reason: input(payload.reason, 1000, '处理说明', true),
      p_scope_school: input(payload.school, 100, '学校') || null,
      p_scope_campus: input(payload.campus, 100, '校区'),
    })
    if (result.error) throw result.error
    return result.data
  }
  if (action === 'audit_sample') {
    const result = await admin.rpc('campus_sample_reviewer_audits', { p_actor: user.id, p_month: payload.month ? `${payload.month}-01` : null })
    if (result.error) throw result.error
    return result.data
  }
  if (action === 'audit_list') return listAudits(payload, user.id)
  if (action === 'audit_resolve') {
    const result = await admin.rpc('campus_resolve_review_audit', {
      p_actor: user.id, p_audit: uuid(payload.auditId, '抽查记录'), p_correct: payload.correct === true,
      p_reason: input(payload.reason, 1000, '复核依据', true), p_reopen: payload.reopen === true,
    })
    if (result.error) throw result.error
    return result.data
  }
  if (action === 'feedback_admin_list') return ownerFeedback(payload)
  if (action === 'feedback_manage') {
    const result = await admin.rpc('campus_manage_feedback', {
      p_actor: user.id, p_feedback: uuid(payload.feedbackId, '建议'),
      p_visibility: ['public','hidden','pending_safety'].includes(payload.visibility) ? payload.visibility : 'hidden',
      p_status: ['pending','needs_info','planned','processing','resolved','not_adopted','duplicate'].includes(payload.status) ? payload.status : 'pending',
      p_expected_updated_at: payload.expectedUpdatedAt || null,
      p_reply: input(payload.reply, 2000, '公开回复'),
      p_public_reason: input(payload.publicReason, 1000, '不采纳说明'),
      p_reward: payload.reward === null || payload.reward === undefined ? null : Number(payload.reward),
    })
    if (result.error) throw result.error
    return result.data
  }
  throw new CommunityError('invalid_input', '社区服务操作无效。')
}

async function readBoundedBody(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 32_768) throw new CommunityError('invalid_input', '请求内容过大。', 413)
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 32_768) { await reader.cancel().catch(() => {}); throw new CommunityError('invalid_input', '请求内容过大。', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let position = 0
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength }
  return new Response(bytes).text()
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return respond(request, {})
  if (request.method !== 'POST') return respond(request, { error: '仅支持 POST。', code: 'method_not_allowed' }, 405)
  if (!url || !serviceKey) return respond(request, { error: '社区服务尚未配置。', code: 'service_unavailable' }, 503)
  try {
    const raw = await readBoundedBody(request)
    let body: any
    try { body = JSON.parse(raw) } catch { throw new CommunityError('invalid_input', '请求内容无效。') }
    if (typeof body?.action !== 'string') throw new CommunityError('invalid_input', '请求内容无效。')
    return respond(request, { data: await handle(request, body.action, body.payload || {}) })
  } catch (error) {
    const result = failure(error)
    return respond(request, result.body, result.status)
  }
})
