<script setup>
import { taskFocusLocation } from '../../composables/learningFocus.js'
defineProps({ task: { type: Object, required: true }, minutes: { type: Number, default: 25 } })
defineEmits(['navigate'])
</script>

<template>
  <RouterLink class="task-focus-link" :to="taskFocusLocation(task, minutes)" :aria-label="`为${task.title}准备${minutes}分钟专注`" @click.stop="$emit('navigate')">专注 {{ minutes }} 分钟</RouterLink>
</template>

<style scoped>
.task-focus-link { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 5px 8px; border-radius: var(--radius-8); color: var(--primary); background: var(--primary-soft); font-size: var(--fs-12); font-weight: var(--fw-700); line-height: 1.5; text-decoration: none; white-space: nowrap; }
.task-focus-link:hover { text-decoration: underline; }
@media (pointer: coarse) { .task-focus-link { min-height: var(--tap-min); } }
</style>
