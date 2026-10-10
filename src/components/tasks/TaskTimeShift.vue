<script setup>
import { computed, ref, useId } from 'vue'
import { previewTaskTimeShift, shiftDurationText, undoTaskTimeShift } from '../../composables/tasks/taskTimeShift'

const props = defineProps({ task: { type: Object, required: true }, nowMs: { type: Number, required: true } })
const emit = defineEmits(['apply', 'undo'])
const id = useId()
/** @type {import('vue').Ref<import('../../composables/tasks/taskTimeShift').TaskShiftDuration>} */
const duration = ref({ direction: 'later', days: 0, hours: 2, minutes: 0 })
/** @type {import('vue').Ref<Record<string, string>>} */
const dateOnlyTimes = ref({})
const includeDeadline = ref(true)
const expanded = ref(false)
/** @type {import('vue').Ref<import('../../composables/tasks/taskTimePlan').TaskTiming | null>} */
const before = ref(null)
/** @type {import('vue').Ref<import('../../composables/tasks/taskTimePlan').TaskTiming | null>} */
const after = ref(null)
const message = ref('')
const preview = computed(() => previewTaskTimeShift(props.task, duration.value, { nowMs: props.nowMs, dateOnlyTimes: dateOnlyTimes.value, includeDeadline: includeDeadline.value }))
const canApply = computed(() => !preview.value.error && !preview.value.missingTimes.length && preview.value.changes.length > 0)

function apply() {
  if (!canApply.value) return
  before.value = JSON.parse(JSON.stringify(props.task))
  after.value = JSON.parse(JSON.stringify(preview.value.plan))
  emit('apply', preview.value.plan)
  message.value = `已${shiftDurationText(duration.value)}，保存后生效。`
  expanded.value = false
}
function undo() {
  if (!before.value || !after.value) return
  emit('undo', undoTaskTimeShift(props.task, before.value, after.value))
  before.value = null
  after.value = null
  message.value = '已还原本次改期；后来修改的日期和阶段继续保留，保存后生效。'
}
function preset(days, hours, minutes) {
  duration.value = { ...duration.value, days, hours, minutes }
}
</script>

<template>
  <section class="time-shift">
    <button type="button" class="link-btn shift-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起改期' : '移动剩余安排…' }}</button>
    <p v-if="message" class="shift-message" role="status">{{ message }} <button v-if="before" type="button" class="link-btn" @click="undo">撤销改期</button></p>
    <div v-if="expanded" class="shift-body">
      <p class="shift-hint">一起移动未完成的安排；已完成阶段与已结束的等待阶段保留原日期。</p>
      <label :for="`${id}-direction`">移动方向</label>
      <select :id="`${id}-direction`" v-model="duration.direction"><option value="later">顺延</option><option value="earlier">提前</option></select>
      <div class="shift-duration">
        <label :for="`${id}-days`">天<input :id="`${id}-days`" v-model="duration.days" type="number" min="0" step="1" inputmode="numeric" /></label>
        <label :for="`${id}-hours`">小时<input :id="`${id}-hours`" v-model="duration.hours" type="number" min="0" step="1" inputmode="numeric" /></label>
        <label :for="`${id}-minutes`">分钟<input :id="`${id}-minutes`" v-model="duration.minutes" type="number" min="0" step="1" inputmode="numeric" /></label>
      </div>
      <div class="shift-presets" role="group" aria-label="改期时长快捷选项">
        <button type="button" @click="preset(0, 0, 30)">30 分钟</button><button type="button" @click="preset(0, 2, 0)">2 小时</button><button type="button" @click="preset(1, 0, 0)">1 天</button><button type="button" @click="preset(1, 2, 0)">1 天 2 小时</button>
      </div>
      <label v-if="task.dueDate" class="shift-check"><input v-model="includeDeadline" type="checkbox" /> 同时移动事项截止时间</label>
      <div v-if="preview.dateOnlyBoundaries.length" class="shift-precision">
        <p>以下安排只有日期。按小时或分钟移动前，请明确原来的时刻；只移动天数可保留日期精度。全天安排补时刻后会转为具体时段。</p>
        <label v-for="item in preview.dateOnlyBoundaries" :key="item.key" :for="`${id}-${item.key}`">{{ item.label }} · {{ item.date }}<input :id="`${id}-${item.key}`" v-model="dateOnlyTimes[item.key]" type="time" :aria-label="`${item.label}的原时刻`" /></label>
      </div>
      <p v-if="preview.error" class="error" role="alert">{{ preview.error }}</p>
      <div v-if="canApply" class="shift-preview" aria-live="polite">
        <b>{{ shiftDurationText(duration) }} · 改期预览</b>
        <div v-for="change in preview.changes" :key="change.key" class="shift-change"><span>{{ change.label }}</span><small>{{ change.before }}</small><strong>→ {{ change.after }}</strong></div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" :disabled="!canApply" @click="apply">应用到草稿</button>
    </div>
  </section>
</template>

<style scoped>
.time-shift { margin-block: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
.shift-toggle { text-align: left; min-height: 32px; }
.shift-body { display: grid; gap: 10px; margin-top: 10px; }
.shift-hint, .shift-message, .shift-precision p { color: var(--ink-faint); font-size: 12px; line-height: 1.6; margin: 0; }
.shift-duration { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.shift-duration label, .shift-precision label { display: grid; gap: 5px; min-width: 0; }
.shift-body input, .shift-body select { width: 100%; min-width: 0; box-sizing: border-box; }
.shift-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.shift-presets button { border: 1px solid var(--border); border-radius: 7px; background: var(--bg-tint); color: var(--ink); padding: 7px 9px; font-size: 12px; min-height: 36px; }
.shift-check { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.shift-check input { width: auto; }
.shift-precision { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
.shift-preview { display: grid; gap: 10px; padding: 12px; background: var(--bg-tint); border-radius: 8px; }
.shift-preview b { font-size: 13px; }
.shift-change { display: grid; gap: 3px; font-size: 12px; overflow-wrap: anywhere; }
.shift-change small { color: var(--ink-faint); }
.shift-change strong { font-weight: 500; }
.shift-body > button { justify-self: start; }
</style>
