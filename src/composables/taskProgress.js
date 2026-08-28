import { computed, getCurrentScope, onScopeDispose, reactive } from 'vue'

export const TASK_STEP_STATUS = Object.freeze([
  'waiting',
  'running',
  'completed',
  'warning',
  'needs-confirmation',
  'failed',
  'cancelled',
])

const TERMINAL = new Set(['completed', 'warning', 'failed', 'cancelled'])

function normalizeError(error, fallback = '任务处理失败') {
  if (error instanceof Error && error.message) return error.message
  return String(error || fallback)
}

export function useTaskProgress() {
  const state = reactive({
    active: false,
    visible: false,
    title: '',
    status: 'waiting',
    steps: [],
    startedAt: 0,
    finishedAt: 0,
    now: Date.now(),
    latestActivity: '',
    lastActivityAt: 0,
    partial: null,
    error: '',
    canCancel: false,
    canRetry: false,
    retainedResult: false,
    stalledAcknowledgedAt: 0,
  })

  let timer = 0
  let visibilityTimer = 0
  let cancelHandler = null

  const elapsedSeconds = computed(() => {
    if (!state.startedAt) return 0
    return Math.max(0, Math.floor(((state.finishedAt || state.now) - state.startedAt) / 1000))
  })
  const activityAgeSeconds = computed(() => {
    if (!state.lastActivityAt) return null
    return Math.max(0, Math.floor((state.now - state.lastActivityAt) / 1000))
  })
  const isStalled = computed(() => state.status === 'running'
    && activityAgeSeconds.value !== null
    && activityAgeSeconds.value >= 15
    && state.now - state.stalledAcknowledgedAt >= 15_000)
  const completedCount = computed(() => state.steps.filter((step) => step.status === 'completed').length)

  function stopTimer() {
    window.clearInterval(timer)
    window.clearTimeout(visibilityTimer)
    timer = 0
    visibilityTimer = 0
  }

  function start({ title, steps, cancel = null }) {
    stopTimer()
    const now = Date.now()
    Object.assign(state, {
      active: true,
      visible: false,
      title,
      status: 'running',
      steps: steps.map((step) => ({
        id: typeof step === 'string' ? step : step.id,
        label: typeof step === 'string' ? step : step.label,
        status: 'waiting',
        detail: '',
      })),
      startedAt: now,
      finishedAt: 0,
      now,
      latestActivity: '任务已开始',
      lastActivityAt: now,
      partial: null,
      error: '',
      canCancel: typeof cancel === 'function',
      canRetry: false,
      retainedResult: false,
      stalledAcknowledgedAt: 0,
    })
    cancelHandler = cancel
    timer = window.setInterval(() => { state.now = Date.now() }, 1000)
    visibilityTimer = window.setTimeout(() => {
      if (state.active && state.status === 'running') state.visible = true
    }, 700)
  }

  function activity(message, force = false) {
    if (!message) return
    if (!force && TERMINAL.has(state.status)) return
    state.latestActivity = message
    state.lastActivityAt = Date.now()
    state.now = state.lastActivityAt
  }

  function continueWaiting() {
    if (state.status !== 'running') return
    state.stalledAcknowledgedAt = Date.now()
    state.now = state.stalledAcknowledgedAt
  }

  function setStep(id, status, detail = '') {
    if (!TASK_STEP_STATUS.includes(status)) throw new Error(`未知任务状态：${status}`)
    if (TERMINAL.has(state.status)) return
    const step = state.steps.find((item) => item.id === id)
    if (!step) return
    if (status === 'running') {
      for (const item of state.steps) {
        if (item.status === 'running' && item.id !== id) item.status = 'completed'
      }
    }
    step.status = status
    step.detail = detail
    activity(detail || step.label)
  }

  function setPartial(partial, message = '') {
    if (TERMINAL.has(state.status)) return
    state.partial = partial
    if (message) activity(message)
  }

  function finish(message = '处理完成', status = 'completed') {
    if (TERMINAL.has(state.status)) return
    for (const step of state.steps) {
      if (step.status === 'running') step.status = status === 'warning' ? 'warning' : 'completed'
    }
    state.status = status
    state.finishedAt = Date.now()
    state.now = state.finishedAt
    state.canCancel = false
    state.canRetry = false
    activity(message, true)
    stopTimer()
    cancelHandler = null
    if (!state.visible) state.active = false
  }

  function fail(stepId, error, { retry = true, retainedResult = false } = {}) {
    if (TERMINAL.has(state.status)) return
    const message = normalizeError(error)
    if (stepId) setStep(stepId, 'failed', message)
    state.status = 'failed'
    state.visible = true
    state.error = message
    state.finishedAt = Date.now()
    state.now = state.finishedAt
    state.canCancel = false
    state.canRetry = retry
    state.retainedResult = retainedResult
    stopTimer()
    cancelHandler = null
  }

  async function cancel() {
    if (!state.canCancel || TERMINAL.has(state.status)) return false
    const handler = cancelHandler
    state.canCancel = false
    const running = state.steps.find((step) => step.status === 'running')
    if (running) running.status = 'cancelled'
    state.retainedResult = Boolean(state.partial && Object.keys(state.partial).length)
    state.status = 'cancelled'
    state.visible = true
    state.finishedAt = Date.now()
    state.now = state.finishedAt
    stopTimer()
    cancelHandler = null
    try {
      await handler?.()
    } finally {
      activity(state.retainedResult ? '任务已取消，已完成的结果仍然保留' : '任务已取消，未完成结果不会写入', true)
    }
    return true
  }

  function reset() {
    stopTimer()
    cancelHandler = null
    Object.assign(state, {
      active: false,
      visible: false,
      title: '',
      status: 'waiting',
      steps: [],
      startedAt: 0,
      finishedAt: 0,
      now: Date.now(),
      latestActivity: '',
      lastActivityAt: 0,
      partial: null,
      error: '',
      canCancel: false,
      canRetry: false,
      retainedResult: false,
      stalledAcknowledgedAt: 0,
    })
  }

  if (getCurrentScope()) onScopeDispose(stopTimer)

  return {
    state,
    elapsedSeconds,
    activityAgeSeconds,
    isStalled,
    completedCount,
    start,
    setStep,
    setPartial,
    activity,
    continueWaiting,
    finish,
    fail,
    cancel,
    reset,
    dispose: stopTimer,
  }
}
