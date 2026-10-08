<template>
  <Modal v-if="open" :open="open" title="月度预算" medium @close="emit('close')">
    <div class="bill-form">
      <p class="bill-form-intro">设一个月度总额上限（{{ baseCurrency }}），花超或接近上限时在账本首页提醒。未设置时首页不显示任何预算提示。</p>
      <label class="bill-field bill-field-wide">
        <span>月度预算 <em>单位：元</em></span>
        <input v-model="budgetInput" type="text" inputmode="decimal" placeholder="例如 2000" :aria-label="`月度预算金额（${baseCurrency}）`" />
      </label>
      <p class="form-note">只需设置月度上限，日额度由系统按日期和实际支出自动计算。达到 80% 时提醒「接近预算」，超出后提醒「已超预算」；外币按手工汇率折算后比较。</p>
      <p class="form-note">首页把今天和后续日期分开：今日剩余额度单独保留；后续每天可用按今天之后的天数平均，不重复计入今日额度。今天没花完的部分会在次日重新分配，超出今日固定额度则会降低后续额度。</p>
      <p v-if="budgetError" class="bill-error" role="alert">{{ budgetError }}</p>
      <div class="bill-form-actions">
        <button v-if="budget.monthly !== null" class="btn btn-danger" type="button" @click="removeBudget">清除预算</button>
        <button class="btn" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-primary" type="button" @click="commitBudget">保存预算</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
/**
 * 月度预算弹窗（从 LedgerView.vue 拆出）。
 *
 * 落点是账本首页 hero-stat 里紧邻「本月承担」的那行提示：这里只负责**读写预算**，
 * 预算状态怎么显示（budgetStatus / budgetAlertText）仍然留在页面侧，
 * 首页与弹窗读的是同一份 sl_ledger_budget（useStoredRef 按 key 缓存，两处拿到同一个 ref）。
 *
 * 打开时才把当前预算回填进输入框（watch open），所以草稿不会在关掉弹窗后残留。
 */
import { ref, watch } from 'vue'
import Modal from '../../components/Modal.vue'
import { useLedgerBudget } from '../../composables/ledgerBudget.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  baseCurrency: { type: String, default: 'CNY' },
})
const emit = defineEmits(['close', 'notify'])

const { budget, saveBudget, clearBudget } = useLedgerBudget()
const budgetInput = ref('')
const budgetError = ref('')

watch(() => props.open, (value) => {
  if (!value) return
  budgetInput.value = budget.value.monthly === null ? '' : String(budget.value.monthly)
  budgetError.value = ''
})

function commitBudget() {
  try {
    saveBudget(budgetInput.value)
  } catch (cause) {
    budgetError.value = cause?.message || '预算需为大于 0 的数字'
    return
  }
  emit('close')
  emit('notify', `月度预算已设为 ${moneyWithCurrency(budget.value.monthly, props.baseCurrency)}`)
}
function removeBudget() {
  clearBudget()
  emit('close')
  emit('notify', '已清除月度预算，首页不再显示预算提示')
}
</script>

<style scoped>
/* 与固定账单 / 汇率弹窗共用一套「表单列」排版：拆分后每个弹窗各自带一份，
   保证 scoped 作用域下自己的 DOM 能被自己的选择器命中（见 style 块顶部的说明）。 */
.bill-form {
  flex-direction:column;
  gap:16px;
  display:flex}
.bill-form-intro {
  color:var(--ink-faint);
  margin:-4px 0 1px;
  font-size:var(--fs-12-5);
  line-height:1.5}
.bill-field {
  flex-direction:column;
  gap:7px;
  min-width:0;
  display:flex}
.bill-field>span {
  color:var(--ink-soft);
  font-size:var(--fs-12);
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
.bill-error {
  color:var(--danger);
  background:var(--bg-tint);
  border-radius:var(--radius-9);
  margin:-5px 0 0;
  padding:9px 11px;
  font-size:var(--fs-12)}
.bill-form-actions {
  justify-content:flex-end;
  gap:8px;
  padding-top:2px;
  display:flex}
.bill-form-actions .btn-danger {
  margin-right:auto}
.form-note {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:var(--fs-11-5);
  line-height:1.5}
@media (max-width:520px) {
  .bill-form {
  gap:14px}
.bill-form-actions {
  padding:12px 16px calc(12px + env(safe-area-inset-bottom));
  border-top:1px solid var(--border);
  background:var(--card);
  margin:0 -16px -18px;
  position:sticky;
  bottom:0}
.bill-form-actions .btn-primary {
  flex:1}
}
</style>
