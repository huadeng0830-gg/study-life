<script setup>
import { ref, watch } from 'vue'
import Modal from '../Modal.vue'

const props = defineProps({
  show: { type: Boolean, required: true },
  startDate: { type: String, required: true },
  previewWeek: { type: [String, Number], default: '' },
})

const emit = defineEmits(['close', 'save'])

const value = ref(props.startDate)

watch(() => props.show, (open) => {
  if (open) value.value = props.startDate
})

function save() {
  if (!value.value) return
  emit('save', value.value)
}
</script>

<template>
  <Modal v-if="show" :open="show" title="📅 学期设置" @close="emit('close')">
    <div class="form">
      <label>本学期第一周的周一日期 *</label>
      <input v-model="value" type="date" />
      <p class="muted-tip">
        设置后自动计算当前周次。例如 9月1日开学（周一），今天若在开学后第 3 周内，则显示「第 3 周」。
        <template v-if="previewWeek">
          当前设置下今天是<b> 第 {{ previewWeek }} 周</b>。
        </template>
      </p>
      <div class="actions">
        <button class="btn btn-primary" @click="save">保存</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 12px; }
.muted-tip {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
</style>