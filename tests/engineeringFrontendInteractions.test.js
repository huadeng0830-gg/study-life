// @vitest-environment happy-dom
import { createApp, h, markRaw, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import PromptDialog from '../src/components/PromptDialog.vue'
import ContextMenu from '../src/components/ContextMenu.vue'
import ActionSheet from '../src/components/ActionSheet.vue'
import VirtualList from '../src/components/VirtualList.vue'

const mounted = []
function mount(render) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp({ render })
  app.mount(host)
  mounted.push({ app, host })
  return host
}
afterEach(() => {
  for (const { app, host } of mounted.splice(0).reverse()) { app.unmount(); host.remove() }
})

describe('engineering audit: reusable frontend components', () => {
  it('each prompt label resolves to its own input when prompts coexist', async () => {
    mount(() => h('div', [
      h(PromptDialog, { open: true, title: '虚构分类一', label: '分类一' }),
      h(PromptDialog, { open: true, title: '虚构分类二', label: '分类二' }),
    ]))
    await nextTick()
    const labels = [...document.querySelectorAll('.prompt-label')]
    expect(labels).toHaveLength(2)
    for (const label of labels) {
      expect(document.getElementById(label.htmlFor)).toBe(label.closest('.prompt-field').querySelector('input'))
    }
  })

  it.each([
    ['context menu', ContextMenu, '.context-menu', '.context-menu-title'],
    ['action sheet', ActionSheet, '.sheet', '.sheet-head h3'],
  ])('%s resolves each instance title correctly', async (_name, Component, panelSelector, titleSelector) => {
    mount(() => h('div', [
      h(Component, { open: true, title: '虚构操作一' }),
      h(Component, { open: true, title: '虚构操作二' }),
    ]))
    await nextTick()
    const panels = [...document.querySelectorAll(panelSelector)]
    expect(panels).toHaveLength(2)
    for (const panel of panels) {
      expect(document.getElementById(panel.getAttribute('aria-labelledby'))).toBe(panel.querySelector(titleSelector))
    }
  })

  it('default virtual list reads only its visible window instead of every row', async () => {
    let rowReads = 0
    const items = markRaw(new Proxy(Array.from({ length: 5000 }, (_, id) => ({ id })), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) rowReads++
        return Reflect.get(target, key, receiver)
      },
    }))
    const host = mount(() => h(VirtualList, { items, threshold: 10, estimatedHeight: 60, overscan: 2 }, {
      default: ({ item }) => h('div', { class: 'fixture-row' }, String(item.id)),
    }))
    await nextTick()
    expect(host.querySelectorAll('.fixture-row').length).toBeGreaterThan(0)
    expect(host.querySelectorAll('.fixture-row').length).toBeLessThan(100)
    expect(rowReads).toBeLessThan(100)
  })
})
