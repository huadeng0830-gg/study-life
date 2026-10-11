// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, KeepAlive, nextTick, ref } from 'vue'
import ActionButton from '../src/components/ActionButton.vue'

let app, host
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 8; i++) await nextTick() }
function mount(render) {
  host = document.createElement('div'); document.body.append(host)
  app = createApp({ render }); app.mount(host)
}
afterEach(() => { app?.unmount(); host?.remove(); vi.useRealTimers() })

describe('shared asynchronous button at its DOM entry', () => {
  it('locks two clicks synchronously, preserves focus/name, and reports the actual Promise result', async () => {
    vi.useFakeTimers()
    const work = deferred(), done = vi.fn(), action = vi.fn(() => work.promise)
    mount(() => h(ActionButton, { kind: 'important', action, onDone: done }, () => '保存导航'))
    const button = host.querySelector('button'); button.focus(); button.click(); button.click()
    await flush()
    expect(action).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('保存导航')
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await vi.advanceTimersByTimeAsync(5000)
    expect(button.dataset.actionPhase).toBe('loading')
    expect(done).not.toHaveBeenCalled()
    work.resolve({ id: 'fictional-layout' }); await flush()
    expect(done).toHaveBeenCalledWith({ id: 'fictional-layout' })
    expect(button.dataset.actionPhase).toBe('success')
    await vi.advanceTimersByTimeAsync(1320)
    expect(button.dataset.actionPhase).toBe('idle')
  })

  it('retains the real error, allows retry, and disables retry when the caller disables the action', async () => {
    const disabled = ref(false), action = vi.fn().mockRejectedValueOnce(new Error('存储空间不足')).mockResolvedValue(true)
    mount(() => h(ActionButton, { kind: 'important', action, disabled: disabled.value }, () => '保存'))
    host.querySelector('button').click(); await flush()
    expect(host.querySelector('.action-feedback').textContent).toContain('存储空间不足')
    expect(host.querySelector('button').getAttribute('aria-describedby')).toBeTruthy()
    disabled.value = true; await flush()
    expect(host.querySelector('.action-feedback button').disabled).toBe(true)
    host.querySelector('.action-feedback button').click(); await flush()
    expect(action).toHaveBeenCalledTimes(1)
    disabled.value = false; await flush()
    const retry = host.querySelector('.action-feedback button'); retry.click(); retry.click(); await flush()
    expect(action).toHaveBeenCalledTimes(2)
    expect(host.querySelector('button').dataset.actionPhase).toBe('success')
    expect(host.querySelector('.action-feedback')).toBeNull()
  })

  it('cancels on KeepAlive deactivation and ignores late results after reactivation', async () => {
    const visible = ref(true), buttonRef = ref(), done = vi.fn(), old = deferred(), fresh = deferred()
    const action = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    mount(() => h(KeepAlive, null, () => visible.value
      ? h(ActionButton, { ref: buttonRef, action, onDone: done }, () => '保存') : null))
    host.querySelector('button').click(); await flush()
    const signal = action.mock.calls[0][0].signal
    visible.value = false; await flush()
    expect(signal.aborted).toBe(true)
    visible.value = true; await flush()
    host.querySelector('button').click(); await flush()
    old.resolve(true); await flush()
    expect(done).not.toHaveBeenCalled()
    expect(buttonRef.value.pending).toBe(true)
    fresh.resolve('fresh'); await flush()
    expect(done).toHaveBeenCalledExactlyOnceWith('fresh')
  })

  it('does not emit a late done event after unmount and aborts the callback signal', async () => {
    const work = deferred(), done = vi.fn(), action = vi.fn(() => work.promise)
    mount(() => h(ActionButton, { action, onDone: done }, () => '上传'))
    host.querySelector('button').click(); await flush()
    app.unmount(); app = null
    expect(action.mock.calls[0][0].signal.aborted).toBe(true)
    work.resolve(true); await flush()
    expect(done).not.toHaveBeenCalled()
  })
})
