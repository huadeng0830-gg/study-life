import { ref } from 'vue'

/** Owns private collaboration state and request lifetimes for one account/project.
 * Identity reads reject a changed owner immediately; invalidate also rejects A→B→A.
 * State factories restore fresh drafts. A busy lease belongs to its request, so an
 * old finally cannot release a newer request, even when both use the same ref.
 * Independent task results use the context guard; confirmed dialog commits also
 * require their busy lease, so one task's busy state cannot discard another result.
 */
export function createCollaborationContext(readIdentity, { onError: reportError } = {}) {
  let generation = 0
  const channels = new Map()
  const resets = []
  const pending = new Map()

  /** @template T @param {T | (() => T)} initial @returns {import('vue').Ref<T>} */
  function state(initial) {
    const fresh = typeof initial === 'function' ? initial : () => Array.isArray(initial) ? [...initial] : initial
    const value = ref(fresh())
    resets.push(() => { value.value = fresh() })
    return value
  }

  function capture(channel) {
    const epoch = generation
    const identity = readIdentity()
    const marker = Symbol()
    if (channel) channels.set(channel, marker)
    return () => {
      const current = readIdentity()
      return epoch === generation && identity.length === current.length
        && identity.every((item, index) => item === current[index])
        && (!channel || channels.get(channel) === marker)
    }
  }

  function invalidate() {
    generation++
    channels.clear()
    for (const [busy, { idle }] of pending) busy.value = idle
    pending.clear()
    for (const reset of resets) reset()
  }

  async function run(operation, { busy, busyValue = true, current, commit, onError = reportError } = {}) {
    const guard = typeof current === 'function' ? current : capture()
    if (!guard()) return false
    const lease = { idle: typeof busyValue === 'string' ? '' : false }
    if (busy) { pending.set(busy, lease); busy.value = busyValue }
    const isCurrent = guard
    const canCommit = () => isCurrent() && (!busy || pending.get(busy) === lease)
    try {
      const result = await operation(isCurrent)
      if (!isCurrent() || (commit && !canCommit())) return false
      return commit ? await commit(result, canCommit) : result
    } catch (error) {
      if (isCurrent()) {
        if (!onError) throw error
        onError(error)
      }
      return false
    } finally {
      if (busy && pending.get(busy) === lease) {
        pending.delete(busy)
        busy.value = lease.idle
      }
    }
  }

  return { state, capture, invalidate, run }
}
