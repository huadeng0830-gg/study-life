const api = require('../../utils/api')
const ui = require('../../utils/presentation')
Page({
  data: { loggedIn: false, access: null, items: [], page: 0, hasMore: false, loading: true, error: '', reasons: {}, busy: '' },
  onShow() { ui.present(this); this.setData({ loggedIn: api.isLoggedIn() }); this.load() },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()) },
  async load() {
    if (!api.isLoggedIn()) { this.setData({ loading: false, access: null, items: [] }); return }
    this.setData({ loading: true, error: '' })
    try {
      const access = await api.campusRequest('governance_access')
      this.setData({ access })
      if (!access.reviewer) { this.setData({ items: [] }); return }
      const result = await api.campusRequest('moderation_queue', { page: this.data.page, type: '' })
      this.setData({ items: (result.items || []).map(entry => ({ ...entry, key: `${entry.type}:${entry.item.id}` })), hasMore: Boolean(result.hasMore) })
    } catch (error) { this.setData({ error: error.message, items: [] }) }
    finally { this.setData({ loading: false }) }
  },
  onReason(event) { this.setData({ [`reasons.${event.currentTarget.dataset.id}`]: event.detail.value }) },
  nextPage() { if (!this.data.loading && this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.load() } },
  previousPage() { if (!this.data.loading && this.data.page) { this.setData({ page: this.data.page - 1 }); this.load() } },
  async decide(event) {
    if (this.data.busy) return
    const id = event.currentTarget.dataset.id
    const decision = event.currentTarget.dataset.decision
    const entry = this.data.items.find((item) => item.item.id === id)
    const reason = (this.data.reasons[id] || '').trim()
    if (!entry || !reason) { this.setData({ error: '请先填写处理依据；写明结论后才会计入审核贡献。' }); return }
    this.setData({ busy: id, error: '' })
    try {
      if (entry.type === 'report') {
        const mapped = decision === 'remove' ? 'remove' : decision === 'dismiss' ? 'dismiss' : 'resolve'
        await api.campusRequest('report_resolve', { reportId: id, decision: mapped, reason, revision: entry.item.revision, targetRevision: entry.item.target?.review_revision || entry.item.target?.revision || null })
      } else {
        await api.campusRequest('moderation_decide', { targetType: entry.type, targetId: id, decision, reason, revision: entry.item.review_revision || entry.item.revision })
      }
      this.setData({ [`reasons.${id}`]: '', error: '' })
      await this.load()
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ busy: '' }) }
  },
  openAccount() { wx.navigateTo({ url: '/pages/account/index' }) },
})
