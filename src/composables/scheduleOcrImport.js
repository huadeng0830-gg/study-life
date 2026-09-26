import { ref } from 'vue'
import { MAX_WEEK } from './store'
import { timeConfig } from './store/timeConfig.js'
import { useTaskProgress } from './taskProgress.js'

// OCR 引擎、版面解析和本地纠错词典只在用户真正选择图片后才下载。
// 普通查看/编辑课程表不再为这些重模块付出初始化成本。
// OCR Worker 是模块级单例，返回课表时仍可复用已经加载的模型。
async function performAccurateOCR(...args) {
  const module = await import('./ocrPipeline.js')
  return module.performOCR(...args)
}

async function performLegacyOCR(...args) {
  const module = await import('./ocrService.js')
  return module.performOCR(...args)
}

async function extractTimetable(result) {
  const parser = await import('./timetableLayoutParser.js')
  const columnTable = parser.parseTimetableColumns(result.columns, timeConfig, MAX_WEEK)
  const layoutTable = parser.parseTimetableLayout(result.layout, timeConfig, MAX_WEEK)
  return { table: parser.selectBestTimetableExtraction(columnTable, layoutTable), toBatchLine: parser.toBatchLine }
}

async function extractExcelTimetable(file) {
  const [xlsxModule, parser] = await Promise.all([
    import('@e965/xlsx'),
    import('./excelTimetableParser.js'),
  ])
  const XLSX = xlsxModule.default || xlsxModule
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellText: true, cellDates: false })
  const sheets = workbook.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false, blankrows: false }),
  }))
  return parser.extractExcelTimetable(sheets)
}

// OCR 进度步骤与事件映射，仅服务于“批量识图课程表”流程。
const TIMETABLE_OCR_STEPS = [
  { id: 'read', label: '读取图片队列' },
  { id: 'engine', label: '准备识别引擎' },
  { id: 'recognize', label: '识别课程文字' },
  { id: 'structure', label: '恢复星期与节次结构' },
  { id: 'validate', label: '校验课程字段' },
  { id: 'preview', label: '生成导入预览' },
]

const EXCEL_IMPORT_STEPS = [
  { id: 'read', label: '读取 Excel 文件' },
  { id: 'sheets', label: '识别工作表结构' },
  { id: 'structure', label: '还原课程字段与星期列' },
  { id: 'preview', label: '生成可编辑导入预览' },
]

function handleOcrActivity(progress, event, recognizeStep = 'structure') {
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

function isOcrEngineFailure(progress, message) {
  if (/未识别到文字|图片(?:尺寸)?太小|图片格式|请选择图片/.test(message)) return false
  const engineStep = progress.state.steps.find((step) => step.id === 'engine')
  return engineStep?.status === 'running'
    || /初始化|语言模型|OCR 内核|Worker|Failed to fetch|NetworkError|script load|动态导入/i.test(message)
}

function isExcelFile(file) {
  return /\.(?:xlsx|xls|xlsm|xlsb|csv|ods)$/i.test(file?.name || '')
}

/**
 * 识图 / Excel 课程表导入管线（从 ScheduleView 拆出）。
 *
 * 这些函数只在用户主动选择图片或表格文件后才会用到，所以它们连同惰性 loader 一起
 * 收在这里：普通「查看课程表」不会加载 OCR 引擎、xlsx 解析器这些重模块。
 *
 * 依赖全部由宿主注入（课程列表、批量文本缓冲、批量解析器 loader 等），
 * 本模块自己只持有「正在识别」这一小段状态。
 */
export function useScheduleOcrImport({
  courses,
  batchText,
  batchError,
  ocrSummary,
  rememberCourseReviews,
  loadBatchParser,
  getBatchParserApi,
}) {
  const showImageCropper = ref(false)
  const cropImageFile = ref(null)
  const batchOcrProgress = useTaskProgress()
  let batchOcrController = null
  let lastBatchFiles = []
  let retryableImport = null

  async function applyTimetableVocabulary(table) {
    const { applyOcrVocabulary } = await import('./ocrVocabulary.js')
    const changes = []
    table.courses = table.courses.map((course) => {
      const adjusted = applyOcrVocabulary(course, courses.value)
      changes.push(...adjusted.changes)
      return adjusted.course
    })
    return changes
  }

  async function ocrImage(event) {
    const files = [...(event.target.files || [])]
    if (!files.length) return
    if (files.some((file) => !file.type.startsWith('image/'))) {
      batchError.value = '请选择图片文件'
      return
    }
    event.target.value = ''
    await runTimetableOCR(files)
  }

  function selectCropImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file?.type?.startsWith('image/')) { batchError.value = '请选择一张图片文件'; return }
    cropImageFile.value = file
    showImageCropper.value = true
  }

  async function importExcel(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !isExcelFile(file)) {
      batchError.value = '请选择 Excel、CSV 或 ODS 课程表文件'
      return
    }
    await runExcelImport(file)
  }

  async function runExcelImport(file) {
    if (batchOcrProgress.state.status === 'running') return
    let cancelled = false
    retryableImport = { type: 'excel', file }
    batchError.value = ''
    batchOcrProgress.start({
      title: '正在读取 Excel 课程表',
      steps: EXCEL_IMPORT_STEPS,
      cancel: () => { cancelled = true },
    })
    try {
      batchOcrProgress.setStep('read', 'running', `正在读取 ${file.name}`)
      const extracted = await extractExcelTimetable(file)
      if (cancelled) return
      batchOcrProgress.setStep('read', 'completed', '文件已在本机读取，未上传服务器')
      batchOcrProgress.setStep('sheets', 'running', '正在识别课程清单或星期表格')
      if (!extracted.count) throw new Error('没有找到可识别的课程清单或星期表头，请确认文件包含课程名称、星期和节次')
      batchOcrProgress.setStep('sheets', 'completed', `已识别工作表“${extracted.sheetName}”的${extracted.mode === 'grid' ? '星期表格' : '课程清单'}`)
      batchOcrProgress.setStep('structure', 'running', '正在还原课程字段、周次与节次')
      let importText = extracted.batchText
      let table = null
      if (extracted.columns?.length) {
        const structured = await extractTimetable({ columns: extracted.columns, layout: null })
        table = structured.table
        importText = table.batchText
        const lineOffset = batchText.value.split(/\r?\n/).filter((line) => line.trim()).length
        rememberCourseReviews(table.courses, lineOffset)
      }
      if (!importText.trim()) throw new Error('已读到课表，但未能还原课程的周次或节次；请检查单元格是否包含“1-16周”和“1-2节”')
      await loadBatchParser()
      const parsed = importText.split(/\r?\n/)
        .map((line, index) => getBatchParserApi().parseBatchLine(line, index + 1, timeConfig, MAX_WEEK))
      const validCount = parsed.filter((row) => row.data).length
      if (!validCount) throw new Error('已读取 Excel，但课程字段不完整。请检查预览中是否包含星期和节次')
      batchText.value = (batchText.value ? `${batchText.value}\n` : '') + importText
      const reviewCount = Math.max(parsed.filter((row) => row.needsReview).length, table?.diagnostics.reviewCount || 0)
      const label = extracted.mode === 'grid' ? '星期表格' : '课程清单'
      ocrSummary.value = `已从 Excel 工作表“${extracted.sheetName}”识别 ${validCount} 门课程（${label}），结果已放入预览，确认后才会写入课表。${reviewCount ? `其中 ${reviewCount} 门建议确认。` : ''}`
      batchOcrProgress.setStep('structure', reviewCount ? 'warning' : 'completed', `已还原 ${validCount} 门课程${reviewCount ? '，部分建议确认' : ''}`)
      batchOcrProgress.setStep('preview', 'running', '正在生成可编辑导入预览')
      batchOcrProgress.setPartial({ 工作表: extracted.sheetName, 课程: validCount, 格式: label }, 'Excel 解析完成')
      batchOcrProgress.setStep('preview', 'completed', '导入预览已生成，尚未写入课表')
      batchOcrProgress.finish('Excel 课程表已解析，请确认预览', reviewCount ? 'warning' : 'completed')
    } catch (error) {
      if (cancelled) return
      const message = error?.message || 'Excel 课程表读取失败，请检查文件格式后重试'
      batchError.value = message
      batchOcrProgress.fail('structure', message, { retry: true })
    }
  }

  async function recognizeCroppedImage(file) {
    showImageCropper.value = false
    cropImageFile.value = null
    if (!file) return
    batchError.value = ''
    ocrSummary.value = '已按框选区域裁切图片，正在重新识别。'
    await runTimetableOCR([file])
  }

  async function runTimetableOCR(files) {
    if (!files.length) return
    if (batchOcrProgress.state.status === 'running') return
    lastBatchFiles = files
    retryableImport = { type: 'image', files }
    const controller = new AbortController()
    batchOcrController = controller
    batchOcrProgress.start({
      title: files.length > 1 ? `正在识别 ${files.length} 张课程表` : '正在识别课程表',
      steps: TIMETABLE_OCR_STEPS,
      cancel: () => controller.abort(),
    })
    batchOcrProgress.setStep('read', 'running', `已选择 ${files.length} 张图片`)

    const summaries = []
    const failures = []
    try {
      for (const [index, file] of files.entries()) {
        if (controller.signal.aborted) break
        try {
        ocrSummary.value = files.length > 1 ? `正在识别第 ${index + 1}/${files.length} 张：${file.name}` : ''
        batchOcrProgress.setStep('read', 'completed', `图片队列已读取，共 ${files.length} 张`)
        batchOcrProgress.activity(`开始处理第 ${index + 1}/${files.length} 张：${file.name}`)
        let result
        try {
          result = await performAccurateOCR(
            file,
            (event) => handleOcrActivity(batchOcrProgress, event, 'recognize'),
            { kind: 'timetable', mode: 'accurate', signal: controller.signal },
          )
        } catch (accurateError) {
          if (accurateError?.name === 'AbortError') throw accurateError
          if (import.meta.env.DEV) console.warn('[OCR] 精准课表识别降级为兼容模式', accurateError)
          batchOcrProgress.activity('精准识别不可用，正在切换兼容引擎')
          result = await performLegacyOCR(
            file,
            (event) => handleOcrActivity(batchOcrProgress, event, 'recognize'),
            { signal: controller.signal },
          )
        }
        batchOcrProgress.setStep('engine', 'completed', '识别引擎已就绪')
        batchOcrProgress.setStep('recognize', 'completed', `第 ${index + 1}/${files.length} 张文字识别完成`)
        batchOcrProgress.setStep('structure', 'running', '正在分析文字区域、表头与单元格关系')
        const { table, toBatchLine } = await extractTimetable(result)
        const vocabularyChanges = await applyTimetableVocabulary(table)
        if (vocabularyChanges.length) table.batchText = table.courses.map(toBatchLine).join('\n')
        const lineOffset = batchText.value.split(/\r?\n/).filter((line) => line.trim()).length
        rememberCourseReviews(table.courses, lineOffset)
        batchOcrProgress.setStep(
          'structure',
          table.needsReview ? 'warning' : 'completed',
          table.needsReview
            ? '存在待确认的表头或字段，已保留可编辑结果供手动确认'
            : `恢复 ${table.courses.length} 门课程的空间归属${vocabularyChanges.length ? `，已应用 ${vocabularyChanges.length} 个本地词库建议` : ''}`,
        )
        batchOcrProgress.setStep('validate', 'running', '正在检查课程字段与行列对应')
        const recognizedText = table.batchText || result.text
        batchText.value = (batchText.value ? batchText.value + '\n' : '') + recognizedText
        summaries.push({ name: file.name, table, result })
        const currentCourses = summaries.reduce((sum, item) => sum + item.table.courses.length, 0)
        const currentReviews = summaries.reduce((sum, item) => sum + item.table.diagnostics.reviewCount, 0)
        batchOcrProgress.setPartial({ 图片: `${summaries.length}/${files.length}`, 课程: currentCourses, 建议确认: currentReviews }, `第 ${index + 1}/${files.length} 张处理完成`)
        } catch (e) {
          if (e?.name === 'AbortError') return
          failures.push(`${file.name}：${e.message}`)
          batchOcrProgress.activity(`第 ${index + 1}/${files.length} 张失败，已保留此前结果`)
        }
      }
      if (!summaries.length && failures.length) {
        batchError.value = `图片识别失败：${failures.join('；')}`
        const engineFailed = isOcrEngineFailure(batchOcrProgress, failures.join('；'))
        if (!engineFailed) batchOcrProgress.setStep('engine', 'completed', '识别引擎已启动')
        batchOcrProgress.fail(engineFailed ? 'engine' : 'recognize', batchError.value, { retry: true })
        return
      }
      batchOcrProgress.setStep('validate', failures.length ? 'warning' : 'completed', failures.length ? `${failures.length} 张图片需要重试` : '课程字段与结构检查完成')
      batchOcrProgress.setStep('preview', 'running', '正在生成可编辑导入预览')
      const courseCount = summaries.reduce((sum, item) => sum + item.table.courses.length, 0)
      const reviewCount = summaries.reduce((sum, item) => sum + item.table.diagnostics.reviewCount, 0)
      ocrSummary.value = courseCount
        ? `已从 ${summaries.length} 张图片恢复 ${courseCount} 门课程${reviewCount ? `，其中 ${reviewCount} 门建议确认` : ''}。请检查预览后再导入。`
        : '已提取图片文字，但没有可靠恢复表格位置。可裁剪到课表区域后重试，或在文本框补充星期与节次。'
      batchError.value = failures.length ? `部分图片未识别：${failures.join('；')}` : ''
      batchOcrProgress.setStep('preview', 'completed', '导入预览已生成，尚未写入课表')
      batchOcrProgress.finish(
        failures.length ? `已保留 ${summaries.length} 张图片的结果，${failures.length} 张需要重试` : '全部图片识别完成，请确认预览',
        failures.length || reviewCount ? 'warning' : 'completed',
      )
    } finally {
      if (batchOcrController === controller) batchOcrController = null
    }
  }

  function retryBatchOCR() {
    if (retryableImport?.type === 'excel') void runExcelImport(retryableImport.file)
    else if (lastBatchFiles.length) void runTimetableOCR(lastBatchFiles)
  }

  function continueBatchResults() {
    batchOcrProgress.reset()
  }


  // KeepAlive 离开页面不会卸载组件；此时主动取消 OCR，避免它继续占用新页面的 CPU。
  function stopOcr() {
    if (batchOcrProgress.state.status === 'running') void batchOcrProgress.cancel()
    else batchOcrController?.abort()
  }

  return {
    showImageCropper,
    cropImageFile,
    batchOcrProgress,
    stopOcr,
    ocrImage,
    selectCropImage,
    importExcel,
    recognizeCroppedImage,
    retryBatchOCR,
    continueBatchResults,
  }
}
