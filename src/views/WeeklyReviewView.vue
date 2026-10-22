<script setup>
import PageHeader from '../components/PageHeader.vue'
import LearningNavigation from '../components/learning/LearningNavigation.vue'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { FieldGroup, Field, FieldLabel, FieldDescription } from '../components/ui/field'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '../components/ui/empty'
import { ChevronLeftIcon, ChevronRightIcon, ChevronDown } from '@lucide/vue'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useStoredRef } from '../composables/store'
import { moodLog } from '../composables/atmosphereStore.js'
import { selectWeeklyReview } from '../composables/domain/weeklySelectors.js'
import { isActiveEntity } from '../composables/domain/state.js'
import { policyDateTime, timestampOf } from '../composables/settingsPolicy.js'
import { buildCompletionTrend, buildFocusHours, buildMoodFocusWeeks, buildRhythmWeeks, describeMoodFocus, scaleTrendGeometry } from '../composables/reviewCharts.js'
import { createLedgerBaseConverter, normalizeLedgerFx, useLedgerFx } from '../composables/ledgerFx.js'
import { isWeeklyReflectionWeekKey, normalizeWeeklyReflection, normalizeWeeklyReflections, WEEKLY_REFLECTIONS_KEY } from '../composables/weeklyReflections.js'
import { appNow, appToday, appTimezone } from '../composables/timeContext.js'
import { readLunarAnniversaries } from '../composables/lunarAnniversaries.js'
import { buildLastYearComparison } from '../composables/lastYearComparison.js'

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const milestones = useStoredRef('sl_exams', [])
const bills = useStoredRef('sl_bills', [])
const transactions = useStoredRef('sl_expenses', [], { deep: false })
const events = useStoredRef('sl_events', [])
const focusSessions = useStoredRef('sl_focus_sessions', [])
const weeklyReflections = useStoredRef(WEEKLY_REFLECTIONS_KEY, {})
const { fx: ledgerFx } = useLedgerFx()
const reviewOffset = ref(0)

// 图表锚定所选周，而不是浏览器当前日期；回看旧周时统计和图表仍使用同一段时间。
const financeConfig = computed(() => normalizeLedgerFx(ledgerFx.value))
const financeConverter = computed(() => createLedgerBaseConverter(financeConfig.value))
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
  const selectedWeek = review.value.week
  const now = reviewOffset.value === 0 ? appNow.value.getTime() : Math.min(appNow.value.getTime(), selectedWeek.endAt - 1)
  const transitions = taskChartTransitions.value
  let low = 0
  let high = transitions.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (transitions[middle] <= now) low = middle + 1
    else high = middle
  }
  return Math.max(selectedWeek.startAt, transitions[low - 1] || selectedWeek.startAt)
})

const review = computed(() => selectWeeklyReview({
  tasks: tasks.value,
  courses: courses.value,
  milestones: milestones.value,
  bills: bills.value,
  transactions: transactions.value,
  events: events.value,
  moodLog: moodLog.value,
}, appNow.value, {
  weekOffset: reviewOffset.value,
  currencyBase: financeConfig.value.base,
  convertAmount: (amount, currency) => financeConverter.value(amount, currency),
}))

const lastYearComparison = computed(() => buildLastYearComparison({
  focusSessions: focusSessions.value,
  tasks: tasks.value,
  transactions: transactions.value,
  moodLog: moodLog.value,
  weeklyReflections: weeklyReflections.value,
}, appToday.value, {
  timezone: appTimezone.value,
  lunarAnniversaries: readLunarAnniversaries(),
  currencyBase: financeConfig.value.base,
  convertAmount: (amount, currency) => financeConverter.value(amount, currency),
}))

const reviewNow = computed(() => new Date(`${review.value.week.startDate}T12:00:00Z`))

const weekLabel = computed(() => {
  const { startDate, endDate } = review.value.week
  const lastDate = new Date(`${endDate}T00:00:00Z`)
  lastDate.setUTCDate(lastDate.getUTCDate() - 1)
  const firstDate = new Date(`${startDate}T00:00:00Z`)
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  const first = formatter.format(firstDate)
  const last = formatter.format(lastDate)
  return firstDate.getUTCFullYear() === lastDate.getUTCFullYear()
    ? `${first} — ${last}`
    : `${firstDate.getUTCFullYear()}年${first} — ${lastDate.getUTCFullYear()}年${last}`
})
const moodLabel = computed(() => ({ sunny: '晴朗', cloudy: '多云', rain: '低落' }[review.value.mood.dominant] || '未记录'))
const weekName = computed(() => reviewOffset.value === 0 ? '本周' : reviewOffset.value === -1 ? '上周' : `回看第 ${Math.abs(reviewOffset.value)} 周`)
const weekCompletion = computed(() => timeSensitiveTaskCharts.value.rhythm.weeks.at(-1))
const moneyFormatter = computed(() => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: review.value.finance.base || 'CNY' }))
const formatMoney = (amount) => moneyFormatter.value.format(Number(amount) || 0)

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
const highlightKind = (item) => ({ task: '待办', event: '日程', milestone: '重要日期', bill: '账单' }[item.sourceType] || '事项')
const highlightRoute = (item) => ({ task: '/tasks', event: '/events', milestone: '/exams', bill: '/bills' }[item.sourceType] || '/')

const hasTaskSamples = computed(() => rhythm.value.recorded > 0)
const hasFocusSamples = computed(() => focusHours.value.totalSessions > 0)
const hasMoodSamples = computed(() => moodFocus.value.moodWeeks > 0 || maxMoodFocusMinutes.value > 0)
const hasAnalysisSamples = computed(() => hasTaskSamples.value || hasFocusSamples.value || hasMoodSamples.value)
const reflectionFields = [
  { key: 'wins', title: '这周做得不错的事', description: '记下一件值得肯定的进展', placeholder: '哪怕很小，也可以写下来。' },
  { key: 'learned', title: '我学到了什么', description: '哪些方法有效，哪些可以换一种做法', placeholder: '写下一个观察，给下次的自己留个提示。' },
  { key: 'next', title: '下周最重要的一件事', description: '把注意力放在一个可执行的重点上', placeholder: '下周，我想先完成……' },
]

const blankReflection = () => normalizeWeeklyReflection(null)
const reflectionDraft = ref(blankReflection())
const reflectionExpanded = ref(false)
const visibleReflectionFields = computed(() => reflectionExpanded.value ? reflectionFields : reflectionFields.filter((field) => field.key === 'next'))
const reflectionSaveState = ref('saved')
const activeReflectionWeek = computed(() => review.value.week.startDate)
const savedReflection = computed(() => normalizeWeeklyReflections(weeklyReflections.value)[activeReflectionWeek.value] || blankReflection())
const isReflectionDirty = computed(() => Object.keys(reflectionDraft.value).some((field) => reflectionDraft.value[field] !== savedReflection.value[field]))
const reflectionStatus = computed(() => isReflectionDirty.value ? '正在保存…' : reflectionSaveState.value === 'saving' ? '正在保存…' : '已自动保存')
const reflectionLength = computed(() => Object.fromEntries(Object.entries(reflectionDraft.value).map(([key, value]) => [key, value.length])))
let reflectionSaveTimer = null
let pendingReflectionSave = null

function persistReflection(week, reflection) {
  if (!isWeeklyReflectionWeekKey(week)) return
  const next = normalizeWeeklyReflections(weeklyReflections.value)
  const value = normalizeWeeklyReflection(reflection)
  if (Object.values(value).some((text) => text.trim())) next[week] = value
  else delete next[week]
  weeklyReflections.value = next
  pendingReflectionSave = null
  reflectionSaveState.value = 'saved'
}

function flushReflectionSave() {
  if (reflectionSaveTimer !== null) {
    clearTimeout(reflectionSaveTimer)
    reflectionSaveTimer = null
  }
  if (pendingReflectionSave) persistReflection(pendingReflectionSave.week, pendingReflectionSave.value)
}

function scheduleReflectionSave() {
  if (!isReflectionDirty.value) {
    if (reflectionSaveTimer !== null) clearTimeout(reflectionSaveTimer)
    reflectionSaveTimer = null
    pendingReflectionSave = null
    reflectionSaveState.value = 'saved'
    return
  }
  pendingReflectionSave = { week: activeReflectionWeek.value, value: { ...reflectionDraft.value } }
  reflectionSaveState.value = 'saving'
  if (reflectionSaveTimer !== null) clearTimeout(reflectionSaveTimer)
  reflectionSaveTimer = setTimeout(flushReflectionSave, 650)
}

function loadReflectionForCurrentWeek() {
  flushReflectionSave()
  reflectionDraft.value = { ...(normalizeWeeklyReflections(weeklyReflections.value)[activeReflectionWeek.value] || blankReflection()) }
  reflectionSaveState.value = 'saved'
}

watch(reflectionDraft, scheduleReflectionSave, { deep: true })
watch(activeReflectionWeek, loadReflectionForCurrentWeek)
loadReflectionForCurrentWeek()
onBeforeUnmount(flushReflectionSave)

function moveReviewWeek(offset) {
  flushReflectionSave()
  reviewOffset.value = Math.min(0, Number(offset) || 0)
}

function saveReflectionNow() {
  if (isReflectionDirty.value) {
    pendingReflectionSave = { week: activeReflectionWeek.value, value: { ...reflectionDraft.value } }
    flushReflectionSave()
  }
}

</script>

<template>
  <div class="page review-page">
    <PageHeader class="review-page-head" :title="`${weekName}回顾`" description="看见进展，留下一件下周想做好的事。">
      <template #actions>
      <div class="review-head-actions">
        <div class="week-switcher" role="group" aria-label="切换回顾周">
          <Button variant="ghost" size="icon-sm" class="week-nav-button" type="button" aria-label="回顾上一周" title="上一周" @click="moveReviewWeek(reviewOffset - 1)"><ChevronLeftIcon /></Button>
          <span class="week-switcher-label">{{ weekLabel }}</span>
          <Button variant="ghost" size="icon-sm" class="week-nav-button" type="button" aria-label="回顾下一周" title="下一周" :disabled="reviewOffset >= 0" @click="moveReviewWeek(reviewOffset + 1)"><ChevronRightIcon /></Button>
        </div>
        <Button variant="ghost" class="current-week-button" type="button" :disabled="reviewOffset === 0" @click="moveReviewWeek(0)">回到本周</Button>
        <Button as-child variant="outline"><router-link to="/">回到今天</router-link></Button>
      </div>
      </template>
    </PageHeader>

    <LearningNavigation current="review" />

    <section class="review-grid" aria-label="本周摘要">
      <article v-if="hasTaskSamples" class="review-card">
        <div class="metric-heading"><span class="review-kicker">待办完成</span></div>
        <strong class="metric-value">{{ review.tasks.completed }}<small>项</small></strong>
        <div v-if="hasTaskSamples" class="metric-progress" role="progressbar" :aria-valuenow="weekCompletion?.rate || 0" aria-valuemin="0" aria-valuemax="100" :aria-label="`本周待办完成率 ${weekCompletion?.rate || 0}%`">
          <span :style="{ width: `${weekCompletion?.rate || 0}%` }"></span>
        </div>
        <div class="metric-foot"><span>{{ hasTaskSamples ? `完成率 ${weekCompletion?.rate || 0}%` : '暂无完成率样本' }}</span><span>到期未完成 {{ weekCompletion?.missed || 0 }} 项</span></div>
        <small>新增 {{ review.tasks.created }} · 作业 {{ review.tasks.homeworkCompleted }} · 复习 {{ review.tasks.reviewCompleted }}</small>
      </article>
      <article v-if="review.courses.sessions || hasFocusSamples" class="review-card">
        <div class="metric-heading"><span class="review-kicker">课程与专注</span><span class="metric-icon" aria-hidden="true">◷</span></div>
        <strong class="metric-value">{{ review.courses.sessions }}<small>节课</small></strong>
        <span>{{ review.courses.courses }} 门课程 · 专注 {{ focusHours.totalMinutes }} 分钟</span>
        <small>{{ focusHours.totalSessions }} 次有效专注 · 待办预估 {{ review.tasks.focusMinutes }} 分钟</small>
      </article>
      <article v-if="review.finance.count || review.bills.due" class="review-card">
        <div class="metric-heading"><span class="review-kicker">本周净支出</span><Badge variant="secondary" class="metric-tag">{{ review.finance.base }}</Badge></div>
        <strong class="metric-value metric-money">{{ formatMoney(review.finance.expense) }}</strong>
        <span>收入 {{ formatMoney(review.finance.income) }} · {{ review.finance.count }} 笔</span>
        <small>账单应付 {{ review.bills.due }} · 已支付 {{ review.bills.paid }}</small>
        <p v-if="review.finance.missingRates?.length" class="metric-warning" role="status">{{ review.finance.excludedCount }} 笔缺少 {{ review.finance.missingRates.join('、') }} 汇率，未计入合计。</p>
      </article>
      <article v-if="review.mood.days" class="review-card">
        <div class="metric-heading"><span class="review-kicker">心情记录</span><Badge variant="secondary" class="metric-tag">{{ moodLabel }}</Badge></div>
        <strong class="metric-value">{{ review.mood.days }}<small>天</small></strong>
        <span>{{ review.mood.days }} 天有记录</span>
        <div class="mood-distribution" role="img" :aria-label="`晴朗 ${review.mood.sunny} 天，多云 ${review.mood.cloudy} 天，低落 ${review.mood.rain} 天`">
          <i class="mood-segment sunny" :style="{ flexGrow: review.mood.sunny }"></i>
          <i class="mood-segment cloudy" :style="{ flexGrow: review.mood.cloudy }"></i>
          <i class="mood-segment rain" :style="{ flexGrow: review.mood.rain }"></i>
        </div>
        <small>晴 {{ review.mood.sunny }} · 多云 {{ review.mood.cloudy }} · 低落 {{ review.mood.rain }}</small>
      </article>
    </section>

    <Card v-if="lastYearComparison.hasRecords" role="region" aria-labelledby="last-year-title" class="card last-year-card">
      <CardHeader class="section-head">
        <div><p class="section-eyebrow">回望这一年</p><CardTitle as="h2" id="last-year-title">与去年同期的对照</CardTitle></div>
      </CardHeader>
      <CardContent>
        <div class="last-year-metrics" aria-label="去年同期两项记录">
          <div><strong>{{ lastYearComparison.focusHours.toFixed(1) }}</strong><span>小时专注</span></div>
          <div><strong>{{ lastYearComparison.completedTasks }}</strong><span>件已完成待办</span></div>
        </div>
        <p class="last-year-sentence">{{ lastYearComparison.sentence }}</p>
      </CardContent>
    </Card>
    <Empty v-else role="region" aria-labelledby="last-year-empty-title" class="last-year-empty">
      <EmptyHeader>
        <EmptyTitle id="last-year-empty-title">去年的今天还没有记录</EmptyTitle>
        <EmptyDescription>那之后的几个月里，你又记下了 {{ lastYearComparison.subsequentRecordCount }} 条记录。</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <div class="review-workspace">
    <Card role="region" aria-labelledby="reflection-title" class="card reflection-card">
      <CardHeader class="section-head reflection-head">
        <div><p class="section-eyebrow">留一点时间给自己</p><CardTitle as="h2" id="reflection-title">写下这一周</CardTitle><CardDescription>每周单独保存，切换周次后还可以回来继续补充。</CardDescription></div>
        <span class="save-status" role="status" aria-live="polite"><i :class="{ saving: reflectionStatus === '正在保存…' }"></i>{{ reflectionStatus }}</span>
      </CardHeader>
      <CardContent>
      <form class="reflection-form" @submit.prevent="saveReflectionNow">
        <FieldGroup class="reflection-fields grid grid-cols-2 gap-4">
          <Field v-for="field in visibleReflectionFields" :key="field.key" class="reflection-field" :class="{ 'reflection-next': field.key === 'next' }">
            <FieldLabel :for="'reflection-' + field.key">{{ field.title }}</FieldLabel>
            <FieldDescription :id="'reflection-help-' + field.key">{{ field.description }}</FieldDescription>
            <textarea :id="'reflection-' + field.key" :aria-label="field.title" v-model="reflectionDraft[field.key]" rows="3" maxlength="1000" :placeholder="field.placeholder" :aria-describedby="'reflection-help-' + field.key + ' reflection-count-' + field.key" />
            <small :id="'reflection-count-' + field.key" class="reflection-count">{{ reflectionLength[field.key] }}/1000</small>
          </Field>
        </FieldGroup>
        <Button type="button" variant="ghost" :aria-expanded="reflectionExpanded" @click="reflectionExpanded = !reflectionExpanded">{{ reflectionExpanded ? '收起其他反思' : '补充本周收获与心得' }}</Button>
        <div class="reflection-footer">
          <p>内容会纳入账号同步与本机备份。</p>
          <Button type="submit" :disabled="!isReflectionDirty">保存本周复盘</Button>
        </div>
      </form>
      </CardContent>
    </Card>

    <Card role="region" aria-labelledby="next-week-title" class="card next-week-card">
      <CardHeader class="section-head">
        <div><p class="section-eyebrow">接下来的一周</p><CardTitle as="h2" id="next-week-title">{{ reviewOffset === 0 ? '下周先看' : '下一周先看' }}</CardTitle><CardDescription>待办、日程、重要日期与固定账单，按时间排好。</CardDescription></div>
        <Badge variant="secondary" class="count-badge">{{ review.nextWeek.length }} 项</Badge>
      </CardHeader>
      <CardContent>
      <ul v-if="review.nextWeek.length" class="highlight-list">
        <li v-for="item in review.nextWeek" :key="item.key">
          <router-link class="highlight-link" :to="highlightRoute(item)">
            <span class="highlight-kind">{{ highlightKind(item) }}</span>
            <span class="highlight-copy"><b>{{ item.title }}</b><small v-if="item.timeLabel">{{ item.timeLabel }}</small></span>
            <time>{{ item.date.slice(5) }}<template v-if="item.time"> {{ item.time }}</template></time>
            <span class="highlight-arrow" aria-hidden="true">→</span>
          </router-link>
        </li>
      </ul>
      <Empty v-else class="review-empty">
        <EmptyHeader><EmptyTitle>这一周目前没有待安排的事项</EmptyTitle><EmptyDescription>可以先留白，也可以补充一个轻量计划。</EmptyDescription></EmptyHeader>
        <Button as-child variant="outline" size="sm"><router-link to="/tasks">查看待办</router-link></Button>
      </Empty>
      </CardContent>
    </Card>

    </div>

    <details class="review-analysis">
      <summary><span>学习节奏分析</span><span class="analysis-hint">{{ hasAnalysisSamples ? '完成节奏、逾期、专注与心情' : '积累记录后查看趋势' }}</span><ChevronDown aria-hidden="true" /></summary>
    <section class="review-insights" aria-label="学习节奏分析">
      <Card role="article" class="card insight-card">
        <CardHeader class="section-head"><div><p class="section-eyebrow">持续性</p><CardTitle as="h2">16 周完成节奏</CardTitle><CardDescription>完成率 = 已完成 ÷（已完成 + 到期未完成）。</CardDescription></div><Badge variant="secondary" class="count-badge">{{ rhythm.recorded }} 周有记录</Badge></CardHeader>
        <CardContent>
        <div v-if="hasTaskSamples" class="rhythm-grid" role="list" :aria-label="`截至${weekLabel}的最近 16 周待办完成率`">
          <div v-for="week in rhythm.weeks" :key="week.startDate" class="rhythm-cell" :class="[`heat-${week.level}`, { empty: week.empty, current: week.isCurrent }]" role="listitem" :aria-label="`${week.label}，${weekRangeLabel(week)}${week.isCurrent ? '，所选周' : ''}`" :title="`${week.label} · ${weekRangeLabel(week)}`">
            <small>{{ week.startDate.slice(5) }}</small><b>{{ week.empty ? '—' : `${week.rate}%` }}</b>
          </div>
        </div>
        <Empty v-else><EmptyHeader><EmptyTitle>还没有完成节奏记录</EmptyTitle><EmptyDescription>完成或到期待办后，这里会显示每周进展。</EmptyDescription></EmptyHeader></Empty>
        <div v-if="hasTaskSamples" class="heat-legend"><span>低</span><i class="heat-0"></i><i class="heat-1"></i><i class="heat-2"></i><i class="heat-3"></i><i class="heat-4"></i><span>高</span><span class="heat-empty-key">— 无待办记录</span></div>
        </CardContent>
      </Card>

      <Card role="article" class="card insight-card">
        <CardHeader class="section-head"><div><p class="section-eyebrow">任务负荷</p><CardTitle as="h2">完成率与逾期</CardTitle><CardDescription>折线表示完成率，红色区域表示逾期存量；补完后会从后续周的存量中扣除。</CardDescription></div><Badge variant="secondary" class="count-badge">近 16 周</Badge></CardHeader>
        <CardContent>
        <svg v-if="hasTaskSamples" class="trend-chart" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" :aria-label="`最近 16 周待办完成率折线，当前仍逾期 ${completionTrend.currentBacklog} 项`">
          <path v-if="trendGeometry.area" class="trend-area" :d="trendGeometry.area" />
          <path v-if="trendGeometry.band" class="trend-backlog" :d="trendGeometry.band" />
          <polyline v-if="trendGeometry.line" class="trend-line" :points="trendGeometry.line" />
        </svg>
        <Empty v-else><EmptyHeader><EmptyTitle>暂无任务负荷样本</EmptyTitle><EmptyDescription>有到期或完成记录后，再比较完成率与逾期。</EmptyDescription></EmptyHeader></Empty>
        <div v-if="hasTaskSamples" class="trend-legend"><span><i class="legend-rate"></i>完成率</span><span><i class="legend-backlog"></i>逾期存量</span><b>{{ reviewOffset === 0 ? '当前' : '所选周末' }}逾期 {{ completionTrend.currentBacklog }} 项 · 新增逾期 {{ completionTrend.totalMissed }} 项</b></div>
        <div v-if="hasTaskSamples" class="trend-axis"><span>{{ completionTrend.points[0]?.startDate?.slice(5) }}</span><span>完成率 0–100% · 逾期 0–{{ maxTrendBacklog }} 项</span><span>{{ weekRangeLabel(rhythm.weeks.at(-1)) }}</span></div>
        </CardContent>
      </Card>

      <Card role="article" class="card insight-card">
        <CardHeader class="section-head"><div><p class="section-eyebrow">精力分布</p><CardTitle as="h2">专注时段</CardTitle><CardDescription>按开始时间统计 24 小时分布；跨小时的会话记在开始时段。</CardDescription></div><Badge variant="secondary" class="count-badge">{{ focusHours.totalMinutes }} 分钟</Badge></CardHeader>
        <CardContent>
        <div v-if="hasFocusSamples" class="focus-hour-chart" role="img" :aria-label="`24 小时专注时长分布，共 ${focusHours.totalSessions} 个有效会话`">
          <div v-for="bucket in focusHours.buckets" :key="bucket.hour" class="hour-column" :title="`${String(bucket.hour).padStart(2, '0')}:00 · ${bucket.minutes} 分钟 · ${bucket.sessions} 次`">
            <span class="hour-track"><i :style="{ height: maxFocusSeconds ? `${(bucket.seconds / maxFocusSeconds) * 100}%` : '0%' }"></i></span>
            <small>{{ bucket.hour % 6 === 0 ? String(bucket.hour).padStart(2, '0') : '' }}</small>
          </div>
        </div>
        <p v-if="focusHours.totalSessions" class="insight-note">最多在 <b>{{ peakHourLabel }}</b> 开始专注 · {{ focusHours.totalSessions }} 个有效会话<template v-if="focusHours.skippedSessions"> · {{ focusHours.skippedSessions }} 条无效或零时长记录未计</template></p>
        <Empty v-else><EmptyHeader><EmptyTitle>还没有可统计的专注时长记录</EmptyTitle><EmptyDescription>完成一次专注后，可以在这里查看投入时段。</EmptyDescription></EmptyHeader><Button as-child variant="outline" size="sm"><router-link to="/">开始专注</router-link></Button></Empty>
        </CardContent>
      </Card>

      <Card role="article" class="card insight-card">
        <CardHeader class="section-head"><div><p class="section-eyebrow">状态与投入</p><CardTitle as="h2">心情 × 专注</CardTitle><CardDescription>每周心情分布与专注分钟并排，颜色表示当周主导心情。</CardDescription></div><Badge variant="secondary" class="count-badge">{{ moodFocus.moodWeeks }} 周有心情</Badge></CardHeader>
        <CardContent>
        <div v-if="hasMoodSamples" class="mood-focus-grid" role="list" :aria-label="`截至${weekLabel}的最近 16 周心情与专注对照`">
          <div v-for="week in moodFocus.weeks" :key="week.startDate" class="mood-focus-cell" :class="`mood-${week.dominant || 'none'}`" role="listitem" :aria-label="`${weekRangeLabel(week)}，心情 ${week.moodDays ? `${moodName(week.dominant)}，晴 ${week.sunny} 天、多云 ${week.cloudy} 天、低落 ${week.rain} 天` : '未记录'}，专注 ${week.focusMinutes} 分钟`" :title="`${weekRangeLabel(week)} · ${week.label}`">
            <small>{{ week.startDate.slice(5) }}</small><b>{{ moodName(week.dominant) }}</b>
            <span class="mood-focus-track"><i :style="{ height: maxMoodFocusMinutes ? `${(week.focusMinutes / maxMoodFocusMinutes) * 100}%` : '0%' }"></i></span>
            <small>{{ week.focusMinutes }}′</small>
          </div>
        </div>
        <Empty v-else><EmptyHeader><EmptyTitle>还没有心情与专注记录</EmptyTitle><EmptyDescription>在今天页记录心情，积累记录后查看对照。</EmptyDescription></EmptyHeader></Empty>
        <p v-if="hasMoodSamples" class="insight-note">{{ moodFocusSummary.text }}</p>
        </CardContent>
      </Card>
    </section>
    </details>
  </div>
</template>

<style scoped>
.review-page { display: flex; flex-direction: column; gap: var(--space-4); }
.review-page-head { align-items: center; margin-bottom: 0; }
.review-eyebrow, .section-eyebrow { margin: 0 0 5px; color: var(--primary); font-size: var(--fs-10-5); font-weight: var(--fw-800); letter-spacing: .07em; }
.review-head-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.week-switcher { min-height: 42px; display: inline-flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--card); box-shadow: var(--shadow-sm); }
.week-switcher-label { min-width: 150px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-650); text-align: center; font-variant-numeric: tabular-nums; }
.review-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; border: 1px solid var(--border); border-radius: var(--radius-surface); background-color: var(--glass-surface); backdrop-filter: var(--glass-filter); box-shadow: var(--glass-shadow); }
.review-card { min-width: 0; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; padding: 16px 20px; }
.metric-heading { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.review-kicker { color: var(--ink-faint); font-size: var(--fs-12); font-weight: var(--fw-750); }
.metric-icon { color: var(--primary); font-size: var(--fs-20); line-height: 1; }
.metric-value { max-width: 100%; color: var(--text); font-size: var(--fs-29); font-weight: var(--fw-900); letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
.metric-value small { margin-left: 5px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-600); letter-spacing: 0; }
.metric-money { overflow-wrap: anywhere; font-size: clamp(18px, 2vw, 25px); }
.review-card > span, .review-card > small { color: var(--ink-soft); font-size: var(--fs-11-5); line-height: 1.45; }
.review-primary { border-color: color-mix(in srgb, var(--primary) 32%, var(--border)); background: linear-gradient(145deg, var(--primary-soft), var(--card) 88%); }
.metric-progress { width: 100%; height: 7px; overflow: hidden; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--primary) 12%, var(--card)); }
.metric-progress span { height: 100%; display: block; border-radius: inherit; background: var(--primary); transition: width var(--dur-slow) var(--ease-standard); }
.metric-foot { width: 100%; display: flex; justify-content: space-between; gap: 8px; color: var(--ink-soft); font-size: var(--fs-10-5); }
.metric-warning { margin-top: 2px; color: var(--warning); font-size: var(--fs-10-5); line-height: 1.4; }
.mood-distribution { width: 100%; height: 7px; display: flex; gap: 2px; overflow: hidden; border-radius: var(--radius-pill); background: var(--bg-tint); }
.mood-segment { min-width: 0; border-radius: var(--radius-pill); }
.mood-segment.sunny { background: var(--success); }
.mood-segment.cloudy { background: var(--warning); }
.mood-segment.rain { background: var(--primary); }
.review-workspace { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-4); }
.last-year-card { width: 100%; padding-inline: 0; box-shadow: none; }
.last-year-card .section-head { margin-bottom: 0; }
.last-year-metrics { display: flex; flex-wrap: wrap; gap: clamp(24px, 8vw, 88px); }
.last-year-metrics > div { display: flex; align-items: baseline; gap: 7px; }
.last-year-metrics strong { color: var(--text); font-size: var(--fs-29); font-weight: var(--fw-800); font-variant-numeric: tabular-nums; }
.last-year-metrics span, .last-year-sentence { color: var(--ink-soft); font-size: var(--fs-11-5); }
.last-year-sentence { margin-top: 12px; line-height: 1.55; }
.last-year-empty { min-height: 0; margin: 0; padding: 18px 20px; border: 1px dashed var(--border); border-radius: var(--radius-surface); background: var(--bg-tint); }
.reflection-card { flex: 1.65 1 480px; }
.next-week-card { flex: 1 1 300px; }
.next-week-card, .reflection-card { min-width: 0; padding-inline: 0; box-shadow: none; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.section-head .section-eyebrow { margin-bottom: 4px; }
.highlight-list { display: flex; flex-direction: column; gap: 6px; margin: 15px 0 0; padding: 0; list-style: none; }
.highlight-list li { min-width: 0; border: 1px solid transparent; border-radius: var(--radius-9); background: var(--bg-tint); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.highlight-list li:hover { border-color: var(--border-strong); background: var(--card); }
.highlight-link { min-height: 48px; display: grid; grid-template-columns: 68px minmax(0, 1fr) auto 16px; align-items: center; gap: 10px; padding: 7px 10px; color: inherit; text-decoration: none; }
.highlight-kind { justify-self: start; padding: 4px 7px; border-radius: var(--radius-6); color: var(--primary); background: var(--primary-soft); font-size: var(--fs-10-5); font-weight: var(--fw-700); }
.highlight-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.highlight-copy b { overflow: hidden; font-size: var(--fs-12-5); font-weight: var(--fw-650); text-overflow: ellipsis; white-space: nowrap; }
.highlight-copy small { overflow: hidden; color: var(--ink-faint); font-size: var(--fs-10-5); text-overflow: ellipsis; white-space: nowrap; }
.highlight-link time { color: var(--ink-faint); font-size: var(--fs-11); font-variant-numeric: tabular-nums; white-space: nowrap; }
.highlight-arrow { color: var(--ink-faint); font-size: var(--fs-14); text-align: right; }
.review-empty { min-height: 0; margin-top: 0; }
.reflection-head { margin-bottom: 0; }
.save-status { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; color: var(--ink-faint); font-size: var(--fs-11); }
.save-status i { width: 7px; height: 7px; border-radius: var(--radius-circle); background: var(--success); }
.save-status i.saving { background: var(--primary); }
.reflection-form { display: flex; flex-direction: column; gap: 16px; }
.reflection-next { grid-column: 1 / -1; }
.reflection-field { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.reflection-field textarea { width: 100%; min-height: 88px; resize: vertical; border-color: var(--ui-input); border-radius: var(--radius-control); background: var(--card); font-size: var(--fs-body); line-height: 1.6; }
.reflection-field textarea::placeholder { color: var(--ink-faint); opacity: .85; }
.reflection-count { align-self: flex-end; color: var(--ink-faint); font-size: var(--fs-aux); font-variant-numeric: tabular-nums; }
.reflection-footer { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 2px; }
.reflection-footer p { color: var(--ink-faint); font-size: var(--fs-aux); }
.review-insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.insight-card { min-width: 0; padding-inline: 0; box-shadow: none; }
.rhythm-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin-top: 15px; }
.rhythm-cell { min-width: 0; min-height: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 1px solid transparent; border-radius: var(--radius-8); color: var(--ink); background: color-mix(in srgb, var(--success) 10%, var(--card)); }
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
.trend-chart { display: block; width: 100%; height: 132px; margin-top: 13px; overflow: visible; background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(25% - 1px), var(--border) 25%); border-bottom: 1px solid var(--border); }
.trend-area { fill: color-mix(in srgb, var(--primary) 9%, transparent); }
.trend-backlog { fill: color-mix(in srgb, var(--danger) 28%, transparent); }
.trend-line { fill: none; stroke: var(--primary); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.trend-legend { flex-wrap: wrap; row-gap: 8px; }
.trend-legend span { display: inline-flex; align-items: center; gap: 4px; }
.trend-legend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; }
.legend-rate { background: var(--primary); }
.legend-backlog { background: color-mix(in srgb, var(--danger) 40%, transparent); }
.trend-legend b { margin-left: auto; color: var(--ink-soft); font-size: var(--fs-10-5); }
.trend-axis { justify-content: space-between; margin-top: 4px; }
.focus-hour-chart { height: 104px; display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); align-items: end; gap: 3px; margin-top: 15px; }
.hour-column { height: 100%; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: end; gap: 5px; }
.hour-track { width: 100%; height: 78px; display: flex; align-items: end; overflow: hidden; border-radius: 3px 3px 0 0; background: var(--bg-tint); }
.hour-track i { width: 100%; min-height: 0; border-radius: 3px 3px 0 0; background: linear-gradient(0deg, var(--brand-grad-a), var(--brand-grad-b)); }
.hour-column small { height: 12px; color: var(--ink-faint); font-size: 8px; }
.insight-note { margin-top: 10px; color: var(--ink-soft); font-size: var(--fs-11-5); line-height: 1.55; }
.mood-focus-grid { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 5px; margin-top: 13px; }
.mood-focus-cell { min-width: 0; min-height: 88px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px; border: 1px solid transparent; border-radius: var(--radius-8); background: var(--bg-tint); }
.mood-focus-cell > small { color: var(--ink-faint); font-size: var(--fs-9-5); }
.mood-focus-cell > b { max-width: 100%; overflow: hidden; color: var(--ink-soft); font-size: var(--fs-9-5); text-overflow: ellipsis; white-space: nowrap; }
.mood-focus-track { width: 55%; height: 38px; display: flex; align-items: end; background: color-mix(in srgb, var(--border) 60%, transparent); }
.mood-focus-track i { width: 100%; min-height: 0; border-radius: 3px 3px 0 0; background: var(--primary); }
.mood-sunny .mood-focus-track i { background: var(--success); }
.mood-cloudy .mood-focus-track i { background: var(--warning); }
.mood-rain .mood-focus-track i { background: var(--primary); }
.mood-none .mood-focus-track i { background: var(--ink-faint); }
@media (max-width: 900px) {
  .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-insights, .reflection-form { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .review-page-head { align-items: flex-start; }
  .review-head-actions { width: 100%; justify-content: flex-start; }
  .week-switcher { flex: 1; justify-content: space-between; }
  .week-switcher-label { min-width: 0; flex: 1; }
  .review-card { padding: 14px; }
  .metric-value { font-size: var(--fs-26); }
  .metric-money { font-size: clamp(16px, 6vw, 22px); }

  .highlight-link { grid-template-columns: 58px minmax(0, 1fr) auto; gap: 8px; }
  .highlight-arrow { display: none; }
    .reflection-footer { align-items: flex-start; flex-direction: column; }
  .reflection-footer .btn { width: 100%; }

  .rhythm-grid, .mood-focus-grid { gap: 4px; }
  .rhythm-cell { min-height: 44px; }
  .trend-legend b { width: 100%; margin-left: 0; }
}
@media (max-width: 360px) {
  .review-grid { grid-template-columns: 1fr; }
  .review-card { min-height: auto; }
  .week-switcher { flex-basis: 100%; }
}

.review-analysis > summary { display: flex; align-items: center; gap: 12px; min-height: 48px; cursor: pointer; font-size: var(--fs-16); font-weight: var(--fw-600); }
.review-analysis > summary svg { margin-left: auto; width: var(--icon-size); height: var(--icon-size); }
.review-analysis[open] > summary svg { transform: rotate(180deg); }
.analysis-hint { color: var(--ink-faint); font-size: var(--fs-aux); font-weight: var(--fw-400); }
.review-insights { padding-top: 12px; }
.review-card + .review-card { border-left: 1px solid var(--border); }
.review-card > span, .review-card > small, .metric-foot, .metric-warning { font-size: var(--fs-aux); }
.metric-value { font-size: var(--fs-23); font-weight: var(--fw-700); }
@media (min-width: 901px) { .review-page > :deep(.learning-navigation) { display: none; } }
@media (max-width: 760px) { .reflection-fields { grid-template-columns: 1fr !important; } .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .review-card:nth-child(3) { border-left: 0; } .review-card:nth-child(n+3) { border-top: 1px solid var(--border); } .analysis-hint { display: none; } }
</style>
