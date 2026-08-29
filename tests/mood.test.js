import { describe, expect, it } from 'vitest'
import { logMood, monthMoodSummary, moodOf, normalizeMoodLog, weatherOfMood } from '../src/composables/mood.js'

describe('mood.js', () => {
  it('归一化兼容字符串与对象形态，丢弃坏数据', () => {
    const log = normalizeMoodLog({
      '2026-08-28': '😊',
      '2026-08-27': { mood: '😐', note: '有点困' },
      'bad-key': '😊',
      '2026-08-26': '',
      '2026-08-25': { note: '缺少 mood 字段' },
      '2026-08-24': 123,
    })
    expect(log['2026-08-28']).toEqual({ mood: '😊', note: '' })
    expect(log['2026-08-27'].note).toBe('有点困')
    expect(log['bad-key']).toBeUndefined()
    expect(log['2026-08-26']).toBeUndefined()
    expect(log['2026-08-25']).toBeUndefined()
    expect(log['2026-08-24']).toBeUndefined()
  })

  it('weatherOfMood 将 emoji 归入晴/多云/雨三类', () => {
    expect(weatherOfMood('😊')).toBe('sunny')
    expect(weatherOfMood('😐')).toBe('cloudy')
    expect(weatherOfMood('😭')).toBe('rain')
  })

  it('logMood 返回新对象且不修改入参', () => {
    const log = { '2026-08-28': { mood: '😊', note: '' } }
    const next = logMood('2026-08-29', '😢', '难过', log)
    expect(log['2026-08-29']).toBeUndefined()
    expect(next['2026-08-29']).toEqual({ mood: '😢', note: '难过' })
    expect(next['2026-08-28']).toEqual({ mood: '😊', note: '' })
  })

  it('monthMoodSummary 统计主导情绪并给出主题色', () => {
    const log = {
      '2026-08-01': '😊',
      '2026-08-02': '😊',
      '2026-08-03': '😐',
      '2026-08-04': '😭',
    }
    const summary = monthMoodSummary('2026-08', log)
    expect(summary.sunny).toBe(2)
    expect(summary.cloudy).toBe(1)
    expect(summary.rain).toBe(1)
    expect(summary.dominant).toBe('sunny')
    expect(summary.themeColor).toBeTruthy()
  })

  it('moodOf / 空日志', () => {
    expect(moodOf('2026-08-01', { '2026-08-01': '😊' }).mood).toBe('😊')
    expect(moodOf('2026-08-02', {})).toBeNull()
  })
})