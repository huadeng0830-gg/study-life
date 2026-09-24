// 账本与固定账单之间的兼容关联。
// 历史记录可能使用 billId、sourceType/sourceId 或 relationId 表达同一关系。
function text(value) {
  return String(value ?? '').trim()
}

export function transactionBillId(item = {}) {
  const direct = text(item.billId)
  if (direct) return direct

  if (text(item.sourceType) === 'bill') {
    const sourceId = text(item.sourceId)
    if (sourceId) return sourceId
  }

  const relation = text(item.relationId)
  return relation.startsWith('bill:') ? relation.slice(5).trim() : ''
}

export function isBillPayment(item = {}) {
  return Boolean(text(item.billingPeriodKey) && (transactionBillId(item) || text(item.source) === 'bill'))
}
