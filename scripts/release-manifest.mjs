import semver from 'semver'

export const CHANGE_KINDS = Object.freeze(['features', 'improvements', 'fixes', 'security', 'breaking'])
const CHANNELS = new Set(['stable', 'beta', 'alpha', 'rc'])

function text(value, max = 240) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.trim().length > max) throw new Error(`发布说明文本必须是 ${max} 字以内的字符串。`)
  return value.trim()
}

export function normalizeChanges(value = {}) {
  if (value == null) value = {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('发布变化分类必须是对象。')
  return Object.fromEntries(CHANGE_KINDS.map((kind) => {
    const items = value[kind] ?? []
    if (!Array.isArray(items) || items.length > 40) throw new Error(`${kind} 必须是最多 40 条的字符串数组。`)
    return [kind, items.map((item) => {
      const note = text(item, 500)
      if (!note) throw new Error(`${kind} 分类中存在空说明。`)
      return note
    })]
  }))
}

function safeReleaseUrl(value) {
  if (value == null || value === '') return null
  const raw = text(value, 500)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      !url.pathname.startsWith('/huadeng0830-gg/study-life/releases') || url.username || url.password)
      throw new Error()
    return url.href
  } catch { throw new Error('更新日志链接必须是受信任 GitHub Releases 地址。') }
}

export function normalizeReleaseHistory(history) {
  if (!Array.isArray(history) || history.length > 500) throw new Error('release-history.json 必须是最多 500 条的数组。')
  const seen = new Set()
  return history.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`第 ${index + 1} 条发布记录不是对象。`)
    const version = text(entry.version, 120)
    const channel = entry.channel == null ? 'stable' : entry.channel
    if (!CHANNELS.has(channel)) throw new Error(`第 ${index + 1} 条发布记录的渠道无效。`)
    const parsedVersion = semver.valid(version, { loose: false })
    if (!parsedVersion && !/^\d{4}年\d{2}月\d{2}日-版本[1-9]\d*$/.test(version))
      throw new Error(`第 ${index + 1} 条发布记录的版本号无效。`)
    if (parsedVersion && (parsedVersion !== version || semver.parse(version)?.build.length))
      throw new Error(`第 ${index + 1} 条发布记录的 SemVer 必须是无构建后缀的规范格式。`)
    const identity = `${channel}:${version}`
    if (seen.has(identity)) throw new Error(`发布记录包含重复版本 ${version}。`)
    seen.add(identity)
    const publishedAt = entry.publishedAt == null ? null : text(entry.publishedAt, 40)
    if (publishedAt && (!/^\d{4}-\d{2}-\d{2}T/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))))
      throw new Error(`版本 ${version} 的发布时间无效。`)
    const notes = entry.notes == null ? [] : entry.notes
    if (!Array.isArray(notes) || notes.length > 100) throw new Error(`版本 ${version} 的 notes 必须是最多 100 条的数组。`)
    const normalizedNotes = notes.map((item) => {
      const note = text(item, 500)
      if (!note) throw new Error(`版本 ${version} 的 notes 中存在空说明。`)
      return note
    })
    const legacyVersion = text(entry.legacyVersion, 120) || (parsedVersion ? null : version)
    if (legacyVersion && !/^\d{4}年\d{2}月\d{2}日-版本[1-9]\d*$/.test(legacyVersion))
      throw new Error(`版本 ${version} 的旧版兼容标识无效。`)
    const parsedChannel = parsedVersion ? semver.prerelease(version) || [] : []
    if ((channel === 'stable' && parsedChannel.length) || (channel !== 'stable' && parsedChannel[0] !== channel))
      throw new Error(`版本 ${version} 与 ${channel} 发布渠道不匹配。`)
    return {
      version,
      legacyVersion,
      channel,
      publishedAt,
      title: text(entry.title, 160) || `版本 ${version}`,
      summary: text(entry.summary, 500) || normalizedNotes[0] || '',
      changes: normalizeChanges(entry.changes),
      notes: normalizedNotes,
      releaseUrl: safeReleaseUrl(entry.releaseUrl),
    }
  })
}

export function createReleaseManifest({ appVersion, legacyVersion, channel = 'stable',
  release = /** @type {Record<string, any>} */ ({}), releaseNotes = /** @type {string[]} */ ([]),
  releaseHistory = /** @type {any[]} */ ([]), buildInfo, schemaVersion,
  compatibility = /** @type {Record<string, any>} */ ({}), releaseUrl = /** @type {string | null} */ (null) }) {
  if (!semver.valid(appVersion, { loose: false }) || semver.valid(appVersion, { loose: false }) !== appVersion)
    throw new Error(`正式应用版本必须是规范 SemVer：${String(appVersion)}`)
  if (!CHANNELS.has(channel)) throw new Error(`发布渠道无效：${String(channel)}`)
  const prerelease = semver.prerelease(appVersion) || []
  if ((channel === 'stable' && prerelease.length) || (channel !== 'stable' && prerelease[0] !== channel))
    throw new Error(`版本号预发布标识必须与 ${channel} 渠道一致。`)
  if (!/^\d{4}年\d{2}月\d{2}日-版本[1-9]\d*$/.test(legacyVersion || '')) throw new Error('旧版兼容标识格式无效。')
  if (!buildInfo || !/^[a-z0-9._-]{1,160}$/i.test(buildInfo.buildId || '')) throw new Error('Build ID 缺失或格式无效。')
  if (buildInfo.commitId !== 'unknown' && !/^[a-f0-9]{7,40}$/i.test(buildInfo.commitId || '')) throw new Error('Commit ID 格式无效。')
  if (!/^[a-f0-9]{10,64}$/i.test(buildInfo.sourceSignature || '')) throw new Error('源码签名格式无效。')
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error('Schema 版本无效。')
  const minimumSupportedVersion = release.minimumSupportedVersion || null
  if (minimumSupportedVersion && (semver.valid(minimumSupportedVersion, { loose: false }) !== minimumSupportedVersion ||
    semver.parse(minimumSupportedVersion)?.build.length)) throw new Error('最低支持版本无效。')
  const records = normalizeReleaseHistory(releaseHistory)
  const currentRecord = records.find((entry) => entry.version === appVersion && entry.channel === channel)
  if (!currentRecord) throw new Error(`release-history.json 缺少当前正式版本 ${appVersion}。`)
  if (currentRecord.legacyVersion !== legacyVersion) throw new Error('当前发布记录与旧版兼容标识不一致。')
  const safeRelease = safeReleaseUrl(releaseUrl)
  return {
    version: appVersion,
    buildId: buildInfo.buildId,
    commitId: buildInfo.commitId,
    sourceSignature: buildInfo.sourceSignature,
    channel,
    publishedAt: currentRecord.publishedAt,
    title: text(release.title, 160) || currentRecord.title,
    summary: text(release.summary, 500) || currentRecord.summary || text(releaseNotes[0], 500),
    changes: normalizeChanges(release.changes || currentRecord.changes),
    notes: (Array.isArray(releaseNotes) && releaseNotes.length ? releaseNotes : currentRecord.notes).slice(0, 100).map((note) => text(note, 500)).filter(Boolean),
    legacyVersion,
    minimumSupportedVersion,
    schemaVersion,
    compatibility: {
      accountSyncSchemaVersion: Number.isSafeInteger(compatibility.accountSyncSchemaVersion) ? compatibility.accountSyncSchemaVersion : schemaVersion,
      domainSchemaVersion: Number.isSafeInteger(compatibility.domainSchemaVersion) ? compatibility.domainSchemaVersion : null,
    },
    releaseUrl: safeRelease,
    updateAction: 'refresh',
  }
}
