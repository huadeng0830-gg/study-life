// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

describe('生活清单领域命令', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('集中处理条目增改、完成、删除与原位恢复', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const checklists = useChecklistCommands()
    const list = checklists.createList({ id: 'list-1', name: '返校准备' })
    const first = checklists.createItem(list.id, { id: 'item-1', name: '校园卡' })
    const second = checklists.createItem(list.id, { id: 'item-2', name: '充电器' })

    checklists.updateItem(list.id, first.id, { name: '校园一卡通', quantity: 2 })
    checklists.toggleItem(list.id, first.id)
    const deleted = checklists.deleteItem(list.id, first.id)

    expect(deleted).toMatchObject({ item: { id: first.id, done: true }, index: 0 })
    expect(list.items.map((item) => item.id)).toEqual([second.id])

    checklists.restoreItems(list.id, [{ item: deleted.item, index: deleted.index }])
    expect(list.items.map((item) => item.id)).toEqual([first.id, second.id])
    expect(list.items[0]).toMatchObject({ name: '校园一卡通', quantity: 2, done: true })
    expect(list.updatedAt).toEqual(expect.any(String))
  })

  it('清除已完成条目及删除清单都能按原顺序撤销', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const checklists = useChecklistCommands()
    const firstList = checklists.createList({ id: 'list-1', name: '采购' })
    const secondList = checklists.createList({ id: 'list-2', name: '旅行' })
    checklists.createItem(firstList.id, { id: 'item-1', name: '牛奶', done: true })
    checklists.createItem(firstList.id, { id: 'item-2', name: '面包' })
    checklists.createItem(firstList.id, { id: 'item-3', name: '水果', done: true })

    const cleared = checklists.clearCompleted(firstList.id)
    expect(firstList.items.map((item) => item.id)).toEqual(['item-2'])

    checklists.restoreItems(firstList.id, cleared.items.map((item, index) => ({ item, index: cleared.indexes[index] })))
    expect(firstList.items.map((item) => item.id)).toEqual(['item-1', 'item-2', 'item-3'])

    const deleted = checklists.deleteList(firstList.id)
    expect(checklists.lists.value.map((list) => list.id)).toEqual([secondList.id])
    checklists.restoreList(deleted.item, deleted.index)
    expect(checklists.lists.value.map((list) => list.id)).toEqual([firstList.id, secondList.id])
  })

  it('批量添加与模板创建先校验全部数据，失败不会部分写入', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({ name: '虚构采购', type: 'shopping' })
    expect(() => commands.createItems(list.id, [{ name: '水果' }, { name: '蔬菜', quantity: -1 }])).toThrow('数量')
    expect(list.items).toEqual([])
    expect(() => commands.createList({ name: '无效模板', items: [{ name: '文具' }, { name: '' }] })).toThrow('事项名称')
    expect(commands.lists.value).toHaveLength(1)
    const items = commands.createItems(list.id, [{ name: ' 水果 ', quantity: 0.5, unit: 'kg', price: 12.5 }, { name: '纸巾', price: '' }])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ name: '水果', quantity: 0.5, price: 12.5, done: false })
    expect(items[1].price).toBe('')
    const { flushStoredWrites } = await import('../src/composables/store/index.js')
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem('sl_checklists'))[0].items).toHaveLength(2)
  })

  it('非法数量、价格和预算被拒绝，修改失败保留原数据', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({ name: '示例清单', budget: 20 })
    const item = commands.createItem(list.id, { name: '文具', quantity: 2, price: 3 })
    for (const quantity of ['', 0, -2, Infinity, 'NaN']) expect(() => commands.updateItem(list.id, item.id, { quantity })).toThrow('数量')
    for (const price of [-1, Infinity, 'abc']) expect(() => commands.updateItem(list.id, item.id, { price })).toThrow('单价')
    expect(() => commands.updateList(list.id, { name: '被拒绝的修改', budget: -1 })).toThrow('预算')
    expect(list).toMatchObject({ name: '示例清单', budget: 20 })
    expect(item).toMatchObject({ quantity: 2, price: 3 })
  })

  it('复制清单使用独立 ID，保留详情并重置完成状态', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const original = commands.createList({ name: '虚构采购', type: 'shopping', budget: 100, items: [{ name: '牛奶', done: true, quantity: 2, price: 10, note: '示例规格' }] })
    const copy = commands.duplicateList(original.id)
    const nextCopy = commands.duplicateList(original.id)
    expect(copy.id).not.toBe(original.id)
    expect(copy.items[0].id).not.toBe(original.items[0].id)
    expect(copy).toMatchObject({ name: '虚构采购（副本）', type: 'shopping', budget: 100 })
    expect(copy.items[0]).toMatchObject({ name: '牛奶', done: false, quantity: 2, price: 10, note: '示例规格' })
    expect(nextCopy.name).toBe('虚构采购（副本 2）')
    commands.updateItem(copy.id, copy.items[0].id, { note: '新的规格' })
    expect(original.items[0]).toMatchObject({ done: true, note: '示例规格' })
  })

  it('批量删除记录原清单及顺序，撤销不会混入其他清单', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({ name: '示例甲', items: [{ name: '一' }, { name: '二' }, { name: '三' }, { name: '四' }] })
    const other = commands.createList({ name: '示例乙' })
    const deleted = commands.deleteItems(list.id, [list.items[2].id, list.items[0].id])
    expect(deleted.listId).toBe(list.id)
    commands.createItem(list.id, { name: '五' })
    commands.restoreItems(deleted.listId, [...deleted.entries].reverse())
    commands.restoreItems(deleted.listId, deleted.entries)
    expect(list.items.map((item) => item.name)).toEqual(['一', '二', '三', '四', '五'])
    expect(other.items).toEqual([])
    commands.deleteList(list.id)
    expect(commands.restoreItems(deleted.listId, deleted.entries)).toBeNull()
  })

  it('重置和批量完成只撤销本次状态变化，不覆盖后续详情修改', async () => {
    const { useChecklistCommands } = await import('../src/composables/checklists.js')
    const commands = useChecklistCommands()
    const list = commands.createList({ name: '示例整理', items: [{ name: '桌面', done: true }, { name: '衣柜', done: false }, { name: '地面', done: true }] })
    const reset = commands.setItemsDone(list.id, list.items.map((item) => item.id), false)
    expect(reset.changes).toHaveLength(2)
    commands.updateItem(list.id, list.items[0].id, { note: '后来补充的备注' })
    commands.restoreItemStates(reset.listId, reset.changes)
    expect(list.items.map((item) => item.done)).toEqual([true, false, true])
    expect(list.items[0].note).toBe('后来补充的备注')
    const completed = commands.setItemsDone(list.id, [list.items[1].id], true)
    commands.toggleItem(list.id, list.items[1].id)
    commands.restoreItemStates(completed.listId, completed.changes)
    expect(list.items[1].done).toBe(false)
  })
})
