<script setup>
import { computed } from 'vue'

const props = defineProps({
  task: { type: Object, required: true },
  elapsedSeconds: { type: Number, default: 0 },
  activityAgeSeconds: { type: Number, default: null },
  stalled: Boolean,
  compact: Boolean,
  dismissible: Boolean,
})

defineEmits(['cancel', 'retry', 'continue', 'wait', 'dismiss'])

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
    <p v-if="task.error" class="task-error" role="alert">{{ task.error }}</p>

    <div v-if="stalled || task.canCancel || task.canRetry || task.retainedResult || (dismissible && task.status !== 'running')" class="task-actions">
      <button v-if="stalled" type="button" class="btn btn-sm btn-ghost" @click="$emit('wait')">继续等待</button>
      <button v-if="task.canCancel" type="button" class="btn btn-sm" @click="$emit('cancel')">取消任务</button>
      <button v-if="task.canRetry" type="button" class="btn btn-sm btn-ghost" @click="$emit('retry')">重试当前步骤</button>
      <button v-if="task.retainedResult" type="button" class="btn btn-sm btn-primary" @click="$emit('continue')">使用当前结果</button>
      <button v-if="dismissible && task.status !== 'running'" type="button" class="btn btn-sm btn-ghost" @click="$emit('dismiss')">收起进度</button>
    </div>
  </section>
</template>

<style scoped>
.task-progress{display:flex;flex-direction:column;gap:11px;width:100%;padding:14px;border:1px solid var(--border);border-radius:var(--radius-13);background:var(--bg-tint)}.task-progress-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.task-progress-head>div{display:flex;flex-direction:column;gap:2px}.task-progress-head b{font-size:var(--fs-13)}.task-progress-head span,.task-state{color:var(--ink-faint);font-size:var(--fs-10-5)}.task-state{flex:0 0 auto;padding:4px 7px;border-radius:var(--radius-7);background:var(--primary-soft);color:var(--primary);font-weight:var(--fw-750)}.task-steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;list-style:none}.task-steps li,.current-step{display:flex;align-items:flex-start;gap:8px;min-width:0;padding:7px 9px;border-radius:var(--radius-9);background:var(--card)}/* 步骤序号原本写死 #a5adbc：浅色在白卡（.task-steps li / .current-step 都是 var(--card)）上
   只有 2.26:1，连大字 3:1 都不到（深色 7.03:1，所以浅色是唯一坏点，但很坏）。
   改用 --ink-faint：浅 5.20 / 深 4.92，"未开始的步骤"本来就该是最弱一档，
   与同一列表里的 .task-steps small 用的是同一个令牌。
   状态色（.step-completed i / .step-warning i 等）已在上面的迁移里处理，未改动。 */
.task-steps i,.current-step i{flex:0 0 14px;color:var(--ink-faint);font-style:normal;font-weight:var(--fw-900)}.task-steps li>span{display:flex;flex-direction:column;min-width:0}.task-steps li b{font-size:var(--fs-11);font-weight:var(--fw-650)}.task-steps small{margin-top:2px;color:var(--ink-faint);font-size:var(--fs-9-5);line-height:1.35}.step-running i{color:var(--primary);animation:pulse 1.2s ease-in-out infinite}.step-completed i{color:var(--success)}.step-warning i,.step-needs-confirmation i{color:var(--warning)}.step-failed i{color:var(--danger)}.step-cancelled{opacity:.65}/* 「部分完成」是绿色语义的「字 + 写死浅底」成对写法，底一起从 --card 混出来：
   只改字的话深色主题下 #eefaf6 仍是浅绿块，亮绿字压上去只有约 1.7:1。 */
.task-partial{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:var(--radius-9);background:color-mix(in srgb, var(--success) 10%, var(--card))}.task-partial>span{flex:0 0 auto;color:var(--success);font-size:var(--fs-10)}.task-partial>div{display:flex;flex-wrap:wrap;gap:5px 10px}.task-partial b{color:var(--success);font-size:var(--fs-10-5)}.task-activity,.task-stalled,.task-retained,.task-error{margin:0;font-size:var(--fs-10-5);line-height:1.5}.task-activity{color:var(--ink-soft)}.task-activity span{color:var(--ink-faint)}.task-stalled{padding:8px 10px;color:var(--warning);border-radius:var(--radius-8);background:color-mix(in srgb, var(--warning) 10%, var(--card))}.task-retained{color:var(--success)}.task-error{color:var(--danger)}.task-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.compact{gap:8px;padding:11px 12px}.compact .task-progress-head b{font-size:var(--fs-12)}.current-step{padding:5px 7px;color:var(--ink-soft);font-size:var(--fs-10-5)}/* 完成/警告态的整卡底色也是写死的语义色：深色主题下 #f4fcf9 / #fffaf0 把整张卡片
   变成白块，卡内正文 var(--text) 只有 1.14:1。改成从令牌混出后正文升到 11.05 / 10.98:1。
   卡内原本用 var(--ink-faint) 的次级小字（.task-progress-head span / .task-activity span）随之
   掉到深色 4.05:1、浅色 4.50:1，仍不到 4.5 —— 根因不是这两个选择器，而是 --ink-faint 本身：
   它在 --card 上只有 4.92 的余量（深色 #8290a8 on #1b2233），底一旦被语义色提亮就击穿
   （6% 底 4.40、10% 底 4.05）。--ink-faint 是「最弱一档」，不该压在带色底上；着色卡里的
   次级文字改用次一档的 --ink-soft（浅 5.44 / 深 6.91），语义上也更准：它是辅助文字、不是最弱文字。
   注意别用 --muted 顶这里：--muted 在 10% 底上只有 4.31/4.34，比 --ink-faint 还差
   （这也是同一批迁移里凡含 var(--muted) 正文的表面都只用 6% 混合的原因）。
   .is-failed 是红色语义，不在本次绿/琥珀范围内，保持原样。 */
.is-completed{border-color:color-mix(in srgb, var(--success) 35%, var(--card));background:color-mix(in srgb, var(--success) 10%, var(--card))}
.is-warning{border-color:color-mix(in srgb, var(--warning) 35%, var(--card));background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.is-completed .task-progress-head span,.is-completed .task-activity span,
.is-warning .task-progress-head span,.is-warning .task-activity span{color:var(--ink-soft)}
.is-failed{border-color:color-mix(in srgb,var(--danger) 35%,var(--card));background:color-mix(in srgb,var(--danger) 10%,var(--card))}@keyframes pulse{50%{opacity:.35}}@media(max-width:520px){.task-progress{padding:12px}.task-steps{grid-template-columns:1fr}.task-progress-head{align-items:flex-start}.task-actions .btn{min-height:40px;flex:1}}
</style>
