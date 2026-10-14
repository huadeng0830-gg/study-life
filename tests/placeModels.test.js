import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PLACE_CATEGORIES, PLACE_SCORE_FIELDS, normalizePlaceRecord, normalizePlaceScores,
  normalizePlaceVisit, toPlaceInvitePayload, toSchoolPlacePayload,
} from '../src/composables/placeModels.js'

const fictionalPlace = (overrides = {}) => ({
  id: '8bc1046f-8ca1-46d2-9329-33f65a706194',
  name: '虚构食堂档口', category: 'food', campus: '虚构校区', area: '北苑',
  placeHint: '二楼靠窗', scores: { value: 'worth', portion: 'large' }, note: '虚构备注',
  visibility: 'school',
  ...overrides,
})

describe('地点结构化评分和隐私边界', () => {
  it('提供六种地点模板，并把“值不值”和食物分量单独记录', () => {
    expect(PLACE_CATEGORIES.map((item) => item.id)).toEqual(['food', 'service', 'study', 'transport', 'trade', 'social'])
    expect(PLACE_SCORE_FIELDS.food.some((field) => field.key === 'portion')).toBe(true)
    expect(PLACE_SCORE_FIELDS.study.some((field) => field.key === 'seatStability')).toBe(true)
    expect(normalizePlaceScores('food', { value: 'worth', portion: 'large' })).toEqual({ value: 'worth', portion: 'large' })
  })

  it('地点默认仅本机，短备注按 50 个 Unicode 字符限制', () => {
    const place = normalizePlaceRecord({ name: '虚构咖啡角', category: 'study', note: '甲'.repeat(55) })
    expect(place.visibility).toBe('private')
    expect(place.note).toBe('甲'.repeat(50))
    expect(place.scores.value).toBe('mixed')
  })

  it('拒绝不属于当前类型的结构化评分值', () => {
    expect(() => normalizePlaceScores('study', { seatStability: 'maybe' })).toThrow('座位稳定性格式不正确')
    expect(() => normalizePlaceScores('food', { value: 'five-stars' })).toThrow('值不值')
  })

  it('本机到访记录保留金额和账本关联，但不要求额外评分维度', () => {
    expect(normalizePlaceVisit({
      id: 'visit-fiction-1', placeId: 'place-fiction-1', visitedAt: '2026-10-02',
      price: 18, scores: { value: 'worth' }, transactionId: 'expense-fiction-1', note: '靠窗有插座',
    }, 'food')).toMatchObject({
      placeId: 'place-fiction-1', visitedAt: '2026-10-02T12:00:00.000Z',
      price: 18, scores: { value: 'worth' }, transactionId: 'expense-fiction-1', note: '靠窗有插座',
    })
  })

  it('校内分享载荷只包含显式分享的地点信息，不包含价格、到访和账本关联', () => {
    const payload = toSchoolPlacePayload({
      ...fictionalPlace(),
      visits: [{ visitedAt: '2026-10-02T12:00:00.000Z', price: 18 }],
      transactionId: 'expense-fiction-1',
    })
    expect(payload).toMatchObject({ visibility: 'school', name: '虚构食堂档口', scores: { value: 'worth' } })
    expect(payload).not.toHaveProperty('price')
    expect(payload).not.toHaveProperty('visits')
    expect(payload).not.toHaveProperty('transactionId')
  })

  it('private 地点不能通过分享载荷发送', () => {
    expect(() => toSchoolPlacePayload(fictionalPlace({ visibility: 'private' }))).toThrow('仅本机地点不会上传')
  })

  it('好友预设是最小字段副本，不带私人备注、访问历史或金额', () => {
    const payload = toPlaceInvitePayload({
      ...fictionalPlace({ visibility: 'private' }),
      visits: [{ visitedAt: '2026-10-02T12:00:00Z', price: 18, transactionId: 'expense-fiction-1' }],
      transactionId: 'expense-fiction-1', offer: { price: 8 },
    })
    expect(payload).toMatchObject({ id: fictionalPlace().id, name: '虚构食堂档口', scores: { value: 'worth', portion: 'large' } })
    expect(payload).not.toHaveProperty('note')
    expect(payload).not.toHaveProperty('visits')
    expect(payload).not.toHaveProperty('transactionId')
    expect(payload).not.toHaveProperty('offer')
  })

  it('地点表强制 RLS，并撤销客户端表权限', () => {
    const migration = readFileSync(new URL('../supabase/migrations/20261014105415_campus_place_sharing.sql', import.meta.url), 'utf8')
    for (const table of ['campus_places', 'campus_place_ratings', 'campus_place_reports', 'campus_place_invites']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`)
    }
    for (const table of ['campus_places', 'campus_place_ratings', 'campus_place_reports']) {
      expect(migration).toContain(`create policy ${table}_service_role`)
    }
    expect(migration).toContain('create policy campus_place_invites_service_role')
    expect(migration).toMatch(/revoke all on public\.campus_places, public\.campus_place_ratings, public\.campus_place_reports from public, anon, authenticated/i)
    expect(migration).toContain("check (visibility = 'school')")
    expect(migration).not.toMatch(/grant\s+.*\s+to\s+authenticated/i)
    expect(migration).toMatch(/revoke all on public\.campus_place_invites from public, anon, authenticated/i)
  })
})
