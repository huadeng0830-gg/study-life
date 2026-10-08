// @vitest-environment happy-dom
/**
 * 外壳级告警条的**排队**守卫：五条提示不许再抢同一个 fixed 槽位。
 *
 * 【病灶（P1）】`App.vue` 里五条外壳级提示原来各自 `position:fixed` 且共用同一个
 * `top: calc(12px + safe-area)` / `left:50%` / `translate(-50%)`。同步告警是 z-index 240，
 * 安全模式 / 本机保存 / 备份提醒是 241，而 241 那条更宽更高，于是两者同时出现时
 * **241 会把 240 整条盖住**——同步告警上的「重试同步」「打开数据管理」用户根本点不到。
 * 离线（`accountSyncNotice`）且久未备份（`showBackupNudge`）是一条完全现实的共现路径。
 * 另外 `.global-alert-reserve` 只有固定高度（54/72/124px），不随条数增长。
 *
 * 【判据的边界，写清楚免得后人当成本文件证明了更多】
 * happy-dom **没有布局**：`getBoundingClientRect()` 对任何元素都返回 0，也根本不注入组件
 * CSS。所以"两条真的没有画在一起"在本环境里**证不了**，只能靠真实浏览器 / 真机截图。
 * 本文件证明的是**排队机制本身**（都是可测的确定性事实）：
 *   1. 两条同时存在时都在 DOM 里，而且是**同一个队列容器**的孩子（不再各占一个自己的 fixed 槽位）；
 *   2. 两条各自绑定的槽位序号互不相同、且按 DOM 顺序严格递增——「所有条同偏移」的写法在这里必红；
 *   3. 为它们预留的高度绑定的是**当前可见条数**（`--alert-count`），一条消失后队列收紧、条数回落；
 *   4. 容器带 App.vue 自己的 `data-v-*`（scoped 规则真的能落到它上面，否则修复在浏览器里静默失效）；
 *   5. 源码层：容器是唯一的定位者（fixed + 纵向 flex + gap），子条是 relative + 自己的 z-index。
 *
 * 【为什么渲染级只驱动「同步告警 + 保存失败」而不是「同步告警 + 备份提醒」】
 * 备份提醒由 `App.vue` 挂载期的 6s 定时器 + localStorage 驱动，仓库已明确不伪造这段时序
 * （见 `tests/appShellAnnouncements.test.js` 开头）。备份提醒与"本机保存失败"是**同一条
 * CSS 规则、同一个槽位**（`.global-persistence-alert`，由本文件最后一条源码判据钉住），
 * 所以用后者测几何是等价的；`showBackupNudge` 的那条另有源码判据。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { accountSyncStatus } from '../src/composables/accountSyncState.js'
import { localSafeMode } from '../src/composables/localSafeMode.js'
import { persistenceState } from '../src/composables/store/core.js'
import { mountApp, settle } from './helpers/mountApp.js'

/* ---------------------------------------------------------------- 渲染夹具 */

let mounted = null
let saved = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  if (saved) {
    persistenceState.value = saved.persistence
    localSafeMode.value = saved.safeMode
    accountSyncStatus.value = saved.syncState
  }
  saved = null
})

/** 挂载外壳。 */
async function mountShell() {
  saved = {
    persistence: persistenceState.value,
    safeMode: localSafeMode.value,
    syncState: accountSyncStatus.value,
  }
  mounted = await mountApp()
}

/**
 * 把外壳推到「同步告警 + 保存/备份条同时在」的状态。
 *
 * 【为什么每轮都重写状态、而不是设一次就断言】这两条提示挂在**外壳全局**的 ref 上，
 * 而外壳挂载后还有一段异步接线（账号鉴权 → 同步生命周期）会写它们，可能落在"设状态"之后。
 * 判据盯的是**排队**，不该被接线时序决定，所以每轮都把自己的值写成最后一次写；
 * 轮完还没有就带着现场信息报错，别退化成超时。
 * 【为什么要区分"在显示"与"在离场"】Vue 的 Transition 离场要 2×rAF 才把元素摘掉，
 * 这期间它还在 DOM 里、还带 old 位次。只看 `querySelector` 会读到上一拍的状态
 * （本地实测：五个文件并行时这里会假绿成"两条都在"，而实际只有一条在显示）。
 */
async function showBothAlerts() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    accountSyncStatus.value = 'offline'
    persistenceState.value = { ...persistenceState.value, status: 'error', message: '配额已满' }
    await settle()
    if (
      accountSyncStatus.value === 'offline'
      && visibleAlert('.global-sync-alert')
      && visibleAlert('.global-persistence-alert')
    ) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(
    '外壳没能同时显示两条告警，夹具前提不成立：'
    + `accountSyncStatus=${accountSyncStatus.value} / persistence=${persistenceState.value.status} / `
    + `队列=[${[...document.querySelectorAll('.global-alert-stack > *')].map((el) => el.className).join(' | ')}]`,
  )
}

/** 撤掉同步告警；离场动画走完（元素离开 DOM）才算数。 */
async function hideSyncAlert() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    accountSyncStatus.value = 'signed-out'
    await settle()
    if (!document.querySelector('.global-sync-alert')) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`同步告警没能离场：accountSyncStatus=${accountSyncStatus.value}`)
}

/**
 * 元素的某个内联自定义属性。
 * happy-dom 对 `style.setProperty` 与 `style` 属性文本的解析路径不完全一致，
 * 两种读法都试一遍——判据要盯的是"Vue 到底写没写上去"，不是某一条 API 的实现细节。
 */
function cssVarOf(element, name) {
  const direct = element?.style?.getPropertyValue?.(name)
  if (direct) return String(direct).trim()
  const match = new RegExp(`${name}\\s*:\\s*([^;"']+)`).exec(element?.getAttribute('style') ?? '')
  return match ? match[1].trim() : ''
}

/** 槽位序号（-1 = 未绑定；本文件里出现 -1 就说明这条提示没进队列）。 */
const slotOf = (element) => Number(cssVarOf(element, '--alert-slot'))

/**
 * 队列容器里**真正占着位次**的那几条。
 * 离场中的条在 DOM 里还会留两帧（Vue 的 Transition 要 2×rAF 收尾），但它已经不占槽位了，
 * 拿它当"还在的告警"会让判据读到上一拍的状态——本文件的夹具就踩过这个坑。
 */
const queuedAlerts = () => [...(document.querySelector('.global-alert-stack')?.children ?? [])]
  .filter((element) => !element.className.includes('global-sync-leave-'))

/** 正在显示（不在离场）的告警；没显示或正在离场都返回 null。 */
function visibleAlert(selector) {
  const element = document.querySelector(selector)
  if (!element || element.className.includes('global-sync-leave-')) return null
  return element
}

/* ---------------------------------------------------------------- 渲染级 */

describe('渲染级：两条告警共用一条队列，不再抢同一个 fixed 槽位', () => {
  it('两条都在 DOM 里、同属一个容器、槽位序号互不相同且按 DOM 顺序递增', async () => {
    await mountShell()
    await showBothAlerts()

    const stack = document.querySelector('.global-alert-stack')
    const sync = visibleAlert('.global-sync-alert')
    const persistence = visibleAlert('.global-persistence-alert')

    expect(sync, '同步告警应当渲染出来').not.toBeNull()
    expect(persistence, '保存/备份条应当渲染出来').not.toBeNull()
    expect(stack, '五条提示应当收在同一个队列容器里').not.toBeNull()

    // 关键判据：两条的**父节点是同一个队列容器**。原来它们各自 fixed 在同一个 top/left 上、
    // 没有任何共同祖先，"谁盖住谁"完全交给 z-index —— 这正是本次 P1 的成因。
    expect(sync.parentElement, '同步告警必须在队列容器里，而不是自己 fixed 在视口上').toBe(stack)
    expect(persistence.parentElement, '保存/备份条必须在同一个队列容器里').toBe(stack)

    // 判据：同一队列里的两条绑定的槽位序号必须**互不相同**，且按 DOM 顺序严格递增。
    // 只断言"不相等"是不够的（各绑一个乱序的号也能不相等），所以直接钉住位次本身：
    // 队列里第 0 个孩子是 0 号位、第 1 个是 1 号位。「所有条同偏移」的退法在这里必然变红。
    const queued = queuedAlerts()
    expect(queued, '此刻队列里应当正好有这两条').toHaveLength(2)
    expect(
      queued.map(slotOf),
      '两条的槽位序号必须按队列顺序从 0 递增（退回"所有条同偏移"就是这里变红）',
    ).toEqual([0, 1])
    expect(new Set(queued.map(slotOf)).size, '两条不许绑同一个位次').toBe(queued.length)
  })

  it('预留高度绑定的是当前可见条数：两条=2，撤掉一条后队列收紧、条数回落', async () => {
    await mountShell()
    await showBothAlerts()

    const reserve = () => document.querySelector('.global-alert-reserve')
    expect(reserve(), '有告警时应当有预留占位（否则告警会压住正文首屏）').not.toBeNull()
    expect(cssVarOf(reserve(), '--alert-count'), '预留高度必须知道"现在有几条"').toBe('2')

    // 撤掉同步告警：队列要重新收紧（留下的那条回到 0 号位），条数跟着回落。
    // 固定高度 + 固定偏移的老写法在这里会留下一个空洞或一条永久错位的提示。
    await hideSyncAlert()

    const remaining = queuedAlerts()
    expect(remaining, '应当只剩保存/备份那一条').toHaveLength(1)
    expect(slotOf(remaining[0]), '队列要收紧位次，不能留空洞').toBe(0)
    expect(cssVarOf(reserve(), '--alert-count'), '条数回落，预留高度也要跟着回落').toBe('1')
  })

  it('队列容器带的是 App.vue 自己的 scope 属性（scoped 规则真的落得到它上面）', async () => {
    await mountShell()

    const scopeAttrsOf = (element) => [...element.attributes]
      .map((attr) => attr.name)
      .filter((name) => name.startsWith('data-v-'))

    const layout = document.querySelector('.layout')
    const stack = document.querySelector('.global-alert-stack')
    expect(scopeAttrsOf(layout), 'App.vue 模板里的节点应当带自己的 scope 属性').not.toHaveLength(0)
    // 【为什么这条要单独守】happy-dom 不处理 CSS：容器是不是 App.vue 模板里的**真实节点**
    // （而不是某个子组件 tag 渲染出来的、拿不到父 scope 的元素）决定了 scoped 规则能不能命中。
    // 命中不了的话整套排队样式会**静默**失效，而上面那些断言照样全绿。
    for (const attr of scopeAttrsOf(layout)) {
      expect(stack.hasAttribute(attr), `队列容器缺少 ${attr}：scoped 样式会静默失效`).toBe(true)
    }
  })
})

/* ---------------------------------------------------------------- 源码级 */

/** 剥 CSS 注释——本仓铁律：注释里的声明不是真声明。 */
const stripCssComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** App.vue 的 `<style>` 块（已剥注释）。 */
function styleOfApp() {
  const raw = readFileSync(resolve(import.meta.dirname, '..', 'src', 'App.vue'), 'utf8')
  const open = raw.indexOf('>', raw.indexOf('<style'))
  return stripCssComments(raw.slice(open + 1, raw.lastIndexOf('</style>')))
}

/** 叶子规则 `选择器 { 声明 }`。 */
function leafRules(css) {
  const out = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].replace(/\s+/g, ' ').trim()
    if (!selector || selector.includes('@') || selector.includes(';')) continue
    out.push({ selector, body: match[2] })
  }
  return out
}

const APP_SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'src', 'App.vue'), 'utf8')
const APP_CSS = styleOfApp()
const ruleBody = (selector) => leafRules(APP_CSS)
  .filter((rule) => rule.selector.split(',').some((one) => one.trim() === selector))
  .map((rule) => rule.body)
  .join(' ')

describe('源码级：没有 CSS 参与，只能在这里红的三条不变量', () => {
  it('容器是唯一的定位者（fixed + 纵向 flex + gap），子条不再自己 fixed/写 top', () => {
    const stack = ruleBody('.global-alert-stack')
    expect(stack, '找不到 .global-alert-stack 规则').not.toBe('')
    expect(stack, '队列必须自己固定在视口顶部（安全区照旧）').toContain('position:fixed')
    expect(stack, '必须是纵向队列，否则两条会并排而不是上下排').toContain('flex-direction:column')
    expect(stack, '条与条之间要有间距').toMatch(/gap:\s*8px/)
    expect(stack, '队列整体仍在告警那一档（不新增 z-index 取值）').toMatch(/z-index:\s*240/)

    // 子条：relative + 自己那条真实的 z-index；**不许**再有 position:fixed / top。
    // 「退回所有条同一个 fixed 偏移」这类改法会立刻在这两条上变红。
    for (const [selector, z] of [['.global-sync-alert', '240'], ['.global-safe-mode-alert', '241'], ['.global-persistence-alert', '241']]) {
      const body = ruleBody(selector)
      expect(body, `找不到 ${selector} 的样式`).not.toBe('')
      expect(body, `${selector} 改成 relative，z-index 才是真实参与比较的声明`).toContain('position:relative')
      expect(body, `${selector} 不许再自己 fixed 在视口上`).not.toContain('position:fixed')
      expect(body, `${selector} 不许再自己写 top（定位归容器）`).not.toMatch(/(^|;)\s*top\s*:/)
      expect(body, `${selector} 的层级数值不许漂移（240/241 是一段承重的阶梯）`).toMatch(new RegExp(`z-index:\\s*${z}(?!\\d)`))
    }

    // 槽位序号要真的参与定序，而不是"绑上去没人用"的死声明。
    expect(ruleBody('.global-alert-stack > *'), '槽位序号必须由 order 消费').toMatch(/order:\s*var\(--alert-slot/)
  })

  it('预留高度按可见条数算，且与队列的间距是同一个数', () => {
    const reserve = ruleBody('.global-alert-reserve')
    expect(reserve, '找不到 .global-alert-reserve 规则').not.toBe('')
    expect(reserve, '预留高度必须乘上条数（写死 54px 就是原来的病灶）').toMatch(/height:\s*calc\([^;]*var\(--alert-count\)/)
    expect(reserve, '条数由 JS 从模板传入，样式侧要有兜底').toMatch(/--alert-count:\s*1/)

    // 队列的 gap 与预留高度里那个间距必须是同一个数，否则高度会与真实排布漂移。
    const gap = Number(/gap:\s*(\d+)px/.exec(ruleBody('.global-alert-stack'))?.[1])
    const lane = Number(/--alert-lane:\s*(\d+)px/.exec(reserve)?.[1])
    expect(gap, '解析不到队列 gap').toBe(8)
    expect(lane, '解析不到每条的基础高度（≤900px 起由媒体查询覆盖）').toBe(54)
    expect(
      reserve,
      `预留高度里的间距（${gap}px）必须与队列 gap 一致`,
    ).toMatch(new RegExp(`\\+\\s*${gap}px\\s*\\*`))

    // 三个断点各自的基础高度都还在（≤900 用 72、≤760 用 124，与告警自身的高度同源）
    for (const px of [72, 124]) {
      expect(APP_CSS, `缺少 --alert-lane:${px}px 的断点覆盖`).toMatch(new RegExp(`--alert-lane:\\s*${px}px`))
    }
  })

  it('备份提醒与保存失败是同一条规则、同一个槽位（渲染级用它代替备份提醒的依据）', () => {
    // 备份提醒由挂载期的 6s 定时器驱动，测试里不伪造这段时序；它与"保存失败"共用
    // `.global-persistence-alert` 这条规则与队列里的同一个位次，所以几何是同一件事。
    const lineOf = (needle) => APP_SOURCE.split(/\r?\n/).find((line) => line.includes(needle)) ?? ''
    const backup = lineOf('v-if="showBackupNudge"')
    const failure = lineOf('v-if="persistenceState.status === \'error\'"')
    expect(backup, '模板里找不到备份提醒那条').not.toBe('')
    expect(failure, '模板里找不到保存失败那条').not.toBe('')
    for (const [label, line] of [['备份提醒', backup], ['保存失败', failure]]) {
      expect(line, `${label}必须落在 .global-persistence-alert 这条规则上`).toContain('class="global-persistence-alert')
      expect(line, `${label}必须绑定自己的槽位序号（否则队列里没有它的位次）`).toContain("'--alert-slot'")
    }
  })
})
