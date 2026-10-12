const ACTIVE = new Set(['checking', 'downloading', 'installing', 'verifying', 'updating'])
const LABELS = { idle: '自动检查已开启', checking: '检查中', latest: '已是最新', available: '发现新版本',
  downloading: '正在下载新版本', ready: '新版本已准备', installing: '正在安装更新', verifying: '正在验证更新',
  updating: '正在启用新版本', 'manual-reload': '新版待应用', completed: '更新成功',
  blocked: '需要更新', cancelled: '下载已取消', error: '更新失败', warning: '暂时无法更新', unavailable: '更新暂不可用' }

export function getUpdatePresentation(state, desktop = false) {
  const stage = state.stage
  const busy = ACTIVE.has(stage)
  const tone = ['latest', 'completed'].includes(stage) ? 'success'
    : ['error', 'unavailable'].includes(stage) ? 'error'
      : ['warning', 'manual-reload', 'blocked'].includes(stage) ? 'warning' : 'info'
  let action = 'check'
  let actionLabel = '检查更新'
  let disabled = busy || Boolean(state.taskPending)
  if (stage === 'checking') actionLabel = '正在检查…'
  else if (stage === 'downloading') actionLabel = '正在下载…'
  else if (stage === 'installing') actionLabel = '正在安装…'
  else if (stage === 'verifying' || stage === 'updating') actionLabel = '正在验证…'
  else if (stage === 'available' || stage === 'cancelled') { action = desktop ? 'download' : 'apply'; actionLabel = stage === 'cancelled' ? '重新下载' : '立即更新' }
  else if (stage === 'ready' || stage === 'manual-reload') { action = desktop ? 'install' : 'apply'; actionLabel = desktop ? '重启并安装' : '立即重新加载' }
  else if (stage === 'blocked') { action = desktop ? 'download' : 'apply'; actionLabel = desktop ? '下载必需更新' : '应用必需更新' }
  else if (stage === 'latest' || stage === 'completed') { actionLabel = stage === 'completed' ? '更新完成' : '已是最新版本'; disabled = true }
  else if (['error', 'warning', 'unavailable'].includes(stage)) {
    action = state.error?.retryAction || 'check'
    actionLabel = { download: '重试下载', install: '重试安装', apply: '重新加载', repair: '修复更新缓存', wait: '继续等待下载', check: '重新检查' }[action]
    disabled = action === 'wait' ? false : Boolean(state.taskPending) || state.canRetry === false || stage === 'unavailable'
    if (state.taskPending && action !== 'wait') actionLabel = '等待后台任务结束'
  }
  const phaseIndex = { checking: 0, available: 0, blocked: 0, downloading: 1, ready: 2, installing: 2,
    'manual-reload': 3, verifying: 3, updating: 3, completed: 4 }[stage] ?? -1
  return { stage, statusLabel: LABELS[stage] || LABELS.idle, tone, busy, action, actionLabel, disabled,
    phaseIndex, showProgress: ['downloading', 'ready', 'installing', 'verifying', 'updating', 'manual-reload', 'blocked'].includes(stage),
    canCheckAgain: !busy && !state.taskPending && !['available', 'ready', 'manual-reload', 'unavailable'].includes(stage) }
}
