export function parseRelease(value) {
  if (typeof value !== 'string' || value.length > 120 || /[<>\r\n]/.test(value)) return null
  const match = /^(\d{4})年(\d{2})月(\d{2})日-版本([1-9]\d*)$/.exec(value)
  if (match) {
    const [, year, month, day, sequence] = match.map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || !Number.isSafeInteger(sequence)) return null
    return [year, month, day, sequence]
  }
  if (/^\d+\.\d+\.\d+$/.test(value)) return value.split('.').map(Number)
  return null
}

export function compareRelease(remote, current) {
  if (typeof remote !== 'string' || remote.length > 120 || /[<>\r\n]/.test(remote)) return null
  if (remote === current) return 0 // Also supports configured emergency identifiers.
  const next = parseRelease(remote)
  const previous = parseRelease(current)
  if (!next || !previous || next.length !== previous.length) return null
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) return next[index] > previous[index] ? 1 : -1
  }
  return 0
}

export function updateError(code, message, retryAction = 'check') {
  return Object.assign(new Error(message), { code, retryAction, safeUpdate: true })
}

const ERROR_CODES = new Set(['OFFLINE', 'NETWORK', 'TIMEOUT', 'SOURCE_HTTP', 'SOURCE_INVALID', 'SOURCE_ROLLBACK', 'SOURCE_CHANGED',
  'SW_UNAVAILABLE', 'SW_DOWNLOAD', 'SW_TIMEOUT', 'SW_NO_UPDATE', 'SW_ACTIVATION', 'RELOAD_TIMEOUT',
  'VERSION_VERIFY', 'STORAGE', 'CACHE_REPAIR', 'OTHER_TASK', 'BRIDGE', 'PERMISSION', 'DISK_FULL',
  'INTEGRITY', 'INSTALL', 'INSTALL_TIMEOUT', 'DOWNLOAD', 'CANCELLED', 'FILE_WRITE'])
export function safeUpdateError(error, fallback = 'NETWORK', trusted = false) {
  return { code: ERROR_CODES.has(error?.code) ? error.code : fallback,
    message: ERROR_CODES.has(error?.code) && (error.safeUpdate === true || trusted) && typeof error.message === 'string'
      ? error.message.slice(0, 300) : '连接更新服务失败，请检查网络后重试。',
    retryAction: ['check', 'apply', 'repair', 'wait', 'download', 'install'].includes(error?.retryAction) ? error.retryAction : 'check' }
}

// Only known diagnostic fields are copied. No URLs, headers, environment,
// arbitrary process output, filesystem paths or user data enter this object.
export function formatUpdateDiagnostic(target, state) {
  return JSON.stringify({ target, stage: state.stage, currentVersion: state.currentVersion,
    availableVersion: state.availableVersion, taskId: state.taskId, revision: state.revision,
    lastCheckedAt: state.lastCheckedAt,
    error: state.error ? { code: state.error.code, message: state.error.message, retryAction: state.error.retryAction } : null,
    timings: (state.timings || []).map(({ stage, durationMs }) => ({ stage, durationMs })),
    log: (state.log || []).map(({ at, stage, code }) => ({ at, stage, code })),
    transferred: state.transferred, total: state.total }, null, 2)
}
