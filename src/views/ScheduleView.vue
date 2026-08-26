<script setup>
import { ref, reactive, computed } from 'vue'
import Modal from '../components/Modal.vue'
import { appearance } from '../composables/appearance.js'
import {
  useStoredRef,
  todayIndex,
  PALETTE,
  DEFAULT_TIMES,
  timeConfig,
  campusName,
  seasonName,
  currentCampusId,
  currentSeasonId,
  currentTimes,
  periodIndex,
  periodLabelById,
  periodRangeById,
  addCampus,
  renameCampus,
  removeCampus,
  addSeason,
  renameSeason,
  removeSeason,
  addPeriod,
  renamePeriod,
  removePeriod,
  resetTimesToDefault,
  normalizeTimes,
  MAX_WEEK,
  semester,
  weekOf,
  currentWeek,
  todayStr,
  courseInWeek,
  weekLabel,
} from '../composables/store.js'

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const courses = useStoredRef('sl_courses', [])
const courseTemplates = useStoredRef('sl_course_templates', [])
const showForm = ref(false)
const showTimeEditor = ref(false)
const showSemester = ref(false)
const showBatch = ref(false)
const showCourseManager = ref(false)
const editingId = ref(null)
const error = ref('')
const batchText = ref('')
const batchError = ref('')
const selectedCourseIds = ref([])
const templateName = ref('')
const managerMessage = ref('')
const managerError = ref('')
const semStart = ref(semester.value.start)
const viewWeek = ref(Math.min(Math.max(currentWeek(), 1), MAX_WEEK))
const form = reactive({
  name: '',
  teacher: '',
  room: '',
  color: PALETTE[0],
  day: 0,
  start: 1,
  end: 2,
  startWeek: 1,
  endWeek: 16,
  weekType: 'all',
})

const combos = computed(() => {
  const list = []
  for (const season of timeConfig.value.seasons) {
    for (const campus of timeConfig.value.campuses) {
      list.push({ season: season.id, campus: campus.id, seasonName: season.name, campusName: campus.name, startDate: season.startDate })
    }
  }
  return list
})

// 设置弹窗的临时输入
const newCampusName = ref('')
const newSeasonName = ref('')
const newSeasonDate = ref('03-01')
const newPeriodLabel = ref('')
const settingError = ref('')

function onAddCampus() {
  settingError.value = ''
  if (addCampus(newCampusName.value)) newCampusName.value = ''
  else settingError.value = '请输入校区名称'
}

function onRemoveCampus(id) {
  settingError.value = ''
  if (!removeCampus(id)) settingError.value = '至少保留一个校区'
}

function onAddSeason() {
  settingError.value = ''
  if (!/^\d{2}-\d{2}$/.test(newSeasonDate.value)) {
    settingError.value = '起始日期格式应为 MM-DD，例如 05-01'
    return
  }
  if (addSeason(newSeasonName.value, newSeasonDate.value)) {
    newSeasonName.value = ''
    newSeasonDate.value = '03-01'
  } else {
    settingError.value = '请输入作息季名称'
  }
}

function onRemoveSeason(id) {
  settingError.value = ''
  if (!removeSeason(id)) settingError.value = '至少保留一个作息季'
}

function onAddPeriod() {
  settingError.value = ''
  if (addPeriod(newPeriodLabel.value)) newPeriodLabel.value = ''
  else settingError.value = '请输入节次名称'
}

function onRemovePeriod(id) {
  settingError.value = ''
  const result = removePeriod(id, (periodId) =>
    courses.value.some((c) => c.start === periodId || c.end === periodId)
  )
  if (result !== true) settingError.value = result
}

function onResetTimes() {
  settingError.value = ''
  resetTimesToDefault()
}

function openTimeSettings() {
  const periods = timeConfig.value.periods
  if (!gen.startId || periodIndex(gen.startId) < 0) {
    gen.startId = periods[1]?.id ?? periods[0]?.id ?? null
  }
  if (gen.lunchAfterIdx >= periods.length - 1) gen.lunchAfterIdx = Math.max(1, periods.length - 3)
  if (gen.dinnerAfterIdx >= periods.length - 1) gen.dinnerAfterIdx = Math.max(2, periods.length - 2)
  settingError.value = ''
  settingsTab.value = 'times'
  showTimeEditor.value = true
}

// ---------- 一键生成作息时间 ----------
const gen = reactive({
  startId: null,
  startTime: '08:00',
  duration: 45,
  breakMin: 10,
  lunchAfterIdx: 4,
  lunchMin: 120,
  dinnerAfterIdx: 8,
  dinnerMin: 60,
  allSeasons: false,
  allCampuses: false,
})

const genStartOptions = computed(() => timeConfig.value.periods)
const genAfterOptions = computed(() => timeConfig.value.periods)

function toMinutes(hhmm) {
  const [h = 0, m = 0] = String(hhmm ?? '').split(':').map(Number)
  return h * 60 + m
}

function toHHMM(minutes) {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function generateTimes() {
  settingError.value = ''
  const cfg = timeConfig.value
  const periods = cfg.periods
  const startIdx = periodIndex(gen.startId ?? periods[1]?.id ?? periods[0]?.id)
  if (startIdx < 0) {
    settingError.value = '请选择起始节次'
    return
  }
  const lunchIdx = gen.lunchMin > 0 ? gen.lunchAfterIdx : -1
  const dinnerIdx = gen.dinnerMin > 0 ? gen.dinnerAfterIdx : -1
  if (lunchIdx < startIdx || lunchIdx >= periods.length - 1) {
    settingError.value = '午休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }
  if (gen.dinnerMin > 0 && (dinnerIdx < startIdx || dinnerIdx >= periods.length - 1)) {
    settingError.value = '晚休位置无效（需在起始节次之后、且后面还有节次）'
    return
  }

  // 计算从起始节次开始的每个节次时间
  let cursor = toMinutes(gen.startTime)
  const generated = periods.map((_, i) => {
    if (i < startIdx) return null
    if (i > startIdx) {
      const prev = i - 1
      if (prev === lunchIdx) cursor += gen.lunchMin
      else if (prev === dinnerIdx) cursor += gen.dinnerMin
      else cursor += gen.breakMin
    }
    const start = toHHMM(cursor)
    cursor += Number(gen.duration) || 45
    return { start, end: toHHMM(cursor) }
  })

  const seasons = gen.allSeasons ? cfg.seasons.map((s) => s.id) : [currentSeasonId()]
  const campuses = gen.allCampuses ? cfg.campuses.map((c) => c.id) : [currentCampusId()]
  normalizeTimes(cfg)
  for (const seasonId of seasons) {
    for (const campusId of campuses) {
      const list = cfg.times[seasonId]?.[campusId]
      if (!list) continue
      for (let i = startIdx; i < periods.length; i++) {
        if (generated[i]) list[i] = { ...generated[i] }
      }
    }
  }
}

// 在当前编辑课程的时间格子里，追加另一门不同周次的课程
function addAnotherInCell() {
  const day = Number(form.day)
  const start = form.start
  const startIdx = periodIndex(start)
  // 正在编辑的课程本身也算"已有课程"，新课程的周次从它之后顺延
  const existing = courses.value.filter((c) => {
    if (c.day !== day) return false
    const s = periodIndex(c.start)
    const e = periodIndex(c.end)
    if (s < 0 || e < 0) return false
    return Math.min(s, e) <= startIdx && Math.max(s, e) >= startIdx
  })
  openAdd(day, start)
  if (existing.length) {
    const maxEnd = Math.max(...existing.map((c) => c.endWeek ?? MAX_WEEK))
    if (maxEnd < MAX_WEEK) {
      form.startWeek = maxEnd + 1
      form.endWeek = MAX_WEEK
    }
  }
}

// 表单中当前格子里的其他课程（用于提示与重叠检测）
const formCellCourses = computed(() => {
  if (!showForm.value) return []
  const day = Number(form.day)
  const sIdx = periodIndex(form.start)
  const eIdx = periodIndex(form.end)
  if (sIdx < 0 || eIdx < 0) return []
  const lo = Math.min(sIdx, eIdx)
  const hi = Math.max(sIdx, eIdx)
  return courses.value.filter((c) => {
    if (c.id === editingId.value) return false
    if (c.day !== day) return false
    const cs = periodIndex(c.start)
    const ce = periodIndex(c.end)
    if (cs < 0 || ce < 0) return false
    return Math.min(cs, ce) <= hi && Math.max(cs, ce) >= lo
  })
})

function formOverlapsWith(course) {
  const sw = Number(form.startWeek)
  const ew = Number(form.endWeek)
  const csw = course.startWeek ?? 1
  const cew = course.endWeek ?? MAX_WEEK
  const lo = Math.max(sw, csw)
  const hi = Math.min(ew, cew)
  if (lo > hi) return false
  const ft = form.weekType ?? 'all'
  const ct = course.weekType ?? 'all'
  for (let w = lo; w <= hi; w++) {
    const aOn = ft === 'all' || (ft === 'odd' ? w % 2 === 1 : w % 2 === 0)
    const bOn = ct === 'all' || (ct === 'odd' ? w % 2 === 1 : w % 2 === 0)
    if (aOn && bOn) return true
  }
  return false
}

const formCellClash = computed(() => formCellCourses.value.find((c) => formOverlapsWith(c)))

// ---------- 设置弹窗标签页 ----------
const settingsTab = ref('times')
const tabHints = {
  times: '选择作息季和校区后编辑上下课时间，也可以用「一键生成」按规则快速填充全部节次。',
  campus: '添加、重命名或删除校区，至少保留一个。删除校区会同时删除其时间配置。',
  season: '设置每种作息的名称和生效起始日期，网站会按日期自动切换到最新的一季。',
  period: '增删或重命名节次，时间表的行数会跟着变化。被课程占用的节次无法删除。',
}
const TAB_ICONS = { times: '⏰ 时间表', campus: '🏫 校区', season: '📅 作息季', period: '📋 节次' }
function tabLabel(tab) {
  return TAB_ICONS[tab] ?? tab
}

const selectedCourses = computed(() =>
  courses.value.filter((course) => selectedCourseIds.value.includes(course.id))
)
const allCoursesSelected = computed(() =>
  courses.value.length > 0 && selectedCourseIds.value.length === courses.value.length
)

function openCourseManager() {
  selectedCourseIds.value = []
  managerMessage.value = ''
  managerError.value = ''
  templateName.value = `${new Date().getFullYear()}年课表`
  showCourseManager.value = true
}

function toggleCourseSelection(id) {
  selectedCourseIds.value = selectedCourseIds.value.includes(id)
    ? selectedCourseIds.value.filter((value) => value !== id)
    : [...selectedCourseIds.value, id]
}

function toggleAllCourses() {
  selectedCourseIds.value = allCoursesSelected.value
    ? []
    : courses.value.map((course) => course.id)
}

function deleteSelectedCourses() {
  if (!selectedCourses.value.length) return
  if (!window.confirm(`确定删除选中的 ${selectedCourses.value.length} 门课程吗？`)) return
  const ids = new Set(selectedCourseIds.value)
  courses.value = courses.value.filter((course) => !ids.has(course.id))
  selectedCourseIds.value = []
  managerMessage.value = '选中的课程已删除'
}

function duplicateSelectedCourses() {
  if (!selectedCourses.value.length) return
  const stamp = Date.now()
  const copies = selectedCourses.value.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_copy_${index}`,
  }))
  courses.value.push(...copies)
  selectedCourseIds.value = copies.map((course) => course.id)
  managerMessage.value = `已创建 ${copies.length} 门课程副本，可关闭窗口后逐项调整`
}

function clearCurrentSchedule() {
  if (!courses.value.length) return
  if (!window.confirm('确定清空当前全部课程吗？建议先保存为学期模板或导出备份。')) return
  courses.value = []
  selectedCourseIds.value = []
  managerMessage.value = '当前课表已清空'
}

function saveCourseTemplate() {
  managerError.value = ''
  const name = templateName.value.trim()
  if (!name) {
    managerError.value = '请填写模板名称'
    return
  }
  if (!courses.value.length) {
    managerError.value = '当前没有课程可以保存'
    return
  }
  courseTemplates.value.unshift({
    id: 'tpl' + Date.now(),
    name,
    createdAt: new Date().toISOString(),
    courses: JSON.parse(JSON.stringify(courses.value)),
  })
  templateName.value = ''
  managerMessage.value = `“${name}”已保存，可在新学期重新导入`
}

function importCourseTemplate(template) {
  const action = courses.value.length ? '追加到当前课表' : '导入为空课表'
  if (!window.confirm(`确定将“${template.name}”中的 ${template.courses.length} 门课程${action}吗？`)) return
  const stamp = Date.now()
  const copies = template.courses.map((course, index) => ({
    ...JSON.parse(JSON.stringify(course)),
    id: `c${stamp}_tpl_${index}`,
  }))
  courses.value.push(...copies)
  managerMessage.value = `已导入 ${copies.length} 门课程`
}

function deleteCourseTemplate(template) {
  if (!window.confirm(`确定删除课表模板“${template.name}”吗？`)) return
  courseTemplates.value = courseTemplates.value.filter((item) => item.id !== template.id)
}

function openBatch() {
  batchText.value = ''
  batchError.value = ''
  showBatch.value = true
}

function parseDay(value) {
  const text = String(value ?? '').trim()
  const chinese = ['一', '二', '三', '四', '五', '六', '日']
  const chineseIndex = chinese.findIndex((name) => text.includes(name))
  if (chineseIndex >= 0) return chineseIndex
  const number = Number(text.match(/[1-7]/)?.[0])
  return number >= 1 && number <= 7 ? number - 1 : -1
}

function parseNumberRange(value, min, max, fallbackEnd = null) {
  const numbers = String(value ?? '').match(/\d+/g)?.map(Number) ?? []
  if (!numbers.length) return null
  let start = numbers[0]
  let end = numbers[1] ?? fallbackEnd ?? start
  if (end < start) [start, end] = [end, start]
  if (start < min || end > max) return null
  return [start, end]
}

function parseBatchLine(line, sourceIndex) {
  const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,，]/))
    .map((cell) => cell.trim())
  const [name = '', dayText = '', periodText = '', weekText = '', typeText = '', room = '', teacher = ''] = cells
  const periods = timeConfig.value.periods
  const day = parseDay(dayText)
  const period = /早自习/.test(periodText)
    ? [periods[0]?.id, periods[0]?.id]
    : (() => {
        const range = parseNumberRange(periodText, 0, periods.length - 1)
        return range ? [periods[range[0]]?.id, periods[range[1]]?.id] : null
      })()
  const weeks = /全学期/.test(weekText)
    ? [1, MAX_WEEK]
    : parseNumberRange(weekText, 1, MAX_WEEK)
  const typeSource = `${weekText} ${typeText}`
  const weekType = /单/.test(typeSource) ? 'odd' : /双/.test(typeSource) ? 'even' : 'all'
  const errors = []
  if (!name) errors.push('缺少课程名称')
  if (day < 0) errors.push('星期格式不正确')
  if (!period || !period[0] || !period[1]) errors.push(`节次应在 1-${periods.length} 之间`)
  if (!weeks) errors.push(`周次应在 1-${MAX_WEEK} 周之间`)

  return {
    sourceIndex,
    cells,
    error: errors.join('；'),
    data: errors.length
      ? null
      : {
          name,
          day,
          start: period[0],
          end: period[1],
          startWeek: weeks[0],
          endWeek: weeks[1],
          weekType,
          room,
          teacher,
        },
  }
}

const batchRows = computed(() => {
  const lines = batchText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !(index === 0 && /课程.*星期/.test(line)))
    .map(({ line, index }) => parseBatchLine(line, index + 1))
})

const validBatchCount = computed(() => batchRows.value.filter((row) => row.data).length)
const invalidBatchCount = computed(() => batchRows.value.length - validBatchCount.value)

function importBatch() {
  batchError.value = ''
  if (!batchRows.value.length) {
    batchError.value = '请先粘贴课程表内容'
    return
  }
  if (invalidBatchCount.value) {
    batchError.value = '请先修正预览中标红的内容'
    return
  }

  const stamp = Date.now()
  const initialCount = courses.value.length
  batchRows.value.forEach((row, index) => {
    courses.value.push({
      id: `c${stamp}_${index}`,
      color: PALETTE[(initialCount + index) % PALETTE.length],
      ...row.data,
    })
  })
  showBatch.value = false
}

const curWeek = computed(() => Math.min(Math.max(currentWeek(), 1), MAX_WEEK))

function goWeek(delta) {
  const next = viewWeek.value + delta
  if (next >= 1 && next <= MAX_WEEK) viewWeek.value = next
}

function saveSemester() {
  if (!semStart.value) return
  semester.value.start = semStart.value
  viewWeek.value = curWeek.value
  showSemester.value = false
}

function semesterPreview() {
  if (!semStart.value) return ''
  return weekOf(todayStr())
}

const visibleCourses = computed(() =>
  courses.value.filter((c) => courseInWeek(c, viewWeek.value))
)

const conflictIds = computed(() => {
  const ids = new Set()
  const list = visibleCourses.value
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const aStart = periodIndex(a.start)
      const aEnd = periodIndex(a.end)
      const bStart = periodIndex(b.start)
      const bEnd = periodIndex(b.end)
      if (
        a.day === b.day &&
        aStart >= 0 && aEnd >= 0 && bStart >= 0 && bEnd >= 0 &&
        aStart <= bEnd &&
        bStart <= aEnd
      ) {
        ids.add(a.id)
        ids.add(b.id)
      }
    }
  }
  return ids
})

const conflictCount = computed(() => {
  let count = 0
  const list = visibleCourses.value
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const aStart = periodIndex(a.start)
      const aEnd = periodIndex(a.end)
      const bStart = periodIndex(b.start)
      const bEnd = periodIndex(b.end)
      if (
        a.day === b.day &&
        aStart >= 0 && aEnd >= 0 && bStart >= 0 && bEnd >= 0 &&
        aStart <= bEnd &&
        bStart <= aEnd
      ) {
        count++
      }
    }
  }
  return count
})

function openAdd(day = null, period = null) {
  editingId.value = null
  error.value = ''
  const periods = timeConfig.value.periods
  const fallbackStart = periods[1]?.id ?? periods[0]?.id ?? null
  form.name = ''
  form.teacher = ''
  form.room = ''
  form.color = PALETTE[courses.value.length % PALETTE.length]
  form.day = day ?? todayIndex()
  form.start = period ?? fallbackStart
  const startIdx = periodIndex(form.start)
  form.end = period ? (periods[startIdx + 1]?.id ?? period) : (periods[startIdx + 1]?.id ?? fallbackStart)
  form.startWeek = 1
  form.endWeek = 16
  form.weekType = 'all'
  showForm.value = true
}

function openEdit(c) {
  editingId.value = c.id
  error.value = ''
  Object.assign(form, {
    ...c,
    startWeek: c.startWeek ?? 1,
    endWeek: c.endWeek ?? MAX_WEEK,
    weekType: c.weekType ?? 'all',
  })
  showForm.value = true
}

function save() {
  if (!form.name.trim()) {
    error.value = '请填写课程名称'
    return
  }
  let s = form.start
  let e = form.end
  if (periodIndex(e) < periodIndex(s)) [s, e] = [e, s]
  let sw = Number(form.startWeek)
  let ew = Number(form.endWeek)
  if (ew < sw) [sw, ew] = [ew, sw]
  const data = {
    name: form.name.trim(),
    teacher: form.teacher.trim(),
    room: form.room.trim(),
    color: form.color,
    day: Number(form.day),
    start: s,
    end: e,
    startWeek: sw,
    endWeek: ew,
    weekType: form.weekType,
  }
  if (editingId.value) {
    const c = courses.value.find((c) => c.id === editingId.value)
    Object.assign(c, data)
  } else {
    courses.value.push({ id: 'c' + Date.now(), ...data })
  }
  showForm.value = false
}

function remove() {
  courses.value = courses.value.filter((c) => c.id !== editingId.value)
  showForm.value = false
}

function courseAt(day, periodId) {
  const target = periodIndex(periodId)
  if (target < 0) return null
  return visibleCourses.value.find((c) => {
    const s = periodIndex(c.start)
    const e = periodIndex(c.end)
    return c.day === day && s >= 0 && e >= 0 && target >= s && target <= e
  })
}

function periodOption(id) {
  const label = periodLabelById(id)
  const t = periodRangeById(id)
  return t ? `${label}（${t}）` : label
}

function coursePeriodText(course) {
  const start = periodLabelById(course.start)
  const end = periodLabelById(course.end)
  return course.start === course.end ? start : `${start}至${end}`
}

function templateDate(value) {
  return new Date(value).toLocaleDateString('zh-CN')
}

const todayIdx = computed(() => todayIndex())
</script>

<template>
  <div class="page">
    <div class="head">
      <h2>📅 我的课程表</h2>
      <div class="head-btns">
        <button class="btn btn-ghost" @click="openCourseManager">☷ 批量管理</button>
        <button class="btn btn-ghost" @click="showSemester = true">📅 学期设置</button>
        <button class="btn btn-ghost" @click="openTimeSettings">🕐 作息与时间设置</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="seg-group skin-switcher">
        <span class="seg-label">皮肤</span>
        <div class="seg">
          <button :class="{ on: appearance.scheduleSkin === 'classic' }" @click="appearance.scheduleSkin = 'classic'">经典</button>
          <button :class="{ on: appearance.scheduleSkin === 'notebook' }" @click="appearance.scheduleSkin = 'notebook'">笔记</button>
          <button :class="{ on: appearance.scheduleSkin === 'timeline' }" @click="appearance.scheduleSkin = 'timeline'">极简</button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">校区</span>
        <div class="seg">
          <button
            v-for="campus in timeConfig.campuses"
            :key="campus.id"
            :class="{ on: currentCampusId() === campus.id }"
            @click="timeConfig.currentCampus = campus.id"
          >
            {{ campus.name }}
          </button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">作息</span>
        <div class="seg">
          <button :class="{ on: timeConfig.autoSeason }" @click="timeConfig.autoSeason = true">
            自动
          </button>
          <button
            v-for="season in timeConfig.seasons"
            :key="season.id"
            :class="{ on: !timeConfig.autoSeason && timeConfig.currentSeason === season.id }"
            @click="timeConfig.autoSeason = false; timeConfig.currentSeason = season.id"
          >
            {{ season.name }}
          </button>
        </div>
      </div>
      <div class="seg-group">
        <span class="seg-label">周次</span>
        <div class="seg">
          <button :disabled="viewWeek <= 1" @click="goWeek(-1)">‹</button>
          <button class="wn" :class="{ thisweek: viewWeek === curWeek }">
            第 {{ viewWeek }} 周
          </button>
          <button :disabled="viewWeek >= MAX_WEEK" @click="goWeek(1)">›</button>
        </div>
        <button v-if="viewWeek !== curWeek" class="btn btn-ghost" @click="viewWeek = curWeek">
          回到本周
        </button>
      </div>
      <div class="add-actions">
        <button class="btn btn-ghost" @click="openBatch">⇩ 批量录入</button>
        <button class="btn btn-primary" @click="openAdd()">＋ 添加课程</button>
      </div>
    </div>

    <div v-if="conflictIds.size > 0" class="warn-banner">
      ⚠️ 第 {{ viewWeek }} 周有 {{ conflictCount }} 组课程时间冲突（红框标出），请检查周次设置
    </div>

    <div class="card timetable-wrap" :class="`skin-${appearance.scheduleSkin}`">
      <div class="timetable">
        <div class="corner"></div>
        <div
          v-for="(d, i) in DAYS"
          :key="d"
          class="tt-head"
          :class="{ today: i === todayIdx && viewWeek === curWeek }"
        >
          {{ d }}<span v-if="i === todayIdx && viewWeek === curWeek" class="today-tag">今天</span>
        </div>

        <template v-for="(row, ri) in timeConfig.periods" :key="row.id">
          <div class="tt-period" :style="{ gridRow: ri + 2 }">
            <b>{{ row.label }}</b>
            <span>{{ periodRangeById(row.id) }}</span>
          </div>
          <div
            v-for="(d, i) in DAYS"
            :key="d + row.id"
            class="tt-cell"
            :class="{ isToday: i === todayIdx && viewWeek === curWeek }"
            :style="{ gridColumn: i + 2, gridRow: ri + 2 }"
            @click="openAdd(i, row.id)"
          ></div>
        </template>

        <div
          v-for="c in visibleCourses"
          :key="c.id"
          class="course"
          :class="{ conflict: conflictIds.has(c.id) }"
          :style="{
            gridColumn: c.day + 2,
            gridRow: `${periodIndex(c.start) + 2} / ${periodIndex(c.end) + 3}`,
            background: c.color + '18',
            borderLeftColor: c.color,
          }"
          @click="openEdit(c)"
        >
          <span class="c-name">{{ c.name }}</span>
          <span class="c-week">{{ weekLabel(c) }}</span>
          <span v-if="c.room" class="c-sub">@{{ c.room }}</span>
        </div>
      </div>
    </div>

    <p class="tip">
      💡 正在查看：{{ campusName(currentCampusId()) }} ·
      {{ seasonName(currentSeasonId()) }}<template v-if="timeConfig.autoSeason">（自动）</template> ·
      第 {{ viewWeek }} 周的课程；
      点击空白格子快速添加，点击课程卡片可编辑
    </p>

    <Modal :open="showForm" :title="editingId ? '编辑课程' : '添加课程'" @close="showForm = false">
      <div class="form">
        <label>课程名称 *</label>
        <input v-model="form.name" placeholder="例如：高等数学" />

        <label>任课老师</label>
        <input v-model="form.teacher" placeholder="选填" />

        <label>上课地点</label>
        <input v-model="form.room" placeholder="例如：教学楼 A201" />

        <div class="row">
          <div>
            <label>星期</label>
            <select v-model.number="form.day">
              <option v-for="(d, i) in DAYS" :key="d" :value="i">{{ d }}</option>
            </select>
          </div>
          <div>
            <label>开始</label>
            <select v-model="form.start">
              <option v-for="row in timeConfig.periods" :key="row.id" :value="row.id">
                {{ periodOption(row.id) }}
              </option>
            </select>
          </div>
          <div>
            <label>结束</label>
            <select v-model="form.end">
              <option v-for="row in timeConfig.periods" :key="row.id" :value="row.id">
                {{ periodOption(row.id) }}
              </option>
            </select>
          </div>
        </div>

        <div class="row">
          <div>
            <label>开始周</label>
            <select v-model.number="form.startWeek">
              <option v-for="w in MAX_WEEK" :key="w" :value="w">第{{ w }}周</option>
            </select>
          </div>
          <div>
            <label>结束周</label>
            <select v-model.number="form.endWeek">
              <option v-for="w in MAX_WEEK" :key="w" :value="w">第{{ w }}周</option>
            </select>
          </div>
          <div>
            <label>上课周类型</label>
            <select v-model="form.weekType">
              <option value="all">每周上</option>
              <option value="odd">单周上</option>
              <option value="even">双周上</option>
            </select>
          </div>
        </div>

        <div v-if="formCellCourses.length" class="cell-existing">
          <span class="ce-label">此格已有：</span>
          <span
            v-for="c in formCellCourses"
            :key="c.id"
            class="cell-chip"
            :class="{ clash: formOverlapsWith(c) }"
          >{{ c.name }}（{{ weekLabel(c) }}）</span>
        </div>
        <p v-if="formCellClash" class="error">
          ⚠️ 周次与「{{ formCellClash.name }}」重叠，请调整开始/结束周，否则两门课会叠在一起
        </p>

        <label>标记颜色</label>
        <div class="colors">
          <button
            v-for="color in PALETTE"
            :key="color"
            class="swatch"
            :style="{ background: color }"
            :class="{ picked: form.color === color }"
            @click="form.color = color"
          ></button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>

        <div class="actions">
          <button v-if="editingId" class="btn btn-danger" @click="remove">删除课程</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
        <p v-if="editingId" class="cell-add-hint">
          同一格子可以放不同周次的课（如 1-6 周上 A、7-16 周上 B）
          <button class="btn btn-ghost" @click="addAnotherInCell">＋ 在此格添加另一门课</button>
        </p>
      </div>
    </Modal>

    <Modal :open="showCourseManager" title="课程批量管理" wide @close="showCourseManager = false">
      <div class="course-manager">
        <section class="manager-section">
          <div class="manager-head">
            <div>
              <h4>当前课程</h4>
              <span>共 {{ courses.length }} 门，已选择 {{ selectedCourses.length }} 门</span>
            </div>
            <div class="manager-actions">
              <button class="btn btn-ghost" :disabled="!courses.length" @click="toggleAllCourses">
                {{ allCoursesSelected ? '取消全选' : '全选' }}
              </button>
              <button class="btn btn-ghost" :disabled="!selectedCourses.length" @click="duplicateSelectedCourses">
                创建副本
              </button>
              <button class="btn btn-danger" :disabled="!selectedCourses.length" @click="deleteSelectedCourses">
                删除选中
              </button>
            </div>
          </div>

          <div v-if="courses.length" class="manager-table-scroll">
            <table class="manager-table">
              <thead>
                <tr><th></th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>地点</th><th>教师</th></tr>
              </thead>
              <tbody>
                <tr v-for="course in courses" :key="course.id" :class="{ selected: selectedCourseIds.includes(course.id) }">
                  <td>
                    <input
                      type="checkbox"
                      :checked="selectedCourseIds.includes(course.id)"
                      :aria-label="`选择课程 ${course.name}`"
                      @change="toggleCourseSelection(course.id)"
                    />
                  </td>
                  <td><b>{{ course.name }}</b></td>
                  <td>{{ DAYS[course.day] }}</td>
                  <td>{{ coursePeriodText(course) }}</td>
                  <td>{{ weekLabel(course) }}</td>
                  <td>{{ course.room || '—' }}</td>
                  <td>{{ course.teacher || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="manager-empty">当前还没有课程，可以批量录入或从下方模板导入。</p>

          <div class="clear-row">
            <span>清空前建议先保存课表模板或导出完整备份。</span>
            <button class="btn btn-danger" :disabled="!courses.length" @click="clearCurrentSchedule">清空全部课程</button>
          </div>
        </section>

        <section class="manager-section template-section">
          <div class="manager-head">
            <div>
              <h4>学期课表模板</h4>
              <span>保存当前整张课表，新学期可一键重新导入。</span>
            </div>
          </div>

          <div class="template-save">
            <input v-model="templateName" placeholder="例如：2026 秋季学期" @input="managerError = ''" />
            <button class="btn btn-primary" @click="saveCourseTemplate">保存当前课表</button>
          </div>

          <div v-if="courseTemplates.length" class="template-list">
            <div v-for="template in courseTemplates" :key="template.id" class="template-item">
              <div>
                <b>{{ template.name }}</b>
                <span>{{ template.courses.length }} 门课程 · {{ templateDate(template.createdAt) }}</span>
              </div>
              <div>
                <button class="btn btn-ghost" @click="importCourseTemplate(template)">导入</button>
                <button class="template-delete" aria-label="删除模板" @click="deleteCourseTemplate(template)">✕</button>
              </div>
            </div>
          </div>
          <p v-else class="manager-empty compact">还没有保存过学期课表模板。</p>
        </section>

        <p v-if="managerMessage" class="manager-success">{{ managerMessage }}</p>
        <p v-if="managerError" class="error">{{ managerError }}</p>
      </div>
    </Modal>

    <Modal :open="showBatch" title="批量录入课程" wide @close="showBatch = false">
      <div class="batch-import">
        <div class="batch-help">
          <b>从 Excel、WPS 或表格中复制后直接粘贴</b>
          <span>每行依次为：课程名称、星期、节次、周次、类型、地点、教师。前四列必填，列之间用制表符或逗号分隔。</span>
        </div>

        <div class="batch-columns" aria-hidden="true">
          <span>课程名称</span><span>星期</span><span>节次</span><span>周次</span>
          <span>每周/单周/双周</span><span>地点</span><span>教师</span>
        </div>

        <textarea
          v-model="batchText"
          rows="7"
          placeholder="高等数学, 周一, 1-2, 1-16, 每周, A201, 张老师&#10;大学英语, 周三, 3-4, 1-16, 单周, B305, 李老师"
          @input="batchError = ''"
        ></textarea>

        <div v-if="batchRows.length" class="batch-preview-wrap">
          <div class="batch-summary">
            <b>导入预览</b>
            <span class="ok-text">{{ validBatchCount }} 行可导入</span>
            <span v-if="invalidBatchCount" class="error-text">{{ invalidBatchCount }} 行需修改</span>
          </div>
          <div class="batch-table-scroll">
            <table class="batch-table">
              <thead>
                <tr>
                  <th>行</th><th>课程</th><th>星期</th><th>节次</th><th>周次</th><th>类型</th><th>地点</th><th>教师</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="row in batchRows" :key="row.sourceIndex">
                  <tr :class="{ invalid: row.error }">
                    <td>{{ row.sourceIndex }}</td>
                    <td>{{ row.data?.name || row.cells[0] || '—' }}</td>
                    <td>{{ row.data ? DAYS[row.data.day] : row.cells[1] || '—' }}</td>
                    <td>{{ row.data ? coursePeriodText(row.data) : row.cells[2] || '—' }}</td>
                    <td>{{ row.data ? `${row.data.startWeek}-${row.data.endWeek}` : row.cells[3] || '—' }}</td>
                    <td>{{ row.data ? ({ all: '每周', odd: '单周', even: '双周' }[row.data.weekType]) : row.cells[4] || '—' }}</td>
                    <td>{{ row.data?.room || row.cells[5] || '—' }}</td>
                    <td>{{ row.data?.teacher || row.cells[6] || '—' }}</td>
                  </tr>
                  <tr v-if="row.error" class="batch-error-row">
                    <td></td><td colspan="7">{{ row.error }}</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <p v-if="batchError" class="error">{{ batchError }}</p>
        <div class="actions">
          <button class="btn btn-ghost" @click="batchText = ''">清空</button>
          <button class="btn btn-primary" :disabled="!validBatchCount || invalidBatchCount" @click="importBatch">
            导入 {{ validBatchCount }} 门课程
          </button>
        </div>
      </div>
    </Modal>

    <Modal :open="showSemester" title="📅 学期设置" @close="showSemester = false">
      <div class="form">
        <label>本学期第一周的周一日期 *</label>
        <input v-model="semStart" type="date" />
        <p class="muted-tip">
          设置后自动计算当前周次。例如 9月1日开学（周一），今天若在开学后第 3 周内，则显示「第 3 周」。
          <template v-if="semesterPreview()">
            当前设置下今天是<b> 第 {{ semesterPreview() }} 周</b>。
          </template>
        </p>
        <div class="actions">
          <button class="btn btn-primary" @click="saveSemester">保存</button>
        </div>
      </div>
    </Modal>

    <Modal :open="showTimeEditor" title="🕐 作息与时间设置" @close="showTimeEditor = false">
      <div class="settings">
        <div class="tab-bar" role="tablist">
          <button
            v-for="(hint, tab) in tabHints"
            :key="tab"
            type="button"
            class="tab-btn"
            :class="{ on: settingsTab === tab }"
            @click="settingsTab = tab"
          >{{ tabLabel(tab) }}</button>
        </div>
        <p class="settings-hint">{{ tabHints[settingsTab] }}</p>
        <p v-if="settingError" class="error">{{ settingError }}</p>

        <section v-show="settingsTab === 'campus'" class="setting-section">
          <div class="setting-head">
            <h4>🏫 校区（{{ timeConfig.campuses.length }}）</h4>
          </div>
          <div v-for="campus in timeConfig.campuses" :key="campus.id" class="setting-row">
            <input
              :value="campus.name"
              @change="renameCampus(campus.id, $event.target.value)"
            />
            <button
              class="setting-del"
              :disabled="timeConfig.campuses.length <= 1"
              title="删除校区"
              @click="onRemoveCampus(campus.id)"
            >✕</button>
          </div>
          <div class="setting-add">
            <input v-model="newCampusName" placeholder="新校区名称，例如：东校区" @keyup.enter="onAddCampus" />
            <button class="btn btn-ghost" @click="onAddCampus">＋ 添加</button>
          </div>
        </section>

        <section v-show="settingsTab === 'season'" class="setting-section">
          <div class="setting-head">
            <h4>☀️ 作息季（{{ timeConfig.seasons.length }}）</h4>
            <span class="setting-note">按起始日期自动切换（晚于今日的最新一季生效）</span>
          </div>
          <div v-for="season in timeConfig.seasons" :key="season.id" class="setting-row season">
            <input
              class="grow"
              :value="season.name"
              @change="renameSeason(season.id, $event.target.value, null)"
            />
            <input
              class="date"
              :value="season.startDate"
              placeholder="05-01"
              @change="renameSeason(season.id, null, $event.target.value)"
            />
            <button
              class="setting-del"
              :disabled="timeConfig.seasons.length <= 1"
              title="删除作息季"
              @click="onRemoveSeason(season.id)"
            >✕</button>
          </div>
          <div class="setting-add">
            <input v-model="newSeasonName" class="grow" placeholder="新作息季名称，例如：春季时间" @keyup.enter="onAddSeason" />
            <input v-model="newSeasonDate" class="date" placeholder="03-01" />
            <button class="btn btn-ghost" @click="onAddSeason">＋ 添加</button>
          </div>
        </section>

        <section v-show="settingsTab === 'period'" class="setting-section">
          <div class="setting-head">
            <h4>📋 节次（{{ timeConfig.periods.length }}）</h4>
            <span class="setting-note">被课程占用的节次无法删除</span>
          </div>
          <div class="period-grid">
            <div v-for="period in timeConfig.periods" :key="period.id" class="setting-row">
              <input
                :value="period.label"
                @change="renamePeriod(period.id, $event.target.value)"
              />
              <button
                class="setting-del"
                :disabled="timeConfig.periods.length <= 1"
                title="删除节次"
                @click="onRemovePeriod(period.id)"
              >✕</button>
            </div>
          </div>
          <div class="setting-add">
            <input v-model="newPeriodLabel" placeholder="新节次名称，例如：第十三节课" @keyup.enter="onAddPeriod" />
            <button class="btn btn-ghost" @click="onAddPeriod">＋ 添加</button>
          </div>
        </section>

        <section v-show="settingsTab === 'times'" class="setting-section">
          <div class="setting-head">
            <h4>⏰ 各时段上下课时间</h4>
          </div>

          <div class="gen-box">
            <div class="gen-title">⚡ 一键生成时间</div>
            <div class="gen-grid">
              <label class="gen-item">
                <span>从</span>
                <select v-model="gen.startId">
                  <option v-for="p in genStartOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
                <span>开始</span>
              </label>
              <label class="gen-item">
                <input v-model="gen.startTime" type="time" />
                <span>上课</span>
              </label>
              <label class="gen-item">
                <span>每节</span>
                <input v-model.number="gen.duration" type="number" min="20" max="90" class="num" />
                <span>分钟</span>
              </label>
              <label class="gen-item">
                <span>节间休息</span>
                <input v-model.number="gen.breakMin" type="number" min="0" max="60" class="num" />
                <span>分钟</span>
              </label>
              <label class="gen-item">
                <span>午休：第</span>
                <select v-model.number="gen.lunchAfterIdx" class="num">
                  <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
                </select>
                <span>后</span>
                <input v-model.number="gen.lunchMin" type="number" min="0" max="300" class="num" />
                <span>分钟（0=不休）</span>
              </label>
              <label class="gen-item">
                <span>晚休：第</span>
                <select v-model.number="gen.dinnerAfterIdx" class="num">
                  <option v-for="(p, i) in genAfterOptions" :key="p.id" :value="i" :disabled="i >= timeConfig.periods.length - 1">{{ p.label }}</option>
                </select>
                <span>后</span>
                <input v-model.number="gen.dinnerMin" type="number" min="0" max="300" class="num" />
                <span>分钟（0=不休）</span>
              </label>
            </div>
            <div class="gen-scope">
              <label><input v-model="gen.allSeasons" type="checkbox" /> 应用到所有作息季</label>
              <label><input v-model="gen.allCampuses" type="checkbox" /> 应用到所有校区</label>
              <button class="btn btn-primary" @click="generateTimes">⚡ 生成</button>
            </div>
            <p class="gen-tip">不勾选时只生成当前「{{ seasonName(currentSeasonId()) }} × {{ campusName(currentCampusId()) }}」组合；早自习等特殊节次可先从它之后生成，再单独手调。</p>
          </div>

          <div class="time-table-wrap">
            <table class="time-table">
              <thead>
                <tr>
                  <th rowspan="2" class="pl-h">节次</th>
                  <th v-for="season in timeConfig.seasons" :key="season.id" :colspan="timeConfig.campuses.length">
                    {{ season.name }}（{{ season.startDate }} 起）
                  </th>
                </tr>
                <tr>
                  <th v-for="combo in combos" :key="combo.season + combo.campus">{{ combo.campusName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(period, pi) in timeConfig.periods" :key="period.id">
                  <td class="pl">{{ period.label }}</td>
                  <td v-for="combo in combos" :key="combo.season + combo.campus" class="tc">
                    <input
                      type="time"
                      v-model="timeConfig.times[combo.season][combo.campus][pi].start"
                    />
                    <span class="dash">-</span>
                    <input
                      type="time"
                      v-model="timeConfig.times[combo.season][combo.campus][pi].end"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="actions">
          <button class="btn btn-ghost" @click="onResetTimes">恢复默认时间</button>
          <button class="btn btn-primary" @click="showTimeEditor = false">完成</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head h2 {
  font-size: 22px;
}
.head-btns {
  display: flex;
  gap: 10px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.seg-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seg-label {
  font-size: 13px;
  color: var(--muted);
}
.seg {
  display: flex;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 3px;
}
.seg button {
  border: none;
  background: transparent;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--muted);
}
.seg button:disabled {
  opacity: 0.35;
  cursor: default;
}
.seg button.on {
  background: var(--primary);
  color: #fff;
  font-weight: 600;
}
.seg button.wn {
  min-width: 84px;
  font-weight: 700;
  color: var(--text);
}
.seg button.wn.thisweek {
  color: var(--primary);
}
.add-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.warn-banner {
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
}

.timetable-wrap {
  overflow-x: auto;
  padding: 16px;
}
.timetable {
  display: grid;
  grid-template-columns: 84px repeat(7, minmax(96px, 1fr));
  gap: 5px;
  min-width: 820px;
}
.corner {
  grid-column: 1;
  grid-row: 1;
}
.tt-head {
  grid-row: 1;
  text-align: center;
  padding: 8px 0;
  font-weight: 600;
  color: var(--muted);
  border-radius: 8px;
}
.tt-head.today {
  background: var(--primary-soft);
  color: var(--primary);
}
.today-tag {
  margin-left: 4px;
  font-size: 11px;
  background: var(--primary);
  color: #fff;
  padding: 1px 6px;
  border-radius: 999px;
  vertical-align: 2px;
}
.tt-period {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
  padding: 2px;
}
.tt-period b {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
}
.tt-cell {
  background: #fafbfd;
  border: 1px dashed var(--border);
  border-radius: 8px;
  min-height: 48px;
  cursor: pointer;
  transition: background 0.15s;
}
.tt-cell:hover {
  background: var(--primary-soft);
}
.tt-cell.isToday {
  background: #f6f9ff;
}
.course {
  z-index: 2;
  margin: 2px;
  padding: 6px 8px;
  border-radius: 8px;
  border-left: 4px solid;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1px;
  transition: transform 0.1s;
}
.course:hover {
  transform: scale(1.02);
}
.course.conflict {
  outline: 2px dashed var(--danger);
  outline-offset: -2px;
}
.c-name {
  font-size: 13px;
  font-weight: 600;
}
.c-week {
  font-size: 10px;
  color: var(--primary);
  font-weight: 600;
}
.c-sub {
  font-size: 11px;
  color: var(--muted);
}
.tip {
  color: var(--muted);
  font-size: 13px;
}

/* ---------- 课表皮肤 ---------- */
.skin-notebook {
  border-color: #ddcfab;
  background:
    linear-gradient(90deg, transparent 58px, rgba(218, 94, 94, 0.22) 59px, transparent 60px),
    repeating-linear-gradient(#fffdf7 0 31px, #dce7ef 32px);
  box-shadow: 0 10px 28px rgba(108, 83, 35, 0.09);
}
.skin-notebook .tt-head {
  color: #735f39;
  font-family: 'KaiTi', 'STKaiti', serif;
}
.skin-notebook .tt-cell {
  border-color: rgba(155, 128, 78, 0.32);
  background: rgba(255, 253, 247, 0.52);
}
.skin-notebook .tt-period b,
.skin-notebook .course {
  font-family: 'KaiTi', 'STKaiti', serif;
}
.skin-notebook .course {
  border-left-width: 3px;
  border-radius: 5px 12px 7px 10px;
  box-shadow: 1px 2px 5px rgba(89, 68, 31, 0.1);
}
.skin-timeline {
  border: none;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: none;
}
.skin-timeline .timetable {
  gap: 2px 8px;
}
.skin-timeline .tt-head {
  border-bottom: 2px solid var(--border);
  border-radius: 0;
}
.skin-timeline .tt-cell {
  min-height: 54px;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
}
.skin-timeline .tt-cell.isToday {
  background: color-mix(in srgb, var(--primary) 5%, transparent);
}
.skin-timeline .tt-period {
  padding-right: 9px;
  border-right: 2px solid var(--border);
}
.skin-timeline .course {
  margin: 4px 2px;
  border-left-width: 3px;
  border-radius: 6px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form label {
  font-size: 13px;
  color: var(--muted);
  margin-top: 6px;
}
.form input,
.form select {
  width: 100%;
}
.row {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
.row > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.colors {
  display: flex;
  gap: 8px;
  margin: 4px 0;
}
.swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid transparent;
}
.swatch.picked {
  border-color: var(--text);
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.muted-tip {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  background: var(--bg);
  border-radius: 8px;
  padding: 10px 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.actions .btn-danger {
  margin-right: auto;
}

.time-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.time-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
  min-width: 480px;
}
.time-table th,
.time-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: center;
}
.time-table thead th {
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}
.pl-h,
.pl {
  background: #fafbfd;
  white-space: nowrap;
  font-weight: 600;
}
.tc {
  white-space: nowrap;
}
.tc input[type='time'] {
  width: 86px;
  padding: 4px 4px;
  font-size: 12px;
  border-radius: 6px;
}
.dash {
  color: var(--muted);
  margin: 0 2px;
}

.course-manager {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.manager-section {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
}
.manager-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
}
.manager-head h4 {
  font-size: 14px;
}
.manager-head span {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
}
.manager-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.manager-actions .btn,
.clear-row .btn,
.template-item .btn {
  padding: 7px 11px;
  font-size: 12px;
}
.manager-table-scroll {
  max-height: 280px;
  overflow: auto;
}
.manager-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.manager-table th,
.manager-table td {
  padding: 9px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.manager-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: #fff;
}
.manager-table tr.selected td {
  background: var(--primary-soft);
}
.manager-table input {
  accent-color: var(--primary);
}
.manager-empty {
  padding: 30px 14px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}
.manager-empty.compact {
  padding: 18px 14px;
}
.clear-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  color: var(--muted);
  font-size: 11px;
  background: #fffafa;
}
.template-save {
  display: flex;
  gap: 8px;
  padding: 12px 14px;
}
.template-save input {
  flex: 1;
  min-width: 0;
}
.template-list {
  border-top: 1px solid var(--border);
}
.template-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.template-item:last-child {
  border-bottom: none;
}
.template-item > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.template-item span {
  color: var(--muted);
  font-size: 11px;
}
.template-item > div:last-child {
  display: flex;
  align-items: center;
  gap: 6px;
}
.template-delete {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--muted);
  border: none;
  border-radius: 7px;
  background: transparent;
}
.template-delete:hover {
  color: var(--danger);
  background: #feecec;
}
.manager-success {
  color: #07805d;
  font-size: 13px;
}

.batch-import {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.batch-help {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  border-radius: 10px;
  background: var(--primary-soft);
}
.batch-help b {
  color: var(--text);
}
.batch-columns {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, 0.7fr) 1fr 0.9fr 0.9fr;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}
.batch-columns span {
  padding: 5px 4px;
  border-radius: 6px;
  background: var(--bg);
}
.batch-import textarea {
  width: 100%;
  min-height: 148px;
  resize: vertical;
  line-height: 1.6;
}
.batch-preview-wrap {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.batch-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
}
.ok-text {
  color: #07805d;
}
.error-text {
  color: var(--danger);
}
.batch-table-scroll {
  max-height: 260px;
  overflow: auto;
}
.batch-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
}
.batch-table th,
.batch-table td {
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
}
.batch-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  background: #fff;
}
.batch-table tr.invalid td {
  color: var(--danger);
  background: #fff7f7;
}
.batch-error-row td {
  padding-top: 2px;
  color: var(--danger);
  background: #fff7f7;
}

@media (max-width: 760px) {
  .head {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .head-btns {
    width: 100%;
    flex-wrap: wrap;
  }

  .head-btns .btn {
    flex: 1;
    padding-inline: 12px;
  }

  .toolbar {
    align-items: flex-start;
    gap: 12px;
  }

  .seg-group {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .add-actions {
    width: 100%;
    margin-left: 0;
  }

  .add-actions .btn {
    flex: 1;
  }

  .timetable-wrap {
    padding: 10px;
  }

  .tip {
    line-height: 1.6;
  }

  .manager-head,
  .clear-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .manager-actions,
  .manager-actions .btn,
  .clear-row .btn {
    width: 100%;
  }

  .template-save {
    flex-direction: column;
  }
}

@media (max-width: 520px) {
  .head h2 {
    font-size: 20px;
  }

  .row {
    flex-direction: column;
  }

  .colors {
    flex-wrap: wrap;
  }

  .warn-banner {
    line-height: 1.55;
  }
}

/* ---------- 作息与时间设置 ---------- */
.settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.settings-hint {
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  border-radius: 8px;
  background: var(--bg);
}
.setting-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setting-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.setting-head h4 {
  font-size: 14px;
}
.setting-note {
  color: var(--muted);
  font-size: 11px;
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-row input {
  flex: 1;
  min-width: 0;
}
.setting-row input.date {
  flex: 0 0 90px;
  text-align: center;
}
.setting-del {
  flex: 0 0 30px;
  height: 30px;
  color: var(--muted);
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
}
.setting-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
.setting-del:disabled {
  opacity: 0.35;
  cursor: default;
}
.setting-add {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.setting-add input {
  flex: 1;
  min-width: 0;
}
.setting-add input.date {
  flex: 0 0 90px;
  text-align: center;
}
.period-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
/* ---------- 一键生成时间 ---------- */
.gen-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  background: #fafbfd;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
}
.gen-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.gen-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}
.gen-item input,
.gen-item select {
  padding: 5px 7px;
  font-size: 12px;
  border-radius: 6px;
}
.gen-item .num {
  width: 62px;
}
.gen-item input[type='time'] {
  width: 96px;
}
.gen-scope {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.gen-scope label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text);
}
.gen-scope .btn {
  margin-left: auto;
  padding: 7px 16px;
}
.gen-tip {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.cell-add-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  border-radius: 8px;
  background: var(--bg);
}
.cell-add-hint .btn {
  flex: 0 0 auto;
  padding: 7px 12px;
  font-size: 12px;
}
/* ---------- 设置弹窗标签页 ---------- */
.tab-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
}
.tab-btn.on {
  color: #fff;
  font-weight: 700;
  border-color: var(--primary);
  background: var(--primary);
}
.cell-existing {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.ce-label {
  color: var(--muted);
  font-size: 12px;
}
.cell-chip {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  border-radius: 6px;
  background: var(--primary-soft);
}
.cell-chip.clash {
  color: var(--danger);
  background: #feecec;
}
</style>
