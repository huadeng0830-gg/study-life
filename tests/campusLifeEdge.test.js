import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as rules from '../supabase/functions/campus-life/rules.js'

const actor = '00000001-0000-4000-8000-000000000001'
const rowsByDefault = {
  social_profiles: [{ user_id: actor, school: '虚构大学', campus: '东区' }],
  campus_market_listings: [
    { id: '10000001-0000-4000-8000-000000000001', school: '虚构大学', campus: '东区', title: '二手教材', status: 'active', owner_id: '20000001-0000-4000-8000-000000000001' },
    { id: '10000002-0000-4000-8000-000000000002', school: '虚构大学', campus: '西区', title: '西区教材', status: 'active', owner_id: '20000002-0000-4000-8000-000000000002' },
    { id: '10000003-0000-4000-8000-000000000003', school: '另一所大学', campus: '东区', title: '跨校教材', status: 'active', owner_id: '20000003-0000-4000-8000-000000000003' },
  ],
  campus_help_tasks: [],
  campus_market_interests: [],
  campus_help_applications: [],
  campus_lost_found_items: [],
  campus_lost_found_claims: [],
  campus_events: [],
  campus_private_messages: [],
  platform_admins: [],
  social_notifications: [],
}
const source = readFileSync(new URL('../supabase/functions/campus-life/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const migration = readFileSync(new URL('../supabase/migrations/20261014134335_campus_life_domains.sql', import.meta.url), 'utf8')

function createEdge({ user = { id: actor, email_confirmed_at: '2026-10-01T00:00:00Z' }, tables = {}, notificationError = false, rpcResults = {} } = {}) {
  let handler
  const appliedFilters = []
  const rows = Object.fromEntries(Object.entries({ ...rowsByDefault, ...tables }).map(([name, values]) => [name, values.map((item) => ({ ...item }))]))
  const admin = {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async (name) => {
      if (name in rpcResults) return { data: rpcResults[name], error: null }
      if (name === 'campus_life_register_event') {
        return { data: { eventId: '60000001-0000-4000-8000-000000000001', status: 'registered', existing: false, registeredAt: '2026-10-14T00:00:00.000Z' }, error: null }
      }
      return { data: true, error: null }
    }),
    from: vi.fn((table) => {
      if (!(table in rows)) throw new Error(`Unexpected table: ${table}`)
      const filters = []
      let selected = '*'
      let operation = 'select'
      let input = null
      let single = false
      let rowLimit = Infinity
      const orders = []
      const query = {
        select(columns = '*') { selected = columns; return query },
        eq(key, value) { appliedFilters.push({ table, op: 'eq', key, value }); filters.push((row) => row[key] === value); return query },
        in(key, values) { appliedFilters.push({ table, op: 'in', key, values: [...values] }); filters.push((row) => values.includes(row[key])); return query },
        is(key, value) { appliedFilters.push({ table, op: 'is', key, value }); filters.push((row) => row[key] === value); return query },
        gte(key, value) { filters.push((row) => row[key] >= value); return query },
        or(expression) {
          const pairs = [...expression.matchAll(/and\(sender_id\.eq\.([^,]+),recipient_id\.eq\.([^\)]+)\)/g)]
          filters.push((row) => pairs.some((pair) => row.sender_id === pair[1] && row.recipient_id === pair[2]))
          return query
        },
        order(key, { ascending = true } = {}) { orders.push({ key, ascending }); return query },
        limit(value) { rowLimit = value; return query },
        maybeSingle() { single = true; return query },
        single() { single = true; return query },
        insert(value) { operation = 'insert'; input = value; return query },
        upsert(value) { operation = 'upsert'; input = value; return query },
        update(value) { operation = 'update'; input = value; return query },
        then(resolve, reject) {
          if (table === 'campus_course_reviews' && selected.split(',').includes('campus')) {
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column campus does not exist' } }).then(resolve, reject)
          }
          let result
          if (operation === 'insert' || operation === 'upsert') {
            const values = Array.isArray(input) ? input : [input]
            const inserted = values.map((row, index) => ({ id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, created_at: '2026-10-14T00:00:00.000Z', ...row }))
            if (!notificationError || table !== 'social_notifications') {
              const fresh = operation === 'upsert' && input?.dedupe_key
                ? inserted.filter((row) => !rows[table].some((existing) => existing.dedupe_key === row.dedupe_key))
                : inserted
              rows[table].push(...fresh)
            }
            const projected = selected === '*' ? inserted : inserted.map((row) => Object.fromEntries(selected.split(',').map((key) => [key, row[key]])))
            result = single ? projected[0] : projected
          } else {
            const found = rows[table].filter((row) => filters.every((matches) => matches(row))).sort((a, b) => {
              for (const { key, ascending } of orders) {
                const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
                if (compared) return ascending ? compared : -compared
              }
              return 0
            }).slice(0, rowLimit)
            if (operation === 'update') found.forEach((row) => Object.assign(row, input))
            const projected = selected === '*' ? found : found.map((row) => Object.fromEntries(selected.split(',').map((key) => [key, row[key]])))
            result = single ? (projected[0] || null) : projected
          }
          const error = notificationError && table === 'social_notifications' ? { code: 'XX000', message: 'notification unavailable' } : null
          return Promise.resolve({ data: result, error }).then(resolve, reject)
        },
      }
      return query
    }),
  }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://fictional.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key' })[name] }, serve: (callback) => { handler = callback } },
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient: () => admin }
      if (name === './rules.js') return rules
      throw new Error(`Unexpected Edge dependency: ${name}`)
    },
    exports: {}, Date, URL, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  }, { filename: 'campus-life/index.ts' })
  return { handler, admin, rows, appliedFilters }
}

async function call(handler, action, payload = {}) {
  return handler(new Request('https://fictional.example.invalid/functions/v1/campus-life', {
    method: 'POST', headers: { Authorization: 'Bearer fictional-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  }))
}

describe('campus-life Edge Function', () => {
  it('filters public records using the authenticated profile school and campus and omits owner ids', async () => {
    const { handler } = createEdge()
    const response = await call(handler, 'market_list', { school: '另一所大学', campus: '西区' })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.data.listings).toHaveLength(1)
    expect(result.data.listings[0].title).toBe('二手教材')
    expect(result.data.listings[0]).not.toHaveProperty('owner_id')
  })

  it('derives school and campus from the saved profile instead of request payload', async () => {
    const { handler, rows } = createEdge()
    const response = await call(handler, 'help_submit', {
      school: '另一所大学', campus: '伪造校区', title: '帮忙搬书', description: '图书馆一层取书',
      taskType: 'errand', pickupArea: '图书馆', deliveryArea: '东区服务中心',
    })
    const result = await response.json()

    expect(response.status).toBe(200)
    expect(result.data.item).toBeTruthy()
    expect(rows.campus_help_tasks).toHaveLength(1)
    expect(rows.campus_help_tasks[0]).toMatchObject({ owner_id: actor, school: '虚构大学', campus: '东区' })
  })

  it('rejects personal contact details before storing a public post', async () => {
    const { handler, rows } = createEdge()
    const response = await call(handler, 'help_submit', {
      title: '代取快递', description: '请拨打 13800138000 联系我', taskType: 'parcel',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'private_contact_not_allowed' })
    expect(rows.campus_help_tasks).toHaveLength(0)
  })

  it('requires a confirmed email account before reading campus records', async () => {
    const { handler, admin } = createEdge({ user: { id: actor } })
    const response = await call(handler, 'market_list')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'email_verification_required' })
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('keeps each private chat between the owner and its exact active counterpart', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const applicant = '30000001-0000-4000-8000-000000000001'
    const otherApplicant = '40000001-0000-4000-8000-000000000001'
    const listingId = '10000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({
      user: { id: applicant, email_confirmed_at: '2026-10-01T00:00:00Z' },
      tables: {
        social_profiles: [{ user_id: applicant, school: '虚构大学', campus: '东区' }],
        campus_market_interests: [
          { id: '50000001-0000-4000-8000-000000000001', listing_id: listingId, buyer_id: applicant, status: 'pending' },
          { id: '50000002-0000-4000-8000-000000000002', listing_id: listingId, buyer_id: otherApplicant, status: 'pending' },
        ],
      },
    })

    const denied = await call(handler, 'message_send', {
      targetType: 'market_listing', targetId: listingId, recipientId: otherApplicant, body: '你好，想咨询一下。',
    })
    expect(denied.status).toBe(403)
    expect(rows.campus_private_messages).toHaveLength(0)

    const allowed = await call(handler, 'message_send', {
      targetType: 'market_listing', targetId: listingId, recipientId: owner, body: '你好，想咨询一下。',
    })
    expect(allowed.status).toBe(200)
    expect(rows.campus_private_messages[0]).toMatchObject({ sender_id: applicant, recipient_id: owner })
  })

  it('returns the latest 100 private messages in chronological order', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const listingId = '10000001-0000-4000-8000-000000000001'
    const messages = Array.from({ length: 105 }, (_, index) => ({
      id: String(index).padStart(4, '0'), school: '虚构大学', target_type: 'market_listing', target_id: listingId,
      sender_id: actor, recipient_id: owner, body: `消息 ${index}`, created_at: new Date(Date.UTC(2026, 9, 14, 0, index)).toISOString(),
    }))
    const { handler } = createEdge({ tables: {
      campus_market_interests: [{ listing_id: listingId, buyer_id: actor, status: 'pending' }],
      campus_private_messages: [...messages, { ...messages[104], id: '9999', recipient_id: '40000001-0000-4000-8000-000000000001', body: '另一段对话' }],
    } })
    const response = await call(handler, 'message_list', { targetType: 'market_listing', targetId: listingId, recipientId: owner })
    const result = await response.json()
    expect(response.status).toBe(200)
    expect(result.data.messages.map((message) => message.body)).toEqual(messages.slice(5).map((message) => message.body))
  })

  it('allows a pending help applicant to contact the owner before accepting the task', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const taskId = '60000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({ tables: {
      campus_help_tasks: [{ id: taskId, owner_id: owner, school: '虚构大学', campus: '东区', status: 'open' }],
      campus_help_applications: [{ task_id: taskId, applicant_id: actor, status: 'pending' }],
    } })
    const response = await call(handler, 'message_send', { targetType: 'help_task', targetId: taskId, recipientId: owner, body: '请确认一下交接时间。' })
    expect(response.status).toBe(200)
    expect(rows.campus_private_messages).toHaveLength(1)
  })

  it.each(['东区', '西区'])('resolves the course review campus through its assignment (%s)', async (campus) => {
    const reviewId = '60000001-0000-4000-8000-000000000001'
    const assignmentId = '70000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({ tables: {
      campus_course_reviews: [{ id: reviewId, assignment_id: assignmentId, school: '虚构大学', review_status: 'approved' }],
      campus_teaching_assignments: [{ id: assignmentId, school: '虚构大学', campus, review_status: 'approved' }],
      campus_content_reports: [],
    } })
    const response = await call(handler, 'content_report', { targetType: 'course_review', targetId: reviewId, reason: 'inaccurate' })
    expect(response.status).toBe(campus === '东区' ? 200 : 404)
    expect(rows.campus_content_reports).toHaveLength(campus === '东区' ? 1 : 0)
  })

  it('applies campus scope before the event row limit', async () => {
    const foreignEvents = Array.from({ length: 100 }, (_, index) => ({ id: `west-${index}`, school: '虚构大学', campus: '西区', review_status: 'approved', status: 'published', starts_at: '2099-01-01T00:00:00Z', ends_at: '2099-01-02T00:00:00Z' }))
    const { handler } = createEdge({ tables: { campus_events: [...foreignEvents, { ...foreignEvents[0], id: 'east', campus: '东区', starts_at: '2099-02-01T00:00:00Z' }] } })
    const response = await call(handler, 'events_list')
    expect(response.status).toBe(200)
    expect((await response.json()).data.events.map((event) => event.id)).toEqual(['east'])
  })

  it('allows an owner to resubmit rejected content through the revision-checked RPC', async () => {
    const { handler, admin } = createEdge()
    const response = await call(handler, 'content_resubmit', {
      targetType: 'course', targetId: '70000001-0000-4000-8000-000000000001', revision: 3,
      content: { name: '线性代数', department: '数学系', description: '授课范围与教材', sourceUrl: 'https://example.edu/course' },
    })
    const request = admin.rpc.mock.calls.find(([name]) => name === 'campus_life_resubmit_content')

    expect(response.status).toBe(200)
    expect(request?.[1]).toMatchObject({
      p_actor_id: actor, p_target_type: 'course', p_target_id: '70000001-0000-4000-8000-000000000001', p_expected_revision: 3,
      p_payload: { name: '线性代数', department: '数学系', description: '授课范围与教材', source_url: 'https://example.edu/course' },
    })
  })

  it('does not turn a committed event registration into a failed request when notification storage is unavailable', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const eventId = '60000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({
      notificationError: true,
      tables: { campus_events: [{ id: eventId, owner_id: owner, school: '虚构大学', campus: '东区' }] },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await call(handler, 'event_register', { eventId })
    warn.mockRestore()

    expect(response.status).toBe(200)
    expect((await response.json()).data.registration.status).toBe('registered')
    expect(rows.social_notifications).toHaveLength(0)
  })

  it('deduplicates retried event notifications using the registration timestamp', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const eventId = '60000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({
      tables: { campus_events: [{ id: eventId, owner_id: owner, school: '虚构大学', campus: '东区' }] },
    })
    await call(handler, 'event_register', { eventId })
    await call(handler, 'event_register', { eventId })

    expect(rows.social_notifications).toHaveLength(1)
    expect(rows.social_notifications[0].dedupe_key).toContain(`campus-event-registration:${eventId}:${actor}:`)
  })

  it('asks for a school instead of reporting a malformed field when the profile has none', async () => {
    const { handler, admin } = createEdge({ tables: { social_profiles: [{ user_id: actor, school: '', campus: '' }] } })
    const response = await call(handler, 'market_list')

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'profile_required' })
    expect(admin.from).not.toHaveBeenCalledWith('campus_market_listings')
  })

  it('filters campus scope in the query so the row limit applies to visible rows', async () => {
    const { handler, appliedFilters } = createEdge()
    await call(handler, 'market_list')

    // Every campus table stores campus as `not null default ''`, so '' plus the reader's own
    // campus is exactly what campusScopeMatches accepts — and it must reach the database,
    // otherwise the 100-row limit is spent on other campuses' rows before filtering.
    for (const table of ['campus_market_listings']) {
      const applied = appliedFilters.filter((entry) => entry.table === table && entry.op === 'in' && entry.key === 'campus')
      expect(applied.length).toBeGreaterThan(0)
      expect(applied[0].values).toEqual(expect.arrayContaining(['东区', '']))
    }
    expect(appliedFilters.some((entry) => entry.table === 'campus_market_listings' && entry.op === 'eq' && entry.key === 'school' && entry.value === '虚构大学')).toBe(true)
  })

  it('omits the campus filter when the reader has not chosen a campus', async () => {
    const { handler, appliedFilters } = createEdge({
      tables: { social_profiles: [{ user_id: actor, school: '虚构大学', campus: '' }] },
    })
    const response = await call(handler, 'market_list')

    expect(response.status).toBe(200)
    expect(appliedFilters.some((entry) => entry.op === 'in' && entry.key === 'campus')).toBe(false)
  })

  it('reports a failed moderation notification instead of claiming it was sent', async () => {
    const owner = '20000001-0000-4000-8000-000000000001'
    const { handler, rows } = createEdge({
      notificationError: true,
      tables: { platform_admins: [{ user_id: actor, role: 'owner' }] },
      rpcResults: { campus_life_moderate_content: { id: '10000001-0000-4000-8000-000000000001', status: 'approved', ownerId: owner } },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await call(handler, 'moderation_decide', {
      targetType: 'market_listing', targetId: '10000001-0000-4000-8000-000000000001', decision: 'approve', revision: 1,
    })
    warn.mockRestore()

    expect(response.status).toBe(200)
    expect((await response.json()).data.notificationSent).toBe(false)
    expect(rows.social_notifications).toHaveLength(0)
  })

  it('keeps legacy place rate limits, prevents direct client table access and uses transactional domain RPCs', () => {
    expect(migration).toContain("'campus_place_publish', 'campus_place_rating', 'campus_place_report', 'campus_place_invite'")
    expect(migration).toContain("'campus_publish', 'campus_contact', 'campus_review', 'campus_report', 'campus_favorite'")
    expect(migration).toContain('from public, anon, authenticated;')
    expect(migration).toContain('grant all on public.campus_courses')
    expect(migration).toContain('to service_role;')
    expect(migration).toContain('create or replace function public.campus_life_reserve_listing')
    expect(migration).toContain('create or replace function public.campus_life_accept_help_application')
    expect(migration).toContain('create or replace function public.campus_life_create_market_interest')
    expect(migration).toContain('create or replace function public.campus_life_create_help_application')
    expect(migration).toContain('create or replace function public.campus_life_create_lost_found_claim')
    expect(migration).toContain('create or replace function public.campus_life_submit_course_review')
    expect(migration).toContain('create or replace function public.campus_life_moderate_content')
    expect(migration).toContain('create or replace function public.campus_life_moderation_queue')
    expect(migration).toContain('create or replace function public.campus_life_resubmit_content')
    expect(migration).toContain("status = 'rejected' and revision = p_expected_revision")
    expect(migration).toContain('social_notifications_dedupe_key')
    expect(source).toContain("case 'content_resubmit': return resubmitContent(user, payload, scope)")
    expect(source).toContain("admin.from(table).select('*').eq('owner_id', userId)")
    expect(source).toContain("admin.rpc('campus_life_create_market_interest'")
    expect(source).toContain("admin.rpc('campus_life_create_help_application'")
    expect(source).toContain("admin.rpc('campus_life_create_lost_found_claim'")
    expect(source).toContain("admin.rpc('campus_life_moderate_content'")
    expect(migration).toContain('create or replace function public.campus_life_register_event')
    expect(migration).toContain('create or replace function public.campus_life_resolve_help_dispute')
    expect(migration).not.toMatch(/\b(drop table|truncate)\b/i)
  })
})
