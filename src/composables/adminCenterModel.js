const SYNC_STATUS = Object.freeze({
  'signed-out': { label: '未登录', tone: 'neutral', detail: '本机功能可继续使用；登录账号后可选择跨设备同步。' },
  disabled: { label: '已暂停', tone: 'neutral', detail: '账号同步已关闭，本机记录仍可使用。' },
  preparing: { label: '准备中', tone: 'pending', detail: '正在检查当前账号的本机数据。' },
  checking: { label: '检查中', tone: 'pending', detail: '正在检查账号端是否有更新。' },
  syncing: { label: '同步中', tone: 'pending', detail: '正在同步当前账号的数据。' },
  synced: { label: '已同步', tone: 'success', detail: '本机数据已与当前账号同步。' },
  offline: { label: '等待联网', tone: 'warning', detail: '本机修改已保存；联网后账号同步会继续。' },
  conflict: { label: '需要确认', tone: 'warning', detail: '账号数据存在冲突，请打开账号面板逐项处理。' },
  error: { label: '同步未完成', tone: 'danger', detail: '本机记录仍在；打开账号面板查看原因并重试。' },
})

function persistencePresentation(state = {}, safeMode = false) {
  if (state.status === 'error' || state.status === 'conflict') {
    return {
      label: state.status === 'conflict' ? '保存冲突' : '保存失败',
      tone: state.status === 'conflict' ? 'warning' : 'danger',
      detail: state.message || '最近一次本机写入需要处理。',
    }
  }
  if (safeMode) {
    return { label: '本机安全模式', tone: 'warning', detail: '账号同步已暂停；本机仍可读取、编辑和导出记录。' }
  }
  if (state.status === 'recovered') {
    return { label: '本机保存已恢复', tone: 'success', detail: state.message || '此前的保存问题已恢复。' }
  }
  return { label: '暂无未解决错误', tone: 'neutral', detail: '这里显示应用记录到的本机写入问题；不会主动写入测试数据。' }
}

function inventoryPresentation(inventory, error) {
  if (error) return { label: '暂不可读取', tone: 'danger', detail: error }
  if (!inventory) return { label: '正在读取', tone: 'pending', detail: '正在读取此设备保存的数据。' }
  if (inventory.issues.length) {
    return {
      label: `${inventory.issues.length} 个分区有问题`, tone: 'warning',
      detail: '统计保留了可读取的数据；打开数据管理查看受影响的分区并先导出备份。',
    }
  }
  return { label: '可读取', tone: 'success', detail: '已读取当前设备的数据分区。' }
}

/** Build truthful, device-scoped status and follow-up actions from existing app state. */
export function buildAdminCenterModel({
  inventory = null,
  inventoryError = '',
  persistence = {},
  safeMode = false,
  account = {},
  backupNeedsAttention = false,
  backupTitle = '建议导出备份',
}) {
  const data = inventoryPresentation(inventory, inventoryError)
  const save = persistencePresentation(persistence, safeMode)
  let sync
  if (!account.available) {
    sync = { label: '未配置', tone: 'neutral', detail: '此版本未配置账号同步服务，本机功能仍可使用。' }
  } else if (!account.ready) {
    sync = { label: '正在读取', tone: 'pending', detail: '正在读取账号与同步状态。' }
  } else {
    sync = SYNC_STATUS[account.status] || {
      label: '状态未知', tone: 'neutral', detail: '账号同步状态暂不可识别，请在数据管理中查看。',
    }
    if (account.status === 'error' && account.error) sync = { ...sync, detail: account.error }
  }

  const actions = []
  if (['error', 'conflict'].includes(persistence.status)) {
    actions.push({ id: 'save', tone: 'danger', title: '本机保存需要处理', detail: save.detail, action: 'data' })
  }
  if (inventoryError) {
    actions.push({ id: 'inventory', tone: 'danger', title: '无法读取本机数据', detail: inventoryError, action: 'data' })
  } else if (inventory?.issues.length) {
    actions.push({ id: 'integrity', tone: 'warning', title: '部分数据无法读取', detail: data.detail, action: 'data' })
  }
  if (account.status === 'conflict' || account.status === 'error' || account.status === 'offline') {
    actions.push({ id: 'sync', tone: account.status === 'error' ? 'danger' : 'warning', title: sync.label, detail: sync.detail, action: 'account' })
  }
  if (backupNeedsAttention) {
    actions.push({ id: 'backup', tone: 'warning', title: backupTitle, detail: '导出 JSON 备份并将文件保存在应用之外。', action: 'data' })
  }

  return {
    data,
    save,
    sync,
    actions,
    hasActions: actions.length > 0,
    remote: {
      label: '未接入监测',
      tone: 'neutral',
      detail: 'Pages、Supabase 与协作服务没有健康探针；本页不把静态页面可打开当作服务正常。',
    },
  }
}
