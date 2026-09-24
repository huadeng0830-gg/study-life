// 固定账单预设模板：把常用账单的字段存成模板，在账单表单里一键套用。
//
// 【形状照抄 courseTemplates.js】`useStoredRef` + `saveTemplate` / `deleteTemplate` +
// `touchStoredRef` 显式提交 + 深拷贝 + 抛中文错误。存储形状：
//   `sl_ledger_templates = [{ id, name, createdAt, bill: {...账单字段} }]`
//
// 【为什么模板里存一个 `bill` 子对象而不是把字段摊平】模板不是账单：它没有 id，
// 也**刻意不保存 `nextDate`**（下次支付日期是「这一次」的事实，套用模板时回填一个旧日期
// 只会造成误导）。子对象把「模板元信息」与「被套用的账单字段」分开，读起来不会混。
import { touchStoredRef, useStoredRef } from './store/core.js'
import { normalizeAmount } from './ledger.js'
import { normalizeCurrency } from './ledgerFx.js'

export const LEDGER_TEMPLATES_KEY = 'sl_ledger_templates'
// 与 commands.js 的 createBill 同一份周期白名单。
const CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly', 'once']

function createId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `ltpl-${uuid}` : `ltpl-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 深拷贝：模板一旦入 store 就与表单对象脱钩，避免后续编辑表单把已保存的模板一起改掉。 */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 账单字段白名单 + 规范化。
 * 只保留「账单表单真的有、且值得复用」的字段；`nextDate` / `id` / 审计字段一律丢弃。
 * 金额走账本的 `normalizeAmount`：非法就**不写入**该字段（模板允许只有名称和周期）。
 */
export function normalizeBillTemplate(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const amount = normalizeAmount(source.amount)
  const remindDays = Number(source.remindDays)
  return {
    name: String(source.name ?? '').trim(),
    ...(amount === null ? {} : { amount }),
    category: String(source.category ?? '').trim(),
    cycle: CYCLES.includes(source.cycle) ? source.cycle : 'monthly',
    remindDays: Number.isFinite(remindDays) ? Math.max(0, Math.round(remindDays)) : 3,
    account: String(source.account ?? '').trim(),
    currency: normalizeCurrency(source.currency),
    note: String(source.note ?? '').trim(),
    autoRenew: source.autoRenew !== false,
    active: source.active !== false,
  }
}

/** 模板 → 账单表单字段。刻意不含 `nextDate`：套用模板不该改掉「下次支付日期」。 */
export function templateToBillForm(template) {
  const bill = normalizeBillTemplate(template?.bill ?? {})
  return {
    name: bill.name,
    amount: bill.amount === undefined ? '' : String(bill.amount),
    category: bill.category,
    cycle: bill.cycle,
    remindDays: bill.remindDays,
    account: bill.account,
    currency: bill.currency,
    note: bill.note,
    autoRenew: bill.autoRenew,
    active: bill.active,
  }
}

export function useLedgerTemplateCommands() {
  const templates = useStoredRef(LEDGER_TEMPLATES_KEY, [])
  const commit = () => touchStoredRef(LEDGER_TEMPLATES_KEY)

  /**
   * 新增或覆盖（同 id 即覆盖 → 「改」）。
   * courseTemplates 的 `saveTemplate` 只做无脑 unshift；模板需要「改」的语义
   * （账单名没变时不该堆出一串同名模板），所以这里按 id 做一次 upsert。
   */
  function saveTemplate(value = {}) {
    const name = String(value.name || '').trim()
    if (!name) throw new Error('请填写模板名称')
    const bill = normalizeBillTemplate(value.bill ?? {})
    if (!bill.name && bill.amount === undefined) throw new Error('模板至少要保存账单名称或金额')
    const template = {
      id: value.id || createId(),
      name,
      createdAt: value.createdAt || new Date().toISOString(),
      bill: clone(bill),
    }
    const index = templates.value.findIndex((entry) => entry.id === template.id)
    if (index >= 0) templates.value.splice(index, 1, template)
    else templates.value.unshift(template)
    commit()
    return template
  }

  function deleteTemplate(id) {
    const index = templates.value.findIndex((template) => template.id === id)
    if (index < 0) return null
    const template = templates.value.splice(index, 1)[0]
    commit()
    return template
  }

  return { templates, saveTemplate, deleteTemplate }
}