<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStoredRef } from '../composables/store/index.js'
import { focusElapsedSeconds } from '../composables/experience.js'

const props = defineProps({ tasks: { type: Array, default: () => [] } })
const focusSessions = useStoredRef('sl_focus_sessions', [])
const active = useStoredRef('sl_focus_active', null)
const now = ref(Date.now())
let timer = 0

const openTasks = computed(() => props.tasks.filter((task) => !task.done && task.status !== 'archived').slice(0, 12))
const selectedTaskId = ref('')
const running = computed(() => Boolean(active.value?.startedAt && !active.value?.pausedAt))
const remainingSeconds = computed(() => {
  if (!active.value) return 0
  const planned = Math.max(1, Number(active.value.durationMinutes) || 25) * 60
  return Math.max(0, planned - focusElapsedSeconds(active.value, now.value))
})
const clockText = computed(() => `${String(Math.floor(remainingSeconds.value / 60)).padStart(2, '0')}:${String(remainingSeconds.value % 60).padStart(2, '0')}`)
const selectedTask = computed(() => openTasks.value.find((task) => task.id === selectedTaskId.value) || null)

function ensureTicker() {
  if (!timer) timer = window.setInterval(() => { now.value = Date.now(); if (active.value && remainingSeconds.value <= 0) finish('completed') }, 1000)
}
function stopTicker() { window.clearInterval(timer); timer = 0 }
function start(minutes = 25) {
  const task = selectedTask.value
  const startedAt = new Date()
  active.value = { startedAt: startedAt.toISOString(), segmentStartedAt: startedAt.toISOString(), elapsedSeconds: 0, endsAt: new Date(startedAt.getTime() + minutes * 60000).toISOString(), durationMinutes: minutes, taskId: task?.id || '', courseId: task?.courseId || '', label: task?.title || '自由专注' }
  now.value = Date.now()
  ensureTicker()
}
function pause() {
  if (!active.value) return
  const elapsedSeconds = focusElapsedSeconds(active.value, Date.now())
  active.value = { ...active.value, pausedAt: new Date().toISOString(), elapsedSeconds, remainingSeconds: Math.max(0, (Number(active.value.durationMinutes) || 25) * 60 - elapsedSeconds) }
  stopTicker()
}
function resume() {
  if (!active.value) return
  const seconds = Math.max(1, Number(active.value.remainingSeconds) || 0)
  const resumedAt = new Date()
  active.value = { ...active.value, pausedAt: '', segmentStartedAt: resumedAt.toISOString(), endsAt: new Date(resumedAt.getTime() + seconds * 1000).toISOString() }
  ensureTicker()
}
function finish(result = 'completed') {
  if (!active.value) return
  const elapsed = focusElapsedSeconds(active.value, Date.now())
  if (elapsed >= 60) focusSessions.value.unshift({ id: `focus${Date.now()}`, startedAt: active.value.startedAt, endedAt: new Date().toISOString(), minutes: Math.max(1, Math.round(elapsed / 60)), taskId: active.value.taskId, courseId: active.value.courseId, label: active.value.label, result })
  active.value = null
  stopTicker()
}
if (active.value && !active.value.pausedAt) ensureTicker()
onBeforeUnmount(stopTicker)
</script>

<template>
  <section class="focus-panel panel" aria-label="轻量专注">
    <div class="panel-head"><h2>现在专注</h2><span class="panel-progress">{{ active ? active.label : '从一件小事开始' }}</span></div>
    <div class="focus-body">
      <b class="focus-clock">{{ active ? clockText : '25:00' }}</b>
      <select v-if="!active" v-model="selectedTaskId" aria-label="选择要专注的待办"><option value="">不绑定待办</option><option v-for="task in openTasks" :key="task.id" :value="task.id">{{ task.title }}</option></select>
      <div class="focus-actions">
        <template v-if="!active"><button type="button" class="btn btn-primary" @click="start(25)">开始 25 分钟</button><button type="button" class="btn btn-ghost" @click="start(45)">45 分钟</button></template>
        <template v-else-if="running"><button type="button" class="btn btn-ghost" @click="pause">暂停</button><button type="button" class="btn btn-primary" @click="finish('completed')">结束</button></template>
        <template v-else><button type="button" class="btn btn-primary" @click="resume">继续</button><button type="button" class="btn btn-ghost" @click="finish('stopped')">保存记录</button></template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.focus-panel { display: grid; grid-template-columns: minmax(0, 1fr); }
.focus-body { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.focus-clock { color: var(--primary); font-size: 25px; letter-spacing: .04em; font-variant-numeric: tabular-nums; }
.focus-body select { min-width: min(250px, 100%); flex: 1; }
.focus-actions { display: flex; gap: 7px; }
@media (max-width: 520px) { .focus-body select { flex-basis: 100%; } .focus-actions { width: 100%; } .focus-actions .btn { flex: 1; } }
</style>
