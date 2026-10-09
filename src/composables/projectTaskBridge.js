import { ref, watch } from 'vue'
import { accountUser } from './accountAuth.js'
import { useDomainCommands } from './domain/commands.js'
import { projectRequest } from '../services/projects.js'

const TASK_SYNC_KEY_PREFIX = 'study-life-project-task-sync:'
const projectTaskSyncState = ref({ pending: 0, message: '', syncing: false })
const lastDoneState = new Map()
let started = false
let stopTaskWatch = null
let stopUserWatch = null
let flushing = false

function storageKey(userId) { return userId ? `${TASK_SYNC_KEY_PREFIX}${userId}` : '' }

function readQueue(userId) {
  if (!userId || typeof localStorage === 'undefined') return []
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(userId)) || '[]')
    return Array.isArray(value) ? value.filter((item) => item?.projectId && item?.taskId && ['todo', 'completed'].includes(item.status)) : []
  } catch { return [] }
}

function writeQueue(userId, queue) {
  if (!userId || typeof localStorage === 'undefined') return
  try {
    if (queue.length) localStorage.setItem(storageKey(userId), JSON.stringify(queue))
    else localStorage.removeItem(storageKey(userId))
  } catch { /* 本机存储不可用时保留当前页状态，重新联网后可再次完成。 */ }
}

function updateQueueStatus(userId, message = '') {
  const pending = readQueue(userId).length
  projectTaskSyncState.value = { ...projectTaskSyncState.value, pending, message, syncing: flushing }
}

function enqueue(userId, entry) {
  if (!userId) return
  const queue = readQueue(userId).filter((item) => item.taskId !== entry.taskId)
  queue.push(entry)
  writeQueue(userId, queue)
  updateQueueStatus(userId, '项目待办状态暂未同步，联网后会自动重试。')
}

function seedLocalTaskStatus(tasks = []) {
  lastDoneState.clear()
  for (const task of tasks) {
    if (task?.sourceType === 'project-task') lastDoneState.set(String(task.id), Boolean(task.done))
  }
}

async function sendStatus(userId, entry) {
  if (accountUser.value?.id !== userId || typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue(userId, entry)
    return false
  }
  try {
    await projectRequest('task_personal_sync', entry)
    return true
  } catch (error) {
    if (isFinalTaskSyncError(error)) {
      await reconcileProjectTaskTodos(userId, entry.projectId)
      return false
    }
    enqueue(userId, entry)
    return false
  }
}

function isFinalTaskSyncError(error) {
  const status = Number(error?.status)
  return status >= 400 && status < 500 && ![401, 408, 429].includes(status)
}

async function reconcileProjectTaskTodos(userId, projectId) {
  if (!projectId || accountUser.value?.id !== userId) return
  const domain = useDomainCommands()
  try {
    const result = await projectRequest('detail', { projectId })
    if (accountUser.value?.id !== userId) return
    const acceptedTasks = (result?.tasks || []).filter((task) => task.assigneeId === userId && task.assignmentStatus === 'accepted')
    for (const task of acceptedTasks) ensureProjectTaskTodo(task, result.project, domain)
    detachProjectTaskTodos(projectId, acceptedTasks.map((task) => task.id), domain)
  } catch (error) {
    // 项目不可访问时，保留待办内容并解除团队关联，避免旧账号继续同步。
    if ([403, 404].includes(error?.status) && accountUser.value?.id === userId) detachProjectTaskTodos(projectId, [], domain)
  }
}

async function flushQueue(userId = accountUser.value?.id) {
  if (!userId || flushing || accountUser.value?.id !== userId) return
  flushing = true
  updateQueueStatus(userId, projectTaskSyncState.value.message)
  try {
    const queue = readQueue(userId)
    const remaining = []
    for (const entry of queue) {
      if (accountUser.value?.id !== userId) return
      try {
        await projectRequest('task_personal_sync', entry)
      } catch (error) {
        if (isFinalTaskSyncError(error)) await reconcileProjectTaskTodos(userId, entry.projectId)
        else remaining.push(entry)
      }
    }
    writeQueue(userId, remaining)
    projectTaskSyncState.value = {
      pending: remaining.length,
      message: remaining.length ? '项目待办状态暂未同步，联网后会自动重试。' : '',
      syncing: false,
    }
  } finally {
    flushing = false
    if (accountUser.value?.id === userId) updateQueueStatus(userId, projectTaskSyncState.value.message)
  }
}

function inspectLocalTasks(tasks = []) {
  const userId = accountUser.value?.id
  const seen = new Set()
  for (const task of tasks) {
    if (!task || task.sourceType !== 'project-task' || !task.sourceId || !task.relationId) continue
    const localId = String(task.id)
    const done = Boolean(task.done)
    seen.add(localId)
    if (!lastDoneState.has(localId)) {
      lastDoneState.set(localId, done)
      continue
    }
    if (lastDoneState.get(localId) === done) continue
    lastDoneState.set(localId, done)
    if (userId) void sendStatus(userId, { projectId: task.relationId, taskId: task.sourceId, status: done ? 'completed' : 'todo' })
  }
  for (const localId of lastDoneState.keys()) if (!seen.has(localId)) lastDoneState.delete(localId)
}

export function startProjectTaskBridge() {
  if (started) return
  started = true
  const domain = useDomainCommands()
  seedLocalTaskStatus(domain.tasks.value)
  // tasks 使用 shallowRef，并通过 touchStoredRef 显式提交。浅监听只在提交时
  // 检查一次，避免 Vue 每次遍历整份待办树来做 deep watch。
  stopTaskWatch = watch(domain.tasks, (tasks) => inspectLocalTasks(tasks), { flush: 'post' })
  stopUserWatch = watch(accountUser, (user) => {
    seedLocalTaskStatus(domain.tasks.value)
    if (user?.id) {
      updateQueueStatus(user.id)
      void flushQueue(user.id)
    } else projectTaskSyncState.value = { pending: 0, message: '', syncing: false }
  }, { immediate: true })
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline)
}

function onOnline() { void flushQueue() }

export function stopProjectTaskBridge() {
  stopTaskWatch?.()
  stopUserWatch?.()
  stopTaskWatch = null
  stopUserWatch = null
  if (typeof window !== 'undefined') window.removeEventListener('online', onOnline)
  started = false
}

export function useProjectTaskSyncState() { return projectTaskSyncState }

export function rememberProjectTaskDone(localTaskId, done) {
  lastDoneState.set(String(localTaskId), Boolean(done))
}

export function ensureProjectTaskTodo(task, project, domain = useDomainCommands()) {
  if (!task?.id || !project?.id || !domain?.tasks?.value) return null
  const done = task.status === 'completed'
  const priority = task.priority === 'low' ? 'low' : ['high', 'urgent'].includes(task.priority) ? 'high' : 'normal'
  const existing = domain.tasks.value.find((item) => item.sourceType === 'project-task' && item.sourceId === task.id)
  if (existing) {
    const completedAt = done ? (task.completedAt || existing.completedAt || new Date().toISOString()) : null
    const update = {
      title: task.title,
      dueDate: task.dueOn || '',
      priority,
      note: task.description || '',
      done,
      status: done ? 'completed' : 'pending',
      completedAt,
      relationId: project.id,
    }
    if (Object.hasOwn(task, 'workCheckpoint')) update.workCheckpoint = task.workCheckpoint
    const changed = Object.entries(update).some(([key, value]) => {
      if (key === 'workCheckpoint') return JSON.stringify(existing[key] ?? null) !== JSON.stringify(value ?? null)
      if (key === 'completedAt') return (existing[key] || null) !== (value || null)
      return existing[key] !== value
    })
    rememberProjectTaskDone(existing.id, done)
    if (changed) domain.updateTask(existing.id, update)
    rememberProjectTaskDone(existing.id, done)
    return existing
  }
  const created = domain.createTask({
    title: task.title,
    dueDate: task.dueOn || '',
    priority,
    note: task.description || '',
    sourceType: 'project-task',
    sourceId: task.id,
    relationId: project.id,
    createdFrom: 'project-team',
    ...(Object.hasOwn(task, 'workCheckpoint') ? { workCheckpoint: task.workCheckpoint } : {}),
  })
  rememberProjectTaskDone(created.id, false)
  if (done) {
    domain.updateTask(created.id, { done: true, status: 'completed', completedAt: task.completedAt || new Date().toISOString() })
    rememberProjectTaskDone(created.id, true)
  }
  return created
}

export function setProjectTaskTodoStatus(task, project, status, domain = useDomainCommands()) {
  if (!task?.id || !project?.id || !domain?.tasks?.value) return null
  const done = status === 'completed'
  const local = domain.tasks.value.find((item) => item.sourceType === 'project-task' && item.sourceId === task.id)
  if (!local) return null
  rememberProjectTaskDone(local.id, done)
  domain.updateTask(local.id, {
    done,
    status: done ? 'completed' : 'pending',
    completedAt: done ? new Date().toISOString() : null,
  })
  rememberProjectTaskDone(local.id, done)
  return local
}

export function detachProjectTaskTodos(projectId, retainedTaskIds = [], domain = useDomainCommands()) {
  if (!projectId || !domain?.tasks?.value) return 0
  const retained = new Set(retainedTaskIds.map(String))
  const linked = domain.tasks.value.filter((task) => task.sourceType === 'project-task' && task.relationId === projectId && !retained.has(String(task.sourceId)))
  for (const task of linked) domain.updateTask(task.id, { sourceType: '', sourceId: '', relationId: '' })
  return linked.length
}
