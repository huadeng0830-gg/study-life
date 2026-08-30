// 氛围与节日引擎（模块 A）：纯函数判断某天命中哪个节日、生日或纪念日，
// 产出 key / name / 主题色 / 祝福语 / 装饰类型（snow|confetti|lantern|null）。
// 本文件不读写任何存储，供单测直接调用；存储与坏数据修复见 atmosphereStore.js。
// 农历和节气由 lunar-javascript 计算，不能再维护容易过期的手填日期表。
import { Solar } from 'lunar-javascript'

const pad2 = (value) => String(value).padStart(2, '0')

function toDate(value) {
  if (value instanceof Date) return value
  const date = new Date(`${String(value ?? '')}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function monthDayOf(value) {
  const date = toDate(value)
  if (!date) return ''
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function fullDateOf(value) {
  const date = toDate(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const FULL_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

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
  out.birthday = MONTH_DAY_RE.test(String(config.birthday ?? '')) ? String(config.birthday) : ''
  out.installDate = FULL_DATE_RE.test(String(config.installDate ?? '')) ? String(config.installDate) : ''
  const rawAnniversaries = Array.isArray(config.anniversaries) ? config.anniversaries : []
  out.anniversaries = rawAnniversaries
    .filter((item) => item && MONTH_DAY_RE.test(String(item.date ?? '')))
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

// 农历/节气节日定义。日期在运行时由历法库计算，而不是维护静态映射。
export const LUNAR_DEFS = {
  spring: { key: 'spring', name: '春节', accentColor: '#e23b3b', message: '新春大吉，阖家团圆。', decor: 'lantern' },
  lantern: { key: 'lantern', name: '元宵节', accentColor: '#f59e0b', message: '元宵快乐，团团圆圆。', decor: 'lantern' },
  qingming: { key: 'qingming', name: '清明节', accentColor: '#10b981', message: '清明时节，追忆与珍惜。', decor: null },
  dragon: { key: 'dragon', name: '端午节', accentColor: '#0ea271', message: '端午安康，粽叶飘香。', decor: null },
  midautumn: { key: 'midautumn', name: '中秋节', accentColor: '#f97316', message: '中秋快乐，月圆人团圆。', decor: null },
  chongyang: { key: 'chongyang', name: '重阳节', accentColor: '#d97706', message: '重阳登高，思念绵长。', decor: null },
  winter: { key: 'winter', name: '冬至', accentColor: '#64748b', message: '冬至安好，记得吃顿热乎的。', decor: null },
}

function lunarFestivalKey(date) {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate())
  const lunar = solar.getLunar()
  if (lunar.getMonth() === 1 && lunar.getDay() === 1) return 'spring'
  if (lunar.getMonth() === 1 && lunar.getDay() === 15) return 'lantern'
  if (lunar.getMonth() === 5 && lunar.getDay() === 5) return 'dragon'
  if (lunar.getMonth() === 8 && lunar.getDay() === 15) return 'midautumn'
  if (lunar.getMonth() === 9 && lunar.getDay() === 9) return 'chongyang'
  if (lunar.getJieQi() === '清明') return 'qingming'
  if (lunar.getJieQi() === '冬至') return 'winter'
  return ''
}

function pick(key, name, accentColor, message, decor) {
  return { key, name, accentColor, message, decor }
}

// 命中优先级：生日 > 纪念日 > 使用周年 > 公历节日 > 农历节日（个人节点优先）。
export function festiveFor(date, config) {
  const cfg = normalizeFestiveConfig(config)
  if (!cfg.enabled) return null
  const full = fullDateOf(date)
  if (!full) return null
  const md = full.slice(5)
  const year = Number(full.slice(0, 4))

  if (cfg.birthday && cfg.birthday === md) {
    return pick('birthday', '我的生日', '#ec4899', '生日快乐！愿新一岁闪闪发光。', 'confetti')
  }
  for (const item of cfg.anniversaries) {
    if (item.date === md) {
      return pick('anniversary', item.label, '#8b5cf6', `${item.label}快乐，一起记住今天。`, 'confetti')
    }
  }
  if (cfg.installDate && cfg.installDate.slice(5) === md) {
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

  const lunarKey = lunarFestivalKey(new Date(`${full}T00:00:00`))
  const lunarDef = lunarKey ? LUNAR_DEFS[lunarKey] : null
  if (lunarDef) return pick(lunarDef.key, lunarDef.name, lunarDef.accentColor, lunarDef.message, lunarDef.decor)

  return null
}

// 往根节点写入氛围相关 CSS 变量；传 null 时清空，供 App.vue 统一调用。
export function applyAtmosphere(overlay) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!overlay) {
    root.style.removeProperty('--atmosphere-accent')
    root.style.removeProperty('--atmosphere-decor')
    return
  }
  root.style.setProperty('--atmosphere-accent', overlay.accentColor || '')
  root.style.setProperty('--atmosphere-decor', overlay.decor || 'none')
}

// 供「节日与纪念日设置」面板展示的内置节日对照表（只读）。
// 为可核对性默认展示当前年前后各六年；表中每一格都由同一历法计算器生成。
export function builtInFestivalTable(anchorYear = new Date().getFullYear()) {
  const solar = Object.entries(SOLAR_FIXED).map(([date, def]) => ({ date, name: def.name }))
  const lunarFestivals = Object.entries(LUNAR_DEFS).map(([key, def]) => ({ key, name: def.name }))
  const years = Array.from({ length: 13 }, (_, index) => anchorYear - 6 + index)
  const keys = lunarFestivals.map((item) => item.key)
  const lunar = years.map((year) => {
    const cells = {}
    for (let month = 0; month < 12; month++) {
      const days = new Date(year, month + 1, 0).getDate()
      for (let day = 1; day <= days; day++) {
        const date = new Date(year, month, day)
        const key = lunarFestivalKey(date)
        if (keys.includes(key)) cells[key] = `${pad2(month + 1)}-${pad2(day)}`
      }
    }
    return { year, cells }
  })
  return { solar, lunarFestivals, lunar }
}
