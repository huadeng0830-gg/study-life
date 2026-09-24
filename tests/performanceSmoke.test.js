// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { filterNotes } from '../src/composables/notes.js'
import { filterLedgerTransactions } from '../src/composables/ledger.js'

describe('高数据量轻量 smoke', () => {
  it('按目标规模覆盖任务、交易和笔记的筛选输入', () => {
    const measure = (label, size, work) => {
      const startedAt = performance.now()
      const result = work()
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100
      console.info(`[perf-smoke] ${label} ${size}: ${durationMs}ms`)
      return result
    }

    for (const size of [100, 500, 1000]) {
      const tasks = Array.from({ length: size }, (_, id) => ({ id: `task-${id}`, title: `任务 ${id}` }))
      const orderedTasks = measure('tasks-sort', size, () => [...tasks].sort((a, b) => b.id.localeCompare(a.id)))
      expect(tasks).toHaveLength(size)
      expect(orderedTasks).toHaveLength(size)
    }

    for (const size of [500, 1000, 5000]) {
      const transactions = Array.from({ length: size }, (_, id) => ({ id: `expense-${id}`, name: `交易 ${id}`, amount: id + 1, date: '2026-09-01' }))
      expect(measure('transactions-filter', size, () => filterLedgerTransactions(transactions, { query: `交易 ${size - 1}` }))).toHaveLength(1)
    }

    for (const size of [100, 500, 1000]) {
      const notes = Array.from({ length: size }, (_, id) => ({ id: `note-${id}`, title: `笔记 ${id}`, content: `笔记 ${id}` }))
      expect(measure('notes-filter', size, () => filterNotes(notes, `笔记 ${size - 1}`))).toHaveLength(1)
    }
  })
})
