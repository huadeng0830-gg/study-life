<script setup>
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'

const { selectFile, fileChecking, selectedName, backupBusy } = useDataManagerBackup()
</script>

<template>
  <section class="data-section">
    <div class="section-icon restore" aria-hidden="true">↑</div>
    <div class="section-copy">
      <h4>从备份恢复</h4>
      <p>选择此前导出的 JSON 文件，先查看覆盖范围，再确认恢复；选文件时不会修改当前数据。</p>
      <label class="file-button" :class="{ disabled: backupBusy }">
        {{ fileChecking ? '正在检查备份…' : '选择备份文件' }}
        <input type="file" accept="application/json,.json" aria-label="选择要恢复的备份文件" :disabled="backupBusy" :aria-busy="fileChecking" @change="selectFile" />
      </label>
      <p v-if="fileChecking" class="file-checking" role="status">正在读取 {{ selectedName }} 并检查文件完整性…</p>
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
.section-icon.restore {
  color:var(--success);
  background:color-mix(in srgb, var(--success) 10%, var(--card))}
.section-copy {
  flex:1;
  min-width:0;
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
.file-button {
  position:relative;
  color:var(--primary);
  cursor:pointer;
  background:var(--primary-soft);
  border-radius:var(--radius-8);
  min-height:44px;
  box-sizing:border-box;
  align-items:center;
  padding:8px 14px;
  font-size:var(--fs-13);
  font-weight:var(--fw-700);
  display:inline-flex}
.file-button input {
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  cursor:pointer;
  opacity:0}
.file-button:focus-within {
  outline:var(--focus-width) solid var(--focus-solid);
  outline-offset:var(--focus-offset);
  box-shadow:0 0 0 calc(var(--focus-width) + var(--focus-offset) + 1px) var(--focus-halo)}
.file-button.disabled { opacity:.6; cursor:default; }
.file-button.disabled input { cursor:default; }
.file-checking { overflow-wrap:anywhere; }
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
