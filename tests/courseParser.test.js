import { describe, expect, it } from 'vitest'
import { numberedPeriodOptions, parseBatchLine, periodIdFromNumber } from '../src/composables/courseParser.js'

const timeConfig = {
  value: {
    periods: [
      { id: 'early', label: '早自习' },
      { id: 'p1', label: '第一节课' },
      { id: 'p2', label: '第二节课' },
      { id: 'p3', label: '第三节课' },
      { id: 'p4', label: '第四节课' },
      { id: 'p5', label: '第五节课' },
    ],
  },
}

describe('课程批量录入解析', () => {
  it('编号节次不会被早自习挤错一位', () => {
    expect(periodIdFromNumber(timeConfig.value.periods, 1)).toBe('p1')
    const row = parseBatchLine('高等数学 周一 1-2节 1-16周 A201 张老师', 1, timeConfig, 25)
    expect(row.error).toBe('')
    expect(row.data.start).toBe('p1')
    expect(row.data.end).toBe('p2')
  })

  it('周次范围写在单双周前面时仍保留单双周', () => {
    const odd = parseBatchLine('大学英语 周三 3-4节 1-16周 单周 B305 李老师', 1, timeConfig, 25)
    const even = parseBatchLine('大学英语 周三 3-4节 2-16周 双周 B305 李老师', 2, timeConfig, 25)
    expect(odd.data.weekType).toBe('odd')
    expect(even.data.weekType).toBe('even')
  })

  it('没有编号标签的自定义节次仍按顺序兼容', () => {
    const custom = [{ id: 'a', label: '上午一' }, { id: 'b', label: '上午二' }]
    expect(periodIdFromNumber(custom, 2)).toBe('b')
  })

  it('确认卡节次选项实时使用当前作息设置，并排除非课程时段', () => {
    const custom = [
      { id: 'early', label: '早自习' },
      { id: 'am', label: '上午课 A' },
      { id: 'pm', label: '下午课 B' },
      { id: 'break', label: '午休' },
    ]
    expect(numberedPeriodOptions(custom)).toEqual([
      { id: 'am', label: '上午课 A', number: 1 },
      { id: 'pm', label: '下午课 B', number: 2 },
    ])
  })

  it('支持表格识别生成的地点与教师标签', () => {
    const row = parseBatchLine('环境工程原理 周二 1-2节 1-16周 地点:1206(博学楼) 教师:李晓锐', 1, timeConfig, 25)
    expect(row.error).toBe('')
    expect(row.data.room).toBe('1206(博学楼)')
    expect(row.data.teacher).toBe('李晓锐')
  })
})
