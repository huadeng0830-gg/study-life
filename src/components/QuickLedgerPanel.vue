<script setup>
import QuickRecordPanel from './QuickRecordPanel.vue'

defineProps({
  open: Boolean,
  initialText: { type: String, default: '' },
})

const emit = defineEmits(['close', 'saved'])
</script>

<template>
  <!-- 兼容旧调用方：旧组件名仍可用，但保存链路只有 QuickRecord。 -->
  <QuickRecordPanel
    :open="open"
    :initial-text="initialText"
    :context="{ preferredType: 'expense' }"
    @saved="emit('saved', $event)"
    @close="emit('close')"
  />
</template>
