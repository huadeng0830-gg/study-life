<script setup>
import ActionButton from '../components/ActionButton.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { formatDateTime } from '../composables/intlFormatters.js'
import { announce as announceLive, announceAlert } from '../composables/liveRegion.js'
import { dateInZone, wallTimeToEpoch, zonedParts } from '../composables/zonedTime.js'
import { ensureSocialScheduleReady, socialRequest, subscribeSocialNotifications } from '../services/social.js'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const tabs = [
  { id: 'time', label: '找共同时间' },
  { id: 'invitations', label: '邀约与通知' },
  { id: 'friends', label: '好友' },
]
const activityLabels = { meal: '一起吃饭', movie: '看电影', sports: '运动', outing: '逛逛', custom: '自定义' }
const statusLabels = {
  pending: '等待回应', change_proposed: '好友提出了改约', confirmed: '已确认',
  declined: '已拒绝', cancelled: '已取消', expired: '已过期',
}
const notificationLabels = {
  friend_request: '向你发送了好友请求', friend_accepted: '接受了你的好友请求', friend_removed: '已将你从好友中移除',
  invitation: '发来一条新邀约', invitation_updated: '更新了邀约', invitation_cancelled: '取消了一条邀约', invitation_expired: '一条邀约已过期',
}
const timeZones = ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/Los_Angeles', 'America/New_York']
const durationChoices = [90, 120, 180]

const activeTab = ref('time')
const pageLoading = ref(false)
const pageError = ref('')
const notice = ref(null)
const profile = ref(null)
const profileEditorOpen = ref(false)
const friendRemovalTarget = ref(null)
const invitationCancellationTarget = ref(null)
const profileLoading = ref(false)
const profileSaving = ref(false)
const profileDraft = ref(blankProfile())
const friendLoading = ref(false)
const friendsError = ref('')
const friends = ref([])
const incomingRequests = ref([])
const outgoingRequests = ref([])
const selectedFriendId = ref('')
const searchEmail = ref('')
const searchBusy = ref(false)
const searched = ref(false)
const foundProfile = ref(null)
const availabilityDays = ref(7)
const availability = ref(null)
const availabilityBusy = ref(false)
const availabilityError = ref('')
const selectedSlot = ref(null)
const composerOpen = ref(false)
const inviteBusy = ref(false)
const inviteType = ref('meal')
const inviteTitle = ref('一起吃饭')
const inviteLocation = ref('')
const inviteNote = ref('')
const inviteStartInput = ref('')
const inviteEndInput = ref('')
const invitations = ref([])
const invitationsBusy = ref(false)
const invitationsError = ref('')
const notificationItems = ref([])
const unreadCount = ref(0)
const notificationsBusy = ref(false)
const notificationsError = ref('')
const proposalInviteId = ref('')
const proposalOptions = ref([])
const proposalDays = ref(7)
const proposalMinMinutes = ref(90)
const proposalLoading = ref(false)
const actionBusy = ref('')
const timezone = computed(() => profile.value?.timezone || profileDraft.value.timezone || 'Asia/Shanghai')
const hasProfile = computed(() => Boolean(profile.value?.nickname && profile.value?.scheduleCompleteThrough && profile.value?.semesterEnd))
const selectedFriend = computed(() => friends.value.find((item) => item.profile?.userId === selectedFriendId.value)?.profile || null)
const intervals = computed(() => availability.value?.intervals || [])
const canUseSocial = computed(() => Boolean(accountUser.value?.email_confirmed_at))
const emailDiscoverabilityDisabled = computed(() => !accountUser.value?.email_confirmed_at)

let generation = 0
let stopRealtime = null
let realtimeTimer = 0

function blankProfile() {
  return {
    nickname: '', school: '', emailDiscoverable: false, timezone: 'Asia/Shanghai', scheduleCompleteThrough: '', semesterEnd: '',
    availabilityPreferences: { startTime: '09:00', endTime: '22:00', minimumMinutes: 90, classBufferMinutes: 30, includeWeekends: true },
  }
}

function announce(kind, text) {
  notice.value = text ? { kind, text } : null
  if (!text) return
  if (kind === 'error') announceAlert(text, { clearAfter: 7000 })
  else announceLive(text, { clearAfter: 5000 })
}
function applyProfile(value) {
  profile.value = value || null
  const fallback = blankProfile()
  profileDraft.value = {
    ...fallback,
    ...(value || {}),
    availabilityPreferences: { ...fallback.availabilityPreferences, ...(value?.availabilityPreferences || {}) },
  }
  profileEditorOpen.value = !value
}

function localInputFor(epoch, zone) {
  const p = zonedParts(epoch, zone)
  return `${dateInZone(epoch, zone)}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

function epochFromInput(value, edge) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value || '')
  return match ? wallTimeToEpoch(match[1], match[2], timezone.value, edge) : null
}

const inviteStartEpoch = computed(() => epochFromInput(inviteStartInput.value, 'start'))
const inviteEndEpoch = computed(() => epochFromInput(inviteEndInput.value, 'end'))
const inviteRangeValid = computed(() => Boolean(selectedSlot.value && inviteStartEpoch.value !== null && inviteEndEpoch.value !== null
  && inviteStartEpoch.value >= Date.parse(selectedSlot.value.startsAt)
  && inviteEndEpoch.value <= Date.parse(selectedSlot.value.endsAt)
  && inviteEndEpoch.value - inviteStartEpoch.value >= (profile.value?.availabilityPreferences?.minimumMinutes || 90) * 60_000))
const canSubmitInvitation = computed(() => inviteRangeValid.value && inviteTitle.value.trim().length > 0)

function formatTime(iso) {
  const time = new Date(iso)
  return formatDateTime(time, { timeZone: timezone.value, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function formatClock(iso) {
  return formatDateTime(iso, { timeZone: timezone.value, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function durationText(interval) {
  const minutes = Math.round((Date.parse(interval.endsAt) - Date.parse(interval.startsAt)) / 60_000)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours ? `${hours} 小时` : ''}${rest ? `${rest} 分钟` : ''}`
}

function dayGroupLabel(iso) {
  return formatDateTime(iso, { timeZone: timezone.value, month: 'long', day: 'numeric', weekday: 'long' })
}

const groupedIntervals = computed(() => {
  const groups = new Map()
  for (const interval of intervals.value) {
    const label = dayGroupLabel(interval.startsAt)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(interval)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
})

function resetAccountData() {
  generation++
  if (stopRealtime) stopRealtime()
  stopRealtime = null
  window.clearTimeout(realtimeTimer)
  profile.value = null
  profileDraft.value = blankProfile()
  friends.value = []
  incomingRequests.value = []
  outgoingRequests.value = []
  selectedFriendId.value = ''
  availability.value = null
  invitations.value = []
  notificationItems.value = []
  unreadCount.value = 0
  pageError.value = ''
  friendsError.value = ''
  invitationsError.value = ''
  notificationsError.value = ''
  // 这些加载标志也必须清掉：generation++ 会让在途请求的 finally 里的
  // `if (token === generation)` 判定为假，于是它不会替我们复位。少了这一步，
  // 在账号切换途中退出的那一次加载会把 busy 永久留在 true（页面上就一直显示
  // 「正在读取好友资料…」或「正在核对双方课表…」）。
  profileLoading.value = false
  pageLoading.value = false
  availabilityBusy.value = false
}

async function loadProfile(token = generation) {
  if (!accountUser.value?.id) return
  profileLoading.value = true
  try {
    const result = await socialRequest('profile_get')
    if (token !== generation) return
    applyProfile(result.profile)
    pageError.value = ''
  } catch (error) {
    if (token === generation) pageError.value = error.message
  } finally {
    if (token === generation) profileLoading.value = false
  }
}

async function loadFriends(token = generation) {
  if (!canUseSocial.value) return
  friendLoading.value = true
  friendsError.value = ''
  try {
    const result = await socialRequest('friends_list')
    if (token !== generation) return
    friends.value = result.friends || []
    incomingRequests.value = result.incoming || []
    outgoingRequests.value = result.outgoing || []
    if (!friends.value.some((item) => item.profile?.userId === selectedFriendId.value)) {
      selectedFriendId.value = friends.value[0]?.profile?.userId || ''
    }
  } catch (error) {
    if (token === generation) friendsError.value = error.message
  } finally {
    if (token === generation) friendLoading.value = false
  }
}

async function loadInvitations(token = generation) {
  if (!canUseSocial.value) return
  invitationsBusy.value = true
  invitationsError.value = ''
  try {
    const result = await socialRequest('invitations_list')
    if (token === generation) invitations.value = result.invitations || []
  } catch (error) {
    if (token === generation) invitationsError.value = error.message
  } finally {
    if (token === generation) invitationsBusy.value = false
  }
}

async function loadNotifications(token = generation) {
  if (!canUseSocial.value) return
  notificationsBusy.value = true
  notificationsError.value = ''
  try {
    const result = await socialRequest('notifications_list')
    if (token === generation) {
      notificationItems.value = result.notifications || []
      unreadCount.value = result.unread || 0
    }
  } catch (error) {
    if (token === generation) notificationsError.value = error.message
  } finally {
    if (token === generation) notificationsBusy.value = false
  }
}

async function refreshAll(token = generation) {
  if (!canUseSocial.value) return
  await Promise.all([loadFriends(token), loadInvitations(token), loadNotifications(token)])
}

async function onAccountChanged(userId) {
  resetAccountData()
  if (!userId) return
  const token = generation
  pageLoading.value = true
  await loadProfile(token)
  if (token !== generation) return
  if (canUseSocial.value) {
    await refreshAll(token)
    try {
      stopRealtime = await subscribeSocialNotifications(userId, () => {
        window.clearTimeout(realtimeTimer)
        realtimeTimer = window.setTimeout(() => {
          if (token !== generation) return
          void loadNotifications(token)
          void loadFriends(token)
          void loadInvitations(token)
        }, 250)
      })
    } catch (error) {
      notificationsError.value = error.message || '暂时无法开启实时通知，可手动刷新。'
    }
  }
  pageLoading.value = false
}

watch(() => accountUser.value?.id || '', (userId) => { void onAccountChanged(userId) }, { immediate: true })

async function saveProfile() {
  if (profileSaving.value) return
  profileSaving.value = true
  announce('', '')
  try {
    const result = await socialRequest('profile_save', {
      nickname: profileDraft.value.nickname,
      school: profileDraft.value.school,
      emailDiscoverable: emailDiscoverabilityDisabled.value ? false : profileDraft.value.emailDiscoverable,
      timezone: profileDraft.value.timezone,
      scheduleCompleteThrough: profileDraft.value.scheduleCompleteThrough,
      semesterEnd: profileDraft.value.semesterEnd,
      availabilityPreferences: profileDraft.value.availabilityPreferences,
    })
    applyProfile(result.profile)
    announce('success', '资料和可约偏好已保存。')
    await loadFriends()
  } catch (error) {
    announce('error', error.message)
  } finally { profileSaving.value = false }
}

async function searchByEmail() {
  if (searchBusy.value || !searchEmail.value.trim()) return
  searchBusy.value = true
  searched.value = false
  foundProfile.value = null
  announce('', '')
  try {
    const result = await socialRequest('email_search', { email: searchEmail.value.trim() })
    foundProfile.value = result.profile || null
    searched.value = true
    if (!foundProfile.value) announce('info', '没有找到可添加的用户。对方可能尚未注册、未验证邮箱或关闭了邮箱发现。')
  } catch (error) { announce('error', error.message) }
  finally { searchBusy.value = false }
}

async function sendFriendRequest() {
  if (!foundProfile.value || actionBusy.value) return
  actionBusy.value = `request-${foundProfile.value.userId}`
  announce('', '')
  try {
    const result = await socialRequest('friend_request_send', { targetId: foundProfile.value.userId })
    announce('success', result.status === 'accepted' || result.status === 'already_friends'
      ? '你们已经成为好友。' : '好友请求已保存并发送，等待对方回应。')
    foundProfile.value = null
    searchEmail.value = ''
    await loadFriends()
  } catch (error) { announce('error', error.message) }
  finally { actionBusy.value = '' }
}

async function respondFriendRequest(request, decision) {
  if (actionBusy.value) return
  actionBusy.value = `friend-${request.id}`
  announce('', '')
  try {
    await socialRequest('friend_request_respond', { requestId: request.id, decision })
    announce('success', decision === 'accept' ? '已添加好友。' : decision === 'reject' ? '已拒绝请求。' : '已撤回请求。')
    await loadFriends()
    await loadNotifications()
  } catch (error) { announce('error', error.message) }
  finally { actionBusy.value = '' }
}

async function removeFriend(friend) {
  if (actionBusy.value) return
  friendRemovalTarget.value = friend
}

async function confirmRemoveFriend() {
  const friend = friendRemovalTarget.value
  friendRemovalTarget.value = null
  if (actionBusy.value || !friend) return
  actionBusy.value = `remove-${friend.userId}`
  announce('', '')
  try {
    await socialRequest('friend_remove', { friendId: friend.userId })
    announce('success', '好友已移除，共同邀约已取消。')
    await Promise.all([loadFriends(), loadInvitations(), loadNotifications()])
  } catch (error) { announce('error', error.message) }
  finally { actionBusy.value = '' }
}

async function queryAvailability(days = availabilityDays.value) {
  if (!selectedFriendId.value || availabilityBusy.value) return
  // 记住这次查询是给谁算的。请求途中切换好友时（好友列表的点击只清空 availability，
  // 不会重新发起查询），旧响应会覆盖 availability，于是**新好友的名字下面显示的是旧好友
  // 的空闲时段**；此时选时段建邀约，收件人是新好友、时间却按旧好友的算。
  // 其余加载函数都有这一层守卫（loadFriends 等用 generation、齐行 loadProject 用
  // detailLoadSequence + selectedProjectId），这里补齐。
  const friendId = selectedFriendId.value
  availabilityDays.value = days
  availabilityBusy.value = true
  availabilityError.value = ''
  availability.value = null
  selectedSlot.value = null
  composerOpen.value = false
  announce('', '')
  try {
    await ensureSocialScheduleReady()
    const result = await socialRequest('availability_query', { friendId, days })
    if (selectedFriendId.value !== friendId) return
    availability.value = result
    if (!result.known) availabilityError.value = '暂时无法确认双方在这段日期内的课表是否完整。请检查课表完整日期和同步状态。'
    else if (!result.intervals?.length) availabilityError.value = ''
  } catch (error) {
    if (selectedFriendId.value === friendId) availabilityError.value = error.message
  } finally { availabilityBusy.value = false }
}

function chooseSlot(slot) {
  selectedSlot.value = slot
  composerOpen.value = true
  inviteType.value = 'meal'
  inviteTitle.value = activityLabels.meal
  inviteLocation.value = ''
  inviteNote.value = ''
  const length = Date.parse(slot.endsAt) - Date.parse(slot.startsAt)
  const preference = profile.value?.availabilityPreferences?.minimumMinutes || 90
  const duration = durationChoices.find((item) => item >= preference && item * 60_000 <= length) || preference
  const start = Date.parse(slot.startsAt)
  const end = start + duration * 60_000
  inviteStartInput.value = localInputFor(start, timezone.value)
  inviteEndInput.value = localInputFor(end, timezone.value)
}

function chooseDuration(minutes) {
  if (!selectedSlot.value || minutes * 60_000 > Date.parse(selectedSlot.value.endsAt) - Date.parse(selectedSlot.value.startsAt)) return
  let start = inviteStartEpoch.value ?? Date.parse(selectedSlot.value.startsAt)
  const rangeEnd = Date.parse(selectedSlot.value.endsAt)
  if (start + minutes * 60_000 > rangeEnd) start = rangeEnd - minutes * 60_000
  inviteStartInput.value = localInputFor(start, timezone.value)
  inviteEndInput.value = localInputFor(start + minutes * 60_000, timezone.value)
}

watch(inviteType, (type) => {
  if (type !== 'custom') inviteTitle.value = activityLabels[type] || activityLabels.meal
  else if (inviteTitle.value === activityLabels.meal || Object.values(activityLabels).includes(inviteTitle.value)) inviteTitle.value = ''
})

async function createInvitation() {
  if (!canSubmitInvitation.value || inviteBusy.value || !selectedFriendId.value) return
  inviteBusy.value = true
  announce('', '')
  try {
    await ensureSocialScheduleReady()
    await socialRequest('invitation_create', {
      guestId: selectedFriendId.value,
      activityType: inviteType.value,
      title: inviteTitle.value.trim(),
      startsAt: new Date(inviteStartEpoch.value).toISOString(),
      endsAt: new Date(inviteEndEpoch.value).toISOString(),
      location: inviteLocation.value,
      note: inviteNote.value,
    })
    composerOpen.value = false
    selectedSlot.value = null
    activeTab.value = 'invitations'
    announce('success', '邀约已保存并发送给好友。')
    await Promise.all([loadInvitations(), loadNotifications()])
  } catch (error) { announce('error', error.message) }
  finally { inviteBusy.value = false }
}

async function runInvitationAction(invite, decision) {
  if (actionBusy.value) return
  actionBusy.value = `invite-${invite.id}-${decision}`
  announce('', '')
  try {
    if (['accept', 'accept_change', 'propose_change'].includes(decision)) await ensureSocialScheduleReady()
    const payload = { invitationId: invite.id, decision }
    if (decision === 'propose_change') {
      const option = proposalOptions.value[0]
      if (!option) throw new Error('请先加载并选择一个可用时段。')
      payload.startsAt = option.startsAt
      payload.endsAt = option.endsAt
    }
    await socialRequest('invitation_respond', payload)
    announce('success', decision === 'accept' ? '邀约已确认，并加入双方日程。'
      : decision === 'decline' ? '已回复不能参加。'
        : decision === 'propose_change' ? '改约时间已发给发起人，等待确认。'
          : decision === 'accept_change' ? '改约已确认，双方日程已更新。' : '已拒绝改约。')
    proposalInviteId.value = ''
    await Promise.all([loadInvitations(), loadNotifications()])
  } catch (error) { announce('error', error.message) }
  finally { actionBusy.value = '' }
}

function cancelInvitation(invite) {
  if (actionBusy.value) return
  invitationCancellationTarget.value = invite
}

async function confirmCancelInvitation() {
  const invite = invitationCancellationTarget.value
  invitationCancellationTarget.value = null
  if (actionBusy.value || !invite) return
  actionBusy.value = `invite-${invite.id}-cancel`
  announce('', '')
  try {
    await socialRequest('invitation_cancel', { invitationId: invite.id })
    announce('success', '邀约已取消，并从双方日程中移除。')
    await Promise.all([loadInvitations(), loadNotifications()])
  } catch (error) { announce('error', error.message) }
  finally { actionBusy.value = '' }
}

async function openProposalPicker(invite) {
  const friendId = invite.peer?.user_id
  if (!friendId) return
  if (proposalInviteId.value === invite.id) { proposalInviteId.value = ''; return }
  proposalInviteId.value = invite.id
  proposalOptions.value = []
  proposalLoading.value = true
  proposalDays.value = 7
  try {
    await ensureSocialScheduleReady()
    const result = await socialRequest('availability_query', { friendId, days: 7 })
    if (!result.known) throw new Error('双方课表范围尚不完整，暂时无法提出改约。')
    proposalMinMinutes.value = result.minimumMinutes || 90
    proposalOptions.value = (result.intervals || []).map((item) => ({ startsAt: item.startsAt, endsAt: new Date(Math.min(Date.parse(item.endsAt), Date.parse(item.startsAt) + proposalMinMinutes.value * 60_000)).toISOString() }))
  } catch (error) { announce('error', error.message) }
  finally { proposalLoading.value = false }
}

async function expandProposalDays(days) {
  const invite = invitations.value.find((item) => item.id === proposalInviteId.value)
  if (!invite?.peer?.user_id || proposalLoading.value) return
  proposalDays.value = days
  proposalLoading.value = true
  proposalOptions.value = []
  try {
    await ensureSocialScheduleReady()
    const result = await socialRequest('availability_query', { friendId: invite.peer.user_id, days })
    if (!result.known) throw new Error('双方课表范围尚不完整，暂时无法提出改约。')
    proposalMinMinutes.value = result.minimumMinutes || 90
    proposalOptions.value = (result.intervals || []).map((item) => ({ startsAt: item.startsAt, endsAt: new Date(Math.min(Date.parse(item.endsAt), Date.parse(item.startsAt) + proposalMinMinutes.value * 60_000)).toISOString() }))
  } catch (error) { announce('error', error.message) }
  finally { proposalLoading.value = false }
}

async function markNotificationsRead() {
  const ids = notificationItems.value.filter((item) => !item.read_at).map((item) => item.id)
  if (!ids.length || notificationsBusy.value) return
  notificationsBusy.value = true
  try {
    await socialRequest('notifications_mark_read', { ids })
    await loadNotifications()
  } catch (error) { notificationsError.value = error.message }
  finally { notificationsBusy.value = false }
}

async function refreshCurrentTab() {
  announce('', '')
  if (activeTab.value === 'time') {
    await loadFriends()
    if (selectedFriendId.value) await queryAvailability(availabilityDays.value)
  } else if (activeTab.value === 'invitations') await Promise.all([loadInvitations(), loadNotifications()])
  else await Promise.all([loadFriends(), loadNotifications()])
}

onBeforeUnmount(() => {
  generation++
  stopRealtime?.()
  window.clearTimeout(realtimeTimer)
})
</script>

<template>
  <div class="together-page">
    <header class="together-header">
      <div>
        <p class="eyebrow">三两事 · 好友协作</p>
        <h1>一起约</h1>
        <p class="page-intro">只分享双方都空闲的时间，不展示课程、日程或完整邮箱。</p>
      </div>
      <ActionButton tone="ghost" class="btn btn-ghost refresh-button" type="button" :disabled="pageLoading || actionBusy || availabilityBusy" kind="important" feedback="external" :show-error="false" :action="() => refreshCurrentTab()">刷新</ActionButton>
    </header>

    <div class="together-tabs" role="group" aria-label="好友协作功能">
      <button v-for="tab in tabs" :key="tab.id" type="button" :aria-pressed="activeTab === tab.id" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}<span v-if="tab.id === 'invitations' && unreadCount" class="unread-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
      </button>
    </div>

    <p v-if="notice" class="together-notice" :class="`notice-${notice.kind}`">{{ notice.text }}</p>

    <section v-if="!accountUser" class="together-card account-gate">
      <div class="gate-icon">👤</div>
      <h2>登录后开始与好友协作</h2>
      <p>登录和验证邮箱后，你可以添加好友、查找共同空闲时间并发送邀约。本机课表仍可照常使用。</p>
      <button type="button" class="btn btn-primary" @click="accountOpen = true">打开账号</button>
    </section>

    <template v-else>
      <section v-if="profileLoading || pageLoading" class="together-card loading-card" aria-live="polite">正在读取好友资料…</section>
      <section v-else-if="pageError && !profile" class="together-card state-card error-card">
        <h2>暂时无法读取好友资料</h2><p>{{ pageError }}</p><button type="button" class="btn" @click="loadProfile()">重试</button>
      </section>

      <section v-else-if="!hasProfile" class="together-card profile-setup">
        <div class="section-heading"><div><span class="eyebrow">首次设置</span><h2>先告诉好友怎么称呼你</h2></div><span class="privacy-chip">🔒 邮箱默认不被搜索</span></div>
        <p class="muted">昵称和学校仅展示给已添加的好友。请分别确认课表已录入完整的日期，以及本学期结束日。</p>
        <form class="profile-grid" @submit.prevent="saveProfile">
          <label>昵称 <input v-model="profileDraft.nickname" maxlength="32" autocomplete="nickname" required placeholder="好友看到的称呼" /></label>
          <label>学校（选填） <input v-model="profileDraft.school" maxlength="100" placeholder="可留空" /></label>
          <label>时区
            <select v-model="profileDraft.timezone"><option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option></select>
          </label>
          <label>课表已确认完整至
            <input v-model="profileDraft.scheduleCompleteThrough" type="date" required />
            <small>只有覆盖到已确认完整日期的范围才会参与匹配。</small>
          </label>
          <label>本学期结束日期
            <input v-model="profileDraft.semesterEnd" type="date" required />
            <small>结束日期之后不再按每周课表推算课程；日程和考试仍会计入占用时间。</small>
          </label>
          <fieldset class="preference-fieldset">
            <legend>可约时间偏好</legend>
            <div class="profile-grid profile-grid-inner">
              <label>每天从 <input v-model="profileDraft.availabilityPreferences.startTime" type="time" required /></label>
              <label>到 <input v-model="profileDraft.availabilityPreferences.endTime" type="time" required /></label>
              <label>最短活动时长
                <select v-model.number="profileDraft.availabilityPreferences.minimumMinutes"><option :value="90">90 分钟</option><option :value="120">2 小时</option><option :value="180">3 小时</option></select>
              </label>
              <label>课程前后缓冲
                <select v-model.number="profileDraft.availabilityPreferences.classBufferMinutes"><option :value="0">不额外缓冲</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="45">45 分钟</option><option :value="60">1 小时</option></select>
              </label>
              <label class="weekend-option"><input v-model="profileDraft.availabilityPreferences.includeWeekends" type="checkbox" /> 周末也可约</label>
            </div>
          </fieldset>
          <label class="discover-option"><input v-model="profileDraft.emailDiscoverable" type="checkbox" :disabled="emailDiscoverabilityDisabled" /> 允许好友用完整邮箱精确搜索我
            <small v-if="emailDiscoverabilityDisabled">完成邮箱验证后可以开启。完整邮箱始终不会展示给其他人。</small>
            <small v-else>默认关闭；关闭时，搜索结果不会说明账号是否存在。</small>
          </label>
          <div class="form-actions"><ActionButton tone="primary" kind="frequent" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="profileSaving" :busy="profileSaving">{{ profileSaving ? '正在保存…' : '保存资料与偏好' }}</ActionButton><span v-if="profileSaving" class="muted">正在写入账号资料…</span></div>
        </form>
      </section>

        <section v-if="profile && hasProfile" class="profile-summary">
          <div><b>{{ profile.nickname }}</b><span v-if="profile.school"> · {{ profile.school }}</span><small>课表确认至 {{ profile.scheduleCompleteThrough }} · 学期至 {{ profile.semesterEnd }} · {{ profile.timezone }}</small></div>
          <button type="button" class="text-button" aria-controls="together-profile-editor" :aria-expanded="profileEditorOpen" @click="activeTab = 'friends'; profileEditorOpen = true">资料与偏好</button>
        </section>

        <section v-if="!canUseSocial" class="together-card state-card">
          <h2>完成邮箱验证后即可开始</h2><p>邮箱验证前可以设置本人的昵称和课表范围；搜索好友、匹配时间和收发邀约需要已验证账号。</p>
          <button type="button" class="btn" @click="accountOpen = true">打开账号设置</button>
        </section>

        <section v-else-if="activeTab === 'time' && hasProfile" class="together-layout">
          <aside class="together-card friend-picker">
            <div class="section-heading"><div><span class="eyebrow">共同时间</span><h2>选择一位好友</h2></div><button type="button" class="icon-button" aria-label="刷新好友" :disabled="friendLoading" @click="loadFriends">↻</button></div>
            <p v-if="friendLoading" class="muted">正在读取好友…</p>
            <p v-else-if="friendsError" class="inline-error">{{ friendsError }} <button type="button" class="text-button" @click="loadFriends">重试</button></p>
            <div v-else-if="friends.length" class="friend-list" role="group" aria-label="好友列表">
              <button v-for="item in friends" :key="item.profile?.userId" type="button" :aria-pressed="selectedFriendId === item.profile?.userId" class="friend-choice" :class="{ selected: selectedFriendId === item.profile?.userId }" @click="selectedFriendId = item.profile.userId; availability = null; selectedSlot = null">
                <span class="avatar">{{ item.profile?.nickname?.slice(0, 1) || '友' }}</span><span class="friend-copy"><b>{{ item.profile?.nickname || '好友' }}</b><small>{{ item.profile?.school || '已添加好友' }}</small></span><span class="choice-check">{{ selectedFriendId === item.profile?.userId ? '✓' : '' }}</span>
              </button>
            </div>
            <div v-else class="empty-mini"><p>还没有好友。</p><button type="button" class="text-button" @click="activeTab = 'friends'">用邮箱添加好友</button></div>
            <p class="privacy-note">双方的课程和日程始终私密；结果只包含共同空闲区间。</p>
          </aside>

          <section class="together-card availability-panel">
            <div class="section-heading availability-heading"><div><span class="eyebrow">{{ selectedFriend ? `和 ${selectedFriend.nickname}` : '好友课表' }}</span><h2>找一段都方便的时间</h2></div>
              <label class="range-select">搜索范围 <select v-model.number="availabilityDays" :disabled="availabilityBusy"><option :value="7">未来 7 天</option><option :value="14">未来 14 天</option><option :value="30">未来 30 天</option></select></label>
            </div>
            <div class="availability-actions"><span class="muted">按日期排列，近期且满足最短活动时长的时段优先显示。</span><ActionButton tone="primary" type="button" class="btn btn-primary" :disabled="!selectedFriendId || availabilityBusy" :busy="availabilityBusy" kind="task" feedback="external" :show-error="false" :action="() => queryAvailability(availabilityDays)">{{ availabilityBusy ? '正在核对双方课表…' : '查找共同时间' }}</ActionButton></div>
            <div v-if="availabilityBusy" class="state-card loading-card" aria-live="polite">正在同步并计算共同空闲时间…</div>
            <div v-else-if="availabilityError" class="state-card error-card" role="alert"><h3>暂时没有可用结果</h3><p>{{ availabilityError }}</p><div class="state-actions"><ActionButton tone="neutral" type="button" class="btn" kind="task" feedback="external" :show-error="false" :action="() => queryAvailability(availabilityDays)">重试</ActionButton><button v-if="availability?.known" type="button" class="text-button" @click="activeTab = 'friends'; profileEditorOpen = true">调整时间偏好</button></div></div>
            <div v-else-if="availability?.known && !intervals.length" class="state-card empty-state">
              <div class="empty-symbol">☁</div><h3>这段范围内暂时没有合适的连续空闲</h3><p>可以扩大搜索范围，或调整双方每天可约时段、周末和课程缓冲偏好。</p><div class="state-actions"><ActionButton tone="primary" v-if="availabilityDays < 30" type="button" class="btn btn-primary" kind="task" feedback="external" :show-error="false" :action="() => queryAvailability(availabilityDays === 7 ? 14 : 30)">扩大到未来 {{ availabilityDays === 7 ? 14 : 30 }} 天</ActionButton><button type="button" class="btn btn-ghost" @click="activeTab = 'friends'; profileEditorOpen = true">调整时间偏好</button></div>
            </div>
            <div v-else-if="groupedIntervals.length" class="interval-groups">
              <section v-for="group in groupedIntervals" :key="group.label" class="interval-day"><h3>{{ group.label }}</h3>
                <article v-for="slot in group.items" :key="slot.startsAt" class="interval-card" :class="{ chosen: selectedSlot?.startsAt === slot.startsAt }">
                  <div class="interval-main"><b>{{ formatClock(slot.startsAt) }} – {{ formatClock(slot.endsAt) }}</b><span>{{ durationText(slot) }} 连续空闲</span></div>
                  <button type="button" class="btn btn-ghost" @click="chooseSlot(slot)">{{ selectedSlot?.startsAt === slot.startsAt ? '正在编辑邀约' : '选择这个时段' }}</button>
                </article>
              </section>
            </div>
            <p v-else class="empty-mini">选择好友后查找共同时间。首次查找会先把本机课表同步到账号。</p>

            <form v-if="composerOpen && selectedSlot" class="invite-composer" @submit.prevent="createInvitation">
              <div class="section-heading"><div><span class="eyebrow">邀约给 {{ selectedFriend?.nickname }}</span><h3>设置具体时间</h3></div><button type="button" class="text-button" @click="composerOpen = false">收起</button></div>
              <div class="duration-picks" aria-label="快捷活动时长">
                <button v-for="minutes in durationChoices" :key="minutes" type="button" class="duration-chip" :disabled="minutes * 60_000 > Date.parse(selectedSlot.endsAt) - Date.parse(selectedSlot.startsAt)" @click="chooseDuration(minutes)">{{ minutes === 90 ? '90 分钟' : `${minutes / 60} 小时` }}</button>
              </div>
              <div class="profile-grid invite-time-grid"><label>开始 <input v-model="inviteStartInput" type="datetime-local" required :min="localInputFor(Date.parse(selectedSlot.startsAt), timezone)" :max="localInputFor(Date.parse(selectedSlot.endsAt), timezone)" /></label><label>结束 <input v-model="inviteEndInput" type="datetime-local" required :min="inviteStartInput" :max="localInputFor(Date.parse(selectedSlot.endsAt), timezone)" /></label></div>
              <p class="muted">时间不能超出共同空闲区间。确认时会再次检查双方的课表版本与冲突。</p>
              <div class="profile-grid invite-details-grid"><label>活动
                <select v-model="inviteType"><option value="meal">一起吃饭</option><option value="movie">看电影</option><option value="sports">运动</option><option value="outing">逛逛</option><option value="custom">自定义</option></select>
              </label><label>标题 <input v-model="inviteTitle" maxlength="80" required :placeholder="activityLabels[inviteType]" /></label><label>地点（选填） <input v-model="inviteLocation" maxlength="160" placeholder="例如：学校附近" /></label><label>备注（选填） <input v-model="inviteNote" maxlength="500" placeholder="补充说明" /></label></div>
              <div v-if="selectedSlot && !inviteRangeValid" class="inline-error">请将邀约时间设在双方空闲范围内，时长至少 {{ profile?.availabilityPreferences?.minimumMinutes || 90 }} 分钟。</div>
              <div class="form-actions"><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="!canSubmitInvitation || inviteBusy" :busy="inviteBusy">{{ inviteBusy ? '正在核对并发送…' : '确认并发送邀约' }}</ActionButton><span class="muted">失败时不会显示已发送，也不会留下未保存的邀约。</span></div>
            </form>
          </section>
        </section>

        <section v-else-if="activeTab === 'friends' && hasProfile" class="friends-page">
          <section class="together-card search-card">
            <div class="section-heading"><div><span class="eyebrow">精确查找</span><h2>用邮箱添加好友</h2></div><span class="privacy-chip">不展示完整邮箱</span></div>
            <p class="muted">只有对方主动开启邮箱发现且完成邮箱验证时，才会显示昵称。搜索不到时无法判断具体原因。</p>
            <form class="email-search-form" @submit.prevent="searchByEmail"><label class="sr-only" for="friend-email">好友完整邮箱</label><input id="friend-email" v-model="searchEmail" type="email" maxlength="254" autocomplete="off" required placeholder="输入完整邮箱地址" /><ActionButton tone="primary" kind="important" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="searchBusy || !searchEmail.trim()" :busy="searchBusy">{{ searchBusy ? '正在精确查找…' : '搜索' }}</ActionButton></form>
            <div v-if="searchBusy" class="inline-loading">正在查找…</div>
            <article v-else-if="searched && foundProfile" class="search-result"><span class="avatar">{{ foundProfile.nickname?.slice(0, 1) || '友' }}</span><div><b>{{ foundProfile.nickname }}</b><small>{{ foundProfile.school || '未填写学校' }}</small></div><ActionButton tone="neutral" class="btn" type="button" :disabled="actionBusy === `request-${foundProfile.userId}`" :busy="actionBusy === `request-${foundProfile.userId}`" kind="important" feedback="external" :show-error="false" :action="() => sendFriendRequest()">{{ actionBusy === `request-${foundProfile.userId}` ? '正在发送…' : '发送好友请求' }}</ActionButton></article>
            <p v-else-if="searched" class="muted search-generic-hint">没有找到可添加的用户。对方可能尚未注册、未验证邮箱或关闭了邮箱发现。</p>
          </section>

          <section class="together-card request-card">
            <div class="section-heading"><div><span class="eyebrow">好友关系</span><h2>请求与好友</h2></div><button type="button" class="icon-button" aria-label="刷新好友与请求" :disabled="friendLoading" @click="loadFriends">↻</button></div>
            <p v-if="friendLoading" class="muted">正在读取好友和请求…</p>
            <p v-else-if="friendsError" class="inline-error">{{ friendsError }} <button type="button" class="text-button" @click="loadFriends">重试</button></p>
            <template v-else>
              <h3 class="subsection-title">收到的请求 <span>{{ incomingRequests.length }}</span></h3>
              <div v-if="incomingRequests.length" class="request-list"><article v-for="request in incomingRequests" :key="request.id" class="request-row"><div class="avatar">{{ request.profile?.nickname?.slice(0, 1) || '友' }}</div><div class="friend-copy"><b>{{ request.profile?.nickname || '三两事用户' }}</b><small>{{ request.profile?.school || '好友请求' }}</small></div><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="actionBusy === `friend-${request.id}`" :busy="actionBusy === `friend-${request.id}`" kind="important" feedback="external" :show-error="false" :action="() => respondFriendRequest(request, 'accept')">{{ actionBusy === `friend-${request.id}` ? '处理中…' : '接受' }}</ActionButton><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="Boolean(actionBusy)" kind="important" feedback="external" :show-error="false" :action="() => respondFriendRequest(request, 'reject')">拒绝</ActionButton></article></div>
              <p v-else class="muted empty-copy">暂时没有新的好友请求。</p>
              <h3 class="subsection-title">已发送 <span>{{ outgoingRequests.length }}</span></h3>
              <div v-if="outgoingRequests.length" class="request-list"><article v-for="request in outgoingRequests" :key="request.id" class="request-row"><div class="avatar">{{ request.profile?.nickname?.slice(0, 1) || '友' }}</div><div class="friend-copy"><b>{{ request.profile?.nickname || '三两事用户' }}</b><small>等待对方回应</small></div><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="Boolean(actionBusy)" kind="important" feedback="external" :show-error="false" :action="() => respondFriendRequest(request, 'withdraw')">撤回</ActionButton></article></div>
              <h3 class="subsection-title">我的好友 <span>{{ friends.length }}</span></h3>
              <div v-if="friends.length" class="request-list"><article v-for="item in friends" :key="item.profile?.userId" class="request-row"><div class="avatar">{{ item.profile?.nickname?.slice(0, 1) || '友' }}</div><div class="friend-copy"><b>{{ item.profile?.nickname }}</b><small>{{ item.profile?.school || '已添加好友' }}</small></div><button class="text-button" type="button" @click="selectedFriendId = item.profile.userId; activeTab = 'time'">找时间</button><button class="text-button danger-text" type="button" :disabled="Boolean(actionBusy)" @click="removeFriend(item.profile)">{{ actionBusy === `remove-${item.profile?.userId}` ? '处理中…' : '移除' }}</button></article></div>
              <p v-else class="muted empty-copy">添加好友后，就能查找双方都方便的时间。</p>
            </template>
          </section>

          <section class="together-card profile-preferences-card">
            <div class="section-heading"><div><span class="eyebrow">隐私设置</span><h2>我的资料与可约偏好</h2></div><button type="button" class="text-button" aria-controls="together-profile-editor" :aria-expanded="profileEditorOpen" @click="profileEditorOpen = !profileEditorOpen">{{ profileEditorOpen ? '收起' : '修改' }}</button></div>
            <p class="muted">邮箱发现默认关闭。公开主页和完整邮箱展示均不提供；昵称、选填学校和共同可约时间只用于好友协作。</p>
            <form v-if="profileEditorOpen" id="together-profile-editor" class="profile-grid" @submit.prevent="saveProfile">
              <label>昵称 <input v-model="profileDraft.nickname" maxlength="32" required /></label><label>学校（选填） <input v-model="profileDraft.school" maxlength="100" /></label>
              <label>时区 <select v-model="profileDraft.timezone"><option v-for="zone in timeZones" :key="zone" :value="zone">{{ zone }}</option></select></label>
              <label>课表确认完整至 <input v-model="profileDraft.scheduleCompleteThrough" type="date" required /></label>
              <label>本学期结束日期 <input v-model="profileDraft.semesterEnd" type="date" required /></label>
              <label>每天开始 <input v-model="profileDraft.availabilityPreferences.startTime" type="time" required /></label><label>每天结束 <input v-model="profileDraft.availabilityPreferences.endTime" type="time" required /></label>
              <label>最短活动时长 <select v-model.number="profileDraft.availabilityPreferences.minimumMinutes"><option :value="90">90 分钟</option><option :value="120">2 小时</option><option :value="180">3 小时</option></select></label>
              <label>课程缓冲 <select v-model.number="profileDraft.availabilityPreferences.classBufferMinutes"><option :value="0">0 分钟</option><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="45">45 分钟</option><option :value="60">60 分钟</option></select></label>
              <label class="weekend-option"><input v-model="profileDraft.availabilityPreferences.includeWeekends" type="checkbox" /> 周末也可约</label>
              <label class="discover-option"><input v-model="profileDraft.emailDiscoverable" type="checkbox" :disabled="emailDiscoverabilityDisabled" /> 允许使用完整邮箱精确搜索我<small>不会公开邮箱；关闭时不会泄露账号是否存在。</small></label>
              <div class="form-actions"><ActionButton tone="primary" kind="frequent" feedback="external" :show-error="false" class="btn btn-primary" type="submit" :disabled="profileSaving" :busy="profileSaving">{{ profileSaving ? '正在保存…' : '保存设置' }}</ActionButton></div>
            </form>
          </section>
        </section>

        <section v-else-if="activeTab === 'invitations' && hasProfile" class="invitation-page">
          <div class="invitation-toolbar"><div><span class="eyebrow">实时通知</span><p class="muted">好友请求与邀约变化会即时显示。即将开始的已确认邀约会在这里提醒。</p></div><ActionButton tone="ghost" type="button" class="btn btn-ghost" :disabled="notificationsBusy || unreadCount === 0" :busy="notificationsBusy" kind="frequent" feedback="external" :show-error="false" :action="() => markNotificationsRead()">{{ notificationsBusy ? '正在更新…' : `全部标为已读${unreadCount ? `（${unreadCount}）` : ''}` }}</ActionButton></div>
          <section class="together-card notification-card"><div class="section-heading"><div><span class="eyebrow">消息</span><h2>通知</h2></div><button type="button" class="icon-button" aria-label="刷新通知" :disabled="notificationsBusy" @click="loadNotifications">↻</button></div>
            <p v-if="notificationsBusy" class="muted">正在读取通知…</p><p v-else-if="notificationsError" class="inline-error">{{ notificationsError }} <button type="button" class="text-button" @click="loadNotifications">重试</button></p>
            <div v-else-if="notificationItems.length" class="notification-list"><article v-for="item in notificationItems" :key="item.id" class="notification-row" :class="{ unread: !item.read_at }"><span class="notification-dot"></span><div><b>{{ item.actor?.nickname || '三两事好友' }}</b><span>{{ notificationLabels[item.kind] || '有一条新通知' }}</span><small>{{ formatTime(item.created_at) }}</small></div></article></div>
            <p v-else class="muted empty-copy">还没有通知。</p>
          </section>
          <section class="together-card invitation-list-card"><div class="section-heading"><div><span class="eyebrow">共同日程</span><h2>邀约</h2></div><button type="button" class="icon-button" aria-label="刷新邀约" :disabled="invitationsBusy" @click="loadInvitations">↻</button></div>
            <p v-if="invitationsBusy" class="muted">正在读取邀约…</p><p v-else-if="invitationsError" class="inline-error">{{ invitationsError }} <button type="button" class="text-button" @click="loadInvitations">重试</button></p>
            <div v-else-if="invitations.length" class="invitation-list">
              <article v-for="invite in invitations" :key="invite.id" class="invitation-row" :class="`invite-${invite.status}`">
                <div class="invite-topline"><span class="invite-kind">{{ activityLabels[invite.activity_type] || '好友邀约' }}</span><span class="invite-status">{{ statusLabels[invite.status] || invite.status }}</span></div>
                <h3>{{ invite.title }}</h3><p class="invite-time">{{ formatTime(invite.starts_at) }} – {{ formatClock(invite.ends_at) }}</p>
                <p v-if="invite.location" class="muted">地点：{{ invite.location }}</p><p v-if="invite.note" class="muted">备注：{{ invite.note }}</p>
                <p class="muted">{{ invite.self?.role === 'host' ? '你发给' : '来自' }} {{ invite.peer?.profile?.nickname || '好友' }}</p>
                <div v-if="invite.peer?.proposed_starts_at && invite.status === 'change_proposed'" class="proposal-preview"><b>建议时间</b><span>{{ formatTime(invite.peer.proposed_starts_at) }} – {{ formatTime(invite.peer.proposed_ends_at) }}</span></div>
                <div class="invite-actions">
                  <template v-if="invite.status === 'pending' && invite.self?.role === 'guest'"><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="Boolean(actionBusy)" :busy="actionBusy === `invite-${invite.id}-accept`" kind="important" feedback="external" :show-error="false" :action="() => runInvitationAction(invite, 'accept')">{{ actionBusy === `invite-${invite.id}-accept` ? '正在复核…' : '接受邀约' }}</ActionButton><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="Boolean(actionBusy)" kind="important" feedback="external" :show-error="false" :action="() => runInvitationAction(invite, 'decline')">不能参加</ActionButton><button class="text-button" type="button" :disabled="proposalLoading" @click="openProposalPicker(invite)">{{ proposalInviteId === invite.id ? '收起改约' : '提出一个改约' }}</button></template>
                  <template v-if="invite.status === 'change_proposed' && invite.self?.role === 'host'"><ActionButton tone="primary" class="btn btn-primary" type="button" :disabled="Boolean(actionBusy)" kind="important" feedback="external" :show-error="false" :action="() => runInvitationAction(invite, 'accept_change')">接受改约</ActionButton><ActionButton tone="ghost" class="btn btn-ghost" type="button" :disabled="Boolean(actionBusy)" kind="important" feedback="external" :show-error="false" :action="() => runInvitationAction(invite, 'reject_change')">拒绝改约</ActionButton></template>
                  <template v-if="['pending', 'change_proposed', 'confirmed'].includes(invite.status)"><button class="text-button danger-text" type="button" :disabled="Boolean(actionBusy)" @click="cancelInvitation(invite)">取消邀约</button></template>
                  <span v-if="invite.status === 'confirmed'" class="confirmed-note">✓ 已确认，已加入双方日程</span>
                </div>
                <div v-if="proposalInviteId === invite.id" class="proposal-picker">
                  <p class="muted">选择一个足够长的未来共同空闲时段（至少 {{ proposalMinMinutes }} 分钟）；发起人接受后才会更新双方日程。</p>
                  <p v-if="proposalLoading" class="muted">正在核对可改约时间…</p><p v-else-if="!proposalOptions.length" class="muted">这个范围内没有可用的改约时间。</p>
                  <div v-else class="proposal-options"><button v-for="option in proposalOptions.slice(0, 6)" :key="option.startsAt" type="button" class="proposal-option" :disabled="Boolean(actionBusy)" @click="proposalOptions = [option]; runInvitationAction(invite, 'propose_change')">{{ formatTime(option.startsAt) }} – {{ formatClock(option.endsAt) }} · {{ proposalMinMinutes }} 分钟</button></div>
                  <button v-if="proposalDays < 30 && !proposalLoading" type="button" class="text-button" @click="expandProposalDays(proposalDays === 7 ? 14 : 30)">扩大到未来 {{ proposalDays === 7 ? 14 : 30 }} 天</button>
                </div>
              </article>
            </div>
            <div v-else class="empty-state"><div class="empty-symbol">✉</div><h3>还没有邀约</h3><p>在“找共同时间”里选中一段空闲，就能向好友发送邀约。</p><button class="btn btn-primary" type="button" @click="activeTab = 'time'">查找共同时间</button></div>
          </section>
        </section>
    </template>
    <ConfirmDialog
      v-if="friendRemovalTarget"
      :open="Boolean(friendRemovalTarget)"
      title="移除好友"
      :message="`确定移除好友“${friendRemovalTarget?.nickname || '好友'}”吗？共同邀约也会取消。`"
      confirm-label="移除好友"
      @close="friendRemovalTarget = null"
      @confirm="confirmRemoveFriend"
    />
    <ConfirmDialog
      v-if="invitationCancellationTarget"
      :open="Boolean(invitationCancellationTarget)"
      title="取消邀约"
      message="确定取消这条邀约吗？取消后会从双方日程中移除。"
      confirm-label="取消邀约"
      @close="invitationCancellationTarget = null"
      @confirm="confirmCancelInvitation"
    />
  </div>
</template>

<style scoped src="./together.css"></style>
