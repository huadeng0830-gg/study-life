import { describe, expect, it } from 'vitest'
import {
  extractDateCandidates,
  extractLocationCandidates,
  parseNotice,
  periodSpanRanges,
} from '../src/composables/noticeParser.js'
import { extractAmounts } from '../src/composables/quickRecord/entities.js'

// 固定“现在”为 2026-09-01（周二），让倒计时/星期的推算结果可预测。
const now = new Date('2026-09-01T10:00:00')

// 这一批回归都来自真实粘贴输入。每条都对应一次「界面显示了一个明显错误的结果」，
// 不是风格偏好：节次被当成日期、地点吞掉整句、课程编号被记成一笔支出。

describe('通知解析：节次不能被当成日期', () => {
  it('“1-2节 高数，下周三 A201”应取下周三，而不是 1 月 2 日', () => {
    const result = parseNotice('1-2节 高数，下周三 A201', [], now)
    // 修复前：显式日期正则把 “1-2” 读成 1 月 2 日，截止日期变成一个无关的日子。
    // 2026-09-01 是周二，“下周三”指下周那一周的周三 = 9/9。
    expect(result.dueDate).toBe('2026-09-09')
    expect(result.dueDate).not.toBe('2027-01-02')
  })

  it('节次跨度会覆盖的日期候选被剔除', () => {
    const spans = periodSpanRanges('1-2节 高数')
    expect(spans).toHaveLength(1)
    const values = extractDateCandidates('1-2节 高数，下周三 A201', now).map((item) => item.value)
    expect(values).not.toContain('2027-01-02')
    expect(values).toContain('2026-09-09')
  })

  it('“第3节”与“3-4节”同样不产生日期候选', () => {
    expect(extractDateCandidates('周三第3节高数', now).map((item) => item.value)).toEqual(['2026-09-02'])
    expect(extractDateCandidates('3-4节高数', now).map((item) => item.value)).toEqual([])
  })

  it('“春节放假三天”不会被当成节次跨度', () => {
    expect(periodSpanRanges('春节放假三天')).toEqual([])
  })
})

describe('通知解析：“在/到”必须是独立介词', () => {
  it('“现在”里的“在”不吞掉整句，地点与标题都保持完整', () => {
    const result = parseNotice('各位同学：现在请到三教201领取实验器材', [], now)
    // 修复前：title 变成 “现 领取实验器材”，地点是 “请到三教201”。
    expect(result.location).toBe('三教201')
    expect(result.title).toContain('领取实验器材')
    // 1.3 残留：上面只断言「包含」，而 “现 领取实验器材” 同样包含 “领取实验器材”，
    // 所以「现在被削成现」这处回归一直静默存活。这里必须钉死完整标题。
    // 中间的空格是 stripRecognizedParts 为被剥离的地点跨度留下的分隔符（既有约定），
    // 本用例只负责「在」不能再被当成悬空方位词删掉。
    expect(result.title).toBe('现在 领取实验器材')
  })

  it('“现在”紧邻被剥离的地点时，标题同样不能把“在”削掉', () => {
    const result = parseNotice('现在到图书馆集合', [], now)
    expect(result.location).toBe('图书馆')
    // 修复前：title 是 “现 集合”（“到图书馆”整段是地点，被剥离后“在”右侧变成空格，
    // 标题清理就把“现在”的“在”当成悬空介词删了）。
    expect(result.title).toBe('现在 集合')
  })

  it('“正在/实在/存在/现在”本身是词，标题清理不拆词', () => {
    expect(parseNotice('正在施工区域绕行', [], now).title).toBe('正在施工区域绕行')
    expect(parseNotice('实在抱歉', [], now).title).toBe('实在抱歉')
    expect(parseNotice('存在以下问题', [], now).title).toBe('存在以下问题')
  })

  it('真实位置写法不受影响：在三教201 / 在图书馆仍然是地点', () => {
    expect(parseNotice('在三教201上课', [], now).location).toBe('三教201')
    expect(parseNotice('在图书馆开会', [], now).location).toBe('图书馆')
    expect(parseNotice('周三下午两点在实验楼B204开会', [], now).location).toBe('实验楼B204')
  })

  it('“请现在上传实验报告”不会被判出地点，标题保留原意', () => {
    const result = parseNotice('请现在上传实验报告', [], now)
    // 修复前：title 只剩一个 “现”，location 变成 “上传实验报告”。
    expect(result.location).toBe('')
    expect(result.title).toBe('现在上传实验报告')
  })

  it.each([
    ['正在施工', '现在'],
    ['确实如此', '实在'],
    ['存在以下问题', '存在'],
    ['每在此时', '每在'],
  ])('%s 中的“在”不作为地点介词', (source) => {
    expect(extractLocationCandidates(source)).toEqual([])
  })

  it('地点以动作词开头时判为非地点', () => {
    expect(extractLocationCandidates('请到提交前完成')).toEqual([])
  })

  it('正常地点写法仍然有效', () => {
    expect(extractLocationCandidates('周三下午两点在实验楼B204开会')[0]?.raw).toBe('实验楼B204')
    expect(extractLocationCandidates('地点：三教201')[0]?.raw).toBe('三教201')
    expect(extractLocationCandidates('在三教201上课')[0]?.raw).toBe('三教201')
  })
})

describe('通知解析：倒计时式日期', () => {
  it.each([
    ['还剩3天考试', '2026-09-04'],
    ['还有3天就是四六级报名截止', '2026-09-04'],
    ['剩余10天提交', '2026-09-11'],
    ['5天后提交', '2026-09-06'],
  ])('%s 能推算出日期', (source, expected) => {
    const result = parseNotice(source, [], now)
    // 修复前：这条链路完全没有倒计时词表，只会得到一个没有日期的条目。
    expect(result.dueDate).toBe(expected)
  })

  it('写明的日期比倒计时更可靠，两者并存时选写明的', () => {
    const result = parseNotice('12月3日提交实验报告，还有10天开始复习', [], now)
    expect(result.dueDate).toBe('2026-12-03')
  })

  it('倒计时天数非法时不产生候选', () => {
    expect(extractDateCandidates('还有0天考试', now).map((item) => item.value)).not.toContain('2026-09-01')
  })
})

describe('快速记录：课表/量词数字不能被记成支出', () => {
  // 修复前：这些输入都会走 inferIntent 的 “有金额就是支出” 分支，
  // 生成一张 confidence 0.92 的支出草稿，用户看不到任何警告。
  it.each([
    '每周三1-2节提醒我交作业',
    '高数3班周五第3节',
    '买2斤苹果',
    '买了2两猪肉',
    '租了3册教材',
    '周五下午2-3点开组会',
    '乘坐12路公交',
    '买5G套餐',
  ])('%s 不产生金额', (source) => {
    expect(extractAmounts(source)).toEqual([])
  })

  it.each([
    ['午饭 18 元', [18]],
    ['生活费到账500微信', [500]],
    ['打车花了12块5', [12.5]],
    ['买咖啡 ¥9.9', [9.9]],
    ['收到200块红包', [200]],
  ])('%s 仍然正确识别金额', (source, expected) => {
    expect(extractAmounts(source).map((item) => item.amount)).toEqual(expected)
  })

  it('区间两端都不会被当成金额', () => {
    expect(extractAmounts('1-2节')).toEqual([])
    expect(extractAmounts('2~3点')).toEqual([])
    expect(extractAmounts('3到5个')).toEqual([])
  })

  it('带货币单位的区间仍然被识别', () => {
    expect(extractAmounts('住宿费 300-500元').length).toBeGreaterThan(0)
  })
})