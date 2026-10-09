<script setup>
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import Modal from './Modal.vue'
import TaskWorkSession from './tasks/TaskWorkSession.vue'
import { useTaskWorkSession } from '../composables/tasks/useTaskWorkSession.js'
import { useStoredRef } from '../composables/store/index.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isTaskActionable, taskStatus } from '../composables/domain/state.js'
import { appDateTime, getAppToday } from '../composables/timeContext.js'
import {
  DEFAULT_FOCUS_SETTINGS,
  buildFocusSession,
  createFocusSessionId,
  focusActualSeconds,
  focusDisplayState,
  focusPlannedSeconds,
  formatFocusDuration,
  finalizeStaleActiveSession,
  normalizeActiveSession,
  normalizeFocusSettings,
  pushRecentTemporary,
} from '../composables/focusTimer.js'

const props = defineProps({ request: { type: /** @type {import('vue').PropType<{ id: string, minutes: number, token: number } | null>} */ (Object), default: null } })
const emit = defineEmits(['prepared'])
let panelMounted = false
let handledRequest = null
const domain = useDomainCommands()
// 这里只取 tasks；专注记录用 domain.recordFocusSession 写入，
// 面板本身不读取会话列表（统计在专注统计视图里）。
const { tasks } = domain
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
const roundNumber = ref(1)
const lastCompletedRound = ref(0)
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
const activeTodo = computed(() => tasks.value.find((task) => task.id === active.value?.todoId) || null)
const savedTodo = computed(() => tasks.value.find((task) => task.id === lastSavedSession.value?.todoId) || null)
const canRecordProgress = computed(() => savedTodo.value && !savedTodo.value.deletedAt && !savedTodo.value.tombstone && savedTodo.value.sourceType !== 'project-task' && isTaskActionable(savedTodo.value))
const {
  task: workSessionTask, draft: workSessionDraft, error: workSessionError, busy: workSessionBusy,
  statusLabel: workSessionStatusLabel, open: openTaskWorkSession, close: closeTaskWorkSession,
  updateField: updateWorkSessionField, save: saveTaskWorkProgress,
} = useTaskWorkSession({ domain, openProjectTask: () => {}, notify: showFlash })
const openTasks = computed(() => {
  const open = tasks.value.filter((task) => task && !task.deletedAt && !task.tombstone && isTaskActionable(task, new Date(now.value)))
  const dueTs = (task) => (task.dueDate ? appDateTime(task.dueDate, task.dueTime || '23:59') : Infinity)
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
  const task = tasks.value.find((item) => item.id === session.todoId)
  return task ? taskStatus(task) === 'completed' : false
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

function prepareRequestedTask() {
  const request = props.request
  if (!panelMounted || !request || handledRequest === request.token) return
  handledRequest = request.token
  if (activeRef.value) {
    const message = '已有专注正在进行，请先继续或结束当前专注。'
    showFlash(message)
    emit('prepared', { taskId: request.id, message })
    return
  }
  const task = tasks.value.find((item) => String(item.id) === request.id && !item.deletedAt && !item.tombstone && isTaskActionable(item))
  if (!task) {
    const message = '这条待办已完成、归档或移除，请选择当前待办。'
    showFlash(message)
    emit('prepared', { taskId: request.id, message })
    return
  }
  selectedTodoId.value = task.id
  selectedMinutes.value = Math.max(5, Math.min(180, Math.round(Number(request.minutes) || 25)))
  targetTitle.value = ''
  lastSavedSession.value = null
  restEndsAt.value = null
  showEarly.value = false
  showTodoPicker.value = false
  syncTicker()
  emit('prepared', { taskId: request.id, message: `已选中「${task.title}」，确认时长后开始专注。` })
}

watch(() => props.request, prepareRequestedTask, { flush: 'post' })

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
  if (todoId && (!selectedTodo.value || selectedTodo.value.deletedAt || selectedTodo.value.tombstone || !isTaskActionable(selectedTodo.value))) {
    selectedTodoId.value = ''
    showFlash('这条待办已完成或移除，请重新选择。')
    return
  }
  if (todoId && selectedTodo.value?.sourceType !== 'project-task') domain.updateTask(todoId, { status: 'in_progress', done: false, completedAt: null })
  const title = todoId ? selectedTodo.value?.title || '' : targetTitle.value.trim()
  const startedAt = new Date().toISOString()
  let nextSettings = normalizeFocusSettings(focusSettings.value)
  nextSettings = { ...nextSettings, lastUsedMinutes: Number(selectedMinutes.value) }
  if (!todoId && title) nextSettings = pushRecentTemporary(nextSettings, title)
  focusSettings.value = nextSettings
  roundNumber.value = Math.min(roundNumber.value, nextSettings.pomodoroRounds)
  lastCompletedRound.value = 0
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
  saveFocus('completed', { autoRest: true })
}

function startRoundRest() {
  const totalRounds = settings.value.pomodoroRounds
  const completedRound = Math.min(totalRounds, Math.max(1, roundNumber.value))
  lastCompletedRound.value = completedRound
  roundNumber.value = completedRound >= totalRounds ? 1 : completedRound + 1
  restMinutes.value = completedRound >= totalRounds ? 10 : 5
  now.value = Date.now()
  restEndsAt.value = now.value + restMinutes.value * 60000
  syncTicker()
}

function saveFocus(status = 'completed', { autoRest = false } = {}) {
  const session = buildFocusSession(activeRef.value, new Date().toISOString(), status)
  if (!session) return
  domain.recordFocusSession(session)
  activeRef.value = null
  showEarly.value = false
  lastSavedSession.value = session
  tempTodoAdded.value = false
  notifiedSessionId = ''
  if (autoRest && status === 'completed') startRoundRest()
  else syncTicker()
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
  domain.completeTask(session.todoId)
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

function recoverStaleFocusSession() {
  const saved = finalizeStaleActiveSession(activeRef.value)
  if (!saved) return
  domain.recordFocusSession(saved)
  activeRef.value = null
  lastSavedSession.value = saved
  showFlash('上次专注长时间未结束，已按计划时长记录。')
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
    try { new Notification('三两事 · 专注完成', { body: `「${title}」已完成 ${session.plannedMinutes} 分钟` }) } catch { }
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
      saveFocus('completed', { autoRest: true })
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
    recoverStaleFocusSession()
  }
  panelMounted = true
  prepareRequestedTask()
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

// 本组件在 TodayView 里，而 TodayView 被 <KeepAlive :max="4"> 缓存着：
// 切到别的标签页只是「停用」而不是卸载，onBeforeUnmount 不会触发。
// 于是专注进行中离开首页后，这个 500ms 的定时器会一直每半秒写一次 now.value，
// 让 display / clockText / restRemainingSeconds 全部反复失效 —— 页面看不见，CPU 照烧。
// 与 VirtualList.vue 用的是同一套 onActivated / onDeactivated 约定。
onDeactivated(() => {
  closeTaskWorkSession()
  stopTicker()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('focus', onPageShow)
  window.removeEventListener('pageshow', onPageShow)
})

onActivated(() => {
  prepareRequestedTask()
  syncTicker()
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onPageShow)
  window.addEventListener('pageshow', onPageShow)
})
</script>

<template>
  <section class="focus-panel panel" :aria-label="active?.todoId || selectedTodo ? '任务专注' : '自由专注'">
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
      <p v-if="activeTodo?.workCheckpoint?.nextStep" class="focus-checkpoint">下一步：{{ activeTodo.workCheckpoint.nextStep }}</p>
      <b class="focus-clock" :class="{ overtime: display ? display.overtimeSeconds > 0 : false }">{{ clockText }}</b>
      <p class="focus-round">第 {{ roundNumber }} 轮 / 共 {{ settings.pomodoroRounds }} 轮</p>
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
      <p class="focus-round">第 {{ lastCompletedRound }} 轮 / 共 {{ settings.pomodoroRounds }} 轮</p>
      <p v-if="lastSavedSession" class="focus-rest-summary">{{ lastSavedSession.title || '自由专注' }} · 本次专注 {{ formatFocusDuration(lastSavedSession.actualFocusSeconds) }}</p>
      <p class="focus-state-line">{{ restRemainingSeconds > 0 ? `休息 ${restMinutes} 分钟` : '休息结束' }}</p>
      <button v-if="canRecordProgress" type="button" class="btn btn-ghost" @click="openTaskWorkSession(savedTodo)">记录做到哪里</button>
      <button type="button" class="btn btn-primary" @click="finishRest">{{ restRemainingSeconds > 0 ? '结束休息' : '返回专注' }}</button>
    </div>

    <div v-else-if="lastSavedSession" class="focus-completed">
      <div class="focus-done-mark" aria-hidden="true">✓</div>
      <p class="focus-done-title">{{ lastSavedSession.title || '自由专注' }}</p>
      <p class="focus-done-time">本次专注 {{ formatFocusDuration(lastSavedSession.actualFocusSeconds) }}</p>
      <p v-if="lastCompletedRound" class="focus-round">第 {{ lastCompletedRound }} 轮 / 共 {{ settings.pomodoroRounds }} 轮</p>
      <div class="focus-done-actions">
        <button v-if="canRecordProgress" type="button" class="btn btn-ghost" @click="openTaskWorkSession(savedTodo)">记录做到哪里</button>
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

      <div class="time-chips" role="group" aria-label="专注时间">
        <!-- 这些格子的可访问名称默认就是裸数字，读屏只会念「25」，听不出单位，
             所以逐个补上「25 分钟」。aria-label 会覆盖内容成为可访问名称，
             可视文字保持原样。
             role="group" 是为了让外层的 aria-label 真正生效：aria-label 加在
             普通 div 上是被忽略的，加了角色之后读屏才会把这一组当成「专注时间」。 -->
        <button
          v-for="mins in quickTimes"
          :key="mins"
          type="button"
          class="time-chip tap-target"
          :class="{ on: selectedMinutes === mins }"
          :aria-label="`${mins} 分钟`"
          :aria-pressed="selectedMinutes === mins"
          @click="selectQuick(mins)"
        >{{ mins }}</button>
        <!-- 这一格只有一个全角「＋」，读屏会把可访问名称念成符号本身，听不出它就是「自定义时长」。
             aria-label 会覆盖按钮内容成为可访问名称，符号保持可见，因此不需要再给符号加 aria-hidden。
             顺带补 tap-target：.time-chip 高 40px，在粗指针设备上够不到 44px 的最小命中区。 -->
        <button type="button" class="time-chip custom-chip tap-target" aria-label="自定义专注时长" :class="{ on: !quickTimes.includes(selectedMinutes) }" :aria-pressed="!quickTimes.includes(selectedMinutes)" @click="openCustomTime">＋</button>
      </div>

      <button type="button" class="btn btn-primary start-btn" @click="start">开始专注 · {{ selectedMinutes }}分钟</button>
      <p class="link-hint">{{ selectedTodo ? `已关联待办：${selectedTodo.title}` : '不输入目标也可以直接开始，记录为自由专注。' }}</p>
      <p v-if="selectedTodo?.workCheckpoint?.nextStep" class="focus-checkpoint">下一步：{{ selectedTodo.workCheckpoint.nextStep }}</p>
    </div>

    <TaskWorkSession :open="Boolean(workSessionTask)" :task="workSessionTask" :checkpoint="workSessionTask?.workCheckpoint" :form="workSessionDraft"
      :status-label="workSessionStatusLabel" :can-save="Boolean(workSessionTask)" :busy="workSessionBusy" :error="workSessionError"
      @close="closeTaskWorkSession" @save="saveTaskWorkProgress" @update:field="updateWorkSessionField" />

    <Modal :open="showTodoPicker" title="从待办选择" @close="showTodoPicker = false">
      <div class="todo-picker">
        <p v-if="!openTasks.length" class="empty-line">没有未完成的待办，直接开始自由专注吧。</p>
        <button v-for="task in openTasks" :key="task.id" type="button" class="todo-option" @click="selectTodo(task)">
          <span class="todo-option-title">{{ task.title }}</span>
          <small>{{ task.dueDate ? (task.dueDate === getAppToday() ? '今天' : task.dueDate) : '无截止日期' }}</small>
        </button>
      </div>
    </Modal>

    <Modal :open="showCustomTime" title="自定义专注时间" @close="showCustomTime = false">
      <div class="custom-time">
        <label for="custom-minutes">专注时长（分钟）</label>
        <input id="custom-minutes" v-model.number="customMinutes" type="number" min="5" max="180" inputmode="numeric" placeholder="5～180" />
        <p class="custom-hint">允许 5～180 分钟，例如 37、50、90。</p>
        <p v-if="customError" class="custom-error" role="alert">{{ customError }}</p>
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

<style scoped src="./focus-panel.css"></style>
