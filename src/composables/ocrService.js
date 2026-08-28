// OCR 服务：Tesseract.js v7 正确封装
// 根因修复：
// 1) createWorker(langs, oem, options) —— 第 2 参必须是数字 OEM（原代码把 { logger } 当 oem 传入导致引擎初始化失败）
// 2) v7 的 createWorker 内部 .catch(() => {}) 会吞掉 loadLanguage/initialize 错误且不 reject，
//    必须由外层加超时兜底，否则 await 永久 pending
// 3) 状态对象必须 Vue reactive，否则 UI 永远停留在首帧文案
import { reactive } from 'vue'
import { normalizeText, correctOCRErrors } from './courseParser.js'
import { raceWithControls, throwIfAborted } from './asyncTask.js'

const INIT_TIMEOUT_MS = 45000      // Worker 初始化超时（首次需读取本地中文语言包）
const RECOGNIZE_TIMEOUT_MS = 120000 // 单次识别超时兜底

// 响应式状态机：idle → initializing → ready → recognizing → completed | error
export const ocrState = reactive({
  status: 'idle',
  progress: 0,
  stage: '',
  error: null,
})

let worker = null        // 复用的 Worker 实例（单例）
let initPromise = null   // 并发防抖：同一时刻只允许一个 createWorker
let busy = false         // 整个 OCR 流程互斥锁

function logInfo(message, data) {
  if (import.meta.env.DEV) console.log(`[OCR] ${message}`, data ?? '')
}

function logError(message, err) {
  // 错误在任何环境都必须完整输出真正的 Error 对象
  console.error(`[OCR] ${message}`, err)
}

function setStage(stage, progress) {
  ocrState.stage = stage
  if (progress !== undefined) ocrState.progress = Math.round(progress)
}

// Tesseract v7 logger 的各阶段 → 用户可读文案与进度区间
const STAGE_MAP = {
  'loading tesseract core': ['加载 OCR 内核...', 15],
  'initializing tesseract': ['初始化 OCR 引擎...', 30],
  'loading language traineddata': ['下载中文语言模型...', 45],
  'loaded language traineddata': ['语言模型就绪', 55],
  'initializing api': ['启动识别接口...', 58],
  'initialized api': null, // 不展示，进入 ready
}

function handleProgress(message) {
  const mapped = STAGE_MAP[message.status]
  if (message.status === 'recognizing text') {
    ocrState.status = 'recognizing'
    setStage(`正在识别文字... ${Math.round(message.progress * 100)}%`, 60 + message.progress * 40)
    return
  }
  if (mapped) setStage(mapped[0], mapped[1])
}

async function ensureWorker(signal = null) {
  throwIfAborted(signal)
  if (worker) return worker
  if (initPromise) return initPromise

  ocrState.status = 'initializing'
  setStage('正在初始化 OCR 引擎...', 5)
  ocrState.error = null

  initPromise = (async () => {
    let interrupted = false

    const created = (async () => {
      logInfo('createWorker start (langs=chi_sim, oem=1/LSTM_ONLY)')
      const t0 = performance.now()
      const mod = await import('tesseract.js')
      logInfo(`module imported in ${(performance.now() - t0).toFixed(0)}ms`)

      const langPath = new URL('ocr', document.baseURI).href.replace(/\/$/, '')
      const w = await mod.createWorker('chi_sim', 1, {
        langPath,
        gzip: false,
        logger: handleProgress,
        errorHandler: (err) => logError('worker error handler', err),
      })
      await w.setParameters({
        tessedit_pageseg_mode: mod.PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '180',
      })
      logInfo(`worker ready in ${(performance.now() - t0).toFixed(0)}ms`)
      return w
    })()

    // 超时后才成功创建的 Worker 必须立刻终止，避免泄漏
    created.then((w) => {
      if (interrupted) { try { w.terminate() } catch {} }
    }).catch(() => {})

    try {
      worker = await raceWithControls(created, {
        signal,
        timeoutMs: INIT_TIMEOUT_MS,
        timeoutMessage: 'OCR 初始化超时，请检查语言模型后重试',
        onInterrupt: () => { interrupted = true },
      })
      return worker
    } catch (err) {
      // 清理脏状态：无论失败原因是什么，都允许下次重新创建
      worker = null
      throw err
    }
  })()

  try {
    const w = await initPromise
    ocrState.status = 'ready'
    setStage('OCR 已就绪', 60)
    return w
  } catch (err) {
    logError('createWorker failed', err)
    initPromise = null
    ocrState.status = 'error'
    ocrState.error = err?.message || String(err)
    ocrState.stage = 'OCR 初始化失败'
    ocrState.progress = 0
    throw err instanceof Error ? err : new Error(String(err))
  } finally {
    if (!worker) initPromise = null // 成功路径保留 promise 以便并发等待；失败路径复位允许重建
  }
}

async function preprocessImage(file, signal = null) {
  throwIfAborted(signal)
  const startTime = performance.now()
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        // 长课表最怕把宽度压得过小。这张 1280×2781 的截图应保留原尺寸；
        // 只有超大图片才按总像素数缩放，兼顾手机内存与小字清晰度。
        const maxPixels = 6_500_000
        const desiredScale = img.width < 1600 ? 1600 / img.width : 1
        const memoryScale = Math.sqrt(maxPixels / Math.max(1, img.width * img.height))
        const scale = Math.min(desiredScale, memoryScale)
        canvas.width = Math.max(1, Math.floor(img.width * scale))
        canvas.height = Math.max(1, Math.floor(img.height * scale))
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            try {
              throwIfAborted(signal)
              if (blob) resolve({ blob, canvas, width: canvas.width, height: canvas.height })
              else reject(new Error('图片处理失败'))
            } catch (error) { reject(error) }
          },
          'image/png',
        )
        logInfo(`image preprocessed (${img.width}x${img.height} -> ${canvas.width}x${canvas.height}) in ${(performance.now() - startTime).toFixed(0)}ms`)
      } catch (err) {
        reject(new Error(`图片处理失败: ${err.message}`))
      } finally {
        URL.revokeObjectURL(img.src)
      }
    }
    img.onerror = () => reject(new Error('图片加载失败，请换一张图片'))
    img.src = URL.createObjectURL(file)
  })
}

function columnHasText(canvas, sourceX, sourceY, sourceWidth, sourceHeight) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const data = ctx.getImageData(sourceX, sourceY, sourceWidth, sourceHeight).data
  let dark = 0
  let sampled = 0
  for (let y = 0; y < sourceHeight; y += 5) {
    for (let x = 0; x < sourceWidth; x += 5) {
      const offset = (y * sourceWidth + x) * 4
      sampled++
      if (data[offset] < 155 && data[offset + 1] < 155 && data[offset + 2] < 155) dark++
    }
  }
  return dark / Math.max(1, sampled) > 0.004
}

function cropDayColumn(source, day) {
  const spacing = source.width * 0.122
  const center = source.width * 0.232 + spacing * day
  const sourceX = Math.max(0, Math.round(center - spacing * 0.46))
  const sourceY = Math.round(source.height * 0.235)
  const sourceWidth = Math.min(source.width - sourceX, Math.round(spacing * 0.92))
  const sourceHeight = Math.min(source.height - sourceY, Math.round(source.height * 0.69))
  if (!columnHasText(source, sourceX, sourceY + Math.round(sourceHeight * 0.03), sourceWidth, Math.round(sourceHeight * 0.97))) return null

  const maxColumnPixels = 1_450_000
  const scale = Math.min(1.85, Math.sqrt(maxColumnPixels / Math.max(1, sourceWidth * sourceHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function recognizeTimetableColumns(w, source, rawText, signal = null) {
  if (!/星期[一二三四五六日天]/.test(rawText) || !/(?:0?1\s*[-—]\s*0?2|0102)/.test(rawText)) return []
  const columns = []
  for (let day = 0; day < 7; day++) {
    const canvas = cropDayColumn(source, day)
    if (!canvas) continue
    setStage(`正在按星期分列识别... ${day + 1}/7`, 82 + day * 2.4)
    const { data } = await raceWithControls(w.recognize(canvas), {
      signal,
      timeoutMs: RECOGNIZE_TIMEOUT_MS,
      timeoutMessage: '课表分列识别超时，请重试',
      onInterrupt: destroyWorker,
    })
    if (String(data.text || '').trim()) columns.push({ day, text: data.text, confidence: data.confidence })
    canvas.width = 1
    canvas.height = 1
  }
  return columns
}

function extractLayout(blocks, width, height) {
  const lines = []
  const words = []
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({ text: line.text, confidence: line.confidence, bbox: { ...line.bbox } })
        for (const word of line.words || []) {
          words.push({ text: word.text, confidence: word.confidence, bbox: { ...word.bbox } })
        }
      }
    }
  }
  return { width, height, lines, words }
}

export async function performOCR(file, onProgress = null, options = {}) {
  if (busy) throw new Error('OCR 正在进行中，请稍候')
  busy = true
  ocrState.error = null
  const signal = options.signal || null

  try {
    throwIfAborted(signal)
    const prepared = await preprocessImage(file, signal)
    if (onProgress) onProgress({ stage: '正在处理图片...', progress: 5 })

    const w = await ensureWorker(signal)
    if (onProgress) onProgress({ stage: ocrState.stage, progress: ocrState.progress })

    logInfo('recognition start')
    ocrState.status = 'recognizing'
    setStage('正在识别文字...', 62)

    const task = w.recognize(prepared.blob, {}, { text: true, blocks: true })
    const { data } = await raceWithControls(task, {
      signal,
      timeoutMs: RECOGNIZE_TIMEOUT_MS,
      timeoutMessage: 'OCR 识别超时，请重试',
      onInterrupt: destroyWorker,
    })

    logInfo(`recognition finished, confidence=${data.confidence}`)

    let text = normalizeText(String(data.text || '').replace(/\r/g, ''))
    text = correctOCRErrors(text)

    if (!text.trim()) throw new Error('未识别到文字，请换张清晰点的图')

    const columns = await recognizeTimetableColumns(w, prepared.canvas, text, signal)
    ocrState.status = 'completed'
    setStage('识别完成', 100)
    return {
      text,
      confidence: data.confidence,
      wordCount: text.split(/\s+/).length,
      layout: extractLayout(data.blocks, prepared.width, prepared.height),
      columns,
    }
  } catch (err) {
    const cause = err instanceof Error ? err : new Error(String(err))
    if (cause.name !== 'AbortError') logError('performOCR failed', cause)
    ocrState.status = cause.name === 'AbortError' ? 'idle' : 'error'
    ocrState.error = cause.message
    ocrState.stage = cause.name === 'AbortError' ? '识别已取消' : 'OCR 失败'
    throw cause
  } finally {
    busy = false
  }
}

export function getOCRState() {
  // 返回 reactive 本体，模板中调用即为响应式绑定
  return ocrState
}

export function resetOCRStatus() {
  if (busy) return
  ocrState.status = worker ? 'idle' : 'idle'
  ocrState.progress = 0
  ocrState.stage = ''
  ocrState.error = null
}

async function destroyWorker() {
  const w = worker
  worker = null
  initPromise = null
  if (w) {
    try { await w.terminate(); logInfo('worker terminated') } catch (err) { logError('terminate failed', err) }
  }
}

export async function cleanupOCR() {
  await destroyWorker()
  busy = false
  ocrState.status = 'idle'
  ocrState.progress = 0
  ocrState.stage = ''
  ocrState.error = null
}
