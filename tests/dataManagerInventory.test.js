// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildRestorePreview, formatDataSize, readDataInventory } from '../src/composables/dataManagerInventory.js'

function storageOf(entries) {
  const values = new Map(Object.entries(entries))
  return { get length() { return values.size }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null }
}
function archive(data) { return { providedFields: Object.keys(data), data } }

describe('数据管理概览与恢复对照', () => {
  it('只计业务记录，配置数组与账号会话不会混入记录总量', () => {
    const inventory = readDataInventory(storageOf({
      sl_tasks: '[{"id":"fiction-task"}]', sl_events: '[]', sl_expenses: '[{},{}]',
      sl_ledger_categories: '[{},{},{}]', sl_theme: '"blue"', sl_mood_log: '{"2026-10-09":{}}',
      'example-auth-session': 'fictional-session',
    }))
    expect(inventory.recordCount).toBe(4)
    expect(inventory.modules.find(mod => mod.id === 'ledger')).toMatchObject({ recordCount: 2, settingCount: 1 })
    expect(inventory.modules.find(mod => mod.id === 'atmosphere').detail).toContain('心情 1 天')
    expect(inventory.usage.keyCount).toBe(6)
  })

  it('损坏的分区有明确提示，仍可统计其它数据，原始值保持原样', () => {
    const storage = storageOf({ sl_tasks: '{invalid', sl_courses: '[{}]' })
    const inventory = readDataInventory(storage)
    expect(inventory.recordCount).toBe(1)
    expect(inventory.issues).toEqual([{ field: 'tasks', label: '待办与快速记录' }])
    expect(inventory.modules.find(mod => mod.id === 'tasks').hasIssue).toBe(true)
    expect(storage.getItem('sl_tasks')).toBe('{invalid')
  })

  it('存储权限不可用时抛出错误，调用方不会显示虚假的零记录', () => {
    const storage = { get length() { throw new Error('storage denied') } }
    expect(() => readDataInventory(storage)).toThrow('storage denied')
  })

  it('格式合法但类型错误的记录不会被误报为零记录', () => {
    const inventory = readDataInventory(storageOf({ sl_tasks: '{"invalid":"shape"}' }))
    expect(inventory.issues).toEqual([{ field: 'tasks', label: '待办与快速记录' }])
  })

  it('旧备份仅对照实际携带的字段，不把未提供的日程算作覆盖范围', () => {
    const inventory = readDataInventory(storageOf({ sl_tasks: '[{},{}]', sl_events: '[{},{},{}]' }))
    const [row] = buildRestorePreview(archive({ tasks: [{}] }), inventory)
    expect(row).toMatchObject({ id: 'tasks', backupText: '1 项记录', localText: '2 项记录', clearsRecords: false })
    expect(row.fields).toEqual(['tasks'])
  })

  it('按字段提示空记录覆盖，即使同一分区的其它记录不为空', () => {
    const inventory = readDataInventory(storageOf({ sl_tasks: '[{}]', sl_events: '[{}]' }))
    const [row] = buildRestorePreview(archive({ tasks: [], events: [{}, {}] }), inventory)
    expect(row).toMatchObject({ backupText: '2 项记录', clearsRecords: true, clearedLabels: '待办' })
  })

  it('不能读取本机数据时保留备份预览，明确告知对照数量不可用', () => {
    expect(buildRestorePreview(archive({ tasks: [] }), null)[0].localText).toBe('本机数量暂不可用')
    expect(formatDataSize(0)).toBe('0 B')
    expect(formatDataSize(2048)).toBe('2.0 KB')
    expect(formatDataSize(1024 * 1024)).toBe('1.0 MB')
  })
})
