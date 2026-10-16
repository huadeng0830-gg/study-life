const api = require('../../utils/api')
const ui = require('../../utils/presentation')
const modes = ['applications', 'feedback', 'audits', 'reviewers']
const statusKeys = ['pending', 'processing', 'resolved', 'not_adopted']
Page({
  data: { allowed: false, loading: true, busy: false, error: '', notice: '', mode: 'applications', tabs: ['审核员申请', '反馈建议', '审核复核', '审核授权'], tabIndex: 0, items: [], selected: null, page: 0, hasMore: false, reason: '', school: '', campus: '', reply: '', reward: '', statusIndex: 0, statuses: ['待回应', '处理中', '已解决', '暂不采纳'], visibilityIndex: 0, visibilities: ['公开', '隐藏'] },
  onShow() { ui.present(this); this.load() },
  async load() {
    const epoch = (this.epoch || 0) + 1
    this.epoch = epoch
    this.setData({ loading: true, error: '', selected: null })
    try {
      if (!api.isLoggedIn()) throw new Error('请先使用微信登录。')
      const access = await api.campusRequest('governance_access')
      if (!access.owner) throw new Error('当前账号没有总管理员权限。')
      const result = await api.adminRequest(this.data.mode, { page: this.data.page })
      if (this.epoch !== epoch) return
      const rows = result.items || []
      const items = rows.slice(0, 40).map(row => ({ ...row, id: row.id || row._id, displayTitle: row.title || row.school || row.event?.target_type || '审核记录', displayBody: row.body || row.reason || row.event?.reason || '', displayStatus: row.status || row.outcome || (row.active ? '有效授权' : '已撤销') }))
      this.setData({ allowed: true, items, hasMore: rows.length > 40 })
    } catch (error) { if (this.epoch === epoch) this.setData({ error: error.message, allowed: false, items: [] }) }
    finally { if (this.epoch === epoch) this.setData({ loading: false }) }
  },
  changeMode(event) {
    const index = Number(event.detail.value)
    if (!modes[index]) return
    this.setData({ tabIndex: index, mode: modes[index], page: 0, items: [], notice: '' })
    this.load()
  },
  select(event) {
    const row = this.data.items.find(item => item.id === event.currentTarget.dataset.id)
    if (!row) return
    this.setData({ selected: row, reason: '', school: row.school || '', campus: row.campus || '', reply: row.public_reply || '', reward: '', statusIndex: Math.max(0, statusKeys.indexOf(row.status)), visibilityIndex: row.visibility === 'hidden' ? 1 : 0, error: '', notice: '' })
  },
  input(event) {
    const field = event.currentTarget.dataset.field
    if (['reason', 'school', 'campus', 'reply', 'reward'].includes(field)) this.setData({ [field]: event.detail.value })
  },
  statusChange(event) { this.setData({ statusIndex: Number(event.detail.value) }) },
  visibilityChange(event) { this.setData({ visibilityIndex: Number(event.detail.value) }) },
  async act(event) {
    if (this.data.busy || !this.data.selected) return
    const decision = event.currentTarget.dataset.decision
    const row = this.data.selected
    this.setData({ busy: true, error: '', notice: '' })
    try {
      if (this.data.mode === 'applications') {
        await api.adminRequest('application_decide', { applicationId: row.id, revision: row.revision, decision, reason: this.data.reason, school: this.data.school, campus: this.data.campus })
      } else if (this.data.mode === 'feedback') {
        const reward = this.data.reward.trim() ? Number(this.data.reward) : null
        if (reward !== null && (!Number.isInteger(reward) || reward < 0 || reward > 20)) throw new Error('奖励须为 0–20 的整数，暂不奖励请留空。')
        await api.adminRequest('feedback_manage', { feedbackId: row.id, revision: row.revision, status: statusKeys[this.data.statusIndex], visibility: this.data.visibilityIndex === 0 ? 'public' : 'hidden', reply: this.data.reply, publicReason: this.data.reason, reward })
      } else if (this.data.mode === 'audits') {
        await api.adminRequest('audit_resolve', { auditId: row.id, correct: decision === 'correct', reopen: decision === 'reopen', reason: this.data.reason })
      } else {
        if (!this.data.reason.trim()) throw new Error('请填写撤销授权的依据。')
        await api.adminRequest('reviewer_revoke', { userId: row.id, reason: this.data.reason })
      }
      this.setData({ notice: '处理已保存。', selected: null })
      await this.load()
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ busy: false }) }
  },
  nextPage() { if (!this.data.loading && !this.data.busy && this.data.hasMore) { this.setData({ page: this.data.page + 1 }); this.load() } },
  previousPage() { if (!this.data.loading && !this.data.busy && this.data.page) { this.setData({ page: this.data.page - 1 }); this.load() } },
})
