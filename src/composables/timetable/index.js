// 课表解析 facade：五份课表/作息解析器共用的语义全部收口在这里。
//
// 【为什么导出的是「具名变体」而不是一个唯一函数】
// 五份解析器今天的行为并不一致，而且这些差异大多有真实原因：
//   - 失败约定 -1 还是 null，决定调用方怎么写过滤条件；
//   - OCR 字符类宽窄，决定「真实字母 O/Q/D」会不会被误当数字；
//   - weekType 的 'odd' 与 '单周' 分属课程对象与批量文本两种表示。
// 统一约定等于改动调用方语义，所以 facade 把每套语义拆成具名函数，
// 差异写进函数名和注释，调用点必须显式选择（见各模块文件头的「为什么」）。
//
// 模块职责：
//   textNormalize.js  解析前文本归一化（Excel / 版面 / 作息三套历史 profile）
//   chineseNumber.js  中文数字转换 + 节次标签取号
//   weekday.js        星期 token / 文本 → 0-6（-1 与 null 两套失败约定分开）
//   ocrFixup.js       OCR 混淆字形 → 数字（两套字符类）
//   period.js         节次文本 → 「1-2节」/ { start, end }（三种返回约定）
//   weekRange.js      周次范围与单/双周（两种编码 + 两种单双周判定语义）
//
// 本 facade 不 import 任何解析器，也不 import courseParser，因此可以安全地被
// 每个解析器静态引用，不会形成循环依赖，也不会把 courseParser 拖进懒加载链路。
export * from './textNormalize.js'
export * from './chineseNumber.js'
export * from './weekday.js'
export * from './ocrFixup.js'
export * from './period.js'
export * from './weekRange.js'