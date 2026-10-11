<script setup>
import { ref } from 'vue'
import ActionButton from './ActionButton.vue'
import { downloadEmergencyBackup } from '../composables/emergencyExport.js'

const props = defineProps({ message: { type: String, default: '' }, alertSlot: { type: Number, default: -1 } })
const emit = defineEmits(['dismiss', 'announce'])
const exportStatus = ref('')

async function exportCurrentData() {
  try {
    const backup = downloadEmergencyBackup()
    const incomplete = backup.completeness.missingKeys.length + backup.completeness.unreadableKeys.length
    const unsaved = backup.completeness.unsavedKeys.length
    exportStatus.value = !backup.completeness.complete
      ? `应急备份不完整：未能可靠读取 ${incomplete} 项数据。文件仅含可读部分，请不要将它视为完整备份。`
      : unsaved
        ? `应急备份已包含 ${unsaved} 项未保存修改的最新内容；这些修改仍未写入本机，请确认下载文件已保存。`
        : '应急备份文件已生成，请确认下载文件已保存。'
    emit('announce', exportStatus.value)
  } catch (error) {
    console.error('[export] 应急导出失败', error)
    emit('announce', '应急导出失败：数据文件没能生成。若浏览器处于无痕或禁用了下载，请换一个普通窗口再试。')
  }
}
</script>

<template>
  <div class="global-persistence-alert" :style="{ '--alert-slot': `${props.alertSlot}` }">
    <b>本机保存需要注意</b>
    <span>{{ props.message }}</span>
    <span v-if="exportStatus">{{ exportStatus }}</span>
    <ActionButton tone="neutral" type="button" class="btn btn-sm" kind="important" feedback="external" :show-error="false" :action="exportCurrentData">导出当前数据</ActionButton>
    <button type="button" class="global-error-close tap-target" aria-label="关闭本机保存提示" @click="emit('dismiss')">×</button>
  </div>
</template>
