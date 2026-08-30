import { describe, expect, it } from 'vitest'
import { builtInFestivalTable, DEFAULT_FESTIVE_CONFIG, festiveFor, normalizeFestiveConfig } from '../src/composables/festive.js'

describe('festive.js', () => {
  it('配置归一化修复坏数据（非法日期 / 空标签纪念日）', () => {
    const repaired = normalizeFestiveConfig({
      birthday: 'aa-bb',
      enabled: true,
      anniversaries: [
        { date: '2026-01-01', label: '' },
        { date: '05-20', label: '在一起' },
        { date: 'bad', label: '坏日期' },
      ],
    })
    expect(repaired.birthday).toBe('')
    expect(repaired.enabled).toBe(true)
    expect(repaired.anniversaries).toEqual([{ date: '05-20', label: '在一起' }])
  })

  it('enabled=false 时不返回任何氛围', () => {
    expect(festiveFor('2026-12-25', { ...DEFAULT_FESTIVE_CONFIG, enabled: false })).toBeNull()
  })

  it('命中固定公历节日（圣诞）并返回 snow 装饰', () => {
    const result = festiveFor('2026-12-25', DEFAULT_FESTIVE_CONFIG)
    expect(result.key).toBe('christmas')
    expect(result.decor).toBe('snow')
    expect(result.accentColor).toBeTruthy()
  })

  it('命中 2026 春节（农历表）并返回 lantern 装饰', () => {
    const result = festiveFor('2026-02-17', DEFAULT_FESTIVE_CONFIG)
    expect(result.key).toBe('spring')
    expect(result.decor).toBe('lantern')
  })

  it('生日命中并返回 confetti 装饰', () => {
    const result = festiveFor('2026-05-20', { ...DEFAULT_FESTIVE_CONFIG, birthday: '05-20' })
    expect(result.key).toBe('birthday')
    expect(result.decor).toBe('confetti')
  })

  it('纪念日命中，使用自定义标签', () => {
    const result = festiveFor('2026-09-09', { ...DEFAULT_FESTIVE_CONFIG, anniversaries: [{ date: '09-09', label: '在一起' }] })
    expect(result.key).toBe('anniversary')
    expect(result.name).toBe('在一起')
  })

  it('首个使用周年按安装日期推导', () => {
    const result = festiveFor('2027-03-02', { ...DEFAULT_FESTIVE_CONFIG, installDate: '2026-03-02' })
    expect(result.key).toBe('anniversary-start')
    expect(result.message).toContain('一年')
  })

  it('使用历法计算，而非手填年份表：可识别 2031 春节', () => {
    expect(festiveFor('2031-01-23', DEFAULT_FESTIVE_CONFIG)?.key).toBe('spring')
  })

  it('内置节日对照表与内置常量一致', () => {
    const defaultTable = builtInFestivalTable()
    expect(defaultTable.solar.map((item) => item.name)).toEqual(['元旦', '情人节', '愚人节', '儿童节', '国庆节', '圣诞节'])
    expect(defaultTable.lunarFestivals.map((item) => item.name)).toEqual(['春节', '元宵节', '清明节', '端午节', '中秋节', '重阳节', '冬至'])
    const table = builtInFestivalTable(2026)
    expect(table.lunar.map((row) => row.year)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032])
    for (const row of table.lunar) {
      expect(Object.values(row.cells).filter(Boolean)).toHaveLength(7)
    }
    expect(table.lunar.find((row) => row.year === 2026).cells.spring).toBe('02-17')
  })
})
