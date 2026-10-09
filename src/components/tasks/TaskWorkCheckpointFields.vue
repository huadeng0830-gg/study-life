<script setup>
import { computed } from 'vue'
import { safeTaskResourceLinks } from '../../composables/tasks/taskWorkProgress.js'

const props = defineProps({
  form: { type: Object, required: true },
  task: { type: Object, default: null },
  editing: { type: Boolean, default: false },
  alwaysOpen: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
  idPrefix: { type: String, default: 'tasks-checkpoint' },
})
const emit = defineEmits(['update:field'])
const checkpointResourceLinks = computed(() => safeTaskResourceLinks(props.task?.workCheckpoint?.resources))

function updateField(field, event) {
  emit('update:field', field, event.target.value)
}
</script>

<template>
  <details class="task-checkpoint-details" :open="alwaysOpen || Boolean(editing && (form.checkpointLastStep || form.checkpointBlocker || form.checkpointNextStep || form.checkpointResources))">
    <summary>断点续做 <small>记录进度、卡点和下一步</small></summary>
    <label :for="`${idPrefix}-last`">上次做到</label>
    <textarea :id="`${idPrefix}-last`" :value="props.form.checkpointLastStep" rows="2" maxlength="1000" placeholder="例如：已经完成数据清洗，正在检查异常值" :readonly="readonly" @input="updateField('checkpointLastStep', $event)"></textarea>
    <label :for="`${idPrefix}-blocker`">遇到的问题</label>
    <textarea :id="`${idPrefix}-blocker`" :value="props.form.checkpointBlocker" rows="2" maxlength="1000" placeholder="选填，写下目前卡住的地方" :readonly="readonly" @input="updateField('checkpointBlocker', $event)"></textarea>
    <label :for="`${idPrefix}-next`">下一步</label>
    <textarea :id="`${idPrefix}-next`" :value="props.form.checkpointNextStep" rows="2" maxlength="1000" placeholder="例如：核对缺失值后导出图表" :readonly="readonly" @input="updateField('checkpointNextStep', $event)"></textarea>
    <label :for="`${idPrefix}-resources`">资料链接（每行一条）</label>
    <textarea :id="`${idPrefix}-resources`" :value="props.form.checkpointResources" rows="2" placeholder="https://…" :readonly="readonly" @input="updateField('checkpointResources', $event)"></textarea>
    <ul v-if="editing && checkpointResourceLinks.length" class="checkpoint-resource-list">
      <li v-for="url in checkpointResourceLinks" :key="url"><a :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a></li>
    </ul>
  </details>
</template>

<style scoped>
.task-checkpoint-details { display: flex; flex-direction: column; gap: 7px; margin-top: 6px; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-10); background: var(--bg-tint); }
.task-checkpoint-details label { margin-top: 6px; color: var(--ink-soft); font-size: var(--fs-13); }
.task-checkpoint-details textarea { width: 100%; }
.task-checkpoint-details summary { display: flex; min-height: 40px; align-items: center; gap: 8px; color: var(--text); font-weight: var(--fw-700); cursor: pointer; }
.task-checkpoint-details summary small { color: var(--muted); font-size: var(--fs-11); font-weight: var(--fw-500); }
.checkpoint-resource-list { display: flex; flex-direction: column; gap: 5px; margin: 0; padding-left: 20px; font-size: var(--fs-12); }
.checkpoint-resource-list a { overflow-wrap: anywhere; color: var(--primary); }
</style>
