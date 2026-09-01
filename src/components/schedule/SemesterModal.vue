<script setup>
import { computed, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { mondayOfDate } from '../../composables/store/schedule.js'

const props = defineProps({
  show: { type: Boolean, required: true },
  startDate: { type: String, required: true },
  previewWeek: { type: [String, Number], default: '' },
})

const emit = defineEmits(['close', 'save'])

const value = ref(props.startDate)
const normalizedDate = computed(() => mondayOfDate(value.value))
const needsNormalization = computed(() => Boolean(value.value) && normalizedDate.value !== value.value)

watch(() => props.show, (open) => {
  if (open) value.value = props.startDate
})

function save() {
  if (!normalizedDate.value) return
  emit('save', normalizedDate.value)
}
</script>

<template>
  <Modal v-if="show" :open="show" title="📅 学期设置" @close="emit('close')">
    <div class="form">
      <label>本学期第一周的周一日期 *</label>
      <input v-model="value" type="date" />
      <p v-if="needsNormalization" class="date-warning">已按所在周的周一处理：{{ normalizedDate }}。</p>
      <p class="muted-tip">
        设置后自动计算当前周次。例如 9月1日开学（周一），今天若在开学后第 3 周内，则显示「第 3 周」。
        <template v-if="previewWeek !== ''">
          <template v-if="Number(previewWeek) < 1">当前尚未到第一周。</template>
          <template v-else>当前设置下今天是<b> 第 {{ previewWeek }} 周</b>。</template>
        </template>
      </p>
      <div class="actions">
        <button class="btn btn-primary" :disabled="!normalizedDate" @click="save">保存</button>
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
.date-warning { margin: -4px 0 0; color: var(--danger); font-size: 12px; }
</style>
