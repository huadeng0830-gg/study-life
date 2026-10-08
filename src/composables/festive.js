// 氛围与节日引擎（模块 A）：纯函数判断某天命中哪个节日、生日或纪念日，
// 产出 key / name / 主题色 / 祝福语 / 装饰类型（snow|confetti|lantern|null）。
// 本文件不读写任何存储键，供单测直接调用；存储与坏数据修复见 atmosphereStore.js。
// 农历/节气节日使用下方静态公历日期表（LUNAR_FESTIVAL_DATES）计算，不依赖运行时历法库；
// 超出表覆盖年份（2015–2050）时命中不到即跳过（不报错、不编造）。
// 农历纪念日（新键 sl_festive_lunar）的数据不在本文件、也不在入参 config 里：
// findLunarAnniversaryForDate 读的是 lunarAnniversaries.js 维护的内存镜像
// （首次读取从该键补水），所以这里依然不直接触达 localStorage。

import { findLunarAnniversaryForDate, LUNAR_ANNIVERSARY_PRESENTATION } from './lunarAnniversaries.js'

const pad2 = (value) => String(value).padStart(2, '0')

function toDate(value) {
  if (value instanceof Date) return value
  const date = new Date(`${String(value ?? '')}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function fullDateOf(value) {
  const date = toDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const FULL_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * 月-日是否命中。
 *
 * 直接比较字符串时，配置为 `02-29` 的生日/安装日在**非闰年永远不会命中**：
 * 2027 不匹配、2028 匹配时 elapsed 已经等于 2，于是"第一周年"整年不显示。
 * 这里让 `02-29` 在非闰年落到 `02-28`。
 */
function sameMonthDay(configured, today, year) {
  if (configured === today) return true
  return configured === '02-29' && today === '02-28' && !isLeapYear(year)
}

/** 正则只校验数字范围，`02-31`、`04-31` 都能通过 —— 用真实日期回读校验。 */
function isRealMonthDay(value) {
  if (!MONTH_DAY_RE.test(value)) return false
  const [month, day] = value.split('-').map(Number)
  // 以 2000 年（闰年）为探针：02-29 合法，02-31 / 04-31 会被 Date 归一化掉。
  const probe = new Date(Date.UTC(2000, month - 1, day))
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

function isRealFullDate(value) {
  if (!FULL_DATE_RE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

export const DEFAULT_FESTIVE_CONFIG = Object.freeze({
  enabled: true,
  birthday: '',
  installDate: '',
  anniversaries: [],
})

// 坏数据修复：丢弃不合法日期与空标签的纪念日，缺省字段用默认值补齐。
export function normalizeFestiveConfig(config) {
  const base = JSON.parse(JSON.stringify(DEFAULT_FESTIVE_CONFIG))
  if (!config || typeof config !== 'object' || Array.isArray(config)) return base
  const out = { ...base }
  out.enabled = config.enabled !== false
  out.birthday = isRealMonthDay(String(config.birthday ?? '')) ? String(config.birthday) : ''
  out.installDate = isRealFullDate(String(config.installDate ?? '')) ? String(config.installDate) : ''
  const rawAnniversaries = Array.isArray(config.anniversaries) ? config.anniversaries : []
  out.anniversaries = rawAnniversaries
    .filter((item) => item && isRealMonthDay(String(item.date ?? '')))
    .map((item) => ({ date: item.date, label: String(item.label ?? '').trim() }))
    .filter((item) => item.label)
  return out
}

// 固定公历节日（月-日），年年相同。
export const SOLAR_FIXED = {
  '01-01': { key: 'newyear', name: '元旦', accentColor: '#e23b3b', message: '新年快乐，翻开崭新的一页。', decor: 'lantern' },
  '02-14': { key: 'valentine', name: '情人节', accentColor: '#ec4899', message: '愿今天有温柔与浪漫作伴。', decor: 'confetti' },
  '04-01': { key: 'aprilfools', name: '愚人节', accentColor: '#8b5cf6', message: '今天的话，记得笑一笑。', decor: null },
  '06-01': { key: 'children', name: '儿童节', accentColor: '#f59e0b', message: '保持童心，今天也给自己一点甜。', decor: 'confetti' },
  '10-01': { key: 'national', name: '国庆节', accentColor: '#ef4444', message: '山河远阔，假期愉快。', decor: 'confetti' },
  '12-25': { key: 'christmas', name: '圣诞节', accentColor: '#2f9e6e', message: '圣诞快乐，平安顺遂。', decor: 'snow' },
}

// 农历/节气节日定义。公历日期见 LUNAR_FESTIVAL_DATES 静态表。
export const LUNAR_DEFS = {
  spring: { key: 'spring', name: '春节', accentColor: '#e23b3b', message: '新春大吉，阖家团圆。', decor: 'lantern' },
  lantern: { key: 'lantern', name: '元宵节', accentColor: '#f59e0b', message: '元宵快乐，团团圆圆。', decor: 'lantern' },
  qingming: { key: 'qingming', name: '清明节', accentColor: '#10b981', message: '清明时节，追忆与珍惜。', decor: null },
  dragon: { key: 'dragon', name: '端午节', accentColor: '#0ea271', message: '端午安康，粽叶飘香。', decor: null },
  midautumn: { key: 'midautumn', name: '中秋节', accentColor: '#f97316', message: '中秋快乐，月圆人团圆。', decor: null },
  chongyang: { key: 'chongyang', name: '重阳节', accentColor: '#d97706', message: '重阳登高，思念绵长。', decor: null },
  winter: { key: 'winter', name: '冬至', accentColor: '#64748b', message: '冬至安好，记得吃顿热乎的。', decor: null },
}

// 农历/节气节日的公历日期表（每年固定 7 个，覆盖 2015–2050）。
// 由 lunar-javascript 一次性生成后固化在此，替换掉约 300KB 的运行时历法引擎。
export const LUNAR_FESTIVAL_DATES = Object.freeze({
  '2015': { '02-19': 'spring', '03-05': 'lantern', '04-05': 'qingming', '06-20': 'dragon', '09-27': 'midautumn', '10-21': 'chongyang', '12-22': 'winter' },
  '2016': { '02-08': 'spring', '02-22': 'lantern', '04-04': 'qingming', '06-09': 'dragon', '09-15': 'midautumn', '10-09': 'chongyang', '12-21': 'winter' },
  '2017': { '01-28': 'spring', '02-11': 'lantern', '04-04': 'qingming', '05-30': 'dragon', '10-04': 'midautumn', '10-28': 'chongyang', '12-22': 'winter' },
  '2018': { '02-16': 'spring', '03-02': 'lantern', '04-05': 'qingming', '06-18': 'dragon', '09-24': 'midautumn', '10-17': 'chongyang', '12-22': 'winter' },
  '2019': { '02-05': 'spring', '02-19': 'lantern', '04-05': 'qingming', '06-07': 'dragon', '09-13': 'midautumn', '10-07': 'chongyang', '12-22': 'winter' },
  '2020': { '01-25': 'spring', '02-08': 'lantern', '04-04': 'qingming', '06-25': 'dragon', '10-01': 'midautumn', '10-25': 'chongyang', '12-21': 'winter' },
  '2021': { '02-12': 'spring', '02-26': 'lantern', '04-04': 'qingming', '06-14': 'dragon', '09-21': 'midautumn', '10-14': 'chongyang', '12-21': 'winter' },
  '2022': { '02-01': 'spring', '02-15': 'lantern', '04-05': 'qingming', '06-03': 'dragon', '09-10': 'midautumn', '10-04': 'chongyang', '12-22': 'winter' },
  '2023': { '01-22': 'spring', '02-05': 'lantern', '04-05': 'qingming', '06-22': 'dragon', '09-29': 'midautumn', '10-23': 'chongyang', '12-22': 'winter' },
  '2024': { '02-10': 'spring', '02-24': 'lantern', '04-04': 'qingming', '06-10': 'dragon', '09-17': 'midautumn', '10-11': 'chongyang', '12-21': 'winter' },
  '2025': { '01-29': 'spring', '02-12': 'lantern', '04-04': 'qingming', '05-31': 'dragon', '10-06': 'midautumn', '10-29': 'chongyang', '12-21': 'winter' },
  '2026': { '02-17': 'spring', '03-03': 'lantern', '04-05': 'qingming', '06-19': 'dragon', '09-25': 'midautumn', '10-18': 'chongyang', '12-22': 'winter' },
  '2027': { '02-06': 'spring', '02-20': 'lantern', '04-05': 'qingming', '06-09': 'dragon', '09-15': 'midautumn', '10-08': 'chongyang', '12-22': 'winter' },
  '2028': { '01-26': 'spring', '02-09': 'lantern', '04-04': 'qingming', '05-28': 'dragon', '10-03': 'midautumn', '10-26': 'chongyang', '12-21': 'winter' },
  '2029': { '02-13': 'spring', '02-27': 'lantern', '04-04': 'qingming', '06-16': 'dragon', '09-22': 'midautumn', '10-16': 'chongyang', '12-21': 'winter' },
  '2030': { '02-03': 'spring', '02-17': 'lantern', '04-05': 'qingming', '06-05': 'dragon', '09-12': 'midautumn', '10-05': 'chongyang', '12-22': 'winter' },
  '2031': { '01-23': 'spring', '02-06': 'lantern', '04-05': 'qingming', '06-24': 'dragon', '10-01': 'midautumn', '10-24': 'chongyang', '12-22': 'winter' },
  '2032': { '02-11': 'spring', '02-25': 'lantern', '04-04': 'qingming', '06-12': 'dragon', '09-19': 'midautumn', '10-12': 'chongyang', '12-21': 'winter' },
  '2033': { '01-31': 'spring', '02-14': 'lantern', '04-04': 'qingming', '06-01': 'dragon', '09-08': 'midautumn', '10-01': 'chongyang', '12-21': 'winter' },
  '2034': { '02-19': 'spring', '03-05': 'lantern', '04-05': 'qingming', '06-20': 'dragon', '09-27': 'midautumn', '10-20': 'chongyang', '12-22': 'winter' },
  '2035': { '02-08': 'spring', '02-22': 'lantern', '04-05': 'qingming', '06-10': 'dragon', '09-16': 'midautumn', '10-09': 'chongyang', '12-22': 'winter' },
  '2036': { '01-28': 'spring', '02-11': 'lantern', '04-04': 'qingming', '05-30': 'dragon', '10-04': 'midautumn', '10-27': 'chongyang', '12-21': 'winter' },
  '2037': { '02-15': 'spring', '03-01': 'lantern', '04-04': 'qingming', '06-18': 'dragon', '09-24': 'midautumn', '10-17': 'chongyang', '12-21': 'winter' },
  '2038': { '02-04': 'spring', '02-18': 'lantern', '04-05': 'qingming', '06-07': 'dragon', '09-13': 'midautumn', '10-07': 'chongyang', '12-22': 'winter' },
  '2039': { '01-24': 'spring', '02-07': 'lantern', '04-05': 'qingming', '05-27': 'dragon', '10-02': 'midautumn', '10-26': 'chongyang', '12-22': 'winter' },
  '2040': { '02-12': 'spring', '02-26': 'lantern', '04-04': 'qingming', '06-14': 'dragon', '09-20': 'midautumn', '10-14': 'chongyang', '12-21': 'winter' },
  '2041': { '02-01': 'spring', '02-15': 'lantern', '04-04': 'qingming', '06-03': 'dragon', '09-10': 'midautumn', '10-03': 'chongyang', '12-21': 'winter' },
  '2042': { '01-22': 'spring', '02-05': 'lantern', '04-04': 'qingming', '06-22': 'dragon', '09-28': 'midautumn', '10-22': 'chongyang', '12-22': 'winter' },
  '2043': { '02-10': 'spring', '02-24': 'lantern', '04-05': 'qingming', '06-11': 'dragon', '09-17': 'midautumn', '10-11': 'chongyang', '12-22': 'winter' },
  '2044': { '01-30': 'spring', '02-13': 'lantern', '04-04': 'qingming', '05-31': 'dragon', '10-05': 'midautumn', '10-29': 'chongyang', '12-21': 'winter' },
  '2045': { '02-17': 'spring', '03-03': 'lantern', '04-04': 'qingming', '06-19': 'dragon', '09-25': 'midautumn', '10-18': 'chongyang', '12-21': 'winter' },
  '2046': { '02-06': 'spring', '02-20': 'lantern', '04-04': 'qingming', '06-08': 'dragon', '09-15': 'midautumn', '10-08': 'chongyang', '12-22': 'winter' },
  '2047': { '01-26': 'spring', '02-09': 'lantern', '04-05': 'qingming', '05-29': 'dragon', '10-04': 'midautumn', '10-27': 'chongyang', '12-22': 'winter' },
  '2048': { '02-14': 'spring', '02-28': 'lantern', '04-04': 'qingming', '06-15': 'dragon', '09-22': 'midautumn', '10-16': 'chongyang', '12-21': 'winter' },
  '2049': { '02-02': 'spring', '02-16': 'lantern', '04-04': 'qingming', '06-04': 'dragon', '09-11': 'midautumn', '10-05': 'chongyang', '12-21': 'winter' },
  '2050': { '01-23': 'spring', '02-06': 'lantern', '04-04': 'qingming', '06-23': 'dragon', '09-30': 'midautumn', '10-24': 'chongyang', '12-22': 'winter' },
})

function pick(key, name, accentColor, message, decor) {
  return { key, name, accentColor, message, decor }
}

function lunarKeyForDate(full) {
  const row = LUNAR_FESTIVAL_DATES[Number(full.slice(0, 4))]
  return row ? row[full.slice(5)] || '' : ''
}

// 判断某天的氛围：优先个人节点（生日/纪念日/使用周年），其次公历节日，最后农历/节气节日。
export function festiveFor(date, config) {
  const cfg = normalizeFestiveConfig(config)
  if (!cfg.enabled) return null
  const full = fullDateOf(date)
  if (!full) return null
  const md = full.slice(5)
  const year = Number(full.slice(0, 4))

  if (cfg.birthday && sameMonthDay(cfg.birthday, md, year)) {
    return pick('birthday', '我的生日', '#ec4899', '生日快乐！愿新一岁闪闪发光。', 'confetti')
  }
  for (const item of cfg.anniversaries) {
    if (sameMonthDay(item.date, md, year)) {
      return pick('anniversary', item.label, '#8b5cf6', `${item.label}快乐，一起记住今天。`, 'confetti')
    }
  }
  // 农历纪念日（新键 sl_festive_lunar）：与上面的公历纪念日同属"个人节点"这一层，
  // 因此排在生日/纪念日之后、使用周年与内置节日之前。数据不在 sl_festive_config 里，
  // cfg（归一化结果）看不到它 —— 这里读的是 lunarAnniversaries.js 的内存镜像
  // （首次读取从同一个 localStorage 键补水），所以 App.vue 那次
  // `festiveFor(todayISO, festiveConfig)` 的 computed 不改一行也能拿到最新列表。
  // 纯加法：既有键的读取路径一个字未动，未配置农历纪念日时行为与改动前完全一致。
  const lunarAnniversary = findLunarAnniversaryForDate(full, config)
  if (lunarAnniversary) {
    const view = LUNAR_ANNIVERSARY_PRESENTATION
    return pick(view.key, lunarAnniversary.label, view.accentColor, view.message(lunarAnniversary.label), view.decor)
  }
  if (cfg.installDate && sameMonthDay(cfg.installDate.slice(5), md, year)) {
    const elapsed = year - Number(cfg.installDate.slice(0, 4))
    if (elapsed >= 1) {
      const message = elapsed === 1
        ? '与你初见满一年啦，谢谢一路陪伴。'
        : `已经一起走过 ${elapsed} 年，感谢始终相伴。`
      return pick('anniversary-start', '使用周年', '#4f46e5', message, 'confetti')
    }
  }

  const solar = SOLAR_FIXED[md]
  if (solar) return pick(solar.key, solar.name, solar.accentColor, solar.message, solar.decor)

  const lunarKey = lunarKeyForDate(full)
  const lunar = lunarKey ? LUNAR_DEFS[lunarKey] : null
  if (lunar) return pick(lunar.key, lunar.name, lunar.accentColor, lunar.message, lunar.decor)

  return null
}

// 兼容旧调用方（async 签名）；内部已改为静态表同步计算。
export async function festiveForAsync(date, config) {
  return festiveFor(date, config)
}

// 往根节点写入氛围相关 CSS 变量；传 null 时清空，供 App.vue 统一调用。
//
// 只写 `--atmosphere-accent`：它被 style.css 装饰层的 `box-shadow` 读走。
// 以前这里还写过一个 `--atmosphere-decor`，但全仓**没有任何**地方读它
// （CSS 里没有 `var(--atmosphere-decor)`，测试里也不提），是纯死令牌，已删；
// 节日装饰的呈现走渲染层自己的分支，不经过这个变量。
export function applyAtmosphere(overlay) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!overlay) {
    root.style.removeProperty('--atmosphere-accent')
    return
  }
  root.style.setProperty('--atmosphere-accent', overlay.accentColor || '')
}

// 供「节日与纪念日设置」面板展示的内置节日对照表（只读、同步计算）。
// 默认展示当前年前后各六年；超出静态表覆盖范围的行返回空 cells，界面显示占位。
//
// anchorYear 不再用默认参数直接取系统时钟：调用方传的是**应用时区**的年份，
// 而 Number('') === 0 会让年份退化成 -6..6 得到一张全空表，NaN 同理。
export function builtInFestivalTable(anchorYear) {
  const numeric = Number(anchorYear)
  const anchor = Number.isFinite(numeric) && numeric > 1900 && numeric < 3000
    ? Math.trunc(numeric)
    : new Date().getFullYear()
  const solarRows = Object.entries(SOLAR_FIXED).map(([date, def]) => ({ date, name: def.name }))
  const lunarFestivals = Object.entries(LUNAR_DEFS).map(([key, def]) => ({ key, name: def.name }))
  const years = Array.from({ length: 13 }, (_, index) => anchor - 6 + index)
  const lunar = years.map((year) => {
    const row = LUNAR_FESTIVAL_DATES[year] || {}
    const cells = {}
    for (const [monthDay, key] of Object.entries(row)) cells[key] = monthDay
    return { year, cells }
  })
  return { solar: solarRows, lunarFestivals, lunar }
}
