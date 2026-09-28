<script setup>
import { SYNC_MODULES } from '../../composables/cloudSyncData.js'
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'

const {
  includeWallpapers, selectedBackupModules, allBackupModulesSelected,
  toggleAllBackupModules, exportBackup,
} = useDataManagerBackup()
</script>

<template>
  <section id="data-backup" class="data-section">
    <div class="section-icon">↓</div>
    <div class="section-copy">
      <h4>导出本地数据</h4>
      <p>将课程、待办、清单、账本和个性化设置保存为备份文件。可勾选携带壁纸（文件会明显变大）。</p>
      <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" /> 同时包含壁纸图片</label>
      <div class="pull-scope">
        <div class="pull-scope-head"><span class="ops-label">选择要导出的模块（默认全部）</span><button type="button" class="scope-toggle" @click="toggleAllBackupModules">{{ allBackupModulesSelected ? '清空' : '全选' }}</button></div>
        <div class="scope-grid"><label v-for="mod in SYNC_MODULES" :key="mod.key" class="scope-item"><input v-model="selectedBackupModules" type="checkbox" :value="mod.key" /><span>{{ mod.label }}</span></label></div>
      </div>
      <button class="btn btn-primary" @click="exportBackup">导出备份文件</button>
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
.wallpaper-option {
  color:var(--text);
  align-items:center;
  gap:7px;
  font-size:var(--fs-12);
  display:inline-flex}
.ops-label {
  color:var(--ink-faint);
  letter-spacing:.08em;
  font-size:var(--fs-10);
  font-weight:var(--fw-800)}
.pull-scope {
  border:1px dashed var(--border);
  background:var(--bg);
  border-radius:var(--radius-9);
  flex-direction:column;
  gap:7px;
  width:100%;
  padding:9px 10px;
  display:flex}
.pull-scope-head {
  justify-content:space-between;
  align-items:center;
  gap:8px;
  display:flex}
.scope-toggle {
  min-height:30px;
  color:var(--primary);
  background:var(--primary-soft);
  border:none;
  border-radius:var(--radius-8);
  padding:3px 10px;
  font-size:var(--fs-11-5);
  font-weight:var(--fw-700)}
.scope-grid {
  grid-template-columns:repeat(auto-fill,minmax(132px,1fr));
  gap:6px;
  display:grid}
.scope-item {
  min-height:40px;
  color:var(--text);
  cursor:pointer;
  border:1px solid var(--border);
  background:var(--card);
  border-radius:var(--radius-8);
  align-items:center;
  gap:7px;
  padding:4px 8px;
  font-size:var(--fs-12-5);
  display:flex}
.scope-item input {
  accent-color:var(--primary)}
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
