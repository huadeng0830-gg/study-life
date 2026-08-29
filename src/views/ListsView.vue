<script setup>
import { computed, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import { appearance } from '../composables/appearance.js'
import { useStoredRef } from '../composables/store'

const lists = useStoredRef('sl_checklists', [])
const activeId = ref(lists.value[0]?.id ?? null)
const filter = ref('all')
const quickName = ref('')
const showListForm = ref(false)
const editingListId = ref(null)
const listName = ref('')
const listType = ref('general')
const listError = ref('')
const showItemForm = ref(false)
const editingItemId = ref(null)
const itemError = ref('')
const itemForm = ref(emptyItem())
const deleteTarget = ref(null)
const undoToast = ref(null)
let undoTimer = 0

const CATEGORIES = ['食品', '日用品', '学习用品', '数码', '衣物', '其他']
const UNITS = ['件', '个', '份', '袋', '盒', '瓶', '斤', 'kg']
const LIST_TYPES = {
  general: { label: '通用清单', icon: '🗒️' },
  shopping: { label: '购物采购', icon: '🛒' },
  travel: { label: '出行准备', icon: '🧳' },
  chores: { label: '家务整理', icon: '🧹' },
  packing: { label: '物品准备', icon: '🎒' },
}
const LIST_TYPE_KEYS = Object.keys(LIST_TYPES)

function typeLabel(key) {
  return LIST_TYPES[key]?.label ?? LIST_TYPES.general.label
}

function typeIcon(key) {
  return LIST_TYPES[key]?.icon ?? LIST_TYPES.general.icon
}

function summarizeList(list) {
  const items = list?.items ?? []
  let done = 0
  let total = 0
  let boughtTotal = 0
  for (const item of items) {
    const amount = Number(item.price) || 0
    const value = (Number(item.quantity) || 0) * amount
    total += value
    if (item.done) { done++; boughtTotal += value }
  }
  const count = items.length
  return { total, boughtTotal, done, count, remaining: count - done, percent: count ? Math.round((done / count) * 100) : 0 }
}

const listSummaryById = computed(() => new Map(lists.value.map((list) => [list.id, summarizeList(list)])))

function listProgress(list) {
  return listSummaryById.value.get(list?.id) ?? { count: 0, done: 0, percent: 0 }
}

function listUpdatedText(list) {
  if (!list.items?.length) return '还没有条目'
  return `${listProgress(list).done} / ${listProgress(list).count} 已完成`
}

// 记录清单最近变动时间（新增元信息字段，不影响既有数据）
function touchList() {
  if (!activeList.value) return
  activeList.value.updatedAt = new Date().toISOString()
}

function updatedAgoText(list) {
  if (!list.updatedAt) return ''
  const minutes = Math.floor((Date.now() - new Date(list.updatedAt).getTime()) / 60000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  const days = Math.floor(hours / 24)
  return `${days} 天前更新`
}

function emptyItem() {
  return { name: '', quantity: 1, unit: '件', price: '', category: '其他', note: '' }
}

const activeList = computed(() =>
  lists.value.find((list) => list.id === activeId.value) ?? lists.value[0] ?? null
)

const visibleItems = computed(() => {
  const items = activeList.value?.items ?? []
  if (filter.value === 'pending') return items.filter((item) => !item.done)
  if (filter.value === 'done') return items.filter((item) => item.done)
  return items
})

const listStats = computed(() => listSummaryById.value.get(activeList.value?.id) ?? summarizeList(null))

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`
}

function openCreateList() {
  editingListId.value = null
  listName.value = ''
  listType.value = 'general'
  listError.value = ''
  showListForm.value = true
}

function openRenameList() {
  if (!activeList.value) return
  editingListId.value = activeList.value.id
  listName.value = activeList.value.name
  listType.value = activeList.value.type ?? 'general'
  listError.value = ''
  showListForm.value = true
}

function saveList() {
  const name = listName.value.trim()
  if (!name) {
    listError.value = '请填写清单名称'
    return
  }
  if (editingListId.value) {
    const target = lists.value.find((list) => list.id === editingListId.value)
    if (target) Object.assign(target, { name, type: listType.value })
  } else {
    const list = { id: 'list' + Date.now(), name, type: listType.value, createdAt: new Date().toISOString(), items: [] }
    lists.value.push(list)
    activeId.value = list.id
  }
  showListForm.value = false
}

function deleteList() {
  const list = activeList.value
  if (list) deleteTarget.value = { type: 'list', item: list }
}

function addQuickItem() {
  const name = quickName.value.trim()
  if (!name || !activeList.value) return
  touchList()
  activeList.value.items.push({
    id: 'item' + Date.now(),
    name,
    quantity: 1,
    unit: '件',
    price: '',
    category: '其他',
    note: '',
    done: false,
  })
  quickName.value = ''
}

function openAddItem() {
  editingItemId.value = null
  itemForm.value = emptyItem()
  itemError.value = ''
  showItemForm.value = true
}

function openEditItem(item) {
  editingItemId.value = item.id
  itemForm.value = {
    name: item.name,
    quantity: item.quantity ?? 1,
    unit: item.unit ?? '件',
    price: item.price ?? '',
    category: item.category ?? '其他',
    note: item.note ?? '',
  }
  itemError.value = ''
  showItemForm.value = true
}

function saveItem() {
  const name = itemForm.value.name.trim()
  if (!name) {
    itemError.value = '请填写物品名称'
    return
  }
  const data = {
    name,
    quantity: Math.max(1, Number(itemForm.value.quantity) || 1),
    unit: itemForm.value.unit,
    price: itemForm.value.price === '' ? '' : Math.max(0, Number(itemForm.value.price) || 0),
    category: itemForm.value.category,
    note: itemForm.value.note.trim(),
  }
  if (editingItemId.value) {
    const target = activeList.value?.items.find((item) => item.id === editingItemId.value)
    if (target) Object.assign(target, data)
  } else if (activeList.value) {
    activeList.value.items.push({ id: 'item' + Date.now(), done: false, ...data })
  }
  touchList()
  showItemForm.value = false
}

function removeItem() {
  const item = activeList.value?.items.find((entry) => entry.id === editingItemId.value)
  showItemForm.value = false
  if (item) deleteTarget.value = { type: 'item', item }
}

function toggleItem(event, id) {
  event.stopPropagation()
  const item = activeList.value?.items.find((value) => value.id === id)
  toggleListItem(item)
}

function toggleListItem(item) {
  if (item) {
    item.done = !item.done
    touchList()
  }
}

function swipeLabel(item, direction) {
  const action = appearance.value.swipeActions.lists[direction]
  if (action === 'complete') return item.done ? '恢复' : '完成'
  if (action === 'edit') return '编辑'
  if (action === 'delete') return '删除'
  return ''
}

function swipeTone(direction) {
  const action = appearance.value.swipeActions.lists[direction]
  if (action === 'complete') return 'success'
  if (action === 'delete') return 'danger'
  return 'primary'
}

function handleItemSwipe(direction, item) {
  const action = appearance.value.swipeActions.lists[direction]
  if (action === 'complete') toggleListItem(item)
  else if (action === 'edit') openEditItem(item)
  else if (action === 'delete') deleteTarget.value = { type: 'item', item }
}

function clearBought() {
  const list = activeList.value
  const count = list?.items.filter((item) => item.done).length ?? 0
  if (list && count) deleteTarget.value = { type: 'done', count }
}

function confirmDelete() {
  const target = deleteTarget.value
  if (!target) return
  if (target.type === 'list') {
    const index = lists.value.findIndex((item) => item.id === target.item.id)
    lists.value = lists.value.filter((item) => item.id !== target.item.id)
    activeId.value = lists.value[0]?.id ?? null
    undoToast.value = { type: 'list', item: target.item, index }
  } else if (target.type === 'item' && activeList.value) {
    const index = activeList.value.items.findIndex((item) => item.id === target.item.id)
    activeList.value.items = activeList.value.items.filter((item) => item.id !== target.item.id)
    touchList()
    undoToast.value = { type: 'item', item: target.item, index, listId: activeList.value.id }
  } else if (target.type === 'done' && activeList.value) {
    const removed = activeList.value.items.filter((item) => item.done)
    const indexes = activeList.value.items.map((item, index) => item.done ? index : -1).filter((index) => index >= 0)
    activeList.value.items = activeList.value.items.filter((item) => !item.done)
    touchList()
    undoToast.value = { type: 'done', items: removed, indexes, listId: activeList.value.id }
  }
  deleteTarget.value = null
  window.clearTimeout(undoTimer)
  undoTimer = window.setTimeout(() => { undoToast.value = null }, 6000)
}

function undoDelete() {
  const toast = undoToast.value
  if (!toast) return
  if (toast.type === 'list') {
    lists.value.splice(Math.min(toast.index, lists.value.length), 0, toast.item)
    activeId.value = toast.item.id
  } else {
    const list = lists.value.find((item) => item.id === toast.listId)
    if (list) {
      const entries = toast.type === 'item' ? [{ item: toast.item, index: toast.index }] : toast.items.map((item, index) => ({ item, index: toast.indexes[index] }))
      for (const entry of entries) list.items.splice(Math.min(entry.index, list.items.length), 0, entry.item)
      activeId.value = list.id
      touchList()
    }
  }
  undoToast.value = null
  window.clearTimeout(undoTimer)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">我的清单</h1>
        <p class="page-desc">购物、出行、杂物和各种准备事项，都可以快速建立清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openCreateList">＋ 新建清单</button>
      </div>
    </header>

    <EmptyState
      v-if="lists.length === 0"
      class="card empty-box"
      icon="📋"
      title="还没有清单"
      description="可以从「本周采购」「返校准备」或「房间整理」开始。"
      primary-label="新建第一份清单"
      @primary="openCreateList"
    />

    <div v-else class="shopping-layout">
      <aside class="list-sidebar" aria-label="清单分类">
        <button
          v-for="list in lists"
          :key="list.id"
          class="list-tab"
          :class="{ active: activeList?.id === list.id }"
          @click="activeId = list.id"
        >
          <span class="tab-line">
            <i class="tab-icon">{{ typeIcon(list.type ?? 'general') }}</i>
            <b>{{ list.name }}</b>
          </span>
          <small>{{ listProgress(list).done }} / {{ listProgress(list).count }} 已完成</small>
          <span class="tab-progress"><i :style="{ width: listProgress(list).percent + '%' }"></i></span>
        </button>
      </aside>

      <section v-if="activeList" class="card shopping-card">
        <div class="list-head">
          <div>
            <span class="section-code">{{ typeIcon(activeList.type ?? 'general') }} CHECKLIST · {{ typeLabel(activeList.type ?? 'general') }}</span>
            <h3>{{ activeList.name }}</h3>
          </div>
          <div class="list-menu">
            <button @click="openRenameList">重命名</button>
            <button class="danger-link" @click="deleteList">删除清单</button>
          </div>
        </div>

        <div class="summary-grid">
          <div><span>完成进度</span><b>{{ listStats.done }} / {{ listStats.count }}</b></div>
          <div><span>待完成</span><b>{{ listStats.remaining }}</b></div>
          <div v-if="activeList.type === 'shopping'"><span>预计总额</span><b>{{ money(listStats.total) }}</b></div>
          <div v-else><span>清单类型</span><b class="type-summary">{{ typeLabel(activeList.type ?? 'general') }}</b></div>
        </div>
        <p v-if="updatedAgoText(activeList)" class="updated-note">{{ updatedAgoText(activeList) }}</p>

        <form class="quick-add" @submit.prevent="addQuickItem">
          <input v-model="quickName" placeholder="快速添加一项，例如：带充电器" />
          <button class="btn btn-primary" :disabled="!quickName.trim()">添加</button>
          <button type="button" class="btn btn-ghost" @click="openAddItem">详细添加</button>
        </form>

        <div class="item-toolbar">
          <div>
            <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
            <button :class="{ on: filter === 'pending' }" @click="filter = 'pending'">待完成</button>
            <button :class="{ on: filter === 'done' }" @click="filter = 'done'">已完成</button>
          </div>
          <button class="clear-bought" :disabled="!listStats.done" @click="clearBought">清除已完成</button>
        </div>

        <VirtualList v-if="visibleItems.length" v-slot="{ item }" class="item-list" :items="visibleItems" :estimated-height="62" :gap="0" :threshold="50">
          <SwipeActionItem
            :left-label="swipeLabel(item, 'left')"
            :right-label="swipeLabel(item, 'right')"
            :left-tone="swipeTone('left')"
            :right-tone="swipeTone('right')"
            @swipe="handleItemSwipe($event, item)"
          >
            <article
              class="shopping-item"
              :class="{ done: item.done }"
              @click="openEditItem(item)"
            >
              <div class="item-copy">
                <div><b>{{ item.name }}</b><span v-if="activeList.type === 'shopping'">{{ item.category }}</span></div>
                <small v-if="activeList.type === 'shopping'">{{ item.quantity }} {{ item.unit }}<template v-if="item.note"> · {{ item.note }}</template></small>
                <small v-else>{{ item.note || '点击可添加备注' }}</small>
              </div>
              <strong v-if="activeList.type === 'shopping'" class="item-price">{{ item.price === '' ? '未估价' : money(item.quantity * item.price) }}</strong>
              <button
                class="item-check"
                :class="{ checked: item.done }"
                :aria-label="item.done ? '标记为未完成' : '标记为已完成'"
                @click="toggleItem($event, item.id)"
              >{{ item.done ? '✓' : '' }}</button>
            </article>
          </SwipeActionItem>
        </VirtualList>
        <p v-else class="items-empty">这个筛选下暂时没有物品。</p>
      </section>
    </div>

    <Modal v-if="showListForm" :open="showListForm" :title="editingListId ? '编辑清单' : '新建清单'" @close="showListForm = false">
      <div class="form">
        <label>清单名称 *</label>
        <input v-model="listName" placeholder="例如：本周采购" @input="listError = ''" />
        <label>清单类型</label>
        <select v-model="listType"><option v-for="key in LIST_TYPE_KEYS" :key="key" :value="key">{{ typeLabel(key) }}</option></select>
        <p v-if="listError" class="error">{{ listError }}</p>
        <div class="actions"><button class="btn btn-primary" @click="saveList">保存</button></div>
      </div>
    </Modal>

    <Modal v-if="showItemForm" :open="showItemForm" :title="editingItemId ? '编辑物品' : '添加物品'" @close="showItemForm = false">
      <div class="form">
        <label>物品名称 *</label>
        <input v-model="itemForm.name" placeholder="例如：洗衣液" />
        <div v-if="activeList?.type === 'shopping'" class="form-row three">
          <div><label>数量</label><input v-model.number="itemForm.quantity" type="number" min="1" /></div>
          <div><label>单位</label><select v-model="itemForm.unit"><option v-for="unit in UNITS" :key="unit">{{ unit }}</option></select></div>
          <div><label>单价</label><input v-model="itemForm.price" type="number" min="0" step="0.01" placeholder="选填" /></div>
        </div>
        <template v-if="activeList?.type === 'shopping'">
          <label>分类</label>
          <select v-model="itemForm.category"><option v-for="category in CATEGORIES" :key="category">{{ category }}</option></select>
        </template>
        <label>备注</label>
        <input v-model="itemForm.note" placeholder="例如：低糖、500ml" />
        <p v-if="itemError" class="error">{{ itemError }}</p>
        <div class="actions">
          <button v-if="editingItemId" class="btn btn-danger" @click="removeItem">删除</button>
          <button class="btn btn-primary" @click="saveItem">保存</button>
        </div>
      </div>
    </Modal>
    <ConfirmDialog
      :open="Boolean(deleteTarget)"
      :title="deleteTarget?.type === 'list' ? '删除清单' : '删除清单事项'"
       :message="deleteTarget?.type === 'list' ? `确定删除清单“${deleteTarget.item.name}”吗？其中的全部事项也会删除。` : deleteTarget?.type === 'done' ? `确定清除 ${deleteTarget.count} 个已完成事项吗？` : `确定删除“${deleteTarget?.item?.name || ''}”吗？删除后可在短时间内撤销。`"
      confirm-label="删除"
      @close="deleteTarget = null"
      @confirm="confirmDelete"
    />
    <div v-if="undoToast" class="undo-toast" role="status" aria-live="polite"><span>清单内容已删除</span><button type="button" @click="undoDelete">撤销</button></div>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.empty-box { max-width: 640px; width: 100%; margin: 0 auto; }
.shopping-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 12px; align-items: start; }
.list-sidebar { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 6px; }
.list-tab { position: relative; display: flex; align-items: flex-start; flex-direction: column; gap: 4px; width: 100%; padding: 11px 13px; color: var(--text); text-align: left; border: 1px solid var(--border); border-radius: 11px; background: #fff; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; }
.list-tab:hover { border-color: var(--border-strong); background: #fdfdff; }
.list-tab .tab-line { display: flex; align-items: center; gap: 7px; overflow: hidden; width: 100%; }
.tab-icon { font-style: normal; font-size: 14px; }
.list-tab b { overflow: hidden; font-size: 13.5px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.list-tab small { color: var(--ink-soft); font-size: 11px; font-variant-numeric: tabular-nums; }
.tab-progress { width: 100%; height: 4px; border-radius: 999px; background: #eef1f6; overflow: hidden; }
.tab-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary), var(--brand-grad-b)); transition: width 0.3s ease; }
.list-tab.active { color: var(--primary); border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary), var(--shadow-sm); background: var(--primary-soft); }
.shopping-card { padding: 0; overflow: hidden; }
.list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px 12px; }
.section-code { color: var(--primary); font-size: 9px; font-weight: 900; letter-spacing: .16em; }
.list-head h3 { margin-top: 2px; font-size: 19px; }
.list-menu { display: flex; gap: 6px; }
.list-menu button, .clear-bought { padding: 6px 9px; color: var(--ink-soft); font-size: 12px; border: none; border-radius: 7px; background: transparent; transition: background 0.14s, color 0.14s; }
.list-menu button:hover, .clear-bought:hover:not(:disabled) { background: var(--bg); color: var(--text); }
.list-menu .danger-link:hover { color: var(--danger); background: #feecec; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 22px; overflow: hidden; border: 1px solid var(--border); border-radius: 11px; background: var(--border); }
.summary-grid div { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; background: var(--bg-tint); }
.summary-grid span { color: var(--ink-faint); font-size: 11px; }
.summary-grid b { font-size: 19px; font-weight: 800; font-variant-numeric: tabular-nums; }
.summary-grid .type-summary { font-size: 14px; }
.updated-note { margin: 8px 24px 0; color: var(--ink-faint); font-size: 10.5px; }
.quick-add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 14px 22px 12px; }
.item-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 22px 10px; border-bottom: 1px solid var(--border); }
.item-toolbar > div { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: #eef1f7; }
.item-toolbar > div button { padding: 5px 10px; color: var(--ink-soft); font-size: 12px; font-weight: 600; border: none; border-radius: 6px; background: transparent; transition: background 0.14s, color 0.14s; }
.item-toolbar > div button:hover { background: rgba(255,255,255,.85); color: var(--text); }
.item-toolbar > div button.on { color: var(--primary); font-weight: 700; background: #fff; box-shadow: 0 1px 3px rgba(22,34,64,.12); }
.clear-bought:disabled { opacity: .45; cursor: not-allowed; }
.item-list { display: flex; flex-direction: column; }
.item-list :deep(.swipe-item) { border-radius: 0; background: #fff; }
.item-list :deep(.swipe-content) { background: #fff; }
.shopping-item { display: flex; align-items: center; gap: 12px; padding: 11px 22px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.13s; }
.shopping-item:last-child { border-bottom: none; }
.shopping-item:hover { background: var(--bg-tint); }
.shopping-item.done { opacity: .55; }
.shopping-item.done .item-copy b { text-decoration: line-through; }
.item-check { display: grid; place-items: center; width: 23px; height: 23px; flex: 0 0 23px; color: #fff; font-weight: 800; font-size: 12px; border: 2px solid #c3cbd9; border-radius: 7px; background: #fff; transition: background 0.14s, border-color 0.14s; }
.item-check:hover { border-color: #19a878; }
.item-check.checked { border-color: #19a878; background: #19a878; }
.item-copy { flex: 1; min-width: 0; }
.item-copy > div { display: flex; align-items: center; gap: 7px; }
.item-copy b { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.item-copy span { padding: 3px 6px; color: var(--primary); font-size: 9px; font-weight: 700; border-radius: 5px; background: var(--primary-soft); }
.item-copy small { display: block; overflow: hidden; margin-top: 3px; color: var(--ink-soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.item-price { color: var(--text); font-size: 13px; font-weight: 750; white-space: nowrap; font-variant-numeric: tabular-nums; }
.items-empty { padding: 30px 20px; color: var(--ink-soft); font-size: 13px; text-align: center; }
.form { display: flex; flex-direction: column; gap: 8px; }
.form label { margin-top: 6px; color: var(--ink-soft); font-size: 13px; }
.form input, .form select { width: 100%; }
.form-row { display: grid; gap: 9px; }
.form-row.three { grid-template-columns: .7fr .8fr 1fr; }
.form-row > div { display: flex; flex-direction: column; gap: 7px; }
.error { color: var(--danger); font-size: 13px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
.undo-toast { position: fixed; right: 18px; bottom: 18px; z-index: 110; display: flex; align-items: center; gap: 14px; max-width: calc(100vw - 28px); padding: 10px 12px 10px 14px; color: var(--text); border: 1px solid var(--border); border-radius: 10px; background: var(--card); box-shadow: var(--shadow-md); font-size: 13px; }
.undo-toast button { padding: 5px 8px; color: var(--primary); font-weight: 800; border: 0; border-radius: 6px; background: var(--primary-soft); }
@media (max-width: 900px) {
  .list-sidebar { position: static; }
}
@media (max-width: 760px) {
  .page-head { align-items: flex-start; flex-direction: column; }
  .page-actions { width: 100%; }
  .page-actions .btn { flex: 1; }
  .shopping-layout { grid-template-columns: 1fr; }
  .list-sidebar { flex-direction: row; overflow-x: auto; padding-bottom: 4px; }
  .list-tab { min-width: 168px; }
}
@media (max-width: 520px) {
  .summary-grid { grid-template-columns: 1fr; }
  .quick-add { grid-template-columns: 1fr 1fr; }
  .quick-add input { grid-column: 1 / -1; }
  .item-toolbar { align-items: flex-start; flex-direction: column; }
  .shopping-item { padding-inline: 14px; }
  .list-head, .quick-add, .item-toolbar { padding-left: 14px; padding-right: 14px; }
  .updated-note { margin-inline: 16px; }
  .summary-grid { margin-inline: 14px; }
  .form-row.three { grid-template-columns: 1fr; }
}
</style>
