// @vitest-environment happy-dom
/**
 * 「✨ 已更新」更新说明浮层（第五十四轮补的覆盖）。
 *
 * 【为什么单独给它一个文件】在这之前，全仓**没有任何测试覆盖这个浮层本身**——
 * `✨` / `release-notes` / `release-version` 三个特征在 `tests/` 里零命中；可它却一直在
 * 污染别人的断言：它在 `App.vue` 里是 `defineAsyncComponent`，"到底挂上来了没有"是
 * **时序问题**，于是「body 里还剩几个浮层 / 最上层是谁」这类整体断言，实际测的是那个
 * 异步分块有没有赶上。第五十四轮把版本号从 48 提到 49 时，`confirmDialogMigration`
 * 里一条「取消后确认框应关闭」就从**靠运气绿**翻成了红（收到的浮层是更新说明而不是
 * 确认框，详见报告 §1.82）。
 *
 * 【处置是"让状态确定"，不是"放宽断言"】
 *   - `tests/helpers/mountApp.js` 现在默认扮演**回访用户**（主动把当前版本标记为已读），
 *     于是"浮层"这类整体断言只反映被测组件；
 *   - 这个浮层自己则在这里被**正面覆盖**：首次启动会弹、显示当前版本与本轮说明、
 *     点「知道了」会关闭并记为已读。
 * 一减一加：噪声消失，而覆盖面反而变大了（此前是零覆盖）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_RELEASE,
  RELEASE_NOTES,
  RELEASE_SEEN_KEY,
  shouldShowReleaseNotes,
} from '../src/composables/releaseNotes.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

let mounted = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

/** 更新说明的浮层（`Modal` 会 Teleport 到 body，所以从 `document` 里找）。 */
const releaseOverlay = () =>
  [...document.querySelectorAll('.overlay')].find((el) => el.textContent.includes('✨ 已更新')) ?? null

/**
 * 等浮层出现。要等的是**两件真实的事**，都必须等够：
 *   1. `defineAsyncComponent` 的分块挂上来（调用方已预热，通常很快）；
 *   2. `App.vue` 里那次**故意的 900ms 延迟**——新版本说明是「挂载后 900ms 再弹」，
 *      给首屏渲染让路（见 `App.vue` 的 `releaseTimer`）。
 *
 * 【为什么用真实时钟兜底，而不是"80 次 × 5ms"】版本58 的 bump 让这个文件从"靠运气绿"
 * 翻成了确定性红（单独跑也 2 failed）：`80 × 5ms` 只有约 400ms 的睡眠预算，**本来就
 * 小于应用那 900ms 的延迟**，此前能过只是因为 happy-dom 下每次 5ms 睡眠的真实墙钟
 * 开销把总时长撑到了 900ms 以上；模块图一变、这一层开销变了，巧合就没了。
 * 现在按截止时间等待，预算明显大于 900ms：等的是"应用真的说了要等多久"，
 * 而不是赌计时开销。断言一字未改——仍是"等到就该弹"，等不到照样红。
 */
async function waitForOverlay(timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = releaseOverlay()
    if (found) return found
    if (Date.now() >= deadline) return releaseOverlay()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('更新说明浮层', () => {
  it('判别力前提：干净的 profile 下「确实应该弹」（否则下面那条"不弹"毫无意义）', () => {
    localStorage.clear()
    expect(shouldShowReleaseNotes(), '空 profile 下应为真').toBe(true)
  })

  it('夹具默认扮演回访用户：不弹，且当前版本已被标记为已读', async () => {
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    localStorage.clear()
    mounted = await mountApp()
    await settle()

    expect(releaseOverlay(), '默认不该弹更新说明').toBeNull()
    expect(shouldShowReleaseNotes(), '夹具应已把当前版本标记为已读').toBe(false)
  })

  it('首次启动会弹，并显示当前版本与本轮说明', async () => {
    // 预热分块：让 `defineAsyncComponent` 的解析不取决于"等多久"
    await import('../src/components/UpdateNotes.vue')
    const { mountApp } = await import('./helpers/mountApp.js')
    localStorage.clear()
    mounted = await mountApp({ markReleaseSeen: false })

    const overlay = await waitForOverlay()
    expect(overlay, '首次启动必须弹更新说明').toBeTruthy()
    expect(overlay.textContent).toContain(`版本 ${APP_RELEASE}`)
    expect(overlay.textContent).toContain(RELEASE_NOTES[0])
  })

  it('点「知道了」会关闭它，并把当前版本记为已读', async () => {
    await import('../src/components/UpdateNotes.vue')
    const { mountApp, settle } = await import('./helpers/mountApp.js')
    localStorage.clear()
    mounted = await mountApp({ markReleaseSeen: false })

    const overlay = await waitForOverlay()
    expect(overlay, '首次启动必须弹更新说明').toBeTruthy()

    const ack = [...overlay.querySelectorAll('button')].find((button) => button.textContent.trim() === '知道了')
    expect(ack, '浮层里应有「知道了」按钮').toBeTruthy()
    ack.click()
    await settle()

    expect(releaseOverlay(), '点「知道了」后应关闭').toBeNull()
    expect(localStorage.getItem(RELEASE_SEEN_KEY), '应把当前版本记为已读').toBe(APP_RELEASE)
    expect(shouldShowReleaseNotes(), '之后再启动不该再弹').toBe(false)
  })
})