<script setup>
import { computed, ref, unref, watch } from 'vue'
import Modal from './Modal.vue'
import ActionButton from './ActionButton.vue'
import ActionFeedback from './ActionFeedback.vue'
import { useLatestTask } from '../composables/latestTask.js'
import { parseDomainCsvFile } from '../composables/domainCsvImport.js'

const props = defineProps({
  kind: { type: String, required: true },
  records: { default: () => [] },
})
const emit = defineEmits(['import'])

const open = ref(false)
const filename = ref('')
const preview = ref(null)
const error = ref('')
const importing = ref(false)
const reads = useLatestTask()
watch(open, (value) => { if (!value) { reads.cancel(); importing.value = false } })

const labels = {
  tasks: { noun: '待办', title: '导入待办 CSV' },
  events: { noun: '日程', title: '导入日程 CSV' },
}
const importAvailable = computed(() => props.kind === 'tasks' || props.kind === 'events')
const copy = computed(() => labels[props.kind] || labels.tasks)
const previewRows = computed(() => preview.value?.rows?.slice(0, 8) || [])

watch(() => props.kind, () => {
  reads.cancel()
  importing.value = false
  preview.value = null
  filename.value = ''
  error.value = ''
})

function openImport() {
  if (!importAvailable.value) return
  preview.value = null
  filename.value = ''
  error.value = ''
  open.value = true
}

async function readFile(event) {
  if (!importAvailable.value) return
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  preview.value = null
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/i.test(file.type || '')) {
    error.value = '请选择 CSV 文件。'
    return
  }
  importing.value = true
  const job = reads.begin()
  error.value = ''
  filename.value = file.name
  try {
    const buffer = await file.arrayBuffer()
    if (!job.isCurrent()) return
    const result = parseDomainCsvFile(buffer, { kind: props.kind, records: unref(props.records) })
    preview.value = result
    if (result.error) error.value = result.error
    else if (!result.rows.length) error.value = '没有可导入的新记录。请检查表头，或确认这些记录尚未导入。'
  } catch (reason) {
    if (!job.isCurrent()) return
    preview.value = null
    error.value = reason instanceof Error ? reason.message : '读取 CSV 失败，请检查文件编码和格式。'
  } finally {
    if (job.isCurrent()) importing.value = false
    job.finish()
  }
}

function confirmImport() {
  if (!open.value || importing.value) return
  const rows = preview.value?.rows || []
  if (!rows.length) return
  open.value = false
  emit('import', rows)
}
</script>

<template>
  <div v-if="importAvailable" class="csv-import-control">
    <button type="button" class="btn btn-ghost" @click="openImport">⇧ 导入 CSV</button>
    <Modal :open="open" :title="copy.title" medium @close="open = false">
      <div class="csv-import-body" :aria-busy="importing || undefined">
        <p>支持 Todoist、Notion、提醒事项等导出的 CSV。文件只在本机解析；会扫描表头并跳过已导入或重复的记录。</p>
        <label class="csv-file-picker">
          <input type="file" accept=".csv,text/csv" :disabled="importing" @change="readFile" />
          {{ importing ? '正在读取…' : filename || '选择 CSV 文件' }}
        </label>
        <section v-if="preview" class="csv-preview" aria-label="导入预览">
          <div class="csv-preview-count"><b>{{ preview.total }}</b><span>条可导入</span></div>
          <div class="csv-preview-skips">
            <span>重复 {{ preview.skipped.duplicates }}</span>
            <span>{{ kind === 'events' ? '内容或时间无效' : '无有效内容' }} {{ preview.skipped.invalid }}</span>
            <span v-if="preview.truncated">文件超过 2000 行，已截取前 2000 行</span>
          </div>
          <ul v-if="previewRows.length">
            <li v-for="(row, index) in previewRows" :key="`${row.sourceId}-${index}`">
              <b>{{ row.title || row.content }}</b>
              <small>{{ row.date || row.dueDate || '未安排日期' }}{{ row.time || row.dueTime ? ` · ${row.time || row.dueTime}` : '' }}</small>
            </li>
          </ul>
          <p v-if="preview.total > previewRows.length" class="csv-more">另有 {{ preview.total - previewRows.length }} 条不在预览中。</p>
        </section>
        <ActionFeedback class="csv-error" :message="error" tone="error" />
      </div>
      <template #foot>
        <div class="csv-import-footer">
          <button type="button" class="btn btn-ghost" @click="open = false">取消</button>
          <ActionButton feedback="external" :disabled="!preview?.rows?.length || importing" @click="confirmImport">导入 {{ preview?.total || '' }} 条</ActionButton>
        </div>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.csv-import-control{display:inline-flex;align-items:center;gap:8px}
.csv-import-body{display:flex;flex-direction:column;gap:11px}.csv-import-body>p:first-child{margin:0;color:var(--muted);font-size:var(--fs-12);line-height:1.55}
.csv-file-picker{display:flex;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;border:1px dashed var(--border-strong,var(--border));border-radius:var(--radius-9);background:var(--bg);color:var(--primary);font-size:var(--fs-12);font-weight:var(--fw-700);cursor:pointer}.csv-file-picker input{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;clip-path:inset(50%)}
.csv-preview{padding:12px;border:1px solid var(--border);border-radius:var(--radius-10);background:var(--bg)}.csv-preview-count{display:flex;align-items:baseline;gap:5px}.csv-preview-count b{font-size:var(--fs-20);color:var(--primary)}.csv-preview-count span,.csv-preview-skips,.csv-preview li small,.csv-more{color:var(--muted);font-size:var(--fs-10)}.csv-preview-skips{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}.csv-preview ul{display:flex;flex-direction:column;gap:5px;margin:9px 0 0;padding:0;list-style:none}.csv-preview li{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding-top:6px;border-top:1px solid var(--border)}.csv-preview li b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-11)}.csv-preview li small{flex:0 0 auto}.csv-more{margin:7px 0 0}.csv-error{margin:0;color:var(--danger);font-size:var(--fs-11);line-height:1.5}.csv-import-footer{display:flex;justify-content:flex-end;gap:8px}
</style>
