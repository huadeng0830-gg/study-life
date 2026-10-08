<script setup>
/**
 * 待办看板：按状态分三列（待办 / 进行中 / 已完成）。
 *
 * 【为什么不把拖拽当主交互】拖拽对触屏用户最自然，对键盘用户却完全不可用，
 * 而 `tests/interactionAlternatives.test.js` 守的正是「每个手势操作必须有非手势替代」。
 * 这里的非手势路径是**方向键**：← → 换列、↑ ↓ 在列内上下移动，焦点跟着走。
 * 卡片本身仍是真 `<button>`（Tab 可达、回车打开详情），所以三条路径都不依赖彼此。
 *
 * 【列容器的角色】用 `role="group"` 而不是 `role="list"`/`tablist`：一列里是**卡片 + 真按钮**
 * 的混合内容，`listitem` 会误导读屏，而 `tablist` 宣告的是「标签页 + 面板」的键盘契约，
 * 这里没有面板可切（与 TasksView 的筛选器、账本分区的取舍同源，见 tabPanelSemantics 守卫）。
 */
import { nextTick, ref } from 'vue'
import { TASK_BOARD_COLUMNS } from '../../composables/taskViews.js'
import VirtualList from '../VirtualList.vue'

const props = defineProps({
  /** `{ pending: [], in_progress: [], completed: [] }`——由 taskViews.js 的 buildTaskBoard 产出。 */
  columns: { type: Object, required: true },
  /** (task) => { text, cls }，与列表视图共用同一个 dueInfo，逾期/今天/明天的高亮两处一致。 */
  dueInfoOf: { type: Function, required: true },
  /** (task) => 'completed' | 其他 */
  statusOf: { type: Function, required: true },
  /** (task) => 课程名，没有就返回空串 */
  courseNameOf: { type: Function, required: true },
  /** (task) => 重复规则文案（如「每周」），不重复时返回空串 */
  repeatLabelOf: { type: Function, default: () => '' },
})

const emit = defineEmits(['open', 'toggle', 'archive', 'remove', 'set-status'])

const root = ref(null)
const listRefs = new Map()

const listOf = (columnKey) => (Array.isArray(props.columns?.[columnKey]) ? props.columns[columnKey] : [])
function bindListRef(columnKey, instance) {
  if (instance) listRefs.set(columnKey, instance)
  else listRefs.delete(columnKey)
}

/** 焦点坐标（列序号 + 列内序号）。方向键在**列内**上下、在**列间**左右，和看板的空间感一致。 */
function keyOf(columnIndex, itemIndex) {
  return `${TASK_BOARD_COLUMNS[columnIndex]?.key ?? ''}:${itemIndex}`
}

/** 把焦点移到目标卡片的主按钮；越界（空列 / 首尾）就地不动。 */
async function focusCard(columnIndex, itemIndex) {
  const columnKey = TASK_BOARD_COLUMNS[columnIndex]?.key
  const list = listOf(columnKey)
  if (!list.length) return false
  const clamped = Math.min(Math.max(itemIndex, 0), list.length - 1)
  const selector = `[data-board-key="${keyOf(columnIndex, clamped)}"]`
  let target = root.value?.querySelector(selector)
  if (!target) {
    listRefs.get(columnKey)?.scrollToIndex(clamped, 'auto')
    // 虚拟列表先滚到目标行，再挂载它；等这一帧和 Vue 更新后再聚焦。
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await nextTick()
    target = root.value?.querySelector(selector)
  }
  if (!target) return false
  target.focus()
  return true
}

/**
 * 方向键导航。挂在看板根上（不是每张卡片上）——事件从当前聚焦的主按钮冒泡上来，
 * 一处监听覆盖全部卡片，也不用给每张卡片重复绑四个修饰键。
 */
function onKeydown(event) {
  const holder = event.target?.closest?.('[data-board-key]')
  if (!holder) return
  const [columnKey, rawIndex] = String(holder.dataset.boardKey || '').split(':')
  const columnIndex = TASK_BOARD_COLUMNS.findIndex((column) => column.key === columnKey)
  if (columnIndex < 0) return
  const itemIndex = Number(rawIndex)
  const delta = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[event.key]
  if (!delta) return
  const nextColumn = columnIndex + delta[0]
  if (nextColumn < 0 || nextColumn >= TASK_BOARD_COLUMNS.length) return
  // 空列不是死路：跳过它继续找有内容的列，否则「← 到空列就卡住」会让人以为看板坏了。
  let target = nextColumn
  if (!listOf(TASK_BOARD_COLUMNS[target].key).length) {
    target = delta[0] > 0 ? nextColumn + 1 : nextColumn - 1
    if (target < 0 || target >= TASK_BOARD_COLUMNS.length) return
  }
  if (!listOf(TASK_BOARD_COLUMNS[target].key).length) return
  event.preventDefault()
  void focusCard(target, itemIndex + delta[1])
}

function toggleLabel(task) {
  return props.statusOf(task) === 'completed' ? '标记为未完成' : '标记为已完成'
}

async function setTaskStatus(task, status) {
  emit('set-status', task, status)
  await nextTick()
  const columnIndex = TASK_BOARD_COLUMNS.findIndex((column) => column.key === status)
  const itemIndex = listOf(status).findIndex((item) => item.id === task.id)
  if (columnIndex >= 0 && itemIndex >= 0) focusCard(columnIndex, itemIndex)
}
</script>

<template>
  <div ref="root" class="task-board" @keydown="onKeydown">
    <section
      v-for="column in TASK_BOARD_COLUMNS"
      :key="column.key"
      class="board-col"
      role="group"
      :aria-label="`${column.label}（${listOf(column.key).length} 条）`"
    >
      <h2 class="board-col-head">
        {{ column.label }} <b>{{ listOf(column.key).length }}</b>
      </h2>

      <p v-if="!listOf(column.key).length" class="board-col-empty">这一列还没有待办</p>

      <VirtualList
        v-else
        :ref="(instance) => bindListRef(column.key, instance)"
        :items="listOf(column.key)"
        class="board-task-list"
        :estimated-height="142"
        :gap="8"
        :threshold="18"
        :overscan="3"
      >
        <template #default="{ item: task, index: itemIndex }">
          <article
            :key="task.id"
            class="board-card card"
            :class="{ done: statusOf(task) === 'completed', urgent: task.priority === 'high' }"
            :data-focus-id="task.id"
          >
        <span v-if="task.priority === 'high'" class="board-urgent" aria-hidden="true"></span>
        <!-- 卡片主体是**真按钮**而不是 role="button" 的 div：div 里再放「完成 / 编辑 / 删除」
             这些真按钮，按 ARIA 规范后代语义会被 presentational 吃掉（键盘可达性守卫的第十九条）。 -->
        <button
          type="button"
          class="board-main"
          :data-board-key="`${column.key}:${itemIndex}`"
          :aria-label="`打开待办「${task.title}」的详情`"
          @click="emit('open', task)"
        >
          <span class="board-title">{{ task.title }}</span>
          <span class="board-meta">
            <span v-if="courseNameOf(task)" class="board-chip">{{ courseNameOf(task) }}</span>
            <span v-if="repeatLabelOf(task)" class="board-chip repeat">{{ repeatLabelOf(task) }}</span>
            <span class="board-due" :class="dueInfoOf(task).cls">{{ dueInfoOf(task).text }}</span>
          </span>
        </button>

        <div class="board-acts">
          <button
            v-if="column.key === 'pending'"
            type="button"
            class="link-btn board-status-btn tap-target"
            :aria-label="`将待办「${task.title}」移到进行中`"
            @click="setTaskStatus(task, 'in_progress')"
          >开始</button>
          <button
            v-else-if="column.key === 'in_progress'"
            type="button"
            class="link-btn board-status-btn tap-target"
            :aria-label="`将待办「${task.title}」移回待办`"
            @click="setTaskStatus(task, 'pending')"
          >移回</button>
          <button
            type="button"
            class="check"
            :class="{ checked: statusOf(task) === 'completed' }"
            :aria-label="toggleLabel(task)"
            @click="emit('toggle', task)"
          >{{ statusOf(task) === 'completed' ? '✓' : '' }}</button>
          <button v-if="statusOf(task) === 'completed'" type="button" class="link-btn" aria-label="归档待办" title="归档待办" @click="emit('archive', task)">▱</button>
          <button type="button" class="link-btn" aria-label="编辑待办" title="编辑待办" @click="emit('open', task)">✎</button>
          <button type="button" class="link-btn danger" aria-label="删除待办" title="删除待办" @click="emit('remove', task)">🗑</button>
        </div>
          </article>
        </template>
      </VirtualList>
    </section>
  </div>
</template>

<style scoped>
/* 三列等宽，窄屏折成一列。
   刻意用 minmax(0, 1fr) 而不是 1fr：三列各带一个 `min-width: auto` 的 grid item 时，
   长标题会把轨道撑到内容宽度，整块看板于是横向溢出（mobileViewport 守的那一类）。 */
.task-board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.board-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  background: var(--bg-tint);
  border: 1px solid var(--border);
  border-radius: var(--radius-13);
}
.board-col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ink-soft);
  font-size: var(--fs-13);
  font-weight: var(--fw-750);
}
.board-col-head b {
  color: var(--primary);
  font-variant-numeric: tabular-nums;
  font-size: var(--fs-12);
}
.board-col-empty {
  margin: 0;
  padding: 6px 2px;
  color: var(--ink-faint);
  font-size: var(--fs-11-5);
}
:deep(.board-task-list) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.board-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: var(--radius-10);
}
.board-card.done {
  opacity: 0.6;
}
.board-card.done .board-title {
  text-decoration: line-through;
}
.board-urgent {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--danger);
  border-radius: var(--radius-pill);
}
.board-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 0;
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: none;
  border: none;
}
.board-title {
  overflow: hidden;
  font-size: var(--fs-13);
  font-weight: var(--fw-650);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.board-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.board-chip {
  max-width: 110px;
  overflow: hidden;
  padding: 1px 6px;
  color: var(--ink-soft);
  font-size: var(--fs-10-5);
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-5);
}
/* 重复规则是「这件事会自己再来一次」的信号，与课程标签区分开，免得两者读出来一样。 */
.board-chip.repeat {
  color: var(--primary);
  border-color: var(--primary-soft);
  background: var(--primary-soft);
}
.board-due {
  color: var(--ink-faint);
  font-size: var(--fs-10-5);
  font-variant-numeric: tabular-nums;
}
.board-due.today,
.board-due.soon {
  color: var(--warning);
  font-weight: var(--fw-750);
}
.board-due.overdue {
  color: var(--danger);
  font-weight: var(--fw-750);
}
.board-acts {
  display: flex;
  align-items: center;
  gap: 2px;
}
.board-status-btn { padding: 3px 7px; color: var(--primary); font-size: var(--fs-11); white-space: nowrap; }
.check {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  color: var(--text);
  font-weight: var(--fw-800);
  font-size: var(--fs-13);
  border: 2px solid var(--border-strong);
  border-radius: var(--radius-8);
  background: var(--card);
  transition: background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.check:hover {
  border-color: var(--primary);
}
/* 勾选态白勾必须压在够深的主色上：--primary/--on-primary 在两套主题下都 ≥4.5:1
   （与列表视图的 .check.checked 同一条口径，写成 var(--on-primary) 才能跟着主题翻转）。 */
.check.checked {
  color: var(--on-primary);
  border-color: var(--primary);
  background: var(--primary);
}
@media (max-width: 760px) {
  .task-board {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
