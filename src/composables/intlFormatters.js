const MAX_FORMATTERS = 32
const dateTimeFormatters = new Map()
const numberFormatters = new Map()

function formatterKey(locale, options) {
  return JSON.stringify([
    locale,
    Object.entries(options || {}).sort(([left], [right]) => left.localeCompare(right)),
  ])
}

function getFormatter(cache, Constructor, locale, options) {
  const key = formatterKey(locale, options)
  let formatter = cache.get(key)
  if (formatter) {
    cache.delete(key)
    cache.set(key, formatter)
    return formatter
  }
  formatter = new Constructor(locale, options)
  cache.set(key, formatter)
  if (cache.size > MAX_FORMATTERS) cache.delete(cache.keys().next().value)
  return formatter
}

export function getDateTimeFormatter(locale = 'zh-CN', options = {}) {
  return getFormatter(dateTimeFormatters, Intl.DateTimeFormat, locale, options)
}

export function formatDateTime(value, options = {}, locale = 'zh-CN') {
  return getDateTimeFormatter(locale, options).format(value instanceof Date ? value : new Date(value))
}

export function getNumberFormatter(locale = 'zh-CN', options = {}) {
  return getFormatter(numberFormatters, Intl.NumberFormat, locale, options)
}

export function formatNumber(value, options = {}, locale = 'zh-CN') {
  return getNumberFormatter(locale, options).format(value)
}
