<template>
  <Modal v-if="open" :open="open" title="汇率设置" medium @close="emit('close')">
    <div class="bill-form">
      <p class="bill-form-intro">全部手工输入：1 单位外币 = 多少 {{ baseCurrency }}。应用不会联网获取汇率。</p>
      <p class="form-note">没有历史汇率——改一次数值会影响所有历史折算；这里只做「外币 → 基准币种」的单跳换算，不做三角换算。缺汇率的记录不会被计入折算合计，而是单独标出笔数。</p>
      <div v-for="row in draft" :key="row.code" class="bill-form-grid">
        <label class="bill-field">
          <span>{{ row.code }} → {{ baseCurrency }}</span>
          <input v-model="row.rate" type="text" inputmode="decimal" placeholder="例如 7.2" :aria-label="`1 ${row.code} 等于多少 ${baseCurrency}`" />
        </label>
        <div class="bill-field">
          <span>操作</span>
          <button class="btn" type="button" @click="removeRow(row.code)">删除 {{ row.code }}</button>
        </div>
      </div>
      <p v-if="!draft.length" class="form-note">还没有设置任何外币汇率。</p>
      <div class="bill-form-grid">
        <label class="bill-field">
          <span>添加币种 <em>三位字母</em></span>
          <input v-model="newCode" maxlength="3" :list="optionListId" placeholder="USD" aria-label="要添加的币种代码" />
        </label>
        <div class="bill-field">
          <span>操作</span>
          <button class="btn" type="button" @click="addRow">添加到列表</button>
        </div>
      </div>
      <datalist :id="optionListId">
        <option v-for="code in addable" :key="code" :value="code" />
      </datalist>
      <p v-if="error" class="bill-error" role="alert">{{ error }}</p>
      <div class="bill-form-actions">
        <button class="btn" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-primary" type="button" @click="commit">保存汇率</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
/**
 * 汇率设置弹窗（从 LedgerView.vue 拆出）。
 *
 * 口径与首页的折算行同源：这里只维护 `sl_ledger_fx` 的 rates，
 * 「当月支出折成基准币种」的计算（sumLedgerMonthInBase / fxRateNote）仍然留在页面侧，
 * 打开弹窗时把当前汇率铺成草稿，点「保存汇率」才写回存储 —— 半途关掉不会留下半个汇率。
 *
 * id 用 `:id` 绑定而不是写死，避免将来多个账本实例同时打开时 datalist 互相撞 id。
 */
import { ref, watch } from 'vue'
import Modal from '../../components/Modal.vue'
import { normalizeCurrency, normalizeLedgerFx, useLedgerFx } from '../../composables/ledgerFx.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  baseCurrency: { type: String, default: 'CNY' },
  addable: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'notify'])

const optionListId = 'ledger-fx-currency-options'
const { fx, saveFx } = useLedgerFx()
const draft = ref([]) // [{ code, rate }] 弹窗内的草稿；点保存才写回 sl_ledger_fx
const newCode = ref('')
const error = ref('')

watch(() => props.open, (value) => {
  if (!value) return
  draft.value = Object.entries(normalizeLedgerFx(fx.value).rates).map(([code, rate]) => ({ code, rate: String(rate) }))
  newCode.value = ''
  error.value = ''
})

function addRow() {
  const code = normalizeCurrency(newCode.value)
  if (!code) { error.value = '币种代码需为三位字母，例如 USD'; return }
  if (code === props.baseCurrency) { error.value = '基准币种的汇率固定为 1，不需要设置'; return }
  if (draft.value.some((row) => row.code === code)) { error.value = `${code} 已经在列表里了`; return }
  draft.value = [...draft.value, { code, rate: '' }]
  newCode.value = ''
  error.value = ''
}
function removeRow(code) {
  draft.value = draft.value.filter((row) => row.code !== code)
}
function commit() {
  const rates = {}
  for (const row of draft.value) {
    const value = Number(String(row.rate).trim())
    if (!Number.isFinite(value) || value <= 0) { error.value = `${row.code} 的汇率需为大于 0 的数字`; return }
    rates[row.code] = value
  }
  saveFx({ ...normalizeLedgerFx(fx.value), rates })
  emit('close')
  emit('notify', `已保存 ${Object.keys(rates).length} 个币种的汇率（手工维护，不联网）`)
}
</script>

<style scoped>
/* 与固定账单 / 预算弹窗共用的「表单列」排版，拆分后各自带一份（见 style 块顶部说明）。 */
.bill-form {
  flex-direction:column;
  gap:16px;
  display:flex}
.bill-form-intro {
  color:var(--ink-faint);
  margin:-4px 0 1px;
  font-size:var(--fs-12-5);
  line-height:1.5}
.bill-form-grid {
  grid-template-columns:1fr 1fr;
  gap:12px;
  display:grid}
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
.form-note {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:var(--fs-11-5);
  line-height:1.5}
@media (max-width:520px) {
  .bill-form {
  gap:14px}
.bill-form-grid {
  grid-template-columns:1fr}
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
