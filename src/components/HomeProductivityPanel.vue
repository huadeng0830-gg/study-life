<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived } from '../composables/domain/state.js'
import { appNow, appToday, appTimezone, getAppTime } from '../composables/timeContext.js'
import { coursesForDate } from '../composables/store/schedule.js'
import { currentTimes, periodIndex } from '../composables/store/timeConfig.js'
import { useStoredRef } from '../composables/store/core.js'
import { buildStudyBlockSuggestions, clockMinutes, STUDY_DAY_END, STUDY_DAY_START } from '../composables/studyBlockSuggestions.js'

const FIRST_USE_KEY = 'study-life:first-use-guide-dismissed'
const domain = useDomainCommands()
const checklists = useStoredRef('sl_checklists', [])
const guideReady = ref(false)
const guideDismissed = ref(false)
const feedback = ref('')
let feedbackTimer = 0

const hasData = computed(() => [
  domain.courses.value,
  domain.tasks.value,
  domain.events.value,
  domain.milestones.value,
  domain.bills.value,
  domain.transactions.value,
  domain.focusSessions.value,
  checklists.value,
].some((items) => Array.isArray(items) && items.length > 0))

const showFirstUseGuide = computed(() => guideReady.value && !guideDismissed.value && !hasData.value)

onMounted(() => {
  try {
    guideDismissed.value = localStorage.getItem(FIRST_USE_KEY) === '1'
  } catch {
    guideDismissed.value = false
  }
  guideReady.value = true
})

function dismissGuide() {
  guideDismissed.value = true
  try {
    localStorage.setItem(FIRST_USE_KEY, '1')
  } catch {
    // The guide remains dismissible for this visit when storage is unavailable.
  }
}

const suggestions = computed(() => {
  const date = appToday.value
  const busyIntervals = []
  const periods = currentTimes()
  for (const course of coursesForDate(domain.courses.value, date)) {
    if (isArchived(course) || course.deletedAt || course.tombstone) continue
    const startIndex = periodIndex(course.start)
    const endIndex = periodIndex(course.end)
    const start = clockMinutes(periods[startIndex]?.start)
    const end = clockMinutes(periods[endIndex]?.end)
    if (start !== null && end !== null && end > start) busyIntervals.push({ start, end })
  }

  const plannedTaskIds = new Set()
  for (const event of domain.events.value) {
    if (!event || event.deletedAt || event.tombstone || isArchived(event)) continue
    if (String(event.sourceText || '').startsWith('study-block:')) {
      const taskId = String(event.sourceText).slice('study-block:'.length).split(':')[0]
      if (taskId) plannedTaskIds.add(taskId)
    }
    if (event?.date !== date) continue
    const start = clockMinutes(event.time)
    if (start === null) {
      if (!event.time) busyIntervals.push({ start: STUDY_DAY_START, end: STUDY_DAY_END })
      continue
    }
    const explicitEnd = clockMinutes(event.endTime)
    busyIntervals.push({
      start,
      end: explicitEnd !== null && explicitEnd > start ? explicitEnd : Math.min(STUDY_DAY_END, start + 60),
    })
  }

  const nowMinutes = clockMinutes(getAppTime(appNow.value, appTimezone.value))
  return buildStudyBlockSuggestions({
    date,
    nowMinutes,
    tasks: domain.tasks.value,
    busyIntervals,
    plannedTaskIds,
    limit: 3,
  })
})

function addStudyBlock(item) {
  const task = domain.tasks.value.find((entry) => String(entry.id) === item.taskId)
  if (!task) {
    feedback.value = '这条待办已不存在，建议已更新。'
    return
  }
  const linkedCourse = domain.courses.value.find((course) => String(course.id) === String(task.courseId || ''))
  try {
    domain.createEvent({
      title: '学习：' + item.taskTitle,
      date: item.date,
      time: item.startTime,
      endTime: item.endTime,
      courseId: item.courseId,
      courseName: item.courseName || linkedCourse?.name || '',
      note: '为待办「' + item.taskTitle + '」预留的学习时段。',
      sourceText: 'study-block:' + item.taskId + ':' + item.date,
    })
    feedback.value = '已加入日程；待办内容与截止时间保持不变。'
  } catch (cause) {
    feedback.value = cause?.message || '添加日程失败，请重试。'
  }
  window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 3200)
}

onBeforeUnmount(() => window.clearTimeout(feedbackTimer))
</script>

<template>
  <div v-if="showFirstUseGuide || suggestions.length" class="home-productivity">
    <section v-if="showFirstUseGuide" class="first-use panel" aria-labelledby="first-use-title">
      <div class="productivity-heading">
        <div><span class="eyebrow">GET STARTED</span><h2 id="first-use-title">先搭好你的学习工作台</h2></div>
        <button type="button" class="text-button" @click="dismissGuide">收起引导</button>
      </div>
      <p>从课程表和待办开始，之后再按需要添加日程和生活记录。</p>
      <div class="first-use-actions">
        <RouterLink class="btn btn-primary" to="/schedule">添加课程</RouterLink>
        <RouterLink class="btn" to="/tasks">添加第一条待办</RouterLink>
      </div>
    </section>

    <section v-if="suggestions.length" class="study-suggestions panel" aria-labelledby="study-suggestions-title">
      <div class="productivity-heading">
        <div><span class="eyebrow">TODAY</span><h2 id="study-suggestions-title">今日空档学习建议</h2></div>
        <RouterLink class="panel-link" to="/tasks">查看待办 →</RouterLink>
      </div>
      <p class="study-explanation">根据今天的课程、定时日程和待办预估安排；加入后会保存为日程，不会自动更改待办。</p>
      <div class="study-list">
        <article v-for="item in suggestions" :key="item.taskId" class="study-row">
          <div class="study-time"><b>{{ item.startTime }}–{{ item.endTime }}</b><span>{{ item.minutes }} 分钟</span></div>
          <div class="study-copy"><b>{{ item.taskTitle }}</b><small v-if="item.courseName">{{ item.courseName }}</small></div>
          <button type="button" class="btn btn-sm btn-primary" @click="addStudyBlock(item)">加入日程</button>
        </article>
      </div>
      <p v-if="feedback" class="study-feedback" role="status">{{ feedback }}</p>
    </section>
  </div>
</template>

<style scoped>
.home-productivity { display:grid; gap:12px; margin:0 0 14px; }
.first-use,.study-suggestions { display:grid; gap:10px; padding:16px 18px; }
.productivity-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.productivity-heading h2 { margin:3px 0 0; font-size:var(--fs-16); }
.productivity-heading .eyebrow { color:var(--ink-soft); font-size:var(--fs-10); font-weight:var(--fw-750); letter-spacing:.08em; }
.first-use > p,.study-explanation { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.55; }
.first-use-actions { display:flex; flex-wrap:wrap; gap:8px; }
.study-list { display:grid; gap:7px; }
.study-row { display:grid; grid-template-columns:minmax(112px,auto) minmax(0,1fr) auto; align-items:center; gap:10px; padding:9px 10px; border-radius:var(--radius-9); background:var(--bg-tint); }
.study-time,.study-copy { display:grid; gap:2px; min-width:0; }
.study-time b,.study-copy b { font-size:var(--fs-12); }
.study-time span,.study-copy small { color:var(--ink-soft); font-size:var(--fs-11); }
.study-copy b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.study-feedback { margin:0; color:var(--success); font-size:var(--fs-12); }
@media (max-width:520px) {
  .first-use,.study-suggestions { padding:13px; }
  .study-row { grid-template-columns:1fr auto; }
  .study-time { grid-column:1 / -1; grid-template-columns:auto 1fr; align-items:baseline; }
}
</style>
