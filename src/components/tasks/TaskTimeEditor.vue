<script setup>
import { nextTick, ref, useId, watch } from 'vue'
import { newTimeStage, stageLabel, stageRangeText, timePlanId } from '../../composables/tasks/taskTimePlan'

const props = defineProps({ modelValue: { type: Array, required: true }, errorField: { type: String, default: '' }, focusStageId: { type: String, default: '' }, nowMs: { type: Number, required: true } })
const emit = defineEmits(['update:modelValue', 'change'])
const id = useId()
/** @type {import('vue').Ref<HTMLElement | null>} */
const root = ref(null)
const expandedId = ref('')
/** @type {import('vue').Ref<Record<string, boolean>>} */
const timeVisible = ref({})
/** @type {import('vue').Ref<{ stage: import('../../types/domain').TaskTimeStage; index: number } | null>} */
const deleted = ref(null)

/** @returns {import('../../types/domain').TaskTimeStage[]} */
function cloneStages() { return JSON.parse(JSON.stringify(props.modelValue)) }
function write(stages) { emit('update:modelValue', stages); emit('change') }
/** @param {Event} event */
function valueOf(event) { return /** @type {HTMLInputElement} */ (event.target).value }
/** @param {Event} event */
function checkedOf(event) { return /** @type {HTMLInputElement} */ (event.target).checked }
function patch(index, data) {
  const stages = cloneStages()
  Object.assign(stages[index], data)
  write(stages)
}
/** @param {number} index @param {'start'|'end'} anchor @param {'date'|'time'} field @param {string} value */
function boundary(index, anchor, field, value) {
  const stages = cloneStages()
  stages[index][anchor] = { ...stages[index][anchor], date: stages[index][anchor]?.date || '', [field]: value }
  if (field === 'date' && !value) delete stages[index][anchor]?.time
  write(stages)
}
function add() {
  const stage = newTimeStage()
  write([...cloneStages(), stage])
  expandedId.value = stage.id
  nextTick(() => root.value?.querySelector(`[data-stage-id="${stage.id}"] input`)?.focus())
}
function remove(index) {
  const stages = cloneStages()
  deleted.value = { stage: stages[index], index }
  stages.splice(index, 1)
  write(stages)
  expandedId.value = stages[Math.min(index, stages.length - 1)]?.id || ''
}
function undoDelete() {
  if (!deleted.value) return
  const stages = cloneStages()
  stages.splice(deleted.value.index, 0, deleted.value.stage)
  expandedId.value = deleted.value.stage.id
  deleted.value = null
  write(stages)
}
function move(index, offset) {
  const stages = cloneStages()
  ;[stages[index], stages[index + offset]] = [stages[index + offset], stages[index]]
  write(stages)
}
function purpose(stage) { return stage.completionRequired === false ? 'tracking' : stage.kind }
function setPurpose(index, value) {
  patch(index, { kind: value === 'scheduled' ? 'scheduled' : 'window', completionRequired: value !== 'tracking', ...(value !== 'scheduled' ? { allDay: false } : {}) })
}
function setAllDay(index, checked) {
  const stages = cloneStages()
  stages[index].allDay = checked
  if (checked) for (const anchor of ['start', 'end']) {
    if (stages[index][anchor]) delete stages[index][anchor]?.time
    timeVisible.value[`${stages[index].id}:${anchor}`] = false
  }
  write(stages)
}
function toggleTime(index, anchor) {
  const stage = props.modelValue[index]
  const key = `${stage.id}:${anchor}`
  timeVisible.value[key] = !Boolean(timeVisible.value[key] || stage[anchor]?.time)
  if (!timeVisible.value[key]) boundary(index, anchor, 'time', '')
}
function addReminder(index) {
  const stage = props.modelValue[index]
  patch(index, { reminders: [...(stage.reminders || []), { id: timePlanId('reminder'), anchor: stage.start?.date || !stage.end?.date ? 'start' : 'end', minutesBefore: 30, enabled: Boolean(stage.start?.date || stage.end?.date), dateOnlyTime: '09:00' }] })
}
function reminder(index, reminderIndex, field, value) {
  const stages = cloneStages()
  Object.assign(stages[index].reminders[reminderIndex], { [field]: value })
  write(stages)
}
function deleteReminder(index, reminderIndex) {
  const stages = cloneStages()
  stages[index].reminders?.splice(reminderIndex, 1)
  write(stages)
}
function focusError(field) {
  const index = Number(field.split('.')[1])
  const stage = props.modelValue[index]
  if (!stage) return
  expandedId.value = stage.id
  nextTick(() => {
    const target = root.value?.querySelector(`[data-time-field="${field}"]`) || root.value?.querySelector(`[data-stage-id="${stage.id}"] input, [data-stage-id="${stage.id}"] select`)
    target?.focus()
  })
}
watch(() => props.errorField, (field) => { if (field?.startsWith('timeStages.')) focusError(field) })
watch(() => props.focusStageId, (stageId) => {
  const index = props.modelValue.findIndex((stage) => stage.id === stageId)
  if (index >= 0) focusError(`timeStages.${index}.start.date`)
}, { immediate: true })
watch(() => props.modelValue.length, () => {
  if (!props.modelValue.some((stage) => stage.id === expandedId.value)) expandedId.value = props.modelValue[0]?.id || ''
}, { immediate: true })
</script>

<template>
  <section ref="root" class="time-editor" aria-label="事项时间安排">
    <div class="time-heading"><b>时间安排 <small v-if="modelValue.length">{{ modelValue.length }} 段</small></b><button type="button" class="link-btn" @click="add">＋ {{ modelValue.length ? '添加阶段' : '添加起止时间' }}</button></div>
    <p v-if="!modelValue.length" class="time-help">有开始、结束或多个步骤时再添加；名称与日期都可以稍后补充。</p>
    <p v-else class="time-help">每段时间都可以独立设置。只跟踪进度的阶段无需勾选完成。</p>
    <p v-if="deleted" class="time-help" role="status">已从草稿移除“{{ stageLabel(deleted.stage, deleted.index) }}”。<button type="button" class="link-btn" @click="undoDelete">撤销删除</button></p>
    <div v-for="(stage, index) in modelValue" :key="stage.id" class="time-stage" :data-stage-id="stage.id">
      <button type="button" class="stage-heading" :aria-expanded="expandedId === stage.id" @click="expandedId = expandedId === stage.id ? '' : stage.id">
        <span><b>{{ modelValue.length === 1 && !stage.label ? '起止时间' : stageLabel(stage, index) }}</b><small>{{ stageRangeText(stage) }}</small></span><span aria-hidden="true">{{ expandedId === stage.id ? '⌃' : '⌄' }}</span>
      </button>
      <div v-if="expandedId === stage.id" class="stage-fields">
        <label v-if="modelValue.length > 1 || stage.label" :for="`${id}-${stage.id}-label`">阶段名称（选填）<input :id="`${id}-${stage.id}-label`" :value="stage.label" placeholder="例如：准备材料、提交、审核、现场办理" @input="patch(index, { label: valueOf($event) })" /></label>
        <label :for="`${id}-${stage.id}-purpose`">这段时间用来…<select :id="`${id}-${stage.id}-purpose`" :value="purpose(stage)" @change="setPurpose(index, valueOf($event))"><option value="window">在这段时间内完成</option><option value="scheduled">按时参加或执行</option><option value="tracking">只跟踪时间，等待后续</option></select></label>
        <label v-if="stage.kind === 'scheduled'" class="stage-check"><input type="checkbox" :checked="stage.allDay" @change="setAllDay(index, checkedOf($event))" /> 全天占用安排</label>
        <div v-for="anchor in (['start', 'end'])" :key="anchor" class="stage-boundary">
          <label :for="`${id}-${stage.id}-${anchor}-date`">{{ anchor === 'start' ? '开始' : '结束' }}日期（可待定）<input :id="`${id}-${stage.id}-${anchor}-date`" :value="stage[anchor]?.date || ''" type="date" :data-time-field="`timeStages.${index}.${anchor}.date`" :aria-invalid="errorField === `timeStages.${index}.${anchor}.date` || undefined" @input="boundary(index, anchor, 'date', valueOf($event))" /></label>
          <div v-if="!stage.allDay" class="boundary-time">
            <label v-if="timeVisible[`${stage.id}:${anchor}`] || stage[anchor]?.time" :for="`${id}-${stage.id}-${anchor}-time`">{{ anchor === 'start' ? '开始' : '结束' }}时刻<input :id="`${id}-${stage.id}-${anchor}-time`" :value="stage[anchor]?.time || ''" type="time" :disabled="!stage[anchor]?.date" :data-time-field="`timeStages.${index}.${anchor}.time`" :aria-invalid="errorField === `timeStages.${index}.${anchor}.time` || undefined" @input="boundary(index, anchor, 'time', valueOf($event))" /></label>
            <button type="button" class="link-btn" :disabled="!stage[anchor]?.date" @click="toggleTime(index, anchor)">{{ timeVisible[`${stage.id}:${anchor}`] || stage[anchor]?.time ? '保留日期，移除时刻' : '＋ 添加具体时刻' }}</button>
          </div>
        </div>
        <small v-if="stage.kind === 'scheduled' && !stage.allDay && (!stage.start?.time || !stage.end?.time)" class="time-help">开始、结束时刻都确定后可检查占用冲突；预计时长不会代填结束时间。</small>
        <details class="stage-reminders"><summary>阶段提醒{{ stage.reminders?.length ? ` · ${stage.reminders.length} 条` : '（选填）' }}</summary>
          <p class="time-help">可分别提醒开始和结束。日期提醒的时刻只用于通知；应用打开且允许通知时提醒。</p>
          <div v-for="(item, reminderIndex) in stage.reminders || []" :key="item.id" class="stage-reminder">
            <label class="stage-check"><input type="checkbox" :checked="item.enabled" @change="reminder(index, reminderIndex, 'enabled', checkedOf($event))" /> 启用此提醒</label>
            <div class="reminder-row"><label>提醒端点<select :value="item.anchor" @change="reminder(index, reminderIndex, 'anchor', valueOf($event))"><option value="start">开始</option><option value="end">结束</option></select></label><label>提前（分钟）<input :value="item.minutesBefore" type="number" min="0" step="1" inputmode="numeric" :data-time-field="`timeStages.${index}.reminders.${reminderIndex}`" @input="reminder(index, reminderIndex, 'minutesBefore', valueOf($event))" /></label></div>
            <label v-if="!stage[item.anchor]?.time">日期提醒时刻<input :value="item.dateOnlyTime || '09:00'" type="time" @input="reminder(index, reminderIndex, 'dateOnlyTime', valueOf($event))" /></label>
            <button type="button" class="link-btn" @click="deleteReminder(index, reminderIndex)">删除这条提醒</button>
          </div>
          <button type="button" class="link-btn" @click="addReminder(index)">＋ 添加提醒</button>
        </details>
        <div v-if="stage.completionRequired !== false" class="stage-completion"><small>{{ stage.completedAt ? '已记录此阶段完成' : '完成此阶段后，其他阶段仍会保留' }}</small><button type="button" class="link-btn" @click="patch(index, { completedAt: stage.completedAt ? null : new Date(nowMs).toISOString() })">{{ stage.completedAt ? '撤销阶段完成' : '记录阶段完成' }}</button></div>
        <div class="stage-tools"><button v-if="modelValue.length > 1" type="button" class="link-btn" :disabled="index === 0" :aria-label="`上移${stageLabel(stage, index)}`" @click="move(index, -1)">上移</button><button v-if="modelValue.length > 1" type="button" class="link-btn" :disabled="index === modelValue.length - 1" :aria-label="`下移${stageLabel(stage, index)}`" @click="move(index, 1)">下移</button><button type="button" class="link-btn stage-remove" @click="remove(index)">删除这段安排</button></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.time-editor { margin-block: 16px; }
.time-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.time-heading b { font-size: 14px; }
.time-heading small { font-weight: 400; color: var(--ink-faint); }
.time-help { font-size: 12px; line-height: 1.6; color: var(--ink-faint); margin: 6px 0 10px; overflow-wrap: anywhere; }
.time-stage { border: 1px solid var(--border); border-radius: 10px; margin-top: 8px; overflow: hidden; }
.stage-heading { width: 100%; border: 0; padding: 12px; background: var(--bg-tint); color: var(--ink); display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; }
.stage-heading > span:first-child { display: grid; gap: 4px; min-width: 0; }
.stage-heading b { font-size: 13px; }
.stage-heading small { color: var(--ink-faint); font-size: 11px; overflow-wrap: anywhere; }
.stage-fields { display: grid; gap: 12px; padding: 12px; }
.stage-fields label { display: grid; gap: 6px; font-size: 12px; min-width: 0; }
.stage-fields input, .stage-fields select { min-width: 0; width: 100%; box-sizing: border-box; }
.stage-boundary { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: start; }
.boundary-time { display: grid; align-self: end; gap: 5px; }
.boundary-time > button { text-align: left; font-size: 12px; min-height: 36px; }
.stage-fields .stage-check { display: flex; align-items: center; gap: 7px; }
.stage-check input { width: auto; }
.stage-reminders { border-top: 1px solid var(--border); padding-top: 10px; font-size: 12px; }
.stage-reminders summary { cursor: pointer; padding-block: 4px; }
.stage-reminder { display: grid; gap: 8px; border: 1px solid var(--border); padding: 10px; border-radius: 8px; margin-block: 8px; }
.reminder-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.stage-tools { display: flex; flex-wrap: wrap; gap: 12px; border-top: 1px solid var(--border); padding-top: 8px; }
.stage-tools button { min-height: 32px; font-size: 12px; }
.stage-remove { margin-left: auto; }
.stage-completion { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--ink-faint); }
@media (max-width: 520px) { .stage-boundary { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
</style>
