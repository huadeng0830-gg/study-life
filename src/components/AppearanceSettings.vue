<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { appearance, HOME_MODULES, resetAppearanceState, WALLPAPER_TARGETS, wallpaperConfig } from '../composables/appearance.js'
import { autoWallpaperColor, themeKey, wallpaperAccent } from '../composables/theme.js'
import { clearAllWallpapers, compressWallpaper, getWallpaper, removeWallpaper, setWallpaper, wallpaperRevision } from '../composables/wallpaperStorage.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const tab = ref('wallpaper')
const selectedTarget = ref('global')
const previewUrl = ref('')
const hasOwnImage = ref(false)
const imageInfo = ref('')
const busy = ref(false)
const error = ref('')
const message = ref('')
const quoteDraft = ref('')
const draggedModule = ref('')

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
  tab.value = 'wallpaper'
  quoteDraft.value = appearance.value.quotes.join('\n')
  error.value = ''
  message.value = ''
  loadPreview()
})
watch([selectedTarget, wallpaperRevision], loadPreview)

onBeforeUnmount(() => previewUrl.value && URL.revokeObjectURL(previewUrl.value))

async function loadPreview() {
  const target = selectedTarget.value
  const source = target !== 'global' && targetConfig.value.mode === 'inherit' ? 'global' : target
  try {
    const blob = await getWallpaper(source)
    const previous = previewUrl.value
    previewUrl.value = blob ? URL.createObjectURL(blob) : ''
    hasOwnImage.value = Boolean(await getWallpaper(target))
    imageInfo.value = blob ? `${Math.max(1, Math.round(blob.size / 1024))} KB · 仅本机` : ''
    if (previous) URL.revokeObjectURL(previous)
  } catch {
    previewUrl.value = ''
    hasOwnImage.value = false
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
  if (!window.confirm('确定恢复初始外观吗？本机壁纸、励志语、首页排序和页面皮肤都会重置，课程与待办等业务数据不受影响。')) return
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

function saveQuotes() {
  const lines = quoteDraft.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50)
  appearance.value.quotes = lines.length ? lines : ['今天也要漂亮通关。']
  appearance.value.fixedQuoteIndex = Math.min(appearance.value.fixedQuoteIndex, appearance.value.quotes.length - 1)
  quoteDraft.value = appearance.value.quotes.join('\n')
  message.value = `已保存 ${appearance.value.quotes.length} 条文字`
}

function moveModule(id, direction) {
  const list = appearance.value.homeModules
  const index = list.findIndex((item) => item.id === id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= list.length) return
  const copy = [...list]
  ;[copy[index], copy[next]] = [copy[next], copy[index]]
  appearance.value.homeModules = copy
}

function dropModule(targetId) {
  const sourceId = draggedModule.value
  if (!sourceId || sourceId === targetId) return
  const list = [...appearance.value.homeModules]
  const sourceIndex = list.findIndex((item) => item.id === sourceId)
  const targetIndex = list.findIndex((item) => item.id === targetId)
  const [item] = list.splice(sourceIndex, 1)
  list.splice(targetIndex, 0, item)
  appearance.value.homeModules = list
  draggedModule.value = ''
}

function moduleLabel(id) {
  return HOME_MODULES.find((item) => item.id === id)?.label ?? id
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
    <div class="appearance-tabs"><button :class="{ on: tab === 'wallpaper' }" @click="tab = 'wallpaper'">本地壁纸</button><button :class="{ on: tab === 'quotes' }" @click="tab = 'quotes'">励志语与签名</button><button :class="{ on: tab === 'layout' }" @click="tab = 'layout'">页面布局</button></div>
    <div class="reset-row"><span>恢复后只重置外观，不会删除课程、待办和账单。</span><button class="reset-button" :disabled="busy" @click="resetAllAppearance">恢复初始外观</button></div>

    <div v-if="tab === 'wallpaper'" class="wallpaper-layout">
      <aside class="target-list"><button v-for="(target, key) in WALLPAPER_TARGETS" :key="key" :class="{ on: selectedTarget === key }" @click="chooseTarget(key)">{{ target.label }}</button></aside>
      <section class="wallpaper-editor">
        <div v-if="!isGlobal" class="mode-row"><button :class="{ on: targetConfig.mode === 'inherit' }" @click="setPageMode('inherit')">跟随全站</button><button :class="{ on: targetConfig.mode === 'own' }" @click="setPageMode('own')">单独设置</button><button :class="{ on: targetConfig.mode === 'none' }" @click="setPageMode('none')">此页关闭</button></div>
        <label v-else class="enable-row"><input v-model="targetConfig.enabled" type="checkbox" /> 启用全站默认壁纸</label>

        <div class="wallpaper-preview"><div class="preview-image" :style="previewStyle"></div><div class="preview-overlay" :style="{ opacity: previewSettings.overlay / 100 }"></div><div class="preview-card"><b>{{ WALLPAPER_TARGETS[selectedTarget].label }}</b><span>{{ previewUrl ? imageInfo : '尚未选择图片' }}</span></div></div>

        <template v-if="ownMode">
          <div class="upload-row"><label class="file-button">{{ busy ? '正在压缩…' : '选择本机图片' }}<input type="file" accept="image/*" :disabled="busy" @change="uploadImage" /></label><button v-if="hasOwnImage" class="btn btn-danger" @click="removeImage">删除壁纸</button></div>
          <div class="control-grid">
            <label>模糊 <b>{{ targetConfig.blur }}px</b><input v-model.number="targetConfig.blur" type="range" min="0" max="20" /></label>
            <label>亮度 <b>{{ targetConfig.brightness }}%</b><input v-model.number="targetConfig.brightness" type="range" min="50" max="130" /></label>
            <label>遮罩 <b>{{ targetConfig.overlay }}%</b><input v-model.number="targetConfig.overlay" type="range" min="0" max="70" /></label>
            <label>透明度 <b>{{ targetConfig.opacity }}%</b><input v-model.number="targetConfig.opacity" type="range" min="20" max="100" /></label>
            <label>显示位置<select v-model="targetConfig.position"><option value="center center">居中</option><option value="center top">顶部</option><option value="center bottom">底部</option><option value="left center">靠左</option><option value="right center">靠右</option></select></label>
            <label>图片适应<select v-model="targetConfig.fit"><option value="auto">智能适应（推荐）</option><option value="cover">始终铺满</option><option value="contain">始终完整显示</option></select></label>
          </div>
        </template>

        <div class="color-row"><label><input v-model="autoWallpaperColor" type="checkbox" /> 使用壁纸自动取色</label><span class="color-swatch" :style="{ background: wallpaperAccent }"></span><input v-model="wallpaperAccent" type="color" aria-label="壁纸主题色" /></div>
        <p class="privacy-note">图片会先在本机压缩，再保存到当前设备；不会上传服务器。二维码迁移时可单独选择是否携带壁纸。</p>
      </section>
    </div>

    <section v-else-if="tab === 'quotes'" class="quotes-editor">
      <label class="enable-row"><input v-model="appearance.showQuote" type="checkbox" /> 在首页显示个性化文字</label>
      <label>励志语（每行一条，最多 50 条）<textarea v-model="quoteDraft" rows="9" placeholder="今天也要漂亮通关。"></textarea></label>
      <div class="quote-row"><label>显示方式<select v-model="appearance.quoteMode"><option value="daily">每天轮换</option><option value="random">每次打开随机</option><option value="fixed">固定一条</option></select></label><label v-if="appearance.quoteMode === 'fixed'">固定显示<select v-model.number="appearance.fixedQuoteIndex"><option v-for="(quote, index) in appearance.quotes" :key="index" :value="index">{{ quote }}</option></select></label></div>
      <label>个人签名<input v-model="appearance.signature" maxlength="40" placeholder="例如：保持好奇，慢慢变强" /></label>
      <button class="btn btn-primary" @click="saveQuotes">保存文字</button>
    </section>

    <section v-else class="layout-editor">
      <div><h4>首页模块</h4><p>拖动调整顺序；手机也可以使用上下按钮。</p></div>
      <div class="module-sort"><div v-for="(module, index) in appearance.homeModules" :key="module.id" draggable="true" @dragstart="draggedModule = module.id" @dragover.prevent @drop="dropModule(module.id)"><span class="drag">⠿</span><b>{{ moduleLabel(module.id) }}</b><label><input v-model="module.visible" type="checkbox" /> 显示</label><button :disabled="index === 0" @click="moveModule(module.id, -1)">↑</button><button :disabled="index === appearance.homeModules.length - 1" @click="moveModule(module.id, 1)">↓</button></div></div>
      <div><h4>课表皮肤</h4><p>只改变课表视觉，不影响课程数据。</p></div>
      <div class="skin-options"><label v-for="skin in [{id:'classic',name:'经典表格',icon:'▦'},{id:'notebook',name:'校园笔记',icon:'📒'},{id:'timeline',name:'极简时间轴',icon:'⌁'}]" :key="skin.id" :class="{ on: appearance.scheduleSkin === skin.id }"><input v-model="appearance.scheduleSkin" type="radio" :value="skin.id" /><span>{{ skin.icon }}</span><b>{{ skin.name }}</b></label></div>
    </section>

    <p v-if="message" class="success">{{ message }}</p><p v-if="error" class="error">{{ error }}</p>
  </Modal>
</template>

<style scoped>
.appearance-tabs{display:flex;gap:5px;margin-bottom:14px;padding:4px;border-radius:10px;background:var(--bg)}.appearance-tabs button{flex:1;padding:9px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-weight:700}.appearance-tabs button.on{background:#fff;color:var(--primary);box-shadow:var(--shadow-sm)}.wallpaper-layout{display:grid;grid-template-columns:145px 1fr;gap:15px}.target-list{display:flex;flex-direction:column;gap:5px}.target-list button,.mode-row button{padding:9px 11px;border:1px solid transparent;border-radius:8px;background:var(--bg);color:var(--muted);text-align:left}.target-list button.on,.mode-row button.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:700}.wallpaper-editor{display:flex;flex-direction:column;gap:12px}.mode-row{display:flex;gap:6px}.mode-row button{text-align:center}.enable-row{display:flex!important;align-items:center;gap:7px!important;color:var(--text)!important}.wallpaper-preview{position:relative;min-height:220px;overflow:hidden;border:1px solid var(--border);border-radius:15px;background:linear-gradient(135deg,#e8edf8,#cdd8ee)}.preview-image{position:absolute;inset:-10px;background-repeat:no-repeat}.preview-overlay{position:absolute;inset:0;background:#071020}.preview-card{position:absolute;left:18px;bottom:18px;display:flex;flex-direction:column;gap:3px;padding:12px 16px;border:1px solid rgba(255,255,255,.4);border-radius:11px;background:rgba(255,255,255,.83);backdrop-filter:blur(9px)}.preview-card span{color:var(--muted);font-size:10px}.upload-row{display:flex;gap:8px}.file-button{display:inline-flex;align-items:center;padding:9px 14px;border-radius:8px;background:var(--primary);color:#fff;font-size:12px;font-weight:700;cursor:pointer}.file-button input{display:none}.control-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.control-grid label,.quotes-editor>label,.quote-row label{display:flex;flex-direction:column;gap:5px;color:var(--muted);font-size:11px}.control-grid label b{margin-left:auto;color:var(--text)}.control-grid input[type=range]{width:100%;padding:0}.color-row{display:flex;align-items:center;gap:8px;padding:10px;border-radius:9px;background:var(--bg);font-size:12px}.color-row label{display:flex;align-items:center;gap:6px;margin-right:auto}.color-row input[type=color]{width:34px;height:28px;padding:2px}.color-swatch{width:25px;height:25px;border-radius:50%;box-shadow:0 0 0 2px #fff,0 0 0 3px var(--border)}.privacy-note{color:var(--muted);font-size:10px;line-height:1.55}.quotes-editor,.layout-editor{display:flex;flex-direction:column;gap:13px}.quotes-editor textarea,.quotes-editor input,.quotes-editor select{width:100%}.quotes-editor>.btn{align-self:flex-start}.quote-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.layout-editor h4{font-size:13px}.layout-editor p{margin-top:3px;color:var(--muted);font-size:10px}.module-sort{display:flex;flex-direction:column;gap:6px}.module-sort>div{display:grid;grid-template-columns:25px 1fr auto 32px 32px;align-items:center;gap:7px;padding:9px;border:1px solid var(--border);border-radius:9px;background:#fff}.module-sort b{font-size:11px}.module-sort label{display:flex;align-items:center;gap:5px;font-size:10px}.module-sort button{height:28px;border:0;border-radius:6px;background:var(--bg)}.drag{color:var(--muted);cursor:grab}.skin-options{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.skin-options label{display:flex;flex-direction:column;align-items:center;gap:5px;padding:13px;border:1px solid var(--border);border-radius:10px;cursor:pointer}.skin-options label.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}.skin-options input{display:none}.skin-options span{font-size:23px}.skin-options b{font-size:11px}.success{margin-top:10px;color:#087a58;font-size:11px}.error{margin-top:10px;color:var(--danger);font-size:11px}
.reset-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-4px 0 14px;padding:8px 10px;border-radius:8px;background:#fff8f1}.reset-row span{color:#8a6845;font-size:10px}.reset-button{padding:6px 9px;border:1px solid #e9c9aa;border-radius:7px;background:#fff;color:#a35e22;font-size:10px;font-weight:700;white-space:nowrap}.reset-button:disabled{opacity:.5}
@media(max-width:700px){.wallpaper-layout{grid-template-columns:1fr}.target-list{flex-direction:row;overflow-x:auto}.target-list button{white-space:nowrap}.control-grid,.quote-row{grid-template-columns:1fr}.skin-options{grid-template-columns:1fr}.module-sort>div{grid-template-columns:22px 1fr auto 30px 30px}.wallpaper-preview{min-height:180px}}
</style>
