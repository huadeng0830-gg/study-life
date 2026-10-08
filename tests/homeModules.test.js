import { describe, expect, it } from 'vitest'
import {
  findHomeModuleState,
  normalizeHomeModuleOrder,
  reorderHomeModules,
  resetHomeModuleOrder,
} from '../src/composables/homeModules.js'

const definitions = [
  { id: 'next', label: '接下来' },
  { id: 'tasks', label: '待办' },
  { id: 'focus', label: '专注' },
]

describe('首页模块顺序规则', () => {
  it('保留已存顺序和可见状态，丢弃过时模块并追加新增项', () => {
    expect(normalizeHomeModuleOrder([
      { id: 'focus', visible: false },
      { id: 'retired', visible: true },
    ], definitions)).toEqual([
      { id: 'focus', visible: false },
      { id: 'next', visible: true },
      { id: 'tasks', visible: true },
    ])
  })

  it('按新位置返回副本，越界移动不改原数组', () => {
    const current = [
      { id: 'next', visible: true },
      { id: 'tasks', visible: false },
      { id: 'focus', visible: true },
    ]
    expect(reorderHomeModules(current, 2, 0).map(({ id }) => id)).toEqual(['focus', 'next', 'tasks'])
    expect(reorderHomeModules(current, -1, 0)).toBe(current)
    expect(current.map(({ id }) => id)).toEqual(['next', 'tasks', 'focus'])
  })

  it('恢复标准顺序时保留每个模块的显示开关', () => {
    expect(resetHomeModuleOrder([
      { id: 'focus', visible: false },
      { id: 'tasks', visible: true },
    ], definitions)).toEqual([
      { id: 'next', visible: true },
      { id: 'tasks', visible: true },
      { id: 'focus', visible: false },
    ])
  })

  it('模块状态缺失时默认显示', () => {
    expect(findHomeModuleState([{ id: 'next', visible: false }], 'tasks')).toEqual({ id: 'tasks', visible: true })
  })
})
