/** @type {Readonly<Record<string, {label: string, icon: string}>>} */
export const LIST_TYPES = Object.freeze({
  general: { label: '通用清单', icon: '🗒️' },
  shopping: { label: '购物采购', icon: '🛒' },
  travel: { label: '出行准备', icon: '🧳' },
  chores: { label: '家务整理', icon: '🧹' },
  packing: { label: '物品准备', icon: '🎒' },
})

export const CHECKLIST_CATEGORIES = ['食品', '日用品', '学习用品', '数码', '衣物', '证件', '洗护', '其他']
export const CHECKLIST_UNITS = ['件', '个', '份', '袋', '盒', '瓶', '斤', 'kg']
export const MAX_BATCH_ITEMS = 200

export const CHECKLIST_TEMPLATES = [
  {
    id: 'weekly', name: '每周采购', type: 'shopping', description: '食品和日用品，按需补货',
    items: [{ name: '牛奶', category: '食品', unit: '盒' }, { name: '鸡蛋', category: '食品', unit: '盒' }, { name: '水果', category: '食品', unit: '份' }, { name: '蔬菜', category: '食品', unit: '份' }, { name: '纸巾', category: '日用品', unit: '包' }],
  },
  {
    id: 'travel', name: '短途出行', type: 'travel', description: '出发前检查随身物品',
    items: [{ name: '身份证', category: '证件' }, { name: '手机和充电器', category: '数码' }, { name: '充电宝', category: '数码' }, { name: '换洗衣物', category: '衣物' }, { name: '洗漱用品', category: '洗护' }, { name: '雨伞', category: '日用品' }],
  },
  {
    id: 'school', name: '返校准备', type: 'packing', description: '学习用品和宿舍生活用品',
    items: [{ name: '校园卡', category: '证件' }, { name: '课本和笔记本', category: '学习用品' }, { name: '文具', category: '学习用品' }, { name: '电脑和充电器', category: '数码' }, { name: '床上用品', category: '日用品' }, { name: '换洗衣物', category: '衣物' }],
  },
  {
    id: 'room', name: '房间整理', type: 'chores', description: '拆成小事，逐项完成',
    items: [{ name: '整理桌面' }, { name: '收纳衣物' }, { name: '清理冰箱' }, { name: '清扫地面' }, { name: '清倒垃圾' }],
  },
]

/** @param {Partial<import('../../types/checklists').Checklist> | null | undefined} list */
export function checklistItems(list) {
  return Array.isArray(list?.items) ? list.items.filter((item) => item && typeof item === 'object') : []
}

/** @param {import('../../types/checklists').ChecklistItemInput | null | undefined} item */
export function checklistItemName(item) {
  return String(item?.name ?? item?.text ?? item?.title ?? '')
}

/** @param {import('../../types/checklists').ChecklistItemInput | null | undefined} item */
export function checklistQuantity(item) {
  const quantity = Number(item?.quantity ?? 1)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

/** @param {number | string | null | undefined} value */
function optionalAmount(value, label) {
  if (value === '' || value === null || value === undefined || String(value).trim() === '') return ''
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 100000000) throw new Error(`${label}须为 0 到 100000000 之间的数字`)
  return Math.round((number + Number.EPSILON) * 100) / 100
}

/** @param {number | string | null | undefined} value */
export function checklistBudget(value) {
  return optionalAmount(value, '预算')
}

/** @param {import('../../types/checklists').ChecklistItemInput} value */
export function normalizeChecklistItem(value = {}) {
  const name = checklistItemName(value).trim()
  if (!name) throw new Error('请填写事项名称')
  if (name.length > 120) throw new Error('事项名称不能超过 120 个字符')
  const quantity = Number(value.quantity ?? 1)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error('数量须大于 0，且不超过 1000000')
  return {
    ...value, name, quantity, price: optionalAmount(value.price, '单价'),
    unit: String(value.unit ?? '件').trim() || '件',
    category: String(value.category ?? '其他').trim() || '其他',
    note: String(value.note ?? '').trim(), done: Boolean(value.done),
  }
}

/** @param {import('../../types/checklists').ChecklistItemInput | null | undefined} item */
export function checklistAmount(item) {
  if (item?.price === '' || item?.price === null || item?.price === undefined || String(item.price).trim() === '') return null
  const price = Number(item.price)
  if (!Number.isFinite(price) || price < 0) return null
  const amount = price * checklistQuantity(item)
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : null
}

/** @param {Partial<import('../../types/checklists').Checklist> | null | undefined} list */
export function summarizeChecklist(list) {
  const items = checklistItems(list)
  let done = 0
  let totalCents = 0
  let boughtCents = 0
  let unpricedCount = 0
  let pendingUnpricedCount = 0
  for (const item of items) {
    if (item.done) done += 1
    const amount = checklistAmount(item)
    if (amount === null) {
      unpricedCount += 1
      if (!item.done) pendingUnpricedCount += 1
    } else {
      const cents = Math.round(amount * 100)
      totalCents += cents
      if (item.done) boughtCents += cents
    }
  }
  const count = items.length
  const rawBudget = list?.budget
  const budget = rawBudget === '' || rawBudget === null || rawBudget === undefined ? null : Number(rawBudget)
  const validBudget = budget !== null && Number.isFinite(budget) && budget >= 0 ? budget : null
  return {
    count, done, remaining: count - done, percent: count ? Math.round(done / count * 100) : 0,
    total: totalCents / 100, boughtTotal: boughtCents / 100, pendingTotal: (totalCents - boughtCents) / 100,
    unpricedCount, pendingUnpricedCount, budget: validBudget,
    budgetRemaining: validBudget === null ? null : Math.round((validBudget * 100 - totalCents)) / 100,
  }
}

function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim()
}

/** @param {Partial<import('../../types/checklists').Checklist> | null | undefined} list */
export function selectChecklistItems(list, { status = 'all', query = '', category = '', sort = 'pending' } = {}) {
  const words = searchText(query).split(/\s+/).filter(Boolean)
  const items = checklistItems(list).filter((item) => {
    if (status === 'pending' && item.done || status === 'done' && !item.done) return false
    if (category && (item.category || '其他') !== category) return false
    const haystack = searchText([checklistItemName(item), item.note, item.category, item.unit].join(' '))
    return words.every((word) => haystack.includes(word))
  })
  const compare = (a, b) => String(a || '').localeCompare(String(b || ''), 'zh-CN', { numeric: true, sensitivity: 'base' })
  if (sort === 'pending') items.sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)))
  else if (sort === 'name') items.sort((a, b) => compare(checklistItemName(a), checklistItemName(b)))
  else if (sort === 'category') items.sort((a, b) => compare(a.category || '其他', b.category || '其他'))
  else if (sort === 'amount') items.sort((a, b) => (checklistAmount(b) ?? -1) - (checklistAmount(a) ?? -1))
  return items
}

/**
 * @param {string} text
 * @param {{existingItems?: import('../../types/checklists').ChecklistItemInput[], skipDuplicates?: boolean}} options
 */
export function parseChecklistLines(text, { existingItems = [], skipDuplicates = true } = {}) {
  const seen = new Set(skipDuplicates ? existingItems.map((item) => searchText(checklistItemName(item))) : [])
  const items = []
  let duplicateCount = 0
  const errors = []
  for (const [index, line] of String(text ?? '').split(/\r?\n/).entries()) {
    let name = line.trim().replace(/^(?:[-*•·]\s+|\d+[.)、]\s*)/, '')
    const marker = /^(?:\[([ xX✓])\]|([☐☑✅]))\s*/.exec(name)
    const done = Boolean(marker && (marker[1]?.trim() || marker[2] === '☑' || marker[2] === '✅'))
    if (marker) name = name.slice(marker[0].length)
    name = name.trim()
    if (!name) continue
    if (name.length > 120) { errors.push(`第 ${index + 1} 行名称超过 120 个字符`); continue }
    const key = searchText(name)
    if (skipDuplicates && seen.has(key)) { duplicateCount += 1; continue }
    seen.add(key)
    items.push({ name, done })
  }
  if (items.length > MAX_BATCH_ITEMS) errors.push(`一次最多添加 ${MAX_BATCH_ITEMS} 项，请分批添加`)
  return { items, duplicateCount, errors }
}

/** @param {Partial<import('../../types/checklists').Checklist> | null | undefined} list */
export function formatChecklistText(list) {
  const shopping = list?.type === 'shopping'
  const lines = checklistItems(list).map((item) => {
    const amount = checklistAmount(item)
    const details = [
      shopping || checklistQuantity(item) !== 1 ? `${checklistQuantity(item)} ${item.unit || '件'}` : '',
      item.category && item.category !== '其他' ? item.category : '',
      shopping ? amount === null ? '未估价' : `¥${amount.toFixed(2)}` : '',
      item.note,
    ].filter(Boolean)
    return `[${item.done ? 'x' : ' '}] ${checklistItemName(item)}${details.length ? ` · ${details.join(' · ')}` : ''}`
  })
  const summary = summarizeChecklist(list)
  return [list?.name || '清单', `已完成 ${summary.done}/${summary.count} 项`, '', ...lines,
    ...(shopping ? ['', `已估总额 ¥${summary.total.toFixed(2)}${summary.unpricedCount ? `（${summary.unpricedCount} 项未估价）` : ''}`] : []),
  ].join('\n')
}
