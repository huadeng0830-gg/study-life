/**
 * 叙事文案的多语言（第五十四轮）。
 *
 * 【为什么只做"叙事"】仓库零 i18n 基建：没有 vue-i18n 之类依赖，界面文案是 148 个
 * 源文件里 4741 行硬编码中文，而**测试侧更硬**——151 个测试文件含中文断言。全量 i18n
 * 的工作量主要不在产品代码，而在改写那 151 个文件的断言；在"不新增任何 npm 依赖"的
 * 硬约束下，那条路等于把仓库重写一遍。所以这里只做**叙事类**文案：节日名与节日祝福语。
 * 界面、表单、按钮一律不动，仍是中文。
 *
 * 【一个必须说清楚的前提】本轮之前，`festive.js` 产出的 `name` / `message` 在界面上
 * **一处都没有渲染**（首页的问候语是纯时间问候"早上好/晚上好"，节日文案只用来决定装饰）。
 * 也就是说"把节日祝福语做成多语言"本来会是在翻译看不见的字符串。所以这一轮顺带把
 * 叙事**接进首页**（首页页头显示"节日名 · 祝福语"）——这也正是设置页文案早就承诺过的
 * "首页的祝福语"。
 *
 * 【译文表为什么不放中文原文】中文原文的唯一真源是 `festive.js`（它自己产出
 * `name` / `message`）。这里只放译文，缺条目时**自动回落原文**——不抄第二份会漂移的副本。
 */

import { useStoredRef } from './store/index.js'

/** 语言偏好键（新增；不改任何既有 `sl_*` 的语义）。 */
export const NARRATIVE_LANGUAGE_KEY = 'sl_ui_language'
export const DEFAULT_NARRATIVE_LANGUAGE = 'zh'

export const NARRATIVE_LANGUAGES = Object.freeze([
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
])

export const narrativeLang = useStoredRef(NARRATIVE_LANGUAGE_KEY, DEFAULT_NARRATIVE_LANGUAGE)
// 坏值修复：存了不认识的语言就退回默认，不让界面拿到 undefined。
if (!NARRATIVE_LANGUAGES.some((item) => item.id === narrativeLang.value)) {
  narrativeLang.value = DEFAULT_NARRATIVE_LANGUAGE
}

/**
 * 只放译文。键与 `festive.js` 里产出的氛围 key 一一对应。
 * 固定节日（公历 6 个 + 农历 7 个）与生日是**静态文案**，可以整句翻译。
 */
export const NARRATIVE_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    newyear: { name: "New Year's Day", message: 'Happy New Year — a fresh page to turn.' },
    valentine: { name: "Valentine's Day", message: 'May today bring tenderness and a little romance.' },
    aprilfools: { name: "April Fools' Day", message: 'Take today with a smile.' },
    children: { name: "Children's Day", message: 'Keep the childlike heart — give yourself something sweet today.' },
    national: { name: 'National Day', message: 'Wide rivers and mountains — enjoy the holiday.' },
    christmas: { name: 'Christmas', message: 'Merry Christmas, peace and ease.' },
    spring: { name: 'Spring Festival', message: 'Happy New Year — reunion and good fortune.' },
    lantern: { name: 'Lantern Festival', message: 'Happy Lantern Festival — together and whole.' },
    qingming: { name: 'Qingming Festival', message: 'A season for remembrance and for cherishing.' },
    dragon: { name: 'Dragon Boat Festival', message: 'Peace and health — the scent of reed leaves.' },
    midautumn: { name: 'Mid-Autumn Festival', message: 'Happy Mid-Autumn — full moon, reunited family.' },
    chongyang: { name: 'Double Ninth Festival', message: 'Climb high, and let the missing linger.' },
    winter: { name: 'Winter Solstice', message: 'Stay well — have something warm today.' },
    birthday: { name: 'My birthday', message: 'Happy birthday! May this new year of your life shine.' },
  }),
})

/**
 * **明确排除**的个人节点：它们的文案是"动态"的——纪念日会把用户自己填的标签拼进去
 * （`${label}快乐…`），使用周年会把年数拼进去。整句翻译会丢掉这两样信息，所以本轮
 * 明确不译、回落中文，并在这里写明这是**有意的范围**而不是漏掉的条目。
 * 要让它们也能翻译，`festive.js` 得改成暴露结构化数据（标签、年数）而不是现成的句子。
 */
export const NARRATIVE_DYNAMIC_KEYS = Object.freeze(['anniversary', 'anniversary-start'])

/**
 * 取某天氛围的叙事文案。`translated` 标明是否真的命中了译文——
 * 调用方可据此区分"已翻译"与"回落原文"，而不是让回落悄悄发生。
 */
export function narrativeFor(festive, lang = DEFAULT_NARRATIVE_LANGUAGE) {
  if (!festive || !festive.key) return null
  const translated = NARRATIVE_TRANSLATIONS[lang]?.[festive.key]
  return {
    key: festive.key,
    name: translated?.name || festive.name,
    message: translated?.message || festive.message,
    translated: Boolean(translated),
  }
}