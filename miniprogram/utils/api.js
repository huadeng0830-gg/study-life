const config = require('../config')
const SESSION_KEY = 'study-life-mini-cloud-session-v1'
let initializedEnv = ''

function configurationError() {
  if (!config.cloudEnvId || /^wx[0-9a-f]{16}$/i.test(config.cloudEnvId)) return '请先在 miniprogram/config.js 填写云开发环境 ID（EnvID），不是小程序 AppID。'
  if (!wx.cloud) return '当前微信版本不支持云开发，请更新微信后重试。'
  return ''
}
function initializeCloud() {
  if (configurationError()) return false
  if (initializedEnv !== config.cloudEnvId) {
    wx.cloud.init({ env: config.cloudEnvId })
    initializedEnv = config.cloudEnvId
  }
  return true
}
function getSession() {
  try {
    const session = wx.getStorageSync(SESSION_KEY)
    return session?.provider === 'wechat-cloud' && session.environment === config.cloudEnvId && session.user?.id ? session : null
  } catch { return null }
}
function isLoggedIn() { return Boolean(getSession()) }
function saveSession(result) {
  if (!result?.user?.id) throw new Error('登录结果无效，请重试。')
  const session = { provider: 'wechat-cloud', environment: config.cloudEnvId, user: result.user }
  wx.setStorageSync(SESSION_KEY, session)
  return session
}
function clearSession() {
  try { wx.removeStorageSync(SESSION_KEY); wx.removeStorageSync('study-life-mini-session-v1'); wx.removeStorageSync('study-life-quick-draft') } catch { /* storage can be unavailable */ }
}
async function call(service, action, payload = {}, required = true) {
  const error = configurationError()
  if (error) throw new Error(error)
  if (required && !isLoggedIn()) throw new Error('请先在「我的账号」使用微信登录。')
  initializeCloud()
  let response
  try {
    response = await wx.cloud.callFunction({ name: config.cloudFunctionName, config: { env: config.cloudEnvId }, data: { service, action, payload } })
  } catch {
    throw new Error('云服务连接失败，请检查环境 ID，并确认 study-life 云函数已上传部署。')
  }
  const result = response?.result
  if (!result || typeof result.ok !== 'boolean') throw new Error('云函数返回异常，请检查部署版本。')
  if (!result.ok) {
    if (result.code === 'unauthorized') clearSession()
    const failure = new Error(result.error || '服务暂时不可用，请稍后重试。')
    failure.code = result.code
    throw failure
  }
  return result.data
}
async function wechatLogin() {
  const result = await call('account', 'login', {}, false)
  saveSession(result)
  return result
}
async function syncSession() {
  if (!isLoggedIn()) return null
  const result = await call('account', 'session')
  saveSession(result)
  return result
}
function campusRequest(action, payload = {}) { return call('campus', action, payload) }
function profileRequest(action, payload = {}) { return call('profile', action, payload) }
function communityRequest(action, payload = {}, required = action !== 'public_list') { return call('community', action, payload, required) }
function adminRequest(action, payload = {}) { return call('admin', action, payload) }
function personalRequest(action, payload = {}) { return call('personal', action, payload) }
async function signOut() { clearSession() }
module.exports = { SESSION_KEY, initializeCloud, getSession, isLoggedIn, saveSession, clearSession, wechatLogin, syncSession, campusRequest, profileRequest, communityRequest, adminRequest, personalRequest, signOut }
