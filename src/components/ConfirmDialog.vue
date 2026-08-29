<script setup>
import Modal from './Modal.vue'
defineProps({ open: Boolean, title: { type: String, default: '确认操作' }, message: { type: String, default: '' }, confirmLabel: { type: String, default: '确认' } })
defineEmits(['confirm', 'close'])
</script>
<template><Modal :open="open" :title="title" @close="$emit('close')"><p class="message">{{ message }}</p><template #foot><div class="actions"><button class="btn btn-ghost" @click="$emit('close')">取消</button><button class="btn btn-danger" @click="$emit('confirm')">{{ confirmLabel }}</button></div></template></Modal></template>
<style scoped>.message{margin:0;color:var(--ink-soft);line-height:1.6}.actions{display:flex;justify-content:flex-end;gap:9px}</style>
