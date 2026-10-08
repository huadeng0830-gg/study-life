// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ snapshots: new Map(), request: vi.fn() }))
vi.mock('../src/services/accountSync.js', () => ({ requestAccountSync: (...args) => fake.request(...args) }))
vi.mock('../src/composables/accountLocalData.js', async (original) => ({
  ...await original(),
  accountLocalSnapshot: vi.fn(async (id, values) => {
    if (values !== undefined) fake.snapshots.set(id, JSON.parse(JSON.stringify(values)))
    return fake.snapshots.get(id) && JSON.parse(JSON.stringify(fake.snapshots.get(id)))
  }),
}))
vi.mock('../src/composables/dataVault.js', async (original) => ({ ...await original(), mirrorLocalValue: vi.fn(async () => true), mirrorLocalValues: vi.fn(async () => true) }))
import { accountDefaultValues } from '../src/composables/accountLocalData.js'
import { accountUser } from '../src/composables/accountAuth.js'
import { localSafeMode } from '../src/composables/localSafeMode.js'
import { accountSyncPreparationError, accountSyncPreparing, setAccountDataOwner } from '../src/composables/accountSyncIdentity.js'
import { accountConflictKey, accountSyncConflicts, accountSyncError, accountSyncStatus } from '../src/composables/accountSyncState.js'
import { ACCOUNT_SYNC_COMMIT_KEY, readAccountLocalValues, recoverAccountSyncCommit, runAccountSync, startAccountSync, stopAccountSync } from '../src/composables/accountSyncEngine.js'
import { buildSyncManifest } from '../src/composables/syncMetadata.js'
import { restoreStoredValues, useStoredRef } from '../src/composables/store/cloudAccess.js'
const user = { id: 'fictional-account-a', email: 'student@example.test' }
let remote
let remoteRevision
let onPush
function envelope(values, tombstones = []) { return { format: 'study-life-sync', version: 3, values, manifest: buildSyncManifest(values, { tombstones }) } }
function clone(value) { return JSON.parse(JSON.stringify(value)) }
function response(value, status = 200) { return new Response(JSON.stringify(value), { status }) }
const tasks = () => useStoredRef('sl_tasks', [])
const task = (id, title) => ({ id, title, state: 'open' })
async function boot() { await startAccountSync(user.id); return runAccountSync() }

beforeEach(async () => {
  await stopAccountSync()
  localStorage.clear()
  localSafeMode.value = false
  fake.snapshots.clear()
  fake.request.mockReset()
  accountUser.value = user
  setAccountDataOwner(user.id)
  accountSyncPreparing.value = false
  accountSyncPreparationError.value = ''
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  remote = null; remoteRevision = 0; onPush = null
  await restoreStoredValues(accountDefaultValues(), { markChanged: false })
  fake.request.mockImplementation(async (operation, body) => {
    if (operation === 'pull') return response({ exists: Boolean(remote), revision: remote ? remoteRevision : null, data: remote && clone(remote) })
    if (onPush) { const callback = onPush; onPush = null; await callback(body) }
    if ((body.expectedRevision ?? 0) !== remoteRevision) return response({ conflict: true, exists: Boolean(remote), revision: remoteRevision }, 409)
    remote = clone(body.data); remoteRevision++
    return response({ ok: true, exists: true, revision: remoteRevision })
  })
})
afterEach(async () => {
  localSafeMode.value = false
  // 开关是每台设备的持久状态：不清掉的话，下一条用例会以"已关闭"开头，
  // 而它自己并没有关过 —— 那种泄漏会让夹具变得依赖执行顺序。
  const { setAccountSyncMode } = await import('../src/composables/accountSyncMode.js')
  setAccountSyncMode('account')
  await stopAccountSync()
  accountUser.value = null
  setAccountDataOwner('')
  vi.restoreAllMocks()
})

describe('按账号自动同步与内容保护', () => {
  it('首次登录上传本机记录，负载只包含同步业务数据', async () => {
    tasks().value = [task('local-task', '本机任务')]
    localStorage.setItem('study-life-auth', 'fictional-session')
    expect(await boot(), accountSyncError.value).toBe(true)
    expect(remote.values.sl_tasks.map(item => item.id)).toEqual(['local-task'])
    expect(JSON.stringify(remote)).not.toContain('fictional-session')
    expect(fake.request.mock.calls.at(-1)[1].accountUserId).toBe(user.id)
  })
  it('新设备自动获取云端记录，无需创建空间或扫码', async () => {
    const values = accountDefaultValues(); values.sl_tasks = [task('remote-task', '另一台设备任务')]
    remote = envelope(values); remoteRevision = 4
    expect(await boot(), accountSyncError.value).toBe(true)
    expect(tasks().value.map(item => item.id)).toEqual(['remote-task'])
    expect(remoteRevision).toBe(4)
    expect(accountSyncStatus.value).toBe('synced')
  })
  it('两边新增不同记录时自动合并，云端也保存合并结果', async () => {
    tasks().value = [task('local', '本机新增')]
    const values = accountDefaultValues(); values.sl_tasks = [task('remote', '云端新增')]
    remote = envelope(values); remoteRevision = 1
    expect(await boot(), accountSyncError.value).toBe(true)
    expect(tasks().value.map(item => item.id).sort()).toEqual(['local', 'remote'])
    expect(remote.values.sl_tasks.map(item => item.id).sort()).toEqual(['local', 'remote'])
  })
  it('重复检查无变化不会制造新版本', async () => {
    expect(await boot(), accountSyncError.value).toBe(true)
    const revision = remoteRevision
    expect(await runAccountSync(), accountSyncError.value).toBe(true)
    expect(remoteRevision).toBe(revision)
  })
  it('CAS 拒绝后重新读取和合并，不覆盖其他设备的新改动', async () => {
    tasks().value = [task('local', '本机新增')]
    onPush = () => { const values = accountDefaultValues(); values.sl_tasks = [task('other', '并发新增')]; remote = envelope(values); remoteRevision = 1 }
    expect(await boot(), accountSyncError.value).toBe(true)
    expect(remote.values.sl_tasks.map(item => item.id).sort()).toEqual(['local', 'other'])
  })
  it('同一条记录双边修改会暂停，确认后继续同步', async () => {
    tasks().value = [task('same', '原始任务')]
    await boot()
    tasks().value = [task('same', '本机修改')]
    const values = clone(remote.values); values.sl_tasks = [task('same', '云端修改')]
    remote = envelope(values); remoteRevision++
    expect(await runAccountSync()).toBe(false)
    expect(accountSyncStatus.value).toBe('conflict')
    expect(tasks().value[0].title).toBe('本机修改')
    const choice = accountConflictKey(accountSyncConflicts.value[0])
    expect(await runAccountSync({ [choice]: 'local' })).toBe(true)
    expect(remote.values.sl_tasks[0].title).toBe('本机修改')
    expect(accountSyncConflicts.value).toHaveLength(0)
  })
  it('确认期间内容再变动时需要重新审查冲突', async () => {
    tasks().value = [task('same', '原始任务')]; await boot()
    tasks().value = [task('same', '本机修改')]
    let values = clone(remote.values); values.sl_tasks = [task('same', '云端修改')]
    remote = envelope(values); remoteRevision++
    await runAccountSync()
    const choice = accountConflictKey(accountSyncConflicts.value[0])
    values = clone(remote.values); values.sl_tasks[0].title = '云端再次修改'; remote = envelope(values); remoteRevision++
    expect(await runAccountSync({ [choice]: 'local' })).toBe(false)
    expect(accountSyncConflicts.value[0].remote.title).toBe('云端再次修改')
    expect(tasks().value[0].title).toBe('本机修改')
  })
  it('删除记录生成同步墓碑，防止其他设备复活记录', async () => {
    tasks().value = [task('removed', '已删除任务')]; await boot()
    tasks().value = []
    expect(await runAccountSync(), accountSyncError.value).toBe(true)
    expect(remote.values.sl_tasks).toEqual([])
    expect(remote.manifest.tombstones.some(item => item.entityId === 'removed')).toBe(true)
  })
  it('请求期间的新本机编辑不会被旧响应覆盖', async () => {
    tasks().value = [task('local', '初版')]
    onPush = () => { tasks().value = [task('local', '请求期间的新编辑')]; window.dispatchEvent(new CustomEvent('study-life:sync-dirty')) }
    expect(await boot(), accountSyncError.value).toBe(true)
    expect(tasks().value[0].title).toBe('请求期间的新编辑')
    expect(remote.values.sl_tasks[0].title).toBe('请求期间的新编辑')
  })
  it('离线保留修改，联网后同步', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    tasks().value = [task('offline', '离线记录')]
    await boot()
    expect(fake.request).not.toHaveBeenCalled()
    expect(accountSyncStatus.value).toBe('offline')
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    expect(await runAccountSync(), accountSyncError.value).toBe(true)
    expect(remote.values.sl_tasks[0].id).toBe('offline')
  })
  it('退出或切换账号后丢弃迟到响应，保留本机记录', async () => {
    let resolveRequest
    fake.request.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve }))
    tasks().value = [task('private', '本机私人记录')]
    await startAccountSync(user.id)
    await vi.waitFor(() => expect(resolveRequest).toBeTypeOf('function'))
    accountUser.value = { id: 'fictional-account-b' }
    const stopped = stopAccountSync()
    resolveRequest(response({ exists: true, revision: 5, data: envelope(accountDefaultValues()) }))
    await stopped
    expect(tasks().value[0].id).toBe('private')
    expect(fake.request).toHaveBeenCalledTimes(1)
  })
  it('安全模式期间不上传或应用迟到的云端响应，关闭后可恢复', async () => {
    localSafeMode.value = true
    tasks().value = [task('safe-local', '安全模式记录')]
    expect(await runAccountSync()).toBe(false)
    expect(fake.request).not.toHaveBeenCalled()
    localSafeMode.value = false
    let resolveRequest
    fake.request.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve }))
    await startAccountSync(user.id)
    const syncing = runAccountSync()
    await vi.waitFor(() => expect(resolveRequest).toBeTypeOf('function'))
    localSafeMode.value = true
    resolveRequest(response({ exists: true, revision: 1, data: envelope(accountDefaultValues()) }))
    expect(await syncing).toBe(false)
    expect(tasks().value[0].id).toBe('safe-local')
    expect(fake.request).toHaveBeenCalledTimes(1)
    expect(accountSyncStatus.value).toBe('paused')
    localSafeMode.value = false
    expect(await runAccountSync()).toBe(true)
  })
  it('其他页面占用账号锁时等待，不并发应用数据', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn(async (_name, _options, action) => action(null)) } })
    expect(await boot()).toBe(false)
    expect(fake.request).not.toHaveBeenCalled()
    expect(accountSyncStatus.value).toBe('pending')
  })
  it('未恢复的提交阻止下一轮上传，保留当前记录', async () => {
    tasks().value = [task('safe-local', '尚未恢复的记录')]
    localStorage.setItem(ACCOUNT_SYNC_COMMIT_KEY, JSON.stringify({ id: user.id }))
    expect(await boot()).toBe(false)
    expect(fake.request).not.toHaveBeenCalled()
    expect(tasks().value[0].id).toBe('safe-local')
    expect(localStorage.getItem(ACCOUNT_SYNC_COMMIT_KEY)).not.toBeNull()
  })
  it('云端无效格式不会应用到本机', async () => {
    remote = { format: 'unexpected', values: {} }; remoteRevision = 3
    tasks().value = [task('safe', '保留记录')]
    expect(await boot()).toBe(false)
    expect(tasks().value[0].id).toBe('safe')
    expect(accountSyncStatus.value).toBe('error')
  })
  it('关掉「通过账号同步」后彻底不上传，再打开接着同步', async () => {
    // 判别力：只断言状态标签没有意义 —— 真正要守住的是**一个字节都不发出去**。
    // 所以这里盯三件事：请求数归零、本机改动留在原地、重新打开后照常同步。
    const { setAccountSyncMode } = await import('../src/composables/accountSyncMode.js')
    tasks().value = [task('before-off', '关掉之前就有的记录')]
    expect(await boot()).toBe(true)
    const pullsWhenOn = fake.request.mock.calls.length

    setAccountSyncMode('off')
    // 改动之后不许有任何一次请求（拉取、上传、轮询都不行）。
    tasks().value = [task('while-off', '关掉期间新增的记录')]
    await new Promise((wait) => setTimeout(wait, 30))
    expect(fake.request.mock.calls.length, '关掉之后仍发出了同步请求').toBe(pullsWhenOn)
    // 本机数据照常保存。
    expect(tasks().value.map((item) => item.id)).toEqual(['while-off'])

    // 打开之后恢复同步，且本机这次新增的内容被带上云端。
    setAccountSyncMode('account')
    await boot()
    expect(fake.request.mock.calls.length).toBeGreaterThan(pullsWhenOn)
    expect(remote.values.sl_tasks.map((item) => item.id)).toContain('while-off')
  })
  it('关掉之后即使有人直接调 runAccountSync 也不会偷偷上传', async () => {
    // 生命周期会停掉定时器，但已排进队列的那一轮、或别处的直接调用仍可能落进来。
    // 开关的语义是「不再把本机数据发出去」，多一发就是违约。
    const { setAccountSyncMode } = await import('../src/composables/accountSyncMode.js')
    await boot()
    const before = fake.request.mock.calls.length
    setAccountSyncMode('off')
    expect(await runAccountSync()).toBe(false)
    expect(fake.request.mock.calls.length).not.toBeGreaterThan(before)
    expect(accountSyncStatus.value).toBe('disabled')
  })
  it('云端 manifest 指纹错位不阻断同步：拉取并重算基线后自愈', async () => {
    // 这条对应真实故障：手机上登录后顶部常驻「☁ 账号同步暂未完成 · 云端数据校验未通过」，
    // 而同一账号在电脑上完全正常。
    //
    // 根因不是数据坏了：写侧是 validateSyncPayload **规范化之后**才 buildSyncManifest，
    // 拉取侧却拿**原始传输值**去核对指纹。只要有任一 sl_* 键走兼容转换，
    // 指纹就必然对不上；而 validateSyncManifest 把 drift 也标成 fatal，
    // 于是这台设备被永久挡在门外 —— 云端快照不换掉就再也同步不了。
    //
    // 判别力：把 isManifestDrift 去掉（本条会红），或把 fatalIssues 判据放宽成
    // "有 fatal 就停"（本条会红）。而下面那条"结构性问题仍然要拦"守住另一半。
    const cloudValues = accountDefaultValues()
    cloudValues.sl_tasks = [task('cloud-only', '云端独有的记录')]
    const cloud = envelope(cloudValues)
    // 只篡改 manifest 的指纹，值本身不动 —— 模拟"另一套口径算出来的 manifest"。
    for (const key of Object.keys(cloud.manifest.entities)) {
      for (const id of Object.keys(cloud.manifest.entities[key])) {
        cloud.manifest.entities[key][id] = { ...cloud.manifest.entities[key][id], hash: 'deadbeef' }
      }
    }
    remote = cloud; remoteRevision = 1

    expect(await boot(), '指纹错位不该让整台设备同步不了').toBe(true)
    expect(tasks().value.map((item) => item.id), '云端记录应当被拉下来').toContain('cloud-only')
    expect(accountSyncStatus.value).toBe('synced')
    // 自愈：这一轮会把重算过的 manifest 推回云端（mock 里 push 会替换 remote）。
    // 于是下一台设备再拉，拿到的就是自洽的 manifest，不会再撞同一个错。
    const written = remote.manifest.entities.sl_tasks['cloud-only']?.hash
    expect(written, '应当把重算后的 manifest 写回云端').toBeTruthy()
    expect(written).not.toBe('deadbeef')
  })
  it('manifest 结构本身不可信时仍然拦住，不放行', async () => {
    // 上面的放宽只针对"指纹 drift"，不是把校验关掉：entities 形状不对
    // 说明这份 manifest 根本没被正确生成过，放行等于放弃完整性闸门。
    const badValues = accountDefaultValues()
    badValues.sl_tasks = [task('x', '记录')]
    const cloud = envelope(badValues)
    cloud.manifest.entities = null
    remote = cloud; remoteRevision = 1
    tasks().value = [task('safe', '本机记录')]
    expect(await boot()).toBe(false)
    expect(tasks().value.map((item) => item.id)).toEqual(['safe'])
    expect(accountSyncStatus.value).toBe('error')
  })
  it('中断本机提交可恢复同步前记录和基线', async () => {
    const original = accountDefaultValues(); original.sl_tasks = [task('before', '提交前记录')]
    fake.snapshots.set('rollback:' + user.id, { values: original, meta: { version: 1, hasBaseline: false } })
    localStorage.setItem(ACCOUNT_SYNC_COMMIT_KEY, JSON.stringify({ id: user.id }))
    tasks().value = [task('partial', '不完整写入')]
    expect((await recoverAccountSyncCommit()).ok).toBe(true)
    expect((await readAccountLocalValues()).sl_tasks[0].id).toBe('before')
    expect(localStorage.getItem(ACCOUNT_SYNC_COMMIT_KEY)).toBeNull()
  })
})
