// @vitest-environment happy-dom
//
// 微信 / 支付宝账单导入。断言重点放在**会静默算错账**的地方：
//   1. GBK 编码 —— 支付宝账单是 GBK，UTF-8 解码会变乱码；
//   2. 表头行号会漂移（微信前 16 行、支付宝前 24~25 行都是说明，且随版本变）；
//   3. 中性交易 / 转账必须排除，否则污染月度预算与分类排行；
//   4. 退款要映射成 direction:'refund' 而不是负数支出。
import { describe, expect, it } from 'vitest'
import {
  classifyFlowProbe,
  decodeBillText,
  guessCategory,
  parseAmount,
  parseBillFile,
  parseCsv,
  splitDateTime,
} from '../src/composables/ledgerBillImport.js'

// 说明行是单列（字符串），表头与数据行是真正的多列（数组）。
// 注意：如果把表头也写成字符串，csvToBuffer 会因为它含逗号而把整行加上引号，
// parseCsv 就只会读出 1 个字段 —— 这个坑本文件第一版就踩过。
const WECHAT_ROWS = [
  '微信支付账单明细列表',
  '微信昵称：[脱敏]',
  '起始时间：[2026-09-01 00:00:00] 终止时间：[2026-09-30 23:59:59]',
  '导出类型：全部',
  '说明：本次导出账单包含以下内容……（此处官方说明文案会随版本变化，行数也会变）',
  '----------------------微信支付账单明细列表--------------------',
  ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
  ['2026-09-01 12:30:00', '商户消费', '食堂', '午餐', '支出', '¥18.50', '零钱', '支付成功', '4200001234567890', '1001', ''],
  ['2026-09-02 08:10:00', '转账', '零钱充值', '充值', '不计收支', '¥100.00', '零钱', '充值成功', '4200001234567891', '1002', ''],
  ['2026-09-03 19:00:00', '退款', '食堂', '午餐退款', '收入', '¥18.50', '零钱', '已全额退款', '4200001234567892', '1001', ''],
  ['2026-09-04 09:00:00', '转账', '妈妈', '转账', '不计收支', '¥500.00', '零钱', '转账成功', '4200001234567893', '1003', ''],
  ['2026-09-05 15:20:00', '商户消费', '盒马', '牛奶', '支出', '¥32.80', '招商银行', '支付成功', '4200001234567894', '1004', ''],
]

// 支付宝真实表头的三个关键差异（第一版按微信列名写死，全部判成 unknown）：
// 1. 没有 `收/支` 列 —— 方向靠 `类型` + `资金状态`；
// 2. 金额列是**全角**括号的 `金额（元）`；
// 3. 时间列叫 `交易创建时间`，不是 `交易时间`。
const ALIPAY_ROWS = [
  '支付宝交易记录明细查询',
  '账号:[脱敏]',
  '---------------------------------交易记录明细列表------------------------------------',
  '起始时间:[2026-09-01 00:00:00]    终止时间:[2026-09-30 23:59:59]',
  '---------------------------------交易记录明细列表------------------------------------',
  ['交易号', '商家订单号', '交易创建时间', '交易对方', '商品名称', '金额（元）', '类型', '收/付款方式', '交易状态', '资金状态'],
  ['2026090122000001', '2026090122000001', '2026-09-01 12:30:00', '食堂', '午餐', '18.50', '即时交易', '余额宝', '交易成功', '已支出'],
  ['2026090322000002', '2026090322000002', '2026-09-03 09:00:00', '花呗', '还款', '1000.00', '转账', '余额', '交易成功', '已支出'],
  ['2026090422000003', '2026090422000003', '2026-09-04 07:00:00', '滴滴出行', '车费', '23.00', '即时交易', '余额', '交易成功', '已支出'],
]

// 真实 GBK 字节。这些常量不是猜的：用 TextDecoder('gbk') 扫描 GBK 码位反查得到
// （浏览器与 Node 都原生支持 GBK 解码，所以不需要任何编解码依赖）。
const GBK_BYTES = {
  支: [214, 167], 出: [179, 246], 收: [202, 213], 入: [200, 235],
  餐: [178, 205], 饮: [210, 251], 资: [215, 202], 料: [],
}

function toGbkBytes(text) {
  const bytes = []
  for (const char of text) {
    const pair = GBK_BYTES[char]
    if (pair && pair.length === 2) bytes.push(pair[0], pair[1])
    else bytes.push(0x3f) // 无法表示的字符用 '?'
  }
  return new Uint8Array(bytes)
}

// rows 里既可以是字符串（单列行，比如账单说明），也可以是数组（真正的数据行）。
function csvToBuffer(rows, { bom = 'utf8' } = {}) {
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row]
    return cells.map((cell) => {
      const text = String(cell ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }).join(',')
  }).join('\r\n')
  const payload = new TextEncoder().encode(body)
  const head = bom === 'utf8' ? new Uint8Array([0xef, 0xbb, 0xbf]) : new Uint8Array(0)
  const merged = new Uint8Array(head.length + payload.length)
  merged.set(head, 0)
  merged.set(payload, head.length)
  return merged.buffer
}

describe('账单导入', () => {
  it('GBK 字节按 GBK 解出中文，按 UTF-8 解会乱码', () => {
    const bytes = toGbkBytes('支出收入餐饮')
    const gbk = decodeBillText(bytes.buffer)
    expect(gbk).toBe('支出收入餐饮')
    expect(gbk).not.toContain('\uFFFD')
    // 同一个字节用 UTF-8 解必须出现替换字符 —— 这正是需要回落 GBK 的判据
    expect(new TextDecoder('utf-8').decode(bytes)).toContain('\uFFFD')
  })

  it('CSV 解析处理引号转义、内嵌逗号与 CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"含,逗号","含""引号",z\r\n')
    expect(rows[1][0]).toBe('含,逗号')
    expect(rows[1][1]).toBe('含"引号')
  })

  it('可选行数上限在解析时停止构建超额行，默认仍解析完整文件', () => {
    const csv = 'id,title\n1,one\n2,two\n3,three\n'
    const limited = parseCsv(csv, { maxRows: 3 })

    expect(limited).toHaveLength(3)
    expect(limited.truncated).toBe(true)
    expect(parseCsv(csv)).toHaveLength(4)
    expect(parseCsv('id,title\n1,one', { maxRows: 3 }).truncated).toBe(false)
  })

  it('金额解析容忍货币符号与千分位', () => {
    expect(parseAmount('¥18.50')).toBe(18.5)
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('１２３')).toBe(123) // 全角数字
    expect(parseAmount('')).toBeNull()
  })

  it('日期时间拆分支持 - / 与可选时刻', () => {
    expect(splitDateTime('2026-09-01 12:30:00')).toEqual({ date: '2026-09-01', time: '12:30' })
    expect(splitDateTime('2026/9/1')).toEqual({ date: '2026-09-01', time: '' })
    expect(splitDateTime('乱码')).toEqual({ date: '', time: '' })
  })

  it('转账与还款被判为跳过，不计收支', () => {
    expect(classifyFlowProbe('不计收支', '转账')).toBe('skip')
    expect(classifyFlowProbe('不计收支', '零钱充值')).toBe('skip')
    expect(classifyFlowProbe('支出', '信用卡还款')).toBe('skip')
    expect(classifyFlowProbe('支出', '花呗')).toBe('skip')
    expect(classifyFlowProbe('支出', '商户消费')).toBe('expense')
    expect(classifyFlowProbe('收入', '红包')).toBe('income')
    // 转账类即使"收/支"写着收入也按搬运跳过：微信的转账类型无法仅凭收/支区分方向，
    // 记错方向会直接算错月度合计，所以宁可让用户在预览里逐条改。
    expect(classifyFlowProbe('收入', '转账')).toBe('skip')
  })

  it('分类猜测落到项目已有分类 key', () => {
    expect(guessCategory('食堂')).toBe('food')
    expect(guessCategory('滴滴出行')).toBe('transit')
    expect(guessCategory('超市', '牛奶')).toBe('shop')
    expect(guessCategory('水果店')).toBe('snack')
    expect(guessCategory('')).toBe('')
  })

  it('微信账单：扫到表头行为止，不写死行号', async () => {
    const result = await parseBillFile(csvToBuffer(WECHAT_ROWS))
    expect(result.source).toBe('wechat')
    expect(result.headerRow).toBe(6) // 说明文案变化时这个数字会漂移，所以是扫出来的
    // 5 行数据里：2 笔转账被排除，1 笔退款保留，2 笔支出保留
    expect(result.rows).toHaveLength(3)
    expect(result.skipped.transfers).toBe(2)
    const expense = result.rows.find((row) => row.name.includes('午餐'))
    expect(expense).toBeTruthy()
    expect(expense.direction).toBe('expense')
    expect(expense.amount).toBe(18.5)
    expect(expense.cat).toBe('food')
    const refund = result.rows.find((row) => row.direction === 'refund')
    expect(refund).toBeTruthy()
    expect(refund.amount).toBe(18.5)
  })

  it('退款映射成 direction:refund，而不是负数支出', async () => {
    const result = await parseBillFile(csvToBuffer(WECHAT_ROWS))
    for (const row of result.rows) {
      expect(row.amount, '金额恒为正，方向由 direction 表达').toBeGreaterThan(0)
    }
    expect(result.rows.filter((row) => row.direction === 'refund')).toHaveLength(1)
  })

  it('支付宝账单：还款被排除，打车被保留', async () => {
    const result = await parseBillFile(csvToBuffer(ALIPAY_ROWS))
    expect(result.source).toBe('alipay')
    expect(result.rows).toHaveLength(2)
    expect(result.rows.find((row) => row.name.includes('车费')).cat).toBe('transit')
    expect(result.rows.some((row) => row.amount === 1000)).toBe(false)
  })

  it('同一份文件导入两次不产生重复（交易单号去重）', async () => {
    const first = await parseBillFile(csvToBuffer(WECHAT_ROWS))
    const keys = first.rows.map((row) => row.sourceId)
    const second = await parseBillFile(csvToBuffer(WECHAT_ROWS), { existingKeys: keys })
    expect(second.rows).toHaveLength(0)
    expect(second.skipped.duplicates).toBe(3)
  })

  it('缺少稳定单号时退化为指纹去重', async () => {
    // 去掉交易单号列（索引 8），强制走指纹路径
    const withoutOrder = WECHAT_ROWS.map((row) => (Array.isArray(row)
      ? row.filter((_, index) => index !== 8)
      : row))
    const first = await parseBillFile(csvToBuffer(withoutOrder))
    expect(first.rows.length).toBeGreaterThan(0)
    const second = await parseBillFile(csvToBuffer(withoutOrder), { existingKeys: first.rows.map((r) => r.sourceId) })
    expect(second.rows).toHaveLength(0)
  })

  it('不是账单文件时给出 unknown 而不是抛错', async () => {
    const result = await parseBillFile(csvToBuffer(['随便一行', '另一行']))
    expect(result.source).toBe('unknown')
    expect(result.rows).toHaveLength(0)
    expect(result.headerRow).toBe(-1)
  })

  it('损坏的行被跳过而不是让整份导入失败', async () => {
    const rows = [...WECHAT_ROWS, ['乱码行', '乱码', '乱码', '乱码', '支出', '不是数字', '零钱', '成功', '', '', '']]
    const result = await parseBillFile(csvToBuffer(rows))
    expect(result.rows).toHaveLength(3)
    expect(result.skipped.invalid).toBe(1)
  })
})
