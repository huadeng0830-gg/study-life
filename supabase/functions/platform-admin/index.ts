/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from '@supabase/supabase-js'
import { createPlatformAdminHandler, PlatformAdminError } from './handler.js'
import { countAuthUsers, searchAuthUsers } from './users.js'

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
  const { data, error } = await client.from('platform_admins').select('user_id')
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
    const { data, error } = await client.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return Boolean(data)
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
      return { users: accounts, page, pageSize: perPage, total: Math.max(Number(data?.total) || 0, accounts.length), truncated: false }
    }

    return searchAuthUsers(client, { query, requestedPage: page, admins })
  },

  async listAudit(limit) {
    const client = requireAdminClient()
    const { data, error } = await client.from('platform_admin_audit')
      .select('id,actor_user_id,target_user_id,action,outcome,reason,created_at,completed_at')
      .order('created_at', { ascending: false }).limit(limit)
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
    return data || []
  },

  async reviewCampusPlace({ actorUserId, placeId, decision, reason, expectedRevision }) {
    const client = requireAdminClient()
    const { data: place, error: lookupError } = await client.from('campus_places')
      .select('id,owner_id,review_status,review_revision').eq('id', placeId).maybeSingle()
    if (lookupError) throw lookupError
    if (!place) throw new PlatformAdminError('place_not_found', '没有找到这个地点，请刷新审核队列。', 404)
    if (place.review_status !== 'pending') throw new PlatformAdminError('place_state_changed', '地点状态已变化，请刷新审核队列。', 409)
    if (String(place.review_revision || '').toLowerCase() !== expectedRevision.toLowerCase()) {
      throw new PlatformAdminError('place_state_changed', '地点资料已更新，请先刷新并重新检查内容。', 409)
    }

    const { data: event, error: auditError } = await client.from('campus_place_review_events').insert({
      place_id: placeId,
      actor_id: actorUserId,
      decision,
      outcome: 'started',
      reason,
      content_revision: expectedRevision,
    }).select('id').single()
    if (auditError || !event?.id) throw new PlatformAdminError('service_unavailable', '审核记录暂不可用，地点状态没有修改。', 503)

    const { data: changed, error: updateError } = await client.from('campus_places').update({
      review_status: decision,
      review_reason: decision === 'rejected' ? reason : '',
      updated_at: new Date().toISOString(),
    }).eq('id', placeId).eq('review_status', 'pending').eq('review_revision', expectedRevision).select('id').maybeSingle()
    const outcome = updateError ? 'failed' : changed?.id ? 'succeeded' : 'failed'
    const { error: completionError } = await client.from('campus_place_review_events').update({
      outcome,
      completed_at: new Date().toISOString(),
    }).eq('id', event.id)

    if (updateError) throw new PlatformAdminError('review_operation_failed', '审核结果没有保存，请稍后重试。', 502)
    if (!changed?.id) throw new PlatformAdminError('place_state_changed', '地点状态已变化，请刷新审核队列。', 409)
    const { error: notificationError } = await client.from('social_notifications').insert({
      recipient_id: place.owner_id,
      actor_id: actorUserId,
      kind: 'campus_place_reviewed',
      resource_id: placeId,
    })
    return {
      status: decision,
      auditIncomplete: Boolean(completionError),
      notificationIncomplete: Boolean(notificationError),
    }
  },

  async setUserSuspended({ actorUserId, targetUserId, suspended, reason }) {
    const client = requireAdminClient()
    const { data: targetResult, error: targetError } = await client.auth.admin.getUserById(targetUserId)
    if (targetError || !targetResult?.user) throw new PlatformAdminError('not_found', '没有找到这个账号，请刷新列表。', 404)
    if ((await ownerIds(client)).has(targetUserId)) throw new PlatformAdminError('forbidden', '平台所有者账号不能被暂停。', 403)
    const target = targetResult.user
    const currentlySuspended = Boolean(target.banned_until && Date.parse(target.banned_until) > Date.now())
    if (currentlySuspended === suspended) throw new PlatformAdminError('state_changed', '账号状态已变化，请刷新后重试。', 409)

    const action = suspended ? 'user.suspend' : 'user.restore'
    const { data: event, error: auditError } = await client.from('platform_admin_audit').insert({
      actor_user_id: actorUserId,
      target_user_id: targetUserId,
      action,
      outcome: 'started',
      reason,
    }).select('id').single()
    if (auditError || !event?.id) throw new PlatformAdminError('service_unavailable', '审计记录暂不可用，账号状态没有修改。', 503)

    const { error: updateError } = await client.auth.admin.updateUserById(targetUserId,
      { ban_duration: suspended ? '876000h' : 'none' })
    const outcome = updateError ? 'failed' : 'succeeded'
    const { error: completionError } = await client.from('platform_admin_audit').update({
      outcome,
      completed_at: new Date().toISOString(),
    }).eq('id', event.id)

    if (updateError) throw new PlatformAdminError('operation_failed', '账号状态修改失败，请稍后重试。', 502)
    return { status: suspended ? 'suspended' : 'active', auditIncomplete: Boolean(completionError) }
  },
}

const handler = createPlatformAdminHandler({ service, allowedOrigins, logger: console })
Deno.serve((request) => handler(request))
