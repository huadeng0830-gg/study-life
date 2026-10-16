const { createHash } = require('node:crypto')
const CONTENT_TYPES = ['place', 'course', 'market_listing', 'help_task', 'shuttle_route', 'lost_found', 'event', 'guide']
const LISTS = {
  places_list: ['place', 'places'],
  courses_list: ['course', 'courses'], market_list: ['market_listing', 'listings'],
  help_list: ['help_task', 'tasks'], shuttle_list: ['shuttle_route', 'routes'],
  lost_found_list: ['lost_found', 'items'], events_list: ['event', 'events'], guides_list: ['guide', 'guides'],
}
class ServiceError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
function fail(code, message) { throw new ServiceError(code, message) }
function hash(value) { return createHash('sha256').update(value).digest('hex').slice(0, 32) }
function text(value, maximum, label, minimum = 0) {
  if (value !== undefined && value !== null && typeof value !== 'string') fail('invalid_input', `${label}格式不正确。`)
  const result = String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (result.length > maximum || result.length < minimum) fail('invalid_input', `${label}须填写 ${minimum}–${maximum} 个字。`)
  return result
}
function publicText(value, maximum, label, minimum = 0) {
  const result = text(value, maximum, label, minimum)
  if ([/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i, /(?:\+?86[-\s]?)?1[3-9](?:[\s\-()（）.·—_]*\d){9}/, /(?:取件码|手机号|电话|微信|微\s*信|QQ|WX|WeChat|Weixin)\s*[:：]?\s*[\w-]{4,}/i, /(?:宿舍|寝室|\d+号楼).{0,12}\d{1,4}室/].some(pattern => pattern.test(result))) fail('private_content', `${label}不能包含私人联系方式、取件码或宿舍房间号。`)
  return result
}
function choice(value, values, label) {
  if (!values.includes(value)) fail('invalid_input', `${label}选项无效。`)
  return value
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) fail('invalid_input', '记录编号无效。')
  return value
}
function date(value, label) {
  const result = text(value, 10, label, 10)
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) fail('invalid_input', `${label}须为有效的 YYYY-MM-DD 日期。`)
  return result
}
function revision(row, expected) {
  if (!row) fail('not_found', '记录已不可用，请刷新。')
  if (!Number.isSafeInteger(expected) || expected !== row.revision) fail('state_changed', '内容版本已变化，请刷新后重新核对。')
}
function sameScope(row, scope, strict = false) {
  return Boolean(scope?.school && row.school === scope.school && (!scope.campus || row.campus === scope.campus || (!strict && row.campus === '')))
}
function pick(row, keys) { return Object.fromEntries(keys.map(key => [key, row[key] ?? null])) }
function publicContent(row) { return pick(row, ['id', 'type', 'title', 'body', 'school', 'campus', 'status', 'revision', 'created_at', 'updated_at']) }
function publicFeedback(row) { return pick(row, ['id', 'category', 'title', 'body', 'status', 'public_reply', 'public_reason', 'reward_beans', 'reward_issued', 'created_at', 'updated_at']) }
module.exports = { CONTENT_TYPES, LISTS, ServiceError, fail, hash, text, publicText, choice, id, date, revision, sameScope, publicContent, publicFeedback }
