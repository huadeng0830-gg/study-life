// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
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

function mountControlledPanel() {
  const events = []
  const open = ref(true)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({
    render: () => open.value ? h(QuickRecordPanel, {
      open: open.value,
      onClose: () => { events.push({ type: 'close' }); open.value = false },
      onSaved: (payload) => events.push({ type: 'saved', payload }),
    }) : null,
  })
  app.mount(root)
  mountedApps.push({ app, root })
  return { events, reopen: () => { open.value = true } }
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
  document.body.style.overflow = ''
})

describe('QuickRecordPanel 保存交互', () => {
  it('普通保存成功后关闭当前快速记录窗口并通知父层显示 toast', async () => {
    const events = mountPanel()
    await enterSmartText('午饭18元')
    expect(document.body.querySelector('.results')).not.toBeNull()

    buttonWithText('保存').click()
    await nextTick()
    await nextTick()

    expect(events.map((event) => event.type)).toEqual(['saved', 'close'])
    expect(events[0].payload.message).toContain('已记录')
  })

  it('保存并继续复用当前窗口，清空输入和解析结果且不关闭', async () => {
    const events = mountPanel()
    await enterSmartText('买洗衣液')

    buttonWithText('保存并继续').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(document.body.querySelector('.smart-input').value).toBe(''))

    expect(events).toEqual([])
    expect(document.body.querySelector('.smart-input').value).toBe('')
    expect(document.body.querySelector('.results')).toBeNull()
    expect(document.activeElement).toBe(document.body.querySelector('.smart-input'))

    await enterSmartText('午饭18元')
    buttonWithText('保存').click()
    await nextTick()

    expect(events.map((event) => event.type)).toEqual(['saved', 'close'])
  })

  it.each([
    ['待办', '明天下午三点前提交实验报告'],
    ['作业', '周五18点交高数第三章作业'],
    ['记账', '午饭18元'],
    ['收入', '生活费到账500微信'],
    ['日程', '明天下午三点开组会'],
    ['倒计时', '12月20日期末考试'],
    ['固定账单', '每月15号39元话费'],
  ])('%s 保存成功后遵守一次录入规则', async (_type, text) => {
    const events = mountPanel()
    await enterSmartText(text)

    buttonWithText('保存').click()
    await nextTick()

    expect(events.map((event) => event.type)).toEqual(['saved', 'close'])
  })

  it('快速笔记普通保存成功后也关闭当前窗口', async () => {
    const events = mountPanel()
    buttonWithText('📝 快速笔记').click()
    await nextTick()

    const note = document.body.querySelector('.note-body')
    note.value = '记一条临时笔记'
    note.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    buttonWithText('保存').click()
    await nextTick()

    expect(events.map((event) => event.type)).toEqual(['saved', 'close'])
  })

  it('普通保存后再次打开是干净的新状态', async () => {
    const { events, reopen } = mountControlledPanel()
    await enterSmartText('午饭18元')
    buttonWithText('保存').click()
    await vi.waitFor(() => expect(events.map((event) => event.type)).toEqual(['saved', 'close']))

    await nextTick()
    reopen()
    await nextTick()
    await nextTick()
    expect(document.body.querySelector('.smart-input').value).toBe('')
    expect(document.body.querySelector('.results')).toBeNull()
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
  })
})
