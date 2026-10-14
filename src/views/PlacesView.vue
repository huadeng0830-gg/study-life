<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { PLACE_CATEGORIES, PLACE_SCORE_FIELDS, PLACE_VALUE_OPTIONS, createPlaceId, toPlaceInvitePayload, toSchoolPlacePayload } from '../composables/placeModels.js'
import {
  addPlaceVisit, createPlaceOffer, createPlaceWithVisit, deletePlaceLocally, deletePlaceOffer, importPlacePreset,
  markPlaceOfferRedeemed, placeOffers, places, removePlaceVisit, rollbackPlaceOfferRedemption, setPlaceArchived,
  updatePlace, visitsForPlace,
} from '../composables/placeBook.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { flushStoredWrites } from '../composables/store/index.js'
import { appToday } from '../composables/timeContext.js'
import {
  acceptCampusPlaceInvite, cancelCampusPlaceInvite, completeCampusPlaceInvite, deleteCampusPlace,
  deleteCampusPlaceRating, listCampusPlaceInvites, listCampusPlaces, publishCampusPlace, rejectCampusPlaceInvite,
  reportCampusPlace, saveCampusPlaceRating, sendCampusPlaceInvite, socialRequest,
} from '../services/social.js'

const domain = useDomainCommands()
const section = ref('mine')
const message = ref('')
const showPlaceForm = ref(false)
const showVisitForm = ref(false)
const visitTarget = ref(null)
const sharedPlaces = ref([])
const sharedLoaded = ref(false)
const sharedLoading = ref(false)
const placeInviteFriends = ref([])
const incomingPlaceInvites = ref([])
const outgoingPlaceInvites = ref([])
const placeInvitesLoaded = ref(false)
const placeInvitesLoading = ref(false)
const selectedInviteFriendId = ref('')
const selectedInvitePlaceIds = ref([])
const inviteConsent = ref(false)
const reportTarget = ref(null)
const reportReason = ref('inaccurate')
const reportDetail = ref('')
const offerPlaceId = ref('')
const offerFormOpen = ref(false)
const busyAction = ref('')

const blankPlace = () => ({ name: '', campus: '', area: '', placeHint: '', category: 'food', scores: { value: 'mixed' }, note: '', visitedAt: appToday.value, price: '', transactionId: '' })
const blankVisit = () => ({ visitedAt: appToday.value, price: '', scores: { value: 'mixed' }, note: '', transactionId: '' })
const placeForm = reactive(blankPlace())
const visitForm = reactive(blankVisit())
const offerForm = reactive({ title: '', note: '', price: '', originalPrice: '', expiresAt: '' })

function handlePlaceEscape(event) {
  if (event.key !== 'Escape') return
  if (showVisitForm.value) showVisitForm.value = false
  else if (reportTarget.value) reportTarget.value = null
}
onMounted(() => window.addEventListener('keydown', handlePlaceEscape))
onUnmounted(() => window.removeEventListener('keydown', handlePlaceEscape))

const activePlaces = computed(() => places.value.filter((place) => !place.archivedAt)
  .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))))
const archivedPlaces = computed(() => places.value.filter((place) => place.archivedAt))
const eligibleTransactions = computed(() => domain.transactions.value
  .filter((item) => item.direction !== 'income' && !item.placeId && !item.archivedAt && !item.deletedAt && !item.tombstone)
  .slice().sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))))
const scoreFields = computed(() => PLACE_SCORE_FIELDS[placeForm.category] || [])
const visitScoreFields = computed(() => PLACE_SCORE_FIELDS[visitTarget.value?.category] || [])
const transactionNameById = computed(() => new Map(domain.transactions.value.map((item) => [String(item.id), item.name || '收支记录'])))
const sharedPlaceById = computed(() => new Map(sharedPlaces.value.map((place) => [String(place.id), place])))
const visibleOffers = computed(() => placeOffers.value.filter((offer) => offer.status === 'active'
  && places.value.some((place) => place.id === offer.placeId && !place.archivedAt)))
const scoredPlacesForInvite = computed(() => activePlaces.value.filter((place) => visitsForPlace(place.id).length
  && (Object.keys(place.scores || {}).some((key) => key !== 'value') || place.scores?.value !== 'mixed')))
const selectedInvitePlaces = computed(() => selectedInvitePlaceIds.value
  .map((id) => scoredPlacesForInvite.value.find((place) => String(place.id) === String(id))).filter(Boolean))

function resetPlaceForm() {
  Object.assign(placeForm, blankPlace())
}
function resetVisitForm() {
  Object.assign(visitForm, blankVisit())
}
function setCategory(category) {
  placeForm.category = category
  placeForm.scores = { value: 'mixed' }
}
function setVisitScore(field, value) {
  visitForm.scores[field] = value
}
function scoreSummary(scores = {}, category = 'food') {
  const valueLabel = PLACE_VALUE_OPTIONS.find((item) => item.value === scores.value)?.label || '未记录'
  const parts = Object.entries(scores).filter(([key]) => key !== 'value').map(([key, value]) => {
    const descriptor = (PLACE_SCORE_FIELDS[category] || []).find((field) => field.key === key)
    const selected = descriptor?.options?.find((option) => option.value === value)?.label
    return `${descriptor?.label || key} ${selected || (typeof value === 'boolean' ? value ? '有' : '无' : value)}`
  })
  return [`值不值：${valueLabel}`, ...parts].join(' · ')
}
function avgSpend(placeId) {
  const rows = visitsForPlace(placeId).filter((item) => Number.isFinite(item.price))
  if (!rows.length) return '暂无金额记录'
  const total = rows.reduce((sum, row) => sum + row.price, 0)
  return `累计 ¥${total.toFixed(2)} · 到访均价 ¥${(total / rows.length).toFixed(2)}`
}
function visitDate(value) {
  return String(value || '').slice(0, 10) || '日期未知'
}

async function loadPlaceInvites() {
  placeInvitesLoading.value = true
  try {
    const [friendsResult, inviteResult] = await Promise.all([
      socialRequest('friends_list'), listCampusPlaceInvites(),
    ])
    placeInviteFriends.value = Array.isArray(friendsResult?.friends) ? friendsResult.friends : []
    incomingPlaceInvites.value = Array.isArray(inviteResult?.incoming) ? inviteResult.incoming : []
    outgoingPlaceInvites.value = Array.isArray(inviteResult?.outgoing) ? inviteResult.outgoing : []
    placeInvitesLoaded.value = true
    if (!placeInviteFriends.value.some((item) => item.profile?.userId === selectedInviteFriendId.value)) {
      selectedInviteFriendId.value = ''
    }
  } catch (error) {
    message.value = error?.message || '好友地点预设暂时无法加载。'
  } finally {
    placeInvitesLoading.value = false
  }
}

async function sendPlaceInvite() {
  if (!inviteConsent.value || !selectedInviteFriendId.value || !selectedInvitePlaces.value.length || busyAction.value) return
  const target = placeInviteFriends.value.find((item) => item.profile?.userId === selectedInviteFriendId.value)?.profile
  if (!target) return
  busyAction.value = 'place-invite-send'
  try {
    const placesPayload = selectedInvitePlaces.value.map((place) => toPlaceInvitePayload(place))
    await sendCampusPlaceInvite(target.userId, placesPayload, createPlaceId())
    message.value = `已把 ${placesPayload.length} 家地点的分享副本发给${target.nickname || '好友'}；对方可以接受或拒收。`
    selectedInvitePlaceIds.value = []
    inviteConsent.value = false
    await loadPlaceInvites()
  } catch (error) {
    message.value = error?.message || '好友地点预设没有发送成功。'
  } finally {
    busyAction.value = ''
  }
}

async function acceptPlaceInvite(invite) {
  if (!invite?.id || busyAction.value) return
  busyAction.value = `place-invite-accept-${invite.id}`
  try {
    const preview = await acceptCampusPlaceInvite(invite.id)
    const imported = importPlacePreset(preview?.places || [])
    const persistence = flushStoredWrites()
    if (!persistence.ok) throw new Error('本机地点档案尚未成功保存，好友邀请仍可稍后重试。')
    try {
      await completeCampusPlaceInvite(invite.id)
      message.value = `已接受并导入 ${imported.imported} 家地点副本${imported.skipped ? `，${imported.skipped} 家已在本机` : ''}。到访、消费和私人备注没有随预设导入。`
    } catch (error) {
      message.value = `地点副本已保存在本机，但邀请状态暂未同步：${error?.message || '请稍后刷新重试。'}`
    }
    await loadPlaceInvites()
  } catch (error) {
    message.value = error?.message || '地点预设没有导入；原始邀请仍可重试。'
  } finally {
    busyAction.value = ''
  }
}

async function rejectPlaceInvite(invite) {
  if (!invite?.id || busyAction.value) return
  busyAction.value = `place-invite-reject-${invite.id}`
  try {
    await rejectCampusPlaceInvite(invite.id)
    message.value = '已拒收地点预设，分享副本已从服务端清除。'
    await loadPlaceInvites()
  } catch (error) { message.value = error?.message || '拒收没有完成。' }
  finally { busyAction.value = '' }
}

async function cancelPlaceInvite(invite) {
  if (!invite?.id || busyAction.value) return
  busyAction.value = `place-invite-cancel-${invite.id}`
  try {
    await cancelCampusPlaceInvite(invite.id)
    message.value = '已撤回地点预设，分享副本已从服务端清除。'
    await loadPlaceInvites()
  } catch (error) { message.value = error?.message || '撤回没有完成。' }
  finally { busyAction.value = '' }
}

function savePlace() {
  try {
    createPlaceWithVisit({
      id: createPlaceId(), name: placeForm.name, campus: placeForm.campus, area: placeForm.area,
      placeHint: placeForm.placeHint, category: placeForm.category, scores: placeForm.scores,
      note: placeForm.note, visibility: 'private',
    }, {
      visitedAt: placeForm.visitedAt, price: placeForm.price, scores: placeForm.scores,
      transactionId: placeForm.transactionId,
    })
    showPlaceForm.value = false
    resetPlaceForm()
    message.value = '已记下这家店和本次到访，内容只保存在本机。'
  } catch (error) {
    message.value = error?.message || '地点没有保存成功，请检查输入后重试。'
  }
}

function openVisit(place) {
  visitTarget.value = place
  resetVisitForm()
  visitForm.scores = { ...(place.scores || {}), value: place.scores?.value || 'mixed' }
  visitForm.note = ''
  showVisitForm.value = true
}

async function saveVisit() {
  const target = visitTarget.value
  if (!target) return
  busyAction.value = `visit-${target.id}`
  try {
    const local = places.value.find((place) => String(place.id) === String(target.id))
    if (local) {
      addPlaceVisit(local.id, {
        visitedAt: visitForm.visitedAt, price: visitForm.price,
        scores: visitForm.scores, transactionId: visitForm.transactionId, note: visitForm.note,
      })
      updatePlace(local.id, { scores: visitForm.scores, ...(!target.isMine ? { visibility: 'private' } : {}) })
    } else {
      createPlaceWithVisit({
        id: target.id, name: target.name, campus: target.campus, area: target.area,
        placeHint: target.placeHint, category: target.category, scores: visitForm.scores,
        note: target.note || '', visibility: target.isMine ? 'school' : 'private',
      }, {
        visitedAt: visitForm.visitedAt, price: visitForm.price,
        scores: visitForm.scores, transactionId: visitForm.transactionId, note: visitForm.note,
      })
    }
    try {
      if (target.isMine) await publishCampusPlace(toSchoolPlacePayload({ ...target, ...visitForm, scores: visitForm.scores, note: visitForm.note, visibility: 'school' }), { visited: true })
      else await saveCampusPlaceRating(target.id, target.category, visitForm.scores, visitForm.note, { visited: true })
      message.value = '本次到访已记下，结构化评分已分享到校内地点。'
      await loadSharedPlaces()
    } catch {
      message.value = '本次到访已保存在本机；校内评分暂未更新，联网后可重试。'
    }
    showVisitForm.value = false
  } catch (error) {
    message.value = error?.message || '到访记录没有保存成功。'
  } finally {
    busyAction.value = ''
  }
}

async function changeVisibility(place) {
  busyAction.value = `share-${place.id}`
  try {
    if (place.visibility === 'school') {
      const shared = sharedPlaceById.value.get(String(place.id))
      if (shared && !shared.isMine) {
        updatePlace(place.id, { visibility: 'private' })
        message.value = '这是同校同学分享的地点；你可以删除自己的评分，不能撤回对方的内容。'
        return
      }
      try { await deleteCampusPlace(place.id) }
      catch (error) {
        if (error?.code !== 'forbidden') throw error
        await deleteCampusPlaceRating(place.id)
      }
      updatePlace(place.id, { visibility: 'private' })
      message.value = '已从校内地点撤回，记录仍保存在本机。'
  } else {
      const shared = sharedPlaceById.value.get(String(place.id))
      if (shared && !shared.isMine) {
        message.value = '这是同校同学分享的地点；先保留本机记录，你可以删除自己的校内评分。'
        return
      }
      if (!visitsForPlace(place.id).length) throw new Error('先记录一次到访，才能分享地点。')
      const payload = toSchoolPlacePayload({ ...place, visibility: 'school' })
      await publishCampusPlace(payload, { visited: true })
      updatePlace(place.id, { visibility: 'school' })
      message.value = '已分享到校内地点；消费金额和到访历史仍只保存在本机。'
      await loadSharedPlaces()
    }
  } catch (error) {
    message.value = error?.message || '校内分享没有完成。'
  } finally {
    busyAction.value = ''
  }
}

async function loadSharedPlaces() {
  sharedLoading.value = true
  try {
    const result = await listCampusPlaces()
    sharedPlaces.value = Array.isArray(result?.places) ? result.places : []
    sharedLoaded.value = true
    if (section.value === 'school') message.value = sharedPlaces.value.length
      ? `校内地点 ${sharedPlaces.value.length} 家，按名称排列；没有榜单或热度排序。`
      : '校内还没有同学分享的地点，你可以先记自己的第一家店。'
  } catch (error) {
    message.value = error?.message || '校内地点暂时无法加载。'
  } finally {
    sharedLoading.value = false
  }
}

function openSharedVisit(place) {
  openVisit(place)
}

async function removePlace(place) {
  busyAction.value = `delete-${place.id}`
  try {
    const shared = sharedPlaceById.value.get(String(place.id))
    if (place.visibility === 'school') {
      if (shared?.isMine) await deleteCampusPlace(place.id)
      else if (shared && shared.ratings?.some((rating) => rating.isMine)) await deleteCampusPlaceRating(place.id)
      else {
        try { await deleteCampusPlace(place.id) }
        catch (error) { if (error?.code === 'forbidden') await deleteCampusPlaceRating(place.id); else throw error }
      }
    }
    deletePlaceLocally(place.id)
    message.value = '已删除这条地点记录和自己的到访、优惠关联。'
    if (sharedLoaded.value) await loadSharedPlaces()
  } catch (error) {
    message.value = error?.message || '删除没有完成。'
  } finally {
    busyAction.value = ''
  }
}

async function deleteRemoteRating(place) {
  busyAction.value = `rating-delete-${place.id}`
  try {
    if (place.isMine) await deleteCampusPlace(place.id)
    else await deleteCampusPlaceRating(place.id)
    const local = places.value.find((item) => String(item.id) === String(place.id))
    if (local) updatePlace(local.id, { visibility: 'private' })
    await loadSharedPlaces()
    message.value = place.isMine
      ? '已撤回校内分享；本机地点、到访和账本关联仍保留。'
      : '已删除自己的校内评分；本机地点、到访和账本关联仍保留。'
  } catch (error) {
    message.value = error?.message || '评分没有删除成功。'
  } finally {
    busyAction.value = ''
  }
}

async function submitReport() {
  const target = reportTarget.value
  if (!target) return
  busyAction.value = `report-${target.id}`
  try {
    await reportCampusPlace(target.id, reportReason.value, reportDetail.value)
    reportTarget.value = null
    reportDetail.value = ''
    message.value = '已收到举报，会检查这条校内地点内容。'
  } catch (error) {
    message.value = error?.message || '举报没有提交成功。'
  } finally {
    busyAction.value = ''
  }
}

function saveOffer() {
  try {
    const offer = createPlaceOffer({ ...offerForm, placeId: offerPlaceId.value })
    message.value = `已保存优惠“${offer.title}”。`
    offerFormOpen.value = false
    Object.assign(offerForm, { title: '', note: '', price: '', originalPrice: '', expiresAt: '' })
  } catch (error) {
    message.value = error?.message || '优惠没有保存成功。'
  }
}

function redeemOffer(offer) {
  if (offer?.status !== 'active') return
  const place = places.value.find((item) => String(item.id) === String(offer.placeId))
  if (!place) return
  let transaction = null
  let visit = null
  const previousScores = { ...place.scores }
  busyAction.value = `redeem-${offer.id}`
  try {
    transaction = domain.createTransaction({
      name: `${place.name} · ${offer.title}`, amount: offer.price, date: appToday.value,
      direction: 'expense', placeId: place.id, source: 'place-offer',
      note: `优惠核销${offer.originalPrice ? `，原价 ¥${offer.originalPrice.toFixed(2)}` : ''}${offer.note ? `；${offer.note}` : ''}`,
    })
    visit = addPlaceVisit(place.id, { visitedAt: appToday.value, price: offer.price, scores: place.scores, transactionId: transaction.id })
    if (!markPlaceOfferRedeemed(offer.id, transaction.id)) throw new Error('这张优惠已核销，请刷新后查看。')
    message.value = `已核销并记入账本：${transaction.name} ¥${offer.price.toFixed(2)}。`
  } catch (error) {
    const rollbackErrors = []
    try { if (visit) removePlaceVisit(visit.id) } catch { rollbackErrors.push('到访记录撤回失败') }
    try { if (place && visit) updatePlace(place.id, { scores: previousScores }) } catch { rollbackErrors.push('地点评分恢复失败') }
    if (transaction) {
      try {
        const rollback = domain.deleteTransaction(transaction.id)
        if (rollback?.blocked || !rollback) rollbackErrors.push('账本记录撤回失败')
      } catch { rollbackErrors.push('账本记录撤回失败') }
    } else {
      // 只有后续步骤成功登记了核销才会把状态改为 redeemed。
    }
    try { if (transaction) rollbackPlaceOfferRedemption(offer.id, transaction.id) }
    catch { rollbackErrors.push('优惠状态恢复失败') }
    message.value = `${error?.message || '核销没有完成'}${rollbackErrors.length ? `；${rollbackErrors.join('、')}，请检查地点和账本记录` : '；临时记录已撤回。'}`
  } finally {
    busyAction.value = ''
  }
}

function archivePlace(place) {
  setPlaceArchived(place.id, true)
  message.value = '已归档地点；到访和账本记录仍保留。'
}

function restorePlace(place) {
  setPlaceArchived(place.id, false)
  message.value = '已恢复地点记录。'
}

function switchSection(next) {
  section.value = next
  if (next === 'school' && !sharedLoaded.value) void loadSharedPlaces()
  if (next === 'invites' && !placeInvitesLoaded.value) void loadPlaceInvites()
}
</script>

<template>
  <div class="page places-page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">地点</h1>
        <p class="page-desc">记自己去过的地方、真实花费和结构化感受。不用地图定位，也没有榜单或推荐流。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" type="button" :aria-expanded="showPlaceForm" aria-controls="place-create-form" @click="showPlaceForm = !showPlaceForm">{{ showPlaceForm ? '收起' : '记一家店' }}</button>
      </div>
    </header>

    <nav class="place-tabs" aria-label="地点范围">
      <button type="button" :aria-pressed="section === 'mine'" @click="switchSection('mine')">我的地点</button>
      <button type="button" :aria-pressed="section === 'school'" @click="switchSection('school')">校内分享</button>
      <button type="button" :aria-pressed="section === 'invites'" @click="switchSection('invites')">好友预设</button>
      <button type="button" :aria-pressed="section === 'offers'" @click="switchSection('offers')">优惠与团购</button>
    </nav>

    <p v-if="message" class="place-message" role="status">{{ message }}</p>

    <section id="place-create-form" v-show="showPlaceForm && section === 'mine'" class="place-card place-form">
      <div class="place-section-title"><div><h2>记下去过的地点</h2><p>首次保存会同时记一次到访；默认仅本机。</p></div></div>
      <form @submit.prevent="savePlace">
        <div class="place-form-grid">
          <label>地点名称<input v-model.trim="placeForm.name" maxlength="80" required placeholder="例如：北苑二楼麻辣烫" /></label>
          <label>校区（可选）<input v-model.trim="placeForm.campus" maxlength="100" placeholder="相对校区名称" /></label>
          <label>区域（可选）<input v-model.trim="placeForm.area" maxlength="80" placeholder="例如：北苑食堂" /></label>
          <label>相对位置（可选）<input v-model.trim="placeForm.placeHint" maxlength="100" placeholder="南门进来右手边" /></label>
          <label>到访日期<input v-model="placeForm.visitedAt" type="date" required /></label>
          <label>本次消费（可选）<span class="currency-input"><span>¥</span><input v-model.number="placeForm.price" type="number" min="0" max="100000" step="0.01" inputmode="decimal" /></span></label>
          <label>关联账本记录（可选）<select v-model="placeForm.transactionId"><option value="">暂不关联</option><option v-for="item in eligibleTransactions" :key="item.id" :value="item.id">{{ item.date }} · {{ item.name }} · ¥{{ Number(item.amount || 0).toFixed(2) }}</option></select></label>
        </div>
        <fieldset class="place-category-picker"><legend>类型</legend><button v-for="item in PLACE_CATEGORIES" :key="item.id" type="button" :aria-pressed="placeForm.category === item.id" @click="setCategory(item.id)">{{ item.label }}</button></fieldset>
        <div class="score-grid">
          <label v-for="field in scoreFields" :key="field.key">{{ field.label }}
            <input v-if="field.type === 'number'" v-model.number="placeForm.scores[field.key]" type="number" :min="field.min" :max="field.max" />
            <select v-else-if="field.type === 'boolean'" v-model="placeForm.scores[field.key]"><option :value="undefined">未记录</option><option :value="true">有</option><option :value="false">无</option></select>
            <select v-else v-model="placeForm.scores[field.key]"><option value="">未记录</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
          </label>
          <label>值不值<select v-model="placeForm.scores.value"><option v-for="item in PLACE_VALUE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        </div>
        <label class="place-note-field">备注（最多 50 字）<textarea v-model="placeForm.note" maxlength="50" rows="2" /></label>
        <div class="place-form-actions"><span>这条记录先保存在本机，之后可选择分享到校内。</span><button class="btn btn-primary" type="submit">保存地点和到访</button></div>
      </form>
    </section>

    <section v-if="section === 'mine'" class="place-list">
      <p v-if="!activePlaces.length" class="place-empty">你的第 1 家店还没记。记下去过的地点后，可以顺手记录价格和「值不值」。</p>
      <article v-for="place in activePlaces" :key="place.id" class="place-card">
        <header class="place-card-head"><div><h2>{{ place.name }}</h2><p>{{ PLACE_CATEGORIES.find((item) => item.id === place.category)?.label || '地点' }}<span v-if="place.campus"> · {{ place.campus }}</span><span v-if="place.area"> · {{ place.area }}</span><span v-if="place.placeHint"> · {{ place.placeHint }}</span></p></div><span class="privacy-badge">{{ place.visibility === 'school' ? '校内可见' : '仅本机' }}</span></header>
        <p class="place-scores">{{ scoreSummary(place.scores, place.category) }}</p>
        <p v-if="place.note" class="place-note">{{ place.note }}</p>
        <p class="place-stats">{{ visitsForPlace(place.id).length }} 次到访 · {{ avgSpend(place.id) }}</p>
        <div class="place-visits">
          <div v-for="visit in visitsForPlace(place.id).slice(0, 3)" :key="visit.id" class="place-visit-row">
            <span>{{ visitDate(visit.visitedAt) }}<small v-if="visit.transactionId"> · 账本：{{ transactionNameById.get(visit.transactionId) || '已关联收支' }}</small></span>
            <span>{{ visit.price === null ? '金额未记' : `¥${Number(visit.price).toFixed(2)}` }}<small> · {{ PLACE_VALUE_OPTIONS.find((item) => item.value === visit.scores.value)?.label || '未评分' }}</small><small v-if="visit.note"> · {{ visit.note }}</small></span>
          </div>
        </div>
        <footer class="place-actions">
          <button class="btn btn-ghost" type="button" @click="openVisit(place)">记一次到访</button>
          <button class="btn btn-ghost" type="button" :disabled="busyAction === `share-${place.id}`" @click="changeVisibility(place)">{{ place.visibility === 'school' ? '撤回校内分享' : '分享到校内' }}</button>
          <button class="btn btn-ghost" type="button" @click="offerPlaceId = place.id; offerFormOpen = true; section = 'offers'">添加优惠</button>
          <button class="btn btn-ghost" type="button" @click="archivePlace(place)">归档</button>
          <button class="btn btn-danger" type="button" :disabled="Boolean(busyAction)" @click="removePlace(place)">删除自己的记录</button>
        </footer>
      </article>
      <details v-if="archivedPlaces.length" class="archived-places"><summary>已归档地点 {{ archivedPlaces.length }} 家</summary><div v-for="place in archivedPlaces" :key="place.id" class="archived-place-row"><span>{{ place.name }}</span><button class="btn btn-ghost" type="button" @click="restorePlace(place)">恢复</button><button class="btn btn-danger" type="button" @click="removePlace(place)">删除</button></div></details>
    </section>

    <section v-if="section === 'school'" class="place-list">
      <div class="place-section-title"><div><h2>校内同学分享</h2><p>仅显示同校范围的地点和到访者评分，按名称排列。</p></div><button class="btn btn-ghost" type="button" :disabled="sharedLoading" @click="loadSharedPlaces">{{ sharedLoading ? '加载中…' : '刷新' }}</button></div>
      <p v-if="sharedLoaded && !sharedPlaces.length" class="place-empty">校内还没有同学分享的地点，你可以先记自己的第一家店。</p>
      <article v-for="place in sharedPlaces" :key="place.id" class="place-card">
        <header class="place-card-head"><div><h2>{{ place.name }}</h2><p>{{ PLACE_CATEGORIES.find((item) => item.id === place.category)?.label || '地点' }}<span v-if="place.campus"> · {{ place.campus }}</span><span v-if="place.area"> · {{ place.area }}</span><span v-if="place.placeHint"> · {{ place.placeHint }}</span></p></div><span class="privacy-badge">{{ place.isMine ? '我分享的' : '校内可见' }}</span></header>
        <p v-if="!place.ratings?.length" class="place-note">还没有到访评分。</p>
        <div v-for="(rating, index) in place.ratings || []" :key="`${place.id}-${index}`" class="shared-rating"><p>{{ scoreSummary(rating.scores, place.category) }}</p><p v-if="rating.note">{{ rating.note }}</p></div>
        <footer class="place-actions"><button class="btn btn-primary" type="button" @click="openSharedVisit(place)">我去过，记一次</button><button v-if="!place.isMine" class="btn btn-ghost" type="button" @click="reportTarget = place">举报内容</button><button v-if="place.ratings?.some((rating) => rating.isMine)" class="btn btn-danger" type="button" :disabled="Boolean(busyAction)" @click="deleteRemoteRating(place)">{{ place.isMine ? '删除我的分享' : '删除我的评分' }}</button></footer>
        <form v-if="reportTarget?.id === place.id" class="report-form" @submit.prevent="submitReport"><label>举报原因<select v-model="reportReason"><option value="inaccurate">地点信息不准确</option><option value="sensitive">包含不适合公开的信息</option><option value="abuse">辱骂或攻击内容</option><option value="other">其他</option></select></label><label>补充说明（最多 50 字）<input v-model="reportDetail" maxlength="50" /></label><button class="btn btn-primary" type="submit">提交举报</button><button class="btn btn-ghost" type="button" @click="reportTarget = null">取消</button></form>
      </article>
      <p v-if="!sharedLoaded && !sharedLoading" class="place-empty">打开校内分享后，地点才会从服务端读取。私密地点和到访记录不会上传。</p>
    </section>

    <section v-if="section === 'invites'" class="place-list">
      <article class="place-card place-form">
        <div class="place-section-title"><div><h2>把地点预设发给好友</h2><p>仅可选已到访并填写过结构化评分的地点。发送前会在这里列出完整内容供你确认。</p></div><button class="btn btn-ghost" type="button" :disabled="placeInvitesLoading" @click="loadPlaceInvites">{{ placeInvitesLoading ? '加载中…' : '刷新' }}</button></div>
        <label>好友<select v-model="selectedInviteFriendId"><option value="">请选择已添加的好友</option><option v-for="item in placeInviteFriends" :key="item.profile?.userId" :value="item.profile?.userId">{{ item.profile?.nickname || '三两事好友' }}{{ item.profile?.school ? ` · ${item.profile.school}` : '' }}</option></select></label>
        <p v-if="!placeInvitesLoading && placeInvitesLoaded && !placeInviteFriends.length" class="place-empty">好友列表还是空的。添加好友后，可以把选中的地点评分作为可拒收预设发给对方。</p>
        <p v-else-if="!scoredPlacesForInvite.length" class="place-empty">还没有可分享的评分地点。记下地点、到访并填一项评分后，就能选进好友预设。</p>
        <div v-else class="place-invite-checklist">
          <label v-for="place in scoredPlacesForInvite" :key="place.id" class="place-invite-choice"><input v-model="selectedInvitePlaceIds" type="checkbox" :value="place.id" /><span><b>{{ place.name }}</b><small>{{ place.campus || '未记校区' }}<span v-if="place.area"> · {{ place.area }}</span><span v-if="place.placeHint"> · {{ place.placeHint }}</span></small><small>{{ scoreSummary(place.scores, place.category) }}</small></span></label>
        </div>
        <p v-if="selectedInvitePlaces.length" class="place-invite-disclosure">发送副本会包含名称、校区、区域、相对位置和上面展示的结构化评分；不会包含私人备注、到访日期、消费金额、账本关联或优惠记录。副本最多保留 30 天；接受后导入到对方本机并从服务器清除，拒收或撤回也会清除。</p>
        <label v-if="selectedInvitePlaces.length" class="place-invite-consent"><input v-model="inviteConsent" type="checkbox" />我确认把上面选中的地点副本上传并发送给这位好友。</label>
        <button class="btn btn-primary" type="button" :disabled="!selectedInviteFriendId || !selectedInvitePlaces.length || !inviteConsent || Boolean(busyAction)" @click="sendPlaceInvite">{{ busyAction === 'place-invite-send' ? '发送中…' : `发送预设${selectedInvitePlaces.length ? `（${selectedInvitePlaces.length} 家）` : ''}` }}</button>
      </article>

      <article class="place-card">
        <div class="place-section-title"><div><h2>收到的地点预设</h2><p>先查看分享内容，再决定接受或拒收。</p></div></div>
        <p v-if="placeInvitesLoading" class="place-empty">正在读取好友预设…</p>
        <p v-else-if="placeInvitesLoaded && !incomingPlaceInvites.length" class="place-empty">还没有待处理的地点预设。</p>
        <div v-for="invite in incomingPlaceInvites" :key="invite.id" class="place-invite-card">
          <header><div><b>{{ invite.sender?.nickname || '三两事好友' }}分享了 {{ invite.places.length }} 家地点</b><small>有效期至 {{ visitDate(invite.expiresAt) }}</small></div></header>
          <div class="place-invite-checklist"><div v-for="place in invite.places" :key="place.id" class="place-invite-choice"><span><b>{{ place.name }}</b><small>{{ place.campus || '未记校区' }}<span v-if="place.area"> · {{ place.area }}</span><span v-if="place.placeHint"> · {{ place.placeHint }}</span></small><small>{{ scoreSummary(place.scores, place.category) }}</small></span></div></div>
          <p class="place-invite-disclosure">接受会把地点资料和结构化评分保存为你的本机私密副本，不会导入对方的到访、花费或私人备注。接受后副本会从服务器清除。</p>
          <footer class="place-actions"><button class="btn btn-primary" type="button" :disabled="Boolean(busyAction)" @click="acceptPlaceInvite(invite)">{{ busyAction === `place-invite-accept-${invite.id}` ? '导入中…' : '接受并导入本机' }}</button><button class="btn btn-ghost" type="button" :disabled="Boolean(busyAction)" @click="rejectPlaceInvite(invite)">拒收并清除</button></footer>
        </div>
      </article>

      <article class="place-card">
        <div class="place-section-title"><div><h2>我发出的地点预设</h2><p>好友接受、拒收或预设过期后，服务器会清除分享副本。</p></div></div>
        <p v-if="placeInvitesLoaded && !outgoingPlaceInvites.length" class="place-empty">没有等待好友处理的地点预设。</p>
        <div v-for="invite in outgoingPlaceInvites" :key="invite.id" class="place-invite-card"><header><div><b>发给{{ invite.recipient?.nickname || '好友' }} · {{ invite.placeCount }} 家地点</b><small>有效期至 {{ visitDate(invite.expiresAt) }}</small></div><button class="btn btn-ghost" type="button" :disabled="Boolean(busyAction)" @click="cancelPlaceInvite(invite)">撤回并清除</button></header></div>
      </article>
    </section>

    <section v-if="section === 'offers'" class="place-list">
      <div class="place-section-title"><div><h2>优惠与团购</h2><p>核销时会新增一笔收支，并关联到地点；这里不设置周期扣款。</p></div><button class="btn btn-primary" type="button" :disabled="!activePlaces.length" :aria-expanded="offerFormOpen" aria-controls="place-offer-form" @click="offerFormOpen = !offerFormOpen">{{ offerFormOpen ? '收起' : '记一张优惠' }}</button></div>
      <form id="place-offer-form" v-show="offerFormOpen" class="place-card place-form" @submit.prevent="saveOffer"><label>地点<select v-model="offerPlaceId" required><option value="">请选择</option><option v-for="place in activePlaces" :key="place.id" :value="place.id">{{ place.name }}</option></select></label><div class="place-form-grid"><label>优惠名称<input v-model.trim="offerForm.title" maxlength="60" required placeholder="例如：午餐套餐券" /></label><label>核销实付（元）<input v-model.number="offerForm.price" type="number" min="0.01" step="0.01" required /></label><label>原价（可选）<input v-model.number="offerForm.originalPrice" type="number" min="0.01" step="0.01" /></label><label>有效期（可选）<input v-model="offerForm.expiresAt" type="date" /></label></div><label>说明（最多 50 字）<input v-model.trim="offerForm.note" maxlength="50" /></label><div class="place-form-actions"><span>核销会写入账本，金额沿用这里的实付金额。</span><button class="btn btn-primary" type="submit">保存优惠</button></div></form>
      <p v-if="!visibleOffers.length" class="place-empty">还没有待核销优惠。记下的优惠可以在使用后直接生成账本记录。</p>
      <article v-for="offer in visibleOffers" :key="offer.id" class="place-card offer-card"><header><div><h3>{{ places.find((place) => place.id === offer.placeId)?.name || '地点' }} · {{ offer.title }}</h3><p>{{ offer.expiresAt ? `有效期至 ${offer.expiresAt}` : '未设置有效期' }}<span v-if="offer.originalPrice"> · 原价 ¥{{ offer.originalPrice.toFixed(2) }}</span></p></div><b>¥{{ offer.price.toFixed(2) }}</b></header><p v-if="offer.note">{{ offer.note }}</p><footer class="place-actions"><button class="btn btn-primary" type="button" :disabled="offer.expiresAt && offer.expiresAt < appToday" @click="redeemOffer(offer)">{{ offer.expiresAt && offer.expiresAt < appToday ? '优惠已过期' : '核销并记账' }}</button><button class="btn btn-ghost" type="button" @click="deletePlaceOffer(offer.id)">删除优惠</button></footer></article>
    </section>

    <form v-if="showVisitForm" class="visit-sheet" role="dialog" aria-modal="true" aria-labelledby="place-visit-title" @submit.prevent="saveVisit">
      <div class="place-section-title"><div><h2 id="place-visit-title">记一次到访 · {{ visitTarget?.name }}</h2><p>金额、具体时间和这次账本关联只保存在本机。</p></div><button class="btn btn-ghost" type="button" @click="showVisitForm = false">关闭</button></div>
      <div class="place-form-grid"><label>到访日期<input v-model="visitForm.visitedAt" type="date" required /></label><label>消费金额（可选）<input v-model.number="visitForm.price" type="number" min="0" max="100000" step="0.01" /></label><label>关联收支（可选）<select v-model="visitForm.transactionId"><option value="">暂不关联</option><option v-for="item in eligibleTransactions" :key="item.id" :value="item.id">{{ item.date }} · {{ item.name }} · ¥{{ Number(item.amount || 0).toFixed(2) }}</option></select></label></div>
      <div class="score-grid"><label v-for="field in visitScoreFields" :key="field.key">{{ field.label }}<input v-if="field.type === 'number'" v-model.number="visitForm.scores[field.key]" type="number" :min="field.min" :max="field.max" /><select v-else-if="field.type === 'boolean'" :value="visitForm.scores[field.key] === undefined ? '' : String(visitForm.scores[field.key])" @change="setVisitScore(field.key, $event.target.value === '' ? undefined : $event.target.value === 'true')"><option value="">未记录</option><option value="true">有</option><option value="false">无</option></select><select v-else v-model="visitForm.scores[field.key]"><option value="">未记录</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label>值不值<select v-model="visitForm.scores.value"><option v-for="item in PLACE_VALUE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select></label></div>
      <label>这次的备注（最多 50 字）<textarea v-model="visitForm.note" maxlength="50" rows="2" /></label>
      <div class="place-form-actions"><span>校内可见的地点只会收到你主动分享的结构化评分和短备注。</span><button class="btn btn-primary" type="submit" :disabled="Boolean(busyAction)">{{ busyAction ? '保存中…' : '保存到访' }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.places-page{display:grid;gap:12px}.place-tabs{display:flex;gap:6px;overflow:auto}.place-tabs button{min-height:40px;padding:0 14px;border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--card);color:var(--muted);font:inherit;font-size:var(--fs-12);white-space:nowrap}.place-tabs button[aria-pressed=true]{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.place-card,.visit-sheet{padding:16px;border:1px solid var(--border);border-radius:var(--radius-14);background:var(--card)}.place-section-title,.place-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.place-section-title h2,.place-card h2,.place-card h3{margin:0;font-size:var(--fs-16)}.place-section-title p,.place-card-head p,.offer-card header p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-11);line-height:1.5}.place-section-title{margin-bottom:12px}.place-message{margin:0;padding:10px 12px;border-radius:var(--radius-9);background:var(--primary-soft);color:var(--text);font-size:var(--fs-12);line-height:1.5}.place-form-grid,.score-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.place-form label,.visit-sheet label,.report-form label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:var(--fs-11)}.place-form input,.place-form select,.place-form textarea,.visit-sheet input,.visit-sheet select,.visit-sheet textarea,.report-form input,.report-form select{width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit}.place-form textarea,.visit-sheet textarea{resize:vertical}.place-category-picker{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0;padding:0;border:0}.place-category-picker legend{width:100%;margin-bottom:5px;color:var(--muted);font-size:var(--fs-11)}.place-category-picker button{min-height:36px;padding:0 11px;border:1px solid var(--border);border-radius:var(--radius-pill);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-11)}.place-category-picker button[aria-pressed=true]{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.score-grid{margin:12px 0}.place-note-field{margin-top:10px}.place-form-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}.place-form-actions span{color:var(--muted);font-size:var(--fs-10);line-height:1.5}.place-list{display:grid;gap:10px}.place-empty{margin:0;padding:18px;border:1px dashed var(--border);border-radius:var(--radius-12);background:var(--card);color:var(--muted);font-size:var(--fs-12);line-height:1.65}.place-invite-checklist{display:grid;gap:8px;margin:12px 0}.place-invite-choice{display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-9);background:var(--bg);color:var(--text)}.place-invite-choice input,.place-invite-consent input{flex:none;width:20px;height:20px;margin:1px 0 0;accent-color:var(--primary)}.place-invite-choice span{display:grid;gap:4px;min-width:0}.place-invite-choice small,.place-invite-card header small{color:var(--muted);font-size:var(--fs-10);line-height:1.5}.place-invite-disclosure{margin:10px 0;padding:10px;border-radius:var(--radius-8);background:var(--primary-soft);color:var(--muted);font-size:var(--fs-11);line-height:1.6}.place-invite-consent{display:flex!important;flex-direction:row!important;align-items:center;gap:9px!important;margin:10px 0 12px;color:var(--text)!important;font-size:var(--fs-11)!important;line-height:1.5}.place-invite-card{padding:12px 0;border-top:1px solid var(--border)}.place-invite-card header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.place-invite-card header div{display:grid;gap:4px}.privacy-badge{flex:none;padding:4px 8px;border-radius:var(--radius-pill);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-10)}.place-scores,.place-note{margin:10px 0 0;color:var(--text);font-size:var(--fs-12);line-height:1.6}.place-stats{margin:8px 0;color:var(--muted);font-size:var(--fs-11)}.place-visits{border-top:1px solid var(--border)}.place-visit-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:var(--fs-11)}.place-visit-row small{color:var(--muted)}.place-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.btn{min-height:40px;padding:0 12px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--bg);color:var(--text);font:inherit;font-size:var(--fs-11)}.btn-primary{border-color:var(--primary);background:var(--primary);color:var(--on-primary,#fff)}.btn-ghost{background:transparent}.btn-danger{color:var(--danger,#b42318)}.btn:disabled{opacity:.58}.archived-places{padding:12px;border:1px solid var(--border);border-radius:var(--radius-11);background:var(--card);color:var(--muted);font-size:var(--fs-12)}.archived-place-row{display:flex;align-items:center;gap:7px;padding-top:9px}.archived-place-row span{flex:1;color:var(--text)}.shared-rating{margin-top:8px;padding:9px;border-radius:var(--radius-8);background:var(--bg);font-size:var(--fs-11);line-height:1.55}.shared-rating p{margin:0}.shared-rating p+p{margin-top:4px;color:var(--muted)}.report-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}.report-form button{justify-self:start}.offer-card header{display:flex;justify-content:space-between;gap:10px}.offer-card header b{color:var(--primary);font-size:var(--fs-16)}.offer-card>p{margin:9px 0 0;color:var(--muted);font-size:var(--fs-11)}.currency-input{display:flex;align-items:center;gap:7px}.currency-input input{flex:1}.visit-sheet{position:fixed;z-index:110;inset:auto 12px max(12px,env(safe-area-inset-bottom));max-height:min(88dvh,760px);overflow:auto;box-shadow:0 12px 44px #0003}.visit-sheet>.place-section-title{position:sticky;top:-16px;padding:12px 0;background:var(--card);z-index:1}.place-note-field textarea{min-height:60px}
@media(max-width:520px){.place-card,.visit-sheet{padding:13px}.place-form-grid,.score-grid,.report-form{grid-template-columns:1fr}.place-form-actions{align-items:flex-start;flex-direction:column}.place-form-actions .btn{width:100%}.place-card-head{gap:7px}.place-visit-row{align-items:flex-start;flex-direction:column}.place-actions .btn{flex:1 1 auto}.visit-sheet{inset:auto 0 max(0px,env(safe-area-inset-bottom));max-height:90dvh;border-radius:var(--radius-14) var(--radius-14) 0 0}}
</style>
