<script setup>
import EmptyState from '../../components/EmptyState.vue'

defineProps({
  bills: { type: Array, default: () => [] },
  dueBills: { type: Array, default: () => [] },
  laterBills: { type: Array, default: () => [] },
  pausedBills: { type: Array, default: () => [] },
  focusedBillId: { type: String, default: '' },
  cycles: { type: Object, default: () => ({}) },
  billStatus: { type: Function, required: true },
  billDateLabel: { type: Function, required: true },
  billAmountText: { type: Function, required: true },
  openBillForm: { type: Function, required: true },
  markPaid: { type: Function, required: true },
  dismissPending: { type: Function, required: true },
  skipOnce: { type: Function, required: true },
  toggleBillActive: { type: Function, required: true },
})
</script>

<template>
<!-- ================= 固定账单 ================= -->
<div class="bills-tab">
  <div class="tab-head">
    <p class="tab-desc">不想忘记的周期性费用，到期前会出现在账本首页「待处理」。</p>
    <button class="btn btn-primary" @click="openBillForm()">＋ 添加固定账单</button>
  </div>

  <EmptyState
    v-if="bills.length === 0"
    class="card empty-box"
    icon="📌"
    title="还没有固定账单"
    description="如果有每月、每年重复支付的费用，可以放在这里提醒。"
    primary-label="+ 添加固定账单"
    @primary="openBillForm()"
  />

  <template v-else>
    <section v-if="dueBills.length" class="bill-group">
      <h2 class="block-title">即将到来</h2>
      <div class="bill-list">
        <!-- 同 .feed-item：点这一行是编辑该固定账单的唯一入口（右侧 .b-actions 只有
             「已支付 / 跳过本次」，没有编辑），所以也必须能被键盘激活。 -->
        <!-- 编辑入口是**真按钮**，它只包住名称与金额；`.b-actions` 是它的**兄弟**。
             以前这三行是 `role="button"` 的 div 包着「已支付 / 跳过本次」这两个真按钮——
             按 ARIA 规范，button 的子节点是 presentational，于是内层按钮的语义被**抹掉**：
             读屏既听不到它们是独立控件，行名还会被拼成「编辑固定账单「水费」 已支付 跳过本次」。
             改成真按钮后：键盘/读屏拿到一个具名按钮，内层动作按钮语义完好。
             行上的 `@click` 保留（点空白处也能编辑，纯鼠标便利）——这与键盘可达性判据
             认可的「卡片 + 同动作真按钮」配对一致，所以别再往这一行加 role/tabindex。 -->
        <div
          v-for="bill in dueBills"
          :key="bill.id"
          class="card bill-row"
          :class="[billStatus(bill).cls, { 'focus-target-highlight': focusedBillId === bill.id }]"
          :data-focus-id="bill.id"
          @click="openBillForm({}, bill.id)"
        >
          <button
            type="button"
            class="bill-main tap-target"
            :aria-label="`编辑固定账单「${bill.name}」`"
            @click.stop="openBillForm({}, bill.id)"
          >
            <div class="b-main">
              <b>{{ bill.name }}</b>
              <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}<template v-if="bill.note"> · {{ bill.note }}</template></small>
            </div>
            <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ cycles[bill.cycle]?.short ?? '月' }}</small></div>
          </button>
          <div class="b-actions" @click.stop>
            <button class="btn btn-sm btn-primary" @click="markPaid(bill)">已支付</button>
            <button class="btn btn-sm" @click="dismissPending(bill); skipOnce(bill)">跳过本次</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="laterBills.length" class="bill-group">
      <h2 class="block-title">之后</h2>
      <div class="bill-list">
        <!-- 同「待支付」：编辑入口是真按钮，`.b-actions` 在它外面 -->
        <div
          v-for="bill in laterBills"
          :key="bill.id"
          class="card bill-row"
          :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
          :data-focus-id="bill.id"
          @click="openBillForm({}, bill.id)"
        >
          <button
            type="button"
            class="bill-main tap-target"
            :aria-label="`编辑固定账单「${bill.name}」`"
            @click.stop="openBillForm({}, bill.id)"
          >
            <div class="b-main">
              <b>{{ bill.name }}</b>
              <small>{{ billDateLabel(bill.nextDate) }} · {{ billStatus(bill).text }}</small>
            </div>
            <div class="b-amount">{{ billAmountText(bill) }}<small>/ {{ cycles[bill.cycle]?.short ?? '月' }}</small></div>
          </button>
          <div class="b-actions" @click.stop>
            <button class="btn btn-sm" @click="skipOnce(bill)">跳过本次</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="pausedBills.length" class="bill-group">
      <h2 class="block-title">已暂停</h2>
      <div class="bill-list">
        <!-- 同「待支付」：编辑入口是真按钮，`.b-actions` 在它外面 -->
        <div
          v-for="bill in pausedBills"
          :key="bill.id"
          class="card bill-row paused"
          :class="{ 'focus-target-highlight': focusedBillId === bill.id }"
          :data-focus-id="bill.id"
          @click="openBillForm({}, bill.id)"
        >
          <button
            type="button"
            class="bill-main tap-target"
            :aria-label="`编辑固定账单「${bill.name}」`"
            @click.stop="openBillForm({}, bill.id)"
          >
            <div class="b-main">
              <b>{{ bill.name }}</b>
              <small>已暂停 · 下次 {{ bill.nextDate }}</small>
            </div>
            <div class="b-amount">{{ billAmountText(bill) }}</div>
          </button>
          <div class="b-actions" @click.stop>
            <button class="btn btn-sm" @click="toggleBillActive(bill)">恢复</button>
          </div>
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
.tab-head {
  justify-content:space-between;
  align-items:center;
  gap:12px;
  display:flex}
.tab-desc {
  color:var(--ink-faint);
  margin:0;
  font-size:var(--fs-12-5)}
.bill-group+.bill-group {
  margin-top:18px}
.bill-list {
  flex-direction:column;
  gap:10px;
  display:flex}
.bill-row {
  cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:12px;
  padding:13px 16px;
  display:grid}
.bill-main {
  min-width:0;
  color:inherit;
  font:inherit;
  text-align:left;
  cursor:pointer;
  background:0 0;
  border:0;
  grid-template-columns:minmax(0,1fr) auto;
  align-items:center;
  gap:12px;
  padding:0;
  display:grid}
.bill-row:hover {
  border-color:var(--border-strong);
  box-shadow:var(--shadow-sm)}
.bill-row.over {
  border-color:color-mix(in srgb, var(--danger) 40%, var(--border))}
.b-main {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.b-main b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-14);
  overflow:hidden}
.b-main small {
  color:var(--ink-soft);
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-11-5)}
.b-amount {
  white-space:nowrap;
  font-variant-numeric:tabular-nums;
  font-size:var(--fs-15-5);
  font-weight:var(--fw-800)}
.b-amount small {
  color:var(--ink-faint);
  margin-left:2px;
  font-size:var(--fs-10-5);
  font-weight:var(--fw-600)}
.b-actions {
  gap:6px;
  display:flex}
.bill-row.paused {
  opacity:.6}
.bill-row.today .b-main small {
  color:var(--danger);
  font-weight:var(--fw-700)}
@media (max-width:760px) {
.tab-head {
  flex-direction:column;
  align-items:flex-start;
  gap:8px}
.bill-row {
  grid-template-columns:minmax(0,1fr)}
.bill-main {
  grid-template-columns:minmax(0,1fr) auto}
.b-amount {
  order:-1;
  grid-area:1/2}
.b-main {
  grid-area:1/1}
.b-actions {
  grid-column:1/-1;
  justify-content:flex-start}
.b-actions .btn {
  flex:1}
}
</style>
