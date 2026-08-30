<script setup>
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { appearance, HOME_MODULES, resetAppearanceState, resetWallpapersOnly, WALLPAPER_TARGETS, wallpaperConfig } from '../composables/appearance.js'
import { autoWallpaperColor, themeKey, wallpaperAccent, customThemeColor, THEMES } from '../composables/theme.js'
import { performanceMode } from '../composables/performanceMode.js'
import { clearAllWallpapers, compressWallpaper, getWallpaper, removeWallpaper, setWallpaper, wallpaperRevision } from '../composables/wallpaperStorage.js'

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
      success: { bg: '#e7f8f1', border: '#14966d', text: '#07805d' },
      primary: { bg: '#edf2ff', border: '#456fe8', text: '#365fd2' },
      danger: { bg: '#feecec', border: '#ef4444', text: '#c0392b' },
      muted: { bg: '#f3f4f6', border: '#9ca3af', text: '#6b7280' },
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

const tab = ref('theme')
const selectedTarget = ref('global')
const previewUrl = ref('')
const hasOwnImage = ref(false)
const imageInfo = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
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
  // 用户真正切到壁纸页时才做这些 I/O，避免点击个性化时卡住。
  tab.value = 'theme'
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
})

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
  try {
    const result = await compressWallpaper(file)
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
  }
}

async function resetAllAppearance() {
  if (!window.confirm('确定恢复初始外观吗？本机壁纸、励志语、首页排序、页面皮肤和滑动操作都会重置，课程与待办等业务数据不受影响。')) return
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

async function removeImage() {
  if (!hasOwnImage.value || !window.confirm('确定删除这个页面的本地壁纸吗？')) return
  await removeWallpaper(selectedTarget.value)
  if (isGlobal.value) targetConfig.value.enabled = false
  else targetConfig.value.mode = 'inherit'
  message.value = '壁纸已删除'
  await loadPreview()
}

async function resetCurrentWallpaper() {
  if (!window.confirm('确定恢复当前页面壁纸为默认设置吗？')) return
  if (isGlobal.value) {
    targetConfig.value.enabled = false
  } else {
    targetConfig.value.mode = 'inherit'
  }
  await removeWallpaper(selectedTarget.value)
  message.value = '当前页面壁纸已恢复默认'
  await loadPreview()
}

async function resetAllWallpapers() {
  if (!window.confirm('确定恢复所有页面的壁纸为默认设置吗？这会删除所有自定义壁纸图片。')) return
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
  <Modal :open="open" title="🎨 个性化外观" wide @close="emit('close')">
    <div class="appearance-tabs"><button :class="{ on: tab === 'theme' }" @click="tab = 'theme'">主题与课表</button><button :class="{ on: tab === 'wallpaper' }" @click="tab = 'wallpaper'">本地壁纸</button><button :class="{ on: tab === 'quotes' }" @click="tab = 'quotes'">今天页文字</button><button :class="{ on: tab === 'layout' }" @click="tab = 'layout'">首页布局</button><button :class="{ on: tab === 'swipe' }" @click="tab = 'swipe'">滑动操作</button></div>
    <div v-if="tab === 'theme'" class="theme-editor">
      <div class="theme-grid">
        <label v-for="(theme, key) in THEMES" :key="key" :class="{ on: themeKey === key }">
          <span class="theme-dot" :style="{ background: theme.primary || 'transparent', border: theme.primary ? 'none' : '2px dashed var(--border)' }"></span>
          <span class="theme-name">{{ theme.name }}</span>
        </label>
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
      <div class="divider"></div>
      <div class="schedule-style"><div><b>课表显示</b><small>只改变课程表视觉，不影响课程数据。</small></div><div class="skin-options"><label v-for="skin in [{id:'classic',name:'经典表格',icon:'▦'},{id:'notebook',name:'校园笔记',icon:'📒'},{id:'timeline',name:'极简时间轴',icon:'⌁'}]" :key="skin.id" :class="{ on: appearance.scheduleSkin === skin.id }"><input v-model="appearance.scheduleSkin" type="radio" :value="skin.id" /><span>{{ skin.icon }}</span><b>{{ skin.name }}</b></label></div></div>
    </div>

    <div v-else-if="tab === 'wallpaper'" class="wallpaper-layout">
      <aside class="target-list"><button v-for="(target, key) in WALLPAPER_TARGETS" :key="key" :class="{ on: selectedTarget === key }" @click="chooseTarget(key)">{{ target.label }}</button></aside>
      <section class="wallpaper-editor">
        <div v-if="!isGlobal" class="mode-row"><button :class="{ on: targetConfig.mode === 'inherit' }" @click="setPageMode('inherit')">跟随全站</button><button :class="{ on: targetConfig.mode === 'own' }" @click="setPageMode('own')">单独设置</button><button :class="{ on: targetConfig.mode === 'none' }" @click="setPageMode('none')">此页关闭</button></div>
        <label v-else class="enable-row"><input v-model="targetConfig.enabled" type="checkbox" /> 启用全站默认壁纸</label>

        <div class="wallpaper-preview"><div class="preview-image" :style="previewStyle"></div><div class="preview-overlay" :style="{ opacity: previewSettings.overlay / 100 }"></div><div class="preview-card"><b>{{ WALLPAPER_TARGETS[selectedTarget].label }}</b><span>{{ previewUrl ? imageInfo : '尚未选择图片' }}</span></div></div>

        <template v-if="ownMode">
          <div class="upload-row">
            <label class="file-button primary">
              <input type="file" accept="image/*" :disabled="busy" @change="uploadImage" hidden />
              <span v-if="busy">🔄 压缩中…</span>
              <span v-else>📷 上传照片</span>
            </label>
            <button v-if="hasOwnImage" class="btn btn-danger" @click="removeImage">删除壁纸</button>
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

    <section v-else-if="tab === 'quotes'" class="quotes-editor">
      <label class="enable-row"><input v-model="appearance.showQuote" type="checkbox" /> 在“今天”页显示个性化文字</label>
      <label>励志语（每行一条，最多 50 条）<textarea v-model="quoteDraft" rows="9" placeholder="今天也要漂亮通关。"></textarea></label>
      <div class="quote-row"><label>显示方式<select v-model="appearance.quoteMode"><option value="daily">每天轮换</option><option value="random">每次打开随机</option><option value="fixed">固定一条</option></select></label><label v-if="appearance.quoteMode === 'fixed'">固定显示<select v-model.number="appearance.fixedQuoteIndex"><option v-for="(quote, index) in appearance.quotes" :key="index" :value="index">{{ quote }}</option></select></label></div>
      <label>个人签名<input v-model="appearance.signature" maxlength="40" placeholder="例如：保持好奇，慢慢变强" /></label>
      <button class="btn btn-primary" @click="saveQuotes">保存文字</button>
    </section>

    <section v-else-if="tab === 'layout'" class="layout-editor">
      <div><h4>今天页模块</h4><p>隐藏模块不会删除数据，随时可以恢复。</p></div>
      <div class="module-sort">
        <label v-for="module in appearance.homeModules" :key="module.id" class="toggle-row"><span>{{ HOME_MODULES.find(item => item.id === module.id)?.label || module.id }}</span><input v-model="module.visible" type="checkbox" /></label>
      </div>
    </section>

    <section v-else class="swipe-editor">
      <div class="swipe-intro"><h4>手机左右滑动</h4><p>滑过约三分之一张卡片才会执行，删除还会再次确认；电脑端原有点击操作不变。</p></div>

      <div class="swipe-category">
        <div class="swipe-category-header">
          <span class="swipe-category-icon">✅</span>
          <div>
            <b>作业与待办</b>
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
            <b>我的清单</b>
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

    <p v-if="message" class="success">{{ message }}</p><p v-if="error" class="error">{{ error }}</p>
  </Modal>
</template>

<style scoped>
.appearance-tabs{display:flex;gap:5px;margin-bottom:14px;padding:4px;border-radius:10px;background:var(--bg)}.appearance-tabs button{flex:1;padding:9px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-weight:700}.appearance-tabs button.on{background:#fff;color:var(--primary);box-shadow:var(--shadow-sm)}.theme-editor{display:flex;flex-direction:column;gap:16px}.theme-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px}.theme-grid label{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:2px solid transparent;border-radius:12px;background:var(--bg);color:var(--text);cursor:pointer;transition:all .15s}.theme-grid label:hover{border-color:var(--border)}.theme-grid label.on{border-color:var(--primary);background:var(--primary-soft)}.theme-dot{width:36px;height:36px;border-radius:50%;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--border)}.theme-name{font-size:12px;font-weight:600}.custom-color-picker{padding:10px;border:1px dashed var(--border);border-radius:10px;background:var(--bg)}.custom-color-picker label{display:flex;align-items:center;gap:10px;color:var(--text)}.custom-color-picker input{width:44px;height:44px;border:none;border-radius:8px;cursor:pointer}.divider{height:1px;background:var(--border);margin:4px 0}.wallpaper-layout{display:grid;grid-template-columns:145px 1fr;gap:15px}.target-list{display:flex;flex-direction:column;gap:5px}.target-list button,.mode-row button{padding:9px 11px;border:1px solid transparent;border-radius:8px;background:var(--bg);color:var(--muted);text-align:left}.target-list button.on,.mode-row button.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:700}.wallpaper-editor{display:flex;flex-direction:column;gap:12px}.mode-row{display:flex;gap:6px}.mode-row button{text-align:center}.enable-row{display:flex!important;align-items:center;gap:7px!important;color:var(--text)!important}.wallpaper-preview{position:relative;min-height:200px;border-radius:10px;overflow:hidden;background:var(--border)}.preview-image{position:absolute;inset:0;background-size:cover;background-position:center;background-repeat:no-repeat;transition:filter .2s}.preview-overlay{position:absolute;inset:0;background:var(--bg)}.preview-card{position:absolute;bottom:12px;left:12px;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,.9);backdrop-filter:blur(4px);color:#1f2937}.preview-card b{display:block;font-size:13px}.preview-card span{display:block;font-size:11px;color:#6b7280}.upload-row{display:flex;gap:8px}.file-button{flex:1;display:flex;align-items:center;justify-content:center;padding:11px 14px;border-radius:8px;background:var(--primary);color:#fff;cursor:pointer;font-weight:600;transition:transform .1s,background .15s}.file-button:active{transform:scale(.97)}.control-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.control-grid>label{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text)}.control-grid>label>b{margin-left:auto;font-size:11px;color:var(--muted)}.control-grid>label input[type="range"]{flex:1;height:4px;background:var(--border);border-radius:2px;-webkit-appearance:none}.control-grid>label input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--primary);cursor:pointer}.control-grid>label select{flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text)}.wallpaper-actions{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}.action-hint{display:block;font-size:11px;color:var(--muted);margin-top:2px}.color-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg)}.color-swatch{width:24px;height:24px;border-radius:4px;border:1px solid var(--border)}.color-row input{width:32px;height:32px;padding:0;border:none;border-radius:4px;background:transparent;cursor:pointer}.quotes-editor{display:flex;flex-direction:column;gap:12px}.quote-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.quotes-editor textarea{width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);resize:vertical;font-family:inherit}.quotes-editor input[type="text"]{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)}.layout-editor{display:flex;flex-direction:column;gap:12px}.layout-editor>div>p{margin:4px 0 8px;color:var(--muted);font-size:12px}.module-sort{display:flex;flex-direction:column;gap:4px}.module-sort>div{display:grid;grid-template-columns:22px 1fr auto 30px 30px;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);cursor:move}.module-sort .drag{color:var(--muted);font-size:12px}.module-sort label{font-size:12px}.module-sort button{padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--muted)}.module-sort button:disabled{opacity:.3}.skin-options{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.skin-options label{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border:2px solid transparent;border-radius:10px;background:var(--bg);color:var(--text);cursor:pointer;transition:all .15s}.skin-options label:hover{border-color:var(--border)}.skin-options label.on{border-color:var(--primary);background:var(--primary-soft)}.skin-options label span{font-size:20px}.swipe-editor{display:flex;flex-direction:column;gap:16px}.swipe-intro h4{margin:0 0 4px}.swipe-intro p{margin:0;color:var(--muted);font-size:12px}.swipe-category{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg)}.swipe-category-header{display:flex;align-items:center;gap:10px}.swipe-category-icon{font-size:20px}.swipe-category-header b{display:block}.swipe-category-header span{display:block;color:var(--muted);font-size:12px}.swipe-direction-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.swipe-action-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card)}.swipe-action-title{font-size:13px;font-weight:600;color:var(--text)}.swipe-action-select-wrap{display:flex;align-items:center}.swipe-action-select{flex:1;padding:8px 10px;border:2px solid transparent;border-radius:6px;background:var(--bg);color:var(--text);font-weight:600;cursor:pointer;transition:border-color .15s}.swipe-action-select:hover{border-color:var(--border)}.privacy-note{margin:8px 0 0;color:var(--muted);font-size:11px;text-align:center}@media(max-width:700px){.appearance-tabs{display:grid;grid-template-columns:1fr 1fr}.wallpaper-layout{grid-template-columns:1fr}.target-list{flex-direction:row;overflow-x:auto}.target-list button{white-space:nowrap}.control-grid,.quote-row{grid-template-columns:1fr}.skin-options{grid-template-columns:1fr}.module-sort>div{grid-template-columns:22px 1fr auto 30px 30px}.wallpaper-preview{min-height:180px}.swipe-direction-row{grid-template-columns:1fr}.theme-grid{grid-template-columns:repeat(3,1fr)}.upload-row{flex-direction:column}.file-button{width:100%;justify-content:center}}
</style>

<style scoped>
.module-sort .toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;cursor:pointer}.module-sort .toggle-row input{width:18px;height:18px;accent-color:var(--primary)}
</style>

<style scoped>
.performance-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 12px; }
.performance-row span { display: flex; flex-direction: column; gap: 3px; }
.performance-row small { color: var(--muted); line-height: 1.45; }
.performance-row select { flex: 0 0 auto; padding: 6px 8px; }
.schedule-style { display: flex; flex-direction: column; gap: 10px; }
.schedule-style > div:first-child { display: flex; flex-direction: column; gap: 3px; }
.schedule-style small { color: var(--muted); font-size: 12px; }
</style>
