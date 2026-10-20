import { ref } from 'vue'

/**
 * 页面级 toast 状态。
 *
 * 五个页面各自抄过一份 `showToast`，抄到后来已经不一致了：
 *  - 默认类型：清单页是 `success`，其余四个是 `info`——同一句提示在不同页面颜色不同；
 *  - 清单页把 `actionLabel` 写死成 `undoFn ? '撤销' : ''`，于是同时传 `actionLabel`
 *    和 `undoFn` 时调用方给的文案会被静默丢掉；它也完全不认 `viewFn` 与 `duration`。
 *
 * 这里只统一**归一化与默认值**这一层。`toast` ref 仍然每个页面各一份，
 * 因为每页有各自的 `<Toast>` 与浮动定位（App.vue 的快速记录提示是另一套）。
 *
 * @param {string} [defaultType] 该页的默认提示类型；清单页的确认类文案历史上是 success
 * @param {{ labelUndo?: boolean }} [options] `labelUndo` 保留清单页的旧行为：
 *   传了 `undoFn` 却不给 `actionLabel` 时自动补「撤销」。默认关闭，其余页面要求显式给文案。
 */
export function usePageToast(defaultType = 'info', { labelUndo = false } = {}) {
  /** @type {import('vue').Ref<{ open: boolean, message: string, type: string, actionLabel: string, undoFn: (() => void) | null, viewFn: (() => void) | null, duration: number }>} */
  const toast = ref({ open: false, message: '', type: defaultType, actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })

  /**
   * @param {string} message
   * @param {{ type?: string, actionLabel?: string, undoFn?: (() => void) | null, viewFn?: (() => void) | null, duration?: number }} [options]
   */
  function showToast(message, { type = defaultType, actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
    // 显式的 actionLabel 永远优先：旧版清单页把它写成 `undoFn ? '撤销' : ''`，
    // 于是同时传两者的调用方文案会被静默丢掉。
    const label = actionLabel || (labelUndo && undoFn ? '撤销' : '')
    toast.value = { open: true, message: String(message ?? ''), type, actionLabel: label, undoFn, viewFn, duration }
    return toast.value
  }

  return { toast, showToast }
}