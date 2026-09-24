<script setup>
import { defineProps, defineEmits } from 'vue'
import EmptyState from '../../components/EmptyState.vue'

const props = defineProps({
  bills: { type: Array, default: () => [] },
  dueBills: { type: Array, default: () => [] },
  laterBills: { type: Array, default: () => [] },
  focusedBillId: { type: String, default: '' },
  billStatus: { type: Function, required: true },
  billAmountText: { type: Function, required: true },
  billDateLabel: { type: Function, required: true },
  CYCLES: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'open-bill-form',
  'mark-paid',
  'dismiss-pending',
  'skip-once',
])
</script>

<template>
  <div class="bills-tab">
    <div class="tab-head">
      <p class="tab-desc">不想忘记的周期性费用，到期前会出现在账本首页「待处理」。</p>
      <button class="btn btn-primary" @click="$emit('open-bill-form')">＋ 添加固定账单</button>
    </div>

    <EmptyState
      v-if="bills.length === 0"
      class="card empty-box"
      icon="📌"
      title="还没有固定账单"
      description="如果有每月、每年重复支付的费用，可以放在这里提醒。"
      primary-label="+ 添加固定账单"
      @primary="$emit('open-bill-form')"
    />

    <template v-else>
      <section v-if="dueBills.length" class="bill-group">
        <h2 class="block-title">即将到来</h2>
        <div class="bill-list">
          <div
            v-for="bill in dueBills"
            :key="bill.id"
            class="card bill-row"
            :class="[billStatus(bill).cls, { 'focus-target-highlight': focusedBillId === bill.id }]"
            :data-focus-id="bill.id"
          >
            <button
              type="button"
              class="bill-main tap-target"
              :aria-label="`编辑固定账单「${bill.name}」`"
              @click="$emit('open-bill-form', {}, bill.id)"
            >
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}<template v-if="bill.note"> · {{ bill.note }}</template></small>
              </div>
              <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
            </button>
            <div class="b-actions" @click.stop>
              <button class="btn btn-sm btn-primary" @click="$emit('mark-paid', bill)">已支付</button>
              <button class="btn btn-sm" @click="$emit('dismiss-pending', bill); $emit('skip-once', bill)">跳过本次</button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="laterBills.length" class="bill-group">
        <h2 class="block-title">之后</h2>
        <div class="bill-list">
          <div
            v-for="bill in laterBills"
            :key="bill.id"
            class="card bill-row"
            :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
            :data-focus-id="bill.id"
          >
            <button
              type="button"
              class="bill-main tap-target"
              :aria-label="`编辑固定账单「${bill.name}」`"
              @click="$emit('open-bill-form', {}, bill.id)"
            >
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}<template v-if="bill.note"> · {{ bill.note }}</template></small>
              </div>
              <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
            </button>
            <div class="b-actions" @click.stop>
              <button class="btn btn-sm btn-primary" @click="$emit('mark-paid', bill)">已支付</button>
              <button class="btn btn-sm" @click="$emit('dismiss-pending', bill); $emit('skip-once', bill)">跳过本次</button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="pausedBills.length" class="bill-group">
        <h2 class="block-title">已暂停</h2>
        <div class="bill-list">
          <div
            v-for="bill in pausedBills"
            :key="bill.id"
            class="card bill-row paused"
            :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
            :data-focus-id="bill.id"
          >
            <button
              type="button"
              class="bill-main tap-target"
              :aria-label="`编辑固定账单「${bill.name}」`"
              @click="$emit('open-bill-form', {}, bill.id)"
            >
              <div class="b-main">
                <b>{{ bill.name }}</b>
                <small>{{ billDateLabel(bill.nextDate) }} · 暂停中<template v-if="bill.note"> · {{ bill.note }}</template></small>
              </div>
              <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</small></div>
            </button>
            <div class="b-actions" @click.stop>
              <button class="btn btn-sm btn-primary" @click="$emit('mark-paid', bill)">已支付</button>
              <button class="btn btn-sm" @click="$emit('dismiss-pending', bill); $emit('skip-once', bill)">跳过本次</button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>