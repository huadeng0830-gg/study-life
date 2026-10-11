/**
 * 待办页的批量操作。
 *
 * 【为什么撤销要做快照】批量和单条的差别不在动作，而在**一次影响几条**。单条删除可以靠
 * Toast 里那个「撤销」兜底；一次删掉三十条时，用户往往正盯着下一个窗口，没空去点那条几秒
 * 就消失的提示。所以每个批量动作都先把改动前的事实快照下来，撤销时整批还原，
 * 并且在应用后仍以最新的实体为准（`tasks.value` 里重新找），避免把期间用户自己的新编辑覆盖掉。
 *
 * 【改期为什么逐条校验而不是整体套一个位移】`previewTaskTimeShift` 已经处理了这些情况：
 * 已完成的阶段不动、纯日期阶段不会被补成午夜、夏令时不存在的时刻会报错而不是被 Date 悄悄滚走。
 * 直接对整批算一个 `days` 偏移、跳过这些判断，就会把一批待办推到「这个时间点在本时区不存在」
 * 的日期上去。所以每条单独算，有问题的那条跳过并如实报数，不静默吞掉。
 */
import { ref } from 'vue'
import { detectTimePlanConflicts, getConflictSummary } from '../conflictDetection.js'
import { previewTaskTimeShift, undoTaskTimeShift } from './taskTimeShift'

/** @typedef {import('../types/domain').Task} Task */

const BULK_UNDO_MS = 8000

export function useTaskBulkActions({ domain, tasks, selection, notify, nowMs, getExistingItems = () => tasks.value }) {
  /** 待批量改期的条目；空数组表示对话框不显示。 */
  const shiftTargets = ref(/** @type {Task[]} */ ([]))

  function snapshotTiming(task) {
    return {
      id: task.id,
      dueDate: task.dueDate || '',
      dueTime: task.dueTime || '',
      timeStages: JSON.parse(JSON.stringify(task.timeStages || [])),
      repeat: task.repeat,
      repeatAnchorDay: task.repeatAnchorDay ?? null,
    }
  }

  /** 取当前选中的实体并清空选择——四个动作共用这一套「先取后清」的顺序。 */
  function drain(pick = () => true) {
    const targets = selection.selectedTasks(tasks.value).filter((task) => !task.deletedAt && pick(task))
    selection.clear()
    return targets
  }

  function complete(targetIds = null) {
    const targets = targetIds
      ? tasks.value.filter((task) => targetIds.includes(task.id) && !task.deletedAt && !task.archivedAt && !['archived', 'cancelled', 'completed'].includes(task.status) && task.done !== true)
      : drain((task) => !task.archivedAt && !['archived', 'cancelled', 'completed'].includes(task.status) && task.done !== true)
    if (targetIds) selection.clear()
    if (!targets.length) return

    const completed = []
    for (const task of targets) {
      const before = {
        done: task.done === true,
        status: task.status || 'pending',
        completedAt: task.completedAt || null,
        repeatGeneratedAt: task.repeatGeneratedAt || null,
        repeatGenerationError: task.repeatGenerationError,
      }
      const knownIds = new Set(tasks.value.map((item) => item.id))
      domain.completeTask(task.id)
      const current = tasks.value.find((item) => item.id === task.id)
      if (!current || current.status !== 'completed' && current.done !== true) continue
      const generated = tasks.value
        .filter((item) => !knownIds.has(item.id))
        .map((item) => ({ id: item.id, updatedAt: item.updatedAt }))
      completed.push({ id: task.id, before, completedAt: current.completedAt || null, generated })
    }
    if (!completed.length) return

    notify(`已完成 ${completed.length} 项待办`, {
      type: 'success',
      actionLabel: '撤销',
      duration: BULK_UNDO_MS,
      undoFn: () => {
        for (const entry of completed) {
          const live = tasks.value.find((task) => task.id === entry.id)
          if (!live || live.status !== 'completed' && live.done !== true || (live.completedAt || null) !== entry.completedAt) continue
          let retainedNext = false
          for (const generated of entry.generated) {
            const next = tasks.value.find((task) => task.id === generated.id)
            if (!next) continue
            if (next.updatedAt === generated.updatedAt) domain.deleteTask(next.id)
            else retainedNext = true
          }
          domain.updateTask(live.id, {
            ...entry.before,
            ...(retainedNext ? { repeatGeneratedAt: live.repeatGeneratedAt } : {}),
          })
        }
      },
    })
  }

  function archive() {
    const targets = drain((task) => !task.archivedAt && task.status !== 'archived' && (task.status === 'completed' || task.done === true))
    if (!targets.length) return
    const ids = targets.map((task) => task.id)
    for (const id of ids) domain.archiveTask(id)
    notify(`已归档 ${ids.length} 项待办`, {
      type: 'success',
      actionLabel: '撤销',
      duration: BULK_UNDO_MS,
      undoFn: () => { for (const id of ids) { if (tasks.value.some((task) => task.id === id)) domain.restoreTask(id) } },
    })
  }

  function remove() {
    const targets = drain()
    if (!targets.length) return
    const snapshots = targets.map((task) => JSON.parse(JSON.stringify(task)))
    for (const task of targets) domain.deleteTask(task.id)
    notify(`已删除 ${snapshots.length} 项待办`, {
      type: 'warning',
      actionLabel: '撤销',
      duration: BULK_UNDO_MS,
      undoFn: () => snapshots.forEach((task) => domain.restoreDeletedTask(task)),
    })
  }

  function startShift(targets) {
    shiftTargets.value = targets
  }

  /** 先逐条预演，再把整批计划互相比对，避免批量改期把时间冲突直接写入数据。 */
  /** @param {{ direction?: string, days?: number | string }} [options] */
  function previewShift({ direction = 'later', days = 1 } = {}) {
    const targets = shiftTargets.value
    const amount = Number(days)
    if (!targets.length || !Number.isSafeInteger(amount) || !amount) {
      return { error: '请选择要移动的天数', plans: [], skipped: 0, conflicts: [], message: '' }
    }
    if (direction !== 'later' && direction !== 'earlier') return { error: '请选择提前或顺延。', plans: [], skipped: 0, conflicts: [], message: '' }

    const duration = { direction: /** @type {'later' | 'earlier'} */ (direction), days: Math.abs(amount), hours: 0, minutes: 0 }
    const targetIds = new Set(targets.map((task) => task.id))
    const unaffected = getExistingItems().filter((item) => !(targetIds.has(item.id) && (item.dueDate || Array.isArray(item.timeStages))))
    const plans = []
    const conflicts = []
    let skipped = 0
    for (const task of targets) {
      const live = tasks.value.find((item) => item.id === task.id)
      if (!live || live.deletedAt || live.archivedAt || live.status === 'archived') { skipped += 1; continue }
      const { plan, error } = previewTaskTimeShift(live, duration, { nowMs: nowMs() })
      if (error || !plan?.dueDate && !plan?.timeStages?.length) { skipped += 1; continue }
      const candidate = { ...live, ...plan }
      const comparisons = [
        ...unaffected,
        ...plans.map((entry) => ({ ...entry.task, ...entry.plan })),
      ]
      const found = detectTimePlanConflicts(candidate, comparisons)
      conflicts.push(...found)
      plans.push({ id: live.id, updatedAt: live.updatedAt, task: live, plan, before: snapshotTiming(live) })
    }
    const summary = getConflictSummary(conflicts)
    const details = [...new Set(conflicts.map((item) => item.message))]
    const message = summary.hasConflicts ? `${summary.message}\n${details.join('\n')}\n是否仍要应用这批改期？` : ''
    return { error: '', duration, plans, skipped, conflicts, message }
  }

  /** 应用预演过的计划。冲突必须经用户明确确认；过期快照会安全跳过。 */
  /** @param {ReturnType<typeof previewShift>} preview @param {{ allowConflicts?: boolean }} [options] */
  function applyShift(preview, { allowConflicts = false } = {}) {
    if (preview?.error) {
      shiftTargets.value = []
      notify(preview.error, { type: 'warning' })
      return
    }
    if (preview?.conflicts?.length && !allowConflicts) return { needsConfirmation: true }
    shiftTargets.value = []
    const snapshots = []
    let skipped = preview?.skipped || 0
    for (const entry of preview?.plans || []) {
      const live = tasks.value.find((task) => task.id === entry.id)
      if (!live || live.updatedAt !== entry.updatedAt) { skipped += 1; continue }
      domain.updateTask(live.id, entry.plan)
      const updated = tasks.value.find((task) => task.id === entry.id)
      if (updated) snapshots.push({ before: entry.before, after: snapshotTiming(updated) })
    }
    if (!snapshots.length) {
      notify('选中的待办都没有可移动的日期', { type: 'warning' })
      return
    }
    const suffix = [
      skipped ? `${skipped} 项已跳过` : '',
      allowConflicts && preview.conflicts.length ? `确认了 ${preview.conflicts.length} 处时间冲突` : '',
    ].filter(Boolean).join('；')
    notify(`已改期 ${snapshots.length} 项待办${suffix}`, {
      type: 'success',
      actionLabel: '撤销',
      duration: BULK_UNDO_MS,
      undoFn: () => snapshots.forEach(({ before, after }) => {
        const live = tasks.value.find((task) => task.id === before.id)
        if (live) domain.updateTask(live.id, undoTaskTimeShift(live, before, after))
      }),
    })
  }

  return { shiftTargets, complete, archive, remove, startShift, previewShift, applyShift }
}
