<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { APP_RELEASE, PREVIOUS_RELEASE_GROUPS, RELEASE_NOTES } from '../composables/releaseNotes.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])
const expandedVersions = ref(new Set())

function toggleVersion(version, event) {
  if (event.target?.open) expandedVersions.value.add(version)
  else expandedVersions.value.delete(version)
}
</script>

<template>
  <!--
    纯查阅用的更新说明，**刻意与 UpdateNotes 分开**。

    UpdateNotes 是"新版本提示"：它由 App.vue 在版本变化时自动弹出，任何关闭路径
    （点「知道了」、点 ✕、按 Esc）都会 markReleaseSeen() —— 那是必须的，
    否则同一个版本会每次启动都弹一遍。

    但副作用是：用户点过一次之后，AppUpdateSection 里就再也看不到任何历史说明
    （它当时只渲染 APP_RELEASE 这一行）。于是「这次到底改了什么」变成不可回查的。

    这里只读、不写已读标记，所以可以随时打开翻历史；
    将来真的更新了版本，UpdateNotes 仍然会正常弹出。
  -->
  <Modal :open="open" title="更新说明" medium sheet :sheet-detents="[0.72, 0.94]" @close="emit('close')">
    <div class="release-notes">
      <span class="release-version">版本 {{ APP_RELEASE }}</span>
      <h3>本次更新</h3>
      <ul><li v-for="(note, index) in RELEASE_NOTES" :key="index">{{ note }}</li></ul>
      <template v-if="PREVIOUS_RELEASE_GROUPS.length">
        <h3 class="previous-title">之前的更新</h3>
        <details v-for="group in PREVIOUS_RELEASE_GROUPS" :key="group.version" class="previous-group" @toggle="toggleVersion(group.version, $event)">
          <summary><span class="previous-version">{{ group.version }}</span><small>{{ group.notes.length }} 项更新</small></summary>
          <ul v-if="expandedVersions.has(group.version)"><li v-for="(note, index) in group.notes" :key="index">{{ note }}</li></ul>
        </details>
      </template>
      <button type="button" class="btn btn-primary" @click="emit('close')">关闭</button>
    </div>
  </Modal>
</template>

<style scoped>
.release-notes { display: flex; flex-direction: column; gap: 12px; }
.release-version { align-self: flex-start; padding: 4px 8px; color: var(--primary); font-size: var(--fs-10); font-weight: var(--fw-800); border-radius: var(--radius-6); background: var(--primary-soft); }
.release-notes h3 { margin: 0; font-size: var(--fs-16); }
.release-notes h3.previous-title { margin-top: 6px; font-size: var(--fs-13); color: var(--ink-faint); }
.release-notes ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding-left: 20px; color: var(--muted); font-size: var(--fs-12); line-height: 1.55; }
.previous-group { padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg-tint); }
.previous-group summary { min-height: 44px; padding-block: 12px; color: var(--ink-soft); cursor: pointer; }
.previous-group summary small { margin-left: 8px; color: var(--muted); font-size: var(--fs-10); white-space: nowrap; }
.previous-group summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-6); }
.previous-group ul { padding-block: 3px 12px; }
.previous-version { font-size: var(--fs-12); font-weight: var(--fw-700); overflow-wrap: anywhere; }
.release-notes .btn { align-self: flex-end; min-width: 96px; margin-top: 4px; }
</style>
