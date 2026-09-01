import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FOCUS_SETTINGS,
  buildFocusSession,
  focusActualSeconds,
  focusDisplayState,
  focusOvertimeSeconds,
  focusRemainingSeconds,
  normalizeActiveSession,
  normalizeFocusSession,
  normalizeFocusSettings,
  pushRecentTemporary,
} from '../src/composables/focusTimer.js'

describe('focusTimer 计时', () => {
  it('基于时间戳计算真实已专注时间，不封顶', () => {
    const session = {
      sessionId: 'f1',
      focusType: 'free',
      title: '',
      plannedMinutes: 25,
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:00:00.000Z',
      elapsedSeconds: 0,
      pausedAt: null,
      pausedDurationSeconds: 0,
    }
    expect(focusActualSeconds(session, '2026-08-30T10:18:00.000Z')).toBe(1080)
    expect(focusActualSeconds(session, '2026-08-30T10:37:00.000Z')).toBe(2220)
    expect(focusOvertimeSeconds(session, '2026-08-30T10:37:00.000Z')).toBe(720)
    expect(focusRemainingSeconds(session, '2026-08-30T10:37:00.000Z')).toBe(0)
  })

  it('暂停期间不计入真实专注时间', () => {
    const session = {
      sessionId: 'f2',
      focusType: 'temporary',
      title: '背单词',
      plannedMinutes: 25,
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:00:00.000Z',
      elapsedSeconds: 600,
      pausedAt: '2026-08-30T10:10:00.000Z',
      pausedDurationSeconds: 0,
    }
    expect(focusActualSeconds(session, '2026-08-30T11:00:00.000Z')).toBe(600)
    const state = focusDisplayState(session, '2026-08-30T11:00:00.000Z')
    expect(state).toMatchObject({ actualSeconds: 600, remainingSeconds: 900, hasCompletedPlan: false })
  })

  it('保存记录时包含完整字段和暂停总时长', () => {
    const session = {
      sessionId: 'f3',
      focusType: 'temporary',
      title: '看论文',
      plannedMinutes: 15,
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:00:00.000Z',
      elapsedSeconds: 900,
      pausedAt: '2026-08-30T10:15:00.000Z',
      pausedDurationSeconds: 0,
    }
    const saved = buildFocusSession(session, '2026-08-30T10:20:00.000Z', 'stopped')
    expect(saved).toMatchObject({
      sessionId: 'f3',
      focusType: 'temporary',
      title: '看论文',
      plannedMinutes: 15,
      actualFocusSeconds: 900,
      pausedDuration: 300,
      status: 'stopped',
    })
  })

  it('超时继续显示正向计时状态', () => {
    const session = {
      sessionId: 'f4',
      focusType: 'free',
      title: '',
      plannedMinutes: 15,
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:00:00.000Z',
      elapsedSeconds: 0,
      pausedAt: null,
      pausedDurationSeconds: 0,
    }
    const state = focusDisplayState(session, '2026-08-30T10:18:00.000Z')
    expect(state.hasCompletedPlan).toBe(true)
    expect(state.overtimeSeconds).toBe(180)
    expect(state.remainingSeconds).toBe(0)
  })

  it('兼容旧版 active 结构并自动判断 focusType', () => {
    const legacy = {
      id: 'focusOld',
      durationMinutes: 25,
      startedAt: '2026-08-30T10:00:00.000Z',
      segmentStartedAt: '2026-08-30T10:00:00.000Z',
      taskId: 'task1',
      label: '复习高数',
      remainingSeconds: 1500,
      pausedAt: '2026-08-30T10:05:00.000Z',
    }
    const normalized = normalizeActiveSession(legacy)
    expect(normalized).toMatchObject({
      sessionId: 'focusOld',
      focusType: 'todo-linked',
      title: '复习高数',
      todoId: 'task1',
      plannedMinutes: 25,
    })
  })
})

describe('focusTimer 设置与记录归一化', () => {
  it('常用时间去重且最多 4 个，非法时使用默认值', () => {
    expect(normalizeFocusSettings({ quickTimes: [15, 25, 25, 60, 90] }).quickTimes).toEqual([15, 25, 60, 90])
    expect(normalizeFocusSettings({ quickTimes: [3, 300, 25, 45, 60] }).quickTimes).toEqual([15, 25, 45, 60])
    expect(normalizeFocusSettings({}).quickTimes).toEqual([15, 25, 45, 60])
    expect(normalizeFocusSettings({ quickTimes: [15, 25, 45, 60], lastUsedMinutes: 37, recentTemporaries: ['a'] })).toEqual({
      quickTimes: [15, 25, 45, 60],
      lastUsedMinutes: 37,
      recentTemporaries: ['a'],
      soundEnabled: true,
      vibrationEnabled: true,
      systemNotificationEnabled: true,
    })
  })

  it('最近临时目标去重且只保留 3 个', () => {
    const base = normalizeFocusSettings(DEFAULT_FOCUS_SETTINGS)
    expect(pushRecentTemporary(base, '背单词').recentTemporaries).toEqual(['背单词'])
    expect(pushRecentTemporary({ ...base, recentTemporaries: ['背单词', '看论文'] }, '背单词').recentTemporaries).toEqual(['背单词', '看论文'])
    expect(pushRecentTemporary({ ...base, recentTemporaries: ['一', '二', '三'] }, '四').recentTemporaries).toEqual(['四', '一', '二'])
  })

  it('旧版专注记录自动归一化为三类专注', () => {
    const free = normalizeFocusSession({ id: 'old1', label: '自由专注', minutes: 25 })
    expect(free).toMatchObject({ sessionId: 'old1', focusType: 'free', title: '', actualFocusSeconds: 1500 })

    const linked = normalizeFocusSession({ id: 'old2', taskId: 'task1', label: '复习高数', minutes: 45 })
    expect(linked).toMatchObject({ sessionId: 'old2', focusType: 'todo-linked', todoId: 'task1', title: '复习高数', actualFocusSeconds: 2700 })
  })
})