<script setup>
import { courseTaskDueLabel } from '../../composables/courseProgress.js'
import { focusLocation } from '../../composables/focusNavigation.js'

defineProps({
  row: { type: /** @type {import('vue').PropType<import('../../composables/courseProgress.js').CourseTaskRow>} */ (Object), required: true },
  now: { type: Date, required: true },
})
const emit = defineEmits(['complete', 'work'])
</script>

<template>
  <article class="course-task-row" role="listitem">
    <button v-if="row.task.sourceType !== 'project-task'" type="button" class="course-complete" :aria-label="`完成待办：${row.task.title}`" @click="emit('complete', row.task)"><span aria-hidden="true">✓</span></button>
    <span v-else class="project-task-mark" aria-hidden="true">↗</span>
    <div class="course-task-copy">
      <div class="task-row-meta"><span :class="{ 'text-urgent': row.overdue }">{{ courseTaskDueLabel(row, now) }}</span><span v-if="row.task.status === 'in_progress'" class="course-badge">进行中</span><span v-if="row.task.priority === 'high'">高优先级</span></div>
      <RouterLink class="task-row-title" :to="focusLocation('/tasks', row.task.id)">{{ row.task.title }}</RouterLink>
      <p v-if="row.task.workCheckpoint?.nextStep" class="task-next-step">下一步：{{ row.task.workCheckpoint.nextStep }}</p>
      <p v-else-if="row.task.workCheckpoint?.lastStep" class="task-last-step">上次做到：{{ row.task.workCheckpoint.lastStep }}</p>
      <p v-if="row.task.workCheckpoint?.blocker" class="task-blocker">卡点：{{ row.task.workCheckpoint.blocker }}</p>
      <button class="task-work-link" type="button" @click="emit('work', row.task)">{{ row.task.sourceType === 'project-task' ? '打开项目任务 →' : row.task.workCheckpoint || row.task.status === 'in_progress' ? '继续这项任务 →' : '开始这项任务 →' }}</button>
    </div>
  </article>
</template>

<style scoped>
.course-task-row { display: flex; align-items: flex-start; gap: 11px; padding: 15px 0; border-top: 1px solid var(--border); }
.course-complete { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; margin-top: 5px; padding: 5px; border: 1px solid var(--border-strong); border-radius: var(--radius-circle); color: var(--ink-soft); background: var(--card); cursor: pointer; }
.course-complete span { opacity: 0; }
.course-complete:hover { border-color: var(--success); color: var(--success); }
.course-complete:hover span, .course-complete:focus-visible span { opacity: 1; }
.project-task-mark { flex: 0 0 30px; margin-top: 8px; color: var(--ink-soft); text-align: center; }
.course-task-copy { flex: 1; min-width: 0; }
.task-row-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-bottom: 5px; color: var(--ink-faint); font-size: var(--fs-11); }
.text-urgent { color: var(--danger); }
.course-badge { padding: 3px 7px; border-radius: var(--radius-pill); background: var(--bg-tint); color: var(--ink-soft); font-size: var(--fs-10); }
.task-row-title { display: block; color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-700); line-height: 1.6; text-decoration: none; overflow-wrap: anywhere; }
.course-task-copy p { margin: 6px 0 0; font-size: var(--fs-12); line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }
.task-next-step { color: var(--primary); }
.task-last-step { color: var(--ink-soft); }
.task-blocker { color: var(--warning); }
.task-work-link { display: inline-flex; align-items: center; min-height: 32px; margin-top: 5px; padding: 4px 0; color: var(--primary); font: inherit; font-size: var(--fs-12); font-weight: var(--fw-700); text-decoration: none; background: transparent; border: 0; cursor: pointer; }
.task-work-link:hover, .task-row-title:hover { text-decoration: underline; }
@media (pointer: coarse) {
  .course-complete { width: var(--tap-min); height: var(--tap-min); flex-basis: var(--tap-min); }
  .task-work-link { min-height: var(--tap-min); }
}
</style>
