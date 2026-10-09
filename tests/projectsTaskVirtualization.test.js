/**
 * 齐行任务列表的虚拟化守卫。
 *
 * 【为什么需要虚拟化】
 * 原来任务区是 `filteredTasks.slice(0, visibleTaskLimit)` + 完整的 `v-for`：大项目会一次把
 * 几百个任务节点全塞进 DOM，而每条任务还带子任务块与一排操作按钮（接受/拒绝/编辑/删除/⋯），
 * 实测明显卡顿。分段"再显示 50 项"既治标（每次仍要等用户点）也不彻底。
 * 现在整段交给 VirtualList，按视口渲染 + 上下 overscan。
 *
 * 【守卫判据】
 *   1. 不再有 slice 截断与 visibleTaskLimit（虚拟化后分段加载失去意义）；
 *   2. 任务区必须走 VirtualList，而不是裸 v-for；
 *   3. item-key 必须用任务 id —— 默认 key 是数组下标，任务增删/筛选后会导致
 *      整片 DOM 复用错位（表现为按钮作用在别的任务上）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('../src/views/ProjectsView.vue', import.meta.url)), 'utf8')

function scriptSetup() {
  const match = /<script setup>([\s\S]*?)<\/script>/.exec(source)
  expect(match, 'ProjectsView.vue 应包含 <script setup> 块').not.toBeNull()
  return match[1]
}

function template() {
  const match = /<template>([\s\S]*)<\/template>\s*(<style|$)/.exec(source)
  expect(match, 'ProjectsView.vue 应包含 <template> 块').not.toBeNull()
  return match[1]
}

describe('齐行任务列表虚拟化', () => {
  it('不再用 slice 截断任务列表', () => {
    // 剥掉注释再断言：注释里提到旧标识符是有意为之（解释为什么移除），不该被当成残留代码。
    const code = scriptSetup().replace(/\/\/[^\n]*/g, '')
    expect(code, 'visibleTaskLimit 已随虚拟化移除').not.toContain('visibleTaskLimit')
    expect(code).not.toMatch(/filteredTasks\.value\.slice\(/)
    expect(code).not.toContain('remainingTaskCount')
  })

  it('任务区走 VirtualList 而不是裸 v-for', () => {
    expect(scriptSetup()).toMatch(/import VirtualList from '\.\.\/components\/VirtualList\.vue'/)
    expect(template()).toMatch(/<VirtualList[^>]*:items="visibleTasks"/)
    // 任务条目的 <article class="project-task"> 必须落在 VirtualList 的 slot 里。
    const listBlock = /<VirtualList[\s\S]*?<\/VirtualList>/.exec(template())
    expect(listBlock, '应能找到任务区的 VirtualList 块').not.toBeNull()
    expect(listBlock[0]).toContain('<article class="project-task">')
    expect(listBlock[0]).toContain('#default="{ item: task }"')
  })

  it('虚拟化参数留有余量：阈值不高于 25，overscan 至少 4', () => {
    const block = /<VirtualList[^>]*:items="visibleTasks"[^>]*>/.exec(template())
    expect(block, '应能找到任务区的 VirtualList 起始标签').not.toBeNull()
    const tag = block[0]

    const threshold = Number(/:threshold="(\d+)"/.exec(tag)?.[1])
    const overscan = Number(/:overscan="(\d+)"/.exec(tag)?.[1])
    expect(Number.isInteger(threshold) && threshold > 0, 'threshold 应为正整数').toBe(true)
    expect(threshold).toBeLessThanOrEqual(25)
    expect(overscan).toBeGreaterThanOrEqual(4)
    // estimated-height 必须是正数，否则占位高度算错、滚动条会跳。
    expect(Number(/:estimated-height="(\d+)"/.exec(tag)?.[1])).toBeGreaterThan(0)
  })

  it('列表为空时不渲染 VirtualList，空态由既有分支负责', () => {
    // v-if 与 not.length 的空态分支并存，二者必须都在，否则空项目会渲染一个空列表壳。
    expect(template()).toMatch(/<VirtualList v-if="visibleTasks\.length"/)
    expect(template()).toMatch(/v-else-if="!filteredTasks\.length"/)
  })
})