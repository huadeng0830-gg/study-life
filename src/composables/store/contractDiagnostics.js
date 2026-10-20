/**
 * 存储键「重复声明」的开发期诊断。
 *
 * `useStoredRef` 是按 key 寻址的模块单例：同一个 key 可以在多处声明，
 * **先到的调用方说了算**，后来的默认值与 options 都被静默丢弃。
 * 这本身是有意设计，但被静默丢弃的两样东西都不便宜：
 *
 *  1. **options 不一致** → 后来的 `{ deep: false }` 不生效，
 *     等于在一棵不断增长的数组上做深层遍历；
 *  2. **默认值不一致** → 这条更危险：默认值同时决定「本地数据损坏时如何修复成合法形状」
 *     （见 store/core.js 的 normalizeStoredValue）。两处默认值不同，
 *     意味着这份数据的合法形状取决于哪个模块先加载——是加载顺序的抽奖，不是可复现的行为。
 *     真实踩过的例子：`sl_ledger_fx` 在账号同步的默认值表里是 `[]`，
 *     真正的形状是 `{ base, rates }`；`sl_semester` 在同步表里是 `{ start: '' }`，
 *     真正的默认值是按当天推算出来的学期周一。
 *
 * 单独成文件是为了让 store/core.js 不必承载这一整套说明与诊断文案。
 * 生产构建下这些函数是空操作：这不是用户能处理的问题，也不该影响启动。
 */

/**
 * 每个键**实际生效**的监听配置，首次声明时记下来。
 *
 * 不能靠 `isReactive(ref.value)` / `isShallow(ref.value)` 反推：shallowRef 里放的是一个
 * **普通**数组，它既不是 reactive 也不是 shallowReactive，两个判断都会返回 false，
 * 于是「首次用 shallowRef」会被误判成与「首次用 ref」冲突。与其猜内部实现，
 * 不如把解析后的配置直接记下来比对。
 *
 * @type {Map<string, { deep: boolean, shallow: boolean }>}
 */
export const storedListenerConfigs = new Map()

/**
 * @param {string} key
 * @param {{ deep?: boolean, shallow?: boolean }} options
 * @param {Set<string>} explicitCommitKeys
 * @returns {{ deep: boolean, shallow: boolean }}
 */
export function recordStoredListenerConfig(key, options, explicitCommitKeys) {
  const config = resolveListenerConfig(key, options, explicitCommitKeys)
  storedListenerConfigs.set(key, config)
  return config
}

/**
 * @param {string} key
 * @param {{ deep: boolean, shallow: boolean }} requested
 * @param {{ deep: boolean, shallow: boolean }} actual
 */
export function reportStoreContractViolation(key, requested, actual) {
  if (!import.meta.env.DEV) return
  console.warn(
    `[store] "${key}" 被重复声明，且监听方式与首个声明不一致：`
    + `这里要求 deep=${requested.deep} / shallow=${requested.shallow}，`
    + `实际沿用首个声明的 deep=${actual.deep} / shallow=${actual.shallow}。`
    + `同键多处以不同 options 声明时，第一次调用生效、其余静默失效——`
    + `请让所有声明方一致，或只保留一处声明（收进一个共享 composable）。`,
  )
}

/**
 * 重复声明时的完整检查。core.js 只需要调用它，不必知道判定细节。
 *
 * @param {{
 *   key: string,
 *   defaultValue: unknown,
 *   options: { deep?: boolean, shallow?: boolean },
 *   listenerConfigs: Map<string, { deep: boolean, shallow: boolean }>,
 *   defaults: Map<string, unknown>,
 *   explicitCommitKeys: Set<string>,
 * }} input
 */
export function checkStoredRefContract({ key, defaultValue, options, listenerConfigs, defaults, explicitCommitKeys }) {
  const requested = resolveListenerConfig(key, options, explicitCommitKeys)
  const actual = listenerConfigs.get(key)
  if (actual && (actual.deep !== requested.deep || actual.shallow !== requested.shallow)) {
    reportStoreContractViolation(key, requested, actual)
  }
  const knownDefault = defaults.get(key)
  if (knownDefault !== undefined && JSON.stringify(knownDefault) !== JSON.stringify(defaultValue)) {
    reportStoreDefaultMismatch(key, knownDefault, defaultValue)
  }
}

/**
 * 把一次声明的 options 解析成真正生效的 deep / shallow。
 *
 * 显式提交键（EXPLICIT_COMMIT_KEY_LIST）默认就是「浅监听 + 需显式提交」，
 * 所以调用方**不传 options** 与**传 `{ deep: false }`** 解析出的结果是一致的，
 * 不该被当成不一致。
 */
function resolveListenerConfig(key, options, explicitCommitKeys) {
  const explicit = explicitCommitKeys.has(key)
  return { deep: options.deep ?? !explicit, shallow: options.shallow ?? explicit }
}

/**
 * @param {string} key
 * @param {unknown} knownDefault 首个声明定下的默认值
 * @param {unknown} requestedDefault 本次声明要求的默认值
 */
export function reportStoreDefaultMismatch(key, knownDefault, requestedDefault) {
  if (!import.meta.env.DEV) return
  console.warn(
    `[store] "${key}" 被重复声明，且默认值与首个声明不一致：`
    + `这里要求 ${JSON.stringify(requestedDefault)}，实际沿用首个声明的 ${JSON.stringify(knownDefault)}。`
    + `默认值同时决定损坏数据的修复形状，两处不同意味着结果取决于加载顺序——`
    + `请统一默认值，或只保留一处声明。`,
  )
}