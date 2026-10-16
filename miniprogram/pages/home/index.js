const workspace = require('../../utils/workspace')
const ui = require('../../utils/presentation')
Page({
  data: { themeStyle: '', error: '', greeting: '', dateText: '', weekLabel: '', campus: '', next: null, agenda: [], tasks: [], milestones: [], stats: {}, mood: '', moods: ['开心','平静','疲惫','低落','充实'] },
  onShow() { ui.refresh(this, this.build, 0) },
  build() {
    const today = ui.localDate()
    const now = new Date(Date.now() + 8 * 3600000)
    const clock = now.toISOString().slice(11, 16)
    const settings = ui.settings()
    const week = ui.weekNumber()
    const courses = ui.coursesOn(today)
    const events = workspace.all('event').filter(row => row.date === today)
    const pending = workspace.all('task').filter(row => !row.completed).sort((a,b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    const tasks = pending.filter(row => !row.dueDate || row.dueDate <= today).slice(0, 5).map(row => ({ ...row, meta: ui.meta(row), overdue: Boolean(row.dueDate && row.dueDate < today) }))
    const agenda = [...courses.map(row => ({ ...row, kind: 'course', time: row.startTime, label: row.location || '地点待补充', ended: row.endTime < clock })), ...events.map(row => ({ ...row, kind: 'event', label: row.location || '个人日程', ended: Boolean(row.endTime && row.endTime < clock) }))].sort((a,b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
    const next = agenda.find(row => !row.ended && (!row.time || row.time >= clock || (row.endTime && row.endTime > clock))) || null
    const milestones = workspace.all('milestone').filter(row => row.date >= today).sort((a,b) => a.date.localeCompare(b.date)).slice(0,3).map(row => ({ ...row, days: Math.ceil((Date.parse(row.date) - Date.parse(today)) / 86400000) }))
    const monday = new Date(Date.parse(today) - ((new Date(today).getUTCDay() || 7) - 1) * 86400000).toISOString().slice(0,10)
    const weekly = workspace.all('transaction').filter(row => row.date >= monday && row.date <= today && row.currency === 'CNY')
    const expense = weekly.filter(row => row.direction === 'expense').reduce((sum,row) => sum + row.amountMinor, 0)
    const income = weekly.filter(row => row.direction === 'income').reduce((sum,row) => sum + row.amountMinor, 0)
    const focusMinutes = Math.floor(workspace.all('focus').filter(row => row.date >= monday && row.date <= today).reduce((sum,row) => sum + row.durationSeconds,0) / 60)
    const hour = now.getUTCHours()
    this.setData({ greeting: hour < 6 ? '夜深了，早点休息' : hour < 12 ? '早上好，开始今天的安排' : hour < 18 ? '下午好，按自己的节奏来' : '晚上好，给今天留一点收获', dateText: `${today.slice(5,7)} 月 ${today.slice(8)} 日 · 星期${'日一二三四五六'[new Date(today).getUTCDay()]}`, weekLabel: week === null ? '学期尚未设置' : `第 ${week} 周`, campus: settings.campus || '我的校区', next, agenda, tasks, milestones, mood: workspace.get(`mood_${today}`)?.mood || '', stats: { courses: courses.length, tasks: pending.length, focusMinutes, expense: ui.money(expense), income: ui.money(income), balance: ui.money(income - expense) } })
  },
  record() { wx.switchTab({ url: '/pages/record/index' }) },
  learning() { wx.switchTab({ url: '/pages/learning/index' }) },
  collection(event) { ui.collection(event.currentTarget.dataset.kind) },
  edit(event) { ui.editor(event.currentTarget.dataset.kind, event.currentTarget.dataset.id || '') },
  focus() { wx.navigateTo({ url: '/pages/focus/index' }) },
  review() { wx.navigateTo({ url: '/pages/insights/index' }) },
  toggle(event) { try { const row = workspace.get(event.currentTarget.dataset.id); workspace.put('task',{ ...row, completed: !row.completed },row.id); ui.refresh(this,this.build,0) } catch(error) { ui.message(this,error) } },
  chooseMood(event) { try { const today = ui.localDate(); workspace.put('mood',{date:today,mood:event.currentTarget.dataset.mood},`mood_${today}`); ui.refresh(this,this.build,0) } catch(error) { ui.message(this,error) } },
})
