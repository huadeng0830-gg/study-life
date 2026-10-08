<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { socialRequest } from '../services/social.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import Modal from '../components/Modal.vue'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { announce as announceLive, announceAlert } from '../composables/liveRegion.js'
import { detachProjectTaskTodos, ensureProjectTaskTodo, setProjectTaskTodoStatus, useProjectTaskSyncState } from '../composables/projectTaskBridge.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { syncProjectMeetingEvents, detachProjectMeetingEvents } from '../composables/projectMeetingBridge.js'
import {
  newProjectId, PROJECT_TASK_PRIORITY, PROJECT_TASK_STATUS, PROJECT_TYPE_LABELS, PROJECT_TYPES,
  getProjectDeliverableFileUrl, projectRequest, uploadProjectDeliverableFile, validateProjectForm,
} from '../services/projects.js'
import { dateInZone, wallTimeToEpoch, zonedParts } from '../../supabase/functions/campus-social/availability.js'
import { formatDateTime } from '../composables/intlFormatters.js'

const route = useRoute()
const router = useRouter()
const domain = useDomainCommands()
const taskSync = useProjectTaskSyncState()

const projects = ref([])
const selectedProjectId = ref('')
const project = ref(null)
const members = ref([])
const tasks = ref([])
const milestones = ref([])
const deliveryChecks = ref([])
const activities = ref([])
const adjustments = ref([])
const deliverables = ref([])
const meetings = ref([])
const inbox = ref({ invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [] })
const friends = ref([])
const inviteLinks = ref([])
const activeSection = ref('tasks')
const showArchived = ref(false)
const pageLoading = ref(false)
const detailLoading = ref(false)
const pageError = ref('')
const notice = ref(null)
const actionBusy = ref('')
const showProjectForm = ref(false)
const editingProject = ref(false)
const projectDraft = ref(blankProject())
const projectRequestId = ref('')
const showTaskForm = ref(false)
const taskDraft = ref(blankTask())
const editingTask = ref(false)
const showAdjustmentForm = ref(false)
const adjustmentTask = ref(null)
const adjustmentDraft = ref(blankAdjustment())
const showDeliverableForm = ref(false)
const deliverableDraft = ref(blankDeliverable())
const showDeliverableEditor = ref(false)
const activeDeliverable = ref(null)
const draftContent = ref(blankDeliverableContent())
const draftRevision = ref(0)
const changeNote = ref('')
const fileUploadBusy = ref(false)
const reviewTarget = ref(null)
const reviewFeedback = ref('')
const reviewChecklist = ref([{ item: '符合交付要求', passed: false }])
const showInviteForm = ref(false)
const selectedFriendId = ref('')
const friendsLoading = ref(false)
const linkBusy = ref(false)
const linkToShare = ref('')
const taskEvents = ref([])
const taskEventsTitle = ref('')
const confirmAction = ref(null)
const lastDeletedProjectId = ref('')
const transferTargetId = ref('')
const joiningToken = ref('')
const showMilestoneForm = ref(false)
const milestoneDraft = ref(blankMilestone())
const editingMilestone = ref(false)
const showDeliveryCheckForm = ref(false)
const deliveryCheckDraft = ref(blankDeliveryCheck())
const showMeetingForm = ref(false)
const meetingDraft = ref(blankMeeting())
const meetingProposalTarget = ref(null)
const scheduleAvailability = ref(null)
const scheduleDays = ref(7)
const scheduleBusy = ref(false)
const scheduleError = ref('')
const scheduleTimezone = ref('Asia/Shanghai')
const projectSaveBusy = ref(false)
const taskSaveBusy = ref(false)
const adjustmentSaveBusy = ref(false)
const deliverableSaveBusy = ref(false)
const reviewSaveBusy = ref(false)
const planningSaveBusy = ref(false)
const statusFilter = ref('open')
const visibleTaskLimit = ref(50)
let detailLoadSequence = 0
let availabilitySequence = 0

const isSignedIn = computed(() => Boolean(accountUser.value?.id))
const isManager = computed(() => ['owner', 'admin'].includes(project.value?.role))
const isOwner = computed(() => project.value?.role === 'owner')
const visibleProjects = computed(() => projects.value.filter((item) => showArchived.value ? item.status === 'archived' : item.status === 'active'))
const filteredTasks = computed(() => {
  const list = tasks.value.filter((task) => !task.parentTaskId)
  return statusFilter.value === 'all' ? list : list.filter((task) => statusFilter.value === 'done' ? task.status === 'completed' : task.status !== 'completed')
})
const visibleTasks = computed(() => filteredTasks.value.slice(0, visibleTaskLimit.value))
const remainingTaskCount = computed(() => Math.max(0, filteredTasks.value.length - visibleTasks.value.length))
const dependencyTaskOptions = computed(() => tasks.value.filter((task) => task.id !== taskDraft.value.id))
const deliverableTaskOptions = computed(() => {
  const assignedTaskIds = new Set(deliverables.value.map((item) => item.taskId).filter(Boolean))
  return tasks.value.filter((task) => !task.parentTaskId && !assignedTaskIds.has(task.id))
})
const subtasksByParent = computed(() => {
  const grouped = new Map()
  for (const task of tasks.value) {
    if (!task?.parentTaskId) continue
    const children = grouped.get(task.parentTaskId) || []
    children.push(task)
    grouped.set(task.parentTaskId, children)
  }
  return grouped
})
const assignedSubtasks = (taskId) => subtasksByParent.value.get(taskId) || []
function isTaskDependencyBlocked(task) { return Boolean(task?.dependsOnTaskId && task.dependencyStatus !== 'completed') }
const activeMembers = computed(() => members.value.filter((member) => member.status === 'active'))
const pendingMemberInvites = computed(() => members.value.filter((member) => member.status === 'invited'))
const pendingInboxCount = computed(() => inbox.value.invitations.length + inbox.value.assignments.length + inbox.value.adjustments.length + inbox.value.reviews.length + inbox.value.meetings.length)
const projectFormTitle = computed(() => editingProject.value ? '编辑项目' : '新建项目')
const projectRisks = computed(() => {
  if (!project.value) return []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const soon = new Date(today)
  soon.setDate(soon.getDate() + 3)
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const soonKey = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  const risks = []
  for (const task of tasks.value) {
    if (task.status === 'completed' || !task.dueOn) continue
    if (task.dueOn < todayKey) risks.push(`任务「${task.title}」已超过截止日期`)
    else if (task.dueOn <= soonKey) risks.push(`任务「${task.title}」将在三天内截止`)
  }
  for (const task of tasks.value) if (task.status !== 'completed' && isTaskDependencyBlocked(task)) risks.push(`任务「${task.title}」等待前置任务「${task.dependencyTaskTitle}」完成`)
  for (const item of deliverables.value) if (item.required && !item.versions?.length) risks.push(`必需成果「${item.title}」尚未提交`)
  for (const check of deliveryChecks.value) if (check.required && !check.checked) risks.push(`交付检查「${check.title}」尚未完成`)
  if (inbox.value.reviews.some((item) => item.projectId === project.value.id)) risks.push('有成果等待你验收')
  if (inbox.value.adjustments.some((item) => item.projectId === project.value.id)) risks.push('有任务调整申请等待你处理')
  if (inbox.value.meetings.some((item) => item.projectId === project.value.id)) risks.push('有小组讨论邀请或改期建议等待处理')
  return risks.slice(0, 5)
})
const deliveryCenter = computed(() => ({
  completedTasks: tasks.value.filter((task) => task.status === 'completed'),
  missing: deliverables.value.filter((item) => item.required && (!item.versions?.length || (item.reviewRequired && item.versions[0]?.reviewStatus !== 'approved'))),
  awaitingReview: deliverables.value.filter((item) => item.versions?.[0]?.reviewStatus === 'pending'),
  approved: deliverables.value.filter((item) => item.versions?.[0]?.reviewStatus === 'approved'),
}))

function blankProject() {
  return { name: '', description: '', type: 'blank', startsOn: '', targetEndOn: '' }
}

function blankTask(parentTaskId = '') {
  return { id: '', parentTaskId, title: '', description: '', dueOn: '', priority: 'normal', assigneeId: '', milestoneId: '', dependsOnTaskId: '', revision: 0 }
}

function blankAdjustment() { return { type: 'deadline_extension', reason: '', dueOn: '', targetId: '', description: '', subtasks: '' } }
function blankDeliverable() { return { id: '', taskId: '', title: '', instructions: '', reviewerId: '', required: true, reviewRequired: true } }
function blankDeliverableContent() { return { summary: '', links: [], files: [] } }
function blankMilestone() { return { id: '', title: '', description: '', dueOn: '', revision: 0 } }
function blankDeliveryCheck() { return { id: '', title: '', required: true } }
function blankMeeting() { return { id: '', title: '', note: '', startsLocal: '', endsLocal: '' } }

function notify(kind, text) {
  notice.value = text ? { kind, text } : null
  if (!text) return
  if (kind === 'error') announceAlert(text, { clearAfter: 7000 })
  else announceLive(text, { clearAfter: 5000 })
}

function errorMessage(error, fallback = '操作没有完成，请稍后重试。') {
  return error?.message || fallback
}

async function loadInbox() {
  if (!isSignedIn.value) return
  inbox.value = await projectRequest('inbox')
}

async function loadProjects({ keepSelected = true } = {}) {
  if (!isSignedIn.value) {
    projects.value = []
    selectedProjectId.value = ''
    project.value = null
    members.value = []
    tasks.value = []
    milestones.value = []
    deliveryChecks.value = []
    adjustments.value = []
    deliverables.value = []
    meetings.value = []
    return
  }
  pageLoading.value = true
  pageError.value = ''
  try {
    const [result] = await Promise.all([projectRequest('list'), loadInbox()])
    projects.value = result.projects || []
    const queryId = String(route.query.project || '')
    const currentId = keepSelected && projects.value.some((item) => item.id === selectedProjectId.value) ? selectedProjectId.value : ''
    const nextId = [queryId, currentId, projects.value[0]?.id].find((id) => id && projects.value.some((item) => item.id === id)) || ''
    selectedProjectId.value = nextId
    if (queryId !== nextId && queryId) await syncProjectQuery(nextId)
    if (nextId) await loadProject(nextId)
    else {
      project.value = null
      members.value = []
      tasks.value = []
      milestones.value = []
      deliveryChecks.value = []
      activities.value = []
      adjustments.value = []
      deliverables.value = []
      meetings.value = []
      await syncProjectQuery('')
    }
  } catch (error) {
    pageError.value = errorMessage(error, '暂时无法读取项目，请检查网络后重试。')
  } finally {
    pageLoading.value = false
  }
}

async function loadProject(id = selectedProjectId.value) {
  if (!isSignedIn.value || !id) return
  visibleTaskLimit.value = 50
  const requestSequence = ++detailLoadSequence
  detailLoading.value = true
  try {
    const [result, adjustmentResult, deliverableResult, meetingResult, profileResult] = await Promise.all([
      projectRequest('detail', { projectId: id }),
      projectRequest('adjustments_list', { projectId: id }),
      projectRequest('deliverables', { projectId: id }),
      projectRequest('meetings_list', { projectId: id }),
      socialRequest('profile_get').catch(() => null),
    ])
    if (requestSequence !== detailLoadSequence || selectedProjectId.value !== id) return
    project.value = result.project
    members.value = result.members || []
    tasks.value = result.tasks || []
    milestones.value = result.milestones || []
    deliveryChecks.value = result.deliveryChecks || []
    activities.value = result.activities || []
    adjustments.value = adjustmentResult.requests || []
    deliverables.value = deliverableResult.deliverables || []
    meetings.value = meetingResult.meetings || []
    scheduleTimezone.value = profileResult?.profile?.timezone || scheduleTimezone.value || 'Asia/Shanghai'
    syncProjectMeetingEvents(id, meetings.value, project.value, domain, accountUser.value?.id, scheduleTimezone.value)
    const acceptedMine = tasks.value.filter((task) => task.assigneeId === accountUser.value?.id && task.assignmentStatus === 'accepted')
    for (const task of acceptedMine) ensureProjectTaskTodo(task, project.value, domain)
    detachProjectTaskTodos(id, acceptedMine.map((task) => task.id), domain)
  } catch (error) {
    if (requestSequence !== detailLoadSequence || selectedProjectId.value !== id) return
    if ([403, 404].includes(error?.status)) detachProjectTaskTodos(id, [], domain)
    if ([403, 404].includes(error?.status)) detachProjectMeetingEvents(id, domain, accountUser.value?.id, scheduleTimezone.value)
    project.value = null
    members.value = []
    tasks.value = []
    milestones.value = []
    deliveryChecks.value = []
    adjustments.value = []
    deliverables.value = []
    meetings.value = []
    pageError.value = errorMessage(error, '暂时无法读取项目内容，请刷新后重试。')
  } finally {
    if (requestSequence === detailLoadSequence) detailLoading.value = false
  }
}

let refreshPromise = null
async function refresh() {
  if (refreshPromise) return refreshPromise
  refreshPromise = loadProjects()
  try {
    return await refreshPromise
  } finally {
    refreshPromise = null
  }
}

async function syncProjectQuery(id) {
  const query = { ...route.query }
  delete query.join
  if (id) query.project = id
  else delete query.project
  if (JSON.stringify(query) !== JSON.stringify(route.query)) await router.replace({ path: '/projects', query })
}

async function selectProject(id) {
  availabilitySequence++
  scheduleAvailability.value = null
  scheduleError.value = ''
  scheduleBusy.value = false
  selectedProjectId.value = id
  activeSection.value = 'tasks'
  await syncProjectQuery(id)
  await loadProject(id)
}

function openCreateProject() {
  editingProject.value = false
  projectDraft.value = blankProject()
  projectRequestId.value = newProjectId()
  showProjectForm.value = true
}

function openEditProject() {
  if (!project.value || !isManager.value) return
  editingProject.value = true
  projectDraft.value = {
    name: project.value.name || '', description: project.value.description || '', type: project.value.type || 'blank',
    startsOn: project.value.startsOn || '', targetEndOn: project.value.targetEndOn || '',
  }
  showProjectForm.value = true
}

async function saveProject() {
  const validated = validateProjectForm(projectDraft.value)
  if (!validated.ok) { notify('error', validated.message); return }
  if (projectSaveBusy.value) return
  if (!editingProject.value && !projectRequestId.value) { notify('error', '当前环境无法生成安全项目编号，请更新浏览器后重试。'); return }
  projectSaveBusy.value = true
  try {
    if (editingProject.value) {
      await projectRequest('update', { projectId: project.value.id, expectedRevision: project.value.revision, ...validated.value })
      notify('success', '项目已保存。')
      showProjectForm.value = false
      await refresh()
    } else {
      const result = await projectRequest('create', { id: projectRequestId.value, ...validated.value })
      showProjectForm.value = false
      notify('success', '项目已创建。')
      await loadProjects({ keepSelected: false })
      if (result.projectId) await selectProject(result.projectId)
    }
  } catch (error) {
    notify('error', errorMessage(error))
  } finally { projectSaveBusy.value = false }
}

function askConfirm(action) { confirmAction.value = action }

async function runConfirmedAction() {
  const action = confirmAction.value
  if (!action || actionBusy.value) return
  actionBusy.value = action.kind
  try {
    if (action.kind === 'archive') {
      await projectRequest('archive', { projectId: project.value.id, archived: true })
      showArchived.value = true
      notify('success', '项目已归档。')
    } else if (action.kind === 'restore') {
      await projectRequest('archive', { projectId: action.projectId || project.value?.id, archived: false })
      showArchived.value = false
      notify('success', '项目已恢复。')
    } else if (action.kind === 'delete') {
      await projectRequest('delete', { projectId: project.value.id })
      lastDeletedProjectId.value = project.value.id
      notify('success', '项目已移入回收站。你可以立即撤销。')
      confirmAction.value = null
      await loadProjects({ keepSelected: false })
      return
    } else if (action.kind === 'leave') {
      await projectRequest('member_leave', { projectId: project.value.id })
      detachProjectTaskTodos(project.value.id, [], domain)
      notify('success', '你已退出项目。')
    } else if (action.kind === 'remove') {
      await projectRequest('member_remove', { projectId: project.value.id, targetId: action.targetId })
      notify('success', '成员已移出项目。')
    } else if (action.kind === 'decline-invite') {
      await projectRequest('invite_respond', { projectId: action.projectId, decision: 'decline' })
      notify('success', '已拒绝项目邀请。')
    } else if (action.kind === 'delete-milestone') {
      await projectRequest('milestone_delete', { projectId: project.value.id, milestoneId: action.milestoneId })
      notify('success', '里程碑已删除，关联任务仍会保留。')
    } else if (action.kind === 'meeting-cancel') {
      await projectRequest('meeting_cancel', { projectId: project.value.id, meetingId: action.meetingId })
      notify('success', '讨论邀约已取消。')
    } else if (action.kind === 'meeting-confirm') {
      await projectRequest('meeting_confirm', { projectId: project.value.id, meetingId: action.meetingId })
      notify('success', '讨论已确认，并加入已接受成员的个人日程。')
    } else if (action.kind === 'meeting-apply-proposal') {
      await projectRequest('meeting_apply_proposal', { projectId: project.value.id, meetingId: action.meetingId, participantId: action.participantId })
      notify('success', '已采用建议时间，成员需要重新确认。')
    } else if (action.kind === 'delivery-check-delete') {
      await projectRequest('delivery_check_delete', { projectId: project.value.id, checkId: action.checkId })
      notify('success', '交付检查项已删除。')
    }
    confirmAction.value = null
    await refresh()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function acceptProjectInvite(projectId) {
  actionBusy.value = `invite:${projectId}`
  try {
    await projectRequest('invite_respond', { projectId, decision: 'accept' })
    notify('success', '已加入项目。')
    await loadProjects({ keepSelected: false })
    await selectProject(projectId)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function openTaskCreate(parentTaskId = '') {
  if (project.value?.status !== 'active') return
  editingTask.value = false
  taskDraft.value = blankTask(parentTaskId)
  taskDraft.value.id = newProjectId()
  showTaskForm.value = true
}

function openTaskEdit(task) {
  if (!task || !isManager.value || project.value?.status !== 'active') return
  editingTask.value = true
  taskDraft.value = {
    id: task.id, parentTaskId: task.parentTaskId || '', title: task.title || '',
    description: task.description || '', dueOn: task.dueOn || '', priority: task.priority || 'normal',
    assigneeId: task.assigneeId || '', milestoneId: task.milestoneId || '', dependsOnTaskId: task.dependsOnTaskId || '', revision: task.revision,
  }
  showTaskForm.value = true
}

async function saveTask() {
  const title = taskDraft.value.title.trim()
  if (!title) { notify('error', '请填写任务标题。'); return }
  if (title.length > 160 || taskDraft.value.description.length > 3000) { notify('error', '任务标题或说明超出长度限制。'); return }
  if (taskSaveBusy.value || !taskDraft.value.id) return
  taskSaveBusy.value = true
  try {
    if (editingTask.value) {
      await projectRequest('task_update', {
        projectId: project.value.id, taskId: taskDraft.value.id, expectedRevision: taskDraft.value.revision,
        title, description: taskDraft.value.description.trim(), dueOn: taskDraft.value.dueOn,
        priority: taskDraft.value.priority, assigneeId: taskDraft.value.assigneeId, milestoneId: taskDraft.value.milestoneId,
        dependsOnTaskId: taskDraft.value.dependsOnTaskId,
      })
    } else {
      await projectRequest('task_create', { ...taskDraft.value, projectId: project.value.id, title, description: taskDraft.value.description.trim() })
    }
    showTaskForm.value = false
    notify('success', editingTask.value ? '任务已更新。' : '任务已添加。')
    editingTask.value = false
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { taskSaveBusy.value = false }
}

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

async function saveAdjustment() {
  if (adjustmentSaveBusy.value || !adjustmentTask.value) return
  const id = newProjectId()
  const data = adjustmentRequestData()
  if (!id) { notify('error', '当前环境无法生成安全申请编号。'); return }
  if (!adjustmentDraft.value.reason.trim()) { notify('error', '请写明申请原因。'); return }
  if (adjustmentDraft.value.type === 'split' && (!data.subtasks.length || data.subtasks.length > 8)) { notify('error', '任务拆分需要填写 1 到 8 个子任务，每行一项。'); return }
  if (['help', 'handover'].includes(adjustmentDraft.value.type) && !adjustmentDraft.value.targetId) { notify('error', '请选择一位项目成员。'); return }
  adjustmentSaveBusy.value = true
  try {
    await projectRequest('adjustment_create', {
      id, projectId: project.value.id, taskId: adjustmentTask.value.id,
      type: adjustmentDraft.value.type, reason: adjustmentDraft.value.reason.trim(), data,
    })
    showAdjustmentForm.value = false
    notify('success', '调整申请已提交，原任务约定暂时保持不变。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { adjustmentSaveBusy.value = false }
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

async function decideAdjustment(request, decision) {
  actionBusy.value = `adjustment:${request.id}`
  try {
    await projectRequest('adjustment_decide', { projectId: project.value.id, requestId: request.id, decision, decisionNote: '' })
    notify('success', decision === 'approve' ? '申请已通过，任务调整已生效。' : '申请已退回，原任务约定保持不变。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function cancelAdjustment(request) {
  actionBusy.value = `adjustment:${request.id}`
  try {
    await projectRequest('adjustment_cancel', { projectId: project.value.id, requestId: request.id })
    notify('success', '申请已撤回。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function openDeliverableCreate() {
  if (!isManager.value || project.value?.status !== 'active') return
  deliverableDraft.value = blankDeliverable()
  deliverableDraft.value.id = newProjectId()
  showDeliverableForm.value = true
}

async function saveDeliverable() {
  const draft = deliverableDraft.value
  if (!draft.title.trim()) { notify('error', '请填写交付项名称。'); return }
  if (deliverableSaveBusy.value || !draft.id) return
  deliverableSaveBusy.value = true
  try {
    await projectRequest('deliverable_create', { ...draft, projectId: project.value.id, title: draft.title.trim(), instructions: draft.instructions.trim() })
    showDeliverableForm.value = false
    notify('success', '交付项已添加。')
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { deliverableSaveBusy.value = false }
}

function openDeliverableEditor(item) {
  activeDeliverable.value = item
  const content = item.draft?.content || blankDeliverableContent()
  draftContent.value = { summary: content.summary || '', links: [...(content.links || [])], files: [...(content.files || [])] }
  draftRevision.value = item.draft?.revision || 0
  changeNote.value = ''
  showDeliverableEditor.value = true
}

function addContentLink() { draftContent.value.links.push({ type: 'document', title: '', url: '' }) }

async function uploadDeliverableFiles(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length || fileUploadBusy.value || !activeDeliverable.value) return
  fileUploadBusy.value = true
  try {
    for (const file of files) {
      const uploaded = await uploadProjectDeliverableFile(project.value.id, activeDeliverable.value.id, file)
      draftContent.value.files.push(uploaded)
    }
    notify('success', `已添加 ${files.length} 个成果文件，请保存草稿后再正式提交。`)
  } catch (error) { notify('error', errorMessage(error, '文件上传失败。')) }
  finally { fileUploadBusy.value = false }
}

async function saveDeliverableDraft() {
  if (!activeDeliverable.value || deliverableSaveBusy.value) return
  const deliverableId = activeDeliverable.value.id
  deliverableSaveBusy.value = true
  try {
    const result = await projectRequest('deliverable_draft_save', {
      projectId: project.value.id, deliverableId,
      expectedRevision: draftRevision.value, content: draftContent.value,
    })
    draftRevision.value = result.revision
    notify('success', '草稿已保存。')
    await loadProject(project.value.id)
    activeDeliverable.value = deliverables.value.find((item) => item.id === deliverableId) || activeDeliverable.value
  } catch (error) { notify('error', errorMessage(error)) }
  finally { deliverableSaveBusy.value = false }
}

function submissionKey(deliverableId) {
  const key = `study-life-project-submit:${accountUser.value?.id}:${deliverableId}:${draftRevision.value}`
  try {
    const stored = localStorage.getItem(key)
    if (stored) return stored
    const created = newProjectId()
    if (created) localStorage.setItem(key, created)
    return created
  } catch { return newProjectId() }
}

async function submitDeliverable() {
  if (!activeDeliverable.value || !draftRevision.value || deliverableSaveBusy.value) return
  const key = submissionKey(activeDeliverable.value.id)
  const versionId = newProjectId()
  if (!key || !versionId) { notify('error', '当前环境无法生成安全版本编号。'); return }
  deliverableSaveBusy.value = true
  try {
    const result = await projectRequest('deliverable_submit', {
      projectId: project.value.id, deliverableId: activeDeliverable.value.id,
      versionId, submissionKey: key, changeNote: changeNote.value.trim(),
    })
    try { localStorage.removeItem(`study-life-project-submit:${accountUser.value?.id}:${activeDeliverable.value.id}:${draftRevision.value}`) } catch { /* 不影响已经提交的版本。 */ }
    showDeliverableEditor.value = false
    activeDeliverable.value = null
    notify('success', `成果 V${result.version} 已正式提交。`)
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { deliverableSaveBusy.value = false }
}

function openReview(item, version) {
  reviewTarget.value = { deliverableId: item.id, versionId: version.id }
  reviewFeedback.value = ''
  reviewChecklist.value = [{ item: '符合交付要求', passed: false }]
}

function canReview(item, version) {
  if (project.value?.status !== 'active' || version.reviewStatus !== 'pending' || version.submittedBy === accountUser.value?.id) return false
  return item.reviewerId ? item.reviewerId === accountUser.value?.id : isManager.value
}

function canEditDeliverable(item) {
  if (project.value?.status !== 'active') return false
  const latest = item.versions?.[0]
  if (latest?.reviewStatus === 'pending') return false
  if (!item.taskId) return true
  const task = tasks.value.find((entry) => entry.id === item.taskId)
  return isManager.value || (task?.assigneeId === accountUser.value?.id && task.assignmentStatus === 'accepted')
}

function deliverableStatus(item) {
  const latest = item.versions?.[0]
  if (!latest) return item.required ? '等待提交' : '选填'
  return ({ pending: `V${latest.number} 等待验收`, approved: `V${latest.number} 已通过`, returned: `V${latest.number} 需修改`, not_required: `V${latest.number} 已提交` })[latest.reviewStatus] || `V${latest.number}`
}

function adjustmentStatus(status) {
  return ({ pending: '处理中', approved: '已通过', rejected: '已拒绝', cancelled: '已撤回', stale: '任务已变化' })[status] || '已更新'
}

function openInboxAdjustment(item) {
  void selectProject(item.projectId).then(() => { activeSection.value = 'adjustments' })
}

function openInboxReview(item) {
  void selectProject(item.projectId).then(() => { activeSection.value = 'deliverables' })
}

function canAddAdjustment(task) {
  return canRequestAdjustment(task) && !adjustments.value.some((request) => request.taskId === task.id && request.requesterId === accountUser.value?.id && request.status === 'pending')
}

function addReviewChecklistItem() {
  if (reviewChecklist.value.length < 20) reviewChecklist.value.push({ item: '', passed: false })
}

function milestoneTaskLabel(id) { return milestones.value.find((item) => item.id === id)?.title || '' }

function openMilestoneForm(item = null) {
  if (!isManager.value || project.value?.status !== 'active') return
  editingMilestone.value = Boolean(item)
  milestoneDraft.value = item ? { id: item.id, title: item.title, description: item.description || '', dueOn: item.dueOn || '', revision: item.revision } : { ...blankMilestone(), id: newProjectId() }
  showMilestoneForm.value = true
}

async function saveMilestone() {
  const draft = milestoneDraft.value
  if (!draft.title.trim() || planningSaveBusy.value) return
  planningSaveBusy.value = true
  try {
    if (editingMilestone.value) await projectRequest('milestone_update', { projectId: project.value.id, milestoneId: draft.id, expectedRevision: draft.revision, title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn })
    else await projectRequest('milestone_create', { ...draft, projectId: project.value.id, title: draft.title.trim(), description: draft.description.trim() })
    showMilestoneForm.value = false
    notify('success', editingMilestone.value ? '里程碑已更新。' : '里程碑已添加。')
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { planningSaveBusy.value = false }
}

async function toggleMilestone(item, completed) {
  actionBusy.value = `milestone:${item.id}`
  try {
    await projectRequest('milestone_toggle', { projectId: project.value.id, milestoneId: item.id, completed })
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function openDeliveryCheckForm() {
  if (!isManager.value || project.value?.status !== 'active') return
  deliveryCheckDraft.value = { ...blankDeliveryCheck(), id: newProjectId() }
  showDeliveryCheckForm.value = true
}

async function saveDeliveryCheckItem() {
  const draft = deliveryCheckDraft.value
  if (!draft.title.trim() || planningSaveBusy.value) return
  planningSaveBusy.value = true
  try {
    await projectRequest('delivery_check_create', { ...draft, projectId: project.value.id, title: draft.title.trim() })
    showDeliveryCheckForm.value = false
    notify('success', '交付检查项已添加。')
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { planningSaveBusy.value = false }
}

async function saveDeliveryCheck(item, checked = item.checked) {
  if (actionBusy.value) return
  actionBusy.value = `delivery-check:${item.id}`
  try {
    await projectRequest('delivery_check_update', { projectId: project.value.id, checkId: item.id, expectedRevision: item.revision, checked, evidence: item.evidence || '' })
    notify('success', checked ? '交付检查已记录。' : '交付检查已重新打开。')
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function localInputForEpoch(epoch) {
  const zone = scheduleTimezone.value || 'Asia/Shanghai'
  const parts = zonedParts(epoch, zone)
  return `${dateInZone(epoch, zone)}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function epochForLocalInput(value, edge = 'start') {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value || '')
  return match ? wallTimeToEpoch(match[1], match[2], scheduleTimezone.value || 'Asia/Shanghai', edge) : null
}

function formatProjectTime(value) {
  return formatDateTime(value, { timeZone: scheduleTimezone.value || 'Asia/Shanghai', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

async function queryGroupAvailability(days = scheduleDays.value) {
  if (!project.value || activeMembers.value.length < 2 || scheduleBusy.value) return
  const projectId = project.value.id
  const requestSequence = ++availabilitySequence
  scheduleDays.value = days
  scheduleBusy.value = true
  scheduleError.value = ''
  scheduleAvailability.value = null
  try {
    const [result, profileResult] = await Promise.all([
      projectRequest('time_availability', { projectId, days }),
      socialRequest('profile_get'),
    ])
    if (requestSequence !== availabilitySequence || selectedProjectId.value !== projectId) return
    scheduleTimezone.value = profileResult.profile?.timezone || 'Asia/Shanghai'
    scheduleAvailability.value = result
  } catch (error) {
    if (requestSequence === availabilitySequence && selectedProjectId.value === projectId) scheduleError.value = errorMessage(error, '暂时无法计算共同时间，请检查课表同步后重试。')
  } finally {
    if (requestSequence === availabilitySequence) scheduleBusy.value = false
  }
}

function openMeetingForm(slot = null) {
  if (project.value?.status !== 'active' || activeMembers.value.length < 2) return
  meetingProposalTarget.value = null
  meetingDraft.value = { ...blankMeeting(), id: newProjectId() }
  if (slot) {
    const start = Date.parse(slot.startsAt)
    const end = Math.min(Date.parse(slot.endsAt), start + (scheduleAvailability.value?.minimumMinutes || 90) * 60_000)
    meetingDraft.value.startsLocal = localInputForEpoch(start)
    meetingDraft.value.endsLocal = localInputForEpoch(end)
  }
  showMeetingForm.value = true
}

function openMeetingProposal(meeting) {
  meetingProposalTarget.value = meeting
  meetingDraft.value = {
    ...blankMeeting(), title: meeting.title, note: meeting.note || '',
    startsLocal: localInputForEpoch(Date.parse(meeting.startsAt)), endsLocal: localInputForEpoch(Date.parse(meeting.endsAt)),
  }
  showMeetingForm.value = true
}

async function saveMeetingForm() {
  const draft = meetingDraft.value
  const start = epochForLocalInput(draft.startsLocal, 'start')
  const end = epochForLocalInput(draft.endsLocal, 'end')
  if (start === null || end === null || start <= Date.now() || end <= start || end - start > 8 * 60 * 60_000) { notify('error', '请选择有效的未来时间，讨论时长不能超过 8 小时；时区切换附近不存在的本地时间不能使用。'); return }
  if (meetingProposalTarget.value) {
    await respondMeeting(meetingProposalTarget.value, 'propose', new Date(start).toISOString(), new Date(end).toISOString())
    return
  }
  if (!draft.title.trim()) { notify('error', '请填写讨论主题。'); return }
  const id = draft.id || newProjectId()
  actionBusy.value = 'meeting-create'
  try {
    await projectRequest('meeting_create', { id, projectId: project.value.id, title: draft.title.trim(), note: draft.note.trim(), startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() })
    showMeetingForm.value = false
    notify('success', '讨论邀请已发送，成员确认后可以加入个人日程。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function respondMeeting(meeting, response, proposedStartsAt = '', proposedEndsAt = '') {
  actionBusy.value = `meeting:${meeting.id}`
  try {
    await projectRequest('meeting_respond', { projectId: project.value.id, meetingId: meeting.id, response, proposedStartsAt, proposedEndsAt })
    showMeetingForm.value = false
    meetingProposalTarget.value = null
    notify('success', response === 'accept' ? '已接受讨论时间。' : response === 'decline' ? '已拒绝讨论邀请。' : '改期建议已发送，等待组织者回应。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function meetingCanConfirm(meeting) {
  return (meeting.createdBy === accountUser.value?.id || isManager.value) && meeting.status === 'open'
    && meeting.participants?.length > 0 && meeting.participants.every((item) => item.status === 'accepted')
}

function meetingStatusLabel(status) { return ({ open: '等待回应', confirmed: '已确认', cancelled: '已取消' })[status] || '等待回应' }
function meetingParticipantStatus(status) { return ({ invited: '待回应', accepted: '已接受', declined: '已拒绝', proposed: '建议改期' })[status] || '待回应' }

function openInboxMeeting(item) {
  void selectProject(item.projectId).then(() => { activeSection.value = 'schedule' })
}

async function decideReview(result) {
  if (!reviewTarget.value || reviewSaveBusy.value) return
  if (!reviewFeedback.value.trim()) { notify('error', '请填写具体验收意见。'); return }
  if (result === 'approved' && reviewChecklist.value.some((item) => !item.passed)) { notify('error', '请先通过所有检查项，或将成果退回修改。'); return }
  reviewSaveBusy.value = true
  try {
    await projectRequest('deliverable_review', {
      projectId: project.value.id, deliverableId: reviewTarget.value.deliverableId,
      versionId: reviewTarget.value.versionId, result, feedback: reviewFeedback.value.trim(), checklist: reviewChecklist.value,
    })
    reviewTarget.value = null
    notify('success', result === 'approved' ? '成果已通过验收。' : '成果已退回修改。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { reviewSaveBusy.value = false }
}

async function openDeliverableFile(file) {
  try {
    const url = await getProjectDeliverableFileUrl(file.path)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    anchor.click()
  } catch (error) { notify('error', errorMessage(error, '暂时无法打开成果文件。')) }
}

async function respondTask(task, decision) {
  actionBusy.value = `task:${task.id}`
  try {
    const result = await projectRequest('task_respond', { projectId: project.value.id, taskId: task.id, decision })
    if (result.assignmentStatus === 'accepted') ensureProjectTaskTodo({ ...task, ...result }, project.value, domain)
    notify('success', decision === 'accept' ? '已接受分工，任务已加入你的个人待办。' : '已拒绝分工，负责人会看到需要重新安排。')
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function changeTaskStatus(task, status) {
  actionBusy.value = `task:${task.id}`
  try {
    await projectRequest('task_status', { projectId: project.value.id, taskId: task.id, status })
    setProjectTaskTodoStatus(task, project.value, status, domain)
    notify('success', status === 'completed' ? '任务已完成。' : `任务状态已更新为「${PROJECT_TASK_STATUS[status]}」。`)
    await loadProject(project.value.id)
    await loadInbox()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function loadFriends() {
  friendsLoading.value = true
  try {
    const result = await socialRequest('friends_list')
    friends.value = (result.friends || []).filter((item) => item.profile?.userId && !members.value.some((member) => member.userId === item.profile.userId && member.status !== 'left'))
  } catch (error) { notify('error', errorMessage(error)) }
  finally { friendsLoading.value = false }
}

async function inviteFriend() {
  if (!selectedFriendId.value) { notify('error', '请选择一位好友。'); return }
  actionBusy.value = 'invite-friend'
  try {
    await projectRequest('invite_member', { projectId: project.value.id, targetId: selectedFriendId.value })
    notify('success', '邀请已发送，对方可在齐行中接受或拒绝。')
    selectedFriendId.value = ''
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function loadInviteLinks() {
  try {
    const result = await projectRequest('invites', { projectId: project.value.id })
    inviteLinks.value = result.links || []
  } catch (error) { notify('error', errorMessage(error)) }
}

function makeInviteToken() {
  const bytes = new Uint8Array(32)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (!globalThis.crypto?.getRandomValues) return ''
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function inviteUrl(token) {
  const base = window.location.href.split('#')[0]
  return `${base}#/projects?join=${encodeURIComponent(token)}`
}

async function createInviteLink() {
  if (linkBusy.value) return
  const token = makeInviteToken()
  const id = newProjectId()
  if (!token || !id) { notify('error', '当前环境无法生成安全邀请链接。'); return }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  linkBusy.value = true
  try {
    await projectRequest('invite_link_create', { id, projectId: project.value.id, token, expiresAt, maxUses: 5 })
    linkToShare.value = inviteUrl(token)
    await loadInviteLinks()
    try { await navigator.clipboard.writeText(linkToShare.value); notify('success', '邀请链接已创建并复制，可加入 5 人，7 天后过期。') }
    catch { notify('success', '邀请链接已创建，请复制下方链接分享。') }
  } catch (error) { notify('error', errorMessage(error)) }
  finally { linkBusy.value = false }
}

async function copyInviteLink(url) {
  try { await navigator.clipboard.writeText(url); notify('success', '邀请链接已复制。') }
  catch { notify('error', '无法访问剪贴板，请长按链接手动复制。') }
}

async function revokeInviteLink(linkId) {
  actionBusy.value = `link:${linkId}`
  try {
    await projectRequest('invite_link_revoke', { projectId: project.value.id, linkId })
    notify('success', '邀请链接已停用。')
    await loadInviteLinks()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function loadTaskEvents(task) {
  taskEventsTitle.value = task.title
  try {
    const result = await projectRequest('task_events', { projectId: project.value.id, taskId: task.id })
    taskEvents.value = result.events || []
  } catch (error) { notify('error', errorMessage(error)) }
}

async function transferOwner() {
  if (!transferTargetId.value || actionBusy.value) return
  actionBusy.value = 'transfer-owner'
  try {
    await projectRequest('owner_transfer', { projectId: project.value.id, targetId: transferTargetId.value })
    transferTargetId.value = ''
    notify('success', '项目负责人已转交。')
    await refresh()
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function changeMemberRole(member) {
  if (!isOwner.value || project.value?.status !== 'active' || actionBusy.value || !member?.userId || member.role === 'owner') return
  const role = member.role === 'admin' ? 'member' : 'admin'
  actionBusy.value = `role:${member.userId}`
  try {
    await projectRequest('member_role_update', { projectId: project.value.id, targetId: member.userId, role })
    notify('success', role === 'admin' ? '已设为管理员。' : '已调整为普通成员。')
    await loadProject(project.value.id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

async function processJoinLink() {
  const token = String(route.query.join || '')
  if (!token || joiningToken.value === token) return
  if (!accountUser.value?.id) {
    notify('info', '请先登录并完成邮箱验证，再加入项目。')
    accountOpen.value = true
    return
  }
  joiningToken.value = token
  try {
    const result = await projectRequest('invite_join', { token })
    notify('success', '已加入项目。')
    await loadProjects({ keepSelected: false })
    await selectProject(result.projectId)
  } catch (error) { notify('error', errorMessage(error, '邀请链接无效或已过期。')) }
  finally {
    joiningToken.value = ''
  }
}

async function undoDeleteProject() {
  if (!lastDeletedProjectId.value || actionBusy.value) return
  const id = lastDeletedProjectId.value
  actionBusy.value = 'restore-deleted'
  try {
    await projectRequest('restore', { projectId: id })
    lastDeletedProjectId.value = ''
    notify('success', '项目已恢复。')
    await loadProjects({ keepSelected: false })
    await selectProject(id)
  } catch (error) { notify('error', errorMessage(error)) }
  finally { actionBusy.value = '' }
}

function formatDate(value) {
  if (!value) return ''
  const [, month, day] = String(value).slice(0, 10).split('-')
  return `${Number(month)} 月 ${Number(day)} 日`
}
function nextDay(value) {
  const day = value ? new Date(`${value}T00:00:00`) : new Date()
  day.setDate(day.getDate() + 1)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

function roleLabel(role) { return ({ owner: '负责人', admin: '管理员', member: '成员' })[role] || '成员' }
function taskAssignmentLabel(task) {
  if (!task.assigneeId) return '未分配'
  if (task.assignmentStatus === 'pending') return task.assigneeId === accountUser.value?.id ? '等待你确认' : '等待接受'
  if (task.assignmentStatus === 'declined') return '已拒绝，待重新分配'
  return `负责人：${task.assigneeName || members.value.find((item) => item.userId === task.assigneeId)?.nickname || '成员'}`
}
function activityLabel(item) {
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

watch(() => accountUser.value?.id, (id) => {
  if (id) void refresh()
  else {
    projects.value = []; project.value = null; members.value = []; tasks.value = []; milestones.value = []; deliveryChecks.value = []; adjustments.value = []; deliverables.value = []; meetings.value = []; inbox.value = { invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [] }
  }
}, { immediate: true })
watch(() => route.query.project, (id) => {
  if (id && id !== selectedProjectId.value && projects.value.some((item) => item.id === id)) void selectProject(String(id))
})
watch(() => route.query.join, () => { void processJoinLink() })
watch(() => accountUser.value?.id, () => { void processJoinLink() })

let refreshTimer = 0
let lastAutomaticRefreshAt = 0
const AUTO_REFRESH_INTERVAL = 120_000
function refreshAutomatically() {
  if (document.visibilityState !== 'visible' || route.path !== '/projects' || !isSignedIn.value) return
  const now = Date.now()
  // focus 和 visibilitychange 经常在同一轮恢复时连续触发；合并它们，避免重复请求。
  if (now - lastAutomaticRefreshAt < 30_000) return
  lastAutomaticRefreshAt = now
  void refresh()
}
function onWindowFocus() { refreshAutomatically() }

onMounted(() => {
  void processJoinLink()
  refreshTimer = window.setInterval(refreshAutomatically, AUTO_REFRESH_INTERVAL)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onWindowFocus)
})
onBeforeUnmount(() => {
  window.clearInterval(refreshTimer)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onWindowFocus)
})
</script>

<template>
  <div class="page projects-page">
    <header class="page-head projects-head">
      <div>
        <p class="eyebrow">三两事 · 项目协作</p>
        <h1>齐行</h1>
        <p class="page-subtitle">一个人可以管理项目，需要时再邀请队友一起推进。</p>
      </div>
      <div class="projects-head-actions">
        <button class="btn btn-ghost" type="button" :disabled="pageLoading" @click="refresh">刷新</button>
        <button class="btn btn-primary" type="button" :disabled="!isSignedIn" @click="openCreateProject">新建项目</button>
      </div>
    </header>

    <div v-if="notice" class="projects-notice" :class="`is-${notice.kind}`">
      <span>{{ notice.text }}</span><button v-if="lastDeletedProjectId" class="projects-undo" type="button" :disabled="actionBusy === 'restore-deleted'" @click="undoDeleteProject">撤销删除</button><button type="button" aria-label="关闭提示" @click="notice = null">×</button>
    </div>
    <div v-if="taskSync.pending" class="projects-notice is-warning" role="status">
      <span>{{ taskSync.message }} 尚有 {{ taskSync.pending }} 项。</span>
    </div>
    <p v-if="pageError" class="projects-error" role="alert">{{ pageError }}</p>

    <section v-if="!isSignedIn" class="projects-signin panel">
      <div class="projects-signin-icon" aria-hidden="true">🧩</div>
      <div>
        <h2>登录后创建和同步项目</h2>
        <p>项目数据独立于个人课表与私人待办。登录后可以先自己管理项目，也可以邀请队友加入。</p>
      </div>
      <button class="btn btn-primary" type="button" @click="accountOpen = true">登录或注册</button>
    </section>

    <template v-else>
      <section v-if="pendingInboxCount" class="projects-inbox panel" aria-labelledby="projects-inbox-title">
        <div class="projects-section-head">
          <div><h2 id="projects-inbox-title">我需要处理</h2><p>确认分工、回应申请或验收成果会在这里提醒你。</p></div>
          <span class="projects-count">{{ pendingInboxCount }}</span>
        </div>
        <div v-for="invite in inbox.invitations" :key="`invite-${invite.projectId}`" class="projects-inbox-row">
          <div><strong>{{ invite.projectName }}</strong><span>项目邀请 · {{ PROJECT_TYPE_LABELS[invite.type] || '项目' }}</span></div>
          <div class="projects-row-actions">
            <button class="btn btn-ghost" type="button" :disabled="actionBusy === `invite:${invite.projectId}`" @click="askConfirm({ kind: 'decline-invite', projectId: invite.projectId })">拒绝</button>
            <button class="btn btn-primary" type="button" :disabled="actionBusy === `invite:${invite.projectId}`" @click="acceptProjectInvite(invite.projectId)">接受</button>
          </div>
        </div>
        <div v-for="assignment in inbox.assignments" :key="`assignment-${assignment.taskId}`" class="projects-inbox-row">
          <div><strong>{{ assignment.title }}</strong><span>{{ assignment.projectName }} · 等待你确认分工</span></div>
          <button class="btn btn-ghost" type="button" @click="selectProject(assignment.projectId)">查看任务</button>
        </div>
        <div v-for="request in inbox.adjustments" :key="`adjustment-${request.requestId}`" class="projects-inbox-row">
          <div><strong>{{ request.taskTitle }} · {{ adjustmentTypeLabel(request.type) }}</strong><span>{{ request.projectName }} · {{ request.requesterName }}：{{ request.reason }}</span></div>
          <button class="btn btn-ghost" type="button" @click="openInboxAdjustment(request)">处理申请</button>
        </div>
        <div v-for="review in inbox.reviews" :key="`review-${review.versionId}`" class="projects-inbox-row">
          <div><strong>{{ review.deliverableTitle }} · V{{ review.version }}</strong><span>{{ review.projectName }} · {{ review.submitterName }}提交，等待验收</span></div>
          <button class="btn btn-ghost" type="button" @click="openInboxReview(review)">查看成果</button>
        </div>
        <div v-for="meeting in inbox.meetings" :key="`meeting-${meeting.meetingId}`" class="projects-inbox-row">
          <div><strong>{{ meeting.title }}</strong><span>{{ meeting.projectName }} · {{ meeting.participantStatus === 'proposed' ? '有成员提出改期建议' : '等待你回应讨论邀请' }} · {{ formatProjectTime(meeting.startsAt) }}</span></div>
          <button class="btn btn-ghost" type="button" @click="openInboxMeeting(meeting)">查看讨论</button>
        </div>
      </section>

      <section class="projects-layout">
        <aside id="project-list" class="projects-rail panel" aria-label="项目列表">
          <div class="projects-rail-head">
            <h2>我的项目</h2>
            <button class="icon-btn" type="button" :aria-expanded="showArchived" aria-controls="project-list" :aria-label="showArchived ? '显示进行中项目' : '显示已归档项目'" :title="showArchived ? '显示进行中项目' : '显示已归档项目'" @click="showArchived = !showArchived">{{ showArchived ? '↶' : '▱' }}</button>
          </div>
          <p v-if="showArchived" class="projects-rail-hint">已归档项目</p>
          <button v-for="item in visibleProjects" :key="item.id" class="project-list-item" :class="{ active: item.id === selectedProjectId }" type="button" @click="selectProject(item.id)">
            <span class="project-list-icon" aria-hidden="true">{{ ({ course: '📚', competition: '🏁', research: '🔬', software: '💻', event: '🎪', blank: '🧩' })[item.type] || '🧩' }}</span>
            <span class="project-list-copy"><strong>{{ item.name }}</strong><small>{{ PROJECT_TYPE_LABELS[item.type] || '项目' }}<template v-if="item.targetEndOn"> · {{ formatDate(item.targetEndOn) }}</template></small></span>
          </button>
          <p v-if="!visibleProjects.length && !pageLoading" class="projects-rail-empty">{{ showArchived ? '还没有归档项目。' : '还没有项目，先创建一个吧。' }}</p>
          <div class="projects-rail-footer"><button class="btn btn-secondary" type="button" @click="openCreateProject">＋ 新建项目</button></div>
        </aside>

        <section v-if="project" class="project-content" :aria-busy="detailLoading">
          <header class="project-overview panel">
            <div class="project-title-line">
              <div><p class="eyebrow">{{ PROJECT_TYPE_LABELS[project.type] || '项目' }}<span v-if="project.status === 'archived'"> · 已归档</span></p><h2>{{ project.name }}</h2></div>
              <div class="project-menu-actions">
                <button v-if="isManager" class="btn btn-ghost" type="button" @click="openEditProject">编辑</button>
                <button v-if="isManager && project.status === 'active'" class="btn btn-ghost" type="button" @click="askConfirm({ kind: 'archive' })">归档</button>
                <button v-if="isOwner && project.status === 'active'" class="btn btn-ghost danger-text" type="button" @click="askConfirm({ kind: 'delete' })">删除</button>
                <button v-if="project.status === 'archived' && isManager" class="btn btn-ghost" type="button" @click="askConfirm({ kind: 'restore', projectId: project.id })">恢复项目</button>
              </div>
            </div>
            <p v-if="project.description" class="project-description">{{ project.description }}</p>
            <div class="project-meta-row">
              <span v-if="project.startsOn">开始 {{ formatDate(project.startsOn) }}</span>
              <span v-if="project.targetEndOn">预计结束 {{ formatDate(project.targetEndOn) }}</span>
              <span>{{ members.filter((item) => item.status === 'active').length }} 位成员</span>
              <span>{{ roleLabel(project.role) }}</span>
            </div>
          </header>
          <section v-if="projectRisks.length" class="project-risk-panel" aria-label="项目提醒">
            <strong>需要留意</strong><span v-for="risk in projectRisks" :key="risk">{{ risk }}</span>
          </section>

          <nav class="project-tabs" aria-label="项目分区">
            <button type="button" :class="{ active: activeSection === 'tasks' }" @click="activeSection = 'tasks'">任务</button>
            <button type="button" :class="{ active: activeSection === 'adjustments' }" @click="activeSection = 'adjustments'">协商 <span v-if="adjustments.some((item) => item.status === 'pending')">{{ adjustments.filter((item) => item.status === 'pending').length }}</span></button>
            <button type="button" :class="{ active: activeSection === 'deliverables' }" @click="activeSection = 'deliverables'">成果 <span>{{ deliverables.length }}</span></button>
            <button type="button" :class="{ active: activeSection === 'schedule' }" @click="activeSection = 'schedule'">团队时间</button>
            <button type="button" :class="{ active: activeSection === 'members' }" @click="activeSection = 'members'">成员 <span>{{ activeMembers.length }}</span></button>
            <button type="button" :class="{ active: activeSection === 'activity' }" @click="activeSection = 'activity'">动态</button>
          </nav>

          <section v-if="activeSection === 'tasks'" class="project-panel panel" aria-labelledby="project-tasks-title">
            <div class="projects-section-head project-tasks-head">
              <div><h3 id="project-tasks-title">任务</h3><p>负责人发出的分工需要成员明确接受。</p></div>
              <div class="project-tasks-actions"><select v-model="statusFilter" aria-label="任务筛选"><option value="open">未完成</option><option value="done">已完成</option><option value="all">全部</option></select><button v-if="project.status === 'active'" class="btn btn-primary" type="button" @click="openTaskCreate()">＋ 添加任务</button></div>
            </div>
            <section v-if="milestones.length || isManager" class="project-milestones" aria-label="项目里程碑">
              <div class="projects-section-head"><div><h4>里程碑</h4><p>记录项目关键阶段；任务可以关联到对应阶段。</p></div><button v-if="isManager && project.status === 'active'" class="btn btn-ghost" type="button" @click="openMilestoneForm()">＋ 添加里程碑</button></div>
              <div v-if="!milestones.length" class="projects-empty compact"><strong>还没有里程碑</strong><small>简单项目可以跳过；需要跟进关键日期时再添加。</small></div>
              <article v-for="item in milestones" :key="item.id" class="project-milestone-row" :class="{ completed: item.status === 'completed' }">
                <button class="milestone-check" type="button" :disabled="project.status !== 'active' || actionBusy === `milestone:${item.id}`" :aria-label="item.status === 'completed' ? `重新打开${item.title}` : `完成${item.title}`" :aria-pressed="item.status === 'completed'" @click="toggleMilestone(item, item.status !== 'completed')">{{ item.status === 'completed' ? '✓' : '' }}</button>
                <div class="project-milestone-copy"><strong>{{ item.title }}</strong><small><template v-if="item.dueOn">{{ formatDate(item.dueOn) }} · </template>{{ item.status === 'completed' ? '已完成' : '进行中' }}</small><p v-if="item.description">{{ item.description }}</p></div>
                <div v-if="isManager && project.status === 'active'" class="projects-row-actions"><button class="btn btn-ghost" type="button" @click="openMilestoneForm(item)">编辑</button><button class="btn btn-ghost danger-text" type="button" @click="askConfirm({ kind: 'delete-milestone', milestoneId: item.id })">删除</button></div>
              </article>
            </section>
            <div v-if="detailLoading" class="projects-loading" role="status">正在加载项目内容…</div>
            <div v-else-if="!filteredTasks.length" class="projects-empty">
              <span aria-hidden="true">✓</span><strong>{{ statusFilter === 'done' ? '还没有完成的任务' : '现在没有待处理任务' }}</strong><small>{{ project.status === 'active' ? '添加一个简单任务，或邀请队友一起分工。' : '归档项目只保留历史查看。' }}</small>
              <button v-if="project.status === 'active'" class="btn btn-secondary" type="button" @click="openTaskCreate()">添加第一个任务</button>
            </div>
            <article v-for="task in visibleTasks" :key="task.id" class="project-task">
              <div class="project-task-main">
                <span class="task-priority" :class="`priority-${task.priority}`" :aria-label="`优先级：${PROJECT_TASK_PRIORITY[task.priority] || '普通'}`"></span>
                <div class="project-task-copy">
                  <div class="project-task-title"><strong :class="{ 'task-is-done': task.status === 'completed' }">{{ task.title }}</strong><span class="project-task-status" :class="`state-${task.status}`">{{ PROJECT_TASK_STATUS[task.status] || '待开始' }}</span></div>
                  <p v-if="task.description" class="project-task-description">{{ task.description }}</p>
                  <div class="project-task-meta"><span>{{ taskAssignmentLabel(task) }}</span><span v-if="task.dueOn">截止 {{ formatDate(task.dueOn) }}</span><span v-if="milestoneTaskLabel(task.milestoneId)">阶段：{{ milestoneTaskLabel(task.milestoneId) }}</span><span v-if="isTaskDependencyBlocked(task)">等待前置：{{ task.dependencyTaskTitle }}</span><span>{{ PROJECT_TASK_PRIORITY[task.priority] || '普通' }}优先级</span></div>
                </div>
              </div>
              <div class="project-task-actions">
                <template v-if="project.status === 'active' && task.assigneeId === accountUser.id && task.assignmentStatus === 'pending'">
                  <button class="btn btn-ghost" type="button" :disabled="actionBusy === `task:${task.id}`" @click="respondTask(task, 'decline')">拒绝分工</button>
                  <button class="btn btn-primary" type="button" :disabled="actionBusy === `task:${task.id}`" @click="respondTask(task, 'accept')">接受分工</button>
                </template>
                <template v-else-if="project.status === 'active' && task.status !== 'completed' && (isManager || (task.assigneeId === accountUser.id && task.assignmentStatus === 'accepted'))">
                  <button v-if="task.status === 'todo'" class="btn btn-secondary" type="button" :disabled="actionBusy === `task:${task.id}` || isTaskDependencyBlocked(task)" @click="changeTaskStatus(task, 'in_progress')">开始</button>
                  <button v-if="task.status === 'in_progress'" class="btn btn-secondary" type="button" :disabled="actionBusy === `task:${task.id}` || isTaskDependencyBlocked(task)" @click="changeTaskStatus(task, 'review')">提交验收</button>
                  <button class="btn btn-primary" type="button" :disabled="actionBusy === `task:${task.id}` || isTaskDependencyBlocked(task)" @click="changeTaskStatus(task, 'completed')">完成</button>
                </template>
                <button v-if="canAddAdjustment(task)" class="btn btn-ghost" type="button" @click="openAdjustment(task)">协商调整</button>
                <button v-if="isManager && project.status === 'active'" class="btn btn-ghost" type="button" @click="openTaskEdit(task)">编辑</button>
                <button v-if="project.status === 'active'" class="icon-btn" type="button" :aria-label="`为“${task.title}”添加子任务`" title="添加子任务" @click="openTaskCreate(task.id)">＋</button>
                <button class="icon-btn" type="button" :aria-label="`查看“${task.title}”的进展记录`" title="进展记录" @click="loadTaskEvents(task)">⋯</button>
              </div>
              <div v-if="assignedSubtasks(task.id).length" class="project-subtasks">
                <div v-for="child in assignedSubtasks(task.id)" :key="child.id" class="project-subtask-row"><span aria-hidden="true">↳</span><strong :class="{ 'task-is-done': child.status === 'completed' }">{{ child.title }}</strong><small>{{ taskAssignmentLabel(child) }}<template v-if="child.dueOn"> · {{ formatDate(child.dueOn) }}</template><template v-if="isTaskDependencyBlocked(child)"> · 等待前置：{{ child.dependencyTaskTitle }}</template></small><template v-if="project.status === 'active' && child.assigneeId === accountUser.id && child.assignmentStatus === 'pending'"><button class="btn btn-ghost" type="button" @click="respondTask(child, 'decline')">拒绝</button><button class="btn btn-ghost" type="button" @click="respondTask(child, 'accept')">接受</button></template><button v-else-if="project.status === 'active' && child.assigneeId === accountUser.id && child.assignmentStatus === 'accepted' && child.status !== 'completed'" class="btn btn-ghost" type="button" :disabled="isTaskDependencyBlocked(child)" @click="changeTaskStatus(child, 'completed')">完成</button><button v-if="isManager && project.status === 'active'" class="icon-btn" type="button" :aria-label="`编辑子任务 ${child.title}`" @click="openTaskEdit(child)">✎</button></div>
              </div>
            </article>
            <button v-if="remainingTaskCount" class="btn btn-ghost project-tasks-more" type="button" @click="visibleTaskLimit += 50">再显示 50 项（剩余 {{ remainingTaskCount }} 项）</button>
          </section>

          <section v-else-if="activeSection === 'schedule'" class="project-panel panel" aria-labelledby="project-schedule-title">
            <div class="projects-section-head"><div><h3 id="project-schedule-title">团队时间</h3><p>只返回共同空闲时段，不显示队友的课程或个人日程详情。</p></div><button v-if="project.status === 'active' && activeMembers.length >= 2" class="btn btn-primary" type="button" @click="openMeetingForm()">＋ 发起讨论</button></div>
            <section class="schedule-availability" aria-label="共同空闲时间">
              <div class="schedule-query-row"><strong>共同空闲</strong><div><button v-for="days in [7, 14, 30]" :key="days" class="btn btn-ghost" type="button" :class="{ active: scheduleDays === days }" :disabled="scheduleBusy || activeMembers.length < 2" @click="queryGroupAvailability(days)">未来 {{ days }} 天</button></div></div>
              <p v-if="activeMembers.length < 2" class="projects-form-hint">邀请至少一位队友后，可以计算共同空闲时间或发起讨论。</p>
              <div v-else-if="scheduleBusy" class="projects-loading" role="status">正在按每位成员自己的学校课表和时区计算…</div>
              <p v-else-if="scheduleError" class="projects-form-error" role="alert">{{ scheduleError }} <button class="btn btn-ghost" type="button" @click="queryGroupAvailability()">重试</button></p>
              <template v-else-if="scheduleAvailability">
                <p v-if="!scheduleAvailability.known" class="projects-form-hint">部分成员尚未完善或同步个人课表。可以先手动填写讨论时间，成员再接受、拒绝或提出改期。</p>
                <div v-else-if="!scheduleAvailability.intervals.length" class="projects-empty compact"><strong>暂时没有满足偏好的共同空闲时段</strong><small>可以调整个人可约时间设置，或发起手动讨论邀请。</small><button v-if="project.status === 'active'" class="btn btn-secondary" type="button" @click="openMeetingForm()">手动发起讨论</button></div>
                <div v-else class="schedule-slot-list"><button v-for="slot in scheduleAvailability.intervals" :key="slot.startsAt" class="schedule-slot" type="button" :disabled="project.status !== 'active'" @click="openMeetingForm(slot)"><span>{{ formatProjectTime(slot.startsAt) }} – {{ formatProjectTime(slot.endsAt) }}</span><small>{{ scheduleAvailability.people.map((person) => person.nickname).join('、') }} 均可</small><strong>发起讨论</strong></button></div>
              </template>
              <p v-else class="projects-form-hint">查看未来一周、两周或一个月的共同空闲时间。</p>
            </section>
            <section class="project-meetings" aria-label="讨论邀约">
              <div class="projects-section-head"><div><h4>讨论邀约</h4><p>所有受邀成员接受后，组织者可以确认并同步到成员个人日程。</p></div></div>
              <div v-if="!meetings.length" class="projects-empty compact"><strong>还没有讨论安排</strong><small>需要约时间时，可以从共同空闲时段发起，也可以手动邀请队友。</small></div>
              <article v-for="meeting in meetings" :key="meeting.id" class="project-meeting-row" :class="`meeting-${meeting.status}`">
                <div class="project-meeting-main"><div class="project-process-title"><strong>{{ meeting.title }}</strong><span class="project-process-status">{{ meetingStatusLabel(meeting.status) }}</span></div><p>{{ formatProjectTime(meeting.startsAt) }} – {{ formatProjectTime(meeting.endsAt) }}</p><small>{{ meeting.participants.map((person) => `${person.nickname}：${meetingParticipantStatus(person.status)}`).join(' · ') }}</small>
                  <div v-for="person in meeting.participants.filter((item) => item.status === 'proposed')" :key="`proposal-${meeting.id}-${person.userId}`" class="meeting-proposal"><span>{{ person.nickname }}建议：{{ formatProjectTime(person.proposedStartsAt) }} – {{ formatProjectTime(person.proposedEndsAt) }}</span><button v-if="(meeting.createdBy === accountUser.id || isManager) && project.status === 'active'" class="btn btn-secondary" type="button" @click="askConfirm({ kind: 'meeting-apply-proposal', meetingId: meeting.id, participantId: person.userId })">采用建议时间</button></div>
                </div>
                <div class="projects-row-actions meeting-actions">
                  <template v-if="project.status === 'active' && meeting.status === 'open' && meeting.participants.some((person) => person.userId === accountUser.id && person.status === 'invited')"><button class="btn btn-ghost" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" @click="openMeetingProposal(meeting)">提出改期</button><button class="btn btn-ghost" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" @click="respondMeeting(meeting, 'decline')">拒绝</button><button class="btn btn-primary" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" @click="respondMeeting(meeting, 'accept')">接受</button></template>
                  <button v-if="meetingCanConfirm(meeting) && project.status === 'active'" class="btn btn-primary" type="button" :disabled="actionBusy === `meeting-confirm:${meeting.id}`" @click="askConfirm({ kind: 'meeting-confirm', meetingId: meeting.id })">确认并加入日程</button>
                  <button v-if="(meeting.createdBy === accountUser.id || isManager) && project.status === 'active' && meeting.status !== 'cancelled'" class="btn btn-ghost danger-text" type="button" @click="askConfirm({ kind: 'meeting-cancel', meetingId: meeting.id })">取消邀约</button>
                </div>
              </article>
            </section>
          </section>

          <section v-else-if="activeSection === 'adjustments'" class="project-panel panel" aria-labelledby="project-adjustments-title">
            <div class="projects-section-head"><div><h3 id="project-adjustments-title">任务协商</h3><p>申请通过前，截止日期、负责人和任务内容保持原样。</p></div></div>
            <div v-if="!adjustments.length" class="projects-empty compact"><strong>暂时没有任务调整</strong><small>需要延期、协助或重新分工时，可以从任务卡片发起协商。</small></div>
            <article v-for="request in adjustments" :key="request.id" class="project-process-row">
              <div class="project-process-main"><div class="project-process-title"><strong>{{ request.taskTitle }} · {{ adjustmentTypeLabel(request.type) }}</strong><span class="project-process-status" :class="`state-${request.status}`">{{ adjustmentStatus(request.status) }}</span></div>
                <p>{{ request.reason }}</p><small>{{ request.requesterName }} · {{ adjustmentDataSummary(request) }} · {{ formatDateTime(request.createdAt) }}</small>
                <small v-if="request.decisionNote">处理说明：{{ request.decisionNote }}</small>
              </div>
              <div class="projects-row-actions">
                <template v-if="canRespondAdjustment(request)"><button class="btn btn-ghost" type="button" :disabled="actionBusy === `adjustment:${request.id}`" @click="decideAdjustment(request, 'reject')">拒绝</button><button class="btn btn-primary" type="button" :disabled="actionBusy === `adjustment:${request.id}`" @click="decideAdjustment(request, 'approve')">通过</button></template>
                <button v-if="request.status === 'pending' && request.requesterId === accountUser.id" class="btn btn-ghost" type="button" :disabled="actionBusy === `adjustment:${request.id}`" @click="cancelAdjustment(request)">撤回</button>
              </div>
            </article>
          </section>

          <section v-else-if="activeSection === 'deliverables'" class="project-panel panel" aria-labelledby="project-deliverables-title">
            <div class="projects-section-head"><div><h3 id="project-deliverables-title">成果与验收</h3><p>正式提交会保留版本；退回修改后可再次提交新版本。</p></div><button v-if="isManager && project.status === 'active'" class="btn btn-primary" type="button" @click="openDeliverableCreate">＋ 添加交付项</button></div>
            <section class="delivery-center" aria-label="项目交付状态">
              <div><strong>成员已完成的任务</strong><p v-if="deliveryCenter.completedTasks.length">{{ deliveryCenter.completedTasks.map((task) => task.title).join('、') }}</p><small v-else>暂时没有已完成任务</small></div>
              <div><strong>等待验收</strong><p v-if="deliveryCenter.awaitingReview.length">{{ deliveryCenter.awaitingReview.map((item) => item.title).join('、') }}</p><small v-else>没有待验收成果</small></div>
              <div><strong>必需材料缺失或未通过</strong><p v-if="deliveryCenter.missing.length">{{ deliveryCenter.missing.map((item) => item.title).join('、') }}</p><small v-else>必需成果已齐备</small></div>
              <div><strong>已验收的最终版本</strong><p v-if="deliveryCenter.approved.length">{{ deliveryCenter.approved.map((item) => `${item.title} · V${item.versions[0].number} · ${formatDateTime(item.versions[0].createdAt)}`).join('；') }}</p><small v-else>还没有通过验收的成果版本</small></div>
            </section>
            <section v-if="deliveryChecks.length || isManager" class="delivery-checklist" aria-label="项目交付检查清单">
              <div class="projects-section-head"><div><h4>交付检查清单</h4><p>记录最终提交前需要确认的材料和检查结果。</p></div><button v-if="isManager && project.status === 'active'" class="btn btn-ghost" type="button" @click="openDeliveryCheckForm">＋ 添加检查项</button></div>
              <div v-if="!deliveryChecks.length" class="projects-empty compact"><strong>还没有检查项</strong><small>简单项目可以跳过；需要明确交付要求时再添加。</small></div>
              <div v-for="item in deliveryChecks" :key="item.id" class="delivery-check-row">
                <label class="delivery-check-toggle"><input type="checkbox" :checked="item.checked" :disabled="project.status !== 'active' || actionBusy === `delivery-check:${item.id}`" @change="saveDeliveryCheck(item, $event.target.checked)" /><span>{{ item.title }}<small>{{ item.required ? '必需' : '选填' }}<template v-if="item.checked && item.checkedByName"> · {{ item.checkedByName }}已确认</template></small></span></label>
                <div class="delivery-check-actions"><input v-if="project.status === 'active'" v-model="item.evidence" maxlength="1000" :aria-label="`${item.title}的凭证或说明`" placeholder="凭证或说明（选填）" @keydown.enter.prevent="saveDeliveryCheck(item, item.checked)" /><button v-if="project.status === 'active'" class="btn btn-ghost" type="button" :disabled="actionBusy === `delivery-check:${item.id}`" @click="saveDeliveryCheck(item, item.checked)">保存说明</button><button v-if="isManager && project.status === 'active'" class="icon-btn danger-text" type="button" :aria-label="`删除检查项 ${item.title}`" @click="askConfirm({ kind: 'delivery-check-delete', checkId: item.id })">×</button></div>
                <small v-if="item.evidence && item.checked" class="delivery-check-evidence">{{ item.evidence }}</small>
              </div>
            </section>
            <div v-if="!deliverables.length" class="projects-empty compact"><strong>还没有交付项</strong><small>{{ isManager ? '可以先添加 PDF、演示文稿或其他项目成果要求；也可以继续保持简单项目。' : '负责人添加交付项后，成果和验收记录会显示在这里。' }}</small></div>
            <article v-for="item in deliverables" :key="item.id" class="project-process-row deliverable-row">
              <div class="project-process-main">
                <div class="project-process-title"><strong>{{ item.title }}</strong><span class="project-process-status" :class="`state-${item.versions?.[0]?.reviewStatus || 'todo'}`">{{ deliverableStatus(item) }}</span></div>
                <p v-if="item.instructions">{{ item.instructions }}</p>
                <small>{{ item.required ? '必需交付' : '选填交付' }} · {{ item.reviewRequired ? `验收人：${item.reviewerName || '项目负责人或管理员'}` : '无需验收' }}<template v-if="item.taskTitle"> · 关联任务：{{ item.taskTitle }}</template></small>
                <template v-if="item.versions?.length">
                  <div v-for="version in item.versions" :key="version.id" class="deliverable-version">
                    <div class="deliverable-version-head"><strong>V{{ version.number }} <span>{{ version.reviewStatus === 'pending' ? '等待验收' : version.reviewStatus === 'approved' ? '已通过' : version.reviewStatus === 'returned' ? '已退回' : '已提交' }}</span></strong><small>{{ version.submitterName }} · {{ formatDateTime(version.createdAt) }}</small></div>
                    <p v-if="version.changeNote" class="deliverable-change-note">修改说明：{{ version.changeNote }}</p>
                    <p v-if="version.content.summary" class="deliverable-summary">{{ version.content.summary }}</p>
                    <div v-if="version.content.links?.length || version.content.files?.length" class="deliverable-links">
                      <a v-for="(link, index) in version.content.links || []" :key="`link-${index}`" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title || link.url }}</a>
                      <button v-for="(file, index) in version.content.files || []" :key="`file-${index}`" class="text-link-button" type="button" @click="openDeliverableFile(file)">{{ file.name }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB</button>
                    </div>
                    <div v-if="version.review" class="deliverable-review-result" :class="`is-${version.review.result}`"><strong>{{ version.review.result === 'approved' ? '验收通过' : '退回修改' }} · {{ version.review.reviewerName }}</strong><p>{{ version.review.feedback }}</p><small v-for="(check, index) in version.review.checklist" :key="index">{{ check.passed ? '✓' : '!' }} {{ check.item }}　</small></div>
                    <div v-if="canReview(item, version)" class="projects-row-actions deliverable-review-actions"><button class="btn btn-primary" type="button" @click="openReview(item, version)">验收 V{{ version.number }}</button></div>
                  </div>
                </template>
              </div>
              <div v-if="canEditDeliverable(item)" class="projects-row-actions deliverable-actions"><button class="btn btn-secondary" type="button" @click="openDeliverableEditor(item)">{{ item.versions?.[0]?.reviewStatus === 'returned' ? '修改并重新提交' : item.draft ? '继续编辑草稿' : '提交成果' }}</button></div>
            </article>
          </section>

          <section v-else-if="activeSection === 'members'" class="project-panel panel" aria-labelledby="project-members-title">
            <div class="projects-section-head"><div><h3 id="project-members-title">项目成员</h3><p>队友加入项目后只会看到这个项目的共享内容。</p></div><button v-if="isManager && project.status === 'active'" class="btn btn-primary" type="button" @click="showInviteForm = true; linkToShare = ''; void loadFriends(); void loadInviteLinks()">邀请成员</button></div>
            <article v-for="member in members" :key="member.userId" class="project-member-row">
              <span class="member-avatar" aria-hidden="true">{{ (member.nickname || '成').slice(0, 1) }}</span>
              <div class="project-member-copy"><strong>{{ member.nickname }}</strong><small>{{ member.school || '未填写学校' }} · {{ roleLabel(member.role) }}<template v-if="member.status === 'invited'"> · 等待接受</template></small></div>
              <div v-if="isOwner && project.status === 'active' && member.role !== 'owner' && member.status === 'active'" class="member-row-actions"><button class="btn btn-ghost" type="button" :disabled="actionBusy === `role:${member.userId}`" @click="changeMemberRole(member)">{{ member.role === 'admin' ? '设为成员' : '设为管理员' }}</button><button class="btn btn-ghost" type="button" @click="transferTargetId = member.userId">转交负责人</button><button class="icon-btn danger-text" type="button" :aria-label="`移出成员 ${member.nickname}`" @click="askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname })">×</button></div>
              <button v-else-if="isManager && member.role === 'member' && member.status === 'invited'" class="btn btn-ghost" type="button" @click="askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname })">撤回邀请</button>
            </article>
            <p v-if="!activeMembers.length" class="projects-rail-empty">当前项目还没有成员。</p>
            <div v-if="!isOwner" class="project-member-footer"><button class="btn btn-ghost danger-text" type="button" @click="askConfirm({ kind: 'leave' })">退出项目</button></div>
          </section>

          <section v-else class="project-panel panel" aria-labelledby="project-activity-title">
            <div class="projects-section-head"><div><h3 id="project-activity-title">项目动态</h3><p>最近的成员、任务和项目操作记录。</p></div></div>
            <div v-if="!activities.length" class="projects-empty compact"><strong>还没有操作记录</strong><small>项目创建、分工和成员变化会显示在这里。</small></div>
            <ol v-else class="project-activity-list"><li v-for="item in activities" :key="item.id"><span class="activity-dot"></span><div><strong>{{ item.actorName }}</strong><span>{{ activityLabel(item) }}</span><small>{{ formatDateTime(item.createdAt, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</small></div></li></ol>
          </section>
        </section>

        <section v-else class="projects-welcome panel">
          <div class="projects-welcome-mark" aria-hidden="true">🧩</div>
          <h2>{{ pageLoading ? '正在载入项目…' : '从一个项目开始' }}</h2>
          <p>{{ pageLoading ? '正在同步你的项目和待处理事项。' : '课程作业、竞赛、科研、软件开发或活动筹备，都可以先从一个简单项目开始。' }}</p>
          <button v-if="!pageLoading" class="btn btn-primary" type="button" @click="openCreateProject">新建项目</button>
        </section>
      </section>
    </template>

    <Modal v-if="showProjectForm" :open="showProjectForm" :title="projectFormTitle" :medium="true" @close="showProjectForm = false">
      <form class="projects-form" @submit.prevent="saveProject">
        <label>项目名称 <span aria-hidden="true">*</span><input v-model="projectDraft.name" maxlength="120" required autofocus placeholder="例如：数学建模竞赛" /></label>
        <label>项目类型<select v-model="projectDraft.type"><option v-for="item in PROJECT_TYPES" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <label>项目说明 <textarea v-model="projectDraft.description" maxlength="2000" rows="3" placeholder="选填，写下目标或背景" /></label>
        <div class="projects-form-grid"><label>开始日期<input v-model="projectDraft.startsOn" type="date" /></label><label>预计结束<input v-model="projectDraft.targetEndOn" type="date" :min="projectDraft.startsOn || undefined" /></label></div>
        <p class="projects-form-error" aria-live="polite">{{ pageError }}</p>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showProjectForm = false">取消</button><button class="btn btn-primary" type="submit" :disabled="projectSaveBusy">{{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showTaskForm" :open="showTaskForm" :title="editingTask ? '编辑任务' : taskDraft.parentTaskId ? '添加子任务' : '添加任务'" :medium="true" @close="showTaskForm = false; editingTask = false">
      <form class="projects-form" @submit.prevent="saveTask">
        <label>任务标题 <span aria-hidden="true">*</span><input v-model="taskDraft.title" maxlength="160" required autofocus placeholder="例如：完成需求分析" /></label>
        <label>任务说明 <textarea v-model="taskDraft.description" maxlength="3000" rows="3" placeholder="选填" /></label>
        <div class="projects-form-grid"><label>负责人<select v-model="taskDraft.assigneeId"><option value="">暂不分配</option><option v-for="member in activeMembers" :key="member.userId" :value="member.userId">{{ member.userId === accountUser.id ? '我' : member.nickname }}</option></select></label><label>截止日期<input v-model="taskDraft.dueOn" type="date" /></label></div>
        <label v-if="milestones.length">所属阶段<select v-model="taskDraft.milestoneId"><option value="">不关联里程碑</option><option v-for="item in milestones" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
        <label>前置任务<select v-model="taskDraft.dependsOnTaskId"><option value="">没有前置任务</option><option v-for="item in dependencyTaskOptions" :key="item.id" :value="item.id">{{ item.title }}{{ item.status === 'completed' ? '（已完成）' : '' }}</option></select></label>
        <p v-if="taskDraft.dependsOnTaskId" class="projects-form-hint">前置任务完成前，成员不能开始或完成此任务；系统会阻止循环依赖。</p>
        <label>优先级<select v-model="taskDraft.priority"><option v-for="(label, value) in PROJECT_TASK_PRIORITY" :key="value" :value="value">{{ label }}</option></select></label>
        <p v-if="taskDraft.assigneeId" class="projects-form-hint">{{ editingTask ? '更换负责人后，新负责人需要明确接受；原负责人待办会转为个人记录。' : '分配后会等待负责人明确接受；接受后才加入对方的个人待办。' }}</p>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showTaskForm = false; editingTask = false">取消</button><button class="btn btn-primary" type="submit" :disabled="taskSaveBusy">{{ taskSaveBusy ? '保存中…' : editingTask ? '保存修改' : '添加任务' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showMilestoneForm" :open="showMilestoneForm" :title="editingMilestone ? '编辑里程碑' : '添加里程碑'" :medium="true" :sheet="true" @close="showMilestoneForm = false">
      <form class="projects-form" @submit.prevent="saveMilestone">
        <label>阶段名称 <span aria-hidden="true">*</span><input v-model="milestoneDraft.title" maxlength="160" required autofocus placeholder="例如：方案评审" /></label>
        <label>阶段说明<textarea v-model="milestoneDraft.description" maxlength="2000" rows="3" placeholder="选填" /></label>
        <label>关键日期<input v-model="milestoneDraft.dueOn" type="date" :min="project?.startsOn || undefined" /></label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showMilestoneForm = false">取消</button><button class="btn btn-primary" type="submit" :disabled="planningSaveBusy">{{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showDeliveryCheckForm" :open="showDeliveryCheckForm" title="添加交付检查项" :medium="true" :sheet="true" @close="showDeliveryCheckForm = false">
      <form class="projects-form" @submit.prevent="saveDeliveryCheckItem">
        <label>检查内容 <span aria-hidden="true">*</span><input v-model="deliveryCheckDraft.title" maxlength="200" required autofocus placeholder="例如：确认最终报告包含实验数据" /></label>
        <label class="project-check-row"><input v-model="deliveryCheckDraft.required" type="checkbox" />项目交付必需</label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showDeliveryCheckForm = false">取消</button><button class="btn btn-primary" type="submit" :disabled="planningSaveBusy">{{ planningSaveBusy ? '保存中…' : '添加检查项' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showMeetingForm" :open="showMeetingForm" :title="meetingProposalTarget ? '提出改期建议' : '发起小组讨论'" :medium="true" :sheet="true" @close="showMeetingForm = false; meetingProposalTarget = null">
      <form class="projects-form" @submit.prevent="saveMeetingForm">
        <p class="projects-form-hint">时间按你的账号时区（{{ scheduleTimezone }}）填写。其他成员会看到本地时区下的时间。</p>
        <label v-if="!meetingProposalTarget">讨论主题 <span aria-hidden="true">*</span><input v-model="meetingDraft.title" maxlength="160" required autofocus placeholder="例如：确定演示方案" /></label>
        <label v-if="!meetingProposalTarget">讨论说明<textarea v-model="meetingDraft.note" maxlength="1500" rows="2" placeholder="选填，写下议题或会议链接" /></label>
        <label>{{ meetingProposalTarget ? '建议开始时间' : '开始时间' }}<input v-model="meetingDraft.startsLocal" type="datetime-local" required /></label>
        <label>{{ meetingProposalTarget ? '建议结束时间' : '结束时间' }}<input v-model="meetingDraft.endsLocal" type="datetime-local" required /></label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showMeetingForm = false; meetingProposalTarget = null">取消</button><button class="btn btn-primary" type="submit" :disabled="Boolean(actionBusy)">{{ actionBusy ? '提交中…' : meetingProposalTarget ? '发送改期建议' : '发送讨论邀请' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showAdjustmentForm" :open="showAdjustmentForm" title="协商任务调整" :medium="true" :sheet="true" @close="showAdjustmentForm = false">
      <form class="projects-form" @submit.prevent="saveAdjustment">
        <p class="projects-form-hint">{{ adjustmentTask?.title }} · 申请提交后先由相关成员确认，确认前不会改动现有安排。</p>
        <label>申请类型<select v-model="adjustmentDraft.type"><option value="deadline_extension">延长截止时间</option><option value="help">寻求其他成员协助</option><option value="scope_change">调整任务范围</option><option value="split">拆分任务</option><option value="handover">交接任务负责人</option><option value="unable_to_continue">无法继续承担</option></select></label>
        <label v-if="adjustmentDraft.type === 'deadline_extension'">申请的新截止日期<input v-model="adjustmentDraft.dueOn" type="date" :min="nextDay(adjustmentTask?.dueOn)" required /></label>
        <label v-if="['help', 'handover'].includes(adjustmentDraft.type)">{{ adjustmentDraft.type === 'help' ? '希望协助的成员' : '希望交接给' }}<select v-model="adjustmentDraft.targetId" required><option value="">选择项目成员</option><option v-for="member in activeMembers.filter((item) => item.userId !== accountUser.id && item.userId !== adjustmentTask?.assigneeId)" :key="member.userId" :value="member.userId">{{ member.nickname }}</option></select></label>
        <label v-if="adjustmentDraft.type === 'scope_change'">调整后的任务说明<textarea v-model="adjustmentDraft.description" maxlength="3000" rows="3" placeholder="写下希望采用的新范围" /></label>
        <label v-if="adjustmentDraft.type === 'split'">拆分后的子任务<textarea v-model="adjustmentDraft.subtasks" rows="4" placeholder="每行一个子任务，最多 8 项" /></label>
        <label>申请原因 <span aria-hidden="true">*</span><textarea v-model="adjustmentDraft.reason" maxlength="1500" rows="3" required placeholder="说明当前遇到的问题和需要怎样的调整" /></label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showAdjustmentForm = false">取消</button><button class="btn btn-primary" type="submit" :disabled="adjustmentSaveBusy">{{ adjustmentSaveBusy ? '提交中…' : '提交申请' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showDeliverableForm" :open="showDeliverableForm" title="添加项目交付项" :medium="true" :sheet="true" @close="showDeliverableForm = false">
      <form class="projects-form" @submit.prevent="saveDeliverable">
        <label>交付项名称 <span aria-hidden="true">*</span><input v-model="deliverableDraft.title" maxlength="160" required autofocus placeholder="例如：最终报告" /></label>
        <label>交付要求<textarea v-model="deliverableDraft.instructions" maxlength="3000" rows="3" placeholder="选填，写下格式、内容或检查要求" /></label>
        <label>关联任务<select v-model="deliverableDraft.taskId"><option value="">不关联具体任务</option><option v-for="task in deliverableTaskOptions" :key="task.id" :value="task.id">{{ task.title }}</option></select></label>
        <label>验收人<select v-model="deliverableDraft.reviewerId"><option value="">项目负责人或管理员</option><option v-for="member in activeMembers.filter((item) => item.userId !== accountUser.id)" :key="member.userId" :value="member.userId">{{ member.nickname }}</option></select></label>
        <label class="project-check-row"><input v-model="deliverableDraft.required" type="checkbox" />项目交付必需</label>
        <label class="project-check-row"><input v-model="deliverableDraft.reviewRequired" type="checkbox" />正式提交后需要验收</label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showDeliverableForm = false">取消</button><button class="btn btn-primary" type="submit" :disabled="deliverableSaveBusy">{{ deliverableSaveBusy ? '保存中…' : '添加交付项' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showDeliverableEditor" :open="showDeliverableEditor" :title="`提交成果 · ${activeDeliverable?.title || ''}`" :wide="true" :sheet="true" @close="showDeliverableEditor = false; activeDeliverable = null">
      <form class="projects-form deliverable-editor" @submit.prevent="submitDeliverable">
        <p v-if="activeDeliverable?.instructions" class="projects-form-hint">交付要求：{{ activeDeliverable.instructions }}</p>
        <label>成果说明<textarea v-model="draftContent.summary" maxlength="5000" rows="4" placeholder="简要说明完成内容、查看方式或注意事项" /></label>
        <div class="deliverable-editor-section"><div class="projects-section-head"><strong>在线链接</strong><button class="btn btn-ghost" type="button" :disabled="draftContent.links.length >= 10" @click="addContentLink">＋ 添加链接</button></div>
          <div v-for="(link, index) in draftContent.links" :key="index" class="deliverable-link-editor"><select v-model="link.type" aria-label="链接类型"><option value="document">在线文档</option><option value="repository">代码仓库</option><option value="commit">指定提交</option><option value="other">其他链接</option></select><input v-model="link.title" maxlength="160" aria-label="链接名称" placeholder="链接名称" /><input v-model="link.url" type="url" aria-label="HTTPS 链接" placeholder="https://…" /><button class="icon-btn" type="button" :aria-label="`删除链接 ${index + 1}`" @click="draftContent.links.splice(index, 1)">×</button></div>
        </div>
        <div class="deliverable-editor-section"><div class="projects-section-head"><strong>成果文件</strong><label class="btn btn-ghost file-pick-button">{{ fileUploadBusy ? '上传中…' : '选择文件' }}<input type="file" multiple :disabled="fileUploadBusy || draftContent.files.length >= 10" @change="uploadDeliverableFiles" /></label></div><p class="projects-form-hint">单个文件最大 20 MB，每个版本最多 10 个文件。</p>
          <div v-for="(file, index) in draftContent.files" :key="file.path" class="deliverable-file-row"><span>{{ file.name }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB</span><button class="btn btn-ghost danger-text" type="button" @click="draftContent.files.splice(index, 1)">移除</button></div>
        </div>
        <label>本次修改说明<input v-model="changeNote" maxlength="1500" placeholder="选填，例如：根据验收意见补充了实验结果" /></label>
        <p v-if="draftRevision" class="projects-form-hint">当前草稿版本 {{ draftRevision }}。正式提交后会固定为一个不可覆盖的成果版本。</p>
        <div class="projects-form-actions deliverable-editor-actions"><button class="btn btn-ghost" type="button" @click="showDeliverableEditor = false; activeDeliverable = null">关闭</button><button class="btn btn-secondary" type="button" :disabled="deliverableSaveBusy || fileUploadBusy" @click="saveDeliverableDraft">{{ deliverableSaveBusy ? '保存中…' : '保存草稿' }}</button><button class="btn btn-primary" type="submit" :disabled="deliverableSaveBusy || fileUploadBusy || draftRevision < 1">{{ deliverableSaveBusy ? '提交中…' : '正式提交新版本' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="reviewTarget" :open="Boolean(reviewTarget)" title="验收成果" :medium="true" :sheet="true" @close="reviewTarget = null">
      <form class="projects-form" @submit.prevent="decideReview('approved')">
        <p class="projects-form-hint">通过前请逐项确认检查结果；有未通过项时请选择退回修改。</p>
        <div class="review-checklist"><div v-for="(item, index) in reviewChecklist" :key="index" class="review-check-row"><input v-model="item.passed" type="checkbox" :aria-label="`检查项 ${index + 1} 通过`" /><input v-model="item.item" maxlength="200" :aria-label="`检查项 ${index + 1} 名称`" placeholder="检查项" /><button class="icon-btn" type="button" :aria-label="`删除检查项 ${index + 1}`" :disabled="reviewChecklist.length <= 1" @click="reviewChecklist.splice(index, 1)">×</button></div><button class="btn btn-ghost" type="button" :disabled="reviewChecklist.length >= 20" @click="addReviewChecklistItem">＋ 添加检查项</button></div>
        <label>验收意见 <span aria-hidden="true">*</span><textarea v-model="reviewFeedback" maxlength="3000" rows="4" required placeholder="说明检查结果，退回时请写清楚修改建议" /></label>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" :disabled="reviewSaveBusy" @click="decideReview('returned')">退回修改</button><button class="btn btn-primary" type="submit" :disabled="reviewSaveBusy">{{ reviewSaveBusy ? '保存中…' : '通过验收' }}</button></div>
      </form>
    </Modal>

    <Modal v-if="showInviteForm" :open="showInviteForm" title="邀请成员" :medium="true" @close="showInviteForm = false">
      <div class="projects-invite-dialog">
        <section><h3>邀请好友</h3><p>好友会收到项目邀请，可自行接受或拒绝。</p><div class="projects-invite-row"><select v-model="selectedFriendId" aria-label="选择好友"><option value="">选择一位好友</option><option v-for="item in friends" :key="item.profile.userId" :value="item.profile.userId">{{ item.profile.nickname }}<template v-if="item.profile.school"> · {{ item.profile.school }}</template></option></select><button class="btn btn-primary" type="button" :disabled="!selectedFriendId || actionBusy === 'invite-friend'" @click="inviteFriend">发送邀请</button></div><p v-if="friendsLoading" class="projects-form-hint">正在载入好友…</p><p v-else-if="!friends.length" class="projects-form-hint">没有可邀请的好友；也可以创建受控邀请链接。</p></section>
        <section><h3>受控邀请链接</h3><p>链接有效期 7 天，最多可加入 5 人。任何拿到链接并登录验证的账号都能加入。</p><button class="btn btn-secondary" type="button" :disabled="linkBusy" @click="createInviteLink">{{ linkBusy ? '正在创建…' : '创建并复制邀请链接' }}</button><div v-if="linkToShare" class="invite-link-result"><label>本次邀请链接<input :value="linkToShare" readonly @focus="$event.target.select()" /></label><button class="btn btn-ghost" type="button" @click="copyInviteLink(linkToShare)">复制</button></div><div v-if="inviteLinks.length" class="invite-link-list"><div v-for="link in inviteLinks" :key="link.id" class="invite-link-row"><span>{{ link.revokedAt ? '已停用' : new Date(link.expiresAt) <= new Date() ? '已过期' : `使用 ${link.uses}/${link.maxUses}` }} · {{ formatDate(link.expiresAt) }}过期</span><button v-if="!link.revokedAt && new Date(link.expiresAt) > new Date()" class="btn btn-ghost danger-text" type="button" :disabled="actionBusy === `link:${link.id}`" @click="revokeInviteLink(link.id)">停用</button></div></div></section>
        <section v-if="pendingMemberInvites.length"><h3>等待接受的邀请</h3><p v-for="member in pendingMemberInvites" :key="member.userId" class="projects-form-hint">{{ member.nickname }} · 已发送邀请</p></section>
      </div>
    </Modal>

    <Modal v-if="taskEventsTitle" :open="Boolean(taskEventsTitle)" :title="`${taskEventsTitle} · 进展记录`" @close="taskEventsTitle = ''; taskEvents = []">
      <ol class="project-activity-list task-event-list"><li v-for="event in taskEvents" :key="event.id"><span class="activity-dot"></span><div><strong>{{ event.actorName }}</strong><span>{{ ({ created: '创建任务', assigned: '更新负责人', assignment_accepted: '接受分工', assignment_declined: '拒绝分工', updated: '更新任务信息', status_changed: `状态更新为${PROJECT_TASK_STATUS[event.details?.to] || '已变更'}`, member_left: '负责人退出项目，任务已释放', member_removed: '负责人已移出项目，任务已释放' })[event.type] || '记录了进展' }}</span><small>{{ formatDateTime(event.createdAt) }}</small></div></li></ol>
      <p v-if="!taskEvents.length" class="projects-rail-empty">还没有进展记录。</p>
    </Modal>

    <Modal v-if="transferTargetId" :open="Boolean(transferTargetId)" title="转交项目负责人" @close="transferTargetId = ''">
      <p class="transfer-confirm-copy">转交后，你会成为管理员，仍可管理项目和成员。</p>
      <template #foot><div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="transferTargetId = ''">取消</button><button class="btn btn-primary" type="button" :disabled="actionBusy === 'transfer-owner'" @click="transferOwner">确认转交</button></div></template>
    </Modal>

    <ConfirmDialog v-if="confirmAction" :open="Boolean(confirmAction)" :title="({ archive: '归档项目', delete: '删除项目', leave: '退出项目', remove: '移出成员', restore: '恢复项目', 'decline-invite': '拒绝项目邀请', 'delete-milestone': '删除里程碑', 'meeting-confirm': '确认小组讨论', 'meeting-cancel': '取消讨论邀约', 'meeting-apply-proposal': '采用改期建议', 'delivery-check-delete': '删除交付检查项' })[confirmAction.kind] || '确认操作'" :message="({ archive: '归档后，成员可以查看历史内容，但不能新增成员或任务。', delete: '项目会移入回收站，成员暂时不能进入；可以通过负责人恢复项目。', leave: '退出后，你的个人待办会保留为个人记录，项目负责人可以重新分配未完成任务。', remove: `确定将${confirmAction.targetName || '该成员'}移出项目吗？未完成的分工会释放。`, restore: '恢复后，项目成员可以继续协作。', 'decline-invite': '拒绝后，项目邀请会从待处理列表移除。', 'delete-milestone': '删除后，关联任务仍会保留，只解除与此阶段的关联。', 'meeting-confirm': '所有受邀成员已接受。确认后会将讨论加入已接受成员的个人日程。', 'meeting-cancel': '取消后，成员的个人日程会标记为已取消。', 'meeting-apply-proposal': '采用后将新的时间发给全体受邀成员重新确认。', 'delivery-check-delete': '删除后，交付清单会移除此检查项。' })[confirmAction.kind] || ''" :confirm-label="confirmAction.kind === 'delete' || confirmAction.kind === 'remove' || confirmAction.kind === 'delivery-check-delete' || confirmAction.kind === 'delete-milestone' ? '确认删除' : '确认'" :tone="confirmAction.kind === 'delete' || confirmAction.kind === 'remove' || confirmAction.kind === 'leave' || confirmAction.kind === 'delivery-check-delete' || confirmAction.kind === 'meeting-cancel' || confirmAction.kind === 'delete-milestone' ? 'danger' : 'primary'" @close="confirmAction = null" @confirm="runConfirmedAction" />
  </div>
</template>

<style scoped src="./projects.css"></style>
