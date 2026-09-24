// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmergencyBackup } from '../src/composables/emergencyExport.js'
import { initializeDataVault } from '../src/composables/dataVault.js'
import { sanitizeSyncPayload, SYNC_KEYS, SYNC_MODULES } from '../src/composables/cloudSyncData.js'
import { buildEntityManifest } from '../src/composables/syncMetadata.js'

const projectRoot = resolve(import.meta.dirname, '..')
const source = (file) => readFileSync(resolve(projectRoot, file), 'utf8')

describe('Courier absence regression', () => {
  beforeEach(() => localStorage.clear())

  it('removes the route, preload, navigation, cache name and active data registrations', () => {
    expect(source('src/main.js')).not.toMatch(/courier/i)
    expect(source('src/router/routePreload.js')).not.toMatch(/courier/i)
    expect(source('src/components/Sidebar.vue')).not.toMatch(/快递|courier/i)
    expect(source('src/App.vue')).not.toMatch(/courier/i)
    expect(source('vite.config.js')).not.toMatch(/CourierView/i)
    expect(SYNC_KEYS).not.toContain('sl_courier_bookmarks')
    expect(SYNC_MODULES.some((module) => module.key === 'courier')).toBe(false)
    expect(buildEntityManifest({ sl_courier_bookmarks: [{ id: 'legacy' }] }).entities.sl_courier_bookmarks).toBeUndefined()
  })

  it('ignores legacy remote fields and never emits them in emergency backup', () => {
    const payload = sanitizeSyncPayload({
      sl_courier_bookmarks: [{ id: 'legacy' }],
      sl_courier_recent_carriers: ['sf'],
      sl_tasks: [],
    })
    expect(payload.values).toEqual({ sl_tasks: [] })

    localStorage.setItem('sl_courier_bookmarks', JSON.stringify([{ id: 'legacy' }]))
    localStorage.setItem('sl_courier_recent_carriers', JSON.stringify(['sf']))
    localStorage.setItem('sl_courier_local_meta', JSON.stringify({ legacy: true }))
    expect(createEmergencyBackup().data).not.toHaveProperty('courierBookmarks')
    expect(createEmergencyBackup().data).not.toHaveProperty('courierRecentCarriers')
    expect(createEmergencyBackup().data).not.toHaveProperty('courierLocalMeta')
  })

  it('cleans exact legacy local keys when no Vault exists', async () => {
    const previousIndexedDb = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    for (const key of ['sl_courier_bookmarks', 'sl_courier_recent_carriers', 'sl_courier_local_meta']) {
      localStorage.setItem(key, JSON.stringify({ legacy: true }))
    }
    await initializeDataVault()
    expect(localStorage.getItem('sl_courier_bookmarks')).toBeNull()
    expect(localStorage.getItem('sl_courier_recent_carriers')).toBeNull()
    expect(localStorage.getItem('sl_courier_local_meta')).toBeNull()
    if (previousIndexedDb === undefined) delete globalThis.indexedDB
    else Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: previousIndexedDb })
  })
})
