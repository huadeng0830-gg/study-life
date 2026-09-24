const endpoint = process.env.SYNC_HEALTH_URL || 'https://study-life.pages.dev/api/sync/health'
const attempts = 5
let healthy = false
let failureMessage = '未知错误'

for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const body = await response.json().catch(() => ({}))
    if (response.ok && body.ok && body.mode === 'do' && Number(body.protocolVersion) >= 2) {
      console.log(`Sync health OK: protocol v${body.protocolVersion}`)
      healthy = true
      break
    }
    failureMessage = body.error || `HTTP ${response.status}`
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : String(error)
  }
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000))
}

if (!healthy) {
  console.error(`Sync health failed: ${failureMessage}`)
  process.exitCode = 1
}
