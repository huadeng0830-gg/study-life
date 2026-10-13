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

/** 每个待处理事项自带按钮文案，视图不再用三元表达式反推该点哪个面板。 */
const ACTION_LABELS = Object.freeze({ account: '查看账号', data: '打开数据管理' })

/** 诊断里最多回带几条静默失败；再多只是噪声，且 `silentErrors` 本身只留 20 条。 */
const SILENT_ERROR_LIMIT = 10

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

/**
 * 浏览器网络状态是**设备信号**，不是服务健康度：`navigator.onLine === true`
 * 只说明网卡有链路，并不代表 Pages、Supabase 或协作服务可达。因此这里分两行呈现，
 * 一行报可观测的设备状态，一行明确说明哪些服务仍无探针——两者都不猜。
 */
function networkPresentation(online) {
  if (online === true) {
    return { label: '设备已联网', tone: 'success', detail: '浏览器报告当前设备有网络连接；这不代表任何在线服务可用。' }
  }
  if (online === false) {
    return { label: '设备离线', tone: 'warning', detail: '浏览器报告当前设备没有网络连接；本机记录不受影响，账号同步会等待联网。' }
  }
  return { label: '网络状态未知', tone: 'pending', detail: '当前环境没有提供浏览器网络状态；本机功能不受影响。' }
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
  pendingKeys = [],
  online = null,
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

  const unsaved = Array.isArray(pendingKeys) ? pendingKeys : []
  const actions = []
  const push = (item) => actions.push({ ...item, actionLabel: ACTION_LABELS[item.action] || ACTION_LABELS.data })

  if (['error', 'conflict'].includes(persistence.status)) {
    push({ id: 'save', tone: 'danger', title: '本机保存需要处理', detail: save.detail, action: 'data' })
  }
  if (inventoryError) {
    push({ id: 'inventory', tone: 'danger', title: '无法读取本机数据', detail: inventoryError, action: 'data' })
  } else if (inventory?.issues.length) {
    push({ id: 'integrity', tone: 'warning', title: '部分数据无法读取', detail: data.detail, action: 'data' })
  }
  // 仍未落盘的键是「刷新即丢」的真实风险：静默失败路径只写 console，
  // 没有这一项，用户要等到关页面才发现内容没存上。
  if (unsaved.length) {
    push({
      id: 'pending-writes',
      tone: 'danger',
      title: `${unsaved.length} 项修改尚未保存`,
      detail: '这些改动仍在内存中，写入本机存储失败或尚未完成。请立即导出备份，并检查浏览器的网站存储权限。',
      action: 'data',
    })
  }
  if (account.status === 'conflict' || account.status === 'error' || account.status === 'offline') {
    push({ id: 'sync', tone: account.status === 'error' ? 'danger' : 'warning', title: sync.label, detail: sync.detail, action: 'account' })
  }
  // 离线**不**单独生成事项：它是状态而不是待办，用户对"当前没网"没有可执行的动作。
  // 已登录时它已经由上面的 sync 事项覆盖（account.status 会是 offline）；
  // 未登录时它只需要如实出现在状态行，不需要再占一个"需要处理"名额。
  if (backupNeedsAttention) {
    push({ id: 'backup', tone: 'warning', title: backupTitle, detail: '导出 JSON 备份并将文件保存在应用之外。', action: 'data' })
  }

  return {
    data,
    save,
    sync,
    network: networkPresentation(online),
    actions,
    hasActions: actions.length > 0,
    // 远程服务仍无健康探针。这是本页明确的能力边界，单独成行保留，
    // 不与「设备已联网」混为一谈——后者只是网卡信号。
    remote: {
      label: '未接入监测',
      tone: 'neutral',
      detail: 'Pages、Supabase 与协作服务没有健康探针；本页不把静态页面可打开当作服务正常。',
    },
  }
}

/**
 * 管理中心诊断摘要。**只包含已知字段**：
 * 不含记录内容、邮箱、用户 ID、URL、请求头或任意错误堆栈，
 * 与 `formatUpdateDiagnostic` 的同一条隐私约束一致。
 *
 * 静默失败只报**作用域与时间**，不报错误原文：`recordSilentError` 收到的是
 * 真实异常，其 message 可能带着用户内容（例如配额错误里附带的键名或片段）。
 * 报出 `storage-local` 就足以定位到存储层，排查者再去要原始堆栈。
 */
export function buildAdminDiagnostics({ inventory = null, model = null, version = {}, syncLastSyncedAt = '', pendingKeys = [], online = null, silentErrors = [] } = {}) {
  const status = (entry) => (entry ? { label: entry.label, tone: entry.tone } : null)
  const recent = (Array.isArray(silentErrors) ? silentErrors : []).slice(-SILENT_ERROR_LIMIT)
  return JSON.stringify({
    app: 'study-life',
    version: {
      appVersion: version.appVersion || 'unknown',
      channel: version.channel || 'unknown',
      buildId: version.buildId || 'unknown',
      commitId: version.commitId || 'unknown',
      domainSchemaVersion: version.domainSchemaVersion ?? 'unknown',
      accountSchemaVersion: version.schemaVersion ?? 'unknown',
    },
    localData: {
      readable: Boolean(inventory) && !inventory?.issues?.length,
      partitionIssues: (inventory?.issues || []).map((issue) => issue.label),
      recordCount: inventory?.recordCount ?? null,
      textChars: inventory?.usage?.chars ?? null,
      storagePercent: inventory?.usage?.percent ?? null,
      storageWarning: inventory?.usage?.warning ?? null,
      pendingWriteCount: Array.isArray(pendingKeys) ? pendingKeys.length : 0,
    },
    status: {
      data: status(model?.data),
      save: status(model?.save),
      sync: status(model?.sync),
      network: status(model?.network),
      remote: status(model?.remote),
    },
    accountSyncLastSyncedAt: syncLastSyncedAt || null,
    network: online === null ? 'unknown' : online ? 'online' : 'offline',
    recentSilentFailures: recent.map(({ scope, at }) => ({ scope: String(scope), at })),
  }, null, 2)
}