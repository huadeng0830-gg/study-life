import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as communityRules from '../supabase/functions/campus-community/rules.js'
import * as lifeRules from '../supabase/functions/campus-life/rules.js'
import * as adminHandler from '../supabase/functions/platform-admin/handler.js'
import * as accountRestrictions from '../supabase/functions/_shared/accountRestrictions.js'
import * as adminRestrictions from '../supabase/functions/platform-admin/restrictions.js'
import * as socialAvailability from '../supabase/functions/campus-social/availability.js'

const actor = '00000001-0000-4000-8000-000000000001'
const id = n => `10000001-0000-4000-8000-${String(n).padStart(12, '0')}`
function edge(name, { tables = {}, owner = true, rpcError = null, delay = 0, access = { allowed: true } } = {}) {
  let handler, active = 0, peak = 0
  const projections = []
  const users = Array.from({ length: 500 }, (_, n) => ({ user_id: id(n), email: `fictional-${n}@example.invalid` }))
  const admin = {
    auth: {
      getUser: async () => ({ data: { user: { id: actor, email: 'fictional@example.invalid', email_confirmed_at: '2026-10-01' } } }),
      admin: { getUserById: vi.fn(async userId => ({ data: { user: { email: users.find(u => u.user_id === userId)?.email } } })) },
    },
    rpc: vi.fn(async name => name === 'platform_account_access' ? { data: access, error: null } : { data: users, error: rpcError }),
    from: vi.fn(table => {
      const filters = []
      let columns = '*', single = false, start = 0, limit = Infinity
      const rows = table === 'platform_admins' ? (owner ? [{ user_id: actor, role: 'owner' }] : [])
        : table === 'social_profiles' ? [{ user_id: actor, school: '虚构大学', campus: '东区' }] : tables[table] || []
      const query = {
        select(value) { columns = value; projections.push({ table, columns }); return query },
        eq(key, value) { filters.push(row => row[key] === value); return query },
        in(key, values) { filters.push(row => values.includes(row[key])); return query },
        order() { return query },
        limit(value) { limit = value; return query },
        range(a, b) { start = a; limit = b - a + 1; return query },
        maybeSingle() { single = true; return query },
        async then(resolve, reject) {
          active++; peak = Math.max(peak, active)
          try {
            if (delay) await new Promise(done => setTimeout(done, delay))
            const matches = rows.filter(row => filters.every(filter => filter(row)))
            const selected = matches.slice(start, start + limit).map(row => columns === '*' ? { ...row } : Object.fromEntries(columns.split(',').map(key => [key, row[key]])))
            return resolve({ data: single ? selected[0] || null : selected, count: matches.length, error: null })
          } catch (error) { return reject(error) } finally { active-- }
        },
      }
      return query
    }),
  }
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, {
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://fictional.example.invalid' : 'fictional-server-key' }, serve: callback => { handler = callback } },
    require: path => path === './rules.js' ? (name === 'campus-life' ? lifeRules : communityRules)
      : path === '../_shared/accountRestrictions.js' ? accountRestrictions
        : path === './restrictions.js' ? adminRestrictions : path === './availability.js' ? socialAvailability
          : path === './handler.js' ? adminHandler : path === './users.js' ? {} : { createClient: () => admin },
    exports: {}, Request, Response, Headers, TextDecoder, TextEncoder, console, crypto,
  })
  return {
    admin, projections, peak: () => peak,
    async call(action, payload = {}) {
      const response = await handler(new Request('https://fictional.example.invalid', { method: 'POST', headers: { Authorization: 'Bearer fictional' }, body: JSON.stringify({ action, payload }) }))
      return { status: response.status, body: await response.json() }
    },
    async raw(body) {
      return handler(new Request('https://fictional.example.invalid', { method: 'POST', body }))
    },
  }
}

describe('bounded backend query workloads', () => {
  it.each([['campus-community','mine'],['campus-life','mine_list'],['campus-social','friends_list']])('rejects a previously authenticated banned actor before %s business reads', async (name, action) => {
    const app = edge(name, { access: { allowed: false, code: 'account_suspended' } })
    const result = await app.call(action)
    expect(result.status).toBe(403)
    expect(result.body.code).toBe('account_suspended')
    expect(app.admin.from).not.toHaveBeenCalled()
    expect(app.admin.rpc).toHaveBeenCalledExactlyOnceWith('platform_account_access', { p_actor: actor, p_publish: false })
  })
  it('enforces the community request limit in bytes before decoding the full body', async () => {
    const app = edge('campus-community')
    const body = JSON.stringify({ action: 'public_list', payload: { ignored: '界'.repeat(12000) } })
    expect(body.length).toBeLessThan(32768)
    expect((await app.raw(body)).status).toBe(413)
    expect(app.admin.from).not.toHaveBeenCalled()
  })
  it('loads 200 application email labels in one batch after owner authorization', async () => {
    const app = edge('campus-community', { tables: { campus_reviewer_applications: Array.from({ length: 200 }, (_, n) => ({ id: id(n), user_id: id(n) })) } })
    const r = await app.call('reviewer_applications')
    expect(r.status).toBe(200)
    expect(r.body.data.applications).toHaveLength(200)
    expect(r.body.data.applications[199].email).toBe('fictional-199@example.invalid')
    expect(app.admin.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(app.admin.rpc).toHaveBeenCalledTimes(2)
    expect(app.admin.rpc.mock.calls.filter(call => call[0] === 'platform_admin_user_emails')).toHaveLength(1)
    expect(app.admin.rpc.mock.calls[1][1].p_user_ids).toHaveLength(200)
  })
  it('batches audit reviewers and deduplicates identities', async () => {
    const rows = Array.from({ length: 100 }, (_, n) => ({ id: id(n), reviewer_id: id(n % 10), sample_month: '2026-10-01', moderation_event_id: id(n) }))
    const app = edge('campus-community', { tables: { campus_review_audits: rows } })
    const r = await app.call('audit_list', { month: '2026-10' })
    expect(r.status).toBe(200)
    expect(r.body.data.items[99].reviewerEmail).toBe('fictional-9@example.invalid')
    expect(app.admin.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(app.admin.rpc.mock.calls[1][1].p_user_ids).toHaveLength(10)
  })
  it('loads a reviewer page without per-account Auth requests', async () => {
    const app = edge('platform-admin', { tables: { campus_reviewer_grants: Array.from({ length: 25 }, (_, n) => ({ user_id: id(n) })) } })
    const r = await app.call('reviewers_list', { page: 1 })
    expect(r.status).toBe(200)
    expect(r.body.data.reviewers[24].email).toBe('fictional-24@example.invalid')
    expect(app.admin.auth.admin.getUserById).not.toHaveBeenCalled()
    expect(app.admin.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not look up any emails for a non-owner or an empty page', async () => {
    const denied = edge('campus-community', { owner: false })
    expect((await denied.call('reviewer_applications')).status).toBe(403)
    expect(denied.admin.rpc).toHaveBeenCalledExactlyOnceWith('platform_account_access', { p_actor: actor, p_publish: false })
    const empty = edge('campus-community')
    expect((await empty.call('reviewer_applications')).status).toBe(200)
    expect(empty.admin.rpc).toHaveBeenCalledExactlyOnceWith('platform_account_access', { p_actor: actor, p_publish: false })
  })
  it('keeps RPC failures visible without falling back to N+1', async () => {
    const app = edge('campus-community', { tables: { campus_reviewer_applications: [{ user_id: id(0) }] }, rpcError: { code: 'unavailable' } })
    expect((await app.call('reviewer_applications')).status).toBe(503)
    expect(app.admin.auth.admin.getUserById).not.toHaveBeenCalled()
  })
  it('projects submission summaries but preserves full editing fields on detail reads', async () => {
    const app = edge('campus-life', { tables: { campus_market_listings: [{ id: id(0), owner_id: actor, title: '虚构教材', description: '保留完整编辑内容', status: 'rejected', revision: 3 }] } })
    const summary = await app.call('mine_list', { domains: ['listings'], view: 'summary' })
    expect(summary.status).toBe(200)
    expect(summary.body.data.listings[0]).toMatchObject({ title: '虚构教材', revision: 3 })
    expect(summary.body.data.listings[0]).not.toHaveProperty('description')
    const full = await app.call('mine_list', { domains: ['listings'] })
    expect(full.body.data.listings[0].description).toBe('保留完整编辑内容')
    expect(app.projections.every(p => p.columns !== '*')).toBe(true)
  })
  it('limits submission fan-out to three requests without omitting domains', async () => {
    const app = edge('campus-life', { delay: 2 })
    const r = await app.call('mine_list', { view: 'summary' })
    expect(r.status).toBe(200)
    expect(Object.keys(r.body.data)).toHaveLength(13)
    expect(app.peak()).toBeLessThanOrEqual(3)
  })
})
