<script setup>
import { reactive, ref, watch } from 'vue'
import Modal from '../Modal.vue'
import { todayStr } from '../../composables/store/utils.js'

const props = defineProps({
  show: { type: Boolean, required: true },
  exceptions: { type: Array, required: true },
  days: { type: Array, required: true },
})

const emit = defineEmits(['close', 'submit', 'remove'])

const form = reactive({ date: todayStr(), type: 'off', sourceDay: 0, note: '' })
const error = ref('')

watch(() => props.show, (open) => {
  if (open) {
    form.date = todayStr()
    form.type = 'off'
    form.sourceDay = 0
    form.note = ''
    error.value = ''
  }
})

function submit() {
  if (!form.date) {
    error.value = '请选择特殊日期'
    return
  }
  emit('submit', {
    date: form.date,
    type: form.type,
    sourceDay: form.type === 'makeup' ? Number(form.sourceDay) : null,
    note: form.note.trim(),
  })
  form.note = ''
}

function exceptionLabel(item) {
  if (!item) return ''
  return item.type === 'makeup' ? `补${props.days[item.sourceDay] ?? '课'}` : '停课'
}
</script>

<template>
  <Modal v-if="show" :open="show" title="🗓 节假日与补课" wide @close="emit('close')">
    <div class="exception-editor">
      <p class="muted-tip">特殊日期只影响指定的一天，不会修改原来的每周课程。补课可以让某天临时按照指定星期显示课程。</p>
      <div class="exception-form">
        <label>日期<input v-model="form.date" type="date" @input="error = ''" /></label>
        <label>安排
          <select v-model="form.type">
            <option value="off">停课 / 放假</option>
            <option value="makeup">补课</option>
          </select>
        </label>
        <label v-if="form.type === 'makeup'">按照
          <select v-model.number="form.sourceDay">
            <option v-for="(day, index) in days" :key="day" :value="index">{{ day }}课表</option>
          </select>
        </label>
        <label class="exception-note">说明<input v-model="form.note" placeholder="例如：国庆放假、周六补周一课程" /></label>
        <button class="btn btn-primary" @click="submit">保存特殊日期</button>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
      <div v-if="exceptions.length" class="exception-list">
        <div v-for="item in exceptions" :key="item.id" class="exception-item">
          <div>
            <b>{{ item.date }}</b>
            <span :class="item.type">{{ exceptionLabel(item) }}</span>
            <small>{{ item.note || (item.type === 'makeup' ? `当天按照${days[item.sourceDay]}课表` : '当天课程暂停') }}</small>
          </div>
          <button class="btn btn-danger" @click="emit('remove', item.id)">删除</button>
        </div>
      </div>
      <p v-else class="manager-empty">还没有设置特殊日期。</p>
    </div>
  </Modal>
</template>

<style scoped>
.exception-editor { display: flex; flex-direction: column; gap: 13px; }
.exception-form {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: end;
  gap: 9px;
}
.exception-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: 11px;
}
.exception-form input, .exception-form select { width: 100%; }
.exception-note { grid-column: 1 / 3; }
.exception-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 310px;
  overflow-y: auto;
}
.exception-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}
.exception-item>div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}
.exception-item b { font-size: 12px; }
.exception-item span {
  padding: 3px 6px;
  color: #b13f3f;
  font-size: 9px;
  font-weight: 800;
  border-radius: 5px;
  background: #feecec;
}
.exception-item span.makeup { color: #7a55e8; background: #f1ebff; }
.exception-item small { width: 100%; color: var(--muted); font-size: 10px; }

@media (max-width: 760px) {
  .exception-form { grid-template-columns: 1fr 1fr; }
  .exception-note { grid-column: 1 / -1; }
  .exception-form>.btn { grid-column: 1 / -1; }
}
</style>
