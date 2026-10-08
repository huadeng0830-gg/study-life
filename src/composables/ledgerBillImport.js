// 微信 / 支付宝账单 CSV 导入。
//
// 【为什么 TextDecoder('gbk') 不是新增依赖】GBK / GB18030 是 WHATWG Encoding
// 规范**强制要求**浏览器原生支持的标签（Baseline Widely Available，2020-01 起
// 全浏览器），MDN 明确列出。支付宝账单正是 GBK 编码，所以不需要任何编解码库。
//
// 【为什么必须扫到表头行为止，不能写死行号】微信账单前 16 行、支付宝前 24~25 行
// 是账单说明（"账单起始时间"、"说明：本次导出..."），表头行号还会随版本漂移。
// 写死行号意味着微信一改说明文案就整份导入失败。
//
// 【中性交易必须排除】微信的"充值/提现/零钱通存取/信用卡还款"、支付宝的
// "账户转出/转入"都是**转账不是消费**。计入会污染月度预算与分类排行，而且会让
// "这个月花了多少"看起来莫名其妙。
//
// 【去重键】优先用交易单号（微信用"交易单号"、支付宝 16 列版有"交易号"）——
// 它稳定唯一，重复导入同一份文件不会产生重复。缺失时退化为
// 日期+金额+收支+对方 的指纹，此时重复导入依赖指纹一致。

/** 解码账单文件。支付宝是 GBK，微信是 UTF-8，都带 BOM。 */
export function decodeBillText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  // BOM 优先：UTF-8 BOM 存在时不要按 GBK 解，否则中文会变乱码。
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  // 没有 BOM：先按 UTF-8 试，解出替换字符就说明不是 UTF-8，退回 GBK。
  // 支付宝导出的文件通常没有 BOM。
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8
  return new TextDecoder('gbk').decode(bytes)
}

/**
 * RFC 4180 CSV 解析。
 *
 * 与导出侧（ledgerView/export.js 的 csvCell）是一对，但**不能复用**：
 * 导出侧还会中和公式前缀，解析侧只需要处理引号转义与内嵌换行。
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const source = String(text ?? '').replace(/^﻿/, '')

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1 }
        else quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') { quoted = true; continue }
    // 账单 CSV 用 CRLF，但 Excel 在某些区域设置下会写 LF；两者都要认。
    if (char === '\r') {
      if (source[index + 1] === '\n') index += 1
      row.push(field); field = ''
      rows.push(row); row = []
      continue
    }
    if (char === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
      continue
    }
    if (char === ',') { row.push(field); field = ''; continue }
    field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((item) => item.some((cell) => String(cell).trim() !== ''))
}

/**
 * 列名别名。
 *
 * 【为什么必须别名而不是写死】两家账单的实际表头差异比想象大：
 * - 微信有 `收/支` 列，支付宝**没有** —— 支付宝靠 `类型` + `资金状态` 表达方向；
 * - 微信金额列是 `金额(元)`（半角括号），支付宝是 `金额（元）`（**全角**括号）；
 * - 微信时间列叫 `交易时间`，支付宝叫 `交易创建时间`（还有 `付款时间`）。
 * 之前按固定列名找表头，结果支付宝文件一律判成"不是账单文件"。
 */
const COLUMN_ALIASES = {
  time: ['交易时间', '交易创建时间', '付款时间', '交易日期'],
  amount: ['金额(元)', '金额（元）', '金额', '金额(元)(元)'],
  flow: ['收/支', '收支'],
  type: ['交易类型', '类型', '交易分类'],
  status: ['当前状态', '交易状态', '资金状态'],
  // 支付宝有两个"状态"列，含义完全不同，必须分开：
  // `交易状态` = 交易成功 / 交易关闭（用于判退款）；
  // `资金状态` = 已支出 / 已收入（**这才是方向**）。
  // 混用会把所有支付宝记录判成 unknown。
  state: ['资金状态'],
  counterparty: ['交易对方', '对方账号', '对方名称'],
  goods: ['商品', '商品说明', '商品名称'],
  orderNo: ['交易单号', '交易号', '商家订单号'],
  payMethod: ['支付方式', '收/付款方式'],
  note: ['备注', '商品备注'],
}

/** 在前若干行里找到表头行；groups 里每一组别名至少命中一个才算匹配。 */
export function findHeader(rows, groups) {
  const limit = Math.min(rows.length, 40)
  for (let index = 0; index < limit; index += 1) {
    const cells = rows[index].map((cell) => String(cell).trim())
    const hit = groups.every((aliases) => aliases.some((name) => cells.includes(name)))
    if (!hit) continue
    const map = {}
    cells.forEach((name, position) => { if (name && !(name in map)) map[name] = position })
    return { index, map, header: cells }
  }
  return null
}

/** 按别名组取列值：命中任一别名即可。 */
function aliasedCell(row, map, group) {
  for (const name of COLUMN_ALIASES[group] || []) {
    const position = map[name]
    if (position !== undefined) {
      const value = String(row[position] ?? '').trim()
      if (value) return value
    }
  }
  return ''
}

const cell = (row, map, name) => {
  const position = map[name]
  if (position === undefined) return ''
  return String(row[position] ?? '').trim()
}

/** "2026-10-04 12:30:00" / "2026/10/04 12:30" -> { date, time } */
export function splitDateTime(value) {
  const text = String(value ?? '').trim()
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (!matched) return { date: '', time: '' }
  const [, y, m, d, hh = '', mm = ''] = matched
  const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const time = hh !== '' ? `${String(hh).padStart(2, '0')}:${mm}` : ''
  return { date, time }
}

/** "¥18.50" / "18.50" / "1,234.56" -> 数字；解析不出来返回 null。 */
export function parseAmount(value) {
  let text = String(value ?? '').replace(/[¥￥,\s]/g, '')
  if (!text) return null
  // 全角数字与全角小数点在部分导出里会出现，Number() 对它们返回 NaN。
  text = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[。．]/g, '.')
  const number = Number(text)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number * 100) / 100
}

// 微信/支付宝的"收/支"取值：支出 / 收入 / 不计收支（或中性交易）
const EXPENSE_WORDS = ['支出', '付款', '消费', '支出明细']
const INCOME_WORDS = ['收入', '收款', '退款', '已全额退款', '红包', '已收入']
// 注意：**不要**把「已支出 / 已收入」放进这里 —— 它们是支付宝 `资金状态` 列的
// 方向取值，不是"不计收支"。放进来会让所有支付宝记录被判成 skip。
const NEUTRAL_WORDS = ['不计收支', '中性交易', '/', '其他']

/**
 * 资金搬运类：必须排除，否则污染月度预算与分类排行。
 *
 * 【为什么这些一律跳过，而不是按"支出/收入"记】把它们记进账会让"这个月花了多少"
 * 凭空多出一大笔（信用卡还款、余额宝转入），也会让分类排行出现一个不存在的分类。
 * 判断不了的宁可让用户自己补，也不要给一个看着像但含义错的数字。
 *
 * 注意顺序：**转账判定优先于收支判定**。微信"转账"类型既可能是给别人付款
 * （支出）也可能是收到转账（收入），仅看"收/支"列无法区分；而支付宝的
 * 花呗还款类型也写成"转账"。所以这里统一按搬运处理，用户仍可在导入预览里
 * 逐条改。
 */
const TRANSFER_WORDS = [
  '充值', '提现', '零钱通', '信用卡还款', '余额宝', '账户转出', '账户转入',
  '转账', '还款', '理财', '基金', '保险', '花呗', '借出', '收款',
  '亲属卡', '自动还款', '信用卡', '借记卡', '零钱',
]

function classifyFlow(rawFlow, rawType = '') {
  const flow = String(rawFlow ?? '').trim()
  const type = String(rawType ?? '').trim()
  const probe = `${flow}${type}`
  // 转账/还款先判：它比收支判断更重要，判错方向会直接算错月度合计。
  if (TRANSFER_WORDS.some((word) => probe.includes(word))) return 'skip'
  if (NEUTRAL_WORDS.includes(flow) && !EXPENSE_WORDS.includes(flow)) return 'skip'
  if (INCOME_WORDS.some((word) => probe.includes(word))) return 'income'
  if (EXPENSE_WORDS.some((word) => probe.includes(word))) return 'expense'
  // 支付宝的 `资金状态` 列写的是「已支出 / 已收入」，不是「支出 / 收入」。
  if (flow.includes('已收入')) return 'income'
  if (flow.includes('已支出')) return 'expense'
  return 'unknown'
}

// 关键词 -> 本项目已有分类。映射到既有 key，不新增分类体系。
const CATEGORY_RULES = [
  ['food', ['餐饮', '外卖', '餐', '饭', '食堂', '小吃', '美食', '餐厅', '肯德基', '麦当劳', '星巴克']],
  ['drink', ['饮品', '咖啡', '奶茶', '茶饮', '饮料']],
  ['snack', ['零食', '水果', '超市生鲜']],
  ['transit', ['交通', '地铁', '公交', '打车', '滴滴', '出行', '加油', '停车', '高铁', '火车', '机票', '共享单车']],
  ['shop', ['购物', '服饰', '数码', '商城', '淘宝', '京东', '拼多多', '超市', '便利店']],
  ['study', ['学习', '书店', '图书', '培训', '课程', '学费', '文具']],
  ['digital', ['数码', '电子', '软件', '会员', '订阅']],
  ['fun', ['娱乐', '电影', '游戏', '演出', '门票', 'KTV']],
  ['daily-supplies', ['生活用品', '日用', '清洁', '洗护']],
  ['daily-service', ['日用服务', '理发', '美容', '洗衣', '快递', '维修']],
  ['bathing', ['洗浴', '洗澡', '温泉']],
  ['housing', ['房租', '住宿', '公寓', '酒店']],
  ['utilities', ['水费', '电费', '燃气', '宽带', '物业']],
  ['communication', ['话费', '流量', '通讯', '充值话费']],
  ['health', ['医院', '医疗', '药店', '药', '体检', '门诊']],
  ['sports', ['运动', '健身', '游泳', '球场']],
  ['social', ['礼物', '红包', '请客', '社交']],
  ['travel', ['旅行', '旅游', '酒店', '民宿']],
  ['sub', ['订阅', '会员', '自动续费']],
  ['salary', ['工资', '薪资', '薪酬']],
  ['part-time', ['兼职', '劳务']],
  ['scholarship', ['奖学金', '助学金']],
  ['allowance', ['生活费', '零钱']],
  ['reimbursement', ['报销', '退款', '退回']],
]

/** 用交易对方 / 商品说明 / 交易分类 猜一个已有分类。 */
export function guessCategory(...texts) {
  const probe = texts.filter(Boolean).join(' ')
  if (!probe) return ''
  for (const [key, words] of CATEGORY_RULES) {
    if (words.some((word) => probe.includes(word))) return key
  }
  return ''
}

/** 仅供测试与调试：暴露方向判定。 */
export function classifyFlowProbe(flow, type) {
  return classifyFlow(flow, type)
}

function fingerprint({ date, time, amount, direction, counterparty }) {
  return [date, time, amount, direction, counterparty].join('|')
}

async function sha256Hex(text) {
  // Web Crypto 原生，不需要依赖。
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 解析账单文件。
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ existingKeys?: string[] }} options existingKeys 传入已有交易的
 *   sourceId 集合，用于跳过重复；不传则不做去重（首次导入）。
 * @returns {{ source: 'wechat'|'alipay'|'unknown', rows: object[], total: number, skipped: { transfers: number, unknown: number, invalid: number, duplicates: number }, headerRow: number }}
 */
export async function parseBillFile(arrayBuffer, { existingKeys = [] } = {}) {
  const text = decodeBillText(arrayBuffer)
  const table = parseCsv(text)
  const known = new Set(existingKeys)

  // 微信靠 `收/支` 列区分收支；支付宝没有这一列，靠 `类型` + `资金状态`。
  // 所以两边的必填组不同，不能用同一组列名去判定。
  const wechatHeader = findHeader(table, [COLUMN_ALIASES.time, COLUMN_ALIASES.flow, COLUMN_ALIASES.amount])
  const alipayHeader = findHeader(table, [COLUMN_ALIASES.time, COLUMN_ALIASES.type, COLUMN_ALIASES.amount])
  const header = wechatHeader || alipayHeader
  if (!header) {
    return { source: 'unknown', rows: [], total: 0, skipped: { transfers: 0, unknown: 0, invalid: 0, duplicates: 0 }, headerRow: -1 }
  }
  const source = wechatHeader ? 'wechat' : 'alipay'
  const { map } = header

  const rows = []
  const skipped = { transfers: 0, unknown: 0, invalid: 0, duplicates: 0 }
  const seenInFile = new Set()

  for (let index = header.index + 1; index < table.length; index += 1) {
    const raw = table[index]
    const { date, time } = splitDateTime(aliasedCell(raw, map, 'time'))
    const amount = parseAmount(aliasedCell(raw, map, 'amount'))
    if (!date || amount === null) { skipped.invalid += 1; continue }

    const rawFlow = aliasedCell(raw, map, 'flow')
    const rawType = aliasedCell(raw, map, 'type')
    // 支付宝没有 `收/支` 列：它的 `资金状态` 是「已支出/已收入」，
    // 直接当方向用；`类型` 仍要参与转账判定（花呗还款的"类型"就是转账）。
    const alipayState = source === 'alipay' ? aliasedCell(raw, map, 'state') : ''
    const flow = classifyFlow(rawFlow || alipayState, rawType)
    if (flow === 'skip') { skipped.transfers += 1; continue }
    if (flow === 'unknown') { skipped.unknown += 1; continue }

    const counterparty = aliasedCell(raw, map, 'counterparty')
    const goods = aliasedCell(raw, map, 'goods')
    const status = aliasedCell(raw, map, 'status')
    const orderNo = aliasedCell(raw, map, 'orderNo')
    const payMethod = aliasedCell(raw, map, 'payMethod')
    const note = aliasedCell(raw, map, 'note')

    // 已退款：优先映射成 refund（项目已有 direction: 'refund' 语义），
    // 而不是记成负数支出 —— 负数支出会让分类分布与月度合计算错。
    const refunded = /已退款|已全额退款|退款成功/.test(status)
    const direction = refunded ? 'refund' : flow

    const name = [goods, counterparty].filter(Boolean).join(' - ') || (direction === 'income' ? '收入' : '支出')
    const category = guessCategory(counterparty, goods, rawType) || 'other'

    // sourceId 优先用交易单号；缺失时用稳定指纹（同步 SHA-256 只是避免
    // 指纹里出现分隔符歧义，不依赖它做唯一性保证）。
    const sourceId = orderNo || fingerprint({ date, time, amount, direction, counterparty })
    if (known.has(sourceId) || seenInFile.has(sourceId)) { skipped.duplicates += 1; continue }
    seenInFile.add(sourceId)

    rows.push({
      id: `import-${date.replace(/-/g, '')}-${sourceId.slice(0, 24)}`,
      name: name.slice(0, 80),
      amount,
      date,
      time,
      direction,
      cat: category,
      note: [note, payMethod ? `支付方式：${payMethod}` : ''].filter(Boolean).join(' · ').slice(0, 200),
      source: source === 'wechat' ? '微信账单' : '支付宝账单',
      sourceType: source === 'wechat' ? 'wechat-bill' : 'alipay-bill',
      sourceId,
    })
  }

  return { source, rows, total: rows.length, skipped, headerRow: header.index }
}
