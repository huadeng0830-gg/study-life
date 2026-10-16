// @vitest-environment happy-dom
import { createApp, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/views/campus/CampusMarketplaceView.vue', () => ({ default: { template: '<h1>Fictional market</h1>' } }))
import { initialRoutePath, preloadRoute, preloadRouteLink } from '../src/router/routePreload.js'
import { routes } from '../src/router/routes.js'

describe('reopening a downloaded route', () => {
  it('warms the actual bookmarked page and handles legacy aliases', () => {
    expect(initialRoutePath('#/campus/market?sort=newest')).toBe('/campus/market')
    expect(initialRoutePath('#/places')).toBe('/campus/places')
    expect(initialRoutePath('#/campus/matters/fictional-id')).toBe('/campus/matters/:matterId')
    expect(initialRoutePath('#/unknown')).toBe('/')
    expect(initialRoutePath('')).toBe('/')
  })
  it('renders a warmed route immediately without inserting a loading screen', async () => {
    const link = document.createElement('a')
    link.href = window.location.href.split('#')[0] + '#/campus/market'
    const nested = document.createElement('span')
    link.append(nested)
    await preloadRouteLink({ type: 'focusin', target: nested })
    const root = document.createElement('div')
    const app = createApp(routes.find(route => route.path === '/campus/market').component)
    try {
      app.mount(root)
      expect(root.querySelector('.route-fallback')).toBeNull()
      expect(root.textContent).toContain('Fictional market')
      await nextTick()
    } finally { app.unmount() }
  })
  it('ignores external and new-tab links', () => {
    const link = document.createElement('a')
    link.href = 'https://fictional.example.invalid/#/campus/market'
    expect(preloadRouteLink({ type: 'focusin', target: link })).toBeUndefined()
    link.href = window.location.href.split('#')[0] + '#/campus/market'
    link.target = '_blank'
    expect(preloadRouteLink({ type: 'focusin', target: link })).toBeUndefined()
  })
  it('preloads a route without a link as before', async () => {
    expect(await preloadRoute('/campus/market')).toHaveProperty('default')
  })
})
