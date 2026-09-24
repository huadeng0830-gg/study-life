// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SYNC_SPACE_ID_PATTERN,
  autoSyncEnabled,
  buildRecoveryInfo,
  clearSyncSpaceSettings,
  isSyncSpaceBound,
  pairingPayload,
  parsePairingPayload,
  parseRecoveryText,
  randomSecret,
  randomSyncSpaceId,
  recoveryText,
  saveSyncSpaceSettings,
  syncSpaceBootstrapPending,
  syncSpaceSettings,
} from '../src/composables/syncSpace.js'

describe('SyncSpace 本地身份材料', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSyncSpaceSettings()
  })

  it('生成高随机空间编号和至少 256-bit 的秘密材料', () => {
    const id = randomSyncSpaceId()
    const secret = randomSecret(32)
    expect(id).toMatch(SYNC_SPACE_ID_PATTERN)
    expect(secret.length).toBeGreaterThanOrEqual(42)
  })

  it('本地绑定只保存设备凭证和 payload key，不进入业务同步设置', () => {
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), autoSyncEnabled: true })
    expect(isSyncSpaceBound.value).toBe(true)
    expect(autoSyncEnabled.value).toBe(true)
    expect(localStorage.getItem('sl_sync_settings')).toBeNull()
    expect(syncSpaceSettings.value).toHaveProperty('deviceCredential')
  })

  it('刷新后仍保留 bootstrap pending，不能把临时绑定当成已完成空间', async () => {
    saveSyncSpaceSettings({ spaceId: 'AB7K-P9M2-X4DQ', deviceCredential: randomSecret(), payloadKey: randomSecret(), bootstrapPending: true, autoSyncEnabled: true })
    expect(syncSpaceBootstrapPending.value).toBe(true)
    expect(JSON.parse(localStorage.getItem('study_life_sync_space'))).toMatchObject({ bootstrapPending: true, autoSyncEnabled: false })
  })

  it('pairing payload 只包含空间编号和一次性 token，不包含 payload key', () => {
    const pairingToken = randomSecret()
    const payload = pairingPayload({ spaceId: 'AB7K-P9M2-X4DQ', pairingToken, expiresAt: new Date().toISOString() })
    expect(parsePairingPayload(payload)).toMatchObject({ spaceId: 'AB7K-P9M2-X4DQ', pairingToken })
    expect(payload).not.toContain('payloadKey')
  })

  it('把单独的同步空间编号粘贴为绑定内容时给出可操作提示', () => {
    expect(() => parsePairingPayload('XTT8-NLWV-T5NH-6TR6')).toThrow('这是同步空间编号')
  })

  it('恢复信息可以导出并再次解析，且明确没有账号找回机制', () => {
    const settings = { spaceId: 'AB7K-P9M2-X4DQ', payloadKey: randomSecret() }
    expect(buildRecoveryInfo(settings)).toMatchObject({ spaceId: settings.spaceId, recoverySecret: settings.payloadKey })
    const text = recoveryText(settings)
    expect(text).toContain('没有账号找回机制')
    expect(parseRecoveryText(text)).toEqual({ spaceId: settings.spaceId, recoverySecret: settings.payloadKey })
  })
})
