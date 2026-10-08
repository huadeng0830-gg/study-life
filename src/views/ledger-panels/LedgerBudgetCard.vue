<script setup>
import { moneyWithCurrency } from '../../utils/formatters.js'

const props = defineProps({
  budgetAlert: { type: Object, default: null },
  budgetBaseCurrency: { type: String, default: 'CNY' },
  budget: { type: Object, default: () => ({ monthly: null }) },
})

const emit = defineEmits(['open-budget-settings'])
</script>

<template>
  <section class="budget-card card" :class="props.budgetAlert ? `is-${props.budgetAlert.level}` : 'is-unset'" aria-label="本月预算">
    <div class="budget-card-head">
      <div class="budget-card-title">
        <span>本月预算</span>
        <b v-if="props.budgetAlert">{{ Math.max(0, props.budgetAlert.pct) }}% <small>已用</small></b>
        <small v-else>尚未设置</small>
      </div>
      <button class="link-btn" type="button" @click="emit('open-budget-settings')">{{ props.budget.monthly === null ? '设置预算' : '预算设置' }}</button>
    </div>
    <div
      v-if="props.budgetAlert"
      class="budget-meter"
      role="meter"
      aria-label="本月预算使用比例"
      aria-valuemin="0"
      :aria-valuemax="props.budgetAlert.budget"
      :aria-valuenow="Math.max(0, Math.min(props.budgetAlert.budget, props.budgetAlert.spent))"
      :aria-valuetext="`${Math.max(0, props.budgetAlert.pct)}% 已用`"
    >
      <i :style="{ width: `${Math.max(0, Math.min(100, props.budgetAlert.pct))}%` }"></i>
    </div>
    <div v-if="props.budgetAlert" class="budget-card-foot">
      <span class="budget-metric budget-remaining" :class="{ over: props.budgetAlert.remaining < 0 }">
        <small>{{ props.budgetAlert.remaining < 0 ? '本月已超出' : '本月剩余预算' }}</small>
        <b>{{ moneyWithCurrency(Math.abs(props.budgetAlert.remaining), props.budgetBaseCurrency) }}</b>
      </span>
      <span v-if="props.budgetAlert.pacing" class="budget-metric budget-daily" role="status">
        <small>后续每天可用</small>
        <template v-if="props.budgetAlert.pacing.daysAfterToday > 0">
          <b>{{ moneyWithCurrency(props.budgetAlert.pacing.futureDailyAllowance, props.budgetBaseCurrency) }} <small>/天</small></b>
          <small>未来 {{ props.budgetAlert.pacing.daysAfterToday }} 天平均，不含今天</small>
        </template>
        <template v-else>
          <b>—</b>
          <small>今天是本月最后一天</small>
        </template>
      </span>
      <span
        v-if="props.budgetAlert.pacing"
        class="budget-metric budget-today"
        :class="{ over: props.budgetAlert.pacing.todayRemaining < 0 }"
        role="status"
      >
        <small>{{ props.budgetAlert.pacing.todayRemaining < 0 ? '今日已超额度' : props.budgetAlert.pacing.todayRemaining === 0 ? '今日额度已用完' : '今日剩余额度' }}</small>
        <b>{{ moneyWithCurrency(Math.abs(props.budgetAlert.pacing.todayRemaining), props.budgetBaseCurrency) }}</b>
        <small>今日固定 {{ moneyWithCurrency(props.budgetAlert.pacing.todayAllowance, props.budgetBaseCurrency) }}</small>
      </span>
    </div>
    <p v-if="props.budgetAlert?.pacing?.daysAfterToday > 0" class="budget-pacing-note">
      今日消费先扣今日固定额度；未超过今日固定额度时，后续每天可用保持不变，超出部分才会降低后续额度。
    </p>
    <details v-if="props.budgetAlert?.pacing" class="budget-explanation">
      <summary>额度怎么算</summary>
      <div>
        <p>今日固定额度 = max(0，(月预算 − 今天以前的净支出) ÷ 含今天的剩余天数)；今日剩余额度 = 今日固定额度 − 今日净支出，退款最多恢复到固定额度。</p>
        <p>后续每天可用 = max(0，(本月剩余预算 − 今日尚未用完的额度) ÷ 今天之后的天数)。今日已经单独计算，不会重复分给未来；今天超出固定额度的部分会压低后续额度。</p>
        <p>支出按你承担的金额计算，退款抵扣支出，外币按已设置的汇率折算；收入不计入预算支出。</p>
      </div>
    </details>
    <p v-else class="budget-setup-note">设置月度上限后，这里会显示预算使用比例、后续每日额度和今日剩余额度。</p>
  </section>
</template>

<style scoped>
.budget-card {
  flex-direction:column;
  gap:11px;
  padding:14px 16px;
  display:flex}
.budget-card-head,
.budget-card-title,
.budget-card-foot {
  align-items:center;
  justify-content:space-between;
  gap:10px;
  display:flex}
.budget-card-title {
  justify-content:flex-start;
  color:var(--ink-soft);
  font-size:var(--fs-12-5);
  font-weight:var(--fw-700)}
.budget-card-title>b {
  color:var(--primary);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-15);
  font-weight:var(--fw-850)}
.budget-card-title small {
  color:var(--ink-faint);
  font-size:var(--fs-11);
  font-weight:var(--fw-600)}
.budget-meter {
  background:var(--bg-tint);
  border:1px solid var(--border);
  border-radius:var(--radius-pill);
  height:9px;
  overflow:hidden}
.budget-meter i {
  min-width:0;
  height:100%;
  background:var(--primary);
  border-radius:inherit;
  transition:width var(--dur-normal) var(--ease-standard);
  display:block}
.budget-card.is-near .budget-meter i { background:var(--warning) }
.budget-card.is-over .budget-meter i { background:var(--danger) }
.budget-card-foot {
  grid-template-columns:repeat(3,minmax(0,1fr));
  align-items:stretch;
  gap:9px;
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5);
  display:grid}
.budget-metric {
  gap:5px;
  min-width:0;
  padding:10px;
  border-radius:var(--radius-9);
  background:var(--bg-tint);
  flex-direction:column;
  align-items:flex-start;
  display:flex}
.budget-metric>small {
  color:var(--ink-faint);
  font-size:var(--fs-10-5);
  line-height:1.35}
.budget-metric>b {
  color:var(--text);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-18);
  font-weight:var(--fw-800);
  overflow-wrap:anywhere}
.budget-metric>b>small {
  font-size:var(--fs-11);
  font-weight:var(--fw-600)}
.budget-remaining.over,
.budget-remaining.over>b,
.budget-today.over,
.budget-today.over>b { color:var(--danger) }
.budget-today { background:var(--primary-soft) }
.budget-today>b { color:var(--primary) }
.budget-pacing-note {
  color:var(--ink-faint);
  font-size:var(--fs-10-5);
  line-height:1.45;
  margin:-2px 0 0}
.budget-explanation { color:var(--ink-soft); font-size:var(--fs-11); line-height:1.55 }
.budget-explanation summary { width:max-content; color:var(--primary); cursor:pointer; font-weight:var(--fw-700) }
.budget-explanation>div { display:grid; gap:4px; padding:8px 10px; border-radius:var(--radius-9); background:var(--bg-tint) }
.budget-explanation p { margin:0 }
.budget-setup-note {
  color:var(--ink-faint);
  font-size:var(--fs-10-5);
  line-height:1.45;
  margin:0}
@media (max-width:520px) {
  .budget-card-foot {
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:6px}
  .budget-remaining { grid-column:1/-1 }
}
</style>
