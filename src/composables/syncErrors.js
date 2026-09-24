export const MAX_RETRY_AFTER_MS = 15 * 60 * 1000

export function parseRetryAfterMs(value, now = Date.now()) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) {
    const milliseconds = Number(raw) * 1000
    return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_AFTER_MS ? milliseconds : null
  }
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return null
  const milliseconds = timestamp - now
  return milliseconds >= 0 && milliseconds <= MAX_RETRY_AFTER_MS ? milliseconds : null
}
