// 报销分摊：记录「这一笔里我实际承担多少」。
//
// 【存储形状】不新增任何存储键，只在支出记录上加**可选**字段：
//   `split: { total: <number>, mine: <number>, participants: [{ label, amount }] }`
// 旧记录没有这个字段 = 未分摊，语义完全不变（既有汇总函数一律不改）。
//
// 【产品边界，必须写清楚】
//   - 这里**不做多人账户、不做结算**：不记录「谁欠我多少」、不记参与者是否已还钱，
//     只记录这笔支出里我实际承担的部分。参与者只是一个明细标签，没有身份、没有余额。
//   - 因此「我的实际支出」= `split.mine`（有分摊时），否则就是 `amount`。
//
// 【为什么全部用「分」】分摊要处理余数：100 元 3 人不可能各 33.333…。
// 浮点相加会出现 99.99999999999999，所以份额一律先算成整数分，
// 余数按「分」逐个分给前几位，保证 `sum(份额) === 总额` **精确成立**。
import { amountToCents, isRefundTransaction, isValidDateKey } from './ledger.js'

/** 整数分等分：10000 分 3 人 → [3334, 3333, 3333]（余数分给前几位，合计精确等于总额）。 */
export function splitCentsEvenly(totalCents, count) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('总额需为不小于 0 的分值整数')
  const people = Math.trunc(Number(count))
  if (!Number.isFinite(people) || people < 1) throw new Error('参与人数至少为 1')
  const base = Math.floor(totalCents / people)
  let remainder = totalCents - base * people
  const shares = []
  for (let index = 0; index < people; index += 1) {
    shares.push(base + (remainder > 0 ? 1 : 0))
    if (remainder > 0) remainder -= 1
  }
  return shares
}

function assembleSplit(totalCents, mineCents, shares, { selfLabel = '我', memberLabel = '成员' } = {}) {
  return {
    total: totalCents / 100,
    mine: mineCents / 100,
    participants: shares.map((cents, index) => ({
      label: index === 0 ? selfLabel : `${memberLabel} ${index}`,
      amount: cents / 100,
    })),
  }
}

/**
 * 构造分摊。入参非法时抛中文错误（与模板模块同一约定，UI 直接展示 message）。
 *
 * `mine` 为空时按人数等分（余数分给前几位）；给了 `mine` 时，剩余部分在其余人之间
 * 再次等分——两条路径都保证 `sum(participants) === total` 精确成立。
 */
export function buildSplit(totalYuan, { count = 2, mine = null, selfLabel = '我', memberLabel = '成员' } = {}) {
  const totalCents = amountToCents(totalYuan)
  if (totalCents === null || totalCents <= 0) throw new Error('分摊总额需为大于 0 的金额，最多两位小数')
  const people = Number(count)
  if (!Number.isInteger(people) || people < 1 || people > 99) throw new Error('参与人数需为 1~99 的整数')
  const hasMine = !(mine === null || mine === undefined || mine === '')
  const mineCents = hasMine ? amountToCents(mine) : null
  if (hasMine && mineCents === null) throw new Error('我的份额需为不小于 0 的金额，最多两位小数')
  if (!hasMine) {
    const shares = splitCentsEvenly(totalCents, people)
    return assembleSplit(totalCents, shares[0], shares, { selfLabel, memberLabel })
  }
  if (mineCents > totalCents) throw new Error('我的份额不能超过总额')
  if (people === 1 && mineCents !== totalCents) throw new Error('只有一个人时，份额必须等于总额')
  const rest = totalCents - mineCents
  const others = people - 1
  const otherShares = others > 0 ? splitCentsEvenly(rest, others) : []
  return assembleSplit(totalCents, mineCents, [mineCents, ...otherShares], { selfLabel, memberLabel })
}

/**
 * 逐条校验分摊数据，返回 `{ ok, issues, split }`。
 * 与 `normalizeSplit` 的分工：这里给出**可读的原因**（UI 报错/测试断言都用它），
 * `normalizeSplit` 只回答「能不能用」。
 */
export function validateSplit(value) {
  const issues = []
  const source = value && typeof value === 'object' ? value : null
  if (!source) return { ok: false, issues: ['缺少分摊数据'], split: null }

  const totalCents = amountToCents(source.total)
  if (totalCents === null || totalCents <= 0) issues.push('分摊总额需为大于 0 的金额，最多两位小数')
  const mineCents = amountToCents(source.mine)
  if (mineCents === null) issues.push('我的份额需为不小于 0 的金额，最多两位小数')
  if (totalCents !== null && mineCents !== null && mineCents > totalCents) issues.push('我的份额不能超过总额')

  const rawParticipants = Array.isArray(source.participants) ? source.participants : []
  if (!rawParticipants.length) issues.push('缺少分摊明细')
  const participants = []
  let sumCents = 0
  for (const entry of rawParticipants) {
    const cents = amountToCents(entry?.amount)
    if (cents === null) {
      issues.push('分摊明细里出现无法识别的金额')
      continue
    }
    participants.push({ label: String(entry?.label ?? '').trim() || '成员', amount: cents / 100 })
    sumCents += cents
  }
  if (totalCents !== null && participants.length && sumCents !== totalCents) issues.push('各人份额之和必须等于总额')

  if (issues.length) return { ok: false, issues, split: null }
  return {
    ok: true,
    issues,
    split: { total: totalCents / 100, mine: mineCents / 100, participants },
  }
}

/** 规范化：不合法一律返回 null（= 未分摊），绝不写一个半坏的 split 进记录。 */
export function normalizeSplit(value) {
  const result = validateSplit(value)
  return result.ok ? result.split : null
}

/** 这条记录是否已分摊（旧记录没有该字段，null/半坏数据都不算）。 */
export function hasSplit(item) {
  if (isRefundTransaction(item)) return false
  return Boolean(normalizeSplit(item?.split))
}

/**
 * 「我的实际支出」的唯一定义：有分摊用 `mine`，否则用 `amount`。
 * 返回「分」；金额非法返回 null（与 `amountToCents` 同一约定）。
 *
 * 汇总函数的用法：`summarizeLedgerTransactions` / `buildLedgerMonthReview` 收
 * **分**（直接传本函数）；`summarizeLedgerInBase` 收**元**（传 `mySpendYuan`）。
 * 三个入口都只在传了 `amountOf` 时才换口径，不传仍是全额口径。
 */
export function mySpendCents(item) {
  const amountCents = amountToCents(item?.amount)
  if (amountCents === null) return null
  const split = normalizeSplit(item?.split)
  if (!split) return amountCents
  // 旧版退款复制了原支出的 split：部分退款的 amount 已是实际到账金额，
  // split.total 却仍是原消费总额。读侧按到账金额兼容，不改写历史记录。
  if (isRefundTransaction(item) && amountToCents(split.total) !== amountCents) return amountCents
  const mineCents = amountToCents(split.mine)
  return mineCents === null ? amountCents : mineCents
}

/** `mySpendCents` 的「元」版本：给按元金额折算的入口用（汇率折算）。 */
export function mySpendYuan(item) {
  const cents = mySpendCents(item)
  return cents === null ? null : cents / 100
}

/**
 * 按「我的实际支出」汇总某个月的**分类**合计（账本首页「本月分类」用）。
 *
 * 逐条口径与 `mySpendCents` / `buildLedgerIndex` 的 `monthCategories` 完全对齐：
 * 只看未归档/未删除/未墓碑、有 id、日期合法的记录；收入与退款都不进分类分布
 * （退款是冲抵项，不是新消费）。与索引的唯一区别是每条取 `mine` 而不是 `amount`。
 * 返回 `Map<分类 key, 元>`；没有可计入记录时返回空 Map。
 */
export function personalMonthCategoryTotals(list, month, { amountOf = mySpendCents } = {}) {
  const monthKey = String(month ?? '').slice(0, 7)
  const totals = new Map()
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    if (item.archivedAt || item.deletedAt || item.tombstone) continue
    if (!String(item.id ?? '').trim() || !isValidDateKey(item.date)) continue
    if (String(item.date).slice(0, 7) !== monthKey) continue
    if (item.direction === 'income' || isRefundTransaction(item)) continue
    const cents = amountOf(item)
    if (cents === null) continue
    const key = item.cat || 'other'
    totals.set(key, (totals.get(key) ?? 0) + cents)
  }
  return new Map([...totals.entries()].map(([key, cents]) => [key, cents / 100]))
}

/**
 * 按「我的实际支出」汇总一批记录，口径与 `summarizeLedgerTransactions` 逐条对齐
 * （可见性、id/日期校验、退款冲抵、expenseTotal = 支出 - 退款），
 * 唯一区别是每条用 `mySpendCents` 而不是 `amount`。
 */
export function personalSpendTotals(list, { dateFilter = null } = {}) {
  const items = []
  let expenseCents = 0
  let incomeCents = 0
  let refundCents = 0
  let splitCount = 0
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    if (item.archivedAt || item.deletedAt || item.tombstone) continue
    if (!String(item.id ?? '').trim() || !isValidDateKey(item.date)) continue
    if (typeof dateFilter === 'function' && !dateFilter(item.date)) continue
    const cents = mySpendCents(item)
    if (cents === null) continue
    if (hasSplit(item)) splitCount += 1
    items.push(item)
    if (item.direction === 'income') incomeCents += cents
    else if (isRefundTransaction(item)) refundCents += cents
    else expenseCents += cents
  }
  return {
    items,
    count: items.length,
    splitCount,
    expenseTotal: (expenseCents - refundCents) / 100,
    incomeTotal: incomeCents / 100,
    refundTotal: refundCents / 100,
    // 结余 = 收入 − 支出（支出已含退款冲抵）。与 buildLedgerMonthReview 的 balance 同定义。
    balance: (incomeCents - (expenseCents - refundCents)) / 100,
  }
}
