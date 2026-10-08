// @vitest-environment happy-dom
//
// ocrPipeline.js 与 ocrService.js 此前是全仓**零覆盖**的两个文件（README 的主打功能
// "图片识课"整条链路没有任何测试）。这里不测识别质量——那需要真实引擎与真实图片——
// 而是测**接线**：引擎与 worker 必须来自本站，且在环境不满足时要给出可执行的提示。
//
// 最重要的一条是"不得出现 CDN 主机名"：只给 langPath 时 tesseract.js 会把 worker 与
// WASM 引擎指向 cdn.jsdelivr.net，于是断网/墙内/CDN 故障时识课直接不可用，
// 与"Local-first、不接入外部网络服务"冲突。这条断言就是为了钉死那个回归。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createWorker = vi.fn()

vi.mock('tesseract.js', () => ({
  PSM: { SPARSE_TEXT: '11' },
  createWorker: (...args) => createWorker(...args),
}))

vi.mock('../src/composables/courseParser.js', () => ({
  normalizeText: (value) => value,
  correctOCRErrors: (value) => value,
}))

const CDN_PATTERN = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/i

function fakeWorker() {
  return {
    recognize: vi.fn(async () => ({
      data: { text: '高等数学 周一 第1-2节 教学楼A201', confidence: 90, blocks: [] },
    })),
    setParameters: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
  }
}

function stubImagePipeline() {
  // happy-dom 的 createImageBitmap 会拒绝 File，canvas.getContext 也拿不到 2d 上下文。
  // 这里给一层最小替身，让 performOCR 能一路走到 ensureWorker —— 那才是本文件要测的地方。
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close() {} }))
  const ctx = {
    canvas: { width: 800, height: 600 },
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(800 * 600 * 4), width: 800, height: 600 }),
    putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: () => ({ width: 10 }), fillText() {},
    // happy-dom 的 2d 上下文是空壳，补齐 ocrPipeline 用到的方法。
    fillRect() {}, strokeRect() {}, clearRect() {}, save() {}, restore() {},
    translate() {}, scale() {}, rotate() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, stroke() {}, fill() {},
    getContext: () => ctx,
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  return ctx
}

async function loadPipeline() {
  vi.resetModules()
  return import('../src/composables/ocrPipeline.js')
}

function pngFile() {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' })
}

describe('OCR 引擎接线', () => {
  beforeEach(() => {
    createWorker.mockReset()
    createWorker.mockResolvedValue(fakeWorker())
    stubImagePipeline()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('没有 deviceMemory 时使用保守像素预算', async () => {
    const { maxPixelsFor } = await loadPipeline()
    expect(maxPixelsFor('accurate', Number.NaN)).toBe(6_500_000)
    expect(maxPixelsFor('accurate', 2)).toBe(4_000_000)
    expect(maxPixelsFor('accurate', 8)).toBe(12_000_000)
  })

  it('引擎与 worker 都指向本站资源，不出现任何 CDN 主机名', async () => {
    const { performOCR } = await loadPipeline()
    await performOCR(pngFile()).catch(() => {})

    expect(createWorker, '引擎没被创建，后面的断言就没意义了').toHaveBeenCalled()
    const options = createWorker.mock.calls[0][2]
    expect(options.langPath, '语言模型应指向本站 /ocr/').toMatch(/\/ocr\/?$/)
    expect(options.corePath, '必须显式给 corePath，否则引擎回退到 CDN').toBeTruthy()
    expect(options.workerPath, '必须显式给 workerPath，否则 worker 回退到 CDN').toBeTruthy()

    for (const [name, value] of [['langPath', options.langPath], ['corePath', options.corePath], ['workerPath', options.workerPath]]) {
      expect(String(value), `${name} 指向了外部 CDN：${value}`).not.toMatch(CDN_PATTERN)
    }
  })

  it('corePath 指向随包自带的 SIMD-LSTM 单文件，而不是 tesseract.js 的目录约定', async () => {
    const { performOCR } = await loadPipeline()
    await performOCR(pngFile()).catch(() => {})

    const { corePath } = createWorker.mock.calls[0][2]
    expect(corePath).toContain('tesseract-core-simd-lstm.wasm.js')
    // 目录形式会让浏览器在 relaxedsimd/simd/无SIMD 三者间挑，那需要随包发三个变体（约 19.7MB）。
    expect(corePath.endsWith('/'), '不能给目录，否则会挑到我们没有发布的变体').toBe(false)
  })

  it('自托管引擎文件确实存在于 public/ocr 下（防止引用了不存在的文件）', async () => {
    // 这里不能用 import.meta.url / new URL()：happy-dom 会接管 URL，把基准从
    // file:// 换成文档地址，读文件就报 "The URL must be of scheme file"
    // （同一坑见 vite.config.js 里关于 test 环境不统一设置的注释）。改用 cwd。
    const { readdirSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const files = readdirSync(resolve(process.cwd(), 'public/ocr'))
    expect(files, '缺少 tesseract-core-simd-lstm.wasm.js').toContain('tesseract-core-simd-lstm.wasm.js')
    expect(files, '缺少 tesseract-worker.min.js').toContain('tesseract-worker.min.js')
    expect(files, '缺少语言模型').toContain('chi_sim.traineddata')
  })

  it('不支持 SIMD 时立刻给出可执行提示，不创建引擎、也不做图像预处理', async () => {
    const original = WebAssembly.validate
    WebAssembly.validate = () => false
    try {
      const { performOCR } = await loadPipeline()
      await expect(performOCR(pngFile())).rejects.toThrow(/SIMD/)
      expect(createWorker, '环境不满足时不该还去建引擎').not.toHaveBeenCalled()
      expect(globalThis.createImageBitmap, '应在解码图片之前就失败').not.toHaveBeenCalled()
    } finally {
      WebAssembly.validate = original
    }
  })

  it('拒绝非图片文件', async () => {
    const { performOCR } = await loadPipeline()
    await expect(performOCR(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(/图片/)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('并发调用会被挡住', async () => {
    const { performOCR } = await loadPipeline()
    const first = performOCR(pngFile()).catch(() => {})
    await expect(performOCR(pngFile())).rejects.toThrow(/正在进行中/)
    await first
  })

  it('已中止的信号不会创建引擎', async () => {
    const { performOCR } = await loadPipeline()
    const controller = new AbortController()
    controller.abort()
    await expect(performOCR(pngFile(), null, { signal: controller.signal })).rejects.toThrow()
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('识别成功后返回文本与置信度', async () => {
    const { performOCR } = await loadPipeline()
    const result = await performOCR(pngFile())
    expect(result.text).toContain('高等数学')
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.wordCount).toBeGreaterThan(0)
  })
})
