import { computed, ref, type Ref } from 'vue'
import type { Task } from '../../types/domain'
import { remainingTimeStages, taskStages } from './taskTimePlan'

type TaskWithRepeat = Task & { repeatGeneratedAt?: string | null }
interface ActionDomain {
  tasks: Ref<TaskWithRepeat[]>
  toggleTask: (id: string) => unknown
  updateTask: (id: string, data: Partial<TaskWithRepeat>) => unknown
  deleteTask: (id: string) => unknown
  setTaskStageCompleted: (id: string, stageId: string, completed: boolean, finishTask: boolean) => unknown
}
type Notify = (message: string, options: { type: string; actionLabel: string; duration: number; undoFn: () => unknown }) => void

/** 完成确认与撤销在所有待办视图共用，阶段结束不会触发整体完成。 */
export function useTaskStageActions({ domain, now, notify }: { domain: ActionDomain; now: Ref<Date>; notify: Notify }) {
  const completionTarget = ref<TaskWithRepeat | null>(null)
  const completionMessage = computed(() => {
    const remaining = remainingTimeStages(completionTarget.value || {}, now.value.getTime())
    const waiting = remaining.filter((stage) => stage.completionRequired === false).length
    return `“${completionTarget.value?.title || ''}”还有 ${remaining.length} 个阶段待处理${waiting ? `，其中 ${waiting} 个正在等待后续` : ''}。直接完成整个事项会停止所有阶段提醒。是否继续？`
  })

  function perform(task: TaskWithRepeat, operation: () => unknown, message: string) {
    const facts = new Map(taskStages(task).map((stage) => [stage.id, stage.completedAt || null]))
    const before = { done: task.done, status: task.status || 'pending', completedAt: task.completedAt || null, repeatGeneratedAt: task.repeatGeneratedAt || null, repeatGenerationError: task.repeatGenerationError }
    const knownIds = new Set(domain.tasks.value.map((item) => item.id))
    if (!operation()) return
    const generated = domain.tasks.value.filter((item) => !knownIds.has(item.id)).map((item) => ({ id: item.id, updatedAt: item.updatedAt }))
    notify(`${message}${task.repeatGenerationError ? `。${task.repeatGenerationError}` : ''}`, { type: 'success', actionLabel: '撤销', duration: task.repeatGenerationError ? 12_000 : 6000, undoFn: () => {
      const current = domain.tasks.value.find((item) => item.id === task.id)
      if (!current) return
      let retainedNext = false
      for (const entry of generated) {
        const next = domain.tasks.value.find((item) => item.id === entry.id)
        if (!next) continue
        if (next.updatedAt === entry.updatedAt) domain.deleteTask(next.id)
        else retainedNext = true
      }
      return domain.updateTask(current.id, {
        ...before,
        ...(retainedNext ? { repeatGeneratedAt: current.repeatGeneratedAt } : {}),
        ...(current.timeStages ? { timeStages: taskStages(current).map((stage) => ({ ...stage, ...(facts.has(stage.id) ? { completedAt: facts.get(stage.id) } : {}) })) } : {}),
      })
    } })
  }
  function toggle(task: TaskWithRepeat) {
    const current = domain.tasks.value.find((item) => item.id === task.id)
    if (!current) return
    if (!current.done && current.status !== 'completed' && remainingTimeStages(current, now.value.getTime()).length) {
      completionTarget.value = current
      return
    }
    perform(current, () => domain.toggleTask(current.id), current.done || current.status === 'completed' ? '已恢复待办' : '事项已完成')
  }
  function confirmWhole() {
    const current = domain.tasks.value.find((item) => item.id === completionTarget.value?.id)
    completionTarget.value = null
    if (current && !current.done && current.status !== 'completed') perform(current, () => domain.toggleTask(current.id), '事项已完成')
  }
  function completeStage(task: TaskWithRepeat, stageId: string) {
    const current = domain.tasks.value.find((item) => item.id === task.id)
    if (!current) return
    const stage = taskStages(current).find((item) => item.id === stageId)
    if (!stage || stage.completedAt || stage.completionRequired === false) return
    const finishTask = remainingTimeStages(current, now.value.getTime()).length === 1
    perform(current, () => domain.setTaskStageCompleted(current.id, stageId, true, finishTask), finishTask ? '最后阶段与事项已完成' : `“${stage.label}”已完成，后续安排继续保留`)
  }
  return { completionTarget, completionMessage, toggle, confirmWhole, completeStage }
}
