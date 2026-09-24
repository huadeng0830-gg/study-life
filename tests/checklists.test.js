// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
})
