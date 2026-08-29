<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { isSupported, transcribe, voiceErrorMessage } from '../composables/voiceInput.js'
import { useQuickRecordAdapters } from '../composables/quickRecord/adapters.js'
import { parseQuickRecord } from '../composables/quickRecord/parser.js'
import { QUICK_ACTIONS, recordTypeMeta } from '../composables/quickRecord/types.js'
import { ledgerCategories } from '../composables/ledger.js'
import { useStoredRef } from '../composables/store/index.js'

const props = defineProps({ open: Boolean, initialText: { type: String, default: '' }, context: { type: Object, default: () => ({}) } })
const emit = defineEmits(['close'])
const { courses, save } = useQuickRecordAdapters()
const input = ref('')
const inputEl = ref(null)
const titleEl = ref(null)
const forcedType = ref('')
const drafts = ref([])
const expandedId = ref('')
const manualMode = ref(false)
const listening = ref(false)
const feedback = ref('')
const error = ref('')
const clipboardHint = ref('')
const settings = useStoredRef('sl_quick_record_settings', { clipboardHint: true, recentTypes: [] })
const voiceSupported = isSupported()
let recognizer = null
let feedbackTimer = 0

const actions = computed(() => QUICK_ACTIONS.map((type) => ({ type, ...recordTypeMeta(type) })))
const activeLedgerCategories = computed(() => ledgerCategories.value.filter((item) => !item.hidden))
const hasDrafts = computed(() => drafts.value.length > 0)
const total = computed(() => drafts.value.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0))

function focusInput() { nextTick(() => inputEl.value?.focus()) }
function focusManualTitle() { nextTick(() => (Array.isArray(titleEl.value) ? titleEl.value[0] : titleEl.value)?.focus()) }
function categoryLabel(key) { return ledgerCategories.value.find((item) => item.key === key)?.name || '' }
function parse() {
  error.value = ''
  manualMode.value = false
  drafts.value = parseQuickRecord(input.value, { courses: courses.value, forcedType: forcedType.value, context: props.context })
}
function chooseAction(type) {
  forcedType.value = type
  if (manualMode.value && drafts.value.length === 1) {
    drafts.value[0].type = type
    return
  }
  parse()
  focusInput()
}
function chooseQuestion(draft, field, value) {
  draft[field] = field === 'amount' ? Number(value) : value
  draft.questions = draft.questions.filter((item) => item.field !== field)
}
function emptyManualDraft(type = forcedType.value || props.context?.preferredType || 'todo') {
  const now = new Date()
  const isMoney = ['expense', 'income', 'bill'].includes(type)
  const pad = (value) => String(value).padStart(2, '0')
  return {
    id: `qr-manual-${Date.now()}`, type, raw: '', title: '',
    course: props.context?.courseName || '', courseId: props.context?.courseId || '',
    date: isMoney ? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` : '',
    time: isMoney && type !== 'bill' ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '',
    priority: 'normal', note: '', amount: 0, category: '', account: '', cycle: 'monthly', questions: [], confidence: 1,
  }
}
function openManual() {
  error.value = ''
  input.value = ''
  manualMode.value = true
  forcedType.value = forcedType.value || props.context?.preferredType || 'todo'
  drafts.value = [emptyManualDraft()]
  expandedId.value = ''
  focusManualTitle()
}
function updateRecent() {
  const used = drafts.value.map((item) => item.type)
  settings.value = { ...settings.value, recentTypes: [...new Set([...used, ...(settings.value.recentTypes || [])])].slice(0, 4) }
}
function saveAll() {
  if (!drafts.value.length) return
  try {
    const messages = drafts.value.map((draft) => save(draft))
    updateRecent()
    feedback.value = `✓ ${messages.length === 1 ? messages[0] : `已添加 ${messages.length} 项记录`}`
    window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 5000)
    input.value = ''
    drafts.value = []
    forcedType.value = ''
    manualMode.value = false
    focusInput()
  } catch (cause) {
    error.value = cause?.message || '保存失败，请补充必要信息'
  }
}
function useClipboard() {
  input.value = clipboardHint.value
  clipboardHint.value = ''
  parse()
  focusInput()
}
function toggleVoice() {
  if (!voiceSupported) { error.value = '当前浏览器不支持语音识别，请改用键盘输入'; return }
  if (listening.value) { recognizer?.stop(); return }
  recognizer = transcribe({
    onResult: (finalText, interimText) => { input.value = (finalText + interimText).trim() },
    onError: (code) => { listening.value = false; error.value = voiceErrorMessage(code) },
    onEnd: (finalText) => { listening.value = false; if (finalText) parse() },
  })
  if (!recognizer) { error.value = '语音识别暂不可用'; return }
  listening.value = true
  recognizer.start()
}
async function checkClipboard() {
  if (!settings.value.clipboardHint || !navigator.clipboard?.readText) return
  try {
    const value = (await navigator.clipboard.readText()).trim()
    if (value && value.length <= 500 && value !== input.value) clipboardHint.value = value
  } catch { /* clipboard permission is optional */ }
}
watch(() => props.open, (open) => {
  if (!open) return
  input.value = props.initialText || ''
  // 页面上下文只提高未明确内容的判断优先级，绝不覆盖文字本身的明确意图。
  forcedType.value = ''
  manualMode.value = false
  drafts.value = input.value ? parseQuickRecord(input.value, { courses: courses.value, context: props.context }) : []
  feedback.value = ''
  error.value = ''
  focusInput()
  void checkClipboard()
})
onBeforeUnmount(() => { recognizer?.abort(); window.clearTimeout(feedbackTimer) })
</script>

<template>
  <Modal :open="open" title="⚡ 快速记录" medium @close="emit('close')">
    <section class="quick-record">
      <div class="input-wrap">
        <input ref="inputEl" v-model="input" autocomplete="off" inputmode="text" placeholder="记点什么……" @input="parse" @keyup.enter="saveAll" />
        <button class="manual" :class="{ on: manualMode }" type="button" aria-label="手动录入" title="手动录入" @click="openManual">⌨<span>手动</span></button>
        <button class="mic" :class="{ on: listening }" type="button" :aria-label="listening ? '停止语音' : '语音输入'" @click="toggleVoice">{{ listening ? '⏹' : '🎤' }}</button>
      </div>
      <p class="example">{{ manualMode ? '手动填写标题即可开始，金额、日期等按需补充' : '午饭18元 / 周五交高数作业 / 明天下午三点组会' }}</p>

      <div class="action-row" aria-label="快速类型">
        <button v-for="action in actions" :key="action.type" type="button" :class="{ on: forcedType === action.type }" @click="chooseAction(action.type)">{{ action.icon }} {{ action.label }}</button>
      </div>

      <div v-if="clipboardHint && !input" class="clipboard-hint">
        <span>检测到剪贴板内容：“{{ clipboardHint }}”</span><button type="button" @click="useClipboard">智能识别</button>
      </div>

      <section v-if="hasDrafts" class="results" aria-live="polite">
        <p v-if="drafts.length > 1" class="result-count">识别到 {{ drafts.length }} 项</p>
        <article v-for="draft in drafts" :key="draft.id" class="record-card">
          <div class="record-head"><b>{{ recordTypeMeta(draft.type).icon }} {{ recordTypeMeta(draft.type).label }}</b><button type="button" @click="expandedId = expandedId === draft.id ? '' : draft.id">{{ expandedId === draft.id ? '收起' : '更多选项' }}</button></div>
          <template v-if="draft.type === 'note'">
            <textarea v-model="draft.note" class="note-body-edit" aria-label="笔记正文" placeholder="随手写点什么……支持换行，不限于一句话" rows="5" />
            <input ref="titleEl" v-model="draft.title" class="note-title-edit" aria-label="笔记标题（可选）" placeholder="标题（可选，默认取正文第一行）" />
          </template>
          <input v-else ref="titleEl" v-model="draft.title" class="title-edit" aria-label="记录标题" placeholder="输入标题" />
          <div class="chips">
            <label v-if="['expense', 'income', 'bill'].includes(draft.type)">¥ <input v-model.number="draft.amount" type="number" min="0" step="0.01" inputmode="decimal" /></label>
            <label v-if="draft.course">{{ draft.course }}</label>
            <label v-if="['expense', 'income'].includes(draft.type) && categoryLabel(draft.category)">{{ categoryLabel(draft.category) }}</label>
            <label v-if="draft.date || (manualMode && draft.type !== 'note')"><input v-model="draft.date" type="date" aria-label="日期" /></label>
            <label v-if="draft.time || (manualMode && draft.type !== 'note')"><input v-model="draft.time" type="time" aria-label="时间" /></label>
            <label v-if="draft.priority === 'high'">🔴 重要</label>
            <label v-if="draft.account">{{ draft.account }}</label>
          </div>
          <div v-for="question in draft.questions" :key="question.field" class="question"><span>⚠ {{ question.label }}</span><button v-for="choice in question.choices" :key="choice" type="button" @click="chooseQuestion(draft, question.field, choice)">{{ choice }}</button></div>
          <div v-if="expandedId === draft.id" class="details">
            <label>类型<select v-model="draft.type"><option value="todo">待办</option><option value="homework">作业</option><option value="event">日程</option><option value="expense">支出</option><option value="income">收入</option><option value="bill">固定账单</option><option value="countdown">倒计时</option><option value="note">笔记</option></select></label>
            <label v-if="!['note', 'expense', 'income', 'bill'].includes(draft.type)">课程<input v-model="draft.course" list="quick-course-options" /></label>
            <label v-if="['expense', 'income'].includes(draft.type)">分类<select v-model="draft.category"><option v-for="category in activeLedgerCategories" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option></select></label>
            <label v-if="['expense', 'income', 'bill'].includes(draft.type)">账户<input v-model.trim="draft.account" placeholder="例如：微信 / 现金" /></label>
            <label>备注<textarea v-model="draft.note" rows="2" /></label>
            <label v-if="draft.type === 'bill'">重复<select v-model="draft.cycle"><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="yearly">每年</option></select></label>
          </div>
        </article>
        <p v-if="drafts.length > 1 && total" class="total">支出合计 ¥{{ total.toFixed(2) }}</p>
      </section>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="footer"><p v-if="feedback" class="success" role="status">{{ feedback }}</p><button v-if="hasDrafts" type="button" class="btn btn-primary" @click="saveAll">{{ drafts.length > 1 ? '全部保存' : '添加' }}</button></div>
      <datalist id="quick-course-options"><option v-for="course in courses" :key="course.id" :value="course.name" /></datalist>
    </section>
  </Modal>
</template>

<style scoped>
.quick-record{display:flex;flex-direction:column;gap:11px}.input-wrap{display:flex;align-items:center;gap:7px;padding:4px 5px 4px 12px;border:1px solid var(--border-strong);border-radius:12px;background:var(--card)}.input-wrap:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}.input-wrap input{flex:1;min-width:0;padding:9px 0;border:0;outline:0;background:transparent}.mic,.manual{display:flex;align-items:center;justify-content:center;gap:3px;height:38px;border:0;border-radius:9px;background:var(--primary-soft)}.mic{width:38px;font-size:17px}.manual{padding:0 8px;color:var(--ink-soft);font-size:12px;font-weight:750}.manual.on{color:var(--primary);outline:1px solid var(--primary);background:#fff}.mic.on{color:#fff;background:var(--danger)}.example{margin-top:-5px;color:var(--ink-faint);font-size:11.5px}.action-row{display:flex;gap:7px;overflow-x:auto;padding-bottom:2px}.action-row button{flex:0 0 auto;padding:7px 10px;color:var(--ink-soft);border:1px solid var(--border);border-radius:999px;background:var(--card);font-size:12px;font-weight:700}.action-row button.on{color:var(--primary);border-color:var(--primary);background:var(--primary-soft)}.clipboard-hint{display:flex;gap:8px;align-items:center;padding:9px 10px;color:var(--ink-soft);font-size:12px;border-radius:9px;background:var(--bg)}.clipboard-hint span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.clipboard-hint button{padding:5px 7px;color:var(--primary);font-weight:800;border:0;border-radius:6px;background:var(--primary-soft)}.results{display:flex;flex-direction:column;gap:8px}.result-count,.total{margin:0;color:var(--ink-soft);font-size:12px}.record-card{padding:11px;border:1px solid var(--border);border-radius:11px;background:var(--bg-tint)}.record-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}.record-head b{color:var(--primary)}.record-head button{padding:2px;color:var(--ink-faint);font-size:11px;border:0;background:transparent}.title-edit,.note-title-edit{width:100%;margin:5px 0 8px;padding:0;color:var(--text);font-size:15px;font-weight:750;border:0;border-bottom:1px solid transparent;background:transparent}.title-edit:focus,.note-title-edit:focus{outline:0;border-bottom-color:var(--primary)}.note-title-edit{font-size:12px;font-weight:650}.note-body-edit{width:100%;min-height:104px;margin:8px 0 4px;padding:9px 10px;line-height:1.55;border:1px solid var(--border);border-radius:9px;resize:vertical;background:#fff}.note-body-edit:focus{outline:0;border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}.chips{display:flex;gap:5px;flex-wrap:wrap}.chips label{display:flex;align-items:center;gap:2px;min-height:24px;padding:3px 7px;color:var(--ink-soft);font-size:11px;border-radius:6px;background:#fff}.chips input{width:92px;padding:0;border:0;background:transparent;font:inherit}.chips input[type="date"]{width:107px}.chips input[type="time"]{width:62px}.question{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px;color:#9a651d;font-size:11.5px}.question button{padding:4px 7px;color:#9a651d;border:1px solid #e8c98e;border-radius:6px;background:#fff}.details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}.details label{display:flex;flex-direction:column;gap:4px;color:var(--ink-soft);font-size:11px}.details textarea,.details input,.details select{width:100%;padding:6px 7px;font-size:12px}.details label:last-child{grid-column:1/-1}.footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px}.success{margin:0;color:#087a58;font-size:12px}.error{margin:0;color:var(--danger);font-size:12px}.footer .btn{margin-left:auto;min-width:88px}@media(max-width:520px){.manual{width:38px;padding:0}.manual span{display:none}.details{grid-template-columns:1fr}.details label:last-child{grid-column:auto}}
</style>
