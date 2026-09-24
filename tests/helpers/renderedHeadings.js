/**
 * 渲染 DOM 级的标题判定（第二十五轮）。
 *
 * 放在 helpers 而不是测试文件里：渲染类守卫会从多个测试文件复用这几个判定，
 * 而从测试文件里 import 会连带执行它的顶层代码、注册并运行它的用例——
 * 那是"两个测试文件互相污染"的经典写法，必须避免。
 */

/** 元素自己或任一祖先是否被藏起来。 */
export function isVisible(el) {
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false
    if (node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

/** 取某棵子树里**可见**的标题，按文档顺序。 */
export function visibleHeadings(root) {
  if (!root) return []
  return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .filter(isVisible)
    .map((el) => ({ level: Number(el.tagName.slice(1)), text: (el.textContent || '').trim() }))
}

/**
 * 返回标题顺序问题列表（空数组表示合格）。
 *
 * 规则两条：
 *   1. 页面内容里恰好一个 h1，且它必须是**第一个**标题；
 *   2. 相邻标题不得跳级（`h2 → h4` 会让读屏的"按标题跳转"出现断层）。
 */
export function headingOrderIssues(headings) {
  const out = []
  const h1s = headings.filter((h) => h.level === 1)
  if (h1s.length !== 1) out.push(`页面里有 ${h1s.length} 个 h1（应为 1 个）`)
  if (headings.length && headings[0].level !== 1) {
    out.push(`第一个标题是 h${headings[0].level}「${headings[0].text}」，不是 h1`)
  }
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1]
    const cur = headings[i]
    if (cur.level > prev.level + 1) {
      out.push(`h${prev.level}「${prev.text}」→ h${cur.level}「${cur.text}」跳级`)
    }
  }
  return out
}