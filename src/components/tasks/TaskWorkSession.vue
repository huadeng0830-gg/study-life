<script setup>
import { computed } from 'vue'
import Modal from '../Modal.vue'
import TaskWorkCheckpointFields from './TaskWorkCheckpointFields.vue'
import { safeTaskResourceLinks } from '../../composables/tasks/taskWorkProgress.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  task: { type: Object, default: null },
  checkpoint: { type: Object, default: null },
  checkpointUpdatedAt: { type: String, default: '' },
  checkpointActorName: { type: String, default: '' },
  form: { type: Object, required: true },
  statusLabel: { type: String, default: '' },
  startLabel: { type: String, default: '开始执行' },
  canStart: { type: Boolean, default: false },
  canSave: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  readonly: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'start', 'save', 'update:field'])
const displayResources = computed(() => safeTaskResourceLinks(props.checkpoint?.resources))

function updateField(field, value) {
  emit('update:field', field, value)
}

function formatUpdatedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <Modal :open="open" :title="task ? `${task.title} · 工作进度` : '任务工作进度'" :medium="true" :sheet="true" @close="emit('close')">
    <div v-if="task" class="task-work-session">
      <div class="task-work-status"><span>当前状态</span><strong>{{ statusLabel }}</strong></div>

      <section class="task-work-last" aria-label="上次进度">
        <h3>上次进度</h3>
        <p v-if="checkpoint?.lastStep"><b>上次做到</b>{{ checkpoint.lastStep }}</p>
        <p v-if="checkpoint?.blocker"><b>遇到的问题</b>{{ checkpoint.blocker }}</p>
        <p v-if="checkpoint?.nextStep" class="task-work-next"><b>下一步</b>{{ checkpoint.nextStep }}</p>
        <div v-if="displayResources.length" class="task-work-resources">
          <b>关联资料</b>
          <a v-for="url in displayResources" :key="url" :href="url" target="_blank" rel="noopener noreferrer">{{ url }}</a>
        </div>
        <p v-if="!checkpoint?.lastStep && !checkpoint?.blocker && !checkpoint?.nextStep && !displayResources.length" class="task-work-empty">还没有进度记录，先写下这次做到哪里和下一步。</p>
        <small v-if="formatUpdatedAt(checkpointUpdatedAt || checkpoint?.updatedAt)" class="task-work-time">最近保存 {{ formatUpdatedAt(checkpointUpdatedAt || checkpoint?.updatedAt) }}<template v-if="checkpointActorName"> · {{ checkpointActorName }}</template></small>
      </section>

      <TaskWorkCheckpointFields
        :form="form"
        :task="{ ...task, workCheckpoint: checkpoint }"
        :editing="true"
        :always-open="true"
        :readonly="readonly"
        id-prefix="task-work-checkpoint"
        @update:field="updateField"
      />

      <p v-if="error" class="task-work-error" role="alert">{{ error }}</p>
      <div class="task-work-actions">
        <button v-if="canStart" class="btn btn-secondary" type="button" :disabled="busy" @click="emit('start')">{{ startLabel }}</button>
        <button v-if="canSave" class="btn btn-primary" type="button" :disabled="busy" @click="emit('save')">{{ busy ? '保存中…' : '保存进度' }}</button>
        <button v-if="!canStart && !canSave" class="btn btn-ghost" type="button" @click="emit('close')">关闭</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.task-work-session { display: flex; flex-direction: column; gap: 14px; }
.task-work-status { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: var(--fs-13); }
.task-work-status strong { color: var(--primary); font-size: var(--fs-14); }
.task-work-last { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-12); background: var(--bg-tint); }
.task-work-last h3 { margin: 0; font-size: var(--fs-14); }
.task-work-last p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-13); }
.task-work-last p b, .task-work-resources > b { display: block; margin-bottom: 3px; color: var(--ink-soft); font-size: var(--fs-12); }
.task-work-last p.task-work-next { color: var(--primary); font-weight: var(--fw-700); }
.task-work-resources { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-13); }
.task-work-resources a { overflow-wrap: anywhere; color: var(--primary); }
.task-work-empty, .task-work-time { color: var(--muted); }
.task-work-time { font-size: var(--fs-11); }
.task-work-error { margin: 0; color: var(--danger); font-size: var(--fs-13); }
.task-work-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
