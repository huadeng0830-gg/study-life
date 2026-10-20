import { socialRequest } from '../../services/social.js'
import { newProjectId } from '../../services/projects.js'

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

/**
 * 齐行项目页的「邀请成员 / 受控邀请链接」一整套状态与动作。
 *
 * 它只负责邀请相关的 ref 与请求；身份判定沿用视图传进来的两条守卫：
 *   - 好友列表用 currentProjectRequest('friends')（项目 + 账号，按频道去重）；
 *   - 邀请/建链/停链走 scopedAction（忙态租约 + 身份守卫 + 过期响应丢弃）。
 * 状态仍由各自的 collaborationContext 创建，所以切账号/切项目时的复位语义与抽取前一致。
 */
export function useProjectInvites({ accountContext, projectContext, scopedAction, project, members, projectRequest, currentProjectRequest, notify, describeError }) {
  const showInviteForm = accountContext.state(false)
  const selectedFriendId = accountContext.state('')
  const friends = accountContext.state([])
  const inviteLinks = accountContext.state([])
  const linkToShare = accountContext.state('')
  const friendsLoading = projectContext.state(false)
  const linkBusy = accountContext.state(false)

  /** 好友列表：排除已经在这个项目里的账号（含已邀请未接受）。 */
  function loadFriends() {
    return projectContext.run(async (isCurrent) => {
      const result = await socialRequest('friends_list')
      if (!isCurrent()) return
      friends.value = (result.friends || []).filter((item) => item.profile?.userId && !members.value.some((member) => member.userId === item.profile.userId && member.status !== 'left'))
    }, { busy: friendsLoading, current: currentProjectRequest('friends') })
  }

  async function loadInviteLinks() {
    const isCurrent = currentProjectRequest()
    try {
      const result = await projectRequest('invites', { projectId: project.value.id })
      if (!isCurrent()) return
      inviteLinks.value = result.links || []
    } catch (error) { if (isCurrent()) notify('error', describeError(error)) }
  }

  function inviteFriend() {
    return scopedAction.run({
      busyValue: 'invite-friend',
      check: () => {
        if (!selectedFriendId.value) return '请选择一位好友。'
        return true
      },
      operation: () => projectRequest('invite_member', { projectId: project.value.id, targetId: selectedFriendId.value }),
      commit: () => { selectedFriendId.value = '' },
      success: '邀请已发送，对方可在齐行中接受或拒绝。',
    })
  }

  function createInviteLink() {
    const token = makeInviteToken()
    const id = newProjectId()
    return scopedAction.run({
      busy: linkBusy,
      check: () => {
        if (!token || !id) return '当前环境无法生成安全邀请链接。'
        return true
      },
      operation: () => projectRequest('invite_link_create', {
        id, projectId: project.value.id, token, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), maxUses: 5,
      }),
      commit: async () => {
        linkToShare.value = inviteUrl(token)
        await loadInviteLinks()
        try { await navigator.clipboard.writeText(linkToShare.value); notify('success', '邀请链接已创建并复制，可加入 5 人，7 天后过期。') }
        catch { notify('success', '邀请链接已创建，请复制下方链接分享。') }
      },
      reload: false,
    })
  }

  async function copyInviteLink(url) {
    try { await navigator.clipboard.writeText(url); notify('success', '邀请链接已复制。') }
    catch { notify('error', '无法访问剪贴板，请长按链接手动复制。') }
  }

  function revokeInviteLink(linkId) {
    return scopedAction.run({
      busyValue: `link:${linkId}`,
      operation: () => projectRequest('invite_link_revoke', { projectId: project.value.id, linkId }),
      success: '邀请链接已停用。',
      reload: () => loadInviteLinks(),
    })
  }

  return {
    showInviteForm, selectedFriendId, friends, inviteLinks, linkToShare, friendsLoading, linkBusy,
    loadFriends, loadInviteLinks, inviteFriend, createInviteLink, copyInviteLink, revokeInviteLink,
  }
}