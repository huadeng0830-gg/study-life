// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createEmergencyBackup } from '../src/composables/emergencyExport.js'
import { SYNC_KEYS, sanitizeSyncPayload } from '../src/composables/accountSyncData.js'
import { buildEntityManifest } from '../src/composables/syncMetadata.js'
import { ACCOUNT_SYNC_DATA_SCHEMA_VERSION } from '../src/composables/accountSyncSchema.js'

describe('Schedule note protection', () => {
  beforeEach(() => localStorage.clear())

  it('treats the visible schedule note as v4 business data in backup and sync', () => {
    localStorage.setItem('sl_schedule_note', JSON.stringify('下周调课，带实验报告'))
    expect(createEmergencyBackup().data.scheduleNote).toBe('下周调课，带实验报告')
    expect(SYNC_KEYS).toContain('sl_schedule_note')
    expect(sanitizeSyncPayload({ sl_schedule_note: '下周调课', sl_tasks: [] }).values).toEqual({ sl_schedule_note: '下周调课', sl_tasks: [] })
    expect(buildEntityManifest({ sl_schedule_note: '下周调课' }).singletons.sl_schedule_note).toBeTruthy()
    expect(ACCOUNT_SYNC_DATA_SCHEMA_VERSION).toBe(7)
  })
})
