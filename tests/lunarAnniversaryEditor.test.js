// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useLunarAnniversaryEditor } from '../src/composables/lunarAnniversaryEditor.js'
import {
  LUNAR_ANNIVERSARY_KEY,
  readLunarAnniversaries,
  resetLunarAnniversaryMirror,
} from '../src/composables/lunarAnniversaries.js'
import { flushStoredWrites, useStoredRef } from '../src/composables/store/index.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()

const stored = useStoredRef(LUNAR_ANNIVERSARY_KEY, [])

beforeEach(() => {
  stored.value = []
  flushStoredWrites()
  localStorage.removeItem(LUNAR_ANNIVERSARY_KEY)
  resetLunarAnniversaryMirror()
})

afterEach(() => {
  stored.value = []
  flushStoredWrites()
  localStorage.removeItem(LUNAR_ANNIVERSARY_KEY)
  resetLunarAnniversaryMirror()
})

describe('农历纪念日编辑模型', () => {
  it('保留编辑行 ID 并把有效条目按既有形状写入存储', () => {
    // 先模拟首页已经读取过空镜像，再验证编辑提交能让它立即可见。
    expect(readLunarAnniversaries()).toEqual([])
    const editor = useLunarAnniversaryEditor(ref('2026-06-19'))
    const id = editor.add()

    editor.setMonth(id, 5)
    editor.setDay(id, 5)
    editor.setLabel(id, '外婆生日')

    expect(stored.value).toEqual([
      { id, label: '外婆生日', lunarMonth: 5, lunarDay: 5, isLeapMonth: false },
    ])
    expect(readLunarAnniversaries()).toEqual(stored.value)
    expect(editor.resolutionText(editor.rows.value[0])).toContain('2026-06-19')
    expect(editor.resolutionClass(editor.rows.value[0])).toBe('')

    editor.sync()
    expect(editor.rows.value[0].id).toBe(id)
    editor.remove(id)
    expect(stored.value).toEqual([])
  })

  it('空名称只保留为面板草稿，闰月不存在时给出不可用状态', () => {
    const editor = useLunarAnniversaryEditor(ref('2026-06-19'))
    const id = editor.add()
    editor.setMonth(id, 4)
    editor.setDay(id, 1)
    editor.setLeapMonth(id, true)

    expect(editor.rows.value).toHaveLength(1)
    expect(stored.value).toEqual([])
    expect(editor.resolutionText(editor.rows.value[0])).toContain('该年没有这个闰月')
    expect(editor.resolutionClass(editor.rows.value[0])).toBe('off')

    editor.setLabel(id, '闰四月纪念')
    expect(stored.value[0]).toMatchObject({
      id,
      label: '闰四月纪念',
      lunarMonth: 4,
      lunarDay: 1,
      isLeapMonth: true,
    })
  })
})
