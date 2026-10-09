import { touchStoredRef, useStoredRef } from '../store/index.js'
import { createNextRepeatingTask, nextRepeatDueDate, normalizeTaskRepeat, repeatsTask } from '../taskRecurrence.js'
import { classifyTask } from '../smartClassify.js'
import { amountToCents, categoriesForScope, classifyTransaction, isRefundTransaction, normalizeAmount, normalizeLedgerTime } from '../ledger.js'
// 新增可选字段的来源：币种（多币种记账）与分摊（报销分摊）。
// 两个模块都只做纯规范化，不反向依赖这里，所以不会形成循环导入。
import { normalizeCurrency } from '../ledgerFx.js'
import { mySpendCents, normalizeSplit, validateSplit } from '../ledgerSplit.js'
import { isBillPayment, transactionBillId } from '../ledgerRelations.js'
import { detachCourseRelations } from './relations.js'
import { defaultAccount, defaultReminderMinutes, policyDateKey, policyTimeKey } from '../settingsPolicy.js'
import { eventInputError } from '../events/eventFields.js'

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
// Deletion undo is an in-memory convenience, not durable history. Keep its
// relation snapshot cache bounded if a page stays open through many deletions.
const MAX_MILESTONE_RESTORE_RELATIONS = 100
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
/**
 * 从 `from` 起按月推进 `count` 期，**始终以 `anchorDay` 为基准日**。
 *
 * 【为什么需要锚点】朴素写法 `addMonthsKey(bill.nextDate, 1)` 每推进一次就把
 * 「被缩短过的日期」当成新基准：31 号 → 2 月被压成 28 → 再推进变成 **3-28**，
 * 而且不可逆，于是房租从 3 月起永久提前 3 天。锚点让缩短只影响当月，
 * 3 月仍回到 31 号。
 *
 * `anchorDay` 缺省取 `from` 的日，与旧数据行为一致（单期推进结果完全不变）。
 */
function addMonthsKeyAnchored(from, count, anchorDay) {
  const [year, month] = dateParts(from)
  const anchor = Number.isFinite(anchorDay) && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : dateParts(from)[2]
  const target = new Date(Date.UTC(year, month - 1 + count, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(anchor, lastDay))
  return target.toISOString().slice(0, 10)
}
function validAnchorDay(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const day = Number(value)
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null
}
function billCycleMonths(cycle) {
  if (cycle === 'monthly') return 1
  if (cycle === 'quarterly') return 3
  if (cycle === 'yearly') return 12
  return 0
}
function inferLegacyBillAnchorDay(bill, transactions) {
  const stepMonths = billCycleMonths(bill.cycle)
  if (!stepMonths || !validDateKey(bill.nextDate)) return null
  const periods = [...new Set((transactions || [])
    .filter((item) => transactionBillId(item) === bill.id && validDateKey(item.billingPeriodKey))
    .map((item) => item.billingPeriodKey))]
    .sort()
  // One generated payment plus the current due date is sufficient when the old
  // clamp-on-every-step chain matches. If it does not, preserve the current date
  // instead of guessing about a manual schedule change.
  if (periods.length < 1) return null

  const first = periods[0]
  const anchorDay = dateParts(first)[2]
  let cursor = first
  for (const target of [...periods.slice(1), bill.nextDate]) {
    if (target < cursor) return null
    let matched = cursor === target
    for (let count = 0; !matched && cursor < target && count < 1200; count += 1) {
      const next = addMonthsKey(cursor, stepMonths)
      if (next <= cursor) return null
      cursor = next
      if (cursor === target) matched = true
      else if (cursor > target) break
    }
    // The stored period keys and current due date must still fit the legacy clamp-on-every-step chain.
    if (!matched) return null
  }
  return anchorDay
}
function nextBillDate(bill, transactions = []) {
  // 非法 nextDate 曾经一路走到 toISOString() 抛 RangeError（Invalid time value），
  // 而 skipBill 没有守卫，异常会冒到全局 errorHandler。这里就地兜住：
  // 读不出日期就按「今天」推进，至少保证账单不会变成一个点不动也删不掉的东西。
  const from = validDateKey(bill.nextDate) ? bill.nextDate : policyDateKey()
  // 新账单显式保存锚点。旧账单只在关联支付历史能验证整条旧月末链时补回；
  // 证据不足时单次按当前 due date 推进，且不把猜测写回用户数据。
  let anchorDay = validAnchorDay(bill.anchorDay)
  if (!anchorDay && billCycleMonths(bill.cycle)) {
    anchorDay = inferLegacyBillAnchorDay(bill, transactions)
    if (anchorDay) bill.anchorDay = anchorDay
  }
  anchorDay ||= dateParts(from)[2]
  const advance = (date) => bill.cycle === 'weekly' ? addDaysKey(date, 7)
    : bill.cycle === 'quarterly' ? addMonthsKeyAnchored(date, 3, anchorDay)
      : bill.cycle === 'yearly' ? addMonthsKeyAnchored(date, 12, anchorDay)
        : bill.cycle === 'once' ? date : addMonthsKeyAnchored(date, 1, anchorDay)
  let next = advance(from)
  const today = policyDateKey()
  // `autoRenew: false` 此前是个死字段：BillFormModal 有开关、createBill 也存了，
  // 但推进逻辑从不读它，所以关掉之后日期照样一路滚到未来，用户的操作毫无效果。
  //
  // 语义定为「不追赶」：不启用时**不把日期推到今天之后**——即使用户几个月没打开应用，
  // 账单也停在原处等他，而不是静默地跳过好几期（跳过的期数本来就不留任何痕迹）。
  // 用户仍可手动「跳过本次」把它顺延一期，或改回 autoRenew 继续自动推进。
  if (bill.autoRenew === false) return next
  while (next <= today && bill.cycle !== 'once') {
    next = advance(next)
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

function restoreDeletedItem(list, entity, { preserveArchive = false } = {}) {
  if (!entity?.id) return null
  const existing = list.value.find((item) => item.id === entity.id)
  if (existing) return existing
  const restored = { ...entity, archivedAt: preserveArchive ? entity.archivedAt ?? null : null, updatedAt: stamp() }
  delete restored.deletedAt
  delete restored.tombstone
  list.value.push(restored)
  return restored
}

export function useDomainCommands() {
  const tasks = useStoredRef('sl_tasks', []); const courses = useStoredRef('sl_courses', []); const milestones = useStoredRef('sl_exams', []); const bills = useStoredRef('sl_bills', []); const transactions = useStoredRef('sl_expenses', []); const events = useStoredRef('sl_events', []); const focusSessions = useStoredRef('sl_focus_sessions', [])
  const commitTasks = () => touchStoredRef('sl_tasks')
  const commitTransactions = () => touchStoredRef('sl_expenses')
  const commitEvents = () => touchStoredRef('sl_events')
  const commitMilestones = () => touchStoredRef('sl_exams')
  const commitBills = () => touchStoredRef('sl_bills')
  const commitFocusSessions = () => touchStoredRef('sl_focus_sessions')
  const commitCourses = () => touchStoredRef('sl_courses')
  // 只有真的要重复时才把 repeatEndDate 写进记录：不重复的待办带一个空串字段，
  // 会在导出的 JSON 与同步载荷里堆成纯噪声（与 currency 的「缺失即基准」同一套约定）。
  function repeatEndField(repeat, endDate) {
    return repeat === 'none' ? {} : { repeatEndDate: String(endDate || '').trim() }
  }
  function createTask(value) {
    const now = stamp()
    const repeat = normalizeTaskRepeat(value.repeat)
    const actualMinutes = Number(value.actualMinutes)
    const task = classifyTask({
      id: value.id || createId('t'), title: String(value.title || '').trim(), done: false, status: 'pending',
      createdAt: now, updatedAt: now, course: value.course || '', courseId: value.courseId || '',
      dueDate: value.dueDate || '', dueTime: value.dueTime || '', priority: value.priority || 'normal',
      note: value.note || '', sourceText: value.sourceText || '', estimateMinutes: Number(value.estimateMinutes) || 0,
      ...(value.actualMinutes !== undefined && value.actualMinutes !== null && value.actualMinutes !== '' && Number.isFinite(actualMinutes) && actualMinutes >= 0
        ? { actualMinutes } : {}),
      ...(value.workCheckpoint ? { workCheckpoint: value.workCheckpoint } : {}),
      reminderMinutes: defaultReminderMinutes('task', value.reminderMinutes), repeat,
      ...repeatEndField(repeat, value.repeatEndDate), kind: value.kind || 'todo', ...origin(value),
    }, courses.value)
    if (!task.title) throw new Error('请填写待办内容')
    tasks.value.push(task)
    commitTasks()
    return task
  }
  /**
   * 生成重复待办的下一期（每天 / 工作日 / 每周 / 每两周 / 每月）。
   *
   * 只有真的生成了才写 repeatGeneratedAt —— 原来先写标记再生成，
   * 一旦 createNextWeeklyTask 返回 null（dueDate 非法等），这个待办
   * 就带着"已生成"的标记永远不再尝试。
   *
   * 判定从 `repeat === 'weekly'` 换成 `repeatsTask(item)`，这样新规则走的是**同一条**
   * 生成路径而不是各写一份；`repeatsTask` 对未知规则值返回 false，
   * 于是旧数据/脏数据不会凭空长出新待办。
   */
  function spawnNextRepeatTask(item) {
    const now = stamp()
    const taskForGeneration = { ...item }
    if (normalizeTaskRepeat(item.repeat) === 'monthly' && !validAnchorDay(item.repeatAnchorDay)) {
      // 旧版重复待办没有锚点字段。生成来源链能证明原始月末日时恢复它；
      // 日期被改过或来源已丢失时，taskRecurrence 会兼容地以当前截止日为锚点。
      const seen = new Set([item.id])
      let cursor = item
      let recoveredAnchor = null
      while (cursor?.sourceType === 'task-repeat' && cursor.sourceId && !seen.has(cursor.sourceId)) {
        seen.add(cursor.sourceId)
        const parent = tasks.value.find((task) => task.id === cursor.sourceId)
        if (!parent || normalizeTaskRepeat(parent.repeat) !== 'monthly' || !parent.dueDate) break
        const parentAnchor = validAnchorDay(parent.repeatAnchorDay)
        const expected = nextRepeatDueDate(parent.dueDate, 'monthly', parentAnchor ? { anchorDay: parentAnchor } : {})
        if (expected !== cursor.dueDate) break
        if (parentAnchor) {
          recoveredAnchor = parentAnchor
          break
        }
        const parentDay = new Date(`${parent.dueDate}T00:00:00`).getDate()
        const childDay = new Date(`${cursor.dueDate}T00:00:00`).getDate()
        if (!recoveredAnchor && parentDay > childDay) recoveredAnchor = parentDay
        cursor = parent
      }
      if (recoveredAnchor) taskForGeneration.repeatAnchorDay = recoveredAnchor
    }
    const next = createNextRepeatingTask(taskForGeneration)
    if (!next) return false
    item.repeatGeneratedAt = now
    tasks.value.push({ ...next, status: 'pending', updatedAt: now, createdFrom: item.createdFrom || 'manual', sourceType: 'task-repeat', sourceId: item.id })
    return true
  }
  // 两条写路径（updateTask / toggleTask）共用这一句：重复规则或截止日期不合法时一律不生成。
  function maybeSpawnNextRepeat(item) {
    if (!repeatsTask(item) || !item.dueDate || item.repeatGeneratedAt) return
    spawnNextRepeatTask(item)
  }
  function updateTask(id, value) {
    const item = tasks.value.find((task) => task.id === id)
    if (!item) return null
    const previousRepeat = normalizeTaskRepeat(item.repeat)
    const previousDueDate = item.dueDate
    Object.assign(item, value, { updatedAt: stamp() })
    if ('repeat' in value) item.repeat = normalizeTaskRepeat(item.repeat)
    if (item.repeat === 'none') {
      delete item.repeatEndDate
      delete item.repeatAnchorDay
    } else if (item.repeat === 'monthly' && (item.repeat !== previousRepeat || item.dueDate !== previousDueDate)) {
      const day = new Date(`${item.dueDate}T00:00:00`).getDate()
      if (Number.isInteger(day) && day >= 1 && day <= 31) item.repeatAnchorDay = day
      else delete item.repeatAnchorDay
    } else if (item.repeat !== 'monthly') {
      delete item.repeatAnchorDay
    }
    if (item.done === true) maybeSpawnNextRepeat(item)
    commitTasks()
    return item
  }
  function toggleTask(id) { const item = tasks.value.find((task) => task.id === id); if (!item) return null; const now = stamp(); item.done = !item.done; item.status = item.done ? 'completed' : 'pending'; item.completedAt = item.done ? now : null; item.updatedAt = now; if (item.done) maybeSpawnNextRepeat(item); commitTasks(); return item }
  function deleteTask(id) {
    const index = tasks.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const deleted = tasks.value.splice(index, 1)[0]
    let detachedFocus = false
    for (const session of focusSessions.value) {
      if (String(session?.todoId ?? '') !== String(deleted.id)) continue
      session.title = String(session.title || deleted.title || '')
      session.todoId = null
      detachedFocus = true
    }
    if (detachedFocus) commitFocusSessions()
    commitTasks()
    return deleted
  }
  function restoreDeletedTask(entity) {
    const restored = restoreDeletedItem(tasks, entity)
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
    while (milestoneRestoreRelations.size > MAX_MILESTONE_RESTORE_RELATIONS) {
      milestoneRestoreRelations.delete(milestoneRestoreRelations.keys().next().value)
    }
    const now = stamp()
    tasks.value = tasks.value.map((task) => {
      if (task.sourceType !== 'milestone-review' || task.sourceId !== id) return task
      return { ...task, sourceType: '', sourceId: '', relationId: '', updatedAt: now }
    })
    commitTasks()
    return milestone
  }
  function restoreDeletedMilestone(entity) {
    const restored = restoreDeletedItem(milestones, entity)
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
  function createEvent(value) {
    const now = stamp()
    const item = { id: value.id || createId('event'), title: String(value.title || '').trim(), date: value.date || '', time: value.time || '', endTime: value.endTime || '', location: value.location || '', courseId: value.courseId || '', courseName: value.courseName || value.course || '', note: value.note || '', sourceText: value.sourceText || '', normalizedText: value.normalizedText || '', noticeType: value.noticeType || '', reminderEnabled: value.reminderEnabled !== false, reminderMinutes: defaultReminderMinutes('event', value.reminderMinutes), createdAt: now, updatedAt: now, ...origin(value) }
    const issue = eventInputError(item)
    if (issue) throw new Error(issue.message)
    events.value.push(item)
    commitEvents()
    return item
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
  function updateTransactionCategories(changes = []) {
    if (!Array.isArray(changes)) throw new Error('批量分类数据格式不正确')
    const requested = new Map()
    for (const change of changes) {
      const id = String(change?.id ?? '').trim()
      const categoryId = String(change?.categoryId ?? change?.cat ?? '').trim()
      if (!id || !categoryId) throw new Error('批量分类缺少记录或分类')
      requested.set(id, categoryId)
    }
    if (!requested.size) return []

    const targets = [...requested.entries()].map(([id, categoryId]) => {
      const item = transactions.value.find((entry) => String(entry.id) === id)
      if (!item || item.archivedAt || item.deletedAt || item.tombstone) {
        throw new Error('部分同名记录已不可用，请刷新后再试')
      }
      if (isRefundTransaction(item) || isBillPayment(item)) {
        throw new Error('同名结果中包含退款或固定账单记录，未执行批量修改')
      }
      const scope = item.direction === 'income' ? 'income' : 'expense'
      if (!categoriesForScope(scope, { includeHidden: true }).some((category) => category.key === categoryId)) {
        throw new Error('所选分类与记录的收支方向不匹配')
      }
      return { item, categoryId }
    }).filter(({ item, categoryId }) => (item.cat || 'other') !== categoryId)

    if (!targets.length) return []
    const previous = targets.map(({ item }) => ({ id: item.id, categoryId: item.cat || 'other' }))
    const updatedAt = stamp()
    for (const { item, categoryId } of targets) {
      item.cat = categoryId
      item.updatedAt = updatedAt
    }
    commitTransactions()
    return previous
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
    return deleted
  }
  function restoreDeletedTransaction(entity) {
    const restored = restoreDeletedItem(transactions, entity)
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
    // 【上限按「我承担」算，不按总额】整个账本对外回答的是「我实际承担多少」
    // （mySpendCents），退款必须用同一个口径冲减，否则一笔 2 人 AA 的支出
    // （总额 ¥100 / 我承担 ¥60）能退掉 ¥100，让本月花费变成 −¥40。
    const originalCents = mySpendCents(original) ?? 0
    const alreadyCents = transactions.value
      .filter((entry) => isRefundTransaction(entry) && entry.refundOf === id && !entry?.archivedAt && !entry?.deletedAt && !entry?.tombstone)
      .reduce((sum, entry) => sum + (mySpendCents(entry) ?? 0), 0)
    const amountCents = amountToCents(amount) ?? 0
    if (amountCents > originalCents - alreadyCents) {
      return { blocked: true, reason: `退款金额不能超过剩余可退 ${((originalCents - alreadyCents) / 100).toFixed(2)}。` }
    }
    const now = stamp()
    // 【币种必须继承】外币支出的退款若不带 currency，会被导出与合计归到基准币种桶里，
    // 变成「用 9.99 人民币冲减一笔 9.99 美元的支出」。
    const currency = normalizeCurrency(original.currency)
    // 【分摊必须继承】同理：原支出按 split.mine 计入，退款也必须按 mine 计入，
    // 否则退掉的是全额、抵扣的只是我那一份。
    const hasSplitInput = value.split !== undefined && value.split !== null
    if (hasSplitInput && !validateSplit(value.split).ok) {
      return { blocked: true, reason: `分摊数据不合法：${validateSplit(value.split).issues[0]}` }
    }
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
      ...(currency ? { currency } : {}),
      ...(hasSplitInput ? { split: normalizeSplit(value.split) } : original.split ? { split: normalizeSplit(original.split) } : {}),
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
    const cycle = cycles.has(value.cycle) ? value.cycle : 'monthly'
    const item = {
      id: value.id || createId('bill'), name, amount,
      category: value.cat || value.category || classifyTransaction(name).categoryId,
      cycle, nextDate,
      ...(billCycleMonths(cycle) ? { anchorDay: validAnchorDay(value.anchorDay) ?? dateParts(nextDate)[2] } : {}),
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
    const cycle = ['weekly', 'monthly', 'quarterly', 'yearly', 'once'].includes(next.cycle) ? next.cycle : item.cycle || 'monthly'
    const dateChanged = next.nextDate !== item.nextDate
    const cycleChanged = cycle !== item.cycle
    let anchorDay = validAnchorDay(value.anchorDay)
    if (!anchorDay && dateChanged) anchorDay = dateParts(next.nextDate)[2]
    if (!anchorDay && billCycleMonths(cycle) && !dateChanged) {
      anchorDay = validAnchorDay(item.anchorDay)
        ?? inferLegacyBillAnchorDay(item, transactions.value)
        ?? (cycleChanged ? dateParts(next.nextDate)[2] : null)
    }
    Object.assign(item, {
      ...value,
      name: String(next.name).trim(), amount, nextDate: next.nextDate,
      cycle,
      updatedAt: stamp(),
    })
    if (anchorDay) item.anchorDay = anchorDay
    else if (dateChanged || ('anchorDay' in value && !validAnchorDay(value.anchorDay))) delete item.anchorDay
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
    return bill
  }
  function deleteCourse(id) {
    const index = courses.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const [course] = courses.value.splice(index, 1)
    commitCourses()
    detachCourseRelations(course, { tasks: tasks.value, milestones: milestones.value, events: events.value })
    commitTasks()
    commitEvents()
    commitMilestones()
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
      // Period IDs are opaque identifiers (normally "p1", "p2", ...). Keep
      // the caller's type/value intact so legacy numeric IDs remain readable
      // by the migration layer and modern string IDs are never coerced to NaN.
      start: value.start === '' || value.start == null ? 'p1' : value.start,
      end: value.end === '' || value.end == null ? (value.start === '' || value.start == null ? 'p1' : value.start) : value.end,
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
    const next = { ...item, ...value, title: String(value.title ?? item.title ?? '').trim() }
    const issue = eventInputError(next)
    if (issue) throw new Error(issue.message)
    Object.assign(item, next, { updatedAt: stamp() })
    commitEvents()
    return item
  }
  function deleteEvent(id) {
    const index = events.value.findIndex((item) => item.id === id)
    if (index < 0) return null
    const deleted = events.value.splice(index, 1)[0]
    commitEvents()
    return deleted
  }
  function restoreDeletedEvent(entity) { const item = restoreDeletedItem(events, entity, { preserveArchive: true }); if (item) commitEvents(); return item }
  function archiveTask(id) { const item = archiveItem(tasks, id); if (item) commitTasks(); return item }
  function restoreTask(id) { const item = restoreItem(tasks, id); if (item) commitTasks(); return item }
  function archiveCourse(id) { const item = archiveItem(courses, id); if (item) commitCourses(); return item }
  function restoreCourse(id) { const item = restoreItem(courses, id); if (item) commitCourses(); return item }
  function archiveMilestone(id) { const item = archiveItem(milestones, id); if (item) commitMilestones(); return item }
  function restoreMilestone(id) { const item = restoreItem(milestones, id); if (item) commitMilestones(); return item }
  function archiveEvent(id) { const item = archiveItem(events, id); if (item) commitEvents(); return item }
  function restoreEvent(id) {
    const item = restoreItem(events, id)
    if (item) {
      if (item.status === 'archived') delete item.status
      commitEvents()
    }
    return item
  }
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
    item.nextDate = nextBillDate(item, transactions.value)
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
    bill.nextDate = nextBillDate(bill, transactions.value)
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
    const previousFocusSeconds = Math.max(0, Number(task.focusTotalSeconds) || 0)
    const addedFocusSeconds = Math.max(0, Number(session.actualFocusSeconds) || 0)
    const previousActualMinutes = task.actualMinutes !== null && task.actualMinutes !== undefined
      ? Math.max(0, Number(task.actualMinutes) || 0)
      : previousFocusSeconds / 60
    task.focusCount = Math.max(0, Number(task.focusCount) || 0) + 1
    task.focusTotalSeconds = previousFocusSeconds + addedFocusSeconds
    task.actualMinutes = Math.round((previousActualMinutes + addedFocusSeconds / 60) * 10) / 10
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
  return { tasks, courses, milestones, bills, transactions, events, focusSessions, createTask, updateTask, toggleTask, completeTask, deleteTask, restoreDeletedTask, archiveTask, restoreTask, createMilestone, updateMilestone, deleteMilestone, restoreDeletedMilestone, archiveMilestone, restoreMilestone, createEvent, updateEvent, deleteEvent, restoreDeletedEvent, archiveEvent, restoreEvent, createTransaction, updateTransaction, updateTransactionCategories, deleteTransaction, restoreDeletedTransaction, refundTransaction, undoBillPayment, createBill, updateBill, deleteBill, archiveBill, restoreBill, setBillActive, skipBill, deleteCourse, createCourse, replaceCourses, archiveCourse, restoreCourse, recordTaskFocusSession, recordFocusSession, payBill }
}
