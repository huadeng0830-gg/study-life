import { describe, expect, it } from 'vitest'
import {
  clampSheetHeight,
  dragVelocity,
  pushDragSample,
  resolveSheetRelease,
  sheetDetentHeights,
} from '../src/composables/sheetDrag.js'

describe('拖拽采样', () => {
  it('只保留最近若干个采样点', () => {
    const samples = []
    for (let index = 0; index < 10; index += 1) pushDragSample(samples, index * 10, index * 16)
    expect(samples.length).toBe(6)
    expect(samples[samples.length - 1].y).toBe(90)
  })

  it('按首尾两点估算速度，向下为正', () => {
    const down = [{ y: 100, t: 0 }, { y: 160, t: 100 }]
    expect(dragVelocity(down)).toBeCloseTo(0.6, 6)
    const up = [{ y: 200, t: 0 }, { y: 100, t: 100 }]
    expect(dragVelocity(up)).toBeCloseTo(-1, 6)
  })

  it('样本不足或时间差为零时速度为 0', () => {
    expect(dragVelocity([])).toBe(0)
    expect(dragVelocity([{ y: 10, t: 0 }])).toBe(0)
    expect(dragVelocity([{ y: 10, t: 50 }, { y: 90, t: 50 }])).toBe(0)
    expect(dragVelocity(null)).toBe(0)
  })

  it('只统计最近 100ms 的采样，不被更早的慢速段稀释', () => {
    // 先慢后快：整段平均只有 0.22 px/ms，最近 100ms 内是 0.8 px/ms。
    const samples = [
      { y: 0, t: 0 },
      { y: 60, t: 900 },
      { y: 100, t: 950 },
      { y: 180, t: 1050 },
    ]
    expect(dragVelocity(samples)).toBeCloseTo(0.8, 6)
    // 旧口径（首尾两点）会得到 180/1050 ≈ 0.171，低于下甩阈值，松手不吸附。
    expect(dragVelocity(samples)).toBeGreaterThan(0.55)
  })

  it('窗口内只剩一个采样点时退回倒数第二个点，而不是判成静止', () => {
    const samples = [{ y: 100, t: 0 }, { y: 200, t: 1000 }]
    expect(dragVelocity(samples)).toBeCloseTo(0.1, 6)
    expect(dragVelocity(samples)).not.toBe(0)
  })

  it('甩完停住再松手不算甩动', () => {
    const samples = [{ y: 100, t: 0 }, { y: 400, t: 100 }]
    // 松手时刻紧跟最后一次移动：是一次真实的快速下甩。
    expect(dragVelocity(samples, 110)).toBeCloseTo(3, 6)
    // 松手时刻比最后一次移动晚了 400ms：用户已经停住，按静止处理，
    // 交给吸附规则决定停在哪一档，而不是直接关掉抽屉。
    expect(dragVelocity(samples, 500)).toBe(0)
    // 不传释放时刻时保持旧行为（只有动画帧驱动时才可能走到）。
    expect(dragVelocity(samples)).toBeCloseTo(3, 6)
  })
})

describe('clampSheetHeight', () => {
  it('把高度夹在上下限之间', () => {
    expect(clampSheetHeight(50, 72, 700)).toBe(72)
    expect(clampSheetHeight(900, 72, 700)).toBe(700)
    expect(clampSheetHeight(300, 72, 700)).toBe(300)
  })

  it('容忍脏输入', () => {
    expect(clampSheetHeight(undefined, 72, 700)).toBe(72)
    expect(clampSheetHeight('abc', 72, 700)).toBe(72)
    // 上限小于下限时退回下限，不会产生负高度
    expect(clampSheetHeight(400, 300, 100)).toBe(300)
  })
})

describe('sheetDetentHeights', () => {
  it('按视口高度换算两档像素', () => {
    expect(sheetDetentHeights(800, 0.5, 0.92)).toEqual({ peek: 400, expand: 736 })
  })

  it('摘要档有最小高度，展开档不小于摘要档', () => {
    const tiny = sheetDetentHeights(200, 0.5, 0.92)
    expect(tiny.peek).toBe(180)
    expect(tiny.expand).toBeGreaterThanOrEqual(tiny.peek)
    expect(sheetDetentHeights(800, 0.9, 0.3).expand).toBeGreaterThanOrEqual(sheetDetentHeights(800, 0.9, 0.3).peek)
  })
})

describe('resolveSheetRelease 松手吸附', () => {
  const base = { peekHeight: 400, expandHeight: 720 }

  it('在摘要档快速下甩 → 关闭', () => {
    expect(resolveSheetRelease({ ...base, height: 380, velocity: 0.9 })).toEqual({ state: 'close', height: 0 })
  })

  it('在展开档快速下甩 → 退回摘要档，而不是直接关掉', () => {
    expect(resolveSheetRelease({ ...base, height: 700, velocity: 0.9 })).toEqual({ state: 'peek', height: 400 })
  })

  it('快速上甩 → 直接展开', () => {
    expect(resolveSheetRelease({ ...base, height: 420, velocity: -0.8 })).toEqual({ state: 'expand', height: 720 })
  })

  it('缓慢下拖过阈值 → 下拖收回', () => {
    // 400 * 0.7 = 280，拖到 200 已过阈值
    expect(resolveSheetRelease({ ...base, height: 200, velocity: 0.1 })).toEqual({ state: 'close', height: 0 })
  })

  it('缓慢下拖未过阈值 → 回到摘要档', () => {
    expect(resolveSheetRelease({ ...base, height: 340, velocity: 0.1 })).toEqual({ state: 'peek', height: 400 })
  })

  it('缓慢松手按中点吸附到更近的一档', () => {
    expect(resolveSheetRelease({ ...base, height: 600, velocity: 0 }).state).toBe('expand')
    expect(resolveSheetRelease({ ...base, height: 410, velocity: 0 }).state).toBe('peek')
  })

  it('超过展开档的高度也只会停到展开档', () => {
    expect(resolveSheetRelease({ ...base, height: 2000, velocity: 0 })).toEqual({ state: 'expand', height: 720 })
  })

  /**
   * closeRatio 这个调节旋钮此前是死的：sheetDrag 支持它，但没有任何调用方传进来，
   * 也没有任何测试碰过它。Modal 现在把它做成了 prop 并转发，所以这里把行为锁住，
   * 免得它再次变成一个「写了但没人走」的分支。
   */
  describe('closeRatio 调节关闭阈值', () => {
    it('阈值调低后，同样的拖拽距离不再判为关闭', () => {
      // 400 * 0.7 = 280：高度 260 已过默认阈值，会关闭。
      expect(resolveSheetRelease({ ...base, height: 260, velocity: 0.1 }).state).toBe('close')
      // 阈值降到 0.5 后是 200，260 还在阈值之上，于是回到摘要档。
      expect(resolveSheetRelease({ ...base, height: 260, velocity: 0.1, closeRatio: 0.5 }).state).toBe('peek')
    })

    it('阈值调高后，更短的拖拽距离就判定关闭', () => {
      expect(resolveSheetRelease({ ...base, height: 340, velocity: 0.1 }).state).toBe('peek')
      expect(resolveSheetRelease({ ...base, height: 340, velocity: 0.1, closeRatio: 0.9 }).state).toBe('close')
    })

    it('脏阈值退回默认，越界阈值被夹在 0~1', () => {
      // NaN / 非数字 / 缺省 / 0 都退回 0.7 —— 注意 0 是 falsy，会被 `|| 0.7` 吃掉，
      // 所以「传 0」得到的是默认手感而不是「一碰就关」。
      for (const bad of [undefined, null, NaN, 'abc', 0]) {
        expect(resolveSheetRelease({ ...base, height: 200, velocity: 0.1, closeRatio: bad }).state).toBe('close')
        expect(resolveSheetRelease({ ...base, height: 340, velocity: 0.1, closeRatio: bad }).state).toBe('peek')
      }
      // 大于 1 被夹到 1：阈值等于摘要档高度，只要低于摘要档就关闭（比默认更容易关）。
      expect(resolveSheetRelease({ ...base, height: 200, velocity: 0.1, closeRatio: 5 }).state).toBe('close')
      // 负数被夹到 0：阈值变成 0，下拖的距离永远不足以触发关闭，
      // 只能靠快速下甩（velocity 分支）收起。
      expect(resolveSheetRelease({ ...base, height: 200, velocity: 0.1, closeRatio: -1 }).state).toBe('peek')
    })
  })
})