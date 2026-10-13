import { describe, expect, it } from 'vitest'
import { buildAdminCenterModel, buildAdminDiagnostics } from '../src/composables/adminCenterModel.js'

const account = (values = {}) => ({ available: true, ready: true, status: 'synced', error: '', ...values })

describe('个人管理中心状态模型', () => {
  it('未知数据仍显示读取中，不把不可用误报成零记录或健康', () => {
    const model = buildAdminCenterModel({ account: account({ ready: false }) })

    expect(model.data).toMatchObject({ label: '正在读取', tone: 'pending' })
    expect(model.sync).toMatchObject({ label: '正在读取', tone: 'pending' })
    expect(model.remote.label).toBe('未接入监测')
    expect(model.hasActions).toBe(false)
  })

  it('本机分区损坏、写入失败和待备份数据会生成可操作事项', () => {
    const model = buildAdminCenterModel({
      inventory: { issues: [{ field: 'tasks' }] },
      persistence: { status: 'error', message: '待办保存未完成。' },
      backupNeedsAttention: true,
      backupTitle: '已有 7 天未备份',
    })

    expect(model.data).toMatchObject({ label: '1 个分区有问题', tone: 'warning' })
    expect(model.actions.map((item) => item.id)).toEqual(['save', 'integrity', 'backup'])
    expect(model.actions.every((item) => item.action === 'data')).toBe(true)
    expect(model.actions[0].detail).toBe('待办保存未完成。')
  })

  it('读取存储失败时保留错误并提供数据管理入口', () => {
    const model = buildAdminCenterModel({ inventoryError: '存储访问被拒绝。' })

    expect(model.data).toMatchObject({ label: '暂不可读取', tone: 'danger', detail: '存储访问被拒绝。' })
    expect(model.actions[0]).toMatchObject({ id: 'inventory', action: 'data' })
  })

  it('同步冲突和离线状态指向账号面板，不影响本机数据可用状态', () => {
    const model = buildAdminCenterModel({
      inventory: { issues: [] },
      account: account({ status: 'conflict' }),
    })

    expect(model.data.label).toBe('可读取')
    expect(model.sync).toMatchObject({ label: '需要确认', tone: 'warning' })
    expect(model.actions).toContainEqual(expect.objectContaining({ id: 'sync', action: 'account' }))
  })

  it('账号服务未配置时明确标记未配置，不冒充已同步', () => {
    const model = buildAdminCenterModel({ account: { available: false } })
    expect(model.sync).toMatchObject({ label: '未配置', tone: 'neutral' })
  })

  it('未落盘的改动必须成为待处理事项，否则刷新即丢且无任何提示', () => {
    const model = buildAdminCenterModel({
      inventory: { issues: [] },
      pendingKeys: ['sl_tasks', 'sl_bills'],
    })

    const item = model.actions.find((entry) => entry.id === 'pending-writes')
    expect(item).toMatchObject({ tone: 'danger', action: 'data' })
    expect(item.title).toBe('2 项修改尚未保存')
    expect(item.detail).toContain('仍在内存中')
  })

  it('没有待写键时不凭空造出未保存事项', () => {
    const model = buildAdminCenterModel({ inventory: { issues: [] }, pendingKeys: [] })
    expect(model.actions.some((entry) => entry.id === 'pending-writes')).toBe(false)
  })

  it('离线是状态而不是待办：如实出现在状态行，但不占一个「需要处理」名额', () => {
    const offline = buildAdminCenterModel({ inventory: { issues: [] }, online: false })
    expect(offline.network).toMatchObject({ label: '设备离线', tone: 'warning' })
    // 用户对「当前没网」没有可执行动作，不该被当成需要处理的事项。
    expect(offline.actions.some((entry) => entry.id === 'offline')).toBe(false)

    // 已登录时它由 sync 事项覆盖（account.status 会是 offline），不重复报。
    const signedIn = buildAdminCenterModel({
      inventory: { issues: [] }, online: false, account: account({ status: 'offline' }),
    })
    expect(signedIn.actions.filter((entry) => entry.id === 'sync')).toHaveLength(1)
    expect(signedIn.actions.some((entry) => entry.id === 'offline')).toBe(false)
  })

  it('联网只说明网卡有链路，不冒充在线服务可用', () => {
    const model = buildAdminCenterModel({ inventory: { issues: [] }, online: true })

    expect(model.network).toMatchObject({ label: '设备已联网', tone: 'success' })
    expect(model.network.detail).toContain('不代表任何在线服务可用')
    // 能力边界仍在：没有探针就还是「未接入监测」，不能因为联网就改口。
    expect(model.remote).toMatchObject({ label: '未接入监测', tone: 'neutral' })
  })

  it('环境不提供网络状态时标为未知，不假装联网', () => {
    const model = buildAdminCenterModel({ inventory: { issues: [] }, online: null })
    expect(model.network).toMatchObject({ label: '网络状态未知', tone: 'pending' })
  })

  it('每个事项都自带按钮文案，视图不必反推该开哪个面板', () => {
    const model = buildAdminCenterModel({
      inventory: { issues: [] },
      account: account({ status: 'error' }),
      pendingKeys: ['sl_tasks'],
    })

    expect(model.actions.find((entry) => entry.id === 'sync').actionLabel).toBe('查看账号')
    expect(model.actions.find((entry) => entry.id === 'pending-writes').actionLabel).toBe('打开数据管理')
    expect(model.actions.every((entry) => typeof entry.actionLabel === 'string' && entry.actionLabel)).toBe(true)
  })
})

describe('管理中心诊断信息', () => {
  const version = {
    appVersion: '1.1.1', channel: 'stable', buildId: 'b1', commitId: 'c1',
    schemaVersion: 3, domainSchemaVersion: 7,
  }

  it('包含版本、结构版本与本机可观测状态，便于反馈问题时定位', () => {
    const model = buildAdminCenterModel({ inventory: { issues: [] }, online: true })
    const report = JSON.parse(buildAdminDiagnostics({
      inventory: { issues: [], recordCount: 42, usage: { chars: 100, percent: 1, warning: false } },
      model,
      version,
      syncLastSyncedAt: '2026-10-13T00:00:00.000Z',
      pendingKeys: [],
      online: true,
    }))

    expect(report.version).toEqual({
      appVersion: '1.1.1', channel: 'stable', buildId: 'b1', commitId: 'c1',
      domainSchemaVersion: 7, accountSchemaVersion: 3,
    })
    expect(report.localData.recordCount).toBe(42)
    expect(report.network).toBe('online')
    expect(report.status.data).toMatchObject({ label: '可读取', tone: 'success' })
  })

  it('未读取到数据时报 unknown 而不是零记录', () => {
    const report = JSON.parse(buildAdminDiagnostics({ version }))
    expect(report.localData).toMatchObject({ readable: false, recordCount: null, textChars: null })
    expect(report.network).toBe('unknown')
    expect(report.status.data).toBeNull()
  })

  it('不导出记录内容、账号标识或错误细节', () => {
    const model = buildAdminCenterModel({
      inventory: { issues: [{ label: '待办与快速记录' }], recordCount: 3, usage: { chars: 10, percent: 1, warning: true } },
      persistence: { status: 'error', message: '本次修改未能保存到本机。' },
      account: account({ status: 'error', error: '邮箱登录失败。' }),
      online: false,
    })
    const text = buildAdminDiagnostics({
      inventory: { issues: [{ label: '待办与快速记录' }], recordCount: 3, usage: { chars: 10, percent: 1, warning: true } },
      model,
      version,
      pendingKeys: ['sl_tasks'],
      online: false,
    })
    const report = JSON.parse(text)

    // 分区**标签**可以进（帮助定位），但保存/同步的具体错误文案不进。
    expect(report.localData.partitionIssues).toEqual(['待办与快速记录'])
    expect(report.localData.pendingWriteCount).toBe(1)
    expect(text).not.toContain('本次修改未能保存到本机')
    expect(text).not.toContain('邮箱登录失败')
    expect(text).not.toContain('sl_tasks')
    for (const entry of Object.values(report.status)) {
      expect(Object.keys(entry).sort()).toEqual(['label', 'tone'])
    }
  })
})