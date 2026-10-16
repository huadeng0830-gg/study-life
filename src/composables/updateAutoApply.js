import { watch } from 'vue'
import { flushStoredWrites } from './store/core.js'
import { overlayCount, overlayStackRevision } from './overlayStack.js'
import { updatePreferences } from './updatePreferences.js'

// 「本会话是否已经自动应用过」必须写在 sessionStorage：它要**跨过自动重载本身**，
// 否则新页面会再次判定「该自动更新」，变成刷新循环。
export const AUTO_APPLY_SESSION_KEY = 'sl_update_auto_applied_v1'
// 「等待条件」是会变的：有浮层打开、或还有未落盘的改动。关掉浮层/写完盘之后要能自动继续，
// 而不是永远错过这次更新，所以按固定间隔重试。
export const AUTO_APPLY_RECHECK_MS = 10000

function defaultSession() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/**
 * 自动应用更新的判定。刻意做成纯逻辑 + 可注入依赖，便于测试三种拒绝原因。
 *
 * 【为什么不看「用户有没有动过鼠标」】那不是安全边界。真正的边界是两件事：
 *  1. 有没有**未落盘的改动**（`flushStoredWrites()` 的 ok/pendingKeys）——有就绝不能重载；
 *  2. 有没有**浮层打开**（设置/表单弹窗）——此时重载会打断正在填的内容。
 * 只要这两条都干净，重载就只是「重新加载同一份本机数据」，不会丢东西。
 */
export function createUpdateAutoApplyGate({ session = defaultSession(), isOverlayOpen = () => overlayCount() > 0,
  pendingWrites = () => flushStoredWrites(), preferences = updatePreferences } = {}) {
  function alreadyApplied() {
    try { return session?.getItem(AUTO_APPLY_SESSION_KEY) === '1' } catch { return false }
  }
  function markApplied() {
    try { session?.setItem(AUTO_APPLY_SESSION_KEY, '1') } catch {}
  }
  function decide(stage) {
    if (stage !== 'ready') return { apply: false, reason: 'stage' }
    if (!preferences.autoApply) return { apply: false, reason: 'preference-off' }
    if (!preferences.autoCheck) return { apply: false, reason: 'auto-check-off' }
    if (alreadyApplied()) return { apply: false, reason: 'already-applied' }
    if (isOverlayOpen()) return { apply: false, reason: 'overlay-open' }
    let flush
    try { flush = pendingWrites() } catch { return { apply: false, reason: 'pending-check-failed' } }
    if (flush && flush.ok === false) return { apply: false, reason: 'pending-writes' }
    return { apply: true, reason: 'ready' }
  }
  return { decide, markApplied, alreadyApplied }
}

/**
 * 启动自动应用：`stage` 变成 ready（新版离线资源已下载完成）时，只要没有未落盘改动、
 * 没有打开的浮层，就自动完成「启用新资源 → 重新加载 → 验证版本」。
 *
 * 这是「每次都要完全退出重新进入才能更新」的根本解法：等待中的 Worker 只有全部客户端
 * 关闭才会自激活，所以只要应用自己不动手，用户就只剩「退出重进」一条路。
 *
 * @returns {() => void} 停止函数
 * @param {{state: {stage: string}, apply: () => unknown, gate?: ReturnType<typeof createUpdateAutoApplyGate>, windowRef?: (Window & typeof globalThis) | null, recheckMs?: number}} options
 */
export function startUpdateAutoApply({ state, apply, gate = createUpdateAutoApplyGate(),
  windowRef = typeof window === 'undefined' ? null : window, recheckMs = AUTO_APPLY_RECHECK_MS } = {}) {
  if (!windowRef || typeof state?.stage !== 'string' || typeof apply !== 'function') return () => {}
  let timer = 0
  const attempt = () => {
    if (gate.decide(state.stage).apply !== true) return
    gate.markApplied()
    void apply()
  }
  const stopStage = watch(() => state.stage, attempt, { immediate: true })
  const stopOverlay = watch(() => overlayStackRevision.value, attempt)
  timer = windowRef.setInterval(attempt, recheckMs)
  return () => {
    stopStage()
    stopOverlay()
    if (timer) windowRef.clearInterval(timer)
  }
}
