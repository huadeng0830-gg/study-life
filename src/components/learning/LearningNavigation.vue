<script setup>
defineProps({ current: { type: String, required: true } })
const pages = [
  { path: '/schedule', label: '课程表', id: 'schedule' },
  { path: '/course', label: '课程进度', id: 'course' },
  { path: '/tasks', label: '待办', id: 'tasks' },
  { path: '/exams', label: '重要日期', id: 'exams' },
  { path: '/review', label: '回顾', id: 'review' },
]
</script>

<template>
  <nav class="learning-navigation" aria-label="学习功能">
    <RouterLink v-for="page in pages" :key="page.id" :to="page.path" :class="{ selected: current === page.id }" :aria-current="current === page.id ? 'page' : undefined">{{ page.label }}</RouterLink>
  </nav>
</template>

<style scoped>
.learning-navigation { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--card); }
.learning-navigation a { display: flex; flex: 1; align-items: center; justify-content: center; min-height: 36px; padding: 5px 9px; border-radius: var(--radius-9); color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); text-decoration: none; white-space: nowrap; }
.learning-navigation a.selected { color: var(--primary); background: var(--primary-soft); }
.learning-navigation a:hover { color: var(--primary); }
@media (max-width: 520px) { .learning-navigation { gap: 0; } .learning-navigation a { min-height: 40px; padding: 4px 5px; font-size: var(--fs-11); } }
@media (pointer: coarse) { .learning-navigation a { min-height: var(--tap-min); } }
</style>
