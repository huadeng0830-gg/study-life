// 全局错误兜底：组件渲染错误与未捕获的 Promise 拒绝统一在这里记录，
// 并显示“数据没有丢失”的不打扰式提示，避免页面静默白屏后用户无从下手。
// 仅追加记录与提示，绝不吞掉原始错误——完整堆栈仍会交给 console.error。
import { ref } from 'vue'
import { announceAlert } from './liveRegion.js'

export const ERROR_TOAST_MS = 8000

/**
 * 视觉 toast 的两段文案。刻意不含原始错误信息：toast 本来就不显示堆栈，
 * 技术细节留在 `lastGlobalError` 与 console。
 *
 * 播报句由这两段拼成、toast 也直接渲染这两段——**两边不可能各说一套**。
 * （读屏用户听到的必须与视觉用户看到的是同一句话。）
 */
export const GLOBAL_ERROR_TITLE = '页面遇到一个小问题'
export const GLOBAL_ERROR_BODY = '本地数据没有丢失，可继续使用或重新加载。'
export const GLOBAL_ERROR_NOTICE = `${GLOBAL_ERROR_TITLE}：${GLOBAL_ERROR_BODY}`

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
  // 走常驻的 assertive 播报区，而不是只靠 toast 上那个 role="alert"。
  // toast 是 v-if 插入的「新节点带内容」，VoiceOver 可能一个字都不播（见 liveRegion.js 开头），
  // 而出错恰恰是最需要被听见的时刻。这里补上可靠的那条通道。
  announceAlert(GLOBAL_ERROR_NOTICE)
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

/* ---------- 静默失败的可观测性 ---------- */
// 存储写入/镜像等路径刻意“catch 后继续”，不打扰用户；但完全无记录会让
// 线上配额溢出、读写失败无从排查。这里只保留最近若干条到内存环形缓冲并
// 输出 console.warn，不弹任何提示；导出数组仅供诊断脚本或未来诊断页读取。
const SILENT_ERRORS_MAX = 20

export const silentErrors = []

export function recordSilentError(scope, error) {
  try {
    silentErrors.push({
      scope: String(scope ?? 'unknown'),
      message: error instanceof Error ? error.message : String(error ?? ''),
      at: new Date().toISOString(),
    })
    if (silentErrors.length > SILENT_ERRORS_MAX) silentErrors.shift()
    console.warn(`[SilentError:${scope}]`, error ?? '')
  } catch {
  }
}