<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: 'none' },
  title: { type: String, required: true },
  options: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])

const optionColors = {
  none: 'muted',
  complete: 'success',
  edit: 'primary',
  delete: 'danger',
}
const optionIcons = {
  none: '➖',
  complete: '✅',
  edit: '✏️',
  delete: '🗑️',
}
const colorMap = {
  success: { bg: '#e7f8f1', border: '#14966d', text: '#067654' },
  primary: { bg: 'var(--primary-soft)', border: 'var(--primary)', text: 'var(--primary)' },
  danger: { bg: '#feecec', border: '#c62828', text: '#c62828' },
  muted: { bg: '#f3f4f6', border: '#9ca3af', text: '#5f6775' },
}

const selectStyle = computed(() => {
  const selected = props.options.find((option) => option.id === props.modelValue) || props.options[0]
  return colorMap[optionColors[selected?.id] || 'muted']
})
</script>

<template>
  <label class="swipe-action-card">
    <span class="swipe-action-title">{{ title }}</span>
    <select
      class="swipe-action-select"
      :value="modelValue"
      :style="selectStyle"
      @change="emit('update:modelValue', $event.target.value)"
    >
      <option v-for="option in options" :key="option.id" :value="option.id">
        {{ optionIcons[option.id] || '' }} {{ option.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.swipe-action-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
  background: var(--card);
}
.swipe-action-title {
  color: var(--text);
  font-size: var(--fs-13);
  font-weight: var(--fw-600);
}
.swipe-action-select {
  flex: 1;
  padding: 8px 10px;
  border: 2px solid transparent;
  border-radius: var(--radius-6);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font-weight: var(--fw-600);
  transition: border-color var(--dur-fast) var(--ease-standard);
}
.swipe-action-select:hover { border-color: var(--border); }
</style>
