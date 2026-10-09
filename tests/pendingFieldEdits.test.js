import { describe, expect, it } from 'vitest'
import { usePendingFieldEdits } from '../src/composables/pendingFieldEdits.js'

/**
 * 未保存字段草稿在「服务端整体替换」后的保留行为。
 *
 * 【要挡住的真实数据丢失】
 * 页面普遍有定时自动刷新（齐行每 120 秒一次）。凡是 `v-model` 直接绑在**服务端返回对象**
 * 上的输入框，都会在刷新时随整个数组一起被换掉，用户正在输入的文字静默消失、没有任何
 * 报错。齐行交付检查的「凭证或说明」就是这样丢数据的。
 */
describe('usePendingFieldEdits', () => {
  it('服务端重新拉取后，未保存的值盖回同一条记录', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-1', '已上传验收报告 v2.pdf')

    // 模拟刷新：服务端返回一份全新的对象，用户输入的那段文字不在里面。
    const fetched = [{ id: 'check-1', title: '确认实验数据', evidence: '' }]
    const applied = edits.reapply(fetched, 'evidence')

    expect(applied).toBe(1)
    expect(fetched[0].evidence).toBe('已上传验收报告 v2.pdf')
  })

  it('只覆盖被本地改动过的那一条，其余保持服务端值', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-2', '本机补充的说明')

    const fetched = [
      { id: 'check-1', evidence: '服务端的新值' },
      { id: 'check-2', evidence: '服务端旧值' },
      { id: 'check-3', evidence: '服务端的新值' },
    ]
    edits.reapply(fetched, 'evidence')

    expect(fetched.map((item) => item.evidence)).toEqual(['服务端的新值', '本机补充的说明', '服务端的新值'])
  })

  it('写入服务端后清除，之后的刷新不再覆盖服务端的新值', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-1', '我输入的说明')
    edits.clear('check-1')

    // 别人在服务端改成了另一段文字；因为草稿已清除，刷新后应保留服务端值。
    const fetched = [{ id: 'check-1', evidence: '队友写的说明' }]
    expect(edits.reapply(fetched, 'evidence')).toBe(0)
    expect(fetched[0].evidence).toBe('队友写的说明')
  })

  it('切换数据源时清空全部草稿，避免旧 id 覆盖新数据', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-1', '旧项目的说明')
    edits.clearAll()
    expect(edits.pending.value.size).toBe(0)
    const fetched = [{ id: 'check-1', evidence: '服务端值' }]
    expect(edits.reapply(fetched, 'evidence')).toBe(0)
    expect(fetched[0].evidence).toBe('服务端值')
  })

  it('反复输入以最后一次为准（不会留下过期草稿）', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-1', '第')
    edits.mark('check-1', '第一段')
    edits.mark('check-1', '第一段落完')

    const fetched = [{ id: 'check-1', evidence: '' }]
    edits.reapply(fetched, 'evidence')
    expect(fetched[0].evidence).toBe('第一段落完')
    expect(edits.pending.value.size).toBe(1)
  })

  it('接受清空到空字符串：用户主动删空后不应被旧草稿顶回来', () => {
    const edits = usePendingFieldEdits()
    edits.mark('check-1', '之前写的内容')
    edits.mark('check-1', '')

    const fetched = [{ id: 'check-1', evidence: '服务端的值' }]
    edits.reapply(fetched, 'evidence')
    expect(fetched[0].evidence).toBe('')
  })

  it('忽略空 id 与非法入参，不抛错', () => {
    const edits = usePendingFieldEdits()
    edits.mark('', 'x')
    edits.mark(undefined, 'x')
    edits.mark(null, 'x')
    expect(edits.pending.value.size).toBe(0)

    expect(edits.reapply(null, 'evidence')).toBe(0)
    expect(edits.reapply([], 'evidence')).toBe(0)
    expect(edits.reapply([{ id: 'a' }], '')).toBe(0)
    expect(edits.reapply([null, { id: 'b' }], 'evidence')).toBe(0)
  })
})