import { describe, expect, it } from 'vitest'
import { DEFAULT_FOCUS_SETTINGS } from '../src/composables/focusTimer.js'
import { focusSettingsDraftOf, prepareFocusSettingsSave } from '../src/composables/focusSettingsEditor.js'

describe('focusSettingsEditor', () => {
  it('从已保存设置生成独立草稿并保留用户选项', () => {
    const source = {
      ...DEFAULT_FOCUS_SETTINGS,
      quickTimes: [10, 20, 30, 40],
      vibrationEnabled: false,
    }
    const draft = focusSettingsDraftOf(source)

    expect(draft).toMatchObject({
      quickTimes: [10, 20, 30, 40],
      vibrationEnabled: false,
    })
    expect(draft.quickTimes).not.toBe(source.quickTimes)
  })

  it.each([
    [0, '每组轮数请输入 1～12 之间的整数'],
    [13, '每组轮数请输入 1～12 之间的整数'],
    [1.5, '每组轮数请输入 1～12 之间的整数'],
  ])('拒绝无效番茄轮数 %s', (pomodoroRounds, error) => {
    const result = prepareFocusSettingsSave(DEFAULT_FOCUS_SETTINGS, {
      ...focusSettingsDraftOf(DEFAULT_FOCUS_SETTINGS),
      pomodoroRounds,
    })
    expect(result).toEqual({ ok: false, error })
  })

  it('拒绝越界和四舍五入后重复的快捷时间', () => {
    const base = focusSettingsDraftOf(DEFAULT_FOCUS_SETTINGS)
    expect(prepareFocusSettingsSave(DEFAULT_FOCUS_SETTINGS, { ...base, quickTimes: [4, 25, 45, 60] }).error)
      .toBe('常用时间必须是 5～180 之间的整数')
    expect(prepareFocusSettingsSave(DEFAULT_FOCUS_SETTINGS, { ...base, quickTimes: [15.1, 15.2, 45, 60] }).error)
      .toBe('4 个常用时间不能重复')
  })

  it('保存时规范数值并保留专注记录中的其他设置', () => {
    const current = { ...DEFAULT_FOCUS_SETTINGS, lastUsedMinutes: 35, recentTemporaries: ['阅读'] }
    const result = prepareFocusSettingsSave(current, {
      ...focusSettingsDraftOf(current),
      quickTimes: [10, 20, 30, 40.4],
      pomodoroRounds: '6',
      soundEnabled: false,
    })

    expect(result).toMatchObject({
      ok: true,
      settings: {
        quickTimes: [10, 20, 30, 40],
        pomodoroRounds: 6,
        soundEnabled: false,
        lastUsedMinutes: 35,
        recentTemporaries: ['阅读'],
      },
    })
  })
})
