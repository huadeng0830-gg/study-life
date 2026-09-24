<script setup>
import { computed, defineComponent, h, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import ActionSheet from './ActionSheet.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { appearance, HOME_MODULES, resetAppearanceState, resetWallpapersOnly, WALLPAPER_TARGETS, wallpaperConfig } from '../composables/appearance.js'
import { autoWallpaperColor, themeKey, wallpaperAccent, customThemeColor, THEMES } from '../composables/theme.js'
import { performanceMode } from '../composables/performanceMode.js'
import { highContrast } from '../composables/contrast.js'
import { originFromEvent, revealChange } from '../composables/motion.js'
import { clearAllWallpapers, compressWallpaper, getWallpaper, removeWallpaper, setWallpaper, wallpaperRevision } from '../composables/wallpaperStorage.js'
import { useTabKeys } from '../composables/tabKeys.js'
import { appearanceTab } from '../composables/modalSections.js'

// 高对比度开关（与 style.css 的 :root[data-contrast='high'] 对应）。
// 用 computed 双向绑定，select 才能用布尔值当 v-model。
const highContrastMode = computed({
  get: () => Boolean(highContrast.value),
  set: (value) => { highContrast.value = Boolean(value) },
})

const SwipeActionSelector = defineComponent({
  props: {
    modelValue: String,
    title: String,
    options: Array,
    color: String,
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const optionColors = {
      none: 'muted',
      complete: 'success',
      edit: 'primary',
      delete: 'danger',
    }
    const optionIcons = {
      none: '➖',
      complete: '✅',
      edit: '✏️',
      delete: '🗑️',
    }
    const colorMap = {
      // success 的文字色原为 #07805d，配自己的浅底 #e7f8f1 只有 4.49:1 —— 差 0.01
      // 不到 AA。同族的 primary / danger 早就按 AA 调过（见下一条注释），说明这是漏网
      // 而不是有意。改成与 style.css 的 --success 同值，5.12:1。
      success: { bg: '#e7f8f1', border: '#14966d', text: '#067654' },
      // 与 style.css 的 --primary / --danger 对齐（原值 #456fe8/#ef4444 已按 AA 调整）。
      primary: { bg: '#edf2ff', border: '#3d63d8', text: '#3d63d8' },
      danger: { bg: '#feecec', border: '#c62828', text: '#c62828' },
      muted: { bg: '#f3f4f6', border: '#9ca3af', text: '#5f6775' },
    }
    return () => {
      const opt = props.options.find(o => o.id === props.modelValue) || props.options[0]
      const c = colorMap[optionColors[opt.id] || 'muted']
      const style = { background: c.bg, borderColor: c.border, color: c.text }
      return h('div', { class: 'swipe-action-card' }, [
        h('div', { class: 'swipe-action-title' }, props.title),
        h('label', { class: 'swipe-action-select-wrap' }, [
          h('select', {
            value: props.modelValue,
            onInput: (e) => emit('update:modelValue', e.target.value),
            class: 'swipe-action-select',
            style,
          }, props.options.map(o => h('option', { value: o.id, key: o.id }, `${optionIcons[o.id] || ''} ${o.label}`))),
        ]),
      ])
    }
  },
})

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

// 分区状态存在 composables/modalSections.js 的模块级 ref 里：关闭再打开回到上次所在的分区。
const tab = appearanceTab
// 五个分区的键盘模型。分组顺序必须与模板里按钮的顺序一致。
const APPEARANCE_TAB_KEYS = ['theme', 'wallpaper', 'quotes', 'layout', 'swipe']
const { onKeydown: onAppearanceTabKeydown, tabIndexFor: appearanceTabIndex } = useTabKeys({
  keys: APPEARANCE_TAB_KEYS,
  active: () => tab.value,
  select: (key) => {
    tab.value = key
  },
})
const selectedTarget = ref('global')
const previewUrl = ref('')
const hasOwnImage = ref(false)
const imageInfo = ref('')
const busy = ref(false)
const busyStage = ref('')
const error = ref('')
const message = ref('')
// 三个破坏性操作的待确认状态：沿用仓库既有的 state + 回调惯例
// （ConfirmDialog 自己不重置状态，清状态是调用方的责任）。
const resetAppearanceTarget = ref(false)
const resetWallpapersTarget = ref(false)
const quoteDraft = ref('')
let previewRequest = 0
const SWIPE_OPTIONS = [
  { id: 'none', label: '无操作' },
  { id: 'complete', label: '完成 / 取消完成' },
  { id: 'edit', label: '编辑' },
  { id: 'delete', label: '删除（会再次确认）' },
]

const targetConfig = computed(() => wallpaperConfig.value.targets[selectedTarget.value])
const isGlobal = computed(() => selectedTarget.value === 'global')
const ownMode = computed(() => isGlobal.value || targetConfig.value.mode === 'own')
const previewSettings = computed(() =>
  !isGlobal.value && targetConfig.value.mode === 'inherit'
    ? wallpaperConfig.value.targets.global
    : targetConfig.value
)

watch(() => props.open, (open) => {
  if (!open) return
  // 壁纸预览会读取 IndexedDB 并创建 Blob URL。设置默认打开“主题”页，
  // 不再强制回到"主题"页：关闭再打开会回到上次所在的分区（见 modalSections.js）。
  // 壁纸预览那套 I/O 依然只在 tab === 'wallpaper' 时才做（见下面的 watcher），
  // 所以首次打开（默认 theme）不做任何 I/O；上次停在壁纸页的用户会在打开时立即
  // 加载预览，而那正是他这次要看的页面。
  quoteDraft.value = appearance.value.quotes.join('\n')
  error.value = ''
  message.value = ''
})
watch([selectedTarget, wallpaperRevision, tab, () => props.open], () => {
  if (props.open && tab.value === 'wallpaper') void loadPreview()
})

onBeforeUnmount(() => {
  previewRequest += 1
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  endModuleDrag()
})

/* ---------- 首页模块拖拽排序（无依赖，指针事件） ---------- */
const draggingModuleId = ref('')
let moduleDragStartY = 0
let moduleDragRowH = 48

function homeModuleLabel(id) {
  return HOME_MODULES.find((item) => item.id === id)?.label || id
}
function moduleIndexOf(id) {
  return appearance.value.homeModules.findIndex((item) => item.id === id)
}
function moveHomeModule(from, to) {
  if (from === to || from < 0 || to < 0 || to >= appearance.value.homeModules.length) return
  const arr = [...appearance.value.homeModules]
  const [moved] = arr.splice(from, 1)
  arr.splice(to, 0, moved)
  appearance.value.homeModules = arr
}
function startModuleDrag(id, event) {
  if (event.pointerType === 'mouse' && event.buttons !== 1) return
  event.preventDefault()
  draggingModuleId.value = id
  moduleDragStartY = event.clientY
  const row = event.currentTarget?.closest?.('.module-row')
  moduleDragRowH = row ? row.offsetHeight + 6 : 48
  window.addEventListener('pointermove', onModuleDragMove, false)
  window.addEventListener('pointerup', endModuleDrag, true)
  window.addEventListener('pointercancel', endModuleDrag, true)
}
function onModuleDragMove(event) {
  if (!draggingModuleId.value) return
  const current = moduleIndexOf(draggingModuleId.value)
  if (current < 0) return
  const delta = event.clientY - moduleDragStartY
  const target = Math.max(0, Math.min(appearance.value.homeModules.length - 1, current + Math.round(delta / moduleDragRowH)))
  if (target !== current) {
    moveHomeModule(current, target)
    moduleDragStartY = event.clientY
  }
}
function endModuleDrag() {
  draggingModuleId.value = ''
  window.removeEventListener('pointermove', onModuleDragMove, false)
  window.removeEventListener('pointerup', endModuleDrag, true)
  window.removeEventListener('pointercancel', endModuleDrag, true)
}
/* 键盘替代（第四十七轮，WCAG 2.5.7 Dragging Movements）。
   首页模块排序原本只有拖动一条路：手柄虽然是 <button>（能 Tab 到），但按 Enter 或方向键
   什么都不会发生，所以键盘用户改不了顺序。页面顺序是这个设置页的核心操作之一，
   不能只有指针可达。这里用 Alt + 上/下 键移动——加 Alt 是因为裸方向键在按钮上没有语义，
   容易误触。焦点必须跟着模块一起走：否则连按第二下时，动的是"顶上来那个模块"，
   而不是用户盯着的那个（第四十一轮课程表网格踩过同样的坑）。 */
function onModuleDragKeydown(event, id) {
  if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || !event.altKey) return
  const from = moduleIndexOf(id)
  if (from < 0) return
  const to = from + (event.key === 'ArrowUp' ? -1 : 1)
  if (to < 0 || to >= appearance.value.homeModules.length) return
  event.preventDefault()
  moveHomeModule(from, to)
  nextTick(() => {
    document.querySelector(`.module-drag[data-module="${id}"]`)?.focus()
  })
}
function resetHomeModuleOrder() {
  const byVisible = new Map(appearance.value.homeModules.map((item) => [item.id, item.visible]))
  appearance.value.homeModules = HOME_MODULES.map((item) => ({ id: item.id, visible: byVisible.get(item.id) ?? true }))
}

async function loadPreview() {
  const request = ++previewRequest
  const target = selectedTarget.value
  const source = target !== 'global' && targetConfig.value.mode === 'inherit' ? 'global' : target
  try {
    const [blob, ownBlob] = await Promise.all([getWallpaper(source), getWallpaper(target)])
    if (request !== previewRequest) return
    const previous = previewUrl.value
    previewUrl.value = blob ? URL.createObjectURL(blob) : ''
    hasOwnImage.value = Boolean(ownBlob)
    imageInfo.value = blob ? `${Math.max(1, Math.round(blob.size / 1024))} KB · 仅本机` : ''
    if (previous) URL.revokeObjectURL(previous)
  } catch {
    if (request !== previewRequest) return
    const previous = previewUrl.value
    previewUrl.value = ''
    hasOwnImage.value = false
    imageInfo.value = ''
    if (previous) URL.revokeObjectURL(previous)
  }
}

function chooseTarget(key) {
  selectedTarget.value = key
  error.value = ''
  message.value = ''
}

function setPageMode(mode) {
  targetConfig.value.mode = mode
  loadPreview()
}

async function uploadImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  busy.value = true
  error.value = ''
  message.value = ''
  // 大图解码 + 压缩 + 写 IndexedDB 可能要几秒，分两段告诉用户现在到哪一步，
  // 而不是只留一句「压缩中…」让人不知道还要等多久、在等什么。
  busyStage.value = '正在本机压缩图片…'
  try {
    const result = await compressWallpaper(file)
    busyStage.value = '正在保存到本机…'
    await setWallpaper(selectedTarget.value, result.blob)
    wallpaperAccent.value = result.accent
    targetConfig.value.fit = 'auto'
    if (isGlobal.value) targetConfig.value.enabled = true
    else targetConfig.value.mode = 'own'
    message.value = `已压缩为 ${result.width}×${result.height}，并提取主题色 ${result.accent}`
    await loadPreview()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '无法处理这张图片'
  } finally {
    busy.value = false
    busyStage.value = ''
  }
}

/* ---------- 换壁纸：底部操作菜单（拍照 / 从相册选择 / 删除） ---------- */
const showImageSheet = ref(false)
const cameraInput = ref(null)
const galleryInput = ref(null)
const canCapture = ref(false)

if (typeof window !== 'undefined' && window.matchMedia) {
  canCapture.value = window.matchMedia('(pointer: coarse)').matches
}

const imageSheetActions = computed(() => {
  const list = []
  // 桌面端没有后置摄像头，capture 会被忽略，所以不显示「拍照」这一项避免误导。
  if (canCapture.value) list.push({ key: 'camera', label: '拍照', icon: '📷', hint: '现在用相机拍一张' })
  list.push({ key: 'gallery', label: '从相册选择', icon: '🖼', hint: '使用本机已有的图片' })
  if (hasOwnImage.value) list.push({ key: 'remove', label: '删除当前壁纸', icon: '🗑', tone: 'danger' })
  return list
})

function onImageSheetSelect(action) {
  showImageSheet.value = false
  // 这里仍在用户点击的事件任务里，程序化触发 file input 不会被浏览器拦截。
  if (action.key === 'camera') cameraInput.value?.click()
  else if (action.key === 'gallery') galleryInput.value?.click()
  else if (action.key === 'remove') removeImage()
}

async function resetAllAppearance() {
  resetAppearanceTarget.value = true
}

async function confirmResetAllAppearance() {
  resetAppearanceTarget.value = false
  busy.value = true
  error.value = ''
  try {
    await clearAllWallpapers()
    resetAppearanceState()
    autoWallpaperColor.value = false
    wallpaperAccent.value = '#456fe8'
    themeKey.value = 'blue'
    selectedTarget.value = 'global'
    quoteDraft.value = appearance.value.quotes.join('\n')
    message.value = '已恢复初始外观，课程、待办和其他记录没有改变'
    await loadPreview()
  } catch {
    error.value = '恢复初始外观失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

// 删除当前页面壁纸的确认。
// 【短路链必须保留】没有自定义壁纸时不该弹确认——只提示不存在的操作会让人以为
// 有东西可删。所以先判 hasOwnImage，再决定要不要打开对话框（与改造前同一个次序）。
// 【目标页面在弹确认之前快照】确认期间 selectedTarget 若被改写，晚读会删错页面的壁纸。
const removeImageTarget = ref(null)

function removeImage() {
  if (!hasOwnImage.value) return
  removeImageTarget.value = { target: selectedTarget.value }
}

async function confirmRemoveImage() {
  const pending = removeImageTarget.value
  removeImageTarget.value = null
  if (!pending) return
  await removeWallpaper(pending.target)
  const config = wallpaperConfig.value.targets[pending.target]
  if (pending.target === 'global') config.enabled = false
  else config.mode = 'inherit'
  message.value = '壁纸已删除'
  await loadPreview()
}

async function resetAllWallpapers() {
  resetWallpapersTarget.value = true
}

async function confirmResetAllWallpapers() {
  resetWallpapersTarget.value = false
  busy.value = true
  try {
    await clearAllWallpapers()
    resetWallpapersOnly()
    message.value = '全部壁纸已恢复默认'
    await loadPreview()
  } finally {
    busy.value = false
  }
}

function chooseTheme(key, event) {
  // 这里原来是 <label>，既没有 input 也没有 @click，点了完全没有反应。
  // 现在与侧栏主题色走同一条链路：显式选色时关掉壁纸自动取色（否则
  // 自动取色会覆盖刚选的颜色，看起来仍像没生效），并用圆形扩散切过去。
  autoWallpaperColor.value = false
  revealChange(
    () => { themeKey.value = key },
    originFromEvent(event, event?.currentTarget),
  )
}

function saveQuotes() {
  const lines = quoteDraft.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50)
  appearance.value.quotes = lines.length ? lines : ['今天也要漂亮通关。']
  appearance.value.fixedQuoteIndex = Math.min(appearance.value.fixedQuoteIndex, appearance.value.quotes.length - 1)
  quoteDraft.value = appearance.value.quotes.join('\n')
  message.value = `已保存 ${appearance.value.quotes.length} 条文字`
}

const previewStyle = computed(() => ({
  backgroundImage: previewUrl.value ? `url("${previewUrl.value}")` : 'none',
  backgroundPosition: previewSettings.value.position,
  backgroundSize: previewSettings.value.fit === 'auto' ? 'cover' : previewSettings.value.fit,
  filter: `blur(${previewSettings.value.blur}px) brightness(${previewSettings.value.brightness}%)`,
  opacity: previewSettings.value.opacity / 100,
}))
</script>

<template>
  <Modal :open="open" title="🎨 个性化外观" wide sheet :sheet-detents="[0.55, 0.92]" @close="emit('close')">
    <div class="appearance-tabs" role="tablist" aria-label="个性化设置分区" @keydown="onAppearanceTabKeydown"><button id="appearance-tab-theme" role="tab" :tabindex="appearanceTabIndex('theme')" :aria-selected="tab === 'theme'" :class="{ on: tab === 'theme' }" @click="tab = 'theme'">主题与课表</button><button id="appearance-tab-wallpaper" role="tab" :tabindex="appearanceTabIndex('wallpaper')" :aria-selected="tab === 'wallpaper'" :class="{ on: tab === 'wallpaper' }" @click="tab = 'wallpaper'">本地壁纸</button><button id="appearance-tab-quotes" role="tab" :tabindex="appearanceTabIndex('quotes')" :aria-selected="tab === 'quotes'" :class="{ on: tab === 'quotes' }" @click="tab = 'quotes'">今天页文字</button><button id="appearance-tab-layout" role="tab" :tabindex="appearanceTabIndex('layout')" :aria-selected="tab === 'layout'" :class="{ on: tab === 'layout' }" @click="tab = 'layout'">首页布局</button><button id="appearance-tab-swipe" role="tab" :tabindex="appearanceTabIndex('swipe')" :aria-selected="tab === 'swipe'" :class="{ on: tab === 'swipe' }" @click="tab = 'swipe'">滑动操作</button></div>
    <div v-if="tab === 'theme'" class="theme-editor" role="tabpanel" aria-labelledby="appearance-tab-theme">
      <div class="theme-grid" role="group" aria-label="主题色选择">
        <button v-for="(theme, key) in THEMES" :key="key" type="button" class="theme-cell" :class="{ on: themeKey === key }" :aria-pressed="themeKey === key" @click="chooseTheme(key, $event)">
          <span class="theme-dot" :style="{ background: theme.primary || 'transparent', border: theme.primary ? 'none' : '2px dashed var(--border)' }"></span>
          <span class="theme-name">{{ theme.name }}</span>
        </button>
      </div>
      <div v-if="themeKey === 'custom'" class="custom-color-picker">
        <label>自定义主题色 <input v-model="customThemeColor" type="color" /></label>
      </div>
      <div class="divider"></div>
      <label class="enable-row"><input v-model="autoWallpaperColor" type="checkbox" /> 从壁纸自动提取主题色（开启后覆盖上方选择）</label>
      <label class="performance-row">
        <span><b>流畅优先</b><small>自动会在低性能、低电量偏好或“减少动态效果”时关闭高成本视觉效果。</small></span>
        <select v-model="performanceMode" aria-label="流畅优先模式">
          <option value="auto">自动</option>
          <option value="on">始终开启</option>
          <option value="off">保持完整效果</option>
        </select>
      </label>
      <label class="performance-row">
        <span><b>高对比度</b><small>加深边框与次要文字的对比，方便弱视或在强光下阅读。系统已开启“高对比度”时默认也会生效。</small></span>
        <select v-model="highContrastMode" aria-label="高对比度模式">
          <option :value="false">跟随系统</option>
          <option :value="true">始终开启</option>
        </select>
      </label>
      <div class="divider"></div>
      <div class="schedule-style"><div><b>课表显示</b><small>只改变课程表视觉，不影响课程数据。</small></div><div class="skin-options"><label v-for="skin in [{id:'classic',name:'经典表格',icon:'▦'},{id:'notebook',name:'校园笔记',icon:'📒'},{id:'timeline',name:'极简时间轴',icon:'⌁'}]" :key="skin.id" :class="{ on: appearance.scheduleSkin === skin.id }"><input v-model="appearance.scheduleSkin" type="radio" :value="skin.id" /><span>{{ skin.icon }}</span><b>{{ skin.name }}</b></label></div></div>
    </div>

    <div v-else-if="tab === 'wallpaper'" class="wallpaper-layout" role="tabpanel" aria-labelledby="appearance-tab-wallpaper">
      <aside class="target-list"><button v-for="(target, key) in WALLPAPER_TARGETS" :key="key" :class="{ on: selectedTarget === key }" @click="chooseTarget(key)">{{ target.label }}</button></aside>
      <section class="wallpaper-editor">
        <div v-if="!isGlobal" class="mode-row"><button :class="{ on: targetConfig.mode === 'inherit' }" @click="setPageMode('inherit')">跟随全站</button><button :class="{ on: targetConfig.mode === 'own' }" @click="setPageMode('own')">单独设置</button><button :class="{ on: targetConfig.mode === 'none' }" @click="setPageMode('none')">此页关闭</button></div>
        <label v-else class="enable-row"><input v-model="targetConfig.enabled" type="checkbox" /> 启用全站默认壁纸</label>

        <div class="wallpaper-preview"><div class="preview-image" :style="previewStyle"></div><div class="preview-overlay" :style="{ opacity: previewSettings.overlay / 100 }"></div><div class="preview-card"><b>{{ WALLPAPER_TARGETS[selectedTarget].label }}</b><span>{{ previewUrl ? imageInfo : '尚未选择图片' }}</span></div></div>

        <template v-if="ownMode">
          <div class="upload-row">
            <input ref="cameraInput" type="file" accept="image/*" capture="environment" :disabled="busy" hidden @change="uploadImage" />
            <input ref="galleryInput" type="file" accept="image/*" :disabled="busy" hidden @change="uploadImage" />
            <button type="button" class="btn btn-primary" :disabled="busy" :aria-busy="busy || undefined" @click="showImageSheet = true">
              {{ busy ? busyStage : (hasOwnImage ? '📷 更换照片' : '📷 上传照片') }}
            </button>
            <button v-if="hasOwnImage" class="btn btn-danger" :disabled="busy" :aria-busy="busy || undefined" @click="removeImage">删除壁纸</button>
          </div>
          <div class="control-grid">
            <label>模糊 <b>{{ targetConfig.blur }}px</b><input v-model.number="targetConfig.blur" type="range" min="0" max="20" /></label>
            <label>亮度 <b>{{ targetConfig.brightness }}%</b><input v-model.number="targetConfig.brightness" type="range" min="50" max="130" /></label>
            <label>遮罩 <b>{{ targetConfig.overlay }}%</b><input v-model.number="targetConfig.overlay" type="range" min="0" max="70" /></label>
            <label>透明度 <b>{{ targetConfig.opacity }}%</b><input v-model.number="targetConfig.opacity" type="range" min="20" max="100" /></label>
            <label>显示位置<select v-model="targetConfig.position"><option value="center center">居中</option><option value="center top">顶部</option><option value="center bottom">底部</option><option value="left center">靠左</option><option value="right center">靠右</option></select></label>
            <label>图片适应<select v-model="targetConfig.fit"><option value="auto">智能适应（推荐）</option><option value="cover">始终铺满</option><option value="contain">始终完整显示</option></select></label>
          </div>
        </template>

        <div class="wallpaper-actions">
          <button class="btn btn-warning" @click="resetAllWallpapers">🖼 一键恢复全部壁纸</button>
          <span class="action-hint">仅重置壁纸图片与设置，不影响主题色、励志语等其他个性化</span>
          <button class="btn btn-danger" @click="resetAllAppearance">🔄 一键恢复所有个性化</button>
          <span class="action-hint">重置壁纸、主题色、励志语、首页排序、页面皮肤和滑动操作等所有个性化设置</span>
        </div>

        <div class="color-row"><label><input v-model="autoWallpaperColor" type="checkbox" /> 使用壁纸自动取色</label><span class="color-swatch" :style="{ background: wallpaperAccent }"></span><input v-model="wallpaperAccent" type="color" aria-label="壁纸主题色" /></div>
        <p class="privacy-note">图片会先在本机压缩，再保存到当前设备；不会上传服务器。二维码迁移时可单独选择是否携带壁纸。</p>
      </section>
    </div>

    <section v-else-if="tab === 'quotes'" class="quotes-editor" role="tabpanel" aria-labelledby="appearance-tab-quotes">
      <label class="enable-row"><input v-model="appearance.showQuote" type="checkbox" /> 在“今天”页显示个性化文字</label>
      <label>励志语（每行一条，最多 50 条）<textarea v-model="quoteDraft" rows="9" placeholder="今天也要漂亮通关。"></textarea></label>
      <div class="quote-row"><label>显示方式<select v-model="appearance.quoteMode"><option value="daily">每天轮换</option><option value="random">每次打开随机</option><option value="fixed">固定一条</option></select></label><label v-if="appearance.quoteMode === 'fixed'">固定显示<select v-model.number="appearance.fixedQuoteIndex"><option v-for="(quote, index) in appearance.quotes" :key="index" :value="index">{{ quote }}</option></select></label></div>
      <label>个人签名<input v-model="appearance.signature" maxlength="40" placeholder="例如：保持好奇，慢慢变强" /></label>
      <button class="btn btn-primary" @click="saveQuotes">保存文字</button>
    </section>

    <section v-else-if="tab === 'layout'" class="layout-editor" role="tabpanel" aria-labelledby="appearance-tab-layout">
      <div><h4>今天页模块</h4><p>拖动右侧手柄排序；隐藏模块不会删除数据，随时可以恢复。</p></div>
      <div class="module-sort">
        <div v-for="module in appearance.homeModules" :key="module.id" class="module-row" :class="{ dragging: draggingModuleId === module.id }">
          <label class="module-row-main"><span>{{ homeModuleLabel(module.id) }}</span><input v-model="module.visible" type="checkbox" /></label>
          <button type="button" class="module-drag" :data-module="module.id" :aria-label="`排序：${homeModuleLabel(module.id)}。可拖动，也可用 Alt 加上下方向键移动`" @pointerdown="startModuleDrag(module.id, $event)" @keydown="onModuleDragKeydown($event, module.id)">⠿</button>
        </div>
        <button type="button" class="btn module-reset" @click="resetHomeModuleOrder">恢复默认顺序</button>
      </div>
    </section>

    <section v-else class="swipe-editor" role="tabpanel" aria-labelledby="appearance-tab-swipe">
      <div class="swipe-intro"><h4>手机左右滑动</h4><p>滑过约三分之一张卡片才会执行，删除还会再次确认；电脑端原有点击操作不变。</p></div>

      <div class="swipe-category">
        <div class="swipe-category-header">
          <span class="swipe-category-icon">✅</span>
          <div>
            <b>待办</b>
            <span>对单条待办生效</span>
          </div>
        </div>
        <div class="swipe-direction-row">
          <SwipeActionSelector
            title="向左滑"
            v-model="appearance.swipeActions.tasks.left"
            :options="SWIPE_OPTIONS"
            :color="'success'"
          />
          <SwipeActionSelector
            title="向右滑"
            v-model="appearance.swipeActions.tasks.right"
            :options="SWIPE_OPTIONS"
            :color="'primary'"
          />
        </div>
      </div>

      <div class="swipe-category">
        <div class="swipe-category-header">
          <span class="swipe-category-icon">☑️</span>
          <div>
            <b>清单</b>
            <span>对清单中的单个项目生效</span>
          </div>
        </div>
        <div class="swipe-direction-row">
          <SwipeActionSelector
            title="向左滑"
            v-model="appearance.swipeActions.lists.left"
            :options="SWIPE_OPTIONS"
            :color="'success'"
          />
          <SwipeActionSelector
            title="向右滑"
            v-model="appearance.swipeActions.lists.right"
            :options="SWIPE_OPTIONS"
            :color="'primary'"
          />
        </div>
      </div>

      <p class="privacy-note">默认设置：向左滑完成，向右滑编辑。选择“无操作”可以关闭某个方向。</p>
    </section>

    <!-- 成功用 role="status"（礼貌播报），失败才用 role="alert"（立即打断）。
         两者都在同一行且都是 v-if，所以刻意把角色写清楚，别让脚本/后人再加错。 -->
    <p v-if="message" class="success" role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p>
  </Modal>

  <ActionSheet
    :open="showImageSheet"
    title="更换壁纸"
    description="图片会先在本机压缩，不会上传服务器"
    :actions="imageSheetActions"
    @select="onImageSheetSelect"
    @close="showImageSheet = false"
  />

  <!-- 本组件的设置弹窗没有 v-if（随组件一起挂载、且声明在这三个确认框之前），
       锚点天然更早；这里仍统一 v-if 随目标挂载，避免以后调整声明顺序时被盖住
       （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
  <ConfirmDialog
    v-if="removeImageTarget"
    :open="Boolean(removeImageTarget)"
    title="删除壁纸"
    message="确定删除这个页面的本地壁纸吗？"
    confirm-label="删除壁纸"
    @close="removeImageTarget = null"
    @confirm="confirmRemoveImage"
  />

  <ConfirmDialog
    v-if="resetWallpapersTarget"
    :open="resetWallpapersTarget"
    title="恢复全部壁纸"
    message="确定恢复所有页面的壁纸为默认设置吗？这会删除所有自定义壁纸图片。"
    confirm-label="恢复默认"
    @close="resetWallpapersTarget = false"
    @confirm="confirmResetAllWallpapers"
  />

  <ConfirmDialog
    v-if="resetAppearanceTarget"
    :open="resetAppearanceTarget"
    title="恢复初始外观"
    message="确定恢复初始外观吗？本机壁纸、励志语、首页排序、页面皮肤和滑动操作都会重置，课程与待办等业务数据不受影响。"
    confirm-label="恢复初始外观"
    @close="resetAppearanceTarget = false"
    @confirm="confirmResetAllAppearance"
  />
</template>

<style scoped>
/* 第三十七轮说明：本样式块曾因一次删除器 bug 被破坏，内容由删除前的构建产物
   （dist/assets 的编译 CSS，去掉 scope 属性后反压缩）整体重建，**原有注释在重建中丢失**。
   第三十八轮已按 scope 归属清掉其中属于别组件的同值副本。新增规则时请照常写注释。 */
/* 第三十九轮（续，与 App.vue 的侧边栏那一批同源、同一判据）：这里原先还有 16 条引用
   **子组件内部节点**类的规则，逐条证明"永远匹配不到元素"后删除 —— .sheet-overlay / .sheet /
   .sheet-card / .sheet-head / .sheet-head p / .sheet-actions / .sheet-action /
   .sheet-action+.sheet-action / .sheet-action:disabled / .sheet-action.danger /
   .sheet-action.danger:hover:not(:disabled) / .sheet-action.primary / .sheet-action-icon /
   .sheet-action-copy / .sheet-empty / .sheet-cancel（16 条选择器 = 16 条规则体）。
   依据：这些类只在 ActionSheet.vue / Modal.vue 的**模板内部节点**上（两个子组件的模板根都是
   Teleport，没有任何类落在根节点上），而 Vue 的 scoped CSS 只把父作用域属性加在子组件的
   根节点上；且本组件在样式块之外**一次都没有**把这些类当 class 用过（模板 class/:class、
   脚本字符串常量、注释全都为 0）。删除前后用 @vue/compiler-sfc 各编译一次做逐字 diff：
   规则体 114 → 98，消失的正好是这 16 条、**新增 0 条、被改动 0 条**。
   注意 `.sheet` 同时是 ActionSheet.vue 与 Modal.vue 的内部类，所以同**一条**命中同时落进
   "AppearanceSettings → ActionSheet" 与 "AppearanceSettings → Modal" 两对——这是已知的
   归属歧义，不是笔误。这些样式在 components/ActionSheet.vue 自己的 scoped 样式块里都有
   等价副本（Modal.vue 的 `.modal.sheet` / `.sheet-grabber` / `.sheet-toggle` 是另一套），
   要改请改那边；判据见 tests/scopedChildReachability.test.js。 */
/* 下面这段解释的对象仍是 ActionSheet.vue / Modal.vue 里的弹层本体（本文件已不再定义它）：
   40px 是顶部拖拽把手与进度的预留高度，所以是 calc(100dvh - 40px) 而不是 100dvh；
   用 dvh 是为了跟随移动端地址栏伸缩（vh 兜底在别处，见 tests/mobileViewport.test.js）。
   overscroll-behavior 与 -webkit-overflow-scrolling 一起挡住"滚到底带动页面滚动"的老问题。 */


@keyframes sheet-overlay-in-db40fa9a {
  0% {
  opacity:0}
}
@keyframes sheet-item-in-db40fa9a {
  0% {
  opacity:0;
  transform:translateY(14px)}
}
.appearance-tabs {
  background:var(--bg);
  border-radius:10px;
  gap:5px;
  margin-bottom:14px;
  padding:4px;
  display:flex}
.appearance-tabs button {
  color:var(--muted);
  background:0 0;
  border:0;
  border-radius:7px;
  flex:1;
  padding:9px;
  font-weight:700}
.appearance-tabs button.on {
  background:var(--card);
  color:var(--primary);
  box-shadow:var(--shadow-sm)}
.theme-editor {
  flex-direction:column;
  gap:16px;
  display:flex}
.theme-grid {
  grid-template-columns:repeat(auto-fill,minmax(80px,1fr));
  gap:10px;
  display:grid}
.theme-grid button {
  background:var(--bg);
  color:var(--text);
  cursor:pointer;
  transition:all var(--dur-fast) var(--ease-standard);
  border:2px solid #0000;
  border-radius:12px;
  flex-direction:column;
  align-items:center;
  gap:6px;
  padding:14px 10px;
  display:flex}
.theme-grid button:hover {
  border-color:var(--border)}
.theme-grid button.on {
  border-color:var(--primary);
  background:var(--primary-soft)}
.theme-dot {
  width:36px;
  height:36px;
  box-shadow:0 0 0 2px #fff,0 0 0 3px var(--border);
  border-radius:50%}
.theme-name {
  font-size:12px;
  font-weight:600}
.custom-color-picker {
  border:1px dashed var(--border);
  background:var(--bg);
  border-radius:10px;
  padding:10px}
.custom-color-picker label {
  color:var(--text);
  align-items:center;
  gap:10px;
  display:flex}
.custom-color-picker input {
  cursor:pointer;
  border:none;
  border-radius:8px;
  width:44px;
  height:44px}
.divider {
  background:var(--border);
  height:1px;
  margin:4px 0}
.wallpaper-layout {
  grid-template-columns:145px 1fr;
  gap:15px;
  display:grid}
.target-list {
  flex-direction:column;
  gap:5px;
  display:flex}
.target-list button,.mode-row button {
  background:var(--bg);
  color:var(--muted);
  text-align:left;
  border:1px solid #0000;
  border-radius:8px;
  padding:9px 11px}
.target-list button.on,.mode-row button.on {
  border-color:var(--primary);
  background:var(--primary-soft);
  color:var(--primary);
  font-weight:700}
.wallpaper-editor {
  flex-direction:column;
  gap:12px;
  display:flex}
.mode-row {
  gap:6px;
  display:flex}
.mode-row button {
  text-align:center}
.enable-row {
  align-items:center;
  color:var(--text)!important;
  gap:7px!important;
  display:flex!important}
.wallpaper-preview {
  background:var(--border);
  border-radius:10px;
  min-height:200px;
  position:relative;
  overflow:hidden}
.preview-image {
  transition:filter var(--dur-base) var(--ease-standard);
  background-position:50%;
  background-repeat:no-repeat;
  background-size:cover;
  position:absolute;
  top:0;
  bottom:0;
  left:0;
  right:0}
.preview-overlay {
  background:var(--bg);
  position:absolute;
  top:0;
  bottom:0;
  left:0;
  right:0}
.preview-card {
  -webkit-backdrop-filter:blur(4px);
  backdrop-filter:blur(4px);
  color:#1f2937;
  background:#ffffffe6;
  border-radius:8px;
  padding:8px 12px;
  position:absolute;
  bottom:12px;
  left:12px}
.preview-card b {
  font-size:13px;
  display:block}
.preview-card span {
  color:#6b7280;
  font-size:11px;
  display:block}
.upload-row {
  gap:8px;
  display:flex}
.file-button {
  background:var(--primary);
  color:var(--on-primary,#fff);
  cursor:pointer;
  transition:transform var(--dur-instant) var(--ease-standard), background var(--dur-fast) var(--ease-standard);
  border-radius:8px;
  flex:1;
  justify-content:center;
  align-items:center;
  padding:11px 14px;
  font-weight:600;
  display:flex}
.file-button:active {
  transform:scale(.97)}
.control-grid {
  grid-template-columns:1fr 1fr;
  gap:8px;
  display:grid}
.control-grid>label {
  border:1px solid var(--border);
  background:var(--bg);
  color:var(--text);
  border-radius:8px;
  align-items:center;
  gap:8px;
  padding:8px 10px;
  display:flex}
.control-grid>label>b {
  color:var(--muted);
  margin-left:auto;
  font-size:11px}
.control-grid>label input[type=range] {
  background:var(--border);
  -webkit-appearance:none;
  border-radius:2px;
  flex:1;
  height:4px}
.control-grid>label input[type=range]::-webkit-slider-thumb {
  -webkit-appearance:none;
  background:var(--primary);
  cursor:pointer;
  border-radius:50%;
  width:16px;
  height:16px}
.control-grid>label select {
  border:1px solid var(--border);
  background:var(--card);
  color:var(--text);
  border-radius:6px;
  flex:1;
  padding:6px 10px}
.wallpaper-actions {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:8px;
  flex-direction:column;
  gap:8px;
  padding:10px;
  display:flex}
.action-hint {
  color:var(--muted);
  margin-top:2px;
  font-size:11px;
  display:block}
.color-row {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:8px;
  align-items:center;
  gap:8px;
  padding:8px 10px;
  display:flex}
.color-swatch {
  border:1px solid var(--border);
  border-radius:4px;
  width:24px;
  height:24px}
.color-row input {
  cursor:pointer;
  background:0 0;
  border:none;
  border-radius:4px;
  width:32px;
  height:32px;
  padding:0}
.quotes-editor {
  flex-direction:column;
  gap:12px;
  display:flex}
.quote-row {
  grid-template-columns:1fr 1fr;
  gap:8px;
  display:grid}
.quotes-editor textarea {
  border:1px solid var(--border);
  background:var(--bg);
  width:100%;
  color:var(--text);
  resize:vertical;
  border-radius:8px;
  padding:10px;
  font-family:inherit}
.quotes-editor input[type=text] {
  border:1px solid var(--border);
  background:var(--bg);
  width:100%;
  color:var(--text);
  border-radius:6px;
  padding:8px 10px}
.layout-editor {
  flex-direction:column;
  gap:12px;
  display:flex}
.layout-editor>div>p {
  color:var(--muted);
  margin:4px 0 8px;
  font-size:12px}
.module-sort>div {
  border:1px solid var(--border);
  background:var(--bg);
  cursor:move;
  border-radius:8px;
  grid-template-columns:22px 1fr auto 30px 30px;
  align-items:center;
  gap:8px;
  padding:8px 10px;
  display:grid}

.module-sort label {
  font-size:12px}
.module-sort button {
  border:1px solid var(--border);
  background:var(--bg);
  color:var(--muted);
  border-radius:4px;
  padding:4px 8px}
.module-sort button:disabled {
  opacity:.3}
.skin-options {
  grid-template-columns:repeat(3,1fr);
  gap:8px;
  display:grid}
.skin-options label {
  background:var(--bg);
  color:var(--text);
  cursor:pointer;
  transition:all var(--dur-fast) var(--ease-standard);
  border:2px solid #0000;
  border-radius:10px;
  flex-direction:column;
  align-items:center;
  gap:6px;
  padding:14px 10px;
  display:flex}
.skin-options label:hover {
  border-color:var(--border)}
.skin-options label.on {
  border-color:var(--primary);
  background:var(--primary-soft)}
.skin-options label span {
  font-size:20px}
.swipe-editor {
  flex-direction:column;
  gap:16px;
  display:flex}
.swipe-intro h4 {
  margin:0 0 4px}
.swipe-intro p {
  color:var(--muted);
  margin:0;
  font-size:12px}
.swipe-category {
  border:1px solid var(--border);
  background:var(--bg);
  border-radius:10px;
  flex-direction:column;
  gap:8px;
  padding:12px;
  display:flex}
.swipe-category-header {
  align-items:center;
  gap:10px;
  display:flex}
.swipe-category-icon {
  font-size:20px}
.swipe-category-header b {
  display:block}
.swipe-category-header span {
  color:var(--muted);
  font-size:12px;
  display:block}
.swipe-direction-row {
  grid-template-columns:1fr 1fr;
  gap:12px;
  display:grid}
.swipe-action-card {
  border:1px solid var(--border);
  background:var(--card);
  border-radius:8px;
  flex-direction:column;
  gap:8px;
  padding:12px;
  display:flex}
.swipe-action-title {
  color:var(--text);
  font-size:13px;
  font-weight:600}
.swipe-action-select-wrap {
  align-items:center;
  display:flex}
.swipe-action-select {
  background:var(--bg);
  color:var(--text);
  cursor:pointer;
  transition:border-color var(--dur-fast) var(--ease-standard);
  border:2px solid #0000;
  border-radius:6px;
  flex:1;
  padding:8px 10px;
  font-weight:600}
.swipe-action-select:hover {
  border-color:var(--border)}
.privacy-note {
  color:var(--muted);
  text-align:center;
  margin:8px 0 0;
  font-size:11px}
@media (max-width:760px) {
  .appearance-tabs {
  grid-template-columns:1fr 1fr;
  display:grid}
.wallpaper-layout {
  grid-template-columns:1fr}
.target-list {
  flex-direction:row;
  overflow-x:auto}
.target-list button {
  white-space:nowrap}
.control-grid,.quote-row,.skin-options {
  grid-template-columns:1fr}
.module-sort>div {
  grid-template-columns:22px 1fr auto 30px 30px}
.wallpaper-preview {
  min-height:180px}
.swipe-direction-row {
  grid-template-columns:1fr}
.theme-grid {
  grid-template-columns:repeat(3,1fr)}
.upload-row {
  flex-direction:column}
.file-button {
  justify-content:center;
  width:100%}
}
.module-sort {
  flex-direction:column;
  gap:7px;
  display:flex}
.module-row {
  border:1px solid var(--border);
  background:var(--bg);
  transition:box-shadow var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
  border-radius:9px;
  align-items:center;
  gap:8px;
  padding:2px;
  display:flex}
.module-row.dragging {
  border-color:var(--primary);
  box-shadow:0 4px 14px #456fe82e}
.module-row-main {
  min-height:40px;
  color:var(--text);
  cursor:pointer;
  flex:1;
  justify-content:space-between;
  align-items:center;
  padding:0 10px;
  font-size:13px;
  display:flex}
.module-row-main input {
  width:18px;
  height:18px;
  accent-color:var(--primary)}
.module-drag {
  width:36px;
  min-height:40px;
  color:var(--muted);
  background:var(--bg-tint);
  cursor:grab;
  touch-action:none;
  border:0;
  border-radius:7px;
  place-items:center;
  font-size:18px;
  display:grid}
.module-drag:hover {
  color:var(--primary);
  background:var(--primary-soft)}
.module-reset {
  align-self:flex-start;
  margin-top:2px;
  padding:6px 12px;
  font-size:12px}
.performance-row {
  border:1px solid var(--border);
  background:var(--bg);
  color:var(--text);
  border-radius:8px;
  justify-content:space-between;
  align-items:center;
  gap:12px;
  padding:10px;
  font-size:12px;
  display:flex}
.performance-row span {
  flex-direction:column;
  gap:3px;
  display:flex}
.performance-row small {
  color:var(--muted);
  line-height:1.45}
.performance-row select {
  flex:none;
  padding:6px 8px}
.schedule-style {
  flex-direction:column;
  gap:10px;
  display:flex}
.schedule-style>div:first-child {
  flex-direction:column;
  gap:3px;
  display:flex}
.schedule-style small {
  color:var(--muted);
  font-size:12px}

</style>




