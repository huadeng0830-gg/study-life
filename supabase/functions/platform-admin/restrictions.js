export async function attachAccountRestrictions(client, page) {
  const ids = page.users.map(user => user.id)
  if (!ids.length) return page
  const { data, error } = await client.from('platform_account_restrictions')
    .select('user_id,scope,enabled,expires_at,reason,revision,updated_at').in('user_id', ids)
  if (error) throw error
  const byUser = new Map()
  for (const row of data || []) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, {})
    byUser.get(row.user_id)[row.scope] = { enabled: row.enabled, expiresAt: row.expires_at, reason: row.reason, revision: row.revision, updatedAt: row.updated_at }
  }
  return { ...page, users: page.users.map(user => {
    const restrictions = byUser.get(user.id) || {}
    const blocked = restrictions.account?.enabled && (!restrictions.account.expiresAt || Date.parse(restrictions.account.expiresAt) > Date.now())
    return { ...user, restrictions, status: blocked ? 'suspended' : user.status }
  }) }
}

export async function setAccountRestriction(client, payload, ErrorType) {
  let nativeBan = false
  if (payload.scope === 'account') {
    const { data, error } = await client.auth.admin.getUserById(payload.targetUserId)
    if (error || !data?.user) throw new ErrorType('not_found', '没有找到这个账号。', 404)
    nativeBan = Boolean(data.user.banned_until && Date.parse(data.user.banned_until) > Date.now())
  }
  const { data, error } = await client.rpc('platform_set_account_restriction', {
    p_actor: payload.actorUserId, p_user: payload.targetUserId, p_scope: payload.scope,
    p_enabled: payload.enabled, p_reason: payload.reason, p_revision: payload.expectedRevision,
    p_duration_seconds: payload.durationSeconds ?? null, p_expires_at: payload.expiresAt ?? null,
    p_permanent: payload.permanent === true,
  })
  if (error) {
    const marker = String(error.message || '')
    if (marker.includes('PLATFORM_STATE_CHANGED')) throw new ErrorType('state_changed', '此项限制已变化，请刷新后重试。', 409)
    if (/PLATFORM_FORBIDDEN|PLATFORM_OWNER_PROTECTED/.test(marker)) throw new ErrorType('forbidden', '平台所有者账号不能被限制。', 403)
    if (marker.includes('PLATFORM_USER_NOT_FOUND')) throw new ErrorType('not_found', '没有找到这个账号。', 404)
    if (/PLATFORM_INVALID/.test(marker)) throw new ErrorType('invalid_input', '请检查原因及限制时长。', 400)
    throw error
  }
  // Convert legacy native bans only after the atomic application restriction
  // is saved. If Auth is unavailable, do not pretend the account was restored.
  let legacyBanRemaining = false
  if (nativeBan) {
    const { error: legacyError } = await client.auth.admin.updateUserById(payload.targetUserId, { ban_duration: 'none' })
    legacyBanRemaining = Boolean(legacyError)
  }
  return { ...data, legacyBanRemaining }
}
