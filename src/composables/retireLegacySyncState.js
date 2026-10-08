const LEGACY_SPACE_SETTINGS_KEY = 'study_life_sync_space'
const LEGACY_SESSION_CODE_KEY = 'study_life_sync_session_code'
const LEGACY_METADATA_KEY = 'study_life_sync_metadata'

/** Remove obsolete device-binding credentials and metadata; preserve all business records. */
export function retireLegacySyncState() {
  try { globalThis.localStorage?.removeItem(LEGACY_SPACE_SETTINGS_KEY) } catch { /* storage may be unavailable */ }
  try { globalThis.sessionStorage?.removeItem(LEGACY_SESSION_CODE_KEY) } catch { /* storage may be unavailable */ }
  try {
    const storage = globalThis.localStorage
    const staleKeys = []
    for (let index = 0; index < (storage?.length || 0); index += 1) {
      const key = storage.key(index)
      if (key === LEGACY_METADATA_KEY || key?.startsWith(LEGACY_METADATA_KEY + ':')) staleKeys.push(key)
    }
    for (const key of staleKeys) storage.removeItem(key)
  } catch { /* storage may be unavailable */ }
}
