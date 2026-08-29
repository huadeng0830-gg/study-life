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

function coursePeriodText(course) {
  return course.start === course.end ? course.start : `${course.start}至${course.end}`
}

function weekLabel(course) {
  return `${course.startWeek}-${course.endWeek}周`
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
          <p>新课程：{{ item.course.name }} · {{ days[item.course.day] }} · {{ coursePeriodText(item.course) }} · {{ weekLabel(item.course) }}</p>
          <div v-for="match in item.matches" :key="match.existing.id" class="conflict-match">
            当前课程：{{ match.existing.name }} · {{ days[match.existing.day] }} · {{ coursePeriodText(match.existing) }} · {{ weekLabel(match.existing) }}
            <small>实际冲突：第{{ formatWeeks(match.detail.weeks) }}周 · {{ formatPeriods(match.detail) }}</small>
          </div>
          <select :value="draft.decisions[item.index] || ''" @change="emit('decision', item.index, $event.target.value)">
            <option value="" disabled>请选择处理方式</option>
            <option value="replace">替换原课程</option>
            <option value="keep">两门都保留</option>
            <option value="skip">跳过新课程</option>
          </select>
        </article>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="import-conflict-footer">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="emit('commit')">确认导入</button>
      </div>
      <div class="replace-all-schedule">
        <b>高级操作</b><span>替换当前整张课表会移除原有全部课程，与“替换冲突项”不同。</span>
        <button class="btn btn-danger" :disabled="busy" @click="emit('replace-all')">替换当前整张课表</button>
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
  flex-direction: column;
  gap: 9px;
  overflow: auto;
}
.conflict-item {
  padding: 12px;
  border: 1px solid #efd59d;
  border-radius: 10px;
  background: #fffaf0;
}
.conflict-item>b { color: #9a6414; font-size: 12px; }
.conflict-item p { margin: 7px 0; font-size: 12px; line-height: 1.5; }
.conflict-item select { width: 100%; margin-top: 8px; }
.conflict-match {
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(255,255,255,.72);
  color: var(--ink-soft);
  font-size: 11.5px;
  line-height: 1.5;
}
.conflict-match small { display: block; color: #9a6414; font-weight: 700; }
.replace-all-schedule {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--ink-faint);
  font-size: 11.5px;
}
.replace-all-schedule b { color: var(--text); }
.replace-all-schedule span { flex: 1 1 240px; }

@media (max-width: 760px) {
  .import-conflict-actions .btn { width: 100%; }
}
</style>