import { describe, expect, it, vi } from 'vitest'
import { createPlatformAdminHandler } from '../supabase/functions/platform-admin/handler.js'

const OWNER = { id: '71bbaaa0-1ef1-4ad4-9b77-90b792846c10', email: 'owner@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' }
const TARGET_ID = '1f80fded-15f4-4b07-a262-3be8b47463d9'
const REVIEW_REVISION = 'b78c01f2-265d-4776-b345-cf3127eb1a33'
const ALLOWED_ORIGIN = 'https://study-life.pages.dev'

function makeHandler(overrides = {}) {
  const service = {
    authenticate: vi.fn(async (token) => token === 'valid' ? OWNER : null),
    isOwner: vi.fn(async (id) => id === OWNER.id),
    getOverview: vi.fn(async () => ({ counts: { accounts: 1, activeProjects: 0 } })),
    listUsers: vi.fn(async () => ({ users: [], page: 1, pageSize: 25, total: 0 })),
    listAudit: vi.fn(async () => []),
    listPendingPlaces: vi.fn(async () => []),
    listPlaceReviewAudit: vi.fn(async () => []),
    reviewCampusPlace: vi.fn(async ({ decision }) => ({ status: decision, auditIncomplete: false })),
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
  it('exposes only delegated scope and denies reviewers access to account management and grants', async () => {
    const delegated = makeHandler({ isOwner: vi.fn(async () => false), reviewerAccess: vi.fn(async () => ({ reviewer: true, scope: { school: '虚构大学', campus: '东区' } })), setReviewer: vi.fn(), listReviewers: vi.fn() })
    const identity = await delegated.handler(request({ body: { action: 'identity' } }))
    expect(await identity.json()).toEqual({ data: { owner: false, reviewer: true, scope: { school: '虚构大学', campus: '东区' }, email: '' } })
    for (const action of ['users_list', 'reviewers_list', 'reviewer_set']) expect((await delegated.handler(request({ body: { action } }))).status).toBe(403)
    expect(delegated.service.listUsers).not.toHaveBeenCalled()
    expect(delegated.service.setReviewer).not.toHaveBeenCalled()
  })

  it('requires an explicit grant state, reason and valid revision before forwarding owner grants', async () => {
    const { handler, service } = makeHandler({ setReviewer: vi.fn(async () => ({ active: true })) })
    const payload = { userId: TARGET_ID, school: '虚构大学', campus: '东区', reason: '校园内容审核', active: true, revision: 2 }
    for (const invalid of [{ active: 'true' }, { reason: ' ' }, { revision: 0 }, { school: '' }]) expect((await handler(request({ body: { action: 'reviewer_set', payload: { ...payload, ...invalid } } }))).status).toBe(400)
    expect(service.setReviewer).not.toHaveBeenCalled()
    expect((await handler(request({ body: { action: 'reviewer_set', payload } }))).status).toBe(200)
    expect(service.setReviewer).toHaveBeenCalledWith({ actorId: OWNER.id, ...payload })
  })

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
    expect(await response.json()).toEqual({ data: { owner: true, reviewer: false, scope: null, email: OWNER.email } })
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

  it('only an authenticated platform owner can read the live place review queue', async () => {
    const pageResult = { places: [{ id: TARGET_ID, name: '虚构地点', review_revision: REVIEW_REVISION }], page: 1, pageSize: 50, total: 1, hasMore: false }
    const { handler, service } = makeHandler({ listPendingPlaces: vi.fn(async () => pageResult) })
    const response = await handler(request({ body: { action: 'places_pending' } }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: pageResult })
    expect(service.listPendingPlaces).toHaveBeenCalledWith({ page: 1 })

    const nonOwner = makeHandler({ isOwner: vi.fn(async () => false) })
    const denied = await nonOwner.handler(request({ body: { action: 'places_pending' } }))
    expect(denied.status).toBe(403)
    expect(nonOwner.service.listPendingPlaces).not.toHaveBeenCalled()
  })

  it('validates review identifiers, decisions, and required rejection reasons before writing', async () => {
    const { handler, service } = makeHandler()
    const invalidId = await handler(request({ body: { action: 'place_review', payload: { placeId: 'bad', expectedRevision: REVIEW_REVISION, decision: 'approved' } } }))
    const invalidRevision = await handler(request({ body: { action: 'place_review', payload: { placeId: TARGET_ID, expectedRevision: 'not-a-revision', decision: 'approved' } } }))
    const invalidDecision = await handler(request({ body: { action: 'place_review', payload: { placeId: TARGET_ID, expectedRevision: REVIEW_REVISION, decision: 'published' } } }))
    const missingReason = await handler(request({ body: { action: 'place_review', payload: { placeId: TARGET_ID, expectedRevision: REVIEW_REVISION, decision: 'rejected', reason: ' ' } } }))
    expect(invalidId.status).toBe(400)
    expect(invalidRevision.status).toBe(400)
    expect(invalidDecision.status).toBe(400)
    expect(missingReason.status).toBe(400)
    expect(service.reviewCampusPlace).not.toHaveBeenCalled()
  })

  it('records the authenticated actor when forwarding the real review decision', async () => {
    const { handler, service } = makeHandler()
    const response = await handler(request({ body: { action: 'place_review', payload: { placeId: TARGET_ID, expectedRevision: REVIEW_REVISION, decision: 'rejected', reason: '请补充开放时间' } } }))
    expect(response.status).toBe(200)
    expect(service.reviewCampusPlace).toHaveBeenCalledWith({
      actorUserId: OWNER.id, placeId: TARGET_ID, decision: 'rejected', reason: '请补充开放时间', expectedRevision: REVIEW_REVISION,
    })
    expect(await response.json()).toEqual({ data: { status: 'rejected', auditIncomplete: false } })
  })
})
