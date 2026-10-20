// @vitest-environment node
/**
 * 2.1 收敛守卫：账本这条路径不再有第二份「一句话记」入口。
 *
 * 【为什么行为用例之外还要一条源码守卫】quickEntryModalClose.test.js 只能覆盖它真实渲染到
 * 的那几个状态；这一条把「重复入口不许回来」钉在源码上：一旦有人在「记一笔」里重新 import
 * 或渲染 QuickRecordPanel，或在 LedgerView 里重新接 `show-quick-record` /
 * `open-quick-record` / `quick-record-saved`，这里立刻红——那正是本轮删掉的东西。
 * 断言前先剥注释：这些文件里"解释为什么删掉它"的注释本来就会提到旧名字。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

/** 剥掉模板/脚本注释（保留代码），避免"解释为什么删掉它"的注释把守卫判红。 */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('账本页只有一个「一句话记」入口（2.1）', () => {
  it('「记一笔」弹窗不再引入或渲染第二份 QuickRecordPanel', () => {
    const modal = stripComments(read('../src/views/ledger-panels/QuickEntryModal.vue'))
    expect(modal).not.toContain('QuickRecordPanel')
    expect(modal).not.toContain('natural-entry-link')
    expect(modal, '已删除的 prop / 事件不许回来').not.toMatch(/showQuickRecord/)
  })

  it('LedgerView 不再往「记一笔」上传这一层的 prop / 事件', () => {
    const ledger = stripComments(read('../src/views/LedgerView.vue'))
    for (const dead of ['show-quick-record', 'open-quick-record', 'quick-record-saved']) {
      expect(ledger, `LedgerView 里还留着 ${dead} 接线`).not.toContain(dead)
    }
  })

  it('唯一入口（外壳的快速记录）仍然在 /bills 注入支出上下文', () => {
    const app = stripComments(read('../src/App.vue'))
    expect(app, '外壳入口就是唯一入口，/bills 的默认类型必须留在它这里').toMatch(/route\.path === '\/bills'\) return \{ preferredType: 'expense' \}/)
  })
})