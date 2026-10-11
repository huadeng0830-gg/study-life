<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { APP_RELEASE, PREVIOUS_RELEASE_GROUPS, RELEASE_NOTES } from '../composables/releaseNotes.js'
import '../styles/shadcn.css'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  <Modal :open="open" title="更新说明" :title-level="2" medium sheet :sheet-detents="[0.72, 0.94]" @close="emit('close')">
    <div class="release-notes">
      <Card class="release-current" role="region" aria-labelledby="release-current-title">
        <CardHeader class="release-current-header">
          <div class="release-current-heading"><Badge as="span" variant="outline" class="release-version">版本 {{ APP_RELEASE }}</Badge><span class="release-current-label">当前版本</span></div>
          <CardTitle id="release-current-title">本次更新</CardTitle>
        </CardHeader>
        <CardContent class="release-current-content">
        <ul><li v-for="(note, index) in RELEASE_NOTES" :key="index">{{ note }}</li></ul>
        </CardContent>
      </Card>
      <Card v-if="PREVIOUS_RELEASE_GROUPS.length" class="release-history" role="region" aria-labelledby="release-history-title">
        <CardHeader class="release-history-header"><CardTitle id="release-history-title" class="previous-title">之前的更新</CardTitle></CardHeader>
        <CardContent class="release-history-content">
        <details v-for="group in PREVIOUS_RELEASE_GROUPS" :key="group.version" class="previous-group" @toggle="toggleVersion(group.version, $event)">
          <summary><span class="previous-version">{{ group.version }}</span><small>{{ group.notes.length }} 项更新</small></summary>
          <ul v-if="expandedVersions.has(group.version)"><li v-for="(note, index) in group.notes" :key="index">{{ note }}</li></ul>
        </details>
        </CardContent>
      </Card>
      <button type="button" class="btn btn-primary" @click="emit('close')">关闭</button>
    </div>
  </Modal>
</template>

<style scoped>
.release-notes { display:grid; gap:14px; }
.release-current, .release-history { gap:0; padding:0; border-color:var(--border); border-radius:var(--radius-12); background:var(--card); box-shadow:var(--shadow-sm); }
.release-current-header { display:grid; gap:12px; padding:16px 16px 0; }
.release-current-header :deep([data-slot="card-title"]) { margin:0; color:var(--text); font-size:var(--fs-16); }
.release-current-content { padding:12px 16px 16px; }
.release-current-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.release-version { align-self:flex-start; padding:4px 8px; border-color:color-mix(in srgb, var(--primary) 24%, var(--border)); color:var(--primary); font-size:var(--fs-11); font-weight:var(--fw-800); background:var(--primary-soft); font-variant-numeric:tabular-nums; }
.release-current-label { color:var(--muted); font-size:var(--fs-11); }
.release-history-header { padding:14px 16px 0; }
.release-history-header :deep([data-slot="card-title"]) { margin:0; color:var(--ink-soft); font-size:var(--fs-13); }
.release-history-content { display:grid; gap:8px; padding:10px 16px 16px; }
.release-notes ul { display:flex; flex-direction:column; gap:8px; margin:0; padding-left:20px; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.previous-group { padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-9); background: var(--bg-tint); }
.previous-group summary { display:flex; align-items:center; min-height:44px; padding-block:10px; color:var(--ink-soft); cursor:pointer; }
.previous-group summary small { margin-left: 8px; color: var(--muted); font-size: var(--fs-10); white-space: nowrap; }
.previous-group summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: var(--radius-6); }
.previous-group ul { padding-block:3px 12px; }
.previous-version { font-size: var(--fs-12); font-weight: var(--fw-700); overflow-wrap: anywhere; }
.release-notes .btn { justify-self:end; min-width:96px; margin-top:2px; }
@media (max-width:520px) {
  .release-current-header { padding:14px 14px 0; }
  .release-current-content { padding:12px 14px 14px; }
  .release-history-header { padding:14px 14px 0; }
  .release-history-content { padding:10px 14px 14px; }
}
</style>
