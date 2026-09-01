<script setup>
import { computed } from 'vue'
import { periodIndex, timeConfig, currentTimes, periodLabelById, periodRangeById } from '../../composables/store/timeConfig.js'
import { weekLabel } from '../../composables/store/schedule.js'
import { useScheduleGrid } from '../../composables/schedule/useScheduleGrid.js'

const props = defineProps({
  courses: { type: Array, required: true },
  scheduleExceptions: { type: Array, required: true },
  viewWeek: { type: Number, required: true },
  mobileView: { type: String, required: true },
  mobileDay: { type: Number, required: true },
  currentWeek: { type: Number, required: true },
  appearance: { type: Object, required: true },
})

const emit = defineEmits(['open-add', 'open-edit', 'week-change', 'mobile-day-change'])
const todayIdx = computed(() => {
  const d = new Date().getDay()
  return d === 0 ? 6 : d - 1
})

const {
  DAYS,
  viewExceptions,
  visibleCourses,
  mobileCourses,
  mobileDayLabel,
  conflictIds,
  conflictCount,
} = useScheduleGrid(
  computed(() => props.courses),
  computed(() => props.scheduleExceptions),
  computed(() => props.viewWeek),
  computed(() => props.mobileView),
  computed(() => props.mobileDay),
)

function exceptionLabel(item) {
  if (!item) return ''
  return item.type === 'makeup'
    ? `补${DAYS[item.sourceDay] ?? '课'}`
    : '停课'
}

function courseInstanceKey(course) {
  return `${course.id}-${course.displayDay ?? course.day}`
}

function courseTimeRange(course) {
  const ts = currentTimes()
  const si = periodIndex(course.start)
  const ei = periodIndex(course.end)
  if (si < 0 || ei < 0 || !ts[si] || !ts[ei]) return ''
  return `${ts[si].start} - ${ts[ei].end}`
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

      <div class="timetable">
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
            <span>{{ periodRangeById(row.id) }}</span>
          </div>
          <div
            v-for="(d, i) in DAYS"
            :key="d + row.id"
            class="tt-cell"
            :class="{ isToday: i === todayIdx && viewWeek === currentWeek }"
            :style="{ gridColumn: i + 2, gridRow: ri + 2 }"
            @click="openAdd(i, row.id)"
          ></div>
        </template>

        <div
          v-for="c in visibleCourses"
          :key="courseInstanceKey(c)"
          class="course"
          :class="{ conflict: conflictIds.has(courseInstanceKey(c)) }"
          :style="{
            gridColumn: c.displayDay + 2,
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
      💡 正在查看：{{ timeConfig.campuses.find(c => c.id === timeConfig.currentCampus)?.name || '' }} ·
      {{ timeConfig.seasons.find(s => s.id === timeConfig.currentSeason)?.name || '' }}<template v-if="timeConfig.seasons.length > 1 && timeConfig.autoSeason">（自动）</template> ·
      {{ viewWeekText(viewWeek) }}的课程；
      点击空白格子快速添加，点击课程卡片可编辑
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
.day-nav { display: grid; place-items: center; width: 44px; height: 44px; color: var(--primary); font-size: 25px; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
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
.today-tag { margin-left: 4px; font-size: 11px; background: var(--primary); color: #fff; padding: 1px 6px; border-radius: 999px; vertical-align: 2px; }
.exception-tag { display: block; width: fit-content; margin: 3px auto 0; padding: 1px 5px; color: #b13f3f; font-size: 9px; font-weight: 800; border-radius: 5px; background: #feecec; }
.exception-tag.makeup { color: #7a55e8; background: #f1ebff; }
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
  background: #fafbfd;
  border: 1px dashed var(--border);
  border-radius: 8px;
  min-height: 48px;
  cursor: pointer;
  transition: background 0.15s;
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
  transition: transform 0.1s;
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
