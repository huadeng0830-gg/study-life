import { onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { campusErrorMessage } from './campusContentModel.js'

/**
 * Read-then-act page state for a campus screen.
 *
 * Every campus view does the same thing: load a list, run an action, refresh,
 * and drop everything if the signed-in account changes mid-flight. This holds
 * that state so the views hold their own data.
 *
 * ## Two errors, not one
 *
 * `error` is a **read** failure and `actionError` is a **write** failure, and
 * they are shown in different places on purpose:
 *
 *  - a read failure replaces the list (CampusStateBlock) — there is nothing
 *    trustworthy left to display, so a retry button belongs there;
 *  - an action failure sits below the list (CampusStatusMessages) — the list
 *    is still valid, and replacing it with an error and a "重试" button would
 *    send the user to re-read data that was never the problem.
 *
 * They used to share one ref, so failing to add a campus event to the local
 * schedule blanked the whole activity list behind a retry button.
 *
 * ## Why `act()` returns a boolean
 *
 * It used to return the mutation's own value, and all fifteen call sites gated
 * on truthiness to decide whether to close a form or refresh:
 *
 *     const result = await page.act(() => sendInterest(listing))
 *     if (result) { contactId.value = ''; await refresh() }
 *
 * Several of those mutations resolve to `undefined` on the server. In that case
 * the success banner appeared and the form stayed open with the list stale —
 * `act()` had succeeded, its caller just could not tell. Returning an explicit
 * `true`/`false` removes the coupling between a server response shape and
 * fifteen different call sites.
 *
 * ## Why `load()` keeps the notice
 *
 * Actions are followed by a refresh. Clearing the notice on every read would
 * make 「已提交审核。」 vanish the instant it appeared. The notice instead lives
 * until the next action or until the view unmounts.
 */
export function useCampusLifePage({ reloadOnAccountChange = true } = {}) {
  const data = ref(null)
  const loading = ref(false)
  const error = ref('')
  const actionError = ref('')
  const notice = ref('')
  // Two counters, not one. `generation` invalidates reads; `ownerGeneration`
  // invalidates writes. Merging them would mean a background refresh cancels a
  // user action that is already in flight — the two must be independent.
  let generation = 0
  let ownerGeneration = 0
  let active = true
  let lastRequest = null
  let actionGeneration = 0
  onScopeDispose(() => { active = false; generation += 1; ownerGeneration += 1 })

  function currentUser() { return accountUser.value?.id || '' }
  function isLiveRead(revision, userId) { return active && revision === generation && currentUser() === userId }
  function isLiveWrite(owner, userId) { return active && owner === ownerGeneration && currentUser() === userId }

  watch(currentUser, () => {
    generation += 1
    ownerGeneration += 1
    data.value = null
    loading.value = false
    error.value = ''
    actionError.value = ''
    notice.value = ''
    const owner = ownerGeneration
    // Re-read for the newly signed-in account. `lastRequest` is the reason the
    // page can be rebuilt from scratch instead of each view re-wiring a watcher.
    if (lastRequest && reloadOnAccountChange) void Promise.resolve().then(() => { if (active && owner === ownerGeneration) return load(lastRequest) })
  }, { flush: 'sync' })

  async function load(request, initial = null) {
    lastRequest = request
    const revision = ++generation
    const userId = currentUser()
    loading.value = true
    error.value = ''
    // A refresh supersedes whatever the last write left behind: the user is
    // looking at the result of that action now, whichever way it went.
    actionError.value = ''
    if (initial !== null) data.value = initial
    try {
      const result = await request()
      if (!isLiveRead(revision, userId)) return null
      data.value = result
      return result
    } catch (cause) {
      if (isLiveRead(revision, userId)) error.value = campusErrorMessage(cause, '暂时无法读取校园信息。')
      return null
    } finally {
      if (isLiveRead(revision, userId)) loading.value = false
    }
  }

  /** Runs a mutation. Resolves `true` when it succeeded and the screen is still live. */
  async function act(task, successText = '操作已完成。') {
    const action = ++actionGeneration
    const owner = ownerGeneration
    const userId = currentUser()
    notice.value = ''
    actionError.value = ''
    try {
      await task()
      if (!isLiveWrite(owner, userId)) return false
      if (action === actionGeneration) { notice.value = successText; actionError.value = '' }
      return true
    } catch (cause) {
      if (isLiveWrite(owner, userId) && action === actionGeneration) { actionError.value = campusErrorMessage(cause, '操作没有完成，请重试。'); notice.value = '' }
      return false
    }
  }

  /**
   * Feedback for work that never left the device — adding a campus event to the
   * local schedule, for instance. Routed to `actionError` rather than `error`
   * so a local failure never blanks a list that is still perfectly readable.
   */
  function report(message) { actionGeneration += 1; notice.value = message; actionError.value = '' }
  function reportFailure(message) { actionGeneration += 1; actionError.value = message; notice.value = '' }

  /** Clears a previous success banner without touching the current list. */
  function dismissNotice() { notice.value = '' }

  return { data, loading, error, actionError, notice, load, act, report, reportFailure, dismissNotice }
}
