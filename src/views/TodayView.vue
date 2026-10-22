<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { accountUser } from '../composables/accountAuth.js'
import { hasVerifiedContactEmail } from '../composables/accountVerification.js'
import {
  MAX_WEEK,
  dayName,
  sortCountdowns,
} from '../composables/store'
import {
  campusName,
  seasonName,
} from '../composables/store/timeConfig.js'
import { appearance, HOME_MODULES } from '../composables/appearance.js'
import { moodLog } from '../composables/atmosphereStore.js'
// 当天氛围直接用外壳那份共享 computed（见 festiveAtmosphere.js 的说明）：
// 这里原先自己又算了一遍同一天的 festiveFor()。
import { festiveToday } from '../composables/festiveAtmosphere.js'
import { narrativeFor, narrativeLang } from '../composables/narrative.js'
import MemoryView from '../components/MemoryView.vue'
import TodayAgenda from '../components/TodayAgenda.vue'
import TodayActionList from '../components/TodayActionList.vue'
import FocusPanel from '../components/FocusPanel.vue'
// Render the guide with the home route; inserting this small panel after paint
// pushes every visible home section down on a first visit.
import HomeProductivityPanel from '../components/HomeProductivityPanel.vue'
import Modal from '../components/Modal.vue'
import { Button } from '../components/ui/button'
import AppIcon from '../components/AppIcon.vue'
import { useStoredRef } from '../composables/store/index.js'
import { animationsEnabled } from '../composables/motion.js'
import { coursesForDates } from '../composables/store/schedule.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { selectTodayActionPanels, reminderAction } from '../composables/domain/selectors.js'
import { selectWeeklyBillSummary, weekRange } from '../composables/domain/weeklySelectors.js'
import { normalizeLedgerFx, summarizeLedgerInBase, useLedgerFx } from '../composables/ledgerFx.js'
import { mySpendYuan } from '../composables/ledgerSplit.js'
import { moneyRow, moneyWithCurrency } from '../utils/formatters.js'
import { isTaskActionable, taskPlanningState, taskStatus } from '../composables/domain/state.js'
import { COURSE_CHECKIN_STATES, upsertCourseCheckin, weeklyPulse } from '../composables/experience.js'
import { schedulePolicy } from '../composables/settingsPolicy.js'
import { addAppDays, appCalendarDaysBetween, appNow, appToday, currentDayIndex, currentWeek, getAppTime, formatAppDate } from '../composables/timeContext.js'
import { selectHomeNextUp } from '../composables/home/nextUp.js'
import { taskFocusLocation } from '../composables/learningFocus.js'
import { MOOD_OPTIONS, logMood, moodOf } from '../composables/mood.js'
import { focusLocation } from '../composables/focusNavigation.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import { recordStartupTiming, reportStartupAssetSummary, startupNow } from '../composables/startupDiagnostics.js'

// Keep campus-social utilities out of the initial home route for guests and until
// a verified user's calendar section approaches the viewport.
const SocialCalendarEvents = defineAsyncComponent(() => import('../components/SocialCalendarEvents.vue'))
const canShowSocialCalendar = computed(() => Boolean(accountUser.value?.id && hasVerifiedContactEmail()))
const socialCalendarAnchor = ref(null)
const shouldLoadSocialCalendar = ref(false)
let socialCalendarObserver = null
onMounted(() => {
  if (!socialCalendarAnchor.value) return
  if (typeof IntersectionObserver === 'undefined') {
    shouldLoadSocialCalendar.value = true
    return
  }
  socialCalendarObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    shouldLoadSocialCalendar.value = true
    socialCalendarObserver?.disconnect()
    socialCalendarObserver = null
  })
  socialCalendarObserver.observe(socialCalendarAnchor.value)
})
onBeforeUnmount(() => {
  socialCalendarObserver?.disconnect()
  socialCalendarObserver = null
})
const domain = useDomainCommands()
const { courses, tasks, milestones: exams, bills, transactions, events } = domain
// Stored arrays notify through triggerRef after in-place edits. Give the child
// fresh array props so its computed agenda also updates without a route reload.
const agendaData = computed(() => ({ courses: [...courses.value], events: [...events.value] }))
const { fx: ledgerFx } = useLedgerFx()
const router = useRouter()
const route = useRoute()
/** @type {import('vue').Ref<{ id: string, minutes: number, token: number } | null>} */
const focusRequest = ref(null)
let focusRequestToken = 0
watch(() => [route.path, route.query.focusTask, route.query.focusMinutes], ([path, id, minutes]) => {
  if (path !== '/') { focusRequest.value = null; return }
  if (!id) return
  focusRequest.value = { id: String(id), minutes: Math.max(5, Math.min(180, Math.round(Number(minutes) || 25))), token: ++focusRequestToken }
}, { immediate: true })
const focusSessions = useStoredRef('sl_focus_sessions', [])
const activeFocus = useStoredRef('sl_focus_active', null)
const courseCheckins = useStoredRef('sl_course_checkins', [])
const eventDetail = ref(null)
const focusMessage = ref('')
let focusHandled = ''
const now = appNow
const todayKey = () => appToday.value
const activeSchedule = computed(() => schedulePolicy())
const compactHome = computed(() => appearance.value.compactHome !== false)
// 「今日安排」默认展开：桌面端两栏布局左栏靠它撑住，手机端先折叠（一行摘要），
// 否则用户要滚过一整天的课表才够得到「今天最重要」。
const agendaOpen = ref(typeof window !== 'undefined'
  ? window.matchMedia('(min-width: 901px)').matches
  : true)
/** @param {Event} event */
function syncAgendaOpen(event) {
  if (event.target instanceof window.HTMLDetailsElement) agendaOpen.value = event.target.open
}
const resumeTask = computed(() => tasks.value.filter((task) => isTaskActionable(task, now.value)
  && (task.workCheckpoint?.nextStep || task.workCheckpoint?.lastStep || task.workCheckpoint?.blocker))
  .sort((a, b) => String(b.workCheckpoint?.updatedAt || b.updatedAt || '').localeCompare(String(a.workCheckpoint?.updatedAt || a.updatedAt || '')))[0])
// 首页模块按用户在个性化里拖拽后的顺序渲染；只保留可见且仍合法的模块 id。
const visibleHomeModuleIds = computed(() => {
  const ids = appearance.value.homeModules
    .filter((module) => module.visible !== false)
    .map((module) => module.id)
    .filter((id) => HOME_MODULES.some((item) => item.id === id))
  const visible = compactHome.value ? ids.filter((id) => !['week', 'finance'].includes(id)) : ids
  return focusRequest.value || activeFocus.value ? ['focus', ...visible.filter((id) => id !== 'focus')] : visible
})

async function onFocusPrepared(result) {
  focusMessage.value = result.message
  await nextTick()
  if (route.path !== '/' || String(route.query.focusTask || '') !== result.taskId) return
  document.querySelector('.focus-panel')?.scrollIntoView({ block: 'center', behavior: animationsEnabled() ? 'smooth' : 'auto' })
  const query = { ...route.query }
  delete query.focusTask
  delete query.focusMinutes
  await router.replace({ query })
}

/* ---------- 氛围问候 + 心情记录（模块 A） ---------- */
const showMemory = ref(false)
const sessionQuoteIndex = Math.floor(Math.random() * 50)
const weekNum = computed(() => Math.min(Math.max(currentWeek.value, 1), MAX_WEEK))
const dateText = computed(
  () => `${formatAppDate(todayKey(), { withWeekday: false })} · ${dayName(currentDayIndex.value)}`
)

const todayMood = computed(() => moodOf(todayKey(), moodLog.value))
const moodNote = ref('')
watch(appToday, () => { moodNote.value = todayMood.value?.note ?? '' }, { immediate: true })
function chooseMood(mood) {
  moodLog.value = logMood(todayKey(), mood, moodNote.value, moodLog.value)
  showExperienceMessage('今天的心情已记录')
}
function moveMood(event) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const buttons = [...event.currentTarget.querySelectorAll('[role="radio"]')]
  const current = buttons.indexOf(event.target)
  const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + offset + buttons.length) % buttons.length
  buttons[index]?.focus()
  if (MOOD_OPTIONS[index]) chooseMood(MOOD_OPTIONS[index])
}
function updateMoodNote() {
  if (!todayMood.value) return
  moodLog.value = logMood(todayKey(), todayMood.value.mood, moodNote.value, moodLog.value)
}

async function focusRouteEvent() {
  const { id, section } = readFocusQuery(route)
  if (!id || section !== 'event' || focusHandled === id) return
  focusHandled = id
  const event = events.value.find((item) => String(item.id) === id)
  if (!event) {
    focusMessage.value = '这条日程可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  eventDetail.value = event
  await nextTick()
  const element = await focusElementWhenReady(id)
  if (!element) focusMessage.value = '这条日程可能已删除或已移动。'
  await clearFocusFromRoute(router, route)
}

watch(
  () => [route.query.focus, route.query.section, events.value.length],
  () => { void focusRouteEvent() },
  { immediate: true }
)

// 手机端先渲染“基本入口”（问候 + 接下来），其余模块等浏览器空闲后一帧补齐，
// 避免首屏一次性挂载全部面板；桌面端维持原有即时渲染。
const mobileEntry = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
const entryReady = ref(!mobileEntry)
const homeSetupStartedAt = startupNow()
let homeContentTimingReported = false
async function reportHomeContentReady() {
  if (homeContentTimingReported) return
  homeContentTimingReported = true
  await nextTick()
  recordStartupTiming({ label: 'home-content', durationMs: startupNow() - homeSetupStartedAt })
  reportStartupAssetSummary()
}

if (!mobileEntry) onMounted(() => { void reportHomeContentReady() })
if (mobileEntry && typeof window !== 'undefined') {
  const finishEntry = () => {
    entryReady.value = true
    void reportHomeContentReady()
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(finishEntry, { timeout: 500 })
  else window.setTimeout(finishEntry, 220)
}

function greeting() {
  const hour = Number(getAppTime(now.value).slice(0, 2))
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/* 节日叙事（第五十四轮）。氛围引擎一直在产出节日名与祝福语，但此前**只被用来决定装饰**，
   文案一处都没渲染过（首页问候语是纯时间问候）。这里把它接进页头，并让文案可以走多语言；
   范围与边界见 composables/narrative.js 的文件头说明。
   `festiveToday` 直接复用外壳那份共享 computed，首页不再自己算一遍。 */
const festiveNarrative = computed(() => narrativeFor(festiveToday.value, narrativeLang.value))

const currentQuote = computed(() => {
  if (!appearance.value.showQuote) return ''
  const quotes = appearance.value.quotes.length ? appearance.value.quotes : ['今天也要漂亮通关。']
  if (appearance.value.quoteMode === 'fixed') return quotes[appearance.value.fixedQuoteIndex] ?? quotes[0]
  if (appearance.value.quoteMode === 'random') return quotes[sessionQuoteIndex % quotes.length]
  return quotes[Number(todayKey().replace(/-/g, '')) % quotes.length]
})

/* ---------- 接下来：首页最高优先级 ---------- */
const nextProjection = computed(() => selectHomeNextUp({
  courses: courses.value,
  tasks: tasks.value,
  events: events.value,
  bills: bills.value,
  milestones: exams.value,
  now: now.value,
  today: todayKey(),
  preferCourses: compactHome.value,
}))
const nextUp = computed(() => nextProjection.value.nextUp)
const nextUpTimeRange = computed(() => nextProjection.value.nextUpTimeRange)
const nextDeparture = computed(() => nextProjection.value.nextDeparture)
const nextTimingLabel = computed(() => nextProjection.value.nextTimingLabel)

const pulse = computed(() => weeklyPulse({ tasks: tasks.value, focusSessions: focusSessions.value, courseCheckins: courseCheckins.value, moodLog: moodLog.value }, now.value))
const todayCourses = computed(() => coursesForDates(courses.value, [todayKey()])[0] || [])
const todayEvents = computed(() => events.value.filter((item) => item?.date === todayKey()))
// 折叠态的摘要要能一句话说清今天有多少安排，展开后里面再列细节。
const todayAgendaCount = computed(() => {
  const parts = []
  if (todayCourses.value.length) parts.push(`${todayCourses.value.length} 节课`)
  if (todayEvents.value.length) parts.push(`${todayEvents.value.length} 项日程`)
  return parts.join(' · ') || '暂无安排'
})
const COURSE_CHECKIN_OPTIONS = Object.freeze([
  { state: COURSE_CHECKIN_STATES.understood, label: '听懂了' },
  { state: COURSE_CHECKIN_STATES.unclear, label: '有疑问' },
  { state: COURSE_CHECKIN_STATES.review, label: '需要复习' },
  { state: COURSE_CHECKIN_STATES.absent, label: '缺席' },
])
const courseCheckinState = (course) => courseCheckins.value.find((item) => item.date === todayKey() && String(item.courseId) === String(course.id))?.state || ''
function markCourseCheckin(course, state) {
  courseCheckins.value = upsertCourseCheckin(courseCheckins.value, {
    courseId: course.id, courseName: course.name, state, date: todayKey(),
  }, now.value)
  showExperienceMessage(`已记录「${course.name}」的课后反馈`)
}
const weeklyFinance = computed(() => {
  const range = weekRange(now.value)
  return summarizeLedgerInBase(transactions.value, ledgerFx.value, {
    dateFilter: (date) => date >= range.startDate && date < range.endDate,
    amountOf: mySpendYuan,
  })
})
const weeklyBills = computed(() => selectWeeklyBillSummary({ bills: bills.value, transactions: transactions.value }, now.value))
const weeklyBillFinance = computed(() => {
  const range = weekRange(now.value)
  const paidBills = transactions.value.filter((item) => item?.source === 'bill')
  return summarizeLedgerInBase(paidBills, ledgerFx.value, {
    dateFilter: (date) => date >= range.startDate && date < range.endDate,
    amountOf: mySpendYuan,
  })
})
const ledgerCurrency = computed(() => normalizeLedgerFx(ledgerFx.value).base)
function fxSummaryNote(summary) {
  const prefix = summary.hasForeign
    ? `已按 ${summary.ratesUpdatedAt || '未记录日期'} 手动汇率折算为 ${summary.base}`
    : `金额单位 ${summary.base}`
  return summary.hasMissing
    ? `${prefix}；${summary.missingRates.join('、')} 缺少汇率，${summary.excludedCount} 笔未计入`
    : prefix
}
const weeklyFinanceNote = computed(() => fxSummaryNote(weeklyFinance.value))
const weeklyBillFinanceNote = computed(() => fxSummaryNote(weeklyBillFinance.value))
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
  const tomorrowText = addAppDays(todayKey(), 1)
  if (date === tomorrowText) return '明天'
  return date.slice(5).replace('-', '月') + '日'
}

function taskDeadline(task) {
  if (!task?.dueDate) return '未设置截止'
  if (taskStatus(task, now.value) === 'overdue') return '已逾期'
  if (task.dueDate === todayKey()) return task.dueTime ? `今天 ${task.dueTime}` : '今天截止'
  const days = appCalendarDaysBetween(todayKey(), task.dueDate)
  if (days < 0) return `已逾期 ${-days} 天`
  if (days === 1) return task.dueTime ? `明天 ${task.dueTime}` : '明天截止'
  return `${dayLabel(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ''}`
}

/* ---------- 倒计时 / 提醒 ---------- */
function reminderMeta(item) {
  if (item.timeSummary) return item.timeSummary
  if (item.kind === 'overdue') return '已逾期'
  if (item.sourceType === 'task') return taskDeadline(item.entity)
  if (item.sourceType === 'bill') return `${dayLabel(item.entity.nextDate)} · ${moneyRow(item.entity.amount)}`
  if (item.sourceType === 'event') return `${item.entity.date || '待安排'}${item.entity.time ? ` ${item.entity.time}` : ''}`
  return item.entity.countdown?.text || countdownLabel(sortCountdowns([item.entity], now.value)[0])
}
function completeReminder(item) {
  const action = reminderAction(item)
  if (action.action === 'complete') domain.toggleTask(action.targetId)
  else if (action.action === 'pay') {
    const result = domain.payBill(action.targetId)
    showExperienceMessage(result?.blocked ? result.reason : result?.duplicate ? '本计费周期已经记过账' : '已记录本期账单')
  } else if (action.action === 'view') {
    if (action.targetType === 'event') {
      eventDetail.value = events.value.find((event) => event.id === action.targetId) || null
    } else if (action.targetType === 'milestone') router.push(focusLocation('/exams', action.targetId))
    else if (action.targetType === 'bill') router.push(focusLocation('/bills', action.targetId, { section: 'bill' }))
    else router.push(focusLocation('/tasks', action.targetId))
  }
}

function openNext() {
  const item = nextUp.value
  if (item.kind === 'course') router.push(focusLocation('/schedule', item.entity.id, { date: item.date }))
  else if (item.kind === 'event') eventDetail.value = item.entity
  else if (item.kind === 'milestone') router.push(focusLocation('/exams', item.entity.id))
  else if (item.kind === 'bill') router.push(focusLocation('/bills', item.entity.id, { section: 'bill' }))
  else if (item.kind === 'task') router.push(focusLocation('/tasks', item.entity.id))
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
  if (item.timeSummary) return item.timeSummary
  const day = dayLabel(item.date)
  if (item.kind === 'course') return `${day} ${nextUpTimeRange.value}${item.entity.room ? ` · ${item.entity.room}` : ''}`
  if (item.kind === 'bill') return `${day} · ${moneyRow(item.entity.amount)}`
  return `${day}${item.time ? ` ${item.time}` : ''}`
}

function countdownLabel(item) {
  const state = item.countdown
  if (state.relativeText) return state.relativeText
  if (state.text === '今天') return '今天'
  if (state.label === '小时') return `${state.text}小时`
  if (state.label === '分钟') return `${state.text}分钟`
  return `${state.text}天`
}

</script>

<template>
  <div class="today-layout">
  <div class="page today-page" :class="{ 'has-focus-request': focusRequest }">
    <header class="page-head today-page-head">
      <div class="head-copy">
        <h1 class="greeting">{{ greeting() }}，{{ compactHome ? '今天' : '把今天安排好。' }}</h1>
        <p v-if="currentQuote && !compactHome" class="today-quote">{{ currentQuote }}</p>
        <p class="page-desc today-context">
          <time class="today-context-date" :datetime="todayKey()">{{ dateText }}</time>
          <span class="today-context-chip">第 {{ weekNum }} 周</span>
          <span v-if="!compactHome" class="today-context-chip">{{ campusName(activeSchedule.campusId) }}</span>
          <span v-if="!compactHome" class="today-context-chip">{{ seasonName(activeSchedule.seasonId) }}</span>
        </p>
        <!-- 节日叙事：只有当天真的有节日/纪念日时才出现，平时不占位置、不进 Tab 序。 -->
        <p v-if="festiveNarrative" class="festive-narrative">
          <span class="festive-narrative-mark" aria-hidden="true">✦</span>
          <strong>{{ festiveNarrative.name }}</strong>
          <span>{{ festiveNarrative.message }}</span>
        </p>
      </div>
      <div class="head-actions"><Button variant="ghost" class="replay-btn" @click="showMemory = true"><AppIcon name="review" />回放</Button></div>
    </header>

    <template v-if="entryReady">
      <p v-if="experienceMessage" class="experience-message" role="status">✓ {{ experienceMessage }}</p>
      <p v-if="focusMessage" class="experience-message" role="status">{{ focusMessage }}</p>

      <template v-for="id in visibleHomeModuleIds" :key="id">
        <template v-if="id === 'next'">
          <section class="next-panel glass-flow" :class="nextUp.kind" aria-label="接下来">
            <div class="next-main">
              <span class="next-label">{{ nextUp.kind === 'course' ? '下一节课' : '接下来' }}</span>
              <template v-if="nextUp.kind !== 'none'">
                <strong class="next-title">{{ nextTitle(nextUp) }}</strong>
                <span class="next-meta">{{ nextMeta(nextUp) }}<template v-if="nextUp.kind === 'course' && nextDeparture"> · {{ nextDeparture }}</template></span>
                <span v-if="nextUp.state === 'active'" class="next-state live">▶ {{ nextTimingLabel }}</span>
                <span v-else-if="nextTimingLabel" class="next-state">{{ nextTimingLabel }}</span>
              </template>
              <template v-else><strong class="next-title is-muted">近期没有固定安排</strong><span class="next-empty-line">课程和已安排的事项会出现在这里。</span></template>
            </div>
            <!-- 两个按钮收进一个容器：以前它们是面板的直接子元素，
                 space-between 会把「查看课程表」推到中间、「记作业」推到最右，
                 读起来像两个互不相干的按钮。这里让它们始终并排站在同一边。 -->
            <div class="next-actions">
              <Button v-if="nextUp.kind !== 'none'" class="next-action whitespace-normal" @click="openNext">{{ nextUp.kind === 'course' ? '查看课程表' : nextUp.kind === 'task' ? '处理待办' : nextUp.kind === 'event' ? '查看日程' : '查看详情' }}</Button>
              <Button v-if="nextUp.kind === 'course'" as-child variant="outline" class="next-action whitespace-normal"><RouterLink :to="{ path: '/tasks', query: { new: '1', courseId: nextUp.entity.id } }">记作业</RouterLink></Button>
              <Button v-else-if="nextUp.kind === 'none'" as-child class="next-action whitespace-normal"><RouterLink to="/schedule">查看课表</RouterLink></Button>
            </div>
          </section>
          <details :open="agendaOpen" class="today-agenda-disclosure today-agenda-section" @toggle="syncAgendaOpen"><summary>今日安排<span class="today-agenda-count">{{ todayAgendaCount }}</span></summary><TodayAgenda :courses="agendaData.courses" :events="agendaData.events" :today="todayKey()" :now="now" /></details>
          <section v-if="compactHome && resumeTask" class="compact-link-row"><div><b>接着上次 · {{ resumeTask.title }}</b><p>{{ resumeTask.workCheckpoint.nextStep || resumeTask.workCheckpoint.lastStep || resumeTask.workCheckpoint.blocker }}</p></div><Button as-child variant="outline"><RouterLink :to="taskFocusLocation(resumeTask, 15)">继续 15 分钟</RouterLink></Button></section>
        </template>

        <TodayActionList
          v-if="id === 'tasks'"
          mode="actions"
          :items="actionItems"
          :empty="!riskItems.length"
          :meta="reminderMeta"
          @activate="completeReminder"
        />
        <TodayActionList
          v-else-if="id === 'countdowns' && riskItems.length"
          mode="risks"
          :items="riskItems"
          :meta="reminderMeta"
          @activate="completeReminder"
        />

        <section v-else-if="id === 'week'" class="week-progress panel" aria-label="本周进展">
          <div class="panel-head"><div><h2>本周进展</h2><span class="panel-subtitle">{{ pulse.suggestion }}</span></div><router-link class="panel-link" to="/review">查看回顾</router-link></div>
          <p>{{ pulse.done }} 项完成 · 专注 {{ pulse.minutes ? `${pulse.minutes} 分钟` : '暂无记录' }}</p>
          <div v-if="todayCourses.length" class="today-course-checkins" aria-label="今日课程反馈">
            <div v-for="course in todayCourses" :key="course.id" class="today-course-checkin">
              <b>{{ course.name }}</b>
              <div role="group" :aria-label="`${course.name}课后反馈`">
                <button v-for="option in COURSE_CHECKIN_OPTIONS" :key="option.state" type="button" :aria-pressed="courseCheckinState(course) === option.state" @click="markCourseCheckin(course, option.state)">{{ option.label }}</button>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="id === 'finance'" class="week-finance panel" aria-label="本周收支">
          <div class="panel-head"><div><h2>本周收支</h2><span class="panel-subtitle">按本周账本记录汇总</span></div><router-link class="panel-link" to="/bills">打开账本</router-link></div>
          <div class="week-finance-stats">
            <div><small>支出</small><b>{{ moneyWithCurrency(weeklyFinance.expenseTotal, ledgerCurrency) }}</b></div>
            <div><small>收入</small><b>{{ moneyWithCurrency(weeklyFinance.incomeTotal, ledgerCurrency) }}</b></div>
            <div><small>结余</small><b :class="{ negative: weeklyFinance.incomeTotal - weeklyFinance.expenseTotal < 0 }">{{ moneyWithCurrency(weeklyFinance.incomeTotal - weeklyFinance.expenseTotal, ledgerCurrency) }}</b></div>
          </div>
          <p class="week-finance-note">{{ weeklyFinance.count }} 笔收支记录 · {{ weeklyFinanceNote }}<template v-if="weeklyBills.due || weeklyBills.paid"> · 固定账单已付 {{ weeklyBills.paid }} 笔（{{ moneyWithCurrency(weeklyBillFinance.expenseTotal, ledgerCurrency) }}；{{ weeklyBillFinanceNote }}），本周应付 {{ weeklyBills.due }} 项</template><template v-else> · 本周没有应付固定账单</template></p>
        </section>

        <details v-else-if="id === 'focus'" class="today-agenda-disclosure" :open="!compactHome || Boolean(focusRequest || activeFocus)"><summary>{{ activeFocus ? '返回正在进行的专注' : '开始一段专注' }}</summary><FocusPanel :request="focusRequest" @prepared="onFocusPrepared" /></details>
      </template>

      <HomeProductivityPanel v-if="!focusRequest" />

      <div ref="socialCalendarAnchor" class="social-calendar-anchor">
        <SocialCalendarEvents v-if="canShowSocialCalendar && shouldLoadSocialCalendar" scope="today" />
      </div>

      <section v-if="unscheduledCount" class="compact-link-row"><span>待安排 <b>{{ unscheduledCount }}</b></span><small>还没有日期的事项</small><router-link to="/tasks">去安排</router-link></section>

      <section v-if="appearance.showMood" class="today-mood-lower mood-strip" aria-label="今日心情">
        <div class="mood-toolbar">
          <span class="mood-label">今天感觉怎么样？</span>
          <div class="mood-options" role="radiogroup" aria-label="选择今日心情" @keydown="moveMood">
            <button
              v-for="(mood, index) in MOOD_OPTIONS"
              :key="mood"
              type="button"
              class="mood-btn"
              :class="{ on: todayMood?.mood === mood }"
              :aria-checked="todayMood?.mood === mood"
              role="radio"
              :tabindex="todayMood?.mood === mood || (!todayMood && index === 0) ? 0 : -1"
              :aria-label="`记录心情 ${mood}`"
              @click="chooseMood(mood)"
            >{{ mood }}</button>
          </div>
          <input v-if="todayMood" v-model="moodNote" class="mood-note" maxlength="80" placeholder="留一句话（可选）" aria-label="今日心情备注" @change="updateMoodNote" />
          <span v-if="todayMood" class="mood-hint">已记录</span>
        </div>
      </section>

    </template>

    <MemoryView :open="showMemory" @close="showMemory = false" />
    <Modal v-if="eventDetail" :open="Boolean(eventDetail)" title="日程详情" medium @close="eventDetail = null">
      <div class="event-detail" :data-focus-id="eventDetail.id"><h3>{{ eventDetail.title }}</h3><p>{{ eventDetail.date || '待安排' }}<template v-if="eventDetail.time"> · {{ eventDetail.time }}</template><template v-if="eventDetail.endTime">–{{ eventDetail.endTime }}</template></p><p v-if="eventDetail.location">地点：{{ eventDetail.location }}</p><p v-if="eventDetail.courseName">课程：{{ eventDetail.courseName }}</p><p v-if="eventDetail.note" class="event-detail-note">{{ eventDetail.note }}</p><router-link class="btn btn-primary" :to="focusLocation('/events', eventDetail.id)" @click="eventDetail = null">管理这条日程</router-link></div>
    </Modal>
  </div>
  </div>
</template>

<style scoped src="./TodayView.css"></style>
