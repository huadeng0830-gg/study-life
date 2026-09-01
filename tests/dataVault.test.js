import { describe, expect, it } from 'vitest'
import { shouldMirrorValue } from '../src/composables/dataVault.js'

describe('本地安全副本写入策略', () => {
  it('启动阶段不让可疑空集合覆盖最后一份非空副本', () => {
    expect(shouldMirrorValue('[]', '[{"id":"old"}]')).toBe(false)
  })

  it('用户已确认的删除会同步空集合，避免旧记录复活', () => {
    expect(shouldMirrorValue('[]', '[{"id":"old"}]', { allowEmpty: true })).toBe(true)
    expect(shouldMirrorValue('{}', '{"2026-08-30":{"mood":"😊"}}', { allowEmpty: true })).toBe(true)
  })

  it('非空新值始终可以更新安全副本', () => {
    expect(shouldMirrorValue('[{"id":"new"}]', '[{"id":"old"}]')).toBe(true)
  })
})
