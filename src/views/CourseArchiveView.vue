<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import VirtualList from '../components/VirtualList.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived } from '../composables/domain/state.js'
import { clearFocusFromRoute, focusElementWhenReady, focusLocation, readFocusQuery } from '../composables/focusNavigation.js'
import { noteText } from '../composables/notes.js'
import { formatFocusDuration } from '../composables/focusTimer.js'
import { weekLabel } from '../composables/store/schedule.js'
import { periodLabelById } from '../composables/store/timeConfig.js'

const route = useRoute()
const router = useRouter()
const domain = useDomainCommands()
const courseId = computed(() => String(route.query.courseId ?? '').trim())
const course = computed(() => domain.courses.value.find((item) => String(item.id) === courseId.value) ?? null)
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const timelineList = ref(null)

function timelineRowKey(row) {
  return `${row.type}:${row.id}`
}

function dateKey(value) {
  const text = String(value ?? '')
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(text) ? text.slice(0, 10) : ''
}

function belongsToCourse(item, id, name) {
  const linkedId = String(item?.courseId ?? '').trim()
  if (linkedId) return linkedId === id
  return String(item?.course ?? item?.courseName ?? '').trim() === String(name ?? '').trim()
}

const timeline = computed(() => {
  const id = courseId.value
  if (!id) return []
  const name = course.value?.name || ''
  const rows = []
  const taskById = new Map(domain.tasks.value.map((task) => [String(task.id), task]))
  for (const task of domain.tasks.value) {
    if (!belongsToCourse(task, id, name) || task.deletedAt || task.tombstone) continue
    const completed = Boolean(task.done) || task.status === 'completed'
    rows.push({
      id: String(task.id), type: 'task', kind: task.kind === 'homework' ? '作业' : '待办',
      title: task.title || '未命名待办', date: dateKey(task.dueDate) || dateKey(task.completedAt) || dateKey(task.createdAt),
      time: task.dueTime || '', summary: task.note || '',
      status: completed ? '已完成' : task.status === 'in_progress' ? '进行中' : '待处理',
      archived: isArchived(task), path: '/tasks',
    })
  }
  for (const event of domain.events.value) {
    if (!belongsToCourse(event, id, name) || event.deletedAt || event.tombstone) continue
    rows.push({
      id: String(event.id), type: 'event', kind: '日程', title: event.title || '未命名日程',
      date: dateKey(event.date) || dateKey(event.createdAt), time: event.time || '',
      summary: [event.location, event.note].filter(Boolean).join(' · '), status: '', archived: isArchived(event), path: '/',
    })
  }
  for (const note of domain.notes.value) {
    if (!belongsToCourse(note, id, name) || note.deletedAt || note.tombstone) continue
    rows.push({
      id: String(note.id), type: 'note', kind: '笔记', title: note.title || '未命名笔记',
      date: dateKey(note.updatedAt) || dateKey(note.createdAt), time: '', summary: noteText(note),
      status: '', archived: isArchived(note), path: '/notes',
    })
  }
  for (const exam of domain.milestones.value) {
    if (!belongsToCourse(exam, id, name) || exam.deletedAt || exam.tombstone) continue
    rows.push({
      id: String(exam.id), type: 'milestone', kind: exam.kind === 'exam' ? '考试节点' : '重要日期',
      title: exam.name || '未命名重要日期', date: dateKey(exam.date) || dateKey(exam.createdAt), time: exam.time || '',
      summary: [exam.location, Number(exam.reviewProgress) > 0 ? '复习 ' + Number(exam.reviewProgress) + '%' : ''].filter(Boolean).join(' · '),
      status: '', archived: isArchived(exam), path: '/exams',
    })
  }
  for (const session of domain.focusSessions.value) {
    if (String(session.courseId ?? '') !== id || session.deletedAt || session.tombstone) continue
    const task = taskById.get(String(session.todoId ?? ''))
    const seconds = Math.max(0, Number(session.actualFocusSeconds) || 0)
    rows.push({
      id: String(session.sessionId || session.id), type: 'focus', kind: '专注',
      title: session.title || task?.title || '自由专注', date: dateKey(session.startedAt),
      time: String(session.startedAt || '').slice(11, 16), summary: formatFocusDuration(seconds),
      status: session.status === 'completed' ? '完成' : '中止', archived: false, path: '',
    })
  }
  return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || '') || a.kind.localeCompare(b.kind, 'zh-CN'))
})

const stats = computed(() => {
  const result = { tasks: 0, notes: 0, focus: 0, milestones: 0 }
  for (const row of timeline.value) {
    if (row.type === 'task') result.tasks += 1
    else if (row.type === 'note') result.notes += 1
    else if (row.type === 'focus') result.focus += 1
    else if (row.type === 'milestone') result.milestones += 1
  }
  return result
})

const scheduleText = computed(() => {
  if (!course.value) return ''
  const day = DAY_NAMES[Number(course.value.day)] || '未设置星期'
  const start = periodLabelById(course.value.start)
  const end = periodLabelById(course.value.end)
  const periods = start && end ? (course.value.start === course.value.end ? start : start + '–' + end + ' 节') : ''
  return [day, weekLabel(course.value), periods, course.value.room].filter(Boolean).join(' · ')
})

const routeMessage = computed(() => !courseId.value ? '课程链接缺少课程编号。' : !course.value ? '课程可能已删除，关联记录仍会保留在各自页面。' : '')
let focusHandled = ''

async function focusRouteItem() {
  const { id, section } = readFocusQuery(route)
  const key = courseId.value + ':' + section + ':' + id
  if (!id || focusHandled === key) return
  focusHandled = key
  const target = timeline.value.find((row) => row.id === id && (!section || row.type === section))
  if (!target) {
    await clearFocusFromRoute(router, route)
    return
  }
  await nextTick()
  timelineList.value?.scrollToKey(timelineRowKey(target), 'auto')
  await nextTick()
  await focusElementWhenReady(target.id, { type: target.type, scroll: false })
  await clearFocusFromRoute(router, route)
}

watch(() => [route.query.focus, route.query.section, courseId.value, timeline.value.length], () => { void focusRouteItem() }, { immediate: true })

function rowLocation(row) {
  if (row.type === 'event') return focusLocation('/', row.id, { section: 'event' })
  return row.path ? focusLocation(row.path, row.id) : null
}
</script>

<template>
  <div class="page course-archive-page">
    <header class="page-header compact-page-header">
      <div>
        <span class="eyebrow">COURSE ARCHIVE</span>
        <h1>{{ course?.name || '课程档案' }}</h1>
        <p>{{ course ? (scheduleText || '课程时间暂未设置') : routeMessage }}</p>
      </div>
      <button type="button" class="btn" @click="router.push('/schedule')">返回课程表</button>
    </header>

    <template v-if="course">
      <section class="course-profile panel" aria-label="课程信息">
        <div class="course-profile-main">
          <span class="course-mark" :style="{ background: course.color || 'var(--primary)' }" aria-hidden="true"></span>
          <div><h2>{{ course.name }}</h2><p>{{ [course.teacher && '任课老师：' + course.teacher, course.room && '上课地点：' + course.room].filter(Boolean).join(' · ') || '暂无老师和地点信息' }}</p></div>
        </div>
        <RouterLink class="profile-schedule-link" :to="focusLocation('/schedule', course.id)">在课程表中定位 →</RouterLink>
        <div class="course-profile-stats">
          <div><b>{{ stats.tasks }}</b><span>作业与待办</span></div>
          <div><b>{{ stats.notes }}</b><span>笔记</span></div>
          <div><b>{{ stats.focus }}</b><span>专注记录</span></div>
          <div><b>{{ stats.milestones }}</b><span>考试节点</span></div>
        </div>
      </section>

      <section class="course-timeline panel" aria-labelledby="course-timeline-title">
        <div class="timeline-heading"><div><span class="eyebrow">ACTIVITY</span><h2 id="course-timeline-title">课程时间线</h2></div><span>{{ timeline.length }} 条记录</span></div>
        <VirtualList
          v-if="timeline.length"
          ref="timelineList"
          v-slot="{ item: row }"
          class="timeline-list"
          role="list"
          aria-label="课程时间线记录"
          :items="timeline"
          :item-key="timelineRowKey"
          :estimated-height="88"
          :gap="0"
          :threshold="80"
        >
          <article class="timeline-item" role="listitem" :data-focus-id="row.id" :data-focus-type="row.type">
            <span class="timeline-dot" :class="'kind-' + row.type" aria-hidden="true"></span>
            <div class="timeline-date"><b>{{ row.date || '未安排日期' }}</b><small v-if="row.time">{{ row.time }}</small></div>
            <div class="timeline-copy">
              <div class="timeline-meta"><span>{{ row.kind }}</span><span v-if="row.status">{{ row.status }}</span><span v-if="row.archived">已归档</span></div>
              <RouterLink v-if="rowLocation(row)" class="timeline-title" :to="rowLocation(row)">{{ row.title }}</RouterLink>
              <b v-else class="timeline-title">{{ row.title }}</b>
              <p v-if="row.summary" class="timeline-summary">{{ row.summary }}</p>
            </div>
          </article>
        </VirtualList>
        <EmptyState v-else :level="2" title="还没有课程记录" description="关联到这门课的作业、笔记、专注记录和考试节点会汇总在这里。" />
      </section>
    </template>
    <EmptyState v-else :level="2" title="找不到这门课程" :description="routeMessage" />
  </div>
</template>

<style scoped>
.course-archive-page { display: grid; gap: 18px; }
.course-profile, .course-timeline { padding: 20px; }
.course-profile-main { display: flex; align-items: center; gap: 12px; }
.course-profile-main h2 { margin: 0; font-size: var(--fs-17); }
.course-profile-main p { margin: 5px 0 0; color: var(--ink-soft); font-size: var(--fs-12); }
.course-mark { width: 14px; height: 42px; flex: 0 0 14px; border-radius: var(--radius-pill); }
.profile-schedule-link { display: inline-flex; margin-top: 15px; color: var(--primary); font-size: var(--fs-12); font-weight: var(--fw-750); text-decoration: none; }
.profile-schedule-link:hover, .timeline-title:hover { text-decoration: underline; }
.course-profile-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.course-profile-stats div { display: grid; gap: 3px; padding: 11px; border-radius: var(--radius-9); background: var(--bg-tint); }
.course-profile-stats b { font-size: var(--fs-18); }
.course-profile-stats span { color: var(--ink-soft); font-size: var(--fs-11); }
.timeline-heading { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
.timeline-heading .eyebrow { color: var(--ink-soft); font-size: var(--fs-10); font-weight: var(--fw-750); letter-spacing: .08em; }
.timeline-heading h2 { margin: 3px 0 0; font-size: var(--fs-17); }
.timeline-heading > span { color: var(--ink-soft); font-size: var(--fs-12); }
.timeline-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.timeline-item { display: grid; grid-template-columns: 12px minmax(92px, 125px) minmax(0, 1fr); gap: 12px; position: relative; padding: 12px 0; }
.timeline-item:not(:last-child)::after { position: absolute; top: 28px; bottom: -12px; left: 5px; width: 2px; background: var(--border); content: ''; }
.timeline-dot { z-index: 1; width: 10px; height: 10px; margin-top: 4px; border: 2px solid var(--primary); border-radius: 50%; background: var(--card); }
.timeline-dot.kind-focus { border-color: var(--success); }
.timeline-dot.kind-note { border-color: var(--warning); }
.timeline-dot.kind-milestone { border-color: var(--danger); }
.timeline-date { display: flex; flex-direction: column; gap: 3px; color: var(--ink-soft); font-size: var(--fs-11); }
.timeline-date b { color: var(--text); font-weight: var(--fw-700); }
.timeline-copy { min-width: 0; }
.timeline-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; color: var(--ink-soft); font-size: var(--fs-10); }
.timeline-meta span { padding: 2px 6px; border-radius: var(--radius-pill); background: var(--bg-tint); }
.timeline-title { display: inline-block; color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-700); text-decoration: none; overflow-wrap: anywhere; }
.timeline-summary { margin: 4px 0 0; color: var(--ink-soft); font-size: var(--fs-11-5); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
/* 断点必须落在档位上（520 / 760 / 900）。原来这里是 560px，属于"随手写的一个数"：
   它让这一块在 521–560px 之间既不属于窄屏档、也不属于中屏档，布局在这一段里
   会出现一次没有对应规则的跳变。收敛到 520 档。 */
@media (max-width: 520px) {
  .course-profile, .course-timeline { padding: 15px; }
  .course-profile-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .timeline-item { grid-template-columns: 12px minmax(0, 1fr); gap: 8px 10px; }
  .timeline-date { grid-column: 2; grid-row: 1; flex-direction: row; gap: 8px; }
  .timeline-copy { grid-column: 2; grid-row: 2; }
  .timeline-dot { grid-column: 1; grid-row: 1 / span 2; }
}
</style>
