// 纪念日的「下一次落点」：把生日 / 公历纪念日 / 使用周年 / 农历纪念日四类节点
// 归一成同一套可显示文案，供设置面板的「即将到来」清单使用。
//
// 【补的是哪个缺口】氛围引擎 `festiveFor()` 只在**当天**返回一个装饰对象：不在今天，
// 它就是 null。面板里的农历行早就带一句「下一次 2027-06-02（135 天后）」，
// 而公历纪念日、使用周年、生日**一行提示都没有** —— 用户存了一条纪念日，
// 面板上只能看到自己填的日期，看不到它哪天回来、长什么样。
// 本模块让四类节点共用一套"下一次是哪天 / 还有几天"的算法。
//
// 【最要紧的一条纪律：日期规则不另起一份】`02-29` 在非闰年落到 `02-28` 这条规则由
// `festive.js` 的 `monthDayInYear()` 唯一定义，本模块只调用它、不复述它。
// 两边各写一份的后果是"面板说 2027-02-28、氛围却在 2027-03-01 才点亮"——
// 两处单看都"对"，测试也不会红，只有用户会发现倒计时和实际点亮对不上。
// tests/anniversarySchedule.test.js 里有一条直接拿引擎结果对账的用例钉住这一点。
//
// 【纯函数，不碰存储】生日 / 公历纪念日 / 使用周年都从 `config` 参数读；
// 农历纪念日由调用方传入列表（设置面板拿的是编辑器草稿行，比存储更新）。
// 本文件不 import 任何存储层，`festive.js` 的依赖图因此保持干净。

import { isRealMonthDay, monthDayInYear, normalizeFestiveConfig } from './festive.js'
import {
  LUNAR_ANNIVERSARY_STATUS,
  daysBetweenDateKeys,
  resolveLunarAnniversary,
  toDateKey,
} from './lunarAnniversaries.js'

/** 四类节点的来源，面板按它选文案与归属分组。 */
export const ANNIVERSARY_SOURCE = Object.freeze({
  BIRTHDAY: 'birthday',
  ANNIVERSARY: 'anniversary',
  INSTALL: 'install',
  LUNAR: 'lunar',
})

/** 排序用的固定次序：同一天命中多个节点时，顺序不会因为对象遍历而飘。 */
const SOURCE_ORDER = Object.freeze([
  ANNIVERSARY_SOURCE.BIRTHDAY,
  ANNIVERSARY_SOURCE.ANNIVERSARY,
  ANNIVERSARY_SOURCE.INSTALL,
  ANNIVERSARY_SOURCE.LUNAR,
])

/** 展示用兜底名。面板里刚新建、还没起名的行也要能在清单里看到，否则像是没加上。 */
const FALLBACK_LABEL = Object.freeze({
  [ANNIVERSARY_SOURCE.BIRTHDAY]: '我的生日',
  [ANNIVERSARY_SOURCE.ANNIVERSARY]: '未命名纪念日',
  [ANNIVERSARY_SOURCE.INSTALL]: '使用周年',
  [ANNIVERSARY_SOURCE.LUNAR]: '未命名农历纪念日',
})

/**
 * 从 `todayKey` 起（含当天）的下一个「月-日」落点；月日不合法返回 ''。
 *
 * 最多看两年，且两年一定够：本年的落点要么已过、要么就在今天或之后；
 * 若本年落点已过，下一年的同月日必然更晚。所以这个循环不是"先探个上限"，
 * 而是可以证明的上界。
 */
export function nextMonthDayOnOrAfter(todayKey, monthDay) {
  const from = toDateKey(todayKey)
  if (!from) return ''
  const startYear = Number(from.slice(0, 4))
  for (let year = startYear; year <= startYear + 1; year += 1) {
    const candidate = monthDayInYear(monthDay, year)
    if (candidate && candidate >= from) return candidate
  }
  return ''
}

/**
 * 使用周年日期的「月-日」部分；日期不存在或形状不对返回 ''。
 *
 * 判据是"它在自己年份里的落点必须等于它自己"：`2023-02-29` 在 2023 年的落点是
 * `2023-02-28`，两者不等 —— 于是这类不存在的日期被拒掉。这与 `festive.js` 里
 * `isRealFullDate` 的口径一致，但复用了同一套 `monthDayInYear`，不重写日期规则。
 */
function installMonthDayOf(installDate) {
  const text = String(installDate ?? '')
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!matched) return ''
  const year = Number(matched[1])
  const monthDay = `${matched[2]}-${matched[3]}`
  return monthDayInYear(monthDay, year) === text ? monthDay : ''
}

/**
 * 「下一次」展示文案。`daysFromToday` 恒 >= 0（nextDateKey 一定不早于今天），
 * 所以这里不出现"已过 N 天"——那是农历行里"本年落点已过"的另一种口径。
 */
function occurrenceOf({ id, source, label, recurrence, status, statusText, nextDateKey, todayKey }) {
  const daysFromToday = nextDateKey ? daysBetweenDateKeys(todayKey, nextDateKey) : null
  return {
    id,
    source,
    label,
    recurrence,
    status,
    statusText,
    nextDateKey,
    daysFromToday,
    isToday: daysFromToday === 0,
    relativeText: daysFromToday === null ? '' : daysFromToday === 0 ? '就是今天' : `还有 ${daysFromToday} 天`,
    nextText: nextDateKey ? `下一次 ${nextDateKey}` : '',
  }
}

/**
 * 单条公历纪念日（`sl_festive_config.anniversaries` 的一项）的下一次落点。
 *
 * @param {{date?:string, label?:string}} entry 存储里的形状只有 `{date, label}`
 * @param {string|Date} today
 * @returns {ReturnType<occurrenceOf>|null} 月日不合法时返回 null（不是一条"没有下一次"的行）
 */
export function resolveSolarAnniversary(entry, today) {
  const todayKey = toDateKey(today)
  const monthDay = String(entry?.date ?? '')
  if (!todayKey || !isRealMonthDay(monthDay)) return null
  const nextDateKey = nextMonthDayOnOrAfter(todayKey, monthDay)
  if (!nextDateKey) return null
  const label = String(entry?.label ?? '').trim()
  return occurrenceOf({
    id: `solar-${monthDay}-${label}`,
    source: ANNIVERSARY_SOURCE.ANNIVERSARY,
    label: label || FALLBACK_LABEL[ANNIVERSARY_SOURCE.ANNIVERSARY],
    recurrence: `每年 ${monthDay}`,
    status: 'ok',
    statusText: '',
    nextDateKey,
    todayKey,
  })
}

/** 生日的下一次落点。生日只存「月-日」，与既有键的语义一致。 */
export function resolveBirthday(monthDay, today) {
  const todayKey = toDateKey(today)
  if (!todayKey || !isRealMonthDay(monthDay)) return null
  const nextDateKey = nextMonthDayOnOrAfter(todayKey, monthDay)
  if (!nextDateKey) return null
  return occurrenceOf({
    id: `birthday-${monthDay}`,
    source: ANNIVERSARY_SOURCE.BIRTHDAY,
    label: FALLBACK_LABEL[ANNIVERSARY_SOURCE.BIRTHDAY],
    recurrence: `每年 ${monthDay}`,
    status: 'ok',
    statusText: '',
    nextDateKey,
    todayKey,
  })
}

/**
 * 使用周年（`sl_festive_config.installDate`）的下一次落点。
 *
 * 口径与引擎一致：满一年才算周年（`festive.js` 里 `elapsed >= 1` 才点亮），
 * 所以候选年份从 `max(今年, 安装年+1)` 起。安装日期在未来时同理 —— 满一年之前没有周年。
 */
export function resolveInstallAnniversary(installDate, today) {
  const todayKey = toDateKey(today)
  const monthDay = installMonthDayOf(installDate)
  if (!todayKey || !monthDay) return null
  const installYear = Number(String(installDate).slice(0, 4))
  const startYear = Math.max(Number(todayKey.slice(0, 4)), installYear + 1)
  let nextDateKey = ''
  for (let year = startYear; year <= startYear + 1; year += 1) {
    const candidate = monthDayInYear(monthDay, year)
    if (candidate >= todayKey) { nextDateKey = candidate; break }
  }
  if (!nextDateKey) return null
  return occurrenceOf({
    id: `install-${monthDay}`,
    source: ANNIVERSARY_SOURCE.INSTALL,
    label: FALLBACK_LABEL[ANNIVERSARY_SOURCE.INSTALL],
    recurrence: `每年 ${monthDay}`,
    status: 'ok',
    statusText: '',
    nextDateKey,
    todayKey,
  })
}

/**
 * 一条农历纪念日的下一次落点。
 *
 * 直接复用 `resolveLunarAnniversary` 的 `nextDateKey`，它会搜索完整的农历支持区间，
 * 不必为面板再维护一套日期搜索。
 * 解析状态原样带出：今年没有这个闰月 / 是小月没有三十的条目，**不隐藏**，
 * 面板上要看得见那条提示，清单里也看得见。
 */
export function resolveLunarOccurrence(entry, today) {
  const todayKey = toDateKey(today)
  if (!todayKey) return null
  const resolved = resolveLunarAnniversary(entry, todayKey)
  if (resolved.status === LUNAR_ANNIVERSARY_STATUS.INVALID) return null
  // 农历表里根本没有的日子（例如已超出 2101）没有"下一次"。这不是"没有下一次发生"，
  // 而是"这一天在可支持的区间里不存在" —— 那属于各行自己的失效提示，不进清单。
  if (!resolved.nextDateKey) return null
  const label = String(resolved.label ?? '').trim()
  return occurrenceOf({
    id: `lunar-${resolved.id}`,
    source: ANNIVERSARY_SOURCE.LUNAR,
    label: label || resolved.lunarText || FALLBACK_LABEL[ANNIVERSARY_SOURCE.LUNAR],
    recurrence: resolved.lunarText ? `每年农历${resolved.lunarText}` : '',
    status: resolved.status,
    statusText: resolved.statusText,
    nextDateKey: resolved.nextDateKey,
    todayKey,
  })
}

/**
 * 「即将到来」清单：四类节点里所有还能找到下一次落点的条目，按时间升序。
 *
 * 不受 `config.enabled` 影响：那是"要不要点亮氛围"的开关，而这里回答的是
 * "我登记的这些日子什么时候回来"。用户在面板里看自己的清单，不该因为关掉了
 * 装饰就变成空白 —— 否则会以为数据丢了。
 *
 * 找不到下一次落点的条目**不进清单**（它们连日期都不成立，显示出来只是噪声）；
 * 但它们的失效状态仍然由各自那一行自己显示（农历行有 `lunar-resolve`）。
 *
 * @param {object} config `sl_festive_config`（内部先过 normalizeFestiveConfig）
 * @param {Array} lunarEntries 农历纪念日列表；传 null/undefined 时视为空数组
 * @param {string|Date} today
 * @param {{limit?: number}} [options] limit 为正整数时只保留最近 N 条
 */
export function upcomingAnniversaries(config, lunarEntries, today, options = {}) {
  const cfg = normalizeFestiveConfig(config)
  const todayKey = toDateKey(today)
  if (!todayKey) return []

  const rows = []
  const birthday = resolveBirthday(cfg.birthday, todayKey)
  if (birthday) rows.push(birthday)

  cfg.anniversaries.forEach((entry, index) => {
    const row = resolveSolarAnniversary(entry, todayKey)
    // 同月日同日但标签不同的两条是用户真实存在的两个节点，都要列出来；
    // 重复的（normalize 之后不会有，这里只是防御）按 id 去重。
    if (row) rows.push({ ...row, id: `${row.id}-${index}` })
  })

  const install = resolveInstallAnniversary(cfg.installDate, todayKey)
  if (install) rows.push(install)

  for (const entry of (Array.isArray(lunarEntries) ? lunarEntries : [])) {
    const row = resolveLunarOccurrence(entry, todayKey)
    if (row) rows.push(row)
  }

  const seen = new Set()
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })

  unique.sort((a, b) => {
    if (a.nextDateKey !== b.nextDateKey) return a.nextDateKey < b.nextDateKey ? -1 : 1
    const diff = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const limit = Number(options.limit)
  return Number.isInteger(limit) && limit > 0 ? unique.slice(0, limit) : unique
}
