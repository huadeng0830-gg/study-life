import { nextTick } from 'vue'
import { reducedEffects } from './performanceMode.js'

/**
 * 统一动效底座。
 *
 * CSS 侧的时长与缓动见 src/style.css 的 --dur-* / --ease-*；
 * 这里提供 JS 侧的同一套常量。两者必须保持一致：
 * 被 CSS 降级规则覆盖的只有 CSS transition/animation，
 * JS 驱动的动画（View Transition、rAF、WAAPI）不受影响，
 * 所以凡是从 JS 发起的动效都要先问 animationsEnabled()。
 */
export const MOTION = {
  instant: 90,
  fast: 150,
  base: 220,
  slow: 320,
  reveal: 420,
  easeStandard: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
}

const VIEWPORT_FALLBACK = { width: 1024, height: 768 }

function viewportSize() {
  if (typeof window === 'undefined') return VIEWPORT_FALLBACK
  return {
    width: Math.max(1, Number(window.innerWidth) || VIEWPORT_FALLBACK.width),
    height: Math.max(1, Number(window.innerHeight) || VIEWPORT_FALLBACK.height),
  }
}

/** 当前是否允许播放动效（「流畅优先」开启或设备偏弱时为 false）。 */
export function animationsEnabled() {
  return !reducedEffects.value
}

/**
 * 圆形扩散的半径 = 原点到最远角落的距离。
 * 纯函数，不依赖 DOM，可直接在 node 环境测试。
 */
export function farthestCornerRadius(x, y, width, height) {
  const w = Math.max(0, Number(width) || 0)
  const h = Math.max(0, Number(height) || 0)
  const px = Math.min(Math.max(0, Number(x) || 0), w)
  const py = Math.min(Math.max(0, Number(y) || 0), h)
  return Math.hypot(Math.max(px, w - px), Math.max(py, h - py))
}

/**
 * 取扩散原点：优先用触点/光标的坐标。
 * 键盘触发（Enter/Space 产生的 click，detail 为 0 且没有坐标）时，
 * 退回触发元素的中心，这样键盘用户也能看到从控件位置扩散。
 */
export function originFromEvent(event, fallbackElement) {
  const { width, height } = viewportSize()
  const x = Number(event?.clientX) || 0
  const y = Number(event?.clientY) || 0
  if (x > 0 || y > 0) return { x, y }
  const rect = fallbackElement?.getBoundingClientRect?.()
  if (rect && (Number(rect.width) > 0 || Number(rect.height) > 0)) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  return { x: width / 2, y: height / 2 }
}

/** 浏览器是否支持圆形扩散（View Transitions API）且当前允许动效。 */
export function canCircularReveal() {
  return typeof document !== 'undefined'
    && typeof document.startViewTransition === 'function'
    && animationsEnabled()
}

/**
 * 用圆形裁切完成一次变更（主题切换等）。
 *
 * 手感要点：旧页面始终留在原地，只被圆形裁切；新页面从触点向外扩散。
 * 没有任何缩放，所以圆边扫过时底下的文字、图标和布局都不会变形。
 *
 * 不支持 View Transitions、或已开启「流畅优先」时，直接同步应用变更，
 * 行为与改造前完全一致（纯渐进增强）。
 *
 * @param {() => void} apply 真正应用变更的函数（会等 Vue DOM flush 后再快照）
 * @param {{x:number,y:number}} origin 扩散原点
 * @returns {boolean} 是否走了圆形扩散
 */
export function revealChange(apply, origin) {
  if (typeof apply !== 'function') return false
  if (!canCircularReveal()) {
    apply()
    return false
  }

  const { width, height } = viewportSize()
  const x = Math.min(Math.max(0, Number(origin?.x) || 0), width)
  const y = Math.min(Math.max(0, Number(origin?.y) || 0), height)
  const radius = farthestCornerRadius(x, y, width, height)
  const root = document.documentElement

  // 先给新快照一个 0 半径的裁切，避免动画开始前闪一帧完整的新页面。
  root.style.setProperty('--reveal-origin', `${x}px ${y}px`)
  root.dataset.themeReveal = '1'
  let cleanedUp = false
  let safetyTimer = 0
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    window.clearTimeout(safetyTimer)
    delete root.dataset.themeReveal
    root.style.removeProperty('--reveal-origin')
  }
  // 兜底：万一 finished 没有按预期结算，也必须把标记摘掉，
  // 否则新快照会一直停在 0 半径。一次性定时器，不是常驻轮询。
  safetyTimer = window.setTimeout(cleanup, MOTION.reveal + 800)

  let transition
  try {
    transition = document.startViewTransition(async () => {
      apply()
      // 必须等 Vue 把 DOM 更新 flush 完再交还控制权，
      // 否则浏览器抓到的「新」快照还是改动前的画面。
      await nextTick()
    })
  } catch {
    cleanup()
    apply()
    return false
  }

  const ready = transition?.ready
  if (ready && typeof ready.then === 'function') {
    ready.then(() => {
      root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: MOTION.reveal,
          easing: MOTION.easeStandard,
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    }).catch(cleanup)
  } else {
    cleanup()
  }

  const finished = transition?.finished
  if (finished && typeof finished.finally === 'function') finished.finally(cleanup)

  return true
}