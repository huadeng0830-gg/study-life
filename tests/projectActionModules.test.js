/**
 * 从 ProjectsView 抽出的三个功能模块的行为守卫（T4）。
 *
 * 这三个模块（协商、计划、邀请）原来长在 1500 行视图里，靠整树挂载的集成用例间接覆盖；
 * 抽成 composable 之后可以注入假依赖直接验证：请求 payload 一字不差、校验提示一字不差、
 * 身份过期时不写回。契约测试仍守视图侧的接线，这里守搬出去的这部分行为。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'
import { useScopedProjectAction } from '../src/composables/projects/useScopedProjectAction.js'
import { useProjectAdjustments } from '../src/composables/projects/useProjectAdjustments.js'
import { useProjectPlanning } from '../src/composables/projects/useProjectPlanning.js'
import { useProjectInvites } from '../src/composables/projects/useProjectInvites.js'

const social = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/services/social.js', () => ({ socialRequest: (...args) => social.request(...args) }))

function harness() {
  const identity = { account: 'fictional-account', project: 'fictional-project' }
  const accountContext = createCollaborationContext(() => [identity.account])
  const projectContext = createCollaborationContext(() => [identity.account, identity.project])
  const project = accountContext.state({ id: identity.project, status: 'active', role: 'owner' })
  const accountUser = accountContext.state({ id: identity.account })
  const members = accountContext.state([])
  const adjustments = accountContext.state([])
  const milestones = accountContext.state([])
  const isManager = ref(true)
  const notify = vi.fn()
  const reload = vi.fn(async () => {})
  const projectRequest = vi.fn(async () => ({}))
  const busy = projectContext.state('')
  const scopedAction = useScopedProjectAction({ context: projectContext, busy, notify, describeError: (error) => error?.message || '', reload })
  const currentProjectRequest = () => projectContext.capture()
  return { identity, accountContext, projectContext, project, accountUser, members, adjustments, milestones, isManager, notify, reload, projectRequest, busy, scopedAction, currentProjectRequest }
}

const acceptedTask = { id: 'fictional-task', title: '虚构任务', assigneeId: 'fictional-account', assignmentStatus: 'accepted', dueOn: '2026-11-01' }

describe('任务协商模块（从 ProjectsView 抽出）', () => {
  it('原因没写就不发请求，报错文案与原来一致', async () => {
    const fixture = harness()
    const module = useProjectAdjustments({ ...fixture, activeMembers: ref([]), projectRequest: fixture.projectRequest, reloadProject: fixture.reload })
    module.openAdjustment(acceptedTask)
    await module.saveAdjustment()
    expect(fixture.projectRequest).not.toHaveBeenCalled()
    expect(fixture.notify).toHaveBeenCalledWith('error', '请写明申请原因。')
  })

  it('提交成功：payload 带项目/任务/类型与裁剪后的原因，关表单、提示、重载', async () => {
    const fixture = harness()
    const module = useProjectAdjustments({ ...fixture, activeMembers: ref([]), projectRequest: fixture.projectRequest, reloadProject: fixture.reload })
    module.openAdjustment(acceptedTask)
    expect(module.showAdjustmentForm.value).toBe(true)
    module.adjustmentDraft.value.reason = '  需要延期  '
    module.adjustmentDraft.value.dueOn = '2026-11-20'
    await module.saveAdjustment()
    expect(fixture.projectRequest).toHaveBeenCalledWith('adjustment_create', expect.objectContaining({
      projectId: 'fictional-project', taskId: 'fictional-task', type: 'deadline_extension', reason: '需要延期', data: { dueOn: '2026-11-20' },
    }))
    expect(module.showAdjustmentForm.value).toBe(false)
    expect(fixture.notify).toHaveBeenCalledWith('success', '调整申请已提交，原任务约定暂时保持不变。')
    expect(fixture.reload).toHaveBeenCalledOnce()
  })

  it('通过/退回与撤回沿用可判定性：只有待处理且不是自己发起的申请才出现决定按钮', async () => {
    const fixture = harness()
    const module = useProjectAdjustments({ ...fixture, activeMembers: ref([]), projectRequest: fixture.projectRequest, reloadProject: fixture.reload })
    expect(module.canRespondAdjustment({ status: 'pending', requesterId: 'fictional-other' })).toBe(true)
    expect(module.canRespondAdjustment({ status: 'pending', requesterId: 'fictional-account' })).toBe(false)
    expect(module.canRespondAdjustment({ status: 'approved', requesterId: 'fictional-other' })).toBe(false)
    fixture.adjustments.value = [{ taskId: acceptedTask.id, requesterId: 'fictional-account', status: 'pending' }]
    expect(module.canAddAdjustment(acceptedTask), '已有待处理申请时不再允许重复发起').toBe(false)
    fixture.adjustments.value = []
    expect(module.canAddAdjustment(acceptedTask)).toBe(true)
    await module.decideAdjustment({ id: 'fictional-request' }, 'approve')
    expect(fixture.projectRequest).toHaveBeenCalledWith('adjustment_decide', { projectId: 'fictional-project', requestId: 'fictional-request', decision: 'approve', decisionNote: '' })
    expect(fixture.notify).toHaveBeenCalledWith('success', '申请已通过，任务调整已生效。')
  })
})

describe('计划模块（里程碑与交付检查项定义）', () => {
  it('里程碑：空标题不发请求；新建/更新分别走 create/update 并带版本号', async () => {
    const fixture = harness()
    const module = useProjectPlanning({ ...fixture, projectRequest: fixture.projectRequest })
    module.openMilestoneForm()
    await module.saveMilestone()
    expect(fixture.projectRequest).not.toHaveBeenCalled()

    module.milestoneDraft.value.title = '  方案评审 '
    await module.saveMilestone()
    expect(fixture.projectRequest).toHaveBeenCalledWith('milestone_create', expect.objectContaining({ projectId: 'fictional-project', title: '方案评审' }))
    expect(fixture.notify).toHaveBeenLastCalledWith('success', '里程碑已添加。')
    expect(module.showMilestoneForm.value).toBe(false)

    module.openMilestoneForm({ id: 'fictional-milestone', title: '方案评审', description: '', dueOn: '', revision: 4 })
    await module.saveMilestone()
    expect(fixture.projectRequest).toHaveBeenLastCalledWith('milestone_update', expect.objectContaining({ milestoneId: 'fictional-milestone', expectedRevision: 4 }))
    expect(fixture.notify).toHaveBeenLastCalledWith('success', '里程碑已更新。')
  })

  it('交付检查项：空标题不发请求；成功后关表单并提示', async () => {
    const fixture = harness()
    const module = useProjectPlanning({ ...fixture, projectRequest: fixture.projectRequest })
    module.openDeliveryCheckForm()
    await module.saveDeliveryCheckItem()
    expect(fixture.projectRequest).not.toHaveBeenCalled()
    module.deliveryCheckDraft.value.title = '确认最终报告包含实验数据'
    await module.saveDeliveryCheckItem()
    expect(fixture.projectRequest).toHaveBeenCalledWith('delivery_check_create', expect.objectContaining({ projectId: 'fictional-project', title: '确认最终报告包含实验数据' }))
    expect(module.showDeliveryCheckForm.value).toBe(false)
    expect(fixture.notify).toHaveBeenCalledWith('success', '交付检查项已添加。')
  })
})

describe('邀请模块', () => {
  it('没选好友就不发请求', async () => {
    const fixture = harness()
    const module = useProjectInvites({ ...fixture, projectRequest: fixture.projectRequest, notify: fixture.notify, describeError: (error) => error?.message || '' })
    await module.inviteFriend()
    expect(fixture.projectRequest).not.toHaveBeenCalled()
    expect(fixture.notify).toHaveBeenCalledWith('error', '请选择一位好友。')
  })

  it('选了好友就发邀请，成功后清空选择', async () => {
    const fixture = harness()
    const module = useProjectInvites({ ...fixture, projectRequest: fixture.projectRequest, notify: fixture.notify, describeError: (error) => error?.message || '' })
    module.selectedFriendId.value = 'fictional-friend'
    await module.inviteFriend()
    expect(fixture.projectRequest).toHaveBeenCalledWith('invite_member', { projectId: 'fictional-project', targetId: 'fictional-friend' })
    expect(module.selectedFriendId.value).toBe('')
    expect(fixture.notify).toHaveBeenCalledWith('success', '邀请已发送，对方可在齐行中接受或拒绝。')
  })

  it('好友列表排除已经在项目里的账号，换账号后旧响应不写回', async () => {
    const fixture = harness()
    const module = useProjectInvites({ ...fixture, projectRequest: fixture.projectRequest, notify: fixture.notify, describeError: (error) => error?.message || '' })
    fixture.members.value = [{ userId: 'fictional-in-project', status: 'active' }]
    social.request.mockResolvedValue({ friends: [{ profile: { userId: 'fictional-in-project' } }, { profile: { userId: 'fictional-friend' } }, { profile: null }] })
    await module.loadFriends()
    expect(module.friends.value.map((item) => item.profile.userId)).toEqual(['fictional-friend'])

    let release
    social.request.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = module.loadFriends()
    fixture.identity.account = 'fictional-replacement'
    fixture.accountContext.invalidate()
    fixture.projectContext.invalidate()
    release({ friends: [{ profile: { userId: 'fictional-late' } }] })
    await pending
    // invalidate 会把列表复位成空；关键是旧响应不许再把它填成 fictional-late。
    expect(module.friends.value, '换账号后的旧好友列表不许写回').toEqual([])
  })
})