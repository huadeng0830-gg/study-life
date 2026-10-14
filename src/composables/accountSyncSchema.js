// 防止旧客户端用已升级前的数据结构覆盖账号里的新数据。
import { normalizeExternalExam } from './externalExam.js'
import { DEFAULT_DATA_HEALTH_THRESHOLDS, normalizeDataHealthThresholds } from './dataHealthReport.js'

export const ACCOUNT_SYNC_DATA_SCHEMA_VERSION = 11

// 旧账号快照缺少后来增加的字段时补默认值；既有记录仍原样保留。
export function migrateAccountSyncPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return {
    ...value,
    ...(Array.isArray(value.sl_exams) ? { sl_exams: value.sl_exams.map((item) => normalizeExternalExam(item)) } : {}),
    sl_notices: Array.isArray(value.sl_notices) ? value.sl_notices : [],
    sl_notice_sources: Array.isArray(value.sl_notice_sources) ? value.sl_notice_sources : [],
    sl_data_health_settings: normalizeDataHealthThresholds(value.sl_data_health_settings ?? DEFAULT_DATA_HEALTH_THRESHOLDS),
  }
}
