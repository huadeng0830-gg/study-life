import { readonly, shallowRef } from 'vue'

const emptyUsage = () => ({ ownerId: '', downloadedBytes: 0, uploadedBytes: 0, snapshotBytes: 0, probes: 0, pulls: 0, pushes: 0 })
const usage = shallowRef(emptyUsage())
export const accountSyncUsage = readonly(usage)

// In-memory estimates for this open app only, not the provider's billing meter.
// Nothing is persisted or sent to analytics.
export function recordAccountSyncUsage(ownerId, operation, payload) {
  if (!ownerId || !['probe', 'pull', 'push'].includes(operation)) return
  const previous = usage.value.ownerId === ownerId ? usage.value : emptyUsage()
  let bytes = 0
  try { bytes = new TextEncoder().encode(JSON.stringify(payload) || '').length } catch { return }
  const counter = operation === 'probe' ? 'probes' : operation === 'pull' ? 'pulls' : 'pushes'
  usage.value = {
    ...previous, ownerId, [counter]: previous[counter] + 1,
    downloadedBytes: previous.downloadedBytes + (operation === 'pull' ? bytes : 0),
    uploadedBytes: previous.uploadedBytes + (operation === 'push' ? bytes : 0),
    snapshotBytes: operation === 'probe' ? previous.snapshotBytes : bytes,
  }
}

export function resetAccountSyncUsage() { usage.value = emptyUsage() }

export function formatSyncBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
