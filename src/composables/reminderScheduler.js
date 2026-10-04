// 待办 / 日程 / 重要节点的到点提醒。
//
// 【为什么需要这个文件】`reminderMinutes` 此前是**只写不读的死数据**：
// QuickRecordSettings 里有三个输入框（待办/日程/节点提醒，分钟），默认值
// 1440 / 30 / 1440 会经defaultReminderMinutes 写进每一条 task / event /
// milestone，但全仓没有任何消费者 —— 没有调度器、没有 Notification、没有去重。
// 用户把「日程提醒」设成 30 分钟、添加一条明天 9 点的日程，什么都不会发生。
// 这是"看起来有、实际没有"里最刺眼的一种：比崩溃更糟，因为用户不会去排查。
//
// 【能力边界，必须对用户说清】new Notification() 只在页面活着且可见时可靠。
// PWA 被切到后台或被系统回收后不会响。要做到"关掉 App 也会提醒"必须用
// Service Worker 的 showNotification + Push API，而 Push 需要 VAPID 密钥对
// 和推送服务端 —— 直接撞上"不接入任何外部网络服务"的约束。
// 所以这里的定位是"**App 打开时按时提醒**"，UI 文案与 README 都要照实说。
//
// 【去重必须落盘】只用内存 Set 的话，刷新页面会重复提醒；接入云同步后两台设备
// 还会各响一次。所以 fired 记录写进一个新的存储键，跟着数据一起同步。
import { clock, useStoredRef } from './store/core.js'
import { policyDateTime, settings } from './settingsPolicy.js'

// 直接注册存储 ref，而不是从某个 barrel import —— 后者会把本模块拉进
// store → domain → … 的依赖链，而这个调度器只需要读三份集合。
// useStoredRef 对同一键是幂等的（storedRefs 单例），与 commands.js 拿到的是同一份。
const tasks = useStoredRef('sl_tasks', [])
const events = useStoredRef('sl_events', [])
const milestones = useStoredRef('sl_exams', [])

export const REMINDER_LOG_KEY = 'sl_reminder_log'

// 一次性回看窗口：App 打开时如果某条提醒的触发点就在最近这段时间内（页面
// 被关掉又打开、或系统把标签页丢弃了），也应当补一次响。超过这个窗口就不补，
// 否则打开应用会一次性弹出上周积压的所有提醒。
export const CATCH_UP_WINDOW_MS = 6 * 60 * 60 * 1000

// 只排程这个时间窗内的提醒。窗口太大会让 setTimeout 的延时超出浏览器上限
// （setTimeout 的延时是 32 位有符号整数毫秒，超过约 24.8 天会立刻触发）。
const SCHEDULE_HORIZON_MS = 6 * 60 * 60 * 1000

let logEntries = []
let timer = null
let started = false
let lastSeenSignature = ''

function readLog() {
  try {
    const raw = localStorage.getItem(REMINDER_LOG_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === 'string') : []
  } catch {
    // 损坏的日志不该阻断提醒本身，清掉重新开始。
    return []
  }
}

function writeLog() {
  try {
    localStorage.setItem(REMINDER_LOG_KEY, JSON.stringify(logEntries))
  } catch {
    // 写不进去（配额/隐私模式）时仍然要能提醒，只是刷新后可能重复。
  }
}

// 日志只保留最近一天，且同一个 key 只记一次 —— 它是去重集合，不是流水账。
function pruneLog(nowMs) {
  const cutoff = nowMs - CATCH_UP_WINDOW_MS
  logEntries = logEntries.filter((item) => Number(item.firedAt) > cutoff)
}

function alreadyFired(key, nowMs) {
  pruneLog(nowMs)
  return logEntries.some((item) => item.key === key)
}

function markFired(key, nowMs) {
  logEntries = [...logEntries.filter((item) => item.key !== key), { key, firedAt: nowMs }]
  writeLog()
}

// 提醒的稳定标识。刻意**不含** updatedAt 之类的易变字段：同一条待办改了标题
// 不该让它能再响一次，而提醒时间真的改了就应该能重新提醒。
function reminderKey(kind, id) {
  return `${kind}:${id}`
}

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!match) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback
  if (hour > 23 || minute > 59) return fallback
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function notifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/**
 * 收集当前所有"应该提醒"的条目。
 *
 * 只返回纯数据、不弹窗、不排程 —— 这样测试可以直接断言这份清单，
 * 而不必与setTimeout 和 Notification 打交道。
 *
 * @param {number} nowMs
 * @returns {{ key: string, kind: string, title: string, body: string, fireAt: number, minutes: number }[]}
 */
export function collectDueReminders(nowMs = Date.now()) {
  const policy = settings.value?.defaultReminders || {}
  const windowStart = nowMs - CATCH_UP_WINDOW_MS
  const horizon = nowMs + SCHEDULE_HORIZON_MS
  const due = []

  const push = (kind, item, date, time, rawMinutes) => {
    // reminderMinutes 为 0 的语义是"到点才提醒"，不是"不提醒"。
    const minutes = Number.isFinite(Number(rawMinutes)) && Number(rawMinutes) > 0
      ? Number(rawMinutes)
      : 0
    if (!date) return
    // 没有具体时刻的（只有日期）按当天 23:59 算，与 settingsPolicy 的惯例一致。
    // fireAt 是"应当响起来的时刻" = 截止时刻 - 提前分钟数。
    const dueAt = policyDateTime(date, parseClock(time, '23:59'))
    if (!Number.isFinite(dueAt)) return
    const fireAt = dueAt - minutes * 60_000
    if (fireAt > horizon || fireAt < windowStart) return
    if (alreadyFired(reminderKey(kind, item.id), nowMs)) return
    due.push({
      key: reminderKey(kind, item.id),
      kind,
      title: String(item.title || item.name || '').trim(),
      body: `${minutes > 0 ? `${minutes} 分钟后` : '就是现在'}：${String(item.title || item.name || '').trim()}`,
      fireAt,
      minutes,
      at: `${date} ${time || '23:59'}`,
    })
  }

  for (const task of tasks.value || []) {
    if (task?.done || task?.status === 'done') continue
    push('task', task, task?.dueDate, task?.dueTime, task?.reminderMinutes ?? policy.task)
  }
  for (const item of events.value || []) {
    push('event', item, item?.date, item?.time, item?.reminderMinutes ?? policy.event)
  }
  for (const item of milestones.value || []) {
    push('milestone', item, item?.date, item?.time, item?.reminderMinutes ?? policy.milestone)
  }

  return due.sort((left, right) => left.fireAt - right.fireAt)
}

function fire(entry) {
  // 先落盘再去弹：万一抛了也不能重复提醒。
  markFired(entry.key, Date.now())
  if (notifyPermission() !== 'granted') return false
  try {
    const notification = new Notification(`学习生活台 · ${entry.kind === 'task' ? '待办' : entry.kind === 'event' ? '日程' : '重要节点'}提醒`, {
      body: `${entry.title}${entry.body}`,
      tag: entry.key,
    })
    try { notification.onclick = () => { try { window.focus() } catch {}; notification.close() } } catch {}
    return true
  } catch {
    return false
  }
}

function notifyState() {
  if (typeof Notification === 'undefined') return { state: 'unsupported', enabled: false }
  if (Notification.permission === 'granted') return { state: 'granted', enabled: true }
  if (Notification.permission === 'denied') return { state: 'denied', enabled: false }
  return { state: 'prompt', enabled: false }
}

export { notifyState as getReminderNotificationState }

export async function requestReminderPermission() {
  if (typeof Notification === 'undefined') return notifyState()
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch {}
  }
  return notifyState()
}

/**
 * 启动调度。每分钟重算一次到期项 —— 用一条循环定时器而不是"每条提醒一个
 * setTimeout"：后者在有几百条待办时会攒出几百个定时器，且新增/删除待办时
 * 很难保持一致。
 */
export function startReminderScheduler() {
  if (typeof document === 'undefined') return
  if (timer) clearInterval(timer)
  logEntries = readLog()
  const tick = () => {
    const nowMs = clock.value?.getTime?.() || Date.now()
    for (const entry of collectDueReminders(nowMs)) {
      // 已过去的（含刚打开页面时的补响）立即触发。
      if (entry.fireAt <= nowMs) fire(entry)
    }
  }
  tick()
  timer = setInterval(tick, 60_000)
  started = true
}

export function stopReminderScheduler() {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

export function isReminderSchedulerRunning() {
  return started
}

/**
 * 数据变化后让调度器尽快重算。
 *
 * 用一个签名做廉价的"有没有变"判断：不去深比较整棵任务树（那在几千条待办时
 * 很贵），只看去重键与触发时刻的组合。
 */
export function notifyReminderDataChanged() {
  const signature = JSON.stringify(collectDueReminders(Date.now()).map((item) => `${item.key}@${item.fireAt}`))
  if (signature === lastSeenSignature) return
  lastSeenSignature = signature
  if (!timer) return
  const nowMs = Date.now()
  for (const entry of collectDueReminders(nowMs)) {
    if (entry.fireAt <= nowMs) fire(entry)
  }
}

/** 仅供测试：清空去重记录。 */
export function resetReminderLogForTest() {
  logEntries = []
  lastSeenSignature = ''
  try { localStorage.removeItem(REMINDER_LOG_KEY) } catch {}
}