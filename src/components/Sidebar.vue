<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { autoWallpaperColor, THEMES, themeKey } from '../composables/theme.js'
import { originFromEvent, revealChange } from '../composables/motion.js'
import { needsBackup } from '../composables/backupReminder.js'
import { preloadCommonRoutes, preloadRoute } from '../router/routePreload.js'
import { desktopNavigationGroups } from '../router/navigation.js'
import { closeSearch, openSearch, searchOpen } from '../composables/globalSearch.js'
import {
  createScrollLock,
  initialFocusTarget,
  isTopOverlay,
  pushOverlay,
  removeOverlay,
  trapTabKey,
} from '../composables/overlayStack.js'
import {
  DRAWER_EDGE_GUARD,
  DRAWER_EXIT_SHIFT,
  drawerDragOffset,
  drawerVelocity,
  drawerWidth,
  isDrawerEdgeGuard,
  isDrawerGesturePointer,
  pushDrawerSample,
  resolveDrawerAxis,
  resolveDrawerRelease,
} from '../composables/drawerDrag.js'
import Toast from './Toast.vue'

// 工具弹窗严格按需加载，避免页面切换时争抢网络和主线程。
const loadAccountPanel = () => import('./AccountPanel.vue')
const loadDataManager = () => import('./DataManager.vue')
const loadVersionUpdate = () => import('./VersionUpdateModal.vue')
const loadAppearanceSettings = () => import('./AppearanceSettings.vue')
const loadQuickRecordSettings = () => import('./QuickRecordSettings.vue')
const loadFocusSettings = () => import('./FocusSettings.vue')
const loadFestiveSettings = () => import('./FestiveSettings.vue')
const loadSearchPanel = () => import('./SearchPanel.vue')
const AccountPanel = defineAsyncComponent(loadAccountPanel)
const toolLoaders = Object.freeze({ account: loadAccountPanel, data: loadDataManager, update: loadVersionUpdate,
  appearance: loadAppearanceSettings, focus: loadFocusSettings, festive: loadFestiveSettings, search: loadSearchPanel })
const accountLabel = '我的账号'
const DataManager = defineAsyncComponent(loadDataManager)
const VersionUpdateModal = defineAsyncComponent(loadVersionUpdate)
const AppearanceSettings = defineAsyncComponent(loadAppearanceSettings)
const QuickRecordSettings = defineAsyncComponent(loadQuickRecordSettings)
const FocusSettings = defineAsyncComponent(loadFocusSettings)
// 【节日与纪念日设置此前完全没有入口】
// FestiveSettings.vue 从加进仓库起，全 `src/` 只有测试直接 import 它，Sidebar 从未挂载 ——
// 于是「开关节日氛围 / 填生日 / 填开始使用日期 / 管理纪念日与农历纪念日」这一整块
// 设置项，用户在任何界面都点不到（`sl_festive_config` 只能被备份/导入间接修改）。
// 这里按既有工具面板的同一套接线补上入口：懒加载 + 预热 + 桌面按钮 + 手机「更多」格。
const FestiveSettings = defineAsyncComponent(loadFestiveSettings)
const SearchPanel = defineAsyncComponent(loadSearchPanel)

const navGroups = desktopNavigationGroups
const mobileLeadingItems = [
  { path: '/', label: '首页', icon: '☀️' },
]
const mobileScheduleItems = [
  { path: '/schedule', label: '课程', icon: '📅' },
]
const mobileTrailingItems = [
  { path: '/bills', label: '账本', icon: '📒' },
]
const mobileMoreGroups = [
  { label: '常用', items: [{ path: '/projects', label: '齐行', icon: '🧩' }, { path: '/together', label: '一起约', icon: '👥' }], tools: [{ key: 'account', label: '我的账号', icon: '👤' }, { key: 'update', label: '版本与更新', icon: '↻' }] },
  { label: '工具与回顾', items: [
    { path: '/exams', label: '重要日期', icon: '⏳' },
    { path: '/events', label: '日程', icon: '🗓️' },
    { path: '/review', label: '本周回顾', icon: '↺' },
    { path: '/tasks', label: '待办', icon: '✅' },
    { path: '/notes', label: '笔记', icon: '📝' },
    { path: '/lists', label: '清单', icon: '☑️', subdued: true },
  ], tools: [{ key: 'search', label: '搜索', icon: '🔍' }] },
  { label: '个性化与专注', items: [], tools: [
    { key: 'appearance', label: '个性化', icon: '🎨' },
    { key: 'festive', label: '氛围与纪念日', icon: '🎉' },
    { key: 'focus', label: '专注设置', icon: '⏱' },
    { key: 'quick-record', label: '快速记录设置', icon: '⚡' },
  ] },
  { label: '账号、数据与系统', items: [], tools: [
    { key: 'data', label: '数据管理', icon: '💾' },
  ] },
]
const collapsed = ref(false)
const showMobileMore = ref(false)
const moreTriggerEl = ref(null)
const moreSheetEl = ref(null)
const showDataManager = ref(false)
const showVersionUpdate = ref(false)
const showAppearance = ref(false)
const showQuickRecordSettings = ref(false)
const showFocusSettings = ref(false)
const showFestiveSettings = ref(false)
// 搜索面板的开合是**模块级共享状态**：快捷键在 App 的全局 keydown 里
// （App 够不到本组件的局部 ref），而面板与懒加载预热在这里。
// 这里保留 showSearch 这个别名，模板里照旧读它。
const showSearch = searchOpen
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
const props = defineProps({ quickRecordOpen: Boolean })
const emit = defineEmits(['open-quick-record'])
const noticeTimer = 0
let warmupTimer = 0

function openDataManager() {
  showDataManager.value = true
}

defineExpose({ openDataManager })

function warmTool(name) {
  void toolLoaders[name]?.().catch(() => {}) // 预热失败或页面先卸载都不应产生未处理拒绝。
}

function warmRoute(path) {
  void preloadRoute(path)
}

onMounted(() => {
  // 桌面端在首屏空闲后预热最常点的入口；移动端仍保持按需下载，避免占用流量。
  if (window.matchMedia('(min-width: 901px)').matches) {
    warmupTimer = window.setTimeout(() => {
      const warm = () => {
        warmTool('appearance')
        warmTool('data')
        preloadCommonRoutes()
      }
      if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 1800 })
      else warm()
    }, 1800)
    return
  }

  // 移动端不做全量后台预热；只在 pointerdown 时预热用户即将进入的页面，
  // 避免 Safari 在首次操作窗口连续解析所有路由。
})

onBeforeUnmount(() => {
  window.clearTimeout(warmupTimer)
  window.clearTimeout(drawerSettleTimer)
  // 侧边栏整个卸载时抽屉可能还开着：不清就会把滚动锁和遮罩栈一起留在 body 上。
  cleanupMobileMore()
})

/**
 * 「更多功能」是 ≤900px 下的**右侧抽屉**（真模态浮层），不是一个飘在底栏上的小浮层。
 * 右锚的理由见样式块：右划关闭的跟手方向必须与出场方向一致，而底栏最右一格就是它的触发器。
 *
 * 【它为什么必须像 Modal 一样接 overlayStack】抽屉打开期间又弹出个性化/数据管理弹窗时：
 *  - Escape 只能关掉**最上面那一层**（`isTopOverlay`），否则一次按键把两层一起收掉；
 *  - 滚动锁必须是**引用计数**的（`createScrollLock` 写 body.dataset.modalLockCount），
 *    这样后开的弹窗关掉后页面仍然锁着，抽屉关掉才解锁。
 *    这也是**唯一**允许写 `body.style.overflow` 的地方：App 的全局快捷键拿
 *    `body.style.overflow === 'hidden' || body.dataset.modalOpen === 'true'` 当"浮层打开中"的判据，
 *    手写 overflow 会绕过计数，和嵌套弹窗的还原顺序打架。
 *
 * 【Escape】必须在**剥掉注释的代码里**和 `'Escape'` 做比较（tests/overlayEscape.test.js 的签名），
 * 只写注释不算。onMoreSheetKeydown 开头那行判断同时挡住两种情况：抽屉没开、或上面压着别的浮层。
 *
 * 【焦点】三条细节：
 *  - 打开时把焦点送进抽屉（`initialFocusTarget`），否则键盘用户 Tab 的第一站还在背后的底栏；
 *  - Tab 在抽屉内循环（`trapTabKey`），模态期间不允许穿到背后的页面上去；
 *  - 关闭时**只在焦点原本就在抽屉里**才还给触发按钮（见 closeMobileMore），
 *    否则会把用户在别处的焦点抢走——这条精度由 tests/sidebarMoreSheetEscape.test.js 守着。
 */
// `modalEl` 这个字段名不是笔误：Modal.vue 的 cleanup() 在关闭时会对栈里的**下一层**
// 调用 `next.modalEl.value` 并 `focusInitialTarget` 它。抽屉按同一契约暴露这个字段，
// 于是"弹窗压在抽屉上、弹窗关掉后焦点回到抽屉"这条既有逻辑不用改 Modal 就能生效。
const drawerEntry = { modalEl: moreSheetEl, active: false, onBack: () => closeMobileMore() }
const drawerScrollLock = createScrollLock()
// 手势状态全是普通局部变量：它不参与渲染（位移写内联 style），进 ref 只会白白触发重渲染。
let drawerPointerId = null
let drawerStartX = 0
let drawerStartY = 0
let drawerAxis = 'pending'
let drawerSamples = []
let drawerSettleTimer = 0

function onMoreSheetKeydown(event) {
  if (!showMobileMore.value || !isTopOverlay(drawerEntry)) return
  if (event.key !== 'Escape') {
    // 模态抽屉里 Tab 不能跑到背后的底栏与页面上去。
    if (event.key === 'Tab') trapTabKey(event, moreSheetEl.value)
    return
  }
  event.preventDefault()
  closeMobileMore()
}

onMounted(() => document.addEventListener('keydown', onMoreSheetKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onMoreSheetKeydown))

/* ---------- 抽屉的开合：遮罩、滚动锁、初始焦点 ---------- */

function activateMobileMore() {
  if (drawerEntry.active) return
  drawerEntry.active = true
  pushOverlay(drawerEntry)
  drawerScrollLock.lock()
}

function cleanupMobileMore() {
  if (!drawerEntry.active) return
  drawerEntry.active = false
  // 注意这里**不清**抽屉上的内联 transform：右划关闭靠它把最后的位移接给离场过渡，
  // 清掉会让面板先跳回原位再滑走。
  resetDrawerGestureState()
  removeOverlay(drawerEntry)
  drawerScrollLock.unlock()
}

watch(showMobileMore, (open) => {
  if (open) activateMobileMore()
  else cleanupMobileMore()
})

/**
 * 初始焦点用 **post flush** 单独挂一个 watcher，不是洁癖，是踩过的坑：
 *  - post 阶段 DOM 已经渲染完，`moreSheetEl` 才拿得到（pre 阶段元素还不存在）；
 *  - 更关键的是「打开又立刻关闭」的情况（打开后马上按 Escape）：
 *    早先写成 `activate()` 里 `nextTick(focus)` 的版本，那个延迟回调会在抽屉**已经被要求关闭之后**
 *    才跑，把焦点塞进一个正在离场、马上要被移除的面板里——面板一移除，焦点就掉到 `body` 上，
 *    tests/sidebarMoreSheetEscape.test.js 的"焦点还给触发按钮"当场变红。
 *    换成 watcher 后，同一个 tick 里翻成 false 时回调拿到的最终值就是 false，根本不会聚焦。
 */
watch(showMobileMore, (open) => {
  if (!open || !drawerEntry.active || !isTopOverlay(drawerEntry)) return
  initialFocusTarget(moreSheetEl.value)?.focus?.({ preventScroll: true })
}, { flush: 'post' })

/**
 * 关闭抽屉。
 *
 * @param {boolean} forceFocusTrigger 是否**无条件**把焦点还给触发按钮。
 *   「×」「点遮罩」「右划」三条主动关闭路径都传 true：用户刚刚就是在操作这个抽屉，
 *   焦点回到唤起它的按钮是标准做法。点抽屉里的导航项去换页时不传——
 *   那时焦点该跟着页面走，硬拉回触发按钮等于把用户拽回原处。
 * 不传时仍然保留原行为：焦点本来就在抽屉里才拉回来，避免抢走别处的焦点。
 */
function closeMobileMore(forceFocusTrigger = false) {
  if (!showMobileMore.value) return
  const focusWasInside = !!moreSheetEl.value?.contains(document.activeElement)
  showMobileMore.value = false
  if (focusWasInside || forceFocusTrigger) moreTriggerEl.value?.focus()
}

/* ---------- 右划关闭：跟手位移 + 松手吸附 ---------- */

function drawerPixelWidth() {
  // 宽度取自 CSS 同源常量（min(86vw, 320px)），**不量 rect**：happy-dom 里 rect 恒为 0。
  return drawerWidth(window.innerWidth)
}

// 不能用 `event.timeStamp || Date.now()`：0 是合法时间戳，会被 || 误判成缺失，
// 导致首尾样本时间差为负、速度恒为 0，甩动判定失效（Modal.vue 里同样的写法）。
function eventTime(event) {
  const stamp = Number(event?.timeStamp)
  return Number.isFinite(stamp) ? stamp : Date.now()
}

/** 只清手势状态与内联过渡，不动内联 transform（见 cleanupMobileMore 的注释）。 */
function resetDrawerGestureState() {
  drawerPointerId = null
  drawerAxis = 'pending'
  drawerSamples = []
}

function clearDrawerInlineStyles() {
  const panel = moreSheetEl.value
  if (!panel) return
  panel.style.removeProperty('transition')
  panel.style.removeProperty('transform')
}

function onDrawerPointerDown(event) {
  // 鼠标不参与（桌面用 × / 遮罩 / Esc）；贴**右缘**起手让给系统的边缘/返回手势。
  if (!isDrawerGesturePointer(event.pointerType)) return
  if (isDrawerEdgeGuard(event.clientX, window.innerWidth, DRAWER_EDGE_GUARD)) return
  window.clearTimeout(drawerSettleTimer)
  drawerPointerId = event.pointerId
  drawerStartX = Number(event.clientX) || 0
  drawerStartY = Number(event.clientY) || 0
  drawerAxis = 'pending'
  drawerSamples = []
  pushDrawerSample(drawerSamples, drawerStartX, eventTime(event))
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function onDrawerPointerMove(event) {
  if (drawerPointerId === null || event.pointerId !== drawerPointerId) return
  const x = Number(event.clientX) || 0
  const dx = x - drawerStartX
  const dy = (Number(event.clientY) || 0) - drawerStartY
  if (drawerAxis === 'pending') {
    const axis = resolveDrawerAxis(dx, dy)
    if (axis === 'pending') return
    if (axis === 'vertical') {
      // 方向锁：这是纵向手势（用户想滚动抽屉里的内容），手势作废并交还滚动。
      resetDrawerGestureState()
      clearDrawerInlineStyles()
      return
    }
    drawerAxis = 'horizontal'
  }
  event.preventDefault?.()
  pushDrawerSample(drawerSamples, x, eventTime(event))
  const panel = moreSheetEl.value
  if (!panel) return
  // 跟手期间不能有过渡，否则面板会"追"着手指慢慢飘过来。
  panel.style.transition = 'none'
  panel.style.transform = `translateX(${drawerDragOffset(dx, drawerPixelWidth())}px)`
}

function onDrawerPointerEnd(event) {
  if (drawerPointerId === null || event.pointerId !== drawerPointerId) return
  const axis = drawerAxis
  const x = Number(event.clientX) || 0
  const dx = x - drawerStartX
  pushDrawerSample(drawerSamples, x, eventTime(event))
  const decision = axis === 'horizontal'
    ? resolveDrawerRelease({
      dx,
      velocity: drawerVelocity(drawerSamples, eventTime(event)),
      width: drawerPixelWidth(),
    })
    : { close: false, offset: 0, reason: 'none' }
  resetDrawerGestureState()
  // 方向锁从未锁上横向 = 这只是一次点击（比如点里面的导航项）。
  // 此时**什么都不写**：往面板上留一条内联 transform 会盖住离场过渡的 transform，
  // 点导航项换页时抽屉就变成"淡出"而不是"滑走"了。
  if (axis !== 'horizontal') return
  const panel = moreSheetEl.value
  if (decision.close) {
    if (panel) {
      // 位移交接给离场过渡：内联 transform 会盖住 CSS 的离场类，所以这里把它写到终点，
      // 并带上过渡——两帧之间就会从手指位置平滑滑到屏幕外，而不是先跳回原位。
      // 终点取 DRAWER_EXIT_SHIFT（**正**号 = 往右），与跟手方向同号：
      // 这两个符号一旦不一致，松手瞬间面板就会朝手指的反方向飞出去。
      panel.style.transition = 'transform var(--dur-base) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)'
      panel.style.transform = `translateX(${DRAWER_EXIT_SHIFT}%)`
    }
    closeMobileMore(true)
    return
  }
  if (!panel) return
  // 位移不足：回弹到开位，抽屉继续开着。过渡结束后再摘掉内联样式，
  // 否则残留的 transform 会一直挂着合成层（SwipeActionItem 里同样的取舍）。
  panel.style.transition = 'transform var(--dur-fast) var(--ease-standard)'
  panel.style.transform = 'translateX(0px)'
  window.clearTimeout(drawerSettleTimer)
  drawerSettleTimer = window.setTimeout(() => {
    if (!moreSheetEl.value) return
    clearDrawerInlineStyles()
  }, 200)
}

function onDrawerPointerCancel() {
  if (drawerPointerId === null) return
  resetDrawerGestureState()
  clearDrawerInlineStyles()
}

function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}

function chooseTheme(key, event) {
  autoWallpaperColor.value = false
  // 从手指按下的位置向外扩散一个圆，圆扫到哪里新的配色才出现在哪里；
  // 旧页面留在原地只被裁切，所以不会整屏缩放进场。
  revealChange(
    () => { themeKey.value = key },
    originFromEvent(event, event?.currentTarget),
  )
}

function openMobileTool(key) {
  closeMobileMore()
  if (key === 'account') accountOpen.value = true
  else if (key === 'appearance') showAppearance.value = true
  else if (key === 'focus') showFocusSettings.value = true
  else if (key === 'festive') showFestiveSettings.value = true
  else if (key === 'quick-record') showQuickRecordSettings.value = true
  else if (key === 'data') openDataManager()
  else if (key === 'search') openSearch()
  else if (key === 'update') showVersionUpdate.value = true
}
</script>

<template>
  <!-- `drawer-open` 是**根节点**的打开态：抽屉与遮罩都在 .sidebar 内部，而 .sidebar 自己
       (position:fixed + z-index) 就是一个层叠上下文，里面的 z-index 再大也逃不出去——
       所以要在抽屉打开期间把根节点整体抬到 .task-pill 之上（见样式块里的层叠说明）。 -->
  <aside class="sidebar" :class="{ collapsed, 'drawer-open': showMobileMore }">
    <div class="brand">
      <span class="brand-mark">UP</span>
      <span class="brand-copy">
        <strong>控制台</strong>
        <small>STUDY &amp; LIFE</small>
      </span>
    </div>

    <nav class="nav desktop-nav" aria-label="主要导航">
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

    <nav class="mobile-nav" aria-label="手机主要导航">
      <router-link
        v-for="item in mobileLeadingItems"
        :key="item.path"
        :to="item.path"
        class="mobile-nav-item"
        active-class="active"
        @pointerdown="warmRoute(item.path)"
      >
        <span>{{ item.icon }}</span><small>{{ item.label }}</small>
      </router-link>
      <router-link
        v-for="item in mobileScheduleItems"
        :key="item.path"
        :to="item.path"
        class="mobile-nav-item"
        active-class="active"
        @pointerdown="warmRoute(item.path)"
      >
        <span>{{ item.icon }}</span><small>{{ item.label }}</small>
      </router-link>
      <button
        class="mobile-nav-item mobile-ledger-trigger"
        :class="{ active: props.quickRecordOpen }"
        type="button"
        :aria-expanded="props.quickRecordOpen"
        aria-label="打开快速记录"
        @click="emit('open-quick-record')"
      >
        <span>＋</span><small>记录</small>
      </button>
      <router-link
        v-for="item in mobileTrailingItems"
        :key="item.path"
        :to="item.path"
        class="mobile-nav-item"
        active-class="active"
        @pointerdown="warmRoute(item.path)"
      >
        <span>{{ item.icon }}</span><small>{{ item.label }}</small>
      </router-link>
      <button ref="moreTriggerEl" class="mobile-nav-item more-trigger" :class="{ active: showMobileMore }" type="button" :aria-expanded="showMobileMore" @click="showMobileMore = !showMobileMore">
        <span>⋯</span><small>更多</small>
      </button>
    </nav>

    <!-- 「更多功能」抽屉（≤900px）。两块都**不 Teleport**：
         它们必须留在 .sidebar 里，测试与样式都以这个组件为家（Teleport 到 body 会让
         `host.querySelector('.mobile-more-sheet')` 直接找不到它）。
         遮罩是面板的**兄弟**而不是父节点：面板要能被焦点陷阱和手势单独圈住，
         遮罩只负责"点一下就关"（@click.self 是传播控制，不是动作，见 keyboardReachability 守卫）。 -->
    <Transition name="more-backdrop">
      <div v-if="showMobileMore" class="mobile-more-backdrop" @click.self="closeMobileMore(true)"></div>
    </Transition>

    <Transition name="more-sheet">
      <section
        v-if="showMobileMore"
        ref="moreSheetEl"
        class="mobile-more-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="更多功能"
        tabindex="-1"
        @pointerdown="onDrawerPointerDown"
        @pointermove="onDrawerPointerMove"
        @pointerup="onDrawerPointerEnd"
        @pointercancel="onDrawerPointerCancel"
      >
        <div class="mobile-more-head"><b>更多功能</b><button type="button" class="tap-target" aria-label="关闭更多功能" @click="closeMobileMore(true)">×</button></div>
        <div v-for="group in mobileMoreGroups" :key="group.label" class="mobile-more-group" :class="{ 'mobile-more-group-common': group.label === '常用' }">
          <h3>{{ group.label }}</h3>
          <div class="mobile-more-grid">
            <router-link v-for="item in group.items" :key="item.path" :to="item.path" class="mobile-more-item" :class="{ subdued: item.subdued }" @click="closeMobileMore()" @pointerdown="warmRoute(item.path)">
              <span>{{ item.icon }}</span><small>{{ item.label }}</small>
            </router-link>
            <button v-for="item in group.tools" :key="item.key" type="button" class="mobile-more-item" :class="{ subdued: !['account', 'update'].includes(item.key) }" @click="openMobileTool(item.key)" @pointerdown="warmTool(item.key)"><span>{{ item.icon }}</span><small>{{ item.key === 'account' ? accountLabel : item.label }}</small><em v-if="item.key === 'account'">{{ accountUser ? '已登录' : '未登录' }}</em></button>
          </div>
        </div>
      </section>
    </Transition>

    <!-- 折叠开关也要 aria-expanded：读屏读到「展开侧边栏」时得知道当前是收起的。
         注意要取反——内部标志叫 collapsed，而 aria-expanded 描述的是「是否已展开」。 -->
    <button
      type="button"
      class="collapse-btn"
      :aria-label="collapsed ? '展开侧边栏' : '收起侧边栏'"
      :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      {{ collapsed ? '»' : '«' }}
    </button>

    <div class="sidebar-foot">
      <span class="tools-title">设置与工具</span>
      <button type="button" class="nav-item data-item account-entry" :aria-label="`${accountLabel}${accountUser ? '，已登录' : '，未登录'}`" :title="accountLabel" :aria-expanded="accountOpen" @pointerenter="warmTool('account')" @focus="warmTool('account')" @click="accountOpen = true">
        <span class="icon" aria-hidden="true">👤</span>
        <span class="nav-label">{{ accountLabel }}</span>
      </button>
      <button type="button" class="nav-item data-item sidebar-search-action" @pointerenter="warmTool('search')" @focus="warmTool('search')" @click="showSearch = true">
        <span class="icon">🔍</span>
        <span class="nav-label">搜索</span>
      </button>
      <div class="sidebar-action-row">
        <button type="button" class="nav-item data-item appearance-item" @pointerenter="warmTool('appearance')" @focus="warmTool('appearance')" @click="showAppearance = true">
          <span class="icon">🎨</span>
          <span class="nav-label">个性化</span>
        </button>
        <button
          type="button"
          class="quick-add-button tap-target"
          :class="{ active: props.quickRecordOpen }"
          :aria-expanded="props.quickRecordOpen"
          aria-label="快速记录"
          title="快速记录（Ctrl/Cmd + K）"
          @click="emit('open-quick-record')"
        >
          <span class="quick-add-symbol" aria-hidden="true">＋</span>
          <span class="quick-add-label">记录</span>
        </button>
      </div>
      <button type="button" class="nav-item data-item festive-item" @pointerenter="warmTool('festive')" @focus="warmTool('festive')" @click="showFestiveSettings = true">
        <span class="icon" aria-hidden="true">🎉</span>
        <span class="nav-label">氛围与纪念日</span>
      </button>
      <button type="button" class="nav-item data-item" @pointerenter="warmTool('data')" @focus="warmTool('data')" @click="openDataManager">
        <span class="icon">💾<i v-if="needsBackup" class="backup-dot"></i></span>
        <span class="nav-label">数据管理</span>
      </button>
      <button type="button" class="nav-item data-item" @click="showQuickRecordSettings = true">
        <span class="icon">⚡</span><span class="nav-label">快速记录设置</span>
      </button>
<button type="button" class="nav-item data-item" @pointerenter="warmTool('focus')" @focus="warmTool('focus')" @click="showFocusSettings = true">
          <span class="icon">⏱</span><span class="nav-label">专注设置</span>
        </button>
      <button type="button" class="nav-item data-item" @pointerenter="warmTool('update')" @focus="warmTool('update')" @click="showVersionUpdate = true">
        <span class="icon" aria-hidden="true">↻</span>
        <span class="nav-label">版本与更新</span>
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
            :aria-pressed="themeKey === key"
            @click="chooseTheme(key, $event)"
          ></button>
        </div>
      </div>

      <div class="footer">
        本地存储 · 可随时备份
        <span class="kbd-hint">按 1-9 快速切换页面</span>
      </div>
    </div>
  </aside>

  <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />

  <AccountPanel v-if="accountOpen" :open="accountOpen" @close="accountOpen = false" />
  <DataManager v-if="showDataManager" :open="showDataManager" @close="showDataManager = false" />
  <VersionUpdateModal v-if="showVersionUpdate" :open="showVersionUpdate" @close="showVersionUpdate = false" />
  <AppearanceSettings v-if="showAppearance" :open="showAppearance" @close="showAppearance = false" />
  <QuickRecordSettings v-if="showQuickRecordSettings" :open="showQuickRecordSettings" @close="showQuickRecordSettings = false" />
  <SearchPanel v-if="showSearch" :open="showSearch" @close="closeSearch()" />
  <FocusSettings v-if="showFocusSettings" :open="showFocusSettings" @close="showFocusSettings = false" />
  <FestiveSettings v-if="showFestiveSettings" :open="showFestiveSettings" @close="showFestiveSettings = false" />
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
  height: 100dvh;
  z-index: 20;
  transition: width var(--dur-base) var(--ease-standard), flex-basis var(--dur-base) var(--ease-standard);
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
  font-size: var(--fs-11);
  font-weight: var(--fw-900);
  letter-spacing: 0.06em;
  border-radius: var(--radius-12) var(--radius-4) var(--radius-12) var(--radius-4);
  background: linear-gradient(145deg, var(--brand-grad-a), var(--brand-grad-b));
  box-shadow: 0 8px 18px rgba(69, 111, 232, 0.22);
}
.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-copy strong {
  font-size: var(--fs-17);
  letter-spacing: 0.02em;
}
.brand-copy small {
  margin-top: 1px;
  color: var(--muted);
  font-size: var(--fs-8);
  font-weight: var(--fw-800);
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
  /* 原来是 #98a1b2，在白色侧边栏上只有 2.60:1，
     10px 的小字几乎看不清。改用最弱文字 token（5.19:1）。 */
  color: var(--ink-faint);
  font-size: var(--fs-10);
  font-weight: var(--fw-800);
  letter-spacing: 0.1em;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-10);
  color: var(--ink-soft);
  text-decoration: none;
  font-size: var(--fs-14-5);
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
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
  font-weight: var(--fw-650);
}
.icon {
  font-size: var(--fs-17);
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
  border-radius: var(--radius-circle);
  background: var(--danger);
  border: 1.5px solid var(--card);
}
.collapse-btn {
  margin-top: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: var(--radius-8);
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
  font-size: var(--fs-11);
  color: var(--ink-faint);
  text-align: center;
}
.kbd-hint {
  display: block;
  margin-top: 3px;
  font-size: var(--fs-10);
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
  border-radius: var(--radius-10);
  background: var(--primary-soft);
  color: var(--primary);
  line-height: 1;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.quick-add-button:hover,
.quick-add-button.active {
  background: var(--primary);
  color: var(--on-primary, #fff);
}
.quick-add-symbol {
  font-size: var(--fs-21);
  transition: transform var(--dur-fast) var(--ease-standard);
}
.quick-add-label {
  font-size: var(--fs-11);
  font-weight: var(--fw-650);
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
  color: var(--ink-faint);
  font-size: var(--fs-10);
  font-weight: var(--fw-800);
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
  border-radius: var(--radius-circle);
  box-shadow: 0 0 0 1px var(--border);
  transition: transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard);
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

@media (max-width: 900px) {
  .sidebar,
  .sidebar.collapsed {
    position: fixed;
    top: auto;
    right: 0;
    left: 0;
    bottom: 0;
    width: 100%;
    height: auto;
    padding: 6px max(10px, env(safe-area-inset-right))
      calc(6px + env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
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

  .desktop-nav,
  .sidebar-foot { display: none; }

  .mobile-nav { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 2px; width: 100%; min-width: 0; }
  .mobile-nav-item,
  .mobile-more-item {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    min-width: 0;
    min-height: 54px;
    gap: 2px;
    padding: 4px 2px;
    color: var(--ink-soft);
    text-decoration: none;
    border: 0;
    border-radius: var(--radius-10);
    background: transparent;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .mobile-nav-item > span { height: 22px; font-size: var(--fs-20); line-height: 22px; }
  .mobile-nav-item small,
  .mobile-more-item small { overflow: hidden; max-width: 100%; font-size: var(--fs-11); line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-nav-item.active { color: var(--primary); font-weight: var(--fw-800); background: var(--primary-soft); }
  .mobile-ledger-trigger { width: 100%; min-width: 0; min-height: 54px; color: var(--primary); border: 1px solid var(--primary); border-radius: var(--radius-10); background: var(--primary-soft); box-shadow: none; }
  .mobile-ledger-trigger > span { display: grid; place-items: center; height: 22px; font-size: var(--fs-22); line-height: 22px; }
  .mobile-ledger-trigger.active { color: var(--primary); background: var(--card); box-shadow: none; }
  .more-trigger > span { font-size: var(--fs-25); font-weight: var(--fw-800); line-height: 18px; }
  /* 「更多功能」抽屉：遮罩铺满视口，面板贴**右**边缘的 off-canvas 形态
     （右锚不是随便挑的：右划关闭的手势方向必须与出场方向一致——面板往右滑出去，
     手指也往右拖；左锚 + 右划会出现"手指往右拖、松手却往左飞"的方向反转。
     触发它的 .more-trigger 也是底栏 5 列里最右一格，原来的浮层本来就贴着 right:10px）。
     宽度 min(86vw, 320px) 与 JS 侧的 drawerWidth() 是**同源常量**
     （见 composables/drawerDrag.js 的文件头：手势数学不量 rect，宽度靠常量复算）。 */
  .mobile-more-backdrop { position: fixed; inset: 0; z-index: 30; background: rgba(23, 33, 61, 0.42); touch-action: none; }
  /* 抽屉打开时把**根节点**的层叠抬到 .task-pill 之上、仍在弹窗之下。
     依据 App.vue 那段层叠阶梯（"0 壁纸层 → 1 .layout → 20 .sidebar → 90 .task-pill →
     240 同步告警 → …"，见 App.vue 的层叠阶梯注释）：抬升必须 > 90，
     否则右下角的任务胶囊会浮在遮罩上、抽屉开着还能点到后面的东西；
     又必须 < 100（Modal.vue 的 .overlay），否则抽屉开着再打开个性化弹窗时，
     整个底栏会浮在弹窗遮罩之上。90 与 100 之间是唯一的空档，取 95 两侧都留余量。
     【为什么写成复合选择器】App.vue 里还有一条 scoped `.sidebar[data-v-app]{z-index:20}`
     （Vue 3 的 scoped CSS 会作用于子组件根节点，所以它是**真生效**的）。
     只写 `.sidebar` 的话两者特异性都是 (0,2,0)，胜负由两份样式的注入顺序决定，
     抬升很可能被 App.vue 压掉——而 vitest 不处理 CSS，这种失效谁也测不出来。
     `.sidebar.drawer-open` 编译后是 (0,3,0)，严格大于它，不依赖顺序。
     也刻意不用 !important：那会让这一层没人管得住。 */
  .sidebar.drawer-open { z-index: 95; }
  .mobile-more-sheet {
    position: fixed;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 30;
    width: min(86vw, 320px);
    /* 老浏览器看得懂 vh，新浏览器用 dvh 跟动态视口（地址栏收放时抽屉不会短一截）。 */
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 14px max(12px, env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
    border: 0;
    border-left: 1px solid var(--border);
    border-radius: var(--radius-16) 0 0 var(--radius-16);
    background: var(--card);
    box-shadow: -12px 0 34px rgba(29, 48, 93, 0.22);
    /* 横向手势归抽屉（右划关闭），纵向仍然留给内容滚动。 */
    touch-action: pan-y;
    transition: transform var(--dur-base) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard);
  }
  .mobile-more-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .mobile-more-head button { width: 30px; height: 30px; color: var(--muted); font-size: var(--fs-22); border: 0; border-radius: var(--radius-circle); background: var(--bg); }
  .mobile-more-group + .mobile-more-group { margin-top: 13px; padding-top: 11px; border-top: 1px solid var(--border); }
  .mobile-more-group h3 { margin: 0 0 7px 2px; color: var(--ink-faint); font-size: var(--fs-11); font-weight: var(--fw-800); letter-spacing: .04em; }
  .mobile-more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .mobile-more-group-common .mobile-more-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mobile-more-item { min-height: 66px; color: var(--text); background: var(--bg); }
  .mobile-more-group-common .mobile-more-item { min-height: 76px; }
  .mobile-more-item.subdued { color: var(--ink-soft); background: var(--bg-tint); }
  .mobile-more-item > span { font-size: var(--fs-21); }
  .mobile-more-item > em { color: var(--ink-faint); font-size: var(--fs-10-5); font-style: normal; line-height: 1; }
  /* 面板从**右边**滑进滑出（off-canvas 右外侧开始，与右划关闭同向），遮罩只做透明度淡入淡出。
     102% 必须与 drawerDrag.js 的 DRAWER_EXIT_SHIFT 保持一致（有测试比对这两个数）。 */
  .more-sheet-enter-active,
  .more-sheet-leave-active,
  .more-backdrop-enter-active,
  .more-backdrop-leave-active { transition: opacity var(--dur-fast) var(--ease-standard), transform var(--dur-base) var(--ease-standard); }
  .more-sheet-enter-from,
  .more-sheet-leave-to { opacity: 0; transform: translateX(102%); }
  .more-backdrop-enter-from,
  .more-backdrop-leave-to { opacity: 0; }

  }
@media (min-width: 901px) {
  .mobile-nav,
  .mobile-more-sheet,
  .mobile-more-backdrop { display: none; }

  /* Desktop search and capture live in the app toolbar; the sidebar keeps
     space for navigation and lower-frequency account/settings tools. */
  .sidebar-search-action,
  .sidebar .quick-add-button { display: none; }
  .sidebar-action-row { gap: 0; }
}
</style>
