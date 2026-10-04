function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

let enabled = false
let startedAt = 0
const entries = []

export function configureStartupDiagnostics(active) {
  if (!active || enabled) return
  enabled = true
  const pageStartedAt = typeof window === 'undefined'
    ? 0
    : Number(window.__STUDY_LIFE_STARTUP_STARTED_AT__)
  startedAt = Number.isFinite(pageStartedAt) && pageStartedAt > 0 ? pageStartedAt : now()
  entries.length = 0
  if (typeof window !== 'undefined') {
    window.__STUDY_LIFE_STARTUP_TIMINGS__ = entries
  }
}

export function startupNow() {
  return now()
}

export function startupElapsedMs() {
  return startedAt ? Math.max(0, now() - startedAt) : 0
}

export function recordStartupTiming({ label, durationMs, ...details } = {}) {
  if (!enabled || !label) return null
  const entry = {
    label,
    durationMs: Math.round(Math.max(0, Number(durationMs) || 0) * 100) / 100,
    elapsedMs: Math.round(Math.max(0, now() - startedAt) * 100) / 100,
    ...details,
  }
  entries.push(entry)
  try {
    performance.mark(`study-life-startup:${label}`)
  } catch {}
  console.info('[Study Life startup]', entry)
  return entry
}

export function reportStartupAssetSummary() {
  if (!enabled || typeof performance === 'undefined') return null
  try {
    const assets = performance.getEntriesByType('resource')
      .filter((entry) => /\/assets\/[^/?#]+\.(?:js|css)(?:[?#]|$)/i.test(entry.name))
      .map((entry) => ({
        file: entry.name.split('/').pop().split(/[?#]/)[0],
        durationMs: Math.round(entry.duration * 100) / 100,
        transferBytes: Number(entry.transferSize) || 0,
        decodedBytes: Number(entry.decodedBodySize) || 0,
      }))
    const navigation = performance.getEntriesByType('navigation')[0]
    const summary = {
      label: 'asset-summary',
      durationMs: 0,
      assetCount: assets.length,
      transferBytes: assets.reduce((sum, asset) => sum + asset.transferBytes, 0),
      decodedBytes: assets.reduce((sum, asset) => sum + asset.decodedBytes, 0),
      slowest: assets.sort((left, right) => right.durationMs - left.durationMs).slice(0, 8),
      document: navigation ? {
        responseStartMs: Math.round(navigation.responseStart * 100) / 100,
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd * 100) / 100,
        transferBytes: Number(navigation.transferSize) || 0,
      } : null,
    }
    return recordStartupTiming(summary)
  } catch {
    return null
  }
}
