import { touchStoredRef, useStoredRef } from './store/index.js'

function stamp() {
  return new Date().toISOString()
}

function createId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useChecklistCommands() {
  const lists = useStoredRef('sl_checklists', [])
  const commit = () => touchStoredRef('sl_checklists')

  function findList(id) {
    return lists.value.find((list) => list.id === id) || null
  }

  function touch(list) {
    if (!list) return
    list.updatedAt = stamp()
    commit()
  }

  function createList(value = {}) {
    const name = String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    const list = {
      id: value.id || createId('list'),
      name,
      type: value.type || 'general',
      createdAt: value.createdAt || stamp(),
      items: [],
    }
    lists.value.push(list)
    commit()
    return list
  }

  function updateList(id, value = {}) {
    const list = findList(id)
    if (!list) return null
    const name = value.name === undefined ? list.name : String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    Object.assign(list, value, { name })
    commit()
    return list
  }

  function createItem(listId, value = {}) {
    const list = findList(listId)
    if (!list) return null
    const name = String(value.name || '').trim()
    if (!name) throw new Error('请填写物品名称')
    const item = { ...value, id: value.id || createId('item'), name, done: Boolean(value.done) }
    list.items ??= []
    list.items.push(item)
    touch(list)
    return item
  }

  function updateItem(listId, itemId, value = {}) {
    const list = findList(listId)
    const item = list?.items?.find((entry) => entry.id === itemId)
    if (!item) return null
    const name = value.name === undefined ? item.name : String(value.name || '').trim()
    if (!name) throw new Error('请填写物品名称')
    Object.assign(item, value, { name })
    touch(list)
    return item
  }

  function toggleItem(listId, itemId) {
    const list = findList(listId)
    const item = list?.items?.find((entry) => entry.id === itemId)
    if (!item) return null
    item.done = !item.done
    touch(list)
    return item
  }

  function deleteList(id) {
    const index = lists.value.findIndex((list) => list.id === id)
    if (index < 0) return null
    const [item] = lists.value.splice(index, 1)
    commit()
    return { item, index }
  }

  function deleteItem(listId, itemId) {
    const list = findList(listId)
    const index = list?.items?.findIndex((item) => item.id === itemId) ?? -1
    if (!list || index < 0) return null
    const [item] = list.items.splice(index, 1)
    touch(list)
    return { item, index }
  }

  function clearCompleted(listId) {
    const list = findList(listId)
    if (!list) return null
    const items = list.items.filter((item) => item.done)
    if (!items.length) return null
    const indexes = list.items.map((item, index) => item.done ? index : -1).filter((index) => index >= 0)
    list.items = list.items.filter((item) => !item.done)
    touch(list)
    return { items, indexes }
  }

  function restoreList(item, index) {
    if (!item?.id || findList(item.id)) return null
    lists.value.splice(Math.min(Math.max(0, index), lists.value.length), 0, item)
    commit()
    return item
  }

  function restoreItems(listId, entries = []) {
    const list = findList(listId)
    if (!list) return null
    for (const entry of entries) {
      if (!entry?.item?.id || list.items.some((item) => item.id === entry.item.id)) continue
      list.items.splice(Math.min(Math.max(0, entry.index), list.items.length), 0, entry.item)
    }
    touch(list)
    return list
  }

  return {
    lists,
    createList,
    updateList,
    createItem,
    updateItem,
    toggleItem,
    deleteList,
    deleteItem,
    clearCompleted,
    restoreList,
    restoreItems,
  }
}
