<script setup>
import { defineProps, defineEmits } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import { moneyHero, moneyRow } from '../../utils/formatters.js'

const props = defineProps({
  reviewLabel: { type: String, required: true },
  reviewMonth: { type: String, required: true },
  reviewCount: { type: Number, default: 0 },
  monthlyReview: { type: Object, default: () => ({}) },
  reviewTotal: { type: Number, default: 0 },
  mostFrequent: { type: Object, default: null },
  topCategory: { type: Object, default: null },
  maxSingle: { type: Object, default: null },
  maxSingleMine: { type: Number, default: 0 },
  reviewMyShareNote: { type: String, default: '' },
  categoryBars: { type: Array, default: () => [] },
  calendarCells: { type: Array, default: () => [] },
  selectedDay: { type: [String, Number], default: null },
  selectedDayInfo: { type: Object, default: null },
  catInfo: { type: Function, required: true },
  dotClass: { type: Function, required: true },
  cellLabel: { type: Function, required: true },
  personalAmount: { type: Function, required: true },
})

const emit = defineEmits([
  'shift-month',
  'export-ledger-csv',
  'export-ledger-xlsx',
  'open-detail',
  'selected-day-change',
])
</script>

<template>
  <div class="review-tab">
    <div class="month-nav card">
      <button class="mn-btn tap-target" aria-label="上一个月" @click="$emit('shift-month', -1)">‹</button>
      <b>{{ reviewLabel }}</b>
      <button class="mn-btn tap-target" aria-label="下一个月" :disabled="reviewMonth >= reviewLabel.replace('年', '-').replace('月', '').slice(0, 7)" @click="$emit('shift-month', 1)">›</button>
      <span class="review-export" role="group" aria-label="导出账单">
        <button class="btn btn-sm" type="button" @click="$emit('export-ledger-csv')">导出 CSV</button>
        <button class="btn btn-sm" type="button" @click="$emit('export-ledger-xlsx')">导出 Excel</button>
      </span>
    </div>

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
          <span>记录了 {{ reviewCount }} 笔<template v-if="monthlyReview.refundTotal"> · 退款 ¥{{ monthlyReview.refundTotal.toFixed(2) }}</template></span>
          <b>{{ moneyHero(reviewTotal) }}</b>
        </div>
        <div class="rs-facts">
          <div v-if="mostFrequent"><small>最常记录</small><b>{{ mostFrequent.name }} · {{ mostFrequent.count }}次</b></div>
          <div v-if="topCategory"><small>花得最多</small><b>{{ catInfo(topCategory.cat).name }} · {{ moneyRow(topCategory.total) }}</b></div>
          <div v-if="maxSingle"><small>最大一笔</small><b>{{ maxSingle.name }} · {{ moneyRow(maxSingleMine) }}</b></div>
        </div>
        <p v-if="reviewMyShareNote" class="form-note">{{ reviewMyShareNote }}</p>
      </section>

      <section class="review-cats card">
        <h2 class="block-title">分类分布</h2>
        <div class="cat-bars">
          <div v-for="bar in categoryBars" :key="bar.key" class="cat-bar-row">
            <span class="cb-name">{{ bar.info.icon }} {{ bar.info.name }}</span>
            <span class="cb-track"><i :style="{ width: bar.pct + '%' }"></i></span>
            <span class="cb-value">{{ moneyRow(bar.value) }}</span>
          </div>
        </div>
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
          <div
            v-for="e in selectedDayInfo.items"
            :key="e.id"
            class="cd-row tap-target"
            role="button"
            tabindex="0"
            :aria-label="`查看「${e.name}」的详情`"
            @click="$emit('open-detail', e.id)"
            @keydown.enter.prevent="$emit('open-detail', e.id)"
            @keydown.space.prevent="$emit('open-detail', e.id)"
          >
            <span>{{ e.name }}</span><small>{{ catInfo(e.cat).name }} · {{ e.time }}</small><b>{{ moneyRow(personalAmount(e)) }}</b>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>