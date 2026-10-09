import { getCurrentScope, onScopeDispose } from 'vue'

/** Owns a cancellable UI session; unabortable file reads may finish, but their
 * expired result cannot write into a closed or reopened editor. */
export function useLatestTask() {
  let generation = 0
  let disposed = false
  let controller = null
  let detachParent = null
  function cancel() {
    generation++
    detachParent?.()
    detachParent = null
    controller?.abort()
    controller = null
  }
  function begin(parentSignal) {
    cancel()
    const id = generation
    const active = new AbortController()
    controller = active
    const abort = () => active.abort()
    if (parentSignal?.aborted) abort()
    else parentSignal?.addEventListener('abort', abort, { once: true })
    const detach = () => parentSignal?.removeEventListener('abort', abort)
    detachParent = detach
    return {
      signal: active.signal,
      isCurrent: () => !disposed && generation === id && !active.signal.aborted,
      finish: () => {
        detach()
        if (controller === active) { controller = null; detachParent = null }
      },
    }
  }
  if (getCurrentScope()) onScopeDispose(() => { cancel(); disposed = true })
  return { begin, cancel }
}
