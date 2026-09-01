import { describe, expect, it } from 'vitest'
import { parseTimetableColumns, parseTimetableLayout, selectBestTimetableExtraction } from '../src/composables/timetableLayoutParser.js'

const periods = Array.from({ length: 12 }, (_, index) => ({
  id: `p${index + 1}`,
  label: `第${'一二三四五六七八九十十一十二'[index]}节课`,
}))
// 上面的简写标签不影响按编号测试，明确覆盖标准标签。
periods.forEach((period, index) => { period.label = `第${index + 1}节课` })
const timeConfig = { value: { periods: [{ id: 'early', label: '早自习' }, ...periods] } }

function item(text, x, y, confidence = 88) {
  return { text, confidence, bbox: { x0: x - 36, x1: x + 36, y0: y - 8, y1: y + 8 } }
}

describe('教务系统表格课表识别', () => {
  it('利用星期列坐标还原长截图中的课程', () => {
    const layout = {
      width: 1000,
      height: 2200,
      words: [item('星期一', 232, 100), item('星期二', 354, 100), item('星期三', 476, 100)],
      lines: [
        item('环工2504', 232, 260),
        item('环境工程微生物', 232, 280),
        item('技术与应用(北)', 232, 300),
        item('陈艳容', 232, 320),
        item('1-8(周)', 232, 340),
        item('1206(博学楼)', 232, 360),
        item('[05-06]节', 232, 380),
        item('基于Python的数据结构(北)', 476, 260),
        item('徐赛萍', 476, 280),
        item('1-16(双周)', 476, 300),
        item('综合实验室5(笃行楼209)', 476, 320),
        item('[01-02]节', 476, 340),
        // 教务系统截图可能在合并行中重复显示，同一课程应去重。
        item('基于Python的数据结构(北)', 476, 500),
        item('徐赛萍', 476, 520),
        item('1-16(双周)', 476, 540),
        item('综合实验室5(笃行楼209)', 476, 560),
        item('[01-02]节', 476, 580),
      ],
    }
    // 实际 OCR 常把相邻星期的文字合并到同一行；解析器应优先按单词坐标重新分列。
    layout.words.push(...layout.lines)

    const result = parseTimetableLayout(layout, timeConfig, 25)
    expect(result.detectedHeaders).toBe(3)
    expect(result.courses).toHaveLength(2)
    expect(result.courses[0]).toMatchObject({
      name: '环境工程微生物技术与应用',
      day: 0,
      start: 'p5',
      end: 'p6',
      startWeek: 1,
      endWeek: 8,
      teacher: '陈艳容',
    })
    expect(result.courses[1]).toMatchObject({ day: 2, weekType: 'even', start: 'p1', end: 'p2' })
    expect(result.batchText).toContain('周一\t5-6节\t1-8周')
    expect(result.batchText).toContain('教师:徐赛萍')
  })

  it('支持将星期列单独 OCR，并合并换行的节字', () => {
    const result = parseTimetableColumns([{
      day: 4,
      confidence: 86,
      // 第一门课的“节”被 OCR 漏掉且数字 0 被识别成 O，仍应与下一门课分开。
      text: `环境工程微生物\n技术与应用(北)\n陈艳容\n13-16(周)\n数智化学分析实验室(岭西102)\nO5-O6-O7-O8\n环工2504\n普通化学实验(北)\n白爱娟\n5-12(周)\n数智化学分析实验室(岭西102)\n[05-06-07-08]\n节\n环境工程微生物技术与应用陈艳容13-16(周)普通化学实验\n5-12(周)\n数智化学分析实验室(岭西102)\n[05-06-07-08]节`,
    }], timeConfig, 25)

    expect(result.courses).toHaveLength(2)
    expect(result.courses[0]).toMatchObject({ day: 4, start: 'p5', end: 'p8', startWeek: 13, endWeek: 16 })
    expect(result.courses[1]).toMatchObject({ name: '普通化学实验', startWeek: 5, endWeek: 12 })
  })

  it('支持教务系统 Excel 把整个课程块压缩为一行，并识别方括号周次', () => {
    const result = parseTimetableColumns([{
      day: 1,
      confidence: 96,
      text: '环境工程原理A 李晓锐 1-16[周] 1206(博学楼) [01-02]节 环工2504',
    }, {
      day: 3,
      confidence: 96,
      text: '环境工程原理A 李晓锐 13-16[周] 应用化学实验室(岭西101) [05-06-07-08]节 环工2504',
    }], timeConfig, 25)

    expect(result.courses).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '环境工程原理A', day: 1, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, teacher: '李晓锐' }),
      expect.objectContaining({ name: '环境工程原理A', day: 3, start: 'p5', end: 'p8', startWeek: 13, endWeek: 16 }),
    ]))
  })

  it('保留楼名加房间号，而只过滤真正的班级编号', () => {
    const result = parseTimetableColumns([{
      day: 2,
      confidence: 96,
      text: '大学生创业基础 杨金涛 1-16[周] 追光楼3603(智慧) [07-08]节 环工2504',
    }], timeConfig, 25)

    expect(result.courses).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '大学生创业基础', room: '追光楼3603(智慧)', teacher: '杨金涛' }),
    ]))
  })

  it('对 OCR 残缺括号的教室字段标记人工确认', () => {
    const result = parseTimetableColumns([{
      day: 1,
      confidence: 96,
      text: '环境工程原理A 李晓锐 1-16[周] 应用化学实验室(岭西101] [01-02]节 环工2504',
    }], timeConfig, 25)

    expect(result.courses[0].room).toContain('岭西101]')
    expect(result.courses[0].needsReview).toBe(true)
    expect(result.courses[0].reviewReasons).toContain('地点包含残缺括号或异常符号')
    expect(selectBestTimetableExtraction(result).diagnostics.reviewCount).toBe(1)
  })

  it('按结构完整性选择结果，而不是只比较课程数量', () => {
    const noisy = {
      courses: [
        { name: '课程甲', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, confidence: 42 },
        { name: '课程甲粘连', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, confidence: 39 },
        { name: '', day: 9, start: null, end: null, startWeek: 16, endWeek: 1, confidence: 20 },
      ],
      batchText: 'noisy',
    }
    const structured = {
      courses: [
        { name: '课程甲', day: 0, start: 'p1', end: 'p2', startWeek: 1, endWeek: 16, confidence: 88 },
        { name: '课程乙', day: 2, start: 'p3', end: 'p4', startWeek: 1, endWeek: 16, confidence: 90 },
      ],
      batchText: 'structured',
      detectedHeaders: 7,
    }
    const selected = selectBestTimetableExtraction(noisy, structured)
    expect(selected.batchText).toBe('structured')
    expect(selected.diagnostics).toMatchObject({ invalid: 0, duplicateSlots: 0, reviewCount: 0 })
  })

  it('合并同一时间格中仅 OCR 尾字不同的重复课程', () => {
    const result = parseTimetableColumns([{
      day: 0,
      confidence: 80,
      text: `参与式环境监测方法与实践牛到\n张老师\n5-8(周)\n1305\n[05-06-07-08]节\n参与式环境监测方法与实践牛唆\n张老师\n5-8(周)\n1305\n[05-06-07-08]节`,
    }], timeConfig, 20)
    expect(result.courses).toHaveLength(1)
  })

  it('使用图片中不等宽的星期锚点，而不是推定七等分列', () => {
    const layout = {
      width: 1000,
      height: 600,
      lines: [item('周一', 100, 30)],
      words: [
        item('周一', 100, 30), item('周三', 500, 30), item('周五', 850, 30),
        item('高等数学', 100, 120), item('1-16(周)', 100, 150), item('01-02节', 100, 180),
        item('大学英语', 500, 120), item('1-16(周)', 500, 150), item('01-02节', 500, 180),
      ],
    }
    const parsed = parseTimetableLayout(layout, timeConfig, 20)
    expect(parsed.orientation).toBe('columns')
    expect(parsed.courses.map((course) => [course.name, course.day])).toEqual([
      ['高等数学', 0],
      ['大学英语', 2],
    ])
  })

  it('支持星期标签位于左侧的纵向布局', () => {
    const layout = {
      width: 800,
      height: 600,
      lines: [item('周一', 30, 120)],
      words: [
        item('周一', 30, 120), item('周二', 30, 360),
        item('线性代数', 200, 120), item('1-16(周)', 200, 150), item('01-02节', 200, 180),
        item('大学物理', 200, 360), item('1-16(周)', 200, 390), item('01-02节', 200, 420),
      ],
    }
    const parsed = parseTimetableLayout(layout, timeConfig, 20)
    expect(parsed.orientation).toBe('rows')
    expect(parsed.courses.map((course) => [course.name, course.day])).toEqual([
      ['线性代数', 0],
      ['大学物理', 1],
    ])
  })

  it('星期表头只出现在 OCR 行级结果时，仍能用单词坐标恢复课程列', () => {
    const layout = {
      width: 800,
      height: 600,
      lines: [item('星期一', 180, 40), item('星期三', 500, 40)],
      words: [
        item('高等数学', 180, 120), item('1-16(周)', 180, 150), item('[01-02]节', 180, 180),
        item('大学英语', 500, 120), item('1-16(周)', 500, 150), item('[01-02]节', 500, 180),
      ],
    }
    const parsed = parseTimetableLayout(layout, timeConfig, 20)
    expect(parsed.courses.map((course) => [course.name, course.day])).toEqual([
      ['高等数学', 0], ['大学英语', 2],
    ])
  })

  it('仅找到一个星期标签时不虚构固定列位置', () => {
    const parsed = parseTimetableLayout({
      width: 800,
      height: 600,
      lines: [item('周一', 30, 30)],
      words: [item('周一', 30, 30), item('高等数学', 220, 140)],
    }, timeConfig, 20)
    expect(parsed).toMatchObject({ courses: [], orientation: 'unknown', needsReview: true })
  })
})
