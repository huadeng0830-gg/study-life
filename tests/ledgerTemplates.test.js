// @vitest-environment happy-dom
/**
 * 账单预设模板（增 / 删 / 改 + 深拷贝 + 中文错误）。
 *
 * 形状照 `courseTemplates.js`（`useStoredRef` + 显式提交），但多一条本功能真正需要的语义：
 * **同 id 覆盖 = 改**。账单名没变时不该越存越多份同名模板。
 * 另外锁住「模板不保存 nextDate」——下次支付日期是「这一次」的事实，套用模板回填旧日期会误导。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  LEDGER_TEMPLATES_KEY,
  normalizeBillTemplate,
  templateToBillForm,
  useLedgerTemplateCommands,
} from '../src/composables/ledgerTemplates.js'
import { flushStoredWrites } from '../src/composables/store/core.js'

const BILL = {
  name: 'ChatGPT Plus',
  amount: '140',
  category: 'sub',
  cycle: 'monthly',
  nextDate: '2026-10-01',
  remindDays: 3,
  account: '信用卡',
  currency: 'usd',
  note: '含税',
  autoRenew: true,
  active: true,
}

describe('账单模板的字段白名单', () => {
  it('只保留账单表单真的有、且值得复用的字段；nextDate / id 一律丢弃', () => {
    const bill = normalizeBillTemplate({ ...BILL, id: 'bill-1', createdAt: 'x' })
    expect(bill).toEqual({
      name: 'ChatGPT Plus',
      amount: 140,
      category: 'sub',
      cycle: 'monthly',
      remindDays: 3,
      account: '信用卡',
      currency: 'USD',
      note: '含税',
      autoRenew: true,
      active: true,
    })
    expect(bill.nextDate).toBeUndefined()
    expect(bill.id).toBeUndefined()
  })

  it('非法金额不写入字段（模板允许只有名称与周期），非法周期回落 monthly', () => {
    const bill = normalizeBillTemplate({ name: '话费', amount: '1.234', cycle: '每天' })
    expect(bill.amount).toBeUndefined()
    expect(bill.cycle).toBe('monthly')
    expect(normalizeBillTemplate({ amount: '39.5' }).amount).toBe(39.5)
  })

  it('套用到表单时金额是文本（直接回填输入框），且不含 nextDate', () => {
    const form = templateToBillForm({ bill: BILL })
    expect(form.amount).toBe('140')
    expect(form.currency).toBe('USD')
    expect(form.name).toBe('ChatGPT Plus')
    expect(form.nextDate).toBeUndefined()
    expect(templateToBillForm(null).amount).toBe('')
  })
})

describe('模板增删改', () => {
  beforeEach(() => {
    localStorage.removeItem(LEDGER_TEMPLATES_KEY)
  })

  it('保存成功后进入列表头部，并写进 localStorage', () => {
    const { templates, saveTemplate } = useLedgerTemplateCommands()
    templates.value = []
    const saved = saveTemplate({ name: '视频会员', bill: BILL })
    expect(saved.id).toMatch(/^ltpl-/)
    expect(saved.createdAt).toBeTruthy()
    expect(templates.value).toHaveLength(1)
    expect(templates.value[0].name).toBe('视频会员')
    flushStoredWrites()
    const stored = JSON.parse(localStorage.getItem(LEDGER_TEMPLATES_KEY))
    expect(stored).toHaveLength(1)
    expect(stored[0].bill.name).toBe('ChatGPT Plus')
    expect(stored[0].bill.nextDate).toBeUndefined()
  })

  it('深拷贝：保存之后再改原表单对象，模板内容不受影响', () => {
    const { templates, saveTemplate } = useLedgerTemplateCommands()
    templates.value = []
    const form = { name: '话费', amount: '39', category: 'communication', cycle: 'monthly', note: '原值' }
    saveTemplate({ name: '话费模板', bill: form })
    form.note = '改过之后'
    form.amount = '999'
    expect(templates.value[0].bill.note).toBe('原值')
    expect(templates.value[0].bill.amount).toBe(39)
  })

  it('同 id 覆盖 = 改：列表长度不变，内容被替换', () => {
    const { templates, saveTemplate } = useLedgerTemplateCommands()
    templates.value = []
    const first = saveTemplate({ name: '话费', bill: { name: '话费', amount: '39' } })
    const second = saveTemplate({ id: first.id, name: '话费', bill: { name: '话费', amount: '59', note: '涨了' } })
    expect(second.id).toBe(first.id)
    expect(templates.value).toHaveLength(1)
    expect(templates.value[0].bill.amount).toBe(59)
    expect(templates.value[0].bill.note).toBe('涨了')
  })

  it('删除返回被删掉的模板；删不存在的 id 返回 null 且不改列表', () => {
    const { templates, saveTemplate, deleteTemplate } = useLedgerTemplateCommands()
    templates.value = []
    const saved = saveTemplate({ name: '宽带', bill: { name: '宽带', amount: '60' } })
    expect(deleteTemplate('不存在')).toBe(null)
    expect(templates.value).toHaveLength(1)
    const removed = deleteTemplate(saved.id)
    expect(removed.name).toBe('宽带')
    expect(templates.value).toHaveLength(0)
    flushStoredWrites()
    expect(JSON.parse(localStorage.getItem(LEDGER_TEMPLATES_KEY))).toEqual([])
  })

  it('校验失败抛中文错误，且不写入任何模板', () => {
    const { templates, saveTemplate } = useLedgerTemplateCommands()
    templates.value = []
    expect(() => saveTemplate({ name: '   ', bill: BILL })).toThrow('请填写模板名称')
    expect(() => saveTemplate({ name: '空模板', bill: { name: '', cycle: 'monthly' } })).toThrow('模板至少要保存账单名称或金额')
    expect(templates.value).toHaveLength(0)
  })
})