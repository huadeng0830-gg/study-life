// @vitest-environment happy-dom
import { createApp, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SwipeActionItem from '../src/components/SwipeActionItem.vue'
import { transactionSwipeActions } from '../src/composables/ledgerSwipe.js'
import { isBillPayment } from '../src/composables/ledgerRelations.js'

let app = null
let host = null

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null
  host = null
})

function dispatchPointer(target, type, x, y, pointerType = 'touch', pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    clientX: { value: x },
    clientY: { value: y },
  })
  target.dispatchEvent(event)
}

function mountItem({ id = 'tx-1', open = false, transaction = {} } = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const openState = ref(open)
  const events = { swipes: [], actions: [] }
  const item = {
    id,
    name: '牛肉面',
    amount: 15,
    ...transaction,
  }
  app = createApp({
    setup() {
      return { openState }
    },
    render() {
      return h(SwipeActionItem, {
        actions: transactionSwipeActions(item),
        open: openState.value,
        'onUpdate:open': (value) => { openState.value = value },
        onSwipe: (direction) => events.swipes.push(direction),
        onAction: (action) => events.actions.push(action),
      }, {
        default: () => h('div', { class: 'row-content' }, '牛肉面'),
      })
    },
  })
  app.mount(host)
  return { openState, events, content: () => host.querySelector('.swipe-content') }
}

function mountPair() {
  host = document.createElement('div')
  document.body.appendChild(host)
  const openId = ref('')
  app = createApp({
    setup() {
      return { openId }
    },
    render() {
      return h('div', {}, ['tx-a', 'tx-b'].map((id) => h(SwipeActionItem, {
        key: id,
        actions: transactionSwipeActions({ id, name: id }),
        open: openId.value === id,
        'onUpdate:open': (value) => {
          if (value) openId.value = id
          else if (openId.value === id) openId.value = ''
        },
        onSwipe: (direction) => { if (direction === 'left') openId.value = id },
      }, { default: () => h('div', { class: 'row-content' }, id) })))
    },
  })
  app.mount(host)
  return { openId, contents: () => [...host.querySelectorAll('.swipe-content')] }
}

function swipe(content, start, end, pointerType = 'touch') {
  dispatchPointer(content, 'pointerdown', start.x, start.y, pointerType)
  dispatchPointer(content, 'pointermove', end.x, end.y, pointerType)
  dispatchPointer(content, 'pointerup', end.x, end.y, pointerType)
}

describe('SwipeActionItem', () => {
  it('keeps bill payment safety actions separate from normal transaction actions', () => {
    expect(transactionSwipeActions({ name: '午饭' }).map((action) => action.key)).toEqual(['edit', 'delete'])
    expect(transactionSwipeActions({ name: '房租', source: 'bill', billingPeriodKey: '2026-09' }).map((action) => action.key)).toEqual(['undo-bill'])
    expect(transactionSwipeActions({ name: '网费', billId: 'bill-1', billingPeriodKey: '2026-09' }).map((action) => action.key)).toEqual(['undo-bill'])
    expect(transactionSwipeActions({ name: '历史记录', billingPeriodKey: '2026-09' }).map((action) => action.key)).toEqual(['edit', 'delete'])
  })

  it('recognizes legacy bill links even when source is not the canonical value', () => {
    expect(isBillPayment({ billId: 'bill-1', billingPeriodKey: '2026-09', source: 'manual' })).toBe(true)
    expect(isBillPayment({ sourceType: 'bill', sourceId: 'bill-1', billingPeriodKey: '2026-09' })).toBe(true)
    expect(isBillPayment({ relationId: 'bill:bill-1', billingPeriodKey: '2026-09' })).toBe(true)
  })

  it('releases vertical gestures to scrolling', async () => {
    const mounted = mountItem()
    await nextTick()
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 90, y: 125 })
    await nextTick()
    expect(mounted.openState.value).toBe(false)
    expect(mounted.events.swipes).toEqual([])
    expect(mounted.content().style.transform).toBe('')
  })

  it('ignores edge-start and mouse gestures', async () => {
    const mounted = mountItem()
    await nextTick()
    swipe(mounted.content(), { x: 10, y: 100 }, { x: 0, y: 101 })
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 20, y: 101 }, 'mouse')
    await nextTick()
    expect(mounted.openState.value).toBe(false)
    expect(mounted.events.swipes).toEqual([])
  })

  it('does not open for a short left swipe', async () => {
    const mounted = mountItem()
    await nextTick()
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 80, y: 101 })
    await nextTick()
    expect(mounted.openState.value).toBe(false)
    expect(mounted.events.swipes).toEqual([])
  })

  it('opens on a left swipe and exposes accessible actions at a capped distance', async () => {
    const mounted = mountItem()
    await nextTick()
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 20, y: 101 })
    await nextTick()
    expect(mounted.openState.value).toBe(true)
    expect(mounted.events.swipes).toEqual(['left'])
    expect(mounted.content().style.transform).toBe('translate3d(-140px,0,0)')
    expect([...host.querySelectorAll('.swipe-action')].map((button) => button.textContent)).toEqual(['编辑', '删除'])
    expect(host.querySelector('[aria-label="编辑 牛肉面"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="删除 牛肉面"]')).not.toBeNull()
  })

  it('closes an expanded row when swiped back to the right', async () => {
    const mounted = mountItem({ open: true })
    await nextTick()
    expect(mounted.content().style.transform).toBe('translate3d(-140px,0,0)')
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 180, y: 101 })
    await nextTick()
    expect(mounted.openState.value).toBe(false)
    expect(mounted.content().style.transform).toBe('translate3d(0px,0,0)')
  })

  it('keeps only one stable-id row open at a time', async () => {
    const mounted = mountPair()
    await nextTick()
    swipe(mounted.contents()[0], { x: 100, y: 100 }, { x: 20, y: 101 })
    await nextTick()
    expect(mounted.openId.value).toBe('tx-a')
    expect(mounted.contents()[0].style.transform).toBe('translate3d(-140px,0,0)')
    swipe(mounted.contents()[1], { x: 100, y: 100 }, { x: 20, y: 101 })
    await nextTick()
    expect(mounted.openId.value).toBe('tx-b')
    expect(mounted.contents()[0].style.transform).toBe('translate3d(0px,0,0)')
    expect(mounted.contents()[1].style.transform).toBe('translate3d(-140px,0,0)')
  })

  it('closes on a normal tap while expanded without activating the row', async () => {
    const mounted = mountItem({ open: true })
    await nextTick()
    mounted.content().querySelector('.row-content').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(mounted.openState.value).toBe(false)
  })

  it('emits an explicit action and closes before the action is handled', async () => {
    const mounted = mountItem()
    await nextTick()
    swipe(mounted.content(), { x: 100, y: 100 }, { x: 20, y: 101 })
    await nextTick()
    host.querySelector('[aria-label="删除 牛肉面"]').click()
    await nextTick()
    expect(mounted.events.actions).toEqual(['delete'])
    expect(mounted.openState.value).toBe(false)
  })
})
