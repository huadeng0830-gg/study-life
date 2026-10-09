<script setup>
import { computed, nextTick, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import VirtualList from '../components/VirtualList.vue'
import Toast from '../components/Toast.vue'
import TaskWorkSession from '../components/tasks/TaskWorkSession.vue'
import CourseTaskItem from '../components/courses/CourseTaskItem.vue'
import CourseActivityItem from '../components/courses/CourseActivityItem.vue'
import { buildCourseProgress, courseDateLabel, courseTaskDueLabel } from '../composables/courseProgress.js'
import { useDomainCommands } from '../composables/domain/commands.js'
import { clearFocusFromRoute, focusElementWhenReady, focusLocation, readFocusQuery } from '../composables/focusNavigation.js'
import { formatFocusDuration } from '../composables/focusTimer.js'
import { weekLabel } from '../composables/store/schedule.js'
import { periodLabelById } from '../composables/store/timeConfig.js'
import { appNow } from '../composables/timeContext.js'
import { useTaskWorkSession } from '../composables/tasks/useTaskWorkSession.js'

const route = useRoute()
const router = useRouter()
const domain = useDomainCommands()
const courseId = computed(() => String(route.query.courseId ?? '').trim())
const profiles = computed(() => buildCourseProgress({
  courses: domain.courses.value, tasks: domain.tasks.value, milestones: domain.milestones.value,
  events: domain.events.value, focusSessions: domain.focusSessions.value,
}, appNow.value))
const profile = computed(() => profiles.value.find((item) => String(item.course.id) === courseId.value) ?? null)
const course = computed(() => profile.value?.course ?? null)
const activeProfiles = computed(() => profiles.value.filter((item) => !item.archived))
const archivedProfiles = computed(() => profiles.value.filter((item) => item.archived))
const search = ref('')
const scope = ref('active')
const historyOpen = ref(false)
const nodesExpanded = ref(false)
const activityType = ref('all')
/** @type {import('vue').Ref<{ scrollToKey: (key: string, behavior?: string) => void } | null>} */
const timelineList = ref(null)
/** @type {import('vue').Ref<HTMLElement | null>} */
const taskHeading = ref(null)
const toast = ref({ open: false, message: '', type: 'info' })
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const ACTIVITY_FILTERS = [
  { value: 'all', label: '全部' }, { value: 'task', label: '待办' },
  { value: 'milestone', label: '重要日期' }, { value: 'event', label: '日程' }, { value: 'focus', label: '专注' },
]

const visibleProfiles = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return profiles.value.filter((item) => {
    if (scope.value === 'archived' ? !item.archived : item.archived) return false
    if (scope.value === 'pending' && !item.pendingTasks.length && !item.upcomingCount) return false
    return !query || [item.course.name, item.course.teacher, item.course.room].some((value) => String(value || '').toLocaleLowerCase().includes(query))
  })
})
const totals = computed(() => activeProfiles.value.reduce((result, item) => ({
  pending: result.pending + item.pendingTasks.length, overdue: result.overdue + item.overdueCount,
  upcoming: result.upcoming + item.upcomingCount, focus: result.focus + item.recentFocusSeconds,
}), { pending: 0, overdue: 0, upcoming: 0, focus: 0 }))
const attentionCount = computed(() => activeProfiles.value.filter((item) => item.pendingTasks.length || item.upcomingCount).length)
const timeline = computed(() => profile.value?.timeline ?? [])
const visibleTimeline = computed(() => timeline.value.filter((row) => activityType.value === 'all' || row.type === activityType.value))
const upcomingPreview = computed(() => (nodesExpanded.value ? profile.value?.upcoming : profile.value?.upcoming.slice(0, 4)) ?? [])
const taskLocation = computed(() => course.value ? { path: '/tasks', query: { new: '1', courseId: String(course.value.id) } } : '/tasks')

function courseLocation(id) {
  return { path: '/course', query: { courseId: String(id) } }
}

function scheduleText(item) {
  const start = periodLabelById(item.start)
  const end = periodLabelById(item.end)
  const periods = start && end ? (item.start === item.end ? start : `${start}–${end}`) : ''
  return [DAY_NAMES[Number(item.day)], weekLabel(item), periods].filter(Boolean).join(' · ')
}

function taskProgress(item) {
  return item.taskTotal ? Math.round(item.completedCount / item.taskTotal * 100) : 0
}

function nextActionText(item) {
  const next = item.pendingTasks[0]
  if (next) return `${courseTaskDueLabel(next, appNow.value)} · ${next.task.title}`
  const node = item.upcoming[0]
  return node ? `${courseDateLabel(node.date, appNow.value)} · ${node.title}` : '暂时没有待处理事项'
}

function notify(message, options = {}) {
  toast.value = { open: true, message, type: options.type || 'success' }
}

function openProjectTask(task) {
  if (task?.relationId) void router.push({ path: '/projects', query: { project: task.relationId, ...(task.sourceId ? { task: task.sourceId } : {}) } })
}

const {
  task: workSessionTask, draft: workSessionDraft, error: workSessionError, busy: workSessionBusy,
  statusLabel: workSessionStatusLabel, startLabel: workSessionStartLabel,
  open: openTaskWorkSession, close: closeTaskWorkSession, updateField: updateWorkSessionField,
  start: startTaskWork, save: saveTaskWorkProgress,
} = useTaskWorkSession({ domain, openProjectTask, notify })

async function completeTask(task) {
  if (!profile.value?.pendingTasks.some((row) => row.task.id === task.id) || task.deletedAt || task.tombstone) return
  if (task.sourceType === 'project-task') { openProjectTask(task); return }
  domain.completeTask(task.id)
  notify(`已完成「${task.title}」`)
  await nextTick()
  taskHeading.value?.focus({ preventScroll: true })
}

function rowLocation(row) {
  return focusLocation(row.path, row.id)
}

/** @param {unknown} item @returns {import('../composables/courseProgress.js').CourseTaskRow} */
function taskRow(item) { return /** @type {import('../composables/courseProgress.js').CourseTaskRow} */ (item) }

/** @param {unknown} item @returns {import('../composables/courseProgress.js').CourseActivity} */
function activityRow(item) { return /** @type {import('../composables/courseProgress.js').CourseActivity} */ (item) }

/** @param {Event} event */
function switchCourse(event) {
  const select = /** @type {HTMLSelectElement | null} */ (event.target)
  if (select) void router.push(courseLocation(select.value))
}

function timelineRowKey(row) {
  return `${row.type}:${row.id}`
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value
}

function resetFilters() {
  search.value = ''
  scope.value = 'active'
}

watch(courseId, () => {
  historyOpen.value = false
  nodesExpanded.value = false
  activityType.value = 'all'
  closeTaskWorkSession()
})

onDeactivated(() => {
  closeTaskWorkSession()
  toast.value.open = false
})

let focusHandled = ''
async function focusRouteItem() {
  if (route.path !== '/course') { focusHandled = ''; return }
  const requestedPath = route.fullPath
  const { id, section } = readFocusQuery(route)
  if (!id) { focusHandled = ''; return }
  const key = `${courseId.value}:${section}:${id}`
  if (focusHandled === key) return
  focusHandled = key
  const target = timeline.value.find((row) => row.id === id && (!section || row.type === section))
  if (target) {
    historyOpen.value = true
    activityType.value = 'all'
    await nextTick()
    if (route.fullPath !== requestedPath) return
    timelineList.value?.scrollToKey(timelineRowKey(target), 'auto')
    await nextTick()
    await focusElementWhenReady(target.id, { type: target.type, scroll: true, root: document.getElementById('course-history') })
  }
  if (route.fullPath === requestedPath) await clearFocusFromRoute(router, route)
}

watch(() => [route.query.focus, route.query.section, courseId.value, timeline.value.length], () => { void focusRouteItem() }, { immediate: true, flush: 'post' })
</script>

<template>
  <div class="page course-progress-page">
    <header class="course-page-header">
      <div class="course-heading">
        <span class="eyebrow">{{ course ? '课程进度' : '学习 / 课程' }}</span>
        <h1>{{ course?.name || '课程进度' }}</h1>
        <p>{{ course ? scheduleText(course) : '看看每门课做到哪里，选一件事继续。' }}</p>
      </div>
      <div class="course-header-actions">
        <RouterLink v-if="courseId" class="btn btn-ghost" to="/course">← 全部课程</RouterLink>
        <RouterLink class="btn" :to="course ? focusLocation('/schedule', course.id) : '/schedule'">{{ course ? '查看课表' : '管理课程' }}</RouterLink>
        <RouterLink v-if="profile && !profile.archived" class="btn btn-primary" :to="taskLocation">＋ 添加课程待办</RouterLink>
      </div>
    </header>

    <template v-if="!courseId">
      <section class="overview-stats" aria-label="在学课程概览">
        <div class="overview-stat panel"><span>待完成事项</span><strong>{{ totals.pending }}<small>项</small></strong><p>{{ activeProfiles.length }} 门在学课程</p></div>
        <div class="overview-stat panel" :class="{ 'stat-urgent': totals.overdue }"><span>逾期待办</span><strong>{{ totals.overdue }}<small>项</small></strong><p>{{ totals.overdue ? '先给这些事项安排下一步' : '目前没有逾期待办' }}</p></div>
        <div class="overview-stat panel"><span>近期节点</span><strong>{{ totals.upcoming }}<small>个</small></strong><p>未来 7 天的考试与日程</p></div>
        <div class="overview-stat panel"><span>近 7 天专注</span><strong class="focus-total">{{ formatFocusDuration(totals.focus) }}</strong><p>已关联课程的专注时长</p></div>
      </section>

      <section class="course-overview" aria-labelledby="course-list-title">
        <div class="course-list-heading"><div><h2 id="course-list-title">我的课程</h2><p>逾期和近期事项优先显示</p></div><label class="course-search"><span class="sr-only">搜索课程、老师或地点</span><input v-model="search" type="search" placeholder="搜索课程、老师或地点" /></label></div>
        <div class="course-filters" role="group" aria-label="筛选课程">
          <button type="button" :aria-pressed="scope === 'active'" @click="scope = 'active'">在学课程 <span>{{ activeProfiles.length }}</span></button>
          <button type="button" :aria-pressed="scope === 'pending'" @click="scope = 'pending'">待推进 <span>{{ attentionCount }}</span></button>
          <button type="button" :aria-pressed="scope === 'archived'" @click="scope = 'archived'">已归档 <span>{{ archivedProfiles.length }}</span></button>
          <span class="course-result-count" role="status">{{ visibleProfiles.length }} 门课程</span>
        </div>
        <div v-if="visibleProfiles.length" class="course-card-grid">
          <RouterLink v-for="item in visibleProfiles" :key="item.course.id" class="course-card panel" :to="courseLocation(item.course.id)" :style="{ '--course-color': item.course.color || 'var(--primary)' }" :aria-label="`查看${item.course.name}的课程进度`">
            <div class="course-card-title"><span class="course-mark" aria-hidden="true"></span><h3>{{ item.course.name || '未命名课程' }}</h3><span v-if="item.archived" class="course-badge">已归档</span><span v-else-if="item.overdueCount" class="course-badge badge-urgent">{{ item.overdueCount }} 项逾期</span><span class="course-card-arrow" aria-hidden="true">↗</span></div>
            <p class="course-card-subtitle">{{ [item.course.teacher, item.course.room].filter(Boolean).join(' · ') || '老师与地点待补充' }}</p>
            <p class="course-card-schedule">{{ scheduleText(item.course) }}</p>
            <div class="course-card-counts"><div><b>{{ item.pendingTasks.length }}</b><span>待完成</span></div><div><b>{{ item.upcomingCount }}</b><span>近期节点</span></div><div><b>{{ formatFocusDuration(item.recentFocusSeconds) }}</b><span>近 7 天专注</span></div></div>
            <div class="course-task-progress"><div><span>任务完成情况</span><b>{{ item.completedCount }} / {{ item.taskTotal }}</b></div><div class="course-progress-track" role="progressbar" :aria-label="`${item.course.name}任务完成情况`" :aria-valuenow="taskProgress(item)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="item.taskTotal ? `${item.completedCount} / ${item.taskTotal} 项已完成` : '暂无待办'"><span :style="{ width: taskProgress(item) + '%' }"></span></div></div>
            <div class="course-card-next" :class="{ 'next-urgent': item.overdueCount }"><span>{{ item.pendingTasks.length ? '下一件事' : item.upcoming.length ? '下个节点' : '当前状态' }}</span><p>{{ nextActionText(item) }}</p></div>
          </RouterLink>
        </div>
        <div v-else class="panel">
          <EmptyState v-if="!profiles.length" :level="3" icon="📚" title="先把课程加进来" description="在课程表中添加或导入课程，这里就会汇总每门课的待办、重要日期与专注记录。" primary-label="前往课程表" @primary="router.push('/schedule')" />
          <EmptyState v-else-if="search.trim()" :level="3" title="没有匹配的课程" description="试试课程名称、老师或上课地点。" primary-label="重置筛选" @primary="resetFilters" />
          <EmptyState v-else-if="scope === 'pending'" :level="3" icon="✓" title="暂时没有待推进的课程" description="未完成待办和未来 7 天的课程节点会出现在这里。" primary-label="查看在学课程" @primary="resetFilters" />
          <EmptyState v-else-if="scope === 'archived'" :level="3" title="还没有归档课程" description="学期结束后，可在课程表中归档课程，保留学习记录。" />
          <EmptyState v-else :level="3" title="当前没有在学课程" description="你可以查看已归档课程的记录，或在课程表里添加新课程。" primary-label="查看已归档" secondary-label="管理课程" @primary="scope = 'archived'" @secondary="router.push('/schedule')" />
        </div>
      </section>
    </template>

    <template v-else-if="profile && course">
      <section class="course-detail-summary panel" aria-label="这门课的学习进度">
        <div class="course-detail-info"><span class="course-mark" :style="{ background: course.color || 'var(--primary)' }" aria-hidden="true"></span><p>{{ [course.teacher && '任课老师：' + course.teacher, course.room && '上课地点：' + course.room].filter(Boolean).join(' · ') || '老师与地点待补充' }}</p><span v-if="profile.archived" class="course-badge">已归档</span><label class="course-switch"><span class="sr-only">切换课程</span><select :value="courseId" aria-label="切换课程" @change="switchCourse"><option v-for="item in profiles" :key="item.course.id" :value="String(item.course.id)">{{ item.course.name }}{{ item.archived ? '（已归档）' : '' }}</option></select></label></div>
        <div class="course-detail-stats"><div><span>任务完成情况</span><strong>{{ profile.completedCount }}<small>/ {{ profile.taskTotal }}</small></strong><div class="course-progress-track" role="progressbar" aria-label="课程任务完成情况" :aria-valuenow="taskProgress(profile)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="`${profile.completedCount} / ${profile.taskTotal} 项已完成`"><span :style="{ width: taskProgress(profile) + '%' }"></span></div></div><div><span>待完成</span><strong>{{ profile.pendingTasks.length }}<small>项</small></strong><p :class="{ 'text-urgent': profile.overdueCount }">{{ profile.overdueCount ? `${profile.overdueCount} 项已逾期` : '按截止时间推进' }}</p></div><div><span>近 7 天专注</span><strong class="focus-total">{{ formatFocusDuration(profile.recentFocusSeconds) }}</strong><p>累计 {{ formatFocusDuration(profile.focusSeconds) }}</p></div></div>
      </section>

      <div class="course-workspace">
        <section class="course-tasks panel" aria-labelledby="course-tasks-title">
          <div class="section-heading"><div><span class="eyebrow">下一步</span><h2 id="course-tasks-title" ref="taskHeading" tabindex="-1">课程待办 <span>{{ profile.pendingTasks.length }}</span></h2></div><RouterLink v-if="!profile.archived" class="text-link" :to="taskLocation">＋ 添加</RouterLink></div>
          <VirtualList v-if="profile.pendingTasks.length" v-slot="{ item }" class="course-task-list" role="list" aria-label="待完成的课程事项" :items="profile.pendingTasks" :item-key="row => String(row.task.id)" :estimated-height="118" :gap="0" :threshold="60">
            <CourseTaskItem :row="taskRow(item)" :now="appNow" @complete="completeTask" @work="openTaskWorkSession" />
          </VirtualList>
          <EmptyState v-else :level="3" icon="✓" :title="profile.taskTotal ? '课程待办已处理完' : '先记下这门课要做的事'" :description="profile.taskTotal ? '已完成的事项保留在课程记录里。' : '作业、预习、实验报告，都可以关联到这门课。'" :primary-label="profile.archived ? '' : '添加课程待办'" @primary="router.push(taskLocation)" />
        </section>

        <section class="course-upcoming panel" aria-labelledby="course-upcoming-title">
          <div class="section-heading"><div><span class="eyebrow">提前安排</span><h2 id="course-upcoming-title">接下来的节点</h2></div><span class="section-count">{{ profile.upcoming.length }} 个</span></div>
          <ul v-if="upcomingPreview.length" class="course-node-list"><li v-for="row in upcomingPreview" :key="timelineRowKey(row)"><div class="node-date"><b>{{ courseDateLabel(row.date, appNow) }}</b><span>{{ row.time || row.date }}</span></div><div class="node-copy"><span class="node-kind">{{ row.kind }}</span><RouterLink class="task-row-title" :to="rowLocation(row)">{{ row.title }}</RouterLink><p v-if="row.summary">{{ row.summary }}</p><p v-if="row.type === 'milestone' && Number(row.reviewProgress) > 0">复习进度 {{ row.reviewProgress }}%</p></div></li></ul>
          <EmptyState v-else :level="3" icon="◇" title="暂无近期节点" description="关联到课程的考试、重要日期和日程会按时间排列。"><RouterLink class="btn" to="/exams">管理重要日期</RouterLink></EmptyState>
          <button v-if="profile.upcoming.length > 4" class="text-link node-more" type="button" :aria-expanded="nodesExpanded" @click="nodesExpanded = !nodesExpanded">{{ nodesExpanded ? '收起节点 ↑' : `展开其余 ${profile.upcoming.length - 4} 个节点 ↓` }}</button>
        </section>
      </div>

      <section class="course-history panel" aria-labelledby="course-history-title">
        <div class="section-heading history-heading"><div><h2 id="course-history-title">课程记录 <span>{{ timeline.length }}</span></h2><p>作业、日程、重要日期与专注的完整记录</p></div><button type="button" class="btn btn-ghost" :aria-expanded="historyOpen" aria-controls="course-history" @click="toggleHistory">{{ historyOpen ? '收起记录 ↑' : '展开记录 ↓' }}</button></div>
        <div v-if="historyOpen" id="course-history">
          <div class="course-filters activity-filters" role="group" aria-label="筛选课程记录"><button v-for="filter in ACTIVITY_FILTERS" :key="filter.value" type="button" :aria-pressed="activityType === filter.value" @click="activityType = filter.value">{{ filter.label }}</button><span class="course-result-count" role="status">{{ visibleTimeline.length }} 条</span></div>
          <VirtualList v-if="visibleTimeline.length" ref="timelineList" v-slot="{ item }" class="timeline-list" role="list" aria-label="课程记录" :items="visibleTimeline" :item-key="timelineRowKey" :estimated-height="88" :gap="0" :threshold="80">
            <CourseActivityItem :row="activityRow(item)" />
          </VirtualList>
          <EmptyState v-else :level="3" title="还没有这类课程记录" description="关联的事项和专注记录会自动汇总到这里。" />
        </div>
      </section>
    </template>

    <section v-else class="panel"><EmptyState :level="2" title="这门课程已不存在" description="你仍可以在待办、日程和重要日期中查看原有记录，也可以返回总览选择其他课程。" primary-label="查看全部课程" @primary="router.push('/course')" /></section>

    <TaskWorkSession :open="Boolean(workSessionTask)" :task="workSessionTask || undefined" :checkpoint="workSessionTask?.workCheckpoint || undefined" :form="workSessionDraft" :status-label="workSessionStatusLabel" :start-label="workSessionStartLabel" :can-start="Boolean(workSessionTask)" :can-save="Boolean(workSessionTask)" :busy="workSessionBusy" :error="workSessionError" @close="closeTaskWorkSession" @start="startTaskWork" @save="saveTaskWorkProgress" @update:field="updateWorkSessionField" />
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" @close="toast.open = false" />
  </div>
</template>

<style scoped src="./course-progress.css"></style>
