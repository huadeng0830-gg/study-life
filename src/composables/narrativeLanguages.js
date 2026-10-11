/**
 * 叙事语言的可选值（纯常量，零 import）。
 *
 * 【为什么不放在 narrative.js 里】`narrative.js` 在模块级就注册了 `sl_ui_language`
 * 这条响应式存储引用，而备份解析（backupArchive.js）需要在**不触碰存储**的前提下
 * 校验导入值的合法性 —— 一个从 `parseBackupArchive()` 走出来的坏语言（"fr"、"zh-CN"）
 * 会被原样写进存储，只等下次页面加载才被 `narrative.js` 悄悄改回默认值。
 * 把这份清单放到没有任何依赖的独立文件里，校验方与使用方读的是同一份。
 *
 * 范围仍然只有**节日叙事文案**（节日名与祝福语）：仓库零 i18n 基建，界面与表单
 * 一律仍是中文。理由见 narrative.js 的文件头。
 */

export const DEFAULT_NARRATIVE_LANGUAGE = 'zh'

export const NARRATIVE_LANGUAGES = Object.freeze([
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
])

/** 是否是受支持的语言 id。备份导入与坏数据修复都用它，界面上不会拿到未定义的语言。 */
export function isNarrativeLanguage(value) {
  return NARRATIVE_LANGUAGES.some((item) => item.id === value)
}