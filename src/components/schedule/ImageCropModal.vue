<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { cropCanvasDimensions } from '../../composables/imageCropSizing.js'

const props = defineProps({ show: Boolean, file: { type: Object, default: null } })
const emit = defineEmits(['close', 'confirm'])
const imageUrl = ref('')
const imageEl = ref(null)
const selection = ref({ left: 0, top: 0, right: 100, bottom: 100 })
const dragging = ref(false)
const origin = ref(null)

function resetPreview(file) {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = file ? URL.createObjectURL(file) : ''
  selection.value = { left: 0, top: 0, right: 100, bottom: 100 }
}
watch(() => props.file, resetPreview, { immediate: true })
onBeforeUnmount(() => { if (imageUrl.value) URL.revokeObjectURL(imageUrl.value) })

function point(event) {
  const rect = imageEl.value?.getBoundingClientRect()
  if (!rect) return null
  return {
    x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
    y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)),
  }
}
function begin(event) {
  const start = point(event)
  if (!start) return
  event.currentTarget.setPointerCapture?.(event.pointerId)
  origin.value = start
  dragging.value = true
  selection.value = { left: start.x, top: start.y, right: start.x, bottom: start.y }
}
function move(event) {
  if (!dragging.value || !origin.value) return
  const end = point(event)
  if (!end) return
  selection.value = { left: Math.min(origin.value.x, end.x), top: Math.min(origin.value.y, end.y), right: Math.max(origin.value.x, end.x), bottom: Math.max(origin.value.y, end.y) }
}
function end() { dragging.value = false; origin.value = null }

/* ---------- 键盘操作（第四十七轮，WCAG 2.5.7 / 2.1.1） ----------
   这个弹窗原本只能用鼠标或手指"拖出"选区，键盘用户没有任何替代操作（2.5.7）。
   注意初始选区是**整张图**（resetPreview 里 0/0/100/100），所以"能不能按到裁切按钮"
   不是问题——问题是**改不了**：整图选区宽度 100%，平移会被夹住、也收不小。
   于是按操作的实际需要定语义（收小才是主操作：提示里就写着"排除状态栏、广告"）：
     方向键          整体平移
     Shift + 方向键   把这一边往回收（收小）
     Ctrl  + 方向键   把这一边往外扩（放大）
   如果选区还是那个"没被动过的整图默认值"，第一次按方向键会先播种成一个居中偏上的
   合理子区域（80% × 60%）——否则对着整张图既移不动也收不了，用户只会觉得键盘没反应。
   已经拖过框的选区不会被顶掉：播种只认"恰好等于初始默认值"这一种情况。
   步长 5% 是粗调的量级，配合 4% 的最小尺寸限制不会把框调没。
   读数用可见文本 + aria-live：明眼用户看得到数值变化，读屏用户听得到。 */
const KEY_STEP = 5
const MIN_SIZE = 4
const INITIAL_SELECTION = { left: 0, top: 0, right: 100, bottom: 100 }
const SEEDED_SELECTION = { left: 10, top: 20, right: 90, bottom: 80 }

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const selectionWidth = computed(() => Math.round(selection.value.right - selection.value.left))
const selectionHeight = computed(() => Math.round(selection.value.bottom - selection.value.top))
const selectionReadout = computed(() => `已选区域：左 ${Math.round(selection.value.left)}%、上 ${Math.round(selection.value.top)}%、`
  + `右 ${Math.round(selection.value.right)}%、下 ${Math.round(selection.value.bottom)}%（${selectionWidth.value}% × ${selectionHeight.value}%）`)

/** 选区是否仍是"没被动过的整图"——只有这种情况才播种。 */
function isUntouchedSelection() {
  const crop = selection.value
  return crop.left === INITIAL_SELECTION.left && crop.top === INITIAL_SELECTION.top
    && crop.right === INITIAL_SELECTION.right && crop.bottom === INITIAL_SELECTION.bottom
}

function onStageKeydown(event) {
  const axes = { ArrowLeft: ['x', -1], ArrowRight: ['x', 1], ArrowUp: ['y', -1], ArrowDown: ['y', 1] }
  const axis = axes[event.key]
  if (!axis) return
  // 这个区域用方向键操作，别让页面跟着一起滚
  event.preventDefault()
  // 还是"没被动过的整图"就先播种：对着整张图既移不动也收不了，用户只会觉得键盘没反应
  if (isUntouchedSelection()) selection.value = { ...SEEDED_SELECTION }
  const current = { ...selection.value }
  const [which, direction] = axis
  const grow = event.ctrlKey || event.metaKey
  const shrink = event.shiftKey
  if (!grow && !shrink) {
    // 整体平移，撞边就停住（尺寸不变）
    const width = current.right - current.left
    const height = current.bottom - current.top
    if (which === 'x') {
      current.left = clamp(current.left + direction * KEY_STEP, 0, 100 - width)
      current.right = current.left + width
    } else {
      current.top = clamp(current.top + direction * KEY_STEP, 0, 100 - height)
      current.bottom = current.top + height
    }
  } else if (which === 'x') {
    // 横向：Shift/Ctrl + 左键改左边，Shift/Ctrl + 右键改右边
    if (direction < 0) current.left = clamp(current.left + (grow ? -KEY_STEP : KEY_STEP), 0, current.right - MIN_SIZE)
    else current.right = clamp(current.right + (grow ? KEY_STEP : -KEY_STEP), current.left + MIN_SIZE, 100)
  } else {
    if (direction < 0) current.top = clamp(current.top + (grow ? -KEY_STEP : KEY_STEP), 0, current.bottom - MIN_SIZE)
    else current.bottom = clamp(current.bottom + (grow ? KEY_STEP : -KEY_STEP), current.top + MIN_SIZE, 100)
  }
  selection.value = current
}

async function confirm() {
  const file = props.file
  const img = imageEl.value
  const crop = selection.value
  if (!file || !img || crop.right - crop.left < 4 || crop.bottom - crop.top < 4) return
  const canvas = document.createElement('canvas')
  const sx = Math.round(img.naturalWidth * crop.left / 100)
  const sy = Math.round(img.naturalHeight * crop.top / 100)
  const sw = Math.round(img.naturalWidth * (crop.right - crop.left) / 100)
  const sh = Math.round(img.naturalHeight * (crop.bottom - crop.top) / 100)
  const output = cropCanvasDimensions(sw, sh)
  canvas.width = output.width
  canvas.height = output.height
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, output.width, output.height)
  let blob
  try {
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } finally {
    // toBlob 完成后及时释放像素缓冲，避免弹窗关闭前同时保留大画布和 PNG。
    canvas.width = 1
    canvas.height = 1
  }
  if (!blob) return
  emit('confirm', new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'timetable'}-crop.png`, { type: 'image/png', lastModified: Date.now() }))
}
</script>

<template>
  <Modal :open="show" title="框选课表区域" wide @close="emit('close')">
    <div class="cropper">
      <p id="crop-hint">拖动框选需要识别的课表区域，尽量排除状态栏、广告和无关文字；图片始终只在本机处理。<br />也可以用键盘：方向键移动选区，「Shift + 方向键」把这一边往回收，「Ctrl + 方向键」往外扩。</p>
      <div
        class="crop-stage"
        tabindex="0"
        role="group"
        aria-label="课表裁切区域"
        aria-describedby="crop-hint"
        @pointerdown="begin"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="end"
        @keydown="onStageKeydown"
      >
        <img ref="imageEl" :src="imageUrl" alt="待裁切的课程表图片" draggable="false" decoding="async" />
        <i class="crop-selection" :style="{ left: `${selection.left}%`, top: `${selection.top}%`, width: `${selection.right - selection.left}%`, height: `${selection.bottom - selection.top}%` }"></i>
      </div>
      <p class="crop-readout" aria-live="polite">{{ selectionReadout }}</p>
      <div class="actions"><button class="btn" @click="emit('close')">取消</button><button class="btn btn-primary" :disabled="selection.right - selection.left < 4 || selection.bottom - selection.top < 4" @click="confirm">裁切并识别</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.cropper{display:flex;flex-direction:column;gap:12px}.cropper>p{margin:0;color:var(--muted);font-size:var(--fs-12-5);line-height:1.55}.crop-stage{position:relative;overflow:hidden;max-height:62vh;max-height:62dvh;border-radius:var(--radius-10);background:#18202c;touch-action:none;cursor:crosshair}.crop-stage img{display:block;max-width:100%;max-height:62vh;max-height:62dvh;margin:auto;user-select:none}.crop-selection{position:absolute;box-sizing:border-box;border:2px solid #fff;outline:9999px solid rgba(0,0,0,.48);box-shadow:0 0 0 1px var(--primary),inset 0 0 0 1px var(--primary);pointer-events:none}.actions{display:flex;justify-content:flex-end;gap:8px}.crop-readout{margin:0;color:var(--muted);font-size:var(--fs-12);font-variant-numeric:tabular-nums}
</style>
