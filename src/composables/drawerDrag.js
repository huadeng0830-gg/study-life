/**
 * 侧边抽屉的「右划关闭」物理（≤900px 的「更多功能」抽屉）。
 *
 * 【几何：面板**右锚定**，右划关闭，跟手方向与出场方向同向】
 * 面板贴右边缘（`right:0`），打开态 `translateX(0)`，要藏起来得往**右**移动
 * （`translateX(+102%)`）。因此关闭手势也必须**向右**——手指往右拖、面板跟着往右走、
 * 松手继续往右滑出屏幕。
 * 曾经出现过"左锚面板 + 右划关闭"的组合：手指往右拖、面板跟着往右走、松手却往左飞出去
 * （`translateX(-102%)`），方向在松手那一刻反转。那不是手感问题，是自相矛盾，所以这里把
 * 出场位移做成常量 DRAWER_EXIT_SHIFT，并用 drawerDirectionsAgree() 把"跟手方向 == 出场方向"
 * 钉成一条可断言的不变量（见 tests/drawerDrag.test.js 与 tests/sidebarDrawer.test.js）。
 *
 * 与 sheetDrag.js 的关系：那一份是**纵向**抽屉的（上拖展开 / 下拖收起），语义是"档位高度"，
 * 搬不过来；这里照同样的形状做一个**横向**版本：方向锁 + 速度 + 吸附，只回答
 * "松手后要不要关闭"这一个问题。
 *
 * 【为什么数学只吃 clientX、时间和常量，绝不读 getBoundingClientRect()】
 * happy-dom（本仓测试环境）里所有 rect 都是 0。判定一旦依赖 rect，测试就只能在
 * "宽度恒为 0" 的输入上跑，等于没测——SwipeActionItem.vue 的滑动判定正是因此
 * 只吃 clientX + prop 宽度。所以抽屉宽度不量 DOM，而是用**与 CSS 同源**的常量复算：
 * Sidebar.vue 的 `width: min(86vw, 320px)` ↔ 这里的 drawerWidth(window.innerWidth)。
 * 两边改一个必须改另一个（CSS 那边有注释指向本文件）。
 */

/** 抽屉宽度：86vw（小屏不占满屏，留出遮罩的点击区）与 320px 上限。 */
export const DRAWER_WIDTH_RATIO = 0.86
export const DRAWER_WIDTH_MAX = 320
/** 出场位移（面板自身宽度的百分比）。正号 = 向右，必须与跟手方向同号，见文件头。 */
export const DRAWER_EXIT_SHIFT = 102
/** 方向锁阈值：两轴都不到它就先不判方向（起手时的手指抖动）。 */
export const DRAWER_AXIS_THRESHOLD = 10
/** 松手后判定关闭的位移比例（占抽屉宽度）。 */
export const DRAWER_CLOSE_RATIO = 0.32
/** 关闭方向的甩动速度（px/ms）。约 0.5 px/ms ≈ 500 px/s。 */
export const DRAWER_FLING_VELOCITY = 0.5
/** 贴**右缘**起手时把手势让给系统的边缘/返回手势（同 SwipeActionItem 的取向）。 */
export const DRAWER_EDGE_GUARD = 18
// 速度只统计最后 100ms 的采样。按"个数"截断在 60Hz 下是 ~100ms、在 20Hz 的卡顿设备上
// 是 ~300ms，会把一次快甩平均成慢速（理由与 sheetDrag.js 完全一致）。
const VELOCITY_WINDOW_MS = 100
const MAX_SAMPLES = 6

/** 给定视口宽度下抽屉的像素宽度。非正数/非数字一律退回上限。 */
export function drawerWidth(viewportWidth, ratio = DRAWER_WIDTH_RATIO, max = DRAWER_WIDTH_MAX) {
  const limit = Number(max) > 0 ? Number(max) : DRAWER_WIDTH_MAX
  const width = Number(viewportWidth)
  if (!Number.isFinite(width) || width <= 0) return limit
  const share = Number(ratio) > 0 ? Number(ratio) : DRAWER_WIDTH_RATIO
  return Math.min(width * share, limit)
}

/**
 * 跟手方向是否与出场方向一致（同号）。
 *
 * 这条不变量有来历：面板左锚 + 右划关闭时，跟手为正、出场为负，松手那一刻面板会朝手指的
 * 反方向飞出去。写成函数而不是"人看一眼"，是因为它必须能被断言，也必须能被"故意改坏"验证
 * （判别力夹具）。零位移不算矛盾（点击、或还没移动就松手）。
 */
export function drawerDirectionsAgree(dragOffset, exitShift = DRAWER_EXIT_SHIFT) {
  const drag = Number(dragOffset) || 0
  const exit = Number(exitShift) || 0
  if (drag === 0 || exit === 0) return true
  return Math.sign(drag) === Math.sign(exit)
}

/**
 * 起手点是否落在**右边缘**守卫区里。
 *
 * 为什么守右缘而不是左缘：Android 手势导航的"返回"可以从**左右任一边缘**起手，
 * iOS 的返回在左缘。面板右锚之后，手势的起手区贴着屏幕右缘，正是系统手势会来抢的地方，
 * 所以守卫要跟着面板走（与 SwipeActionItem 让位给系统手势的取向一致）。
 * 拿不到 clientX 或视口宽度（合成事件没带坐标）也返回 true：宁可不起手，
 * 也不要拿着 NaN 去算位移。
 */
export function isDrawerEdgeGuard(clientX, viewportWidth, guard = DRAWER_EDGE_GUARD) {
  const x = Number(clientX)
  const viewport = Number(viewportWidth)
  if (!Number.isFinite(x) || !Number.isFinite(viewport) || viewport <= 0) return true
  const limit = Number(guard) > 0 ? Number(guard) : DRAWER_EDGE_GUARD
  return x >= viewport - limit
}

/** 鼠标不参与滑动（与 SwipeActionItem 同一条约定）：桌面用 × / 点遮罩 / Esc。 */
export function isDrawerGesturePointer(pointerType) {
  return pointerType !== 'mouse'
}

/**
 * 手势轴锁。
 * `'pending'` 还看不出来 | `'horizontal'` 横划（跟手）| `'vertical'` 纵向（交还给内容滚动）。
 * 斜向手势（`|dy| >= |dx|`）一律算纵向：宁可漏关一次，也不要在用户想滚动时把抽屉划走。
 */
export function resolveDrawerAxis(dx, dy, threshold = DRAWER_AXIS_THRESHOLD) {
  const x = Math.abs(Number(dx) || 0)
  const y = Math.abs(Number(dy) || 0)
  const limit = Number(threshold) > 0 ? Number(threshold) : DRAWER_AXIS_THRESHOLD
  if (x < limit && y < limit) return 'pending'
  return y >= x ? 'vertical' : 'horizontal'
}

/**
 * 跟手位移：只跟随**关闭方向**（向右 = 正 dx），并夹在抽屉宽度内。
 * 反向（往左）不跟手，返回 0——面板右锚，往左拖是把它往屏幕里推（越推越开），
 * 没有对应的关闭位移。
 */
export function drawerDragOffset(dx, width) {
  const max = Math.max(1, Number(width) || 0)
  const value = Number(dx) || 0
  if (value <= 0) return 0
  return Math.min(value, max)
}

/** 记录一次拖拽采样，只保留最近若干个点。 */
export function pushDrawerSample(samples, x, time) {
  samples.push({ x: Number(x) || 0, t: Number(time) || 0 })
  if (samples.length > MAX_SAMPLES) samples.shift()
  return samples
}

/**
 * 由采样点估算释放速度，单位 px/ms。
 * 正值 = 手指在向右移动（关闭方向），负值 = 向左。
 *
 * `now` 传了就额外判定"甩完停住再松手"：最后一次移动之后隔了很久才松手不算甩动
 * （少了这一步，快甩后停顿再松手仍会被判成甩动而直接关掉抽屉）。
 */
export function drawerVelocity(samples, now = null) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  const releaseAt = Number(now)
  if (Number.isFinite(releaseAt) && releaseAt - last.t > VELOCITY_WINDOW_MS) return 0

  const cutoff = last.t - VELOCITY_WINDOW_MS
  let firstIndex = 0
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].t >= cutoff) firstIndex = index
    else break
  }
  // 窗口内只剩一个点时退回倒数第二个点：采样稀疏时宁可略微低估速度，
  // 也不要因为 dt 为 0 把一次真实的甩动判成静止。
  if (firstIndex >= samples.length - 1) firstIndex = samples.length - 2

  const first = samples[firstIndex]
  const dt = last.t - first.t
  if (!(dt > 0)) return 0
  return (last.x - first.x) / dt
}

/**
 * 松手后是否关闭。
 *
 *  - 关闭方向的快速甩动（速度 ≥ flingVelocity）→ 关闭，哪怕位移很小；
 *  - 位移达到抽屉宽度的 closeRatio → 关闭；
 *  - 其余 → 回弹到开位（`offset: 0`）。
 *
 * @returns {{close:boolean, offset:number, reason:'fling'|'distance'|'none'}}
 *   `offset` 是吸附后的位置（px）：关闭时是抽屉宽度（朝关闭方向、与出场同号），否则是 0。
 */
export function resolveDrawerRelease({
  dx,
  velocity = 0,
  width,
  closeRatio = DRAWER_CLOSE_RATIO,
  flingVelocity = DRAWER_FLING_VELOCITY,
} = {}) {
  const max = Math.max(1, Number(width) || DRAWER_WIDTH_MAX)
  const offset = drawerDragOffset(dx, max)
  const speed = Number(velocity) || 0
  // 非正数的速度阈值退回默认值：写 0 会让"速度 ≥ 0"恒真，把每次松手都判成关闭。
  const fling = Number(flingVelocity) > 0 ? Number(flingVelocity) : DRAWER_FLING_VELOCITY
  if (speed >= fling) return { close: true, offset: max, reason: 'fling' }

  const raw = Number(closeRatio)
  const ratio = Number.isFinite(raw) && raw > 0 ? Math.min(1, raw) : DRAWER_CLOSE_RATIO
  if (offset >= max * ratio) return { close: true, offset: max, reason: 'distance' }
  return { close: false, offset: 0, reason: 'none' }
}