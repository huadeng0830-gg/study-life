// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectionAllowsPrefetch } from '../src/router/routePreload.js'

const connectionProperties = ['connection', 'mozConnection', 'webkitConnection']
const originalConnections = new Map(connectionProperties.map((key) => [key, Object.getOwnPropertyDescriptor(navigator, key)]))

afterEach(() => {
  vi.unstubAllGlobals()
  for (const [key, descriptor] of originalConnections) {
    if (descriptor) Object.defineProperty(navigator, key, descriptor)
    else delete navigator[key]
  }
})

describe('路由后台预取网络门控', () => {
  it('浏览器不提供 Network Information API 时默认跳过预取', () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'mozConnection', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'webkitConnection', { configurable: true, value: undefined })

    expect(connectionAllowsPrefetch()).toBe(false)
  })

  it('节省流量或 2G 网络时跳过预取', () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true, effectiveType: '4g' } })
    expect(connectionAllowsPrefetch()).toBe(false)
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: false, effectiveType: '2g' } })
    expect(connectionAllowsPrefetch()).toBe(false)
  })
})
