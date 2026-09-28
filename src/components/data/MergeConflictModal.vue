<script setup>
import Modal from '../Modal.vue'
import { useDataManagerSyncActions } from '../../composables/dataManagerSyncActions.js'

const {
  syncPreview, conflictChoices, conflictChoiceKey, displayConflictValue,
  getConflictReasonText, closeMergePreview, commitConflictChoices,
} = useDataManagerSyncActions()
</script>

<template>
  <Modal :open="true" title="同步差异需要确认" :wide="true" @close="closeMergePreview">
    <div class="merge-conflicts">
      <p class="merge-intro">系统已暂停应用冲突记录。请选择每条记录保留本机或云端版本，未选择的项目不会提交。</p>
      <article v-for="conflict in syncPreview.conflicts" :key="conflictChoiceKey(conflict)" class="merge-conflict">
        <div class="merge-conflict-head">
          <b>{{ conflict.label }}</b>
          <small>{{ conflict.entityType || '设置' }} · {{ conflict.entityId }}</small>
        </div>
        <div v-if="conflict.fields.length" class="merge-fields">
          <div v-for="field in conflict.fields" :key="field.field" class="merge-field">
            <span>{{ field.field }}</span><em>本机：{{ displayConflictValue(field.local) }}</em><em>云端：{{ displayConflictValue(field.remote) }}</em>
          </div>
        </div>
        <small v-else class="merge-reason">{{ getConflictReasonText(conflict) }}</small>
        <div class="merge-choice">
          <button type="button" class="btn btn-sm" :class="{ selected: conflictChoices[conflictChoiceKey(conflict)] === 'local' || conflictChoices[conflictChoiceKey(conflict)] === 'restore-local' }" @click="conflictChoices[conflictChoiceKey(conflict)] = conflict.status === 'delete-update-conflict' ? 'restore-local' : 'local'">{{ conflict.status === 'delete-update-conflict' ? '恢复本机记录' : '保留本机' }}</button>
          <button type="button" class="btn btn-sm" :class="{ selected: conflictChoices[conflictChoiceKey(conflict)] === 'remote' || conflictChoices[conflictChoiceKey(conflict)] === 'keep-deleted' }" @click="conflictChoices[conflictChoiceKey(conflict)] = conflict.status === 'delete-update-conflict' ? 'keep-deleted' : 'remote'">{{ conflict.status === 'delete-update-conflict' ? '接受删除' : '使用云端' }}</button>
        </div>
      </article>
      <div class="actions"><button type="button" class="btn" @click="closeMergePreview">稍后处理</button><button type="button" class="btn btn-primary" @click="commitConflictChoices">提交已选决策</button></div>
    </div>
  </Modal>
</template>

<style scoped>
.merge-conflicts {
  flex-direction:column;
  gap:10px;
  display:flex}
.merge-intro {
  color:var(--muted);
  margin:0;
  font-size:var(--fs-12);
  line-height:1.55}
.merge-conflict {
  border:1px solid color-mix(in srgb, var(--warning) 35%, var(--card));
  background:color-mix(in srgb, var(--warning) 6%, var(--card));
  border-radius:var(--radius-10);
  padding:11px 12px}
.merge-conflict-head {
  color:var(--warning);
  justify-content:space-between;
  gap:10px;
  display:flex}
.merge-conflict-head small,.merge-reason {
  color:var(--warning);
  font-size:var(--fs-11)}
.merge-fields {
  gap:5px;
  margin-top:8px;
  display:grid}
.merge-field {
  grid-template-columns:90px 1fr 1fr;
  gap:7px;
  font-size:var(--fs-11);
  line-height:1.45;
  display:grid}
.merge-field span {
  color:var(--muted)}
.merge-field em {
  overflow-wrap:anywhere;
  color:var(--text);
  font-style:normal}
.merge-choice {
  gap:7px;
  margin-top:9px;
  display:flex}
.merge-choice .selected {
  color:var(--on-primary,#fff);
  border-color:var(--primary);
  background:var(--primary)}</style>
