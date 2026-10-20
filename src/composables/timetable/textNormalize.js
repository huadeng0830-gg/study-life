// 课表解析的「解析前文本归一化」。
//
// 【为什么这里是三份具名归一化，而不是合成一份】
// 五份解析器面对不同输入源，历史上对「横线 / 全角方括号 / 不间断空格 / 全角数字」的
// 处理并不一致，而这些差异会真实改变解析结果：作业表的 OCR 里「１２」只有经过 NFKC
// 才会变成「12」；Excel 单元格的【】不该被当成分隔符。把三份合并成一个「看起来更统一」
// 的函数会静默改动调用方行为，所以 facade 保留三份具名实现，由调用点显式选择。

// 常见横线/波浪线（en/em dash、减号、波浪线）统一成半角连字符。
const DASH_RE = /[\u2013\u2014\u2212~～]/g

/**
 * Excel 单元格归一化：横线统一 + 全角圆括号转半角 + 压缩空白。
 * 不做【】→[]，因为表头别名匹配依赖原文的方括号形态；也用 `?? ''`
 * （与 normalizeLayoutText 的 `|| ''` 不同）——两者只影响 0/false 这类非字符串输入，
 * 但都属于历史行为，不能互换。
 */
export function normalizeCellText(value) {
  return String(value ?? '')
    .replace(DASH_RE, '-')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 课表版面/OCR 行归一化：在单元格版基础上多一步【】→[]。 */
export function normalizeLayoutText(value) {
  return String(value || '')
    .replace(DASH_RE, '-')
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 作息表 OCR 归一化：先 NFKC 把全角数字/符号转半角，再认更宽的一套横线
 * （比上两份多 U+2010–U+2015 与全角连字符）。作息表整页都是时间数字，
 * 不做 NFKC 就认不出「０８：００」这类全角时间。
 */
export function normalizeScheduleText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212~～－]/g, '-')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}