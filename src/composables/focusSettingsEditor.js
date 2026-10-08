import { DEFAULT_FOCUS_SETTINGS, normalizeFocusSettings } from './focusTimer.js'

/** 从已保存设置构建面板草稿，避免编辑时直接改动持久化对象。 */
export function focusSettingsDraftOf(value) {
  const normalized = normalizeFocusSettings(value)
  return {
    quickTimes: [...normalized.quickTimes],
    pomodoroRounds: normalized.pomodoroRounds,
    soundEnabled: normalized.soundEnabled,
    vibrationEnabled: normalized.vibrationEnabled,
    systemNotificationEnabled: normalized.systemNotificationEnabled,
  }
}

/**
 * 校验并组装专注设置的保存结果。
 *
 * 返回单一结果对象，使表单可以先处理浏览器通知权限，再一次性提交归一化设置。
 */
export function prepareFocusSettingsSave(current, draft) {
  const pomodoroRounds = Number(draft?.pomodoroRounds)
  if (!Number.isInteger(pomodoroRounds) || pomodoroRounds < 1 || pomodoroRounds > 12) {
    return { ok: false, error: '每组轮数请输入 1～12 之间的整数' }
  }

  const quickTimes = Array.isArray(draft?.quickTimes) ? draft.quickTimes.map(Number) : []
  if (quickTimes.some((value) => !Number.isFinite(value) || value < 5 || value > 180)) {
    return { ok: false, error: '常用时间必须是 5～180 之间的整数' }
  }
  const uniqueQuickTimes = [...new Set(quickTimes.map((value) => Math.round(value)))]
  if (uniqueQuickTimes.length !== 4) {
    return { ok: false, error: '4 个常用时间不能重复' }
  }

  return {
    ok: true,
    settings: normalizeFocusSettings({
      ...normalizeFocusSettings(current ?? DEFAULT_FOCUS_SETTINGS),
      quickTimes: uniqueQuickTimes,
      pomodoroRounds,
      soundEnabled: draft.soundEnabled,
      vibrationEnabled: draft.vibrationEnabled,
      systemNotificationEnabled: draft.systemNotificationEnabled,
    }),
  }
}
