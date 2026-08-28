<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { autoWallpaperColor, THEMES, themeKey } from '../composables/theme.js'
import { needsBackup } from '../composables/backupReminder.js'
import { preloadCommonRoutes, preloadRoute } from '../router/routePreload.js'

// 工具弹窗严格按需加载。手机端不在后台预载二维码库，避免与页面切换争抢网络和主线程。
const loadDataManager = () => import('./DataManager.vue')
const loadAppearanceSettings = () => import('./AppearanceSettings.vue')
const DataManager = defineAsyncComponent(loadDataManager)
const AppearanceSettings = defineAsyncComponent(loadAppearanceSettings)

const navGroups = [
  {
    label: '学习与计划',
    items: [
      { path: '/', label: '首页', icon: '🏠' },
      { path: '/schedule', label: '课程表', icon: '📅' },
      { path: '/tasks', label: '作业与待办', icon: '✅' },
      { path: '/exams', label: '倒计时', icon: '⏳' },
    ],
  },
  {
    label: '生活管理',
    items: [
      { path: '/lists', label: '我的清单', icon: '☑️' },
      { path: '/bills', label: '账本', icon: '📒' },
      { path: '/food', label: '今天吃什么', icon: '🍽️' },
    ],
  },
]
const collapsed = ref(false)
const showDataManager = ref(false)
const showAppearance = ref(false)
const checkingUpdate = ref(false)
const updateNotice = ref('')
const props = defineProps({ quickLedgerOpen: Boolean })
const emit = defineEmits(['toggle-quick-ledger'])
let noticeTimer = 0
let warmupTimer = 0

function warmTool(name) {
  if (name === 'data') void loadDataManager()
  if (name === 'appearance') void loadAppearanceSettings()
}

function warmRoute(path) {
  void preloadRoute(path)
}

onMounted(() => {
  // 桌面端在首屏空闲后预热最常点的入口；移动端仍保持按需下载，避免占用流量。
  if (!window.matchMedia('(min-width: 901px)').matches) return
  warmupTimer = window.setTimeout(() => {
    const warm = () => {
      warmTool('appearance')
      warmTool('data')
      preloadCommonRoutes()
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 1800 })
    else warm()
  }, 1800)
})

onBeforeUnmount(() => window.clearTimeout(warmupTimer))

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
          @pointerenter="warmRoute(item.path)"
          @pointerdown="warmRoute(item.path)"
          @focus="warmRoute(item.path)"
        >
          <span class="icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </section>
    </nav>

    <button
      type="button"
      class="collapse-btn"
      :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
      :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
      @click="collapsed = !collapsed"
    >
      {{ collapsed ? '»' : '«' }}
    </button>

    <div class="sidebar-foot">
      <span class="tools-title">设置与工具</span>
      <div class="sidebar-action-row">
        <button type="button" class="nav-item data-item appearance-item" @pointerenter="warmTool('appearance')" @focus="warmTool('appearance')" @click="showAppearance = true">
          <span class="icon">🎨</span>
          <span class="nav-label">个性化</span>
        </button>
        <button
          type="button"
          class="quick-add-button"
          :class="{ active: props.quickLedgerOpen }"
          :aria-expanded="props.quickLedgerOpen"
          aria-label="记账"
          title="记账"
          @click="emit('toggle-quick-ledger')"
        >
          <span class="quick-add-symbol" aria-hidden="true">＋</span>
          <span class="quick-add-label">记账</span>
        </button>
      </div>
      <button type="button" class="nav-item data-item" @pointerenter="warmTool('data')" @focus="warmTool('data')" @click="showDataManager = true">
        <span class="icon">💾<i v-if="needsBackup" class="backup-dot"></i></span>
        <span class="nav-label">数据管理</span>
      </button>
      <button type="button" class="nav-item data-item" :disabled="checkingUpdate" @click="checkUpdate">
        <span class="icon" aria-hidden="true">↻</span>
        <span class="nav-label">{{ checkingUpdate ? '检查中…' : '检查更新' }}</span>
      </button>

      <div class="theme-row" role="group" aria-label="主题色切换">
        <span class="theme-label nav-label">主题色</span>
        <div class="theme-dots">
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
      </div>

      <div class="footer">
        本地存储 · 可随时备份
        <span class="kbd-hint">按 1-7 快速切换页面</span>
      </div>
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  color: var(--ink-soft);
  text-decoration: none;
  font-size: 14.5px;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.data-item {
  width: 100%;
  border: none;
  background: transparent;
}
.nav-item:hover {
  background: var(--bg);
  color: var(--text);
}
.nav-item.active {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 650;
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
.sidebar.collapsed .tools-title {
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
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--ink-faint);
  text-align: center;
}
.kbd-hint {
  display: block;
  margin-top: 3px;
  font-size: 10px;
}
.sidebar.collapsed .footer {
  visibility: hidden;
}

/* ---------- 底部工具区：设置类操作 + 主题色 同属一个分组 ---------- */
.sidebar-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.sidebar-action-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.sidebar-action-row .appearance-item {
  flex: 1;
}
.quick-add-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 64px;
  width: 64px;
  min-height: 40px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}
.quick-add-button:hover,
.quick-add-button.active {
  background: var(--primary);
  color: #fff;
}
.quick-add-symbol {
  font-size: 21px;
  transition: transform 0.15s ease;
}
.quick-add-label {
  font-size: 11px;
  font-weight: 650;
}
.quick-add-button.active .quick-add-symbol {
  transform: rotate(45deg);
}
.sidebar.collapsed .sidebar-action-row {
  flex-direction: column;
  align-items: center;
}
.theme-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding: 0 10px;
}
.theme-label {
  color: #98a1b2;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.theme-dots {
  display: flex;
  gap: 7px;
}
.theme-dot {
  width: 18px;
  height: 18px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--border);
  transition: transform 0.15s, box-shadow 0.15s;
}
.theme-dot:hover {
  transform: scale(1.14);
}
.theme-dot.on {
  box-shadow: 0 0 0 2px var(--primary);
  transform: scale(1.1);
}
.sidebar.collapsed .theme-row {
  justify-content: center;
}
.sidebar.collapsed .theme-dots {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 7px;
  justify-items: center;
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
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    overflow: visible;
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

  .sidebar-foot {
    display: flex;
    flex-direction: row;
    gap: 6px;
    margin: 6px 0 0;
    padding: 6px 0 0;
    border-top: 1px solid var(--border);
  }

  .sidebar-action-row {
    flex: 2;
    min-width: 0;
  }

  .sidebar-action-row .appearance-item {
    min-width: 0;
  }

  .quick-add-button {
    flex: 1;
    width: auto;
    min-height: 46px;
    flex-direction: column;
    gap: 2px;
  }

  .nav-item {
    justify-content: center;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-width: 0;
    min-height: 52px;
    padding: 6px 2px;
    font-size: clamp(10px, 2.65vw, 12px);
    line-height: 1.15;
    white-space: normal;
    text-align: center;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .sidebar.collapsed .nav-label,
  .nav-label {
    display: inline;
    min-width: 0;
    overflow-wrap: anywhere;
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

/* 320px 级别的极窄屏优先保证点按区域和文字可读，保持同样宽度并允许横向滑动。 */
@media (max-width: 360px) {
  .nav {
    display: flex;
    gap: 4px;
    overflow-x: auto;
  }

  .nav-item {
    flex: 0 0 62px;
  }
}
</style>
