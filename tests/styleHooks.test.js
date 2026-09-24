// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 「样式钩子写好了、接线从没做」是本项目反复出现的一类缺陷：
 *   - style.css 定义了 [aria-invalid='true'] 无效态，但全仓没有一处设置 aria-invalid；
 *   - 定义了 .btn[aria-busy='true'] 的 spinner，但没有一处按钮绑 aria-busy；
 *   - 定义了 button.tap-target / .icon-btn 的 44px 触控目标，但两者都零使用；
 *   - 定义了 --on-primary / --on-danger，但 --on-danger 使用次数是 0。
 * 后果是「看起来做了优化」，实际线上完全没生效。这条测试把「style.css 里定义的
 * 工具类必须真的被引用」变成机械可查的约束。
 *
 * 第二轮把同一件事扩到自定义属性：src/style.css 与 src/composables/theme.js 里
 * 声明的每个 --* 令牌，都必须在 src/ 里被 var(--*) 读到、或被 setProperty('--*')
 * 写到。--radius-m、--fs-module-title、--fs-card-title、--fs-num-hero、
 * --fs-num-big 这些「令牌铺好了、没人消费」是同一类缺陷的字符串版：
 * 它们让设计系统看起来比实际完整。
 *
 * 例外清单必须保持为空以外的极小集合，而且每一项都要写清为什么它就该留着。
 */

const root = resolve(import.meta.dirname, '..')
const srcDir = resolve(root, 'src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/**
 * 去掉注释，再提取定义与消费。
 *
 * 不这么做就会把注释里的字符串当成真实代码：类名版本踩过的坑是注释里的
 * "audit-contrast.mjs" 被当成类名，令牌版本刚踩到的坑是 theme.js 的文档注释里
 * 写着的「--primary/--danger」被当成两个令牌的定义。
 *
 * 这里用一个认识引号的小扫描器，而不是裸正则：字符串里的 `//`（URL、模板片段）
 * 不能当成行注释，否则同一行后面真正的 `var(--x)` 会被一起吃掉，制造假失败。
 * **第五十四轮末修正**：原来的实现"接受引号被模板/正则里的引号打乱"——当时的理由是
 * "最坏只是少删一段注释，不会删掉代码"。实测那份取舍是有代价的：\`src/views/LedgerView.vue:483\`
 * 的 \`return /[",\n\r]/.test(text) ? …\` 会让引号配平永久错位，其后 **2711 行的行首全都"处在
 * 字符串里"**，注释再也剥不掉。而本守卫的断言方向恰恰是**假阴性**（注释里提到的钩子被当成
 * "已接线"、注释里的令牌被当成"有读取点"），正是最不该松的方向。
 * 现在两条机制叠加：**认得正则字面量**（关键字后允许，\`<\`/\`>\` 后不允许——模板里的 \`</div>\`
 * 会骗到判据）+ **引号必须找得到配对标点**（\`"\`/\`'\` 只在同一行内找，反引号在整个文件里找），
 * 于是任何残留误判的伤害都被锁死在单行内，既不再"漏剥一大段"，也不会删掉真代码。
 */
function stripComments(source) {
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
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      out += ' '
      continue
    }
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
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

/** 关键字之后允许正则（`return /re/`）；`<`/`>` 之后一律不允许。 */
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await', 'throw',
])
function startsRegex(prevSig, prevWord) {
  if (!prevSig) return true
  if (prevWord && REGEX_KEYWORDS.has(prevWord)) return true
  return !/[A-Za-z0-9_$)\]}"'`<>]/.test(prevSig)
}

/** 引号后面有没有未转义的配对标点（`"`/`'` 限本行，反引号限整个文件）。 */
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

const allFiles = walk(srcDir)
const cleaned = new Map(
  allFiles.map((file) => [
    file,
    // .vue 模板里的 HTML 注释同样要先去掉
    stripComments(readFileSync(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, ' '),
  ]),
)

const pathOf = (suffix) => allFiles.find((file) => file.endsWith(suffix))
const styleCss = cleaned.get(pathOf('style.css'))
const themeJs = cleaned.get(pathOf('theme.js'))
const motionJs = cleaned.get(pathOf('motion.js'))

// style.css 里定义的类名（先去掉注释，否则注释里出现的 "audit-contrast.mjs"
// 会被 .name 的正则当成一个类名）
const defined = new Set()
for (const match of styleCss.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(match[1])

const haystack = allFiles.map((file) => cleaned.get(file)).join('\n')

const unused = [...defined].filter((name) => !new RegExp(`\\b${name}\\b`).test(haystack)).sort()

/**
 * 令牌的定义来源只有两处（与 DESIGN_TOKENS.md 的口径一致）：
 *   - src/style.css 里的 `--x: …` 声明；
 *   - src/composables/theme.js 里的 '--x' 字符串字面量（THEME_VARIABLES 与字面量
 *     setProperty 调用）——那是主题模块运行时自己写入的令牌。
 * `setProperty(`--${kebab(name)}`)` 这种动态拼接的名字静态扫不到，所以它天然
 * 不会被当成定义；这些令牌靠下面第二条断言（必须有 var() 读取点）兜住。
 */
function cssDeclaredTokens(css) {
  const names = new Set()
  for (const match of css.matchAll(/(^|[;{\s])(--[a-zA-Z][\w-]*)\s*:/g)) names.add(match[2])
  return names
}

function themeDeclaredTokens(js) {
  const names = new Set()
  for (const match of js.matchAll(/['"`](--[a-zA-Z][\w-]*)['"`]/g)) names.add(match[1])
  return names
}

const declaredTokens = [...new Set([...cssDeclaredTokens(styleCss), ...themeDeclaredTokens(themeJs)])].sort()

// 消费 = 被 var() 读到，或被 setProperty('--x') 写到。名字后面只允许是分隔符，
// 否则 var(--fs-body) 会被当成 var(--fs-body-legacy) 的消费。
// （注意：declaredTokens 里的名字自带 -- 前缀，正则里不要再补一个。）
const isReadByVar = (name) => new RegExp(`var\\(\\s*${name}(?![\\w-])`).test(haystack)
const isWrittenBySetter = (name) =>
  new RegExp(`setProperty\\(\\s*['"\`]${name}['"\`]`).test(haystack)

const deadTokens = declaredTokens.filter((name) => !isReadByVar(name) && !isWrittenBySetter(name))

describe('style.css 的工具类必须真的被接线', () => {
  it('没有「定义了却零引用」的工具类', () => {
    // 例外清单当前为空。加东西进来之前先问：能不能改成直接用
    // aria-invalid / aria-busy 这类标准属性，而不是再留一套类名。
    expect(unused).toEqual([])
  })

  it('触控目标钩子确实用上了（不是只写在样式表里）', () => {
    expect(styleCss).toMatch(/button\.tap-target/)
    const templateFiles = allFiles.filter((file) => file.endsWith('.vue'))
    const users = templateFiles.filter((file) => /tap-target/.test(cleaned.get(file)))
    // 弹窗关闭、通知关闭、模板删除、侧边栏「更多功能」关闭
    expect(users.length).toBeGreaterThanOrEqual(4)
  })
})

describe('设计令牌必须真的被消费', () => {
  it('style.css 与 theme.js 里没有「声明了却零消费」的自定义属性', () => {
    // 先确认守卫真的扫到了东西：正则写坏时 declaredTokens 会静默变空，
    // 断言永远通过 —— 那是最糟的假绿。
    expect(declaredTokens.length).toBeGreaterThan(20)
    expect(deadTokens, `只声明不消费的令牌：${deadTokens.join(', ')}`).toEqual([])
  })

  it('theme.js 动态拼接写入的调色板令牌都有静态可查的 var() 读取点', () => {
    // 「跟随系统」分支用 setProperty(`--${kebab}`) 一次写 18 个变量，静态扫描看不到
    // 名字。它们的来源是 getSystemThemeColors() 的返回键，与 THEME_VARIABLES 一一对应；
    // 要求每个都有 var() 读取点，就不必为这种动态消费开例外清单，
    // 也不会因为「写进去了」就误判成「有人在用」。
    const written = [...themeDeclaredTokens(themeJs)].sort()
    expect(written.length).toBeGreaterThanOrEqual(18)
    const notRead = written.filter((name) => !isReadByVar(name))
    expect(notRead, `theme.js 会写入但全仓没有 var() 读取点：${notRead.join(', ')}`).toEqual([])
  })

  it('全仓被写过的自定义属性都必须有 var() 读取点（只写不读就是死）', () => {
    // 【第三十六轮新增】原来的口径是「消费 = 被 var() 读到 **或** 被 setProperty 写到」，
    // 而且定义来源只扫 style.css 与 theme.js。于是 `festive.js` 里
    // `setProperty('--atmosphere-decor', …)` 既是"定义"又是"消费"，
    // 一个**全仓没有任何 var() 读取点**的令牌就这么活了下来（已删）。
    //
    // 这条把上面那条对 theme.js 的标准推广到全仓所有写入方：
    // 只要写过（setProperty / removeProperty），就必须有人读。
    const written = [
      ...new Set(
        [...haystack.matchAll(/(?:set|remove)Property\(\s*['"`](--[a-zA-Z][\w-]*)['"`]/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort()
    // 自证：正则写坏时会静默变空，断言永远通过。
    expect(written.length, '没扫到任何写入点，这条守卫没有意义').toBeGreaterThanOrEqual(8)
    const notRead = written.filter((name) => !isReadByVar(name))
    expect(notRead, `被写入但全仓没有 var() 读取点：${notRead.join(', ')}`).toEqual([])
  })

  it('--dur-reveal 这条 CSS/JS 双份令牌两边都真的在用', () => {
    // CSS 侧由 ::view-transition-group(root) 消费，JS 侧由 motion.js 的 MOTION.reveal
    // （WAAPI 的 duration 与兜底计时器）消费；tests/motionTokens.test.js 另外断言
    // 两者的值必须一致。删掉任何一侧都会让这条测试或那条测试失败。
    expect(styleCss).toMatch(/var\(--dur-reveal(?![\w-])/)
    expect(motionJs).toMatch(/MOTION\.reveal/)
  })
})