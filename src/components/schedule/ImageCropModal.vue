<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Modal from '../Modal.vue'

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
  canvas.width = sw
  canvas.height = sh
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95))
  if (!blob) return
  emit('confirm', new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'timetable'}-crop.png`, { type: 'image/png', lastModified: Date.now() }))
}
</script>

<template>
  <Modal :open="show" title="框选课表区域" wide @close="emit('close')">
    <div class="cropper">
      <p>拖动框选需要识别的课表区域，尽量排除状态栏、广告和无关文字；图片始终只在本机处理。</p>
      <div class="crop-stage" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="end">
        <img ref="imageEl" :src="imageUrl" alt="待裁切的课程表图片" draggable="false" />
        <i class="crop-selection" :style="{ left: `${selection.left}%`, top: `${selection.top}%`, width: `${selection.right - selection.left}%`, height: `${selection.bottom - selection.top}%` }"></i>
      </div>
      <div class="actions"><button class="btn" @click="emit('close')">取消</button><button class="btn btn-primary" :disabled="selection.right - selection.left < 4 || selection.bottom - selection.top < 4" @click="confirm">裁切并识别</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.cropper{display:flex;flex-direction:column;gap:12px}.cropper>p{margin:0;color:var(--muted);font-size:12.5px;line-height:1.55}.crop-stage{position:relative;overflow:hidden;max-height:62vh;border-radius:10px;background:#18202c;touch-action:none;cursor:crosshair}.crop-stage img{display:block;max-width:100%;max-height:62vh;margin:auto;user-select:none}.crop-selection{position:absolute;box-sizing:border-box;border:2px solid #fff;outline:9999px solid rgba(0,0,0,.48);box-shadow:0 0 0 1px var(--primary),inset 0 0 0 1px var(--primary);pointer-events:none}.actions{display:flex;justify-content:flex-end;gap:8px}
</style>
