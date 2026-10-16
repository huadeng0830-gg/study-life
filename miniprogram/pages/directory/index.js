const api = require('../../utils/api')
const ui = require('../../utils/presentation')
const sources = {
  places: { action: 'places_list', key: 'places', title: '校园地点', targetType: 'place' },
  courses: { action: 'courses_list', key: 'courses', title: '老师与课程', targetType: 'course' },
  market: { action: 'market_list', key: 'listings', title: '二手集市', targetType: 'market_listing' },
  help: { action: 'help_list', key: 'tasks', title: '校园互助', targetType: 'help_task' },
  shuttle: { action: 'shuttle_list', key: 'routes', title: '校车出行', targetType: 'shuttle_route' },
  'lost-found': { action: 'lost_found_list', key: 'items', title: '失物招领', targetType: 'lost_found' },
  events: { action: 'events_list', key: 'events', title: '活动社团', targetType: 'event' },
  guides: { action: 'guides_list', key: 'guides', title: '校园指南', targetType: 'guide' },
}
Page({
  data: { kind: '', title: '校园内容', items: [], page: 0, hasMore: false, loading: true, error: '', posting: false, postTitle: '', postBody: '', submitting: false, reportTarget: null, reportIndex: 0, reportReasons: ['信息不准确','隐私风险','辱骂或骚扰','违规内容','其他问题'], reportDetail: '', reporting: false, notice: '' },
  onLoad(options) { const source = sources[options.kind] || sources.guides; this.source = source; this.setData({ kind: options.kind, title: source.title }); ui.present(this); wx.setNavigationBarTitle({ title: source.title }); this.load() },
  async load() {
    if (!this.source) return
    this.setData({ loading: true, error: '' })
    try { const result = await api.campusRequest(this.source.action, { page: this.data.page }); const value = result[this.source.key]; this.setData({ items: Array.isArray(value) ? value : value ? [value] : [], hasMore: Boolean(result.hasMore) }) }
    catch (error) { this.setData({ error: error.message, items: [] }) }
    finally { this.setData({ loading: false }) }
  },
  displayTitle(item) { return item.title || item.name || item.course_name || item.teacher_name || item.route_name || '校园内容' },
  displayBody(item) { return item.description || item.body || item.note || item.department || item.meetup_area || item.approximate_location || item.status || '' },
  onRetry() { this.load() },
  nextPage() { if (!this.data.loading && this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.load() } },
  previousPage() { if (!this.data.loading && this.data.page) { this.setData({ page: this.data.page - 1 }); this.load() } },
  openPost() { if (!api.isLoggedIn()) { wx.navigateTo({ url: '/pages/account/index' }); return }; this.setData({ posting: true, error: '', notice: '' }) },
  closePost() { this.setData({ posting: false }) },
  onPostTitle(event) { this.setData({ postTitle: event.detail.value }) },
  onPostBody(event) { this.setData({ postBody: event.detail.value }) },
  async submitPost() {
    if (this.data.submitting) return
    this.setData({ submitting: true, error: '', notice: '' })
    try {
      await api.campusRequest('content_submit', { type: this.source.targetType, title: this.data.postTitle, body: this.data.postBody })
      this.setData({ posting: false, postTitle: '', postBody: '', notice: '投稿已提交，通过校园审核后会公开显示。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ submitting: false }) }
  },
  openReport(event) {
    const item = this.data.items.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (!item) return
    this.setData({ reportTarget: item, reportDetail: '', reportIndex: 0, error: '', notice: '' })
  },
  onReportIndex(event) { this.setData({ reportIndex: Number(event.detail.value) || 0 }) },
  onReportDetail(event) { this.setData({ reportDetail: event.detail.value }) },
  closeReport() { this.setData({ reportTarget: null, reportDetail: '' }) },
  async submitReport() {
    if (!api.isLoggedIn()) { wx.navigateTo({ url: '/pages/account/index' }); return }
    if (this.data.reporting || !this.data.reportTarget) return
    const reasons = ['inaccurate','privacy','abuse','prohibited','other']
    this.setData({ reporting: true, error: '', notice: '' })
    try {
      await api.campusRequest('content_report', { targetType: this.source.targetType, targetId: this.data.reportTarget.id, reason: reasons[this.data.reportIndex] || 'other', detail: this.data.reportDetail })
      this.setData({ reportTarget: null, reportDetail: '', notice: '举报已提交。审核人员会核对内容并记录处理依据。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ reporting: false }) }
  },
})
