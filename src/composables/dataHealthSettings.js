import { DEFAULT_DATA_HEALTH_THRESHOLDS, normalizeDataHealthThresholds } from './dataHealthReport.js'
import { useStoredRef } from './store/core.js'

export const DATA_HEALTH_SETTINGS_KEY = 'sl_data_health_settings'
export const dataHealthSettings = useStoredRef(DATA_HEALTH_SETTINGS_KEY, /** @type {ReturnType<typeof normalizeDataHealthThresholds>} */ ({ ...DEFAULT_DATA_HEALTH_THRESHOLDS }))

export function saveDataHealthSettings(value = {}) {
  dataHealthSettings.value = normalizeDataHealthThresholds(value)
  return dataHealthSettings.value
}
