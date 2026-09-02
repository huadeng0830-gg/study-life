// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }))

vi.mock('../src/composables/quickRecord/adapters.js', () => ({
  useQuickRecordAdapters: () => ({ courses: { value: [] }, save: saveMock }),
}))

import QuickRecordPanel from '../src/components/QuickRecordPanel.vue'

const mountedApps = []

function mountPanel() {
  const events = []
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    render: () => h(QuickRecordPanel, {
      open: true,
      onClose: () => events.push({ type: 'close' }),
      onSaved: (payload) => events.push({ type: 'saved', payload }),
    }),
  })
  app.mount(root)
  mountedApps.push({ app, root })
  return events
}

async function enterSmartText(value) {
  const input = document.body.querySelector('.smart-input')
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

function buttonWithText(text) {
  return [...document.body.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
}

afterEach(() => {
  for (const { app, root } of mountedApps.splice(0)) {
    app.unmount()
    root.remove()
  }
  document.body.replaceChildren()
  saveMock.mockReset()
})

describe('QuickRecordPanel 保存并发保护', () => {
  it('异步保存期间连续点击保存只调用一次，并在完成后关闭', async () => {
    let resolveSave
    saveMock.mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
    const events = mountPanel()
    await enterSmartText('午饭18元')

    const saveButton = buttonWithText('保存')
    saveButton.click()
    saveButton.click()
    await nextTick()

    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(saveButton.disabled).toBe(true)
    expect(events).toEqual([])

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(events).toEqual([])

    resolveSave({ message: '已记录支出', undo: vi.fn() })
    await vi.waitFor(() => expect(events.map((event) => event.type)).toEqual(['saved', 'close']))
  })

  it('异步保存失败时保留原始输入和解析草稿，并允许重试', async () => {
    let rejectSave
    saveMock.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject }))
    const events = mountPanel()
    await enterSmartText('午饭18元')

    buttonWithText('保存').click()
    rejectSave(new Error('storage unavailable'))
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('storage unavailable'))

    expect(events).toEqual([])
    expect(document.body.querySelector('.smart-input').value).toBe('午饭18元')
    expect(document.body.querySelector('.results')).not.toBeNull()

    saveMock.mockResolvedValueOnce({ message: '已记录支出', undo: vi.fn() })
    buttonWithText('保存').click()
    await vi.waitFor(() => expect(events.map((event) => event.type)).toEqual(['saved', 'close']))
    expect(saveMock).toHaveBeenCalledTimes(2)
  })

  it('异步保存并继续失败时不清空草稿，也不关闭窗口', async () => {
    let rejectSave
    saveMock.mockReturnValueOnce(new Promise((_, reject) => { rejectSave = reject }))
    const events = mountPanel()
    await enterSmartText('买洗衣液')

    buttonWithText('保存并继续').click()
    rejectSave(new Error('temporary failure'))
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('temporary failure'))

    expect(events).toEqual([])
    expect(document.body.querySelector('.smart-input').value).toBe('买洗衣液')
    expect(document.body.querySelector('.results')).not.toBeNull()
  })

  it('批量保存部分失败时不报告全部成功，并保留未保存项', async () => {
    saveMock
      .mockResolvedValueOnce({ message: '已记录支出', undo: vi.fn() })
      .mockRejectedValueOnce(new Error('second item failed'))
    const events = mountPanel()
    await enterSmartText('早餐6\n公交2')

    buttonWithText('全部保存').click()
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('前 1 项已保存'))

    expect(saveMock).toHaveBeenCalledTimes(2)
    expect(events).toEqual([])
    expect(document.body.querySelector('.results')).not.toBeNull()
    expect(document.body.querySelectorAll('.record-card')).toHaveLength(1)
  })

  it('中文输入法组合输入期间按 Enter 不保存，也不拦截候选确认', async () => {
    saveMock.mockResolvedValue({ message: '已记录', undo: vi.fn() })
    const events = mountPanel()
    await enterSmartText('高数作业')

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'isComposing', { value: true })
    document.body.querySelector('.smart-input').dispatchEvent(event)
    await nextTick()

    expect(event.defaultPrevented).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})
