const api = require('../../utils/api')
Page({
  data: { categories: [
    { key: 'courses', label: '老师与课程', note: '课程资料与学生体验' },
    { key: 'market', label: '二手集市', note: '闲置、求购和赠送' },
    { key: 'help', label: '校园互助', note: '发布需求或提供帮助' },
    { key: 'shuttle', label: '校车出行', note: '线路和计划班次' },
    { key: 'lost-found', label: '失物招领', note: '发布失物或认领线索' },
    { key: 'events', label: '活动社团', note: '校园活动与报名' },
    { key: 'guides', label: '校园指南', note: '办事流程和生活经验' },
  ] },
  openCategory(event) { wx.navigateTo({ url: `/pages/directory/index?kind=${event.currentTarget.dataset.kind}` }) },
  onShareAppMessage() { return { title: '三两事校园', path: '/pages/campus/index' } },
})
