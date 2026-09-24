import { describe, expect, it } from 'vitest'
import { filterNotes, noteText } from '../src/composables/notes.js'

describe('轻量笔记访问', () => {
  const notes = [
    { id: 'old', title: '旧笔记', content: '已归档内容', archivedAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 'new', title: '买书', content: '记得买线性代数', tags: ['学习'], updatedAt: '2026-02-02T00:00:00Z' },
  ]

  it('默认只展示未归档，并支持标题/内容/标签搜索', () => {
    expect(filterNotes(notes).map((note) => note.id)).toEqual(['new'])
    expect(filterNotes(notes, '线性').map((note) => note.id)).toEqual(['new'])
    expect(filterNotes(notes, '学习').map((note) => note.id)).toEqual(['new'])
    expect(noteText(notes[1])).toBe('记得买线性代数')
  })

  it('显式打开历史后可以查看归档笔记', () => {
    expect(filterNotes(notes, '', { includeArchived: true }).map((note) => note.id)).toEqual(['new', 'old'])
  })
})
