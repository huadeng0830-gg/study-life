// OCR 混淆字形 → 数字的唯一实现。
//
// 【为什么是两套字符类，而不是一套】
// 课表解析器只在「节次」这种短字段上做修正，误伤风险高，因此只承认 O/o→0、I/l/|→1；
// 作息表整页都是时间数字，Q/q/D/d 也常是 0、「!」也常是 1，所以放宽。
// 两套同时存在是因为容忍度本就不同：合并成宽版会让课程名里的真实字母 O/Q/D
// 被当成数字，合并成窄版会让作息表里的全角/混淆时间认不出来。

/** 课表解析器字符类：O/o→0、I/l/|→1。 */
export function fixPeriodDigits(value) {
  return String(value).replace(/[Oo]/g, '0').replace(/[Il|]/g, '1')
}

/** 作息表字符类：在窄版基础上再加 Q/q/D/d→0、!→1。 */
export function fixScheduleDigits(value) {
  return String(value).replace(/[OoQqDd]/g, '0').replace(/[Il|!]/g, '1')
}