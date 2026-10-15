const api = require('../../utils/api')
Page({
  data: { loggedIn: false, verifiedEmail: false, loading: false, error: '' },
  onShow() {
    const session = api.getSession()
    this.setData({ loggedIn: Boolean(session?.access_token), verifiedEmail: Boolean(session?.user?.hasVerifiedEmail), error: '' })
  },
  openCampus() { wx.switchTab({ url: '/pages/campus/index' }) },
  openFeedback() { wx.switchTab({ url: '/pages/feedback/index' }) },
  openAccount() { wx.switchTab({ url: '/pages/account/index' }) },
  openReview() { wx.navigateTo({ url: '/pages/review/index' }) },
})
