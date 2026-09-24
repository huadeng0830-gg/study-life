<script setup>
import { computed, nextTick, ref } from 'vue'
import { timeConfig, currentTimes, periodLabelById } from '../../composables/store/timeConfig.js'
import { weekLabel } from '../../composables/store/schedule.js'
import { useScheduleGrid } from '../../composables/schedule/useScheduleGrid.js'

const props = defineProps({
  courses: { type: Array, required: true },
  viewWeek: { type: Number, required: true },
  mobileView: { type: String, required: true },
  mobileDay: { type: Number, required: true },
  currentWeek: { type: Number, required: true },
  currentDayIndex: { type: Number, required: true },
  focusedCourseId: { type: [String, Number], default: '' },
  appearance: { type: Object, required: true },
})

const emit = defineEmits(['open-add', 'open-edit', 'week-change', 'mobile-day-change'])
const todayIdx = computed(() => props.currentDayIndex)

const {
  DAYS,
  viewDates,
  viewExceptions,
  visibleCourses,
  mobileDate,
  mobileCourses,
  mobileDayLabel,
  conflictIds,
  conflictCount,
} = useScheduleGrid(
  computed(() => props.courses),
  computed(() => props.viewWeek),
  computed(() => props.mobileView),
  computed(() => props.mobileDay),
)

function exceptionLabel(item) {
  if (!item) return ''
  if (item.type === 'makeup') {
    const day = DAYS[item.sourceDay] ?? '课'
    return item.sourceWeek ? `补${item.sourceWeek}周${day}` : `补${day}`
  }
  return '放假'
}

function courseInstanceKey(course) {
  return `${course.id}-${course.displayDay ?? course.day}`
}

// `currentTimes` 每次调用都要解析当前作息季（含冲突扫描与排序），
// `periodIndex` 每次线性扫描节次表；在此按一次渲染缓存，避免时间轴每列、
// 每门课程都重复解析与扫描。
const timesForSchedule = computed(() => currentTimes())
const periodIndexMap = computed(() => {
  const map = new Map()
  timeConfig.value.periods.forEach((period, index) => map.set(period.id, index))
  return map
})

function courseTimeRange(course) {
  const ts = timesForSchedule.value
  const si = periodIndexMap.value.get(course.start) ?? -1
  const ei = periodIndexMap.value.get(course.end) ?? -1
  if (si < 0 || ei < 0 || !ts[si] || !ts[ei]) return ''
  return `${ts[si].start} - ${ts[ei].end}`
}

function periodRangeText(id) {
  const ts = timesForSchedule.value
  const index = periodIndexMap.value.get(id) ?? -1
  const row = ts[index]
  return row ? `${row.start}-${row.end}` : ''
}

function coursePeriodText(course) {
  const start = periodLabelById(course.start)
  const end = periodLabelById(course.end)
  return course.start === course.end ? start : `${start}至${end}`
}

function openAdd(day, period) {
  emit('open-add', day, period)
}

function openEdit(course) {
  emit('open-edit', course)
}

function viewWeekText(week) {
  return week < 1 ? '开学前' : `第 ${week} 周`
}

/* ---------- 桌面网格的 roving tabindex（第四十一轮） ----------
 *
 * 7 × 节次数 个空格（12 节的学期周就是 84 个）**全都**做成 Tab 停靠点，会让键盘用户
 * 按几十次 Tab 才能穿过课表，比不给还糟。正确形态是 roving tabindex：整个网格只有
 * **一个** Tab 停靠点，进入网格后改用方向键在格子间移动（这也是 ARIA 里网格类控件的
 * 标准做法）。所以这里有三个不变量：
 *   1. 任何时候**恰好一格** `tabindex="0"`，其余 `-1`；
 *   2. 方向键在网格内移动（到边**夹住**不绕回），Home/End 到本周首尾；
 *   3. 回车/空格与点击等价 —— 都是「按这一格预填日期与节次」。
 * 容器带 `role="group"` + aria-label，一是让整块网格有可访问名称，二是让
 * `tabOrderAndNames` 的 roving 判据认得这是一个"组内留了停靠点"的正常形态。
 *
 * 焦点可见性不用额外写 CSS：全站焦点环的判据里有 `[tabindex]:focus-visible`
 * （见 style.css），格子正因为带 tabindex 才自动获得实色 outline + 对比光环。
 */
const gridEl = ref(null)
/** 当前格：初始落在"今天"那一列（不在当前周就落在周一）。 */
const activeCell = ref({
  day: props.currentDayIndex >= 0 && props.currentDayIndex < 7 ? props.currentDayIndex : 0,
  periodIndex: 0,
})

function isActiveCell(day, periodIndex) {
  return activeCell.value.day === day && activeCell.value.periodIndex === periodIndex
}

function selectCell(day, periodIndex) {
  activeCell.value = { day, periodIndex }
}

/** 把 DOM 焦点挪到目标格。改的是状态，焦点得自己搬（roving 的常规做法）。 */
async function focusCell(day, periodIndex) {
  await nextTick()
  const cell = gridEl.value?.querySelector(`[data-cell="${day}-${periodIndex}"]`)
  if (cell && typeof cell.focus === 'function') cell.focus()
}

function cellLabel(day, period) {
  return `${DAYS[day] ?? ''} ${period.label ?? ''} ${periodRangeText(period.id)}，添加课程`.replace(/\s+/g, ' ').trim()
}

function onCellClick(day, period) {
  selectCell(day, timeConfig.value.periods.indexOf(period))
  openAdd(day, period.id)
}

async function onCellKeydown(event, day, periodIndex) {
  const periods = timeConfig.value.periods
  const last = periods.length - 1
  let next = null
  switch (event.key) {
    case 'ArrowRight': next = { day: Math.min(6, day + 1), periodIndex }; break
    case 'ArrowLeft': next = { day: Math.max(0, day - 1), periodIndex }; break
    case 'ArrowDown': next = { day, periodIndex: Math.min(last, periodIndex + 1) }; break
    case 'ArrowUp': next = { day, periodIndex: Math.max(0, periodIndex - 1) }; break
    case 'Home': next = { day: 0, periodIndex }; break
    case 'End': next = { day: 6, periodIndex }; break
    case 'Enter':
    case ' ':
      // 与点击等价：按这一格预填
      event.preventDefault()
      selectCell(day, periodIndex)
      openAdd(day, periods[periodIndex]?.id)
      return
    default:
      return
  }
  // 方向键的默认行为是滚动页面；Home/End 会滚动到页首页尾，都得拦掉
  event.preventDefault()
  selectCell(next.day, next.periodIndex)
  await focusCell(next.day, next.periodIndex)
}
</script>

<template>
  <div class="page">
    <!-- Mobile Day View -->
    <section v-if="mobileView === 'day'" class="card mobile-day-view" :class="`skin-${appearance.scheduleSkin}`">
      <div class="mobile-day-head">
        <button class="day-nav" :disabled="mobileDay === 0" aria-label="前一天" @click="emit('mobile-day-change', -1)">‹</button>
        <div>
          <strong>{{ mobileDayLabel }}</strong>
          <span v-if="mobileDay === todayIdx && viewWeek === currentWeek" class="mobile-today-mark">今天</span>
          <small v-if="viewExceptions[mobileDay]">{{ exceptionLabel(viewExceptions[mobileDay]) }}</small>
        </div>
        <button class="day-nav" :disabled="mobileDay === 6" aria-label="后一天" @click="emit('mobile-day-change', 1)">›</button>
      </div>
      <div v-if="!mobileCourses.length" class="mobile-day-empty">
        <span>今天没有课程</span>
        <button class="btn btn-ghost" @click="openAdd(mobileDay, timeConfig.periods[0]?.id)">添加课程</button>
      </div>
      <div v-else class="mobile-course-list">
        <button
          v-for="course in mobileCourses"
          :key="courseInstanceKey(course)"
          class="mobile-course-row"
          :class="{ 'focus-target-highlight': String(props.focusedCourseId) === String(course.id) }"
          :data-focus-id="course.id"
          :data-focus-type="'course'"
          :data-focus-date="mobileDate"
          :style="{ '--course-color': course.color }"
          type="button"
          @click="openEdit(course)"
        >
          <span class="mobile-course-time">{{ courseTimeRange(course) || coursePeriodText(course) }}</span>
          <span class="mobile-course-main"><b>{{ course.name }}</b><small>{{ course.room || '未设置地点' }}<template v-if="course.teacher"> · {{ course.teacher }}</template></small></span>
          <span class="mobile-course-arrow">›</span>
        </button>
      </div>
    </section>

    <!-- Desktop Week View -->
    <div v-else class="card timetable-wrap" :class="`skin-${appearance.scheduleSkin}`">
      <div v-if="conflictIds.size > 0" class="warn-banner">
          ⚠️ {{ viewWeekText(viewWeek) }}有 {{ conflictCount }} 组课程时间冲突（红框标出），请检查周次设置
      </div>

      <div class="timetable" ref="gridEl" role="group" aria-label="课程表网格：方向键在格子间移动，回车或空格按这一格添加课程">
        <div class="corner"></div>
        <div
          v-for="(d, i) in DAYS"
          :key="d"
          class="tt-head"
          :class="{ today: i === todayIdx && viewWeek === currentWeek }"
        >
          {{ d }}<span v-if="i === todayIdx && viewWeek === currentWeek" class="today-tag">今天</span><span v-if="viewExceptions[i]" class="exception-tag" :class="viewExceptions[i].type">{{ exceptionLabel(viewExceptions[i]) }}</span>
        </div>

        <template v-for="(row, ri) in timeConfig.periods" :key="row.id">
          <div class="tt-period" :style="{ gridRow: ri + 2 }">
            <b>{{ row.label }}</b>
            <span>{{ periodRangeText(row.id) }}</span>
          </div>
          <!-- 空格是 roving tabindex 的网格：整个表只有一个 Tab 停靠点，
               其余格 `-1`，进入后用方向键移动（见 script 里的说明）。
               不给它「全部可 Tab」是有意的 —— 84 个格子逐个 Tab 过去比现在更糟。 -->
          <div
            v-for="(d, i) in DAYS"
            :key="d + row.id"
            class="tt-cell"
            :class="{ isToday: i === todayIdx && viewWeek === currentWeek }"
            :style="{ gridColumn: i + 2, gridRow: ri + 2 }"
            :data-cell="`${i}-${ri}`"
            role="button"
            :tabindex="isActiveCell(i, ri) ? 0 : -1"
            :aria-label="cellLabel(i, row)"
            @click="onCellClick(i, row)"
            @keydown="onCellKeydown($event, i, ri)"
          ></div>
        </template>

        <!-- 桌面周视图的课程块是「编辑这门课」最直接的入口。原先只有 @click：
             键盘用户要编辑课程得先「更多设置 → 显示 → 切换单日视图」，等单日视图那一支的
             <button> 渲染出来才够得到——路走得通，但主入口对键盘是关着的。
             所以补上 role/tabindex/键击三件套，和移动端课程行、账本页的列表行保持同一种做法。
             不加 aria-label：块内的「课名 + 周次 + 地点」本身就是可访问名称，加显式 label
             反而会把这几项信息覆盖掉。 -->
        <div
          v-for="c in visibleCourses"
          :key="courseInstanceKey(c)"
          class="course"
          :class="{ conflict: conflictIds.has(courseInstanceKey(c)), 'focus-target-highlight': String(props.focusedCourseId) === String(c.id) }"
          :data-focus-id="c.id"
          :data-focus-type="'course'"
          :data-focus-date="viewDates[c.displayDay]"
          :style="{
            gridColumn: c.displayDay + 2,
            gridRow: `${(periodIndexMap.get(c.start) ?? -1) + 2} / ${(periodIndexMap.get(c.end) ?? -1) + 3}`,
            background: c.color + '18',
            borderLeftColor: c.color,
          }"
          role="button"
          tabindex="0"
          @keydown.enter.prevent="openEdit(c)"
          @keydown.space.prevent="openEdit(c)"
          @click="openEdit(c)"
        >
          <span class="c-name">{{ c.name }}</span>
          <span class="c-week">{{ weekLabel(c) }}</span>
          <span v-if="c.room" class="c-sub">@{{ c.room }}</span>
        </div>
      </div>
    </div>

    <p class="tip">
      💡 正在查看：{{ timeConfig.campuses.find(c => c.id === timeConfig.currentCampus)?.name || '' }} ·
      {{ timeConfig.seasons.find(s => s.id === timeConfig.currentSeason)?.name || '' }}<template v-if="timeConfig.seasons.length > 1 && timeConfig.autoSeason">（自动）</template> ·
      {{ viewWeekText(viewWeek) }}的课程；
      点击空白格子或**聚焦后用方向键选中再回车**都能快速添加，点击课程卡片可编辑
    </p>
  </div>
</template>

<style scoped>
.mobile-day-view {
  border-radius: 14px;
  overflow: hidden;
}
.mobile-day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.mobile-day-head > div {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  text-align: center;
}
.mobile-day-head strong { font-size: 16px; }
.mobile-day-head small { width: 100%; color: var(--danger); font-size: 11px; }
.mobile-today-mark { padding: 2px 7px; color: var(--primary); font-size: 10px; font-weight: 800; border-radius: 999px; background: var(--primary-soft); }
.day-nav { display: grid; place-items: center; width: 44px; height: 44px; color: var(--primary); font-size: 25px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.day-nav:disabled { color: var(--ink-faint); opacity: .45; }
.mobile-course-list { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.mobile-course-row {
  position: relative;
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 10px;
  min-height: 68px;
  padding: 10px 8px 10px 12px;
  color: var(--text);
  text-align: left;
  border: 1px solid var(--border);
  border-left: 4px solid var(--course-color);
  border-radius: 10px;
  background: var(--bg-tint);
}
.mobile-course-row:active { background: var(--primary-soft); }
.mobile-course-time { color: var(--ink-soft); font-size: 11px; font-weight: 700; line-height: 1.4; }
.mobile-course-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mobile-course-main b { overflow: hidden; font-size: 14px; line-height: 1.35; }
.mobile-course-main small { overflow: hidden; color: var(--ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.mobile-course-arrow { color: var(--ink-faint); font-size: 24px; text-align: center; }
.mobile-day-empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 24px 4px 6px; color: var(--ink-soft); font-size: 13px; }

.timetable-wrap { overflow-x: auto; padding: 16px; }
.timetable {
  display: grid;
  grid-template-columns: 84px repeat(7, minmax(96px, 1fr));
  gap: 5px;
  min-width: 820px;
}
.corner { grid-column: 1; grid-row: 1; }
.tt-head {
  grid-row: 1;
  text-align: center;
  padding: 8px 0;
  font-weight: 600;
  color: var(--muted);
  border-radius: 8px;
}
.tt-head.today { background: var(--primary-soft); color: var(--primary); }
.today-tag { margin-left: 4px; font-size: 11px; background: var(--primary); color: var(--on-primary, #fff); padding: 1px 6px; border-radius: 999px; vertical-align: 2px; }
.exception-tag { display: block; width: fit-content; margin: 3px auto 0; padding: 1px 5px; color: #b13f3f; font-size: 9px; font-weight: 800; border-radius: 5px; background: #feecec; }
.exception-tag.makeup { color: #6b3fd4; background: #f1ebff; }
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
.tt-period b { font-size: 12px; color: var(--text); white-space: nowrap; }
.tt-cell {
  background: var(--bg-tint);
  border: 1px dashed var(--border);
  border-radius: 8px;
  min-height: 48px;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.tt-cell:hover { background: var(--primary-soft); }
.tt-cell.isToday { background: #f6f9ff; }
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
  transition: transform var(--dur-instant) var(--ease-standard);
}
.course:hover { transform: scale(1.02); }
.course.conflict { outline: 2px dashed var(--danger); outline-offset: -2px; }
.c-name { font-size: 13px; font-weight: 600; }
.c-week { font-size: 10px; color: var(--primary); font-weight: 600; }
.c-sub { font-size: 11px; color: var(--muted); }
.tip { color: var(--muted); font-size: 13px; }

/* Skin variants */
.skin-notebook {
  border-color: #ddcfab;
  background:
    linear-gradient(90deg, transparent 58px, rgba(218, 94, 94, 0.22) 59px, transparent 60px),
    repeating-linear-gradient(#fffdf7 0 31px, #dce7ef 32px);
  box-shadow: 0 10px 28px rgba(108, 83, 35, 0.09);
}
.skin-notebook .tt-head { color: #735f39; font-family: 'KaiTi', 'STKaiti', serif; }
.skin-notebook .tt-cell { border-color: rgba(155, 128, 78, 0.32); background: rgba(255, 253, 247, 0.52); }
.skin-notebook .tt-period b, .skin-notebook .course { font-family: 'KaiTi', 'STKaiti', serif; }
.skin-notebook .course { border-left-width: 3px; border-radius: 5px 12px 7px 10px; box-shadow: 1px 2px 5px rgba(89, 68, 31, 0.1); }
.skin-timeline { border: none; background: rgba(255, 255, 255, 0.9); box-shadow: none; }
.skin-timeline .timetable { gap: 2px 8px; }
.skin-timeline .tt-head { border-bottom: 2px solid var(--border); border-radius: 0; }
.skin-timeline .tt-cell { min-height: 54px; border: none; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; }
.skin-timeline .tt-cell.isToday { background: color-mix(in srgb, var(--primary) 5%, transparent); }
.skin-timeline .tt-period { padding-right: 9px; border-right: 2px solid var(--border); }
.skin-timeline .course { margin: 4px 2px; border-left-width: 3px; border-radius: 6px; }

.warn-banner {
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 14px;
  margin: 0 16px 16px;
}
</style>
