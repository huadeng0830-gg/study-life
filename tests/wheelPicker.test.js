// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import WheelPicker from '../src/components/WheelPicker.vue'
import TimeWheelSheet from '../src/components/TimeWheelSheet.vue'
import {
  buildWheelValues,
  formatTimeValue,
  parseTimeValue,
  wheelIndexForValue,
  wheelIndexFromScrollTop,
  wheelPadding,
  wheelScrollTopForIndex,
  wheelValueAtIndex,
} from '../src/composables/wheelPicker.js'

const mountedApps = []

function mount(render) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ render })
  app.mount(root)
  mountedApps.push({ app, root })
  return root
}

afterEach(() => {
  vi.useRealTimers()
  for (const { app, root } of mountedApps.splice(0)) {
    app.unmount()
    root.remove()
  }
  delete document.body.dataset.modalLockCount
  delete document.body.dataset.modalOpen
  document.body.style.overflow = ''
})

describe('滚轮刻度数学', () => {
  it('生成刻度数组', () => {
    expect(buildWheelValues(0, 3)).toEqual([0, 1, 2, 3])
    expect(buildWheelValues(0, 59, 5).slice(0, 4)).toEqual([0, 5, 10, 15])
    expect(buildWheelValues(0, 59, 5).at(-1)).toBe(55)
    // 步长为 0 / 负数时退化为 1，避免死循环
    expect(buildWheelValues(0, 2, 0)).toEqual([0, 1, 2])
  })

  it('上下留白让首尾刻度也能滚到中间一行', () => {
    // 5 行视口、每格 44px → 留白 2 格 = 88px
    expect(wheelPadding(44, 5)).toBe(88)
    expect(wheelPadding(44, 3)).toBe(44)
    expect(wheelPadding(undefined, undefined)).toBe(88)
  })

  it('序号与滚动位置可以互相换算', () => {
    const values = buildWheelValues(0, 23)
    expect(wheelScrollTopForIndex(0, values, 44)).toBe(0)
    expect(wheelScrollTopForIndex(5, values, 44)).toBe(220)
    expect(wheelIndexFromScrollTop(220, values, 44)).toBe(5)
  })

  it('松手后吸附到最近的整格，并且夹在范围内', () => {
    const values = buildWheelValues(0, 23)
    // 停在两格之间 → 取更近的一格，这就是「数字自动对齐」的落点
    expect(wheelIndexFromScrollTop(44 * 3 + 20, values, 44)).toBe(3)
    expect(wheelIndexFromScrollTop(44 * 3 + 25, values, 44)).toBe(4)
    // 越界与脏输入
    expect(wheelIndexFromScrollTop(-500, values, 44)).toBe(0)
    expect(wheelIndexFromScrollTop(99999, values, 44)).toBe(23)
    expect(wheelIndexFromScrollTop(undefined, values, 44)).toBe(0)
  })

  it('按已有值定位到最近的刻度', () => {
    const minutes = buildWheelValues(0, 59, 5)
    expect(wheelIndexForValue(minutes, 0)).toBe(0)
    expect(wheelIndexForValue(minutes, 33)).toBe(7) // 35 分
    expect(wheelIndexForValue(minutes, 57)).toBe(11) // 55 分
    expect(wheelValueAtIndex(minutes, 7)).toBe(35)
    expect(wheelIndexForValue(minutes, undefined)).toBe(0)
  })

  it('解析与格式化 HH:MM', () => {
    expect(parseTimeValue('14:30')).toEqual({ hour: 14, minute: 30 })
    expect(parseTimeValue('7:05')).toEqual({ hour: 7, minute: 5 })
    expect(parseTimeValue('')).toEqual({ hour: 9, minute: 0 })
    expect(parseTimeValue('abc')).toEqual({ hour: 9, minute: 0 })
    expect(parseTimeValue('99:99')).toEqual({ hour: 23, minute: 59 })
    expect(parseTimeValue('', { hour: 0, minute: 0 })).toEqual({ hour: 0, minute: 0 })
    expect(formatTimeValue(7, 5)).toBe('07:05')
    expect(formatTimeValue(0, 0)).toBe('00:00')
  })
})

describe('WheelPicker', () => {
  const values = buildWheelValues(0, 59, 5)

  it('渲染整列刻度并把选中项高亮', async () => {
    mount(() => h(WheelPicker, { values, modelValue: 15 }))
    await nextTick()
    const items = [...document.querySelectorAll('.wheel-item')]
    expect(items.length).toBe(12)
    expect(document.querySelector('.wheel-item.on').textContent.trim()).toBe('15')
    expect(document.querySelector('.wheel-item.on').getAttribute('aria-selected')).toBe('true')
  })

  it('打开时滚到当前值对应的格子', async () => {
    mount(() => h(WheelPicker, { values, modelValue: 30, itemHeight: 44 }))
    await nextTick()
    // 30 分是第 6 格 → 6 * 44
    expect(document.querySelector('.wheel-column').scrollTop).toBe(264)
    expect(document.querySelector('.wheel-item.on').textContent.trim()).toBe('30')
  })

  it('滚动停止后自动对齐到最近的整格并回传', async () => {
    vi.useFakeTimers()
    const selected = []
    mount(() => h(WheelPicker, {
      values,
      modelValue: 0,
      itemHeight: 44,
      'onUpdate:modelValue': (value) => selected.push(value),
    }))
    await nextTick()
    const column = document.querySelector('.wheel-column')
    // happy-dom 的 scrollTo 不会真的移动位置，用 spy 验证「对齐到哪一格」的意图
    const scrollTo = vi.fn()
    column.scrollTo = scrollTo

    // 停在 3 格半的位置：应为第 4 格（20 分）
    column.scrollTop = 44 * 4 + 20
    column.dispatchEvent(new Event('scroll'))
    // 滚动过程中不应该立刻回传，避免每帧都触发更新
    expect(selected).toEqual([])
    vi.advanceTimersByTime(140)
    expect(selected).toEqual([20])
    // 对齐到整格位置（4 * 44）
    expect(scrollTo).toHaveBeenCalledWith({ top: 176, behavior: 'smooth' })
  })

  it('连续滚动只在停下来之后回传一次', async () => {
    vi.useFakeTimers()
    const selected = []
    mount(() => h(WheelPicker, {
      values,
      modelValue: 0,
      itemHeight: 44,
      'onUpdate:modelValue': (value) => selected.push(value),
    }))
    await nextTick()
    const column = document.querySelector('.wheel-column')
    for (const index of [1, 2, 3]) {
      column.scrollTop = 44 * index
      column.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(50)
    }
    expect(selected).toEqual([])
    vi.advanceTimersByTime(140)
    expect(selected).toEqual([15])
  })

  it('方向键可以逐格调整，Home/End 直达首尾', async () => {
    // 受控组件：父级必须把回传值写回 modelValue，方向键才能连续生效
    const selected = []
    const value = ref(10)
    mount(() => h(WheelPicker, {
      values,
      modelValue: value.value,
      'onUpdate:modelValue': (next) => {
        selected.push(next)
        value.value = next
      },
    }))
    await nextTick()
    const column = document.querySelector('.wheel-column')
    const press = (key) => column.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

    press('ArrowDown')
    await nextTick()
    press('ArrowDown')
    await nextTick()
    press('ArrowUp')
    await nextTick()
    press('End')
    await nextTick()
    press('Home')
    expect(selected).toEqual([15, 20, 15, 55, 0])
  })
})

describe('TimeWheelSheet', () => {
  it('打开时把已有时间吸附到分钟刻度上', async () => {
    mount(() => h(TimeWheelSheet, { open: true, modelValue: '14:33' }))
    await nextTick()
    await nextTick()
    // 33 分不是 5 的倍数，滚轮只能停在 35，预览必须与之一致
    expect(document.querySelector('.time-wheel-preview').textContent.trim()).toBe('14:35')
    const selected = [...document.querySelectorAll('.wheel-item.on')].map((item) => item.textContent.trim())
    expect(selected).toEqual(['14', '35'])
  })

  it('留空时给出 09:00 作为默认起点', async () => {
    mount(() => h(TimeWheelSheet, { open: true, modelValue: '' }))
    await nextTick()
    await nextTick()
    expect(document.querySelector('.time-wheel-preview').textContent.trim()).toBe('09:00')
  })

  it('确定时回传 HH:MM 并关闭', async () => {
    const updates = []
    const closes = []
    mount(() => h(TimeWheelSheet, {
      open: true,
      modelValue: '08:00',
      'onUpdate:modelValue': (value) => updates.push(value),
      onClose: () => closes.push(true),
    }))
    await nextTick()
    await nextTick()
    ;[...document.querySelectorAll('.time-wheel-actions .btn')].find((button) => button.textContent.trim() === '确定').click()
    await nextTick()
    expect(updates).toEqual(['08:00'])
    expect(closes.length).toBe(1)
  })

  it('已有时间时才提供清除，清除会回传空值', async () => {
    const updates = []
    const openRef = ref(true)
    mount(() => h(TimeWheelSheet, {
      open: openRef.value,
      modelValue: '08:00',
      clearable: true,
      'onUpdate:modelValue': (value) => updates.push(value),
      onClose: () => { openRef.value = false },
    }))
    await nextTick()
    await nextTick()
    const clear = [...document.querySelectorAll('.time-wheel-actions .btn')].find((button) => button.textContent.trim() === '清除时间')
    expect(clear).toBeTruthy()
    clear.click()
    await nextTick()
    expect(updates).toEqual([''])
  })

  it('留空且可清除时不显示清除按钮', async () => {
    mount(() => h(TimeWheelSheet, { open: true, modelValue: '', clearable: true }))
    await nextTick()
    await nextTick()
    const labels = [...document.querySelectorAll('.time-wheel-actions .btn')].map((button) => button.textContent.trim())
    expect(labels).toEqual(['取消', '确定'])
  })
})