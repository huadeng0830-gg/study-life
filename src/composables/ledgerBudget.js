// 账本预算与超支预警（月度总额，基准币种）。
//
// 【存储形状】`sl_ledger_budget = { monthly: <number|null>, updatedAt: 'YYYY-MM-DD' }`
// 单位是「元」，口径是基准币种（与账本记录一致）。`monthly === null` 表示**未设置预算**。
//
// 【为什么不做分分类预算】分分类预算要么给每个分类都加一个输入框，要么再做一层分类选择器，
// 交互面积显著变大而收益边际；本轮只做月度总额，并在页面上如实写明「只做月度总额」。
// `categories` 之类的字段刻意不写进形状，避免留下一个永远不生效的空壳字段。
//
// 【边界】这里只算「预算 vs 已花」，不写任何状态到账本索引里：
// 既有 `buildLedgerIndex` / `ledger.test.js` / `ledgerFinalOptimization.test.js` 全不受影响。
// 存在非基准币种记录时，调用方要传**折算后**的当月总额（见 ledgerFx.summarizeLedgerInBase），
// 并在文案里说明是折算值。
import { touchStoredRef, useStoredRef } from './store/core.js'
import { MAX_LEDGER_AMOUNT } from './ledger.js'
import { dateText, moneyWithCurrency } from '../utils/formatters.js'

export const LEDGER_BUDGET_KEY = 'sl_ledger_budget'
export const DEFAULT_LEDGER_BUDGET = { monthly: null, updatedAt: '' }
// 「接近预算」的阈值：达到 80% 就提醒，与超支用不同文案区分。
export const BUDGET_NEAR_RATIO = 0.8

/** 月度预算规范化：只接受大于 0、最多两位小数、不超过账本金额上限的数；其余一律视为未设置。 */
export function normalizeMonthlyBudget(value) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value).trim().replace(/,/g, '').replace(/^[¥￥]\s*/, ''))
  if (!Number.isFinite(number) || number <= 0) return null
  const cents = Math.round(number * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_LEDGER_AMOUNT * 100) return null
  // 拒绝真正超过两位小数的输入（与账本金额同一约定），避免 1.005 这类静默四舍五入。
  if (Math.abs(number - cents / 100) > 1e-8) return null
  return cents / 100
}

export function normalizeLedgerBudget(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    monthly: normalizeMonthlyBudget(source.monthly),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : '',
  }
}

/** 预算读写：与 courseTemplates 同一套形状（useStoredRef + touchStoredRef 显式提交）。 */
export function useLedgerBudget() {
  const budget = useStoredRef(LEDGER_BUDGET_KEY, { ...DEFAULT_LEDGER_BUDGET })
  const commit = () => touchStoredRef(LEDGER_BUDGET_KEY)
  function saveBudget(value) {
    const monthly = normalizeMonthlyBudget(value)
    if (monthly === null) throw new Error('预算需为大于 0 的数字，最多两位小数')
    budget.value = { ...normalizeLedgerBudget(budget.value), monthly, updatedAt: dateText() }
    commit()
    return budget.value
  }
  function clearBudget() {
    budget.value = { ...normalizeLedgerBudget(budget.value), monthly: null, updatedAt: dateText() }
    commit()
    return budget.value
  }
  return { budget, saveBudget, clearBudget }
}

/** 元 → 分；非法/非有限值按 0 处理（退款多于支出时总额可能为负，这是合法输入）。 */
function minorOf(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) : 0
}

/**
 * 预算状态。`set === false` 时页面上**什么都不该显示**（不是显示 0/0）。
 *
 * `level`：`over`（超出预算）/ `near`（≥80%）/ `ok`（在预算内）/ `none`（未设置预算）。
 * 比较全部在「分」上做，负的 spent（退款冲抵后为负）也会如实算出剩余额度。
 */
export function budgetStatus({ spent = 0, budget = null, nearRatio = BUDGET_NEAR_RATIO } = {}) {
  const limit = normalizeMonthlyBudget(budget)
  const spentCents = minorOf(spent)
  if (limit === null) {
    return {
      set: false, level: 'none', budget: null, spent: spentCents / 100,
      spentCents, budgetCents: null, remaining: null, remainingCents: null, ratio: null, pct: 0,
    }
  }
  const budgetCents = Math.round(limit * 100)
  const remainingCents = budgetCents - spentCents
  const ratio = budgetCents > 0 ? spentCents / budgetCents : 0
  const level = spentCents > budgetCents ? 'over' : ratio >= nearRatio ? 'near' : 'ok'
  return {
    set: true, level, budget: limit, spent: spentCents / 100,
    spentCents, budgetCents, remaining: remainingCents / 100, remainingCents,
    ratio, pct: Math.round(ratio * 100),
  }
}

/** 预警文案的唯一出处。未设预算返回空字符串；超支与接近预算必须是两句不同的话。 */
export function budgetAlertText(status, { base = 'CNY', converted = false } = {}) {
  if (!status || !status.set) return ''
  const suffix = converted ? '（已按手工汇率折算）' : ''
  if (status.level === 'over') {
    return `本月已超预算 ${moneyWithCurrency(Math.abs(status.remaining), base)}：花了 ${moneyWithCurrency(status.spent, base)}，预算 ${moneyWithCurrency(status.budget, base)}${suffix}`
  }
  if (status.level === 'near') {
    return `本月已用 ${status.pct}% 预算：还剩 ${moneyWithCurrency(status.remaining, base)}（预算 ${moneyWithCurrency(status.budget, base)}）${suffix}`
  }
  return `本月预算 ${moneyWithCurrency(status.budget, base)} · 已用 ${status.pct}%${suffix}`
}