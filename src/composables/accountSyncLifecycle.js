import { watch } from 'vue'
import { accountAvailable, accountErrorMessage, accountReady, accountUser } from './accountAuth.js'
import { accountSyncPreparing, accountSyncPreparationError } from './accountSyncIdentity.js'
import { accountSyncError, accountSyncStatus } from './accountSyncState.js'
import { accountSyncViaAccount } from './accountSyncMode.js'

let stopWatch = null
let generation = 0
let preparation = Promise.resolve()
let engine = null

/**
 * 把**技术**错误翻译成用户能看懂的一句话。
 *
 * 这些字符串会渲染在 AccountSyncPanel 上，也可能出现在 App.vue 的顶部横幅里。
 * 判定口径很简单：**带中文的一律原样透传**（那是应用自己写好的话，再包一层
 * 只会变长变糊）；不带中文的才当作技术原文翻译 —— 那些是 IndexedDB / fetch /
 * PostgREST 直接抛出来的英文（"The user aborted a request."、"QuotaExceededError"），
 * 用户看不懂，更不该出现在界面上。
 */
const CJK = /[\u4e00-\u9fff]/
export function accountSyncFailureMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (message && CJK.test(message)) return message
  if (error?.name === 'QuotaExceededError' || /quota/i.test(error?.name || '')) {
    return '浏览器存储空间已满，无法保存账号本机副本。请先在数据管理中导出备份并清理大附件后重试。'
  }
  if (error?.name === 'AbortError' || /abort/i.test(message)) {
    return '本机数据读取超时，请稍后重试。'
  }
  if (/indexeddb|accountvault|store\.|transaction/i.test(message)) {
    return '本机副本暂时不可用，请关闭本应用的其他页面后重试。'
  }
  return accountErrorMessage({ code: error?.code, message, status: error?.status })
}
export function startAccountSyncLifecycle() {
  if (stopWatch) return
  // 第三个来源是「用户是否选择通过账号同步」。把它放进同一个 watcher，
  // 是为了让开关的生效路径和登录/退出完全一致：都走 generation 自增 + 停旧链路
  // + 重新准备。这样就不存在"开关改了但某一轮还在跑"的中间态。
  stopWatch = watch([accountReady, () => accountUser.value?.id || '', accountSyncViaAccount], ([ready, id, viaAccount]) => {
    const revision = ++generation
    const stopped = engine?.stopAccountSync()
    accountSyncPreparing.value = Boolean(id && viaAccount)
    accountSyncPreparationError.value = ''
    accountSyncStatus.value = !viaAccount && id ? 'disabled' : id ? 'preparing' : 'signed-out'
    // current 也要核对 viaAccount：开关是在一次准备**进行中**被拨动的，
    // 那条旧链路不能因为 id 没变就以为自己仍然有效。
    const current = () => generation === revision && accountUser.value?.id === id && accountSyncViaAccount.value
    preparation = preparation.catch(() => {}).then(async () => {
      await stopped
      if (revision !== generation || (accountAvailable.value && !ready)) return
      if (!viaAccount) {
        // 用户主动关闭账号同步：既不准备本机副本，也不启动同步引擎。
        accountSyncStatus.value = id ? 'disabled' : 'signed-out'
        return
      }
      if (!id) {
        accountSyncStatus.value = 'signed-out'
        return
      }
      engine ??= await import('./accountSyncEngine.js')
      const { prepareAccountLocalData, recoverAccountDataSwitch } = await import('./accountLocalData.js')
      const recoveredSwitch = await recoverAccountDataSwitch()
      if (!recoveredSwitch.ok) throw recoveredSwitch.error
      const recoveredSync = await engine.recoverAccountSyncCommit()
      if (!recoveredSync.ok) throw recoveredSync.error
      if (!current()) return
      if (!await prepareAccountLocalData(id, engine.readAccountLocalValues, current)) return
      if (!current()) return
      accountSyncPreparing.value = false
      await engine.startAccountSync(id)
      // 真的跑通了才把退避计数清零：下一次偶发失败应该从快的那一档重新开始，
      // 而不是接着上一串失败的长度等一分钟。
      resetPreparationBackoff()
    }).catch((error) => {
      if (revision !== generation) return
      // 原本直接用 error.message。那是 IndexedDB / PostgREST / fetch 的原文，
      // 经常是英文（"The user aborted a request."、"QuotaExceededError"），
      // 原样渲染在面板上既看不懂也暴露实现细节。走账号已有的映射，
      // 映射不到时退回一句人话。
      accountSyncPreparationError.value = accountSyncFailureMessage(error)
      accountSyncError.value = accountSyncPreparationError.value
      accountSyncStatus.value = 'error'
      // 【这一段是手机上"一直显示无法同步"最可能的直接原因】
      //
      // 准备阶段失败后，原本**没有任何自动重试**：watcher 只监听
      // [accountReady, accountUser.id]，令牌刷新不会重新触发它；
      // 而 accountSyncPreparationError 非空会让 accountSyncActive 为 false，
      // 于是 runAccountSync 在它的第一个守卫处就静默返回 —— 连用户手动点
      // 「立即同步」都是空操作（面板只能改道到 retryAccountSyncPreparation）。
      // 结果就是：IndexedDB 一次瞬时超时、或另一页面短暂持有那把锁，
      // 都会变成一条永远消不掉的红色横幅，唯一的出路是那个深埋在
      // 数据管理里、而且此刻是禁用状态的按钮。
      //
      // 所以这里自己按退避重试。真正需要人工介入的错误（本机副本损坏、
      // 归属异常）重试几次仍失败，用户看到的仍然是同一句话 + 那个可点的重试。
      armPreparationRetry(revision)
    }).finally(() => { if (revision === generation) accountSyncPreparing.value = false })
  }, { flush: 'sync', immediate: true })
}

// 准备阶段的重试退避。前两次比较快（本机存储常常是瞬时问题），
// 之后拉长，避免一个真的坏掉的环境被反复重试到耗电。
const PREPARATION_RETRY_MS = [8000, 20000, 60000]
let preparationRetryTimer = 0
let preparationRetryCount = 0

function clearPreparationRetry() {
  if (preparationRetryTimer) window.clearTimeout(preparationRetryTimer)
  preparationRetryTimer = 0
}

function armPreparationRetry(revision) {
  clearPreparationRetry()
  const delay = PREPARATION_RETRY_MS[Math.min(preparationRetryCount, PREPARATION_RETRY_MS.length - 1)]
  preparationRetryCount += 1
  preparationRetryTimer = window.setTimeout(() => {
    preparationRetryTimer = 0
    if (revision !== generation) return
    // 自动重试**不**清退避计数，否则每次都从 8 秒重来，等于每 8 秒
    // 重建一次账号同步链路。真正成功之后才归零（见下面的 resetPreparationBackoff）。
    restartAccountSyncLifecycle()
  }, delay)
}

export function resetPreparationBackoff() { preparationRetryCount = 0 }

/**
 * 重建整条准备链路。
 *
 * 自动重试与用户点「重试账号同步」共用它，区别只在退避计数由谁清零：
 * 自动重试要保留计数（否则永远停在第一档），用户主动点的则应当从头再来。
 */
async function restartAccountSyncLifecycle() {
  stopAccountSyncLifecycle()
  await preparation.catch(() => {})
  startAccountSyncLifecycle()
}

export async function retryAccountSyncPreparation() {
  clearPreparationRetry()
  preparationRetryCount = 0
  await restartAccountSyncLifecycle()
}
export function stopAccountSyncLifecycle() {
  generation++
  clearPreparationRetry()
  stopWatch?.(); stopWatch = null
  void engine?.stopAccountSync()
}
export function waitForAccountSyncPreparation() { return preparation }
