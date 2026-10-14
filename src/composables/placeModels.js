import { MAX_LEDGER_AMOUNT, normalizeAmount } from './ledgerAmount.js'

const VALUE_OPTIONS = Object.freeze([
  { value: 'worth', label: '值' },
  { value: 'mixed', label: '看情况' },
  { value: 'not-worth', label: '不值' },
])

const SCALE_OPTIONS = Object.freeze([
  { value: 'low', label: '偏低' },
  { value: 'medium', label: '一般' },
  { value: 'high', label: '较好' },
])

const PRICE_OPTIONS = Object.freeze([
  { value: 'budget', label: '便宜' },
  { value: 'fair', label: '适中' },
  { value: 'expensive', label: '偏贵' },
])

export const PLACE_CATEGORIES = Object.freeze([
  { id: 'food', label: '吃喝' },
  { id: 'service', label: '生活服务' },
  { id: 'study', label: '学习空间' },
  { id: 'transport', label: '出行' },
  { id: 'trade', label: '买卖' },
  { id: 'social', label: '休闲社交' },
])

/** Detailed discovery types share the existing broad rating templates. */
export const PLACE_TYPES = Object.freeze([
  { id: 'teaching-building', label: '教学楼', category: 'study' },
  { id: 'library', label: '图书馆', category: 'study' },
  { id: 'study-room', label: '自习室', category: 'study' },
  { id: 'laboratory', label: '实验楼', category: 'study' },
  { id: 'cafeteria', label: '食堂', category: 'food' },
  { id: 'restaurant', label: '餐厅', category: 'food' },
  { id: 'tea-shop', label: '奶茶店', category: 'food' },
  { id: 'coffee-shop', label: '咖啡店', category: 'food' },
  { id: 'supermarket', label: '超市', category: 'trade' },
  { id: 'convenience-store', label: '便利店', category: 'trade' },
  { id: 'campus-shop', label: '校园商店', category: 'trade' },
  { id: 'printing', label: '打印复印', category: 'service' },
  { id: 'parcel-station', label: '快递站', category: 'service' },
  { id: 'sports', label: '体育场馆', category: 'social' },
  { id: 'recreation', label: '休闲社交', category: 'social' },
  { id: 'dorm-facility', label: '宿舍设施', category: 'service' },
  { id: 'medical', label: '医疗服务', category: 'service' },
  { id: 'administration', label: '行政办事', category: 'service' },
  { id: 'shuttle-stop', label: '校车站点', category: 'transport' },
  { id: 'scenic', label: '校园景点', category: 'social' },
  { id: 'campus-edge-shop', label: '校园周边', category: 'trade' },
  { id: 'other', label: '其他校园服务', category: 'service' },
])

export const PLACE_SCORE_FIELDS = Object.freeze({
  food: Object.freeze([
    { key: 'spice', label: '辣度', type: 'select', options: [{ value: 'none', label: '不辣' }, { value: 'mild', label: '微辣' }, { value: 'medium', label: '中辣' }, { value: 'hot', label: '很辣' }] },
    { key: 'portion', label: '分量', type: 'select', options: [{ value: 'small', label: '不够' }, { value: 'right', label: '刚好' }, { value: 'large', label: '吃撑' }] },
    { key: 'speed', label: '上菜速度', type: 'select', options: SCALE_OPTIONS },
    { key: 'price', label: '价格档', type: 'select', options: PRICE_OPTIONS },
    { key: 'takeout', label: '可以打包', type: 'boolean' },
  ]),
  service: Object.freeze([
    { key: 'price', label: '价格档', type: 'select', options: PRICE_OPTIONS },
    { key: 'waitMinutes', label: '等待时间（分钟）', type: 'number', min: 0, max: 240 },
    { key: 'skill', label: '技术', type: 'select', options: SCALE_OPTIONS },
    { key: 'attitude', label: '态度', type: 'select', options: SCALE_OPTIONS },
    { key: 'studentDiscount', label: '有学生优惠', type: 'boolean' },
  ]),
  study: Object.freeze([
    { key: 'outlets', label: '插座', type: 'select', options: [{ value: 'none', label: '没有' }, { value: 'some', label: '少量' }, { value: 'many', label: '充足' }] },
    { key: 'noise', label: '噪音', type: 'select', options: [{ value: 'quiet', label: '安静' }, { value: 'some', label: '偶尔吵' }, { value: 'noisy', label: '较吵' }] },
    { key: 'lighting', label: '灯光', type: 'select', options: SCALE_OPTIONS },
    { key: 'aircon', label: '空调', type: 'select', options: SCALE_OPTIONS },
    { key: 'spend', label: '人均消费（元）', type: 'number', min: 0, max: 1000 },
    { key: 'seatStability', label: '座位稳定性', type: 'select', options: [{ value: 'stable', label: '通常有位' }, { value: 'varies', label: '看时段' }, { value: 'hard', label: '经常满座' }] },
  ]),
  transport: Object.freeze([
    { key: 'waitMinutes', label: '等待时间（分钟）', type: 'number', min: 0, max: 240 },
    { key: 'reliability', label: '准点情况', type: 'select', options: SCALE_OPTIONS },
    { key: 'price', label: '价格档', type: 'select', options: PRICE_OPTIONS },
  ]),
  trade: Object.freeze([
    { key: 'price', label: '价格档', type: 'select', options: PRICE_OPTIONS },
    { key: 'quality', label: '质量', type: 'select', options: SCALE_OPTIONS },
    { key: 'waitMinutes', label: '等待时间（分钟）', type: 'number', min: 0, max: 240 },
    { key: 'studentDiscount', label: '有学生优惠', type: 'boolean' },
  ]),
  social: Object.freeze([
    { key: 'price', label: '花费', type: 'select', options: PRICE_OPTIONS },
    { key: 'noise', label: '环境音量', type: 'select', options: [{ value: 'quiet', label: '安静' }, { value: 'some', label: '适中' }, { value: 'noisy', label: '热闹' }] },
    { key: 'accessibility', label: '到达方便', type: 'select', options: SCALE_OPTIONS },
  ]),
})

export const PLACE_VALUE_OPTIONS = VALUE_OPTIONS

const PLACE_CATEGORY_IDS = new Set(PLACE_CATEGORIES.map(({ id }) => id))
const PLACE_TYPE_BY_ID = new Map(PLACE_TYPES.map((type) => [type.id, type]))
const PLACE_DEFAULT_TYPE = Object.freeze({
  food: 'restaurant', service: 'other', study: 'library',
  transport: 'shuttle-stop', trade: 'campus-shop', social: 'recreation',
})
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function text(value, max, label, required = false) {
  const normalized = Array.from(String(value ?? '').trim()).slice(0, max).join('')
  if (required && !normalized) throw new Error(`${label}不能为空。`)
  return normalized
}

export function createPlaceId() {
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function normalizePlaceScores(category, value = {}) {
  if (!PLACE_CATEGORY_IDS.has(category)) throw new Error('地点类型无效。')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('评分格式不正确。')
  const result = {}
  for (const field of PLACE_SCORE_FIELDS[category]) {
    if (value[field.key] === undefined || value[field.key] === null || value[field.key] === '') continue
    if (field.type === 'boolean') {
      if (typeof value[field.key] === 'boolean') result[field.key] = value[field.key]
      else if (value[field.key] === 'true' || value[field.key] === 'false') result[field.key] = value[field.key] === 'true'
      else throw new Error(`${field.label}格式不正确。`)
    } else if (field.type === 'number') {
      const number = Number(value[field.key])
      if (!Number.isFinite(number) || number < field.min || number > field.max) throw new Error(`${field.label}格式不正确。`)
      result[field.key] = number
    } else {
      if (!field.options.some((option) => option.value === value[field.key])) throw new Error(`${field.label}格式不正确。`)
      result[field.key] = value[field.key]
    }
  }
  const score = value.value ?? 'mixed'
  if (!VALUE_OPTIONS.some((option) => option.value === score)) throw new Error('“值不值”评分格式不正确。')
  result.value = score
  if (value.rating !== undefined && value.rating !== null && value.rating !== '') {
    const rating = Number(value.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('综合评分须为 1 至 5 分。')
    result.rating = rating
  }
  return result
}

export function normalizePlaceRecord(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地点档案格式不正确。')
  const requestedType = PLACE_TYPE_BY_ID.get(value.type)
  const category = PLACE_CATEGORY_IDS.has(value.category) ? value.category : requestedType?.category || 'food'
  const type = requestedType?.category === category ? requestedType.id : PLACE_DEFAULT_TYPE[category]
  return {
    id: text(value.id || createPlaceId(), 64, '地点编号', true),
    name: text(value.name, 80, '地点名称', true),
    campus: text(value.campus, 100, '校区'),
    area: text(value.area, 80, '区域'),
    placeHint: text(value.placeHint, 100, '相对位置'),
    type,
    category,
    ratingTemplateId: category,
    scores: normalizePlaceScores(category, value.scores || {}),
    note: text(value.note, 50, '备注'),
    description: text(value.description, 500, '地点简介'),
    openingHours: text(value.openingHours, 120, '开放时间'),
    serviceInfo: text(value.serviceInfo, 500, '服务与价格'),
    publicContact: text(value.publicContact, 100, '公开业务联系方式'),
    sourceInfo: text(value.sourceInfo, 160, '信息来源'),
    archivedAt: value.archivedAt ? String(value.archivedAt) : null,
    createdAt: value.createdAt ? String(value.createdAt) : new Date().toISOString(),
    updatedAt: value.updatedAt ? String(value.updatedAt) : new Date().toISOString(),
    visibility: value.visibility === 'school' ? 'school' : 'private',
    reviewStatus: ['pending', 'approved', 'rejected'].includes(value.reviewStatus)
      ? value.reviewStatus : value.visibility === 'school' ? 'approved' : 'not_submitted',
    reviewReason: text(value.reviewReason, 500, '审核说明'),
  }
}

export function normalizePlaceVisit(value = {}, category = value?.category || 'food') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('到访记录格式不正确。')
  const placeId = text(value.placeId, 64, '地点编号', true)
  const rawDate = String(value.visitedAt || '').trim()
  let visitedAt
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) visitedAt = `${rawDate}T12:00:00.000Z`
  else {
    const parsed = Date.parse(rawDate)
    if (!Number.isFinite(parsed)) throw new Error('到访日期格式不正确。')
    visitedAt = new Date(parsed).toISOString()
  }
  const rawPrice = value.price === '' || value.price === null || value.price === undefined ? null : value.price
  const price = rawPrice === null ? null : normalizeAmount(rawPrice)
  if (rawPrice !== null && (price === null || price < 0 || price > MAX_LEDGER_AMOUNT)) throw new Error('消费金额格式不正确。')
  return {
    id: text(value.id || createPlaceId(), 64, '到访编号', true),
    placeId,
    visitedAt,
    price,
    scores: normalizePlaceScores(category, value.scores || {}),
    transactionId: text(value.transactionId, 100, '收支编号'),
    ...(value.note ? { note: text(value.note, 50, '到访备注') } : {}),
    createdAt: value.createdAt ? String(value.createdAt) : new Date().toISOString(),
  }
}

export function normalizePlaceOffer(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('优惠记录格式不正确。')
  const price = normalizeAmount(value.price)
  const rawOriginalPrice = value.originalPrice === '' || value.originalPrice === null || value.originalPrice === undefined
    ? null : value.originalPrice
  const originalPrice = rawOriginalPrice === null ? null : normalizeAmount(rawOriginalPrice)
  if (price === null || price <= 0 || price > MAX_LEDGER_AMOUNT) throw new Error('核销金额必须大于 0。')
  if (rawOriginalPrice !== null && (originalPrice === null || originalPrice < price || originalPrice > MAX_LEDGER_AMOUNT)) throw new Error('原价格式不正确。')
  const expiresAt = text(value.expiresAt, 10, '有效期')
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new Error('有效期格式不正确。')
  return {
    id: text(value.id || createPlaceId(), 64, '优惠编号', true),
    placeId: text(value.placeId, 64, '地点编号', true),
    title: text(value.title, 60, '优惠名称', true),
    note: text(value.note, 50, '优惠说明'),
    price,
    originalPrice,
    expiresAt,
    status: value.status === 'redeemed' ? 'redeemed' : 'active',
    transactionId: text(value.transactionId, 100, '收支编号'),
    noticeId: text(value.noticeId, 100, '通知编号'),
    createdAt: value.createdAt ? String(value.createdAt) : new Date().toISOString(),
  }
}

export function toSchoolPlacePayload(value) {
  const place = normalizePlaceRecord(value)
  if (place.visibility !== 'school') throw new Error('仅本机地点不会上传。')
  if (!UUID_RE.test(place.id)) throw new Error('地点编号无效，请重新保存后再分享。')
  return {
    id: place.id,
    name: place.name,
    campus: place.campus,
    area: place.area,
    placeHint: place.placeHint,
    type: place.type,
    category: place.category,
    ratingTemplateId: place.ratingTemplateId,
    description: place.description,
    openingHours: place.openingHours,
    serviceInfo: place.serviceInfo,
    publicContact: place.publicContact,
    sourceInfo: place.sourceInfo,
    visibility: 'school',
  }
}

/**
 * 好友预设是用户主动创建的分享副本，只携带地点识别信息与结构化评分。
 * 备注、到访、消费、优惠和账本关联留在原设备，不进入邀请请求。
 */
export function toPlaceInvitePayload(value) {
  const place = normalizePlaceRecord(value)
  if (!UUID_RE.test(place.id)) throw new Error('地点编号无效，暂时不能加入好友预设。')
  return {
    id: place.id,
    name: place.name,
    campus: place.campus,
    area: place.area,
    placeHint: place.placeHint,
    type: place.type,
    category: place.category,
    ratingTemplateId: place.ratingTemplateId,
    scores: place.scores,
  }
}

/** Place references and local offer links include personal context, so none leave in an account snapshot. */
export function projectAccountSyncValues(values) {
  const result = JSON.parse(JSON.stringify(values || {}))
  if (Array.isArray(result.sl_expenses)) {
    result.sl_expenses = result.sl_expenses.map((transaction) => {
      if (!transaction || typeof transaction !== 'object' || !transaction.placeId) return transaction
      const { placeId: _privatePlaceId, ...safeTransaction } = transaction
      return safeTransaction
    })
  }
  if (Array.isArray(result.sl_notices)) {
    result.sl_notices = result.sl_notices.map((notice) => {
      if (!notice || typeof notice !== 'object') return notice
      const safeNotice = { ...notice }
      if (Array.isArray(safeNotice.linkedEntities)) {
        safeNotice.linkedEntities = safeNotice.linkedEntities.filter((link) => link?.type !== 'place-offer')
      }
      if (safeNotice.linkedEntityType === 'place-offer') {
        safeNotice.linkedEntityType = ''
        safeNotice.linkedEntityId = ''
      }
      return safeNotice
    })
  }
  return result
}

/** Keep this device's personal associations after cloud transactions are merged. */
export function restoreLocalPlaceLinks(localValues, mergedValues) {
  const localLinks = new Map((Array.isArray(localValues?.sl_expenses) ? localValues.sl_expenses : [])
    .filter((item) => item?.placeId)
    .map((item) => [String(item.id), String(item.placeId)]))
  const localOffersByNotice = new Map((Array.isArray(localValues?.sl_notices) ? localValues.sl_notices : [])
    .map((notice) => {
      const links = Array.isArray(notice?.linkedEntities) ? notice.linkedEntities
        : notice?.linkedEntityType && notice?.linkedEntityId ? [{ type: notice.linkedEntityType, id: notice.linkedEntityId }] : []
      return [String(notice?.id || ''), links.filter((link) => link?.type === 'place-offer')]
    })
    .filter(([id, links]) => id && links.length))
  let result = mergedValues
  if (localLinks.size && Array.isArray(mergedValues?.sl_expenses)) {
    result = {
      ...result,
      sl_expenses: mergedValues.sl_expenses.map((item) => !localLinks.has(String(item?.id))
        ? item : { ...item, placeId: localLinks.get(String(item.id)) }),
    }
  }
  if (localOffersByNotice.size && Array.isArray(mergedValues?.sl_notices)) {
    result = {
      ...result,
      sl_notices: mergedValues.sl_notices.map((notice) => {
        const localLinksForNotice = localOffersByNotice.get(String(notice?.id || ''))
        if (!localLinksForNotice?.length) return notice
        const links = Array.isArray(notice?.linkedEntities) ? notice.linkedEntities
          : notice?.linkedEntityType && notice?.linkedEntityId ? [{ type: notice.linkedEntityType, id: notice.linkedEntityId }] : []
        const combined = new Map([...links, ...localLinksForNotice]
          .filter((link) => link?.type && link?.id)
          .map((link) => [`${link.type}:${link.id}`, { type: String(link.type), id: String(link.id) }]))
        return { ...notice, linkedEntities: [...combined.values()] }
      }),
    }
  }
  return result
}

export function isUuid(value) {
  return UUID_RE.test(String(value || ''))
}
