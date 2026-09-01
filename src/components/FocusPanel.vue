<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Modal from './Modal.vue'
import { useStoredRef } from '../composables/store/index.js'
import { todayStr } from '../composables/store/utils.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import {
  DEFAULT_FOCUS_SETTINGS,
  buildFocusSession,
  createFocusSessionId,
  focusActualSeconds,
  focusDisplayState,
  focusPlannedSeconds,
  formatFocusDuration,
  normalizeActiveSession,
  normalizeFocusSettings,
  pushRecentTemporary,
} from '../composables/focusTimer.js'

const domain = useDomainCommands()
const { tasks } = domain
const focusSessions = useStoredRef('sl_focus_sessions', [])
const activeRef = useStoredRef('sl_focus_active', null)
const focusSettings = useStoredRef('sl_focus_settings', DEFAULT_FOCUS_SETTINGS)

const now = ref(Date.now())
const targetTitle = ref('')
const selectedTodoId = ref('')
const selectedMinutes = ref(25)
const customMinutes = ref(25)
const customError = ref('')
const showTodoPicker = ref(false)
const showCustomTime = ref(false)
const showRecent = ref(false)
const showEarly = ref(false)
const earlyElapsedText = ref('')
const lastSavedSession = ref(null)
const tempTodoAdded = ref(false)
const restMinutes = ref(0)
const restEndsAt = ref(null)
const flashMessage = ref('')

let ticker = 0
let hideRecentTimer = 0
let flashTimer = 0
let notifiedSessionId = ''

const active = computed(() => normalizeActiveSession(activeRef.value))
const settings = computed(() => normalizeFocusSettings(focusSettings.value))
const quickTimes = computed(() => settings.value.quickTimes)
const recentTemporaries = computed(() => settings.value.recentTemporaries)
const display = computed(() => (active.value ? focusDisplayState(active.value, now.value) : null))
const selectedTodo = computed(() => tasks.value.find((task) => task.id === selectedTodoId.value) || null)
const openTasks = computed(() => {
  const open = tasks.value.filter((task) => task && !task.done && task.status !== 'archived' && task.status !== 'cancelled')
  const dueTs = (task) => (task.dueDate ? new Date(`${task.dueDate}T${task.dueTime || '23:59'}`).getTime() : Infinity)
  return open.sort((a, b) => {
    const overdueA = dueTs(a) < Date.now() ? 0 : 1
    const overdueB = dueTs(b) < Date.now() ? 0 : 1
    if (overdueA !== overdueB) return overdueA - overdueB
    return dueTs(a) - dueTs(b) || String(a.title).localeCompare(String(b.title), 'zh-CN')
  })
})

function mmss(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const clockText = computed(() => {
  if (!active.value) return `${mmss(selectedMinutes.value * 60)}`
  const state = display.value
  if (!state) return '00:00'
  if (state.overtimeSeconds > 0) return `+${mmss(state.overtimeSeconds)}`
  return mmss(state.remainingSeconds)
})

const restRemainingSeconds = computed(() => {
  if (!restEndsAt.value) return 0
  return Math.max(0, Math.ceil((restEndsAt.value - now.value) / 1000))
})
const restClockText = computed(() => mmss(restRemainingSeconds.value))

const linkedTodoDone = computed(() => {
  const session = lastSavedSession.value
  if (!session?.todoId) return false
  return tasks.value.find((task) => task.id === session.todoId)?.done ?? false
})

const activeStateLine = computed(() => {
  const state = display.value
  if (!active.value || !state) return ''
  if (active.value.pausedAt) return `已暂停 · 已专注 ${formatFocusDuration(state.actualSeconds)}`
  if (state.overtimeSeconds > 0) return `已完成目标时间，继续专注 +${mmss(state.overtimeSeconds)}`
  return `已专注 ${formatFocusDuration(state.actualSeconds)}`
})

function applySettingsToUi() {
  selectedMinutes.value = settings.value.lastUsedMinutes || 25
}

function onGoalInput(event) {
  if (selectedTodoId.value) return
  targetTitle.value = event.target.value
}

function scheduleHideRecent() {
  window.clearTimeout(hideRecentTimer)
  hideRecentTimer = window.setTimeout(() => { showRecent.value = false }, 160)
}

function useRecent(title) {
  targetTitle.value = title
  selectedTodoId.value = ''
  showRecent.value = false
}

function selectQuick(minutes) {
  selectedMinutes.value = Number(minutes)
}

function openCustomTime() {
  customMinutes.value = selectedMinutes.value
  customError.value = ''
  showCustomTime.value = true
}

function applyCustomTime() {
  const value = Math.round(Number(customMinutes.value))
  if (!Number.isFinite(value) || value < 5 || value > 180) {
    customError.value = '请输入 5～180 分钟之间的整数'
    return
  }
  selectedMinutes.value = value
  showCustomTime.value = false
}

function selectTodo(todo) {
  selectedTodoId.value = todo.id
  targetTitle.value = ''
  showTodoPicker.value = false
}

function clearTodo() {
  selectedTodoId.value = ''
}

function pause() {
  const session = normalizeActiveSession(activeRef.value)
  if (!session) return
  const elapsed = focusActualSeconds(session, Date.now())
  activeRef.value = { ...activeRef.value, elapsedSeconds: elapsed, pausedAt: new Date().toISOString(), status: 'paused' }
  syncTicker()
}

function resume() {
  const session = normalizeActiveSession(activeRef.value)
  if (!session || !session.pausedAt) return
  const pausedStart = new Date(session.pausedAt).getTime()
  const resumedAt = Date.now()
  const addedPause = Number.isFinite(pausedStart) ? Math.max(0, Math.floor((resumedAt - pausedStart) / 1000)) : 0
  activeRef.value = {
    ...activeRef.value,
    pausedAt: null,
    pausedDurationSeconds: session.pausedDurationSeconds + addedPause,
    segmentStartedAt: new Date(resumedAt).toISOString(),
    status: 'running',
  }
  now.value = resumedAt
  syncTicker()
}

function start() {
  if (activeRef.value) return
  const minutes = Math.round(Number(selectedMinutes.value))
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) selectedMinutes.value = 25
  const todoId = selectedTodoId.value || ''
  const title = todoId ? selectedTodo.value?.title || '' : targetTitle.value.trim()
  const startedAt = new Date().toISOString()
  let nextSettings = normalizeFocusSettings(focusSettings.value)
  nextSettings = { ...nextSettings, lastUsedMinutes: Number(selectedMinutes.value) }
  if (!todoId && title) nextSettings = pushRecentTemporary(nextSettings, title)
  focusSettings.value = nextSettings
  activeRef.value = {
    sessionId: createFocusSessionId(),
    focusType: todoId ? 'todo-linked' : title ? 'temporary' : 'free',
    title,
    todoId: todoId || null,
    courseId: todoId ? selectedTodo.value?.courseId || '' : '',
    plannedMinutes: Number(selectedMinutes.value),
    startedAt,
    segmentStartedAt: startedAt,
    elapsedSeconds: 0,
    pausedAt: null,
    pausedDurationSeconds: 0,
    status: 'running',
  }
  targetTitle.value = ''
  selectedTodoId.value = ''
  notifiedSessionId = ''
  tempTodoAdded.value = false
  now.value = Date.now()
  syncTicker()
}

function requestEnd() {
  const session = normalizeActiveSession(activeRef.value)
  if (!session) return
  const actual = focusActualSeconds(session, Date.now())
  const planned = focusPlannedSeconds(session)
  if (actual < planned) {
    earlyElapsedText.value = formatFocusDuration(actual)
    showEarly.value = true
    return
  }
  saveFocus('completed')
}

function saveFocus(status = 'completed') {
  const session = buildFocusSession(activeRef.value, new Date().toISOString(), status)
  if (!session) return
  focusSessions.value.unshift(session)
  if (session.todoId) {
    const task = tasks.value.find((item) => item.id === session.todoId)
    if (task) {
      task.focusCount = Math.max(0, Number(task.focusCount) || 0) + 1
      task.focusTotalSeconds = Math.max(0, Number(task.focusTotalSeconds) || 0) + session.actualFocusSeconds
      task.lastFocusedAt = session.endedAt
    }
  }
  activeRef.value = null
  showEarly.value = false
  lastSavedSession.value = session
  tempTodoAdded.value = false
  notifiedSessionId = ''
  syncTicker()
}

function confirmEarlySave() {
  showEarly.value = false
  saveFocus('stopped')
}

function discardEarly() {
  activeRef.value = null
  showEarly.value = false
  notifiedSessionId = ''
  syncTicker()
}

function closeCompletion() {
  lastSavedSession.value = null
  tempTodoAdded.value = false
}

function againFocus() {
  const session = lastSavedSession.value
  if (!session) return
  selectedMinutes.value = Number(session.plannedMinutes) || 25
  targetTitle.value = ''
  selectedTodoId.value = ''
  if (session.focusType === 'temporary') targetTitle.value = session.title
  else if (session.focusType === 'todo-linked' && session.todoId) selectedTodoId.value = session.todoId
  lastSavedSession.value = null
  tempTodoAdded.value = false
  start()
}

function addTempTodo() {
  const session = lastSavedSession.value
  if (!session?.title || tempTodoAdded.value) return
  domain.createTask({ title: session.title, createdFrom: 'focus', sourceType: 'focus', sourceId: session.sessionId })
  tempTodoAdded.value = true
  showFlash('已加入待办')
}

function markTodoDone() {
  const session = lastSavedSession.value
  if (!session?.todoId || linkedTodoDone.value) return
  const task = tasks.value.find((item) => item.id === session.todoId)
  if (!task) return
  domain.toggleTask(task.id)
}

function startRest(minutes) {
  restMinutes.value = Number(minutes)
  restEndsAt.value = Date.now() + Number(minutes) * 60000
  lastSavedSession.value = null
  tempTodoAdded.value = false
  now.value = Date.now()
  syncTicker()
}

function finishRest() {
  restEndsAt.value = null
  restMinutes.value = 0
  syncTicker()
}

function showFlash(message) {
  flashMessage.value = message
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { if (flashMessage.value === message) flashMessage.value = '' }, 3200)
}

function playSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    if (!playSound.context) playSound.context = new AudioContext()
    const ctx = playSound.context
    const start = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.02, start)
    gain.gain.exponentialRampToValueAtTime(0.2, start + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.52)
  } catch {
  }
}

function notifyCompletion(session) {
  const nextSettings = normalizeFocusSettings(focusSettings.value)
  const title = session.title || '自由专注'
  if (nextSettings.soundEnabled) playSound()
  if (nextSettings.vibrationEnabled && 'vibrate' in navigator) {
    try { navigator.vibrate(300) } catch { }
  }
  if (nextSettings.systemNotificationEnabled && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('学习生活台 · 专注完成', { body: `「${title}」已完成 ${session.plannedMinutes} 分钟` }) } catch { }
  }
}

function tick() {
  now.value = Date.now()
  const session = normalizeActiveSession(activeRef.value)
  if (session && !session.pausedAt) {
    const state = focusDisplayState(session, now.value)
    if (state.hasCompletedPlan && notifiedSessionId !== session.sessionId) {
      notifiedSessionId = session.sessionId
      notifyCompletion(session)
    }
  }
}

function ensureTicker() {
  if (!ticker) ticker = window.setInterval(tick, 500)
}

function stopTicker() {
  if (ticker) {
    window.clearInterval(ticker)
    ticker = 0
  }
}

function syncTicker() {
  const session = normalizeActiveSession(activeRef.value)
  const needTicker = Boolean((session && !session.pausedAt) || restEndsAt.value)
  if (needTicker) ensureTicker()
  else stopTicker()
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') return
  now.value = Date.now()
  syncTicker()
}
function onPageShow() {
  now.value = Date.now()
  if (!activeRef.value && !restEndsAt.value) stopTicker()
  else syncTicker()
}

onMounted(() => {
  applySettingsToUi()
  if (activeRef.value) {
    activeRef.value = normalizeActiveSession(activeRef.value)
    now.value = Date.now()
  }
  syncTicker()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onPageShow)
  window.addEventListener('pageshow', onPageShow)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('focus', onPageShow)
  window.removeEventListener('pageshow', onPageShow)
  window.clearTimeout(hideRecentTimer)
  window.clearTimeout(flashTimer)
  stopTicker()
})
</script>

<template>
  <section class="focus-panel panel" aria-label="自由专注">
    <div class="panel-head">
      <h2>现在专注</h2>
      <span class="panel-progress">
        {{ active ? (active.title || '自由专注') : restEndsAt ? '休息一下' : lastSavedSession ? '本次专注已完成' : '从一件小事开始' }}
      </span>
    </div>

    <p v-if="flashMessage" class="focus-flash" role="status">{{ flashMessage }}</p>

    <div v-if="active" class="focus-active">
      <div class="focus-target">
        <span class="focus-type-tag">{{ active.focusType === 'free' ? '自由专注' : active.focusType === 'temporary' ? '临时目标' : '关联待办' }}</span>
        <strong>{{ active.title || '自由专注' }}</strong>
      </div>
      <b class="focus-clock" :class="{ overtime: display ? display.overtimeSeconds > 0 : false }">{{ clockText }}</b>
      <p class="focus-state-line">{{ activeStateLine }}</p>
      <div class="focus-actions">
        <button type="button" class="btn" :class="active.pausedAt ? 'btn-primary' : 'btn-ghost'" @click="active.pausedAt ? resume() : pause()">
          {{ active.pausedAt ? '继续' : '暂停' }}
        </button>
        <button type="button" class="btn" :class="active.pausedAt ? 'btn-ghost' : 'btn-primary'" @click="requestEnd">结束</button>
      </div>
    </div>

    <div v-else-if="restEndsAt" class="focus-rest">
      <b class="focus-clock">{{ restClockText }}</b>
      <p class="focus-state-line">{{ restRemainingSeconds > 0 ? `休息 ${restMinutes} 分钟` : '休息结束' }}</p>
      <button type="button" class="btn btn-primary" @click="finishRest">{{ restRemainingSeconds > 0 ? '结束休息' : '返回专注' }}</button>
    </div>

    <div v-else-if="lastSavedSession" class="focus-completed">
      <div class="focus-done-mark">✓</div>
      <p class="focus-done-title">{{ lastSavedSession.title || '自由专注' }}</p>
      <p class="focus-done-time">本次专注 {{ formatFocusDuration(lastSavedSession.actualFocusSeconds) }}</p>
      <div class="focus-done-actions">
        <button v-if="lastSavedSession.focusType === 'temporary' && !tempTodoAdded" type="button" class="btn btn-ghost" @click="addTempTodo">加入待办</button>
        <span v-else-if="lastSavedSession.focusType === 'temporary' && tempTodoAdded" class="focus-done-hint">✓ 已加入待办</span>
        <button v-if="lastSavedSession.focusType === 'todo-linked'" type="button" class="btn btn-ghost" :disabled="linkedTodoDone" @click="markTodoDone">
          {{ linkedTodoDone ? '待办已完成' : '标记待办完成' }}
        </button>
        <button type="button" class="btn btn-primary" @click="againFocus">再次专注</button>
      </div>
      <div class="focus-rest-row">
        <span>休息一下？</span>
        <button type="button" class="btn btn-ghost rest-btn" @click="startRest(5)">5 分钟</button>
        <button type="button" class="btn btn-ghost rest-btn" @click="startRest(10)">10 分钟</button>
        <button type="button" class="btn btn-ghost rest-btn" @click="closeCompletion">跳过</button>
      </div>
    </div>

    <div v-else class="focus-idle">
      <label class="focus-goal-label" for="focus-goal-input">这次想专注什么？</label>
      <div class="focus-goal-row">
        <input
          id="focus-goal-input"
          class="goal-input"
          :value="selectedTodo ? selectedTodo.title : targetTitle"
          :readonly="Boolean(selectedTodo)"
          placeholder="输入一个小目标，也可以留空……"
          aria-label="这次想专注什么"
          @input="onGoalInput"
          @focus="showRecent = true"
          @blur="scheduleHideRecent"
        />
        <button v-if="selectedTodo" type="button" class="btn btn-ghost unlink-btn" aria-label="取消待办关联" @click="clearTodo">×</button>
        <button v-else type="button" class="btn btn-ghost pick-todo-btn" @click="showTodoPicker = true">从待办选择</button>
      </div>

      <div v-if="showRecent && recentTemporaries.length && !selectedTodo" class="recent-row">
        <span class="recent-label">最近专注：</span>
        <button v-for="item in recentTemporaries" :key="item" type="button" class="recent-chip" @mousedown.prevent @click="useRecent(item)">{{ item }}</button>
      </div>

      <b class="focus-clock">{{ clockText }}</b>

      <div class="time-chips" aria-label="专注时间">
        <button
          v-for="mins in quickTimes"
          :key="mins"
          type="button"
          class="time-chip"
          :class="{ on: selectedMinutes === mins }"
          @click="selectQuick(mins)"
        >{{ mins }}</button>
        <button type="button" class="time-chip custom-chip" :class="{ on: !quickTimes.includes(selectedMinutes) }" @click="openCustomTime">＋</button>
      </div>

      <button type="button" class="btn btn-primary start-btn" @click="start">开始专注 · {{ selectedMinutes }}分钟</button>
      <p class="link-hint">{{ selectedTodo ? `已关联待办：${selectedTodo.title}` : '不输入目标也可以直接开始，记录为自由专注。' }}</p>
    </div>

    <Modal :open="showTodoPicker" title="从待办选择" @close="showTodoPicker = false">
      <div class="todo-picker">
        <p v-if="!openTasks.length" class="empty-line">没有未完成的待办，直接开始自由专注吧。</p>
        <button v-for="task in openTasks" :key="task.id" type="button" class="todo-option" @click="selectTodo(task)">
          <span class="todo-option-title">{{ task.title }}</span>
          <small>{{ task.dueDate ? (task.dueDate === todayStr() ? '今天' : task.dueDate) : '无截止日期' }}</small>
        </button>
      </div>
    </Modal>

    <Modal :open="showCustomTime" title="自定义专注时间" @close="showCustomTime = false">
      <div class="custom-time">
        <label for="custom-minutes">专注时长（分钟）</label>
        <input id="custom-minutes" v-model.number="customMinutes" type="number" min="5" max="180" inputmode="numeric" placeholder="5～180" />
        <p class="custom-hint">允许 5～180 分钟，例如 37、50、90。</p>
        <p v-if="customError" class="custom-error">{{ customError }}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="showCustomTime = false">取消</button>
          <button type="button" class="btn btn-primary" @click="applyCustomTime">使用</button>
        </div>
      </div>
    </Modal>

    <Modal :open="showEarly" title="提前结束" @close="showEarly = false">
      <div class="early-end">
        <p class="early-text">本次已专注 {{ earlyElapsedText }}</p>
        <p class="early-hint">统计将使用这段真实专注时间。</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" @click="discardEarly">放弃记录</button>
          <button type="button" class="btn btn-primary" @click="confirmEarlySave">保存记录</button>
        </div>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.focus-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.focus-flash {
  margin: 0;
  padding: 8px 12px;
  border-radius: 9px;
  color: #087a58;
  background: #effaf6;
  border: 1px solid #b9e6d5;
  font-size: 12.5px;
}
.focus-active,
.focus-rest,
.focus-completed,
.focus-idle {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.focus-goal-label {
  color: var(--ink-soft);
  font-size: 13px;
  font-weight: 600;
  align-self: flex-start;
}
.focus-goal-row {
  display: flex;
  gap: 8px;
  position: relative;
  flex-wrap: wrap;
}
.goal-input {
  flex: 1;
  min-width: min(240px, 100%);
  padding: 10px 12px;
  border-radius: 10px;
}
.goal-input[readonly] {
  color: var(--ink-soft);
  background: var(--primary-soft);
  border-color: transparent;
}
.pick-todo-btn,
.unlink-btn {
  white-space: nowrap;
  padding: 9px 14px;
  min-height: 40px;
}
.recent-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: -2px;
}
.recent-label {
  color: var(--ink-faint);
  font-size: 12px;
}
.recent-chip {
  border: 1px solid var(--border);
  background: var(--bg-tint);
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--ink-soft);
  cursor: pointer;
}
.recent-chip:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.focus-clock {
  color: var(--primary);
  font-size: clamp(30px, 3vw, 38px);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.focus-clock.overtime {
  color: #0ea271;
}
.focus-target {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.focus-target strong {
  font-size: 15px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-type-tag {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
}
.focus-state-line {
  margin: 0;
  color: var(--ink-faint);
  font-size: 12.5px;
}
.focus-actions {
  display: flex;
  gap: 9px;
}
.focus-actions .btn {
  flex: 1;
  min-height: 44px;
}
.time-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.time-chip {
  min-height: 40px;
  min-width: 56px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--ink-soft);
  font-weight: 650;
  font-size: 14px;
  cursor: pointer;
}
.time-chip.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
}
.start-btn {
  min-height: 48px;
  font-size: 15px;
  border-radius: 12px;
}
.link-hint {
  margin: 0;
  color: var(--ink-faint);
  font-size: 12px;
}
.focus-done-mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e7f8f1;
  color: #14966d;
  font-size: 22px;
  font-weight: 900;
}
.focus-done-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.focus-done-time {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13.5px;
}
.focus-done-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}
.focus-done-actions .btn {
  min-height: 44px;
}
.focus-done-hint {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: #087a58;
  font-size: 13px;
  font-weight: 600;
}
.focus-rest-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
  color: var(--ink-faint);
  font-size: 12.5px;
}
.rest-btn {
  padding: 7px 12px;
  min-height: 38px;
  font-size: 12.5px;
}
.todo-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 55vh;
  overflow-y: auto;
}
.todo-option {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  text-align: left;
  cursor: pointer;
}
.todo-option:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.todo-option-title {
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.todo-option small {
  color: var(--ink-faint);
  font-size: 12px;
}
.empty-line {
  color: var(--ink-faint);
  font-size: 13px;
  padding: 8px 0;
}
.custom-time {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.custom-time label {
  color: var(--ink-soft);
  font-weight: 600;
  font-size: 13px;
}
.custom-time input {
  font-size: 18px;
  padding: 10px 12px;
}
.custom-hint,
.early-hint {
  margin: 0;
  color: var(--ink-faint);
  font-size: 12.5px;
}
.custom-error {
  margin: 0;
  color: var(--danger);
  font-size: 12.5px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.modal-actions .btn {
  min-height: 44px;
}
.early-text {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
@media (max-width: 520px) {
  .focus-goal-row {
    flex-direction: column;
  }
  .goal-input {
    width: 100%;
    min-width: 0;
  }
  .pick-todo-btn,
  .unlink-btn {
    width: 100%;
  }
  .time-chip {
    flex: 1;
    min-width: 56px;
    height: 46px;
  }
  .start-btn {
    width: 100%;
    height: 52px;
  }
  .focus-actions {
    width: 100%;
  }
  .focus-actions .btn {
    height: 48px;
  }
}
</style>
