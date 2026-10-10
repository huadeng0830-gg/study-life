// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SwipeActionItem from '../src/components/SwipeActionItem.vue'

let app, host
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

function pointer(target, type, x) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 1 }, pointerType: { value: 'touch' },
    clientX: { value: x }, clientY: { value: 100 },
  })
  target.dispatchEvent(event)
}
function swipe(target, from, to) {
  pointer(target, 'pointerdown', from)
  pointer(target, 'pointermove', to)
  pointer(target, 'pointerup', to)
}
async function mount() {
  host = document.createElement('div'); document.body.appendChild(host)
  const open = ref(false), directions = []
  app = createApp({
    render: () => h(SwipeActionItem, {
      leftLabel: '删除', rightLabel: '完成', open: open.value,
      'onUpdate:open': (value) => { open.value = value },
      onSwipe: (direction) => directions.push(direction),
    }, { default: () => h('div', '虚构任务') }),
  })
  app.mount(host); await nextTick()
  return { open, directions, content: host.querySelector('.swipe-content') }
}

describe('engineering audit: bidirectional swipe actions', () => {
  it('opens the right action after crossing the same threshold as a left swipe', async () => {
    const row = await mount()
    swipe(row.content, 100, 130); await nextTick()
    expect(row.open.value).toBe(true)
    expect(row.directions).toEqual(['right'])
    expect(row.content.style.transform).toBe('translate3d(70px,0,0)')
  })

  it('closes a right-expanded row when swiped back left', async () => {
    const row = await mount()
    swipe(row.content, 100, 180); await nextTick()
    expect(row.open.value).toBe(true)
    swipe(row.content, 100, 50); await nextTick()
    expect(row.open.value).toBe(false)
    expect(row.directions).toEqual(['right'])
  })

  it('keeps a short right swipe closed', async () => {
    const row = await mount()
    swipe(row.content, 100, 120); await nextTick()
    expect(row.open.value).toBe(false)
    expect(row.directions).toEqual([])
  })

  it('only exposes the revealed direction to keyboard focus', async () => {
    const row = await mount()
    swipe(row.content, 100, 180); await nextTick()
    expect(host.querySelector('.right-swipe-actions button').tabIndex).toBe(0)
    expect(host.querySelector('.left-swipe-actions button').tabIndex).toBe(-1)
  })
})
