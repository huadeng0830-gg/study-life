<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TaskFocusLink from './TaskFocusLink.vue'
import { useDomainCommands } from '../../composables/domain/commands.js'
import { buildLearningDay, createLearningBlock, ensureMilestoneReviewTask } from '../../composables/learningPlan.js'
import { isActiveEntity } from '../../composables/domain/state.js'
import { countdownState } from '../../composables/store/countdown.js'
import { focusLocation } from '../../composables/focusNavigation.js'
import { taskFocusLocation } from '../../composables/learningFocus.js'
import { formatFocusDuration } from '../../composables/focusTimer.js'
import { isScheduleDate } from '../../composables/store/schedule.js'
import { addAppDays, appNow, appToday, getAppToday } from '../../composables/timeContext.js'

const props = defineProps({ compact: { type: Boolean, default: false } })
const domain = useDomainCommands()
const router = useRouter()
const chosenDate = ref('')
const date = computed(() => isScheduleDate(chosenDate.value) ? chosenDate.value : appToday.value)
const plan = computed(() => buildLearningDay({ courses: domain.courses.value, tasks: domain.tasks.value, events: domain.events.value, focusSessions: domain.focusSessions.value }, date.value))
const message = ref('')
const failed = ref(false)
const undoEvent = ref(null)
const undoMode = ref('')
const expanded = ref(false)
const visibleBlocks = computed(() => expanded.value ? plan.value.blocks : plan.value.blocks.slice(0, 3))
const upcomingReviews = computed(() => domain.milestones.value.filter((item) => item && !item.deletedAt && !item.tombstone && isActiveEntity(item) && item.category === '学习')
  .filter((item) => isScheduleDate(item.date))
  .map((item) => ({ item, countdown: countdownState(item, appNow.value) }))
  .filter(({ countdown }) => countdown.target && !countdown.isPast && getAppToday(countdown.target) <= addAppDays(appToday.value, 14))
  .sort((a, b) => a.countdown.sortValue - b.countdown.sortValue).slice(0, 3))
const visible = computed(() => !props.compact || plan.value.suggestions.length || plan.value.blocks.length || upcomingReviews.value.length || message.value)

watch(date, () => { message.value = ''; undoEvent.value = null; expanded.value = false })

function addBlock(item) {
  try {
    undoEvent.value = createLearningBlock(domain, item)
    undoMode.value = 'add'
    failed.value = false
    message.value = '已加入日程，到时可从这里继续任务。'
  } catch (cause) { failed.value = true; message.value = cause instanceof Error ? cause.message : '安排失败，请重试。' }
}

function removeBlock(block) {
  const current = domain.events.value.find((item) => item.id === block.event.id)
  if (!current) return
  undoEvent.value = { ...current }
  domain.deleteEvent(current.id)
  undoMode.value = 'remove'
  failed.value = false
  message.value = '已撤回这个学习时段，待办可以重新安排。'
}

function undo() {
  if (!undoEvent.value) return
  if (undoMode.value === 'add') domain.deleteEvent(undoEvent.value.id)
  else domain.restoreDeletedEvent(undoEvent.value)
  undoEvent.value = null
  failed.value = false
  message.value = '已撤销上一步安排。'
}

function startReview(item) {
  try {
    const { task } = ensureMilestoneReviewTask(domain, item.id)
    void router.push(taskFocusLocation(task))
  } catch (cause) { failed.value = true; message.value = cause instanceof Error ? cause.message : '暂时无法开始复习。' }
}
</script>

<template>
  <section v-if="visible" class="study-planner" :class="{ compact }" aria-label="学习计划">
    <header class="study-header">
      <div><h2>{{ compact ? '今日学习安排' : '利用课表空档，安排下一步' }}</h2><p>避开课程和日程，前后留出 10 分钟；长任务分段推进。</p></div>
      <RouterLink v-if="compact" class="text-link" to="/schedule">打开课表 →</RouterLink>
      <div v-else class="study-date-controls">
        <button type="button" class="btn btn-ghost" :aria-pressed="date === appToday" @click="chosenDate = ''">今天</button>
        <button type="button" class="btn btn-ghost" :aria-pressed="date === addAppDays(appToday, 1)" @click="chosenDate = addAppDays(appToday, 1)">明天</button>
        <label><span class="sr-only">学习计划日期</span><input v-model="chosenDate" type="date" :min="appToday" aria-label="学习计划日期" /></label>
      </div>
    </header>
    <div class="study-stats" aria-label="当日学习安排概览"><span>剩余空档 <b>{{ plan.freeMinutes }} 分钟</b></span><span>已安排 <b>{{ plan.plannedMinutes }} 分钟</b></span><span>已专注 <b>{{ formatFocusDuration(plan.focusSeconds) }}</b></span></div>

    <div v-if="message" class="study-message" :class="{ failed }" role="status"><span>{{ message }}</span><button v-if="undoEvent" type="button" class="text-link" @click="undo">撤销</button></div>

    <div class="study-sections">
      <section aria-label="空档学习建议">
        <h3>建议时段 <small>最多 3 项，截止时间优先</small></h3>
        <ul v-if="plan.suggestions.length" class="study-list">
          <li v-for="item in plan.suggestions" :key="item.taskId" class="study-row">
            <div class="study-time"><b>{{ item.startTime }}–{{ item.endTime }}</b><small>{{ item.minutes }} 分钟{{ item.partial ? ' · 分段推进' : '' }}</small></div>
            <div class="study-copy"><RouterLink :to="focusLocation('/tasks', item.taskId)">{{ item.taskTitle }}</RouterLink><small>{{ [item.courseName, item.reason].filter(Boolean).join(' · ') }}</small></div>
            <button type="button" class="btn btn-sm btn-primary" :aria-label="`安排${item.taskTitle}到${item.startTime}`" @click="addBlock(item)">加入日程</button>
          </li>
        </ul>
        <p v-else class="study-empty">{{ !plan.candidates.length ? '还没有待推进的课程事项。点击课表中的课程，记下作业或复习任务。' : date < appToday ? '请选择今天或之后的日期安排学习。' : plan.freeMinutes < 10 ? '这一天没有足够的空档，可以换一天安排。' : '待办已有时段，或截止前空档不足。可调整日程，或选择其他日期。' }}</p>
      </section>

      <section v-if="plan.blocks.length" aria-label="已安排的学习时段">
        <h3>已安排的时段 <small>{{ plan.blocks.length }} 项</small></h3>
        <ul class="study-list">
          <li v-for="block in visibleBlocks" :key="block.event.id" class="study-row planned-row">
            <div class="study-time"><b>{{ block.event.time || '全天' }}{{ block.event.endTime ? '–' + block.event.endTime : '' }}</b><small>{{ block.status }}</small></div>
            <div class="study-copy"><RouterLink :to="focusLocation('/events', block.event.id)">{{ block.task?.title || block.event.title }}</RouterLink><small v-if="block.task?.workCheckpoint?.nextStep">下一步：{{ block.task.workCheckpoint.nextStep }}</small></div>
            <div class="study-actions"><TaskFocusLink v-if="block.actionable" :task="block.task" :minutes="Math.min(45, block.minutes || 25)" /><button type="button" class="text-link" :aria-label="`撤回学习时段：${block.event.title}`" @click="removeBlock(block)">撤回时段</button></div>
          </li>
        </ul>
        <button v-if="plan.blocks.length > 3" type="button" class="text-link" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : `查看全部 ${plan.blocks.length} 个时段` }}</button>
      </section>

      <section v-if="upcomingReviews.length" aria-label="近期复习">
        <h3>近期复习 <small>未来 14 天</small></h3>
        <ul class="study-list">
          <li v-for="{ item, countdown } in upcomingReviews" :key="item.id" class="study-row review-row">
            <div class="study-time"><b>{{ countdown.relativeText || countdown.text + countdown.label }}</b><small>复习 {{ item.reviewProgress || 0 }}%</small></div>
            <div class="study-copy"><RouterLink :to="focusLocation('/exams', item.id)">{{ item.name }}</RouterLink><small>{{ item.courseName }}</small></div>
            <button type="button" class="btn btn-sm" :aria-label="`开始复习：${item.name}`" @click="startReview(item)">准备复习</button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.study-planner { display: grid; gap: 14px; min-width: 0; }
.compact { padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-14); background: var(--card); }
.study-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.study-header h2 { margin: 0; color: var(--text); font-size: var(--fs-15); }
.study-header p { margin: 5px 0 0; color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.6; }
.study-date-controls, .study-stats, .study-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.study-date-controls input { max-width: 150px; min-height: 36px; padding: 5px 8px; }
.study-stats { gap: 9px 20px; color: var(--ink-soft); font-size: var(--fs-12); }
.study-stats b { margin-left: 4px; color: var(--text); }
.study-sections { display: grid; gap: 14px; }
h3 { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; font-size: var(--fs-13); }
h3 small { color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-400); }
.study-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.study-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--bg-tint); }
.study-time, .study-copy { display: grid; gap: 4px; min-width: 0; }
.study-time b, .study-copy a { color: var(--text); font-size: var(--fs-12); font-weight: var(--fw-700); }
.study-copy a { text-decoration: none; overflow-wrap: anywhere; }
.study-copy a:hover { color: var(--primary); text-decoration: underline; }
.study-time small, .study-copy small { color: var(--ink-soft); font-size: var(--fs-11); line-height: 1.5; overflow-wrap: anywhere; }
.study-actions { justify-content: flex-end; }
.text-link { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 4px 6px; color: var(--primary); border: 0; background: transparent; font-size: var(--fs-12); cursor: pointer; text-decoration: none; }
.study-empty { margin: 0; padding: 12px; color: var(--ink-soft); background: var(--bg-tint); border-radius: var(--radius-10); font-size: var(--fs-12); line-height: 1.7; }
.study-message { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; color: var(--success); background: var(--bg-tint); border-radius: var(--radius-10); font-size: var(--fs-12); }
.study-message.failed { color: var(--danger); }
@media (max-width: 760px) {
  .study-header { flex-wrap: wrap; }
  .study-date-controls { width: 100%; }
  .study-row { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .study-time { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 8px; }
  .planned-row .study-copy { grid-column: 1 / -1; }
  .study-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .compact { padding: 13px; }
  .text-link { min-height: var(--tap-min); }
}
</style>
