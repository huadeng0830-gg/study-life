const RETIRED_SYNC_MESSAGE = '设备码与同步空间已停用，请使用账号同步或本地备份。'

export async function onRequest({ request, next }) {
  const { pathname } = new URL(request.url)
  if (pathname === '/api/auth/verify' || pathname.startsWith('/api/sync/')) {
    return new Response(JSON.stringify({ error: RETIRED_SYNC_MESSAGE }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return next()
}
