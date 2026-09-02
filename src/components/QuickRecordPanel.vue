<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { isSupported, transcribe, voiceErrorMessage, VOICE_STATES } from '../composables/voiceInput.js'
import { useQuickRecordAdapters } from '../composables/quickRecord/adapters.js'
import { parseQuickRecord } from '../composables/quickRecord/parser.js'
import { QUICK_ACTIONS, recordTypeMeta } from '../composables/quickRecord/types.js'
import { ledgerCategories } from '../composables/ledger.js'
import { settings as quickRecordSettings } from '../composables/settingsPolicy.js'

const props = defineProps({
  open: Boolean,
  initialText: { type: String, default: '' },
  context: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'saved'])

const { courses, save } = useQuickRecordAdapters()

// 两种模式：smart = 智能结构化（默认）；note = 自由笔记（不做意图分类）。
const mode = ref('smart')
const input = ref('')
const noteBody = ref('')
const noteTitle = ref('')
const inputEl = ref(null)
const noteEl = ref(null)
const forcedType = ref('')
const drafts = ref([])
const expandedId = ref('')
const feedback = ref('')
const error = ref('')
const saving = ref(false)
const clipboardHint = ref('')
const voiceState = ref(VOICE_STATES.idle)
const voiceSeconds = ref(0)
const listening = ref(false)
const settings = quickRecordSettings
const voiceSupported = isSupported()
let recognizer = null
let feedbackTimer = 0
let voiceTimer = 0
let noteBeforeVoice = ''
let smartBeforeVoice = ''
let voiceRunId = 0

const actions = computed(() => QUICK_ACTIONS.map((type) => ({ type, ...recordTypeMeta(type) })))
const activeLedgerCategories = computed(() => ledgerCategories.value.filter((item) => !item.hidden))
const hasDrafts = computed(() => mode.value === 'smart' && drafts.value.length > 0)
const totalExpense = computed(() => drafts.value.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0))
const voiceStatusText = computed(() => {
  if (voiceState.value === VOICE_STATES.listening) return `🔴 正在聆听…… ${voiceSeconds.value}s`
  if (voiceState.value === VOICE_STATES.transcribing) return '正在转写……'
  if (voiceState.value === VOICE_STATES.done) return '识别完成'
  if (voiceState.value === VOICE_STATES.error) return '语音识别未完成'
  return ''
})

function focusInput() { nextTick(() => inputEl.value?.focus()) }
function focusNote() { nextTick(() => noteEl.value?.focus()) }

function autosize(el, maxHeight = 220) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
}

function onSmartInput() {
  autosize(inputEl.value)
  parse()
}

function onSmartKeydown(event) {
  if (event.isComposing) return
  event.preventDefault()
  saveAll()
}

function onNoteInput() {
  autosize(noteEl.value)
}

function parse() {
  error.value = ''
  drafts.value = parseQuickRecord(input.value, {
    courses: courses.value,
    forcedType: forcedType.value,
    context: props.context,
  })
}

function chooseAction(type) {
  stopActiveVoice()
  if (type === 'note') {
    mode.value = 'note'
    forcedType.value = ''
    drafts.value = []
    error.value = ''
    focusNote()
    return
  }
  mode.value = 'smart'
  forcedType.value = type
  parse()
  focusInput()
}

function chooseAuto() {
  stopActiveVoice()
  mode.value = 'smart'
  forcedType.value = ''
  parse()
  focusInput()
}

function chooseQuestion(draft, field, value) {
  draft[field] = field === 'amount' ? Number(value) : value
  draft.questions = draft.questions.filter((item) => item.field !== field)
}

function updateRecent(types) {
  settings.value = { ...settings.value, recentTypes: [...new Set([...types, ...(settings.value.recentTypes || [])])].slice(0, 4) }
}

function categoryLabel(key) { return ledgerCategories.value.find((item) => item.key === key)?.name || '' }

function resetForNextSmartEntry() {
  input.value = ''
  drafts.value = []
  forcedType.value = ''
  expandedId.value = ''
  clipboardHint.value = ''
  error.value = ''
  feedback.value = ''
  noteBeforeVoice = ''
  smartBeforeVoice = ''
  stopActiveVoice()
  focusInput()
}

function savedMessage(results) {
  return results.length === 1 ? results[0].message : `已添加 ${results.length} 项记录`
}

function requestClose() {
  if (saving.value) return
  emit('close')
}

function finishSave(results, keepOpen) {
  updateRecent(results.map((result) => result.type).filter(Boolean))
  const message = savedMessage(results)
  const undo = () => results.forEach((result) => result.undo?.())
  if (keepOpen) {
    resetForNextSmartEntry()
    showFeedback(`✓ ${message}`)
    return
  }
  emit('saved', { message, undo })
  emit('close')
}

async function saveAll(keepOpen = false) {
  if (saving.value) return
  if (!drafts.value.length) return
  saving.value = true
  error.value = ''
  const pending = drafts.value.map((draft) => ({
    ...draft,
    questions: Array.isArray(draft.questions)
      ? draft.questions.map((question) => ({ ...question, choices: [...(question.choices || [])] }))
      : [],
  }))
  const results = []
  const savedIds = []
  try {
    for (const draft of pending) {
      try {
        results.push({ ...(await save(draft)), type: draft.type })
        savedIds.push(draft.id)
      } catch (cause) {
        drafts.value = drafts.value.filter((item) => !savedIds.includes(item.id))
        const reason = cause?.message || '请补充必要信息'
        error.value = savedIds.length
          ? `前 ${savedIds.length} 项已保存；剩余内容未保存：${reason}`
          : `保存失败：${reason}`
        if (savedIds.length) updateRecent(pending.slice(0, savedIds.length).map((draft) => draft.type))
        return
      }
    }
    finishSave(results, keepOpen)
  } finally {
    saving.value = false
  }
}

async function saveNote(keepOpen = false) {
  if (saving.value) return
  const content = noteBody.value.trim()
  if (!content) {
    error.value = '请先写点什么'
    focusNote()
    return
  }
  saving.value = true
  try {
    const result = await save({
      id: `qr-note-${Date.now()}`,
      type: 'note',
      raw: content,
      title: noteTitle.value.trim(),
      note: content,
      course: props.context?.courseName || '',
      courseId: props.context?.courseId || '',
      date: '',
      time: '',
      priority: 'normal',
      amount: 0,
      category: 'other',
      account: '',
      cycle: 'monthly',
      questions: [],
      confidence: 1,
      uncertain: false,
    })
    updateRecent(['note'])
    if (keepOpen) {
      noteBody.value = ''
      noteTitle.value = ''
      error.value = ''
      stopActiveVoice()
      focusNote()
      showFeedback('✓ 已保存快速笔记')
      return
    }
    emit('saved', { message: result.message, undo: result.undo })
    emit('close')
  } catch (cause) {
    error.value = cause?.message || '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

function showFeedback(value) {
  feedback.value = value
  window.clearTimeout(feedbackTimer)
  feedbackTimer = window.setTimeout(() => { feedback.value = '' }, 5000)
}

// 智能解析失败或不确定时，转为快速笔记保存，确保用户输入不丢失。
async function saveAsNote(draft) {
  if (saving.value) return
  if (!draft) return
  saving.value = true
  try {
    const content = String(draft.raw || draft.title || draft.note || '').trim()
    if (!content) return
    const result = await save({
      ...draft,
      type: 'note',
      title: '',
      note: content,
      course: draft.course || props.context?.courseName || '',
      courseId: draft.courseId || props.context?.courseId || '',
    })
    drafts.value = drafts.value.filter((item) => item.id !== draft.id)
    updateRecent(['note'])
    if (drafts.value.length) {
      showFeedback(`✓ ${result.message}`)
      return
    }
    emit('saved', { message: result.message, undo: result.undo })
    emit('close')
  } catch (cause) {
    error.value = cause?.message || '保存为笔记失败'
  } finally {
    saving.value = false
  }
}

function retryAs(draft, type) {
  if (!draft) return
  if (type === 'note') { saveAsNote(draft); return }
  const index = drafts.value.findIndex((item) => item.id === draft.id)
  const reparsed = parseQuickRecord(draft.raw, { courses: courses.value, forcedType: type, context: props.context })
  if (reparsed.length) {
    drafts.value.splice(index, 1, ...reparsed)
  } else {
    drafts.value.splice(index, 1)
  }
  expandedId.value = ''
}

function stopVoiceTimer() {
  window.clearInterval(voiceTimer)
  voiceTimer = 0
  voiceSeconds.value = 0
}

function stopActiveVoice() {
  voiceRunId += 1
  const activeRecognizer = recognizer
  recognizer = null
  listening.value = false
  activeRecognizer?.abort?.()
  stopVoiceTimer()
  voiceState.value = VOICE_STATES.idle
}

function onVoiceState(state) {
  voiceState.value = state
  if (state === VOICE_STATES.listening) {
    voiceSeconds.value = 0
    stopVoiceTimer()
    voiceTimer = window.setInterval(() => { voiceSeconds.value += 1 }, 1000)
  } else if (state !== VOICE_STATES.transcribing) {
    stopVoiceTimer()
  }
}

function toggleVoice() {
  if (!voiceSupported) { error.value = '当前浏览器不支持语音识别，请改用键盘输入'; return }
  if (listening.value) { recognizer?.stop(); return }

  const runId = ++voiceRunId
  const isCurrentRun = () => runId === voiceRunId
  const onError = (code) => {
    if (!isCurrentRun()) return
    listening.value = false
    voiceState.value = VOICE_STATES.error
    stopVoiceTimer()
    error.value = voiceErrorMessage(code)
  }

  if (mode.value === 'note') {
    noteBeforeVoice = noteBody.value
    recognizer = transcribe({
      continuous: true,
      maxSeconds: 60,
      onStateChange: (state) => { if (isCurrentRun()) onVoiceState(state) },
      onResult: (finalText, interimText) => {
        if (!isCurrentRun()) return
        noteBody.value = (noteBeforeVoice + (noteBeforeVoice ? ' ' : '') + finalText + interimText).trim()
      },
      onError,
      onEnd: (finalText) => {
        if (!isCurrentRun()) return
        listening.value = false
        if (finalText) {
          noteBody.value = (noteBeforeVoice + (noteBeforeVoice ? ' ' : '') + finalText).trim()
          onNoteInput()
        }
        onVoiceState(finalText ? VOICE_STATES.done : VOICE_STATES.idle)
        stopVoiceTimer()
      },
    })
  } else {
    smartBeforeVoice = input.value
    recognizer = transcribe({
      continuous: true,
      maxSeconds: 60,
      onStateChange: (state) => { if (isCurrentRun()) onVoiceState(state) },
      onResult: (finalText, interimText) => {
        if (!isCurrentRun()) return
        input.value = (smartBeforeVoice + (smartBeforeVoice ? ' ' : '') + finalText + interimText).trim()
      },
      onError,
      onEnd: (finalText) => {
        if (!isCurrentRun()) return
        listening.value = false
        if (finalText) {
          input.value = (smartBeforeVoice + (smartBeforeVoice ? ' ' : '') + finalText).trim()
          parse()
        }
        onVoiceState(finalText ? VOICE_STATES.done : VOICE_STATES.idle)
        stopVoiceTimer()
      },
    })
  }

  if (!recognizer) { error.value = '语音识别暂不可用'; return }
  listening.value = true
  voiceState.value = VOICE_STATES.listening
  recognizer.start()
}

function useClipboard() {
  input.value = clipboardHint.value
  clipboardHint.value = ''
  chooseAuto()
}

async function checkClipboard() {
  if (!settings.value.clipboardHint || !navigator.clipboard?.readText) return
  try {
    const value = (await navigator.clipboard.readText()).trim()
    if (value && value.length <= 500 && value !== input.value) clipboardHint.value = value
  } catch { /* clipboard permission is optional */ }
}

watch(() => props.open, (open) => {
  if (!open) {
    stopActiveVoice()
    return
  }
  mode.value = 'smart'
  noteBody.value = ''
  noteTitle.value = ''
  input.value = props.initialText || ''
  forcedType.value = ''
  drafts.value = input.value ? parseQuickRecord(input.value, { courses: courses.value, context: props.context }) : []
  feedback.value = ''
  error.value = ''
  clipboardHint.value = ''
  voiceState.value = VOICE_STATES.idle
  voiceSeconds.value = 0
  listening.value = false
  stopVoiceTimer()
  focusInput()
  void checkClipboard()
})

onBeforeUnmount(() => {
  stopActiveVoice()
  window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <Modal :open="open" title="⚡ 快速记录" medium @close="requestClose">
    <section class="quick-record">
      <!-- 智能记录模式：自然语言 → 结构化预览 → 确认保存 -->
      <template v-if="mode === 'smart'">
        <div class="input-wrap">
          <textarea
            ref="inputEl"
            v-model="input"
            class="smart-input"
            rows="2"
            autocomplete="off"
            inputmode="text"
            placeholder="记点什么……例如：午饭18元 / 周五交高数作业 / 明天下午三点组会"
            @input="onSmartInput"
            @keydown.enter.exact="onSmartKeydown"
          />
          <button
            class="mic"
            :class="{ on: listening }"
            type="button"
            :aria-label="listening ? '停止语音' : '语音输入'"
            @click="toggleVoice"
          >{{ listening ? '⏹' : '🎤' }}</button>
        </div>

        <p class="example">自动识别，或者先选择类型再输入，识别更准确</p>

        <div class="action-row" aria-label="快速类型">
          <button type="button" class="auto-chip" :class="{ on: mode === 'smart' && !forcedType }" @click="chooseAuto">✨ 自动识别</button>
          <button v-for="action in actions" :key="action.type" type="button" :class="{ on: mode === 'smart' && forcedType === action.type }" @click="chooseAction(action.type)">{{ action.icon }} {{ action.label }}</button>
        </div>

        <p v-if="voiceStatusText" class="voice-status" role="status">{{ voiceStatusText }}</p>

        <div v-if="clipboardHint && !input" class="clipboard-hint">
          <span>检测到剪贴板内容：“{{ clipboardHint }}”</span><button type="button" @click="useClipboard">智能识别</button>
        </div>

        <section v-if="hasDrafts" class="results" aria-live="polite">
          <p v-if="drafts.length > 1" class="result-count">识别到 {{ drafts.length }} 项</p>

          <article v-for="draft in drafts" :key="draft.id" class="record-card" :class="{ uncertain: draft.uncertain || draft.type === 'unknown' }">
            <div class="record-head">
              <b>{{ recordTypeMeta(draft.type).icon }} {{ recordTypeMeta(draft.type).label }}</b>
              <div class="record-head-actions">
                <span v-if="draft.confidence > 0" class="confidence">{{ Math.round(draft.confidence * 100) }}%</span>
                <button type="button" @click="expandedId = expandedId === draft.id ? '' : draft.id">{{ expandedId === draft.id ? '收起' : '修改' }}</button>
              </div>
            </div>

            <!-- 不确定类型：不让输入丢失 -->
            <template v-if="draft.type === 'unknown'">
              <p class="unknown-tip">⚠ 暂时无法确定记录类型，请选择保存方式。</p>
              <textarea v-model="draft.note" class="note-body-edit" rows="3" aria-label="原文" />
              <div class="fallback-actions">
                <button type="button" class="fallback-note" @click="saveAsNote(draft)">📝 保存为快速笔记</button>
                <button v-for="type in ['todo', 'event', 'expense']" :key="type" type="button" @click="retryAs(draft, type)">{{ recordTypeMeta(type).icon }} 按{{ recordTypeMeta(type).label }}解析</button>
              </div>
            </template>

            <!-- 普通结构化草稿 -->
            <template v-else>
              <template v-if="draft.type === 'note'">
                <textarea v-model="draft.note" class="note-body-edit" aria-label="笔记正文" placeholder="随手写点什么……" rows="4" />
                <input v-model="draft.title" class="note-title-edit" aria-label="笔记标题（可选）" placeholder="标题（可选，默认取正文第一行）" />
              </template>
              <input v-else v-model="draft.title" class="title-edit" aria-label="记录标题" placeholder="输入标题" />

              <div class="chips">
                <label v-if="['expense', 'income', 'bill'].includes(draft.type)">¥ <input v-model.number="draft.amount" type="number" min="0" step="0.01" inputmode="decimal" /></label>
                <label v-if="draft.course">{{ draft.course }}</label>
                <label v-if="['expense', 'income'].includes(draft.type) && categoryLabel(draft.category)">{{ categoryLabel(draft.category) }}</label>
                <label v-if="draft.dateRange && !draft.date">时间范围：{{ draft.dateRange }}</label>
                <label v-if="draft.date"><input v-model="draft.date" type="date" aria-label="日期" /></label>
                <label v-if="draft.time"><input v-model="draft.time" type="time" aria-label="时间" /></label>
                <label v-if="draft.endTime">至 {{ draft.endTime }}</label>
                <label v-if="draft.location">地点：{{ draft.location }}</label>
                <label v-if="draft.reminder">提醒：{{ draft.reminder }}</label>
                <label v-if="draft.priority === 'high'">🔴 重要</label>
                <label v-if="draft.account">{{ draft.account }}</label>
              </div>

              <div v-for="question in draft.questions" :key="question.field" class="question">
                <span>⚠ {{ question.label }}</span>
                <button v-for="choice in question.choices" :key="choice" type="button" @click="chooseQuestion(draft, question.field, choice)">{{ choice }}</button>
              </div>

              <div v-if="draft.uncertain && draft.type !== 'unknown'" class="uncertain-tip">
                <span>置信度较低，可能猜错意图</span>
                <button type="button" @click="saveAsNote(draft)">保存为快速笔记</button>
              </div>

              <div v-if="expandedId === draft.id" class="details">
                <label>类型<select v-model="draft.type">
                  <option value="todo">待办</option>
                  <option value="homework">作业</option>
                  <option value="event">日程</option>
                  <option value="expense">支出</option>
                  <option value="income">收入</option>
                  <option value="bill">固定账单</option>
                  <option value="countdown">重要日期</option>
                  <option value="note">快速笔记</option>
                </select></label>
                <label v-if="!['note', 'expense', 'income', 'bill'].includes(draft.type)">课程<input v-model="draft.course" list="quick-course-options" /></label>
                <label v-if="['expense', 'income'].includes(draft.type)">分类<select v-model="draft.category"><option v-for="category in activeLedgerCategories" :key="category.key" :value="category.key">{{ category.icon }} {{ category.name }}</option></select></label>
                <label v-if="['expense', 'income', 'bill'].includes(draft.type)">账户<input v-model.trim="draft.account" placeholder="例如：微信 / 现金" /></label>
                <label>备注<textarea v-model="draft.note" rows="2" /></label>
                <label v-if="draft.type === 'bill'">重复<select v-model="draft.cycle"><option value="weekly">每周</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="yearly">每年</option></select></label>
              </div>
            </template>
          </article>

          <p v-if="drafts.length > 1 && totalExpense" class="total">支出合计 ¥{{ totalExpense.toFixed(2) }}</p>
        </section>

        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <div class="footer">
          <p v-if="feedback" class="success" role="status">{{ feedback }}</p>
          <div v-if="hasDrafts" class="save-actions">
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveAll(false)">{{ drafts.length > 1 ? '全部保存' : '保存' }}</button>
            <button type="button" class="btn btn-ghost" :disabled="saving" @click="saveAll(true)">保存并继续</button>
          </div>
        </div>
      </template>

      <!-- 自由笔记模式：只记正文，不做任何意图分类 -->
      <template v-else>
        <div class="note-mode">
          <div class="note-head">
            <b>📝 快速笔记</b>
            <small>内容优先，支持换行、长文本，不强制分类</small>
          </div>
          <textarea
            ref="noteEl"
            v-model="noteBody"
            class="note-body"
            rows="6"
            placeholder="随手写点什么……"
            @input="onNoteInput"
          />
          <div class="note-tools">
            <button
              class="mic note-mic"
              :class="{ on: listening }"
              type="button"
              :aria-label="listening ? '停止语音' : '语音输入'"
              @click="toggleVoice"
            >{{ listening ? '⏹' : '🎤' }} 语音输入</button>
            <span v-if="voiceStatusText" class="voice-status">{{ voiceStatusText }}</span>
          </div>
          <input v-model="noteTitle" class="note-title" aria-label="笔记标题（可选）" placeholder="标题（可选，默认取正文第一行）" />
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="footer note-footer">
            <p v-if="feedback" class="success" role="status">{{ feedback }}</p>
            <div class="save-actions">
            <button type="button" class="btn btn-primary" :disabled="saving" @click="saveNote(false)">保存</button>
            <button type="button" class="btn btn-ghost" :disabled="saving" @click="saveNote(true)">保存并继续</button>
            </div>
          </div>
        </div>
      </template>

      <datalist id="quick-course-options"><option v-for="course in courses" :key="course.id" :value="course.name" /></datalist>
    </section>
  </Modal>
</template>

<style scoped>
.quick-record{display:flex;flex-direction:column;gap:11px}
.input-wrap{display:flex;align-items:flex-end;gap:7px;padding:6px 5px 6px 12px;border:1px solid var(--border-strong);border-radius:12px;background:var(--card)}
.input-wrap:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.smart-input{flex:1;min-width:0;max-height:220px;padding:9px 0;border:0;outline:0;background:transparent;resize:none;line-height:1.5;font:inherit;color:var(--text)}
.mic{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:42px;height:42px;padding:0 12px;border:0;border-radius:10px;background:var(--primary-soft);font-size:17px;cursor:pointer}
.mic.on{color:#fff;background:var(--danger)}
.note-mic{font-size:14px;width:auto}
.example{margin-top:-5px;color:var(--ink-faint);font-size:11.5px}
.action-row{display:flex;gap:7px;overflow-x:auto;padding-bottom:2px}
.action-row button{flex:0 0 auto;padding:7px 10px;color:var(--ink-soft);border:1px solid var(--border);border-radius:999px;background:var(--card);font-size:12px;font-weight:700}
.action-row button.on{color:var(--primary);border-color:var(--primary);background:var(--primary-soft)}
.voice-status{margin:0;color:var(--primary);font-size:12px;font-weight:700}
.clipboard-hint{display:flex;gap:8px;align-items:center;padding:9px 10px;color:var(--ink-soft);font-size:12px;border-radius:9px;background:var(--bg)}
.clipboard-hint span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clipboard-hint button{padding:5px 7px;color:var(--primary);font-weight:800;border:0;border-radius:6px;background:var(--primary-soft)}
.results{display:flex;flex-direction:column;gap:8px}
.result-count,.total{margin:0;color:var(--ink-soft);font-size:12px}
.record-card{padding:11px;border:1px solid var(--border);border-radius:11px;background:var(--bg-tint)}
.record-card.uncertain{border-color:#e8c98e;background:#fffaf0}
.record-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.record-head b{color:var(--primary)}
.record-head-actions{display:inline-flex;align-items:center;gap:6px}
.confidence{color:var(--ink-faint);font-size:10.5px}
.record-head button{padding:2px 4px;color:var(--ink-faint);font-size:11px;border:0;background:transparent}
.title-edit,.note-title-edit{width:100%;margin:7px 0 8px;padding:0;color:var(--text);font-size:15px;font-weight:750;border:0;border-bottom:1px solid transparent;background:transparent}
.title-edit:focus,.note-title-edit:focus{outline:0;border-bottom-color:var(--primary)}
.note-title-edit{font-size:12px;font-weight:650}
.note-body-edit{width:100%;min-height:104px;margin:8px 0 4px;padding:9px 10px;line-height:1.55;border:1px solid var(--border);border-radius:9px;resize:vertical;background:#fff}
.note-body-edit:focus{outline:0;border-color:var(--primary);box-shadow:0 0 0 2px var(--primary-soft)}
.unknown-tip,.uncertain-tip{margin:6px 0;padding:7px 8px;color:#9a651d;font-size:11.5px;border-radius:7px;background:#fff;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.unknown-tip button,.uncertain-tip button,.fallback-actions button{padding:4px 7px;color:#9a651d;border:1px solid #e8c98e;border-radius:6px;background:#fff;font-size:11px}
.fallback-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}
.fallback-actions .fallback-note{color:#087a58;border-color:#b6e2d2;background:#eefaf5}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chips label{display:flex;align-items:center;gap:2px;min-height:24px;padding:3px 7px;color:var(--ink-soft);font-size:11px;border-radius:6px;background:#fff}
.chips input{width:92px;padding:0;border:0;background:transparent;font:inherit}
.chips input[type="date"]{width:107px}
.chips input[type="time"]{width:62px}
.question{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:8px;color:#9a651d;font-size:11.5px}
.question button{padding:4px 7px;color:#9a651d;border:1px solid #e8c98e;border-radius:6px;background:#fff}
.details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)}
.details label{display:flex;flex-direction:column;gap:4px;color:var(--ink-soft);font-size:11px}
.details textarea,.details input,.details select{width:100%;padding:6px 7px;font-size:12px}
.details label:last-child{grid-column:1/-1}
.footer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px}
.success{margin:0;color:#087a58;font-size:12px}
.error{margin:0;color:var(--danger);font-size:12px}
.save-actions{display:flex;gap:8px;margin-left:auto}
.save-actions .btn{min-width:88px}
.note-mode{display:flex;flex-direction:column;gap:11px}
.note-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.note-head b{font-size:14px}
.note-head small{color:var(--ink-faint);font-size:11px}
.note-body{width:100%;min-height:160px;max-height:45vh;padding:12px;line-height:1.6;border:1px solid var(--border-strong);border-radius:12px;resize:none;background:var(--card);font:inherit;color:var(--text)}
.note-body:focus{outline:0;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.note-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.note-title{width:100%;padding:10px 12px;font-size:13px;border:1px solid var(--border);border-radius:9px;background:var(--card)}
.note-title:focus{outline:0;border-color:var(--primary)}
.note-footer{padding-top:4px}
@media(max-width:520px){
.note-body{min-height:150px;max-height:40vh}
.details{grid-template-columns:1fr}
.details label:last-child{grid-column:auto}
.footer{position:sticky;bottom:0;background:var(--card);padding:8px 0 4px}
}
</style>
