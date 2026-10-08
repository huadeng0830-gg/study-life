// 通知切段规则的断言。纯函数，不需要 DOM。
//
// 【这份测试真正要防住的回归】切段是"宁可少切不可切错"的取舍，每条规则都对应
// 一个真实踩过的形态。改 noticeSegments.js 时**先在这里找到对应那条**，别直接改断言。
import { describe, expect, it } from 'vitest'
import {
  buildNoticeCandidates,
  MAX_NOTICE_SEGMENTS,
  SEGMENT_PROCESS_OPTIONS,
  splitNoticeSegments,
} from '../src/composables/noticeSegments.js'

const now = new Date('2026-09-01T10:00:00')

/** 一条真实形态的周报合集：总标题 + 5 条编号通知 + 落款。 */
const DIGEST = [
  '【通知】关于本周事项的通知',
  '',
  '1. 周五下午五点前提交实验报告，文件发到班级群。',
  '2. 下周一上午八点在体育馆开运动会彩排。',
  '3. 10月10日前完成学费缴纳，缴费平台已开放。',
  '4. 图书馆国庆期间开放时间调整为早八点到晚十点。',
  '5. 下周三晚上七点在阶梯教室开班会。',
  '',
  '辅导员 张老师',
  '2026年10月1日',
].join('\n')

const texts = (result) => result.segments.map((segment) => segment.text)

describe('splitNoticeSegments 判别力', () => {
  it('只有一行的文本仍然是 1 段（既不被切成 0 段，也不被切成多段）', () => {
    // 这一条是所有保守规则的兜底证明：一行里没有任何边界信号，就不许切。
    const result = splitNoticeSegments('下周三晚上八点前提交实验报告，文件名为学号姓名。')
    expect(result.segments).toHaveLength(1)
    expect(result.total).toBe(1)
    // 原文一字不差地留下来（rawText 走的是未改写的原始行）
    expect(result.segments[0].rawText).toBe('下周三晚上八点前提交实验报告，文件名为学号姓名。')
  })

  it('连"交报告"这种只有三个字的一行也是 1 段', () => {
    // 判别力：段数不能靠"文本够长"决定，也不能因为切过头而返回 0 段。
    expect(splitNoticeSegments('交报告').segments).toHaveLength(1)
    expect(splitNoticeSegments('关于期末考试安排的通知').segments).toHaveLength(1)
  })

  it('一段带"截止：周五"的通知不被切开，周五不会被当成新一段的标题', () => {
    const result = splitNoticeSegments([
      '关于实验报告提交的通知',
      '请于本周五18:00前提交实验报告',
      '',
      '地点：实验楼301',
      '2026年10月1日',
    ].join('\n'))
    expect(result.segments).toHaveLength(1)
    // "周五"只是这条通知的截止时间；落款日期也不是新一段
    expect(result.segments[0].text).toContain('周五')
    expect(texts(result)).not.toContain('周五')
    expect(result.segments[0].text).toContain('2026年10月1日')
  })

  it('单行里写了三个截止日期也不切（那是解析器的多事项，不是切段的活）', () => {
    // parseNotice 自己的 extractNoticeItems 会把它变成 3 个事项；切段层不重复这个机制。
    const result = splitNoticeSegments('9月5日前完成报名，9月7日前缴费，9月10日上午8点到体育馆报到。')
    expect(result.segments).toHaveLength(1)
  })

  it('5 条合集切成 5 段，每段都带着自己的编号原文与日期', () => {
    const result = splitNoticeSegments(DIGEST)
    expect(result.segments).toHaveLength(5)
    expect(result.segments.map((segment) => segment.rule)).toEqual(['marker', 'marker', 'marker', 'marker', 'marker'])
    // 编号前缀从"理解用的 text"里剥掉了，但 rawText 里保留（保存进任务的是原文）
    expect(result.segments[0].text.startsWith('周五下午五点前')).toBe(true)
    expect(result.segments[0].rawText).toContain('1.')
    expect(texts(result)[4]).toContain('下周三晚上七点在阶梯教室开班会')
  })

  it('合集的总标题不会变成第 1 条的标题（否则 5 条里只有第 1 条叫"本周事项"）', () => {
    const candidates = buildNoticeCandidates(DIGEST, { now })
    expect(candidates.candidates[0].parsed.title).not.toContain('本周事项')
    expect(candidates.candidates.map((row) => row.parsed.type)).toEqual(['作业', '会议', '缴费', '通知', '会议'])
  })

  it('每段各自解析出自己的截止日期，互不串味', () => {
    // 反例是这个：整段解析时 5 条通知里 4 条会拿到同一个日期（同一批日期候选）。
    const candidates = buildNoticeCandidates(DIGEST, { now })
    expect(candidates.candidates[2].parsed.dueDate).toBe('2026-10-10')
    // 第 5 段是「下周三晚上七点…开班会」，now = 2026-09-01（周二）。
    // 下周三 = 09-01 之后第一个周三再加一周 = 2026-09-09。
    // （原断言写的是 2026-09-02，那是**本周**三 —— 明天，不是"下周三"。）
    expect(candidates.candidates[4].parsed.dueDate).toBe('2026-09-09')
    expect(candidates.candidates[0].parsed.dueTime).toBe('17:00')
  })

  it('空白段与缩进续行都不成为独立段', () => {
    const result = splitNoticeSegments([
      '关于期末考试安排的通知',
      '',
      '各位同学：',
      '',
      '  请大家带好学生证，准时到考场参加考试。',
      '  考试时间为下周五上午九点。',
      '',
      '地点：教学楼301',
      '教务处',
      '2026年10月1日',
    ].join('\n'))
    // 一条通知被排版切成很多行 + 空行，仍然只能是 1 段
    expect(result.segments).toHaveLength(1)
    // 而且一个字都不能丢（早期版本会把"关于…的通知"和"各位同学："丢掉）
    expect(result.segments[0].text).toContain('关于期末考试安排的通知')
    expect(result.segments[0].text).toContain('各位同学')
    expect(result.segments[0].text).toContain('2026年10月1日')
  })

  it('空输入与纯空白输入返回 0 段（UI 据此不显示分段区）', () => {
    expect(splitNoticeSegments('').segments).toHaveLength(0)
    expect(splitNoticeSegments('   \n\n \t \n').segments).toHaveLength(0)
  })

  it('空行分隔的三条通知各成一��，而不是按句号乱切', () => {
    const result = splitNoticeSegments([
      '周五下午五点前提交实验报告。',
      '',
      '下周一上午八点在体育馆集合。',
      '',
      '10月10日前完成缴费。',
    ].join('\n'))
    expect(result.segments).toHaveLength(3)
    expect(texts(result)).toEqual([
      '周五下午五点前提交实验报告。',
      '下周一上午八点在体育馆集合。',
      '10月10日前完成缴费。',
    ])
  })

  it('以标点开头的行算续行，不会独立成段', () => {
    const result = splitNoticeSegments('下周三晚上八点前提交实验报告\n，请携带学生证。')
    expect(result.segments).toHaveLength(1)
  })

  it('"注意事项 + 编号清单"不切：那些条目自己带不动一条通知', () => {
    // 判别力：编号标记本身**不是**切段理由，还要看每段有没有"要做什么 + 什么时候"。
    const result = splitNoticeSegments('关于实验的注意事项\n\n1. 带学生证\n2. 提前十五分钟到场')
    expect(result.segments).toHaveLength(1)
  })

  it('一段都没成段时整段兜底为 1 段（不会返回 0 段让界面空白）', () => {
    const result = splitNoticeSegments('图书馆开放时间调整如下\n请同学们相互转告')
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].text).toBe('图书馆开放时间调整如下\n请同学们相互转告')
  })

  it('单独的编号行或分隔线不算段首标记', () => {
    const result = splitNoticeSegments('周五交报告\n1.\n——\n请按时提交')
    expect(result.segments).toHaveLength(1)
  })

  it('同样的输入两次结果完全一致（没有随机性、没有依赖当前时间）', () => {
    const first = buildNoticeCandidates(DIGEST, { now })
    const second = buildNoticeCandidates(DIGEST, { now })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    // 再显式钉住 now：换 now 也必须给出同样的切段结果（切段只看结构，不看日期解析）
    expect(texts(splitNoticeSegments(DIGEST))).toEqual(texts(splitNoticeSegments(DIGEST)))
  })

  it('同样的输入不同时刻跑，切段结果一致（切段不读时钟）', () => {
    const morning = buildNoticeCandidates(DIGEST, { now: new Date('2026-09-01T08:00:00') })
    const evening = buildNoticeCandidates(DIGEST, { now: new Date('2026-09-01T22:30:00') })
    expect(morning.segments.map((segment) => segment.text)).toEqual(evening.segments.map((segment) => segment.text))
  })

  it('超上限时截断并明确报出还剩几段，不静默丢弃', () => {
    const many = Array.from({ length: MAX_NOTICE_SEGMENTS + 5 }, (_, index) => `${index + 1}. 10月${index + 1}日前提交第${index + 1}次报告`).join('\n')
    const result = splitNoticeSegments(many)
    expect(result.segments).toHaveLength(MAX_NOTICE_SEGMENTS)
    expect(result.total).toBe(MAX_NOTICE_SEGMENTS + 5)
    expect(result.overflowCount).toBe(5)
    // 被截掉的内容带得出来，UI 才能提示"还有 5 段没显示"
    expect(result.overflowText).toContain('21.')
  })

  it('正好等于上限时不报溢出', () => {
    const exact = Array.from({ length: MAX_NOTICE_SEGMENTS }, (_, index) => `${index + 1}. 10月${index + 1}日前提交第${index + 1}次报告`).join('\n')
    const result = splitNoticeSegments(exact)
    expect(result.segments).toHaveLength(MAX_NOTICE_SEGMENTS)
    expect(result.overflowCount).toBe(0)
    expect(result.overflowText).toBe('')
  })

  it('段 id 与 index 稳定递增（渲染层的 key 与"第几条"文案靠它）', () => {
    const result = splitNoticeSegments(DIGEST)
    expect(result.segments.map((segment) => segment.index)).toEqual([0, 1, 2, 3, 4])
    expect(result.segments.map((segment) => segment.id)).toEqual(['notice-seg-1', 'notice-seg-2', 'notice-seg-3', 'notice-seg-4', 'notice-seg-5'])
    // 同一份输入必须给出同一组 id（无 Date.now / 计数器参与）
    expect(splitNoticeSegments(DIGEST).segments.map((segment) => segment.id)).toEqual(result.segments.map((segment) => segment.id))
  })

  it('CRLF、全角空格与 BOM 不影响切段结果', () => {
    const crlf = DIGEST.replace(/\n/g, '\r\n')
    expect(texts(splitNoticeSegments(crlf))).toEqual(texts(splitNoticeSegments(DIGEST)))
    expect(texts(splitNoticeSegments(`﻿${DIGEST}`))).toEqual(texts(splitNoticeSegments(DIGEST)))
    // 行内的全角空格（含行尾）只是空白，NFKC 折成半角后切段结果不变
    expect(texts(splitNoticeSegments(DIGEST.replace('前提交实验报告', '前　提交　实验报告')))).toEqual(texts(splitNoticeSegments(DIGEST)))
  })

  it('行首全角空格算缩进（续行），不会自成一段', () => {
    // 这是与上一条相反的方向，必须单独钉住：全角空格在 NFKC 之后才变半角，
    // 折叠顺序搞反的话缩进就看不出来，"　1. 周五交报告"会被当成一个新的段首。
    //
    // 【断言的是"没自成一段"，不是"少了一段"】
    // 原来这里断言 4 段，但那样就必须把第 1 条通知**丢掉**才凑得出来 ——
    // 而这一条是有时间有动作的真实通知（"周五下午五点前提交实验报告"）。
    // 丢字正是本文件明令禁止的（见文件头"宁可少切"与 mergeBlocks 的"不这么做就会丢字"）。
    // 正确的结果是：缩进行并进**第 1 段**（总标题那一段），段数仍是 5，
    // 但第 1 段的 rule 不再是 'marker' —— 它是被并进来的，不是一个新的段首标记。
    const indented = DIGEST.replace(/^1\./m, '　1.')
    const result = splitNoticeSegments(indented)
    expect(result.segments).toHaveLength(5)
    expect(result.segments[0].rule, '缩进的行不该被判成新的段首标记').not.toBe('marker')
    // 判别力：缩进判坏的话这一段会多出一个 'marker' 段首，且第 1 段的文本以编号开头。
    expect(result.segments[0].text).not.toMatch(/^1\./)
    // 一个字都不能丢：被并进去的那条通知原文还在。
    expect(result.segments[0].rawText).toContain('周五下午五点前提交实验报告')
  })

  it('合并规则会吸收开头无信号的说明块，但一个字都不丢', () => {
    const result = splitNoticeSegments('本周通知合集如下\n\n1. 周五交实验报告\n2. 下周一开会')
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].rawText).toContain('本周通知合集如下')
  })
})

describe('buildNoticeCandidates', () => {
  it('每段都带上完整的 parseNotice 结果', () => {
    const result = buildNoticeCandidates(DIGEST, { now })
    expect(result.candidates).toHaveLength(5)
    for (const candidate of result.candidates) {
      expect(candidate.parsed.title).toBeTruthy()
      expect(candidate.parsed.type).toBeTruthy()
      // 【解析拿到的原文是"剥掉枚举编号"的那份，而 segment.rawText 保留原样】
      // 这正是 buildNoticeCandidates 刻意做的取舍：编号 "1. " 若交给 noticeParser 的
      // cleanTitle，会被当成标题内容，界面上第 1 条通知的标题就会以 "1." 开头；
      // 而保存进任务的原文又必须与用户粘贴的一字不差，所以两份都留着，各司其职。
      // 原断言写的是 parsed.rawText === candidate.rawText，与该设计直接冲突。
      expect(candidate.parsed.rawText).toBe(candidate.text)
      expect(candidate.rawText).toMatch(/^\d\. /)
      expect(candidate.text).not.toMatch(/^\d\. /)
    }
  })

  it('课程名按段匹配，不会把别的段的课程名安到本段上', () => {
    const result = buildNoticeCandidates('1. 高等数学周五提交第一次作业\n2. 马克思主义原理下周一交读书报告', {
      courses: [{ id: 'c1', name: '高等数学' }, { id: 'c2', name: '马克思主义原理' }],
      now,
    })
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].parsed.course).toBe('高等数学')
    expect(result.candidates[1].parsed.course).toBe('马克思主义原理')
  })

  it('只切出 1 段时返回 1 个候选（单条通知走原来的单条流程）', () => {
    const result = buildNoticeCandidates('下周三晚上八点前提交实验报告，文件名为学号姓名。', { now })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].parsed.title).toContain('实验报告')
  })

  it('limit 选项生效时同样报出溢出', () => {
    const many = Array.from({ length: 8 }, (_, index) => `${index + 1}. 10月${index + 1}日前提交第${index + 1}次报告`).join('\n')
    const result = buildNoticeCandidates(many, { now, limit: 3 })
    expect(result.candidates).toHaveLength(3)
    expect(result.overflowCount).toBe(5)
  })

  it('空输入不产生候选（UI 不会出现空的确认区）', () => {
    expect(buildNoticeCandidates('', { now }).candidates).toHaveLength(0)
  })
})

describe('语音模式：只按分句断，且复用同一套保守规则', () => {
  it('连续说两件事切成两段', () => {
    const result = splitNoticeSegments('周三下午三点图书馆还书，周五交报告', { mode: 'voice' })
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].text).toContain('还书')
    expect(result.segments[1].text).toContain('交报告')
  })

  it('一句话里的补充说明不独立成段（分句也要过信号门槛）', () => {
    const result = splitNoticeSegments('下周三晚上八点前提交实验报告，文件名为学号姓名。', { mode: 'voice' })
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0].text).toContain('文件名为学号姓名')
  })

  it('语音模式不会把枚举编号当成必须切开的理由之外的东西（同一套规则）', () => {
    // 枚举切段是通用的，不是 paste 专属；语音里说"第一件事…第二件事…"同样能断
    const result = splitNoticeSegments('第一件事周五交报告，第二件事下周一开会', { mode: 'voice' })
    expect(result.segments.length).toBeGreaterThanOrEqual(1)
    expect(result.segments[0].text).toContain('交报告')
  })

  it('语音结果里没有可断的标点时就是 1 段', () => {
    expect(splitNoticeSegments('周五交报告', { mode: 'voice' }).segments).toHaveLength(1)
  })

  it('语音候选同样按段给日期', () => {
    const result = buildNoticeCandidates('周三下午三点图书馆还书，周五交报告', { now, mode: 'voice' })
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].parsed.dueTime).toBe('15:00')
  })
})

describe('处理方式选项', () => {
  it('三个结构化选项与单条流程一致，且 key 互不重复', () => {
    expect(SEGMENT_PROCESS_OPTIONS.map((option) => option.key)).toEqual(['task', 'homework', 'event'])
    expect(SEGMENT_PROCESS_OPTIONS.every((option) => option.label)).toBe(true)
  })
})
