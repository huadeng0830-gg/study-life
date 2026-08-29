import { reactive } from 'vue'
import { normalizeText, correctOCRErrors } from './courseParser.js'
import { raceWithControls, throwIfAborted } from './asyncTask.js'

const INIT_TIMEOUT_MS = 45000
const RECOGNIZE_TIMEOUT_MS = 120000
const MAX_PIXELS = { fast: 6_500_000, auto: 8_500_000, accurate: 12_000_000 }

function maxPixelsFor(mode) {
  const requested = MAX_PIXELS[mode] || MAX_PIXELS.auto
  const memory = Number(navigator.deviceMemory)
  // 低内存设备会同时持有原图、增强图与 OCR worker 缓冲，准确模式必须更保守。
  if (Number.isFinite(memory) && memory <= 2) return Math.min(requested, 4_000_000)
  if (Number.isFinite(memory) && memory <= 4) return Math.min(requested, 6_500_000)
  return requested
}

class OCRWorkerManager {
  constructor() {
    this.state = reactive({ status: 'idle', progress: 0, stage: '', error: null })
    this.worker = null
    this.initPromise = null
    this.busy = false
    this.tesseractModule = null
    this.activeProgressCallback = null
  }

  resetState() {
    this.state.status = 'idle'
    this.state.progress = 0
    this.state.stage = ''
    this.state.error = null
  }
}

const ocrWorker = new OCRWorkerManager()
export const ocrState = ocrWorker.state

function logInfo(message, data) {
  if (import.meta.env.DEV) console.log(`[OCR] ${message}`, data ?? '')
}

function logError(message, error) {
  console.error(`[OCR] ${message}`, error)
}

function setStage(stage, progress) {
  ocrWorker.state.stage = stage
  if (progress !== undefined) ocrWorker.state.progress = Math.round(progress)
  ocrWorker.activeProgressCallback?.({ stage: ocrWorker.state.stage, progress: ocrWorker.state.progress })
}

const STAGE_MAP = {
  'loading tesseract core': ['加载 OCR 内核...', 15],
  'initializing tesseract': ['初始化 OCR 引擎...', 30],
  'loading language traineddata': ['加载中英数识别模型...', 45],
  'loaded language traineddata': ['语言模型就绪', 55],
  'initializing api': ['启动识别接口...', 58],
}

function handleProgress(message) {
  const mapped = STAGE_MAP[message.status]
  if (message.status === 'recognizing text') {
    ocrWorker.state.status = 'recognizing'
    setStage(`正在识别文字... ${Math.round(message.progress * 100)}%`, 60 + message.progress * 20)
  } else if (mapped) setStage(mapped[0], mapped[1])
}

async function ensureWorker(signal = null) {
  throwIfAborted(signal)
  if (ocrWorker.worker) return ocrWorker.worker
  if (ocrWorker.initPromise) return ocrWorker.initPromise
  ocrWorker.state.status = 'initializing'
  ocrWorker.state.error = null
  setStage('正在初始化 OCR 引擎...', 5)
  ocrWorker.initPromise = (async () => {
    let interrupted = false
    const created = (async () => {
      const startedAt = performance.now()
      ocrWorker.tesseractModule = await import('tesseract.js')
      const langPath = new URL('ocr', document.baseURI).href.replace(/\/$/, '')
      // chi_sim 同时覆盖中文、数字和常见拉丁字符；模型与图片均保持在本机。
      const instance = await ocrWorker.tesseractModule.createWorker('chi_sim', 1, {
        langPath,
        gzip: false,
        logger: handleProgress,
        errorHandler: (error) => logError('worker error handler', error),
      })
      await instance.setParameters({
        tessedit_pageseg_mode: ocrWorker.tesseractModule.PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '220',
      })
      logInfo(`worker ready in ${(performance.now() - startedAt).toFixed(0)}ms`)
      return instance
    })()
    created.then((instance) => { if (interrupted) void instance.terminate() }).catch(() => {})
    try {
      ocrWorker.worker = await raceWithControls(created, {
        signal,
        timeoutMs: INIT_TIMEOUT_MS,
        timeoutMessage: 'OCR 初始化超时，请检查语言模型是否可用后重试',
        onInterrupt: () => { interrupted = true },
      })
      return ocrWorker.worker
    } catch (error) {
      ocrWorker.worker = null
      throw error
    }
  })()
  try {
    const instance = await ocrWorker.initPromise
    ocrWorker.state.status = 'ready'
    setStage('OCR 已就绪', 60)
    return instance
  } catch (error) {
    ocrWorker.initPromise = null
    ocrWorker.state.status = 'error'
    ocrWorker.state.error = error?.message || String(error)
    ocrWorker.state.stage = 'OCR 初始化失败'
    ocrWorker.state.progress = 0
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    if (!ocrWorker.worker) ocrWorker.initPromise = null
  }
}

function imageFromFile(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file))
  }
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败，请换一张图片')) }
    image.src = url
  })
}

function releaseDrawable(drawable) {
  if (typeof drawable?.close === 'function') drawable.close()
}

function sampleQuality(canvas) {
  const scale = Math.min(1, 180 / Math.max(canvas.width, canvas.height))
  const sample = document.createElement('canvas')
  sample.width = Math.max(1, Math.round(canvas.width * scale))
  sample.height = Math.max(1, Math.round(canvas.height * scale))
  const context = sample.getContext('2d', { willReadFrequently: true })
  context.drawImage(canvas, 0, 0, sample.width, sample.height)
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data
  let total = 0
  let squared = 0
  let dark = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114
    total += luminance
    squared += luminance * luminance
    if (luminance < 100) dark++
  }
  const count = pixels.length / 4
  const brightness = total / Math.max(1, count)
  const contrast = Math.sqrt(Math.max(0, squared / Math.max(1, count) - brightness ** 2))
  const warnings = []
  if (contrast < 34) warnings.push('对比度偏低')
  if (brightness < 90) warnings.push('图片偏暗')
  if (canvas.width < 1000) warnings.push('文字分辨率可能偏低')
  sample.width = 1
  sample.height = 1
  return {
    brightness: Math.round(brightness),
    contrast: Math.round(contrast),
    darkRatio: Number((dark / Math.max(1, count)).toFixed(3)),
    warnings,
    needsEnhancement: warnings.length > 0 || contrast < 48,
  }
}

function enhanceCanvas(source, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { alpha: false })
  const contrastFactor = Math.min(1.75, Math.max(1.08, 58 / Math.max(24, quality.contrast)))
  // CSS Canvas filter runs in the browser's image pipeline. This replaces a
  // full-resolution getImageData + JavaScript pixel loop, which was the main
  // source of long frames on large timetable photos.
  if ('filter' in context) {
    context.filter = `grayscale(100%) contrast(${Math.round(contrastFactor * 100)}%) brightness(106%)`
  }
  context.drawImage(source, 0, 0)
  context.filter = 'none'
  return canvas
}

async function preprocessImage(file, mode, signal = null) {
  throwIfAborted(signal)
  const drawable = await imageFromFile(file)
  try {
    throwIfAborted(signal)
    const sourceWidth = drawable.width || drawable.naturalWidth
    const sourceHeight = drawable.height || drawable.naturalHeight
    if (!sourceWidth || !sourceHeight) throw new Error('无法读取图片尺寸')
    const maxPixels = maxPixelsFor(mode)
    const minWidth = mode === 'fast' ? 1400 : 1800
    const desiredScale = sourceWidth < minWidth ? minWidth / sourceWidth : 1
    const memoryScale = Math.sqrt(maxPixels / Math.max(1, sourceWidth * sourceHeight))
    const scale = Math.min(desiredScale, memoryScale)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext('2d', { alpha: false })
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(drawable, 0, 0, canvas.width, canvas.height)
    const quality = sampleQuality(canvas)
    throwIfAborted(signal)
    return { canvas, enhanced: null, width: canvas.width, height: canvas.height, sourceWidth, sourceHeight, quality }
  } finally {
    releaseDrawable(drawable)
  }
}

function extractLayout(blocks, width, height) {
  const lines = []
  const words = []
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({ text: line.text, confidence: line.confidence, bbox: { ...line.bbox } })
        for (const word of line.words || []) words.push({ text: word.text, confidence: word.confidence, bbox: { ...word.bbox } })
      }
    }
  }
  return { width, height, lines, words }
}

async function recognizeWithTimeout(instance, image, label, progressStart, progressEnd, signal = null) {
  throwIfAborted(signal)
  setStage(label, progressStart)
  const task = instance.recognize(image, {}, { text: true, blocks: true })
  const { data } = await raceWithControls(task, {
    signal,
    timeoutMs: RECOGNIZE_TIMEOUT_MS,
    timeoutMessage: 'OCR 识别超时，请重试',
    onInterrupt: destroyWorker,
  })
  setStage(label, progressEnd)
  return data
}

function normalizeResult(data, canvas, name) {
  return {
    name,
    text: correctOCRErrors(normalizeText(String(data.text || '').replace(/\r/g, ''))),
    confidence: Number(data.confidence) || 0,
    layout: extractLayout(data.blocks, canvas.width, canvas.height),
  }
}

function structuredEvidence(result, kind) {
  const times = (result.text.match(/(?:[0-2]?\d|[OoIl])[：:]?[0-5OoIl]\d\s*[-—–至到]\s*(?:[0-2]?\d|[OoIl])[：:]?[0-5OoIl]\d/g) || []).length
  const periods = (result.text.match(/(?:第?\s*[一二三四五六七八九十\d]{1,3}\s*节|(?:0?[1-9]|1[0-2])(?:0?[1-9]|1[0-2])节)/g) || []).length
  const weekdays = new Set(result.text.match(/(?:星期|周)[一二三四五六日天]/g) || []).size
  const structure = kind === 'schedule' ? times * 5 + periods * 3 : weekdays * 6 + periods * 3
  return structure + result.layout.words.length * 0.02 + result.confidence * 0.08
}

function dayFromText(text) {
  const match = String(text || '').replace(/\s/g, '').match(/(?:星期|周)([一二三四五六日天])/) 
  return match ? '一二三四五六日天'.indexOf(match[1]) : -1
}

function detectDayGeometry(layout) {
  const candidates = [...(layout.words || []), ...(layout.lines || [])]
    .map((item) => ({ day: dayFromText(item.text), x: (item.bbox.x0 + item.bbox.x1) / 2, y: item.bbox.y1 }))
    .filter((item) => item.day >= 0 && Number.isFinite(item.x))
  const unique = [...new Map(candidates.map((item) => [item.day, item])).values()]
  let spacing = layout.width * 0.122
  let firstCenter = layout.width * 0.232
  if (unique.length >= 2) {
    const meanDay = unique.reduce((sum, item) => sum + item.day, 0) / unique.length
    const meanX = unique.reduce((sum, item) => sum + item.x, 0) / unique.length
    const denominator = unique.reduce((sum, item) => sum + (item.day - meanDay) ** 2, 0)
    if (denominator) spacing = unique.reduce((sum, item) => sum + (item.day - meanDay) * (item.x - meanX), 0) / denominator
    firstCenter = meanX - spacing * meanDay
  } else if (unique.length === 1) firstCenter = unique[0].x - spacing * unique[0].day
  return {
    detectedHeaders: unique.length,
    centers: Array.from({ length: 7 }, (_, day) => firstCenter + spacing * day),
    spacing: Math.abs(spacing),
    top: unique.length ? Math.max(...unique.map((item) => item.y)) : layout.height * 0.22,
    bottom: Math.min(layout.height, Math.max(layout.height * 0.9, ...(layout.words || []).map((word) => word.bbox.y1 || 0))),
  }
}

function needsDetailPass(result, kind, mode, quality) {
  if (mode === 'accurate') return true
  if (result.confidence < 74) return true
  if (kind === 'timetable') return detectDayGeometry(result.layout).detectedHeaders < 4
  if (kind === 'schedule') return structuredEvidence(result, kind) < 28
  return Boolean(quality.needsEnhancement && result.confidence < 84)
}

function cropColumn(source, geometry, day) {
  const center = geometry.centers[day]
  const sourceX = Math.max(0, Math.round(center - geometry.spacing * 0.47))
  const sourceY = Math.max(0, Math.round(geometry.top))
  const sourceWidth = Math.min(source.width - sourceX, Math.round(geometry.spacing * 0.94))
  const sourceHeight = Math.min(source.height - sourceY, Math.round(geometry.bottom - sourceY))
  if (sourceWidth < 20 || sourceHeight < 40) return null
  const scale = Math.min(2, Math.sqrt(1_650_000 / Math.max(1, sourceWidth * sourceHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function recognizeTimetableColumns(instance, source, bestResult, signal = null) {
  if (!/(?:星期|周)[一二三四五六日天]/.test(bestResult.text) || !/(?:0?1\s*[-—]\s*0?2|0102)/.test(bestResult.text)) return []
  const geometry = detectDayGeometry(bestResult.layout)
  // Do not crop a guessed seven-column grid when the image itself did not
  // provide enough weekday anchors. The layout parser can still use the full
  // spatial OCR output, while the preview asks for confirmation instead of
  // assigning course blocks to invented columns.
  if (geometry.detectedHeaders < 2) return []
  const columns = []
  await instance.setParameters({ tessedit_pageseg_mode: ocrWorker.tesseractModule.PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' })
  try {
    for (let day = 0; day < 7; day++) {
      const canvas = cropColumn(source, geometry, day)
      if (!canvas) continue
      const data = await recognizeWithTimeout(instance, canvas, `正在按星期核对... ${day + 1}/7`, 82 + day * 2.3, 84 + day * 2.2, signal)
      if (String(data.text || '').trim()) columns.push({ day, text: data.text, confidence: data.confidence })
      canvas.width = 1
      canvas.height = 1
    }
  } finally {
    await instance.setParameters({ tessedit_pageseg_mode: ocrWorker.tesseractModule.PSM.SPARSE_TEXT, preserve_interword_spaces: '1' }).catch(() => {})
  }
  return columns
}

function consolidateLinePositions(values, maximum) {
  if (!values.length) return []
  const groups = []
  for (const value of values) {
    const last = groups[groups.length - 1]
    if (!last || value - last[last.length - 1] > 3) groups.push([value])
    else last.push(value)
  }
  return groups
    .map((group) => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length))
    .filter((value) => value >= 0 && value < maximum)
}

function detectTableGrid(source) {
  const context = source.getContext('2d', { willReadFrequently: true })
  const { data } = context.getImageData(0, 0, source.width, source.height)
  const vertical = []
  const horizontal = []
  const darkAt = (x, y) => {
    const offset = (y * source.width + x) * 4
    return data[offset] < 145 && data[offset + 1] < 145 && data[offset + 2] < 145
  }
  const yStep = Math.max(1, Math.floor(source.height / 1400))
  const xStep = Math.max(1, Math.floor(source.width / 1400))
  for (let x = 0; x < source.width; x++) {
    let dark = 0
    let sampled = 0
    for (let y = 0; y < source.height; y += yStep) { sampled++; if (darkAt(x, y)) dark++ }
    if (dark / sampled > 0.48) vertical.push(x)
  }
  for (let y = 0; y < source.height; y++) {
    let dark = 0
    let sampled = 0
    for (let x = 0; x < source.width; x += xStep) { sampled++; if (darkAt(x, y)) dark++ }
    if (dark / sampled > 0.58) horizontal.push(y)
  }
  const xLines = consolidateLinePositions(vertical, source.width)
  const yLines = consolidateLinePositions(horizontal, source.height)
  if (xLines.length && xLines[0] > source.width * 0.08) xLines.unshift(0)
  if (xLines.length && xLines[xLines.length - 1] < source.width * 0.92) xLines.push(source.width - 1)
  if (yLines.length && yLines[0] > source.height * 0.04) yLines.unshift(0)
  if (yLines.length && yLines[yLines.length - 1] < source.height * 0.96) yLines.push(source.height - 1)
  const valid = xLines.length >= 3 && xLines.length <= 16 && yLines.length >= 5 && yLines.length <= 40
  return { xLines, yLines, valid }
}

function cropGridRow(source, grid, top, bottom) {
  const left = grid.xLines[0]
  const right = grid.xLines[grid.xLines.length - 1]
  const padding = Math.max(2, Math.round((bottom - top) * 0.08))
  const sourceY = Math.min(source.height - 1, top + padding)
  const sourceHeight = Math.max(1, bottom - top - padding * 2)
  const sourceWidth = Math.max(1, right - left)
  const scale = Math.min(2.2, Math.max(1, 105 / sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, left, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
  // Grid strokes are structure, not glyphs. Remove only the detected vertical strokes from the copied row.
  context.fillStyle = '#fff'
  for (const x of grid.xLines.slice(1, -1)) {
    const targetX = Math.round((x - left) * scale)
    context.fillRect(targetX - 3, 0, 7, canvas.height)
  }
  return canvas
}

async function recognizeScheduleRows(instance, source, signal = null) {
  const grid = detectTableGrid(source)
  if (!grid.valid) return { regions: [], grid }
  const bands = []
  for (let index = 0; index < grid.yLines.length - 1; index++) {
    const top = grid.yLines[index]
    const bottom = grid.yLines[index + 1]
    if (bottom - top >= Math.max(18, source.height * 0.025)) bands.push({ top, bottom })
  }
  const regions = []
  await instance.setParameters({ tessedit_pageseg_mode: ocrWorker.tesseractModule.PSM.SINGLE_LINE, preserve_interword_spaces: '1' })
  try {
    for (let index = 0; index < bands.length; index++) {
      const band = bands[index]
      const canvas = cropGridRow(source, grid, band.top, band.bottom)
      const progress = 82 + (index / Math.max(1, bands.length)) * 16
      const data = await recognizeWithTimeout(instance, canvas, `正在逐行核对时间... ${index + 1}/${bands.length}`, progress, progress + 1, signal)
      const text = correctOCRErrors(normalizeText(String(data.text || '').replace(/\r/g, ' ')))
      if (text.trim()) {
        regions.push({
          text,
          confidence: Number(data.confidence) || 0,
          bbox: { x0: grid.xLines[0], y0: band.top, x1: grid.xLines[grid.xLines.length - 1], y1: band.bottom },
          source: 'table-row',
        })
      }
      canvas.width = 1
      canvas.height = 1
    }
  } finally {
    await instance.setParameters({ tessedit_pageseg_mode: ocrWorker.tesseractModule.PSM.SPARSE_TEXT, preserve_interword_spaces: '1' }).catch(() => {})
  }
  return { regions, grid }
}

export async function performOCR(file, onProgress = null, options = {}) {
  if (ocrWorker.busy) throw new Error('OCR 正在进行中，请稍候')
  if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件')
  ocrWorker.busy = true
  ocrWorker.activeProgressCallback = onProgress
  ocrState.error = null
  const mode = ['fast', 'auto', 'accurate'].includes(options.mode) ? options.mode : 'auto'
  const kind = options.kind || 'generic'
  const signal = options.signal || null
  let prepared
  try {
    throwIfAborted(signal)
    setStage('正在检查图片方向与质量...', 3)
    prepared = await preprocessImage(file, mode, signal)
    const instance = await ensureWorker(signal)
    ocrState.status = 'recognizing'
    const originalData = await recognizeWithTimeout(instance, prepared.canvas, '正在识别原图...', 60, 75, signal)
    const variants = [normalizeResult(originalData, prepared.canvas, 'original')]
    const shouldCompareEnhanced = mode === 'accurate'
      || variants[0].confidence < 72
      || (kind !== 'generic' && structuredEvidence(variants[0], kind) < 16)
    if (shouldCompareEnhanced) {
      if (!prepared.enhanced) prepared.enhanced = enhanceCanvas(prepared.canvas, prepared.quality)
      const enhancedData = await recognizeWithTimeout(instance, prepared.enhanced, '正在识别增强版本...', 75, 82, signal)
      variants.push(normalizeResult(enhancedData, prepared.enhanced, 'enhanced'))
    }
    const best = [...variants].sort((a, b) => structuredEvidence(b, kind) - structuredEvidence(a, kind))[0]
    if (!best.text.trim()) throw new Error('未识别到文字，请换张更清晰的图片')
    const sourceForColumns = best.name === 'enhanced' ? prepared.enhanced : prepared.canvas
    const detailPass = needsDetailPass(best, kind, mode, prepared.quality)
    const columns = kind === 'timetable' && detailPass
      ? await recognizeTimetableColumns(instance, sourceForColumns, best, signal)
      : []
    const scheduleRows = kind === 'schedule' && detailPass
      ? await recognizeScheduleRows(instance, sourceForColumns, signal)
      : { regions: [], grid: null }
    ocrState.status = 'completed'
    setStage('识别完成', 100)
    const result = {
      text: best.text,
      confidence: best.confidence,
      wordCount: best.text.split(/\s+/).filter(Boolean).length,
      layout: best.layout,
      columns,
      regions: scheduleRows.regions,
      variants: variants.filter((variant) => variant !== best),
      quality: prepared.quality,
      strategy: best.name,
      detailPass,
      structure: scheduleRows.grid,
      image: { width: prepared.width, height: prepared.height, sourceWidth: prepared.sourceWidth, sourceHeight: prepared.sourceHeight },
    }
    if (import.meta.env.DEV) {
      logInfo(`final diagnostics ${JSON.stringify({
        confidence: result.confidence,
        strategy: result.strategy,
        quality: result.quality,
        structure: result.structure,
        regions: result.regions,
      })}`)
    }
    return result
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error))
    if (cause.name !== 'AbortError') logError('performOCR failed', cause)
    ocrState.status = cause.name === 'AbortError' ? 'idle' : 'error'
    ocrState.error = cause.message
    ocrState.stage = cause.name === 'AbortError' ? '识别已取消' : 'OCR 失败'
    throw cause
  } finally {
    if (prepared) {
      prepared.canvas.width = 1
      prepared.canvas.height = 1
      if (prepared.enhanced) { prepared.enhanced.width = 1; prepared.enhanced.height = 1 }
    }
    ocrWorker.busy = false
    ocrWorker.activeProgressCallback = null
  }
}

export function getOCRState() {
  return ocrState
}

export function resetOCRStatus() {
  if (ocrWorker.busy) return
  ocrState.status = 'idle'
  ocrState.progress = 0
  ocrState.stage = ''
  ocrState.error = null
}

async function destroyWorker() {
  const instance = ocrWorker.worker
  ocrWorker.worker = null
  ocrWorker.initPromise = null
  if (instance) {
    try { await instance.terminate(); logInfo('worker terminated') } catch (error) { logError('terminate failed', error) }
  }
}

export async function cleanupOCR() {
  await destroyWorker()
  ocrWorker.busy = false
  ocrWorker.activeProgressCallback = null
  ocrState.status = 'idle'
  ocrState.progress = 0
  ocrState.stage = ''
  ocrState.error = null
}
