const api = require('../../utils/api')
const statusText = { pending: '等待审核', approved: '已批准', declined: '暂不通过', withdrawn: '已撤回' }
const ledgerLabels = { review_award: '校园审核奖励', audit_reversal: '复核调整', feedback_award: '建议处理奖励', purchase: '充值入账', redemption: '数字权益兑换', manual_adjustment: '管理员调整' }
function wxCode() {
  return new Promise((resolve, reject) => wx.login({ success: (result) => result.code ? resolve(result.code) : reject(new Error('微信登录凭证获取失败，请重试。')), fail: () => reject(new Error('微信登录失败，请稍后重试。')) }))
}
function blankProfile() { return { nickname: '', school: '', campus: '', emailDiscoverable: false, timezone: 'Asia/Shanghai', scheduleCompleteThrough: '', semesterEnd: '', availabilityPreferences: { startTime: '09:00', endTime: '22:00', minimumMinutes: 90, classBufferMinutes: 30, includeWeekends: true } } }
function ledgerDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
Page({
  data: { loggedIn: false, hasVerifiedEmail: false, email: '', loading: false, saving: false, applying: false, replying: false, binding: false, error: '', notice: '', profile: blankProfile(), wallet: null, application: null, bindEmail: '', bindPassword: '', reviewerReason: '', applicantResponse: '', currencies: [] },
  onShow() { this.syncAccount() },
  async syncAccount() {
    const session = api.getSession()
    const loggedIn = Boolean(session?.access_token)
    const email = String(session?.user?.email || '')
    const hasVerifiedEmail = Boolean(session?.user?.hasVerifiedEmail || (session?.user?.email_confirmed_at && email && !email.endsWith('.study-life.invalid')))
    this.setData({ loggedIn, hasVerifiedEmail, email, error: '', notice: '' })
    if (loggedIn) await Promise.all([this.loadProfile(), this.loadWallet(), this.loadApplication()])
  },
  async loginWechat() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '', notice: '' })
    try {
      const result = await api.wechatLogin(await wxCode())
      api.saveSession({ ...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + 3600 })
      this.setData({ notice: result.created ? '微信账号已建立。请补充校园资料。' : '微信登录成功。', loggedIn: true, hasVerifiedEmail: Boolean(result.user?.hasVerifiedEmail), email: result.user?.email || '' })
      await Promise.all([this.loadProfile(), this.loadWallet(), this.loadApplication()])
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ loading: false }) }
  },
  async bindExistingEmail() {
    if (this.data.binding || !this.data.bindEmail || !this.data.bindPassword) { this.setData({ error: '请输入已验证账号的邮箱和密码。' }); return }
    this.setData({ binding: true, error: '', notice: '' })
    try {
      await api.emailLogin(this.data.bindEmail, this.data.bindPassword)
      const result = await api.wechatLogin(await wxCode())
      api.saveSession({ ...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + 3600 })
      this.setData({ loggedIn: true, hasVerifiedEmail: Boolean(result.user?.hasVerifiedEmail), email: result.user?.email || this.data.bindEmail, bindPassword: '', notice: result.linked ? '微信已绑定到现有邮箱账号，原账号资料保持不变。' : '微信绑定完成。' })
      await Promise.all([this.loadProfile(), this.loadWallet(), this.loadApplication()])
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ binding: false }) }
  },
  async loadProfile() {
    try { const result = await api.profileRequest('profile_get'); const empty = blankProfile(); const value = result.profile || {}; this.setData({ profile: { ...empty, ...value, availabilityPreferences: { ...empty.availabilityPreferences, ...(value.availabilityPreferences || {}) } } }) }
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
    }
    catch (error) { this.setData({ error: error.message }) }
  },
  async loadApplication() {
    if (!this.data.hasVerifiedEmail) return
    try { const result = await api.communityRequest('reviewer_application_mine'); this.setData({ application: result.application ? { ...result.application, statusLabel: statusText[result.application.status] || result.application.status } : null }) }
    catch (error) { this.setData({ error: error.message }) }
  },
  onProfileInput(event) { this.setData({ [`profile.${event.currentTarget.dataset.field}`]: event.detail.value }) },
  onEmail(event) { this.setData({ bindEmail: event.detail.value }) },
  onPassword(event) { this.setData({ bindPassword: event.detail.value }) },
  onReviewerReason(event) { this.setData({ reviewerReason: event.detail.value }) },
  onApplicantResponse(event) { this.setData({ applicantResponse: event.detail.value }) },
  async saveProfile() {
    if (this.data.saving) return
    const profile = this.data.profile
    if (!profile.nickname.trim() || !profile.scheduleCompleteThrough || !profile.semesterEnd) { this.setData({ error: '请填写昵称、课表确认日期和学期结束日期。' }); return }
    this.setData({ saving: true, error: '', notice: '' })
    try {
      const result = await api.profileRequest('profile_save', { ...profile, emailDiscoverable: this.data.hasVerifiedEmail && profile.emailDiscoverable })
      this.setData({ profile: result.profile, notice: '个人资料已保存。' })
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ saving: false }) }
  },
  async applyReviewer() {
    if (!this.data.hasVerifiedEmail) { this.setData({ error: '申请审核员前，请先绑定并验证现有邮箱账号。' }); return }
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
      this.setData({ applicantResponse: '', notice: '补充材料已提交，总管理员可以继续处理申请。' })
      await this.loadApplication()
    } catch (error) { this.setData({ error: error.message }) }
    finally { this.setData({ replying: false }) }
  },
  async logout() { await api.signOut(); this.setData({ loggedIn: false, hasVerifiedEmail: false, email: '', wallet: null, currencies: [], application: null, profile: blankProfile(), notice: '已退出小程序账号。' }) },
})
