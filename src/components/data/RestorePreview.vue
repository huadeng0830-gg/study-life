<script setup>
import { computed } from 'vue'
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'
import { buildRestorePreview } from '../../composables/dataManagerInventory.js'

const props = defineProps({ inventory: Object })
const { selectedBackup, selectedName, summary, restoreSelection, backupBusy, restoreBackup, clearSelectedBackup } = useDataManagerBackup()
const rows = computed(() => buildRestorePreview(selectedBackup.value, props.inventory))
const allIds = computed(() => [...rows.value.map(row => row.id), ...(summary.value?.wallpapers ? ['wallpapers'] : [])])
const clearedRows = computed(() => rows.value.filter(row => row.clearsRecords && restoreSelection.value.includes(row.id)))
function selectAll() { restoreSelection.value = [...allIds.value] }
</script>

<template>
  <div v-if="summary" class="restore-preview">
    <div class="preview-heading"><div><h4>选择恢复范围</h4><p class="preview-name">{{ selectedName }}</p></div><button type="button" class="btn btn-sm btn-ghost" :disabled="backupBusy" @click="clearSelectedBackup">取消选择</button></div>
    <div class="preview-metadata"><span>{{ summary.exportedAt || '备份日期未记录' }}</span><span v-if="summary.fileSize">{{ summary.fileSize }}</span><span>格式 v{{ summary.version }}</span><span :class="{ legacy: !summary.verified }">{{ summary.verified ? '完整性校验通过' : '旧版备份，无完整性校验' }}</span></div>
    <div class="preview-selection"><span>已选择 {{ restoreSelection.length }} / {{ allIds.length }} 个分区</span><div><button type="button" :disabled="backupBusy || restoreSelection.length === allIds.length" @click="selectAll">全选</button><button type="button" :disabled="backupBusy || !restoreSelection.length" @click="restoreSelection = []">清空选择</button></div></div>
    <fieldset class="restore-module-options"><legend class="sr-only">选择要恢复的数据范围</legend>
      <label v-for="row in rows" :key="row.id" class="restore-row" :class="{ selected: restoreSelection.includes(row.id) }"><input v-model="restoreSelection" type="checkbox" :value="row.id" :disabled="backupBusy" /><span class="restore-row-copy"><b>{{ row.label }}</b><span class="restore-comparison"><span>备份：{{ row.backupText }}</span><span>本机：{{ row.localText }}</span></span><small v-if="row.backupDetail">{{ row.backupDetail }}</small><small v-if="row.clearsRecords" class="empty-warning">备份中的{{ row.clearedLabels }}为空，恢复后会清空对应记录。</small></span></label>
      <label v-if="summary.wallpapers" class="restore-row" :class="{ selected: restoreSelection.includes('wallpapers') }"><input v-model="restoreSelection" type="checkbox" value="wallpapers" :disabled="backupBusy" /><span class="restore-row-copy"><b>壁纸图片</b><span>备份中有 {{ summary.wallpapers }} 张图片，将替换本机壁纸。</span></span></label>
    </fieldset>
    <p v-if="clearedRows.length" class="preview-warning" role="status">已选范围含空记录：{{ clearedRows.map(row => row.label).join('、') }}。请确认这是你要恢复的内容。</p>
    <p class="restore-preview-note">所选内容会覆盖本机对应数据。恢复前自动保存本机恢复点，未勾选的分区保持原样；已开启账号同步时，恢复结果也会同步到其它设备。</p>
    <div class="preview-footer"><span v-if="!restoreSelection.length">请至少选择一个分区</span><button type="button" class="btn btn-primary" :disabled="backupBusy || !restoreSelection.length" @click="restoreBackup">恢复所选 {{ restoreSelection.length }} 个分区</button></div>
  </div>
</template>

<style scoped>
.restore-preview { padding:16px; border:1px solid var(--border-strong); border-radius:var(--radius-12); background:var(--card); display:flex; flex-direction:column; gap:12px; }
.preview-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.preview-heading > div { min-width:0; }
.preview-heading h4 { margin:0; font-size:var(--fs-14); }
.preview-name { margin:5px 0 0; color:var(--ink-soft); font-size:var(--fs-12); overflow-wrap:anywhere; }
.preview-heading .btn { flex-shrink:0; min-height:44px; }
.preview-metadata { display:flex; flex-wrap:wrap; gap:6px 14px; color:var(--muted); font-size:var(--fs-11); line-height:1.6; }
.preview-metadata span:last-child { color:var(--success); }
.preview-metadata span.legacy { color:var(--warning); }
.preview-selection { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:6px; color:var(--ink-soft); font-size:var(--fs-12); }
.preview-selection > div { display:flex; gap:8px; }
.preview-selection button { min-height:44px; padding:0 9px; border:0; border-radius:var(--radius-6); color:var(--primary); background:var(--primary-soft); cursor:pointer; font:inherit; }
.preview-selection button:disabled { color:var(--muted); background:var(--bg); cursor:default; }
.restore-module-options { margin:0; padding:0; border:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.restore-row { min-height:44px; display:flex; gap:10px; padding:12px; border:1px solid var(--border); border-radius:var(--radius-8); cursor:pointer; background:var(--bg-tint); }
.restore-row.selected { border-color:var(--primary); background:var(--primary-soft); }
.restore-row input { width:18px; height:18px; flex-shrink:0; margin:2px 0 0; accent-color:var(--primary); }
.restore-row-copy { display:flex; flex-direction:column; gap:5px; min-width:0; color:var(--ink-soft); font-size:var(--fs-11); line-height:1.6; }
.restore-row-copy b { color:var(--text); font-size:var(--fs-12); }
.restore-comparison { display:flex; flex-direction:column; gap:2px; }
.restore-row-copy small { font-size:var(--fs-11); }
.restore-row-copy .empty-warning, .preview-warning { color:var(--warning); }
.preview-warning { margin:0; padding:10px 12px; background:color-mix(in srgb,var(--warning) 6%,var(--card)); border-radius:var(--radius-8); font-size:var(--fs-12); line-height:1.6; }
.restore-preview-note { margin:0; color:var(--ink-soft); font-size:var(--fs-12); line-height:1.6; }
.preview-footer { display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap; gap:10px; }
.preview-footer > span { color:var(--muted); font-size:var(--fs-12); }
.preview-footer .btn { min-height:44px; }
@media (max-width:520px) {
  .restore-preview { padding:12px; }
  .restore-module-options { grid-template-columns:1fr; }
  .preview-footer .btn { width:100%; }
}
</style>
