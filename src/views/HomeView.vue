<script setup>
import { computed } from 'vue'
import {
  useStoredRef,
  todayIndex,
  dayName,
  fmtCountdownDate,
  sortCountdowns,
  timeConfig,
  courseTimeRange,
  campusName,
  seasonName,
  currentCampusId,
  currentSeasonId,
  weekOf,
  periodLabelById,
  periodIndex,
  MAX_WEEK,
  todayStr,
  currentTimes,
  clock,
  coursesForDate,
} from '../composables/store.js'
import heroArt from '../assets/hero.png'
import { appearance, homeModuleState } from '../composables/appearance.js'

const courses = useStoredRef('sl_courses', [])
const exams = useStoredRef('sl_exams', [])
const tasks = useStoredRef('sl_tasks', [])
const bills = useStoredRef('sl_bills', [])
const sessionQuoteIndex = Math.floor(Math.random() * Math.max(1, appearance.value.quotes.length))

const now = computed(() => clock.value)
const dateText = computed(
  () =>
    `${now.value.getFullYear()}年${now.value.getMonth() + 1}月${now.value.getDate()}日 ${dayName(todayIndex())}`
)
const weekNum = Math.min(Math.max(weekOf(todayStr()), 1), MAX_WEEK)

function greeting() {
  const h = now.value.getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

const todayCourses = computed(() =>
  coursesForDate(courses.value, todayStr())
    .sort((a, b) => periodIndex(a.start) - periodIndex(b.start))
)

const upcomingExams = computed(() =>
  sortCountdowns(exams.value, now.value).filter((item) => !item.countdown.isPast)
)

const previewExams = computed(() => upcomingExams.value.slice(0, 3))
const pendingTasks = computed(() => tasks.value.filter((task) => !task.done))

// ---------- 玩家等级系统：每完成 1 项待办 +20 EXP，满 100 EXP 升级 ----------
const EXP_PER_TASK = 20

const totalDone = computed(() => tasks.value.filter((task) => task.done).length)
const playerLevel = computed(() => Math.floor((totalDone.value * EXP_PER_TASK) / 100) + 1)
const expPercent = computed(() => (totalDone.value * EXP_PER_TASK) % 100)
const expToNext = computed(() => Math.max(1, Math.ceil((100 - expPercent.value) / EXP_PER_TASK)))

const LEVEL_TITLES = [
  [1, '新手冒险者'],
  [3, '见习学者'],
  [5, '时间术士'],
  [7, '学霸骑士'],
  [9, '传说大师'],
]
const levelTitle = computed(() => {
  let title = LEVEL_TITLES[0][1]
  for (const [lv, name] of LEVEL_TITLES) {
    if (playerLevel.value >= lv) title = name
  }
  return title
})

function isSameDay(iso, d) {
  if (!iso) return false
  const t = new Date(iso)
  return (
    t.getFullYear() === d.getFullYear() &&
    t.getMonth() === d.getMonth() &&
    t.getDate() === d.getDate()
  )
}

const todayProgress = computed(() => {
  const d = now.value
  const doneToday = tasks.value.filter(
    (task) => task.done && isSameDay(task.completedAt, d)
  ).length
  const pending = pendingTasks.value.length
  const total = doneToday + pending
  return {
    doneToday,
    pending,
    total,
    percent: total ? Math.round((doneToday / total) * 100) : 100,
  }
})

function minutesOf(value) {
  if (!value) return null
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function dateFromOffset(offset) {
  const date = new Date(todayStr() + 'T00:00:00')
  date.setDate(date.getDate() + offset)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const nextUpcomingCourse = computed(() => {
  const currentMinutes = now.value.getHours() * 60 + now.value.getMinutes()
  return todayCourses.value.find((course) => {
    const start = minutesOf(currentTimes()[periodIndex(course.start)]?.start)
    return start !== null && start !== undefined && start > currentMinutes
  }) ?? null
})

const currentCourse = computed(() => todayCourses.value.find((course) => courseState(course) === 'live') ?? null)

const nextClassCard = computed(() => {
  if (!todayCourses.value.length) return { value: '今日没有课程', detail: '可以自由安排时间', state: 'free' }
  if (nextUpcomingCourse.value) {
    return {
      value: startTimeOf(nextUpcomingCourse.value),
      detail: nextUpcomingCourse.value.name,
      state: 'upcoming',
    }
  }
  if (currentCourse.value) {
    const end = currentTimes()[periodIndex(currentCourse.value.end)]?.end ?? ''
    return { value: '正在上课', detail: `${currentCourse.value.name}${end ? ` · ${end}结束` : ''}`, state: 'live' }
  }
  return { value: '今日课程已结束', detail: '今天的课程已经完成', state: 'done' }
})

const riskCard = computed(() => {
  const today = todayStr()
  const nowTime = now.value.getTime()
  const overdue = pendingTasks.value.filter((task) => task.dueDate && taskTimestamp(task) < nowTime).length
  const dueToday = pendingTasks.value.filter((task) => task.dueDate === today && taskTimestamp(task) >= nowTime).length
  const nearExams = upcomingExams.value.filter((item) => {
    const date = item.countdown.target
    if (!date) return false
    const days = Math.floor((date.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
    return days >= 0 && days <= 3
  }).length
  const nearBills = bills.value.filter((bill) => {
    if (bill.active === false || !bill.nextDate) return false
    const days = Math.round((new Date(bill.nextDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000)
    return days >= 0 && days <= 3
  }).length
  const total = overdue + dueToday + nearExams + nearBills
  const detail = [
    overdue ? `${overdue}项逾期` : '',
    dueToday ? `${dueToday}项今天截止` : '',
    nearExams ? `${nearExams}个近期事件` : '',
    nearBills ? `${nearBills}笔近期账单` : '',
  ].filter(Boolean).join(' · ')
  return {
    value: total ? `${total} 项` : '暂无风险',
    detail: detail || '目前没有紧急事项',
    urgent: total > 0,
  }
})

const weeklyPeak = computed(() => {
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = dateFromOffset(offset)
    const courseCount = coursesForDate(courses.value, date).length
    const taskCount = pendingTasks.value.filter((task) => task.dueDate === date).length
    const examCount = upcomingExams.value.filter((item) => {
      const target = item.countdown.target
      if (!target) return false
      const pad = (value) => String(value).padStart(2, '0')
      const targetDate = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`
      return targetDate === date
    }).length
    const billCount = bills.value.filter((bill) => bill.active !== false && bill.nextDate === date).length
    return { date, offset, courseCount, taskCount, examCount, billCount, total: courseCount + taskCount + examCount + billCount }
  })
  const peak = days.sort((a, b) => b.total - a.total || a.offset - b.offset)[0]
  if (!peak?.total) return { value: '本周较轻松', detail: '未来七天没有固定安排' }
  const date = new Date(peak.date + 'T00:00:00')
  const label = peak.offset === 0 ? '今天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
  const detail = [
    peak.courseCount ? `${peak.courseCount}节课` : '',
    peak.taskCount ? `${peak.taskCount}项截止` : '',
    peak.examCount ? `${peak.examCount}个事件` : '',
    peak.billCount ? `${peak.billCount}笔账单` : '',
  ].filter(Boolean).join(' · ')
  return { value: `${label}最忙`, detail }
})

function taskTimestamp(task) {
  if (!task.dueDate) return Infinity
  return new Date(`${task.dueDate}T${task.dueTime || '23:59'}`).getTime()
}

const nextTask = computed(() =>
  [...pendingTasks.value].sort((a, b) => taskTimestamp(a) - taskTimestamp(b))[0] ?? null
)

const nextBill = computed(() =>
  [...bills.value]
    .filter((bill) => bill.active !== false && bill.nextDate)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0] ?? null
)

function billBrief(bill) {
  if (!bill) return ''
  const amount = Number(bill.amount || 0).toFixed(2)
  return `¥${amount} · ${bill.nextDate.slice(5).replace('-', '月')}日`
}

function taskDeadline(task) {
  if (!task?.dueDate) return '未设置截止日期'
  const target = new Date(task.dueDate + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  const days = Math.round((target - today) / 86400000)
  if (days < 0) return `已逾期 ${-days} 天`
  if (days === 0) return task.dueTime ? `今天 ${task.dueTime}` : '今天截止'
  if (days === 1) return task.dueTime ? `明天 ${task.dueTime}` : '明天截止'
  return `${task.dueDate.slice(5).replace('-', '月')}日${task.dueTime ? ` ${task.dueTime}` : ''}`
}

function periodLabel(c) {
  const startLabel = periodLabelById(c.start)
  const endLabel = periodLabelById(c.end)
  const s = c.start === c.end ? startLabel : `${startLabel}至${endLabel}`
  const t = courseTimeRange(c)
  return t ? `${s} · ${t}` : s
}

// 课程的三态：live 进行中 / done 已结束 / upcoming 即将开始
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

function startTimeOf(c) {
  return currentTimes()[periodIndex(c.start)]?.start ?? ''
}

function countdownBadge(item) {
  const state = item.countdown
  if (state.text === '今天') return 'TODAY'
  if (state.label === '小时') return `${state.text}H`
  if (state.label === '分钟') return `${state.text}M`
  return `D-${state.text}`
}

const currentQuote = computed(() => {
  if (!appearance.value.showQuote) return '今天也要漂亮通关。'
  const quotes = appearance.value.quotes.length ? appearance.value.quotes : ['今天也要漂亮通关。']
  if (appearance.value.quoteMode === 'fixed') return quotes[appearance.value.fixedQuoteIndex] ?? quotes[0]
  if (appearance.value.quoteMode === 'random') return quotes[sessionQuoteIndex % quotes.length]
  const dateNumber = Number(todayStr().replace(/-/g, ''))
  return quotes[dateNumber % quotes.length]
})

function moduleVisible(id) {
  return homeModuleState(id).visible !== false
}

function moduleOrder(id) {
  return appearance.value.homeModules.findIndex((item) => item.id === id)
}
</script>

<template>
  <div class="page">
    <section v-if="moduleVisible('hero')" class="hero wide-module" :style="{ order: moduleOrder('hero') }">
      <div class="hero-copy">
        <p class="eyebrow">STUDY QUEST · WEEK {{ weekNum }}</p>
        <h1>{{ greeting() }}，<br />{{ currentQuote }}</h1>
        <p v-if="appearance.signature" class="hero-signature">— {{ appearance.signature }}</p>
        <p class="hero-date">{{ dateText }}</p>
        <div class="hero-meta">
          <span>📍 {{ campusName(currentCampusId()) }}</span>
          <span>◷ {{ seasonName(currentSeasonId()) }}<template v-if="timeConfig.autoSeason">（自动）</template></span>
        </div>
        <div class="xp-block">
          <div class="xp-head">
            <span class="lv-badge">LV.{{ playerLevel }}</span>
            <span class="lv-title">{{ levelTitle }}</span>
            <span class="xp-rest">再完成 {{ expToNext }} 项升级</span>
          </div>
          <div class="xp-bar">
            <div class="xp-fill" :style="{ width: expPercent + '%' }"></div>
          </div>
        </div>
      </div>

      <div class="hero-visual" aria-hidden="true">
        <div class="level-orbit"></div>
        <img :src="heroArt" alt="" />
        <div class="mission-core" :class="{ cleared: pendingTasks.length === 0 }">
          <div
            class="mission-ring"
            :style="{ '--p': todayProgress.percent }"
          >
            <div class="mission-number">
              <strong>{{ pendingTasks.length }}</strong>
              <span>项</span>
            </div>
          </div>
          <div class="mission-copy">
            <p>{{ pendingTasks.length === 0 ? '全部清空，完美通关！' : '今日通关进度' }}</p>
            <small>{{ todayProgress.doneToday }}/{{ todayProgress.total }} 已完成</small>
          </div>
        </div>
      </div>
    </section>

    <div v-if="moduleVisible('stats')" class="stats wide-module" :style="{ order: moduleOrder('stats') }">
      <div class="stat stat-blue" :class="{ urgent: riskCard.urgent }">
        <div class="stat-icon">!</div>
        <div>
          <span class="stat-label">当前风险</span>
          <span class="stat-num">{{ riskCard.value }}</span>
          <span class="stat-detail">{{ riskCard.detail }}</span>
        </div>
      </div>
      <div class="stat stat-violet" :class="`state-${nextClassCard.state}`">
        <div class="stat-icon">→</div>
        <div>
          <span class="stat-label">下一节课</span>
          <span class="stat-num">{{ nextClassCard.value }}</span>
          <span class="stat-detail">{{ nextClassCard.detail }}</span>
        </div>
      </div>
      <div class="stat stat-orange">
        <div class="stat-icon">7D</div>
        <div>
          <span class="stat-label">未来七天</span>
          <span class="stat-num">{{ weeklyPeak.value }}</span>
          <span class="stat-detail">{{ weeklyPeak.detail }}</span>
        </div>
      </div>
    </div>

    <section v-if="moduleVisible('focus')" class="focus-grid wide-module" :style="{ order: moduleOrder('focus') }" aria-label="近期重点">
      <router-link to="/bills" class="focus-card focus-bill">
        <span class="focus-icon">¥</span>
        <div class="focus-copy">
          <span class="focus-label">NEXT BILL · 最近账单</span>
          <template v-if="nextBill">
            <strong>{{ nextBill.name }}</strong>
            <small>{{ billBrief(nextBill) }}</small>
          </template>
          <template v-else>
            <strong>近期没有固定账单</strong>
            <small>可以添加订阅或生活缴费</small>
          </template>
        </div>
        <span class="focus-enter">›</span>
      </router-link>

      <router-link to="/tasks" class="focus-card focus-task">
        <span class="focus-icon">✓</span>
        <div class="focus-copy">
          <span class="focus-label">NEXT TASK · 最近待办</span>
          <template v-if="nextTask">
            <strong>{{ nextTask.title }}</strong>
            <small>{{ taskDeadline(nextTask) }}<template v-if="nextTask.course"> · {{ nextTask.course }}</template></small>
          </template>
          <template v-else>
            <strong>待办已经清空</strong>
            <small>目前没有未完成事项</small>
          </template>
        </div>
        <span class="focus-enter">›</span>
      </router-link>

      <router-link to="/exams" class="focus-card focus-countdown">
        <span class="focus-icon">◷</span>
        <div class="focus-copy">
          <span class="focus-label">COUNTDOWN · 最近倒计时</span>
          <template v-if="upcomingExams[0]">
            <strong>{{ upcomingExams[0].name }}</strong>
            <small>{{ fmtCountdownDate(upcomingExams[0], upcomingExams[0].countdown.target) }}</small>
          </template>
          <template v-else>
            <strong>暂无倒计时</strong>
            <small>可以添加考试或生活事件</small>
          </template>
        </div>
        <span class="focus-enter">›</span>
      </router-link>
    </section>

    <template>
      <section v-if="moduleVisible('courses')" class="panel mission-panel" :class="{ 'single-panel': !moduleVisible('countdowns') }" :style="{ order: moduleOrder('courses') }">
        <div class="panel-head">
          <div>
            <span class="panel-code">DAILY MISSION</span>
            <h2>今日课程</h2>
          </div>
          <span class="panel-count">{{ todayCourses.length }} 项</span>
        </div>
        <p v-if="todayCourses.length === 0" class="empty">
          <span class="empty-icon">✓</span>
          今日任务已清空，可以自由安排时间
        </p>
        <div v-else class="course-list">
          <div
            v-for="(c, index) in todayCourses"
            :key="c.id"
            class="course-item"
            :class="courseState(c)"
          >
            <span class="course-index" :style="{ color: c.color }">
              {{ String(index + 1).padStart(2, '0') }}
            </span>
            <span class="course-mark" :style="{ background: c.color }"></span>
            <div class="course-copy">
              <b>{{ c.name }}</b>
              <span>{{ periodLabel(c) }}</span>
            </div>
            <span v-if="c.room" class="room">{{ c.room }}</span>
            <span class="quest-state">
              <template v-if="courseState(c) === 'live'">▶ 进行中</template>
              <template v-else-if="courseState(c) === 'done'">✓ 已结束</template>
              <template v-else>{{ startTimeOf(c) }} 开始</template>
            </span>
          </div>
        </div>
      </section>

      <section v-if="moduleVisible('countdowns')" class="panel exam-panel" :class="{ 'single-panel': !moduleVisible('courses') }" :style="{ order: moduleOrder('countdowns') }">
        <div class="panel-head">
          <div>
            <span class="panel-code">COUNTDOWN</span>
            <h2>近期倒计时</h2>
          </div>
          <span class="panel-count">最近 {{ previewExams.length }} 项</span>
        </div>
        <p v-if="previewExams.length === 0" class="empty">
          <span class="empty-icon">✦</span>
          暂无即将到来的倒计时
        </p>
        <div v-else class="exam-list">
          <div v-for="e in previewExams" :key="e.id" class="exam-item">
            <div class="ei-info">
              <b>{{ e.name }}</b>
              <span>{{ fmtCountdownDate(e, e.countdown.target) }}</span>
            </div>
            <span class="badge" :class="{ urgent: e.countdown.days <= 7 }">
              {{ countdownBadge(e) }}
            </span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(320px, 0.82fr);
  gap: 20px;
}
.wide-module {
  grid-column: 1 / -1;
}
.hero {
  position: relative;
  min-height: 284px;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 30px;
  padding: 38px 44px;
  color: #fff;
  border: 1px solid rgba(145, 161, 255, 0.24);
  border-radius: 24px;
  background:
    radial-gradient(circle at 78% 32%, rgba(117, 90, 255, 0.36), transparent 27%),
    linear-gradient(130deg, #111a36 0%, #1a2050 54%, #26205d 100%);
  box-shadow: 0 20px 50px rgba(31, 35, 88, 0.2);
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.34;
  background-image:
    linear-gradient(rgba(132, 151, 255, 0.12) 1px, transparent 1px),
    linear-gradient(90deg, rgba(132, 151, 255, 0.12) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(90deg, #000, transparent 80%);
}
.hero-copy {
  position: relative;
  z-index: 2;
  max-width: 620px;
}
.eyebrow {
  margin-bottom: 16px;
  color: #aebcff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.18em;
}
.hero h1 {
  font-size: clamp(30px, 4vw, 46px);
  line-height: 1.18;
  letter-spacing: -0.04em;
}
.hero-date {
  margin-top: 14px;
  color: #cbd3f7;
  font-size: 14px;
}
.hero-signature {
  margin-top: 9px;
  color: #aebcff;
  font-size: 12px;
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}
.hero-meta span {
  padding: 7px 12px;
  color: #e3e8ff;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(174, 188, 255, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(8px);
}
.hero-visual {
  position: relative;
  z-index: 1;
  flex: 0 0 290px;
  height: 220px;
}
.hero-visual img {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 205px;
  transform: translate(-50%, -50%) rotate(-5deg);
  filter: drop-shadow(0 20px 22px rgba(7, 8, 30, 0.45));
  animation: hero-float 6s ease-in-out infinite;
}
@keyframes hero-float {
  0%,
  100% {
    transform: translate(-50%, -50%) rotate(-5deg);
  }
  50% {
    transform: translate(-50%, -56%) rotate(-3deg);
  }
}
.level-orbit {
  position: absolute;
  inset: 22px 40px;
  border: 1px solid rgba(143, 117, 255, 0.5);
  border-radius: 50%;
  transform: rotate(-18deg);
  box-shadow: 0 0 50px rgba(125, 92, 255, 0.25);
}
.level-orbit::after {
  content: '';
  position: absolute;
  top: 18px;
  right: 14px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #9f8cff;
  box-shadow: 0 0 18px #9f8cff;
  animation: orbit-pulse 2.4s ease-in-out infinite;
}
@keyframes orbit-pulse {
  50% {
    opacity: 0.35;
    transform: scale(0.7);
  }
}
.mission-core {
  position: absolute;
  z-index: 3;
  right: 0;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 196px;
  padding: 10px 16px 10px 10px;
  border: 1px solid rgba(185, 196, 255, 0.34);
  border-radius: 999px 14px 14px 999px;
  background: rgba(14, 19, 52, 0.72);
  backdrop-filter: blur(10px);
}
.mission-ring {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  flex: 0 0 54px;
  border-radius: 50%;
  background: conic-gradient(
    #9f8cff calc(var(--p) * 1%),
    rgba(255, 255, 255, 0.14) 0
  );
  box-shadow: 0 0 16px rgba(125, 92, 255, 0.28);
}
.mission-number {
  display: flex;
  align-items: baseline;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #141a40;
}
.mission-number strong {
  color: #fff;
  font-size: 19px;
  line-height: 42px;
}
.mission-number span {
  margin-left: 1px;
  color: #aebcff;
  font-size: 8px;
  font-weight: 700;
}
.mission-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mission-copy p {
  color: #dfe4ff;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.mission-copy small {
  color: #9aa6e8;
  font-size: 10px;
  white-space: nowrap;
}
.mission-core.cleared .mission-ring {
  background: conic-gradient(
    #3fd6a8 calc(var(--p) * 1%),
    rgba(255, 255, 255, 0.14) 0
  );
  box-shadow: 0 0 16px rgba(55, 210, 166, 0.25);
}
.mission-core.cleared p {
  color: #a8ead7;
}

/* ---------- 玩家等级 / 经验条 ---------- */
.xp-block {
  max-width: 430px;
  margin-top: 24px;
}
.xp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.lv-badge {
  padding: 4px 10px;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.04em;
  border-radius: 8px;
  background: linear-gradient(135deg, #ffb84d, #ff7a45);
  box-shadow: 0 4px 12px rgba(255, 150, 60, 0.35);
}
.lv-title {
  color: #e6ebff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
}
.xp-rest {
  margin-left: auto;
  color: #aebcff;
  font-size: 11px;
}
.xp-bar {
  position: relative;
  height: 10px;
  overflow: hidden;
  border: 1px solid rgba(174, 188, 255, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.xp-fill {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(90deg, #6ea8ff, #9f8cff, #c99cff);
  box-shadow: 0 0 12px rgba(140, 120, 255, 0.5);
  transition: width 0.6s ease;
}
.xp-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(255, 255, 255, 0.55) 50%,
    transparent 70%
  );
  animation: xp-shine 2.8s ease-in-out infinite;
}
@keyframes xp-shine {
  to {
    transform: translateX(220%);
  }
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.stat {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 104px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s, box-shadow 0.15s;
}
.stat:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.stat::after {
  content: '';
  position: absolute;
  width: 76px;
  height: 76px;
  right: -28px;
  bottom: -36px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.08;
}
.stat-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  color: currentColor;
  font-size: 12px;
  font-weight: 900;
  border: 1px solid currentColor;
  border-radius: 12px 4px 12px 4px;
  background: color-mix(in srgb, currentColor 9%, white);
}
.stat > div:nth-child(2) {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.stat-blue { color: #456fe8; }
.stat-violet { color: #7a55e8; }
.stat-orange { color: #ef7b45; }
.stat.urgent { color: var(--danger); border-color: #f3c2c2; }
.stat-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.stat-num {
  overflow: hidden;
  color: var(--text);
  font-size: clamp(19px, 2vw, 25px);
  font-weight: 900;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat-detail {
  overflow: hidden;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.focus-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 16px;
  color: var(--text);
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.focus-card:hover {
  transform: translateY(-2px);
  border-color: #cbd5f3;
  box-shadow: var(--shadow-md);
}
.focus-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: var(--primary);
  font-size: 16px;
  font-weight: 900;
  border-radius: 11px;
  background: var(--primary-soft);
}
.focus-task .focus-icon {
  color: #07805d;
  background: #e7f8f1;
}
.focus-countdown .focus-icon {
  color: #d85e27;
  background: #fff1e8;
}
.focus-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.focus-label {
  overflow: hidden;
  color: var(--muted);
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-copy strong {
  overflow: hidden;
  margin-top: 3px;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-copy small {
  overflow: hidden;
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-enter {
  color: #aab2c2;
  font-size: 20px;
}

.grid {
  display: contents;
}
.panel {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: #fff;
  box-shadow: var(--shadow-sm);
}
.panel.single-panel {
  grid-column: 1 / -1;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.panel-code {
  color: var(--primary);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.16em;
}
.exam-panel .panel-code {
  color: #ef7b45;
}
.panel h2 {
  margin-top: 2px;
  font-size: 18px;
}
.panel-count {
  padding: 5px 9px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  border-radius: 7px;
  background: var(--bg);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  padding: 30px 0;
  text-align: center;
  font-size: 14px;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  color: var(--primary);
  font-size: 18px;
  font-weight: 800;
  border: 1px solid #dbe3fa;
  border-radius: 10px;
  background: var(--primary-soft);
}
.course-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.course-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fafbfd;
  border: 1px solid #edf0f6;
  border-radius: 11px;
  padding: 11px 12px;
}
.course-index {
  width: 23px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
}
.course-mark {
  width: 4px;
  height: 34px;
  flex: 0 0 4px;
  border-radius: 999px;
}
.course-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.course-copy span,
.ei-info span {
  color: var(--muted);
  font-size: 12px;
}
.room {
  margin-left: auto;
  padding: 5px 8px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
  border-radius: 6px;
  background: #f0f2f7;
}
.quest-state {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 5px 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  border-radius: 6px;
  background: #f0f2f7;
}
.room + .quest-state {
  margin-left: 8px;
}
.course-item.live {
  border-color: #b9c6ff;
  background: #f4f7ff;
  box-shadow: inset 0 0 0 1px #b9c6ff, 0 4px 14px rgba(79, 124, 255, 0.14);
}
.course-item.live .quest-state {
  color: #fff;
  background: linear-gradient(135deg, #456fe8, #7855dc);
}
.course-item.done {
  opacity: 0.55;
}
.course-item.done .quest-state {
  color: #19a878;
  background: #e7f8f1;
}
.exam-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.exam-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #fafbfd;
  border: 1px solid #edf0f6;
  border-radius: 11px;
  padding: 12px;
}
.ei-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.badge {
  background: #fff1e8;
  color: #d85e27;
  font-weight: 900;
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  white-space: nowrap;
}
.badge.urgent {
  background: #fee2e2;
  color: var(--danger);
}

@media (max-width: 1100px) {
  .page {
    grid-template-columns: 1fr;
  }
  .wide-module {
    grid-column: 1;
  }
  .hero-visual {
    flex-basis: 240px;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .focus-grid {
    grid-template-columns: 1fr 1fr;
  }

  .focus-countdown {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .hero-visual img {
    animation: none;
    filter: none;
  }

  .level-orbit::after,
  .xp-fill::after {
    animation: none;
  }

  .hero-meta span,
  .mission-core {
    backdrop-filter: none;
  }

  .hero {
    min-height: 0;
    padding: 30px;
  }

  .hero-visual {
    position: absolute;
    right: -70px;
    width: 250px;
    opacity: 0.34;
  }

  .hero-copy {
    max-width: 520px;
  }

  .stats { grid-template-columns: repeat(3, minmax(230px, 1fr)); overflow-x: auto; padding-bottom: 3px; scroll-snap-type: x proximity; }

  .focus-grid {
    grid-template-columns: 1fr;
  }

  .focus-countdown {
    grid-column: auto;
  }

  .stat {
    min-height: 84px;
    scroll-snap-align: start;
  }
}

@media (max-width: 520px) {
  .page {
    gap: 14px;
  }

  .hero {
    padding: 26px 22px;
    border-radius: 18px;
  }

  .hero h1 {
    font-size: 29px;
  }

  .hero-date {
    max-width: 230px;
  }

  .hero-meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .mission-core {
    display: none;
  }

  .panel {
    padding: 18px 14px;
  }

  .room {
    display: none;
  }
}
</style>
