<script setup>
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import EmptyState from './EmptyState.vue'
import { todayStr, useStoredRef } from '../composables/store'
import { dayStory, monthReport, yearReport, daySnapshot } from '../composables/retrospective.js'
import { moodLog } from '../composables/atmosphereStore.js'
import { useShareText } from '../composables/useShareText.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const exams = useStoredRef('sl_exams', [])
const bills = useStoredRef('sl_bills', [])
const expenses = useStoredRef('sl_expenses', [])
const events = useStoredRef('sl_events', [])
const notes = useStoredRef('sl_quick_notes', [])

// 年度报告“年末首次打开”一次性提示：仅在 12 月打开时提示一次，year 已提示的年份不再提示。
const yearNotice = useStoredRef('sl_retro_year_notice', '')

const { share, copy } = useShareText()

const tab = ref('day')
const day = ref(todayStr())
const month = ref(todayStr().slice(0, 7))
const year = ref(String(new Date().getFullYear()))
const shareMessage = ref('')
let shareMessageTimer = 0

const TABS = [
  { key: 'day', label: '那天' },
  { key: 'month', label: '月度' },
  { key: 'year', label: '年度' },
]

const dataset = computed(() => ({
  courses: courses.value,
  tasks: tasks.value,
  exams: exams.value,
  bills: bills.value,
  expenses: expenses.value,
  events: events.value,
  notes: notes.value,
  moodLog: moodLog.value,
}))

const years = computed(() => {
  const set = new Set([String(new Date().getFullYear())])
  for (const list of [tasks.value, exams.value, bills.value, expenses.value, events.value, notes.value]) {
    for (const item of list) {
      const pre = String(item?.date ?? item?.dueDate ?? item?.nextDate ?? '').slice(0, 4)
      if (/^\d{4}$/.test(pre)) set.add(pre)
    }
  }
  return [...set].sort()
})

const report = computed(() => {
  if (tab.value === 'day') return dayStory(day.value, dataset.value)
  if (tab.value === 'month') return monthReport(month.value, dataset.value)
  return yearReport(year.value, dataset.value)
})

const hasContent = computed(() => {
  if (tab.value === 'day') {
    const s = daySnapshot(day.value, dataset.value).stats
    return s.courses + s.tasks + s.exams + s.bills + s.expensesCount + s.events + s.notes > 0
  }
  const pre = tab.value === 'month' ? month.value : year.value
  const startsWith = (value) => String(value ?? '').startsWith(pre)
  return tasks.value.some((t) => startsWith(t.dueDate))
    || expenses.value.some((e) => startsWith(e.date))
    || exams.value.some((e) => (e.repeat === 'yearly' ? Boolean(e.date) : startsWith(e.date)))
    || bills.value.some((b) => startsWith(b.nextDate))
    || events.value.some((item) => startsWith(item.date))
    || notes.value.some((item) => startsWith(item.createdAt))
    || (tab.value === 'month' && Object.keys(moodLog.value).some((key) => key.startsWith(pre)))
})

function selectTab(next) {
  tab.value = next
  shareMessage.value = ''
  if (next === 'year') maybeShowYearHint()
}

function maybeShowYearHint() {
  const now = new Date()
  if (now.getMonth() !== 11) return
  if (yearNotice.value === String(now.getFullYear())) return
  yearNotice.value = String(now.getFullYear())
  shareMessage.value = '✨ 这一年就要结束了，翻翻这一年的足迹吧。'
  scheduleClearMessage()
}

function scheduleClearMessage() {
  window.clearTimeout(shareMessageTimer)
  shareMessageTimer = window.setTimeout(() => { shareMessage.value = '' }, 4200)
}

function reportToText(reportData) {
  const lines = [reportData.title, '']
  for (const block of reportData.blocks) {
    if (block.type === 'p') lines.push(block.text)
    else if (block.type === 'stat') lines.push(block.items.map((item) => `${item.label} ${item.value}`).join(' · '))
    else if (block.type === 'list') {
      lines.push(`【${block.title}】`)
      lines.push(...(block.items.length ? block.items.map((item) => `· ${item}`) : ['（无）']))
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

async function onShare() {
  const text = reportToText(report.value)
  const result = await share(text, { title: report.value.title })
  let message = ''
  if (result.cancelled) return
  if (result.ok) message = result.method === 'share' ? '已打开系统分享' : '已复制到剪贴板'
  else message = '分享失败，请稍后重试'
  shareMessage.value = message
  scheduleClearMessage()
}

async function onCopy() {
  const result = await copy(reportToText(report.value))
  shareMessage.value = result.ok ? '已复制到剪贴板' : '复制失败，请稍后重试'
  scheduleClearMessage()
}

watch(() => props.open, (open) => {
  if (open) {
    tab.value = 'day'
    day.value = todayStr()
    month.value = todayStr().slice(0, 7)
    year.value = String(new Date().getFullYear())
    shareMessage.value = ''
  }
})
</script>

<template>
  <Modal :open="open" title="📖 回放" wide @close="emit('close')">
    <div class="memory">
      <div class="memory-bar">
        <div class="segmented" role="tablist" aria-label="回放时间范围">
          <button v-for="item in TABS" :key="item.key" :class="{ on: tab === item.key }" @click="selectTab(item.key)">{{ item.label }}</button>
        </div>

        <div class="memory-picker">
          <label v-if="tab === 'day'"><input v-model="day" type="date" /></label>
          <label v-else-if="tab === 'month'"><input v-model="month" type="month" /></label>
          <label v-else><select v-model="year" aria-label="选择年份"><option v-for="y in years" :key="y" :value="y">{{ y }} 年</option></select></label>
        </div>

        <div class="memory-actions">
          <button type="button" class="btn btn-ghost" @click="onCopy">复制</button>
          <button type="button" class="btn btn-primary" @click="onShare">分享</button>
        </div>
      </div>

      <p v-if="shareMessage" class="memory-message" role="status">{{ shareMessage }}</p>

      <EmptyState
        v-if="!hasContent"
        class="card memory-empty"
        icon="🍃"
        title="这一天还没有留下记录"
        description="课程、待办、账单、消费或心情记录都会在回放里汇成一段叙事。"
      />

      <article v-else class="story">
        <h2 class="story-title">{{ report.title }}</h2>
        <template v-for="(block, index) in report.blocks" :key="index">
          <p v-if="block.type === 'p'" class="story-p">{{ block.text }}</p>
          <div v-else-if="block.type === 'stat'" class="story-stats">
            <div v-for="item in block.items" :key="item.label" class="stat-cell">
              <b>{{ item.value }}</b>
              <span>{{ item.label }}</span>
            </div>
          </div>
          <section v-else-if="block.type === 'list'" class="story-list">
            <h3>{{ block.title }}</h3>
            <ul>
              <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
            </ul>
          </section>
        </template>
      </article>
    </div>
  </Modal>
</template>

<style scoped>
.memory {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.memory-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.memory-picker input,
.memory-picker select {
  padding: 7px 9px;
}
.memory-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
.memory-message {
  padding: 8px 12px;
  color: var(--primary);
  font-size: 12.5px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--primary-soft);
}
.memory-empty {
  margin-top: 4px;
}
.story {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--card);
}
.story-title {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.story-p {
  color: var(--ink-soft);
  font-size: 13.5px;
  line-height: 1.7;
}
.story-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 10px;
}
.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-tint);
}
.stat-cell b {
  font-size: 17px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}
.stat-cell span {
  color: var(--ink-faint);
  font-size: 11.5px;
}
.story-list h3 {
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}
.story-list ul {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.story-list li {
  color: var(--ink-soft);
  font-size: 13px;
}

@media (max-width: 520px) {
  .memory-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .memory-actions {
    margin-left: 0;
    justify-content: flex-end;
  }
  .memory-actions .btn {
    min-height: 40px;
  }
  .story {
    padding: 14px;
  }
}
</style>
