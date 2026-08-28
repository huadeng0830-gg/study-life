<script setup>
import Modal from './Modal.vue'
import { APP_RELEASE, markReleaseSeen, PREVIOUS_RELEASE_GROUPS, RELEASE_NOTES } from '../composables/releaseNotes.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])

function acknowledge() {
  markReleaseSeen()
  emit('close')
}
</script>

<template>
  <Modal :open="open" title="✨ 已更新" @close="acknowledge">
    <div class="release-notes">
      <span class="release-version">版本 {{ APP_RELEASE }}</span>
      <h4>这次有这些变化</h4>
      <ul><li v-for="note in RELEASE_NOTES" :key="note">{{ note }}</li></ul>
      <template v-if="PREVIOUS_RELEASE_GROUPS.length">
        <h4 class="previous-title">之前的更新</h4>
        <div v-for="group in PREVIOUS_RELEASE_GROUPS" :key="group.version" class="previous-group">
          <span class="previous-version">{{ group.version }}</span>
          <ul><li v-for="note in group.notes" :key="note">{{ note }}</li></ul>
        </div>
      </template>
      <button type="button" class="btn btn-primary" @click="acknowledge">知道了</button>
    </div>
  </Modal>
</template>

<style scoped>
.release-notes { display: flex; flex-direction: column; gap: 12px; }
.release-version { align-self: flex-start; padding: 4px 8px; color: var(--primary); font-size: 10px; font-weight: 800; border-radius: 6px; background: var(--primary-soft); }
.release-notes h4 { font-size: 16px; }
.release-notes h4.previous-title { margin-top: 6px; font-size: 13px; color: var(--ink-faint); }
.release-notes ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.55; }
.previous-group { display: flex; flex-direction: column; gap: 6px; }
.previous-version { align-self: flex-start; padding: 2px 7px; color: var(--ink-faint); font-size: 10px; font-weight: 700; border-radius: 6px; background: var(--bg-tint); }
.release-notes .btn { align-self: flex-end; min-width: 96px; margin-top: 4px; }
</style>
