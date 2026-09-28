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
import { catInfo, expenses } from '../ledger.js'
import { normalizeCurrency } from '../ledgerFx.js'

export function useLedgerExport({ getMonth, personalAmount, baseCurrency, notify }) {
  const EXPORT_COLUMNS = ['日期', '时间', '名称', '分类', '收支', '金额', '我承担', '币种', '账户', '备注']
  function ledgerExportRows() {
    const month = getMonth()
    return expenses.value
      .filter((item) => item && !item.archivedAt && !item.deletedAt && !item.tombstone && String(item.date ?? '').slice(0, 7) === month)
      .sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`))
      .map((item) => ({
        '日期': item.date,
        '时间': item.time || '',
        '名称': item.name,
        '分类': catInfo(item.cat).name,
        '收支': item.direction === 'income' ? '收入' : item.direction === 'refund' ? '退款' : '支出',
        '金额': item.amount,
        '我承担': personalAmount(item),
        '币种': normalizeCurrency(item.currency) || baseCurrency.value,
        '账户': item.account || '',
        '备注': item.note || '',
      }))
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
  function csvCell(value) {
    const text = String(value ?? '')
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  function exportLedgerCsv() {
    const rows = ledgerExportRows()
    if (!rows.length) { notify('该月还没有可导出的记录'); return }
    const lines = [EXPORT_COLUMNS.join(',')].concat(
      rows.map((row) => EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(','))
    )
    downloadLedgerFile(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `账单-${getMonth()}.csv`)
    notify(`已导出 ${rows.length} 条账单 CSV`)
  }
  async function exportLedgerXlsx() {
    const rows = ledgerExportRows()
    if (!rows.length) { notify('该月还没有可导出的记录'); return }
    const XLSX = await import('@e965/xlsx')
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '账单')
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    downloadLedgerFile(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `账单-${getMonth()}.xlsx`)
    notify(`已导出 ${rows.length} 条账单 Excel`)
  }


  return { exportLedgerCsv, exportLedgerXlsx }
}
