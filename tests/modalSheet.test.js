// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import Modal from '../src/components/Modal.vue'

const mountedApps = []
const originalMatchMedia = window.matchMedia
const originalVisualViewport = window.visualViewport
const originalInnerHeight = window.innerHeight

/** 只让 max-width 查询命中窄屏，其余（如 prefers-reduced-motion）保持 false。 */
function stubNarrowViewport(narrow = true) {
  window.matchMedia = (query) => ({
    matches: narrow && String(query).includes('max-width'),
    media: String(query),
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

function mount(render) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render })
  app.mount(root)
  mountedApps.push({ app, root })
}

function dispatchPointer(target, type, x, y, timeStamp = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'touch' },
    clientX: { value: x },
    clientY: { value: y },
    timeStamp: { value: timeStamp },
  })
  target.dispatchEvent(event)
}

function drag(grabber, points) {
  dispatchPointer(grabber, 'pointerdown', 0, points[0].y, points[0].t)
  for (const point of points.slice(1)) dispatchPointer(grabber, 'pointermove', 0, point.y, point.t)
  const last = points[points.length - 1]
  dispatchPointer(grabber, 'pointerup', 0, last.y, last.t)
}

beforeEach(() => {
  stubNarrowViewport(true)
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  if (originalVisualViewport === undefined) delete window.visualViewport
})

afterEach(() => {
  for (const { app, root } of mountedApps.splice(0)) {
    app.unmount()
    root.remove()
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  if (originalMatchMedia === undefined) delete window.matchMedia
  else window.matchMedia = originalMatchMedia
  if (originalVisualViewport === undefined) delete window.visualViewport
  else Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalVisualViewport })
})

describe('Modal 底部抽屉', () => {
  it('未开启 sheet 时不渲染把手，行为与改造前一致', async () => {
    mount(() => h(Modal, { open: true, title: '普通弹窗' }))
    await nextTick()
    expect(document.querySelector('.sheet-grabber')).toBeNull()
    expect(document.querySelector('.sheet-toggle')).toBeNull()
    expect(document.querySelector('.modal').classList.contains('sheet')).toBe(false)
    expect(document.querySelector('.modal').style.height).toBe('')
  })

  it('开启 sheet 时从摘要档打开，并给出把手与键盘入口', async () => {
    mount(() => h(Modal, { open: true, title: '抽屉', sheet: true, sheetDetents: [0.5, 0.92] }))
    await nextTick()
    await nextTick()

    const modal = document.querySelector('.modal')
    expect(modal.classList.contains('sheet')).toBe(true)
    expect(document.querySelector('.sheet-grabber')).not.toBeNull()
    // 800 * 0.5 = 400
    expect(modal.style.height).toBe('400px')
    const toggle = document.querySelector('.sheet-toggle')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('上拖后松手吸附到展开档，下拖快速松手退回摘要档', async () => {
    mount(() => h(Modal, { open: true, title: '抽屉', sheet: true, sheetDetents: [0.5, 0.92] }))
    await nextTick()
    await nextTick()
    const modal = document.querySelector('.modal')
    const grabber = document.querySelector('.sheet-grabber')

    // 缓慢上拖 200px 到 600px（超过 400/720 的中点 560）→ 吸附展开档
    drag(grabber, [{ y: 400, t: 0 }, { y: 200, t: 1000 }])
    await nextTick()
    expect(modal.style.height).toBe('736px')
    expect(document.querySelector('.sheet-toggle').getAttribute('aria-expanded')).toBe('true')

    // 在展开档快速下甩 30px → 退回摘要档（而不是关闭）
    drag(grabber, [{ y: 100, t: 0 }, { y: 130, t: 20 }])
    await nextTick()
    expect(modal.style.height).toBe('400px')
    expect(modal.classList.contains('sheet')).toBe(true)
  })

  it('在摘要档快速下甩会收起抽屉', async () => {
    const onClose = vi.fn()
    const open = ref(true)
    mount(() => h(Modal, {
      open: open.value,
      title: '抽屉',
      sheet: true,
      sheetDetents: [0.5, 0.92],
      onClose: () => { onClose(); open.value = false },
    }))
    await nextTick()
    await nextTick()

    drag(document.querySelector('.sheet-grabber'), [{ y: 300, t: 0 }, { y: 330, t: 20 }])
    await nextTick()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('缓慢下拖过阈值也会收起，未过阈值则回到摘要档', async () => {
    const open = ref(true)
    mount(() => h(Modal, {
      open: open.value,
      title: '抽屉',
      sheet: true,
      sheetDetents: [0.5, 0.92],
      onClose: () => { open.value = false },
    }))
    await nextTick()
    await nextTick()
    const modal = document.querySelector('.modal')

    // 缓慢下拖 60px（400 → 340），未过 400*0.7=280 的阈值 → 回摘要档
    drag(document.querySelector('.sheet-grabber'), [{ y: 100, t: 0 }, { y: 160, t: 1000 }])
    await nextTick()
    expect(modal.style.height).toBe('400px')
    expect(document.querySelector('.modal')).not.toBeNull()

    // 缓慢下拖 300px（400 → 100），已过阈值 → 关闭
    drag(document.querySelector('.sheet-grabber'), [{ y: 100, t: 2000 }, { y: 400, t: 3000 }])
    await nextTick()
    expect(document.querySelector('.modal')).toBeNull()
  })

  it('closeRatio 能调整关闭阈值（此前这个旋钮没有任何调用方）', async () => {
    // 同样的拖拽（400 → 260）在两套阈值下结果相反：默认 0.7 的阈值是
    // 400*0.7 = 280，260 已过阈值 → 关闭；把 closeRatio 调成 0.5 后阈值是 200，
    // 260 还在阈值之上 → 回到摘要档。这条测试证明 Modal 真的把 prop 转发给了
    // sheetDrag，而不是只声明了一个没人读的属性。
    const closedByDefault = ref(true)
    mount(() => h(Modal, {
      open: closedByDefault.value,
      title: '抽屉',
      sheet: true,
      sheetDetents: [0.5, 0.92],
      onClose: () => { closedByDefault.value = false },
    }))
    await nextTick()
    await nextTick()
    drag(document.querySelector('.sheet-grabber'), [{ y: 100, t: 0 }, { y: 240, t: 1000 }])
    await nextTick()
    expect(document.querySelector('.modal')).toBeNull()

    const keptWithLowRatio = ref(true)
    mount(() => h(Modal, {
      open: keptWithLowRatio.value,
      title: '抽屉',
      sheet: true,
      sheetDetents: [0.5, 0.92],
      closeRatio: 0.5,
      onClose: () => { keptWithLowRatio.value = false },
    }))
    await nextTick()
    await nextTick()
    const modal = document.querySelector('.modal')
    drag(document.querySelector('.sheet-grabber'), [{ y: 100, t: 0 }, { y: 240, t: 1000 }])
    await nextTick()
    expect(modal.style.height).toBe('400px')
    expect(document.querySelector('.modal')).not.toBeNull()
  })

  it('键盘/读屏用户可以用「展开」按钮切换档位', async () => {
    mount(() => h(Modal, { open: true, title: '抽屉', sheet: true, sheetDetents: [0.5, 0.92] }))
    await nextTick()
    await nextTick()
    const modal = document.querySelector('.modal')
    const toggle = document.querySelector('.sheet-toggle')

    expect(modal.style.height).toBe('400px')
    toggle.click()
    await nextTick()
    expect(modal.style.height).toBe('736px')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    toggle.click()
    await nextTick()
    expect(modal.style.height).toBe('400px')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('桌面宽度下即使开启 sheet 也保持普通弹窗', async () => {
    stubNarrowViewport(false)
    mount(() => h(Modal, { open: true, title: '抽屉', sheet: true }))
    await nextTick()
    await nextTick()
    expect(document.querySelector('.sheet-grabber')).toBeNull()
    expect(document.querySelector('.modal').style.height).toBe('')
  })
})