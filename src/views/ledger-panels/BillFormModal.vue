<template>
  <Modal v-if="formOpen" :open="formOpen" :title="editingBillId ? '编辑固定账单' : '添加固定账单'" medium @close="formOpen = false">
    <div class="bill-form">
      <p class="bill-form-intro">设置一次，之后会按周期提醒你。</p>
      <!-- 预设模板：下拉套用（不改「下次支付日期」），下面的 ✕ 删除，「存为模板」把当前表单存下来 -->
      <label class="bill-field bill-field-wide">
        <span>从模板套用 <em>可选</em></span>
        <select v-model="billTemplateId" aria-label="从模板套用">
          <option value="">选择模板…</option>
          <option v-for="template in billTemplates" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
      </label>
      <template v-if="billTemplates.length">
        <div class="chip-row">
          <template v-for="template in billTemplates" :key="template.id">
            <small class="form-note">{{ template.name }}</small>
            <button type="button" class="p-close" :aria-label="`删除账单模板「${template.name}」`" @click="removeBillTemplate(template.id)">✕</button>
          </template>
        </div>
      </template>
      <small v-else class="form-note">还没有模板。填好下面的表单后点「存为模板」。</small>
      <button class="btn btn-sm" type="button" @click="saveBillAsTemplate">存为模板</button>
      <small class="form-note">模板只保存名称、金额、分类、周期、提醒天数、账户与币种，不保存「下次支付日期」。</small>
      <label class="bill-field bill-field-wide">
        <span>账单名称 <i>必填</i></span>
        <input
          ref="billNameInput"
          v-model="billForm.name"
          autocomplete="off"
          placeholder="例如：ChatGPT Plus、话费"
          :aria-invalid="billErrorField === 'name' || undefined"
          :aria-describedby="billError ? 'bill-form-error' : undefined"
        />
      </label>
      <div class="bill-form-grid">
        <label class="bill-field">
          <span>金额 <i>必填</i></span>
          <div class="bill-money-input"><b>{{ currencySymbol(billForm.currency || baseCurrency) }}</b><input
            ref="billAmountInput"
            v-model="billForm.amount"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.00"
            aria-label="固定账单金额"
            :aria-invalid="billErrorField === 'amount' || undefined"
            :aria-describedby="billError ? 'bill-form-error' : undefined"
          /></div>
        </label>
        <label class="bill-field">
          <span>重复周期</span>
          <select v-model="billForm.cycle">
            <option v-for="(c, key) in CYCLES" :key="key" :value="key">{{ c.label }}</option>
          </select>
        </label>
      </div>
      <label class="bill-field bill-field-wide">
        <span>支付分类 <em>支付后生成交易时使用</em></span>
        <select v-model="billForm.category">
          <option value="">按名称自动识别</option>
          <option v-for="category in activeCategories('expense')" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option>
        </select>
      </label>
      <div class="bill-form-grid">
        <label class="bill-field">
          <span>下次支付日期</span>
          <input
            ref="billNextDateInput"
            v-model="billForm.nextDate"
            type="date"
            :aria-invalid="billErrorField === 'nextDate' || undefined"
            :aria-describedby="billError ? 'bill-form-error' : undefined"
          />
        </label>
        <label class="bill-field">
          <span>提前提醒</span>
          <select
            ref="billRemindInput"
            v-model="billForm.remindDays"
            :aria-invalid="billErrorField === 'remindDays' || undefined"
            :aria-describedby="billError ? 'bill-form-error' : undefined"
          >
            <option :value="0">当天</option>
            <option :value="1">1 天</option>
            <option :value="3">3 天</option>
            <option :value="7">7 天</option>
          </select>
        </label>
      </div>
      <label class="bill-field bill-field-wide">
        <span>备注 <em>选填</em></span>
        <input v-model="billForm.note" placeholder="补充套餐、用途等信息" />
      </label>
      <div class="bill-form-grid">
        <label class="bill-field">
          <span>账户 <em>选填</em></span>
          <input v-model="billForm.account" placeholder="留空则用默认账户" />
        </label>
        <!-- 账单币种：支付后生成的交易会沿用同一个币种（payBill 里透传） -->
        <label class="bill-field">
          <span>币种 <em>手工维护汇率</em></span>
          <select v-model="billForm.currency" aria-label="固定账单使用的币种">
            <option v-for="code in currencyChoices(fx, [billForm.currency])" :key="code" :value="code">{{ code === baseCurrency ? `${code}（基准）` : code }}</option>
          </select>
        </label>
      </div>
      <div class="bill-options">
        <label class="bill-switch">
          <input v-model="billForm.autoRenew" type="checkbox" />
          <span class="switch-track" aria-hidden="true"><i></i></span>
          <span><b>自动续费</b><small>到期后自动推进到下一周期</small></span>
        </label>
        <label class="bill-switch">
          <input v-model="billForm.active" type="checkbox" />
          <span class="switch-track" aria-hidden="true"><i></i></span>
          <span><b>使用中</b><small>关闭后暂停提醒</small></span>
        </label>
      </div>
      <p v-if="editingBillId" class="form-note">修改只影响之后的周期，不会改动已经生成的历史记录；需要改本期请直接修改「什么时候」的日期。</p>
      <p v-if="billError" id="bill-form-error" class="bill-error" role="alert">{{ billError }}</p>
      <div class="bill-form-actions">
        <button v-if="editingBillId" class="btn btn-danger" type="button" @click="requestDelete">删除</button>
        <button class="btn" type="button" @click="formOpen = false">取消</button>
        <button class="btn btn-primary" type="button" @click="saveBill">保存</button>
      </div>
    </div>
  </Modal>

  <ConfirmDialog
    :open="Boolean(deleteBillTarget)"
    title="删除固定账单"
    :message="`确定删除固定账单“${deleteBillTarget?.name || ''}”吗？不会删除已经生成的历史记录。`"
    confirm-label="删除"
    @close="deleteBillTarget = null"
    @confirm="confirmDeleteBill"
  />
</template>

<script setup>
/**
 * 添加 / 编辑固定账单弹窗（从 LedgerView.vue 拆出）。
 *
 * 打开入口在页面侧：首页与固定账单面板都 emit `open-bill-form`，页面把
 * `billFormEl.value?.open(prefill, editing)` 转给这里 —— 状态与校验都在本文件，
 * 页面只留一句转发，避免「表单开着」这件事散落在两处。
 *
 * 删除走 ConfirmDialog：点「删除」先关表单、再弹确认（与拆分前的顺序一致），
 * 确认后调用 domain.deleteBill。
 */
import { ref, watch } from 'vue'
import Modal from '../../components/Modal.vue'
import ConfirmDialog from '../../components/ConfirmDialog.vue'
import { activeCategories, detectCategory, normalizeAmount } from '../../composables/ledger.js'
import { currencyChoices, normalizeCurrency, useLedgerFx } from '../../composables/ledgerFx.js'
import { templateToBillForm, useLedgerTemplateCommands } from '../../composables/ledgerTemplates.js'
import { currencySymbol } from '../../utils/formatters.js'

// 周期字典与 BillsPanel 收到的那份是同一组文案（页面侧另有一份同名常量）。
const CYCLES = {
  weekly: { label: '每周', short: '周', monthFactor: 52 / 12 },
  monthly: { label: '每月', short: '月', monthFactor: 1 },
  quarterly: { label: '每季度', short: '季度', monthFactor: 1 / 3 },
  yearly: { label: '每年', short: '年', monthFactor: 1 / 12 },
  once: { label: '仅此一次', short: '单次', monthFactor: 0 },
}

const props = defineProps({
  bills: { type: Array, default: () => [] },
  baseCurrency: { type: String, default: 'CNY' },
  domain: { type: Object, required: true },
  notify: { type: Function, default: () => {} },
})

const formOpen = ref(false)
const editingBillId = ref(null)
const billForm = ref(emptyBillForm())
const billError = ref('')
// 与 noteErrorField 同一套约定：记录是哪个字段不过，用于 aria-invalid 与焦点回跳。
const billErrorField = ref('')
const billNameInput = ref(null)
const billAmountInput = ref(null)
const billNextDateInput = ref(null)
const billRemindInput = ref(null)
const billFieldRefs = {
  name: billNameInput,
  amount: billAmountInput,
  nextDate: billNextDateInput,
  remindDays: billRemindInput,
}
const deleteBillTarget = ref(null)
const { fx } = useLedgerFx()

function setBillError(message, field = '') {
  billError.value = message
  billErrorField.value = message ? field : ''
  // 表单开着的时候输入框一定已挂载，不需要等下一帧。
  if (message && field) billFieldRefs[field]?.value?.focus()
}

function emptyBillForm() {
  return { name: '', amount: '', category: '', cycle: 'monthly', nextDate: '', remindDays: 3, autoRenew: true, active: true, note: '', account: '', currency: '' }
}
function pickBillFields(b) {
  if (!b) return emptyBillForm()
  return {
    name: b.name ?? '', amount: b.amount ?? '', category: b.category ?? detectCategory(b.name ?? ''), cycle: b.cycle ?? 'monthly',
    nextDate: b.nextDate ?? '', remindDays: b.remindDays ?? 3,
    autoRenew: b.autoRenew !== false, active: b.active !== false, note: b.note ?? '',
    account: b.account ?? '', currency: normalizeCurrency(b.currency) || props.baseCurrency,
  }
}
/** 页面侧的唯一入口：预填（首页「创建固定账单」）或带 id 进编辑态。 */
function open(prefill = {}, editing = null) {
  editingBillId.value = editing
  billForm.value = editing
    ? { ...props.bills.find((b) => b.id === editing), ...emptyBillForm(), ...pickBillFields(props.bills.find((b) => b.id === editing)) }
    : { ...emptyBillForm(), ...prefill }
  setBillError('')
  deleteBillTarget.value = null
  formOpen.value = true
}
defineExpose({ open })

/* ---------- 账单预设模板（sl_ledger_templates） ---------- */
// 与课程模板同一套形状（useStoredRef + 显式提交 + 中文错误）。
// 这里只负责「套用 / 存为模板 / 删除模板」三个动作，模板内容规范化在 ledgerTemplates.js。
const { templates: billTemplates, saveTemplate: saveBillTemplate, deleteTemplate: deleteBillTemplate } = useLedgerTemplateCommands()
const billTemplateId = ref('')
// 下拉选完立刻复位：否则「先套 A、改了字段、还想再套一次 A」时浏览器不会再触发 change。
watch(billTemplateId, (id) => {
  if (!id) return
  applyBillTemplate(id)
  billTemplateId.value = ''
})
function applyBillTemplate(id) {
  const template = billTemplates.value.find((entry) => entry.id === id)
  if (!template) return
  // 只覆盖模板保存过的字段；`nextDate` 不在模板里，所以「下次支付日期」保持用户当前的值。
  billForm.value = { ...billForm.value, ...templateToBillForm(template) }
  setBillError('')
  props.notify(`已套用模板「${template.name}」（下次支付日期保持不变）`)
}
function saveBillAsTemplate() {
  const f = billForm.value
  const name = String(f.name || '').trim() || '未命名账单模板'
  const existing = billTemplates.value.find((entry) => entry.name === name)
  try {
    // 同名模板按 id 覆盖（改），避免同一个账单越存越多份。
    // `nextDate` 不在模板白名单里（见 ledgerTemplates.js），传了也不会被保存。
    saveBillTemplate({ id: existing?.id, name, bill: f })
  } catch (cause) {
    setBillError(cause?.message || '存为模板失败')
    return
  }
  props.notify(existing ? `已更新模板「${name}」` : `已存为模板「${name}」`)
}
function removeBillTemplate(id) {
  const removed = deleteBillTemplate(id)
  if (removed) props.notify(`已删除模板「${removed.name}」`)
}
function saveBill() {
  const f = billForm.value
  const amount = normalizeAmount(f.amount)
  if (!f.name.trim()) { setBillError('请填写名称', 'name'); return }
  if (amount === null) { setBillError('金额需大于 0，且最多保留两位小数', 'amount'); return }
  if (!f.nextDate) { setBillError('请选择下次支付日期', 'nextDate'); return }
  if (!Number.isFinite(Number(f.remindDays)) || Number(f.remindDays) < 0) { setBillError('提前提醒天数不能小于 0', 'remindDays'); return }
  const data = {
    name: f.name.trim(), amount, category: f.category || detectCategory(f.name), cycle: f.cycle,
    nextDate: f.nextDate, remindDays: Number(f.remindDays) || 0,
    autoRenew: f.autoRenew, active: f.active, note: f.note.trim(),
    // 新增可选字段：账户与币种。账户留空时 createBill 仍回落到默认账户（既有行为不变）。
    account: String(f.account || '').trim(),
    currency: currencyField(f.currency),
    updatedAt: new Date().toISOString(),
  }
  try {
    if (editingBillId.value) {
      if (!props.domain.updateBill(editingBillId.value, data)) {
        setBillError('这条固定账单已不存在，请关闭后重新选择。')
        return
      }
      props.notify(`已更新固定账单「${data.name}」（只影响之后，历史记录不变）`)
    } else {
      props.domain.createBill({ ...data, createdFrom: 'manual' })
      props.notify(`已添加固定账单「${data.name}」`)
    }
  } catch (cause) {
    setBillError(cause instanceof Error ? cause.message : '保存失败，请重试。')
    return
  }
  formOpen.value = false
}
function requestDelete() {
  const bill = props.bills.find((x) => x.id === editingBillId.value)
  if (bill) deleteBillTarget.value = bill
  formOpen.value = false
}
function confirmDeleteBill() {
  const bill = deleteBillTarget.value
  if (!bill) return
  props.domain.deleteBill(bill.id)
  deleteBillTarget.value = null
  props.notify(`已删除「${bill.name}」`)
}
/** 币种留空/非法时按基准币种处理（与页面里的 currencyField 同一规则）。 */
function currencyField(code) {
  const normalized = normalizeCurrency(code)
  return normalized || props.baseCurrency
}
</script>

<style scoped>
/* 与预算 / 汇率弹窗共用的「表单列」排版：scoped 样式不跨组件边界，各带一份
   （见 LedgerView.vue 的 style 块顶部说明）。 */
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
.bill-money-input {
  position:relative}
.bill-money-input b {
  color:var(--ink-faint);
  pointer-events:none;
  font-size:var(--fs-14);
  position:absolute;
  top:50%;
  left:13px;
  transform:translateY(-50%)}
.bill-money-input input {
  padding-left:31px}
.bill-options {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.bill-switch {
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  align-items:center;
  gap:10px;
  min-width:0;
  padding:11px 12px;
  display:flex}
.bill-switch>input {
  opacity:0;
  pointer-events:none;
  width:1px;
  height:1px;
  position:absolute}
.bill-switch>span:last-child {
  flex-direction:column;
  gap:1px;
  min-width:0;
  display:flex}
.bill-switch b {
  font-size:var(--fs-12-5)}
.bill-switch small {
  color:var(--ink-faint);
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-10);
  overflow:hidden}
.switch-track {
  width:34px;
  height:20px;
  transition:background var(--dur-base) var(--ease-standard);
  background:#cbd2df;
  border-radius:var(--radius-pill);
  flex:0 0 34px;
  position:relative}
.switch-track i {
  width:14px;
  height:14px;
  transition:transform var(--dur-base) var(--ease-standard);
  background:#fff;
  border-radius:var(--radius-circle);
  position:absolute;
  top:3px;
  left:3px;
  box-shadow:0 1px 3px #1e284638}
.bill-switch>input:checked+.switch-track {
  background:var(--primary)}
.bill-switch>input:checked+.switch-track i {
  transform:translate(14px)}
.bill-switch>input:focus-visible+.switch-track {
  outline:2px solid var(--primary);
  outline-offset:2px}
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
.p-close {
  color:var(--ink-faint);
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:var(--radius-7);
  width:26px;
  height:26px;
  font-size:var(--fs-12)}
.p-close:hover {
  color:var(--ink-soft);
  background:var(--bg)}
@media (max-width:520px) {
  .bill-form {
  gap:14px}
.bill-form-grid,.bill-options {
  grid-template-columns:1fr}
.bill-switch small {
  white-space:normal}
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
