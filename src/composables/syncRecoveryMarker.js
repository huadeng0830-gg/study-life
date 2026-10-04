const BASE_MARKER_KEY = 'study_life_sync_commit_marker'
const NAMESPACED_MARKER_PREFIX = `${BASE_MARKER_KEY}:`

// 在没有中断恢复记录的常规启动里，避免为一个不存在的恢复任务提前载入整套云同步代码。
// 发现任何命名空间的标记时都交给正式恢复逻辑验证，误报只会多一次动态导入，不会改数据。
export function hasPendingSyncRecoveryMarker(storage) {
  try {
    const source = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
    if (!source) return true
    if (source.getItem(BASE_MARKER_KEY) !== null) return true
    for (let index = 0; index < source.length; index += 1) {
      if (source.key(index)?.startsWith(NAMESPACED_MARKER_PREFIX)) return true
    }
    return false
  } catch {
    // 无法可靠检查时，保守地调用正式恢复逻辑。
    return true
  }
}
