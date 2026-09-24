// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { localChanged, markLocalChanged } from '../src/composables/cloudSync.js'
import { cloneValue, SYNC_DEFAULTS, SYNC_KEYS } from '../src/composables/cloudSyncData.js'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'

const LOCAL_ONLY_KEYS = [
  'sl_focus_active',
  'sl_last_backup_at',
  'sl_domain_schema',
  'sl_sync_status',
  'sl_leader_lease',
  'sl_last_checked_at',
  'sl_sync_retry',
  'sl_pairing_ui',
  'sl_runtime_cache',
]

function changedValue(key) {
  const value = cloneValue(SYNC_DEFAULTS[key])
  if (Array.isArray(value)) return [...value, { id: `matrix-${key}`, title: 'matrix' }]
  if (value && typeof value === 'object') return { ...value, matrixMarker: key }
  if (typeof value === 'boolean') return !value
  if (typeof value === 'string') return `${value}-matrix`
  return `matrix-${key}`
}

describe('同步 dirty allowlist', () => {
  beforeEach(() => {
    localStorage.clear()
    localChanged.value = false
    vi.restoreAllMocks()
  })

  it('本地 UI 状态写入不会标记业务同步 dirty', () => {
    const state = useStoredRef('sl_test_ui_state', { open: false })
    state.value = { open: true }
    flushStoredWrites()

    expect(JSON.parse(localStorage.getItem('sl_test_ui_state'))).toEqual({ open: true })
    expect(localChanged.value).toBe(false)
  })

  it('真实同步键写入仍会标记 dirty', () => {
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'dirty-task', title: '需要同步' }]
    flushStoredWrites()

    expect(localChanged.value).toBe(true)
  })

  it.each(SYNC_KEYS)('SYNC_KEYS 全矩阵：%s 写入会标记 dirty', async (key) => {
    localChanged.value = false
    const state = useStoredRef(key, SYNC_DEFAULTS[key])
    state.value = changedValue(key)
    await nextTick()
    flushStoredWrites()

    expect(localChanged.value).toBe(true)
  })

  it.each(LOCAL_ONLY_KEYS)('Local-only key %s 不得直接标记 dirty', (key) => {
    localChanged.value = false
    markLocalChanged(key, JSON.stringify({ runtime: true }))

    expect(localChanged.value).toBe(false)
  })
})
