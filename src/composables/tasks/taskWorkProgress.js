export function taskActualMinutes(task) {
  if (task?.actualMinutes !== null && task?.actualMinutes !== undefined && task?.actualMinutes !== '') {
    const value = Number(task.actualMinutes)
    return Number.isFinite(value) ? Math.max(0, value) : 0
  }
  return Math.max(0, Number(task?.focusTotalSeconds) || 0) / 60
}

export function taskTimeComparison(task) {
  const estimate = Math.max(0, Number(task?.estimateMinutes) || 0)
  const rawActual = taskActualMinutes(task)
  const hasActual = task?.actualMinutes !== null && task?.actualMinutes !== undefined && task?.actualMinutes !== ''
    || Number(task?.focusTotalSeconds) > 0
  const actual = Math.max(0, Math.round(rawActual))
  if (estimate && hasActual) {
    const difference = actual - estimate
    const delta = difference > 0 ? `多 ${difference} 分` : difference < 0 ? `少 ${Math.abs(difference)} 分` : '用时相符'
    return `预计 ${estimate} · 实际 ${actual} 分钟（${delta}）`
  }
  if (estimate) return `预计 ${estimate} 分钟`
  if (hasActual) return `实际 ${actual} 分钟`
  return ''
}

export function parseTaskResourceLinks(value) {
  const lines = String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 12) throw new Error('资料链接最多添加 12 条。')
  const links = []
  for (const [index, raw] of lines.entries()) {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
    let url
    try { url = new URL(candidate) } catch { throw new Error(`第 ${index + 1} 条资料链接无效。`) }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error(`第 ${index + 1} 条资料链接只支持公开的 HTTP 或 HTTPS 地址。`)
    }
    if (url.href.length > 2048) throw new Error(`第 ${index + 1} 条资料链接不能超过 2048 个字符。`)
    links.push(url.href)
  }
  return [...new Set(links)]
}

/** Keep legacy/imported checkpoint data visible without exposing unsafe anchor URLs. */
export function safeTaskResourceLinks(value) {
  const links = []
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== 'string') continue
    try { links.push(...parseTaskResourceLinks(entry)) } catch { /* Ignore malformed legacy links in the display only. */ }
    if (links.length >= 12) break
  }
  return [...new Set(links)].slice(0, 12)
}

export function normalizeTaskWorkCheckpoint(value = {}) {
  const lastStep = String(value.lastStep || '').trim().slice(0, 1000)
  const blocker = String(value.blocker || '').trim().slice(0, 1000)
  const nextStep = String(value.nextStep || '').trim().slice(0, 1000)
  const resources = Array.isArray(value.resources)
    ? parseTaskResourceLinks(value.resources.join('\n'))
    : parseTaskResourceLinks(value.resources)
  if (!lastStep && !blocker && !nextStep && !resources.length) return null
  return { lastStep, blocker, nextStep, resources, updatedAt: new Date().toISOString() }
}
