<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import { festiveConfig, moodLog } from '../composables/atmosphereStore.js'
import { festiveFor } from '../composables/festive.js'
import { narrativeFor, narrativeLang } from '../composables/narrative.js'
import MemoryView from '../components/MemoryView.vue'
import FocusPanel from '../components/FocusPanel.vue'
import InboxPanel from '../components/InboxPanel.vue'
import SocialCalendarEvents from '../components/SocialCalendarEvents.vue'
import Modal from '../components/Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { useQuickRecordAdapters } from '../composables/quickRecord/adapters.js'
import { selectTodayActionPanels, reminderAction } from '../composables/domain/selectors.js'
import { selectWeeklyBillSummary, weekRange } from '../composables/domain/weeklySelectors.js'
import { normalizeLedgerFx, summarizeLedgerInBase, useLedgerFx } from '../composables/ledgerFx.js'
import { mySpendYuan } from '../composables/ledgerSplit.js'
import { moneyWithCurrency } from '../utils/formatters.js'
import { isArchived, isBillDueSoon, isTaskActionable, taskPlanningState, taskStatus } from '../composables/domain/state.js'
import { weeklyPulse } from '../composables/experience.js'
import { schedulePolicy } from '../composables/settingsPolicy.js'
import { addAppDays, appCalendarDaysBetween, appNow, appToday, currentDayIndex, currentWeek, getAppTime, formatAppDate } from '../composables/timeContext.js'
import { selectHomeNextUp } from '../composables/home/nextUp.js'
import { MOOD_OPTIONS, logMood, moodOf } from '../composables/mood.js'
import { focusLocation } from '../composables/focusNavigation.js'
import { clearFocusFromRoute, focusElementWhenReady, readFocusQuery } from '../composables/focusNavigation.js'
import { recordStartupTiming, reportStartupAssetSummary, startupNow } from '../composables/startupDiagnostics.js'

const HomeProductivityPanel = defineAsyncComponent(() => import('../components/HomeProductivityPanel.vue'))
const domain = useDomainCommands()
const { courses, tasks, milestones: exams, bills, transactions, events, notes: quickNotes } = domain
const { fx: ledgerFx } = useLedgerFx()
const router = useRouter()
const route = useRoute()
const focusSessions = useStoredRef('sl_focus_sessions', [])
const eventDetail = ref(null)
const focusMessage = ref('')
let focusHandled = ''
const showInbox = ref(false)
const quickRecord = useQuickRecordAdapters()
const now = appNow
const todayKey = () => appToday.value
const activeSchedule = computed(() => schedulePolicy())
// 首页模块按用户在个性化里拖拽后的顺序渲染；只保留可见且仍合法的模块 id。
const visibleHomeModuleIds = computed(() =>
  appearance.value.homeModules
    .filter((module) => module.visible !== false)
    .map((module) => module.id)
    .filter((id) => HOME_MODULES.some((item) => item.id === id))
)

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
   范围与边界见 composables/narrative.js 的文件头说明。 */
const festiveToday = computed(() => festiveFor(appToday.value, festiveConfig.value))
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
}))
const nextUp = computed(() => nextProjection.value.nextUp)
const nextUpTimeRange = computed(() => nextProjection.value.nextUpTimeRange)
const nextDeparture = computed(() => nextProjection.value.nextDeparture)
const nextTimingLabel = computed(() => nextProjection.value.nextTimingLabel)

const pulse = computed(() => weeklyPulse({ tasks: tasks.value, focusSessions: focusSessions.value, moodLog: moodLog.value }, now.value))
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
const inboxNotes = computed(() => quickNotes.value.filter((note) => note.inboxStatus !== 'organized' && note.inboxStatus !== 'archived' && !isArchived(note)))
const inboxCount = computed(() => inboxNotes.value.length)

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
  if (item.sourceType === 'bill') return `${dayLabel(item.entity.nextDate)} · ¥${Number(item.entity.amount || 0).toFixed(2)}`
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
  const day = dayLabel(item.date)
  if (item.kind === 'course') return `${day} ${nextUpTimeRange.value}${item.entity.room ? ` · ${item.entity.room}` : ''}`
  if (item.kind === 'bill') return `${day} · ¥${Number(item.entity.amount || 0).toFixed(2)}`
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
  <div class="page today-page">
    <header class="page-head">
      <div class="head-copy">
        <h1 class="greeting">{{ greeting() }}<template v-if="currentQuote">，{{ currentQuote }}</template></h1>
        <p class="page-desc">{{ dateText }} · 第 {{ weekNum }} 周 · {{ campusName(activeSchedule.campusId) }} · {{ seasonName(activeSchedule.seasonId) }}</p>
        <!-- 节日叙事：只有当天真的有节日/纪念日时才出现，平时不占位置、不进 Tab 序。 -->
        <p v-if="festiveNarrative" class="festive-narrative">{{ festiveNarrative.name }} · {{ festiveNarrative.message }}</p>
      </div>
      <div class="head-actions"><button type="button" class="btn btn-ghost replay-btn" @click="showMemory = true">↺ 回放</button></div>
    </header>

    <template v-if="entryReady">
      <p v-if="experienceMessage" class="experience-message" role="status">✓ {{ experienceMessage }}</p>
      <p v-if="focusMessage" class="experience-message" role="status">{{ focusMessage }}</p>
      <HomeProductivityPanel />

      <template v-for="id in visibleHomeModuleIds" :key="id">
        <section v-if="id === 'next'" class="next-panel" :class="nextUp.kind" aria-label="接下来">
          <div class="next-main">
            <span class="next-label">接下来</span>
            <template v-if="nextUp.kind !== 'none'">
              <strong class="next-title">{{ nextTitle(nextUp) }}</strong>
              <span class="next-meta">{{ nextMeta(nextUp) }}<template v-if="nextUp.kind === 'course' && nextDeparture"> · {{ nextDeparture }}</template></span>
              <span v-if="nextUp.state === 'live'" class="next-state live">▶ {{ nextTimingLabel }}</span>
              <span v-else-if="nextTimingLabel" class="next-state">{{ nextTimingLabel }}</span>
            </template>
            <template v-else><span class="next-empty-line">今天暂时没有紧接着要处理的事项。</span><strong class="next-title is-muted">可以自由安排时间</strong></template>
          </div>
          <button v-if="nextUp.kind !== 'none'" type="button" class="next-action tap-target" @click="openNext">{{ nextUp.kind === 'course' ? '查看课程表' : '查看' }} →</button>
        </section>

        <template v-else-if="id === 'tasks'">
          <section v-if="actionItems.length" class="action-panel" aria-label="现在该做">
            <div class="panel-head"><div><h2>今天最重要</h2><span class="panel-subtitle">最多 3 件，完成后会消失</span></div><router-link to="/tasks" class="panel-link">查看待办 →</router-link></div>
            <div class="action-list">
              <div v-for="item in actionItems" :key="item.key" class="action-row">
                <span class="action-mark">○</span><div class="action-copy"><b>{{ item.title }}</b><span>{{ reminderMeta(item) }}</span></div>
                <button type="button" class="reminder-action tap-target" @click="completeReminder(item)">{{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }}</button>
              </div>
            </div>
          </section>
          <p v-else-if="!riskItems.length" class="quiet-empty">今天暂时没有需要马上处理的事项。</p>
        </template>

        <section v-else-if="id === 'countdowns' && riskItems.length" class="action-panel risk-panel" aria-label="需要注意">
          <div class="panel-head"><div><h2>需要注意</h2><span class="panel-subtitle">逾期、临近截止和即将到期</span></div></div>
          <div class="action-list">
            <div v-for="item in riskItems" :key="item.key" class="action-row risk-row">
              <span class="action-mark">⚠</span><div class="action-copy"><b>{{ item.title }}</b><span>{{ reminderMeta(item) }}</span></div>
              <button type="button" class="reminder-action tap-target" @click="completeReminder(item)">{{ reminderAction(item).action === 'complete' ? '完成' : reminderAction(item).action === 'pay' ? '已支付' : '查看' }}</button>
            </div>
          </div>
        </section>

        <section v-else-if="id === 'week'" class="week-progress panel" aria-label="本周进展">
          <div class="panel-head"><div><h2>本周进展</h2><span class="panel-subtitle">{{ pulse.suggestion }}</span></div><router-link class="panel-link" to="/review">查看回顾 →</router-link></div>
          <p>{{ pulse.done }} 项完成 · 专注 {{ pulse.minutes ? `${pulse.minutes} 分钟` : '暂无记录' }}<template v-if="inboxCount"> · 待整理 {{ inboxCount }} 条笔记</template></p>
        </section>

        <section v-else-if="id === 'finance'" class="week-finance panel" aria-label="本周收支">
          <div class="panel-head"><div><h2>本周收支</h2><span class="panel-subtitle">按本周账本记录汇总</span></div><router-link class="panel-link" to="/bills">打开账本 →</router-link></div>
          <div class="week-finance-stats">
            <div><small>支出</small><b>{{ moneyWithCurrency(weeklyFinance.expenseTotal, ledgerCurrency) }}</b></div>
            <div><small>收入</small><b>{{ moneyWithCurrency(weeklyFinance.incomeTotal, ledgerCurrency) }}</b></div>
            <div><small>结余</small><b :class="{ negative: weeklyFinance.incomeTotal - weeklyFinance.expenseTotal < 0 }">{{ moneyWithCurrency(weeklyFinance.incomeTotal - weeklyFinance.expenseTotal, ledgerCurrency) }}</b></div>
          </div>
          <p class="week-finance-note">{{ weeklyFinance.count }} 笔收支记录 · {{ weeklyFinanceNote }}<template v-if="weeklyBills.due || weeklyBills.paid"> · 固定账单已付 {{ weeklyBills.paid }} 笔（{{ moneyWithCurrency(weeklyBillFinance.expenseTotal, ledgerCurrency) }}；{{ weeklyBillFinanceNote }}），本周应付 {{ weeklyBills.due }} 项</template><template v-else> · 本周没有应付固定账单</template></p>
        </section>

        <FocusPanel v-else-if="id === 'focus'" />
      </template>

      <SocialCalendarEvents scope="today" />

      <section v-if="unscheduledCount" class="compact-link-row"><span>待安排 <b>{{ unscheduledCount }}</b></span><small>还没有日期的事项</small><router-link to="/tasks">去安排 →</router-link></section>

      <section class="today-mood-lower mood-strip" aria-label="今日心情">
        <div class="mood-toolbar">
          <span class="mood-label">今天感觉怎么样？</span>
          <div class="mood-options" role="radiogroup" aria-label="选择今日心情">
            <button
              v-for="mood in MOOD_OPTIONS"
              :key="mood"
              type="button"
              class="mood-btn"
              :class="{ on: todayMood?.mood === mood }"
              :aria-checked="todayMood?.mood === mood"
              role="radio"
              :aria-label="`记录心情 ${mood}`"
              @click="chooseMood(mood)"
            >{{ mood }}</button>
          </div>
          <input v-model="moodNote" class="mood-note" maxlength="80" placeholder="可选短备注" aria-label="今日心情备注" @change="updateMoodNote" />
          <span v-if="todayMood" class="mood-hint">已记录</span>
        </div>
      </section>

      <section v-if="inboxCount" class="inbox-entry">
        <button type="button" class="compact-link-row compact-button" :aria-expanded="showInbox" @click="showInbox = !showInbox"><span>收件箱 <b>待整理 {{ inboxCount }}</b></span><small>保存的内容都在这里</small><span class="compact-action">{{ showInbox ? '收起 ↑' : '查看 →' }}</span></button>
        <InboxPanel v-if="showInbox" :notes="inboxNotes" @convert="organizeInbox" @archive="archiveInbox" />
      </section>
    </template>

    <MemoryView :open="showMemory" @close="showMemory = false" />
    <Modal v-if="eventDetail" :open="Boolean(eventDetail)" title="日程详情" medium @close="eventDetail = null">
      <div class="event-detail" :data-focus-id="eventDetail.id"><h3>{{ eventDetail.title }}</h3><p>{{ eventDetail.date || '待安排' }}<template v-if="eventDetail.time"> · {{ eventDetail.time }}</template><template v-if="eventDetail.endTime">–{{ eventDetail.endTime }}</template></p><p v-if="eventDetail.location">地点：{{ eventDetail.location }}</p><p v-if="eventDetail.courseName">课程：{{ eventDetail.courseName }}</p><p v-if="eventDetail.note" class="event-detail-note">{{ eventDetail.note }}</p></div>
    </Modal>
  </div>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
/* 第三十九轮（TodayView 分片）：这里原先还有 66 条规则体 / 72 个选择器引用 **FocusPanel.vue /
   MemoryView.vue / InboxPanel.vue 内部节点** 上的类，已按 tests/scopedChildReachability.test.js 的
   判据清除（三对命中数 46 / 14 / 12 → 0 / 0 / 0）。它们分三组：
     MemoryView  .memory/.memory-bar/.memory-actions/.memory-message/.story/.story-title/
                 .story-stats/.stat-cell/.story-list（11 个选择器）
     FocusPanel  .focus-flash/.focus-active,.focus-rest,.focus-completed,.focus-idle/.focus-goal-label/
                 .focus-goal-row/.goal-input/.pick-todo-btn,.unlink-btn/.recent-row/.recent-chip/
                 .focus-clock/.focus-target/.focus-type-tag/.focus-state-line/.focus-actions/
                 .time-chips/.time-chip/.start-btn/.link-hint/.focus-done-mark/.focus-done-time/
                 .focus-done-actions/.focus-done-hint/.focus-rest-row/.rest-btn/.todo-picker/
                 .todo-option/.empty-line/.custom-time/.custom-hint,.early-hint/.custom-error/
                 .modal-actions（46 个选择器）
     InboxPanel  .inbox-row/.inbox-tags/.inbox-empty/.inbox-actions/.inbox-toggle（12 个选择器）
   根因同 App.vue 那一批：第三十七轮把入口分片的编译产物搬回宿主文件时带上了 TodayView 的作用域
   属性，而 Vue 的 scoped CSS 只会把父作用域属性落在子组件的**根节点**上——「TodayView 的作用域 +
   只存在于子组件内部节点的类」永远匹配不到元素。删除前后用 @vue/compiler-sfc 编译成 CSS 文本
   逐条 diff 过：消失的正好是上面这些选择器，新增 0 条、改动 0 条。这些样式在三个子组件自己的
   scoped 样式块里都有等价副本，需要改请改那边。
   随之清空的三处 @media (max-width:520px)（原只含 .memory*、.focus-actions .btn、.inbox-row）
   整块删除；.todo-picker 规则体里的 vh/dvh 孪生注释随规则一起消失（FocusPanel.vue 里仍有那条
   规则与孪生，全仓 dvh 计数不受影响）。
   **故意保留**：`.task-*` / `.bill-*` / `.add-btn` / `.secondary-panel` 等规则不属本轮——它们引用的组件
   （TaskCenter 等）TodayView 并没有 import，不在上面三个配对里。 */
.focus-panel {
  grid-template-columns:minmax(0,1fr);
  gap:10px;
  display:grid}

/* 字号 clamp(30px,3vw,38px) 的最小值是 30px —— 这是**可证明的大字下界**（≥24px），
   所以对比度只需按 3:1 判；scripts/audit-contrast.mjs 的 largeTextThreshold 认这个下界。
   不要把 clamp 改成 min()：min 的值只会更小，下界就不再成立。 */
/* ↑ 这条 clamp 注释描述的是**已删除**的 .focus-clock 规则（它引用的类只在 FocusPanel.vue 的
   内部节点上，编译后永远匹配不到元素）；注释本身留着不改（注释棘轮只准多），等价样式在
   components/FocusPanel.vue 自己的 scoped 样式块里。 */
.page {
  flex-direction:column;
  gap:16px;
  display:flex}
.page-head {
  justify-content:space-between;
  align-items:center;
  gap:14px;
  display:flex}
/* 节日叙事（节日名 · 祝福语）。与 .page-desc 同一行距节奏，但用主色以便一眼看见。 */
.festive-narrative {
  color:var(--primary);
  margin-top:4px;
  font-size:var(--fs-12-5)}
.greeting {
  letter-spacing:-.01em;
  font-size:max(19px,min(2.2vw,24px))}
.page-desc {
  color:var(--ink-soft);
  margin-top:5px;
  font-size:var(--fs-12-5)}

.head-actions {
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  display:flex}
.replay-btn {
  white-space:nowrap;
  flex:none;
  min-height:40px;
  padding:9px 13px;
  font-size:var(--fs-13)}
.mood-strip {
  border:1px solid var(--border);
  border-radius:var(--card-radius);
  background:var(--card);
  flex-wrap:wrap;
  align-items:center;
  gap:10px;
  padding:12px 16px;
  display:flex}
.mood-label {
  color:var(--ink-soft);
  white-space:nowrap;
  font-size:var(--fs-12-5);
  font-weight:var(--fw-700)}
.mood-options {
  flex-wrap:wrap;
  gap:4px;
  display:flex}
.mood-btn {
  width:40px;
  height:40px;
  transition:background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
  background:0 0;
  border:1px solid #0000;
  border-radius:var(--radius-10);
  place-items:center;
  font-size:var(--fs-20);
  display:grid}
.mood-btn:hover {
  background:var(--bg-tint)}
.mood-btn.on {
  border-color:var(--primary);
  background:var(--primary-soft);
  transform:scale(1.05)}
.mood-note {
  flex:1;
  min-width:160px;
  padding:8px 10px}
.mood-hint {
  color:var(--ink-faint);
  font-size:var(--fs-12)}

.next-panel {
  border-radius:var(--card-radius);
  background:linear-gradient(120deg, var(--primary-soft), var(--card) 72%);
  box-shadow:var(--shadow-sm);
  border:1px solid #c9d4fb;
  justify-content:space-between;
  align-items:center;
  gap:14px;
  padding:18px 22px;
  display:flex}
.next-main {
  flex-direction:column;
  gap:4px;
  min-width:0;
  display:flex}
.next-label {
  color:var(--primary);
  letter-spacing:.14em;
  font-size:var(--fs-10-5);
  font-weight:var(--fw-850)}
.next-title {
  letter-spacing:-.01em;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:max(16px,min(2vw,20px));
  overflow:hidden}
.next-meta {
  color:var(--ink-soft);
  font-size:var(--fs-12-5)}
.next-empty-line {
  color:var(--ink-soft);
  font-size:var(--fs-12);
  font-weight:var(--fw-600)}
.next-title.is-muted {
  color:var(--ink-soft);
  font-size:var(--fs-15);
  font-weight:var(--fw-650)}
.next-state {
  color:var(--primary);
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius-pill);
  align-self:flex-start;
  padding:4px 9px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-750)}
.next-state.live {
  color:#fff;
  /* 渐变的最浅一档必须让白字达 AA：原来 #456fe8 只有 4.48:1（11.5px/750 属正文，
     门槛 4.5），差 0.02。三个通道各降一点到 #446de8 → 4.57:1，肉眼看不出来。
     审计脚本里的 background-image 判据（§1.54）会守住这一条。 */
  background:linear-gradient(135deg,#446de8,#7855dc);
  border-color:#0000}
.next-action {
  color:var(--primary);
  white-space:nowrap;
  flex:none;
  font-size:var(--fs-12-5);
  font-weight:var(--fw-750);
  text-decoration:none}
.next-action:hover {
  text-decoration:underline}

.panel {
  border:1px solid var(--border);
  border-radius:var(--card-radius);
  background:var(--card);
  min-width:0;
  padding:18px}
.panel-head {
  justify-content:space-between;
  align-items:baseline;
  gap:10px;
  margin-bottom:10px;
  display:flex}
.panel-head h2 {
  font-size:var(--fs-15-5)}
.panel-link {
  color:var(--primary);
  white-space:nowrap;
  font-size:var(--fs-12);
  font-weight:var(--fw-700);
  text-decoration:none}
.panel-link:hover {
  text-decoration:underline}
.experience-message {
  color:var(--primary);
  border:1px solid color-mix(in srgb, var(--primary) 28%, var(--border));
  background:color-mix(in srgb, var(--primary) 10%, var(--card));
  border-radius:var(--radius-9);
  padding:8px 12px;
  font-size:var(--fs-12-5)}
.action-panel {
  border:1px solid var(--border);
  border-radius:var(--card-radius);
  background:var(--card);
  padding:16px 18px}
.risk-panel {
  border-color:color-mix(in srgb, var(--danger) 28%, var(--border));
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.panel-head>div {
  min-width:0}
.panel-subtitle {
  color:var(--ink-faint);
  margin-top:3px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-500);
  display:block}
.action-list {
  flex-direction:column;
  display:flex}
.action-row {
  border-top:1px solid var(--border);
  align-items:center;
  gap:10px;
  min-height:48px;
  display:flex}
.action-row:first-child {
  border-top:0}
.action-mark {
  width:24px;
  height:24px;
  color:var(--primary);
  flex:0 0 24px;
  place-items:center;
  font-size:var(--fs-17);
  display:grid}
.risk-row .action-mark,.risk-row .action-copy span {
  color:var(--danger)}
.action-copy {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.action-copy b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-13-5);
  overflow:hidden}
.action-copy span {
  color:var(--ink-soft);
  font-size:var(--fs-11-5)}
.quiet-empty {
  color:var(--ink-soft);
  border:1px dashed var(--border-strong);
  border-radius:var(--card-radius);
  background:var(--bg-tint);
  padding:14px 16px;
  font-size:var(--fs-13)}
.compact-link-row {
  min-height:42px;
  color:var(--text);
  align-items:center;
  gap:9px;
  padding:0 4px;
  font-size:var(--fs-13);
  display:flex}
.compact-link-row>span {
  font-weight:var(--fw-750)}
.compact-link-row>span b {
  color:var(--primary)}
.compact-link-row small {
  color:var(--ink-faint);
  font-size:var(--fs-11-5)}
.compact-link-row a {
  color:var(--primary);
  white-space:nowrap;
  margin-left:auto;
  font-size:var(--fs-12);
  font-weight:var(--fw-750);
  text-decoration:none}
.compact-button {
  text-align:left;
  cursor:pointer;
  background:0 0;
  border:0;
  width:100%}
.compact-action {
  color:var(--primary);
  white-space:nowrap;
  margin-left:auto;
  font-size:var(--fs-12);
  font-weight:var(--fw-750)}
.inbox-entry {
  flex-direction:column;
  gap:7px;
  display:flex}
.inbox-entry>.inbox {
  margin:0}
.week-progress {
  padding:16px 18px}
.week-progress p {
  color:var(--ink-soft);
  font-size:var(--fs-12)}
.week-finance-stats {
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
  display:grid}
.week-finance-stats>div {
  background:var(--bg-tint);
  border-radius:var(--radius-8);
  flex-direction:column;
  gap:4px;
  min-width:0;
  padding:10px;
  display:flex}
.week-finance-stats small {
  color:var(--ink-faint);
  font-size:var(--fs-10-5)}
.week-finance-stats b {
  overflow:hidden;
  font-size:var(--fs-12-5);
  font-variant-numeric:tabular-nums;
  text-overflow:ellipsis;
  white-space:nowrap}
.week-finance-stats b.negative { color:var(--danger); }
.week-finance-note { color:var(--ink-soft); margin-top:8px; font-size:var(--fs-11-5); }
.today-mood-lower {
  padding:3px 4px}
.mood-toolbar {
  align-items:center;
  gap:9px;
  width:100%;
  min-width:0;
  display:flex}
.today-mood-lower .mood-options {
  scrollbar-width:none;
  flex-wrap:nowrap;
  flex:auto;
  gap:2px;
  min-width:0;
  display:flex;
  overflow-x:auto}
.today-mood-lower .mood-options::-webkit-scrollbar {
  display:none}
.today-mood-lower .mood-btn {
  flex:0 0 32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
.today-mood-lower .mood-note {
  flex:160px;
  min-width:140px;
  max-width:320px;
  padding:7px 9px}

.event-detail {
  flex-direction:column;
  gap:8px;
  display:flex}
.event-detail h3 {
  font-size:var(--fs-18)}
.event-detail p {
  color:var(--ink-soft);
  margin:0;
  font-size:var(--fs-13)}
.event-detail .event-detail-note {
  color:var(--text);
  white-space:pre-wrap;
  border-top:1px solid var(--border);
  padding-top:8px}
.task-list {
  flex-direction:column;
  display:flex}
.task-row {
  border-top:1px solid var(--border);
  align-items:center;
  gap:11px;
  min-height:52px;
  display:flex}
.task-row:first-child {
  border-top:0}
.task-check {
  color:#0000;
  border:1.5px solid var(--border);
  background:var(--bg);
  cursor:pointer;
  width:26px;
  height:26px;
  transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
  border-radius:var(--radius-8);
  flex:0 0 26px;
  place-items:center;
  font-size:var(--fs-13);
  font-weight:var(--fw-900);
  display:grid}
.task-check:hover {
  border-color:var(--primary);
  background:var(--primary-soft)}
.task-row.overdue .task-check {
  border-color:var(--danger);
  background:color-mix(in srgb, var(--danger) 8%, var(--card))}
.task-copy {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.task-copy b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-13-5);
  overflow:hidden}
.task-copy span {
  color:var(--ink-soft);
  font-size:var(--fs-11-5)}
.task-copy span.danger {
  color:var(--danger);
  font-weight:var(--fw-650)}
.task-priority {
  color:var(--danger);
  flex:none;
  font-size:var(--fs-11);
  font-style:normal;
  font-weight:var(--fw-800)}


















.reminder-action {
  color:var(--primary);
  background:var(--primary-soft);
  border:0;
  border-radius:var(--radius-6);
  flex:none;
  padding:4px 7px;
  font-size:var(--fs-11);
  font-weight:var(--fw-750);
  text-decoration:none}
.bill-list {
  flex-direction:column;
  display:flex}
.bill-row {
  min-height:44px;
  color:inherit;
  border-top:1px solid var(--border);
  justify-content:space-between;
  align-items:center;
  gap:10px;
  font-size:var(--fs-13);
  text-decoration:none;
  display:flex}
.bill-row:first-child {
  border-top:0}
.bill-row:hover b {
  color:var(--primary)}
.bill-row span {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  flex:none;
  font-size:var(--fs-12)}









@media (max-width:760px) {
  


.next-panel {
  padding:16px 18px}
.next-action {
  display:block}
}
@media (max-width:520px) {
  .page {
  gap:12px}
.page-head {
  flex-direction:column;
  align-items:flex-start}
.add-btn {
  text-align:center;
  width:100%}
.panel {
  padding:15px 14px}
.task-row {
  min-height:56px}

.secondary-panel {
  margin-top:2px}
.action-panel {
  padding:14px}
.action-row {
  min-height:52px}
.compact-link-row {
  flex-wrap:wrap;
  gap:5px 8px;
  padding-block-start:4px;
  padding-block-end:4px}
.compact-link-row small {
  flex:1 0 100%;
  padding-left:2px}
.compact-link-row a {
  margin-left:auto}
.mood-toolbar {
  grid-template-rows:auto auto auto;
  grid-template-columns:minmax(0,1fr) auto;
  gap:7px 8px;
  display:grid}
.today-mood-lower .mood-label {
  grid-area:1/1;
  align-self:center}

.today-mood-lower .mood-options {
  grid-area:2/1/auto/-1;
  width:100%;
  padding-bottom:1px}
.today-mood-lower .mood-note {
  grid-area:3/1/auto/-1;
  width:100%;
  max-width:none}
}

@media (min-width:901px) {
  .today-page {
  grid-template-columns:repeat(2,minmax(0,1fr));
  align-items:start;
  gap:16px 18px;
  display:grid}
.today-page>.page-head,.today-page>.experience-message,.today-page>.home-productivity,.today-page>.next-panel,.today-page>.compact-link-row,.today-page>.today-mood-lower,.today-page>.inbox-entry {
  grid-column:1/-1}
.today-page>.home-productivity {
  grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));
  margin:0}
}

</style>
