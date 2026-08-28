<script setup>
import { computed } from 'vue'
import {
  useStoredRef,
  todayIndex,
  dayName,
  fmtCountdownDate,
  sortCountdowns,
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
const totalXp = computed(() => totalDone.value * EXP_PER_TASK)
const expToNext = computed(() => Math.max(1, Math.ceil((100 - expPercent.value) / EXP_PER_TASK)))

// 本周完成情况：统计周一至今完成的待办，用于 Hero 右侧徽章
const weekProgress = computed(() => {
  const nowDate = new Date(now.value)
  const day = nowDate.getDay() === 0 ? 7 : nowDate.getDay()
  const monday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - (day - 1))
  const mondayTs = monday.getTime()
  const isSameWeek = (iso) => {
    if (!iso) return false
    const t = new Date(iso)
    return t.getTime() >= mondayTs && t.getTime() <= nowDate.getTime() + 60000
  }
  const doneThisWeek = tasks.value.filter((task) => task.done && isSameWeek(task.completedAt)).length
  const createdThisWeek = tasks.value.filter((task) => isSameWeek(task.createdAt)).length
  const total = createdThisWeek + pendingTasks.value.length
  return { done: doneThisWeek, total, percent: total ? Math.round((doneThisWeek / total) * 100) : 0 }
})

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

// 风险提示：不再占用主卡位，紧急时在 Hero 显示警示 chip
const riskCard = computed(() => {
  const today = todayStr()
  const nowTime = now.value.getTime()
  const overdue = pendingTasks.value.filter((task) => task.dueDate && taskTimestamp(task) < nowTime).length
  const dueToday = pendingTasks.value.filter((task) => task.dueDate === today && taskTimestamp(task) >= nowTime).length
  const total = overdue + dueToday
  return { count: total, urgent: total > 0, label: total ? `${total} 项需注意` : '' }
})

// 卡片三：未来七天 —— 按真实数据动态统计
const weeklyAhead = computed(() => {
  let taskCount = 0
  let examCount = 0
  let billCount = 0
  for (let offset = 0; offset < 7; offset++) {
    const date = dateFromOffset(offset)
    taskCount += pendingTasks.value.filter((task) => task.dueDate === date).length
    examCount += upcomingExams.value.filter((item) => {
      const target = item.countdown.target
      if (!target) return false
      const pad = (value) => String(value).padStart(2, '0')
      return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}` === date
    }).length
    billCount += bills.value.filter((bill) => bill.active !== false && bill.nextDate === date).length
  }
  const important = taskCount + examCount + billCount
  const detail = [
    taskCount ? `${taskCount} 个待办` : '',
    examCount ? `${examCount} 个倒计时` : '',
    billCount ? `${billCount} 笔账单` : '',
  ].filter(Boolean).join(' · ')
  return {
    count: important,
    value: important ? `${important} 项` : '暂无紧迫事项',
    detail: detail || '未来七天没有固定安排',
  }
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
      <div class="hero-deco" aria-hidden="true">
        <span class="deco-glow"></span>
        <span class="deco-ring"></span>
        <span class="deco-orb"></span>
      </div>

      <div class="hero-copy">
        <p class="eyebrow">STUDY QUEST · WEEK {{ weekNum }}</p>
        <h1>{{ greeting() }}，<br />{{ currentQuote }}</h1>
        <p v-if="appearance.signature" class="hero-signature">— {{ appearance.signature }}</p>
        <p class="hero-date">{{ dateText }}</p>
        <div class="hero-meta">
          <span v-if="riskCard.urgent" class="meta-alert">⚠ {{ riskCard.label }}</span>
          <span>📍 {{ campusName(currentCampusId()) }}</span>
          <span>◷ {{ seasonName(currentSeasonId()) }}</span>
        </div>
      </div>

      <div class="hero-visual" aria-hidden="true">
        <img :src="heroArt" alt="" />
        <div class="level-panel">
          <div
            class="level-ring"
            :style="{ '--p': expPercent }"
          >
            <div class="level-core">
              <strong>LV.{{ playerLevel }}</strong>
              <span>{{ levelTitle }}</span>
            </div>
          </div>
          <div class="level-info">
            <div class="xp-row">
              <span>总经验</span>
              <b>{{ totalXp }} XP</b>
            </div>
            <div class="level-bar"><i :style="{ width: expPercent + '%' }"></i></div>
            <small>再完成 {{ expToNext }} 项待办升级</small>
            <div class="week-divider"></div>
            <div v-if="weekProgress.total === 0" class="week-empty">今天还没有任务</div>
            <template v-else>
              <div class="xp-row">
                <span>本周完成</span>
                <b>{{ weekProgress.done }}/{{ weekProgress.total }}</b>
              </div>
              <div class="level-bar week"><i :style="{ width: weekProgress.percent + '%' }"></i></div>
            </template>
          </div>
        </div>
      </div>
    </section>

    <section v-if="moduleVisible('focus')" class="focus-grid wide-module" :style="{ order: moduleOrder('focus') }" aria-label="近期重点">
      <router-link to="/tasks" class="focus-card focus-task">
        <span class="focus-icon">✓</span>
        <div class="focus-copy">
          <span class="focus-label">最近任务</span>
          <template v-if="nextTask">
            <strong>{{ nextTask.title }}</strong>
            <small>{{ taskDeadline(nextTask) }}<template v-if="nextTask.course"> · {{ nextTask.course }}</template></small>
          </template>
          <template v-else>
            <strong class="is-empty">待办已清空</strong>
            <small>目前没有未完成事项 · 去添加一个</small>
          </template>
        </div>
        <span class="focus-enter">›</span>
      </router-link>

      <router-link to="/bills" class="focus-card focus-bill">
        <span class="focus-icon">¥</span>
        <div class="focus-copy">
          <span class="focus-label">下一笔账单</span>
          <template v-if="nextBill">
            <strong>{{ nextBill.name }}</strong>
            <small>{{ billBrief(nextBill) }}</small>
          </template>
          <template v-else>
            <strong class="is-empty">暂无账单</strong>
            <small>近期没有需要支付的账单</small>
          </template>
        </div>
        <span class="focus-enter">›</span>
      </router-link>

    </section>

    <section v-if="moduleVisible('courses')" class="panel mission-panel" :class="{ 'single-panel': !moduleVisible('countdowns'), 'is-empty': todayCourses.length === 0 }" :style="{ order: moduleOrder('courses') }">
        <div class="panel-head">
          <div>
            <span class="panel-code">DAILY MISSION</span>
            <router-link to="/schedule" class="panel-title-link"><h2>今日课程</h2></router-link>
          </div>
          <span class="panel-count">{{ todayCourses.length }} 项</span>
        </div>
        <p v-if="todayCourses.length === 0" class="empty">
          <span class="empty-icon">✓</span>
          <span>今天没有课程，可以自由安排时间</span>
          <router-link to="/schedule" class="empty-action">查看课表 →</router-link>
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

      <section v-if="moduleVisible('countdowns')" class="panel exam-panel" :class="{ 'single-panel': !moduleVisible('courses'), 'is-empty': previewExams.length === 0 }" :style="{ order: moduleOrder('countdowns') }">
        <div class="panel-head">
          <div>
            <span class="panel-code">COUNTDOWN</span>
            <router-link to="/exams" class="panel-title-link"><h2>近期倒计时</h2></router-link>
          </div>
          <span class="panel-count">最近 {{ previewExams.length }} 项</span>
        </div>
        <p v-if="previewExams.length === 0" class="empty">
          <span class="empty-icon">✦</span>
          <span>暂无即将到来的倒计时</span>
          <router-link to="/exams" class="empty-action">添加倒计时 →</router-link>
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
        <div class="week-ahead-inline" aria-label="未来七天概况">
          <span class="week-ahead-icon" aria-hidden="true">7D</span>
          <div>
            <span>未来七天</span>
            <strong>{{ weeklyAhead.value }}</strong>
            <small>{{ weeklyAhead.detail }}</small>
          </div>
        </div>
      </section>
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
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ---------- Hero：柔和渐变 + 极淡噪点 + 右缘单一柔光（方向 A+C，克制不抢文字） ---------- */
.hero {
  position: relative;
  min-height: 216px;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 26px;
  padding: 26px 34px;
  color: #fff;
  border: 1px solid rgba(148, 160, 226, 0.28);
  border-radius: var(--radius-lg, 20px);
  background: linear-gradient(126deg, #10173a 0%, #151d44 46%, #1d2454 78%, #232a5c 100%);
  box-shadow: 0 14px 36px rgba(26, 32, 74, 0.16);
}
/* 单一柔光：贴右上角边缘，弱透明度，位置避开主标题区 */
.hero-deco {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.deco-glow {
  position: absolute;
  top: -38%;
  right: -12%;
  width: 62%;
  height: 150%;
  background: radial-gradient(closest-side, rgba(129, 118, 255, 0.2), rgba(96, 130, 255, 0.07) 58%, transparent 76%);
  filter: blur(6px);
}
.deco-ring {
  position: absolute;
  right: 196px;
  bottom: -128px;
  width: 264px;
  height: 264px;
  border: 1px solid rgba(168, 178, 240, 0.16);
  border-radius: 50%;
}
.deco-orb {
  position: absolute;
  right: 42px;
  top: -64px;
  width: 132px;
  height: 132px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, rgba(158, 148, 255, 0.24), transparent 66%);
  opacity: 0.55;
}
/* 极轻噪点：仅提升质感，不可见颗粒 */
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.05;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
}
/* 文字区左侧轻微压暗，保证标题对比度 */
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(94deg, rgba(9, 13, 33, 0.5) 8%, rgba(9, 13, 33, 0.16) 40%, transparent 62%);
}
.hero-copy {
  position: relative;
  z-index: 2;
  max-width: 600px;
}
.eyebrow {
  margin-bottom: 10px;
  color: #a7b4ea;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
}
.hero h1 {
  font-size: clamp(25px, 2.8vw, 34px);
  line-height: 1.24;
  letter-spacing: -0.02em;
  text-shadow: 0 1px 14px rgba(6, 10, 28, 0.35);
}
.hero-date {
  margin-top: 9px;
  color: #c3cbf2;
  font-size: 13.5px;
}
.hero-signature {
  margin-top: 7px;
  color: #a7b4ea;
  font-size: 12px;
}
.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 15px;
}
.hero-meta span {
  padding: 6px 11px;
  color: #dde3fb;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid rgba(174, 188, 255, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}
.hero-meta .meta-alert {
  color: #ffd9cf;
  border-color: rgba(255, 154, 130, 0.34);
  background: rgba(240, 92, 68, 0.16);
}

/* ---------- 右侧等级徽章面板 ---------- */
.hero-visual {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 18px;
}
.hero-visual > img {
  width: 128px;
  transform: rotate(-4deg);
  filter: drop-shadow(0 12px 20px rgba(6, 9, 26, 0.4));
  animation: hero-float 8s ease-in-out infinite;
}
@keyframes hero-float {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: translateY(-5px) rotate(-3deg); }
}
.level-panel {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px 14px 14px;
  border: 1px solid rgba(190, 200, 250, 0.2);
  border-radius: var(--radius-m, 14px);
  background: rgba(12, 17, 44, 0.44);
}
.level-ring {
  --p: 0;
  position: relative;
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  flex: 0 0 86px;
  border-radius: 50%;
  background:
    conic-gradient(from -90deg, #8f97ff calc(var(--p) * 1%), rgba(255, 255, 255, 0.09) 0);
}
.level-ring::before {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: #131a3e;
}
.level-core {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.15;
}
.level-core strong {
  font-size: 19px;
  font-weight: 900;
  letter-spacing: 0.01em;
}
.level-core span {
  max-width: 62px;
  overflow: hidden;
  margin-top: 1px;
  color: #a7b4ea;
  font-size: 9.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.level-info {
  display: flex;
  flex-direction: column;
  min-width: 128px;
}
.xp-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.xp-row span {
  color: #a7b4ea;
  font-size: 10.5px;
}
.xp-row b {
  font-size: 15px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.level-bar {
  overflow: hidden;
  height: 5px;
  margin-top: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}
.level-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7f9cff, #a99bff);
  transition: width 0.5s ease;
}
.level-bar.week i {
  background: linear-gradient(90deg, #5ed0a8, #7fe3c4);
}
.level-info small {
  margin-top: 5px;
  color: #8e9ad0;
  font-size: 10px;
}
.week-divider {
  height: 1px;
  margin: 10px 0;
  background: rgba(190, 200, 250, 0.14);
}
.week-empty {
  padding: 2px 0;
  color: #aab5e6;
  font-size: 11.5px;
}
.stats {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}
.stat {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: #fff;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
}
.stat:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
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
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  color: currentColor;
  font-size: 13px;
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
.stat.urgent { color: var(--danger); border-color: #f3c2c2; box-shadow: inset 3px 0 0 var(--danger), var(--shadow-sm); }
.stat-label {
  color: var(--ink-faint);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.stat-num {
  overflow: hidden;
  margin-top: 2px;
  color: var(--text);
  font-size: clamp(22px, 2.1vw, 28px);
  font-weight: 900;
  line-height: 1.12;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state-upcoming .stat-num,
.state-live .stat-num {
  font-variant-numeric: tabular-nums;
}
.state-live .stat-num {
  background: linear-gradient(120deg, #456fe8, #7a55e8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.stat-detail {
  overflow: hidden;
  margin-top: 5px;
  color: var(--ink-soft);
  font-size: 11.5px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat-link {
  align-self: flex-start;
  margin-top: 6px;
  color: var(--primary);
  font-size: 11.5px;
  font-weight: 700;
  text-decoration: none;
}
.stat-link:hover {
  text-decoration: underline;
}
.focus-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.focus-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 13px 14px;
  color: var(--text);
  text-decoration: none;
  border: 1px solid var(--border);
  border-radius: 14px;
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
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  color: var(--primary);
  font-size: 15px;
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
  color: var(--ink-faint);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-copy strong {
  overflow: hidden;
  margin-top: 3px;
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-card .is-empty strong {
  color: var(--ink-faint);
  font-weight: 600;
}
.focus-copy small {
  overflow: hidden;
  margin-top: 2px;
  color: var(--ink-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-enter {
  color: #aab2c2;
  font-size: 18px;
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
  margin-bottom: 14px;
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
.panel-title-link { color: inherit; text-decoration: none; }
.panel-title-link:hover { color: var(--primary); }
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
  gap: 7px;
  color: var(--ink-soft);
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  color: var(--primary);
  font-size: 17px;
  font-weight: 800;
  border: 1px solid #dbe3fa;
  border-radius: 10px;
  background: var(--bg-tint);
}
.panel.is-empty .panel-head { margin-bottom: 7px; }
.panel.is-empty .empty {
  flex-direction: row;
  justify-content: flex-start;
  padding: 8px 0 2px;
}
.panel.is-empty .empty-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
}
.empty-action {
  color: var(--primary);
  font-size: 12px;
  font-weight: 750;
  text-decoration: none;
  white-space: nowrap;
}
.empty-action:hover { text-decoration: underline; }
.panel.is-empty .empty .empty-action { margin-left: auto; }
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
  color: var(--ink-soft);
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
.week-ahead-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 15px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.week-ahead-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: #ef7b45;
  font-size: 11px;
  font-weight: 900;
  border: 1px solid #f1c8b3;
  border-radius: 11px 4px 11px 4px;
  background: #fff8f3;
}
.week-ahead-inline > div {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: baseline;
  column-gap: 8px;
  min-width: 0;
}
.week-ahead-inline span {
  color: var(--ink-faint);
  font-size: 10px;
  font-weight: 750;
}
.week-ahead-inline strong {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.week-ahead-inline small {
  grid-column: 1 / -1;
  overflow: hidden;
  margin-top: 2px;
  color: var(--ink-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .page {
    grid-template-columns: 1fr;
  }
  .wide-module {
    grid-column: 1;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .focus-grid {
    grid-template-columns: 1fr 1fr;
  }

}

@media (max-width: 860px) {
  .hero-visual {
    display: none;
  }
}

@media (max-width: 760px) {
  .hero {
    min-height: 0;
    padding: 26px 24px;
  }

  .hero-copy {
    max-width: 520px;
  }

  .stats {
    grid-template-columns: 1fr;
    overflow: visible;
    padding-bottom: 0;
  }

  .focus-grid {
    grid-template-columns: 1fr;
  }


  .stat {
    min-height: 84px;
  }

}

@media (max-width: 520px) {
  .page {
    gap: 14px;
  }

  .hero {
    padding: 24px 20px;
    border-radius: 18px;
  }

  .hero h1 {
    font-size: 27px;
  }

  .hero-date {
    max-width: 230px;
  }

  .hero-meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .panel {
    padding: 18px 14px;
  }

  .room {
    display: none;
  }
}
</style>
