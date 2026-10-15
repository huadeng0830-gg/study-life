<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CampusHome from '../components/CampusHome.vue'
import { PLACE_CATEGORIES, PLACE_SCORE_FIELDS, PLACE_TYPES, PLACE_VALUE_OPTIONS, createPlaceId, toPlaceInvitePayload, toSchoolPlacePayload } from '../composables/placeModels.js'
import {
  addPlaceVisit, createPlaceOffer, createPlaceRecord, createPlaceWithVisit, deletePlaceLocally, deletePlaceOffer, importPlacePreset,
  markPlaceOfferRedeemed, placeOffers, places, removePlaceVisit, rollbackPlaceOfferRedemption, setPlaceArchived,
  syncPlaceReviewStatuses, updatePlace, visitsForPlace,
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
const section = ref('home')
const route = useRoute()
const message = ref('')
const searchQuery = ref('')
const selectedCategory = ref('all')
const selectedType = ref('all')
const showPlaceForm = ref(false)
const placeSaveMode = ref('want')
const editingPlaceId = ref('')
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

const blankPlace = () => ({ name: '', campus: '', area: '', placeHint: '', type: 'restaurant', category: 'food', scores: { value: 'mixed' }, note: '', description: '', openingHours: '', serviceInfo: '', publicContact: '', sourceInfo: '', visitedAt: appToday.value, price: '', transactionId: '' })
const blankVisit = () => ({ visitedAt: appToday.value, price: '', scores: { value: 'mixed' }, note: '', shareReview: false, publicNote: '', transactionId: '' })
const placeForm = reactive(blankPlace())
const visitForm = reactive(blankVisit())
const offerForm = reactive({ title: '', note: '', price: '', originalPrice: '', expiresAt: '' })

function handlePlaceEscape(event) {
  if (event.key !== 'Escape') return
  if (showVisitForm.value) showVisitForm.value = false
  else if (reportTarget.value) reportTarget.value = null
}
onMounted(() => {
  window.addEventListener('keydown', handlePlaceEscape)
  void loadSharedPlaces()
})
onUnmounted(() => window.removeEventListener('keydown', handlePlaceEscape))

const activePlaces = computed(() => places.value.filter((place) => !place.archivedAt)
  .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))))
const homePlaces = computed(() => sharedPlaces.value
  .filter((place) => place.reviewStatus === 'approved')
  .slice().sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 4))
const filteredPlaces = computed(() => {
  const source = section.value === 'discover' ? sharedPlaces.value : activePlaces.value
  const needle = searchQuery.value.trim().toLocaleLowerCase('zh-CN')
  return source.filter((place) => {
    if (selectedCategory.value !== 'all' && place.category !== selectedCategory.value) return false
    if (selectedType.value !== 'all' && place.type !== selectedType.value) return false
    if (!needle) return true
    const categoryName = PLACE_CATEGORIES.find((item) => item.id === place.category)?.label || ''
    const typeName = PLACE_TYPES.find((item) => item.id === place.type)?.label || ''
    return [place.name, place.campus, place.area, place.placeHint, place.description,
      place.openingHours, place.serviceInfo, place.publicContact, place.sourceInfo, categoryName, typeName]
      .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(needle))
  })
})
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
  editingPlaceId.value = ''
  placeSaveMode.value = 'want'
}
function resetVisitForm() {
  Object.assign(visitForm, blankVisit())
}
function setPlaceType(typeId) {
  const type = PLACE_TYPES.find((item) => item.id === typeId)
  if (!type) return
  if (type.category !== placeForm.category) placeForm.scores = { value: 'mixed' }
  placeForm.type = type.id
  placeForm.category = type.category
}
function setVisitScore(field, value) {
  visitForm.scores[field] = value
}
function scoreSummary(scores = {}, category = 'food') {
  const overall = Number.isInteger(Number(scores.rating)) && Number(scores.rating) > 0 ? `综合 ${scores.rating}/5` : ''
  const valueLabel = PLACE_VALUE_OPTIONS.find((item) => item.value === scores.value)?.label || '未记录'
  const parts = Object.entries(scores).filter(([key]) => key !== 'value' && key !== 'rating').map(([key, value]) => {
    const descriptor = (PLACE_SCORE_FIELDS[category] || []).find((field) => field.key === key)
    const selected = descriptor?.options?.find((option) => option.value === value)?.label
    return `${descriptor?.label || key} ${selected || (typeof value === 'boolean' ? value ? '有' : '无' : value)}`
  })
  return [overall, `值不值：${valueLabel}`, ...parts].filter(Boolean).join(' · ')
}
function ratingSummary(place) {
  const ratings = (place?.ratings || []).map((item) => Number(item.scores?.rating)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 5)
  if (!ratings.length) return '暂无综合评分'
  if (ratings.length < 3) return `${ratings.length} 条评分 · 样本较少，仅供参考`
  const average = ratings.reduce((sum, value) => sum + value, 0) / ratings.length
  return `${average.toFixed(1)} / 5 · ${ratings.length} 条评分`
}
function ratingDistribution(place) {
  const ratings = (place?.ratings || []).map((item) => Number(item.scores?.rating)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 5)
  const total = ratings.length
  return [5, 4, 3, 2, 1].map((value) => {
    const count = ratings.filter((rating) => rating === value).length
    return { value, count, percent: total ? Math.round((count / total) * 100) : 0 }
  })
}
function placeTypeLabel(place) {
  return PLACE_TYPES.find((item) => item.id === place?.type)?.label
    || PLACE_CATEGORIES.find((item) => item.id === place?.category)?.label || '校园地点'
}
function isPlaceSaved(placeId) {
  return places.value.some((place) => String(place.id) === String(placeId) && !place.archivedAt)
}
function isPlaceArchived(placeId) {
  return places.value.some((place) => String(place.id) === String(placeId) && place.archivedAt)
}
function addSharedPlaceToWant(place) {
  if (!place?.id || isPlaceSaved(place.id)) return
  if (isPlaceArchived(place.id)) {
    setPlaceArchived(place.id, false)
    message.value = `已把「${place.name}」恢复到我的地点。`
    return
  }
  try {
    createPlaceRecord({
      id: place.id, name: place.name, campus: place.campus, area: place.area,
      placeHint: place.placeHint, type: place.type, category: place.category,
      description: place.description, openingHours: place.openingHours,
      serviceInfo: place.serviceInfo, publicContact: place.publicContact,
      sourceInfo: place.sourceInfo, visibility: 'private',
    })
    message.value = `已把「${place.name}」加入想去清单。`
  } catch (error) {
    message.value = error?.message || '地点没有加入清单。'
  }
}
function updatedDate(value) {
  return String(value || '').slice(0, 10) || '日期未知'
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

function beginNewPlace() {
  resetPlaceForm()
  section.value = 'mine'
  placeSaveMode.value = 'want'
  showPlaceForm.value = true
}

function editPlace(place) {
  editingPlaceId.value = String(place.id)
  placeSaveMode.value = visitsForPlace(place.id).length ? 'visited' : 'want'
  Object.assign(placeForm, {
    ...blankPlace(), ...place, scores: { ...(place.scores || {}) }, visitedAt: appToday.value,
    price: '', transactionId: '',
  })
  section.value = 'mine'
  showPlaceForm.value = true
}

async function savePlace() {
  try {
    const editingPlace = places.value.find((place) => String(place.id) === editingPlaceId.value)
    const nameKey = String(placeForm.name || '').trim().toLocaleLowerCase('zh-CN')
    const duplicate = activePlaces.value.find((place) => String(place.id) !== editingPlaceId.value
      && place.name.trim().toLocaleLowerCase('zh-CN') === nameKey
      && place.campus.trim() === String(placeForm.campus || '').trim()
      && place.area.trim() === String(placeForm.area || '').trim())
    if (duplicate) throw new Error(`已有同名地点「${duplicate.name}」，请编辑现有记录，避免重复。`)

    const draft = {
      id: editingPlace?.id || createPlaceId(), name: placeForm.name, campus: placeForm.campus,
      area: placeForm.area, placeHint: placeForm.placeHint, type: placeForm.type,
      category: placeForm.category, scores: placeForm.scores, note: placeForm.note,
      description: placeForm.description, openingHours: placeForm.openingHours,
      serviceInfo: placeForm.serviceInfo, publicContact: placeForm.publicContact,
      sourceInfo: placeForm.sourceInfo, visibility: placeSaveMode.value === 'submit' ? 'school' : editingPlace?.visibility || 'private',
    }
    if (editingPlace) {
      if (visitsForPlace(editingPlace.id).length && editingPlace.category !== draft.category) {
        throw new Error('已有到访记录不能更换大类；请新建一条地点记录。')
      }
      if (editingPlace.visibility === 'school') {
        await publishCampusPlace(toSchoolPlacePayload({ ...editingPlace, ...draft, visibility: 'school' }))
        draft.reviewStatus = 'pending'
        draft.reviewReason = ''
      }
      updatePlace(editingPlace.id, draft)
      message.value = editingPlace.visibility === 'school' ? '地点资料已更新，修改内容进入重新审核。' : '地点资料已更新。'
      if (editingPlace.visibility === 'school') await loadSharedPlaces()
    } else if (placeSaveMode.value === 'submit') {
      await publishCampusPlace(toSchoolPlacePayload({ ...draft, visibility: 'school' }))
      createPlaceRecord({ ...draft, reviewStatus: 'pending' })
      message.value = '地点资料已提交审核；通过后会出现在同校发现中。'
    } else if (placeSaveMode.value === 'visited') {
      createPlaceWithVisit(draft, {
        visitedAt: placeForm.visitedAt, price: placeForm.price, scores: placeForm.scores,
        transactionId: placeForm.transactionId,
      })
      message.value = '已记下地点和本次到访；分享前你可以先核对公开资料。'
    } else {
      createPlaceRecord(draft)
      message.value = '已加入“想去”清单；到访后可以补充体验并分享到校内。'
    }
    showPlaceForm.value = false
    resetPlaceForm()
  } catch (error) {
    message.value = error?.message || '地点没有保存成功，请检查输入后重试。'
  }
}

function openVisit(place) {
  visitTarget.value = place
  resetVisitForm()
  visitForm.scores = { ...(place.scores || {}), value: place.scores?.value || 'mixed' }
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
    if (target.visibility === 'school' && target.reviewStatus === 'approved') {
      try {
        await saveCampusPlaceRating(target.id, target.category, visitForm.scores,
          visitForm.shareReview ? visitForm.publicNote.trim() : undefined, { visited: true })
        message.value = '本次到访已记下，评分已分享到校内地点。'
        await loadSharedPlaces()
      } catch {
        message.value = '本次到访已保存在本机；校内评分暂未更新，联网后可重试。'
      }
    } else {
      message.value = target.reviewStatus === 'pending'
        ? '到访已记录在本机；地点通过审核后，才可以分享这次评分。'
        : '到访已记录在本机；公开地点资料通过审核后，才可以分享这次评分。'
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
      updatePlace(place.id, { visibility: 'private', reviewStatus: 'not_submitted', reviewReason: '' })
      message.value = '已从校内地点撤回，记录仍保存在本机。'
  } else {
      const shared = sharedPlaceById.value.get(String(place.id))
      if (shared && !shared.isMine) {
        message.value = '这是同校同学分享的地点；先保留本机记录，你可以删除自己的校内评分。'
        return
      }
      const payload = toSchoolPlacePayload({ ...place, visibility: 'school' })
      await publishCampusPlace(payload)
      updatePlace(place.id, { visibility: 'school', reviewStatus: 'pending', reviewReason: '' })
      message.value = '地点资料已提交审核；通过后会显示在校内发现。到访与消费明细仍只保存在本机。'
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
    syncPlaceReviewStatuses(sharedPlaces.value)
    sharedLoaded.value = true
    if (section.value === 'discover') message.value = sharedPlaces.value.length
      ? `已载入 ${sharedPlaces.value.length} 个同校分享地点。`
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
    if (local) updatePlace(local.id, { visibility: 'private', reviewStatus: 'not_submitted', reviewReason: '' })
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

async function archivePlace(place) {
  busyAction.value = `archive-${place.id}`
  try {
    if (place.visibility === 'school') {
      const shared = sharedPlaceById.value.get(String(place.id))
      if (shared?.isMine) await deleteCampusPlace(place.id)
      else if (shared?.ratings?.some((rating) => rating.isMine)) await deleteCampusPlaceRating(place.id)
      else if (!shared) throw new Error('无法确认校内分享状态，请刷新后再归档。')
      updatePlace(place.id, { visibility: 'private', reviewStatus: 'not_submitted', reviewReason: '' })
    }
    setPlaceArchived(place.id, true)
    message.value = '已归档地点；本机到访和账本记录仍保留。'
    if (sharedLoaded.value) await loadSharedPlaces()
  } catch (error) {
    message.value = error?.message || '地点没有归档成功。'
  } finally {
    busyAction.value = ''
  }
}

function restorePlace(place) {
  setPlaceArchived(place.id, false)
  message.value = '已恢复地点记录。'
}

function switchSection(next) {
  section.value = next
  if (next === 'discover' && !sharedLoaded.value && !sharedLoading.value) void loadSharedPlaces()
  if (next === 'invites' && !placeInvitesLoaded.value) void loadPlaceInvites()
}
watch(() => route.query.section, value => { if (['home','discover','mine','invites','offers'].includes(String(value))) switchSection(String(value)) }, { immediate: true })

function searchCampusPlaces(category = 'all') {
  selectedCategory.value = category
  selectedType.value = 'all'
  switchSection('discover')
}
</script>

<template>
  <div class="page places-page">
    <header class="page-head">
      <div class="page-head-main">
        <RouterLink class="text-button" to="/campus">校园总览</RouterLink>
        <h1 class="page-title">校园地点</h1>
        <p class="page-desc">查找并共建校园地点信息。地点资料提交审核后公开；到访日期、消费金额和私人备注始终留在本机。</p>
      </div>
      <div v-if="section !== 'home'" class="page-actions">
        <button class="btn btn-primary" type="button" :aria-expanded="showPlaceForm && section === 'mine'" aria-controls="place-create-form" @click="showPlaceForm && section === 'mine' ? showPlaceForm = false : beginNewPlace()">{{ showPlaceForm && section === 'mine' ? '收起' : '添加地点' }}</button>
      </div>
    </header>

    <nav class="place-tabs" aria-label="校园生活分类">
      <button type="button" :aria-pressed="section === 'home'" @click="switchSection('home')">首页</button>
      <button type="button" :aria-pressed="section === 'discover'" @click="switchSection('discover')">发现</button>
      <button type="button" :aria-pressed="section === 'mine'" @click="switchSection('mine')">我的地点</button>
      <button type="button" :aria-pressed="section === 'invites'" @click="switchSection('invites')">好友预设</button>
      <button type="button" :aria-pressed="section === 'offers'" @click="switchSection('offers')">优惠</button>
    </nav>

    <p v-if="message" class="place-message" role="status">{{ message }}</p>

    <CampusHome
      v-if="section === 'home'"
      :places="homePlaces"
      :my-place-count="activePlaces.length"
      :search-query="searchQuery"
      :loading="sharedLoading"
      :loaded="sharedLoaded"
      :place-type-label="placeTypeLabel"
      :rating-summary="ratingSummary"
      @update:search-query="searchQuery = $event"
      @search="searchCampusPlaces"
      @mine="switchSection('mine')"
      @add="beginNewPlace"
      @visit="openSharedVisit"
      @retry="loadSharedPlaces"
    />

    <section v-if="section === 'discover'" class="place-discovery">
      <div class="discovery-heading">
        <div><span class="discovery-mark" aria-hidden="true">校</span><div><h2>找校园里的地点</h2><p>同校目录展示已审核地点和你自己的待审核投稿；个人到访、消费和私人备注不会公开。</p></div></div>
        <button class="btn btn-ghost" type="button" :disabled="sharedLoading" @click="loadSharedPlaces">{{ sharedLoading ? '更新中…' : '刷新地点' }}</button>
      </div>
      <label class="place-search"><span aria-hidden="true">⌕</span><span class="sr-only">搜索校园地点</span><input v-model.trim="searchQuery" type="search" placeholder="搜地点、校区、区域或服务" /><button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchQuery = ''">清除</button></label>
      <div class="place-filter-row" aria-label="按地点类别筛选">
        <button type="button" :aria-pressed="selectedCategory === 'all'" @click="selectedCategory = 'all'; selectedType = 'all'">全部</button>
        <button v-for="item in PLACE_CATEGORIES" :key="item.id" type="button" :aria-pressed="selectedCategory === item.id" @click="selectedCategory = item.id; selectedType = 'all'">{{ item.label }}</button>
      </div>
      <label v-if="selectedCategory !== 'all'" class="type-filter">细分类<select v-model="selectedType"><option value="all">{{ PLACE_CATEGORIES.find((item) => item.id === selectedCategory)?.label }} · 全部</option><option v-for="item in PLACE_TYPES.filter((type) => type.category === selectedCategory)" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <div class="place-results-heading"><h3>{{ selectedCategory === 'all' ? '校内地点' : PLACE_CATEGORIES.find((item) => item.id === selectedCategory)?.label }}</h3><span>{{ sharedLoading ? '正在读取…' : `${filteredPlaces.length} 个结果` }}</span></div>
      <div v-if="sharedLoading && !sharedLoaded" class="place-loading" role="status">正在读取校内地点…</div>
      <div v-else-if="filteredPlaces.length" class="discover-grid">
        <article v-for="place in filteredPlaces" :key="place.id" class="place-card discover-card">
          <header class="discover-card-head"><span class="type-tag">{{ placeTypeLabel(place) }}</span><span class="updated-label">{{ place.isMine ? (place.reviewStatus === 'pending' ? '我的投稿 · 待审核' : place.reviewStatus === 'rejected' ? '审核退回' : '我发布的') : '同校分享' }} · {{ updatedDate(place.updatedAt) }}</span></header>
          <h3>{{ place.name }}</h3>
          <p v-if="place.isMine && place.reviewStatus === 'rejected' && place.reviewReason" class="review-reason-note"><b>审核意见：</b>{{ place.reviewReason }}</p>
          <p class="discover-location"><span aria-hidden="true">⌖</span>{{ [place.campus, place.area, place.placeHint].filter(Boolean).join(' · ') || '位置待补充' }}</p>
          <p class="rating-total">{{ ratingSummary(place) }}</p>
          <div v-if="ratingDistribution(place).some((row) => row.count)" class="rating-distribution" aria-label="综合评分分布">
            <div v-for="row in ratingDistribution(place)" :key="row.value"><span>{{ row.value }} 分</span><span class="rating-track"><i :style="{ width: `${row.percent}%` }"></i></span><b>{{ row.count }}</b></div>
          </div>
          <p v-if="place.description" class="discover-description">{{ place.description }}</p>
          <dl v-if="place.openingHours || place.serviceInfo || place.publicContact || place.sourceInfo" class="discover-facts">
            <div v-if="place.openingHours"><dt>开放时间</dt><dd>{{ place.openingHours }}</dd></div>
            <div v-if="place.serviceInfo"><dt>服务与价格</dt><dd>{{ place.serviceInfo }}</dd></div>
            <div v-if="place.publicContact"><dt>公开联系方式</dt><dd>{{ place.publicContact }}</dd></div>
            <div v-if="place.sourceInfo"><dt>来源说明</dt><dd>{{ place.sourceInfo }}</dd></div>
          </dl>
          <details v-if="place.ratings?.length" class="rating-details"><summary>查看同学体验（{{ place.ratings.length }}）</summary>
            <div v-for="(rating, index) in place.ratings" :key="`${place.id}-${index}`" class="shared-rating"><p>{{ scoreSummary(rating.scores, place.category) }}</p><p v-if="rating.note">{{ rating.note }}</p></div>
          </details>
          <footer class="place-actions"><button class="btn btn-primary" type="button" @click="openSharedVisit(place)">我去过，记一次</button><button class="btn btn-ghost" type="button" :disabled="isPlaceSaved(place.id)" @click="addSharedPlaceToWant(place)">{{ isPlaceSaved(place.id) ? '已在清单' : isPlaceArchived(place.id) ? '恢复到清单' : '加入想去' }}</button><button v-if="!place.isMine" class="btn btn-ghost" type="button" @click="reportTarget = place">报告信息问题</button><button v-if="place.isMine || place.ratings?.some((rating) => rating.isMine)" class="btn btn-ghost" type="button" :disabled="Boolean(busyAction)" @click="deleteRemoteRating(place)">{{ place.isMine ? '撤回地点分享' : '删除我的评分' }}</button></footer>
          <form v-if="reportTarget?.id === place.id" class="report-form" @submit.prevent="submitReport"><label>问题类型<select v-model="reportReason"><option value="inaccurate">地点信息不准确</option><option value="sensitive">包含不适合公开的信息</option><option value="abuse">辱骂或攻击内容</option><option value="other">其他</option></select></label><label>补充说明（最多 50 字）<input v-model="reportDetail" maxlength="50" /></label><button class="btn btn-primary" type="submit">提交报告</button><button class="btn btn-ghost" type="button" @click="reportTarget = null">取消</button></form>
        </article>
      </div>
      <div v-else-if="!sharedLoading && sharedLoaded && (searchQuery || selectedCategory !== 'all' || selectedType !== 'all')" class="place-empty"><h3>没有找到匹配地点</h3><p>试试简称、校区名或更短的关键词；也可以清除类别筛选。</p><button class="btn btn-ghost" type="button" @click="searchQuery = ''; selectedCategory = 'all'; selectedType = 'all'">清除搜索和筛选</button></div>
      <div v-else-if="!sharedLoading && sharedLoaded" class="place-empty"><h3>这里还没有校内地点</h3><p>提交一条地点资料，审核通过后就能帮助同校同学找到它。</p><button class="btn btn-primary" type="button" @click="beginNewPlace">添加第一个地点</button></div>
      <div v-else class="place-empty"><h3>校内地点暂时无法读取</h3><p>检查网络和账号学校资料后重试；你的本机地点仍可在“我的地点”中查看。</p><button class="btn btn-ghost" type="button" :disabled="sharedLoading" @click="loadSharedPlaces">重试</button></div>
    </section>

    <section id="place-create-form" v-show="showPlaceForm && section === 'mine'" class="place-card place-form">
      <div class="place-section-title"><div><h2>{{ editingPlaceId ? '编辑地点资料' : '添加校园地点' }}</h2><p>{{ editingPlaceId ? '修改公开资料会重新进入审核；私人到访记录会保留。' : '可以先加入自己的清单、记录到访，或直接把地点资料提交校内审核。' }}</p></div><button class="btn btn-ghost" type="button" @click="showPlaceForm = false; resetPlaceForm()">取消</button></div>
      <form @submit.prevent="savePlace">
        <div class="place-form-grid">
          <label>地点名称<input v-model.trim="placeForm.name" maxlength="80" required placeholder="例如：图书馆东区自习室" /></label>
          <label>地点类别<select :value="placeForm.type" @change="setPlaceType($event.target.value)"><option v-for="item in PLACE_TYPES" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <label>校区<input v-model.trim="placeForm.campus" maxlength="100" placeholder="例如：东校区" /></label>
          <label>区域<input v-model.trim="placeForm.area" maxlength="80" placeholder="例如：图书馆二层" /></label>
        <label>相对位置<input v-model.trim="placeForm.placeHint" maxlength="100" placeholder="例如：东侧入口进门右转" /></label>
        <label>开放时间（选填）<input v-model.trim="placeForm.openingHours" maxlength="120" placeholder="例如：工作日 8:00–22:00" /></label>
        </div>
        <fieldset v-if="!editingPlaceId" class="place-intent"><legend>保存方式</legend><button type="button" :aria-pressed="placeSaveMode === 'want'" @click="placeSaveMode = 'want'">仅加入我的清单</button><button type="button" :aria-pressed="placeSaveMode === 'visited'" @click="placeSaveMode = 'visited'">记录到访</button><button type="button" :aria-pressed="placeSaveMode === 'submit'" @click="placeSaveMode = 'submit'">提交校内审核</button></fieldset>
        <div v-if="placeSaveMode === 'visited' && !editingPlaceId" class="place-form-grid visit-inputs">
          <label>到访日期<input v-model="placeForm.visitedAt" type="date" required /></label>
          <label>本次消费（选填）<span class="currency-input"><span>¥</span><input v-model.number="placeForm.price" type="number" min="0" max="100000" step="0.01" inputmode="decimal" /></span></label>
          <label>关联账本记录（选填）<select v-model="placeForm.transactionId"><option value="">暂不关联</option><option v-for="item in eligibleTransactions" :key="item.id" :value="item.id">{{ item.date }} · {{ item.name }} · ¥{{ Number(item.amount || 0).toFixed(2) }}</option></select></label>
        </div>
        <div v-if="placeSaveMode === 'visited' || (editingPlaceId && visitsForPlace(editingPlaceId).length)" class="score-grid">
          <label>综合体验（1–5 分，可选）<select v-model="placeForm.scores.rating"><option :value="undefined">暂不评分</option><option v-for="rating in [1, 2, 3, 4, 5]" :key="rating" :value="rating">{{ rating }} 分</option></select></label>
          <label v-for="field in scoreFields" :key="field.key">{{ field.label }}
            <input v-if="field.type === 'number'" v-model.number="placeForm.scores[field.key]" type="number" :min="field.min" :max="field.max" />
            <select v-else-if="field.type === 'boolean'" v-model="placeForm.scores[field.key]"><option :value="undefined">未记录</option><option :value="true">有</option><option :value="false">无</option></select>
            <select v-else v-model="placeForm.scores[field.key]"><option value="">未记录</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
          </label>
          <label>值不值<select v-model="placeForm.scores.value"><option v-for="item in PLACE_VALUE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        </div>
        <label class="place-note-field">地点简介（提交审核后可能公开）<textarea v-model.trim="placeForm.description" maxlength="500" rows="3" placeholder="补充地点用途、环境或适合人群" /></label>
        <label class="place-note-field">服务、菜单或价格（选填）<textarea v-model.trim="placeForm.serviceInfo" maxlength="500" rows="2" placeholder="按地点类型填写，例如：黑白打印 0.1 元/页" /></label>
        <label class="place-note-field">公开业务联系方式（选填）<input v-model.trim="placeForm.publicContact" maxlength="100" placeholder="仅填商户或学校公开的业务联系方式" /></label>
        <label class="place-note-field">信息来源说明（{{ placeForm.publicContact ? '填写公开联系方式时必填' : '选填' }}）<input v-model.trim="placeForm.sourceInfo" maxlength="160" :required="Boolean(placeForm.publicContact)" placeholder="例如：学校官网、商户公开页面；不会显示为官方认证" /></label>
        <label class="place-note-field">私人备注（最多 50 字，仅本机）<textarea v-model.trim="placeForm.note" maxlength="50" rows="2" placeholder="只给自己看的提醒" /></label>
        <div class="place-form-actions"><span>公开资料需管理员审核。个人到访、消费、账本关联和私人备注不会上传。</span><button class="btn btn-primary" type="submit">{{ editingPlaceId ? '保存修改' : placeSaveMode === 'visited' ? '保存并记到访' : placeSaveMode === 'submit' ? '提交审核' : '加入我的清单' }}</button></div>
      </form>
    </section>

    <section v-if="section === 'mine'" class="place-list">
      <div class="place-list-tools">
        <div><h2>我的地点</h2><p>想去的地点和个人到访记录都保存在本机。</p></div>
        <label class="place-search"><span aria-hidden="true">⌕</span><span class="sr-only">搜索我的地点</span><input v-model.trim="searchQuery" type="search" placeholder="搜名称、校区、区域或服务" /><button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchQuery = ''">清除</button></label>
      </div>
      <div class="place-filter-row" aria-label="按地点类别筛选">
        <button type="button" :aria-pressed="selectedCategory === 'all'" @click="selectedCategory = 'all'; selectedType = 'all'">全部</button>
        <button v-for="item in PLACE_CATEGORIES" :key="item.id" type="button" :aria-pressed="selectedCategory === item.id" @click="selectedCategory = item.id; selectedType = 'all'">{{ item.label }}</button>
      </div>
      <label v-if="selectedCategory !== 'all'" class="type-filter">细分类<select v-model="selectedType"><option value="all">{{ PLACE_CATEGORIES.find((item) => item.id === selectedCategory)?.label }} · 全部</option><option v-for="item in PLACE_TYPES.filter((type) => type.category === selectedCategory)" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <p v-if="!activePlaces.length" class="place-empty"><b>先收下一处想去的地点</b><br />记录名称和校区就能加入清单；去过后再补充体验。</p>
      <p v-else-if="!filteredPlaces.length" class="place-empty">没有匹配记录。试试更短的关键词或清除类别筛选。</p>
      <article v-for="place in filteredPlaces" :key="place.id" class="place-card personal-place-card">
        <header class="place-card-head"><div><span class="type-tag">{{ placeTypeLabel(place) }}</span><h3>{{ place.name }}</h3><p>{{ [place.campus, place.area, place.placeHint].filter(Boolean).join(' · ') || '位置待补充' }}</p></div><span class="privacy-badge">{{ place.visibility === 'school' ? place.reviewStatus === 'pending' ? '待审核' : place.reviewStatus === 'rejected' ? '审核退回' : '校内可见' : visitsForPlace(place.id).length ? '仅本机' : '想去' }}</span></header>
        <p v-if="place.reviewStatus === 'rejected' && place.reviewReason" class="review-reason-note"><b>审核意见：</b>{{ place.reviewReason }}</p>
        <p v-if="visitsForPlace(place.id).length" class="place-scores">{{ scoreSummary(place.scores, place.category) }}</p>
        <p v-if="place.description" class="place-note">{{ place.description }}</p>
        <dl v-if="place.openingHours || place.serviceInfo || place.publicContact || place.sourceInfo" class="discover-facts"><div v-if="place.openingHours"><dt>开放时间</dt><dd>{{ place.openingHours }}</dd></div><div v-if="place.serviceInfo"><dt>服务与价格</dt><dd>{{ place.serviceInfo }}</dd></div><div v-if="place.publicContact"><dt>公开联系方式</dt><dd>{{ place.publicContact }}</dd></div><div v-if="place.sourceInfo"><dt>来源说明</dt><dd>{{ place.sourceInfo }}</dd></div></dl>
        <p v-if="place.note" class="place-note"><span class="private-note-label">私人备注</span>{{ place.note }}</p>
        <p class="place-stats">{{ visitsForPlace(place.id).length ? `${visitsForPlace(place.id).length} 次到访 · ${avgSpend(place.id)}` : '还没有到访记录' }}</p>
        <div v-if="visitsForPlace(place.id).length" class="place-visits">
          <div v-for="visit in visitsForPlace(place.id).slice(0, 3)" :key="visit.id" class="place-visit-row">
            <span>{{ visitDate(visit.visitedAt) }}<small v-if="visit.transactionId"> · 账本：{{ transactionNameById.get(visit.transactionId) || '已关联收支' }}</small></span>
            <span>{{ visit.price === null ? '金额未记' : `¥${Number(visit.price).toFixed(2)}` }}<small> · {{ PLACE_VALUE_OPTIONS.find((item) => item.value === visit.scores.value)?.label || '未评分' }}</small><small v-if="visit.note"> · {{ visit.note }}</small></span>
          </div>
        </div>
        <footer class="place-actions">
          <button class="btn btn-ghost" type="button" @click="editPlace(place)">编辑资料</button>
          <button class="btn btn-ghost" type="button" @click="openVisit(place)">{{ visitsForPlace(place.id).length ? '记一次到访' : '记录已到访' }}</button>
          <button class="btn btn-ghost" type="button" :disabled="busyAction === `share-${place.id}`" @click="changeVisibility(place)">{{ place.visibility === 'school' ? '撤回校内投稿' : place.reviewStatus === 'rejected' ? '修改并重新提交' : '提交校内审核' }}</button>
          <button class="btn btn-ghost" type="button" @click="offerPlaceId = place.id; offerFormOpen = true; section = 'offers'">添加优惠</button>
          <button class="btn btn-ghost" type="button" @click="archivePlace(place)">归档</button>
          <button class="btn btn-danger" type="button" :disabled="Boolean(busyAction)" @click="removePlace(place)">删除自己的记录</button>
        </footer>
      </article>
      <details v-if="archivedPlaces.length" class="archived-places"><summary>已归档地点 {{ archivedPlaces.length }} 家</summary><div v-for="place in archivedPlaces" :key="place.id" class="archived-place-row"><span>{{ place.name }}</span><button class="btn btn-ghost" type="button" @click="restorePlace(place)">恢复</button><button class="btn btn-danger" type="button" @click="removePlace(place)">删除</button></div></details>
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
      <div class="place-section-title"><div><h2 id="place-visit-title">记一次到访 · {{ visitTarget?.name }}</h2><p>日期、金额、账本关联和私人备注只保存在本机；公开短评需要单独开启。</p></div><button class="btn btn-ghost" type="button" @click="showVisitForm = false">关闭</button></div>
      <div class="place-form-grid"><label>到访日期<input v-model="visitForm.visitedAt" type="date" required /></label><label>消费金额（可选）<input v-model.number="visitForm.price" type="number" min="0" max="100000" step="0.01" /></label><label>关联收支（可选）<select v-model="visitForm.transactionId"><option value="">暂不关联</option><option v-for="item in eligibleTransactions" :key="item.id" :value="item.id">{{ item.date }} · {{ item.name }} · ¥{{ Number(item.amount || 0).toFixed(2) }}</option></select></label></div>
      <div class="score-grid"><label>综合体验（1–5 分，可选）<select v-model="visitForm.scores.rating"><option :value="undefined">暂不评分</option><option v-for="rating in [1, 2, 3, 4, 5]" :key="rating" :value="rating">{{ rating }} 分</option></select></label><label v-for="field in visitScoreFields" :key="field.key">{{ field.label }}<input v-if="field.type === 'number'" v-model.number="visitForm.scores[field.key]" type="number" :min="field.min" :max="field.max" /><select v-else-if="field.type === 'boolean'" :value="visitForm.scores[field.key] === undefined ? '' : String(visitForm.scores[field.key])" @change="setVisitScore(field.key, $event.target.value === '' ? undefined : $event.target.value === 'true')"><option value="">未记录</option><option value="true">有</option><option value="false">无</option></select><select v-else v-model="visitForm.scores[field.key]"><option value="">未记录</option><option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label>值不值<select v-model="visitForm.scores.value"><option v-for="item in PLACE_VALUE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select></label></div>
      <label>私人到访备注（最多 50 字，仅本机）<textarea v-model="visitForm.note" maxlength="50" rows="2" /></label>
      <label class="review-share-toggle"><input v-model="visitForm.shareReview" type="checkbox" /><span><b>另写一条校内公开短评</b><small>默认关闭；公开内容将和评分一起显示给同校学生。</small></span></label>
      <label v-if="visitForm.shareReview">公开短评（最多 50 字）<textarea v-model.trim="visitForm.publicNote" maxlength="50" rows="2" placeholder="只写与地点体验有关的信息" /></label>
      <div class="place-form-actions"><span>结构化评分会公开；公开短评仅在你单独开启并填写时提交。</span><button class="btn btn-primary" type="submit" :disabled="Boolean(busyAction)">{{ busyAction ? '保存中…' : '保存到访' }}</button></div>
    </form>
  </div>
</template>

<style scoped src="./places.css"></style>
