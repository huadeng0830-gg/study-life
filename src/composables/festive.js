// 氛围与节日引擎（模块 A）：纯函数判断某天命中哪个节日、生日或纪念日，
// 产出 key / name / 主题色 / 祝福语 / 装饰类型（snow|confetti|lantern|null）。
// 本文件不读写任何存储，供单测直接调用；存储与坏数据修复见 atmosphereStore.js。

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

// 农历/节气节日的公历日期表（2026–2030）。查不到年份就跳过，不猜不编。
export const LUNAR_DEFS = {
  spring: { key: 'spring', name: '春节', accentColor: '#e23b3b', message: '新春大吉，阖家团圆。', decor: 'lantern' },
  lantern: { key: 'lantern', name: '元宵节', accentColor: '#f59e0b', message: '元宵快乐，团团圆圆。', decor: 'lantern' },
  qingming: { key: 'qingming', name: '清明节', accentColor: '#10b981', message: '清明时节，追忆与珍惜。', decor: null },
  dragon: { key: 'dragon', name: '端午节', accentColor: '#0ea271', message: '端午安康，粽叶飘香。', decor: null },
  midautumn: { key: 'midautumn', name: '中秋节', accentColor: '#f97316', message: '中秋快乐，月圆人团圆。', decor: null },
  chongyang: { key: 'chongyang', name: '重阳节', accentColor: '#d97706', message: '重阳登高，思念绵长。', decor: null },
  winter: { key: 'winter', name: '冬至', accentColor: '#64748b', message: '冬至安好，记得吃顿热乎的。', decor: null },
}

export const LUNAR_DATE_TABLE = {
  2026: { '02-17': 'spring', '03-03': 'lantern', '04-05': 'qingming', '06-19': 'dragon', '09-25': 'midautumn', '10-18': 'chongyang', '12-22': 'winter' },
  2027: { '02-06': 'spring', '02-20': 'lantern', '04-05': 'qingming', '06-09': 'dragon', '09-15': 'midautumn', '10-08': 'chongyang', '12-22': 'winter' },
  2028: { '01-26': 'spring', '02-09': 'lantern', '04-04': 'qingming', '05-28': 'dragon', '10-03': 'midautumn', '10-26': 'chongyang', '12-21': 'winter' },
  2029: { '02-13': 'spring', '02-27': 'lantern', '04-04': 'qingming', '06-16': 'dragon', '09-22': 'midautumn', '10-16': 'chongyang', '12-21': 'winter' },
  2030: { '02-03': 'spring', '02-17': 'lantern', '04-05': 'qingming', '06-05': 'dragon', '09-12': 'midautumn', '10-05': 'chongyang', '12-22': 'winter' },
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

  const lunar = LUNAR_DATE_TABLE[year]?.[md]
  const lunarDef = lunar ? LUNAR_DEFS[lunar] : null
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
// 结构与内置常量一一对应：固定公历节日按月-日升序；农历节日按 LUNAR_DEFS 顺序给列，
// 每个年份把 date→key 反查成 key→date，方便表格按列渲染。
export function builtInFestivalTable() {
  const solar = Object.entries(SOLAR_FIXED).map(([date, def]) => ({ date, name: def.name }))
  const lunarFestivals = Object.entries(LUNAR_DEFS).map(([key, def]) => ({ key, name: def.name }))
  const years = Object.keys(LUNAR_DATE_TABLE).map(Number).sort((a, b) => a - b)
  const keys = lunarFestivals.map((item) => item.key)
  const lunar = years.map((year) => {
    const byDate = LUNAR_DATE_TABLE[year] || {}
    const cells = {}
    for (const key of keys) {
      cells[key] = Object.keys(byDate).find((date) => byDate[date] === key) ?? ''
    }
    return { year, cells }
  })
  return { solar, lunarFestivals, lunar }
}