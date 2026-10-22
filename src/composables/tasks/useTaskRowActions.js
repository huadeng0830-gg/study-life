/**
 * 一条待办在行上的「主动作 + 次要菜单」。
 *
 * 【为什么这些规则值得单独一个模块】列表、看板、月历三个视图要给出**完全一致**的操作口径：
 * 哪条是主动作、菜单里有哪些项、哪条是危险的。规则本身有若干条件分支（归档、已完成、齐行任务、
 * 有没有可改期的时间），一旦在三个模板里各写一遍，改一处就会漏另一处——用户会发现
 * 「在列表里能改期，在看板里找不到」。所以规则集中在这里，视图只传动作函数。
 */
import { isArchived, taskStatus } from '../domain/state.js'

/**
 * @param {{
 *   openProjectTask: (task: object) => void,
 *   openEditTask: (task: object, stageId?: string) => void,
 *   openReschedule: (task: object) => void,
 *   openWorkSession: (task: object) => void,
 *   archiveTask: (task: object) => void,
 *   deleteTask: (task: object) => void,
 *   restoreTask: (id: string) => unknown,
 *   startFocusTimer: (task: object) => unknown,
 *   startWork: (task: object) => unknown,
 *   focusMinutes?: number,
 * }} handlers
 */
export function useTaskRowActions(handlers) {
  const {
    openProjectTask,
    openEditTask,
    openReschedule,
    openWorkSession,
    archiveTask,
    deleteTask,
    restoreTask,
    startFocusTimer,
    startWork,
    focusMinutes = 25,
  } = handlers

  /**
   * 主动作直接执行；记录进度与计时分别从次要操作进入。
   * 归档、已完成和已取消的待办没有「进行中」可言，主动作让位给恢复 / 归档等菜单项。
   */
  function primaryOf(task) {
    if (task?.sourceType === 'project-task') return { label: task.workCheckpoint?.nextStep ? '继续' : '查看项目' }
    if (isArchived(task) || ['completed', 'cancelled'].includes(taskStatus(task))) return null
    return { label: task.status === 'in_progress' || task.workCheckpoint?.nextStep ? '继续' : '开始' }
  }

  /** 次要操作清单。顺序按「越危险越靠后」排，取消永远在最后。 */
  function actionsOf(task) {
    // 齐行任务在本页只有主动作「查看项目」——编辑、删除与状态都归项目工作台，
    // 「⋯」里不再重复放一个相同入口。
    if (task?.sourceType === 'project-task') return []
    if (isArchived(task)) return [{ key: 'restore', label: '恢复待办', hint: '从归档历史放回当前清单' }]
    const completed = taskStatus(task) === 'completed'
    const cancelled = taskStatus(task) === 'cancelled'
    const items = []
    if (!completed && !cancelled) {
      items.push({ key: 'focus-timer', label: `专注 ${focusMinutes} 分钟`, hint: '进入专注计时并关联这条待办' })
      items.push({ key: 'work', label: '记进度', hint: '查看上次进度，记下做到哪里和下一步' })
      items.push({ key: 'reschedule', label: task.dueDate || task.startDate || task.timeStages?.length ? '改期' : '设置日期', hint: '调整截止日期，或按需移动整段安排' })
    }
    items.push({ key: 'edit', label: '编辑' })
    if (completed) items.push({ key: 'archive', label: '归档', hint: '从当前清单移走，可在历史找回' })
    items.push({ key: 'remove', label: '删除', tone: 'danger', hint: '删除后短时间内可撤销' })
    return items
  }

  function onPrimary(task) {
    if (task?.sourceType === 'project-task') { openProjectTask(task); return }
    if (!task || isArchived(task) || ['completed', 'cancelled'].includes(taskStatus(task))) return
    startWork(task)
  }

  function onAction(task, key) {
    if (key === 'focus-timer') startFocusTimer(task)
    else if (key === 'work') openWorkSession(task)
    else if (key === 'reschedule') openReschedule(task)
    else if (key === 'edit') openEditTask(task)
    else if (key === 'archive') archiveTask(task)
    else if (key === 'restore') restoreTask(task.id)
    else if (key === 'remove') deleteTask(task)
  }

  return { taskPrimaryOf: primaryOf, taskActionItems: actionsOf, onTaskPrimary: onPrimary, onTaskAction: onAction }
}
