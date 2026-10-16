<script setup lang="ts">
import { computed } from 'vue'
import EmptyState from './EmptyState.vue'
import { coursesForDates } from '../composables/store/schedule.js'
import { currentTimes, courseTimeRange, periodIndex } from '../composables/store/timeConfig.js'
import { appDateTime } from '../composables/timeContext.js'
import { isActiveEntity, isArchived } from '../composables/domain/state.js'
import { courseTiming } from '../composables/courseTime.js'
import { focusLocation } from '../composables/focusNavigation.js'
import type { Course, QuickEvent } from '../types/domain'

interface AgendaItem {
  key: string
  kind: 'course' | 'event'
  kindLabel: string
  title: string
  meta: string
  timeLabel: string
  sortMinute: number
  current: boolean
  to: ReturnType<typeof focusLocation>
}

const props = defineProps<{ courses: Course[]; events: QuickEvent[]; today: string; now: Date }>()

function minuteOfDay(value: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''))
  if (!match) return Number.POSITIVE_INFINITY
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : Number.POSITIVE_INFINITY
}

const items = computed(() => {
  const rows: AgendaItem[] = []
  const todayCourses = coursesForDates(props.courses.filter((course) => !isArchived(course)), [props.today])[0] || []

  for (const course of todayCourses) {
    const times = currentTimes()
    const startTime = times[periodIndex(course.start)]?.start || ''
    const endTime = times[periodIndex(course.end)]?.end || ''
    const startAt = startTime ? appDateTime(props.today, startTime) : NaN
    const endAt = endTime ? appDateTime(props.today, endTime) : NaN
    const timing = courseTiming(startAt, endAt, props.now)
    rows.push({
      key: `course:${course.id}`,
      kind: 'course',
      kindLabel: '课程',
      title: course.name,
      meta: course.room || '',
      timeLabel: startTime && endTime ? `${startTime}–${endTime}` : courseTimeRange(course) || '时间待定',
      sortMinute: minuteOfDay(startTime),
      current: timing.state === 'active',
      to: focusLocation('/schedule', course.id, { date: props.today }),
    })
  }

  for (const event of props.events.filter((item) => isActiveEntity(item) && item.date === props.today)) {
    const time = String(event.time || '').trim()
    rows.push({
      key: `event:${event.id}`,
      kind: 'event',
      kindLabel: '日程',
      title: event.title,
      meta: [event.location, event.courseName].filter(Boolean).join(' · '),
      timeLabel: time ? `${time}${event.endTime ? `–${event.endTime}` : ''}` : '全天',
      sortMinute: time ? minuteOfDay(time) : -1,
      current: false,
      to: focusLocation('/events', event.id),
    })
  }

  return rows.sort((left, right) => left.sortMinute - right.sortMinute || left.kind.localeCompare(right.kind))
})

const summary = computed(() => {
  const courseCount = items.value.filter((item) => item.kind === 'course').length
  const eventCount = items.value.filter((item) => item.kind === 'event').length
  if (!courseCount && !eventCount) return '今天暂无固定安排'
  return [courseCount && `${courseCount} 节课程`, eventCount && `${eventCount} 项日程`].filter(Boolean).join(' · ')
})
</script>

<template>
  <section class="card today-agenda" aria-labelledby="today-agenda-title">
    <header class="agenda-head">
      <div>
        <h2 id="today-agenda-title">今日安排</h2>
        <span class="agenda-summary">{{ summary }}</span>
      </div>
      <RouterLink class="agenda-link" to="/schedule">课程表</RouterLink>
    </header>

    <ul v-if="items.length" class="agenda-list" aria-label="今日课程与日程">
      <li v-for="item in items" :key="item.key" class="agenda-row">
        <RouterLink class="agenda-entry" :class="{ 'is-current': item.current }" :to="item.to">
          <span class="agenda-time">{{ item.timeLabel }}</span>
          <span class="agenda-rail" aria-hidden="true"><span class="agenda-dot"></span></span>
          <span class="agenda-copy">
            <span class="agenda-title">{{ item.title }}</span>
            <span v-if="item.meta" class="agenda-meta">{{ item.meta }}</span>
          </span>
          <span class="agenda-side">
            <span class="agenda-kind">{{ item.kindLabel }}</span>
            <span v-if="item.current" class="agenda-current">进行中</span>
          </span>
        </RouterLink>
      </li>
    </ul>

    <EmptyState v-else compact icon="events" title="今天的时间由你安排" description="课程和日程会按时间出现在这里。" :level="3">
      <RouterLink class="btn btn-outline" to="/events">添加日程</RouterLink>
    </EmptyState>
  </section>
</template>

<style scoped>
.today-agenda { min-width:0; padding:18px; }
.agenda-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:10px; }
.agenda-head > div { min-width:0; }
.agenda-head h2 { margin:0; color:var(--ui-foreground); font-size:var(--fs-15-5); }
.agenda-summary { display:block; margin-top:3px; color:var(--ui-muted-foreground); font-size:var(--fs-11-5); }
.agenda-link { flex:none; color:var(--ui-primary); font-size:var(--fs-12); font-weight:var(--fw-700); text-decoration:none; white-space:nowrap; }
.agenda-link:hover { text-decoration:underline; }
.agenda-list { display:grid; gap:0; margin:0; padding:0; list-style:none; }
.agenda-row + .agenda-row { border-top:1px solid var(--ui-border); }
.agenda-entry {
  display:grid;
  grid-template-columns:minmax(88px, 108px) 10px minmax(0, 1fr) auto;
  align-items:center;
  gap:10px;
  min-height:60px;
  padding:8px 4px;
  border-radius:var(--radius-8);
  color:var(--text);
  text-decoration:none;
  transition:background var(--dur-fast) var(--ease-standard);
}
.agenda-entry:hover { background:var(--bg-tint); }
.agenda-entry:focus-visible { outline:2px solid var(--ui-ring); outline-offset:2px; }
.agenda-entry.is-current { background:color-mix(in srgb, var(--ui-primary) 6%, var(--ui-card)); }
.agenda-time { color:var(--ui-muted-foreground); font-size:var(--fs-12); font-weight:var(--fw-700); font-variant-numeric:tabular-nums; white-space:nowrap; }
.agenda-rail { display:grid; place-items:center; min-height:30px; }
.agenda-dot { width:8px; height:8px; border:2px solid var(--ui-card); border-radius:var(--radius-circle); background:var(--ui-border); box-shadow:0 0 0 1px var(--ui-border); }
.is-current .agenda-dot { background:var(--ui-primary); box-shadow:0 0 0 1px var(--ui-primary); }
.agenda-copy { display:grid; gap:3px; min-width:0; }
.agenda-title { overflow:hidden; color:var(--ui-foreground); font-size:var(--fs-13); font-weight:var(--fw-700); text-overflow:ellipsis; white-space:nowrap; }
.agenda-meta { overflow:hidden; color:var(--ui-muted-foreground); font-size:var(--fs-11-5); text-overflow:ellipsis; white-space:nowrap; }
.agenda-side { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:5px; }
.agenda-kind, .agenda-current { display:inline-flex; align-items:center; min-height:26px; padding:3px 8px; border:1px solid var(--ui-border); border-radius:var(--radius-pill); background:var(--ui-secondary); color:var(--ui-secondary-foreground); font-size:var(--fs-10-5); font-weight:var(--fw-650); white-space:nowrap; }
.agenda-current { border-color:color-mix(in srgb, var(--ui-accent-foreground) 30%, var(--ui-border)); background:var(--ui-accent); color:var(--ui-accent-foreground); }
@media (max-width:520px) {
  .today-agenda { padding:14px; }
  .agenda-entry { grid-template-columns:minmax(72px, 88px) 8px minmax(0, 1fr) auto; gap:7px; min-height:56px; }
  .agenda-time { font-size:var(--fs-11-5); }
  .agenda-side { gap:4px; }
  .agenda-kind, .agenda-current { min-height:24px; padding:2px 6px; font-size:var(--fs-10); }
}
@media (max-width: 900px), (pointer: coarse) and (max-height: 520px) {
  .agenda-head { align-items: center; flex-wrap: wrap; }
  .agenda-link { display: inline-flex; align-items: center; min-height: var(--tap-min); min-width:var(--tap-min); }
  .agenda-entry { grid-template-columns: 8px minmax(0, 1fr); align-items: start; padding-block: 12px; }
  .agenda-time { grid-column: 2; white-space: normal; overflow-wrap: anywhere; }
  .agenda-rail { grid-column: 1; grid-row: 1 / span 2; }
  .agenda-copy { grid-column: 2; }
  .agenda-title, .agenda-meta { white-space: normal; overflow-wrap: anywhere; }
  .agenda-side { grid-column: 2; justify-content: flex-start; }
}
</style>
