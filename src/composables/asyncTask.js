export function createAbortError(message = '任务已取消') {
  try { return new DOMException(message, 'AbortError') } catch {
    const error = new Error(message)
    error.name = 'AbortError'
    return error
  }
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

// 为本身不支持 AbortSignal 的 Worker/Promise 提供统一超时与真实中断钩子。
export function raceWithControls(task, {
  signal = null,
  timeoutMs = 0,
  timeoutMessage = '处理超时，请重试',
  onInterrupt = null,
} = {}) {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = 0

    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', handleAbort)
    }
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const interrupt = (error, reason) => {
      if (settled) return
      settled = true
      cleanup()
      Promise.resolve(onInterrupt?.(reason)).catch(() => {}).finally(() => reject(error))
    }
    const handleAbort = () => interrupt(createAbortError(), 'cancelled')

    signal?.addEventListener('abort', handleAbort, { once: true })
    if (timeoutMs > 0) {
      timer = window.setTimeout(() => interrupt(new Error(timeoutMessage), 'timeout'), timeoutMs)
    }
    Promise.resolve(task).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    )
  })
}
