const api=require('../../utils/api')
const ui=require('../../utils/presentation')
const categories=[
  {key:'places',label:'校园地点',note:'学习、生活与办事地点',icon:'campus'},
  {key:'courses',label:'老师与课程',note:'课程资料与学生体验',icon:'learn'},
  {key:'market',label:'二手集市',note:'闲置、求购和赠送',icon:'wallet'},
  {key:'help',label:'校园互助',note:'发布需求或提供帮助',icon:'check'},
  {key:'shuttle',label:'校车出行',note:'线路与出行信息',icon:'route'},
  {key:'lost-found',label:'失物招领',note:'失物信息与认领线索',icon:'search'},
  {key:'events',label:'活动社团',note:'校园活动与社团介绍',icon:'calendar'},
  {key:'guides',label:'校园指南',note:'办事流程和生活经验',icon:'note'},
]
Page({
  data:{themeStyle:'',categories,query:'',school:'',campus:''},
  onShow(){ui.present(this,3);if(api.isLoggedIn())api.profileRequest('profile_get').then(({profile})=>this.setData({school:profile.school||'',campus:profile.campus||''})).catch(()=>{})},
  search(event){const query=event.detail.value;this.setData({query,categories:categories.filter(row=>`${row.label}${row.note}`.includes(query))})},
  openCategory(event){wx.navigateTo({url:`/pages/directory/index?kind=${event.currentTarget.dataset.kind}`})},
  account(){wx.navigateTo({url:'/pages/account/index'})},
  feedback(){wx.navigateTo({url:'/pages/feedback/index'})},
  mine(){wx.navigateTo({url:'/pages/campus-mine/index'})},
  review(){wx.navigateTo({url:'/pages/review/index'})},
})
