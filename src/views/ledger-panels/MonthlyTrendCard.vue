<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { buildMonthlyTrendScale, monthlyTrendBarGeometry, shiftTrendMonth, summarizeMonthlyTrend } from '../../composables/monthlyTrendChart.js'
import { formatNumber } from '../../composables/intlFormatters.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  months: { type: /** @type {import('vue').PropType<import('../../composables/monthlyTrendChart.js').MonthlyTrendRow[]>} */ (Array), default: () => [] },
  reviewMonth: { type: String, default: '' },
  todayMonth: { type: String, default: '' },
  earliestMonth: { type: String, default: '' },
  currency: { type: String, default: 'CNY' },
})
const emit = defineEmits(['jump-to-month', 'range-end-change'])
const trendRange = ref(6)
const previewMonth = ref('')
/** @type {import('vue').Ref<HTMLElement | null>} */
const monthViewport = ref(null)
const visibleMonths = computed(() => props.months.slice(-trendRange.value))
const endMonth = computed(() => visibleMonths.value.at(-1)?.month || props.todayMonth)
const startMonth = computed(() => visibleMonths.value[0]?.month || endMonth.value)
const periodLabel = computed(() => `${startMonth.value.replace('-', '.')} — ${endMonth.value.replace('-', '.')}`)
const totals = computed(() => summarizeMonthlyTrend(visibleMonths.value))
const hasLongAmounts = computed(() => [totals.value.expense, totals.value.income, totals.value.balance].some((amount) => money(amount).length > 14))
const hasData = computed(() => totals.value.count > 0)
const hasRefundSurplus = computed(() => visibleMonths.value.some((row) => Number(row.expense) < 0))
const scale = computed(() => buildMonthlyTrendScale(visibleMonths.value))
const activeMonth = computed(() => visibleMonths.value.find((row) => row.month === previewMonth.value)
  || visibleMonths.value.find((row) => row.month === props.reviewMonth)
  || visibleMonths.value.at(-1))
const activeTotals = computed(() => summarizeMonthlyTrend(activeMonth.value ? [activeMonth.value] : []))
const canGoBack = computed(() => Boolean(shiftTrendMonth(endMonth.value, -trendRange.value))
  && startMonth.value > (props.earliestMonth || props.todayMonth))
const canGoForward = computed(() => endMonth.value < props.todayMonth)
const missingRates = computed(() => [...new Set(visibleMonths.value.flatMap((row) => row.missingRates || []))])
const currencyNote = computed(() => {
  if (!visibleMonths.value.some((row) => row.hasForeign)) return `金额单位：${props.currency}`
  const date = visibleMonths.value.find((row) => row.ratesUpdatedAt)?.ratesUpdatedAt || '未记录日期'
  return `按手动汇率折算到 ${props.currency} · 汇率日期 ${date}`
})
const comparisonNote = computed(() => {
  const row = activeMonth.value
  if (!row) return ''
  if (row.month === props.todayMonth) return '本月进行中，金额持续更新'
  const previous = props.months.find((item) => item.month === shiftTrendMonth(row.month, -1))
  if (row.excludedCount || previous?.excludedCount) return '有记录缺少汇率，暂不比较上月'
  if (!row.count) return '这个月暂无收支记录'
  if (!previous?.count) return '上月暂无已计入记录'
  const delta = Math.round(Number(row.expense) * 100) - Math.round(Number(previous.expense) * 100)
  if (!delta) return '支出净额与上月持平'
  return `较上月支出净额${delta > 0 ? '增加' : '减少'} ${money(Math.abs(delta) / 100)}`
})
const emptyMessage = computed(() => totals.value.excludedCount
  ? '这段时间的记录缺少汇率，补齐后即可查看走势'
  : '这段时间还没有收支记录')

function money(value) {
  return moneyWithCurrency(value, props.currency)
}
function fullMonth(month) {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`
}
function yearLabel(row, index) {
  return index === 0 || visibleMonths.value[index - 1]?.month.slice(0, 4) !== row.month.slice(0, 4)
    ? row.month.slice(0, 4) : ''
}
function monthLabel(row) {
  const excluded = Number(row.excludedCount) || 0
  return `${fullMonth(row.month)}，支出净额 ${money(row.expense)}，收入 ${money(row.income)}，结余 ${money(summarizeMonthlyTrend([row]).balance)}，已计入 ${Number(row.count) || 0} 笔${excluded ? `，另有 ${excluded} 笔缺少汇率未计入` : ''}，点按查看该月回顾`
}
function barStyle(value) {
  const geometry = monthlyTrendBarGeometry(value, scale.value)
  if (Number(value) < 0) return { top: `${100 - scale.value.zeroPosition}%`, height: `${geometry.height}%`, minHeight: '2px' }
  return { bottom: `${geometry.bottom}%`, height: `${geometry.height}%`, minHeight: Number(value) ? '2px' : '0' }
}
function tickPosition(value) {
  return ((value - scale.value.min) / (scale.value.max - scale.value.min)) * 100
}
function tickLabel(value) {
  const magnitude = Math.abs(value)
  const divisor = magnitude >= 100_000_000 ? 100_000_000 : magnitude >= 10_000 ? 10_000 : 1
  const unit = divisor === 100_000_000 ? '亿' : divisor === 10_000 ? '万' : ''
  return `${formatNumber(value / divisor, { maximumFractionDigits: divisor > 1 ? 2 : 4 })}${unit}`
}
function shiftPeriod(direction) {
  if (direction < 0 ? !canGoBack.value : !canGoForward.value) return
  const target = shiftTrendMonth(endMonth.value, direction * trendRange.value)
  emit('range-end-change', direction > 0 && target > props.todayMonth ? props.todayMonth : target)
}
function setRange(range) {
  const containedSelection = visibleMonths.value.some((row) => row.month === props.reviewMonth)
  trendRange.value = range
  if (containedSelection && props.reviewMonth < startMonth.value) emit('range-end-change', props.reviewMonth)
}
function selectMonth(month) {
  previewMonth.value = ''
  emit('jump-to-month', month)
}
function resetPreview(event) {
  if (event?.type === 'focusout' && event.currentTarget.contains(event.relatedTarget)) return
  previewMonth.value = ''
}
function onMonthKeydown(event, index) {
  const last = visibleMonths.value.length - 1
  const next = event.key === 'ArrowRight' ? Math.min(last, index + 1)
    : event.key === 'ArrowLeft' ? Math.max(0, index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
  if (next === null) return
  event.preventDefault()
  monthViewport.value?.querySelectorAll('button')[next]?.focus()
}
async function revealSelectedMonth() {
  await nextTick()
  const viewport = monthViewport.value
  if (!viewport) return
  const buttons = [...viewport.querySelectorAll('button')]
  const target = buttons.find((button) => button.dataset.month === props.reviewMonth) || buttons.at(-1)
  if (target) viewport.scrollLeft = Math.max(0, target.offsetLeft - (viewport.clientWidth - target.clientWidth) / 2)
}
watch(visibleMonths, () => {
  previewMonth.value = ''
  revealSelectedMonth()
}, { immediate: true, flush: 'post' })
watch(() => props.reviewMonth, (month) => {
  previewMonth.value = ''
  if (month && (month < startMonth.value || month > endMonth.value)) emit('range-end-change', month)
  revealSelectedMonth()
})
</script>

<template>
  <section class="review-month-trend card" aria-labelledby="review-month-trend-title" @mouseleave="resetPreview" @focusout="resetPreview">
    <div class="trend-head">
      <div class="trend-heading">
        <span class="trend-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 5v14h16M7 14l4-5 4 3 5-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
        <div><h2 id="review-month-trend-title">多月收支走势</h2><p>把每个月的收入、支出与结余放在一起看</p></div>
      </div>
      <span v-if="endMonth === todayMonth" class="trend-current">含本月 · 进行中</span>
    </div>

    <div class="trend-toolbar">
      <div class="trend-range" role="group" aria-label="走势月份范围">
        <button v-for="range in [6, 12]" :key="range" type="button" :aria-pressed="trendRange === range" @click="setRange(range)">{{ range }} 个月</button>
      </div>
      <div class="trend-period" role="group" aria-label="走势区间翻页">
        <button class="trend-page tap-target" type="button" :aria-label="`查看前 ${trendRange} 个月`" :disabled="!canGoBack" @click="shiftPeriod(-1)">‹</button>
        <span class="trend-period-label" aria-live="polite">{{ periodLabel }}</span>
        <button class="trend-page tap-target" type="button" :aria-label="`查看后 ${trendRange} 个月`" :disabled="!canGoForward" @click="shiftPeriod(1)">›</button>
      </div>
      <button class="trend-reset tap-target" type="button" :disabled="!canGoForward" @click="emit('range-end-change', todayMonth)">返回近期</button>
    </div>

    <dl class="trend-summary" :class="{ 'has-long-amount': hasLongAmounts }" aria-label="所选区间收支汇总">
      <div class="trend-stat expense"><dt><i class="trend-expense-key" aria-hidden="true"></i>区间支出净额</dt><dd :class="{ negative: totals.expense < 0 }">{{ money(totals.expense) }}</dd><small>月均 {{ money(totals.expense / (visibleMonths.length || 1)) }}</small></div>
      <div class="trend-stat income"><dt><i class="trend-income-key" aria-hidden="true"></i>区间收入</dt><dd>{{ money(totals.income) }}</dd><small>月均 {{ money(totals.income / (visibleMonths.length || 1)) }}</small></div>
      <div class="trend-stat balance"><dt>区间结余</dt><dd :class="{ negative: totals.balance < 0 }">{{ money(totals.balance) }}</dd><small>收入 − 支出净额</small></div>
    </dl>
    <p v-if="totals.excludedCount" class="trend-fx-warning" role="status">{{ missingRates.join('、') || '部分外币' }} 缺少汇率，{{ totals.excludedCount }} 笔未计入；上方汇总仅含已计入的记录。</p>

    <div class="trend-chart-caption" :class="{ 'is-year': trendRange === 12 }"><span>{{ currencyNote }}</span><small class="trend-scroll-hint">左右滑动查看月份</small></div>
    <div class="trend-chart-body" :class="{ 'is-empty': !hasData }">
      <div v-if="hasData" class="trend-axis" aria-hidden="true"><span v-for="tick in scale.ticks" :key="tick" :style="{ bottom: `${tickPosition(tick)}%` }">{{ tickLabel(tick) }}</span></div>
      <p v-if="!hasData" class="trend-empty">{{ emptyMessage }}<small>可切换区间，或点选月份查看回顾</small></p>
      <div ref="monthViewport" class="trend-viewport" :class="{ 'is-year': trendRange === 12 }">
        <div class="trend-plot" :style="{ '--trend-columns': visibleMonths.length || trendRange }">
          <div class="trend-grid" aria-hidden="true"><i v-for="tick in scale.ticks" :key="tick" :class="{ zero: tick === 0 }" :style="{ bottom: `${tickPosition(tick)}%` }"></i></div>
          <div class="monthly-trend-bars" role="group" aria-label="每月支出和收入">
            <button v-for="(row, index) in visibleMonths" :key="row.month" :data-month="row.month" type="button" class="trend-month" :class="{ selected: reviewMonth === row.month, preview: previewMonth === row.month }" :aria-pressed="reviewMonth === row.month" :aria-label="monthLabel(row)" @click="selectMonth(row.month)" @mouseenter="previewMonth = row.month" @focus="previewMonth = row.month" @keydown="onMonthKeydown($event, index)">
              <span class="trend-month-bars" aria-hidden="true"><i class="trend-bar trend-expense" :class="{ 'trend-expense-negative': Number(row.expense) < 0 }" :style="barStyle(row.expense)"></i><i class="trend-bar trend-income" :style="barStyle(row.income)"></i></span>
              <span class="trend-month-label"><b>{{ Number(row.month.slice(5)) }}月</b><small>{{ yearLabel(row, index) }}</small></span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div class="trend-key" aria-label="图例"><span><i class="trend-expense-key" aria-hidden="true"></i>支出净额</span><span><i class="trend-income-key" aria-hidden="true"></i>收入</span><span v-if="hasRefundSurplus"><i class="trend-refund-key" aria-hidden="true"></i>退款超出支出</span><small>点选月份查看回顾</small></div>

    <div v-if="activeMonth" class="trend-glance">
      <div class="trend-glance-heading"><b>{{ fullMonth(activeMonth.month) }}</b><span>{{ activeMonth.count }} 笔已计入<template v-if="activeMonth.excludedCount"> · {{ activeMonth.excludedCount }} 笔未计入</template></span><button v-if="activeMonth.month !== reviewMonth" class="trend-detail-link tap-target" type="button" @click="selectMonth(activeMonth.month)">查看月度回顾 <span aria-hidden="true">→</span></button><small v-else class="trend-selected-tag">当前回顾</small></div>
      <dl class="trend-month-summary"><div><dt>支出净额</dt><dd :class="{ negative: activeTotals.expense < 0 }">{{ money(activeTotals.expense) }}</dd></div><div><dt>收入</dt><dd>{{ money(activeTotals.income) }}</dd></div><div><dt>结余</dt><dd :class="{ negative: activeTotals.balance < 0 }">{{ money(activeTotals.balance) }}</dd></div></dl>
      <p class="trend-comparison">{{ comparisonNote }}</p>
    </div>
    <p class="trend-method">支出按「我承担」份额统计，退款冲抵支出；柱形低于零线表示退款超过支出。月均按区间内的全部自然月计算。</p>
  </section>
</template>

<style scoped>
.review-month-trend { --trend-chart-height:208px; --trend-label-height:42px; min-width:0; margin-bottom:12px; padding:22px; }
.trend-head, .trend-heading { display:flex; align-items:center; gap:12px; }
.trend-head { justify-content:space-between; flex-wrap:wrap; }
.trend-heading { min-width:0; }
.trend-icon { display:grid; place-items:center; flex:none; width:38px; height:38px; color:var(--primary); border:1px solid var(--border); border-radius:var(--radius-11); background:var(--primary-soft); }
.trend-icon svg { width:23px; height:23px; }
.trend-heading h2 { margin:0; color:var(--ink); font-size:var(--fs-16); font-weight:var(--fw-750); }
.trend-heading p { margin:4px 0 0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.5; }
.trend-current { padding:5px 9px; color:var(--ink-soft); border:1px solid var(--border); border-radius:var(--radius-pill); font-size:var(--fs-10-5); white-space:nowrap; }
.trend-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin:20px 0 16px; }
.trend-range { display:flex; flex:none; gap:3px; padding:3px; border:1px solid var(--border); border-radius:var(--radius-10); background:var(--bg-tint); }
.trend-range button { min-width:68px; min-height:34px; padding:0 11px; color:var(--ink-soft); border:0; border-radius:var(--radius-7); background:transparent; font-size:var(--fs-12); cursor:pointer; }
.trend-range button[aria-pressed='true'] { color:var(--on-primary); background:var(--primary); box-shadow:var(--shadow-sm); }
.trend-period { display:flex; align-items:center; justify-content:center; gap:5px; margin-left:auto; }
.trend-page { flex:none; width:32px; height:34px; padding:0; color:var(--ink-soft); border:1px solid var(--border); border-radius:var(--radius-8); background:var(--card); font-size:var(--fs-23); cursor:pointer; }
.trend-period-label { color:var(--ink-soft); font-size:var(--fs-12); font-variant-numeric:tabular-nums; white-space:nowrap; }
.trend-reset { min-height:34px; padding:0 8px; color:var(--primary); border:0; border-radius:var(--radius-8); background:transparent; font-size:var(--fs-11-5); cursor:pointer; }
.trend-page:hover:not(:disabled), .trend-reset:hover:not(:disabled) { color:var(--primary); background:var(--primary-soft); }
.trend-page:disabled, .trend-reset:disabled { opacity:0.45; }
.trend-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:0 0 18px; }
.trend-stat { min-width:0; padding:13px 14px; border:1px solid var(--border); border-radius:var(--radius-11); background:var(--bg-tint); }
.trend-stat dt { display:flex; align-items:center; gap:6px; color:var(--ink-soft); font-size:var(--fs-11-5); }
.trend-stat dd { margin:9px 0 5px; color:var(--ink); font-size:clamp(16px,2.2vw,24px); font-weight:var(--fw-750); font-variant-numeric:tabular-nums; line-height:1.2; overflow-wrap:anywhere; }
.trend-stat.expense dd { color:var(--primary); }
.trend-stat.income dd { color:var(--success); }
.trend-stat small { display:block; color:var(--ink-soft); font-size:var(--fs-10-5); line-height:1.5; overflow-wrap:anywhere; }
.trend-stat dd.negative, .trend-month-summary dd.negative { color:var(--danger); }
.trend-fx-warning { margin:0 0 16px; padding:10px 12px; color:var(--ink-soft); border:1px solid var(--border); border-left:3px solid var(--warning); border-radius:var(--radius-8); background:var(--bg-tint); font-size:var(--fs-12); line-height:1.6; }
.trend-chart-caption { display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; margin-bottom:12px; color:var(--ink-faint); font-size:var(--fs-10-5); line-height:1.5; }
.trend-scroll-hint { display:none; font-size:inherit; }
.trend-chart-body { position:relative; display:grid; grid-template-columns:48px minmax(0,1fr); gap:9px; padding-top:5px; }
.trend-chart-body.is-empty { grid-template-columns:minmax(0,1fr); }
.trend-axis { position:relative; height:var(--trend-chart-height); color:var(--ink-faint); font-size:var(--fs-10-5); font-variant-numeric:tabular-nums; }
.trend-axis span { position:absolute; right:0; transform:translateY(50%); white-space:nowrap; }
.trend-viewport { min-width:0; overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain; scrollbar-width:thin; scrollbar-color:var(--border-strong) transparent; }
.trend-plot { position:relative; height:calc(var(--trend-chart-height) + var(--trend-label-height)); }
.trend-grid { position:absolute; inset:0 0 var(--trend-label-height); pointer-events:none; }
.trend-grid i { position:absolute; right:0; left:0; border-top:1px dashed var(--border); }
.trend-grid i.zero { border-top-style:solid; border-top-color:var(--border-strong); }
.monthly-trend-bars { position:relative; height:100%; display:grid; grid-template-columns:repeat(var(--trend-columns),minmax(0,1fr)); gap:8px; }
.trend-month { display:flex; min-width:0; align-items:stretch; flex-direction:column; padding:0 4px; color:var(--ink-soft); border:0; border-radius:var(--radius-8); background:transparent; cursor:pointer; transition:background var(--dur-fast) var(--ease-standard); }
.trend-month:hover, .trend-month.preview { background:var(--bg-tint); }
.trend-month.selected { color:var(--primary); background:var(--primary-soft); }
.trend-month:focus-visible { outline-offset:-2px; }
.trend-month-bars { position:relative; display:block; min-height:0; flex:1; width:100%; }
.trend-bar { position:absolute; width:clamp(7px,28%,22px); border-radius:var(--radius-4) var(--radius-4) 0 0; transition:height var(--dur-base) var(--ease-standard), bottom var(--dur-base) var(--ease-standard); }
.trend-expense { right:calc(50% + 2px); background:var(--primary); }
.trend-income { left:calc(50% + 2px); background:var(--success); }
.trend-expense-negative { border-radius:0 0 var(--radius-4) var(--radius-4); background:var(--danger); }
.trend-month-label { display:flex; height:var(--trend-label-height); flex:none; flex-direction:column; align-items:center; justify-content:center; gap:3px; font-variant-numeric:tabular-nums; line-height:1.1; }
.trend-month-label b { font-size:var(--fs-11-5); font-weight:var(--fw-650); white-space:nowrap; }
.trend-month-label small { min-height:11px; color:var(--ink-soft); font-size:var(--fs-9); }
.trend-month.selected .trend-month-label b { padding:3px 6px; border-radius:var(--radius-5); color:var(--on-primary); background:var(--primary); }
.trend-empty { position:absolute; z-index:2; top:40%; left:50%; width:max-content; max-width:calc(100% - 24px); margin:0; padding:12px 16px; color:var(--ink-soft); border:1px solid var(--border); border-radius:var(--radius-11); background:var(--card); font-size:var(--fs-12); line-height:1.6; text-align:center; transform:translate(-50%,-50%); pointer-events:none; }
.trend-empty small { display:block; color:var(--ink-faint); font-size:var(--fs-10-5); }
.trend-key { display:flex; align-items:center; flex-wrap:wrap; gap:9px 18px; margin:12px 0 16px; color:var(--ink-soft); font-size:var(--fs-11); }
.trend-key>span { display:inline-flex; align-items:center; gap:6px; }
.trend-key>small { margin-left:auto; color:var(--ink-faint); font-size:var(--fs-10-5); }
.trend-expense-key, .trend-income-key, .trend-refund-key { display:inline-block; flex:none; width:8px; height:8px; border-radius:var(--radius-2); }
.trend-expense-key { background:var(--primary); }
.trend-income-key { background:var(--success); }
.trend-refund-key { background:var(--danger); }
.trend-glance { min-width:0; padding:14px 16px; border:1px solid var(--border); border-radius:var(--radius-11); background:var(--bg-tint); }
.trend-glance-heading { display:flex; align-items:center; flex-wrap:wrap; gap:7px 10px; }
.trend-glance-heading>b { color:var(--ink); font-size:var(--fs-13); }
.trend-glance-heading>span { color:var(--ink-soft); font-size:var(--fs-10-5); }
.trend-detail-link { display:inline-flex; align-items:center; gap:5px; margin-left:auto; min-height:28px; padding:0 4px; color:var(--primary); border:0; border-radius:var(--radius-5); background:transparent; font-size:var(--fs-11); cursor:pointer; }
.trend-selected-tag { margin-left:auto; padding:4px 7px; color:var(--primary); border:1px solid var(--border); border-radius:var(--radius-5); font-size:var(--fs-10); }
.trend-month-summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:12px 0 0; }
.trend-month-summary>div { min-width:0; }
.trend-month-summary dt { color:var(--ink-soft); font-size:var(--fs-10-5); }
.trend-month-summary dd { margin:5px 0 0; color:var(--ink); font-size:var(--fs-14); font-weight:var(--fw-700); font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.trend-comparison { margin:10px 0 0; color:var(--ink-soft); font-size:var(--fs-10-5); line-height:1.5; }
.trend-method { margin:12px 0 0; color:var(--ink-faint); font-size:var(--fs-10-5); line-height:1.7; }
@media (max-width:760px) {
  .review-month-trend { padding:18px; }
  .trend-toolbar { gap:10px 8px; }
  .trend-summary { gap:8px; }
  .trend-stat { padding:12px 10px; }
  .trend-stat dd { font-size:var(--fs-19); }
  .trend-viewport.is-year .trend-plot { min-width:calc(var(--trend-columns) * 44px); }
  .trend-viewport.is-year .monthly-trend-bars { gap:4px; }
  .trend-chart-caption.is-year .trend-scroll-hint { display:block; }
}
@media (max-width:520px) {
  .review-month-trend { --trend-chart-height:184px; padding:16px 12px; }
  .trend-icon { width:32px; height:32px; }
  .trend-heading { gap:9px; }
  .trend-heading h2 { font-size:var(--fs-15); }
  .trend-heading p { font-size:var(--fs-11); }
  .trend-current { margin-left:41px; }
  .trend-toolbar { margin-top:16px; }
  .trend-period { order:3; width:100%; margin-left:0; padding-top:2px; gap:12px; }
  .trend-period-label { flex:1; text-align:center; }
  .trend-reset { margin-left:auto; }
  .trend-summary { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:16px; }
  .trend-stat { padding:11px 12px; }
  .trend-stat dt { gap:4px; font-size:var(--fs-10-5); }
  .trend-stat dd { font-size:var(--fs-20); }
  .trend-stat small { font-size:var(--fs-10); }
  .trend-stat.balance { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; grid-column:1 / -1; gap:2px 12px; }
  .trend-stat.balance dd { grid-column:2; grid-row:1 / 3; margin:0; text-align:right; font-size:var(--fs-18); }
  .trend-stat.balance small { grid-column:1; }
  .trend-summary.has-long-amount { grid-template-columns:minmax(0,1fr); }
  .trend-summary.has-long-amount .trend-stat { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:2px 12px; }
  .trend-summary.has-long-amount .trend-stat dd { grid-column:2; grid-row:1 / 3; margin:0; text-align:right; font-size:var(--fs-16); }
  .trend-summary.has-long-amount .trend-stat small { grid-column:1 / -1; }
  .trend-summary.has-long-amount .trend-stat.balance small { grid-column:1; }
  .trend-chart-body { grid-template-columns:34px minmax(0,1fr); gap:6px; }
  .trend-axis { font-size:var(--fs-9); }
  .monthly-trend-bars { gap:3px; }
  .trend-month { padding:0 2px; }
  .trend-month-label b { font-size:var(--fs-11); }
  .trend-key { gap:8px 12px; }
  .trend-key>small { flex-basis:100%; margin-left:0; }
  .trend-glance { padding:12px; }
  .trend-month-summary { grid-template-columns:minmax(0,1fr); gap:8px; }
  .trend-month-summary>div { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
  .trend-month-summary dt { flex:none; }
  .trend-month-summary dd { margin:0; font-size:var(--fs-13); text-align:right; }
  .trend-glance-heading { min-height:30px; }
  .trend-method { font-size:var(--fs-10); }
}
@media (pointer:coarse) {
  .trend-range button { min-height:44px; }
  .trend-plot { min-width:calc(var(--trend-columns) * 44px); }
  .trend-scroll-hint { display:block; }
}
</style>
