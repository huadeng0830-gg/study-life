<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import WallpaperLayer from './components/WallpaperLayer.vue'
import { useStoredRef } from './composables/store.js'
import {
  RELEASE_HISTORY_KEY,
  RELEASE_SEEN_KEY,
  shouldShowReleaseNotes,
} from './composables/releaseNotes.js'

const UpdateNotes = defineAsyncComponent(() => import('./components/UpdateNotes.vue'))

const router = useRouter()
const tasks = useStoredRef('sl_tasks', [])
const showReleaseNotes = ref(false)
let releaseTimer = 0

// 按 1-7 快速切换页面（输入框聚焦时忽略）
const routeOrder = ['/', '/schedule', '/tasks', '/exams', '/lists', '/bills', '/food']

function onKeydown(event) {
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
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onReleaseSeenInAnotherTab)
  if (shouldShowReleaseNotes()) {
    releaseTimer = window.setTimeout(() => {
      // 延迟期间其他标签页可能已经点过“知道了”，显示前必须再次核对。
      if (shouldShowReleaseNotes()) showReleaseNotes.value = true
    }, 900)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onReleaseSeenInAnotherTab)
  window.clearTimeout(releaseTimer)
})

// 浏览器标签页标题实时显示未完成待办数量
watchEffect(() => {
  const pending = tasks.value.filter((task) => !task.done).length
  document.title = pending > 0 ? `学习生活台 · ${pending} 项待办` : '学习生活台'
})
</script>

<template>
  <WallpaperLayer />
  <div class="layout">
    <Sidebar />
    <main class="content">
      <router-view />
    </main>
  </div>
  <UpdateNotes v-if="showReleaseNotes" :open="showReleaseNotes" @close="showReleaseNotes = false" />
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

@media (max-width: 900px) {
  .layout {
    flex-direction: column;
  }

  .content {
    order: 1;
    padding: calc(24px + env(safe-area-inset-top)) 20px 8px;
  }
}

@media (max-width: 520px) {
  .content {
    padding: calc(20px + env(safe-area-inset-top)) 14px 4px;
  }
}
</style>
