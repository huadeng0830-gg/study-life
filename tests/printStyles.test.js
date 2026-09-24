// @vitest-environment happy-dom
/**
 * 打印样式守卫（第三十三轮新增）。
 *
 * 【为什么需要】全仓此前**没有任何** `@media print`：按 Ctrl+P 会把深色侧栏、
 * 悬浮任务中心、装饰粒子与提示层一起印上，而 `.timetable-wrap` 的
 * `overflow-x: auto` 在纸上会把课程表右侧的列**整块裁掉**。
 *
 * 【怎么守】CSS 媒体查询在 happy-dom 里不会被求值，所以这里做的是**结构守卫**：
 * 解析 `src/style.css` 里的打印块，逐条检查它是否真的盖住了外壳、展开滚动容器、
 * 归零主题令牌。为了不让守卫"看着绿其实什么都没验证"，加了三道自证：
 *   1. 打印块里出现的每个类/ID 选择器**必须在源码里真实存在**（改名即红）；
 *   2. 打印块里引用的每个 CSS 变量**必须在 :root 里定义过**
 *      —— 这一条是有来历的：仓库注释里记着 `var(--success)` 曾经压根不存在，
 *      整条声明静默失效，"已安排复习"的绿色提示一直是假的；
 *   3. 隐藏清单里**不许**出现正文根（main / .content / body / .card），
 *      否则就是"打印出一张白纸"这种最糟的错法。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync('src/style.css', 'utf8')

/** 取出 `@media print { … }` 的内容（按花括号配平，注释里没有花括号）。 */
function printBlock() {
  const at = CSS.indexOf('@media print')
  if (at === -1) return ''
  const open = CSS.indexOf('{', at)
  let depth = 0
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1
    else if (CSS[i] === '}') {
      depth -= 1
      if (depth === 0) return CSS.slice(open + 1, i)
    }
  }
  return ''
}

/** 去掉注释，避免把说明文字当成规则。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

const BLOCK = stripComments(printBlock())

/** 把打印块拆成顶层规则 {selector, body}。 */
function rules(text) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '{') {
      if (depth === 0) {
        const selector = text.slice(start, i).trim()
        const open = i
        let inner = 0
        for (let j = i; j < text.length; j += 1) {
          if (text[j] === '{') inner += 1
          else if (text[j] === '}') {
            inner -= 1
            if (inner === 0) {
              out.push({ selector, body: text.slice(open + 1, j) })
              i = j
              start = j + 1
              break
            }
          }
        }
      } else depth += 1
    }
  }
  return out
}

const RULES = rules(BLOCK)
/** 摊平成**单个**选择器：一条 `.a, .b, .c { display: none }` 算三个，不是一条。 */
const HIDDEN = RULES
  .filter((rule) => /display:\s*none/.test(rule.body))
  .flatMap((rule) => rule.selector.split(',').map((part) => part.trim()).filter(Boolean))

/** 源码全文（用于"选择器是否真实存在"的自证）。 */
function sourceText() {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(vue|css|js)$/.test(entry)) files.push(path)
    }
  }
  walk('src')
  return files.map((file) => {
    const text = readFileSync(file, 'utf8')
    // ⚠ 必须把**打印块自身**从语料里去掉，否则自证是同义反复：
    // 往打印块里写任何选择器，都能在"源码"（也就是这个文件）里找到它自己。
    // 第三十三轮变异 P7 实测：加一个 .zz-nonexistent 仍然是绿的。
    return file.endsWith('style.css') ? text.replace(/@media print[\s\S]*$/, '') : text
  }).join('\n')
}
const SOURCE = sourceText()

/** 打印块里出现的所有类/ID 选择器（跳过纯标签、伪元素、at-rule、十六进制颜色）。 */
function classSelectors(text) {
  const found = new Set()
  for (const match of text.matchAll(/([.#][\w-]+)/g)) {
    const token = match[1]
    if (!/^[.#]\w/.test(token)) continue
    // `#000000` 这种十六进制颜色与 `#id` 写法撞车，必须排掉，
    // 否则自证会把每个颜色值都当成一个找不到的选择器。
    if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(token)) continue
    found.add(token)
  }
  return [...found]
}

/**
 * 这个名字在源码里是否真实存在。
 *
 * 不能只找 CSS 写法（`.task-center`）：有的类只出现在模板的类属性里
 * （`class="task-center"`），只查选择器写法会把它误判成"找不到"。
 */
function nameExistsInSource(token) {
  const name = token.slice(1)
  const pattern = new RegExp(`(^|[\\s"':.])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
  return pattern.test(SOURCE)
}

describe('打印样式：外壳隐藏、滚动展开、主题归零', () => {
  it('存在一个非平凡的 @media print 块，并且放在文件最后', () => {
    expect(BLOCK.length, '没有找到打印样式块').toBeGreaterThan(300)
    const end = CSS.lastIndexOf('@media print')
    const tail = CSS.slice(end)
    // 打印块之后只允许出现 @page（页面留白），不允许再有任何会覆盖它的规则。
    expect(tail.replace(/@media print[\s\S]*?\n\}\n?/, '').replace(/@page\s*\{[\s\S]*?\}/, '').trim()).toBe('')
  })

  it('隐藏清单盖住了全部外壳与浮层', () => {
    const hidden = HIDDEN.join(' ')
    for (const selector of [
      '.atmo-layer',
      '.sidebar',
      '.task-center',
      '.overlay',
      '.toast',
      '.skip-to-content',
      '.global-safe-mode-alert',
      '.global-persistence-alert',
      '.global-sync-alert',
    ]) {
      expect(hidden, `${selector} 没被隐藏`).toContain(selector)
    }
    expect(HIDDEN.length, '隐藏清单太短了，像是什么都没写').toBeGreaterThanOrEqual(6)
  })

  it('隐藏清单里绝不允许出现正文根（那样会印出一张白纸）', () => {
    const hidden = HIDDEN.join(' ')
    for (const forbidden of [
      'main',
      '#main-content',
      '.content',
      '.layout',
      'body',
      '.card',
      'table',
      '.timetable-wrap',
      '.list-sidebar',
    ]) {
      // 用后向断言避免 .content 误命中 .content-narrow 之外的写法
      const pattern = forbidden.startsWith('.') || forbidden.startsWith('#')
        ? new RegExp(`${forbidden.replace('.', '\\.')}(?![\\w-])`)
        : new RegExp(`(^|[,\\s])${forbidden}(?![\\w-])`)
      expect(pattern.test(hidden), `正文根 ${forbidden} 被隐藏了`).toBe(false)
    }
  })

  it('课程表的横向滚动容器必须展开（否则右侧的列印不出来）', () => {
    const wrap = RULES.find((r) => r.selector.includes('.timetable-wrap'))
    expect(wrap, '打印块里没有 .timetable-wrap 规则').toBeTruthy()
    const all = RULES.filter((r) => r.selector.includes('.timetable-wrap')).map((r) => r.body).join(' ')
    expect(all, '滚动容器没展开').toContain('overflow: visible')
    expect(all, '滚动容器还是被限高').toContain('max-height: none')
  })

  it('主题令牌归零，且每个变量都真的在 :root 里定义过', () => {
    const themeRule = RULES.find((r) => r.selector === ':root')
    expect(themeRule, '打印块里没有 :root 令牌覆盖').toBeTruthy()
    const declared = new Set([...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    const overridden = [...themeRule.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    expect(overridden.length, '覆盖的令牌太少').toBeGreaterThanOrEqual(5)
    for (const [, name, value] of overridden.map((m) => [, m[1], m[2]])) {
      expect(declared.has(name), `覆盖了不存在的变量 ${name}——整条声明会静默失效`).toBe(true)
      expect(value, `${name} 没有 !important，压不住组件样式`).toContain('!important')
    }
    expect(themeRule.body).toContain('--text: #000000')
  })

  it('正文容器改回白底黑字', () => {
    const rule = RULES.find((r) => /(^|,)\s*\.content\s*(,|$)/.test(r.selector) && /background/.test(r.body))
    expect(rule, '没有把 .content 的背景改回白色').toBeTruthy()
    expect(rule.body).toContain('background: #ffffff')
    expect(rule.body).toContain('color: #000000')
  })

  it('有 @page 留白，且卡片与表格行不会被切成两半', () => {
    expect(CSS, '缺少 @page 规则').toMatch(/@page\s*\{[^}]*margin/)
    const avoid = RULES.filter((r) => /break-inside:\s*avoid/.test(r.body))
    expect(avoid.length, '没有 break-inside: avoid').toBeGreaterThan(0)
    expect(avoid.map((r) => r.selector).join(' '), '表格行没被保护').toContain('tr')
    expect(RULES.some((r) => /break-after:\s*avoid/.test(r.body)), '标题后应避免分页').toBe(true)
  })

  it('自证：打印块里的每个类/ID 选择器都在源码中真实存在', () => {
    // 两个坑：(1) 切片必须从**真正的** @page 规则开始——用 indexOf('@page') 会命中
    // 注释里的字面量（"外壳留白交给 @page。"），于是切进来的一段是注释；
    // (2) 注释里的类名不是选择器，拼完必须再剥一次注释。
    const tokens = classSelectors(stripComments(`${BLOCK}\n${CSS.slice(CSS.search(/^@page\s*\{/m))}`))
    expect(tokens.length, '取到的选择器太少，自证没有意义').toBeGreaterThanOrEqual(10)
    const dangling = tokens.filter((token) => !nameExistsInSource(token))
    expect(dangling, `这些选择器在源码里找不到：${dangling.join('、')}`).toEqual([])
  })
})