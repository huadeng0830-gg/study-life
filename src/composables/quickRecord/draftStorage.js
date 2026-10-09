import { RECORD_TYPES } from './types.js'

const PREFIX = 'study-life-quick-record-draft:'

/** @param {string} owner @param {import('./contracts').QuickRecordContext} context */
export function quickRecordDraftKey(owner = '', context = {}) {
  return PREFIX + JSON.stringify([owner || 'local', context.preferredType || '', context.courseId || ''])
}

function sessionStorageOrNull() {
  try { return globalThis.sessionStorage || null } catch { return null }
}

/** @returns {import('./contracts').QuickRecordDraftState | null} */
export function readQuickRecordDraft(key, storage = sessionStorageOrNull()) {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null')
    if (value?.version !== 1 || typeof value.input !== 'string' || !Array.isArray(value.drafts)) return null
    if (!value.drafts.every((draft) => draft && typeof draft.id === 'string' && typeof draft.raw === 'string' && RECORD_TYPES[draft.type])) return null
    return {
      input: value.input,
      forcedType: RECORD_TYPES[value.forcedType] ? value.forcedType : '',
      drafts: value.drafts.map((draft) => ({ ...draft, selected: draft.selected !== false, questions: Array.isArray(draft.questions) ? draft.questions : [] })),
    }
  } catch { return null }
}

/** @param {string} key @param {import('./contracts').QuickRecordDraftState} state */
export function writeQuickRecordDraft(key, state, storage = sessionStorageOrNull()) {
  if (!storage) return false
  try {
    if (!state.input.trim() && !state.drafts.length) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify({ version: 1, ...state }))
    return true
  } catch { return false }
}
