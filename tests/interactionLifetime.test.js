// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, h, nextTick } from 'vue'
import DomainCsvImportButton from '../src/components/DomainCsvImportButton.vue'
import { useLatestTask } from '../src/composables/latestTask.js'

let app, root, scope
afterEach(() => { app?.unmount(); root?.remove(); scope?.stop(); document.body.replaceChildren() })

describe('interaction lifetime', () => {
  it('closing and reopening CSV import ignores the old read, without losing the new preview', async () => {
    root = document.createElement('div'); document.body.append(root)
    app = createApp({ render: () => h(DomainCsvImportButton, { kind: 'tasks', records: [] }) })
    app.mount(root)
    const open = async () => { root.querySelector('button').click(); await nextTick() }
    const read = async (name, promise) => {
      const input = document.querySelector('.csv-file-picker input')
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name, type: 'text/csv', arrayBuffer: () => promise }] })
      input.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
    }
    const buffer = (title) => new TextEncoder().encode(`title\n${title}`).buffer
    let finishOld
    await open()
    await read('old.csv', new Promise(resolve => { finishOld = resolve }))
    expect(document.querySelector('.csv-import-body').getAttribute('aria-busy')).toBe('true')
    document.querySelector('.csv-import-footer .btn-ghost').click(); await nextTick()
    await open()
    await read('new.csv', Promise.resolve(buffer('虚构新预览')))
    await vi.waitFor(() => expect(document.querySelector('.csv-preview')?.textContent).toContain('虚构新预览'))
    finishOld(buffer('虚构旧预览'))
    await nextTick(); await nextTick()
    expect(document.querySelector('.csv-preview').textContent).toContain('虚构新预览')
    expect(document.querySelector('.csv-preview').textContent).not.toContain('虚构旧预览')
    expect(document.querySelector('.csv-import-body').getAttribute('aria-busy')).toBeNull()
  })

  it('parent cancellation and scope disposal invalidate sessions and detach abort listeners', () => {
    scope = effectScope()
    const jobs = scope.run(() => useLatestTask())
    const parent = new AbortController()
    const detach = vi.spyOn(parent.signal, 'removeEventListener')
    const first = jobs.begin(parent.signal)
    const second = jobs.begin()
    expect(first.signal.aborted).toBe(true)
    expect(first.isCurrent()).toBe(false)
    expect(detach).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(second.isCurrent()).toBe(true)
    scope.stop()
    expect(second.signal.aborted).toBe(true)
    expect(second.isCurrent()).toBe(false)
  })
  it('confirming the same CSV preview twice emits only one real import', async () => {
    const imported = vi.fn()
    root = document.createElement('div'); document.body.append(root)
    app = createApp({ render: () => h(DomainCsvImportButton, { kind: 'tasks', records: [], onImport: imported }) })
    app.mount(root)
    root.querySelector('button').click(); await nextTick()
    const input = document.querySelector('.csv-file-picker input')
    Object.defineProperty(input, 'files', { value: [{ name: 'fictional.csv', type: 'text/csv', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('title\n虚构提交').buffer) }] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector('.csv-preview')?.textContent).toContain('虚构提交'))
    const submit = document.querySelector('.csv-import-footer .btn-primary')
    submit.click(); submit.click()
    expect(imported).toHaveBeenCalledTimes(1)
    expect(imported.mock.calls[0][0]).toHaveLength(1)
  })
})
