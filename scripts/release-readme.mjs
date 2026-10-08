export const RELEASE_STATUS_START = '<!-- RELEASE_STATUS:START -->'
export const RELEASE_STATUS_END = '<!-- RELEASE_STATUS:END -->'

export function renderReleaseStatus({ webVersion, desktopVersion, notes = [] }) {
  const safeNotes = (Array.isArray(notes) ? notes : [])
    .map((note) => String(note ?? '').replace(/\s+/g, ' ').replaceAll('-->', '--&gt;').trim())
    .filter(Boolean)

  return [
    RELEASE_STATUS_START,
    `> **当前源码版本**：网页 / PWA \`${webVersion}\` · Windows 桌面版 \`${desktopVersion}\``,
    '> **最近更新**：',
    ...safeNotes.map((note) => `> - ${note}`),
    '> [下载已发布的 Windows 安装包与版本说明](https://github.com/huadeng0830-gg/study-life/releases/latest)',
    RELEASE_STATUS_END,
  ].join('\n')
}

export function syncReleaseStatus(readme, release) {
  const content = String(readme ?? '')
  const start = content.indexOf(RELEASE_STATUS_START)
  const end = content.indexOf(RELEASE_STATUS_END)
  if (start < 0 || end < start || content.indexOf(RELEASE_STATUS_START, start + 1) >= 0 || content.indexOf(RELEASE_STATUS_END, end + 1) >= 0) {
    throw new Error('README.md 必须且只能包含一组 RELEASE_STATUS 标记')
  }

  const afterEnd = end + RELEASE_STATUS_END.length
  return `${content.slice(0, start)}${renderReleaseStatus(release)}${content.slice(afterEnd)}`
}

export function isReleaseStatusInSync(readme, release) {
  try {
    // Windows checkouts may convert README.md from LF to CRLF via core.autocrlf.
    // Compare a canonical representation so the release guard behaves the same
    // locally and on the Windows installer runner.
    const normalizedReadme = String(readme ?? '').replace(/\r\n/g, '\n')
    return syncReleaseStatus(normalizedReadme, release) === normalizedReadme
  } catch {
    return false
  }
}
