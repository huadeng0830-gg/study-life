let latestRawReader = null
let pendingKeysReader = null

export function registerStoredSnapshotAccessors({ readLatestStoredRaw, getPendingPersistenceKeys }) {
  latestRawReader = readLatestStoredRaw
  pendingKeysReader = getPendingPersistenceKeys
}

export function readLatestStoredRaw(key, storage = globalThis.localStorage) {
  if (latestRawReader) return latestRawReader(key, storage)
  return storage?.getItem(key) ?? null
}

export function getPendingPersistenceKeys() {
  return pendingKeysReader?.() || []
}
