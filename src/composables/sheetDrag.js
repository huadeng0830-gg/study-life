/**
 * 底部抽屉的拖拽物理。
 *
 * 这里只放纯函数：采集样本、算释放速度、决定松手后吸附到哪一档。
 * 组件负责取坐标和写样式，判定逻辑全部可单测。
 */

// 下甩 / 上甩的判定速度（px/ms）。约 0.55 px/ms ≈ 550 px/s。
const FLING_DOWN = 0.55
const FLING_UP = 0.45
const MAX_SAMPLES = 6
// 速度只统计最后 100ms 内的采样。按"个数"截断在 60Hz 下是 ~100ms、
// 在 20Hz 的卡顿设备上是 ~300ms，会把一次快甩平均成慢速，松手后不吸附到位。
const VELOCITY_WINDOW_MS = 100

/** 记录一次拖拽采样，只保留最近若干个点。 */
export function pushDragSample(samples, y, time) {
  samples.push({ y: Number(y) || 0, t: Number(time) || 0 })
  if (samples.length > MAX_SAMPLES) samples.shift()
  return samples
}

/**
 * 由采样点估算释放速度，单位 px/ms。
 * 正值 = 手指在向下移动（收起方向），负值 = 向上（展开方向）。
 *
 * @param {Array<{y:number,t:number}>} samples pushDragSample 收集的采样点
 * @param {number|null} now 释放时刻；传了就额外判定"甩完停住再松手"
 */
export function dragVelocity(samples, now = null) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  // 最后一次移动之后隔了很久才松手（甩完又停住）= 不是甩动，按静止处理。
  // 少了这一步，用户下甩后停顿再松手仍会被判成快速下甩而直接关掉抽屉。
  const releaseAt = Number(now)
  if (Number.isFinite(releaseAt) && releaseAt - last.t > VELOCITY_WINDOW_MS) return 0

  const cutoff = last.t - VELOCITY_WINDOW_MS
  let firstIndex = 0
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    if (samples[index].t >= cutoff) firstIndex = index
    else break
  }
  // 窗口内只剩一个点时退回倒数第二个点：采样稀疏时宁可略微低估速度，
  // 也不要因为 dt 为 0 而把一次真实的甩动判成静止。
  if (firstIndex >= samples.length - 1) firstIndex = samples.length - 2

  const first = samples[firstIndex]
  const dt = last.t - first.t
  if (!(dt > 0)) return 0
  return (last.y - first.y) / dt
}

export function clampSheetHeight(height, min, max) {
  const lo = Math.max(0, Number(min) || 0)
  const hi = Math.max(lo, Number(max) || lo)
  const value = Number(height)
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, value))
}

/**
 * 松手后停在哪一档。
 *
 * 手感规则（对应「上拖展开详情，下拖收回摘要」）：
 *  - 在摘要档继续快速下甩，或拖过摘要高度的 closeRatio → 关闭
 *  - 在展开档快速下甩 → 退回摘要档，而不是直接关掉
 *  - 快速上甩 → 直接展开
 *  - 缓慢松手 → 吸附到更近的一档
 *
 * @returns {{state:'close'|'peek'|'expand', height:number}}
 */
export function resolveSheetRelease({ height, velocity, peekHeight, expandHeight, closeRatio = 0.7 }) {
  const peek = Math.max(1, Number(peekHeight) || 1)
  const expand = Math.max(peek, Number(expandHeight) || peek)
  const current = clampSheetHeight(height, 0, expand)
  const speed = Number(velocity) || 0
  const atPeekOrBelow = current <= peek * 1.02

  if (speed >= FLING_DOWN) {
    return atPeekOrBelow ? { state: 'close', height: 0 } : { state: 'peek', height: peek }
  }
  if (speed <= -FLING_UP) {
    return { state: 'expand', height: expand }
  }
  if (current < peek * Math.min(1, Math.max(0, Number(closeRatio) || 0.7))) {
    return { state: 'close', height: 0 }
  }
  if (current < peek) {
    return { state: 'peek', height: peek }
  }
  const midpoint = (peek + expand) / 2
  return current >= midpoint
    ? { state: 'expand', height: expand }
    : { state: 'peek', height: peek }
}

/** 按视口高度和比例算出两档的实际像素高度。 */
export function sheetDetentHeights(viewportHeight, peekRatio = 0.5, expandRatio = 0.92) {
  const vh = Math.max(1, Number(viewportHeight) || 1)
  const peek = Math.max(180, vh * Math.min(Math.max(Number(peekRatio) || 0.5, 0.2), 0.95))
  const expand = Math.max(peek, vh * Math.min(Math.max(Number(expandRatio) || 0.92, 0.2), 1))
  return { peek, expand }
}