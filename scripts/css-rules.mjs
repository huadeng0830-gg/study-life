/**
 * 可信的 CSS 规则切分器（第五十一轮）。
 *
 * 【为什么单独做这件事】第四十九到五十轮我两次写出不可信的 CSS 解析：
 *   - 一次是把相邻规则的片段粘在一起（`.form` 的 body 切成了上一条规则的尾部）；
 *   - 更早一次（第三十七轮）用 `matchAll(/[^{}]+\{/)` 找规则区间，`@media` 之后继续匹配内层规则，
 *     同一条规则被以错误偏移记录两次，删除时切碎了 6 个文件约 259 条规则。
 * 第三十七轮那场事故的根因就是"在不可信的解析上做破坏性扫除"，所以这次先把解析器本身做成
 * 可被证明的，再谈用它删东西。
 *
 * 【怎么才算可信】四条：
 *   1. **先剥注释、再掩字符串**（本仓已踩过六次同一个坑：注释里的 `<style>`/`id`/`@page`/属性声明
 *      都会造出幽灵）。掩字符串同样必要：`content: "}"` 里的花括号不是结构。
 *   2. **花括号配对用栈式扫描**，不用正则区间。掩过之后 `{`/`}` 的数量必须完全配平，否则
 *      `ok: false`（调用方应当据此中止，宁可不做也不猜）。
 *   3. **偏移是原文偏移**，可以 `css.slice(start, end)` 拿回整条规则的原文，供"删掉这条"这类
 *      破坏性操作定位；同一层里规则区间**不重叠且有序**。
 *   4. **嵌套上下文显式记录**（`@media`/`@supports`/`@layer`/`@container`/`@scope`），
 *      因为"声明相同"只有在**同一上下文**里才等于"可以安全删掉一条"。
 *      `@keyframes`/`@font-face`/`@page` 这类按**叶子**处理（整块作为一条），
 *      这样它们的内部花括号不会被误当成规则。
 */

/** 剥 CSS 注释（等长替换，保留偏移与行号）。 */
export function stripCssComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 掩掉字符串内容（等长替换）：花括号与注释符号在字符串里都不是结构。 */
export function maskStrings(text) {
  return String(text).replace(/"[^"]*"|'[^']*'/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 剥 HTML 注释（等长替换）：SFC 里注释中的字面量 `<style>`/`id` 会骗到扫描器。 */
export function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 递归进 body 的 at-rule；其余 at-rule（keyframes/font-face/page 等）当叶子。 */
const NESTING_AT_RULE = /^@(media|supports|layer|container|scope|document)\b/i

/** 取 SFC 的样式块（先剥 HTML 注释）。返回 [{ css, start }]（start 为块内首字符的原文偏移）。 */
export function styleBlocksOf(text) {
  const source = stripHtmlComments(text)
  const out = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let match
  while ((match = re.exec(source))) out.push({ css: match[1], start: match.index + match[0].indexOf('>') + 1 })
  return out
}

/**
 * 切分 CSS。
 * @returns {{ ok: boolean, rules: Array<{ selector: string, body: string, context: string, start: number, end: number, kind: 'rule'|'at-rule' }> }}
 *   `ok: false` 表示花括号不配平（调用方应中止任何基于它的破坏性操作）。
 *   `start`/`end` 覆盖整条（含 prelude 里的空白与结尾花括号），`css.slice(start, end)` 即原文。
 */
export function splitCssRules(css) {
  const text = String(css)
  const masked = maskStrings(stripCssComments(text))
  const rules = []
  let balanced = true

  const walk = (from, to, context) => {
    let i = from
    while (i < to) {
      const open = masked.indexOf('{', i)
      if (open < 0 || open >= to) break
      // 栈式扫描找配对右括号
      let depth = 0
      let j = open
      for (; j < to; j += 1) {
        if (masked[j] === '{') depth += 1
        else if (masked[j] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      if (depth !== 0) { balanced = false; return }
      const prelude = masked.slice(i, open)
      const selector = prelude.replace(/\s+/g, ' ').trim()
      const isAtRule = selector.startsWith('@')
      rules.push({
        selector,
        body: text.slice(open + 1, j),
        context: context.join(' && '),
        start: i,
        end: j + 1,
        kind: isAtRule ? 'at-rule' : 'rule',
      })
      if (isAtRule && NESTING_AT_RULE.test(selector)) walk(open + 1, j, [...context, selector])
      i = j + 1
    }
  }
  walk(0, masked.length, [])

  // 不配平也要抓：多余的花括号不会让 walk 提前结束，得单独数一遍
  const opens = (masked.match(/\{/g) ?? []).length
  const closes = (masked.match(/\}/g) ?? []).length
  if (opens !== closes) balanced = false

  // 不重叠且有序（同层与跨层都按开始位置排；嵌套的子规则区间在父规则区间内，这是设计如此）
  const ordered = rules.every((r, index) => index === 0 || r.start >= rules[index - 1].start)
  return { ok: balanced && ordered, rules }
}

/** 顶层的规则/at-rule（用于"整份文件是否被完整覆盖"这类自证）。 */
export function topLevelEntries(rules) {
  return rules.filter((r) => r.context === '')
}

/**
 * 找同一上下文里"选择器与声明逐字相同"的重复规则，返回每组的多余条目（保留第一条）。
 * 只有**同一上下文**里逐字相同才算：跨 `@media` 的两条同值规则可能在覆盖不同条件，删不得。
 *
 * 比较前**剥注释**：注释不参与级联，一条规则带不带注释在语义上一样。但删除时要求多余的
 * 那一条**本身不含注释**（见 callers）——注释是给人看的记录，绝不静默删掉（§4 第 22 条的教训）。
 */
export function duplicateRules(rules) {
  const seen = new Map()
  for (const rule of rules) {
    if (rule.kind !== 'rule') continue
    const key = `${rule.context}|${rule.selector}|${stripCssComments(rule.body).replace(/\s+/g, ' ').trim()}`
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(rule)
  }
  return [...seen.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, keep: group[0], extras: group.slice(1) }))
}