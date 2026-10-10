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
import { RELEASE_VERSION } from '../release.config.js'

beforeAll(() => {
  fixture.directory = mkdtempSync(join(tmpdir(), 'study-life-config-release-'))
  writeFileSync(join(fixture.directory, '.env.production'), 'VITE_APP_RELEASE=fictional-emergency-release\n')
})

afterAll(() => {
  if (dirname(fixture.directory) !== tmpdir()) throw new Error('Unexpected test fixture location')
  rmSync(fixture.directory, { recursive: true, force: true })
})

describe('release configuration environment override', () => {
  it('uses the configured release for both app comparisons and version.txt', () => {
    const config = configFactory({ mode: 'production' })
    expect(config.define['globalThis.__STUDY_LIFE_RELEASE__']).toBe(JSON.stringify('fictional-emergency-release'))
    const emitFile = vi.fn()
    config.plugins.find((plugin) => plugin.name === 'emit-release-version').generateBundle.call({ emitFile })
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: 'version.txt', source: 'fictional-emergency-release' })
  })

  it('keeps the declared release when no environment override is present', () => {
    const config = configFactory({ mode: 'development' })
    expect(config.define['globalThis.__STUDY_LIFE_RELEASE__']).toBe(JSON.stringify(RELEASE_VERSION))
  })
})
