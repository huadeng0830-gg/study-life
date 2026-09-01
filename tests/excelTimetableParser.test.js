import { describe, expect, it } from 'vitest'
import { extractExcelTimetable } from '../src/composables/excelTimetableParser.js'

describe('Excel 课程表解析', () => {
  it('识别带中文列名的课程清单，并生成可复用的批量导入文本', () => {
    const result = extractExcelTimetable([{
      name: '课程清单',
      rows: [
        ['课程名称', '星期', '节次', '周次', '教师', '上课地点'],
        ['环境工程原理 A', '星期一', '0102', '1-16(周)', '李晓锐', '1206（博学楼）'],
        ['线性代数 A', '周三', '3-4节', '1-16(双周)', '周慧婉', '2204'],
      ],
    }])

    expect(result).toMatchObject({ mode: 'list', count: 2, sheetName: '课程清单' })
    expect(result.batchText).toContain('环境工程原理 A\t周一\t1-2节\t1-16周\t地点:1206(博学楼)\t教师:李晓锐')
    expect(result.batchText).toContain('线性代数 A\t周三\t3-4节\t1-16周\t双周')
  })

  it('识别按星期排布的教务系统课表，保留每个星期列的原始课程块', () => {
    const result = extractExcelTimetable([{
      name: '我的课表',
      rows: [
        ['节次', '星期一', '星期二', '星期三'],
        ['0102节', '环境工程原理 A(北)\n李晓锐\n1-16(周)\n1206(博学楼)\n[01-02]节', '', '基于Python的数据结构(北)\n徐赛萍\n1-16(单周)\n综合实验室5\n[01-02]节'],
        ['0304节', '线性代数 A(北)\n周慧婉\n1-16(周)\n2204\n[03-04]节', '', ''],
      ],
    }])

    expect(result).toMatchObject({ mode: 'grid', count: 2, sheetName: '我的课表' })
    expect(result.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 0, text: expect.stringContaining('环境工程原理 A') }),
      expect.objectContaining({ day: 2, text: expect.stringContaining('基于Python') }),
    ]))
  })

  it('跳过空白工作表，选择能够识别出课程的工作表', () => {
    const result = extractExcelTimetable([
      { name: '说明', rows: [['请勿修改']] },
      { name: '导入', rows: [['课程', '周几', '节次'], ['高等数学', '2', '1-2']] },
    ])

    expect(result).toMatchObject({ mode: 'list', count: 1, sheetName: '导入' })
    expect(result.batchText).toContain('高等数学\t周二\t1-2节')
  })
})
