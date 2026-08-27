// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import VirtualList from '../src/components/VirtualList.vue'

let app = null
let host = null

afterEach(() => {
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
})
