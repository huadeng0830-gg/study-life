export const campusPublicationOptions = [
  { id: 'teacher', title: '教师资料线索', note: '仅提交公开资料来源，审核后再建立档案。' },
  { id: 'course', title: '课程资料', note: '课程、院系与公开来源。' },
  { id: 'assignment', title: '授课安排', note: '把已审核的教师、课程和学期关联起来。' },
  { id: 'market', title: '二手出售 / 求购 / 赠送', note: '线下校园安全地点交易；平台不收款。' },
  { id: 'help', title: '校园互助', note: '不公开取件码、手机号、房间号或证件信息。' },
  { id: 'shuttle', title: '校车线路与班次', note: '必须提供公开来源；人工审核后展示。' },
  { id: 'shuttle_correction', title: '校车线路纠错', note: '说明错误并提供可核实来源。' },
  { id: 'shuttle_exception', title: '校车特殊日期安排', note: '只提交有公开来源的临时班次变化。' },
  { id: 'lost', title: '失物招领', note: '敏感号码与可识别信息不要写进公开描述。' },
  { id: 'event', title: '活动 / 社团活动', note: '未验证组织方不会显示学校官方标识。' },
  { id: 'guide', title: '校园指南 / 经验', note: '标明官方来源或学生经验，并设置有效期。' },
]

export const campusPublicationDefaults = () => ({
  teacher: { name: '', department: '', researchDirections: '', officialIntro: '', sourceUrl: '' },
  course: { name: '', department: '', description: '', sourceUrl: '' },
  assignment: { courseId: '', teacherId: '', term: '', sourceUrl: '' },
  market: { listingType: 'sale', category: 'textbook', title: '', description: '', condition: '', price: '', meetupArea: '' },
  help: { taskType: 'parcel', title: '', description: '', pickupArea: '', deliveryArea: '', deadline: '' },
  shuttle: { name: '', sourceUrl: '', effectiveFrom: '', effectiveTo: '', stopsText: '', departuresText: '' },
  shuttle_correction: { routeId: '', detail: '', sourceUrl: '' },
  shuttle_exception: { routeId: '', serviceDate: '', exceptionType: 'suspended', departureTime: '', direction: 'outbound', note: '', sourceUrl: '' },
  lost: { mode: 'lost', category: 'electronics', title: '', description: '', approximateLocation: '', occurredAt: '' },
  event: { title: '', description: '', startsAt: '', endsAt: '', location: '', organizer: '', signupUrl: '', sourceUrl: '', capacity: '' },
  guide: { title: '', category: 'new_student', body: '', sourceType: 'student_experience', sourceUrl: '', expiresOn: '' },
})

function timestamp(value, label, required = false) {
  if (!value && !required) return ''
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`请填写有效的${label}。`)
  return date.toISOString()
}

function dateOnly(value, label) {
  if (!value) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`请填写有效的${label}。`)
  return value
}

function priceInCents(value) {
  if (value === '') return null
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new Error('价格请填写最多两位小数的非负金额。')
  const price = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(price) || price > 100000000) throw new Error('价格需在 0 至 1,000,000 元之间。')
  return price
}

function rows(value, label, min, max, fields) {
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < min || lines.length > max) throw new Error(`${label}需要 ${min} 至 ${max} 行。`)
  return lines.map((line, index) => {
    const parts = line.split('|').map((part) => part.trim())
    if (parts.length < fields[0] || parts.length > fields[1]) throw new Error(`${label}第 ${index + 1} 行的字段数量不正确。`)
    if (!['outbound', 'inbound'].includes(parts[0])) throw new Error(`${label}第 ${index + 1} 行的方向需填写 outbound 或 inbound。`)
    return parts
  })
}

/** Pure conversion seam shared by new submissions and rejected-content edits.
 * Only supported fields leave this module; school, owner and review state are
 * always assigned by the server. Server validation remains authoritative.
 */
export function buildCampusPublication(kind, form) {
  const defaults = campusPublicationDefaults()
  if (!Object.hasOwn(defaults, kind)) throw new Error('发布类型无效，请重新选择。')
  const values = Object.fromEntries(Object.keys(defaults[kind]).map((key) => [key, String(form?.[key] ?? defaults[kind][key]).trim()]))
  for (const [key, label] of Object.entries({ name: '名称', title: '标题', body: '正文' })) {
    if (key in values && !values[key]) throw new Error(`请填写${label}。`)
  }
  if (kind === 'assignment' && (!values.courseId || !values.teacherId || !values.term)) throw new Error('请选择课程、教师并填写学期。')
  if (kind.startsWith('shuttle_') && !values.routeId) throw new Error('请选择已审核线路。')
  if (kind === 'shuttle_correction' && !values.detail) throw new Error('请填写纠错内容。')
  const sourceRequired = ['teacher', 'shuttle', 'shuttle_exception'].includes(kind) || (kind === 'guide' && values.sourceType === 'official_public')
  for (const key of ['sourceUrl', 'signupUrl']) {
    if (!(key in values)) continue
    if (!values[key]) {
      if (key === 'sourceUrl' && sourceRequired) throw new Error('请填写公开来源 HTTPS 链接。')
      continue
    }
    let url
    try { url = new URL(values[key]) } catch { throw new Error('请填写有效的 HTTPS 链接。') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('请使用不含账号密码的 HTTPS 链接。')
  }
  for (const key of ['effectiveFrom', 'effectiveTo', 'occurredAt', 'expiresOn', 'serviceDate']) {
    if (key in values) values[key] = dateOnly(values[key], { effectiveFrom: '生效日期', effectiveTo: '失效日期', occurredAt: '发生日期', expiresOn: '有效期', serviceDate: '适用日期' }[key])
  }
  if (values.effectiveFrom && values.effectiveTo && values.effectiveTo < values.effectiveFrom) throw new Error('失效日期不能早于生效日期。')
  if (kind === 'market') return { ...values, priceCents: values.listingType === 'free' ? 0 : priceInCents(values.price) }
  if (kind === 'help') return { ...values, deadline: timestamp(values.deadline, '最晚完成时间') }
  if (kind === 'event') {
    const startsAt = timestamp(values.startsAt, '开始时间', true)
    const endsAt = timestamp(values.endsAt, '结束时间', true)
    if (endsAt <= startsAt) throw new Error('活动结束时间必须晚于开始时间。')
    const capacity = values.capacity === '' ? null : Number(values.capacity)
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) throw new Error('活动名额需为 1 至 100,000 的整数。')
    return { ...values, startsAt, endsAt, capacity }
  }
  if (kind === 'shuttle') {
    const stops = rows(values.stopsText, '站点', 2, 60, [2, 2]).map(([direction, name]) => {
      if (!name) throw new Error('站点名称不能为空。')
      return { direction, name }
    })
    const departures = rows(values.departuresText, '班次', 1, 240, [3, 4]).map(([direction, serviceDay, time, stopName = '']) => {
      if (!['weekday', 'weekend', 'holiday'].includes(serviceDay) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('班次请填写有效的运行日期和 HH:mm 发车时间。')
      return { direction, serviceDay, time, stopName }
    })
    const { stopsText: _stopsText, departuresText: _departuresText, ...rest } = values
    return { ...rest, stops, departures }
  }
  if (kind === 'shuttle_exception') {
    if (!values.serviceDate) throw new Error('请填写适用日期。')
    if (values.exceptionType === 'suspended') values.departureTime = ''
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.departureTime)) throw new Error('请填写有效的发车时间。')
  }
  return values
}
