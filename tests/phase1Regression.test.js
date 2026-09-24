import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { disableLocalSafeMode, enableLocalSafeMode, localSafeMode } from '../src/composables/localSafeMode.js'

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('Phase 1 交互回归契约', () => {
  it('同步恢复失败只进入可退出的本机安全模式', () => {
    enableLocalSafeMode()
    expect(localSafeMode.value).toBe(true)
    disableLocalSafeMode()
    expect(localSafeMode.value).toBe(false)
  })

  it('首页首屏顺序为接下来、最重要、风险、本周', () => {
    const today = source('src/views/TodayView.vue')
    expect(today.indexOf('aria-label="接下来"')).toBeLessThan(today.indexOf('aria-label="现在该做"'))
    expect(today.indexOf('今天最重要')).toBeLessThan(today.indexOf('需要注意'))
    expect(today.indexOf('需要注意')).toBeLessThan(today.indexOf('本周进展'))
  })

  it('高频切换控件使用正确的语义角色并暴露选中状态', () => {
    const tasks = source('src/views/TasksView.vue')
    const ledger = source('src/views/LedgerView.vue')
    // 待办筛选是**筛选控件**：它没有对应的面板，所以用 group + aria-pressed。
    // 用 tab/tablist 会让读屏念成「标签页 1/4」，并让用户期待方向键切换面板——
    // 那是 tab 模式的契约，这里根本没有面板可切（第二十八轮收敛）。
    // 这条断言锁的仍是**本意**：有语义化角色、且把选中状态暴露出来。
    expect(tasks).toContain('role="group" aria-label="待办筛选"')
    expect(tasks).toContain(':aria-pressed="filter ===')
    expect(tasks).not.toContain('role="tablist"')
    // 账本分区是真标签页：有对应的 tabpanel，继续用 tab 语义。
    expect(ledger).toContain('role="tablist"')
    expect(ledger).toContain(':aria-selected="tab ===')
    expect(ledger).toContain('role="tabpanel"')
    expect(tasks).toContain('aria-label="编辑待办"')
    expect(tasks).toContain('aria-label="删除待办"')
  })
})
