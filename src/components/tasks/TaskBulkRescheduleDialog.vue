<script setup>
/**
 * 批量改期对话框：把选中的一批待办整体平移若干天。
 *
 * 【为什么是「整体平移」而不是逐条打开改期对话框】三十条待办开三十次对话框没有人受得了。
 * 真实场景（考试周到了、放假顺延一周）要的又恰恰是「一起挪」这一个动作，所以这里只提供
 * 平移，不试图在一次操作里表达三十种不同的安排——那不是批量，那是三十次单条操作。
 *
 * 【刻意只给「天」不给「小时/分钟」】跨小时的批量平移会撞上夏令时不存在的时刻，而单条改期
 * 已经有完整的逐条校验和冲突提示。批量这里保持在天这个粒度，语义简单也不会悄悄推错时间。
 */
import { ref, useId } from 'vue'
import Modal from '../Modal.vue'

defineProps({
  count: { type: Number, default: 0 },
})

const emit = defineEmits(['close', 'apply'])

const formId = useId()
const direction = ref('later')
const days = ref(7)

const PRESETS = [
  { direction: 'later', days: 1, label: '顺延 1 天' },
  { direction: 'later', days: 7, label: '顺延 1 周' },
  { direction: 'later', days: 14, label: '顺延 2 周' },
  { direction: 'earlier', days: 1, label: '提前 1 天' },
  { direction: 'earlier', days: 7, label: '提前 1 周' },
]

const amount = () => Math.max(1, Math.abs(Number(days.value) || 0))
</script>

<template>
  <Modal :open="true" title="批量改期" @close="emit('close')">
    <form :id="formId" class="bulk-shift" novalidate @submit.prevent="emit('apply', { direction, days: amount() })">
      <p>把选中的 {{ count }} 项待办的截止时间与未完成阶段一起平移。已完成的阶段不会被移动。</p>
      <div class="shift-presets" role="group" aria-label="常用平移">
        <button
          v-for="preset in PRESETS"
          :key="preset.label"
          type="button"
          :aria-pressed="direction === preset.direction && amount() === preset.days"
          @click="direction = preset.direction; days = preset.days"
        >{{ preset.label }}</button>
      </div>
      <label for="bulk-shift-days">天数<input id="bulk-shift-days" v-model="days" type="number" min="1" step="1" inputmode="numeric" /></label>
      <p class="shift-result">
        将{{ direction === 'earlier' ? '提前' : '顺延' }} {{ amount() }} 天
      </p>
    </form>
    <template #foot>
      <div class="actions">
        <button type="button" class="btn" @click="emit('close')">取消</button>
        <button type="submit" :form="formId" class="btn btn-primary">应用改期</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.bulk-shift { display: grid; gap: 12px; }
.bulk-shift > p { margin: 0; color: var(--ink-soft); font-size: var(--fs-13); line-height: 1.6; }
.bulk-shift label { display: grid; gap: 6px; color: var(--ink-soft); font-size: var(--fs-12); font-weight: var(--fw-700); }
.bulk-shift input { width: 100%; box-sizing: border-box; }
.shift-presets { display: flex; flex-wrap: wrap; gap: 7px; }
.shift-presets button {
  min-height: 36px;
  padding: 7px 12px;
  color: var(--ink-soft);
  font-size: var(--fs-12);
  cursor: pointer;
  background: var(--bg-tint);
  border: 1px solid var(--border);
  border-radius: var(--radius-8);
}
.shift-presets button[aria-pressed="true"] { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }
.shift-result { color: var(--primary) !important; font-weight: var(--fw-700); }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>