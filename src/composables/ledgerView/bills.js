/**
 * 固定账单的**状态口径**与**分组**（从 LedgerView.vue 拆出）。
 *
 * 这里回答三个问题，都在同一份 \`sl_bills\` 上：
 *   1. 这张账单现在处于什么状态（逾期 / 今天 / 几天内 / 已暂停）——\`billStatus\`；
 *   2. 该不该提醒用户（首页顶部「待处理」最多 3 条，本会话内可「先不提醒」）；
 *   3. 固定账单分区怎么分组（待支付 / 之后 / 已暂停），以及「支付」「跳过」两个动作。
 * 「支付」要写账本、「跳过」只推进周期，两者的提示语都在这里，页面只负责弹提示。
 *
 * \`domain\` 与 \`notify\` 是页面注入的：命令对象与 toast 都属于页面级能力，
 * 数据层不该自己 new 一份（否则撤销 / 提示会各走各的）。
 */
import { computed, ref } from 'vue'
import { formatAppDate } from '../timeContext.js'
import { moneyWithCurrency } from '../../utils/formatters.js'
import { policyDateTime } from '../settingsPolicy.js'
import { useStoredRef } from '../store/index.js'
import { normalizeLedgerFx, useLedgerFx } from '../ledgerFx.js'

export function useLedgerBills({ domain, notify, ledgerToday }) {
  const bills = useStoredRef('sl_bills', [])
  const { fx } = useLedgerFx()
  const baseCurrency = computed(() => normalizeLedgerFx(fx.value).base)
  function daysUntil(dateStr) {
    if (!dateStr) return Infinity
    const target = policyDateTime(dateStr, '00:00')
    const today = policyDateTime(ledgerToday(), '00:00')
    return Number.isFinite(target) && Number.isFinite(today) ? Math.round((target - today) / 86400000) : Infinity
  }
  function billStatus(b) {
    if (b.active === false) return { cls: 'paused', text: '已暂停' }
    const d = daysUntil(b.nextDate)
    const remind = Number(b.remindDays ?? 3)
    if (d < 0) return { cls: 'over', text: `已逾期 ${-d} 天` }
    if (d === 0) return { cls: 'today', text: '今天到期' }
    if (d === 1) return { cls: 'soon', text: '明天到期' }
    if (d <= remind) return { cls: 'soon', text: `还有 ${d} 天` }
    return { cls: 'ok', text: `还有 ${d} 天` }
  }

  function billDateLabel(dateKey) {
    return formatAppDate(dateKey, { withWeekday: false })
  }
  // 账单金额按它自己的币种显示；旧账单没有 currency → 仍是原来的 ¥xx.xx。
  function billAmountText(bill) {
    return moneyWithCurrency(bill?.amount, bill?.currency || baseCurrency.value)
  }

  // 已支付：生成账本记录 + 推进周期
  function markPaid(bill) {
    const result = domain.payBill(bill.id)
    if (!result) return
    if (result.blocked) {
      notify(result.reason)
      return
    }
    if (result.duplicate) {
      notify(`本期「${result.bill.name}」已记入账本，未重复创建交易`)
      return
    }
    notify(`已支付并记入账本 ${billAmountText(result.transaction)}${result.bill.active === false ? ' · 一次性账单已完成' : ` · 下一期 ${result.bill.nextDate}`}`, {
      actionLabel: '撤销', undoFn: () => domain.undoBillPayment(result.transaction.id),
    })
  }

  // 跳过本次：只推进周期，不生成记录
  function skipOnce(bill) {
    const target = domain.skipBill(bill.id)
    if (!target) return
    if (target.blocked) {
      notify(target.reason)
      return
    }
    notify(target.active === false ? `已跳过「${target.name}」，一次性账单已结束` : `已跳过本期「${target.name}」，下一期 ${target.nextDate}`)
  }

  // 待处理（账本首页）
  const sessionDismissed = ref([])
  const pendingBills = computed(() =>
    bills.value
      .filter((b) => b.active !== false && !sessionDismissed.value.includes(b.id))
      .map((b) => ({ ...b, _d: daysUntil(b.nextDate), _s: billStatus(b) }))
      .filter((b) => b._d <= Number(b.remindDays ?? 3))
      .sort((a, b) => a._d - b._d)
      .slice(0, 3)
  )
  function dismissPending(bill) {
    sessionDismissed.value = [...sessionDismissed.value, bill.id]
  }

  const dueBills = computed(() =>
    bills.value
      .filter((b) => b.active !== false)
      .filter((b) => { const s = billStatus(b); return s.cls === 'over' || s.cls === 'today' || s.cls === 'soon' })
      .sort((a, b) => daysUntil(a.nextDate) - daysUntil(b.nextDate))
  )
  const laterBills = computed(() =>
    bills.value
      .filter((b) => b.active !== false)
      .filter((b) => billStatus(b).cls === 'ok')
      .sort((a, b) => daysUntil(a.nextDate) - daysUntil(b.nextDate))
  )
  const pausedBills = computed(() => bills.value.filter((b) => b.active === false))

  return {
    bills,
    billStatus,
    billDateLabel,
    billAmountText,
    markPaid,
    skipOnce,
    pendingBills,
    dismissPending,
    dueBills,
    laterBills,
    pausedBills,
  }
}
