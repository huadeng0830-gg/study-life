import { readPublicSupabaseConfig } from './supabase-build-checks.mjs'

try {
  const config = readPublicSupabaseConfig('production')
  const response = await fetch(new URL('/auth/v1/settings', config.url), { headers: { apikey: config.key }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('无法读取公开认证配置。')
  const settings = await response.json()
  console.log(JSON.stringify({ github: settings.external?.github === true, google: settings.external?.google === true, email: settings.external?.email === true, signupDisabled: settings.disable_signup === true }))
} catch { console.error('公开认证配置核验失败，请检查网络和公开项目配置。'); process.exitCode = 1 }
