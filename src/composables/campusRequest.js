import { onScopeDispose, reactive, watch } from 'vue'
import { accountUser } from './accountAuth.js'

/**
 * Generation guard for campus reads and writes.
 *
 * Campus screens all do the same three things: fetch public content, run an
 * action, and throw both away when the signed-in account changes underneath
 * them. Handled locally that meant `let generation = 0`, a watcher that bumps
 * it, and an `if (revision !== generation)` after every await — six copies, of
 * which three forgot to bump on account change and could write one account's
 * response into another account's screen.
 *
 * `useCampusRequest` centralises that. Call `begin()` before awaiting and
 * `live(token)` afterwards; `live` is false once the account changed, the
 * component unmounted, or a newer request started.
 *
 * `campusLifePage` is built on the same idea for read-then-act page state; use
 * that when a screen also wants the account replay behaviour and a shared
 * notice, and this one for the single-shot reads that pages do not cover.
 */
export function useCampusRequest() {
  let generation = 0
  let active = true

  onScopeDispose(() => { active = false; generation += 1 })

  watch(() => accountUser.value?.id || '', () => { generation += 1 }, { flush: 'sync' })

  /** 标记一次新的请求；返回的令牌用于稍后判断结果是否仍然有效。 */
  function begin() { return ++generation }

  /** 令牌是否仍属于当前屏幕。 */
  function live(revision) { return active && revision === generation }

  /** 让所有在途请求失效，用于账号切换或界面重置。 */
  function invalidate() { generation += 1 }

  return { begin, live, invalidate }
}

/**
 * Keyed busy flags for rows that can each be acted on independently.
 *
 * A single shared `busy` boolean is what most campus views had, which meant
 * submitting a correction on one shuttle route greyed out the form on every
 * other route. `run(key, task)` marks only that row.
 */
export function useCampusBusyKeys() {
  // reactive Map: templates read `busy(id)` on every render and must see flips.
  const keys = reactive(new Map())
  function reset() { keys.clear() }
  watch(() => accountUser.value?.id || '', reset, { flush: 'sync' })
  onScopeDispose(reset)

  function busy(key) { return keys.has(key) }

  async function run(key, task) {
    if (keys.has(key)) return false
    const token = Symbol()
    keys.set(key, token)
    try {
      await task()
      return true
    } finally {
      // An old account's completion must not unlock the new account's row.
      if (keys.get(key) === token) keys.delete(key)
    }
  }

  return { busy, run }
}
