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
// 二维码解码用的长边上限（px）。jsQR 的开销与像素数近似线性，
// 从 1920×1080 降到 1000px 长边，getImageData 的内存少 3 倍、解码时间少一个量级。
const QR_DECODE_MAX_SIDE = 1000
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

// 打开摄像头要等用户的权限弹窗，这段时间里 getUserMedia 还没 resolve。
// 没有它，用户连点就会同时拉起多个摄像头请求（部分浏览器直接报错），
// 按钮也看不出「已经在等了」。这是提交期间的同类状态，语义上就是 aria-busy。
const cameraStarting = ref(false)

async function startCamera() {
  if (props.busy || cameraStarting.value) return
  scanError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) { scanError.value = '当前浏览器无法使用摄像头，请粘贴绑定内容或选择二维码图片'; return }
  cameraStarting.value = true
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
  } finally {
    cameraStarting.value = false
  }
}

function scanLoop() {
  if (!cameraRunning.value || !video.value || !canvas.value) return
  const fullWidth = video.value.videoWidth
  const fullHeight = video.value.videoHeight
  const now = performance.now()
  if (fullWidth && fullHeight && now - lastScanAt > 150) {
    lastScanAt = now
    // 同上：摄像头预览往往是 1920×1080，jsQR 按全分辨率解码要 30–80ms，
    // 每 150ms 来一次就等于界面每隔一点五秒卡一下。降到 1000px 长边再解码。
    const scale = Math.min(1, QR_DECODE_MAX_SIDE / Math.max(fullWidth, fullHeight))
    const width = Math.max(1, Math.round(fullWidth * scale))
    const height = Math.max(1, Math.round(fullHeight * scale))
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
      // 缩到 1000px 长边再解码。手机照片动辄 4000×3000 = 1200 万像素，
      // 原分辨率 getImageData 一次就是 48MB 内存 + 多秒主线程卡死。
      // 二维码的模块相对整张图大得多，1000px 完全够扫。
      const scale = Math.min(1, QR_DECODE_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.value.getContext('2d', { willReadFrequently: true })
      canvas.value.width = width
      canvas.value.height = height
      context.drawImage(image, 0, 0, width, height)
      const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: 'attemptBoth' })
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
  // 有效期倒计时的 1s 定时器原来只在 close() 里清。这个弹窗是 defineAsyncComponent + v-if，
  // 数据管理器整个关掉时它会带着 open===true 直接被卸载，close() 根本没机会跑 ——
  // 定时器就每秒醒一次，直到标签页结束。卸载路径必须自己收尾。
  window.clearInterval(expiryTimer)
  expiryTimer = null
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
      <div class="pair-actions"><button type="button" class="btn btn-primary" :disabled="busy || cameraStarting" :aria-busy="cameraStarting || undefined" @click="cameraRunning ? stopCamera() : startCamera()">{{ cameraRunning ? '停止摄像头' : '打开摄像头' }}</button><label class="file-button" :class="{ disabled: busy }">选择二维码图片<input type="file" accept="image/*" :disabled="busy" @change="readQrFile" /></label></div>
      <label class="pair-manual"><b>粘贴完整绑定内容</b><small>请粘贴电脑端“复制绑定内容”得到的整段文本；同步空间编号不能用于添加设备。</small><textarea v-model="manualCode" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴完整绑定内容" @focus="keepManualEntryVisible" /></label>
      <button type="button" class="btn btn-primary" :disabled="busy" :aria-busy="busy || undefined" @click="submitCode()">{{ busy ? '正在加入同步空间…' : '确认绑定' }}</button>
      <div v-if="cameraRunning" class="pair-camera"><video ref="video" playsinline muted></video></div>
      <canvas ref="canvas" hidden></canvas>
    </section>
    <p v-if="scanError && mode !== 'create'" class="error" role="alert">{{ scanError }}</p>
  </Modal>
</template>

<style scoped>
.pair-tabs{display:flex;gap:5px;margin-bottom:14px;padding:4px;border-radius:var(--radius-10);background:var(--bg)}.pair-tabs button{flex:1;padding:9px;border:0;border-radius:var(--radius-7);background:transparent;color:var(--muted);font-weight:var(--fw-700)}.pair-tabs button.on{background:var(--card);color:var(--primary);box-shadow:var(--shadow-sm)}.pair-show,.pair-scan,.pair-create-state{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}.pair-show p,.pair-expiry,.pair-copy-hint,.pair-create-state span{color:var(--muted);font-size:var(--fs-11);line-height:1.6}.pair-expiry{display:flex;align-items:center;gap:8px;justify-content:center}.pair-expiry.expired{color:var(--danger)}.pair-qr{width:min(340px,100%);aspect-ratio:1;object-fit:contain}.pair-space{max-width:100%;overflow-wrap:anywhere;padding:7px 12px;border-radius:var(--radius-7);background:var(--bg);color:var(--primary);font-size:var(--fs-12);letter-spacing:.4px}.pair-actions{display:flex;gap:8px;width:100%}.pair-actions>*{flex:1}.file-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:var(--radius-8);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-700);cursor:pointer}.file-button.disabled{opacity:.55;cursor:not-allowed}.file-button input{display:none}.pair-camera{display:grid;place-items:center;width:min(420px,100%);min-height:220px;overflow:hidden;border-radius:var(--radius-12);background:#172033;color:#cbd3e4;font-size:var(--fs-12)}.pair-camera video{width:100%;min-height:220px;object-fit:cover}.pair-manual{display:flex;flex-direction:column;align-items:stretch;gap:5px;width:100%;color:var(--muted);font-size:var(--fs-12);text-align:left}.pair-manual b{color:var(--text);font-size:var(--fs-13)}.pair-manual small{line-height:1.5}.pair-manual textarea{width:100%;min-height:74px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-8);background:var(--card);color:var(--text);font:inherit;font-size:var(--fs-16);line-height:1.35;resize:vertical}.pair-create-icon{display:grid;place-items:center;width:76px;height:76px;border-radius:var(--radius-16);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-36)}.error{color:var(--danger);font-size:var(--fs-11)}
@media(max-width:520px){.pair-actions{flex-direction:column}.pair-actions>*{width:100%}}
</style>
