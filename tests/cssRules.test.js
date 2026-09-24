// @vitest-environment happy-dom
/**
 * CSS 规则切分器与同值重复规则（第五十一轮，收尾 §4 第 23 条）。
 *
 * 【背景】第三十七轮我用 `matchAll(/[^{}]+\{/)` 找规则区间，`@media` 之后继续匹配内层规则，
 * 同一条规则被以错误偏移记录两次，删除时切碎了 6 个文件约 259 条规则。第四十九到五十轮
 * 我又两次写出不可信的 CSS 解析（把相邻规则的片段粘在一起）。根因都是同一件事：
 * **在不可信的解析上做破坏性扫除**。所以这一轮先把解析器做成可被证明的（`scripts/css-rules.mjs`）：
 * 栈式花括号配对、先剥注释再掩字符串、显式记录 `@media` 上下文、偏移是原文偏移。
 *
 * 【这一轮真正抓到的东西，比"清理重复"重要】同值重复规则里，**后出现的那一份是会赢的那一份**。
 * 我的删除脚本极性选反了（删掉 `group.slice(1)`，即后出现的那份），于是 `.skin-notebook .tt-cell`
 * 与 `.tt-cell:hover,.tt-cell.isToday` 这一对（特异性都是 0,2,0、都设 background、能匹配同一个元素）
 * 的相对顺序翻转，会改变"笔记本皮肤下悬停或今天是格"的底色。穷举检查（同上下文、共享类名、
 * 相对顺序翻转）定位到**唯一**这一对，把它移回最后一次出现的位置后归零。
 * 结论写成判据：这一对的选择器顺序是承重的。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  duplicateRules,
  maskStrings,
  splitCssRules,
  stripCssComments,
  stripHtmlComments,
  styleBlocksOf,
  topLevelEntries,
} from '../scripts/css-rules.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|css)$/.test(name)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

/** 一个文件里所有样式块（.vue 取 style 块，.css 整体）。 */
function blocksOf(file) {
  const text = readFileSync(file, 'utf8')
  return file.endsWith('.vue') ? styleBlocksOf(text).map((b) => b.css) : [text]
}

/* ---------- 切分器自身的判别力 ---------- */

describe('切分器的判别力', () => {
  it('@media 内层规则带上下文，且不会与外层规则混淆', () => {
    const { ok, rules } = splitCssRules('.a{color:red}@media (max-width:900px){.a{color:blue}.b{color:green}}')
    expect(ok).toBe(true)
    const a = rules.filter((r) => r.selector === '.a')
    expect(a).toHaveLength(2)
    expect(a.map((r) => r.context)).toEqual(['', '@media (max-width:900px)'])
    // 同选择器、同声明、但上下文不同 → 不算重复（跨 @media 的两条可能在覆盖不同条件）
    expect(duplicateRules(rules)).toEqual([])
  })

  it('嵌套 @media/@supports 逐层记录', () => {
    const { rules } = splitCssRules('@supports (a:b){@media print{.x{color:red}}}')
    const x = rules.find((r) => r.selector === '.x')
    expect(x.context).toBe('@supports (a:b) && @media print')
  })

  it('字符串与注释里的花括号不是结构', () => {
    for (const css of ['.a{content:"}"}', '.a{content:"{"}', '.a{/* } */color:red}', '.a{content:"/*"}']) {
      const { ok } = splitCssRules(css)
      expect(ok, `${css} 应被判为配平`).toBe(true)
    }
    // 掩字符串前后必须等长（偏移才能用于原文 slice）
    expect(maskStrings('.a{content:"abc"}').length).toBe('.a{content:"abc"}'.length)
    expect(stripCssComments('/* xx */a{b:c}').length).toBe('/* xx */a{b:c}'.length)
    expect(stripHtmlComments('<!-- xx -->a').length).toBe('<!-- xx -->a'.length)
  })

  it('注释里的字面量 <style> 不会骗到样式块定位', () => {
    const sfc = '<!-- 见 <style> 里的 .skip-to-content -->\n<template><div/></template>\n<style>/* 真注释 */ .a{color:red}</style>'
    const blocks = styleBlocksOf(sfc)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].css).toContain('真注释')
    expect(blocks[0].css).not.toContain('template')
    // 偏移必须能在原文里 slice 回同一段
    expect(sfc.slice(blocks[0].start, blocks[0].start + 12)).toBe('/* 真注释 */ .a')
  })

  it('不配平时 ok=false（调用方据此中止，宁可不做也不猜）', () => {
    expect(splitCssRules('.a{color:red}').ok).toBe(true)
    expect(splitCssRules('.a{color:red').ok).toBe(false)
    expect(splitCssRules('.a{color:red}}').ok).toBe(false)
  })

  it('@keyframes 当叶子处理，内部花括号不会被误当成规则', () => {
    const { rules } = splitCssRules('@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}')
    expect(rules).toHaveLength(1)
    expect(rules[0].kind).toBe('at-rule')
    expect(rules[0].selector).toBe('@keyframes spin')
    expect(rules.find((r) => r.selector === 'from')).toBeUndefined()
  })

  it('偏移能 slice 回整条规则，且顶层条目按序平铺（自证没有丢结构）', () => {
    const css = '.a{color:red}\n\n@media (max-width:900px){\n.b{color:blue}\n}\n/* 注释 */\n.c{color:green}\n'
    const { rules } = splitCssRules(css)
    for (const rule of rules) {
      const raw = css.slice(rule.start, rule.end)
      // prelude 里可能带前导空白与注释（偏移从上一个 `}` 之后起算），剥掉再比
      expect(stripCssComments(raw).replace(/\s+/g, ' ').trim().startsWith(rule.selector)).toBe(true)
      expect(raw.trimEnd().endsWith('}')).toBe(true)
    }
    // 顶层条目：条与条之间只允许出现空白/注释，不允许漏掉任何一对花括号
    const tops = topLevelEntries(rules)
    let cursor = 0
    for (const entry of tops) {
      const gap = stripCssComments(css.slice(cursor, entry.start))
      expect(gap, '顶层条目之间不该夹着结构').not.toMatch(/[{}]/)
      cursor = entry.end
    }
    const tail = stripCssComments(css.slice(cursor))
    expect(tail).not.toMatch(/[{}]/)
  })

  it('同上下文逐字相同的才算重复，保留第一条', () => {
    const { rules } = splitCssRules('.a{color:red}.a{color:red}.a{color:blue}')
    const groups = duplicateRules(rules)
    expect(groups).toHaveLength(1)
    expect(groups[0].extras).toHaveLength(1)
    expect(groups[0].keep.start).toBeLessThan(groups[0].extras[0].start)
  })

  it('注释不参与"是否重复"的判断，但也不该被静默删掉', () => {
    const { rules } = splitCssRules('.a{/* 说明 */color:red}.a{color:red}')
    expect(duplicateRules(rules), '注释不改变级联，语义相同就是重复').toHaveLength(1)
  })
})

/* ---------- 全仓 ---------- */

describe('全仓 CSS 规则（第五十一轮）', () => {
  const files = walk().map((file) => ({ file: relOf(file), blocks: blocksOf(file) }))

  it('每个样式块的花括号都配平', () => {
    const bad = []
    for (const { file, blocks } of files) {
      for (const css of blocks) if (!splitCssRules(css).ok) bad.push(file)
    }
    expect(bad, '这些文件花括号不配平——任何基于规则区间的破坏性操作都必须先停下').toEqual([])
  })

  it('不再有同上下文逐字重复的规则（实测已清零）', () => {
    const dups = []
    for (const { file, blocks } of files) {
      let count = 0
      for (const css of blocks) for (const group of duplicateRules(splitCssRules(css).rules)) count += group.extras.length
      if (count) dups.push(`${file}: ${count}`)
    }
    expect(dups, '同值重复又回来了（第三十七轮恢复留下的这类副本清过一次）').toEqual([])
  })

  /**
   * 【第五十四轮末（收尾补做）重推过一次】原下限 2400（注释写"实测 2458"），本轮那批
   * 死规则清理落地后实测 **2299**，所以一次性重推到 2240（保留约 2.4% 余量，与
   * 2400/2458 的比例一致）。
   * **这不是"红了就调小"**：五份清理各自都证明过"没有我的删除它照样红"（把各自的样式块
   * 换回改前再测，读数仍低于 2400），所以这是**所有删除落地后的一次重新基线**，
   * 而不是把某一次改动糊过去。本轮共删 143 条规则体（TodayView 66 / ScheduleView 34 /
   * App.vue 26 / AppearanceSettings 16 / LedgerView 1）。
   * 余量是刻意留的：这条断言的作用是"判据和实现脱节时报警"（例如提取器坏掉、扫到 0 条），
   * 不是逐条锁死全仓规则数——余量太小会让每一次**合法**的清理都必须顺手改数字，
   * 那就退化成"谁删谁削一刀"的链式松动（本轮并行清理中已经真实出现过一次：某个代理
   * 临时改了这个数、发现全仓在两分钟内从 2399 掉到 2333，就把自己的改动逐字回滚了）。
   */
  it('规模自证：规则数不能太少（判据和实现脱节时这里会红）', () => {
    const total = files.reduce((sum, f) => sum + f.blocks.reduce((s, css) => s + splitCssRules(css).rules.filter((r) => r.kind === 'rule').length, 0), 0)
    expect(total, '扫到的 CSS 规则总数低于实测值（实测 2299）').toBeGreaterThanOrEqual(2240)
  })

  /**
   * 顺序判据：这一对的选择器在源码里的先后顺序是**承重**的。
   * `.skin-notebook .tt-cell` 与 `.tt-cell:hover,.tt-cell.isToday` 特异性相同（都是 0,2,0）、
   * 都设 background、能匹配同一个元素，所以谁在后面谁赢。第五十一轮去重时顺序被翻转过一次，
   * 会改变笔记本皮肤下悬停/今天是格的底色。
   *
   * 【第五十四轮末（收尾补做）：断言的位置从 ScheduleView.vue 搬到 ScheduleGrid.vue（判据一字未改）】
   * `skin-notebook` 是 **ScheduleGrid 自己**拼出来的类（`ScheduleGrid.vue` L171/L206 的
   * `:class="`skin-${appearance.scheduleSkin}`"`），`.tt-cell` 又是 ScheduleGrid 的**内部节点**类；
   * Vue 的 scoped CSS 只把父作用域的 `data-v-*` 加在**子组件根节点**上，所以这两条写在
   * `views/ScheduleView.vue` 的 `<style scoped>` 里**永远匹配不到任何节点**：编译结果是
   * `.skin-notebook .tt-cell[data-v-<ScheduleView>]`，而 `.tt-cell` 拿的是 ScheduleGrid 的
   * scope 属性；实测 `tt-cell` 在 ScheduleView 的模板区出现 **0** 次，`.skin-notebook` 在
   * ScheduleView 的模板里也一次都没出现（它由 ScheduleGrid 动态拼出）。
   * 它们随本轮那批不可达选择器一并删除（判据见 `tests/scopedChildReachability.test.js`）。
   * 真正生效的等价规则一直在 **ScheduleGrid.vue 自己的样式块**里（`.tt-cell:hover` L378、
   * `.tt-cell.isToday` L379、`.skin-notebook .tt-cell` L409）：那里 `skin-notebook` 落在子组件
   * 根内的元素上、`.tt-cell` 带的就是 ScheduleGrid 的 scope，两条都是活的，顺序也仍是
   * 「skin 那条排在 hover/isToday 之后」（409 > 378/379）——去重翻转过的那个级联结果没有丢。
   * 断言因此搬到**规则真正生效的那个文件**：守的对象不变，只是不再去守一份死副本。
   */
  it('盯住那一对承重的选择器顺序（皮肤格子的底色由它决定）', () => {
    const css = blocksOf(join(srcDir, 'components', 'schedule', 'ScheduleGrid.vue')).join('\n')
    const { rules } = splitCssRules(css)
    const skinCell = rules.find((r) => r.selector === '.skin-notebook .tt-cell')
    const hover = rules.find((r) => r.selector.startsWith('.tt-cell:hover'))
    expect(skinCell, '找不到 .skin-notebook .tt-cell').toBeTruthy()
    expect(hover, '找不到 .tt-cell:hover').toBeTruthy()
    expect(
      skinCell.start,
      '.skin-notebook .tt-cell 必须在 .tt-cell:hover 之后：两者特异性相同且都设 background，顺序一翻转就换底色',
    ).toBeGreaterThan(hover.start)
  })
})