import { RELEASE_NOTES as CURRENT_NOTES, RELEASE_UPDATES } from '../../release.config.js'

// 由构建阶段根据实际发布源码自动注入，不再依赖人工或 Agent 记得修改版本号。
export const APP_RELEASE = globalThis.__STUDY_LIFE_RELEASE__ || 'development'

// 当前版本的更新说明。
export const RELEASE_NOTES = Object.freeze([...CURRENT_NOTES])

// 弹窗最多展示最近 3 个版本的更新；其余历史不再保留。
export const MAX_SHOWN_RELEASE_UPDATES = 3
export const RELEASE_UPDATE_GROUPS = Object.freeze(
  RELEASE_UPDATES.slice(0, MAX_SHOWN_RELEASE_UPDATES).map((group) => ({
    version: group.signature === RELEASE_UPDATES[0].signature ? APP_RELEASE : group.version ?? group.signature,
    isCurrent: group === RELEASE_UPDATES[0],
    notes: Object.freeze([...group.notes]),
  }))
)
// 之前的版本（不含当前版本），供“之前的更新”分组展示。
export const PREVIOUS_RELEASE_GROUPS = Object.freeze(RELEASE_UPDATE_GROUPS.slice(1))

// 旧键继续保留用于兼容已经确认过更新说明的设备；历史键避免版本回滚时重复弹出。
export const RELEASE_SEEN_KEY = 'study_life_seen_release'
export const RELEASE_HISTORY_KEY = 'study_life_seen_releases_v1'
const MAX_SEEN_RELEASES = 30

function readSeenReleases() {
  const seen = new Set()
  try {
    const legacy = localStorage.getItem(RELEASE_SEEN_KEY)
    if (legacy) seen.add(legacy)
    try {
      const history = JSON.parse(localStorage.getItem(RELEASE_HISTORY_KEY) || '[]')
      if (Array.isArray(history)) {
        history.filter((version) => typeof version === 'string').forEach((version) => seen.add(version))
      }
    } catch {}
  } catch { return null }
  return seen
}

export function shouldShowReleaseNotes(release = APP_RELEASE) {
  const seen = readSeenReleases()
  // 无法持久化时不弹出，避免隐私模式下每次启动都重复打扰。
  return seen ? !seen.has(release) : false
}

export function markReleaseSeen(release = APP_RELEASE) {
  try {
    const history = [...(readSeenReleases()?.values() ?? [])].filter((version) => version !== release)
    history.push(release)
    localStorage.setItem(RELEASE_SEEN_KEY, release)
    localStorage.setItem(RELEASE_HISTORY_KEY, JSON.stringify(history.slice(-MAX_SEEN_RELEASES)))
  } catch {}
}
