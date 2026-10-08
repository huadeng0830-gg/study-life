export const LOCAL_STORAGE_ESTIMATE_CHARS = 5_000_000
export const LOCAL_STORAGE_WARNING_RATIO = 0.7

export function measureLocalBusinessStorage(storage = globalThis.localStorage) {
  let chars = 0
  let keyCount = 0
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith('sl_')) continue
    const value = storage.getItem(key) || ''
    chars += key.length + value.length
    keyCount += 1
  }
  return {
    chars,
    keyCount,
    percent: Math.min(100, Math.round(chars / LOCAL_STORAGE_ESTIMATE_CHARS * 100)),
    warning: chars / LOCAL_STORAGE_ESTIMATE_CHARS >= LOCAL_STORAGE_WARNING_RATIO,
  }
}
