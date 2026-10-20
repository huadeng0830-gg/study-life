// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { createApp } from 'vue'

/**
 * 渲染期异常必须有兜底。
 *
 * 过去只有「分包加载失败」这一条路会落到 RouteError：组件加载成功之后渲染时抛错，
 * 会直接把整页变成空白——用户除了刷新没有别的出路，界面本身也不会提示任何东西。
 *
 * 这里让 routePreload 交出一个「加载成功但渲染必炸」的组件，
 * 逐个路由验证：界面确实降级成错误页，并保留了「回到今天」这个出口。
 */
vi.mock('../src/router/routePreload.js', () => {
  const Boom = defineComponent({
    name: 'BoomChild',
    setup() { throw new Error('渲染期炸了') },
  })
  return {
    resolvedRouteComponent: () => Boom,
    routeLoaders: {},
  }
})

describe('路由渲染错误边界', () => {
  it('每个路由的视图组件在子组件抛错时都降级成错误页', async () => {
    const { routes } = await import('../src/router/routes.js')
    const { default: NotFoundView } = await import('../src/components/NotFoundView.vue')
    // 只看 asyncRoute 生成的懒加载视图；兜底的 404（NotFoundView）不是这一类。
    const views = routes.filter((route) => route.component && route.component !== NotFoundView)
    expect(views.length).toBeGreaterThan(10)

    for (const route of views) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const app = createApp(route.component)
      // 不让异常冒泡到测试框架：边界返回了 false，这里只是不让 vue 的默认告警刷屏。
      app.config.errorHandler = () => {}
      app.mount(host)
      await nextTick()
      await nextTick()
      await nextTick()

      const html = host.innerHTML
      expect(html, `${route.path} 没有降级成错误页`).toContain('暂时无法打开这个页面')
      expect(html, `${route.path} 缺少“回到今天”出口`).toContain('回到今天')

      app.unmount()
      host.remove()
    }
  })
})