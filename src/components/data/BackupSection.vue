<script setup>
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'

const { includeWallpapers, exportBackup } = useDataManagerBackup()
</script>

<template>
  <section id="data-backup" class="data-section">
    <div class="section-icon">↓</div>
    <div class="section-copy">
      <h4>导出本地数据</h4>
      <p>完整备份包含课程、日程、待办与快速记录、重要日期、清单、账本、专注与心情、提醒记录和个性化设置。</p>
      <p class="wallpaper-note">壁纸图片仅保存在本机，可选随备份携带；勾选后文件会明显变大。</p>
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
