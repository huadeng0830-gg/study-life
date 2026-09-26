import { computed, ref } from 'vue'
import { PALETTE, MAX_WEEK } from './store'
import { timeConfig } from './store/timeConfig.js'

export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 课程表的批量解析规则只会在用户主动打开「导入课程表」后使用。
// 保持它为独立异步模块，普通“查看课程表”不再解析这块业务代码。
let batchParserApi = null
let batchParserTask = null
const batchParserReady = ref(false)

function loadBatchParser() {
  if (batchParserApi) return Promise.resolve(batchParserApi)
  batchParserTask ??= import('./courseParser.js').then((api) => {
    batchParserApi = api
    batchParserReady.value = true
    return api
  })
  return batchParserTask
}

/**
 * 批量文本录入面板（从 ScheduleView 拆出）：粘贴文本 → 逐行解析 → 预览 → 导入。
 *
 * 解析器是惰性加载的，所以 `batchParserReady` 这个响应式标记必须被依赖：
 * 否则首次计算得到空数组后会被 computed 缓存，解析器加载完成也不会刷新。
 *
 * `beginCourseImport` 由宿主注入：它属于导入审阅（scheduleImportReview），
 * 而那个 composable 要等本模块的 batchError / message 就绪后才实例化，
 * 所以宿主传进来的是一个把调用推迟到用户点击时的惰性委托。
 */
export function useScheduleBatchText({
  courses,
  beginCourseImport,
}) {
  const showBatch = ref(false)
  const batchText = ref('')
  const batchError = ref('')
  const ocrSummary = ref('')
  const message = ref('')
  const batchReviewMetadata = ref({})
  const batchReviewByLine = ref({})

  // 在打开批量工具前才加载文本解析器；不会影响课程表首次进入。
  async function openBatchShift() {
    await loadBatchParser()
    batchText.value = ''
    batchError.value = ''
    ocrSummary.value = ''
    batchReviewMetadata.value = {}
    batchReviewByLine.value = {}
    message.value = ''
    showBatch.value = true
  }

  function batchCourseKey(course) {
    if (!course) return ''
    return [course.name, course.day, course.start, course.end, course.startWeek, course.endWeek, course.weekType, course.room || '', course.teacher || ''].join('|')
  }

  function rememberCourseReviews(items, lineOffset = 0) {
    const next = { ...batchReviewMetadata.value }
    const nextByLine = { ...batchReviewByLine.value }
    for (const [index, course] of (items || []).entries()) {
      const confidence = Number(course.confidence) || 0
      if (!course.needsReview && confidence >= 70) continue
      const reasons = [...(course.reviewReasons || [])]
      if (confidence < 70) reasons.push(`OCR 文字置信度 ${Math.round(confidence)}%`)
      const reviewReasons = reasons.length ? reasons : ['OCR 结构识别结果需要核对']
      next[batchCourseKey(course)] = reviewReasons
      nextByLine[lineOffset + index + 1] = reviewReasons
    }
    batchReviewMetadata.value = next
    batchReviewByLine.value = nextByLine
  }

  function clearBatchInput() {
    batchText.value = ''
    batchReviewMetadata.value = {}
    batchReviewByLine.value = {}
  }

  function batchPeriodNumber(periodId) {
    if (!batchParserApi) return null
    return batchParserApi.numberedPeriodOptions(timeConfig.value.periods)
      .find((period) => period.id === periodId)?.number ?? null
  }

  const batchPeriodOptions = computed(() => {
    // batchParserApi 不是响应式变量，必须显式依赖 ready 标记；否则首次计算得到
    // 空数组后会被 computed 缓存，解析器加载完成也不会刷新节次下拉。
    if (!batchParserReady.value || !batchParserApi) return []
    return batchParserApi.numberedPeriodOptions(timeConfig.value.periods)
  })

  function replaceBatchRow({ sourceIndex, data }) {
    const startPeriod = batchPeriodNumber(data.start)
    const endPeriod = batchPeriodNumber(data.end)
    if (!startPeriod || !endPeriod || startPeriod > endPeriod) {
      batchError.value = '开始节次不能晚于结束节次'
      return
    }
    const weekType = data.weekType === 'odd' ? '\t单周' : data.weekType === 'even' ? '\t双周' : ''
    const room = data.room ? `\t地点:${data.room}` : ''
    const teacher = data.teacher ? `\t教师:${data.teacher}` : ''
    const replacement = `${data.name}\t${DAYS[data.day]}\t${startPeriod}-${endPeriod}节\t${data.startWeek}-${data.endWeek}周${weekType}${room}${teacher}`
    const lines = batchText.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (sourceIndex < 1 || sourceIndex > lines.length) return
    lines[sourceIndex - 1] = replacement
    batchText.value = lines.join('\n')
    const remainingByLine = { ...batchReviewByLine.value }
    delete remainingByLine[sourceIndex]
    batchReviewByLine.value = remainingByLine
    batchError.value = ''
  }

  const batchRows = computed(() => {
    // The parser is lazy-loaded. This reactive flag makes an already-open modal
    // recalculate as soon as the module is ready instead of being stuck at 0.
    if (!batchParserReady.value || !batchParserApi) return []
    const lines = batchText.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => !(index === 0 && /课程.*星期/.test(line)))
      .map(({ line, index }) => {
        const row = batchParserApi.parseBatchLine(line, index + 1, timeConfig, MAX_WEEK)
        const reasons = batchReviewByLine.value[row.sourceIndex]
          || (row.data ? batchReviewMetadata.value[batchCourseKey(row.data)] : null)
        return reasons
          ? { ...row, needsReview: true, reviewReasons: [...new Set([...(row.reviewReasons || []), ...reasons])] }
          : row
      })
  })

  const validBatchCount = computed(() => batchRows.value.filter((row) => row.data).length)
  const invalidBatchCount = computed(() => batchRows.value.filter((row) => row.error).length)
  const needsReviewCount = computed(() => batchRows.value.filter((row) => row.needsReview).length)

  function importBatch() {
    batchError.value = ''
    if (!batchRows.value.length) {
      batchError.value = '请先粘贴课程表内容'
      return
    }
    if (invalidBatchCount.value) {
      batchError.value = '请先修正预览中标红的内容'
      return
    }

    const stamp = Date.now()
    const incoming = batchRows.value
      .filter((row) => row.data)
      .map((row, index) => ({
        id: `c${stamp}_${index}`,
        color: PALETTE[(courses.value.length + index) % PALETTE.length],
        ...row.data,
      }))
    beginCourseImport(incoming, { source: 'batch', reviewCount: needsReviewCount.value })
  }

  function continueBatchImport() {
    message.value = ''
    clearBatchInput()
    ocrSummary.value = ''
  }

  function finishBatchImport() {
    message.value = ''
    showBatch.value = false
  }

  return {
    showBatch,
    batchText,
    batchError,
    ocrSummary,
    message,
    batchRows,
    validBatchCount,
    invalidBatchCount,
    needsReviewCount,
    batchPeriodOptions,
    openBatchShift,
    rememberCourseReviews,
    clearBatchInput,
    replaceBatchRow,
    importBatch,
    continueBatchImport,
    finishBatchImport,
    loadBatchParser,
    getBatchParserApi: () => batchParserApi,
  }
}
