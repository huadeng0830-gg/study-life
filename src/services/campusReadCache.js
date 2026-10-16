import { watch } from 'vue'
import { accountUser } from '../composables/accountAuth.js'
import { createReadCache } from './readCache.js'

// Account-scoped memory only: never write campus results to disk, backups or a
// shared cache. Mutations invalidate both transport results and saved screens.
export const campusReadCache = createReadCache({ ttl: 60000 })
const snapshots = new Map()
const SNAPSHOT_TTL = 5 * 60000
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
let snapshotBytes = 0
let revision = 0
let accountRevision = 0

export function campusReadRevision() { return revision }
export function campusReadAccountRevision() { return accountRevision }

export function invalidateCampusReads() {
  revision++
  campusReadCache.clear()
  snapshots.clear()
  snapshotBytes = 0
}

watch(() => accountUser.value?.id || '', () => {
  accountRevision++
  invalidateCampusReads()
}, { flush: 'sync' })

function removeSnapshot(key) {
  const previous = snapshots.get(key)
  if (previous) snapshotBytes -= previous.json.length * 2
  snapshots.delete(key)
}

export function readCampusSnapshot(key) {
  const entry = snapshots.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) { removeSnapshot(key); return null }
  return JSON.parse(entry.json)
}

export function saveCampusSnapshot(key, value, expectedRevision) {
  if (expectedRevision !== revision) return
  // A large directory should still render if there is no room to retain it.
  let json
  try { json = JSON.stringify(value) } catch { return }
  if (!json || json.length * 2 > MAX_SNAPSHOT_BYTES / 2) return
  removeSnapshot(key)
  snapshots.set(key, { json, expiresAt: Date.now() + SNAPSHOT_TTL })
  snapshotBytes += json.length * 2
  while (snapshots.size > 20 || snapshotBytes > MAX_SNAPSHOT_BYTES) removeSnapshot(snapshots.keys().next().value)
}
