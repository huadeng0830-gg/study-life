<script setup>
import PageHeader from '../components/PageHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import ActionButton from '../components/ActionButton.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCollaborationContext } from '../composables/collaborationContext.js'
import { useRoute, useRouter } from 'vue-router'
import { socialRequest } from '../services/social.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import VirtualList from '../components/VirtualList.vue'
import Modal from '../components/Modal.vue'
import ProjectTaskWorkProgress from '../components/projects/ProjectTaskWorkProgress.vue'
import ProjectTaskOverview from '../components/projects/ProjectTaskOverview.vue'
import ProjectDraftRecovery from '../components/projects/ProjectDraftRecovery.vue'
import { useProjectMeetings } from '../composables/projects/useProjectMeetings.js'
import TaskWorkSession from '../components/tasks/TaskWorkSession.vue'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { announce as announceLive, announceAlert } from '../composables/liveRegion.js'
import { detachProjectTaskTodos, ensureProjectTaskTodo, setProjectTaskTodoStatus, useProjectTaskSyncState } from '../composables/projectTaskBridge.js'
import { usePendingFieldEdits } from '../composables/pendingFieldEdits.js'
import { loadProjectTaskCheckpoints, attachProjectTaskCheckpoints } from '../composables/projects/projectTaskCheckpoints.js'
import { taskEventLabel } from '../composables/projects/taskEventLabel.js'
import { isProjectTaskBlocked, selectProjectTasks, projectTaskOverview, projectDeliveryCenter, projectTaskRisks } from '../composables/projects/projectTaskSelectors.js'
import { useProjectTaskWorkbench } from '../composables/projects/useProjectTaskWorkbench.js'
import { useProjectDeliverableEditor } from '../composables/projects/useProjectDeliverableEditor.js'
import { createProjectRequestScope } from '../composables/projects/projectRequestScope.js'
import { createProjectEditorScope } from '../composables/projects/projectEditorScope.js'
import { useProjectTaskActions } from '../composables/projects/useProjectTaskActions.js'
import { useProjectInvites } from '../composables/projects/useProjectInvites.js'
import { useProjectAdjustments } from '../composables/projects/useProjectAdjustments.js'
import { useProjectPlanning } from '../composables/projects/useProjectPlanning.js'
import { useScopedProjectAction } from '../composables/projects/useScopedProjectAction.js'
import { confirmCommand, confirmDialogCopy } from '../composables/projects/projectConfirmCopy.js'
import { activityLabel, adjustmentStatus, deliverableStatus, formatDate, nextDay, roleLabel } from '../composables/projects/projectDisplayText.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { syncProjectMeetingEvents, detachProjectMeetingEvents } from '../composables/projectMeetingBridge.js'
import {
  newProjectId, PROJECT_TASK_PRIORITY, PROJECT_TASK_STATUS, PROJECT_TYPE_LABELS, PROJECT_TYPES,
  getProjectDeliverableFileUrl, projectRequest as requestProject, validateProjectForm, validateProjectTaskForm,
} from '../services/projects.js'
import { dateInZone } from '../composables/zonedTime.js'
import { formatDateTime } from '../composables/intlFormatters.js'
import { errorMessage as sharedErrorMessage } from '../utils/errors.js'

const route = useRoute()
const router = useRouter()
const domain = useDomainCommands()
const taskSync = useProjectTaskSyncState()

const accountContext = createCollaborationContext(() => [accountUser.value?.id || ''])
const projectContext = createCollaborationContext(() => [accountUser.value?.id || '', selectedProjectId.value], { onError: (error) => notify('error', errorMessage(error)) })
const projects = accountContext.state([])
const selectedProjectId = accountContext.state('')
const project = accountContext.state(null)
const members = accountContext.state([])
/** @type {import('vue').Ref<Array<Record<string, any>>>} */
const tasks = accountContext.state([])
const milestones = accountContext.state([])
/** @type {import('vue').Ref<Array<{ id: string, title: string, required: boolean, checked: boolean, checkedByName?: string, evidence: string, revision: number }>>} */
const deliveryChecks = accountContext.state([])
const activities = accountContext.state([])
const adjustments = accountContext.state([])
const deliverables = accountContext.state([])
const meetings = accountContext.state([])
const inbox = accountContext.state(() => ({ invitations: [], assignments: [], adjustments: [], reviews: [], meetings: [] }))
const activeSection = ref('tasks')
const showArchived = ref(false)
const pageLoading = accountContext.state(false)
const detailLoading = accountContext.state(false)
const pageError = accountContext.state('')
const notice = accountContext.state(null)
const actionBusy = projectContext.state('')
const { pending: pendingTaskActions, run: runTaskAction } = useProjectTaskActions(projectContext, actionBusy, currentProjectRequest)
const showProjectForm = accountContext.state(false)
const editingProject = accountContext.state(false)
const projectDraft = accountContext.state(blankProject)
const projectRequestId = accountContext.state('')
const showTaskForm = accountContext.state(false)
const taskDraft = accountContext.state(blankTask)
const editingTask = accountContext.state(false)
const showDeliverableForm = accountContext.state(false)
const deliverableDraft = accountContext.state(blankDeliverable)
const reviewTarget = accountContext.state(null)
const reviewFeedback = accountContext.state('')
const reviewChecklist = accountContext.state(() => [{ item: '符合交付要求', passed: false }])
const taskEvents = accountContext.state([])
const taskEventsTitle = accountContext.state('')
const projectCheckpointError = accountContext.state('')
const confirmAction = accountContext.state(null)
const lastDeletedProjectId = accountContext.state('')
const transferTargetId = accountContext.state('')
const joiningToken = accountContext.state('')
const scheduleTimezone = accountContext.state('')
const projectSaveBusy = accountContext.state(false)
// 表单自己的错误位。原先这里绑的是 pageError——那**只**记录列表/详情加载失败，而表单校验
// 失败走 notify() → 顶部 notice，于是校验提示在这个 aria-live 区永不出现、而旧列表报错会串进
// 表单。完整推理见 tests/projectsFormErrorBinding.test.js。
const projectFormError = accountContext.state('')
const deliveryEvidenceEdits = usePendingFieldEdits() // 「凭证与说明」绑在服务端对象上，每 120 秒自动刷新会整体替换 deliveryChecks，未保存的输入会被静默清空；换项目时清空（id 属旧项目）
const taskSaveBusy = accountContext.state(false)
const deliverableSaveBusy = accountContext.state(false)
const reviewSaveBusy = accountContext.state(false)
const statusFilter = ref('open')
const projectSearch = ref('')
const taskSearch = ref('')
const assigneeFilter = ref('all')
const milestoneFilter = ref('')
const taskSort = ref('default')
const clockNow = ref(Date.now())
const inboxError = ref('')
const taskFormError = ref('')
let selectionVisit = 0
const editorScopes = {
  project: createProjectEditorScope(projectContext, showProjectForm, projectSaveBusy),
  task: createProjectEditorScope(projectContext, showTaskForm, taskSaveBusy),
  deliverable: createProjectEditorScope(projectContext, showDeliverableForm, deliverableSaveBusy),
  review: createProjectEditorScope(projectContext, reviewTarget, reviewSaveBusy),
}

function currentProjectRequest(channel) {
  const isCurrent = projectContext.capture(channel)
  const projectId = project.value?.id
  return () => isCurrent() && projectId === selectedProjectId.value && projectId === project.value?.id
}

const requestScope = createProjectRequestScope(requestProject, {
  captureProject: () => projectContext.capture(), captureAccount: () => accountContext.capture(), readProjectId: () => selectedProjectId.value,
})
const projectRequest = requestScope.request
// 作用域化动作：忙态门闩、身份守卫、失败通知、租约释放、成功重载收在一处（见 useScopedProjectAction）。
const scopedAction = useScopedProjectAction({
  context: projectContext, busy: actionBusy, notify, describeError: errorMessage,
  reload: () => loadProject(project.value.id),
})
const reloadProjectWithInbox = async () => { await loadProject(project.value.id); await loadInbox() }
const confirmCopy = computed(() => confirmDialogCopy(confirmAction.value))

const isSignedIn = computed(() => Boolean(accountUser.value?.id))
const isManager = computed(() => ['owner', 'admin'].includes(project.value?.role))
const { open: openProjectTaskWorkbench, close: closeProjectTaskWorkbench, dialogProps: workbenchDialogProps } = useProjectTaskWorkbench({
  project, tasks, isManager, accountUser, actionBusy, checkpointError: projectCheckpointError,
  projectRequest, loadProject, changeTaskStatus, notify, describeError: errorMessage,
})
const isOwner = computed(() => project.value?.role === 'owner')
const visibleProjects = computed(() => projects.value.filter((item) => (showArchived.value ? item.status === 'archived' : item.status === 'active')
  && (!projectSearch.value.trim() || [item.name, item.description, PROJECT_TYPE_LABELS[item.type]].join(' ').toLocaleLowerCase().includes(projectSearch.value.trim().toLocaleLowerCase()))))
const todayKey = computed(() => dateInZone(clockNow.value, scheduleTimezone.value || 'Asia/Shanghai'))
const taskSelection = computed(() => selectProjectTasks(tasks.value, {
  status: statusFilter.value, assignee: assigneeFilter.value, milestone: milestoneFilter.value,
  search: taskSearch.value, sort: taskSort.value, userId: accountUser.value?.id, today: todayKey.value,
}))
const filteredTasks = computed(() => taskSelection.value.parents)
const visibleTasks = computed(() => filteredTasks.value)
const taskOverview = computed(() => projectTaskOverview(tasks.value, { userId: accountUser.value?.id, today: todayKey.value }))
const hasTaskFilters = computed(() => statusFilter.value !== 'open' || assigneeFilter.value !== 'all' || milestoneFilter.value || taskSearch.value.trim() || taskSort.value !== 'default')
function resetTaskFilters() { statusFilter.value = 'open'; assigneeFilter.value = 'all'; milestoneFilter.value = ''; taskSearch.value = ''; taskSort.value = 'default' }
const dependencyTaskOptions = computed(() => tasks.value.filter((task) => task.id !== taskDraft.value.id))
const deliverableTaskOptions = computed(() => {
  const assignedTaskIds = new Set(deliverables.value.map((item) => item.taskId).filter(Boolean))
  return tasks.value.filter((task) => !task.parentTaskId && !assignedTaskIds.has(task.id))
})
const subtasksByParent = computed(() => taskSelection.value.children)
const assignedSubtasks = (taskId) => subtasksByParent.value.get(taskId) || []
const isTaskDependencyBlocked = isProjectTaskBlocked
const activeMembers = computed(() => members.value.filter((member) => member.status === 'active'))
const pendingMemberInvites = computed(() => members.value.filter((member) => member.status === 'invited'))
const pendingInboxCount = computed(() => inbox.value.invitations.length + inbox.value.assignments.length + inbox.value.adjustments.length + inbox.value.reviews.length + inbox.value.meetings.length)
const projectFormTitle = computed(() => editingProject.value ? '编辑项目' : '新建项目')
const projectRisks = computed(() => projectTaskRisks({ project: project.value, tasks: tasks.value, deliverables: deliverables.value,
  deliveryChecks: deliveryChecks.value, inbox: inbox.value, isDependencyBlocked: isTaskDependencyBlocked, now: clockNow.value, timeZone: scheduleTimezone.value || 'Asia/Shanghai' }))
const deliveryCenter = computed(() => projectDeliveryCenter(tasks.value, deliverables.value))

const deliverableEditor = useProjectDeliverableEditor({
  project, accountUser, projectRequest, loadProject, loadInbox, captureRequest: currentProjectRequest, notify, describeError: errorMessage,
})
const { showDeliverableEditor, activeDeliverable, draftContent, draftRevision, changeNote, fileUploadBusy,
  busy: deliverableEditorBusy, error: deliverableEditorError, dirty: deliverableDirty,
  conflict: deliverableConflict, latestDraft: latestDeliverableDraft,
  open: openDeliverableEditor, close: closeDeliverableEditor, addLink: addContentLink,
  upload: uploadDeliverableFiles, save: saveDeliverableDraft, submit: submitDeliverable } = deliverableEditor

const { showMeetingForm, meetingDraft, meetingProposalTarget, scheduleAvailability, scheduleDays, scheduleBusy, scheduleError,
  formatProjectTime, queryGroupAvailability, openMeetingForm, openMeetingProposal, saveMeetingForm, respondMeeting,
  meetingCanConfirm, meetingStatusLabel, meetingParticipantStatus } = useProjectMeetings({
  project, activeMembers, accountUser, isManager, scheduleTimezone, projectContext, actionBusy, projectRequest, loadProject, loadInbox, notify, describeError: errorMessage,
})

const { showInviteForm, selectedFriendId, friends, inviteLinks, linkToShare, friendsLoading, linkBusy,
  loadFriends, loadInviteLinks, inviteFriend, createInviteLink, copyInviteLink, revokeInviteLink } = useProjectInvites({
  accountContext, projectContext, scopedAction, project, members, projectRequest, currentProjectRequest,
  notify, describeError: errorMessage,
})

const { showAdjustmentForm, adjustmentTask, adjustmentDraft, adjustmentSaveBusy, openAdjustment,
  saveAdjustment, canRespondAdjustment, adjustmentTypeLabel, adjustmentDataSummary, decideAdjustment,
  cancelAdjustment, canAddAdjustment } = useProjectAdjustments({
  accountContext, projectContext, scopedAction, project, accountUser, isManager, activeMembers, adjustments,
  projectRequest, reloadProject: reloadProjectWithInbox,
})

const { planningSaveBusy, showMilestoneForm, milestoneDraft, editingMilestone, showDeliveryCheckForm, deliveryCheckDraft,
  milestoneTaskLabel, openMilestoneForm, saveMilestone, toggleMilestone, openDeliveryCheckForm, saveDeliveryCheckItem } = useProjectPlanning({
  accountContext, projectContext, scopedAction, project, isManager, milestones, projectRequest,
})

function applyTaskSummaryFilter(filters) { resetTaskFilters(); statusFilter.value = filters.status; assigneeFilter.value = filters.assignee; activeSection.value = 'tasks' }

function blankProject() {
  return { name: '', description: '', type: 'blank', startsOn: '', targetEndOn: '' }
}

function blankTask(parentTaskId = '') {
  return { id: '', parentTaskId, title: '', description: '', dueOn: '', priority: 'normal', assigneeId: '', milestoneId: '', dependsOnTaskId: '', revision: 0 }
}

function blankDeliverable() { return { id: '', taskId: '', title: '', instructions: '', reviewerId: '', required: true, reviewRequired: true } }

function notify(kind, text) {
  if (!text) return
  notice.value = { kind, text }
  if (kind === 'error') announceAlert(text, { clearAfter: 7000 })
  else announceLive(text, { clearAfter: 5000 })
}

function errorMessage(error, fallback = '操作没有完成，请稍后重试。') {
  // project_context_changed 表示用户已经切走/换账号了，报错只会误导，这里保持静默。
  if (error?.code === 'project_context_changed') return ''
  return sharedErrorMessage(error, fallback)
}

async function loadInbox() {
  if (!isSignedIn.value) return
  const isCurrent = accountContext.capture('inbox')
  try {
    const result = await projectRequest('inbox')
    if (isCurrent()) { inbox.value = result; inboxError.value = '' }
  } catch (error) {
    if (isCurrent() && errorMessage(error)) inboxError.value = '暂时无法更新待处理事项，可刷新重试。'
  }
}

async function loadProjects({ keepSelected = true } = {}) {
  if (!isSignedIn.value) {
    accountContext.invalidate()
    projectContext.invalidate()
    closeProjectTaskWorkbench()
    return
  }
  pageLoading.value = true
  pageError.value = ''
  const isCurrent = accountContext.capture('list')
  try {
    const [result] = await Promise.all([projectRequest('list'), loadInbox()])
    if (!isCurrent()) return
    projects.value = result.projects || []
    const queryId = String(route.query.project || '')
    const currentId = keepSelected && projects.value.some((item) => item.id === selectedProjectId.value) ? selectedProjectId.value : ''
    const nextId = [queryId, currentId, projects.value.find((item) => item.status === (showArchived.value ? 'archived' : 'active'))?.id, projects.value[0]?.id].find((id) => id && projects.value.some((item) => item.id === id)) || ''
    if (queryId !== nextId && queryId) await syncProjectQuery(nextId)
    if (!isCurrent()) return
    if (nextId && nextId !== selectedProjectId.value) await selectProject(nextId, { automatic: true })
    else if (nextId) await loadProject(nextId)
    else {
      if (selectedProjectId.value) resetProjectDialogs()
      selectedProjectId.value = ''
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
    if (isCurrent()) pageError.value = errorMessage(error, '暂时无法读取项目，请检查网络后重试。')
  } finally {
    if (isCurrent()) pageLoading.value = false
  }
}

async function loadProject(id = selectedProjectId.value) {
  if (!isSignedIn.value || !id) return
  const isCurrent = projectContext.capture('detail')
  detailLoading.value = true
  try {
    const checkpointLoad = loadProjectTaskCheckpoints(id, projectRequest, (error) => errorMessage(error))
    const [result, adjustmentResult, deliverableResult, meetingResult, profileResult, checkpointResult] = await Promise.all([
      projectRequest('detail', { projectId: id }),
      projectRequest('adjustments_list', { projectId: id }),
      projectRequest('deliverables', { projectId: id }),
      projectRequest('meetings_list', { projectId: id }),
      socialRequest('profile_get').catch(() => null),
      checkpointLoad,
    ])
    if (!isCurrent()) return
    pageError.value = ''
    clockNow.value = Date.now()
    projectCheckpointError.value = checkpointResult.error
    project.value = result.project
    members.value = result.members || []
    tasks.value = attachProjectTaskCheckpoints(result.tasks || [], checkpointResult.items)
    milestones.value = result.milestones || []
    deliveryChecks.value = result.deliveryChecks || []
    deliveryEvidenceEdits.reapply(deliveryChecks.value, 'evidence') // 自动刷新后保住未保存的说明
    activities.value = result.activities || []
    adjustments.value = adjustmentResult.requests || []
    deliverables.value = deliverableResult.deliverables || []
    meetings.value = meetingResult.meetings || []
    scheduleTimezone.value = profileResult?.profile?.timezone || scheduleTimezone.value
    if (scheduleTimezone.value) syncProjectMeetingEvents(id, meetings.value, project.value, domain, accountUser.value?.id, scheduleTimezone.value)
    const acceptedMine = tasks.value.filter((task) => task.assigneeId === accountUser.value?.id && task.assignmentStatus === 'accepted')
    for (const task of acceptedMine) ensureProjectTaskTodo(task, project.value, domain)
    detachProjectTaskTodos(id, acceptedMine.map((task) => task.id), domain)
    openRouteTask()
  } catch (error) {
    if (!isCurrent()) return
    if (![403, 404].includes(error?.status) && project.value?.id === id) {
      pageError.value = errorMessage(error, '暂时无法刷新项目。')
      return
    }
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
    projectCheckpointError.value = ''
    pageError.value = errorMessage(error, '暂时无法读取项目内容，请刷新后重试。')
  } finally {
    if (isCurrent()) detailLoading.value = false
  }
}

let refreshPromise = null
async function refresh() {
  if (refreshPromise) return refreshPromise
  const pending = loadProjects()
  refreshPromise = pending
  try {
    return await pending
  } finally {
    if (refreshPromise === pending) refreshPromise = null
  }
}

async function syncProjectQuery(id) {
  const query = { ...route.query }
  delete query.join
  if (String(route.query.project || '') !== id) delete query.task
  if (id) query.project = id
  else delete query.project
  if (JSON.stringify(query) !== JSON.stringify(route.query)) await router.replace({ path: '/projects', query })
}

function openRouteTask() {
  if (!route.query.task || String(route.query.project || '') !== project.value?.id) return
  const task = tasks.value.find((item) => String(item.id) === String(route.query.task))
  if (task) openProjectTaskWorkbench(task)
  else notify('info', '这个任务已被移除或暂时无法查看。')
  const query = { ...route.query }; delete query.task
  void router.replace({ path: '/projects', query })
}

function resetProjectDialogs() {
  projectContext.invalidate()
  closeProjectTaskWorkbench(); deliverableEditor.reset()
  scheduleAvailability.value = null; scheduleError.value = ''; scheduleBusy.value = false
  showProjectForm.value = false; showTaskForm.value = false; showAdjustmentForm.value = false
  showDeliverableForm.value = false; showInviteForm.value = false; showMilestoneForm.value = false
  showDeliveryCheckForm.value = false; showMeetingForm.value = false
  activeDeliverable.value = null; adjustmentTask.value = null; reviewTarget.value = null; meetingProposalTarget.value = null
  confirmAction.value = null; transferTargetId.value = ''; taskEventsTitle.value = ''; taskEvents.value = []
  actionBusy.value = ''; projectSaveBusy.value = false; taskSaveBusy.value = false; adjustmentSaveBusy.value = false
  deliverableSaveBusy.value = false; reviewSaveBusy.value = false; planningSaveBusy.value = false
  friendsLoading.value = false; linkBusy.value = false; friends.value = []; inviteLinks.value = []; linkToShare.value = ''; selectedFriendId.value = ''
}

function currentNavigationRequest() {
  const visit = selectionVisit, isCurrentAccount = accountContext.capture()
  return () => visit === selectionVisit && isCurrentAccount()
}

async function selectProject(id, { automatic = false } = {}) {
  if (!automatic) selectionVisit++
  if (id === selectedProjectId.value && project.value?.id === id) { activeSection.value = 'tasks'; return }
  resetProjectDialogs()
  deliveryEvidenceEdits.clearAll()
  selectedProjectId.value = id; project.value = null; pageError.value = ''; detailLoading.value = true
  tasks.value = []; members.value = []; milestones.value = []; deliveryChecks.value = []
  activities.value = []; adjustments.value = []; deliverables.value = []; meetings.value = []
  activeSection.value = 'tasks'; resetTaskFilters()
  showArchived.value = projects.value.find((item) => item.id === id)?.status === 'archived'
  projectSearch.value = ''
  await Promise.all([syncProjectQuery(id), loadProject(id)])
}

function openCreateProject() {
  editingProject.value = false
  projectDraft.value = blankProject()
  projectRequestId.value = newProjectId()
  projectFormError.value = ''
  showProjectForm.value = true
}

function openEditProject() {
  if (!project.value || !isManager.value) return
  editingProject.value = true
  projectFormError.value = ''
  projectDraft.value = {
    name: project.value.name || '', description: project.value.description || '', type: project.value.type || 'blank',
    startsOn: project.value.startsOn || '', targetEndOn: project.value.targetEndOn || '',
  }
  showProjectForm.value = true
}

async function saveProject() {
  const isCurrent = editorScopes.project.capture()
  const isCurrentNavigation = currentNavigationRequest()
  const validated = validateProjectForm(projectDraft.value)
  if (!validated.ok) { projectFormError.value = validated.message || '请检查项目名称与日期。'; notify('error', projectFormError.value); return }
  if (projectSaveBusy.value) return
  if (!editingProject.value && !projectRequestId.value) {
    const message = '当前环境无法生成安全项目编号，请更新浏览器后重试。'
    projectFormError.value = message
    notify('error', message)
    return
  }
  projectFormError.value = ''
  projectSaveBusy.value = true
  try {
    if (editingProject.value) {
      await projectRequest('update', { projectId: project.value.id, expectedRevision: project.value.revision, ...validated.value })
      if (!isCurrent()) return
      notify('success', '项目已保存。')
      showProjectForm.value = false
      await refresh()
    } else {
      const result = await projectRequest('create', { id: projectRequestId.value, ...validated.value })
      if (!isCurrent()) return
      showProjectForm.value = false
      notify('success', '项目已创建。')
      await loadProjects({ keepSelected: false })
      if (isCurrentNavigation() && result.projectId) await selectProject(result.projectId, { automatic: true })
    }
  } catch (error) { if (!isCurrent()) return;
    // 服务端拒绝也要就地显示：用户此刻正盯着表单，只在顶部横幅提示很容易被忽略。
    const message = errorMessage(error)
    projectFormError.value = message
    notify('error', message)
  } finally { if (isCurrent()) projectSaveBusy.value = false }
}

function askConfirm(action) { confirmAction.value = action }

async function runConfirmedAction() {
  const action = confirmAction.value
  const entry = confirmCommand(action)
  if (!entry) return
  const projectId = action.projectId || project.value?.id
  return scopedAction.run({
    busyValue: action.kind,
    current: action.kind === 'decline-invite' ? accountContext.capture() : currentProjectRequest(),
    operation: () => projectRequest(entry.command, { projectId, ...entry.payload(action) }),
    success: entry.message,
    commit: async () => {
      if (action.kind === 'archive' || action.kind === 'restore') showArchived.value = action.kind === 'archive'
      if (action.kind === 'leave') detachProjectTaskTodos(projectId, [], domain)
      if (action.kind === 'delete') lastDeletedProjectId.value = projectId
      confirmAction.value = null
      if (action.kind === 'delete') await loadProjects({ keepSelected: false })
      else await refresh()
    },
    reload: false,
  })
}

async function acceptProjectInvite(projectId) {
  const isCurrentNavigation = currentNavigationRequest()
  return scopedAction.run({
    busyValue: `invite:${projectId}`,
    operation: () => projectRequest('invite_respond', { projectId, decision: 'accept' }),
    success: '已加入项目。',
    commit: async () => {
      await loadProjects({ keepSelected: false })
      if (isCurrentNavigation()) await selectProject(projectId, { automatic: true })
    },
    reload: false,
  })
}

function openTaskCreate(parentTaskId = '') {
  if (project.value?.status !== 'active') return
  editingTask.value = false
  taskFormError.value = ''
  taskDraft.value = blankTask(parentTaskId)
  taskDraft.value.id = newProjectId()
  showTaskForm.value = true
}

function openTaskEdit(task) {
  if (!task || !isManager.value || project.value?.status !== 'active') return
  editingTask.value = true
  taskFormError.value = ''
  taskDraft.value = {
    id: task.id, parentTaskId: task.parentTaskId || '', title: task.title || '',
    description: task.description || '', dueOn: task.dueOn || '', priority: task.priority || 'normal',
    assigneeId: task.assigneeId || '', milestoneId: task.milestoneId || '', dependsOnTaskId: task.dependsOnTaskId || '', revision: task.revision,
  }
  showTaskForm.value = true
}

async function saveTask() {
  const validated = validateProjectTaskForm(taskDraft.value)
  if (!validated.ok) { taskFormError.value = validated.message; return }
  const { title } = validated.value
  taskFormError.value = ''
  return scopedAction.run({
    busy: taskSaveBusy, current: editorScopes.task.capture(),
    check: () => Boolean(taskDraft.value.id),
    operation: () => (editingTask.value
      ? projectRequest('task_update', {
        projectId: project.value.id, taskId: taskDraft.value.id, expectedRevision: taskDraft.value.revision,
        title, description: taskDraft.value.description.trim(), dueOn: taskDraft.value.dueOn,
        priority: taskDraft.value.priority, assigneeId: taskDraft.value.assigneeId, milestoneId: taskDraft.value.milestoneId,
        dependsOnTaskId: taskDraft.value.dependsOnTaskId,
      })
      : projectRequest('task_create', { ...taskDraft.value, projectId: project.value.id, title, description: taskDraft.value.description.trim() })),
    commit: () => { showTaskForm.value = false; editingTask.value = false },
    success: () => (editingTask.value ? '任务已更新。' : '任务已添加。'),
    reload: reloadProjectWithInbox,
    onError: (error) => { taskFormError.value = errorMessage(error); notify('error', taskFormError.value) },
  })
}

function openDeliverableCreate() {
  if (!isManager.value || project.value?.status !== 'active') return
  deliverableDraft.value = blankDeliverable()
  deliverableDraft.value.id = newProjectId()
  showDeliverableForm.value = true
}

async function saveDeliverable() {
  const draft = deliverableDraft.value
  return scopedAction.run({
    busy: deliverableSaveBusy, current: editorScopes.deliverable.capture(),
    check: () => {
      if (!draft.title.trim()) return '请填写交付项名称。'
      return Boolean(draft.id)
    },
    operation: () => projectRequest('deliverable_create', { ...draft, projectId: project.value.id, title: draft.title.trim(), instructions: draft.instructions.trim() }),
    commit: () => { showDeliverableForm.value = false },
    success: '交付项已添加。',
  })
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

async function openProjectSection(item, section, taskId = '') {
  await selectProject(item.projectId)
  if (selectedProjectId.value !== item.projectId || project.value?.id !== item.projectId) return
  activeSection.value = section
  if (taskId) { const task = tasks.value.find((entry) => entry.id === taskId); if (task) openProjectTaskWorkbench(task) }
}
function openInboxAdjustment(item) { void openProjectSection(item, 'adjustments') }

function openInboxReview(item) { void openProjectSection(item, 'deliverables') }

function addReviewChecklistItem() {
  if (reviewChecklist.value.length < 20) reviewChecklist.value.push({ item: '', passed: false })
}

async function saveDeliveryCheck(item, checked = item.checked) {
  const evidence = item.evidence || ''
  return scopedAction.run({
    busyValue: `delivery-check:${item.id}`,
    operation: () => projectRequest('delivery_check_update', { projectId: project.value.id, checkId: item.id, expectedRevision: item.revision, checked, evidence }),
    commit: () => { if (deliveryEvidenceEdits.pending.value.get(item.id) === evidence) deliveryEvidenceEdits.clear(item.id) },
    success: checked ? '交付检查已记录。' : '交付检查已重新打开。',
  })
}

function openInboxMeeting(item) { void openProjectSection(item, 'schedule') }

async function decideReview(result) {
  return scopedAction.run({
    busy: reviewSaveBusy, current: editorScopes.review.capture(),
    check: () => {
      if (!reviewTarget.value) return false
      if (!reviewFeedback.value.trim()) return '请填写具体验收意见。'
      if (result === 'approved' && reviewChecklist.value.some((item) => !item.passed)) return '请先通过所有检查项，或将成果退回修改。'
      return true
    },
    operation: () => projectRequest('deliverable_review', {
      projectId: project.value.id, deliverableId: reviewTarget.value.deliverableId,
      versionId: reviewTarget.value.versionId, result, feedback: reviewFeedback.value.trim(), checklist: reviewChecklist.value,
    }),
    commit: () => { reviewTarget.value = null },
    success: result === 'approved' ? '成果已通过验收。' : '成果已退回修改。',
    reload: reloadProjectWithInbox,
  })
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
  const projectId = project.value.id
  return runTaskAction(task.id, async (isCurrent) => {
    const result = await projectRequest('task_respond', { projectId, taskId: task.id, decision })
    if (!isCurrent()) return
    if (result.assignmentStatus === 'accepted') ensureProjectTaskTodo({ ...task, ...result }, project.value, domain)
    notify('success', decision === 'accept' ? '已接受分工，任务已加入你的个人待办。' : '已拒绝分工，负责人会看到需要重新安排。')
    await loadProject(projectId)
    if (isCurrent()) await loadInbox()
  })
}

async function changeTaskStatus(task, status) {
  const projectId = project.value.id
  return runTaskAction(task.id, async (isCurrent) => {
    await projectRequest('task_status', { projectId, taskId: task.id, status })
    if (!isCurrent()) return false
    setProjectTaskTodoStatus(task, project.value, status, domain)
    notify('success', status === 'completed' ? '任务已完成。' : `任务状态已更新为「${PROJECT_TASK_STATUS[status]}」。`)
    await loadProject(projectId)
    if (!isCurrent()) return false
    await loadInbox()
    return isCurrent()
  })
}

async function loadTaskEvents(task) {
  const isCurrent = currentProjectRequest('task-events')
  taskEventsTitle.value = task.title
  try {
    const result = await projectRequest('task_events', { projectId: project.value.id, taskId: task.id })
    if (!isCurrent()) return
    taskEvents.value = result.events || []
  } catch (error) { if (isCurrent()) notify('error', errorMessage(error)) }
}

async function transferOwner() {
  return scopedAction.run({
    busyValue: 'transfer-owner',
    check: () => Boolean(transferTargetId.value),
    operation: () => projectRequest('owner_transfer', { projectId: project.value.id, targetId: transferTargetId.value }),
    commit: () => { transferTargetId.value = '' },
    success: '项目负责人已转交。',
    reload: () => refresh(),
  })
}

async function changeMemberRole(member) {
  if (!member?.userId) return
  const role = member.role === 'admin' ? 'member' : 'admin'
  return scopedAction.run({
    busyValue: `role:${member.userId}`,
    check: () => isOwner.value && project.value?.status === 'active' && member.role !== 'owner',
    operation: () => projectRequest('member_role_update', { projectId: project.value.id, targetId: member.userId, role }),
    success: role === 'admin' ? '已设为管理员。' : '已调整为普通成员。',
  })
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
  const isCurrent = accountContext.capture('join')
  const isCurrentNavigation = currentNavigationRequest()
  try {
    const result = await projectRequest('invite_join', { token })
    if (!isCurrent() || !isCurrentNavigation()) return
    notify('success', '已加入项目。')
    await loadProjects({ keepSelected: false })
    if (isCurrent() && isCurrentNavigation()) await selectProject(result.projectId, { automatic: true })
  } catch (error) { if (!isCurrent()) return; notify('error', errorMessage(error, '邀请链接无效或已过期。')) }
  finally {
    if (isCurrent()) joiningToken.value = ''
  }
}

async function undoDeleteProject() {
  const isCurrentNavigation = currentNavigationRequest()
  const id = lastDeletedProjectId.value
  return scopedAction.run({
    busyValue: 'restore-deleted',
    check: () => Boolean(id),
    operation: () => projectRequest('restore', { projectId: id }),
    success: '项目已恢复。',
    commit: async () => {
      lastDeletedProjectId.value = ''
      await loadProjects({ keepSelected: false })
      if (isCurrentNavigation()) await selectProject(id, { automatic: true })
    },
    reload: false,
  })
}

function taskAssignmentLabel(task) {
  if (!task.assigneeId) return '未分配'
  if (task.assignmentStatus === 'pending') return task.assigneeId === accountUser.value?.id ? '等待你确认' : '等待接受'
  if (task.assignmentStatus === 'declined') return '已拒绝，待重新分配'
  return `负责人：${task.assigneeName || members.value.find((item) => item.userId === task.assigneeId)?.nickname || '成员'}`
}

watch(() => accountUser.value?.id, (id) => {
  accountContext.invalidate()
  projectContext.invalidate()
  deliverableEditor.reset()
  inboxError.value = ''; taskFormError.value = ''; resetTaskFilters(); projectSearch.value = ''
  refreshPromise = null
  deliveryEvidenceEdits.clearAll()
  closeProjectTaskWorkbench()
  if (id) void refresh()
}, { immediate: true })
watch(() => route.query.project, (id) => {
  if (id && id !== selectedProjectId.value && projects.value.some((item) => item.id === id)) void selectProject(String(id))
})
watch(() => route.query.task, () => { if (!detailLoading.value) openRouteTask() })
watch(() => route.query.join, () => { void processJoinLink() })
watch(() => accountUser.value?.id, () => { void processJoinLink() })

let refreshTimer = 0
let lastAutomaticRefreshAt = 0
const AUTO_REFRESH_INTERVAL = 120_000
function refreshAutomatically() {
  clockNow.value = Date.now()
  if (document.visibilityState !== 'visible' || route.path !== '/projects' || !isSignedIn.value || actionBusy.value || pendingTaskActions.value.size || taskSaveBusy.value || projectSaveBusy.value || deliverableEditorBusy.value || fileUploadBusy.value) return
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
  accountContext.invalidate()
  projectContext.invalidate()
  deliverableEditor.reset()
  window.clearInterval(refreshTimer)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onWindowFocus)
})
</script>

<template>
  <div class="page projects-page">
    <PageHeader class="page-head projects-head" title="齐行">
      <p class="page-subtitle">一个人可以管理项目，需要时再邀请队友一起推进。</p>
      <template #actions><div class="projects-head-actions">
        <ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="pageLoading" kind="important" feedback="external" :show-error="false" :action="() => refresh()">刷新</ActionButton>
        <button class="btn btn-primary" type="button" :disabled="!isSignedIn" @click="openCreateProject">新建项目</button>
      </div></template>
    </PageHeader>

    <div v-if="notice" class="projects-notice" :class="`is-${notice.kind}`">
      <span>{{ notice.text }}</span><button v-if="lastDeletedProjectId" class="projects-undo" type="button" :disabled="actionBusy === 'restore-deleted'" @click="undoDeleteProject">撤销删除</button><button type="button" aria-label="关闭提示" @click="notice = null">×</button>
    </div>
    <div v-if="taskSync.pending" class="projects-notice is-warning" role="status">
      <span>{{ taskSync.message }} 尚有 {{ taskSync.pending }} 项。</span>
    </div>
    <p v-if="pageError" class="projects-error" role="alert">{{ pageError }}</p>
    <p v-if="inboxError" class="projects-form-hint" role="status">{{ inboxError }}</p>

    <section v-if="!isSignedIn" class="projects-signin panel">
      <div class="projects-signin-icon" aria-hidden="true"><AppIcon name="projects" /></div>
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
            <ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="actionBusy === `invite:${invite.projectId}`" kind="important" feedback="external" :show-error="false" :action="() => acceptProjectInvite(invite.projectId)">接受</ActionButton>
          </div>
        </div>
        <div v-for="assignment in inbox.assignments" :key="`assignment-${assignment.taskId}`" class="projects-inbox-row">
          <div><strong>{{ assignment.title }}</strong><span>{{ assignment.projectName }} · 等待你确认分工</span></div>
          <button class="btn btn-ghost" type="button" @click="openProjectSection(assignment, 'tasks', assignment.taskId)">查看任务</button>
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
          <input v-model="projectSearch" class="projects-search" type="search" maxlength="200" aria-label="搜索项目" placeholder="搜索项目" />
          <p v-if="showArchived" class="projects-rail-hint">已归档项目</p>
          <button v-for="item in visibleProjects" :key="item.id" class="project-list-item" :class="{ active: item.id === selectedProjectId }" :aria-current="item.id === selectedProjectId ? 'true' : undefined" type="button" @click="selectProject(item.id)">
            <span class="project-list-icon" aria-hidden="true">{{ ({ course: '📚', competition: '🏁', research: '🔬', software: '💻', event: '🎪', blank: '🧩' })[item.type] || '🧩' }}</span>
            <span class="project-list-copy"><strong>{{ item.name }}</strong><small>{{ PROJECT_TYPE_LABELS[item.type] || '项目' }}<template v-if="item.targetEndOn"> · {{ formatDate(item.targetEndOn) }}</template></small></span>
          </button>
          <p v-if="!visibleProjects.length && !pageLoading" class="projects-rail-empty">{{ projectSearch.trim() ? '没有匹配的项目，试试其他关键词。' : showArchived ? '还没有归档项目。' : '还没有项目，先创建一个吧。' }}</p>
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
            <ProjectTaskOverview :summary="taskOverview" @filter="applyTaskSummaryFilter" />
          </header>
          <section v-if="projectRisks.length" class="project-risk-panel" aria-label="项目提醒">
            <strong>需要留意</strong><span v-for="risk in projectRisks" :key="risk">{{ risk }}</span>
          </section>

          <nav class="project-tabs" aria-label="项目分区">
            <button type="button" :aria-pressed="activeSection === 'tasks'" :class="{ active: activeSection === 'tasks' }" @click="activeSection = 'tasks'">任务</button>
            <button type="button" :aria-pressed="activeSection === 'adjustments'" :class="{ active: activeSection === 'adjustments' }" @click="activeSection = 'adjustments'">协商 <span v-if="adjustments.some((item) => item.status === 'pending')">{{ adjustments.filter((item) => item.status === 'pending').length }}</span></button>
            <button type="button" :aria-pressed="activeSection === 'deliverables'" :class="{ active: activeSection === 'deliverables' }" @click="activeSection = 'deliverables'">成果 <span>{{ deliverables.length }}</span></button>
            <button type="button" :aria-pressed="activeSection === 'schedule'" :class="{ active: activeSection === 'schedule' }" @click="activeSection = 'schedule'">团队时间</button>
            <button type="button" :aria-pressed="activeSection === 'members'" :class="{ active: activeSection === 'members' }" @click="activeSection = 'members'">成员 <span>{{ activeMembers.length }}</span></button>
            <button type="button" :aria-pressed="activeSection === 'activity'" :class="{ active: activeSection === 'activity' }" @click="activeSection = 'activity'">动态</button>
          </nav>

          <section v-if="activeSection === 'tasks'" class="project-panel panel" aria-labelledby="project-tasks-title">
            <div class="projects-section-head project-tasks-head">
              <div><h3 id="project-tasks-title">任务</h3><p>负责人发出的分工需要成员明确接受。</p></div>
              <div class="project-tasks-actions"><button v-if="project.status === 'active'" class="btn btn-primary" type="button" @click="openTaskCreate()">＋ 添加任务</button></div>
            </div>
            <div class="project-task-filters" aria-label="任务查找与筛选">
              <input v-model="taskSearch" class="projects-search" type="search" maxlength="200" aria-label="搜索任务" placeholder="搜索任务、成员或进度" />
              <select v-model="statusFilter" aria-label="任务筛选"><option value="open">未完成</option><option value="todo">待开始</option><option value="in_progress">进行中</option><option value="review">待验收</option><option value="done">已完成</option><option value="overdue">已逾期</option><option value="blocked">等待前置</option><option value="all">全部状态</option></select>
              <select v-model="assigneeFilter" aria-label="按负责人筛选"><option value="all">全部成员</option><option value="mine">我的任务</option><option value="unassigned">未分配</option><option v-for="member in activeMembers.filter((item) => item.userId !== accountUser.id)" :key="member.userId" :value="member.userId">{{ member.nickname }}</option></select>
              <select v-if="milestones.length" v-model="milestoneFilter" aria-label="按阶段筛选"><option value="">全部阶段</option><option v-for="item in milestones" :key="item.id" :value="item.id">{{ item.title }}</option></select>
              <select v-model="taskSort" aria-label="任务排序"><option value="default">默认排序</option><option value="due">截止日期优先</option><option value="priority">优先级优先</option><option value="updated">最近更新优先</option></select>
            </div>
            <div v-if="tasks.length" class="project-task-filter-status"><span role="status" aria-live="polite">匹配 {{ taskSelection.count }} 项任务（含子任务）</span><button v-if="hasTaskFilters" class="btn btn-ghost" type="button" @click="resetTaskFilters">重置筛选</button></div>
            <p v-if="projectCheckpointError" class="projects-form-hint" role="status">暂时无法读取齐行任务进度，进度保存也会暂停；任务、分工和其它项目功能仍可使用。联网后重新打开项目即可重试。</p>
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
              <span aria-hidden="true">✓</span><strong>{{ tasks.length ? '没有符合筛选条件的任务' : '项目还没有任务' }}</strong><small>{{ tasks.length ? '试试其他关键词，或查看全部任务。' : project.status === 'active' ? '添加一个简单任务，或邀请队友一起分工。' : '归档项目只保留历史查看。' }}</small>
              <button v-if="tasks.length" class="btn btn-secondary" type="button" @click="resetTaskFilters(); statusFilter = 'all'">查看全部任务</button>
              <button v-else-if="project.status === 'active'" class="btn btn-secondary" type="button" @click="openTaskCreate()">添加第一个任务</button>
            </div>
            <VirtualList v-if="visibleTasks.length" :items="visibleTasks" item-key="id" class="project-task-list" :estimated-height="118" :gap="8" :threshold="25" :overscan="4">
              <template #default="{ item: task }">
            <article class="project-task">
              <div class="project-task-main">
                <span class="task-priority" :class="`priority-${task.priority}`" :aria-label="`优先级：${PROJECT_TASK_PRIORITY[task.priority] || '普通'}`"></span>
                <div class="project-task-copy">
                  <div class="project-task-title"><strong :class="{ 'task-is-done': task.status === 'completed' }">{{ task.title }}</strong><span class="project-task-status" :class="`state-${task.status}`">{{ PROJECT_TASK_STATUS[task.status] || '待开始' }}</span></div>
                  <p v-if="task.description" class="project-task-description">{{ task.description }}</p>
                  <ProjectTaskWorkProgress :task="task" />
                  <div class="project-task-meta"><span>{{ taskAssignmentLabel(task) }}</span><span v-if="task.dueOn" :class="{ 'task-date-overdue': task.status !== 'completed' && task.dueOn < todayKey }">{{ task.status !== 'completed' && task.dueOn < todayKey ? '已逾期 · ' : '' }}{{ task.dueOn === todayKey ? '今天截止' : '截止 ' + formatDate(task.dueOn) }}</span><span v-if="milestoneTaskLabel(task.milestoneId)">阶段：{{ milestoneTaskLabel(task.milestoneId) }}</span><span v-if="isTaskDependencyBlocked(task)">等待前置：{{ task.dependencyTaskTitle }}</span><span>{{ PROJECT_TASK_PRIORITY[task.priority] || '普通' }}优先级</span></div>
                </div>
              </div>
              <div class="project-task-actions">
                <template v-if="project.status === 'active' && task.assigneeId === accountUser.id && task.assignmentStatus === 'pending'">
                  <ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="pendingTaskActions.has(task.id)" kind="important" feedback="external" :show-error="false" :action="() => respondTask(task, 'decline')">拒绝分工</ActionButton>
                  <ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="pendingTaskActions.has(task.id)" kind="important" feedback="external" :show-error="false" :action="() => respondTask(task, 'accept')">接受分工</ActionButton>
                </template>
                <template v-else-if="project.status === 'active' && task.status !== 'completed' && (isManager || (task.assigneeId === accountUser.id && task.assignmentStatus === 'accepted'))">
                  <button v-if="task.status === 'todo'" class="btn btn-secondary" type="button" :disabled="Boolean(actionBusy)" @click="openProjectTaskWorkbench(task)">工作台</button>
                  <button v-else class="btn btn-secondary" type="button" :disabled="Boolean(actionBusy)" @click="openProjectTaskWorkbench(task)">继续</button>
                  <ActionButton tone="neutral" v-if="task.status === 'in_progress'" class="btn btn-secondary" type="button" :disabled="pendingTaskActions.has(task.id) || isTaskDependencyBlocked(task)" kind="important" feedback="external" :show-error="false" :action="() => changeTaskStatus(task, 'review')">提交验收</ActionButton>
                  <ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="pendingTaskActions.has(task.id) || isTaskDependencyBlocked(task)" kind="important" feedback="external" :show-error="false" :action="() => changeTaskStatus(task, 'completed')">完成</ActionButton>
                </template>
                <button v-if="canAddAdjustment(task)" class="btn btn-ghost" type="button" @click="openAdjustment(task)">协商调整</button>
                <button v-if="isManager && project.status === 'active'" class="btn btn-ghost" type="button" @click="openTaskEdit(task)">编辑</button>
                <button v-if="project.status === 'active'" class="icon-btn" type="button" :aria-label="`为“${task.title}”添加子任务`" title="添加子任务" @click="openTaskCreate(task.id)">＋</button>
                <button class="icon-btn" type="button" :aria-label="`查看“${task.title}”的进展记录`" title="进展记录" @click="loadTaskEvents(task)">⋯</button>
              </div>
              <div v-if="assignedSubtasks(task.id).length" class="project-subtasks">
                <div v-for="child in assignedSubtasks(task.id)" :key="child.id" class="project-subtask-row">
                  <span aria-hidden="true">↳</span><strong :class="{ 'task-is-done': child.status === 'completed' }">{{ child.title }}</strong>
                  <span class="project-task-status" :class="`state-${child.status}`">{{ PROJECT_TASK_STATUS[child.status] || '待开始' }}</span>
                  <small>{{ taskAssignmentLabel(child) }}<template v-if="child.dueOn"> · {{ formatDate(child.dueOn) }}</template><template v-if="isTaskDependencyBlocked(child)"> · 等待前置：{{ child.dependencyTaskTitle }}</template></small>
                  <div class="project-subtask-actions">
                    <template v-if="project.status === 'active' && child.assigneeId === accountUser.id && child.assignmentStatus === 'pending'">
                      <ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="pendingTaskActions.has(child.id)" kind="important" feedback="external" :show-error="false" :action="() => respondTask(child, 'decline')">拒绝</ActionButton>
                      <ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="pendingTaskActions.has(child.id)" kind="important" feedback="external" :show-error="false" :action="() => respondTask(child, 'accept')">接受</ActionButton>
                    </template>
                    <template v-else-if="project.status === 'active' && child.status !== 'completed' && (isManager || (child.assigneeId === accountUser.id && child.assignmentStatus === 'accepted'))">
                      <button class="btn btn-ghost" type="button" :disabled="Boolean(actionBusy)" @click="openProjectTaskWorkbench(child)">工作台</button>
                      <ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="pendingTaskActions.has(child.id) || isTaskDependencyBlocked(child)" kind="important" feedback="external" :show-error="false" :action="() => changeTaskStatus(child, 'completed')">完成</ActionButton>
                    </template>
                    <button v-if="isManager && project.status === 'active'" class="icon-btn" type="button" :aria-label="`编辑子任务 ${child.title}`" @click="openTaskEdit(child)">✎</button>
                  </div>
                </div>
              </div>
            </article>
              </template>
            </VirtualList>
          </section>

          <section v-else-if="activeSection === 'schedule'" class="project-panel panel" aria-labelledby="project-schedule-title">
            <div class="projects-section-head"><div><h3 id="project-schedule-title">团队时间</h3><p>只返回共同空闲时段，不显示队友的课程或个人日程详情。</p></div><button v-if="project.status === 'active' && activeMembers.length >= 2" class="btn btn-primary" type="button" @click="openMeetingForm()">＋ 发起讨论</button></div>
            <section class="schedule-availability" aria-label="共同空闲时间">
              <div class="schedule-query-row"><strong>共同空闲</strong><div><ActionButton tone="ghost" v-for="days in [7, 14, 30]" :key="days" class="btn btn-ghost" type="button" :class="{ active: scheduleDays === days }" :disabled="scheduleBusy || activeMembers.length < 2" kind="task" feedback="external" :show-error="false" :action="() => queryGroupAvailability(days)">未来 {{ days }} 天</ActionButton></div></div>
              <p v-if="activeMembers.length < 2" class="projects-form-hint">邀请至少一位队友后，可以计算共同空闲时间或发起讨论。</p>
              <div v-else-if="scheduleBusy" class="projects-loading" role="status">正在按每位成员自己的学校课表和时区计算…</div>
              <p v-else-if="scheduleError" class="projects-form-error" role="alert">{{ scheduleError }} <ActionButton tone="ghost" class="btn btn-ghost" type="button" kind="task" feedback="external" :show-error="false" :action="() => queryGroupAvailability()">重试</ActionButton></p>
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
                  <template v-if="project.status === 'active' && meeting.status === 'open' && meeting.participants.some((person) => person.userId === accountUser.id && person.status === 'invited')"><button class="btn btn-ghost" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" @click="openMeetingProposal(meeting)">提出改期</button><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" kind="important" feedback="external" :show-error="false" :action="() => respondMeeting(meeting, 'decline')">拒绝</ActionButton><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="actionBusy === `meeting:${meeting.id}`" kind="important" feedback="external" :show-error="false" :action="() => respondMeeting(meeting, 'accept')">接受</ActionButton></template>
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
                <template v-if="canRespondAdjustment(request)"><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="actionBusy === `adjustment:${request.id}`" kind="important" feedback="external" :show-error="false" :action="() => decideAdjustment(request, 'reject')">拒绝</ActionButton><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="actionBusy === `adjustment:${request.id}`" kind="important" feedback="external" :show-error="false" :action="() => decideAdjustment(request, 'approve')">通过</ActionButton></template>
                <ActionButton tone="ghost" v-if="request.status === 'pending' && request.requesterId === accountUser.id" class="btn btn-ghost" type="button" :disabled="actionBusy === `adjustment:${request.id}`" kind="important" feedback="external" :show-error="false" :action="() => cancelAdjustment(request)">撤回</ActionButton>
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
                <div class="delivery-check-actions"><input v-if="project.status === 'active'" v-model="item.evidence" maxlength="1000" :aria-label="`${item.title}的凭证或说明`" placeholder="凭证或说明（选填）" @input="deliveryEvidenceEdits.mark(item.id, item.evidence)" @keydown.enter.prevent="saveDeliveryCheck(item, item.checked)" /><ActionButton tone="ghost" v-if="project.status === 'active'" class="btn btn-ghost" type="button" :disabled="actionBusy === `delivery-check:${item.id}`" kind="frequent" feedback="external" :show-error="false" :action="() => saveDeliveryCheck(item, item.checked)">保存说明</ActionButton><button v-if="isManager && project.status === 'active'" class="icon-btn danger-text" type="button" :aria-label="`删除检查项 ${item.title}`" @click="askConfirm({ kind: 'delivery-check-delete', checkId: item.id })">×</button></div>
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
              <div v-if="isOwner && project.status === 'active' && member.role !== 'owner' && member.status === 'active'" class="member-row-actions"><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="actionBusy === `role:${member.userId}`" kind="important" feedback="external" :show-error="false" :action="() => changeMemberRole(member)">{{ member.role === 'admin' ? '设为成员' : '设为管理员' }}</ActionButton><button class="btn btn-ghost" type="button" @click="transferTargetId = member.userId">转交负责人</button><button class="icon-btn danger-text" type="button" :aria-label="`移出成员 ${member.nickname}`" @click="askConfirm({ kind: 'remove', targetId: member.userId, targetName: member.nickname })">×</button></div>
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
          <div class="projects-welcome-mark" aria-hidden="true"><AppIcon name="projects" /></div>
          <h2>{{ pageLoading ? '正在载入项目…' : '从一个项目开始' }}</h2>
          <p>{{ pageLoading ? '正在同步你的项目和待处理事项。' : '课程作业、竞赛、科研、软件开发或活动筹备，都可以先从一个简单项目开始。' }}</p>
          <button v-if="!pageLoading" class="btn btn-primary" type="button" @click="openCreateProject">新建项目</button>
        </section>
      </section>
    </template>

    <Modal v-if="showProjectForm" :open="showProjectForm" :title="projectFormTitle" :medium="true" @close="showProjectForm = false">
      <form class="projects-form" @submit.prevent="saveProject">
        <fieldset class="project-editor-fields" :disabled="projectSaveBusy">
        <label>项目名称 <span aria-hidden="true">*</span><input v-model="projectDraft.name" maxlength="120" required autofocus placeholder="例如：数学建模竞赛" /></label>
        <label>项目类型<select v-model="projectDraft.type"><option v-for="item in PROJECT_TYPES" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <label>项目说明 <textarea v-model="projectDraft.description" maxlength="2000" rows="3" placeholder="选填，写下目标或背景" /></label>
        <div class="projects-form-grid"><label>开始日期<input v-model="projectDraft.startsOn" type="date" /></label><label>预计结束<input v-model="projectDraft.targetEndOn" type="date" :min="projectDraft.startsOn || undefined" /></label></div>
        <p class="projects-form-error" aria-live="polite">{{ projectFormError }}</p>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showProjectForm = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="projectSaveBusy" :busy="projectSaveBusy">{{ projectSaveBusy ? '保存中…' : editingProject ? '保存修改' : '创建项目' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showTaskForm" :open="showTaskForm" :title="editingTask ? '编辑任务' : taskDraft.parentTaskId ? '添加子任务' : '添加任务'" :medium="true" @close="showTaskForm = false; editingTask = false">
      <form class="projects-form" @submit.prevent="saveTask">
        <fieldset class="project-editor-fields" :disabled="taskSaveBusy">
        <label>任务标题 <span aria-hidden="true">*</span><input v-model="taskDraft.title" maxlength="160" required autofocus placeholder="例如：完成需求分析" /></label>
        <label>任务说明 <textarea v-model="taskDraft.description" maxlength="3000" rows="3" placeholder="选填" /></label>
        <div class="projects-form-grid"><label>负责人<select v-model="taskDraft.assigneeId"><option value="">暂不分配</option><option v-for="member in activeMembers" :key="member.userId" :value="member.userId">{{ member.userId === accountUser.id ? '我' : member.nickname }}</option></select></label><label>截止日期<input v-model="taskDraft.dueOn" type="date" /></label></div>
        <label v-if="milestones.length">所属阶段<select v-model="taskDraft.milestoneId"><option value="">不关联里程碑</option><option v-for="item in milestones" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
        <label>前置任务<select v-model="taskDraft.dependsOnTaskId"><option value="">没有前置任务</option><option v-for="item in dependencyTaskOptions" :key="item.id" :value="item.id">{{ item.title }}{{ item.status === 'completed' ? '（已完成）' : '' }}</option></select></label>
        <p v-if="taskDraft.dependsOnTaskId" class="projects-form-hint">前置任务完成前，成员不能开始或完成此任务；系统会阻止循环依赖。</p>
        <label>优先级<select v-model="taskDraft.priority"><option v-for="(label, value) in PROJECT_TASK_PRIORITY" :key="value" :value="value">{{ label }}</option></select></label>
        <p v-if="taskDraft.assigneeId" class="projects-form-hint">{{ editingTask ? '更换负责人后，新负责人需要明确接受；原负责人待办会转为个人记录。' : '分配后会等待负责人明确接受；接受后才加入对方的个人待办。' }}</p>
        <p v-if="taskFormError" class="projects-form-error" role="alert">{{ taskFormError }}</p>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showTaskForm = false; editingTask = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="taskSaveBusy" :busy="taskSaveBusy">{{ taskSaveBusy ? '保存中…' : editingTask ? '保存修改' : '添加任务' }}</ActionButton></div>
      </form>
    </Modal>

    <TaskWorkSession v-bind="workbenchDialogProps" />

    <Modal v-if="showMilestoneForm" :open="showMilestoneForm" :title="editingMilestone ? '编辑里程碑' : '添加里程碑'" :medium="true" :sheet="true" @close="showMilestoneForm = false">
      <form class="projects-form" @submit.prevent="saveMilestone">
        <fieldset class="project-editor-fields" :disabled="planningSaveBusy">
        <label>阶段名称 <span aria-hidden="true">*</span><input v-model="milestoneDraft.title" maxlength="160" required autofocus placeholder="例如：方案评审" /></label>
        <label>阶段说明<textarea v-model="milestoneDraft.description" maxlength="2000" rows="3" placeholder="选填" /></label>
        <label>关键日期<input v-model="milestoneDraft.dueOn" type="date" :min="project?.startsOn || undefined" /></label>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showMilestoneForm = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="planningSaveBusy" :busy="planningSaveBusy">{{ planningSaveBusy ? '保存中…' : editingMilestone ? '保存修改' : '添加里程碑' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showDeliveryCheckForm" :open="showDeliveryCheckForm" title="添加交付检查项" :medium="true" :sheet="true" @close="showDeliveryCheckForm = false">
      <form class="projects-form" @submit.prevent="saveDeliveryCheckItem">
        <fieldset class="project-editor-fields" :disabled="planningSaveBusy">
        <label>检查内容 <span aria-hidden="true">*</span><input v-model="deliveryCheckDraft.title" maxlength="200" required autofocus placeholder="例如：确认最终报告包含实验数据" /></label>
        <label class="project-check-row"><input v-model="deliveryCheckDraft.required" type="checkbox" />项目交付必需</label>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showDeliveryCheckForm = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="planningSaveBusy" :busy="planningSaveBusy">{{ planningSaveBusy ? '保存中…' : '添加检查项' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showMeetingForm" :open="showMeetingForm" :title="meetingProposalTarget ? '提出改期建议' : '发起小组讨论'" :medium="true" :sheet="true" @close="showMeetingForm = false; meetingProposalTarget = null">
      <form class="projects-form" @submit.prevent="saveMeetingForm">
        <fieldset class="project-editor-fields" :disabled="Boolean(actionBusy)">
        <p class="projects-form-hint">时间按你的账号时区（{{ scheduleTimezone }}）填写。其他成员会看到本地时区下的时间。</p>
        <label v-if="!meetingProposalTarget">讨论主题 <span aria-hidden="true">*</span><input v-model="meetingDraft.title" maxlength="160" required autofocus placeholder="例如：确定演示方案" /></label>
        <label v-if="!meetingProposalTarget">讨论说明<textarea v-model="meetingDraft.note" maxlength="1500" rows="2" placeholder="选填，写下议题或会议链接" /></label>
        <label>{{ meetingProposalTarget ? '建议开始时间' : '开始时间' }}<input v-model="meetingDraft.startsLocal" type="datetime-local" required /></label>
        <label>{{ meetingProposalTarget ? '建议结束时间' : '结束时间' }}<input v-model="meetingDraft.endsLocal" type="datetime-local" required /></label>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showMeetingForm = false; meetingProposalTarget = null">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="Boolean(actionBusy)" :busy="actionBusy">{{ actionBusy ? '提交中…' : meetingProposalTarget ? '发送改期建议' : '发送讨论邀请' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showAdjustmentForm" :open="showAdjustmentForm" title="协商任务调整" :medium="true" :sheet="true" @close="showAdjustmentForm = false">
      <form class="projects-form" @submit.prevent="saveAdjustment">
        <fieldset class="project-editor-fields" :disabled="adjustmentSaveBusy">
        <p class="projects-form-hint">{{ adjustmentTask?.title }} · 申请提交后先由相关成员确认，确认前不会改动现有安排。</p>
        <label>申请类型<select v-model="adjustmentDraft.type"><option value="deadline_extension">延长截止时间</option><option value="help">寻求其他成员协助</option><option value="scope_change">调整任务范围</option><option value="split">拆分任务</option><option value="handover">交接任务负责人</option><option value="unable_to_continue">无法继续承担</option></select></label>
        <label v-if="adjustmentDraft.type === 'deadline_extension'">申请的新截止日期<input v-model="adjustmentDraft.dueOn" type="date" :min="nextDay(adjustmentTask?.dueOn)" required /></label>
        <label v-if="['help', 'handover'].includes(adjustmentDraft.type)">{{ adjustmentDraft.type === 'help' ? '希望协助的成员' : '希望交接给' }}<select v-model="adjustmentDraft.targetId" required><option value="">选择项目成员</option><option v-for="member in activeMembers.filter((item) => item.userId !== accountUser.id && item.userId !== adjustmentTask?.assigneeId)" :key="member.userId" :value="member.userId">{{ member.nickname }}</option></select></label>
        <label v-if="adjustmentDraft.type === 'scope_change'">调整后的任务说明<textarea v-model="adjustmentDraft.description" maxlength="3000" rows="3" placeholder="写下希望采用的新范围" /></label>
        <label v-if="adjustmentDraft.type === 'split'">拆分后的子任务<textarea v-model="adjustmentDraft.subtasks" rows="4" placeholder="每行一个子任务，最多 8 项" /></label>
        <label>申请原因 <span aria-hidden="true">*</span><textarea v-model="adjustmentDraft.reason" maxlength="1500" rows="3" required placeholder="说明当前遇到的问题和需要怎样的调整" /></label>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showAdjustmentForm = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="adjustmentSaveBusy" :busy="adjustmentSaveBusy">{{ adjustmentSaveBusy ? '提交中…' : '提交申请' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showDeliverableForm" :open="showDeliverableForm" title="添加项目交付项" :medium="true" :sheet="true" @close="showDeliverableForm = false">
      <form class="projects-form" @submit.prevent="saveDeliverable">
        <fieldset class="project-editor-fields" :disabled="deliverableSaveBusy">
        <label>交付项名称 <span aria-hidden="true">*</span><input v-model="deliverableDraft.title" maxlength="160" required autofocus placeholder="例如：最终报告" /></label>
        <label>交付要求<textarea v-model="deliverableDraft.instructions" maxlength="3000" rows="3" placeholder="选填，写下格式、内容或检查要求" /></label>
        <label>关联任务<select v-model="deliverableDraft.taskId"><option value="">不关联具体任务</option><option v-for="task in deliverableTaskOptions" :key="task.id" :value="task.id">{{ task.title }}</option></select></label>
        <label>验收人<select v-model="deliverableDraft.reviewerId"><option value="">项目负责人或管理员</option><option v-for="member in activeMembers.filter((item) => item.userId !== accountUser.id)" :key="member.userId" :value="member.userId">{{ member.nickname }}</option></select></label>
        <label class="project-check-row"><input v-model="deliverableDraft.required" type="checkbox" />项目交付必需</label>
        <label class="project-check-row"><input v-model="deliverableDraft.reviewRequired" type="checkbox" />正式提交后需要验收</label>
        </fieldset>
        <div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="showDeliverableForm = false">取消</button><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="deliverableSaveBusy" :busy="deliverableSaveBusy">{{ deliverableSaveBusy ? '保存中…' : '添加交付项' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showDeliverableEditor" :open="showDeliverableEditor" :title="`提交成果 · ${activeDeliverable?.title || ''}`" :wide="true" :sheet="true" @close="closeDeliverableEditor">
      <form class="projects-form deliverable-editor" @submit.prevent="submitDeliverable">
        <p v-if="activeDeliverable?.instructions" class="projects-form-hint">交付要求：{{ activeDeliverable.instructions }}</p>
        <fieldset class="project-editor-fields" :disabled="deliverableEditorBusy">
        <label>成果说明<textarea v-model="draftContent.summary" maxlength="5000" rows="4" placeholder="简要说明完成内容、查看方式或注意事项" /></label>
        <div class="deliverable-editor-section"><div class="projects-section-head"><strong>在线链接</strong><button class="btn btn-ghost" type="button" :disabled="draftContent.links.length >= 10" @click="addContentLink">＋ 添加链接</button></div>
          <div v-for="(link, index) in draftContent.links" :key="index" class="deliverable-link-editor"><select v-model="link.type" aria-label="链接类型"><option value="document">在线文档</option><option value="repository">代码仓库</option><option value="commit">指定提交</option><option value="other">其他链接</option></select><input v-model="link.title" maxlength="160" aria-label="链接名称" placeholder="链接名称" /><input v-model="link.url" type="url" aria-label="HTTPS 链接" placeholder="https://…" /><button class="icon-btn" type="button" :aria-label="`删除链接 ${index + 1}`" @click="draftContent.links.splice(index, 1)">×</button></div>
        </div>
        <div class="deliverable-editor-section"><div class="projects-section-head"><strong>成果文件</strong><label class="btn btn-ghost file-pick-button">{{ fileUploadBusy ? '上传中…' : '选择文件' }}<input type="file" multiple :disabled="fileUploadBusy || draftContent.files.length >= 10" @change="uploadDeliverableFiles" /></label></div><p class="projects-form-hint">单个文件最大 5 MB，每个版本最多 10 个文件。较大的文件可添加外部链接。</p>
          <div v-for="(file, index) in draftContent.files" :key="file.path" class="deliverable-file-row"><span>{{ file.name }} · {{ Math.max(1, Math.round(file.size / 1024)) }} KB</span><button class="btn btn-ghost danger-text" type="button" @click="draftContent.files.splice(index, 1)">移除</button></div>
        </div>
        <label>本次修改说明<input v-model="changeNote" maxlength="1500" placeholder="选填，例如：根据验收意见补充了实验结果" /></label>
        </fieldset>
        <p class="projects-form-hint" role="status">{{ deliverableDirty ? '有未保存的改动，正式提交时会一并保存。' : draftRevision ? '草稿已保存，可以正式提交。' : '添加成果后可以直接提交，也可以先保存草稿。' }}</p>
        <p class="projects-form-hint">关闭后再次打开，可继续本项目尚未保存的草稿。</p>
        <p v-if="deliverableEditorError" class="projects-form-error" role="alert">{{ deliverableEditorError }}</p>
        <ProjectDraftRecovery :conflict="deliverableConflict" :latest="latestDeliverableDraft" :busy="deliverableEditorBusy || fileUploadBusy" @load="deliverableEditor.loadLatestDraft" @resolve="deliverableEditor.resolveConflict" />
        <div class="projects-form-actions deliverable-editor-actions"><button class="btn btn-ghost" type="button" @click="closeDeliverableEditor">关闭</button><ActionButton tone="neutral" class="btn btn-secondary" type="button" :disabled="deliverableEditorBusy || fileUploadBusy" kind="frequent" feedback="external" :show-error="false" :action="() => saveDeliverableDraft()">{{ deliverableEditorBusy ? '保存中…' : '保存草稿' }}</ActionButton><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="deliverableEditorBusy || fileUploadBusy" :busy="deliverableEditorBusy || fileUploadBusy">{{ deliverableEditorBusy ? '提交中…' : '正式提交新版本' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="reviewTarget" :open="Boolean(reviewTarget)" title="验收成果" :medium="true" :sheet="true" @close="reviewTarget = null">
      <form class="projects-form" @submit.prevent="decideReview('approved')">
        <fieldset class="project-editor-fields" :disabled="reviewSaveBusy">
        <p class="projects-form-hint">通过前请逐项确认检查结果；有未通过项时请选择退回修改。</p>
        <div class="review-checklist"><div v-for="(item, index) in reviewChecklist" :key="index" class="review-check-row"><input v-model="item.passed" type="checkbox" :aria-label="`检查项 ${index + 1} 通过`" /><input v-model="item.item" maxlength="200" :aria-label="`检查项 ${index + 1} 名称`" placeholder="检查项" /><button class="icon-btn" type="button" :aria-label="`删除检查项 ${index + 1}`" :disabled="reviewChecklist.length <= 1" @click="reviewChecklist.splice(index, 1)">×</button></div><button class="btn btn-ghost" type="button" :disabled="reviewChecklist.length >= 20" @click="addReviewChecklistItem">＋ 添加检查项</button></div>
        <label>验收意见 <span aria-hidden="true">*</span><textarea v-model="reviewFeedback" maxlength="3000" rows="4" required placeholder="说明检查结果，退回时请写清楚修改建议" /></label>
        </fieldset>
        <div class="projects-form-actions"><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="reviewSaveBusy" kind="important" feedback="external" :show-error="false" :action="() => decideReview('returned')">退回修改</ActionButton><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="reviewSaveBusy" :busy="reviewSaveBusy">{{ reviewSaveBusy ? '保存中…' : '通过验收' }}</ActionButton></div>
      </form>
    </Modal>

    <Modal v-if="showInviteForm" :open="showInviteForm" title="邀请成员" :medium="true" @close="showInviteForm = false">
      <div class="projects-invite-dialog">
        <section><h3>邀请好友</h3><p>好友会收到项目邀请，可自行接受或拒绝。</p><div class="projects-invite-row"><select v-model="selectedFriendId" aria-label="选择好友"><option value="">选择一位好友</option><option v-for="item in friends" :key="item.profile.userId" :value="item.profile.userId">{{ item.profile.nickname }}<template v-if="item.profile.school"> · {{ item.profile.school }}</template></option></select><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="!selectedFriendId || actionBusy === 'invite-friend'" kind="important" feedback="external" :show-error="false" :action="() => inviteFriend()">发送邀请</ActionButton></div><p v-if="friendsLoading" class="projects-form-hint">正在载入好友…</p><p v-else-if="!friends.length" class="projects-form-hint">没有可邀请的好友；也可以创建受控邀请链接。</p></section>
        <section><h3>受控邀请链接</h3><p>链接有效期 7 天，最多可加入 5 人。任何拿到链接并登录验证的账号都能加入。</p><ActionButton tone="neutral" class="btn btn-secondary" type="button" :disabled="linkBusy" kind="important" feedback="external" :show-error="false" :action="() => createInviteLink()">{{ linkBusy ? '正在创建…' : '创建并复制邀请链接' }}</ActionButton><div v-if="linkToShare" class="invite-link-result"><label>本次邀请链接<input :value="linkToShare" readonly @focus="$event.target.select()" /></label><ActionButton tone="ghost" class="btn btn-ghost" type="button" kind="frequent" feedback="external" :show-error="false" :action="() => copyInviteLink(linkToShare)">复制</ActionButton></div><div v-if="inviteLinks.length" class="invite-link-list"><div v-for="link in inviteLinks" :key="link.id" class="invite-link-row"><span>{{ link.revokedAt ? '已停用' : new Date(link.expiresAt) <= new Date() ? '已过期' : `使用 ${link.uses}/${link.maxUses}` }} · {{ formatDate(link.expiresAt) }}过期</span><ActionButton tone="ghost" v-if="!link.revokedAt && new Date(link.expiresAt) > new Date()" class="btn btn-ghost danger-text" type="button" :disabled="actionBusy === `link:${link.id}`" kind="danger" feedback="external" :show-error="false" :action="() => revokeInviteLink(link.id)">停用</ActionButton></div></div></section>
        <section v-if="pendingMemberInvites.length"><h3>等待接受的邀请</h3><p v-for="member in pendingMemberInvites" :key="member.userId" class="projects-form-hint">{{ member.nickname }} · 已发送邀请</p></section>
      </div>
    </Modal>

    <Modal v-if="taskEventsTitle" :open="Boolean(taskEventsTitle)" :title="`${taskEventsTitle} · 进展记录`" @close="taskEventsTitle = ''; taskEvents = []">
      <ol class="project-activity-list task-event-list"><li v-for="event in taskEvents" :key="event.id"><span class="activity-dot"></span><div><strong>{{ event.actorName }}</strong><span>{{ taskEventLabel(event) }}</span><small>{{ formatDateTime(event.createdAt) }}</small></div></li></ol>
      <p v-if="!taskEvents.length" class="projects-rail-empty">还没有进展记录。</p>
    </Modal>

    <Modal v-if="transferTargetId" :open="Boolean(transferTargetId)" title="转交项目负责人" @close="transferTargetId = ''">
      <p class="transfer-confirm-copy">转交后，你会成为管理员，仍可管理项目和成员。</p>
      <template #foot><div class="projects-form-actions"><button class="btn btn-ghost" type="button" @click="transferTargetId = ''">取消</button><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="actionBusy === 'transfer-owner'" kind="important" feedback="external" :show-error="false" :action="() => transferOwner()">确认转交</ActionButton></div></template>
    </Modal>

    <ConfirmDialog v-if="confirmAction" :open="Boolean(confirmAction)" :title="confirmCopy.title" :message="confirmCopy.message" :confirm-label="confirmCopy.confirmLabel" :tone="confirmCopy.tone" @close="confirmAction = null" @confirm="runConfirmedAction" />
  </div>
</template>

<style scoped src="./projects.css"></style>
