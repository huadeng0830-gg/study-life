// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { cloneValue, SYNC_DEFAULTS, SYNC_KEYS } from '../src/composables/accountSyncData.js'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'

const LOCAL_ONLY_KEYS = [
  'sl_focus_active',
  'sl_last_backup_at',
  'sl_domain_schema',
  'sl_runtime_cache',
  'study_life_account_sync_mode',
  'study-life-account-sync-commit',
]

function changedValue(key) {
  const value = cloneValue(SYNC_DEFAULTS[key])
  if (Array.isArray(value)) return [...value, { id: `matrix-${key}`, title: 'matrix' }]
  if (value && typeof value === 'object') return { ...value, matrixMarker: key }
  if (typeof value === 'boolean') return !value
  if (typeof value === 'string') return `${value}-matrix`
  return `matrix-${key}`
}

let dirtyEvents = []
const collectDirtyEvent = (event) => dirtyEvents.push(event.detail)

describe('账号同步本机变更信号', () => {
  beforeEach(() => {
    localStorage.clear()
    dirtyEvents = []
    window.addEventListener('study-life:sync-dirty', collectDirtyEvent)
    vi.restoreAllMocks()
  })
  afterEach(() => window.removeEventListener('study-life:sync-dirty', collectDirtyEvent))

  it('本机界面状态写入不会触发账号同步', () => {
    const state = useStoredRef('sl_test_ui_state', { open: false })
    state.value = { open: true }
    flushStoredWrites()

    expect(JSON.parse(localStorage.getItem('sl_test_ui_state'))).toEqual({ open: true })
    expect(dirtyEvents).toEqual([])
  })

  it('真实同步键写入仍会标记 dirty', () => {
    const tasks = useStoredRef('sl_tasks', [])
    tasks.value = [{ id: 'dirty-task', title: '需要同步' }]
    flushStoredWrites()

    expect(dirtyEvents).toHaveLength(1)
    expect(dirtyEvents[0].key).toBe('sl_tasks')
  })

  it.each(SYNC_KEYS)('SYNC_KEYS 全矩阵：%s 写入会标记 dirty', async (key) => {
    dirtyEvents = []
    const state = useStoredRef(key, SYNC_DEFAULTS[key])
    state.value = changedValue(key)
    await nextTick()
    flushStoredWrites()

    expect(dirtyEvents.some((event) => event.key === key)).toBe(true)
  })

  it.each(LOCAL_ONLY_KEYS)('Local-only key %s 不得直接标记 dirty', (key) => {
    const state = useStoredRef(key, null)
    state.value = { runtime: true }
    flushStoredWrites()
    expect(dirtyEvents).toEqual([])
  })
})
