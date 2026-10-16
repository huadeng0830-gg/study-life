/**
 * 本机存储用量。
 *
 * 之前这里写死了一个 5,000,000 字符的「常见上限」，界面再把
 * `chars / 5000000` 显示成「约占常见上限 N%」。这个数字和用户真实配额
 * 没有关系：配额按来源（origin）分配，浏览器各不相同，而真正会先撑爆的
 * 往往是 IndexedDB 里的壁纸和恢复点 —— 那部分完全没被算进去，
 * 用户看到的百分比却一直很安全。
 *
 * 现在优先用 `navigator.storage.estimate()` 的真实配额；浏览器不支持时
 * 才退回文本估算，并且**明确标注这是估算**，不再冒充真实配额。
 */

import { isPurgeableLocalKey } from './localDraftKeys.js'

/** localStorage 里用户内容键（`sl_` 前缀 + 草稿前缀）字符数对应的保守字节数。 */
const BYTES_PER_CHAR = 2
/** 无 estimate() 时用于换算百分比的保守配额估计。 */
export const LOCAL_STORAGE_ESTIMATE_CHARS = 5_000_000
export const LOCAL_STORAGE_WARNING_RATIO = 0.7

export function measureLocalBusinessStorage(storage = globalThis.localStorage) {
  let chars = 0
  let keyCount = 0
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    // 草稿键（校园投稿正文、快速记录、成果提交）也占空间，以前只数 `sl_` 会少算。
    if (key === null || !isPurgeableLocalKey(key)) continue
    const value = storage.getItem(key) || ''
    chars += key.length + value.length
    keyCount += 1
  }
  const bytes = chars * BYTES_PER_CHAR
  const ratio = chars / LOCAL_STORAGE_ESTIMATE_CHARS
  return {
    chars,
    bytes,
    keyCount,
    percent: Math.min(100, Math.round(ratio * 100)),
    warning: ratio >= LOCAL_STORAGE_WARNING_RATIO,
    // 浏览器没提供真实配额时必须说清楚，否则用户会照着一个编出来的数字做决定。
    estimated: true,
  }
}

/**
 * 读取浏览器给出的真实配额。
 *
 * 返回 `null` 表示这个浏览器不提供（Safari 桌面端较常见），调用方应改用
 * `measureLocalBusinessStorage` 的估算，并如实告诉用户那是估算。
 */
export async function readStorageQuota() {
  try {
    const storage = globalThis.navigator?.storage
    if (!storage?.estimate) return null
    const { quota = 0, usage = 0 } = await storage.estimate()
    if (!Number.isFinite(quota) || quota <= 0) return null
    return {
      quota,
      usage,
      // usage 覆盖 localStorage + IndexedDB + Cache：壁纸和恢复点都在里面。
      percent: Math.min(100, Math.round((usage / quota) * 100)),
      warning: usage / quota >= LOCAL_STORAGE_WARNING_RATIO,
    }
  } catch {
    return null
  }
}
