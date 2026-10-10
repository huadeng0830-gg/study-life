import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as availability from '../supabase/functions/campus-social/availability.js'
import { normalizeTaskWorkCheckpoint } from '../src/composables/tasks/taskWorkProgress.js'

const actor = '00000001-0000-4000-8000-000000000001'
const peer = '00000002-0000-4000-8000-000000000002'
const meeting = '00000501-0000-4000-8000-000000000501'
const source = readFileSync(new URL('../supabase/functions/campus-social/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function startEdge({ meetings = [], participantError = null } = {}) {
  let handler
  const profile = (id) => ({ user_id: id, nickname: 'Fictional member', timezone: 'Asia/Shanghai', schedule_complete_through: '2026-12-31', semester_end: '2026-12-31', availability_preferences: { startTime: '09:00', endTime: '18:00', minimumMinutes: 30, classBufferMinutes: 0, includeWeekends: true } })
  const rows = {
    social_profiles: [profile(actor), profile(peer)],
    account_sync_snapshots: [actor, peer].map((id) => ({ user_id: id, revision: 1, payload: { values: { sl_courses: [], sl_events: [], sl_exams: [] } } })),
    social_friendships: [{ user_low: actor, user_high: peer }],
    social_invitation_participants: [], social_invitations: [],
    team_project_meeting_participants: meetings.map((item) => ({ user_id: actor, meeting_id: item.id, status: 'accepted' })),
    team_project_meetings: meetings,
  }
  const admin = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor, email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null })) },
    rpc: vi.fn(async () => ({ data: { allowed: true }, error: null })),
    from: vi.fn((table) => {
      if (!(table in rows)) throw new Error(`Unexpected database table: ${table}`)
      const filters = []
      let single = false
      let joined = false
      let limit = Infinity
      const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row)
      const query = {
        select(columns) { joined = columns.includes('slot:'); return query },
        eq(key, value) { filters.push((row) => field(row, key) === value); return query },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query },
        gte(key, value) { filters.push((row) => field(row, key) >= value); return query },
        lt(key, value) { filters.push((row) => field(row, key) < value); return query },
        limit(value) { limit = value; return query },
        maybeSingle() { single = true; return query },
        then(resolve, reject) {
          const selected = rows[table].map((row) => joined ? { ...row, slot: rows[table === 'team_project_meeting_participants' ? 'team_project_meetings' : 'social_invitations'].find((item) => item.id === (row.meeting_id || row.invitation_id)) } : row)
          const data = selected.filter((row) => filters.every((filter) => filter(row)))
          return Promise.resolve({ data: single ? (data[0] || null) : data.slice(0, limit), count: data.length, error: table === 'team_project_meeting_participants' ? participantError : null }).then(resolve, reject)
        },
      }
      return query
    }),
  }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://fictional.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key' })[name] }, serve: (callback) => { handler = callback } },
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient: () => admin }
      if (name === './availability.js') return availability
      if (name === '../../../src/composables/tasks/taskWorkProgress.js') return { normalizeTaskWorkCheckpoint }
      throw new Error(`Unexpected Edge dependency: ${name}`)
    },
    exports: {}, Date, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  }, { filename: 'campus-social/index.ts' })
  return { handler, admin }
}
function request(action, payload = {}) {
  return new Request('https://fictional.example.invalid/functions/v1/campus-social', { method: 'POST', headers: { Authorization: 'Bearer fictional-token', 'Content-Type': 'application/json', Origin: 'http://localhost:4173' }, body: JSON.stringify({ action, payload }) })
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

describe('real Edge handler enforces calendar and request boundaries', () => {
  const confirmed = { id: meeting, starts_at: '2026-10-12T01:00:00Z', ends_at: '2026-10-12T02:00:00Z', status: 'confirmed' }

  it('excludes confirmed project meetings from friend availability', async () => {
    const { handler } = startEdge({ meetings: [confirmed] })
    const response = await handler(request('availability_query', { friendId: peer, days: 7 }))
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.known).toBe(true)
    expect(data.intervals.some((slot) => Date.parse(slot.startsAt) < Date.parse(confirmed.ends_at) && Date.parse(slot.endsAt) > Date.parse(confirmed.starts_at))).toBe(false)
  })

  it('rejects a friend invitation that overlaps a confirmed project meeting before RPC mutation', async () => {
    const { handler, admin } = startEdge({ meetings: [confirmed] })
    const response = await handler(request('invitation_create', { guestId: peer, title: 'Fictional invitation', startsAt: confirmed.starts_at, endsAt: confirmed.ends_at }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'conflict' })
    expect(admin.rpc.mock.calls.some(([_name, args]) => args.p_action === 'create_invitation')).toBe(false)
  })

  it('fails closed if the project calendar query fails', async () => {
    const { handler } = startEdge({ participantError: { message: 'fictional database failure' } })
    const response = await handler(request('availability_query', { friendId: peer }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'service_unavailable' })
  })

  it('rejects a nonexistent project calendar date before invoking SQL', async () => {
    const { handler, admin } = startEdge()
    const response = await handler(request('project_create', { id: actor, name: 'Fictional project', type: 'blank', startsOn: '2026-02-31' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_input' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('filters old participant history before the response limit', async () => {
    const old = Array.from({ length: 1001 }, (_unused, index) => ({ ...confirmed, id: `fictional-old-${index}`, status: 'cancelled' }))
    const { handler } = startEdge({ meetings: [...old, confirmed] })
    const response = await handler(request('availability_query', { friendId: peer }))
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data.intervals.some((slot) => Date.parse(slot.startsAt) < Date.parse(confirmed.ends_at) && Date.parse(slot.endsAt) > Date.parse(confirmed.starts_at))).toBe(false)
  })

  it('returns unknown when the Data API truncates confirmed calendar rows', async () => {
    const { handler } = startEdge({ meetings: Array.from({ length: 1001 }, (_unused, index) => ({ ...confirmed, id: `fictional-current-${index}` })) })
    const response = await handler(request('availability_query', { friendId: peer }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'schedule_unknown' })
  })

  it('decodes a valid maximum-size body across a split UTF-8 character', async () => {
    const { handler, admin } = startEdge()
    const json = JSON.stringify({ action: 'profile_get', payload: { note: '虚构' } })
    const encoded = new TextEncoder().encode(json)
    const padded = new Uint8Array(32_768).fill(32)
    padded.set(encoded)
    const split = new TextEncoder().encode(json.slice(0, json.indexOf('虚'))).length + 1
    const body = new ReadableStream({ start(controller) { controller.enqueue(padded.slice(0, split)); controller.enqueue(padded.slice(split)); controller.close() } })
    const response = await handler(new Request('https://fictional.example.invalid/functions/v1/campus-social', { method: 'POST', headers: { Authorization: 'Bearer fictional-token' }, duplex: 'half', body }))
    expect(response.status).toBe(200)
    expect(admin.auth.getUser).toHaveBeenCalledWith('fictional-token')
  })

  it('cancels an oversized chunked request before consuming the whole stream or checking identity', async () => {
    const { handler, admin } = startEdge()
    let chunksRead = 0
    let cancelled = false
    const body = new ReadableStream({
      pull(controller) { chunksRead++; if (chunksRead <= 8) controller.enqueue(new Uint8Array(16_384).fill(32)); else controller.close() },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const response = await handler(new Request('https://fictional.example.invalid/functions/v1/campus-social', { method: 'POST', duplex: 'half', body }))
    expect(response.status).toBe(413)
    expect(chunksRead).toBeLessThanOrEqual(3)
    expect(cancelled).toBe(true)
    expect(admin.auth.getUser).not.toHaveBeenCalled()
  })
})
