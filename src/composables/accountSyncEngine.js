// 账号同步独立运行；仅复用纯数据校验/合并规则和可回滚的本机存储接口。
import { accountUser } from './accountAuth.js'
import { localSafeMode } from './localSafeMode.js'
import { accountSyncActive, randomToken, readAccountDataOwner } from './accountSyncIdentity.js'
import { accountSyncViaAccount } from './accountSyncMode.js'
import { accountDefaultValues, accountLocalSnapshot, ACCOUNT_DATA_LOCK } from './accountLocalData.js'
import { accountConflictKey, accountSyncConflicts, accountSyncError, accountSyncLastSyncedAt, accountSyncStatus } from './accountSyncState.js'
import { SYNC_DEFAULTS, SYNC_KEYS, assertValidSyncPayload, cloneValue, validateSyncPayload } from './accountSyncData.js'
import { buildEntityManifest, buildSyncManifest, hashSyncValue, mergeRestoreMarkers, stableEntityId, validateStableEntityIds, validateSyncManifest } from './syncMetadata.js'
import { mergeSyncPayload } from './syncMerge.js'
import { validateAndRepairRelations } from './syncIntegrity.js'
import { requestAccountSync } from '../services/accountSync.js'
import { ACCOUNT_SYNC_DATA_SCHEMA_VERSION } from './accountSyncSchema.js'

export const ACCOUNT_SYNC_POLL_MS = 60000
export const ACCOUNT_SYNC_DEBOUNCE_MS = 4000
export const ACCOUNT_SYNC_COMMIT_KEY = 'study-life-account-sync-commit'
// 待确认冲突的落盘键前缀（后面拼账号 id）。
const PENDING_CONFLICT_KEY = 'conflict:'
const BACKOFF = [5000, 15000, 30000, 60000, 300000]
// 连续失败超过这个次数之后就不再按 BACKOFF 轮询，而是退化到"很久一次"。
// 原因：BACKOFF 的末档是 5 分钟，而失败计数只在成功时归零 —— 于是**确定性**
// 的失败（数据校验不过、本机副本损坏、超过 16MB 上限）会永远每 5 分钟
// 醒一次，既耗电又没有任何进展可能。用户要的是"别再烦我"，不是"一直重试"。
const FAILURE_GIVE_UP_AFTER = 8
const FAILURE_IDLE_MS = 20 * 60 * 1000
const AUTO_RESUME_BLOCKED_STATES = new Set(['error', 'conflict', 'paused', 'disabled', 'signed-out'])
// 云端单条快照上限（见 supabase/migrations 的 account_snapshot_format 约束）。
// 推送之前自己先量一次：超了就是本地数据问题，云端每次都会用同样的 400 拒回来。
const ACCOUNT_PAYLOAD_LIMIT = 16 * 1024 * 1024
let owner = ''
let generation = 0
let running = null
let timer = null
let poll = null
let controller = null
let failureCount = 0
let localSequence = 0
let pendingSignature = ''
let lastSuccessfulSync = null
let unbind = null
/** 本轮是否发现云端 manifest 与它的值对不上（版本错位）。用来强制回写一次修好的 manifest。 */
let manifestDrifted = false

/**
 * 失败之后安排下一次尝试。
 *
 * 原先只有"普通错误"才走这里，而 401/403/400 被**特意跳过**了退避 ——
 * 看起来像是在避免无谓重试，实际效果正相反：那三种状态压根没有退避，
 * 于是 60 秒一次的轮询会**永远**重新发一次注定失败的请求，横幅也永远不消。
 * 现在统一由这里决定：确定性失败（fatal）只留一条很长的兜底，
 * 其余照常退避，401 额外给一次短重试让令牌有机会刷新。
 */
function scheduleFailure(error, { fatal = false, retrySoon = false } = {}) {
  if (fatal) { schedule(FAILURE_IDLE_MS); return }
  if (retrySoon) { schedule(2000); return }
  const delay = failureCount > FAILURE_GIVE_UP_AFTER ? FAILURE_IDLE_MS : BACKOFF[Math.min(failureCount++, BACKOFF.length - 1)]
  schedule(delay)
}

function online() { return navigator.onLine !== false }
function assertCurrent(id, revision) {
  if (localSafeMode.value) {
    const error = new Error('本机安全模式已暂停账号同步。')
    error.code = 'ACCOUNT_SYNC_PAUSED'
    throw error
  }
  if (generation !== revision || owner !== id || accountUser.value?.id !== id || readAccountDataOwner() !== id) {
    const error = new Error('账号已变更，本次同步已停止。')
    error.code = 'ACCOUNT_SYNC_STALE'
    throw error
  }
}
function setState(state, error = '') { accountSyncStatus.value = state; accountSyncError.value = error }
function clearTimers() { window.clearTimeout(timer); window.clearInterval(poll); timer = null; poll = null }
async function localValues() {
  const { flushStoredWrites, useStoredRef } = await import('./store/cloudAccess.js')
  flushStoredWrites()
  const values = Object.fromEntries(SYNC_KEYS.map((key) => [key, cloneValue(useStoredRef(key, cloneValue(SYNC_DEFAULTS[key])).value)]))
  assertValidSyncPayload(values)
  if (validateStableEntityIds(values).length) throw new Error('本机记录缺少稳定编号，请在数据管理中修复后再同步。')
  return values
}
function emptyMeta() { return { version: 1, hasBaseline: false, baseline: { entities: {}, singletons: {} }, tombstones: [], restoreMarkers: [], revision: null, lastSyncedAt: '' } }
async function loadMeta(id) {
  const saved = await accountLocalSnapshot('metadata:' + id)
  return saved?.version === 1 ? { ...emptyMeta(), ...saved } : emptyMeta()
}
function mergeTombstones(...groups) {
  const result = new Map()
  for (const item of groups.flat()) {
    if (!item?.entityType || item.entityId === undefined || !item.tombstoneId) continue
    const key = item.entityType + ':' + item.entityId
    const previous = result.get(key)
    if (!previous || String(item.deletedAt || '') > String(previous.deletedAt || '')) result.set(key, cloneValue(item))
  }
  return [...result.values()]
}
function currentTombstones(values, meta) {
  const result = mergeTombstones(meta.tombstones)
  const present = new Set(result.map((item) => item.entityType + ':' + item.entityId))
  for (const [key, entries] of Object.entries(meta.baseline.entities || {})) {
    const ids = new Set((values[key] || []).map((item) => stableEntityId(key, item)))
    for (const [id, entry] of Object.entries(entries)) {
      const marker = entry.entityType + ':' + id
      if (ids.has(id) || present.has(marker)) continue
      result.push({ tombstoneId: randomToken(), entityType: entry.entityType, entityId: id,
        deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), baseHash: entry.hash, revision: 1 })
    }
  }
  return result
}
function acknowledgedLocalBaseline(meta, local, sent) {
  const baseline = cloneValue(meta.hasBaseline ? meta.baseline : buildEntityManifest(accountDefaultValues()))
  const localManifest = buildEntityManifest(local)
  const sentManifest = buildEntityManifest(sent)
  for (const [key, entries] of Object.entries(localManifest.entities)) {
    baseline.entities[key] ??= {}
    for (const [id, entry] of Object.entries(entries)) {
      if (entry.hash === sentManifest.entities[key]?.[id]?.hash) baseline.entities[key][id] = entry
    }
    for (const id of Object.keys(baseline.entities[key])) {
      if (!entries[id] && !sentManifest.entities[key]?.[id]) delete baseline.entities[key][id]
    }
  }
  for (const [key, hash] of Object.entries(localManifest.singletons)) {
    if (hash === sentManifest.singletons[key]) baseline.singletons[key] = hash
  }
  return baseline
}
function signature(conflicts) {
  return hashSyncValue(conflicts.map((item) => ({ key: accountConflictKey(item), local: item.local, remote: item.remote, reason: item.reason })))
}

/**
 * 估算序列化后的字节数。
 *
 * 刻意用 TextEncoder 而不是 Blob：Blob 在部分 WebView 上构造失败会直接抛，
 * 而这里只是给一个上限判断，不值得为了它把整条同步链路炸掉。
 */
function estimatePayloadBytes(payload) {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length
  } catch {
    return 0
  }
}
function decideConflicts(merge, choices, tombstones, markers) {
  for (const conflict of merge.conflicts) {
    const choice = choices[accountConflictKey(conflict)]
    if (!['local', 'remote'].includes(choice)) throw new Error('请为每一处冲突选择保留本机或使用云端。')
    const value = conflict[choice]
    if (!conflict.entityType) { merge.values[conflict.key] = cloneValue(value); continue }
    const id = String(conflict.entityId)
    const list = merge.values[conflict.key] || []
    const filtered = conflict.reason === 'same-bill-period-different-fact'
      ? list.filter((item) => item.billId + ':' + item.billingPeriodKey !== id)
      : list.filter((item) => stableEntityId(conflict.key, item) !== id)
    if (value !== undefined) {
      filtered.push(cloneValue(value))
      for (const tombstone of tombstones.filter((item) => item.entityType === conflict.entityType && String(item.entityId) === id)) {
        markers.push({ version: 1, entityType: conflict.entityType, entityId: id, tombstoneId: tombstone.tombstoneId, operationId: randomToken() })
      }
      tombstones = tombstones.filter((item) => item.entityType !== conflict.entityType || String(item.entityId) !== id)
    }
    merge.values[conflict.key] = filtered
  }
  return { values: validateAndRepairRelations(merge.values).values, tombstones, markers }
}
async function provider(operation, body, id, revision) {
  assertCurrent(id, revision)
  controller = new AbortController()
  const timeout = window.setTimeout(() => controller?.abort(), 45000)
  try {
    const response = await requestAccountSync(operation, { ...body, accountUserId: id }, controller.signal)
    assertCurrent(id, revision)
    const result = await response.json()
    if (!response.ok && !result.conflict) {
      const error = new Error(result.error || '账号同步暂时不可用。')
      error.status = response.status
      throw error
    }
    return result
  } finally { window.clearTimeout(timeout); controller = null }
}
async function cycle(id, revision, choices) {
  // 每轮重置：drift 是"这一轮拉到的快照"的状态，不是设备的持久属性。
  manifestDrifted = false
  if (localStorage.getItem(ACCOUNT_SYNC_COMMIT_KEY)) {
    const recovered = await recoverAccountSyncCommit()
    if (!recovered.ok) throw recovered.error
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    assertCurrent(id, revision)
    setState('checking')
    const meta = await loadMeta(id)
    assertCurrent(id, revision)
    const probe = await provider('probe', {}, id, revision)
    // An unchanged local mutation sequence and unchanged remote revision prove
    // that the last validated/merged payload is still current. Probe metadata
    // only, so a 60-second poll does not download or parse a multi-megabyte snapshot.
    if (!choices && probe.exists && lastSuccessfulSync?.owner === id
      && lastSuccessfulSync.revision === probe.revision
      && lastSuccessfulSync.localSequence === localSequence
      && !pendingSignature) {
      setState('synced')
      return true
    }
    const remote = probe.exists ? await provider('pull', {}, id, revision) : probe
    const local = await localValues()
    assertCurrent(id, revision)
    const sequence = localSequence
    const localTombstones = currentTombstones(local, meta)
    let values = local
    let tombstones = localTombstones
    let markers = meta.restoreMarkers
    if (remote.exists) {
      if (remote.data?.format !== 'study-life-sync' || remote.data.version !== 3 || !remote.data.manifest) throw new Error('云端同步数据格式异常，本机记录已保留。')
      const remoteSchemaVersion = Number(remote.data.manifest.schemaVersion) || 1
      if (remoteSchemaVersion > ACCOUNT_SYNC_DATA_SCHEMA_VERSION) {
        throw new Error('云端数据由更新版本的应用写入。请先更新应用，再继续同步；本机数据已保留。')
      }
      // manifest 校验原始传输值；规范化之后的合法兼容转换可能改变旧设置的指纹。
      assertValidSyncPayload(remote.data.values)
      const manifestIssues = validateSyncManifest(remote.data.values, remote.data.manifest)
      const fatalIssues = manifestIssues.filter((item) => item.fatal && !isManifestDrift(item))
      if (fatalIssues.length) throw new Error('云端数据校验未通过，本机记录已保留。')
      if (manifestIssues.some(isManifestDrift)) {
        manifestDrifted = true
        // 【指纹对不上 ≠ 数据坏了 —— 这里是"版本错位"，原来当成"损坏"处理，
        //   结果是把一台设备永久挡在门外】
        //
        // 写侧是 `values = validateSyncPayload(values)` 之后才 buildSyncManifest，
        // 也就是 manifest 建立在**规范化后**的值上；而这里校验用的是**原始传输值**。
        // 只要有任何一个 sl_* 键存在合法兼容转换（把旧形状迁到新形状），
        // 两边的指纹就必然不同。写快照的那台设备自己不会撞上这个错（它的本机数据
        // 早已规范化），所以"电脑好好的、手机一直报校验未通过"完全说得通 ——
        // 而这里把 drift 判成 fatal，于是**这台手机再也同步不了**。
        //
        // 为什么可以放行：
        //   1. 指纹只说明"这份 manifest 是另一套口径算出来的"，说明不了值被改过；
        //   2. 值本身有三道独立闸门：assertValidSyncPayload、validateSyncPayload，
        //      以及 mergeSyncPayload 内部的 validateStableEntityIds；
        //   3. mergeSyncPayload **自己**从 remoteValues 重建远端 manifest
        //      （见 syncMerge.js 签名，它根本不接收远端 manifest），
        //      所以拉下来的 manifest 在这里只承担"挡住不可信数据"一件事。
        // 而且这一轮同步成功后会把重新算好的 manifest 推回云端，问题随即自愈。
      }
      const remoteValues = validateSyncPayload(remote.data.values)
      const remoteTombstones = remote.data.manifest.tombstones || []
      const remoteMarkers = remote.data.manifest.restoreMarkers || []
      const defaults = accountDefaultValues()
      defaults.sl_festive_config.installDate = local.sl_festive_config?.installDate || ''
      const merge = mergeSyncPayload({ baseManifest: meta.hasBaseline ? meta.baseline : buildEntityManifest(defaults),
        localValues: local, remoteValues, localTombstones, remoteTombstones, remoteRestoreMarkers: remoteMarkers, keys: SYNC_KEYS })
      tombstones = mergeTombstones(localTombstones, remoteTombstones)
      markers = mergeRestoreMarkers(meta.restoreMarkers, remoteMarkers)
      const restored = new Set(markers.map((item) => item.tombstoneId))
      tombstones = tombstones.filter((item) => !restored.has(item.tombstoneId))
      if (merge.conflicts.length) {
        const currentSignature = signature(merge.conflicts)
        if (!choices || pendingSignature !== currentSignature) {
          accountSyncConflicts.value = merge.conflicts
          pendingSignature = currentSignature
          setState('conflict', choices ? '本机或云端内容有新变化，请重新确认冲突。' : '')
          // 把待确认的冲突落盘。iOS 会在后台几分钟后直接杀掉 PWA，
          // 而 pendingSignature / accountSyncConflicts 原本只活在内存里 ——
          // 用户离开去想一想，回来时选择已经没了，得从头再选一遍。
          // 冲突状态还会让 60 秒轮询整个停摆（见 startAccountSync 的判断），
          // 所以这里必须能在下次冷启动时把它捡回来。
          await rememberPendingConflicts(id, currentSignature, merge.conflicts)
          return false
        }
        const decided = decideConflicts(merge, choices, tombstones, markers)
        values = decided.values; tombstones = decided.tombstones; markers = decided.markers
      } else values = merge.values
    }
    values = validateSyncPayload(values)
    assertValidSyncPayload(values)
    if (validateStableEntityIds(values).length) throw new Error('合并后的记录编号异常，本次未应用。')
    const manifest = buildSyncManifest(values, { tombstones, restoreMarkers: markers, schemaVersion: ACCOUNT_SYNC_DATA_SCHEMA_VERSION })
    // 不把设备名或生成时间当成业务更改；无变化时不制造新版本。
    const same = remote.exists && !manifestDrifted
      && hashSyncValue(values) === hashSyncValue(remote.data.values)
      && hashSyncValue(tombstones) === hashSyncValue(remote.data.manifest.tombstones || [])
      && hashSyncValue(markers) === hashSyncValue(remote.data.manifest.restoreMarkers || [])
    // manifestDrifted 时即使**值**一模一样也要回写一次：那份 manifest 是错的，
    // 留着的话每台新设备都要再撞一次同一个校验失败，而值不变会让"无变化就不推"
    // 这条优化把它永远冻在坏状态。版本号会 +1，这是有意的一次性修复开销。
    if (sequence !== localSequence) continue
    let acknowledged = remote
    if (!same) {
      const payload = { format: 'study-life-sync', version: 3, values, manifest }
      // 推送前先自己量一次大小。云端的 16MB 上限是一个**确定性**拒绝：
      // 不先量的话，每次推送都被同一个约束打回，横幅常驻，
      // 而且 60 秒轮询会一直重试一件永远不会成功的事。
      if (estimatePayloadBytes(payload) > ACCOUNT_PAYLOAD_LIMIT) {
        const tooBig = new Error('本机数据超过 16MB 的云端上限，已停止上传以免一直重试。请在数据管理中导出备份并清理较大的图片或附件后重试。')
        tooBig.fatal = true
        throw tooBig
      }
      setState('syncing')
      acknowledged = await provider('push', { data: payload,
        expectedRevision: remote.revision ?? null, deviceName: '三两事设备' }, id, revision)
      if (acknowledged.conflict) { choices = null; continue }
      if (!acknowledged.ok || !Number.isSafeInteger(acknowledged.revision)) throw new Error('云端未确认同步版本，请稍后重试。')
    }
    // 请求期间发生编辑时，只确认本机已提交且未被远端改写的基线部分；
    // 尚未应用的远端新增记录不能进入本机基线，否则会被误判为本机删除。
    if (sequence !== localSequence) {
      assertCurrent(id, revision)
      await accountLocalSnapshot('metadata:' + id, { ...meta, hasBaseline: true,
        baseline: acknowledgedLocalBaseline(meta, local, values), tombstones, restoreMarkers: markers, revision: acknowledged.revision })
      continue
    }
    const nextMeta = { version: 1, hasBaseline: true, baseline: buildEntityManifest(values), tombstones, restoreMarkers: markers,
      revision: acknowledged.revision, lastSyncedAt: new Date().toISOString() }
    if (hashSyncValue(values) !== hashSyncValue(local)) {
      await accountLocalSnapshot('rollback:' + id, { values: local, meta })
      assertCurrent(id, revision)
      if (sequence !== localSequence) continue
      localStorage.setItem(ACCOUNT_SYNC_COMMIT_KEY, JSON.stringify({ id }))
      const { restoreStoredValues } = await import('./store/cloudAccess.js')
      assertCurrent(id, revision)
      if (sequence !== localSequence) { localStorage.removeItem(ACCOUNT_SYNC_COMMIT_KEY); continue }
      await restoreStoredValues(values, { markChanged: false })
      // 账号切换会等待本次提交；一旦应用开始，完整保存基线后再允许切换。
      await accountLocalSnapshot('metadata:' + id, nextMeta)
      localStorage.removeItem(ACCOUNT_SYNC_COMMIT_KEY)
    } else {
      await accountLocalSnapshot('metadata:' + id, nextMeta)
    }
    assertCurrent(id, revision)
    accountSyncLastSyncedAt.value = nextMeta.lastSyncedAt
    accountSyncConflicts.value = []
    pendingSignature = ''
    lastSuccessfulSync = { owner: id, revision: acknowledged.revision, localSequence: sequence }
    await clearPendingConflicts(id)
    failureCount = 0
    setState('synced')
    if (sequence !== localSequence) schedule(ACCOUNT_SYNC_DEBOUNCE_MS)
    return true
  }
  throw new Error('数据正在其他设备上更新，稍后会继续同步。')
}
function schedule(delay) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { timer = null; void runAccountSync() }, delay)
}
export function runAccountSync(choices = null) {
  if (running) return running
  if (localSafeMode.value) { setState('paused'); return Promise.resolve(false) }
  // 【用户关掉账号同步之后，这里必须彻底停手】
  // 生命周期会调 stopAccountSync() 清掉定时器，但已经排进队列的那一轮、
  // 以及任何来自别处的直接调用仍可能落到这个函数上。返回之前必须再确认一次 ——
  // 开关的语义是「不再把本机数据发出去」，多一发就是违约。
  // 刻意**不**安排重试：这是一个稳定的用户决定，不是需要退避重试的故障。
  if (!accountSyncViaAccount.value) { setState('disabled'); return Promise.resolve(false) }
  if (!owner) return Promise.resolve(false)
  // 【原来这里是静默返回】守卫不通过时既不改状态、也不安排下一次尝试，
  // 于是这一次唤醒（来自轮询、退避、focus）就被白白消耗掉，
  // 状态永远停在触发它的那一条（'error' / 'offline'）。
  // 现在：没有归属可同步时保持静默（那是正常状态），
  // 但只要**本会话确实归这个账号**，就必须排上后续尝试，
  // 否则手机上那条横幅就成了没有出路的死胡同。
  if (!accountSyncActive.value) { if (generation === 0) return Promise.resolve(false); schedule(ACCOUNT_SYNC_DEBOUNCE_MS); return Promise.resolve(false) }
  if (!online()) { setState('offline'); schedule(ACCOUNT_SYNC_POLL_MS); return Promise.resolve(false) }
  const id = owner
  const revision = generation
  running = (async () => {
    try {
      if (navigator.locks?.request) {
        return await navigator.locks.request(ACCOUNT_DATA_LOCK, { ifAvailable: true }, (lock) => {
          if (lock) return cycle(id, revision, choices)
          setState('pending'); schedule(ACCOUNT_SYNC_DEBOUNCE_MS)
          return false
        })
      }
      return await cycle(id, revision, choices)
    } catch (error) {
      if (localStorage.getItem(ACCOUNT_SYNC_COMMIT_KEY)) {
        const recovered = await recoverAccountSyncCommit()
        if (!recovered.ok) {
          setState('error', '同步提交与自动恢复尚未完成，请先导出本机记录并重试。')
          // 原来这里直接 return：既没有退避，也没有任何重试。
          // 提交标记留在 localStorage 里直到恢复成功为止，所以必须自己再试，
          // 否则这一次失败之后永远不会再有人来看它。
          scheduleFailure(error)
          return false
        }
      }
      if (error?.code === 'ACCOUNT_SYNC_STALE' || generation !== revision) return false
      if (error?.code === 'ACCOUNT_SYNC_PAUSED') { setState('paused'); return false }
      // iOS 在切走 PWA 时会冻结 fetch 与 setTimeout；回来之后那个到期的
      // 45 秒超时立刻触发，抛出的是英文原文 "The user aborted a request."。
      // 这**不是**错误，只是用户切走了 —— 当成一次待办，立刻续上，
      // 否则每次切后台都会在顶部留一条看不懂的红色横幅。
      if (error?.name === 'AbortError') { setState('pending'); schedule(ACCOUNT_SYNC_DEBOUNCE_MS); return false }
      setState('error', error instanceof Error ? error.message : '账号同步暂时失败。')
      // 401 绝大多数是"令牌刚好过期、还没来得及刷新"，不是真的掉线：
      // 给一次 2 秒后的重试，让 supabase-js 的刷新有机会跑完。
      // 400/403 是确定性拒绝，长期退避即可，别每分钟去撞一次墙。
      const retrySoon = error?.status === 401
      scheduleFailure(error, { fatal: Boolean(error?.fatal), retrySoon })
      return false
    } finally { running = null }
  })()
  return running
}
export async function recoverAccountSyncCommit() {
  const raw = localStorage.getItem(ACCOUNT_SYNC_COMMIT_KEY)
  if (!raw) return { ok: true, recovered: false }
  try {
    const { id } = JSON.parse(raw)
    if (!id || readAccountDataOwner() !== id) throw new Error('账号同步恢复归属异常，请先导出本机记录。')
    const snapshot = await accountLocalSnapshot('rollback:' + id)
    if (!snapshot?.values || !snapshot.meta) throw new Error('找不到账号同步前的本机副本。')
    const { restoreStoredValues } = await import('./store/cloudAccess.js')
    await restoreStoredValues(validateSyncPayload(snapshot.values), { markChanged: false })
    await accountLocalSnapshot('metadata:' + id, snapshot.meta)
    localStorage.removeItem(ACCOUNT_SYNC_COMMIT_KEY)
    return { ok: true, recovered: true }
  } catch (error) { return { ok: false, error } }
}
/**
 * 这条 manifest 问题算"版本错位"还是"数据不可信"。
 *
 * validateSyncManifest 把两类问题都标成 fatal：
 *   - 结构性问题（manifest 本身形状不对、实体 id 不合法）→ 数据不可信，必须停；
 *   - 指纹漂移（实体多/少/哈希不同、singleton 哈希不同）→ 只说明这份 manifest
 *     是另一套口径算出来的，不代表值被改过。
 * 两者混为一谈的后果就是：一次兼容转换把某台设备永久挡在门外。
 */
const MANIFEST_DRIFT_REASONS = new Set([
  'manifest-missing-entity',
  'manifest-extra-entity',
  'manifest-entity-hash-mismatch',
  'manifest-singleton-hash-mismatch',
])
function isManifestDrift(issue) {
  return MANIFEST_DRIFT_REASONS.has(issue?.reason)
}

/**
 * 记住待确认的冲突，供冷启动后恢复。
 *
 * 与账号本机副本放在同一个 IndexedDB 里 —— 它本来就是"本机的、这个账号的"
 * 私有状态，放 localStorage 既会被备份/导出流程扫到，又放不下完整的冲突内容。
 */
async function rememberPendingConflicts(id, signatureValue, conflicts) {
  try {
    await accountLocalSnapshot(PENDING_CONFLICT_KEY + id, { signature: signatureValue, conflicts })
  } catch { /* 记不住只是多选一次，不该因此中断同步 */ }
}

/** 读回上次未完成的冲突。签名一致才复用：内容变了就必须重新选。 */
export async function loadPendingConflicts(id) {
  try {
    const saved = await accountLocalSnapshot(PENDING_CONFLICT_KEY + id)
    if (!saved?.conflicts?.length || typeof saved.signature !== 'string') return null
    return saved
  } catch { return null }
}

async function clearPendingConflicts(id) {
  try {
    await accountLocalSnapshot(PENDING_CONFLICT_KEY + id, { signature: '', conflicts: [] })
  } catch { /* 忽略 */ }
}

export async function startAccountSync(id) {
  await stopAccountSync()
  owner = id
  generation++
  const revision = generation
  const meta = await loadMeta(id)
  assertCurrent(id, revision)
  accountSyncLastSyncedAt.value = meta.lastSyncedAt || ''
  // 把上次没走完的冲突接回来：横幅与逐项选择直接恢复，用户不用从头再来。
  const pending = await loadPendingConflicts(id)
  if (pending?.conflicts?.length) {
    pendingSignature = pending.signature
    accountSyncConflicts.value = pending.conflicts
    setState('conflict', '')
  }
  // A store mutation must invalidate a snapshot before its debounced local write
  // finishes. The later sync-dirty event still schedules the actual upload after
  // persistence has completed.
  const mutation = () => { localSequence++ }
  const dirty = () => {
    localSequence++
    if (AUTO_RESUME_BLOCKED_STATES.has(accountSyncStatus.value)) return
    setState(online() ? 'pending' : 'offline')
    schedule(ACCOUNT_SYNC_DEBOUNCE_MS)
  }
  const storage = (event) => { if (SYNC_KEYS.includes(event.key)) dirty() }
  const resume = () => {
    if (document.hidden || AUTO_RESUME_BLOCKED_STATES.has(accountSyncStatus.value)) return
    // An offline poll is only a fallback. Once connectivity/focus returns, wake
    // immediately; error backoff is protected above by its distinct error state.
    if (timer !== null) {
      if (accountSyncStatus.value !== 'offline') return
      window.clearTimeout(timer)
      timer = null
    }
    void runAccountSync()
  }
  // A connectivity event is only a wake-up hint. If a retry is already queued,
  // keep its backoff deadline instead of turning every reconnect into an attempt.
  const resumeOnline = () => {
    resume()
  }
  // 【不要 clearTimeout(timer)】原来离线事件会把正在排队的退避重试直接丢掉。
  // 手机上从 Wi-Fi 切到蜂窝时 WebKit 常常不触发 online，而切换过程本身又会
  // 触发一次 offline —— 于是"排好的那次重试"被自己取消，横幅就永远停在
  // 「账号同步等待联网」。改成保留重试、只是把状态说清楚。
  const offline = () => {
    if (AUTO_RESUME_BLOCKED_STATES.has(accountSyncStatus.value)) return
    setState('offline')
    // Keep any queued retry intact. If there is no retry yet, one slow wake-up
    // is enough while offline; focus/online clears that fallback and resumes.
    if (timer === null) schedule(ACCOUNT_SYNC_POLL_MS)
  }
  window.addEventListener('study-life:sync-mutation', mutation)
  window.addEventListener('study-life:sync-dirty', dirty)
  window.addEventListener('storage', storage)
  window.addEventListener('online', resumeOnline)
  window.addEventListener('offline', offline)
  window.addEventListener('focus', resume)
  document.addEventListener('visibilitychange', resume)
  unbind = () => {
    window.removeEventListener('study-life:sync-mutation', mutation)
    window.removeEventListener('study-life:sync-dirty', dirty); window.removeEventListener('storage', storage)
    window.removeEventListener('online', resumeOnline); window.removeEventListener('offline', offline)
    window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume)
  }
  // Poll only while healthy to discover remote edits. Errors use scheduleFailure's
  // backoff/give-up timer; an unconditional poll here would bypass both policies.
  poll = window.setInterval(() => {
    if (!document.hidden && accountSyncStatus.value === 'synced') void runAccountSync()
  }, ACCOUNT_SYNC_POLL_MS)
  void runAccountSync()
}
export async function stopAccountSync() {
  generation++
  const stoppedAt = generation
  owner = ''
  controller?.abort()
  clearTimers()
  unbind?.(); unbind = null
  await running
  // 【这一段原本无条件执行】stopAccountSync 里有一句 `await running`，
  // 最多能挂 45 秒（等一个在飞的请求）。而 retryAccountSyncPreparation
  // 会「先 fire-and-forget 地停、立刻重启」，于是这个旧 stop 醒来时
  // 新的一轮早就跑起来了 —— 它随后把状态写成 'signed-out'、清空冲突列表，
  // 用户看到的是「登录后自动同步」而同步其实正在跑，已经选好的冲突被静默丢掉。
  // 所以只有当自己仍是最新一代时才收尾。
  if (generation !== stoppedAt) return
  // A stopped or logged-out session must never reuse the previous session's
  // unchanged-revision shortcut (the local stores may have been cleared/reset).
  lastSuccessfulSync = null
  localSequence++
  accountSyncLastSyncedAt.value = ''
  accountSyncConflicts.value = []
  pendingSignature = ''
  setState('signed-out')
}
export { localValues as readAccountLocalValues }
