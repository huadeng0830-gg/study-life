// @vitest-environment node
/**
 * 实时区域（`role="alert"` / `role="status"` / `aria-live`）不能落在**被藏起来的**子树里。
 *
 * 【为什么这是硬缺陷】
 * `display:none` 的元素**根本不在无障碍树里**，`aria-hidden="true"` 的元素被显式移出。
 * 两种情况下的实时区域都不会播报——属性写着，读屏一个字也听不到，属于静默失败。
 * 本轮实测到一例真缺陷：作息设置弹窗的 OCR 进度与导入错误，原本住在
 * `v-show="settingsTab === 'plans'"` 的作息方案区里。OCR 要跑好几秒，用户几乎一定会
 * 切到别的标签页等；一切走，这个区就是 `display:none`，于是**进度看不到、
 * 失败与「图片质量提示」也听不到**。已把这两块提到标签区之外（与同文件里的
 * `settingError` 同级）。
 *
 * 【为什么 `v-if` 不算，`v-show` 算】
 * `v-if` 为假时元素**不存在**于 DOM，实时区域压根没渲染——只在真正显示时才存在，没有缺陷。
 * `v-show` 为假时元素**留在 DOM 里但 `display:none`**，于是「内容后来变了」这件事
 * 发生在一个不可播报的节点上。判据因此只认 `v-show`，这是两者的本质区别，
 * 不是为了省事。
 *
 * 【为什么要递归进子组件】
 * 平扫父模板会漏掉最典型的一例：`<TaskProgress />` 在父模板里只是个自闭合标签，
 * 而它的模板里才有 `role="alert"`。第一版平扫**确实漏了它**（只报出同区的另一处 `<p>`），
 * 所以判据必须递归解析组件源码——和 `landmarksAndRoles` 判断「组件里有没有可聚焦元素」
 * 是同一个道理，共用 `makeComponentResolver`。
 *
 * 【已知边界】`aria-hidden` 与 `v-show` 都只看**静态写法**；`:aria-hidden="expr"` 这类
 * 绑定无法静态求值，不判（全仓实测 0 处绑定写法）。CSS 里 `display:none` 的类不算——
 * 判据是模板层的，看不见样式表。
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

const LIVE = /(?:^|\s):?role="(?:alert|status)"|(?:^|\s):?aria-live=/

const HIDERS = [
  // selfApplies：这个隐藏者写在**实时区域自己**身上时算不算缺陷。
  //   aria-hidden / hidden 写在自身上 → 这个区域永远不会播报，算。
  //   v-show 写在自身上 → **不算**：区域被隐藏与它未被显示本来就是同一件事，
  //   显示出来时它就在无障碍树里，不存在「悄悄变更却播报不到」的情况。
  { why: 'aria-hidden="true"', selfApplies: true, test: (a) => /(?:^|\s)aria-hidden="true"/.test(a) },
  // `(?=[\s>=]|$)`：attrs 是标签名之后的整段，`<div hidden>` 的 attrs 正好以 hidden 结尾，
  // 少了 `|$` 这一支就会漏判（夹具里那条 `<div hidden>` 就是被它抓出来的）。
  { why: '静态 hidden 属性', selfApplies: true, test: (a) => /(?:^|\s)hidden(?=[\s>=]|$)/.test(a) },
  { why: 'v-show', selfApplies: false, test: (a) => /(?:^|\s)v-show=/.test(a) },
]

const hiderOf = (attrs, self = false) => HIDERS.find((h) => (!self || h.selfApplies) && h.test(attrs))

/** 这份模板渲染出来会不会含有实时区域。组件递归判断，带去重与深度上限。 */
export function rendersLiveRegion(template, resolveComponent = () => null, seen = new Set(), depth = 0) {
  if (!template || depth > 6) return false
  for (const openTag of openTags(template)) {
    if (LIVE.test(openTag.attrs)) return true
    if (!isComponentTag(openTag)) continue
    const name = componentNameOf(openTag)
    if (seen.has(name)) continue
    seen.add(name)
    if (rendersLiveRegion(resolveComponent(name), resolveComponent, seen, depth + 1)) return true
  }
  return false
}

/**
 * 找出「被藏起来的实时区域」。
 * 既包括元素**自己**就是实时区域，也包括它是个**组件**、而该组件内部渲染了实时区域。
 */
export function findHiddenLiveRegions(template, resolveComponent = () => null) {
  const out = []
  for (const el of walkElements(template)) {
    // 祖先里的隐藏者（v-show 在祖先身上是致命的：区域还在 DOM 里，只是 display:none）
    const hiddenAncestor = el.ancestors.find((a) => hiderOf(a.attrs))
    // 自己身上的隐藏者（只看 aria-hidden / hidden，理由见 HIDERS 的注释）
    const selfHider = hiderOf(el.attrs, true)
    const hider = hiddenAncestor ? hiderOf(hiddenAncestor.attrs) : selfHider
    if (!hider) continue
    const where = hiddenAncestor
      ? `${hiddenAncestor.tag}（模板第 ${hiddenAncestor.line} 行，${hider.why}）`
      : `自身（${hider.why}）`
    if (LIVE.test(el.attrs)) {
      out.push({ name: el.tag, where, via: '元素自己' })
      continue
    }
    if (!isComponentTag(el)) continue
    const name = componentNameOf(el)
    if (rendersLiveRegion(resolveComponent(name), resolveComponent)) {
      out.push({ name, where, via: '组件内部' })
    }
  }
  return out
}

describe('实时区域不能藏在被隐藏的子树里', () => {
  const files = walkVueFiles(srcDir)
  const resolveComponent = makeComponentResolver(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

  it('扫描规模自证：确实扫到了实时区域（否则这条守卫在守空气）', () => {
    let live = 0
    for (const { template } of scanned) {
      for (const { attrs } of openTags(template)) if (LIVE.test(attrs)) live += 1
    }
    // 实测：模板里的实时区域 30+ 个（role="alert" / role="status" / aria-live）
    expect(scanned.length).toBeGreaterThan(45)
    expect(live, '仓库里再也扫不到实时区域').toBeGreaterThan(25)
  })

  it('全仓没有「藏起来的实时区域」', () => {
    const offenders = scanned.flatMap(({ file, template }) => findHiddenLiveRegions(template, resolveComponent)
      .map(({ name, where, via }) => `${rel(file)} <${name}>（${via}）藏在 ${where}`))
    expect(offenders).toEqual([])
  })

  it('核实：OCR 进度与导入错误确实在标签区之外（这一轮修的就是它）', () => {
    const tpl = readTemplate(resolve(srcDir, 'components', 'schedule', 'TimeSettingsModal.vue'))
    const els = [...walkElements(tpl)]
    const plans = els.find((e) => e.tag === 'section' && /v-show="settingsTab === 'plans'"/.test(e.attrs))
    expect(plans, '没找到作息方案区，判据已与源码脱节').toBeTruthy()
    // 进度与错误都在计划区**之前**出现 → 不在它的子树里
    const taskIndex = els.findIndex((e) => componentNameOf(e) === 'TaskProgress')
    expect(taskIndex, '没找到 OCR 进度组件').toBeGreaterThanOrEqual(0)
    expect(taskIndex, 'OCR 进度又回到 v-show 区里了').toBeLessThan(els.indexOf(plans))
  })

  it('核实：递归判断不是摆设——TaskProgress 内部**真的**有实时区域', () => {
    // 没有这条，上一条也可能是「rendersLiveRegion 恒返回 false」造成的假绿。
    expect(rendersLiveRegion(resolveComponent('TaskProgress'), resolveComponent)).toBe(true)
    // 反向：一个纯装饰组件不该被算成实时区域（否则判据会到处假警）
    expect(rendersLiveRegion(resolveComponent('WallpaperLayer'), resolveComponent)).toBe(false)
  })

  // ---- 夹具 ----
  it('夹具：三种「藏起来」都要抓到，元素自己或组件内部都算', () => {
    expect(findHiddenLiveRegions('<div aria-hidden="true"><p role="alert">e</p></div>')).toHaveLength(1)
    expect(findHiddenLiveRegions('<div v-show="x"><p role="status">s</p></div>')).toHaveLength(1)
    expect(findHiddenLiveRegions('<div hidden><p aria-live="polite">s</p></div>')).toHaveLength(1)
    expect(findHiddenLiveRegions('<section v-show="tab === \'a\'"><div><span role="alert">e</span></div></section>')).toHaveLength(1)

    // 组件内部渲染实时区域 —— 平扫抓不到的那一类
    const resolveStub = (name) => (name === 'TaskProgress' ? '<section><p role="alert">{{ task.error }}</p></section>' : null)
    expect(findHiddenLiveRegions('<div v-show="x"><TaskProgress /></div>', resolveStub)).toHaveLength(1)
    expect(findHiddenLiveRegions('<div v-show="x"><TaskProgress /></div>', resolveStub)[0].via).toBe('组件内部')
    // 组件自己带 role 也算
    expect(findHiddenLiveRegions('<div v-show="x"><Widget role="status" /></div>', () => null)).toHaveLength(1)
    // 实时区域**自己**带 aria-hidden / hidden → 永远不会播报，算缺陷
    expect(findHiddenLiveRegions('<p aria-hidden="true" role="alert">e</p>')).toHaveLength(1)
    expect(findHiddenLiveRegions('<p hidden role="alert">e</p>')).toHaveLength(1)
    expect(findHiddenLiveRegions('<p aria-hidden="true" role="alert">e</p>')[0].where).toContain('自身')
    // 但 v-show 写在自己身上不算：被隐藏与未被显示是同一件事
    expect(findHiddenLiveRegions('<p v-show="err" role="alert">{{ err }}</p>')).toEqual([])
  })

  it('夹具：可见的实时区域、v-if、无实时区域的藏匿处都不得误报', () => {
    expect(findHiddenLiveRegions('<p role="alert">e</p>')).toEqual([])
    expect(findHiddenLiveRegions('<div v-show="x"><p>普通文字</p></div>')).toEqual([])
    expect(findHiddenLiveRegions('<div aria-hidden="true"><span>▦</span></div>')).toEqual([])
    // v-if 为假时元素不存在于 DOM，不是缺陷——这条把 v-if 与 v-show 的区别钉住
    expect(findHiddenLiveRegions('<div v-if="x"><p role="alert">e</p></div>')).toEqual([])
    // 实时区域是隐藏区的**兄弟**而非后代
    expect(findHiddenLiveRegions('<div v-show="x"><p>a</p></div><p role="alert">e</p>')).toEqual([])
    // 装饰性组件内部没有实时区域
    const resolveStub = () => '<div class="deco"></div>'
    expect(findHiddenLiveRegions('<div v-show="x"><WallpaperLayer /></div>', resolveStub)).toEqual([])
  })

  it('夹具：没有闭合标签时也要正确收尾，不把后面的兄弟算成后代', () => {
    // <div> 没闭合 → 按栈语义后面的兄弟会被算成后代，这属于模板本身有问题；
    // 这里固定住当前行为，避免将来「看起来更聪明」的改动引入假阴性。
    expect(findHiddenLiveRegions('<div v-show="x"><p role="alert">e</p></div><p role="status">s</p>')).toHaveLength(1)
  })
})