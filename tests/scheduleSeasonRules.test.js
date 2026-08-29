// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  autoSeasonStatusFor,
  isValidSeasonDate,
  seasonConflicts,
} from '../src/composables/store/timeConfig.js'

const campus = (id, name = id) => ({ id, name })
const season = (id, startDate, campuses) => ({ id, name: id, startDate, campuses })

describe('校区与作息季共享规则', () => {
  it('按用户配置解析当前生效作息并正确跨年', () => {
    const cfg = {
      campuses: [campus('main')],
      seasons: [
        season('A', '03-01', ['main']),
        season('B', '07-01', ['main']),
        season('C', '11-01', ['main']),
      ],
    }
    expect(autoSeasonStatusFor('main', cfg, new Date(2026, 0, 15)).seasonId).toBe('C')
    expect(autoSeasonStatusFor('main', cfg, new Date(2026, 7, 27)).seasonId).toBe('B')
    expect(autoSeasonStatusFor('main', cfg, new Date(2026, 11, 1)).seasonId).toBe('C')
  })

  it('只考虑当前校区适用的作息季', () => {
    const cfg = {
      campuses: [campus('south'), campus('north')],
      seasons: [
        season('common', '03-01', ['south', 'north']),
        season('lab', '07-01', ['north']),
      ],
    }
    expect(autoSeasonStatusFor('south', cfg, new Date(2026, 7, 1)).seasonId).toBe('common')
    expect(autoSeasonStatusFor('north', cfg, new Date(2026, 7, 1)).seasonId).toBe('lab')
  })

  it('多作息季日期不完整时禁用自动，单作息季无需日期', () => {
    const incomplete = {
      campuses: [campus('main')],
      seasons: [season('A', '03-01', ['main']), season('B', '', ['main'])],
    }
    expect(autoSeasonStatusFor('main', incomplete)).toMatchObject({ available: false, reason: 'missing-date' })
    expect(autoSeasonStatusFor('main', { ...incomplete, seasons: [season('only', '', ['main'])] }))
      .toMatchObject({ available: true, seasonId: 'only', reason: 'single' })
  })

  it('只报告同一校区内的同日冲突', () => {
    const separated = {
      campuses: [campus('south'), campus('north')],
      seasons: [season('A', '05-01', ['south']), season('B', '05-01', ['north'])],
    }
    expect(seasonConflicts(separated)).toEqual([])

    const conflict = {
      ...separated,
      seasons: [...separated.seasons, season('C', '05-01', ['south'])],
    }
    expect(seasonConflicts(conflict)).toEqual([
      expect.objectContaining({ campusId: 'south', date: '05-01', names: ['A', 'C'] }),
    ])
    expect(autoSeasonStatusFor('south', conflict)).toMatchObject({ available: false, reason: 'date-conflict' })
  })

  it('校验真实的月日', () => {
    expect(isValidSeasonDate('02-29')).toBe(true)
    expect(isValidSeasonDate('02-30')).toBe(false)
    expect(isValidSeasonDate('2-01')).toBe(false)
  })
})
