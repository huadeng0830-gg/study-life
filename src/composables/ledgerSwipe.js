import { isBillPayment } from './ledgerRelations.js'

function transactionLabel(transaction) {
  return String(transaction?.name || '这笔记录').trim() || '这笔记录'
}

// UI-only action policy. Business mutations stay in domain/commands.js.
export function transactionSwipeActions(transaction) {
  const name = transactionLabel(transaction)
  if (isBillPayment(transaction)) {
    return [{
      key: 'undo-bill',
      label: '撤销支付',
      tone: 'danger',
      ariaLabel: `撤销支付 ${name}`,
    }]
  }
  return [
    { key: 'edit', label: '编辑', tone: 'neutral', ariaLabel: `编辑 ${name}` },
    { key: 'delete', label: '删除', tone: 'danger', ariaLabel: `删除 ${name}` },
  ]
}
