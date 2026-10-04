<script setup>
import { defineAsyncComponent, computed, KeepAlive, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sidebar from './components/Sidebar.vue'
import FocusReturn from './components/FocusReturn.vue'
import TaskCenter from './components/TaskCenter.vue'
import WallpaperLayer from './components/WallpaperLayer.vue'
import { useStoredRef } from './composables/store'
import { isIOSDevice, reducedEffects } from './composables/performanceMode.js'
import { festiveFor, applyAtmosphere } from './composables/festive.js'
import { festiveConfig } from './composables/atmosphereStore.js'
import { appNow, appToday } from './composables/timeContext.js'
import { focusLocation } from './composables/focusNavigation.js'
import {
  RELEASE_HISTORY_KEY,
  RELEASE_SEEN_KEY,
  shouldShowReleaseNotes,
} from './composables/releaseNotes.js'
import {
  GLOBAL_ERROR_BODY,
  GLOBAL_ERROR_TITLE,
  lastGlobalError,
  dismissGlobalError,
  reloadAfterError,
} from './composables/globalError.js'
import { isTaskActionable } from './composables/domain/state.js'
import { connectSyncSpace } from './composables/cloudSync.js'
import { isSyncSpaceBound, syncSpaceSettings } from './composables/syncSpace.js'
import { autoSyncError, autoSyncState, startAutoSyncCoordinator, stopAutoSyncCoordinator } from './composables/autoSyncCoordinator.js'
import { localSafeMode } from './composables/localSafeMode.js'
import { persistenceState, dismissPersistenceNotice } from './composables/store/core.js'
import { needsBackup } from './composables/backupReminder.js'
import { attachFloatingSlot, createFloatingSlot, detachFloatingSlot, useFloatingOffset } from './composables/floatingStack.js'
import { announce, announceAlert, clearAnnouncement, liveAlert, liveMessage } from './composables/liveRegion.js'
import { openSearch, searchOpen } from './composables/globalSearch.js'

const UpdateNotes = defineAsyncComponent(() => import('./components/UpdateNotes.vue'))
const QuickRecordPanel = defineAsyncComponent(() => import('./components/QuickRecordPanel.vue'))

const route = useRoute()
const router = useRouter()
const sidebarRef = ref(null)
// 待办与课程数据可能较大，同步读取延后到首帧渲染之后完成（see onMounted），
// 让手机端先画出基本入口。标题与课程迁移也随数据就绪后一并建立。
let tasks = null
let courses = null
let stopTitleWatcher = null
let stopRouteAnnouncer = null
const showReleaseNotes = ref(false)
const showQuickRecord = ref(false)
const quickRecordToast = ref(null)
const showBackupNudge = ref(false)
let releaseTimer = 0
let quickRecordToastTimer = 0
let persistenceRecoveryTimer = 0
let backupNudgeTimer = 0

/* 底部浮层统一排队：快速记录成功提示与全局错误提示各自占一个坑位，
   与页面里的 <Toast> 共用 floatingStack，避免三套固定 bottom 叠在一起。 */
const quickToastSlot = createFloatingSlot()
const quickToastOffset = useFloatingOffset(quickToastSlot, 56)
const errorToastSlot = createFloatingSlot()
const errorToastOffset = useFloatingOffset(errorToastSlot, 56)

/* Toast 优先级队列：error > warning > success > info
   同一时刻只显示最高优先级的 1 条，其余入队等待 */
const PRIORITY_ORDER = { error: 4, warning: 3, success: 2, info: 1 }
const toastQueue = ref([])
let toastQueueTimer = 0

function enqueueToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  const priority = PRIORITY_ORDER[type] ?? 1
  const id = Date.now() + Math.random()
  toastQueue.value.push({ id, message, type, actionLabel, undoFn, viewFn, duration, priority })
  toastQueue.value.sort((a, b) => b.priority - a.priority)
  processToastQueue()
}

function processToastQueue() {
  if (!toastQueue.value.length) return
  const next = toastQueue.value[0]
  quickRecordToast.value = { message: next.message, type: next.type, actionLabel: next.actionLabel, undoFn: next.undoFn, viewFn: next.viewFn, duration: next.duration }
  window.clearTimeout(toastQueueTimer)
  toastQueueTimer = window.setTimeout(() => {
    toastQueue.value.shift()
    if (toastQueue.value.length) processToastQueue()
    else quickRecordToast.value = null
  }, next.duration)
}

// 保留原有 showToast 兼容性
function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  enqueueToast(message, { type, actionLabel, undoFn, viewFn, duration })
}

watch(() => Boolean(quickRecordToast.value), (open) => {
  if (open) attachFloatingSlot(quickToastSlot)
  else detachFloatingSlot(quickToastSlot)
})
// 快速记录成功提示也是「插入即带内容」的 toast，播报走常驻的礼貌通道。
// 监听**消息文本**而不是上面那个布尔值：连记两笔时 toast 一直是显示的，
// 布尔值不变、不会触发 watcher，第二笔的播报就丢了——而那同样是"记成功了"的确认。
watch(() => quickRecordToast.value?.message ?? '', (message) => {
  if (message) announce(`✓ ${message}`)
})
watch(() => Boolean(lastGlobalError.value), (open) => {
  if (open) attachFloatingSlot(errorToastSlot)
  else detachFloatingSlot(errorToastSlot)
})

watch(() => persistenceState.value.status, (status) => {
  if (status !== 'recovered') return
  window.clearTimeout(persistenceRecoveryTimer)
  persistenceRecoveryTimer = window.setTimeout(() => dismissPersistenceNotice(), 3500)
})

/* ---------- 外壳级提示：文案与播报同源 ---------- */
// 这五处提示原先各自带 role="alert"/role="status"，而且都是 v-if 插入的「新节点带内容」——
// 撞的正是 liveRegion.js 开头记的那条不可靠规律（VoiceOver 可能一个字都不播，见 §1.34）。
// 现在模板只负责画出来，发声统一交给外壳里**常驻**的播报区：错误走 assertive、提醒走 polite。
// 文案集中成常量/计算属性，模板与播报共用同一份，视觉与听觉不可能各说一套。
const SAFE_MODE_NOTICE = {
  title: '本机安全模式',
  body: '同步恢复完成前，自动同步、手动拉取和推送均已暂停；本机仍可读写和导出。',
}
const PERSISTENCE_ERROR_TITLE = '本机保存需要注意'
const PERSISTENCE_RECOVERED_TEXT = '✓ 本机保存已恢复'
const BACKUP_NUDGE_NOTICE = {
  title: '已有 7 天未备份',
  body: '清理浏览器数据或删除桌面应用可能清空本地记录，建议现在导出一份备份。',
}

/**
 * 自动同步状态提示的文案。
 *
 * 原先标题与正文各写一遍同样的嵌套三元表达式（改一处漏一处），现在集中成一份，
 * 且模板与播报共用——顺带把两个重复的三元链删掉了。
 */
const autoSyncNotice = computed(() => {
  const state = autoSyncState.value
  if (state === 'conflict') return { title: '⚠ 有修改需要确认', body: '请打开“数据管理”处理冲突。' }
  if (state === 'offline') {
    return {
      title: '☁ 当前离线',
      body: isSyncSpaceBound.value
        ? '本机修改已保存，联网后会继续同步。'
        : '当前离线，本机数据可正常读写，不影响使用。',
    }
  }
  if (state === 'recovery-required') return { title: '⚠ 自动同步已暂停', body: '请先恢复同步前数据。' }
  if (state === 'error') return { title: '☁ 云端暂时不可用', body: autoSyncError.value || '本机修改已保存，稍后会继续尝试。' }
  return null
})
// 监听**文本**而不是那个每次重算都是新对象的提示对象：否则同样的内容会被反复播报。
const autoSyncNoticeText = computed(() => {
  const notice = autoSyncNotice.value
  return notice ? `${notice.title}：${notice.body}` : ''
})

// 防重复播报：记录上次播报文本
let lastAnnouncedPolite = ''
let lastAnnouncedAssertive = ''

function announceOnce(text) {
  if (text && text !== lastAnnouncedPolite) {
    announce(text)
    lastAnnouncedPolite = text
  }
}
function announceAlertOnce(text) {
  if (text && text !== lastAnnouncedAssertive) {
    announceAlert(text)
    lastAnnouncedAssertive = text
  }
}

watch(() => Boolean(localSafeMode.value), (open) => {
  if (open) announceAlertOnce(`${SAFE_MODE_NOTICE.title}：${SAFE_MODE_NOTICE.body}`)
})
watch(() => persistenceState.value.status, (status) => {
  // 提示内容里的持久化报错信息是动态的，播报必须带上它，否则听觉信息少于视觉信息。
  if (status === 'error') announceAlertOnce(`${PERSISTENCE_ERROR_TITLE}：${persistenceState.value.message}`)
  else if (status === 'recovered') announceOnce(PERSISTENCE_RECOVERED_TEXT)
})
watch(autoSyncNoticeText, (text) => {
  if (text) announceOnce(text)
})
watch(() => Boolean(showBackupNudge.value), (open) => {
  if (open) announceOnce(`${BACKUP_NUDGE_NOTICE.title}：${BACKUP_NUDGE_NOTICE.body}`)
})

/* ---------- 氛围与情绪引擎（模块 A） ---------- */
const todayISO = appToday
const festiveToday = computed(() => festiveFor(todayISO.value, festiveConfig.value))
const atmosphereKey = computed(() => festiveToday.value?.key ?? 'none')
const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']
/* 个人周年的专属动画（第五十四轮）。氛围侧给"纪念日 / 使用周年"的装饰与情人节、
   儿童节是同一个（彩带），所以分叉只能靠 key，不能靠装饰名 —— 否则会把情人节
   一起改掉。颜色刻意选了一组彩带里没有的金色，动画时长也更短更密（庆典感），
   但**不新增动效令牌**：粒子时长本来就是内联的，光环走 --dur-reveal。 */
const ANNIVERSARY_KEYS = ['anniversary', 'anniversary-start']
const ANNIVERSARY_COLORS = ['#fbbf24', '#fcd34d', '#fde68a', '#eab308', '#f59e0b', '#f97316']
const ANNIVERSARY_DURATION = 4.2
const isAnniversary = computed(() => ANNIVERSARY_KEYS.includes(festiveToday.value?.key ?? ''))
// 每个粒子都是一个无限循环的 CSS 动画，并且各自提升为合成层。
// 18 个在桌面端没问题，但在窄屏手机上就是 18 个铺满全屏高度的图层，
// 光是 GPU 显存就上去了。这里按宽度收敛：小屏 8 个，中屏 12 个，宽屏 18 个。
const decorCount = typeof window === 'undefined'
  ? 18
  : (window.innerWidth < 640 ? 8 : window.innerWidth < 1024 ? 12 : 18)
const decorParticles = Array.from({ length: decorCount }, (_, id) => ({
  id,
  left: (id * 5.7 + 3) % 100,
  delay: (id % 9) * -1.1,
  dur: 6 + (id % 5),
  size: 6 + (id % 3) * 3,
}))

function decorStyle(particle) {
  const decor = festiveToday.value?.decor
  const accent = festiveToday.value?.accentColor
  let background = accent || 'var(--primary)'
  const lantern = decor === 'lantern'
  if (decor === 'snow') background = '#ffffff'
  else if (decor === 'confetti') background = CONFETTI_COLORS[particle.id % CONFETTI_COLORS.length]
  if (isAnniversary.value) background = ANNIVERSARY_COLORS[particle.id % ANNIVERSARY_COLORS.length]
  return {
    left: `${particle.left}%`,
    width: lantern ? `${14 + (particle.id % 3) * 3}px` : `${particle.size}px`,
    height: lantern ? `${18 + (particle.id % 3) * 3}px` : decor === 'snow' ? `${particle.size}px` : `${particle.size + 3}px`,
    background,
    animationDelay: `${particle.delay}s`,
    animationDuration: isAnniversary.value ? `${ANNIVERSARY_DURATION}s` : `${particle.dur}s`,
  }
}

// 天气/节日氛围若变化，及时写入根节点 CSS 变量；无氛围时清空。
watchEffect(() => {
  applyAtmosphere(festiveToday.value ? { accentColor: festiveToday.value.accentColor, decor: festiveToday.value.decor } : null)
})

/* ---------- 全局快速记录：仅通过明确入口打开，不遮挡页面正文 ---------- */
const quickRecordContext = computed(() => {
  if (route.path === '/bills') return { preferredType: 'expense' }
  if (route.path === '/tasks') return { preferredType: 'todo' }
  if (route.path === '/schedule') return { preferredType: 'event' }
  return {}
})
function openQuickRecord() { showQuickRecord.value = true }
function closeQuickRecord() { showQuickRecord.value = false }
function showQuickRecordToast(payload) {
  quickRecordToast.value = payload
  window.clearTimeout(quickRecordToastTimer)
  quickRecordToastTimer = window.setTimeout(() => { quickRecordToast.value = null }, 5000)
}
function onQuickRecordSaved(payload) {
  showQuickRecordToast(payload)
  closeQuickRecord()
}
function undoQuickRecord() {
  const undo = quickRecordToast.value?.undo
  quickRecordToast.value = null
  window.clearTimeout(quickRecordToastTimer)
  undo?.()
}
function viewQuickRecordEntity() {
  const entity = quickRecordToast.value
  if (!entity?.entityType || !entity.entityId) return
  const path = entity.entityType === 'transaction' || entity.entityType === 'bill' ? '/bills'
    : entity.entityType === 'task' ? '/tasks'
      : entity.entityType === 'event' ? '/'
        : entity.entityType === 'milestone' ? '/exams'
          : entity.entityType === 'note' ? '/notes' : '/'
  quickRecordToast.value = null
  window.clearTimeout(quickRecordToastTimer)
  const target = entity.entityType === 'bill'
    ? focusLocation(path, entity.entityId, { section: 'bill' })
    : focusLocation(path, entity.entityId)
  router.push(target)
}

async function exportCurrentData() {
  try {
    const { downloadEmergencyBackup } = await import('./composables/emergencyExport.js')
    downloadEmergencyBackup()
  } catch {}
}

function openDataManager() {
  sidebarRef.value?.openDataManager?.()
}

// 按 1-6 快速切换页面（输入框聚焦时忽略）
const routeOrder = ['/', '/schedule', '/tasks', '/exams', '/lists', '/bills']

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true
  // 排除搜索框、编辑器等
  if (el.closest('[role="search"], .search-input, [contenteditable="true"], .editor')) return true
  return false
}

function onKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openQuickRecord()
    return
  }
  // QuickRecordPanel/Modal 自己处理 Escape；这里不能绕过面板的保存中关闭保护。
  if (event.key === 'Escape' && showQuickRecord.value) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const el = document.activeElement
  if (isTypingTarget(el)) return
  if (document.body.style.overflow === 'hidden' || document.body.dataset.modalOpen === 'true') return
  // "/" 打开全局搜索（GitHub / YouTube 的老习惯：按一下就能直接打字）。
  // 位置很关键——必须在上面三道守卫**之后**：
  //   在输入框里打斜杠（第 4 道）、按 Ctrl+/ 之类（第 3 道）、
  //   以及已经有弹窗打开时（第 5 道）都不能被抢走。
  // preventDefault 是为了挡掉 Firefox 的"快速查找"。
  if (event.key === '/' && !searchOpen.value) {
    event.preventDefault()
    openSearch()
    return
  }
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
  // main.js 已完成 recovery gate 与业务 migration；mount 后只验证空间并启动生命周期。
  void (async () => {
    if (localSafeMode.value) return
    if (isSyncSpaceBound.value) await connectSyncSpace({ ...syncSpaceSettings.value, persist: false })
    startAutoSyncCoordinator()
  })()
  tasks = useStoredRef('sl_tasks', [])
  courses = useStoredRef('sl_courses', [])
  // 浏览器标签页标题实时显示未完成待办数量，并带上当前页面名。
  // 同时把页面名播报给读屏：单页应用切换路由时焦点不动，
  // 没有播报的话键盘/读屏用户察觉不到"已经换页了"。
  stopTitleWatcher = watchEffect(() => {
    const pending = tasks.value.filter((task) => isTaskActionable(task, appNow.value)).length
    const pageTitle = route.meta?.title || '学习生活台'
    document.title = pending > 0 ? `${pageTitle} · ${pending} 项待办` : pageTitle
  })
  stopRouteAnnouncer = watch(() => route.path, () => {
    // 只看 path，不看 fullPath：query 变化属于**页面内部状态**——
    // 账本分区（?tab=review）、深链高亮（?focus=…）都只改 query，页面并没有换。
    // 用 fullPath 的话，每切一次分区读屏就会再听到一遍"账本 已打开"。
    announce(`${route.meta?.title || '学习生活台'} 已打开`)
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
  // 备份提醒：距上次备份超过 7 天且 7 天内未提示过时，延迟后给出一次性可关闭提示。
  backupNudgeTimer = window.setTimeout(() => {
    const NUDGE_DAYS = 7
    const NUDGE_MS = NUDGE_DAYS * 86400000
    const lastRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('sl_backup_nudge_at') : null
    const last = lastRaw ? new Date(lastRaw).getTime() : 0
    if (Number.isFinite(last) && Date.now() - last < NUDGE_MS) return
    if (!needsBackup.value) return
    try { localStorage.setItem('sl_backup_nudge_at', new Date().toISOString()) } catch {}
    showBackupNudge.value = true
  }, 6000)
})
function dismissBackupNudge() {
  showBackupNudge.value = false
}
onBeforeUnmount(() => {
  stopAutoSyncCoordinator()
  stopTitleWatcher?.()
  stopRouteAnnouncer?.()
  clearAnnouncement()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onReleaseSeenInAnotherTab)
  window.clearTimeout(releaseTimer)
  window.clearTimeout(quickRecordToastTimer)
  window.clearTimeout(persistenceRecoveryTimer)
  window.clearTimeout(backupNudgeTimer)
})

// 按页面内容类型分配主区域宽度。
// 课程表（/schedule）不返回任何宽度类，保持既有渲染完全不变。
const WIDTH_BY_PATH = {
  '/': 'content-mid',
  '/tasks': 'content-narrow',
  '/exams': 'content-mid',
  '/events': 'content-mid',
  '/lists': 'content-mid',
  '/bills': 'content-mid',
}
const widthClass = computed(() => WIDTH_BY_PATH[route.path] ?? '')
const cachedPageNames = ['TodayView', 'ScheduleView', 'TasksView', 'ExamsView', 'EventsView', 'ListsView', 'LedgerView', 'NotesView']
// 视觉降级与页面缓存分开处理。移动 Safari 保留“当前页 + 上一页”，
// 避免每次返回都重建复杂页面；桌面保留更多常用页面以提高来回切换速度。
const pageCacheSize = isIOSDevice() ? 2 : 4
// 简单的 i18n 映射，便于未来扩展多语言
const i18n = {
  'skip.toContent': '跳到主内容',
  'skip.toMain': 'Skip to main content',
}
const currentLang = ref('zh-CN')

function t(key) {
  return i18n[key] || key
}
</script>

<template>
  <WallpaperLayer />
  <!-- 节日装饰：「流畅优先」/ 减少动效时整层不渲染。
       CSS 的降级规则只能把动画压成 0.01ms，18 个粒子节点仍然留在 DOM 里
       停在起始位置。这里直接从渲染层去掉，省掉节点与合成层。 -->
  <div v-if="festiveToday?.decor && !reducedEffects" class="atmo-layer" :data-decor="festiveToday.decor" :data-festive="festiveToday.key" aria-hidden="true">
    <span v-if="isAnniversary" class="atmo-halo" />
    <i v-for="particle in decorParticles" :key="particle.id" :style="decorStyle(particle)" />
  </div>
  <div class="layout" :data-atmosphere="atmosphereKey">
    <!-- 跳到主内容（WCAG 2.4.1 绕过区块）。侧边栏有十几个导航项，键盘用户每换一页
         都得先 Tab 穿过它们才能到正文；这是纯键盘用户最常用的第一颗「按键」。
         平时视觉隐藏（见 <style> 里的 .skip-to-content），按 Tab 第一个聚焦时才浮现，
         所以既不占布局，也不影响鼠标用户。 -->
    <a class="skip-to-content" href="#main-content" :data-i18n="t('skip.toContent')">{{ t('skip.toContent') }}</a>
    <Sidebar
      ref="sidebarRef"
      :quick-record-open="showQuickRecord"
      @open-quick-record="openQuickRecord"
    />
    <!-- tabindex="-1" 是为了让上面的 skip link 真的把焦点落到 main 上：
         只给 id 的话各浏览器行为不一致，有的只移动「顺序焦点起点」而不移动焦点。 -->
    <main id="main-content" class="content" :class="widthClass" tabindex="-1">
      <!-- 聚焦态（`?focus=` / `?section=`）下的返回入口。放在 router-view **之外**，
          因为它是外壳级的一条出口，不属于任何单个页面；只在聚焦时渲染，
          所以平时对布局与焦点序都没有影响。 -->
      <FocusReturn />
      <!-- router-view **必须在外层**：vue-router 4 明确不支持把 <router-view> 直接放进
           <transition>/<keep-alive>，那样写每次切路由都会在控制台打一条警告，
           而且过渡与 keep-alive 的包含关系也不按预期生效（作者以为有页面切换动画，其实没有）。
           官方写法是 router-view 用 v-slot 拿到组件，再在**内部**套 Transition / KeepAlive。 -->
      <router-view v-slot="{ Component, route: activeRoute }">
        <Transition name="page" mode="out-in">
          <KeepAlive :include="cachedPageNames" :max="pageCacheSize">
            <component :is="Component" :key="activeRoute.name" />
          </KeepAlive>
        </Transition>
      </router-view>
    </main>
  </div>
  <TaskCenter />
  <Transition name="global-sync">
    <!-- 外壳级提示（共五处）刻意都**不带** role="alert"/role="status"：
         它们随状态插入，是「新节点带内容」，读屏可能一个字都不播（见 §1.34）。
         发声由下方常驻播报区负责，文案与这里取自同一组常量。 -->
    <div v-if="localSafeMode" class="global-safe-mode-alert">
      <b>{{ SAFE_MODE_NOTICE.title }}</b>
      <span>{{ SAFE_MODE_NOTICE.body }}</span>
      <button type="button" class="text-button" @click="openDataManager">打开数据管理</button>
    </div>
  </Transition>
  <Transition name="global-sync">
    <div v-if="persistenceState.status === 'error'" class="global-persistence-alert">
      <b>{{ PERSISTENCE_ERROR_TITLE }}</b>
      <span>{{ persistenceState.message }}</span>
      <button type="button" class="btn btn-sm" @click="exportCurrentData">导出当前数据</button>
      <button type="button" class="global-error-close tap-target" aria-label="关闭本机保存提示" @click="dismissPersistenceNotice">×</button>
    </div>
  </Transition>
  <Transition name="global-sync">
    <div v-if="persistenceState.status === 'recovered'" class="global-persistence-alert recovered">{{ PERSISTENCE_RECOVERED_TEXT }}</div>
  </Transition>
  <Transition name="global-sync">
    <div v-if="autoSyncNotice" class="global-sync-alert">
      <b>{{ autoSyncNotice.title }}</b>
      <span>{{ autoSyncNotice.body }}</span>
    </div>
  </Transition>
  <Transition name="global-sync">
    <div v-if="showBackupNudge" class="global-persistence-alert">
      <b>{{ BACKUP_NUDGE_NOTICE.title }}</b>
      <span>{{ BACKUP_NUDGE_NOTICE.body }}</span>
      <button type="button" class="text-button" @click="openDataManager">去备份</button>
      <button type="button" class="global-error-close tap-target" aria-label="关闭备份提醒" @click="dismissBackupNudge">×</button>
    </div>
  </Transition>
  <UpdateNotes v-if="showReleaseNotes" :open="showReleaseNotes" @close="showReleaseNotes = false" />
  <QuickRecordPanel
    v-if="showQuickRecord"
    :open="showQuickRecord"
    :context="quickRecordContext"
    @saved="onQuickRecordSaved"
    @close="closeQuickRecord"
  />

  <Transition name="quick-record-toast">
    <!-- 同五处外壳级提示：不带行内实时区域，发声交给常驻的礼貌播报区（见 script 里那段 watcher）。 -->
    <div v-if="quickRecordToast" class="quick-record-toast" :style="{ '--stack-offset': `${quickToastOffset}px` }">
      <span>✓ {{ quickRecordToast.message }}</span>
      <button v-if="quickRecordToast.entityId" type="button" @click="viewQuickRecordEntity">查看</button>
      <button v-if="quickRecordToast.undo" type="button" @click="undoQuickRecord">撤销</button>
    </div>
  </Transition>

  <Transition name="global-error">
    <!-- 这里刻意**不再**用 role="alert"：toast 是 v-if 插入的「新节点带内容」，
         VoiceOver 一类读屏可能一个字都不播（见 liveRegion.js 开头那条规律）。
         出错是全应用最需要被听见的时刻，所以播报统一交给下面常驻的 assertive 播报区
         （globalError.js 里 report() 会调 announceAlert，文案取自同一组常量）。
         去掉 role="alert" 也顺带避免「播报区 + toast」把同一句话念两遍。 -->
    <div v-if="lastGlobalError" class="global-error-toast" :style="{ '--stack-offset': `${errorToastOffset}px` }">
      <div class="global-error-copy">
        <b>{{ GLOBAL_ERROR_TITLE }}</b>
        <span>{{ GLOBAL_ERROR_BODY }}</span>
      </div>
      <button type="button" class="btn btn-ghost ge-btn" @click="reloadAfterError">重新加载</button>
      <button type="button" class="global-error-close tap-target" aria-label="忽略此提示" @click="dismissGlobalError">×</button>
    </div>
  </Transition>

  <!-- 常驻读屏播报区：始终存在于 DOM 里，只改文本。
       各页面临时插入的 role="status" 对 VoiceOver 不可靠（有些实现不播报
       首次插入就带内容的 live region），路由切换也需要在这里播报。 -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ liveMessage }}</div>

  <!-- 常驻**紧急**播报区：同样始终在 DOM 里、只改文本，但用 assertive 立刻打断。
       全局错误提示原先只有一个 v-if 插入的 role="alert"，撞的正是上面那条不可靠规律；
       现在视觉 toast 与它的按钮照旧，播报走这条可靠通道（由 globalError.js 触发）。 -->
  <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ liveAlert }}</div>
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
.sidebar {
  background:var(--card);
  border-right:1px solid var(--border);
  z-index:20;
  width:220px;
  height:100vh;
  height: 100dvh;
  transition:width var(--dur-base) var(--ease-standard), flex-basis var(--dur-base) var(--ease-standard);
  flex-direction:column;
  flex:0 0 220px;
  padding:20px 14px;
  display:flex;
  position:sticky;
  top:0}
.sidebar.collapsed {
  flex-basis:72px;
  width:72px}
/* 第三十九轮：这里原先还有 25 条引用 **Sidebar.vue 内部节点** 类的规则（.brand / .brand-mark /
   .nav / .nav-item / .data-item / .icon / .backup-dot / .collapse-btn / .footer / .kbd-hint /
   .sidebar-foot / .sidebar-action-row / .quick-add-button / .quick-add-symbol / .theme-row /
   .theme-label / .theme-dots / .theme-dot，以及 .sidebar.collapsed .nav-item 与
   .sidebar.collapsed .theme-dots 这种「从子组件根节点往内部穿透」的写法）。
   它们是第三十七轮把入口分片的编译产物搬回宿主文件时带上的 App 作用域属性，而 Vue 的
   scoped CSS 只会把父作用域属性落在子组件的**根节点**上——「App 的作用域 + 只存在于
   Sidebar.vue 内部节点的类」永远匹配不到元素。判定与删除依据见
   tests/scopedChildReachability.test.js 与第三十九轮报告；删除前后用 @vue/compiler-sfc
   编译成 CSS 文本逐字 diff 过，差异只有这些选择器。
   这些样式在 components/Sidebar.vue 自己的 scoped 样式块里都有等价副本，需要改请改那边。 */
@media (max-width:900px) {
  .sidebar,.sidebar.collapsed {
  width:100%;
  height:auto;
  /* 安全区：index.html 用了 viewport-fit=cover，刘海与手势条会压到内容上，
     所以所有贴边横条都要把 env(safe-area-inset-*) 加进内边距或定位里（下面还有多处同样处理）。 */
  padding:6px max(10px, env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
  border-right:none;
  border-top:1px solid var(--border);
  position:fixed;
  top:auto;
  bottom:0;
  left:0;
  right:0;
  box-shadow:0 -8px 24px #23345d14}
/* 同一批残留：≤900px 这一段里引用 Sidebar.vue 内部类的 15 条（.mobile-nav / .mobile-nav-item /
   .mobile-more-item / .mobile-ledger-trigger / .more-trigger / .mobile-more-sheet /
   .mobile-more-head / .mobile-more-group / .mobile-more-grid 及其后代）已按同一判据删除。
   上面那条 .sidebar,.sidebar.collapsed 是**活**的：.sidebar 是 Sidebar.vue 的模板根节点，
   父作用域属性会落在它身上，移动端底栏的定位、安全区与 border 都由它生效。
   注意 .more-sheet-enter/leave-* 那两条**故意保留**：过渡类名不在任何模板里（由 Sidebar.vue 的
   Transition 组件按 name="more-sheet" 在运行时生成），模板根标签判不了生死，按「未判定一律
   保留」处理——它们在报告里列为"未判定"，不当作已确认的死规则。 */
.more-sheet-enter-active,.more-sheet-leave-active {
  transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard)}
.more-sheet-enter-from,.more-sheet-leave-to {
  opacity:0;
  transform:translateY(8px)}
}
@keyframes task-spin-4add0040 {
  0%,to {
  opacity:1;
  transform:scale(1)}
50% {
  opacity:.35;
  transform:scale(.78)}
}
@keyframes task-pill-in-4add0040 {
  0% {
  opacity:0;
  transform:translateY(10px)scale(.94)}
to {
  opacity:1;
  transform:none}
}
/* 层叠阶梯（改动前先看这里）：0 壁纸层 → 1 .layout → 20 .sidebar → 90 .task-pill →
   100–109 弹窗遮罩（Modal 内联按栈深度递增，上界停在 109，见 overlayStack.js）→
   110 底部操作面板 → 130 右键菜单 → 200 Toast → 240 同步告警 → 241 安全模式/持久化告警 →
   250 快速记录提示 → 300 全局错误提示 → 301 跳转主内容链接。
   跳转链接必须在**最上层**（301 > 300）：它平时视觉隐藏，只有按 Tab 聚焦时才浮现，
   被任何浮层盖住就等于失效——与全局错误提示同为 300 时，后渲染的错误条会盖住聚焦中的跳转条。
   右键菜单(130)刻意低于告警层(240+)：同步/安全模式/错误提示是系统级状态，应盖过临时菜单。 */
/* 浮层层叠档位（Modal 的**内联** z-index）：100 + min(栈深度, 9) → 100…109。
   `.overlay` 的 100 只是兜底值，真正生效的是 Modal 按**打开顺序**写上的内联值：
   Teleport 锚点在组件挂载时创建，"随页面常驻"的浮层（只有 :open）在 body 里永远排在
   "打开时才建锚点"的浮层之前，只靠 DOM 顺序会让读屏 / Escape 认定的最上层与眼睛看到的
   不是同一个。上界停在 109 是硬要求：.sheet-overlay、.context-menu 与同步告警层都在它
   上面，深度再大也不许越线。数值关系由 tests/modalStackOrder.test.js 从源码解析后断言，
   不要在注释里改数（也要注意：上面那段「层叠阶梯」注释里的数字会被 sidebarDrawer 的
   守卫解析，动它之前先看那个文件）。 */
.wallpaper-layer {
  z-index:0;
  pointer-events:none;
  background:var(--bg);
  contain:strict;
  position:fixed;
  top:0;
  bottom:0;
  left:0;
  right:0;
  overflow:hidden}
:root[data-performance=reduced] {
  filter:none;
  transform:none}
.layout {
  z-index:1;
  min-height:100vh;
  min-height: 100dvh;
  display:flex;
  position:relative}
/* vh 是给不支持 dvh 的浏览器的兜底，dvh 才跟随移动端地址栏的伸缩：只写 vh 时，
   地址栏展开会把底部内容切掉或多出一截。每条 vh 都要有对应的 dvh 孪生行，
   tests/mobileViewport.test.js 会逐条检查（缺一条就红）。 */
@supports (min-height:100dvh) {
  .layout {
  min-height:100dvh}
}
.skip-to-content {
  z-index:301;
  background:var(--primary);
  color:var(--on-primary);
  transition:transform var(--dur-fast) var(--ease-standard);
  border-radius:0 0 var(--radius-10);
  padding:10px 16px;
  font-size:var(--fs-13);
  font-weight:var(--fw-700);
  text-decoration:none;
  position:fixed;
  top:0;
  left:0;
  transform:translateY(-120%)}
.skip-to-content:focus {
  transform:translateY(0)}
.skip-to-content:focus-visible {
  transform:translateY(0)}
.content {
  flex:1;
  width:100%;
  min-width:0;
  max-width:1280px;
  margin:0 auto;
  /* 横向也要让开刘海/灵动岛：index.html 是 viewport-fit=cover，横屏时左右会顶边。
     max(…, env(safe-area-inset-*)) 在无安全区时退回原固定值，桌面不受影响。 */
  padding:32px max(40px, env(safe-area-inset-right, 0px)) 48px max(40px, env(safe-area-inset-left, 0px))}
.global-sync-alert {
  top:calc(12px + env(safe-area-inset-top));
  z-index:240;
  color:#765b2b;
  max-width:min(620px,100vw - 28px);
  box-shadow:var(--shadow-sm);
  background:#fffaf0;
  border:1px solid #f0d69c;
  border-radius:var(--radius-10);
  align-items:center;
  gap:8px;
  padding:9px 12px;
  font-size:var(--fs-11);
  display:flex;
  position:fixed;
  left:50%;
  transform:translate(-50%)}
.global-sync-alert span {
  color:#836a44}
.global-safe-mode-alert,.global-persistence-alert {
  top:calc(12px + env(safe-area-inset-top));
  z-index:241;
  color:#6b4d16;
  max-width:min(760px,100vw - 28px);
  box-shadow:var(--shadow-md);
  background:#fff9e8;
  border:1px solid #efd08b;
  border-radius:var(--radius-10);
  align-items:center;
  gap:8px;
  padding:10px 12px;
  font-size:var(--fs-12);
  display:flex;
  position:fixed;
  left:50%;
  transform:translate(-50%)}
.global-safe-mode-alert {
  color:#8a351d;
  background:#fff3ef;
  border-color:#efb8a4}
.global-safe-mode-alert span,.global-persistence-alert span {
  flex:1}
.global-safe-mode-alert .text-button {
  color:inherit;
  white-space:nowrap}
@media (max-width:760px) {
  .global-safe-mode-alert,.global-persistence-alert {
  flex-wrap:wrap;
  align-items:flex-start}
.global-safe-mode-alert span,.global-persistence-alert span {
  flex-basis:100%}
}
@media (min-width:901px) {

.content-mid {
  max-width:1220px;
  padding:30px max(36px, env(safe-area-inset-right, 0px)) 46px max(36px, env(safe-area-inset-left, 0px))}
.content-narrow {
  max-width:1080px;
  padding:30px max(36px, env(safe-area-inset-right, 0px)) 44px max(36px, env(safe-area-inset-left, 0px))}
}
@media (max-width:900px) {
  .layout {
  flex-direction:column}
.content {
  padding:calc(20px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right, 0px)) calc(86px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left, 0px));
  order:1}
}
@media (max-width:520px) {
  .content {
  /* 底部与 Toast/任务胶囊同一 86px 档（原先 84px 会让 86px 高的浮层压到最后一行内容）。 */
  padding:calc(18px + env(safe-area-inset-top)) max(14px, env(safe-area-inset-right, 0px)) calc(86px + env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left, 0px))}
}
.quick-record-toast {
  left:50%;
  bottom:calc(18px + env(safe-area-inset-bottom) + var(--stack-offset,0px));
  z-index:250;
  max-width:min(560px,100vw - 32px);
  color:var(--text);
  border:1px solid var(--border);
  background:var(--card);
  box-shadow:var(--shadow-md);
  pointer-events:none;
  border-radius:var(--radius-10);
  align-items:center;
  gap:12px;
  padding:9px 12px 9px 14px;
  font-size:var(--fs-13);
  display:flex;
  position:fixed;
  transform:translate(-50%)}
.quick-record-toast button {
  color:var(--primary);
  background:var(--primary-soft);
  pointer-events:auto;
  border:0;
  border-radius:var(--radius-6);
  padding:4px 8px;
  font-size:var(--fs-12);
  font-weight:var(--fw-800)}
.quick-record-toast-enter-active,.quick-record-toast-leave-active {
  transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard)}
.quick-record-toast-enter-from,.quick-record-toast-leave-to {
  opacity:0;
  transform:translate(-50%,8px)}
.global-sync-enter-active,.global-sync-leave-active {
  transition:opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard)}
.global-sync-enter-from,.global-sync-leave-to {
  opacity:0;
  transform:translate(-50%,-8px)}
@media (max-width:900px) {
  .quick-record-toast {
  bottom:calc(86px + env(safe-area-inset-bottom) + var(--stack-offset,0px))}
}
.global-error-toast {
  left:50%;
  bottom:calc(18px + env(safe-area-inset-bottom) + var(--stack-offset,0px));
  z-index:300;
  border:1px solid var(--border-strong);
  background:var(--card);
  max-width:min(560px,100vw - 32px);
  box-shadow:var(--shadow-md);
  border-radius:var(--radius-12);
  align-items:center;
  gap:12px;
  padding:12px 14px;
  display:flex;
  position:fixed;
  transform:translate(-50%)}
@media (max-width:900px) {
  .global-error-toast {
  bottom:calc(86px + env(safe-area-inset-bottom) + var(--stack-offset,0px))}
}
.global-error-copy {
  flex-direction:column;
  gap:2px;
  min-width:0;
  display:flex}
.global-error-copy b {
  font-size:var(--fs-13)}
.global-error-copy span {
  color:var(--ink-soft);
  font-size:var(--fs-12)}
.global-error-toast .ge-btn {
  flex:none;
  padding:7px 12px;
  font-size:var(--fs-12-5)}
.global-error-close {
  width:26px;
  height:26px;
  color:var(--ink-faint);
  background:0 0;
  border:none;
  border-radius:var(--radius-8);
  flex:none;
  font-size:var(--fs-16);
  line-height:1}
.global-error-close:hover {
  color:var(--ink-soft);
  background:var(--bg-tint)}
.global-error-enter-active,.global-error-leave-active {
  transition:opacity var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard)}
.global-error-enter-from,.global-error-leave-to {
  opacity:0;
  transform:translate(-50%,10px)}
.page-enter-active,.page-leave-active {
  transition:opacity var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard)}
.page-enter-from,.page-leave-to {
  opacity:0;
  transform:translateY(8px)}

</style>
