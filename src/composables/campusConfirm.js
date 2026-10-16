import { onScopeDispose, ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'

/**
 * Confirmation for campus actions that cannot be undone.
 *
 * Only three campus actions used to ask first — withdrawing your own post,
 * removing reported content, revoking a reviewer grant. The ones a user is most
 * likely to regret were single clicks: marking an item sold, confirming a lost
 * property handover, accepting a helper, clearing a saved draft. Clicking
 * 「确认归还」 by accident closes a lost-property case for good, with no way back
 * and no record on the user's side that it happened.
 *
 * ```js
 * const confirm = useCampusConfirm()
 * confirm.ask({
 *   title: '确认归还？',
 *   message: '确认后物品信息会归档，双方的认领流程结束。',
 *   confirmLabel: '确认归还',
 *   onConfirm: () => decide(claim, 'approve'),
 * })
 * ```
 *
 * …and once per view in the template:
 *
 * ```html
 * <CampusConfirmDialog :request="confirm.pending" @confirm="confirm.confirm()" @close="confirm.close()" />
 * ```
 *
 * One dialog per view rather than one per button, so a screen with six
 * destructive actions still mounts a single overlay.
 *
 * `tone` defaults to `primary`: most campus confirmations *commit* something
 * (a handover, a match, a status change). Red reads as "this destroys data",
 * which is only true for the handful that actually do — pass `tone: 'danger'`
 * for those.
 */
export function useCampusConfirm() {
  const pending = ref(/** @type {Record<string, any>|null} */ (null))

  function ask(request) {
    pending.value = { tone: 'primary', confirmLabel: '确认', cancelLabel: '取消', ...request }
  }

  function close() { pending.value = null }
  // A confirmation captures an account's target and action in its closure.
  watch(() => accountUser.value?.id || '', close, { flush: 'sync' })
  onScopeDispose(close)

  async function confirm() {
    // Clear before awaiting: the dialog must close the moment it is accepted,
    // and a rejected `onConfirm` is already reported by the page's own error
    // slot — letting it bubble here would unmount the screen's feedback.
    const request = pending.value
    pending.value = null
    if (request?.onConfirm) await request.onConfirm()
  }

  return { pending, ask, close, confirm }
}
