<script setup>
import { computed } from 'vue'
import Modal from '../../components/Modal.vue'
import { catInfo, isRefundTransaction, freqPrefs } from '../../composables/ledger.js'
import { moneyWithCurrency } from '../../utils/formatters.js'
import { isBillPayment } from '../../composables/ledgerRelations.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  detailExpense: { type: Object, default: null },
  showRefund: { type: Boolean, default: false },
  refundItem: { type: Object, default: null },
  refundAmountInput: { type: String, default: '' },
  refundDateInput: { type: String, default: '' },
  refundNoteInput: { type: String, default: '' },
  refundError: { type: String, default: '' },
  linkedRefunds: { type: Array, default: () => [] },
  refundOriginal: { type: Object, default: null },
  remainingRefund: { type: Number, default: 0 },
  baseCurrency: { type: String, required: true },
  splitDetailNote: { type: Function, default: () => '' },
})

defineEmits([
  'update:open',
  'update:showRefund',
  'update:refundItem',
  'update:refundAmountInput',
  'update:refundDateInput',
  'update:refundNoteInput',
  'edit-from-detail',
  'again-from-detail',
  'undo-bill-payment-from-detail',
  'delete-from-detail',
  'open-refund',
  'close-refund',
  'confirm-refund',
  'toggle-pin-name',
  'toggle-hide-name',
  'open-related-record',
])


const detailActions = computed(() => {
  const e = props.detailExpense
  if (!e) return []
  const actions = []
  if (!isBillPayment(e) && !isRefundTransaction(e)) actions.push({ label: '编辑', handler: 'edit-from-detail' })
  if (!isRefundTransaction(e)) actions.push({ label: '再记一次', handler: 'again-from-detail' })
  if (!isRefundTransaction(e)) actions.push({ label: (freqPrefs.pinned ?? []).includes(e.name.trim()) ? '取消常记' : '设为常记', handler: 'toggle-pin-name' })
  if (!isRefundTransaction(e)) actions.push({ label: (freqPrefs.hidden ?? []).includes(e.name.trim()) ? '取消隐藏' : '从常记隐藏', handler: 'toggle-hide-name' })
  if (!isBillPayment(e) && !isRefundTransaction(e) && e.direction !== 'income') actions.push({ label: props.remainingRefund > 0 ? '退款' : '已全额退款', handler: 'open-refund', disabled: props.remainingRefund <= 0 })
  if (isBillPayment(e)) actions.push({ label: '撤销支付', handler: 'undo-bill-payment-from-detail', danger: true })
  else if (isRefundTransaction(e)) actions.push({ label: '撤销退款', handler: 'delete-from-detail', danger: true })
  else actions.push({ label: '删除', handler: 'delete-from-detail', danger: true })
  return actions
})
</script>

<template>
<Modal v-if="detailExpense" :open="open" :title="detailExpense?.name ?? '记录详情'" @close="$emit('update:open', false)">
  <div class="detail-body">
      <div class="detail-amount" :class="{ income: detailExpense.direction === 'income', refund: detailExpense.direction === 'refund' }">{{ detailExpense.direction === 'income' || detailExpense.direction === 'refund' ? '+' : '-' }}{{ moneyWithCurrency(detailExpense.amount, detailExpense.currency || baseCurrency) }}</div>
      <div class="detail-meta">
        <span>{{ catInfo(detailExpense.cat).icon }} {{ catInfo(detailExpense.cat).name }}</span>
        <span>{{ detailExpense.date }} {{ detailExpense.time }}</span>
        <span v-if="detailExpense.account">{{ detailExpense.account }}</span>
        <span v-if="isBillPayment(detailExpense)">来自固定账单</span>
        <span v-if="detailExpense.direction === 'refund'">退款 · 冲抵原支出</span>
        <span v-if="props.splitDetailNote && props.splitDetailNote(detailExpense)">{{ props.splitDetailNote(detailExpense) }}</span>
      </div>
      <p v-if="detailExpense.note" class="detail-note">{{ detailExpense.note }}</p>
      <div v-if="linkedRefunds.length || refundOriginal" class="detail-relations">
        <template v-if="refundOriginal">
          <span>关联原支出</span>
          <button class="link-btn" type="button" @click="$emit('open-related-record', refundOriginal.id)">{{ refundOriginal.name }} · {{ refundOriginal.date }} · {{ moneyWithCurrency(refundOriginal.amount, refundOriginal.currency || baseCurrency) }}</button>
        </template>
        <template v-else>
          <span>已登记 {{ linkedRefunds.length }} 笔退款 · 剩余可退 {{ moneyWithCurrency(remainingRefund, detailExpense.currency || baseCurrency) }}</span>
          <button v-for="entry in linkedRefunds" :key="entry.id" class="link-btn" type="button" @click="$emit('open-related-record', entry.id)">{{ entry.date }} · +{{ moneyWithCurrency(entry.amount, entry.currency || baseCurrency) }}</button>
        </template>
      </div>
      <div class="detail-actions">
        <button v-for="action in detailActions" :key="action.label" class="btn" :class="{ 'btn-danger': action.danger }" :disabled="action.disabled" type="button" @click="$emit(action.handler)">{{ action.label }}</button>
      </div>
      <p v-if="isBillPayment(detailExpense)" class="form-note">这是固定账单的支付记录。撤销后，本期会重新回到待支付。</p>
  </div>
</Modal>

<Modal v-if="showRefund" :open="showRefund" title="登记退款" medium @close="$emit('close-refund')">
  <div class="refund-form">
    <p class="refund-hint">登记「{{ refundItem?.name }}」实际退给你的金额，按退款日期冲抵当月支出，不计入收入。剩余可退 {{ moneyWithCurrency(remainingRefund, refundItem?.currency || baseCurrency) }}。</p>
    <label class="bill-field">退款金额（{{ refundItem?.currency || baseCurrency }}） <input :value="refundAmountInput" @input="e => $emit('update:refundAmountInput', e.target.value)" type="number" min="0.01" :max="remainingRefund" step="0.01" inputmode="decimal" aria-label="退款金额" :aria-invalid="Boolean(refundError)" :aria-describedby="refundError ? 'refund-form-error' : undefined" /></label>
    <label class="bill-field">退款日期 <input :value="refundDateInput" @input="e => $emit('update:refundDateInput', e.target.value)" type="date" aria-label="退款日期" /></label>
    <label class="bill-field">备注 <input :value="refundNoteInput" @input="e => $emit('update:refundNoteInput', e.target.value)" maxlength="80" placeholder="可选，例如：平台退款到账" /></label>
    <p v-if="refundError" id="refund-form-error" class="refund-error" role="alert">{{ refundError }}</p>
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
.detail-relations {
  display:flex;
  flex-direction:column;
  gap:6px;
  border:1px solid var(--border);
  border-radius:var(--radius-10);
  padding:10px 12px;
  color:var(--ink-soft);
  font-size:var(--fs-12)}
.detail-relations .link-btn {
  text-align:left;
  min-height:36px;
  overflow-wrap:anywhere}
.refund-error {
  margin:0;
  color:var(--danger);
  font-size:var(--fs-12)}
.detail-actions {
  flex-wrap:wrap;
  justify-content:center;
  gap:8px;
  display:flex}









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




}
</style>
