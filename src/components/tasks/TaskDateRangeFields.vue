<script setup>
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../ui/field'

defineProps({ form: { type: Object, required: true }, errorField: { type: String, default: '' }, errorId: { type: String, default: '' } })
const emit = defineEmits(['change', 'register-input'])
const endpoints = [{ key: 'start', label: '开始' }, { key: 'due', label: '截止' }]
function inputValue(event) { return event.target.value }
</script>

<template>
  <FieldDescription>开始、截止均可选填，阶段按需添加。起止期间不会占用整段日程。</FieldDescription>
  <FieldGroup v-for="point in endpoints" :key="point.key" class="grid grid-cols-2 gap-2.5 form-row deadline-row">
    <Field :data-invalid="errorField === `${point.key}Date` || undefined">
      <FieldLabel :for="`tasks-${point.key}-date`">{{ point.label }}日期</FieldLabel>
      <input :id="`tasks-${point.key}-date`" :ref="input => emit('register-input', `${point.key}Date`, input)" :value="form[`${point.key}Date`]" type="date"
        :aria-invalid="errorField === `${point.key}Date` || undefined" :aria-describedby="errorField === `${point.key}Date` ? errorId || undefined : undefined"
        @input="emit('change', `${point.key}Date`, inputValue($event))" />
    </Field>
    <Field :data-disabled="!form[`${point.key}Date`] || undefined" :data-invalid="errorField === `${point.key}Time` || undefined">
      <FieldLabel :for="`tasks-${point.key}-time`">{{ point.label }}时间（选填）</FieldLabel>
      <input :id="`tasks-${point.key}-time`" :ref="input => emit('register-input', `${point.key}Time`, input)" :value="form[`${point.key}Time`]" type="time" :disabled="!form[`${point.key}Date`]"
        :aria-invalid="errorField === `${point.key}Time` || undefined" :aria-describedby="errorField === `${point.key}Time` ? errorId || undefined : undefined"
        @input="emit('change', `${point.key}Time`, inputValue($event))" />
    </Field>
  </FieldGroup>
</template>

<style scoped>
.deadline-row input { width: 100%; min-width: 0; }
</style>
