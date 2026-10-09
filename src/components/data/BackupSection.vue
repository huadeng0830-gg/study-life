<script setup>
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'
const { includeWallpapers, backupBusy, exporting, fileChecking, exportBackup } = useDataManagerBackup()
</script>

<template>
  <section class="data-section">
    <div class="section-icon" aria-hidden="true">↓</div>
    <div class="section-copy">
      <h4>导出本机完整备份</h4>
      <p>课程、日程、待办、重要日期、清单、账本、专注与心情、提醒记录和个性化设置会保存为一个 JSON 文件。</p>
      <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" :disabled="backupBusy" /><span><b>同时包含壁纸图片</b><small>换设备时可一起恢复；图片较多时，文件会更大。</small></span></label>
      <button type="button" class="btn btn-primary" :disabled="backupBusy || fileChecking" :aria-busy="exporting" @click="exportBackup">{{ exporting ? '正在生成备份…' : '导出完整备份' }}</button>
      <p class="backup-tip">导出后请确认文件已保存到下载目录或「文件」应用。</p>
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
  flex:1;
  min-width:0;
  flex-direction:column;
  align-items:flex-start;
  gap:7px;
  display:flex}
.section-copy h4 {
  margin:0;
  font-size:var(--fs-14)}
.section-copy p {
  margin:0;
  color:var(--muted);
  font-size:var(--fs-12);
  line-height:1.55}
.section-copy .backup-tip { font-size:var(--fs-11); }
.section-copy .btn { min-height:44px; }
.wallpaper-option {
  width:100%;
  box-sizing:border-box;
  padding:10px 12px;
  background:var(--card);
  border:1px solid var(--border);
  border-radius:var(--radius-8);
  cursor:pointer;
  color:var(--text);
  align-items:center;
  gap:10px;
  min-height:44px;
  font-size:var(--fs-12);
  display:inline-flex}
.wallpaper-option input { width:18px; height:18px; flex-shrink:0; accent-color:var(--primary); }
.wallpaper-option span { display:flex; flex-direction:column; gap:4px; }
.wallpaper-option b { font-size:var(--fs-12); font-weight:var(--fw-650); }
.wallpaper-option small { color:var(--muted); font-size:var(--fs-11); line-height:1.5; }
@media (max-width:520px) {
  .section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
  .section-copy {
  width:100%;
  min-width:0}
  .section-copy .btn { width:100%; }
}</style>
