// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STARTUP_STEPS, runStartupGate } from '../src/composables/startupGate.js'
import { clearStartupPlaceholder, markStartupStep } from '../src/composables/startupStatus.js'

function buildPlaceholder() {
  const host = document.createElement('div')
  host.innerHTML = `
    <div data-startup-placeholder>
      <ol>
        <li data-startup-step="vault" data-state="active"><span>检查本机数据安全</span></li>
        <li data-startup-step="recovery" data-state="pending"><span>恢复未完成的同步</span></li>
        <li data-startup-step="prepare" data-state="pending"><span>准备工作台数据</span></li>
        <li data-startup-step="mount" data-state="pending"><span>打开界面</span></li>
      </ol>
    </div>
  `
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('启动占位结构', () => {
  it('阶段清单与 index.html 里的静态占位一一对应', () => {
    expect(STARTUP_STEPS.map((step) => step.id)).toEqual(['vault', 'recovery', 'prepare', 'mount'])
    const host = buildPlaceholder()
    const ids = [...host.querySelectorAll('[data-startup-step]')].map((node) => node.getAttribute('data-startup-step'))
    expect(ids).toEqual(STARTUP_STEPS.map((step) => step.id))
  })

  it('点亮当前阶段：之前的算完成，之后的算等待', () => {
    const host = buildPlaceholder()
    expect(markStartupStep('prepare', host)).toBe(true)
    const states = [...host.querySelectorAll('[data-startup-step]')].map((node) => node.dataset.state)
    expect(states).toEqual(['done', 'done', 'active', 'pending'])
  })

  it('第一步与最后一步的边界', () => {
    const host = buildPlaceholder()
    markStartupStep('vault', host)
    expect([...host.querySelectorAll('[data-startup-step]')].map((node) => node.dataset.state))
      .toEqual(['active', 'pending', 'pending', 'pending'])
    markStartupStep('mount', host)
    expect([...host.querySelectorAll('[data-startup-step]')].map((node) => node.dataset.state))
      .toEqual(['done', 'done', 'done', 'active'])
  })

  it('阶段不存在时什么都不改，也不报错', () => {
    const host = buildPlaceholder()
    expect(markStartupStep('nope', host)).toBe(false)
    expect([...host.querySelectorAll('[data-startup-step]')].map((node) => node.dataset.state))
      .toEqual(['active', 'pending', 'pending', 'pending'])
  })

  it('页面上没有占位时安静返回 false（例如错误页已经接管）', () => {
    expect(markStartupStep('vault')).toBe(false)
    expect(clearStartupPlaceholder()).toBe(false)
  })

  it('可以整体移除占位', () => {
    buildPlaceholder()
    expect(clearStartupPlaceholder()).toBe(true)
    expect(document.querySelector('[data-startup-placeholder]')).toBeNull()
  })
})

describe('runStartupGate 的阶段回调', () => {
  it('按顺序上报每个阶段，供占位实时跟进', async () => {
    const steps = []
    const result = await runStartupGate({
      initializeVault: vi.fn(async () => ({ ok: true })),
      recoverSync: vi.fn(async () => ({ ok: true })),
      prepareApp: vi.fn(async () => ({})),
      mountApp: vi.fn(async () => {}),
      onStep: (step) => steps.push(step),
    })
    expect(result.ok).toBe(true)
    expect(steps).toEqual(['vault', 'recovery', 'prepare', 'mount'])
  })

  it('同步恢复失败时停在第 2 步，不会谎报后续阶段', async () => {
    const steps = []
    const result = await runStartupGate({
      initializeVault: vi.fn(async () => ({ ok: true })),
      recoverSync: vi.fn(async () => ({ ok: false })),
      prepareApp: vi.fn(async () => ({})),
      onStep: (step) => steps.push(step),
    })
    expect(result.ok).toBe(false)
    expect(steps).toEqual(['vault', 'recovery'])
  })

  it('没有传 onStep 时不影响原有行为', async () => {
    const prepareApp = vi.fn(async () => ({}))
    const result = await runStartupGate({
      initializeVault: vi.fn(async () => ({ ok: true })),
      recoverSync: vi.fn(async () => ({ ok: true })),
      prepareApp,
    })
    expect(result.ok).toBe(true)
    expect(prepareApp).toHaveBeenCalledTimes(1)
  })
})