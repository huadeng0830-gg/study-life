// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  APP_RELEASE,
  markReleaseSeen,
  RELEASE_HISTORY_KEY,
  RELEASE_SEEN_KEY,
  shouldShowReleaseNotes,
} from '../src/composables/releaseNotes.js'

beforeEach(() => localStorage.clear())

describe('版本更新说明', () => {
  it('当前版本说明不是空白占位内容', async () => {
    const { RELEASE_NOTES } = await import('../src/composables/releaseNotes.js')
    expect(RELEASE_NOTES.length).toBeGreaterThan(0)
    expect(RELEASE_NOTES.every((note) => typeof note === 'string' && note.trim().length >= 12)).toBe(true)
  })

  it('更新弹窗最多只保留最近 3 个版本的说明', async () => {
    const { RELEASE_UPDATE_GROUPS, PREVIOUS_RELEASE_GROUPS } = await import('../src/composables/releaseNotes.js')
    expect(RELEASE_UPDATE_GROUPS.length).toBeLessThanOrEqual(3)
    expect(RELEASE_UPDATE_GROUPS.length).toBeGreaterThan(0)
    // 第一组始终是当前版本，其余按时间倒序
    expect(RELEASE_UPDATE_GROUPS[0].isCurrent).toBe(true)
    expect(RELEASE_UPDATE_GROUPS[0].version).toBe(APP_RELEASE)
    expect(PREVIOUS_RELEASE_GROUPS.length).toBe(RELEASE_UPDATE_GROUPS.length - 1)
    for (const group of RELEASE_UPDATE_GROUPS) {
      expect(group.notes.length).toBeGreaterThan(0)
      expect(group.notes.every((note) => typeof note === 'string' && note.trim().length >= 12)).toBe(true)
    }
  })

  it('当前版本只展示一次', () => {
    expect(shouldShowReleaseNotes()).toBe(true)
    markReleaseSeen()
    expect(localStorage.getItem(RELEASE_SEEN_KEY)).toBe(APP_RELEASE)
    expect(JSON.parse(localStorage.getItem(RELEASE_HISTORY_KEY))).toContain(APP_RELEASE)
    expect(shouldShowReleaseNotes()).toBe(false)
  })

  it('源码生成的新版本会再次展示，确认后该版本不再重复', () => {
    const previousRelease = 'r-previous'
    const nextRelease = 'r-next'
    markReleaseSeen(previousRelease)

    expect(shouldShowReleaseNotes(previousRelease)).toBe(false)
    expect(shouldShowReleaseNotes(nextRelease)).toBe(true)

    markReleaseSeen(nextRelease)
    expect(shouldShowReleaseNotes(nextRelease)).toBe(false)
    expect(JSON.parse(localStorage.getItem(RELEASE_HISTORY_KEY))).toEqual([previousRelease, nextRelease])
  })

  it('兼容旧版已读记录，不会重新弹出', () => {
    localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)
    expect(shouldShowReleaseNotes()).toBe(false)
  })

  it('历史中看过的版本即使回滚也不重复展示', () => {
    localStorage.setItem(RELEASE_HISTORY_KEY, JSON.stringify(['2026.08.20-1', APP_RELEASE]))
    localStorage.setItem(RELEASE_SEEN_KEY, '2026.09.01-1')
    expect(shouldShowReleaseNotes()).toBe(false)
  })

  it('历史记录损坏时仍可用旧记录判断', () => {
    localStorage.setItem(RELEASE_HISTORY_KEY, '{not-json')
    localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)
    expect(shouldShowReleaseNotes()).toBe(false)
  })
})
