// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'

const { persist } = vi.hoisted(() => ({ persist: vi.fn() }))
vi.mock('../src/composables/store/core.js', () => ({ restoreStoredValues: persist }))
vi.mock('../src/composables/appearance.js', async () => {
  const { ref } = await import('vue')
  return { appearance: ref({ quotes: ['虚构旧文字'], fixedQuoteIndex: 0 }) }
})
import { useAppearanceQuoteSave } from '../src/composables/appearanceFeedback.js'

let scope
afterEach(() => { scope?.stop(); persist.mockReset() })
function editor() {
  const draft = ref(' 虚构新文字 '), error = ref(''), message = ref('')
  scope = effectScope()
  const jobs = scope.run(() => useAppearanceQuoteSave({ draft, error, message }))
  return { ...jobs, draft, error, message }
}

describe('appearance save truth and draft preservation', () => {
  it('waits for durable persistence and preserves edits made while the write is pending', async () => {
    let complete
    persist.mockReturnValue(new Promise(resolve => { complete = resolve }))
    const form = editor()
    const save = form.save()
    expect(form.message.value).toBe('')
    form.draft.value = '尚未保存的后续输入'
    complete(); expect(await save).toEqual({ feedback: false })
    expect(form.message.value).toBe('已保存 1 条提交的文字；新输入尚未保存')
    expect(form.draft.value).toBe('尚未保存的后续输入')
    expect(persist).toHaveBeenCalledWith({ sl_appearance: { quotes: ['虚构新文字'], fixedQuoteIndex: 0 } })
  })
  it('keeps the draft and shows the actual storage error, then allows retry', async () => {
    persist.mockRejectedValueOnce(new Error('测试存储空间不足')).mockResolvedValueOnce(undefined)
    const form = editor()
    await expect(form.save()).rejects.toThrow('测试存储空间不足')
    expect(form.draft.value).toBe(' 虚构新文字 ')
    expect(form.error.value).toBe('测试存储空间不足')
    expect(form.message.value).toBe('')
    expect(await form.save()).toBe(true)
    expect(form.error.value).toBe('')
    expect(persist).toHaveBeenCalledTimes(2)
  })
  it('does not replace a reopened draft with a closed session result', async () => {
    let complete
    persist.mockReturnValue(new Promise(resolve => { complete = resolve }))
    const form = editor()
    const save = form.save()
    form.cancel(); form.draft.value = '重新打开后的输入'
    complete(); expect(await save).toBe(false)
    expect(form.draft.value).toBe('重新打开后的输入')
    expect(form.message.value).toBe('')
  })
})
