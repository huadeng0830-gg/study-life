const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
Page({
  data: { kind: 'task', title: '', rows: [], query: '', error: '', themeStyle: '', totals: null, month: '', list: null, showCompleted: true },
  onLoad(options) { const kinds = ['task','course','event','milestone','transaction','bill','note','list','focus']; const kind = kinds.includes(options.kind) ? options.kind : 'task'; this.setData({ kind, title: { task:'待办',course:'课程档案',event:'日程',milestone:'重要日期',transaction:'账本',bill:'固定账单',note:'笔记',list:'清单',focus:'专注记录' }[kind], month: ui.localDate().slice(0,7) }); wx.setNavigationBarTitle({title:this.data.title}) },
  onShow() { ui.refresh(this,this.build) },
  build() {
    let rows = workspace.all(this.data.kind).filter(row => !this.data.query || `${row.title} ${row.note} ${row.body || ''}`.includes(this.data.query))
    if (this.data.kind === 'transaction') rows = rows.filter(row => row.date.startsWith(this.data.month))
    rows.sort((a,b) => this.data.kind === 'event' || this.data.kind === 'milestone' || this.data.kind === 'bill' ? a.date.localeCompare(b.date) : (b.date || b.updatedAt || '').localeCompare(a.date || a.updatedAt || ''))
    const finance = rows.filter(row => row.currency === 'CNY')
    const expense = finance.filter(row => row.direction === 'expense').reduce((sum,row) => sum + row.amountMinor,0)
    const income = finance.filter(row => row.direction === 'income').reduce((sum,row) => sum + row.amountMinor,0)
    const budget = ui.settings().budgetMinor
    this.setData({ rows: rows.map(row => ({ ...row, meta: ui.meta(row), amount: row.amountMinor ? ui.money(row.amountMinor) : '', completedItems: row.items?.filter(item => item.done).length || 0 })), totals: this.data.kind === 'transaction' ? { expense: ui.money(expense), income: ui.money(income), balance: ui.money(income-expense), budget: budget ? ui.money(budget) : '', remaining: budget ? ui.money(budget-expense) : '', excluded: rows.length-finance.length } : null, list: this.data.list ? workspace.get(this.data.list.id) : null })
  },
  search(event) { this.setData({query:event.detail.value}); this.build() },
  monthChange(event) { this.setData({month:event.detail.value.slice(0,7)}); this.build() },
  add() { ui.editor(this.data.kind) },
  edit(event) { if(this.data.kind === 'focus') return; ui.editor(this.data.kind,event.currentTarget.dataset.id) },
  showList(event) { this.setData({ list: workspace.get(event.currentTarget.dataset.id) }) },
  closeList() { this.setData({ list: null }) },
  toggle(event) {
    try {
      const row = workspace.get(event.currentTarget.dataset.id)
      workspace.put('task',{...row,completed:!row.completed},row.id)
      ui.refresh(this,this.build)
    } catch(error) { ui.message(this,error) }
  },
  toggleItem(event) {
    try {
      const list = workspace.get(this.data.list.id)
      workspace.put('list',{...list,items:list.items.map(item => item.id === event.currentTarget.dataset.id ? {...item,done:!item.done} : item)},list.id)
      ui.refresh(this,this.build)
    } catch(error) { ui.message(this,error) }
  },
  async remove(event) {
    const identity = workspace.identity()
    const row = workspace.get(event.currentTarget.dataset.id)
    const result = await wx.showModal({title:'删除这条记录？',content:'删除会同步到当前微信账号。其他记录不受影响。',confirmText:'删除',confirmColor:'#c62828'})
    if (!result.confirm) return
    try { if (workspace.identity() !== identity) throw new Error('账号已切换，请重新操作。'); workspace.remove(event.currentTarget.dataset.id,row?.revision); ui.refresh(this,this.build) } catch(error) { ui.message(this,error) }
  },
  async pay(event) {
    const identity = workspace.identity()
    const bill = workspace.get(event.currentTarget.dataset.id)
    if (!bill) return
    const confirmation = await wx.showModal({title:'确认账单已支付',content:`${bill.title} · ${bill.currency} ${ui.money(bill.amountMinor)}。确认后计入账本，并推进下一期。`})
    if (!confirmation.confirm) return
    try {
      if (workspace.identity() !== identity) throw new Error('账号已切换，请重新打开账单。')
      const transactionId = `payment_${bill.id}_${bill.date}`
      if (workspace.get(transactionId)) throw new Error('这一期账单已经入账。')
      const next = nextBillDate(bill.date,bill.cycle,bill.anchorDay)
      workspace.commit([{kind:'transaction',id:transactionId,values:{...bill,date:ui.localDate(),direction:'expense',title:bill.title}},{kind:'bill',id:bill.id,values:{...bill,date:next || bill.date},deleted:!next,loadedRevision:bill.revision}])
      ui.refresh(this,this.build)
    } catch(error) { ui.message(this,error) }
  },
  openBills() { ui.collection('bill') },
})
function nextBillDate(date,cycle,anchorDay) {
  if(cycle === 'once') return ''
  const d = new Date(`${date}T00:00:00Z`)
  if(cycle === 'weekly') d.setUTCDate(d.getUTCDate()+7)
  else {
    const day=anchorDay||d.getUTCDate(); d.setUTCDate(1)
    if(cycle === 'monthly') d.setUTCMonth(d.getUTCMonth()+1); else d.setUTCFullYear(d.getUTCFullYear()+1)
    const end = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()
    d.setUTCDate(Math.min(day,end))
  }
  return d.toISOString().slice(0,10)
}
