// 旧版备份不会包含后来新增的模块。恢复时只能写入备份实际携带的字段，
// 绝不能用兼容默认值覆盖当前浏览器里的新模块数据。
export function backupProvidedFields(data) {
  return new Set(Object.keys(data && typeof data === 'object' ? data : {}))
}

export function buildBackupRestoreValues(data, providedFields, storageKeys) {
  const fields = providedFields instanceof Set ? providedFields : new Set(providedFields)
  return Object.fromEntries(
    Object.entries(storageKeys)
      .filter(([field]) => fields.has(field) && data[field] !== null && data[field] !== undefined)
      .map(([field, key]) => [key, data[field]])
  )
}
