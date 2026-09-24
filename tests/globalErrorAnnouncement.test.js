// @vitest-environment happy-dom
/**
 * 全局错误必须走**常驻的 assertive 播报区**（第二十三轮）。
 *
 * 【为什么】`liveRegion.js` 开头记着一条规律：`v-if` 插入的「新节点带内容」，
 * VoiceOver 一类读屏可能只监听既有节点的文本变化，于是**一个字都不播**。
 * 而错误提示原先恰恰只有 toast 上那个 `role="alert"`（v-if 插入）：
 * 用户眼前页面已经坏了，如果连听也听不到，就彻底不知道发生了什么——
 * 这是全应用最不能静默的一条消息。
 * 现在 `globalError.js` 的 `report()` 会同时调 `announceAlert()`，
 * 播报落在应用外壳里**常驻**的 assertive 容器上。
 *
 * 【为什么分两条通道】礼貌播报（路由切换）与紧急播报各用一套定时器：
 * 共用的话，一句"某页面已打开"会把刚刚排队的错误播报挤掉。
 * 下面有一条测试专门钉住这件事（两条通道互不打断）。
 *
 * 【为什么视觉与听觉同源】toast 上的文案直接渲染 `GLOBAL_ERROR_TITLE` / `GLOBAL_ERROR_BODY`，
 * 播报句由这两个常量拼成。否则读屏用户听到的会是另一套说辞。
 * 这条用源码守卫钉住，而不是靠"记得同步改两处"。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GLOBAL_ERROR_BODY,
  GLOBAL_ERROR_NOTICE,
  GLOBAL_ERROR_TITLE,
  dismissGlobalError,
  installGlobalErrorHandling,
  lastGlobalError,
} from '../src/composables/globalError.js'
import { announce, clearAnnouncement, liveAlert, liveMessage } from '../src/composables/liveRegion.js'
import { templateOf, walkElements } from './helpers/vueTemplate.js'

/** 播报写入是「先清空、下一拍（30ms）再写」，所以推进 40ms 让内容落下。 */
const TICK = 40

/** 假装是 Vue 应用实例，只为拿到 errorHandler 这个入口（与 globalError.test.js 同法）。 */
const fakeApp = () => {
  const app = { config: {} }
  installGlobalErrorHandling(app)
  return app
}

const boom = (app, error = new Error('render boom')) => app.config.errorHandler(error, null, 'render')

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  dismissGlobalError()
  clearAnnouncement()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('全局错误走常驻的紧急播报区', () => {
  it('组件渲染错误会被 assertive 播报，且不占用礼貌通道', () => {
    const app = fakeApp()

    boom(app)
    // 写入前先清空，制造一次可观察的变化（否则重复播报同一句会被读屏忽略）
    expect(liveAlert.value).toBe('')
    vi.advanceTimersByTime(TICK)

    expect(liveAlert.value).toBe(GLOBAL_ERROR_NOTICE)
    // 精度：错误**不能**落到礼貌通道——那是路由切换用的，级别不够
    expect(liveMessage.value).toBe('')
  })

  it('未捕获的 Promise 拒绝同样走紧急通道', () => {
    fakeApp()

    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('async boom') })
    window.dispatchEvent(event)
    vi.advanceTimersByTime(TICK)

    expect(lastGlobalError.value).toMatchObject({ kind: 'promise' })
    expect(liveAlert.value).toBe(GLOBAL_ERROR_NOTICE)
  })

  it('连错两次也都会播报（先清空再写入的意义就在这里）', () => {
    const app = fakeApp()

    boom(app)
    vi.advanceTimersByTime(TICK)
    expect(liveAlert.value).toBe(GLOBAL_ERROR_NOTICE)

    // 第二句内容完全相同：若不先清空，读屏会认为"文本没变"而静默
    boom(app)
    expect(liveAlert.value).toBe('')
    vi.advanceTimersByTime(TICK)
    expect(liveAlert.value).toBe(GLOBAL_ERROR_NOTICE)
  })

  it('紧急播报不会挤掉礼貌播报（两条通道各有一套定时器）', () => {
    const app = fakeApp()

    announce('待办页 已打开')
    boom(app)
    vi.advanceTimersByTime(TICK)

    expect(liveMessage.value, 'polite 通道被错误播报挤掉了').toBe('待办页 已打开')
    expect(liveAlert.value, 'assertive 通道没落下来').toBe(GLOBAL_ERROR_NOTICE)
  })

  it('clearAnnouncement 把两条通道一起清干净', () => {
    const app = fakeApp()
    announce('待办页 已打开')
    boom(app)
    vi.advanceTimersByTime(TICK)

    clearAnnouncement()
    expect(liveMessage.value).toBe('')
    expect(liveAlert.value).toBe('')
  })
})

/* ---------------- 守卫：播报通道必须常驻 ---------------- */

const LIVE_ROLE = /(?:^|\s):?role="(?:alert|status)"/
/**
 * 播报区的判定必须同时认 `role` 与 `aria-live`——只认 role 会漏掉
 * 只用 `aria-live` 声明的区域。这条正是夹具抓出来的（第一版只认 role，
 * `<div class="sr-only" aria-live="polite" aria-hidden="true">` 直接漏过）。
 * 与 `hiddenLiveRegion.test.js` 的 `LIVE` 保持同一口径。
 */
const LIVE_REGION = /(?:^|\s):?role="(?:alert|status)"|(?:^|\s):?aria-live=/
const HIDDEN_OR_CONDITIONAL = [
  ['v-if', /(?:^|\s)v-if=/],
  ['v-show', /(?:^|\s)v-show=/],
  ['aria-hidden="true"', /(?:^|\s)aria-hidden="true"/],
  ['hidden 属性', /(?:^|\s)hidden(?=[\s>=]|$)/],
]

/**
 * 找出「是播报通道（sr-only + 实时区域）却不是常驻」的元素。
 *
 * 判据只看 `sr-only` 的实时区域：它们存在的意义就是**常驻容器、只改文本**。
 * 视觉 toast 上的 `role="alert"` 不在判据里——那是可见元素，属于另一回事
 * （本轮就把全局错误 toast 的 role 去掉、改走常驻通道了）。
 */
export function findConditionalAnnouncers(template) {
  const out = []
  for (const el of walkElements(template)) {
    const classes = (el.attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    if (!classes.includes('sr-only') || !LIVE_REGION.test(el.attrs)) continue
    const hider = HIDDEN_OR_CONDITIONAL.find(([, re]) => re.test(el.attrs))
    if (hider) out.push({ role: (el.attrs.match(LIVE_ROLE)?.[0] ?? 'aria-live').trim(), why: hider[0] })
  }
  return out
}

describe('读屏播报通道必须常驻在 DOM 里', () => {
  const appTemplate = templateOf(readFileSync(resolve(import.meta.dirname, '..', 'src', 'App.vue'), 'utf8'))

  it('App.vue 的两条播报通道都常驻，且一条 polite、一条 assertive', () => {
    expect(findConditionalAnnouncers(appTemplate), '播报区带了条件渲染/隐藏，VoiceOver 又会听不到').toEqual([])

    const announcers = [...walkElements(appTemplate)].filter((el) => {
      const classes = (el.attrs.match(/(?:^|\s)class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
      return classes.includes('sr-only') && LIVE_REGION.test(el.attrs)
    })
    // 规模自证：少一条就说明这条守卫已经和实现脱节
    expect(announcers.length, '没找到常驻播报区，判据已与实现脱节').toBeGreaterThanOrEqual(2)
    const roles = announcers.map((el) => el.attrs.match(LIVE_ROLE)[0].trim())
    expect(roles).toContain('role="status"')
    expect(roles).toContain('role="alert"')
    // 礼貌通道必须是 polite，紧急通道必须是 assertive（级别写反等于没修）
    const polite = announcers.find((el) => /role="status"/.test(el.attrs))
    const assertive = announcers.find((el) => /role="alert"/.test(el.attrs))
    expect(polite.attrs).toContain('aria-live="polite"')
    expect(assertive.attrs).toContain('aria-live="assertive"')
    expect(assertive.attrs).toContain('aria-atomic="true"')
  })

  it('toast 文案与播报文案同源：App.vue 直接渲染这两个常量，没有硬编码副本', () => {
    // 常量拼出来就是播报的那一句
    expect(GLOBAL_ERROR_NOTICE).toBe(`${GLOBAL_ERROR_TITLE}：${GLOBAL_ERROR_BODY}`)
    // App.vue 引用常量
    expect(appTemplate).toContain('{{ GLOBAL_ERROR_TITLE }}')
    expect(appTemplate).toContain('{{ GLOBAL_ERROR_BODY }}')
    // 且不再有一份写死的文案（否则改一处漏一处，听觉与视觉就分家了）
    expect(appTemplate, 'toast 里有硬编码的错误文案副本').not.toContain(GLOBAL_ERROR_TITLE)
    expect(appTemplate, 'toast 里有硬编码的错误文案副本').not.toContain(GLOBAL_ERROR_BODY)
  })

  it('夹具：条件渲染/隐藏的播报通道会被抓出来', () => {
    expect(findConditionalAnnouncers('<div class="sr-only" role="status" v-if="x">s</div>')).toHaveLength(1)
    expect(findConditionalAnnouncers('<div class="sr-only" role="alert" v-show="x">e</div>')).toHaveLength(1)
    expect(findConditionalAnnouncers('<div class="sr-only" aria-live="polite" aria-hidden="true"></div>')).toHaveLength(1)
    expect(findConditionalAnnouncers('<div class="sr-only" role="alert" hidden>e</div>')).toHaveLength(1)
    expect(findConditionalAnnouncers('<div class="sr-only" role="alert" v-if="x">e</div>')[0].why).toBe('v-if')
  })

  it('夹具：常驻播报区、非播报的 sr-only、可见 toast 都不得误报（精度测试）', () => {
    expect(findConditionalAnnouncers('<div class="sr-only" role="status" aria-live="polite"></div>')).toEqual([])
    expect(findConditionalAnnouncers('<div class="sr-only" role="alert" aria-live="assertive"></div>')).toEqual([])
    // 只是视觉隐藏的说明文字，不是播报通道
    expect(findConditionalAnnouncers('<span class="sr-only" v-if="x">仅读屏可见的说明</span>')).toEqual([])
    // 可见的错误 toast 不在判据里：它本来就该随状态出现/消失
    expect(findConditionalAnnouncers('<div class="global-error-toast" role="alert" v-if="err">e</div>')).toEqual([])
  })
})