// 深拷贝的唯一出口。
//
// 语义必须与直接写 `JSON.parse(JSON.stringify(value))` **完全一致**：
//   - 只保留 JSON 可表达的部分：函数与 `undefined` 属性被丢弃、`Date` 变 ISO 字符串、
//     `NaN`/`Infinity` 变 `null`、循环引用抛 TypeError；
//   - `deepClone(undefined)` 与手写 JSON 往返一样抛 SyntaxError（JSON.parse(undefined)
//     会把 undefined 转成字符串 "undefined" 再解析失败）。
//
// 【为什么不用 structuredClone】浏览器原生的 structuredClone 保留 Date/Map/Set/RegExp
// 并能克隆循环引用，遇到函数会抛 DataCloneError —— 这与仓库里既有调用点
// （撤销快照、草稿副本、恢复值）依赖的 JSON 语义不同，换过去会静默改变行为。
// 需要更丰富语义的调用方应当显式选择 structuredClone，而不是让这个 helper 两副面孔。
export function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 允许 `undefined` **原样透传**的深拷贝。
 *
 * 既有代码里有一类写法是 `value === undefined ? undefined : JSON.parse(JSON.stringify(value))`
 * （同步元数据、账号数据快照），它们要的不是「JSON 往返」而是「可选值的副本」。
 * 单独具名，免得调用方为了绕过 `deepClone(undefined)` 抛错而在各处手写守卫。
 */
export function deepCloneOptional(value) {
  return value === undefined ? undefined : deepClone(value)
}