const LEDGER_TABS = new Set(['ledger', 'bills', 'review'])

export function ledgerTabFromQuery(value) {
  return LEDGER_TABS.has(value) ? value : 'ledger'
}
