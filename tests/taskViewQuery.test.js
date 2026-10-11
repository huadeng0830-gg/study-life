import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_LIST_STATE,
  SORT_DEFAULT_DIR,
  hasExplicitFilter,
  readTaskListState,
  resolveSortDir,
  toggledSortDir,
  writeTaskListState,
} from '../src/composables/tasks/taskViewQuery.js'

describe('待办列表状态的路由 query 编解码', () => {
  it('干净地址解析出全部默认值，地址栏里一个参数都不出现', () => {
    expect(readTaskListState({})).toEqual({ ...DEFAULT_TASK_LIST_STATE, dir: 'asc' })
    expect(writeTaskListState({}, {})).toEqual({})
  })

  it('脏值一律退回默认，而不是变成一个用户没选过的状态', () => {
    const state = readTaskListState({ f: 'zzz', sort: 'size', dir: 'sideways', prio: 'urgent', when: 'yesterday', hist: 'true' })
    expect(state).toEqual({ ...DEFAULT_TASK_LIST_STATE, dir: 'asc' })
    // 数组（?q=a&q=b）与 null 都按缺省处理，不取第一个也不抛错。
    expect(readTaskListState({ q: ['a', 'b'] }).q).toBe('a')
    expect(readTaskListState({ q: null }).q).toBe('')
  })

  it('写侧只保留与默认值不同的键，搜索词为空时地址栏不留痕', () => {
    expect(writeTaskListState({}, { filter: 'unplanned', query: '', priority: 'all' })).toEqual({ f: 'unplanned' })
    expect(writeTaskListState({}, { q: '高数' })).toEqual({ q: '高数' })
  })

  it('写侧保留不归本模块管理的键——只改排序不能顺手抹掉月份和深链高亮', () => {
    const query = { view: 'calendar', month: '2026-11', focus: 'task-7', sort: 'created' }
    expect(writeTaskListState(query, { sort: 'priority' })).toEqual({ view: 'calendar', month: '2026-11', focus: 'task-7', sort: 'priority' })
  })

  it('方向按排序键的基准解析：截止与优先级默认升序，创建时间默认降序', () => {
    expect(resolveSortDir('due', '')).toBe('asc')
    expect(resolveSortDir('created', '')).toBe('desc')
    expect(resolveSortDir('created', 'asc')).toBe('asc')
    // 方向与基准相同时不写进地址栏；不同才写。
    expect(writeTaskListState({}, { sort: 'created', dir: 'desc' })).toEqual({ sort: 'created' })
    expect(writeTaskListState({}, { sort: 'created', dir: 'asc' })).toEqual({ sort: 'created', dir: 'asc' })
    expect(writeTaskListState({}, { sort: 'due', dir: 'desc' })).toEqual({ dir: 'desc' })
  })

  it('切换方向在基准与反面之间来回，而不是永远加一档', () => {
    // 基准是 asc 的翻到 desc；基准是 desc 的翻到 asc。
    expect(toggledSortDir({ sort: 'due', dir: 'asc' })).toBe('desc')
    expect(toggledSortDir({ sort: 'due', dir: 'desc' })).toBe('asc')
    expect(toggledSortDir({ sort: 'created', dir: 'desc' })).toBe('asc')
    expect(toggledSortDir({ sort: 'created', dir: 'asc' })).toBe('desc')
    expect(SORT_DEFAULT_DIR.created).toBe('desc')
  })

  it('只有地址栏显式带了筛选才算用户选过，智能默认才知道要让位', () => {
    expect(hasExplicitFilter({})).toBe(false)
    expect(hasExplicitFilter({ f: 'zzz' })).toBe(false)
    expect(hasExplicitFilter({ f: 'completed' })).toBe(true)
    // 即使显式选的就是默认值，也要算「选过」——否则刷新会把用户的确认再顶掉一次。
    expect(hasExplicitFilter({ f: 'scheduled' })).toBe(true)
  })

  it('归档开关写成 hist=1，不写其它真值形式', () => {
    expect(writeTaskListState({}, { history: true })).toEqual({ hist: '1' })
    expect(writeTaskListState({}, { history: false })).toEqual({})
    expect(readTaskListState({ hist: '1' }).history).toBe(true)
  })

  it('搜索词截断到 200 字符，避免超长 query 撑爆地址栏', () => {
    expect(readTaskListState({ q: 'x'.repeat(500) }).q).toHaveLength(200)
  })

  it('写侧不改传入的 query 对象', () => {
    const query = { view: 'board', sort: 'due' }
    const next = writeTaskListState(query, { filter: 'all', sort: 'priority' })
    expect(query).toEqual({ view: 'board', sort: 'due' })
    expect(next).not.toBe(query)
  })
})