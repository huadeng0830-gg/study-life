// Memory only. Neither private results nor account identifiers enter local
// storage, backups, service worker caches or a shared CDN cache.
export function createReadCache({ ttl = 15000, maxEntries = 40, maxBytes = 2 * 1024 * 1024 } = {}) {
  const entries = new Map()
  let bytes = 0

  function remove(key) {
    bytes -= entries.get(key)?.bytes || 0
    entries.delete(key)
  }
  function trim() {
    while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value)
  }
  function clear() { entries.clear(); bytes = 0 }
  function cancelled() { return new DOMException('Read cancelled', 'AbortError') }

  async function read(key, request, { signal } = {}) {
    if (signal?.aborted) throw cancelled()
    let entry = entries.get(key)
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) {
      remove(key)
      entry = { expiresAt: null, promise: null, bytes: 0, consumers: 0, settled: false, controller: new AbortController() }
      const current = entry
      current.promise = Promise.resolve().then(() => {
        if (current.controller.signal.aborted) throw cancelled()
        return request(current.controller.signal)
      }).then(value => {
        if (current.controller.signal.aborted) throw cancelled()
        current.expiresAt = Date.now() + ttl
        // Callers can mutate/reactivify their copy without poisoning the cache.
        const json = JSON.stringify(value)
        const size = json.length * 2 // conservative UTF-16 budget, including CJK
        if (entries.get(key) === current) {
          if (size > maxBytes) remove(key)
          else { current.bytes = size; bytes += size; trim() }
        }
        return json
      }).catch(error => {
        if (entries.get(key) === current) remove(key)
        throw error
      }).finally(() => { current.settled = true })
      entries.set(key, current)
      trim()
    }
    entry.consumers++
    return new Promise((resolve, reject) => {
      let done = false
      function finish(error, json) {
        if (done) return
        done = true
        signal?.removeEventListener('abort', abort)
        entry.consumers--
        if (!entry.settled && entry.consumers === 0) {
          if (entries.get(key) === entry) remove(key)
          entry.controller.abort()
        }
        if (error) reject(error)
        else { try { resolve(JSON.parse(json)) } catch (cause) { reject(cause) } }
      }
      function abort() { finish(cancelled()) }
      signal?.addEventListener('abort', abort, { once: true })
      entry.promise.then(json => finish(null, json), error => finish(error))
    })
  }

  return { read, clear }
}
