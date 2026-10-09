/**
 * 时区换算原语（浏览器与 Edge Function 共用）。
 *
 * 【为什么放在 src/composables 而不是各自一份】
 * 这几个函数此前住在 `supabase/functions/campus-social/availability.js`，而前端 4 个文件
 * 从**函数目录**里 import 它们（`../../supabase/functions/…`）。依赖方向是反的：源码目录
 * 依赖部署产物目录。它能工作是因为该文件只用了标准 `Intl`、没有 Deno 专属全局，但代价是
 *   - 改函数目录里的任何东西都会牵动前端构建；
 *   - 删/挪那个函数目录会连带打断前端；
 *   - 读前端代码的人得一路跳进 functions/ 才能知道用了什么。
 * 边界应该是：**纯计算留在 src/functions 两边都能引用的地方**，只有真正的服务端逻辑
 * （查库、鉴权、通知）才留在函数目录。于是这里放纯函数，服务端那侧改为反向 import。
 *
 * 【为什么不能简单复制一份】
 * 时区换算是那种"看起来简单、错一位就差一小时"的东西（DST 跳变、不存在的本地时间、
 * 重叠的秋季回拨时间）。两份实现迟早会漂移，而漂移表现为"偶尔差一小时"这种极难排查的
 * 症状。所以是**一份实现、两个方向都指向它**。
 *
 * 【行为约定，与原实现逐字一致】
 *   - zonedParts      取某个瞬间在指定时区的日历字段
 *   - dateInZone      取某个瞬间在指定时区的日期（YYYY-MM-DD）
 *   - wallTimeToEpoch 把"某时区的墙上时间"换成瞬间。不存在的本地时间（DST 前跳）
 *                     返回 null；重叠的秋季回拨时间按 edge 取前一个/后一个瞬间。
 */
const MINUTE_MS = 60 * 1000
const formatterCache = new Map()

export function pad(value) {
  return String(value).padStart(2, '0')
}

export function dateText(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** 校验 YYYY-MM-DD，并且是真存在的日期（排除 2026-13-45 这类）。 */
export function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** 把 "HH:MM" 换成当天第几分钟；格式不对或越界返回 null。 */
export function validClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null
}

/** 缓存的 Intl formatter：Intl.DateTimeFormat 构造较贵，时区换算会被高频调用。 */
export function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }))
  }
  return formatterCache.get(timeZone)
}

export function zonedParts(epochMs, timeZone) {
  const values = Object.fromEntries(formatter(timeZone).formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]))
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
  }
}

export function dateInZone(epochMs, timeZone) {
  const parts = zonedParts(epochMs, timeZone)
  return dateText(parts.year, parts.month, parts.day)
}

/**
 * 把某个时区的"墙上时间"换成 UTC 瞬间：在目标附近试探各个 UTC 偏移，挑出换算回去
 * 正好等于原始日历字段的那个瞬间。
 *
 * 不存在的本地时间（DST 前跳，如某些时区 02:30 那天不存在）返回 null；
 * 重叠的秋季回拨时间有两个合法瞬间，edge='start' 取较早的，edge='end' 取较晚的。
 */
export function wallTimeToEpoch(date, clock, timeZone, edge = 'start') {
  const minutes = validClock(clock)
  if (!validDate(date) || minutes === null) return null
  const [year, month, day] = date.split('-').map(Number)
  const desired = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60)
  const offsets = new Set()
  for (let delta = -36; delta <= 36; delta += 6) {
    // delta 是"分钟数"，所以要再乘一次 60 变成毫秒。漏掉这个系数会让探测范围
    // 从 ±36 小时缩成 ±36 分钟，落在 DST 边界附近时找不到任何合法候选，
    // 症状是本来正常的时间被当成"本地时间不存在"返回 null。
    const sample = desired + delta * 60 * MINUTE_MS
    const parts = zonedParts(sample, timeZone)
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    // sample 必须先截到整秒：Intl.DateTimeFormat 的 formatToParts 只精确到秒，
    // 带着毫秒去减会得到一个虚假的偏移量，半小时/45 分钟偏移的时区会因此一个候选都匹配不上
    // （表现为合法时刻被判成"本地时间不存在"而返回 null）。
    offsets.add(represented - Math.floor(sample / 1000) * 1000)
  }
  const candidates = [...offsets].map((offset) => desired - offset).filter((candidate) => {
    const parts = zonedParts(candidate, timeZone)
    return parts.year === year && parts.month === month && parts.day === day
      && parts.hour === Math.floor(minutes / 60) && parts.minute === minutes % 60
  }).sort((a, b) => a - b)
  if (!candidates.length) return null
  return edge === 'end' ? candidates[candidates.length - 1] : candidates[0]
}