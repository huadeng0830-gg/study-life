import { describe, expect, it } from 'vitest'
import { isExpectedDesktopUpdateSource } from '../scripts/desktop-update-source.mjs'

describe('packaged desktop update source', () => {
  it('accepts only the canonical public repository', () => {
    expect(isExpectedDesktopUpdateSource(`
owner: huadeng0830-gg
repo: study-life
provider: github
releaseType: release
`)).toBe(true)
  })

  it('rejects the legacy feed embedded in installed v1.0.3', () => {
    expect(isExpectedDesktopUpdateSource(`
owner: huadeng0830-gg
repo: study-life-desktop-releases
provider: github
`)).toBe(false)
  })

  it('rejects the right repository with the wrong owner or provider', () => {
    expect(isExpectedDesktopUpdateSource('owner: someone-else\nrepo: study-life\nprovider: github')).toBe(false)
    expect(isExpectedDesktopUpdateSource('owner: huadeng0830-gg\nrepo: study-life\nprovider: generic')).toBe(false)
  })
})
