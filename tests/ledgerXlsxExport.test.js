// @vitest-environment happy-dom
/**
 * Excel 导出的实际产物：读回文件逐项核对。
 *
 * 【为什么必须读回而不是断言源码】导出文件好不好看、有没有数字格式、汇总对不对，
 * 这些都是**产物属性**：写法看着对，落盘可能全丢。所以这里真的写出 xlsx 再读回来，
 * 断言单元格的值、格式字符串、列宽和工作表顺序。
 *
 * 导出曾经一个用例都没有，于是它可以一直是「一堆裸数字 + 没有任何汇总」而不被发现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expenses } from '../src/composables/ledger.js'
import { useLedgerFx } from '../src/composables/ledgerFx.js'
import { appToday } from '../src/composables/timeContext.js'
import { mySpendYuan } from '../src/composables/ledgerSplit.js'

const { fx } = useLedgerFx()

let captured = null
let anchor = null

/** 拦住下载动作，只把 Blob 留下来。 */
function captureDownloads() {
  const realCreate = URL.createObjectURL
  const realRevoke = URL.revokeObjectURL
  captured = []
  URL.createObjectURL = (blob) => { captured.push(blob); return 'blob:test' }
  URL.revokeObjectURL = () => {}
  anchor = document.createElement('a')
  const realClick = window.HTMLAnchorElement.prototype.click
  window.HTMLAnchorElement.prototype.click = () => {}
  return () => {
    URL.createObjectURL = realCreate
    URL.revokeObjectURL = realRevoke
    window.HTMLAnchorElement.prototype.click = realClick
  }
}

function restore() {
  captured = null
}

beforeEach(() => {
  captured = null
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  expenses.value = []
})
afterEach(() => {
  restore()
  expenses.value = []
  fx.value = { base: 'CNY', rates: {}, updatedAt: '' }
  document.body.innerHTML = ''
})

/** 造一组带分摊与外币的记录，把导出要处理的每种分支都覆盖到。 */
function seedRecords(month) {
  expenses.value = [
    { id: 'x1', name: '午饭', amount: 30.5, cat: 'food', date: `${month}-01`, time: '12:00', direction: 'expense', createdAt: `${month}-01T12:00:00.000Z` },
    { id: 'x2', name: '打车', amount: 20, cat: 'transport', date: `${month}-02`, time: '09:00', direction: 'expense', createdAt: `${month}-02T09:00:00.000Z` },
    { id: 'x3', name: '工资', amount: 5000, cat: 'other', date: `${month}-03`, time: '10:00', direction: 'income', createdAt: `${month}-03T10:00:00.000Z` },
    // 分摊：总额 100，我只承担 60 → 汇总按 60 算，而不是 100
    { id: 'x4', name: '聚餐', amount: 100, cat: 'food', date: `${month}-04`, time: '19:00', direction: 'expense', split: { total: 100, mine: 60, participants: [{ label: '我', amount: 60 }, { label: '同事', amount: 40 }] }, createdAt: `${month}-04T19:00:00.000Z` },
    // 外币：绝不与 CNY 相加
    { id: 'x5', name: '订阅', amount: 9.99, currency: 'USD', cat: 'sub', date: `${month}-05`, time: '08:00', direction: 'expense', createdAt: `${month}-05T08:00:00.000Z` },
    // 退款：抵减支出
    { id: 'x6', name: '退货', amount: 30.5, cat: 'food', date: `${month}-06`, time: '15:00', direction: 'refund', createdAt: `${month}-06T15:00:00.000Z` },
  ]
}

async function exportXlsx(month) {
  const { useLedgerExport } = await import('../src/composables/ledgerView/export.js')
  const api = useLedgerExport({
    getMonth: () => month,
    personalAmount: (item) => mySpendYuan(item, item.currency),
    baseCurrency: { value: fx.value.base },
    notify: () => {},
  })
  const release = captureDownloads()
  try {
    await api.exportLedgerXlsx()
  } finally {
    release()
  }
  expect(captured, '没有产生下载文件').toHaveLength(1)
  const XLSX = await import('@e965/xlsx')
  const buffer = await captured[0].arrayBuffer()
  // cellStyles 必须开：不带它读回来时列宽（!cols）和数字格式（z）会被丢掉，
  // 于是「有没有格式」这件事根本测不出来（第一版就踩了这个坑）。
  return XLSX.read(new Uint8Array(buffer), { type: 'array', cellStyles: true })
}

/** 把工作表读成二维数组，用「行标签」取值，避免用例里写死行号。 */
async function summaryRows(book) {
  const XLSX = await import('@e965/xlsx')
  return XLSX.utils.sheet_to_json(book.Sheets['汇总'], { header: 1, blankrows: false })
}

describe('Excel 导出：汇总表', () => {
  it('汇总表排在第一个，打开就能看到这个月花了多少', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)

    expect(book.SheetNames[0], '汇总表应该是第一个工作表').toBe('汇总')
    expect(book.SheetNames).toContain('账单明细')
  })

  it('汇总只讲支出：合计、退款、净额、笔数，且口径是「我承担」', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const rows = await summaryRows(book)

    const find = (label) => rows.find((row) => row[0] === label)
    const cny = (label) => find(label)[1]

    // 支出：30.5 + 20 + 60(分摊后的我承担) → CNY 只有 110.5
    expect(cny('支出合计')).toBeCloseTo(110.5, 2)
    expect(cny('　其中 退款')).toBeCloseTo(30.5, 2)
    // 支出净额 = 110.5 - 30.5 = 80
    expect(cny('支出净额（支出 − 退款）')).toBeCloseTo(80, 2)
    // 笔数只数支出笔，退款与收入都不算
    expect(cny('支出笔数')).toBe(3)
  })

  it('汇总表里不再出现收入与结余（本表只讲花了多少）', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const rows = await summaryRows(book)
    const labels = rows.map((row) => String(row[0] ?? ''))

    expect(labels).not.toContain('收入合计')
    expect(labels.some((label) => label.includes('结余')), '汇总表不该再出现结余').toBe(false)
    // 收入那条记录仍然导出在明细里，只是不进汇总
    expect(labels.join('|')).toContain('只统计支出')
  })

  it('不同币种分列，绝不相加（金额列本来就不折算）', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const rows = await summaryRows(book)

    const header = rows.find((row) => row[0] === '项目')
    expect(header.slice(1)).toEqual(['CNY', 'USD'])
    const usd = (label) => rows.find((row) => row[0] === label)[2]
    expect(usd('支出合计')).toBeCloseTo(9.99, 2)
    // 基准币种排在第一，外币在第二
    expect(header.indexOf('CNY')).toBeLessThan(header.indexOf('USD'))
  })

  it('给出分类排行与占比，直接回答「钱花在哪」', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const rows = await summaryRows(book)

    const titles = rows.filter((row) => typeof row[0] === 'string' && row[0].startsWith('支出分类 Top'))
    expect(titles.length, '缺少分类排行区块').toBeGreaterThan(0)
    const foodRow = rows.find((row) => row[0] === '餐饮')
    expect(foodRow, '缺少餐饮分类行').toBeTruthy()
    // 餐饮 = 30.5 + 60(聚餐) = 90.5
    expect(foodRow[1]).toBeCloseTo(90.5, 2)
    // 占比的分母必须是**毛支出** 110.5，用净额 80 会算出 113% 这种一眼假的数
    expect(foodRow[2]).toBeCloseTo(90.5 / 110.5, 4)
    expect(foodRow[2]).toBeLessThanOrEqual(1)
  })

  it('各分类占比之和不超过 100%（分母口径错误会立刻露馅）', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const rows = await summaryRows(book)

    // 取第一张分类表（CNY）的占比列。
    // 注意 sheet_to_json 用了 blankrows:false，表格之间的空行会被丢掉，
    // 所以不能靠「遇到空行就停」来界定一张表 —— 只能靠「占比列不再是数字」。
    const start = rows.findIndex((row) => typeof row[0] === 'string' && row[0].startsWith('支出分类 Top'))
    expect(start).toBeGreaterThanOrEqual(0)
    const collected = []
    for (let i = start + 2; i < rows.length; i += 1) {
      const row = rows[i]
      if (!row || typeof row[0] !== 'string' || typeof row[2] !== 'number') break
      collected.push(row[2])
    }
    expect(collected.length, '一张分类都没解析到').toBeGreaterThan(0)
    const total = collected.reduce((sum, value) => sum + value, 0)
    expect(total, '分类占比之和超过 100%，说明分母用错了').toBeLessThanOrEqual(1.0001)
  })
})

describe('Excel 导出：明细表的可读性', () => {
  it('金额列带千分位数字格式，不再是一串裸数字', async () => {
    const month = String(appToday.value).slice(0, 7)
    expenses.value = [{ id: 'big', name: '大额', amount: 1234567.891, cat: 'other', date: `${month}-01`, time: '10:00', direction: 'expense', createdAt: `${month}-01T10:00:00.000Z` }]
    const book = await exportXlsx(month)
    const sheet = book.Sheets['账单明细']
    // 金额是 F 列（第 6 列），第一行数据是第 2 行
    const amountCell = sheet['F2']
    expect(amountCell, '金额单元格不存在').toBeTruthy()
    expect(amountCell.z, '金额列没有数字格式').toBe('#,##0.00')
    const mineCell = sheet['G2']
    expect(mineCell.z, '「我承担」列没有数字格式').toBe('#,##0.00')
  })

  it('列宽按内容设置，表头不会被 Excel 按文字宽度截断', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const sheet = book.Sheets['账单明细']
    expect(Array.isArray(sheet['!cols']), '没有列宽设置').toBe(true)
    expect(sheet['!cols']).toHaveLength(10)
    // 名称与备注最容易长，宽度必须明显大于默认
    expect(sheet['!cols'][2].wch, '名称列太窄').toBeGreaterThanOrEqual(20)
    expect(sheet['!cols'][9].wch, '备注列太窄').toBeGreaterThanOrEqual(24)
    expect(sheet['!cols'][0].wch, '日期列太窄').toBeGreaterThanOrEqual(10)
  })

  it('表头带筛选下拉，明细多的时候不用手动拉筛选条', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    expect(book.Sheets['账单明细']['!autofilter'], '缺少自动筛选').toBeTruthy()
  })

  it('汇总表的金额与占比也带数字格式', async () => {
    const month = String(appToday.value).slice(0, 7)
    seedRecords(month)
    const book = await exportXlsx(month)
    const XLSX = await import('@e965/xlsx')
    const sheet = book.Sheets['汇总']
    const ref = XLSX.utils.decode_range(sheet['!ref'])
    let moneyFormatted = 0
    let percentFormatted = 0
    for (let r = ref.s.r; r <= ref.e.r; r += 1) {
      for (let c = ref.s.c; c <= ref.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })]
        if (!cell) continue
        if (cell.z === '#,##0.00') moneyFormatted += 1
        if (cell.z === '0.0%') percentFormatted += 1
      }
    }
    expect(moneyFormatted, '汇总表没有任何金额格式').toBeGreaterThan(4)
    expect(percentFormatted, '汇总表没有任何占比格式').toBeGreaterThan(0)
  })

  it('该月没有记录时给出提示且不产出文件', async () => {
    const month = String(appToday.value).slice(0, 7)
    expenses.value = []
    let notified = ''
    const { useLedgerExport } = await import('../src/composables/ledgerView/export.js')
    const api = useLedgerExport({
      getMonth: () => month,
      personalAmount: (item) => mySpendYuan(item, item.currency),
      baseCurrency: { value: 'CNY' },
      notify: (message) => { notified = message },
    })
    const release = captureDownloads()
    try {
      await api.exportLedgerXlsx()
    } finally {
      release()
    }
    expect(captured, '空月份不该产出文件').toHaveLength(0)
    expect(notified).toContain('该月还没有可导出的记录')
  })
})
