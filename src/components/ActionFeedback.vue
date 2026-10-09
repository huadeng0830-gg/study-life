<script setup>
import { useId } from 'vue'

defineProps({
  message: { type: String, default: '' },
  tone: { type: String, default: 'info' },
  retryable: Boolean,
  busy: Boolean,
  announce: { type: Boolean, default: true },
})
defineEmits(['retry'])
const feedbackId = useId()
defineExpose({ feedbackId })
</script>

<template>
  <div :id="feedbackId" class="action-feedback" :class="`action-feedback-${tone}`" :role="announce ? tone === 'error' ? 'alert' : 'status' : undefined" aria-atomic="true">
    <span>{{ message }}</span>
    <button v-if="message && retryable" type="button" class="link-btn" :disabled="busy" @click="$emit('retry')">重试</button>
  </div>
</template>

<style scoped>
.action-feedback{display:flex;align-items:center;flex-wrap:wrap;gap:6px;flex-basis:100%;min-width:0;color:var(--ink-soft);font-size:var(--fs-12);line-height:1.5}
.action-feedback>span{overflow-wrap:anywhere}
.action-feedback-error{color:var(--danger)}
.action-feedback-success{color:var(--success)}
.action-feedback .link-btn{min-height:40px;color:inherit}
@media(pointer:coarse){.action-feedback .link-btn{min-height:var(--tap-min)}}
</style>
