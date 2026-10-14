import { describe, expect, it } from 'vitest'
import {
  averageCampusRating,
  campusScopeMatches,
  canTransitionCampusHelp,
  canTransitionCampusMarket,
  containsPrivateCampusDetails,
} from '../supabase/functions/campus-life/rules.js'

describe('campus life privacy and state rules', () => {
  it.each([
    '请加我 wx: abc12345',
    '联系 13800138000',
    '电话 138-0013-8000',
    '寄存柜取件码：ABCD1234',
    '宿舍 6号楼 203室',
    'student@example.edu',
  ])('detects private contact or access details: %s', (value) => {
    expect(containsPrivateCampusDetails(value)).toBe(true)
  })

  it('allows ordinary public service text while enforcing school and campus scope', () => {
    expect(containsPrivateCampusDetails('东区图书馆南门，工作日 08:00 开放')).toBe(false)
    expect(campusScopeMatches({ school: '虚构大学', campus: '东区' }, { school: '虚构大学', campus: '东区' })).toBe(true)
    expect(campusScopeMatches({ school: '虚构大学', campus: '' }, { school: '虚构大学', campus: '东区' })).toBe(true)
    expect(campusScopeMatches({ school: '虚构大学', campus: '西区' }, { school: '虚构大学', campus: '东区' })).toBe(false)
    expect(campusScopeMatches({ school: '另一所大学', campus: '东区' }, { school: '虚构大学', campus: '东区' })).toBe(false)
  })

  it('allows only the intended help-task roles and transitions', () => {
    expect(canTransitionCampusHelp({ from: 'assigned', to: 'in_progress', actorRole: 'assignee' })).toBe(true)
    expect(canTransitionCampusHelp({ from: 'in_progress', to: 'completed', actorRole: 'owner' })).toBe(false)
    expect(canTransitionCampusHelp({ from: 'open', to: 'cancelled', actorRole: 'owner' })).toBe(true)
    expect(canTransitionCampusHelp({ from: 'open', to: 'in_progress', actorRole: 'assignee' })).toBe(false)
    expect(canTransitionCampusHelp({ from: 'awaiting_confirmation', to: 'disputed', actorRole: 'assignee' })).toBe(true)
    expect(canTransitionCampusHelp({ from: 'disputed', to: 'completed', actorRole: 'owner' })).toBe(false)
  })

  it('keeps listing state changes owner-only and reports course-review sample size by reviewers', () => {
    expect(canTransitionCampusMarket({ from: 'reserved', to: 'sold', actorRole: 'owner' })).toBe(true)
    expect(canTransitionCampusMarket({ from: 'reserved', to: 'sold', actorRole: 'buyer' })).toBe(false)
    expect(canTransitionCampusMarket({ from: 'active', to: 'withdrawn', actorRole: 'owner' })).toBe(true)
    expect(averageCampusRating([
      { clarity: 5, organization: 4, learning: 4, workload: 3, assessment: 4 },
      { clarity: 4, organization: null, learning: null, workload: null, assessment: null },
    ])).toEqual({ count: 2, scoreCount: 6, average: 4, lowSample: true })
  })
})
