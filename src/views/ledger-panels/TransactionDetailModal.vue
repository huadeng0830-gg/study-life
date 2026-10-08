<script setup>
import { computed } from 'vue'
import Modal from '../../components/Modal.vue'
import { catInfo, isRefundTransaction, freqPrefs } from '../../composables/ledger.js'
import { moneyRow, moneyWithCurrency } from '../../utils/formatters.js'
import { isBillPayment } from '../../composables/ledgerRelations.js'
import { currencyChoices, useLedgerFx } from '../../composables/ledgerFx.js'
import { activeCategories } from '../../composables/ledger.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  detailExpense: { type: Object, default: null },
  detailEdit: { type: Boolean, default: false },
  detailAmountInput: { type: String, default: '' },
  detailCategoryInput: { type: String, default: '' },
  detailDateInput: { type: String, default: '' },
  detailCurrencyInput: { type: String, default: '' },
  applySameNameCategory: { type: Boolean, default: false },
  sameNameCategoryCount: { type: Number, default: 0 },
  showRefund: { type: Boolean, default: false },
  refundItem: { type: Object, default: null },
  refundAmountInput: { type: String, default: '' },
  refundDateInput: { type: String, default: '' },
  refundNoteInput: { type: String, default: '' },
  baseCurrency: { type: String, required: true },
  splitDetailNote: { type: Function, default: () => '' },
})

const emit = defineEmits([
  'update:open',
  'update:detailEdit',
  'update:detailAmountInput',
  'update:detailCategoryInput',
  'update:detailDateInput',
  'update:detailCurrencyInput',
  'update:applySameNameCategory',
  'update:showRefund',
  'update:refundItem',
  'update:refundAmountInput',
  'update:refundDateInput',
  'update:refundNoteInput',
  'edit-from-detail',
  'full-edit-from-detail',
  'save-detail-edit',
  'cancel-detail-edit',
  'again-from-detail',
  'undo-bill-payment-from-detail',
  'delete-from-detail',
  'open-refund',
  'close-refund',
  'confirm-refund',
  'toggle-pin-name',
  'toggle-hide-name',
])

const { fx } = useLedgerFx()

const detailActions = computed(() => {
  const e = props.detailExpense
  if (!e) return []
  const actions = []
  if (!isBillPayment(e) && !isRefundTransaction(e)) actions.push({ label: '编辑', handler: 'edit-from-detail' })
  // 「完整编辑」= 带着 id 回到完整的「记一笔」表单。
  // 为什么不复用上面的「编辑」：那个是详情页内的 4 字段内联编辑（金额/分类/日期/币种），
  // 改不了名称、账户、备注、收支方向、分摊。而 `again-from-detail`（再记一次）
  // 刻意**不传 id**——它语义是「新建一笔相同的」，传了 id 就变成编辑，
  // 会把「再记一次」变成隐式覆盖，风险太大。所以这里单开一个明确的动作。
  if (!isRefundTransaction(e)) actions.push({ label: '完整编辑', handler: 'full-edit-from-detail' })
  if (!isRefundTransaction(e)) actions.push({ label: '再记一次', handler: 'again-from-detail' })
  if (!isRefundTransaction(e)) actions.push({ label: (freqPrefs.pinned ?? []).includes(e.name.trim()) ? '取消常记' : '设为常记', handler: 'toggle-pin-name' })
  if (!isRefundTransaction(e)) actions.push({ label: (freqPrefs.hidden ?? []).includes(e.name.trim()) ? '取消隐藏' : '从常记隐藏', handler: 'toggle-hide-name' })
  if (!isBillPayment(e) && !isRefundTransaction(e) && e.direction !== 'income') actions.push({ label: '退款', handler: 'open-refund' })
  if (isBillPayment(e)) actions.push({ label: '撤销支付', handler: 'undo-bill-payment-from-detail', danger: true })
  else if (isRefundTransaction(e)) actions.push({ label: '撤销退款', handler: 'delete-from-detail', danger: true })
  else actions.push({ label: '删除', handler: 'delete-from-detail', danger: true })
  return actions
})
</script>

<template>
<Modal v-if="detailExpense" :open="open" :title="detailExpense?.name ?? '记录详情'" @close="$emit('update:open', false)">
  <div class="detail-body">
    <template v-if="detailEdit">
      <div class="detail-edit-grid">
        <label>金额<input :value="detailAmountInput" @input="e => $emit('update:detailAmountInput', e.target.value)" class="detail-edit-amount" type="text" inputmode="decimal" aria-label="修改金额" /></label>
        <label>分类<select :value="detailCategoryInput" @input="e => $emit('update:detailCategoryInput', e.target.value)" aria-label="修改分类"><option v-for="category in activeCategories(detailExpense.direction === 'income' ? 'income' : 'expense')" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option></select></label>
        <label>日期<input :value="detailDateInput" @input="e => $emit('update:detailDateInput', e.target.value)" type="date" aria-label="修改日期" /></label>
        <label>币种<select :value="detailCurrencyInput" @input="e => $emit('update:detailCurrencyInput', e.target.value)" aria-label="修改币种"><option v-for="code in currencyChoices(fx, [detailCurrencyInput])" :key="code" :value="code">{{ code }}</option></select></label>
      </div>
      <label v-if="sameNameCategoryCount" class="detail-bulk-category">
        <input type="checkbox" :checked="applySameNameCategory" @change="$emit('update:applySameNameCategory', $event.target.checked)" />
        <span>
          同时把另外 {{ sameNameCategoryCount }} 笔同名{{ detailExpense.direction === 'income' ? '收入' : '支出' }}改为「{{ catInfo(detailCategoryInput).name }}」
          <small>只匹配相同名称和收支方向的历史记录；只改分类，不改金额、日期等信息。</small>
        </span>
      </label>
      <div class="detail-actions detail-edit-actions">
        <button class="btn" type="button" @click="$emit('cancel-detail-edit')">取消</button>
        <button class="btn btn-primary" type="button" @click="$emit('save-detail-edit')">{{ applySameNameCategory && sameNameCategoryCount ? `保存并更新 ${sameNameCategoryCount} 笔分类` : '保存修改' }}</button>
      </div>
    </template>
    <template v-else>
      <div class="detail-amount" :class="{ income: detailExpense.direction === 'income', refund: detailExpense.direction === 'refund' }">{{ detailExpense.direction === 'income' || detailExpense.direction === 'refund' ? '+' : '-' }}{{ moneyWithCurrency(detailExpense.amount, detailExpense.currency) }}</div>
      <div class="detail-meta">
        <span>{{ catInfo(detailExpense.cat).icon }} {{ catInfo(detailExpense.cat).name }}</span>
        <span>{{ detailExpense.date }} {{ detailExpense.time }}</span>
        <span v-if="detailExpense.account">{{ detailExpense.account }}</span>
        <span v-if="isBillPayment(detailExpense)">来自固定账单</span>
        <span v-if="detailExpense.direction === 'refund'">退款 · 冲抵原支出</span>
        <span v-if="props.splitDetailNote && props.splitDetailNote(detailExpense)">{{ props.splitDetailNote(detailExpense) }}</span>
      </div>
      <p v-if="detailExpense.note" class="detail-note">{{ detailExpense.note }}</p>
      <div class="detail-actions">
        <button v-for="action in detailActions" :key="action.label" class="btn" :class="{ 'btn-danger': action.danger }" type="button" @click="$emit(action.handler)">{{ action.label }}</button>
      </div>
      <p v-if="isBillPayment(detailExpense)" class="form-note">这是固定账单的支付记录。撤销后，本期会重新回到待支付。</p>
    </template>
  </div>
</Modal>

<Modal v-if="showRefund" :open="showRefund" title="登记退款" medium @close="$emit('close-refund')">
  <div class="refund-form">
    <p class="refund-hint">把「{{ refundItem?.name }}」的支出按退款冲抵，本月的支出统计会相应减少。</p>
    <label class="bill-field">退款金额 <input :value="refundAmountInput" @input="e => $emit('update:refundAmountInput', e.target.value)" type="number" min="0" step="0.01" inputmode="decimal" aria-label="退款金额" /></label>
    <label class="bill-field">退款日期 <input :value="refundDateInput" @input="e => $emit('update:refundDateInput', e.target.value)" type="date" aria-label="退款日期" /></label>
    <label class="bill-field">备注 <input :value="refundNoteInput" @input="e => $emit('update:refundNoteInput', e.target.value)" maxlength="80" placeholder="可选，例如：平台退款到账" /></label>
    <div class="detail-actions"><button class="btn" type="button" @click="$emit('close-refund')">取消</button><button class="btn btn-primary" type="button" @click="$emit('confirm-refund')">确认退款</button></div>
  </div>
</Modal>
</template>

<style scoped>
/* TransactionDetailModal 样式：从 LedgerView.vue 迁移，保留原有注释 */
.detail-body {
  flex-direction:column;
  gap:12px;
  display:flex}
.detail-amount {
  text-align:center;
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-32);
  font-weight:var(--fw-900)}
.detail-amount.income,.detail-amount.refund {
  color:var(--success)}
.detail-meta {
  color:var(--ink-soft);
  flex-wrap:wrap;
  justify-content:center;
  gap:6px 14px;
  font-size:var(--fs-12-5);
  display:flex}
.detail-note {
  color:var(--ink-soft);
  background:var(--bg-tint);
  border-radius:var(--radius-10);
  margin:0;
  padding:10px 12px;
  font-size:var(--fs-12-5)}
.detail-actions {
  flex-wrap:wrap;
  justify-content:center;
  gap:8px;
  display:flex}
.detail-edit-grid {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.detail-edit-grid label {
  color:var(--ink-soft);
  flex-direction:column;
  gap:5px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-700);
  display:flex}
.detail-edit-grid label:last-child {
  grid-column:1/-1}
.detail-edit-grid input,.detail-edit-grid select {
  width:100%;
  min-height:42px}
.detail-bulk-category {
  color:var(--ink-soft);
  background:var(--bg-tint);
  border:1px solid var(--border);
  border-radius:var(--radius-10);
  align-items:flex-start;
  gap:9px;
  padding:10px 12px;
  font-size:var(--fs-12);
  line-height:1.5;
  display:flex}
.detail-bulk-category input {
  width:16px;
  height:16px;
  flex:none;
  padding:0;
  margin:2px 0 0;
  accent-color:var(--primary)}
.detail-bulk-category span {
  min-width:0}
.detail-bulk-category small {
  color:var(--ink-faint);
  display:block}
.detail-edit-actions {
  justify-content:flex-end}
.bill-field {
  flex-direction:column;
  gap:7px;
  min-width:0;
  display:flex}
.refund-form {
  flex-direction:column;
  gap:14px;
  display:flex}
.refund-hint {
  color:var(--ink-soft);
  margin:0;
  font-size:var(--fs-12-5);
  line-height:1.6}
.bill-field>span {
  color:var(--ink-soft);
  font-size:var(--fs-12);
  font-weight:var(--fw-700)}
.bill-field>span i {
  color:var(--primary);
  margin-left:4px;
  font-size:var(--fs-10);
  font-style:normal;
  font-weight:var(--fw-700)}
.bill-field>span em {
  color:var(--ink-faint);
  margin-left:4px;
  font-size:var(--fs-10);
  font-style:normal;
  font-weight:var(--fw-500)}
.bill-field input,.bill-field select {
  width:100%;
  min-width:0;
  height:44px}
.form-note {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:var(--fs-11-5);
  line-height:1.5}
@media (max-width:520px) {
.detail-actions .btn {
  flex:40%}
.detail-edit-grid {
  grid-template-columns:1fr}
.detail-edit-grid label:last-child {
  grid-column:auto}
.detail-edit-actions {
  justify-content:stretch}
.detail-edit-actions .btn {
  flex:1}
}
</style>
