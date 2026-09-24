import { computed, ref } from 'vue'

/**
 * 底部浮层的堆叠管理。
 *
 * 背景：页面底部原本有三套互不感知的浮层 ——
 *   Toast（z-index 200）、快速记录成功提示（z-index 250）、全局错误提示（z-index 300）、
 * 它们都用 `position: fixed; bottom: calc(18px + env(safe-area-inset-bottom))`，
 * 同时出现时会精确地叠在同一个位置，后出现的把先出现的盖住。
 * 加上 KeepAlive 会同时保留多个页面实例，多个 `<Toast>` 也可能一起打开，
 * 于是"提示被吃掉"变成常态。
 *
 * 这里提供一个极小的共享栈：每个浮层在显示时占一个坑位，
 * 按占位顺序向上错开固定步长，从下往上排。
 * 不新增定时器、不引入依赖，纯内存状态，卸载即释放。
 */

const slots = ref([])
let sequence = 0

/** 申请一个稳定的坑位 id（组件 setup 时调用一次）。 */
export function createFloatingSlot() {
  sequence += 1
  return sequence
}

/** 浮层开始显示时占位。 */
export function attachFloatingSlot(id) {
  if (id == null) return
  if (slots.value.includes(id)) return
  slots.value = [...slots.value, id]
}

/** 浮层隐藏或销毁时让位。 */
export function detachFloatingSlot(id) {
  if (id == null) return
  if (!slots.value.includes(id)) return
  slots.value = slots.value.filter((slot) => slot !== id)
}

/** 当前有几个浮层在显示（测试与调试用）。 */
export function floatingSlotCount() {
  return slots.value.length
}

/** 清空所有坑位（测试用）。 */
export function resetFloatingStack() {
  slots.value = []
}

/**
 * 该坑位应该向上偏移多少像素。
 *
 * 第 0 个（最早出现）留在原位，往后的依次向上抬。
 * 超过 maxIndex 之后不再继续抬高：栈太深时继续堆只会把提示顶出屏幕，
 * 而每个浮层都有自己的自动消失时间，实际不会再深下去。
 *
 * @param {number} id createFloatingSlot() 返回的坑位 id
 * @param {number} step 每个浮层之间的垂直间距
 * @param {number} maxIndex 最多错开几层
 */
export function useFloatingOffset(id, step = 56, maxIndex = 2) {
  return computed(() => {
    const index = slots.value.indexOf(id)
    if (index < 0) return 0
    return Math.min(index, Math.max(0, maxIndex)) * step
  })
}