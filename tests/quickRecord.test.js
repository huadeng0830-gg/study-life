// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseQuickRecord } from '../src/composables/quickRecord/parser.js'

describe('quickRecord.parser', () => {
  it('识别作业、课程、截止时间和优先级', () => {
    const [draft] = parseQuickRecord('周五18点交高数第三章作业，重要', { courses: [{ id: 'c1', name: '高数' }], now: new Date('2026-08-29T10:00:00') })
    expect(draft.type).toBe('homework')
    expect(draft.course).toBe('高数')
    expect(draft.time).toBe('18:00')
  })

  it('兼容入口通过上下文进入同一类型识别', () => {
    expect(parseQuickRecord('午饭18', { context: { preferredType: 'expense' } })[0].type).toBe('expense')
    expect(parseQuickRecord('买洗衣液', { context: { preferredType: 'todo' } })[0].type).toBe('todo')
    expect(parseQuickRecord('周五交作业', { context: { preferredType: 'homework', courseId: 'c1', courseName: '高数' } })[0]).toMatchObject({ type: 'homework', courseId: 'c1', course: '高数' })
  })

  it('识别收入、金额和支付账户', () => {
    const [draft] = parseQuickRecord('生活费到账500微信')
    expect(draft.type).toBe('income')
    expect(draft.amount).toBe(500)
    expect(draft.account).toBe('微信')
    expect(draft.category).toBe('allowance')
  })

  it('按换行批量识别多笔支出', () => {
    const drafts = parseQuickRecord('早餐6\n公交2\n午饭18\n奶茶9')
    expect(drafts).toHaveLength(4)
    expect(drafts.every((draft) => draft.type === 'expense')).toBe(true)
    expect(drafts.reduce((total, draft) => total + draft.amount, 0)).toBe(35)
  })

  it('识别中文金额，并把一句话中的多笔消费拆开', () => {
    const drafts = parseQuickRecord('今天坐公交车用了两块钱去吃了八块钱的兰州拉面。')
    expect(drafts).toHaveLength(2)
    expect(drafts.map((draft) => ({ title: draft.title, amount: draft.amount, type: draft.type }))).toEqual([
      { title: '公交车', amount: 2, type: 'expense' },
      { title: '兰州拉面', amount: 8, type: 'expense' },
    ])
  })

  it('识别周期账单', () => {
    const [draft] = parseQuickRecord('每月15号39元话费')
    expect(draft.type).toBe('bill')
    expect(draft.amount).toBe(39)
    expect(draft.cycle).toBe('monthly')
    expect(draft.category).toBe('communication')
  })

  it.each([
    ['买牛肉面花了5元', 'food'],
    ['奶茶12元', 'drink'],
    ['买薯片6元', 'snack'],
    ['买洗衣液28元', 'daily-supplies'],
    ['买数据线19元', 'digital'],
    ['打印论文12元', 'study'],
    ['理发35元', 'daily-service'],
    ['洗浴20元', 'bathing'],
    ['校园网20元', 'utilities'],
    ['iCloud 6元', 'sub'],
  ])('QuickRecord 复用统一分类：%s → %s', (text, expected) => {
    const [draft] = parseQuickRecord(text)
    expect(draft.type).toBe('expense')
    expect(draft.category).toBe(expected)
    expect(draft.categoryConfidence).toBeGreaterThanOrEqual(0.75)
    expect(draft.categoryUncertain).toBe(false)
  })

  it('分类不确定时保留建议与候选，供预览确认而不是静默入账', () => {
    const [draft] = parseQuickRecord('便利店买矿泉水和纸巾20元')
    expect(draft).toMatchObject({
      type: 'expense', category: 'daily-supplies', categoryUncertain: true, categoryAmbiguous: true,
    })
    expect(draft.categoryCandidates).toEqual(['daily-supplies', 'drink'])
  })

  it('识别“还有 N 天”的倒计时', () => {
    const [draft] = parseQuickRecord('距离六级考试还有90天', { now: new Date('2026-09-02T10:00:00') })
    expect(draft.type).toBe('countdown')
    expect(draft.date).toBe('2026-12-01')
  })

  it('没有日期的普通记录仍可成为待办', () => {
    const [draft] = parseQuickRecord('买洗衣液')
    expect(draft.type).toBe('todo')
    expect(draft.date).toBe('')
  })
it('语序变化不影响支出识别：买/花了/五元/五块钱', () => {
    const now = new Date('2026-08-29T10:00:00')
    for (const text of ['买牛肉面花了五元', '花了五元买牛肉面', '五元买牛肉面', '牛肉面5元', '五块钱买了牛肉面']) {
      const [draft] = parseQuickRecord(text, { now })
      expect(draft.type).toBe('expense')
      expect(draft.amount).toBe(5)
      expect(draft.title).toContain('牛肉面')
      expect(draft.date).toBe('2026-08-29')
    }
  })

  it('识别口语金额 12块5 为 12.5', () => {
    const [draft] = parseQuickRecord('刚刚买咖啡花了12块5')
    expect(draft.type).toBe('expense')
    expect(draft.amount).toBe(12.5)
    expect(draft.title).toContain('咖啡')
  })

  it('金额不完整时不乱猜类型，给出 unknown 降级出口', () => {
    const [draft] = parseQuickRecord('牛肉面五')
    expect(draft.type).toBe('unknown')
    expect(draft.uncertain).toBe(true)
    expect(draft.note).toBe('牛肉面五')
  })

  it('选择快速笔记后不进行意图分类', () => {
    const [draft] = parseQuickRecord('明天下午三点交作业', { forcedType: 'note' })
    expect(draft.type).toBe('note')
    expect(draft.note).toBe('明天下午三点交作业')
    expect(draft.date).toBe('')
  })
it('识别日程实体：组会/上课/实验室会议', () => {
    const now = new Date('2026-08-29T10:00:00')
    const cases = [
      ['明天下午三点开组会', { date: '2026-08-30', time: '15:00' }],
      ['周五上午十点上课', { date: '2026-09-04', time: '10:00' }],
      ['下周一两点实验室会议', { date: '2026-08-31', time: '14:00' }],
    ]
    for (const [text, expected] of cases) {
      const [draft] = parseQuickRecord(text, { now })
      expect(draft.type).toBe('event')
      expect(draft.date).toBe(expected.date)
      expect(draft.time).toBe(expected.time)
    }
  })

  it('自由笔记模式下不提取日期和任务字段', () => {
    const [draft] = parseQuickRecord('明天下午三点交作业', { forcedType: 'note' })
    expect(draft.type).toBe('note')
    expect(draft.date).toBe('')
    expect(draft.time).toBe('')
    expect(draft.note).toBe('明天下午三点交作业')
  })

  it('一句话包含支出和后续待办时拆成两个业务动作', () => {
    const drafts = parseQuickRecord('买六级真题39元，周五开始做第一套', {
      courses: [],
      now: new Date('2026-08-29T10:00:00'),
    })
    expect(drafts.map((draft) => draft.type)).toEqual(['expense', 'todo'])
    expect(drafts[0].amount).toBe(39)
    expect(drafts[1].date).toBe('2026-09-04')
    expect(drafts[1].title).toContain('做第一套')
  })

  it('专项回归覆盖金额上下文、收入、班会和自由实验记录', () => {
    const now = new Date('2026-09-05T10:00:00')
    expect(parseQuickRecord('今天午饭15元', { now })[0]).toMatchObject({ type: 'expense', amount: 15 })
    expect(parseQuickRecord('打车22.5', { now })[0]).toMatchObject({ type: 'expense', amount: 22.5 })
    expect(parseQuickRecord('兼职收入200', { now })[0]).toMatchObject({ type: 'income', amount: 200 })
    expect(parseQuickRecord('收到奖学金1000', { now })[0]).toMatchObject({ type: 'income', amount: 1000 })
    expect(parseQuickRecord('明天交实验报告', { now })[0].type).toBe('homework')
    expect(parseQuickRecord('后天下午三点班会', { now })[0]).toMatchObject({ type: 'event', time: '15:00' })
    expect(parseQuickRecord('今天实验挺顺利', { now })[0].type).toBe('note')
    expect(parseQuickRecord('明天去食堂花5分钟取东西', { now })[0].type).not.toBe('expense')
  })
})
