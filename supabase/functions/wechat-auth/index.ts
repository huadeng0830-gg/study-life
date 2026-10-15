/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

const url = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
const appId = Deno.env.get('WECHAT_MINIPROGRAM_APP_ID') || ''
const appSecret = Deno.env.get('WECHAT_MINIPROGRAM_APP_SECRET') || ''
const identitySecret = Deno.env.get('WECHAT_IDENTITY_HASH_SECRET') || ''
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const sessionClient = anonKey ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null
const encoder = new TextEncoder()

class AuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('')
}

async function keyedHash(value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(identitySecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('')
}

async function currentUser(request: Request) {
  const token = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new AuthError('unauthorized', '当前登录已失效，请重新登录。', 401)
  return data.user
}

async function wechatOpenId(code: unknown) {
  const jsCode = String(code || '').trim()
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(jsCode)) throw new AuthError('invalid_code', '微信登录凭证无效，请重新点击登录。')
  const query = new URLSearchParams({ appid: appId, secret: appSecret, js_code: jsCode, grant_type: 'authorization_code' })
  const result = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query.toString()}`, { method: 'GET', signal: AbortSignal.timeout(8000) })
  if (!result.ok) throw new AuthError('wechat_unavailable', '微信身份服务暂时不可用，请稍后重试。', 503)
  const body: any = await result.json()
  if (body.errcode || !body.openid) {
    console.warn('[wechat-auth] code2session rejected', String(body.errcode || 'unknown'))
    throw new AuthError('wechat_code_rejected', '微信登录凭证已失效，请重新点击登录。', 401)
  }
  return { openid: String(body.openid), sessionKey: String(body.session_key || '') }
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function findLinkedUser(appHash: string, openidHash: string) {
  const { data, error } = await admin.from('wechat_auth_links').select('user_id').eq('app_id_hash', appHash).eq('openid_hash', openidHash).maybeSingle()
  if (error) throw error
  if (!data) return null
  const result = await admin.auth.admin.getUserById(data.user_id)
  if (result.error || !result.data.user) throw new AuthError('identity_unavailable', '微信账号关联的用户记录暂不可用，请联系管理员。', 503)
  return result.data.user
}

async function linkIdentity(appHash: string, openidHash: string, current: any) {
  const linked = await findLinkedUser(appHash, openidHash)
  if (linked?.id === current.id) return { user: current, linked: true, created: false }
  if (linked) {
    const syntheticIdentity = linked.user_metadata?.auth_method === 'wechat_miniprogram'
      && String(linked.email || '').endsWith('.study-life.invalid')
    if (!syntheticIdentity || !current.email_confirmed_at || String(current.email || '').endsWith('.study-life.invalid')) {
      throw new AuthError('identity_already_linked', '此微信已关联到另一个账号。请使用最初绑定的邮箱账号登录。', 409)
    }
    const rebound = await admin.rpc('campus_wechat_rebind_identity', { p_app_hash: appHash, p_openid_hash: openidHash, p_old_user: linked.id, p_new_user: current.id })
    if (rebound.error) {
      if (String(rebound.error.message || '').includes('CAMPUS_WECHAT_PRIVILEGE_REVIEW')) throw new AuthError('privilege_reapproval_required', '这个微信账号已有审核或管理授权。为避免权限被自动转移，请联系总管理员处理账号合并。', 409)
      if (rebound.error.code === '23505') throw new AuthError('account_merge_conflict', '两边账号存在互相冲突的校园或协作记录，系统未合并任何数据。请联系总管理员处理。', 409)
      throw rebound.error
    }
    const removed = await admin.auth.admin.deleteUser(linked.id)
    if (removed.error) console.error('[wechat-auth] empty generated identity cleanup failed', removed.error.status || 'unknown')
    return { user: current, linked: true, created: false }
  }
  const inserted = await admin.from('wechat_auth_links').insert({ app_id_hash: appHash, openid_hash: openidHash, user_id: current.id })
  if (inserted.error?.code === '23505') throw new AuthError('identity_already_linked', '此微信身份已关联到其他账号。', 409)
  if (inserted.error) throw inserted.error
  return { user: current, linked: true, created: false }
}

async function createWechatUser(appHash: string, openidHash: string) {
  const email = `wx_${openidHash.slice(0, 40)}@wechat.study-life.invalid`
  const created = await admin.auth.admin.createUser({
    email, password: randomPassword(), email_confirm: true,
    user_metadata: { auth_method: 'wechat_miniprogram', has_verified_contact_email: false },
  })
  if (created.error || !created.data.user) throw created.error || new Error('auth user create failed')
  const inserted = await admin.from('wechat_auth_links').insert({ app_id_hash: appHash, openid_hash: openidHash, user_id: created.data.user.id })
  if (!inserted.error) return { user: created.data.user, linked: true, created: true }
  if (inserted.error.code === '23505') {
    await admin.auth.admin.deleteUser(created.data.user.id)
    const linked = await findLinkedUser(appHash, openidHash)
    if (linked) return { user: linked, linked: true, created: false }
  }
  await admin.auth.admin.deleteUser(created.data.user.id)
  throw inserted.error
}

async function issueSession(user: any) {
  if (!sessionClient) throw new AuthError('service_unavailable', '小程序登录服务尚未配置。', 503)
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email })
  if (link.error) throw link.error
  const tokenHash = link.data?.properties?.hashed_token
  if (!tokenHash) throw new AuthError('service_unavailable', '无法建立小程序登录会话。', 503)
  const verified = await sessionClient.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (verified.error || !verified.data.session) throw verified.error || new Error('auth session not issued')
  return {
    access_token: verified.data.session.access_token,
    refresh_token: verified.data.session.refresh_token,
    expires_at: verified.data.session.expires_at,
    user: { id: user.id, email: user.email && !String(user.email).endsWith('.study-life.invalid') ? user.email : '', hasVerifiedEmail: Boolean(user.email_confirmed_at && !String(user.email || '').endsWith('.study-life.invalid')) },
  }
}

async function handle(request: Request, body: any) {
  if (!url || !serviceKey || !anonKey || !appId || !appSecret || identitySecret.length < 32) {
    throw new AuthError('wechat_login_not_configured', '微信登录还未配置 AppID、服务端密钥和身份哈希密钥。', 503)
  }
  if (body.action !== 'login') throw new AuthError('invalid_action', '微信认证操作无效。')
  const wx = await wechatOpenId(body.code)
  const appHash = await sha256(appId)
  const openidHash = await keyedHash(`${appId}:${wx.openid}`)
  // WeChat session_key is deliberately discarded after code2session. It is never
  // returned to the Mini Program, logged, or persisted.
  wx.sessionKey = ''
  const current = await currentUser(request)
  let result
  if (current) {
    if (!current.email_confirmed_at || String(current.email || '').endsWith('.study-life.invalid')) {
      throw new AuthError('verified_email_required', '请先登录并验证现有邮箱账号，再绑定微信；这样能保留原账号资料。', 403)
    }
    result = await linkIdentity(appHash, openidHash, current)
  } else {
    const linked = await findLinkedUser(appHash, openidHash)
    result = linked ? { user: linked, linked: true, created: false } : await createWechatUser(appHash, openidHash)
  }
  const session = await issueSession(result.user)
  return { ...session, linked: result.linked, created: result.created }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
  if (request.method !== 'POST') return response({ code: 'method_not_allowed', error: '仅支持 POST。' }, 405)
  try {
    const raw = await request.text()
    if (raw.length > 8_192) throw new AuthError('invalid_input', '请求内容过大。', 413)
    const body = JSON.parse(raw)
    return response({ data: await handle(request, body) })
  } catch (error) {
    if (error instanceof AuthError) return response({ code: error.code, error: error.message }, error.status)
    const marker = String((error as any)?.message || '')
    if (/CAMPUS_WECHAT_PRIVILEGE_REVIEW/.test(marker)) return response({ code: 'privilege_reapproval_required', error: '审核或管理员权限需要总管理员重新核验。' }, 409)
    if (/23505/.test(String((error as any)?.code || ''))) return response({ code: 'identity_already_linked', error: '微信身份已关联到其他账号。' }, 409)
    console.error('[wechat-auth] request failed', (error as any)?.code || 'unknown')
    return response({ code: 'service_unavailable', error: '微信登录服务暂时不可用，请稍后重试。' }, 503)
  }
})
