<script setup>
import NoticeUnderstanding from './NoticeUnderstanding.vue'

defineProps({ open: Boolean, tasks: { type: Array, default: () => [] }, courses: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'commit'])
</script>

<template>
  <!-- 兼容旧调用方：旧组件名仍可用，但保存链路只有 NoticeUnderstanding。 -->
  <NoticeUnderstanding
    v-if="open"
    :open="open"
    :tasks="tasks"
    :courses="courses"
    @close="emit('close')"
    @commit="emit('commit', $event)"
  />
</template>
