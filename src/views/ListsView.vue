<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import Toast from '../components/Toast.vue'
import { appearance } from '../composables/appearance.js'
import { clock } from '../composables/store/index.js'
import { useChecklistCommands } from '../composables/checklists.js'
import { clearFocusFromRoute, readFocusQuery } from '../composables/focusNavigation.js'
import {
  CHECKLIST_CATEGORIES, CHECKLIST_TEMPLATES, CHECKLIST_UNITS, LIST_TYPES, MAX_BATCH_ITEMS,
  checklistAmount, checklistItemName, checklistItems, checklistQuantity, formatChecklistText,
  parseChecklistLines, selectChecklistItems, summarizeChecklist,
} from '../composables/domain/checklistModel.js'

const commands = useChecklistCommands()
const { lists } = commands
const route = useRoute()
const router = useRouter()
const activeId = ref(lists.value[0]?.id ?? null)
const listQuery = ref('')
const filter = ref('all')
const query = ref('')
const category = ref('')
const sort = ref('pending')
/** @type {import('vue').Ref<Record<string, string>>} */
const quickDrafts = ref({})
/** @type {import('vue').Ref<HTMLInputElement | null>} */
const quickInput = ref(null)
/** @type {import('vue').Ref<HTMLDetailsElement | null>} */
const listMenu = ref(null)
const revealId = ref('')
const openSwipeItemId = ref('')
const bulkMode = ref(false)
/** @type {import('vue').Ref<Set<string>>} */
const selectedIds = ref(new Set())
const showListForm = ref(false)
/** @type {import('vue').Ref<string | null>} */
const editingListId = ref(null)
const listName = ref('')
const listType = ref('general')
/** @type {import('vue').Ref<string | number>} */
const listBudget = ref('')
const templateId = ref('')
const listError = ref('')
const listErrorField = ref('name')
const showItemForm = ref(false)
/** @type {import('vue').Ref<string | null>} */
const itemListId = ref(null)
/** @type {import('vue').Ref<string | null>} */
const editingItemId = ref(null)
/** @type {import('vue').Ref<{name: string, quantity: string | number, unit: string, price: string | number, category: string, note: string}>} */
const itemForm = ref(emptyItem())
const itemError = ref('')
const itemErrorField = ref('name')
const showBulkForm = ref(false)
/** @type {import('vue').Ref<string | null>} */
const bulkListId = ref(null)
const bulkText = ref('')
const skipDuplicates = ref(true)
const bulkError = ref('')
/** @type {import('vue').Ref<{kind: string, listId: string, name: string, ids: string[], itemName: string} | null>} */
const confirmTarget = ref(null)
/** @type {import('vue').Ref<{open: boolean, message: string, type: string, actionLabel: string, undoFn?: () => unknown}>} */
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: undefined })
let handledFocus = ''

const typeInfo = (type) => Object.keys(LIST_TYPES).includes(type) ? LIST_TYPES[type] : LIST_TYPES.general
const money = (value) => `¥${Number(value || 0).toFixed(2)}`
const findList = (id) => lists.value.find((list) => list.id === id)
const activeList = computed(() => findList(activeId.value) ?? lists.value[0] ?? null)
const summaries = computed(() => new Map(lists.value.map((list) => [list.id, summarizeChecklist(list)])))
const listSummary = (list) => summaries.value.get(list.id) ?? summarizeChecklist(list)
const stats = computed(() => summaries.value.get(activeList.value?.id) ?? summarizeChecklist(null))
const budgetExceeded = computed(() => (stats.value.budgetRemaining ?? 0) < 0)
const totalPending = computed(() => [...summaries.value.values()].reduce((sum, item) => sum + item.remaining, 0))
const sidebarLists = computed(() => {
  const text = listQuery.value.trim().toLocaleLowerCase()
  return lists.value.filter((list) => `${list.name} ${typeInfo(list.type).label}`.toLocaleLowerCase().includes(text))
})
// sl_checklists uses explicit commits and a shallow ref. Depend on the collection itself:
// activeList can keep the same object identity while its items change.
const visibleItems = computed(() => {
  void lists.value
  return selectChecklistItems(activeList.value, { status: filter.value, query: query.value, category: category.value, sort: sort.value })
})
const categoryOptions = computed(() => {
  void lists.value
  return [...new Set(checklistItems(activeList.value).map((item) => item.category || '其他'))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})
const hasFilters = computed(() => Boolean(query.value.trim() || category.value || filter.value !== 'all'))
const quickName = computed({
  get: () => activeList.value ? quickDrafts.value[activeList.value.id] || '' : '',
  set: (value) => { if (activeList.value) quickDrafts.value[activeList.value.id] = value },
})
const allVisibleSelected = computed(() => visibleItems.value.length > 0 && visibleItems.value.every((item) => selectedIds.value.has(item.id)))
const template = computed(() => CHECKLIST_TEMPLATES.find((item) => item.id === templateId.value))
const formList = computed(() => findList(itemListId.value))
const bulkList = computed(() => findList(bulkListId.value))
const bulkPreview = computed(() => {
  void lists.value
  return parseChecklistLines(bulkText.value, { existingItems: checklistItems(bulkList.value), skipDuplicates: skipDuplicates.value })
})
const itemSubtotal = computed(() => checklistAmount(itemForm.value))
const emptyTitle = computed(() => {
  if (!stats.value.count) return '添加第一项，开始这份清单'
  if (query.value.trim() || category.value) return '没有匹配的事项'
  if (filter.value === 'pending' && !stats.value.remaining) return '这份清单已全部完成'
  if (filter.value === 'done') return '还没有已完成的事项'
  return '暂时没有事项'
})
const emptyDescription = computed(() => !stats.value.count
  ? '直接输入一项，或粘贴多行内容一次添加。'
  : filter.value === 'pending' && !stats.value.remaining && !query.value.trim() && !category.value
    ? '可以保留完成记录，也可以重置勾选，再次使用。'
    : '试试其他关键词、分类，或清除筛选查看全部事项。')
const emptyActionLabel = computed(() => !stats.value.count ? '添加第一项'
  : filter.value === 'pending' && !stats.value.remaining && !query.value.trim() && !category.value ? '再次使用' : '清除筛选')
const confirmTitle = computed(() => ({ list: '删除清单', items: '删除选中事项', completed: '清除已完成事项', reset: '再次使用清单' }[confirmTarget.value?.kind] || '确认操作'))
const confirmMessage = computed(() => {
  const target = confirmTarget.value
  if (!target) return ''
  if (target.kind === 'list') return `确定删除清单“${target.name}”和其中的全部事项吗？删除后可撤销。`
  if (target.kind === 'reset') return `将“${target.name}”中 ${target.ids.length} 项恢复为未完成，保留数量、价格和备注。操作后可撤销。`
  if (target.kind === 'completed') return `清除“${target.name}”中 ${target.ids.length} 个已完成事项？操作后可撤销。`
  return target.itemName ? `确定删除“${target.itemName}”吗？删除后可撤销。` : `确定删除“${target.name}”中选中的 ${target.ids.length} 项吗？删除后可撤销。`
})

function emptyItem() { return { name: '', quantity: 1, unit: '件', price: '', category: '其他', note: '' } }
function closeMenu() { listMenu.value?.removeAttribute('open') }
function closeMenuFromKey() { closeMenu(); listMenu.value?.querySelector('summary')?.focus() }
function clearFilters() { filter.value = 'all'; query.value = ''; category.value = '' }
function exitBulkMode() { bulkMode.value = false; selectedIds.value = new Set() }
function updatedText(list) {
  const time = Date.parse(list.updatedAt || list.createdAt || '')
  if (!Number.isFinite(time)) return ''
  const minutes = Math.max(0, Math.floor((clock.value.getTime() - time) / 60000))
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前更新`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前更新`
  return `${Math.floor(minutes / 1440)} 天前更新`
}
/** @param {string} message @param {{type?: string, undoFn?: () => unknown}} options */
function showToast(message, { type = 'success', undoFn = undefined } = {}) {
  toast.value = { open: true, message, type, actionLabel: undoFn ? '撤销' : '', undoFn }
}
function offerUndo(message, action, listId) {
  showToast(message, { undoFn: () => {
    let restored = null
    try { restored = action() } catch { /* Report missing or changed data after the current toast closes. */ }
    nextTick(() => {
      if (!restored) { showToast('原清单或事项已不存在，无法撤销', { type: 'error' }); return }
      if (listId && findList(listId)) activeId.value = listId
      clearFilters()
      showToast('已撤销')
    })
  } })
}
function focusError(prefix, field) { nextTick(() => document.getElementById(`${prefix}-${field}`)?.focus()) }
function errorField(message) { return message.includes('数量') ? 'quantity' : message.includes('单价') ? 'price' : message.includes('预算') ? 'budget' : 'name' }
function errorMessage(cause) { return cause instanceof Error ? cause.message : '操作失败，请重试' }
function revealAdded(listId, id) {
  activeId.value = listId
  clearFilters()
  exitBulkMode()
  revealId.value = id
}

watch(() => activeList.value?.id, () => {
  clearFilters(); exitBulkMode(); sort.value = 'pending'; openSwipeItemId.value = ''; revealId.value = ''; closeMenu()
}, { flush: 'sync' })
watch(lists, () => {
  if (!findList(activeId.value)) activeId.value = lists.value[0]?.id ?? null
  const valid = new Set(checklistItems(activeList.value).map((item) => item.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => valid.has(id)))
  if (category.value && !categoryOptions.value.includes(category.value)) category.value = ''
})
watch(() => [route.query.focus, lists.value], async () => {
  if (route.path !== '/lists') return
  const { id } = readFocusQuery(route)
  if (!id) { handledFocus = ''; return }
  if (handledFocus === id) return
  handledFocus = id
  const list = lists.value.find((entry) => String(entry.id) === id || checklistItems(entry).some((item) => String(item.id) === id))
  if (list) {
    activeId.value = list.id
    listQuery.value = ''
    clearFilters()
    const item = checklistItems(list).find((entry) => String(entry.id) === id)
    if (item) { revealId.value = item.id; openEditItem(item, list.id) }
  } else showToast('这份清单或事项可能已被删除', { type: 'error' })
  await clearFocusFromRoute(router, route)
}, { immediate: true })

function chooseTemplate(id) {
  const previous = template.value
  templateId.value = id
  if (!listName.value.trim() || listName.value === previous?.name) listName.value = template.value?.name || ''
  listType.value = template.value?.type || 'general'
}
function openCreateList(id = '') {
  editingListId.value = null
  listName.value = ''; listType.value = 'general'; listBudget.value = ''; templateId.value = ''; listError.value = ''
  if (typeof id === 'string' && id) chooseTemplate(id)
  showListForm.value = true
}
function openEditList() {
  const list = activeList.value
  if (!list) return
  closeMenu()
  editingListId.value = list.id
  listName.value = list.name; listType.value = list.type || 'general'; listBudget.value = list.budget ?? ''; listError.value = ''
  showListForm.value = true
}
function saveList() {
  try {
    const data = { name: listName.value, type: listType.value, budget: listType.value === 'shopping' ? listBudget.value : '' }
    const list = editingListId.value ? commands.updateList(editingListId.value, data) : commands.createList({ ...data, items: template.value?.items ?? [] })
    if (!list) throw new Error('这份清单已被删除，请关闭后重新选择')
    activeId.value = list.id
    listQuery.value = ''
    showListForm.value = false
    showToast(editingListId.value ? '清单已更新' : `已创建“${list.name}”`)
  } catch (cause) {
    listError.value = errorMessage(cause)
    listErrorField.value = errorField(listError.value)
    focusError('lists', listErrorField.value)
  }
}
function duplicateList() {
  closeMenu()
  try {
    const sourceId = activeList.value?.id
    const list = commands.duplicateList(sourceId)
    if (!list) return
    activeId.value = list.id; listQuery.value = ''
    offerUndo('已复制清单，所有事项为未完成', () => commands.deleteList(list.id), sourceId)
  } catch (cause) { showToast(errorMessage(cause), { type: 'error' }) }
}
/** @param {string} kind @param {string[]} ids @param {string} itemName @param {string | null | undefined} listId */
function requestAction(kind, ids = [], itemName = '', listId = activeList.value?.id) {
  const list = findList(listId)
  if (!list) return
  closeMenu()
  confirmTarget.value = { kind, listId: list.id, name: list.name, ids: [...ids], itemName }
}
function requestReset() {
  const ids = checklistItems(activeList.value).filter((item) => item.done).map((item) => item.id)
  if (ids.length) requestAction('reset', ids)
}
function requestClearCompleted() {
  const ids = checklistItems(activeList.value).filter((item) => item.done).map((item) => item.id)
  if (ids.length) requestAction('completed', ids)
}
function confirmAction() {
  const target = confirmTarget.value
  confirmTarget.value = null
  if (!target) return
  if (target.kind === 'list') {
    const deleted = commands.deleteList(target.listId)
    if (!deleted) { showToast('这份清单已被删除', { type: 'info' }); return }
    activeId.value = lists.value[Math.min(deleted.index, lists.value.length - 1)]?.id ?? null
    offerUndo('清单已删除', () => commands.restoreList(deleted.item, deleted.index), target.listId)
  } else if (target.kind === 'reset') {
    const result = commands.setItemsDone(target.listId, target.ids, false)
    if (!result?.changes.length) { showToast('没有需要重置的事项', { type: 'info' }); return }
    clearFilters()
    offerUndo(`已重置 ${result.changes.length} 项，可以再次使用`, () => commands.restoreItemStates(result.listId, result.changes), result.listId)
  } else {
    const ids = target.kind === 'completed'
      ? checklistItems(findList(target.listId)).filter((item) => item.done && target.ids.includes(item.id)).map((item) => item.id)
      : target.ids
    const deleted = commands.deleteItems(target.listId, ids)
    if (!deleted) { showToast('选中的事项已不存在或状态已改变', { type: 'info' }); return }
    exitBulkMode()
    offerUndo(`已删除 ${deleted.entries.length} 项`, () => commands.restoreItems(deleted.listId, deleted.entries), deleted.listId)
  }
}

function addQuickItem() {
  const name = quickName.value.trim()
  const listId = activeList.value?.id
  if (!name || !listId) return
  try {
    const item = commands.createItem(listId, { ...emptyItem(), name, category: category.value || '其他' })
    if (!item) throw new Error('这份清单已被删除，请重新选择')
    quickName.value = ''
    revealAdded(listId, item.id)
    quickInput.value?.focus({ preventScroll: true })
    showToast(`已添加“${item.name}”`)
  } catch (cause) { showToast(errorMessage(cause), { type: 'error' }) }
}
function openAddItem() {
  if (!activeList.value) return
  itemListId.value = activeList.value.id
  editingItemId.value = null
  itemForm.value = { ...emptyItem(), name: quickName.value.trim(), category: category.value || '其他' }
  itemError.value = ''; showItemForm.value = true
}
function openEditItem(item, listId = activeList.value?.id) {
  itemListId.value = listId
  editingItemId.value = item.id
  itemForm.value = { name: checklistItemName(item), quantity: checklistQuantity(item), unit: item.unit || '件', price: item.price ?? '', category: item.category || '其他', note: item.note || '' }
  itemError.value = ''; showItemForm.value = true; openSwipeItemId.value = ''
}
function saveItem() {
  try {
    const listId = itemListId.value
    if (!listId) throw new Error('请选择一份清单')
    const editing = Boolean(editingItemId.value)
    const item = editing ? commands.updateItem(listId, editingItemId.value, itemForm.value) : commands.createItem(listId, itemForm.value)
    if (!item) throw new Error('这份清单或事项已被删除，请关闭后重新选择')
    showItemForm.value = false
    if (!editing) { quickDrafts.value[listId] = ''; revealAdded(listId, item.id) }
    showToast(editing ? '事项已更新' : `已添加“${item.name}”`)
  } catch (cause) {
    itemError.value = errorMessage(cause); itemErrorField.value = errorField(itemError.value)
    focusError('lists-item', itemErrorField.value)
  }
}
function removeEditingItem() {
  if (!editingItemId.value || !itemListId.value) return
  showItemForm.value = false
  requestAction('items', [editingItemId.value], itemForm.value.name, itemListId.value)
}
function toggleItem(item) { if (activeList.value) commands.toggleItem(activeList.value.id, item.id) }
function toggleSelection(id) {
  const selected = new Set(selectedIds.value)
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  selectedIds.value = selected
}
function selectVisible() {
  const selected = new Set(selectedIds.value)
  for (const item of visibleItems.value) {
    if (allVisibleSelected.value) selected.delete(item.id)
    else selected.add(item.id)
  }
  selectedIds.value = selected
}
function setSelectedDone(done) {
  const result = commands.setItemsDone(activeList.value?.id, [...selectedIds.value], done)
  if (!result?.changes.length) { showToast('选中事项已经是这个状态', { type: 'info' }); return }
  exitBulkMode()
  offerUndo(`已将 ${result.changes.length} 项标记为${done ? '已完成' : '未完成'}`, () => commands.restoreItemStates(result.listId, result.changes), result.listId)
}
function openBulkAdd() {
  if (!activeList.value) return
  bulkListId.value = activeList.value.id; bulkText.value = ''; skipDuplicates.value = true; bulkError.value = ''; showBulkForm.value = true
}
function saveBulkItems() {
  if (bulkPreview.value.errors.length || !bulkPreview.value.items.length) return
  try {
    const items = commands.createItems(bulkListId.value, bulkPreview.value.items)
    if (!items) throw new Error('这份清单已被删除，请关闭后重新选择')
    const listId = bulkListId.value
    const ids = items.map((item) => item.id)
    showBulkForm.value = false
    revealAdded(listId, ids[0])
    offerUndo(`已添加 ${items.length} 项`, () => commands.deleteItems(listId, ids), listId)
  } catch (cause) { bulkError.value = errorMessage(cause) }
}
function exportList() {
  closeMenu()
  if (!activeList.value) return
  try {
    const url = URL.createObjectURL(new Blob([formatChecklistText(activeList.value)], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeList.value.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 60) || '清单'}.txt`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('清单已导出为文本')
  } catch { showToast('导出失败，请重试', { type: 'error' }) }
}
function swipeAction(direction) { return appearance.value.swipeActions?.lists?.[direction] || 'none' }
function swipeLabel(item, direction) {
  const action = swipeAction(direction)
  return action === 'complete' ? item.done ? '恢复' : '完成' : action === 'edit' ? '编辑' : action === 'delete' ? '删除' : ''
}
function swipeTone(direction) { return swipeAction(direction) === 'delete' ? 'danger' : swipeAction(direction) === 'complete' ? 'success' : 'primary' }
function handleSwipe(direction, item) {
  const action = swipeAction(direction)
  if (action === 'complete') toggleItem(item)
  else if (action === 'edit') openEditItem(item)
  else if (action === 'delete') requestAction('items', [item.id], checklistItemName(item))
  openSwipeItemId.value = ''
}
function emptyAction() {
  if (!stats.value.count) openAddItem()
  else if (emptyActionLabel.value === '再次使用') requestReset()
  else clearFilters()
}
</script>

<template>
  <div class="page lists-page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">清单</h1>
        <p class="page-desc">把要买、要带、要做的事，一项项安排好。</p>
        <p v-if="lists.length" class="page-count">{{ lists.length }} 份清单<span>·</span>{{ totalPending }} 项待完成</p>
      </div>
      <div class="page-actions"><button type="button" class="btn btn-primary" @click="openCreateList()">＋ 新建清单</button></div>
    </header>

    <template v-if="!lists.length">
      <EmptyState :level="2" class="card empty-box" icon="📋" title="从一份小清单开始" description="购物、出行或房间整理，都可以随手记下，再逐项勾选。" primary-label="新建第一份清单" @primary="openCreateList()" />
      <section class="starter-section" aria-label="常用清单模板">
        <h2>也可以从模板开始</h2>
        <div class="starter-grid">
          <button v-for="entry in CHECKLIST_TEMPLATES" :key="entry.id" type="button" class="starter-card" @click="openCreateList(entry.id)">
            <span class="starter-icon" aria-hidden="true">{{ typeInfo(entry.type).icon }}</span>
            <b>{{ entry.name }}</b><small>{{ entry.description }}</small><span>{{ entry.items.length }} 项 · 自由修改</span>
          </button>
        </div>
      </section>
    </template>

    <div v-else class="shopping-layout">
      <aside class="list-sidebar" aria-label="我的清单">
        <div class="sidebar-head"><h2>我的清单</h2><span>{{ lists.length }}</span></div>
        <div class="sidebar-search"><input v-model="listQuery" type="search" aria-label="搜索清单" placeholder="搜索清单名称或类型" /></div>
        <div class="list-tabs" role="group" aria-label="选择清单">
          <button v-for="list in sidebarLists" :key="list.id" type="button" class="list-tab" :class="{ active: activeList?.id === list.id }" :aria-pressed="activeList?.id === list.id" @click="activeId = list.id">
            <span class="tab-line"><span class="tab-icon" aria-hidden="true">{{ typeInfo(list.type).icon }}</span><b :title="list.name">{{ list.name }}</b><span v-if="listSummary(list).count && !listSummary(list).remaining" class="list-complete" aria-label="全部完成">✓</span></span>
            <span class="tab-meta"><small>{{ listSummary(list).done }} / {{ listSummary(list).count }} 已完成</small><small>{{ typeInfo(list.type).label }}</small></span>
            <span class="tab-progress" aria-hidden="true"><i :style="{ width: listSummary(list).percent + '%' }"></i></span>
          </button>
        </div>
        <select v-model="activeId" class="mobile-list-select" aria-label="选择清单">
          <option v-if="activeList && !sidebarLists.some(list => list.id === activeList.id)" :value="activeList.id">{{ activeList.name }}（当前清单）</option>
          <option v-for="list in sidebarLists" :key="list.id" :value="list.id">{{ typeInfo(list.type).icon }} {{ list.name }} · {{ listSummary(list).done }}/{{ listSummary(list).count }}</option>
        </select>
        <p v-if="!sidebarLists.length" class="sidebar-empty">没有匹配的清单<button type="button" @click="listQuery = ''">清除搜索</button></p>
        <button type="button" class="sidebar-add" @click="openCreateList()">＋ 新建清单 / 使用模板</button>
      </aside>

      <section v-if="activeList" class="card shopping-card" aria-labelledby="active-list-title">
        <div class="list-head">
          <div class="list-heading"><span class="list-type">{{ typeInfo(activeList.type).icon }} {{ typeInfo(activeList.type).label }}</span><h2 id="active-list-title">{{ activeList.name }}</h2><p v-if="updatedText(activeList)" class="updated-note">{{ updatedText(activeList) }}</p></div>
          <div class="list-menu">
            <button type="button" class="btn btn-ghost" @click="openEditList">编辑清单</button>
            <details ref="listMenu" class="more-menu" @keydown.esc.prevent.stop="closeMenuFromKey">
              <summary aria-label="更多清单操作">•••</summary>
              <div class="menu-popover">
                <button type="button" @click="duplicateList">复制为新清单</button>
                <button type="button" :disabled="!stats.done" @click="requestReset">重置勾选，再次使用</button>
                <button type="button" @click="exportList">导出文本</button>
                <button type="button" class="danger-link" @click="requestAction('list')">删除清单</button>
              </div>
            </details>
          </div>
        </div>

        <div class="summary-grid">
          <div class="progress-summary"><span>完成进度</span><b>{{ stats.percent }}<small>%</small></b><span>{{ stats.done }} / {{ stats.count }} 项已完成</span><div class="summary-progress" role="progressbar" aria-label="清单完成进度" :aria-valuenow="stats.percent" :aria-valuemin="0" :aria-valuemax="100"><i :style="{ width: stats.percent + '%' }"></i></div></div>
          <div><span>待完成事项</span><b>{{ stats.remaining }}<small>项</small></b><span>{{ stats.count && !stats.remaining ? '全部完成了 ✓' : '逐项勾选，不再遗漏' }}</span></div>
          <div v-if="activeList.type === 'shopping'"><span>{{ stats.unpricedCount ? '已估总额' : '预计总额' }}</span><b class="summary-money">{{ money(stats.total) }}</b><span>待购 {{ money(stats.pendingTotal) }} · 已购 {{ money(stats.boughtTotal) }}</span></div>
        </div>
        <div v-if="activeList.type === 'shopping' && (stats.unpricedCount || stats.budget !== null)" class="shopping-insight" :class="{ 'over-budget': budgetExceeded }">
          <span v-if="stats.unpricedCount">{{ stats.unpricedCount }} 项未估价，金额为已估价事项的小计</span>
          <span v-if="stats.budget !== null">预算 {{ money(stats.budget) }} · {{ budgetExceeded ? `超出 ${money(-(stats.budgetRemaining ?? 0))}` : `剩余 ${money(stats.budgetRemaining)}` }}</span>
        </div>

        <form class="quick-add" @submit.prevent="addQuickItem">
          <input ref="quickInput" v-model="quickName" maxlength="120" aria-label="快速添加一项" placeholder="记下一项，按 Enter 添加" autocomplete="off" />
          <button class="btn btn-primary" type="submit" :disabled="!quickName.trim()">添加</button>
          <button type="button" class="btn btn-ghost" @click="openAddItem">详细添加</button>
          <button type="button" class="btn btn-ghost bulk-add-button" @click="openBulkAdd">批量添加</button>
        </form>

        <div class="item-toolbar">
          <div class="status-filters" role="group" aria-label="按完成状态筛选">
            <button v-for="entry in [{ key: 'all', label: '全部', count: stats.count }, { key: 'pending', label: '待完成', count: stats.remaining }, { key: 'done', label: '已完成', count: stats.done }]" :key="entry.key" type="button" :class="{ on: filter === entry.key }" :aria-pressed="filter === entry.key" @click="filter = entry.key">{{ entry.label }}<span>{{ entry.count }}</span></button>
          </div>
          <div class="item-tools"><button type="button" :disabled="!stats.count" :aria-pressed="bulkMode" @click="bulkMode ? exitBulkMode() : bulkMode = true">{{ bulkMode ? '退出批量' : '批量管理' }}</button><button type="button" class="clear-bought" :disabled="!stats.done" @click="requestClearCompleted">清除已完成</button></div>
        </div>
        <div class="search-toolbar">
          <input v-model="query" type="search" aria-label="搜索当前清单事项" placeholder="搜索事项、分类或备注" />
          <select v-model="category" aria-label="按分类筛选"><option value="">全部分类</option><option v-for="value in categoryOptions" :key="value" :value="value">{{ value }}</option></select>
          <select v-model="sort" aria-label="清单事项排序"><option value="pending">待完成优先</option><option value="manual">添加顺序</option><option value="name">名称排序</option><option value="category">分类排序</option><option v-if="activeList.type === 'shopping'" value="amount">金额从高到低</option></select>
        </div>
        <div v-if="hasFilters" class="filter-result"><span role="status">找到 {{ visibleItems.length }} / {{ stats.count }} 项</span><button type="button" @click="clearFilters">清除筛选</button></div>
        <div v-if="bulkMode" class="batch-toolbar" role="group" aria-label="批量管理事项">
          <label class="select-visible"><input type="checkbox" :checked="allVisibleSelected" :disabled="!visibleItems.length" @change="selectVisible" />全选当前结果</label><span class="selected-count" role="status">已选 {{ selectedIds.size }} 项</span>
          <div class="batch-actions"><button type="button" :disabled="!selectedIds.size" @click="setSelectedDone(true)">标记完成</button><button type="button" :disabled="!selectedIds.size" @click="setSelectedDone(false)">恢复未完成</button><button type="button" class="danger-link" :disabled="!selectedIds.size" @click="requestAction('items', [...selectedIds])">删除</button></div>
        </div>

        <VirtualList v-if="visibleItems.length" v-slot="{ item }" class="item-list" :items="visibleItems" :estimated-height="78" :gap="0" :threshold="50" :reveal-key="revealId" reveal-behavior="auto" :reveal-non-virtual="true">
          <SwipeActionItem :left-label="bulkMode ? '' : swipeLabel(item, 'left')" :right-label="bulkMode ? '' : swipeLabel(item, 'right')" :left-tone="swipeTone('left')" :right-tone="swipeTone('right')" :open="openSwipeItemId === item.id" @update:open="openSwipeItemId = $event ? item.id : ''" @action="handleSwipe($event, item)">
            <article class="shopping-item" :class="{ done: item.done, selected: selectedIds.has(item.id) }" :data-focus-id="item.id" data-focus-type="checklist">
              <input v-if="bulkMode" class="select-check" type="checkbox" :checked="selectedIds.has(item.id)" :aria-label="`选择${checklistItemName(item)}`" @change="toggleSelection(item.id)" />
              <button v-else type="button" class="item-check" :class="{ checked: item.done }" :aria-label="`将${checklistItemName(item)}标记为${item.done ? '未完成' : '已完成'}`" :aria-pressed="Boolean(item.done)" @click="toggleItem(item)"><span aria-hidden="true">{{ item.done ? '✓' : '' }}</span></button>
              <button type="button" class="item-edit" :aria-label="`编辑${checklistItemName(item)}`" @click="openEditItem(item)">
                <span class="item-title"><b :title="checklistItemName(item)">{{ checklistItemName(item) }}</b><span v-if="item.category && item.category !== '其他'" class="category-chip">{{ item.category }}</span></span>
                <small v-if="activeList.type === 'shopping' || checklistQuantity(item) !== 1 || item.note"><template v-if="activeList.type === 'shopping' || checklistQuantity(item) !== 1">{{ checklistQuantity(item) }} {{ item.unit || '件' }}<template v-if="item.note"> · </template></template>{{ item.note }}</small>
              </button>
              <strong v-if="activeList.type === 'shopping'" class="item-price" :class="{ unpriced: checklistAmount(item) === null }">{{ checklistAmount(item) === null ? '未估价' : money(checklistAmount(item)) }}</strong>
            </article>
          </SwipeActionItem>
        </VirtualList>
        <EmptyState v-else :level="3" class="items-empty" :icon="stats.count && !stats.remaining ? '✓' : '📋'" :title="emptyTitle" :description="emptyDescription" :primary-label="emptyActionLabel" :secondary-label="!stats.count ? '批量添加' : ''" @primary="emptyAction" @secondary="openBulkAdd" />
        <div v-if="visibleItems.length" class="list-foot"><span>{{ visibleItems.length }} 项{{ hasFilters ? '符合筛选' : '' }}</span><span>点击名称可编辑{{ activeList.type === 'shopping' ? '数量、价格和备注' : '详情' }}</span></div>
      </section>
    </div>

    <Modal v-if="showListForm" :open="showListForm" :title="editingListId ? '编辑清单' : '新建清单'" medium sheet :sheet-detents="[0.78, 0.94]" @close="showListForm = false">
      <form id="checklist-list-form" class="form" novalidate @submit.prevent="saveList">
        <template v-if="!editingListId">
          <p class="form-hint">从空白开始，或选择一份可修改的模板。</p>
          <div class="template-options" role="group" aria-label="清单模板">
            <button type="button" class="template-option" :class="{ chosen: !templateId }" :aria-pressed="!templateId" @click="chooseTemplate('')"><span aria-hidden="true">＋</span><b>空白清单</b><small>自由记录</small></button>
            <button v-for="entry in CHECKLIST_TEMPLATES" :key="entry.id" type="button" class="template-option" :class="{ chosen: templateId === entry.id }" :aria-pressed="templateId === entry.id" @click="chooseTemplate(entry.id)"><span aria-hidden="true">{{ typeInfo(entry.type).icon }}</span><b>{{ entry.name }}</b><small>{{ entry.items.length }} 项</small></button>
          </div>
          <p v-if="template" class="template-preview">{{ template.items.map(item => item.name).join('、') }}</p>
        </template>
        <label for="lists-name">清单名称 <span aria-hidden="true">*</span></label>
        <input id="lists-name" v-model="listName" maxlength="80" required autofocus placeholder="例如：本周采购" :aria-invalid="listError && listErrorField === 'name' ? true : undefined" :aria-describedby="listError ? 'lists-form-error' : undefined" @input="listError = ''" />
        <label for="lists-type">清单类型</label>
        <select id="lists-type" v-model="listType"><option v-for="(info, key) in LIST_TYPES" :key="key" :value="key">{{ info.icon }} {{ info.label }}</option></select>
        <template v-if="listType === 'shopping'"><label for="lists-budget">购物预算（元，选填）</label><input id="lists-budget" v-model="listBudget" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" placeholder="留空表示不设置预算" :aria-invalid="listError && listErrorField === 'budget' ? true : undefined" :aria-describedby="listError ? 'lists-form-error' : undefined" @input="listError = ''" /></template>
        <p v-if="listError" id="lists-form-error" class="error" role="alert">{{ listError }}</p>
      </form>
      <template #foot><div class="actions"><button type="button" class="btn btn-ghost" @click="showListForm = false">取消</button><button type="submit" form="checklist-list-form" class="btn btn-primary">{{ editingListId ? '保存修改' : '创建清单' }}</button></div></template>
    </Modal>

    <Modal v-if="showItemForm" :open="showItemForm" :title="editingItemId ? '编辑事项' : '添加事项'" medium sheet :sheet-detents="[0.78, 0.94]" @close="showItemForm = false">
      <form id="checklist-item-form" class="form" novalidate @submit.prevent="saveItem">
        <p class="form-hint">{{ formList?.name || '原清单已被删除' }}</p>
        <label for="lists-item-name">事项名称 <span aria-hidden="true">*</span></label>
        <input id="lists-item-name" v-model="itemForm.name" maxlength="120" required autofocus placeholder="例如：洗衣液、带充电器" :aria-invalid="itemError && itemErrorField === 'name' ? true : undefined" :aria-describedby="itemError ? 'lists-item-error' : undefined" @input="itemError = ''" />
        <div class="form-row" :class="{ three: formList?.type === 'shopping' }">
          <div><label for="lists-item-quantity">数量</label><input id="lists-item-quantity" v-model="itemForm.quantity" type="number" inputmode="decimal" min="0.001" max="1000000" step="any" :aria-invalid="itemError && itemErrorField === 'quantity' ? true : undefined" :aria-describedby="itemError ? 'lists-item-error' : undefined" @input="itemError = ''" /></div>
          <div><label for="lists-item-unit">单位</label><input id="lists-item-unit" v-model="itemForm.unit" list="checklist-units" maxlength="20" placeholder="件" /><datalist id="checklist-units"><option v-for="unit in CHECKLIST_UNITS" :key="unit" :value="unit" /></datalist></div>
          <div v-if="formList?.type === 'shopping'"><label for="lists-item-price">单价（元）</label><input id="lists-item-price" v-model="itemForm.price" type="number" inputmode="decimal" min="0" max="100000000" step="0.01" placeholder="选填" :aria-invalid="itemError && itemErrorField === 'price' ? true : undefined" :aria-describedby="itemError ? 'lists-item-error' : undefined" @input="itemError = ''" /></div>
        </div>
        <p v-if="formList?.type === 'shopping'" class="form-hint">{{ itemSubtotal === null ? '填写单价后自动计算小计；未估价事项不计入预计金额。' : `本项小计 ${money(itemSubtotal)}` }}</p>
        <label for="lists-item-category">分类</label><input id="lists-item-category" v-model="itemForm.category" list="checklist-categories" maxlength="30" placeholder="选择或输入分类" /><datalist id="checklist-categories"><option v-for="value in [...new Set([...CHECKLIST_CATEGORIES, ...checklistItems(formList).map(item => item.category).filter(Boolean)])]" :key="value" :value="value" /></datalist>
        <label for="lists-item-note">备注</label><textarea id="lists-item-note" v-model="itemForm.note" rows="3" maxlength="2000" placeholder="规格、放置位置或其他需要记住的事" />
        <p v-if="itemError" id="lists-item-error" class="error" role="alert">{{ itemError }}</p>
      </form>
      <template #foot><div class="actions"><button v-if="editingItemId" type="button" class="btn btn-danger" @click="removeEditingItem">删除事项</button><button type="button" class="btn btn-ghost" @click="showItemForm = false">取消</button><button type="submit" form="checklist-item-form" class="btn btn-primary">{{ editingItemId ? '保存修改' : '添加事项' }}</button></div></template>
    </Modal>

    <Modal v-if="showBulkForm" :open="showBulkForm" title="批量添加事项" medium sheet :sheet-detents="[0.78, 0.94]" @close="showBulkForm = false">
      <form id="checklist-bulk-form" class="form" @submit.prevent="saveBulkItems">
        <p class="form-hint">添加到“{{ bulkList?.name || '原清单已被删除' }}”。每行一项，一次最多 {{ MAX_BATCH_ITEMS }} 项；支持编号、项目符号和 [x] 完成标记。</p>
        <label for="lists-bulk-text">粘贴或输入事项</label><textarea id="lists-bulk-text" v-model="bulkText" rows="6" maxlength="60000" autofocus placeholder="身份证&#10;充电器&#10;换洗衣物" :aria-invalid="bulkPreview.errors.length || bulkError ? true : undefined" :aria-describedby="bulkPreview.errors.length || bulkError ? 'lists-bulk-error' : 'lists-bulk-summary'" @input="bulkError = ''" />
        <label class="checkbox-label"><input v-model="skipDuplicates" type="checkbox" />跳过已有事项和本次输入中的同名事项</label>
        <p id="lists-bulk-summary" class="bulk-summary" role="status">将添加 {{ bulkPreview.items.length }} 项<span v-if="bulkPreview.duplicateCount"> · 已跳过 {{ bulkPreview.duplicateCount }} 项重复名称</span></p>
        <ul v-if="bulkPreview.items.length" class="bulk-preview" aria-label="添加预览"><li v-for="(item, index) in bulkPreview.items" :key="index"><span aria-hidden="true">{{ item.done ? '☑' : '☐' }}</span>{{ item.name }}</li></ul>
        <p v-if="bulkPreview.errors.length || bulkError" id="lists-bulk-error" class="error" role="alert">{{ bulkError || bulkPreview.errors[0] }}</p>
      </form>
      <template #foot><div class="actions"><button type="button" class="btn btn-ghost" @click="showBulkForm = false">取消</button><button type="submit" form="checklist-bulk-form" class="btn btn-primary" :disabled="!bulkList || !bulkPreview.items.length || Boolean(bulkPreview.errors.length)">添加 {{ bulkPreview.items.length }} 项</button></div></template>
    </Modal>
    <ConfirmDialog v-if="confirmTarget" :open="Boolean(confirmTarget)" :title="confirmTitle" :message="confirmMessage" :confirm-label="confirmTarget.kind === 'reset' ? '重置勾选' : '确认删除'" :tone="confirmTarget.kind === 'reset' ? 'primary' : 'danger'" @close="confirmTarget = null" @confirm="confirmAction" />
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-count { display: flex; gap: 9px; margin: 7px 0 0; color: var(--ink-soft); font-size: var(--fs-12); }
.page-count span { color: var(--ink-faint); }
.empty-box { width: 100%; }
.starter-section h2 { margin: 4px 0 12px; font-size: var(--fs-15); }
.starter-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.starter-card { display: flex; flex-direction: column; gap: 8px; padding: 20px; text-align: left; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-14); background: var(--card); }
.starter-card:hover { border-color: var(--primary); background: var(--primary-soft); }
.starter-icon { font-size: var(--fs-26); }
.starter-card b { font-size: var(--fs-15); }
.starter-card small, .starter-card > span:last-child { font-size: var(--fs-12); color: var(--ink-soft); }
.shopping-layout { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 18px; align-items: start; }
.list-sidebar { position: sticky; top: 20px; min-width: 0; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-14); background: var(--card); }
.sidebar-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sidebar-head h2 { font-size: var(--fs-14); margin: 0; }
.sidebar-head > span { padding: 1px 6px; color: var(--ink-soft); background: var(--bg-tint); border-radius: var(--radius-5); font-size: var(--fs-11); }
.sidebar-search input { width: 100%; min-width: 0; font-size: var(--fs-12); }
.list-tabs { display: flex; flex-direction: column; gap: 7px; max-height: min(60vh, 640px); overflow-y: auto; padding: 12px 1px; }
.list-tab { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px 10px; text-align: left; border: 1px solid transparent; border-radius: var(--radius-10); background: var(--bg-tint); color: var(--text); }
.list-tab:hover { border-color: var(--border-strong); }
.list-tab.active { background: var(--primary-soft); border-color: var(--primary); }
.tab-line { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; }
.tab-line b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-13); }
.list-complete { color: var(--success); }
.tab-meta { display: flex; justify-content: space-between; gap: 4px; color: var(--ink-soft); }
.tab-meta small { font-size: var(--fs-10-5); }
.tab-progress, .summary-progress { display: block; height: 4px; width: 100%; overflow: hidden; border-radius: var(--radius-pill); background: var(--border); }
.tab-progress i, .summary-progress i { display: block; height: 100%; border-radius: inherit; background: var(--primary); transition: width var(--dur-slow) var(--ease-standard); }
.sidebar-add { width: 100%; padding: 10px 4px; border: 1px dashed var(--border-strong); border-radius: var(--radius-8); color: var(--primary); background: transparent; font-size: var(--fs-12); }
.sidebar-add:hover { background: var(--primary-soft); }
.mobile-list-select { display: none; }
.sidebar-empty { font-size: var(--fs-12); color: var(--ink-soft); text-align: center; padding: 10px 0; }
.sidebar-empty button, .filter-result button { display: inline-block; color: var(--primary); border: 0; background: transparent; padding: 8px; }
.shopping-card { min-width: 0; padding: 0; }
.list-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 24px 24px 18px; }
.list-heading { min-width: 0; }
.list-type { color: var(--primary); font-size: var(--fs-12); }
.list-head h2 { margin: 6px 0; overflow-wrap: anywhere; font-size: var(--fs-23); line-height: 1.35; }
.updated-note { margin: 0; color: var(--ink-faint); font-size: var(--fs-11); }
.list-menu { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }
.list-menu .btn { font-size: var(--fs-12); }
.more-menu { position: relative; }
.more-menu summary { display: grid; place-items: center; list-style: none; min-width: 42px; min-height: 42px; border: 1px solid var(--border); border-radius: var(--radius-8); color: var(--ink-soft); cursor: pointer; }
.more-menu summary::-webkit-details-marker { display: none; }
.more-menu summary:hover, .more-menu[open] summary { background: var(--bg-tint); }
.menu-popover { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; display: grid; gap: 3px; min-width: 190px; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--card); box-shadow: var(--shadow-md); }
.menu-popover button { padding: 11px 12px; border: none; border-radius: var(--radius-6); background: transparent; color: var(--text); text-align: left; font-size: var(--fs-12); }
.menu-popover button:hover { background: var(--bg-tint); }
.danger-link { color: var(--danger) !important; }
.summary-grid { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); margin: 0 24px; padding: 16px 0; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg-tint); }
.summary-grid > div { display: flex; flex-direction: column; gap: 6px; padding: 0 18px; }
.summary-grid > div + div { border-left: 1px solid var(--border); }
.summary-grid span { color: var(--ink-soft); font-size: var(--fs-11); line-height: 1.5; }
.summary-grid b { display: flex; align-items: baseline; gap: 4px; font-size: var(--fs-26); line-height: 1.3; font-variant-numeric: tabular-nums; }
.summary-grid b small { font-size: var(--fs-12); font-weight: var(--fw-600); color: var(--ink-soft); }
.summary-grid b.summary-money { font-size: var(--fs-21); overflow-wrap: anywhere; }
.summary-progress { margin-top: 2px; max-width: 140px; }
.shopping-insight { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; margin: 12px 24px 0; padding: 10px 12px; background: var(--primary-soft); color: var(--primary); border-radius: var(--radius-8); font-size: var(--fs-11); line-height: 1.6; }
.shopping-insight.over-budget { background: var(--danger-soft); color: var(--danger); }
.quick-add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: 8px; padding: 22px 24px 16px; }
.quick-add input { min-width: 0; }
.quick-add .btn { font-size: var(--fs-12); white-space: nowrap; }
.item-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 24px 12px; }
.status-filters { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg-tint); }
.status-filters button { display: flex; align-items: center; gap: 6px; padding: 8px 10px; color: var(--ink-soft); font-size: var(--fs-12); border: 0; border-radius: var(--radius-6); background: transparent; white-space: nowrap; }
.status-filters button span { font-size: var(--fs-10-5); font-variant-numeric: tabular-nums; }
.status-filters button.on { background: var(--card); color: var(--primary); box-shadow: var(--shadow-sm); font-weight: var(--fw-700); }
.item-tools { display: flex; gap: 2px; }
.item-tools button { padding: 9px 7px; border: 0; border-radius: var(--radius-6); background: transparent; color: var(--ink-soft); font-size: var(--fs-12); white-space: nowrap; }
.item-tools button:hover:not(:disabled), .item-tools button[aria-pressed="true"] { color: var(--primary); background: var(--primary-soft); }
.search-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 120px 140px; gap: 8px; padding: 0 24px 16px; }
.search-toolbar input, .search-toolbar select { width: 100%; min-width: 0; font-size: var(--fs-12); }
.filter-result { display: flex; align-items: center; justify-content: space-between; padding: 0 24px 8px; color: var(--ink-soft); font-size: var(--fs-11); }
.batch-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 24px; border-top: 1px solid var(--border); background: var(--primary-soft); font-size: var(--fs-12); }
.select-visible, .checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.select-visible input, .checkbox-label input { width: 18px; height: 18px; flex: 0 0 18px; accent-color: var(--primary); }
.selected-count { color: var(--primary); }
.batch-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.batch-actions button { padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-6); color: var(--primary); background: var(--card); font-size: var(--fs-12); }
.item-list { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.item-list :deep(.swipe-item) { border-radius: 0; background: var(--card); }
.item-list :deep(.swipe-content) { background: var(--card); }
.shopping-item { display: flex; align-items: center; gap: 12px; min-height: 78px; padding: 10px 24px; border-bottom: 1px solid var(--border); }
.shopping-item:hover { background: var(--bg-tint); }
.shopping-item.selected { background: var(--primary-soft); }
.item-check { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; padding: 9px; border: 0; background: transparent; border-radius: var(--radius-8); }
.item-check span { display: grid; place-items: center; width: 23px; height: 23px; border: 2px solid var(--ink-faint); border-radius: var(--radius-6); color: var(--on-primary); font-size: var(--fs-13); font-weight: var(--fw-800); }
.item-check:hover span { border-color: var(--primary); }
.item-check.checked span { background: var(--primary); border-color: var(--primary); }
.select-check { width: 22px; height: 22px; margin: 0 11px; flex: 0 0 22px; accent-color: var(--primary); }
.item-edit { display: flex; flex-direction: column; justify-content: center; gap: 5px; flex: 1; min-width: 0; min-height: 50px; padding: 3px 0; border: 0; background: transparent; color: var(--text); text-align: left; border-radius: var(--radius-5); }
.item-title { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.item-title b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-14); font-weight: var(--fw-650); }
.category-chip { flex: 0 0 auto; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 6px; border-radius: var(--radius-5); background: var(--primary-soft); color: var(--primary); font-size: var(--fs-10); }
.item-edit small { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-soft); font-size: var(--fs-12); }
.shopping-item.done .item-title b { color: var(--ink-soft); text-decoration: line-through; }
.item-price { flex: 0 0 auto; max-width: 35%; overflow-wrap: anywhere; color: var(--text); font-size: var(--fs-14); font-variant-numeric: tabular-nums; }
.item-price.unpriced { color: var(--ink-soft); font-weight: var(--fw-400); font-size: var(--fs-12); }
.items-empty { padding: 38px 20px; border-top: 1px solid var(--border); }
.list-foot { display: flex; justify-content: space-between; gap: 10px; padding: 13px 24px; color: var(--ink-faint); font-size: var(--fs-11); }
.form { display: flex; flex-direction: column; gap: 8px; }
.form > label { margin-top: 8px; color: var(--ink-soft); font-size: var(--fs-13); }
.form input, .form select, .form textarea { width: 100%; }
.form textarea { resize: vertical; min-height: 72px; }
.form-hint { margin: 0; color: var(--ink-soft); font-size: var(--fs-12); line-height: 1.6; }
.template-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 4px; }
.template-option { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; min-width: 0; padding: 12px; color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--bg-tint); text-align: left; }
.template-option b { font-size: var(--fs-12); }
.template-option small { color: var(--ink-soft); font-size: var(--fs-11); }
.template-option.chosen { border-color: var(--primary); background: var(--primary-soft); color: var(--primary); }
.template-preview { padding: 10px 12px; margin: 0; border-radius: var(--radius-8); color: var(--ink-soft); background: var(--bg-tint); font-size: var(--fs-12); line-height: 1.7; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
.form-row.three { grid-template-columns: 1fr .8fr 1.2fr; }
.form-row > div { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.form-row label { color: var(--ink-soft); font-size: var(--fs-13); }
.form .checkbox-label { font-size: var(--fs-12); margin-top: 8px; line-height: 1.6; }
.bulk-summary { margin: 8px 0 0; color: var(--primary); font-size: var(--fs-12); }
.bulk-preview { max-height: 200px; overflow: auto; padding: 10px 12px; margin: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg-tint); }
.bulk-preview li { display: flex; gap: 8px; padding: 5px 0; color: var(--text); font-size: var(--fs-12); overflow-wrap: anywhere; }
.bulk-preview li span { color: var(--ink-soft); }
.error { margin: 4px 0; color: var(--danger); font-size: var(--fs-13); }
.actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.actions .btn-danger { margin-right: auto; }
button:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 900px) {
  .shopping-layout { grid-template-columns: 210px minmax(0, 1fr); gap: 12px; }
  .item-toolbar { flex-wrap: wrap; }
  .quick-add { grid-template-columns: minmax(0, 1fr) auto auto; }
  .bulk-add-button { grid-column: 1 / -1; justify-self: start; }
  .summary-grid > div { padding-inline: 12px; }
}
@media (max-width: 760px) {
  .page-head { align-items: center; }
  .shopping-layout { grid-template-columns: 1fr; }
  .list-sidebar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; position: static; padding: 12px; }
  .sidebar-head, .list-tabs { display: none; }
  .sidebar-search { grid-column: 1 / -1; }
  .sidebar-search input { min-height: 42px; }
  .mobile-list-select { display: block; min-width: 0; width: 100%; }
  .sidebar-add { width: 44px; font-size: 0; }
  .sidebar-add::after { content: '＋'; font-size: var(--fs-19); }
  .sidebar-empty { grid-column: 1 / -1; margin: 0; }
  .starter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .quick-add { grid-template-columns: minmax(0, 1fr) auto; }
  .quick-add .btn-ghost { grid-column: auto; width: 100%; }
  .list-head { padding: 20px 16px 16px; }
  .list-head h2 { font-size: var(--fs-20); }
  .list-menu .btn { padding: 9px; }
  .summary-grid { margin-inline: 16px; }
  .summary-grid b { font-size: var(--fs-23); }
  .summary-grid b.summary-money { font-size: var(--fs-17); }
  .shopping-insight { margin-inline: 16px; }
  .quick-add { padding: 18px 16px 14px; }
  .item-toolbar, .search-toolbar { padding-inline: 16px; }
  .item-tools { margin-left: auto; }
  .search-toolbar { grid-template-columns: 1fr 1fr; }
  .search-toolbar input { grid-column: 1 / -1; }
  .filter-result { padding-inline: 16px; }
  .shopping-item { gap: 8px; padding-inline: 12px; }
  .item-check { padding: 10px; width: 44px; }
  .item-title { gap: 5px; }
  .category-chip { max-width: 64px; }
  .item-price { font-size: var(--fs-13); }
  .batch-toolbar { padding-inline: 16px; }
  .batch-actions { width: 100%; margin-left: 0; }
  .batch-actions button { min-height: 40px; flex: 1; }
  .select-visible { min-height: 36px; }
  .list-foot { padding-inline: 16px; font-size: var(--fs-10-5); }
}
@media (max-width: 520px) {
  .page-head { align-items: flex-start; flex-direction: column; gap: 12px; }
  .page-actions { width: 100%; }
  .page-actions .btn { width: 100%; }
  .summary-grid { grid-auto-flow: row; grid-template-columns: 1fr 1fr; padding: 12px 0; }
  .summary-grid > div:last-child:nth-child(3) { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); margin-top: 12px; padding-top: 12px; }
  .summary-grid > div:last-child:nth-child(3) b { font-size: var(--fs-22); }
  .list-head { gap: 8px; }
  .list-menu { gap: 2px; }
  .more-menu summary { min-width: 36px; }
  .status-filters { width: 100%; }
  .status-filters button { flex: 1; justify-content: center; min-height: 38px; }
  .item-tools { width: 100%; justify-content: space-between; }
  .item-tools button { min-height: 40px; }
  .starter-card { padding: 16px; }
  .template-options { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .category-chip { display: none; }
  .list-foot span:last-child { max-width: 70%; text-align: right; }
  .actions { gap: 7px; }
  .actions .btn { padding-inline: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .tab-progress i, .summary-progress i { transition: none; }
}
</style>
