<script setup>
import { computed, nextTick, ref } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import Modal from '../components/Modal.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SwipeActionItem from '../components/SwipeActionItem.vue'
import VirtualList from '../components/VirtualList.vue'
import Toast from '../components/Toast.vue'
import { appearance } from '../composables/appearance.js'
import { useChecklistCommands } from '../composables/checklists.js'

const checklistCommands = useChecklistCommands()
const { lists } = checklistCommands
const activeId = ref(lists.value[0]?.id ?? null)
const filter = ref('all')
const quickName = ref('')
const showListForm = ref(false)
const editingListId = ref(null)
const listName = ref('')
const listType = ref('general')
const listError = ref('')
// 两个弹窗各只有一个必填字段（清单名称 / 物品名称），所以不需要 EventsView 那种
// errorField 状态：aria-invalid 直接跟着错误字符串走，不存在「错误出在 A 字段却标了 B」的空间。
// 但 role="alert" 与「把焦点移回去」是必需的——否则读屏用户点保存后什么都听不到。
const listNameInput = ref(null)
const showItemForm = ref(false)
const editingItemId = ref(null)
const itemError = ref('')
const itemNameInput = ref(null)
const itemForm = ref(emptyItem())
const deleteTarget = ref(null)
const toast = ref({ open: false, message: '', type: 'info', actionLabel: '', undoFn: null, viewFn: null, duration: 3200 })
const openSwipeItemId = ref('')

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
    nextTick(() => listNameInput.value?.focus())
    return
  }
  if (editingListId.value) {
    checklistCommands.updateList(editingListId.value, { name, type: listType.value })
  } else {
    const list = checklistCommands.createList({ name, type: listType.value })
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
  checklistCommands.createItem(activeList.value.id, {
    name,
    quantity: 1,
    unit: '件',
    price: '',
    category: '其他',
    note: '',
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
    nextTick(() => itemNameInput.value?.focus())
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
    checklistCommands.updateItem(activeList.value?.id, editingItemId.value, data)
  } else if (activeList.value) {
    checklistCommands.createItem(activeList.value.id, data)
  }
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
  if (item && activeList.value) checklistCommands.toggleItem(activeList.value.id, item.id)
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

function setOpenSwipeItem(id, open) {
  if (open) openSwipeItemId.value = id
  else if (openSwipeItemId.value === id) openSwipeItemId.value = ''
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
    const deleted = checklistCommands.deleteList(target.item.id)
    if (!deleted) return
    activeId.value = lists.value[0]?.id ?? null
    showToast('清单已删除', {
      type: 'warning',
      actionLabel: '撤销',
      undoFn: () => {
        checklistCommands.restoreList(deleted.item, deleted.index)
        activeId.value = deleted.item.id
      },
      duration: 6000,
    })
  } else if (target.type === 'item' && activeList.value) {
    const deleted = checklistCommands.deleteItem(activeList.value.id, target.item.id)
    if (!deleted) return
    showToast('清单项已删除', {
      type: 'warning',
      actionLabel: '撤销',
      undoFn: () => checklistCommands.restoreItems(activeList.value.id, [{ item: deleted.item, index: deleted.index }]),
      duration: 6000,
    })
  } else if (target.type === 'done' && activeList.value) {
    const deleted = checklistCommands.clearCompleted(activeList.value.id)
    if (!deleted) return
    showToast('已完成项已清除', {
      type: 'warning',
      actionLabel: '撤销',
      undoFn: () => {
        const entries = deleted.items.map((item, index) => ({ item, index: deleted.indexes[index] }))
        checklistCommands.restoreItems(activeList.value.id, entries)
        activeId.value = activeList.value.id
      },
      duration: 6000,
    })
  }
  deleteTarget.value = null
}

function showToast(message, { type = 'info', actionLabel = '', undoFn = null, viewFn = null, duration = 3200 } = {}) {
  toast.value = { open: true, message, type, actionLabel, undoFn, viewFn, duration }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div class="page-head-main">
        <h1 class="page-title">清单</h1>
        <p class="page-desc">购物、出行、杂物和各种准备事项，都可以快速建立清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" @click="openCreateList">＋ 新建清单</button>
      </div>
    </header>

    <EmptyState :level="2"
      v-if="lists.length === 0"
      class="card empty-box"
      icon="📋"
      title="还没有清单"
      description="可以从「本周采购」「返校准备」或「房间整理」开始。"
      primary-label="新建第一份清单"
      @primary="openCreateList"
    />

    <div v-else class="shopping-layout">
      <aside class="list-sidebar" role="group" aria-label="清单分类">
        <button
          v-for="list in lists"
          :key="list.id"
          class="list-tab"
          :aria-pressed="activeList?.id === list.id"
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
            <h2>{{ activeList.name }}</h2>
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

        <!-- 行内快速添加没有可见 label（只有 placeholder），加 label 会改变布局，所以用 aria-label 给名称。 -->
        <form class="quick-add" @submit.prevent="addQuickItem">
          <input v-model="quickName" aria-label="快速添加一项" placeholder="快速添加一项，例如：带充电器" />
          <button class="btn btn-primary" type="submit" :disabled="!quickName.trim()">添加</button>
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
            :open="openSwipeItemId === item.id"
            @update:open="setOpenSwipeItem(item.id, $event)"
            @action="handleItemSwipe($event, item)"
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
                :aria-pressed="item.done"
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
        <label for="lists-name">清单名称 *</label>
        <input id="lists-name" ref="listNameInput" v-model="listName" placeholder="例如：本周采购" :aria-invalid="listError ? true : undefined" :aria-describedby="listError ? 'lists-name-error' : undefined" @input="listError = ''" />
        <label for="lists-type">清单类型</label>
        <select id="lists-type" v-model="listType"><option v-for="key in LIST_TYPE_KEYS" :key="key" :value="key">{{ typeLabel(key) }}</option></select>
        <p v-if="listError" id="lists-name-error" class="error" role="alert">{{ listError }}</p>
        <div class="actions"><button class="btn btn-primary" @click="saveList">保存</button></div>
      </div>
    </Modal>

    <Modal v-if="showItemForm" :open="showItemForm" :title="editingItemId ? '编辑物品' : '添加物品'" @close="showItemForm = false">
      <div class="form">
        <label for="lists-item-name">物品名称 *</label>
        <input id="lists-item-name" ref="itemNameInput" v-model="itemForm.name" placeholder="例如：洗衣液" :aria-invalid="itemError ? true : undefined" :aria-describedby="itemError ? 'lists-item-name-error' : undefined" @input="itemError = ''" />
        <div v-if="activeList?.type === 'shopping'" class="form-row three">
          <div><label for="lists-item-quantity">数量</label><input id="lists-item-quantity" v-model.number="itemForm.quantity" type="number" min="1" /></div>
          <div><label for="lists-item-unit">单位</label><select id="lists-item-unit" v-model="itemForm.unit"><option v-for="unit in UNITS" :key="unit">{{ unit }}</option></select></div>
          <div><label for="lists-item-price">单价</label><input id="lists-item-price" v-model="itemForm.price" type="number" min="0" step="0.01" placeholder="选填" /></div>
        </div>
        <template v-if="activeList?.type === 'shopping'">
          <label for="lists-item-category">分类</label>
          <select id="lists-item-category" v-model="itemForm.category"><option v-for="category in CATEGORIES" :key="category">{{ category }}</option></select>
        </template>
        <label for="lists-item-note">备注</label>
        <input id="lists-item-note" v-model="itemForm.note" placeholder="例如：低糖、500ml" />
        <p v-if="itemError" id="lists-item-name-error" class="error" role="alert">{{ itemError }}</p>
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
    <Toast v-model:open="toast.open" :message="toast.message" :type="toast.type" :action-label="toast.actionLabel" :undo-fn="toast.undoFn" :view-fn="toast.viewFn" :duration="toast.duration" @action="() => {}" @close="toast.open = false" />
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.empty-box { max-width: 640px; width: 100%; margin: 0 auto; }
.shopping-layout { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 12px; align-items: start; }
.list-sidebar { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 6px; }
.list-tab { position: relative; display: flex; align-items: flex-start; flex-direction: column; gap: 4px; width: 100%; padding: 11px 13px; color: var(--text); text-align: left; border: 1px solid var(--border); border-radius: var(--radius-11); background: var(--card); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
/* 悬停底色原来写死 #fdfdff：浅色下几乎看不出与 var(--card) 的区别（等于没有悬停反馈），
   深色下则是一块刺眼的白。改成 var(--bg-tint)，浅色下比卡片略暗、深色下比卡片略深，
   两个主题里都是真实的「可点」反馈。 */
.list-tab:hover { border-color: var(--border-strong); background: var(--bg-tint); }
.list-tab .tab-line { display: flex; align-items: center; gap: 7px; overflow: hidden; width: 100%; }
.tab-icon { font-style: normal; font-size: var(--fs-14); }
.list-tab b { overflow: hidden; font-size: var(--fs-13-5); font-weight: var(--fw-700); text-overflow: ellipsis; white-space: nowrap; }
.list-tab small { color: var(--ink-soft); font-size: var(--fs-11); font-variant-numeric: tabular-nums; }
.tab-progress { width: 100%; height: 4px; border-radius: var(--radius-pill); background: var(--bg-tint); overflow: hidden; }
.tab-progress i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--primary), var(--brand-grad-b)); transition: width var(--dur-slow) var(--ease-standard); }
.list-tab.active { color: var(--primary); border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary), var(--shadow-sm); background: var(--primary-soft); }
.shopping-card { padding: 0; overflow: hidden; }
.list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px 12px; }
.section-code { color: var(--primary); font-size: var(--fs-9); font-weight: var(--fw-900); letter-spacing: .16em; }
/* 清单名是页面 h1 下的一级区块标题，所以是 h2（原来是 h3，跳级）。
   注意这个选择器按**标签**写，改标题层级时必须同步改这里，否则样式会掉。 */
.list-head h2 { margin-top: 2px; font-size: var(--fs-19); }
.list-menu { display: flex; gap: 6px; }
.list-menu button, .clear-bought { padding: 6px 9px; color: var(--ink-soft); font-size: var(--fs-12); border: none; border-radius: var(--radius-7); background: transparent; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.list-menu button:hover, .clear-bought:hover:not(:disabled) { background: var(--bg); color: var(--text); }
.list-menu .danger-link:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, var(--card)); }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 22px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-11); background: var(--border); }
.summary-grid div { display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; background: var(--bg-tint); }
.summary-grid span { color: var(--ink-faint); font-size: var(--fs-11); }
.summary-grid b { font-size: var(--fs-19); font-weight: var(--fw-800); font-variant-numeric: tabular-nums; }
.summary-grid .type-summary { font-size: var(--fs-14); }
.updated-note { margin: 8px 24px 0; color: var(--ink-faint); font-size: var(--fs-10-5); }
.quick-add { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 8px; padding: 14px 22px 12px; }
.item-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 22px 10px; border-bottom: 1px solid var(--border); }
/* 这组「分段控件」原来是写死的 #eef1f7 轨道 + 半透明白悬停：
   浅色下是一块浅灰，深色下整条轨道和悬停态都会发白。
   改成用令牌——轨道取 --bg-tint（在高对比度下正好又变回 #eef1f7，与原样一致），
   悬停从 --card 混出来，两个主题都跟着主题走。 */
.item-toolbar > div { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-8); background: var(--bg-tint); }
.item-toolbar > div button { padding: 5px 10px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-600); border: none; border-radius: var(--radius-6); background: transparent; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.item-toolbar > div button:hover { background: color-mix(in srgb, var(--card) 85%, transparent); color: var(--text); }
.item-toolbar > div button.on { color: var(--primary); font-weight: var(--fw-700); background: var(--card); box-shadow: 0 1px 3px rgba(22,34,64,.12); }
.clear-bought:disabled { opacity: .45; cursor: not-allowed; }
.item-list { display: flex; flex-direction: column; }
.item-list :deep(.swipe-item) { border-radius: 0; background: var(--card); }
.item-list :deep(.swipe-content) { background: var(--card); }
.shopping-item { display: flex; align-items: center; gap: 12px; padding: 11px 22px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background var(--dur-fast) var(--ease-standard); }
.shopping-item:last-child { border-bottom: none; }
.shopping-item:hover { background: var(--bg-tint); }
.shopping-item.done { opacity: .55; }
.shopping-item.done .item-copy b { text-decoration: line-through; }
.item-check { display: grid; place-items: center; width: 23px; height: 23px; flex: 0 0 23px; font-weight: var(--fw-800); font-size: var(--fs-12); border: 2px solid #767f94; border-radius: var(--radius-7); background: var(--card); transition: background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard); }
.item-check:hover { border-color: #19a878; }
/* 勾选态白勾必须压在够深的绿上：#19a878/#fff 只有 3.04:1（AA 要 4.5:1），压到 #0c8058 得 4.95:1。 */
.item-check.checked { color: #fff; border-color: #0c8058; background: #0c8058; }
.item-copy { flex: 1; min-width: 0; }
.item-copy > div { display: flex; align-items: center; gap: 7px; }
.item-copy b { overflow: hidden; font-weight: var(--fw-650); text-overflow: ellipsis; white-space: nowrap; }
.item-copy span { padding: 3px 6px; color: var(--primary); font-size: var(--fs-9); font-weight: var(--fw-700); border-radius: var(--radius-5); background: var(--primary-soft); }
.item-copy small { display: block; overflow: hidden; margin-top: 3px; color: var(--ink-soft); font-size: var(--fs-11); text-overflow: ellipsis; white-space: nowrap; }
.item-price { color: var(--text); font-size: var(--fs-13); font-weight: var(--fw-750); white-space: nowrap; font-variant-numeric: tabular-nums; }
.items-empty { padding: 30px 20px; color: var(--ink-soft); font-size: var(--fs-13); text-align: center; }
.form { display: flex; flex-direction: column; gap: 8px; }
.form label { margin-top: 6px; color: var(--ink-soft); font-size: var(--fs-13); }
.form input, .form select { width: 100%; }
.form-row { display: grid; gap: 9px; }
.form-row.three { grid-template-columns: .7fr .8fr 1fr; }
.form-row > div { display: flex; flex-direction: column; gap: 7px; }
.error { color: var(--danger); font-size: var(--fs-13); }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }
.actions .btn-danger { margin-right: auto; }
@media (max-width: 900px) {
  .list-sidebar { position: static; }
  .item-check { width: 44px; height: 44px; flex-basis: 44px; }
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
