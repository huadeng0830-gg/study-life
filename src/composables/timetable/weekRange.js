import { normalizeCellText, normalizeLayoutText } from './textNormalize.js'

// 周次范围 + 单/双周的唯一规范实现。
//
// 【两种编码必须并存】
//   - 'odd' / 'even' / 'all' 是**课程对象**里的编码（版面解析 parseTimetableLayout 产出，
//     store.courseInWeek 与 courseImport.activeWeeks 消费）；
//   - '单周' / '双周' 是**批量文本 / Excel 单元格**里的字面编码（复制粘贴、导出的预览行）。
// 两者在导入链路上是「文本 → 对象」的前后两段，谁都不该被改成对方的写法，
// 所以 facade 只提供两个方向的具名转换。

/** 批量文本里的单/双周字面量 → 课程对象编码；不匹配返回 null。 */
export function weekTypeFromChineseToken(token) {
  if (token === '单周') return 'odd'
  if (token === '双周') return 'even'
  return null
}

/** 课程对象编码 → 批量文本后缀（含前导制表符）；供 toBatchLine / 批量行替换复用。 */
export function weekTypeBatchSuffix(weekType) {
  return weekType === 'odd' ? '\t单周' : weekType === 'even' ? '\t双周' : ''
}

/** 文本里出现「单周/双周」时取出中文字面量（不含制表符）；Excel 的「周类型」列用。 */
export function weekTypeChineseLabel(value) {
  const normalized = normalizeCellText(value)
  return /单周/.test(normalized) ? '单周' : /双周/.test(normalized) ? '双周' : ''
}

/**
 * Excel「周次」列归一化 → 「1-16周」「1-16周\t单周」「全学期」。
 * 失败约定：认不出来时原样返回归一化文本（与 normalizePeriodText 同样的「透传」约定），
 * 空值返回 ''，调用点再用 `week || '全学期'` 兜底——不能在这里直接补「全学期」。
 */
export function normalizeWeekText(value) {
  const normalized = normalizeCellText(value)
  if (!normalized) return ''
  if (/全学期/.test(normalized)) return '全学期'
  const matched = normalized.match(/(\d{1,2})\s*[-至到]\s*(\d{1,2})/)
  if (matched) {
    const label = weekTypeChineseLabel(normalized)
    return `${matched[1]}-${matched[2]}周${label ? `\t${label}` : ''}`
  }
  const single = normalized.match(/^(\d{1,2})\s*周?$/)
  return single ? `${single[1]}周` : normalized
}

/**
 * 课表版面/OCR 行的周次范围。
 * 失败约定：null（含范围校验：起点 <1、终点 < 起点、终点 > maxWeek 一律判失败）。
 * weekType 用课程对象编码（odd/even/all）。
 */
export function parseWeekRangeFromTable(value, maxWeek) {
  const normalized = normalizeLayoutText(value)
  const match = normalized.match(/(\d{1,2})\s*-\s*(\d{1,2})\s*(?:[\[(](?:单|双)?周[\])]|(?:单|双)?周)/)
  if (!match) return null
  const startWeek = Number(match[1])
  const endWeek = Number(match[2])
  if (startWeek < 1 || endWeek < startWeek || endWeek > maxWeek) return null
  return {
    startWeek,
    endWeek,
    weekType: normalized.includes('单周') ? 'odd' : normalized.includes('双周') ? 'even' : 'all',
  }
}

/**
 * 单双周命中判定（宽松版）：**未识别**的 weekType 视为「全周」。
 * 这是 store.courseInWeek 的历史语义——旧数据里可能存着 '单周' 这类未迁移编码，
 * 宽松版选择「照常显示」，避免课表整门消失。
 */
export function weekMatchesWeekTypeLoose(week, weekType) {
  const type = weekType ?? 'all'
  if (type === 'odd') return week % 2 === 1
  if (type === 'even') return week % 2 === 0
  return true
}

/**
 * 单双周命中判定（严格版）：只承认 all/odd/even，未识别编码**不命中任何周**。
 * 这是 courseImport.activeWeeks 的历史语义——冲突检测必须严格，否则把未识别编码
 * 当成「全周」会凭空造出与整学期的冲突。两者语义不同、服务不同子系统，不能合并。
 */
export function weekMatchesWeekTypeStrict(week, weekType) {
  if (weekType === 'all') return true
  if (weekType === 'odd') return week % 2 === 1
  if (weekType === 'even') return week % 2 === 0
  return false
}