const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
const F = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra })
const choices = (key, label, values, labels) => F(key,label,'select',{ values, labels })
const dateField = (key,label) => F(key,label,'date')
const timeField = (key,label) => F(key,label,'time')
const definitions = {
  task: [F('title','要做什么'),dateField('dueDate','截止日期（可留空）'),timeField('dueTime','截止时间（可留空）'),choices('priority','优先级',['normal','high','low'],['普通','高','低']),F('duration','预计分钟','number'),F('note','备注','textarea')],
  course: [F('title','课程名称'),F('teacher','教师'),F('location','上课地点'),choices('weekday','星期',[1,2,3,4,5,6,7],['周一','周二','周三','周四','周五','周六','周日']),timeField('startTime','上课时间'),timeField('endTime','下课时间'),F('startWeek','开始周','number'),F('endWeek','结束周','number'),choices('parity','单双周',['all','odd','even'],['每周','单周','双周']),F('note','备注','textarea')],
  event: [F('title','日程名称'),dateField('date','日期'),timeField('time','开始时间（可留空）'),timeField('endTime','结束时间（可留空）'),F('location','地点'),F('note','备注','textarea')],
  milestone: [F('title','重要日期名称'),dateField('date','日期'),choices('category','类型',['exam','deadline','birthday','anniversary','other'],['考试','截止日','生日','纪念日','其他']),F('note','备注','textarea')],
  transaction: [F('title','这笔收支是什么'),choices('direction','收支类型',['expense','income'],['支出','收入']),F('amount','金额','digit'),choices('currency','币种',['CNY','USD','EUR','JPY','GBP','HKD'],['人民币 CNY','美元 USD','欧元 EUR','日元 JPY','英镑 GBP','港币 HKD']),dateField('date','日期'),F('category','分类'),F('account','账户'),F('note','备注','textarea')],
  bill: [F('title','账单名称'),F('amount','金额','digit'),choices('currency','币种',['CNY','USD','EUR','JPY','GBP','HKD'],['人民币 CNY','美元 USD','欧元 EUR','日元 JPY','英镑 GBP','港币 HKD']),dateField('date','下次应付日期'),choices('cycle','周期',['monthly','weekly','yearly','once'],['每月','每周','每年','一次']),F('category','分类'),F('account','支付账户'),F('note','备注','textarea')],
  note: [F('title','笔记标题'),F('body','笔记内容','textarea'),F('note','标签或备注')],
  list: [F('title','清单名称'),F('lines','项目（每行一项）','textarea'),F('note','备注','textarea')],
}
Page({
  data: { themeStyle: '', fields: [], values: {}, kind: 'task', id: '', heading: '', error: '', saving: false, courses: [], courseIndex: 0, canLink: false },
  onLoad(options) {
    this.workspaceIdentity = workspace.identity()
    const kind = definitions[options.kind] ? options.kind : 'task'
    const row = options.id ? workspace.get(options.id) : null
    if (options.id && (!row || row.kind !== kind)) { this.setData({ error: '记录不存在或类型不匹配。' }); this.invalid = true; return }
    this.loadedRevision = row?.revision || 0
    this.originalDate = row?.date
    let draft = {}
    if (options.draft === '1') { try { const candidate = wx.getStorageSync('study-life-quick-draft'); wx.removeStorageSync('study-life-quick-draft'); if (candidate?.identity === this.workspaceIdentity) draft = candidate.values; else this.setData({error:'草稿所属空间已切换，请重新输入。'}) } catch { /* manual editing remains available */ } }
    const values = { title: '', note: '', dueDate: '', dueTime: '', duration: 25, spentSeconds: 0, priority: 'normal', completed: false, weekday: new Date().getDay() || 7, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 20, parity: 'all', date: ui.localDate(), time: '', location: '', category: kind === 'milestone' ? 'exam' : '其他', direction: 'expense', currency: 'CNY', cycle: 'monthly', account: '默认账户', ...draft, ...row }
    if (row?.amountMinor) values.amount = ui.money(row.amountMinor)
    if (row?.items) values.lines = row.items.map(item => item.title).join('\n')
    const courses = [{ id: '', title: '不关联课程' }, ...workspace.all('course')]
    this.setData({ kind, id: row?.id || '', heading: `${row ? '编辑' : '新建'}${ui.titleFor(kind)}`, values, fields: definitions[kind], courses, courseIndex: Math.max(0,courses.findIndex(course => course.id === values.courseId)), canLink: ['task','event','milestone'].includes(kind) })
    this.paintFields()
    wx.setNavigationBarTitle({ title: this.data.heading })
    ui.present(this)
  },
  paintFields() { this.setData({ fields: definitions[this.data.kind].map(field => ({ ...field, value: this.data.values[field.key] ?? '', selected: field.values ? Math.max(0,field.values.indexOf(this.data.values[field.key])) : 0 })) }) },
  input(event) {
    const key = event.currentTarget.dataset.key
    if (!definitions[this.data.kind].some(field => field.key === key)) return
    this.setData({ [`values.${key}`]: event.detail.value }); this.paintFields()
  },
  select(event) {
    const field = definitions[this.data.kind].find(field => field.key === event.currentTarget.dataset.key)
    if (!field?.values) return
    this.setData({ [`values.${field.key}`]: field.values[Number(event.detail.value)] }); this.paintFields()
  },
  clear(event) { const key = event.currentTarget.dataset.key; if (['dueDate','dueTime','time','endTime'].includes(key)) { this.setData({ [`values.${key}`]: '' }); this.paintFields() } },
  courseChange(event) { this.setData({ courseIndex: Number(event.detail.value) }) },
  async save() {
    if (this.data.saving || this.invalid) return
    this.setData({ saving: true, error: '' })
    try {
      if (workspace.identity() !== this.workspaceIdentity) throw new Error('账号或数据空间已切换，请重新打开表单。')
      const values = { ...this.data.values, courseId: this.data.courses[this.data.courseIndex]?.id || '' }
      if (this.data.kind === 'transaction' || this.data.kind === 'bill') {
        if (!/^\d+(\.\d{1,2})?$/.test(String(values.amount || ''))) throw new Error('金额须大于 0，最多保留两位小数。')
        values.amountMinor = Math.round(Number(values.amount) * 100)
        if (this.data.kind === 'bill' && values.date !== this.originalDate) values.anchorDay = Number(values.date.slice(8))
      }
      if (this.data.kind === 'list') {
        const old = this.data.id ? workspace.get(this.data.id)?.items || [] : []
        const byTitle = new Map(old.map(item => [item.title,item]))
        values.items = String(values.lines || '').split('\n').map(line => line.trim()).filter(Boolean).map(title => { const item = byTitle.get(title); byTitle.delete(title); return item || { id: workspace.uid(), title, done: false, quantity: 1, unitPriceMinor: 0 } })
      }
      workspace.put(this.data.kind, values, this.data.id || undefined, this.data.id ? this.loadedRevision : undefined)
      void workspace.sync()
      wx.showToast({ title: '已保存', icon: 'success' })
      wx.navigateBack()
    } catch(error) { ui.message(this,error) }
    finally { this.setData({ saving: false }) }
  },
})
