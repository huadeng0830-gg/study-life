<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { accountOpen, accountUser } from '../composables/accountAuth.js'
import { autoWallpaperColor, THEMES, themeKey } from '../composables/theme.js'
import { originFromEvent, revealChange } from '../composables/motion.js'
import { needsBackup } from '../composables/backupReminder.js'
import { shouldShowUpdateReminder } from '../composables/updatePreferences.js'
import { preloadCommonRoutes, preloadRoute } from '../router/routePreload.js'
import { useNavigationViewModel } from '../composables/navigationViewModel.js'
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
const loadNavigationSettings = () => import('./NavigationSettings.vue')
const loadQuickRecordSettings = () => import('./QuickRecordSettings.vue')
const loadFocusSettings = () => import('./FocusSettings.vue')
const loadFestiveSettings = () => import('./FestiveSettings.vue')
const loadSearchPanel = () => import('./SearchPanel.vue')
const AccountPanel = defineAsyncComponent(loadAccountPanel)
const toolLoaders = Object.freeze({ account: loadAccountPanel, data: loadDataManager, update: loadVersionUpdate,
  appearance: loadAppearanceSettings, navigation: loadNavigationSettings, focus: loadFocusSettings, festive: loadFestiveSettings, search: loadSearchPanel, capture: () => import('./QuickRecordPanel.vue') })
const accountLabel = '我的账号'
const DataManager = defineAsyncComponent(loadDataManager)
const VersionUpdateModal = defineAsyncComponent(loadVersionUpdate)
const AppearanceSettings = defineAsyncComponent(loadAppearanceSettings)
const NavigationSettings = defineAsyncComponent(loadNavigationSettings)
const QuickRecordSettings = defineAsyncComponent(loadQuickRecordSettings)
const FocusSettings = defineAsyncComponent(loadFocusSettings)
// 氛围与纪念日设置通过桌面按钮和手机「更多」进入，按需加载并预热。
const FestiveSettings = defineAsyncComponent(loadFestiveSettings)
const SearchPanel = defineAsyncComponent(loadSearchPanel)

const currentRoute = useRoute()
const { desktopGroups: navGroups, bottomItems: mobileBottomItems, mobileBarItems,
  moreHasCurrentPage: mobileMoreHasCurrentPage, moreGroups: mobileMoreGroups,
  toggleGroup: toggleNavigationGroup } = useNavigationViewModel(currentRoute, accountLabel)
const collapsed = ref(false)
const showMobileMore = ref(false)
const mobileKeyboardOpen = ref(false)
const moreTriggerEl = ref(null)
const moreSheetEl = ref(null)
const showDataManager = ref(false)
const showVersionUpdate = ref(false)
const updateReminder = ref({ stage: 'idle', version: '' })
const updateReminderVisible = computed(() => ['available', 'ready', 'blocked', 'manual-reload'].includes(updateReminder.value.stage) &&
  shouldShowUpdateReminder(updateReminder.value.version))
function receiveUpdateReminder(event) {
  const detail = event?.detail
  if (!detail || typeof detail.stage !== 'string' || typeof detail.version !== 'string') return
  updateReminder.value = { stage: detail.stage, version: detail.version }
}
const showAppearance = ref(false)
const showNavigationSettings = ref(false)
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
let warmupTimer = 0
let keyboardFocusTimer = 0
let viewportBaselineHeight = 0

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

function updateKeyboardVisibility() {
  const editable = document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]')
  const viewportHeight = Number(window.visualViewport?.height) || window.innerHeight || 0
  const screenHeight = Number(window.screen?.height) || 0
  if (!editable || (screenHeight && Math.abs(screenHeight - viewportBaselineHeight) > 160)) {
    viewportBaselineHeight = Math.max(screenHeight, window.innerHeight || 0, viewportHeight)
  }
  const threshold = Math.max(120, viewportBaselineHeight * 0.18)
  mobileKeyboardOpen.value = window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-height: 520px)').matches
    && Boolean(editable)
    && viewportBaselineHeight - viewportHeight > threshold
}

function onKeyboardFocusChange() {
  window.clearTimeout(keyboardFocusTimer)
  keyboardFocusTimer = window.setTimeout(updateKeyboardVisibility, 40)
}

function openNavigationSettings() {
  showAppearance.value = false
  showNavigationSettings.value = true
}

onMounted(() => {
  window.addEventListener('study-life:update-reminder', receiveUpdateReminder)
  viewportBaselineHeight = Math.max(window.screen?.height || 0, window.innerHeight || 0, window.visualViewport?.height || 0)
  window.addEventListener('focusin', onKeyboardFocusChange)
  window.addEventListener('focusout', onKeyboardFocusChange)
  window.addEventListener('resize', updateKeyboardVisibility)
  window.visualViewport?.addEventListener('resize', updateKeyboardVisibility)
  window.visualViewport?.addEventListener('scroll', updateKeyboardVisibility)
  updateKeyboardVisibility()
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
  window.removeEventListener('study-life:update-reminder', receiveUpdateReminder)
  window.clearTimeout(warmupTimer)
  window.clearTimeout(keyboardFocusTimer)
  window.removeEventListener('focusin', onKeyboardFocusChange)
  window.removeEventListener('focusout', onKeyboardFocusChange)
  window.removeEventListener('resize', updateKeyboardVisibility)
  window.visualViewport?.removeEventListener('resize', updateKeyboardVisibility)
  window.visualViewport?.removeEventListener('scroll', updateKeyboardVisibility)
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
  else if (key === 'navigation') openNavigationSettings()
  else if (key === 'capture') emit('open-quick-record')
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
  <aside class="sidebar" :class="{ collapsed, 'drawer-open': showMobileMore, 'keyboard-open': mobileKeyboardOpen }">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">三</span>
      <span class="brand-copy">
        <strong>三两事</strong>
        <small>学习与生活</small>
      </span>
    </div>

    <nav class="nav desktop-nav" aria-label="主要导航">
      <section v-for="group in navGroups" :key="group.id" class="nav-group">
        <button type="button" class="nav-group-title" :aria-controls="`nav-group-${group.id}`" :aria-expanded="!group.collapsed" :title="collapsed ? group.label : undefined" @click="toggleNavigationGroup(group.id)">{{ group.label }}<span class="nav-group-chevron" aria-hidden="true">{{ group.collapsed ? '＋' : '−' }}</span></button>
        <div v-show="!group.collapsed" :id="`nav-group-${group.id}`" class="nav-group-items">
          <router-link
            v-for="item in group.items"
            :key="item.id"
            :to="item.path"
            class="nav-item"
            exact-active-class="active"
            :title="collapsed ? item.label : undefined"
            @pointerenter="warmRoute(item.path)"
            @pointerdown="warmRoute(item.path)"
            @focus="warmRoute(item.path)"
          >
            <span class="icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </div>
      </section>
    </nav>

    <nav class="mobile-nav" :style="{ '--mobile-nav-count': mobileBarItems }" aria-label="手机主要导航">
      <template v-for="item in mobileBottomItems" :key="item.id">
        <router-link
          :to="item.path"
          class="mobile-nav-item"
          exact-active-class="active"
          :aria-label="item.mobileLabel || item.label"
          @pointerdown="warmRoute(item.path)"
        >
          <span>{{ item.icon }}</span><small>{{ item.mobileLabel || item.label }}</small>
        </router-link>
      </template>
      <button class="mobile-nav-item capture-trigger" type="button" aria-label="快速记录" aria-haspopup="dialog" @pointerenter="warmTool('capture')" @pointerdown="warmTool('capture')" @focus="warmTool('capture')" @click="openMobileTool('capture')">
        <span aria-hidden="true">＋</span><small>快速记录</small>
      </button>
      <button ref="moreTriggerEl" class="mobile-nav-item more-trigger" :class="{ active: showMobileMore || mobileMoreHasCurrentPage }" type="button" :aria-expanded="showMobileMore" @click="showMobileMore = !showMobileMore">
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
        <div v-for="group in mobileMoreGroups" :key="group.id" class="mobile-more-group" :class="{ 'mobile-more-group-common': group.id === 'common' }">
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
        <button type="button" class="nav-item data-item appearance-item" aria-label="编辑导航" title="编辑导航" @pointerenter="warmTool('navigation')" @focus="warmTool('navigation')" @click="openNavigationSettings"><span class="icon" aria-hidden="true">☷</span><span class="nav-label">编辑导航</span></button>
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
        <span class="icon" aria-hidden="true">↻<i v-if="updateReminderVisible" class="update-dot"></i></span>
        <span class="nav-label">版本与更新 <small v-if="updateReminderVisible" class="update-reminder-label">有新版本</small></span>
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
  <AppearanceSettings v-if="showAppearance" :open="showAppearance" @close="showAppearance = false" @edit-navigation="openNavigationSettings" />
  <NavigationSettings v-if="showNavigationSettings" :open="showNavigationSettings" @close="showNavigationSettings = false" />
  <QuickRecordSettings v-if="showQuickRecordSettings" :open="showQuickRecordSettings" @close="showQuickRecordSettings = false" />
  <SearchPanel v-if="showSearch" :open="showSearch" @close="closeSearch()" />
  <FocusSettings v-if="showFocusSettings" :open="showFocusSettings" @close="showFocusSettings = false" />
  <FestiveSettings v-if="showFestiveSettings" :open="showFestiveSettings" @close="showFestiveSettings = false" />
</template>

<style scoped src="./Sidebar.css"></style>
