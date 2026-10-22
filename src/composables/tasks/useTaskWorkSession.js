import { computed, ref } from 'vue'
import { isArchived, taskStatus } from '../domain/state.js'
import { normalizeTaskWorkCheckpoint } from './taskWorkProgress.js'

const emptyDraft = () => ({ checkpointLastStep: '', checkpointBlocker: '', checkpointNextStep: '', checkpointResources: '' })

/**
 * Owns the personal-task resume flow: load the last checkpoint, start work,
 * and save a checkpoint back onto the existing task record.
 * @param {{ domain: { updateTask: Function }, openProjectTask: Function, notify: Function }} dependencies
 */
export function useTaskWorkSession({ domain, openProjectTask, notify }) {
  /** @type {import('vue').Ref<import('../../types/domain').Task | null>} */
  const task = ref(null)
  const draft = ref(emptyDraft())
  const error = ref('')
  const busy = ref(false)
  const statusLabel = computed(() => !task.value ? '' : task.value.status === 'in_progress'
    ? '进行中' : taskStatus(task.value) === 'overdue' ? '已逾期' : '待开始')
  const startLabel = computed(() => task.value?.status === 'in_progress' ? '继续执行' : '开始执行')

  function open(value) {
    if (value?.sourceType === 'project-task') { openProjectTask(value); return }
    if (!value || isArchived(value) || taskStatus(value) === 'completed') return
    task.value = value
    draft.value = {
      checkpointLastStep: value.workCheckpoint?.lastStep || '',
      checkpointBlocker: value.workCheckpoint?.blocker || '',
      checkpointNextStep: value.workCheckpoint?.nextStep || '',
      checkpointResources: value.workCheckpoint?.resources?.join('\n') || '',
    }
    error.value = ''
  }

  function close() {
    task.value = null
    error.value = ''
  }

  function updateField(field, value) { draft.value[field] = value }

  function start(value = task.value) {
    if (value?.sourceType === 'project-task') { openProjectTask(value); return }
    if (!value || isArchived(value) || ['completed', 'cancelled'].includes(taskStatus(value))) return
    const wasInProgress = value.status === 'in_progress'
    try {
      if (value.status !== 'in_progress' && domain.updateTask(value.id, { status: 'in_progress', done: false, completedAt: null }) === null) {
        throw new Error('这条待办已不存在，请刷新列表后重试。')
      }
      close()
      notify(wasInProgress ? '继续执行，原有进度已保留。' : '已开始执行；任务进度会保留在这条待办里。', { type: 'success' })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '暂时无法开始，请重试。'
      error.value = message
      notify(message, { type: 'error' })
    }
  }

  function save() {
    const current = task.value
    if (!current || busy.value) return
    busy.value = true
    error.value = ''
    try {
      const workCheckpoint = normalizeTaskWorkCheckpoint({
        lastStep: draft.value.checkpointLastStep,
        blocker: draft.value.checkpointBlocker,
        nextStep: draft.value.checkpointNextStep,
        resources: draft.value.checkpointResources,
      })
      domain.updateTask(current.id, { workCheckpoint })
      close()
      notify('进度已保存，下次打开任务可以继续。', { type: 'success' })
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '请检查进度内容。'
    } finally {
      busy.value = false
    }
  }

  return { task, draft, error, busy, statusLabel, startLabel, open, close, updateField, start, save }
}
