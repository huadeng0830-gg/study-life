import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'
import { useScopedProjectAction } from '../src/composables/projects/useScopedProjectAction.js'

/** 虚构身份：账号 + 当前项目，和 ProjectsView 的 projectContext 读法是同一条链。 */
function setup({ identity = { account: 'fictional-account', project: 'fictional-a' } } = {}) {
  const context = createCollaborationContext(() => [identity.account, identity.project])
  const busy = context.state('')
  const notify = vi.fn()
  const reload = vi.fn(async () => {})
  const action = useScopedProjectAction({ context, busy, reload, notify, describeError: (error) => error?.message || '' })
  return { identity, context, busy, notify, reload, action }
}

describe('useScopedProjectAction：作用域化动作的四条路径', () => {
  it('成功：租约只在自己手里亮着，成功文案、收尾、重载各跑一次', async () => {
    const fixture = setup()
    let release
    const operation = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const commit = vi.fn(async () => {})
    const pending = fixture.action.run({ busyValue: 'archive', operation, success: '项目已归档。', commit })
    expect(fixture.busy.value).toBe('archive')
    expect(fixture.reload).not.toHaveBeenCalled()
    release({ ok: true })
    await expect(pending).resolves.not.toBe(false)
    expect(operation).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledOnce()
    expect(fixture.notify).toHaveBeenCalledWith('success', '项目已归档。')
    expect(fixture.reload).toHaveBeenCalledOnce()
    expect(fixture.busy.value, '动作结束后必须释放租约').toBe('')
  })

  it('失败：只提示一次错误、不碰成功路径，并且照样释放租约', async () => {
    const fixture = setup()
    const commit = vi.fn()
    const outcome = await fixture.action.run({
      busyValue: 'delete', operation: async () => { throw new Error('虚构的服务端拒绝') }, success: '不会显示。', commit,
    })
    expect(outcome).toBe(false)
    expect(fixture.notify).toHaveBeenCalledTimes(1)
    expect(fixture.notify).toHaveBeenCalledWith('error', '虚构的服务端拒绝')
    expect(commit).not.toHaveBeenCalled()
    expect(fixture.reload).not.toHaveBeenCalled()
    expect(fixture.busy.value).toBe('')
  })

  it('并发重复触发：第二个动作被门闩挡下，不会清掉第一个动作的租约', async () => {
    const fixture = setup()
    let release
    const first = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const second = vi.fn(async () => '不该执行')
    const pending = fixture.action.run({ busyValue: 'invite-friend', operation: first })
    await expect(fixture.action.run({ busyValue: 'invite-friend', operation: second })).resolves.toBe(false)
    expect(second).not.toHaveBeenCalled()
    release({ ok: true })
    await pending
    expect(fixture.busy.value, '第一个动作结束后租约归还，新动作可以再进来').toBe('')
    await expect(fixture.action.run({ busyValue: 'invite-friend', operation: async () => 'ok' })).resolves.toBe('ok')
  })

  it('身份过期：持过期守卫时连请求都不发；请求途中换账号则丢弃结果、不提示也不重载', async () => {
    const fixture = setup()
    const staleGuard = fixture.context.capture()
    fixture.context.invalidate()
    const stale = vi.fn(async () => { throw new Error('旧账号的错误') })
    await expect(fixture.action.run({ current: staleGuard, operation: stale, success: '不会显示。' })).resolves.toBe(false)
    expect(stale, '身份已经过期时不得发出请求').not.toHaveBeenCalled()
    expect(fixture.notify).not.toHaveBeenCalled()

    const inFlight = setup()
    let release
    const operation = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const commit = vi.fn()
    const pending = inFlight.action.run({ busyValue: 'adjustment:x', operation, commit, success: '不该显示。' })
    inFlight.identity.account = 'fictional-replacement'
    inFlight.context.invalidate()
    release({ ok: true })
    await pending
    expect(operation).toHaveBeenCalledOnce()
    expect(commit, '换账号后旧响应不许提交').not.toHaveBeenCalled()
    expect(inFlight.notify).not.toHaveBeenCalled()
    expect(inFlight.reload).not.toHaveBeenCalled()
    expect(inFlight.busy.value).toBe('')
  })

  it('身份来回切换（A→B→A）也不认旧响应', async () => {
    const fixture = setup()
    const guard = fixture.context.capture()
    fixture.context.invalidate()
    expect(guard(), 'invalidate 之后即使身份读值相同也必须过期').toBe(false)
    const operation = vi.fn()
    await expect(fixture.action.run({ current: guard, operation })).resolves.toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it('旧动作的 finally 不能清掉新访问里正在进行的动作', async () => {
    const fixture = setup()
    let finishOld
    const old = fixture.action.run({ busyValue: 'old', operation: () => new Promise((resolve) => { finishOld = resolve }) })
    fixture.context.invalidate()
    let finishNew
    const next = fixture.action.run({ busyValue: 'new', operation: () => new Promise((resolve) => { finishNew = resolve }) })
    expect(fixture.busy.value).toBe('new')
    finishOld()
    await old
    expect(fixture.busy.value, '旧动作不许释放新动作的租约').toBe('new')
    finishNew()
    await next
    expect(fixture.busy.value).toBe('')
  })
})

describe('useScopedProjectAction：门闩、校验与自定义租约', () => {
  it('check 返回字符串时按错误提示处理，且不进入请求', async () => {
    const fixture = setup()
    const operation = vi.fn()
    await expect(fixture.action.run({ check: () => '请填写具体验收意见。', operation })).resolves.toBe(false)
    expect(fixture.notify).toHaveBeenCalledWith('error', '请填写具体验收意见。')
    expect(operation).not.toHaveBeenCalled()
  })

  it('check 返回 false 时静默中止（调用点自己决定要不要提示）', async () => {
    const fixture = setup()
    const operation = vi.fn()
    await expect(fixture.action.run({ check: () => false, operation })).resolves.toBe(false)
    expect(fixture.notify).not.toHaveBeenCalled()
    expect(operation).not.toHaveBeenCalled()
  })

  it('可以让出表单自己的布尔忙态 ref，且默认重载可换成别的或关掉', async () => {
    const fixture = setup()
    const formBusy = ref(false)
    const otherReload = vi.fn(async () => {})
    const outcome = await fixture.action.run({
      busy: formBusy, current: fixture.context.capture(), operation: async () => 'saved',
      reload: otherReload, success: '已保存。',
    })
    expect(outcome).toBe('saved')
    expect(formBusy.value, '布尔租约释放回 false').toBe(false)
    expect(otherReload).toHaveBeenCalledOnce()
    expect(fixture.reload, '显式给了 reload 就不再用默认重载').not.toHaveBeenCalled()

    const untouched = vi.fn()
    await fixture.action.run({ busy: formBusy, operation: async () => 'ok', reload: false, success: 'ok' })
    expect(untouched).not.toHaveBeenCalled()
  })

  it('operation 抛错时才用自定义 onError，静默错误（describeError 返回空串）仍然静默', async () => {
    const fixture = setup()
    const onError = vi.fn()
    await fixture.action.run({ operation: async () => { throw new Error('自定义') }, onError, success: 'x' })
    expect(onError).toHaveBeenCalledOnce()
    expect(fixture.notify).not.toHaveBeenCalled()

    const silent = setup()
    const quiet = useScopedProjectAction({
      context: silent.context, busy: silent.busy, reload: silent.reload, notify: silent.notify,
      describeError: () => '',
    })
    await quiet.run({ operation: async () => { throw new Error('project_context_changed') }, success: 'x' })
    expect(silent.notify, 'describeError 返回空串时 notify 收到空文案，等于静默').toHaveBeenCalledWith('error', '')
  })
})