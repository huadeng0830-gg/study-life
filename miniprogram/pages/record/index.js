const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
const { parseCapture } = require('../../utils/capture')
Page({
  data: { themeStyle:'', text:'', error:'', selected:'', types:[{kind:'task',label:'待办',icon:'check'},{kind:'event',label:'日程',icon:'calendar'},{kind:'transaction',label:'收支',icon:'wallet'},{kind:'note',label:'笔记',icon:'note'},{kind:'milestone',label:'重要日期',icon:'flag'},{kind:'list',label:'清单',icon:'list'},{kind:'bill',label:'固定账单',icon:'wallet'},{kind:'course',label:'课程',icon:'learn'}], recent:[] },
  onShow() { ui.refresh(this,this.build,2) },
  build() { this.setData({recent:workspace.all().filter(row=>!['settings','mood','focus'].includes(row.kind)).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,5).map(row=>({...row,kindLabel:ui.titleFor(row.kind),meta:ui.meta(row)}))}) },
  input(event) { this.setData({text:event.detail.value}) },
  select(event) { const kind=event.currentTarget.dataset.kind; this.setData({selected:this.data.selected===kind?'':kind}) },
  async paste() { try { const result=await wx.getClipboardData(); this.setData({text:result.data||'',error:''}) } catch { this.setData({error:'未读取剪贴板，可以直接输入。'}) } },
  preview() {
    try {
      if(!this.data.text.trim() && this.data.selected) { ui.editor(this.data.selected); return }
      const draft=parseCapture(this.data.text,this.data.selected,ui.localDate())
      wx.setStorageSync('study-life-quick-draft',{identity:workspace.identity(),values:draft.values})
      wx.navigateTo({url:`/pages/editor/index?kind=${draft.kind}&draft=1`})
    } catch(error) { ui.message(this,error) }
  },
  clear() { this.setData({text:'',selected:'',error:''}) },
  edit(event) { ui.editor(event.currentTarget.dataset.kind,event.currentTarget.dataset.id) },
})
