import { animationsEnabled } from './motion.js'

export const FOCUS_QUERY_KEY = 'focus'
export const FOCUS_SECTION_KEY = 'section'
export const FOCUS_DATE_KEY = 'date'

export function focusLocation(path, id, query = {}) {
  const nextQuery = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
  return {
    path,
    query: { ...nextQuery, [FOCUS_QUERY_KEY]: String(id) },
  }
}

export function readFocusQuery(routeOrQuery) {
  const query = routeOrQuery?.query ?? routeOrQuery ?? {}
  return {
    id: String(query[FOCUS_QUERY_KEY] ?? '').trim(),
    section: String(query[FOCUS_SECTION_KEY] ?? '').trim(),
    date: String(query[FOCUS_DATE_KEY] ?? '').trim(),
  }
}

export function clearFocusQuery(query = {}) {
  const next = { ...query }
  delete next[FOCUS_QUERY_KEY]
  delete next[FOCUS_SECTION_KEY]
  delete next[FOCUS_DATE_KEY]
  return next
}

export function clearFocusFromRoute(router, route) {
  if (!router?.replace) return Promise.resolve()
  return router.replace({ query: clearFocusQuery(route?.query) })
}

function documentOf(root) {
  if (root) return root
  return typeof document !== 'undefined' ? document : null
}

export function findFocusElement(id, { root, date = '', type = '' } = {}) {
  const container = documentOf(root)
  const targetId = String(id ?? '').trim()
  if (!container || !targetId || !container.querySelectorAll) return null
  return [...container.querySelectorAll('[data-focus-id]')].find((element) => (
    element.dataset.focusId === targetId
    && (!date || element.dataset.focusDate === String(date))
    && (!type || element.dataset.focusType === String(type))
  )) ?? null
}

export function scrollAndHighlight(id, options = {}) {
  const { className = 'focus-target-highlight', highlightMs = 2400, scroll = true } = options
  const element = findFocusElement(id, options)
  if (!element) return null
  // 平滑滚动是 JS 发起的动画，显式传 behavior: 'smooth' 会**覆盖** CSS 的
  // scroll-behavior，所以 style.css 里那条 prefers-reduced-motion 降级规则管不到它
  // （同一原理见 motion.js 文件头与 VirtualList.scrollToIndex 的注释）。
  // 这里是全应用最频繁的程序化滚动——「跳转到笔记/账单/课程」都走它——
  // 不门控的话，「流畅优先」用户每次跳转都会看到一段长距离滚动动画。
  if (scroll) {
    element.scrollIntoView?.({ block: 'center', behavior: animationsEnabled() ? 'smooth' : 'auto' })
  }
  element.classList.remove(className)
  // 重新触发 CSS animation，即使用户连续从首页打开相同实体也能看到反馈。
  void element.offsetWidth
  element.classList.add(className)
  if (highlightMs > 0 && typeof window !== 'undefined') {
    window.setTimeout(() => element.classList.remove(className), highlightMs)
  }
  return element
}

export function focusElementWhenReady(id, options = {}) {
  const { attempts = 12, retryMs = 50 } = options
  let remaining = Math.max(1, Number(attempts) || 1)

  return new Promise((resolve) => {
    const check = () => {
      const element = scrollAndHighlight(id, options)
      if (element || remaining <= 1) {
        resolve(element)
        return
      }
      remaining -= 1
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(check)
      else if (typeof window !== 'undefined') window.setTimeout(check, retryMs)
      else resolve(null)
    }
    check()
  })
}
