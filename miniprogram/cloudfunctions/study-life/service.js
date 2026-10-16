const { randomUUID } = require('node:crypto')
const { createStore } = require('./store')
const { createPersonal } = require('./personal')
const { CONTENT_TYPES, LISTS, ServiceError, fail, hash, text, publicText, choice, id, date, revision, sameScope, publicContent, publicFeedback } = require('./rules')
const C = {
  accounts: 'sl_accounts', profiles: 'sl_profiles', content: 'sl_content', feedback: 'sl_feedback',
  reports: 'sl_reports', applications: 'sl_applications', grants: 'sl_grants', wallets: 'sl_wallets',
  ledger: 'sl_ledger', limits: 'sl_limits', moderation: 'sl_moderation', audits: 'sl_audits',
}
const blankWallet = () => ({ purchased: 0, contribution: 0, contributionDebt: 0 })
const blankProfile = () => ({ nickname: '', school: '', campus: '', timezone: 'Asia/Shanghai', scheduleCompleteThrough: '', semesterEnd: '' })

function createService({ db, store = createStore(db), appId, ownerIds = [], checkText, now = () => new Date(), newId = () => randomUUID().replace(/-/g, '') }) {
  const stamp = () => now().toISOString()
  const day = () => new Date(now().getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  const isOwner = actor => ownerIds.includes(actor)
  async function registered(actor, source = store) {
    const account = await source.get(C.accounts, actor)
    if (!account || account.status !== 'active') fail('unauthorized', '请重新使用微信登录，或联系管理员确认账号状态。')
    return account
  }
  async function access(actor, source = store) {
    if (isOwner(actor)) return { owner: true, reviewer: true, scope: null }
    const grant = await source.get(C.grants, actor)
    return { owner: false, reviewer: grant?.active === true, scope: grant?.active ? { school: grant.school, campus: grant.campus } : null }
  }
  function owner(actor) { if (!isOwner(actor)) fail('forbidden', '只有总管理员可以执行此操作。') }
  async function reviewer(actor, row, source = store) {
    await registered(actor, source)
    const permission = await access(actor, source)
    if (!permission.reviewer || (!permission.owner && !sameScope(row, permission.scope, true))) fail('forbidden', '没有此学校或校区的审核权限。')
    if ([row.author_id, row.reporter_id, row.target_author_id].includes(actor)) fail('self_review', '不能审核自己的内容或自己参与的举报。')
    return permission
  }
  async function profileScope(actor) {
    const profile = await store.get(C.profiles, actor)
    if (!profile?.school) fail('profile_required', '请先在「我的账号」填写学校资料。')
    return { school: profile.school, campus: profile.campus || '' }
  }
  async function safe(content) {
    try {
      if (typeof checkText !== 'function' || !await checkText(content)) fail('content_rejected', '内容未通过安全检查，请修改后重试。')
    } catch (error) {
      if (error instanceof ServiceError) throw error
      fail('safety_unavailable', '内容安全检查暂时不可用，请稍后重试。')
    }
  }
  async function takeLimit(actor, action, maximum) {
    const window = stamp().slice(0, 13)
    const key = hash(`${actor}:${action}:${window}`)
    await store.transaction(async tx => {
      const current = await tx.get(C.limits, key)
      if ((current?.count || 0) >= maximum) fail('rate_limited', '操作过于频繁，请稍后重试。')
      await tx.put(C.limits, key, { count: (current?.count || 0) + 1, user_id: actor, action, window, created_at: stamp() })
    })
  }
  async function login(actor) {
    let created = false
    await store.transaction(async tx => {
      const account = await tx.get(C.accounts, actor)
      if (account && account.status !== 'active') fail('forbidden', '账号暂不可用，请联系管理员。')
      created = !account
      if (!account) await tx.put(C.accounts, actor, { id: actor, status: 'active', created_at: stamp() })
    })
    return { created, user: { id: actor, owner: isOwner(actor) } }
  }
  async function saveProfile(actor, payload) {
    const profile = {
      nickname: publicText(payload.nickname, 40, '昵称', 1), school: publicText(payload.school, 100, '学校', 1),
      campus: publicText(payload.campus, 100, '校区'), timezone: 'Asia/Shanghai',
      scheduleCompleteThrough: date(payload.scheduleCompleteThrough, '课表确认日期'), semesterEnd: date(payload.semesterEnd, '学期结束日期'),
    }
    if (profile.scheduleCompleteThrough > profile.semesterEnd) fail('invalid_input', '课表确认日期不能晚于学期结束日期。')
    await takeLimit(actor, 'profile', 20)
    await safe(`${profile.nickname}\n${profile.school}\n${profile.campus}`)
    await store.put(C.profiles, actor, { ...profile, updated_at: stamp() })
    return { profile }
  }
  async function listContent(actor, action, payload) {
    const scope = await profileScope(actor)
    const [type, key] = LISTS[action]
    const where = { type, status: 'approved', school: scope.school }
    if (scope.campus) where.campus = store.in([scope.campus, ''])
    const page = Math.max(0, Math.min(200, Number.isSafeInteger(payload.page) ? payload.page : 0))
    const rows = await store.list(C.content, where, { offset: page * 40, limit: 41 })
    return { [key]: rows.slice(0, 40).map(publicContent), hasMore: rows.length > 40, page }
  }
  async function submitContent(actor, payload) {
    const scope = await profileScope(actor)
    const type = choice(payload.type, CONTENT_TYPES, '内容分类')
    const title = publicText(payload.title, 100, '标题', 2)
    const body = publicText(payload.body, 3000, '内容', 10)
    await takeLimit(actor, 'content', 5)
    await safe(`${title}\n${body}`)
    const key = newId()
    const row = { id: key, type, title, body, ...scope, author_id: actor, status: 'pending_review', revision: 1, created_at: stamp(), updated_at: stamp() }
    await store.put(C.content, key, row)
    return { item: publicContent(row) }
  }
  async function submitFeedback(actor, payload) {
    const title = publicText(payload.title, 100, '标题', 4)
    const body = publicText(payload.body, 3000, '建议内容', 10)
    const category = choice(payload.category, ['product', 'campus', 'accessibility', 'other'], '建议分类')
    await takeLimit(actor, 'feedback', 5)
    await safe(`${title}\n${body}`)
    const key = newId()
    const row = { id: key, author_id: actor, category, title, body, status: 'pending', visibility: 'public', public_reply: '', public_reason: '', reward_beans: 0, reward_issued: false, revision: 1, created_at: stamp(), updated_at: stamp() }
    await store.put(C.feedback, key, row)
    return { item: publicFeedback(row) }
  }
  async function reportContent(actor, payload) {
    const scope = await profileScope(actor)
    const targetId = id(payload.targetId)
    const type = choice(payload.targetType, CONTENT_TYPES, '举报分类')
    const reason = choice(payload.reason, ['inaccurate', 'privacy', 'abuse', 'prohibited', 'other'], '举报原因')
    const detail = publicText(payload.detail, 1000, '举报说明')
    await takeLimit(actor, 'report', 10)
    if (detail) await safe(detail)
    const key = hash(`${actor}:${type}:${targetId}`)
    await store.transaction(async tx => {
      const target = await tx.get(C.content, targetId)
      if (!target || target.type !== type || target.status !== 'approved' || !sameScope(target, scope)) fail('not_found', '内容已不可用。')
      if (target.author_id === actor) fail('invalid_input', '不能举报自己的内容。')
      const existing = await tx.get(C.reports, key)
      if (existing?.status === 'pending') fail('duplicate', '你已举报这条内容，正在等待处理。')
      await tx.put(C.reports, key, { id: key, target_id: targetId, target_type: type, target_author_id: target.author_id, reporter_id: actor, school: target.school, campus: target.campus, reason, detail, status: 'pending', revision: (existing?.revision || 0) + 1, created_at: stamp(), updated_at: stamp() })
    })
    return { submitted: true }
  }
  async function applyReviewer(actor, payload) {
    const scope = await profileScope(actor)
    const reason = publicText(payload.reason, 1000, '申请理由', 10)
    await takeLimit(actor, 'reviewer_apply', 2)
    await safe(reason)
    let application
    await store.transaction(async tx => {
      const grant = await access(actor, tx)
      if (grant.reviewer) fail('already_reviewer', '当前账号已经拥有审核权限。')
      const previous = await tx.get(C.applications, actor)
      if (previous?.status === 'pending') fail('duplicate', '你已有一份待审核申请。')
      application = { id: actor, user_id: actor, ...scope, reason, status: 'pending', owner_note: '', applicant_response: '', revision: (previous?.revision || 0) + 1, created_at: stamp(), updated_at: stamp() }
      await tx.put(C.applications, actor, application)
    })
    return { application }
  }
  async function replyApplication(actor, payload) {
    if (id(payload.applicationId) !== actor) fail('forbidden', '不能修改其他人的申请。')
    const response = publicText(payload.response, 1000, '补充材料', 3)
    await takeLimit(actor, 'reviewer_reply', 5)
    await safe(response)
    let application
    await store.transaction(async tx => {
      const row = await tx.get(C.applications, actor)
      if (!row || row.status !== 'pending' || !row.owner_note) fail('state_changed', '申请已处理或暂不需要补充材料。')
      application = { ...row, applicant_response: response, revision: row.revision + 1, updated_at: stamp() }
      await tx.put(C.applications, actor, application)
    })
    return { application }
  }
  async function wallet(actor) {
    const value = await store.get(C.wallets, actor) || blankWallet()
    const ledger = await store.list(C.ledger, { user_id: actor }, { limit: 60 })
    return { wallet: { purchased: value.purchased, contribution: value.contribution, contributionDebt: value.contributionDebt }, ledger: ledger.map(({ _id, user_id, ...item }) => item) }
  }
  async function reviewAward(tx, actor, event, permission) {
    if (permission.owner) return
    const key = hash(`review:${event.target_type}:${event.target_id}`)
    if (await tx.get(C.ledger, key)) return
    const dailyId = hash(`review-day:${actor}:${day()}`)
    const daily = await tx.get(C.limits, dailyId)
    if ((daily?.count || 0) >= 20) return
    const value = await tx.get(C.wallets, actor) || blankWallet()
    const deduction = Math.min(value.contributionDebt, 3)
    value.contribution += 3 - deduction
    value.contributionDebt -= deduction
    await tx.put(C.wallets, actor, value)
    await tx.put(C.limits, dailyId, { count: (daily?.count || 0) + 1, created_at: stamp(), user_id: actor, action: 'review_award', window: day() })
    await tx.put(C.ledger, key, { id: key, user_id: actor, bean_type: 'contribution', entry_type: 'review_award', amount: 3 - deduction, debt_delta: -deduction, balance_after: value.contribution, debt_after: value.contributionDebt, reward_total: 3, moderation_event_id: event.id, reason: '校园审核完成奖励', created_at: stamp() })
  }
  async function recordReview(tx, actor, row, type, before, decision, reason, permission) {
    const key = hash(`${type}:${row.id}:${row.revision}`)
    const event = { id: key, actor_id: actor, target_type: type, target_id: row.id, school: row.school, campus: row.campus, from_status: before, to_status: row.status, after_revision: row.revision, decision, reason, created_at: stamp() }
    await tx.put(C.moderation, key, event)
    await reviewAward(tx, actor, event, permission)
    // 稳定抽样：每条非管理员审核约 10% 入样，重复调用不会改变抽样结果。
    const month = day().slice(0, 7)
    if (!permission.owner && parseInt(hash(`${month}:${actor}:${key}`).slice(0, 8), 16) % 10 === 0) {
      await tx.put(C.audits, key, { id: key, event, month, reviewer_id: actor, outcome: 'pending', owner_reason: '', created_at: stamp() })
    }
  }
  async function moderationQueue(actor, payload) {
    const permission = await access(actor)
    if (!permission.reviewer) fail('forbidden', '当前账号没有审核权限。')
    const scope = permission.owner ? {} : { school: permission.scope.school, ...(permission.scope.campus ? { campus: permission.scope.campus } : {}) }
    const offset = Math.max(0, Math.min(200, Number.isSafeInteger(payload.page) ? payload.page : 0)) * 30
    // 两类分别分页后合并，避免一个类型的积压把另一类型永久挤出。
    const [contents, reports] = await Promise.all([
      store.list(C.content, { ...scope, status: 'pending_review' }, { offset, limit: 31, direction: 'asc' }),
      store.list(C.reports, { ...scope, status: 'pending' }, { offset, limit: 31, direction: 'asc' }),
    ])
    const items = contents.slice(0, 30).filter(row => row.author_id !== actor).map(row => ({ type: row.type, item: publicContent(row) }))
    for (const report of reports.slice(0, 30)) {
      if ([report.reporter_id, report.target_author_id].includes(actor)) continue
      const target = await store.get(C.content, report.target_id)
      items.push({ type: 'report', item: { id: report.id, school: report.school, campus: report.campus, reason: report.reason, detail: report.detail, revision: report.revision, created_at: report.created_at, target: target ? publicContent(target) : null } })
    }
    return { items, hasMore: contents.length > 30 || reports.length > 30 }
  }
  async function moderate(actor, payload, report = false) {
    if (!(await access(actor)).reviewer) fail('forbidden', '当前账号没有审核权限。')
    const targetId = id(report ? payload.reportId : payload.targetId)
    const type = report ? 'report' : choice(payload.targetType, CONTENT_TYPES, '审核分类')
    const decision = choice(payload.decision, report ? ['remove', 'dismiss', 'resolve'] : ['approve', 'reject'], '审核决定')
    const reason = publicText(payload.reason, 500, '处理依据', 1)
    await takeLimit(actor, 'moderation', 200)
    await safe(reason)
    await store.transaction(async tx => {
      const table = report ? C.reports : C.content
      const row = await tx.get(table, targetId)
      revision(row, payload.revision)
      const permission = await reviewer(actor, row, tx)
      if (row.status !== (report ? 'pending' : 'pending_review') || (!report && row.type !== type)) fail('state_changed', '审核状态已变化，请刷新队列。')
      if (report) {
        const target = await tx.get(C.content, row.target_id)
        if (decision === 'remove') {
          revision(target, payload.targetRevision)
          if (target.type !== row.target_type || target.status !== 'approved') fail('state_changed', '原内容已变化，请刷新。')
          await reviewer(actor, target, tx)
          await tx.put(C.content, target.id, { ...target, status: 'removed', revision: target.revision + 1, updated_at: stamp() })
        }
      }
      const before = row.status
      row.status = report ? (decision === 'dismiss' ? 'dismissed' : 'resolved') : (decision === 'approve' ? 'approved' : 'rejected')
      row.revision += 1
      row.resolution = reason
      row.resolution_action = decision
      row.updated_at = stamp()
      await tx.put(table, targetId, row)
      await recordReview(tx, actor, row, type, before, decision, reason, permission)
    })
    return { processed: true }
  }
  async function decideApplication(actor, payload) {
    owner(actor)
    const key = id(payload.applicationId)
    if (key === actor) fail('self_review', '不能处理自己的申请。')
    const decision = choice(payload.decision, ['approve', 'decline', 'request_proof'], '申请决定')
    const reason = publicText(payload.reason, 1000, '处理说明', 1)
    const school = decision === 'approve' ? publicText(payload.school, 100, '授权学校', 1) : ''
    const campus = decision === 'approve' ? publicText(payload.campus, 100, '授权校区') : ''
    await safe(`${reason}\n${school}\n${campus}`)
    await store.transaction(async tx => {
      const row = await tx.get(C.applications, key)
      revision(row, payload.revision)
      if (row.status !== 'pending') fail('state_changed', '申请已经处理，请刷新。')
      if (decision === 'approve') {
        await registered(row.user_id, tx)
        const profile = await tx.get(C.profiles, row.user_id)
        if (!profile?.school) fail('profile_required', '申请人尚未填写学校。')
        await tx.put(C.grants, row.user_id, { active: true, school, campus, granted_by: actor, updated_at: stamp() })
      }
      await tx.put(C.applications, key, { ...row, status: decision === 'request_proof' ? 'pending' : decision === 'approve' ? 'approved' : 'declined', owner_note: reason, applicant_response: '', scope_school: school, scope_campus: campus, decided_by: actor, revision: row.revision + 1, updated_at: stamp() })
    })
    return { processed: true }
  }
  async function manageFeedback(actor, payload) {
    owner(actor)
    const key = id(payload.feedbackId)
    const status = choice(payload.status, ['pending', 'processing', 'resolved', 'not_adopted'], '处理进度')
    const visibility = choice(payload.visibility, ['public', 'hidden'], '可见范围')
    const reply = publicText(payload.reply, 2000, '公开回复')
    const reason = publicText(payload.publicReason, 1000, '处理说明', status === 'not_adopted' ? 1 : 0)
    const reward = payload.reward ?? null
    if (reward !== null && (!Number.isSafeInteger(reward) || reward < 0 || reward > 20 || status !== 'resolved')) fail('invalid_input', '仅已解决的建议可以发放 0–20 个贡献豆。')
    await safe(`${reply}\n${reason}`.trim() || '建议处理')
    await store.transaction(async tx => {
      const row = await tx.get(C.feedback, key)
      revision(row, payload.revision)
      if (row.author_id === actor && reward > 0) fail('self_reward', '不能奖励自己的建议。')
      if (row.reward_issued && reward !== null && reward !== row.reward_beans) fail('already_rewarded', '这条建议已经发过奖励，不能再次发放或修改金额。')
      if (!row.reward_issued && reward !== null) {
        const value = await tx.get(C.wallets, row.author_id) || blankWallet()
        value.contribution += reward
        const ledgerId = hash(`feedback:${key}`)
        if (await tx.get(C.ledger, ledgerId)) fail('already_rewarded', '这条建议已经发过奖励。')
        await tx.put(C.wallets, row.author_id, value)
        await tx.put(C.ledger, ledgerId, { id: ledgerId, user_id: row.author_id, bean_type: 'contribution', entry_type: 'feedback_award', amount: reward, debt_delta: 0, balance_after: value.contribution, debt_after: value.contributionDebt, feedback_id: key, reason: '建议处理奖励', created_at: stamp() })
        row.reward_issued = true
        row.reward_beans = reward
      }
      await tx.put(C.feedback, key, { ...row, status, visibility, public_reply: reply, public_reason: reason, handled_by: actor, revision: row.revision + 1, updated_at: stamp() })
    })
    return { processed: true }
  }
  async function resolveAudit(actor, payload) {
    owner(actor)
    const key = id(payload.auditId)
    if (typeof payload.correct !== 'boolean') fail('invalid_input', '请选择复核结论。')
    const reason = publicText(payload.reason, 1000, '复核依据', 1)
    await safe(reason)
    await store.transaction(async tx => {
      const row = await tx.get(C.audits, key)
      if (!row || row.outcome !== 'pending') fail('state_changed', '复核记录已经处理。')
      const event = row.event
      if (!payload.correct) {
        const ledgerKey = hash(`review:${event.target_type}:${event.target_id}`)
        const award = await tx.get(C.ledger, ledgerKey)
        const reversalId = hash(`reversal:${ledgerKey}`)
        if (award?.moderation_event_id === event.id && !await tx.get(C.ledger, reversalId)) {
          const value = await tx.get(C.wallets, event.actor_id) || blankWallet()
          const recover = Math.min(value.contribution, award.reward_total)
          const debt = award.reward_total - recover
          value.contribution -= recover
          value.contributionDebt += debt
          await tx.put(C.wallets, event.actor_id, value)
          await tx.put(C.ledger, reversalId, { id: reversalId, user_id: event.actor_id, bean_type: 'contribution', entry_type: 'audit_reversal', amount: -recover, debt_delta: debt, balance_after: value.contribution, debt_after: value.contributionDebt, reason, moderation_event_id: event.id, created_at: stamp() })
        }
        if (payload.reopen === true) {
          // 举报的下架操作还改变了目标内容；需人工核对，不能盲目恢复原内容。
          if (event.target_type === 'report') fail('invalid_input', '举报复核请先在云控制台核对关联原内容，再处理；不能自动重开。')
          const target = await tx.get(C.content, event.target_id)
          revision(target, event.after_revision)
          if (target.status !== event.to_status) fail('state_changed', '原内容已有新状态，不能直接重开。')
          await tx.put(C.content, target.id, { ...target, status: 'pending_review', revision: target.revision + 1, updated_at: stamp() })
        }
      }
      await tx.put(C.audits, key, { ...row, outcome: payload.correct ? 'correct' : 'incorrect', owner_reason: reason, reopened: !payload.correct && payload.reopen === true, audited_by: actor, audited_at: stamp() })
    })
    return { processed: true }
  }
  async function dispatch(actor, service, action, payload) {
    if (service === 'account' && action === 'login') return login(actor)
    if (service === 'community' && action === 'public_list') {
      const where = { visibility: 'public' }
      if (payload.status) where.status = choice(payload.status, ['pending', 'processing', 'resolved', 'not_adopted'], '进度')
      const offset = Math.max(0, Math.min(10000, Number.isSafeInteger(payload.offset) ? payload.offset : 0))
      const rows = await store.list(C.feedback, where, { offset, limit: 61, order: 'updated_at' })
      return { items: rows.slice(0, 60).map(publicFeedback), hasMore: rows.length > 60 }
    }
    await registered(actor)
    if (service === 'personal') return createPersonal({ store, registered, stamp })(actor, action, payload)
    if (service === 'account' && action === 'session') return { user: { id: actor, owner: isOwner(actor) } }
    if (service === 'profile') {
      if (action === 'profile_get') {
        const row = await store.get(C.profiles, actor)
        const { _id, ...profile } = row || blankProfile()
        return { profile }
      }
      if (action === 'profile_save') return saveProfile(actor, payload)
    }
    if (service === 'campus') {
      if (action === 'mine_list' || action === 'reports_mine') {
        const page = Math.max(0, Math.min(200, Number.isSafeInteger(payload.page) ? payload.page : 0))
        const rows = await store.list(action === 'mine_list' ? C.content : C.reports, action === 'mine_list' ? { author_id: actor } : { reporter_id: actor }, { offset: page * 40, limit: 41 })
        return { items: rows.slice(0,40).map(({ _id, author_id, reporter_id, target_author_id, ...row }) => row), hasMore: rows.length > 40 }
      }
      if (action === 'content_resubmit' || action === 'content_withdraw') {
        const key = id(payload.targetId)
        const title = action === 'content_resubmit' ? publicText(payload.title,100,'标题',2) : ''
        const body = action === 'content_resubmit' ? publicText(payload.body,3000,'内容',10) : ''
        await takeLimit(actor,'content_edit',10)
        if (title) await safe(`${title}\n${body}`)
        await store.transaction(async tx => {
          const row = await tx.get(C.content,key)
          revision(row,payload.revision)
          if (row.author_id !== actor) fail('forbidden','只能修改自己的投稿。')
          if (row.status === 'removed') fail('forbidden','已下架内容请联系管理员，不能自行恢复。')
          await tx.put(C.content,key,{...row,...(title ? {title,body} : {}),status:action === 'content_resubmit' ? 'pending_review' : 'withdrawn',resolution:'',revision:row.revision+1,updated_at:stamp()})
        })
        return { processed: true }
      }
      if (Object.hasOwn(LISTS, action)) return listContent(actor, action, payload)
      if (action === 'content_submit') return submitContent(actor, payload)
      if (action === 'content_report') return reportContent(actor, payload)
      if (action === 'governance_access') return access(actor)
      if (action === 'moderation_queue') return moderationQueue(actor, payload)
      if (action === 'moderation_decide') return moderate(actor, payload)
      if (action === 'report_resolve') return moderate(actor, payload, true)
    }
    if (service === 'community') {
      if (action === 'submit') return submitFeedback(actor, payload)
      if (action === 'wallet') return wallet(actor)
      if (action === 'reviewer_apply') return applyReviewer(actor, payload)
      if (action === 'reviewer_application_mine') return { application: await store.get(C.applications, actor) }
      if (action === 'reviewer_application_reply') return replyApplication(actor, payload)
    }
    if (service === 'admin') {
      owner(actor)
      const page = Math.max(0, Math.min(200, Number.isSafeInteger(payload.page) ? payload.page : 0))
      if (action === 'applications') return { items: await store.list(C.applications, { status: 'pending' }, { limit: 41, offset: page * 40, direction: 'asc' }) }
      if (action === 'feedback') return { items: await store.list(C.feedback, {}, { limit: 41, offset: page * 40, order: 'updated_at' }) }
      if (action === 'audits') return { items: await store.list(C.audits, { outcome: 'pending' }, { limit: 41, offset: page * 40, direction: 'asc' }) }
      if (action === 'reviewers') return { items: await store.list(C.grants, { active: true }, { limit: 41, offset: page * 40, order: 'updated_at' }) }
      if (action === 'application_decide') return decideApplication(actor, payload)
      if (action === 'feedback_manage') return manageFeedback(actor, payload)
      if (action === 'audit_resolve') return resolveAudit(actor, payload)
      if (action === 'reviewer_revoke') {
        const key = id(payload.userId)
        const reason = publicText(payload.reason, 1000, '撤销依据', 1)
        await safe(reason)
        await store.transaction(async tx => {
          const grant = await tx.get(C.grants, key)
          if (!grant) fail('not_found', '没有找到审核授权。')
          await tx.put(C.grants, key, { ...grant, active: false, revoked_by: actor, revocation_reason: reason, updated_at: stamp() })
        })
        return { processed: true }
      }
    }
    fail('invalid_action', '操作无效，请更新小程序后重试。')
  }
  return async (event, identity = {}) => {
    try {
      if (!identity.OPENID || !identity.APPID || identity.APPID !== appId) fail('unauthorized', '请从本小程序调用云服务。')
      if (!event || typeof event !== 'object' || JSON.stringify(event).length > 32768 || typeof event.service !== 'string' || typeof event.action !== 'string') fail('invalid_input', '请求格式不正确。')
      const payload = event.payload ?? {}
      if (typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_input', '请求内容无效。')
      const actor = hash(`${identity.APPID}:${identity.OPENID}`)
      return { ok: true, data: await dispatch(actor, event.service, event.action, payload) }
    } catch (error) {
      if (error instanceof ServiceError) return { ok: false, code: error.code, error: error.message }
      // 不返回数据库异常、云身份、原始输入或密钥。
      return { ok: false, code: 'service_unavailable', error: '云服务暂时不可用，请确认数据库集合、索引和云函数已配置。' }
    }
  }
}
module.exports = { createService, COLLECTIONS: C }
