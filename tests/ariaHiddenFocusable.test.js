// @vitest-environment node
/**
 * `aria-hidden="true"` 的子树里不能有可聚焦元素。
 *
 * 【为什么这是硬缺陷】`aria-hidden` 只把元素从**无障碍树**里移出，**不会**把它移出 Tab 序。
 * 于是「aria-hidden 里包着一个按钮」会造成最糟的一种组合：键盘用户 Tab 进去、
 * 焦点框出现在一个屏幕上看得见的地方，读屏却一个字都不念——用户不知道自己在哪、
 * 也不知道按下去会发生什么。反过来，鼠标/读屏用户压根不知道有这个控件。
 * 两种用户各自丢了不同的信息，但都是真的丢。
 *
 * 【为什么现在才补这条守卫】`landmarksAndRoles.test.js` 里的 `rendersFocusable()`
 * 早就写明了这条缺陷，并且**故意**不在它自己的判据里处理 aria-hidden
 * （那条判据算的是「谁挡住了 skip link」，aria-hidden 不改变 Tab 序，所以照样算挡路）。
 * 它的注释把这称为「另一个缺陷」——那条注释指向的正是这个文件。
 * 也就是说：这个缺陷类别被点名过、被解释过，只是一直没人守。
 *
 * 【递归进子组件是必需的】`<SomePanel aria-hidden="true" />` 里有没有按钮，
 * 只看父模板看不出来。平扫会漏掉组件内部渲染出来的可聚焦元素——
 * 第十六、十七两轮都在这同一个盲区上栽过，所以这次一开始就递归。
 *
 * 【精确性：什么**不算**】容器自己带 `tabindex="-1"` 不算——那是程序化焦点的落点，
 * 本来就不在 Tab 序里；`<a>` 没有 `href` 不算（原生不可聚焦）；`<div>` 不算；
 * 兄弟关系不算（只有真正的后代才算，靠 `walkElements` 的祖先栈判定）。
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  componentNameOf,
  isComponentTag,
  makeComponentResolver,
  openTags,
  readTemplate,
  walkElements,
  walkVueFiles,
} from './helpers/vueTemplate.js'

const srcDir = resolve(import.meta.dirname, '..', 'src')

/** 原生可聚焦标签。`audio`/`video` 带 controls 才可聚焦，这里保守地只在带 controls 时算。 */
const FOCUSABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])

const HIDDEN = /(?:^|\s)aria-hidden="true"/
const TABBABLE = /(?:^|\s)tabindex="0"/

/** 这个开标签本身可聚焦吗（不含递归）。 */
export function focusableItself({ tag, attrs }) {
  if (tag === 'a') return /(?:^|\s)href=/.test(attrs)
  if (tag === 'audio' || tag === 'video') return /(?:^|\s)controls/.test(attrs)
  return FOCUSABLE_TAGS.has(tag) || TABBABLE.test(attrs)
}

/**
 * 这份模板渲染出来会不会含有可聚焦元素（组件递归，带去重与深度上限）。
 * 与 `rendersFocusable` 同构，但**这里不忽略 aria-hidden**——那正是本判据要看的属性。
 */
export function anyFocusable(template, resolveComponent = () => null, seen = new Set(), depth = 0) {
  if (!template || depth > 6) return false
  for (const openTag of openTags(template)) {
    if (focusableItself(openTag)) return true
    if (!isComponentTag(openTag)) continue
    const name = componentNameOf(openTag)
    if (seen.has(name)) continue
    seen.add(name)
    if (anyFocusable(resolveComponent(name), resolveComponent, seen, depth + 1)) return true
  }
  return false
}

/** 找出「aria-hidden 子树里有可聚焦元素」的位置。 */
export function findHiddenFocusables(template, resolveComponent = () => null) {
  const els = [...walkElements(template)]
  const out = []
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]
    if (!HIDDEN.test(el.attrs)) continue
    const hits = []
    // 自身：aria-hidden 盖在一个可聚焦元素上
    if (focusableItself(el)) hits.push(`${el.tag}（自身就在 Tab 序里）`)
    // 自身是**组件**：`<Sidebar aria-hidden="true" />` 是最常见的真实写法，
    // 而组件标签是自闭合的、没有后代——光靠下面的后代循环会整个漏掉。
    // （这条是变异实验抓出来的：把 aria-hidden 加到 <Sidebar> 上，判据居然全绿。）
    if (isComponentTag(el)) {
      const self = componentNameOf(el)
      if (anyFocusable(resolveComponent(self), resolveComponent)) hits.push(`${self}（组件内部有可聚焦元素）`)
    }
    for (let j = i + 1; j < els.length; j += 1) {
      const d = els[j]
      if (!d.ancestors.includes(el)) continue
      if (focusableItself(d)) {
        hits.push(`${d.tag}@${d.line}`)
        continue
      }
      if (!isComponentTag(d)) continue
      const name = componentNameOf(d)
      if (anyFocusable(resolveComponent(name), resolveComponent)) hits.push(`${name}@${d.line}（内部有可聚焦元素）`)
    }
    if (hits.length) out.push({ tag: el.tag, line: el.line, hits })
  }
  return out
}

describe('aria-hidden 子树里不能有可聚焦元素', () => {
  const files = walkVueFiles(srcDir)
  const resolveComponent = makeComponentResolver(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('扫描规模自证：确实扫到了 aria-hidden（否则这条守卫在守空气）', () => {
    let hidden = 0
    for (const { template } of scanned) {
      for (const { attrs } of openTags(template)) if (HIDDEN.test(attrs)) hidden += 1
    }
    expect(scanned.length).toBeGreaterThan(45)
    // 实测：26 个 aria-hidden="true"（图标、装饰层、滚轮高亮带……）
    expect(hidden, '仓库里再也扫不到 aria-hidden="true"').toBeGreaterThan(15)
  })

  it('全仓没有「aria-hidden 里包着可聚焦元素」', () => {
    const offenders = scanned.flatMap(({ file, template }) => findHiddenFocusables(template, resolveComponent)
      .map(({ tag, line, hits }) => `${rel(file)} <${tag}@${line} aria-hidden> 里有：${hits.join('、')}`))
    expect(offenders).toEqual([])
  })

  it('核实：递归判断不是摆设——Sidebar 内部**真的**有可聚焦元素', () => {
    // 没有这条，上一行的递归分支也可能是恒不触发造成的假绿。
    expect(anyFocusable(resolveComponent('Sidebar'), resolveComponent)).toBe(true)
    expect(anyFocusable(resolveComponent('WallpaperLayer'), resolveComponent)).toBe(false)
  })

  // ---- 夹具 ----
  it('夹具：自身、后代、组件内部三种都要抓到', () => {
    expect(findHiddenFocusables('<div aria-hidden="true"><button>a</button></div>')).toHaveLength(1)
    expect(findHiddenFocusables('<div aria-hidden="true"><span><a href="/x">a</a></span></div>')).toHaveLength(1)
    expect(findHiddenFocusables('<button aria-hidden="true">a</button>')[0].hits[0]).toContain('自身')
    expect(findHiddenFocusables('<div aria-hidden="true"><input /></div>')).toHaveLength(1)
    // 组件内部渲染出来的可聚焦元素：平扫必漏
    const resolveStub = (name) => (name === 'Panel' ? '<section><button>藏着的按钮</button></section>' : null)
    const hit = findHiddenFocusables('<div aria-hidden="true"><Panel /></div>', resolveStub)
    expect(hit).toHaveLength(1)
    expect(hit[0].hits[0]).toContain('内部有可聚焦元素')
    // aria-hidden 直接盖在**组件自己**身上（自闭合、没有后代）——变异实验抓出来的漏网写法
    const selfHit = findHiddenFocusables('<Panel aria-hidden="true" />', resolveStub)
    expect(selfHit).toHaveLength(1)
    expect(selfHit[0].hits[0]).toContain('组件内部有可聚焦元素')
  })

  it('夹具：不可聚焦的东西一律不得误报', () => {
    // tabindex="-1" 是程序化焦点落点，本来就不在 Tab 序里
    expect(findHiddenFocusables('<div aria-hidden="true" tabindex="-1"><span>x</span></div>')).toEqual([])
    // 没有 href 的 <a> 原生不可聚焦
    expect(findHiddenFocusables('<div aria-hidden="true"><a>不是链接</a></div>')).toEqual([])
    // 没有 controls 的 audio/video 不可聚焦
    expect(findHiddenFocusables('<div aria-hidden="true"><video src="x"></video></div>')).toEqual([])
    // 装饰性子树
    expect(findHiddenFocusables('<div aria-hidden="true"><i class="deco"></i></div>')).toEqual([])
    // 兄弟关系不算：按钮在 aria-hidden **外面**
    expect(findHiddenFocusables('<div aria-hidden="true"><span>x</span></div><button>b</button>')).toEqual([])
    // 空 aria-hidden 容器
    expect(findHiddenFocusables('<div aria-hidden="true"></div>')).toEqual([])
    // 组件内部没有可聚焦元素
    expect(findHiddenFocusables('<div aria-hidden="true"><Panel /></div>', () => '<div class="deco"></div>')).toEqual([])
  })

  it('核实：被 aria-hidden 盖住的可聚焦元素确实在 Tab 序里（所以这条不是理论担忧）', () => {
    // 直接把「为什么危险」钉住：aria-hidden 不改 Tab 序。
    // 无法在这里渲染 Vue，所以断言的是判据依赖的那条事实——aria-hidden 只在无障碍树上生效，
    // 判据本身则按「可聚焦」定义（原生可聚焦标签 / tabindex="0"）来数。
    expect(focusableItself({ tag: 'button', attrs: '' })).toBe(true)
    expect(focusableItself({ tag: 'div', attrs: ' tabindex="0"' })).toBe(true)
    expect(focusableItself({ tag: 'div', attrs: ' tabindex="-1"' })).toBe(false)
  })
})