import { describe, expect, it } from 'vitest'
import { restrictionActive, restrictionPayload, restrictionRemaining } from '../src/composables/accountRestrictionModel.js'
const now = Date.parse('2026-10-16T12:00:00Z')
const account = { id: 'fictional-account', restrictions: { publish: { revision: 'fictional-revision' } } }
const form = { account, scope: 'publish', enabled: true, reason: '  虚构的处理说明  ', preset: 'custom', amount: '90', unit: 'minutes' }
describe('账号限制时长', () => {
  it('支持任意分钟、小时、天，并只携带当前限制的版本', () => {
    expect(restrictionPayload(form, now)).toEqual({ userId: account.id, scope: 'publish', enabled: true, reason: '虚构的处理说明', expectedRevision: 'fictional-revision', durationSeconds: 5400 })
    expect(restrictionPayload({ ...form, amount: '3', unit: 'hours' }, now).durationSeconds).toBe(10800)
    expect(restrictionPayload({ ...form, amount: '2', unit: 'days', scope: 'account' }, now)).toMatchObject({ expectedRevision: null, durationSeconds: 172800 })
  })
  it('指定时区截止、永久和提前解除分别有唯一的时间表达', () => {
    expect(restrictionPayload({ ...form, preset: 'until', until: '2026-10-16T22:00:00+08:00' }, now).expiresAt).toBe('2026-10-16T14:00:00.000Z')
    expect(restrictionPayload({ ...form, preset: 'permanent' }, now)).toMatchObject({ permanent: true })
    expect(restrictionPayload({ ...form, enabled: false, preset: 'permanent' }, now)).not.toHaveProperty('permanent')
  })
  it.each([{ amount: '0' }, { amount: '-1' }, { amount: '1.5' }, { amount: 'Infinity' }, { amount: '36501', unit: 'days' }, { preset: 'until', until: '2026-10-16T11:00:00Z' }, { reason: ' ' }, { scope: 'anything' }])('拒绝无效输入 %j', invalid => {
    expect(() => restrictionPayload({ ...form, ...invalid }, now)).toThrow()
  })
  it('根据当前服务器时间自然到期，永久与禁用互不混淆', () => {
    const restriction = { enabled: true, expiresAt: '2026-10-16T12:01:00Z' }
    expect(restrictionActive(restriction, now)).toBe(true)
    expect(restrictionRemaining(restriction, now)).toBe('剩余 1 分钟')
    expect(restrictionActive(restriction, now + 60000)).toBe(false)
    expect(restrictionActive({ enabled: true, expiresAt: null }, now)).toBe(true)
    expect(restrictionActive({ enabled: false, expiresAt: null }, now)).toBe(false)
  })
})
