// @vitest-environment node
/**
 * 自造浮层必须有 Escape 出口（第二十一轮）。
 *
 * 起因是一个真缺口：`Modal`、`ActionSheet`、`ContextMenu` 三个浮层都处理 Escape，
 * 只有 `Sidebar.vue` 里的「更多功能」浮层漏了——键盘用户必须一路 Tab 到那个
 * 「关闭更多功能」的 × 才能收起来。这是**与仓库自身约定不一致**，不是新立的规矩。
 *
 * 【判据】
 *   1. 组件模板里出现「浮层」——类名含 mask/overlay/sheet/backdrop/popover
 *      （只要在 `-`/空格/首尾的边界上，避免 `damask` 这种子串误判），
 *      或者角色是 `dialog`/`alertdialog`/`menu`/`menubar`；
 *   2. 且它**没有**委托给共享浮层（用了 `<Modal>` / `<ActionSheet>` 就自动放行，
 *      那两个组件自己处理 Escape，重复实现反而会互相打架）；
 *   那么源码里必须出现 `Escape`。
 *
 * 【为什么排除 listbox】`QuickRecordPanel` 里的分类选择器是 `role="listbox"`，
 * 但它是**内联展开**在录音面板里的，不是浮层——按 WAI-ARIA，就地展开的列表
 * 由输入框自己处理 Esc，不需要浮层级的监听。把它算进来会直接假警。
 *
 * 【自证不空转】除了断言全仓为 0，还断言真的detect 到了足够多的浮层文件，
 * 并且点得出 ActionSheet / ContextMenu / Modal / Sidebar 这几个已知浮层——
 * 判据写坏时命中数会掉到 0，那种假绿比漏报更危险（这个仓库已经踩过两次）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readTemplate, walkElements, walkVueFiles } from './helpers/vueTemplate.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

/** 浮层类名关键词，要求落在 `-`/空格/首尾的边界上。 */
const FLOATING_CLASS = /(?:^|[\s-])(mask|overlay|sheet|backdrop|popover)(?=$|[\s-])/
/** 需要 Escape 的浮层角色（`listbox` 刻意不收，见文件头）。 */
const FLOATING_ROLE = /(?:^|\s)role="(dialog|alertdialog|menu|menubar)"/
/** 委托给共享浮层：它们自己处理 Escape。 */
const SHARED_OVERLAY = /<(Modal|ActionSheet)\b/

/**
 * 真正处理 Escape 的**代码**签名。
 *
 * 为什么不是简简单单搜 `Escape` 这个词：第一版就是那么写的，变异实验当场打脸——
 * 把 `Sidebar.vue` 的处理器删掉、只留注释里那几处 "Escape"，判据照样全绿。
 * 也就是说那条判据只证明「文件里有人提过 Escape」，证明不了「按键真的被处理」。
 * （同类坑这个仓库踩过好几次：UX_AUDIT_176_REPORT.md §1.18 / §1.29 / §1.30。）
 *
 * 所以要求真实写法之一：和 `'Escape'` 做**比较**（`===` / `==` / `!==` / `!=`，两边都算）
 * 或 `case 'Escape':`，并且只在**剥掉注释之后**的代码里找。
 * 注意 `!==` 也必须认——`Sidebar.vue` 的写法就是 `if (event.key !== 'Escape' …) return`，
 * 第一版签名只认 `===`，结果把已经修好的代码报成缺陷（假警方向，同样要修）。
 */
const ESCAPE_IN_CODE = /(?:===|!==|==|!=)\s*['"]Escape['"]|['"]Escape['"]\s*(?:===|!==|==|!=)|case\s+['"]Escape['"]/

/**
 * 剥掉注释（HTML 注释与 JS 注释；保留字符串内容——`'Escape'` 本身就是字符串）。
 *
 * 已知边界（第五十四轮末修正）：朴素状态机遇到**正则字面量**里的引号会永久错位。
 * 实测 `src/views/LedgerView.vue:483`（`return /[",\n\r]/.test(text) ? …`）之后 2713 行的行首
 * 全都"处在字符串里"，**注释再也剥不掉**（方向是假阳性：注释里引用的旧写法被当成真命中）。
 * 修法不是"去解析正则字面量"——那样会被模板里的 `</div>` 骗到（斜杠前面是 `<`，会被当成
 * 正则起点），实测把 AppearanceSettings.vue 的 L431~L584 **真实模板代码**当块注释剥掉（假阴性，
 * 比假阳性危险）。现在的口径是：**绝不进入跨行且永不闭合的模式**——引号若在本行/本文件里
 * 找不到配对标点，就当普通字符，于是误判的伤害被锁死在单行内。
 * （同一份实现也被另外几个源码扫描类守卫抄了去，本轮只修了与"禁原生弹窗"棘轮直接相关的这两份。）
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  let quote = null
  let prevSig = ''
  let prevWord = ''
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue }
      if (ch === quote) quote = null
      out += ch
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      if (hasClosingQuote(source, i, ch)) quote = ch
      out += ch
      i += 1
      prevSig = ch
      prevWord = ''
      continue
    }
    if (ch === '/' && next !== '/' && next !== '*' && startsRegex(prevSig, prevWord)) {
      out += ch
      i += 1
      let inClass = false
      while (i < source.length) {
        const c = source[i]
        if (c === '\\') { out += c + (source[i + 1] ?? ''); i += 2; continue }
        if (c === '\n') break // 正则不能跨行 ⇒ 上面那个判断是误判，退出并当作普通字符
        if (c === '[') inClass = true
        else if (c === ']') inClass = false
        out += c
        i += 1
        if (c === '/' && !inClass) break
      }
      prevSig = '/'
      prevWord = ''
      continue
    }
    if (ch === '<' && source.startsWith('<!--', i)) {
      while (i < source.length && !source.startsWith('-->', i)) i += 1
      i += 3
      continue
    }
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += ch
    i += 1
    if (!/\s/.test(ch)) {
      const isIdent = /[A-Za-z0-9_$]/.test(ch)
      if (!isIdent) prevWord = ''
      else prevWord = /[A-Za-z0-9_$]/.test(prevSig) ? prevWord + ch : ch
      prevSig = ch
    }
  }
  return out
}

/**
 * `/` 什么时候可能是正则起点：
 * - 行首；
 * - 上一个有意义字符是"不可能是操作数结尾"的那种（运算符、`(`、`,`、`=`、`:`、`[`、`!`、`&`、`|`、`?`、`;`、`{` …）；
 * - 或者紧邻的那个词是**关键字**（`return /re/`、`typeof /re/`）。
 * 标识符、数字、`)`、`]`、字符串、模板之后一定是除号。
 * **`<` 与 `>` 也一律不算**：模板里 `</div>` 的斜杠曾经被当成正则起点，导致整段模板被误判
 * （实测 AppearanceSettings.vue 的 L431~L584 真实模板代码被当块注释剥掉——假阴性，比假阳性危险）。
 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await', 'throw',
])
function startsRegex(prevSig, prevWord) {
  if (!prevSig) return true
  if (prevWord && REGEX_KEYWORDS.has(prevWord)) return true
  return !/[A-Za-z0-9_$)\]}"'`<>]/.test(prevSig)
}

/**
 * `from` 处的引号后面还有没有**未转义的**同类引号：
 * - `"` / `'`：只在**同一行内**找（JS 里单双引号字符串不能跨行，找不到就说明这个引号
 *   其实在正则字面量或别的构造里，不该当成字符串起点）；
 * - 反引号：在**整个文件**里找（模板字面量可以跨行，这是合法用法）。
 * 这条兜底把任何残留误判的伤害锁死在**单行**里。
 */
function hasClosingQuote(source, from, quote) {
  const limit = quote === '`' ? source.length : endOfLine(source, from)
  let j = from + 1
  while (j < limit) {
    const c = source[j]
    if (c === '\\') { j += 2; continue }
    if (c === quote) return true
    j += 1
  }
  return false
}

/** 本行结束位置（不含换行符）。 */
function endOfLine(source, from) {
  const nl = source.indexOf('\n', from)
  return nl === -1 ? source.length : nl
}
describe('剥注释器认得正则字面量（守卫的地基也要有夹具）', () => {
  const SAMPLE = [
    'function csvCell(value) {',
    "  const text = String(value ?? '')",
    '  return /[",\\n\\r]/.test(text) ? `"${text.replace(/"/g, \'""\')}"` : text',
    '}',
    "// window.confirm('旧写法') —— 这句注释必须被剥掉",
    'const after = 1',
  ].join('\n')

  it('修好后：正则行之后的注释照样被剥掉', () => {
    const stripped = stripComments(SAMPLE)
    expect(stripped).not.toContain('window.confirm')
    expect(stripped).toContain('const after = 1')
  })

  it('反向保护：字符串里的 // 不许被当成注释切掉', () => {
    expect(stripComments("const u = 'http://example.com/x'\nconst z = 1\n")).toContain('http://example.com/x')
  })
})

const classNameOf = (attrs) => attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? ''

/** 找出模板里的浮层元素。 */
export function findFloatingPanels(template) {
  return [...walkElements(template)]
    .filter(({ attrs }) => FLOATING_CLASS.test(classNameOf(attrs)) || FLOATING_ROLE.test(attrs))
    .map(({ tag, line }) => ({ tag, line }))
}

/**
 * 返回问题描述列表；空数组表示合格。
 * `source` 是整个 .vue 源码（Escape 的处理写在 `<script>` 里，模板只看得到绑定）。
 */
export function overlayEscapeIssues(template, source) {
  if (SHARED_OVERLAY.test(template)) return []
  const panels = findFloatingPanels(template)
  if (!panels.length) return []
  if (ESCAPE_IN_CODE.test(stripComments(source))) return []
  return panels.map((p) => `<${p.tag}@${p.line}> 是浮层，但源码里找不到 Escape 出口`)
}

describe('自造浮层必须能用 Escape 收起', () => {
  const files = walkVueFiles(srcDir)
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('全仓没有「有浮层却没有 Escape 出口」的组件', () => {
    const found = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return overlayEscapeIssues(readTemplate(file), source).map((issue) => `${rel(file)} ${issue}`)
    })
    expect(found).toEqual([])
  })

  it('自证不空转：确实点得出已知的浮层，且它们都因为真有 Escape 而放行', () => {
    const withPanels = files
      .filter((file) => findFloatingPanels(readTemplate(file)).length > 0)
      .map(rel)
    // 数量下限：判据写坏时这里会掉到 0（那种假绿比漏报更危险）
    expect(withPanels.length).toBeGreaterThan(3)
    for (const known of ['components/ActionSheet.vue', 'components/ContextMenu.vue', 'components/Modal.vue', 'components/Sidebar.vue']) {
      expect(withPanels, `${known} 应当被认成浮层`).toContain(known)
    }
  })

  it('夹具：抓得住真正的缺失，也放过内联控件与委托写法', () => {
    const noEsc = '<template><div class="more-sheet"><button>x</button></div></template>'
    expect(overlayEscapeIssues(noEsc, noEsc)).toHaveLength(1)

    const noEscMenu = '<template><div role="menu" aria-label="操作"><button>x</button></div></template>'
    expect(overlayEscapeIssues(noEscMenu, noEscMenu)).toHaveLength(1)

    const hasEsc = '<template><div class="more-sheet"></div></template>'
    expect(overlayEscapeIssues(hasEsc, `${hasEsc}<script>if (e.key === 'Escape') close()</script>`)).toEqual([])
    // 反向比较也算（Sidebar 用的就是这种）
    expect(overlayEscapeIssues(hasEsc, `${hasEsc}<script>if (e.key !== 'Escape') return; close()</script>`)).toEqual([])
    // case 写法也算
    expect(overlayEscapeIssues(hasEsc, `${hasEsc}<script>switch (e.key) { case 'Escape': close() }</script>`)).toEqual([])

    // **这条是变异实验抓出来的**：只在注释/文档里提到 Escape 不算处理
    const talkOnly = '<template><div class="more-sheet"></div></template>'
    const commented = `${talkOnly}<script>\n// 这里本该处理 Escape\n/* Escape 出口待补 */\nfunction noop() {}\n</script>`
    expect(overlayEscapeIssues(talkOnly, commented), '注释里提到 Escape 不算数').toHaveLength(1)
    // 字符串里出现 Escape 但没做比较，也不算
    const stringOnly = `${talkOnly}<script>const label = 'Escape'</script>`
    expect(overlayEscapeIssues(talkOnly, stringOnly)).toHaveLength(1)

    // 委托给共享浮层：它自己处理 Escape，不该要求调用方再写一遍
    const delegated = '<template><Modal :open="x"><div class="modal-mask">内容</div></Modal></template>'
    expect(overlayEscapeIssues(delegated, delegated)).toEqual([])

    // 精度：内联展开的 listbox 不是浮层
    const listbox = '<template><span role="listbox" aria-label="选择分类"><button role="option">x</button></span></template>'
    expect(overlayEscapeIssues(listbox, listbox)).toEqual([])

    // 精度：普通容器与只做传播控制的遮罩点击回调都不算
    expect(overlayEscapeIssues('<template><div class="card" @click.self="close">x</div></template>', '<template></template>')).toEqual([])
    // 精度：子串不算（damask 里没有 mask 这个「词」）
    const damask = '<template><div class="damask">x</div></template>'
    expect(findFloatingPanels(damask)).toEqual([])
  })
})