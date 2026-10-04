<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import EmptyState from '../components/EmptyState.vue'
import VirtualList from '../components/VirtualList.vue'
import { useDomainCommands } from '../composables/domain/commands.js'
import { filterNotes, noteText } from '../composables/notes.js'
import { useDebouncedRef } from '../composables/useDebouncedRef.js'
import { useQuickRecordAdapters } from '../composables/quickRecord/adapters.js'
import { clearFocusFromRoute, focusLocation, readFocusQuery } from '../composables/focusNavigation.js'
import { flushStoredWrites, persistenceState } from '../composables/store/core.js'

const router = useRouter()
const route = useRoute()
const domain = useDomainCommands()
const quickRecord = useQuickRecordAdapters()
const query = ref('')
const includeArchived = ref(false)
const selected = ref(null)
const focusedNoteId = ref('')
const editing = ref(false)
const editTitle = ref('')
const editContent = ref('')
const noteError = ref('')
// noteError 有两类来源：字段校验（正文为空）与保存失败（笔记已删除 / 落盘失败）。
// 只有前者应该把输入框标成无效并建立 aria 关联——保存失败说输入框有问题会误导读屏用户。
const noteErrorField = ref('')
const contentInput = ref(null)
const noteMessage = ref('')
let focusHandled = ''

// filterNotes 内部是 filter + filter + sort(带 localeCompare)，每敲一个字都跑一遍
// 在笔记变多后是能感觉到的卡顿。输入框照旧跟 query，只有真正过滤用防抖后的值。
const debouncedQuery = useDebouncedRef(query, 160)
const visibleNotes = computed(() => filterNotes(domain.notes.value, debouncedQuery.value, { includeArchived: includeArchived.value }))
const selectedRelations = computed(() => {
  const id = selected.value?.id
  if (!id) return { tasks: [], events: [] }
  return {
    tasks: domain.tasks.value.filter((item) => item.sourceType === 'note' && item.sourceId === id),
    events: domain.events.value.filter((item) => item.sourceType === 'note' && item.sourceId === id),
  }
})

function openNote(note) {
  selected.value = note
  editing.value = false
  setNoteError('')
  noteMessage.value = ''
}

function startEdit(note) {
  selected.value = note
  editTitle.value = note.title || ''
  editContent.value = noteText(note)
  editing.value = true
  setNoteError('')
  noteMessage.value = ''
}

function cancelEdit() {
  editing.value = false
  setNoteError('')
}

// 单一入口，保证 noteError / noteErrorField 不会各自漂移。
// field 非空表示这是字段校验错误：输入框标 aria-invalid 并把焦点移回去。
function setNoteError(message, field = '') {
  noteError.value = message
  noteErrorField.value = message ? field : ''
  if (message && field === 'content') {
    nextTick(() => contentInput.value?.focus())
  }
}

function saveNote() {
  const content = editContent.value.trim()
  if (!content) {
    setNoteError('正文不能为空', 'content')
    return
  }
  const beforeAt = persistenceState.value.at
  const updated = domain.updateNote(selected.value?.id, { title: editTitle.value.trim(), content, sourceText: content })
  if (!updated) {
    setNoteError('这条笔记可能已删除或已移动。')
    return
  }
  flushStoredWrites()
  if (persistenceState.value.status === 'error' && persistenceState.value.at >= beforeAt) {
    setNoteError(persistenceState.value.message || '本次修改未能保存到本机，请先导出数据。')
    return
  }
  selected.value = updated
  editing.value = false
  setNoteError('')
  noteMessage.value = '已保存'
}

function convert(note, targetType) {
  const result = quickRecord.convertNote(note.id, targetType)
  noteMessage.value = result.message || result.error || '已更新'
  if (result.ok) selected.value = domain.notes.value.find((item) => item.id === note.id) || selected.value
}

function archiveNote(note) {
  domain.archiveNote(note.id)
  if (selected.value?.id === note.id) selected.value = null
}

function restoreNote(note) {
  domain.restoreNote(note.id)
}

// 删除确认沿用仓库既有的「state + 回调」惯例：先置目标，由 ConfirmDialog 决定是否真的删。
// 存的是这条笔记对象本身（不是弹窗那一刻重新去 notes 里查），所以对话框期间列表怎么变
// 都不会删错目标——id 从同一个对象上取。
const deleteNoteTarget = ref(null)

function deleteNote(note) {
  deleteNoteTarget.value = note
}

function confirmDeleteNote() {
  const target = deleteNoteTarget.value
  deleteNoteTarget.value = null
  if (!target) return
  domain.deleteNote(target.id)
  if (selected.value?.id === target.id) selected.value = null
}

async function focusRouteNote() {
  const { id } = readFocusQuery(route)
  if (!id || focusHandled === id) return
  focusHandled = id
  const note = domain.notes.value.find((item) => String(item.id) === id)
  if (!note) {
    noteMessage.value = '这条笔记可能已删除或已移动。'
    await clearFocusFromRoute(router, route)
    return
  }
  focusedNoteId.value = id
  openNote(note)
  await clearFocusFromRoute(router, route)
}

watch(
  () => [route.query.focus, domain.notes.value.length],
  () => { void focusRouteNote() },
  { immediate: true }
)
</script>

<template>
  <div class="page notes-page">
    <header class="page-header compact-page-header">
      <div><span class="eyebrow">QUICK NOTES</span><h1>笔记</h1><p>快速记录的轻量入口：搜索、编辑、整理或删除。</p></div>
      <button type="button" class="btn" @click="router.push('/')">返回首页</button>
    </header>

    <section class="notes-toolbar panel" aria-label="笔记筛选">
      <label class="search-field"><span>搜索笔记</span><input v-model="query" type="search" placeholder="标题、内容或标签" /></label>
      <label class="notes-archive-toggle"><input v-model="includeArchived" type="checkbox" /> 包含已归档</label>
      <span class="notes-count">{{ visibleNotes.length }} 条</span>
    </section>

    <VirtualList v-if="visibleNotes.length" v-slot="{ item: note }" class="notes-list" :items="visibleNotes" :estimated-height="72" :gap="8" :threshold="50" :reveal-key="focusedNoteId" aria-label="笔记列表">
      <article class="note-card panel" :class="{ archived: note.archivedAt, 'focus-target-highlight': focusedNoteId === note.id }" :data-focus-id="note.id">
        <button type="button" class="note-card-main" @click="openNote(note)">
          <span class="note-card-title">{{ note.title || '未命名笔记' }}</span>
          <span class="note-card-preview">{{ noteText(note) }}</span>
          <small>{{ note.archivedAt ? '已归档' : '未归档' }}<template v-if="note.tags?.length"> · {{ note.tags.map(tag => `#${tag}`).join(' ') }}</template></small>
        </button>
        <div class="note-card-actions">
          <button v-if="note.archivedAt" type="button" @click="restoreNote(note)">恢复</button>
          <button v-else type="button" @click="archiveNote(note)">归档</button>
          <button type="button" class="danger-text" @click="deleteNote(note)">删除</button>
        </div>
      </article>
    </VirtualList>
    <EmptyState :level="2" v-else title="还没有匹配的笔记" description="在首页使用“记录”保存一段想法，之后可以在这里集中查看。" />

    <p v-if="noteMessage" class="notice-success" role="status">✓ {{ noteMessage }}</p>

    <Modal v-if="selected" :open="Boolean(selected)" :title="editing ? '编辑笔记' : (selected.title || '笔记详情')" @close="selected = null">
      <article v-if="editing" class="note-detail">
        <label class="note-edit-field">标题<input v-model="editTitle" maxlength="42" placeholder="可选标题" /></label>
        <label class="note-edit-field">正文<textarea
          ref="contentInput"
          v-model="editContent"
          rows="8"
          autofocus
          :aria-invalid="noteErrorField === 'content' || undefined"
          :aria-describedby="noteError ? 'note-edit-error' : undefined"
        ></textarea></label>
        <p v-if="noteError" id="note-edit-error" class="note-error" role="alert">{{ noteError }}</p>
        <div class="note-detail-actions"><button type="button" class="btn" @click="cancelEdit">取消</button><button type="button" class="btn btn-primary" @click="saveNote">保存</button></div>
      </article>
      <article v-else class="note-detail">
        <p>{{ noteText(selected) }}</p>
        <small v-if="selected.tags?.length">{{ selected.tags.map(tag => `#${tag}`).join(' ') }}</small>
        <div class="note-relations">
          <strong>关联</strong>
          <template v-if="selectedRelations.tasks.length || selectedRelations.events.length">
            <RouterLink v-for="task in selectedRelations.tasks" :key="`task-${task.id}`" :to="focusLocation('/tasks', task.id)" class="relation-chip">待办：{{ task.title }}</RouterLink>
            <RouterLink v-for="event in selectedRelations.events" :key="`event-${event.id}`" :to="focusLocation('/', event.id, { section: 'event' })" class="relation-chip">日程：{{ event.title }}</RouterLink>
          </template>
          <span v-else class="relation-empty">还没有转换为任务或日程</span>
        </div>
        <div class="note-convert-actions" v-if="!selected.archivedAt && !selectedRelations.tasks.length"><button type="button" class="btn" @click="convert(selected, 'todo')">转为待办</button></div>
        <div class="note-convert-actions" v-if="!selected.archivedAt && !selectedRelations.events.length"><button type="button" class="btn" @click="convert(selected, 'event')">转为日程</button></div>
        <div class="note-detail-actions"><button type="button" class="btn" @click="startEdit(selected)">编辑</button><button v-if="selected.archivedAt" type="button" class="btn" @click="restoreNote(selected)">恢复</button><button v-else type="button" class="btn" @click="archiveNote(selected)">归档</button><button type="button" class="btn btn-danger" @click="deleteNote(selected)">删除</button></div>
      </article>
    </Modal>

    <!-- 详情弹窗里也有「删除」，所以这里必须 v-if 随目标挂载（否则会被详情弹窗盖住，
         见 ConfirmDialog 顶部的浮层顺序说明）。 -->
    <ConfirmDialog
      v-if="deleteNoteTarget"
      :open="Boolean(deleteNoteTarget)"
      title="删除笔记"
      :message="`确定删除“${deleteNoteTarget?.title || '这条笔记'}”吗？`"
      confirm-label="删除"
      @close="deleteNoteTarget = null"
      @confirm="confirmDeleteNote"
    />
  </div>
</template>

<style scoped>
.notes-toolbar { display: flex; align-items: end; gap: 12px; margin-bottom: 14px; padding: 12px; }
.search-field { display: grid; flex: 1; gap: 5px; color: var(--ink-soft); font-size: var(--fs-11); font-weight: var(--fw-700); }
.search-field input { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); }
.notes-archive-toggle { display: flex; align-items: center; gap: 6px; min-height: 38px; color: var(--ink-soft); font-size: var(--fs-11); white-space: nowrap; }
.notes-count { color: var(--muted); font-size: var(--fs-11); white-space: nowrap; }
.notes-list { display: flex; flex-direction: column; gap: 8px; }
.note-card { display: flex; align-items: center; gap: 12px; padding: 12px; }
.note-card-main { display: grid; flex: 1; gap: 4px; min-width: 0; padding: 0; text-align: left; border: 0; background: transparent; cursor: pointer; }
.note-card-title { overflow: hidden; color: var(--text); font-size: var(--fs-14); font-weight: var(--fw-800); text-overflow: ellipsis; white-space: nowrap; }
.note-card-preview { overflow: hidden; color: var(--ink-soft); font-size: var(--fs-12); text-overflow: ellipsis; white-space: nowrap; }
.note-card small { color: var(--muted); font-size: var(--fs-10-5); }
.note-card.archived { opacity: .72; }
.note-card-actions { display: flex; gap: 6px; }
.note-card-actions button { padding: 5px 7px; color: var(--primary); font-size: var(--fs-11); font-weight: var(--fw-750); border: 0; border-radius: var(--radius-6); background: var(--primary-soft); }
.note-card-actions .danger-text { color: var(--danger); background: var(--danger-soft); }
.note-detail { display: grid; gap: 12px; }
.note-detail p { margin: 0; white-space: pre-wrap; line-height: 1.7; }
.note-detail small { color: var(--primary); }
.note-edit-field { display: grid; gap: 5px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.note-edit-field input, .note-edit-field textarea { width: 100%; padding: 9px 10px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg); font: inherit; color: var(--text); }
.note-edit-field textarea { resize: vertical; line-height: 1.6; }
.note-error { margin: 0; color: var(--danger); font-size: var(--fs-12); }
.note-relations { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
.note-relations strong { width: 100%; color: var(--ink-soft); font-size: var(--fs-12); }
.relation-chip { padding: 4px 8px; color: var(--primary); font-size: var(--fs-11); text-decoration: none; border-radius: var(--radius-pill); background: var(--primary-soft); }
.relation-empty { color: var(--muted); font-size: var(--fs-11); }
.note-convert-actions { display: inline-flex; }
.note-detail-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 520px) { .notes-toolbar { align-items: stretch; flex-wrap: wrap; } .search-field { flex-basis: 100%; } .note-card { align-items: stretch; flex-direction: column; } .note-card-actions { width: 100%; } .note-card-actions button { flex: 1; } }
</style>
