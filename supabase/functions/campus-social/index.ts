/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import {
  intervalIsAvailable,
  invitationRange,
  localDayRange,
  intersectIntervals,
  mutualFreeIntervals,
  userFreeIntervals,
} from './availability.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedOrigins = new Set([
  'https://study-life.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'app://study-life',
  ...(Deno.env.get('CAMPUS_SOCIAL_ALLOWED_ORIGINS') || '').split(',').map((origin) => origin.trim()).filter(Boolean),
])
const SAFE_PROFILE_FIELDS = 'user_id,nickname,school,email_discoverable,timezone,schedule_complete_through,semester_end,availability_preferences,updated_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class ApiError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status }
}

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function withCors(request: Request, result: Response) {
  const headers = new Headers(result.headers)
  const origin = request.headers.get('origin') || ''
  if (allowedOrigins.has(origin)) headers.set('Access-Control-Allow-Origin', origin)
  else headers.delete('Access-Control-Allow-Origin')
  headers.append('Vary', 'Origin')
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers })
}

function cleanText(value: unknown, max: number, label: string, required = false) {
  const result = String(value ?? '').trim()
  if (result.length > max || (required && !result)) throw new ApiError('invalid_input', `${label}格式不正确。`)
  return result
}

function assertUUID(value: unknown, label: string) {
  const id = String(value || '')
  if (!UUID_RE.test(id)) throw new ApiError('invalid_input', `${label}无效。`)
  return id
}

function assertRevision(value: unknown, label: string) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError('invalid_input', `${label}版本无效，请刷新后重试。`)
  return revision
}

function assertDraftRevision(value: unknown) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new ApiError('invalid_input', '草稿版本无效，请刷新后重试。')
  return revision
}

function assertDate(value: unknown, label: string, required = false) {
  const date = cleanText(value, 10, label, required)
  if (!date) return ''
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!DATE_RE.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ApiError('invalid_input', `${label}格式不正确。`)
  }
  return date
}

function assertTimestamp(value: unknown, label: string) {
  const text = cleanText(value, 64, label, true)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) throw new ApiError('invalid_input', `${label}必须包含时区信息。`)
  const epoch = Date.parse(text)
  if (!Number.isFinite(epoch)) throw new ApiError('invalid_input', `${label}格式不正确。`)
  return new Date(epoch).toISOString()
}

function normalizeAdjustmentData(type: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid_input', '调整内容格式不正确。')
  const data = value as Record<string, unknown>
  if (type === 'deadline_extension') return { dueOn: assertDate(data.dueOn, '新截止日期', true) }
  if (type === 'help' || type === 'handover') return { targetId: assertUUID(data.targetId, '协作成员') }
  if (type === 'scope_change') return { description: cleanText(data.description, 3000, '调整后的任务说明') }
  if (type === 'split') {
    if (!Array.isArray(data.subtasks) || data.subtasks.length < 1 || data.subtasks.length > 8) throw new ApiError('invalid_input', '任务拆分数量需要在 1 到 8 项之间。')
    return { subtasks: data.subtasks.map((item, index) => cleanText(item, 160, `子任务${index + 1}`, true)) }
  }
  if (type === 'unable_to_continue') return {}
  throw new ApiError('invalid_input', '调整类型无效。')
}

function normalizeDeliverableContent(value: unknown, projectId: string, deliverableId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid_input', '成果内容格式不正确。')
  const data = value as Record<string, unknown>
  const summary = cleanText(data.summary, 5000, '成果说明')
  const linksValue = Array.isArray(data.links) ? data.links : []
  const filesValue = Array.isArray(data.files) ? data.files : []
  if (linksValue.length > 10 || filesValue.length > 10) throw new ApiError('invalid_input', '每个版本最多包含 10 个链接和 10 个文件。')
  const links = linksValue.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ApiError('invalid_input', `第 ${index + 1} 个链接格式不正确。`)
    const item = entry as Record<string, unknown>
    const type = ['document', 'repository', 'commit', 'other'].includes(String(item.type)) ? String(item.type) : 'other'
    const url = cleanText(item.url, 2000, '成果链接', true)
    try { if (new URL(url).protocol !== 'https:') throw new Error('invalid protocol') }
    catch { throw new ApiError('invalid_input', '成果链接必须使用有效的 HTTPS 地址。') }
    return { type, title: cleanText(item.title, 160, '链接名称'), url }
  })
  const files = filesValue.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ApiError('invalid_input', `第 ${index + 1} 个文件格式不正确。`)
    const item = entry as Record<string, unknown>
    const path = cleanText(item.path, 700, '文件路径', true)
    if (!path.startsWith(`${projectId}/${deliverableId}/`) || path.includes('..')) throw new ApiError('invalid_input', '成果文件不属于当前交付项。')
    const size = Number(item.size)
    if (!Number.isSafeInteger(size) || size < 1 || size > 20 * 1024 * 1024) throw new ApiError('invalid_input', '成果文件不能超过 20 MB。')
    return { path, name: cleanText(item.name, 200, '文件名', true), size, mime: cleanText(item.mime, 120, '文件类型') }
  })
  return { summary, links, files }
}

function verified(user: any) {
  if (!user?.email_confirmed_at) throw new ApiError('email_verification_required', '请先完成邮箱验证，再使用好友协作。', 403)
}

async function authenticate(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new ApiError('unauthorized', '登录已失效，请重新登录。', 401)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) throw new ApiError('unauthorized', '登录已失效，请重新登录。', 401)
  return data.user
}

function dbError(error: any): never {
  const text = String(error?.message || '')
  const markers: Array<[string, string, string, number]> = [
    ['SOCIAL_RATE_LIMIT', 'rate_limited', '操作太频繁了，请稍后再试。', 429],
    ['SOCIAL_EMAIL_VERIFICATION_REQUIRED', 'email_verification_required', '请先完成邮箱验证，再使用好友协作。', 403],
    ['SOCIAL_TARGET_NOT_FOUND', 'not_found', '没有找到可添加的用户。对方可能未注册、未验证邮箱或关闭了邮箱发现。', 404],
    ['SOCIAL_SCHEDULE_UNKNOWN', 'schedule_unknown', '暂时无法确认双方的课表范围，请检查双方的课表完整日期后重试。', 409],
    ['SOCIAL_SCHEDULE_STALE', 'schedule_changed', '课表刚刚发生了变化，请刷新共同时间后重试。', 409],
    ['SOCIAL_INVITATION_CONFLICT', 'conflict', '这个时间已有新的安排，请刷新后重新选择。', 409],
    ['SOCIAL_FRIENDSHIP_REQUIRED', 'friendship_required', '只能向已添加的好友发起邀约。', 403],
    ['SOCIAL_PROFILE_REQUIRED', 'profile_required', '请先完成好友资料和课表范围设置。', 409],
    ['SOCIAL_FRIEND_NOT_FOUND', 'not_found', '好友关系已更新，请刷新列表。', 404],
    ['SOCIAL_REQUEST_NOT_FOUND', 'not_found', '好友请求已更新，请刷新列表。', 404],
    ['SOCIAL_INVITATION_NOT_FOUND', 'not_found', '邀约已更新，请刷新列表。', 404],
    ['SOCIAL_INVITATION_STATE_CHANGED', 'state_changed', '邀约状态已变化，请刷新后查看。', 409],
    ['SOCIAL_INVALID_TARGET', 'invalid_input', '操作对象无效。', 400],
    ['SOCIAL_INVALID_INVITATION', 'invalid_input', '邀约内容或时间无效。', 400],
    ['SOCIAL_INVALID_PROPOSAL', 'invalid_input', '改约时间无效。', 400],
    ['SOCIAL_INVALID_ACTION', 'invalid_input', '操作无效。', 400],
    ['QIXING_FORBIDDEN', 'forbidden', '你没有权限进行这项项目操作。', 403],
    ['QIXING_OWNER_REQUIRED', 'owner_required', '只有项目负责人可以进行这项操作。', 403],
    ['QIXING_OWNER_TRANSFER_REQUIRED', 'owner_transfer_required', '请先将项目负责人转交给其他成员，再退出项目。', 409],
    ['QIXING_NOT_MEMBER', 'not_member', '你已不在这个项目中，刷新后查看最新状态。', 403],
    ['QIXING_PROJECT_NOT_FOUND', 'project_not_found', '项目已删除或不可访问。', 404],
    ['QIXING_TASK_NOT_FOUND', 'task_not_found', '任务已更新或不可访问。', 404],
    ['QIXING_INVITE_NOT_FOUND', 'invite_not_found', '项目邀请已更新，请刷新后查看。', 404],
    ['QIXING_INVITE_LINK_INVALID', 'invite_link_invalid', '邀请链接无效、已过期或名额已用完。', 404],
    ['QIXING_TASK_NOT_ASSIGNED', 'task_not_assigned', '这个任务没有分配给你，或分工已发生变化。', 403],
    ['QIXING_ALREADY_MEMBER', 'already_member', '这位成员已经加入项目。', 409],
    ['QIXING_INVALID_MEMBER', 'invalid_member', '请选择项目中的有效成员。', 400],
    ['QIXING_PROJECT_NOT_ACTIVE', 'project_not_active', '项目已归档，当前不能新增成员或任务。', 409],
    ['QIXING_CONFLICT', 'conflict', '项目刚刚发生变化，请刷新后重新提交。', 409],
    ['QIXING_STATE_CHANGED', 'state_changed', '状态已变化，请刷新后查看。', 409],
    ['QIXING_INVALID_PROJECT', 'invalid_project', '项目信息不完整或格式不正确。', 400],
    ['QIXING_INVALID_TASK', 'invalid_task', '任务信息不完整或格式不正确。', 400],
    ['QIXING_INVALID_PARENT_TASK', 'invalid_parent_task', '子任务必须属于当前项目。', 400],
    ['QIXING_TASK_DEPENDENCY_CYCLE', 'dependency_cycle', '任务依赖不能形成循环，请调整前置任务。', 400],
    ['QIXING_DEPENDENCY_INVALID', 'invalid_dependency', '请选择当前项目中的其他任务作为前置任务。', 400],
    ['QIXING_TASK_DEPENDENCY_BLOCKED', 'dependency_blocked', '前置任务尚未完成，开始或完成此任务前请先处理前置任务。', 409],
    ['QIXING_TASK_DEPENDENCY_IN_USE', 'dependency_in_use', '已有已完成任务依赖此任务，暂不能将它重新打开。', 409],
    ['QIXING_INVALID_INVITE_LINK', 'invalid_invite_link', '邀请链接设置无效。', 400],
    ['QIXING_PROJECT_ID_CONFLICT', 'conflict', '项目创建状态已变化，请刷新后查看。', 409],
    ['QIXING_TASK_ID_CONFLICT', 'conflict', '任务创建状态已变化，请刷新后查看。', 409],
    ['QIXING_INVALID_ACTION', 'invalid_input', '项目操作无效。', 400],
    ['QIXING_INVALID_REQUEST', 'invalid_input', '项目请求内容无效。', 400],
    ['QIXING_USE_TASK_EDIT', 'invalid_input', '请直接在任务中编辑；协商流程用于其他成员参与的调整。', 400],
    ['QIXING_DUPLICATE_ADJUSTMENT', 'conflict', '这项任务已有待处理的同类申请。', 409],
    ['QIXING_REQUEST_NOT_FOUND', 'not_found', '申请已更新或不可访问。', 404],
    ['QIXING_INVALID_DELIVERABLE', 'invalid_deliverable', '交付内容格式不正确，请检查后重试。', 400],
    ['QIXING_DUPLICATE_DELIVERABLE', 'conflict', '这个任务已经关联交付项。', 409],
    ['QIXING_DELIVERABLE_NOT_FOUND', 'deliverable_not_found', '交付项已更新或不可访问。', 404],
    ['QIXING_VERSION_NOT_FOUND', 'version_not_found', '成果版本已更新或不可访问。', 404],
    ['QIXING_DRAFT_REQUIRED', 'draft_required', '请先保存成果草稿，再正式提交。', 409],
    ['QIXING_REVIEW_PENDING', 'review_pending', '已有成果正在等待验收，请先完成当前验收。', 409],
    ['QIXING_INVALID_REVIEW', 'invalid_review', '验收意见或检查清单格式不正确。', 400],
    ['QIXING_SELF_REVIEW', 'forbidden', '提交人不能验收自己的成果。', 403],
    ['QIXING_REVIEW_REQUIRED', 'review_required', '关联成果尚未通过验收，暂不能完成此任务。', 409],
    ['QIXING_INVALID_MILESTONE', 'invalid_milestone', '里程碑名称或说明格式不正确。', 400],
    ['QIXING_MILESTONE_NOT_FOUND', 'milestone_not_found', '里程碑已更新或不可访问。', 404],
    ['QIXING_INVALID_DELIVERY_CHECK', 'invalid_delivery_check', '交付检查项格式不正确。', 400],
    ['QIXING_DELIVERY_CHECK_NOT_FOUND', 'delivery_check_not_found', '交付检查项已更新或不可访问。', 404],
    ['QIXING_INVALID_MEETING', 'invalid_meeting', '讨论时间或邀请内容不正确。', 400],
    ['QIXING_MEETING_NOT_FOUND', 'meeting_not_found', '讨论邀请已更新或不可访问。', 404],
    ['QIXING_MEETING_NOT_READY', 'meeting_not_ready', '还有成员没有接受当前时间，暂时不能确认日程。', 409],
    ['QIXING_MEETING_SLOT_CONFLICT', 'meeting_conflict', '所选时段不在所有成员的共同空闲中，请刷新或发起手动讨论邀约。', 409],
  ]
  for (const [marker, code, message, status] of markers) if (text.includes(marker)) throw new ApiError(code, message, status)
  console.error('[campus-social] database operation failed', error?.code || 'unknown')
  throw new ApiError('service_unavailable', '操作没有完成，请稍后重试。', 503)
}

async function dispatch(userId: string, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('social_dispatch', { p_action: action, p_actor_id: userId, p_payload: payload })
  if (error) dbError(error)
  return data
}

async function projectDispatch(userId: string, action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('project_dispatch', { p_action: action, p_actor_id: userId, p_payload: payload })
  if (error) dbError(error)
  return data
}

async function projectAvailability(userId: string, projectId: string, requestedDays: unknown) {
  const days = [7, 14, 30].includes(Number(requestedDays)) ? Number(requestedDays) : 7
  const memberResult = await projectDispatch(userId, 'time_members', { projectId })
  const people = Array.isArray(memberResult?.members) ? memberResult.members : []
  if (people.length < 2) return { known: true, intervals: [], people, range: null, minimumMinutes: 90 }
  if (people.length > 30) return { known: false, intervals: [], people, range: null, reason: 'team_too_large' }
  await dispatch(userId, 'availability_rate_limit')
  const userIds = people.map((item: any) => String(item.userId))
  const [profileResult, snapshotResult, socialParticipantResult, meetingParticipantResult] = await Promise.all([
    admin.from('social_profiles').select('user_id,timezone,schedule_complete_through,semester_end,availability_preferences,updated_at').in('user_id', userIds),
    admin.from('account_sync_snapshots').select('user_id,revision,payload').in('user_id', userIds),
    admin.from('social_invitation_participants').select('user_id,invitation_id').in('user_id', userIds),
    admin.from('team_project_meeting_participants').select('user_id,meeting_id').in('user_id', userIds).eq('status', 'accepted'),
  ])
  for (const result of [profileResult, snapshotResult, socialParticipantResult, meetingParticipantResult]) if (result.error) dbError(result.error)
  const profiles = profileResult.data || []
  const snapshots = snapshotResult.data || []
  if (profiles.length !== userIds.length || snapshots.length !== userIds.length) {
    return { known: false, intervals: [], people, range: null, reason: 'schedule_incomplete' }
  }
  const self = profiles.find((profile: any) => profile.user_id === userId)
  let range
  try { range = localDayRange(self?.timezone || 'Asia/Shanghai', days) }
  catch { return { known: false, intervals: [], people, range: null, reason: 'schedule_incomplete' } }
  const snapshotById = new Map(snapshots.map((snapshot: any) => [snapshot.user_id, snapshot]))
  const profileById = new Map(profiles.map((profile: any) => [profile.user_id, profile]))
  const socialInviteIds = [...new Set((socialParticipantResult.data || []).map((row: any) => row.invitation_id))]
  const teamMeetingIds = [...new Set((meetingParticipantResult.data || []).map((row: any) => row.meeting_id))]
  const [socialInviteResult, teamMeetingResult] = await Promise.all([
    socialInviteIds.length ? admin.from('social_invitations').select('id,starts_at,ends_at').in('id', socialInviteIds).eq('status', 'confirmed').gte('ends_at', new Date().toISOString()) : Promise.resolve({ data: [], error: null }),
    teamMeetingIds.length ? admin.from('team_project_meetings').select('id,starts_at,ends_at').in('id', teamMeetingIds).eq('status', 'confirmed').gte('ends_at', new Date().toISOString()) : Promise.resolve({ data: [], error: null }),
  ])
  if (socialInviteResult.error) dbError(socialInviteResult.error)
  if (teamMeetingResult.error) dbError(teamMeetingResult.error)
  const socialInviteRows = socialInviteResult.data || []
  const meetingById = new Map((teamMeetingResult.data || []).map((item: any) => [item.id, item]))
  const meetingsByUser = new Map<string, any[]>()
  for (const participant of meetingParticipantResult.data || []) {
    const meeting = meetingById.get(participant.meeting_id)
    if (!meeting) continue
    const rows = meetingsByUser.get(participant.user_id) || []
    rows.push({ starts_at: meeting.starts_at, ends_at: meeting.ends_at })
    meetingsByUser.set(participant.user_id, rows)
  }
  let combined: Array<{ start: number; end: number }> | null = null
  let minimumMinutes = 30
  const revisions: Record<string, unknown> = {}
  for (const id of userIds) {
    const profile = profileById.get(id)
    const snapshot = snapshotById.get(id)
    const personInvites = (socialParticipantResult.data || [])
      .filter((row: any) => row.user_id === id)
      .map((row: any) => socialInviteRows.find((invite: any) => invite.id === row.invitation_id))
      .filter(Boolean)
    const free = userFreeIntervals({ snapshot, profile, confirmedInvitations: [...personInvites, ...(meetingsByUser.get(id) || [])] }, range)
    if (!free.known) return { known: false, intervals: [], people, range: { startDate: range.startDate, endDateExclusive: range.endDateExclusive }, reason: 'schedule_incomplete' }
    combined = combined === null ? free.intervals : intersectIntervals(combined, free.intervals)
    minimumMinutes = Math.max(minimumMinutes, free.minimumMinutes || 90)
    revisions[id] = { revision: free.revision, profileUpdatedAt: profile.updated_at }
  }
  const intervals = (combined || []).filter((item) => item.end - item.start >= minimumMinutes * 60_000)
    .map((item) => ({ startsAt: new Date(item.start).toISOString(), endsAt: new Date(item.end).toISOString() }))
  return { known: true, intervals, people, minimumMinutes, revisions, range: { startDate: range.startDate, endDateExclusive: range.endDateExclusive } }
}

async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function getProfile(userId: string) {
  const { data, error } = await admin.from('social_profiles').select(SAFE_PROFILE_FIELDS).eq('user_id', userId).maybeSingle()
  if (error) dbError(error)
  return data
}

async function getProfiles(userIds: string[]) {
  const ids = [...new Set(userIds)]
  if (!ids.length) return []
  const { data, error } = await admin.from('social_profiles').select(SAFE_PROFILE_FIELDS).in('user_id', ids)
  if (error) dbError(error)
  return data || []
}

function profileView(profile: any) {
  if (!profile) return null
  return {
    userId: profile.user_id || profile.userId, nickname: profile.nickname, school: profile.school || '',
    emailDiscoverable: profile.email_discoverable, timezone: profile.timezone,
    scheduleCompleteThrough: profile.schedule_complete_through,
    semesterEnd: profile.semester_end,
    availabilityPreferences: profile.availability_preferences,
    updatedAt: profile.updated_at,
  }
}

function friendView(profile: any) {
  if (!profile) return null
  return {
    userId: profile.user_id || profile.userId,
    nickname: profile.nickname,
    school: profile.school || '',
  }
}

async function requireProfiles(userIds: string[]) {
  const profiles = await getProfiles(userIds)
  const byId = new Map(profiles.map((profile: any) => [profile.user_id, profile]))
  if (userIds.some((id) => !byId.has(id))) throw new ApiError('profile_required', '双方都需要先设置昵称并确认课表完整日期。', 409)
  const ordered = userIds.map((id) => byId.get(id))
  if (ordered.some((profile: any) => !profile.schedule_complete_through || !profile.semester_end)) {
    throw new ApiError('profile_required', '双方都需要设置课表完整日期和学期结束日。', 409)
  }
  return ordered
}

async function requireFriendship(userId: string, friendId: string) {
  const [low, high] = userId < friendId ? [userId, friendId] : [friendId, userId]
  const { data, error } = await admin.from('social_friendships').select('user_low').eq('user_low', low).eq('user_high', high).maybeSingle()
  if (error) dbError(error)
  if (!data) throw new ApiError('friendship_required', '只能与已添加的好友匹配共同时间。', 403)
}

async function listFriends(userId: string) {
  const [lowRows, highRows, incoming, outgoing] = await Promise.all([
    admin.from('social_friendships').select('user_low,user_high,created_at').eq('user_low', userId),
    admin.from('social_friendships').select('user_low,user_high,created_at').eq('user_high', userId),
    admin.from('social_friend_requests').select('id,requester_id,recipient_id,status,created_at').eq('recipient_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
    admin.from('social_friend_requests').select('id,requester_id,recipient_id,status,created_at').eq('requester_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
  ])
  for (const result of [lowRows, highRows, incoming, outgoing]) if (result.error) dbError(result.error)
  const rows = [...(lowRows.data || []), ...(highRows.data || [])]
  const ids = rows.map((row: any) => row.user_low === userId ? row.user_high : row.user_low)
  const requestIds = [...(incoming.data || []), ...(outgoing.data || [])].map((row: any) => row.requester_id === userId ? row.recipient_id : row.requester_id)
  const profiles = await getProfiles([...ids, ...requestIds])
  const byId = new Map(profiles.map((profile: any) => [profile.user_id, friendView(profile)]))
  return {
    friends: rows.map((row: any) => ({ profile: byId.get(row.user_low === userId ? row.user_high : row.user_low), createdAt: row.created_at })),
    incoming: (incoming.data || []).map((row: any) => ({ id: row.id, createdAt: row.created_at, profile: byId.get(row.requester_id) })),
    outgoing: (outgoing.data || []).map((row: any) => ({ id: row.id, createdAt: row.created_at, profile: byId.get(row.recipient_id) })),
  }
}

async function getActiveInvitations(userId: string) {
  const { data: participants, error: participantError } = await admin.from('social_invitation_participants')
    .select('invitation_id').eq('user_id', userId)
  if (participantError) dbError(participantError)
  const ids = [...new Set((participants || []).map((row: any) => row.invitation_id))]
  if (!ids.length) return []
  const { data, error } = await admin.from('social_invitations').select('starts_at,ends_at')
    .in('id', ids).eq('status', 'confirmed').gte('ends_at', new Date().toISOString())
  if (error) dbError(error)
  return data || []
}

async function loadPair(userIds: string[], range: { start: number; end: number }) {
  const [profiles, snapshots, firstInvites, secondInvites] = await Promise.all([
    requireProfiles(userIds),
    admin.from('account_sync_snapshots').select('user_id,revision,payload').in('user_id', userIds),
    getActiveInvitations(userIds[0]), getActiveInvitations(userIds[1]),
  ])
  if (snapshots.error) dbError(snapshots.error)
  const byId = new Map((snapshots.data || []).map((snapshot: any) => [snapshot.user_id, snapshot]))
  if (userIds.some((id) => !byId.has(id))) throw new ApiError('schedule_unknown', '双方账号的课表同步还没有完成。请先同步课表再试。', 409)
  const inviteLists = [firstInvites, secondInvites]
  const pair = profiles.map((profile: any, index: number) => ({
    profile,
    snapshot: byId.get(userIds[index]),
    confirmedInvitations: inviteLists[index],
  }))
  return { pair, profiles }
}

async function availability(userId: string, payload: any) {
  const friendId = assertUUID(payload.friendId, '好友')
  if (friendId === userId) throw new ApiError('invalid_input', '请选择一位好友。')
  await requireFriendship(userId, friendId)
  await dispatch(userId, 'availability_rate_limit')
  const [profile, friendProfile] = await requireProfiles([userId, friendId])
  const days = [7, 14, 30].includes(Number(payload.days)) ? Number(payload.days) : 7
  let range
  try { range = localDayRange(profile.timezone || 'Asia/Shanghai', days) } catch { throw new ApiError('profile_required', '请先设置有效的时区。', 409) }
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) throw new ApiError('profile_required', '请先设置有效的时区。', 409)
  const loaded = await loadPair([userId, friendId], range)
  const result = mutualFreeIntervals(loaded.pair[0], loaded.pair[1], range)
  if (!result.known) return { known: false, intervals: [], range: { startDate: range.startDate, endDateExclusive: range.endDateExclusive } }
  return {
    known: true,
    intervals: result.intervals.map((item: any) => ({ startsAt: new Date(item.start).toISOString(), endsAt: new Date(item.end).toISOString() })),
    minimumMinutes: result.minimumMinutes,
    revisions: result.revisions,
    range: { startDate: range.startDate, endDateExclusive: range.endDateExclusive },
    people: loaded.profiles.map((item: any) => ({ userId: item.user_id, nickname: item.nickname, school: item.school || '' })),
  }
}

async function checkInterval(userIds: string[], startText: string, endText: string) {
  const [first, second] = await requireProfiles(userIds)
  let range
  try { range = invitationRange(startText, endText, first.timezone || 'Asia/Shanghai') } catch { range = null }
  if (!range) throw new ApiError('invalid_input', '邀约时间无效或超过 12 小时。')
  const loaded = await loadPair(userIds, range)
  const result = mutualFreeIntervals(loaded.pair[0], loaded.pair[1], range)
  if (!result.known) throw new ApiError('schedule_unknown', '请先确认双方课表完整日期覆盖这次邀约时间。', 409)
  if (range.end - range.start < result.minimumMinutes * 60_000) {
    throw new ApiError('invalid_input', `邀约时长至少需要 ${result.minimumMinutes} 分钟。`)
  }
  if (!intervalIsAvailable(result.intervals, range.start, range.end)) {
    throw new ApiError('conflict', '这个时间已不在双方共同空闲范围内，请刷新后重新选择。', 409)
  }
  return result.revisions
}

async function invitationForActor(userId: string, invitationId: string) {
  const { data: self, error: selfError } = await admin.from('social_invitation_participants')
    .select('invitation_id,role,status,proposed_starts_at,proposed_ends_at').eq('invitation_id', invitationId).eq('user_id', userId).maybeSingle()
  if (selfError) dbError(selfError)
  if (!self) throw new ApiError('not_found', '邀约已更新，请刷新列表。', 404)
  const { data: peers, error: peerError } = await admin.from('social_invitation_participants')
    .select('user_id,role,status,proposed_starts_at,proposed_ends_at').eq('invitation_id', invitationId).neq('user_id', userId).limit(1)
  if (peerError) dbError(peerError)
  const peer = peers?.[0]
  if (!peer) throw new ApiError('not_found', '邀约已更新，请刷新列表。', 404)
  const { data: invite, error: inviteError } = await admin.from('social_invitations').select('id,status,starts_at,ends_at')
    .eq('id', invitationId).maybeSingle()
  if (inviteError) dbError(inviteError)
  if (!invite) throw new ApiError('not_found', '邀约已更新，请刷新列表。', 404)
  return { self, peer, invite }
}

async function respondInvitation(userId: string, payload: any) {
  const invitationId = assertUUID(payload.invitationId, '邀约')
  const decision = String(payload.decision || '')
  const record = await invitationForActor(userId, invitationId)
  let revisions = undefined
  if (decision === 'accept') revisions = await checkInterval([userId, record.peer.user_id], record.invite.starts_at, record.invite.ends_at)
  if (decision === 'propose_change') revisions = await checkInterval([userId, record.peer.user_id], payload.startsAt, payload.endsAt)
  if (decision === 'accept_change') {
    const start = record.peer.proposed_starts_at; const end = record.peer.proposed_ends_at
    if (!start || !end) throw new ApiError('state_changed', '已没有待确认的改约时间。', 409)
    revisions = await checkInterval([userId, record.peer.user_id], start, end)
  }
  return dispatch(userId, 'respond_invitation', { ...payload, invitationId, decision, revisions })
}

async function createInvitation(userId: string, payload: any) {
  const guestId = assertUUID(payload.guestId, '好友')
  await requireFriendship(userId, guestId)
  const revisions = await checkInterval([userId, guestId], String(payload.startsAt || ''), String(payload.endsAt || ''))
  return dispatch(userId, 'create_invitation', {
    guestId,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    activityType: cleanText(payload.activityType || 'custom', 20, '活动类型', true),
    title: cleanText(payload.title, 80, '标题', true),
    location: cleanText(payload.location, 160, '地点'),
    note: cleanText(payload.note, 500, '备注'),
    revisions,
  })
}

async function listInvitations(userId: string) {
  await dispatch(userId, 'expire_invitations')
  const { data: ownRows, error: ownError } = await admin.from('social_invitation_participants')
    .select('invitation_id,user_id,role,status,proposed_starts_at,proposed_ends_at,responded_at').eq('user_id', userId)
  if (ownError) dbError(ownError)
  const ids = [...new Set((ownRows || []).map((row: any) => row.invitation_id))]
  if (!ids.length) return { invitations: [] }
  const [{ data: invitations, error: inviteError }, { data: participants, error: participantsError }] = await Promise.all([
    admin.from('social_invitations').select('id,created_by,activity_type,title,starts_at,ends_at,location,note,status,expires_at,revision,created_at,updated_at').in('id', ids).order('starts_at', { ascending: true }).limit(100),
    admin.from('social_invitation_participants').select('invitation_id,user_id,role,status,proposed_starts_at,proposed_ends_at,responded_at').in('invitation_id', ids),
  ])
  if (inviteError) dbError(inviteError)
  if (participantsError) dbError(participantsError)
  const peerIds = (participants || []).filter((item: any) => item.user_id !== userId).map((item: any) => item.user_id)
  const profiles = await getProfiles(peerIds)
  const profileMap = new Map(profiles.map((item: any) => [item.user_id, friendView(item)]))
  const ownMap = new Map((ownRows || []).map((item: any) => [item.invitation_id, item]))
  const peersByInvite = new Map((participants || []).filter((item: any) => item.user_id !== userId).map((item: any) => [item.invitation_id, item]))
  return {
    invitations: (invitations || []).map((invite: any) => ({
      ...invite,
      self: ownMap.get(invite.id),
      peer: { ...peersByInvite.get(invite.id), profile: profileMap.get(peersByInvite.get(invite.id)?.user_id) || null },
    })),
  }
}

async function saveProfile(user: any, payload: any) {
  const userId = user.id
  const nickname = cleanText(payload.nickname, 32, '昵称', true)
  const school = cleanText(payload.school, 100, '学校')
  const timezone = cleanText(payload.timezone || 'Asia/Shanghai', 64, '时区', true)
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()) } catch { throw new ApiError('invalid_input', '请选择有效的时区。') }
  if (payload.emailDiscoverable === true) verified(user)
  const complete = String(payload.scheduleCompleteThrough || '')
  const semesterEnd = String(payload.semesterEnd || '')
  const completeMs = DATE_RE.test(complete) ? Date.parse(`${complete}T00:00:00Z`) : Number.NaN
  if (!Number.isFinite(completeMs) || new Date(completeMs).toISOString().slice(0, 10) !== complete) {
    throw new ApiError('invalid_input', '请选择有效的课表完整日期。')
  }
  const semesterEndMs = DATE_RE.test(semesterEnd) ? Date.parse(`${semesterEnd}T00:00:00Z`) : Number.NaN
  if (!Number.isFinite(semesterEndMs) || new Date(semesterEndMs).toISOString().slice(0, 10) !== semesterEnd) {
    throw new ApiError('invalid_input', '请选择有效的学期结束日期。')
  }
  const raw = payload.availabilityPreferences || {}
  const start = String(raw.startTime || '09:00')
  const end = String(raw.endTime || '22:00')
  const parseMinutes = (value: string) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value)
    return match && Number(match[1]) <= 23 && Number(match[2]) <= 59 ? Number(match[1]) * 60 + Number(match[2]) : -1
  }
  const minimum = Number(raw.minimumMinutes ?? 90)
  const buffer = Number(raw.classBufferMinutes ?? 30)
  if (parseMinutes(start) < 0 || parseMinutes(end) <= parseMinutes(start)
      || !Number.isInteger(minimum) || minimum < 30 || minimum > 720
      || !Number.isInteger(buffer) || buffer < 0 || buffer > 180) throw new ApiError('invalid_input', '可约时间偏好不正确。')
  const row = {
    user_id: userId, nickname, school, email_discoverable: payload.emailDiscoverable === true,
    timezone, schedule_complete_through: complete, semester_end: semesterEnd,
    availability_preferences: {
      startTime: start, endTime: end, minimumMinutes: minimum, classBufferMinutes: buffer,
      includeWeekends: raw.includeWeekends !== false,
    },
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin.from('social_profiles').upsert(row, { onConflict: 'user_id' }).select(SAFE_PROFILE_FIELDS).single()
  if (error) dbError(error)
  return { profile: profileView(data) }
}

async function listNotifications(userId: string) {
  const { data, error } = await admin.from('social_notifications').select('id,actor_id,kind,resource_id,created_at,read_at')
    .eq('recipient_id', userId).order('created_at', { ascending: false }).limit(50)
  if (error) dbError(error)
  const actorIds = (data || []).map((item: any) => item.actor_id).filter(Boolean)
  const profiles = await getProfiles(actorIds)
  const byId = new Map(profiles.map((profile: any) => [profile.user_id, friendView(profile)]))
  const items = (data || []).map((item: any) => ({ ...item, actor: byId.get(item.actor_id) || null }))
  return { notifications: items, unread: items.filter((item: any) => !item.read_at).length }
}

async function markNotificationsRead(userId: string, payload: any) {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter((item: any) => UUID_RE.test(String(item))).slice(0, 50) : []
  if (!ids.length) return { updated: 0 }
  const { data, error } = await admin.from('social_notifications').update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId).in('id', ids).is('read_at', null).select('id')
  if (error) dbError(error)
  return { updated: data?.length || 0 }
}

async function handle(user: any, action: string, payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('invalid_input', '请求内容无效。')
  if (action === 'profile_get') return { profile: profileView(await getProfile(user.id)) }
  if (action === 'profile_save') return saveProfile(user, payload)
  verified(user)
  switch (action) {
    case 'email_search': {
      const email = cleanText(payload.email, 254, '邮箱', true).toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('invalid_input', '请输入完整邮箱地址。')
      const result = await dispatch(user.id, 'email_search', { email })
      return { profile: friendView(result?.profile) }
    }
    case 'friends_list': return listFriends(user.id)
    case 'friend_request_send': return dispatch(user.id, 'send_friend_request', { targetId: assertUUID(payload.targetId, '用户') })
    case 'friend_request_respond': return dispatch(user.id, 'respond_friend_request', {
      requestId: assertUUID(payload.requestId, '好友请求'), decision: ['accept', 'reject', 'withdraw'].includes(payload.decision) ? payload.decision : '',
    })
    case 'friend_remove': return dispatch(user.id, 'remove_friend', { friendId: assertUUID(payload.friendId, '好友') })
    case 'availability_query': return availability(user.id, payload)
    case 'invitations_list': return listInvitations(user.id)
    case 'invitation_create': return createInvitation(user.id, payload)
    case 'invitation_respond': return respondInvitation(user.id, payload)
    case 'invitation_cancel': return dispatch(user.id, 'cancel_invitation', { invitationId: assertUUID(payload.invitationId, '邀约') })
    case 'notifications_list': return listNotifications(user.id)
    case 'notifications_mark_read': return markNotificationsRead(user.id, payload)
    case 'project_time_availability': return projectAvailability(user.id, assertUUID(payload.projectId, '项目'), payload.days)
    case 'project_meetings_list': return projectDispatch(user.id, 'meetings_list', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_meeting_create': {
      const projectId = assertUUID(payload.projectId, '项目')
      const startsAt = assertTimestamp(payload.startsAt, '开始时间')
      const endsAt = assertTimestamp(payload.endsAt, '结束时间')
      const start = Date.parse(startsAt)
      const end = Date.parse(endsAt)
      if (start <= Date.now() || end <= start || end - start > 8 * 60 * 60_000) throw new ApiError('invalid_input', '讨论时间必须在未来，且不能超过 8 小时。')
      const availability = await projectAvailability(user.id, projectId, 30)
      if (availability.known) {
        const intervals = availability.intervals.map((item: any) => ({ start: Date.parse(item.startsAt), end: Date.parse(item.endsAt) }))
        if (!intervalIsAvailable(intervals, start, end)) throw new ApiError('meeting_conflict', '所选时段不在所有成员的共同空闲中，请刷新时段或等待成员手动回应。', 409)
      }
      return projectDispatch(user.id, 'meeting_create', {
        id: assertUUID(payload.id, '讨论'), projectId,
        title: cleanText(payload.title, 160, '讨论主题', true), note: cleanText(payload.note, 1500, '讨论说明'),
        startsAt, endsAt,
      })
    }
    case 'project_meeting_respond': {
      const responseType = ['accept', 'decline', 'propose'].includes(payload.response) ? payload.response : ''
      const proposedStartsAt = responseType === 'propose' ? assertTimestamp(payload.proposedStartsAt, '建议开始时间') : ''
      const proposedEndsAt = responseType === 'propose' ? assertTimestamp(payload.proposedEndsAt, '建议结束时间') : ''
      if (responseType === 'propose' && (Date.parse(proposedStartsAt) <= Date.now() || Date.parse(proposedEndsAt) <= Date.parse(proposedStartsAt) || Date.parse(proposedEndsAt) - Date.parse(proposedStartsAt) > 8 * 60 * 60_000)) {
        throw new ApiError('invalid_input', '建议时间必须在未来，且不能超过 8 小时。')
      }
      return projectDispatch(user.id, 'meeting_respond', {
        projectId: assertUUID(payload.projectId, '项目'), meetingId: assertUUID(payload.meetingId, '讨论'),
        response: responseType, proposedStartsAt, proposedEndsAt,
      })
    }
    case 'project_meeting_confirm': return projectDispatch(user.id, 'meeting_confirm', {
      projectId: assertUUID(payload.projectId, '项目'), meetingId: assertUUID(payload.meetingId, '讨论'),
    })
    case 'project_meeting_apply_proposal': return projectDispatch(user.id, 'meeting_apply_proposal', {
      projectId: assertUUID(payload.projectId, '项目'), meetingId: assertUUID(payload.meetingId, '讨论'),
      participantId: assertUUID(payload.participantId, '成员'),
    })
    case 'project_meeting_cancel': return projectDispatch(user.id, 'meeting_cancel', {
      projectId: assertUUID(payload.projectId, '项目'), meetingId: assertUUID(payload.meetingId, '讨论'),
    })
    case 'project_list': return projectDispatch(user.id, 'list')
    case 'project_inbox': return projectDispatch(user.id, 'inbox')
    case 'project_detail': return projectDispatch(user.id, 'detail', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_create': return projectDispatch(user.id, 'create', {
      id: assertUUID(payload.id, '项目'), name: cleanText(payload.name, 120, '项目名称', true),
      description: cleanText(payload.description, 2000, '项目说明'), type: cleanText(payload.type, 24, '项目类型'),
      startsOn: cleanText(payload.startsOn, 10, '开始日期'), targetEndOn: cleanText(payload.targetEndOn, 10, '预计结束日期'),
    })
    case 'project_update': return projectDispatch(user.id, 'update', {
      projectId: assertUUID(payload.projectId, '项目'), expectedRevision: assertRevision(payload.expectedRevision, '项目'),
      name: cleanText(payload.name, 120, '项目名称', true), description: cleanText(payload.description, 2000, '项目说明'),
      type: cleanText(payload.type, 24, '项目类型'), startsOn: cleanText(payload.startsOn, 10, '开始日期'),
      targetEndOn: cleanText(payload.targetEndOn, 10, '预计结束日期'),
    })
    case 'project_archive': return projectDispatch(user.id, 'archive', {
      projectId: assertUUID(payload.projectId, '项目'), archived: payload.archived === true,
    })
    case 'project_delete': return projectDispatch(user.id, 'delete', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_restore': return projectDispatch(user.id, 'restore', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_invite_member': {
      const targetId = assertUUID(payload.targetId, '成员')
      if (targetId === user.id) throw new ApiError('invalid_input', '不能邀请自己。')
      const { data, error } = await admin.auth.admin.getUserById(targetId)
      if (error || !data?.user?.email_confirmed_at) throw new ApiError('invalid_member', '只能邀请已完成邮箱验证的账号。', 400)
      return projectDispatch(user.id, 'member_invite', { projectId: assertUUID(payload.projectId, '项目'), targetId })
    }
    case 'project_invites': return projectDispatch(user.id, 'invite_links', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_invite_link_create': {
      const token = cleanText(payload.token, 64, '邀请链接', true)
      if (!/^[0-9a-f]{64}$/.test(token)) throw new ApiError('invalid_input', '邀请链接格式无效。')
      return projectDispatch(user.id, 'invite_link_create', {
        id: assertUUID(payload.id, '邀请链接'), projectId: assertUUID(payload.projectId, '项目'),
        tokenHash: await hashInviteToken(token), expiresAt: cleanText(payload.expiresAt, 40, '邀请有效期', true),
        maxUses: Number(payload.maxUses),
      })
    }
    case 'project_invite_link_revoke': return projectDispatch(user.id, 'invite_link_revoke', {
      projectId: assertUUID(payload.projectId, '项目'), linkId: assertUUID(payload.linkId, '邀请链接'),
    })
    case 'project_invite_join': {
      const token = cleanText(payload.token, 64, '邀请链接', true)
      if (!/^[0-9a-f]{64}$/.test(token)) throw new ApiError('invite_link_invalid', '邀请链接无效或已过期。', 404)
      return projectDispatch(user.id, 'invite_join', { tokenHash: await hashInviteToken(token) })
    }
    case 'project_invite_respond': return projectDispatch(user.id, 'invite_respond', {
      projectId: assertUUID(payload.projectId, '项目'), decision: ['accept', 'decline'].includes(payload.decision) ? payload.decision : '',
    })
    case 'project_member_leave': return projectDispatch(user.id, 'member_leave', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_member_remove': return projectDispatch(user.id, 'member_remove', {
      projectId: assertUUID(payload.projectId, '项目'), targetId: assertUUID(payload.targetId, '成员'),
    })
    case 'project_member_role_update': return projectDispatch(user.id, 'member_role_update', {
      projectId: assertUUID(payload.projectId, '项目'), targetId: assertUUID(payload.targetId, '成员'),
      role: ['admin', 'member'].includes(payload.role) ? payload.role : '',
    })
    case 'project_owner_transfer': return projectDispatch(user.id, 'owner_transfer', {
      projectId: assertUUID(payload.projectId, '项目'), targetId: assertUUID(payload.targetId, '负责人'),
    })
    case 'project_task_create': return projectDispatch(user.id, 'task_create', {
      projectId: assertUUID(payload.projectId, '项目'), id: assertUUID(payload.id, '任务'),
      parentTaskId: payload.parentTaskId ? assertUUID(payload.parentTaskId, '父任务') : '',
      milestoneId: payload.milestoneId ? assertUUID(payload.milestoneId, '里程碑') : '',
      dependsOnTaskId: payload.dependsOnTaskId ? assertUUID(payload.dependsOnTaskId, '前置任务') : '',
      assigneeId: payload.assigneeId ? assertUUID(payload.assigneeId, '负责人') : '',
      title: cleanText(payload.title, 160, '任务标题', true), description: cleanText(payload.description, 3000, '任务说明'),
      dueOn: cleanText(payload.dueOn, 10, '截止日期'), priority: cleanText(payload.priority, 12, '优先级'),
    })
    case 'project_task_update': return projectDispatch(user.id, 'task_update', {
      projectId: assertUUID(payload.projectId, '项目'), taskId: assertUUID(payload.taskId, '任务'),
      expectedRevision: assertRevision(payload.expectedRevision, '任务'), title: cleanText(payload.title, 160, '任务标题', true),
      description: cleanText(payload.description, 3000, '任务说明'), dueOn: cleanText(payload.dueOn, 10, '截止日期'),
      priority: cleanText(payload.priority, 12, '优先级'),
      ...(Object.hasOwn(payload, 'milestoneId') ? { milestoneId: payload.milestoneId ? assertUUID(payload.milestoneId, '里程碑') : '' } : {}),
      ...(Object.hasOwn(payload, 'dependsOnTaskId') ? { dependsOnTaskId: payload.dependsOnTaskId ? assertUUID(payload.dependsOnTaskId, '前置任务') : '' } : {}),
      ...(Object.hasOwn(payload, 'assigneeId') ? { assigneeId: payload.assigneeId ? assertUUID(payload.assigneeId, '负责人') : '' } : {}),
    })
    case 'project_task_respond': return projectDispatch(user.id, 'task_respond', {
      projectId: assertUUID(payload.projectId, '项目'), taskId: assertUUID(payload.taskId, '任务'),
      decision: ['accept', 'decline'].includes(payload.decision) ? payload.decision : '',
    })
    case 'project_task_status': return projectDispatch(user.id, 'task_status', {
      projectId: assertUUID(payload.projectId, '项目'), taskId: assertUUID(payload.taskId, '任务'),
      status: cleanText(payload.status, 24, '任务状态', true),
    })
    case 'project_task_personal_sync': return projectDispatch(user.id, 'task_personal_sync', {
      projectId: assertUUID(payload.projectId, '项目'), taskId: assertUUID(payload.taskId, '任务'),
      status: cleanText(payload.status, 24, '任务状态', true),
    })
    case 'project_task_events': return projectDispatch(user.id, 'task_events', {
      projectId: assertUUID(payload.projectId, '项目'), taskId: assertUUID(payload.taskId, '任务'),
    })
    case 'project_milestone_create': return projectDispatch(user.id, 'milestone_create', {
      projectId: assertUUID(payload.projectId, '项目'), id: assertUUID(payload.id, '里程碑'),
      title: cleanText(payload.title, 160, '里程碑名称', true), description: cleanText(payload.description, 2000, '里程碑说明'),
      dueOn: assertDate(payload.dueOn, '里程碑日期'),
    })
    case 'project_milestone_update': return projectDispatch(user.id, 'milestone_update', {
      projectId: assertUUID(payload.projectId, '项目'), milestoneId: assertUUID(payload.milestoneId, '里程碑'),
      expectedRevision: assertRevision(payload.expectedRevision, '里程碑'),
      title: cleanText(payload.title, 160, '里程碑名称', true), description: cleanText(payload.description, 2000, '里程碑说明'),
      dueOn: assertDate(payload.dueOn, '里程碑日期'),
    })
    case 'project_milestone_toggle': return projectDispatch(user.id, 'milestone_toggle', {
      projectId: assertUUID(payload.projectId, '项目'), milestoneId: assertUUID(payload.milestoneId, '里程碑'), completed: payload.completed === true,
    })
    case 'project_milestone_delete': return projectDispatch(user.id, 'milestone_delete', {
      projectId: assertUUID(payload.projectId, '项目'), milestoneId: assertUUID(payload.milestoneId, '里程碑'),
    })
    case 'project_delivery_check_create': return projectDispatch(user.id, 'delivery_check_create', {
      projectId: assertUUID(payload.projectId, '项目'), id: assertUUID(payload.id, '检查项'),
      title: cleanText(payload.title, 200, '检查项名称', true), required: payload.required !== false,
    })
    case 'project_delivery_check_update': return projectDispatch(user.id, 'delivery_check_update', {
      projectId: assertUUID(payload.projectId, '项目'), checkId: assertUUID(payload.checkId, '检查项'),
      expectedRevision: assertRevision(payload.expectedRevision, '检查项'), checked: payload.checked === true,
      evidence: cleanText(payload.evidence, 1500, '凭证说明'),
    })
    case 'project_delivery_check_delete': return projectDispatch(user.id, 'delivery_check_delete', {
      projectId: assertUUID(payload.projectId, '项目'), checkId: assertUUID(payload.checkId, '检查项'),
    })
    case 'project_adjustment_create': {
      const type = cleanText(payload.type, 32, '调整类型', true)
      return projectDispatch(user.id, 'adjustment_create', {
        id: assertUUID(payload.id, '申请'), projectId: assertUUID(payload.projectId, '项目'),
        taskId: assertUUID(payload.taskId, '任务'), type, reason: cleanText(payload.reason, 1500, '申请原因', true),
        data: normalizeAdjustmentData(type, payload.data),
      })
    }
    case 'project_adjustments_list': return projectDispatch(user.id, 'adjustments_list', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_adjustment_decide': return projectDispatch(user.id, 'adjustment_decide', {
      projectId: assertUUID(payload.projectId, '项目'), requestId: assertUUID(payload.requestId, '申请'),
      decision: ['approve', 'reject'].includes(payload.decision) ? payload.decision : '',
      decisionNote: cleanText(payload.decisionNote, 1500, '处理说明'),
    })
    case 'project_adjustment_cancel': return projectDispatch(user.id, 'adjustment_cancel', {
      projectId: assertUUID(payload.projectId, '项目'), requestId: assertUUID(payload.requestId, '申请'),
    })
    case 'project_deliverables': return projectDispatch(user.id, 'deliverables', { projectId: assertUUID(payload.projectId, '项目') })
    case 'project_deliverable_create': return projectDispatch(user.id, 'deliverable_create', {
      id: assertUUID(payload.id, '交付项'), projectId: assertUUID(payload.projectId, '项目'),
      taskId: payload.taskId ? assertUUID(payload.taskId, '任务') : '',
      reviewerId: payload.reviewerId ? assertUUID(payload.reviewerId, '验收人') : '',
      title: cleanText(payload.title, 160, '交付项名称', true), instructions: cleanText(payload.instructions, 3000, '交付要求'),
      required: payload.required !== false, reviewRequired: payload.reviewRequired !== false,
    })
    case 'project_deliverable_draft_save': {
      const projectId = assertUUID(payload.projectId, '项目')
      const deliverableId = assertUUID(payload.deliverableId, '交付项')
      return projectDispatch(user.id, 'deliverable_draft_save', {
        projectId, deliverableId, expectedRevision: assertDraftRevision(payload.expectedRevision),
        content: normalizeDeliverableContent(payload.content, projectId, deliverableId),
      })
    }
    case 'project_deliverable_submit': return projectDispatch(user.id, 'deliverable_submit', {
      projectId: assertUUID(payload.projectId, '项目'), deliverableId: assertUUID(payload.deliverableId, '交付项'),
      versionId: assertUUID(payload.versionId, '版本'), submissionKey: assertUUID(payload.submissionKey, '提交编号'),
      changeNote: cleanText(payload.changeNote, 1500, '修改说明'),
    })
    case 'project_deliverable_review': {
      if (!Array.isArray(payload.checklist) || payload.checklist.length > 20) throw new ApiError('invalid_input', '验收清单格式不正确。')
      const checklist = payload.checklist.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError('invalid_input', `第 ${index + 1} 项验收结果无效。`)
        const row = item as Record<string, unknown>
        return { item: cleanText(row.item, 200, '检查项', true), passed: row.passed === true }
      })
      return projectDispatch(user.id, 'deliverable_review', {
        projectId: assertUUID(payload.projectId, '项目'), deliverableId: assertUUID(payload.deliverableId, '交付项'),
        versionId: assertUUID(payload.versionId, '版本'), result: ['approved', 'returned'].includes(payload.result) ? payload.result : '',
        feedback: cleanText(payload.feedback, 3000, '验收意见', true), checklist,
      })
    }
    default: throw new ApiError('invalid_input', '未知的好友协作操作。')
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return withCors(request, new Response('ok', { headers: corsHeaders }))
  if (request.method !== 'POST') return withCors(request, response({ error: '仅支持 POST。', code: 'method_not_allowed' }, 405))
  if (!supabaseUrl || !serviceKey) return withCors(request, response({ error: '好友协作服务尚未配置。', code: 'service_unavailable' }, 503))
  try {
    const length = Number(request.headers.get('content-length') || 0)
    if (length > 32_768) throw new ApiError('invalid_input', '请求内容过大。', 413)
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > 32_768) throw new ApiError('invalid_input', '请求内容过大。', 413)
    let body
    try { body = JSON.parse(raw) } catch { throw new ApiError('invalid_input', '请求内容无效。') }
    if (!body || typeof body.action !== 'string') throw new ApiError('invalid_input', '请求内容无效。')
    const user = await authenticate(request)
    const data = await handle(user, body.action, body.payload || {})
    return withCors(request, response({ data }))
  } catch (error) {
    if (error instanceof ApiError) return withCors(request, response({ error: error.message, code: error.code }, error.status))
    console.error('[campus-social] unexpected failure', error instanceof Error ? error.name : 'unknown')
    return withCors(request, response({ error: '服务暂时不可用，请稍后重试。', code: 'service_unavailable' }, 503))
  }
})
