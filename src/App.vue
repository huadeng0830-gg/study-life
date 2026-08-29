<script setup>
import { defineAsyncComponent, computed, KeepAlive, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import QuickLedgerPanel from './components/QuickLedgerPanel.vue'
import WallpaperLayer from './components/WallpaperLayer.vue'
import { migrateTaskCourseLinks, useStoredRef } from './composables/store'
import { isIOSDevice } from './composables/performanceMode.js'
import {
  RELEASE_HISTORY_KEY,
  RELEASE_SEEN_KEY,
  shouldShowReleaseNotes,
} from './composables/releaseNotes.js'
import { lastGlobalError, dismissGlobalError, reloadAfterError } from './composables/globalError.js'

const UpdateNotes = defineAsyncComponent(() => import('./components/UpdateNotes.vue'))

const route = useRoute()
const router = useRouter()
// 待办与课程数据可能较大，同步读取延后到首帧渲染之后完成（see onMounted），
// 让手机端先画出基本入口。标题与课程迁移也随数据就绪后一并建立。
let tasks = null
let courses = null
let stopTitleWatcher = null
const showReleaseNotes = ref(false)
const showQuickLedger = ref(false)
let releaseTimer = 0

// 按 1-8 快速切换页面（输入框聚焦时忽略）
const routeOrder = ['/', '/schedule', '/tasks', '/exams', '/lists', '/bills', '/food']

function onKeydown(event) {
  if (event.key === 'Escape' && showQuickLedger.value) {
    showQuickLedger.value = false
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const el = document.activeElement
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return
  if (document.body.style.overflow === 'hidden' || document.body.dataset.modalOpen === 'true') return
  const index = Number(event.key)
  if (index >= 1 && index <= routeOrder.length) {
    router.push(routeOrder[index - 1])
  }
}

function onReleaseSeenInAnotherTab(event) {
  if (event.key !== RELEASE_SEEN_KEY && event.key !== RELEASE_HISTORY_KEY) return
  if (!shouldShowReleaseNotes()) {
    window.clearTimeout(releaseTimer)
    showReleaseNotes.value = false
  }
}

onMounted(() => {
  // 首帧之后再进行较大数据的同步读取与页面标题维护，手机端先渲染基本入口。
  tasks = useStoredRef('sl_tasks', [])
  courses = useStoredRef('sl_courses', [])
  migrateTaskCourseLinks(tasks.value, courses.value)
  // 浏览器标签页标题实时显示未完成待办数量
  stopTitleWatcher = watchEffect(() => {
    const pending = tasks.value.filter((task) => !task.done).length
    document.title = pending > 0 ? `学习生活台 · ${pending} 项待办` : '学习生活台'
  })
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onReleaseSeenInAnotherTab)
  // 新版本更新说明：桌面与手机端都会弹出（每次版本只提示一次）。
  if (shouldShowReleaseNotes()) {
    releaseTimer = window.setTimeout(() => {
      // 延迟期间其他标签页可能已经点过“知道了”，显示前必须再次核对。
      if (shouldShowReleaseNotes()) showReleaseNotes.value = true
    }, 900)
  }
})
onBeforeUnmount(() => {
  stopTitleWatcher?.()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onReleaseSeenInAnotherTab)
  window.clearTimeout(releaseTimer)
})

// 按页面内容类型分配主区域宽度。
// 课程表（/schedule）不返回任何宽度类，保持既有渲染完全不变。
const WIDTH_BY_PATH = {
  '/': 'content-mid',
  '/tasks': 'content-narrow',
  '/exams': 'content-mid',
  '/lists': 'content-mid',
  '/bills': 'content-mid',
  '/food': 'content-wide',
}
const widthClass = computed(() => WIDTH_BY_PATH[route.path] ?? '')
const cachedPageNames = ['TodayView', 'ScheduleView', 'TasksView', 'ExamsView', 'ListsView', 'LedgerView', 'FoodView']
// 视觉降级与页面缓存分开处理。移动 Safari 保留“当前页 + 上一页”，
// 避免每次返回都重建复杂页面；桌面保留更多常用页面以提高来回切换速度。
const pageCacheSize = isIOSDevice() ? 2 : 4
</script>

<template>
  <WallpaperLayer />
  <div class="layout">
    <Sidebar
      :quick-ledger-open="showQuickLedger"
      @toggle-quick-ledger="showQuickLedger = !showQuickLedger"
    />
    <main class="content" :class="widthClass">
      <Transition name="quick-ledger">
        <QuickLedgerPanel v-if="showQuickLedger" @close="showQuickLedger = false" />
      </Transition>
      <router-view v-slot="{ Component, route: activeRoute }">
        <KeepAlive :include="cachedPageNames" :max="pageCacheSize">
          <component :is="Component" :key="activeRoute.name" />
        </KeepAlive>
      </router-view>
    </main>
  </div>
  <UpdateNotes v-if="showReleaseNotes" :open="showReleaseNotes" @close="showReleaseNotes = false" />

  <Transition name="global-error">
    <div v-if="lastGlobalError" class="global-error-toast" role="alert">
      <div class="global-error-copy">
        <b>页面遇到一个小问题</b>
        <span>本地数据没有丢失，可继续使用或重新加载。</span>
      </div>
      <button type="button" class="btn btn-ghost ge-btn" @click="reloadAfterError">重新加载</button>
      <button type="button" class="global-error-close" aria-label="忽略此提示" @click="dismissGlobalError">×</button>
    </div>
  </Transition>
</template>

<style scoped>
.layout {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 100vh;
}
@supports (min-height: 100dvh) {
  .layout {
    min-height: 100dvh;
  }
}
.content {
  flex: 1;
  min-width: 0;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 40px 48px;
}
.quick-ledger-enter-active,
.quick-ledger-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.quick-ledger-enter-from,
.quick-ledger-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 按页面类型分配宽度：Dashboard/账单/吃什么的宽版、清单与倒计时的中版、待办的紧凑版。
   课程表（/schedule）不命中以下任何类，保持既有渲染不变。 */
@media (min-width: 901px) {
  .content-wide {
    max-width: min(1520px, calc(100vw - 300px));
    padding: 32px clamp(28px, 3vw, 52px) 48px;
  }
  .content-mid {
    max-width: 1220px;
    padding: 30px 36px 46px;
  }
  .content-narrow {
    max-width: 1080px;
    padding: 30px 36px 44px;
  }
}

@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }

  .content {
    order: 1;
    padding: calc(20px + env(safe-area-inset-top)) 16px calc(86px + env(safe-area-inset-bottom));
  }
}

@media (max-width: 520px) {
  .content {
    padding: calc(18px + env(safe-area-inset-top)) 14px calc(84px + env(safe-area-inset-bottom));
  }
}

/* 全局错误提示：底部居中，数据安全提示优先于白屏无助 */
.global-error-toast {
  position: fixed;
  left: 50%;
  bottom: calc(18px + env(safe-area-inset-bottom));
  z-index: 300;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(560px, calc(100vw - 32px));
  padding: 12px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--card);
  box-shadow: var(--shadow-md);
}
@media (max-width: 900px) {
  .global-error-toast {
    bottom: calc(86px + env(safe-area-inset-bottom));
  }
}
.global-error-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.global-error-copy b {
  font-size: 13px;
}
.global-error-copy span {
  color: var(--ink-soft);
  font-size: 12px;
}
.global-error-toast .ge-btn {
  flex: 0 0 auto;
  padding: 7px 12px;
  font-size: 12.5px;
}
.global-error-close {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  color: var(--ink-faint);
  font-size: 16px;
  line-height: 1;
  border: none;
  border-radius: 8px;
  background: transparent;
}
.global-error-close:hover {
  color: var(--ink-soft);
  background: var(--bg-tint);
}
.global-error-enter-active,
.global-error-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.global-error-enter-from,
.global-error-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
