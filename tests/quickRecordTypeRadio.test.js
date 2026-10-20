// @vitest-environment happy-dom
/**
 * 记录类型切换（`.type-switch`）的单选语义与键盘模型。
 *
 * 【原来是什么样】8 个 `<button>` 装在一个 `role="group"` 里，选中态只靠 `aria-pressed`：
 *   - 读屏听不出"这是一组互斥的单选"，只听到 8 个独立开关；
 *   - 键盘上是 8 个 Tab 停靠点，一张卡片就要按 8 次 Tab 才能穿过去（多草稿时更明显）。
 *
 * 【现在按仓库既有的单选模型改】（TodayView 的「选择今日心情」是唯一先例）：
 * `role="radiogroup"` + 每个按钮 `role="radio"` + `:aria-checked`，roving tabindex
 * 让整组只留一个 Tab 停靠点，方向键 / Home / End 在组内移动焦点并同步选中。
 * 同时**不能吞掉** Enter 与 Tab：前者是原生 button 的激活键，后者是离开这一组的唯一出路。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import QuickRecordPanel from '../src/components/QuickRecordPanel.vue'

const apps = []

function mountPanel(context = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    render: () => h(QuickRecordPanel, { open: true, context, onClose: () => {}, onSaved: () => {} }),
  })
  app.mount(root)
  apps.push({ app, root })
}

async function enterSmartText(value) {
  const input = document.body.querySelector('.smart-input')
  expect(input, '找不到快速记录输入框').toBeTruthy()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

function typeGroup() {
  const group = document.body.querySelector('.type-switch')
  expect(group, '找不到记录类型切换组').toBeTruthy()
  return group
}

function typeRadios() {
  return [...typeGroup().querySelectorAll('[role="radio"]')]
}

function pressKey(element, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const { app, root } of apps.splice(0)) {
    app.unmount()
    root.remove()
  }
  document.body.replaceChildren()
  document.body.style.overflow = ''
})

describe('QuickRecordPanel 记录类型单选组', () => {
  it('是 radiogroup + radio + aria-checked，且整组只留一个 Tab 停靠点', async () => {
    mountPanel({ preferredType: 'expense' })
    await enterSmartText('买菜20元')

    const group = typeGroup()
    expect(group.getAttribute('role'), '容器角色应改成 radiogroup').toBe('radiogroup')
    expect(group.getAttribute('aria-label')).toBe('纠正记录类型')

    const radios = typeRadios()
    expect(radios).toHaveLength(8)
    expect(radios.every((radio) => radio.getAttribute('aria-checked') !== null), '每个候选都要有 aria-checked').toBe(true)
    const checked = radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')
    expect(checked, '一组里只能有一个选中项').toHaveLength(1)
    expect(checked[0].textContent).toContain('支出')
    // 巡视式 tabindex：整组一个停靠点，其余靠方向键到达。
    expect(radios.filter((radio) => radio.tabIndex >= 0), '整组应只剩一个 Tab 停靠点').toEqual([checked[0]])
    expect(group.querySelectorAll('[aria-pressed]'), 'radio 不该再挂 aria-pressed').toHaveLength(0)
  })

  it('方向键 / Home / End 在组内移动焦点并同步选中', async () => {
    mountPanel({ preferredType: 'expense' })
    await enterSmartText('买菜20元')

    const radios = typeRadios()
    const start = radios.findIndex((radio) => radio.getAttribute('aria-checked') === 'true')
    expect(start).toBeGreaterThanOrEqual(0)
    radios[start].focus()

    for (const [key, index] of [['ArrowRight', (start + 1) % radios.length], ['ArrowLeft', start], ['ArrowDown', (start + 1) % radios.length], ['ArrowUp', start], ['End', radios.length - 1], ['Home', 0]]) {
      const event = pressKey(document.activeElement, key)
      expect(event.defaultPrevented, `${key} 必须被组承接（否则页面会跟着滚动）`).toBe(true)
      await nextTick()
      expect(document.activeElement, `${key} 之后焦点应落在第 ${index} 项`).toBe(radios[index])
      expect(radios[index].getAttribute('aria-checked'), `${key} 之后选中态应跟着走`).toBe('true')
      expect(radios.filter((radio) => radio.tabIndex >= 0), `${key} 之后停靠点应跟随焦点`).toEqual([radios[index]])
    }
  })

  it('不吞 Enter 与 Tab，点击仍然切换类型', async () => {
    mountPanel({ preferredType: 'expense' })
    await enterSmartText('买菜20元')

    const radios = typeRadios()
    const checked = radios.find((radio) => radio.getAttribute('aria-checked') === 'true')
    expect(pressKey(checked, 'Enter').defaultPrevented, 'Enter 不能被拦：原生 button 靠它激活').toBe(false)
    expect(pressKey(checked, 'Tab').defaultPrevented, 'Tab 不能被拦：键盘用户要能离开这一组').toBe(false)

    const income = radios.find((radio) => radio.textContent.trim() === '收入')
    income.click()
    await nextTick()
    expect(income.getAttribute('aria-checked')).toBe('true')
    expect(document.body.querySelector('.record-head')?.textContent).toContain('收入')
  })

  it('类型不在候选里（unknown）时也要留一个 Tab 停靠点', async () => {
    mountPanel()
    await enterSmartText('牛肉面五')

    const unknownSource = document.body.querySelector('.unknown-source')
    expect(unknownSource, '这条输入应当落到「类型未知」分支').toBeTruthy()
    const radios = typeRadios()
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true'), '未知类型时没有候选项算选中').toHaveLength(0)
    expect(radios.filter((radio) => radio.tabIndex >= 0), '未知类型时整组也要有一个停靠点').toHaveLength(1)
  })
})