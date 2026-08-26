<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import Modal from './Modal.vue'
import { markBackedUp } from '../composables/backupReminder.js'
import {
  TRANSFER_MODULES,
  assembleFrames,
  createTransferPackage,
  decryptTransfer,
  encryptTransfer,
  hasTransferUndo,
  importTransferPackage,
  parseFrame,
  restoreTransferUndo,
  splitIntoFrames,
  transferSummary,
} from '../composables/localTransfer.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const tab = ref('send')
const selectedModules = ref(Object.keys(TRANSFER_MODULES).filter((name) => name !== 'wallpapers'))
const sendPassword = ref('')
const generating = ref(false)
const sendError = ref('')
const qrImages = ref([])
const currentFrame = ref(0)
const frameTimer = ref(null)
const packageInfo = ref(null)

const video = ref(null)
const scanCanvas = ref(null)
const cameraStream = ref(null)
const cameraRunning = ref(false)
const scanError = ref('')
const frameMap = ref(new Map())
const transferId = ref('')
const encryptedPayload = ref('')
const receivePassword = ref('')
const decodedPackage = ref(null)
const decrypting = ref(false)
const importMode = ref('merge')
const importMessage = ref('')
const undoAvailable = ref(hasTransferUndo())
let scanAnimation = null
let lastScanAt = 0

watch(() => props.open, (open) => {
  if (open) {
    tab.value = 'send'
    sendError.value = ''
    scanError.value = ''
    importMessage.value = ''
    undoAvailable.value = hasTransferUndo()
  } else {
    stopCamera()
    stopFrameAnimation()
  }
})

onBeforeUnmount(() => {
  stopCamera()
  stopFrameAnimation()
})

function toggleModule(name) {
  selectedModules.value = selectedModules.value.includes(name)
    ? selectedModules.value.filter((item) => item !== name)
    : [...selectedModules.value, name]
}

function stopFrameAnimation() {
  window.clearInterval(frameTimer.value)
  frameTimer.value = null
}

function startFrameAnimation() {
  stopFrameAnimation()
  if (qrImages.value.length <= 1) return
  frameTimer.value = window.setInterval(() => {
    currentFrame.value = (currentFrame.value + 1) % qrImages.value.length
  }, 900)
}

async function generateCodes() {
  sendError.value = ''
  if (!selectedModules.value.length) {
    sendError.value = '请至少选择一类数据'
    return
  }
  if (sendPassword.value.length < 8) {
    sendError.value = '请输入至少 8 个字符的传输密码'
    return
  }
  generating.value = true
  try {
    const pkg = await createTransferPackage(selectedModules.value)
    const payload = await encryptTransfer(pkg, sendPassword.value)
    const frames = splitIntoFrames(payload)
    qrImages.value = await Promise.all(frames.map((frame) => QRCode.toDataURL(frame, {
      errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#172033', light: '#ffffff' },
    })))
    packageInfo.value = { ...transferSummary(pkg), frames: frames.length, createdAt: pkg.createdAt }
    markBackedUp()
    currentFrame.value = 0
    startFrameAnimation()
  } catch (reason) {
    sendError.value = reason instanceof Error ? reason.message : '无法生成二维码'
  } finally {
    generating.value = false
  }
}

function resetReceive() {
  stopCamera()
  frameMap.value = new Map()
  transferId.value = ''
  encryptedPayload.value = ''
  decodedPackage.value = null
  receivePassword.value = ''
  scanError.value = ''
  importMessage.value = ''
}

function processCode(raw) {
  try {
    const frame = parseFrame(raw)
    if (transferId.value && transferId.value !== frame.id) {
      throw new Error('这是另一批迁移码，请先清空当前扫描进度')
    }
    transferId.value = frame.id
    const next = new Map(frameMap.value)
    next.set(frame.index, frame)
    frameMap.value = next
    const complete = assembleFrames(next)
    if (complete) {
      encryptedPayload.value = complete
      stopCamera()
    }
    scanError.value = ''
  } catch (reason) {
    scanError.value = reason instanceof Error ? reason.message : '二维码无法识别'
  }
}

const scanProgress = computed(() => {
  const frames = [...frameMap.value.values()]
  return { current: frames.length, total: frames[0]?.total ?? 0 }
})

async function startCamera() {
  scanError.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    scanError.value = '当前浏览器无法使用摄像头，请改为选择二维码图片'
    return
  }
  try {
    cameraStream.value = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    cameraRunning.value = true
    await nextTick()
    video.value.srcObject = cameraStream.value
    await video.value.play()
    scanLoop()
  } catch {
    scanError.value = '无法打开摄像头，请检查权限或选择二维码图片'
    stopCamera()
  }
}

function stopCamera() {
  if (scanAnimation) cancelAnimationFrame(scanAnimation)
  scanAnimation = null
  for (const track of cameraStream.value?.getTracks?.() ?? []) track.stop()
  cameraStream.value = null
  cameraRunning.value = false
}

function scanImageData(context, width, height) {
  const image = context.getImageData(0, 0, width, height)
  const result = jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' })
  if (result?.data) processCode(result.data)
}

function scanLoop() {
  if (!cameraRunning.value || !video.value || !scanCanvas.value) return
  const width = video.value.videoWidth
  const height = video.value.videoHeight
  const now = performance.now()
  if (width && height && now - lastScanAt >= 120) {
    lastScanAt = now
    const canvas = scanCanvas.value
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(video.value, 0, 0, width, height)
    scanImageData(context, width, height)
  }
  scanAnimation = requestAnimationFrame(scanLoop)
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => resolve({
      drawable: element,
      width: element.naturalWidth,
      height: element.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    })
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    element.src = url
  })
}

async function fileDrawable(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return { drawable: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }
  return loadImage(file)
}

async function scanFiles(event) {
  scanError.value = ''
  const files = [...(event.target.files ?? [])]
  for (const file of files) {
    try {
      const bitmap = await fileDrawable(file)
      const canvas = scanCanvas.value
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap.drawable, 0, 0)
      scanImageData(context, bitmap.width, bitmap.height)
      bitmap.close()
    } catch {
      scanError.value = `无法读取图片“${file.name}”`
    }
  }
  event.target.value = ''
}

async function decryptCodes() {
  scanError.value = ''
  if (!encryptedPayload.value) return
  if (receivePassword.value.length < 8) {
    scanError.value = '请输入发送设备设置的传输密码'
    return
  }
  decrypting.value = true
  try {
    const pkg = await decryptTransfer(encryptedPayload.value, receivePassword.value)
    if (pkg.app !== 'study-life' || pkg.version !== 2) throw new Error('这不是有效的学习生活台迁移数据')
    decodedPackage.value = pkg
  } catch (reason) {
    scanError.value = reason instanceof Error ? reason.message : '解密失败'
  } finally {
    decrypting.value = false
  }
}

async function doImport() {
  if (!decodedPackage.value) return
  if (importMode.value === 'replace' && !window.confirm('覆盖会替换所选模块的本机数据，导入后仍可撤销。是否继续？')) return
  try {
    const result = await importTransferPackage(decodedPackage.value, importMode.value)
    importMessage.value = importMode.value === 'merge'
      ? `已完成合并，新增 ${result.added} 项数据。页面即将刷新。`
      : '已完成覆盖导入。页面即将刷新。'
    undoAvailable.value = true
    window.setTimeout(() => window.location.reload(), 900)
  } catch (reason) {
    scanError.value = reason instanceof Error ? reason.message : '导入失败'
  }
}

async function undoImport() {
  if (!window.confirm('确定撤销最近一次二维码导入吗？')) return
  if (await restoreTransferUndo()) window.location.reload()
}

const decodedSummary = computed(() => decodedPackage.value ? transferSummary(decodedPackage.value) : null)
</script>

<template>
  <Modal :open="open" title="📲 本地二维码迁移" wide @close="emit('close')">
    <div class="tabs"><button :class="{ on: tab === 'send' }" @click="tab = 'send'; stopCamera()">发送数据</button><button :class="{ on: tab === 'receive' }" @click="tab = 'receive'">扫码接收</button></div>

    <div v-if="tab === 'send'" class="transfer-grid">
      <section class="setup-panel">
        <h4>1. 选择要带走的数据</h4>
        <div class="module-list">
          <label v-for="(module, key) in TRANSFER_MODULES" :key="key" :class="{ on: selectedModules.includes(key) }">
            <input type="checkbox" :checked="selectedModules.includes(key)" @change="toggleModule(key)" />
            <span>{{ module.label }}</span>
          </label>
        </div>
        <h4>2. 设置临时传输密码</h4>
        <input v-model="sendPassword" type="password" autocomplete="new-password" placeholder="至少 8 个字符，不会写入二维码" />
        <p class="hint">接收设备需要输入相同密码。二维码和密码不会发送到服务器。</p>
        <button class="btn btn-primary" :disabled="generating" @click="generateCodes">{{ generating ? '正在加密…' : '生成加密二维码' }}</button>
        <p v-if="sendError" class="error">{{ sendError }}</p>
      </section>

      <section class="qr-panel">
        <template v-if="qrImages.length">
          <div class="qr-head"><div><b>请用另一台设备持续扫描</b><span>{{ qrImages.length === 1 ? '单张二维码' : `动态二维码 ${currentFrame + 1}/${qrImages.length}` }}</span></div><span class="lock">加密</span></div>
          <img :src="qrImages[currentFrame]" alt="本地迁移二维码" class="qr-image" />
          <div v-if="qrImages.length > 1" class="frame-progress"><i :style="{ width: ((currentFrame + 1) / qrImages.length * 100) + '%' }"></i></div>
          <p>二维码会循环播放，接收设备会自动收集缺少的片段。</p>
          <div v-if="packageInfo" class="summary-chips"><span>{{ packageInfo.courses }} 门课程</span><span>{{ packageInfo.tasks }} 项待办</span><span>{{ packageInfo.countdowns }} 个倒计时</span><span>{{ packageInfo.food }} 个吃饭选择</span><span v-if="packageInfo.wallpapers">{{ packageInfo.wallpapers }} 张壁纸</span></div>
        </template>
        <template v-else><div class="qr-placeholder"><span>▦</span><p>选择数据并设置密码后生成二维码</p></div></template>
      </section>
    </div>

    <div v-else class="receive-layout">
      <section class="scan-panel">
        <div class="scan-actions"><button class="btn btn-primary" @click="cameraRunning ? stopCamera() : startCamera()">{{ cameraRunning ? '停止摄像头' : '打开摄像头扫描' }}</button><label class="file-button">选择二维码图片<input type="file" accept="image/*" multiple @change="scanFiles" /></label></div>
        <div class="camera-box" :class="{ active: cameraRunning }">
          <video v-show="cameraRunning" ref="video" playsinline muted></video>
          <div v-if="!cameraRunning" class="camera-empty"><span>⌗</span><p>可以连续扫描动态二维码<br />也可以一次选择多张截图</p></div>
          <div v-if="cameraRunning" class="scan-frame"></div>
        </div>
        <canvas ref="scanCanvas" hidden></canvas>
        <div v-if="scanProgress.total" class="scan-progress"><div><b>已收到 {{ scanProgress.current }}/{{ scanProgress.total }} 个片段</b><span>{{ encryptedPayload ? '扫描完成' : '请继续对准二维码' }}</span></div><i><b :style="{ width: (scanProgress.current / scanProgress.total * 100) + '%' }"></b></i></div>
        <button v-if="scanProgress.current" class="reset-link" @click="resetReceive">清空扫描进度</button>
      </section>

      <section class="import-panel">
        <template v-if="!encryptedPayload"><div class="import-empty"><span>1</span><p>完成二维码扫描后，可以在这里输入密码并预览数据。</p></div></template>
        <template v-else-if="!decodedPackage">
          <h4>二维码已收集完整</h4><p class="hint">输入发送设备设置的传输密码。</p>
          <input v-model="receivePassword" type="password" placeholder="传输密码" @keyup.enter="decryptCodes" />
          <button class="btn btn-primary" :disabled="decrypting" @click="decryptCodes">{{ decrypting ? '正在解密…' : '解密并预览' }}</button>
        </template>
        <template v-else>
          <div class="preview-title"><span>✓</span><div><b>数据已成功解密</b><p>{{ new Date(decodedPackage.createdAt).toLocaleString('zh-CN') }} 创建</p></div></div>
          <div class="preview-summary"><span>课程 <b>{{ decodedSummary.courses }}</b></span><span>待办 <b>{{ decodedSummary.tasks }}</b></span><span>倒计时 <b>{{ decodedSummary.countdowns }}</b></span><span>清单 <b>{{ decodedSummary.lists }}</b></span><span>账单 <b>{{ decodedSummary.bills }}</b></span><span>吃饭选择 <b>{{ decodedSummary.food }}</b></span><span v-if="decodedSummary.wallpapers">壁纸 <b>{{ decodedSummary.wallpapers }}</b></span></div>
          <div class="mode-options"><label :class="{ on: importMode === 'merge' }"><input v-model="importMode" type="radio" value="merge" /><span><b>安全合并</b><small>保留本机数据，重复ID另存副本</small></span></label><label :class="{ on: importMode === 'replace' }"><input v-model="importMode" type="radio" value="replace" /><span><b>覆盖所选模块</b><small>使用发送设备的数据替换本机内容</small></span></label></div>
          <button class="btn btn-primary" @click="doImport">确认导入</button>
        </template>
        <p v-if="importMessage" class="success">{{ importMessage }}</p>
        <p v-if="scanError" class="error">{{ scanError }}</p>
        <button v-if="undoAvailable" class="undo-button" @click="undoImport">撤销最近一次二维码导入</button>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.tabs{display:flex;gap:5px;margin-bottom:15px;padding:4px;border-radius:10px;background:var(--bg)}.tabs button{flex:1;padding:9px;border:none;border-radius:7px;background:transparent;color:var(--muted);font-weight:700}.tabs button.on{background:#fff;color:var(--primary);box-shadow:var(--shadow-sm)}.transfer-grid,.receive-layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(320px,1.1fr);gap:16px}.setup-panel,.qr-panel,.scan-panel,.import-panel{display:flex;flex-direction:column;gap:11px;padding:15px;border:1px solid var(--border);border-radius:12px}.setup-panel h4,.import-panel h4{font-size:13px}.module-list{display:grid;grid-template-columns:1fr 1fr;gap:7px}.module-list label{display:flex;align-items:center;gap:7px;padding:9px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:11px}.module-list label.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:700}.hint{color:var(--muted);font-size:11px;line-height:1.55}.setup-panel>.btn{align-self:flex-start}.qr-panel{align-items:center;justify-content:center;min-height:390px;background:#fafbfd}.qr-head{display:flex;justify-content:space-between;align-items:center;width:100%}.qr-head>div{display:flex;flex-direction:column;gap:2px}.qr-head b{font-size:12px}.qr-head span{color:var(--muted);font-size:10px}.lock{padding:4px 7px;border-radius:6px;background:#e8f7f1;color:#087a58!important}.qr-image{width:min(330px,100%);aspect-ratio:1;object-fit:contain}.frame-progress{width:80%;height:4px;border-radius:99px;background:var(--border);overflow:hidden}.frame-progress i{display:block;height:100%;background:var(--primary);transition:width .2s}.qr-panel>p{text-align:center;color:var(--muted);font-size:10px}.summary-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:5px}.summary-chips span{padding:4px 7px;border-radius:5px;background:#fff;color:var(--muted);font-size:9px}.qr-placeholder{display:grid;place-items:center;gap:10px;color:var(--muted);text-align:center}.qr-placeholder span{font-size:70px;color:#cbd3e4}.scan-actions{display:flex;gap:7px}.file-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:8px;background:var(--primary-soft);color:var(--primary);font-size:12px;font-weight:700;cursor:pointer}.file-button input{display:none}.camera-box{position:relative;display:grid;place-items:center;min-height:285px;overflow:hidden;border-radius:12px;background:#172033}.camera-box video{width:100%;height:100%;min-height:285px;object-fit:cover}.camera-empty{color:#cbd3e4;text-align:center}.camera-empty span{font-size:45px}.camera-empty p{margin-top:8px;font-size:11px;line-height:1.6}.scan-frame{position:absolute;width:190px;height:190px;border:2px solid #fff;border-radius:16px;box-shadow:0 0 0 999px rgba(0,0,0,.28)}.scan-progress{display:flex;flex-direction:column;gap:7px}.scan-progress>div{display:flex;justify-content:space-between}.scan-progress b{font-size:11px}.scan-progress span{color:var(--muted);font-size:10px}.scan-progress>i{display:block;height:5px;overflow:hidden;border-radius:99px;background:var(--border)}.scan-progress>i b{display:block;height:100%;background:#16a877}.reset-link{align-self:flex-start;padding:0;border:none;background:transparent;color:var(--muted);font-size:10px}.import-panel{justify-content:center;min-height:390px}.import-empty{display:grid;place-items:center;gap:10px;color:var(--muted);text-align:center}.import-empty span{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--primary-soft);color:var(--primary);font-size:18px;font-weight:900}.import-empty p{max-width:260px;font-size:11px;line-height:1.6}.preview-title{display:flex;gap:9px;align-items:center}.preview-title>span{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#e8f7f1;color:#087a58;font-weight:900}.preview-title b{font-size:12px}.preview-title p{margin-top:2px;color:var(--muted);font-size:9px}.preview-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.preview-summary span{display:flex;justify-content:space-between;padding:8px;border-radius:7px;background:var(--bg);font-size:10px}.mode-options{display:flex;flex-direction:column;gap:7px}.mode-options label{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid var(--border);border-radius:9px;cursor:pointer}.mode-options label.on{border-color:var(--primary);background:var(--primary-soft)}.mode-options span{display:flex;flex-direction:column;gap:2px}.mode-options b{font-size:11px}.mode-options small{color:var(--muted);font-size:9px}.error{color:var(--danger);font-size:11px;line-height:1.5}.success{color:#087a58;font-size:11px}.undo-button{align-self:flex-start;padding:0;border:none;background:transparent;color:var(--primary);font-size:10px;text-decoration:underline}
@media(max-width:760px){.transfer-grid,.receive-layout{grid-template-columns:1fr}.module-list{grid-template-columns:1fr}.qr-panel,.import-panel{min-height:300px}.scan-actions{flex-direction:column}.scan-actions>*{width:100%}.preview-summary{grid-template-columns:1fr 1fr}}
</style>
