/**
 * 右侧抽屉的右划关闭判定（纯函数）。
 *
 * 【几何】面板**右锚定**（`right:0`），打开态 `translateX(0)`，藏起来往右（`+102%`），
 * 所以关闭手势也是向右：跟手方向 == 出场方向。下面每组判据都对着这条几何。
 *
 * 【为什么要把数学单独拿出来测】抽屉的**手感**在 happy-dom 里根本测不了——
 * 那里 `getBoundingClientRect()` 全 0、也不注入组件 CSS。所以判定必须只吃
 * `clientX` 差值、采样时间和常量（见 src/composables/drawerDrag.js 的文件头），
 * 而"要不要关"这件事就落在这一组纯函数上：位移不足不关、足够关、纵向手势不关、
 * 鼠标不参与。组件侧只负责取坐标、写内联 style 与调用它们
 * （集成层见 tests/sidebarDrawer.test.js）。
 */
import { describe, expect, it } from 'vitest'
import {
  DRAWER_CLOSE_RATIO,
  DRAWER_EXIT_SHIFT,
  DRAWER_WIDTH_MAX,
  drawerDirectionsAgree,
  drawerDragOffset,
  drawerVelocity,
  drawerWidth,
  isDrawerEdgeGuard,
  isDrawerGesturePointer,
  pushDrawerSample,
  resolveDrawerAxis,
  resolveDrawerRelease,
} from '../src/composables/drawerDrag.js'

describe('drawerWidth：与 CSS 的 min(86vw, 320px) 同源', () => {
  it('宽屏取上限，窄屏按 86vw 收缩', () => {
    expect(drawerWidth(1024)).toBe(DRAWER_WIDTH_MAX)
    expect(drawerWidth(375)).toBe(DRAWER_WIDTH_MAX)
    // 320 / 0.86 ≈ 372.09，比它窄的视口才会跟着缩
    expect(drawerWidth(320)).toBeCloseTo(275.2, 6)
    expect(drawerWidth(280)).toBeCloseTo(240.8, 6)
  })

  it('容忍脏输入（拿不到视口宽度时用上限，绝不返回 0）', () => {
    expect(drawerWidth(0)).toBe(DRAWER_WIDTH_MAX)
    expect(drawerWidth(-100)).toBe(DRAWER_WIDTH_MAX)
    expect(drawerWidth(undefined)).toBe(DRAWER_WIDTH_MAX)
    expect(drawerWidth('nonsense')).toBe(DRAWER_WIDTH_MAX)
  })
})

describe('起手守卫', () => {
  // 视口 375：守卫区是右缘 18px，即 clientX >= 357
  it('贴右缘起手让给系统的边缘/返回手势（面板右锚，守卫跟着面板走）', () => {
    expect(isDrawerEdgeGuard(374, 375)).toBe(true)
    expect(isDrawerEdgeGuard(357, 375)).toBe(true)
    expect(isDrawerEdgeGuard(356, 375)).toBe(false)
    expect(isDrawerEdgeGuard(200, 375)).toBe(false)
    // 同一坐标在更宽的视口上就不再贴边了：守卫是按视口算的，不是按面板算的
    expect(isDrawerEdgeGuard(357, 600)).toBe(false)
  })

  it('拿不到坐标或视口宽度（合成事件没带 clientX）也不起手', () => {
    expect(isDrawerEdgeGuard(undefined, 375)).toBe(true)
    expect(isDrawerEdgeGuard(Number.NaN, 375)).toBe(true)
    expect(isDrawerEdgeGuard(200, undefined)).toBe(true)
    expect(isDrawerEdgeGuard(200, 0)).toBe(true)
    expect(isDrawerEdgeGuard(200, Number.NaN)).toBe(true)
  })

  it('鼠标不参与滑动，触摸与手写笔参与', () => {
    expect(isDrawerGesturePointer('mouse')).toBe(false)
    expect(isDrawerGesturePointer('touch')).toBe(true)
    expect(isDrawerGesturePointer('pen')).toBe(true)
  })
})

/**
 * 这条不变量就是这次返工的起因：面板左锚时"跟手向右、出场向左"，
 * 松手瞬间面板朝手指的反方向飞出去。所以它必须是一条**能红的断言**，
 * 而不是靠人看一眼代码。
 */
describe('跟手方向必须与出场方向一致', () => {
  it('关闭方向的跟手位移与出场位移同号（都为正）', () => {
    const offset = drawerDragOffset(120, DRAWER_WIDTH_MAX)
    expect(offset).toBeGreaterThan(0)
    expect(DRAWER_EXIT_SHIFT).toBeGreaterThan(0)
    expect(drawerDirectionsAgree(offset)).toBe(true)
  })

  it('判别力自证：把出场符号改反，这条不变量立刻为假', () => {
    // 这正是改造前的错误几何：跟手向右(+)，出场向左(-)
    expect(drawerDirectionsAgree(120, -DRAWER_EXIT_SHIFT)).toBe(false)
    // 反向也对称：跟手向左、出场向右
    expect(drawerDirectionsAgree(-120, DRAWER_EXIT_SHIFT)).toBe(false)
    // 零位移（点击 / 没动就松手）不算矛盾
    expect(drawerDirectionsAgree(0)).toBe(true)
  })
})

describe('resolveDrawerAxis：方向锁', () => {
  it('两轴都不到阈值时先不判方向', () => {
    expect(resolveDrawerAxis(3, 4)).toBe('pending')
    expect(resolveDrawerAxis(-9, 9)).toBe('pending')
    expect(resolveDrawerAxis(0, 0)).toBe('pending')
  })

  it('横划跟手、纵向交还给滚动', () => {
    expect(resolveDrawerAxis(30, 5)).toBe('horizontal')
    expect(resolveDrawerAxis(5, 30)).toBe('vertical')
    // 斜向（|dy| >= |dx|）一律算纵向：宁可漏关一次，也不要在用户想滚动时把抽屉划走
    expect(resolveDrawerAxis(24, 24)).toBe('vertical')
    expect(resolveDrawerAxis(40, 60)).toBe('vertical')
  })
})

describe('drawerDragOffset：只跟随关闭方向', () => {
  it('右划跟手，且不超过抽屉宽度', () => {
    expect(drawerDragOffset(60, 320)).toBe(60)
    expect(drawerDragOffset(400, 320)).toBe(320)
  })

  it('反向（往左）不跟手：面板右锚，往左拖是把它往屏幕里推，越推越开', () => {
    expect(drawerDragOffset(-80, 320)).toBe(0)
    expect(drawerDragOffset(0, 320)).toBe(0)
  })

  it('宽度拿不到时退化为 1px 上限而不是除零/NaN', () => {
    expect(drawerDragOffset(50, 0)).toBe(1)
    expect(Number.isFinite(drawerDragOffset(50, undefined))).toBe(true)
  })
})

describe('释放速度', () => {
  it('只保留最近若干个采样点', () => {
    const samples = []
    for (let index = 0; index < 10; index += 1) pushDrawerSample(samples, index * 10, index * 16)
    expect(samples.length).toBe(6)
    expect(samples[samples.length - 1].x).toBe(90)
  })

  it('按首尾两点估算速度，向右为正（关闭方向）', () => {
    expect(drawerVelocity([{ x: 100, t: 0 }, { x: 160, t: 100 }])).toBeCloseTo(0.6, 6)
    expect(drawerVelocity([{ x: 200, t: 0 }, { x: 100, t: 100 }])).toBeCloseTo(-1, 6)
  })

  it('样本不足或时间差为零时速度为 0', () => {
    expect(drawerVelocity([])).toBe(0)
    expect(drawerVelocity(null)).toBe(0)
    expect(drawerVelocity([{ x: 10, t: 0 }])).toBe(0)
    expect(drawerVelocity([{ x: 10, t: 50 }, { x: 90, t: 50 }])).toBe(0)
  })

  it('只统计最近 100ms，不被更早的慢速段稀释', () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 60, t: 900 },
      { x: 100, t: 950 },
      { x: 180, t: 1050 },
    ]
    expect(drawerVelocity(samples)).toBeCloseTo(0.8, 6)
  })

  it('甩完停住再松手不算甩动', () => {
    const samples = [{ x: 100, t: 0 }, { x: 400, t: 100 }]
    expect(drawerVelocity(samples, 110)).toBeCloseTo(3, 6)
    // 松手比最后一次移动晚了 400ms：用户已经停住，按静止处理
    expect(drawerVelocity(samples, 500)).toBe(0)
  })
})

describe('resolveDrawerRelease：位移不足不关、位移足够关', () => {
  const width = DRAWER_WIDTH_MAX

  it('位移足够 → 关闭；吸附到抽屉宽度', () => {
    const decision = resolveDrawerRelease({ dx: 180, width })
    expect(decision.close).toBe(true)
    expect(decision.offset).toBe(width)
    expect(decision.reason).toBe('distance')
  })

  it('位移不足 → 回弹开位', () => {
    const decision = resolveDrawerRelease({ dx: 40, width })
    expect(decision.close).toBe(false)
    expect(decision.offset).toBe(0)
    expect(decision.reason).toBe('none')
  })

  it('左划（反向）永远不关', () => {
    expect(resolveDrawerRelease({ dx: -300, width }).close).toBe(false)
    expect(resolveDrawerRelease({ dx: -300, velocity: -3, width }).close).toBe(false)
  })

  it('关闭方向的快速甩动哪怕位移很小也关', () => {
    // 30px 远不到 320 * 0.32 = 102.4px 的位移阈值，但 2 px/ms 是一次明确的甩动
    const decision = resolveDrawerRelease({ dx: 30, velocity: 2, width })
    expect(decision.close).toBe(true)
    expect(decision.reason).toBe('fling')
  })

  it('两个方向的速度阈值写反了就关错了（反向甩动不能关）', () => {
    expect(resolveDrawerRelease({ dx: 30, velocity: -2, width }).close).toBe(false)
  })

  it('速度阈值写成 0 不会把每次松手都判成关闭', () => {
    expect(resolveDrawerRelease({ dx: 0, velocity: 0, width, flingVelocity: 0 }).close).toBe(false)
  })
})

/**
 * 判别力自证：证明"位移不足不关"这条不是空断言。
 * 空断言（恒 true / 恒 false）也能让上面那条绿，所以这里必须把**两侧**并排跑一次，
 * 并断言它们的结论确实不同——判定烂掉时这一条会先红。
 */
describe('判定的判别力自证（不是空断言）', () => {
  const width = DRAWER_WIDTH_MAX

  it('同一段位移在阈值两侧给出相反结论', () => {
    const boundary = width * DRAWER_CLOSE_RATIO
    const under = resolveDrawerRelease({ dx: boundary - 1, width })
    const over = resolveDrawerRelease({ dx: boundary + 1, width })
    expect(under.close, '刚好不到阈值就该回弹').toBe(false)
    expect(over.close, '刚过阈值就该关闭').toBe(true)
  })

  it('并把两侧结论放在一起比：一样就说明判定没有判别力', () => {
    const big = resolveDrawerRelease({ dx: 200, width })
    const small = resolveDrawerRelease({ dx: 20, width })
    expect(big.close).not.toBe(small.close)
  })

  it('阈值不是常量折叠出来的假结论：换个宽度结论随之改变', () => {
    // 同一个 120px 位移：320px 宽的抽屉够不够？275px 的呢？
    expect(resolveDrawerRelease({ dx: 120, width: 320 }).close).toBe(true)
    expect(resolveDrawerRelease({ dx: 120, width: 1200 }).close).toBe(false)
  })
})