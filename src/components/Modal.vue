<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  createScrollLock,
  initialFocusTarget,
  isTopOverlay,
  overlayStackRevision,
  overlayZIndexFor,
  pushOverlay,
  removeOverlay,
  topOverlay,
  trapTabKey,
} from '../composables/overlayStack.js'
import {
  clampSheetHeight,
  dragVelocity,
  pushDragSample,
  resolveSheetRelease,
  sheetDetentHeights,
} from '../composables/sheetDrag.js'

let nextModalId = 0

const emit = defineEmits(['close'])

const props = defineProps({
  open: Boolean,
  title: String,
  wide: Boolean,
  medium: Boolean,
  // 窄屏下升级为可拖拽的底部抽屉：顶部出现把手，上拖展开、下拖收回。
  // 默认关闭，未显式开启的弹窗渲染结果与改造前完全一致。
  sheet: Boolean,
  // [摘要档比例, 展开档比例]，按视口高度计算。
  sheetDetents: { type: Array, default: () => [0.5, 0.92] },
  // 关闭阈值：在摘要档往下拖到「摘要高度 × 该比例」以下就判定为收起。
  // 0.7 是各页面共用的手感基准。sheetDrag.js 一直支持这个参数，但此前没有任何
  // 调用方把它传进去，等于这个调节旋钮是死的——四个用 sheet 的页面
  // （外观设置 0.55/0.92、快速记录 0.62/0.92、后台任务 0.5/0.84、时间轮盘 0.5/0.74）
  // 里，摘要档特别矮的那些，往下拖一点点就已经接近底部，需要更低的阈值才不会
  // 给人「几乎没拖就关了」的感觉。目前四个调用方都刻意保留默认值，
  // 这个 prop 是把选择权交回调用方，而不是替它们猜一个值。
  closeRatio: { type: Number, default: 0.7 },
  // 自动聚焦：打开时聚焦到 [autofocus] 元素或第一个可聚焦元素
  autoFocus: { type: Boolean, default: true },
  // 弹窗标题层级。默认 h3；弹窗内若还有 h2 级分区需要倒挂时，
  // 调用方可以把标题压到 h2，保证标题层级不出现父子倒置。
  titleLevel: { type: Number, default: 3 },
})

const modalEl = ref(null)
const overlayEl = ref(null)
const titleId = `modal-title-${++nextModalId}`
const entry = { modalEl, previousFocus: null, active: false }
const scrollLock = createScrollLock()

/**
 * 浮层的**内联** z-index：按它在共享浮层栈里的当前位置递增。
 *
 * 【修的是什么】`.overlay` 的层级原本是固定 100，于是"谁盖住谁"完全由 body 里的
 * DOM 顺序决定；而 Teleport 的锚点在组件**挂载时**创建，"随页面常驻"的浮层
 * （只有 `:open`、没有 `v-if`）永远排在"打开时才建锚点"的浮层之前。结果是：
 * 读屏与 Escape（overlayStack 的 isTopOverlay）认为后开的那个在最上层，
 * 眼睛看到的却是常驻那个压着它，**用户点不到本该显示的那颗按钮，而且不报错**
 * （UX_AUDIT_176_REPORT.md §4 第 26 条 / §1.74）。改成按栈深度取递增值之后，
 * 层叠顺序由**打开顺序**决定，与锚点建得早晚无关。
 *
 * 【关闭时会回落】不在栈里（已关闭）时 `overlayZIndexFor` 返回 null，绑定变回 `{}`，
 * Vue 会把内联 z-index 摘掉，不留永久抬高的层；重新打开时按当下的深度重算。
 * 底下的浮层关闭时，上面那些的深度整体 -1，它们也会跟着回落（靠 overlayStackRevision）。
 *
 * 【为什么绑定值永远是对象、不能是 null】Vue 的 patchStyle 在 next 为 null 且 prev 有值时
 * 走 `el.removeAttribute('style')`，会把 JS 写进去的 top / bottom / height 一起清掉
 * （见 syncViewportGeometry）。绑 `{}` 只清 z-index 这一个键，另外三个属性不受影响。
 */
const overlayZIndex = computed(() => {
  // 读一下版本号建立依赖：栈是普通数组，不读它就永远不会重算。
  void overlayStackRevision.value
  return overlayZIndexFor(entry)
})
const overlayStyle = computed(() => (
  overlayZIndex.value === null ? {} : { zIndex: String(overlayZIndex.value) }
))
// 必须在首次渲染前就确定，否则抽屉会先按自然高度画一帧再跳到档位高度，
// 而 auto → px 无法过渡，用户会看到一次明显的闪跳。
const isNarrow = ref(typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(max-width: 520px)').matches
  : false)
let viewportTarget = null
let viewportListening = false

function focusInitial() {
  nextTick(() => {
    if (!entry.active || !isTopOverlay(entry) || !props.autoFocus) return
    initialFocusTarget(modalEl.value)?.focus?.({ preventScroll: true })
  })
}

function keepFocusedControlVisible() {
  const active = document.activeElement
  if (!active || !modalEl.value?.contains(active) || typeof active.scrollIntoView !== 'function') return
  const viewport = window.visualViewport
  const top = Math.max(0, Number(viewport?.offsetTop) || 0)
  const height = Number(viewport?.height) || window.innerHeight
  const rect = active.getBoundingClientRect?.()
  if (!rect || (rect.top >= top + 12 && rect.bottom <= top + height - 12)) return
  active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// 窄屏判定用的 MediaQueryList 建一次就够。
// 原来每次同步都 new 一个 —— 键盘弹出/收起时 visualViewport 会连着滚几十次，
// 等于每秒新建几十个 MediaQueryList，纯浪费。
const narrowQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(max-width: 520px)')
  : null

function syncViewportGeometry() {
  const overlay = overlayEl.value
  if (!overlay) return
  if (narrowQuery) isNarrow.value = narrowQuery.matches
  const viewport = window.visualViewport
  const top = Math.max(0, Number(viewport?.offsetTop) || 0)
  const height = Math.max(0, Number(viewport?.height) || window.innerHeight)
  overlay.style.top = `${top}px`
  overlay.style.bottom = 'auto'
  overlay.style.height = `${height}px`
  keepFocusedControlVisible()
}

/* ---------- 底部抽屉：把手拖拽（上拖展开摘要之上的详情，下拖收回） ---------- */
const sheetHeight = ref(0)
const sheetDragging = ref(false)
const sheetState = ref('peek')
let sheetStartY = 0
let sheetStartHeight = 0
let sheetSamples = []

// 只有显式开启 sheet 且处于窄屏时才启用；桌面端保持居中的普通弹窗。
const sheetActive = computed(() => Boolean(props.sheet) && isNarrow.value)

function sheetMetrics() {
  const ratios = Array.isArray(props.sheetDetents) ? props.sheetDetents : []
  const viewportHeight = Number(window.visualViewport?.height) || window.innerHeight || 800
  return sheetDetentHeights(viewportHeight, ratios[0], ratios[1])
}

// 注意不能用 `event.timeStamp || Date.now()`：0 是合法时间戳，
// 会被 || 误判成缺失，导致首尾样本时间差为负、速度恒为 0，甩动判定失效。
function eventTime(event) {
  const stamp = Number(event?.timeStamp)
  return Number.isFinite(stamp) ? stamp : Date.now()
}

function snapSheetToState() {
  if (!sheetActive.value) return
  const { peek, expand } = sheetMetrics()
  sheetHeight.value = sheetState.value === 'expand' ? expand : peek
}

function onSheetPointerDown(event) {
  if (!sheetActive.value) return
  sheetDragging.value = true
  sheetStartY = event.clientY
  sheetStartHeight = sheetHeight.value
  sheetSamples = []
  pushDragSample(sheetSamples, event.clientY, eventTime(event))
  event.currentTarget?.setPointerCapture?.(event.pointerId)
}

function onSheetPointerMove(event) {
  if (!sheetDragging.value) return
  const { expand } = sheetMetrics()
  const dy = event.clientY - sheetStartY
  // 上拖增高、下拖降低。下限留一点高度，让「下拖收回」有连续反馈而不是瞬间消失。
  sheetHeight.value = clampSheetHeight(sheetStartHeight - dy, 72, expand)
  pushDragSample(sheetSamples, event.clientY, eventTime(event))
  event.preventDefault?.()
}

function onSheetPointerEnd(event) {
  if (!sheetDragging.value) return
  sheetDragging.value = false
  const { peek, expand } = sheetMetrics()
  const velocity = dragVelocity(sheetSamples, eventTime(event))
  sheetSamples = []
  event.currentTarget?.releasePointerCapture?.(event.pointerId)
  const decision = resolveSheetRelease({
    height: sheetHeight.value,
    velocity,
    peekHeight: peek,
    expandHeight: expand,
    closeRatio: props.closeRatio,
  })
  if (decision.state === 'close') {
    emit('close')
    return
  }
  sheetState.value = decision.state
  sheetHeight.value = decision.height
}

function onSheetPointerCancel() {
  if (!sheetDragging.value) return
  // 手势被系统打断（来电话、切后台）时回到原来的档位，不当作一次收起操作。
  sheetDragging.value = false
  sheetSamples = []
  snapSheetToState()
}

/** 键盘/读屏用户的等价入口：不依赖拖拽也能在摘要与详情之间切换。 */
function toggleSheet() {
  sheetState.value = sheetState.value === 'expand' ? 'peek' : 'expand'
  snapSheetToState()
}

function onViewportResize() {
  syncViewportGeometry()
  // 视口尺寸变了，档位像素高度也要跟着重算，否则旋转屏幕后抽屉会卡在半截。
  snapSheetToState()
}

// visualViewport 在 iOS 键盘弹出/收起时是**连续**滚动的（不是一次性的 resize），
// 原实现每个事件都跑一遍 syncViewportGeometry，而它内部是
// 读 layout（offsetTop/height）→ 写样式（style.top/height）→ 再读 layout
// （keepFocusedControlVisible 里的 getBoundingClientRect），
// 于是每个事件都强制一次同步重排，正好卡在键盘动画最需要流畅的那几十毫秒里。
// 这里合并到一帧一次：滚动事件只是标脏，真正的读写落到 rAF 里做。
let viewportFrame = 0
function scheduleViewportGeometry() {
  if (viewportFrame) return
  viewportFrame = window.requestAnimationFrame(() => {
    viewportFrame = 0
    syncViewportGeometry()
  })
}

function attachViewportListeners() {
  if (viewportListening) return
  viewportListening = true
  window.addEventListener('resize', onViewportResize)
  const viewport = window.visualViewport
  if (viewport?.addEventListener) {
    viewportTarget = viewport
    viewport.addEventListener('resize', onViewportResize)
    // passive：这里只读不写滚动本身，不会阻塞滚动手势。
    viewport.addEventListener('scroll', scheduleViewportGeometry, { passive: true })
  }
  syncViewportGeometry()
  snapSheetToState()
}

function detachViewportListeners() {
  if (!viewportListening) return
  viewportListening = false
  window.removeEventListener('resize', onViewportResize)
  viewportTarget?.removeEventListener?.('resize', onViewportResize)
  viewportTarget?.removeEventListener?.('scroll', scheduleViewportGeometry)
  // 卸载时必须撤掉已排队的帧：否则 rAF 会在弹窗关掉之后才回调，
  // 那一次 syncViewportGeometry 写的是已经卸载的节点。
  if (viewportFrame) {
    window.cancelAnimationFrame(viewportFrame)
    viewportFrame = 0
  }
  viewportTarget = null
  overlayEl.value?.style.removeProperty('top')
  overlayEl.value?.style.removeProperty('bottom')
  overlayEl.value?.style.removeProperty('height')
}

function onKeydown(event) {
  if (!props.open || !isTopOverlay(entry)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  trapTabKey(event, modalEl.value)
}

function activate() {
  if (entry.active) return
  entry.previousFocus = document.activeElement
  entry.active = true
  // 抽屉每次都从「摘要档」重新打开，并且从 0 高度升上来。
  sheetState.value = 'peek'
  sheetHeight.value = 0
  pushOverlay(entry)
  document.addEventListener('keydown', onKeydown)
  scrollLock.lock()
  focusInitial()
  nextTick(attachViewportListeners)
}

function cleanup() {
  if (!entry.active) return
  const wasTop = isTopOverlay(entry)
  removeOverlay(entry)
  entry.active = false
  document.removeEventListener('keydown', onKeydown)
  detachViewportListeners()
  scrollLock.unlock()
  if (!wasTop) return
  const next = topOverlay()
  if (next) {
    if (next.modalEl.value?.contains(entry.previousFocus)) entry.previousFocus?.focus?.({ preventScroll: true })
    else focusInitialFor(next)
  } else if (entry.previousFocus?.isConnected) {
    entry.previousFocus.focus?.({ preventScroll: true })
  }
}

function focusInitialFor(targetEntry) {
  nextTick(() => {
    if (!isTopOverlay(targetEntry)) return
    initialFocusTarget(targetEntry.modalEl.value)?.focus?.({ preventScroll: true })
  })
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      activate()
    } else {
      cleanup()
    }
  },
  { immediate: true }
)

onActivated(() => { if (props.open) activate() })
onDeactivated(cleanup)
onBeforeUnmount(cleanup)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="overlayEl" class="overlay" :style="overlayStyle" @click.self="emit('close')">
      <div
        class="modal"
        :class="{ wide, medium, sheet: sheetActive, dragging: sheetDragging }"
        :style="sheetActive ? { height: `${sheetHeight}px` } : null"
        role="dialog"
        aria-modal="true"
        ref="modalEl"
        tabindex="-1"
        :aria-labelledby="title ? titleId : undefined"
      >
        <div
          v-if="sheetActive"
          class="sheet-grabber"
          aria-hidden="true"
          @pointerdown="onSheetPointerDown"
          @pointermove="onSheetPointerMove"
          @pointerup="onSheetPointerEnd"
          @pointercancel="onSheetPointerCancel"
        ><span></span></div>
        <div class="modal-head">
          <h3 v-if="titleLevel === 3" :id="titleId">{{ title }}</h3>
          <h2 v-else-if="titleLevel === 2" :id="titleId">{{ title }}</h2>
          <h4 v-else :id="titleId">{{ title }}</h4>
          <div class="modal-head-actions">
            <button
              v-if="sheetActive"
              type="button"
              class="sheet-toggle"
              :aria-expanded="sheetState === 'expand'"
              @click="toggleSheet"
            >{{ sheetState === 'expand' ? '收起' : '展开' }}</button>
            <button type="button" class="close tap-target" aria-label="关闭弹窗" @click="emit('close')">✕</button>
          </div>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.foot" class="modal-foot">
          <slot name="foot" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 40, 70, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 基础层级 = overlayStack.js 的 OVERLAY_BASE_Z_INDEX（同一个数，不许漂移）。
     这里只是**兜底值**：真正生效的是 JS 按浮层栈深度写上去的内联 z-index
     （100 + min(深度, 9)），它由**打开顺序**决定，避免"常驻浮层因锚点更早
     而排在后面打开的浮层之上"。上界 109 刻意低于 .sheet-overlay(110)
     与 .context-menu(130)，细节见 Modal.vue 里 overlayStyle 的注释。 */
  z-index: 100;
  padding: 20px;
  animation: fade-in var(--dur-fast) var(--ease-out);
}
.modal {
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: var(--radius-14);
  width: 420px;
  max-width: 100%;
  max-height: 85vh;
  max-height: 85dvh;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(30, 40, 80, 0.2);
  animation: modal-in var(--dur-base) var(--ease-out);
}
.modal.wide {
  width: min(920px, 100%);
}
.modal.medium {
  width: min(540px, 100%);
}
.modal-head {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 0;
}
.close {
  border: none;
  background: transparent;
  font-size: var(--fs-16);
  color: var(--muted);
  width: 32px;
  height: 32px;
  border-radius: var(--radius-8);
}
.close:hover {
  background: var(--bg);
  color: var(--text);
}
.modal-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 18px max(22px, env(safe-area-inset-right, 0px)) 22px max(22px, env(safe-area-inset-left, 0px));
}
.modal-foot {
  flex: 0 0 auto;
  padding: 12px max(22px, env(safe-area-inset-right, 0px)) calc(14px + env(safe-area-inset-bottom, 0px)) max(22px, env(safe-area-inset-left, 0px));
  border-top: 1px solid var(--border);
  background: var(--card);
}
.modal-head-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

/* ---------- 底部抽屉（sheet）：把手拖拽 + 两档高度吸附（仅窄屏启用） ---------- */
.modal.sheet {
  /* 高度改由 JS 按档位写入，所以要覆盖移动端的 max-height */
  max-height: none;
  animation: none;
  transition: height var(--dur-base, 220ms) var(--ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.modal.sheet.dragging {
  /* 拖拽过程必须严格跟手，任何过渡都会产生橡皮筋感 */
  transition: none;
}
.sheet-grabber {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  height: 22px;
  padding-top: 8px;
  cursor: grab;
  /* 垂直手势归把手，避免被滚动容器抢走 */
  touch-action: none;
}
.sheet-grabber:active {
  cursor: grabbing;
}
.sheet-grabber span {
  width: 42px;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--border-strong, var(--border));
}
.sheet-toggle {
  padding: 6px 11px;
  min-height: 30px;
  color: var(--primary);
  font-size: var(--fs-12);
  font-weight: var(--fw-700);
  border: 0;
  border-radius: var(--radius-8);
  background: var(--primary-soft);
  touch-action: manipulation;
}

@keyframes fade-in {
  from { opacity: 0; }
}

@keyframes modal-in {
  from { transform: translateY(8px) scale(0.98); }
}

@media (max-width: 520px) {
  .overlay {
    align-items: flex-end;
    padding: 0;
  }

  .modal {
    width: 100%;
    max-height: 92vh;
    max-height: 92dvh;
    max-height: 92%;
    border-radius: var(--radius-18) var(--radius-18) 0 0;
  }

  .modal-head {
    padding: 15px max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }

  .modal-body {
    padding: 14px max(16px, env(safe-area-inset-right, 0px)) calc(18px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left, 0px));
  }
}
</style>
