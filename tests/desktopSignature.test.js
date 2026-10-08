import { describe, expect, it } from 'vitest'
import { matchesDesktopPublisher } from '../scripts/desktop-signature.mjs'

describe('桌面更新发布者签名', () => {
  it('publisherName 必须与证书主题或其 CN 一致', () => {
    expect(matchesDesktopPublisher(['CN=Study Life'], 'CN=Study Life, O=Study Life, C=CN')).toBe(true)
    expect(matchesDesktopPublisher('Study Life', 'CN=Study Life')).toBe(true)
    expect(matchesDesktopPublisher('Another Publisher', 'CN=Study Life, O=Study Life')).toBe(false)
    expect(matchesDesktopPublisher('CN=Study Life', '')).toBe(false)
  })
})
