import { normalizeCellText, normalizeLayoutText } from './textNormalize.js'

// 星期 token / 文本 → 0-6 的唯一规范实现（一→0 … 日/天→6）。
//
// 【为什么导出四个具名函数，而不是一个 weekdayFromText】
// 四份调用点今天的行为并不一致，差异集中在三点，且每一点都有人依赖：
//   1. 失败约定：ocrPipeline 用 -1（调用方用 `day >= 0` 过滤），其余三份用 null；
//   2. 归一化强度：Excel 走 normalizeCellText、版面 OCR 走 normalizeLayoutText、
//      ocrPipeline 直接去掉全部空白；
//   3. 是否接受纯数字：Excel 表头可能是「3」，courseParser 的 token 也可能是 '3'，
//      版面表头只认汉字。
// 统一成一种约定就等于改动调用方语义，所以这里把差异写进函数名，由调用点显式选择。

const WEEKDAY_DIGITS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }

// 四份实现里唯一的共同语义：「星期/周 + 星期汉字」。只保留这一份正则。
// \s* 与 ocrPipeline 的旧写法等价：它先把空白全删了，\s* 只可能匹配空串。
const WEEKDAY_IN_TEXT = /(?:星期|周)\s*([一二三四五六日天])/

function weekdayFromNormalized(normalized, { allowDigit = false } = {}) {
  const matched = normalized.match(WEEKDAY_IN_TEXT)
  if (matched) return WEEKDAY_DIGITS[matched[1]]
  if (allowDigit && /^[1-7]$/.test(normalized)) return Number(normalized) - 1
  return null
}

/**
 * 失败约定：-1。ocrPipeline.detectDayGeometry 用 `item.day >= 0` 过滤候选，
 * 保留 -1 就不必把过滤条件翻译成 null 判断，行为一字不改。
 */
export function weekdayIndexOrMinusOne(value) {
  const compact = String(value || '').replace(/\s/g, '')
  const index = weekdayFromNormalized(compact)
  return index === null ? -1 : index
}

/** 失败约定：null。Excel 单元格/表头，额外接受纯数字 1-7（「3」= 周三）。 */
export function weekdayIndexFromCell(value) {
  return weekdayFromNormalized(normalizeCellText(value), { allowDigit: true })
}

/** 失败约定：null。课表版面 OCR 表头，只认汉字，不接受纯数字。 */
export function weekdayIndexFromLabel(value) {
  return weekdayFromNormalized(normalizeLayoutText(value))
}

/**
 * 失败约定：null。已经切好的 token 整串匹配（含 '1'-'7'）。
 * 文本级正则（是否接受「礼拜」、是否允许数字）留在 courseParser 调用点，
 * 这里只负责 token → 下标，避免把各解析器的切词策略也吸进 facade。
 */
export function weekdayIndexFromToken(token) {
  if (/^[1-7]$/.test(token)) return Number(token) - 1
  return WEEKDAY_DIGITS[token] ?? null
}