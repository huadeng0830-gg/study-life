<script setup>
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import WheelPicker from './WheelPicker.vue'
import { buildWheelValues, formatTimeValue, parseTimeValue, wheelIndexForValue, wheelValueAtIndex } from '../composables/wheelPicker.js'

/**
 * 时间滚轮面板：点一下时间字段，从底部升起双列滚轮。
 *
 * 用 Modal 的 sheet 模式承载，因此滚动锁、焦点陷阱、Esc、下拖收回
 * 全部复用既有实现，不需要另写一套浮层。
 */

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '选择时间' },
  modelValue: { type: String, default: '' },
  // 分钟刻度，默认 5 分钟一格
  minuteStep: { type: Number, default: 5 },
  // 允许清空（例如日程的结束时间可以留空）
  clearable: Boolean,
})

const emit = defineEmits(['update:modelValue', 'close'])

const hourValues = buildWheelValues(0, 23, 1)
const minuteValues = computed(() => buildWheelValues(0, 59, Math.max(1, props.minuteStep)))

const hour = ref(9)
const minute = ref(0)
const hadValue = ref(false)

watch(() => props.open, (open) => {
  if (!open) return
  // 每次打开都从当前值起步；留空时给 09:00 作为合理默认
  const parsed = parseTimeValue(props.modelValue)
  hour.value = parsed.hour
  // 分钟必须落到刻度上：否则滚轮显示 35 而预览还是 33，确认后会写入一个
  // 滚轮根本没停过的值。这里统一吸附到最近的整格。
  minute.value = wheelValueAtIndex(minuteValues.value, wheelIndexForValue(minuteValues.value, parsed.minute))
  hadValue.value = Boolean(String(props.modelValue ?? '').trim())
}, { immediate: true })

const preview = computed(() => formatTimeValue(hour.value, minute.value))

function pad(value) {
  return String(value).padStart(2, '0')
}

function confirm() {
  emit('update:modelValue', preview.value)
  emit('close')
}

function clear() {
  emit('update:modelValue', '')
  emit('close')
}
</script>

<template>
  <Modal :open="open" :title="title" medium sheet :sheet-detents="[0.5, 0.74]" @close="emit('close')">
    <div class="time-wheel">
      <p class="time-wheel-preview" role="status" aria-live="polite">{{ preview }}</p>
      <div class="time-wheel-row">
        <div class="time-wheel-column">
          <WheelPicker v-model="hour" :values="hourValues" label="小时" :format="pad" />
          <span class="time-wheel-unit">时</span>
        </div>
        <span class="time-wheel-colon" aria-hidden="true">:</span>
        <div class="time-wheel-column">
          <WheelPicker v-model="minute" :values="minuteValues" label="分钟" :format="pad" />
          <span class="time-wheel-unit">分</span>
        </div>
      </div>
      <p class="time-wheel-hint">上下拨动选择，松手后自动对齐到整格；也可以用方向键。</p>
    </div>

    <template #foot>
      <div class="time-wheel-actions">
        <button type="button" class="btn" @click="emit('close')">取消</button>
        <button v-if="clearable && hadValue" type="button" class="btn btn-ghost" @click="clear">清除时间</button>
        <button type="button" class="btn btn-primary" @click="confirm">确定</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.time-wheel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.time-wheel-preview {
  color: var(--primary);
  font-size: var(--fs-30);
  font-weight: var(--fw-800);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  text-align: center;
}
.time-wheel-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.time-wheel-column {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.time-wheel-unit {
  color: var(--ink-faint);
  font-size: var(--fs-11);
}
.time-wheel-colon {
  flex: 0 0 auto;
  padding-bottom: 18px;
  color: var(--muted);
  font-size: var(--fs-24);
  font-weight: var(--fw-800);
}
.time-wheel-hint {
  color: var(--ink-faint);
  font-size: var(--fs-11);
  line-height: 1.5;
  text-align: center;
}
.time-wheel-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.time-wheel-actions .btn-primary {
  flex: 1;
}
</style>