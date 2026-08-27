<script setup>
import { defineAsyncComponent, ref } from 'vue'
import { autoWallpaperColor, THEMES, themeKey } from '../composables/theme.js'
import { needsBackup } from '../composables/backupReminder.js'

// 工具弹窗严格按需加载。手机端不在后台预载二维码库，避免与页面切换争抢网络和主线程。
const DataManager = defineAsyncComponent(() => import('./DataManager.vue'))
const AppearanceSettings = defineAsyncComponent(() => import('./AppearanceSettings.vue'))

const navGroups = [
  {
    label: '学习与计划',
    items: [
      { path: '/', label: '今日总览', icon: '🏠' },
      { path: '/schedule', label: '课程表', icon: '📅' },
      { path: '/tasks', label: '作业与待办', icon: '✅' },
      { path: '/exams', label: '倒计时', icon: '⏳' },
    ],
  },
  {
    label: '生活管理',
    items: [
      { path: '/lists', label: '我的清单', icon: '☑️' },
      { path: '/bills', label: '固定账单', icon: '💳' },
      { path: '/food', label: '今天吃什么', icon: '🍽️' },
    ],
  },
]
const collapsed = ref(false)
const showDataManager = ref(false)
const showAppearance = ref(false)
const checkingUpdate = ref(false)
const updateNotice = ref('')
let noticeTimer = 0

async function checkUpdate() {
  if (checkingUpdate.value) return
  checkingUpdate.value = true
  updateNotice.value = '正在检查新版本…'
  try {
    const updater = await import('../composables/appUpdate.js')
    await updater.checkForAppUpdate(true)
    updateNotice.value = updater.updateMessage.value || '检查完成'
  } catch {
    updateNotice.value = '检查失败，请确认网络后重试'
  } finally {
    checkingUpdate.value = false
    window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(() => { updateNotice.value = '' }, 3500)
  }
}

function chooseTheme(key) {
  autoWallpaperColor.value = false
  themeKey.value = key
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="brand">
      <span class="brand-mark">UP</span>
      <span class="brand-copy">
        <strong>控制台</strong>
        <small>STUDY &amp; LIFE</small>
      </span>
    </div>

    <nav class="nav" aria-label="主要导航">
      <section v-for="group in navGroups" :key="group.label" class="nav-group">
        <span class="nav-group-title">{{ group.label }}</span>
        <router-link
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          active-class="active"
        >
          <span class="icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </section>
    </nav>

    <div class="sidebar-tools">
      <span class="tools-title">工具</span>
      <button type="button" class="nav-item data-item" @click="showAppearance = true">
        <span class="icon">🎨</span>
        <span class="nav-label">个性化</span>
      </button>
      <button type="button" class="nav-item data-item" @click="showDataManager = true">
        <span class="icon">💾<i v-if="needsBackup" class="backup-dot"></i></span>
        <span class="nav-label">数据管理</span>
      </button>
      <button type="button" class="nav-item data-item" :disabled="checkingUpdate" @click="checkUpdate">
        <span class="icon" aria-hidden="true">↻</span>
        <span class="nav-label">{{ checkingUpdate ? '检查中…' : '更新' }}</span>
      </button>
    </div>

    <div class="theme-row" role="group" aria-label="主题色切换">
      <button
        v-for="(theme, key) in THEMES"
        :key="key"
        type="button"
        class="theme-dot"
        :class="{ on: themeKey === key }"
        :style="{ background: theme.primary }"
        :title="`${theme.name}主题`"
        :aria-label="`${theme.name}主题`"
        @click="chooseTheme(key)"
      ></button>
    </div>

    <button
      type="button"
      class="collapse-btn"
      :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
      :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
      @click="collapsed = !collapsed"
    >
      {{ collapsed ? '»' : '«' }}
    </button>

    <div class="footer">
      本地存储 · 可随时备份
      <span class="kbd-hint">按 1-7 快速切换页面</span>
    </div>

  </aside>

  <div v-if="updateNotice" class="update-toast" role="status" aria-live="polite">{{ updateNotice }}</div>

  <DataManager v-if="showDataManager" :open="showDataManager" @close="showDataManager = false" />
  <AppearanceSettings v-if="showAppearance" :open="showAppearance" @close="showAppearance = false" />
</template>

<style scoped>
.sidebar {
  width: 220px;
  flex: 0 0 220px;
  background: var(--card);
  border-right: 1px solid var(--border);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  z-index: 20;
  transition: width 0.2s ease, flex-basis 0.2s ease;
}
.sidebar.collapsed {
  width: 72px;
  flex-basis: 72px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 3px 7px 24px;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  color: #fff;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  border-radius: 12px 4px 12px 4px;
  background: linear-gradient(145deg, var(--brand-grad-a), var(--brand-grad-b));
  box-shadow: 0 8px 18px rgba(69, 111, 232, 0.22);
}
.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-copy strong {
  font-size: 17px;
  letter-spacing: 0.02em;
}
.brand-copy small {
  margin-top: 1px;
  color: var(--muted);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.16em;
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.nav-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.nav-group-title,
.tools-title {
  padding: 0 12px 3px;
  color: #98a1b2;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: 10px;
  color: var(--text);
  text-decoration: none;
  font-size: 15px;
  transition: background 0.15s;
  white-space: nowrap;
}
.data-item {
  width: 100%;
  border: none;
  background: transparent;
}
.sidebar-tools {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: auto;
  padding-top: 18px;
}
.nav-item:hover {
  background: var(--bg);
}
.nav-item.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}
.icon {
  font-size: 17px;
  width: 20px;
  text-align: center;
  position: relative;
}
.backup-dot {
  position: absolute;
  top: -2px;
  right: -6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  border: 1.5px solid var(--card);
}
.collapse-btn {
  margin-top: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: 8px;
  padding: 6px;
  color: var(--muted);
}
.sidebar.collapsed .brand-copy,
.sidebar.collapsed .nav-label,
.sidebar.collapsed .nav-group-title,
.sidebar.collapsed .tools-title,
.sidebar.collapsed .footer {
  display: none;
}
.sidebar.collapsed .brand,
.sidebar.collapsed .nav-item {
  justify-content: center;
}
.sidebar.collapsed .nav-item {
  padding-inline: 8px;
}
.footer {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}
.kbd-hint {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.75;
}

.update-toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 100;
  max-width: min(320px, calc(100vw - 28px));
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  color: var(--text);
  font-size: 12px;
  box-shadow: var(--shadow-md);
}

.theme-row {
  display: flex;
  gap: 9px;
  padding: 14px 12px 0;
}
.theme-dot {
  width: 22px;
  height: 22px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--border);
  transition: transform 0.15s, box-shadow 0.15s;
}
.theme-dot:hover {
  transform: scale(1.12);
}
.theme-dot.on {
  box-shadow: 0 0 0 2px var(--primary);
  transform: scale(1.08);
}
.sidebar.collapsed .theme-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 7px;
  justify-items: center;
  padding: 14px 0 0;
}

@media (max-width: 900px) {
  .sidebar,
  .sidebar.collapsed {
    position: sticky;
    top: auto;
    bottom: 0;
    order: 2;
    flex: none;
    width: 100%;
    height: auto;
    padding: 8px max(12px, env(safe-area-inset-right))
      calc(8px + env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
    border-right: none;
    border-top: 1px solid var(--border);
    box-shadow: 0 -8px 24px rgba(35, 52, 93, 0.08);
  }

  .brand,
  .collapse-btn,
  .footer,
  .nav-group-title,
  .tools-title,
  .theme-row {
    display: none;
  }

  .sidebar,
  .sidebar.collapsed {
    display: block;
  }

  .nav {
    display: flex;
    flex-direction: row;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
  }

  .nav-group {
    display: contents;
  }

  .nav::-webkit-scrollbar {
    display: none;
  }

  .sidebar-tools {
    display: flex;
    flex-direction: row;
    gap: 6px;
    margin: 6px 0 0;
    padding: 6px 0 0;
    border-left: none;
    border-top: 1px solid var(--border);
  }

  .nav-item {
    justify-content: center;
    flex-direction: column;
    gap: 2px;
    min-height: 46px;
    padding: 6px 10px;
    font-size: 12px;
    flex: 0 0 auto;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .sidebar.collapsed .nav-label,
  .nav-label {
    display: inline;
  }

  .data-item {
    height: auto;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
  }

  .data-item .nav-label {
    font-size: 11px;
  }

  .update-toast {
    right: 14px;
    bottom: calc(112px + env(safe-area-inset-bottom));
  }
}
</style>
