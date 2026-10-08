// 农历纪念日（新键 `sl_festive_lunar`）：纯逻辑 + 内存镜像。
//
// 【为什么是独立文件】农历纪念日的数据放在**新键** `sl_festive_lunar` 里，与既有的
// `sl_festive_config`（公历月-日纪念日 / 生日 / 安装日）完全分开 —— 既有键的形状与语义
// 一个字都没有改。本文件只读写该键；本地备份与账号同步的数据登记仍由各自模块负责。
//
// 【绝不静默回退】农历月日可能"今年不存在"：小月没有三十；用户勾了闰月但该年没有这个闰月；
// 公历年超出农历表覆盖范围（1900–2101）。这些情况一律给出**明确状态 + 可显示文案**，
// 绝不退化成平月、也不猜一个邻近日期。这份能力来自 ./lunar.js 的 null 语义
// （1900–2100 位压缩表，福建/香港天文台口径一致，闰月是真实存在的独立月份）。
//
// 【内存镜像】`festive.js` 的氛围判断在**不引入存储层**的前提下要能读到农历纪念日：
// 这里维护一个 Vue ref 镜像，首次读取时从 localStorage 的 `sl_festive_lunar` 补水，
// 设置面板写入后调用 `publishLunarAnniversaries()` 同步镜像。这样 App.vue 的 computed
// （`festiveFor(todayISO, festiveConfig)`) 里那次读取会建立依赖，面板一改氛围立刻跟上；
// 而不需要改动 App.vue / atmosphereStore.js。
import { ref } from 'vue'
import {
  GREGORIAN_SUPPORT_RANGE,
  isLunarYearSupported,
  lunarLeapMonth,
  lunarLeapMonthDays,
  lunarMonthDayOccurrences,
  lunarMonthDays,
} from './lunar.js'

/** 农历纪念日的存储键（新键；既有 sl_* 键语义不变）。 */
export const LUNAR_ANNIVERSARY_KEY = 'sl_festive_lunar'

/** 解析状态。前四个是产品要求的状态，后两个是防御性/年界补充，都在 UI 里有明确文案。 */
export const LUNAR_ANNIVERSARY_STATUS = Object.freeze({
  OK: 'ok',
  OUT_OF_RANGE: 'out-of-range',
  NO_SUCH_DAY: 'no-such-day',
  NO_SUCH_LEAP_MONTH: 'no-such-leap-month',
  NOT_IN_YEAR: 'not-in-year',
  INVALID: 'invalid',
})

/**
 * 不可用状态的可显示文案。
 *
 * 支持区间按**公历年**口径写：1900–2101（农历表覆盖农历 1900–2100 年，
 * 对应公历 1900-01-31 ~ 2101-01-28）。
 */
export const LUNAR_ANNIVERSARY_STATUS_TEXT = Object.freeze({
  [LUNAR_ANNIVERSARY_STATUS.OK]: '',
  [LUNAR_ANNIVERSARY_STATUS.OUT_OF_RANGE]: '超出农历支持范围（1900–2101）',
  [LUNAR_ANNIVERSARY_STATUS.NO_SUCH_DAY]: '该农历年这个月是小月，没有三十',
  [LUNAR_ANNIVERSARY_STATUS.NO_SUCH_LEAP_MONTH]: '该年没有这个闰月',
  [LUNAR_ANNIVERSARY_STATUS.NOT_IN_YEAR]: '本公历年内没有这个农历日（冬月/腊月可能落在次年 1 月）',
  [LUNAR_ANNIVERSARY_STATUS.INVALID]: '农历月日不合法（月 1–12、日 1–30）',
})

/** 面板上的说明文案（集中一处，UI 与测试读同一份，避免文案漂移）。 */
export const LUNAR_ANNIVERSARY_HINT = Object.freeze({
  section: '按农历月日每年重复，与公历纪念日互不影响',
  support: '农历表覆盖 1900–2101；闰月按「闰月」勾选处理，勾了却不存在时会明确提示，不会按平月计算；小月没有三十。',
})

/** 农历月份名（1–12）。 */
export const LUNAR_MONTH_NAMES = Object.freeze(['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'])

const LUNAR_DAY_DIGITS = Object.freeze(['十', '一', '二', '三', '四', '五', '六', '七', '八', '九'])

/** 农历月份下拉选项。 */
export const LUNAR_MONTH_OPTIONS = Object.freeze(
  LUNAR_MONTH_NAMES.map((label, index) => ({ value: index + 1, label })),
)

/** 农历日期名：初一…初十、十一…十九、二十、廿一…廿九、三十。 */
export function lunarDayName(day) {
  const value = Number(day)
  if (!Number.isInteger(value) || value < 1 || value > 30) return ''
  // 十整与两个整十数单独给名：初十 / 二十 / 三十（不能落到下面的拼字规则里，
  // 否则 10 会拼成「十十」）。
  if (value === 10) return '初十'
  if (value === 20) return '二十'
  if (value === 30) return '三十'
  const ones = value % 10
  if (value < 10) return `初${LUNAR_DAY_DIGITS[ones]}`
  if (value < 20) return `十${LUNAR_DAY_DIGITS[ones]}`
  return `廿${LUNAR_DAY_DIGITS[ones]}`
}

/** 农历日期下拉选项。 */
export const LUNAR_DAY_OPTIONS = Object.freeze(
  Array.from({ length: 30 }, (_, index) => ({ value: index + 1, label: lunarDayName(index + 1) })),
)

/** 农历月日的可读写法，如「闰四月初八」「腊月三十」。 */
export function formatLunarDate(lunarMonth, lunarDay, isLeapMonth = false) {
  const monthName = LUNAR_MONTH_NAMES[Number(lunarMonth) - 1]
  const dayName = lunarDayName(lunarDay)
  if (!monthName || !dayName) return ''
  return `${isLeapMonth === true ? '闰' : ''}${monthName}${dayName}`
}

/**
 * 氛围层呈现：**复用既有纪念日的 key 与装饰令牌**，不新增动效令牌。
 *
 * 为什么 key 直接用 `'anniversary'` 而不是另起 `'lunar-anniversary'`：
 * `App.vue` 里的 `ANNIVERSARY_KEYS = ['anniversary', 'anniversary-start']` 决定了两件事 ——
 * 金色专属粒子配色 + 4.2s 时长（`decorStyle`）和 `.atmo-halo` 光环是否渲染；`style.css`
 * 用 `[data-festive='<key>']` **精确匹配**写规则。这两处都不在本次允许改动的文件里
 * （App.vue / style.css），换成一个新 key 就会让农历纪念日**静默退回彩带**（没有金色、
 * 没有光环），正是仓库那条跨文件契约测试专门防范的失败模式。
 * 复用既有 key 之后，农历纪念日与公历纪念日、使用周年拿到完全相同的呈现，
 * `narrative.js` 的 `NARRATIVE_DYNAMIC_KEYS`（动态文案不翻译）也自动适用。
 * 用户看到的差异只来自 `message`：里面拼的是用户自己填的名称。
 */
export const LUNAR_ANNIVERSARY_PRESENTATION = Object.freeze({
  key: 'anniversary',
  accentColor: '#8b5cf6',
  decor: 'confetti',
  message: (label) => `${label}快乐，一起记住今天。`,
})

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 把 Date / 'YYYY-MM-DD' 归一成公历日期串；无法识别返回 ''。 */
export function toDateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  const text = String(value ?? '').trim()
  return DATE_KEY_RE.test(text) ? text : ''
}

function gregorianYearOf(dateKey) {
  return Number(dateKey.slice(0, 4))
}

function dayNumber(dateKey) {
  return Date.UTC(Number(dateKey.slice(0, 4)), Number(dateKey.slice(5, 7)) - 1, Number(dateKey.slice(8, 10))) / 86400000
}

/** 农历月日是否合法（月 1–12、日 1–30）。 */
export function isValidLunarMonthDay(lunarMonth, lunarDay) {
  return (
    Number.isInteger(lunarMonth) &&
    lunarMonth >= 1 &&
    lunarMonth <= 12 &&
    Number.isInteger(lunarDay) &&
    lunarDay >= 1 &&
    lunarDay <= 30
  )
}

/**
 * 形状纠偏（**不要求标签**）：解析路径用。
 * 面板里刚新建、还没起名的行也要能算出落点，所以"标签为空"不能算错；
 * "标签为空的条目不写入存储"是持久化层（normalizeLunarAnniversary）的口径。
 */
export function coerceLunarAnniversary(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const lunarMonth = Number(item.lunarMonth)
  const lunarDay = Number(item.lunarDay)
  if (!isValidLunarMonthDay(lunarMonth, lunarDay)) return null
  const isLeapMonth = item.isLeapMonth === true
  const label = String(item.label ?? '').trim()
  const id = String(item.id ?? '').trim() || `lunar-${lunarMonth}-${lunarDay}-${isLeapMonth ? 'L' : 'S'}`
  return { id, label, lunarMonth, lunarDay, isLeapMonth }
}

/** 单条农历纪念日的坏数据修复：标签为空、月日越界的丢弃（与既有纪念日同口径）。 */
export function normalizeLunarAnniversary(item) {
  const coerced = coerceLunarAnniversary(item)
  return coerced && coerced.label ? coerced : null
}

/** 整表归一化（新键 `sl_festive_lunar` 的形状就是这个数组）。 */
export function normalizeLunarAnniversaries(list) {
  if (!Array.isArray(list)) return []
  return list.map((item) => normalizeLunarAnniversary(item)).filter(Boolean)
}

/**
 * 解析一条农历纪念日在**目标公历年**里的落点。
 *
 * @param {{label?:string, lunarMonth:number, lunarDay:number, isLeapMonth?:boolean, id?:string}} entry
 * @param {string|Date} today 目标公历日期（通常用 appToday）
 * @returns {{
 *   id:string, label:string, lunarMonth:number, lunarDay:number, isLeapMonth:boolean,
 *   lunarText:string, status:string, statusText:string, year:number,
 *   dateKey:string, dateText:string, daysFromToday:number|null, relativeText:string,
 *   nextDateKey:string, nextText:string,
 * }}
 */
export function resolveLunarAnniversary(entry, today) {
  const label = String(entry?.label ?? '').trim()
  const lunarMonth = Number(entry?.lunarMonth)
  const lunarDay = Number(entry?.lunarDay)
  const isLeapMonth = entry?.isLeapMonth === true
  const todayKey = toDateKey(today)
  const fallbackYear = todayKey ? gregorianYearOf(todayKey) : 0
  // 解析只关心农历月日：**标签为空不算错误**（面板里刚新建、还没起名的行也要能显示落点）。
  // "标签为空的条目不写入存储"是持久化层的口径（normalizeLunarAnniversary），与本函数无关。
  if (!isValidLunarMonthDay(lunarMonth, lunarDay)) {
    return {
      id: '',
      label,
      lunarMonth: Number.isInteger(lunarMonth) ? lunarMonth : 0,
      lunarDay: Number.isInteger(lunarDay) ? lunarDay : 0,
      isLeapMonth,
      lunarText: '',
      status: LUNAR_ANNIVERSARY_STATUS.INVALID,
      statusText: LUNAR_ANNIVERSARY_STATUS_TEXT[LUNAR_ANNIVERSARY_STATUS.INVALID],
      year: fallbackYear,
      dateKey: '',
      dateText: '',
      daysFromToday: null,
      relativeText: '',
      nextDateKey: '',
      nextText: '',
    }
  }

  const id = String(entry?.id ?? '').trim() || `lunar-${lunarMonth}-${lunarDay}-${isLeapMonth ? 'L' : 'S'}`
  const lunarText = formatLunarDate(lunarMonth, lunarDay, isLeapMonth)
  const base = {
    id,
    label,
    lunarMonth,
    lunarDay,
    isLeapMonth,
    lunarText,
    year: fallbackYear,
    dateKey: '',
    dateText: '',
    daysFromToday: null,
    relativeText: '',
    nextDateKey: '',
    nextText: '',
  }
  if (!todayKey) {
    return { ...base, status: LUNAR_ANNIVERSARY_STATUS.INVALID, statusText: LUNAR_ANNIVERSARY_STATUS_TEXT[LUNAR_ANNIVERSARY_STATUS.INVALID] }
  }

  const year = gregorianYearOf(todayKey)
  const withYear = { ...base, year }
  const nextDateKey = nextOccurrenceKeyAfter(todayKey, lunarMonth, lunarDay, isLeapMonth)

  const decide = (status) => ({
    ...withYear,
    status,
    statusText: LUNAR_ANNIVERSARY_STATUS_TEXT[status],
    nextDateKey,
    nextText: nextDateKey ? `下一次 ${nextDateKey}` : '',
  })

  // 1) 公历年超出农历表覆盖的公历范围
  if (year < GREGORIAN_SUPPORT_RANGE.min || year > GREGORIAN_SUPPORT_RANGE.max) {
    return decide(LUNAR_ANNIVERSARY_STATUS.OUT_OF_RANGE)
  }

  // 2) 本公历年内真的有这一天吗（闰月语义由 lunar.js 保证：不存在就是 null）
  const occurrences = lunarMonthDayOccurrences(year, lunarMonth, lunarDay, isLeapMonth)
  if (occurrences.length > 0) {
    const hit = occurrences[0]
    const dateKey = `${hit.year}-${pad2(hit.month)}-${pad2(hit.day)}`
    const daysFromToday = dayNumber(dateKey) - dayNumber(todayKey)
    return {
      ...withYear,
      status: LUNAR_ANNIVERSARY_STATUS.OK,
      statusText: '',
      dateKey,
      dateText: dateKey,
      daysFromToday,
      relativeText: daysFromToday === 0 ? '就是今天' : daysFromToday > 0 ? `${daysFromToday} 天后` : `已过 ${-daysFromToday} 天`,
      nextDateKey,
      nextText: nextDateKey && nextDateKey !== dateKey ? `下一次 ${nextDateKey}` : '',
    }
  }

  // 3) 年内没有 → 判定原因。**归属农历年**取 G（公历 G 年的月日绝大多数落在农历 G 年），
  //    只有 G 超出表尾（2101 年的 1 月）时才归给 G-1。
  //    这样"为什么没有"才对得上用户看到的年：1902 年没有二月三十，原因是农历 1902 年二月是小月，
  //    而不是"落在次年 1 月"（后者只在冬月/腊月等年界月份成立）。
  const ownerYear = isLunarYearSupported(year) ? year : year - 1
  if (isLunarYearSupported(ownerYear)) {
    if (isLeapMonth && lunarLeapMonth(ownerYear) !== lunarMonth) {
      return decide(LUNAR_ANNIVERSARY_STATUS.NO_SUCH_LEAP_MONTH)
    }
    const length = isLeapMonth ? lunarLeapMonthDays(ownerYear) : lunarMonthDays(ownerYear, lunarMonth)
    if (lunarDay > length) return decide(LUNAR_ANNIVERSARY_STATUS.NO_SUCH_DAY)
  }

  // 日期本身存在，只是不落在本公历年内（年界：冬月/腊月可能落到次年 1 月）。
  return decide(LUNAR_ANNIVERSARY_STATUS.NOT_IN_YEAR)
}

/** 'YYYY-MM-DD' 补零。 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 从 today 起（含当天）向后找 20 个公历年内的下一次出现，只用于 UI 的「下一次」提示。
 *
 * 为什么不用 lunar.js 的 `nextLunarMonthDayOnOrAfter`：那个只向前找 5 年，
 * 而某个闰月可能 8~19 年才轮到一次，5 年内会找不到（提示就变成空）。
 * 这里不改变 lunar.js 的任何行为，只是把搜索窗口放长给面板用。
 */
function nextOccurrenceKeyAfter(todayKey, lunarMonth, lunarDay, isLeapMonth) {
  if (!todayKey) return ''
  const startYear = gregorianYearOf(todayKey)
  for (let year = startYear; year <= startYear + 20; year += 1) {
    for (const hit of lunarMonthDayOccurrences(year, lunarMonth, lunarDay, isLeapMonth)) {
      const key = `${hit.year}-${pad2(hit.month)}-${pad2(hit.day)}`
      // 同年月日格式等长，字符串比较即时间先后。
      if (key >= todayKey) return key
    }
  }
  return ''
}

/** 解析整个列表（`config` 可以是数组，也可以是带 `lunarAnniversaries` 字段的对象）。 */
export function resolveLunarAnniversaries(config, today) {
  return lunarListOf(config).map((entry) => resolveLunarAnniversary(entry, today))
}

/**
 * 从数组或 `{ lunarAnniversaries }` 里取出列表（只做形状纠偏，保留未命名条目）。
 * 解析用这个，不丢行；持久化归一化另用 normalizeLunarAnniversaries（会丢空标签）。
 */
export function lunarListOf(config) {
  if (Array.isArray(config)) return config.map(coerceLunarAnniversary).filter(Boolean)
  if (config && typeof config === 'object' && Array.isArray(config.lunarAnniversaries)) {
    return config.lunarAnniversaries.map(coerceLunarAnniversary).filter(Boolean)
  }
  return []
}

/* ---------- 内存镜像 + localStorage 补水（不 import 存储层，保持 festive.js 的依赖图干净） ---------- */

const lunarMirror = ref([])
let mirroredOnce = false
let mirroredRaw = null

function storageAvailable() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null
  } catch {
    return false
  }
}

/**
 * 让内存镜像**跟随存储**。
 *
 * 【为什么不是"只补水一次"】存储才是真源：账号同步应用、备份恢复、
 * 另一个标签页，都会**直接写 localStorage**而不经过本模块。本模块又**故意不 import
 * 存储层**（`festive.js` 依赖它，把 store 的事件循环带进来会让 node 环境的纯函数测试
 * 报废），所以拿不到 `storedRefs` 那套"恢复时同步更新响应式引用"的通知 ——
 * `restoreStoredValues()` 只更新注册过的 ref，模块自己的镜像不在其中。
 *
 * 于是判据只能是"每次读取都比对上次读到的原始串，变了就以存储为准重新补水"。
 * 少了这一步就会出现最难查的那种不一致：**设置面板显示新数据、首页仍按旧镜像点亮**
 * （看起来像恢复失败）。守卫见 `tests/lunarAnniversaryStorageSource.test.js`。
 */
function hydrateMirror() {
  if (!storageAvailable()) {
    mirroredOnce = true
    return
  }
  let raw = null
  try {
    raw = localStorage.getItem(LUNAR_ANNIVERSARY_KEY)
  } catch {
    raw = null
  }
  if (mirroredOnce && raw === mirroredRaw) return
  mirroredOnce = true
  mirroredRaw = raw
  try {
    lunarMirror.value = normalizeLunarAnniversaries(raw === null ? [] : JSON.parse(raw))
  } catch {
    lunarMirror.value = []
  }
}

/**
 * 读农历纪念日（归一化后的新数组）。
 *
 * 有 localStorage 时**每次读取都以存储为准**（见 `hydrateMirror` 的说明）；
 * 无 localStorage 的 node 环境下退化成"读内存镜像"，绝不抛异常 —— 让 festive.js 保持可单测。
 */
export function readLunarAnniversaries() {
  hydrateMirror()
  return normalizeLunarAnniversaries(lunarMirror.value)
}

/**
 * 发布农历纪念日到内存镜像（设置面板在写入 `sl_festive_lunar` 之后调用）。
 *
 * 只服务于两件事：面板刚写完想要**立即生效**的即时反馈，以及无 localStorage 的环境
 * （node 纯函数测试）里直接设定镜像。**浏览器里它压不过存储**：下一次读取只要发现
 * 存储原始串变了，就会以存储为准覆盖这里 —— 这是刻意的（外部写入必须被看见）。
 */
export function publishLunarAnniversaries(list) {
  lunarMirror.value = normalizeLunarAnniversaries(list)
}

/** 测试用：复位内存镜像状态（不影响 localStorage）。 */
export function resetLunarAnniversaryMirror() {
  mirroredOnce = false
  mirroredRaw = null
  lunarMirror.value = []
}

/** 今天命中的第一条农历纪念日（供 festive.js 的氛围判断使用）。 */
export function findLunarAnniversaryForDate(date, config) {
  const todayKey = toDateKey(date)
  if (!todayKey) return null
  const source = Array.isArray(config) || Array.isArray(config?.lunarAnniversaries)
    ? lunarListOf(config)
    : readLunarAnniversaries()
  for (const entry of source) {
    // 没名字就没法在首页显示祝福语（只剩"快乐"两个字），跳过；
    // 未命名条目依然能在设置面板里显示落点（那里直接调 resolveLunarAnniversary）。
    if (!entry.label) continue
    const resolved = resolveLunarAnniversary(entry, todayKey)
    if (resolved.status === LUNAR_ANNIVERSARY_STATUS.OK && resolved.dateKey === todayKey) return resolved
  }
  return null
}
