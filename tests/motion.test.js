// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOTION,
  animationsEnabled,
  canCircularReveal,
  farthestCornerRadius,
  originFromEvent,
  revealChange,
} from '../src/composables/motion.js'
import { performanceMode } from '../src/composables/performanceMode.js'

const originalStartViewTransition = document.startViewTransition
const originalAnimate = document.documentElement.animate
const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

function installViewTransition() {
  const animate = vi.fn()
  document.documentElement.animate = animate
  const startViewTransition = vi.fn((callback) => {
    const applied = callback()
    return {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(applied),
      finished: Promise.resolve(),
      skipTransition: () => {},
    }
  })
  document.startViewTransition = startViewTransition
  return { animate, startViewTransition }
}

function flush() {
  return new Promise((resolve) => { window.setTimeout(resolve, 0) })
}

afterEach(() => {
  performanceMode.value = 'auto'
  setViewport(originalInnerWidth, originalInnerHeight)
  if (originalStartViewTransition === undefined) delete document.startViewTransition
  else document.startViewTransition = originalStartViewTransition
  if (originalAnimate === undefined) delete document.documentElement.animate
  else document.documentElement.animate = originalAnimate
  delete document.documentElement.dataset.themeReveal
  document.documentElement.style.removeProperty('--reveal-origin')
})

describe('动效 token', () => {
  it('与 style.css 的时长/缓动保持同一套取值', () => {
    expect(MOTION.reveal).toBe(420)
    expect(MOTION.base).toBe(220)
    expect(MOTION.easeStandard).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
  })

  it('流畅优先开启时关闭动效', () => {
    performanceMode.value = 'off'
    expect(animationsEnabled()).toBe(true)
    performanceMode.value = 'on'
    expect(animationsEnabled()).toBe(false)
  })
})

describe('farthestCornerRadius', () => {
  it('取原点到最远角落的距离', () => {
    // 左上角触点：最远角落是右下角
    expect(farthestCornerRadius(0, 0, 100, 100)).toBeCloseTo(Math.hypot(100, 100), 6)
    // 正中心：四个角落等距
    expect(farthestCornerRadius(50, 50, 100, 100)).toBeCloseTo(Math.hypot(50, 50), 6)
    // 右下角触点：最远角落是左上角
    expect(farthestCornerRadius(100, 100, 100, 100)).toBeCloseTo(Math.hypot(100, 100), 6)
    // 窄高屏：横向距离主导
    expect(farthestCornerRadius(10, 400, 390, 800)).toBeCloseTo(Math.hypot(380, 400), 6)
  })

  it('把超出视口的原点夹回边界，脏坐标按 0 处理', () => {
    expect(farthestCornerRadius(500, 500, 100, 100)).toBeCloseTo(Math.hypot(100, 100), 6)
    expect(farthestCornerRadius(-20, -20, 100, 100)).toBeCloseTo(Math.hypot(100, 100), 6)
    // 纯函数不做「退回中心」的兜底，那是 originFromEvent 的职责；
    // 这里缺失坐标一律当作原点 (0,0)，因此最远角落是右下角。
    expect(farthestCornerRadius(undefined, undefined, 100, 100)).toBeCloseTo(Math.hypot(100, 100), 6)
  })
})

describe('originFromEvent', () => {
  it('优先使用触点坐标', () => {
    expect(originFromEvent({ clientX: 12, clientY: 34 })).toEqual({ x: 12, y: 34 })
  })

  it('键盘触发没有坐标时退回元素中心', () => {
    const element = document.createElement('button')
    element.getBoundingClientRect = () => ({ left: 100, top: 200, width: 40, height: 20, right: 140, bottom: 220 })
    expect(originFromEvent({ clientX: 0, clientY: 0, detail: 0 }, element)).toEqual({ x: 120, y: 210 })
  })

  it('既没有坐标也没有元素时退回视口中心', () => {
    setViewport(800, 600)
    expect(originFromEvent({}, null)).toEqual({ x: 400, y: 300 })
  })
})

describe('revealChange 圆形扩散', () => {
  it('支持 View Transitions 时按最远角落半径扩散', async () => {
    setViewport(400, 800)
    const { animate, startViewTransition } = installViewTransition()
    const apply = vi.fn()

    const revealed = revealChange(apply, { x: 30, y: 60 })

    expect(revealed).toBe(true)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(startViewTransition).toHaveBeenCalledTimes(1)
    // 动画开始前先给新快照一个 0 半径裁切，避免闪一帧完整页面
    expect(document.documentElement.dataset.themeReveal).toBe('1')
    expect(document.documentElement.style.getPropertyValue('--reveal-origin')).toBe('30px 60px')

    await flush()

    expect(animate).toHaveBeenCalledTimes(1)
    const [keyframes, options] = animate.mock.calls[0]
    const expectedRadius = farthestCornerRadius(30, 60, 400, 800)
    expect(keyframes.clipPath[0]).toBe('circle(0px at 30px 60px)')
    expect(keyframes.clipPath[1]).toBe(`circle(${expectedRadius}px at 30px 60px)`)
    expect(options.pseudoElement).toBe('::view-transition-new(root)')
    expect(options.duration).toBe(MOTION.reveal)
    expect(options.fill).toBe('forwards')
    // 结束后必须摘掉标记，否则新快照会一直停在 0 半径
    expect(document.documentElement.dataset.themeReveal).toBeUndefined()
    expect(document.documentElement.style.getPropertyValue('--reveal-origin')).toBe('')
  })

  it('浏览器不支持 View Transitions 时同步应用变更（行为与改造前一致）', () => {
    delete document.startViewTransition
    const apply = vi.fn()
    expect(canCircularReveal()).toBe(false)
    expect(revealChange(apply, { x: 1, y: 2 })).toBe(false)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.themeReveal).toBeUndefined()
  })

  it('开启流畅优先时跳过扩散，直接应用', () => {
    installViewTransition()
    performanceMode.value = 'on'
    const apply = vi.fn()
    expect(canCircularReveal()).toBe(false)
    expect(revealChange(apply, { x: 1, y: 2 })).toBe(false)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('startViewTransition 抛错时回退为直接应用，不留下裁切标记', () => {
    document.documentElement.animate = vi.fn()
    document.startViewTransition = vi.fn(() => { throw new Error('unsupported') })
    const apply = vi.fn()

    expect(revealChange(apply, { x: 5, y: 5 })).toBe(false)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.themeReveal).toBeUndefined()
  })

  it('缺少 apply 函数时安全返回 false', () => {
    expect(revealChange(null, { x: 0, y: 0 })).toBe(false)
  })
})