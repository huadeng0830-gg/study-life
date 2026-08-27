<script setup>
import { computed, ref } from 'vue'
import Modal from '../components/Modal.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import { appearance } from '../composables/appearance.js'
import { useStoredRef } from '../composables/store.js'

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

const CATEGORIES = ['食品', '日用品', '学习用品', '数码', '衣物', '其他']
const UNITS = ['件', '个', '份', '袋', '盒', '瓶', '斤', 'kg']
const LIST_TYPES = {
  general: '通用清单',
  shopping: '购物采购',
  travel: '出行准备',
  chores: '家务整理',
  packing: '物品准备',
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

const listStats = computed(() => {
  const items = activeList.value?.items ?? []
  const total = items.reduce((sum, item) => sum + item.quantity * (Number(item.price) || 0), 0)
  const bought = items.filter((item) => item.done)
  const boughtTotal = bought.reduce((sum, item) => sum + item.quantity * (Number(item.price) || 0), 0)
  return { total, boughtTotal, done: bought.length, count: items.length, remaining: items.length - bought.length }
})

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
  if (!list || !window.confirm(`确定删除清单“${list.name}”吗？`)) return
  lists.value = lists.value.filter((item) => item.id !== list.id)
  activeId.value = lists.value[0]?.id ?? null
}

function addQuickItem() {
  const name = quickName.value.trim()
  if (!name || !activeList.value) return
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
  showItemForm.value = false
}

function removeItem() {
  if (!activeList.value) return
  activeList.value.items = activeList.value.items.filter((item) => item.id !== editingItemId.value)
  showItemForm.value = false
}

function toggleItem(event, id) {
  event.stopPropagation()
  const item = activeList.value?.items.find((value) => value.id === id)
  toggleListItem(item)
}

function toggleListItem(item) {
  if (item) item.done = !item.done
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
  else if (action === 'delete' && window.confirm(`确定删除“${item.name}”吗？`)) {
    activeList.value.items = activeList.value.items.filter((entry) => entry.id !== item.id)
  }
}

function clearBought() {
  const list = activeList.value
  const count = list?.items.filter((item) => item.done).length ?? 0
  if (!list || !count || !window.confirm(`确定清除 ${count} 个已完成事项吗？`)) return
  list.items = list.items.filter((item) => !item.done)
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h2>☑ 我的清单</h2>
        <p>购物、出行、家务和各种准备事项，都可以拆成逐项完成的清单</p>
      </div>
      <button class="btn btn-primary" @click="openCreateList">＋ 新建清单</button>
    </div>

    <div v-if="lists.length === 0" class="card empty-state">
      <span>📋</span>
      <h3>还没有清单</h3>
      <p>可以从“本周采购”“返校准备”或“房间整理”开始。</p>
      <button class="btn btn-primary" @click="openCreateList">新建第一份清单</button>
    </div>

    <div v-else class="shopping-layout">
      <aside class="list-sidebar">
        <button
          v-for="list in lists"
          :key="list.id"
          class="list-tab"
          :class="{ active: activeList?.id === list.id }"
          @click="activeId = list.id"
        >
          <span>{{ list.name }}</span>
          <small>{{ LIST_TYPES[list.type ?? 'general'] }} · {{ list.items.filter((item) => !item.done).length }} 项待完成</small>
        </button>
      </aside>

      <section v-if="activeList" class="card shopping-card">
        <div class="list-head">
          <div>
            <span class="section-code">CHECKLIST · {{ LIST_TYPES[activeList.type ?? 'general'] }}</span>
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
          <div v-else><span>清单类型</span><b class="type-summary">{{ LIST_TYPES[activeList.type ?? 'general'] }}</b></div>
        </div>

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

    <Modal :open="showListForm" :title="editingListId ? '编辑清单' : '新建清单'" @close="showListForm = false">
      <div class="form">
        <label>清单名称 *</label>
        <input v-model="listName" placeholder="例如：本周采购" @input="listError = ''" />
        <label>清单类型</label>
        <select v-model="listType"><option v-for="(label, key) in LIST_TYPES" :key="key" :value="key">{{ label }}</option></select>
        <p v-if="listError" class="error">{{ listError }}</p>
        <div class="actions"><button class="btn btn-primary" @click="saveList">保存</button></div>
      </div>
    </Modal>

    <Modal :open="showItemForm" :title="editingItemId ? '编辑物品' : '添加物品'" @close="showItemForm = false">
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
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.head h2 { font-size: 22px; }
.head p { margin-top: 5px; color: var(--muted); font-size: 13px; }
.empty-state { display: flex; align-items: center; flex-direction: column; gap: 8px; padding: 58px 20px; text-align: center; }
.empty-state > span { font-size: 34px; }
.empty-state p { color: var(--muted); font-size: 13px; }
.empty-state .btn { margin-top: 8px; }
.shopping-layout { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 12px; }
.list-sidebar { display: flex; flex-direction: column; gap: 6px; }
.list-tab { display: flex; align-items: flex-start; flex-direction: column; gap: 3px; width: 100%; padding: 12px 14px; color: var(--text); text-align: left; border: 1px solid var(--border); border-radius: 11px; background: #fff; }
.list-tab span { overflow: hidden; width: 100%; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.list-tab small { color: var(--muted); font-size: 11px; }
.list-tab.active { color: var(--primary); border-color: #cbd7fb; background: var(--primary-soft); }
.shopping-card { padding: 0; overflow: hidden; }
.list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 22px 14px; }
.section-code { color: var(--primary); font-size: 9px; font-weight: 900; letter-spacing: .16em; }
.list-head h3 { margin-top: 2px; font-size: 19px; }
.list-menu { display: flex; gap: 6px; }
.list-menu button, .clear-bought { padding: 6px 9px; color: var(--muted); font-size: 12px; border: none; border-radius: 7px; background: var(--bg); }
.list-menu .danger-link { color: var(--danger); }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 22px; overflow: hidden; border: 1px solid var(--border); border-radius: 11px; background: var(--border); }
.summary-grid div { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; background: #fafbfd; }
.summary-grid span { color: var(--muted); font-size: 11px; }
.summary-grid b { font-size: 18px; }
.summary-grid .type-summary { font-size: 14px; }
.quick-add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 16px 22px 12px; }
.item-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 22px 10px; border-bottom: 1px solid var(--border); }
.item-toolbar > div { display: flex; gap: 5px; }
.item-toolbar > div button { padding: 6px 9px; color: var(--muted); font-size: 12px; border: none; border-radius: 7px; background: transparent; }
.item-toolbar > div button.on { color: var(--primary); font-weight: 700; background: var(--primary-soft); }
.clear-bought:disabled { opacity: .45; }
.item-list { display: flex; flex-direction: column; }
.item-list :deep(.swipe-item) { border-radius: 0; }
.shopping-item { display: flex; align-items: center; gap: 12px; padding: 13px 22px; cursor: pointer; border-bottom: 1px solid var(--border); }
.shopping-item:last-child { border-bottom: none; }
.shopping-item:hover { background: #fafbfd; }
.shopping-item.done { opacity: .55; }
.shopping-item.done .item-copy b { text-decoration: line-through; }
.item-check { display: grid; place-items: center; width: 25px; height: 25px; flex: 0 0 25px; color: #fff; font-weight: 800; border: 2px solid #cbd2df; border-radius: 7px; background: #fff; }
.item-check.checked { border-color: #19a878; background: #19a878; }
.item-copy { flex: 1; min-width: 0; }
.item-copy > div { display: flex; align-items: center; gap: 7px; }
.item-copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-copy span { padding: 3px 6px; color: var(--primary); font-size: 9px; font-weight: 700; border-radius: 5px; background: var(--primary-soft); }
.item-copy small { display: block; overflow: hidden; margin-top: 3px; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.item-price { color: var(--text); font-size: 13px; white-space: nowrap; }
.items-empty { padding: 34px 20px; color: var(--muted); font-size: 13px; text-align: center; }
.form { display: flex; flex-direction: column; gap: 8px; }
.form label { margin-top: 6px; color: var(--muted); font-size: 13px; }
.form input, .form select { width: 100%; }
.form-row { display: grid; gap: 9px; }
.form-row.three { grid-template-columns: .7fr .8fr 1fr; }
.form-row > div { display: flex; flex-direction: column; gap: 7px; }
.error { color: var(--danger); font-size: 13px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
@media (max-width: 760px) {
  .head { align-items: flex-start; flex-direction: column; }
  .head .btn { width: 100%; }
  .shopping-layout { grid-template-columns: 1fr; }
  .list-sidebar { flex-direction: row; overflow-x: auto; padding-bottom: 2px; }
  .list-tab { min-width: 150px; }
}
@media (max-width: 520px) {
  .summary-grid { grid-template-columns: 1fr; }
  .quick-add { grid-template-columns: 1fr 1fr; }
  .quick-add input { grid-column: 1 / -1; }
  .item-toolbar { align-items: flex-start; flex-direction: column; }
  .shopping-item { padding-inline: 14px; }
  .list-head, .quick-add, .item-toolbar { padding-left: 14px; padding-right: 14px; }
  .summary-grid { margin-inline: 14px; }
  .form-row.three { grid-template-columns: 1fr; }
}
</style>
