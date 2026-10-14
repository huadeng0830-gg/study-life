import { useStoredRef, touchStoredRef } from './store/index.js'
import { createPlaceId, normalizePlaceOffer, normalizePlaceRecord, normalizePlaceVisit, toPlaceInvitePayload } from './placeModels.js'

const PLACES_STORAGE_KEY = 'sl_places'
const PLACE_VISITS_STORAGE_KEY = 'sl_place_visits'
const PLACE_OFFERS_STORAGE_KEY = 'sl_place_offers'
export const PLACE_STORAGE_KEYS = Object.freeze({
  places: PLACES_STORAGE_KEY,
  visits: PLACE_VISITS_STORAGE_KEY,
  offers: PLACE_OFFERS_STORAGE_KEY,
})

export const places = useStoredRef(PLACE_STORAGE_KEYS.places, /** @type {import('../types/domain').PlaceRecord[]} */ ([]), { deep: false })
export const placeVisits = useStoredRef(PLACE_STORAGE_KEYS.visits, /** @type {import('../types/domain').PlaceVisit[]} */ ([]), { deep: false })
export const placeOffers = useStoredRef(PLACE_STORAGE_KEYS.offers, /** @type {import('../types/domain').PlaceOffer[]} */ ([]), { deep: false })

function commit(key) {
  if (key === PLACE_STORAGE_KEYS.places) touchStoredRef(PLACES_STORAGE_KEY)
  else if (key === PLACE_STORAGE_KEYS.visits) touchStoredRef(PLACE_VISITS_STORAGE_KEY)
  else if (key === PLACE_STORAGE_KEYS.offers) touchStoredRef(PLACE_OFFERS_STORAGE_KEY)
}
function stamp() { return new Date().toISOString() }

export function visitsForPlace(placeId) {
  return placeVisits.value.filter((visit) => String(visit.placeId) === String(placeId))
    .sort((left, right) => String(right.visitedAt).localeCompare(String(left.visitedAt)))
}

export function offersForPlace(placeId) {
  return placeOffers.value.filter((offer) => String(offer.placeId) === String(placeId))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

function transactionForPlaceVisit(visit, place) {
  if (!visit.transactionId) return null
  const transactions = useStoredRef('sl_expenses', /** @type {import('../types/domain').Transaction[]} */ ([]), { deep: false })
  const transaction = transactions.value.find((item) => String(item.id) === String(visit.transactionId))
  if (!transaction) throw new Error('关联的账本记录已不存在。')
  if (transaction.placeId && String(transaction.placeId) !== String(place.id)) throw new Error('这笔账本记录已经关联到另一地点。')
  if (placeVisits.value.some((item) => String(item.transactionId) === String(transaction.id))) throw new Error('这笔账本记录已经对应一条到访。')
  return transaction
}

export function createPlaceWithVisit(placeValue, visitValue) {
  const now = stamp()
  const place = normalizePlaceRecord({ ...placeValue, id: placeValue?.id || createPlaceId(), createdAt: now, updatedAt: now, visibility: placeValue?.visibility || 'private' })
  if (places.value.some((item) => String(item.id) === place.id)) throw new Error('这个地点已存在。')
  const visit = normalizePlaceVisit({ ...visitValue, id: visitValue?.id || createPlaceId(), placeId: place.id, category: place.category, createdAt: now })
  const transaction = transactionForPlaceVisit(visit, place)
  places.value.push(place)
  placeVisits.value.push(visit)
  commit(PLACE_STORAGE_KEYS.places)
  commit(PLACE_STORAGE_KEYS.visits)
  linkVisitTransaction(visit, place, transaction)
  return { place, visit }
}

/** 将接收方明确接受的预设作为无到访历史的本机私密副本导入，重复重试不会覆盖用户自己的记录。 */
export function importPlacePreset(values = []) {
  if (!Array.isArray(values) || values.length > 50) throw new Error('好友预设内容无效。')
  const now = stamp()
  const incoming = values.map((value) => normalizePlaceRecord({
    ...toPlaceInvitePayload(value),
    note: '',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    visibility: 'private',
  }))
  const incomingIds = new Set()
  for (const place of incoming) {
    if (incomingIds.has(place.id)) throw new Error('好友预设包含重复地点。')
    incomingIds.add(place.id)
  }
  const existingIds = new Set(places.value.map((place) => String(place.id)))
  const added = incoming.filter((place) => !existingIds.has(String(place.id)))
  if (added.length) {
    places.value = [...places.value, ...added]
    commit(PLACE_STORAGE_KEYS.places)
  }
  return { imported: added.length, skipped: incoming.length - added.length }
}

function linkVisitTransaction(visit, place, transaction) {
  if (!transaction) return
  transaction.placeId = place.id
  transaction.updatedAt = stamp()
  commit('sl_expenses')
}

export function addPlaceVisit(placeId, visitValue = {}) {
  const place = places.value.find((item) => String(item.id) === String(placeId) && !item.archivedAt)
  if (!place) throw new Error('地点不存在或已归档。')
  const now = stamp()
  const visit = normalizePlaceVisit({ ...visitValue, id: visitValue.id || createPlaceId(), placeId: place.id, category: place.category, createdAt: now })
  const transaction = transactionForPlaceVisit(visit, place)
  placeVisits.value.push(visit)
  place.scores = { ...visit.scores }
  place.updatedAt = now
  commit(PLACE_STORAGE_KEYS.visits)
  commit(PLACE_STORAGE_KEYS.places)
  linkVisitTransaction(visit, place, transaction)
  return visit
}

export function removePlaceVisit(visitId) {
  const visit = placeVisits.value.find((item) => String(item.id) === String(visitId))
  if (!visit) return null
  placeVisits.value = placeVisits.value.filter((item) => String(item.id) !== String(visitId))
  commit(PLACE_STORAGE_KEYS.visits)
  return visit
}

export function removePlaceVisitsForTransaction(transactionId) {
  const removed = placeVisits.value.filter((item) => String(item.transactionId) === String(transactionId))
  if (!removed.length) return []
  const removedIds = new Set(removed.map((item) => String(item.id)))
  placeVisits.value = placeVisits.value.filter((item) => !removedIds.has(String(item.id)))
  commit(PLACE_STORAGE_KEYS.visits)
  return removed
}

export function updatePlace(placeId, patch = {}) {
  const index = places.value.findIndex((item) => String(item.id) === String(placeId))
  if (index < 0) return null
  const current = places.value[index]
  const next = normalizePlaceRecord({ ...current, ...patch, id: current.id, updatedAt: stamp() })
  places.value[index] = next
  commit(PLACE_STORAGE_KEYS.places)
  return next
}

export function setPlaceArchived(placeId, archived = true) {
  const place = places.value.find((item) => String(item.id) === String(placeId))
  if (!place) return null
  place.archivedAt = archived ? stamp() : null
  place.updatedAt = stamp()
  commit(PLACE_STORAGE_KEYS.places)
  return place
}

export function deletePlaceLocally(placeId) {
  const place = places.value.find((item) => String(item.id) === String(placeId))
  if (!place) return null
  places.value = places.value.filter((item) => String(item.id) !== String(placeId))
  placeVisits.value = placeVisits.value.filter((item) => String(item.placeId) !== String(placeId))
  placeOffers.value = placeOffers.value.filter((item) => String(item.placeId) !== String(placeId))
  commit(PLACE_STORAGE_KEYS.places)
  commit(PLACE_STORAGE_KEYS.visits)
  commit(PLACE_STORAGE_KEYS.offers)
  const transactions = useStoredRef('sl_expenses', /** @type {import('../types/domain').Transaction[]} */ ([]), { deep: false })
  let changed = false
  for (const transaction of transactions.value) {
    if (String(transaction.placeId || '') !== String(placeId)) continue
    delete transaction.placeId
    changed = true
  }
  if (changed) commit('sl_expenses')
  return place
}

export function createPlaceOffer(value = {}) {
  const place = places.value.find((item) => String(item.id) === String(value.placeId) && !item.archivedAt)
  if (!place) throw new Error('请先选择有效地点。')
  const offer = normalizePlaceOffer({ ...value, id: value.id || createPlaceId(), createdAt: stamp() })
  placeOffers.value.push(offer)
  commit(PLACE_STORAGE_KEYS.offers)
  return offer
}

export function markPlaceOfferRedeemed(offerId, transactionId) {
  const offer = placeOffers.value.find((item) => String(item.id) === String(offerId) && item.status === 'active')
  if (!offer) return null
  offer.status = 'redeemed'
  offer.transactionId = String(transactionId || '')
  commit(PLACE_STORAGE_KEYS.offers)
  return offer
}

export function rollbackPlaceOfferRedemption(offerId, transactionId) {
  const offer = placeOffers.value.find((item) => String(item.id) === String(offerId)
    && item.status === 'redeemed' && String(item.transactionId) === String(transactionId))
  if (!offer) return null
  offer.status = 'active'
  offer.transactionId = ''
  commit(PLACE_STORAGE_KEYS.offers)
  return offer
}

export function deletePlaceOffer(offerId) {
  const offer = placeOffers.value.find((item) => String(item.id) === String(offerId))
  if (!offer) return null
  placeOffers.value = placeOffers.value.filter((item) => String(item.id) !== String(offerId))
  commit(PLACE_STORAGE_KEYS.offers)
  return offer
}
