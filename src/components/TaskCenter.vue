<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import {
  TASK_RESULT_LABELS,
  cancelTask,
  clearTaskResults,
  formatTaskAge,
  formatTaskElapsed,
  hasRunningTask,
  markResultsSeen,
  runningTaskCount,
  runningTasks,
  taskCancelHint,
  taskCanCancel,
  taskCenterAttention,
  taskCenterResults,
  taskDetailOf,
  taskMessageOf,
  taskStartedAt,
  unseenResultCount,
} from '../composables/taskCenter.js'

/**
 * 全局后台任务入口。
 *
 * 「长等待可以离开」：任何正在后台跑的长任务都会在这里露出一个悬浮胶囊，
 * 点开是一张任务面板；任务结束后留下结果，离开原页面也能回来查看。
 *
 * 计时只在面板打开时进行（一次性 interval，关闭即清除），不常驻轮询。
 */
const open = ref(false)
const now = ref(Date.now())
let tickTimer = 0

const visibleRunning = computed(() => runningTasks.value)
const results = computed(() => taskCenterResults.value)
const attention = computed(() => taskCenterAttention.value)

const pillLabel = computed(() => {
  if (runningTaskCount.value > 0) {
    const first = visibleRunning.value[0]
    return runningTaskCount.value > 1
      ? `${runningTaskCount.value} 个后台任务进行中`
      : `${first?.title || '后台任务'}进行中`
  }
  return `${unseenResultCount.value} 条新结果`
})

function startTick() {
  stopTick()
  now.value = Date.now()
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
}

function stopTick() {
  window.clearInterval(tickTimer)
  tickTimer = 0
}

watch(open, (value) => {
  if (value) {
    markResultsSeen()
    startTick()
  } else {
    stopTick()
  }
})

async function onCancel(task) {
  await cancelTask(task)
}

function elapsedOf(task) {
  return formatTaskElapsed(taskStartedAt(task), now.value)
}

function ageOf(result) {
  return formatTaskAge(result.at, now.value)
}

onBeforeUnmount(() => {
  stopTick()
})
</script>

<template>
  <div class="task-center">
    <button
      v-if="attention && !open"
      type="button"
      class="task-pill"
      :class="{ 'is-done': !hasRunningTask }"
      @click="open = true"
    >
      <span class="task-pill-dot" :class="{ spin: hasRunningTask }" aria-hidden="true" />
      <span class="task-pill-text">{{ pillLabel }}</span>
      <span v-if="hasRunningTask && unseenResultCount > 0" class="task-pill-badge" aria-hidden="true">{{ unseenResultCount }}</span>
    </button>

    <Modal :open="open" title="后台任务" medium sheet :sheet-detents="[0.5, 0.84]" @close="open = false">
      <div class="task-list">
        <section v-if="visibleRunning.length" class="task-group">
          <h3 class="task-group-title">进行中</h3>
          <article v-for="task in visibleRunning" :key="task.id" class="task-row">
            <div class="task-row-main">
              <p class="task-row-title">
                <span class="task-row-dot spin" aria-hidden="true" />
                {{ task.title }}
              </p>
              <p v-if="taskMessageOf(task)" class="task-row-message">{{ taskMessageOf(task) }}</p>
              <p v-if="taskDetailOf(task)" class="task-row-detail">{{ taskDetailOf(task) }}</p>
              <p class="task-row-meta">
                <span v-if="elapsedOf(task)">{{ elapsedOf(task) }}</span>
                <span v-if="task.description" class="task-row-hint">{{ task.description }}</span>
              </p>
            </div>
            <button
              v-if="taskCanCancel(task)"
              type="button"
              class="btn task-row-action"
              @click="onCancel(task)"
            >取消</button>
            <span v-else-if="taskCancelHint(task)" class="task-row-note">{{ taskCancelHint(task) }}</span>
          </article>
        </section>

        <section v-if="results.length" class="task-group">
          <div class="task-group-head">
            <h3 class="task-group-title">最近结果</h3>
            <button type="button" class="task-link" @click="clearTaskResults">清空</button>
          </div>
          <article v-for="result in results" :key="`${result.id}-${result.at}`" class="task-row is-result">
            <div class="task-row-main">
              <p class="task-row-title">
                <span class="task-row-status" :data-status="result.status" aria-hidden="true" />
                {{ result.title }}
                <span class="task-row-tag">{{ TASK_RESULT_LABELS[result.status] || result.status }}</span>
              </p>
              <p v-if="result.message" class="task-row-message">{{ result.message }}</p>
              <p class="task-row-meta">{{ ageOf(result) }}</p>
            </div>
          </article>
        </section>

        <p v-if="!visibleRunning.length && !results.length" class="task-empty">
          当前没有后台任务。长任务（例如自动同步）会在这里显示，可以放心离开页面。
        </p>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.task-pill {
  position: fixed;
  right: max(16px, env(safe-area-inset-right, 0px));
  /* 移动端与 Toast/快速记录/全局错误同一底栏避让高度 86px（原先 76px 与其它浮层差 10px）。 */
  bottom: calc(86px + env(safe-area-inset-bottom, 0px));
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
  padding: 9px 14px;
  color: var(--on-primary, #fff);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--primary);
  box-shadow: 0 10px 24px rgba(31, 41, 55, 0.22);
  font: inherit;
  font-size: var(--fs-12-5);
  font-weight: var(--fw-700);
  animation: task-pill-in var(--dur-base, 220ms) var(--ease-spring, ease);
}
.task-pill.is-done {
  color: var(--text);
  border: 1px solid var(--border);
  background: var(--card);
}
.task-pill-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.task-pill-dot {
  flex: 0 0 9px;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-circle);
  background: currentColor;
}
.task-pill-badge {
  min-width: 17px;
  padding: 0 5px;
  color: var(--primary);
  border-radius: var(--radius-pill);
  background: var(--card);
  font-size: var(--fs-11);
  line-height: 17px;
  text-align: center;
}
.task-list {
  display: grid;
  gap: 16px;
}
.task-group {
  display: grid;
  gap: 9px;
}
.task-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.task-group-title {
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-weight: var(--fw-800);
  letter-spacing: 0.06em;
}
.task-link {
  padding: 0;
  color: var(--primary);
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
}
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-12);
  background: var(--bg);
}
.task-row.is-result {
  background: var(--card);
}
.task-row-main {
  display: grid;
  flex: 1;
  gap: 4px;
  min-width: 0;
}
.task-row-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--text);
  font-size: var(--fs-13-5);
  font-weight: var(--fw-700);
}
.task-row-dot {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: var(--primary);
}
.task-row-status {
  flex: 0 0 8px;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: #14966d;
}
.task-row-status[data-status="warning"] { background: #d98324; }
.task-row-status[data-status="failed"] { background: #dc4c4c; }
.task-row-status[data-status="cancelled"] { background: var(--ink-faint); }
.task-row-tag {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-weight: var(--fw-700);
}
.task-row-message {
  margin: 0;
  color: var(--ink-soft);
  font-size: var(--fs-12-5);
  line-height: 1.5;
}
.task-row-detail {
  margin: 0;
  color: var(--primary);
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
}
.task-row-meta {
  display: flex;
  gap: 8px;
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.5;
}
.task-row-hint {
  flex: 1;
  min-width: 0;
}
.task-row-action,
.task-row-note {
  flex: 0 0 auto;
  min-height: 34px;
  font-size: var(--fs-12);
}
.task-row-note {
  color: var(--ink-faint);
}
.task-empty {
  margin: 0;
  padding: 18px 4px;
  color: var(--ink-faint);
  font-size: var(--fs-12-5);
  line-height: 1.6;
  text-align: center;
}
.spin {
  animation: task-spin 1.1s linear infinite;
}
@keyframes task-spin {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.78); }
}
@keyframes task-pill-in {
  from { opacity: 0; transform: translateY(10px) scale(0.94); }
  to { opacity: 1; transform: none; }
}
/* 901 而非 900：底栏是 max-width:900px，视口恰为 900 时若这里写 min-width:900，
   两条同时生效，胶囊会停在底栏高度内被压住；901 与 Sidebar/App 的桌面档对齐。 */
@media (min-width: 901px) {
  .task-pill {
    right: max(24px, env(safe-area-inset-right, 0px));
    bottom: 24px;
  }
}
</style>
