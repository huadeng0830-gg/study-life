import { animationsEnabled } from './motion.js'

/**
 * 液态玻璃的动效引擎。
 *
 * 【它做什么】
 * 样式负责"长什么样"，这里负责"怎么反应"：
 *   1. 指针聚光 —— 玻璃卡片接住指针位置，把一小片环境光移到指针下面；
 *   2. 点击涟漪 —— 按下的位置扩散一圈柔光，给按钮一个"被点到"的实感；
 *   3. 错峰入场 —— 路由切换后，页面各区块依次浮起，而不是整页一起淡入。
 *
 * 【为什么用事件委托而不是给每个组件挂监听】
 * 卡片、按钮是全站几百个实例。逐个挂监听意味着每个视图都要记得初始化、
 * 卸载时记得清理，漏一个就是一次内存泄漏。委托到 document 上只有一对
 * 监听器，新增任何卡片/按钮都自动获得反馈，零成本。
 *
 * 【性能约定】
 *   · 写的是自定义属性（--spot-x/--spot-y），不触发布局；
 *   · getBoundingClientRect 每次都读，但布局始终是干净的（只写自定义属性），
 *     所以这次读取几乎不花钱；缓存它反而会在重排之后算错位置；
 *   · 「流畅优先」与系统「减少动效」打开时全部不生效（animationsEnabled 已把两者合并）。
 */

/* 参与聚光的表面。卡片是全站最常见的承载面，所以默认在名单里。 */
const SPOTLIGHT_SELECTOR = '.card, .ui-card, .glass-spot, .glass-sheen'
/* 参与涟漪的控件。只给"会发起动作"的按钮，不给筛选片与导航项（那些点击更频繁，涟漪会显得吵）。 */
const RIPPLE_SELECTOR = '.btn, .ui-button'

/** 一次路由切换最多等多久（毫秒）。超过就放弃错峰入场，绝不阻塞页面。 */
const REVEAL_TIMEOUT = 2600
/** 入场窗口内多久扫一次（毫秒）：补上"壳先出、内容后到"的那批区块。 */
const REVEAL_POLL_INTERVAL = 220
/** 错峰最多铺开多少块。超过的部分不再延迟——一屏塞三十块的话，等到最后一块出现时用户早就走了。 */
const REVEAL_MAX_BLOCKS = 12

let installed = false
let activeSpot = null

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/* ------------------------------------------------------------------ 聚光 */

function onPointerMove(event) {
  if (!animationsEnabled()) return
  const host = event.target && typeof event.target.closest === 'function'
    ? event.target.closest(SPOTLIGHT_SELECTOR)
    : null
  // 指针已经移出所有玻璃表面：把旧目标的聚光收掉，别留一块悬空的亮斑。
  if (!host) {
    if (activeSpot) {
      activeSpot.style.removeProperty('--spot-x')
      activeSpot.style.removeProperty('--spot-y')
      activeSpot = null
    }
    return
  }
  // 矩形每次都重读：读一次会拿一次布局快照，而写的是自定义属性（不触发布局），
  // 所以布局始终是干净的，这次读取几乎不花钱；反过来缓存它反而会在侧栏收起、
  // 数据加载导致重排之后算错位置。pointermove 每秒上百次也扛得住。
  if (host !== activeSpot) activeSpot = host
  const rect = host.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  host.style.setProperty('--spot-x', `${x.toFixed(2)}%`)
  host.style.setProperty('--spot-y', `${y.toFixed(2)}%`)
}

/* ------------------------------------------------------------------ 涟漪 */

function spawnRipple(host, clientX, clientY) {
  if (host.querySelector(':scope > .glass-ripple')) return
  const rect = host.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  // 键盘触发的 click 没有坐标（clientX/clientY 都是 0），
  // 这时把涟漪放在控件中心，而不是左上角。
  const x = clientX || rect.left + rect.width / 2
  const y = clientY || rect.top + rect.height / 2
  const dot = document.createElement('span')
  dot.className = 'glass-ripple'
  dot.setAttribute('aria-hidden', 'true')
  dot.style.setProperty('--ripple-x', `${(((x - rect.left) / rect.width) * 100).toFixed(2)}%`)
  dot.style.setProperty('--ripple-y', `${(((y - rect.top) / rect.height) * 100).toFixed(2)}%`)
  host.appendChild(dot)
  // 动画结束会移除它；但"减少动效"下 animation:none 不会触发 animationend，
  // 所以再挂一个定时器兜底，绝不让节点留在 DOM 里。
  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    dot.remove()
  }
  dot.addEventListener('animationend', remove, { once: true })
  window.setTimeout(remove, 900)
}

/**
 * 涟漪在「激活」时出现（click），而不是「按住」的那一刻。
 *
 * 按下的反馈已经由 CSS 承担：:active 会压下按钮并泛出一圈光。
 * 涟漪留给"这件事被触发了"这一刻，于是两段反馈不重叠：
 * 按下 → 压下去；松开 → 光从落点荡开。
 */
function onActivate(event) {
  if (!animationsEnabled()) return
  const target = event.target && typeof event.target.closest === 'function'
    ? event.target.closest(RIPPLE_SELECTOR)
    : null
  if (!target) return
  spawnRipple(target, event.clientX, event.clientY)
}

/* -------------------------------------------------------------- 错峰入场 */

/**
 * 找出页面真正的"区块层"。
 *
 * 视图根节点常常只是一个壳（例如首页是 `.today-layout > .page`），
 * 直接对根节点的孩子错峰，等于整页一起动，看不出层次。
 * 所以先找 `.page` 这一层容器，它的孩子才是页面上真正的区块。
 */
function pageBlocks(root) {
  const container = root.querySelector(':scope > .page') || root
  return Array.from(container.children)
}

/**
 * 已经处理过的区块。
 * 入场窗口内会反复扫描页面，用它把"已经上过场的"从每次都算一遍里摘掉：
 * getComputedStyle 会触发样式计算，重复做十几遍没有意义。
 */
const revealedBlocks = new WeakSet()

function applyReveal(root) {
  if (!animationsEnabled()) return
  const children = pageBlocks(root).slice(0, REVEAL_MAX_BLOCKS)
  for (const [index, element] of children.entries()) {
    if (!element || element.nodeType !== 1) continue
    if (revealedBlocks.has(element)) continue
    // 已经自带入场动画的元素（例如考试卡片）不要抢——两套动画叠在一起会互相打架。
    const style = window.getComputedStyle(element)
    if (style.animationName && style.animationName !== 'none') {
      revealedBlocks.add(element)
      continue
    }
    // 固定定位与吸顶元素不该参与位移：它们的位置由布局决定，动了会脱节。
    if (style.position === 'fixed' || style.position === 'sticky') {
      revealedBlocks.add(element)
      continue
    }
    element.style.setProperty('--reveal-index', String(index))
    element.classList.add('glass-reveal')
    revealedBlocks.add(element)
  }
}

/**
 * 路由切换后的错峰入场。
 *
 * 【为什么要等，而且要反复等】
 * afterEach 触发时，新页面往往还在异步分包加载中，DOM 里还没有内容。
 * 更麻烦的是有些页面**先出壳、后出内容**：壳已经挂上时里面还是空的，
 * 等数据到了才把区块一个个填进去 —— 只做一次的话，这些区块就永远排不上入场。
 * 所以这里在入场窗口内每隔一小段时间扫一遍：已经上过场的区块带着 class 不动，
 * 新出现的区块补上自己的序号与延迟。
 *
 * 【为什么用定时器而不是 requestAnimationFrame】
 * 后台标签页里 rAF 不会被调度，页面在后台打开时错峰就永远不会发生，
 * 用户切回来看到的是"啪"一下出现的整页。定时器在后台照常跑，
 * 切回来时动画正好在等着播。
 */
export function revealRouteView(path) {
  if (typeof document === 'undefined' || !path) return
  const deadline = now() + REVEAL_TIMEOUT
  const tick = () => {
    const views = document.querySelectorAll('.route-view[data-page-path]')
    for (const view of views) {
      if (view.getAttribute('data-page-path') !== path) continue
      const root = view.firstElementChild
      if (root) applyReveal(root)
    }
    if (now() < deadline) window.setTimeout(tick, REVEAL_POLL_INTERVAL)
  }
  window.setTimeout(tick, 0)
}

/* ------------------------------------------------------------------ 装配 */

export function installGlassMotion() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('click', onActivate, { passive: true })
  // 指针离开窗口时把光斑收掉，别在离开的那块玻璃上留一片悬空的亮斑。
  document.addEventListener('pointerleave', onPointerMove, { passive: true })
}
