<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import Modal from './Modal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import TaskProgress from './TaskProgress.vue'
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
import { useTaskProgress } from '../composables/taskProgress.js'
import { useTabKeys } from '../composables/tabKeys.js'
import { transferTab } from '../composables/modalSections.js'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

// 分区状态存在 composables/modalSections.js 的模块级 ref 里：关闭再打开回到上次所在的迁移方式。
const tab = transferTab
/** 切换迁移方式：进入"发送数据"时要停掉摄像头（原本写在按钮的 @click 里，键盘切换会绕过它）。 */
function selectTransferTab(next) {
  if (next === 'send') stopCamera()
  tab.value = next
}
const { onKeydown: onTransferTabKeydown, tabIndexFor: transferTabIndex } = useTabKeys({
  keys: ['send', 'receive'],
  active: () => tab.value,
  select: (key) => selectTransferTab(key),
})
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
const sendProgress = useTaskProgress()
const receiveProgress = useTaskProgress()
let scanController = null
let importController = null
let scanAnimation = null
let lastScanAt = 0
// 二维码解码的长边上限（px）。与 SyncPairingModal 用同一个值。
const QR_DECODE_MAX_SIDE = 1000

watch(() => props.open, (open) => {
  if (open) {
    // 不再强制回到"发送"：关闭再打开回到上次所在的迁移方式（见 modalSections.js）。
    // 摄像头不会因此泄漏：关闭与卸载时都会 stopCamera（见下面的 else 分支与 onBeforeUnmount）。
    sendError.value = ''
    scanError.value = ''
    importMessage.value = ''
    undoAvailable.value = hasTransferUndo()
  } else {
    stopCamera()
    stopFrameAnimation()
    if (receiveProgress.state.status === 'running' && receiveProgress.state.canCancel) void receiveProgress.cancel()
  }
})

onBeforeUnmount(() => {
  stopCamera()
  stopFrameAnimation()
  scanController?.abort()
  importController?.abort()
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
  sendProgress.start({
    title: '正在生成加密二维码',
    steps: [
      { id: 'collect', label: '收集所选数据' },
      { id: 'encrypt', label: '压缩并加密' },
      { id: 'split', label: '拆分二维码片段' },
      { id: 'render', label: '生成二维码图片' },
    ],
  })
  try {
    sendProgress.setStep('collect', 'running', '正在读取所选模块')
    const pkg = await createTransferPackage(selectedModules.value, {
      onProgress: ({ stage, current, total }) => {
        if (stage === 'wallpapers') {
          sendProgress.setPartial({ 壁纸: `${current}/${total}` }, `已处理 ${current}/${total} 张壁纸`)
        } else {
          sendProgress.setPartial({ 模块: `${current}/${total}` }, `已收集 ${current}/${total} 个模块`)
        }
      },
    })
    sendProgress.setStep('collect', 'completed', '所选数据已收集')
    sendProgress.setStep('encrypt', 'running', '正在本机派生密钥并加密')
    const payload = await encryptTransfer(pkg, sendPassword.value)
    sendProgress.setStep('encrypt', 'completed', '数据已加密，密码未写入二维码')
    sendProgress.setStep('split', 'running', '正在按二维码容量拆分')
    const frames = splitIntoFrames(payload)
    sendProgress.setStep('split', 'completed', `已拆分为 ${frames.length} 个片段`)
    sendProgress.setStep('render', 'running', '正在生成二维码图片')
    const images = []
    for (const [index, frame] of frames.entries()) {
      images.push(await QRCode.toDataURL(frame, {
        errorCorrectionLevel: 'M', margin: 2, width: 360, color: { dark: '#172033', light: '#ffffff' },
      }))
      sendProgress.setPartial({ 二维码: `${index + 1}/${frames.length}` }, `已生成 ${index + 1}/${frames.length} 张二维码`)
    }
    qrImages.value = images
    packageInfo.value = { ...transferSummary(pkg), frames: frames.length, createdAt: pkg.createdAt }
    markBackedUp()
    currentFrame.value = 0
    startFrameAnimation()
    sendProgress.setStep('render', 'completed', '二维码已生成并开始循环播放')
    sendProgress.finish('加密二维码生成完成')
  } catch (reason) {
    sendError.value = reason instanceof Error ? reason.message : '无法生成二维码'
    const running = sendProgress.state.steps.find((step) => step.status === 'running')?.id
    sendProgress.fail(running, sendError.value, { retry: true })
  } finally {
    generating.value = false
  }
}

function continueSendResult() {
  sendProgress.reset()
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

/**
 * 按比例缩到 QR_DECODE_MAX_SIDE 以内再解码。
 *
 * jsQR 的耗时与像素数近似线性，而摄像头预览通常是 1920×1080、手机照片能到
 * 4000×3000（1200 万像素 ≈ 48MB ImageData）。全分辨率解码会让界面卡住好几秒，
 * 扫描过程每 120ms 就来一次。二维码的模块相对整张图足够大，缩到 1000px 不影响识别率。
 */
function fitForDecode(source, width, height) {
  const scale = Math.min(1, QR_DECODE_MAX_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  }
}

function scanLoop() {
  if (!cameraRunning.value || !video.value || !scanCanvas.value) return
  const fullWidth = video.value.videoWidth
  const fullHeight = video.value.videoHeight
  const now = performance.now()
  if (fullWidth && fullHeight && now - lastScanAt >= 120) {
    lastScanAt = now
    const canvas = scanCanvas.value
    const { width, height } = fitForDecode(video.value, fullWidth, fullHeight)
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
  const showProgress = files.length > 1
  const controller = new AbortController()
  scanController = controller
  let failures = 0
  if (showProgress) {
    receiveProgress.start({
      title: `正在读取 ${files.length} 张二维码图片`,
      steps: [
        { id: 'read', label: '读取图片队列' },
        { id: 'scan', label: '识别二维码片段' },
        { id: 'assemble', label: '检查片段完整性' },
      ],
      cancel: () => controller.abort(),
    })
    receiveProgress.setStep('read', 'completed', `已选择 ${files.length} 张图片`)
    receiveProgress.setStep('scan', 'running', '正在逐张识别')
  }
  try {
    for (const [index, file] of files.entries()) {
      if (controller.signal.aborted) break
      let bitmap = null
      try {
        bitmap = await fileDrawable(file)
        if (controller.signal.aborted) break
        const canvas = scanCanvas.value
        const { width, height } = fitForDecode(bitmap.drawable, bitmap.width, bitmap.height)
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(bitmap.drawable, 0, 0, width, height)
        scanImageData(context, width, height)
      } catch {
        failures++
        scanError.value = `无法读取图片“${file.name}”`
      } finally {
        bitmap?.close()
      }
      if (showProgress) {
        receiveProgress.setPartial({ 图片: `${index + 1}/${files.length}`, 片段: `${scanProgress.value.current}/${scanProgress.value.total || '?'}` }, `已检查 ${index + 1}/${files.length} 张图片`)
      }
    }
    if (showProgress && !controller.signal.aborted) {
      receiveProgress.setStep('scan', failures ? 'warning' : 'completed', failures ? `${failures} 张图片无法读取` : '图片识别完成')
      receiveProgress.setStep('assemble', encryptedPayload.value ? 'completed' : 'warning', encryptedPayload.value ? '二维码片段已收集完整' : '仍缺少二维码片段')
      receiveProgress.finish(encryptedPayload.value ? '二维码已收集完整，可以输入密码' : '已保留识别到的片段，请继续补充图片', encryptedPayload.value && !failures ? 'completed' : 'warning')
    }
  } finally {
    if (scanController === controller) scanController = null
    event.target.value = ''
  }
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
  const showProgress = Boolean(decodedSummary.value?.wallpapers)
  const controller = new AbortController()
  importController = controller
  if (showProgress) {
    receiveProgress.start({
      title: '正在导入迁移数据',
      steps: [
        { id: 'snapshot', label: '创建回滚快照' },
        { id: 'data', label: '合并文字数据' },
        { id: 'wallpapers', label: '写入壁纸图片' },
        { id: 'finish', label: '完成并重新载入' },
      ],
      cancel: () => controller.abort(),
    })
    receiveProgress.setStep('snapshot', 'running', '正在准备可撤销快照')
  }
  try {
    const result = await importTransferPackage(decodedPackage.value, importMode.value, {
      signal: controller.signal,
      onProgress: ({ stage, current, total, message: progressMessage }) => {
        if (!showProgress) return
        if (stage === 'snapshot') receiveProgress.setStep('snapshot', 'running', progressMessage)
        else if (stage === 'data') {
          receiveProgress.setStep('snapshot', 'completed', '回滚快照已创建')
          receiveProgress.setStep('data', 'running', '正在合并所选模块')
          receiveProgress.setPartial({ 数据模块: `${current}/${total}` }, `已处理 ${current}/${total} 个数据模块`)
        } else if (stage === 'wallpapers') {
          receiveProgress.setStep('data', 'completed', '文字数据处理完成')
          receiveProgress.setStep('wallpapers', 'running', '正在原子写入壁纸')
          receiveProgress.setPartial({ 壁纸: `${current}/${total}` }, `已处理 ${current}/${total} 张壁纸`)
        }
      },
    })
    if (controller.signal.aborted) return
    importMessage.value = importMode.value === 'merge'
      ? `已完成合并，新增 ${result.added} 项数据。页面即将刷新。`
      : '已完成覆盖导入。页面即将刷新。'
    undoAvailable.value = true
    if (showProgress) {
      receiveProgress.setStep('wallpapers', 'completed', '壁纸写入完成')
      receiveProgress.setStep('finish', 'completed', '迁移完成，即将重新载入')
      receiveProgress.finish('迁移数据导入完成')
    }
    window.setTimeout(() => window.location.reload(), 900)
  } catch (reason) {
    if (reason?.name === 'AbortError') return
    scanError.value = reason instanceof Error ? reason.message : '导入失败'
    if (showProgress) {
      const running = receiveProgress.state.steps.find((step) => step.status === 'running')?.id
      receiveProgress.fail(running, `${scanError.value}；已自动恢复导入前数据`, { retry: true })
    }
  } finally {
    if (importController === controller) importController = null
  }
}

function retryReceiveTask() {
  if (decodedPackage.value) void doImport()
}

function continueReceiveResult() {
  receiveProgress.reset()
}

// 覆盖式导入的确认与执行刻意拆成两个函数：
//   - requestImport() 只负责弹确认（模板的「确认导入」按钮走它）；
//   - doImport() 是纯执行，内部不再确认。
// 为什么必须拆开：失败重试（retryReceiveTask）要直接重跑导入，确认若留在 doImport
// 里，用户点一次「重试」就会被再问一遍——那是对同一次操作的重复确认。
// 另外 AbortController 与 receiveProgress 都在**确认之后**才创建：确认期间不该出现
// 任何"正在导入"的状态，否则用户点了取消还会看到进度条。
const importConfirmOpen = ref(false)

function requestImport() {
  if (!decodedPackage.value) return
  // 合并模式不覆盖本机任何数据，无需确认，直接透传（与改造前行为一致）。
  if (importMode.value !== 'replace') { void doImport(); return }
  importConfirmOpen.value = true
}

function confirmImport() {
  importConfirmOpen.value = false
  void doImport()
}

// 撤销同样拆开：reload() 只能排在确认之后，用户点取消时页面绝不能重载。
const undoConfirmOpen = ref(false)

function requestUndoImport() {
  undoConfirmOpen.value = true
}

async function confirmUndoImport() {
  undoConfirmOpen.value = false
  if (await restoreTransferUndo()) window.location.reload()
}

const decodedSummary = computed(() => decodedPackage.value ? transferSummary(decodedPackage.value) : null)
</script>

<template>
  <Modal :open="open" title="📲 本地二维码迁移" wide @close="emit('close')">
    <div class="tabs" role="tablist" aria-label="二维码迁移方式" @keydown="onTransferTabKeydown"><button id="transfer-tab-send" role="tab" :tabindex="transferTabIndex('send')" :aria-selected="tab === 'send'" :class="{ on: tab === 'send' }" @click="selectTransferTab('send')">发送数据</button><button id="transfer-tab-receive" role="tab" :tabindex="transferTabIndex('receive')" :aria-selected="tab === 'receive'" :class="{ on: tab === 'receive' }" @click="selectTransferTab('receive')">扫码接收</button></div>

    <div v-if="tab === 'send'" class="transfer-grid" role="tabpanel" aria-labelledby="transfer-tab-send">
      <section class="setup-panel">
        <h4>1. 选择要带走的数据</h4>
        <div class="module-list">
          <label v-for="(module, key) in TRANSFER_MODULES" :key="key" :class="{ on: selectedModules.includes(key) }">
            <input type="checkbox" :checked="selectedModules.includes(key)" @change="toggleModule(key)" />
            <span>{{ module.label }}</span>
          </label>
        </div>
        <h4>2. 设置临时传输密码</h4>
        <!-- 上方是 <h4> 标题而不是 <label>，标题不会给控件命名；这里的 placeholder 又
             是输入后即消失的说明文字。用 aria-label 给一个稳定的名称，不动布局。 -->
        <input v-model="sendPassword" aria-label="临时传输密码" type="password" autocomplete="new-password" placeholder="至少 8 个字符，不会写入二维码" />
        <p class="hint">接收设备需要输入相同密码。二维码和密码不会发送到服务器。</p>
        <button class="btn btn-primary" :disabled="generating" @click="generateCodes">{{ generating ? '正在加密…' : '生成加密二维码' }}</button>
        <p v-if="sendError" class="error" role="alert">{{ sendError }}</p>
        <TaskProgress
          :task="sendProgress.state"
          :elapsed-seconds="sendProgress.elapsedSeconds.value"
          :activity-age-seconds="sendProgress.activityAgeSeconds.value"
          :stalled="sendProgress.isStalled.value"
          compact
          @retry="generateCodes"
          @continue="continueSendResult"
          @wait="sendProgress.continueWaiting"
        />
      </section>

      <section class="qr-panel">
        <template v-if="qrImages.length">
          <div class="qr-head"><div><b>请用另一台设备持续扫描</b><span>{{ qrImages.length === 1 ? '单张二维码' : `动态二维码 ${currentFrame + 1}/${qrImages.length}` }}</span></div><span class="lock">加密</span></div>
          <img :src="qrImages[currentFrame]" alt="本地迁移二维码" class="qr-image" decoding="async" />
          <div v-if="qrImages.length > 1" class="frame-progress"><i :style="{ width: ((currentFrame + 1) / qrImages.length * 100) + '%' }"></i></div>
          <p>二维码会循环播放，接收设备会自动收集缺少的片段。</p>
          <div v-if="packageInfo" class="summary-chips"><span>{{ packageInfo.courses }} 门课程</span><span>{{ packageInfo.tasks }} 项待办</span><span>{{ packageInfo.countdowns }} 个重要日期</span><span v-if="packageInfo.wallpapers">{{ packageInfo.wallpapers }} 张壁纸</span></div>
        </template>
        <template v-else><div class="qr-placeholder"><span>▦</span><p>选择数据并设置密码后生成二维码</p></div></template>
      </section>
    </div>

    <div v-else class="receive-layout" role="tabpanel" aria-labelledby="transfer-tab-receive">
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
        <TaskProgress
          :task="receiveProgress.state"
          :elapsed-seconds="receiveProgress.elapsedSeconds.value"
          :activity-age-seconds="receiveProgress.activityAgeSeconds.value"
          :stalled="receiveProgress.isStalled.value"
          compact
          @cancel="receiveProgress.cancel"
          @retry="retryReceiveTask"
          @continue="continueReceiveResult"
          @wait="receiveProgress.continueWaiting"
        />
        <template v-if="!encryptedPayload"><div class="import-empty"><span>1</span><p>完成二维码扫描后，可以在这里输入密码并预览数据。</p></div></template>
        <template v-else-if="!decodedPackage">
          <h4>二维码已收集完整</h4><p class="hint">输入发送设备设置的传输密码。</p>
          <input v-model="receivePassword" aria-label="传输密码" type="password" placeholder="传输密码" @keyup.enter="decryptCodes" />
          <button class="btn btn-primary" :disabled="decrypting" @click="decryptCodes">{{ decrypting ? '正在解密…' : '解密并预览' }}</button>
        </template>
        <template v-else>
          <div class="preview-title"><span>✓</span><div><b>数据已成功解密</b><p>{{ new Date(decodedPackage.createdAt).toLocaleString('zh-CN') }} 创建</p></div></div>
          <div class="preview-summary"><span>课程 <b>{{ decodedSummary.courses }}</b></span><span>待办 <b>{{ decodedSummary.tasks }}</b></span><span>重要日期 <b>{{ decodedSummary.countdowns }}</b></span><span>清单 <b>{{ decodedSummary.lists }}</b></span><span>账单 <b>{{ decodedSummary.bills }}</b></span><span v-if="decodedSummary.wallpapers">壁纸 <b>{{ decodedSummary.wallpapers }}</b></span></div>
          <div class="mode-options"><label :class="{ on: importMode === 'merge' }"><input v-model="importMode" type="radio" value="merge" /><span><b>安全合并</b><small>保留本机数据，重复ID另存副本</small></span></label><label :class="{ on: importMode === 'replace' }"><input v-model="importMode" type="radio" value="replace" /><span><b>覆盖所选模块</b><small>使用发送设备的数据替换本机内容</small></span></label></div>
          <button class="btn btn-primary" @click="requestImport">确认导入</button>
        </template>
        <p v-if="importMessage" class="success" role="status">{{ importMessage }}</p>
        <p v-if="scanError" class="error" role="alert">{{ scanError }}</p>
        <button v-if="undoAvailable" class="undo-button" @click="requestUndoImport">撤销最近一次二维码导入</button>
      </section>
    </div>

    <!-- 确认框写在父 Modal 的插槽里：它自己会 Teleport 到 body，所以 DOM 上仍是
         独立浮层（叠在父 Modal 之上，Escape 只关最上层的那一个）。
         v-if 随目标挂载：锚点在打开这一刻才创建，顺序上必然排在父 Modal 之后
         （见 ConfirmDialog 顶部的浮层顺序说明）。 -->
    <ConfirmDialog
      v-if="importConfirmOpen"
      :open="importConfirmOpen"
      title="覆盖式导入"
      message="覆盖会替换所选模块的本机数据，导入后仍可撤销。是否继续？"
      confirm-label="覆盖导入"
      @close="importConfirmOpen = false"
      @confirm="confirmImport"
    />

    <ConfirmDialog
      v-if="undoConfirmOpen"
      :open="undoConfirmOpen"
      title="撤销导入"
      message="确定撤销最近一次二维码导入吗？"
      confirm-label="撤销导入"
      @close="undoConfirmOpen = false"
      @confirm="confirmUndoImport"
    />
  </Modal>
</template>

<style scoped>
.tabs{display:flex;gap:5px;margin-bottom:15px;padding:4px;border-radius:var(--radius-10);background:var(--bg)}.tabs button{flex:1;padding:9px;border:none;border-radius:var(--radius-7);background:transparent;color:var(--muted);font-weight:var(--fw-700)}.tabs button.on{background:var(--card);color:var(--primary);box-shadow:var(--shadow-sm)}.transfer-grid,.receive-layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(320px,1.1fr);gap:16px}.setup-panel,.qr-panel,.scan-panel,.import-panel{display:flex;flex-direction:column;gap:11px;padding:15px;border:1px solid var(--border);border-radius:var(--radius-12)}.setup-panel h4,.import-panel h4{font-size:var(--fs-13)}.module-list{display:grid;grid-template-columns:1fr 1fr;gap:7px}.module-list label{display:flex;align-items:center;gap:7px;padding:9px;border:1px solid var(--border);border-radius:var(--radius-8);color:var(--muted);font-size:var(--fs-11)}.module-list label.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary);font-weight:var(--fw-700)}.hint{color:var(--muted);font-size:var(--fs-11);line-height:1.55}.setup-panel>.btn{align-self:flex-start}.qr-panel{align-items:center;justify-content:center;min-height:390px;background:var(--bg-tint)}.qr-head{display:flex;justify-content:space-between;align-items:center;width:100%}.qr-head>div{display:flex;flex-direction:column;gap:2px}.qr-head b{font-size:var(--fs-12)}.qr-head span{color:var(--muted);font-size:var(--fs-10)}.lock{padding:4px 7px;border-radius:var(--radius-6);background:#e8f7f1;color:#087a58!important}.qr-image{width:min(330px,100%);aspect-ratio:1;object-fit:contain}.frame-progress{width:80%;height:4px;border-radius:var(--radius-pill);background:var(--border);overflow:hidden}.frame-progress i{display:block;height:100%;background:var(--primary);transition: width var(--dur-base) var(--ease-standard)}.qr-panel>p{text-align:center;color:var(--muted);font-size:var(--fs-10)}.summary-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:5px}.summary-chips span{padding:4px 7px;border-radius:var(--radius-5);background:var(--card);color:var(--muted);font-size:var(--fs-9)}.qr-placeholder{display:grid;place-items:center;gap:10px;color:var(--muted);text-align:center}.qr-placeholder span{font-size:var(--fs-70);color:var(--ink-faint)}/* 两个大号占位图形原来共用写死的 #cbd3e4：那个值是照着深色相机框（.camera-box 的 #172033）选的，配 .camera-empty 有 10.8:1 没问题；但 .qr-placeholder 在 .qr-panel 里，底是 var(--bg-tint)，浅色下 #cbd3e4 只有 1.44:1 —— 70px 的图形也要求 3:1，等于这个占位符在浅色主题里根本看不见。--ink-faint 是能达标的最浅一档（浅色 4.98、深色 5.39）。 */.scan-actions{display:flex;gap:7px}.file-button{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:var(--radius-8);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-700);cursor:pointer}.file-button input{display:none}.camera-box{position:relative;display:grid;place-items:center;min-height:285px;overflow:hidden;border-radius:var(--radius-12);background:#172033}.camera-box video{width:100%;height:100%;min-height:285px;object-fit:cover}.camera-empty{color:#cbd3e4;text-align:center}.camera-empty span{font-size:var(--fs-45)}.camera-empty p{margin-top:8px;font-size:var(--fs-11);line-height:1.6}.scan-frame{position:absolute;width:190px;height:190px;border:2px solid #fff;border-radius:var(--radius-16);box-shadow:0 0 0 999px rgba(0,0,0,.28)}.scan-progress{display:flex;flex-direction:column;gap:7px}.scan-progress>div{display:flex;justify-content:space-between}.scan-progress b{font-size:var(--fs-11)}.scan-progress span{color:var(--muted);font-size:var(--fs-10)}.scan-progress>i{display:block;height:5px;overflow:hidden;border-radius:var(--radius-pill);background:var(--border)}.scan-progress>i b{display:block;height:100%;background:#16a877}.reset-link{align-self:flex-start;padding:0;border:none;background:transparent;color:var(--muted);font-size:var(--fs-10)}.import-panel{justify-content:center;min-height:390px}.import-empty{display:grid;place-items:center;gap:10px;color:var(--muted);text-align:center}.import-empty span{display:grid;place-items:center;width:48px;height:48px;border-radius:var(--radius-circle);background:var(--primary-soft);color:var(--primary);font-size:var(--fs-18);font-weight:var(--fw-900)}.import-empty p{max-width:260px;font-size:var(--fs-11);line-height:1.6}.preview-title{display:flex;gap:9px;align-items:center}.preview-title>span{display:grid;place-items:center;width:34px;height:34px;border-radius:var(--radius-circle);background:#e8f7f1;color:#087a58;font-weight:var(--fw-900)}.preview-title b{font-size:var(--fs-12)}.preview-title p{margin-top:2px;color:var(--muted);font-size:var(--fs-9)}.preview-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.preview-summary span{display:flex;justify-content:space-between;padding:8px;border-radius:var(--radius-7);background:var(--bg);font-size:var(--fs-10)}.mode-options{display:flex;flex-direction:column;gap:7px}.mode-options label{display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-9);cursor:pointer}.mode-options label.on{border-color:var(--primary);background:var(--primary-soft)}.mode-options span{display:flex;flex-direction:column;gap:2px}.mode-options b{font-size:var(--fs-11)}.mode-options small{color:var(--muted);font-size:var(--fs-9)}.error{color:var(--danger);font-size:var(--fs-11);line-height:1.5}.success{color:var(--success);font-size:var(--fs-11)}.undo-button{align-self:flex-start;padding:0;border:none;background:transparent;color:var(--primary);font-size:var(--fs-10);text-decoration:underline}
@media(max-width:760px){.transfer-grid,.receive-layout{grid-template-columns:1fr}.module-list{grid-template-columns:1fr}.qr-panel,.import-panel{min-height:300px}.scan-actions{flex-direction:column}.scan-actions>*{width:100%}.preview-summary{grid-template-columns:1fr 1fr}}
</style>
