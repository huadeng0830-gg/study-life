// @vitest-environment happy-dom
/**
 * 五份课表/作息解析器收口到 facade（src/composables/timetable/**）后的**行为契约测试**。
 *
 * 【为什么这份测试主要做「钉死差异」而不是「验证统一」】
 * P2-2 的重复确实存在，但四类语义各有多个历史变体，且变体之间的差异都有人依赖：
 *   - 星期解析的失败约定：ocrPipeline 用 -1（靠 `day >= 0` 过滤），其余解析器用 null；
 *   - 节次解析的返回约定：Excel 认不出时**透传原文**，作息表返回 null 或特殊时段对象，
 *     版面解析返回 { start, end } 或 null；
 *   - OCR 字符类：课表只修 O/I，作息表连 Q/D/! 一起修；
 *   - 单双周：'odd'/'even'（课程对象）与 '单周'/'双周'（批量文本）两种编码，
 *     且「未识别 weekType」在 store 里按全周、在导入冲突里按不命中。
 * 所以这份测试的重点是：**每个变体都还在，且行为与原来完全一致**。
 * 一旦有人为了「统一」把两个变体合并，这里会立刻变红。
 */
import { describe, expect, it } from 'vitest'
import {
  cnWordToDigits,
  digitize,
  fixPeriodDigits,
  fixScheduleDigits,
  normalizeCellText,
  normalizeLayoutText,
  normalizePeriodText,
  normalizeScheduleText,
  normalizeWeekText,
  parseLoosePeriodRange,
  parsePeriodRange,
  parseSchedulePeriod,
  parseWeekRangeFromTable,
  periodNumberFromLabel,
  weekMatchesWeekTypeLoose,
  weekMatchesWeekTypeStrict,
  weekTypeBatchSuffix,
  weekTypeChineseLabel,
  weekTypeFromChineseToken,
  weekdayIndexFromCell,
  weekdayIndexFromLabel,
  weekdayIndexFromToken,
  weekdayIndexOrMinusOne,
} from '../src/composables/timetable/index.js'
import { parseWeekdayToken } from '../src/composables/courseParser.js'
import { normalizePeriod } from '../src/composables/scheduleOcrParser.js'
import { activeWeeks } from '../src/composables/courseImport.js'
import { courseInWeek } from '../src/composables/store/schedule.js'

describe('facade · 星期 token → 0-6（四套失败约定/归一化）', () => {
  it('失败约定 -1：ocrPipeline 版（去全部空白、可出现在句中、不认「礼拜」）', () => {
    expect(weekdayIndexOrMinusOne('星期一')).toBe(0)
    expect(weekdayIndexOrMinusOne('星期日')).toBe(6)
    expect(weekdayIndexOrMinusOne('星期天')).toBe(6)
    expect(weekdayIndexOrMinusOne(' 星期 三 ')).toBe(2)
    expect(weekdayIndexOrMinusOne('周二 高等数学')).toBe(1)
    // 边界：空串 / 未知 token / 纯数字 / 「礼拜」都不是这一版的语义
    expect(weekdayIndexOrMinusOne('')).toBe(-1)
    expect(weekdayIndexOrMinusOne('星期八')).toBe(-1)
    expect(weekdayIndexOrMinusOne('3')).toBe(-1)
    expect(weekdayIndexOrMinusOne('礼拜一')).toBe(-1)
    expect(weekdayIndexOrMinusOne(null)).toBe(-1)
  })

  it('失败约定 null：Excel 单元格版（额外接受纯数字 1-7 表头）', () => {
    expect(weekdayIndexFromCell('星期一')).toBe(0)
    // 裸「天」不算：汉字形态必须带「星期/周」前缀（四份实现的共同前提）
    expect(weekdayIndexFromCell('天')).toBeNull()
    expect(weekdayIndexFromCell('星期日')).toBe(6)
    expect(weekdayIndexFromCell('3')).toBe(2)
    expect(weekdayIndexFromCell('星期二abc')).toBe(1)
    expect(weekdayIndexFromCell('')).toBeNull()
    expect(weekdayIndexFromCell('礼拜一')).toBeNull()
    expect(weekdayIndexFromCell('星期八')).toBeNull()
  })

  it('失败约定 null：课表版面表头版（只认汉字，不接受纯数字）', () => {
    expect(weekdayIndexFromLabel('星期 一')).toBe(0)
    expect(weekdayIndexFromLabel('周日')).toBe(6)
    // 与 Excel 版的关键差异：版面表头里的「3」不是星期
    expect(weekdayIndexFromLabel('3')).toBeNull()
    expect(weekdayIndexFromLabel('')).toBeNull()
  })

  it('失败约定 null：已切好的 token 版（整串匹配，含 1-7）', () => {
    expect(weekdayIndexFromToken('一')).toBe(0)
    expect(weekdayIndexFromToken('天')).toBe(6)
    expect(weekdayIndexFromToken('1')).toBe(0)
    expect(weekdayIndexFromToken('7')).toBe(6)
    expect(weekdayIndexFromToken(3)).toBe(2)
    expect(weekdayIndexFromToken('')).toBeNull()
    expect(weekdayIndexFromToken('8')).toBeNull()
    expect(weekdayIndexFromToken('礼拜一')).toBeNull()
    expect(weekdayIndexFromToken('星期一')).toBeNull()
  })

  it('四个变体的调用点接线仍然是 facade 那一份', () => {
    expect(parseWeekdayToken('日')).toBe(6)
    expect(parseWeekdayToken('3')).toBe(2)
    expect(parseWeekdayToken('礼拜一')).toBeNull()
  })
})

describe('facade · 节次文本 → 「1-2节」 / { start, end }（三套返回约定）', () => {
  it('Excel 版：认不出时**透传原文**，绝不返回 null（否则垃圾行会从照常导入变成静默跳过）', () => {
    expect(normalizePeriodText('0102')).toBe('1-2节')
    expect(normalizePeriodText('3-4节')).toBe('3-4节')
    expect(normalizePeriodText('第9节')).toBe('9-9节')
    expect(normalizePeriodText('O5-O6')).toBe('5-6节')
    // 边界：空串返回空串（调用点靠 `!period` 过滤空单元格）；超范围/无意义一律透传
    expect(normalizePeriodText('')).toBe('')
    expect(normalizePeriodText('13-14节')).toBe('13-14节')
    expect(normalizePeriodText('abc')).toBe('abc')
  })

  it('作息表版：返回对象；不编号的特殊时段返回专用对象；其余返回 null', () => {
    expect(parseSchedulePeriod('第一节课')).toMatchObject({ key: '1-1', label: '第1节', start: 1, end: 1 })
    expect(parseSchedulePeriod('第1、2节')).toMatchObject({ key: '1-2', label: '第1-2节' })
    expect(parseSchedulePeriod('3')).toMatchObject({ key: '3-3', start: 3, end: 3 })
    expect(parseSchedulePeriod('早自习')).toMatchObject({ key: '早自习', label: '早自习', start: null, end: null })
    // 边界：空串 / 无法编号 / 编号超上限 30
    expect(parseSchedulePeriod('')).toBeNull()
    expect(parseSchedulePeriod('说明文字')).toBeNull()
    expect(parseSchedulePeriod('第31节')).toBeNull()
  })

  it('版面严格版：必须带「节」字；编号只保留 1-12，失败返回 null', () => {
    expect(parsePeriodRange('[01-02]节')).toEqual({ start: 1, end: 2 })
    expect(parsePeriodRange('05-06节')).toEqual({ start: 5, end: 6 })
    expect(parsePeriodRange('[05-06-07-08]节')).toEqual({ start: 5, end: 8 })
    // 与 Excel 版的关键差异：没有「节」字就认不出，压缩的 4 位数字需要方括号形态
    expect(parsePeriodRange('0102')).toBeNull()
    expect(parsePeriodRange('13-14节')).toBeNull()
    expect(parsePeriodRange('')).toBeNull()
  })

  it('版面宽松版：给「节」字被 OCR 吃掉的行兜底，至少两个编号才算', () => {
    expect(parseLoosePeriodRange('O5-O6-O7-O8')).toEqual({ start: 5, end: 8 })
    expect(parseLoosePeriodRange('5-12')).toEqual({ start: 5, end: 12 })
    expect(parseLoosePeriodRange('5')).toBeNull()
    expect(parseLoosePeriodRange('13-14')).toBeNull()
    expect(parseLoosePeriodRange('')).toBeNull()
  })

  it('作息表调用点仍然走 facade 的作息版', () => {
    expect(normalizePeriod('第1、2节')).toEqual(parseSchedulePeriod('第1、2节'))
    expect(normalizePeriod('早自习')).toEqual(parseSchedulePeriod('早自习'))
  })
})

describe('facade · OCR 混淆字符类（窄/宽两套）', () => {
  it('窄版只修 O/o 与 I/l/|：课程名里的真实字母不能被当数字', () => {
    expect(fixPeriodDigits('O5-O6')).toBe('05-06')
    expect(fixPeriodDigits('I-2')).toBe('1-2')
    expect(fixPeriodDigits('Q5')).toBe('Q5')
    expect(fixPeriodDigits('D5')).toBe('D5')
    expect(fixPeriodDigits('!')).toBe('!')
  })

  it('宽版连 Q/q/D/d→0、!→1 一起修：作息表整页都是时间数字，容忍度更高', () => {
    expect(fixScheduleDigits('Q5')).toBe('05')
    expect(fixScheduleDigits('d5')).toBe('05')
    expect(fixScheduleDigits('O8：OO')).toBe('08：00')
    expect(fixScheduleDigits('l4.5')).toBe('14.5')
    expect(fixScheduleDigits('!2')).toBe('12')
  })

  it('两套字符类必须保持可区分（合并任何一边都会改动调用方语义）', () => {
    expect(fixPeriodDigits('Q')).not.toBe(fixScheduleDigits('Q'))
    expect(fixPeriodDigits('!')).not.toBe(fixScheduleDigits('!'))
    expect(fixPeriodDigits('O5')).toBe(fixScheduleDigits('O5'))
  })
})

describe('facade · 周次范围与单/双周编码', () => {
  it('版面周次范围：支持 (周)/[周]/单双周前缀，超范围判失败', () => {
    expect(parseWeekRangeFromTable('1-8(周)', 25)).toEqual({ startWeek: 1, endWeek: 8, weekType: 'all' })
    expect(parseWeekRangeFromTable('1-16(双周)', 25)).toEqual({ startWeek: 1, endWeek: 16, weekType: 'even' })
    expect(parseWeekRangeFromTable('5-12[单周]', 25)).toEqual({ startWeek: 5, endWeek: 12, weekType: 'odd' })
    // 边界：没有「周」/ 超 maxWeek / 起止倒置 / 起点 <1 / 空串
    expect(parseWeekRangeFromTable('1-16', 25)).toBeNull()
    expect(parseWeekRangeFromTable('13-16(周)', 12)).toBeNull()
    expect(parseWeekRangeFromTable('16-1(周)', 25)).toBeNull()
    expect(parseWeekRangeFromTable('0-5(周)', 25)).toBeNull()
    expect(parseWeekRangeFromTable('', 25)).toBeNull()
  })

  it('Excel 周次列：透传约定 + 「全学期」，单双周编码成批量文本字面量', () => {
    expect(normalizeWeekText('1-16(周)')).toBe('1-16周')
    expect(normalizeWeekText('1-16(双周)')).toBe('1-16周\t双周')
    expect(normalizeWeekText('5-12(单周)')).toBe('5-12周\t单周')
    expect(normalizeWeekText('全学期')).toBe('全学期')
    expect(normalizeWeekText('3周')).toBe('3周')
    expect(normalizeWeekText('3')).toBe('3周')
    // 边界：空值返回空串（「全学期」由调用点兜底补），认不出透传
    expect(normalizeWeekText('')).toBe('')
    expect(normalizeWeekText('说明文字')).toBe('说明文字')
  })

  it('两种编码之间的转换是显式具名函数，方向不会搞反', () => {
    expect(weekTypeFromChineseToken('单周')).toBe('odd')
    expect(weekTypeFromChineseToken('双周')).toBe('even')
    expect(weekTypeFromChineseToken('每周')).toBeNull()
    expect(weekTypeFromChineseToken('')).toBeNull()
    expect(weekTypeBatchSuffix('odd')).toBe('\t单周')
    expect(weekTypeBatchSuffix('even')).toBe('\t双周')
    expect(weekTypeBatchSuffix('all')).toBe('')
    // 未识别编码不产生后缀（传原值不会「猜」一个单双周）
    expect(weekTypeBatchSuffix('单周')).toBe('')
    expect(weekTypeChineseLabel('单双周列写双周')).toBe('双周')
    expect(weekTypeChineseLabel('每周')).toBe('')
    expect(weekTypeChineseLabel('')).toBe('')
  })
})

describe('facade · 单双周命中（宽松/严格两套语义并存）', () => {
  it('宽松版：未识别的 weekType 视为全周（store.courseInWeek 历史语义，保证课程不消失）', () => {
    expect(weekMatchesWeekTypeLoose(3, 'odd')).toBe(true)
    expect(weekMatchesWeekTypeLoose(4, 'odd')).toBe(false)
    expect(weekMatchesWeekTypeLoose(4, 'even')).toBe(true)
    expect(weekMatchesWeekTypeLoose(3, 'all')).toBe(true)
    expect(weekMatchesWeekTypeLoose(3, undefined)).toBe(true)
    expect(weekMatchesWeekTypeLoose(3, '单周')).toBe(true)
  })

  it('严格版：未识别的 weekType 不命中任何周（导入冲突检测历史语义，避免凭空造冲突）', () => {
    expect(weekMatchesWeekTypeStrict(3, 'all')).toBe(true)
    expect(weekMatchesWeekTypeStrict(3, 'odd')).toBe(true)
    expect(weekMatchesWeekTypeStrict(4, 'odd')).toBe(false)
    expect(weekMatchesWeekTypeStrict(4, 'even')).toBe(true)
    expect(weekMatchesWeekTypeStrict(3, '单周')).toBe(false)
    expect(weekMatchesWeekTypeStrict(3, undefined)).toBe(false)
  })

  it('两套语义在调用点上各自保持原样（这是有意的差异，不是遗漏的统一）', () => {
    expect(weekMatchesWeekTypeLoose(3, '单周')).not.toBe(weekMatchesWeekTypeStrict(3, '单周'))
    // store：课程按原样显示
    expect(courseInWeek({ startWeek: 1, endWeek: 16, weekType: 'odd' }, 3)).toBe(true)
    expect(courseInWeek({ startWeek: 1, endWeek: 16, weekType: 'odd' }, 4)).toBe(false)
    expect(courseInWeek({ startWeek: 1, endWeek: 16, weekType: '单周' }, 3)).toBe(true)
    // courseImport：未识别编码不参与冲突周
    expect(activeWeeks({ startWeek: 1, endWeek: 4, weekType: '单周' }, 25)).toEqual([])
    expect(activeWeeks({ startWeek: 1, endWeek: 4, weekType: 'odd' }, 25)).toEqual([1, 3])
  })
})

describe('facade · 归一化与中文数字（含全角/空串边界）', () => {
  it('三套归一化 profile 各司其职，全角处理差异必须保留', () => {
    expect(normalizeCellText(' 1206（博学楼） ')).toBe('1206(博学楼)')
    // 历史字符类把 ASCII 波浪线 `~` 与全角 `～` 都当横线，两者一起钉住
    expect(normalizeCellText('A—B~C～D')).toBe('A-B-C-D')
    expect(normalizeLayoutText('1-16【周】')).toBe('1-16[周]')
    expect(normalizeLayoutText('A—B')).toBe('A-B')
    // 只有作息表做 NFKC：全角数字/冒号必须能认出来
    expect(normalizeScheduleText('０８：００－０８：４５')).toBe('08:00-08:45')
    expect(normalizeScheduleText('第一节\t08:00')).toBe('第一节 08:00')
    // 三处历史差异：0/false 的处理与【】转换
    expect(normalizeCellText(0)).toBe('0')
    expect(normalizeLayoutText(0)).toBe('')
    expect(normalizeCellText('')).toBe('')
    expect(normalizeLayoutText(undefined)).toBe('')
    expect(normalizeScheduleText(null)).toBe('')
  })

  it('中文数字与节次标签取号：失败一律返回 null，由调用点兜底', () => {
    expect(cnWordToDigits('十二')).toBe('12')
    expect(cnWordToDigits('两')).toBe('2')
    expect(digitize('第十二节课')).toBe('第12节课')
    expect(periodNumberFromLabel('第3节课')).toBe(3)
    // 只认「数字 + 节/课」；纯数字标签返回 null，由 numberedPeriodOptions 顺序兜底补号
    expect(periodNumberFromLabel('3')).toBeNull()
    expect(periodNumberFromLabel('上午一')).toBeNull()
    expect(periodNumberFromLabel('')).toBeNull()
  })
})