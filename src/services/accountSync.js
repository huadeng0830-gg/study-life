import { accountUser } from '../composables/accountAuth.js'
import { getSupabaseClient } from './supabase.js'

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function stillSignedIn(userId) { return accountUser.value?.id === userId }
function metadata(row) {
  return { exists: Boolean(row), revision: row?.revision ?? null, updatedAt: row?.updated_at ?? null,
    updatedByDeviceName: row?.device_name || '' }
}
function providerError(error, status) {
  if (error?.code === 'PGRST301' || status === 401) return response({ error: '登录已失效，请重新登录。' }, 401)
  if (error?.code === '42501' || status === 403) return response({ error: '账号没有权限访问这份同步数据。' }, 403)
  if (error?.code === '23514') return response({ error: '同步数据格式或大小超出限制。' }, 400)
  if (error?.code === 'PGRST205' || error?.code === 'PGRST202') return response({ error: '账号同步服务尚未部署，请稍后再试。' }, 503)
  return response({ error: '无法连接账号同步服务，请检查网络后重试。' }, status >= 400 ? status : 503)
}

// 将账号传输适配为现有同步协议，复用数据校验和合并规则，支持账号独立的版本提交与事务恢复。
// 用户归属由数据库 auth.uid() 和 RLS 决定，客户端不传 owner 给写入函数。
export async function requestAccountSync(operation, body, signal) {
  if (operation !== 'pull' && operation !== 'push') return response({ error: '未知账号同步操作。' }, 400)
  const userId = body.accountUserId
  if (!stillSignedIn(userId)) return response({ error: '登录已变更，本次同步已取消。' }, 401)
  const client = await getSupabaseClient()
  if (!stillSignedIn(userId)) return response({ error: '登录已变更，本次同步已取消。' }, 401)
  const { data: authData, error: authError } = await client.auth.getSession()
  const session = authData?.session
  if (authError || !session?.access_token || session.user?.id !== userId || !stillSignedIn(userId)) {
    return response({ error: '登录已变更或失效，本次同步已取消。' }, 401)
  }
  // 请求绑定已核对归属的 JWT；SDK 延迟取令牌时，即使切换账号也不能把旧数据写给新账号。
  const authorization = 'Bearer ' + session.access_token
  if (operation === 'push') {
    const { data, error, status } = await client.rpc('write_account_sync_snapshot', {
      expected_revision: body.expectedRevision ?? null,
      snapshot_payload: body.data,
      source_device_name: body.deviceName || '当前设备',
    }).setHeader('Authorization', authorization).abortSignal(signal)
    if (error) return providerError(error, status)
    if (!stillSignedIn(userId)) return response({ error: '登录已变更，本次同步已取消。' }, 401)
    return response(data, data?.conflict ? 409 : 200)
  }
  const { data, error, status } = await client.from('account_sync_snapshots')
    .select('revision,updated_at,device_name,payload')
    .eq('user_id', userId).setHeader('Authorization', authorization).abortSignal(signal).maybeSingle()
  if (error) return providerError(error, status)
  if (!stillSignedIn(userId)) return response({ error: '登录已变更，本次同步已取消。' }, 401)
  return response({ ...metadata(data), data: data?.payload ?? null })
}
