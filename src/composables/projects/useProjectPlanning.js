import { newProjectId } from '../../services/projects.js'
import { createProjectEditorScope } from './projectEditorScope.js'

function blankMilestone() { return { id: '', title: '', description: '', dueOn: '', revision: 0 } }
function blankDeliveryCheck() { return { id: '', title: '', required: true } }

/**
 * 齐行项目页的「计划」一整套状态与动作：里程碑、交付检查项的定义与开关。
 *
 * 交付检查项里**勾选/写说明**的那次保存（saveDeliveryCheck）不在这个模块：它绑在
 * 服务端返回的检查项对象和 deliveryEvidenceEdits 草稿上，留在视图里跟清单渲染在一起
 * （见 tests/projectsFormErrorBinding.test.js）。
 * 身份判定沿用抽取前两条：表单走自己的编辑作用域，写下走 scopedAction。
 * planningSaveBusy 是这两个表单共用的保存租约（原样保留，没有拆成两个）。
 */
export function useProjectPlanning({ accountContext, projectContext, scopedAction, project, isManager, milestones, projectRequest }) {
  const planningSaveBusy = accountContext.state(false)
  const showMilestoneForm = accountContext.state(false)
  const milestoneDraft = accountContext.state(blankMilestone)
  const editingMilestone = accountContext.state(false)
  const showDeliveryCheckForm = accountContext.state(false)
  const deliveryCheckDraft = accountContext.state(blankDeliveryCheck)
  const milestoneEditor = createProjectEditorScope(projectContext, showMilestoneForm, planningSaveBusy)
  const checkEditor = createProjectEditorScope(projectContext, showDeliveryCheckForm, planningSaveBusy)

  function milestoneTaskLabel(id) { return milestones.value.find((item) => item.id === id)?.title || '' }

  function openMilestoneForm(item = null) {
    if (!isManager.value || project.value?.status !== 'active') return
    editingMilestone.value = Boolean(item)
    milestoneDraft.value = item ? { id: item.id, title: item.title, description: item.description || '', dueOn: item.dueOn || '', revision: item.revision } : { ...blankMilestone(), id: newProjectId() }
    showMilestoneForm.value = true
  }

  function saveMilestone() {
    const draft = milestoneDraft.value
    return scopedAction.run({
      busy: planningSaveBusy, current: milestoneEditor.capture(),
      check: () => Boolean(draft.title.trim()),
      operation: () => (editingMilestone.value
        ? projectRequest('milestone_update', { projectId: project.value.id, milestoneId: draft.id, expectedRevision: draft.revision, title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn })
        : projectRequest('milestone_create', { ...draft, projectId: project.value.id, title: draft.title.trim(), description: draft.description.trim() })),
      commit: () => { showMilestoneForm.value = false },
      success: () => (editingMilestone.value ? '里程碑已更新。' : '里程碑已添加。'),
    })
  }

  function toggleMilestone(item, completed) {
    return scopedAction.run({
      busyValue: `milestone:${item.id}`,
      operation: () => projectRequest('milestone_toggle', { projectId: project.value.id, milestoneId: item.id, completed }),
    })
  }

  function openDeliveryCheckForm() {
    if (!isManager.value || project.value?.status !== 'active') return
    deliveryCheckDraft.value = { ...blankDeliveryCheck(), id: newProjectId() }
    showDeliveryCheckForm.value = true
  }

  function saveDeliveryCheckItem() {
    const draft = deliveryCheckDraft.value
    return scopedAction.run({
      busy: planningSaveBusy, current: checkEditor.capture(),
      check: () => Boolean(draft.title.trim()),
      operation: () => projectRequest('delivery_check_create', { ...draft, projectId: project.value.id, title: draft.title.trim() }),
      commit: () => { showDeliveryCheckForm.value = false },
      success: '交付检查项已添加。',
    })
  }

  return {
    planningSaveBusy, showMilestoneForm, milestoneDraft, editingMilestone, showDeliveryCheckForm, deliveryCheckDraft,
    milestoneTaskLabel, openMilestoneForm, saveMilestone, toggleMilestone, openDeliveryCheckForm, saveDeliveryCheckItem,
  }
}