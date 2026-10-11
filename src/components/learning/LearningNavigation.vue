<script setup>
import { Button } from '../ui/button'
import { useMediaQuery } from '@vueuse/core'

const mobileLayout = useMediaQuery('(max-width: 900px), (pointer: coarse) and (max-height: 520px)')

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
  <details class="learning-navigation" :open="!mobileLayout">
    <summary>学习功能 · {{ pages.find(page => page.id === current)?.label }}</summary>
    <nav aria-label="学习功能">
    <Button v-for="page in pages" :key="page.id" as-child variant="ghost" class="whitespace-normal" :class="{ selected: current === page.id }">
      <RouterLink :to="page.path" :aria-current="current === page.id ? 'page' : undefined">{{ page.label }}</RouterLink>
    </Button>
    </nav>
  </details>
</template>

<style scoped>
.learning-navigation { padding: 4px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--card); }
.learning-navigation nav { display: flex; gap: 4px; }
.learning-navigation summary { display: none; }
.learning-navigation a { display: flex; flex: 1; align-items: center; justify-content: center; min-height: 36px; padding: 5px 9px; border-radius: var(--radius-9); color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); text-decoration: none; white-space: nowrap; }
.learning-navigation a.selected { color: var(--primary); background: var(--primary-soft); }
.learning-navigation a:hover { color: var(--primary); }
@media (max-width: 900px), (pointer: coarse) and (max-height: 520px) {
  .learning-navigation summary { display: list-item; min-height: 44px; padding: 10px 12px; cursor: pointer; color: var(--ink-soft); font-size: var(--fs-body); }
  .learning-navigation nav { flex-wrap: wrap; gap: 4px; padding: 4px; }
  .learning-navigation a { flex: 1 1 100px; min-height: 44px; padding: 8px; font-size: var(--fs-body); white-space: normal; }
}
@media (pointer: coarse) { .learning-navigation a { min-height: var(--tap-min); } }
</style>
