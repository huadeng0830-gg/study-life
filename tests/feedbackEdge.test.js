import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as rules from '../supabase/functions/campus-community/rules.js'

const actor = '00000001-0000-4000-8000-000000000001'
const suggestion = '10000001-0000-4000-8000-000000000001'
const source = readFileSync(new URL('../supabase/functions/campus-community/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function edge({ owner = false, nickname = '虚构昵称', suggestions = [] } = {}) {
  let handler
  const inserted = []
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: actor, email: 'fictional@example.test', email_confirmed_at: '2026-10-01' } } }) },
    rpc: vi.fn(async () => ({ data: true, error: null })),
    from(table) {
      let columns = '*', single = false, offset = 0, limit = Infinity
      const filters = []
      let rows = table === 'social_profiles' ? [{ user_id: actor, nickname }]
        : table === 'platform_admins' ? (owner ? [{ user_id: actor, role: 'owner' }] : []) : suggestions
      const query = {
        select(value) { columns = value; return query },
        eq(key, value) { filters.push(row => row[key] === value); return query },
        or(expression) {
          const values = [...expression.matchAll(/(\w+)\.imatch\.("(?:\\.|[^"\\])*")/g)].map(([,key,value]) => [key, JSON.parse(value).slice(4)])
          filters.push(row => values.some(([key,value]) => String(row[key] || '').includes(value)))
          return query
        },
        order() { return query },
        range(start, end) { offset = start; limit = end - start + 1; return query },
        limit(value) { limit = value; return query },
        maybeSingle() { single = true; return query },
        single() { single = true; return query },
        insert(value) { inserted.push(value); rows = [{ id: suggestion, ...value }]; return query },
        then(resolve, reject) {
          const matches = rows.filter(row => filters.every(filter => filter(row)))
          const projected = matches.slice(offset, offset + limit).map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]])))
          return Promise.resolve({ data: single ? projected[0] || null : projected, count: matches.length, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://fictional.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional' })[name] }, serve: callback => { handler = callback } },
    require: name => name === './rules.js' ? rules : { createClient: () => admin },
    exports: {}, Request, Response, Headers, console,
  })
  const call = async (action, payload = {}, authenticated = true) => {
    const response = await handler(new Request('https://fictional.example.invalid', { method: 'POST', headers: authenticated ? { Authorization: 'Bearer fictional' } : {}, body: JSON.stringify({ action, payload }) }))
    return { status: response.status, body: await response.json() }
  }
  return { call, inserted, admin }
}

describe('independent feedback API', () => {
  const draft = { title: '虚构问题反馈', body: '这是用于验证提交行为的虚构反馈内容。', category: 'product' }
  it('defaults to anonymity and ignores client-supplied identity', async () => {
    const app = edge()
    expect((await app.call('submit', { ...draft, public_author_name: '伪造昵称', author_id: 'someone-else' })).status).toBe(200)
    expect(app.inserted[0]).toMatchObject({ author_id: actor, is_anonymous: true, public_author_name: '匿名用户', visibility: 'pending_safety' })
  })
  it('uses only the saved profile nickname when the user opts into attribution', async () => {
    const app = edge()
    expect((await app.call('submit', { ...draft, anonymous: false, public_author_name: '伪造昵称' })).status).toBe(200)
    expect(app.inserted[0]).toMatchObject({ is_anonymous: false, public_author_name: '虚构昵称' })
    expect((await edge({ nickname: '' }).call('submit', { ...draft, anonymous: false })).status).toBe(400)
    expect((await app.call('submit', { ...draft, anonymous: 'false' })).status).toBe(400)
  })
  it('allows public reads without login and excludes account identity and unpublished rows', async () => {
    const app = edge({ suggestions: [{ id: suggestion, visibility: 'public', status: 'planned', author_id: actor, public_author_name: '虚构昵称', public_history: [] }, { id: 'private', visibility: 'hidden' }] })
    const result = await app.call('public_list', { status: 'planned' }, false)
    expect(result.status).toBe(200)
    expect(result.body.data.total).toBe(1)
    expect(result.body.data.items[0]).toMatchObject({ public_author_name: '虚构昵称', public_history: [] })
    expect(result.body.data.items[0]).not.toHaveProperty('author_id')
  })
  it('filters all matching rows on the server and avoids sending detail bodies in summaries', async () => {
    const app = edge({ suggestions: [{ id: suggestion, author_id: actor, visibility: 'public', status: 'pending', category: 'product', title: 'a,b%example', body: 'full detail body' }, { id: 'hidden', author_id: actor, visibility: 'hidden', title: 'a,b%example', category: 'product' }] })
    const result = await app.call('public_list', { q: 'a,b%', category: 'product', view: 'summary', limit: 20 }, false)
    expect(result.body.data.total).toBe(1)
    expect(result.body.data.items[0]).not.toHaveProperty('body')
    const detail = await app.call('public_list', { id: suggestion, limit: 1 }, false)
    expect(detail.body.data.items[0].body).toBe('full detail body')
    const mine = await app.call('mine', { limit: 1, offset: 1 })
    expect(mine.body.data.total).toBe(2)
    expect(mine.body.data.items).toHaveLength(1)
  })
  it('restricts management to the owner, paginates filters and forwards conflict checks', async () => {
    expect((await edge().call('feedback_admin_list')).status).toBe(403)
    const app = edge({ owner: true, suggestions: Array.from({ length: 45 }, (_, index) => ({ id: String(index), status: 'pending', visibility: 'pending_safety' })) })
    const result = await app.call('feedback_admin_list', { offset: 40, limit: 40, visibility: 'pending_safety' })
    expect(result.body.data.total).toBe(45)
    expect(result.body.data.items).toHaveLength(5)
    const updatedAt = '2026-10-16T00:00:00Z'
    expect((await app.call('feedback_manage', { feedbackId: suggestion, status: 'needs_info', visibility: 'public', reply: '请补充操作步骤', expectedUpdatedAt: updatedAt })).status).toBe(200)
    expect(app.admin.rpc).toHaveBeenCalledWith('campus_manage_feedback', expect.objectContaining({ p_status: 'needs_info', p_expected_updated_at: updatedAt }))
  })
})
