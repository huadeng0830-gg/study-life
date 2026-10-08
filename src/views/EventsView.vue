<script setup>
import { computed, ref } from 'vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TimeWheelSheet from '../components/TimeWheelSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import DomainCsvImportButton from '../components/DomainCsvImportButton.vue'
import IcsImportButton from '../components/IcsImportButton.vue'
import SocialCalendarEvents from '../components/SocialCalendarEvents.vue'
import VirtualList from '../components/VirtualList.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { isArchived } from '../composables/domain/state.js'
import { appToday, formatAppDate } from '../composables/timeContext.js'
import { detectTaskEventConflicts, getConflictSummary } from '../composables/conflictDetection.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { announce, announceAlert } from '../composables/liveRegion.js'


const domain = useDomainCommands()
const { events } = domain

const FILTERS = [
  { key: 'upcoming', label: '即将到来' },
  { key: 'past', label: '已过去' },
  { key: 'archived', label: '已归档' },
]
const filter = ref('upcoming')
const query = ref('')

const formOpen = ref(false)
const editing = ref(null)
const form = ref(emptyForm())
const formError = ref('')
// 与 LedgerView 同一套约定：记录是哪个字段不过，用于 aria-invalid 与焦点回跳。
// 保存失败（catch 分支）不带 field —— 那是操作失败，不是输入有问题。
const formErrorField = ref('')
const titleInput = ref(null)
function setFormError(message, field = '') {
  formError.value = message
  formErrorField.value = message ? field : ''
  if (message) announceAlert(message, { clearAfter: 7000 })
  if (message && field === 'title') titleInput.value?.focus()
}
const notice = ref('')
// 正在用滚轮编辑的时间字段：'' | 'time' | 'endTime'
const wheelField = ref('')
// 删除目标与「冲突是否继续」的待确认状态：沿用仓库既有的 state + 回调惯例
// （见 TasksView / LedgerView / ExamsView / ListsView 的同名用法）。
const deleteEventTarget = ref(null)
// { message, payload, editingId } —— payload 与 editingId 都是弹窗之前就快照好的。
const saveConflict = ref(null)
let noticeTimer = 0

// 一个面板服务两个字段，靠 wheelField 决定写回哪一个
const wheelValue = computed({
  get: () => (wheelField.value ? form.value[wheelField.value] : ''),
  set: (value) => {
    if (!wheelField.value) return
    form.value[wheelField.value] = value
  },
})

function emptyForm() {
  return { title: '', date: '', time: '', endTime: '', location: '', courseName: '', note: '' }
}

function showNotice(message) {
  notice.value = message
  announce(message, { clearAfter: 5000 })
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => { notice.value = '' }, 3200)
}

const emptyState = computed(() => query.value
  ? { title: '没有匹配的日程', description: '换个关键词试试。' }
  : { title: '还没有日程', description: '在首页使用「记录」快速录入，或粘贴群通知识别保存后，就会在这里集中显示。' })

// 搜索词与查询解耦：输入框跟 query（即时反馈），整表过滤 + localeCompare 排序只跑在
// debouncedQuery 上。每敲一个字都要过一遍全表并重排一次，日程多了就是可见的卡顿。
const debouncedQuery = useDebouncedRef(query, 160)

const visibleEvents = computed(() => {
  const today = appToday.value
  const text = debouncedQuery.value.trim().toLowerCase()
  let list = domain.events.value.filter((event) => {
    if (!event || event.deletedAt || event.tombstone) return false
    const archived = isArchived(event)
    if (filter.value === 'archived') return archived
    if (archived) return false
    if (filter.value === 'upcoming') return !event.date || event.date >= today
    if (filter.value === 'past') return Boolean(event.date) && event.date < today
    return true
  })
  if (text) {
    list = list.filter((event) => [event.title, event.location, event.note, event.courseName]
      .some((value) => String(value ?? '').toLowerCase().includes(text)))
  }
  return [...list].sort((a, b) => {
    const aDate = a.date || '9999-99-99'
    const bDate = b.date || '9999-99-99'
    if (aDate !== bDate) return filter.value === 'past' ? (bDate < aDate ? -1 : 1) : (aDate < bDate ? -1 : 1)
    const aTime = a.time || ''
    const bTime = b.time || ''
    if (aTime !== bTime) return aTime < bTime ? -1 : 1
    return String(a.id).localeCompare(String(b.id))
  })
})

function timeRangeOf(event) {
  if (!event.time) return ''
  return event.endTime ? `${event.time}–${event.endTime}` : event.time
}

function relativeOf(event) {
  if (!event.date) return '未安排日期'
  const today = appToday.value
  if (event.date === today) return '今天'
  if (event.date < today) return '已过去'
  return formatAppDate(event.date)
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  setFormError('')
  formOpen.value = true
}

function openEdit(event) {
  editing.value = event
  form.value = {
    title: event.title || '',
    date: event.date || '',
    time: event.time || '',
    endTime: event.endTime || '',
    location: event.location || '',
    courseName: event.courseName || '',
    note: event.note || '',
  }
  setFormError('')
  formOpen.value = true
}

function save() {
  const title = form.value.title.trim()
  if (!title) {
    setFormError('请填写日程内容', 'title')
    return
  }
  const payload = {
    title,
    date: form.value.date,
    time: form.value.time,
    endTime: form.value.endTime,
    location: form.value.location.trim(),
    courseName: form.value.courseName.trim(),
    note: form.value.note.trim(),
  }
  // 正在编辑哪一条也在弹确认之前取好：确认期间 editing.value 可能被别的路径改写，
  // 晚读会写错对象（新建变成覆盖、或反之）。
  const editingId = editing.value?.id ?? null

  if (payload.date) {
    const allItems = [...domain.tasks.value, ...domain.events.value]
    const conflicts = detectTaskEventConflicts(payload, allItems, payload.date, 'event')
    const summary = getConflictSummary(conflicts)
    if (summary.hasConflicts) {
      // 冲突提示是「继续保存 / 返回修改」，不是删除。用红色危险键会把
      // 一次正常的保存暗示成破坏性操作，所以走 tone="primary"。
      saveConflict.value = { message: `${summary.message}\n是否继续保存？`, payload, editingId }
      return
    }
  }

  commitSave(payload, editingId)
}

/** 真正落盘的唯一出口：确认与无冲突两条路径都走它，避免两处校验/写库漂移。 */
function commitSave(payload, editingId) {
  try {
    if (editingId) {
      domain.updateEvent(editingId, payload)
      showNotice('已保存')
    } else {
      domain.createEvent(payload)
      showNotice('已添加日程')
    }
    formOpen.value = false
  } catch (error) {
    // 保存失败不是字段的问题，不带 field —— 只提示、不把输入框标红、不抢焦点。
    setFormError(error?.message || '保存失败，请重试')
  }
}

function confirmConflictSave() {
  const target = saveConflict.value
  saveConflict.value = null
  if (!target) return
  commitSave(target.payload, target.editingId)
}

function archive(event) {
  domain.archiveEvent(event.id)
  showNotice('已归档')
}

function restore(event) {
  domain.restoreEvent(event.id)
  showNotice('已恢复')
}

function remove(event) {
  deleteEventTarget.value = event
}

function confirmRemove() {
  const target = deleteEventTarget.value
  deleteEventTarget.value = null
  if (!target) return
  domain.deleteEvent(target.id)
  showNotice('已删除')
}

function importCsvEvents(rows) {
  rows.forEach((row) => domain.createEvent(row))
  showNotice(`已导入 ${rows.length} 条日程`)
}

function importIcsEvents(rows) {
  let imported = 0
  try {
    for (const row of rows) {
      domain.createEvent(row)
      imported += 1
    }
    showNotice(`已从日历文件导入 ${imported} 条日程`)
  } catch (cause) {
    showNotice(imported ? `已导入 ${imported} 条，后续保存失败：${cause?.message || '请重试'}` : cause?.message || '导入失败，请重试')
  }
}
</script>

<template>
  <div class="page events-page">
    <header class="page-header compact-page-header">
      <div>
        <span class="eyebrow">EVENTS</span>
        <h1>日程</h1>
        <p>集中查看、整理由快速记录或通知识别保存的日程安排。</p>
      </div>
      <div class="events-header-actions">
        <DomainCsvImportButton kind="events" :records="events" @import="importCsvEvents" />
        <IcsImportButton :records="events" @import="importIcsEvents" />
        <button type="button" class="btn btn-primary" @click="openCreate">＋ 新建日程</button>
      </div>
    </header>

    <SocialCalendarEvents scope="upcoming" />

    <section class="events-toolbar panel" aria-label="日程筛选">
      <div class="events-filters" role="group" aria-label="日程状态">
        <button
          v-for="item in FILTERS"
          :key="item.key"
          type="button"
          :aria-pressed="filter === item.key"
          :class="['filter-tab', { on: filter === item.key }]"
          @click="filter = item.key"
        >{{ item.label }}</button>
      </div>
      <label class="search-field">
        <span class="sr-only">搜索日程</span>
        <input v-model="query" type="search" placeholder="搜索标题、地点、备注或课程" />
      </label>
      <span class="events-count">{{ visibleEvents.length }} 条</span>
    </section>

    <section v-if="visibleEvents.length" class="events-list" aria-label="日程列表">
      <VirtualList
        :items="visibleEvents"
        class="event-virtual-list"
        :estimated-height="112"
        :gap="8"
        :threshold="30"
        :overscan="4"
      >
        <template #default="{ item: event }">
          <article class="event-card panel" :class="{ past: event.date && event.date < appToday }">
            <div class="event-card-main">
              <div class="event-line1">
                <span class="event-title">{{ event.title }}</span>
                <span v-if="event.courseName" class="event-course">{{ event.courseName }}</span>
              </div>
              <div class="event-meta">
                <span class="event-when">{{ relativeOf(event) }}<template v-if="timeRangeOf(event)"> · {{ timeRangeOf(event) }}</template></span>
                <span v-if="event.location" class="event-loc">📍 {{ event.location }}</span>
              </div>
              <p v-if="event.note" class="event-note">{{ event.note }}</p>
            </div>
            <div class="event-card-actions">
              <button v-if="!isArchived(event)" type="button" @click="openEdit(event)">编辑</button>
              <button v-if="isArchived(event)" type="button" @click="restore(event)">恢复</button>
              <button v-else type="button" @click="archive(event)">归档</button>
              <button type="button" class="danger-text" @click="remove(event)">删除</button>
            </div>
          </article>
        </template>
      </VirtualList>
    </section>
    <EmptyState :level="2" v-else :title="emptyState.title" :description="emptyState.description" />

    <p v-if="notice" class="notice-success" role="status">✓ {{ notice }}</p>

    <Modal v-if="formOpen" :open="formOpen" :title="editing ? '编辑日程' : '新建日程'" medium @close="formOpen = false">
      <div class="event-form">
        <label class="field">日程内容
          <input
            ref="titleInput"
            v-model="form.title"
            maxlength="80"
            placeholder="例如：周五 14 点开组会"
            :aria-invalid="formErrorField === 'title' || undefined"
            :aria-describedby="formError ? 'event-form-error' : undefined"
          />
        </label>
        <div class="form-grid">
          <label class="field">日期
            <input v-model="form.date" type="date" />
          </label>
          <div class="form-grid-inline">
            <div class="field">
              <span>开始时间</span>
              <button type="button" class="time-field" @click="wheelField = 'time'">
                {{ form.time || '选择时间' }}
              </button>
            </div>
            <div class="field">
              <span>结束时间</span>
              <button type="button" class="time-field" @click="wheelField = 'endTime'">
                {{ form.endTime || '可选' }}
              </button>
            </div>
          </div>
        </div>
        <label class="field">地点
          <input v-model="form.location" maxlength="60" placeholder="可选" />
        </label>
        <label class="field">关联课程
          <input v-model="form.courseName" maxlength="60" placeholder="可选，例如：高等数学" />
        </label>
        <label class="field">备注
          <textarea v-model="form.note" rows="3" placeholder="可选"></textarea>
        </label>
        <p v-if="formError" id="event-form-error" class="form-error" role="alert">{{ formError }}</p>
        <div class="form-actions">
          <button type="button" class="btn" @click="formOpen = false">取消</button>
          <button type="button" class="btn btn-primary" @click="save">{{ editing ? '保存' : '添加' }}</button>
        </div>
      </div>
    </Modal>

    <TimeWheelSheet
      :open="Boolean(wheelField)"
      :title="wheelField === 'endTime' ? '选择结束时间' : '选择开始时间'"
      v-model="wheelValue"
      clearable
      @close="wheelField = ''"
    />

    <!-- 这两处都可能叠在「新建/编辑日程」表单之上，所以 v-if 随目标挂载：
         锚点在打开这一刻才创建，才能排在那层浮层之后（见 ConfirmDialog 顶部说明）。 -->
    <ConfirmDialog
      v-if="deleteEventTarget"
      :open="Boolean(deleteEventTarget)"
      title="删除日程"
      :message="`确定删除“${deleteEventTarget?.title || '这条日程'}”吗？`"
      confirm-label="删除"
      @close="deleteEventTarget = null"
      @confirm="confirmRemove"
    />

    <ConfirmDialog
      v-if="saveConflict"
      :open="Boolean(saveConflict)"
      title="时间冲突"
      :message="saveConflict?.message || ''"
      confirm-label="继续保存"
      cancel-label="返回修改"
      tone="primary"
      @close="saveConflict = null"
      @confirm="confirmConflictSave"
    />
  </div>
</template>

<style scoped>
.events-toolbar { display: flex; align-items: end; gap: 12px; margin-bottom: 14px; padding: 12px; flex-wrap: wrap; }
.events-header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.events-filters { display: flex; gap: 6px; }
.filter-tab { min-width: 44px; min-height: 38px; padding: 0 13px; color: var(--ink-soft); font-size: var(--fs-12-5); font-weight: var(--fw-700); border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--bg); cursor: pointer; }
.filter-tab.on { color: var(--on-primary, #fff); border-color: var(--primary); background: var(--primary); }
.search-field { display: grid; flex: 1; gap: 5px; min-width: 200px; }
.search-field input { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); }
.events-count { color: var(--muted); font-size: var(--fs-11); white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
.events-list { display: grid; gap: 8px; }
:deep(.event-virtual-list) { display: grid; gap: 8px; }
.event-card { display: flex; align-items: center; gap: 12px; min-width: 0; max-width: 100%; box-sizing: border-box; padding: 12px 14px; }
.event-card.past { opacity: .68; }
.event-card-main { display: grid; flex: 1; gap: 5px; min-width: 0; max-width: 100%; }
.event-line1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.event-title { color: var(--text); font-size: var(--fs-14-5); font-weight: var(--fw-800); }
.event-course { flex: 0 0 auto; padding: 2px 8px; color: var(--primary); font-size: var(--fs-11); font-weight: var(--fw-700); border-radius: var(--radius-pill); background: var(--primary-soft); }
.event-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--ink-soft); font-size: var(--fs-12); }
.event-when { font-variant-numeric: tabular-nums; }
.event-loc { color: var(--muted); }
.event-note { margin: 0; color: var(--muted); font-size: var(--fs-12); line-height: 1.5; white-space: pre-wrap; }
.event-card-actions { display: flex; gap: 6px; flex: 0 0 auto; min-width: 0; max-width: 100%; }
.event-card-actions button { padding: 6px 9px; color: var(--primary); font-size: var(--fs-11-5); font-weight: var(--fw-750); border: 0; border-radius: var(--radius-6); background: var(--primary-soft); }
.event-card-actions .danger-text { color: var(--danger); background: var(--danger-soft); }
.event-form { display: grid; gap: 12px; }
.field { display: grid; gap: 5px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.field input, .field textarea { width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); font: inherit; color: var(--text); }
/* 时间字段改成按钮：点开底部双列滚轮，外观与普通输入框一致 */
.time-field { width: 100%; min-height: 40px; padding: 8px 10px; color: var(--text); text-align: left; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); font: inherit; font-variant-numeric: tabular-nums; touch-action: manipulation; }
.time-field:hover { border-color: var(--primary); }
.field textarea { resize: vertical; line-height: 1.6; }
.form-grid { display: grid; gap: 12px; }
.form-grid-inline { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-error { margin: 0; color: var(--danger); font-size: var(--fs-12); }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; }
/* 提示落在 Modal 的 var(--card) 上，只改字色：原 #0d9463 在浅色 3.87:1、
   深色 4.11:1（深色卡片上写死的深绿一直读不出来）。 */
.notice-success { margin: 12px 0 0; color: var(--success); font-size: var(--fs-12); text-align: center; }
@media (max-width: 900px) {
  .filter-tab,
  .search-field input,
  .field input,
  .field textarea,
  .time-field { min-height: 44px; }
  .event-card-actions { flex-wrap: wrap; }
  .event-card-actions button { min-width: 44px; min-height: 44px; box-sizing: border-box; }
}
@media (max-width: 520px) {
  .events-header-actions { width: 100%; }
  .events-header-actions > * { flex: 1; }
  .events-toolbar { align-items: stretch; }
  .search-field { flex-basis: 100%; }
  .event-card { align-items: flex-start; flex-direction: column; }
  .event-card-actions { width: 100%; flex-wrap: nowrap; }
  .event-card-actions button { flex: 1 1 0; min-width: 0; }
  .form-grid-inline { grid-template-columns: 1fr; }
}
</style>
