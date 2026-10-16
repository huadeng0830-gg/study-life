export const restrictionScopes = Object.freeze({ account: '账号封禁', publish: '禁止发布' })
export const MAX_RESTRICTION_SECONDS = 100 * 365 * 24 * 60 * 60

export function restrictionActive(restriction, now = Date.now()) {
  return Boolean(restriction?.enabled && (!restriction.expiresAt || Date.parse(restriction.expiresAt) > now))
}

export function restrictionDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '永久，需管理员解除'
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function restrictionRemaining(restriction, now = Date.now()) {
  if (!restrictionActive(restriction, now)) return '已解除'
  if (!restriction.expiresAt) return '永久限制'
  const minutes = Math.max(1, Math.ceil((Date.parse(restriction.expiresAt) - now) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return days ? `剩余 ${days} 天 ${hours} 小时` : hours ? `剩余 ${hours} 小时 ${minutes % 60} 分钟` : `剩余 ${minutes} 分钟`
}

export function restrictionPayload({ account, scope, enabled, reason, preset, amount, unit, until }, now = Date.now()) {
  const explanation = String(reason || '').trim()
  if (!explanation || explanation.length > 500) throw new Error('请填写 1–500 字的处理原因，账号会看到这段说明。')
  if (!['account', 'publish'].includes(scope)) throw new Error('请选择有效的限制类型。')
  const payload = { userId: account.id, scope, enabled, reason: explanation, expectedRevision: account.restrictions?.[scope]?.revision || null }
  if (!enabled) return payload
  if (preset === 'permanent') return { ...payload, permanent: true }
  if (preset === 'until') {
    const deadline = new Date(until).getTime()
    if (!until || !Number.isFinite(deadline) || deadline - now < 60000 || deadline - now > MAX_RESTRICTION_SECONDS * 1000) throw new Error('解除时间需在至少 1 分钟后、100 年内。')
    return { ...payload, expiresAt: new Date(deadline).toISOString() }
  }
  const seconds = preset === 'custom' ? Number(amount) * ({ minutes: 60, hours: 3600, days: 86400 }[unit] || 0) : Number(preset)
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > MAX_RESTRICTION_SECONDS || (preset === 'custom' && (!Number.isSafeInteger(Number(amount)) || Number(amount) < 1))) throw new Error('请输入有效的整数时长，最短 1 分钟，最长 100 年。')
  return { ...payload, durationSeconds: seconds }
}
