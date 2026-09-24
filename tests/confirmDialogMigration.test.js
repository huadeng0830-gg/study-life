// @vitest-environment happy-dom
/**
 * 原生 `confirm` → 应用内 `ConfirmDialog` 迁移守卫。
 *
 * 【缺口是什么】全仓曾有 24 处原生 `window.confirm` / 裸 `confirm`：它们是**浏览器**弹窗，
 * 在这个 PWA 里既不受主题控制，也没有 `Modal` 的浮层栈、焦点陷阱、Escape 出口与焦点还原；
 * 读屏用户更是完全脱离文档（原生 confirm 是浏览器级对话框）。仓库里已经有 5 处
 * `ConfirmDialog`（TasksView / ScheduleView / LedgerView / ExamsView / ListsView），
 * 这次把剩下的确认点全部收拢到同一个组件上。
 *
 * 【这里验什么】
 *   1. 静态层：`src/` 下不再有 `window.confirm(`；裸 `confirm(` 只允许出现在
 *      `ImageCropModal.vue` / `TimeWheelSheet.vue` 那两个**同名局部函数定义**处
 *      （它们遮蔽/无关乎 `window.confirm`，不该动）；
 *   2. 判别力自证：同一份判据喂给含 `window.confirm(` 的夹具必须命中，
 *      喂给"局部函数定义 + 别的裸调用"必须只报后者——否则这条守卫可能只是在断言空集；
 *   3. 行为层：在**真实应用**（真实路由 + 真实 store）里点按钮，确认与取消各断言一次，
 *      证明"取消真的什么都没发生、确认真的改了数据"，而不是只证明"弹窗出现了"。
 *
 * 【为什么绝不 stub `window.confirm`】happy-dom 根本没实现它，stub 一个返回值只能证明
 * "我替换掉的函数被调用了"，反而会把"代码仍在调原生 confirm"这个真缺陷盖住——
 * 迁移之后正确的现象是**根本没有原生 confirm 可调**。
 *
 * 【模块注册表】`useStoredRef` 在 import 期就读取并缓存 `sl_*`，所以每个用例都要
 * `vi.resetModules()` → 播种 localStorage → 动态 import 应用。动态 import 必须
 * **全部**来自同一个注册表（包括 `settle`）：静态 import 的 `settle` 用的是另一个
 * Vue 实例的 `nextTick`，会在新实例刷新之前就 resolve，断言就会随机飘。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

/* ================= ① 静态层：源码扫描 ================= */

const srcDir = resolve(import.meta.dirname, '..', 'src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|js)$/.test(name)) out.push(full)
  }
  return out
}

/**
 * 剥掉注释（HTML 注释与 JS 行/块注释），**保留字符串内容**。
 *
 * 本仓铁律：凡是要 parse 文本，先剥注释。这里的注释里就写着 `window.confirm(`
 * 之类的字样（改造说明、迁移清单），不剥的话守卫会被自己的文档骗出假命中。
 * 字符串必须保留的原因相反：`confirm(` 的实参从来都在字符串里，把字符串挖掉
 * 等于把要查的东西一起删了。
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
/** 改造前的实现（逐字复刻），只用于反证下面那个夹具真的在咬。 */
function stripCommentsLegacy(source) {
  let out = ''
  let i = 0
  let quote = null
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
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue }
    if (ch === '<' && source.startsWith('<!--', i)) { while (i < source.length && !source.startsWith('-->', i)) i += 1; i += 3; continue }
    if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
    if (ch === '/' && next === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1; i += 2; continue }
    out += ch
    i += 1
  }
  return out
}

/**
 * 这条守卫的地基是"先剥注释"，而剥注释器**自己也会腐坏**（它上一次腐坏就发生在本文件
 * 守护的那个文件里）。所以给它一对正反夹具：修好后的实现认得出正则字面量，而逐字复刻的
 * 旧实现在**同一份输入**上剥不掉注释——后者保证这个夹具不是空的。
 */
describe('剥注释器认得正则字面量（守卫的地基也要有夹具）', () => {
  const SAMPLE = [
    'function csvCell(value) {',
    "  const text = String(value ?? '')",
    '  return /[",\\n\\r]/.test(text) ? `"${text.replace(/"/g, \'""\')}"` : text',
    '}',
    "// window.prompt('旧写法') —— 这句注释必须被剥掉",
    'const after = 1',
  ].join('\n')

  it('修好后：正则行之后的注释照样被剥掉', () => {
    const stripped = stripComments(SAMPLE)
    expect(stripped).not.toContain('window.prompt')
    expect(stripped).toContain('const after = 1')
  })

  it('反证：旧实现（逐字复刻）在同一份输入上剥不掉 → 夹具真的在咬', () => {
    expect(stripCommentsLegacy(SAMPLE)).toContain('window.prompt')
  })

  it('反向保护：字符串与模板里的 // 不许被当成注释切掉（防止修过头）', () => {
    const guard = "const u = 'http://example.com/x' // 真注释\nconst t = `a\n// 模板里的字面量\nb`\nconst z = 1\n"
    const stripped = stripComments(guard)
    expect(stripped).toContain('http://example.com/x')
    expect(stripped).toContain('模板里的字面量')
    expect(stripped).toContain('const z = 1')
  })
})

const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

const SOURCES = walk(srcDir).map((file) => ({
  file: rel(file),
  code: stripComments(readFileSync(file, 'utf8')),
}))

const sourceOf = (path) => SOURCES.find((entry) => entry.file === path)?.code ?? ''

/** 判据一：`window.confirm(` 一律不允许（含 `window . confirm (` 这种写法）。 */
const WINDOW_CONFIRM = /window\s*\.\s*confirm\s*\(/

function windowConfirmIssues(sources) {
  return sources.filter(({ code }) => WINDOW_CONFIRM.test(code)).map(({ file }) => file)
}

/**
 * 逐个找出"裸 `confirm(`"出现的位置（成员调用 `xxx.confirm(` 不算裸的）。
 * 返回每处**前面 64 个字符**的上下文，用来区分"函数定义"与"函数调用"——
 * 这正是这条判据有牙齿的地方：`function confirm() {` 要放行，
 * `if (!confirm('…'))` 要报错，而两者在纯字符串搜索里长得一模一样。
 */
function bareConfirmSites(code) {
  const sites = []
  let index = code.indexOf('confirm')
  while (index !== -1) {
    const before = code.slice(Math.max(0, index - 64), index)
    const after = code.slice(index + 'confirm'.length)
    const isCall = /^\s*\(/.test(after)
    const isMember = /[.\w$]$/.test(before)
    if (isCall && !isMember) sites.push(before)
    index = code.indexOf('confirm', index + 1)
  }
  return sites
}

/** `function confirm(` / `async function confirm(` 的定义处。 */
const LOCAL_CONFIRM_DEFINITION = /(?:^|[^\w$])(?:async\s+)?function\s+$/

/** 判据二：裸 `confirm(` 只允许是本地同名函数的**定义**。 */
function bareConfirmIssues(sources) {
  const issues = []
  for (const { file, code } of sources) {
    for (const before of bareConfirmSites(code)) {
      if (LOCAL_CONFIRM_DEFINITION.test(before)) continue
      issues.push(`${file}: 裸 confirm( 调用（只允许本地同名函数定义）`)
    }
  }
  return issues
}

/** 定义了本地 `confirm` 函数的文件（允许清单要**恰好**等于它）。 */
function filesWithLocalConfirm(sources) {
  return sources
    .filter(({ code }) => bareConfirmSites(code).some((before) => LOCAL_CONFIRM_DEFINITION.test(before)))
    .map(({ file }) => file)
    .sort()
}

/**
 * 每个 `<ConfirmDialog>` 的 `@confirm` / `@close` 绑定的名字，必须真的在本文件里声明。
 *
 * 为什么需要这条：换掉原生 confirm 时，处理函数被拆成了"打开对话框"与"确认后执行"
 * 两个（createSpace → confirmCreateSpace + runCreateSpace 之类）。模板里若还留着旧名字，
 * Vue **编译不会报错**（`@confirm="oldName"` 编译成取一个不存在的属性），点下去只会静默
 * 什么也不做——这正是本次改造最容易留下的坑。行为用例只能覆盖得到其中两条路径，
 * 所以这里对全部用法做一次静态对账。
 */
const CONFIRM_BLOCK = /<ConfirmDialog\b[\s\S]*?\/>/g

function confirmBindingIssues(sources) {
  const issues = []
  for (const { file, code } of sources) {
    for (const block of code.match(CONFIRM_BLOCK) ?? []) {
      for (const [, attr, raw] of block.matchAll(/@(confirm|close)="([^"]+)"/g)) {
        const expr = raw.trim()
        const callName = /^([A-Za-z_$][\w$]*)$/.exec(expr)?.[1]
        const assignName = /^([A-Za-z_$][\w$]*)\s*=/.exec(expr)?.[1]
        // 内联箭头函数等写法不在本次改造里，跳过（留个出口而不是误报）
        if (!callName && !assignName) continue
        const name = callName ?? assignName
        const ok = callName
          ? new RegExp(`(?:async\\s+)?function\\s+${name}\\b`).test(code)
          : new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(code)
        if (!ok) issues.push(`${file}: @${attr}="${expr}" 指向的 ${name} 在本文件里没有声明`)
      }
    }
  }
  return issues
}

function confirmBlockCount(sources) {
  return sources.reduce((sum, { code }) => sum + (code.match(CONFIRM_BLOCK)?.length ?? 0), 0)
}

/** 本轮把原生确认换成 ConfirmDialog 的 7 个文件（共 23 处确认点）。 */
const MIGRATED_FILES = [
  'components/AppearanceSettings.vue',
  'components/DataManager.vue',
  'components/LocalTransfer.vue',
  'components/schedule/TimeSettingsModal.vue',
  'views/EventsView.vue',
  'views/NotesView.vue',
  'views/ScheduleView.vue',
]

const ALLOWED_LOCAL_CONFIRM = ['components/TimeWheelSheet.vue', 'components/schedule/ImageCropModal.vue']

describe('静态层：原生 confirm 已经全部退场', () => {
  it('扫描器自证：扫到的文件数与代码量都不是空的', () => {
    // 判据写坏（比如 walk 失效、剥注释把整份源码吃掉）时这里会掉到 0，
    // 那种"假绿"比漏报更危险——本仓已经踩过两次。
    expect(SOURCES.length, '没扫到任何 .vue/.js').toBeGreaterThanOrEqual(60)
    const totalCode = SOURCES.reduce((sum, { code }) => sum + code.length, 0)
    expect(totalCode, '剥注释后代码量太少，判据没有意义').toBeGreaterThan(200_000)
  })

  it('src/ 下不再有 window.confirm(', () => {
    expect(windowConfirmIssues(SOURCES)).toEqual([])
  })

  it('裸 confirm( 只出现在两个同名局部函数的定义处', () => {
    expect(bareConfirmIssues(SOURCES)).toEqual([])
    // 正向锚定允许清单：这两个文件**确实**还定义着本地 confirm（不是靠"全仓都没有"过关）。
    expect(filesWithLocalConfirm(SOURCES)).toEqual([...ALLOWED_LOCAL_CONFIRM].sort())
  })

  it('判别力自证：该抓的抓得住、该放的放得过（不是恒真断言）', () => {
    const windowCall = "function save() { if (!window.confirm('确定删除吗？')) return }"
    expect(windowConfirmIssues([{ file: 'Fixture.vue', code: windowCall }]), '含 window.confirm( 的夹具没被抓住').toEqual(['Fixture.vue'])
    // 对照：换成 ConfirmDialog 之后同一份代码不该命中
    expect(windowConfirmIssues([{ file: 'Fixture.vue', code: 'function save() { target.value = note }' }])).toEqual([])

    const bareCall = "function save() { if (!confirm('确定删除吗？')) return }"
    expect(bareConfirmIssues([{ file: 'Fixture.vue', code: bareCall }]), '裸调用没被抓住').toHaveLength(1)

    // 定义放行、别的裸调用照抓 —— 两者只差 `function ` 这几个字符
    const definitionAndCall = 'async function confirm() { done() }\nfunction other() { confirm() }'
    expect(bareConfirmIssues([{ file: 'Fixture.vue', code: definitionAndCall }])).toHaveLength(1)
    expect(filesWithLocalConfirm([{ file: 'Fixture.vue', code: definitionAndCall }])).toEqual(['Fixture.vue'])

    // 注释里的字面量不算（本仓铁律：先剥注释）
    const commented = "// 这里以前是 window.confirm('确定删除吗？')\nconst x = 1"
    expect(windowConfirmIssues([{ file: 'Fixture.vue', code: stripComments(commented) }])).toEqual([])
    // ……但同一份**未剥注释**的文本会命中：证明牙齿来自判据，"没命中"来自剥注释这一步
    expect(windowConfirmIssues([{ file: 'Fixture.vue', code: commented }])).toEqual(['Fixture.vue'])
  })

  it('迁移涉及的文件都已接入 ConfirmDialog（正向断言，避免整体变成"断言空集"）', () => {
    const missing = MIGRATED_FILES.filter((file) => !sourceOf(file).includes('ConfirmDialog'))
    expect(missing, `这些文件还没有引入 ConfirmDialog：${missing.join('、')}`).toEqual([])
    // 清单本身要指向真实存在的文件（写错路径会退化成空循环）
    const unresolved = MIGRATED_FILES.filter((file) => !sourceOf(file))
    expect(unresolved).toEqual([])
  })

  it('每处 ConfirmDialog 的 @confirm / @close 都指向真实存在的处理函数或 ref', () => {
    // 先证明这条判据不是空转：拆函数时留下的旧名字必须能被抓出来
    const good = '<ConfirmDialog :open="r" @close="r = null" @confirm="run" />\nfunction run() {}\nconst r = ref(null)'
    const bad = '<ConfirmDialog :open="r" @close="r = null" @confirm="runOld" />\nfunction run() {}\nconst r = ref(null)'
    expect(confirmBindingIssues([{ file: 'Fixture.vue', code: good }])).toEqual([])
    expect(confirmBindingIssues([{ file: 'Fixture.vue', code: bad }])).toHaveLength(1)

    expect(confirmBlockCount(SOURCES), '全仓 ConfirmDialog 用法太少，判据没覆盖到东西').toBeGreaterThanOrEqual(26)
    expect(confirmBindingIssues(SOURCES)).toEqual([])
  })
})

/* ================= ② 行为层：真实应用里的确认 / 取消 ================= */

let mounted = null

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  // 本文件对浮层做**整体**断言（`topOverlay()` 取 body 里最后一个 `.overlay`），所以必须
  // 保证"更新说明浮层"不会插进来：全新 profile 下应用会自动弹它（正确行为），而它是
  // `defineAsyncComponent`，挂不挂得上取决于时序——第五十四轮版本号 48→49 时，
  // 下面那条「取消后确认框应关闭」就因此从靠运气绿翻成了红（报告 §1.82）。
  // 现在这条保证由**夹具**统一提供（`tests/helpers/mountApp.js` 默认扮演回访用户），
  // 那里有一段完整说明；本文件保留这一行是为了在 `localStorage.clear()` 之后显式复位，
  // 不依赖"夹具一定在我之后跑"这种隐含假设。
  const { markReleaseSeen } = await import('../src/composables/releaseNotes.js')
  markReleaseSeen()
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
  // 滚动锁写在 body.dataset 上，用例之间必须清干净（否则后一个用例会继承前一个的锁状态）
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

/** 用真实路由挂载应用并跳到某个页面；返回同一注册表里的 settle。 */
async function boot(hash) {
  const { mountApp, gotoRoute, settle } = await import('./helpers/mountApp.js')
  const { routes } = await import('../src/router/routes.js')
  mounted = await mountApp({ routes })
  const main = await gotoRoute(mounted, hash)
  return { main, settle }
}

/** 把待确认数据真正落盘（store 的写入是 300ms 防抖的）。 */
async function flushWrites() {
  const { flushStoredWrites } = await import('../src/composables/store/core.js')
  flushStoredWrites()
}

const readStored = (key) => JSON.parse(localStorage.getItem(key) ?? 'null')

/** 只点**文本完全相等**的按钮，避免"删除壁纸"这类被"删除"误抓。 */
function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

function buttonByLabel(root, label) {
  return root.querySelector(`button[aria-label="${label}"]`)
}

/** 当前最上层的浮层（ConfirmDialog 自己 Teleport 到 body，所以从 body 里找）。 */
function topOverlay() {
  const overlays = [...document.querySelectorAll('.overlay')]
  return overlays[overlays.length - 1] ?? null
}

/** 最上层确认框的两个键：[取消, 确认]（顺序就是渲染顺序，顺带锁住改文案不会调换）。 */
function dialogButtons() {
  const overlay = topOverlay()
  const buttons = overlay ? [...overlay.querySelectorAll('.modal-foot button')] : []
  return buttons.length === 2 ? buttons : null
}

function setInput(el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * 确认框必须叠在底层浮层**之后**（= 之上）。
 *
 * body 里每个 `.overlay` 的 z-index 都是 100（Modal.vue 的样式），所以谁盖住谁完全由
 * DOM 顺序决定；Teleport 的锚点又是在组件挂载时创建的。于是"确认框排在后面"就是
 * "确认框在最上层"唯一可在 happy-dom 里断言的代理判据。这条判据有牙齿：
 * 改造过程中确认框一度是在页面挂载时就建好锚点的，那时 dump 出来的顺序正好是
 * [确认框, 表单]——底层表单把确认框整个盖住（读屏/Escape 却认为确认框在最上层）。
 */
function overlayIndex(predicate) {
  return [...document.querySelectorAll('.overlay')].findIndex(predicate)
}

function expectConfirmAbove(label, lowerSelector) {
  const lower = overlayIndex((overlay) => overlay.querySelector(lowerSelector))
  const confirm = overlayIndex((overlay) => overlay.querySelector('.modal-foot'))
  expect(lower, `${label}：底层浮层应当存在`).toBeGreaterThanOrEqual(0)
  expect(confirm, `${label}：确认框浮层应当存在`).toBeGreaterThanOrEqual(0)
  expect(confirm, `${label}：确认框必须排在底层浮层之后，否则会被它盖住`).toBeGreaterThan(lower)
}

/** 未来 30 天，保证落在"已安排 / 即将到来"筛选里且与运行日期无关。 */
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

describe('行为层：确认与取消都要真的分叉', () => {
  it('笔记删除：点取消笔记还在，点确认才真的删掉', async () => {
    localStorage.setItem('sl_quick_notes', JSON.stringify([
      { id: 'n1', title: '买书', content: '记得买线性代数', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    const { main, settle } = await boot('/notes')
    expect(main.textContent, '笔记应先在列表里').toContain('买书')

    buttonByText(main, '删除').click()
    await settle()
    let keys = dialogButtons()
    expect(keys, '点删除应当打开应用内确认框（原生 confirm 已不存在）').toBeTruthy()
    expect(topOverlay().textContent).toContain('确定删除“买书”吗？')
    expect([keys[0].textContent.trim(), keys[1].textContent.trim()], '默认取消文案与删除键语气').toEqual(['取消', '删除'])
    expect(keys[1].className, '删除仍是危险键').toContain('btn-danger')

    // 取消：数据不变
    keys[0].click()
    await settle()
    expect(topOverlay(), '取消后确认框应关闭').toBeNull()
    await flushWrites()
    expect(readStored('sl_quick_notes').map((note) => note.title), '取消不该删笔记').toEqual(['买书'])
    expect(main.textContent, '取消后列表里仍应有这条笔记').toContain('买书')

    // 确认：真的删掉
    buttonByText(main, '删除').click()
    await settle()
    keys = dialogButtons()
    expect(keys).toBeTruthy()
    keys[1].click()
    await settle()
    expect(topOverlay()).toBeNull()
    await flushWrites()
    expect(readStored('sl_quick_notes'), '确认后必须真的删除').toEqual([])
    expect(main.textContent, '删掉后列表里不该再有它').not.toContain('买书')
  })

  it('日程删除：点取消日程还在，点确认才真的删掉', async () => {
    localStorage.setItem('sl_events', JSON.stringify([
      { id: 'e1', title: '小组会议', date: FUTURE, time: '10:00', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    const { main, settle } = await boot('/events')
    expect(main.textContent).toContain('小组会议')

    buttonByText(main, '删除').click()
    await settle()
    let keys = dialogButtons()
    expect(keys, '日程删除也走同一套确认框').toBeTruthy()
    expect(topOverlay().textContent).toContain('确定删除“小组会议”吗？')

    keys[0].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_events').map((event) => event.title), '取消不该删日程').toEqual(['小组会议'])

    buttonByText(main, '删除').click()
    await settle()
    keys = dialogButtons()
    keys[1].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_events'), '确认后必须真的删除').toEqual([])
  })

  it('待办删除：仓库原有的 ConfirmDialog 用法（回归对照）同样只认确认', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([
      { id: 't1', title: '交作业', status: 'pending', done: false, dueDate: FUTURE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    const { main, settle } = await boot('/tasks')

    buttonByLabel(main, '删除待办').click()
    await settle()
    let keys = dialogButtons()
    expect(keys).toBeTruthy()
    keys[0].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_tasks').map((task) => task.title), '取消不该删待办').toEqual(['交作业'])

    buttonByLabel(main, '删除待办').click()
    await settle()
    keys = dialogButtons()
    keys[1].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_tasks'), '确认后必须真的删除').toEqual([])
  })

  it('冲突继续保存：取消不写数据，确认才写入（且确认键是 primary 不是危险键）', async () => {
    // 同一天、都没有时间 → 默认时长 60 分钟的两段直接重叠。
    localStorage.setItem('sl_tasks', JSON.stringify([
      { id: 't1', title: '写高数作业', status: 'pending', done: false, dueDate: FUTURE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    localStorage.setItem('sl_events', JSON.stringify([]))
    const { main, settle } = await boot('/events')

    // 新建日程的表单在 Modal 里，而 Modal 是 Teleport 到 body 的——所以表单控件
    // 不在 #main-content 里，必须从浮层里按 .event-form 精确定位（否则会抓到
    // ConfirmDialog 或页面上的同名元素）。
    const formModal = () => [...document.querySelectorAll('.overlay .modal')].find((modal) => modal.querySelector('.event-form'))
    const formTitle = () => formModal().querySelector('.event-form input:not([type])')
    const formDate = () => formModal().querySelector('.event-form input[type="date"]')
    const submitForm = () => [...formModal().querySelectorAll('button')].find((button) => button.textContent.trim() === '添加')

    // 第一次：取消
    buttonByText(main, '＋ 新建日程').click()
    await settle()
    setInput(formTitle(), '开组会')
    setInput(formDate(), FUTURE)
    submitForm().click()
    await settle()
    let keys = dialogButtons()
    expect(keys, '时间冲突应当弹确认框而不是原生 confirm').toBeTruthy()
    expect(topOverlay().textContent).toContain('时间冲突')
    expectConfirmAbove('日程表单之上的冲突确认框', '.event-form')
    expect([keys[0].textContent.trim(), keys[1].textContent.trim()]).toEqual(['返回修改', '继续保存'])
    expect(keys[1].className, '冲突是"继续保存"，不该用红色危险键').toContain('btn-primary')
    expect(keys[1].className).not.toContain('btn-danger')

    keys[0].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_events'), '取消后不该写入日程').toEqual([])
    expect(formModal(), '取消后表单应仍开着等用户修改').toBeTruthy()
    expect(formTitle().value, '取消后用户填的内容不能被清掉').toBe('开组会')

    // 第二次：确认继续保存
    submitForm().click()
    await settle()
    keys = dialogButtons()
    expect(keys).toBeTruthy()
    keys[1].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_events').map((event) => event.title), '确认后必须真的写入').toEqual(['开组会'])
    expect(formModal(), '保存成功后表单应关闭').toBeFalsy()
    await settle()
    expect(main.textContent).toContain('开组会')
  })

  it('待办冲突继续保存：取消不改数据，确认才落盘（同样叠在表单之上）', async () => {
    // 两条同一天的待办 → 改其中一条保存时必然撞上另一条。
    localStorage.setItem('sl_tasks', JSON.stringify([
      { id: 't1', title: '交作业', status: 'pending', done: false, dueDate: FUTURE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 't2', title: '写报告', status: 'pending', done: false, dueDate: FUTURE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    const { main, settle } = await boot('/tasks')

    // 编辑表单同样 Teleport 到 body，从浮层里按 #tasks-title 定位。
    const formModal = () => [...document.querySelectorAll('.overlay .modal')].find((modal) => modal.querySelector('#tasks-title'))
    const titleInput = () => formModal().querySelector('#tasks-title')
    const saveButton = () => [...formModal().querySelectorAll('button')].find((button) => button.textContent.trim() === '保存')

    // 点卡片打开编辑表单（卡片上的 openEdit）
    main.querySelector('.card.task').click()
    await settle()
    expect(formModal(), '点卡片应当打开编辑表单').toBeTruthy()
    setInput(titleInput(), '交作业（改）')

    saveButton().click()
    await settle()
    let keys = dialogButtons()
    expect(keys, '待办冲突也应当弹确认框').toBeTruthy()
    expect(topOverlay().textContent).toContain('时间冲突')
    expect([keys[0].textContent.trim(), keys[1].textContent.trim()]).toEqual(['返回修改', '继续保存'])
    expect(keys[1].className).toContain('btn-primary')
    expectConfirmAbove('待办表单之上的冲突确认框', '#tasks-title')

    keys[0].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_tasks').map((task) => task.title), '取消不该写入改动').toEqual(['交作业', '写报告'])
    expect(formModal(), '取消后表单应仍开着').toBeTruthy()

    saveButton().click()
    await settle()
    keys = dialogButtons()
    expect(keys).toBeTruthy()
    keys[1].click()
    await settle()
    await flushWrites()
    expect(readStored('sl_tasks').map((task) => task.title), '确认后必须真的落盘').toEqual(['交作业（改）', '写报告'])
    expect(formModal(), '保存成功后表单应关闭').toBeFalsy()
  })

  it('冲突确认框上按 Escape：只关最上层，表单不关、数据不动、页面锁不解除', async () => {
    localStorage.setItem('sl_tasks', JSON.stringify([
      { id: 't1', title: '写高数作业', status: 'pending', done: false, dueDate: FUTURE, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    ]))
    localStorage.setItem('sl_events', JSON.stringify([]))
    const { main, settle } = await boot('/events')

    buttonByText(main, '＋ 新建日程').click()
    await settle()
    const formModal = () => [...document.querySelectorAll('.overlay .modal')].find((modal) => modal.querySelector('.event-form'))
    setInput(formModal().querySelector('.event-form input:not([type])'), '开组会')
    setInput(formModal().querySelector('.event-form input[type="date"]'), FUTURE)
    ;[...formModal().querySelectorAll('button')].find((button) => button.textContent.trim() === '添加').click()
    await settle()
    expect(dialogButtons(), '先要有确认框').toBeTruthy()

    // Escape 派发到最上层浮层的 .modal 上并冒泡到 document（Modal 的监听挂在那里）
    topOverlay().querySelector('.modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(dialogButtons(), 'Escape 应当只关掉确认框').toBeNull()
    expect(formModal(), '底下的表单必须留着').toBeTruthy()
    expect(document.body.dataset.modalOpen, '底层弹窗还开着，页面锁不能提前解除').toBe('true')
    await flushWrites()
    expect(readStored('sl_events'), 'Escape 取消不该写入任何数据').toEqual([])
  })
})

/* ================= ③ ConfirmDialog 自身：新 prop 不动既有默认观感 ================= */

describe('ConfirmDialog：新增的 tone / cancelLabel 不改变默认观感', () => {
  let app = null

  afterEach(() => {
    app?.unmount()
    app = null
  })

  async function mountDialog(props) {
    const { createApp, h } = await import('vue')
    const ConfirmDialog = (await import('../src/components/ConfirmDialog.vue')).default
    const { settle } = await import('./helpers/mountApp.js')
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(ConfirmDialog, { open: true, ...props }) })
    app.mount(host)
    await settle()
    const keys = dialogButtons()
    return { keys, settle }
  }

  it('默认仍是「取消 / btn-danger」，并且只有显式 tone="primary" 才变主色键', async () => {
    const dflt = await mountDialog({ message: '确定删除吗？', confirmLabel: '删除' })
    expect(dflt.keys.map((button) => button.textContent.trim())).toEqual(['取消', '删除'])
    expect(dflt.keys[1].className).toContain('btn-danger')
    app.unmount()
    app = null
    document.body.innerHTML = ''

    const primary = await mountDialog({ message: '发现时间冲突，是否继续保存？', confirmLabel: '继续保存', cancelLabel: '返回修改', tone: 'primary' })
    expect(primary.keys.map((button) => button.textContent.trim())).toEqual(['返回修改', '继续保存'])
    expect(primary.keys[1].className).toContain('btn-primary')
    expect(primary.keys[1].className).not.toContain('btn-danger')
  })
})

/* ================= ④ 编译层：改造过的组件都能编译 ================= */

describe('改造涉及的组件都能编译', () => {
  it('静态 import 成功即证明模板/脚本语法成立（含没有行为用例的几个文件）', async () => {
    // 行为用例只挂载得到 NotesView / EventsView / TasksView；其余 5 个（外观设置、
    // 数据管理、二维码迁移、作息设置、ScheduleView 的课程相关确认）在 happy-dom 里
    // 要么依赖 IndexedDB / 摄像头 / 网络，要么需要层层浮层配合，这里至少保证它们能被
    // Vue 编译：模板里少一个引号、v-if 写错，都会在这里直接抛出来。
    const modules = await Promise.all([
      import('../src/components/AppearanceSettings.vue'),
      import('../src/components/ConfirmDialog.vue'),
      import('../src/components/DataManager.vue'),
      import('../src/components/LocalTransfer.vue'),
      import('../src/components/schedule/TimeSettingsModal.vue'),
      import('../src/views/ScheduleView.vue'),
    ])
    for (const [index, module] of modules.entries()) {
      expect(module.default, `第 ${index} 个组件没编译出组件定义`).toBeTruthy()
    }
  })
})