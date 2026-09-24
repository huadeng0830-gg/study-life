import { touchStoredRef, useStoredRef } from '../store/index.js'
import { createNextWeeklyTask } from '../taskRecurrence.js'
import { classifyTask } from '../smartClassify.js'
import { amountToCents, classifyTransaction, isRefundTransaction, normalizeAmount, normalizeLedgerTime } from '../ledger.js'
// 新增可选字段的来源：币种（多币种记账）与分摊（报销分摊）。
// 两个模块都只做纯规范化，不反向依赖这里，所以不会形成循环导入。
import { normalizeCurrency } from '../ledgerFx.js'
import { normalizeSplit, validateSplit } from '../ledgerSplit.js'
import { transactionBillId } from '../ledgerRelations.js'
import { detachCourseRelations } from './relations.js'
import { defaultAccount, defaultReminderMinutes, policyDateKey, policyTimeKey } from '../settingsPolicy.js'
import { clearTombstone, recordTombstone } from '../syncMetadata.js'

let lastStamp = 0
function stamp() {
  const now = Date.now()
  lastStamp = Math.max(now, lastStamp + 1)
  return new Date(lastStamp).toISOString()
}
function createId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint32Array(2))
  if (bytes) return `${prefix}-${bytes[0].toString(36)}${bytes[1].toString(36)}`
  return `${prefix}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}
function origin(value = {}) { return { createdFrom: value.createdFrom || 'manual', sourceType: value.sourceType || '', sourceId: value.sourceId || '', relationId: value.relationId || '' } }
function dateParts(value) { return String(value || '').split('-').map(Number) }
function validDateKey(value) {
  const text = String(value || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const [year, month, day] = dateParts(text)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
function addDaysKey(value, count) {
  const [year, month, day] = dateParts(value)
  const date = new Date(Date.UTC(year, month - 1, day + count))
  return date.toISOString().slice(0, 10)
}
function addMonthsKey(value, count) {
  const [year, month, day] = dateParts(value)
  const target = new Date(Date.UTC(year, month - 1 + count, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}
function nextBillDate(bill) {
  const advance = (date) => bill.cycle === 'weekly' ? addDaysKey(date, 7)
    : bill.cycle === 'quarterly' ? addMonthsKey(date, 3)
      : bill.cycle === 'yearly' ? addMonthsKey(date, 12)
        : bill.cycle === 'once' ? date : addMonthsKey(date, 1)
  let cursor = bill.nextDate
  let next = advance(cursor)
  const today = policyDateKey()
  while (next <= today && bill.cycle !== 'once') {
    cursor = next
    next = advance(cursor)
  }
  return next
}
function archiveItem(list, id, { inactive = false } = {}) {
  const item = list.value.find((entry) => entry.id === id)
  if (!item) return null
  item.archivedAt = item.archivedAt || stamp()
  if (inactive) item.active = false
  item.updatedAt = stamp()
  return item
}

function restoreItem(list, id, { active = false } = {}) {
  const item = list.value.find((entry) => entry.id === id)
  if (!item) return null
  item.archivedAt = null
  if (active) item.active = true
  item.updatedAt = stamp()
  return item
}

function restoreDeletedItem(list, entityType, entity) {
  if (!entity?.id) return null
  const existing = list.value.find((item) => item.id === entity.id)
  if (existing) return existing
  const restored = { ...entity, archivedAt: null, updatedAt: stamp() }
  delete restored.deletedAt
  delete restored.tombstone
  list.value.push(restored)
  clearTombstone(entityType, restored.id)
  return restored
}

export function useDomainCommands() {
  const tasks = useStoredRef('sl_tasks', []); const courses = useStoredRef('sl_courses', []); const milestones = useStoredRef('sl_exams', []); const bills = useStoredRef('sl_bills', []); const transactions = useStoredRef('sl_expenses', []); const events = useStoredRef('sl_events', []); const notes = useStoredRef('sl_quick_notes', []); const focusSessions = useStoredRef('sl_focus_sessions', [])
  const commitTasks = () => touchStoredRef('sl_tasks')
  const commitTransactions = () => touchStoredRef('sl_expenses')
  const commitNotes = () => touchStoredRef('sl_quick_notes')
  const commitEvents = () => touchStoredRef('sl_events')
  const commitMilestones = () => touchStoredRef('sl_exams')
  const commitBills = () => touchStoredRef('sl_bills')
  const commitFocusSessions = () => touchStoredRef('sl_focus_sessions')
  const commitCourses = () => touchStoredRef('sl_courses')
  function createTask(value) { const now = stamp(); const task = classifyTask({ id: value.id || createId('t'), title: String(value.title || '').trim(), done: false, status: 'pending', createdAt: now, updatedAt: now, course: value.course || '', courseId: value.courseId || '', dueDate: value.dueDate || '', dueTime: value.dueTime || '', priority: value.priority || 'normal', note: value.note || '', sourceText: value.sourceText || '', estimateMinutes: Number(value.estimateMinutes) || 0, reminderMinutes: defaultReminderMinutes('task', value.reminderMinutes), repeat: value.repeat || 'none', kind: value.kind || 'todo', ...origin(value) }, courses.value); if (!task.title) throw new Error('请填写待办内容'); tasks.value.push(task); commitTasks(); return task }
  // 生成周重复的下一期。
  // 只有真的生成了才写 repeatGeneratedAt —— 原来先写标记再生成，
  // 一旦 createNextWeeklyTask 返回 null（dueDate 非法等），这个待办
  // 就带着"已生成"的标记永远不再尝试。
  function spawnNextWeeklyTask(item) {
    const now = stamp()
    const next = createNextWeeklyTask(item)
    if (!next) return false
    item.repeatGeneratedAt = now
    tasks.value.push({ ...next, status: 'pending', updatedAt: now, createdFrom: item.createdFrom || 'manual', sourceType: 'task-repeat', sourceId: item.id })
    return true
  }
  function updateTask(id, value) { const item = tasks.value.find((task) => task.id === id); if (!item) return null; Object.assign(item, value, { updatedAt: stamp() }); if (item.done === true && item.repeat === 'weekly' && item.dueDate && !item.repeatGeneratedAt) spawnNextWeeklyTask(item); commitTasks(); return item }
  function toggleTask(id) { const item = tasks.value.find((task) => task.id === id); if (!item) return null; const now = stamp(); item.done = !item.done; item.status = item.done ? 'completed' : 'pending'; item.completedAt = item.done ? now : null; item.updatedAt = now; if (item.done && item.repeat === 'weekly' && item.dueDate && !item.repeatGeneratedAt) spawnNextWeeklyTask(item); commitTasks(); return item }
  function deleteTask(id) {
    const index = tasks.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const deleted = tasks.value.splice(index, 1)[0]
    commitTasks()
    recordTombstone('Task', id, { entity: deleted })
    return deleted
  }
  function restoreDeletedTask(entity) {
    const restored = restoreDeletedItem(tasks, 'Task', entity)
    if (restored) commitTasks()
    return restored
  }
  function createMilestone(value) { const now = stamp(); const item = { id: value.id || createId('e'), name: String(value.name || value.title || '').trim(), date: value.date || '', time: value.time || '', location: value.location || '', category: value.category || '学习', repeat: value.repeat || 'none', pinned: Boolean(value.pinned), courseId: value.courseId || '', courseName: value.courseName || value.course || '', reviewProgress: Number(value.reviewProgress) || 0, reminderMinutes: defaultReminderMinutes('milestone', value.reminderMinutes), kind: value.kind || 'countdown', createdAt: now, updatedAt: now, ...origin(value) }; if (!item.name || !item.date) throw new Error('请补充名称和目标日期'); milestones.value.push(item); commitMilestones(); return item }
  function updateMilestone(id, value) { const item = milestones.value.find((entry) => entry.id === id); if (!item) return null; Object.assign(item, value, { updatedAt: stamp() }); commitMilestones(); return item }
  const milestoneRestoreRelations = new Map()
  function deleteMilestone(id) {
    const index = milestones.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [milestone] = milestones.value.splice(index, 1)
    commitMilestones()
    milestoneRestoreRelations.set(id, tasks.value
      .filter((task) => task.sourceType === 'milestone-review' && task.sourceId === id)
      .map((task) => ({ id: task.id, sourceType: task.sourceType, sourceId: task.sourceId, relationId: task.relationId })))
    const now = stamp()
    tasks.value = tasks.value.map((task) => {
      if (task.sourceType !== 'milestone-review' || task.sourceId !== id) return task
      return { ...task, sourceType: '', sourceId: '', relationId: '', updatedAt: now }
    })
    commitTasks()
    recordTombstone('Milestone', id, { entity: milestone })
    return milestone
  }
  function restoreDeletedMilestone(entity) {
    const restored = restoreDeletedItem(milestones, 'Milestone', entity)
    if (!restored) return null
    const relations = milestoneRestoreRelations.get(restored.id) || []
    const now = stamp()
    for (const relation of relations) {
      const task = tasks.value.find((item) => item.id === relation.id)
      if (!task || task.sourceType || task.sourceId) continue
      Object.assign(task, relation, { updatedAt: now })
    }
    commitTasks()
    commitMilestones()
    milestoneRestoreRelations.delete(restored.id)
    return restored
  }
  function createEvent(value) { const now = stamp(); const item = { id: value.id || createId('event'), title: String(value.title || '').trim(), date: value.date || '', time: value.time || '', endTime: value.endTime || '', location: value.location || '', courseId: value.courseId || '', courseName: value.courseName || value.course || '', note: value.note || '', sourceText: value.sourceText || '', normalizedText: value.normalizedText || '', noticeType: value.noticeType || '', reminderMinutes: defaultReminderMinutes('event', value.reminderMinutes), createdAt: now, updatedAt: now, ...origin(value) }; if (!item.title) throw new Error('请填写日程内容'); events.value.push(item); commitEvents(); return item }
  function createNote(value) { const now = stamp(); const content = String(value.content || value.note || value.title || '').trim(); const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''; const autoTitle = firstLine || content.replace(/\s+/g, ' '); const title = String(value.title || '').trim() || autoTitle.slice(0, 42); const item = { id: value.id || createId('note'), title: title.slice(0, 42), content, courseId: value.courseId || '', courseName: value.courseName || value.course || '', sourceText: value.sourceText || value.raw || content, tags: Array.isArray(value.tags) ? value.tags : [], createdAt: now, updatedAt: now, ...origin(value) }; if (!item.content) throw new Error('请填写笔记内容'); notes.value.unshift(item); commitNotes(); return item }
  function updateNote(id, value) { const item = notes.value.find((note) => note.id === id); if (!item) return null; Object.assign(item, value, { updatedAt: stamp() }); commitNotes(); return item }
  function deleteNote(id) {
    const index = notes.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [note] = notes.value.splice(index, 1)
    const now = stamp()
    tasks.value = tasks.value.map((task) => task.sourceType === 'note' && task.sourceId === id ? { ...task, sourceType: '', sourceId: '', relationId: '', updatedAt: now } : task)
    commitTasks()
    events.value = events.value.map((event) => event.sourceType === 'note' && event.sourceId === id ? { ...event, sourceType: '', sourceId: '', relationId: '', updatedAt: now } : event)
    commitEvents()
    commitNotes()
    recordTombstone('Note', id, { entity: note })
    return note
  }
  function createTransaction(value = {}) {
    const now = stamp()
    const direction = value.direction === 'income' || value.type === 'income' ? 'income' : 'expense'
    const amount = normalizeAmount(value.amount)
    const name = String(value.name || value.title || '').trim() || (direction === 'income' ? '收入' : '日常支出')
    const date = value.date || policyDateKey(now)
    const time = normalizeLedgerTime(value.time === undefined || value.time === null || value.time === '' ? policyTimeKey(now) : value.time)
    if (amount === null) throw new Error('金额需大于 0，且最多保留两位小数')
    if (!validDateKey(date)) throw new Error('日期格式不正确')
    if (time === null) throw new Error('时间格式不正确')
    // 多币种：只有真的传了合法币种才写入字段；旧记录/旧调用方不带这个字段 = 基准币种。
    // 空字符串（用户切回基准币种）也不写入，避免在数据里留下无意义的空字段。
    const currency = normalizeCurrency(value.currency)
    // 分摊：没传就不写字段（未分摊）；传了就必须合法，不合法直接抛错而不是静默存半坏数据。
    const hasSplitInput = value.split !== undefined && value.split !== null
    if (hasSplitInput && !validateSplit(value.split).ok) {
      throw new Error(`分摊数据不合法：${validateSplit(value.split).issues[0]}`)
    }
    const item = {
      id: value.id || createId('ex'), name, amount,
      cat: value.cat || value.category || classifyTransaction(name, { direction }).categoryId, date,
      time, note: String(value.note || '').trim(),
      account: defaultAccount(value.account), direction,
      source: value.source || value.createdFrom || 'manual',
      billId: value.billId || '', billingPeriodKey: value.billingPeriodKey || '',
      ...(currency ? { currency } : {}),
      ...(hasSplitInput ? { split: normalizeSplit(value.split) } : {}),
      createdAt: now, updatedAt: now, ...origin(value),
    }
    transactions.value.push(item)
    commitTransactions()
    return item
  }
  function updateTransaction(id, value = {}) {
    const item = transactions.value.find((entry) => entry.id === id)
    if (!item) return null
    const direction = value.direction === 'income' || value.type === 'income' ? 'income' : value.direction === 'expense' || value.type === 'expense' ? 'expense' : item.direction || 'expense'
    const amount = value.amount === undefined ? normalizeAmount(item.amount) : normalizeAmount(value.amount)
    const name = value.name === undefined && value.title === undefined
      ? String(item.name || '').trim()
      : String(value.name ?? value.title ?? '').trim() || (direction === 'income' ? '收入' : '日常支出')
    const date = value.date === undefined ? item.date : value.date
    const time = value.time === undefined ? item.time : normalizeLedgerTime(value.time)
    if (amount === null) throw new Error('金额需大于 0，且最多保留两位小数')
    if (!validDateKey(date)) throw new Error('日期格式不正确')
    if (time === null) throw new Error('时间格式不正确')
    if (value.split !== undefined && value.split !== null && !validateSplit(value.split).ok) {
      throw new Error(`分摊数据不合法：${validateSplit(value.split).issues[0]}`)
    }
    Object.assign(item, {
      name, amount, direction, date,
      ...(value.cat !== undefined || value.category !== undefined ? { cat: value.cat || value.category || 'other' } : {}),
      ...(value.time !== undefined ? { time } : {}),
      ...(value.note !== undefined ? { note: String(value.note || '').trim() } : {}),
      ...(value.account !== undefined ? { account: String(value.account || '').trim() } : {}),
      // 多币种与分摊都是可选字段：只有调用方显式传了才动它们。
      // 传 `currency: ''` 表示切回基准币种；传 `split: null` 表示取消分摊。
      ...(value.currency !== undefined ? { currency: normalizeCurrency(value.currency) } : {}),
      ...(value.split !== undefined ? { split: normalizeSplit(value.split) } : {}),
      updatedAt: stamp(),
    })
    commitTransactions()
    return item
  }
  function deleteTransaction(id) {
    const item = transactions.value.find((entry) => entry.id === id)
    if (!item) return null
    const bill = bills.value.find((entry) => entry.id === transactionBillId(item))
    if (bill && item.billingPeriodKey) {
      return { blocked: true, reason: '这是固定账单的支付记录，请使用“撤销支付”，避免账单状态与账本不一致。' }
    }
    const index = transactions.value.findIndex((entry) => entry.id === id)
    const [deleted] = transactions.value.splice(index, 1)
    commitTransactions()
    recordTombstone('Transaction', id, { entity: deleted })
    return deleted
  }
  function restoreDeletedTransaction(entity) {
    const restored = restoreDeletedItem(transactions, 'Transaction', entity)
    if (restored) commitTransactions()
    return restored
  }
  function refundTransaction(id, value = {}) {
    const original = transactions.value.find((entry) => entry.id === id)
    if (!original) return { blocked: true, reason: '找不到要退款的记录。' }
    if (isRefundTransaction(original)) return { blocked: true, reason: '退款记录不能再次退款。' }
    if (original.direction === 'income') return { blocked: true, reason: '只有支出记录可以退款。' }
    if (transactionBillId(original) || original.billingPeriodKey || original.source === 'bill') {
      return { blocked: true, reason: '固定账单的支付记录请使用「撤销支付」处理。' }
    }
    const amount = normalizeAmount(value.amount)
    if (amount === null) return { blocked: true, reason: '退款金额需大于 0，且最多保留两位小数。' }
    const originalCents = amountToCents(original.amount) ?? 0
    const alreadyCents = transactions.value
      .filter((entry) => isRefundTransaction(entry) && entry.refundOf === id && !entry?.archivedAt && !entry?.deletedAt && !entry?.tombstone)
      .reduce((sum, entry) => sum + (amountToCents(entry.amount) ?? 0), 0)
    const amountCents = amountToCents(amount) ?? 0
    if (amountCents > originalCents - alreadyCents) {
      return { blocked: true, reason: `退款金额不能超过剩余可退 ¥${((originalCents - alreadyCents) / 100).toFixed(2)}。` }
    }
    const now = stamp()
    const item = {
      id: createId('ex'),
      name: value.name ? String(value.name).trim() : original.name,
      amount,
      cat: original.cat || 'other',
      date: validDateKey(value.date) ? value.date : policyDateKey(now),
      time: normalizeLedgerTime(value.time === undefined || value.time === null || value.time === '' ? policyTimeKey(now) : value.time) || '',
      note: String(value.note ?? '').trim() || '退款冲抵原支出',
      account: value.account && String(value.account).trim() ? String(value.account).trim() : original.account || '',
      direction: 'refund',
      refundOf: id,
      source: value.source || 'refund',
      createdAt: now, updatedAt: now, ...origin(value),
    }
    transactions.value.push(item)
    commitTransactions()
    return item
  }
  function undoBillPayment(id) {
    const item = transactions.value.find((entry) => entry.id === id)
    if (!item || !item.billingPeriodKey) return null
    const bill = bills.value.find((entry) => entry.id === transactionBillId(item))
    const hasLaterPayment = bill && transactions.value.some((entry) => (
      entry.id !== item.id
      && !entry?.archivedAt && !entry?.deletedAt && !entry?.tombstone
      && transactionBillId(entry) === bill.id
      && entry.billingPeriodKey
      && entry.billingPeriodKey > item.billingPeriodKey
    ))
    if (hasLaterPayment) return { blocked: true, reason: '请先撤销更晚一期的账单支付。' }
    const index = transactions.value.findIndex((entry) => entry.id === id)
    const [deleted] = transactions.value.splice(index, 1)
    commitTransactions()
    recordTombstone('Transaction', id, { entity: deleted })
    if (bill && bill.nextDate > item.billingPeriodKey) {
      bill.nextDate = item.billingPeriodKey
      bill.updatedAt = stamp()
      commitBills()
    }
    return deleted
  }
  function createBill(value = {}) {
    const now = stamp()
    const amount = normalizeAmount(value.amount)
    const name = String(value.name || value.title || '').trim()
    const nextDate = value.nextDate || value.date || ''
    const cycles = new Set(['weekly', 'monthly', 'quarterly', 'yearly', 'once'])
    if (!name || amount === null || !validDateKey(nextDate)) throw new Error('请补充正确的账单名称、金额和日期')
    const item = {
      id: value.id || createId('bill'), name, amount,
      category: value.cat || value.category || classifyTransaction(name).categoryId,
      cycle: cycles.has(value.cycle) ? value.cycle : 'monthly', nextDate,
      remindDays: Number.isFinite(Number(value.remindDays)) ? Math.max(0, Math.round(Number(value.remindDays))) : 3,
      autoRenew: value.autoRenew !== false, active: value.active !== false,
      note: String(value.note || '').trim(), account: defaultAccount(value.account),
      // 多币种账单：不传就不写字段（与支出记录同一约定，空币种 = 基准币种）。
      ...(normalizeCurrency(value.currency) ? { currency: normalizeCurrency(value.currency) } : {}),
      createdAt: now, updatedAt: now, ...origin(value),
    }
    bills.value.push(item)
    commitBills()
    return item
  }
  function updateBill(id, value = {}) {
    const item = bills.value.find((entry) => entry.id === id)
    if (!item) return null
    const next = { ...item, ...value }
    const amount = normalizeAmount(next.amount)
    if (amount === null || !String(next.name || '').trim() || !validDateKey(next.nextDate)) throw new Error('请补充正确的账单名称、金额和日期')
    Object.assign(item, {
      ...value,
      name: String(next.name).trim(), amount, nextDate: next.nextDate,
      cycle: ['weekly', 'monthly', 'quarterly', 'yearly', 'once'].includes(next.cycle) ? next.cycle : item.cycle || 'monthly',
      updatedAt: stamp(),
    })
    commitBills()
    return item
  }
  function deleteBill(id) {
    const index = bills.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [bill] = bills.value.splice(index, 1)
    commitBills()
    const now = stamp()
    transactions.value = transactions.value.map((item) => {
      const matchesBill = transactionBillId(item) === String(id)
      if (!matchesBill) return item
      return {
        ...item,
        // 保留交易历史及其“来自账单”的可读来源，但不保留指向已删除 Bill 的 ID。
        billId: '',
        billingPeriodKey: '',
        sourceType: item.sourceType === 'bill' && item.sourceId === id ? '' : item.sourceType,
        sourceId: item.sourceType === 'bill' && item.sourceId === id ? '' : item.sourceId,
        relationId: item.relationId === `bill:${id}` ? '' : item.relationId,
        updatedAt: now,
      }
    })
    commitTransactions()
    recordTombstone('Bill', id, { entity: bill })
    return bill
  }
  function deleteCourse(id) {
    const index = courses.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [course] = courses.value.splice(index, 1)
    commitCourses()
    detachCourseRelations(course, { tasks: tasks.value, milestones: milestones.value, events: events.value, notes: notes.value })
    commitTasks()
    commitNotes()
    commitEvents()
    commitMilestones()
    recordTombstone('Course', id, { entity: course })
    return course
  }
  function createCourse(value) {
    const now = stamp()
    const course = {
      id: createId('c'),
      name: String(value.name || '').trim(),
      teacher: String(value.teacher || '').trim(),
      room: String(value.room || '').trim(),
      campusId: String(value.campusId || '').trim(),
      travelMinutes: Math.max(0, Number(value.travelMinutes) || 0),
      color: value.color || '#456fe8',
      day: Number(value.day) || 0,
      start: Number(value.start) || 1,
      end: Number(value.end) || Number(value.start) || 1,
      startWeek: Number(value.startWeek) || 1,
      endWeek: Number(value.endWeek) || 20,
      weekType: value.weekType || 'all',
      createdAt: now,
      updatedAt: now,
      createdFrom: value.createdFrom || 'manual',
    }
    if (!course.name) throw new Error('请填写课程名称')
    courses.value.push(course)
    commitCourses()
    return course
  }
  function replaceCourses(value) {
    courses.value = Array.isArray(value) ? value : []
    commitCourses()
    return courses.value
  }
  function updateEvent(id, value) {
    const item = events.value.find((entry) => entry.id === id)
    if (!item) return null
    Object.assign(item, value, { updatedAt: stamp() })
    commitEvents()
    return item
  }
  function deleteEvent(id) {
    const index = events.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const deleted = events.value.splice(index, 1)[0]
    commitEvents()
    recordTombstone('Event', id, { entity: deleted })
    return deleted
  }
  function restoreDeletedEvent(entity) { const item = restoreDeletedItem(events, 'Event', entity); if (item) commitEvents(); return item }
  function archiveTask(id) { const item = archiveItem(tasks, id); if (item) commitTasks(); return item }
  function restoreTask(id) { const item = restoreItem(tasks, id); if (item) commitTasks(); return item }
  function archiveCourse(id) { const item = archiveItem(courses, id); if (item) commitCourses(); return item }
  function restoreCourse(id) { const item = restoreItem(courses, id); if (item) commitCourses(); return item }
  function archiveMilestone(id) { const item = archiveItem(milestones, id); if (item) commitMilestones(); return item }
  function restoreMilestone(id) { const item = restoreItem(milestones, id); if (item) commitMilestones(); return item }
  function archiveEvent(id) { const item = archiveItem(events, id); if (item) commitEvents(); return item }
  function restoreEvent(id) { const item = restoreItem(events, id); if (item) commitEvents(); return item }
  function archiveNote(id) { const item = archiveItem(notes, id); if (item) commitNotes(); return item }
  function restoreNote(id) { const item = restoreItem(notes, id); if (item) commitNotes(); return item }
  function archiveBill(id) { const item = archiveItem(bills, id, { inactive: true }); if (item) commitBills(); return item }
  function restoreBill(id) { const item = restoreItem(bills, id, { active: true }); if (item) commitBills(); return item }
  function setBillActive(id, active) {
    const item = bills.value.find((entry) => entry.id === id)
    if (!item) return null
    item.active = Boolean(active)
    if (item.active) item.archivedAt = null
    item.updatedAt = stamp()
    commitBills()
    return item
  }
  function skipBill(id) {
    const item = bills.value.find((entry) => entry.id === id)
    if (!item) return null
    if (item.active === false || item.archivedAt) return { blocked: true, bill: item, reason: '账单已暂停，请恢复后再跳过本期。' }
    item.nextDate = nextBillDate(item)
    item.updatedAt = stamp()
    commitBills()
    return item
  }
  function payBill(id) {
    const bill = bills.value.find((item) => item.id === id)
    if (!bill) return null
    if (bill.active === false || bill.archivedAt) return { blocked: true, bill, reason: '账单已暂停，请恢复后再记录支付。' }
    if (!validDateKey(bill.nextDate)) return null
    const period = bill.nextDate
    const duplicate = transactions.value.find((item) => (
      !item?.archivedAt && transactionBillId(item) === bill.id && item.billingPeriodKey === period
    ))
    if (duplicate) return { bill, transaction: duplicate, duplicate: true }
    const transaction = createTransaction({
      name: bill.name, amount: bill.amount, category: bill.category,
      date: policyDateKey(), note: '来自固定账单', account: bill.account,
      // 账单自己带币种时，支付生成的交易必须沿用同一个币种；旧账单没有该字段 = 基准币种。
      currency: bill.currency || '',
      billId: bill.id, billingPeriodKey: period, source: 'bill', createdFrom: 'bill',
      sourceType: 'bill', sourceId: bill.id,
    })
    bill.nextDate = nextBillDate(bill)
    bill.updatedAt = stamp()
    commitBills()
    return { bill, transaction, duplicate: false }
  }
  function completeTask(id) {
    const item = tasks.value.find((task) => task.id === id)
    if (!item) return null
    return item.done || item.status === 'completed' ? item : toggleTask(id)
  }
  function recordTaskFocusSession(id, session) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task || !session) return null
    task.focusCount = Math.max(0, Number(task.focusCount) || 0) + 1
    task.focusTotalSeconds = Math.max(0, Number(task.focusTotalSeconds) || 0) + Math.max(0, Number(session.actualFocusSeconds) || 0)
    task.lastFocusedAt = session.endedAt || stamp()
    task.updatedAt = stamp()
    commitTasks()
    return task
  }
  function recordFocusSession(session) {
    if (!session) return null
    focusSessions.value.unshift(session)
    commitFocusSessions()
    if (session.todoId) recordTaskFocusSession(session.todoId, session)
    return session
  }
  return { tasks, courses, milestones, bills, transactions, events, notes, focusSessions, createTask, updateTask, toggleTask, completeTask, deleteTask, restoreDeletedTask, archiveTask, restoreTask, createMilestone, updateMilestone, deleteMilestone, restoreDeletedMilestone, archiveMilestone, restoreMilestone, createEvent, updateEvent, deleteEvent, restoreDeletedEvent, archiveEvent, restoreEvent, createNote, updateNote, deleteNote, archiveNote, restoreNote, createTransaction, updateTransaction, deleteTransaction, restoreDeletedTransaction, refundTransaction, undoBillPayment, createBill, updateBill, deleteBill, archiveBill, restoreBill, setBillActive, skipBill, deleteCourse, createCourse, replaceCourses, archiveCourse, restoreCourse, recordTaskFocusSession, recordFocusSession, payBill }
}
