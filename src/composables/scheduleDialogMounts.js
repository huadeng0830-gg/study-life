import { onActivated, onDeactivated, onScopeDispose, reactive, watch } from 'vue'

/**
 * Load on first use, then keep instances for close transitions and draft state.
 * @param {Record<string, () => boolean>} sources
 */
export function useScheduleDialogMounts(sources) {
  /** @type {Record<string, boolean>} */
  const mounted = reactive({})
  let active = true
  let disposed = false
  /** @type {Set<() => void>} */
  const waiters = new Set()
  function releaseWaiters() {
    for (const resolve of waiters) resolve()
    waiters.clear()
  }
  onActivated(() => { active = true; releaseWaiters() })
  onDeactivated(() => { active = false })
  onScopeDispose(() => { disposed = true; releaseWaiters() })
  for (const [name, source] of Object.entries(sources)) {
    mounted[name] = false
    watch(source, (open) => {
      if (open) mounted[name] = true
    }, { immediate: true, flush: 'sync' })
  }
  /**
   * A download may finish after KeepAlive has left the page. Wait before
   * publishing the component, so its Modal cannot activate on another route.
   * @template T
   * @param {() => Promise<T>} loader
   * @returns {Promise<T>}
   */
  async function load(loader) {
    const module = await loader()
    if (!active && !disposed) await new Promise(resolve => { waiters.add(() => resolve(undefined)) })
    return module
  }
  return { mounted, load }
}
