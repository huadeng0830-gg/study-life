import { describe, expect, it } from 'vitest'
import { backupProvidedFields, buildBackupRestoreValues } from '../src/composables/backupRestore.js'

const STORAGE_KEYS = {
  courses: 'sl_courses',
  tasks: 'sl_tasks',
  events: 'sl_events',
  quickNotes: 'sl_quick_notes',
  theme: 'sl_theme',
}

describe('旧备份恢复范围', () => {
  it('只写入备份实际包含的字段，保留后来新增模块的本机数据', () => {
    const legacy = { courses: [{ id: 'c1' }], tasks: [{ id: 't1' }], theme: 'green' }
    expect(buildBackupRestoreValues(legacy, backupProvidedFields(legacy), STORAGE_KEYS)).toEqual({
      sl_courses: [{ id: 'c1' }],
      sl_tasks: [{ id: 't1' }],
      sl_theme: 'green',
    })
  })

  it('当前备份中的显式空数组仍然代表用户要恢复为空', () => {
    const current = { courses: [], tasks: [], events: [], quickNotes: [] }
    expect(buildBackupRestoreValues(current, backupProvidedFields(current), STORAGE_KEYS)).toEqual({
      sl_courses: [],
      sl_tasks: [],
      sl_events: [],
      sl_quick_notes: [],
    })
  })

  it('不把可选配置的空值写成覆盖操作', () => {
    const backup = { theme: null }
    expect(buildBackupRestoreValues(backup, backupProvidedFields(backup), STORAGE_KEYS)).toEqual({})
  })
})
