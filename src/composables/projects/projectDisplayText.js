/**
 * 齐行项目页的纯文案/日期映射。
 *
 * 【为什么单独放】这一组函数只做「值 → 中文文本」，不读任何响应式状态、不发请求，
 * 从视图里搬出来不会改变任何判定；继续留在 1500 行的视图里，只会让下一次瘦身
 * 又要重新判断"这几行到底能不能动"。同目录已有 taskEventLabel.js / projectTaskSelectors.js
 * 这两份"纯映射单独成文件"的先例。
 *
 * 【文案是契约】这些文本会直接出现在界面上（状态、成员角色、动态记录、截止日期），
 * 改动必须走 tests/projectDisplayText.test.js 的冻结断言，避免顺手改字。
 */

/** 截止日期（YYYY-MM-DD 或 ISO 串）→「X 月 X 日」；空值返回空串。 */
export function formatDate(value) {
  if (!value) return ''
  const [, month, day] = String(value).slice(0, 10).split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}

/** 下一天（YYYY-MM-DD）；空值按"今天"算。用于日期输入框的 min。 */
export function nextDay(value) {
  const day = value ? new Date(`${value}T00:00:00`) : new Date()
  day.setDate(day.getDate() + 1)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/** 成员角色 → 中文。 */
export function roleLabel(role) { return ({ owner: '负责人', admin: '管理员', member: '成员' })[role] || '成员' }

/** 成果版本状态 → 中文（含版本号）。 */
export function deliverableStatus(item) {
  const latest = item.versions?.[0]
  if (!latest) return item.required ? '等待提交' : '选填'
  return ({ pending: `V${latest.number} 等待验收`, approved: `V${latest.number} 已通过`, returned: `V${latest.number} 需修改`, not_required: `V${latest.number} 已提交` })[latest.reviewStatus] || `V${latest.number}`
}

/** 任务调整申请状态 → 中文。 */
export function adjustmentStatus(status) {
  return ({ pending: '处理中', approved: '已通过', rejected: '已拒绝', cancelled: '已撤回', stale: '任务已变化' })[status] || '已更新'
}

/** 项目动态记录 → 中文动作说明。 */
export function activityLabel(item) {
  const labels = {
    project_created: '创建了项目', project_updated: '更新了项目资料', project_archived: '归档了项目',
    project_restored: '恢复了项目', project_deleted: '删除了项目', member_invited: '邀请了新成员',
    invite_link_created: '创建了邀请链接', member_joined: '加入了项目', member_declined: '拒绝了邀请',
    member_left: '退出了项目', member_removed: '移出了成员', owner_transferred: '转交了负责人',
    member_role_changed: '调整了成员权限',
    task_created: '创建了任务', task_assigned: '分配了任务',
    adjustment_requested: '发起了任务调整申请', adjustment_decided: '处理了任务调整申请',
    deliverable_created: '添加了交付项', result_submitted: '提交了成果版本', review_completed: '完成了成果验收',
    milestone_created: '添加了项目里程碑', milestone_updated: '更新了项目里程碑',
    delivery_check_created: '添加了交付检查项', delivery_check_updated: '更新了交付检查项',
    meeting_created: '发起了小组讨论', meeting_status_changed: '更新了小组讨论安排',
  }
  return labels[item.type] || '更新了项目'
}