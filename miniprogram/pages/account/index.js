const api = require('../../utils/api')
const ui = require('../../utils/presentation')
const statusText = { pending: '等待审核', approved: '已批准', declined: '暂不通过', withdrawn: '已撤回' }
const ledgerLabels = { review_award: '校园审核奖励', audit_reversal: '复核调整', feedback_award: '建议处理奖励', purchase: '充值入账', redemption: '数字权益兑换', manual_adjustment: '管理员调整' }
function blankProfile() { return { nickname: '', school: '', campus: '', timezone: 'Asia/Shanghai', scheduleCompleteThrough: '', semesterEnd: '' } }
function ledgerDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
Page({
  data: { loggedIn: false, userId: '', owner: false, reviewer: false, loading: false, saving: false, applying: false, replying: false, error: '', notice: '', profile: blankProfile(), wallet: null, application: null, reviewerReason: '', applicantResponse: '', currencies: [] },
  onShow() { ui.present(this); this.syncAccount() },
  async syncAccount() {
    const session = api.getSession()
    this.setData({ loggedIn: Boolean(session), userId: session?.user.id || '', owner: false, error: '', notice: '' })
    if (!session) return
    try {
      const result = await api.syncSession()
      this.setData({ userId: result.user.id, owner: result.user.owner === true })
      await Promise.all([this.loadProfile(), this.loadWallet(), this.loadApplication()])
    } catch (error) {
      this.setData({ loggedIn: api.isLoggedIn(), error: error.message })
    }
  },
  async loginWechat() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '', notice: '' })
    try {
      const result = await api.wechatLogin()
      this.setData({ notice: result.created ? '微信账号已建立，请补充校园资料。' : '微信登录成功。', loggedIn: true, userId: result.user.id, owner: result.user.owner === true })
      await Promise.all([this.loadProfile(), this.loadWallet(), this.loadApplication()])
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ loading: false }) }
  },
  async loadProfile() {
    try { const result = await api.profileRequest('profile_get'); this.setData({ profile: { ...blankProfile(), ...result.profile } }) }
    catch (error) { this.setData({ error: error.message }) }
  },
  async loadWallet() {
    try {
      const result = await api.communityRequest('wallet')
      const currencies = (result.ledger || []).map(item => {
        const amount = Number(item.amount) || 0
        return { ...item, entryLabel: ledgerLabels[item.entry_type] || '豆豆变动', beanLabel: item.bean_type === 'purchased' ? '充值豆' : '贡献豆', amountLabel: amount > 0 ? `+${amount}` : String(amount), amountTone: amount >= 0 ? 'positive' : 'negative', createdLabel: ledgerDate(item.created_at) }
      })
      this.setData({ wallet: result.wallet, currencies })
    } catch (error) { this.setData({ error: error.message }) }
  },
  async loadApplication() {
    try {
      const [result, access] = await Promise.all([api.communityRequest('reviewer_application_mine'), api.campusRequest('governance_access')])
      this.setData({ reviewer: access.reviewer, application: result.application ? { ...result.application, statusLabel: statusText[result.application.status] || result.application.status } : null })
    } catch (error) { this.setData({ error: error.message }) }
  },
  onProfileInput(event) {
    const field = event.currentTarget.dataset.field
    if (['nickname', 'school', 'campus', 'scheduleCompleteThrough', 'semesterEnd'].includes(field)) this.setData({ [`profile.${field}`]: event.detail.value })
  },
  onReviewerReason(event) { this.setData({ reviewerReason: event.detail.value }) },
  onApplicantResponse(event) { this.setData({ applicantResponse: event.detail.value }) },
  async saveProfile() {
    if (this.data.saving) return
    const profile = this.data.profile
    if (!profile.nickname.trim() || !profile.school.trim() || !profile.scheduleCompleteThrough || !profile.semesterEnd) { this.setData({ error: '请填写昵称、学校、课表确认日期和学期结束日期。' }); return }
    this.setData({ saving: true, error: '', notice: '' })
    try {
      const result = await api.profileRequest('profile_save', profile)
      this.setData({ profile: result.profile, notice: '个人资料已保存。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ saving: false }) }
  },
  async applyReviewer() {
    if (this.data.applying) return
    if (this.data.reviewerReason.trim().length < 10) { this.setData({ error: '申请理由至少填写 10 个字。' }); return }
    this.setData({ applying: true, error: '', notice: '' })
    try {
      await api.communityRequest('reviewer_apply', { reason: this.data.reviewerReason })
      this.setData({ reviewerReason: '', notice: '申请已提交，等待总管理员审批。' })
      await this.loadApplication()
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ applying: false }) }
  },
  async replyToApplication() {
    const response = this.data.applicantResponse.trim()
    if (this.data.replying) return
    if (!this.data.application?.id || response.length < 3) { this.setData({ error: '请至少填写 3 个字的补充内容。' }); return }
    this.setData({ replying: true, error: '', notice: '' })
    try {
      await api.communityRequest('reviewer_application_reply', { applicationId: this.data.application.id, response })
      this.setData({ applicantResponse: '', notice: '补充材料已提交。' })
      await this.loadApplication()
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ replying: false }) }
  },
  copyUserId() { if (this.data.userId) wx.setClipboardData({ data: this.data.userId }) },
  openAdmin() { wx.navigateTo({ url: '/pages/admin/index' }) },
  async logout() {
    await api.signOut()
    this.setData({ loggedIn: false, userId: '', owner: false, reviewer: false, wallet: null, currencies: [], application: null, profile: blankProfile(), notice: '已退出小程序账号。' })
  },
})
