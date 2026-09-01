<script setup>
import { computed, ref, watch } from 'vue'
import Modal from './Modal.vue'
import { findNoticeChanges, parseNotice } from '../composables/noticeParser.js'

const props = defineProps({ open: Boolean, tasks: { type: Array, default: () => [] }, courses: { type: Array, default: () => [] } })
const emit = defineEmits(['close', 'commit'])

const source = ref('')
const parsed = ref(null)
const matches = ref([])
const selectedId = ref('')
const mode = ref('create')
const error = ref('')
const clipboardMessage = ref('')

watch(() => props.open, (open) => {
  if (!open) return
  source.value = ''
  parsed.value = null
  matches.value = []
  selectedId.value = ''
  mode.value = 'create'
  error.value = ''
  clipboardMessage.value = ''
  void readClipboard()
})

async function readClipboard() {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    clipboardMessage.value = '无法自动读取剪贴板，请按 Ctrl + V 粘贴通知。'
    return
  }
  try {
    const value = await navigator.clipboard.readText()
    if (!props.open) return
    if (value.trim()) {
      source.value = value
      analyze()
    } else {
      clipboardMessage.value = '剪贴板为空，请按 Ctrl + V 粘贴通知。'
    }
  } catch {
    clipboardMessage.value = '浏览器未授权读取剪贴板，请按 Ctrl + V 粘贴通知。'
  }
}

function onSourceInput() {
  // 用户改过原文后，旧预览不能继续覆盖新文本；等待用户确认后重新分析。
  parsed.value = null
  matches.value = []
  selectedId.value = ''
  mode.value = 'create'
  error.value = ''
}

function analyze() {
  error.value = ''
  if (!source.value.trim()) {
    error.value = '请先粘贴老师或班群通知'
    return
  }
  try {
    const nextParsed = parseNotice(source.value, props.courses)
    const nextMatches = findNoticeChanges(nextParsed, props.tasks)
    parsed.value = nextParsed
    matches.value = nextMatches
    if (nextMatches.length) {
      selectedId.value = nextMatches[0].task.id
      mode.value = 'update'
    } else {
      selectedId.value = ''
      mode.value = 'create'
    }
  } catch {
    // 解析异常也不能抹掉 source；用户仍可修改原文后重试或手动保存。
    parsed.value = null
    matches.value = []
    selectedId.value = ''
    mode.value = 'create'
    error.value = '解析失败，原始通知仍已保留，请修改后重试'
  }
}

const selectedTask = computed(() => props.tasks.find((task) => task.id === selectedId.value) ?? null)

function changeRows(task) {
  if (!parsed.value || !task) return []
  const fields = [
    ['标题', task.title || '未填写', parsed.value.title || '未填写'],
    ['截止日期', task.dueDate || '未设置', parsed.value.dueDate || '未识别'],
    ['截止时间', task.dueTime || '未设置', parsed.value.dueTime || '未识别'],
    ['课程', task.course || '未设置', parsed.value.course || task.course || '未识别'],
  ]
  return fields.filter(([, before, after]) => before !== after)
}

function save() {
  error.value = ''
  if (!parsed.value?.title.trim()) {
    error.value = '请填写待办标题'
    return
  }
  const noteParts = [parsed.value.note.trim()]
  if (parsed.value.location.trim()) noteParts.push(`地点：${parsed.value.location.trim()}`)
  if (parsed.value.reminder.trim() && !parsed.value.note.includes(parsed.value.reminder.trim())) noteParts.push(`提醒：${parsed.value.reminder.trim()}`)
  const data = {
    title: parsed.value.title.trim(),
    course: parsed.value.course.trim(),
    dueDate: parsed.value.dueDate,
    dueTime: parsed.value.dueTime,
    priority: parsed.value.priority,
    note: noteParts.filter(Boolean).join('；'),
    rawText: parsed.value.rawText,
    normalizedText: parsed.value.normalizedText,
    sourceText: parsed.value.rawText,
    updatedFromNoticeAt: new Date().toISOString(),
  }
  if (mode.value === 'update') {
    const target = selectedTask.value
    if (!target) {
      error.value = '请选择要更新的原待办'
      return
    }
    emit('commit', { type: 'update', id: target.id, title: target.title, data })
  } else {
    emit('commit', { type: 'create', title: data.title, data })
  }
  emit('close')
}
</script>

<template>
  <Modal :open="open" title="📋 粘贴通知" wide @close="emit('close')">
    <div class="notice-layout">
      <section class="source-panel">
        <label>老师或班群通知</label>
        <textarea v-model="source" rows="8" placeholder="例如：下周三晚上八点前提交实验报告，文件名为学号姓名。" @input="onSourceInput"></textarea>
        <p v-if="clipboardMessage" class="clipboard-message" role="status">{{ clipboardMessage }}</p>
        <div class="privacy-note"><span>⌁</span><p><b>仅在本机解析</b><br />文字不会发送到网络，分析后也不会自动保存。</p></div>
        <button class="btn btn-primary" @click="analyze">分析通知</button>
      </section>

      <section class="preview-panel">
        <div v-if="!parsed" class="preview-empty"><span>→</span><p>粘贴通知并点击分析，右侧将显示可编辑结果。</p></div>
        <template v-else>
          <div class="preview-head"><div><span>PARSED RESULT</span><h3>确认解析结果</h3><small>{{ parsed.type }} · {{ parsed.confidenceLevel === 'high' ? '高置信度' : parsed.confidenceLevel === 'medium' ? '中置信度' : '低置信度' }} {{ Math.round(parsed.confidence * 100) }}%</small></div><span v-if="!parsed.dueDate && !parsed.dateRange" class="warn">日期待确认</span><span v-else-if="parsed.dateRange" class="warn">时间范围：{{ parsed.dateRange }}</span></div>
          <div class="preview-form">
            <label>待办标题<input v-model="parsed.title" /></label>
            <div class="row"><label>日期<input v-model="parsed.dueDate" type="date" /><small v-if="parsed.dateText && parsed.dateText !== parsed.dueDate">原文：{{ parsed.dateText }}</small></label><label>开始时间<input v-model="parsed.dueTime" type="time" /><small v-if="parsed.endTime">结束时间：{{ parsed.endTime }}</small></label></div>
            <div class="row"><label>地点<input v-model="parsed.location" placeholder="可选，待确认" /></label><label>提醒<input v-model="parsed.reminder" placeholder="例如：提前10分钟" /></label></div>
            <div class="row"><label>所属课程<input v-model="parsed.course" list="notice-course-list" placeholder="可选" /></label><label>优先级<select v-model="parsed.priority"><option value="high">高优先级</option><option value="normal">普通</option><option value="low">低优先级</option></select></label></div>
            <datalist id="notice-course-list"><option v-for="course in courses" :key="course.id" :value="course.name"></option></datalist>
            <label>补充备注<textarea v-model="parsed.note" rows="2"></textarea></label>
            <label>原始通知<textarea :value="parsed.rawText" rows="4" readonly></textarea></label>
          </div>

          <div v-if="matches.length" class="change-box">
            <div class="change-title"><span>↻</span><div><b>可能是已有通知的变更</b><p>请确认是更新原待办，还是另建一项。</p></div></div>
            <label v-for="item in matches" :key="item.task.id" class="match-row" :class="{ selected: selectedId === item.task.id }">
              <input v-model="selectedId" type="radio" :value="item.task.id" @change="mode = 'update'" />
              <span><b>{{ item.task.title }}</b><small>{{ item.task.dueDate || '无日期' }} {{ item.task.dueTime || '' }} · 相似度 {{ Math.round(item.score * 100) }}%</small></span>
            </label>
            <div v-if="selectedTask && mode === 'update'" class="diff-list">
              <div v-for="row in changeRows(selectedTask)" :key="row[0]"><b>{{ row[0] }}</b><span>{{ row[1] }}</span><i>→</i><strong>{{ row[2] }}</strong></div>
              <p v-if="!changeRows(selectedTask).length">通知内容相似，但关键字段没有变化。</p>
            </div>
          </div>

          <div class="save-choice">
            <label v-if="matches.length"><input v-model="mode" type="radio" value="update" /> 更新选中的原待办</label>
            <label><input v-model="mode" type="radio" value="create" /> 创建一个新待办</label>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <div class="actions"><button class="btn btn-primary" @click="save">{{ mode === 'update' ? '确认更新' : '确认创建' }}</button></div>
        </template>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.notice-layout{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:18px}.source-panel,.preview-panel{display:flex;flex-direction:column;gap:11px}.source-panel>label,.preview-form label{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:12px}.source-panel textarea{width:100%;min-height:190px;line-height:1.65;resize:vertical}.clipboard-message{margin:-4px 0 0;color:#9a651d;font-size:11px;line-height:1.45}.privacy-note{display:flex;gap:9px;padding:10px;border-radius:9px;background:#effaf6;color:#25725a}.privacy-note span{font-size:20px}.privacy-note p{font-size:11px;line-height:1.55}.source-panel .btn{align-self:flex-start}.preview-panel{min-height:330px;padding:15px;border:1px solid var(--border);border-radius:12px;background:#fafbfd}.preview-empty{display:grid;place-items:center;align-content:center;gap:10px;min-height:300px;color:var(--muted);text-align:center}.preview-empty span{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:var(--primary-soft);color:var(--primary);font-size:24px}.preview-empty p{max-width:260px;font-size:12px;line-height:1.6}.preview-head{display:flex;justify-content:space-between;align-items:flex-start}.preview-head span{color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.14em}.preview-head h3{margin-top:3px;font-size:16px}.preview-head small{display:block;margin-top:4px;color:var(--muted);font-size:10px}.preview-head .warn{padding:5px 7px;border-radius:6px;background:#fff3d8;color:#a96712;letter-spacing:0}.preview-form{display:flex;flex-direction:column;gap:8px}.preview-form input,.preview-form select,.preview-form textarea{width:100%;background:#fff}.preview-form small{color:var(--muted);font-size:10px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.change-box{display:flex;flex-direction:column;gap:7px;padding:10px;border:1px solid #f2d08c;border-radius:10px;background:#fffaf0}.change-title{display:flex;gap:8px}.change-title>span{font-size:20px;color:#b86b16}.change-title b{font-size:12px}.change-title p{margin-top:2px;color:var(--muted);font-size:10px}.match-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid transparent;border-radius:8px;background:#fff;cursor:pointer}.match-row.selected{border-color:var(--primary)}.match-row>span{display:flex;flex-direction:column;gap:2px}.match-row b{font-size:11px}.match-row small{color:var(--muted);font-size:9px}.diff-list{display:flex;flex-direction:column;gap:4px;padding:7px;border-radius:7px;background:#fff}.diff-list div{display:grid;grid-template-columns:60px 1fr 18px 1fr;gap:5px;align-items:center;font-size:9px}.diff-list span{color:var(--muted);text-decoration:line-through}.diff-list i{font-style:normal;text-align:center;color:var(--muted)}.diff-list strong{color:var(--primary)}.diff-list p{color:var(--muted);font-size:10px}.save-choice{display:flex;flex-wrap:wrap;gap:12px;padding-top:3px}.save-choice label{display:flex;align-items:center;gap:5px;font-size:11px}.error{color:var(--danger);font-size:12px}.actions{display:flex;justify-content:flex-end}
@media(max-width:760px){.notice-layout{grid-template-columns:1fr}.source-panel textarea{min-height:130px}.preview-panel{min-height:0}.row{grid-template-columns:1fr}.source-panel .btn{width:100%}.diff-list div{grid-template-columns:52px 1fr 15px 1fr}}
</style>
