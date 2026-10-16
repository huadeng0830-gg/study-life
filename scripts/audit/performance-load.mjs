// Real local Workers runtime, fictional upstream only. No production load.
// npm run worker:check first, then node scripts/audit/performance-load.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare'

const root = fileURLToPath(new URL('../../', import.meta.url))
const config = JSON.parse(readFileSync(resolve(root, 'workers/public-api/wrangler.jsonc'), 'utf8'))
let calls = 0, active = 0, peak = 0
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: resolve(root, '.wrangler/public-api-build/index.js'),
  compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
  bindings: { SUPABASE_URL: 'https://fictional.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fictional', ALLOWED_ORIGINS: 'https://app.example.invalid' },
  outboundService: async request => {
    calls++; active++; peak = Math.max(peak, active)
    try {
      const url = new URL(request.url)
      await new Promise(done => setTimeout(done, 10))
      if (url.searchParams.get('offset') === '9000') return new Response(null, { status: 429, headers: { 'Retry-After': '2' } })
      assert.equal(request.headers.get('Authorization'), null)
      assert.equal(request.headers.get('Cookie'), null)
      return new Response(JSON.stringify([{ id: 'fictional-id', title: 'Fictional public content' }]), { headers: { 'Content-Range': '0-0/1' } })
    } finally { active-- }
  },
  log: new Log(LogLevel.ERROR),
}))
const fetchPublic = path => runtime.dispatchFetch('https://worker.example.invalid/v1/feedback' + path, { headers: { Origin: 'https://app.example.invalid' } })
const report = { environment: 'local workerd + 10ms fictional upstream; not a production capacity claim', stages: [] }
try {
  for (const scale of [1, 2, 5, 10]) {
    const query = `?q=fictional-stage-${scale}&view=summary&limit=1`
    const coldStart = performance.now()
    const first = await fetchPublic(query)
    assert.equal(first.status, 200)
    const singleResponseBytes = (await first.arrayBuffer()).byteLength
    const coldMs = performance.now() - coldStart
    // Cache writes use waitUntil. Measure warm and cold traffic separately.
    await new Promise(done => setTimeout(done, 30))
    const before = calls, times = []
    let done = 0, errors = 0, bytes = 0
    await Promise.all(Array.from({ length: scale }, async () => {
      while (done < scale * 20) {
        done++
        const start = performance.now()
        const response = await fetchPublic(query)
        const payloadBytes = (await response.arrayBuffer()).byteLength
        bytes += payloadBytes
        if (response.status !== 200) errors++
        times.push(performance.now() - start)
      }
    }))
    times.sort((a,b) => a-b)
    const pct = p => Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100
    assert.equal(errors, 0)
    assert.equal(bytes, times.length * singleResponseBytes, 'Concurrent byte accounting must not lose updates')
    assert.equal(calls - before, 0, 'Warm public traffic must not query the database')
    report.stages.push({ scale, concurrency: scale, requests: times.length, coldMs: Math.round(coldMs*100)/100, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), errors, responseBytes: bytes, warmUpstreamRequests: calls - before })
  }
  const failed = await fetchPublic('?offset=9000')
  assert.equal(failed.status, 429)
  await failed.arrayBuffer()
  await new Promise(done => setTimeout(done, 30))
  const before = calls
  for (let i=0; i<20; i++) {
    const result = await fetchPublic(`?q=fictional-outage-${i}`)
    assert.equal(result.status, 429)
    await result.arrayBuffer()
  }
  assert.equal(calls - before, 0, 'Cooldown must protect the upstream across public queries')
  report.failureBurst = { requests: 21, upstreamRequests: 1, automaticRetries: 0, errorResponseCached: false, cooldownMarker: 'status/deadline only' }
  report.peakUpstreamConcurrency = peak
  report.memory = process.memoryUsage()
  console.log(JSON.stringify(report, null, 2))
} finally { await runtime.dispose() }
