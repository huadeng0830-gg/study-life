/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from '@supabase/supabase-js'
import { createPlatformAdminHandler, PlatformAdminError } from './handler.js'
import { countAuthUsers, publicAccount, searchAuthUsers } from './users.js'
import { attachAccountRestrictions, setAccountRestriction } from './restrictions.js'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const admin = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

const allowedOrigins = new Set([
  'https://study-life.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'app://study-life',
  ...(Deno.env.get('PLATFORM_ADMIN_ALLOWED_ORIGINS') || '').split(',').map((item) => item.trim()).filter(Boolean),
])

function requireAdminClient() {
  if (!admin) throw new Error('Platform admin service is not configured.')
  return admin
}

async function ownerIds(client) {
  const { data, error } = await client.from('platform_admins').select('user_id').eq('role', 'owner')
  if (error) throw error
  return new Set((data || []).map((row) => row.user_id))
}

const service = {
  async authenticate(token) {
    const client = requireAdminClient()
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) return null
    return data.user
  },

  async isOwner(userId) {
    const client = requireAdminClient()
    const { data, error } = await client.from('platform_admins').select('user_id').eq('role', 'owner').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return Boolean(data)
  },

  async reviewerAccess(userId) {
    const { data, error } = await requireAdminClient().from('campus_reviewer_grants').select('school,campus,active').eq('user_id', userId).eq('active', true).maybeSingle()
    if (error) throw error
    return data ? { reviewer: true, scope: { school: data.school, campus: data.campus } } : { reviewer: false, scope: null }
  },

  async listReviewers({ page = 1, userId = '', actorId = '' } = {}) {
    const client = requireAdminClient()
    let query = client.from('campus_reviewer_grants').select('user_id,school,campus,active,revision,updated_at', { count: 'exact' })
    if (userId) query = query.eq('user_id', userId)
    const { data, error, count } = await query.order('updated_at', { ascending: false }).order('user_id').range((page - 1) * 25, page * 25 - 1)
    if (error) throw error
    const ids = [...new Set((data || []).map(grant => grant.user_id))]
    const accounts = ids.length ? await client.rpc('platform_admin_user_emails', { p_actor: actorId, p_user_ids: ids }) : { data: [], error: null }
    if (accounts.error) throw accounts.error
    const emails = new Map((accounts.data || []).map((row: { user_id: string; email: string }) => [row.user_id, row.email]))
    const reviewers = (data || []).map(grant => ({ ...grant, email: emails.get(grant.user_id) || '账号已不可用' }))
    return { reviewers, total: count || 0, page }
  },

  async setReviewer({ actorId, userId, school, campus, active, reason, revision }) {
    const client = requireAdminClient()
    const { data, error } = await client.rpc('campus_set_reviewer', { p_actor: actorId, p_user: userId, p_school: school, p_campus: campus, p_active: active, p_reason: reason, p_revision: revision })
    if (error) {
      const code = String(error.message || '')
      if (code.includes('REVISION_CHANGED')) throw new PlatformAdminError('state_changed', '审核授权已变化，请刷新。', 409)
      if (code.includes('UNVERIFIED')) throw new PlatformAdminError('reviewer_unverified', '请先让对方注册并验证邮箱。', 409)
      if (code.includes('FORBIDDEN') || code.includes('SELF_ACTION')) throw new PlatformAdminError('forbidden', '不能修改总管理员的审核授权。', 403)
      throw error
    }
    return data
  },

  async getRegistration() {
    const { data, error } = await requireAdminClient().from('platform_registration_settings').select('registration_open,updated_at').eq('singleton', true).single()
    if (error) throw error
    return { enabled: data.registration_open, updatedAt: data.updated_at }
  },

  async setRegistration({ actorId, enabled, expectedUpdatedAt }) {
    const { data, error } = await requireAdminClient().rpc('platform_set_registration', { p_actor: actorId, p_enabled: enabled, p_expected_updated_at: expectedUpdatedAt })
    if (error) {
      if (String(error.message).includes('PLATFORM_STATE_CHANGED')) throw new PlatformAdminError('registration_changed', '注册设置已在其他页面更新，请刷新后重试。', 409)
      if (String(error.message).includes('PLATFORM_FORBIDDEN')) throw new PlatformAdminError('forbidden', '当前账号没有修改注册设置的权限。', 403)
      throw error
    }
    return data
  },

  async getOverview() {
    const client = requireAdminClient()
    const [userResult, projectResult, profileResult] = await Promise.all([
      countAuthUsers(client),
      client.from('team_projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      client.from('social_profiles').select('user_id', { count: 'exact', head: true }),
    ])
    if (projectResult.error || profileResult.error) throw projectResult.error || profileResult.error
    return {
      checkedAt: new Date().toISOString(),
      services: { auth: 'online', collaborationData: 'online' },
      counts: {
        accounts: userResult.count,
        accountsScanned: userResult.scanned,
        accountsTruncated: userResult.truncated,
        activeProjects: Number(projectResult.count) || 0,
        collaborationProfiles: Number(profileResult.count) || 0,
      },
    }
  },

  async listUsers({ page, query }) {
    const client = requireAdminClient()
    const perPage = 25
    const admins = await ownerIds(client)
    if (!query) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage })
      if (error) throw error
      const accounts = (data?.users || []).map((user) => publicAccount(user, admins))
      return attachAccountRestrictions(client, { users: accounts, page, pageSize: perPage, total: Math.max(Number(data?.total) || 0, accounts.length), truncated: false })
    }

    return attachAccountRestrictions(client, await searchAuthUsers(client, { query, requestedPage: page, admins }))
  },

  async setUserRestriction(payload) { return setAccountRestriction(requireAdminClient(), payload, PlatformAdminError) },

  async listAudit(limit, category = '') {
    const client = requireAdminClient()
    let query = client.from('platform_admin_audit')
      .select('id,actor_user_id,target_user_id,action,outcome,reason,change_details,created_at,completed_at')
      .order('created_at', { ascending: false }).limit(limit)
    if (category === 'feedback') query = query.eq('action', 'feedback.manage')
    else if (category === 'accounts') query = query.neq('action', 'feedback.manage')
    const { data, error } = await query
    if (error) throw error
    return data || []
  },

  async listPendingPlaces({ page = 1 } = {}) {
    const client = requireAdminClient()
    const pageSize = 50
    const start = (page - 1) * pageSize
    const { data, count, error } = await client.from('campus_places')
      .select('id,school,name,campus,area,place_hint,place_type,description,opening_hours,service_info,public_contact,source_info,category,owner_id,review_revision,created_at,updated_at', { count: 'exact' })
      .eq('review_status', 'pending').eq('visibility', 'school').is('archived_at', null)
      .order('updated_at', { ascending: true }).order('id').range(start, start + pageSize - 1)
    if (error) throw error
    const total = Number(count) || 0
    return { places: data || [], page, pageSize, total, hasMore: start + (data || []).length < total }
  },

  async listPlaceReviewAudit(limit) {
    const client = requireAdminClient()
    const { data, error } = await client.from('campus_place_review_events')
      .select('id,place_id,actor_id,decision,outcome,reason,created_at,completed_at')
      .order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    const { data: current, error: currentError } = await client.from('campus_moderation_events')
      .select('id,target_id,actor_id,to_status,reason,created_at').eq('target_type', 'place').order('created_at', { ascending: false }).limit(limit)
    if (currentError) throw currentError
    return [...(data || []), ...(current || []).map(row => ({ id: row.id, place_id: row.target_id, actor_id: row.actor_id, decision: row.to_status, outcome: 'succeeded', reason: row.reason, created_at: row.created_at, completed_at: row.created_at }))]
      .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0,limit)
  },

  async reviewCampusPlace({ actorUserId, placeId, decision, reason, expectedRevision }) {
    const client = requireAdminClient()
    const { data, error } = await client.rpc('campus_review_place', {
      p_actor: actorUserId, p_id: placeId, p_decision: decision === 'approved' ? 'approve' : 'reject', p_reason: reason, p_revision: expectedRevision,
    })
    if (error) {
      const marker = String(error.message || '')
      if (marker.includes('REVISION_CHANGED')) throw new PlatformAdminError('place_state_changed', '地点内容已变化，请刷新。', 409)
      if (marker.includes('NOT_FOUND')) throw new PlatformAdminError('place_not_found', '地点已不可用。', 404)
      throw new PlatformAdminError('review_operation_failed', '审核结果没有保存。', 502)
    }
    const { error: notificationError } = await client.from('social_notifications').insert({ recipient_id: data.ownerId, actor_id: actorUserId, kind: 'campus_place_reviewed', resource_id: placeId })
    return { status: data.status, auditIncomplete: false, notificationIncomplete: Boolean(notificationError) }
  },

  async setUserSuspended({ actorUserId, targetUserId, suspended, reason }) {
    const client = requireAdminClient()
    const { data: targetResult, error: targetError } = await client.auth.admin.getUserById(targetUserId)
    if (targetError || !targetResult?.user) throw new PlatformAdminError('not_found', '没有找到这个账号，请刷新列表。', 404)
    if ((await ownerIds(client)).has(targetUserId)) throw new PlatformAdminError('forbidden', '平台所有者账号不能被暂停。', 403)
    const { data: restriction, error } = await client.from('platform_account_restrictions').select('revision,enabled,expires_at').eq('user_id', targetUserId).eq('scope', 'account').maybeSingle()
    if (error) throw error
    const currentlySuspended = Boolean((targetResult.user.banned_until && Date.parse(targetResult.user.banned_until) > Date.now()) || (restriction?.enabled && (!restriction.expires_at || Date.parse(restriction.expires_at) > Date.now())))
    if (currentlySuspended === suspended) throw new PlatformAdminError('state_changed', '账号状态已变化，请刷新后重试。', 409)
    const result = await setAccountRestriction(client, { actorUserId, targetUserId, scope: 'account', enabled: suspended,
      reason, expectedRevision: restriction?.revision || null, permanent: suspended }, PlatformAdminError)
    if (result.legacyBanRemaining) throw new PlatformAdminError('operation_failed', '旧版登录封禁仍有效，请刷新后重试。', 502)
    return { ...result, status: suspended ? 'suspended' : 'active' }
  },
}

const handler = createPlatformAdminHandler({ service, allowedOrigins, logger: console })
Deno.serve((request) => handler(request))
