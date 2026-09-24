export const COORDINATOR_PROTOCOL_VERSION = 2
// 数据结构版本用于阻止旧客户端覆盖已升级的同步空间。
export const SYNC_DATA_SCHEMA_VERSION = 4

export const COORDINATOR_OPERATIONS = Object.freeze([
  'capabilities',
  'authorize',
  'pair-create',
  'pair-prepare',
  'pair-claim',
  'device-recover',
  'device-rename',
  'device-revoke',
  'metadata',
  'pull',
  'push',
])
