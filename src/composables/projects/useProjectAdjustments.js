import { newProjectId } from '../../services/projects.js'
import { createProjectEditorScope } from './projectEditorScope.js'
import { formatDate } from './projectDisplayText.js'

function blankAdjustment() { return { type: 'deadline_extension', reason: '', dueOn: '', targetId: '', description: '', subtasks: '' } }

/**
 * 齐行项目页的「任务协商 / 调整申请」一整套状态与动作。
 *
 * 身份判定沿用抽取前的两条：
 *   - 表单保存在自己这次访问的编辑作用域里（createProjectEditorScope，换项目/关表单即过期）；
 *   - 提交、通过、退回走 scopedAction（忙态租约 + 项目身份守卫 + 过期响应丢弃）。
 * 状态仍由 accountContext / projectContext 创建，切账号与切项目的复位语义不变。
 */
export function useProjectAdjustments({
  accountContext, projectContext, scopedAction, project, accountUser, isManager, activeMembers, adjustments, projectRequest, reloadProject,
}) {
  const showAdjustmentForm = accountContext.state(false)
  const adjustmentTask = accountContext.state(null)
  const adjustmentDraft = accountContext.state(blankAdjustment)
  const adjustmentSaveBusy = accountContext.state(false)
  const editorScope = createProjectEditorScope(projectContext, showAdjustmentForm, adjustmentSaveBusy)

  function canRequestAdjustment(task) {
    if (!task || project.value?.status !== 'active') return false
    if (task.assigneeId === accountUser.value?.id && task.assignmentStatus === 'accepted') return true
    return isManager.value && Boolean(task.assigneeId) && task.assigneeId !== accountUser.value?.id
  }

  function openAdjustment(task) {
    if (!canRequestAdjustment(task)) return
    adjustmentTask.value = task
    adjustmentDraft.value = { ...blankAdjustment(), dueOn: task.dueOn || '' }
    showAdjustmentForm.value = true
  }

  function adjustmentRequestData() {
    const draft = adjustmentDraft.value
    if (draft.type === 'deadline_extension') return { dueOn: draft.dueOn }
    if (draft.type === 'help' || draft.type === 'handover') return { targetId: draft.targetId }
    if (draft.type === 'scope_change') return { description: draft.description }
    if (draft.type === 'split') return { subtasks: draft.subtasks.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
    return {}
  }

  function saveAdjustment() {
    const draft = adjustmentDraft.value
    const id = newProjectId()
    const data = adjustmentRequestData()
    return scopedAction.run({
      busy: adjustmentSaveBusy, current: editorScope.capture(),
      check: () => {
        if (!adjustmentTask.value) return false
        if (!id) return '当前环境无法生成安全申请编号。'
        if (!draft.reason.trim()) return '请写明申请原因。'
        if (draft.type === 'split' && (!data.subtasks.length || data.subtasks.length > 8)) return '任务拆分需要填写 1 到 8 个子任务，每行一项。'
        if (['help', 'handover'].includes(draft.type) && !draft.targetId) return '请选择一位项目成员。'
        return true
      },
      operation: () => projectRequest('adjustment_create', {
        id, projectId: project.value.id, taskId: adjustmentTask.value.id, type: draft.type, reason: draft.reason.trim(), data,
      }),
      commit: () => { showAdjustmentForm.value = false },
      success: '调整申请已提交，原任务约定暂时保持不变。',
      reload: reloadProject,
    })
  }

  function canRespondAdjustment(request) {
    if (request?.status !== 'pending' || request.requesterId === accountUser.value?.id) return false
    return request.approverId ? request.approverId === accountUser.value?.id : isManager.value
  }

  function adjustmentTypeLabel(type) {
    return ({ deadline_extension: '延期', help: '寻求帮助', scope_change: '调整范围', split: '拆分任务', handover: '任务交接', unable_to_continue: '无法继续承担' })[type] || '任务调整'
  }

  function adjustmentDataSummary(request) {
    const data = request.data || {}
    if (request.type === 'deadline_extension') return `申请截止日期：${formatDate(data.dueOn)}`
    if (request.type === 'scope_change') return `拟调整说明：${data.description || '未填写'}`
    if (request.type === 'split') return `拆分为：${(data.subtasks || []).join('、')}`
    if (['help', 'handover'].includes(request.type)) {
      const target = activeMembers.value.find((member) => member.userId === data.targetId)
      return `${request.type === 'help' ? '请求协助：' : '拟交接给：'}${target?.nickname || '项目成员'}`
    }
    return '申请释放当前分工。'
  }

  function decideAdjustment(request, decision) {
    return scopedAction.run({
      busyValue: `adjustment:${request.id}`,
      operation: () => projectRequest('adjustment_decide', { projectId: project.value.id, requestId: request.id, decision, decisionNote: '' }),
      success: decision === 'approve' ? '申请已通过，任务调整已生效。' : '申请已退回，原任务约定保持不变。',
      reload: reloadProject,
    })
  }

  function cancelAdjustment(request) {
    return scopedAction.run({
      busyValue: `adjustment:${request.id}`,
      operation: () => projectRequest('adjustment_cancel', { projectId: project.value.id, requestId: request.id }),
      success: '申请已撤回。',
      reload: reloadProject,
    })
  }

  function canAddAdjustment(task) {
    return canRequestAdjustment(task) && !adjustments.value.some((request) => request.taskId === task.id && request.requesterId === accountUser.value?.id && request.status === 'pending')
  }

  return {
    showAdjustmentForm, adjustmentTask, adjustmentDraft, adjustmentSaveBusy,
    canRequestAdjustment, openAdjustment, saveAdjustment, canRespondAdjustment,
    adjustmentTypeLabel, adjustmentDataSummary, decideAdjustment, cancelAdjustment, canAddAdjustment,
  }
}