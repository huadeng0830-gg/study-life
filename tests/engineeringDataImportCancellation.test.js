// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

const control = vi.hoisted(() => ({ ocr: vi.fn(), parseHook: null }))
vi.mock('../src/composables/ocrPipeline.js', () => ({ performOCR: control.ocr }))
vi.mock('../src/composables/timetableLayoutParser.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, parseTimetableColumns: (...args) => {
    const result = actual.parseTimetableColumns(...args)
    control.parseHook?.()
    return result
  } }
})
vi.mock('@e965/xlsx', () => {
  const api = {
    read: () => ({ SheetNames: ['虚构课程'], Sheets: { '虚构课程': {} } }),
    utils: { sheet_to_json: () => [['课程名称', '星期', '节次', '周次', '教室'], ['虚构课程', '周一', '1-2节', '1-16周', '虚构101']] },
  }
  return { ...api, default: api }
})
vi.mock('../src/composables/dataVault.js', () => ({
  clearDataVault: vi.fn(async () => true), mirrorLocalValue: vi.fn(async () => true),
  mirrorLocalValues: vi.fn(async () => true), setMirrorErrorHandler: vi.fn(), setMirrorTimingHandler: vi.fn(),
}))

const scopes = []
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()
  control.ocr.mockReset()
  control.parseHook = null
})
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  vi.clearAllTimers()
  vi.useRealTimers()
})
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const image = { name: 'fictional.png', type: 'image/png' }
const ocrResult = { text: '虚构课程 周一 1-2节 1-16周', columns: [{ day: 0, text: '虚构课程\n1-16周\n虚构101\n1-2节', confidence: 95 }] }

async function importer(loadBatchParser = vi.fn(async () => {})) {
  const parser = await import('../src/composables/courseParser.js')
  const { useScheduleOcrImport } = await import('../src/composables/scheduleOcrImport.js')
  const scope = effectScope()
  scopes.push(scope)
  const input = { courses: ref([]), batchText: ref('已有预览'), batchError: ref(''), ocrSummary: ref(''), rememberCourseReviews: vi.fn(), loadBatchParser, getBatchParserApi: () => parser }
  const api = scope.run(() => useScheduleOcrImport(input))
  return { api, input }
}

describe('取消导入后后置 await 不得发布旧结果', () => {
  it('Excel 已读取并停在批量解析器加载时，取消不再追加预览', async () => {
    const gate = deferred()
    const load = vi.fn(() => gate.promise)
    const { api, input } = await importer(load)
    const running = api.importExcel({ target: { value: '', files: [{ name: 'fictional.xlsx', arrayBuffer: async () => new ArrayBuffer(0) }] } })
    await vi.waitFor(() => expect(load).toHaveBeenCalled())
    api.stopOcr()
    gate.resolve()
    await running
    expect(input.batchText.value).toBe('已有预览')
    expect(api.batchOcrProgress.state.status).toBe('cancelled')
  })

  it('图片布局解析期间取消，真实解析完成也不能追加预览或课程审阅', async () => {
    const { api, input } = await importer()
    control.ocr.mockResolvedValue(ocrResult)
    control.parseHook = () => api.stopOcr()
    await api.ocrImage({ target: { value: '', files: [image] } })
    expect(input.batchText.value).toBe('已有预览')
    expect(input.rememberCourseReviews).not.toHaveBeenCalled()
    expect(api.batchOcrProgress.state.status).toBe('cancelled')
  })

  it('取消的旧图片请求晚到时不能覆盖后来成功的导入', async () => {
    const gate = deferred()
    const { api, input } = await importer()
    control.ocr.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(ocrResult)
    const old = api.ocrImage({ target: { value: '', files: [image] } })
    await vi.waitFor(() => expect(control.ocr).toHaveBeenCalledTimes(1))
    api.stopOcr()
    const current = api.ocrImage({ target: { value: '', files: [image] } })
    await current
    const preview = input.batchText.value
    gate.resolve({ ...ocrResult, text: '已取消的旧图片' })
    await old
    expect(input.batchText.value).toBe(preview)
    expect(input.rememberCourseReviews).toHaveBeenCalledTimes(1)
  })

  it('作息图片请求取消后晚到，不能生成识别草稿', async () => {
    const gate = deferred()
    control.ocr.mockReturnValue(gate.promise)
    const flow = await import('../src/composables/scheduleOcrFlow.js')
    const { recognitionDraft } = await import('../src/composables/recognitionSchemes.js')
    const running = flow.runParseImage(image)
    await vi.waitFor(() => expect(control.ocr).toHaveBeenCalled())
    flow.stopScheduleOcr()
    gate.resolve({ text: '第一节 08:00-08:45' })
    await running
    expect(recognitionDraft.value).toBeNull()
    flow.scheduleOcrProgress.dispose()
  })
})
