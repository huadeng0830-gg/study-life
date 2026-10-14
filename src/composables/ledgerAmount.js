// 账本金额校验是纯计算，单独放置以便浏览器与 Edge Function 共用，避免把存储层带进服务端。
// 账本仍以元保存，边界和汇总统一按“分”计算，避免 0.1 + 0.2 这类浮点误差。
// 一亿元已经远超个人日常记账范围，同时可以阻止科学计数法和异常大数污染数据。
export const MAX_LEDGER_AMOUNT = 1_000_000_000

export function amountToCents(value) {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_LEDGER_AMOUNT * 100) return null
    // 允许计算机产生的极小尾差，但拒绝真正超过两位小数的金额。
    if (Math.abs(value - cents / 100) > 1e-8) return null
    // -0 会通过上面所有判据（`-0 < 0` 为 false），但 `Intl` 保留它的符号，
    // 于是界面上会出现「¥-0.00」。这里统一归一成 0，与字符串分支一致。
    return cents === 0 ? 0 : cents
  }

  let text = String(value).trim().replace(/,/g, '')
  text = text.replace(/^[¥￥]\s*/, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_LEDGER_AMOUNT * 100) return null
  return cents
}

export function normalizeAmount(value) {
  const cents = amountToCents(value)
  return cents === null ? null : cents / 100
}
