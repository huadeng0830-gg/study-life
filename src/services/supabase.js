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

// 账号 SDK 按需加载；会话键不使用 sl_ 前缀，避免进入业务备份、设备副本或云同步。
export async function getSupabaseClient() {
  const config = getSupabaseConfig()
  if (!config) throw new Error('account_unavailable')
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(config.url, config.key, {
        auth: {
          storageKey: ACCOUNT_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'implicit',
        },
      }))
      .catch((error) => {
        clientPromise = null
        throw error
      })
  }
  return clientPromise
}
