import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import vm from 'node:vm'
import { describe, it, expect, vi } from 'vitest'
import { createMiniRuntime } from './helpers/wechatRuntime.js'
const require = createRequire(import.meta.url)
const { createService, COLLECTIONS: C } = require('../miniprogram/cloudfunctions/study-life/service.js')
const { hash } = require('../miniprogram/cloudfunctions/study-life/rules.js')
const { createStore } = require('../miniprogram/cloudfunctions/study-life/store.js')
const appId = 'wx4377be9f658a4c7d'
const identity = name => ({ APPID: appId, OPENID: `fictional-${name}` })
const userId = name => hash(`${appId}:${identity(name).OPENID}`)
const owner = userId('owner')
const profile = { nickname: '示例同学', school: '虚构大学', campus: '东区', scheduleCompleteThrough: '2026-10-16', semesterEnd: '2027-01-20' }
const content = (id, fields = {}) => ({ id, type: 'guide', school: '虚构大学', campus: '东区', title: '虚构校园办事指南', body: '这是完全虚构的校园指南说明内容。', author_id: userId('writer'), status: 'pending_review', revision: 1, created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z', ...fields })

// 行为替身只实现持久化接口：真实处理器执行完整的鉴权、状态迁移与账本流程。
function memoryStore() {
  let data = new Map()
  let queue = Promise.resolve()
  const key = (c, id) => `${c}/${id}`
  function access(target) {
    return {
      async get(c, id) { return structuredClone(target.get(key(c, id)) || null) },
      async put(c, id, row) { target.set(key(c, id), structuredClone({ ...row, _id: id })) },
    }
  }
  return {
    async get(c, id) { return access(data).get(c, id) },
    async put(c, id, row) { return access(data).put(c, id, row) },
    in(values) { return { $in: values } },
    async list(c, where = {}, { offset = 0, limit = 60, order = 'created_at', direction = 'desc' } = {}) {
      const rows = [...data.entries()].filter(([k, row]) => k.startsWith(`${c}/`) && Object.entries(where).every(([field, value]) => value?.$in ? value.$in.includes(row[field]) : row[field] === value)).map(([, row]) => structuredClone(row))
      rows.sort((a, b) => (String(a[order] || '').localeCompare(String(b[order] || '')) * (direction === 'desc' ? -1 : 1)) || a._id.localeCompare(b._id))
      return rows.slice(offset, offset + limit)
    },
    async transaction(callback) {
      const work = queue.then(async () => {
        const next = structuredClone(data)
        const result = await callback(access(next))
        data = next
        return result
      })
      queue = work.catch(() => {})
      return work
    },
    snapshot() { return JSON.stringify([...data]) },
  }
}
async function fixture(options = {}) {
  const store = memoryStore()
  const checkText = options.checkText || vi.fn(async () => true)
  let sequence = 0
  const handler = createService({ store, appId, ownerIds: [owner], checkText, now: () => new Date('2026-10-16T12:00:00Z'), newId: () => `fixture-${++sequence}` })
  const call = (name, service, action, payload = {}, extra = {}) => handler({ service, action, payload, ...extra }, identity(name))
  for (const name of ['owner', 'writer', 'reviewer', 'reader', 'other']) {
    await call(name, 'account', 'login')
    await store.put(C.profiles, userId(name), profile)
  }
  await store.put(C.grants, userId('reviewer'), { active: true, school: profile.school, campus: profile.campus })
  return { store, handler, call, checkText }
}

describe('微信云开发业务流程', () => {
  it('身份只取微信上下文，伪造参数不能登录、提权或访问其他 AppID', async () => {
    const f = await fixture()
    const event = { service: 'account', action: 'login', payload: { openid: 'fictional-owner', userId: owner, role: 'owner' } }
    expect((await f.handler(event, {})).code).toBe('unauthorized')
    expect((await f.handler(event, { ...identity('owner'), APPID: 'wx0000000000000000' })).code).toBe('unauthorized')
    const login = await f.call('reader', 'account', 'login', event.payload)
    expect(login.data.user).toEqual({ id: userId('reader'), owner: false })
    expect((await f.call('reader', 'admin', 'applications', { role: 'owner' })).code).toBe('forbidden')
    expect(f.store.snapshot()).not.toContain('fictional-reader')
  })
  it('并发首次登录只创建一个账号，不保存 OpenID 或会话密钥', async () => {
    const f = await fixture()
    const results = await Promise.all([f.call('new', 'account', 'login'), f.call('new', 'account', 'login')])
    expect(results.map(r => r.data.created).sort()).toEqual([false, true])
    expect(f.store.snapshot()).not.toContain('fictional-new')
    await f.store.put(C.accounts, userId('new'), { status: 'disabled' })
    expect((await f.call('new', 'account', 'login')).code).toBe('forbidden')
    expect((await f.call('new', 'community', 'wallet')).code).toBe('unauthorized')
  })
  it('个人资料只写允许字段，验证实际日期、日期顺序和学校', async () => {
    const f = await fixture()
    expect((await f.call('reader', 'profile', 'profile_save', { ...profile, role: 'owner', school: '' })).code).toBe('invalid_input')
    expect((await f.call('reader', 'profile', 'profile_save', { ...profile, semesterEnd: '2027-02-30' })).code).toBe('invalid_input')
    expect((await f.call('reader', 'profile', 'profile_save', { ...profile, scheduleCompleteThrough: '2028-01-01' })).code).toBe('invalid_input')
    expect((await f.call('reader', 'profile', 'profile_save', { ...profile, owner: true })).ok).toBe(true)
    expect(await f.store.get(C.profiles, userId('reader'))).not.toHaveProperty('owner')
  })
  it('七类目录均使用云数据库，学校和校区过滤在分页前生效', async () => {
    const f = await fixture()
    const lists = [['course', 'courses_list', 'courses'], ['market_listing', 'market_list', 'listings'], ['help_task', 'help_list', 'tasks'], ['shuttle_route', 'shuttle_list', 'routes'], ['lost_found', 'lost_found_list', 'items'], ['event', 'events_list', 'events'], ['guide', 'guides_list', 'guides']]
    for (const [type, action, key] of lists) {
      for (const [suffix, fields] of [['east', {}], ['all', { campus: '' }], ['west', { campus: '西区' }], ['away', { school: '另一所虚构大学' }], ['pending', { status: 'pending_review' }]]) {
        await f.store.put(C.content, `${type}-${suffix}`, content(`${type}-${suffix}`, { type, status: 'approved', ...fields }))
      }
      const result = await f.call('reader', 'campus', action)
      expect(result.ok).toBe(true)
      expect(result.data[key].map(row => row.id).sort()).toEqual([`${type}-all`, `${type}-east`])
      expect(result.data[key][0]).not.toHaveProperty('author_id')
    }
  })
  it('没有学校时明确提示设置资料，不能用请求参数切换学校', async () => {
    const f = await fixture()
    await f.store.put(C.profiles, userId('reader'), { school: '' })
    expect((await f.call('reader', 'campus', 'guides_list', { school: profile.school })).code).toBe('profile_required')
  })
  it('投稿通过安全检测后进入审核；失败和私密信息不能写入内容', async () => {
    const f = await fixture()
    const request = { type: 'guide', title: '虚构指南', body: '这是安全的虚构校园说明文本。' }
    const submitted = await f.call('writer', 'campus', 'content_submit', request)
    expect(submitted.data.item.status).toBe('pending_review')
    expect((await f.call('reader', 'campus', 'guides_list')).data.guides).toEqual([])
    expect((await f.call('writer', 'campus', 'content_submit', { ...request, body: '请联系邮箱 fictional@example.test' })).code).toBe('private_content')
    f.checkText.mockResolvedValueOnce(false)
    expect((await f.call('writer', 'campus', 'content_submit', request)).code).toBe('content_rejected')
    f.checkText.mockRejectedValueOnce(new Error('secret backend diagnostic'))
    const failed = await f.call('writer', 'campus', 'content_submit', request)
    expect(failed.code).toBe('safety_unavailable')
    expect(JSON.stringify(failed)).not.toContain('secret')
    expect((await f.store.list(C.content)).length).toBe(1)
  })
  it('公开建议严格隐藏作者和私有字段，未登录也可读', async () => {
    const f = await fixture()
    const submitted = await f.call('writer', 'community', 'submit', { title: '虚构体验建议', body: '建议完善完全虚构的校园指引内容。', category: 'campus' })
    expect(submitted.ok).toBe(true)
    await f.store.put(C.feedback, 'hidden', { ...submitted.data.item, id: 'hidden', author_id: owner, visibility: 'hidden' })
    const result = await f.call('guest', 'community', 'public_list')
    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]).not.toHaveProperty('author_id')
    expect(result.data.items[0]).not.toHaveProperty('_id')
    expect((await f.call('guest', 'community', 'submit', { title: '伪造建议' })).code).toBe('unauthorized')
  })
  it('提交建议每小时限五次，篡改频次字段无效', async () => {
    const f = await fixture()
    const input = { title: '虚构体验建议', body: '建议完善完全虚构的校园指引内容。', category: 'product', limit: 99999 }
    for (let i = 0; i < 5; i++) expect((await f.call('writer', 'community', 'submit', input)).ok).toBe(true)
    expect((await f.call('writer', 'community', 'submit', input)).code).toBe('rate_limited')
  })
  it('审核员申请、补充、审批、撤权完整闭环，审批使用最新版本', async () => {
    const f = await fixture()
    const result = await f.call('reader', 'community', 'reviewer_apply', { reason: '我熟悉虚构学校的校园情况并愿意认真核查。' })
    expect(result.data.application.status).toBe('pending')
    expect((await f.call('reader', 'community', 'reviewer_apply', { reason: '这是另一份完全虚构的审核申请理由。' })).code).toBe('duplicate')
    const payload = { applicationId: userId('reader'), revision: 1, decision: 'request_proof', reason: '请补充熟悉校园的说明。' }
    expect((await f.call('owner', 'admin', 'application_decide', payload)).ok).toBe(true)
    expect((await f.call('other', 'community', 'reviewer_application_reply', { applicationId: userId('reader'), response: '伪造材料' })).code).toBe('forbidden')
    expect((await f.call('reader', 'community', 'reviewer_application_reply', { applicationId: userId('reader'), response: '我熟悉虚构校园图书馆的办事流程。' })).ok).toBe(true)
    expect((await f.call('owner', 'admin', 'application_decide', { ...payload, decision: 'approve', school: profile.school, campus: profile.campus, revision: 2 })).code).toBe('state_changed')
    expect((await f.call('owner', 'admin', 'application_decide', { ...payload, decision: 'approve', school: profile.school, campus: profile.campus, revision: 3 })).ok).toBe(true)
    expect((await f.call('reader', 'campus', 'governance_access')).data.reviewer).toBe(true)
    expect((await f.call('owner', 'admin', 'reviewer_revoke', { userId: userId('reader'), reason: '虚构的权限范围调整。' })).ok).toBe(true)
    expect((await f.call('reader', 'campus', 'governance_access')).data.reviewer).toBe(false)
  })
  it('审核阻止自审、跨校、全校越权、旧版本和伪造权限', async () => {
    const f = await fixture()
    await f.store.put(C.content, 'own', content('own', { author_id: userId('reviewer') }))
    await f.store.put(C.content, 'away', content('away', { school: '另一所虚构大学' }))
    await f.store.put(C.content, 'all', content('all', { campus: '' }))
    await f.store.put(C.content, 'normal', content('normal'))
    const decide = (name, key, version = 1) => f.call(name, 'campus', 'moderation_decide', { targetId: key, targetType: 'guide', decision: 'approve', reason: '已核查虚构公开来源。', revision: version, owner: true })
    expect((await decide('reviewer', 'own')).code).toBe('self_review')
    expect((await decide('reviewer', 'away')).code).toBe('forbidden')
    expect((await decide('reviewer', 'all')).code).toBe('forbidden')
    expect((await decide('reader', 'normal')).code).toBe('forbidden')
    expect((await decide('reviewer', 'normal', 2)).code).toBe('state_changed')
    expect((await decide('reviewer', 'normal')).ok).toBe(true)
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet.contribution).toBe(3)
    expect((await f.call('reader', 'community', 'wallet')).data.ledger).toHaveLength(0)
  })
  it('同时审核同一内容只有一次状态变化和一次奖励', async () => {
    const f = await fixture()
    await f.store.put(C.content, 'race', content('race'))
    const payload = { targetType: 'guide', targetId: 'race', decision: 'approve', reason: '已核查虚构公开来源。', revision: 1 }
    const results = await Promise.all([f.call('reviewer', 'campus', 'moderation_decide', payload), f.call('reviewer', 'campus', 'moderation_decide', payload)])
    expect(results.filter(r => r.ok)).toHaveLength(1)
    expect(results.find(r => !r.ok).code).toBe('state_changed')
    const wallet = await f.call('reviewer', 'community', 'wallet')
    expect(wallet.data.wallet.contribution).toBe(3)
    expect(wallet.data.ledger).toHaveLength(1)
  })
  it('每日奖励上限 20 条，总管理员不领审核奖励', async () => {
    const f = await fixture()
    for (let i = 0; i < 21; i++) {
      const key = `cap-${i}`
      await f.store.put(C.content, key, content(key))
      expect((await f.call('reviewer', 'campus', 'moderation_decide', { targetType: 'guide', targetId: key, revision: 1, decision: 'approve', reason: '已核对虚构的公共资料。' })).ok).toBe(true)
    }
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet.contribution).toBe(60)
    await f.store.put(C.content, 'owner-review', content('owner-review'))
    expect((await f.call('owner', 'campus', 'moderation_decide', { targetType: 'guide', targetId: 'owner-review', revision: 1, decision: 'approve', reason: '已核查公开资料。' })).ok).toBe(true)
    expect((await f.call('owner', 'community', 'wallet')).data.wallet.contribution).toBe(0)
  })
  it('举报校验目标范围，旧目标版本不会部分下架或发奖', async () => {
    const f = await fixture()
    await f.store.put(C.content, 'public', content('public', { status: 'approved' }))
    await f.store.put(C.content, 'away', content('away', { status: 'approved', school: '另一所虚构大学' }))
    const input = { targetId: 'public', targetType: 'guide', reason: 'inaccurate', detail: '虚构公共来源与此处描述不符。' }
    expect((await f.call('reader', 'campus', 'content_report', { ...input, targetId: 'away' })).code).toBe('not_found')
    expect((await f.call('reader', 'campus', 'content_report', input)).ok).toBe(true)
    const key = hash(`${userId('reader')}:guide:public`)
    const decision = { reportId: key, decision: 'remove', revision: 1, targetRevision: 9, reason: '已核对并确认虚构描述不准确。' }
    expect((await f.call('reviewer', 'campus', 'report_resolve', decision)).code).toBe('state_changed')
    expect((await f.store.get(C.content, 'public')).status).toBe('approved')
    expect((await f.store.get(C.reports, key)).status).toBe('pending')
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet.contribution).toBe(0)
    expect((await f.call('reviewer', 'campus', 'report_resolve', { ...decision, targetRevision: 1 })).ok).toBe(true)
    expect((await f.store.get(C.content, 'public')).status).toBe('removed')
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet.contribution).toBe(3)
  })
  it('总管理员处理建议只奖励一次，阻止自奖、非法金额和状态', async () => {
    const f = await fixture()
    await f.call('writer', 'community', 'submit', { title: '虚构体验建议', body: '建议完善完全虚构的校园指引内容。', category: 'campus' })
    const key = (await f.store.list(C.feedback))[0].id
    const input = { feedbackId: key, revision: 1, status: 'resolved', visibility: 'public', reply: '已完善虚构指引。', publicReason: '', reward: 10 }
    expect((await f.call('reader', 'admin', 'feedback_manage', input)).code).toBe('forbidden')
    expect((await f.call('owner', 'admin', 'feedback_manage', { ...input, status: 'pending' })).code).toBe('invalid_input')
    expect((await f.call('owner', 'admin', 'feedback_manage', { ...input, reward: 21 })).code).toBe('invalid_input')
    const results = await Promise.all([f.call('owner', 'admin', 'feedback_manage', input), f.call('owner', 'admin', 'feedback_manage', input)])
    expect(results.filter(r => r.ok)).toHaveLength(1)
    expect((await f.call('owner', 'admin', 'feedback_manage', { ...input, revision: 2 })).ok).toBe(true)
    expect((await f.call('writer', 'community', 'wallet')).data.wallet.contribution).toBe(10)
    expect((await f.call('owner', 'admin', 'feedback_manage', { ...input, revision: 3, reward: 11 })).code).toBe('already_rewarded')
    await f.store.put(C.feedback, key, { ...(await f.store.get(C.feedback, key)), author_id: owner, reward_issued: false })
    expect((await f.call('owner', 'admin', 'feedback_manage', { ...input, revision: 3 })).code).toBe('self_reward')
  })
  it('错判追回、欠额抵扣、重开后再审不会重复奖励', async () => {
    const f = await fixture()
    await f.store.put(C.content, 'audit', content('audit'))
    expect((await f.call('reviewer', 'campus', 'moderation_decide', { targetType: 'guide', targetId: 'audit', revision: 1, decision: 'approve', reason: '已核对虚构来源。' })).ok).toBe(true)
    const event = (await f.store.list(C.moderation))[0]
    await f.store.put(C.audits, event.id, { id: event.id, event, reviewer_id: userId('reviewer'), outcome: 'pending' })
    await f.store.put(C.wallets, userId('reviewer'), { purchased: 12, contribution: 1, contributionDebt: 0 })
    const input = { auditId: event.id, correct: false, reopen: true, reason: '公开来源不支持原结论，退回重新核查。' }
    expect((await f.call('owner', 'admin', 'audit_resolve', input)).ok).toBe(true)
    expect((await f.call('owner', 'admin', 'audit_resolve', input)).code).toBe('state_changed')
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet).toEqual({ purchased: 12, contribution: 0, contributionDebt: 2 })
    expect((await f.call('reviewer', 'campus', 'moderation_decide', { targetType: 'guide', targetId: 'audit', revision: 3, decision: 'reject', reason: '原内容不准确，应当退回。' })).ok).toBe(true)
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet.contribution).toBe(0)
    await f.store.put(C.content, 'new-review', content('new-review'))
    expect((await f.call('reviewer', 'campus', 'moderation_decide', { targetType: 'guide', targetId: 'new-review', revision: 1, decision: 'approve', reason: '新的虚构内容已经核对。' })).ok).toBe(true)
    expect((await f.call('reviewer', 'community', 'wallet')).data.wallet).toEqual({ purchased: 12, contribution: 1, contributionDebt: 0 })
  })
  it('审核权限撤销立即生效，不能凭旧页面数据继续发奖', async () => {
    const f = await fixture()
    await f.store.put(C.content, 'revoked', content('revoked'))
    expect((await f.call('reviewer', 'campus', 'moderation_queue')).data.items).toHaveLength(1)
    await f.call('owner', 'admin', 'reviewer_revoke', { userId: userId('reviewer'), reason: '虚构的授权调整。' })
    expect((await f.call('reviewer', 'campus', 'moderation_decide', { targetType: 'guide', targetId: 'revoked', revision: 1, decision: 'approve', reason: '试图使用已撤销授权。' })).code).toBe('forbidden')
    expect((await f.store.get(C.content, 'revoked')).status).toBe('pending_review')
  })
  it('异常和超大请求不会泄露数据库细节', async () => {
    const f = await fixture()
    expect((await f.call('reader', 'invalid', 'invalid')).code).toBe('invalid_action')
    expect((await f.call('reader', 'community', 'wallet', { huge: 'x'.repeat(33000) })).code).toBe('invalid_input')
    expect((await f.call('reader', 'community', 'wallet', [])).code).toBe('invalid_input')
    f.store.list = async () => { throw new Error('secret_database_diagnostic') }
    const result = await f.call('guest', 'community', 'public_list')
    expect(result.code).toBe('service_unavailable')
    expect(JSON.stringify(result)).not.toContain('secret_database_diagnostic')
  })
})

describe('微信客户端云调用', () => {
  function client(config = { cloudEnvId: 'fictional-env-123', cloudFunctionName: 'study-life' }) {
    const storage = new Map()
    const wx = { cloud: { init: vi.fn(), callFunction: vi.fn(async () => ({ result: { ok: true, data: { user: { id: 'fictional-user', owner: false } } } })) }, getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) }
    const context = { module: { exports: {} }, wx, require: () => config }
    vm.runInNewContext(readFileSync(new URL('../miniprogram/utils/api.js', import.meta.url), 'utf8'), context)
    return { api: context.module.exports, wx, storage, config }
  }
  it('AppID 不能代替 EnvID，未配置时给出明确提示', async () => {
    for (const cloudEnvId of ['', appId]) {
      const f = client({ cloudEnvId, cloudFunctionName: 'study-life' })
      expect(f.api.initializeCloud()).toBe(false)
      await expect(f.api.wechatLogin()).rejects.toThrow('EnvID')
      expect(f.wx.cloud.callFunction).not.toHaveBeenCalled()
    }
  })
  it('使用原生云登录，初始化一次，不携带邮箱、密码或旧 token', async () => {
    const f = client()
    f.storage.set('study-life-mini-session-v1', { access_token: 'legacy-token' })
    expect(f.api.isLoggedIn()).toBe(false)
    await f.api.wechatLogin()
    await f.api.communityRequest('wallet')
    expect(f.api.isLoggedIn()).toBe(true)
    expect(f.wx.cloud.init).toHaveBeenCalledTimes(1)
    expect(f.wx.cloud.callFunction.mock.calls[0][0]).toEqual({ name: 'study-life', config: { env: 'fictional-env-123' }, data: { service: 'account', action: 'login', payload: {} } })
    expect(JSON.stringify(f.wx.cloud.callFunction.mock.calls)).not.toContain('legacy-token')
    await f.api.signOut()
    expect(f.api.isLoggedIn()).toBe(false)
    expect(f.storage.has('study-life-mini-session-v1')).toBe(false)
  })
  it('切换环境不复用账号；服务器注销状态会清除缓存', async () => {
    const f = client()
    await f.api.wechatLogin()
    f.config.cloudEnvId = 'fictional-second-env'
    expect(f.api.isLoggedIn()).toBe(false)
    await f.api.wechatLogin()
    expect(f.wx.cloud.init).toHaveBeenCalledTimes(2)
    f.wx.cloud.callFunction.mockResolvedValueOnce({ result: { ok: false, code: 'unauthorized', error: '账号不可用。' } })
    await expect(f.api.syncSession()).rejects.toThrow('账号不可用')
    expect(f.api.isLoggedIn()).toBe(false)
  })
})

describe('微信 SDK 持久化适配', () => {
  it('区分普通和事务返回形状，set 使用微信 SDK 的 data 包装', async () => {
    const txSet = vi.fn(async () => ({}))
    const directSet = vi.fn(async () => ({}))
    const transaction = { collection: () => ({ doc: () => ({ get: async () => ({ data: { _id: 'a', value: 2 } }), set: txSet }) }) }
    const db = { collection: () => ({ doc: () => ({ get: async () => ({ data: [{ _id: 'a', value: 1 }] }), set: directSet }) }), runTransaction: callback => callback(transaction) }
    const store = createStore(db)
    expect((await store.get('sample', 'a')).value).toBe(1)
    await store.put('sample', 'a', { _id: 'a', value: 3 })
    await store.transaction(async tx => { expect((await tx.get('sample', 'a')).value).toBe(2); await tx.put('sample', 'a', { _id: 'a', value: 4 }) })
    expect(directSet).toHaveBeenCalledWith({ data: { value: 3 } })
    expect(txSet).toHaveBeenCalledWith({ data: { value: 4 } })
  })
  it('文档缺失与网络、权限、集合缺失分别处理', async () => {
    let error = { errCode: -1, errMsg: 'document.get:fail document not exist' }
    const db = { collection: () => ({ doc: () => ({ get: async () => { throw error } }) }) }
    const store = createStore(db)
    expect(await store.get('sample', 'a')).toBeNull()
    for (const failure of [{ errCode: -1, errMsg: 'collection not exist' }, { code: 'PERMISSION_DENIED' }, { message: 'network unavailable' }]) {
      error = failure
      await expect(store.get('sample', 'a')).rejects.toEqual(failure)
    }
  })
})

describe('小程序页面与云函数联通', () => {
  function pageClient(fixture, name) {
    return createMiniRuntime({ cloudHandler: data => fixture.handler(data, identity(name)) })
  }
  it('每个注册页面有完整文件，所有 WXML 事件均有对应方法', async () => {
    const f = await fixture()
    const client = pageClient(f, 'reader')
    const app = JSON.parse(readFileSync(new URL('../miniprogram/app.json', import.meta.url), 'utf8'))
    expect(existsSync(new URL('../miniprogram/app.wxss', import.meta.url))).toBe(true)
    for (const route of app.pages) {
      for (const extension of ['js', 'json', 'wxml', 'wxss']) expect(existsSync(new URL(`../miniprogram/${route}.${extension}`, import.meta.url))).toBe(true)
      const name = route.split('/')[1]
      const page = client.page(name)
      const template = readFileSync(new URL(`../miniprogram/${route}.wxml`, import.meta.url), 'utf8')
      for (const match of template.matchAll(/(?:bind|catch)(?:tap|input|change|submit|confirm)="([A-Za-z]+)"/g)) expect(typeof page[match[1]], `${route}: ${match[1]}`).toBe('function')
    }
    const project = JSON.parse(readFileSync(new URL('../miniprogram/project.config.json', import.meta.url), 'utf8'))
    expect(project.appid).toBe(appId)
    expect(project.packOptions.ignore.some(entry => entry.value === 'cloudfunctions')).toBe(true)
  })
  it('微信登录页面获取独立账号、学校资料和账本，不调用邮箱接口', async () => {
    const f = await fixture()
    const client = pageClient(f, 'reader')
    const account = client.page('account')
    await account.loginWechat()
    expect(account.data.error).toBe('')
    expect(account.data.loggedIn).toBe(true)
    expect(account.data.userId).toBe(userId('reader'))
    expect(account.data.profile.school).toBe(profile.school)
    expect(account.data.wallet.contribution).toBe(0)
    account.copyUserId()
    expect(client.wx.setClipboardData).toHaveBeenCalledWith({ data: userId('reader') })
    await account.logout()
    expect(account.data.loggedIn).toBe(false)
    expect(client.api.isLoggedIn()).toBe(false)
  })
  it('投稿页 → 审核页 → 同校公开目录使用同一云端数据', async () => {
    const f = await fixture()
    const writer = pageClient(f, 'writer')
    const reviewer = pageClient(f, 'reviewer')
    await writer.api.wechatLogin()
    await reviewer.api.wechatLogin()
    const directory = writer.page('directory')
    directory.onLoad({ kind: 'guides' })
    await directory.load()
    directory.setData({ postTitle: '虚构校园指南', postBody: '这是完全虚构的校园办事说明内容。' })
    await directory.submitPost()
    expect(directory.data.notice).toContain('投稿已提交')
    const review = reviewer.page('review')
    await review.load()
    expect(review.data.items).toHaveLength(1)
    const key = review.data.items[0].item.id
    review.setData({ [`reasons.${key}`]: '已核对虚构的公开资料。' })
    await review.decide({ currentTarget: { dataset: { id: key, decision: 'approve' } } })
    expect(review.data.error).toBe('')
    expect(review.data.items).toHaveLength(0)
    await directory.load()
    expect(directory.data.items[0].title).toBe('虚构校园指南')
  })
  it('管理页审批申请、发建议奖励；撤权后的账号可以重新申请', async () => {
    const f = await fixture()
    const reader = pageClient(f, 'reader')
    const admin = pageClient(f, 'owner')
    await reader.api.wechatLogin()
    await admin.api.wechatLogin()
    await reader.api.communityRequest('reviewer_apply', { reason: '我熟悉虚构学校的图书馆流程并愿意核实。' })
    const page = admin.page('admin')
    await page.load()
    expect(page.data.allowed).toBe(true)
    page.select({ currentTarget: { dataset: { id: userId('reader') } } })
    page.setData({ reason: '已核对虚构的校园经验。' })
    await page.act({ currentTarget: { dataset: { decision: 'approve' } } })
    expect(page.data.error).toBe('')
    await reader.api.communityRequest('submit', { category: 'product', title: '虚构体验建议', body: '这里描述完全虚构的产品建议内容。' })
    page.setData({ mode: 'feedback' })
    await page.load()
    page.select({ currentTarget: { dataset: { id: page.data.items[0].id } } })
    page.setData({ statusIndex: 2, reward: '8', reply: '虚构建议已经解决。' })
    await page.act({ currentTarget: { dataset: {} } })
    expect(page.data.error).toBe('')
    expect((await reader.api.communityRequest('wallet')).wallet.contribution).toBe(8)
    await admin.api.adminRequest('reviewer_revoke', { userId: userId('reader'), reason: '虚构的授权调整说明。' })
    const account = reader.page('account')
    await account.syncAccount()
    expect(account.data.reviewer).toBe(false)
    expect(account.data.application.status).toBe('approved')
    account.setData({ reviewerReason: '我已补充新的虚构校园经历，希望重新申请。' })
    await account.applyReviewer()
    expect(account.data.error).toBe('')
    expect(account.data.application.status).toBe('pending')
  })
})
