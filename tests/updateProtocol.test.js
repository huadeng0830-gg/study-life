import { describe, expect, it } from 'vitest'
import { collectReleaseChanges, compareRelease, validateReleaseHistory, validateReleaseManifest } from '../src/composables/updateProtocol.js'
import { makeReleaseManifest } from './helpers/releaseFixtures.js'

describe('update release protocol', () => {
  it('compares stable SemVer and prerelease ordering while ignoring build metadata', () => {
    expect(compareRelease('1.4.0', '1.3.99')).toBe(1)
    expect(compareRelease('1.4.0-rc.2', '1.4.0-rc.1')).toBe(1)
    expect(compareRelease('1.4.0', '1.4.0-beta.9')).toBe(1)
    expect(compareRelease('1.4.0+build.2', '1.4.0+build.1')).toBe(0)
    expect(compareRelease('1.4', '1.3.0')).toBeNull()
    expect(compareRelease('v1.4.0', '1.3.0')).toBeNull()
  })

  it('validates a stable manifest and rejects channel, build, and release URL mismatches', () => {
    const manifest = makeReleaseManifest('2.0.0')
    expect(validateReleaseManifest(manifest)).toMatchObject({ version: '2.0.0', channel: 'stable' })
    expect(validateReleaseManifest({ ...manifest, version: '2.0.0-beta.1' })).toBeNull()
    expect(validateReleaseManifest({ ...manifest, channel: 'beta' })).toBeNull()
    expect(validateReleaseManifest({ ...manifest, buildId: '../outside' })).toBeNull()
    expect(validateReleaseManifest({ ...manifest, releaseUrl: 'https://evil.invalid/update' })).toBeNull()
    expect(validateReleaseManifest({ ...manifest, changes: { features: ['ok'] } })).toBeNull()
  })

  it('按用户实际版本范围汇总更新并去掉重复内容', () => {
    const categories = (features = []) => ({ features, improvements: [], fixes: [], security: [], breaking: [] })
    const history = validateReleaseHistory([
      { version: '1.0.5', channel: 'stable', changes: categories(['already installed']), notes: [] },
      { version: '1.1.0', channel: 'stable', changes: categories(['New calendar view']), notes: [] },
      { version: '1.2.0', channel: 'stable', changes: categories(['New calendar view', 'Offline edit queue']), notes: [] },
      { version: '1.3.0', channel: 'stable', changes: categories(['future change']), notes: [] },
    ])
    const updates = collectReleaseChanges(history, '1.0.5', '1.2.0')
    expect(updates.map(({ version }) => version)).toEqual(['1.1.0', '1.2.0'])
    expect(updates[1].changes.features).toEqual(['Offline edit queue'])
    expect(collectReleaseChanges(history, '1.2.0', '1.1.0')).toEqual([])
  })

  it('rejects malformed or duplicated history without executing or interpreting note text', () => {
    const entry = { version: '1.1.0', channel: 'stable', changes: { features: [], improvements: [], fixes: [], security: [], breaking: [] },
      notes: ['<img src=x onerror=alert(1)>'] }
    expect(validateReleaseHistory([entry, entry])).toBeNull()
    expect(validateReleaseHistory([entry])[0].notes[0]).toBe('<img src=x onerror=alert(1)>')
  })
})
