/**
 * 作息表图片/文本识别流程（第五步拆分）。
 *
 * 【为什么 OCR 进度是模块级的】进度条要跨"用户切到别的分区等"这段时间存活——
 * 进度组件刻意放在标签区**之外**（见父模板的注释与 tests/hiddenLiveRegion.test.js），
 * 所以它的状态必须与组件实例解耦。
 *
 * 【为什么这里持有 recognitionApi / scheduleParserApi】两个解析模块都只在用户真正
 * 触发识别时才下载（懒加载），而"识别结果总览/详情"与"导入计划"也要用同一个已加载
 * 实例。放在一个模块里，三处共用一份缓存，也不必再为了拿 api 互相 import。
 */

import { ref, watch } from 'vue'
import { useTaskProgress } from './taskProgress.js'
import { timeConfig } from './store/timeConfig.js'
import { importError } from './timeSettingsShared.js'
import { accountDataOwner } from './accountSyncIdentity.js'
import {
  countTargetModes,
  modesText,
  recognitionDraft,
  startRecognition,
} from './recognitionSchemes.js'

export const lastScheduleImage = ref(null)

// OCR 引擎只在用户真正选择图片后才下载
async function performAccurateOCR(...args) {
  const module = await import('./ocrPipeline.js')
  return module.performOCR(...args)
}

async function performLegacyOCR(...args) {
  const module = await import('./ocrService.js')
  return module.performOCR(...args)
}

export const scheduleOcrProgress = useTaskProgress()
let scheduleOcrController = null
let scheduleOcrGeneration = 0
let lastScheduleMode = 'auto'

// 识别解析器和识别 API 只在需要时加载
let scheduleParserApi = null
let scheduleParserTask = null
let recognitionApi = null
let recognitionTask = null

function loadScheduleParser() {
  if (scheduleParserApi) return Promise.resolve(scheduleParserApi)
  scheduleParserTask ??= import('./scheduleOcrParser.js').then((api) => (scheduleParserApi = api))
  return scheduleParserTask
}

export function loadRecognition() {
  if (recognitionApi) return Promise.resolve(recognitionApi)
  recognitionTask ??= import('./scheduleRecognition.js').then((api) => (recognitionApi = api))
  return recognitionTask
}

/** 已加载的识别 API（未加载时为 null）——同步路径用它，不必 await。 */
export function currentRecognitionApi() {
  return recognitionApi
}

export function schemeDisplayName(...args) { return recognitionApi?.schemeDisplayName(...args) ?? '作息方案' }
export function schemeStatus(...args) { return recognitionApi?.schemeStatus(...args) ?? 'pending' }
export function targetPendingReasonText(...args) { return recognitionApi?.targetPendingReasonText(...args) ?? '正在准备识别结果' }

export const SCHEDULE_OCR_STEPS = [
  { id: 'read', label: '解析图片' },
  { id: 'engine', label: 'OCR 识别' },
  { id: 'structure', label: '恢复作息结构' },
  { id: 'extract', label: '发现作息组' },
  { id: 'match', label: '匹配已有配置' },
  { id: 'validate', label: '时间校验' },
  { id: 'preview', label: '等待用户确认' },
]

export function handleOcrActivity(progress, event, recognizeStep = 'structure') {
  const stage = String(event?.stage || '').replace(/\.\.\./g, '…')
  if (!stage) return
  if (/检查图片|处理图片/.test(stage)) progress.setStep('read', 'running', stage)
  else if (/初始化|加载|模型|内核|接口|就绪/.test(stage)) {
    progress.setStep('read', 'completed', '图片读取完成')
    progress.setStep('engine', 'running', stage)
  } else if (/识别|核对|分列/.test(stage)) {
    progress.setStep('engine', 'completed', '识别引擎已就绪')
    progress.setStep(recognizeStep, 'running', stage)
  } else progress.activity(stage)
}

export function isOcrEngineFailure(progress, message) {
  if (/未识别到文字|图片(?:尺寸)?太小|图片格式|请选择图片/.test(message)) return false
  const engineStep = progress.state.steps.find((step) => step.id === 'engine')
  return engineStep?.status === 'running'
    || /初始化|语言模型|OCR 内核|Worker|Failed to fetch|NetworkError|script load|动态导入/i.test(message)
}

// 解析作息文本：行 → {label,start,end}；同时嗅探「夏季时间 / 南校区」等标题
export async function parseScheduleText(text) {
  const parser = await loadScheduleParser()
  return parser.parseScheduleOCR(text, {
    campuses: timeConfig.value.campuses,
    seasons: timeConfig.value.seasons,
  })
}

export async function runParseImage(file, mode = 'auto') {
  importError.value = ''
  if (!file) return
  if (scheduleOcrProgress.state.status === 'running') return
  lastScheduleImage.value = file
  lastScheduleMode = mode
  const controller = new AbortController()
  const generation = ++scheduleOcrGeneration
  const owner = accountDataOwner.value
  const isCurrent = () => !controller.signal.aborted && generation === scheduleOcrGeneration && owner === accountDataOwner.value
  scheduleOcrController = controller
  scheduleOcrProgress.start({
    title: mode === 'accurate' ? '正在精准识别作息表' : '正在识别作息表',
    steps: SCHEDULE_OCR_STEPS,
    cancel: () => controller.abort(),
  })
  scheduleOcrProgress.setStep('read', 'running', `正在读取 ${file.name}`)
  try {
    const onProgress = (event) => { if (isCurrent()) handleOcrActivity(scheduleOcrProgress, event, 'structure') }
    // 布局感知引擎能处理普通表格图片；只在质量信号需要时才比较增强效果，
    // 兼容引擎保留为回退方案。
    let result
    try {
      result = await performAccurateOCR(file, onProgress, {
        kind: 'schedule',
        mode: mode === 'accurate' ? 'accurate' : 'auto',
        signal: controller.signal,
      })
    } catch (accurateError) {
      if (!isCurrent()) return
      if (accurateError?.name === 'AbortError') throw accurateError
      scheduleOcrProgress.activity('布局识别暂不可用，正在切换兼容识别')
      result = await performLegacyOCR(file, onProgress, { signal: controller.signal })
    }
    if (!isCurrent()) return
    scheduleOcrProgress.setStep('read', 'completed', '图片读取完成')
    scheduleOcrProgress.setStep('engine', 'completed', '识别引擎已就绪')
    scheduleOcrProgress.setStep('structure', 'completed', result.structure?.valid ? '表格网格与行结构已恢复' : '已提取文字位置与结构')
    scheduleOcrProgress.setStep('extract', 'running', '正在解析节次与作息组')
    const parser = await loadScheduleParser()
    if (!isCurrent()) return
    const analysis = parser.parseScheduleOCR(result, {
      campuses: timeConfig.value.campuses,
      seasons: timeConfig.value.seasons,
    })
    scheduleOcrProgress.setPartial({
      校区: analysis.campuses?.length || 0,
      作息季: analysis.seasons?.length || 0,
      节次: analysis.rows?.length || 0,
    }, `提取到 ${analysis.rows.length} 个节次`)
    if (!analysis.rows.length) {
      throw new Error('节次时间提取失败：已识别文字，但未能可靠恢复“节次—时间”结构')
    }
    const schemeTotal = analysis.schemes?.length || 1
    scheduleOcrProgress.setStep('extract', 'completed', `发现 ${schemeTotal} 组作息`)
    scheduleOcrProgress.setStep('match', 'running', '正在匹配校区与作息方案')
    const draftValue = await startRecognition(analysis, file.name, { isCurrent })
    if (!isCurrent() || !draftValue) return
    scheduleOcrProgress.setStep('match', 'completed', modesText(countTargetModes(draftValue)))
    scheduleOcrProgress.setStep('validate', 'running', '正在检查时间冲突与缺失')
    const reviewSchemes = draftValue.schemes.filter((scheme) => schemeStatus(scheme, timeConfig.value) !== 'ready').length
    scheduleOcrProgress.setStep('validate', reviewSchemes ? 'warning' : 'completed', reviewSchemes ? `${reviewSchemes} 组存在待确认项` : '全部通过')
    scheduleOcrProgress.setStep('preview', 'completed', '等待用户确认')
    scheduleOcrProgress.finish(
      reviewSchemes ? `识别完成 · 共 ${draftValue.schemes.length} 组作息，${reviewSchemes} 组需要确认` : `识别完成 · 共发现 ${draftValue.schemes.length} 组作息`,
      reviewSchemes ? 'warning' : 'completed',
    )
    if (result.quality?.warnings?.length) importError.value = `图片质量提示：${result.quality.warnings.join('、')}。精准模式已比较原图、增强图和表格行。`
  } catch (e) {
    if (!isCurrent()) return
    if (e?.name === 'AbortError') return
    importError.value = e.message ?? '图片识别失败'
    const engineFailed = isOcrEngineFailure(scheduleOcrProgress, importError.value)
    if (!engineFailed) {
      scheduleOcrProgress.setStep('read', 'completed', '图片读取完成')
      scheduleOcrProgress.setStep('engine', 'completed', '识别引擎已启动')
    }
    const extractionStarted = scheduleOcrProgress.state.steps.some((step) => step.id === 'extract' && step.status === 'running')
    scheduleOcrProgress.fail(engineFailed ? 'engine' : extractionStarted ? 'extract' : 'structure', importError.value, { retainedResult: Boolean(recognitionDraft.value?.schemes.length) })
  } finally {
    if (scheduleOcrController === controller) scheduleOcrController = null
  }
}

export function onImportImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  void runParseImage(file)
}

export function retryScheduleAccurate() {
  if (lastScheduleImage.value) void runParseImage(lastScheduleImage.value, 'accurate')
}

export function retryScheduleOCR() {
  if (lastScheduleImage.value) void runParseImage(lastScheduleImage.value, lastScheduleMode)
}

export function continueScheduleResults() {
  scheduleOcrProgress.reset()
  lastScheduleImage.value = null
}

/** KeepAlive 离开页面不会卸载组件；主动取消 OCR 避免占用 CPU。 */
export function stopScheduleOcr() {
  scheduleOcrGeneration += 1
  if (scheduleOcrProgress.state.status === 'running') void scheduleOcrProgress.cancel()
  else scheduleOcrController?.abort()
  lastScheduleImage.value = null
}

watch(accountDataOwner, stopScheduleOcr, { flush: 'sync' })
