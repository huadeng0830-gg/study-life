<script setup>
import { defineProps, defineEmits, ref, computed, watch, nextTick } from 'vue'
import Modal from '../../components/Modal.vue'
import QuickRecordPanel from '../../components/QuickRecordPanel.vue'
import { activeCategories, detectCategory, parseNatural, ledgerIndex, ledgerCategories, commonCategories } from '../../composables/ledger.js'
import { splitCentsEvenly } from '../../composables/ledgerSplit.js'
import { currencyChoices, normalizeCurrency, useLedgerFx } from '../../composables/ledgerFx.js'
import { defaultAccount, policyTimeKey } from '../../composables/settingsPolicy.js'
import { appNow, appToday, formatAppDate } from '../../composables/timeContext.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  editingId: { type: [String, Number, null], default: null },
  keepAdding: { type: Boolean, default: false },
  baseCurrency: { type: String, required: true },
  currencyOptions: { type: Array, required: true },
  quickCatChips: { type: Array, required: true },
  showAllQuickCategories: { type: Boolean, default: false },
  directionInput: { type: String, default: 'expense' },
  amountInput: { type: String, default: '' },
  nameInput: { type: String, default: '' },
  catInput: { type: String, default: '' },
  dateInput: { type: String, default: '' },
  timeInput: { type: String, default: '' },
  noteInput: { type: String, default: '' },
  accountInput: { type: String, default: '' },
  sourceInput: { type: String, default: 'manual' },
  billIdInput: { type: String, default: '' },
  currencyInput: { type: String, default: '' },
  splitCount: { type: String, default: '1' },
  splitMine: { type: String, default: '' },
  dupWarn: { type: Boolean, default: false },
  forceDup: { type: Boolean, default: false },
  cycleSuggest: { type: Object, default: null },
  moreOpen: { type: Boolean, default: false },
  savingExpense: { type: Boolean, default: false },
  categoryInputManuallySelected: { type: Boolean, default: false },
  suggestedCategoryInput: { type: String, default: '' },
  duplicateHit: { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:open',
  'update:editingId',
  'update:keepAdding',
  'update:amountInput',
  'update:nameInput',
  'update:catInput',
  'update:dateInput',
  'update:timeInput',
  'update:noteInput',
  'update:accountInput',
  'update:sourceInput',
  'update:billIdInput',
  'update:currencyInput',
  'update:splitCount',
  'update:splitMine',
  'update:showAllQuickCategories',
  'update:directionInput',
  'update:moreOpen',
  'update:dupWarn',
  'update:forceDup',
  'update:cycleSuggest',
  'update:categoryInputManuallySelected',
  'update:suggestedCategoryInput',
  'save',
  'close',
  'open-quick-record',
  'quick-record-saved',
  'select-category',
  // 「创建固定账单」按钮（在识别出周期建议时出现）要交给页面打开账单表单。
  // 之前只在 createBillFromSuggest 里 emit 了它，却没登记进 defineEmits、页面也没监听，
  // 结果点下去只把记一笔弹窗关掉，草稿直接丢了，用户什么反馈都收不到。
  'open-bill-form',
])

const { fx } = useLedgerFx()

const amountEl = ref(null)

const ledgerNowHM = () => policyTimeKey(appNow.value)
const ledgerToday = () => appToday.value

// 本地镜像状态：直接响应输入事件，解决测试直接设值不触发父级 props 更新的问题
const localAmountInput = ref(props.amountInput)
const localSplitCount = ref(props.splitCount)
const localCurrencyInput = ref(props.currencyInput)
const localSplitMine = ref(props.splitMine)

watch(() => props.amountInput, v => { localAmountInput.value = v })
watch(() => props.splitCount, v => { localSplitCount.value = v })
watch(() => props.currencyInput, v => { localCurrencyInput.value = v })
watch(() => props.splitMine, v => { localSplitMine.value = v })

// 本地计算分摊预览（读取本地镜像状态，兼容测试直接设值的场景）
const localSplitPreview = computed(() => {
  const amountValue = localAmountInput.value
  const splitCountValue = localSplitCount.value
  const currencyValue = localCurrencyInput.value
  
  const totalCents = parseAmount(amountValue)
  const people = Math.trunc(Number(splitCountValue)) || 1
  if (totalCents === null || !Number.isFinite(people) || people < 1) return ''
  const shares = splitCentsEvenly(totalCents, people)
  const mine = shares[0] / 100
  const others = (totalCents - shares[0]) / 100
  return people === 1
    ? `单人承担 ${moneyWithCurrency(mine, currencyValue || 'CNY')}`
    : `共 ${people} 人：我承担 ${moneyWithCurrency(mine, currencyValue || 'CNY')}，其余 ${moneyWithCurrency(others, currencyValue || 'CNY')}`
})

function parseAmount(v) {
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}

function syncSplitMine() {
  const totalCents = parseAmount(props.amountInput)
  const people = Math.trunc(Number(props.splitCount))
  if (totalCents === null || !Number.isFinite(people) || people < 1) { emit('update:splitMine', ''); return }
  const parts = splitCentsEvenly(totalCents, people)
  emit('update:splitMine', String(parts[0] / 100))
}

function onSplitChange() {
  syncSplitMine()
}

function setDirection(direction) {
  emit('update:directionInput', direction)
  const validCategory = activeCategories(direction).some((category) => category.key === props.catInput)
  if (props.categoryInputManuallySelected && validCategory) return
  emit('update:categoryInputManuallySelected', false)
  const name = parseNatural(props.nameInput).name || props.nameInput.trim()
  const suggested = name ? detectCategory(name, { direction }) : ''
  emit('update:suggestedCategoryInput', suggested)
  emit('update:catInput', suggested)
}

function onNameInput() {
  emit('update:dupWarn', false)
  emit('update:forceDup', false)
  if (props.editingId) return
  const parsed = parseNatural(props.nameInput)
  if (parsed.amount && props.amountInput === '' && parsed.name && parsed.name !== props.nameInput) {
    emit('update:nameInput', parsed.name)
  }
  if (parsed.amount && props.amountInput === '') emit('update:amountInput', parsed.amount)
  if (parsed.cycle && !props.catInput) emit('update:cycleSuggest', parsed.cycle)
  if (!props.catInput && parsed.name) {
    const suggested = detectCategory(parsed.name || props.nameInput, { direction: props.directionInput })
    emit('update:suggestedCategoryInput', suggested)
    emit('update:catInput', suggested)
    emit('update:categoryInputManuallySelected', false)
  }
}

function selectQuickCategory(key) {
  emit('update:catInput', props.catInput === key ? '' : key)
  emit('update:categoryInputManuallySelected', true)
}

async function saveExpense(keepOpen = false) {
  emit('save', keepOpen)
}

function closeQuick() {
  emit('update:keepAdding', false)
  emit('close')
}

function openQuickRecord() {
  emit('open-quick-record')
}

function onQuickRecordSaved(payload) {
  emit('quick-record-saved', payload)
}

function createBillFromSuggest() {
  const s = props.cycleSuggest
  const parsed = parseNatural(props.nameInput)
  const prefill = {
    name: parsed.name || props.nameInput.trim(),
    amount: props.amountInput || parsed.amount || '',
    cycle: s?.kind ?? 'monthly',
  }
  emit('update:open', false)
  emit('open-bill-form', prefill)
}
</script>

<template>
<Modal :open="open" :title="editingId ? '编辑记录' : keepAdding ? '再记一笔' : '记一笔'" @close="closeQuick">
  <div class="quick-form">
    <button v-if="!editingId" class="natural-entry-link" type="button" @click="openQuickRecord">⚡ 用一句话记</button>
    <input
      ref="amountEl"
      :value="localAmountInput"
      @input="e => { localAmountInput = e.target.value; $emit('update:amountInput', e.target.value) }"
      class="amount-input"
      type="text"
      inputmode="decimal"
      placeholder="0.00"
      autocomplete="off"
      aria-label="金额"
      @keydown.enter="saveExpense(keepAdding)"
    />
    <div v-if="!editingId" class="direction-toggle" role="group" aria-label="选择收支类型">
       <button type="button" :class="{ on: directionInput === 'expense' }" @click="setDirection('expense')">支出</button>
       <button type="button" :class="{ on: directionInput === 'income' }" @click="setDirection('income')">收入</button>
    </div>
    <input
      :value="nameInput"
      @input="e => { $emit('update:nameInput', e.target.value); onNameInput() }"
      class="name-input"
      aria-label="备注或用途"
      placeholder="买了什么？可不填"
      @keydown.enter="saveExpense(keepAdding)"
    />

    <div v-if="dupWarn" class="dup-warn">
      <span>这笔可能和刚才的一样。</span>
      <div class="dw-actions">
        <button class="btn btn-sm" @click="$emit('update:dupWarn', false); $emit('update:nameInput', '')">取消</button>
        <button class="btn btn-sm btn-primary" @click="$emit('update:forceDup', true); saveExpense(keepAdding)">仍然记录</button>
      </div>
    </div>

    <div v-if="cycleSuggest" class="cycle-suggest">
      <span>检测到周期描述（{{ cycleSuggest.kind === 'weekly' ? '每周' : cycleSuggest.kind === 'yearly' ? '每年' : '每月' }}{{ cycleSuggest.day ? ` ${cycleSuggest.day} 日` : '' }}），是否同时创建固定账单？</span>
      <div class="dw-actions">
        <button class="btn btn-sm" @click="$emit('update:cycleSuggest', null)">只记录一次</button>
        <button class="btn btn-sm btn-ghost" @click="createBillFromSuggest">创建固定账单</button>
      </div>
    </div>

    <button type="button" class="more-toggle" :aria-expanded="moreOpen" @click="$emit('update:moreOpen', !moreOpen)">
      {{ moreOpen ? '收起' : '更多' }} <i>{{ moreOpen ? '▴' : '▾' }}</i>
    </button>

    <div v-show="moreOpen" class="more-area">
      <div class="chip-row cat-chips">
        <button
          v-for="c in quickCatChips"
          :key="c.key"
          class="chip"
          :class="{ on: catInput === c.key }"
           @click="selectQuickCategory(c.key)"
        >{{ c.icon }} {{ c.name }}</button>
      </div>
      <button v-if="activeCategories(directionInput).length > quickCatChips.length" type="button" class="category-more-toggle" :aria-expanded="showAllQuickCategories" @click="$emit('update:showAllQuickCategories', !showAllQuickCategories)">
        {{ showAllQuickCategories ? '只显示常用' : '全部分类' }}
      </button>
     <div class="more-grid">
       <label>日期<input :value="dateInput" @input="e => $emit('update:dateInput', e.target.value)" type="date" /></label>
       <label>时间<input :value="timeInput" @input="e => $emit('update:timeInput', e.target.value)" type="time" /></label>
       <label>账户<input :value="accountInput" @input="e => $emit('update:accountInput', e.target.value)" placeholder="可不填，默认账户" /></label>
<label>币种
          <select :value="localCurrencyInput" @input="e => { localCurrencyInput = e.target.value; $emit('update:currencyInput', e.target.value) }" aria-label="这笔记录使用的币种">
            <option v-for="code in currencyOptions" :key="code" :value="code">{{ code === baseCurrency ? `${code}（基准）` : code }}</option>
          </select>
        </label>
     </div>
     <input :value="noteInput" @input="e => $emit('update:noteInput', e.target.value)" aria-label="备注" placeholder="买了什么？可不填" />
<div class="more-grid">
        <label>参与人数<input :value="localSplitCount" @input="e => { localSplitCount = e.target.value; onSplitChange(); $emit('update:splitCount', e.target.value) }" type="number" min="1" max="99" step="1" inputmode="numeric" /></label>
        <label>我承担<input :value="localSplitMine" type="text" inputmode="decimal" aria-label="我在这一笔里承担的份额（自动计算，可手改）" readonly /></label>
      </div>
     <p v-if="localSplitPreview" class="form-note">{{ localSplitPreview }}</p>
    </div>

    <div class="quick-actions">
      <button class="btn btn-primary save-btn" :disabled="savingExpense" @click="saveExpense(keepAdding)">{{ editingId ? '保存修改' : keepAdding ? '记下一笔' : '记下' }}</button>
      <!-- 连续记模式下这个按钮是「完成」，语义是**退出连续记账**，不是再存一笔。
           原来无论哪种状态都调 saveExpense(true)：连点「完成」会去保存一张空表单
           （金额为空 → 直接 focus 金额框返回），于是「完成」是个走不出去的死胡同，
           用户只能去点遮罩或 ✕。按当前状态分派：连续中就收工，否则才开始连续记。 -->
      <button v-if="!editingId" class="btn btn-ghost" :disabled="savingExpense" @click="keepAdding ? closeQuick() : saveExpense(true)">{{ keepAdding ? '完成' : '连续记' }}</button>
    </div>
  </div>
</Modal>

<QuickRecordPanel
  v-if="$attrs.showQuickRecord"
  :open="$attrs.showQuickRecord"
  :context="{ preferredType: 'expense' }"
  @saved="onQuickRecordSaved"
  @close="$emit('update:showQuickRecord', false)"
/>
</template>

<style scoped>
/* QuickEntryModal 样式：从 LedgerView.vue 迁移，保留原有注释 */
.quick-form {
  flex-direction:column;
  gap:10px;
  display:flex}
.natural-entry-link {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  align-self:flex-end;
  min-height:24px;
  padding:3px 8px;
  font-size:var(--fs-12);
  font-weight:var(--fw-700)}
.natural-entry-link:hover {
  background:var(--primary-soft);
  border-radius:var(--radius-6)}
.amount-input {
  text-align:center;
  letter-spacing:.02em;
  font-variant-numeric:tabular-nums;
  width:100%;
  padding:12px 14px;
  font-size:var(--fs-26);
  font-weight:var(--fw-800)}
.direction-toggle {
  background:var(--bg-tint);
  border-radius:var(--radius-10);
  grid-template-columns:1fr 1fr;
  gap:4px;
  padding:3px;
  display:grid}
.direction-toggle button {
  min-height:36px;
  color:var(--ink-soft);
  cursor:pointer;
  background:0 0;
  border:0;
  border-radius:var(--radius-8);
  font-size:var(--fs-13);
  font-weight:var(--fw-750)}
.direction-toggle button.on {
  color:var(--primary);
  background:var(--card);
  box-shadow:var(--shadow-sm)}
.name-input {
  width:100%;
  padding:11px 13px;
  font-size:var(--fs-14-5)}
.more-toggle {
  color:var(--ink-faint);
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:var(--radius-7);
  align-self:flex-start;
  padding:4px 8px;
  font-size:var(--fs-12);
  font-weight:var(--fw-600)}
.more-toggle:hover {
  color:var(--primary);
  background:var(--primary-soft)}
.more-toggle i {
  margin-left:4px;
  font-size:var(--fs-10);
  font-style:normal}
.more-area {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  flex-direction:column;
  gap:10px;
  padding:12px;
  display:flex}
.cat-chips .chip {
  height:32px;
  padding:0 12px;
  font-size:var(--fs-12)}
.more-grid {
  grid-template-columns:1fr 1fr;
  gap:10px;
  display:grid}
.category-more-toggle {
  color:var(--primary);
  cursor:pointer;
  background:0 0;
  border:0;
  align-self:flex-start;
  min-height:24px;
  padding:2px 8px;
  font-size:var(--fs-11-5)}
.more-grid label {
  color:var(--ink-soft);
  flex-direction:column;
  gap:5px;
  font-size:var(--fs-11-5);
  display:flex}
.quick-actions {
  gap:8px;
  margin-top:4px;
  display:flex}
.save-btn {
  flex:1;
  height:44px;
  font-size:var(--fs-15)}
.quick-actions .btn-ghost {
  height:44px}
.dup-warn,.cycle-suggest {
  color:var(--warning);
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:var(--bg-tint);
  border-radius:var(--radius-10);
  flex-direction:column;
  gap:8px;
  padding:10px 12px;
  font-size:var(--fs-12-5);
  display:flex}
.cycle-suggest {
  color:var(--ink-soft);
  border-color:var(--border);
  background:var(--bg-tint)}
.dw-actions {
  justify-content:flex-end;
  gap:8px;
  display:flex}
@media (max-width:520px) {
.quick-actions {
  flex-direction:column-reverse}
.quick-actions .btn {
  width:100%}
}
</style>