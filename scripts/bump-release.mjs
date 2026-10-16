// 更新唯一的正式版本、兼容旧 Web 客户端的标识、结构化更新日志与 README。
// 用法：node scripts/bump-release.mjs --type patch|minor|major --features "..." --fixes "..."
// 每个分类可用 | 分隔多条说明；不支持的 beta 发布必须使用独立发布源，当前流程只发布 stable。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_VERSION, LEGACY_RELEASE_VERSION, RELEASE_NOTES, RELEASE_SOURCE_SIGNATURE, RELEASE_UPDATES } from '../release.config.js'
import { computeSourceSignature } from './source-signature.mjs'
import { buildReleaseEntry, MAX_RELEASE_ENTRIES, nextSemverVersion, nextVersion as incrementLegacyVersion,
  releaseHistoryMatchesCurrent,
  replaceCurrentReleaseEntry, trimReleaseUpdates, validateReleaseNotes } from './version-utils.mjs'
import { normalizeReleaseHistory } from './release-manifest.mjs'
import { syncReleaseStatus } from './release-readme.mjs'

const RELEASE_PATH = fileURLToPath(new URL('../release.config.js', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const PACKAGE_LOCK_PATH = fileURLToPath(new URL('../package-lock.json', import.meta.url))
const DESKTOP_PACKAGE_PATH = fileURLToPath(new URL('../desktop-app/package.json', import.meta.url))
const DESKTOP_LOCK_PATH = fileURLToPath(new URL('../desktop-app/package-lock.json', import.meta.url))
const HISTORY_PATH = fileURLToPath(new URL('../release-history.json', import.meta.url))
const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url))
const CHANGE_KINDS = ['features', 'improvements', 'fixes', 'security', 'breaking']
const RELEASES_URL = 'https://github.com/huadeng0830-gg/study-life/releases'

function parseArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? String(argv[index + 1] || '') : ''
  }
  const amend = argv.includes('--amend-notes')
  const amendValue = value('amend-notes')
  const rawNotes = amend
    ? (amendValue.startsWith('--') ? '' : amendValue)
    : value('notes')
  const changes = Object.fromEntries(CHANGE_KINDS.map((kind) => [kind,
    value(kind).split('|').map((item) => item.trim()).filter(Boolean),
  ]))
  const hasCategorizedChanges = CHANGE_KINDS.some((kind) => changes[kind].length)
  if (rawNotes && hasCategorizedChanges && !amend) throw new Error('请使用 --notes 或分类参数，不要混用。')
  if (amend && rawNotes && hasCategorizedChanges) throw new Error('修订时请用分类参数，不要同时传 --amend-notes 文案。')
  if (amend && !rawNotes && !hasCategorizedChanges) throw new Error('--amend-notes 需要说明文本或至少一个分类参数。')
  const notes = rawNotes ? rawNotes.split('|').map((note) => note.trim()).filter(Boolean) : CHANGE_KINDS.flatMap((kind) => changes[kind])
  return { notes, changes, amend, type: value('type') || 'patch', summary: value('summary').trim() }
}

function serializeJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function firstVersionOf(content) {
  const match = /version: '([^']+)'/.exec(content)
  return match ? match[1] : null
}
function currentHistoryFromConfig() {
  return RELEASE_UPDATES.map((entry) => ({
    version: entry.version,
    legacyVersion: entry.legacyVersion || entry.version,
    channel: entry.channel || 'stable',
    publishedAt: entry.publishedAt || null,
    title: entry.title || `版本 ${entry.version}`,
    summary: entry.summary || entry.notes?.[0] || '',
    changes: Object.fromEntries(CHANGE_KINDS.map((kind) => [kind,
      Array.isArray(entry.changes?.[kind]) ? entry.changes[kind] : [],
    ])),
    notes: Array.isArray(entry.notes) ? entry.notes : [],
    releaseUrl: RELEASES_URL,
  }))
}
function readHistory() {
  if (!existsSync(HISTORY_PATH)) return currentHistoryFromConfig()
  return normalizeReleaseHistory(JSON.parse(readFileSync(HISTORY_PATH, 'utf8')))
}
function historyRecord({ version, legacyVersion, notes, changes, summary }) {
  return {
    version, legacyVersion, channel: 'stable', publishedAt: null,
    title: `三两事 ${version}`, summary: summary || notes[0] || '',
    changes: Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, [...(changes[kind] || [])]])),
    notes: [...notes], releaseUrl: RELEASES_URL,
  }
}

const { notes, changes, amend, type, summary } = parseArgs(process.argv.slice(2))
const original = readFileSync(RELEASE_PATH, 'utf8')
const rootPackage = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'))
const rootLock = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, 'utf8'))
const desktopPackage = JSON.parse(readFileSync(DESKTOP_PACKAGE_PATH, 'utf8'))
const desktopLock = JSON.parse(readFileSync(DESKTOP_LOCK_PATH, 'utf8'))
const originalReadme = readFileSync(README_PATH, 'utf8')
let history
try { history = readHistory() }
catch (error) {
  console.error(`✗ release-history.json 无效，未写入任何文件：${error.message}`)
  process.exit(1)
}

if (rootPackage.version !== APP_VERSION || rootLock.version !== APP_VERSION || rootLock.packages?.['']?.version !== APP_VERSION ||
  desktopPackage.version !== APP_VERSION || desktopLock.version !== APP_VERSION || desktopLock.packages?.['']?.version !== APP_VERSION) {
  console.error('✗ release.config.js、两个 package.json 与 lock 文件版本号必须一致，未写入任何内容')
  process.exit(1)
}
// 版本或旧版兼容标识**任一**与发布历史首条不一致就必须停：
// 原来是 &&，只有两者同时不符才拦得住，单边漂移会被静默放过。
if (!releaseHistoryMatchesCurrent(history, APP_VERSION, LEGACY_RELEASE_VERSION)) {
  console.error('✗ 更新历史首条与当前正式版本不一致，未写入任何内容')
  process.exit(1)
}
if (amend && history[0]?.publishedAt) {
  console.error(`✗ ${APP_VERSION} 已记录发布时间，不能用 --amend-notes 重新签署；请创建新的 SemVer 发布。`)
  process.exit(1)
}
if (notes.length || amend) {
  const problems = validateReleaseNotes(notes)
  if (problems.length) {
    console.error('✗ 版本说明校验不通过，未写入任何内容：')
    problems.forEach((problem) => console.error(`  - ${problem}`))
    process.exit(1)
  }
}

let candidate = original
let nextAppVersion = APP_VERSION
let nextLegacyVersion = LEGACY_RELEASE_VERSION
let rootPackageCandidate = null
let rootLockCandidate = null
let desktopPackageCandidate = null
let desktopLockCandidate = null
let historyCandidate = history

if (notes.length && amend) {
  const hasCategorizedChanges = CHANGE_KINDS.some((kind) => changes[kind].length)
  const replaced = replaceCurrentReleaseEntry(original, { notes,
    changes: hasCategorizedChanges ? changes : undefined,
    summary: summary || undefined,
  })
  if (!replaced || replaced === original) {
    console.error('✗ 没能在 release.config.js 里定位当前版本说明，未写入任何内容')
    process.exit(1)
  }
  candidate = replaced
  historyCandidate = history.map((entry, index) => index === 0
    ? { ...entry, summary: summary || notes[0], notes: [...notes],
      ...(hasCategorizedChanges ? { changes: Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, [...changes[kind]]])) } : {}) }
    : entry)
} else if (notes.length) {
  try {
    nextAppVersion = nextSemverVersion(APP_VERSION, type)
    nextLegacyVersion = nextLegacyVersionFn(LEGACY_RELEASE_VERSION)
  } catch (error) {
    console.error(`✗ ${error.message}，未写入任何内容`)
    process.exit(1)
  }
  const header = /export const RELEASE_UPDATES = Object\.freeze\(\[\r?\n/.exec(original)
  if (!header) {
    console.error('✗ 没能在 release.config.js 里定位版本列表，未写入任何内容')
    process.exit(1)
  }
  const eol = header[0].endsWith('\r\n') ? '\r\n' : '\n'
  const insertAt = header.index + header[0].length
  const entry = buildReleaseEntry(nextAppVersion, notes, {
    legacyVersion: nextLegacyVersion,
    channel: 'stable',
    summary,
    changes,
  }).replace(/\n/g, eol)
  candidate = `${original.slice(0, insertAt)}${entry}${original.slice(insertAt)}`
  candidate = candidate.replace(/export const APP_VERSION = '[^']*'/, `export const APP_VERSION = '${nextAppVersion}'`)
  candidate = candidate.replace(/export const LEGACY_RELEASE_VERSION = '[^']*'/, `export const LEGACY_RELEASE_VERSION = '${nextLegacyVersion}'`)
  if (candidate === original) {
    console.error('✗ 版本号常量未能更新，未写入任何内容')
    process.exit(1)
  }
  rootPackageCandidate = { ...rootPackage, version: nextAppVersion }
  rootLockCandidate = { ...rootLock, version: nextAppVersion,
    packages: { ...rootLock.packages, '': { ...rootLock.packages[''], version: nextAppVersion } } }
  desktopPackageCandidate = { ...desktopPackage, version: nextAppVersion }
  desktopLockCandidate = { ...desktopLock, version: nextAppVersion,
    packages: { ...desktopLock.packages, '': { ...desktopLock.packages[''], version: nextAppVersion } } }
  historyCandidate = [historyRecord({ version: nextAppVersion, legacyVersion: nextLegacyVersion, notes, changes, summary }),
    ...history.filter((entry) => entry.version !== nextAppVersion)]
}

candidate = trimReleaseUpdates(candidate, MAX_RELEASE_ENTRIES)
historyCandidate = normalizeReleaseHistory(historyCandidate)

// A source change without a release note must not be relabelled as the same official version.
if (!notes.length && !amend) {
  const currentSignature = computeSourceSignature()
  if (currentSignature !== RELEASE_SOURCE_SIGNATURE) {
    console.error('✗ 发布源码已变化；请先选择 SemVer 类型并提供更新说明：npm run release:bump -- --type patch --fixes "..."')
    process.exit(1)
  }
}

const sourceFileContents = {
  'release-history.json': serializeJson(historyCandidate),
  ...(rootPackageCandidate ? {
    'package.json': serializeJson(rootPackageCandidate),
    'package-lock.json': serializeJson(rootLockCandidate),
  } : {}),
  ...(desktopPackageCandidate ? {
    'desktop-app/package.json': serializeJson(desktopPackageCandidate),
    'desktop-app/package-lock.json': serializeJson(desktopLockCandidate),
  } : {}),
}
const signature = computeSourceSignature({ releaseConfigContent: candidate, sourceFileContents })
let finalized = candidate.replace(/RELEASE_SOURCE_SIGNATURE = '[^']*'/, `RELEASE_SOURCE_SIGNATURE = '${signature}'`)

if (notes.length && amend) {
  const signaturePattern = /(RELEASE_UPDATES = Object\.freeze\(\[\r?\n  \{\r?\n    version: '[^']*',[\s\S]*?    signature: ')[^']*(')/
  const next = finalized.replace(signaturePattern, `$1${signature}$2`)
  if (next === finalized) {
    console.error('✗ 没能更新当前版本的源码签名，未写入任何内容')
    process.exit(1)
  }
  finalized = next
} else if (notes.length) {
  const next = finalized.replace(/signature: ''/, `signature: '${signature}'`)
  if (next === finalized) {
    console.error('✗ 新版本条目的签名占位缺失，未写入任何内容')
    process.exit(1)
  }
  finalized = next
}

const newVersion = notes.length && !amend ? nextAppVersion : APP_VERSION
let readmeCandidate
try {
  readmeCandidate = syncReleaseStatus(originalReadme, {
    webVersion: newVersion,
    desktopVersion: newVersion,
    notes: notes.length ? notes : RELEASE_NOTES,
  })
} catch (error) {
  console.error(`✗ ${error.message}，未写入任何内容`)
  process.exit(1)
}

writeFileSync(RELEASE_PATH, finalized)
writeFileSync(HISTORY_PATH, serializeJson(historyCandidate))
if (rootPackageCandidate) {
  writeFileSync(PACKAGE_PATH, serializeJson(rootPackageCandidate))
  writeFileSync(PACKAGE_LOCK_PATH, serializeJson(rootLockCandidate))
}
if (desktopPackageCandidate) {
  writeFileSync(DESKTOP_PACKAGE_PATH, serializeJson(desktopPackageCandidate))
  writeFileSync(DESKTOP_LOCK_PATH, serializeJson(desktopLockCandidate))
}
writeFileSync(README_PATH, readmeCandidate)

console.log(`✓ RELEASE_SOURCE_SIGNATURE 已更新为 ${signature}`)
console.log(notes.length && amend
  ? `✓ 已修正尚未发布的 ${newVersion} 更新说明`
  : notes.length
    ? `✓ 已新增 ${type} 版本：${newVersion}（stable）`
    : '✓ 正式版本与源码签名一致')
console.log(`当前正式版本：${newVersion}；旧版 Web/PWA 兼容标识：${nextLegacyVersion}`)
console.log(`更新历史：${historyCandidate.length} 个版本`)
console.log('✓ README、网页和 Windows 桌面版本已同步')

function nextLegacyVersionFn(legacyVersion) {
  return incrementLegacyVersion([{ version: legacyVersion }])
}
