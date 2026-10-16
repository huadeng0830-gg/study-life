const workspace = require('./workspace')
const THEMES = { blue: '#3d63d8', purple: '#7650c8', green: '#067654', pink: '#b83878' }
function localDate(value = new Date()) { const d = new Date(value.getTime() + 8 * 3600000); return d.toISOString().slice(0, 10) }
function settings() { return workspace.all('settings')[0] || { theme: 'blue', termStart: '', campus: '我的校区', season: '默认作息', budgetMinor: 0 } }
function present(page, selected) {
  const value = settings()
  const primary = THEMES[value.theme] || THEMES.blue
  const soft = '#' + [1,3,5].map(index => Math.round(parseInt(primary.slice(index,index+2),16) * .09 + 255 * .91).toString(16).padStart(2,'0')).join('')
  page.setData({ themeStyle: `--primary:${primary};--primary-soft:${soft};`, sync: workspace.summary() })
  if (selected !== undefined && page.getTabBar?.()) page.getTabBar().setData({ selected, primary })
  wx.setNavigationBarColor?.({ frontColor: '#000000', backgroundColor: '#f5f7fb' })
}
function weekNumber(date = localDate()) {
  const start = settings().termStart
  return start ? Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 604800000) + 1 : null
}
function coursesOn(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7
  const week = weekNumber(date)
  return workspace.all('course').filter(row => row.weekday === weekday && (week === null || (week >= row.startWeek && week <= row.endWeek && (row.parity === 'all' || (row.parity === 'odd' ? week % 2 === 1 : week % 2 === 0))))).sort((a, b) => a.startTime.localeCompare(b.startTime))
}
function money(minor) { return (minor / 100).toFixed(2) }
function titleFor(kind) { return { task: '待办', course: '课程', event: '日程', milestone: '重要日期', transaction: '收支', bill: '固定账单', note: '笔记', list: '清单', focus: '专注', settings: '设置' }[kind] || '记录' }
function meta(row) {
  if (row.kind === 'course') return `周${'一二三四五六日'[row.weekday - 1]} ${row.startTime}–${row.endTime} · ${row.location || '地点待补充'}`
  if (row.kind === 'task') return `${row.dueDate || '待安排'}${row.dueTime ? ' ' + row.dueTime : ''} · ${row.priority === 'high' ? '高优先级' : '预计 ' + row.duration + ' 分钟'}`
  if (row.kind === 'event') return `${row.date} ${row.time || '全天'}${row.location ? ' · ' + row.location : ''}`
  if (row.kind === 'milestone') { const days = Math.ceil((Date.parse(row.date) - Date.parse(localDate())) / 86400000); return `${row.date} · ${days < 0 ? '已过 ' + -days + ' 天' : days === 0 ? '就是今天' : '还有 ' + days + ' 天'}` }
  if (row.kind === 'transaction' || row.kind === 'bill') return `${row.date} · ${row.category} · ${row.currency} ${money(row.amountMinor)}`
  if (row.kind === 'list') return `${row.items.filter(item => item.done).length}/${row.items.length} 项完成`
  if (row.kind === 'focus') return `${row.date} · ${Math.round(row.durationSeconds / 60)} 分钟`
  return row.body?.slice(0, 90) || row.note || row.updatedAt?.slice(0, 10) || ''
}
function editor(kind, id = '') { wx.navigateTo({ url: `/pages/editor/index?kind=${kind}${id ? '&id=' + encodeURIComponent(id) : ''}` }) }
function collection(kind) { wx.navigateTo({ url: `/pages/collection/index?kind=${kind}` }) }
function message(page, error) { page.setData({ error: error.message || '操作未完成，请重试。' }) }
function refresh(page, build, selected) {
  present(page, selected); build.call(page)
  const identity = workspace.identity()
  workspace.sync().then(() => { if (identity === workspace.identity()) { present(page, selected); build.call(page) } }).catch(error => message(page, error))
}
module.exports = { THEMES, localDate, settings, present, weekNumber, coursesOn, money, titleFor, meta, editor, collection, message, refresh }
