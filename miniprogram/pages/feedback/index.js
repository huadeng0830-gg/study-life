const api = require('../../utils/api')
const ui = require('../../utils/presentation')
const statusLabels = { pending: '待回应', processing: '处理中', resolved: '已解决', not_adopted: '暂不采纳' }
const categoryLabels = { product: '产品体验', campus: '校园功能', accessibility: '无障碍', other: '其他' }
Page({
  data: { items: [], page: 0, hasMore: false, loading: true, submitting: false, error: '', notice: '', loggedIn: false, title: '', body: '', category: 'product', statusOptions: ['全部', '待回应', '处理中', '已解决', '暂不采纳'], selectedStatus: '全部', categoryOptions: ['产品体验', '校园功能', '无障碍', '其他'] },
  onShow() { ui.present(this); this.setData({ loggedIn: api.isLoggedIn() }); this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    const epoch = (this.epoch || 0) + 1
    this.epoch = epoch
    this.setData({ loading: true, error: '' })
    try {
      const state = Object.keys(statusLabels).find((key) => statusLabels[key] === this.data.selectedStatus) || ''
      const result = await api.communityRequest('public_list', { status: state, offset: this.data.page * 60 }, false)
      if (this.epoch !== epoch) return
      this.setData({ hasMore: Boolean(result.hasMore), items: (result.items || []).map((item) => ({ ...item, statusLabel: statusLabels[item.status] || item.status, categoryLabel: categoryLabels[item.category] || '建议' })) })
    } catch (error) { if (this.epoch === epoch) this.setData({ error: error.message }) }
    finally { if (this.epoch === epoch) this.setData({ loading: false }) }
  },
  onTitle(event) { this.setData({ title: event.detail.value }) },
  onBody(event) { this.setData({ body: event.detail.value }) },
  onCategory(event) { const category = ['product','campus','accessibility','other'][Number(event.detail.value)] || 'product'; this.setData({ category }) },
  onStatus(event) { this.setData({ selectedStatus: this.data.statusOptions[Number(event.detail.value)] || '全部', page: 0 }); this.load() },
  nextPage() { if (!this.data.loading && this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.load() } },
  previousPage() { if (!this.data.loading && this.data.page) { this.setData({ page: this.data.page - 1 }); this.load() } },
  async submit() {
    if (!api.isLoggedIn()) { this.setData({ error: '微信登录后即可提交。' }); wx.navigateTo({ url: '/pages/account/index' }); return }
    if (this.data.submitting) return
    if (this.data.title.trim().length < 4 || this.data.body.trim().length < 10) { this.setData({ error: '标题至少 4 个字，建议内容至少 10 个字。' }); return }
    this.setData({ submitting: true, error: '', notice: '' })
    try {
      await api.communityRequest('submit', { title: this.data.title, body: this.data.body, category: this.data.category })
      this.setData({ title: '', body: '', notice: '已提交。内容通过安全检查后会匿名公开。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ submitting: false }); this.load() }
  },
})
