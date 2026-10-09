<script setup>
import { focusLocation } from '../../composables/focusNavigation.js'
import { formatFocusDuration } from '../../composables/focusTimer.js'

defineProps({
  row: { type: /** @type {import('vue').PropType<import('../../composables/courseProgress.js').CourseActivity>} */ (Object), required: true },
})
</script>

<template>
  <article class="timeline-item" role="listitem" :data-focus-id="row.id" :data-focus-type="row.type">
    <span class="timeline-dot" :class="'kind-' + row.type" aria-hidden="true"></span>
    <div class="timeline-date"><b>{{ row.date || '未安排日期' }}</b><small v-if="row.time">{{ row.time }}</small></div>
    <div class="timeline-copy"><div class="timeline-meta"><span>{{ row.kind }}</span><span v-if="row.status">{{ row.status }}</span><span v-if="row.archived">已归档</span></div><RouterLink v-if="row.path" class="timeline-title" :to="focusLocation(row.path, row.id)">{{ row.title }}</RouterLink><b v-else class="timeline-title">{{ row.title }}</b><p v-if="row.type === 'focus'" class="timeline-summary">{{ formatFocusDuration(row.seconds) }}</p><p v-else-if="row.summary" class="timeline-summary">{{ row.summary }}</p></div>
  </article>
</template>

<style scoped>
.timeline-item { position: relative; display: grid; grid-template-columns: 12px minmax(92px, 125px) minmax(0, 1fr); gap: 12px; padding: 14px 0; }
.timeline-item:not(:last-child)::after { position: absolute; top: 28px; bottom: -14px; left: 5px; width: 2px; background: var(--border); content: ''; }
.timeline-dot { z-index: 1; width: 10px; height: 10px; margin-top: 4px; border: 2px solid var(--primary); border-radius: 50%; background: var(--card); }
.timeline-dot.kind-focus { border-color: var(--success); }
.timeline-dot.kind-milestone { border-color: var(--danger); }
.timeline-date { display: flex; flex-direction: column; gap: 3px; color: var(--ink-soft); font-size: var(--fs-11); }
.timeline-date b { color: var(--text); font-weight: var(--fw-700); }
.timeline-copy { min-width: 0; }
.timeline-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; color: var(--ink-soft); font-size: var(--fs-10); }
.timeline-meta span { padding: 2px 6px; border-radius: var(--radius-pill); background: var(--bg-tint); }
.timeline-title { display: inline-block; color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-700); text-decoration: none; overflow-wrap: anywhere; }
.timeline-title:hover { text-decoration: underline; }
.timeline-summary { margin: 4px 0 0; color: var(--ink-soft); font-size: var(--fs-11); line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 520px) {
  .timeline-item { grid-template-columns: 12px minmax(0, 1fr); gap: 8px 10px; }
  .timeline-date { grid-column: 2; grid-row: 1; flex-direction: row; gap: 8px; }
  .timeline-copy { grid-column: 2; grid-row: 2; }
  .timeline-dot { grid-column: 1; grid-row: 1 / span 2; }
}
</style>
