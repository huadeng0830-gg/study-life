<script setup>
import { computed, ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import { catInfo } from '../../composables/ledger.js'
import { buildMonthlyTrendScale, monthlyTrendBarGeometry } from '../../composables/monthlyTrendChart.js'
import { moneyHero, moneyRow, moneyWithCurrency } from '../../utils/formatters.js'
import { formatNumber } from '../../composables/intlFormatters.js'

const props = defineProps({
  reviewLabel: { type: String, default: '' },
  reviewMonth: { type: String, default: '' },
  todayMonth: { type: String, default: '' },
  monthlyTrend: { type: Array, default: () => [] },
  trendCurrency: { type: String, default: 'CNY' },
  reviewCount: { type: Number, default: 0 },
  reviewTotal: { type: Number, default: 0 },
  monthlyReview: { type: Object, default: () => ({}) },
  mostFrequent: { type: Object, default: null },
  topCategory: { type: Object, default: null },
  maxSingle: { type: Object, default: null },
  maxSingleMine: { type: Number, default: null },
  reviewMyShareNote: { type: String, default: '' },
  reviewCategoryRows: { type: Array, default: () => [] },
  reviewCategorySum: { type: Number, default: 0 },
  visibleCategoryRows: { type: Array, default: () => [] },
  hiddenCategoryCount: { type: Number, default: 0 },
  expandedCategory: { type: String, default: '' },
  showAllReviewCats: { type: Boolean, default: false },
  categoryLimit: { type: Number, default: 5 },
  calendarCells: { type: Array, default: () => [] },
  selectedDay: { type: Number, default: null },
  selectedDayInfo: { type: Object, default: null },
  personalAmount: { type: Function, required: true },
  shiftMonth: { type: Function, required: true },
  exportLedgerCsv: { type: Function, required: true },
  exportLedgerXlsx: { type: Function, required: true },
  exportAllLedgerXlsx: { type: Function, required: true },
  revealReviewCategory: { type: Function, required: true },
  toggleReviewCategory: { type: Function, required: true },
  openDetail: { type: Function, required: true },
})

const emit = defineEmits(['selected-day-change', 'update:showAllReviewCats', 'jump-to-month'])

const trendRange = ref(6)
const visibleTrendMonths = computed(() => props.monthlyTrend.slice(-trendRange.value))
const trendScale = computed(() => buildMonthlyTrendScale(visibleTrendMonths.value))
const hasTrendData = computed(() => visibleTrendMonths.value.some((row) => Number(row.count) > 0))
const selectedTrendMonth = computed(() => visibleTrendMonths.value.find((row) => row.month === props.reviewMonth) || null)
const trendMissingRates = computed(() => [...new Set(visibleTrendMonths.value.flatMap((row) => row.missingRates || []))])
const trendExcludedCount = computed(() => visibleTrendMonths.value.reduce((sum, row) => sum + (Number(row.excludedCount) || 0), 0))
const trendFxDate = computed(() => visibleTrendMonths.value.find((row) => row.ratesUpdatedAt)?.ratesUpdatedAt || '未记录日期')
const trendCurrencyNote = computed(() => {
  const prefix = visibleTrendMonths.value.some((row) => row.hasForeign)
    ? `按手动汇率折算到 ${props.trendCurrency}（汇率日期 ${trendFxDate.value}）`
    : `金额单位：${props.trendCurrency}`
  return trendMissingRates.value.length
    ? `${prefix}；${trendMissingRates.value.join('、')} 缺少汇率，${trendExcludedCount.value} 笔未计入`
    : prefix
})

const trendEmptyMessage = computed(() => (trendExcludedCount.value
  ? '有外币记录暂缺汇率，补齐汇率后才会计入图表。'
  : '这段时间还没有收支记录。'))

function trendBarStyle(value) {
  const amount = Number(value) || 0
  const geometry = monthlyTrendBarGeometry(amount, trendScale.value)
  return {
    bottom: `${geometry.bottom}%`,
    height: `${geometry.height}%`,
    minHeight: amount ? '2px' : '0',
  }
}

function trendScalePosition(value) {
  const range = trendScale.value.max - trendScale.value.min
  return range ? ((value - trendScale.value.min) / range) * 100 : 0
}

function compactTrendTick(value) {
  const exact = moneyWithCurrency(value, props.trendCurrency)
  const numeric = exact.match(/-?[\d,]+(?:\.\d+)?$/)?.[0] || ''
  const prefix = numeric ? exact.slice(0, -numeric.length) : ''
  const magnitude = Math.abs(value)
  const divisor = magnitude >= 100_000_000 ? 100_000_000 : magnitude >= 10_000 ? 10_000 : 1
  const unit = divisor === 100_000_000 ? '亿' : divisor === 10_000 ? '万' : ''
  const scaled = value / divisor
  const digits = Math.abs(scaled) < 10 ? 1 : 0
  const formatted = formatNumber(scaled, { maximumFractionDigits: digits })
  return `${prefix}${formatted}${unit}`
}

function trendMonthLabel(month) {
  return `${Number(String(month).slice(5))}月`
}

function trendYearLabel(row, index) {
  const previous = visibleTrendMonths.value[index - 1]
  return index === 0 || previous?.month.slice(0, 4) !== row.month.slice(0, 4)
    ? `${row.month.slice(0, 4)}年`
    : ''
}

function trendMonthAriaLabel(row) {
  const excluded = Number(row.excludedCount) || 0
  const count = Number(row.count) || 0
  return `${row.month.slice(0, 4)}年${Number(row.month.slice(5))}月，支出净额 ${moneyWithCurrency(row.expense, props.trendCurrency)}，收入 ${moneyWithCurrency(row.income, props.trendCurrency)}，已计入 ${count} 笔${excluded ? `，另有 ${excluded} 笔缺少汇率未计入` : ''}，点按查看该月账本明细`
}

function selectTrendMonth(month) {
  emit('jump-to-month', month)
}

/* 月历圆点：按当天笔数给粗细（l1/l2/l3），纯展示、与账本口径无关。
   拆分时从 LedgerView 一并搬进来——它只依赖本面板自己的 reviewMonth。 */
function dotClass(cell) {
  if (!cell || !cell.count) return ''
  if (cell.count >= 4) return 'l3'
  if (cell.count >= 2) return 'l2'
  return 'l1'
}

/**
 * 月历格子的可访问名称。
 * 格子里只有「日期数字 + 一个圆点」，圆点的大小才表示当天账目多少。
 * 读屏用户听到的只有「5 按钮」：既不知道这是几月，也完全听不出这天有没有账。
 * 选中态另外用 aria-pressed 暴露——严格说一组互斥的日期选择更适合选中集语义，
 * 但这里是「点一下展开当天明细、再点一下收起」的可切换按钮，
 * aria-pressed 至少让「当前选中哪天」不再只存在于视觉样式里。
 */
function cellLabel(cell) {
  const month = parseInt(props.reviewMonth.slice(5), 10)
  const date = `${month}月${cell.day}日`
  return cell.count ? `${date}，${cell.count} 笔账目，合计 ${moneyRow(cell.total)}` : `${date}，无账目`
}
</script>

<template>
<!-- ================= 回顾 ================= -->
<div class="review-tab">
  <div class="month-nav card">
    <!-- 两个翻月按钮内部只有「‹」「›」：读屏会直接念符号，用户听不出这是在换月份，
         所以用 aria-label 说清方向；符号本身保持可见，不需要再加 aria-hidden。
         mn-btn 只有 32×32，一并标记 tap-target，让粗指针设备把它撑到 44px 命中区；
         禁用态交给 :disabled，读屏会自己读出「不可用」，不必写进名称。 -->
    <button class="mn-btn tap-target" aria-label="上一个月" @click="shiftMonth(-1)">‹</button>
    <b>{{ reviewLabel }}</b>
    <button class="mn-btn tap-target" aria-label="下一个月" :disabled="reviewMonth >= todayMonth" @click="shiftMonth(1)">›</button>
    <span class="review-export" role="group" aria-label="导出账单">
      <button class="btn btn-sm" type="button" @click="exportLedgerCsv">导出 CSV</button>
      <button class="btn btn-sm" type="button" @click="exportLedgerXlsx">导出 Excel</button>
      <!-- 「导出全部历史」：此前导出被硬编码成当月，想拿完整数据只能一个月一个月点。
           用 aria-label 说清范围，避免用户以为导出的还是当前月。 -->
      <button class="btn btn-sm" type="button" aria-label="导出全部历史账单，不限当前月份" @click="props.exportAllLedgerXlsx()">导出全部</button>
    </span>
  </div>

  <section class="review-month-trend card" aria-labelledby="review-month-trend-title">
    <div class="trend-head">
      <div><h2 id="review-month-trend-title" class="block-title">多月收支走势</h2><p>按月对比支出与收入；点任一月份切换到账本明细。</p></div>
      <div class="trend-range" role="group" aria-label="走势月份范围">
        <button type="button" :aria-pressed="trendRange === 6" @click="trendRange = 6">近 6 个月</button>
        <button type="button" :aria-pressed="trendRange === 12" @click="trendRange = 12">近 12 个月</button>
      </div>
    </div>
    <div v-if="selectedTrendMonth" class="trend-glance" aria-live="polite">
      <b>{{ selectedTrendMonth.month.slice(0, 4) }}年{{ Number(selectedTrendMonth.month.slice(5)) }}月</b>
      <span><i class="trend-expense-key"></i>支出净额 <strong>{{ moneyWithCurrency(selectedTrendMonth.expense, trendCurrency) }}</strong></span>
      <span><i class="trend-income-key"></i>收入 <strong>{{ moneyWithCurrency(selectedTrendMonth.income, trendCurrency) }}</strong></span>
      <small>已计入 {{ selectedTrendMonth.count }} 笔</small>
    </div>
    <div class="trend-chart-body" :class="{ 'is-empty': !hasTrendData }">
      <div v-if="hasTrendData" class="trend-axis" aria-hidden="true">
        <span v-for="tick in [...trendScale.ticks].reverse()" :key="tick" :style="{ bottom: `${trendScalePosition(tick)}%` }">{{ compactTrendTick(tick) }}</span>
      </div>
      <div class="trend-plot">
        <div v-if="hasTrendData" class="trend-grid" aria-hidden="true">
          <i v-for="tick in trendScale.ticks" :key="tick" :class="{ zero: tick === 0 }" :style="{ bottom: `${trendScalePosition(tick)}%` }"></i>
        </div>
        <p v-if="!hasTrendData" class="trend-empty">{{ trendEmptyMessage }}</p>
        <div class="monthly-trend-bars" role="group" aria-label="每月支出和收入" :style="{ gridTemplateColumns: `repeat(${trendRange}, minmax(0, 1fr))` }">
          <button v-for="(row, index) in visibleTrendMonths" :key="row.month" type="button" class="trend-month" :class="{ selected: reviewMonth === row.month }" :aria-pressed="reviewMonth === row.month" :aria-label="trendMonthAriaLabel(row)" :title="trendMonthAriaLabel(row)" @click="selectTrendMonth(row.month)">
            <span class="trend-month-bars" aria-hidden="true">
              <i class="trend-bar trend-expense" :class="{ 'trend-expense-negative': Number(row.expense) < 0 }" :style="trendBarStyle(row.expense)"></i>
              <i class="trend-bar trend-income" :style="trendBarStyle(row.income)"></i>
            </span>
            <span class="trend-month-label"><b>{{ trendMonthLabel(row.month) }}</b><small v-if="trendYearLabel(row, index)">{{ trendYearLabel(row, index) }}</small></span>
          </button>
        </div>
      </div>
    </div>
    <div class="trend-key"><span><i class="trend-expense-key"></i>支出净额</span><span><i class="trend-income-key"></i>收入</span><small>{{ trendCurrencyNote }}；支出按「我承担」份额统计，退款冲抵支出；低于零线表示退款超过支出。</small></div>
  </section>

  <EmptyState
    v-if="reviewCount === 0"
    class="card empty-box"
    icon="🌙"
    :title="`${reviewLabel}还没有记录`"
    description="这个月还没有留下消费痕迹。"
  />

  <template v-else>
    <section class="review-summary card">
      <div class="rs-top">
        <!-- 「退款」写在标题行里，而上方大数字是**净额**（支出 − 退款）、
             下方「分类分布」那句是**毛额**（退款不进分类）——两个数字天然不等。
             所以这里把大数字的标签说清楚，否则用户会以为下面那句算错了。 -->
        <span>记录了 {{ reviewCount }} 笔<template v-if="monthlyReview.refundTotal"> · 退款 ¥{{ monthlyReview.refundTotal.toFixed(2) }}<template v-if="reviewCategorySum"> · 已从合计扣除</template></template></span>
        <b>{{ moneyHero(reviewTotal) }}</b>
      </div>
      <div class="rs-facts">
        <div v-if="mostFrequent"><small>最常记录</small><b>{{ mostFrequent.name }} · {{ mostFrequent.count }}次</b></div>
        <!-- 「花得最多」和「最大一笔」原本是纯展示的死数字：用户看到「餐饮 ¥320」
             之后没有任何下一步。现在它们各自是到明细的直达入口——
             前者展开下方分类分布里那个分类，后者直接打开那一笔的详情。 -->
        <button
          v-if="topCategory"
          type="button"
          class="rs-fact-link"
          :aria-label="`花得最多：${catInfo(topCategory.cat).name} ${moneyRow(topCategory.total)}，点开看明细`"
          @click="revealReviewCategory(topCategory.cat)"
        >
          <small>花得最多</small><b>{{ catInfo(topCategory.cat).name }} · {{ moneyRow(topCategory.total) }}</b>
        </button>
        <button
          v-if="maxSingle"
          type="button"
          class="rs-fact-link"
          :aria-label="`最大一笔：${maxSingle.name} ${moneyRow(maxSingleMine)}，查看详情`"
          @click="openDetail(maxSingle.id)"
        >
          <small>最大一笔</small><b>{{ maxSingle.name }} · {{ moneyRow(maxSingleMine) }}</b>
        </button>
      </div>
      <p v-if="reviewMyShareNote" class="form-note">{{ reviewMyShareNote }}</p>
      <!-- 收入与结余：此前整个回顾页只看得见支出（收入在 buildLedgerMonthReview 里
           被 continue 掉），「这个月赚了多少、还剩多少」两个数一个都拿不到。
           数据一直都在聚合里躺着，只是从没被渲染出来。 -->
      <div v-if="monthlyReview.incomeTotal" class="rs-io">
        <span>本月收入 <b>{{ moneyRow(monthlyReview.incomeTotal) }}</b></span>
        <span>结余 <b :class="{ negative: monthlyReview.balance < 0 }">{{ moneyRow(monthlyReview.balance) }}</b></span>
      </div>
      <!-- 本月合计是按记录**原值**相加的（这是账本一贯的不折算约定）。
           出现两种以上币种时那个数字没有意义，必须说清楚，不能让用户自己发现。 -->
      <p v-if="monthlyReview.currencyCount > 1" class="form-note">
        本月含 {{ monthlyReview.currencyCount }} 种币种，上方金额按记录原始数值直接相加，未做汇率折算；逐笔金额见账单明细。
      </p>
    </section>

    <section class="review-cats card">
      <div class="rc-head">
        <h2 class="block-title">分类分布</h2>
        <!-- 金额是**毛额**（退款是冲抵项、不进分类），与上方净额合计差的就是那笔退款。 -->
        <span class="rc-sum">共 {{ reviewCategoryRows.length }} 类 · {{ moneyRow(reviewCategorySum) }}<template v-if="monthlyReview.refundTotal">（未扣退款）</template></span>
      </div>
      <!-- 每一行都是明细入口：点一下展开这个分类当月的每一笔，
           金额仍是「我承担」口径（与上方合计、下方月历同源，见 reviewCategoryRows）。 -->
      <p class="form-note">点分类可展开当月每一笔，看清钱具体花在哪里。</p>
      <div class="cat-bars">
        <div v-for="row in visibleCategoryRows" :key="row.key" class="rc-item">
          <button
            type="button"
            class="cat-bar-row rc-bar"
            :class="{ open: expandedCategory === row.key }"
            :aria-expanded="expandedCategory === row.key"
            :aria-label="`${row.info.name} ${moneyRow(row.value)}，${row.count} 笔，占 ${row.pct}%，${expandedCategory === row.key ? '已展开明细' : '点开看明细'}`"
            @click="toggleReviewCategory(row.key)"
          >
            <span class="cb-name">
              <span class="cb-label">{{ row.info.icon }} {{ row.info.name }}</span>
              <small class="cb-meta">{{ row.pct }}% · {{ row.count }} 笔</small>
            </span>
            <span class="cb-track"><i :style="{ width: `${Math.max(2, row.pct)}%` }"></i></span>
            <span class="cb-value">{{ moneyRow(row.value) }}</span>
            <span class="cb-caret" aria-hidden="true">{{ expandedCategory === row.key ? '▴' : '▾' }}</span>
          </button>
          <div v-if="expandedCategory === row.key" class="rc-detail">
            <button
              v-for="e in row.items"
              :key="e.id"
              type="button"
              class="rc-detail-row"
              :aria-label="`查看「${e.name}」的详情`"
              @click="openDetail(e.id)"
            >
              <span class="rd-name">{{ e.name }}</span>
              <small>{{ e.date.slice(5).replace('-', '/') }}{{ e.time ? ` ${e.time}` : '' }}</small>
              <b>{{ moneyRow(personalAmount(e)) }}</b>
            </button>
            <p class="rc-detail-foot">共 {{ row.count }} 笔 · 我承担 {{ moneyRow(row.value) }}</p>
          </div>
        </div>
      </div>
      <button v-if="hiddenCategoryCount" type="button" class="link-btn rc-toggle" @click="$emit('update:showAllReviewCats', true)">展开其余 {{ hiddenCategoryCount }} 个分类</button>
      <button v-else-if="showAllReviewCats" type="button" class="link-btn rc-toggle" @click="$emit('update:showAllReviewCats', false)">只显示前 {{ categoryLimit }} 个</button>
    </section>

    <section class="review-calendar card">
      <h2 class="block-title">月历点迹</h2>
      <div class="cal-week">
        <span v-for="w in ['一','二','三','四','五','六','日']" :key="w">{{ w }}</span>
      </div>
      <div class="cal-grid">
        <template v-for="(cell, idx) in calendarCells" :key="idx">
          <button
            v-if="cell"
            class="cal-cell"
            :class="[dotClass(cell), { selected: selectedDay === cell.day }]"
            :aria-label="cellLabel(cell)"
            :aria-pressed="selectedDay === cell.day"
            @click="$emit('selected-day-change', selectedDay === cell.day ? null : cell.day)"
          >{{ cell.day }}<i v-if="cell.count"></i></button>
          <span v-else class="cal-cell blank"></span>
        </template>
      </div>
      <div v-if="selectedDayInfo" class="cal-detail">
        <b>{{ selectedDayInfo.label }}</b>
        <small>{{ selectedDayInfo.count }} 笔 · {{ moneyRow(selectedDayInfo.total) }}</small>
        <!-- 同 .feed-item：日历里的当日明细行也是打开详情的唯一入口，
             原本同样只有 @click，键盘与读屏都够不到。
               第四十三轮补 tap-target：这一行是全仓唯一「有 role="button"、却既没有
               btn/tap-target 也没有任何 min-height」的，实测声明高度只有 padding 6+6
               加一行文字（约 32px），手机上明显偏小。它有别于课表网格格子的地方在于
               它是普通列表行（没有固定高度的网格轨道），加 44px 地板值不会造成溢出。 -->
        <div
          v-for="e in selectedDayInfo.items"
          :key="e.id"
          class="cd-row tap-target"
          role="button"
          tabindex="0"
          :aria-label="`查看「${e.name}」的详情`"
          @click="openDetail(e.id)"
          @keydown.enter.prevent="openDetail(e.id)"
          @keydown.space.prevent="openDetail(e.id)"
        >
          <span>{{ e.name }}</span><small>{{ catInfo(e.cat).name }} · {{ e.time }}</small><b>{{ moneyRow(personalAmount(e)) }}</b>
        </div>
      </div>
    </section>
  </template>
</div>
</template>

<style scoped>
.block-title {
  margin:0 0 8px;
  font-size:var(--fs-13-5);
  font-weight:var(--fw-750)}
.form-note {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:var(--fs-11-5);
  line-height:1.5}
.month-nav {
  justify-content:center;
  align-items:center;
  gap:18px;
  padding:10px;
  display:flex}
.month-nav b {
  text-align:center;
  min-width:72px;
  font-size:var(--fs-15)}
.mn-btn {
  width:32px;
  height:32px;
  color:var(--ink-soft);
  border:1px solid var(--border);
  background:var(--card);
  cursor:pointer;
  border-radius:var(--radius-9);
  font-size:var(--fs-16)}
.mn-btn:hover:not(:disabled) {
  color:var(--primary);
  border-color:var(--primary)}
.mn-btn:disabled {
  opacity:.35;
  cursor:not-allowed}
.review-export {
  gap:6px;
  margin-left:auto;
  display:flex}
.review-export .btn {
  min-height:30px;
  padding:4px 10px;
  font-size:var(--fs-11-5)}
.review-tab {
  flex-direction:column;
  gap:14px;
  display:flex}
.review-summary {
  flex-direction:column;
  gap:12px;
  display:flex}
.rs-top {
  justify-content:space-between;
  align-items:baseline;
  gap:10px;
  display:flex}
.rs-top span {
  color:var(--ink-soft);
  font-size:var(--fs-13)}
.rs-top b {
  font-variant-numeric:tabular-nums;
  letter-spacing:-.01em;
  font-size:var(--fs-30);
  font-weight:var(--fw-900)}
.rs-facts {
  border:1px solid var(--border);
  background:var(--border);
  border-radius:var(--radius-11);
  grid-template-columns:repeat(3,1fr);
  gap:1px;
  display:grid;
  overflow:hidden}
.rs-facts>div {
  background:var(--bg-tint);
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:10px 13px;
  display:flex}
.rs-facts small {
  color:var(--ink-faint);
  font-size:var(--fs-10-5)}
.rs-facts b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-12-5);
  overflow:hidden}
.cat-bars {
  flex-direction:column;
  gap:9px;
  display:flex}
.cat-bar-row {
  grid-template-columns:76px minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  display:grid}
/* ---------- 回顾「分类分布」 ----------
   .rc-bar 是 .cat-bar-row 的四列版本（名称 / 进度条 / 金额 / 展开箭头）；
   整行是可点开的按钮，所以按钮原生样式同样归零。 */
.rc-head {
  justify-content:space-between;
  align-items:baseline;
  gap:10px;
  display:flex}
.rc-sum {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.rc-item {
  flex-direction:column;
  display:flex}
.cat-bar-row.rc-bar {
  width:100%;
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:var(--radius-9);
  grid-template-columns:minmax(0,92px) minmax(0,1fr) auto 12px;
  padding:5px 6px}
.cat-bar-row.rc-bar:hover {
  background:var(--bg-tint)}
.cat-bar-row.rc-bar.open {
  background:var(--primary-soft)}
.rc-bar .cb-name {
  flex-direction:column;
  gap:1px;
  display:flex}
.cb-label {
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden}
.rc-bar .cb-meta {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-10)}
.cb-caret {
  color:var(--ink-faint);
  text-align:right;
  font-size:var(--fs-9)}
.rc-detail {
  border-left:2px solid var(--primary-soft);
  flex-direction:column;
  margin:0 0 4px 12px;
  padding:2px 0 2px 10px;
  display:flex}
.rc-detail-row {
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:var(--radius-7);
  grid-template-columns:minmax(0,1fr) auto auto;
  align-items:center;
  gap:10px;
  padding:6px 5px;
  font-size:var(--fs-12-5);
  display:grid}
.rc-detail-row:hover {
  background:var(--bg-tint)}
.rc-detail-row:hover b {
  color:var(--primary)}
.rc-detail-row small {
  color:var(--ink-faint);
  font-size:var(--fs-11)}
.rc-detail-row b {
  font-variant-numeric:tabular-nums}
.rd-name {
  text-overflow:ellipsis;
  white-space:nowrap;
  overflow:hidden}
.rc-detail-foot {
  color:var(--ink-faint);
  margin:4px 0 0;
  font-size:var(--fs-11)}
.rc-toggle {
  align-self:flex-start;
  margin-top:10px}
/* 概览卡里「花得最多 / 最大一笔」两个直达入口：外观与相邻的静态格子完全一致，
   只有悬停时金额变色，暗示它可以点。 */
.rs-facts>button.rs-fact-link {
  background:var(--bg-tint);
  cursor:pointer;
  text-align:left;
  color:inherit;
  font:inherit;
  border:0;
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:10px 13px;
  display:flex}
.rs-facts>button.rs-fact-link:hover b {
  color:var(--primary)}
.cb-name {
  color:var(--ink-soft);
  white-space:nowrap;
  text-overflow:ellipsis;
  font-size:var(--fs-12);
  overflow:hidden}
.cb-track {
  background:var(--border);
  border-radius:var(--radius-pill);
  height:8px;
  overflow:hidden}
.cb-track i {
  border-radius:inherit;
  background:linear-gradient(90deg, var(--brand-grad-a), var(--brand-grad-b));
  height:100%;
  display:block}
.cb-value {
  color:var(--text);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-12);
  font-weight:var(--fw-700)}
.cal-week {
  grid-template-columns:repeat(7,1fr);
  gap:4px;
  margin-bottom:4px;
  display:grid}
.cal-week span {
  color:var(--ink-faint);
  text-align:center;
  font-size:var(--fs-10-5)}
.cal-grid {
  grid-template-columns:repeat(7,1fr);
  gap:4px;
  display:grid}
.cal-cell {
  height:44px;
  color:var(--text);
  cursor:pointer;
  font-variant-numeric:tabular-nums;
  background:0 0;
  border:none;
  border-radius:var(--radius-9);
  flex-direction:column;
  align-items:center;
  gap:3px;
  font-size:var(--fs-12);
  display:flex;
  position:relative}
.cal-cell:hover {
  background:var(--bg-tint)}
.cal-cell.blank {
  cursor:default}
.cal-cell i {
  background:color-mix(in srgb, var(--primary) 30%, var(--card));
  border-radius:var(--radius-circle);
  width:6px;
  height:6px}
.cal-cell.l2 i {
  background:color-mix(in srgb, var(--primary) 60%, var(--card));
  width:7px;
  height:7px}
.cal-cell.l3 i {
  background:var(--primary);
  width:8px;
  height:8px}
.cal-cell.selected {
  background:var(--primary-soft);
  box-shadow:inset 0 0 0 1px var(--primary)}
.cal-detail {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-11);
  margin-top:12px;
  padding:11px 13px}
.cal-detail>b {
  font-size:var(--fs-13)}
.cal-detail>small {
  color:var(--ink-faint);
  margin:2px 0 6px;
  font-size:var(--fs-11);
  display:block}
.cd-row {
  cursor:pointer;
  border-top:1px solid var(--border);
  grid-template-columns:1fr auto auto;
  align-items:center;
  gap:10px;
  padding:6px 0;
  font-size:var(--fs-12-5);
  display:grid}
.cd-row:hover b {
  color:var(--primary)}
.cd-row small {
  color:var(--ink-faint);
  font-size:var(--fs-11)}
.cd-row b {
  font-variant-numeric:tabular-nums}
.review-month-trend { margin-bottom:12px; padding:16px; }
.trend-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.trend-head p { margin:4px 0 0; color:var(--ink-faint); font-size:var(--fs-11-5); }
.trend-range { flex:none; display:flex; gap:4px; padding:3px; border:1px solid var(--border); border-radius:var(--radius-pill); background:var(--card); }
.trend-range button { min-height:34px; padding:0 11px; color:var(--ink-soft); border:0; border-radius:var(--radius-pill); background:transparent; font-size:var(--fs-11); cursor:pointer; }
.trend-range button[aria-pressed="true"] { color:var(--on-primary, #fff); background:var(--primary); }
.trend-range button:focus-visible, .trend-month:focus-visible { outline:2px solid var(--primary); outline-offset:2px; z-index:3; }
.trend-glance { display:flex; align-items:center; flex-wrap:wrap; gap:10px 18px; min-height:38px; margin-top:9px; padding:7px 10px; color:var(--ink-soft); border:1px solid var(--border); border-radius:var(--radius-9); background:var(--bg-tint); font-size:var(--fs-11); font-variant-numeric:tabular-nums; }
.trend-glance>b { color:var(--ink); font-weight:var(--fw-750); }
.trend-glance>span { display:inline-flex; align-items:center; gap:5px; white-space:nowrap; }
.trend-glance strong { color:var(--ink); font-weight:var(--fw-700); }
.trend-glance i { width:8px; height:8px; border-radius:2px; }
.trend-glance small { margin-left:auto; color:var(--ink-faint); font-size:var(--fs-10-5); }
.trend-expense-key { background:var(--primary); }
.trend-income-key { background:var(--success); }
.trend-chart-body { display:grid; grid-template-columns:56px minmax(0,1fr); gap:7px; margin-top:8px; }
.trend-chart-body.is-empty { grid-template-columns:minmax(0,1fr); }
.trend-axis { position:relative; height:140px; color:var(--ink-faint); font-size:9px; font-variant-numeric:tabular-nums; }
.trend-axis span { position:absolute; right:0; max-width:100%; overflow:hidden; transform:translateY(50%); white-space:nowrap; }
.trend-plot { position:relative; min-width:0; height:170px; }
.trend-grid { position:absolute; z-index:0; inset:0 0 30px; pointer-events:none; }
.trend-grid i { position:absolute; right:0; left:0; border-top:1px solid color-mix(in srgb, var(--border) 82%, transparent); }
.trend-grid i.zero { border-top-color:color-mix(in srgb, var(--ink-faint) 72%, transparent); }
.monthly-trend-bars { position:relative; z-index:1; height:100%; display:grid; grid-template-columns:repeat(12,minmax(0,1fr)); gap:3px; }
.trend-month { display:flex; min-width:0; flex-direction:column; padding:0 1px; color:var(--ink-faint); border:0; border-radius:var(--radius-7) var(--radius-7) 0 0; background:transparent; cursor:pointer; }
.trend-month:hover, .trend-month.selected { color:var(--primary); background:var(--primary-soft); }
.trend-month[aria-pressed="true"] { box-shadow:inset 0 -3px 0 var(--primary); }
.trend-month-bars { position:relative; display:block; min-height:0; flex:1; }
.trend-month-bars .trend-bar { position:absolute; width:clamp(5px,28%,14px); border-radius:3px 3px 0 0; }
.trend-expense { left:calc(50% - 1px); transform:translateX(-100%); background:var(--primary); }
.trend-expense-negative { border-radius:0 0 3px 3px!important; background:var(--danger); }
.trend-income { left:calc(50% + 1px); background:var(--success); }
.trend-month-label { display:flex; height:30px; flex:none; flex-direction:column; align-items:center; justify-content:center; gap:1px; overflow:hidden; font-variant-numeric:tabular-nums; line-height:1.05; }
.trend-month-label b { font-size:var(--fs-10-5); font-weight:var(--fw-650); white-space:nowrap; }
.trend-month-label small { color:var(--ink-faint); font-size:8px; white-space:nowrap; }
.trend-empty { position:absolute; z-index:2; top:50%; left:50%; width:max-content; max-width:calc(100% - 28px); margin:0; padding:6px 10px; color:var(--ink-soft); border:1px solid var(--border); border-radius:var(--radius-pill); background:var(--card); box-shadow:0 2px 8px #0c1b3412; font-size:var(--fs-10-5); text-align:center; transform:translate(-50%,-50%); pointer-events:none; }
.trend-key { display:flex; align-items:center; flex-wrap:wrap; gap:8px 14px; margin-top:5px; color:var(--ink-faint); font-size:var(--fs-10-5); }
.trend-key span { display:inline-flex; align-items:center; gap:5px; color:var(--ink-soft); }
.trend-key i { width:9px; height:9px; border-radius:2px; }
.trend-key small { flex-basis:100%; line-height:1.45; }
@media (max-width:760px) {
.rs-facts {
  grid-template-columns:1fr}
.rs-top b {
  font-size:var(--fs-26)}
.cal-cell {
  height:40px}
.cat-bar-row.rc-bar {
  grid-template-columns:minmax(0,76px) minmax(0,1fr) auto 10px;
  gap:8px}
.trend-head { flex-direction:column; }
.trend-range button { min-height:36px; }
.trend-glance { gap:8px 12px; }
.trend-glance small { margin-left:0; }
.trend-chart-body { grid-template-columns:48px minmax(0,1fr); gap:5px; }
.monthly-trend-bars { gap:1px; }
.trend-month-label b { font-size:9px; }
}
@media (max-width:520px) {
.month-nav {
  display:grid;
  grid-template-columns:36px minmax(0,1fr) 36px;
  gap:6px;
}
.month-nav .mn-btn { justify-self:center; }
.month-nav b { grid-column:2; min-width:0; }
.review-export {
  grid-column:1 / -1;
  width:100%;
  margin-left:0;
}
.review-export .btn {
  flex:1;
  padding-inline:6px;
  white-space:nowrap;
}
.trend-glance { align-items:flex-start; gap:6px 11px; padding:7px 8px; }
.trend-glance>b { flex-basis:100%; }
.trend-glance>span { font-size:var(--fs-10-5); }
.trend-glance strong { font-size:var(--fs-10-5); }
.trend-glance small { flex-basis:100%; }
.trend-chart-body { grid-template-columns:43px minmax(0,1fr); gap:4px; }
.trend-axis { font-size:8px; }
.trend-month-label b { font-size:8px; }
}
</style>
