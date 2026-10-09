<script setup>
import { computed } from 'vue'
import { lastBackupAt, needsBackup } from '../../composables/backupReminder.js'
import { formatDataSize } from '../../composables/dataManagerInventory.js'
import { formatAppDate } from '../../composables/timeContext.js'

const props = defineProps({ inventory: Object, error: String })
defineEmits(['refresh'])
const backupDate = computed(() => lastBackupAt.value ? formatAppDate(lastBackupAt.value, { withWeekday: false }) : '')
const issueLabels = computed(() => [...new Set(props.inventory?.issues.map((issue) => issue.label) || [])].join('、'))
</script>

<template>
  <section class="data-overview" aria-label="本机数据概览">
    <div class="overview-heading"><div><h4>本机数据概览</h4><p>查看当前记录与备份状态，换设备前先留一份副本。</p></div><button type="button" class="btn btn-sm btn-ghost" @click="$emit('refresh')">刷新</button></div>
    <p v-if="error" class="overview-error" role="alert">{{ error }}</p>
    <div v-if="inventory" class="overview-metrics">
      <div><span>记录总量</span><b>{{ inventory.issues.length ? '至少 ' : '' }}{{ inventory.recordCount.toLocaleString() }}<small>项</small></b><span>分布在 {{ inventory.modules.filter(module => module.recordCount > 0).length }} 个分区</span></div>
      <div><span>本机文本占用</span><b>{{ formatDataSize(inventory.usage.chars * 2) }}</b><span :class="{ 'overview-warning': inventory.usage.warning }">约占常见上限 {{ inventory.usage.percent }}%</span></div>
      <div><span>上次导出备份</span><b class="backup-date">{{ backupDate || '尚未备份' }}</b><span :class="{ 'overview-warning': needsBackup }">{{ needsBackup ? '建议导出一份新备份' : '近期已导出，请保管好文件' }}</span></div>
    </div>
    <p v-if="issueLabels" class="overview-error" role="alert">{{ issueLabels }}中有数据无法读取，统计未包含这些内容。导出时会保留原始数据并提示问题。</p>
    <p v-if="inventory?.usage.warning" class="overview-warning storage-warning" role="alert">本机文本存储已接近常见浏览器上限，建议先导出备份，再整理不需要的历史记录。</p>
    <details v-if="inventory" class="inventory-details">
      <summary>查看各分区的数据量</summary>
      <ul><li v-for="module in inventory.modules" :key="module.id"><div><b>{{ module.label }}</b><span>{{ module.hasIssue ? '部分数据无法读取' : module.detail || module.text }}</span></div><span class="module-size">{{ formatDataSize(module.bytes) }}</span></li></ul>
      <p>占用按本机文本估算；壁纸图片和恢复点另占空间。账号资料、项目协作与成果文件由账号保存，不包含在本机 JSON 备份中。</p>
    </details>
  </section>
</template>

<style scoped>
.data-overview { padding:18px; border:1px solid var(--border); border-radius:var(--radius-12); background:var(--card); }
.overview-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.overview-heading h4 { margin:0; font-size:var(--fs-15); }
.overview-heading p { margin:5px 0 0; color:var(--muted); font-size:var(--fs-12); line-height:1.6; }
.overview-heading .btn { flex-shrink:0; min-height:44px; }
.overview-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:16px; }
.overview-metrics > div { display:flex; flex-direction:column; gap:7px; min-width:0; padding:12px; background:var(--bg-tint); border-radius:var(--radius-10); }
.overview-metrics span { color:var(--ink-soft); font-size:var(--fs-11); line-height:1.5; }
.overview-metrics b { color:var(--text); font-size:var(--fs-22); overflow-wrap:anywhere; }
.overview-metrics b.backup-date { font-size:var(--fs-15); min-height:27px; display:flex; align-items:center; }
.overview-metrics small { margin-left:5px; font-size:var(--fs-12); font-weight:var(--fw-500); }
.overview-metrics .overview-warning { color:var(--warning); }
.overview-error { color:var(--danger); margin:12px 0 0; font-size:var(--fs-12); line-height:1.6; }
.storage-warning { color:var(--warning); margin:12px 0 0; font-size:var(--fs-12); line-height:1.6; }
.inventory-details { margin-top:12px; border-top:1px solid var(--border); }
.inventory-details summary { display:flex; align-items:center; min-height:44px; gap:8px; cursor:pointer; color:var(--primary); font-size:var(--fs-12); font-weight:var(--fw-650); }
.inventory-details summary::before { content:'›'; font-size:var(--fs-18); }
.inventory-details[open] summary::before { content:'⌄'; }
.inventory-details ul { list-style:none; margin:0; padding:0; }
.inventory-details li { display:flex; justify-content:space-between; gap:14px; padding:10px 0; border-top:1px solid var(--border); }
.inventory-details li > div { display:flex; flex-direction:column; gap:4px; min-width:0; }
.inventory-details b { font-size:var(--fs-12); }
.inventory-details span, .inventory-details p { color:var(--muted); font-size:var(--fs-11); line-height:1.6; }
.inventory-details .module-size { white-space:nowrap; flex-shrink:0; }
.inventory-details p { margin:10px 0 0; }
@media (max-width:520px) {
  .data-overview { padding:14px; }
  .overview-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .overview-metrics > div:last-child { grid-column:1/-1; display:grid; grid-template-columns:1fr 1fr; align-items:center; }
  .overview-metrics > div:last-child > span:last-child { grid-column:1/-1; }
}
</style>
