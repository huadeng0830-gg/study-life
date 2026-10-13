import { describe, expect, it, vi } from 'vitest'
import { createPlatformAdminHandler } from '../supabase/functions/platform-admin/handler.js'

const OWNER = { id: '71bbaaa0-1ef1-4ad4-9b77-90b792846c10', email: 'owner@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' }
const TARGET_ID = '1f80fded-15f4-4b07-a262-3be8b47463d9'
const ALLOWED_ORIGIN = 'https://study-life.pages.dev'

function makeHandler(overrides = {}) {
  const service = {
    authenticate: vi.fn(async (token) => token === 'valid' ? OWNER : null),
    isOwner: vi.fn(async (id) => id === OWNER.id),
    getOverview: vi.fn(async () => ({ counts: { accounts: 1, activeProjects: 0 } })),
    listUsers: vi.fn(async () => ({ users: [], page: 1, pageSize: 25, total: 0 })),
    listAudit: vi.fn(async () => []),
    setUserSuspended: vi.fn(async () => ({ status: 'suspended', auditIncomplete: false })),
    ...overrides,
  }
  return { handler: createPlatformAdminHandler({ service, allowedOrigins: [ALLOWED_ORIGIN], logger: { error: vi.fn() } }), service }
}

function request({ method = 'POST', body = {}, token = 'valid', origin = ALLOWED_ORIGIN } = {}) {
  return new Request('https://project.example/functions/v1/platform-admin', {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

describe('platform-admin function authorization boundary', () => {
  it('requires a verified bearer session and owner membership before doing admin work', async () => {
    const { handler, service } = makeHandler()
    const missing = await handler(request({ token: '' }))
    expect(missing.status).toBe(401)
    expect(service.authenticate).not.toHaveBeenCalled()

    const invalid = await handler(request({ token: 'invalid' }))
    expect(invalid.status).toBe(401)
    expect(service.isOwner).not.toHaveBeenCalled()

    const unconfirmed = makeHandler({ authenticate: vi.fn(async () => ({ ...OWNER, email_confirmed_at: null })) })
    expect((await unconfirmed.handler(request())).status).toBe(403)
    expect(unconfirmed.service.isOwner).not.toHaveBeenCalled()

    const nonOwner = makeHandler({ isOwner: vi.fn(async () => false) })
    const denied = await nonOwner.handler(request({ body: { action: 'overview' } }))
    expect(denied.status).toBe(403)
    expect(nonOwner.service.getOverview).not.toHaveBeenCalled()
  })

  it('returns identity only after authorization and sets same-origin, no-store headers', async () => {
    const { handler } = makeHandler()
    const response = await handler(request({ body: { action: 'identity' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ data: { owner: true, email: OWNER.email } })
  })

  it('rejects unknown actions, invalid origins, oversized bodies and unsupported methods', async () => {
    const { handler, service } = makeHandler()
    expect((await handler(request({ method: 'GET' }))).status).toBe(405)
    expect((await handler(request({ origin: 'https://malicious.example' }))).status).toBe(403)
    expect((await handler(request({ body: { action: 'read_everything' } }))).status).toBe(400)
    expect((await handler(request({ body: 'x'.repeat(8_193) }))).status).toBe(413)
    expect(service.getOverview).not.toHaveBeenCalled()
  })

  it('blocks self-suspension and validates identifiers and reasons before calling the service', async () => {
    const { handler, service } = makeHandler()
    const self = await handler(request({ body: { action: 'user_suspend', payload: { userId: OWNER.id, reason: 'security review' } } }))
    expect(self.status).toBe(403)
    const malformed = await handler(request({ body: { action: 'user_suspend', payload: { userId: 'not-a-uuid', reason: 'security review' } } }))
    expect(malformed.status).toBe(400)
    const missingReason = await handler(request({ body: { action: 'user_suspend', payload: { userId: TARGET_ID, reason: ' ' } } }))
    expect(missingReason.status).toBe(400)
    expect(service.setUserSuspended).not.toHaveBeenCalled()
  })

  it('forwards validated user status changes and reports whether audit completion failed', async () => {
    const { handler, service } = makeHandler({ setUserSuspended: vi.fn(async () => ({ status: 'suspended', auditIncomplete: true })) })
    const response = await handler(request({ body: { action: 'user_suspend', payload: { userId: TARGET_ID, reason: 'Spam account reported' } } }))
    expect(response.status).toBe(200)
    expect(service.setUserSuspended).toHaveBeenCalledWith({
      actorUserId: OWNER.id,
      targetUserId: TARGET_ID,
      suspended: true,
      reason: 'Spam account reported',
    })
    expect(await response.json()).toEqual({ data: { status: 'suspended', auditIncomplete: true } })
  })
})
