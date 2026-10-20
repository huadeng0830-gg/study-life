<script setup>
import NoticeUnderstanding from './NoticeUnderstanding.vue'

const props = defineProps({ open: Boolean, tasks: { type: Array, default: () => [] }, courses: { type: Array, default: () => [] }, initialText: { type: String, default: '' } })
const emit = defineEmits(['close', 'commit'])
</script>

<template>
  <!-- 兼容旧调用方：旧组件名仍可用，但保存链路只有 NoticeUnderstanding。 -->
  <NoticeUnderstanding
    v-if="open"
    :open="open"
    :tasks="tasks"
    :courses="courses"
    :initial-text="props.initialText"
    @close="emit('close')"
    @commit="emit('commit', $event)"
  />
</template>
