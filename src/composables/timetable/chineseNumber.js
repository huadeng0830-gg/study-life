// 中文数字转换：原先只定义在 courseParser.js，但作息表解析（scheduleOcrParser）也要用，
// 于是移入 facade 作为唯一实现；courseParser 仍按原导出名再导出，兼容既有调用点与测试。

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 单个中文数字词 → 阿拉伯数字字符串：「十」→ 10、「十二」→ 12、「二十三」→ 23。 */
export function cnWordToDigits(word) {
  if (/^[0-9]+$/.test(word)) return word
  if (word.includes('十')) {
    const [left, right] = word.split('十')
    const tens = left ? CN_DIGITS[left] ?? 1 : 1
    const ones = right ? CN_DIGITS[right] ?? 0 : 0
    return String(tens * 10 + ones)
  }
  return String(CN_DIGITS[word] ?? '')
}

/** 把文本里连续 1–3 个中文数字整段转成阿拉伯数字。 */
export function digitize(text) {
  return String(text).replace(/[零〇一两二三四五六七八九十]{1,3}/g, cnWordToDigits)
}

/**
 * 作息标签 → 节次编号（「第3节课」→ 3、「3」→ 3、「上午一」→ null）。
 *
 * 失败约定：null。调用方 numberedPeriodOptions 在拿不到编号时会按顺序兜底补号，
 * 所以这里绝不能猜一个默认编号——猜了就会把「早自习」这类不编号时段挤进课程节次。
 */
export function periodNumberFromLabel(label) {
  const match = digitize(String(label ?? '').trim()).match(/(?:第)?(\d{1,2})\s*(?:节|课)/)
  return match ? Number(match[1]) : null
}