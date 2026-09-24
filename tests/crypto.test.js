// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptData, encryptData } from '../src/utils/crypto.js'

function deterministicText(length) {
  let seed = 0x12345678
  let result = ''
  for (let index = 0; index < length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    result += String.fromCharCode(32 + (seed % 95))
  }
  return result
}

describe('云同步大数据加密', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('超过单次函数参数上限的数据仍可完整加解密', async () => {
    const value = { records: deterministicText(180_000) }
    const encrypted = await encryptData(value, '123456')

    expect(encrypted.length).toBeGreaterThan(125_000)
    await expect(decryptData(encrypted, '123456')).resolves.toEqual(value)
  })

  it('浏览器没有 CompressionStream / DecompressionStream 时使用无压缩兼容路径', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    vi.stubGlobal('DecompressionStream', undefined)
    const value = { message: '兼容模式同步数据' }
    const encrypted = await encryptData(value, '123456')
    await expect(decryptData(encrypted, '123456')).resolves.toEqual(value)
  })
})
