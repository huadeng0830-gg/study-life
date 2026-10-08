/**
 * 收尾取消「影子副本待写盘」的测试接缝。
 *
 * 【它解决的是什么】`npm test` 偶发以 exit 1 退出，而用例全绿、汇总里只有
 * `Errors 1 error`。根因不在断言，而在**跨过环境拆除那一刻的一次写盘**：
 *
 *   1. `src/composables/dataVault.js` 的影子副本（IndexedDB 安全副本）走 240ms
 *      防抖，写失败还会按指数退避一直重试；启动阶段的补写更是排在 2200ms 之后。
 *   2. 测试环境（happy-dom）里**根本没有 IndexedDB**，所以这条链永远失败、永远
 *      挂着定时器，且失败时必定调用错误回调 → `recordSilentError` → `console.warn`。
 *   3. vitest 在最后一个用例跑完就拆除环境（清掉全局 window），但**定时器队列里
 *      已经排好的那一次冲刷照样会触发**（happy-dom 的定时器底层就是 Node 定时器）。
 *      于是那一声 console 落在环境拆除之后，不属于任何测试。
 *   4. vitest 只能把它当成「环境拆除后仍在 pending 的 onUserConsoleLog 上报」，
 *      用一个 `EnvironmentTeardownError` 记进 unhandled error → `Errors 1 error`
 *      → 进程 exit 1。
 *
 * 所以会写 store 的测试文件请在**文件顶层**登记一次收尾：
 *
 *   import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'
 *   registerMirrorTeardown()
 *
 * 【为什么必须在 `afterAll` 里、并且动态 import】收尾要取消的是**本文件最后一次
 * `vi.resetModules()` 之后真正在用的那个模块实例**的队列：静态 import 拿到的是
 * 重新求值之前的旧实例，取消不到真正的定时器。至于更早实例遗留的定时器，产品侧
 * 按宿主登记了全部待写盘定时器（`cancelPendingMirrorWrites` 会一并清掉）。
 *
 * 【为什么不是"把定时器调快"或"最后冲刷一次"】调快只是把竞态窗口挪个位置；
 * 真到收尾才冲刷，仍然是一声落在环境拆除之后的 console（同样的 error）。测试里
 * 的镜像本来就**没有可写入的对象**，取消它才是正确语义；产品侧另有「宿主消失后
 * 不再调度」的守卫（见 `dataVault.js` 的 `mirrorHostAlive`），两者互补。
 */
import { afterAll } from 'vitest'

export function registerMirrorTeardown() {
  afterAll(async () => {
    const vault = await import('../../src/composables/dataVault.js')
    vault.cancelPendingMirrorWrites()
  })
}
