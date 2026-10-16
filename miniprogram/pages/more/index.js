const workspace=require('../../utils/workspace')
const api=require('../../utils/api')
const ui=require('../../utils/presentation')
Page({
  data:{themeStyle:'',loggedIn:false,groups:[
    {title:'学习与安排',items:[{label:'待办',kind:'task',icon:'check'},{label:'日程',kind:'event',icon:'calendar'},{label:'重要日期',kind:'milestone',icon:'flag'},{label:'专注',page:'focus',icon:'focus'}]},
    {title:'生活与记录',items:[{label:'账本',kind:'transaction',icon:'wallet'},{label:'固定账单',kind:'bill',icon:'wallet'},{label:'清单',kind:'list',icon:'list'},{label:'笔记',kind:'note',icon:'note'},{label:'回顾',page:'insights',icon:'review'}]},
    {title:'设置与服务',items:[{label:'外观与学期',page:'settings',icon:'settings'},{label:'数据管理',page:'data',icon:'data'},{label:'反馈与建议',page:'feedback',icon:'message'},{label:'校园审核',page:'review',icon:'shield'}]},
  ]},
  onShow(){ui.refresh(this,this.build,4)},
  build(){this.setData({loggedIn:api.isLoggedIn(),recordCount:workspace.all().filter(row=>row.kind!=='settings').length})},
  account(){wx.navigateTo({url:'/pages/account/index'})},
  open(event){const {kind,page}=event.currentTarget.dataset;if(kind)ui.collection(kind);else if(page)wx.navigateTo({url:`/pages/${page}/index`})},
})
