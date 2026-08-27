export const APP_RELEASE = '2026.08.27-9'

export const RELEASE_NOTES = Object.freeze([
  '个性化和数据管理已加入离线预缓存，更新完成后首次打开也无需等待网络。',
  '二维码迁移的大体积代码不参与预缓存，仅在真正打开该功能时按需加载。',
  '课表识图继续支持星期分列、长截图和本地中文识别，图片不会上传服务器。',
])

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

export function shouldShowReleaseNotes() {
  const seen = readSeenReleases()
  // 无法持久化时不弹出，避免隐私模式下每次启动都重复打扰。
  return seen ? !seen.has(APP_RELEASE) : false
}

export function markReleaseSeen() {
  try {
    const history = [...(readSeenReleases()?.values() ?? [])].filter((version) => version !== APP_RELEASE)
    history.push(APP_RELEASE)
    localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)
    localStorage.setItem(RELEASE_HISTORY_KEY, JSON.stringify(history.slice(-MAX_SEEN_RELEASES)))
  } catch {}
}
