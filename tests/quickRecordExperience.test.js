// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }))
vi.mock('../src/composables/quickRecord/adapters.js', () => ({
  useQuickRecordAdapters: () => ({ courses: { value: [{ id: 'sample-math', name: '高数' }] }, save: saveMock }),
}))
import QuickRecordPanel from '../src/components/QuickRecordPanel.vue'
import { accountDataOwner } from '../src/composables/accountSyncIdentity.js'

const mounts = []
function mountPanel(props = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const open = ref(true)
  const events = []
  const app = createApp({ render: () => h(QuickRecordPanel, {
    ...props, open: open.value,
    onClose: () => { events.push('close'); open.value = false },
    onSaved: (result) => events.push(result),
  }) })
  app.mount(root)
  const unmount = () => { app.unmount(); root.remove() }
  mounts.push(unmount)
  return { open, events, unmount }
}

async function enter(text) {
  const input = document.querySelector('.smart-input')
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
function button(text, selector = 'button') {
  return [...document.querySelectorAll(selector)].find((item) => item.textContent.trim() === text)
}
async function edit(element, value, event = 'input') {
  element.value = value
  element.dispatchEvent(new Event(event, { bubbles: true }))
  await nextTick()
}

beforeEach(() => {
  sessionStorage.clear()
  accountDataOwner.value = ''
  saveMock.mockReset().mockResolvedValue({ message: '已添加示例记录', undo: vi.fn() })
})
afterEach(() => {
  mounts.splice(0).forEach((unmount) => unmount())
  document.body.replaceChildren()
  document.body.style.overflow = ''
  sessionStorage.clear()
  accountDataOwner.value = ''
  vi.restoreAllMocks()
})

describe('快速记录完整录入体验', () => {
  it('首次打开立即解析初始内容，空白入口可直接选择类型和示例', async () => {
    mountPanel({ initialText: '午饭18元' })
    await nextTick()
    expect(document.querySelector('.smart-input').value).toBe('午饭18元')
    expect(document.querySelectorAll('.record-card')).toHaveLength(1)
    button('清空').click()
    await nextTick()
    expect(document.querySelectorAll('.action-row button')).toHaveLength(8)
    document.querySelector('.example-entry').click()
    await nextTick()
    expect(document.querySelectorAll('.record-card')).toHaveLength(1)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('添加新行不会丢失已改标题、金额、备注和选择', async () => {
    mountPanel()
    await enter('午饭18元')
    await edit(document.querySelector('.title-edit'), '自定义午饭')
    await edit(document.querySelector('[aria-label="金额"]'), '16')
    button('修改').click()
    await nextTick()
    await edit(document.querySelector('.details textarea'), '示例备注')
    await enter('午饭18元\n公交2元')
    expect(document.querySelector('.title-edit').value).toBe('自定义午饭')
    expect(document.querySelector('[aria-label="金额"]').value).toBe('16')
    expect(document.querySelector('.details textarea').value).toBe('示例备注')
  })

  it('勾选保存后保留未选项，再次解析不会重新带回已保存记录', async () => {
    const { events } = mountPanel()
    await enter('早餐6元\n公交2元')
    document.querySelector('[aria-label="选择第 2 项记录"]').click()
    await nextTick()
    button('保存选中 1 项').click()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(document.querySelectorAll('.record-card')).toHaveLength(1))
    expect(events).toEqual([])
    expect(document.querySelector('.smart-input').value).toBe('公交2元')
    await enter('公交2元\n奶茶9元')
    expect(document.querySelectorAll('.record-card')).toHaveLength(2)
    expect([...document.querySelectorAll('.title-edit')].some((input) => input.value === '早餐')).toBe(false)
  })

  it('任何选中项缺少必要信息时整批不写入，并聚焦具体错误', async () => {
    mountPanel()
    await enter('午饭18元\n开组会')
    document.querySelectorAll('.record-card')[1].querySelectorAll('.type-switch button')[2].click()
    await nextTick()
    button('全部保存').click()
    await nextTick()
    expect(saveMock).not.toHaveBeenCalled()
    expect(document.querySelector('.field-error').textContent).toContain('日期')
    expect(document.activeElement.type).toBe('date')
    const errorId = document.activeElement.getAttribute('aria-describedby')
    expect(document.getElementById(errorId)?.textContent).toContain('日期')
    await edit(document.querySelector('.details input[type="date"]'), '2026-10-12')
    button('全部保存').click()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2))
  })

  it('保存中锁定输入和卡片操作，连续点击与 Escape 不影响正在保存的数据', async () => {
    let resolve
    saveMock.mockReturnValue(new Promise((done) => { resolve = done }))
    const { events } = mountPanel()
    await enter('午饭18元')
    button('保存').click()
    await nextTick()
    expect(document.querySelector('.entry-fields').disabled).toBe(true)
    expect(button('保存中…').getAttribute('aria-disabled')).toBe('true')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(events).toEqual([])
    resolve({ message: '已保存', undo: vi.fn() })
    await vi.waitFor(() => expect(events).toHaveLength(2))
  })

  it('批量部分失败后原文只保留剩余项，重试不会重复写入成功项', async () => {
    saveMock.mockResolvedValueOnce({ message: '已保存', undo: vi.fn() }).mockRejectedValueOnce(new Error('示例失败'))
    mountPanel()
    await enter('早餐6元\n公交2元')
    button('全部保存').click()
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('前 1 项已保存'))
    expect(document.querySelector('.smart-input').value).toBe('公交2元')
    await enter('公交2元\n奶茶9元')
    button('全部保存').click()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(4))
    expect(saveMock.mock.calls.map(([draft]) => draft.amount)).toEqual([6, 2, 2, 9])
  })

  it('关闭再打开恢复手动修改，切换账号不会显示其它账号的草稿', async () => {
    const panel = mountPanel()
    await enter('午饭18元')
    await edit(document.querySelector('.title-edit'), '示例修改')
    panel.open.value = false
    await nextTick()
    panel.open.value = true
    await nextTick()
    expect(document.querySelector('.title-edit').value).toBe('示例修改')
    accountDataOwner.value = 'another-sample-owner'
    await nextTick()
    expect(document.querySelector('.smart-input').value).toBe('')
    accountDataOwner.value = ''
    await nextTick()
    expect(document.querySelector('.title-edit').value).toBe('示例修改')
  })

  it('组件卸载后重新打开仍恢复草稿，成功保存后暂存清空', async () => {
    mountPanel()
    await enter('午饭18元')
    await edit(document.querySelector('.title-edit'), '午饭加菜')
    mounts.pop()()
    mountPanel()
    await nextTick()
    expect(document.querySelector('.title-edit').value).toBe('午饭加菜')
    button('保存').click()
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(sessionStorage.length).toBe(0))
  })

  it('保存并继续后可以撤销这一批，仍保持当前输入', async () => {
    const undo = vi.fn()
    saveMock.mockResolvedValue({ message: '已保存', undo })
    const { events } = mountPanel()
    await enter('午饭18元')
    button('保存并继续').click()
    await vi.waitFor(() => expect(button('撤销刚才保存')).toBeTruthy())
    await enter('公交2元')
    button('撤销刚才保存').click()
    await nextTick()
    expect(undo).toHaveBeenCalledOnce()
    expect(document.querySelector('.smart-input').value).toBe('公交2元')
    expect(events).toEqual([])
  })

  it('移除草稿同步更新原文和选中金额合计', async () => {
    mountPanel()
    await enter('早餐6元\n公交2元\n奶茶9元')
    document.querySelector('[aria-label="移除第 2 项草稿"]').click()
    await nextTick()
    expect(document.querySelector('.smart-input').value).toBe('早餐6元\n奶茶9元')
    expect(document.querySelector('.batch-total').textContent).toContain('15.00')
    document.querySelector('[aria-label="选择第 2 项记录"]').click()
    await nextTick()
    expect(document.querySelector('.batch-total').textContent).toContain('6.00')
  })

  it('切出页面立即暂存最后一次输入，无需等防抖计时结束', async () => {
    mountPanel()
    await enter('午饭18元')
    window.dispatchEvent(new Event('pagehide'))
    const stored = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)))
    expect(stored.input).toBe('午饭18元')
    expect(stored.drafts[0].amount).toBe(18)
  })

  it('粘贴追加为新行，保留已有修改，迟到的剪贴板提示不覆盖输入', async () => {
    let resolveRead
    const readText = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve })).mockResolvedValueOnce('公交2元')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    mountPanel()
    await enter('午饭18元')
    await edit(document.querySelector('.title-edit'), '午饭加菜')
    resolveRead('迟到的示例文本')
    await nextTick()
    expect(document.querySelector('.clipboard-hint')).toBeNull()
    button('粘贴文字').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.record-card')).toHaveLength(2))
    expect(document.querySelector('.smart-input').value).toBe('午饭18元\n公交2元')
    expect(document.querySelector('.title-edit').value).toBe('午饭加菜')
    Reflect.deleteProperty(navigator, 'clipboard')
  })
})
