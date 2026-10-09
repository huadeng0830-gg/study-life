<script setup>
import EmptyState from '../../components/EmptyState.vue'
import MonthlyTrendCard from './MonthlyTrendCard.vue'
import { catInfo } from '../../composables/ledger.js'
import { moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  reviewLabel: { type: String, default: '' },
  reviewMonth: { type: String, default: '' },
  todayMonth: { type: String, default: '' },
  monthlyTrend: { type: /** @type {import('vue').PropType<import('../../composables/monthlyTrendChart.js').MonthlyTrendRow[]>} */ (Array), default: () => [] },
  earliestTrendMonth: { type: String, default: '' },
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
  exporting: { type: Boolean, default: false },
  revealReviewCategory: { type: Function, required: true },
  toggleReviewCategory: { type: Function, required: true },
  openDetail: { type: Function, required: true },
})

const emit = defineEmits(['selected-day-change', 'update:showAllReviewCats', 'jump-to-month', 'trend-end-month-change'])
const moneyRow = (value) => moneyWithCurrency(value, props.trendCurrency)
const moneyHero = moneyRow
const transactionMoney = (item) => `${item.direction === 'income' || item.direction === 'refund' ? '+' : '-'}${moneyWithCurrency(props.personalAmount(item), item.currency || props.trendCurrency)}`

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
  return cell.count ? `${date}，${cell.count} 笔账目，净支出 ${moneyRow(cell.total)}${cell.excludedCount ? `，${cell.excludedCount} 笔未折算` : ''}` : `${date}，无账目`
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
    <input class="review-month-picker" type="month" aria-label="选择回顾月份" :value="reviewMonth" :max="todayMonth" @change="emit('jump-to-month', $event.target.value)" />
    <span class="review-export" role="group" aria-label="导出账单">
      <button class="btn btn-sm" type="button" :disabled="exporting" @click="exportLedgerCsv()">导出 CSV</button>
      <button class="btn btn-sm" type="button" :disabled="exporting" @click="exportLedgerXlsx()">{{ exporting ? '正在导出…' : '导出 Excel' }}</button>
      <!-- 「导出全部历史」：此前导出被硬编码成当月，想拿完整数据只能一个月一个月点。
           用 aria-label 说清范围，避免用户以为导出的还是当前月。 -->
      <button class="btn btn-sm" type="button" :disabled="exporting" aria-label="导出全部历史账单，不限当前月份" @click="props.exportAllLedgerXlsx()">导出全部</button>
    </span>
  </div>

  <MonthlyTrendCard
    :months="monthlyTrend"
    :review-month="reviewMonth"
    :today-month="todayMonth"
    :earliest-month="earliestTrendMonth"
    :currency="trendCurrency"
    @jump-to-month="emit('jump-to-month', $event)"
    @range-end-change="emit('trend-end-month-change', $event)"
  />

  <EmptyState
    v-if="reviewCount === 0"
    class="card empty-box"
    icon="🌙"
    :title="`${reviewLabel}还没有记录`"
    description="这个月还没有收支或退款记录。"
  />

  <template v-else>
    <section class="review-summary card">
      <div class="rs-top">
        <!-- 「退款」写在标题行里，而上方大数字是**净额**（支出 − 退款）、
             下方「分类分布」那句是**毛额**（退款不进分类）——两个数字天然不等。
             所以这里把大数字的标签说清楚，否则用户会以为下面那句算错了。 -->
        <span>记录了 {{ reviewCount }} 笔 · 支出净额<template v-if="monthlyReview.refundTotal"> · 退款 {{ moneyRow(monthlyReview.refundTotal) }}<template v-if="reviewCategorySum"> · 已从合计扣除</template></template></span>
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
      <div class="rs-io">
        <span>本月收入 <b>{{ moneyRow(monthlyReview.incomeTotal) }}</b></span>
        <span>结余 <b :class="{ negative: monthlyReview.balance < 0 }">{{ moneyRow(monthlyReview.balance) }}</b></span>
      </div>
      <!-- 汇总使用基准币种，逐笔明细保留原币，缺汇率的记录明确标出。 -->
      <p v-if="monthlyReview.hasForeignCurrency" class="form-note">合计、分类与月历按手动汇率折算为 {{ trendCurrency }}，逐笔显示原币金额。汇率日期：{{ monthlyReview.ratesUpdatedAt || '未记录' }}。</p>
      <p v-if="monthlyReview.excludedCount" class="review-fx-warning" role="status">{{ monthlyReview.missingRates.join('、') }} 缺少汇率，{{ monthlyReview.excludedCount }} 笔暂未计入汇总，仍可在分类、月历和导出中查看。</p>
    </section>

    <section v-if="reviewCategoryRows.length" class="review-cats card">
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
              <small class="cb-meta">{{ row.pct }}% · {{ row.count }} 笔<template v-if="row.excludedCount"> · {{ row.excludedCount }} 笔未折算</template></small>
            </span>
            <span class="cb-track"><i :style="{ width: `${row.value > 0 ? Math.max(2, row.pct) : 0}%` }"></i></span>
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
              <b>{{ moneyWithCurrency(personalAmount(e), e.currency || trendCurrency) }}</b>
            </button>
            <p class="rc-detail-foot">共 {{ row.count }} 笔 · 我承担 {{ moneyRow(row.value) }}<template v-if="row.excludedCount"> · {{ row.excludedCount }} 笔缺少汇率未计入</template></p>
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
        <small>{{ selectedDayInfo.count }} 笔 · 净支出 {{ moneyRow(selectedDayInfo.total) }}<template v-if="selectedDayInfo.excludedCount"> · {{ selectedDayInfo.excludedCount }} 笔未折算</template></small>
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
          <span>{{ e.name }}</span><small>{{ e.direction === 'refund' ? '退款' : e.direction === 'income' ? '收入' : catInfo(e.cat).name }} · {{ e.time }}</small><b>{{ transactionMoney(e) }}</b>
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
.review-month-picker { width:150px; min-width:0; min-height:34px; font-size:var(--fs-12); }
.review-fx-warning { margin:0; padding:10px 12px; border-left:3px solid var(--warning); background:var(--bg-tint); color:var(--ink-soft); font-size:var(--fs-12); line-height:1.5; }
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
}
@media (max-width:520px) {
.month-nav {
  display:grid;
  grid-template-columns:36px minmax(0,1fr) 36px;
  gap:6px;
}
.month-nav .mn-btn { justify-self:center; }
.month-nav b { grid-column:2; min-width:0; }
.review-month-picker { grid-column:1 / -1; width:100%; }
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
}
</style>
