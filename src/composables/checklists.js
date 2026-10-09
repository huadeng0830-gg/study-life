import { touchStoredRef, useStoredRef } from './store/index.js'
import { checklistBudget, checklistItems, LIST_TYPES, normalizeChecklistItem } from './domain/checklistModel.js'

function stamp() {
  return new Date().toISOString()
}

function createId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useChecklistCommands() {
  /** @type {import('vue').Ref<import('../types/checklists').Checklist[]>} */
  const lists = useStoredRef('sl_checklists', [])
  const commit = () => touchStoredRef('sl_checklists')

  /** @param {string | null | undefined} id */
  function findList(id) {
    return lists.value.find((list) => list.id === id) || null
  }

  /** @param {import('../types/checklists').Checklist | null} list */
  function touch(list) {
    if (!list) return
    list.updatedAt = stamp()
    commit()
  }

  /** @param {Omit<Partial<import('../types/checklists').Checklist>, 'items'> & {items?: import('../types/checklists').ChecklistItemInput[]}} value */
  function createList(value = {}) {
    const name = String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    if (name.length > 80) throw new Error('清单名称不能超过 80 个字符')
    if (value.id && findList(value.id)) throw new Error('清单已存在')
    // Validate every entry before mutating storage: a bad batch must not leave half a list.
    const items = (value.items ?? []).map((item) => ({ ...normalizeChecklistItem(item), id: createId('item') }))
    const now = stamp()
    const list = {
      id: value.id || createId('list'),
      name,
      type: Object.keys(LIST_TYPES).includes(value.type || '') ? value.type || 'general' : 'general',
      budget: checklistBudget(value.budget),
      createdAt: value.createdAt || now,
      updatedAt: now,
      items,
    }
    lists.value.push(list)
    commit()
    return list
  }

  /** @param {string | null | undefined} id @param {Partial<Pick<import('../types/checklists').Checklist, 'name' | 'type' | 'budget'>>} value */
  function updateList(id, value = {}) {
    const list = findList(id)
    if (!list) return null
    const name = value.name === undefined ? list.name : String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    if (name.length > 80) throw new Error('清单名称不能超过 80 个字符')
    const budget = value.budget === undefined ? list.budget : checklistBudget(value.budget)
    const type = value.type === undefined ? list.type : Object.keys(LIST_TYPES).includes(value.type) ? value.type : 'general'
    Object.assign(list, { name, type, budget })
    touch(list)
    return list
  }

  /** @param {string | null | undefined} listId @param {import('../types/checklists').ChecklistItemInput} value */
  function createItem(listId, value = {}) {
    const list = findList(listId)
    if (!list) return null
    const item = { ...normalizeChecklistItem(value), id: value.id || createId('item') }
    if (checklistItems(list).some((entry) => entry.id === item.id)) throw new Error('事项已存在')
    list.items ??= []
    list.items.push(item)
    touch(list)
    return item
  }

  /** @param {string | null | undefined} listId @param {string | null | undefined} itemId @param {import('../types/checklists').ChecklistItemInput} value */
  function updateItem(listId, itemId, value = {}) {
    const list = findList(listId)
    const item = list?.items?.find((entry) => entry.id === itemId)
    if (!item) return null
    Object.assign(item, normalizeChecklistItem({ ...item, ...value, id: item.id }))
    touch(list)
    return item
  }

  /** @param {string | null | undefined} listId @param {string} itemId */
  function toggleItem(listId, itemId) {
    const list = findList(listId)
    const item = list?.items?.find((entry) => entry.id === itemId)
    if (!item) return null
    item.done = !item.done
    touch(list)
    return item
  }

  /** @param {string | null | undefined} id */
  function deleteList(id) {
    const index = lists.value.findIndex((list) => list.id === id)
    if (index < 0) return null
    const [item] = lists.value.splice(index, 1)
    commit()
    return { item, index }
  }

  /** @param {string | null | undefined} listId @param {string} itemId */
  function deleteItem(listId, itemId) {
    const list = findList(listId)
    const index = list?.items?.findIndex((item) => item.id === itemId) ?? -1
    if (!list || index < 0) return null
    const [item] = list.items.splice(index, 1)
    touch(list)
    return { item, index, listId }
  }

  /** @param {string | null | undefined} listId */
  function clearCompleted(listId) {
    const list = findList(listId)
    if (!list) return null
    const items = checklistItems(list).filter((item) => item.done)
    if (!items.length) return null
    const indexes = list.items.map((item, index) => item?.done ? index : -1).filter((index) => index >= 0)
    list.items = list.items.filter((item) => !item?.done)
    touch(list)
    return { items, indexes, listId }
  }

  /** @param {string | null | undefined} listId @param {import('../types/checklists').ChecklistItemInput[]} values */
  function createItems(listId, values = []) {
    const list = findList(listId)
    if (!list) return null
    const items = values.map((value) => ({ ...normalizeChecklistItem(value), id: createId('item') }))
    if (!items.length) return []
    list.items ??= []
    list.items.push(...items)
    touch(list)
    return items
  }

  /** @param {string | null | undefined} listId */
  function duplicateList(listId) {
    const list = findList(listId)
    if (!list) return null
    const base = String(list.name).slice(0, 65)
    let name = `${base}（副本）`
    let index = 2
    while (lists.value.some((entry) => entry.name === name)) name = `${base}（副本 ${index++}）`
    return createList({ name, type: list.type, budget: list.budget, items: checklistItems(list).map((item) => ({ ...item, done: false })) })
  }

  /** @param {string | null | undefined} listId @param {string[]} itemIds */
  function deleteItems(listId, itemIds = []) {
    const list = findList(listId)
    if (!list) return null
    const ids = new Set(itemIds)
    const entries = list.items.flatMap((item, index) => item && ids.has(item.id) ? [{ item, index }] : [])
    if (!entries.length) return null
    list.items = list.items.filter((item) => !ids.has(item?.id))
    touch(list)
    return { listId, entries }
  }

  /** @param {string | null | undefined} listId @param {string[]} itemIds */
  function setItemsDone(listId, itemIds = [], done = true) {
    const list = findList(listId)
    if (!list) return null
    const ids = new Set(itemIds)
    /** @type {import('../types/checklists').ChecklistStateChange[]} */
    const changes = []
    for (const item of checklistItems(list)) {
      if (!ids.has(item.id) || Boolean(item.done) === Boolean(done)) continue
      changes.push({ id: item.id, done: Boolean(item.done), nextDone: Boolean(done) })
      item.done = Boolean(done)
    }
    if (changes.length) touch(list)
    return { listId, changes }
  }

  /** @param {string | null | undefined} listId @param {import('../types/checklists').ChecklistStateChange[]} changes */
  function restoreItemStates(listId, changes = []) {
    const list = findList(listId)
    if (!list) return null
    const previous = new Map(changes.map((change) => [change.id, change]))
    for (const item of checklistItems(list)) {
      const change = previous.get(item.id)
      // Keep edits made after the action; undo restores only the completion state it changed.
      if (change && Boolean(item.done) === change.nextDone) item.done = change.done
    }
    touch(list)
    return list
  }

  /** @param {import('../types/checklists').Checklist} item @param {number} index */
  function restoreList(item, index) {
    if (!item?.id || findList(item.id)) return null
    lists.value.splice(Math.min(Math.max(0, index), lists.value.length), 0, item)
    commit()
    return item
  }

  /** @param {string | null | undefined} listId @param {{item: import('../types/checklists').ChecklistItem, index: number}[]} entries */
  function restoreItems(listId, entries = []) {
    const list = findList(listId)
    if (!list) return null
    list.items ??= []
    for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
      if (!entry?.item?.id || list.items.some((item) => item?.id === entry.item.id)) continue
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
    createItems,
    updateItem,
    toggleItem,
    deleteList,
    deleteItem,
    deleteItems,
    duplicateList,
    setItemsDone,
    restoreItemStates,
    clearCompleted,
    restoreList,
    restoreItems,
  }
}
