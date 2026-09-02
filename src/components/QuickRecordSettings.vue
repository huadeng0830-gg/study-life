<script setup>
import { computed } from 'vue'
import Modal from './Modal.vue'
import { settings, settingsPolicy, TIMEZONE_OPTIONS } from '../composables/settingsPolicy.js'
const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

function updateSettings(patch) {
  settings.value = { ...settings.value, ...patch }
}
function updateReminder(type, value) {
  updateSettings({ defaultReminders: { ...(settings.value.defaultReminders || {}), [type]: Math.max(0, Number(value) || 0) } })
}
const timezone = computed({ get: () => settingsPolicy.value.timezone, set: (value) => updateSettings({ timezone: value }) })
const defaultAccount = computed({ get: () => settingsPolicy.value.defaultAccount, set: (value) => updateSettings({ defaultAccount: value }) })
const taskReminder = computed({ get: () => settingsPolicy.value.defaultReminders.task, set: (value) => updateReminder('task', value) })
const eventReminder = computed({ get: () => settingsPolicy.value.defaultReminders.event, set: (value) => updateReminder('event', value) })
const milestoneReminder = computed({ get: () => settingsPolicy.value.defaultReminders.milestone, set: (value) => updateReminder('milestone', value) })
</script>

<template>
  <Modal :open="open" title="⚡ 快速记录设置" @close="emit('close')">
    <div class="settings">
      <label><input v-model="settings.clipboardHint" type="checkbox" /> <span><b>提示剪贴板内容</b><small>打开快速记录时仅提示可识别文本，不会自动创建记录。</small></span></label>
      <label><span><b>日期与时间</b><small>今天页、提醒和快速记录使用同一时区计算。</small></span><select v-model="timezone"><option v-for="item in TIMEZONE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
      <label><span><b>默认账户</b><small>未在记录中说明账户时，普通记账和快速记录都使用此值。</small></span><input v-model.trim="defaultAccount" placeholder="例如：微信 / 现金" /></label>
      <div class="policy-grid">
        <label><span><b>待办提醒（分钟）</b></span><input v-model.number="taskReminder" type="number" min="0" step="5" /></label>
        <label><span><b>日程提醒（分钟）</b></span><input v-model.number="eventReminder" type="number" min="0" step="5" /></label>
        <label><span><b>节点提醒（分钟）</b></span><input v-model.number="milestoneReminder" type="number" min="0" step="5" /></label>
      </div>
      <p>全局入口：手机底部「＋记录」；桌面侧栏按钮或 Ctrl/Cmd + K。</p>
    </div>
  </Modal>
</template>

<style scoped>
.settings{display:flex;flex-direction:column;gap:14px}.settings label{display:flex;gap:10px;align-items:flex-start;color:var(--text)}.settings label > span{flex:1}.settings input{margin-top:3px;accent-color:var(--primary)}.settings select,.settings label > input:not([type="checkbox"]){min-width:150px}.settings b,.settings small{display:block}.settings small,.settings p{margin-top:4px;color:var(--ink-soft);font-size:12px;line-height:1.55}.policy-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.policy-grid label{display:block}.policy-grid input{width:100%;margin-top:6px}.settings p{margin-bottom:0;padding:9px 10px;border-radius:8px;background:var(--bg)}
@media (max-width: 520px){.policy-grid{grid-template-columns:1fr}.settings select,.settings label > input:not([type="checkbox"]){min-width:0;width:100%}}
</style>
