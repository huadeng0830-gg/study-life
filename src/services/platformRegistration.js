import { getSupabaseClient } from './supabase.js'

export async function readRegistrationStatus() {
  const client = await getSupabaseClient()
  const { data, error } = await client.rpc('platform_registration_status')
  if (error || typeof data !== 'boolean') throw new Error('暂时无法确认注册状态，请稍后重试。已有账号仍可登录。')
  return data
}
