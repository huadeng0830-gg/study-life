<script setup>
import { computed, watch } from 'vue'
import { announce } from '../composables/liveRegion.js'
import { applyAppUpdate, webUpdateState } from '../composables/appUpdate.js'
import { deferUpdateReminder, shouldShowUpdateReminder } from '../composables/updatePreferences.js'

const notice = computed(() => {
  const { stage, availableVersion: version } = webUpdateState
  if (!version || !['available', 'ready', 'blocked', 'manual-reload'].includes(stage)
    || !shouldShowUpdateReminder(version)) return null
  const ready = ['ready', 'manual-reload'].includes(stage)
  return { stage, version, ready,
    message: ready ? `新版本 ${version} 已准备好，可以完成更新。` : `发现新版本 ${version}，现在可以查看更新内容。` }
})

watch(notice, (current, previous) => {
  if (current && (!previous || current.version !== previous.version || current.stage !== previous.stage)) announce(current.message)
})

function openNotice() {
  if (notice.value?.ready) void applyAppUpdate()
  else window.dispatchEvent(new CustomEvent('study-life:open-app-updates'))
}

function deferNotice() {
  const version = notice.value?.version
  if (version && deferUpdateReminder(version)) announce(`已暂缓 ${version} 的更新提醒 24 小时`)
}
</script>

<template>
  <div v-if="notice" class="global-update-notice">
    <span>{{ notice.message }}</span>
    <button type="button" class="text-button" @click="openNotice">{{ notice.ready ? '立即更新' : '查看更新' }}</button>
    <button type="button" class="text-button" @click="deferNotice">24 小时后提醒</button>
  </div>
</template>

<style scoped>
.global-update-notice {
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:8px 14px;
  margin:0 0 12px;
  padding:10px 12px;
  border:1px solid color-mix(in srgb,var(--primary) 28%,var(--border));
  border-radius:var(--radius-10);
  background:color-mix(in srgb,var(--primary) 8%,var(--card));
  color:var(--text);
  font-size:var(--fs-12)}
.global-update-notice span {
  flex:1;
  min-width:180px}
.global-update-notice .text-button {
  min-height:36px;
  color:var(--primary);
  white-space:nowrap}
</style>
