const api = require('../../utils/api')
const sources = {
  courses: { action: 'courses_list', key: 'courses', title: '老师与课程', targetType: 'course' },
  market: { action: 'market_list', key: 'listings', title: '二手集市', targetType: 'market_listing' },
  help: { action: 'help_list', key: 'tasks', title: '校园互助', targetType: 'help_task' },
  shuttle: { action: 'shuttle_list', key: 'routes', title: '校车出行', targetType: 'shuttle_route' },
  'lost-found': { action: 'lost_found_list', key: 'items', title: '失物招领', targetType: 'lost_found' },
  events: { action: 'events_list', key: 'events', title: '活动社团', targetType: 'event' },
  guides: { action: 'guides_list', key: 'guides', title: '校园指南', targetType: 'guide' },
}
Page({
  data: { kind: '', title: '校园内容', items: [], loading: true, error: '', reportTarget: null, reportIndex: 0, reportReasons: ['信息不准确','隐私风险','辱骂或骚扰','违规内容','其他问题'], reportDetail: '', reporting: false, notice: '' },
  onLoad(options) { const source = sources[options.kind] || sources.guides; this.source = source; this.setData({ kind: options.kind, title: source.title }); wx.setNavigationBarTitle({ title: source.title }); this.load() },
  async load() {
    if (!this.source) return
    this.setData({ loading: true, error: '' })
    try { const result = await api.campusRequest(this.source.action); const value = result[this.source.key]; this.setData({ items: Array.isArray(value) ? value : value ? [value] : [] }) }
    catch (error) { this.setData({ error: error.message, items: [] }) }
    finally { this.setData({ loading: false }) }
  },
  displayTitle(item) { return item.title || item.name || item.course_name || item.teacher_name || item.route_name || '校园内容' },
  displayBody(item) { return item.description || item.body || item.note || item.department || item.meetup_area || item.approximate_location || item.status || '' },
  onRetry() { this.load() },
  openReport(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (!item) return
    this.setData({ reportTarget: item, reportDetail: '', reportIndex: 0, error: '', notice: '' })
  },
  onReportIndex(event) { this.setData({ reportIndex: Number(event.detail.value) || 0 }) },
  onReportDetail(event) { this.setData({ reportDetail: event.detail.value }) },
  closeReport() { this.setData({ reportTarget: null, reportDetail: '' }) },
  async submitReport() {
    if (!api.getSession()?.access_token) { wx.switchTab({ url: '/pages/account/index' }); return }
    const reasons = ['inaccurate','privacy','abuse','prohibited','other']
    this.setData({ reporting: true, error: '', notice: '' })
    try {
      await api.campusRequest('content_report', { targetType: this.source.targetType, targetId: this.data.reportTarget.id, reason: reasons[this.data.reportIndex] || 'other', detail: this.data.reportDetail })
      this.setData({ reportTarget: null, reportDetail: '', notice: '举报已提交。审核人员会核对内容并记录处理依据。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ reporting: false }) }
  },
})
