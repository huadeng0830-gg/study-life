export function isExpectedDesktopUpdateSource(config) {
  const text = String(config ?? '')
  return /^provider:\s*github\s*$/m.test(text)
    && /^owner:\s*huadeng0830-gg\s*$/m.test(text)
    && /^repo:\s*study-life\s*$/m.test(text)
}
