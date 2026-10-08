// @vitest-environment node
/**
 * 可达性守卫：父组件 `<style scoped>` 里引用**子组件内部节点**的类（第三十九轮新增）。
 *
 * 【为什么需要——这是 componentDeadCss 的盲区】
 * `tests/componentDeadCss.test.js` 的判据是"这个类名在全仓有没有出现"。App.vue 里的
 * `.nav-item` / `.brand` / `.theme-dot` 全部**出现过**（Sidebar.vue 的模板里就有），
 * 所以那条守卫看不见问题。可它们在这里是**死规则**：
 *
 *   Vue 的 scoped CSS 只把父组件的 `data-v-*` 属性加在**子组件的根节点**上。
 *   `.nav-item` 是 Sidebar.vue 内部 `<router-link>` 上的类，它带的是 Sidebar 自己的
 *   `data-v-*`，永远不满足「App 的 scope + 这个类」这个合取式。
 *   编译结果说得最清楚（见下面 `scope 属性只落在最后一段` 那条）：
 *   `.sidebar.collapsed .nav-item` → `.sidebar.collapsed .nav-item[data-v-app]`
 *   —— 属性落在**最后一段**，而最后一段匹配的元素在子组件内部，拿不到父作用域。
 *
 * 【判据：用「子组件的模板根标签」区分合法与非法】
 *   一个类要求落在带父作用域属性的节点上。这种节点只有两类：
 *     1. 父组件**自己模板里的元素**（含它塞进子组件默认插槽的内容——插槽内容在父作用域里编译）；
 *     2. 子组件的**根节点**（要么是子组件模板根标签上的类，要么是父组件写在子组件标签上的
 *        `class`，它们都会随根节点拿到父作用域属性；Vue 3 还会沿嵌套组件根继续往下传）。
 *   于是对父组件 scoped 选择器里的**每一个类** c：
 *     - c 在父组件自己的模板里 → 合法；
 *     - c 是某个子组件的根节点类 → 合法；
 *     - c 只出现在某个子组件的**内部节点**上 → **非法**（这条选择器永远匹配不到元素）；
 *     - c 在任何模板里都找不到（全局类、`<Transition name>` 生成的过渡类名）→ **不判定**，
 *       按"生死不确定一律保留"处理，既不删也不报。
 *   含 `:deep()` / `::v-deep` / `:slotted()` 的选择器直接放过（它们本来就是穿透写法）。
 *
 * 【为什么这里的"全仓"不是裸的 0——请连着下一段一起读】
 * 这类残留**不止 App.vue 一处**：同一次恢复事故（第三十七轮删除了入口分片的注释与样式，
 * 第三十八轮只清掉了"同值副本"）在 TodayView / ScheduleView / AppearanceSettings /
 * NoticeUnderstanding / LedgerView 里留下了**同一类**死规则（12 对、共 157 条）。
 * 本轮任务只允许改 App.vue 的侧边栏那一段（其余文件当时有并行代理在改），所以：
 *   - **本轮负责的那一对（App.vue → components/Sidebar.vue）断言为 0**（硬断言，见下）；
 *   - 其余配对登记进 `RESIDUAL_PAIRS` **棘轮**：配对集合不许新增、每对的条数只准变少。
 *     这是一份**已知、可复现、有据可查**的残留清单，不是"看不见"——想把某一条移出清单，
 *     就得先把那个文件的死规则清掉，那时棘轮自然收紧。
 * 换句话说：这一轮能保证的是"**没有未登记的非法命中**"，而不是"全仓已经干净"。
 * 全仓清零需要后续轮次按同一判据清 TodayView / ScheduleView / AppearanceSettings /
 * NoticeUnderstanding / LedgerView（以及 App.vue 里属于 TaskCenter / WallpaperLayer 的那批）。
 *
 * 顺带排除一个**假阳性**：views/ListsView.vue 的 `.item-list :deep(.swipe-content)` 是合法穿透
 * 写法（编译后 `:deep(` 标记会消失、只剩 `[data-v-x] .swipe-content`），所以判据必须在**原始
 * 选择器**上先认 `:deep()` 再编译，否则会把"该穿透的"当成"非法引用"报出来——本文件是按前者写的。
 *
 * 【vitest 不处理 CSS】所以这里只能在**源码 + 编译产物**上判：`@vue/compiler-sfc` 的
 * `compileStyle` 给出真实的选择器变换，模板 AST 给出真实的根标签与类名。
 * 没有任何一条断言依赖渲染，也没有用到 DOM。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { compileStyle, parse } from '@vue/compiler-sfc'
import { splitCssRules, stripCssComments, stripHtmlComments, styleBlocksOf } from '../scripts/css-rules.mjs'

const srcDir = resolve(import.meta.dirname, '..', 'src')

/* ------------------------------------------------------------------ 解析工具 */

function walkVueFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkVueFiles(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

const relTo = (base, file) => file.slice(base.length + 1).replace(/\\/g, '/')

/** 模板 AST 里的元素节点（跳过注释、空白文本与插值）。 */
const elementChildren = (node) => (node?.children ?? []).filter((child) => child.type === 1)

/** 一个 AST 节点上的类名：静态 `class` + `:class`/`v-bind:class` 里的字符串字面量与裸标识符。 */
function classesOfNode(node) {
  const out = new Set()
  for (const prop of node.props ?? []) {
    if (prop.type === 6 && prop.name === 'class' && prop.value) {
      for (const cls of prop.value.content.split(/\s+/)) if (cls) out.add(cls)
      continue
    }
    // 注意：`:class` 在 compiler 的 AST 里是 `type: 7, name: 'bind', arg: { content: 'class' }`,
    // **不是** `name: 'class'`。写成后者会静默漏掉全部动态 class（根节点上的 `:class="{ collapsed }"`
    // 就是靠它读出来的），而漏读只会缩小"合法集合"、把合法写法推向未知——自证会红。
    const isBoundClass = prop.type === 7
      && (prop.name === 'class' || (prop.name === 'bind' && prop.arg?.content === 'class'))
    if (!isBoundClass || !prop.exp) continue
    const code = prop.exp.content
    for (const match of code.matchAll(/['"]([^'"]+)['"]/g)) {
      for (const cls of match[1].split(/\s+/)) if (cls) out.add(cls)
    }
    for (const match of code.matchAll(/(?:^|[{,\s])([a-zA-Z_$][\w$]*)\s*(?=[,:}\s])/g)) {
      if (!['true', 'false', 'null', 'undefined'].includes(match[1])) out.add(match[1])
    }
  }
  return out
}

/** 子树里的全部类名。 */
function allClasses(node, out = new Set()) {
  for (const cls of classesOfNode(node)) out.add(cls)
  for (const child of elementChildren(node)) allClasses(child, out)
  return out
}

/**
 * 子组件**模板根标签**（根节点）上的元素：`<template>` 包裹（v-if/v-else 链）要解开。
 * 这里就是"根节点合法 / 内部节点非法"的分界所在。
 */
function templateRoots(descriptor) {
  const out = []
  for (const node of elementChildren(descriptor.template?.ast)) {
    if (node.tag === 'template') {
      for (const inner of elementChildren(node)) {
        out.push(...(inner.tag === 'template' ? elementChildren(inner) : [inner]))
      }
    } else out.push(node)
  }
  return out
}

/**
 * 取一个 SFC 里所有 `scoped` 样式块（**先剥 HTML 注释**：本仓踩过六次同一个坑，
 * App.vue 的模板注释里就有字面量 `<style>`）。与 `styleBlocksOf` 同一套定位，只是要读
 * 开标签上的属性才知道是不是 scoped——两者的一致性由「规模自证」交叉核对。
 */
function scopedBlocksOf(sfcText) {
  const source = stripHtmlComments(sfcText)
  const out = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  let match
  while ((match = re.exec(source))) if (/(^|\s)scoped(\s|$)/.test(match[1])) out.push(match[2])
  return out
}

/** 逗号分隔的选择器列表，但对 `()` / `[]` 里的逗号安全。 */
function splitSelectorList(selector) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i += 1) {
    const char = selector[i]
    if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) { out.push(selector.slice(start, i)); start = i + 1 }
  }
  out.push(selector.slice(start))
  return out.map((one) => one.trim()).filter(Boolean)
}

/** 选择器里引用的类名（顺序即出现顺序）。 */
const classNamesIn = (selector) => [...selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((match) => match[1])

/** 穿透写法：它们本来就作用在别的作用域里，不参与本判据。 */
const isDeepSelector = (selector) => /:deep\(|::v-deep|:slotted\(/.test(selector)

/* ------------------------------------------------------------------ 判据本体 */

/**
 * 扫描一棵 `src` 树，返回非法命中。
 *
 * @returns {{ hits: Array<{ file: string, selector: string, offenders: string[], children: string[] }>,
 *             scale: { vueFiles: number, scopedFiles: number, scopedBlocks: number, selectors: number,
 *                      childLinks: number, resolvedRoots: number } }}
 */
function scanReachability(rootDir) {
  const files = walkVueFiles(rootDir)
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]))
  const parsed = new Map(files.map((file) => [file, parse(sources.get(file), { filename: file }).descriptor]))

  /** 每个文件的模板类索引：自己模板里的类 / 模板根标签上的类 / 只在内部节点上的类。 */
  const index = new Map()
  for (const file of files) {
    const descriptor = parsed.get(file)
    const own = new Set()
    const roots = new Set()
    const all = new Set()
    for (const node of templateRoots(descriptor)) {
      for (const cls of classesOfNode(node)) roots.add(cls)
      allClasses(node, all)
    }
    const collect = (node) => {
      for (const cls of classesOfNode(node)) own.add(cls)
      for (const child of elementChildren(node)) collect(child)
    }
    for (const node of elementChildren(descriptor.template?.ast)) collect(node)
    const internal = new Set([...all].filter((cls) => !roots.has(cls)))
    index.set(file, { own, roots, internal })
  }

  const hits = []
  const scale = { vueFiles: files.length, scopedFiles: 0, scopedBlocks: 0, selectors: 0, childLinks: 0, resolvedRoots: 0 }

  for (const file of files) {
    const sfcText = sources.get(file)
    const descriptor = parsed.get(file)
    const blocks = descriptor.styles.filter((style) => style.scoped)
    if (!blocks.length) continue
    scale.scopedFiles += 1
    scale.scopedBlocks += blocks.length

    // 子组件：模板里用到的组件标签 → 源文件（import 解析）。根节点类 + 内部类并成两张表。
    const childRoots = new Set()
    const childInternal = new Set()
    /** 类名 → 内部节点上有这个类的**全部**子组件（不取"第一个"：那是顺序相关的猜测）。 */
    const ownersOf = new Map()
    const imports = new Map()
    for (const match of sfcText.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.vue)['"]/g)) {
      imports.set(match[1], resolve(dirname(file), match[2]))
    }
    for (const [, childFile] of imports) {
      if (!index.has(childFile)) continue
      scale.childLinks += 1
      const child = index.get(childFile)
      scale.resolvedRoots += child.roots.size
      for (const cls of child.roots) childRoots.add(cls)
      for (const cls of child.internal) {
        childInternal.add(cls)
        const owners = ownersOf.get(cls) ?? []
        if (!owners.includes(relTo(rootDir, childFile))) owners.push(relTo(rootDir, childFile))
        ownersOf.set(cls, owners)
      }
    }
    // 父组件写在子组件标签上的 `class`：随子组件根节点拿到父作用域属性 → 合法。
    const collect = (node) => {
      if (/^[A-Z]/.test(node.tag)) for (const cls of classesOfNode(node)) childRoots.add(cls)
      for (const child of elementChildren(node)) collect(child)
    }
    for (const node of elementChildren(descriptor.template?.ast)) collect(node)

    const own = index.get(file).own
    for (const block of blocks) {
      // 先剥注释再切规则：注释里的选择器/花括号都不是结构（css-rules.mjs 的既有铁律）。
      // 注意 `block` 是 SFCStyleBlock，CSS 文本在 `block.content`。
      for (const rule of splitCssRules(stripCssComments(block.content)).rules) {
        if (rule.kind !== 'rule') continue
        for (const selector of splitSelectorList(rule.selector)) {
          scale.selectors += 1
          if (isDeepSelector(selector)) continue
          const offenders = classNamesIn(selector).filter(
            (cls) => !own.has(cls) && !childRoots.has(cls) && childInternal.has(cls),
          )
          if (!offenders.length) continue
          hits.push({
            file: relTo(rootDir, file),
            selector,
            offenders: [...new Set(offenders)],
            // 一个类可能同时是多个子组件的内部类（`sheet` 在 ActionSheet 与 Modal 里都有）；
            // 不猜"用户想的是哪一个"，全都记上——命中本身与归属无关。
            children: [...new Set(offenders.flatMap((cls) => ownersOf.get(cls) ?? []))].sort(),
          })
        }
      }
    }
  }
  return { hits, scale }
}

/* ------------------------------------------------------------------ 全仓现状 */

const REPO = scanReachability(srcDir)

/**
 * 已登记的残留（父组件 → 子组件）：同一次恢复事故在别的文件里留下的**同一类**死规则。
 *
 * 【第五十四轮末（收尾补做）】五份并行清理把 12 对里的 9 对清零了（157 → 5），
 * 于是这张表收缩成下面 3 行。**剩下的每一行都有"为什么不删"的具体理由**，不是懒得清：
 *
 *   - `ScheduleView -> ScheduleGrid`（3 条）：可达性判据说它们不可达，但**保守判据**
 *     （那个类名在父文件 `<style>` 块之外出现过 ⇒ 一律保留）要求留下。三条分别是
 *     `.timetable`（脚本里有字符串常量 `kind: 'timetable'`）、`.course.conflict`
 *     （`item.type === 'conflict'`）、`.exception-tag.makeup`（`makeup` 由
 *     `viewExceptions[i].type` 运行期拼出，模板里没有 class 绑定）。
 *   - `ScheduleView -> QuickRecordPanel`（1 条）：`.error` —— 它在父文件**模板区**出现 4 次
 *     （`:error="managerError"` 这类**属性名**）。本例同时也是"只命中 1 条"的两对之一：
 *     宁可留着，也不冒删掉活规则的风险。
 *   - `NoticeUnderstanding -> Modal`（1 条）：`.confidence.medium` —— **这是守卫自己的假阳性，
 *     不是死规则**。`NoticeUnderstanding.vue` 的模板里是
 *     `<div class="confidence" :class="parsed.confidenceLevel">`（父组件**自己**的元素，
 *     取值域 `high|medium|low`），而 `medium` 恰好也是 `Modal.vue` 内部的一个类名，
 *     于是被归错了属。运行时探针（记录 `setScopeId`）实测这条规则**是活的**：拿到的是
 *     父作用域的 id。⇒ **这一条不许删，也不许收紧到 0**；要让它归零只能改判据
 *     （把父模板元素上 `:class` 的动态取值算作合法引用）。
 *
 * 旧注释里"每对相加 158 > 命中条数 157"的现象已消失：造成它的 `sheet` 那条同时落进
 * AppearanceSettings 的两对，而那两对现在都是 0。
 */
const RESIDUAL_PAIRS = new Map([
  ['views/ScheduleView.vue -> components/schedule/ScheduleGrid.vue', 3],
  ['views/ScheduleView.vue -> components/QuickRecordPanel.vue', 1],
  ['components/NoticeUnderstanding.vue -> components/Modal.vue', 1],
  // TasksView 抽出了看板 / 日历两个子组件（components/task-views/）之后新增的一对。
  //
  // 【登记理由：这些类不是死规则，是本守卫看不见的动态类】
  // `.due.today` / `.due.soon` / `.due.overdue` 三个类在 TasksView 的模板里**没有**字面量，
  // 它们来自 `<span class="due" :class="dueInfo(task).cls">`，而 `dueInfo()` 在 script 里
  // 返回 `{ cls: 'overdue' | 'today' | 'soon' | '' }`。守卫的判据是"这个类在父组件模板里
  // 出现过没有"，跨不过一次函数调用 —— 于是它只在新子组件的模板里找到同名类，
  // 判成"父引用子的内部类"。
  //
  // 三个子组件（TaskBoard / TaskCalendar）各自也定义了 `.today` / `.soon` / `.overdue`，
  // 正好让"只有子组件才有"的表象成立。真实情况是两边各自有用：列表视图靠 dueInfo 的
  // 动态 class 上色，看板/日历靠自己的静态 class 上色，删掉父组件那三条会让
  // **列表视图**的截止日期徽标掉色。
  //
  // 正确的长期修法是让守卫认识"`:class` 绑定到函数调用结果时，该函数 script 里
  // 返回的字符串字面量也算父组件在用"。本轮先按本文件既有的登记机制走，
  // 并把条数钉死为 1（`due` 那三条共用一个 `.due` 根类，记一次）。
  ['views/TasksView.vue -> components/task-views/TaskBoard.vue', 1],
  ['views/TasksView.vue -> components/task-views/TaskCalendar.vue', 1],
])
/**
 * 全仓命中**条数**（不是每对相加）的上限。
 * 第五十四轮末实测 5；本次 +1（TasksView → TaskCalendar，见上）= 6。
 * TaskBoard 那一对与 TaskCalendar 共享同一批 `due*` 类，计入的是同一条命中。
 */
const RESIDUAL_HITS = 6

/** 本轮清理的那一对：必须为 0，且不许再回来。 */
const OWNED_PAIR = 'App.vue -> components/Sidebar.vue'

/** 一条命中可能同时归因到多个子组件 → 展开成多个配对键。 */
const pairKeysOf = (hit) => hit.children.map((child) => `${hit.file} -> ${child}`)

const pairCountsOf = (hits) => {
  const counts = new Map()
  for (const hit of hits) {
    for (const key of pairKeysOf(hit)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/* ------------------------------------------------------------------ 夹具 */

/** 造一个临时 SFC 工程；回调结束后整棵删掉（绝不在仓库里留东西）。 */
function withFixture(files, run) {
  const dir = join(tmpdir(), `sl-scope-fixture-${process.pid}-${Math.random().toString(36).slice(2)}`)
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    }
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const FIXTURE = {
  'FixtureHost.vue': [
    '<script setup>',
    "import FixtureChild from './FixtureChild.vue'",
    '</script>',
    '<template>',
    '  <div class="host-page">',
    '    <FixtureChild class="host-passed" />',
    '  </div>',
    '</template>',
    '<style scoped>',
    '.host-page { color: red; }',
    '.host-passed { color: blue; }',
    '.child-root { color: green; }',
    '.child-root.collapsed .child-inner { color: black; }',
    '.child-inner { color: gray; }',
    ':deep(.child-inner) { color: pink; }',
    '.unknown-global { color: cyan; }',
    '</style>',
  ].join('\n'),
  'FixtureChild.vue': [
    '<script setup>',
    'import { ref } from "vue"',
    'const collapsed = ref(false)',
    '</script>',
    '<template>',
    '  <aside class="child-root" :class="{ collapsed }">',
    '    <span class="child-inner">x</span>',
    '  </aside>',
    '</template>',
  ].join('\n'),
}

/* ================================================================== 规模自证 */

describe('规模自证：判据真的扫到了东西', () => {
  it('扫到的 .vue / scoped 块 / 选择器 / 子组件链接都不能太少', () => {
    // 解析器一旦打偏（正则写坏、import 解析失败），命中数会静默变成 0 ——
    // "零命中"必须由这些规模数字证明它是"真扫过了"，而不是"什么都没扫到"。
    expect(REPO.scale.vueFiles, '没扫到 .vue 文件').toBeGreaterThanOrEqual(50)
    expect(REPO.scale.scopedFiles, '没扫到带 scoped 样式的文件').toBeGreaterThanOrEqual(45)
    expect(REPO.scale.scopedBlocks, '没扫到 scoped 样式块').toBeGreaterThanOrEqual(45)
    expect(REPO.scale.selectors, '扫到的 scoped 选择器太少，判据与实现脱节').toBeGreaterThanOrEqual(2000)
    expect(REPO.scale.childLinks, '没有解析出任何「父组件 import 子组件」的链接').toBeGreaterThanOrEqual(40)
    expect(REPO.scale.resolvedRoots, '没有从子组件模板里解析出任何根节点类').toBeGreaterThanOrEqual(30)
  })

  it('scoped 块定位与 scripts/css-rules.mjs 的 styleBlocksOf 一致', () => {
    // 两套定位法（自己读开标签属性 / 复用仓库的 styleBlocksOf）必须数到同一批块，
    // 否则"注释里的字面量 <style>"这类幽灵又会回来。
    const mismatched = []
    for (const file of walkVueFiles(srcDir)) {
      const text = readFileSync(file, 'utf8')
      const mine = scopedBlocksOf(text)
      const all = styleBlocksOf(text)
      if (mine.length > all.length) mismatched.push(relTo(srcDir, file))
    }
    expect(mismatched, 'scoped 块比样式块总数还多，说明定位被我写歪了').toEqual([])
    // 夹具里的 HTML 注释含字面量 <style>：不管走哪条路都不该多出一块
    withFixture({ 'Ghost.vue': '<!-- 见 <style> 里的 .skip-to-content -->\n<template><div/></template>\n<style scoped>.a{color:red}</style>' }, (dir) => {
      const text = readFileSync(join(dir, 'Ghost.vue'), 'utf8')
      expect(stripHtmlComments(text)).not.toContain('skip-to-content')
      expect(styleBlocksOf(text)).toHaveLength(1)
      expect(scopedBlocksOf(text)).toHaveLength(1)
    })
  })
})

/* ================================================================== 判据自证（夹具） */

describe('判据自证：该抓的必抓、不该抓的必放过', () => {
  const result = withFixture(FIXTURE, (dir) => scanReachability(dir))
  const selectors = result.hits.map((hit) => hit.selector)

  it('同一个样式块里，合法与非法各一条：只有非法的被抓', () => {
    // 非法（子组件内部节点上的类）
    expect(selectors, '「从子组件根节点往内部穿透」的写法没被抓出来').toContain('.child-root.collapsed .child-inner')
    expect(selectors, '只存在于子组件内部节点的裸类名没被抓出来').toContain('.child-inner')
    expect(result.hits).toHaveLength(2)
    for (const hit of result.hits) {
      expect(hit.children, '应当归因到 FixtureChild.vue').toEqual(['FixtureChild.vue'])
    }
  })

  it('合法写法一条都不许误报', () => {
    // 宿主自己的节点
    expect(selectors, '宿主导航自己模板里的类被误报').not.toContain('.host-page')
    // 子组件**根标签**上的类：父作用域属性会落在它身上，是真生效的
    expect(selectors, '子组件根节点上的类被误报（这是合法写法）').not.toContain('.child-root')
    // 父组件写在子组件标签上的 class：随根节点拿到父作用域属性
    expect(selectors, '写在子组件标签上的 class 被误报').not.toContain('.host-passed')
    // :deep() 本来就是穿透写法
    expect(selectors, ':deep() 被误报').not.toContain(':deep(.child-inner)')
    // 任何模板里都没有的类（全局类 / 过渡类名）：生死不确定 → 不判定
    expect(selectors, '全仓找不到来源的类被误报（应当「不判定」而不是报非法）').not.toContain('.unknown-global')
    expect(result.scale.selectors, '夹具的选择器都没数到，这条自证是假的').toBe(7)
  })

  it('合成夹具里 scoped 与 :class 对象都要被读出来（否则"0 命中"可能只是没读到类）', () => {
    const result2 = withFixture({
      'Host.vue': [
        '<script setup>',
        "import Child from './Child.vue'",
        '</script>',
        '<template><Child /></template>',
        '<style scoped>.a .b-c { color: red }</style>',
      ].join('\n'),
      'Child.vue': '<template><div class="a"><span :class="{ \'b-c\': on }">x</span></div></template>',
    }, (dir) => scanReachability(dir))
    // `a` 是子组件模板根标签上的类（合法），`b-c` 只在内部（非法）
    expect(result2.hits.map((hit) => hit.selector), '只该抓内部那一个').toEqual(['.a .b-c'])
    expect(result2.hits[0].offenders).toEqual(['b-c'])
  })
})

/* ================================================================== 判别力证据 */

describe('判别力：删掉的旧写法喂给判据必须被抓出来', () => {
  /** App.vue 第三十九轮删掉的写法（逐字复刻，含当时的两条 archetype）。 */
  const OLD_RULES = [
    '.sidebar.collapsed .nav-item {',
    '  padding-inline-start:8px;',
    '  padding-inline-end:8px}',
    '.theme-dots {',
    '  gap:7px;',
    '  display:flex}',
  ].join('\n')

  /** 把一段规则注回 App.vue 的 scoped 样式块末尾（只改副本，仓库文件不动）。 */
  function mutatedApp() {
    const text = readFileSync(join(srcDir, 'App.vue'), 'utf8')
    const at = text.lastIndexOf('</style>')
    return `${text.slice(0, at)}${OLD_RULES}\n${text.slice(at)}`
  }

  function fixtureWithApp(appSource) {
    return withFixture({
      'App.vue': appSource,
      'components/Sidebar.vue': readFileSync(join(srcDir, 'components', 'Sidebar.vue'), 'utf8'),
    }, (dir) => scanReachability(dir))
  }

  it('把已删的旧写法注回真实 App.vue 的副本 → 立刻被抓（单一变量的对照）', () => {
    const mutated = fixtureWithApp(mutatedApp())
    const caught = mutated.hits.filter((hit) => `${hit.file} -> ${hit.children.join(',')}` === OWNED_PAIR)
    expect(caught.map((hit) => hit.selector), '旧写法注回去了却没被抓到 —— 判据没有判别力').toEqual([
      '.sidebar.collapsed .nav-item',
      '.theme-dots',
    ])

    // 对照：同一个分析器、同一份 App.vue，**不改**它 → 这一对 0 命中。
    // 两条并排，唯一的变量就是那几行规则；少了这条，"抓到了"可能只是"什么都报"。
    const clean = fixtureWithApp(readFileSync(join(srcDir, 'App.vue'), 'utf8'))
    const cleanCaught = clean.hits.filter((hit) => `${hit.file} -> ${hit.children.join(',')}` === OWNED_PAIR)
    expect(cleanCaught.map((hit) => hit.selector), '没改过的 App.vue 仍报这一对 —— 说明清理没生效').toEqual([])
    expect(mutated.hits.length).toBeGreaterThan(clean.hits.length)
  })

  it('编译证据：scope 属性只落在最后一段，所以"祖先段写了子组件根类"救不了它', () => {
    // 这一条解释了上面那条为什么会死，也是"根节点 vs 内部节点"判据的直接依据。
    const compiled = compileStyle({
      source: '.sidebar.collapsed .nav-item { padding-inline: 8px }',
      filename: 'App.vue',
      id: 'data-v-app',
      scoped: true,
    }).code
    expect(compiled, '属性应当只加在最后一段（.nav-item），不是 .sidebar 上')
      .toContain('.sidebar.collapsed .nav-item[data-v-app]')
    // 对照：根节点上的类拿得到属性，所以那条是活的
    const live = compileStyle({ source: '.sidebar.collapsed { width: 72px }', filename: 'App.vue', id: 'data-v-app', scoped: true }).code
    expect(live).toContain('.sidebar.collapsed[data-v-app]')
    expect(readFileSync(join(srcDir, 'components', 'Sidebar.vue'), 'utf8'))
      .toMatch(/<aside class="sidebar"/)
  })
})

/* ================================================================== 全仓 */

describe('全仓扫描：非法命中只剩已登记的残留', () => {
  const pairCounts = pairCountsOf(REPO.hits)

  it(`本轮负责的那一对（${OWNED_PAIR}）非法命中为 0`, () => {
    const owned = REPO.hits.filter((hit) => pairKeysOf(hit).includes(OWNED_PAIR))
    expect(
      owned.map((hit) => hit.selector),
      'App.vue 的 scoped 样式又引用了 Sidebar.vue 内部节点上的类 —— 这些选择器永远匹配不到元素',
    ).toEqual([])
  })

  it('没有出现登记之外的新配对（棘轮只准缩小）', () => {
    const unregistered = [...pairCounts.keys()].filter((key) => !RESIDUAL_PAIRS.has(key))
    expect(
      unregistered,
      '出现了新的「父组件引用子组件内部类」配对。要么按同一判据删掉，要么（确认它确实该留）登记进 '
        + 'RESIDUAL_PAIRS 并写清理由 —— 但不许靠改大数字蒙过去',
    ).toEqual([])
  })

  it('每一对的条数不超过登记值（残留只准变少）', () => {
    const grown = [...pairCounts]
      .filter(([key, count]) => count > RESIDUAL_PAIRS.get(key))
      .map(([key, count]) => `${key}: ${count} > ${RESIDUAL_PAIRS.get(key)}`)
    expect(grown, '已登记的残留又长了，说明有新的死规则写进了这些文件').toEqual([])
    expect(REPO.hits.length, `全仓非法命中条数超过登记值 ${RESIDUAL_HITS}`).toBeLessThanOrEqual(RESIDUAL_HITS)
  })

  it('清单本身是自洽的（每项都是"父 -> 子"、数字是正整数）', () => {
    const malformed = [...RESIDUAL_PAIRS]
      .filter(([key, count]) => !/^[^ ]+\.vue -> [^ ]+\.vue$/.test(key) || !Number.isInteger(count) || count < 1)
      .map(([key]) => key)
    expect(malformed, '登记项写错了（应为 "父.vue -> 子.vue" 且数字为正整数）').toEqual([])
    // 残留只会随别的轮次清理而变少，所以**不**要求登记项必须仍然命中
    // （那是别人的工作量，会把这个守卫视成"别人不改我就红"）。棘轮的方向是单向的：
    // 新的配对与增长的条数一律不许。
  })
})

/* ================================================================== 活规则不许被顺手删掉 */

describe('活规则不许被一起删掉（清理的边界）', () => {
  const appCss = scopedBlocksOf(readFileSync(join(srcDir, 'App.vue'), 'utf8')).join('\n')
  const appRules = splitCssRules(stripCssComments(appCss)).rules.filter((rule) => rule.kind === 'rule')

  it('三条真正生效的侧边栏规则都还在', () => {
    // 依据：.sidebar 是 Sidebar.vue 的模板根标签 → 父作用域属性会落在它身上。
    expect(appRules.map((rule) => rule.selector), '少了 .sidebar 的规则').toContain('.sidebar')
    expect(appRules.map((rule) => rule.selector), '少了 .sidebar.collapsed 的规则').toContain('.sidebar.collapsed')
    // ≤900px 那次「把侧边栏变成底栏」的 @media 规则必须还在，且仍在媒体查询里
    const bottomBar = appRules.find((rule) => rule.selector === '.sidebar,.sidebar.collapsed')
    expect(bottomBar, '找不到把侧边栏变成底栏的那条规则').toBeTruthy()
    expect(bottomBar.context, '底栏规则必须仍然包在 ≤900px 的媒体查询里').toMatch(/@media[^{]*max-width:\s*900px/)
    expect(bottomBar.body, '底栏规则的关键声明丢了').toMatch(/position\s*:\s*fixed/)
    // .sidebar 的 z-index 是层叠阶梯上的一档（tests/sidebarDrawer.test.js 也盯着它）
    const sidebarRule = appRules.find((rule) => rule.selector === '.sidebar')
    expect(sidebarRule.body, '.sidebar 的 z-index 丢了').toMatch(/z-index\s*:\s*20/)
  })

  it('侧边栏那段删掉的写法没有被"顺手"删到别的组件身上', () => {
    // 反面对照：Sidebar.vue 自己的样式块里必须有等价规则——否则这次删除就是丢样式而不是去死规则。
    const sidebarCss = scopedBlocksOf(readFileSync(join(srcDir, 'components', 'Sidebar.vue'), 'utf8')).join('\n')
    for (const selector of ['.brand-mark', '.nav-item', '.sidebar-foot', '.quick-add-button', '.theme-dot', '.mobile-more-sheet']) {
      expect(sidebarCss, `Sidebar.vue 里没有 ${selector} 的等价规则，App.vue 那边不该删`).toContain(selector)
    }
  })
})