// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { openTags, readTemplate, walkVueFiles } from './helpers/vueTemplate.js'

/**
 * 展开/收起守卫：**原地翻转内容的控件必须告诉读屏当前是展开还是收起**。
 *
 * 起因是一类真实缺陷。页面里大量存在「显示历史」「打开筛选」「更多」这类按钮，按一下
 * 就在原地把一段内容摊开或收起：
 *
 *   <button class="btn btn-ghost" @click="showHistory = !showHistory">查看历史</button>
 *
 * 这类按钮**视觉上**没问题（内容出来了，用户看得见），但读屏用户听到的只是一个普通的
 * 「查看历史，按钮」——按下去之后名字不变、状态不变，**没有任何信息告诉他内容已经展开**，
 * 再按一次是否收起也无从判断。对只能靠读屏操作的用户来说，这是一个「按了没反应」的按钮。
 * 加一个 `aria-expanded` 就能让读屏读成「查看历史，按钮，已展开」（WCAG 4.1.2 名称/角色/值）。
 *
 * 【判据】两条同时成立才算「原地翻转的控件」：
 *   1. 元素可聚焦（button / a / input / select / textarea）——`aria-expanded` 只在
 *      交互元素上才有意义；不可聚焦的元素该由「键盘可达性」守卫去管，不在这里重复报。
 *   2. `@click` 的表达式是**原地翻转**：赋值号左边的标识符，在同一表达式里以 `!同一标识符`
 *      出现（`showHistory = !showHistory`）。
 *
 * 第 2 条是这套判据的关键。它刻意**只认这一个签名**，因为「点一下打开一个弹窗」的写法是
 * `showSemester = true`、关闭是 `showBillForm = false`——那类不应该加 `aria-expanded`
 * （弹窗有 `aria-modal` 与焦点转移，语义不同），而它们全都不含 `!标识符`，自然被排除。
 * 宁可窄一点：判据窄只会漏报，判据宽会报假警，而**报假警的守卫最后一定会被人关掉**。
 *
 * 【刻意不做的事】不要求 `aria-controls`：它要指向被控元素的 id，而这些展开内容的 id
 * 大多不存在，为它造 id 属于为属性而属性；且屏幕阅读器对它的支持一直不一致。
 * 本守卫只要求「状态能被读出来」这一件真正影响使用的事。
 *
 * 【已知漏报，代价是刻意接受的】写成三元表达式的翻转
 * （`expandedId = expandedId === id ? '' : id`）不含 `!标识符`，不被判据覆盖。
 * 全仓目前只有 1 处（`QuickRecordPanel` 的「修改/收起」），已经手工补上了
 * `:aria-expanded="expandedId === draft.id"`，但**这条守卫盯不住它的回归**。
 *
 * 为什么不把三元也纳进来：`X = X === … ? … : …` 这个形状里，「原地展开收起」和
 * 「切换视图模式」（如 `mobileView = mobileView === 'day' ? 'week' : 'day'`）长得一模一样，
 * 而后者该用的是 `aria-pressed` 或什么都不用，**不是** `aria-expanded`。判据一旦为了多抓
 * 1 处而放宽，就会开始对着模式切换按钮报假警——宁可漏报这 1 处，也不要用一条会喊狼来了的规则。
 *
 * 【自证不空转】除了断言全仓违规数为 0，还断言**真的扫到了足够多的翻转控件**。
 * 正则写坏时命中数会变成 0，那种「假绿」比漏报更危险——这个仓库被人这么坑过一次
 * （对比度脚本的主题块解析器曾把绿色主题当成紫色审，详见 UX_AUDIT_176_REPORT.md §1.17）。
 */

const srcDir = resolve(import.meta.dirname, '..', 'src')

const FOCUSABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea'])
const CLICK = /@click(?:\.[\w-]+)*\s*=\s*"([^"]*)"/
// 原地翻转的唯一签名：`X = … !X …`。两侧必须是同一个标识符——
// `showFilters = !filtersActive` 这种「赋成另一个东西的取反」不算翻转，会正确放行。
const IN_PLACE_TOGGLE = /\b([A-Za-z_$][\w$]*)\s*=\s*[^"]*!\s*\1\b/
const HAS_EXPANDED = /(^|\s):?aria-expanded\s*=/

/** 返回 [{ tag, action, attrs }]：模板里「原地翻转但没说状态」的控件。 */
export function findTogglesMissingExpanded(template) {
  const offenders = []
  for (const { tag, attrs } of openTags(template)) {
    if (!FOCUSABLE_TAGS.has(tag)) continue
    const click = attrs.match(CLICK)
    if (!click) continue
    if (!IN_PLACE_TOGGLE.test(` ${click[1]} `)) continue
    if (HAS_EXPANDED.test(attrs)) continue
    offenders.push({ tag, action: click[1].trim(), attrs: attrs.replace(/\s+/g, ' ').trim() })
  }
  return offenders
}

/** 判据扫到的所有原地翻转控件（不论有没有 aria-expanded），用于规模自证。 */
export function findAllInPlaceToggles(template) {
  const found = []
  for (const { tag, attrs } of openTags(template)) {
    if (!FOCUSABLE_TAGS.has(tag)) continue
    const click = attrs.match(CLICK)
    if (!click) continue
    if (!IN_PLACE_TOGGLE.test(` ${click[1]} `)) continue
    found.push({ tag, action: click[1].trim(), expanded: HAS_EXPANDED.test(attrs) })
  }
  return found
}

/* ---------- 夹具：先证明它抓得住，再拿它扫全仓 ---------- */

describe('findTogglesMissingExpanded 的判定力', () => {
  it('抓得住：原地翻转但没有 aria-expanded', () => {
    const found = findTogglesMissingExpanded('<button class="btn" @click="showHistory = !showHistory">历史</button>')
    expect(found.map((f) => f.action)).toEqual(['showHistory = !showHistory'])
  })

  it('抓得住：带修饰符的 @click 也一样', () => {
    expect(findTogglesMissingExpanded('<button @click.prevent="moreOpen = !moreOpen">更多</button>')).toHaveLength(1)
    expect(findTogglesMissingExpanded('<button @click.stop="expanded = !expanded">展开</button>')).toHaveLength(1)
  })

  it('放行：已经说了状态', () => {
    expect(findTogglesMissingExpanded('<button @click="showHistory = !showHistory" :aria-expanded="showHistory">历史</button>')).toEqual([])
    // 静态属性也算说了
    expect(findTogglesMissingExpanded('<button @click="x = !x" aria-expanded="false">x</button>')).toEqual([])
  })

  it('放行：打开弹窗 / 关闭弹窗不是原地翻转，不该用 aria-expanded', () => {
    expect(findTogglesMissingExpanded('<button @click="showSemester = true">学期</button>')).toEqual([])
    expect(findTogglesMissingExpanded('<button @click="showBillForm = false">关闭</button>')).toEqual([])
    expect(findTogglesMissingExpanded('<button @click="open = true">任务中心</button>')).toEqual([])
  })

  it('放行：赋成别的东西的取反，不是原地翻转', () => {
    // 这一条守住判据的精度：两边不是同一个标识符就不算。
    expect(findTogglesMissingExpanded('<button @click="showFilters = !filtersActive">筛选</button>')).toEqual([])
    expect(findTogglesMissingExpanded('<button @click="visible = !draft.hidden">显示</button>')).toEqual([])
  })

  it('放行：不可聚焦的元素交给键盘可达性守卫，不在这里重复报', () => {
    expect(findTogglesMissingExpanded('<div @click="expanded = !expanded">x</div>')).toEqual([])
    expect(findTogglesMissingExpanded('<li @click="open = !open">x</li>')).toEqual([])
  })

  it('放行：没有 @click 的元素', () => {
    expect(findTogglesMissingExpanded('<button class="btn">纯展示</button>')).toEqual([])
  })

  it('属性值里的 `>` 不会把它骗过去（引号感知）', () => {
    // 真实的写法：@click 后面还有别的属性，且属性值里带 >
    const html = '<button :aria-expanded="n > 1" @click="showAll = !showAll">x</button>'
    expect(findTogglesMissingExpanded(html)).toEqual([])
    const bad = '<button :class="{ on: n > 1 }" @click="showAll = !showAll">x</button>'
    expect(findTogglesMissingExpanded(bad)).toHaveLength(1)
  })

  it('自证：判据确实认得出「有没有说状态」这两种情况', () => {
    expect(findAllInPlaceToggles('<button @click="a = !a">x</button>').map((t) => t.expanded)).toEqual([false])
    expect(findAllInPlaceToggles('<button :aria-expanded="a" @click="a = !a">x</button>').map((t) => t.expanded)).toEqual([true])
  })
})

/* ---------- 全仓扫描 ---------- */

/**
 * 例外清单：判据用的是「`@click` 表达式字符串里的 `!标识符`」，所以理论上存在
 * **语义不是展开收起**却被判据命中的写法。目前一条都没有——清空是刻意的：
 * 13 处原地翻转全部是真正的展开/收起，都该有 `aria-expanded`。
 *
 * 清单带自我淘汰机制（见下面第二条断言）：某一项不再被扫到时测试会失败，
 * 也就是说清单不会随着代码变化悄悄烂掉，必须有人来删掉过期条目。
 */
const EXEMPT = new Map([])

describe('全仓原地翻转控件都有 aria-expanded', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file), toggles: [] }))
  for (const entry of scanned) entry.toggles = findAllInPlaceToggles(entry.template)

  const allToggles = scanned.flatMap((e) => e.toggles.map((t) => ({ ...t, file: e.file })))
  const offenders = []
  for (const e of scanned) {
    for (const t of findTogglesMissingExpanded(e.template)) {
      offenders.push(`${e.file.slice(srcDir.length + 1)} → ${t.action}`)
    }
  }
  const live = offenders.filter((line) => !EXEMPT.has(line))

  it('没有「原地翻转却没说状态」的控件', () => {
    expect(live).toEqual([])
  })

  it('例外清单里的每一条都还在被扫到（过期条目会失败）', () => {
    for (const key of EXEMPT.keys()) {
      expect(offenders, `例外条目已过期，请删除：${key}`).toContain(key)
    }
  })

  it('自证不空转：确实扫到了足够多的文件、标签与翻转控件', () => {
    // 扫描规模下限：正则或遍历写坏时这些数字会掉下来，避免「0 违规」的假绿。
    // 数值取当前实际值往下留余量（当前 53 个 .vue），跟键盘可达性守卫同一种做法。
    expect(files.length).toBeGreaterThan(45)
    expect(allToggles.length).toBeGreaterThanOrEqual(10)
    // 绝大多数翻转控件都在 button 上（aria-expanded 的正确落点）
    expect(allToggles.filter((t) => t.tag === 'button').length).toBeGreaterThanOrEqual(10)
  })

  it('已经说状态的占绝大多数，说明这条守卫守的是一个真实存在的约定', () => {
    const withExpanded = allToggles.filter((t) => t.expanded).length
    expect(withExpanded).toBe(allToggles.length)
  })
})