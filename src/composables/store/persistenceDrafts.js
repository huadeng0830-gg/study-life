import { clearPendingRecoveryDraft, savePendingRecoveryDraft } from '../dataVault.js'

const recoveryDraftTokens = new Map()
let recoveryDraftSequence = 0

export function recoveryDraftOwner() {
  try { return localStorage.getItem('study-life-data-owner') || '' } catch { return '' }
}

function recoveryDraftId(ownerId, key) { return `${ownerId || 'guest'}\u0000${key}` }

export function storeRecoveryDraft(key, raw, previousRaw, ownerId = recoveryDraftOwner()) {
  if (typeof raw !== 'string') return Promise.resolve(false)
  const token = `${Date.now()}-${++recoveryDraftSequence}`
  recoveryDraftTokens.set(recoveryDraftId(ownerId, key), { ownerId, token })
  return savePendingRecoveryDraft(ownerId, key, raw, token, previousRaw)
}

export function clearRecoveryDraft(key, ownerId = recoveryDraftOwner()) {
  const id = recoveryDraftId(ownerId, key)
  const draft = recoveryDraftTokens.get(id)
  if (!draft) return
  recoveryDraftTokens.delete(id)
  void clearPendingRecoveryDraft(draft.ownerId, key, draft.token)
}

export function clearPendingWriteOwner(key, pendingWriteOwners, pendingWriteBases) {
  pendingWriteOwners.delete(key)
  pendingWriteBases.delete(key)
}
