<script setup>
import { computed } from 'vue'
import { useStoredRef } from '../composables/store'
import { moodLog } from '../composables/atmosphereStore.js'
import { selectWeeklyReview, weekRange } from '../composables/domain/weeklySelectors.js'
import { isActiveEntity } from '../composables/domain/state.js'
import { policyDateTime, timestampOf } from '../composables/settingsPolicy.js'
import { buildCompletionTrend, buildFocusHours, buildMoodFocusWeeks, buildRhythmWeeks, describeMoodFocus, scaleTrendGeometry } from '../composables/reviewCharts.js'
import { appNow } from '../composables/timeContext.js'

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const milestones = useStoredRef('sl_exams', [])
const bills = useStoredRef('sl_bills', [])
const transactions = useStoredRef('sl_expenses', [], { deep: false })
const events = useStoredRef('sl_events', [])
const focusSessions = useStoredRef('sl_focus_sessions', [])

// 本周日期范围在一周内固定。把时钟分钟变化收敛到本周起点，避免周汇总、心情图和
// 专注图在每次整分钟跳动时重扫整份历史数据。
const weekStartAt = computed(() => weekRange(appNow.value).startAt)
const reviewNow = computed(() => new Date(weekStartAt.value))
const taskChartTransitions = computed(() => {
  const transitions = []
  for (const task of tasks.value) {
    if (!isActiveEntity(task)) continue
    if (task.dueDate) {
      const dueAt = policyDateTime(task.dueDate, task.dueTime || '23:59')
      // isOverdueAt 使用 dueAt < cutoff，故边界落在截止时刻之后 1ms。
      if (Number.isFinite(dueAt)) transitions.push(dueAt + 1)
    }
    const completedAt = timestampOf(task.completedAt)
    if (completedAt > 0) transitions.push(completedAt)
  }
  return transitions.sort((left, right) => left - right)
})
const taskChartAsOf = computed(() => {
  const now = appNow.value.getTime()
  const transitions = taskChartTransitions.value
  let low = 0
  let high = transitions.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (transitions[middle] <= now) low = middle + 1
    else high = middle
  }
  return Math.max(weekStartAt.value, transitions[low - 1] || weekStartAt.value)
})

const review = computed(() => selectWeeklyReview({
  tasks: tasks.value,
  courses: courses.value,
  milestones: milestones.value,
  bills: bills.value,
  transactions: transactions.value,
  events: events.value,
  moodLog: moodLog.value,
}, reviewNow.value))

const weekLabel = computed(() => {
  const { startDate, endDate } = review.value.week
  const lastDate = new Date(`${endDate}T00:00:00Z`)
  lastDate.setUTCDate(lastDate.getUTCDate() - 1)
  return `${startDate} — ${lastDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}`
})
const moodLabel = computed(() => ({ sunny: '晴朗', cloudy: '多云', rain: '低落' }[review.value.mood.dominant] || '未记录'))

const chartData = computed(() => ({ tasks: tasks.value, focusSessions: focusSessions.value, moodLog: moodLog.value }))
const timeSensitiveTaskCharts = computed(() => {
  const options = { asOf: taskChartAsOf.value }
  const rhythm = buildRhythmWeeks(chartData.value, reviewNow.value, options)
  const completionTrend = buildCompletionTrend(chartData.value, reviewNow.value, { ...options, rhythmWeeks: rhythm.weeks })
  return { rhythm, completionTrend }
})
const rhythm = computed(() => timeSensitiveTaskCharts.value.rhythm)
const completionTrend = computed(() => timeSensitiveTaskCharts.value.completionTrend)
const trendGeometry = computed(() => scaleTrendGeometry(completionTrend.value.points, { width: 100, height: 42, left: 1, right: 1, top: 2, bottom: 2 }))
const maxTrendBacklog = computed(() => trendGeometry.value.maxBacklog)
const moodFocus = computed(() => buildMoodFocusWeeks(chartData.value, reviewNow.value))
const moodFocusSummary = computed(() => describeMoodFocus(moodFocus.value.weeks))
const focusHours = computed(() => buildFocusHours(chartData.value, reviewNow.value))
const peakHourLabel = computed(() => focusHours.value.peakHours.map((hour) => `${String(hour).padStart(2, '0')}:00`).join('、'))
const maxMoodFocusMinutes = computed(() => Math.max(0, ...moodFocus.value.weeks.map((week) => week.focusMinutes)))
const maxFocusSeconds = computed(() => Math.max(0, ...focusHours.value.buckets.map((bucket) => bucket.seconds)))
const moodName = (mood) => ({ sunny: '晴朗', cloudy: '多云', rain: '低落' }[mood] || '未记录')
const weekRangeLabel = (week) => `${week.startDate.slice(5)}–${week.lastDate.slice(5)}`

</script>

<template>
  <div class="page review-page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">本周回顾</h1>
        <p class="page-desc">{{ weekLabel }} · 从已经发生的记录里，看见这一周。</p>
      </div>
      <div class="page-head-actions">
        <router-link class="btn btn-ghost" to="/">回到今天</router-link>
      </div>
    </header>

    <section class="review-grid">
      <article class="card review-card review-primary">
        <span class="review-kicker">待办完成</span>
        <strong>{{ review.tasks.completed }}</strong>
        <span>本周完成 · 新增 {{ review.tasks.created }} · 待处理 {{ review.tasks.pending }}</span>
        <small>作业 {{ review.tasks.homeworkCompleted }} · 复习 {{ review.tasks.reviewCompleted }}</small>
      </article>
      <article class="card review-card">
        <span class="review-kicker">学习节奏</span>
        <strong>{{ review.courses.sessions }} <small>节</small></strong>
        <span>{{ review.courses.courses }} 门课程 · 预计投入 {{ review.tasks.focusMinutes }} 分钟</span>
      </article>
      <article class="card review-card">
        <span class="review-kicker">收支</span>
        <strong>¥{{ review.finance.expense.toFixed(2) }}</strong>
        <span>支出 · 收入 ¥{{ review.finance.income.toFixed(2) }} · 共 {{ review.finance.count }} 笔</span>
        <small>账单应付 {{ review.bills.due }} · 已支付 {{ review.bills.paid }}</small>
      </article>
      <article class="card review-card">
        <span class="review-kicker">心情</span>
        <strong>{{ moodLabel }}</strong>
        <span>{{ review.mood.days }} 天有记录</span>
        <small>晴 {{ review.mood.sunny }} · 多云 {{ review.mood.cloudy }} · 低落 {{ review.mood.rain }}</small>
      </article>
    </section>

    <section class="card next-week-card">
      <div class="section-head"><div><h2>下周先看</h2><p>来自待办、日程、重要日期和固定账单的去重提醒。</p></div><span>{{ review.nextWeek.length }} 项</span></div>
      <ul v-if="review.nextWeek.length" class="highlight-list">
        <li v-for="item in review.nextWeek" :key="item.key"><span>{{ item.sourceType === 'task' ? '待办' : item.sourceType === 'event' ? '日程' : item.sourceType === 'milestone' ? '重要日期' : '账单' }}</span><b>{{ item.title }}</b><time>{{ item.date.slice(5) }}<template v-if="item.time"> {{ item.time }}</template></time></li>
      </ul>
      <p v-else class="empty-hint">下周还没有需要提前看的事项。</p>
    </section>

    <section class="review-insights" aria-label="学习节奏分析">
      <article class="card insight-card">
        <div class="section-head"><div><h2>16 周节奏</h2><p>每格按「本周完成 ÷（完成 + 本周到期未完成）」计算。</p></div><span>{{ rhythm.recorded }} 周有记录</span></div>
        <div class="rhythm-grid" role="list" aria-label="最近 16 周待办完成率">
          <div v-for="week in rhythm.weeks" :key="week.startDate" class="rhythm-cell" :class="[`heat-${week.level}`, { empty: week.empty, current: week.isCurrent }]" role="listitem" :aria-label="`${week.label}，${weekRangeLabel(week)}${week.isCurrent ? '，本周' : ''}`" :title="`${week.label} · ${weekRangeLabel(week)}`">
            <small>{{ week.startDate.slice(5) }}</small><b>{{ week.empty ? '—' : `${week.rate}%` }}</b>
          </div>
        </div>
        <div class="heat-legend"><span>低</span><i class="heat-0"></i><i class="heat-1"></i><i class="heat-2"></i><i class="heat-3"></i><i class="heat-4"></i><span>高</span><span class="heat-empty-key">— 无待办记录</span></div>
      </article>

      <article class="card insight-card">
        <div class="section-head"><div><h2>完成率与逾期堆积</h2><p>折线是每周完成率；红色面积是每周末仍未完成的已到期待办，前周欠账会带入并在补完后消退。本周按当前时点统计。</p></div><span>近 16 周</span></div>
        <svg class="trend-chart" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" :aria-label="`最近 16 周待办完成率折线，当前仍逾期 ${completionTrend.currentBacklog} 项`">
          <path v-if="trendGeometry.area" class="trend-area" :d="trendGeometry.area" />
          <path v-if="trendGeometry.band" class="trend-backlog" :d="trendGeometry.band" />
          <polyline v-if="trendGeometry.line" class="trend-line" :points="trendGeometry.line" />
        </svg>
        <div class="trend-legend"><span><i class="legend-rate"></i>完成率</span><span><i class="legend-backlog"></i>周末逾期存量</span><b>当前仍逾期 {{ completionTrend.currentBacklog }} 项 · 近 16 周新增逾期项合计 {{ completionTrend.totalMissed }} 项</b></div>
        <div class="trend-axis"><span>{{ completionTrend.points[0]?.startDate?.slice(5) }}</span><span>完成率 0–100% · 逾期 0–{{ maxTrendBacklog }} 项</span><span>本周</span></div>
      </article>

      <article class="card insight-card">
        <div class="section-head"><div><h2>专注时段规律</h2><p>按开始时间分到 24 个小时；跨小时会话记在开始小时。</p></div><span>{{ focusHours.totalMinutes }} 分钟</span></div>
        <div class="focus-hour-chart" role="img" :aria-label="`24 小时专注时长分布，共 ${focusHours.totalSessions} 个有效会话`">
          <div v-for="bucket in focusHours.buckets" :key="bucket.hour" class="hour-column" :title="`${String(bucket.hour).padStart(2, '0')}:00 · ${bucket.minutes} 分钟 · ${bucket.sessions} 次`">
            <span class="hour-track"><i :style="{ height: maxFocusSeconds ? `${(bucket.seconds / maxFocusSeconds) * 100}%` : '0%' }"></i></span>
            <small>{{ bucket.hour % 6 === 0 ? String(bucket.hour).padStart(2, '0') : '' }}</small>
          </div>
        </div>
        <p v-if="focusHours.totalSessions" class="insight-note">最多在 <b>{{ peakHourLabel }}</b> 开始专注 · {{ focusHours.totalSessions }} 个有效会话<template v-if="focusHours.skippedSessions"> · {{ focusHours.skippedSessions }} 条无效或零时长记录未计</template></p>
        <p v-else class="insight-note">还没有可统计的专注时长记录。</p>
      </article>

      <article class="card insight-card">
        <div class="section-head"><div><h2>心情 × 专注</h2><p>每周心情分布与专注分钟并排，颜色表示当周主导心情。</p></div><span>{{ moodFocus.moodWeeks }} 周有心情</span></div>
        <div class="mood-focus-grid" role="list" aria-label="最近 16 周心情与专注对照">
          <div v-for="week in moodFocus.weeks" :key="week.startDate" class="mood-focus-cell" :class="`mood-${week.dominant || 'none'}`" role="listitem" :aria-label="`${weekRangeLabel(week)}，心情 ${week.moodDays ? `${moodName(week.dominant)}，晴 ${week.sunny} 天、多云 ${week.cloudy} 天、低落 ${week.rain} 天` : '未记录'}，专注 ${week.focusMinutes} 分钟`" :title="`${weekRangeLabel(week)} · ${week.label}`">
            <small>{{ week.startDate.slice(5) }}</small><b>{{ moodName(week.dominant) }}</b>
            <span class="mood-focus-track"><i :style="{ height: maxMoodFocusMinutes ? `${(week.focusMinutes / maxMoodFocusMinutes) * 100}%` : '0%' }"></i></span>
            <small>{{ week.focusMinutes }}′</small>
          </div>
        </div>
        <p class="insight-note">{{ moodFocusSummary.text }}</p>
      </article>
    </section>
  </div>
</template>

<style scoped>
.notice-success { margin: 12px 0 0; color: var(--success); font-size: var(--fs-12); }
.review-page { gap: 18px; }
.review-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.review-card { display: flex; flex-direction: column; gap: 6px; min-height: 132px; padding: 17px; }
.review-kicker { color: var(--ink-faint); font-size: var(--fs-12); font-weight: var(--fw-750); }
.review-card strong { font-size: var(--fs-29); font-weight: var(--fw-900); letter-spacing: -.02em; }
.review-card strong small { font-size: var(--fs-13); }
.review-card span, .review-card small { color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.45; }
.review-primary { border-color: color-mix(in srgb, var(--primary) 34%, var(--border)); background: var(--primary-soft); }
.next-week-card { padding: 18px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.section-head h2 { font-size: var(--fs-16); }
.section-head p { margin-top: 4px; color: var(--ink-faint); font-size: var(--fs-12); }
.section-head > span { color: var(--primary); font-size: var(--fs-12); font-weight: var(--fw-800); }
.highlight-list { display: flex; flex-direction: column; gap: 7px; margin: 15px 0 0; padding: 0; list-style: none; }
.highlight-list li { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--radius-9); background: var(--bg-tint); }
.highlight-list li > span { color: var(--primary); font-size: var(--fs-11); font-weight: var(--fw-750); }
.highlight-list b { overflow: hidden; font-size: var(--fs-13); text-overflow: ellipsis; white-space: nowrap; }
.highlight-list time { color: var(--ink-faint); font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.empty-hint { margin-top: 16px; color: var(--ink-faint); font-size: var(--fs-13); }
.review-insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.insight-card { min-width: 0; padding: 16px; }
.rhythm-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }
.rhythm-cell { min-width: 0; min-height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border-radius: var(--radius-8); color: var(--ink); background: color-mix(in srgb, var(--success) 10%, var(--card)); }
.rhythm-cell small { color: var(--ink-soft); font-size: var(--fs-9-5); }
.rhythm-cell b { font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.rhythm-cell.heat-0 { background: color-mix(in srgb, var(--danger) 24%, var(--card)); }
.rhythm-cell.heat-1 { background: color-mix(in srgb, var(--danger) 15%, var(--card)); }
.rhythm-cell.heat-2 { background: color-mix(in srgb, var(--warning) 24%, var(--card)); }
.rhythm-cell.heat-3 { background: color-mix(in srgb, var(--success) 20%, var(--card)); }
.rhythm-cell.heat-4 { color: var(--on-primary, #fff); background: var(--success); }
.rhythm-cell.empty { color: var(--ink-faint); border: 1px dashed var(--border); background: var(--bg-tint); }
.rhythm-cell.current { outline: 2px solid var(--primary); outline-offset: 1px; }
.heat-legend, .trend-legend, .trend-axis { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--ink-faint); font-size: var(--fs-10-5); }
.heat-legend i { width: 12px; height: 12px; border-radius: 3px; background: color-mix(in srgb, var(--danger) 24%, var(--card)); }
.heat-legend i.heat-1 { background: color-mix(in srgb, var(--danger) 15%, var(--card)); }
.heat-legend i.heat-2 { background: color-mix(in srgb, var(--warning) 24%, var(--card)); }
.heat-legend i.heat-3 { background: color-mix(in srgb, var(--success) 20%, var(--card)); }
.heat-legend i.heat-4 { background: var(--success); }
.heat-empty-key { margin-left: auto; }
.trend-chart { display: block; width: 100%; height: 132px; margin-top: 12px; overflow: visible; background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(25% - 1px), var(--border) 25%); border-bottom: 1px solid var(--border); }
.trend-area { fill: color-mix(in srgb, var(--primary) 9%, transparent); }
.trend-backlog { fill: color-mix(in srgb, var(--danger) 28%, transparent); }
.trend-line { fill: none; stroke: var(--primary); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.trend-legend { flex-wrap: wrap; }
.trend-legend span { display: inline-flex; align-items: center; gap: 4px; }
.trend-legend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; }
.legend-rate { background: var(--primary); }
.legend-backlog { background: color-mix(in srgb, var(--danger) 40%, transparent); }
.trend-legend b { margin-left: auto; color: var(--ink-soft); }
.trend-axis { justify-content: space-between; margin-top: 4px; }
.focus-hour-chart { height: 104px; display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); align-items: end; gap: 3px; margin-top: 14px; }
.hour-column { height: 100%; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: end; gap: 5px; }
.hour-track { width: 100%; height: 78px; display: flex; align-items: end; overflow: hidden; border-radius: 3px 3px 0 0; background: var(--bg-tint); }
.hour-track i { width: 100%; min-height: 0; border-radius: 3px 3px 0 0; background: linear-gradient(0deg, var(--brand-grad-a), var(--brand-grad-b)); }
.hour-column small { height: 12px; color: var(--ink-faint); font-size: 8px; }
.insight-note { margin-top: 10px; color: var(--ink-soft); font-size: var(--fs-11-5); line-height: 1.5; }
.mood-focus-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 5px; margin-top: 12px; }
.mood-focus-cell { min-width: 0; min-height: 88px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 5px 2px; border-radius: var(--radius-7); background: var(--bg-tint); }
.mood-focus-cell > small { color: var(--ink-faint); font-size: 8px; }
.mood-focus-cell > b { max-width: 100%; overflow: hidden; color: var(--ink-soft); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.mood-focus-track { width: 55%; height: 38px; display: flex; align-items: end; background: color-mix(in srgb, var(--border) 60%, transparent); }
.mood-focus-track i { width: 100%; min-height: 0; border-radius: 3px 3px 0 0; background: var(--primary); }
.mood-sunny .mood-focus-track i { background: var(--success); }
.mood-cloudy .mood-focus-track i { background: var(--warning); }
.mood-rain .mood-focus-track i { background: var(--primary); }
.mood-none .mood-focus-track i { background: var(--ink-faint); }
@media (max-width: 900px) { .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .review-insights { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .review-grid { grid-template-columns: 1fr; } .review-card { min-height: auto; } .highlight-list li { grid-template-columns: 38px minmax(0, 1fr); } .highlight-list time { grid-column: 2; } .rhythm-grid, .mood-focus-grid { gap: 4px; } .rhythm-cell { min-height: 42px; } }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.page-head-actions { display: flex; gap: 8px; }
</style>
