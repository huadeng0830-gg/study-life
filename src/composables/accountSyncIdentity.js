import { computed, ref } from 'vue'
import { accountUser } from './accountAuth.js'

export const ACCOUNT_DATA_OWNER_KEY = 'study-life-data-owner'
export const ACCOUNT_SWITCH_MARKER_KEY = 'study-life-account-switch'

/**
 * 同步元数据用的随机标识。
 *
 * 直接写 `crypto.randomUUID()` 在两处会炸成 TypeError，然后一路冒到
 * accountSyncLifecycle 的 catch —— 那条路径没有自动重试（见该文件），
 * 于是一次性的环境缺失会变成永久的红色横幅。iOS 15.4 以下的 Safari、
 * 以及任何非安全上下文（局域网 http 预览）都没有 randomUUID。
 * deviceIdentity.js 里早就有这个兜底写法，这里沿用同一套。
 */
export function randomToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function readAccountDataOwner() {
  try { return localStorage.getItem(ACCOUNT_DATA_OWNER_KEY) || '' } catch { return '' }
}
export const accountDataOwner = ref(readAccountDataOwner())
export const accountSyncPreparing = ref(false)
export const accountSyncPreparationError = ref('')
// 【不要在这里直接读 localStorage】原来第 14 行调了 readAccountDataOwner()。
// computed 只在依赖变化时重算，而 localStorage 不是响应式的：一旦它与
// accountDataOwner 这个 ref 分叉（被另一上下文清掉、iOS 两个存储容器不互通），
// 这个 computed 会**继续返回 true**，于是 runAccountSync 通过了守卫、
// 却在 assertCurrent 里以 ACCOUNT_SYNC_STALE 抛错，而那条 catch 分支既不改状态
// 也不安排重试 —— 状态就此冻结在 'error'，此后每次轮询都走同一条死路。
// 改成读 ref：storage 事件（同源其它标签页）本来就会把它同步回来。
export const accountSyncActive = computed(() => Boolean(accountUser.value?.id
  && accountUser.value.id === accountDataOwner.value
  && !accountSyncPreparing.value && !accountSyncPreparationError.value))
export function accountScopedKey(key) {
  return accountDataOwner.value ? key + ':account:' + encodeURIComponent(accountDataOwner.value) : null
}
export function setAccountDataOwner(id) {
  // 与 readAccountDataOwner 的 try/catch 对称：iOS 上配额耗尽时 setItem 会抛，
  // 而这个调用发生在准备账号数据的链路上，抛出去就是那个没有重试的死胡同。
  // 归属只活在内存里也已经够用（本页的同步靠它），持久化失败不该阻断登录。
  try {
    if (id) localStorage.setItem(ACCOUNT_DATA_OWNER_KEY, id)
    else localStorage.removeItem(ACCOUNT_DATA_OWNER_KEY)
  } catch { /* 持久化失败仍保留内存归属 */ }
  accountDataOwner.value = id
}
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
  if (event.key === ACCOUNT_DATA_OWNER_KEY) accountDataOwner.value = readAccountDataOwner()
})
