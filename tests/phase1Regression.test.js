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
    const actionList = source('src/components/TodayActionList.vue')
    const positions = [
      today.indexOf('aria-label="接下来"'),
      today.indexOf('mode="actions"'),
      today.indexOf('mode="risks"'),
      today.indexOf('aria-label="本周进展"'),
    ]
    const actionHeadings = [
      actionList.indexOf('aria-label="现在该做"'),
      actionList.indexOf('今天最重要'),
      actionList.indexOf('aria-label="需要注意"'),
    ]

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(actionHeadings.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(actionHeadings).toEqual([...actionHeadings].sort((a, b) => a - b))
  })

  it('高频切换控件使用正确的语义角色并暴露选中状态', () => {
    const tasks = source('src/views/TasksView.vue')
    const ledger = source('src/views/LedgerView.vue')
    // 待办筛选是**筛选控件**：它没有对应的面板，所以用 group + aria-pressed。
    // 用 tab/tablist 会让读屏念成「标签页 1/4」，并让用户期待方向键切换面板——
    // 那是 tab 模式的契约，这里根本没有面板可切（第二十八轮收敛）。
    // 这条断言锁的仍是**本意**：有语义化角色、且把选中状态暴露出来。
    expect(tasks).toContain('<ToggleGroup')
    expect(tasks).toContain('aria-label="待办筛选"')
    // Reka owns role/group and aria-pressed; taskViewQueryInteractions mounts the real control.
    expect(tasks).toContain(':model-value="filter"')
    expect(tasks).not.toContain('role="tablist"')
    // 账本分区是真标签页：有对应的 tabpanel，继续用 tab 语义。
    expect(ledger).toContain('role="tablist"')
    expect(ledger).toContain(':aria-selected="tab ===')
    expect(ledger).toContain('role="tabpanel"')
    // 行内操作收进「⋯」菜单之后，编辑与删除仍然必须是**有名字的真按钮**（ActionSheet 的菜单项），
    // 而不是退化成两个只有 ✎ / 🗑 字形、只能靠 title 猜的图标。
    // 动作清单现在由 useTaskRowActions 统一产出（列表 / 看板 / 月历共用同一份口径），
    // 所以这里锁三处：视图接线、无逻辑的菜单组件、以及动作本身仍在。
    const rowActions = source('src/components/tasks/TaskRowActions.vue')
    const rowActionRules = source('src/composables/tasks/useTaskRowActions.js')
    expect(tasks).toContain('<TaskRowActions')
    expect(tasks).toContain(':actions="taskActionItems(task)"')
    expect(rowActionRules).toContain("key: 'edit', label: '编辑'")
    expect(rowActionRules).toContain("key: 'remove', label: '删除'")
    expect(rowActionRules).toContain("tone: 'danger'")
    expect(rowActions).toContain(':aria-label="`更多操作：${subject || \'待办\'}`"')
  })
})
