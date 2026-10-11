// @vitest-environment happy-dom
import { expect } from 'vitest'

/**
 * 打开待办行的「⋯」菜单并选中其中一项。
 *
 * 行的次要操作（改期 / 编辑 / 归档 / 恢复 / 删除 / 专注）收在 `ActionSheet` 里，
 * 而它 Teleport 到 body —— 所以点开之后菜单项**不在行里**，必须在 document 上找。
 * 找错作用域就会得到「missing action」，而行里确实有那个 `⋯` 按钮，容易误判成功能没了。
 *
 * `clickElement` 由各测试文件传入：这些文件在 `beforeEach` 里 `vi.resetModules()` 之后
 * 重新 `await import('vue')`，顶层静态 import 拿到的是重置前的旧实例，nextTick 不是同一个。
 */
export async function chooseTaskAction(row, label, clickElement) {
  const trigger = [...row.querySelectorAll('button')].find((item) => item.classList.contains('tra-trigger'))
  expect(trigger, 'missing row action trigger (⋯)').toBeTruthy()
  await clickElement(trigger)
  // 取**最后一个**浮层：同一页可能已经开过别的操作菜单，只有最上面那层是这次点开的。
  const sheets = [...document.querySelectorAll('.sheet-overlay')]
  const item = [...(sheets[sheets.length - 1]?.querySelectorAll('.sheet-action') ?? [])]
    .find((element) => element.textContent.includes(label))
  expect(item, `missing action: ${label}`).toBeTruthy()
  await clickElement(item)
}