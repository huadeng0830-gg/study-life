const config = require('../config')
const SESSION_KEY = 'study-life-mini-session-v1'

function getSession() {
  try { return wx.getStorageSync(SESSION_KEY) || null } catch { return null }
}
function saveSession(session) {
  wx.setStorageSync(SESSION_KEY, session)
}
function clearSession() {
  try { wx.removeStorageSync(SESSION_KEY) } catch { /* storage can be unavailable in preview */ }
}
function configured() { return /^https:\/\//.test(config.supabaseUrl) && Boolean(config.supabaseAnonKey) }
function endpoint(path) { return `${config.supabaseUrl.replace(/\/$/, '')}${path}` }
function request(path, body, token = '') {
  if (!configured()) return Promise.reject(new Error('请先在 miniprogram/config.js 配置 Supabase URL 和公开 anon key。'))
  return new Promise((resolve, reject) => wx.request({
    url: endpoint(path), method: 'POST', data: body,
    header: { 'content-type': 'application/json', apikey: config.supabaseAnonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    success(result) {
      if (result.statusCode < 200 || result.statusCode >= 300) return reject(new Error(result.data?.error || result.data?.msg || '服务暂时不可用，请稍后重试。'))
      resolve(result.data)
    },
    fail() { reject(new Error('网络连接失败，请检查网络后重试。')) },
  }))
}
async function refreshSession() {
  const session = getSession()
  if (!session?.refresh_token) return null
  try {
    const result = await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
    saveSession({ ...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in })
    return getSession()
  } catch { clearSession(); return null }
}
async function activeToken(required = true) {
  let session = getSession()
  if (session?.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60) session = await refreshSession()
  if (required && !session?.access_token) throw new Error('请先登录后继续。')
  return session?.access_token || ''
}
async function functionRequest(name, action, payload = {}, { required = true } = {}) {
  const token = await activeToken(required)
  const result = await request(`/functions/v1/${name}`, { action, payload }, token)
  if (result?.error) throw new Error(result.error)
  return result?.data
}
function wechatLogin(code) { return functionRequest('wechat-auth', 'login', { code }, { required: false }) }
function campusRequest(action, payload = {}) { return functionRequest('campus-life', action, payload) }
function profileRequest(action, payload = {}) { return functionRequest('campus-social', action, payload) }
function communityRequest(action, payload = {}, required = action !== 'public_list') {
  return functionRequest('campus-community', action, payload, { required })
}
async function emailLogin(email, password) {
  const result = await request('/auth/v1/token?grant_type=password', { email: String(email || '').trim().toLowerCase(), password })
  saveSession({ ...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in })
  return result.user
}
async function signOut() {
  const token = await activeToken(false)
  try { if (token) await request('/auth/v1/logout', {}, token) } finally { clearSession() }
}
module.exports = { SESSION_KEY, getSession, saveSession, clearSession, activeToken, wechatLogin, campusRequest, profileRequest, communityRequest, emailLogin, signOut }
