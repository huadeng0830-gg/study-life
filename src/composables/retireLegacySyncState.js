const LEGACY_SYNC_PREFIX = 'study_life_sync_'
const RETIRED_NOTES_KEY = 'sl_quick_notes'
const ARCHIVED_NOTES_KEY = 'sl_archived_quick_notes'

function preserveRetiredNotes(storage) {
  try {
    const raw = storage?.getItem(RETIRED_NOTES_KEY)
    if (!raw) return
    const notes = JSON.parse(raw)
    if (!Array.isArray(notes)) return
    const previous = JSON.parse(storage.getItem(ARCHIVED_NOTES_KEY) || '[]')
    if (!Array.isArray(previous)) return
    const merged = new Map()
    for (const note of [...previous, ...notes]) {
      if (!note || typeof note !== 'object') continue
      const id = String(note.id || `${note.createdAt || ''}:${note.title || note.content || ''}`)
      merged.set(id, note)
    }
    storage.setItem(ARCHIVED_NOTES_KEY, JSON.stringify([...merged.values()]))
    storage.removeItem(RETIRED_NOTES_KEY)
  } catch {
    // Keep the original value intact if it cannot be archived safely.
  }
}

function clearLegacySyncKeys(storage) {
  try {
    if (!storage) return
    const staleKeys = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(LEGACY_SYNC_PREFIX)) staleKeys.push(key)
    }
    for (const key of staleKeys) storage.removeItem(key)
  } catch { /* storage may be unavailable */ }
}

/** Preserve retired note content before removing its old active key and obsolete sync state. */
export function retireLegacySyncState() {
  preserveRetiredNotes(globalThis.localStorage)
  try { clearLegacySyncKeys(globalThis.localStorage) } catch { /* storage may be unavailable */ }
  try { clearLegacySyncKeys(globalThis.sessionStorage) } catch { /* storage may be unavailable */ }
}
