/**
 * 平台运维的纯逻辑层。
 *
 * 【为什么要单独一个模块】`index.ts` 直接跑在 Deno 运行时里，测试要起整个
 * Edge 环境。真正容易写错、又最需要被守住的是**计算与校验**（时长换算、
 * 同步健康分级、筛选归一化），这些应该是纯函数：Node 里直接跑，毫秒级断言。
 * 本模块**不接触任何用户内容**，只处理元数据。
 */

/** `account_sync_snapshots` 的 CHECK 上限，见 20261006170314_account_sync_snapshots.sql。 */
export const ACCOUNT_PAYLOAD_LIMIT_BYTES = 16_777_216

/** 超过这个占比就提醒快撑爆配额了。 */
export const PAYLOAD_WARNING_RATIO = 0.8

/** 超过多少天没同步算"久未同步"。 */
export const SYNC_STALE_DAYS = 30

const DAY_MS = 86_400_000

/**
 * 暂停时长预设。`permanent` 沿用既有的 876000h（约 100 年），
 * 这样老数据与老行为都不受影响；其余按小时换算。
 */
export const SUSPENSION_PRESETS = Object.freeze({
  permanent: { id: 'permanent', label: '永久', hours: null },
  day: { id: 'day', label: '1 天', hours: 24 },
  week: { id: 'week', label: '7 天', hours: 168 },
  month: { id: 'month', label: '30 天', hours: 720 },
})

const PERMANENT_BAN_HOURS = 876_000

/**
 * 把预设换算成 Supabase 的 `ban_duration`。
 * 未知预设一律按永久处理——**宁可多封也不误放**：写错的预设不该悄悄变成解封。
 */
export function banDurationFor(presetId) {
  const preset = SUSPENSION_PRESETS[String(presetId || 'permanent')]
  if (!preset || preset.hours === null) return `${PERMANENT_BAN_HOURS}h`
  return `${preset.hours}h`
}

/** 限时暂停的到期时间戳；永久暂停返回空。 */
export function suspensionExpiresAt(presetId, now = Date.now()) {
  const preset = SUSPENSION_PRESETS[String(presetId || 'permanent')]
  if (!preset || preset.hours === null) return null
  return new Date(now + preset.hours * 3_600_000).toISOString()
}

export const ACCOUNT_STATUSES = Object.freeze(['all', 'active', 'suspended', 'unverified'])

/** 未知值一律退回 all，而不是悄悄过滤成空列表。 */
export function normalizeStatusFilter(value) {
  const status = String(value || 'all')
  return ACCOUNT_STATUSES.includes(status) ? status : 'all'
}

export function matchesStatusFilter(account, status) {
  const wanted = normalizeStatusFilter(status)
  if (wanted === 'all') return true
  return account?.status === wanted
}

/** 构造账号检索条件；始终只取脱敏后的字段集。 */
export function filterAccounts(users, status, query) {
  const wanted = normalizeStatusFilter(status)
  const needle = String(query || '').trim().toLowerCase()
  return (users || []).filter((user) => {
    if (!matchesStatusFilter(user, wanted)) return false
    if (!needle) return true
    return String(user?.email || '').toLowerCase().includes(needle)
  })
}

export const AUDIT_OUTCOMES = Object.freeze(['started', 'succeeded', 'failed'])
export const AUDIT_ACTIONS = Object.freeze([
  'user.suspend', 'user.restore', 'user.sessions_revoke', 'user.password_reset',
])

export function normalizeAuditFilter(payload = {}) {
  const action = String(payload.action || '')
  const outcome = String(payload.outcome || '')
  // 注意 `Number(x) || 20` 会把 0 短路成 20，绕过下限钳制。这里显式做区间钳制：
  // 契约是"产出 1..50 的合法数量"，无法识别的输入才退回默认 20。
  const raw = Number(payload.limit ?? 20)
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20
  return {
    action: AUDIT_ACTIONS.includes(action) ? action : '',
    outcome: AUDIT_OUTCOMES.includes(outcome) ? outcome : '',
    // 上限与服务端一致（handler.js 是 1..50），前端不再能要更多。
    limit,
  }
}

export function matchesAuditFilter(event, filter) {
  if (filter.action && event?.action !== filter.action) return false
  if (filter.outcome && event?.outcome !== filter.outcome) return false
  return true
}

/**
 * 同步健康分级。**只读元数据**，绝不触碰 payload 内容。
 *
 * 返回 `state` 取值：
 * - `never`   从未同步过
 * - `stale`   超过阈值没同步
 * - `large`   数据量接近配额上限
 * - `error`   快照本身有问题（revision 非法）
 * - `ok`
 */
export function classifySyncHealth(snapshot, now = Date.now(), staleDays = SYNC_STALE_DAYS) {
  if (!snapshot) return { state: 'never', label: '从未同步', tone: 'neutral' }
  const revision = Number(snapshot.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return { state: 'error', label: '快照异常', tone: 'danger' }
  }
  const bytes = Number(snapshot.payloadBytes)
  if (Number.isFinite(bytes) && bytes > 0 && bytes >= ACCOUNT_PAYLOAD_LIMIT_BYTES * PAYLOAD_WARNING_RATIO) {
    return { state: 'large', label: '接近配额上限', tone: 'warning' }
  }
  const updatedAt = Date.parse(snapshot.updatedAt || '')
  if (!Number.isFinite(updatedAt)) {
    return { state: 'error', label: '同步时间无法识别', tone: 'warning' }
  }
  const days = Math.floor((now - updatedAt) / DAY_MS)
  if (days > staleDays) {
    return { state: 'stale', label: `${days} 天未同步`, tone: 'warning', days }
  }
  return { state: 'ok', label: '同步正常', tone: 'success', days }
}

/** 把字节数渲染成人话；无法识别时明确说"未知"，不返回 0 冒充正常。 */
export function formatBytes(bytes) {
  // 注意：Number(null)、Number('')、Number([]) 都等于 0，
  // 直接 Number() 会把"没有数据"渲染成 "0 B"，那正是用 0 冒充正常。
  if (bytes === null || bytes === undefined || bytes === '') return '未知'
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '未知'
  if (value === 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export const SYNC_LABELS = Object.freeze({
  never: '从未同步', stale: '久未同步', large: '接近配额上限', error: '快照异常', ok: '同步正常',
})