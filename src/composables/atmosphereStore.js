// 氛围与情绪引擎的存储层：sl_festive_config / sl_mood_log 的默认值、
// 归一化与坏数据修复都集中在这里，读取时立即纠偏，写入前由 setMood/normalize 兜底。
import { useStoredRef } from './store'
import { DEFAULT_FESTIVE_CONFIG, normalizeFestiveConfig } from './festive.js'
import { normalizeMoodLog } from './mood.js'

export const festiveConfig = useStoredRef('sl_festive_config', DEFAULT_FESTIVE_CONFIG)
export const moodLog = useStoredRef('sl_mood_log', {})

// 第一时间修复历史坏数据，避免坏数据进入响应式状态被各页面读到。
const repairedFestive = normalizeFestiveConfig(festiveConfig.value)
if (JSON.stringify(repairedFestive) !== JSON.stringify(festiveConfig.value)) {
  festiveConfig.value = repairedFestive
}
const repairedMood = normalizeMoodLog(moodLog.value)
if (JSON.stringify(repairedMood) !== JSON.stringify(moodLog.value)) {
  moodLog.value = repairedMood
}