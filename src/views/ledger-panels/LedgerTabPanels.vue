<template>
  <LedgerHomePanel
    v-if="tab === 'ledger'"
    :spend-stats="spendStats"
    :current-month-has-split="currentMonthHasSplit"
    :current-month-personal="currentMonthPersonal"
    :month-compare="monthCompare"
    :fx-rate-line="fxRateLine"
    :budget-alert="budgetAlert"
    :budget="budget"
    :pending-bills="pendingBills"
    :bill-amount-text="billAmountText"
    :bill-date-label="billDateLabel"
    :frequent="frequent"
    :q="q"
    :show-filters="showFilters"
    :filters-active="filtersActive"
    :f-range="fRange"
    :f-from="fFrom"
    :f-to="fTo"
    :f-cat="fCat"
    :f-account="fAccount"
    :f-min="fMin"
    :f-max="fMax"
    :f-kind="fKind"
    :f-direction="fDirection"
    :all-active-categories="allActiveCategories"
    :account-options="accountOptions"
    :can-expand-feed="canExpandFeed"
    :filtered-expenses="filteredExpenses"
    :show-all-feed="showAllFeed"
    :feed-items="feedItems"
    :feed-item-height="feedItemHeight"
    :highlighted-transaction-id="highlightedTransactionId"
    :open-swipe-id="openSwipeId"
    :feed-secondary="feedSecondary"
    :feed-amount="feedAmount"
    :category-overview="categoryOverview"
    :month-category-keys="monthCategoryKeys"
    @open-bill-form="openBillForm"
    @mark-paid="markPaid"
    @dismiss-pending="dismissPending"
    @show-all-feed-change="$emit('show-all-feed-change', $event)"
    @open-fx-settings="$emit('open-fx-settings')"
    @open-budget-settings="$emit('open-budget-settings')"
    @open-quick="$emit('open-quick')"
    @open-category-manager="$emit('open-category-manager')"
    @use-frequent="$emit('use-frequent')"
    @toggle-filters="$emit('toggle-filters')"
    @clear-filters="$emit('clear-filters')"
    @update-q="$emit('update-q', $event)"
    @update-f-range="$emit('update-f-range', $event)"
    @update-f-from="$emit('update-f-from', $event)"
    @update-f-to="$emit('update-f-to', $event)"
    @update-f-cat="$emit('update-f-cat', $event)"
    @update-f-account="$emit('update-f-account', $event)"
    @update-f-min="$emit('update-f-min', $event)"
    @update-f-max="$emit('update-f-max', $event)"
    @update-f-kind="$emit('update-f-kind', $event)"
    @update-f-direction="$emit('update-f-direction', $event)"
    @open-detail="$emit('open-detail', $event)"
    @transaction-swipe="$emit('transaction-swipe', $event)"
    @swipe-action="$emit('swipe-action', $event)"
    @swipe-open-change="$emit('swipe-open-change', $event)"
    @switch-tab="$emit('switch-tab', $event)"
    @open-review-category="$emit('open-review-category', $event)"
  />

  <BillsPanel
    v-else-if="tab === 'bills'"
    :bills="bills"
    :due-bills="dueBills"
    :later-bills="laterBills"
    :paused-bills="pausedBills"
    :focused-bill-id="focusedBillId"
    :cycles="CYCLES"
    :bill-status="billStatus"
    :bill-date-label="billDateLabel"
    :bill-amount-text="billAmountText"
    @open-bill-form="$emit('open-bill-form', $event)"
    @mark-paid="$emit('mark-paid', $event)"
    @dismiss-pending="$emit('dismiss-pending', $event)"
    @skip-once="$emit('skip-once', $event)"
    @toggle-bill-active="$emit('toggle-bill-active', $event)"
  />

  <ReviewPanel
    v-else
    :review-label="reviewLabel"
    :review-month="reviewMonth"
    :today-month="todayMonth"
    :review-count="reviewCount"
    :review-total="reviewTotal"
    :monthly-review="monthlyReview"
    :most-frequent="mostFrequent"
    :top-category="topCategory"
    :max-single="maxSingle"
    :max-single-mine="maxSingleMine"
    :review-my-share-note="reviewMyShareNote"
    :review-category-rows="reviewCategoryRows"
    :review-category-sum="reviewCategorySum"
    :visible-category-rows="visibleCategoryRows"
    :hidden-category-count="hiddenCategoryCount"
    :expanded-category="expandedCategory"
    :show-all-review-cats="showAllReviewCats"
    :category-limit="REVIEW_CATEGORY_LIMIT"
    :calendar-cells="calendarCells"
    :selected-day="selectedDay"
    :selected-day-info="selectedDayInfo"
    :personal-amount="personalAmount"
    :shift-month="shiftMonth"
    :export-ledger-csv="exportLedgerCsv"
    :export-ledger-xlsx="exportLedgerXlsx"
    :reveal-review-category="revealReviewCategory"
    :toggle-review-category="toggleReviewCategory"
    :open-detail="openDetail"
    @selected-day-change="$emit('selected-day-change', $event)"
    @update:showAllReviewCats="$emit('update:showAllReviewCats', $event)"
  />
</template>

<script setup>
import { computed } from 'vue'
import LedgerHomePanel from './LedgerHomePanel.vue'
import BillsPanel from './BillsPanel.vue'
import ReviewPanel from './ReviewPanel.vue'
import { CYCLES, ledgerToday } from '../../composables/ledger.js'

const props = defineProps({
  tab: { type: String, required: true },
  // LedgerHomePanel
  spendStats: { type: Object, default: () => ({}) },
  currentMonthHasSplit: { type: Boolean, default: false },
  currentMonthPersonal: { type: [Number, String], default: 0 },
  monthCompare: { type: Object, default: () => ({}) },
  fxRateLine: { type: String, default: '' },
  budgetAlert: { type: Object, default: () => ({}) },
  budget: { type: Object, default: () => ({}) },
  pendingBills: { type: Array, default: () => [] },
  billAmountText: { type: Function, default: () => '' },
  billDateLabel: { type: Function, default: () => '' },
  frequent: { type: Array, default: () => [] },
  q: { type: String, default: '' },
  showFilters: { type: Boolean, default: false },
  filtersActive: { type: Boolean, default: false },
  fRange: { type: String, default: '' },
  fFrom: { type: String, default: '' },
  fTo: { type: String, default: '' },
  fCat: { type: String, default: '' },
  fAccount: { type: String, default: '' },
  fMin: { type: [Number, String], default: '' },
  fMax: { type: [Number, String], default: '' },
  fKind: { type: String, default: '' },
  fDirection: { type: String, default: '' },
  allActiveCategories: { type: Array, default: () => [] },
  accountOptions: { type: Array, default: () => [] },
  canExpandFeed: { type: Boolean, default: false },
  filteredExpenses: { type: Array, default: () => [] },
  showAllFeed: { type: Boolean, default: false },
  feedItems: { type: Array, default: () => [] },
  feedItemHeight: { type: Number, default: 0 },
  highlightedTransactionId: { type: [String, Number, null], default: null },
  openSwipeId: { type: [String, Number, null], default: null },
  feedSecondary: { type: Boolean, default: false },
  feedAmount: { type: Function, default: () => '' },
  categoryOverview: { type: Array, default: () => [] },
  monthCategoryKeys: { type: Array, default: () => [] },
  // BillsPanel
  bills: { type: Array, default: () => [] },
  dueBills: { type: Array, default: () => [] },
  laterBills: { type: Array, default: () => [] },
  pausedBills: { type: Array, default: () => [] },
  focusedBillId: { type: [String, Number, null], default: null },
  billStatus: { type: Function, default: () => '' },
  billDateLabel: { type: Function, default: () => '' },
  billAmountText: { type: Function, default: () => '' },
  // ReviewPanel
  reviewLabel: { type: String, default: '' },
  reviewMonth: { type: String, default: '' },
  todayMonth: { type: String, default: () => ledgerToday().slice(0, 7) },
  reviewCount: { type: Number, default: 0 },
  reviewTotal: { type: Number, default: 0 },
  monthlyReview: { type: Array, default: () => [] },
  mostFrequent: { type: Object, default: () => ({}) },
  topCategory: { type: Object, default: () => ({}) },
  maxSingle: { type: Object, default: () => ({}) },
  maxSingleMine: { type: Object, default: () => ({}) },
  reviewMyShareNote: { type: String, default: '' },
  reviewCategoryRows: { type: Array, default: () => [] },
  reviewCategorySum: { type: Object, default: () => ({}) },
  visibleCategoryRows: { type: Array, default: () => [] },
  hiddenCategoryCount: { type: Number, default: 0 },
  expandedCategory: { type: String, default: '' },
  showAllReviewCats: { type: Boolean, default: false },
  categoryLimit: { type: Number, default: 5 },
  calendarCells: { type: Array, default: () => [] },
  selectedDay: { type: String, default: '' },
  selectedDayInfo: { type: Object, default: () => ({}) },
  personalAmount: { type: Function, default: () => 0 },
  shiftMonth: { type: Function, default: () => {} },
  exportLedgerCsv: { type: Function, default: () => {} },
  exportLedgerXlsx: { type: Function, default: () => {} },
  revealReviewCategory: { type: Function, default: () => {} },
  toggleReviewCategory: { type: Function, default: () => {} },
  openDetail: { type: Function, default: () => {} },
})

const emit = defineEmits([
  'show-all-feed-change', 'open-fx-settings', 'open-budget-settings', 'open-quick',
  'open-category-manager', 'use-frequent', 'toggle-filters', 'clear-filters',
  'update-q', 'update-f-range', 'update-f-from', 'update-f-to', 'update-f-cat',
  'update-f-account', 'update-f-min', 'update-f-max', 'update-f-kind',
  'update-f-direction', 'open-detail', 'transaction-swipe', 'swipe-action',
  'swipe-open-change', 'switch-tab', 'open-review-category',
  'open-bill-form', 'mark-paid', 'dismiss-pending', 'skip-once', 'toggle-bill-active',
  'selected-day-change', 'update:showAllReviewCats'
])

// CYCLES 透传给 BillsPanel
const CYCLES_CONST = CYCLES
</script>