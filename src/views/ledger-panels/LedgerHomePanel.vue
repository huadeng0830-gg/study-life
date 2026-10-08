<script setup>
import EmptyState from '../../components/EmptyState.vue'
import VirtualList from '../../components/VirtualList.vue'
import SwipeActionItem from '../../components/SwipeActionItem.vue'
import LedgerBudgetCard from './LedgerBudgetCard.vue'
import { catInfo } from '../../composables/ledger.js'
import { dayLabel, moneyHero, moneyRow } from '../../utils/formatters.js'

defineProps({
  spendStats: { type: Array, default: () => [] },
  currentMonthHasSplit: { type: Boolean, default: false },
  currentMonthPersonal: { type: Object, default: () => ({ splitCount: 0 }) },
  monthCompare: { type: Object, default: null },
  fxRateLine: { type: String, default: '' },
  budgetAlert: { type: Object, default: null },
  budgetBaseCurrency: { type: String, default: 'CNY' },
  budget: { type: Object, default: () => ({ monthly: null }) },
  pendingBills: { type: Array, default: () => [] },
  billAmountText: { type: Function, required: true },
  billDateLabel: { type: Function, required: true },
  frequent: { type: Array, default: () => [] },
  q: { type: String, default: '' },
  showFilters: { type: Boolean, default: false },
  filtersActive: { type: Boolean, default: false },
  fRange: { type: String, default: 'all' },
  fFrom: { type: String, default: '' },
  fTo: { type: String, default: '' },
  fCat: { type: String, default: '' },
  fAccount: { type: String, default: '' },
  fMin: { type: String, default: '' },
  fMax: { type: String, default: '' },
  fKind: { type: String, default: 'all' },
  fDirection: { type: String, default: 'all' },
  allActiveCategories: { type: Array, default: () => [] },
  accountOptions: { type: Array, default: () => [] },
  canExpandFeed: { type: Boolean, default: false },
  filteredExpenses: { type: Array, default: () => [] },
  showAllFeed: { type: Boolean, default: false },
  feedItems: { type: Array, default: () => [] },
  feedItemHeight: { type: Function, required: true },
  highlightedTransactionId: { type: String, default: '' },
  openSwipeId: { type: String, default: '' },
  feedSecondary: { type: Function, required: true },
  feedAmount: { type: Function, required: true },
  categoryOverview: { type: Array, default: () => [] },
  monthCategoryKeys: { type: Array, default: () => [] },
})

defineEmits([
  'open-bill-form',
  'mark-paid',
  'dismiss-pending',
  'show-all-feed-change',
  'open-fx-settings',
  'open-budget-settings',
  'open-quick',
  'open-category-manager',
  'use-frequent',
  'toggle-filters',
  'clear-filters',
  'update-q',
  'update-f-range',
  'update-f-from',
  'update-f-to',
  'update-f-cat',
  'update-f-account',
  'update-f-min',
  'update-f-max',
  'update-f-kind',
  'update-f-direction',
  'open-detail',
  'transaction-swipe',
  'swipe-action',
  'swipe-open-change',
  'switch-tab',
  'open-review-category',
])
</script>

<template>
<!-- ================= 账本首页 ================= -->
<div class="ledger-home">
  <!-- 核心数据：只回答不同时间范围内“花了多少” -->
  <section class="hero-stat card" aria-label="花费概览">
    <span class="hero-label">花费概览</span>
    <div class="spend-metrics">
      <!-- 三块数字固定用「今天花费/本周花费/本月花费」这三个用户熟悉的标签，
           数值统一走分摊口径（见 spendStats）：有分摊时就是我的份额。
           ⚠ 这里不要写 `xxx.value`：`<script setup>` 的 ref/computed 在模板中自动解包，
           写成 `mySpendPeriodStats.value` 会恒为 `undefined`（曾经的真实 bug：
           条件恒假 → 分摊再重也永远按总额显示）。 -->
      <div v-for="metric in spendStats" :key="metric.key" class="spend-metric" :class="{ current: metric.key === 'month' }">
        <small>{{ metric.label }}</small>
        <b>{{ moneyHero(metric.value) }}</b>
      </div>
    </div>
    <!-- 口径说明：本月没有分摊时三块数字与全额口径逐分相等，多写一句只会是噪声。 -->
    <p v-if="currentMonthHasSplit" class="hero-sub split-note">
      {{ currentMonthPersonal.splitCount }} 笔分摊已按「我承担」计入（支出 ÷ 人数，余数归我），列表金额同样是份额。<a class="link-btn" @click="$emit('show-all-feed-change', true)">查看全部记录</a>
    </p>
    <span class="hero-sub">按自然周统计 · 只计算支出</span>
    <!-- 本月收入与结余：收入数据一直在 personalSpendTotals 里算着，
         此前三块数字全是支出，「这个月赚了多少、还剩多少」一个都看不到。
         没有收入记录时整行不渲染，不会出现「收入 ¥0.00」这种噪声。 -->
    <p v-if="currentMonthPersonal.incomeTotal" class="hero-sub income-line">
      本月收入 {{ moneyRow(currentMonthPersonal.incomeTotal) }} · 结余
      <b :class="{ negative: currentMonthPersonal.balance < 0 }">{{ moneyRow(currentMonthPersonal.balance) }}</b>
    </p>
    <p v-if="monthCompare" class="hero-compare" :class="{ up: monthCompare.up, down: monthCompare.down }">较上月{{ monthCompare.diff > 0 ? '多' : monthCompare.diff < 0 ? '少' : '持平' }} {{ moneyRow(Math.abs(monthCompare.diff)) }}</p>
    <!-- 多币种折算行：只有真的存在非基准币种记录时才出现，缺汇率的笔数在文案里如实说明 -->
    <p v-if="fxRateLine" class="hero-sub" role="status">{{ fxRateLine }}</p>
    <div class="hero-sub">
      <button class="link-btn" type="button" @click="$emit('open-fx-settings')">汇率设置</button>
    </div>
  </section>

  <LedgerBudgetCard
    :budget-alert="budgetAlert"
    :budget-base-currency="budgetBaseCurrency"
    :budget="budget"
    @open-budget-settings="$emit('open-budget-settings')"
  />

  <section class="ledger-quick-entry" aria-label="快速记账">
    <div><b>刚刚发生了什么？</b><small>金额 + 内容就能记下，分类和账户会沿用默认值</small></div>
    <button class="btn btn-primary" type="button" @click="$emit('open-quick')">＋ 记一笔</button>
  </section>

  <!-- 待处理：固定账单临近（无则整块隐藏） -->
  <section v-if="pendingBills.length" class="pending-block">
    <h2 class="block-title">待处理固定账单</h2>
    <div class="pending-list">
      <div
              v-for="bill in pendingBills"
              :key="bill.id"
              class="pending-row"
              tabindex="0"
              @click="$emit('open-bill-form', {}, bill.id)"
              @keydown.enter.prevent="$emit('open-bill-form', {}, bill.id)"
              @keydown.space.prevent="$emit('open-bill-form', {}, bill.id)"
            >
        <div class="p-main">
          <b>{{ bill.name }}</b>
          <small>{{ billAmountText(bill) }} · {{ billDateLabel(bill.nextDate) }} · {{ bill._s.text }}</small>
        </div>
        <div class="pending-actions">
          <button class="btn btn-sm btn-primary" @click.stop="$emit('mark-paid', bill)">已支付</button>
          <button class="p-close" type="button" aria-label="暂时隐藏这条账单提醒" @click.stop="$emit('dismiss-pending', bill)">✕</button>
        </div>
      </div>
    </div>
  </section>

  <!-- 常记（自动生成，点开后可改金额再记下） -->
  <section v-if="frequent.length" class="freq-block">
    <div class="block-head">
      <h2 class="block-title">常记</h2>
      <button class="link-btn" @click="$emit('open-category-manager')">管理分类</button>
    </div>
    <div class="freq-row">
      <button v-for="item in frequent" :key="item.name" class="freq-pill" @click="$emit('use-frequent', item)">
        <span class="freq-icon">{{ catInfo(item.cat).icon }}</span>
        <b>{{ item.name }}</b>
        <small>{{ moneyRow(item.amount) }}</small>
      </button>
    </div>
  </section>

  <!-- 搜索 + 筛选 -->
  <section class="search-block">
    <div class="search-row">
      <span class="search-icon">🔍</span>
      <input :value="q" @input="e => $emit('update-q', e.target.value)" class="search-input" aria-label="搜索账本记录" placeholder="搜索名称、备注或分类" />
      <button class="btn btn-sm" :class="{ 'btn-ghost': filtersActive || showFilters }" aria-label="打开账本筛选" :aria-expanded="showFilters" @click="$emit('toggle-filters')">筛选</button>
      <button v-if="filtersActive" class="link-btn" @click="$emit('clear-filters')">清除</button>
    </div>
    <div v-if="showFilters" class="filter-panel">
      <div class="chip-row">
        <button class="chip" :class="{ on: fRange === 'all' }" @click="$emit('update-f-range', 'all')">全部时间</button>
        <button class="chip" :class="{ on: fRange === 'today' }" @click="$emit('update-f-range', 'today')">今天</button>
        <button class="chip" :class="{ on: fRange === 'week' }" @click="$emit('update-f-range', 'week')">本周</button>
        <button class="chip" :class="{ on: fRange === 'month' }" @click="$emit('update-f-range', 'month')">本月</button>
        <button class="chip" :class="{ on: fRange === 'custom' }" @click="$emit('update-f-range', 'custom')">自定义</button>
      </div>
      <div v-if="fRange === 'custom'" class="custom-range">
        <input aria-label="筛选起始日期" :value="fFrom" @input="e => $emit('update-f-from', e.target.value)" type="date" /> <i>至</i> <input aria-label="筛选结束日期" :value="fTo" @input="e => $emit('update-f-to', e.target.value)" type="date" />
      </div>
      <div class="filter-line">
        <select aria-label="筛选分类" :value="fCat" @input="e => $emit('update-f-cat', e.target.value)">
          <option value="">全部分类</option>
          <option v-for="c in allActiveCategories" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}</option>
        </select>
        <select :value="fAccount" @input="e => $emit('update-f-account', e.target.value)" aria-label="筛选账户">
          <option value="">全部账户</option>
          <option v-for="account in accountOptions" :key="account" :value="account">{{ account }}</option>
        </select>
        <input aria-label="筛选最低金额" :value="fMin" @input="e => $emit('update-f-min', e.target.value)" type="number" min="0" step="0.01" inputmode="decimal" placeholder="金额≥" />
        <input aria-label="筛选最高金额" :value="fMax" @input="e => $emit('update-f-max', e.target.value)" type="number" min="0" step="0.01" inputmode="decimal" placeholder="金额≤" />
        <select aria-label="筛选记录来源" :value="fKind" @input="e => $emit('update-f-kind', e.target.value)">
          <option value="all">全部来源</option>
          <option value="manual">普通记录</option>
          <option value="bill">固定账单生成</option>
        </select>
        <select :value="fDirection" @input="e => $emit('update-f-direction', e.target.value)" aria-label="筛选收支类型">
          <option value="all">全部收支</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
      </div>
    </div>
  </section>

  <!-- 最近记录：生活记录流 -->
  <section class="feed-block">
    <div class="block-head">
      <h2 class="block-title">最近记录</h2>
      <button v-if="canExpandFeed" class="link-btn" type="button" @click="$emit('show-all-feed-change', true)">查看全部（{{ filteredExpenses.length }}）</button>
      <button v-else-if="showAllFeed" class="link-btn" type="button" @click="$emit('show-all-feed-change', false)">收起</button>
    </div>
    <div v-if="feedItems.length === 0" class="feed-empty">
      <EmptyState
        class="card"
        icon="🧾"
        title="还没有记录"
        description="第一笔不用很认真，记下刚刚花的钱就可以。"
        primary-label="＋ 记一笔"
        @primary="$emit('open-quick')"
      />
    </div>
    <div v-else class="feed">
      <VirtualList
        :items="feedItems"
        item-key="key"
        :item-height="feedItemHeight"
        :estimated-height="62"
        :gap="0"
        :overscan="12"
        :threshold="80"
        fixed-height
        reveal-behavior="auto"
        reveal-non-virtual
        :reveal-key="highlightedTransactionId"
      >
        <template #default="{ item: e, index: feedIndex }">
          <div v-if="e.kind === 'day'" class="feed-virtual-item feed-day-item" :class="{ first: feedIndex === 0 }">
            <h3 class="feed-day">
              <span>{{ dayLabel(e.date) }}</span>
              <small v-if="e.summary.expense">支出 {{ moneyRow(e.summary.expense) }}</small>
              <small v-if="e.summary.income">收入 {{ moneyRow(e.summary.income) }}</small>
            </h3>
          </div>
          <SwipeActionItem
            v-else
            class="feed-virtual-item feed-transaction-item"
            :actions="e.actions"
            :open="openSwipeId === String(e.transaction.id)"
            @swipe="$emit('transaction-swipe', e.transaction.id, $event)"
            @action="$emit('swipe-action', e.transaction.id, $event)"
            @update:open="$emit('swipe-open-change', e.transaction.id, $event)"
          >
            <!-- 这一行是打开交易详情的**唯一**入口，而它原本只是个带 @click 的 div：
                 键盘 Tab 走不到、读屏读不出可点、回车空格都没反应，等于账本页最常用的
                 操作对非触屏用户完全不可用（WCAG 2.1.1 键盘可达）。补 role + tabindex +
                 回车的键盘处理，DOM 结构与样式一律不动。
                 可以安全地加 role="button"：外面的 SwipeActionItem 把动作按钮渲染成本行
                 的**兄弟节点**，所以这里不会出现「按钮里套按钮」的非法嵌套。
                 只在这里给出「打开详情」这一个入口是够的——详情面板里有编辑 / 再记一次 /
                 退款 / 删除等全部后续操作，都是真按钮，键盘一路可达。
                  第四十三轮补 tap-target：粗指针设备上的 44px 最小尺寸规则只认
                  `[role='button'].tap-target`（见 style.css），而这一行只有 role 没接钩子，
                  于是手机上它拿不到 44px 兜底。它的高由所在行决定（height:100%），
                  加 min-height 只是给一个地板值，不会挤爆列表。 -->
            <div
              class="feed-item tap-target"
              :class="{ highlighted: highlightedTransactionId === String(e.transaction.id) }"
              :data-focus-id="e.transaction.id"
              role="button"
              tabindex="0"
              :aria-label="`查看「${e.transaction.name}」的详情`"
              @click="$emit('open-detail', e.transaction.id)"
              @keydown.enter.prevent="$emit('open-detail', e.transaction.id)"
              @keydown.space.prevent="$emit('open-detail', e.transaction.id)"
            >
              <div class="fi-main">
                <b>{{ e.category.icon }} {{ e.transaction.name }}</b>
                <small>{{ feedSecondary(e.transaction, e.category) }}</small>
              </div>
              <span class="fi-amount" :class="{ income: e.transaction.direction === 'income', refund: e.transaction.direction === 'refund' }">{{ feedAmount(e.transaction) }}</span>
            </div>
          </SwipeActionItem>
        </template>
      </VirtualList>
    </div>
  </section>

  <section v-if="categoryOverview.length" class="category-block">
    <div class="block-head">
      <h2 class="block-title">本月分类</h2>
      <button class="link-btn" type="button" @click="$emit('switch-tab', 'review')">查看回顾</button>
    </div>
    <div class="cat-bars compact-bars">
      <!-- 首页这一块只显示前 5 名，但每一行都能点：直接跳到回顾页、
           并把对应分类的当月明细展开好，不用再自己去找。 -->
      <button
        v-for="bar in categoryOverview"
        :key="bar.key"
        type="button"
        class="cat-bar-row cat-bar-link"
        :aria-label="`${bar.info.name} 本月 ${moneyRow(bar.value)}，查看这个分类的明细`"
        @click="$emit('open-review-category', bar.key)"
      >
        <span class="cb-name">{{ bar.info.icon }} {{ bar.info.name }}</span>
        <span class="cb-track"><i :style="{ width: `${Math.min(100, bar.pct)}%` }"></i></span>
        <span class="cb-value">{{ moneyRow(bar.value) }}</span>
      </button>
    </div>
    <p v-if="monthCategoryKeys.length > categoryOverview.length" class="cat-more-note">
      本月还有 {{ monthCategoryKeys.length - categoryOverview.length }} 个分类没在这里显示，点分类或「查看回顾」看全部。
    </p>
  </section>
</div>
</template>

<style scoped>
.block-title {
  margin:0 0 8px;
  font-size:var(--fs-13-5);
  font-weight:var(--fw-750)}
.block-head {
  justify-content:space-between;
  align-items:center;
  margin-bottom:8px;
  display:flex}
.block-head .block-title {
  margin:0}
.ledger-home {
  flex-direction:column;
  gap:16px;
  display:flex}
.ledger-home>.hero-stat {
  order:1}
.ledger-home>.budget-card {
  order:2}
.ledger-home>.ledger-quick-entry {
  order:3}
.ledger-home>.search-block {
  order:4}
.ledger-home>.feed-block {
  order:5}
.ledger-home>.pending-block {
  order:6}
.ledger-home>.freq-block {
  order:7}
.ledger-home>.category-block {
  order:8}
.hero-stat {
  flex-direction:column;
  gap:10px;
  padding:16px 18px 14px;
  display:flex}
.hero-label {
  color:var(--ink-faint);
  font-size:var(--fs-12-5);
  font-weight:var(--fw-700)}
.spend-metrics {
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
  display:grid}
.spend-metric {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-11);
  flex-direction:column;
  gap:5px;
  min-width:0;
  padding:11px 12px;
  display:flex}
.spend-metric small {
  color:var(--ink-soft);
  font-size:var(--fs-11);
  font-weight:var(--fw-700)}
.spend-metric b {
  letter-spacing:-.02em;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
  font-size:max(16px,min(2.3vw,23px));
  font-weight:var(--fw-900);
  line-height:1.1;
  overflow:hidden}
.spend-metric.current {
  border-color:var(--primary);
  background:var(--primary-soft)}
.spend-metric.current small {
  color:var(--primary)}
.hero-sub {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.hero-compare {
  color:var(--ink-soft);
  background:var(--bg-tint);
  font-variant-numeric:tabular-nums;
  border-radius:var(--radius-pill);
  align-self:flex-start;
  margin:0;
  padding:3px 9px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-700)}
.hero-compare.up {
  color:var(--warning);
  background:color-mix(in srgb, var(--warning) 10%, var(--card))}
.hero-compare.down {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
.ledger-quick-entry {
  border:1px solid var(--border-strong);
  background:var(--card);
  border-radius:var(--radius-12);
  justify-content:space-between;
  align-items:center;
  gap:14px;
  padding:12px 14px;
  display:flex}
.ledger-quick-entry div {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.ledger-quick-entry b {
  font-size:var(--fs-13)}
.ledger-quick-entry small {
  color:var(--ink-soft);
  font-size:var(--fs-11)}
.ledger-quick-entry .btn {
  flex:none;
  min-height:42px}
.pending-list {
  flex-direction:column;
  gap:8px;
  display:flex}
/* 这是**可点击**的行：点了打开这个固定账单的编辑表单
   （@click="$emit('open-bill-form', {}, bill.id)"），所以有 cursor:pointer 与 hover 反馈。
   它带 tabindex 与回车/空格，但刻意**不给 role**：role="button" 会让里面「已支付 / 暂时隐藏」
   两个真按钮的语义被抹掉（presentational），行名也会被拼成一长串。键盘用户也可以走
   「固定账单」分区的列表行编辑入口，所以这一处登记在
   tests/keyboardReachability.test.js 的 EXEMPT 里，理由写的就是这个取舍。
   第三十七轮的死类清理名单里曾把它当成无用行，这里是"故意保留"。 */
.pending-row {
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--card);
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
  border-radius:var(--radius-12);
  align-items:center;
  gap:10px;
  padding:11px 14px;
  display:flex}
.pending-row:hover {
  border-color:var(--border-strong);
  box-shadow:var(--shadow-sm)}
.p-main {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.p-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-13-5);
  overflow:hidden}
.p-main small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.p-close {
  color:var(--ink-faint);
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:var(--radius-7);
  width:26px;
  height:26px;
  font-size:var(--fs-12)}
.p-close:hover {
  color:var(--ink-soft);
  background:var(--bg)}
.pending-actions {
  align-items:center;
  gap:4px;
  display:inline-flex}
.freq-row {
  flex-wrap:wrap;
  gap:8px;
  display:flex}
.freq-pill {
  border:1px solid var(--border-strong);
  background:var(--card);
  cursor:pointer;
  height:40px;
  transition:border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
  border-radius:var(--radius-12);
  align-items:center;
  gap:7px;
  padding:0 14px;
  display:inline-flex}
.freq-pill:hover {
  border-color:var(--primary);
  background:var(--primary-soft);
  transform:translateY(-1px)}
.freq-icon {
  font-size:var(--fs-14)}
.freq-pill b {
  font-size:var(--fs-13);
  font-weight:var(--fw-700)}
.freq-pill small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.search-row {
  align-items:center;
  gap:8px;
  display:flex}
.search-icon {
  opacity:.7;
  font-size:var(--fs-13)}
.search-input {
  flex:1;
  min-width:0}
.filter-panel {
  border:1px solid var(--border);
  background:var(--bg-tint);
  border-radius:var(--radius-12);
  flex-direction:column;
  gap:10px;
  margin-top:10px;
  padding:12px;
  display:flex}
.custom-range {
  align-items:center;
  gap:8px;
  display:flex}
.custom-range i {
  color:var(--ink-faint);
  font-size:var(--fs-12);
  font-style:normal}
.custom-range input {
  width:auto}
.filter-line {
  grid-template-columns:repeat(5,1fr);
  gap:8px;
  display:grid}
.filter-line select, .filter-line input {
  width:100%;
  min-width:0}
.feed {
  flex-direction:column;
  display:flex}
.feed-virtual-item {
  flex:none}
.feed-day-item {
  box-sizing:border-box;
  height:34px}
.feed-day-item.first {
  height:20px}
.feed-day {
  box-sizing:border-box;
  height:100%;
  color:var(--ink-faint);
  letter-spacing:.04em;
  align-items:baseline;
  gap:8px;
  margin:0;
  padding-top:14px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-800);
  display:flex}
.feed-day-item.first .feed-day {
  padding-top:0}
.feed-day small {
  color:var(--ink-soft);
  letter-spacing:0;
  font-size:var(--fs-10-5);
  font-weight:var(--fw-600)}
.feed-transaction-item {
  height:62px}
.feed-item {
  box-sizing:border-box;
  cursor:pointer;
  height:100%;
  transition:background var(--dur-fast) var(--ease-standard);
  border-radius:var(--radius-11);
  align-items:center;
  gap:12px;
  padding:10px 12px;
  display:flex}
.feed-item:hover {
  background:var(--bg-tint)}
.feed-item.highlighted {
  background:var(--primary-soft);
  box-shadow:inset 3px 0 var(--primary)}
.fi-main {
  flex-direction:column;
  flex:1;
  gap:2px;
  min-width:0;
  display:flex}
.fi-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-14);
  font-weight:var(--fw-650);
  overflow:hidden}
.fi-main small {
  color:var(--ink-faint);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.fi-amount {
  color:var(--text);
  font-variant-numeric:tabular-nums;
  flex:none;
  font-size:var(--fs-14-5);
  font-weight:var(--fw-750)}
.fi-amount.income, .fi-amount.refund {
  color:var(--success)}
.cat-bars {
  flex-direction:column;
  gap:9px;
  display:flex}
.cat-bar-row {
  grid-template-columns:76px minmax(0,1fr) auto;
  align-items:center;
  gap:10px;
  display:grid}
/* 首页「本月分类」的一行：从纯展示改成按钮（点一下去回顾页看这个分类的明细）。
   按钮默认样式（背景、边框、字体、内边距）在这里全部归零，视觉与改造前的 div 完全一致。 */
.cat-bar-row.cat-bar-link {
  width:100%;
  color:var(--text);
  cursor:pointer;
  text-align:left;
  font:inherit;
  background:0 0;
  border:0;
  border-radius:var(--radius-9);
  padding:3px 4px}
.cat-bar-row.cat-bar-link:hover {
  background:var(--bg-tint)}
.cat-bar-row.cat-bar-link:hover .cb-value {
  color:var(--primary)}
.cat-more-note {
  color:var(--ink-faint);
  margin:8px 0 0;
  font-size:var(--fs-11-5);
  line-height:1.5}
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
.category-block {
  padding-top:2px}
.compact-bars {
  gap:8px}
@media (max-width:760px) {
.hero-stat {
  padding:18px 18px 16px}
.ledger-quick-entry {
  flex-direction:column;
  align-items:flex-start;
  gap:9px}
.ledger-quick-entry .btn {
  width:100%}
.search-row .btn-sm {
  padding:8px 12px}
.filter-line {
  grid-template-columns:1fr 1fr}
.freq-pill {
  height:42px}
.feed-item {
  padding:11px 8px}
}
@media (max-width:520px) {
.filter-line {
  grid-template-columns:1fr}
.spend-metrics {
  gap:6px}
.spend-metric {
  padding:9px 8px}
.spend-metric b {
  font-size:var(--fs-15)}
}
</style>
