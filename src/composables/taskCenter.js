/**
 * 后台任务中心。
 *
 * 「等待分级」里最长的一档是「可以离开」：等待越久，反馈就要越具体。
 * 这里是一个全局注册表 —— 任何长任务把自己的状态接进来，用户就能在
 * 任意页面看到它还在跑；任务结束会留下一笔结果，离开原来的面板也能回来查看。
 *
 * 只做登记与展示，不改变任何任务本身的执行与取消语义。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useStoredRef } from './store'

export const TASK_CENTER_LOG_KEY = 'sl_task_center_log'
export const TASK_CENTER_LOG_LIMIT = 20

export const TASK_RESULT_STATUSES = Object.freeze(['completed', 'warning', 'failed', 'cancelled'])
const RESULT_STATUS_SET = new Set(TASK_RESULT_STATUSES)
const FINISHED_STATUSES = new Set(['completed', 'warning', 'failed', 'cancelled'])

export const TASK_RESULT_LABELS = Object.freeze({
  completed: '已完成',
  warning: '已完成（有提示）',
  failed: '失败',
  cancelled: '已取消',
})

const registry = reactive({})
const taskCenterLog = useStoredRef(TASK_CENTER_LOG_KEY, [])
// 「有没看过的新结果」只在本次会话提示，不额外占用一个持久键
const unseenCounter = ref(0)

function safeCall(source, name, fallback = '') {
  const fn = source?.[name]
  if (typeof fn !== 'function') return fallback
  try {
    const value = fn()
    return value === null || value === undefined ? fallback : value
  } catch {
    return fallback
  }
}

export const taskCenterTasks = computed(() => Object.values(registry))
export const runningTasks = computed(() => taskCenterTasks.value.filter((task) => taskStatusOf(task) === 'running'))
export const runningTaskCount = computed(() => runningTasks.value.length)
export const hasRunningTask = computed(() => runningTaskCount.value > 0)
export const taskCenterResults = computed(() => (Array.isArray(taskCenterLog.value) ? taskCenterLog.value : []))
export const unseenResultCount = computed(() => unseenCounter.value)
/** 悬浮入口是否该出现：有任务在跑，或者有还没看过的新结果。 */
export const taskCenterAttention = computed(() => hasRunningTask.value || unseenResultCount.value > 0)

export function taskStatusOf(task) {
  const status = safeCall(task?.source, 'status', 'idle')
  return typeof status === 'string' && status ? status : 'idle'
}

export function taskMessageOf(task) {
  return String(safeCall(task?.source, 'message', ''))
}

export function taskDetailOf(task) {
  return String(safeCall(task?.source, 'detail', ''))
}

export function taskCanCancel(task) {
  return taskStatusOf(task) === 'running' && safeCall(task?.source, 'canCancel', false) === true
}

export function taskStartedAt(task) {
  const started = Number(safeCall(task?.source, 'startedAt', 0))
  return Number.isFinite(started) && started > 0 ? started : 0
}

/**
 * 一个正在跑但不能取消的任务要说明原因；可以取消或没在跑时返回空串。
 * 「哪些操作是不可中断的」是业务判断，由任务自己通过 source.cancelHint 提供。
 */
export function taskCancelHint(task) {
  if (taskStatusOf(task) !== 'running') return ''
  if (taskCanCancel(task)) return ''
  return String(safeCall(task?.source, 'cancelHint', '') || '此任务由系统自动继续，不需要手动干预')
}

/** 已经跑了多久；不知道开始时间就不显示，避免编造进度。 */
export function formatTaskElapsed(startedAt, now = Date.now()) {
  const started = Number(startedAt)
  if (!Number.isFinite(started) || started <= 0) return ''
  const total = Math.max(0, Math.floor((Number(now) - started) / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `已用 ${seconds} 秒`
  if (minutes < 60) return `已用 ${minutes} 分 ${seconds} 秒`
  return `已用 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

/** 结果距今多久。 */
export function formatTaskAge(at, now = Date.now()) {
  const time = Number(at)
  if (!Number.isFinite(time) || time <= 0) return ''
  const seconds = Math.max(0, Math.floor((Number(now) - time) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export async function cancelTask(task) {
  if (!taskCanCancel(task)) return false
  const cancel = task?.source?.cancel
  if (typeof cancel !== 'function') return false
  await cancel()
  return true
}

/** 把 `{ 壁纸: '2/5' }` 这样的 partial 压成一行可读的细节。 */
export function describePartial(partial) {
  if (!partial || typeof partial !== 'object') return ''
  return Object.entries(partial)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([label, value]) => `${label} ${value}`)
    .join(' · ')
}

/** 把 useTaskProgress() 的实例接成任务中心认得的 source。 */
export function progressTaskSource(progress) {
  return {
    status: () => (progress?.state?.active ? progress.state.status : 'idle'),
    message: () => progress?.state?.latestActivity || '',
    detail: () => describePartial(progress?.state?.partial),
    canCancel: () => Boolean(progress?.state?.canCancel),
    startedAt: () => Number(progress?.state?.startedAt) || 0,
    cancel: () => progress?.cancel?.(),
  }
}

export function normalizeTaskResult(result) {
  const status = RESULT_STATUS_SET.has(result?.status) ? result.status : 'completed'
  return {
    id: String(result?.id || ''),
    title: String(result?.title || '后台任务'),
    status,
    message: String(result?.message || ''),
    at: Number(result?.at) || Date.now(),
  }
}

export function recordTaskResult(result) {
  const entry = normalizeTaskResult(result)
  const rest = taskCenterResults.value.filter((item) => !(item.id === entry.id && item.at === entry.at))
  taskCenterLog.value = [entry, ...rest].slice(0, TASK_CENTER_LOG_LIMIT)
  unseenCounter.value += 1
  return entry
}

export function markResultsSeen() {
  unseenCounter.value = 0
}

export function clearTaskResults() {
  taskCenterLog.value = []
  unseenCounter.value = 0
}

export function unregisterTask(id) {
  const key = String(id || '')
  const entry = registry[key]
  if (!entry) return false
  entry.stopWatch?.()
  delete registry[key]
  return true
}

/**
 * 登记一个后台任务。
 *
 * @param {object} options
 * @param {string} options.id 稳定 id，重复登记会替换旧的
 * @param {string} options.title 展示名
 * @param {string} [options.description] 一句说明「为什么可以离开」
 * @param {object} options.source 至少提供 status()，其余可选。
 *   **契约**：这些读取函数必须在响应式状态上取值（ref/reactive），
 *   任务中心靠 watch 观测它们来判断何时落到终态。读闭包变量不会被追踪，
 *   结果日志就会静默失效。可选项：message/detail/canCancel/cancelHint/startedAt/cancel。
 * @param {boolean} [options.keepResult] 结束时是否写入结果日志，默认写入
 * @returns {() => void} 注销函数
 */
export function registerTask({ id, title, description = '', source, keepResult = true } = {}) {
  const key = String(id || '').trim()
  if (!key) throw new Error('后台任务必须有 id')
  if (!source || typeof source.status !== 'function') throw new Error(`后台任务 ${key} 缺少 source.status`)
  unregisterTask(key)
  const entry = { id: key, title: String(title || '后台任务'), description: String(description || ''), source }
  // 任务落到终态时记一笔：这样离开面板之后还能回来看到结果
  entry.stopWatch = watch(
    () => taskStatusOf(entry),
    (status, previous) => {
      if (previous === undefined || status === previous) return
      if (!keepResult || !FINISHED_STATUSES.has(status)) return
      recordTaskResult({ id: key, title: entry.title, status, message: taskMessageOf(entry) })
    },
  )
  registry[key] = entry
  return () => unregisterTask(key)
}

/** 清空全部登记与会话提示；仅供测试与安全模式复用。 */
export function resetTaskCenter() {
  for (const key of Object.keys(registry)) unregisterTask(key)
  taskCenterLog.value = []
  unseenCounter.value = 0
}