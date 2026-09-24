// @vitest-environment happy-dom
/**
 * 404 页不得自己声明 `main` 地标（第二十轮）。
 *
 * 起因是一个真缺陷：`NotFoundView.vue` 原本是 `<main class="route-not-found">`，
 * 而它是路由组件（`main.js:167`），经 `<router-view>` 渲染在 App.vue 的
 * `<main id="main-content">` **内部**。于是渲染出来的文档里出现**嵌套 main**：
 *   1. HTML 规范不允许——一个文档只能有一个 main，且 main 不能是 main 的后代；
 *   2. 读屏的地标导航里会冒出两个「主内容」，用户无从分辨；
 *   3. 内层那个按规范是无效的，部分实现直接忽略它——404 页的内容就没了区域。
 *
 * 已改成 `<div class="route-not-found">`（样式全走类选择器，外观不变）。
 * 源码侧守卫在 landmarksAndRoles.test.js（只有外壳可以声明 main）；
 * 这里验证的是**渲染结果**：复刻 App.vue 的结构后，文档里仍然只有一个 main。
 *
 * 【为什么变异能抓到】改回 `<main>` 时 `querySelectorAll('main')` 会变成 2。
 */
import { createApp, nextTick } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'
import NotFoundView from '../src/components/NotFoundView.vue'

let app = null
let host = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

describe('404 页渲染在外壳 main 内部', () => {
  it('文档里仍然只有一个 main，且 404 的内容没丢', async () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()

    host = document.createElement('div')
    // 复刻 App.vue 的结构：<main id="main-content" tabindex="-1"> 里挂路由视图
    host.innerHTML = '<main id="main-content" tabindex="-1"></main>'
    document.body.appendChild(host)
    const mountPoint = document.createElement('div')
    host.querySelector('main').appendChild(mountPoint)

    app = createApp(NotFoundView)
    app.use(router)
    app.mount(mountPoint)
    await nextTick()

    // 核心断言：嵌套 main 时这里是 2
    expect(host.querySelectorAll('main')).toHaveLength(1)

    // 内容没丢，而且仍在那个唯一的 main 区域里
    const main = host.querySelector('main')
    expect(main.textContent).toContain('页面不存在')
    expect(main.querySelector('.route-not-found'), '根元素要保留这个类，样式全靠它').toBeTruthy()
    expect(main.querySelector('h1')?.textContent).toBe('页面不存在')
    expect(main.querySelector('.route-not-found-code')?.textContent).toBe('404')

    // 「返回首页」得是真链接
    const link = main.querySelector('a')
    expect(link, '返回首页应当是 router-link 渲染出的 <a>').toBeTruthy()
    expect(link.getAttribute('href')).toContain('#/')
    expect(link.textContent).toBe('返回首页')
  })
})