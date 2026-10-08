import { onBeforeUnmount, ref } from 'vue'

const PRIORITY_ORDER = { error: 4, warning: 3, success: 2, info: 1 }

/** Serializes shell toasts so simultaneous actions show the most important message first. */
export function useToastQueue() {
  const toast = ref(null)
  const queue = ref([])
  let timer = 0

  function processQueue() {
    if (!queue.value.length) return
    const next = queue.value[0]
    toast.value = {
      message: next.message,
      type: next.type,
      actionLabel: next.actionLabel,
      undoFn: next.undoFn,
      viewFn: next.viewFn,
      duration: next.duration,
    }
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      queue.value.shift()
      if (queue.value.length) processQueue()
      else toast.value = null
    }, next.duration)
  }

  function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
    const priority = PRIORITY_ORDER[type] ?? 1
    queue.value.push({ id: Date.now() + Math.random(), message, type, actionLabel, undoFn, viewFn, duration, priority })
    queue.value.sort((a, b) => b.priority - a.priority)
    processQueue()
  }

  onBeforeUnmount(() => window.clearTimeout(timer))
  return { toast, showToast }
}
