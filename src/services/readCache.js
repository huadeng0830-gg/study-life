// Memory only. Neither private results nor account identifiers enter local
// storage, backups, service worker caches or a shared CDN cache.
export function createReadCache({ ttl = 15000, maxEntries = 40 } = {}) {
  const entries = new Map()

  function clear() { entries.clear() }

  async function read(key, request) {
    let entry = entries.get(key)
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) {
      entry = { expiresAt: null, promise: null }
      const current = entry
      current.promise = Promise.resolve().then(request).then(value => {
        current.expiresAt = Date.now() + ttl
        // Callers can mutate/reactivify their copy without poisoning the cache.
        return JSON.stringify(value)
      }).catch(error => {
        if (entries.get(key) === current) entries.delete(key)
        throw error
      })
      entries.delete(key)
      entries.set(key, current)
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
    }
    return JSON.parse(await entry.promise)
  }

  return { read, clear }
}
