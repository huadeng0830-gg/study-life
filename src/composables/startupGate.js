// 启动顺序的唯一 gate：先完成本机安全副本与账号数据恢复，再准备可交互业务。
// 依赖通过参数注入，便于在浏览器启动边界测试延迟、失败与竞态。
function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function reportTiming(label, startedAt, onTiming) {
  onTiming?.({ label, durationMs: Math.round((now() - startedAt) * 100) / 100 })
}

// 启动阶段清单：index.html 的静态占位和这里共用同一套 id，
// 这样「短等待看结构」在 Vue 挂载之前就已经成立。
export const STARTUP_STEPS = Object.freeze([
  { id: 'vault', label: '检查本机数据安全' },
  { id: 'recovery', label: '恢复账号数据' },
  { id: 'prepare', label: '准备工作台数据' },
  { id: 'mount', label: '打开界面' },
])

export async function runStartupGate({ initializeVault, recoverSync, prepareApp, mountApp, onTiming, onStep } = {}) {
  onStep?.('vault')
  const vaultStartedAt = now()
  const restored = await initializeVault?.()
  reportTiming('vault', vaultStartedAt, onTiming)
  onStep?.('recovery')
  const recoveryStartedAt = now()
  const recovery = await recoverSync?.()
  reportTiming('recovery', recoveryStartedAt, onTiming)
  if (!recovery?.ok) return { ok: false, restored, recovery }
  onStep?.('prepare')
  const prepareStartedAt = now()
  const prepared = await prepareApp?.()
  reportTiming('prepare', prepareStartedAt, onTiming)
  if (mountApp) {
    onStep?.('mount')
    const mountStartedAt = now()
    await mountApp()
    reportTiming('mount', mountStartedAt, onTiming)
  }
  return { ok: true, restored, recovery, prepared }
}
