// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import ContextMenu from '../src/components/ContextMenu.vue'
import Modal from '../src/components/Modal.vue'
import { createLongPress } from '../src/composables/longPress.js'
import { pointMenuPlacement } from '../src/composables/menuPlacement.js'

const mountedApps = []
const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function mount(render) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render })
  app.mount(root)
  mountedApps.push({ app, root })
}

function pointerEvent(target, type, { x = 0, y = 0, pointerId = 1, pointerType = 'touch', button = 0 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
    button: { value: button },
  })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  vi.useRealTimers()
  for (const { app, root } of mountedApps.splice(0)) {
    app.unmount()
    root.remove()
  }
  setViewport(originalInnerWidth, originalInnerHeight)
})

describe('pointMenuPlacement', () => {
  const viewport = { width: 400, height: 800 }
  const menu = { width: 180, height: 200 }

  it('默认出现在触点右下方，不遮住手指', () => {
    expect(pointMenuPlacement({ x: 60, y: 100 }, menu, viewport))
      .toEqual({ left: 60, top: 100, flippedX: false, flippedY: false })
  })

  it('右侧放不下时向左翻', () => {
    const result = pointMenuPlacement({ x: 350, y: 100 }, menu, viewport)
    expect(result.flippedX).toBe(true)
    expect(result.left).toBe(170)
  })

  it('下方放不下时向上翻', () => {
    const result = pointMenuPlacement({ x: 60, y: 700 }, menu, viewport)
    expect(result.flippedY).toBe(true)
    expect(result.top).toBe(500)
  })

  it('两侧都放不下时夹回视口内', () => {
    const tiny = { width: 40, height: 30 }
    const result = pointMenuPlacement({ x: 20, y: 20 }, { width: 500, height: 900 }, tiny)
    expect(result.left).toBe(8)
    expect(result.top).toBe(8)
  })

  it('容忍脏输入', () => {
    const result = pointMenuPlacement({}, {}, viewport)
    expect(Number.isFinite(result.left)).toBe(true)
    expect(Number.isFinite(result.top)).toBe(true)
  })
})

describe('createLongPress', () => {
  beforeEach(() => { vi.useFakeTimers() })

  function down(handlers, options) {
    return pointerEvent(document.body, 'pointerdown', options)
      && handlers.onPointerDown({
        pointerType: options?.pointerType || 'touch',
        button: options?.button ?? 0,
        pointerId: options?.pointerId ?? 1,
        clientX: options?.x ?? 100,
        clientY: options?.y ?? 100,
        currentTarget: document.body,
      })
  }

  it('按住超过阈值后触发一次', () => {
    const onLongPress = vi.fn()
    const handlers = createLongPress({ duration: 480, onLongPress })
    down(handlers, { x: 120, y: 240 })
    vi.advanceTimersByTime(479)
    expect(onLongPress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress.mock.calls[0][0]).toMatchObject({ x: 120, y: 240 })
  })

  it('抬手过早就取消，不会触发', () => {
    const onLongPress = vi.fn()
    const handlers = createLongPress({ duration: 480, onLongPress })
    down(handlers, {})
    vi.advanceTimersByTime(200)
    handlers.onPointerUp({ pointerId: 1 })
    vi.advanceTimersByTime(1000)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('手指移动超出容差说明在滚动列表，取消长按', () => {
    const onLongPress = vi.fn()
    const handlers = createLongPress({ duration: 480, moveTolerance: 10, onLongPress })
    down(handlers, { x: 100, y: 100 })
    // 横向 30px，超出 10px 容差
    handlers.onPointerMove({ pointerId: 1, clientX: 130, clientY: 100 })
    vi.advanceTimersByTime(1000)
    expect(onLongPress).toHaveBeenCalledTimes(0)

    down(handlers, { x: 100, y: 100 })
    // 纵向 300px，说明用户在滚动列表
    handlers.onPointerMove({ pointerId: 1, clientX: 100, clientY: 400 })
    vi.advanceTimersByTime(1000)
    expect(onLongPress).toHaveBeenCalledTimes(0)
  })

  it('容差以内的轻微抖动仍然算长按', () => {
    const onLongPress = vi.fn()
    const handlers = createLongPress({ duration: 480, moveTolerance: 10, onLongPress })
    down(handlers, { x: 100, y: 100 })
    handlers.onPointerMove({ pointerId: 1, clientX: 103, clientY: 102 })
    vi.advanceTimersByTime(500)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('鼠标端不触发长按（桌面交给右键菜单）', () => {
    const onLongPress = vi.fn()
    const handlers = createLongPress({ duration: 480, onLongPress })
    handlers.onPointerDown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(1000)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('长按命中后吃掉紧接着的那次 click，避免顺带触发整行点击', () => {
    const handlers = createLongPress({ duration: 480, onLongPress: vi.fn() })
    down(handlers, {})
    vi.advanceTimersByTime(500)
    expect(handlers.shouldSuppressClick()).toBe(true)
    // 只吃一次
    expect(handlers.shouldSuppressClick()).toBe(false)
  })

  it('没发生长按时不吞点击', () => {
    const handlers = createLongPress({ duration: 480, onLongPress: vi.fn() })
    down(handlers, {})
    handlers.onPointerUp({ pointerId: 1 })
    expect(handlers.shouldSuppressClick()).toBe(false)
  })
})

describe('ContextMenu', () => {
  const items = [
    { key: 'pin', label: '置顶', icon: '📌' },
    { key: 'delete', label: '删除', tone: 'danger' },
  ]

  beforeEach(() => { setViewport(400, 800) })

  it('在触点附近渲染菜单项并聚焦面板', async () => {
    mount(() => h(ContextMenu, { open: true, x: 100, y: 160, title: '期末考', items }))
    await nextTick()
    await nextTick()

    const panel = document.querySelector('.context-menu')
    expect(panel).not.toBeNull()
    expect(panel.style.left).toBe('100px')
    expect(panel.style.top).toBe('160px')
    expect(panel.style.visibility).toBe('visible')
    expect([...panel.querySelectorAll('.context-menu-item')].map((button) => button.textContent.trim()))
      .toEqual(['📌置顶', '删除'])
    expect(document.querySelector('.context-menu-title').textContent).toBe('期末考')
  })

  it('选择菜单项时抛出 select，操作只针对这一条', async () => {
    const selected = []
    mount(() => h(ContextMenu, {
      open: true,
      x: 10,
      y: 10,
      items,
      onSelect: (item) => selected.push(item.key),
    }))
    await nextTick()
    document.querySelectorAll('.context-menu-item')[1].click()
    await nextTick()
    expect(selected).toEqual(['delete'])
  })

  it('Escape 关闭菜单', async () => {
    const onClose = vi.fn()
    mount(() => h(ContextMenu, { open: true, x: 10, y: 10, items, onClose }))
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击菜单外关闭，点击菜单内不关闭', async () => {
    const onClose = vi.fn()
    mount(() => h(ContextMenu, { open: true, x: 10, y: 10, items, onClose }))
    await nextTick()
    pointerEvent(document.querySelector('.context-menu-item'), 'pointerdown', {})
    await nextTick()
    expect(onClose).not.toHaveBeenCalled()

    pointerEvent(document.body, 'pointerdown', {})
    await nextTick()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('页面滚动时关闭菜单（菜单跟着触点，不跟着内容滚）', async () => {
    const onClose = vi.fn()
    mount(() => h(ContextMenu, { open: true, x: 10, y: 10, items, onClose }))
    await nextTick()
    window.dispatchEvent(new Event('scroll'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('菜单叠在弹窗之上时，Escape 只关菜单不关弹窗', async () => {
    const menuClose = vi.fn()
    const modalClose = vi.fn()
    const menuOpen = ref(true)
    mount(() => h('div', [
      h(Modal, { open: true, title: '编辑' }, { default: () => h('div', '表单') }),
      h(ContextMenu, { open: menuOpen.value, x: 10, y: 10, items, onClose: () => { menuClose(); menuOpen.value = false } }),
    ]))
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(menuClose).toHaveBeenCalledTimes(1)

    // 菜单关掉之后，Escape 才轮到下面的弹窗
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(modalClose).not.toHaveBeenCalled()
  })
})