// @vitest-environment happy-dom
import { createApp, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VirtualList from '../src/components/VirtualList.vue'
import SwipeActionItem from '../src/components/SwipeActionItem.vue'
import { buildLedgerFeedItems } from '../src/composables/ledger.js'

let app = null
let host = null
let layoutDescriptor = null
let scrollDescriptor = null
let viewportDescriptor = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
  if (layoutDescriptor) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', layoutDescriptor)
  if (scrollDescriptor) Object.defineProperty(window, 'scrollY', scrollDescriptor)
  if (viewportDescriptor) Object.defineProperty(window, 'innerHeight', viewportDescriptor)
  layoutDescriptor = null
  scrollDescriptor = null
  viewportDescriptor = null
  vi.restoreAllMocks()
})

function mountVirtual(items, options = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(VirtualList, {
      items,
      itemKey: 'key',
      threshold: 0,
      estimatedHeight: 62,
      gap: 0,
      overscan: 0,
      fixedHeight: true,
      ...options,
    }, {
      default: ({ item, index }) => h('div', {
        class: 'test-row',
        'data-index': index,
        'data-item-key': item.key,
      }, item.label),
    }),
  })
  app.mount(host)
}

describe('Ledger scroll performance contract', () => {
  it('projects date headers and transactions with stable view keys', () => {
    const items = buildLedgerFeedItems([
      { id: 'tx-2', date: '2026-09-02', name: '第二笔' },
      { id: 'tx-1', date: '2026-09-02', name: '第一笔' },
      { id: 'tx-0', date: '2026-09-01', name: '前一天' },
    ])

    expect(items.map((item) => item.key)).toEqual([
      'day:2026-09-02', 'tx-2', 'tx-1', 'day:2026-09-01', 'tx-0',
    ])
    expect(items.filter((item) => item.kind === 'transaction').map((item) => item.transaction.id)).toEqual(['tx-2', 'tx-1', 'tx-0'])
  })

  it('uses measured per-item heights when a grouped projection has headers', async () => {
    const previousLayout = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    layoutDescriptor = previousLayout
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
      if (this.classList.contains('virtual-list')) return { top: -100, height: 100, width: 320, bottom: 0, left: 0, right: 320 }
      return { top: 0, height: 62, width: 320, bottom: 62, left: 0, right: 320 }
    })
    scrollDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 100 })
    viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 })

    const items = [
      { key: 'day:2026-09-01', kind: 'day', label: '9月1日' },
      { key: 'tx:1', kind: 'transaction', label: '第一笔' },
      { key: 'tx:2', kind: 'transaction', label: '第二笔' },
      { key: 'tx:3', kind: 'transaction', label: '第三笔' },
    ]
    mountVirtual(items, { itemHeight: (item) => item.kind === 'day' ? 28 : 62 })
    await nextTick()

    expect(host.querySelector('.test-row')?.dataset.index).toBe('2')
    expect(host.querySelector('[data-item-key="tx:2"]')).not.toBeNull()
  })

  it.each([50, 500, 1000, 5000])('keeps %s transactions virtualized to a bounded DOM window', async (size) => {
    const items = buildLedgerFeedItems(Array.from({ length: size }, (_, index) => ({
      id: `tx-${index}`,
      name: `交易 ${index}`,
      date: '2026-09-01',
    })))
    mountVirtual(items, { itemHeight: (item) => item.kind === 'day' ? 20 : 62, overscan: 12 })
    await nextTick()

    expect(host.querySelector('[data-virtual="on"]')).not.toBeNull()
    expect(host.querySelectorAll('.test-row').length).toBe(26)
    expect(host.querySelectorAll('[data-item-key^="tx-"]').length).toBe(25)
  })

  it('does not promote an idle swipe row to a transform layer', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({
      render: () => h(SwipeActionItem, {
        actions: [{ key: 'delete', label: '删除' }],
        open: false,
      }, { default: () => h('div', { class: 'row-content' }, '交易') }),
    })
    app.mount(host)
    await nextTick()

    const content = host.querySelector('.swipe-content')
    expect(content.style.transform).toBe('')
    expect(content.style.willChange).toBe('')
  })
})
