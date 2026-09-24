<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import Modal from './Modal.vue'
import { pairingPayload } from '../composables/syncSpace.js'

const props = defineProps({
  open: Boolean,
  pairing: { type: Object, default: null },
  mode: { type: String, default: 'scan' },
  busy: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'regenerate', 'scanned'])
const tab = ref(props.pairing || props.mode === 'create' ? 'show' : 'scan')
const qrImage = ref('')
const manualCode = ref('')
const scanError = ref('')
const video = ref(null)
const canvas = ref(null)
const stream = ref(null)
const cameraRunning = ref(false)
const copied = ref(false)
const remainingSeconds = ref(0)
let animation = 0
let lastScanAt = 0
let manualFocusTimer = 0
let expiryTimer = 0

const pairingExpired = computed(() => !props.pairing || remainingSeconds.value <= 0)

function updateExpiry() {
  const expiresAt = new Date(props.pairing?.expiresAt || '').getTime()
  remainingSeconds.value = Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0
}

function expiryText() {
  const total = remainingSeconds.value
  if (total <= 0) return '二维码已过期'
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return `二维码将在 ${minutes}:${seconds} 后失效`
}

function startExpiryTimer() {
  window.clearInterval(expiryTimer)
  updateExpiry()
  expiryTimer = window.setInterval(updateExpiry, 1000)
}

watch(() => props.open, (open) => {
  if (!open) {
    stopCamera()
    window.clearTimeout(manualFocusTimer)
    window.clearInterval(expiryTimer)
    copied.value = false
  }
  else {
    tab.value = props.pairing || props.mode === 'create' ? 'show' : 'scan'
    scanError.value = ''
    if (props.pairing) startExpiryTimer()
  }
}, { immediate: true })
watch(() => props.pairing, () => {
  void renderQr()
  if (props.pairing) tab.value = 'show'
  if (props.open && props.pairing) startExpiryTimer()
})
watch(() => props.mode, (mode) => {
  if (!props.pairing) tab.value = mode === 'create' ? 'show' : 'scan'
})

async function renderQr() {
  if (!props.pairing) { qrImage.value = ''; return }
  qrImage.value = await QRCode.toDataURL(pairingPayload(props.pairing), {
    errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#172033', light: '#ffffff' },
  })
}

function submitCode(value = manualCode.value) {
  if (props.busy) return
  const code = String(value || '').trim()
  if (!code) { scanError.value = '请扫描或粘贴绑定二维码内容'; return }
  emit('scanned', code)
}

function regeneratePairing() {
  emit('regenerate')
}

function keepManualEntryVisible(event) {
  window.clearTimeout(manualFocusTimer)
  const input = event.currentTarget
  // iOS 在 focus 后才会完成键盘动画；延后滚动才能以视觉视口为准。
  manualFocusTimer = window.setTimeout(() => {
    input?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  }, 260)
}

async function copyBindingContent() {
  if (!props.pairing) return
  const content = pairingPayload(props.pairing)
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard-unavailable')
    await navigator.clipboard.writeText(content)
    copied.value = true
  } catch {
    scanError.value = '无法自动复制。请直接用手机扫描二维码；不要只复制下方的同步空间编号。'
  }
}

function stopCamera() {
  if (animation) cancelAnimationFrame(animation)
  animation = 0
  for (const track of stream.value?.getTracks?.() ?? []) track.stop()
  stream.value = null
  cameraRunning.value = false
}

async function startCamera() {
  if (props.busy) return
  scanError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) { scanError.value = '当前浏览器无法使用摄像头，请粘贴绑定内容或选择二维码图片'; return }
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    cameraRunning.value = true
    await nextTick()
    video.value.srcObject = stream.value
    await video.value.play()
    scanLoop()
  } catch {
    scanError.value = '无法打开摄像头，请检查权限或粘贴绑定内容'
    stopCamera()
  }
}

function scanLoop() {
  if (!cameraRunning.value || !video.value || !canvas.value) return
  const width = video.value.videoWidth
  const height = video.value.videoHeight
  const now = performance.now()
  if (width && height && now - lastScanAt > 150) {
    lastScanAt = now
    canvas.value.width = width
    canvas.value.height = height
    const context = canvas.value.getContext('2d', { willReadFrequently: true })
    context.drawImage(video.value, 0, 0, width, height)
    const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'attemptBoth' })
    if (result?.data) { stopCamera(); submitCode(result.data); return }
  }
  animation = requestAnimationFrame(scanLoop)
}

function readQrFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.onload = () => {
    try {
      const context = canvas.value.getContext('2d', { willReadFrequently: true })
      canvas.value.width = image.naturalWidth
      canvas.value.height = image.naturalHeight
      context.drawImage(image, 0, 0)
      const result = jsQR(context.getImageData(0, 0, canvas.value.width, canvas.value.height).data, canvas.value.width, canvas.value.height, { inversionAttempts: 'attemptBoth' })
      if (!result?.data) throw new Error('未识别到有效二维码')
      submitCode(result.data)
    } catch (reason) { scanError.value = reason instanceof Error ? reason.message : '二维码无法识别' }
    URL.revokeObjectURL(url)
  }
  image.onerror = () => { URL.revokeObjectURL(url); scanError.value = '二维码图片读取失败' }
  image.src = url
}

onBeforeUnmount(() => {
  window.clearTimeout(manualFocusTimer)
  stopCamera()
})
void renderQr()
</script>

<template>
  <Modal :open="open" title="添加设备" wide @close="emit('close')">
    <div class="pair-tabs" role="group" aria-label="设备绑定方式">
      <button v-if="pairing" type="button" :aria-pressed="tab === 'show'" :class="{ on: tab === 'show' }" @click="tab = 'show'; stopCamera()">显示绑定码</button>
      <button type="button" :aria-pressed="tab === 'scan'" :class="{ on: tab === 'scan' }" @click="tab = 'scan'">扫描绑定码</button>
    </div>
    <section v-if="tab === 'show' && pairing" class="pair-show">
      <p><b>请用手机扫描此二维码</b><br /><span>绑定码 10 分钟内有效，成功使用后立即失效。</span></p>
      <img v-if="qrImage" :src="qrImage" alt="多设备同步绑定二维码" class="pair-qr" decoding="async" />
      <button type="button" class="btn" :disabled="pairingExpired || busy" @click="copyBindingContent">{{ copied ? '已复制完整绑定内容' : '复制绑定内容' }}</button>
      <small class="pair-copy-hint">仅在无法扫码时使用；请粘贴完整内容，不要复制同步空间编号。</small>
      <code class="pair-space">同步空间编号：{{ pairing.spaceId }}</code>
      <p class="pair-expiry" :class="{ expired: pairingExpired }">{{ expiryText() }}<button v-if="pairingExpired" type="button" class="text-button" @click="regeneratePairing">重新生成</button></p>
    </section>
    <section v-else-if="mode === 'create'" class="pair-create-state" aria-live="polite">
      <div class="pair-create-icon" aria-hidden="true">▦</div>
      <b v-if="busy">正在生成配对信息…</b>
      <template v-else>
        <b>暂时无法生成配对信息</b>
        <span>请稍后重试。</span>
        <button type="button" class="btn btn-primary" @click="regeneratePairing">重新生成</button>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="pair-scan">
      <div class="pair-actions"><button type="button" class="btn btn-primary" :disabled="busy" @click="cameraRunning ? stopCamera() : startCamera()">{{ cameraRunning ? '停止摄像头' : '打开摄像头' }}</button><label class="file-button" :class="{ disabled: busy }">选择二维码图片<input type="file" accept="image/*" :disabled="busy" @change="readQrFile" /></label></div>
      <label class="pair-manual"><b>粘贴完整绑定内容</b><small>请粘贴电脑端“复制绑定内容”得到的整段文本；同步空间编号不能用于添加设备。</small><textarea v-model="manualCode" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴完整绑定内容" @focus="keepManualEntryVisible" /></label>
      <button type="button" class="btn btn-primary" :disabled="busy" :aria-busy="busy || undefined" @click="submitCode()">{{ busy ? '正在加入同步空间…' : '确认绑定' }}</button>
      <div v-if="cameraRunning" class="pair-camera"><video ref="video" playsinline muted></video></div>
      <canvas ref="canvas" hidden></canvas>
    </section>
    <p v-if="scanError && mode !== 'create'" class="error" role="alert">{{ scanError }}</p>
  </Modal>
</template>

<style scoped>
.pair-tabs{display:flex;gap:5px;margin-bottom:14px;padding:4px;border-radius:10px;background:var(--bg)}.pair-tabs button{flex:1;padding:9px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-weight:700}.pair-tabs button.on{background:var(--card);color:var(--primary);box-shadow:var(--shadow-sm)}.pair-show,.pair-scan,.pair-create-state{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}.pair-show p,.pair-expiry,.pair-copy-hint,.pair-create-state span{color:var(--muted);font-size:11px;line-height:1.6}.pair-expiry{display:flex;align-items:center;gap:8px;justify-content:center}.pair-expiry.expired{color:var(--danger)}.pair-qr{width:min(340px,100%);aspect-ratio:1;object-fit:contain}.pair-space{max-width:100%;overflow-wrap:anywhere;padding:7px 12px;border-radius:7px;background:var(--bg);color:var(--primary);font-size:12px;letter-spacing:.4px}.pair-actions{display:flex;gap:8px;width:100%}.pair-actions>*{flex:1}.file-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:8px;background:var(--primary-soft);color:var(--primary);font-size:12px;font-weight:700;cursor:pointer}.file-button.disabled{opacity:.55;cursor:not-allowed}.file-button input{display:none}.pair-camera{display:grid;place-items:center;width:min(420px,100%);min-height:220px;overflow:hidden;border-radius:12px;background:#172033;color:#cbd3e4;font-size:12px}.pair-camera video{width:100%;min-height:220px;object-fit:cover}.pair-manual{display:flex;flex-direction:column;align-items:stretch;gap:5px;width:100%;color:var(--muted);font-size:12px;text-align:left}.pair-manual b{color:var(--text);font-size:13px}.pair-manual small{line-height:1.5}.pair-manual textarea{width:100%;min-height:74px;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font:inherit;font-size:16px;line-height:1.35;resize:vertical}.pair-create-icon{display:grid;place-items:center;width:76px;height:76px;border-radius:16px;background:var(--primary-soft);color:var(--primary);font-size:36px}.error{color:var(--danger);font-size:11px}
@media(max-width:560px){.pair-actions{flex-direction:column}.pair-actions>*{width:100%}}
</style>
