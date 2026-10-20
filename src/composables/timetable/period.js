import { digitize } from './chineseNumber.js'
import { fixPeriodDigits, fixScheduleDigits } from './ocrFixup.js'
import { normalizeCellText, normalizeLayoutText, normalizeScheduleText } from './textNormalize.js'

// 节次文本 → 「1-2节」/ { start, end } 的唯一规范实现。
//
// 【为什么三种返回约定都要留着】
//   - normalizePeriodText（Excel）：永不返回 null，认不出时原样返回归一化文本。
//     调用点用 `!period` 只过滤空单元格，垃圾节次仍会照常进入批量文本；改成 null
//     会让这类行从「照常导入」变成「静默跳过」。
//   - parseSchedulePeriod（作息表）：返回对象或 null，且「早自习/晚自习」这类不编号
//     时段必须返回专用对象（start/end 为 null），不能并进 null。
//   - parsePeriodRange / parseLoosePeriodRange（版面 OCR）：返回 { start, end } 或 null，
//     前者是严格版（要求「节」字），后者是宽松版（表头被 OCR 吃掉「节」时的补救）。

/**
 * Excel 列表/网格的节次归一化。
 * 失败约定：不返回 null——认不出来时原样返回归一化文本（见文件头说明）。
 */
export function normalizePeriodText(value) {
  const normalized = fixPeriodDigits(normalizeCellText(value))
  const compact = normalized.match(/(?:^|\D)(0[1-9]|1[0-2])(0[1-9]|1[0-2])(?:\D|$)/)
  if (compact) return `${Number(compact[1])}-${Number(compact[2])}节`
  const range = normalized.match(/(?:第?\s*)?(\d{1,2})(?:\s*[-至到]\s*(\d{1,2}))?\s*(?:节|课)?/)
  if (!range) return normalized
  const start = Number(range[1])
  const end = Number(range[2] || range[1])
  if (start < 1 || end < start || end > 12) return normalized
  return `${start}-${end}节`
}

/**
 * 作息表节次：返回 { key, label, start, end, raw }，无法编号时：
 *   - 是「早自习/晨读/午休/晚自习/预备」等特殊时段 → 返回 start/end 为 null 的对象；
 *   - 其余 → null（调用方据此插入「未识别」占位行，绝不猜默认时间）。
 * 编号上限 30（作息表可能含早自习等多段，比课表的 12 节宽松），这是历史行为。
 */
export function parseSchedulePeriod(value) {
  const raw = normalizeScheduleText(value)
  const normalized = fixScheduleDigits(digitize(raw))
    .replace(/[、,，/至到~～－—–]+/g, '-')
  let numbers = []
  const explicit = normalized.match(/第?\s*(\d{1,2})(?:\s*-\s*(?:第?\s*)?(\d{1,2}))?\s*(?:节|课)/)
  if (explicit) numbers = [Number(explicit[1]), Number(explicit[2] || explicit[1])]
  if (!numbers.length && /^\s*\d{1,2}\s*$/.test(normalized)) numbers = [Number(normalized), Number(normalized)]
  numbers = numbers.filter((number) => number >= 1 && number <= 30)
  if (!numbers.length) {
    const special = raw.match(/早自习|晨读|午自习|午休|晚自习|预备/)
    return special ? { key: special[0], label: special[0], start: null, end: null, raw } : null
  }
  const start = Math.min(...numbers)
  const end = Math.max(...numbers)
  return { key: `${start}-${end}`, label: start === end ? `第${start}节` : `第${start}-${end}节`, start, end, raw }
}

/**
 * 课表版面的严格节次解析：必须带「节」字（含方括号/圆括号列表形式）。
 * 失败约定：null；编号只保留 1–12，超出即视为没认出来。
 */
export function parsePeriodRange(value) {
  const normalized = fixPeriodDigits(normalizeLayoutText(value))
  const bracket = normalized.match(/[[(]([\d\s,，、/\-]{2,24})[\])]?\s*节/)
  const list = normalized.match(/((?:0?[1-9]|1[0-2])(?:\s*-\s*(?:0?[1-9]|1[0-2])){1,5})[\])]?\s*节/)
  const simple = normalized.match(/第?\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*节/)
  let numbers = []

  const compact = normalized.match(/(?:^|\D)(0[1-9]|1[0-2])(0[1-9]|1[0-2])\s*节/)
  if (compact) return { start: Number(compact[1]), end: Number(compact[2]) }

  if (bracket) numbers = bracket[1].match(/\d{1,2}/g)?.map(Number) || []
  else if (list) numbers = list[1].match(/\d{1,2}/g)?.map(Number) || []
  else if (simple) numbers = [Number(simple[1]), Number(simple[2] || simple[1])]

  // 「01020304」这种被压掉的方括号列表：整段按两位一组拆。
  if (numbers.length === 1 && /^\d{4,8}$/.test(bracket?.[1]?.replace(/\D/g, '') || '')) {
    numbers = bracket[1].replace(/\D/g, '').match(/\d{2}/g).map(Number)
  }
  numbers = numbers.filter((number) => number >= 1 && number <= 12)
  if (!numbers.length) return null
  return { start: Math.min(...numbers), end: Math.max(...numbers) }
}

/**
 * 课表版面的宽松节次解析：给「节」字被 OCR 吃掉的行兜底。
 * 失败约定：null，且至少要认出两个编号（单个编号信息量不足，交由严格版判定）。
 */
export function parseLoosePeriodRange(value) {
  const normalized = fixPeriodDigits(normalizeLayoutText(value))
  const match = normalized.match(/(?:^|\D)((?:0?[1-9]|1[0-2])(?:\s*-\s*(?:0?[1-9]|1[0-2])){1,5})(?:\D|$)/)
  if (!match) return null
  const numbers = match[1].match(/\d{1,2}/g)?.map(Number)
    .filter((number) => number >= 1 && number <= 12) || []
  if (numbers.length < 2) return null
  return { start: Math.min(...numbers), end: Math.max(...numbers) }
}