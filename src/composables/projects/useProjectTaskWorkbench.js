import { computed, ref } from 'vue'
import { normalizeTaskWorkCheckpoint } from '../tasks/taskWorkProgress.js'
import { PROJECT_TASK_STATUS } from '../../services/projects.js'

/**
 * Owns the project-task resume loop while keeping project tasks in their existing store.
 * Checkpoint reads are optional; writes use the injected project request adapter.
 * @param {Record<string, any>} dependencies
 */
export function useProjectTaskWorkbench({
  project, tasks, isManager, accountUser, actionBusy, checkpointError,
  projectRequest, loadProject, changeTaskStatus, notify, describeError,
}) {
  const task = ref(null)
  const draft = ref({ checkpointLastStep: '', checkpointBlocker: '', checkpointNextStep: '', checkpointResources: '' })
  const error = ref('')
  const busy = ref(false)
  const baseUpdatedAt = ref(null)

  function canWork(value) {
    if (!value || project.value?.status !== 'active' || value.status === 'completed') return false
    return isManager.value || (value.assigneeId === accountUser.value?.id && value.assignmentStatus === 'accepted')
  }

  function open(value) {
    if (!value) return
    task.value = value
    baseUpdatedAt.value = value.workCheckpointUpdatedAt || value.workCheckpoint?.updatedAt || null
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
    baseUpdatedAt.value = null
  }

  function updateField(field, value) { draft.value[field] = value }

  async function start() {
    const current = task.value
    if (!current || !canWork(current)) return
    if (current.status === 'in_progress') { close(); return }
    if (await changeTaskStatus(current, 'in_progress')) close()
  }

  async function save() {
    const current = task.value
    const currentProject = project.value
    if (!current || !currentProject || !canWork(current) || busy.value) return
    if (checkpointError.value) {
      error.value = '当前无法读取齐行进度，暂时不能保存。请检查网络后重新打开项目。'
      return
    }
    busy.value = true
    error.value = ''
    try {
      const normalized = normalizeTaskWorkCheckpoint({
        lastStep: draft.value.checkpointLastStep,
        blocker: draft.value.checkpointBlocker,
        nextStep: draft.value.checkpointNextStep,
        resources: draft.value.checkpointResources,
      })
      const checkpoint = normalized
        ? { lastStep: normalized.lastStep, blocker: normalized.blocker, nextStep: normalized.nextStep, resources: normalized.resources }
        : { lastStep: '', blocker: '', nextStep: '', resources: [] }
      await projectRequest('task_checkpoint_save', {
        projectId: currentProject.id, taskId: current.id, checkpoint,
        expectedUpdatedAt: baseUpdatedAt.value,
      })
      notify('success', '齐行进度已保存，下次打开项目任务可以继续。')
      await loadProject(currentProject.id)
      const refreshed = tasks.value.find((item) => item.id === current.id)
      if (refreshed) open(refreshed)
      else close()
    } catch (cause) {
      error.value = describeError(cause)
    } finally {
      busy.value = false
    }
  }

  const dialogProps = computed(() => {
    const current = task.value
    return {
      open: Boolean(current), task: current, checkpoint: current?.workCheckpoint,
      checkpointUpdatedAt: current?.workCheckpointUpdatedAt || current?.workCheckpoint?.updatedAt,
      checkpointActorName: current?.workCheckpointActorName, form: draft.value,
      statusLabel: PROJECT_TASK_STATUS[current?.status] || '待开始',
      startLabel: current?.status === 'in_progress' ? '继续执行' : '开始执行',
      canStart: Boolean(canWork(current)), canSave: Boolean(canWork(current) && !checkpointError.value),
      busy: busy.value || Boolean(current && actionBusy.value === `task:${current.id}`),
      error: error.value || (checkpointError.value ? '当前无法读取齐行进度，暂时不能保存；联网后重新打开项目即可重试。' : ''),
      onClose: close, onStart: start, onSave: save, 'onUpdate:field': updateField,
    }
  })

  return { task, error, busy, baseUpdatedAt, open, close, canWork, dialogProps }
}
