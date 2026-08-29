// 全局错误兜底：组件渲染错误与未捕获的 Promise 拒绝统一在这里记录，
// 并显示“数据没有丢失”的不打扰式提示，避免页面静默白屏后用户无从下手。
// 仅追加记录与提示，绝不吞掉原始错误——完整堆栈仍会交给 console.error。
import { ref } from 'vue'

export const ERROR_TOAST_MS = 8000

export const lastGlobalError = ref(null)

let toastTimer = 0

function formatError(error) {
  if (error instanceof Error) return error.message || String(error)
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function report(kind, error, info) {
  lastGlobalError.value = {
    kind,
    message: formatError(error),
    info: info || '',
    at: new Date().toISOString(),
    stack: error instanceof Error ? error.stack : '',
  }
  console.error(`[GlobalError:${kind}]`, error ?? '', info ?? '')
  if (typeof window !== 'undefined') {
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(dismissGlobalError, ERROR_TOAST_MS)
  }
}

// app.config.errorHandler 覆盖组件渲染/更新/事件回调中的 Vue 捕获错误；
// unhandledrejection 兜住异步遗漏。两者只影响提示，不干预任何数据写入。
export function installGlobalErrorHandling(app) {
  if (!app || !app.config) return
  app.config.errorHandler = (error, instance, info) => report('render', error, info)
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (event) => {
      report('promise', event?.reason)
    })
  }
}

export function dismissGlobalError() {
  if (typeof window !== 'undefined') window.clearTimeout(toastTimer)
  lastGlobalError.value = null
}

export function reloadAfterError() {
  dismissGlobalError()
  if (typeof window !== 'undefined') window.location.reload()
}