// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissGlobalError,
  installGlobalErrorHandling,
  lastGlobalError,
  reloadAfterError,
} from '../src/composables/globalError.js'

afterEach(() => {
  dismissGlobalError()
  vi.restoreAllMocks()
})

describe('全局错误兜底', () => {
  it('组件渲染错误写入 lastGlobalError 并保留原始错误输出', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = { config: {} }
    installGlobalErrorHandling(app)

    app.config.errorHandler(new Error('render boom'), null, 'render')

    expect(lastGlobalError.value).toMatchObject({ kind: 'render', message: 'render boom' })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(String(consoleSpy.mock.calls[0][1])).toContain('render boom')
  })

  it('未捕获的 Promise 拒绝被统一记录', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    installGlobalErrorHandling({ config: {} })

    const event = new Event('unhandledrejection')
    Object.defineProperty(event, 'reason', { value: new Error('async boom') })
    window.dispatchEvent(event)

    expect(lastGlobalError.value).toMatchObject({ kind: 'promise', message: 'async boom' })
  })

  it('dismiss 后提示立即消失', () => {
    const app = { config: {} }
    installGlobalErrorHandling(app)
    app.config.errorHandler(new Error('x'))

    expect(lastGlobalError.value).not.toBeNull()
    dismissGlobalError()
    expect(lastGlobalError.value).toBeNull()
  })

  it('reloadAfterError 清除提示并触发刷新', () => {
    const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    const app = { config: {} }
    installGlobalErrorHandling(app)
    app.config.errorHandler(new Error('x'))

    reloadAfterError()
    expect(lastGlobalError.value).toBeNull()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })
})