import { describe, expect, it } from 'vitest'
import { deepClone, deepCloneOptional } from '../src/utils/clone.js'

describe('deepClone（JSON 往返语义）', () => {
  it('返回的新对象与原对象不共享任何引用', () => {
    const source = { a: 1, nested: { b: [1, 2, { c: 3 }] } }
    const copy = deepClone(source)
    expect(copy).toEqual(source)
    expect(copy).not.toBe(source)
    expect(copy.nested).not.toBe(source.nested)
    expect(copy.nested.b).not.toBe(source.nested.b)
    expect(copy.nested.b[2]).not.toBe(source.nested.b[2])
    copy.nested.b[2].c = 99
    expect(source.nested.b[2].c).toBe(3)
  })

  it('与手写 JSON.parse(JSON.stringify(v)) 结果完全一致', () => {
    const source = {
      text: '三两事',
      amount: 12.5,
      list: [1, '2', null, true, { deep: { deeper: [] } }],
      flag: false,
      empty: {},
    }
    expect(deepClone(source)).toEqual(JSON.parse(JSON.stringify(source)))
    expect(deepClone(source)).toStrictEqual(JSON.parse(JSON.stringify(source)))
  })

  it('丢弃函数属性与 undefined 属性（JSON 语义，不是 structuredClone）', () => {
    const copy = deepClone({ keep: 1, fn: () => 1, missing: undefined })
    expect(copy).toEqual({ keep: 1 })
    expect(Object.keys(copy)).toEqual(['keep'])
  })

  it('Date 变 ISO 字符串、NaN/Infinity 变 null（与 JSON 往返一致）', () => {
    const copy = deepClone({ at: new Date('2026-08-29T01:02:03.000Z'), nan: NaN, inf: Infinity, negInf: -Infinity })
    expect(copy.at).toBe('2026-08-29T01:02:03.000Z')
    expect(copy.nan).toBeNull()
    expect(copy.inf).toBeNull()
    expect(copy.negInf).toBeNull()
  })

  it('原始值与 null 原样返回', () => {
    expect(deepClone(5)).toBe(5)
    expect(deepClone('x')).toBe('x')
    expect(deepClone(true)).toBe(true)
    expect(deepClone(null)).toBeNull()
    expect(deepClone([])).toEqual([])
  })

  it('undefined 与手写 JSON 往返一样抛错（不要静默返回 undefined）', () => {
    expect(() => deepClone(undefined)).toThrow(SyntaxError)
  })

  it('循环引用抛 TypeError（与 JSON.stringify 一致）', () => {
    const source = {}
    source.self = source
    expect(() => deepClone(source)).toThrow(TypeError)
  })
})

describe('deepCloneOptional（undefined 透传）', () => {
  it('undefined 原样返回，其余仍走 JSON 深拷贝', () => {
    expect(deepCloneOptional(undefined)).toBeUndefined()
    const source = { a: { b: 1 } }
    const copy = deepCloneOptional(source)
    expect(copy).toEqual(source)
    expect(copy.a).not.toBe(source.a)
    expect(deepCloneOptional(null)).toBeNull()
  })
})