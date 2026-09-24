<script setup>
import { computed, ref } from 'vue'
import { useStoredRef } from '../composables/store'
import { moodLog } from '../composables/atmosphereStore.js'
import { selectWeeklyReview } from '../composables/domain/weeklySelectors.js'
import { appNow } from '../composables/timeContext.js'
import { useDomainCommands } from '../composables/domain/commands.js'

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const milestones = useStoredRef('sl_exams', [])
const bills = useStoredRef('sl_bills', [])
const transactions = useStoredRef('sl_expenses', [], { deep: false })
const events = useStoredRef('sl_events', [])
const notes = useStoredRef('sl_quick_notes', [])

// ⚠ 这里原来写的是 `const { notes: noteCommands } = useDomainCommands()`，而
// `useDomainCommands()` 返回的 `notes` 是**存储 ref**（数组），不是命令对象——
// `noteCommands.createNote` 从来就不存在，点「一键生成回顾笔记」会在这一行直接抛
// `TypeError: noteCommands.createNote is not a function`。命令按仓库惯例从
// `domain.createNote` 上取（TasksView / quickRecord/adapters.js 都是这个写法）。
const domain = useDomainCommands()

const review = computed(() => selectWeeklyReview({
  tasks: tasks.value,
  courses: courses.value,
  milestones: milestones.value,
  bills: bills.value,
  transactions: transactions.value,
  events: events.value,
  notes: notes.value,
  moodLog: moodLog.value,
}, appNow.value))

const weekLabel = computed(() => `${review.value.week.startDate} — ${new Date(`${review.value.week.endDate}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`)
const moodLabel = computed(() => ({ sunny: '晴朗', cloudy: '多云', rain: '低落' }[review.value.mood.dominant] || '未记录'))

// 生成回顾笔记的结果提示。改造前这里是两处**原生 `alert()`**：浏览器级对话框，阻塞页面、
// 不受主题控制、读屏拿不到，而且在测试环境（happy-dom）里 `alert` 是 `undefined`，
// 调用直接抛 TypeError，这条路径根本没法验证。现在按本仓最常见的做法改成页面内联提示
// （与 NotesView 的 noteMessage / TodayView 的 showExperienceMessage 同一形态）。
// 行为上唯一的变化是"不再阻塞"——两句文案逐字未改。
const reviewMessage = ref('')

function generateReviewNote() {
  const r = review.value
  const lines = [
    `# 本周回顾（${weekLabel.value}）`,
    '',
    '## 待办完成',
    `- 完成：${r.tasks.completed} 项（作业 ${r.tasks.homeworkCompleted} · 复习 ${r.tasks.reviewCompleted}）`,
    `- 新增：${r.tasks.created} 项`,
    `- 待处理：${r.tasks.pending} 项`,
    `- 专注：${r.tasks.focusMinutes} 分钟`,
    '',
    '## 学习节奏',
    `- 课程：${r.courses.sessions} 节（${r.courses.courses} 门）`,
    `- 笔记新增：${r.notes.created} 条`,
    '',
    '## 收支',
    `- 支出：¥${r.finance.expense.toFixed(2)}`,
    `- 收入：¥${r.finance.income.toFixed(2)}`,
    `- 交易笔数：${r.finance.count}`,
    r.finance.categories.length ? `- 分类 TOP：${r.finance.categories.slice(0, 3).map(c => `${c.key} ¥${c.amount.toFixed(2)}`).join('、')}` : '',
    `- 账单应付：${r.bills.due} · 已支付 ${r.bills.paid} (¥${r.bills.paidAmount.toFixed(2)})`,
    '',
    '## 心情',
    `- 本周：${moodLabel.value}（记录 ${r.mood.days} 天）`,
    `- 细分：晴 ${r.mood.sunny} · 多云 ${r.mood.cloudy} · 低落 ${r.mood.rain}`,
    '',
    '## 下周预告',
    r.nextWeek.length ? r.nextWeek.map(item => `- ${item.date.slice(5)} ${item.time || ''} [${item.sourceType === 'task' ? '待办' : item.sourceType === 'event' ? '日程' : item.sourceType === 'milestone' ? '重要日期' : '账单'}] ${item.title}`).join('\n') : '- 暂无',
    '',
    '---',
    '*由学习生活台自动生成*'
  ].filter(Boolean).join('\n')

  // `createNote` 是**同步**命令（返回新建的那条笔记，内容为空时抛错），所以这里用
  // try/catch 而不是 `.then/.catch`——原来那条 promise 链串在一个同步返回值上，
  // 一个 `.then` 都取不到，两条 alert 全是不可达的死代码。
  try {
    domain.createNote({
      title: `本周回顾 ${weekLabel.value}`,
      content: lines,
      course: '',
      courseId: '',
    })
    reviewMessage.value = '回顾笔记已生成，可在「笔记」页面查看'
  } catch {
    reviewMessage.value = '生成失败，请重试'
  }
}
</script>

<template>
  <div class="page review-page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">本周回顾</h1>
        <p class="page-desc">{{ weekLabel }} · 从已经发生的记录里，看见这一周。</p>
      </div>
      <div class="page-head-actions">
        <button type="button" class="btn btn-primary" @click="generateReviewNote">一键生成回顾笔记</button>
        <router-link class="btn btn-ghost" to="/">回到今天</router-link>
      </div>
    </header>

    <p v-if="reviewMessage" class="notice-success" role="status">✓ {{ reviewMessage }}</p>

    <section class="review-grid">
      <article class="card review-card review-primary">
        <span class="review-kicker">待办完成</span>
        <strong>{{ review.tasks.completed }}</strong>
        <span>本周完成 · 新增 {{ review.tasks.created }} · 待处理 {{ review.tasks.pending }}</span>
        <small>作业 {{ review.tasks.homeworkCompleted }} · 复习 {{ review.tasks.reviewCompleted }}</small>
      </article>
      <article class="card review-card">
        <span class="review-kicker">学习节奏</span>
        <strong>{{ review.courses.sessions }} <small>节</small></strong>
        <span>{{ review.courses.courses }} 门课程 · 预计投入 {{ review.tasks.focusMinutes }} 分钟</span>
        <small>笔记新增 {{ review.notes.created }} 条</small>
      </article>
      <article class="card review-card">
        <span class="review-kicker">收支</span>
        <strong>¥{{ review.finance.expense.toFixed(2) }}</strong>
        <span>支出 · 收入 ¥{{ review.finance.income.toFixed(2) }} · 共 {{ review.finance.count }} 笔</span>
        <small>账单应付 {{ review.bills.due }} · 已支付 {{ review.bills.paid }}</small>
      </article>
      <article class="card review-card">
        <span class="review-kicker">心情</span>
        <strong>{{ moodLabel }}</strong>
        <span>{{ review.mood.days }} 天有记录</span>
        <small>晴 {{ review.mood.sunny }} · 多云 {{ review.mood.cloudy }} · 低落 {{ review.mood.rain }}</small>
      </article>
    </section>

    <section class="card next-week-card">
      <div class="section-head"><div><h2>下周先看</h2><p>来自待办、日程、重要日期和固定账单的去重提醒。</p></div><span>{{ review.nextWeek.length }} 项</span></div>
      <ul v-if="review.nextWeek.length" class="highlight-list">
        <li v-for="item in review.nextWeek" :key="item.key"><span>{{ item.sourceType === 'task' ? '待办' : item.sourceType === 'event' ? '日程' : item.sourceType === 'milestone' ? '重要日期' : '账单' }}</span><b>{{ item.title }}</b><time>{{ item.date.slice(5) }}<template v-if="item.time"> {{ item.time }}</template></time></li>
      </ul>
      <p v-else class="empty-hint">下周还没有需要提前看的事项。</p>
    </section>
  </div>
</template>

<style scoped>
.notice-success { margin: 12px 0 0; color: var(--success); font-size: 12px; }
.review-page { gap: 18px; }
.review-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.review-card { display: flex; flex-direction: column; gap: 6px; min-height: 132px; padding: 17px; }
.review-kicker { color: var(--ink-faint); font-size: 12px; font-weight: 750; }
.review-card strong { font-size: 29px; font-weight: 900; letter-spacing: -.02em; }
.review-card strong small { font-size: 13px; }
.review-card span, .review-card small { color: var(--ink-soft); font-size: 12px; line-height: 1.45; }
.review-primary { border-color: color-mix(in srgb, var(--primary) 34%, var(--border)); background: var(--primary-soft); }
.next-week-card { padding: 18px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.section-head h2 { font-size: 16px; }
.section-head p { margin-top: 4px; color: var(--ink-faint); font-size: 12px; }
.section-head > span { color: var(--primary); font-size: 12px; font-weight: 800; }
.highlight-list { display: flex; flex-direction: column; gap: 7px; margin: 15px 0 0; padding: 0; list-style: none; }
.highlight-list li { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 9px; background: var(--bg-tint); }
.highlight-list li > span { color: var(--primary); font-size: 11px; font-weight: 750; }
.highlight-list b { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.highlight-list time { color: var(--ink-faint); font-size: 11px; font-variant-numeric: tabular-nums; }
.empty-hint { margin-top: 16px; color: var(--ink-faint); font-size: 13px; }
@media (max-width: 900px) { .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .review-grid { grid-template-columns: 1fr; } .review-card { min-height: auto; } .highlight-list li { grid-template-columns: 38px minmax(0, 1fr); } .highlight-list time { grid-column: 2; } }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.page-head-actions { display: flex; gap: 8px; }
</style>
