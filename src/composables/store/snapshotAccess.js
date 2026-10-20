let latestRawReader = null
let pendingKeysReader = null
let storedRefValueReader = null

export function registerStoredSnapshotAccessors({ readLatestStoredRaw, getPendingPersistenceKeys }) {
  latestRawReader = readLatestStoredRaw
  pendingKeysReader = getPendingPersistenceKeys
}

/** 由 store/core.js 在 storedRefs 声明处注入：只读内存里的 ref，不声明新键。 */
export function registerStoredRefValueReader(reader) {
  storedRefValueReader = reader
}

export function readLatestStoredRaw(key, storage = globalThis.localStorage) {
  if (latestRawReader) return latestRawReader(key, storage)
  return storage?.getItem(key) ?? null
}

export function getPendingPersistenceKeys() {
  return pendingKeysReader?.() || []
}

/**
 * 读取某个键的当前值，**绝不声明它**。
 *
 * 账号同步枚举所有同步键时需要的就是这个：它只要读，不要顺手替这些键定下默认值。
 * 声明会走 useStoredRef，而默认值一旦写进注册表就成为「损坏数据的修复形状」的基准；
 * 各模块的默认值与同步默认值表本来就是两套（`sl_ledger_fx` 同步表写 `[]`，真值是 `{base,rates}`），
 * 谁先声明谁说了算——这条路径不该参与那个竞争。
 *
 * 键还没被声明过时退回读磁盘，仍不声明。
 *
 * @param {string} key
 * @returns {unknown} 取不到时返回 undefined
 */
export function readStoredValueWithoutDeclaring(key) {
  if (storedRefValueReader) {
    const value = storedRefValueReader(key)
    if (value !== undefined) return value
  }
  const raw = readLatestStoredRaw(key)
  if (raw === null || raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
