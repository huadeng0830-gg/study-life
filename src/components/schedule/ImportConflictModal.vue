<script setup>
import Modal from '../Modal.vue'

const props = defineProps({
  show: { type: Boolean, required: true },
  draft: { type: Object, default: null },
  summary: { type: Object, required: true },
  actionable: { type: Array, required: true },
  days: { type: Array, required: true },
  periods: { type: Array, required: true },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})

const emit = defineEmits(['close', 'decision', 'decisions', 'commit', 'replace-all'])

/**
 * 课程占用的节次文案。
 *
 * 【修的是什么】`course.start` / `course.end` 存的是**节次 id**（`p0`、`p1`…，
 * 见 domain/commands.js 的 createCourse 与 conflictDetection.js 的注释），
 * 原来直接把 id 拼进界面，卡片上印出的是「新课程：高数 · 周一 · p0至p1 · 1-8周」——
 * 同一张卡片下面那行「实际冲突」却用 `formatPeriods()` 走了标签
 * （`periods[periodStart].label`），于是同一段信息两种写法并存，用户看不懂 p0 是什么。
 * 这里改成和下面同一套：按 id 在 `periods` 里查出标签。
 * 查不到时**不退回 id**，退回空串由模板决定不显示，避免再次把内部标识泄漏到界面。
 */
function periodTextById(id) {
  return props.periods.find((period) => period.id === id)?.label || ''
}

function coursePeriodText(course) {
  if (!course) return ''
  const start = periodTextById(course.start)
  const end = periodTextById(course.end)
  if (!start && !end) return ''
  if (!end || start === end) return start || end
  return `${start}至${end}`
}

function weekLabel(course) {
  return `${course.startWeek}-${course.endWeek}周`
}

/** 名称 · 星期 · 节次 · 周次：节次查不到标签时整段略去，不留空的分隔符。 */
function courseSummary(course) {
  return [course.name, props.days[course.day], coursePeriodText(course), weekLabel(course)].filter(Boolean).join(' · ')
}

function formatWeeks(weeks) {
  if (!weeks?.length) return ''
  const ranges = []
  let start = weeks[0]
  let previous = weeks[0]
  for (const week of weeks.slice(1)) {
    if (week === previous + 1) previous = week
    else {
      ranges.push(start === previous ? `${start}` : `${start}-${previous}`)
      start = previous = week
    }
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`)
  return ranges.join('、')
}

function formatPeriods(detail) {
  if (!detail) return ''
  const startLabel = props.periods[detail.periodStart]?.label
  const endLabel = props.periods[detail.periodEnd]?.label
  if (!startLabel) return ''
  return startLabel === endLabel ? startLabel : `${startLabel}至${endLabel}`
}
</script>

<template>
  <Modal v-if="show" :open="show" title="课程导入冲突处理" wide @close="emit('close')">
    <div v-if="draft" class="import-conflict-review">
      <p class="import-conflict-summary">
        导入检查完成：本次 {{ summary.total }} 门课程，<b>{{ summary.direct }} 门可直接导入</b>，
        <b v-if="summary.conflicts">{{ summary.conflicts }} 门存在真实时间冲突</b><b v-if="summary.duplicates">{{ summary.duplicates }} 门疑似重复</b>。
      </p>
      <div class="import-conflict-actions">
        <button class="btn btn-primary" @click="emit('decisions', 'replace')">一键替换 {{ summary.conflicts }} 门冲突项</button>
        <button class="btn" @click="emit('decisions', 'keep')">全部保留两门</button>
        <button class="btn" @click="emit('decisions', 'skip')">全部跳过冲突项</button>
      </div>
      <div class="conflict-item-list">
        <article v-for="item in actionable" :key="item.index" class="conflict-item">
          <b>{{ item.type === 'duplicate' ? '疑似重复课程' : '时间冲突' }}</b>
          <p>新课程：{{ courseSummary(item.course) }}</p>
          <div v-for="match in item.matches" :key="match.existing.id" class="conflict-match">
            当前课程：{{ courseSummary(match.existing) }}
            <small>实际冲突：第{{ formatWeeks(match.detail.weeks) }}周 · {{ formatPeriods(match.detail) }}</small>
          </div>
          <select :value="draft.decisions[item.index] || ''" :aria-label="`${item.course.name} 的处理方式`" @change="emit('decision', item.index, $event.target.value)">
            <option value="" disabled>请选择处理方式</option>
            <option value="replace">替换原课程</option>
            <option value="keep">两门都保留</option>
            <option value="skip">跳过新课程</option>
          </select>
        </article>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="import-conflict-footer">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" :aria-busy="busy || undefined" @click="emit('commit')">确认导入</button>
      </div>
      <div class="replace-all-schedule">
        <b>高级操作</b><span>替换当前整张课表会移除原有全部课程，与“替换冲突项”不同。</span>
        <button class="btn btn-danger" :disabled="busy" :aria-busy="busy || undefined" @click="emit('replace-all')">替换当前整张课表</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.import-conflict-review { display: flex; flex-direction: column; gap: 12px; }
.import-conflict-summary { margin: 0; line-height: 1.65; color: var(--ink-soft); }
.import-conflict-summary b { margin-left: 4px; color: var(--text); }
.import-conflict-actions, .import-conflict-footer { display: flex; flex-wrap: wrap; gap: 8px; }
.conflict-item-list {
  display: flex;
  max-height: 42vh;
  max-height: 42dvh;
  flex-direction: column;
  gap: 9px;
  overflow: auto;
}
/* 冲突条目整块：容器底色/边框与条目标题的琥珀字是一对写死的「浅底 + 深字」，
   只把字换成令牌，深色主题下容器依旧是 #fffaf0 白底配亮琥珀（约 1.7:1），
   所以底与边框一起从 --card 混出来。改前 4.80:1（两套主题一样），改后浅 5.16、深 6.72:1。 */
.conflict-item {
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  border-radius: var(--radius-10);
  background: color-mix(in srgb, var(--warning) 10%, var(--card));
}
.conflict-item>b { color: var(--warning); font-size: var(--fs-12); }
.conflict-item p { margin: 7px 0; font-size: var(--fs-12); line-height: 1.5; }
.conflict-item select { width: 100%; margin-top: 8px; }
.conflict-match {
  padding: 7px 9px;
  border-radius: var(--radius-7);
  /* 同 .conn-meta-item code：半透明白在深色主题下是一层浅色遮罩，改用 --card 混色。 */
  background: color-mix(in srgb, var(--card) 72%, transparent);
  color: var(--ink-soft);
  font-size: var(--fs-11-5);
  line-height: 1.5;
}
.conflict-match small { display: block; color: var(--warning); font-weight: var(--fw-700); }
.replace-all-schedule {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--ink-faint);
  font-size: var(--fs-11-5);
}
.replace-all-schedule b { color: var(--text); }
.replace-all-schedule span { flex: 1 1 240px; }

@media (max-width: 760px) {
  .import-conflict-actions .btn { width: 100%; }
}
</style>