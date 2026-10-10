<script setup>
import { ref, useId } from 'vue'
import Modal from '../Modal.vue'
import TaskTimeShift from './TaskTimeShift.vue'
import ConfirmDialog from '../ConfirmDialog.vue'
import { detectTimePlanConflicts, getConflictSummary } from '../../composables/conflictDetection.js'
import { moveTimeDate, taskDeadlineError, taskTimePlanError } from '../../composables/tasks/taskTimePlan'

const props = defineProps({ task: { type: Object, required: true }, today: { type: String, required: true }, nowMs: { type: Number, required: true }, existingItems: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'save'])
const formId = useId()
/** @type {import('vue').Ref<import('../../composables/tasks/taskTimePlan').TaskTiming>} */
const draft = ref(JSON.parse(JSON.stringify({ dueDate: props.task.dueDate || '', dueTime: props.task.dueTime || '', timeStages: props.task.timeStages || [] })))
const error = ref('')
const changed = ref(false)
const conflictMessage = ref('')
function apply(plan) { draft.value = JSON.parse(JSON.stringify(plan)); changed.value = true; error.value = '' }
function setDate(days) { draft.value.dueDate = moveTimeDate(props.today, days); changed.value = true; error.value = '' }
function save() {
  error.value = taskDeadlineError(draft.value)?.message || taskTimePlanError(draft.value.timeStages || [])?.message || ''
  if (error.value || !changed.value) return
  const conflicts = detectTimePlanConflicts({ ...draft.value, id: props.task.id }, props.existingItems)
  const summary = getConflictSummary(conflicts)
  if (summary.hasConflicts) conflictMessage.value = `${summary.message}\n${conflicts.map((item) => item.message).join('\n')}\n是否继续保存改期？`
  else emit('save', draft.value)
}
</script>

<template>
  <Modal :open="true" title="重新安排时间" @close="emit('close')">
    <form :id="formId" class="reschedule-form" novalidate @submit.prevent="save">
      <p>重新安排“{{ task.title }}”。先预览并应用改期，再保存生效。</p>
      <TaskTimeShift :task="draft" :now-ms="nowMs" @apply="apply" @undo="apply" />
      <details class="deadline-adjust" :open="!task.timeStages?.length">
        <summary>单独调整事项截止时间</summary>
        <label>新的截止日期<input v-model="draft.dueDate" type="date" :aria-invalid="Boolean(error) || undefined" @input="changed = true; error = ''; if (!draft.dueDate) draft.dueTime = ''" /></label>
        <div class="date-shortcuts" role="group" aria-label="快速重新安排日期"><button type="button" @click="setDate(0)">今天</button><button type="button" @click="setDate(1)">明天</button><button type="button" @click="setDate(7)">一周后</button></div>
        <label>截止时间（选填）<input v-model="draft.dueTime" type="time" :disabled="!draft.dueDate" :aria-invalid="Boolean(error) || undefined" @input="changed = true; error = ''" /></label>
      </details>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </form>
    <template #foot><div class="actions"><button type="button" class="btn" @click="emit('close')">取消</button><button type="submit" :form="formId" class="btn btn-primary" :disabled="!changed">保存改期</button></div></template>
  </Modal>
  <ConfirmDialog v-if="conflictMessage" :open="true" title="改期后的时间冲突" :message="conflictMessage" confirm-label="继续保存改期" cancel-label="返回修改" tone="primary" @close="conflictMessage = ''" @confirm="conflictMessage = ''; emit('save', draft)" />
</template>

<style scoped>
.reschedule-form { display: grid; gap: 12px; }
.reschedule-form > p { color: var(--ink-soft); font-size: 13px; margin: 0; line-height: 1.6; }
.deadline-adjust { display: grid; border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.deadline-adjust summary { cursor: pointer; font-size: 13px; padding-block: 4px; }
.deadline-adjust label { display: grid; gap: 6px; margin-top: 10px; font-size: 12px; }
.deadline-adjust input { width: 100%; min-width: 0; box-sizing: border-box; }
.date-shortcuts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.date-shortcuts button { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-tint); color: var(--ink-soft); font-size: 12px; padding: 8px 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
