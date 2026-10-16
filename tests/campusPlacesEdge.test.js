import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { normalizePlaceRecord, PLACE_CATEGORIES, PLACE_TYPES } from '../src/composables/placeModels.js'
import { accountRestrictionGuard, withUnrestrictedAccount } from './helpers/edgeAccountAccess.js'

const actor = '00000001-0000-4000-8000-000000000001'
const other = '00000002-0000-4000-8000-000000000002'
const placeId = '00000101-0000-4000-8000-000000000101'
const source = readFileSync(new URL('../supabase/functions/campus-social/index.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function edge({ tables = {} } = {}) {
  let handler
  const rows = {
    social_profiles: [
      { user_id: actor, nickname: '虚构同学', school: '虚构大学' },
      { user_id: other, nickname: '虚构好友', school: '虚构大学' },
    ],
    social_friendships: [], social_notifications: [], campus_place_invites: [],
    campus_places: [], campus_place_ratings: [], campus_place_reports: [], campus_content_reports: [],
    ...tables,
  }
  const primaryKeys = {
    campus_places: ['id'], campus_place_ratings: ['place_id', 'user_id'], campus_place_reports: ['id'],
    campus_place_invites: ['id'], social_friendships: ['user_low', 'user_high'],
  }
  const admin = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor, email: 'student@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null })) },
    rpc: vi.fn(async (name) => name === 'campus_place_rate_limit' ? { data: true, error: null } : { data: { allowed: true }, error: null }),
    from: vi.fn((table) => {
      if (!(table in rows)) throw new Error(`Unexpected table: ${table}`)
      const filters = []
      let single = false
      let operation = 'select'
      let input = null
      const field = (row, key) => key.split('.').reduce((value, part) => value?.[part], row)
      const query = {
        select() { return query },
        eq(key, value) { filters.push((row) => field(row, key) === value); return query },
        neq(key, value) { filters.push((row) => field(row, key) !== value); return query },
        is(key, value) { filters.push((row) => field(row, key) === value); return query },
        in(key, values) { filters.push((row) => values.includes(field(row, key))); return query },
        or(expression) {
          const matches = expression.split(',').map((part) => {
            const found = part.match(/^([a-z_]+)\.eq\.(.+)$/)
            return found ? (row) => field(row, found[1]) === found[2] : () => false
          })
          filters.push((row) => matches.some((match) => match(row)))
          return query
        },
        order() { return query },
        limit() { return query },
        maybeSingle() { single = true; return query },
        update(value) { operation = 'update'; input = value; return query },
        upsert(value) { operation = 'upsert'; input = value; return query },
        insert(value) { operation = 'insert'; input = value; return query },
        delete() { operation = 'delete'; return query },
        then(resolve, reject) {
          let data = null
          let error = null
          if (operation === 'select') {
            const selected = rows[table].filter((row) => filters.every((filter) => filter(row)))
            data = single ? (selected[0] || null) : selected
          } else if (operation === 'upsert') {
            const keys = primaryKeys[table] || ['id']
            const values = Array.isArray(input) ? input : [input]
            data = values.map((value) => {
              const index = rows[table].findIndex((row) => keys.every((key) => row[key] === value[key]))
              if (index < 0) { rows[table].push({ ...value }); return value }
              rows[table][index] = { ...rows[table][index], ...value }
              return rows[table][index]
            })
          } else if (operation === 'insert') {
            const values = Array.isArray(input) ? input : [input]
            for (const value of values) {
              if (rows[table].some((row) => (primaryKeys[table] || ['id']).every((key) => row[key] === value[key]))) {
                error = { code: '23505', message: 'duplicate' }
                break
              }
              rows[table].push({ ...value })
            }
            data = error ? null : values
          } else if (operation === 'update') {
            data = rows[table].filter((row) => filters.every((filter) => filter(row))).map((row) => {
              Object.assign(row, input)
              return row
            })
          } else {
            const selected = rows[table].filter((row) => filters.every((filter) => filter(row)))
            rows[table] = rows[table].filter((row) => !selected.includes(row))
            data = selected
          }
          return Promise.resolve({ data, error }).then(resolve, reject)
        },
      }
      return query
    }),
  }
  vm.runInNewContext(compiled, {
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://fictional.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-key' })[name] }, serve: (callback) => { handler = callback } },
    require: (name) => {
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient: () => withUnrestrictedAccount(admin) }
      if (name === '../_shared/accountRestrictions.js') return accountRestrictionGuard
      if (name === './availability.js') return {}
      if (name === '../../../src/composables/tasks/taskWorkProgress.js') return { normalizeTaskWorkCheckpoint: (value) => value }
      if (name === '../../../src/composables/placeModels.js') return { PLACE_CATEGORIES, PLACE_TYPES, normalizePlaceRecord }
      throw new Error(`Unexpected Edge dependency: ${name}`)
    },
    exports: {}, Date, Request, Response, Headers, TextEncoder, TextDecoder, console, crypto,
  }, { filename: 'campus-social/index.ts' })
  return { handler, admin, rows }
}

async function call(handler, action, payload = {}) {
  return handler(new Request('https://fictional.example.invalid/functions/v1/campus-social', {
    method: 'POST', headers: { Authorization: 'Bearer fictional-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  }))
}

const sharedPlace = (overrides = {}) => ({
  id: placeId, name: '虚构面馆', campus: '北校区', area: '北苑', placeHint: '食堂二楼',
  category: 'food', ratingTemplateId: 'food', scores: { value: 'worth', portion: 'large' },
  note: '虚构备注', visibility: 'school', ...overrides,
})

describe('校内地点 Edge 安全边界', () => {
  it('允许隔离体验分支读取校园用户资料', async () => {
    const { handler } = edge()
    const origin = 'https://codex-preview-1-4-0.study-life.pages.dev'
    const response = await handler(new Request('https://fictional.example.invalid/functions/v1/campus-social', {
      method: 'OPTIONS', headers: { Origin: origin },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
  })

  it('拒绝 private 地点发布，且不写入服务端表', async () => {
    const { handler, rows } = edge()
    const response = await call(handler, 'campus_place_publish', { place: sharedPlace({ visibility: 'private' }) })
    expect(response.status).toBe(400)
    expect(rows.campus_places).toEqual([])
    expect(rows.campus_place_ratings).toEqual([])
  })

  it('发布校内地点时保存细分类与公开资料，不把私人备注写进地点或评分', async () => {
    const { handler, rows } = edge()
    const response = await call(handler, 'campus_place_publish', {
      place: sharedPlace({
        type: 'cafeteria', description: '虚构公共简介', openingHours: '每日 7:00–21:00',
        serviceInfo: '提供早午餐', publicContact: '虚构公开业务邮箱', sourceInfo: '虚构学校官网',
        note: '仅本机私人提醒', scores: { value: 'worth', rating: 4 },
      }),
    })
    expect(response.status).toBe(200)
    expect(rows.campus_places[0]).toMatchObject({
      place_type: 'cafeteria', category: 'food', description: '虚构公共简介',
      opening_hours: '每日 7:00–21:00', service_info: '提供早午餐',
      public_contact: '虚构公开业务邮箱', source_info: '虚构学校官网',
      review_status: 'pending', review_reason: '',
    })
    expect(rows.campus_places[0].review_revision).toMatch(/^[0-9a-f-]{36}$/i)
    expect(rows.campus_places[0]).not.toHaveProperty('note')
    expect(rows.campus_place_ratings).toEqual([])
    expect(JSON.stringify(rows)).not.toContain('仅本机私人提醒')
  })

  it('公开业务联系方式缺少来源说明时拒绝投稿', async () => {
    const { handler, rows } = edge()
    const response = await call(handler, 'campus_place_publish', {
      place: sharedPlace({ publicContact: '虚构业务电话', sourceInfo: '' }),
    })
    expect(response.status).toBe(400)
    expect(rows.campus_places).toEqual([])
  })

  it('未到访也可以提交地点资料，但只进入待审核且不生成评分', async () => {
    const { handler, rows } = edge()
    const response = await call(handler, 'campus_place_publish', {
      place: sharedPlace({ type: 'cafeteria', scores: { value: 'mixed' } }), visited: false,
    })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ published: true, reviewStatus: 'pending' })
    expect(rows.campus_places[0]).toMatchObject({ review_status: 'pending', review_reason: '' })
    expect(rows.campus_place_ratings).toEqual([])
  })

  it('只返回个人资料学校一致的校内地点，并隐藏用户编号', async () => {
    const { handler } = edge({ tables: {
      campus_places: [
        { id: placeId, owner_id: actor, school: '虚构大学', visibility: 'school', name: '虚构面馆', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', public_contact: '虚构公开业务邮箱', source_info: '虚构学校官网', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null },
        { id: '00000102-0000-4000-8000-000000000102', owner_id: other, school: '另一所虚构大学', visibility: 'school', name: '不应显示', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null },
      ],
      campus_place_ratings: [{ place_id: placeId, user_id: other, scores: { value: 'mixed' }, note: '虚构短评', updated_at: '2026-10-01' }],
    } })
    const response = await call(handler, 'campus_places_list')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.data.places).toHaveLength(1)
    expect(body.data.places[0]).toMatchObject({ id: placeId, isMine: true, publicContact: '虚构公开业务邮箱', sourceInfo: '虚构学校官网', ratings: [{ isMine: false, note: '虚构短评' }] })
    expect(JSON.stringify(body)).not.toContain(other)
    expect(JSON.stringify(body)).not.toContain('user_id')
  })

  it('发现列表只公开审核通过的他人地点，投稿人可查看自己的待审状态和原因', async () => {
    const pendingOwn = { id: placeId, owner_id: actor, school: '虚构大学', visibility: 'school', review_status: 'rejected', review_reason: '补充官方开放时间', name: '本人地点', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null }
    const approved = { id: '00000102-0000-4000-8000-000000000102', owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'approved', review_reason: '', name: '审核通过', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null }
    const pendingOther = { id: '00000103-0000-4000-8000-000000000103', owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'pending', review_reason: '', name: '不应公开', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null }
    const { handler } = edge({ tables: { campus_places: [pendingOwn, approved, pendingOther] } })
    const response = await call(handler, 'campus_places_list')
    const body = await response.json()
    expect(body.data.places.map((place) => place.id)).toEqual([placeId, approved.id])
    expect(body.data.places[0]).toMatchObject({ reviewStatus: 'rejected', reviewReason: '补充官方开放时间' })
    expect(JSON.stringify(body)).not.toContain('不应公开')
  })

  it('同校用户可以新增到访评分，评分保存不携带金额或具体到访时间', async () => {
    const { handler, rows, admin } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'approved', name: '虚构面馆', category: 'food', rating_template_id: 'food', campus: '', area: '', place_hint: '', created_at: '2026-10-01', updated_at: '2026-10-01', archived_at: null }],
    } })
    const response = await call(handler, 'campus_place_rating_save', {
      placeId, category: 'food', scores: { value: 'worth', portion: 'large' }, note: '虚构评分', visited: true, price: 18, visitedAt: '2026-10-02T12:00:00Z',
    })
    expect(response.status).toBe(200)
    expect(rows.campus_place_ratings[0]).toMatchObject({ place_id: placeId, user_id: actor, scores: { value: 'worth', portion: 'large' }, note: '虚构评分' })
    expect(rows.campus_place_ratings[0]).not.toHaveProperty('price')
    expect(rows.campus_place_ratings[0]).not.toHaveProperty('visited_at')
    expect(admin.rpc).toHaveBeenCalledWith('campus_place_rate_limit', { p_actor_id: actor, p_action: 'rating' })
  })

  it('只有审核通过的地点可以接受评分，包括地点发布者自己的待审核地点', async () => {
    const pending = { id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'pending', name: '待审地点', category: 'food', rating_template_id: 'food', archived_at: null }
    const outsider = edge({ tables: { campus_places: [pending] } })
    const rejected = await call(outsider.handler, 'campus_place_rating_save', { placeId, category: 'food', scores: { rating: 4 }, visited: true })
    expect(rejected.status).toBe(404)
    expect(outsider.rows.campus_place_ratings).toEqual([])

    const ownerRecord = { ...pending, owner_id: actor }
    const owner = edge({ tables: { campus_places: [ownerRecord] } })
    const ownerRejected = await call(owner.handler, 'campus_place_rating_save', { placeId, category: 'food', scores: { rating: 4 }, visited: true })
    expect(ownerRejected.status).toBe(404)
    expect(owner.rows.campus_place_ratings).toEqual([])
  })

  it('用户没有主动填写公开短评时，更新结构化评分会保留已有公开短评', async () => {
    const current = { place_id: placeId, user_id: actor, scores: { value: 'mixed' }, note: '虚构的已公开体验', created_at: '2026-10-01', updated_at: '2026-10-01' }
    const { handler, rows } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'approved', name: '虚构面馆', category: 'food', rating_template_id: 'food', archived_at: null }],
      campus_place_ratings: [current],
    } })
    const response = await call(handler, 'campus_place_rating_save', { placeId, category: 'food', scores: { rating: 4 }, visited: true })
    expect(response.status).toBe(200)
    expect(rows.campus_place_ratings[0]).toMatchObject({ note: '虚构的已公开体验', scores: { rating: 4 } })
  })

  it('阻止同校区同区域的同名重复地点投稿', async () => {
    const existing = { id: '00000102-0000-4000-8000-000000000102', owner_id: other, school: '虚构大学', campus: '北校区', area: '北苑', name: '虚构面馆', archived_at: null }
    const { handler, rows } = edge({ tables: { campus_places: [existing] } })
    const response = await call(handler, 'campus_place_publish', { place: sharedPlace(), visited: false })
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('duplicate_place')
    expect(rows.campus_places).toHaveLength(1)
  })

  it('没有到访确认时拒绝直接保存校内评分', async () => {
    const { handler, rows } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'approved', name: '虚构面馆', category: 'food', rating_template_id: 'food', archived_at: null }],
    } })
    const response = await call(handler, 'campus_place_rating_save', {
      placeId, category: 'food', scores: { value: 'worth' }, note: '虚构评分',
    })
    expect(response.status).toBe(400)
    expect(rows.campus_place_ratings).toEqual([])
  })

  it('拒绝删除其他人的校内地点', async () => {
    const { handler, rows } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', name: '虚构面馆', category: 'food', rating_template_id: 'food' }],
    } })
    const response = await call(handler, 'campus_place_delete', { placeId })
    expect(response.status).toBe(403)
    expect(rows.campus_places).toHaveLength(1)
  })

  it('举报只允许同校用户对他人内容提交短说明', async () => {
    const { handler, rows } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'approved', name: '虚构面馆', category: 'food', rating_template_id: 'food', archived_at: null }],
    } })
    const response = await call(handler, 'campus_place_report', { placeId, reason: 'inaccurate', detail: '虚构地点信息有误' })
    expect(response.status).toBe(200)
    expect(rows.campus_content_reports[0]).toMatchObject({ target_type: 'place', target_id: placeId, reporter_id: actor, reason: 'inaccurate', detail: '虚构地点信息有误' })
    expect(rows.campus_place_reports).toEqual([])
  })

  it('待审核地点不开放举报入口对应的服务端写入', async () => {
    const { handler, rows } = edge({ tables: {
      campus_places: [{ id: placeId, owner_id: other, school: '虚构大学', visibility: 'school', review_status: 'pending', name: '待审地点', category: 'food', rating_template_id: 'food', archived_at: null }],
    } })
    const response = await call(handler, 'campus_place_report', { placeId, reason: 'inaccurate', detail: '虚构地点信息有误' })
    expect(response.status).toBe(404)
    expect(rows.campus_place_reports).toEqual([])
    expect(rows.campus_content_reports).toEqual([])
  })

  it('只向已添加好友发送用户确认的最小地点副本', async () => {
    const { handler, rows } = edge({ tables: { social_friendships: [{ user_low: actor, user_high: other }] } })
    const response = await call(handler, 'campus_place_invite_send', {
      inviteId: '00000111-0000-4000-8000-000000000111', friendId: other,
      places: [{
        ...sharedPlace(), visibility: 'private', note: '不能上传的私人备注',
        visits: [{ visitedAt: '2026-10-03', price: 18 }], transactionId: 'expense-fiction-1',
      }],
    })
    expect(response.status).toBe(200)
    expect(rows.campus_place_invites).toHaveLength(1)
    const sentPlace = rows.campus_place_invites[0].payload.places[0]
    expect(sentPlace).toMatchObject({ id: placeId, name: '虚构面馆', scores: { value: 'worth', portion: 'large' } })
    expect(sentPlace).not.toHaveProperty('note')
    expect(sentPlace).not.toHaveProperty('visits')
    expect(sentPlace).not.toHaveProperty('transactionId')
    expect(rows.social_notifications[0]).toMatchObject({ recipient_id: other, kind: 'place_preset' })
  })

  it('不是好友时拒绝读取预设，也不会泄露地点内容', async () => {
    const { handler } = edge({ tables: { campus_place_invites: [{
      id: '00000111-0000-4000-8000-000000000111', sender_id: other, recipient_id: actor,
      payload: { places: [{ id: placeId, name: '隐藏地点' }] }, status: 'pending', expires_at: '2099-01-01T00:00:00Z',
    }] } })
    const response = await call(handler, 'campus_place_invite_preview', { inviteId: '00000111-0000-4000-8000-000000000111' })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'friendship_required' })
  })

  it('收件人确认本机导入后完成接受，服务器清空副本；拒收也清空副本', async () => {
    const inviteId = '00000111-0000-4000-8000-000000000111'
    const friendship = { user_low: actor, user_high: other }
    const row = { id: inviteId, sender_id: other, recipient_id: actor, payload: { places: [sharedPlace()] }, status: 'pending', expires_at: '2099-01-01T00:00:00Z' }
    const accepted = edge({ tables: { social_friendships: [friendship], campus_place_invites: [structuredClone(row)] } })
    const preview = await call(accepted.handler, 'campus_place_invite_preview', { inviteId })
    expect((await preview.json()).data.places).toHaveLength(1)
    const complete = await call(accepted.handler, 'campus_place_invite_complete', { inviteId })
    expect(complete.status).toBe(200)
    expect(accepted.rows.campus_place_invites[0]).toMatchObject({ status: 'accepted', payload: { places: [] } })

    const rejected = edge({ tables: { social_friendships: [friendship], campus_place_invites: [structuredClone(row)] } })
    const reject = await call(rejected.handler, 'campus_place_invite_reject', { inviteId })
    expect(reject.status).toBe(200)
    expect(rejected.rows.campus_place_invites[0]).toMatchObject({ status: 'rejected', payload: { places: [] } })
  })
})
