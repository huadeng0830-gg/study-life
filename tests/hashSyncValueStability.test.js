// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hashSyncValue } from '../src/composables/syncMetadata.js'

// 原始实现（未加缓存前的那一版），用来逐字比对。
function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function canonicalSyncValue(value) {
  if (value === undefined) return undefined
  try { return JSON.parse(JSON.stringify(value)) } catch { return value }
}
function originalHash(value) {
  if (value === undefined) return ''
  const input = stableValue(canonicalSyncValue(value))
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

describe('hashSyncValue 的缓存不改变结果', () => {
  const samples = [
    undefined,
    null,
    0,
    '',
    'abc',
    [],
    {},
    [1, 2, 3],
    { b: 2, a: 1 },
    { a: 1, b: 2 },
    { z: [1, { y: 2, x: 3 }], a: 'x' },
    { n: null, t: true, f: 1.5 },
    [[1, [2, [3]]]],
    { deep: { deep: { deep: { deep: 'leaf' } } } },
    { 'unicode-键': '值', emoji: '😀' },
    [{ id: 'a', amount: 100 }, { id: 'b', amount: 200 }],
    { undefinedProp: undefined, real: 1 },
  ]

  it('每一项都与原实现逐字一致', () => {
    for (const sample of samples) {
      expect(hashSyncValue(sample), JSON.stringify(sample)).toBe(originalHash(sample))
    }
  })

  it('键顺序不同的两个对象仍然同指纹（稳定化没被缓存破坏）', () => {
    expect(hashSyncValue({ a: 1, b: 2 })).toBe(hashSyncValue({ b: 2, a: 1 }))
    // 先跑一次填缓存，再换顺序跑，验证走的是缓存路径也一致
    expect(hashSyncValue({ c: 3, d: 4 })).toBe(hashSyncValue({ d: 4, c: 3 }))
  })

  it('缓存命中后仍能区分不同内容（不会把不同值算成同一个指纹）', () => {
    const a = { id: 'x', amount: 1 }
    const b = { id: 'x', amount: 2 }
    expect(hashSyncValue(a)).toBe(hashSyncValue(a))
    expect(hashSyncValue(a)).not.toBe(hashSyncValue(b))
    expect(hashSyncValue(a)).toBe(originalHash(a))
    expect(hashSyncValue(b)).toBe(originalHash(b))
  })

  it('就地修改后再算，必须拿到新指纹（这是没按对象身份缓存的关键理由）', () => {
    const mutable = { id: 'y', amount: 1 }
    const before = hashSyncValue(mutable)
    mutable.amount = 2
    expect(hashSyncValue(mutable)).not.toBe(before)
    expect(hashSyncValue(mutable)).toBe(originalHash({ id: 'y', amount: 2 }))
  })
})
