// @vitest-environment happy-dom
/**
 * 焦点不被遮挡守卫（第四十四轮，WCAG 2.4.11 Focus Not Obscured）。
 *
 * 【问题形态】浏览器把「被聚焦的元素」或 `scrollIntoView` 的目标滚入视野时，会把它滚到
 * **紧贴滚动容器边缘**。而这个应用贴着边缘的地方正好有 sticky 面，于是贴边的元素被压住：
 *   - 上方：弹窗内的自动保存提示（TimeSettingsModal，z-index:3）、表格 sticky 表头
 *     （BatchImportModal / CourseManagerModal / CourseManagerModal 的批量管理表）；
 *   - 下方：「快速记录」的 sticky 保存栏（QuickRecordPanel）、账本与作息页的 sticky 底栏。
 *
 * 【为什么是 CSS 而不是 JS】`Modal.vue` 的 `keepFocusedControlVisible` 其实已经用 **12px**
 * 余量判断"要不要滚"，但 `scrollIntoView({ block: 'nearest' })` **没有"滚多少余量"这个参数**
 * ——余量只能来自 CSS 的 `scroll-margin`。所以 12px 只决定"要不要滚"，不决定"滚到哪"，
 * 元素最终仍然贴边。这也是 `DataManager` 的 `.data-section` 当初要单独写
 * `scroll-margin-top:58px` 的原因（它用的是 `block:'start'`，更是直接贴顶）。
 *
 * 【判据分工】
 *   1. 全站 `scroll-margin` 约定必须在，且**特异性为 0**（`:where()`）——这样局部写法
 *      （如 `.data-section` 的 58px）能覆盖它，不会把已有的修正压掉；
 *   2. `block:'start'|'end'` 的 `scrollIntoView` 是最危险的一种（直接贴顶/贴底），
 *      每一处都必须在 OFFSETS 里写明它的余量声明在哪，且那条声明必须仍然存在；
 *   3. 遮挡面清单**反向**守：清单里的每个 sticky 面必须还在（被删掉就该有人来更新清单
 *      与余量理由，而不是让 48/56px 变成来历不明的魔法数字）。
 *
 * 【不做什么】不推算 sticky 面的像素高度（那是"假警守卫"的老路）。这里守的是
 * 「有没有留余量」「余量声明还在不在」「遮挡面清单有没有漂移」这三件确定的事。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const read = (rel) => readFileSync(join(srcDir, rel), 'utf8')

function walk(dir = srcDir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js)$/.test(full)) out.push(full)
  }
  return out
}

const relOf = (file) => file.replace(/\\/g, '/').slice(srcDir.replace(/\\/g, '/').length + 1)

/* ---------- 判据 ---------- */

/** 找出所有 `scrollIntoView({ block: '…' })` 调用及其 block 值。 */
export function findScrollIntoViewCalls(source) {
  const found = []
  const re = /scrollIntoView[?]?\.?\(?\{([^}]*)\}/g
  let match
  while ((match = re.exec(source)) !== null) {
    const block = /block:\s*'([^']+)'/.exec(match[1]) ?? /block:\s*"([^"]+)"/.exec(match[1])
    found.push({ block: block ? block[1] : '', args: match[1].replace(/\s+/g, ' ').trim() })
  }
  return found
}

/** 贴边（start/end）的调用最危险：必须另有 scroll-margin 兜着。 */
export const EDGE_BLOCKS = ['start', 'end']

/**
 * 去掉 CSS 注释再扫。
 *
 * 这不是洁癖：这段约定自己的注释里就写着 `scroll-margin-top:58px` 与 `:where()`，
 * 不剥注释的话会**造出幽灵规则**（注释里的属性声明被当成一条真规则，选择器则是被注释
 * 文本污染的垃圾串），而且真实那条规则的"选择器"也会被注释污染——于是把 `:where()`
 * 从代码里删掉之后，测试**照样绿**（污染串里带着注释里的 `:where()`）。
 * 这个坑在本仓出现过三次了：`<style>` 写在 HTML 注释里、`@page` 被注释骗到、
 * 以及这里的 CSS 注释。凡是要 parse 的东西，先剥注释。
 */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 找出所有声明了某属性的规则，返回 `{ selector, body }`（已剥注释）。
 *
 * 做法是**先定位声明、再往回找所属规则**，而不是"拿选择器去 indexOf"——
 * 后者会被前缀相同的选择器骗到（找 `.data-section` 会先撞上 `.data-section-head`，
 * 于是拿着隔壁规则的 body 去断言，得出一个假结论）。回溯法是稳健的：
 * 属性前面最后一个 `{` 就是它所属规则的块首，再往前扫到 `}`/`{`/开头就是选择器。
 */
export function rulesWith(rawCss, property) {
  const css = stripCssComments(rawCss)
  const rules = []
  const re = new RegExp(`${property}\\s*:`, 'g')
  let match
  while ((match = re.exec(css)) !== null) {
    const open = css.lastIndexOf('{', match.index)
    if (open < 0) continue
    let start = open - 1
    while (start >= 0 && !'}{'.includes(css[start])) start -= 1
    const selector = css.slice(start + 1, open).replace(/\s+/g, ' ').trim()
    let depth = 1
    let i = open + 1
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    rules.push({ selector, body: css.slice(open + 1, i - 1) })
  }
  return rules
}

/** 选择器里是否含有某个"完整"的类名（`.data-section` 不该被 `.data-section-head` 命中）。 */
export function selectorHasClass(selector, className) {
  return new RegExp(`(^|[\\s,>+~(])\\.${className.replace(/\./g, '\\.')}(?![\\w-])`).test(selector)
}

/** 分档：把 '48px' / 'var(--x)' / '0' 变成可比数值（拿不到具体值时返回 null）。 */
function px(value) {
  const parsed = /^(\d+(?:\.\d+)?)px$/.exec(String(value).trim())
  return parsed ? Number(parsed[1]) : null
}

/* ---------- 清单 ---------- */

/**
 * 贴边调用的余量声明在哪。每一条都必须能被复核：call 仍在 + 余量声明仍在。
 * （第四十四轮实测：全仓只有 DataManager 一处用 `block:'start'`，其余是 center/nearest。）
 */
const OFFSETS = [
  {
    file: 'components/DataManager.vue',
    block: 'start',
    offsetFile: 'components/DataManager.vue',
    offsetSelector: '.data-section',
    offsetProperty: 'scroll-margin-top',
    reason: '移动端「跳到此段」用 block:"start"，直接把目标滚到顶部；'
      + '上方有 sticky 的 .mobile-data-nav（top:-14px）。第五轮就在这里单独加了 '
      + '.data-section{scroll-margin-top:58px}——本条记录的正是那处先例，'
      + '全站 :where() 约定（48px）特异性为 0，不会覆盖它。',
  },
]

/**
 * 会在「滚入视野」时遮挡的 sticky 面清单。删掉任何一个，就该有人来重新评估
 * 48px / 56px 这两个余量是否还有来历——所以这里反向断言它们仍然存在。
 */
const OCCLUDERS = [
  { file: 'components/schedule/TimeSettingsModal.vue', needle: 'position: sticky', note: '自动保存提示（z-index:3）与底部条' },
  { file: 'components/schedule/BatchImportModal.vue', needle: 'position: sticky', note: '导入预览表的 sticky 表头' },
  { file: 'components/schedule/CourseManagerModal.vue', needle: 'position: sticky', note: '批量管理表的 sticky 表头' },
  { file: 'components/QuickRecordPanel.vue', needle: 'position: sticky', note: '底部保存栏（44px 按钮 + padding ≈ 56px）' },
  { file: 'views/ledger-panels/BillFormModal.vue', needle: 'position: sticky', note: '账本页底部 sticky 条（随固定账单弹窗迁出 LedgerView，落在 BillFormModal 的 .bill-form-actions）' },
]

/* ---------- 夹具：判据的判别力 ---------- */

describe('findScrollIntoViewCalls 的判别力', () => {
  it('三种 block 都能读出来', () => {
    expect(findScrollIntoViewCalls("x.scrollIntoView({ block: 'start' })")[0].block).toBe('start')
    expect(findScrollIntoViewCalls("x.scrollIntoView({ block: 'nearest', inline: 'nearest' })")[0].block).toBe('nearest')
    expect(findScrollIntoViewCalls('x.scrollIntoView?.({ block: "center" })')[0].block).toBe('center')
  })

  it('可选链与无参形式不会漏也不会误报', () => {
    expect(findScrollIntoViewCalls("input?.scrollIntoView?.({ block: 'center', inline: 'nearest' })")).toHaveLength(1)
    expect(findScrollIntoViewCalls('el.scrollIntoView()')).toEqual([])
    expect(findScrollIntoViewCalls('if (!target?.scrollIntoView) return')).toEqual([])
  })
})

describe('rulesWith / selectorHasClass 的判别力', () => {
  it('取的是声明的所属规则，不是隔壁规则', () => {
    const css = '.a { scroll-margin-top: 58px }\n.b { position: sticky; top: 0 }'
    const rules = rulesWith(css, 'scroll-margin-top')
    expect(rules).toHaveLength(1)
    expect(rules[0].selector).toBe('.a')
    expect(rules[0].body).toContain('58px')
  })

  it('嵌套在媒体查询里也能拿到内层规则的选择器', () => {
    const css = '@media (x) { .a { scroll-margin-top: 12px } }'
    expect(rulesWith(css, 'scroll-margin-top')[0].selector).toBe('.a')
  })

  it('前缀相同的类名不会被误命中（.data-section vs .data-section-head）', () => {
    expect(selectorHasClass('.data-section', 'data-section')).toBe(true)
    expect(selectorHasClass('.data-section-head', 'data-section')).toBe(false)
    expect(selectorHasClass('.x .data-section > b', 'data-section')).toBe(true)
  })

  it('没有该属性时返回空数组', () => {
    expect(rulesWith('.a { color: red }', 'scroll-margin-top')).toEqual([])
  })

  it('注释里的声明不会造出幽灵规则', () => {
    const css = '/* 说明：这里原本写 scroll-margin-top:58px，并提到 :where() */\n.a { scroll-margin-top: 12px }'
    const rules = rulesWith(css, 'scroll-margin-top')
    expect(rules, '注释里的属性被当成了真规则').toHaveLength(1)
    expect(rules[0].selector).toBe('.a')
    expect(rules[0].selector, '选择器被注释文本污染了').not.toContain(':where(')
  })

  it('stripCssComments 去掉注释但保留代码', () => {
    expect(stripCssComments('a{}/* b */c{}')).toBe('a{}c{}')
  })
})

/* ---------- 全仓 ---------- */

describe('全站焦点不被遮挡的约定', () => {
  const styleCss = read('style.css')

  it('全站 scroll-margin 约定必须在，且上下都留了余量', () => {
    const rules = rulesWith(styleCss, 'scroll-margin-top')
    expect(rules.length, '找不到 scroll-margin-top 的声明').toBeGreaterThan(0)
    const global = rules.find((rule) => rule.selector.includes(':where('))
    expect(global, '找不到 :where(...) 的全站约定').toBeTruthy()
    expect(global.body).toMatch(/scroll-margin-top:\s*\d+px/)
    expect(global.body).toMatch(/scroll-margin-bottom:\s*\d+px/)
    const topVal = px(/scroll-margin-top:\s*([^;]+)/.exec(global.body)[1])
    const bottomVal = px(/scroll-margin-bottom:\s*([^;]+)/.exec(global.body)[1])
    // 44px 是"容得下最小的 sticky 面"的下限（触控目标令牌 --tap-min 也是 44px）；
    // 实测取的是 48 / 56，对应弹窗内自动保存提示（约 32px + 余量）与底部保存栏（约 56px）。
    expect(topVal, '上方余量小于 44px 就挡不住 sticky 表头/提示').toBeGreaterThanOrEqual(44)
    expect(bottomVal, '下方余量小于 44px 就挡不住 sticky 保存栏').toBeGreaterThanOrEqual(44)
  })

  it('约定必须是零特异性（:where），否则会把局部的修正压掉', () => {
    const rules = rulesWith(styleCss, 'scroll-margin-top')
    const withMargin = rules.filter((rule) => rule.body.includes('scroll-margin-top'))
    const classSelectors = withMargin.filter((rule) => rule.selector.startsWith('.'))
    expect(
      classSelectors.map((rule) => rule.selector),
      '全站的 scroll-margin 约定必须是 :where()（特异性 0），否则会盖掉 .data-section 的 58px 这类局部修正',
    ).toEqual([])
  })

  it('贴边（start/end）的 scrollIntoView 都必须写明余量声明在哪，且那条声明仍在', () => {
    const calls = []
    for (const file of walk()) {
      const rel = relOf(file)
      for (const call of findScrollIntoViewCalls(readFileSync(file, 'utf8'))) {
        if (EDGE_BLOCKS.includes(call.block)) calls.push({ rel, call })
      }
    }
    const undocumented = calls.filter(({ rel, call }) => !OFFSETS.some((entry) => entry.file === rel && entry.block === call.block))
    expect(
      undocumented.map(({ rel, call }) => `${rel}: block:"${call.block}"（${call.args}）`),
      '这些 scrollIntoView 贴边滚动，却没有说明余量从哪来',
    ).toEqual([])
    // 反查：每条清单的余量声明必须真的还在
    for (const entry of OFFSETS) {
      const css = read(entry.offsetFile)
      const rules = rulesWith(css, entry.offsetProperty)
      const owning = rules.find((rule) => selectorHasClass(rule.selector, entry.offsetSelector.replace(/^\./, '')))
      expect(owning, `${entry.offsetSelector} 不再声明 ${entry.offsetProperty} —— ${entry.file} 的贴边滚动就没人兜底了`).toBeTruthy()
    }
  })

  it('遮挡面清单反向守：每个 sticky 面都还在（清单不能悄悄烂掉）', () => {
    for (const entry of OCCLUDERS) {
      // 写法可能是 `position: sticky` 也可能是 `position:sticky`，所以按正则归一；
      // 同时剥掉注释——被注释掉的 sticky 不该算数。
      const normalized = stripCssComments(read(entry.file)).replace(/position:\s*sticky/g, 'position: sticky')
      expect(normalized, `${entry.file} 里的 ${entry.note} 不见了，请重新评估 48/56px 这两个余量`).toContain(entry.needle)
    }
  })

  it('扫描规模自证', () => {
    const files = walk()
    expect(files.length).toBeGreaterThanOrEqual(50)
    const calls = files.flatMap((file) => findScrollIntoViewCalls(readFileSync(file, 'utf8')))
    expect(calls.length, 'scrollIntoView 调用太少，判据可能已经和实现脱节').toBeGreaterThanOrEqual(3)
  })
})
