import { describe, expect, it } from 'vitest'
import { LOCAL_STORAGE_ESTIMATE_CHARS, measureLocalBusinessStorage } from '../src/composables/localStorageUsage.js'

function storageOf(entries) {
  const values = new Map(Object.entries(entries))
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
  }
}

describe('本机业务存储用量估算', () => {
  it('只统计 sl_ 键并返回字符数与上限比例', () => {
    expect(measureLocalBusinessStorage(storageOf({ sl_tasks: '[1,2]', theme: 'dark' }))).toEqual({
      chars: 13, keyCount: 1, percent: 0, warning: false,
    })
  })

  it('达到常见配额估算的 70% 时触发预警', () => {
    const value = 'x'.repeat(Math.ceil(LOCAL_STORAGE_ESTIMATE_CHARS * 0.7) - 'sl_large'.length)
    expect(measureLocalBusinessStorage(storageOf({ sl_large: value })).warning).toBe(true)
  })
})
