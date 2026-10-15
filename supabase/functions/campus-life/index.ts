/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { campusScopeMatches, canTransitionCampusHelp, containsPrivateCampusDetails } from './rules.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const allowedOrigins = new Set([
  'https://study-life.pages.dev', 'https://codex-preview-1-4-0.study-life.pages.dev',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173', 'app://study-life',
  ...(Deno.env.get('CAMPUS_SOCIAL_ALLOWED_ORIGINS') || '').split(',').map((origin) => origin.trim()).filter(Boolean),
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLIC_TABLES: Record<string, { table: string; statusField: string; pending: string; accepted: string; rejected: string; ownerField?: string }> = {
  teacher: { table: 'campus_teachers', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  course: { table: 'campus_courses', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  assignment: { table: 'campus_teaching_assignments', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  course_review: { table: 'campus_course_reviews', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'user_id' },
  market_listing: { table: 'campus_market_listings', statusField: 'status', pending: 'pending_review', accepted: 'active', rejected: 'rejected', ownerField: 'owner_id' },
  help_task: { table: 'campus_help_tasks', statusField: 'status', pending: 'pending_review', accepted: 'open', rejected: 'rejected', ownerField: 'owner_id' },
  help_dispute: { table: 'campus_help_disputes', statusField: 'status', pending: 'open', accepted: 'resolved', rejected: 'dismissed', ownerField: 'opened_by' },
  shuttle_route: { table: 'campus_shuttle_routes', statusField: 'status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  shuttle_correction: { table: 'campus_shuttle_corrections', statusField: 'status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  shuttle_exception: { table: 'campus_shuttle_exceptions', statusField: 'status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  lost_found: { table: 'campus_lost_found_items', statusField: 'status', pending: 'pending_review', accepted: 'open', rejected: 'rejected', ownerField: 'owner_id' },
  event: { table: 'campus_events', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
  guide: { table: 'campus_guides', statusField: 'review_status', pending: 'pending_review', accepted: 'approved', rejected: 'rejected', ownerField: 'owner_id' },
}

class ApiError extends Error {
  status: number
  code: string
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status }
}

function reply(body: Record<string, unknown>, status = 200) {
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

function text(value: unknown, maximum: number, label: string, required = false) {
  const result = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (result.length > maximum || (required && !result)) throw new ApiError('invalid_input', `${label}格式不正确。`)
  return result
}

function publicText(value: unknown, maximum: number, label: string, required = false) {
  const result = text(value, maximum, label, required)
  if (containsPrivateCampusDetails(result)) throw new ApiError('private_contact_not_allowed', `${label}不能包含个人联系方式、取件码或宿舍房间号。`)
  return result
}

function uuid(value: unknown, label: string) {
  const result = String(value || '')
  if (!UUID_RE.test(result)) throw new ApiError('invalid_input', `${label}无效。`)
  return result
}

function enumValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(String(value) as T)) throw new ApiError('invalid_input', `${label}选项无效。`)
  return String(value) as T
}

function safeUrl(value: unknown, label: string, required = false) {
  const result = text(value, 500, label, required)
  if (!result) return ''
  try { if (new URL(result).protocol !== 'https:') throw new Error('protocol') }
  catch { throw new ApiError('invalid_input', `${label}必须是有效的 HTTPS 链接。`) }
  return result
}

function isoDateTime(value: unknown, label: string, required = false) {
  const result = text(value, 64, label, required)
  if (!result) return null
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new ApiError('invalid_input', `${label}必须包含有效时区。`)
  }
  return new Date(result).toISOString()
}

function isoDate(value: unknown, label: string, required = false) {
  const result = text(value, 10, label, required)
  if (!result) return null
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    throw new ApiError('invalid_input', `${label}格式不正确。`)
  }
  return result
}

function timeValue(value: unknown) {
  const result = text(value, 5, '发车时间', true)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new ApiError('invalid_input', '发车时间格式不正确。')
  return result
}

function rating(value: unknown, label: string) {
  if (value === '' || value === null || value === undefined) return null
  const result = Number(value)
  if (!Number.isInteger(result) || result < 1 || result > 5) throw new ApiError('invalid_input', `${label}需要为一至五星。`)
  return result
}

function dbError(error: any): never {
  const marker = String(error?.message || '')
  if (/CAMPUS_FORBIDDEN|CAMPUS_SELF_REVIEW/.test(marker)) throw new ApiError('forbidden', '没有此范围的审核权限，或不能处理自己的内容与争议。', 403)
  if (/CAMPUS_REVISION_CHANGED/.test(marker)) throw new ApiError('state_changed', '内容或授权已经变化，请刷新后重新核对。', 409)
  if (/CAMPUS_NOT_FOUND/.test(marker)) throw new ApiError('not_found', '内容已不可用，请刷新列表。', 404)
  if (/CAMPUS_USE_DISPUTE/.test(marker)) throw new ApiError('state_changed', '互助正在履行，请先通过互助争议流程处理。', 409)
  if (/CAMPUS_INVALID_INPUT/.test(marker)) throw new ApiError('invalid_input', '请填写处理依据并检查操作选项。')
  if (/CAMPUS_RESUBMIT_INVALID/.test(marker)) throw new ApiError('invalid_input', '修改内容无效，请检查填写字段。')
  if (/CAMPUS_RESUBMIT_RELATION_INVALID/.test(marker)) throw new ApiError('not_found', '授课安排必须关联同校已审核的课程和教师。', 404)
  if (/CAMPUS_RESUBMIT_CONFLICT/.test(marker)) throw new ApiError('state_changed', '内容状态或版本已经变化，请刷新投稿记录后重试。', 409)
  if (/CAMPUS_LISTING_STATE_CHANGED/.test(marker)) throw new ApiError('state_changed', '商品状态已经变化，请刷新后查看。', 409)
  if (/CAMPUS_LISTING_SELF_CONTACT/.test(marker)) throw new ApiError('invalid_input', '不能联系自己的商品。')
  if (/CAMPUS_INTEREST_NOT_FOUND/.test(marker)) throw new ApiError('not_found', '意向已更新，请刷新后查看。', 404)
  if (/CAMPUS_HELP_STATE_CHANGED/.test(marker)) throw new ApiError('state_changed', '任务已被其他人接单或状态已变化。', 409)
  if (/CAMPUS_HELP_SELF_APPLICATION/.test(marker)) throw new ApiError('invalid_input', '不能申请自己的互助任务。')
  if (/CAMPUS_HELP_APPLICATION_NOT_FOUND/.test(marker)) throw new ApiError('not_found', '接单申请已更新，请刷新后查看。', 404)
  if (/CAMPUS_EVENT_FULL/.test(marker)) throw new ApiError('event_full', '活动名额已满。', 409)
  if (/CAMPUS_EVENT_CLOSED|CAMPUS_EVENT_UNAVAILABLE/.test(marker)) throw new ApiError('event_closed', '活动已截止或暂不可报名。', 409)
  if (/CAMPUS_CLAIM_STATE_CHANGED/.test(marker)) throw new ApiError('state_changed', '认领申请已经变化，请刷新后重试。', 409)
  if (/CAMPUS_CLAIM_SELF_APPLICATION/.test(marker)) throw new ApiError('invalid_input', '不能认领自己发布的失物信息。')
  if (/CAMPUS_CLAIM_FORBIDDEN/.test(marker)) throw new ApiError('forbidden', '只有失物发布者可以处理认领申请。', 403)
  if (/CAMPUS_REVIEW_TARGET_UNAVAILABLE/.test(marker)) throw new ApiError('not_found', '课程安排暂不可评价。', 404)
  if (/CAMPUS_MODERATION_REVISION_CHANGED/.test(marker)) throw new ApiError('state_changed', '内容版本已更新，请先复核最新内容。', 409)
  if (/CAMPUS_MODERATION_STATE_CHANGED/.test(marker)) throw new ApiError('state_changed', '审核状态已变化，请刷新队列。', 409)
  if (/CAMPUS_MODERATION_REASON_REQUIRED/.test(marker)) throw new ApiError('invalid_input', '拒绝时需要说明原因。')
  if (/CAMPUS_MODERATION_INVALID/.test(marker)) throw new ApiError('invalid_input', '审核决定无效。')
  if (/CAMPUS_CLAIM_DECISION_INVALID/.test(marker)) throw new ApiError('invalid_input', '认领处理方式无效。')
  if (/CAMPUS_HELP_DISPUTE_INVALID/.test(marker)) throw new ApiError('invalid_input', '请补充争议说明。')
  if (/CAMPUS_DISPUTE_OUTCOME_INVALID/.test(marker)) throw new ApiError('invalid_input', '争议裁定结果无效。')
  if (/CAMPUS_DISPUTE_REASON_INVALID/.test(marker)) throw new ApiError('invalid_input', '请补充争议裁定说明。')
  if (/CAMPUS_DISPUTE_STATE_CHANGED/.test(marker)) throw new ApiError('state_changed', '争议或任务状态已经变化，请刷新后重试。', 409)
  if (error?.code === '23505') throw new ApiError('duplicate', '已存在相同的提交，请刷新后查看。', 409)
  console.error('[campus-life] database request failed', error?.code || 'unknown')
  throw new ApiError('service_unavailable', '校园服务暂时不可用，请稍后重试。', 503)
}

function dataOrThrow(result: any) {
  if (result?.error) dbError(result.error)
  return result?.data
}

async function authenticate(request: Request) {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new ApiError('unauthorized', '请先登录账号。', 401)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) throw new ApiError('unauthorized', '登录已失效，请重新登录。', 401)
  const email = String(data.user.email || '').trim().toLowerCase()
  if (!data.user.email_confirmed_at || !email || email.endsWith('@wechat.study-life.invalid')) {
    throw new ApiError('email_verification_required', '请先完成邮箱验证，再发布或联系校园内容。', 403)
  }
  return data.user
}

async function scopeFor(userId: string) {
  const result = await admin.from('social_profiles').select('school,campus').eq('user_id', userId).maybeSingle()
  const profile = dataOrThrow(result)
  const school = text(profile?.school, 100, '学校')
  // Match campus-social's requirePlaceSchool contract so an unset school reads as an
  // actionable setup step instead of a malformed-field error.
  if (!school) throw new ApiError('profile_required', '请先在个人资料中填写学校，再使用校园生活中心。', 409)
  const campus = text(profile?.campus, 100, '校区')
  return { school, campus }
}

function inScope(row: any, scope: { school: string; campus: string }) {
  return campusScopeMatches(row, scope)
}

/**
 * Every campus table declares `campus text not null default ''`, so an empty campus is
 * the only "school-wide" value campusScopeMatches treats as visible. Expressing that in the
 * query keeps the row limit applied to rows the caller can actually see, instead of to a
 * page that may be entirely other campuses' rows.
 */
function scopeQuery(query: any, scope: { school: string; campus: string }) {
  return scope.campus ? query.in('campus', [scope.campus, '']) : query
}

async function notify(recipientId: string, actorId: string, kind: string, resourceId: string, dedupeKey?: string) {
  try {
    const notification = { recipient_id: recipientId, actor_id: actorId, kind, resource_id: resourceId, dedupe_key: dedupeKey || null }
    const result = dedupeKey
      ? await admin.from('social_notifications').upsert(notification, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      : await admin.from('social_notifications').insert(notification)
    if (result.error) {
      console.warn('[campus-life] notification insert failed', result.error.code || 'unknown')
      return false
    }
    return true
  } catch (error) {
    console.warn('[campus-life] notification request failed', error instanceof Error ? error.name : 'unknown')
    return false
  }
}

async function isPlatformOwner(userId: string) {
  const { data, error } = await admin.from('platform_admins').select('user_id').eq('role', 'owner').eq('user_id', userId).maybeSingle()
  if (error) dbError(error)
  return Boolean(data)
}

async function governanceAccess(userId: string) {
  if (await isPlatformOwner(userId)) return { owner: true, reviewer: true, scope: null }
  const grant = dataOrThrow(await admin.from('campus_reviewer_grants').select('school,campus').eq('user_id', userId).eq('active', true).maybeSingle())
  return { owner: false, reviewer: Boolean(grant), scope: grant || null }
}

async function requireReviewer(userId: string) {
  const access = await governanceAccess(userId)
  if (!access.reviewer) throw new ApiError('forbidden', '当前账号没有校园审核权限，可由总管理员授权。', 403)
  return access
}

async function enforceRateLimit(userId: string, category: string, limit: number, windowSeconds = 3600) {
  const result = await admin.rpc('campus_life_take_rate_limit', {
    p_user_id: userId, p_action: category, p_limit: limit, p_window_seconds: windowSeconds,
  })
  const allowed = dataOrThrow(result)
  if (allowed !== true) throw new ApiError('rate_limited', '操作太频繁了，请稍后再试。', 429)
}

async function queryRows(table: string, columns: string, scope: { school: string; campus: string }, statusField: string, status: string, orderBy = 'updated_at') {
  const result = await scopeQuery(admin.from(table).select(columns).eq('school', scope.school).eq(statusField, status), scope)
    .order(orderBy, { ascending: false }).limit(100)
  return (dataOrThrow(result) || []).filter((row: any) => inScope(row, scope))
}

async function listCourses(scope: { school: string; campus: string }) {
  const [courses, teachers, assignments] = await Promise.all([
    queryRows('campus_courses', 'id,school,campus,name,department,description,source_url,updated_at', scope, 'review_status', 'approved'),
    queryRows('campus_teachers', 'id,school,campus,name,department,research_directions,official_intro,source_url,updated_at', scope, 'review_status', 'approved', 'name'),
    queryRows('campus_teaching_assignments', 'id,school,campus,course_id,teacher_id,term,source_url,updated_at', scope, 'review_status', 'approved'),
  ])
  const visibleCourseIds = new Set(courses.map((item: any) => item.id))
  const visibleTeacherIds = new Set(teachers.map((item: any) => item.id))
  const visibleAssignments = assignments.filter((item: any) => visibleCourseIds.has(item.course_id) && visibleTeacherIds.has(item.teacher_id))
  const assignmentIds = visibleAssignments.map((item: any) => item.id)
  let reviews: any[] = []
  if (assignmentIds.length) {
    const result = await admin.from('campus_course_reviews')
      .select('id,assignment_id,clarity,organization,learning,workload,assessment,note,created_at')
      .in('assignment_id', assignmentIds).eq('review_status', 'approved').order('created_at', { ascending: false }).limit(300)
    reviews = dataOrThrow(result) || []
  }
  return { courses, teachers, assignments: visibleAssignments, reviews }
}

async function listMarket(scope: { school: string; campus: string }) {
  const columns = 'id,school,campus,listing_type,category,title,description,condition,price_cents,meetup_area,status,created_at,updated_at'
  const active = await queryRows('campus_market_listings', columns, scope, 'status', 'active')
  const reserved = await queryRows('campus_market_listings', columns, scope, 'status', 'reserved')
  return [...active, ...reserved].sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

async function listHelp(scope: { school: string; campus: string }) {
  return queryRows('campus_help_tasks', 'id,school,campus,task_type,title,description,pickup_area,delivery_area,deadline,status,created_at,updated_at', scope, 'status', 'open')
}

async function listShuttles(scope: { school: string; campus: string }) {
  const routes = await queryRows('campus_shuttle_routes', 'id,school,campus,name,source_url,effective_from,effective_to,revision,updated_at', scope, 'status', 'approved')
  if (!routes.length) return { routes: [], stops: [], departures: [], exceptions: [] }
  const ids = routes.map((row: any) => row.id)
  const [stopsResult, departuresResult, exceptionsResult] = await Promise.all([
    admin.from('campus_shuttle_stops').select('id,route_id,direction,position,name').in('route_id', ids).order('position'),
    admin.from('campus_shuttle_departures').select('id,route_id,direction,service_day,departure_time,stop_name').in('route_id', ids).order('departure_time'),
    admin.from('campus_shuttle_exceptions').select('id,route_id,service_date,exception_type,departure_time,direction,note,source_url').in('route_id', ids).eq('status', 'approved').order('service_date'),
  ])
  return { routes, stops: dataOrThrow(stopsResult) || [], departures: dataOrThrow(departuresResult) || [], exceptions: dataOrThrow(exceptionsResult) || [] }
}

async function listLostFound(scope: { school: string; campus: string }) {
  const query = admin.from('campus_lost_found_items')
    .select('id,school,campus,mode,category,title,description,approximate_location,occurred_at,status,created_at,updated_at')
    .eq('school', scope.school).in('status', ['open', 'claim_pending'])
  const result = await scopeQuery(query, scope).order('created_at', { ascending: false }).limit(100)
  return (dataOrThrow(result) || []).filter((row: any) => inScope(row, scope))
}

async function listEvents(scope: { school: string; campus: string }, userId?: string) {
  const query = admin.from('campus_events')
    .select('id,school,campus,title,description,starts_at,ends_at,location,organizer,signup_url,capacity,source_url,status,created_at')
    .eq('school', scope.school).eq('review_status', 'approved').eq('status', 'published')
    .gte('ends_at', new Date().toISOString())
  const result = await scopeQuery(query, scope).order('starts_at').limit(100)
  const rows = (dataOrThrow(result) || []).filter((row: any) => inScope(row, scope))
  if (!rows.length) return []
  const counts = dataOrThrow(await admin.rpc('campus_life_event_counts', { p_actor_id: userId || null, p_event_ids: rows.map((row: any) => row.id) })) || {}
  return rows.map((row: any) => ({ ...row, registeredCount: counts[row.id]?.count || 0, isRegistered: counts[row.id]?.is_registered === true }))
}

async function listGuides(scope: { school: string; campus: string }) {
  const query = admin.from('campus_guides')
    .select('id,school,campus,title,category,body,source_type,source_url,expires_on,updated_at')
    .eq('school', scope.school).eq('review_status', 'approved')
  const result = await scopeQuery(query, scope).order('updated_at', { ascending: false }).limit(100)
  const today = new Date().toISOString().slice(0, 10)
  return (dataOrThrow(result) || []).filter((row: any) => inScope(row, scope) && (!row.expires_on || row.expires_on >= today))
}

async function getMine(userId: string) {
  const tables = [
    ['teachers', 'campus_teachers'], ['courses', 'campus_courses'], ['assignments', 'campus_teaching_assignments'],
    ['listings', 'campus_market_listings'], ['helpTasks', 'campus_help_tasks'], ['shuttleRoutes', 'campus_shuttle_routes'],
    ['shuttleCorrections', 'campus_shuttle_corrections'], ['shuttleExceptions', 'campus_shuttle_exceptions'],
    ['lostFound', 'campus_lost_found_items'], ['events', 'campus_events'], ['guides', 'campus_guides'],
  ] as const
  const entries = await Promise.all(tables.map(async ([key, table]) => {
    const result = await admin.from(table).select('*').eq('owner_id', userId)
      .order(['shuttleCorrections', 'shuttleExceptions'].includes(key) ? 'created_at' : 'updated_at', { ascending: false }).limit(100)
    return [key, dataOrThrow(result) || []]
  }))
  const reviewResult = await admin.from('campus_course_reviews').select('id,assignment_id,clarity,organization,learning,workload,assessment,note,review_status,review_reason,revision,updated_at')
    .eq('user_id', userId).order('updated_at', { ascending: false }).limit(100)
  const mine = Object.fromEntries(entries) as Record<string, any[]>
  const routes = mine.shuttleRoutes || []
  if (routes.length) {
    const routeIds = routes.map((item) => item.id)
    const [stopsResult, departuresResult] = await Promise.all([
      admin.from('campus_shuttle_stops').select('route_id,direction,position,name').in('route_id', routeIds).order('position'),
      admin.from('campus_shuttle_departures').select('route_id,direction,service_day,departure_time,stop_name').in('route_id', routeIds).order('departure_time'),
    ])
    const stops = dataOrThrow(stopsResult) || []
    const departures = dataOrThrow(departuresResult) || []
    mine.shuttleRoutes = routes.map((route) => ({ ...route,
      stops: stops.filter((item: any) => item.route_id === route.id),
      departures: departures.filter((item: any) => item.route_id === route.id),
    }))
  }
  const places = dataOrThrow(await admin.from('campus_places').select('id,name,review_status,review_reason,review_revision,updated_at').eq('owner_id', userId).eq('visibility', 'school').order('updated_at', { ascending: false }).limit(100)) || []
  return { ...mine, places, courseReviews: dataOrThrow(reviewResult) || [] }
}

function requireObject(value: any, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('invalid_input', `${label}格式不正确。`)
  return value
}

const RESUBMIT_TARGETS: Record<string, string> = {
  campus_teachers: 'teacher', campus_courses: 'course', campus_teaching_assignments: 'assignment',
  campus_market_listings: 'market_listing', campus_help_tasks: 'help_task', campus_lost_found_items: 'lost_found',
  campus_events: 'event', campus_guides: 'guide', campus_shuttle_corrections: 'shuttle_correction',
  campus_shuttle_exceptions: 'shuttle_exception',
}

async function insert(table: string, row: Record<string, unknown>, editContext?: { id: string; revision: number; actorId: string }) {
  if (editContext) {
    const targetType = RESUBMIT_TARGETS[table]
    if (!targetType) throw new ApiError('invalid_input', '此类内容暂不支持修改后重提。')
    const content = Object.fromEntries(Object.entries(row).filter(([key]) => !['owner_id', 'school', 'campus'].includes(key)))
    return dataOrThrow(await admin.rpc('campus_life_resubmit_content', {
      p_actor_id: editContext.actorId, p_target_type: targetType, p_target_id: editContext.id,
      p_expected_revision: editContext.revision, p_payload: content,
    }))
  }
  const result = await admin.from(table).insert(row).select('id,created_at').single()
  return dataOrThrow(result)
}

async function submit(user: any, action: string, payload: any, scope: { school: string; campus: string }, editContext?: { id: string; revision: number; actorId: string }) {
  const base = { owner_id: user.id, school: scope.school, campus: scope.campus }
  if (action === 'teacher_submit') {
    return { item: await insert('campus_teachers', {
      ...base, name: publicText(payload.name, 100, '教师姓名', true), department: publicText(payload.department, 120, '院系'),
      research_directions: publicText(payload.researchDirections, 1000, '研究方向'), official_intro: publicText(payload.officialIntro, 3000, '公开简介'),
      source_url: safeUrl(payload.sourceUrl, '官方来源', true),
    }, editContext) }
  }
  if (action === 'course_submit') {
    return { item: await insert('campus_courses', {
      ...base, name: publicText(payload.name, 120, '课程名称', true), department: publicText(payload.department, 120, '院系'),
      description: publicText(payload.description, 3000, '课程说明'), source_url: safeUrl(payload.sourceUrl, '资料来源'),
    }, editContext) }
  }
  if (action === 'assignment_submit') {
    const courseId = uuid(payload.courseId, '课程')
    const teacherId = uuid(payload.teacherId, '教师')
    const [course, teacher] = await Promise.all([
      admin.from('campus_courses').select('id,school,campus,review_status').eq('id', courseId).maybeSingle(),
      admin.from('campus_teachers').select('id,school,campus,review_status').eq('id', teacherId).maybeSingle(),
    ])
    const courseRow = dataOrThrow(course), teacherRow = dataOrThrow(teacher)
    if (!courseRow || !teacherRow || !inScope(courseRow, scope) || !inScope(teacherRow, scope)
      || courseRow.review_status !== 'approved' || teacherRow.review_status !== 'approved') {
      throw new ApiError('not_found', '请先选择已审核的课程和教师资料。', 404)
    }
    return { item: await insert('campus_teaching_assignments', {
      ...base, course_id: courseId, teacher_id: teacherId,
      term: publicText(payload.term, 40, '学期', true), source_url: safeUrl(payload.sourceUrl, '授课安排来源'),
    }, editContext) }
  }
  if (action === 'market_submit') {
    const listingType = enumValue(payload.listingType, ['sale', 'wanted', 'free'] as const, '发布类型')
    const priceRaw = payload.priceCents === '' || payload.priceCents === null || payload.priceCents === undefined ? null : Number(payload.priceCents)
    if (priceRaw !== null && (!Number.isInteger(priceRaw) || priceRaw < 0 || priceRaw > 100000000)) throw new ApiError('invalid_input', '价格范围无效。')
    return { item: await insert('campus_market_listings', {
      ...base, listing_type: listingType,
      category: enumValue(payload.category, ['textbook', 'electronics', 'living', 'sports', 'dorm', 'clothing', 'instrument', 'other'] as const, '商品分类'),
      title: publicText(payload.title, 100, '标题', true), description: publicText(payload.description, 3000, '物品说明'),
      condition: publicText(payload.condition, 80, '新旧程度'), price_cents: listingType === 'free' ? 0 : priceRaw,
      meetup_area: publicText(payload.meetupArea, 120, '安全交易区域'),
    }, editContext) }
  }
  if (action === 'help_submit') {
    const taskType = enumValue(payload.taskType, ['parcel', 'delivery', 'errand', 'temporary_help', 'moving', 'daily_task', 'other'] as const, '互助类型')
    const deadline = isoDateTime(payload.deadline, '最晚完成时间')
    return { item: await insert('campus_help_tasks', {
      ...base, task_type: taskType, title: publicText(payload.title, 100, '任务标题', true),
      description: publicText(payload.description, 2000, '任务说明'), pickup_area: publicText(payload.pickupArea, 100, '取件/起始区域'),
      delivery_area: publicText(payload.deliveryArea, 100, '送达区域'), deadline,
    }, editContext) }
  }
  if (action === 'shuttle_submit') {
    const name = publicText(payload.name, 100, '线路名称', true)
    const sourceUrl = safeUrl(payload.sourceUrl, '公开时刻表来源', true)
    const stops = Array.isArray(payload.stops) ? payload.stops : []
    const departures = Array.isArray(payload.departures) ? payload.departures : []
    if (stops.length < 2 || stops.length > 60 || departures.length > 240) throw new ApiError('invalid_input', '线路至少需要两个站点，最多 60 个站点和 240 个班次。')
    const normalizedStops = stops.map((item: any, index: number) => {
      requireObject(item, `第 ${index + 1} 个站点`)
      return { direction: enumValue(item.direction, ['outbound', 'inbound'] as const, '行驶方向'), position: index + 1,
        name: publicText(item.name, 100, '站点名称', true) }
    })
    const normalizedDepartures = departures.map((item: any) => {
      requireObject(item, '班次')
      return { direction: enumValue(item.direction, ['outbound', 'inbound'] as const, '行驶方向'),
        service_day: enumValue(item.serviceDay, ['weekday', 'weekend', 'holiday'] as const, '运行日期'), departure_time: timeValue(item.time),
        stop_name: publicText(item.stopName, 100, '上车站点') }
    })
    const routeFields = { name, source_url: sourceUrl, effective_from: isoDate(payload.effectiveFrom, '生效日期'), effective_to: isoDate(payload.effectiveTo, '失效日期') }
    if (editContext) {
      const result = await admin.rpc('campus_life_resubmit_content', {
        p_actor_id: user.id, p_target_type: 'shuttle_route', p_target_id: editContext.id,
        p_expected_revision: editContext.revision, p_payload: { ...routeFields, stops: normalizedStops, departures: normalizedDepartures },
      })
      return { item: dataOrThrow(result) }
    }
    const route = await insert('campus_shuttle_routes', { ...base, ...routeFields })
    const routeId = route.id
    try {
      const stopResult = await admin.from('campus_shuttle_stops').insert(normalizedStops.map((item) => ({ ...item, route_id: routeId })))
      if (stopResult.error) dbError(stopResult.error)
      if (normalizedDepartures.length) {
        const departureResult = await admin.from('campus_shuttle_departures').insert(normalizedDepartures.map((item) => ({ ...item, route_id: routeId })))
        if (departureResult.error) dbError(departureResult.error)
      }
    } catch (error) {
      await admin.from('campus_shuttle_routes').delete().eq('id', routeId).eq('owner_id', user.id)
      throw error
    }
    return { item: route }
  }
  if (action === 'lost_found_submit') {
    return { item: await insert('campus_lost_found_items', {
      ...base, mode: enumValue(payload.mode, ['lost', 'found'] as const, '失物类型'),
      category: enumValue(payload.category, ['electronics', 'card', 'keys', 'documents', 'clothing', 'bag', 'other'] as const, '物品分类'),
      title: publicText(payload.title, 100, '物品名称', true), description: publicText(payload.description, 1500, '物品描述'),
      approximate_location: publicText(payload.approximateLocation, 120, '大致地点'), occurred_at: isoDate(payload.occurredAt, '发生日期'),
    }, editContext) }
  }
  if (action === 'event_submit') {
    const startsAt = isoDateTime(payload.startsAt, '开始时间', true)!
    const endsAt = isoDateTime(payload.endsAt, '结束时间', true)!
    if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new ApiError('invalid_input', '活动结束时间必须晚于开始时间。')
    const capacity = payload.capacity === '' || payload.capacity === null || payload.capacity === undefined ? null : Number(payload.capacity)
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) throw new ApiError('invalid_input', '活动名额范围无效。')
    return { item: await insert('campus_events', {
      ...base, title: publicText(payload.title, 120, '活动名称', true), description: publicText(payload.description, 3000, '活动说明'),
      starts_at: startsAt, ends_at: endsAt, location: publicText(payload.location, 160, '地点'),
      organizer: publicText(payload.organizer, 120, '组织方'), signup_url: safeUrl(payload.signupUrl, '报名链接'),
      source_url: safeUrl(payload.sourceUrl, '活动来源'), capacity,
    }, editContext) }
  }
  if (action === 'guide_submit') {
    const sourceType = enumValue(payload.sourceType, ['official_public', 'student_experience', 'merchant_submission'] as const, '信息来源类型')
    const sourceUrl = safeUrl(payload.sourceUrl, '来源链接', sourceType === 'official_public')
    return { item: await insert('campus_guides', {
      ...base, title: publicText(payload.title, 120, '指南标题', true),
      category: enumValue(payload.category, ['new_student', 'administration', 'dormitory', 'food', 'printing', 'transport', 'facilities', 'exam', 'graduation', 'safety', 'other'] as const, '指南分类'),
      body: publicText(payload.body, 10000, '指南正文', true), source_type: sourceType, source_url: sourceUrl,
      expires_on: isoDate(payload.expiresOn, '有效期'),
    }, editContext) }
  }
  throw new ApiError('invalid_input', '发布类型无效。')
}

async function submitCourseReview(user: any, payload: any, scope: { school: string; campus: string }) {
  const assignmentId = uuid(payload.assignmentId, '课程安排')
  const assignment = dataOrThrow(await admin.from('campus_teaching_assignments')
    .select('id,school,campus,review_status').eq('id', assignmentId).maybeSingle())
  if (!assignment || !inScope(assignment, scope) || assignment.review_status !== 'approved') throw new ApiError('not_found', '课程安排暂不可评价。', 404)
  const scores = {
    clarity: rating(payload.clarity, '讲授清晰度'), organization: rating(payload.organization, '教学组织'),
    learning: rating(payload.learning, '学习收获'), workload: rating(payload.workload, '作业负担'), assessment: rating(payload.assessment, '考核透明度'),
  }
  const note = publicText(payload.note, 1500, '课程体验', false)
  if (Object.values(scores).every((value) => value === null) && !note) throw new ApiError('invalid_input', '请至少填写一项评分或课程体验。')
  const result = await admin.rpc('campus_life_submit_course_review', {
    p_actor_id: user.id, p_assignment_id: assignmentId, p_school: scope.school,
    p_clarity: scores.clarity, p_organization: scores.organization, p_learning: scores.learning,
    p_workload: scores.workload, p_assessment: scores.assessment, p_note: note,
  })
  return { item: dataOrThrow(result) }
}

async function assertPublicTarget(targetType: string, targetId: string, scope: { school: string; campus: string }) {
  const configs: Record<string, { table: string; statusField: string; statuses: string[] }> = {
    place: { table: 'campus_places', statusField: 'review_status', statuses: ['approved'] },
    teacher: { table: 'campus_teachers', statusField: 'review_status', statuses: ['approved'] },
    course: { table: 'campus_courses', statusField: 'review_status', statuses: ['approved'] },
    course_review: { table: 'campus_course_reviews', statusField: 'review_status', statuses: ['approved'] },
    market_listing: { table: 'campus_market_listings', statusField: 'status', statuses: ['active', 'reserved'] },
    help_task: { table: 'campus_help_tasks', statusField: 'status', statuses: ['open'] },
    shuttle_route: { table: 'campus_shuttle_routes', statusField: 'status', statuses: ['approved'] },
    lost_found: { table: 'campus_lost_found_items', statusField: 'status', statuses: ['open', 'claim_pending'] },
    event: { table: 'campus_events', statusField: 'review_status', statuses: ['approved'] },
    guide: { table: 'campus_guides', statusField: 'review_status', statuses: ['approved'] },
  }
  const config = configs[targetType]
  if (!config) throw new ApiError('invalid_input', '内容类型无效。')
  const scopeColumns = targetType === 'course_review' ? 'assignment_id' : 'campus'
  const result = await admin.from(config.table).select(`id,school,${scopeColumns},${targetType === 'course_review' ? 'user_id' : 'owner_id'},${config.statusField}${targetType === 'place' ? ',visibility,archived_at' : ''}`)
    .eq('id', targetId).maybeSingle()
  const row = dataOrThrow(result)
  if (row && targetType === 'course_review') {
    const assignment = dataOrThrow(await admin.from('campus_teaching_assignments')
      .select('id,school,campus,review_status').eq('id', row.assignment_id).maybeSingle())
    if (!assignment || !inScope(assignment, scope) || assignment.review_status !== 'approved') {
      throw new ApiError('not_found', '该课程评价当前不在可操作的公开范围内。', 404)
    }
    row.campus = assignment.campus
  }
  if (!row || !inScope(row, scope) || !config.statuses.includes(row[config.statusField])
    || (targetType === 'place' && (row.visibility !== 'school' || row.archived_at))) {
    throw new ApiError('not_found', '该内容当前不在可操作的公开范围内。', 404)
  }
  return row
}

async function createFavorite(user: any, payload: any, scope: { school: string; campus: string }) {
  const targetType = enumValue(payload.targetType, ['place', 'teacher', 'course', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide'] as const, '收藏类型')
  const targetId = uuid(payload.targetId, '收藏对象')
  if (payload.saved === false) {
    const result = await admin.from('campus_favorites').delete().eq('user_id', user.id).eq('school', scope.school).eq('target_type', targetType).eq('target_id', targetId)
    if (result.error) dbError(result.error)
    return { saved: false }
  }
  await assertPublicTarget(targetType, targetId, scope)
  const result = await admin.from('campus_favorites').upsert({ user_id: user.id, school: scope.school, target_type: targetType, target_id: targetId }, { onConflict: 'user_id,target_type,target_id' })
  if (result.error) dbError(result.error)
  return { saved: true }
}

async function submitReport(user: any, payload: any, scope: { school: string; campus: string }) {
  const targetType = enumValue(payload.targetType, ['place', 'teacher', 'course', 'course_review', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide'] as const, '内容类型')
  const targetId = uuid(payload.targetId, '内容')
  const target = await assertPublicTarget(targetType, targetId, scope)
  if ((target.owner_id || target.user_id) === user.id) throw new ApiError('invalid_input', '自己的内容请在投稿记录中修改或撤回。')
  const reason = enumValue(payload.reason, ['inaccurate', 'privacy', 'abuse', 'prohibited', 'other'] as const, '举报原因')
  const detail = text(payload.detail, 1000, '举报说明')
  const result = await admin.from('campus_content_reports').insert({ reporter_id: user.id, school: scope.school, campus: target.campus || '', target_type: targetType, target_id: targetId, reason, detail }).select('id,status').single()
  if (result.error?.code === '23505') throw new ApiError('already_reported', '这条内容已有你的待处理举报，请到“我的举报”查看进度。', 409)
  return { report: dataOrThrow(result) }
}

async function applyToTask(user: any, payload: any, scope: { school: string; campus: string }) {
  const taskId = uuid(payload.taskId, '互助任务')
  const task = dataOrThrow(await admin.from('campus_help_tasks').select('id,owner_id,school,campus,status').eq('id', taskId).maybeSingle())
  if (!task || !inScope(task, scope) || task.status !== 'open') throw new ApiError('not_found', '互助任务已结束或不可用。', 404)
  if (task.owner_id === user.id) throw new ApiError('invalid_input', '不能申请自己的互助任务。')
  const result = await admin.rpc('campus_life_create_help_application', {
    p_actor_id: user.id, p_task_id: taskId, p_message: publicText(payload.message, 500, '申请说明'),
  })
  const application = dataOrThrow(result)
  await notify(application.ownerId, user.id, 'campus_help_application', taskId)
  return { application }
}

async function listTaskApplications(user: any, scope: { school: string; campus: string }) {
  const owned = dataOrThrow(await admin.from('campus_help_tasks').select('id,title,owner_id').eq('owner_id', user.id).eq('school', scope.school).limit(100)) || []
  const ownApplications = dataOrThrow(await admin.from('campus_help_applications').select('id,task_id,applicant_id,message,status,created_at,updated_at').eq('applicant_id', user.id).order('created_at', { ascending: false }).limit(100)) || []
  const ownTaskIds = [...new Set(ownApplications.map((item: any) => item.task_id))]
  const ownTasks = ownTaskIds.length ? dataOrThrow(await admin.from('campus_help_tasks').select('id,title,owner_id').in('id', ownTaskIds).eq('school', scope.school)) || [] : []
  const acceptedTaskIds = [...new Set(ownApplications.filter((item: any) => item.status === 'accepted').map((item: any) => item.task_id))]
  const activeTasks = acceptedTaskIds.length ? dataOrThrow(await admin.from('campus_help_tasks').select('id,owner_id,assignee_id,school,campus,task_type,title,description,pickup_area,delivery_area,deadline,status,revision,updated_at').in('id', acceptedTaskIds).eq('school', scope.school)) || [] : []
  const listingApplications = owned.length ? dataOrThrow(await admin.from('campus_help_applications')
    .select('id,task_id,applicant_id,message,status,created_at,updated_at').in('task_id', owned.map((item: any) => item.id)).order('created_at', { ascending: false }).limit(200)) || [] : []
  const applications = [...ownApplications.map((item: any) => ({ ...item, perspective: 'applicant' })), ...listingApplications.map((item: any) => ({ ...item, perspective: 'owner' }))]
  const taskById = new Map([...owned, ...ownTasks].map((item: any) => [item.id, item]))
  const userIds = [...new Set(applications.map((item: any) => item.perspective === 'owner' ? item.applicant_id : taskById.get(item.task_id)?.owner_id).filter(Boolean))]
  const profiles = userIds.length ? dataOrThrow(await admin.from('social_profiles').select('user_id,nickname').in('user_id', userIds)) || [] : []
  const names = new Map(profiles.map((item: any) => [item.user_id, item.nickname]))
  return { tasks: owned, activeTasks: activeTasks.filter((item: any) => inScope(item, scope)), applications: applications.map((item: any) => {
    const counterpartId = item.perspective === 'owner' ? item.applicant_id : taskById.get(item.task_id)?.owner_id
    return { ...item, counterpartId, counterpart: names.get(counterpartId) || '校园用户', taskTitle: taskById.get(item.task_id)?.title || '互助任务' }
  }) }
}

async function handleHelpDecision(user: any, payload: any) {
  const taskId = uuid(payload.taskId, '任务')
  const applicationId = uuid(payload.applicationId, '接单申请')
  const decision = enumValue(payload.decision, ['accept', 'reject'] as const, '处理方式')
  if (decision === 'accept') {
    const result = await admin.rpc('campus_life_accept_help_application', { p_actor_id: user.id, p_task_id: taskId, p_application_id: applicationId })
    const accepted = dataOrThrow(result)
    await notify(accepted.assigneeId, user.id, 'campus_help_update', taskId)
    return { result: accepted }
  }
  const task = dataOrThrow(await admin.from('campus_help_tasks').select('id,owner_id').eq('id', taskId).maybeSingle())
  if (!task || task.owner_id !== user.id) throw new ApiError('forbidden', '只有任务发布者可以处理申请。', 403)
  const updated = await admin.from('campus_help_applications').update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', applicationId).eq('task_id', taskId).eq('status', 'pending').select('id,applicant_id').maybeSingle()
  const application = dataOrThrow(updated)
  if (!application) throw new ApiError('state_changed', '接单申请已经变化，请刷新后重试。', 409)
  await notify(application.applicant_id, user.id, 'campus_help_update', taskId)
  return { result: { taskId, status: 'rejected' } }
}

async function withdrawHelpApplication(user: any, payload: any) {
  const id = uuid(payload.applicationId, '接单申请')
  const result = await admin.from('campus_help_applications').update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id).eq('applicant_id', user.id).eq('status', 'pending').select('id,status').maybeSingle()
  const application = dataOrThrow(result)
  if (!application) throw new ApiError('state_changed', '当前申请不能退出。', 409)
  return { application }
}

async function transitionHelp(user: any, payload: any) {
  const taskId = uuid(payload.taskId, '任务')
  const next = enumValue(payload.status, ['in_progress', 'awaiting_confirmation', 'completed', 'cancelled', 'disputed'] as const, '任务状态')
  const task = dataOrThrow(await admin.from('campus_help_tasks').select('id,owner_id,assignee_id,status,revision').eq('id', taskId).maybeSingle())
  if (!task) throw new ApiError('not_found', '任务不存在。', 404)
  const actorIsOwner = task.owner_id === user.id
  const actorIsAssignee = task.assignee_id === user.id
  const actorRole = actorIsOwner ? 'owner' : actorIsAssignee ? 'assignee' : 'other'
  const allowed = canTransitionCampusHelp({ from: task.status, to: next, actorRole })
  if (!allowed) throw new ApiError('state_changed', '该状态转换当前不可用，请刷新任务。', 409)
  const disputeReason = next === 'disputed' ? publicText(payload.reason, 1500, '争议说明', true) : ''
  if (next === 'disputed') {
    const result = await admin.rpc('campus_life_raise_help_dispute', { p_actor_id: user.id, p_task_id: taskId, p_reason: disputeReason })
    const disputed = dataOrThrow(result)
    const recipient = actorIsOwner ? task.assignee_id : task.owner_id
    if (recipient) await notify(recipient, user.id, 'campus_help_update', taskId)
    return { task: disputed }
  }
  const updated = await admin.from('campus_help_tasks').update({ status: next, revision: task.revision + 1, updated_at: new Date().toISOString() })
    .eq('id', taskId).eq('status', task.status).eq('revision', task.revision).select('id,status,revision').maybeSingle()
  const row = dataOrThrow(updated)
  if (!row) throw new ApiError('state_changed', '任务已被其他操作更新，请刷新后重试。', 409)
  const recipient = actorIsOwner ? task.assignee_id : task.owner_id
  if (recipient) await notify(recipient, user.id, 'campus_help_update', taskId)
  return { task: row }
}

async function createLostClaim(user: any, payload: any, scope: { school: string; campus: string }) {
  const itemId = uuid(payload.itemId, '失物信息')
  const item = dataOrThrow(await admin.from('campus_lost_found_items').select('id,owner_id,school,campus,status').eq('id', itemId).maybeSingle())
  if (!item || !inScope(item, scope) || !['open', 'claim_pending'].includes(item.status)) throw new ApiError('not_found', '失物信息已关闭或不可用。', 404)
  if (item.owner_id === user.id) throw new ApiError('invalid_input', '不能认领自己发布的失物信息。')
  const evidence = text(payload.privateEvidence, 1000, '核验特征', true)
  if (evidence.length < 10) throw new ApiError('invalid_input', '请补充至少 10 个字的非公开核验特征。')
  const result = await admin.rpc('campus_life_create_lost_found_claim', { p_actor_id: user.id, p_item_id: itemId, p_private_evidence: evidence })
  const claim = dataOrThrow(result)
  await notify(claim.ownerId, user.id, 'campus_lost_found_claim', itemId)
  return { claim }
}

async function listLostClaims(user: any, scope: { school: string; campus: string }) {
  const ownedItems = dataOrThrow(await admin.from('campus_lost_found_items').select('id,title,owner_id').eq('owner_id', user.id).eq('school', scope.school).limit(100)) || []
  const claimsAsOwner = ownedItems.length ? dataOrThrow(await admin.from('campus_lost_found_claims')
    .select('id,item_id,claimant_id,private_evidence,status,created_at,updated_at').in('item_id', ownedItems.map((item: any) => item.id)).order('created_at', { ascending: false }).limit(200)) || [] : []
  const ownClaims = dataOrThrow(await admin.from('campus_lost_found_claims').select('id,item_id,claimant_id,status,created_at,updated_at').eq('claimant_id', user.id).order('created_at', { ascending: false }).limit(100)) || []
  const ownItemIds = [...new Set(ownClaims.map((item: any) => item.item_id))]
  const ownClaimItems = ownItemIds.length ? (dataOrThrow(await admin.from('campus_lost_found_items').select('id,title,owner_id,school,campus').in('id', ownItemIds).eq('school', scope.school)) || []).filter((item: any) => inScope(item, scope)) : []
  const userIds = [...new Set([...claimsAsOwner.map((item: any) => item.claimant_id), ...ownClaimItems.map((item: any) => item.owner_id)])]
  const profiles = userIds.length ? dataOrThrow(await admin.from('social_profiles').select('user_id,nickname').in('user_id', userIds)) || [] : []
  const names = new Map(profiles.map((item: any) => [item.user_id, item.nickname]))
  return { ownedItems, claims: claimsAsOwner.map((item: any) => ({ ...item, claimant: names.get(item.claimant_id) || '校园用户' })), ownClaims: ownClaims.map((item: any) => ({ ...item, itemTitle: ownClaimItems.find((row: any) => row.id === item.item_id)?.title || '失物信息', ownerId: ownClaimItems.find((row: any) => row.id === item.item_id)?.owner_id, ownerName: names.get(ownClaimItems.find((row: any) => row.id === item.item_id)?.owner_id) || '发布者' })) }
}

async function decideLostClaim(user: any, payload: any) {
  const claimId = uuid(payload.claimId, '认领申请')
  const decision = enumValue(payload.decision, ['approve', 'reject'] as const, '处理方式')
  const claim = dataOrThrow(await admin.from('campus_lost_found_claims').select('id,claimant_id').eq('id', claimId).maybeSingle())
  if (!claim) throw new ApiError('not_found', '认领申请已不存在。', 404)
  const result = await admin.rpc('campus_life_decide_lost_found_claim', { p_actor_id: user.id, p_claim_id: claimId, p_decision: decision })
  const decisionResult = dataOrThrow(result)
  await notify(claim.claimant_id, user.id, 'campus_lost_found_claim', decisionResult.itemId)
  return { claim: { id: claimId, status: decisionResult.claimStatus }, itemStatus: decisionResult.itemStatus }
}

async function eventRegister(user: any, payload: any, scope: { school: string; campus: string }) {
  const eventId = uuid(payload.eventId, '活动')
  const event = dataOrThrow(await admin.from('campus_events').select('id,owner_id,school,campus').eq('id', eventId).maybeSingle())
  if (!event || !inScope(event, scope)) throw new ApiError('not_found', '活动不可用。', 404)
  const result = await admin.rpc('campus_life_register_event', { p_actor_id: user.id, p_event_id: eventId })
  const registration = dataOrThrow(result)
  if (event.owner_id !== user.id) {
    const registeredAt = String(registration.registeredAt || registration.registered_at || '')
    await notify(event.owner_id, user.id, 'campus_event_update', eventId,
      `campus-event-registration:${eventId}:${user.id}:${registeredAt}`)
  }
  return { registration }
}

async function messageParticipants(targetType: string, targetId: string, recipientId: string, userId: string, scope: { school: string; campus: string }) {
  const config = targetType === 'market_listing' ? ['campus_market_listings', 'owner_id', 'campus_market_interests', 'listing_id', 'buyer_id']
    : targetType === 'help_task' ? ['campus_help_tasks', 'owner_id', 'campus_help_applications', 'task_id', 'applicant_id']
      : targetType === 'lost_found' ? ['campus_lost_found_items', 'owner_id', 'campus_lost_found_claims', 'item_id', 'claimant_id'] : null
  if (!config) throw new ApiError('invalid_input', '私信类型无效。')
  const [table, ownerField, relationTable, relationField, otherField] = config
  const item = dataOrThrow(await admin.from(table).select(`id,school,campus,status,${ownerField}`).eq('id', targetId).maybeSingle())
  if (!item || !inScope(item, scope)) throw new ApiError('not_found', '相关校园内容不可用。', 404)
  const activeTargetStatuses: Record<string, string[]> = {
    market_listing: ['active', 'reserved', 'sold'],
    help_task: ['open', 'assigned', 'in_progress', 'awaiting_confirmation', 'completed', 'disputed'],
    lost_found: ['open', 'claim_pending', 'returned'],
  }
  if (!activeTargetStatuses[targetType].includes(item.status)) throw new ApiError('forbidden', '当前内容状态不再开放私信。', 403)
  const allowedStatuses = targetType === 'lost_found' ? ['pending', 'approved'] : ['pending', 'accepted']
  const links = dataOrThrow(await admin.from(relationTable).select(`${otherField},status`).eq(relationField, targetId).in('status', allowedStatuses).limit(100)) || []
  const ownerId = item[ownerField]
  const isOwnerApplicantPair = (userId === ownerId && recipientId !== ownerId)
    || (recipientId === ownerId && userId !== ownerId)
  const relationExists = links.some((row: any) => row[otherField] === (userId === ownerId ? recipientId : userId))
  if (!isOwnerApplicantPair || !relationExists) throw new ApiError('forbidden', '私信只对发布者与对应的有效联系对象开放。', 403)
  return { ownerId, item }
}

async function privateMessage(user: any, action: string, payload: any, scope: { school: string; campus: string }) {
  const targetType = enumValue(payload.targetType, ['market_listing', 'help_task', 'lost_found'] as const, '私信类型')
  const targetId = uuid(payload.targetId, '私信内容')
  const recipientId = uuid(payload.recipientId, '收件人')
  const participants = await messageParticipants(targetType, targetId, recipientId, user.id, scope)
  if (action === 'message_send') {
    const body = publicText(payload.body, 1500, '消息内容', true)
    const result = await admin.from('campus_private_messages').insert({ school: scope.school, target_type: targetType, target_id: targetId, sender_id: user.id, recipient_id: recipientId, body })
      .select('id,created_at').single()
    const message = dataOrThrow(result)
    await notify(recipientId, user.id, 'campus_private_message', targetId)
    return { message }
  }
  const result = await admin.from('campus_private_messages').select('id,target_type,target_id,sender_id,recipient_id,body,created_at,read_at')
    .eq('school', scope.school).eq('target_type', targetType).eq('target_id', targetId)
    .or(`and(sender_id.eq.${user.id},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${user.id})`).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
  const messages = (dataOrThrow(result) || []).reverse()
  await admin.from('campus_private_messages').update({ read_at: new Date().toISOString() }).eq('target_id', targetId).eq('target_type', targetType).eq('sender_id', recipientId).eq('recipient_id', user.id).is('read_at', null)
  return { messages }
}

async function listMarketInterests(user: any, scope: { school: string; campus: string }) {
  const owned = dataOrThrow(await admin.from('campus_market_listings').select('id,title,listing_type,owner_id').eq('owner_id', user.id).eq('school', scope.school).limit(100)) || []
  const own = dataOrThrow(await admin.from('campus_market_interests').select('id,listing_id,buyer_id,message,status,created_at,updated_at').eq('buyer_id', user.id).order('created_at', { ascending: false }).limit(100)) || []
  const fromBuyers = owned.length ? dataOrThrow(await admin.from('campus_market_interests').select('id,listing_id,buyer_id,message,status,created_at,updated_at').in('listing_id', owned.map((item: any) => item.id)).order('created_at', { ascending: false }).limit(200)) || [] : []
  const allListingIds = [...new Set([...own.map((item: any) => item.listing_id), ...owned.map((item: any) => item.id)])]
  const listingMeta = allListingIds.length ? dataOrThrow(await admin.from('campus_market_listings').select('id,title,listing_type,owner_id,school,campus').in('id', allListingIds).eq('school', scope.school)) || [] : []
  const visibleListingMeta = listingMeta.filter((item: any) => inScope(item, scope))
  const listingById = new Map(visibleListingMeta.map((item: any) => [item.id, item]))
  const ids = [...new Set([...fromBuyers.map((item: any) => item.buyer_id), ...visibleListingMeta.map((item: any) => item.owner_id)])]
  const profiles = ids.length ? dataOrThrow(await admin.from('social_profiles').select('user_id,nickname').in('user_id', ids)) || [] : []
  const names = new Map(profiles.map((item: any) => [item.user_id, item.nickname]))
  const visibleBuyerInterests = own.filter((item: any) => listingById.has(item.listing_id))
  return { owned, interests: [
    ...fromBuyers.map((item: any) => ({ ...item, perspective: 'seller', listingTitle: owned.find((row: any) => row.id === item.listing_id)?.title || '商品', listingType: owned.find((row: any) => row.id === item.listing_id)?.listing_type, counterpartId: item.buyer_id, counterpart: names.get(item.buyer_id) || '校园用户' })),
    ...visibleBuyerInterests.map((item: any) => ({ ...item, perspective: 'buyer', listingTitle: listingById.get(item.listing_id)?.title || '商品', listingType: listingById.get(item.listing_id)?.listing_type, counterpartId: listingById.get(item.listing_id)?.owner_id, counterpart: names.get(listingById.get(item.listing_id)?.owner_id) || '发布者' })),
  ] }
}

async function interestCreate(user: any, payload: any, scope: { school: string; campus: string }) {
  const listingId = uuid(payload.listingId, '商品')
  const listing = dataOrThrow(await admin.from('campus_market_listings').select('id,owner_id,school,campus,status').eq('id', listingId).maybeSingle())
  if (!listing || !inScope(listing, scope) || listing.status !== 'active') throw new ApiError('not_found', '商品已不可预订。', 404)
  if (listing.owner_id === user.id) throw new ApiError('invalid_input', '不能联系自己的商品。')
  const result = await admin.rpc('campus_life_create_market_interest', {
    p_actor_id: user.id, p_listing_id: listingId, p_message: publicText(payload.message, 500, '联系说明'),
  })
  const interest = dataOrThrow(result)
  await notify(interest.ownerId, user.id, 'campus_market_interest', listingId)
  return { interest }
}

async function decideMarketInterest(user: any, payload: any) {
  const listingId = uuid(payload.listingId, '商品')
  const interestId = uuid(payload.interestId, '联系意向')
  const decision = enumValue(payload.decision, ['accept', 'reject'] as const, '处理方式')
  if (decision === 'accept') {
    const result = await admin.rpc('campus_life_reserve_listing', { p_actor_id: user.id, p_listing_id: listingId, p_interest_id: interestId })
    const reservation = dataOrThrow(result)
    await notify(reservation.buyerId, user.id, 'campus_market_interest', listingId)
    return { reservation }
  }
  const listing = dataOrThrow(await admin.from('campus_market_listings').select('id,owner_id').eq('id', listingId).maybeSingle())
  if (!listing || listing.owner_id !== user.id) throw new ApiError('forbidden', '只有发布者可以处理联系意向。', 403)
  const result = await admin.from('campus_market_interests').update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', interestId).eq('listing_id', listingId).eq('status', 'pending').select('id,buyer_id').maybeSingle()
  const interest = dataOrThrow(result)
  if (!interest) throw new ApiError('state_changed', '联系意向已经变化。', 409)
  await notify(interest.buyer_id, user.id, 'campus_market_interest', listingId)
  return { interest: { id: interest.id, status: 'rejected' } }
}

async function withdrawMarketInterest(user: any, payload: any) {
  const id = uuid(payload.interestId, '联系意向')
  const result = await admin.from('campus_market_interests').update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('id', id).eq('buyer_id', user.id).eq('status', 'pending').select('id,status').maybeSingle()
  const interest = dataOrThrow(result)
  if (!interest) throw new ApiError('state_changed', '当前联系意向不能撤回。', 409)
  return { interest }
}

async function updateMarketStatus(user: any, payload: any) {
  const listingId = uuid(payload.listingId, '商品')
  const status = enumValue(payload.status, ['sold', 'withdrawn'] as const, '商品状态')
  const listing = dataOrThrow(await admin.from('campus_market_listings').select('id,owner_id,status,revision,reserved_by').eq('id', listingId).maybeSingle())
  if (!listing || listing.owner_id !== user.id) throw new ApiError('forbidden', '只有发布者可以更新商品状态。', 403)
  const permitted = status === 'withdrawn' ? ['active', 'reserved'] : ['reserved']
  if (!permitted.includes(listing.status)) throw new ApiError('state_changed', '商品当前状态不能进行该操作。', 409)
  const result = await admin.from('campus_market_listings').update({ status, revision: listing.revision + 1, updated_at: new Date().toISOString() })
    .eq('id', listingId).eq('status', listing.status).eq('revision', listing.revision).select('id,status,revision,reserved_by').maybeSingle()
  const updated = dataOrThrow(result)
  if (!updated) throw new ApiError('state_changed', '商品刚刚发生变化，请刷新后重试。', 409)
  return { listing: updated }
}

async function addShuttleCorrection(user: any, payload: any, scope: { school: string; campus: string }, editContext?: { id: string; revision: number; actorId: string }) {
  const routeId = uuid(payload.routeId, '校车线路')
  const route = dataOrThrow(await admin.from('campus_shuttle_routes').select('id,school,campus').eq('id', routeId).maybeSingle())
  if (!route || !inScope(route, scope)) throw new ApiError('not_found', '线路不可用。', 404)
  const row = { owner_id: user.id, school: scope.school, route_id: routeId,
    detail: publicText(payload.detail, 1500, '纠错说明', true), source_url: safeUrl(payload.sourceUrl, '纠错来源') }
  if (editContext) return { item: await insert('campus_shuttle_corrections', row, editContext) }
  const result = await admin.from('campus_shuttle_corrections').insert(row).select('id,status').single()
  return { correction: dataOrThrow(result) }
}

async function addShuttleException(user: any, payload: any, scope: { school: string; campus: string }, editContext?: { id: string; revision: number; actorId: string }) {
  const routeId = uuid(payload.routeId, '校车线路')
  const route = dataOrThrow(await admin.from('campus_shuttle_routes').select('id,school,campus').eq('id', routeId).maybeSingle())
  if (!route || !inScope(route, scope)) throw new ApiError('not_found', '线路不可用。', 404)
  const exceptionType = enumValue(payload.exceptionType, ['suspended', 'additional', 'changed'] as const, '特殊班次类型')
  const departureTime = payload.departureTime ? timeValue(payload.departureTime) : null
  if (exceptionType !== 'suspended' && !departureTime) throw new ApiError('invalid_input', '加班或调整班次必须填写发车时间。')
  const row = { owner_id: user.id, route_id: routeId,
    service_date: isoDate(payload.serviceDate, '适用日期', true), exception_type: exceptionType,
    departure_time: departureTime, direction: enumValue(payload.direction, ['outbound', 'inbound'] as const, '行驶方向'),
    note: publicText(payload.note, 300, '特殊说明'), source_url: safeUrl(payload.sourceUrl, '特殊安排来源', true),
  }
  if (editContext) return { item: await insert('campus_shuttle_exceptions', { owner_id: user.id, ...row }, editContext) }
  const result = await admin.from('campus_shuttle_exceptions').insert({ owner_id: user.id, ...row }).select('id,status').single()
  return { exception: dataOrThrow(result) }
}

async function favoriteList(user: any, scope: { school: string; campus: string }) {
  const result = await admin.from('campus_favorites').select('target_type,target_id,created_at').eq('user_id', user.id).eq('school', scope.school).order('created_at', { ascending: false }).limit(500)
  return { favorites: dataOrThrow(result) || [] }
}

async function search(scope: { school: string; campus: string }, payload: any) {
  const needle = publicText(payload.query, 100, '搜索内容', true).toLocaleLowerCase('zh-CN')
  const [courseData, market, help, shuttles, lostFound, events, guides, placeResult] = await Promise.all([
    listCourses(scope), listMarket(scope), listHelp(scope), listShuttles(scope), listLostFound(scope), listEvents(scope), listGuides(scope),
    scopeQuery(admin.from('campus_places').select('id,school,campus,name,place_type,area,description,review_status,visibility,archived_at')
      .eq('school', scope.school).eq('review_status', 'approved').eq('visibility', 'school').is('archived_at', null), scope).limit(100),
  ])
  const places = (dataOrThrow(placeResult) || []).filter((item: any) => inScope(item, scope))
  const rows: any[] = [
    ...courseData.courses.map((item: any) => ({ id: item.id, type: 'course', title: item.name, detail: item.department, campus: item.campus })),
    ...courseData.teachers.map((item: any) => ({ id: item.id, type: 'teacher', title: item.name, detail: [item.department, item.research_directions].filter(Boolean).join(' · '), campus: item.campus })),
    ...places.map((item: any) => ({ id: item.id, type: 'place', title: item.name, detail: [item.place_type, item.area, item.description].filter(Boolean).join(' · '), campus: item.campus })),
    ...market.map((item: any) => ({ id: item.id, type: 'market_listing', title: item.title, detail: item.description, campus: item.campus })),
    ...help.map((item: any) => ({ id: item.id, type: 'help_task', title: item.title, detail: item.description, campus: item.campus })),
    ...shuttles.routes.map((item: any) => ({ id: item.id, type: 'shuttle_route', title: item.name, detail: item.source_url, campus: item.campus })),
    ...lostFound.map((item: any) => ({ id: item.id, type: 'lost_found', title: item.title, detail: item.description, campus: item.campus })),
    ...events.map((item: any) => ({ id: item.id, type: 'event', title: item.title, detail: item.description, campus: item.campus })),
    ...guides.map((item: any) => ({ id: item.id, type: 'guide', title: item.title, detail: item.body, campus: item.campus })),
  ]
  return { results: rows.filter((row) => `${row.title} ${row.detail} ${row.campus}`.toLocaleLowerCase('zh-CN').includes(needle)).slice(0, 60) }
}

async function moderationQueue(userId: string, payload: any) {
  await requireReviewer(userId)
  const page = Number.isInteger(Number(payload.page)) ? Math.max(0, Math.min(2000, Number(payload.page))) : 0
  const pageSize = 40
  const result = dataOrThrow(await admin.rpc('campus_governance_queue', { p_actor_id: userId, p_offset: page * pageSize, p_limit: pageSize, p_type: text(payload.type, 40, '内容分类'), p_school: text(payload.school, 100, '筛选学校') })) || { items: [], hasMore: false }
  const items = Array.isArray(result.items) ? result.items : []
  const routeIds = items.filter((entry: any) => entry.type === 'shuttle_route').map((entry: any) => entry.item?.id).filter(Boolean)
  if (routeIds.length) {
    const [stops, departures] = await Promise.all([
      admin.from('campus_shuttle_stops').select('route_id,direction,position,name').in('route_id', routeIds).order('position'),
      admin.from('campus_shuttle_departures').select('route_id,direction,service_day,departure_time,stop_name').in('route_id', routeIds).order('departure_time'),
    ])
    const stopRows = dataOrThrow(stops) || []
    const departureRows = dataOrThrow(departures) || []
    for (const entry of items.filter((row: any) => row.type === 'shuttle_route')) {
      entry.item.stops = stopRows.filter((row: any) => row.route_id === entry.item.id)
      entry.item.departures = departureRows.filter((row: any) => row.route_id === entry.item.id)
    }
  }
  const assignmentIds = [...new Set(items.flatMap((entry: any) => entry.type === 'assignment' ? [entry.item.id]
    : entry.type === 'course_review' ? [entry.item.assignment_id] : []).filter(Boolean))]
  if (assignmentIds.length) {
    const assignments = dataOrThrow(await admin.from('campus_teaching_assignments').select('id,course_id,teacher_id,term').in('id', assignmentIds)) || []
    const courseIds = [...new Set(assignments.map((item: any) => item.course_id))]
    const teacherIds = [...new Set(assignments.map((item: any) => item.teacher_id))]
    const [courses, teachers] = await Promise.all([
      courseIds.length ? admin.from('campus_courses').select('id,name').in('id', courseIds) : Promise.resolve({ data: [], error: null }),
      teacherIds.length ? admin.from('campus_teachers').select('id,name').in('id', teacherIds) : Promise.resolve({ data: [], error: null }),
    ])
    const courseNames = new Map((dataOrThrow(courses) || []).map((item: any) => [item.id, item.name]))
    const teacherNames = new Map((dataOrThrow(teachers) || []).map((item: any) => [item.id, item.name]))
    const assignmentById = new Map(assignments.map((item: any) => [item.id, { ...item, courseName: courseNames.get(item.course_id), teacherName: teacherNames.get(item.teacher_id) }]))
    for (const entry of items) {
      const assignment = assignmentById.get(entry.type === 'assignment' ? entry.item.id : entry.type === 'course_review' ? entry.item.assignment_id : '')
      if (assignment) Object.assign(entry.item, { course_name: assignment.courseName, teacher_name: assignment.teacherName, term: assignment.term })
    }
  }
  return { items, hasMore: Boolean(result.hasMore), total: result.total || 0, counts: result.counts || {}, page, pageSize }
}

async function moderate(user: any, payload: any) {
  await requireReviewer(user.id)
  if (payload.targetType === 'report') {
    const reportId = uuid(payload.targetId, '举报')
    const report = dataOrThrow(await admin.from('campus_content_reports').select('revision').eq('id', reportId).maybeSingle())
    if (!report) throw new ApiError('not_found', '举报已不可用。', 404)
    const decision = enumValue(payload.decision, ['approve', 'dismiss'] as const, '举报处理')
    const result = dataOrThrow(await admin.rpc('campus_resolve_report', { p_actor: user.id, p_report: reportId, p_decision: decision === 'approve' ? 'resolve' : 'dismiss', p_reason: text(payload.reason, 500, '处理依据', true), p_revision: payload.revision ?? report.revision, p_target_revision: null }))
    return { item: result, notificationSent: true }
  }
  if (payload.targetType === 'place') {
    const result = dataOrThrow(await admin.rpc('campus_review_place', { p_actor: user.id, p_id: uuid(payload.targetId, '地点'), p_decision: enumValue(payload.decision, ['approve', 'reject'] as const, '审核决定'), p_reason: text(payload.reason, 500, '审核说明'), p_revision: uuid(payload.revision, '地点版本') }))
    const notificationSent = await notify(result.ownerId, user.id, 'campus_place_reviewed', result.id)
    return { item: result, notificationSent }
  }
  const targetType = enumValue(payload.targetType, [...Object.keys(PUBLIC_TABLES), 'report'] as const, '审核内容类型')
  if (targetType === 'help_dispute') throw new ApiError('invalid_input', '互助争议需要使用裁定流程处理。')
  const targetId = uuid(payload.targetId, '审核内容')
  const decision = enumValue(payload.decision, ['approve', 'reject', 'dismiss'] as const, '审核决定')
  const reason = text(payload.reason, 500, '审核说明')
  if (decision === 'reject' && !reason) throw new ApiError('invalid_input', '拒绝时需要说明原因。')
  if (targetType === 'report' && decision === 'reject') throw new ApiError('invalid_input', '举报请选择“已处理”或“不成立”。')
  if (targetType !== 'report' && decision === 'dismiss') throw new ApiError('invalid_input', '当前内容不能使用该处理方式。')
  const revision = payload.revision === undefined || payload.revision === null ? null : Number(payload.revision)
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new ApiError('invalid_input', '内容版本无效。')
  const updated = dataOrThrow(await admin.rpc('campus_life_moderate_content', {
    p_actor_id: user.id, p_target_type: targetType, p_target_id: targetId,
    p_decision: decision, p_reason: reason, p_expected_revision: revision,
  }))
  // notify() swallows its own storage errors and reports them as false; honour that result
  // so the moderation screen can say the audit landed but the notification did not.
  let notificationSent = true
  if (updated.ownerId && targetType !== 'report') notificationSent = await notify(updated.ownerId, user.id, 'campus_content_reviewed', targetId)
  return { item: { id: updated.id, status: updated.status }, notificationSent }
}

async function resolveHelpDispute(user: any, payload: any) {
  await requireReviewer(user.id)
  const disputeId = uuid(payload.disputeId, '互助争议')
  const taskStatus = enumValue(payload.taskStatus, ['completed', 'cancelled'] as const, '争议裁定')
  const reason = publicText(payload.reason, 1500, '裁定说明', true)
  const result = dataOrThrow(await admin.rpc('campus_life_resolve_help_dispute', {
    p_actor_id: user.id, p_dispute_id: disputeId, p_task_status: taskStatus, p_reason: reason,
  }))
  for (const recipient of new Set([result.ownerId, result.assigneeId])) {
    if (recipient && recipient !== user.id) await notify(recipient, user.id, 'campus_help_update', result.taskId)
  }
  return { dispute: { id: disputeId, status: 'resolved', taskStatus } }
}

async function resubmitContent(user: any, payload: any, scope: { school: string; campus: string }) {
  const targetType = enumValue(payload.targetType, [
    'teacher', 'course', 'assignment', 'market', 'help', 'shuttle', 'shuttle_correction',
    'shuttle_exception', 'lost', 'event', 'guide',
  ] as const, '投稿类型')
  const targetId = uuid(payload.targetId, '投稿')
  const revision = Number(payload.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ApiError('invalid_input', '投稿版本无效。')
  const content = requireObject(payload.content, '投稿内容')
  const editContext = { id: targetId, revision, actorId: user.id }
  if (targetType === 'shuttle_correction') return addShuttleCorrection(user, content, scope, editContext)
  if (targetType === 'shuttle_exception') return addShuttleException(user, content, scope, editContext)
  const actions: Record<string, string> = {
    teacher: 'teacher_submit', course: 'course_submit', assignment: 'assignment_submit',
    market: 'market_submit', help: 'help_submit', shuttle: 'shuttle_submit',
    lost: 'lost_found_submit', event: 'event_submit', guide: 'guide_submit',
  }
  return submit(user, actions[targetType], content, scope, editContext)
}

async function handle(user: any, action: string, payload: any) {
  requireObject(payload, '请求')
  if (action === 'mine_list') return getMine(user.id)
  if (action === 'content_withdraw') {
    return dataOrThrow(await admin.rpc('campus_withdraw_content', { p_actor: user.id, p_type: text(payload.targetType, 40, '内容类型', true), p_id: uuid(payload.targetId, '内容'), p_revision: String(payload.revision ?? '').slice(0,100) }))
  }
  if (action === 'governance_access') return governanceAccess(user.id)
  if (action === 'reports_mine') {
    const page = Math.max(0, Math.min(2000, Number.isSafeInteger(payload.page) ? payload.page : 0))
    const result = await admin.from('campus_content_reports').select('id,target_type,target_id,school,campus,reason,detail,status,resolution,resolution_action,resolved_at,created_at', { count: 'exact' }).eq('reporter_id', user.id).order('created_at', { ascending: false }).range(page * 30, page * 30 + 29)
    return { reports: dataOrThrow(result) || [], total: result.count || 0, page }
  }
  if (action === 'moderation_history') {
    await requireReviewer(user.id)
    return { events: dataOrThrow(await admin.rpc('campus_governance_history', { p_actor: user.id, p_offset: Math.max(0, Number(payload.page) || 0) * 30 })) || [] }
  }
  if (action === 'report_resolve') {
    await requireReviewer(user.id)
    const result = dataOrThrow(await admin.rpc('campus_resolve_report', { p_actor: user.id, p_report: uuid(payload.reportId, '举报'), p_decision: enumValue(payload.decision, ['remove', 'resolve', 'dismiss'] as const, '处理方式'), p_reason: text(payload.reason, 500, '处理依据', true), p_revision: Number(payload.revision), p_target_revision: payload.targetRevision == null ? null : String(payload.targetRevision).slice(0,100) }))
    return result
  }
  if (action === 'moderation_queue') return moderationQueue(user.id, payload)
  if (action === 'moderation_decide') return moderate(user, payload)
  if (action === 'help_dispute_resolve') return resolveHelpDispute(user, payload)
  if (['teacher_submit', 'course_submit', 'assignment_submit', 'market_submit', 'help_submit', 'shuttle_submit', 'lost_found_submit', 'event_submit', 'guide_submit', 'shuttle_correction_submit', 'shuttle_exception_submit', 'content_resubmit'].includes(action)) {
    await enforceRateLimit(user.id, 'campus_publish', 8)
  } else if (action === 'course_review_submit') await enforceRateLimit(user.id, 'campus_review', 5)
  else if (action === 'content_report') await enforceRateLimit(user.id, 'campus_report', 10)
  else if (action === 'message_send' || action === 'market_interest_create' || action === 'help_apply' || action === 'lost_found_claim_submit') {
    await enforceRateLimit(user.id, 'campus_contact', 30)
  } else if (action === 'favorite_set') await enforceRateLimit(user.id, 'campus_favorite', 100)
  const scope = await scopeFor(user.id)
  if (['teacher_submit', 'course_submit', 'assignment_submit', 'market_submit', 'help_submit', 'shuttle_submit', 'lost_found_submit', 'event_submit', 'guide_submit'].includes(action)) {
    return submit(user, action, payload, scope)
  }
  switch (action) {
    case 'content_resubmit': return resubmitContent(user, payload, scope)
    case 'course_review_submit': return submitCourseReview(user, payload, scope)
    case 'courses_list': return listCourses(scope)
    case 'market_list': return { listings: await listMarket(scope) }
    case 'market_interest_create': return interestCreate(user, payload, scope)
    case 'market_interest_list': return listMarketInterests(user, scope)
    case 'market_interest_decide': return decideMarketInterest(user, payload)
    case 'market_interest_withdraw': return withdrawMarketInterest(user, payload)
    case 'market_status_update': return updateMarketStatus(user, payload)
    case 'help_list': return { tasks: await listHelp(scope) }
    case 'help_apply': return applyToTask(user, payload, scope)
    case 'help_applications_list': return listTaskApplications(user, scope)
    case 'help_application_decide': return handleHelpDecision(user, payload)
    case 'help_application_withdraw': return withdrawHelpApplication(user, payload)
    case 'help_transition': return transitionHelp(user, payload)
    case 'shuttle_list': return listShuttles(scope)
    case 'shuttle_correction_submit': return addShuttleCorrection(user, payload, scope)
    case 'shuttle_exception_submit': return addShuttleException(user, payload, scope)
    case 'lost_found_list': return { items: await listLostFound(scope) }
    case 'lost_found_claim_submit': return createLostClaim(user, payload, scope)
    case 'lost_found_claims_list': return listLostClaims(user, scope)
    case 'lost_found_claim_decide': return decideLostClaim(user, payload)
    case 'events_list': return { events: await listEvents(scope, user.id) }
    case 'event_register': return eventRegister(user, payload, scope)
    case 'event_cancel_registration': {
      const eventId = uuid(payload.eventId, '活动')
      const event = dataOrThrow(await admin.from('campus_events').select('id,school,campus').eq('id', eventId).maybeSingle())
      if (!event || !inScope(event, scope)) throw new ApiError('not_found', '活动不可用。', 404)
      const result = await admin.from('campus_event_registrations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('event_id', eventId).eq('user_id', user.id).eq('status', 'registered').select('id,status').maybeSingle()
      const registration = dataOrThrow(result)
      return { registration: registration || { status: 'cancelled' } }
    }
    case 'guides_list': return { guides: await listGuides(scope) }
    case 'favorite_set': return createFavorite(user, payload, scope)
    case 'favorite_list': return favoriteList(user, scope)
    case 'content_report': return submitReport(user, payload, scope)
    case 'message_send': case 'message_list': return privateMessage(user, action, payload, scope)
    case 'search': return search(scope, payload)
    default: throw new ApiError('invalid_input', '校园服务操作无效。')
  }
}

async function readRequestText(request: Request, maximumBytes: number) {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0, result = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return result + decoder.decode()
      bytes += chunk.value.byteLength
      if (bytes > maximumBytes) { await reader.cancel().catch(() => {}); throw new ApiError('invalid_input', '请求内容过大。', 413) }
      result += decoder.decode(chunk.value, { stream: true })
    }
  } finally { reader.releaseLock() }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return withCors(request, new Response('ok', { headers: corsHeaders }))
  if (request.method !== 'POST') return withCors(request, reply({ error: '仅支持 POST。', code: 'method_not_allowed' }, 405))
  if (!supabaseUrl || !serviceKey) return withCors(request, reply({ error: '校园服务尚未配置。', code: 'service_unavailable' }, 503))
  try {
    if (Number(request.headers.get('content-length') || 0) > 32_768) throw new ApiError('invalid_input', '请求内容过大。', 413)
    let body: any
    try { body = JSON.parse(await readRequestText(request, 32_768)) } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('invalid_input', '请求内容无效。')
    }
    if (!body || typeof body.action !== 'string') throw new ApiError('invalid_input', '请求内容无效。')
    const user = await authenticate(request)
    const data = await handle(user, body.action, body.payload || {})
    return withCors(request, reply({ data }))
  } catch (error) {
    if (error instanceof ApiError) return withCors(request, reply({ error: error.message, code: error.code }, error.status))
    console.error('[campus-life] unexpected request failure', error instanceof Error ? error.name : 'unknown')
    return withCors(request, reply({ error: '校园服务暂时不可用，请稍后重试。', code: 'service_unavailable' }, 503))
  }
})
