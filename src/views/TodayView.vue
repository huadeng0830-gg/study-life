<script setup>
import { computed, ref, watch } from 'vue'
import {
  clock,
  MAX_WEEK,
  todayStr,
  dayName,
  todayIndex,
  weekOf,
  sortCountdowns,
} from '../composables/store'
import {
  campusName,
  currentCampusId,
  currentSeasonId,
  currentTimes,
  periodIndex,
  seasonName,
  courseTimeRange,
} from '../composables/store/timeConfig.js'
import {
  coursesForDate,
} from '../composables/store/schedule.js'
import { appearance } from '../composables/appearance.js'
import { festiveFor } from '../composables/festive.js'
import { festiveConfig, moodLog } from '../composables/atmosphereStore.js'
import { moodOf, logMood as logMoodRecord } from '../composables/mood.js'
import MemoryView from '../components/MemoryView.vue'
import FestiveSettings from '../components/FestiveSettings.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { selectActionCenter } from '../composables/domain/selectors.js'

const domain = useDomainCommands()
const { courses, tasks, milestones: exams, bills, events, notes: quickNotes } = domain
const now = computed(() => clock.value)

/* ---------- 氛围问候 + 心情记录（模块 A） ---------- */
const todayISO = computed(() => {
  const d = now.value
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})
const festive = computed(() => festiveFor(todayISO.value, festiveConfig.value))

const showMemory = ref(false)
const showFestive = ref(false)
const MOOD_OPTIONS = ['😊', '😄', '😌', '😐', '😢', '😭', '😤', '😴']
const todayMood = computed(() => moodOf(todayISO.value, moodLog.value))
const moodNoteDraft = ref('')

function logMood(emoji) {
  const keepNote = todayMood.value?.mood === emoji ? (todayMood.value.note ?? '') : ''
  moodLog.value = logMoodRecord(todayISO.value, emoji, keepNote, moodLog.value)
  moodNoteDraft.value = keepNote
}

function saveMoodNote() {
  if (!todayMood.value) return
  moodLog.value = logMoodRecord(todayISO.value, todayMood.value.mood, moodNoteDraft.value.trim(), moodLog.value)
}

watch(todayMood, (mood) => {
  moodNoteDraft.value = mood?.note ?? ''
})
const sessionQuoteIndex = Math.floor(Math.random() * 50)
const weekNum = computed(() => Math.min(Math.max(weekOf(todayStr()), 1), MAX_WEEK))
const dateText = computed(
  () => `${now.value.getFullYear()}年${now.value.getMonth() + 1}月${now.value.getDate()}日 · ${dayName(todayIndex())}`
)

// 手机端先渲染“基本入口”（问候 + 接下来），其余模块等浏览器空闲后一帧补齐，
// 避免首屏一次性挂载全部面板；桌面端维持原有即时渲染。
const mobileEntry = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const entryReady = ref(!mobileEntry)
if (mobileEntry && typeof window !== 'undefined') {
  const finishEntry = () => { entryReady.value = true }
  if ('requestIdleCallback' in window) window.requestIdleCallback(finishEntry, { timeout: 1600 })
  else window.setTimeout(finishEntry, 220)
}

function greeting() {
  const hour = now.value.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const currentQuote = computed(() => {
  if (!appearance.value.showQuote) return ''
  const quotes = appearance.value.quotes.length ? appearance.value.quotes : ['今天也要漂亮通关。']
  if (appearance.value.quoteMode === 'fixed') return quotes[appearance.value.fixedQuoteIndex] ?? quotes[0]
  if (appearance.value.quoteMode === 'random') return quotes[sessionQuoteIndex % quotes.length]
  return quotes[Number(todayStr().replace(/-/g, '')) % quotes.length]
})

/* ---------- 课程 ---------- */
const todayCourses = computed(() =>
  coursesForDate(courses.value, todayStr()).sort((a, b) => periodIndex(a.start) - periodIndex(b.start))
)

function minutesOf(value) {
  if (!value) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function courseState(c) {
  const times = currentTimes()
  const cur = now.value.getHours() * 60 + now.value.getMinutes()
  const s = minutesOf(times[periodIndex(c.start)]?.start)
  const e = minutesOf(times[periodIndex(c.end)]?.end)
  if (s === null || s === undefined || e === null || e === undefined) return 'upcoming'
  if (cur < s) return 'upcoming'
  if (cur > e) return 'done'
  return 'live'
}

/* ---------- 接下来：首页最高优先级 ---------- */
function findCourseOnDate(offset) {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() + offset)
  const pad = (value) => String(value).padStart(2, '0')
  const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const list = coursesForDate(courses.value, dateStr).sort((a, b) => periodIndex(a.start) - periodIndex(b.start))
  return list.length ? { course: list[0], dateStr, dayOffset: offset } : null
}

const nextUp = computed(() => {
  const live = todayCourses.value.find((c) => courseState(c) === 'live')
  if (live) return { kind: 'live', course: live }

  const upcomingToday = todayCourses.value.find((c) => courseState(c) === 'upcoming')
  if (upcomingToday) return { kind: 'today', course: upcomingToday }

  // 今天课程已结束或没课 → 向后找最多 7 天
  for (let offset = 1; offset <= 7; offset++) {
    const found = findCourseOnDate(offset)
    if (found) {
      const times = currentTimes()
      const start = times[periodIndex(found.course.start)]?.start ?? ''
      const dayText = offset === 1 ? '明天' : dayName(new Date(found.dateStr + 'T00:00:00').getDay() === 0 ? 6 : new Date(found.dateStr + 'T00:00:00').getDay() - 1)
      return { kind: 'nextDay', course: found.course, dayOffset: offset, start, dayText }
    }
  }
  return { kind: 'none' }
})

const nextUpTimeRange = computed(() => {
  if (!nextUp.value.course) return ''
  return courseTimeRange(nextUp.value.course)
})

const minutesUntilNext = computed(() => {
  const item = nextUp.value
  if (!item.course || item.kind === 'nextDay' || item.kind === 'none') return null
  const times = currentTimes()
  const start = minutesOf(times[periodIndex(item.course.start)]?.start)
  if (start === null) return null
  const cur = now.value.getHours() * 60 + now.value.getMinutes()
  return start - cur
})

/* ---------- 待办 ---------- */
function dueTime(task) {
  return task.dueTime || '23:59'
}
function dateTime(date, time = '23:59') {
  return new Date(`${date}T${time}`).getTime()
}
function taskCourseLabel(task) {
  return courses.value.find((course) => course.id === task.courseId)?.name ?? task.course ?? ''
}

const todayTasksAll = computed(() =>
  tasks.value.filter((task) => !task.done && task.dueDate === todayStr())
)
const todayTasksDone = computed(() =>
  tasks.value.filter((task) => task.done && task.dueDate === todayStr())
)
const todayProgress = computed(() => {
  const total = todayTasksAll.value.length + todayTasksDone.value.length
  const done = todayTasksDone.value.length
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 }
})

// 逾期优先，其次今天截止，再按时间排序；首页最多显示 5 条
const displayTasks = computed(() => {
  const nowTs = now.value.getTime()
  const overdue = tasks.value
    .filter((t) => !t.done && t.dueDate && t.dueDate !== todayStr() && dateTime(t.dueDate, dueTime(t)) < nowTs)
    .sort((a, b) => dateTime(a.dueDate, dueTime(a)) - dateTime(b.dueDate, dueTime(b)))
  const today = [...todayTasksAll.value].sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : 1
    const pb = b.priority === 'high' ? 0 : 1
    if (pa !== pb) return pa - pb
    return dateTime(a.dueDate, dueTime(a)) - dateTime(b.dueDate, dueTime(b))
  })
  return [...overdue.slice(0, 2), ...today].slice(0, 5)
})

const overdueCount = computed(
  () => tasks.value.filter((t) => !t.done && t.dueDate && t.dueDate !== todayStr() && dateTime(t.dueDate, dueTime(t)) < now.value.getTime()).length
)

function dayLabel(date) {
  if (date === todayStr()) return '今天'
  const tomorrow = new Date(`${todayStr()}T00:00:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pad = (value) => String(value).padStart(2, '0')
  const tomorrowText = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  if (date === tomorrowText) return '明天'
  return date.slice(5).replace('-', '月') + '日'
}

function taskDeadline(task) {
  if (!task?.dueDate) return '未设置截止'
  if (task.dueDate === todayStr()) return task.dueTime ? `今天 ${task.dueTime}` : '今天截止'
  const target = new Date(task.dueDate + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  const days = Math.round((target - today) / 86400000)
  if (days < 0) return `已逾期 ${-days} 天`
  if (days === 1) return task.dueTime ? `明天 ${task.dueTime}` : '明天截止'
  return `${dayLabel(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`
}

function toggleTask(task) {
  if (!task) return
  domain.toggleTask(task.id)
}

/* ---------- 倒计时 / 提醒 ---------- */
const previewEvents = computed(() =>
  events.value.filter((item) => !item.date || item.date >= todayStr()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 3)
)
const previewNotes = computed(() => quickNotes.value.slice(0, 2))

// 近期提醒不拥有数据，只是统一投影；今日待办已在主区域展示的项目不会再次出现。
const unifiedReminders = computed(() => {
  const shownTasks = new Set(displayTasks.value.map((item) => item.id))
  const actionCenter = selectActionCenter({ tasks: tasks.value, bills: bills.value, milestones: exams.value, events: events.value }, now.value)
  return [...actionCenter.urgent, ...actionCenter.today, ...actionCenter.soon]
    .filter((item) => item.sourceType !== 'task' || !shownTasks.has(item.sourceId))
    .slice(0, 4)
})
function reminderMeta(item) {
  if (item.kind === 'overdue') return '已逾期'
  if (item.sourceType === 'bill') return `${item.entity.nextDate?.slice(5).replace('-', '/')} · ¥${Number(item.entity.amount || 0).toFixed(2)}`
  if (item.sourceType === 'event') return `${item.entity.date || '待安排'}${item.entity.time ? ` ${item.entity.time}` : ''}`
  return item.entity.countdown?.text || countdownLabel(sortCountdowns([item.entity], now.value)[0])
}
function completeReminder(item) {
  if (item.sourceType === 'task') domain.toggleTask(item.sourceId)
}

function countdownLabel(item) {
  const state = item.countdown
  if (state.text === '今天') return '今天'
  if (state.label === '小时') return `${state.text}小时`
  if (state.label === '分钟') return `${state.text}分钟`
  return `${state.text}天`
}

/* ---------- 本周概况 ---------- */
const weekReview = computed(() => {
  const monday = new Date(now.value)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const completed = tasks.value.filter((task) => task.completedAt && new Date(task.completedAt) >= monday).length
  const plannedMinutes = tasks.value
    .filter((task) => !task.done)
    .reduce((total, task) => total + Number(task.estimateMinutes || 0), 0)
  const focusHours = Math.floor(plannedMinutes / 60)
  const focusMinutes = plannedMinutes % 60
  return {
    completed,
    focus: plannedMinutes ? `${focusHours}h ${String(focusMinutes).padStart(2, '0')}m` : '—',
    pending: overdueCount.value,
  }
})

</script>

<template>
  <div class="page">
    <!-- ① 顶部问候区：紧凑，不再使用大 Hero -->
    <header class="page-head">
      <div class="head-copy">
        <h1 class="greeting">{{ greeting() }}<template v-if="currentQuote">，{{ currentQuote }}</template></h1>
        <p class="page-desc">{{ dateText }} · 第 {{ weekNum }} 周 · {{ campusName(currentCampusId()) }} · {{ seasonName(currentSeasonId()) }}</p>
        <p v-if="festive" class="fest-greet" :style="{ color: festive.accentColor }">🎉 {{ festive.name }} · {{ festive.message }}</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-ghost replay-btn" @click="showMemory = true">↺ 回放</button>
      </div>
    </header>

    <!-- 心情记录：轻量一排，点一下即可 -->
    <section class="mood-strip" aria-label="记录今天心情">
      <span class="mood-label">今天心情</span>
      <div class="mood-options">
        <button
          v-for="emoji in MOOD_OPTIONS"
          :key="emoji"
          type="button"
          class="mood-btn"
          :class="{ on: todayMood?.mood === emoji }"
          :aria-label="`记录心情 ${emoji}`"
          @click="logMood(emoji)"
        >{{ emoji }}</button>
      </div>
      <input v-if="todayMood" v-model="moodNoteDraft" class="mood-note" placeholder="加一句心情备注…" @change="saveMoodNote" />
      <span v-else class="mood-hint">点一个表情，记录此刻</span>
      <button type="button" class="btn btn-ghost festive-set-btn" @click="showFestive = true">🎯 节日</button>
    </section>

    <!-- ② 接下来：首页最高优先级 -->
    <section class="next-panel" :class="nextUp.kind" aria-label="接下来">
      <div class="next-main">
        <span class="next-label">接下来</span>
        <template v-if="nextUp.kind === 'live' || nextUp.kind === 'today'">
          <strong class="next-title">{{ nextUp.course.name }}</strong>
          <span class="next-meta">{{ nextUpTimeRange }}<template v-if="nextUp.course.room"> · {{ nextUp.course.room }}</template></span>
          <span v-if="nextUp.kind === 'live'" class="next-state live">▶ 进行中</span>
          <span v-else-if="minutesUntilNext !== null && minutesUntilNext > 0" class="next-state">距开始 {{ minutesUntilNext }} 分钟</span>
        </template>
        <template v-else-if="nextUp.kind === 'nextDay'">
          <span class="next-empty-line">今天课程已结束</span>
          <strong class="next-title">下一节：{{ nextUp.dayText }} {{ nextUp.start }} · {{ nextUp.course.name }}</strong>
        </template>
        <template v-else>
          <span class="next-empty-line">✓ 近一周没有课程安排</span>
          <strong class="next-title is-muted">可以自由安排时间</strong>
        </template>
      </div>
      <router-link to="/schedule" class="next-action">查看课程表 →</router-link>
    </section>

    <!-- ③-⑦ 基本入口以下模块：手机端等浏览器空闲后再补齐，先渲染问候与“接下来” -->
    <template v-if="entryReady">
    <!-- ③④ 课程 + 待办：桌面双栏，手机单列（待办在前） -->
    <div class="main-grid">
      <section class="panel order-tasks">
        <div class="panel-head">
          <h2>今日待办</h2>
          <span class="panel-progress">{{ todayProgress.done }} / {{ todayProgress.total }}<template v-if="todayProgress.percent"> · {{ todayProgress.percent }}%</template></span>
          <router-link to="/tasks" class="panel-link">全部 →</router-link>
        </div>

        <p v-if="!displayTasks.length" class="empty-line">
          <span class="empty-ok">✓</span>
          <span>今天的任务都完成了</span>
          <router-link to="/tasks" class="panel-link">查看全部 →</router-link>
        </p>
        <div v-else class="task-list">
          <div v-for="task in displayTasks" :key="task.id" class="task-row" :class="{ overdue: overdueCount && task.dueDate !== todayStr() }">
            <button
              type="button"
              class="task-check"
              :aria-label="task.done ? '标记为未完成' : '标记为已完成'"
              @click="toggleTask(task)"
            >✓</button>
            <div class="task-copy">
              <b>{{ task.title }}</b>
              <span :class="{ danger: task.dueDate !== todayStr() }">{{ taskDeadline(task) }}<template v-if="taskCourseLabel(task)"> · {{ taskCourseLabel(task) }}</template></span>
            </div>
            <em v-if="task.priority === 'high'" class="task-priority">优先</em>
          </div>
        </div>
      </section>

      <section class="panel order-courses">
        <div class="panel-head">
          <h2>今天课程</h2>
          <router-link to="/schedule" class="panel-link">查看课程表 →</router-link>
        </div>

        <p v-if="!todayCourses.length" class="empty-line">
          <span class="empty-ok">✓</span>
          <span>今天没有课程</span>
          <router-link to="/schedule" class="panel-link">查看课程表 →</router-link>
        </p>
        <div v-else class="course-list">
          <router-link v-for="course in todayCourses" :key="course.id" to="/schedule" class="course-row" :class="courseState(course)">
            <i :style="{ background: course.color }"></i>
            <div class="course-copy">
              <b>{{ course.name }}</b>
              <span>{{ courseTimeRange(course) || '未设置时间' }}<template v-if="course.room"> · {{ course.room }}</template></span>
            </div>
            <em>{{ courseState(course) === 'live' ? '进行中' : courseState(course) === 'done' ? '已结束' : '' }}</em>
          </router-link>
        </div>
      </section>
    </div>

    <section v-if="previewEvents.length || previewNotes.length" class="panel secondary-panel cvi-auto quick-record-summary">
      <div class="panel-head"><h2>快速记录</h2><span class="panel-progress">日程与笔记</span></div>
      <div v-for="item in previewEvents" :key="item.id" class="quick-record-row"><b>📅 {{ item.title }}</b><span>{{ item.date || '待安排' }}{{ item.time ? ` ${item.time}` : '' }}</span></div>
      <div v-for="item in previewNotes" :key="item.id" class="quick-record-row"><b>📝 {{ item.title }}</b><span>{{ item.content }}</span></div>
    </section>

    <!-- ⑤ 统一提醒：不保存业务数据，直接从待办/账单/节点/日程动态计算。 -->
    <section class="panel secondary-panel cvi-auto" v-if="unifiedReminders.length">
      <div class="panel-head">
        <h2>近期提醒</h2>
        <router-link to="/exams" class="panel-link">查看节点 →</router-link>
      </div>
      <div class="exam-list">
        <div v-for="item in unifiedReminders" :key="item.key" class="exam-row">
          <b>{{ item.sourceType === 'bill' ? '🧾 ' : item.sourceType === 'event' ? '📅 ' : item.sourceType === 'milestone' ? '⏳ ' : '✓ ' }}{{ item.title }}</b>
          <span :class="{ urgent: item.priority === 'high' || item.kind === 'overdue' }">{{ reminderMeta(item) }}</span>
          <button v-if="item.sourceType === 'task'" type="button" class="reminder-action" @click="completeReminder(item)">完成</button>
          <router-link v-else-if="item.sourceType === 'bill'" :to="{ path: '/bills', query: { tab: 'bills' } }" class="reminder-action">处理</router-link>
        </div>
      </div>
    </section>

    <!-- ⑥ 本周概况：降低优先级，紧凑一行 -->
    <section class="week-strip secondary-panel cvi-auto" aria-label="本周概况">
      <div><b>{{ weekReview.completed }}</b><span>本周完成</span></div>
      <div><b>{{ weekReview.focus }}</b><span>计划专注</span></div>
      <div :class="{ warn: weekReview.pending > 0 }"><b>{{ weekReview.pending }}</b><span>待处理</span></div>
    </section>

    </template>

    <MemoryView :open="showMemory" @close="showMemory = false" />
    <FestiveSettings :open="showFestive" @close="showFestive = false" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }

/* ① 顶部问候：紧凑单行区 */
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.greeting { font-size: clamp(19px, 2.2vw, 24px); letter-spacing: -0.01em; }
.page-desc { margin-top: 5px; color: var(--ink-soft); font-size: 12.5px; }
.fest-greet { margin-top: 5px; font-size: 12.5px; font-weight: 700; }
.head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.replay-btn { flex: 0 0 auto; padding: 9px 13px; font-size: 13px; white-space: nowrap; min-height: 40px; }

/* 心情记录：轻量一排 */
.mood-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--card);
}
.mood-label { color: var(--ink-soft); font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.mood-options { display: flex; gap: 4px; flex-wrap: wrap; }
.mood-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  font-size: 20px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  transition: background 0.14s, border-color 0.14s, transform 0.14s;
}
.mood-btn:hover { background: var(--bg-tint); }
.mood-btn.on { border-color: var(--primary); background: var(--primary-soft); transform: scale(1.05); }
.mood-note { min-width: 160px; flex: 1; padding: 8px 10px; }
.mood-hint { color: var(--ink-faint); font-size: 12px; }
.festive-set-btn {
  margin-left: auto;
  min-height: 40px;
  padding: 8px 12px;
  font-size: 12.5px;
  white-space: nowrap;
}

/* ② 接下来 */
.next-panel {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 18px 22px;
  border: 1px solid #c9d4fb;
  border-radius: var(--card-radius);
  background: linear-gradient(120deg, var(--primary-soft), var(--card) 72%);
  box-shadow: var(--shadow-sm);
}
.next-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.next-label { color: var(--primary); font-size: 10.5px; font-weight: 850; letter-spacing: 0.14em; }
.next-title { overflow: hidden; font-size: clamp(16px, 2vw, 20px); letter-spacing: -0.01em; text-overflow: ellipsis; white-space: nowrap; }
.next-meta { color: var(--ink-soft); font-size: 12.5px; }
.next-empty-line { color: var(--ink-soft); font-size: 12px; font-weight: 600; }
.next-title.is-muted { color: var(--ink-soft); font-size: 15px; font-weight: 650; }
.next-state { align-self: flex-start; padding: 4px 9px; color: var(--primary); font-size: 11.5px; font-weight: 750; border-radius: 999px; background: var(--card); border: 1px solid var(--border); }
.next-state.live { color: #fff; border-color: transparent; background: linear-gradient(135deg, #456fe8, #7855dc); }
.next-action { flex: 0 0 auto; color: var(--primary); font-size: 12.5px; font-weight: 750; text-decoration: none; white-space: nowrap; }
.next-action:hover { text-decoration: underline; }

/* ③④ 双栏 */
.main-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.panel { min-width: 0; padding: 18px; border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--card); }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.panel-head h2 { font-size: 15.5px; }
.panel-progress { color: var(--ink-soft); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; margin-right: auto; }
.panel-link { color: var(--primary); font-size: 12px; font-weight: 700; text-decoration: none; white-space: nowrap; }
.panel-link:hover { text-decoration: underline; }

/* 空状态：紧凑单行，高度自适应 */
.empty-line { display: flex; align-items: center; gap: 8px; padding: 6px 0 2px; color: var(--ink-soft); font-size: 13px; }
.empty-ok { display: grid; place-items: center; width: 22px; height: 22px; flex: 0 0 22px; color: #0d9463; font-size: 12px; font-weight: 900; border-radius: 50%; background: #e7f8f1; }
.empty-line .panel-link { margin-left: auto; }

/* 待办列表 */
.task-list { display: flex; flex-direction: column; }
.task-row { display: flex; align-items: center; gap: 11px; min-height: 52px; border-top: 1px solid var(--border); }
.task-row:first-child { border-top: 0; }
.task-check {
  display: grid; place-items: center; width: 26px; height: 26px; flex: 0 0 26px;
  color: transparent; font-size: 13px; font-weight: 900;
  border: 1.5px solid var(--border); border-radius: 8px; background: var(--bg); cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.task-check:hover { border-color: var(--primary); background: var(--primary-soft); }
.task-row.overdue .task-check { border-color: #f3c2c2; background: #fff5f4; }
.task-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.task-copy b { overflow: hidden; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.task-copy span { color: var(--ink-soft); font-size: 11.5px; }
.task-copy span.danger { color: var(--danger); font-weight: 650; }
.task-priority { flex: 0 0 auto; color: var(--danger); font-size: 11px; font-style: normal; font-weight: 800; }

/* 课程列表 */
.course-list { display: flex; flex-direction: column; }
.course-row { display: flex; align-items: center; gap: 11px; min-height: 52px; color: inherit; text-decoration: none; border-top: 1px solid var(--border); }
.course-row:first-child { border-top: 0; }
.course-row:hover b { color: var(--primary); }
.course-row i { width: 4px; height: 30px; flex: 0 0 4px; border-radius: 999px; }
.course-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.course-copy b { overflow: hidden; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.course-copy span { color: var(--ink-soft); font-size: 11.5px; }
.course-row em { flex: 0 0 auto; color: var(--ink-faint); font-size: 11px; font-style: normal; font-weight: 700; }
.course-row.live { border-radius: 10px; background: var(--primary-soft); }
.course-row.live em { color: var(--primary); }
.course-row.done { opacity: 0.55; }

/* ⑤ 提醒 */
.exam-list { display: flex; flex-direction: column; }
.exam-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; color: inherit; text-decoration: none; border-top: 1px solid var(--border); font-size: 13px; }
.exam-row:first-child { border-top: 0; }
.exam-row:hover b { color: var(--primary); }
.exam-row span { flex: 0 0 auto; color: var(--ink-soft); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.exam-row span.urgent { color: var(--danger); }
.reminder-action { flex: 0 0 auto; padding: 4px 7px; color: var(--primary); font-size: 11px; font-weight: 750; text-decoration: none; border: 0; border-radius: 6px; background: var(--primary-soft); }

/* ⑥ 本周概况 */
.week-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.week-strip > div { display: flex; align-items: baseline; justify-content: center; min-width: 0; gap: 8px; padding: 12px 10px; border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--card); }
.week-strip b { font-size: 17px; font-variant-numeric: tabular-nums; }
.week-strip span { color: var(--ink-soft); font-size: 11.5px; }
.week-strip .warn b { color: var(--danger); }

/* ⑦ 账单 */
.bill-list { display: flex; flex-direction: column; }
.bill-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; color: inherit; text-decoration: none; border-top: 1px solid var(--border); font-size: 13px; }
.bill-row:first-child { border-top: 0; }
.bill-row:hover b { color: var(--primary); }
.bill-row span { flex: 0 0 auto; color: var(--ink-soft); font-size: 12px; font-variant-numeric: tabular-nums; }

.quick-record-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); }
.quick-record-row:first-of-type { border-top: 0; }
.quick-record-row b { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.quick-record-row span { max-width: 46%; overflow: hidden; color: var(--ink-soft); font-size: 11.5px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 手机端：单列，待办优先于课程 ---------- */
@media (max-width: 860px) {
  .main-grid { grid-template-columns: 1fr; }
  /* 手机端调整顺序：接下来 → 待办 → 课程 → 提醒 → 概况 → 账单 */
  .order-tasks { order: 1; }
  .order-courses { order: 2; }
  .next-panel { padding: 16px 18px; }
  .next-action { display: none; }
}
@media (max-width: 520px) {
  .page { gap: 12px; }
  .page-head { align-items: flex-start; flex-direction: column; }
  .add-btn { width: 100%; text-align: center; }
  .panel { padding: 15px 14px; }
  .task-row { min-height: 56px; }
  .course-row { min-height: 54px; }
  .week-strip { grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .week-strip > div { flex-direction: column; align-items: center; gap: 3px; padding: 10px 6px; text-align: center; }
  .secondary-panel { margin-top: 2px; }
}
</style>
