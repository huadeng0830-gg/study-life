<script setup>
import { computed, ref } from 'vue'
import Modal from '../components/Modal.vue'
import VirtualList from '../components/VirtualList.vue'
import { fmtDate, todayStr, useStoredRef } from '../composables/store.js'

const bills = useStoredRef('sl_bills', [])
const showForm = ref(false)
const editingId = ref(null)
const error = ref('')
const filter = ref('active')
const form = ref(emptyForm())

const CATEGORIES = ['会员订阅', '生活缴费', '住房', '通讯网络', '保险', '其他']
const CYCLES = {
  weekly: { label: '每周', short: '周', monthFactor: 52 / 12 },
  monthly: { label: '每月', short: '月', monthFactor: 1 },
  quarterly: { label: '每季度', short: '季度', monthFactor: 1 / 3 },
  yearly: { label: '每年', short: '年', monthFactor: 1 / 12 },
  once: { label: '仅一次', short: '次', monthFactor: 0 },
}

function emptyForm() {
  return {
    name: '', amount: '', category: '会员订阅', cycle: 'monthly',
    nextDate: '', autoRenew: true, active: true, note: '',
  }
}

function openAdd() {
  editingId.value = null
  form.value = emptyForm()
  error.value = ''
  showForm.value = true
}

function openEdit(bill) {
  editingId.value = bill.id
  form.value = {
    name: bill.name,
    amount: bill.amount,
    category: bill.category ?? '其他',
    cycle: bill.cycle ?? 'monthly',
    nextDate: bill.nextDate ?? '',
    autoRenew: Boolean(bill.autoRenew),
    active: bill.active !== false,
    note: bill.note ?? '',
  }
  error.value = ''
  showForm.value = true
}

function save() {
  if (!form.value.name.trim()) {
    error.value = '请填写账单或订阅名称'
    return
  }
  if (form.value.amount === '' || Number(form.value.amount) < 0) {
    error.value = '请填写正确金额'
    return
  }
  if (!form.value.nextDate) {
    error.value = '请选择下次支付日期'
    return
  }
  const data = {
    name: form.value.name.trim(),
    amount: Number(form.value.amount),
    category: form.value.category,
    cycle: form.value.cycle,
    nextDate: form.value.nextDate,
    autoRenew: form.value.autoRenew,
    active: form.value.active,
    note: form.value.note.trim(),
  }
  if (editingId.value) {
    const target = bills.value.find((bill) => bill.id === editingId.value)
    if (target) Object.assign(target, data)
  } else {
    bills.value.push({ id: 'bill' + Date.now(), createdAt: new Date().toISOString(), ...data })
  }
  showForm.value = false
}

function remove() {
  bills.value = bills.value.filter((bill) => bill.id !== editingId.value)
  showForm.value = false
}

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

function daysUntilDate(value) {
  if (!value) return Infinity
  const target = new Date(value + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  return Math.round((target - today) / 86400000)
}

function dueStatus(bill) {
  if (bill.active === false) return { text: '已暂停', cls: 'paused' }
  const days = daysUntilDate(bill.nextDate)
  if (days < 0) return { text: `逾期 ${-days} 天`, cls: 'overdue' }
  if (days === 0) return { text: '今天支付', cls: 'today' }
  if (days <= 7) return { text: `${days} 天后`, cls: 'soon' }
  return { text: fmtDate(bill.nextDate), cls: '' }
}

function addMonths(date, count) {
  const day = date.getDate()
  const next = new Date(date.getFullYear(), date.getMonth() + count, 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  next.setDate(Math.min(day, lastDay))
  return next
}

function advanceDate(date, cycle) {
  const next = new Date(date)
  if (cycle === 'weekly') next.setDate(next.getDate() + 7)
  if (cycle === 'monthly') return addMonths(next, 1)
  if (cycle === 'quarterly') return addMonths(next, 3)
  if (cycle === 'yearly') return addMonths(next, 12)
  return next
}

function dateString(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function markPaid(event, id) {
  event.stopPropagation()
  const bill = bills.value.find((item) => item.id === id)
  if (!bill) return
  if (bill.cycle === 'once') {
    bill.active = false
    return
  }
  let next = new Date(bill.nextDate + 'T00:00:00')
  const today = new Date(todayStr() + 'T00:00:00')
  do next = advanceDate(next, bill.cycle)
  while (next <= today)
  bill.nextDate = dateString(next)
}

function toggleActive(event, id) {
  event.stopPropagation()
  const bill = bills.value.find((item) => item.id === id)
  if (bill) bill.active = bill.active === false
}

const summary = computed(() => {
  const active = bills.value.filter((bill) => bill.active !== false)
  const monthly = active.reduce((sum, bill) =>
    sum + Number(bill.amount || 0) * (CYCLES[bill.cycle]?.monthFactor ?? 0), 0)
  return {
    active: active.length,
    monthly,
    yearly: monthly * 12,
    upcoming: active.filter((bill) => {
      const days = daysUntilDate(bill.nextDate)
      return days >= 0 && days <= 30
    }).length,
  }
})

const visibleBills = computed(() =>
  [...bills.value]
    .filter((bill) => filter.value === 'all' || (filter.value === 'active' ? bill.active !== false : bill.active === false))
    .sort((a, b) => {
      if ((a.active !== false) !== (b.active !== false)) return a.active === false ? 1 : -1
      return daysUntilDate(a.nextDate) - daysUntilDate(b.nextDate)
    })
)

// ---------- 支出分析图表（纯 SVG，无第三方库） ----------
const CATEGORY_COLORS = {
  会员订阅: '#456fe8',
  生活缴费: '#10b981',
  住房: '#f59e0b',
  通讯网络: '#8b5cf6',
  保险: '#ec4899',
  其他: '#94a3b8',
}

const categoryStats = computed(() => {
  const map = new Map()
  for (const bill of bills.value.filter((item) => item.active !== false)) {
    const monthly = Number(bill.amount || 0) * (CYCLES[bill.cycle]?.monthFactor ?? 0)
    if (monthly <= 0) continue
    const category = bill.category ?? '其他'
    map.set(category, (map.get(category) ?? 0) + monthly)
  }
  const total = [...map.values()].reduce((sum, value) => sum + value, 0)
  const items = [...map.entries()]
    .map(([name, value]) => ({
      name,
      value,
      pct: total ? (value / total) * 100 : 0,
      color: CATEGORY_COLORS[name] ?? '#94a3b8',
    }))
    .sort((a, b) => b.value - a.value)
  return { items, total }
})

// 环形图分段：基于 stroke-dasharray 累积偏移
const RING_LENGTH = 2 * Math.PI * 40
const donutSegments = computed(() => {
  let accumulated = 0
  return categoryStats.value.items.map((item) => {
    const length = (item.pct / 100) * RING_LENGTH
    const segment = {
      ...item,
      dasharray: `${Math.max(length - 1.5, 0.5)} ${RING_LENGTH - Math.max(length - 1.5, 0.5)}`,
      dashoffset: -accumulated,
    }
    accumulated += length
    return segment
  })
})

// 未来 12 个月支出预测：从下次支付日起按周期模拟
const projection = computed(() => {
  const now = new Date()
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${d.getMonth() + 1}`, total: 0 })
  }
  const index = new Map(months.map((month, i) => [month.key, i]))
  const end = new Date(now.getFullYear(), now.getMonth() + 12, 1)

  for (const bill of bills.value.filter((item) => item.active !== false)) {
    if (!bill.nextDate) continue
    if (bill.cycle === 'once' || !(CYCLES[bill.cycle]?.monthFactor)) {
      const d = new Date(bill.nextDate + 'T00:00:00')
      const key = `${d.getFullYear()}-${d.getMonth()}`
      if (index.has(key)) months[index.get(key)].total += Number(bill.amount || 0)
      continue
    }
    let date = new Date(bill.nextDate + 'T00:00:00')
    let guard = 0
    while (date < end && guard < 300) {
      const key = `${date.getFullYear()}-${date.getMonth()}`
      if (index.has(key)) months[index.get(key)].total += Number(bill.amount || 0)
      date = advanceDate(date, bill.cycle)
      guard++
    }
  }
  return months
})

const CHART_W = 560
const CHART_H = 210
const CHART_PAD = { left: 40, right: 12, top: 18, bottom: 26 }

const projectionChart = computed(() => {
  const values = projection.value.map((month) => month.total)
  const max = Math.max(...values, 1)
  const plotW = CHART_W - CHART_PAD.left - CHART_PAD.right
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const step = plotW / (values.length - 1)
  const points = values.map((value, i) => ({
    x: CHART_PAD.left + i * step,
    y: CHART_PAD.top + (1 - value / max) * plotH,
    value,
    label: projection.value[i].label,
  }))
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1].x.toFixed(1)} ${CHART_H - CHART_PAD.bottom} L${points[0].x.toFixed(1)} ${CHART_H - CHART_PAD.bottom} Z`
  return { points, line, area, max }
})

function moneyShort(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value))
}

</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h2>💳 固定账单</h2>
        <p>集中管理周期账单与会员订阅，减少遗忘扣款和闲置续费</p>
      </div>
      <button class="btn btn-primary" @click="openAdd">＋ 添加账单</button>
    </div>

    <div class="summary-grid">
      <div class="card summary"><span>正在使用</span><b>{{ summary.active }}</b><small>项账单与订阅</small></div>
      <div class="card summary"><span>月度折算</span><b>{{ money(summary.monthly) }}</b><small>按当前周期估算</small></div>
      <div class="card summary"><span>年度预计</span><b>{{ money(summary.yearly) }}</b><small>不包含单次账单</small></div>
      <div class="card summary"><span>30 天内支付</span><b>{{ summary.upcoming }}</b><small>项即将到期</small></div>
    </div>

    <section v-if="bills.length > 0" class="card charts">
      <div class="charts-head">
        <h3>📊 支出分析</h3>
        <span class="charts-sub">基于使用中的账单与订阅估算</span>
      </div>

      <div v-if="categoryStats.total === 0" class="charts-empty">
        没有使用中的周期账单，添加后即可看到支出趋势和分类占比。
      </div>
      <div v-else class="charts-grid">
        <div class="chart-block">
          <span class="chart-title">未来 12 个月支出预测</span>
          <svg :viewBox="`0 0 ${CHART_W} ${CHART_H}`" class="line-chart" role="img" aria-label="未来12个月支出预测曲线">
            <defs>
              <linearGradient id="bill-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.22" />
                <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <text :x="CHART_PAD.left" y="12" class="axis-label">{{ moneyShort(projectionChart.max) }}</text>
            <line
              :x1="CHART_PAD.left" :y1="CHART_PAD.top"
              :x2="CHART_W - CHART_PAD.right" :y2="CHART_PAD.top"
              class="gridline"
            />
            <path :d="projectionChart.area" fill="url(#bill-area)" />
            <path :d="projectionChart.line" fill="none" class="line" />
            <g v-for="p in projectionChart.points" :key="p.label + p.x">
              <circle :cx="p.x" :cy="p.y" r="3.5" class="dot" />
              <text :x="p.x" :y="CHART_H - 8" class="axis-label" text-anchor="middle">{{ p.label }}</text>
              <title>{{ p.label }} 月预计 {{ money(p.value) }}</title>
            </g>
          </svg>
        </div>

        <div class="chart-block">
          <span class="chart-title">分类占比（月度折算）</span>
          <div class="donut-wrap">
            <div class="donut-box">
              <svg viewBox="0 0 120 120" class="donut" role="img" aria-label="分类占比环形图">
                <circle cx="60" cy="60" r="40" fill="none" stroke="#eef1f6" stroke-width="15" />
                <circle
                  v-for="seg in donutSegments"
                  :key="seg.name"
                  cx="60" cy="60" r="40"
                  fill="none"
                  :stroke="seg.color"
                  stroke-width="15"
                  stroke-linecap="butt"
                  :stroke-dasharray="seg.dasharray"
                  :stroke-dashoffset="seg.dashoffset"
                  transform="rotate(-90 60 60)"
                >
                  <title>{{ seg.name }}：{{ money(seg.value) }}/月（{{ seg.pct.toFixed(0) }}%）</title>
                </circle>
              </svg>
              <div class="donut-center">
                <b>{{ money(categoryStats.total) }}</b>
                <span>月均</span>
              </div>
            </div>
            <div class="legend">
              <div v-for="seg in donutSegments" :key="seg.name" class="legend-row">
                <span class="legend-dot" :style="{ background: seg.color }"></span>
                <span class="legend-name">{{ seg.name }}</span>
                <span class="legend-pct">{{ seg.pct.toFixed(0) }}%</span>
                <span class="legend-value">{{ money(seg.value) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="bill-toolbar">
      <button :class="{ on: filter === 'active' }" @click="filter = 'active'">使用中</button>
      <button :class="{ on: filter === 'paused' }" @click="filter = 'paused'">已暂停</button>
      <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
    </div>

    <div v-if="bills.length === 0" class="card empty-state">
      <span>🧾</span><h3>还没有固定账单</h3>
      <p>可以先添加手机套餐、视频会员、房租或水电费。</p>
      <button class="btn btn-primary" @click="openAdd">添加第一项</button>
    </div>
    <div v-else-if="visibleBills.length === 0" class="card empty-state compact">这个列表暂时是空的。</div>

    <VirtualList v-else v-slot="{ item: bill }" class="bill-list" :items="visibleBills" :estimated-height="120" :gap="10" :threshold="40">
      <article
        class="card bill"
        :class="{ inactive: bill.active === false }"
        @click="openEdit(bill)"
      >
        <div class="bill-icon">{{ bill.category === '会员订阅' ? 'S' : '¥' }}</div>
        <div class="bill-copy">
          <div class="bill-tags">
            <span>{{ bill.category ?? '其他' }}</span>
            <span v-if="bill.autoRenew" class="renew-tag">自动续费</span>
          </div>
          <h3>{{ bill.name }}</h3>
          <p>{{ bill.note || `下次支付：${fmtDate(bill.nextDate)}` }}</p>
        </div>
        <div class="bill-price">
          <strong>{{ money(bill.amount) }}</strong>
          <span>/ {{ CYCLES[bill.cycle]?.short ?? '月' }}</span>
        </div>
        <span class="due-tag" :class="dueStatus(bill).cls">{{ dueStatus(bill).text }}</span>
        <div class="bill-actions">
          <button v-if="bill.active !== false" @click="markPaid($event, bill.id)">记为已支付</button>
          <button @click="toggleActive($event, bill.id)">{{ bill.active === false ? '恢复' : '暂停' }}</button>
        </div>
      </article>
    </VirtualList>

    <Modal :open="showForm" :title="editingId ? '编辑账单' : '添加账单'" @close="showForm = false">
      <div class="form">
        <label>名称 *</label>
        <input v-model="form.name" placeholder="例如：视频会员或宿舍电费" />
        <div class="form-row">
          <div><label>金额 *</label><input v-model="form.amount" type="number" min="0" step="0.01" /></div>
          <div><label>周期</label><select v-model="form.cycle"><option v-for="(cycle, key) in CYCLES" :key="key" :value="key">{{ cycle.label }}</option></select></div>
        </div>
        <div class="form-row">
          <div><label>类别</label><select v-model="form.category"><option v-for="category in CATEGORIES" :key="category">{{ category }}</option></select></div>
          <div><label>下次支付日期 *</label><input v-model="form.nextDate" type="date" /></div>
        </div>
        <label>备注</label>
        <input v-model="form.note" placeholder="选填，例如：家庭共享套餐" />
        <div class="option-row">
          <label><input v-model="form.autoRenew" type="checkbox" /> 自动续费</label>
          <label><input v-model="form.active" type="checkbox" /> 正在使用</label>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.head h2 { font-size: 22px; }
.head p { margin-top: 5px; color: var(--muted); font-size: 13px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.summary { display: flex; flex-direction: column; gap: 3px; padding: 17px 18px; }
.summary span, .summary small { color: var(--muted); font-size: 11px; }
.summary b { font-size: 22px; }
.bill-toolbar { display: flex; gap: 5px; width: fit-content; padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.bill-toolbar button { padding: 7px 12px; color: var(--muted); font-size: 12px; border: none; border-radius: 7px; background: transparent; }
.bill-toolbar button.on { color: var(--primary); font-weight: 700; background: var(--primary-soft); }
.empty-state { display: flex; align-items: center; flex-direction: column; gap: 8px; padding: 54px 20px; text-align: center; }
.empty-state > span { font-size: 34px; }
.empty-state p { color: var(--muted); font-size: 13px; }
.empty-state .btn { margin-top: 8px; }
.empty-state.compact { color: var(--muted); font-size: 13px; }
.bill-list { display: flex; flex-direction: column; gap: 10px; }
.bill { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 14px; padding: 17px 18px; cursor: pointer; }
.bill:hover { box-shadow: var(--shadow-md); }
.bill.inactive { opacity: .58; }
.bill-icon { display: grid; place-items: center; width: 42px; height: 42px; color: var(--primary); font-size: 15px; font-weight: 900; border-radius: 12px; background: var(--primary-soft); }
.bill-copy { min-width: 0; }
.bill-tags { display: flex; gap: 5px; margin-bottom: 4px; }
.bill-tags span { padding: 3px 6px; color: var(--primary); font-size: 9px; font-weight: 700; border-radius: 5px; background: var(--primary-soft); }
.bill-tags .renew-tag { color: #07805d; background: #e7f8f1; }
.bill-copy h3 { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.bill-copy p { overflow: hidden; margin-top: 3px; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.bill-price { display: flex; align-items: baseline; white-space: nowrap; }
.bill-price strong { font-size: 18px; }
.bill-price span { color: var(--muted); font-size: 10px; }
.due-tag { min-width: 82px; color: var(--muted); font-size: 11px; text-align: center; }
.due-tag.today, .due-tag.soon { padding: 5px 7px; color: #b86b16; font-weight: 700; border-radius: 6px; background: #fff5df; }
.due-tag.overdue { padding: 5px 7px; color: var(--danger); font-weight: 700; border-radius: 6px; background: #feecec; }
.due-tag.paused { padding: 5px 7px; border-radius: 6px; background: var(--bg); }
.bill-actions { grid-column: 2 / -1; display: flex; justify-content: flex-end; gap: 6px; margin-top: -4px; }
.bill-actions button { padding: 5px 8px; color: var(--muted); font-size: 11px; border: none; border-radius: 6px; background: var(--bg); }
.bill-actions button:first-child { color: var(--primary); background: var(--primary-soft); }
.form { display: flex; flex-direction: column; gap: 8px; }
.form label { margin-top: 6px; color: var(--muted); font-size: 13px; }
.form input, .form select { width: 100%; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-row > div { display: flex; flex-direction: column; gap: 7px; }
.option-row { display: flex; gap: 18px; margin-top: 8px; }
.option-row label { display: flex; align-items: center; gap: 6px; color: var(--text); cursor: pointer; }
.option-row input { width: auto; accent-color: var(--primary); }
.error { color: var(--danger); font-size: 13px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
@media (max-width: 1000px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
@media (max-width: 700px) {
  .head { align-items: flex-start; flex-direction: column; }
  .head .btn { width: 100%; }
  .bill { grid-template-columns: auto minmax(0, 1fr) auto; }
  .due-tag { grid-column: 2 / -1; justify-self: start; }
  .bill-actions { grid-column: 2 / -1; justify-content: flex-start; }
}
@media (max-width: 520px) {
  .summary-grid { grid-template-columns: 1fr; }
  .bill-price { grid-column: 2; }
  .bill { align-items: flex-start; grid-template-columns: auto minmax(0, 1fr); }
  .due-tag, .bill-actions { grid-column: 2; }
  .form-row { grid-template-columns: 1fr; }
}

/* ---------- 支出分析图表 ---------- */
.charts {
  padding: 20px 22px;
}
.charts-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}
.charts-head h3 {
  font-size: 15px;
}
.charts-sub {
  color: var(--muted);
  font-size: 11px;
}
.charts-empty {
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  padding: 26px 0;
}
.charts-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 1fr);
  gap: 22px;
}
.chart-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chart-title {
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.line-chart {
  width: 100%;
  height: auto;
}
.line-chart .line {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.line-chart .dot {
  fill: #fff;
  stroke: var(--primary);
  stroke-width: 2;
}
.line-chart .axis-label {
  fill: var(--muted);
  font-size: 9px;
}
.line-chart .gridline {
  stroke: var(--border);
  stroke-dasharray: 4 4;
}
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 18px;
}
.donut-box {
  position: relative;
  width: 132px;
  height: 132px;
  flex: 0 0 132px;
}
.donut {
  width: 100%;
  height: 100%;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.donut-center b {
  font-size: 14px;
  font-weight: 800;
}
.donut-center span {
  margin-top: 1px;
  color: var(--muted);
  font-size: 10px;
}
.legend {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.legend-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 10px;
  border-radius: 3px;
}
.legend-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-pct {
  color: var(--muted);
  font-size: 11px;
}
.legend-value {
  min-width: 64px;
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1000px) {
  .charts-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .donut-wrap {
    flex-direction: column;
    align-items: stretch;
  }
  .donut-box {
    align-self: center;
  }
}
</style>
