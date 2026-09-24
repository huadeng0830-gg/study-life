// @vitest-environment happy-dom
import { createApp, h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VirtualList from '../src/components/VirtualList.vue'

let app = null
let host = null

afterEach(() => {
  vi.restoreAllMocks()
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

function mountList(items, threshold) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(VirtualList, {
      items,
      threshold,
      estimatedHeight: 60,
      overscan: 2,
    }, {
      default: ({ item }) => h('div', { class: 'test-row' }, item.label),
    }),
  })
  app.mount(host)
}

function mountCachedList() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const page = ref('list')
  app = createApp({
    setup: () => ({ page }),
    render() {
      const child = this.page === 'list'
        ? h(VirtualList, { items: Array.from({ length: 80 }, (_, id) => ({ id })), threshold: 10 })
        : h('div', { class: 'other-page' }, '其他页面')
      return h(KeepAlive, null, { default: () => [child] })
    },
  })
  app.mount(host)
  return {
    showOther: () => { page.value = 'other' },
    showList: () => { page.value = 'list' },
  }
}

describe('VirtualList', () => {
  it('keeps short lists fully rendered', async () => {
    mountList(Array.from({ length: 8 }, (_, id) => ({ id, label: `项目 ${id}` })), 10)
    await nextTick()
    expect(host.querySelectorAll('.test-row')).toHaveLength(8)
    expect(host.querySelector('[data-virtual="off"]')).not.toBeNull()
  })

  it('only renders the visible window for long lists', async () => {
    mountList(Array.from({ length: 120 }, (_, id) => ({ id, label: `项目 ${id}` })), 20)
    await nextTick()
    const rendered = host.querySelectorAll('.test-row').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(120)
    expect(host.querySelector('[data-virtual="on"]')).not.toBeNull()
  })

  it('releases global observers while a cached page is inactive', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const cached = mountCachedList()
    await nextTick()

    expect(addSpy.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1)
    cached.showOther()
    await nextTick()
    expect(removeSpy.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1)

    cached.showList()
    await nextTick()
    expect(addSpy.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(2)
  })
})
