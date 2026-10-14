import { touchStoredRef, useStoredRef } from './store/index.js'
import { checklistBudget, checklistItems, LIST_TYPES, normalizeChecklistItem } from './domain/checklistModel.js'
import { normalizeDutyMembers } from './domain/checklistDuty.js'
import { nextRepeatDueDate, normalizeTaskRepeat } from './taskRecurrence.js'

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

  function validWeekday(value) {
    const weekday = Number(value)
    return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : null
  }

  function itemForList(list, value, id) {
    const normalized = { ...normalizeChecklistItem(value), id }
    if (!list?.dutyEnabled) return normalized
    return {
      ...normalized,
      dueDate: String(value.dueDate || list.occurrenceDate || ''),
      assignedTo: String(value.assignedTo || '').trim(),
      substitutedBy: String(value.substitutedBy || '').trim(),
    }
  }

  /** @param {Omit<Partial<import('../types/checklists').Checklist>, 'items'> & {items?: import('../types/checklists').ChecklistItemInput[]}} value */
  function createList(value = {}) {
    const name = String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    if (name.length > 80) throw new Error('清单名称不能超过 80 个字符')
    if (value.id && findList(value.id)) throw new Error('清单已存在')
    const id = value.id || createId('list')
    const dutyEnabled = Boolean(value.dutyEnabled)
    const dutyMembers = dutyEnabled ? normalizeDutyMembers(value.dutyMembers) : []
    const occurrenceDate = dutyEnabled ? String(value.occurrenceDate || '') : ''
    const repeat = dutyEnabled ? normalizeTaskRepeat(value.repeat) : 'none'
    const repeatWeekday = dutyEnabled ? validWeekday(value.repeatWeekday) : null
    // Validate every entry before mutating storage: a bad batch must not leave half a list.
    const items = (value.items ?? []).map((item, index) => itemForList(dutyEnabled ? { dutyEnabled: true, occurrenceDate } : null, {
      ...item,
      ...(dutyEnabled ? {
        dueDate: item.dueDate || occurrenceDate,
        assignedTo: item.assignedTo || dutyMembers[index % Math.max(dutyMembers.length, 1)] || '',
      } : {}),
    }, createId('item')))
    const now = stamp()
    const list = {
      id,
      name,
      type: Object.keys(LIST_TYPES).includes(value.type || '') ? value.type || 'general' : 'general',
      budget: checklistBudget(value.budget),
      createdAt: value.createdAt || now,
      updatedAt: now,
      items,
      ...(dutyEnabled ? {
        dutyEnabled: true,
        dutyTemplateId: String(value.dutyTemplateId || ''),
        dutyMembers,
        dutySeriesId: String(value.dutySeriesId || id),
        occurrenceDate,
        semesterStartDate: String(value.semesterStartDate || ''),
        repeat,
        ...(repeatWeekday === null ? {} : { repeatWeekday }),
        repeatEndDate: String(value.repeatEndDate || ''),
      } : {}),
    }
    lists.value.push(list)
    commit()
    return list
  }

  /** @param {string | null | undefined} id @param {Partial<import('../types/checklists').Checklist> & {name?: string, type?: string, budget?: number | string | null}} value */
  function updateList(id, value = {}) {
    const list = findList(id)
    if (!list) return null
    const name = value.name === undefined ? list.name : String(value.name || '').trim()
    if (!name) throw new Error('请填写清单名称')
    if (name.length > 80) throw new Error('清单名称不能超过 80 个字符')
    const budget = value.budget === undefined ? list.budget : checklistBudget(value.budget)
    const type = value.type === undefined ? list.type : Object.keys(LIST_TYPES).includes(value.type) ? value.type : 'general'
    Object.assign(list, { name, type, budget })
    if (list.dutyEnabled) {
      if (value.dutyMembers !== undefined) list.dutyMembers = normalizeDutyMembers(value.dutyMembers)
      if (value.repeat !== undefined) list.repeat = normalizeTaskRepeat(value.repeat)
      if (value.repeatWeekday !== undefined) {
        const repeatWeekday = validWeekday(value.repeatWeekday)
        if (repeatWeekday === null) delete list.repeatWeekday
        else list.repeatWeekday = repeatWeekday
      }
      if (value.repeatEndDate !== undefined) list.repeatEndDate = String(value.repeatEndDate || '')
      if (value.semesterStartDate !== undefined) list.semesterStartDate = String(value.semesterStartDate || '')
    }
    touch(list)
    return list
  }

  /** @param {string | null | undefined} listId @param {import('../types/checklists').ChecklistItemInput} value */
  function createItem(listId, value = {}) {
    const list = findList(listId)
    if (!list) return null
    const item = itemForList(list, {
      ...value,
      ...(list.dutyEnabled ? { dueDate: value.dueDate || list.occurrenceDate || '' } : {}),
    }, value.id || createId('item'))
    if (checklistItems(list).some((entry) => entry.id === item.id)) throw new Error('事项已存在')
    list.items ??= []
    list.items.push(item)
    if (list.dutyEnabled) list.dutyMembers = normalizeDutyMembers([...(list.dutyMembers || []), item.assignedTo || '', item.substitutedBy || ''])
    touch(list)
    return item
  }

  /** @param {string | null | undefined} listId @param {string | null | undefined} itemId @param {import('../types/checklists').ChecklistItemInput} value */
  function updateItem(listId, itemId, value = {}) {
    const list = findList(listId)
    const item = list?.items?.find((entry) => entry.id === itemId)
    if (!list || !item) return null
    Object.assign(item, itemForList(list, { ...item, ...value, id: item.id }, item.id))
    if (list.dutyEnabled) list.dutyMembers = normalizeDutyMembers([...(list.dutyMembers || []), item.assignedTo || '', item.substitutedBy || ''])
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
    return createList({
      name, type: list.type, budget: list.budget, items: checklistItems(list).map((item) => ({
        ...item, done: false, ...(list.dutyEnabled ? { substitutedBy: '' } : {}),
      })),
      ...(list.dutyEnabled ? {
        dutyEnabled: true, dutyTemplateId: list.dutyTemplateId, dutyMembers: list.dutyMembers,
        occurrenceDate: list.occurrenceDate, semesterStartDate: list.semesterStartDate,
        repeat: list.repeat, repeatWeekday: list.repeatWeekday, repeatEndDate: list.repeatEndDate,
      } : {}),
    })
  }

  /** 通过 taskRecurrence 的 weekly 规则生成一份新的值日/班务周期清单。 */
  function createNextDutyOccurrence(listId) {
    const list = findList(listId)
    if (!list?.dutyEnabled || normalizeTaskRepeat(list.repeat) !== 'weekly') return null
    const baseDate = String(list.occurrenceDate || checklistItems(list).find((item) => item.dueDate)?.dueDate || '')
    const nextDate = nextRepeatDueDate(baseDate, list.repeat || 'weekly', { weekday: list.repeatWeekday, until: list.repeatEndDate })
    if (!nextDate) return null
    const seriesId = String(list.dutySeriesId || list.id)
    if (lists.value.some((entry) => entry.dutyEnabled && entry.dutySeriesId === seriesId && entry.occurrenceDate === nextDate)) return null
    const members = normalizeDutyMembers(list.dutyMembers)
    const rotate = (name, index) => {
      if (!members.length) return String(name || '').trim()
      const current = members.findIndex((member) => member.normalize('NFKC').toLocaleLowerCase() === String(name || '').trim().normalize('NFKC').toLocaleLowerCase())
      return members[current < 0 ? index % members.length : (current + 1) % members.length]
    }
    return createList({
      name: list.name, type: list.type, budget: list.budget,
      dutyEnabled: true, dutyTemplateId: list.dutyTemplateId, dutyMembers: members,
      dutySeriesId: seriesId, occurrenceDate: nextDate, semesterStartDate: list.semesterStartDate,
      repeat: list.repeat, repeatWeekday: list.repeatWeekday, repeatEndDate: list.repeatEndDate,
      items: checklistItems(list).map((item, index) => ({
        ...item, done: false, dueDate: nextDate, assignedTo: rotate(item.assignedTo, index), substitutedBy: '',
      })),
    })
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
    createNextDutyOccurrence,
    setItemsDone,
    restoreItemStates,
    clearCompleted,
    restoreList,
    restoreItems,
  }
}
