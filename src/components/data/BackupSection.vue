<script setup>
import { computed, ref, watch } from 'vue'
import { formatDataSize } from '../../composables/dataManagerInventory.js'
import { useDataManagerBackup } from '../../composables/dataManagerBackup.js'
import { listWallpapers, wallpaperRevision } from '../../composables/wallpaperStorage.js'
const { includeWallpapers, backupBusy, exporting, fileChecking, exportBackup } = useDataManagerBackup()

// 导入侧的硬上限是 100 MB，导出侧之前完全不说 —— 用户勾了「包含壁纸」，
// 攒到几百 MB 导出去，下次恢复时才被一句「文件过大」挡住，而那份备份已经白存了。
const MAX_BACKUP_BYTES = 100 * 1024 * 1024
const WALLPAPER_BUDGET = 0.5 // 超过导入上限的一半就提醒：压缩后仍可能超
const EXPORTED_WALLPAPER_BYTES = 60 * 1024 // 导出走 720px / 0.58 WebP 数据 URI 的粗估

const wallpaperCount = ref(0)
// 只在面板里读一次；wallpaperRevision 变化（增删壁纸）后重读。
async function refreshWallpaperCount() {
  if (typeof indexedDB === 'undefined') { wallpaperCount.value = 0; return }
  try { wallpaperCount.value = Object.keys(await listWallpapers()).length }
  catch { wallpaperCount.value = 0 }
}
watch([wallpaperRevision, () => includeWallpapers.value], () => { void refreshWallpaperCount() }, { immediate: true })

const wallpaperHint = computed(() => {
  if (!includeWallpapers.value || !wallpaperCount.value) return ''
  const bytes = wallpaperCount.value * EXPORTED_WALLPAPER_BYTES
  if (bytes > MAX_BACKUP_BYTES) return `本机有 ${wallpaperCount.value} 张壁纸，预计让备份超过 ${formatDataSize(MAX_BACKUP_BYTES)}，恢复时会被拒绝。可以先不勾选壁纸，只导出文字数据。`
  if (bytes > MAX_BACKUP_BYTES * WALLPAPER_BUDGET) return `本机有 ${wallpaperCount.value} 张壁纸，图片会让备份明显变大（约 ${formatDataSize(bytes)} 起）。`
  return ''
})
</script>

<template>
  <section class="data-section">
    <div class="section-icon" aria-hidden="true">↓</div>
    <div class="section-copy">
      <h4>导出本机完整备份</h4>
      <p>课程、日程、待办、重要日期、清单、账本、专注与心情、提醒记录和个性化设置会保存为一个 JSON 文件。</p>
      <label class="wallpaper-option"><input v-model="includeWallpapers" type="checkbox" :disabled="backupBusy" /><span><b>同时包含壁纸图片</b><small>换设备时可一起恢复；图片较多时，文件会更大。</small></span></label>
      <p v-if="wallpaperHint" class="wallpaper-warning" role="alert">{{ wallpaperHint }}</p>
      <button type="button" class="btn btn-primary" :disabled="backupBusy || fileChecking" :aria-busy="exporting" @click="exportBackup">{{ exporting ? '正在生成备份…' : '导出完整备份' }}</button>
      <p class="backup-tip">导出后请确认文件已保存到下载目录或「文件」应用。应用无法确认浏览器是否真的把文件写了下去，请自行确认一次。</p>
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
.section-copy .wallpaper-warning { color:var(--warning); font-size:var(--fs-11); line-height:1.6; }
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