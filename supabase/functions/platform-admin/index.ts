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
