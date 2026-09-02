<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  clock,
  MAX_WEEK,
  dayName,
  todayIndex,
  weekOf,
  sortCountdowns,
} from '../composables/store'
import {
  campusName,
  currentTimes,
  periodIndex,
  seasonName,
  courseTimeRange,
} from '../composables/store/timeConfig.js'
import {
  coursesForDate,
} from '../composables/store/schedule.js'
import { appearance, homeModuleState } from '../composables/appearance.js'
import { festiveFor } from '../composables/festive.js'
import { festiveConfig, moodLog } from '../composables/atmosphereStore.js'
import { moodOf, logMood as logMoodRecord } from '../composables/mood.js'
import MemoryView from '../components/MemoryView.vue'
import FestiveSettings from '../components/FestiveSettings.vue'
import FocusPanel from '../components/FocusPanel.vue'
import InboxPanel from '../components/InboxPanel.vue'
import Modal from '../components/Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useQuickRecordAdapters } from '../composables/quickRecord/adapters.js'
import { selectTodayActionPanels, reminderAction } from '../composables/domain/selectors.js'
import { isArchived, isTaskActionable, taskPlanningState, taskStatus } from '../composables/domain/state.js'
import { weeklyPulse } from '../composables/experience.js'
import { policyDateKey, schedulePolicy } from '../composables/settingsPolicy.js'

const domain = useDomainCommands()
const { courses, tasks, milestones: exams, bills, events, notes: quickNotes } = domain
const router = useRouter()
const focusSessions = useStoredRef('sl_focus_sessions', [])
const eventDetail = ref(null)
const showInbox = ref(false)
const quickRecord = useQuickRecordAdapters()
const now = computed(() => clock.value)
const todayKey = () => policyDateKey(now.value)
const activeSchedule = computed(() => schedulePolicy())
const homeModuleVisible = (id) => homeModuleState(id).visible !== false

/* ---------- 氛围问候 + 心情记录（模块 A） ---------- */
const todayISO = computed(() => {
  return todayKey()
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
const weekNum = computed(() => Math.min(Math.max(weekOf(todayKey()), 1), MAX_WEEK))
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
  return quotes[Number(todayKey().replace(/-/g, '')) % quotes.length]
})

function minutesOf(value) {
  if (!value) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

/* ---------- 接下来：首页最高优先级 ---------- */
function dateAfter(offset) {
  const date = new Date(`${todayKey()}T00:00:00`)
  date.setDate(date.getDate() + offset)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function itemAt(date, time = '23:59') {
  return new Date(`${date}T${time || '23:59'}`).getTime()
}

const nextUp = computed(() => {
  const nowTs = now.value.getTime()
  const candidates = []
  for (let offset = 0; offset <= 7; offset++) {
    const date = dateAfter(offset)
    const dayCourses = coursesForDate(courses.value.filter((course) => !isArchived(course)), date)
    for (const course of dayCourses) {
      const start = currentTimes()[periodIndex(course.start)]?.start || '23:59'
      const end = currentTimes()[periodIndex(course.end)]?.end || start
      const startAt = itemAt(date, start)
      const endAt = itemAt(date, end)
      if (endAt >= nowTs) candidates.push({ kind: 'course', entity: course, date, time: start, dueAt: Math.max(startAt, nowTs), state: startAt <= nowTs ? 'live' : 'upcoming' })
    }
  }
  const add = (kind, entity, date, time = '') => {
    if (!entity || !date) return
    const dueAt = itemAt(date, time || '23:59')
    if (dueAt >= nowTs && dueAt <= nowTs + 7 * 86400000) candidates.push({ kind, entity, date, time, dueAt, state: 'upcoming' })
  }
  events.value.filter((item) => !isArchived(item)).forEach((item) => add('event', item, item.date, item.time))
  tasks.value.filter((item) => isTaskActionable(item, now.value)).forEach((item) => add('task', item, item.dueDate, item.dueTime))
  bills.value.filter((item) => !isArchived(item) && item.active !== false).forEach((item) => add('bill', item, item.nextDate))
  exams.value.filter((item) => !isArchived(item) && !item.countdown?.isPast).forEach((item) => add('milestone', item, item.date, item.time))
  const next = candidates.sort((a, b) => a.dueAt - b.dueAt)[0]
  return next || { kind: 'none' }
})

const nextUpTimeRange = computed(() => {
  if (nextUp.value.kind !== 'course') return ''
  return courseTimeRange(nextUp.value.entity)
})

const nextDeparture = computed(() => {
  const course = nextUp.value.kind === 'course' ? nextUp.value.entity : null
  const travelMinutes = Math.max(0, Number(course?.travelMinutes) || 0)
  if (!course || !travelMinutes) return ''
  const start = currentTimes()[periodIndex(course.start)]?.start
  const startMinutes = minutesOf(start)
  if (startMinutes === null || startMinutes === undefined) return ''
  const leave = (startMinutes - travelMinutes + 1440) % 1440
  const prefix = course.campusId ? `${campusName(course.campusId)} · ` : ''
  return `${prefix}建议 ${String(Math.floor(leave / 60)).padStart(2, '0')}:${String(leave % 60).padStart(2, '0')} 出发`
})

const minutesUntilNext = computed(() => {
  if (nextUp.value.kind !== 'course') return null
  const start = minutesOf(nextUp.value.time)
  if (start === null) return null
  const cur = now.value.getHours() * 60 + now.value.getMinutes()
  return start - cur
})

const pulse = computed(() => weeklyPulse({ tasks: tasks.value, focusSessions: focusSessions.value, moodLog: moodLog.value }, now.value))
const experienceMessage = ref('')
let experienceMessageTimer = 0
function showExperienceMessage(message) {
  experienceMessage.value = message
  window.clearTimeout(experienceMessageTimer)
  experienceMessageTimer = window.setTimeout(() => { experienceMessage.value = '' }, 3200)
}
/* ---------- 待办 ---------- */
const unscheduledCount = computed(() => tasks.value.filter((task) => taskPlanningState(task, now.value) === 'unplanned').length)
const actionPanels = computed(() => selectTodayActionPanels({ tasks: tasks.value, bills: bills.value, milestones: exams.value, events: events.value }, now.value))
const riskItems = computed(() => actionPanels.value.risk)
const actionItems = computed(() => actionPanels.value.actions)

function dayLabel(date) {
  if (date === todayKey()) return '今天'
  const tomorrow = new Date(`${todayKey()}T00:00:00`)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const pad = (value) => String(value).padStart(2, '0')
  const tomorrowText = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  if (date === tomorrowText) return '明天'
  return date.slice(5).replace('-', '月') + '日'
}

function taskDeadline(task) {
  if (!task?.dueDate) return '未设置截止'
  if (taskStatus(task, now.value) === 'overdue') return '已逾期'
  if (task.dueDate === todayKey()) return task.dueTime ? `今天 ${task.dueTime}` : '今天截止'
  const target = new Date(task.dueDate + 'T00:00:00')
  const today = new Date(todayKey() + 'T00:00:00')
  const days = Math.round((target - today) / 86400000)
  if (days < 0) return `已逾期 ${-days} 天`
  if (days === 1) return task.dueTime ? `明天 ${task.dueTime}` : '明天截止'
  return `${dayLabel(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`
}

/* ---------- 倒计时 / 提醒 ---------- */
const inboxCount = computed(() => quickNotes.value.filter((note) => note.inboxStatus !== 'organized' && note.inboxStatus !== 'archived' && !isArchived(note)).length)

function organizeInbox(note, targetType) {
  const result = quickRecord.convertNote(note.id, targetType)
  showExperienceMessage(result.message || result.error || '已更新收件箱')
}

function archiveInbox(note) {
  domain.archiveNote(note.id)
  showExperienceMessage('已归档')
}

function reminderMeta(item) {
  if (item.kind === 'overdue') return '已逾期'
  if (item.sourceType === 'task') return taskDeadline(item.entity)
  if (item.sourceType === 'bill') return `${item.entity.nextDate?.slice(5).replace('-', '/')} · ¥${Number(item.entity.amount || 0).toFixed(2)}`
  if (item.sourceType === 'event') return `${item.entity.date || '待安排'}${item.entity.time ? ` ${item.entity.time}` : ''}`
  return item.entity.countdown?.text || countdownLabel(sortCountdowns([item.entity], now.value)[0])
}
function completeReminder(item) {
  const action = reminderAction(item)
  if (action.action === 'complete') domain.toggleTask(action.targetId)
  else if (action.action === 'pay') {
    const result = domain.payBill(action.targetId)
    showExperienceMessage(result?.duplicate ? '本计费周期已经记过账' : '已记录本期账单')
  } else if (action.action === 'view') {
    if (action.targetType === 'event') {
      eventDetail.value = events.value.find((event) => event.id === action.targetId) || null
    } else router.push(action.targetType === 'milestone' ? '/exams' : action.targetType === 'bill' ? '/bills' : '/tasks')
  }
}

function openNext() {
  const item = nextUp.value
  if (item.kind === 'course') router.push('/schedule')
  else if (item.kind === 'event') eventDetail.value = item.entity
  else if (item.kind === 'milestone') router.push('/exams')
  else if (item.kind === 'bill') router.push('/bills')
  else if (item.kind === 'task') router.push('/tasks')
}

function nextTitle(item) {
  if (item.kind === 'course') return item.entity.name
  if (item.kind === 'event') return item.entity.title
  if (item.kind === 'task') return item.entity.title
  if (item.kind === 'bill') return item.entity.name
  if (item.kind === 'milestone') return item.entity.name
  return ''
}

function nextMeta(item) {
  const day = item.date === todayKey() ? '今天' : item.date?.slice(5).replace('-', '月') + '日'
  if (item.kind === 'course') return `${day} ${nextUpTimeRange.value}${item.entity.room ? ` · ${item.entity.room}` : ''}`
  if (item.kind === 'bill') return `${day} · ¥${Number(item.entity.amount || 0).toFixed(2)}`
  return `${day}${item.time ? ` ${item.time}` : ''}`
}

function countdownLabel(item) {
  const state = item.countdown
  if (state.text === '今天') return '今天'
  if (state.label === '小时') return `${state.text}小时`
  if (state.label === '分钟') return `${state.text}分钟`
  return `${state.text}天`
}

</script>

<template>
  <div class="page today-page">
    <header class="page-head">
      <div class="head-copy">
        <h1 class="greeting">{{ greeting() }}<template v-if="currentQuote">，{{ currentQuote }}</template></h1>
        <p class="page-desc">{{ dateText }} · 第 {{ weekNum }} 周 · {{ campusName(activeSchedule.campusId) }} · {{ seasonName(activeSchedule.seasonId) }}</p>
        <p v-if="festive" class="fest-greet" :style="{ color: festive.accentColor }">🎉 {{ festive.name }} · {{ festive.message }}</p>
      </div>
      <div class="head-actions"><button type="button" class="btn btn-ghost replay-btn" @click="showMemory = true">↺ 回放</button></div>
    </header>

    <template v-if="entryReady">
      <section v-if="homeModuleVisible('next')" class="next-panel" :class="nextUp.kind" aria-label="接下来">
        <div class="next-main">
          <span class="next-label">接下来</span>
          <template v-if="nextUp.kind !== 'none'">
            <strong class="next-title">{{ nextTitle(nextUp) }}</strong>
            <span class="next-meta">{{ nextMeta(nextUp) }}<template v-if="nextUp.kind === 'course' && nextDeparture"> · {{ nextDeparture }}</template></span>
            <span v-if="nextUp.state === 'live'" class="next-state live">▶ 进行中</span>
            <span v-else-if="minutesUntilNext !== null && minutesUntilNext > 0" class="next-state">距开始 {{ minutesUntilNext }} 分钟</span>
          </template>
          <template v-else><span class="next-empty-line">今天暂时没有紧接着要处理的事项。</span><strong class="next-title is-muted">可以自由安排时间</strong></template>
        </div>
        <button v-if="nextUp.kind !== 'none'" type="button" class="next-action" @click="openNext">{{ nextUp.kind === 'course' ? '查看课程表' : '查看' }} →</button>
      </section>

      <p v-if="experienceMessage" class="experience-message" role="status">✓ {{ experienceMessage }}</p>

      <section v-if="homeModuleVisible('countdowns') && riskItems.length" class="action-panel risk-panel" aria-label="需要注意">
        <div class="panel-head"><div><h2>需要注意</h2><span class="panel-subtitle">只显示逾期、临近截止和即将到期</span></div></div>
        <div class="action-list">
          <div v-for="item in riskItems" :key="item.key" class="action-row risk-row">
            <span class="action-mark">⚠</span><div class="action-copy"><b>{{ item.title }}</b><span>{{ reminderMeta(item) }}</span></div>
            <button type="button" class="reminder-action" @click="completeReminder(item)">{{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }}</button>
          </div>
        </div>
      </section>

      <section v-if="homeModuleVisible('tasks') && actionItems.length" class="action-panel" aria-label="现在该做">
        <div class="panel-head"><div><h2>现在该做</h2><span class="panel-subtitle">最多显示 3 件，做完就会消失</span></div><router-link to="/tasks" class="panel-link">查看待办 →</router-link></div>
        <div class="action-list">
          <div v-for="item in actionItems" :key="item.key" class="action-row">
            <span class="action-mark">○</span><div class="action-copy"><b>{{ item.title }}</b><span>{{ reminderMeta(item) }}</span></div>
            <button type="button" class="reminder-action" @click="completeReminder(item)">{{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }}</button>
          </div>
        </div>
      </section>
      <p v-else-if="homeModuleVisible('tasks')" class="quiet-empty">今天暂时没有需要马上处理的事项。</p>

      <section v-if="unscheduledCount" class="compact-link-row"><span>待安排 <b>{{ unscheduledCount }}</b></span><small>还没有日期的事项</small><router-link to="/tasks">去安排 →</router-link></section>

      <section v-if="homeModuleVisible('week')" class="week-progress panel" aria-label="本周进展">
        <div class="panel-head"><div><h2>本周进展</h2><span class="panel-subtitle">{{ pulse.suggestion }}</span></div><router-link class="panel-link" to="/review">查看回顾 →</router-link></div>
        <p>{{ pulse.done }} 项完成 · 专注 {{ pulse.minutes ? `${pulse.minutes} 分钟` : '暂无记录' }}<template v-if="inboxCount"> · 待整理 {{ inboxCount }} 条笔记</template></p>
      </section>

      <section v-if="inboxCount" class="inbox-entry">
        <button type="button" class="compact-link-row compact-button" @click="showInbox = !showInbox"><span>收件箱 <b>待整理 {{ inboxCount }}</b></span><small>保存的内容都在这里</small><span class="compact-action">{{ showInbox ? '收起 ↑' : '查看 →' }}</span></button>
        <InboxPanel v-if="showInbox" :notes="quickNotes.filter((note) => note.inboxStatus !== 'organized' && note.inboxStatus !== 'archived' && !isArchived(note))" @convert="organizeInbox" @archive="archiveInbox" />
      </section>

      <section class="today-mood-lower" aria-label="记录今天心情">
        <span class="mood-label">今天心情</span><div class="mood-options"><button v-for="emoji in MOOD_OPTIONS" :key="emoji" type="button" class="mood-btn" :class="{ on: todayMood?.mood === emoji }" :aria-label="`记录心情 ${emoji}`" @click="logMood(emoji)">{{ emoji }}</button></div>
        <input v-if="todayMood" v-model="moodNoteDraft" class="mood-note" placeholder="加一句备注…" @change="saveMoodNote" />
        <button type="button" class="btn btn-ghost festive-set-btn" @click="showFestive = true">🎯 节日</button>
      </section>
      <FocusPanel v-if="homeModuleVisible('focus')" />
    </template>

    <MemoryView :open="showMemory" @close="showMemory = false" />
    <FestiveSettings :open="showFestive" @close="showFestive = false" />
    <Modal v-if="eventDetail" :open="Boolean(eventDetail)" title="日程详情" medium @close="eventDetail = null">
      <div class="event-detail"><h3>{{ eventDetail.title }}</h3><p>{{ eventDetail.date || '待安排' }}<template v-if="eventDetail.time"> · {{ eventDetail.time }}</template><template v-if="eventDetail.endTime">–{{ eventDetail.endTime }}</template></p><p v-if="eventDetail.location">地点：{{ eventDetail.location }}</p><p v-if="eventDetail.courseName">课程：{{ eventDetail.courseName }}</p><p v-if="eventDetail.note" class="event-detail-note">{{ eventDetail.note }}</p></div>
    </Modal>
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
.experience-message { padding: 8px 12px; color: #087a58; font-size: 12.5px; border: 1px solid #b9e6d5; border-radius: 9px; background: #effaf6; }
.action-panel { padding: 16px 18px; border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--card); }
.risk-panel { border-color: #f1c8c8; background: #fffafa; }
.panel-head > div { min-width: 0; }
.panel-subtitle { display: block; margin-top: 3px; color: var(--ink-faint); font-size: 11.5px; font-weight: 500; }
.action-list { display: flex; flex-direction: column; }
.action-row { display: flex; align-items: center; gap: 10px; min-height: 48px; border-top: 1px solid var(--border); }
.action-row:first-child { border-top: 0; }
.action-mark { display: grid; place-items: center; width: 24px; height: 24px; flex: 0 0 24px; color: var(--primary); font-size: 17px; }
.risk-row .action-mark, .risk-row .action-copy span { color: var(--danger); }
.action-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.action-copy b { overflow: hidden; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.action-copy span { color: var(--ink-soft); font-size: 11.5px; }
.quiet-empty { padding: 14px 16px; color: var(--ink-soft); font-size: 13px; border: 1px dashed var(--border-strong); border-radius: var(--card-radius); background: var(--bg-tint); }
.compact-link-row { display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 0 4px; color: var(--text); font-size: 13px; }
.compact-link-row > span { font-weight: 750; }
.compact-link-row > span b { color: var(--primary); }
.compact-link-row small { color: var(--ink-faint); font-size: 11.5px; }
.compact-link-row a { margin-left: auto; color: var(--primary); font-size: 12px; font-weight: 750; text-decoration: none; white-space: nowrap; }
.compact-button { width: 100%; border: 0; background: transparent; text-align: left; cursor: pointer; }
.compact-action { margin-left: auto; color: var(--primary); font-size: 12px; font-weight: 750; white-space: nowrap; }
.inbox-entry { display: flex; flex-direction: column; gap: 7px; }
.inbox-entry > .inbox { margin: 0; }
.week-progress { padding: 16px 18px; }
.week-progress p { color: var(--ink-soft); font-size: 12px; }
.today-mood-lower { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 3px 4px; }
.today-mood-lower .mood-options { display: flex; gap: 2px; }
.today-mood-lower .mood-btn { width: 32px; height: 32px; font-size: 17px; }
.today-mood-lower .mood-note { min-width: 140px; flex: 1; max-width: 320px; padding: 7px 9px; }
.today-mood-lower .festive-set-btn { margin-left: auto; min-height: 34px; padding: 6px 10px; }
.event-detail { display: flex; flex-direction: column; gap: 8px; }
.event-detail h3 { font-size: 18px; }
.event-detail p { margin: 0; color: var(--ink-soft); font-size: 13px; }
.event-detail .event-detail-note { padding-top: 8px; color: var(--text); white-space: pre-wrap; border-top: 1px solid var(--border); }

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
.course-load { padding-block: 14px; }
.load-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 35px; border-top: 1px solid var(--border); }
.load-row:first-of-type { border-top: 0; }
.load-row b { font-size: 13px; }
.load-row span { color: var(--ink-soft); font-size: 11.5px; }

/* ---------- 手机端：单列，待办优先于课程 ---------- */
@media (max-width: 860px) {
  .main-grid { grid-template-columns: 1fr; }
  /* 手机端调整顺序：接下来 → 待办 → 课程 → 提醒 → 概况 → 账单 */
  .order-tasks { order: 1; }
  .order-courses { order: 2; }
  .next-panel { padding: 16px 18px; }
  .next-action { display: block; }
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
  .action-panel { padding: 14px; }
  .action-row { min-height: 52px; }
  .compact-link-row { flex-wrap: wrap; gap: 5px 8px; padding-block: 4px; }
  .compact-link-row small { flex: 1 0 100%; padding-left: 2px; }
  .compact-link-row a { margin-left: auto; }
}
</style>
