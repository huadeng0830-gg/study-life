import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_PAYLOAD_LIMIT_BYTES,
  SYNC_STALE_DAYS,
  banDurationFor,
  classifySyncHealth,
  filterAccounts,
  formatBytes,
  matchesAuditFilter,
  normalizeAuditFilter,
  normalizeStatusFilter,
  suspensionExpiresAt,
} from '../supabase/functions/platform-admin/adminData.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-13T00:00:00.000Z')

describe('暂停时长换算', () => {
  it('限时暂停换算成小时，永久沿用既有的 876000h', () => {
    expect(banDurationFor('day')).toBe('24h')
    expect(banDurationFor('week')).toBe('168h')
    expect(banDurationFor('month')).toBe('720h')
    expect(banDurationFor('permanent')).toBe('876000h')
  })

  it('未知预设按永久处理——写错的预设不该悄悄变成解封', () => {
    expect(banDurationFor('forever')).toBe('876000h')
    expect(banDurationFor(undefined)).toBe('876000h')
    expect(banDurationFor(null)).toBe('876000h')
    expect(banDurationFor('')).toBe('876000h')
  })

  it('只有限时暂停才有到期时间，永久为���', () => {
    expect(suspensionExpiresAt('week', NOW)).toBe(new Date(NOW + 7 * DAY).toISOString())
    expect(suspensionExpiresAt('permanent', NOW)).toBeNull()
    expect(suspensionExpiresAt('不存在的预设', NOW)).toBeNull()
  })
})

describe('账号状态筛选', () => {
  const users = [
    { email: 'a@x.test', status: 'active' },
    { email: 'b@x.test', status: 'suspended' },
    { email: 'c@x.test', status: 'unverified' },
    { email: 'd@x.test', status: 'suspended' },
  ]

  it('按状态过滤，未知状态值退回全部而不是空列表', () => {
    expect(normalizeStatusFilter('suspended')).toBe('suspended')
    expect(normalizeStatusFilter('不存在')).toBe('all')
    expect(filterAccounts(users, 'suspended', '').map((u) => u.email)).toEqual(['b@x.test', 'd@x.test'])
    expect(filterAccounts(users, 'active', '')).toHaveLength(1)
    expect(filterAccounts(users, 'all', '')).toHaveLength(4)
  })

  it('状态与关键词可以同时生效，匹配邮箱片段且不区分大小写', () => {
    expect(filterAccounts(users, 'suspended', 'D@X').map((u) => u.email)).toEqual(['d@x.test'])
    expect(filterAccounts(users, 'active', 'd')).toEqual([])
  })
})

describe('审计筛选', () => {
  it('未知动作或结果退化为不筛选，而不是筛出空列表', () => {
    const filter = normalizeAuditFilter({ action: 'user.delete', outcome: 'exploded' })
    expect(filter).toEqual({ action: '', outcome: '', limit: 20 })
    const events = [{ action: 'user.suspend', outcome: 'succeeded' }]
    expect(events.filter((e) => matchesAuditFilter(e, filter))).toHaveLength(1)
  })

  it('数量被夹在服务端允许的区间内', () => {
    expect(normalizeAuditFilter({ limit: 0 }).limit).toBe(1)
    expect(normalizeAuditFilter({ limit: 9999 }).limit).toBe(50)
    expect(normalizeAuditFilter({}).limit).toBe(20)
  })

  it('按动作与结果分别过滤', () => {
    const events = [
      { action: 'user.suspend', outcome: 'succeeded' },
      { action: 'user.suspend', outcome: 'failed' },
      { action: 'user.restore', outcome: 'succeeded' },
    ]
    const failed = normalizeAuditFilter({ outcome: 'failed' })
    expect(events.filter((e) => matchesAuditFilter(e, failed))).toHaveLength(1)
    const suspend = normalizeAuditFilter({ action: 'user.suspend' })
    expect(events.filter((e) => matchesAuditFilter(e, suspend))).toHaveLength(2)
  })
})

describe('同步健康分级', () => {
  it('没有快照行是"从未同步"，不是异常', () => {
    expect(classifySyncHealth(null, NOW)).toMatchObject({ state: 'never', tone: 'neutral' })
  })

  it('超过阈值未同步标为久未同步并给出天数', () => {
    const health = classifySyncHealth({
      revision: 7, updatedAt: new Date(NOW - (SYNC_STALE_DAYS + 3) * DAY).toISOString(), payloadBytes: 1000,
    }, NOW)
    expect(health.state).toBe('stale')
    expect(health.days).toBe(SYNC_STALE_DAYS + 3)
  })

  it('接近配额上限优先于久未同步报出——配额爆掉会直接写不进去', () => {
    const health = classifySyncHealth({
      revision: 7,
      updatedAt: new Date(NOW - (SYNC_STALE_DAYS + 10) * DAY).toISOString(),
      payloadBytes: Math.floor(ACCOUNT_PAYLOAD_LIMIT_BYTES * 0.9),
    }, NOW)
    expect(health.state).toBe('large')
  })

  it('revision 非法时报快照异常，绝不冒充正常', () => {
    expect(classifySyncHealth({ revision: 0, updatedAt: new Date(NOW).toISOString() }, NOW).state).toBe('error')
    expect(classifySyncHealth({ revision: 1.5, updatedAt: new Date(NOW).toISOString() }, NOW).state).toBe('error')
  })

  it('时间无法解析时也不报正常', () => {
    expect(classifySyncHealth({ revision: 1, updatedAt: '不是时间' }, NOW).state).toBe('error')
  })

  it('一切正常时明确报正常', () => {
    const health = classifySyncHealth({ revision: 3, updatedAt: new Date(NOW - DAY).toISOString(), payloadBytes: 2048 }, NOW)
    expect(health).toMatchObject({ state: 'ok', tone: 'success' })
  })
})

describe('字节数渲染', () => {
  it('无法识别时明确返回未知，不返回 0 冒充正常', () => {
    expect(formatBytes(null)).toBe('未知')
    expect(formatBytes(-1)).toBe('未知')
    expect(formatBytes('x')).toBe('未知')
  })

  it('按量级选择单位', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})