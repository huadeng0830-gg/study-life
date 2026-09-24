// @vitest-environment happy-dom
import { createApp } from 'vue'
import { describe, expect, it } from 'vitest'
import RouteFallback from '../src/components/RouteFallback.vue'

function mountFallback(error) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(RouteFallback, { error })
  app.mount(root)
  return { root, app }
}

describe('路由加载状态', () => {
  it('加载中有可感知的状态文本', () => {
    const mounted = mountFallback(false)
    expect(mounted.root.textContent).toContain('页面加载中')
    expect(mounted.root.querySelector('button')).toBeNull()
    mounted.app.unmount()
    mounted.root.remove()
  })

  it('加载失败提供重新加载出口', () => {
    const mounted = mountFallback(true)
    expect(mounted.root.textContent).toContain('页面加载失败')
    expect(mounted.root.querySelector('button')?.textContent).toContain('重新加载')
    mounted.app.unmount()
    mounted.root.remove()
  })
})
