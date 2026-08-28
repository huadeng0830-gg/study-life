// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
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
  it('超过单次函数参数上限的数据仍可完整加解密', async () => {
    const value = { records: deterministicText(180_000) }
    const encrypted = await encryptData(value, '123456')

    expect(encrypted.length).toBeGreaterThan(125_000)
    await expect(decryptData(encrypted, '123456')).resolves.toEqual(value)
  })
})
