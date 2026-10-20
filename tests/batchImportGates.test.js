// @vitest-environment happy-dom
/**
 * 批量录入课程面板的两道入口闸门。
 *
 * 【1.11 · 离线 + 识别资源未缓存】入口要自己说清楚「为什么现在不能识图」。
 * 面板标题写着「上传图片识别」，但这台设备可能既离线、又从未下载过模型（约 6 MB）。
 * 探测是纯本地的（CacheStorage + navigator.onLine），所以这里也顺带断言：
 * 无论哪条路径，都**不会替用户提前发起下载**。
 *
 * 【3.4 · 复核清单不是建议】标题写「请逐项确认以下 N 门课程」，可主按钮此前只看
 * validCount/invalidCount —— 那些「需要确认」的行可以一键全量导入，标题成了摆设。
 * 现在必须显式勾选一次；行内容一变（重新解析或逐行修改）确认立即作废重勾。
 * 有无效行时仍然阻断，并把「不会跳过它们」说清楚——静默跳过等于悄悄少录几门课。
 */
import { createApp, h, nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BatchImportModal from '../src/components/schedule/BatchImportModal.vue'
import { resetOcrAvailability } from '../src/composables/ocrCapability.js'

const ASSET_FILES = ['chi_sim.traineddata', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-worker.min.js']
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches')
const originalOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine')

function setOnline(value) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value, configurable: true, writable: true })
}
function installCaches(cachedFiles = ASSET_FILES) {
  Object.defineProperty(globalThis, 'caches', {
    value: { match: async (url) => (ASSET_FILES.some((file) => String(url).endsWith(file) && cachedFiles.includes(file)) ? { ok: true } : undefined) },
    configurable: true,
    writable: true,
  })
}

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const PERIODS = [{ id: 'p1', number: 1, label: '08:00' }, { id: 'p2', number: 2, label: '08:45' }]
const COURSE_A = { name: '虚构高等数学', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, weekType: 'all', room: '虚构A201', teacher: '虚构张老师' }
const VALID_ROW = { sourceIndex: 1, data: COURSE_A, cells: ['虚构高等数学'], needsReview: false, error: '' }
const REVIEW_ROW = { sourceIndex: 2, data: { ...COURSE_A, name: '虚构大学英语' }, cells: ['虚构大学英语'], needsReview: true, reviewReasons: ['虚构的待确认原因'], confidence: { score: 0.62, details: { hasRoom: false } }, error: '' }
const INVALID_ROW = { sourceIndex: 3, data: null, cells: ['虚构残缺课程'], needsReview: false, error: '缺少星期与节次' }

function makeProgress() {
  return {
    state: { status: 'idle', active: false, visible: false, steps: [], latestActivity: '' },
    elapsedSeconds: { value: 0 },
    activityAgeSeconds: { value: 0 },
    isStalled: { value: false },
  }
}

let state
let app
let host
let imported

/** 用响应式 props 包一层，才能在同一个用例里改 rows / validCount 观察闸门重算。 */
async function mount(overrides = {}) {
  imported = vi.fn()
  state = reactive({
    show: true,
    text: '虚构高等数学 周一 1-2节 1-16周',
    rows: [VALID_ROW],
    validCount: 1,
    invalidCount: 0,
    reviewCount: 0,
    days: DAYS,
    periods: PERIODS,
    maxWeek: 25,
    progress: makeProgress(),
    summary: '',
    message: '',
    error: '',
    canUndo: false,
    ...overrides,
  })
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ setup: () => () => h(BatchImportModal, { ...state, onImport: imported }) })
  app.mount(host)
  await settle()
}

/** OCR 探测是异步的（读 CacheStorage），要等两轮微任务 + 一次渲染。 */
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function importButton() {
  return [...document.querySelectorAll('.actions button')].find((button) => button.classList.contains('btn-primary'))
}
function imageInputs() {
  return [...document.querySelectorAll('input[type="file"][accept="image/*"]')]
}
function excelInput() {
  return document.querySelector('input[type="file"][accept*=".xlsx"]')
}
function reviewAck() {
  return document.querySelector('.review-ack input[type="checkbox"]')
}
function bodyText() {
  return document.querySelector('.batch-import')?.textContent || ''
}
function setCheckbox(input, checked) {
  input.checked = checked
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  resetOcrAvailability()
  // 默认：离线 + 没缓存过模型——最容易出错的路径。
  setOnline(false)
  installCaches([])
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  resetOcrAvailability()
  if (originalCaches) Object.defineProperty(globalThis, 'caches', originalCaches)
  else Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true, writable: true })
  if (originalOnLine) Object.defineProperty(globalThis.navigator, 'onLine', originalOnLine)
})

describe('批量录入：离线 + 未缓存识别模型', () => {
  it('离线且没缓存过模型：图片入口禁用并说明「先联网加载一次」，Excel/文字入口不受影响', async () => {
    await mount()
    for (const input of imageInputs()) expect(input.disabled).toBe(true)
    expect(excelInput().disabled).toBe(false)
    expect(bodyText()).toContain('离线')
    expect(bodyText()).toContain('缓存识别模型')
    expect(bodyText()).toContain('先联网加载一次')
  })

  it('离线但模型已缓存：图片入口可用，并明确提示可离线识别', async () => {
    setOnline(false)
    installCaches(ASSET_FILES)
    await mount()
    for (const input of imageInputs()) expect(input.disabled).toBe(false)
    expect(bodyText()).toContain('识别模型已缓存')
    expect(bodyText()).not.toContain('还没有缓存识别模型')
  })

  it('在线但还没下载过模型：不阻断，沿用「首次识课需联网下载」的提示', async () => {
    setOnline(true)
    installCaches([])
    await mount()
    for (const input of imageInputs()) expect(input.disabled).toBe(false)
    expect(bodyText()).toContain('首次识课需联网下载识别模型')
  })
})

describe('批量录入：复核清单与无效行闸门', () => {
  it('有「需要确认」的行时不能直接导入，勾选核对后才放行', async () => {
    await mount({ rows: [VALID_ROW, REVIEW_ROW], validCount: 2, reviewCount: 1 })
    expect(importButton().disabled).toBe(true)
    expect(bodyText()).toContain('需要确认')
    expect(bodyText()).toContain('请先逐行核对后再导入')
    expect(reviewAck()).not.toBeNull()
    expect(bodyText()).toContain('不会跳过')

    setCheckbox(reviewAck(), true)
    await nextTick()
    expect(importButton().disabled).toBe(false)
    importButton().dispatchEvent(new Event('click', { bubbles: true }))
    expect(imported).toHaveBeenCalledTimes(1)
  })

  it('重新解析或逐行修改后确认作废，必须重新核对', async () => {
    await mount({ rows: [VALID_ROW, REVIEW_ROW], validCount: 2, reviewCount: 1 })
    setCheckbox(reviewAck(), true)
    await nextTick()
    expect(importButton().disabled).toBe(false)

    const added = { ...REVIEW_ROW, sourceIndex: 4, data: { ...REVIEW_ROW.data, name: '虚构近代史' } }
    state.rows = [...state.rows, added]
    state.validCount = 3
    state.reviewCount = 2
    await nextTick()
    expect(importButton().disabled).toBe(true)
    expect(bodyText()).toContain('还有 2 行需要确认')
  })

  it('有无效行时导入被阻断，并说明「不会跳过这些行」', async () => {
    await mount({ rows: [VALID_ROW, INVALID_ROW], validCount: 1, invalidCount: 1, reviewCount: 0 })
    // 断言的是 `disabled` 本身：浏览器不会把点击投递给 disabled 按钮。
    // 这里刻意不补一发 dispatchEvent —— 合成事件绕得过这个属性，用它「验证」守卫
    // 只会得到一个看起来更严格、实际上假的结论。
    expect(importButton().disabled).toBe(true)
    expect(bodyText()).toContain('1 行需修改')
    expect(bodyText()).toContain('不会跳过')
    expect(reviewAck()).toBeNull()
  })

  it('没有可导入内容时主按钮同样禁用（既有行为不变）', async () => {
    await mount({ rows: [], text: '', validCount: 0, invalidCount: 0, reviewCount: 0 })
    expect(importButton().disabled).toBe(true)
  })

  it('只有可导入行、没有待确认项时：主按钮可用且不显示阻断原因', async () => {
    await mount()
    expect(importButton().disabled).toBe(false)
    expect(document.querySelector('.import-block-reason')).toBeNull()
  })
})