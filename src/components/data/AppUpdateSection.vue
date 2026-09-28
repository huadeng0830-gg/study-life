<script setup>
import { appUpdateProgress, checkForAppUpdate, retryAppUpdate, updateChecking, updateMessage } from '../../composables/appUpdate.js'
import TaskProgress from '../TaskProgress.vue'
</script>

<template>
  <section id="data-update" class="data-section">
    <div class="section-icon update">↻</div>
    <div class="section-copy">
      <h4>电脑与手机更新</h4>
      <p>电脑浏览器和苹果桌面版都可以直接检查新版本。更新页面不会删除本地课程和记录；只有浏览器真实报告的阶段才会显示。</p>
      <button class="btn btn-primary" :disabled="updateChecking" @click="checkForAppUpdate()">
        {{ updateChecking ? '正在更新…' : '检查更新' }}
      </button>
      <span v-if="updateMessage" class="update-message">{{ updateMessage }}</span>
      <TaskProgress
        :task="appUpdateProgress.state"
        :elapsed-seconds="appUpdateProgress.elapsedSeconds.value"
        :activity-age-seconds="appUpdateProgress.activityAgeSeconds.value"
        :stalled="appUpdateProgress.isStalled.value"
        compact
        @retry="retryAppUpdate"
        @wait="appUpdateProgress.continueWaiting"
      />
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
.section-icon.update {
  color:#7755d0;
  background:#f0ebff}
.update-message {
  color:var(--primary);
  font-size:var(--fs-11)}
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
}</style>
