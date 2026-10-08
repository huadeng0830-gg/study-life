<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'
import { measureLocalBusinessStorage } from '../../composables/localStorageUsage.js'

const { includeWallpapers, exportBackup } = useDataManagerBackup()
const storageUsage = ref({ chars: 0, keyCount: 0, percent: 0, warning: false })
const refreshStorageUsage = () => { storageUsage.value = measureLocalBusinessStorage() }
onMounted(() => {
  refreshStorageUsage()
  window.addEventListener('study-life:storage-updated', refreshStorageUsage)
  window.addEventListener('pageshow', refreshStorageUsage)
})
onUnmounted(() => {
  window.removeEventListener('study-life:storage-updated', refreshStorageUsage)
  window.removeEventListener('pageshow', refreshStorageUsage)
})
</script>

<template>
  <section id="data-backup" class="data-section">
    <div class="section-icon">↓</div>
    <div class="section-copy">
      <h4>导出本地数据</h4>
      <p>完整备份包含课程、日程、待办与快速记录、重要日期、清单、账本、专注与心情、提醒记录和个性化设置。</p>
      <p class="wallpaper-note">壁纸图片仅保存在本机，可选随备份携带；勾选后文件会明显变大。</p>
      <p class="storage-usage" :class="{ warning: storageUsage.warning }" role="status">
        本机业务数据约 {{ storageUsage.chars.toLocaleString() }} 字符（{{ storageUsage.keyCount }} 项）；浏览器常见上限约 500 万字符，当前约 {{ storageUsage.percent }}%。
      </p>
      <p v-if="storageUsage.warning" class="storage-warning" role="alert">本机存储已接近常见浏览器上限。建议先导出备份，并清理不再需要的历史记录。</p>
      <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
      <button class="btn btn-primary" @click="exportBackup">导出本机完整备份</button>
    </div>
  </section>
</template>

<style scoped>
.section-icon {
  width:38px;
  height:38px;
  color:var(--primary);
  background:var(--primary-soft);
  border-radius:var(--radius-10);
  flex:0 0 38px;
  place-items:center;
  font-size:var(--fs-20);
  font-weight:var(--fw-800);
  display:grid}
.section-copy {
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  font-size:var(--fs-14)}
.section-copy p {
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
.section-copy .wallpaper-note {
  font-size:var(--fs-11)}
.section-copy .storage-usage {
  color:var(--ink-soft);
  font-size:var(--fs-11)}
.section-copy .storage-usage.warning,
.section-copy .storage-warning {
  color:var(--danger)}
.wallpaper-option {
  color:var(--text);
  align-items:center;
  gap:7px;
  min-height:44px;
  font-size:var(--fs-12);
  display:inline-flex}
@media (max-width:520px) {
  .section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
  .section-copy {
  width:100%;
  min-width:0}
}</style>
