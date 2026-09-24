// @vitest-environment happy-dom
/**
 * 路由播报（第三十一轮新增守卫）。
 *
 * 【为什么补这条】App.vue 一直在 `route.fullPath` 上播报「某页已打开」，
 * 而 fullPath **包含 query**：账本分区（?tab=review）、深链高亮（?focus=…）
 * 这类**页内状态**变化也会触发一次「账本 已打开」——
 * 页面根本没换，读屏用户却被告知又打开了一遍。
 *
 * 第三十一轮补上账本分区写回 URL 之后这个问题会被放大（每次点分区都改 query），
 * 所以播报改成只看 `route.path`。这条守卫同时盯住两头：
 *   1. 真的换页面时**必须**播报（别把播报整个弄没了）；
 *   2. 只换 query 时**不许**播报。
 *
 * 【关于时序】`liveRegion` 的写入是「先清空、下一拍再写入」（连续播报同一句时
 * 读屏会认为文本没变而静默，必须制造一次可观察的变化）。实测这条链路落地需要
 * 20～40ms（不是 0ms 那一拍），所以：
 *   - 要断言"播报了"→ 用 waitForAnnouncement() 轮询到出现为止（带上限）；
 *   - 要断言"没播报"→ 必须先 clearAnnouncement() 把上一句擦掉，再等满一个观察窗口。
 *     否则断言可能在写入落地前就通过——看着是绿的，其实什么都没验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement, liveMessage } from '../src/composables/liveRegion.js'
import { mountApp, gotoRoute, settle } from './helpers/mountApp.js'
import { routes } from '../src/router/routes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let mounted = null
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  vi.restoreAllMocks()
  mounted?.unmount()
  mounted = null
  clearAnnouncement()
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 等播报落地；出现就立刻返回，最多等 timeout 毫秒。 */
async function waitForAnnouncement(timeout = 800) {
  const deadline = Date.now() + timeout
  while (!liveMessage.value && Date.now() < deadline) await sleep(10)
  return liveMessage.value
}

/** 观察窗口：确认"确实没有播报"（要比实测的落地延迟宽裕得多）。 */
const observeSilence = () => sleep(150)

describe('路由播报只认页面，不认页内状态', () => {
  it('真的换页面时要播报', async () => {
    mounted = await mountApp({ routes })
    clearAnnouncement()
    await gotoRoute(mounted, '/bills')
    expect(await waitForAnnouncement()).toBe('账本 已打开')

    clearAnnouncement()
    await gotoRoute(mounted, '/tasks')
    expect(await waitForAnnouncement(), '换页面必须重新播报').toBe('待办 已打开')
  })

  it('只改 query（切账本分区）时不播报', async () => {
    mounted = await mountApp({ routes })
    clearAnnouncement()
    await gotoRoute(mounted, '/bills')
    await waitForAnnouncement()

    clearAnnouncement()
    document.querySelector('#ledger-tab-review').click()
    await settle()
    expect(mounted.router.currentRoute.value.query.tab, '前提：这一步确实改了 query').toBe('review')

    await observeSilence()
    expect(liveMessage.value, '页面没换就不该再播一遍"已打开"').toBe('')
  })

  it('深链带 ?focus= 进入时只播报一次', async () => {
    mounted = await mountApp({ routes })
    clearAnnouncement()
    await gotoRoute(mounted, '/bills?focus=abc')
    // 页面确实换了（从 / 到 /bills），所以必须有一条播报；
    // 带 query 的那次导航、以及随后把 query 清理掉的导航，都不该再多播一条。
    expect(await waitForAnnouncement()).toBe('账本 已打开')

    // 观察窗口里不能再冒出第二条（比如清理 query 时又播一遍）。
    clearAnnouncement()
    await observeSilence()
    expect(liveMessage.value, '同一页面内的 query 清理不该再播报').toBe('')
  })
})