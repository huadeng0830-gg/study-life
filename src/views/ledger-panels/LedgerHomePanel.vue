<script setup>
import { defineProps, defineEmits, computed, ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import VirtualList from '../../components/VirtualList.vue'
import SwipeActionItem from '../../components/SwipeActionItem.vue'
import { dayLabel, moneyHero, moneyRow, moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  // Data passed from parent
  spendStats: { type: Array, required: true },
  currentMonthHasSplit: { type: Boolean, default: false },
  currentMonthPersonal: { type: Object, default: () => ({ splitCount: 0 }) },
  monthCompare: { type: Object, default: null },
  fxRateLine: { type: String, default: '' },
  budgetAlert: { type: Object, default: null },
  budget: { type: Object, default: () => ({ monthly: null }) },
  pendingBills: { type: Array, default: () => [] },
  frequent: { type: Array, default: () => [] },
  filteredExpenses: { type: Array, default: () => [] },
  feedItems: { type: Array, default: () => [] },
  feedDaySummary: { type: Function, required: true },
  categoryOverview: { type: Array, default: () => [] },
  allActiveCategories: { type: Array, default: () => [] },
  accountOptions: { type: Array, default: () => [] },
  showAllFeed: { type: Boolean, default: false },
  q: { type: String, default: '' },
  fRange: { type: String, default: 'all' },
  fFrom: { type: String, default: '' },
  fTo: { type: String, default: '' },
  fCat: { type: String, default: '' },
  fAccount: { type: String, default: '' },
  fMin: { type: String, default: '' },
  fMax: { type: String, default: '' },
  fKind: { type: String, default: 'all' },
  fDirection: { type: String, default: 'all' },
  filtersActive: { type: Boolean, default: false },
  showFilters: { type: Boolean, default: false },
  canExpandFeed: { type: Boolean, default: false },
  highlightedTransactionId: { type: String, default: '' },
  catInfo: { type: Function, required: true },
  splitNote: { type: Function, required: true },
  feedSecondary: { type: Function, required: true },
  feedAmount: { type: Function, required: true },
  transactionSwipeActions: { type: Function, required: true },
  openSwipeId: { type: String, default: '' },
})

const emit = defineEmits([
  'open-quick',
  'open-category-manager',
  'open-fx-settings',
  'open-budget-settings',
  'open-bill-form',
  'mark-paid',
  'dismiss-pending',
  'use-frequent',
  'show-all-feed-change',
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
  'toggle-filters',
  'close-swipe',
  'open-detail',
  'transaction-swipe',
  'swipe-action',
  'swipe-open-change',
])

const feedItemHeight = (item, index) => item?.kind === 'day' ? (index === 0 ? 20 : 34) : 62
</script>

<template>
  <div class="ledger-home">
    <!-- ================= 账本首页 ================= -->
    <section class="hero-stat card" aria-label="花费概览">
      <span class="hero-label">花费概览</span>
      <div class="spend-metrics">
        <div v-for="metric in spendStats" :key="metric.key" class="spend-metric" :class="{ current: metric.key === 'month' }">
          <small>{{ metric.label }}</small>
          <b>{{ moneyHero(metric.value) }}</b>
        </div>
      </div>
      <p v-if="currentMonthHasSplit" class="hero-sub split-note">
        {{ currentMonthPersonal.splitCount }} 笔分摊已按「我承担」计入（支出 ÷ 人数，余数归我），列表金额同样是份额。
        <a class="link-btn" @click="$emit('show-all-feed-change', true)">查看全部记录</a>
      </p>
      <span class="hero-sub">按自然周统计 · 只计算支出</span>
      <p v-if="monthCompare" class="hero-compare" :class="{ up: monthCompare.up, down: monthCompare.down }">
        较上月{{ monthCompare.diff > 0 ? '多' : monthCompare.diff < 0 ? '少' : '持平' }} {{ moneyRow(Math.abs(monthCompare.diff)) }}
      </p>
      <p v-if="fxRateLine" class="hero-sub" role="status">{{ fxRateLine }}</p>
      <p v-if="budgetAlert" class="pending-block" :class="{ over: budgetAlert.level === 'over' }" role="status">{{ budgetAlert.text }}</p>
      <div class="hero-sub">
        <button class="link-btn" type="button" @click="$emit('open-fx-settings')">汇率设置</button>
        · <button class="link-btn" type="button" @click="$emit('open-budget-settings')">{{ budget.monthly === null ? '设置预算' : '预算设置' }}</button>
      </div>
    </section>

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
            <small>{{ bill.amountText }} · {{ bill.dateLabel }} · {{ bill._s.text }}</small>
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
        <div v-for="bar in categoryOverview" :key="bar.key" class="cat-bar-row">
          <span class="cb-name">{{ bar.info.icon }} {{ bar.info.name }}</span>
          <span class="cb-track"><i :style="{ width: `${Math.min(100, bar.pct)}%` }"></i></span>
          <span class="cb-value">{{ moneyRow(bar.value) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>