<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TimeWheelSheet from '../components/TimeWheelSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import Toast from '../components/Toast.vue'
import DomainCsvImportButton from '../components/DomainCsvImportButton.vue'
import IcsImportButton from '../components/IcsImportButton.vue'
import SocialCalendarEvents from '../components/SocialCalendarEvents.vue'
import VirtualList from '../components/VirtualList.vue'
import EventCalendar from '../components/events/EventCalendar.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived } from '../composables/domain/state.js'
import { appNow, appToday, appTimezone, formatAppDate, getAppTime } from '../composables/timeContext.js'
import { defaultReminderMinutes } from '../composables/settingsPolicy.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { announceAlert } from '../composables/liveRegion.js'
import { clearFocusFromRoute, readFocusQuery } from '../composables/focusNavigation.js'
import { getReminderNotificationState, requestReminderPermission } from '../composables/reminderScheduler.js'
import { EVENT_FILTERS, compareEvents, eventDuration, eventRows, eventState, selectEventPlan, shiftEventDate } from '../composables/events/eventPlanning.js'
import { validEventDate } from '../composables/events/eventFields.js'
import { useEventEditor } from '../composables/events/useEventEditor.js'
import { buildEventCalendar, downloadEventCalendar } from '../composables/events/eventCalendarExport.js'
import { eventImportFingerprint } from '../composables/icalImport.js'

const domain = useDomainCommands()
const { events } = domain
const route = useRoute()
const router = useRouter()
const filter = ref('upcoming')
const viewMode = ref('list')
const query = ref('')
const month = ref(appToday.value.slice(0, 7))
const selectedDate = ref(appToday.value)
const detail = ref(null)
const deleteEventTarget = ref(null)
const toast = ref({ open: false, message: '', type: 'success', actionLabel: '', undoFn: null, duration: 4000 })
const notificationState = ref(getReminderNotificationState().state)
const notificationBusy = ref(false)
const importOpen = ref(false)
let handledFocus = ''

function showNotice(message, { error = false, undoFn = null } = {}) {
  toast.value = { open: true, message, type: error ? 'error' : 'success', actionLabel: undoFn ? '撤销' : '', undoFn, duration: 4000 }
  if (error) announceAlert(message, { clearAfter: 7000 })
}
const {
  formOpen, editing, form, formError, formErrorField, formElement, titleInput,
  wheelField, wheelValue, saveConflict, courseOptions, liveConflicts,
  openCreate, openEdit, closeForm, selectCourse, clearTime, setDuration, save, confirmConflictSave,
} = useEventEditor(domain, showNotice)
const debouncedQuery = useDebouncedRef(query, 160)
const appTime = computed(() => getAppTime(appNow.value, appTimezone.value))
const plan = computed(() => selectEventPlan(events.value, { today: appToday.value, time: appTime.value, query: debouncedQuery.value, filter: filter.value }))
const archivedScope = computed(() => filter.value === 'archived')
const calendarEvents = computed(() => plan.value.matched.filter((event) => isArchived(event) === archivedScope.value))
const visibleEvents = computed(() => viewMode.value === 'calendar'
  ? calendarEvents.value.filter((event) => selectedDate.value ? event.date === selectedDate.value : event.date?.startsWith(month.value)).sort(compareEvents)
  : plan.value.visible)
const rows = computed(() => eventRows(visibleEvents.value))
const listTitle = computed(() => viewMode.value === 'calendar'
  ? selectedDate.value ? dayLabel(selectedDate.value) : `${month.value.replace('-', ' 年 ')} 月的安排`
  : EVENT_FILTERS.find((item) => item.key === filter.value)?.label || '日程')
const emptyState = computed(() => {
  if (debouncedQuery.value.trim()) return { title: '没有匹配的日程', description: '试试标题、地点、课程或日期，也可以清除搜索。' }
  if (viewMode.value === 'calendar') return { title: '这段时间还没有安排', description: '选好日期后，直接添加一条日程。' }
  return {
    upcoming: { title: '接下来暂时没有日程', description: '添加下一次会议、活动或个人安排；没有日期的内容可以先放进待安排。' },
    today: { title: '今天还没有日程', description: '给今天安排一点事，也可以从通知或快速记录中录入。' },
    week: { title: '本周还没有日程', description: '切换到月历，看看下一段时间的安排。' },
    unplanned: { title: '没有待安排的日程', description: '暂时没有日期的想法可以先记在这里，之后再安排。' },
    past: { title: '还没有过去的日程', description: '结束的日程会保留在这里，方便查找和复用。' },
    archived: { title: '没有已归档的日程', description: '归档会保留内容，并停止这条日程的提醒。' },
  }[filter.value]
})
const nextEvent = computed(() => plan.value.next)
const canCreateInScope = computed(() => !archivedScope.value && (viewMode.value === 'calendar' || filter.value !== 'past'))

function dayLabel(date) {
  if (!validEventDate(date)) return '待安排日期'
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${appToday.value}T12:00:00Z`)) / 86400000)
  return `${days === 0 ? '今天 · ' : days === 1 ? '明天 · ' : days === -1 ? '昨天 · ' : ''}${formatAppDate(date)}`
}
function timeRangeOf(event) { return event.time ? `${event.time}${event.endTime ? `–${event.endTime}` : ''}` : '时间未定' }
function stateOf(event) { return eventState(event, appToday.value, appTime.value) }
function reminderOf(event) {
  if (isArchived(event)) return '归档期间不提醒'
  if (event.reminderEnabled === false) return '不提醒'
  if (!event.date) return '安排日期后提醒'
  const minutes = defaultReminderMinutes('event', event.reminderMinutes)
  return minutes ? `提前 ${minutes} 分钟提醒` : '到点提醒'
}
function sourceOf(event) {
  if (event.sourceType === 'project-meeting') return '齐行会议'
  if (event.sourceText?.startsWith('ics:')) return '日历导入'
  if (event.sourceType === 'domain-csv-import') return 'CSV 导入'
  if (event.noticeType || event.sourceText) return '通知 / 快速记录'
  return ''
}
function createForScope() {
  openCreate(viewMode.value === 'calendar' ? selectedDate.value || `${month.value}-01` : filter.value === 'unplanned' ? '' : appToday.value)
}
function showFilter(key) { filter.value = key; viewMode.value = 'list' }
function changeMonth(value) {
  if (!validEventDate(`${value}-01`)) return
  month.value = value
  if (!selectedDate.value.startsWith(value)) selectedDate.value = `${value}-01`
}
function editDetail() { const event = detail.value; detail.value = null; if (event) openEdit(event) }
function copyEvent(event) { detail.value = null; openCreate(event.date || '', event) }
function archive(event) {
  try {
    if (!domain.archiveEvent(event.id)) throw new Error('这条日程已被移除')
    detail.value = null
    showNotice('已归档日程', { undoFn: () => { domain.restoreEvent(event.id); showNotice('已撤销归档') } })
  } catch (cause) { showNotice(cause?.message || '归档失败，请重试', { error: true }) }
}
function restore(event) {
  try {
    if (!domain.restoreEvent(event.id)) throw new Error('这条日程已被移除')
    detail.value = null
    showNotice('已恢复日程')
  } catch (cause) { showNotice(cause?.message || '恢复失败，请重试', { error: true }) }
}
function confirmRemove() {
  const target = deleteEventTarget.value
  deleteEventTarget.value = null
  if (!target) return
  try {
    const deleted = domain.deleteEvent(target.id)
    if (!deleted) throw new Error('这条日程已被移除')
    detail.value = null
    showNotice('已删除日程', { undoFn: () => { domain.restoreDeletedEvent(deleted); showNotice('已撤销删除') } })
  } catch (cause) { showNotice(cause?.message || '删除失败，请重试', { error: true }) }
}
function importEvents(importedRows) {
  const active = events.value.filter((event) => event && !event.deletedAt && !event.tombstone)
  const fingerprints = new Set(active.map(eventImportFingerprint))
  const sources = new Set(active.map((event) => event.sourceText).filter((text) => text?.startsWith('ics:')))
  let imported = 0
  let skipped = 0
  try {
    for (const row of importedRows) {
      const fingerprint = eventImportFingerprint(row)
      if (fingerprints.has(fingerprint) || (row.sourceText?.startsWith('ics:') && sources.has(row.sourceText))) { skipped++; continue }
      domain.createEvent(row)
      fingerprints.add(fingerprint)
      if (row.sourceText?.startsWith('ics:')) sources.add(row.sourceText)
      imported++
    }
    showNotice(`已导入 ${imported} 条日程${skipped ? `，跳过 ${skipped} 条重复记录` : ''}`)
    importOpen.value = false
  } catch (cause) { showNotice(`已导入 ${imported} 条，后续保存失败：${cause?.message || '请重试'}`, { error: true }) }
}
function exportCalendar() {
  try {
    const result = buildEventCalendar(visibleEvents.value, { timezone: appTimezone.value })
    if (!result.count) { showNotice('当前结果中没有已安排日期且有效的日程可导出', { error: true }); return }
    downloadEventCalendar(result.text, `三两事-日程-${appToday.value}.ics`)
    showNotice(`已导出 ${result.count} 条日程${result.skipped ? `，${result.skipped} 条待安排或无效记录未导出` : ''}`)
  } catch (cause) { showNotice(cause?.message || '导出失败，请重试', { error: true }) }
}
async function enableNotifications() {
  notificationBusy.value = true
  try { notificationState.value = (await requestReminderPermission()).state }
  finally { notificationBusy.value = false }
}
watch(formOpen, (open) => { if (open) notificationState.value = getReminderNotificationState().state })
watch(() => [route.query.focus, events.value.length], async () => {
  const { id } = readFocusQuery(route)
  if (!id) { handledFocus = ''; return }
  if (handledFocus === id) return
  handledFocus = id
  const event = events.value.find((item) => String(item.id) === id && !item.deletedAt && !item.tombstone)
  if (event) detail.value = event
  else showNotice('这条日程可能已被删除', { error: true })
  await clearFocusFromRoute(router, route)
}, { immediate: true })
watch(() => events.value.find((event) => event.id === detail.value?.id), (event) => { if (detail.value) detail.value = event || null })
</script>

<template>
  <div class="page events-page">
    <header class="page-header compact-page-header">
      <div><span class="eyebrow">EVENTS</span><h1>日程</h1><p>安排好接下来的时间，让每一次约定都有着落。</p></div>
      <div class="events-header-actions">
        <router-link class="btn btn-ghost" to="/together">一起约</router-link>
        <button type="button" class="btn btn-ghost" @click="importOpen = true">导入日程</button>
        <button type="button" class="btn btn-primary" @click="createForScope">＋ 新建日程</button>
      </div>
    </header>
    <section class="events-overview" aria-label="日程概览">
      <div class="events-next panel">
        <div class="next-heading"><span class="eyebrow">{{ nextEvent && stateOf(nextEvent).key === 'ongoing' ? '正在进行' : '接下来' }}</span><span class="next-date">{{ nextEvent ? dayLabel(nextEvent.date) : '给时间留一点期待' }}</span></div>
        <button v-if="nextEvent" type="button" class="next-event-link" @click="detail = nextEvent"><strong>{{ nextEvent.title }}</strong><span>{{ timeRangeOf(nextEvent) }}<template v-if="nextEvent.location"> · {{ nextEvent.location }}</template><span aria-hidden="true"> →</span></span></button>
        <p v-else class="next-empty">{{ plan.counts.unplanned ? '还有待安排的日程，选个合适的时间吧。' : '暂时没有即将开始的安排。' }}</p>
      </div>
      <div class="events-stats panel">
        <button v-for="stat in [{ key: 'today', label: '今天' }, { key: 'week', label: '本周' }, { key: 'unplanned', label: '待安排' }]" :key="stat.key" type="button" :aria-label="`${stat.label} ${plan.counts[stat.key]} 条日程`" @click="showFilter(stat.key)"><b>{{ plan.counts[stat.key] }}</b><span>{{ stat.label }}</span></button>
      </div>
    </section>
    <SocialCalendarEvents scope="upcoming" />
    <section class="events-toolbar panel" aria-label="日程筛选">
      <div class="toolbar-top">
        <div class="events-view-switch" role="group" aria-label="日程视图">
          <button type="button" :aria-pressed="viewMode === 'list'" :class="{ on: viewMode === 'list' }" @click="viewMode = 'list'">清单</button>
          <button type="button" :aria-pressed="viewMode === 'calendar'" :class="{ on: viewMode === 'calendar' }" @click="viewMode = 'calendar'">月历</button>
        </div>
        <label class="search-field"><span class="sr-only">搜索日程</span><input v-model="query" type="search" placeholder="搜索标题、地点、课程、日期或备注" /></label>
        <button v-if="query" type="button" class="btn btn-ghost" @click="query = ''">清除</button>
      </div>
      <div v-if="viewMode === 'list'" class="events-filters" role="group" aria-label="日程状态">
        <button v-for="item in EVENT_FILTERS" :key="item.key" type="button" :aria-pressed="filter === item.key" :class="['filter-tab', { on: filter === item.key }]" @click="filter = item.key">{{ item.label }}<span>{{ plan.counts[item.key] }}</span></button>
      </div>
      <div v-else class="calendar-scope" role="group" aria-label="月历范围">
        <button type="button" :aria-pressed="!archivedScope" :class="['filter-tab', { on: !archivedScope }]" @click="filter = 'upcoming'">当前日程</button>
        <button type="button" :aria-pressed="archivedScope" :class="['filter-tab', { on: archivedScope }]" @click="filter = 'archived'">已归档</button>
      </div>
    </section>
    <div class="events-workspace" :class="{ 'calendar-mode': viewMode === 'calendar' }">
      <EventCalendar v-if="viewMode === 'calendar'" :month="month" :selected-date="selectedDate" :today="appToday" :events="calendarEvents" @month="changeMonth" @select="selectedDate = $event" />
      <section class="events-agenda" aria-label="日程列表">
        <header class="agenda-header">
          <div><h2>{{ listTitle }}</h2><span class="events-count" aria-live="polite">{{ visibleEvents.length }} 条日程</span></div>
          <div class="agenda-actions"><button v-if="viewMode === 'calendar'" type="button" class="btn btn-ghost" @click="selectedDate = selectedDate ? '' : `${month}-01`">{{ selectedDate ? '查看整月' : '按日查看' }}</button><button type="button" class="btn btn-ghost" :disabled="!visibleEvents.length" @click="exportCalendar">导出 .ics</button></div>
        </header>
        <VirtualList v-if="rows.length" :items="rows" class="event-virtual-list" :estimated-height="132" :gap="8" :threshold="30" :overscan="4">
          <template #default="{ item: row }">
            <div class="event-row">
              <h3 v-if="row.startsGroup" class="event-day-label">{{ dayLabel(row.event.date) }}<span>{{ row.count }} 条</span></h3>
              <article class="event-card panel" :class="{ past: stateOf(row.event).key === 'past', ongoing: stateOf(row.event).key === 'ongoing' }" :data-focus-id="row.event.id">
                <div class="event-time-column"><b>{{ row.event.time || (row.event.date ? '待定' : '待安排') }}</b><span>{{ row.event.endTime || (row.event.date ? '时间' : '日期') }}</span></div>
                <div class="event-card-main">
                  <div class="event-line1"><button type="button" class="event-title" @click="detail = row.event">{{ row.event.title }}</button><span class="event-state" :data-state="stateOf(row.event).key">{{ stateOf(row.event).label }}</span></div>
                  <div class="event-meta"><span v-if="row.event.location" class="event-loc">{{ row.event.location }}</span><span v-if="row.event.courseName" class="event-course">{{ row.event.courseName }}</span><span v-if="eventDuration(row.event)">{{ eventDuration(row.event) }}</span></div>
                  <p v-if="row.event.note" class="event-note">{{ row.event.note }}</p>
                </div>
                <div class="event-card-actions">
                  <button v-if="!isArchived(row.event)" type="button" :aria-label="`编辑日程：${row.event.title}`" @click="openEdit(row.event)">编辑</button>
                  <button v-if="isArchived(row.event)" type="button" :aria-label="`恢复日程：${row.event.title}`" @click="restore(row.event)">恢复</button>
                  <button v-else type="button" :aria-label="`归档日程：${row.event.title}`" @click="archive(row.event)">归档</button>
                  <button type="button" class="danger-text" :aria-label="`删除日程：${row.event.title}`" @click="deleteEventTarget = row.event">删除</button>
                </div>
              </article>
            </div>
          </template>
        </VirtualList>
        <EmptyState v-else :level="3" :title="emptyState.title" :description="emptyState.description" :primary-label="debouncedQuery.trim() ? '清除搜索' : canCreateInScope ? '新建日程' : ''" @primary="debouncedQuery.trim() ? query = '' : createForScope()" />
        <button v-if="viewMode === 'calendar' && canCreateInScope && rows.length" type="button" class="btn btn-ghost add-day-event" @click="createForScope">＋ 添加{{ selectedDate ? '当天' : '本月' }}日程</button>
      </section>
    </div>
    <Modal v-if="formOpen" :open="formOpen" :title="editing ? '编辑日程' : '新建日程'" medium @close="closeForm">
      <form ref="formElement" class="event-form" novalidate @submit.prevent="save">
        <label class="field">日程内容<input ref="titleInput" v-model="form.title" data-field="title" maxlength="80" placeholder="例如：项目讨论、图书馆自习" :aria-invalid="formErrorField === 'title' || undefined" :aria-describedby="formErrorField === 'title' ? 'event-form-error' : undefined" /></label>
        <div class="form-section">
          <label class="field">日期<input v-model="form.date" data-field="date" type="date" :aria-invalid="formErrorField === 'date' || undefined" :aria-describedby="formErrorField === 'date' ? 'event-form-error' : undefined" /></label>
          <div class="date-shortcuts" role="group" aria-label="快捷日期"><button type="button" @click="form.date = appToday">今天</button><button type="button" @click="form.date = shiftEventDate(appToday, 1)">明天</button><button type="button" @click="form.date = ''; clearTime()">待安排</button></div>
        </div>
        <div class="form-grid-inline">
          <div class="field"><span id="event-start-label">开始时间</span><button type="button" data-field="time" class="time-field" aria-labelledby="event-start-label" :aria-invalid="formErrorField === 'time' || undefined" :aria-describedby="formErrorField === 'time' ? 'event-form-error' : undefined" @click="wheelField = 'time'">{{ form.time || '选择时间' }}</button></div>
          <div class="field"><span id="event-end-label">结束时间</span><button type="button" data-field="endTime" class="time-field" aria-labelledby="event-end-label" :aria-invalid="formErrorField === 'endTime' || undefined" :aria-describedby="formErrorField === 'endTime' ? 'event-form-error' : undefined" @click="wheelField = 'endTime'">{{ form.endTime || '可选' }}</button></div>
        </div>
        <div class="duration-shortcuts" role="group" aria-label="快捷时长"><span>时长</span><button v-for="minutes in [30, 60, 90, 120]" :key="minutes" type="button" :disabled="!form.time" @click="setDuration(minutes)">{{ minutes }} 分钟</button><button v-if="form.time || form.endTime" type="button" @click="clearTime">清除时间</button></div>
        <p v-if="liveConflicts.length" class="event-conflict-hint">与 {{ liveConflicts.length }} 条安排时间重叠：{{ liveConflicts.slice(0, 3).map((item) => item.entityName).join('、') }}。保存时可以继续或返回调整。</p>
        <label class="field">地点<input v-model="form.location" maxlength="60" placeholder="可选，例如：图书馆三楼" /></label>
        <div class="form-grid-inline">
          <label class="field">关联课程<select v-model="form.courseId" @change="selectCourse"><option value="">{{ form.courseName ? '保留原课程名称' : '不关联课程' }}</option><option v-if="form.courseId && !courseOptions.some((course) => String(course.id) === String(form.courseId))" :value="form.courseId">{{ form.courseName || '原关联课程' }}</option><option v-for="course in courseOptions" :key="course.id" :value="course.id">{{ course.name }}{{ course.teacher ? ` · ${course.teacher}` : '' }}{{ course.room ? ` · ${course.room}` : '' }}</option></select></label>
          <label class="field">课程名称<input v-model="form.courseName" maxlength="60" :readonly="Boolean(form.courseId)" placeholder="也可以手动填写" /></label>
        </div>
        <div class="event-reminder-settings">
          <label class="reminder-toggle"><input v-model="form.reminderEnabled" type="checkbox" />提醒我</label>
          <label v-if="form.reminderEnabled" class="reminder-minutes">提前<input v-model="form.reminderMinutes" data-field="reminderMinutes" type="number" min="0" step="1" :aria-invalid="formErrorField === 'reminderMinutes' || undefined" :aria-describedby="formErrorField === 'reminderMinutes' ? 'event-form-error' : undefined" />分钟</label>
          <div v-if="form.reminderEnabled" class="reminder-shortcuts" role="group" aria-label="快捷提醒时间"><button v-for="minutes in [0, 15, 30, 60]" :key="minutes" type="button" :aria-pressed="Number(form.reminderMinutes) === minutes" @click="form.reminderMinutes = minutes">{{ minutes ? `${minutes} 分钟` : '到点' }}</button></div>
        </div>
        <p v-if="form.reminderEnabled" class="field-hint">{{ !form.date ? '选好日期后才会提醒。' : !form.time ? '未指定时间时，以当天 23:59 为提醒基准。' : '应用打开时按设置提醒。' }}<template v-if="notificationState === 'prompt'"> <button type="button" class="inline-link" :disabled="notificationBusy" @click="enableNotifications">{{ notificationBusy ? '正在启用…' : '启用浏览器通知' }}</button></template><template v-else-if="notificationState === 'denied'">浏览器通知已关闭，可在浏览器设置中开启。</template><template v-else-if="notificationState === 'unsupported'">当前浏览器不支持系统通知。</template></p>
        <label class="field">备注<textarea v-model="form.note" rows="3" placeholder="议题、要带的东西或其他细节"></textarea></label>
        <p v-if="formError" id="event-form-error" class="form-error" role="alert">{{ formError }}</p>
        <div class="form-actions"><button type="button" class="btn" @click="closeForm">取消</button><button type="submit" class="btn btn-primary">{{ editing ? '保存' : '添加' }}</button></div>
      </form>
    </Modal>
    <Modal v-if="detail" :open="Boolean(detail)" title="日程详情" medium @close="detail = null">
      <div class="event-detail" :data-focus-id="detail.id">
        <span class="event-state" :data-state="stateOf(detail).key">{{ stateOf(detail).label }}</span><h3>{{ detail.title }}</h3>
        <dl><div><dt>日期</dt><dd>{{ dayLabel(detail.date) }}</dd></div><div><dt>时间</dt><dd>{{ timeRangeOf(detail) }}<template v-if="eventDuration(detail)"> · {{ eventDuration(detail) }}</template></dd></div><div v-if="detail.location"><dt>地点</dt><dd>{{ detail.location }}</dd></div><div v-if="detail.courseName"><dt>课程</dt><dd>{{ detail.courseName }}</dd></div><div><dt>提醒</dt><dd>{{ reminderOf(detail) }}</dd></div><div v-if="sourceOf(detail)"><dt>来源</dt><dd>{{ sourceOf(detail) }}</dd></div></dl>
        <p v-if="detail.note" class="event-detail-note">{{ detail.note }}</p>
        <details v-if="detail.sourceText && !detail.sourceText.startsWith('ics:')" class="event-source"><summary>查看原文</summary><p>{{ detail.sourceText }}</p></details>
        <div class="detail-actions"><button v-if="!isArchived(detail)" type="button" class="btn btn-primary" @click="editDetail">编辑日程</button><button v-else type="button" class="btn btn-primary" @click="restore(detail)">恢复日程</button><button type="button" class="btn" @click="copyEvent(detail)">复制为新日程</button></div>
        <router-link v-if="detail.sourceType === 'project-meeting'" class="detail-source-link" to="/projects" @click="detail = null">查看齐行项目 →</router-link>
      </div>
    </Modal>
    <Modal v-if="importOpen" :open="importOpen" title="导入日程" medium @close="importOpen = false"><div class="event-import-tools"><p>从日历或其他工具导入安排，先预览再保存。</p><div><IcsImportButton :records="events" @import="importEvents" /><DomainCsvImportButton kind="events" :records="events" @import="importEvents" /></div></div></Modal>
    <TimeWheelSheet :open="Boolean(wheelField)" :title="wheelField === 'endTime' ? '选择结束时间' : '选择开始时间'" v-model="wheelValue" clearable @close="wheelField = ''" />
    <ConfirmDialog v-if="deleteEventTarget" :open="Boolean(deleteEventTarget)" title="删除日程" :message="`确定删除“${deleteEventTarget.title}”吗？删除后可在提示中撤销。`" confirm-label="删除" @close="deleteEventTarget = null" @confirm="confirmRemove" />
    <ConfirmDialog v-if="saveConflict" :open="Boolean(saveConflict)" title="时间冲突" :message="saveConflict.message" confirm-label="继续保存" cancel-label="返回修改" tone="primary" @close="saveConflict = null" @confirm="confirmConflictSave" />
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :duration="toast.duration" />
  </div>
</template>

<style scoped>
.events-header-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.events-overview { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(240px,1fr); gap:12px; margin-bottom:16px; }
.events-next { min-width:0; padding:18px 20px; }
.next-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; }
.next-date { color:var(--muted); font-size:var(--fs-11); }
.next-event-link { display:grid; gap:6px; width:100%; margin-top:10px; padding:0; color:var(--text); text-align:left; border:0; background:transparent; cursor:pointer; }
.next-event-link strong { font-size:var(--fs-17); overflow-wrap:anywhere; }
.next-event-link > span { color:var(--ink-soft); font-size:var(--fs-12); overflow-wrap:anywhere; }
.next-empty { margin:12px 0 0; color:var(--muted); font-size:var(--fs-13); line-height:1.6; }
.events-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); padding:12px; }
.events-stats button { display:grid; align-content:center; gap:6px; min-width:0; min-height:82px; border:0; border-radius:var(--radius-8); color:var(--ink-soft); background:transparent; cursor:pointer; }
.events-stats button:hover { background:var(--primary-soft); }
.events-stats b { color:var(--text); font-size:var(--fs-24); font-variant-numeric:tabular-nums; }
.events-stats span { font-size:var(--fs-12); }
.events-toolbar { display:grid; gap:14px; margin-bottom:20px; padding:14px; }
.toolbar-top { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.events-view-switch { display:flex; gap:4px; padding:4px; border-radius:var(--radius-9); background:var(--bg-tint); }
.events-view-switch button { min-width:64px; min-height:36px; padding:0 12px; color:var(--ink-soft); border:1px solid transparent; border-radius:var(--radius-6); background:transparent; font:inherit; font-size:var(--fs-12); font-weight:var(--fw-700); cursor:pointer; }
.events-view-switch button.on { border-color:var(--border); color:var(--primary); background:var(--card); }
.search-field { display:grid; flex:1; min-width:180px; }
.search-field input { width:100%; min-height:42px; padding:9px 12px; color:var(--text); border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg); font:inherit; font-size:var(--fs-12); }
.events-filters, .calendar-scope { display:flex; flex-wrap:wrap; gap:7px; }
.filter-tab { display:flex; align-items:center; gap:7px; min-height:38px; padding:6px 12px; color:var(--ink-soft); font-size:var(--fs-12); font-weight:var(--fw-700); border:1px solid var(--border); border-radius:var(--radius-pill); background:var(--bg); cursor:pointer; }
.filter-tab span { font-size:var(--fs-10); font-variant-numeric:tabular-nums; }
.filter-tab.on { color:var(--on-primary); border-color:var(--primary); background:var(--primary); }
.events-workspace { min-width:0; }
.events-workspace.calendar-mode { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr)); gap:20px; }
.events-agenda { min-width:0; }
.agenda-header { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
.agenda-header > div { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.agenda-header h2 { margin:0; font-size:var(--fs-15); color:var(--text); }
.agenda-actions .btn { padding:6px 9px; font-size:var(--fs-11); }
.events-count { color:var(--muted); font-size:var(--fs-11); white-space:nowrap; }
:deep(.event-virtual-list) { display:grid; gap:8px; }
.event-day-label { display:flex; align-items:center; gap:8px; margin:14px 0 8px; color:var(--ink-soft); font-size:var(--fs-12); font-weight:var(--fw-700); }
.event-day-label span { color:var(--muted); font-size:var(--fs-10); font-weight:var(--fw-500); }
.event-card { display:flex; align-items:center; gap:14px; min-width:0; max-width:100%; padding:16px; box-sizing:border-box; }
.event-card.ongoing { border-color:var(--primary); }
.event-time-column { display:grid; gap:5px; align-self:flex-start; min-width:48px; margin-top:3px; font-variant-numeric:tabular-nums; }
.event-time-column b { color:var(--text); font-size:var(--fs-14); }
.event-time-column span { color:var(--muted); font-size:var(--fs-11); }
.event-card-main { display:grid; flex:1; gap:6px; min-width:0; }
.event-line1 { display:flex; align-items:center; flex-wrap:wrap; gap:7px; min-width:0; }
.event-title { max-width:100%; padding:0; border:0; color:var(--text); font:inherit; font-size:var(--fs-14); font-weight:var(--fw-800); text-align:left; background:transparent; overflow-wrap:anywhere; cursor:pointer; }
.event-title:hover { color:var(--primary); }
.event-state { display:inline-flex; align-items:center; justify-self:start; padding:3px 7px; color:var(--ink-soft); font-size:var(--fs-10); border-radius:var(--radius-pill); background:var(--bg-tint); white-space:nowrap; }
.event-state[data-state='ongoing'], .event-state[data-state='today'] { color:var(--primary); background:var(--primary-soft); }
.event-card.past .event-time-column b { color:var(--muted); }
.event-meta { display:flex; flex-wrap:wrap; gap:6px 10px; color:var(--muted); font-size:var(--fs-11); overflow-wrap:anywhere; }
.event-course { color:var(--primary); }
.event-note { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin:0; color:var(--muted); font-size:var(--fs-12); line-height:1.5; white-space:pre-wrap; overflow-wrap:anywhere; }
.event-card-actions { display:flex; gap:5px; flex:0 0 auto; }
.event-card-actions button { min-height:34px; padding:5px 9px; color:var(--primary); font-size:var(--fs-11); font-weight:var(--fw-700); border:0; border-radius:var(--radius-6); background:var(--primary-soft); cursor:pointer; }
.event-card-actions .danger-text { color:var(--danger); background:var(--danger-soft); }
.calendar-mode .event-card { flex-wrap:wrap; }
.calendar-mode .event-card-actions { width:100%; justify-content:flex-end; }
.add-day-event { width:100%; margin-top:12px; }
.event-form { display:grid; gap:14px; }
.field { display:grid; gap:6px; color:var(--ink-soft); font-size:var(--fs-12); font-weight:var(--fw-700); }
.field input, .field textarea, .field select { width:100%; min-width:0; min-height:42px; padding:9px 11px; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg); font:inherit; color:var(--text); box-sizing:border-box; }
.field textarea { resize:vertical; line-height:1.6; }
.time-field { width:100%; min-height:42px; padding:9px 11px; color:var(--text); text-align:left; border:1px solid var(--border); border-radius:var(--radius-8); background:var(--bg); font:inherit; font-variant-numeric:tabular-nums; cursor:pointer; }
.form-grid-inline { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.form-section { display:grid; gap:8px; }
.date-shortcuts, .duration-shortcuts, .reminder-shortcuts { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.date-shortcuts button, .duration-shortcuts button, .reminder-shortcuts button { min-height:32px; padding:5px 10px; color:var(--primary); border:1px solid var(--border); border-radius:var(--radius-pill); background:var(--bg); font-size:var(--fs-11); cursor:pointer; }
.duration-shortcuts > span { margin-right:3px; color:var(--muted); font-size:var(--fs-11); }
.reminder-shortcuts button[aria-pressed='true'] { background:var(--primary-soft); border-color:var(--primary); }
.event-conflict-hint { margin:0; padding:10px 12px; border-radius:var(--radius-8); background:var(--bg-tint); color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.event-reminder-settings { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; border:1px solid var(--border); border-radius:var(--radius-9); }
.reminder-toggle, .reminder-minutes { display:flex; align-items:center; gap:7px; color:var(--ink-soft); font-size:var(--fs-12); }
.reminder-toggle input { width:16px; height:16px; accent-color:var(--primary); }
.reminder-minutes input { width:76px; min-height:36px; padding:5px 8px; border:1px solid var(--border); border-radius:var(--radius-6); background:var(--bg); color:var(--text); }
.field-hint { margin:-4px 0 0; color:var(--muted); font-size:var(--fs-11); line-height:1.6; }
.inline-link { padding:0; border:0; background:transparent; color:var(--primary); font:inherit; text-decoration:underline; cursor:pointer; }
.form-error { margin:0; color:var(--danger); font-size:var(--fs-12); }
.form-actions, .detail-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
.event-detail { display:grid; gap:14px; }
.event-detail h3 { margin:0; color:var(--text); font-size:var(--fs-18); overflow-wrap:anywhere; }
.event-detail dl { display:grid; gap:12px; margin:0; }
.event-detail dl > div { display:grid; grid-template-columns:42px minmax(0,1fr); gap:12px; font-size:var(--fs-13); }
.event-detail dt { color:var(--muted); }
.event-detail dd { margin:0; color:var(--text); overflow-wrap:anywhere; }
.event-detail-note, .event-source p { margin:0; color:var(--ink-soft); font-size:var(--fs-13); line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }
.event-source { color:var(--muted); font-size:var(--fs-12); }
.event-source summary { margin-bottom:8px; cursor:pointer; }
.detail-source-link { justify-self:end; color:var(--primary); font-size:var(--fs-12); }
.event-import-tools { display:grid; gap:16px; }
.event-import-tools p { margin:0; color:var(--ink-soft); font-size:var(--fs-13); line-height:1.6; }
.event-import-tools > div { display:flex; gap:12px; flex-wrap:wrap; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0; }
@media (max-width:760px) {
  .events-overview { grid-template-columns:minmax(0,1fr); gap:8px; }
  .events-next { padding:16px; }
  .events-stats { padding:4px 10px; }
  .events-stats button { min-height:62px; gap:4px; }
  .events-stats b { font-size:var(--fs-21); }
  .events-toolbar { padding:12px; gap:12px; }
  .toolbar-top { gap:8px; }
  .events-view-switch { flex-shrink:0; }
  .search-field { min-width:130px; }
  .filter-tab { padding:6px 10px; }
  .event-card { flex-wrap:wrap; padding:14px 12px; gap:10px; }
  .event-card-actions { width:100%; justify-content:flex-end; }
  .event-card-actions button { min-height:36px; padding:5px 13px; }
  .agenda-header { align-items:flex-start; }
  .agenda-actions { justify-content:flex-end; }
  .events-header-actions { gap:5px; }
}
@media print { .events-header-actions, .events-toolbar, .event-card-actions, .agenda-actions, .add-day-event { display:none; } }
</style>
