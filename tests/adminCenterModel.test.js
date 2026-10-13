import { describe, expect, it } from 'vitest'
import { buildAdminCenterModel } from '../src/composables/adminCenterModel.js'

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
})
