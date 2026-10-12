import semver from 'semver'

/** @typedef {{kind: 'legacy', parts: number[]} | {kind: 'semver', value: string}} ParsedRelease */

/** @param {unknown} value @returns {ParsedRelease | null} */
export function parseRelease(value) {
  if (typeof value !== 'string' || value.length > 120 || /[<>\r\n]/.test(value)) return null
  const match = /^(\d{4})年(\d{2})月(\d{2})日-版本([1-9]\d*)$/.exec(value)
  if (match) {
    const [, year, month, day, sequence] = match.map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || !Number.isSafeInteger(sequence)) return null
    return { kind: 'legacy', parts: [year, month, day, sequence] }
  }
  const parsed = semver.parse(value, { loose: false })
  // semver.parse also accepts the common npm-only `v` prefix; the release
  // protocol stores the canonical SemVer string without that prefix. The
  // `valid()` helper drops build metadata, so use the parsed raw form to keep
  // canonical metadata while comparison correctly ignores its precedence.
  if (parsed?.raw === value && !value.startsWith('v'))
    return { kind: 'semver', value }
  return null
}

export function compareRelease(remote, current) {
  if (typeof remote !== 'string' || remote.length > 120 || /[<>\r\n]/.test(remote)) return null
  if (remote === current) return 0 // Also supports configured emergency identifiers.
  const next = parseRelease(remote)
  const previous = parseRelease(current)
  if (!next || !previous || next.kind !== previous.kind) return null
  if (next.kind === 'semver') return semver.compare(next.value, previous.value)
  for (let index = 0; index < next.parts.length; index += 1) {
    if (next.parts[index] !== previous.parts[index]) return next.parts[index] > previous.parts[index] ? 1 : -1
  }
  return 0
}

const RELEASE_CHANNELS = new Set(['stable', 'beta', 'alpha', 'rc'])
const CHANGE_KINDS = ['features', 'improvements', 'fixes', 'security', 'breaking']

function validText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength && value.trim() === value
}

function normalizedChanges(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const changes = {}
  for (const kind of CHANGE_KINDS) {
    const items = value[kind]
    if (!Array.isArray(items) || items.length > 40 || items.some((item) => !validText(item, 500) || !item)) return null
    changes[kind] = [...items]
  }
  return changes
}

function validPublishedAt(value) {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
}

function trustedReleaseUrl(value) {
  if (value === null) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' &&
      url.pathname.startsWith('/huadeng0830-gg/study-life/releases') && !url.username && !url.password
  } catch { return false }
}

/** Parse untrusted same-origin release JSON into a small, explicit public model. */
export function validateReleaseManifest(value, { channel = 'stable' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsedVersion = parseRelease(value.version)
  if (!parsedVersion || parsedVersion.kind !== 'semver' || !RELEASE_CHANNELS.has(value.channel) || value.channel !== channel) return null
  if (semver.parse(value.version)?.build.length) return null
  const prerelease = semver.prerelease(value.version) || []
  if ((channel === 'stable' && prerelease.length) || (channel !== 'stable' && prerelease[0] !== channel)) return null
  if (!validText(value.buildId, 160) || !/^[a-z0-9._-]+$/i.test(value.buildId)) return null
  if (!(value.commitId === 'unknown' || (typeof value.commitId === 'string' && /^[a-f0-9]{7,40}$/i.test(value.commitId)))) return null
  if (typeof value.sourceSignature !== 'string' || !/^[a-f0-9]{10,64}$/i.test(value.sourceSignature)) return null
  if (!validPublishedAt(value.publishedAt)) return null
  if (!validText(value.title, 160) || !value.title || !validText(value.summary, 500)) return null
  const changes = normalizedChanges(value.changes)
  if (!changes) return null
  if (!Array.isArray(value.notes) || value.notes.length > 100 || value.notes.some((note) => !validText(note, 500) || !note)) return null
  const parsedLegacyVersion = value.legacyVersion == null ? null : parseRelease(value.legacyVersion)
  if (value.legacyVersion != null && (typeof value.legacyVersion !== 'string' || !parsedLegacyVersion || parsedLegacyVersion.kind !== 'legacy')) return null
  if (value.minimumSupportedVersion != null && parseRelease(value.minimumSupportedVersion)?.kind !== 'semver') return null
  if (!Number.isSafeInteger(value.schemaVersion) || value.schemaVersion < 1) return null
  const compatibility = value.compatibility
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility) ||
    !Number.isSafeInteger(compatibility.accountSyncSchemaVersion) || compatibility.accountSyncSchemaVersion < 1 ||
    !(compatibility.domainSchemaVersion === null || (Number.isSafeInteger(compatibility.domainSchemaVersion) && compatibility.domainSchemaVersion >= 1))) return null
  if (value.releaseUrl !== null && !trustedReleaseUrl(value.releaseUrl)) return null
  if (value.updateAction !== 'refresh') return null
  return Object.freeze({
    version: value.version,
    buildId: value.buildId,
    commitId: value.commitId,
    sourceSignature: value.sourceSignature,
    channel: value.channel,
    publishedAt: value.publishedAt,
    title: value.title,
    summary: value.summary,
    changes,
    notes: [...value.notes],
    legacyVersion: value.legacyVersion || null,
    minimumSupportedVersion: value.minimumSupportedVersion || null,
    schemaVersion: value.schemaVersion,
    compatibility: { ...compatibility },
    releaseUrl: value.releaseUrl,
    updateAction: value.updateAction,
  })
}

/** Keep only known, same-channel historical releases and render strings as text. */
export function validateReleaseHistory(value, { channel = 'stable' } = {}) {
  const list = Array.isArray(value) ? value : value?.releases
  if (!Array.isArray(list) || list.length > 500) return null
  const seen = new Set()
  const releases = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.channel !== channel || !RELEASE_CHANNELS.has(entry.channel)) return null
    const parsed = parseRelease(entry.version)
    if (!parsed) return null
    if (parsed.kind === 'semver' && semver.parse(entry.version)?.build.length) return null
    const prerelease = parsed.kind === 'semver' ? semver.prerelease(entry.version) || [] : []
    if ((channel === 'stable' && prerelease.length) || (channel !== 'stable' && prerelease[0] !== channel)) return null
    const identity = `${entry.channel}:${entry.version}`
    if (seen.has(identity)) return null
    seen.add(identity)
    const changes = normalizedChanges(entry.changes)
    if (!changes || !validPublishedAt(entry.publishedAt ?? null)) return null
    const notes = entry.notes ?? []
    if (!Array.isArray(notes) || notes.length > 100 || notes.some((note) => !validText(note, 500) || !note)) return null
    if (entry.releaseUrl != null && !trustedReleaseUrl(entry.releaseUrl)) return null
    if (entry.legacyVersion != null && (typeof entry.legacyVersion !== 'string' || parseRelease(entry.legacyVersion)?.kind !== 'legacy')) return null
    releases.push(Object.freeze({
      version: entry.version,
      legacyVersion: entry.legacyVersion || null,
      channel: entry.channel,
      publishedAt: entry.publishedAt ?? null,
      title: validText(entry.title, 160) && entry.title ? entry.title : `版本 ${entry.version}`,
      summary: validText(entry.summary, 500) ? entry.summary : '',
      changes,
      notes: [...notes],
      releaseUrl: entry.releaseUrl || null,
    }))
  }
  return releases
}

export function collectReleaseChanges(history, currentVersion, targetVersion, channel = 'stable') {
  if (parseRelease(currentVersion)?.kind !== 'semver' || parseRelease(targetVersion)?.kind !== 'semver' ||
    compareRelease(targetVersion, currentVersion) <= 0 || !Array.isArray(history)) return []
  const seen = new Set()
  const updates = history.filter((entry) => entry.channel === channel && parseRelease(entry.version)?.kind === 'semver' &&
    compareRelease(entry.version, currentVersion) > 0 && compareRelease(entry.version, targetVersion) <= 0)
    .sort((left, right) => compareRelease(left.version, right.version))
  return updates.map((entry) => {
    const changes = Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, entry.changes[kind].filter((note) => {
      const key = `${kind}:${note.trim().toLocaleLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })]))
    return { ...entry, changes }
  })
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
