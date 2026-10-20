import { clock, useStoredRef } from './store/core.js'
import { createId as createNoticeId } from '../utils/ids.js'
import { normalizeNoticeRecord } from './noticeArchiveModel.js'

export const NOTICE_STORAGE_KEY = 'sl_notices'
export const NOTICE_SOURCE_STORAGE_KEY = 'sl_notice_sources'
/** @type {import('vue').Ref<Array<ReturnType<typeof normalizeNoticeRecord>>>} */
export const notices = useStoredRef(NOTICE_STORAGE_KEY, /** @type {Array<ReturnType<typeof normalizeNoticeRecord>>} */ ([]))
/** @type {import('vue').Ref<Array<{id: string, source: string, muted: boolean, updatedAt: string}>>} */
export const noticeSources = useStoredRef(NOTICE_SOURCE_STORAGE_KEY, /** @type {Array<{id: string, source: string, muted: boolean, updatedAt: string}>} */ ([]))

function nowIso() {
  return (clock.value instanceof Date ? clock.value : new Date()).toISOString()
}

export function createNoticeRecord(value = {}) {
  const raw = String(value.raw || '').trim()
  if (!raw) throw new Error('通知原文为空，未能保存到档案。')
  const record = normalizeNoticeRecord({
    ...value,
    id: value.id || createNoticeId(),
    raw,
    title: value.title || raw.split(/\r?\n/).find(Boolean) || '未命名通知',
    status: value.status || 'new',
    createdAt: value.createdAt || nowIso(),
  })
  notices.value = [record, ...notices.value.filter((item) => item?.id !== record.id)]
  return record
}

export function setNoticeStatus(id, status) {
  if (!['new', 'handled', 'archived'].includes(status)) return null
  const current = notices.value.find((item) => item.id === id)
  if (!current) return null
  const updatedAt = nowIso()
  notices.value = notices.value.map((item) => item.id === id ? { ...item, status, updatedAt } : item)
  return { ...current, status, updatedAt }
}

export function addNoticeLink(id, entityType, entityId) {
  const type = String(entityType || '').trim()
  const linkedId = String(entityId || '').trim()
  const current = notices.value.find((item) => item.id === id)
  if (!current || !type || !linkedId) return null
  const links = Array.isArray(current.linkedEntities) ? current.linkedEntities : []
  const exists = links.some((item) => item.type === type && item.id === linkedId)
  const updatedAt = nowIso()
  const next = {
    ...current,
    status: 'handled',
    linkedEntities: exists ? links : [...links, { type, id: linkedId }],
    updatedAt,
  }
  notices.value = notices.value.map((item) => item.id === id ? next : item)
  return next
}

export function removeNoticeRecord(id) {
  if (!notices.value.some((item) => item?.id === id)) return false
  notices.value = notices.value.filter((item) => item?.id !== id)
  return true
}

export function setNoticeSourceMuted(source, muted) {
  const name = String(source || '').trim()
  if (!name) return false
  const existing = noticeSources.value.find((item) => item.source === name)
  if (existing) {
    noticeSources.value = noticeSources.value.map((item) => item.source === name ? { ...item, muted: Boolean(muted), updatedAt: nowIso() } : item)
  } else if (muted) {
    noticeSources.value = [...noticeSources.value, { id: `source-${createNoticeId()}`, source: name, muted: true, updatedAt: nowIso() }]
  }
  return true
}
