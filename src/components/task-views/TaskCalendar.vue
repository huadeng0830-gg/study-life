<script setup>
/**
 * 待办月历：一周一行，每格显示当天到期的待办数量（小圆点，粗细表示多少）。
 *
 * 【交互与类名为什么整套照抄 `views/ledger-panels/ReviewPanel.vue` 的「月历点迹」】
 * 那套已经过了 a11y 与对比度审计，具体踩过的坑都写在它的注释里：
 *   - 翻月按钮内部只有 ‹ / ›，读屏会直接念符号 → 必须有中文 aria-label（accessibleNames 守卫有清单）；
 *   - 格子里只有「日期 + 一个点」，圆点大小才表示当天几件事 → aria-label 要把数量说出来；
 *   - 选中态另用 aria-pressed 暴露，别让「当前选中哪天」只存在于视觉样式里；
 *   - 当日明细行是打开详情的入口，必须可 Tab、可回车（它是**唯一**入口，不是鼠标捷径）。
 * 同一份形状再写一套只会得到两份需要各自维护的 a11y 补丁，所以直接沿用它的类名与写法。
 *
 * 【本组件与回顾月历的一处不同】回顾的当日明细行是 `role="button"` 的 div；
 * 这里每行还要放「完成 / 编辑」这些真按钮，按 ARIA 规范 `role="button"` 的后代语义是
 * presentational，会把这些按钮从无障碍树里抹掉（keyboardReachability 守卫的第十九条）。
 * 所以行是普通容器，动作按钮与「打开详情」按钮是**兄弟**关系。
 */
import { computed } from 'vue'
import { taskCalendarCellLabel, taskCalendarRowLabel, taskCalendarDotClass } from '../../composables/taskViews.js'
import { taskTimeOnDate } from '../../composables/tasks/taskTimePlan.ts'

const props = defineProps({
  /** `YYYY-MM`。 */
  month: { type: String, required: true },
  /** `YYYY-MM`，决定月份标题要不要带年份。 */
  todayMonth: { type: String, required: true },
  /** `YYYY-MM-DD`，用来给今天的格子加一圈描边——只靠圆点分不出「今天」。 */
  todayDate: { type: String, default: '' },
  /** 已排好的格子（含前面的空位 null），由 buildTaskMonthGrid 产出。 */
  cells: { type: Array, default: () => [] },
  /** 选中的日期 `YYYY-MM-DD`，空串表示没选。 */
  selectedDate: { type: String, default: '' },
  /** 选中那天的待办。 */
  selectedTasks: { type: Array, default: () => [] },
  monthLabel: { type: String, default: '' },
  dueInfoOf: { type: Function, required: true },
  statusOf: { type: Function, required: true },
})

const emit = defineEmits(['shift-month', 'select-date', 'open', 'toggle'])

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const monthNumber = computed(() => Number(String(props.month).slice(5, 7)))
const monthTitle = computed(() => (props.monthLabel || `${monthNumber.value}月`))
const selectedLabel = computed(() => {
  if (!props.selectedDate) return ''
  return `${monthNumber.value}月${Number(String(props.selectedDate).slice(8, 10))}日`
})

function dotClass(cell) {
  return taskCalendarDotClass(cell?.count)
}

function cellLabel(cell) {
  return taskCalendarCellLabel(cell)
}

function rowLabel(task) {
  return taskCalendarRowLabel(task, props.dueInfoOf(task).text)
}

function toggleLabel(task) {
  return props.statusOf(task) === 'completed' ? '标记为未完成' : '标记为已完成'
}
</script>

<template>
  <section class="cal-wrap card">
    <div class="cal-nav">
      <!-- 两个翻月按钮内部只有「‹」「›」：读屏会直接念符号，用户听不出这是在换月份，
           所以用 aria-label 说清方向；符号本身保持可见，不需要再加 aria-hidden。
           mn-btn 只有 32×32，一并标记 tap-target，让粗指针设备把它撑到 44px 命中区；
           禁用态交给 :disabled，读屏会自己读出「不可用」。 -->
      <button type="button" class="mn-btn tap-target" aria-label="上一个月" @click="emit('shift-month', -1)">‹</button>
      <b>{{ monthTitle }}</b>
      <!-- 不禁掉向未来翻：账本的回顾禁是因为「未来的账」一定为空，这里下个月也可能有课表安排，
           禁了反而会让人以为后面没东西。不禁就意味着这个按钮永远可用，读屏不会误报「不可用」。 -->
      <button type="button" class="mn-btn tap-target" aria-label="下一个月" @click="emit('shift-month', 1)">›</button>
    </div>

    <h2 class="cal-title">月历点迹</h2>

    <div class="cal-week">
      <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
    </div>
    <div class="cal-grid">
      <template v-for="(cell, idx) in cells" :key="idx">
        <button
          v-if="cell"
          type="button"
          class="cal-cell"
          :class="[dotClass(cell), { selected: selectedDate === cell.dateKey, today: cell.dateKey === todayDate }]"
          :aria-label="cellLabel(cell)"
          :aria-pressed="selectedDate === cell.dateKey"
          @click="emit('select-date', selectedDate === cell.dateKey ? '' : cell.dateKey)"
        >{{ cell.day }}<i v-if="cell.count"></i></button>
        <span v-else class="cal-cell blank"></span>
      </template>
    </div>

    <div v-if="selectedDate" class="cal-detail">
      <b>{{ selectedLabel }}</b>
      <small>{{ selectedTasks.length }} 条待办安排</small>
      <p v-if="!selectedTasks.length" class="cal-detail-empty">这一天没有待办安排。</p>
      <div v-for="task in selectedTasks" :key="task.id" class="cd-row" :data-focus-id="task.id">
        <div class="cd-content">
          <button type="button" class="cd-main" :aria-label="rowLabel(task)" @click="emit('open', task)"><span class="cd-name">{{ task.title }}</span></button>
          <button v-for="entry in taskTimeOnDate(task, selectedDate)" :key="entry.key" type="button" class="cd-phase" @click="emit('open', task, entry.stageId)">{{ entry.label }} · {{ entry.anchor === 'occupied' ? entry.rangeText : entry.time || (entry.allDay ? '全天' : '时刻待定') }}{{ entry.completed ? ' · 已完成' : '' }}</button>
        </div>
        <button
          type="button"
          class="check"
          :class="{ checked: statusOf(task) === 'completed' }"
          :aria-label="toggleLabel(task)"
          @click="emit('toggle', task)"
        >{{ statusOf(task) === 'completed' ? '✓' : '' }}</button>
      </div>
    </div>
    <p v-else class="cal-hint">点一天，查看阶段起止、跨日安排和截止时间。</p>
  </section>
</template>

<style scoped>
.cal-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px 16px;
}
.cal-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding-bottom: 8px;
}
.cal-nav b {
  min-width: 72px;
  font-size: var(--fs-15);
  text-align: center;
}
.mn-btn {
  width: 32px;
  height: 32px;
  color: var(--ink-soft);
  font-size: var(--fs-16);
  cursor: pointer;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-9);
}
.mn-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.cal-title {
  margin: 0 0 8px;
  font-size: var(--fs-13-5);
  font-weight: var(--fw-750);
}
.cal-week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 4px;
}
.cal-week span {
  color: var(--ink-faint);
  font-size: var(--fs-10-5);
  text-align: center;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.cal-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  height: 44px;
  color: var(--text);
  font-size: var(--fs-12);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-9);
}
.cal-cell:hover {
  background: var(--bg-tint);
}
.cal-cell.blank {
  cursor: default;
}
.cal-cell i {
  width: 6px;
  height: 6px;
  background: var(--border-strong);
  border-radius: var(--radius-circle);
}
.cal-cell.l2 i {
  width: 7px;
  height: 7px;
  background: var(--primary);
  opacity: 0.55;
}
.cal-cell.l3 i {
  width: 8px;
  height: 8px;
  background: var(--primary);
}
.cal-cell.selected {
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.cal-cell.today:not(.selected) {
  box-shadow: inset 0 0 0 1px var(--border-strong);
}
.cal-detail {
  margin-top: 12px;
  padding: 11px 13px;
  background: var(--bg-tint);
  border: 1px solid var(--border);
  border-radius: var(--radius-11);
}
.cal-detail > b {
  font-size: var(--fs-13);
}
.cal-detail > small {
  display: block;
  margin: 2px 0 6px;
  color: var(--ink-faint);
  font-size: var(--fs-11);
}
.cal-detail-empty,
.cal-hint {
  margin: 8px 0 0;
  color: var(--ink-faint);
  font-size: var(--fs-11-5);
}
.cd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-top: 1px solid var(--border);
}
.cd-main {
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 3px 4px;
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-7);
}
.cd-main:hover {
  background: var(--card);
}
.cd-name {
  overflow: hidden;
  font-size: var(--fs-12-5);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd-content { display: grid; flex: 1; min-width: 0; }
.cd-phase {
  display: block;
  border: 0;
  background: transparent;
  padding: 6px 4px;
  min-height: 32px;
  text-align: left;
  overflow-wrap: anywhere;
  color: var(--ink-faint);
  font-size: var(--fs-11);
  font-variant-numeric: tabular-nums;
}
.check {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  color: var(--text);
  font-weight: var(--fw-800);
  font-size: var(--fs-13);
  cursor: pointer;
  background: var(--card);
  border: 2px solid var(--border-strong);
  border-radius: var(--radius-8);
  transition: background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.check:hover {
  border-color: var(--primary);
}
/* 与看板里的 .check 同一条口径：白勾压在 --primary 上，两套主题都由 --on-primary 保证 AA。 */
.check.checked {
  color: var(--on-primary);
  border-color: var(--primary);
  background: var(--primary);
}
@media (max-width: 760px) {
  .cal-cell {
    height: 40px;
  }
}
</style>
