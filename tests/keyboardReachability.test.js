// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { openTags, readTemplate, walkElements, walkVueFiles } from './helpers/vueTemplate.js'

/**
 * 键盘可达性守卫：**只有鼠标能触发的操作**。
 *
 * 起因是一个真实缺陷。账本页「打开交易详情」与「编辑固定账单」原本都只挂在带 `@click`
 * 的 `div` 上：
 *
 *   <div class="feed-item" @click="openDetail(e.transaction.id)">
 *
 * 这类元素不在 Tab 序里、读屏不会把它读成可点击、回车与空格都没有反应。而它是这两个
 * 操作的**唯一**入口——右侧按钮组里只有「已支付 / 跳过本次」，没有编辑。也就是说账本页
 * 最常用的两个操作对键盘用户完全不可用（WCAG 2.1.1 键盘可达，AA 级）。
 *
 * 【判据】三条同时成立才算「只有鼠标能触发」：
 *   1. 标签是 div / span / li / td / tr（button / a[href] / input 天生可聚焦，不在此列）；
 *   2. 带**动作型** `@click`——只做传播控制的 `.stop` / `.self` / `.capture` 不算，
 *      它们的作用是拦住冒泡，元素本身并不可点（如 `<div class="b-actions" @click.stop>`）；
 *   3. 缺少可点击元素的三件套：`role`、`tabindex`、键盘处理（任一缺失即算缺失）。
 *      缺 role 则读屏不认，缺 tabindex 则 Tab 到不了，缺键盘处理则聚焦了也按不动——
 *      三者是「可访问的按钮」的最小集合，少一个都还是坏的。
 *
 * 【为什么不需要例外清单】判据里有一条自动豁免：如果同一个**动作表达式**在本文件里
 * 已经落在可聚焦元素上，就认为这条路径键盘已经走得到。例如
 * `.pending-row @click="tab = 'bills'"` 旁边就有
 * `<button role="tab" @click="tab = 'bills'">固定账单</button>`——同一表达式、真有按钮，
 * 那这一行的点击只是一条鼠标捷径，不是缺陷。这条豁免让守卫保持零例外清单：
 * 一条需要人不断往清单里加名字的守卫，最后一定会被加名字加到失效。
 *
 * 【自证不空转】除了断言全仓结果为 0，还断言真的扫到了足够多的文件与标签。
 * 正则写坏时命中数是 0，那种「假绿」比漏报更危险——这个仓库被人这么坑过一次
 * （对比度脚本的主题块解析器曾把绿色主题当成紫色审，详见 UX_AUDIT_176_REPORT.md §1.17）。
 */

const srcDir = resolve(import.meta.dirname, '..', 'src')

const ROW_TAGS = new Set(['div', 'span', 'li', 'td', 'tr'])
const FOCUSABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea'])
const PROPAGATION_ONLY = /^\.(stop|self|capture)/
const CLICK = /@click((?:\.[\w-]+)*)\s*=\s*"([^"]*)"/
const KEYDOWN = /@keydown(?:\.[\w-]+)*\s*=/

/** 可点击元素的三件套是否齐全：role + tabindex + 键盘处理。 */
function hasKeyboardAffordance(attrs) {
  return /\brole\s*=/.test(attrs) && /:?tabindex\s*=/.test(attrs) && KEYDOWN.test(attrs)
}

/** 返回 [{ tag, attrs, handler }]：模板里所有「只有鼠标能触发」的元素。 */
export function findMouseOnlyTargets(template) {
  const tags = [...openTags(template)]

  // 全文件范围：哪些动作表达式已经落在可聚焦元素上。
  // 注意这里**不套用**传播过滤：`<button @click.stop="openSchemeDetail(x)">` 是带 .stop 的
  // 真按钮，键盘完全够得到；.stop 只影响冒泡，不影响这个元素本身可不可点。
  // （第一版在这里误用了过滤，于是把 TimeSettingsModal 里「卡片 + 紧邻的查看/编辑按钮」
  //   这一对判成了缺陷——判定器把自己该认的等价入口给排除了。）
  const reachable = new Set()
  for (const { tag, attrs } of tags) {
    if (!FOCUSABLE_TAGS.has(tag)) continue
    const click = attrs.match(CLICK)
    if (click) reachable.add(click[2].trim())
  }

  const offenders = []
  for (const { tag, attrs } of tags) {
    if (!ROW_TAGS.has(tag)) continue
    const click = attrs.match(CLICK)
    if (!click) continue
    if (PROPAGATION_ONLY.test(click[1])) continue
    if (hasKeyboardAffordance(attrs)) continue
    if (reachable.has(click[2].trim())) continue
    offenders.push({ tag, attrs: attrs.replace(/\s+/g, ' ').trim(), handler: click[2].trim() })
  }
  return offenders
}

/**
 * 会「吃掉」后代语义的角色：这些角色的子节点按 ARIA 规范是 **presentational**。
 * 也就是内层真实控件的角色/名称不会被暴露——读屏听不到那里有个按钮。
 */
const PRESENTATIONAL_CHILD_ROLES = /(?:^|\s)role="(button|link|checkbox|radio|switch|tab|option|menuitem|menuitemcheckbox|menuitemradio)"/

/** 真实表单控件（`<a>` 要带 href 才算）。 */
const realControlOf = ({ tag, attrs }) => {
  if (tag === 'a') return /(?:^|\s)href=/.test(attrs)
  return FOCUSABLE_TAGS.has(tag) || tag === 'summary'
}

/**
 * 返回 [{ tag, line, role, inner }]：**包着真实控件**的交互元素。
 *
 * 起因是第十九轮勘察中的一个真缺陷：账本的固定账单行是
 * `<div role="button" tabindex="0" @click="编辑">`，里面却装着「已支付 / 跳过本次 / 恢复」
 * 这些真按钮。按 ARIA 规范，`button` 的子节点是 presentational——内层按钮的语义被抹掉，
 * 读屏既不知道它们是独立控件，还会把行名拼成「编辑固定账单「水费」 已支付 跳过本次」。
 *
 * 判据同时覆盖**原生**交互元素（`<button>` 里套 `<button>`、`<a href>` 里套按钮都是
 * 无效嵌套），但排除 `listbox` 拥有 `option` 这种**合法**的拥有关系——
 * `role="option"` 只是候选「吃掉」角色之一，而 WheelPicker 的 option 内部只有文本，
 * 所以这里天然不会误报；把 listbox 也算成父级则会直接假警。
 */
export function findNestedControls(template) {
  const els = [...walkElements(template)]
  const out = []
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]
    const roleMatch = el.attrs.match(PRESENTATIONAL_CHILD_ROLES)
    // 父级 = 声明了「吃掉后代语义」的角色，或本身就是原生交互元素
    const parentRole = roleMatch ? roleMatch[1] : (realControlOf(el) ? el.tag : null)
    if (!parentRole) continue
    const inner = new Set()
    for (let j = i + 1; j < els.length; j += 1) {
      const d = els[j]
      if (!d.ancestors.includes(el)) continue
      if (realControlOf(d)) inner.add(`${d.tag}@${d.line}`)
    }
    if (inner.size) out.push({ tag: el.tag, line: el.line, role: parentRole, inner: [...inner] })
  }
  return out
}

/* ---------- 夹具：先证明它抓得住，再拿它扫全仓 ---------- */

describe('findMouseOnlyTargets 的判定力', () => {
  it('抓得住：只有 @click 的 div', () => {
    const found = findMouseOnlyTargets('<div class="feed-item" @click="openDetail(e.id)">x</div>')
    expect(found.map((f) => f.handler)).toEqual(['openDetail(e.id)'])
  })

  it('抓得住：三件套缺一件都算缺', () => {
    // 只有 role
    expect(findMouseOnlyTargets('<div role="button" @click="openDetail(e.id)">x</div>')).toHaveLength(1)
    // role + tabindex，但聚焦后按不动
    expect(findMouseOnlyTargets('<div role="button" tabindex="0" @click="openDetail(e.id)">x</div>')).toHaveLength(1)
    // 只有 tabindex（读屏不会读成可点击）
    expect(findMouseOnlyTargets('<div tabindex="0" @click="openDetail(e.id)">x</div>')).toHaveLength(1)
  })

  it('放行：三件套齐全', () => {
    const html = '<div role="button" tabindex="0" @click="openDetail(e.id)" @keydown.enter.prevent="openDetail(e.id)">x</div>'
    expect(findMouseOnlyTargets(html)).toEqual([])
  })

  it('放行：同一动作表达式在别处已有真按钮（鼠标捷径，不是缺陷）', () => {
    const html = [
      '<button role="tab" @click="tab = \'bills\'">固定账单</button>',
      '<div class="pending-row" @click="tab = \'bills\'">x</div>',
    ].join('')
    expect(findMouseOnlyTargets(html)).toEqual([])
  })

  it('放行：只做传播控制的 @click 不是动作', () => {
    expect(findMouseOnlyTargets('<div class="b-actions" @click.stop>x</div>')).toEqual([])
    expect(findMouseOnlyTargets('<div class="page" @click.capture="closeSwipe">x</div>')).toEqual([])
    expect(findMouseOnlyTargets('<div class="mask" @click.self="close">x</div>')).toEqual([])
  })

  it('放行：button 与 span 之外的标签、以及没有 @click 的行', () => {
    expect(findMouseOnlyTargets('<button @click="x()">ok</button>')).toEqual([])
    expect(findMouseOnlyTargets('<div class="card">纯展示</div>')).toEqual([])
    expect(findMouseOnlyTargets('<a href="#" @click="x()">链接</a>')).toEqual([])
  })

  it('属性值里的 `>` 不会把它骗过去（引号感知）', () => {
    const html = '<div role="button" tabindex="0" :class="{ on: n > 1 }" @click="x()" @keydown.enter="x()">y</div>'
    expect(findMouseOnlyTargets(html)).toEqual([])
  })
})

/* ---------- 全仓扫描 ---------- */

/**
 * 例外清单：判据用的是「同一动作表达式的字符串相等」，所以有两类**真等价**会被误报。
 * 每条都必须写清另一个键盘入口在哪——以及为什么不去改它。
 *
 * 这个清单有个自我淘汰机制（见下面第二条断言）：某一项不再被扫到时测试会失败。
 * 也就是说清单不会随着代码变化悄悄烂掉，必须有人来删掉过期条目。
 */
const EXEMPT = [
  // 第四十一轮从这里删掉了一条（ScheduleGrid 的 `openAdd(i, row.id)`）：课表空格
  // 现在有了 role + tabindex + @keydown 三件套（roving tabindex 网格），不再是
  // 「只有鼠标能触发」。这条例外的自我淘汰机制正是它该有的样子——代码改好了，
  // 测试就会催着人来删条目，而不是让清单悄悄烂掉。
  {
    file: 'views/ExamsView.vue',
    handler: 'onCardClick(item, $event)',
    reason: '点考试卡片 = 打开编辑，但卡片自带「更多操作」按钮（aria-label 完整）'
      + '→ 菜单里有「编辑」。菜单里走的是 menuEdit(item)，与卡片上的 onCardClick 表达式不同，'
      + '所以字符串比较认不出来。长按/右键与这个按钮得到的是同一个菜单。',
  },
  {
    file: 'views/ledger-panels/LedgerHomePanel.vue',
    handler: "$emit('open-bill-form', {}, bill.id)",
    reason: '待处理账单行：外层点击打开编辑表单，内层有「已支付/隐藏」两个真按钮（动作不同）。'
      + '表单也可通过「固定账单」分区标签页或列表行编辑入口键盘到达。',
  },
]

describe('findNestedControls 的判定力', () => {
  it('抓得住：role="button" 里包着真按钮（第十九轮修的那一类）', () => {
    const html = '<div role="button" tabindex="0" @click="edit(b)">名称<div class="acts"><button @click="pay(b)">已支付</button></div></div>'
    const found = findNestedControls(html)
    expect(found).toHaveLength(1)
    expect(found[0].role).toBe('button')
    expect(found[0].inner).toHaveLength(1)
  })

  it('抓得住：原生交互元素的无效嵌套（button 套 button、a 套按钮）', () => {
    expect(findNestedControls('<button>外层<button>内层</button></button>')).toHaveLength(1)
    expect(findNestedControls('<a href="/x"><button>按钮</button></a>')).toHaveLength(1)
    expect(findNestedControls('<div role="tab">标签<button>里面的按钮</button></div>')).toHaveLength(1)
    // input 也算真实控件
    expect(findNestedControls('<div role="checkbox"><input type="checkbox" /></div>')).toHaveLength(1)
  })

  it('不得误报：合法结构与「像但不等价」的写法', () => {
    // listbox 拥有 option 是**正确**结构；option 里只有文本
    expect(findNestedControls('<div role="listbox"><div role="option">09</div><div role="option">10</div></div>')).toEqual([])
    // 按钮里的 <b>/<small> 不是控件
    expect(findNestedControls('<button role="tab" :class="{ on: x }"><b>3</b> 待办</button>')).toEqual([])
    // 没有 href 的 <a> 不是控件
    expect(findNestedControls('<div role="button">x<a>不是链接</a></div>')).toEqual([])
    // 兄弟关系不算
    expect(findNestedControls('<div role="button" tabindex="0">编辑</div><button>已支付</button>')).toEqual([])
    // 普通容器包按钮完全正常
    expect(findNestedControls('<div class="acts" @click.stop><button>已支付</button></div>')).toEqual([])
    // 修好之后的样子：真按钮（父）+ 动作按钮（兄弟）
    expect(findNestedControls('<div class="bill-row" @click="edit(b)"><button class="bill-main" @click.stop="edit(b)">名称</button><div class="acts"><button>已支付</button></div></div>')).toEqual([])
  })
})

describe('可点击元素必须能被键盘触发', () => {
  const files = walkVueFiles(srcDir)
  const scanned = files.map((file) => ({ file, template: readTemplate(file) }))
  const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')
  const all = scanned.flatMap(({ file, template }) =>
    findMouseOnlyTargets(template).map((item) => ({ file: rel(file), ...item })),
  )
  const tags = scanned.flatMap(({ template }) => [...openTags(template)])
  const clickTags = tags.filter(({ attrs }) => /@click/.test(attrs))
  const describe_ = (o) => `${o.file} <${o.tag} …> → ${o.handler}`

  it('扫描规模自证：确实遍历了全部 .vue、标签与点击处理', () => {
    // 这些数字不是凑出来的：当前是 53 个文件 / 3083 个开标签 / 478 个带 @click 的标签。
    // 留足余量，但绝不能是 0——正则写坏时的假绿比漏报更危险。
    expect(scanned.length).toBeGreaterThan(45)
    expect(tags.length).toBeGreaterThan(2500)
    expect(clickTags.length).toBeGreaterThan(300)
  })

  it('没有任何「只有鼠标能触发」的操作（例外清单之外）', () => {
    const unexplained = all.filter(
      (o) => !EXEMPT.some((e) => e.file === o.file && e.handler === o.handler),
    )
    expect(unexplained.map(describe_)).toEqual([])
  })

  it('例外清单里每一条都仍然对应一个真实例外（否则清单已经烂了）', () => {
    for (const e of EXEMPT) {
      expect(
        all.some((o) => o.file === e.file && o.handler === e.handler),
        `${e.file} 的 ${e.handler} 已不再是例外，请从 EXEMPT 里删掉`,
      ).toBe(true)
      expect(e.reason.length, `${e.file} 的例外必须写明理由`).toBeGreaterThan(20)
    }
  })

  it('账本页的三类操作行都是可聚焦、可回车触发的按钮', () => {
    const ledger = readTemplate(resolve(srcDir, 'views', 'LedgerView.vue'))
    const rows = [...openTags(ledger)].filter(
      ({ tag, attrs }) => tag === 'div' && /class="[^"]*\b(feed-item|cd-row)\b/.test(attrs),
    )
    // 打开交易详情 2 处（账本列表 + 日历当日明细）
    expect(rows).toHaveLength(2)
    for (const { attrs } of rows) {
      const head = attrs.replace(/\s+/g, ' ').slice(0, 80)
      expect(attrs, head).toMatch(/role="button"/)
      expect(attrs, head).toMatch(/tabindex="0"/)
      expect(attrs, head).toMatch(/@keydown\.enter\.prevent=/)
      expect(attrs, head).toMatch(/:aria-label=/)
    }
  })

  it('固定账单行：编辑入口是**真按钮**，而不是包着按钮的 role="button"（第十九轮修正）', () => {
    // 这三行原来是 `role="button"` 的 div，里面却装着「已支付 / 跳过本次 / 恢复」这些真按钮。
    // 按 ARIA 规范 button 的子节点是 presentational，于是内层按钮的语义被抹掉：
    // 读屏听不到它们是独立控件，行名还会被拼成「编辑固定账单「水费」 已支付 跳过本次」。
    // 现在编辑入口是一个真 `<button class="bill-main">`，动作按钮是它的**兄弟**。
    const ledger = readTemplate(resolve(srcDir, 'views', 'LedgerView.vue'))
    const rows = [...openTags(ledger)].filter(
      ({ tag, attrs }) => tag === 'div' && /class="[^"]*\bbill-row\b/.test(attrs),
    )
    expect(rows, '固定账单行有 3 类：待支付 / 之后 / 已暂停').toHaveLength(3)
    for (const { attrs } of rows) {
      const head = attrs.replace(/\s+/g, ' ').slice(0, 80)
      // 反向断言：不许把 role="button" 加回这一行
      expect(attrs, head).not.toMatch(/role="button"/)
      expect(attrs, head).not.toMatch(/tabindex=/)
      expect(attrs, head).not.toMatch(/@keydown/)
      expect(attrs, head).toMatch(/@click="openBillForm\(\{\}, bill\.id\)"/)
    }
    const mainButtons = [...openTags(ledger)].filter(
      ({ tag, attrs }) => tag === 'button' && /class="bill-main"/.test(attrs),
    )
    expect(mainButtons, '每类账单行都要有一个编辑入口真按钮').toHaveLength(3)
    for (const { attrs } of mainButtons) {
      const head = attrs.replace(/\s+/g, ' ').slice(0, 80)
      expect(attrs, head).toMatch(/type="button"/)
      expect(attrs, head).toMatch(/:aria-label="`编辑固定账单/ )
      // .stop 是必需的：否则点按钮会连带触发外层行的 @click，同一动作执行两次
      expect(attrs, head).toMatch(/@click\.stop="openBillForm\(\{\}, bill\.id\)"/)
    }
  })

  it('任何带交互角色的元素都不能包着真实表单控件（第十九轮新增，收口整类）', () => {
    const found = scanned.flatMap(({ file, template }) => findNestedControls(template)
      .map((o) => `${rel(file)} <${o.tag}@${o.line}> ${o.role} 里含 ${o.inner.join('、')}`))
    expect(found).toEqual([])
  })

  it('课表周视图的课程块可聚焦、可回车触发（桌面最直接的编辑入口）', () => {
    const grid = readTemplate(resolve(srcDir, 'components', 'schedule', 'ScheduleGrid.vue'))
    const blocks = [...openTags(grid)].filter(
      ({ tag, attrs }) => tag === 'div' && /class="course"/.test(attrs),
    )
    expect(blocks).toHaveLength(1)
    for (const { attrs } of blocks) {
      const head = attrs.replace(/\s+/g, ' ').slice(0, 80)
      expect(attrs, head).toMatch(/role="button"/)
      expect(attrs, head).toMatch(/tabindex="0"/)
      expect(attrs, head).toMatch(/@keydown\.enter\.prevent=/)
      expect(attrs, head).toMatch(/@keydown\.space\.prevent=/)
    }
  })

  it('课表空格是 roving tabindex 的网格（一个停靠点 + 方向键），不是「84 个 Tab 停靠点」', () => {
    // 第四十一轮把这里从「刻意不给 tabindex」升级成「刻意只给一个停靠点」。
    // 理由没变：7 × 节次数 个格子（12 节的学期周就是 84 个）全做成 Tab 停靠点，
    // 会让键盘用户按几十次 Tab 才穿得过课表，比不给还糟。变的只是解法——现在按
    // ARIA 网格类控件的标准做法做成 roving tabindex + 方向键。
    // 这条静态守卫只能看**模板声明**；「渲染后恰好一个 tabindex=0」由
    // tests/scheduleGridRoving.test.js 在真实页面上守。
    const grid = readTemplate(resolve(srcDir, 'components', 'schedule', 'ScheduleGrid.vue'))
    const cells = [...openTags(grid)].filter(
      ({ tag, attrs }) => tag === 'div' && /class="tt-cell"/.test(attrs),
    )
    expect(cells).toHaveLength(1)
    const [cell] = cells
    expect(cell.attrs, '空格要进 Tab 序，但只留一个停靠点').toMatch(/:tabindex="isActiveCell\(/)
    expect(cell.attrs).toMatch(/role="button"/)
    expect(cell.attrs, '空格里没有文字，必须有可访问名称').toMatch(/:aria-label="cellLabel\(/)
    expect(cell.attrs, '方向键要能移动').toMatch(/@keydown="onCellKeydown\(/)
    // 容器必须能被 tabOrderAndNames 的 roving 判据认成「组」——那个判据只认
    // role=group / role=tablist，认不出来就会把 -1 的格子报成「Tab 到不了」
    expect(grid, '网格容器要有 role="group"').toMatch(/role="group"/)
    expect(grid, '组要有可访问名称').toMatch(/aria-label="课程表网格/)
  })

  it('侧滑动作按钮收起时不在 Tab 序里（否则会聚焦到看不见的按钮）', () => {
    const swipe = readTemplate(resolve(srcDir, 'components', 'SwipeActionItem.vue'))
    const buttons = [...openTags(swipe)].filter(
      ({ tag, attrs }) => tag === 'button' && /class="swipe-action"/.test(attrs),
    )
    expect(buttons).toHaveLength(2)
    for (const { attrs } of buttons) {
      // 只靠位移藏起来，收起时必须 tabindex=-1，滑开后再放回 0
      expect(attrs, attrs.replace(/\s+/g, ' ').slice(0, 90)).toMatch(/:tabindex="open \? 0 : -1"/)
    }
  })
})