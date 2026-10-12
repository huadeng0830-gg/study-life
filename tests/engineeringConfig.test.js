import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const fixture = vi.hoisted(() => ({ directory: '' }))
vi.mock('vite', async (importOriginal) => {
  const vite = await importOriginal()
  return {
    ...vite,
    loadEnv: (mode, _directory, prefix) => vite.loadEnv(mode, fixture.directory, prefix),
  }
})

import configFactory from '../vite.config.js'
import { APP_VERSION, LEGACY_RELEASE_VERSION } from '../release.config.js'

beforeAll(() => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'study-life-config-release-'))
  writeFileSync(join(fixture.directory, '.env.production'), 'VITE_APP_RELEASE=fictional-emergency-release\n')
})

afterAll(() => {
  if (dirname(fixture.directory) !== tmpdir()) throw new Error('Unexpected test fixture location')
  rmSync(fixture.directory, { recursive: true, force: true })
})

describe('release configuration source of truth', () => {
  it('ignores the VITE version override and emits the legacy bridge plus structured manifest', () => {
    const config = configFactory({ mode: 'production' })
    expect(config.define['globalThis.__STUDY_LIFE_RELEASE__']).toBe(JSON.stringify(APP_VERSION))
    expect(JSON.parse(config.define['globalThis.__STUDY_LIFE_BUILD_INFO__']).sourceSignature).toMatch(/^[a-f0-9]{10}$/)
    const emitFile = vi.fn()
    config.plugins.find((plugin) => plugin.name === 'emit-release-version').generateBundle.call({ emitFile })
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: 'version.txt', source: LEGACY_RELEASE_VERSION })
    const manifest = JSON.parse(emitFile.mock.calls.find(([asset]) => asset.fileName === 'release.json')[0].source)
    expect(manifest).toMatchObject({ version: APP_VERSION, channel: 'stable', updateAction: 'refresh' })
    expect(manifest.sourceSignature).toMatch(/^[a-f0-9]{10}$/)
    expect(emitFile.mock.calls.some(([asset]) => asset.fileName === 'release-history.json')).toBe(true)
  })

  it('keeps the declared release in development mode', () => {
    const config = configFactory({ mode: 'development' })
    expect(config.define['globalThis.__STUDY_LIFE_RELEASE__']).toBe(JSON.stringify(APP_VERSION))
  })
})
