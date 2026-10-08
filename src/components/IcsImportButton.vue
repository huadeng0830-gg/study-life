<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { appTimezone } from '../composables/timeContext.js'
import { MAX_ICS_IMPORT_BYTES, parseIcsCalendar } from '../composables/icalImport.js'

const props = defineProps({ records: { type: Array, default: () => [] } })
const emit = defineEmits(['import'])
const fileInput = ref(null)
const preview = ref(null)
const fileName = ref('')
const error = ref('')
const message = ref('')
const busy = ref(false)

async function readFile(event) {
  const input = event.target
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  error.value = ''
  message.value = ''
  if (!/\.ics$/i.test(file.name) && file.type !== 'text/calendar') {
    error.value = '请选择 .ics 日历文件。'
    return
  }
  if (file.size > MAX_ICS_IMPORT_BYTES) {
    error.value = '文件超过 3 MB，请拆分后再导入。'
    return
  }
  busy.value = true
  try {
    const result = parseIcsCalendar(await file.text(), { existingEvents: props.records, timezone: appTimezone.value })
    if (!result.found) {
      error.value = '文件中没有找到日历事件。'
      return
    }
    fileName.value = file.name
    preview.value = result
  } catch (cause) {
    error.value = cause?.message || '无法读取这个日历文件。'
  } finally {
    busy.value = false
  }
}

function closePreview() {
  preview.value = null
}

function importEvents() {
  const rows = preview.value?.events || []
  if (!rows.length) return
  emit('import', rows)
  message.value = '已提交 ' + rows.length + ' 条日程导入。'
  preview.value = null
}
</script>

<template>
  <div class="ics-import">
    <input
      ref="fileInput"
      class="ics-file-input"
      type="file"
      accept=".ics,text/calendar"
      aria-label="选择 ICS 日历文件"
      @change="readFile"
    />
    <button type="button" class="btn" :disabled="busy" @click="fileInput?.click()">
      {{ busy ? '正在读取…' : '导入 .ics' }}
    </button>
    <p v-if="error" class="ics-message error" role="alert">{{ error }}</p>
    <p v-else-if="message" class="ics-message" role="status">{{ message }}</p>

    <Modal :open="Boolean(preview)" title="预览日历导入" medium @close="closePreview">
      <div v-if="preview" class="ics-preview">
        <p><b>{{ fileName }}</b>：找到 {{ preview.found }} 条事件，可导入 {{ preview.events.length }} 条。</p>
        <ul v-if="preview.events.length" class="ics-preview-list">
          <li v-for="item in preview.events.slice(0, 6)" :key="item.sourceText">
            <b>{{ item.title }}</b>
            <span>{{ item.date }}<template v-if="item.time"> · {{ item.time }}<template v-if="item.endTime">–{{ item.endTime }}</template></template></span>
          </li>
        </ul>
        <p v-if="preview.events.length > 6" class="ics-muted">另有 {{ preview.events.length - 6 }} 条未展开预览。</p>
        <p v-if="preview.duplicates || preview.skippedRecurrence || preview.skippedMultiDay || preview.skippedInvalid" class="ics-muted">
          将跳过已导入或文件内重复记录 {{ preview.duplicates }} 条、循环日程 {{ preview.skippedRecurrence }} 条、多日事件 {{ preview.skippedMultiDay }} 条、无效事件 {{ preview.skippedInvalid }} 条。
        </p>
        <p class="ics-muted">仅处理单次事件；循环日程和跨日事件暂不导入。导入的时间会按本应用时区显示。</p>
        <div class="ics-actions">
          <button type="button" class="btn" @click="closePreview">取消</button>
          <button type="button" class="btn btn-primary" :disabled="!preview.events.length" @click="importEvents">导入 {{ preview.events.length }} 条</button>
        </div>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.ics-import { display:flex; flex-wrap:wrap; align-items:center; gap:7px; min-width:0; }
.ics-file-input { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.ics-message { max-width:230px; margin:0; color:var(--ink-soft); font-size:var(--fs-11); line-height:1.4; }
.ics-message.error { color:var(--danger); }
.ics-preview { display:grid; gap:11px; }
.ics-preview > p { margin:0; font-size:var(--fs-12); line-height:1.5; }
.ics-preview-list { display:grid; gap:7px; max-height:240px; overflow:auto; margin:0; padding:0; list-style:none; }
.ics-preview-list li { display:flex; flex-direction:column; gap:3px; padding:8px 10px; border-radius:var(--radius-8); background:var(--bg); }
.ics-preview-list li b { overflow-wrap:anywhere; }
.ics-preview-list li span,.ics-muted { color:var(--ink-soft); font-size:var(--fs-11); }
.ics-actions { display:flex; justify-content:flex-end; gap:8px; }
</style>
