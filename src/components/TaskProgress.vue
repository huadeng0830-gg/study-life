<script setup>
import { computed } from 'vue'

const props = defineProps({
  task: { type: Object, required: true },
  elapsedSeconds: { type: Number, default: 0 },
  activityAgeSeconds: { type: Number, default: null },
  stalled: Boolean,
  compact: Boolean,
})

defineEmits(['cancel', 'retry', 'continue', 'wait'])

const ICONS = {
  waiting: '○',
  running: '●',
  completed: '✓',
  warning: '!',
  'needs-confirmation': '!',
  failed: '×',
  cancelled: '–',
}

const elapsedText = computed(() => {
  const seconds = props.elapsedSeconds
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
})

const activityText = computed(() => {
  if (props.activityAgeSeconds === null || props.activityAgeSeconds < 2) return '刚刚'
  return `${props.activityAgeSeconds} 秒前`
})

const stateText = computed(() => ({
  waiting: '等待开始',
  running: '进行中',
  completed: '已完成',
  warning: '已完成，需确认',
  failed: '处理失败',
  cancelled: '已取消',
}[props.task.status] || '进行中'))
</script>

<template>
  <section v-if="task.active && task.visible" class="task-progress" :class="[{ compact }, `is-${task.status}`]" aria-live="polite">
    <header class="task-progress-head">
      <div>
        <b>{{ task.title }}</b>
        <span>{{ ['completed', 'warning'].includes(task.status) ? `用时 ${elapsedText}` : `已用时 ${elapsedText}` }}</span>
      </div>
      <span class="task-state">{{ stateText }}</span>
    </header>

    <ol v-if="!compact || task.status !== 'running'" class="task-steps">
      <li v-for="step in task.steps" :key="step.id" :class="`step-${step.status}`">
        <i>{{ ICONS[step.status] }}</i>
        <span><b>{{ step.label }}</b><small v-if="step.detail">{{ step.detail }}</small></span>
      </li>
    </ol>

    <div v-else class="current-step">
      <i>●</i>
      <span>{{ task.steps.find((step) => step.status === 'running')?.label || task.latestActivity }}</span>
    </div>

    <div v-if="task.partial && Object.keys(task.partial).length" class="task-partial">
      <span>已经发现</span>
      <div><b v-for="(value, label) in task.partial" :key="label">{{ label }}：{{ value }}</b></div>
    </div>

    <p v-if="task.latestActivity && task.latestActivity !== task.error" class="task-activity"><span>{{ activityText }}</span>：{{ task.latestActivity }}</p>
    <p v-if="stalled" class="task-stalled">这一步比预期更久，暂时没有新的处理消息。你可以继续等待，或取消后重试。</p>
    <p v-if="task.retainedResult" class="task-retained">已完成的结果已保留，可以重试失败步骤或使用当前结果继续。</p>
    <p v-if="task.error" class="task-error">{{ task.error }}</p>

    <div v-if="stalled || task.canCancel || task.canRetry || task.retainedResult" class="task-actions">
      <button v-if="stalled" type="button" class="btn btn-sm btn-ghost" @click="$emit('wait')">继续等待</button>
      <button v-if="task.canCancel" type="button" class="btn btn-sm" @click="$emit('cancel')">取消任务</button>
      <button v-if="task.canRetry" type="button" class="btn btn-sm btn-ghost" @click="$emit('retry')">重试当前步骤</button>
      <button v-if="task.retainedResult" type="button" class="btn btn-sm btn-primary" @click="$emit('continue')">使用当前结果</button>
    </div>
  </section>
</template>

<style scoped>
.task-progress{display:flex;flex-direction:column;gap:11px;width:100%;padding:14px;border:1px solid var(--border);border-radius:13px;background:#fafbfd}.task-progress-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.task-progress-head>div{display:flex;flex-direction:column;gap:2px}.task-progress-head b{font-size:13px}.task-progress-head span,.task-state{color:var(--ink-faint);font-size:10.5px}.task-state{flex:0 0 auto;padding:4px 7px;border-radius:7px;background:#eef2fb;color:var(--primary);font-weight:750}.task-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}.task-steps li,.current-step{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:7px 9px;border-radius:9px;background:#fff}.task-steps i,.current-step i{flex:0 0 14px;color:#a5adbc;font-style:normal;font-weight:900}.task-steps li>span{display:flex;flex-direction:column;min-width:0}.task-steps li b{font-size:11px;font-weight:650}.task-steps small{margin-top:2px;color:var(--ink-faint);font-size:9.5px;line-height:1.35}.step-running i{color:var(--primary);animation:pulse 1.2s ease-in-out infinite}.step-completed i{color:#0b916a}.step-warning i,.step-needs-confirmation i{color:#b56a09}.step-failed i{color:var(--danger)}.step-cancelled{opacity:.65}.task-partial{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:9px;background:#eefaf6}.task-partial>span{flex:0 0 auto;color:#17785c;font-size:10px}.task-partial>div{display:flex;flex-wrap:wrap;gap:5px 10px}.task-partial b{color:#205f4d;font-size:10.5px}.task-activity,.task-stalled,.task-retained,.task-error{margin:0;font-size:10.5px;line-height:1.5}.task-activity{color:var(--ink-soft)}.task-activity span{color:var(--ink-faint)}.task-stalled{padding:8px 10px;color:#8a6845;border-radius:8px;background:#fff7e8}.task-retained{color:#246f5a}.task-error{color:var(--danger)}.task-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.compact{gap:8px;padding:11px 12px}.compact .task-progress-head b{font-size:12px}.current-step{padding:5px 7px;color:var(--ink-soft);font-size:10.5px}.is-completed{border-color:#bfe6d8;background:#f4fcf9}.is-warning{border-color:#f2d08c;background:#fffaf0}.is-failed{border-color:#f0caca;background:#fff8f8}@keyframes pulse{50%{opacity:.35}}@media(max-width:520px){.task-progress{padding:12px}.task-steps{grid-template-columns:1fr}.task-progress-head{align-items:flex-start}.task-actions .btn{min-height:40px;flex:1}}
</style>
