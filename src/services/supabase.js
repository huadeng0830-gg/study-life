export const ACCOUNT_STORAGE_KEY = 'study-life-auth'

export function getSupabaseConfig(env = import.meta.env) {
  const url = String(env?.VITE_SUPABASE_URL || '').trim()
  const key = String(env?.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()
  let publicKey = key.startsWith('sb_publishable_')
  if (!publicKey && key.split('.').length === 3) {
    try {
      const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      publicKey = JSON.parse(atob(payload)).role === 'anon'
    } catch { /* 无法识别的密钥不能进入浏览器客户端。 */ }
  }
  try {
    const parsed = new URL(url)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null
  } catch { return null }
  return publicKey ? { url, key } : null
}

let clientPromise = null

export function supabaseClientOptions(isDesktop = typeof window !== 'undefined' && window.studyLifeDesktop?.isDesktop === true) {
  return {
    auth: {
      storageKey: ACCOUNT_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // Callback URLs are consumed explicitly before the Hash Router starts.
      detectSessionInUrl: false,
      // Web email confirmation uses a one-time PKCE code. The desktop confirmation
      // page intentionally stays on implicit tokens because it opens in an external browser.
      flowType: isDesktop ? 'implicit' : 'pkce',
    },
  }
}

// 账号 SDK 按需加载；会话键不使用 sl_ 前缀，避免进入业务备份、设备副本或云同步。
export async function getSupabaseClient() {
  const config = getSupabaseConfig()
  if (!config) throw new Error('account_unavailable')
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(config.url, config.key, supabaseClientOptions()))
      .catch((error) => {
        clientPromise = null
        throw error
      })
  }
  return clientPromise
}

// Verify the old password without replacing or broadcasting the active session.
// Supabase only enforces current_password when its server policy is enabled.
export async function verifyAccountCurrentPassword(email, password) {
  const config = getSupabaseConfig()
  if (!config) throw new Error('account_unavailable')
  const { createClient } = await import('@supabase/supabase-js')
  const verifier = createClient(config.url, config.key, {
    auth: { storageKey: 'study-life-password-check', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const result = await verifier.auth.signInWithPassword({ email, password })
  if (result.data?.session) {
    const { error } = await verifier.auth.signOut({ scope: 'local' })
    if (error) throw error
  }
  return { data: { user: result.data?.user || null }, error: result.error }
}
