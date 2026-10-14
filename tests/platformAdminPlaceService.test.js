import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const actor = '71bbaaa0-1ef1-4ad4-9b77-90b792846c10'
const placeId = '1f80fded-15f4-4b07-a262-3be8b47463d9'
const revision = 'b78c01f2-265d-4776-b345-cf3127eb1a33'
const changedRevision = 'c2dc8ec6-b376-4d6d-9f91-5f6c4cadbe52'
const nodeRequire = createRequire(import.meta.url)
const source = readFileSync(new URL('../supabase/functions/platform-admin/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function platformAdmin({ places = [], onInsert, rpcError = null } = {}) {
  let handler
  const rows = {
    platform_admins: [{ user_id: actor, role: 'owner' }],
    campus_places: places,
    campus_place_review_events: [],
    social_notifications: [],
  }
  let nextEventId = 0
  const admin = {
    rpc: vi.fn(async () => ({ data: rpcError ? null : { id: placeId, status: 'approved', ownerId: actor }, error: rpcError })),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor, email: 'owner@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null })) },
    from(table) {
      const filters = []
      let operation = 'select'
      let input = null
      let single = false
      let range = null
      const query = {
        select(_columns, _options) { return query },
        eq(key, value) { filters.push((row) => row[key] === value); return query },
        is(key, value) { filters.push((row) => row[key] === value); return query },
        order() { return query },
        range(start, end) { range = [start, end]; return query },
        maybeSingle() { single = true; return query },
        single() { single = true; return query },
        insert(value) { operation = 'insert'; input = value; return query },
        update(value) { operation = 'update'; input = value; return query },
        then(resolve, reject) {
          let data
          let count
          if (operation === 'select') {
            const matches = rows[table].filter((row) => filters.every((filter) => filter(row)))
            count = matches.length
            const selected = range ? matches.slice(range[0], range[1] + 1) : matches
            data = single ? (selected[0] || null) : selected
          } else if (operation === 'insert') {
            const values = Array.isArray(input) ? input : [input]
            const inserted = values.map((value) => ({ ...value, id: value.id || `review-event-${++nextEventId}` }))
            rows[table].push(...inserted)
            onInsert?.(table, inserted, rows)
            data = single ? inserted[0] : inserted
          } else {
            const changed = rows[table].filter((row) => filters.every((filter) => filter(row)))
            for (const row of changed) Object.assign(row, input)
            data = single ? (changed[0] || null) : changed
          }
          return Promise.resolve({ data, count, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  vm.runInNewContext(compiled, {
    Deno: {
      env: { get: (name) => ({ SUPABASE_URL: 'https://fictional.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key' })[name] },
      serve: (callback) => { handler = callback },
    },
    require: (name) => {
      if (name === '@supabase/supabase-js') return { createClient: () => admin }
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient: () => admin }
      if (name === './handler.js') return nodeRequire('../supabase/functions/platform-admin/handler.js')
      if (name === './users.js') return { countAuthUsers: vi.fn(), searchAuthUsers: vi.fn() }
      throw new Error(`Unexpected platform-admin dependency: ${name}`)
    },
    exports: {}, Date, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  }, { filename: 'platform-admin/index.ts' })
  return { handler, rows, admin }
}

async function call(handler, action, payload = {}) {
  return handler(new Request('https://fictional.example.invalid/functions/v1/platform-admin', {
    method: 'POST', headers: { Authorization: 'Bearer fictional-token', Origin: 'https://study-life.pages.dev', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  }))
}

describe('platform-admin campus place service', () => {
  it('returns a counted, bounded page instead of silently truncating the review queue', async () => {
    const places = Array.from({ length: 51 }, (_, index) => ({
      id: `place-${index + 1}`, review_status: 'pending', visibility: 'school', archived_at: null,
      review_revision: revision, school: '虚构大学', name: `地点 ${index + 1}`,
    }))
    const { handler } = platformAdmin({ places })
    const response = await call(handler, 'places_pending', { page: 2 })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ page: 2, pageSize: 50, total: 51, hasMore: false })
    expect(body.data.places).toHaveLength(1)
    expect(body.data.places[0].id).toBe('place-51')
  })

  it('maps a database revision conflict without sending a success notification', async () => {
    const { handler, rows } = platformAdmin({ places: [{
      id: placeId, review_status: 'pending', visibility: 'school', archived_at: null,
      review_revision: changedRevision,
    }], rpcError: { message: 'CAMPUS_REVISION_CHANGED' } })
    const response = await call(handler, 'place_review', { placeId, expectedRevision: revision, decision: 'approved' })
    expect(response.status).toBe(409)
    expect(rows.campus_places[0].review_status).toBe('pending')
    expect(rows.campus_place_review_events).toEqual([])
  })

  it('does not notify when the atomic review operation fails', async () => {
    const { handler, rows } = platformAdmin({
      places: [{
        id: placeId, owner_id: actor, review_status: 'pending', visibility: 'school', archived_at: null,
        review_revision: revision,
      }],
      rpcError: { message: 'database unavailable' },
    })
    const response = await call(handler, 'place_review', { placeId, expectedRevision: revision, decision: 'approved' })
    expect(response.status).toBe(502)
    expect(rows.campus_places[0].review_status).toBe('pending')
    expect(rows.campus_place_review_events).toEqual([])
    expect(rows.social_notifications).toEqual([])
  })

  it('audits and conditionally approves the exact revision shown to the reviewer', async () => {
    const { handler, rows, admin } = platformAdmin({ places: [{
      id: placeId, owner_id: actor, review_status: 'pending', visibility: 'school', archived_at: null,
      review_revision: revision,
    }] })
    const response = await call(handler, 'place_review', { placeId, expectedRevision: revision, decision: 'approved' })
    expect(response.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('campus_review_place', expect.objectContaining({ p_actor: actor, p_id: placeId, p_revision: revision, p_decision: 'approve' }))
    expect(rows.social_notifications[0]).toMatchObject({
      recipient_id: actor, actor_id: actor, kind: 'campus_place_reviewed', resource_id: placeId,
    })
  })
})
