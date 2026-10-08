// @vitest-environment happy-dom
/**
 * 外壳级提示的播报必须走常驻通道，且**文案与播报同源**（第二十四轮）。
 *
 * 【背景】上一轮（§1.34）修掉了全局错误提示，但 `App.vue` 里还有五处同样形状的提示：
 * 安全模式、持久化失败、持久化恢复、账号同步状态、7 天未备份——全都是
 * `v-if` 插入的新节点 + 行内 `role="alert"/"role="status"`，
 * 撞的正是 `liveRegion.js` 开头记的那条规律（VoiceOver 可能一个字都不播）。
 * 本轮把六处（含快速记录成功 toast）统一改由外壳里**常驻**的播报区发声：
 * 错误走 assertive、提醒与成功走 polite；行内 role 全部去掉，
 * 顺带避免「播报区 + 提示条」把同一句话念两遍。
 *
 * 【为什么必须挂载整个外壳】这几处提示由外壳自己的状态驱动（`localSafeMode`、
 * `persistenceState`、`accountSyncStatus`…），不挂载就没法把它们推到"该提示"的状态。
 * 为此本轮新增了 `tests/helpers/mountApp.js`——它同时解开了
 * §4 里"渲染 DOM 级标题顺序守卫""真实 Tab 顺序守卫"缺的那件基础设施。
 *
 * 【刻意不做的部分】"7 天未备份"与自动同步状态这两处在挂载期由计时器/协调器驱动，
 * 测试里不去伪造它们的时序；它们的**标记与文案**由下面的守卫覆盖（无行内 role、
 * 文案取自常量），行为则由 `needsBackup`/`accountSyncStatus` 各自已有的测试覆盖。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { accountSyncError, accountSyncStatus } from '../src/composables/accountSyncState.js'
import { clearAnnouncement, liveAlert, liveMessage } from '../src/composables/liveRegion.js'
import { localSafeMode } from '../src/composables/localSafeMode.js'
import { persistenceState } from '../src/composables/store/core.js'
import { setMirrorErrorHandler } from '../src/composables/dataVault.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { templateOf, walkElements } from './helpers/vueTemplate.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
import { mountApp, settle } from './helpers/mountApp.js'

// This suite verifies the shell's announcement routing, not IndexedDB behavior.
// happy-dom has no IndexedDB; an unrelated delayed mirror retry could otherwise
// inject an assertive storage error while a test is checking the polite channel.
setMirrorErrorHandler(() => {})
registerMirrorTeardown()

/** 播报写入是「先清空、下一拍（30ms）再写」，所以等一小会儿让内容落下。 */
const TICK_MS = 40
const tick = () => new Promise((resolveTick) => setTimeout(resolveTick, TICK_MS))

let mounted = null
let savedPersistence = null
let savedSafeMode = null
let savedSyncState = null
let savedSyncError = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
  if (savedPersistence) persistenceState.value = savedPersistence
  if (savedSafeMode !== null) localSafeMode.value = savedSafeMode
  if (savedSyncState !== null) accountSyncStatus.value = savedSyncState
  if (savedSyncError !== null) accountSyncError.value = savedSyncError
  savedPersistence = null
  savedSafeMode = null
  savedSyncState = null
  savedSyncError = null
})

async function mountShell() {
  savedPersistence = persistenceState.value
  savedSafeMode = localSafeMode.value
  savedSyncState = accountSyncStatus.value
  savedSyncError = accountSyncError.value
  mounted = await mountApp()
}

describe('外壳级提示的播报', () => {
  it('进入本机安全模式时以 assertive 播报（错误级别）', async () => {
    await mountShell()
    localSafeMode.value = true
    // 【为什么这里只等一次微任务、不等 settle()】「先清空、下一拍（30ms）再写入」
    // 里那个"下一拍"是**墙钟时间**，而 settle() 等的是两个 rAF —— 机器一忙（204 个
    // 用例文件并行时就是这样）单帧就可能超过 30ms，于是写入已经落下、
    // `toBe('')` 偶发变红。判据要盯的是"清空是同步发生的"，那就不能把它挂在
    // 一个可能超过 30ms 的等待后面：watcher 是 pre-flush，nextTick() 之后
    // 清空一定已经发生，而定时器不可能在微任务里跑掉。
    await nextTick()
    expect(liveAlert.value, '播报区应当先被同步清空').toBe('')
    await tick()
    expect(liveAlert.value).toContain('本机安全模式')
    expect(liveAlert.value).toContain('账号同步已暂停')
    expect(liveAlert.value).toContain('导出备份和恢复')
    // 提示条本身不再自己声明实时区域（否则同一句会被念两遍）
    expect(document.querySelector('.global-safe-mode-alert')?.getAttribute('role')).toBeNull()
  })

  it('本机保存失败时以 assertive 播报，并且带上动态的错误信息', async () => {
    await mountShell()
    persistenceState.value = { ...persistenceState.value, status: 'error', message: '配额已满' }
    await settle()
    await tick()

    expect(liveAlert.value).toBe('本机保存需要注意：配额已满')
    expect(document.querySelector('.global-persistence-alert')?.getAttribute('role')).toBeNull()
  })

  it('本机保存恢复时以 polite 播报（成功提示不该打断用户）', async () => {
    await mountShell()
    persistenceState.value = { ...persistenceState.value, status: 'recovered' }
    await settle()
    await tick()

    expect(liveMessage.value).toContain('本机保存已恢复')
    // 成功提示**不能**用紧急通道，否则等于把好消息当警报喊
    expect(liveAlert.value).toBe('')
  })

  it('账号同步状态变化时按文本播报，内容相同的重算不会重复播报', async () => {
    await mountShell()
    accountSyncStatus.value = 'conflict'
    await settle()
    await tick()
    expect(liveMessage.value).toContain('选择冲突记录保留的版本')

    // 触发一次重算但文案不变（离线文案依赖 isSyncSpaceBound，这里改一个无关状态）
    clearAnnouncement()
    persistenceState.value = { ...persistenceState.value }
    await settle()
    await tick()
    expect(liveMessage.value, '内容没变的重复播报').toBe('')
  })
})

/* ---------------- 守卫：外壳模板里不许有条件渲染的实时区域 ---------------- */

const LIVE = /(?:^|\s):?role="(?:alert|status)"|(?:^|\s):?aria-live=/
const CONDITIONAL = /(?:^|\s)v-(?:if|show)=/

/** 找出外壳模板里「带条件渲染/隐藏的实时区域」。 */
export function findConditionalShellLiveRegions(template) {
  const out = []
  for (const el of walkElements(template)) {
    if (!LIVE.test(el.attrs)) continue
    if (!CONDITIONAL.test(el.attrs)) continue
    const cls = el.attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? ''
    out.push({ line: el.line, tag: el.tag, classes: cls })
  }
  return out
}

describe('外壳模板里不许有条件渲染的实时区域', () => {
  const appTemplate = templateOf(readFileSync(resolve(import.meta.dirname, '..', 'src', 'App.vue'), 'utf8'))

  it('App.vue 的实时区域只剩两条常驻播报通道', () => {
    expect(findConditionalShellLiveRegions(appTemplate), '又有提示条自己声明实时区域了，读屏可能听不到').toEqual([])

    // 规模自证：两条通道都还在，且一条 polite、一条 assertive
    const live = [...walkElements(appTemplate)].filter((el) => LIVE.test(el.attrs))
    expect(live.length, '外壳里找不到播报通道，判据已与实现脱节').toBe(2)
    expect(live.every((el) => /class="sr-only"/.test(el.attrs)), '播报通道必须是无视觉的常驻容器').toBe(true)
  })

  it('提示条文案取自常量，模板里不得再留硬编码副本', () => {
    for (const text of ['本机安全模式', '本机保存需要注意', '✓ 本机保存已恢复', '已有 7 天未备份', '⚠ 有修改需要确认', '☁ 当前离线']) {
      expect(appTemplate, `模板里还有硬编码文案「${text}」，改一处漏一处就会让听觉与视觉分家`).not.toContain(text)
    }
  })

  it('夹具：条件渲染的实时区域要抓到，常驻的与非实时的不许误报', () => {
    expect(findConditionalShellLiveRegions('<div v-if="x" role="status">s</div>')).toHaveLength(1)
    expect(findConditionalShellLiveRegions('<div v-show="x" aria-live="polite">s</div>')).toHaveLength(1)
    expect(findConditionalShellLiveRegions('<div v-if="x" role="alert" class="banner">e</div>')[0].classes).toBe('banner')
    // 常驻播报通道：对
    expect(findConditionalShellLiveRegions('<div class="sr-only" role="alert" aria-live="assertive">e</div>')).toEqual([])
    // 条件渲染但**不是**实时区域：提示条改完之后就是这个形状，不该误报
    expect(findConditionalShellLiveRegions('<div v-if="err" class="banner">e</div>')).toEqual([])
    // 只带 aria-atomic 之类不算实时区域
    expect(findConditionalShellLiveRegions('<div v-if="x" aria-atomic="true">e</div>')).toEqual([])
  })
})
