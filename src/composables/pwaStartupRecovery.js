// PWA 在更新后仍持有旧入口/分包时，App.vue 尚未加载，不能依赖 appUpdate 的恢复逻辑。
// 这里只操作 Service Worker 与 Cache Storage；localStorage、IndexedDB 和业务数据完全不触碰。
export const STARTUP_RESOURCE_RECOVERY_KEY = 'study_life_startup_resource_recovery'
// 跨会话限流记录：记录最近几次「注销 SW + 清缓存 + 重载」的时间戳。
//
// 为什么必须存在（这是一次真实的无限刷新故障的根因）：
// 只靠 STARTUP_RESOURCE_RECOVERY_KEY 这个「每会话一次」的标记时，它在应用**挂载成功**
// 之后就被 clearPwaStartupRecovery() 清掉了。而分包 404 这类故障里 App 依然挂载得起来
// （路由把加载失败兜成错误界面），于是形成闭环：
//   分包 404 → 恢复（注销 SW + 清缓存 + 重载）→ 挂载成功 → 清标记 → 分包仍 404 → 再重载…
// 实测在真 Chrome 里以约 110ms 的间隔无限刷新，手机端表现就是「打不开、一直在刷新首页」。
// 时间戳记在 localStorage 里，重载不会清空，因此失败会停下来变成可见的失败界面。
export const STARTUP_RESOURCE_RECOVERY_LOG_KEY = 'study_life_startup_resource_recovery_log'
export const STARTUP_RECOVERY_WINDOW_MS = 10 * 60 * 1000
export const STARTUP_RECOVERY_MAX_ATTEMPTS = 2

function defaultSession() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

// localStorage 在隐私模式/配额满时会抛异常，此时返回 null，退回「每会话一次」标记。
function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function defaultNow() {
  return Date.now()
}

function defaultReload() {
  if (typeof window !== 'undefined') window.location.reload()
}

function readRecentAttempts(storage, now) {
  if (!storage) return []
  try {
    const raw = storage.getItem(STARTUP_RESOURCE_RECOVERY_LOG_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((at) => Number.isFinite(at) && now() - at < STARTUP_RECOVERY_WINDOW_MS)
  } catch {
    return []
  }
}

function writeAttempts(storage, attempts) {
  if (!storage) return
  try {
    storage.setItem(STARTUP_RESOURCE_RECOVERY_LOG_KEY, JSON.stringify(attempts))
  } catch {
    // 写不进去也要继续：此时「每会话一次」的标记仍然兜着上限。
  }
}

/**
 * 清空恢复预算。**只给用户显式重试用**（错误界面上的「重新加载」按钮）。
 *
 * 绝不能在应用挂载成功时调用：那正是上面注释里那条无限刷新闭环的成因。
 */
export function clearPwaStartupRecovery(session = defaultSession(), storage = defaultStorage()) {
  try {
    session?.removeItem(STARTUP_RESOURCE_RECOVERY_KEY)
  } catch {}
  try {
    storage?.removeItem(STARTUP_RESOURCE_RECOVERY_LOG_KEY)
  } catch {}
}

/** 现在是否还允许自动恢复（同一时间窗内没有用满次数）。 */
export function canRecoverPwaStartupResources({ storage = defaultStorage(), now = defaultNow } = {}) {
  return readRecentAttempts(storage, now).length < STARTUP_RECOVERY_MAX_ATTEMPTS
}

/**
 * 注销 Service Worker、清空 Cache Storage，然后重载页面。
 *
 * @returns {Promise<boolean>} true 表示已经执行恢复并触发了重载；
 *   false 表示**没有**重载（本次会话已恢复过，或时间窗内次数已用满），
 *   调用方必须显示失败界面而不是继续等刷新。
 */
export async function recoverPwaStartupResources({
  session = defaultSession(),
  navigatorRef = typeof navigator === 'undefined' ? null : navigator,
  cachesRef = typeof caches === 'undefined' ? null : caches,
  reload = defaultReload,
  storage = defaultStorage(),
  now = defaultNow,
} = {}) {
  try {
    if (!session || session.getItem(STARTUP_RESOURCE_RECOVERY_KEY)) return false
  } catch {
    return false
  }

  const recent = readRecentAttempts(storage, now)
  if (recent.length >= STARTUP_RECOVERY_MAX_ATTEMPTS) return false

  try {
    session.setItem(STARTUP_RESOURCE_RECOVERY_KEY, '1')
  } catch {
    return false
  }
  writeAttempts(storage, [...recent, now()])

  try {
    const registrations = await navigatorRef?.serviceWorker?.getRegistrations?.() || []
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {}

  try {
    const keys = await cachesRef?.keys?.() || []
    await Promise.all(keys.map((key) => cachesRef.delete(key)))
  } catch {}

  reload()
  return true
}