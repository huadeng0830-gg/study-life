import { computed, ref, watch } from 'vue'
import { isArchived, taskStatus } from '../domain/state.js'
import { remainingTimeStages, taskHasTime } from './taskTimePlan'
import { useTaskBulkActions } from './useTaskBulkActions.js'
import { useTaskSelection } from './useTaskSelection.js'

/** Owns the list workspace's selection, bulk actions, and confirmation state. */
export function useTaskWorkspaceSelection({ domain, tasks, visibleTasks, showHistory, filter, viewMode, notify, nowMs, getExistingItems }) {
  // Project-sourced rows are read-only here; cancelled and archived rows are also excluded.
  const selectable = (task) => task?.sourceType !== 'project-task' && !isArchived(task) && taskStatus(task) !== 'cancelled'
  const selection = useTaskSelection({ isSelectable: selectable })
  const selectableVisible = computed(() => visibleTasks.value.filter(selectable))
  const selectedVisibleTasks = computed(() => selection.selectedTasks(visibleTasks.value))
  const allSelected = computed(() => selectableVisible.value.length > 0 && selectableVisible.value.every((task) => selection.isSelected(task.id)))
  const bulkCanComplete = computed(() => selectedVisibleTasks.value.some((task) => !['completed', 'cancelled'].includes(taskStatus(task))))
  const bulkCanArchive = computed(() => selectedVisibleTasks.value.length > 0 && selectedVisibleTasks.value.every((task) => taskStatus(task) === 'completed'))
  const bulkCanReschedule = computed(() => selectedVisibleTasks.value.some((task) => taskStatus(task) !== 'completed' && taskStatus(task) !== 'cancelled' && taskHasTime(task)))
  const bulk = useTaskBulkActions({ domain, tasks, selection, notify, nowMs, getExistingItems })
  const bulkCompletionConfirm = ref(null)
  const bulkShiftConfirmation = ref(null)

  // Drop selections that became hidden after edits, filtering, or archiving.
  watch([visibleTasks, showHistory, filter], () => selection.retainVisible(visibleTasks.value))
  watch(viewMode, (next, previous) => {
    if (next === previous) return
    selection.clear()
    bulk.shiftTargets.value = []
    bulkCompletionConfirm.value = null
    bulkShiftConfirmation.value = null
  })

  function completeSelected() {
    const targets = selectedVisibleTasks.value.filter((task) => !['completed', 'cancelled'].includes(taskStatus(task)))
    if (!targets.length) { selection.clear(); return }
    const staged = targets.filter((task) => remainingTimeStages(task, nowMs()).length > 0)
    if (staged.length) {
      bulkCompletionConfirm.value = {
        ids: targets.map((task) => task.id),
        message: `其中 ${staged.length} 项还有待处理阶段。直接完成会停止这些阶段提醒，是否仍要完成全部 ${targets.length} 项？`,
      }
      return
    }
    bulk.complete(targets.map((task) => task.id))
  }

  function confirmBulkComplete() {
    const pending = bulkCompletionConfirm.value
    bulkCompletionConfirm.value = null
    if (pending) bulk.complete(pending.ids)
  }

  function requestBulkShift(change) {
    const preview = bulk.previewShift(change)
    if (preview.conflicts.length) {
      bulk.shiftTargets.value = []
      bulkShiftConfirmation.value = preview
      return
    }
    bulk.applyShift(preview)
  }

  function confirmBulkShift() {
    const preview = bulkShiftConfirmation.value
    bulkShiftConfirmation.value = null
    if (preview) bulk.applyShift(preview, { allowConflicts: true })
  }

  function openBulkShift() {
    const selected = selectedVisibleTasks.value
    const targets = selected.filter((task) => taskStatus(task) !== 'completed' && taskStatus(task) !== 'cancelled' && taskHasTime(task))
    selection.clear()
    if (!targets.length) {
      notify('选中的待办都没有可改期的时间安排')
      return
    }
    if (targets.length < selected.length) notify(`已跳过 ${selected.length - targets.length} 项已完成或没有时间安排的待办`)
    bulk.startShift(targets)
  }

  return {
    selection,
    selectable,
    selectableVisible,
    selectedVisibleTasks,
    allSelected,
    bulkCanComplete,
    bulkCanArchive,
    bulkCanReschedule,
    bulk,
    bulkCompletionConfirm,
    bulkShiftConfirmation,
    completeSelected,
    confirmBulkComplete,
    requestBulkShift,
    confirmBulkShift,
    openBulkShift,
  }
}
