// 测试环境里的 `virtual:pwa-register` 替身。
//
// 这个模块由 vite-plugin-pwa 在**构建期**注入，vitest 里没有它的实现。应用壳现在
// 静态导入它（App.vue → composables/appUpdate.js），于是任何挂载真实应用的用例
// 都会在启动时抛：
//   The argument 'filename' must be a file URL object ... Received 'file:///@vite-plugin-pwa/virtual:pwa-register'
//
// 与其要求每个壳层用例各自 `vi.mock`，不如在 vite.config.js 里按测试模式把它别名到
// 这份替身：分辨率确定、新增壳层用例不会再踩，已显式 mock 的用例仍按自己的工厂生效。
export function registerSW() {
  return () => {}
}