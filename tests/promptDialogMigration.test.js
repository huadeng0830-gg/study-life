// @vitest-environment happy-dom
/**
 * 原生浏览器弹窗（`prompt` / `alert` / `confirm`）彻底退场的迁移守卫。
 *
 * 【缺口是什么】`window.prompt` / `alert` / `confirm` 是**浏览器级**对话框：不受主题控制、
 * 不参与 `Modal` 的浮层栈（没有焦点陷阱、没有 Escape 出口、遮罩点不掉）、读屏用户完全脱离
 * 文档；更直接的后果是**在测试环境里它们根本不存在**——happy-dom 下这三个都是 `undefined`，
 * 调用直接抛 `TypeError`，于是走那条路径的功能（改分类名、生成回顾笔记的提示）此前
 * **无法被任何用例验证**。本轮把最后这处 `window.prompt`（账本「修改分类名称」）搬到
 * `PromptDialog`，并把本周回顾页那两处裸 `alert()` 换成页面内联提示。
 *
 * 【这里验什么】
 *   ① 静态层：`src/` 下 `window.prompt(` / `window.alert(` / `window.confirm(` 命中数必须为 0；
 *      **裸** `prompt(` / `alert(` / `confirm(` 调用同样为 0，但放行同名的局部函数**定义**
 *      （`TimeWheelSheet.vue` / `ImageCropModal.vue` 里那两个 `function confirm()` 与本类无关，
 *      不该动——这条放行清单是正向锚定的，不是"全仓都没有"式过关）；
 *   ② 判别力自证：把改造**前**的写法喂给同一套扫描必须被抓出来（含裸 `alert(...)` 夹具、
 *      以及"注释里的字面量不算、未剥注释的同一份文本会命中"这一对）；
 *   ③ 行为层：真挂载 `PromptDialog`（组件级）与真实路由下的账本页 / 回顾页（页面级），
 *      确认回传 trim 后的值、取消与 Escape 不产生写入、空串按"无变化"处理；
 *   ④ 反向对照：每条"应该没有"的断言旁边都有一条"同一探针确实能看见东西"的断言
 *      （取消后**没有** confirm 事件，而确认时**确实有**），避免断言恒真。
 *
 * 【为什么绝不 stub `window.prompt` / `window.alert`】happy-dom 没实现它们，stub 一个返回值
 * 只能证明"我替换掉的函数被调用了"，反而会把"代码仍在调原生弹窗"这个真缺陷盖住——
 * 迁移之后正确的现象是**根本没有原生弹窗可调**。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'
import PromptDialog from '../src/components/PromptDialog.vue'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { ledgerCategories } from '../src/composables/ledger.js'
import { DEFAULT_CATEGORIES } from '../src/composables/ledgerCategories.js'
import { flushStoredWrites } from '../src/composables/store/core.js'
import { APP_RELEASE, RELEASE_SEEN_KEY } from '../src/composables/releaseNotes.js'
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
 * 剥掉注释（JS 块注释 / 行注释 + 模板里的 HTML 注释），**保留字符串内容**。
 *
 * 本仓铁律：凡是要 parse 文本，先剥注释。本文件盯的就是弹窗调用，而那些调用**逐个都在
 * 字符串实参里**（`alert('生成失败，请重试')`），把字符串挖掉等于把要查的东西一起删了；
 * 反过来说，`PromptDialog.vue` 的文档注释里就写着 `window.prompt` 这个字面量（还有一处
 * `PromptDialog` 的调用点注释整句复刻了改造前的 `const name = window.prompt(...)`），
 * 不剥注释的话守卫会被自己的说明文字骗出假命中（这条差别有专门的夹具在验）。
 *
 * 【为什么不抄 tests/confirmDialogMigration.test.js 里那套带引号状态机的剥注释器】
 * 我抄了，实测在 `src/views/LedgerView.vue` 上**从 L483 起永久错位**：那一行是
 * `return /[",\n\r]/.test(text) ? …`——正则字面量里有一个 `"`，状态机把它当成字符串起点，
 * 于是此后整份文件都被当成"在字符串里"，**注释再也不被剥掉**。后果就是本文件里那句
 * 解释性注释被判成真命中（实测报出 `views/LedgerView.vue: window.prompt`，而代码里
 * 早就没有这个调用了）。这正是本仓反复踩的那类坑：解析器悄悄错位，判据从此跑在错误的
 * 地基上，而症状看起来像"代码有缺陷"。
 *
 * 所以这里改成**逐行**写法（先例：tests/modalSections.test.js 的 stripJsComments 与
 * 本仓"宁可漏报也不猜"的口径）：没有跨行状态，就不可能错位。
 *
 * 已知边界（如实标注，方向是"宁可误报"）：形如 `const url = 'http://x' // 注释` 的行，
 * 因为 `//` 之前出现过引号，无法在不引入状态机的前提下判断那个 `//` 是不是字符串的一部分，
 * 于是**整行原样保留**（含那截注释）。若这截行尾注释提到了弹窗调用会报假警——
 * 把它改写成整行注释即可；代码本身不会被漏掉，所以不会出现"缺陷在跑、守卫全绿"。
 */
function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // JS/CSS 块注释
    .replace(/<!--[\s\S]*?-->/g, ' ') // 模板 HTML 注释
    .split('\n')
    .map((line) => {
      const wholeLine = line.replace(/^[ \t]*\/\/.*$/, '')
      if (wholeLine !== line) return wholeLine // 整行行注释
      return stripTrailingComment(line)
    })
    .join('\n')
}

/** 行尾注释：只在 `//` 之前**没有任何引号字符**时才剥（否则无从判断它是不是字符串里的 `//`）。 */
function stripTrailingComment(line) {
  const at = line.indexOf('//')
  if (at === -1) return line
  const head = line.slice(0, at)
  if (/['"`]/.test(head)) return line
  return head
}

const rel = (file) => file.slice(srcDir.length + 1).replace(/\\/g, '/')

const SOURCES = walk(srcDir).map((file) => ({
  file: rel(file),
  code: stripComments(readFileSync(file, 'utf8')),
}))

const sourceOf = (path) => SOURCES.find((entry) => entry.file === path)?.code ?? ''

/** 判据一：`window.prompt(` / `window.alert(` / `window.confirm(` 一处都不许有。 */
const WINDOW_DIALOG = /window\s*\.\s*(prompt|alert|confirm)\s*\(/g

function windowDialogHits(sources) {
  const hits = []
  for (const { file, code } of sources) {
    for (const match of code.matchAll(WINDOW_DIALOG)) hits.push(`${file}: window.${match[1]}`)
  }
  return hits
}

/** `function confirm(` / `async function alert(` 这类**局部同名函数的定义**处。 */
const LOCAL_DEFINITION = /(?:^|[^\w$])(?:async\s+)?function\s+$/

const DIALOG_NAMES = ['prompt', 'alert', 'confirm']

/**
 * 逐个找出"裸 `prompt(` / `alert(` / `confirm(`"出现的位置（成员调用 `xxx.confirm(` 不算裸的），
 * 返回每处**前面 64 个字符**的上下文，用来区分"函数定义"与"函数调用"——这正是这条判据
 * 有牙齿的地方：`function confirm() {` 要放行，`if (!confirm('…'))` 要报错，
 * 而两者在纯字符串搜索里长得一模一样。
 */
function bareDialogSites(code) {
  const sites = []
  for (const name of DIALOG_NAMES) {
    let index = code.indexOf(name)
    while (index !== -1) {
      const before = code.slice(Math.max(0, index - 64), index)
      const after = code.slice(index + name.length)
      const isCall = /^\s*\(/.test(after)
      const isMember = /[.\w$]$/.test(before)
      if (isCall && !isMember) sites.push({ name, before })
      index = code.indexOf(name, index + 1)
    }
  }
  return sites
}

/** 判据二：裸 `prompt(` / `alert(` / `confirm(` 只允许是同名局部函数的**定义**。 */
function bareDialogIssues(sources) {
  const issues = []
  for (const { file, code } of sources) {
    for (const { name, before } of bareDialogSites(code)) {
      if (LOCAL_DEFINITION.test(before)) continue
      issues.push(`${file}: 裸 ${name}( 调用（只允许同名局部函数的定义）`)
    }
  }
  return issues
}

/** 定义了本地同名函数的文件（放行清单要**恰好**等于它，否则这条判据可能在放行一切）。 */
function filesWithLocalDefinition(sources) {
  return sources
    .filter(({ code }) => bareDialogSites(code).some(({ before }) => LOCAL_DEFINITION.test(before)))
    .map(({ file }) => file)
    .sort()
}

/**
 * 判据三：每个 `<PromptDialog>` 都必须写 `v-if`（+ `:open`）。
 *
 * 这不是洁癖：body 里每个 `.overlay` 的 z-index 都是 100，谁盖在谁上面完全由 DOM 顺序决定，
 * 而 Teleport 的锚点在组件挂载时创建。账本页的输入对话框是在**分类管理浮层已经打开之后**
 * 才从分类行里点开的，若锚点在页面挂载时就建好（不加 `v-if`），它会排在分类管理之前，
 * 于是**被分类管理整个盖住**——读屏与 Escape 却认为它在最上层（报告 §1.74）。
 */
const PROMPT_BLOCK = /<PromptDialog\b[\s\S]*?\/>/g

function promptOverlayIssues(sources) {
  const issues = []
  for (const { file, code } of sources) {
    for (const block of code.match(PROMPT_BLOCK) ?? []) {
      if (!/\bv-if=/.test(block)) issues.push(`${file}: <PromptDialog> 缺少 v-if（会被后开的浮层盖住）`)
      else if (!/:open=/.test(block)) issues.push(`${file}: <PromptDialog> 缺少 :open`)
    }
  }
  return issues
}

/**
 * 判据四：`<PromptDialog>` 的 `@confirm` / `@close` 绑定的名字必须真的在本文件里声明。
 *
 * 换掉原生 prompt 时，处理函数被拆成了"打开对话框"与"确认后执行"两个
 * （renameCategory → renameCategory + applyCategoryRename）。模板里若还留着旧名字，
 * Vue **编译不会报错**（`@confirm="oldName"` 编译成取一个不存在的属性），点下去只会静默
 * 什么也不做——这正是本次改造最容易留下的坑。
 */
function promptBindingIssues(sources) {
  const issues = []
  for (const { file, code } of sources) {
    for (const block of code.match(PROMPT_BLOCK) ?? []) {
      for (const [, attr, raw] of block.matchAll(/@(confirm|close)="([^"]+)"/g)) {
        const expr = raw.trim()
        const callName = /^([A-Za-z_$][\w$]*)$/.exec(expr)?.[1]
        const assignName = /^([A-Za-z_$][\w$]*)\s*=/.exec(expr)?.[1]
        // 内联箭头函数等写法不在本次改造里，跳过（留个出口而不是误报）
        if (!callName && !assignName) continue
        const name = callName ?? assignName
        const isDeclared = (binding) => {
          if (new RegExp(`(?:const|let|var)\\s+${binding}\\b`).test(code)) return true
          for (const [, properties] of code.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
            const names = properties.split(',').map((property) => {
              const parts = property.trim().replace(/^\.\.\./, '').split(':')
              const local = (parts.at(-1) ?? '').split('=')[0].trim()
              return /^[A-Za-z_$][\w$]*$/.test(local) ? local : ''
            })
            if (names.includes(binding)) return true
          }
          return false
        }
        const ok = isDeclared(name) || new RegExp(`(?:async\\s+)?function\\s+${name}\\b`).test(code)
        if (!ok) issues.push(`${file}: @${attr}="${expr}" 指向的 ${name} 在本文件里没有声明`)
      }
    }
  }
  return issues
}

const promptBlockCount = (sources) =>
  sources.reduce((sum, { code }) => sum + (code.match(PROMPT_BLOCK)?.length ?? 0), 0)

/** 本轮迁到应用内提示的两个文件（改造后都不该再出现任何原生弹窗）。 */
const MIGRATED = ['views/LedgerView.vue', 'views/WeeklyReviewView.vue']

/** 仓库允许保留的本地同名函数定义（与 tests/confirmDialogMigration.test.js 的清单一致）。 */
const ALLOWED_LOCAL_DEFINITIONS = ['components/TimeWheelSheet.vue', 'components/schedule/ImageCropModal.vue']

describe('静态层：原生弹窗已经全部退场', () => {
  it('扫描器自证：扫到的文件数与代码量都不是空的', () => {
    // 判据写坏（walk 失效、剥注释把整份源码吃掉）时这里会掉到 0，
    // 那种"假绿"比漏报更危险。
    expect(SOURCES.length, '没扫到任何 .vue/.js').toBeGreaterThanOrEqual(60)
    const totalCode = SOURCES.reduce((sum, { code }) => sum + code.length, 0)
    expect(totalCode, '剥注释后代码量太少，判据没有意义').toBeGreaterThan(200_000)
  })

  it('src/ 下不再有 window.prompt( / window.alert( / window.confirm(', () => {
    expect(windowDialogHits(SOURCES)).toEqual([])
  })

  it('裸 prompt( / alert( / confirm( 只出现在两个同名局部函数的定义处', () => {
    expect(bareDialogIssues(SOURCES)).toEqual([])
    // 正向锚定放行清单：这两个文件**确实**还定义着本地 confirm（不是靠"全仓都没有"过关）。
    expect(filesWithLocalDefinition(SOURCES)).toEqual([...ALLOWED_LOCAL_DEFINITIONS].sort())
  })

  it('判别力自证：该抓的抓得住、该放的放得过（不是恒真断言）', () => {
    // 改造前的写法（原样复刻账本 L1242），必须被抓出来
    const before = "function renameCategory(cat) {\n  const name = window.prompt('修改分类名称', cat.name)\n  if (name === null) return\n}"
    expect(windowDialogHits([{ file: 'Fixture.vue', code: before }]), '旧写法没被抓住').toEqual(['Fixture.vue: window.prompt'])
    // 对照：改造之后的同一段逻辑不该命中
    const after = 'function renameCategory(cat) {\n  renameTarget.value = cat\n}'
    expect(windowDialogHits([{ file: 'Fixture.vue', code: after }])).toEqual([])
    // 三种原生弹窗都要抓
    expect(windowDialogHits([{ file: 'Fixture.vue', code: "window.alert('x')" }])).toEqual(['Fixture.vue: window.alert'])
    expect(windowDialogHits([{ file: 'Fixture.vue', code: "window.confirm('x')" }])).toEqual(['Fixture.vue: window.confirm'])

    // 裸 alert：本周回顾页改造前的写法，必须被抓出来
    const bareAlert = "noteCommands.createNote({}).then(() => { alert('回顾笔记已生成，可在「笔记」页面查看') })"
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: bareAlert }]), '裸 alert( 没被抓住').toHaveLength(1)
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: "alert('生成失败，请重试')" }])).toHaveLength(1)
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: "prompt('改个名')" }])).toHaveLength(1)

    // 定义放行、别的裸调用照抓 —— 两者只差 `function ` 这几个字符
    const definitionAndCall = 'async function confirm() { done() }\nfunction other() { confirm() }'
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: definitionAndCall }])).toHaveLength(1)
    expect(filesWithLocalDefinition([{ file: 'Fixture.vue', code: definitionAndCall }])).toEqual(['Fixture.vue'])
    // 成员调用不是裸调用（window.* 那条判据单独管）
    expect(bareDialogSites('window.confirm(\'x\')')).toEqual([])
    expect(bareDialogSites('obj.alert(\'x\')')).toEqual([])

    // 注释里的字面量不算（本仓铁律：先剥注释）
    const commented = "// 这里以前是 window.prompt('修改分类名称', cat.name)\n// 也曾经 alert('生成失败，请重试')\nconst x = 1"
    expect(windowDialogHits([{ file: 'Fixture.vue', code: stripComments(commented) }])).toEqual([])
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: stripComments(commented) }])).toEqual([])
    // ……但同一份**未剥注释**的文本会命中：证明牙齿来自判据，"没命中"来自剥注释这一步
    expect(windowDialogHits([{ file: 'Fixture.vue', code: commented }])).toEqual(['Fixture.vue: window.prompt'])
    expect(bareDialogIssues([{ file: 'Fixture.vue', code: commented }])).toHaveLength(1)
  })

  it('判别力自证：<PromptDialog> 少了 v-if 必须报，写全了才放行', () => {
    const good = '<PromptDialog v-if="renameTarget" :open="Boolean(renameTarget)" @close="renameTarget = null" @confirm="applyCategoryRename" />\nconst renameTarget = ref(null)\nfunction applyCategoryRename() {}'
    expect(promptOverlayIssues([{ file: 'Fixture.vue', code: good }])).toEqual([])
    expect(promptBindingIssues([{ file: 'Fixture.vue', code: good }])).toEqual([])
    // 不加 v-if → 锚点先建，会被后开的浮层盖住
    const noVIf = '<PromptDialog :open="Boolean(renameTarget)" @close="renameTarget = null" />\nconst renameTarget = ref(null)'
    expect(promptOverlayIssues([{ file: 'Fixture.vue', code: noVIf }])).toHaveLength(1)
    // 拆函数时留下的旧名字 → 静默什么都不做
    const staleName = '<PromptDialog v-if="r" :open="Boolean(r)" @confirm="renameCategoryOld" />\nconst r = ref(null)\nfunction renameCategory() {}'
    expect(promptBindingIssues([{ file: 'Fixture.vue', code: staleName }])).toHaveLength(1)
  })

  it('迁移涉及的文件都已接入应用内提示（正向断言，避免整体变成"断言空集"）', () => {
    const unresolved = MIGRATED.filter((file) => !sourceOf(file))
    expect(unresolved, `清单里写错路径会退化成空循环：${unresolved.join('、')}`).toEqual([])
    expect(sourceOf('views/LedgerView.vue'), '账本页应已接入 PromptDialog').toContain('PromptDialog')
    expect(sourceOf('components/PromptDialog.vue'), 'PromptDialog 组件本身必须存在').toContain('defineProps')
    // 改名入口还在（不是靠把功能删掉来让棘轮变绿）
    expect(sourceOf('views/LedgerView.vue')).toMatch(/@click="renameCategory\(c\)">重命名/)
    expect(sourceOf('composables/ledgerView/useLedgerCategoryManager.js')).toMatch(/function applyCategoryRename\(/)
    // 本周回顾页的提示改成了页面内联提示，文案逐字保留
    expect(sourceOf('views/WeeklyReviewView.vue')).toMatch(/role="status"/)
    expect(sourceOf('views/WeeklyReviewView.vue')).toMatch(/reviewMessage\.value\s*=\s*'回顾笔记已生成，可在「笔记」页面查看'/)
  })

  it('全仓 <PromptDialog> 用法都写了 v-if，绑定也都指向真实存在的处理函数', () => {
    expect(promptBlockCount(SOURCES), '全仓没有 PromptDialog 用法，判据在守空气').toBeGreaterThanOrEqual(1)
    expect(promptOverlayIssues(SOURCES)).toEqual([])
    expect(promptBindingIssues(SOURCES)).toEqual([])
  })

  it('失败分支的文案是静态判据（happy-dom 里无法确定性触发，如实标注）', () => {
    // 该视图生成的内容永远非空，`createNote` 不会抛；要确定性触发失败分支只能去 stub 命令，
    // 那验的就是 stub 而不是代码了。所以这条只做静态对账：文案逐字保留、且走的是提示 ref。
    const code = sourceOf('views/WeeklyReviewView.vue')
    expect(code).toMatch(/reviewMessage\.value\s*=\s*'生成失败，请重试'/)
    expect(code, '失败分支不许再回到原生弹窗').not.toMatch(/\balert\s*\(/)
  })
})

/* ================= ② 行为层：PromptDialog 自身 ================= */

let dialogApp = null
let dialogHost = null
let events = []

/**
 * 直接挂载 `PromptDialog`（`open` 是个真 ref，能驱动"关闭 → 焦点还给触发者"那条路径）。
 * `Modal` 会 Teleport 到 body，所以断言一律从 document 里取，并取**最后一个**匹配节点。
 */
function mountPrompt(props = {}) {
  events = []
  dialogHost = document.createElement('div')
  document.body.appendChild(dialogHost)
  const open = ref(true)
  dialogApp = createApp({
    setup() {
      return () => h(PromptDialog, {
        ...props,
        open: open.value,
        onConfirm: (value) => events.push({ type: 'confirm', value }),
        onClose: () => events.push({ type: 'close' }),
      })
    },
  })
  dialogApp.mount(dialogHost)
  return { open }
}

function topOverlay() {
  const overlays = [...document.querySelectorAll('.overlay')]
  return overlays[overlays.length - 1] ?? null
}

const dialogInput = () => topOverlay()?.querySelector('.prompt-input') ?? null
const footButtons = () => [...(topOverlay()?.querySelectorAll('.modal-foot button') ?? [])]
const confirmEvents = () => events.filter((event) => event.type === 'confirm')

function typeInto(node, value) {
  node.value = value
  node.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Vue 的事件 invoker 有一条去重守卫（`e._vts <= 挂载时刻` 就跳过），在元素刚挂载的同一
 * 毫秒内点击会被跳过——既有测试（formValidationA11y / ledgerFeaturesDom）也是等 8ms 再点。
 */
async function click(node) {
  expect(node, '要点击的元素不存在').toBeTruthy()
  await new Promise((resolveTick) => setTimeout(resolveTick, 8))
  node.click()
  await settle()
}

describe('PromptDialog：确认回传 trim 后的值，取消与 Escape 只关不写', () => {
  it('打开时预填初值、焦点落在输入框、页面锁生效，确认回传 trim 后的值', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '餐饮' })
    await settle()
    const input = dialogInput()
    expect(input, '对话框应当真的渲染出来（原生 prompt 在 happy-dom 里根本不存在）').toBeTruthy()
    expect(input.value, '输入框要预填当前值').toBe('餐饮')
    expect(document.activeElement, '打开时焦点必须落在输入框上').toBe(input)
    expect(document.body.dataset.modalOpen, '浮层打开时页面锁必须生效').toBe('true')

    typeInto(input, '  常吃  ')
    await settle()
    const buttons = footButtons()
    expect(buttons.map((button) => button.textContent.trim()), '默认按钮文案与原生 prompt 一致').toEqual(['取消', '确定'])
    expect(buttons[1].className).toContain('btn-primary')
    expect(buttons[1].className).not.toContain('btn-danger')

    await click(buttons[1])
    expect(confirmEvents(), '确认必须回传 trim 后的值').toEqual([{ type: 'confirm', value: '常吃' }])
  })

  it('空输入确认：不发 confirm（空值 = 无变化）——反向对照，证明上一条不是恒真', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '' })
    await settle()
    const input = dialogInput()
    expect(input.value).toBe('')
    // 先证明探针看得见东西：改一个字就会回传
    typeInto(input, 'x')
    await settle()
    await click(footButtons()[1])
    expect(confirmEvents(), '非空输入确实会回传（探针没瞎）').toEqual([{ type: 'confirm', value: 'x' }])
  })

  it('空输入：只 close，绝不 confirm；纯空白同样算空', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '餐饮' })
    await settle()
    typeInto(dialogInput(), '   ')
    await settle()
    await click(footButtons()[1])
    expect(confirmEvents(), '纯空白不许回传任何值').toEqual([])
    expect(events, '只该关掉对话框').toEqual([{ type: 'close' }])
  })

  it('取消：只 close，不发 confirm', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '餐饮' })
    await settle()
    typeInto(dialogInput(), '不该生效')
    await settle()
    await click(footButtons()[0])
    expect(confirmEvents(), '取消不该产生任何确认事件').toEqual([])
    expect(events).toEqual([{ type: 'close' }])
  })

  it('Escape：只 close，不发 confirm', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '餐饮' })
    await settle()
    const input = dialogInput()
    typeInto(input, '不该生效')
    await settle()
    // 派发到输入框上并冒泡到 document（Modal 的 Escape 监听挂在那里）
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(confirmEvents(), 'Escape 取消不该产生确认事件').toEqual([])
    expect(events).toEqual([{ type: 'close' }])
  })

  it('输入框有程序化可访问名称：有 label 走 <label for>，没有就退回 aria-label', async () => {
    mountPrompt({ title: '修改分类名称', label: '分类名称' })
    await settle()
    const input = dialogInput()
    expect(input.id, '输入框要有 id 才能被 label 关联').toBeTruthy()
    const label = topOverlay().querySelector(`label[for="${input.id}"]`)
    expect(label, '<label for> 必须与输入框程序化关联').toBeTruthy()
    expect(label.textContent.trim()).toBe('分类名称')
    expect(input.hasAttribute('aria-label'), '有可见标签时不再重复 aria-label').toBe(false)
  })

  it('不传 label 时用标题当 aria-label（两种调用方式都有名称）', async () => {
    mountPrompt({ title: '修改分类名称' })
    await settle()
    const input = dialogInput()
    expect(input.getAttribute('aria-label')).toBe('修改分类名称')
    expect(topOverlay().querySelector(`label[for="${input.id}"]`), '没有 label 就不该有 label 元素').toBeNull()
  })

  it('关闭后浮层消失、页面锁解除，焦点还给触发它的元素', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '重命名'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { open } = mountPrompt({ title: '修改分类名称', label: '分类名称', initialValue: '餐饮' })
    await settle()
    expect(document.activeElement, '打开后焦点应当已经移到输入框').toBe(dialogInput())

    open.value = false
    await settle()
    expect(topOverlay(), '关闭后浮层应当从 DOM 里消失').toBeNull()
    expect(document.activeElement, '关闭后焦点必须还给触发它的元素').toBe(trigger)
    expect(document.body.dataset.modalLockCount, '最后一层关闭后滚动锁要解除').toBeUndefined()
  })
})

/* ================= ③ 行为层：真实路由下的账本页 ================= */

let mounted = null

const resetCategories = () => {
  ledgerCategories.value = DEFAULT_CATEGORIES.map((category) => ({ ...category }))
}

beforeEach(() => {
  localStorage.clear()
  // 全新 profile 会自动弹出「✨ 已更新」更新说明（正确行为，不是噪声）。本文件测的是
  // 输入对话框与提示文案，"取消后 body 里还剩不剩浮层"不该被那个异步分块污染。
  localStorage.setItem(RELEASE_SEEN_KEY, APP_RELEASE)
  resetCategories()
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  dialogApp?.unmount()
  dialogApp = null
  dialogHost = null
  resetCategories()
  document.body.innerHTML = ''
  // 滚动锁写在 body.dataset 上，用例之间必须清干净（否则后一个用例会继承前一个的锁状态）
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

const readStored = (key) => JSON.parse(localStorage.getItem(key) ?? 'null')

/** 把待写入的数据真正落盘（store 的写入是 300ms 防抖的）。 */
const flushWrites = () => flushStoredWrites()

function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

/** 只按选择器找浮层，并且要求那个浮层里**确实**装着目标元素（避免抓错层）。 */
function overlayOf(selector) {
  return [...document.querySelectorAll('.overlay')].find((overlay) => overlay.querySelector(selector)) ?? null
}

const catManager = () => overlayOf('.cat-manage')
const promptOverlay = () => overlayOf('.prompt-input')

const overlayIndexOf = (selector) =>
  [...document.querySelectorAll('.overlay')].findIndex((overlay) => overlay.querySelector(selector))

async function bootLedger() {
  mounted = await mountApp({ routes })
  // 账本页挂在 /bills（/ledger 是账本页内部的「分区」概念，不是路由）
  return gotoRoute(mounted, '/bills')
}

async function openCategoryManager(main) {
  await click(buttonByText(main, '分类管理'))
  expect(catManager(), '分类管理浮层应当打开').toBeTruthy()
  await click(buttonByText(catManager(), '全部分类'))
}

/** 点某个分类行里的「重命名」，返回那个按钮（焦点还原要按它断言）。 */
async function openRename(catName) {
  const row = [...catManager().querySelectorAll('.cat-row')].find((item) => item.textContent.includes(catName))
  expect(row, `没找到分类行：${catName}`).toBeTruthy()
  const trigger = [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === '重命名')
  expect(trigger, '分类行里应当有「重命名」按钮').toBeTruthy()
  // 真实浏览器里点击按钮就会聚焦它；happy-dom 的 click() 不保证，所以显式对齐前提。
  trigger.focus()
  await click(trigger)
  return trigger
}

const categoryNameOf = (key) => ledgerCategories.value.find((category) => category.key === key)?.name
const storedCategoryNameOf = (key) =>
  readStored('sl_ledger_categories')?.find((category) => category.key === key)?.name

describe('账本页「修改分类名称」：真对话框取代原生 prompt', () => {
  it('确认改名：列表、落盘与稳定 ID 都对，焦点还给触发键', async () => {
    const main = await bootLedger()
    await openCategoryManager(main)
    const trigger = await openRename('餐饮')

    const input = promptOverlay()?.querySelector('.prompt-input')
    expect(input, '点「重命名」应当打开应用内输入对话框（原生 prompt 已不存在）').toBeTruthy()
    expect(input.value, '输入框预填当前分类名').toBe('餐饮')
    expect(document.activeElement, '打开时焦点落在输入框').toBe(input)
    const label = promptOverlay().querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent.trim(), '输入框要有可访问名称').toBe('分类名称')

    // §1.74：对话框在分类管理**之后**打开，锚点也必须在它之后，否则会被它整个盖住
    const managerIndex = overlayIndexOf('.cat-manage')
    const promptIndex = overlayIndexOf('.prompt-input')
    expect(managerIndex, '分类管理浮层应当存在').toBeGreaterThanOrEqual(0)
    expect(promptIndex, '输入对话框必须排在分类管理之后，否则会被它盖住').toBeGreaterThan(managerIndex)

    typeInto(input, '  常吃  ')
    await settle()
    await click(buttonByText(promptOverlay(), '确定'))

    expect(promptOverlay(), '确认后对话框应当关闭').toBeNull()
    expect(catManager(), '分类管理要留着').toBeTruthy()
    expect(catManager().textContent, '列表里应当已经是 trim 后的新名字').toContain('常吃')
    expect(catManager().textContent, '旧名字不该还在').not.toContain('餐饮')
    expect(document.activeElement, '焦点要还给触发它的「重命名」按钮').toBe(trigger)

    await flushWrites()
    expect(storedCategoryNameOf('food'), '改名必须真的落盘').toBe('常吃')
    expect(categoryNameOf('food'), '分类 ID 不变，历史记录仍关联同一条').toBe('常吃')
  })

  it('取消：分类名与存储都没动', async () => {
    const main = await bootLedger()
    await openCategoryManager(main)
    await openRename('餐饮')
    const input = promptOverlay().querySelector('.prompt-input')
    typeInto(input, '不该生效')
    await settle()
    await click(buttonByText(promptOverlay(), '取消'))

    expect(promptOverlay(), '取消后对话框应当关闭').toBeNull()
    expect(catManager().textContent).toContain('餐饮')
    expect(catManager().textContent).not.toContain('不该生效')
    expect(categoryNameOf('food'), '取消不该改内存里的分类名').toBe('餐饮')
    // 存储侧同样对账：这里不断言"一定有一条记录"，因为本次没有任何真实变更时
    // 存储层不会为一次同值写入排队；判据是"写了的话也绝不能是那个新名字"。
    await flushWrites()
    expect(localStorage.getItem('sl_ledger_categories') ?? '', '取消不该把新名字写进存储').not.toContain('不该生效')
  })

  it('Escape：只关掉输入对话框，分类管理与数据都不动', async () => {
    const main = await bootLedger()
    await openCategoryManager(main)
    await openRename('餐饮')
    const input = promptOverlay().querySelector('.prompt-input')
    typeInto(input, '不该生效')
    await settle()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()

    expect(promptOverlay(), 'Escape 应当关掉最上层的输入对话框').toBeNull()
    expect(catManager(), '底下的分类管理不能被一起关掉').toBeTruthy()
    expect(document.body.dataset.modalOpen, '底层浮层还开着，页面锁不能提前解除').toBe('true')
    expect(catManager().textContent).toContain('餐饮')
    expect(categoryNameOf('food'), 'Escape 取消不该改内存里的分类名').toBe('餐饮')
    await flushWrites()
    expect(localStorage.getItem('sl_ledger_categories') ?? '', 'Escape 取消不该写入任何数据').not.toContain('不该生效')
  })
})

/* ================= ④ 行为层：真实路由下的本周回顾页 ================= */

describe('本周回顾页：原生 alert 换成页面内联提示', () => {
  const notice = (main) => main.querySelector('.notice-success')

  it('点「一键生成回顾笔记」后提示真的渲染出来，且笔记真的建出来了', async () => {
    mounted = await mountApp({ routes })
    const main = await gotoRoute(mounted, '/review')
    // 反向对照先跑：还没点按钮时，同一探针必须什么都看不到
    expect(notice(main), '没点按钮时不该有任何提示').toBeNull()

    await click(buttonByText(main, '一键生成回顾笔记'))
    const message = notice(main)
    expect(message, '提示必须渲染在页面里（原来是原生 alert，happy-dom 下根本没法验）').toBeTruthy()
    expect(message.getAttribute('role'), '提示要能被读屏播报').toBe('status')
    expect(message.textContent, '文案与改造前逐字一致').toContain('回顾笔记已生成，可在「笔记」页面查看')

    await flushWrites()
    const notes = readStored('sl_quick_notes')
    expect(notes.length, '提示出现时笔记必须真的建出来了').toBeGreaterThan(0)
    expect(notes[0].title).toContain('本周回顾')
  })
})
