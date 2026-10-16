// Sample 10% of browser sessions. Aggregate locally, retain at most 128 timings
// per fixed endpoint, and never send telemetry, bodies, IDs, URLs or credentials.
const endpoints = new Set(['auth', 'database', 'storage', 'campus-life', 'campus-social', 'campus-community', 'platform-admin', 'public-feedback'])
const measurements = new Map()
let enabled = typeof window !== 'undefined' && Math.random() < 0.1
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now()

export function configureApiMetrics(active) { enabled = active === true; measurements.clear() }

export function apiMetricsSnapshot() {
  return [...measurements].map(([endpoint, entry]) => {
    const values = [...entry.timings].sort((a, b) => a - b)
    const percentile = p => values.length ? values[Math.ceil(values.length * p) - 1] : null
    return { endpoint, observedRequests: entry.count, errors: entry.errors, cancelled: entry.cancelled,
      sampleCount: values.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }
  })
}

export async function measureApiRequest(endpoint, operation) {
  if (!enabled || !endpoints.has(endpoint)) return operation()
  const start = now()
  let status = 0, cancelled = false
  try {
    const response = await operation()
    status = response.status
    return response
  } catch (error) { cancelled = error?.name === 'AbortError'; throw error }
  finally {
    const entry = measurements.get(endpoint) || { count: 0, errors: 0, cancelled: 0, timings: [] }
    entry.count++
    if (cancelled) entry.cancelled++
    else {
      if (!status || status >= 400) entry.errors++
      if (entry.timings.length === 128) entry.timings.shift()
      entry.timings.push(Math.round(Math.max(0, now() - start) * 10) / 10)
    }
    measurements.set(endpoint, entry)
  }
}

export function measuredSupabaseFetch(input, init) {
  let endpoint = ''
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.pathname.startsWith('/auth/')) endpoint = 'auth'
    else if (url.pathname.startsWith('/rest/')) endpoint = 'database'
    else if (url.pathname.startsWith('/storage/')) endpoint = 'storage'
    else if (url.pathname.startsWith('/functions/v1/')) endpoint = url.pathname.split('/')[3]
  } catch { /* Unknown URLs are passed through without retaining their text. */ }
  return measureApiRequest(endpoint, () => fetch(input, init))
}

if (typeof window !== 'undefined') window.__STUDY_LIFE_API_METRICS__ = apiMetricsSnapshot
