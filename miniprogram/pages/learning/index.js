const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
Page({
  data: { date: ui.localDate(), days: [], courses: [], tasks: [], courseProgress: [], filter: 'pending', themeStyle: '', error: '', weekLabel: '' },
  onShow() { ui.refresh(this, this.build, 1) },
  build() {
    const today = this.data.date
    const current = new Date(`${today}T00:00:00Z`)
    const weekday = current.getUTCDay() || 7
    const monday = current.getTime() - (weekday - 1) * 86400000
    const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(monday + i * 86400000).toISOString().slice(0, 10); return { date, label: '一二三四五六日'[i], day: date.slice(8), selected: date === today, dot: ui.coursesOn(date).length > 0 } })
    const allTasks = workspace.all('task')
    const tasks = allTasks.filter(row => this.data.filter === 'all' || (this.data.filter === 'done' ? row.completed : !row.completed)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).map(row => ({ ...row, meta: ui.meta(row) }))
    const courseProgress = workspace.all('course').map(course => { const linked = allTasks.filter(task => task.courseId === course.id); return { id: course.id, title: course.title, done: linked.filter(task => task.completed).length, total: linked.length, minutes: Math.floor(linked.reduce((sum, task) => sum + task.spentSeconds, 0) / 60) } })
    const week = ui.weekNumber(today)
    this.setData({ days, courses: ui.coursesOn(today).map(row => ({ ...row, meta: ui.meta({ ...row, kind: 'course' }) })), tasks, courseProgress, weekLabel: week === null ? '设置学期起始日后显示周次' : `第 ${week} 周` })
  },
  selectDay(event) { this.setData({ date: event.currentTarget.dataset.date }); this.build() },
  changeDate(event) { this.setData({ date: event.detail.value }); this.build() },
  filter(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.build() },
  edit(event) { ui.editor(event.currentTarget.dataset.kind, event.currentTarget.dataset.id || '') },
  toggle(event) {
    try { const row = workspace.get(event.currentTarget.dataset.id); workspace.put('task', { ...row, completed: !row.completed }, row.id); ui.refresh(this, this.build, 1) } catch (error) { ui.message(this, error) }
  },
  focus(event) { wx.navigateTo({ url: `/pages/focus/index?taskId=${event.currentTarget.dataset.id}` }) },
  openDates() { ui.collection('milestone') },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }) },
})
