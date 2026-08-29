<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { detectCategory, expenses, parseNatural } from '../composables/ledger.js'
import { todayStr } from '../composables/store'

const emit = defineEmits(['close'])
const name = ref('')
const amount = ref('')
const message = ref('')
const nameInput = ref(null)

onMounted(() => nextTick(() => nameInput.value?.focus()))

function onNameInput() {
  message.value = ''
  const parsed = parseNatural(name.value)
  if (parsed.amount && amount.value === '') amount.value = parsed.amount
}

function save() {
  const parsed = parseNatural(name.value)
  const expenseName = (parsed.name || name.value).trim()
  const expenseAmount = Number(amount.value || parsed.amount)
  if (!expenseName) {
    message.value = '写一下花在什么上'
    return
  }
  if (!(expenseAmount > 0)) {
    message.value = '请输入正确金额'
    return
  }

  const current = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  expenses.value.push({
    id: `expense${Date.now()}`,
    name: expenseName,
    amount: expenseAmount,
    cat: detectCategory(expenseName),
    date: todayStr(),
    time: `${pad(current.getHours())}:${pad(current.getMinutes())}`,
    note: '',
    source: 'manual',
    billId: '',
    createdAt: current.toISOString(),
    updatedAt: current.toISOString(),
  })
  name.value = ''
  amount.value = ''
  message.value = `已记下 ${expenseName} · ¥${expenseAmount.toFixed(2)}`
  nextTick(() => nameInput.value?.focus())
}
</script>

<template>
  <section class="quick-ledger-panel" aria-labelledby="global-ledger-title">
    <div class="panel-copy">
      <span class="panel-icon" aria-hidden="true">¥</span>
      <div>
        <h2 id="global-ledger-title">记账</h2>
        <p>直接写“午饭 18”也可以</p>
      </div>
    </div>
    <form class="panel-form" @submit.prevent="save">
      <label class="name-field">
        <span class="sr-only">消费名称</span>
        <input ref="nameInput" v-model="name" autocomplete="off" placeholder="花在什么上？" @input="onNameInput" />
      </label>
      <label class="amount-field">
        <span>¥</span>
        <input v-model="amount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="金额" />
      </label>
      <button type="submit" class="save-button">记下</button>
    </form>
    <button type="button" class="close-button" aria-label="收起快速记账" title="收起" @click="emit('close')">×</button>
    <p v-if="message" class="message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.quick-ledger-panel {
  position: relative;
  display: grid;
  grid-template-columns: minmax(190px, .65fr) minmax(380px, 1.5fr) auto;
  align-items: center;
  gap: 18px;
  margin-bottom: 18px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, var(--primary) 20%, var(--border));
  border-radius: 16px;
  background: color-mix(in srgb, var(--card) 94%, var(--primary-soft));
  box-shadow: var(--shadow-sm);
}
.panel-copy { display: flex; align-items: center; gap: 11px; min-width: 0; }
.panel-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 850;
}
h2 { margin: 0; font-size: 16px; }
.panel-copy p { margin: 3px 0 0; color: var(--ink-faint); font-size: 11.5px; }
.panel-form { display: grid; grid-template-columns: minmax(150px, 1fr) 120px auto; gap: 8px; }
.panel-form label { min-width: 0; }
.panel-form input {
  width: 100%;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--text);
  outline: none;
  padding: 0 12px;
}
.panel-form input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.amount-field { position: relative; }
.amount-field span { position: absolute; left: 11px; top: 10px; z-index: 1; color: var(--muted); }
.amount-field input { padding-left: 27px; }
.save-button {
  min-width: 68px;
  border: none;
  border-radius: 10px;
  background: var(--primary);
  color: #fff;
  font-weight: 750;
}
.close-button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--muted);
  font-size: 22px;
}
.close-button:hover { background: var(--bg); color: var(--text); }
.message { grid-column: 2 / 4; margin: -10px 0 0; color: var(--primary); font-size: 12px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1080px) {
  .quick-ledger-panel { grid-template-columns: 1fr auto; }
  .panel-form { grid-column: 1 / -1; grid-row: 2; }
  .close-button { grid-column: 2; grid-row: 1; }
  .message { grid-column: 1 / -1; }
}

@media (max-width: 560px) {
  .quick-ledger-panel { position: fixed; right: 12px; bottom: calc(78px + env(safe-area-inset-bottom)); left: 12px; z-index: 60; gap: 12px; margin: 0; padding: 14px; border-radius: 16px; box-shadow: 0 14px 40px rgba(25, 42, 84, .2); }
  .panel-copy p { display: none; }
  .panel-form { grid-template-columns: minmax(0, 1fr) 104px; }
  .save-button { grid-column: 1 / -1; height: 40px; }
}
</style>
