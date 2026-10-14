<script setup>
import { onMounted, ref } from 'vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { ledgerCategories } from '../composables/ledger.js'
import { useStoredRef } from '../composables/store/index.js'
import { scheduleExceptions } from '../composables/store/schedule.js'
import { clock } from '../composables/store/core.js'
import { appendQuestionHistory, buildStudyAnswer } from '../composables/studyQuestion.js'

const HISTORY_KEY = 'study-life-question-history'
const domain = useDomainCommands()
const ledgerFx = useStoredRef('sl_ledger_fx', { base: 'CNY', rates: {} })
const question = ref('')
const answer = ref(/** @type {any} */ (null))
const history = ref(/** @type {Array<{question: string, askedAt: string}>} */ ([]))
const historyMessage = ref('')
onMounted(readHistory)

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    history.value = Array.isArray(value) ? value.filter((item) => typeof item?.question === 'string').slice(0, 20) : []
  } catch {
    history.value = []
    historyMessage.value = '本机提问历史暂不可读取。'
  }
}

function ask(value = question.value) {
  const text = String(value || '').trim()
  if (!text) {
    answer.value = buildStudyAnswer('', {})
    return
  }
  question.value = text
  const snapshot = {
    tasks: domain.tasks.value,
    transactions: domain.transactions.value,
    courses: domain.courses.value,
    scheduleExceptions: scheduleExceptions.value,
    focusSessions: domain.focusSessions.value,
    ledgerCategories: ledgerCategories.value,
    ledgerFx: ledgerFx.value,
  }
  answer.value = buildStudyAnswer(text, snapshot, clock.value)
  history.value = appendQuestionHistory(history.value, { question: text, askedAt: clock.value.toISOString() })
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
    historyMessage.value = ''
  } catch {
    historyMessage.value = '提问已完成，但本机无法保存提问历史。'
  }
}
</script>

<template>
  <section class="study-question" aria-label="只读提问">
    <div class="question-heading"><b>提问</b><span>只查找已有记录，不会修改课程、待办或账本。</span></div>
    <label class="question-input-label" for="study-question-input">你想查什么？</label>
    <textarea id="study-question-input" v-model="question" rows="2" placeholder="例如：下周一之前要交什么" @keydown.ctrl.enter.prevent="ask()" @keydown.meta.enter.prevent="ask()" />
    <div class="question-actions">
      <button class="ask-button" type="button" @click="ask()">查找</button>
      <button v-for="example in ['下周一之前要交什么', '这个月吃饭花了多少', '明天有什么课']" :key="example" type="button" @click="ask(example)">{{ example }}</button>
    </div>

    <section v-if="answer" class="question-answer" aria-live="polite">
      <h2>{{ answer.label || '查询结果' }}</h2>
      <p>{{ answer.answer }}</p>
      <p v-if="answer.trace" class="question-trace">来源：{{ answer.trace.partition }} · 命中 {{ answer.trace.hitCount }} 条 · 条件：{{ answer.trace.criteria }}</p>
      <ul v-if="answer.rows.length" class="question-results">
        <li v-for="row in answer.rows" :key="row.id">
          <b v-if="row.group" class="result-group">{{ row.group }} · </b><b>{{ row.title }}</b>
          <span>{{ row.date || '' }}{{ row.detail ? ` · ${row.detail}` : '' }}{{ row.amount ? ` · ${row.amount}` : '' }}{{ row.category ? ` · ${row.category}` : '' }}</span>
        </li>
      </ul>
      <div v-if="!answer.understood" class="question-examples"><button v-for="example in answer.examples" :key="example" type="button" @click="ask(example)">{{ example }}</button></div>
    </section>

    <section v-if="history.length" class="question-history" aria-label="最近提问">
      <b>最近提问</b>
      <button v-for="item in history.slice(0, 5)" :key="item.askedAt + item.question" type="button" @click="ask(item.question)">{{ item.question }}</button>
    </section>
    <small v-if="historyMessage" class="question-storage-message" role="status">{{ historyMessage }}</small>
  </section>
</template>

<style scoped>
.study-question{display:grid;gap:10px;padding:2px 0 12px}
.question-heading{display:grid;gap:3px}.question-heading b{font-size:var(--fs-14)}.question-heading span,.question-trace,.question-storage-message{color:var(--ink-soft);font-size:var(--fs-11);line-height:1.55}
.question-input-label{font-size:var(--fs-12);font-weight:var(--fw-650)}
.study-question textarea{width:100%;min-height:68px;padding:10px;border:1px solid var(--border-strong);border-radius:var(--radius-9);color:var(--text);background:var(--card);font:inherit;resize:vertical}
.question-actions,.question-examples{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.question-actions button,.question-examples button,.question-history button{min-height:38px;padding:6px 9px;border:1px solid var(--border);border-radius:var(--radius-pill);color:var(--ink-soft);background:var(--bg-tint);font:inherit;font-size:var(--fs-11);touch-action:manipulation}.question-actions .ask-button{color:var(--on-primary);border-color:var(--primary);background:var(--primary);font-weight:var(--fw-700)}
.question-answer{display:grid;gap:5px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg-tint)}.question-answer h2{margin:0;font-size:var(--fs-13)}.question-answer>p{margin:0;font-size:var(--fs-12);line-height:1.6}.question-answer .question-trace{font-size:var(--fs-10)}
.question-results{display:grid;gap:5px;margin:3px 0 0;padding:0;list-style:none}.question-results li{display:grid;gap:2px;padding:7px 0;border-top:1px solid var(--border);font-size:var(--fs-11)}.question-results li span{color:var(--ink-soft)}.result-group{color:var(--warning)}
.question-history{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.question-history>b{flex:1 0 100%;font-size:var(--fs-11)}
</style>
