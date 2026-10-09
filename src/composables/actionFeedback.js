import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, toValue } from 'vue'
import { raceWithControls } from './asyncTask.js'
import { animationsEnabled } from './motion.js'

// CSS timing tokens in style.css use the same values. Business completion never
// waits for these timers: only the visual state does.
export const ACTION_TIMING = Object.freeze({
  press: 120, collapse: 300, fade: 150, minimumImportant: 1200,
  successImportant: 1000, successFrequent: 650, error: 1000, restore: 300,
})
export const ACTION_PHASES = Object.freeze(['idle', 'pressed', 'collapsing', 'loading', 'success', 'error', 'restoring'])

/**
 * An action starts immediately. It must return false for validation / no-op,
 * throw for failure, and resolve only when the real write has completed.
 * Callbacks receive an AbortSignal and must check it before committing after
 * an await. A timeout is opt-in for callbacks that support actual interruption.
 * Vue emits do not return listener promises; use a function prop for tasks.
 * @param {{kind?: import('vue').MaybeRefOrGetter<string>, feedback?: import('vue').MaybeRefOrGetter<boolean>, timeoutMs?: number, motionEnabled?: () => boolean}} [options]
 */
export function useActionFeedback({ kind = 'frequent', feedback = true, timeoutMs = 0, motionEnabled = () =>
  animationsEnabled() && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } = {}) {
  const phase = ref('idle')
  const pending = ref(false)
  const error = ref('')
  const failure = shallowRef(/** @type {unknown} */ (null))
  const result = ref('')
  const morph = ref(false)
  const full = () => toValue(kind) === 'important' && toValue(feedback) && motionEnabled()
  const locked = computed(() => pending.value || (toValue(kind) === 'important' && phase.value !== 'idle'))
  let generation = 0
  let disposed = false
  let controller = null
  const timers = new Set()

  function clearTimers() {
    for (const timer of timers) globalThis.clearTimeout(timer)
    timers.clear()
  }
  function later(callback, delay, id) {
    const timer = globalThis.setTimeout(() => {
      timers.delete(timer)
      if (!disposed && id === generation) callback()
    }, Math.max(0, delay))
    timers.add(timer)
  }
  function restore(id, animated) {
    phase.value = animated ? 'restoring' : 'idle'
    if (animated) later(() => { phase.value = 'idle' }, ACTION_TIMING.restore, id)
  }
  function cancel() {
    const wasPending = pending.value
    generation++
    clearTimers()
    controller?.abort()
    controller = null
    if (disposed) return
    pending.value = false
    result.value = wasPending ? 'cancelled' : ''
    phase.value = 'idle'
  }
  function dispose() {
    cancel()
    disposed = true
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  async function run(action, event) {
    if (disposed || locked.value || typeof action !== 'function') return false
    clearTimers()
    const id = ++generation
    const started = Date.now()
    const animated = full()
    morph.value = animated
    const mode = toValue(kind)
    const visualFeedback = toValue(feedback) && mode !== 'instant' && mode !== 'task'
    const activeController = new AbortController()
    controller = activeController
    pending.value = true // Synchronous lock, before calling any business code.
    error.value = ''
    failure.value = null
    result.value = ''
    phase.value = mode === 'instant' ? 'idle' : 'pressed'
    if (mode !== 'instant') {
      later(() => { phase.value = animated ? 'collapsing' : 'loading' }, ACTION_TIMING.press, id)
      if (animated) later(() => { phase.value = 'loading' }, ACTION_TIMING.press + ACTION_TIMING.collapse, id)
    }

    try {
      // Do not defer this call to a timeout, animation end, or promise microtask.
      const work = action({ signal: activeController.signal, event })
      const value = await raceWithControls(work, {
        signal: activeController.signal, timeoutMs,
        timeoutMessage: '操作超时，请检查连接后重试',
        onInterrupt: () => activeController.abort(),
      })
      if (disposed || id !== generation) return false
      pending.value = false
      controller = null
      if (value === false || value?.cancelled === true) {
        clearTimers()
        result.value = value?.cancelled === true ? 'cancelled' : ''
        phase.value = 'idle'
        return false
      }
      result.value = 'success'
      if (!visualFeedback || value?.feedback === false) {
        clearTimers()
        phase.value = 'idle'
        return value
      }
      const showSuccess = () => {
        clearTimers()
        phase.value = 'success'
        later(() => restore(id, animated), animated ? ACTION_TIMING.successImportant : ACTION_TIMING.successFrequent, id)
      }
      if (animated) later(showSuccess, ACTION_TIMING.minimumImportant - (Date.now() - started), id)
      else showSuccess()
      return value
    } catch (cause) {
      if (disposed || id !== generation) return false
      clearTimers()
      pending.value = false
      controller = null
      if (cause instanceof Error && cause.name === 'AbortError') {
        result.value = 'cancelled'
        phase.value = 'idle'
        return false
      }
      result.value = 'error'
      failure.value = cause
      error.value = cause instanceof Error ? cause.message : (typeof cause === 'string' ? cause : '操作失败，请重试')
      phase.value = visualFeedback ? 'error' : 'idle'
      if (visualFeedback) later(() => restore(id, animated), ACTION_TIMING.error, id)
      return false
    }
  }

  return { phase, pending, locked, error, failure, result, morph, run, cancel, dispose }
}
