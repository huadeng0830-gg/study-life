/**
 * 页面浏览位置记忆。
 *
 * 列表页翻到一半跳去别的页面再回来，应该回到原来的位置，
 * 而不是被丢回顶部重找一遍。
 *
 * 全部同步完成，不需要任何定时器：
 * - 记录：router.beforeEach 在导航生效前读取 window.scrollY（此时还是旧位置）
 * - 还原：router.scrollBehavior 优先用浏览器自己的 savedPosition（前进/后退），
 *   其次才用这里记下的位置
 *
 * 只存在内存里：刷新后回到顶部是符合预期的，也不必为它多占一个存储键。
 */

const positions = new Map()

/** 用完整路径做键：同一页面不同筛选条件算不同的浏览位置。 */
export function scrollMemoryKey(route) {
  if (!route) return ''
  if (typeof route === 'string') return route
  return String(route.fullPath || route.path || route.name || '')
}

export function rememberScroll(key, top) {
  const id = scrollMemoryKey(key)
  if (!id) return false
  const value = Number(top)
  if (!Number.isFinite(value) || value < 0) return false
  // 顶部不值得记：回到顶部本来就是默认行为，记下来反而会「粘」住列表
  if (value < 24) {
    positions.delete(id)
    return false
  }
  positions.set(id, Math.round(value))
  return true
}

export function recallScroll(key) {
  const value = positions.get(scrollMemoryKey(key))
  return Number.isFinite(value) && value > 0 ? value : null
}

export function forgetScroll(key) {
  return positions.delete(scrollMemoryKey(key))
}

export function resetScrollMemory() {
  positions.clear()
}

export function scrollMemorySize() {
  return positions.size
}

/**
 * 该把页面滚到哪里。
 * @returns {{top: number}} 传给 vue-router scrollBehavior 的坐标
 */
export function resolveScrollPosition({ savedPosition = null, remembered = null } = {}) {
  // 浏览器前进/后退自带的位置最准，优先用它
  if (savedPosition && Number.isFinite(Number(savedPosition.top))) {
    return { top: Math.max(0, Number(savedPosition.top)) }
  }
  if (Number.isFinite(Number(remembered)) && Number(remembered) > 0) {
    return { top: Math.round(Number(remembered)) }
  }
  return { top: 0 }
}