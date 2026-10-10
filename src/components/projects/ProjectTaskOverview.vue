<script setup>
defineProps({ summary: { type: Object, required: true } })
const emit = defineEmits(['filter'])
</script>

<template>
  <section class="project-summary" aria-label="项目进度概览">
    <div class="project-progress">
      <div><strong>任务进度</strong><span>{{ summary.completed }} / {{ summary.total }} 已完成 · {{ summary.progress }}%</span></div>
      <progress :value="summary.completed" :max="summary.total || 1" aria-label="项目任务完成进度" />
    </div>
    <div class="project-summary-actions">
      <button type="button" @click="emit('filter', { status: 'open', assignee: 'all' })"><strong>{{ summary.open }}</strong><span>未完成</span></button>
      <button type="button" @click="emit('filter', { status: 'open', assignee: 'mine' })"><strong>{{ summary.mine }}</strong><span>我的任务</span></button>
      <button type="button" @click="emit('filter', { status: 'review', assignee: 'all' })"><strong>{{ summary.review }}</strong><span>待验收</span></button>
      <button type="button" :class="{ 'has-overdue': summary.overdue > 0 }" @click="emit('filter', { status: 'overdue', assignee: 'all' })"><strong>{{ summary.overdue }}</strong><span>已逾期</span></button>
      <button type="button" @click="emit('filter', { status: 'open', assignee: 'unassigned' })"><strong>{{ summary.unassigned }}</strong><span>待分配</span></button>
    </div>
  </section>
</template>

<style scoped>
.project-summary { display: grid; gap: 14px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); }
.project-progress { display: grid; gap: 8px; }
.project-progress > div { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.project-progress strong { font-size: var(--fs-12); }
.project-progress span { color: var(--muted); font-size: var(--fs-11); }
.project-progress progress { width: 100%; height: 6px; border: 0; border-radius: var(--radius-pill); overflow: hidden; background: var(--bg-tint); accent-color: var(--primary); }
.project-progress progress::-webkit-progress-bar { background: var(--bg-tint); }
.project-progress progress::-webkit-progress-value { background: var(--primary); border-radius: var(--radius-pill); }
.project-progress progress::-moz-progress-bar { background: var(--primary); border-radius: var(--radius-pill); }
.project-summary-actions { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.project-summary-actions button { display: grid; justify-items: start; gap: 4px; min-height: 58px; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg-tint); color: var(--text); font: inherit; cursor: pointer; }
.project-summary-actions button:hover { border-color: var(--primary); background: var(--primary-soft); }
.project-summary-actions button:focus-visible { outline: 2px solid var(--focus-solid); outline-offset: 2px; }
.project-summary-actions strong { font-size: var(--fs-18); font-variant-numeric: tabular-nums; }
.project-summary-actions span { color: var(--muted); font-size: var(--fs-11); }
.project-summary-actions .has-overdue strong { color: var(--danger); }
@media (max-width: 520px) {
  .project-summary-actions { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
