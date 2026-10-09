import { describe, expect, it } from 'vitest'
import { checklistAmount, formatChecklistText, MAX_BATCH_ITEMS, parseChecklistLines, selectChecklistItems, summarizeChecklist } from '../src/composables/domain/checklistModel.js'

describe('清单搜索、估价与批量预览', () => {
  it('未估价和免费事项分开统计，支持小数数量并按分汇总', () => {
    const list = { budget: 10, items: [
      { name: '示例水果', quantity: 0.5, price: 12.5, done: true },
      { name: '示例文具', quantity: 3, price: 0.1 },
      { name: '免费赠品', price: 0 }, { name: '待估价', price: '' },
      { name: '旧事项' }, { name: '无效价格', price: 'NaN' },
    ] }
    expect(summarizeChecklist(list)).toMatchObject({ count: 6, done: 1, remaining: 5, total: 6.55, boughtTotal: 6.25, pendingTotal: 0.3, unpricedCount: 3, pendingUnpricedCount: 3, budgetRemaining: 3.45 })
    expect(checklistAmount({ price: 1.005 })).toBe(1.01)
    expect(summarizeChecklist({ budget: 0, items: [{ price: 1 }] }).budgetRemaining).toBe(-1)
    expect(summarizeChecklist({ budget: '', items: [] }).budget).toBeNull()
    expect(summarizeChecklist({})).toMatchObject({ count: 0, percent: 0, budget: null })
  })

  it('名称、备注和分类一起匹配，筛选排序不改变存储顺序', () => {
    const list = { items: [
      { id: 'a', name: '牛奶', note: '低糖', category: '食品', price: 10, done: true },
      { id: 'b', name: '苹果', note: '低糖', category: '食品', price: 6 },
      { id: 'c', name: 'USB 线', category: '数码', price: '' },
    ] }
    expect(selectChecklistItems(list).map((item) => item.id)).toEqual(['b', 'c', 'a'])
    expect(selectChecklistItems(list, { query: '低糖 食品', status: 'pending', category: '食品' }).map((item) => item.id)).toEqual(['b'])
    expect(selectChecklistItems(list, { query: 'ｕｓｂ' }).map((item) => item.id)).toEqual(['c'])
    expect(selectChecklistItems(list, { sort: 'amount' }).map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(list.items.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(selectChecklistItems({ items: [{ id: 'legacy', text: '旧格式充电器' }] }, { query: '充电器' })[0].id).toBe('legacy')
  })

  it('多行粘贴识别编号、项目符号和完成标记，跳过空行及重复名称', () => {
    const result = parseChecklistLines('1. 身份证\n- [x] 充电器\n☐ 衣物\n\n• 身份证\nUSB 线\nｕｓｂ 线', { existingItems: [{ name: '身份证' }] })
    expect(result.items).toEqual([{ name: '充电器', done: true }, { name: '衣物', done: false }, { name: 'USB 线', done: false }])
    expect(result.duplicateCount).toBe(3)
    expect(result.errors).toEqual([])
    expect(parseChecklistLines('身份证\n身份证', { skipDuplicates: false }).items).toHaveLength(2)
  })

  it('超过批量上限或名称长度时给错误，不静默截断', () => {
    const result = parseChecklistLines(Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, index) => `示例 ${index}`).join('\n'))
    expect(result.items).toHaveLength(MAX_BATCH_ITEMS + 1)
    expect(result.errors[0]).toContain('200')
    expect(parseChecklistLines('文'.repeat(121)).errors[0]).toContain('第 1 行')
  })

  it('文本导出保留完成标记、数量、估价和备注', () => {
    const text = formatChecklistText({ name: '示例采购', type: 'shopping', items: [{ name: '牛奶', quantity: 2, unit: '盒', price: 5, note: '低糖', done: true }, { name: '纸巾', price: '' }] })
    expect(text).toContain('[x] 牛奶 · 2 盒 · ¥10.00 · 低糖')
    expect(text).toContain('[ ] 纸巾 · 1 件 · 未估价')
    expect(text).toContain('已估总额 ¥10.00（1 项未估价）')
  })
})
