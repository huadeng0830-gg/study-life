<script setup>
import { lastBackupAt } from '../../composables/backupReminder.js'
import { useDataManagerStatus } from '../../composables/dataManagerStatus.js'

const { dataHealth, fmtTime, formatBytes, refreshDataHealth } = useDataManagerStatus()
</script>

<template>
  <section id="data-health" class="data-section">
    <div class="section-icon health">⌁</div>
    <div class="section-copy health-copy">
      <div class="health-head"><div><h4>数据健康</h4><p>仅统计当前浏览器中的本地数据，不会上传任何内容。</p></div><button class="btn" @click="refreshDataHealth">刷新</button></div>
      <div class="health-grid">
        <span><small>数据模块</small><b>{{ dataHealth.keys }} 项</b></span>
        <span><small>本地数据</small><b>{{ formatBytes(dataHealth.bytes) }}</b></span>
        <span><small>最近备份</small><b>{{ fmtTime(lastBackupAt) }}</b></span>
        <span v-if="dataHealth.quota"><small>浏览器已用</small><b>{{ formatBytes(dataHealth.usage) }} / {{ formatBytes(dataHealth.quota) }}</b></span>
      </div>
      <p v-if="dataHealth.largest.length" class="health-largest">占用较大：<span v-for="record in dataHealth.largest" :key="record.key">{{ record.key.replace('sl_', '') }} {{ formatBytes(record.bytes) }}</span></p>
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
@media (max-width:520px) {
  .section-icon {
  flex-basis:32px;
  width:32px;
  height:32px;
  font-size:var(--fs-17)}
  .section-copy {
  width:100%;
  min-width:0}
}
.section-icon.health {
  color:#7755d0;
  background:#f0ebff}
.health-copy {
  width:100%;
  min-width:0}
.health-head {
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
  width:100%;
  display:flex}
.health-grid {
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:7px;
  width:100%;
  display:grid}
.health-grid span {
  background:var(--bg);
  border-radius:var(--radius-8);
  flex-direction:column;
  gap:3px;
  min-width:0;
  padding:8px;
  display:flex}
.health-grid small {
  color:var(--muted);
  font-size:var(--fs-10)}
.health-grid b {
  text-overflow:ellipsis;
  white-space:nowrap;
  font-size:var(--fs-11);
  overflow:hidden}
.health-largest {
  flex-wrap:wrap;
  align-items:center;
  gap:5px;
  width:100%;
  display:flex;
  font-size:var(--fs-10-5) !important}
.health-largest span {
  background:var(--bg);
  color:var(--ink-soft);
  border-radius:var(--radius-5);
  padding:3px 6px}
@media (max-width:760px) {
  .health-grid {
  grid-template-columns:repeat(2,minmax(0,1fr))}
}</style>
