/**
 * 长按识别。
 *
 * 只用一次性 setTimeout，抬手、移动超出容差、系统取消都会立刻清掉，
 * 不产生常驻定时器（项目硬约束：无后台轮询 / 常驻定时器）。
 *
 * 鼠标端刻意不走长按：桌面用右键菜单更符合预期，由调用方监听 contextmenu。
 */

export const LONG_PRESS_DURATION = 480
export const LONG_PRESS_MOVE_TOLERANCE = 10

export function createLongPress({
  duration = LONG_PRESS_DURATION,
  moveTolerance = LONG_PRESS_MOVE_TOLERANCE,
  onLongPress,
} = {}) {
  let timer = 0
  let pointerId = null
  let startX = 0
  let startY = 0
  // 长按命中后紧接着会来一次 click，必须吃掉它，
  // 否则「长按弹出菜单」会顺带触发这一行原本的点击（例如打开编辑）。
  let fired = false

  function cancel() {
    if (timer) {
      window.clearTimeout(timer)
      timer = 0
    }
    pointerId = null
  }

  function onPointerDown(event) {
    cancel()
    fired = false
    // 鼠标交给 contextmenu；右键和中键也不触发长按
    if (event.pointerType === 'mouse') return
    if (Number.isFinite(event.button) && event.button !== 0) return
    pointerId = event.pointerId
    startX = Number(event.clientX) || 0
    startY = Number(event.clientY) || 0
    const target = event.currentTarget
    timer = window.setTimeout(() => {
      timer = 0
      pointerId = null
      fired = true
      onLongPress?.({ x: startX, y: startY, target })
    }, Math.max(0, Number(duration) || LONG_PRESS_DURATION))
  }

  function onPointerMove(event) {
    if (!timer || event.pointerId !== pointerId) return
    const dx = Math.abs((Number(event.clientX) || 0) - startX)
    const dy = Math.abs((Number(event.clientY) || 0) - startY)
    // 手指移动说明用户在滚动列表，不再是长按
    if (dx > moveTolerance || dy > moveTolerance) cancel()
  }

  function onPointerUp(event) {
    if (event && pointerId !== null && event.pointerId !== pointerId) return
    // 注意这里不能清掉 fired，click 紧接着 pointerup 才到
    cancel()
  }

  /** 若刚发生过长按则返回 true 并复位，供 click 处理器用来吞掉这次点击。 */
  function shouldSuppressClick() {
    if (!fired) return false
    fired = false
    return true
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    cancel,
    shouldSuppressClick,
  }
}