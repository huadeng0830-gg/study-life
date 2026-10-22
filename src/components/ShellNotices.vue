<script setup>
/**
 * 外壳级底部提示（安卓相关）。
 *
 * 两条提示都挂在底部浮层的同一套坑位栈（composables/floatingStack.js）上，
 * 与 Toast、快速记录成功提示、全局错误提示互不压盖。
 *
 * 单独成组件而不是塞进 App.vue：App.vue 已接近单文件行数上限
 * （见 tests/ratchetHardcoding.test.js 的 LARGE_FILE_LIMITS），
 * 而且这两条提示只在安卓安装版上出现，与外壳其它部分无关。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ANDROID_EXIT_HINT, androidExitHint } from '../composables/androidRuntime.js'
import { attachFloatingSlot, createFloatingSlot, detachFloatingSlot, useFloatingOffset } from '../composables/floatingStack.js'
import { announce } from '../composables/liveRegion.js'

// 提醒事件名与 composables/reminderScheduler.js 里的 REMINDER_EVENT 相同。
// 这里刻意**不**直接 import 那个模块：它是动态加载的（不该进首屏包），
// 直接引会把整条调度器依赖链拖进启动包。事件名是跨模块契约，改动时两处一起改。
const REMINDER_EVENT = 'study-life:reminder'

const androidHintSlot = createFloatingSlot()
const androidHintOffset = useFloatingOffset(androidHintSlot, 56)
const reminderSlot = createFloatingSlot()
const reminderOffset = useFloatingOffset(reminderSlot, 56)

/** @type {import('vue').Ref<{ title: string, body: string } | null>} */
const reminder = ref(null)
let reminderTimer = 0

function onReminder(event) {
  const detail = event?.detail || {}
  reminder.value = { title: String(detail.title || '提醒'), body: String(detail.body || '') }
  window.clearTimeout(reminderTimer)
  reminderTimer = window.setTimeout(() => { reminder.value = null }, 8000)
}

const reminderOpen = computed(() => Boolean(reminder.value))

watch(() => Boolean(androidExitHint.value), (open) => {
  if (open) {
    attachFloatingSlot(androidHintSlot)
    announce(ANDROID_EXIT_HINT)
  } else detachFloatingSlot(androidHintSlot)
})

watch(reminderOpen, (open) => {
  if (open) {
    attachFloatingSlot(reminderSlot)
    announce(reminder.value?.title || '提醒')
  } else detachFloatingSlot(reminderSlot)
})

onMounted(() => { window.addEventListener(REMINDER_EVENT, onReminder) })
onBeforeUnmount(() => {
  window.removeEventListener(REMINDER_EVENT, onReminder)
  window.clearTimeout(reminderTimer)
  detachFloatingSlot(androidHintSlot)
  detachFloatingSlot(reminderSlot)
})
</script>

<template>
  <Transition name="global-error">
    <!-- 安卓返回键在最外层被按下时的「再按一次退出」提示。
         播报走常驻的礼貌通道（见上面的 watcher），toast 本身不带 live role。 -->
    <div v-if="androidExitHint" class="global-error-toast android-exit-hint" :style="{ '--stack-offset': `${androidHintOffset}px` }">
      <div class="global-error-copy">
        <span>{{ ANDROID_EXIT_HINT }}</span>
      </div>
    </div>
  </Transition>

  <Transition name="global-error">
    <!-- 应用内提醒。安卓安装版的 WebView 没有系统通知，
         到点的提醒只在这里出现（见 reminderScheduler.js 的 fire()）。 -->
    <div v-if="reminder" class="global-error-toast shell-reminder" :style="{ '--stack-offset': `${reminderOffset}px` }">
      <div class="global-error-copy">
        <b>{{ reminder.title }}</b>
        <span>{{ reminder.body }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 外观沿用外壳的 .global-error-toast：同样的玻璃卡片、同样的层级，
   差别只有文案区。这里不写 z-index —— 层叠阶梯棘轮只准降
   （见 tests/ratchetHardcoding.test.js），与其它底部提示靠坑位错开即可。 */
.global-error-toast {
  left: 50%;
  bottom: calc(18px + var(--safe-bottom) + var(--stack-offset, 0px));
  z-index: 300;
  border: 1px solid var(--border-strong);
  background: var(--card);
  max-width: min(560px, 100vw - 32px);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-12);
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  display: flex;
  position: fixed;
  transform: translate(-50%);
}
@media (max-width: 900px), (pointer: coarse) and (max-height: 520px) {
  .global-error-toast {
    bottom: calc(86px + var(--safe-bottom) + var(--stack-offset, 0px));
  }
}
.global-error-copy {
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  display: flex;
}
.global-error-copy b {
  font-size: var(--fs-13);
}
.android-exit-hint .global-error-copy span {
  color: var(--text);
  font-size: var(--fs-13);
}
.shell-reminder .global-error-copy span {
  white-space: pre-wrap;
}
</style>
