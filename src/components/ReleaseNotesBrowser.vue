<script setup>
import Modal from './Modal.vue'
import { APP_RELEASE, PREVIOUS_RELEASE_GROUPS, RELEASE_NOTES } from '../composables/releaseNotes.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])
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
  <Modal :open="open" title="更新说明" @close="emit('close')">
    <div class="release-notes">
      <span class="release-version">版本 {{ APP_RELEASE }}</span>
      <h4>这次有这些变化</h4>
      <ul><li v-for="(note, index) in RELEASE_NOTES" :key="index">{{ note }}</li></ul>
      <template v-if="PREVIOUS_RELEASE_GROUPS.length">
        <h4 class="previous-title">之前的更新</h4>
        <div v-for="group in PREVIOUS_RELEASE_GROUPS" :key="group.version" class="previous-group">
          <span class="previous-version">{{ group.version }}</span>
          <ul><li v-for="(note, index) in group.notes" :key="index">{{ note }}</li></ul>
        </div>
      </template>
      <button type="button" class="btn btn-primary" autofocus @click="emit('close')">关闭</button>
    </div>
  </Modal>
</template>

<style scoped>
.release-notes { display: flex; flex-direction: column; gap: 12px; }
.release-version { align-self: flex-start; padding: 4px 8px; color: var(--primary); font-size: var(--fs-10); font-weight: var(--fw-800); border-radius: var(--radius-6); background: var(--primary-soft); }
.release-notes h4 { font-size: var(--fs-16); }
.release-notes h4.previous-title { margin-top: 6px; font-size: var(--fs-13); color: var(--ink-faint); }
.release-notes ul { display: flex; flex-direction: column; gap: 8px; margin: 0; padding-left: 20px; color: var(--muted); font-size: var(--fs-12); line-height: 1.55; }
.previous-group { display: flex; flex-direction: column; gap: 6px; }
.previous-version { align-self: flex-start; padding: 2px 7px; color: var(--ink-faint); font-size: var(--fs-10); font-weight: var(--fw-700); border-radius: var(--radius-6); background: var(--bg-tint); }
.release-notes .btn { align-self: flex-end; min-width: 96px; margin-top: 4px; }
</style>