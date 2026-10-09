import { appearance } from './appearance.js'
import { restoreStoredValues } from './store/core.js'
import { useLatestTask } from './latestTask.js'

/** @param {{draft: import('vue').Ref<string>, error: import('vue').Ref<string>, message: import('vue').Ref<string>}} fields */
export function useAppearanceQuoteSave({ draft, error, message }) {
  const jobs = useLatestTask()
  /** @param {{signal?: AbortSignal}} [context] */
  async function save({ signal } = {}) {
    const job = jobs.begin(signal)
    const source = draft.value
    const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50)
    const quotes = lines.length ? lines : ['今天也要漂亮通关。']
    error.value = ''; message.value = ''
    try {
      await restoreStoredValues({ sl_appearance: JSON.parse(JSON.stringify({ ...appearance.value, quotes,
        fixedQuoteIndex: Math.min(appearance.value.fixedQuoteIndex, quotes.length - 1),
      })) })
      if (!job.isCurrent()) return false
      if (draft.value !== source) {
        message.value = `已保存 ${quotes.length} 条提交的文字；新输入尚未保存`
        return { feedback: false }
      }
      draft.value = quotes.join('\n')
      message.value = `已保存 ${quotes.length} 条文字`
      return true
    } catch (cause) {
      if (!job.isCurrent()) return false
      error.value = cause instanceof Error ? cause.message : '文字保存失败，请重试'
      throw cause
    } finally { job.finish() }
  }
  return { save, cancel: jobs.cancel }
}
