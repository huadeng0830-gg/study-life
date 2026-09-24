// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearFocusQuery, findFocusElement, focusElementWhenReady, focusLocation, readFocusQuery } from '../src/composables/focusNavigation.js'

afterEach(() => { document.body.innerHTML = '' })

describe('统一 Focus Navigation contract', () => {
  it('使用 stable id 生成和读取 focus/section/date，并支持清理', () => {
    const location = focusLocation('/schedule', 'course-1', { section: 'course', date: '2026-09-07' })
    expect(location).toEqual({ path: '/schedule', query: { section: 'course', date: '2026-09-07', focus: 'course-1' } })
    expect(readFocusQuery(location)).toEqual({ id: 'course-1', section: 'course', date: '2026-09-07' })
    expect(clearFocusQuery(location.query)).toEqual({})
  })

  it('可以在 DOM 延迟出现时定位并高亮目标，找不到时返回 null', async () => {
    document.body.innerHTML = '<article data-focus-id="task-1"></article>'
    const target = findFocusElement('task-1')
    expect(target).not.toBeNull()
    const result = await focusElementWhenReady('task-1')
    expect(result).toBe(target)
    expect(target.classList.contains('focus-target-highlight')).toBe(true)
    expect(await focusElementWhenReady('missing', { attempts: 1 })).toBeNull()
  })

  it('router replace 清除定位参数但保留其它查询', async () => {
    const router = { replace: vi.fn(() => Promise.resolve()) }
    const { clearFocusFromRoute } = await import('../src/composables/focusNavigation.js')
    await clearFocusFromRoute(router, { query: { focus: 'task-1', section: 'tasks', tab: 'all' } })
    expect(router.replace).toHaveBeenCalledWith({ query: { tab: 'all' } })
  })
})
