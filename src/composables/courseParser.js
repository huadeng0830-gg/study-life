// 课程表批量录入优化解析器
// 解决问题：复制粘贴识别失败、OCR慢、识别错误

// 常量定义
const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const WEEKDAY_ALIAS = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }
const FILLER_WORDS = /^(?:课程|课程名称|课程名|名称|星期|星期几|周几|周次|节次|节数|时间|上课时间|时段|类型|上课周类型|每周|地点|位置|教室|教师|老师|备注)$/
const STRONG_ROOM = /^(?:[A-Za-z]{0,3}-?\d{2,4}|[^\s]*?(?:教学楼|实验楼|实训楼|教室|实验室|机房|报告厅|体育馆|图书馆|操场|楼|馆|栋|厅)[^\s]*)$/

// 统一的文本标准化函数
export function normalizeText(text) {
  
  // 全角符号转半角
  let normalized = text
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0)) // 全角字符转半角
    .replace(/[\u201C\u201D\uFF02]/g, '"') // 弯双引号 → 直双引号
    .replace(/[\u2018\u2019\uFF07]/g, "'") // 弯单引号 → 直单引号
    .replace(/\u3001/g, ',') // 顿号
    .replace(/\u3002/g, '.') // 句号
    .replace(/\u3010/g, '[') // 【
    .replace(/\u3011/g, ']') // 】
  
  // 统一各种横线和波浪线
  normalized = normalized.replace(/[~－∼～–—]/g, '-')
  
  // 压缩多余空格
  normalized = normalized.replace(/[ \t]+/g, ' ')
  normalized = normalized.replace(/ +/g, ' ')
  
  // 去除空行
  normalized = normalized.replace(/\n{3,}/g, '\n\n')
  
  // 统一换行符
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  
  
  return normalized.trim()
}

// 中文数字转换
export function cnWordToDigits(word) {
  if (/^[0-9]+$/.test(word)) return word
  if (word.includes('十')) {
    const [left, right] = word.split('十')
    const tens = left ? CN_DIGITS[left] ?? 1 : 1
    const ones = right ? CN_DIGITS[right] ?? 0 : 0
    return String(tens * 10 + ones)
  }
  return String(CN_DIGITS[word] ?? '')
}

// 把中文数字转换成阿拉伯数字
export function digitize(text) {
  return String(text).replace(/[零〇一两二三四五六七八九十]{1,3}/g, cnWordToDigits)
}

// 解析星期标记
export function parseWeekdayToken(token) {
  if (/^[1-7]$/.test(token)) return Number(token) - 1
  return WEEKDAY_ALIAS[token] ?? null
}

// OCR常见错误纠正
export function correctOCRErrors(text) {
  
  const corrected = text
    .replace(/[Il][l1]-[l1][l1]节/g, '1-2节') // I-2节 -> 1-2节
    .replace(/[lI]-[l1][l1]节/g, '1-2节')
    .replace(/[A-Za-z](\d{2,4})/g, (match, digits) => match.charAt(0) + digits.replace(/[O0]/g, '0').replace(/[lI]/g, '1').replace(/[B]/g, '8')) // 教室号纠错
    .replace(/周[—\-]/g, '周-') // 周一 -> 周- 修复
    .replace(/[lI]-[l1]/g, '1-2') // I-2 -> 1-2
    .replace(/[O0](\d{2,4})/g, '0$1') // 0201 -> 0201
  
  
  return corrected
}

// 强特征识别器 - 识别星期、节次、周次等明显特征
export function extractStrongFeatures(segments, periodsMax, MAX_WEEK) {
  const features = {
    weekday: null,
    periodStart: null,
    periodEnd: null,
    startWeek: null,
    endWeek: null,
    weekType: 'all',
    room: null,
    teacher: null,
    remainingSegments: []
  }
  
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const lowerSegment = segment.toLowerCase()

    const labeledRoom = segment.match(/^(?:地点|位置|教室)[:：](.+)$/)
    if (features.room === null && labeledRoom?.[1]) {
      features.room = labeledRoom[1]
      continue
    }

    const labeledTeacher = segment.match(/^(?:教师|老师)[:：](.+)$/)
    if (features.teacher === null && labeledTeacher?.[1]) {
      features.teacher = labeledTeacher[1]
      continue
    }
    
    // 识别星期特征
    if (features.weekday === null) {
      const weekdayMatch = segment.match(/(?:周|星期|礼拜)\s*([一二三四五六日天]|[1-7])/)
      if (weekdayMatch) {
        features.weekday = parseWeekdayToken(weekdayMatch[1])
        continue
      }
      
      const dayMatch = segment.match(/^[一二三四五六日天]$/)
      if (dayMatch) {
        features.weekday = parseWeekdayToken(dayMatch[0])
        continue
      }
    }
    
    // 识别节次特征
    if (features.periodStart === null) {
      const periodMatch = segment.match(/第?(\d{1,2})(?:[\s\-~－至到]*(\d{1,2}))?节/)
      if (periodMatch) {
        const start = parseInt(periodMatch[1])
        const end = periodMatch[2] ? parseInt(periodMatch[2]) : start
        if (start >= 1 && end <= periodsMax && start <= end) {
          features.periodStart = start
          features.periodEnd = end
          continue
        }
      }
      
      // 检查是否为纯数字且在节次范围内
      const numMatch = segment.match(/^(\d{1,2})$/)
      if (numMatch && !features.periodStart) {
        const num = parseInt(numMatch[1])
        if (num >= 1 && num <= periodsMax) {
          features.periodStart = num
          features.periodEnd = num
          continue
        }
      }
    }
    
    // 单双周可能写在周次范围之后，不能受 startWeek 是否已识别的限制。
    if (segment === '单周') {
      features.weekType = 'odd'
      continue
    }

    if (segment === '双周') {
      features.weekType = 'even'
      continue
    }

    // 识别周次特征
    if (features.startWeek === null) {
      if (segment === '全学期') {
        features.startWeek = 1
        features.endWeek = MAX_WEEK
        continue
      }
      
      const weekMatch = segment.match(/第?(\d{1,2})(?:[\s\-~－至到]*(\d{1,2}))?周/)
      if (weekMatch) {
        const start = parseInt(weekMatch[1])
        const end = weekMatch[2] ? parseInt(weekMatch[2]) : start
        if (start >= 1 && end <= MAX_WEEK && start <= end) {
          features.startWeek = start
          features.endWeek = end
          continue
        }
      }
      
      // 检查是否为纯数字且在周次范围内
      const numMatch = segment.match(/^(\d{1,2})$/)
      if (numMatch && !features.startWeek && !features.periodStart) {
        const num = parseInt(numMatch[1])
        if (num >= 1 && num <= MAX_WEEK) {
          features.startWeek = num
          features.endWeek = num
          continue
        }
      }
    }
    
    // 识别教室特征
    if (features.room === null && STRONG_ROOM.test(segment)) {
      features.room = segment
      continue
    }
    
    // 识别教师特征
    if (features.teacher === null && (segment.includes('老师') || segment.includes('教授') || segment.includes('师'))) {
      features.teacher = segment
      continue
    }
    
    // 未识别的段放入剩余列表
    features.remainingSegments.push(segment)
  }
  
  return features
}

// “第 1 节”应对应标签中的“第一节课”，不能简单按数组下标取值，
// 因为课表前面可能还有“早自习”等不编号时段。
export function numberedPeriodOptions(periods) {
  const source = Array.isArray(periods) ? periods : []
  const nonCoursePeriod = /早自习|午休|午餐|晚自习|课间|休息/
  const used = new Set()
  let nextNumber = 1
  return source.flatMap((period) => {
    const label = String(period?.label ?? '').trim()
    if (!period?.id || nonCoursePeriod.test(label)) return []
    const match = digitize(label).match(/(?:第)?(\d{1,2})\s*(?:节|课)/)
    let number = match ? Number(match[1]) : null
    if (!Number.isInteger(number) || number < 1 || used.has(number)) {
      while (used.has(nextNumber)) nextNumber++
      number = nextNumber
    }
    used.add(number)
    nextNumber = Math.max(nextNumber, number + 1)
    return [{ ...period, number }]
  })
}

export function periodIdFromNumber(periods, number) {
  return numberedPeriodOptions(periods).find((period) => period.number === number)?.id ?? null
}

// 计算解析置信度
export function calculateConfidence(features, periodsMax) {
  let confidence = 0
  const details = {
    hasName: false,
    hasWeekday: features.weekday !== null,
    hasPeriod: features.periodStart !== null && features.periodEnd !== null,
    hasWeek: features.startWeek !== null && features.endWeek !== null,
    hasRoom: features.room !== null,
    hasTeacher: features.teacher !== null
  }
  
  // 核心字段权重更高
  if (details.hasWeekday) confidence += 1
  if (details.hasPeriod) confidence += 1
  if (details.hasWeek) confidence += 0.8
  if (details.hasRoom) confidence += 0.5
  if (details.hasTeacher) confidence += 0.5
  
  // 检查课程名（从剩余段中推断）
  if (features.remainingSegments.length > 0) {
    details.hasName = true
    confidence += 1
  }
  
  // 检查节次是否有效
  if (details.hasPeriod) {
    const startId = periodsMax > 0 && features.periodStart <= periodsMax ? features.periodStart : null
    const endId = periodsMax > 0 && features.periodEnd <= periodsMax ? features.periodEnd : null
    if (!startId || !endId) {
      confidence -= 0.5 // 节次超出范围
    }
  }
  
  
  return {
    score: Math.max(0, Math.min(1, confidence / 4)), // 归一化到0-1
    details,
    level: confidence >= 3 ? 'high' : confidence >= 2 ? 'medium' : confidence >= 1 ? 'low' : 'very_low'
  }
}

// 重构后的解析函数
export function parseBatchLine(line, sourceIndex, timeConfig, MAX_WEEK) {
  
  const periods = timeConfig.value.periods
  const periodsMax = periods.length
  const explicitRoom = String(line).match(/(?:地点|位置|教室)[:：]\s*(.+?)(?=\s+(?:教师|老师|地点|位置|教室)[:：]|[\t,，;；|]|$)/)?.[1]?.trim() || ''
  const explicitTeacher = String(line).match(/(?:教师|老师)[:：]\s*(.+?)(?=\s+(?:地点|位置|教室|教师|老师)[:：]|[\t,，;；|]|$)/)?.[1]?.trim() || ''
  const work = digitize(line)
    .replace(/\u00a0/g, ' ')
    .replace(/[()（）[\]【】〔〕《》<>]/g, ' ')

  // 使用强特征识别器
  const segments = work
    .split(/[\t,，、;；。·|]+|\s+/)
    .map((segment) => segment.replace(/^["'""'''「『]+|["'""'''」』]+$/g, '').trim())
    .filter(Boolean)
  
  const features = extractStrongFeatures(segments, periodsMax, MAX_WEEK)
  if (explicitRoom) features.room = explicitRoom
  if (explicitTeacher) features.teacher = explicitTeacher
  const confidence = calculateConfidence(features, periodsMax)
  
  // 从剩余段中提取课程名
  let name = ''
  if (features.remainingSegments.length > 0) {
    // 排除填充词
    const nameCandidates = features.remainingSegments.filter(seg => !FILLER_WORDS.test(seg))
    // 第一个非填充词作为课程名
    name = nameCandidates[0] || ''
    // 如果第一个是教室号且已有教室，则取下一个
    if (name && STRONG_ROOM.test(name) && features.room && !nameCandidates[1]) {
      name = features.room
    }
  }
  
  // 如果没有课程名，尝试从原始行中提取
  if (!name) {
    const nonFeatureText = segments.filter(seg => 
      !FILLER_WORDS.test(seg) && 
      !STRONG_ROOM.test(seg) &&
      !seg.includes('老师') &&
      !seg.includes('教授') &&
      !seg.includes('师')
    ).join(' ')
    name = nonFeatureText.substring(0, 50) || ''
  }
  
  // 错误收集
  const problems = []
  if (!name) problems.push('缺少课程名称')
  if (features.weekday === null) problems.push('未识别星期（需要"周一""星期三"这类字样）')
  if (features.periodStart === null) problems.push(`未识别节次（如"1-2节""第3节"，当前共 ${periodsMax} 节）`)
  if (features.startWeek === null) {
    features.startWeek = 1
    features.endWeek = 16
  }
  if (features.endWeek < features.startWeek) {
    [features.startWeek, features.endWeek] = [features.endWeek, features.startWeek]
  }
  if (features.startWeek < 1 || features.endWeek > MAX_WEEK) {
    problems.push(`周次超出范围（应在 1-${MAX_WEEK} 周之间）`)
  }
  
  const startId = features.periodStart ? periodIdFromNumber(periods, features.periodStart) : null
  const endId = features.periodEnd ? periodIdFromNumber(periods, features.periodEnd) : null
  if (features.periodStart !== null && (!startId || !endId)) {
    problems.push(`节次超出范围（当前共 ${periodsMax} 节）`)
  }
  
  // 构建结果
  const result = {
    sourceIndex,
    name,
    error: problems.join('；'),
    data: problems.length || !startId || !endId
      ? null
      : {
          name,
          day: features.weekday ?? 0,
          start: startId,
          end: endId,
          startWeek: features.startWeek,
          endWeek: features.endWeek,
          weekType: features.weekType,
          room: features.room,
          teacher: features.teacher,
        },
    cells: segments,
    confidence,
    needsReview: confidence.level === 'very_low' || confidence.level === 'low'
  }
  
  
  return result
}
