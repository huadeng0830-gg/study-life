import { PROJECT_TASK_STATUS } from '../../services/projects.js'

export function taskEventLabel(event) {
  if (event?.type === 'updated' && event.details?.source === 'workbench') {
    const checkpoint = event.details.workCheckpoint || {}
    if (checkpoint.nextStep) return `保存进度 · 下一步：${checkpoint.nextStep}`
    if (checkpoint.blocker) return `保存进度 · 卡点：${checkpoint.blocker}`
    if (checkpoint.lastStep) return `保存进度 · 上次做到：${checkpoint.lastStep}`
    return '清除工作进度'
  }
  return ({
    created: '创建任务', assigned: '更新负责人', assignment_accepted: '接受分工',
    assignment_declined: '拒绝分工', updated: '更新任务信息',
    status_changed: `状态更新为${PROJECT_TASK_STATUS[event.details?.to] || '已变更'}`,
    member_left: '负责人退出项目，任务已释放', member_removed: '负责人已移出项目，任务已释放',
  })[event?.type] || '记录了进展'
}
