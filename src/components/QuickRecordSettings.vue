<script setup>
import Modal from './Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const settings = useStoredRef('sl_quick_record_settings', { clipboardHint: true, recentTypes: [] })
</script>

<template>
  <Modal :open="open" title="⚡ 快速记录设置" @close="emit('close')">
    <div class="settings">
      <label><input v-model="settings.clipboardHint" type="checkbox" /> <span><b>提示剪贴板内容</b><small>打开快速记录时仅提示可识别文本，不会自动创建记录。</small></span></label>
      <p>全局入口：手机底部「＋记录」；桌面侧栏按钮或 Ctrl/Cmd + K。</p>
    </div>
  </Modal>
</template>

<style scoped>
.settings{display:flex;flex-direction:column;gap:14px}.settings label{display:flex;gap:10px;align-items:flex-start;color:var(--text)}.settings input{margin-top:3px;accent-color:var(--primary)}.settings b,.settings small{display:block}.settings small,.settings p{margin-top:4px;color:var(--ink-soft);font-size:12px;line-height:1.55}.settings p{margin-bottom:0;padding:9px 10px;border-radius:8px;background:var(--bg)}
</style>
