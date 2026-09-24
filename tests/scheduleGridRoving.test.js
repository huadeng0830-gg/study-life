// @vitest-environment happy-dom
/**
 * 课程表桌面网格的 roving tabindex 守卫（第四十一轮）。
 *
 * 【为什么必须渲染后查】「整个网格恰好一个 Tab 停靠点」这个不变量，静态扫描看不见：
 * 模板里写的是 `:tabindex="isActiveCell(i, ri) ? 0 : -1"`，到底渲染出几个 0，
 * 只有挂载起来、把课程表真的渲染出来才知道。方向键能不能移动、回车是不是等价于点击，
 * 同样只有派发真实按键才谈得上验证。
 *
 * 【与既有守卫的分工】
 *   - `keyboardReachability.test.js` 静态守**模板形态**（role/tabindex/@keydown 三件套在不在、
 *     容器有没有 role="group"）；
 *   - `tabOrderAndNames.test.js` 守**页面级**不变量（无正数 tabindex、可交互元素不被排除），
 *     它的 roving 判据认 `role="group"` 这个组，所以本项目里的格子不会被误报；
 *   - 这个文件守**网格自己的行为**：一个停靠点、方向键移动并夹住边界、回车与点击等价。
 *
 * 【为什么容器是 role="group" 而不是 role="grid"】真正的 ARIA 网格需要 row/gridcell
 * 的完整结构，而这里是 CSS grid 排布 + 时间轴列混排，重构 DOM 的风险远大于收益。
 * 格子本身确实是「点一下添加课程」的按钮，所以格子用 role="button"，容器用
 * role="group" + aria-label 给出整块网格的名称。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { routes } from '../src/router/routes.js'
import { gotoRoute, mountApp, settle } from './helpers/mountApp.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

// 收尾取消影子副本的待写盘：否则防抖/退避定时器会在环境拆除之后才触发，
// 那一声没有归属的 console 会让 vitest 记成 `Errors 1 error`（用例全绿也 exit 1）。
registerMirrorTeardown()

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(() => vi.fn()) }))

const SCHEDULE_PATH = routes.find((record) => record.name === 'schedule')?.path ?? '/schedule'

let mounted = null

beforeEach(() => {
  mounted = null
})

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.querySelectorAll('.overlay').forEach((element) => element.remove())
  clearAnnouncement()
})

/** 当前作为 Tab 停靠点的那一格。 */
const activeTabStop = () => document.querySelector('.tt-cell[tabindex="0"]')
const cells = () => [...document.querySelectorAll('.tt-cell')]
/** `data-cell="天-节"` → [天, 节]。 */
const cellCoords = (cell) => (cell?.getAttribute('data-cell') ?? '').split('-').map(Number)

async function openSchedule() {
  mounted = await mountApp({ routes })
  const main = await gotoRoute(mounted, SCHEDULE_PATH)
  expect(main, `路由 ${SCHEDULE_PATH} 没有渲染出 main 内容`).toBeTruthy()
  expect(cells().length, '课程表没有渲染出空格，守卫在守空气').toBeGreaterThanOrEqual(40)
  return main
}

/** 在某一格上派发按键（可取消，才能断言 preventDefault）。 */
async function press(cell, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  cell.dispatchEvent(event)
  await settle()
  return event
}

describe('课程表网格的 roving tabindex', () => {
  it('整个网格恰好一个 Tab 停靠点，其余是 -1，且每格都有可访问名称', async () => {
    await openSchedule()
    const all = cells()
    const stops = all.filter((cell) => cell.getAttribute('tabindex') === '0')
    expect(stops, '有且只有一个格子在 Tab 序里').toHaveLength(1)
    for (const cell of all) {
      if (cell !== stops[0]) {
        expect(cell.getAttribute('tabindex'), '其它格子必须是 -1（组内已留停靠点）').toBe('-1')
      }
      expect(cell.getAttribute('role')).toBe('button')
      // 空格里没有任何文字，可访问名称只能来自 aria-label
      expect((cell.getAttribute('aria-label') ?? '').trim().length).toBeGreaterThan(3)
      expect(cell.getAttribute('aria-label')).toContain('添加课程')
    }
    const group = document.querySelector('.timetable')
    expect(group.getAttribute('role'), 'roving 组要能被 tabOrderAndNames 的判据认出来').toBe('group')
    expect((group.getAttribute('aria-label') ?? '')).toContain('课程表网格')
  })

  it('方向键在网格内移动并夹住边界，Home/End 到本周首尾', async () => {
    await openSchedule()
    // 起始格是「今天」那一列，测试跑在哪一天不确定，所以先 Home 把列归到周一，
    // 断言只依赖相对位置与边界，不依赖今天是星期几。
    await press(activeTabStop(), 'Home')
    expect(cellCoords(activeTabStop())[0]).toBe(0)

    expect((await press(activeTabStop(), 'ArrowRight')).defaultPrevented, '方向键必须拦掉默认滚动').toBe(true)
    expect(cellCoords(activeTabStop())[0]).toBe(1)
    await press(activeTabStop(), 'ArrowDown')
    expect(cellCoords(activeTabStop())[0]).toBe(1)

    await press(activeTabStop(), 'End')
    expect(cellCoords(activeTabStop())[0]).toBe(6)
    // 右边界夹住
    await press(activeTabStop(), 'ArrowRight')
    expect(cellCoords(activeTabStop())[0], '到右边要夹住，不能绕回周一').toBe(6)

    // 左边界夹住：连按十来次不该绕到周日
    await press(activeTabStop(), 'Home')
    for (let i = 0; i < 10; i += 1) await press(activeTabStop(), 'ArrowLeft')
    expect(cellCoords(activeTabStop())[0], '到左边要夹住，不能绕回周日').toBe(0)

    // 上边界夹住：连按比行数还多次，必须停在第一行
    for (let i = 0; i < 20; i += 1) await press(activeTabStop(), 'ArrowUp')
    expect(cellCoords(activeTabStop())[1], '第一行再往上要夹住').toBe(0)
  })

  it('回车与点击等价：都按这一格预填并打开添加课程表单', async () => {
    await openSchedule()
    const target = activeTabStop()
    expect(document.querySelector('.overlay'), '进页面时不该有弹层').toBeNull()
    const event = await press(target, 'Enter')
    expect(event.defaultPrevented, '回车要拦掉默认行为').toBe(true)
    // 表单是异步组件（CourseEditorModal），要给它时间加载
    for (let i = 0; i < 40 && !document.querySelector('.overlay'); i += 1) {
      await settle()
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
    const overlay = document.querySelector('.overlay')
    expect(overlay, '回车应当和点击一样打开添加课程表单').toBeTruthy()
    expect(overlay.querySelector('[role="dialog"]'), '弹层里是对话框').toBeTruthy()
    expect(overlay.querySelector('input'), '打开的是带输入项的表单').toBeTruthy()
  })

  it('点击某一格会把停靠点挪过去（否则鼠标用户下一次 Tab 会回到原处）', async () => {
    await openSchedule()
    // 固定挑第 1 天第 1 节：它一定存在，也不受"今天是星期几"影响
    const other = cells().find((cell) => {
      const [day, period] = cellCoords(cell)
      return day === 0 && period === 0
    })
    expect(other, '夹具需要找到第 1 天第 1 节').toBeTruthy()
    other.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(cellCoords(activeTabStop())).toEqual([0, 0])
  })
})