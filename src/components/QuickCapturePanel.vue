<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { todayStr, useStoredRef } from '../composables/store'
import { expenses, ledgerCategories } from '../composables/ledger.js'
import { capture, quickCaptureNow } from '../composables/quickCapture.js'
import { classifyTask } from '../composables/smartClassify.js'
import { isSupported, transcribe, voiceErrorMessage } from '../composables/voiceInput.js'

const props = defineProps({ open: Boolean, initialText: { type: String, default: '' } })
const emit = defineEmits(['close'])

const tasks = useStoredRef('sl_tasks', [])
const courses = useStoredRef('sl_courses', [])
const exams = useStoredRef('sl_exams', [])
const captureEnabled = useStoredRef('sl_capture_enabled', true)

const COUNTDOWN_CATEGORIES = ['学习', '生活', '纪念日', '项目', '其他']
const voiceSupported = isSupported()

// 不支持环境的一次性友好提示：只在首次遇到时显示，点「知道了」后不再打扰。
const VOICE_HINT_KEY = 'sl_voice_hint_seen'
function readVoiceHintSeen() {
  try { return localStorage.getItem(VOICE_HINT_KEY) === '1' } catch { return false }
}
const showVoiceHint = ref(!voiceSupported && !readVoiceHintSeen())
function dismissVoiceHint() {
  showVoiceHint.value = false
  try { localStorage.setItem(VOICE_HINT_KEY, '1') } catch {}
}

const text = ref('')
const kind = ref('task')
const form = ref(emptyForm())
const listening = ref(false)
const message = ref('')
const error = ref('')
let recognizer = null
let messageTimer = 0

function emptyForm() {
  return {
    title: '', course: '', dueDate: '', dueTime: '', priority: 'normal', note: '',
    name: '', amount: '', cat: 'other', date: '', time: '', category: '其他', repeat: 'none',
  }
}

const categoryOptions = computed(() => ledgerCategories.value ?? [])

function reply(value) {
  message.value = value
  window.clearTimeout(messageTimer)
  messageTimer = window.setTimeout(() => { if (message.value === value) message.value = '' }, 4000)
}

function reparse() {
  error.value = ''
  const result = capture(text.value, { courses: courses.value })
  kind.value = result.kind
  const draft = result.draft
  const next = emptyForm()
  if (result.kind === 'expense') {
    next.name = draft.name
    next.amount = draft.amount
    next.cat = draft.cat
  } else if (result.kind === 'countdown') {
    next.title = draft.name
    next.date = draft.date
    next.time = draft.time
    next.category = draft.category
  } else {
    next.title = draft.title
    next.course = draft.course
    next.dueDate = draft.dueDate
    next.dueTime = draft.dueTime
    next.priority = draft.priority
    next.note = draft.note
  }
  form.value = next
}

function onVoiceClick() {
  if (!voiceSupported) {
    showVoiceHint.value = true
    return
  }
  toggleVoice()
}

function toggleVoice() {
  if (listening.value) {
    recognizer?.stop()
    return
  }
  recognizer = transcribe({
    onResult: (finalText, interimText) => {
      text.value = (finalText + interimText).trim()
    },
    onError: (errorCode) => {
      listening.value = false
      reply(voiceErrorMessage(errorCode))
    },
    onEnd: (finalText) => {
      listening.value = false
      if (finalText) reparse()
    },
  })
  if (!recognizer) {
    listening.value = false
    showVoiceHint.value = true
    return
  }
  listening.value = true
  recognizer.start()
}

function save() {
  const now = new Date()
  const stamp = quickCaptureNow(now)

  if (kind.value === 'expense') {
    const name = form.value.name.trim()
    const amount = Number(form.value.amount)
    if (!name) {
      error.value = '写一下花在什么上'
      return
    }
    if (!(amount > 0)) {
      error.value = '请输入正确金额'
      return
    }
    expenses.value.push({
      id: `expense${Date.now()}`,
      name,
      amount,
      cat: form.value.cat || 'other',
      date: stamp.date,
      time: stamp.time,
      note: '',
      source: 'capture',
      billId: '',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    reply(`已记下 ${name} · ¥${amount.toFixed(2)}`)
  } else if (kind.value === 'countdown') {
    const name = form.value.title.trim()
    if (!name) {
      error.value = '写一下倒计时名称'
      return
    }
    if (!form.value.date) {
      error.value = '请选择目标日期'
      return
    }
    exams.value.push({
      id: `e${Date.now()}`,
      name,
      date: form.value.date,
      time: form.value.time,
      location: '',
      category: form.value.category,
      repeat: form.value.repeat,
      pinned: false,
      courseId: '',
      courseName: '',
      reviewProgress: 0,
    })
    reply(`已添加倒计时「${name}」`)
  } else {
    const title = form.value.title.trim()
    if (!title) {
      error.value = '写一下要做的事'
      return
    }
    const task = {
      id: `t${Date.now()}`,
      done: false,
      createdAt: now.toISOString(),
      title,
      course: form.value.course.trim(),
      courseId: '',
      dueDate: form.value.dueDate,
      dueTime: form.value.dueTime,
      priority: form.value.priority,
      note: form.value.note.trim(),
      estimateMinutes: 0,
      repeat: 'none',
      sourceText: text.value.trim(),
    }
    tasks.value.push(classifyTask(task, courses.value))
    reply(`已添加待办「${title}」`)
  }

  text.value = ''
  form.value = emptyForm()
  kind.value = 'task'
  error.value = ''
}

watch(() => props.open, (open) => {
  if (open) {
    text.value = props.initialText || ''
    error.value = ''
    reparse()
  }
})

onBeforeUnmount(() => {
  recognizer?.abort()
  window.clearTimeout(messageTimer)
})
</script>

<template>
  <Modal :open="open" title="⚡ 快速录入" medium @close="emit('close')">
    <div class="capture">
      <div class="capture-input-row">
        <input
          v-model="text"
          class="capture-text"
          placeholder="一句记下：午饭 18 / 周五交高数作业 / 12 月 20 日期末考试"
          @input="reparse"
          @keyup.enter="save"
        />
        <button
          type="button"
          class="voice-btn"
          :class="{ on: listening, muted: !voiceSupported }"
          :aria-label="voiceSupported ? (listening ? '停止语音' : '开始语音') : '语音识别不可用'"
          :title="voiceSupported ? '' : '当前浏览器不支持语音识别，请手动输入'"
          @click="onVoiceClick"
        >{{ voiceSupported ? (listening ? '⏹' : '🎤') : '🚫' }}</button>
      </div>

      <p v-if="showVoiceHint" class="capture-hint" role="status">
        🎤 当前浏览器不支持语音识别，请手动输入。
        <button type="button" @click="dismissVoiceHint">知道了</button>
      </p>

      <div class="kind-line">
        <span class="kind-badge" :class="kind">{{ kind === 'task' ? '待办' : kind === 'expense' ? '记账' : '倒计时' }}</span>
        <span class="kind-hint">内容可再改，保存前都会自动智能归类</span>
      </div>

      <!-- 记账预填 -->
      <div v-if="kind === 'expense'" class="draft">
        <label>名称<input v-model="form.name" placeholder="午饭" /></label>
        <div class="row">
          <label>金额<input v-model="form.amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="18" /></label>
          <label>分类<select v-model="form.cat"><option v-for="c in categoryOptions" :key="c.key" :value="c.key">{{ c.icon }} {{ c.name }}</option></select></label>
        </div>
      </div>

      <!-- 倒计时预填 -->
      <div v-else-if="kind === 'countdown'" class="draft">
        <label>名称<input v-model="form.title" placeholder="期末考试" /></label>
        <div class="row">
          <label>日期<input v-model="form.date" type="date" /></label>
          <label>时间<input v-model="form.time" type="time" /></label>
        </div>
        <div class="row">
          <label>类型<select v-model="form.category"><option v-for="c in COUNTDOWN_CATEGORIES" :key="c" :value="c">{{ c }}</option></select></label>
          <label>重复<select v-model="form.repeat"><option value="none">不重复</option><option value="yearly">每年重复</option></select></label>
        </div>
      </div>

      <!-- 待办预填 -->
      <div v-else class="draft">
        <label>标题<input v-model="form.title" placeholder="待办内容" /></label>
        <label>课程或类别<input v-model="form.course" placeholder="选填，可自动匹配" /></label>
        <div class="row">
          <label>截止日期<input v-model="form.dueDate" type="date" /></label>
          <label>截止时间<input v-model="form.dueTime" type="time" /></label>
        </div>
        <label>优先级<select v-model="form.priority"><option value="high">高优先级</option><option value="normal">普通</option><option value="low">低优先级</option></select></label>
        <label>备注<textarea v-model="form.note" rows="2" placeholder="选填"></textarea></label>
      </div>

      <p v-if="error" class="capture-error">{{ error }}</p>
      <p v-if="message" class="capture-message" role="status">✓ {{ message }}</p>

      <label class="capture-toggle">
        <input v-model="captureEnabled" type="checkbox" />
        复制文字后显示“快速录入”悬浮按钮
      </label>

      <div class="capture-actions">
        <button type="button" class="btn btn-primary" @click="save">保存</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.capture {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.capture-input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.capture-text {
  flex: 1;
  min-width: 0;
  min-height: 44px;
}
.voice-btn {
  flex: 0 0 48px;
  width: 48px;
  font-size: 20px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--card);
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.voice-btn.on {
  color: #fff;
  border-color: var(--danger);
  background: var(--danger);
}
.voice-btn.muted {
  color: var(--ink-faint);
  border-color: var(--border);
  background: var(--bg);
  opacity: 0.85;
}
.capture-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -2px 0 0;
  padding: 8px 10px;
  color: #8a6845;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid #f2d08c;
  border-radius: 8px;
  background: #fffaf0;
}
.capture-hint button {
  margin-left: auto;
  padding: 3px 9px;
  min-height: 26px;
  color: #8a6845;
  font-size: 11.5px;
  border: 1px solid #e8c98e;
  border-radius: 6px;
  background: #fff;
}
.kind-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kind-badge {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 800;
  border-radius: 999px;
}
.kind-badge.task { color: var(--primary); background: var(--primary-soft); }
.kind-badge.expense { color: #0d9463; background: #e7f8f1; }
.kind-badge.countdown { color: #b86b16; background: #fff5df; }
.kind-hint {
  color: var(--ink-faint);
  font-size: 11.5px;
}
.draft {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.draft label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--ink-soft);
  font-size: 12.5px;
}
.draft input,
.draft select,
.draft textarea {
  width: 100%;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.capture-error {
  color: var(--danger);
  font-size: 12.5px;
}
.capture-message {
  color: #087a58;
  font-size: 12.5px;
}
.capture-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ink-soft);
  font-size: 12px;
  cursor: pointer;
}
.capture-toggle input {
  accent-color: var(--primary);
}
.capture-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
.capture-actions .btn {
  min-height: 42px;
}

@media (max-width: 520px) {
  .row {
    grid-template-columns: 1fr;
  }
}
</style>