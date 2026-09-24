// @vitest-environment happy-dom
/**
 * 程序化（JS 发起的）平滑滚动必须受「减少动态效果」约束。
 *
 * 【为什么需要单独一条守卫】
 * `style.css` 里有一条全局降级：
 *
 *   @media (prefers-reduced-motion: reduce) { *, *::before, *::after {
 *     scroll-behavior: auto !important; transition-duration: 0.01ms !important; … } }
 *
 * 它管得住 CSS transition/animation，**管不住 JS**：`scrollIntoView({behavior:'smooth'})`
 * 这类调用里显式给出的 behavior **优先于** CSS 的 `scroll-behavior` 属性。这条原理
 * `motion.js` 的文件头已经写明（「凡是从 JS 发起的动效都要先问 animationsEnabled()」），
 * 仓库里也有写对了的样板（`VirtualList.scrollToIndex`）。
 * 但本轮实测仍有 4 处漏改，而且都是用户能明显看到的位移：
 *   - `focusNavigation.scrollAndHighlight` —— 全应用最频繁的程序化滚动，
 *     「从首页跳到某条笔记/某笔账单/某门课」都走它；
 *   - `DataManager.jumpToSection` —— 数据管理页分区很长；
 *   - `main.js` 的路由 `scrollBehavior` 锚点分支；
 *   - `WheelPicker.scrollToIndex` —— 滚轮选择器整列滚动，视觉位移最大。
 *
 * 【两条规则，各有边界】
 * 规则一（精确）：`behavior: 'smooth'` 这种**直接赋值字面量**，必须在它所在的括号表达式里
 *   出现 `animationsEnabled()`。门控后的写法是 `behavior: animationsEnabled() ? 'smooth' : 'auto'`，
 *   不再是「赋值字面量」，所以本规则只会在**没门控**时命中——这正是它检测力的来源。
 *   不匹配 `behavior === 'smooth'`（比较，不是传值）与 `behavior` 变量透传。
 * 规则二（粗但零假阳性）：**任何提到 `'smooth'` 的文件都必须引用 `animationsEnabled()`**。
 *   这条专为「把 `'smooth'` 当参数透传给自己的滚动函数」而设——`WheelPicker` 的 4 个调用点
 *   `scrollToIndex(next, 'smooth')` 就是这么写的，规则一看不出来。它不看具体位置，
 *   所以可能有假阴性（文件里别处门控了、这一处没门控），但**不会有假阳性**，
 *   当前全仓命中 0、不需要任何例外清单。
 *
 * 【已知边界】注释会被剥掉再扫（否则解释文字里的 `behavior: 'smooth'` 会形成长期命中）；
 * 剥行注释的正则不吞 `https://`；只扫 `src/`（`functions/` 是 Worker，没有 DOM）；
 * 不解析 CSS `scroll-behavior: smooth`（那一条已被全局 `!important` 覆盖，是正确的写法）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollAndHighlight } from '../src/composables/focusNavigation.js'
import { performanceMode } from '../src/composables/performanceMode.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

function walkSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walkSources(full, out)
    else if (/\.(vue|js)$/.test(name)) out.push(full)
  }
  return out
}

/** 剥掉 HTML / 块 / 行注释；行注释正则刻意不吞 `https://`。 */
export function stripComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 取 `index` 处最内层的括号表达式（`(…)` 或 `{…}`）。
 * 用于划定「这一个调用/这一个对象字面量」的范围，而不是模糊的「附近几行」。
 */
export function enclosingExpression(source, index) {
  let depth = 0
  let open = -1
  for (let i = index - 1; i >= 0; i--) {
    const c = source[i]
    if (c === ')' || c === '}') depth += 1
    else if (c === '(' || c === '{') {
      if (depth === 0) { open = i; break }
      depth -= 1
    }
  }
  if (open === -1) return source.slice(0, index)
  const opener = source[open]
  const closer = opener === '(' ? ')' : '}'
  let d = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === opener) d += 1
    else if (source[i] === closer) {
      d -= 1
      if (d === 0) return source.slice(open, i + 1)
    }
  }
  return source.slice(open)
}

/** 规则一：直接赋值 `behavior: 'smooth'` 却不在同一表达式里门控。 */
export function findUngatedSmoothBehavior(source) {
  const code = stripComments(source)
  const out = []
  for (const m of code.matchAll(/behavior:\s*'smooth'/g)) {
    const scope = enclosingExpression(code, m.index)
    if (!scope.includes('animationsEnabled')) out.push(scope.replace(/\s+/g, ' ').slice(0, 90))
  }
  return out
}

/** 规则二：提到 `'smooth'` 却不引用门控函数的文件。 */
export function findFilesWithoutMotionGate(source) {
  const code = stripComments(source)
  return code.includes("'smooth'") && !code.includes('animationsEnabled')
}

describe('程序化平滑滚动必须门控', () => {
  const files = walkSources(srcDir)
  const loaded = files.map((file) => ({ file, source: readFileSync(file, 'utf8') }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')
  const smoothFiles = loaded.filter(({ source }) => stripComments(source).includes("'smooth'"))

  it('扫描规模自证：确实找到了引用平滑滚动的文件', () => {
    // 实测 5 个：focusNavigation / DataManager / VirtualList / WheelPicker / main
    expect(files.length, 'src 下没扫到源文件').toBeGreaterThan(60)
    expect(smoothFiles.length, '仓库里再也找不到平滑滚动').toBeGreaterThanOrEqual(5)
  })

  it('规则一：没有未门控的 `behavior: \'smooth\'`', () => {
    const offenders = loaded.flatMap(({ file, source }) => findUngatedSmoothBehavior(source)
      .map((scope) => `${rel(file)} → ${scope}`))
    expect(offenders).toEqual([])
  })

  it("规则二：凡是提到 'smooth' 的文件都引用了 animationsEnabled", () => {
    const offenders = smoothFiles
      .filter(({ source }) => findFilesWithoutMotionGate(source))
      .map(({ file }) => rel(file))
    expect(offenders).toEqual([])
  })

  it('自证：两种门控写法都确实在用（否则规则一/二可能在守空气）', () => {
    const all = loaded.map(({ source }) => stripComments(source)).join('\n')
    // 三元形态：behavior: animationsEnabled() ? 'smooth' : 'auto'
    const ternary = (all.match(/animationsEnabled\(\)\s*\?\s*'smooth'\s*:\s*'auto'/g) || []).length
    // 取反形态：behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior
    const negated = (all.match(/!\s*animationsEnabled\(\)/g) || []).length
    expect(ternary, '三元门控写法消失了').toBeGreaterThanOrEqual(3)
    expect(negated, '取反门控写法消失了').toBeGreaterThanOrEqual(2)
  })

  it('核实四个曾经的漏洞点现在都门控了', () => {
    const read = (p) => stripComments(readFileSync(resolve(srcDir, p), 'utf8'))
    for (const p of [
      'composables/focusNavigation.js',
      'components/DataManager.vue',
      'components/WheelPicker.vue',
      'main.js',
    ]) {
      expect(read(p), `${p} 不再门控平滑滚动`).toContain('animationsEnabled')
    }
    // 全应用最频繁的那一处：必须是三元形态，不能被「顺手的重构」退回字面量
    expect(read('composables/focusNavigation.js')).toMatch(/behavior:\s*animationsEnabled\(\)\s*\?\s*'smooth'/)
  })

  // ---- 夹具 ----
  it('夹具：未门控的三元/字面量会被抓出来', () => {
    expect(findUngatedSmoothBehavior("el.scrollIntoView({ block: 'center', behavior: 'smooth' })")).toHaveLength(1)
    expect(findUngatedSmoothBehavior('return { el: to.hash, behavior: "smooth" }')).toEqual([]) // 双引号形态不在判据内
    expect(findUngatedSmoothBehavior("el.scrollTo({ top, behavior: 'smooth' })")).toHaveLength(1)
  })

  it('夹具：门控写法、比较、透传都不得误报', () => {
    expect(findUngatedSmoothBehavior("el.scrollIntoView({ behavior: animationsEnabled() ? 'smooth' : 'auto' })")).toEqual([])
    expect(findUngatedSmoothBehavior("el.scrollTo({ top, behavior: behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior })")).toEqual([])
    // 比较（不是传值）不该被当成传了 smooth
    expect(findUngatedSmoothBehavior("if (behavior === 'smooth') return 1")).toEqual([])
    // 复现 VirtualList 的形态：同一表达式里既有比较又有门控
    expect(findUngatedSmoothBehavior("window.scrollTo({ top: n, behavior: behavior === 'smooth' && !animationsEnabled() ? 'auto' : behavior })")).toEqual([])
  })

  it('夹具：注释里的解释文字不参与判定', () => {
    expect(findUngatedSmoothBehavior("// 显式传 behavior: 'smooth' 会覆盖 CSS\nel.scrollTo({ top })")).toEqual([])
    expect(findUngatedSmoothBehavior("/* behavior: 'smooth' */")).toEqual([])
    // 但注释不能把同一行的真实代码一起吞掉
    expect(findUngatedSmoothBehavior("el.scrollTo({ top }) // 说明")).toEqual([])
    expect(findUngatedSmoothBehavior("el.scrollTo({ top, behavior: 'smooth' }) // 说明")).toHaveLength(1)
  })

  it('夹具：不吞 https:// （否则会把整行代码当注释切掉）', () => {
    const code = "const u = 'https://example.com'; el.scrollTo({ top, behavior: 'smooth' })\n"
    expect(stripComments(code)).toContain("behavior: 'smooth'")
    expect(findUngatedSmoothBehavior(code)).toHaveLength(1)
  })

  it('夹具：规则二按文件判定', () => {
    expect(findFilesWithoutMotionGate("scrollToIndex(next, 'smooth')")).toBe(true)
    expect(findFilesWithoutMotionGate("import { animationsEnabled } from './motion.js'\nscrollToIndex(next, 'smooth')")).toBe(false)
    expect(findFilesWithoutMotionGate('const x = 1')).toBe(false)
  })

  it('夹具：enclosingExpression 划定的是调用/对象边界，不是整行', () => {
    const src = "f(a, { top: 1, behavior: 'smooth' }, b)"
    const idx = src.indexOf("behavior")
    expect(enclosingExpression(src, idx)).toBe("{ top: 1, behavior: 'smooth' }")
    const src2 = "g({ top: 1 }, { behavior: 'smooth' })"
    expect(enclosingExpression(src2, src2.indexOf('behavior'))).toBe("{ behavior: 'smooth' }")
  })
})

/**
 * 运行时验证：源扫描只能证明「写了门控」，证明不了「门控真的生效」。
 * 这里把 performanceMode 分别设成强制流畅 / 强制完整，直接看传下去的 behavior 是什么。
 *
 * 注：「允许动效」那一支本来就有既有测试守着 —— tests/dataManagerRestoreNav.test.js
 * 断言 jumpToSection 传的是 behavior: 'smooth'。补上「减少动效」这一支，两支才都锁住。
 */
describe('运行时：门控真的改变了传下去的 behavior', () => {
  const originalMode = performanceMode.value

  afterEach(() => {
    performanceMode.value = originalMode
    document.body.innerHTML = ''
  })

  function target() {
    const element = document.createElement('div')
    element.dataset.focusId = 'note-1'
    document.body.appendChild(element)
    const spy = vi.fn()
    element.scrollIntoView = spy
    return spy
  }

  it('强制「流畅优先」时，聚焦跳转改为瞬时定位', () => {
    performanceMode.value = 'on'
    const spy = target()
    scrollAndHighlight('note-1', { root: document, highlightMs: 0 })
    expect(spy).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
  })

  it('允许动效时，聚焦跳转仍然是平滑的（不能为了降级把所有人一起降了）', () => {
    performanceMode.value = 'off'
    const spy = target()
    scrollAndHighlight('note-1', { root: document, highlightMs: 0 })
    expect(spy).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('两种模式下都仍然完成了定位（降级不能把滚动本身取消掉）', () => {
    for (const mode of ['on', 'off']) {
      performanceMode.value = mode
      document.body.innerHTML = ''
      const spy = target()
      const el = scrollAndHighlight('note-1', { root: document, highlightMs: 0 })
      expect(el, `${mode} 模式下没有找到目标元素`).not.toBeNull()
      expect(spy, `${mode} 模式下没有滚动`).toHaveBeenCalledTimes(1)
    }
  })
})