/**
 * 统一的 ID 生成。
 *
 * 这段逻辑此前散在十来个模块里，各自写了一份，而且**兜底强度不一样**：
 * 有的走 randomUUID → getRandomValues → 时间戳+随机，有的只走到 Math.random，
 * 还有的连时间戳都不带。ID 撞号的后果不是「不好看」——待办、通知、分类、日程
 * 都以 id 作为主键和关联键，撞了就静默覆盖掉另一条真实数据。
 *
 * 三级兜底：
 *  1. crypto.randomUUID：https / localhost 的安全上下文
 *  2. crypto.getRandomValues：非安全上下文（file:// 打开的桌面版、局域网 http 预览）
 *  3. 时间戳 + 自增序号 + 随机：两者都没有时的最后一道，保证同一毫秒内也不撞
 */

let fallbackSeq = 0

function randomSuffix() {
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(2))
  if (bytes) return bytes[0].toString(36) + bytes[1].toString(36)
  fallbackSeq += 1
  return `${Date.now().toString(36)}${fallbackSeq}${Math.random().toString(36).slice(2)}`
}

/**
 * 带前缀的业务 ID，例如 `createId('t')` → `t-3f2a…`。
 * 前缀保留是为了让 localStorage / IndexedDB 里的一条记录一眼看出属于哪种实体。
 *
 * @param {string} [prefix]
 * @returns {string}
 */
export function createId(prefix = '') {
  const uuid = globalThis.crypto?.randomUUID?.()
  const body = uuid || randomSuffix()
  return prefix ? `${prefix}-${body}` : body
}

/**
 * 不带前缀的随机令牌，用于设备标识、同步 token 之类的场合。
 * @returns {string}
 */
export function randomToken() {
  return createId()
}

/**
 * 严格 v4 形状的 UUID。
 *
 * 项目成果文件的存储路径会校验 UUID 形状（version 位 4、variant 位 10xx），
 * 所以这里不能返回 `前缀-随机串` 那种非标准形状——必须能过 UUID_PATTERN。
 * 注释里的两个坑保留原样：randomUUID 只在安全上下文可用，桌面版走 file://。
 *
 * @returns {string}
 */
export function createUuid() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  // 必须补回连字符：调用方按 8-4-4-4-12 的形状校验，32 位裸 hex 会被判为非法。
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}